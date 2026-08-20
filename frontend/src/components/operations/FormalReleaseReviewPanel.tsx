import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Descriptions, Input, Select, Space, Tag, message } from 'antd'
import axios from 'axios'

const TOKEN_KEY = 'fams.ftr.reviewer.jwt'
const ROLES = ['data', 'model', 'risk', 'compliance', 'final_release'] as const
type ReviewerRole = typeof ROLES[number]

interface ReviewerContext {
  userId: string
  email: string
  roles: ReviewerRole[]
}

interface RunReview {
  operation: { id: string; status: string; artifactRefs: string[] }
  manifestHash: string
  signoffAudit: {
    status: 'missing' | 'partial' | 'passed'
    records: Array<{ role: ReviewerRole; status: 'missing' | 'blocked' | 'approved'; reviewerEmail: string | null; reviewedAt: string | null; blockers: string[] }>
    blockers: string[]
  }
  releaseApprovalStatus: 'pending_human_approval'
  productionAdapterEnabled: false
  formalTradingUnlocked: false
  orderCreateAllowed: false
}

export default function FormalReleaseReviewPanel({ operationId: suggestedOperationId }: { operationId?: string | null }) {
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '')
  const [operationId, setOperationId] = useState(suggestedOperationId || '')
  const [context, setContext] = useState<ReviewerContext | null>(null)
  const [run, setRun] = useState<RunReview | null>(null)
  const [role, setRole] = useState<ReviewerRole>('data')
  const [notes, setNotes] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (suggestedOperationId) setOperationId(suggestedOperationId)
  }, [suggestedOperationId])

  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token])

  const connect = async () => {
    if (!token.trim()) return message.warning('请粘贴审阅人 JWT')
    setLoading(true)
    try {
      sessionStorage.setItem(TOKEN_KEY, token.trim())
      const response = await axios.get('/api/v1/formal-release/reviewer-context', { headers })
      setContext(response.data.reviewer)
      setRole(response.data.reviewer.roles[0])
      message.success('审阅人身份已验证，仅保存在当前浏览器会话')
    } catch (error: any) {
      setContext(null)
      message.error(error?.response?.data?.message || '审阅人身份验证失败')
    } finally {
      setLoading(false)
    }
  }

  const disconnect = () => {
    sessionStorage.removeItem(TOKEN_KEY)
    setToken('')
    setContext(null)
    setRun(null)
  }

  const loadRun = async () => {
    if (!operationId.trim()) return message.warning('请输入组合回测 Operation ID')
    setLoading(true)
    try {
      const response = await axios.get(`/api/v1/formal-release/runs/${encodeURIComponent(operationId.trim())}`, { headers })
      setRun(response.data)
    } catch (error: any) {
      message.error(error?.response?.data?.message || '正式发布评审记录加载失败')
    } finally {
      setLoading(false)
    }
  }

  const submitSignoff = async (decision: 'approved' | 'rejected') => {
    if (!run) return
    if (!notes.trim()) return message.warning('请填写签核意见')
    setLoading(true)
    try {
      await axios.post(`/api/v1/formal-release/runs/${encodeURIComponent(run.operation.id)}/signoffs`, {
        role,
        decision,
        notes: notes.trim(),
        manifestHash: run.manifestHash,
      }, { headers })
      message.success(decision === 'approved' ? '签核已追加到不可变审计链' : '打回记录已追加到不可变审计链')
      setNotes('')
      await loadRun()
    } catch (error: any) {
      message.error(error?.response?.data?.message || '签核提交失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card title="Formal Release 人工评审" className="bg-[#1a1a2e] border-surface-border">
      <Alert
        type="warning"
        showIcon
        message="评审就绪不等于交易放行"
        description="该工作台只记录数据、模型、风控、合规和最终发布签核。生产适配器、订单创建和自动交易始终保持关闭。"
        className="mb-4"
      />
      <Space direction="vertical" className="w-full" size="middle">
        <Space.Compact className="w-full">
          <Input.Password value={token} onChange={(event) => setToken(event.target.value)} placeholder="审阅人 JWT（仅保存在 sessionStorage）" />
          <Button type="primary" loading={loading} onClick={connect}>验证身份</Button>
          <Button onClick={disconnect}>清除会话</Button>
        </Space.Compact>
        {context && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-300">
            <span>{context.email}</span>
            {context.roles.map((item) => <Tag key={item} color="blue">{item}</Tag>)}
          </div>
        )}
        <Space.Compact className="w-full">
          <Input value={operationId} onChange={(event) => setOperationId(event.target.value)} placeholder="组合回测 Operation ID" />
          <Button loading={loading} disabled={!context} onClick={loadRun}>加载评审包</Button>
        </Space.Compact>
        {run && (
          <>
            <Descriptions size="small" column={{ xs: 1, md: 2 }}>
              <Descriptions.Item label="Operation">{run.operation.id}</Descriptions.Item>
              <Descriptions.Item label="签核状态"><Tag color={run.signoffAudit.status === 'passed' ? 'green' : 'orange'}>{run.signoffAudit.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="Manifest Hash"><span className="break-all font-mono text-xs">{run.manifestHash}</span></Descriptions.Item>
              <Descriptions.Item label="发布审批">{run.releaseApprovalStatus}</Descriptions.Item>
              <Descriptions.Item label="生产适配器"><Tag color="red">disabled</Tag></Descriptions.Item>
              <Descriptions.Item label="订单创建"><Tag color="red">blocked</Tag></Descriptions.Item>
            </Descriptions>
            <div className="grid gap-2 md:grid-cols-5">
              {run.signoffAudit.records.map((record) => (
                <div key={record.role} className="rounded border border-white/10 p-2 text-xs text-gray-300">
                  <div className="mb-1 font-medium text-white">{record.role}</div>
                  <Tag color={record.status === 'approved' ? 'green' : record.status === 'blocked' ? 'red' : 'default'}>{record.status}</Tag>
                  {record.reviewerEmail && <div className="mt-1 break-all">{record.reviewerEmail}</div>}
                </div>
              ))}
            </div>
            <Space.Compact className="w-full">
              <Select value={role} onChange={setRole} options={(context?.roles || []).map((item) => ({ value: item, label: item }))} className="min-w-32" />
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="签核或打回意见（必填）" />
              <Button type="primary" loading={loading} onClick={() => submitSignoff('approved')}>签核</Button>
              <Button danger loading={loading} onClick={() => submitSignoff('rejected')}>打回</Button>
            </Space.Compact>
          </>
        )}
      </Space>
    </Card>
  )
}
