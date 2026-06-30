import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Drawer, FloatButton, Input, Space, Spin, Tag, Typography, message as antdMessage } from 'antd'
import {
  CheckCircleOutlined,
  LinkOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
} from '@ant-design/icons'
import { API_BASE } from '../../config/api'

const { Text, Paragraph } = Typography

type ChatActionCard = {
  id: string
  type: 'navigation' | 'tool_confirmation' | 'artifact' | 'blocked' | 'result'
  title: string
  description: string
  href?: string
  confirmationId?: string
  status?: 'ready' | 'requires_confirmation' | 'blocked' | 'completed'
}

type ChatResponse = {
  schemaVersion: 'fams.chat.response.v1'
  conversationId: string
  messageId: string
  reply: string
  intent: string
  confidence: number
  actionCards: ChatActionCard[]
  requiresConfirmation: boolean
  operationId?: string
  artifactRefs: string[]
  blockedReasons: string[]
  prohibitedActions: string[]
  agentCore: {
    provider: string
    mode: string
    runtimeAvailable: boolean
    nodeVersion: string
    note: string
  }
  notTradingAdvice: true
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  response?: ChatResponse
}

type ChatSessionSnapshot = {
  schemaVersion: 'fams.chat.session_snapshot.v1'
  conversationId: string
  status: 'audited' | 'missing'
  messages?: Array<{
    id: string
    role: 'user' | 'assistant' | 'tool'
    text: string
    response?: ChatResponse
  }>
  summary?: string
}

const CHAT_SESSION_STORAGE_KEY = 'fams.chat.conversationId'

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

const quickPrompts = [
  '帮我看红利低波前三只候选',
  '当前组合情况如何',
  '查看最近任务状态',
  '为什么不能下单',
]

export function FamsChatBox() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string>()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '我是 FAMS 业务助手。可以帮你查看组合、红利低波候选、任务状态和策略回测入口；涉及扫描、刷新、草案会先让你确认。',
    },
  ])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const savedConversationId = window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY)
    if (!savedConversationId) return
    let cancelled = false
    const restoreSession = async () => {
      try {
        const snapshot = await getJson<ChatSessionSnapshot>(`/api/v1/chat/sessions/${encodeURIComponent(savedConversationId)}`)
        if (cancelled || snapshot.status !== 'audited') return
        setConversationId(snapshot.conversationId)
        const restored = (snapshot.messages || [])
          .filter((item) => item.role === 'user' || item.role === 'assistant')
          .map((item) => ({
            id: item.id,
            role: item.role as 'user' | 'assistant',
            text: item.text,
            response: item.response,
          }))
        if (restored.length > 0) {
          setMessages([
            {
              id: 'welcome-restored',
              role: 'assistant',
              text: snapshot.summary || '已恢复最近 ChatBox 会话。正式交易动作仍被阻断。',
            },
            ...restored,
          ])
        }
      } catch {
        window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY)
      }
    }
    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  const latestAgentCore = useMemo(() => {
    const latest = [...messages].reverse().find((item) => item.response?.agentCore)
    return latest?.response?.agentCore
  }, [messages])

  const sendMessage = async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return
    setInput('')
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', text: content }
    setMessages((current) => [...current, userMessage])
    setLoading(true)
    try {
      const response = await postJson<ChatResponse>('/api/v1/chat/messages', {
        conversationId,
        userId: 'default',
        message: content,
      })
      setConversationId(response.conversationId)
      window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, response.conversationId)
      setMessages((current) => [
        ...current,
        {
          id: response.messageId,
          role: 'assistant',
          text: response.reply,
          response,
        },
      ])
    } catch (error: any) {
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          text: `ChatBox 请求失败：${error?.message || String(error)}。请确认后端服务已启动。`,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const confirmTool = async (confirmationId: string) => {
    if (loading) return
    setLoading(true)
    try {
      const response = await postJson<ChatResponse>('/api/v1/chat/tool-confirmations', {
        userId: 'default',
        conversationId,
        confirmationId,
      })
      setConversationId(response.conversationId)
      window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, response.conversationId)
      setMessages((current) => [
        ...current,
        {
          id: response.messageId,
          role: 'assistant',
          text: response.reply,
          response,
        },
      ])
    } catch (error: any) {
      antdMessage.error(`确认失败：${error?.message || String(error)}`)
    } finally {
      setLoading(false)
    }
  }

  const handleCardClick = (card: ChatActionCard) => {
    if (card.type === 'navigation' && card.href) {
      navigate(card.href)
      setOpen(false)
      return
    }
    if (card.type === 'tool_confirmation' && card.confirmationId) {
      confirmTool(card.confirmationId)
    }
  }

  return (
    <>
      <FloatButton
        type="primary"
        icon={<RobotOutlined />}
        tooltip="FAMS 业务助手"
        onClick={() => setOpen(true)}
        className="right-5 bottom-5"
      />
      <Drawer
        title={
          <Space className="min-w-0">
            <RobotOutlined />
            <span>FAMS 业务助手</span>
            <Tag color="blue">研究模式</Tag>
          </Space>
        }
        placement="right"
        width={420}
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: 16, background: '#0f172a' }, header: { background: '#111827', borderBottomColor: '#334155' } }}
      >
        <div className="flex h-full min-h-0 flex-col gap-3 text-gray-100">
          <Alert
            type="info"
            showIcon
            icon={<SafetyCertificateOutlined />}
            message="ChatBox 不创建订单"
            description="允许研究、观察、比较、提醒和人工计划草案；正式 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 始终受交易 gate 阻断。"
          />

          <div className="flex flex-wrap gap-2">
            {quickPrompts.map((prompt) => (
              <Button
                key={prompt}
                size="small"
                onClick={() => sendMessage(prompt)}
                disabled={loading}
              >
                {prompt}
              </Button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto rounded border border-slate-700 bg-slate-950/60 p-3">
            <Space direction="vertical" size={12} className="w-full">
              {messages.map((item) => (
                <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[92%] rounded-lg px-3 py-2 ${item.role === 'user' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-gray-100'}`}>
                    <Paragraph className="!mb-0 whitespace-pre-wrap text-inherit">{item.text}</Paragraph>
                    {item.response?.blockedReasons?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {item.response.blockedReasons.map((reason) => (
                          <Tag key={reason} color="red">{reason}</Tag>
                        ))}
                      </div>
                    ) : null}
                    {item.response?.actionCards?.length ? (
                      <Space direction="vertical" size={8} className="mt-3 w-full">
                        {item.response.actionCards.map((card) => (
                          <Card
                            key={card.id}
                            size="small"
                            className="border-slate-600 bg-slate-900"
                            bodyStyle={{ padding: 10 }}
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <Text strong className="text-gray-100">{card.title}</Text>
                                <Paragraph className="!mb-0 mt-1 text-xs text-gray-300">{card.description}</Paragraph>
                              </div>
                              <Button
                                size="small"
                                icon={card.type === 'tool_confirmation' ? <CheckCircleOutlined /> : <LinkOutlined />}
                                danger={card.type === 'blocked'}
                                disabled={card.type === 'blocked' || loading}
                                onClick={() => handleCardClick(card)}
                              >
                                {card.type === 'tool_confirmation' ? '确认' : card.type === 'blocked' ? '已阻断' : '打开'}
                              </Button>
                            </div>
                          </Card>
                        ))}
                      </Space>
                    ) : null}
                  </div>
                </div>
              ))}
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <Spin size="small" />
                  正在处理...
                </div>
              ) : null}
            </Space>
          </div>

          <Space.Compact className="w-full">
            <Input.TextArea
              value={input}
              autoSize={{ minRows: 1, maxRows: 3 }}
              placeholder="例如：帮我看红利低波前三只候选"
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  sendMessage()
                }
              }}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={() => sendMessage()} loading={loading}>
              发送
            </Button>
          </Space.Compact>

          <div className="text-xs text-gray-400">
            AgentCore：{latestAgentCore?.provider || 'pi-agent-core'}｜
            模式：{latestAgentCore?.mode || 'deterministic_planner'}｜
            Runtime：{latestAgentCore?.runtimeAvailable === false ? '未确认' : '可用'}
          </div>
        </div>
      </Drawer>
    </>
  )
}
