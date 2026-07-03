import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Collapse, Drawer, FloatButton, Input, Space, Spin, Tag, Typography, message as antdMessage } from 'antd'
import ReactECharts from 'echarts-for-react'
import {
  BarChartOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  FileSearchOutlined,
  LinkOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  ThunderboltOutlined,
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

type ChatMetricCard = {
  label: string
  value: string | number | null
  unit?: string
  status?: 'good' | 'warning' | 'blocked' | 'neutral'
  description?: string
}

type ChatStructuredResult = {
  resultType: string
  metricCards: ChatMetricCard[]
  comparisonTable: {
    columns: Array<{ key: string; label: string }>
    rows: Array<Record<string, string | number | null>>
    insufficientReason?: string
  }
  charts: Array<{
    type: 'line_chart' | 'drawdown_chart'
    title: string
    xAxisType: 'time' | 'category'
    yAxisLabel: string
    series: Array<{ name: string; data: Array<[string, number | null]> }>
  }>
  dataQualitySummary?: Record<string, unknown>
  evidenceRefs: string[]
  blockedReasons: string[]
  notTradingAdvice: true
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
  structuredResult?: ChatStructuredResult
  dataQualitySummary?: Record<string, unknown>
  toolAudit?: Record<string, unknown>
  prohibitedActions: string[]
  agentCore: {
    provider: string
    mode: string
    runtimeAvailable: boolean
    nodeVersion: string
    llm?: {
      provider?: string
      configured?: boolean
      keySource?: string | null
      model?: string
      plannerAvailable?: boolean
      plannerMode?: string
      secretsRedacted?: boolean
    }
    note: string
  }
  notTradingAdvice: true
}

type ChatError = {
  title: string
  description: string
  recoveryActions: string[]
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  response?: ChatResponse
  error?: ChatError
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

type DataHealthState = {
  status: 'ok' | 'warning' | 'critical'
  title: string
  description: string
  recoveryActions: string[]
}

const CHAT_SESSION_STORAGE_KEY = 'fams.chat.conversationId'

const welcomeTaskCards = [
  {
    id: 'portfolio_compare',
    title: '对比组合策略',
    description: '比较永久组合与全天候组合最近三年收益、最大回撤和曲线。',
    prompt: '对比永久组合和全天候组合最近三年的收益和最大回撤并画图',
    icon: <BarChartOutlined />,
    tone: 'blue',
  },
  {
    id: 'dividend_low_vol',
    title: '看红利低波候选',
    description: '找出当前红利低波前三候选，并解释为什么只是研究候选。',
    prompt: '帮我看红利低波前三只候选',
    icon: <FileSearchOutlined />,
    tone: 'green',
  },
  {
    id: 'trade_blocker',
    title: '解释为什么不能交易',
    description: '查看 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 被阻断的原因。',
    prompt: '为什么不能下单',
    icon: <SafetyCertificateOutlined />,
    tone: 'amber',
  },
  {
    id: 'operation_status',
    title: '查看任务和审计',
    description: '检查最近任务状态、失败原因和可追溯的审计证据。',
    prompt: '查看最近任务状态',
    icon: <DatabaseOutlined />,
    tone: 'slate',
  },
  {
    id: 'single_symbol_zone',
    title: '解释单票观察区间',
    description: '用 600887 示例查看买入观察区、卖出观察区和价格可信度。',
    prompt: '600887 现在处于什么买卖观察区间',
    icon: <QuestionCircleOutlined />,
    tone: 'purple',
  },
]

declare global {
  interface WindowEventMap {
    'fams-chat:ask': CustomEvent<{ message?: string; autoSend?: boolean }>
  }
}

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

function normalizeChatError(error: unknown): ChatError {
  const raw = error instanceof Error ? error.message : String(error)
  const status = raw.match(/HTTP\s+(\d+)/)?.[1]
  if (status) {
    return {
      title: 'ChatBox 暂时无法完成请求',
      description: `后端返回 ${status}。这通常表示服务未启动、数据接口不可用，或当前请求被系统保护规则拒绝。`,
      recoveryActions: ['确认后端服务已启动', '稍后重试当前问题', '打开任务中心查看最近失败原因'],
    }
  }
  return {
    title: 'ChatBox 请求失败',
    description: raw || '未知错误。系统没有返回可用的业务结果。',
    recoveryActions: ['重试当前问题', '确认网络与后端服务状态', '在任务中心查看审计记录'],
  }
}

function metricColor(status?: ChatMetricCard['status']) {
  if (status === 'good') return 'border-emerald-200 bg-emerald-50 text-emerald-950'
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-950'
  if (status === 'blocked') return 'border-red-200 bg-red-50 text-red-950'
  return 'border-slate-200 bg-white text-slate-950'
}

function inferDataHealth(response?: ChatResponse, error?: ChatError): DataHealthState {
  if (error) {
    return {
      status: 'critical',
      title: error.title,
      description: error.description,
      recoveryActions: error.recoveryActions,
    }
  }
  if (!response) {
    return {
      status: 'warning',
      title: '等待业务结果',
      description: '还没有可用于判断的数据证据。',
      recoveryActions: ['选择一个任务卡开始查询'],
    }
  }
  const dataQuality = response.dataQualitySummary || response.structuredResult?.dataQualitySummary || {}
  const serialized = JSON.stringify({ dataQuality, blockedReasons: response.blockedReasons }).toLowerCase()
  if (response.blockedReasons.length || /insufficient|missing|failed|critical|blocked|unavailable/.test(serialized)) {
    return {
      status: 'warning',
      title: '数据或规则存在限制',
      description: '本次结果包含阻断原因、数据不足或验证限制。系统会保留研究结果，但不会升级为正式交易动作。',
      recoveryActions: ['查看证据详情', '打开对应专家页复核完整指标', '不要把本结果当作正式交易指令'],
    }
  }
  return {
    status: 'ok',
    title: '数据可用于研究展示',
    description: '本次结果包含结构化指标或审计证据；仍然只用于研究、比较和人工计划草案。',
    recoveryActions: ['查看关键数字', '打开专家页查看完整证据'],
  }
}

function splitReply(reply: string) {
  const lines = reply.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  return {
    conclusion: lines[0] || reply || '已完成查询。',
    details: lines.slice(1),
  }
}

function chartOption(chart: ChatStructuredResult['charts'][number]) {
  return {
    backgroundColor: 'transparent',
    color: ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#64748b'],
    tooltip: { trigger: 'axis' },
    grid: { left: 44, right: 12, top: 34, bottom: 28 },
    legend: { top: 0, textStyle: { color: '#475569', fontSize: 10 } },
    xAxis: { type: chart.xAxisType === 'time' ? 'time' : 'category', axisLabel: { color: '#64748b', fontSize: 10 }, axisLine: { lineStyle: { color: '#cbd5e1' } } },
    yAxis: { type: 'value', name: chart.yAxisLabel, nameTextStyle: { color: '#64748b', fontSize: 10 }, axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
    series: chart.series.map((series) => ({
      name: series.name,
      type: 'line',
      showSymbol: false,
      smooth: true,
      data: series.data,
    })),
  }
}

function WelcomeTaskBoard({ onSelect, disabled }: { onSelect: (prompt: string) => void; disabled: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">今天先看什么</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            普通用户从这里开始；资深用户仍可打开左侧专家模块查看完整证据。
          </div>
        </div>
        <Tag color="blue">ChatBox 第一入口</Tag>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {welcomeTaskCards.map((task) => (
          <button
            key={task.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(task.prompt)}
            className="group rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-blue-600 shadow-sm">
                {task.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-950">{task.title}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{task.description}</span>
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function DataHealthNotice({ health }: { health: DataHealthState }) {
  const alertType = health.status === 'ok' ? 'success' : health.status === 'critical' ? 'error' : 'warning'
  return (
    <Alert
      className="mt-3"
      type={alertType}
      showIcon
      message={health.title}
      description={(
        <div className="space-y-2">
          <div>{health.description}</div>
          {health.recoveryActions.length ? (
            <div className="flex flex-wrap gap-1">
              {health.recoveryActions.map((action) => (
                <Tag key={action}>{action}</Tag>
              ))}
            </div>
          ) : null}
        </div>
      )}
    />
  )
}

function StructuredResultRenderer({ result }: { result: ChatStructuredResult }) {
  const table = result.comparisonTable
  return (
    <div className="mt-3 space-y-3">
      {result.metricCards.length ? (
        <div className="grid grid-cols-2 gap-2">
          {result.metricCards.map((metric) => (
            <div key={`${metric.label}-${metric.value}`} className={`rounded-lg border px-3 py-2 ${metricColor(metric.status)}`}>
              <div className="text-[11px] text-slate-500">{metric.label}</div>
              <div className="mt-1 break-words text-sm font-semibold">{metric.value ?? 'n/a'}{metric.unit || ''}</div>
              {metric.description ? <div className="mt-1 text-[11px] leading-4 text-slate-500">{metric.description}</div> : null}
            </div>
          ))}
        </div>
      ) : null}

      {table?.rows?.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {table.columns.map((column) => (
                  <th key={column.key} className="whitespace-nowrap px-2 py-2 font-medium">{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index} className="border-t border-slate-100">
                  {table.columns.map((column) => (
                    <td key={column.key} className="whitespace-nowrap px-2 py-2 text-slate-700">{row[column.key] ?? '-'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : table?.insufficientReason ? (
        <Alert type="warning" showIcon message="表格数据不足" description={table.insufficientReason} />
      ) : null}

      {result.charts.map((chart) => (
        <div key={`${chart.type}-${chart.title}`} className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="mb-1 text-xs font-medium text-slate-700">{chart.title}</div>
          <ReactECharts option={chartOption(chart)} style={{ height: 220, width: '100%' }} notMerge lazyUpdate />
        </div>
      ))}
    </div>
  )
}

function ActionCardList({ cards, loading, onCardClick }: {
  cards: ChatActionCard[]
  loading: boolean
  onCardClick: (card: ChatActionCard) => void
}) {
  if (!cards.length) return null
  return (
    <Space direction="vertical" size={8} className="mt-3 w-full">
      {cards.map((card) => (
        <Card
          key={card.id}
          size="small"
          className="border-slate-200 bg-white"
          styles={{ body: { padding: 10 } }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Text strong className="text-slate-950">{card.title}</Text>
              <Paragraph className="!mb-0 mt-1 text-xs text-slate-500">{card.description}</Paragraph>
            </div>
            <Button
              size="small"
              icon={card.type === 'tool_confirmation' ? <CheckCircleOutlined /> : <LinkOutlined />}
              danger={card.type === 'blocked'}
              disabled={card.type === 'blocked' || loading}
              onClick={() => onCardClick(card)}
            >
              {card.type === 'tool_confirmation' ? '确认执行' : card.type === 'blocked' ? '已阻断' : '打开'}
            </Button>
          </div>
        </Card>
      ))}
    </Space>
  )
}

function AgentStatusDetails({ response }: { response?: ChatResponse }) {
  if (!response) return null
  const items = [
    {
      key: 'agent',
      label: '技术与审计详情',
      children: (
        <div className="space-y-2 text-xs leading-5 text-slate-600">
          <div>Intent：{response.intent}｜Confidence：{Math.round(response.confidence * 100)}%</div>
          <div>AgentCore：{response.agentCore.provider}｜模式：{response.agentCore.mode}｜Runtime：{response.agentCore.runtimeAvailable ? '可用' : '未确认'}</div>
          {response.agentCore.llm ? (
            <div>
              LLM：{response.agentCore.llm.configured ? `${response.agentCore.llm.provider || '-'} / ${response.agentCore.llm.model || '-'}` : '未配置'}｜
              Planner：{response.agentCore.llm.plannerAvailable ? response.agentCore.llm.plannerMode || '可用' : 'deterministic fallback'}｜
              Key：{response.agentCore.llm.keySource || '无'}（已脱敏）
            </div>
          ) : null}
          {response.artifactRefs.length ? <div>Artifact：{response.artifactRefs.join('，')}</div> : null}
          {response.structuredResult?.evidenceRefs?.length ? <div>Evidence：{response.structuredResult.evidenceRefs.slice(0, 8).join('，')}</div> : null}
          <div>禁止动作：{response.prohibitedActions.join(' / ')}</div>
        </div>
      ),
    },
  ]
  return <Collapse ghost size="small" className="mt-2" items={items} />
}

function AssistantMessage({
  item,
  loading,
  onCardClick,
  onRetry,
}: {
  item: ChatMessage
  loading: boolean
  onCardClick: (card: ChatActionCard) => void
  onRetry: (text: string) => void
}) {
  const { conclusion, details } = splitReply(item.text)
  const health = inferDataHealth(item.response, item.error)
  const blockedReasons = item.response?.blockedReasons || []
  const nextActions = item.response?.actionCards?.length
    ? item.response.actionCards.map((card) => card.title)
    : item.error?.recoveryActions || ['继续追问', '打开相关专家页复核']

  return (
    <div className="max-w-[94%] rounded-xl border border-slate-200 bg-white px-3 py-3 text-slate-800 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <RobotOutlined />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-slate-500">结论</div>
          <Paragraph className="!mb-0 mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-900">{conclusion}</Paragraph>
          {details.length ? (
            <div className="mt-2 rounded-lg bg-slate-50 p-2">
              <div className="text-xs font-medium text-slate-500">关键数字 / 说明</div>
              <ul className="mb-0 mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-600">
                {details.slice(0, 6).map((line) => <li key={line}>{line}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="mt-2 rounded-lg bg-blue-50 p-2">
            <div className="text-xs font-medium text-blue-800">下一步</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {nextActions.slice(0, 4).map((action) => <Tag key={action} color="blue">{action}</Tag>)}
            </div>
          </div>
          {blockedReasons.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {blockedReasons.map((reason) => (
                <Tag key={reason} color="red">{reason}</Tag>
              ))}
            </div>
          ) : null}
          <DataHealthNotice health={health} />
          {item.response?.structuredResult ? (
            <StructuredResultRenderer result={item.response.structuredResult} />
          ) : null}
          <ActionCardList cards={item.response?.actionCards || []} loading={loading} onCardClick={onCardClick} />
          <AgentStatusDetails response={item.response} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                void navigator.clipboard?.writeText(item.text)
                antdMessage.success('已复制回复')
              }}
            >
              复制
            </Button>
            <Button size="small" icon={<ThunderboltOutlined />} onClick={() => onRetry(item.text)} disabled={loading}>
              继续追问
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function FamsChatBox() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string>()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '我是 FAMS 业务助手。你可以直接问组合回测、红利低波、任务状态和交易阻断；涉及扫描、刷新、草案会先让你确认。',
    },
  ])
  const [loading, setLoading] = useState(false)

  const latestAgentCore = useMemo(() => {
    const latest = [...messages].reverse().find((item) => item.response?.agentCore)
    return latest?.response?.agentCore
  }, [messages])

  const sendMessage = useCallback(async (text?: string) => {
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
    } catch (error) {
      const chatError = normalizeChatError(error)
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          text: `${chatError.title}：${chatError.description}`,
          error: chatError,
        },
      ])
    } finally {
      setLoading(false)
    }
  }, [conversationId, input, loading])

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

  useEffect(() => {
    const handler = (event: WindowEventMap['fams-chat:ask']) => {
      const message = event.detail?.message?.trim()
      setOpen(true)
      if (!message) return
      if (event.detail?.autoSend) {
        void sendMessage(message)
      } else {
        setInput(message)
      }
    }
    window.addEventListener('fams-chat:ask', handler)
    return () => window.removeEventListener('fams-chat:ask', handler)
  }, [sendMessage])

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
    } catch (error) {
      const chatError = normalizeChatError(error)
      setMessages((current) => [
        ...current,
        {
          id: `confirm-error-${Date.now()}`,
          role: 'assistant',
          text: `${chatError.title}：${chatError.description}`,
          error: chatError,
        },
      ])
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
        width="min(760px, calc(100vw - 16px))"
        open={open}
        onClose={() => setOpen(false)}
        styles={{ body: { padding: 16, background: '#f8fafc' }, header: { background: '#ffffff', borderBottomColor: '#e2e8f0' } }}
      >
        <div className="flex h-full min-h-0 flex-col gap-3 text-slate-900">
          <Alert
            type="info"
            showIcon
            icon={<SafetyCertificateOutlined />}
            message="ChatBox 不创建订单"
            description="允许研究、观察、比较、提醒和人工计划草案；正式 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 始终受交易 gate 阻断。"
          />

          <WelcomeTaskBoard onSelect={(prompt) => sendMessage(prompt)} disabled={loading} />

          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-3">
            <Space direction="vertical" size={12} className="w-full">
              {messages.map((item) => (
                <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {item.role === 'user' ? (
                    <div className="max-w-[88%] rounded-xl bg-blue-600 px-3 py-2 text-white shadow-sm">
                      <Paragraph className="!mb-0 whitespace-pre-wrap text-inherit">{item.text}</Paragraph>
                    </div>
                  ) : (
                    <AssistantMessage
                      item={item}
                      loading={loading}
                      onCardClick={handleCardClick}
                      onRetry={(text) => setInput(`继续解释：${text.slice(0, 120)}`)}
                    />
                  )}
                </div>
              ))}
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Spin size="small" />
                  正在调用白名单工具并生成结构化结果...
                </div>
              ) : null}
            </Space>
          </div>

          <Space.Compact className="w-full">
            <Input.TextArea
              value={input}
              autoSize={{ minRows: 1, maxRows: 3 }}
              placeholder="例如：帮我对比永久组合和全天候组合最近三年"
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

          <div className="rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-500">
            AgentCore：{latestAgentCore?.provider || 'pi-agent-core'}｜
            模式：{latestAgentCore?.mode || 'deterministic_planner'}｜
            Runtime：{latestAgentCore?.runtimeAvailable === false ? '未确认' : '可用'}。
            {latestAgentCore?.llm ? (
              <>
                <br />
                LLM：{latestAgentCore.llm.configured ? `${latestAgentCore.llm.provider || '-'} / ${latestAgentCore.llm.model || '-'}` : '未配置'}｜
                Planner：{latestAgentCore.llm.plannerAvailable ? latestAgentCore.llm.plannerMode || '可用' : 'deterministic fallback'}｜
                Key：{latestAgentCore.llm.keySource || '无'}（已脱敏）
              </>
            ) : null}
            技术细节会在每条回复下方折叠展示。
          </div>
        </div>
      </Drawer>
    </>
  )
}
