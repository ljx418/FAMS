import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Empty,
  Segmented,
  Select,
  Space,
  Spin,
  Switch,
  Tag,
  TimePicker,
  message,
} from 'antd'
import dayjs from 'dayjs'
import {
  CheckCircleOutlined,
  ExportOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { API_BASE } from '../config/api'

const USER_ID = 'default'

type WorkflowConfig = {
  workflowKey: string
  profileVersion: string
  contractHash: string
  contract: {
    title: string
    actualAllocationContract: { id: string; role: string; weights: Record<string, number> }
    researchComparisonContract: { id: string; role: string; weights: Record<string, number>; driftThresholdPercentagePoints: number }
  }
  scheduler: { enabled: boolean; timezone: string; slots: string[]; catchUpMinutes: number }
  snapshotAuthorization: {
    valid: boolean
    blockers: string[]
    captureId?: string
    latestCaptureId?: string | null
    authorizedAt?: string
    expiresAt?: string
    status?: string
  }
  lastRunAt: string | null
}

type ComparisonRun = {
  operationId: string
  status: string
  requestedAt: string
  completedAt?: string | null
  createdBy: string
  summary?: {
    period?: { startDate?: string; endDate?: string; tradingDays?: number }
    mainMetrics?: { annualizedReturnPercent?: number; monthlyMaxDrawdownPercent?: number }
    sourceHash?: string
  } | null
  errorSummary?: string | null
}

type RunHistory = { runs: ComparisonRun[] }
type ReviewSession = 'open' | 'pre_close' | 'manual'

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const readable = Array.isArray(payload?.blockers)
      ? payload.blockers.join('、')
      : payload?.message || payload?.error || `HTTP ${response.status}`
    throw new Error(readable)
  }
  return payload as T
}

const formatDateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value))
  : '尚未运行'

const formatPercent = (value?: number | null) => value === null || value === undefined
  ? '—'
  : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`

const authorizationBlocker: Record<string, string> = {
  snapshot_reuse_not_authorized: '尚未授权复用最近确认的持仓截图',
  snapshot_reuse_authorization_expired: '截图复用授权已超过7天',
  snapshot_reuse_capture_changed: '检测到更新的持仓截图，需要重新授权',
  confirmed_alipay_portfolio_capture_required: '尚无已确认的支付宝持仓截图',
  strict_llm_unavailable: '严格摘要模型不可用',
}

const readableError = (value: string) => value.split('、').map((item) => authorizationBlocker[item] || item).join('；')

export default function PortfolioComparison() {
  const [config, setConfig] = useState<WorkflowConfig>()
  const [runs, setRuns] = useState<ComparisonRun[]>([])
  const [selectedOperationId, setSelectedOperationId] = useState<string>()
  const [refreshKey, setRefreshKey] = useState(0)
  const [loading, setLoading] = useState(true)
  const [runLoading, setRunLoading] = useState(false)
  const [configLoading, setConfigLoading] = useState(false)
  const [authLoading, setAuthLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [session, setSession] = useState<ReviewSession>('manual')
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [slots, setSlots] = useState(['09:40', '14:40'])

  const reportPath = selectedOperationId
    ? `/api/v1/portfolio-backtest/alipay-comparison/runs/${encodeURIComponent(selectedOperationId)}/report?userId=${USER_ID}`
    : undefined
  const reportUrl = useMemo(() => reportPath ? `${reportPath}&refresh=${refreshKey}` : undefined, [reportPath, refreshKey])

  const loadState = useCallback(async (preferLatest = false) => {
    setLoading(true)
    setError(undefined)
    try {
      const [nextConfig, history] = await Promise.all([
        apiJson<WorkflowConfig>(`/api/v1/daily-reviews/alipay-research-workflow/config?userId=${USER_ID}`),
        apiJson<RunHistory>(`/api/v1/portfolio-backtest/alipay-comparison/runs?userId=${USER_ID}&limit=30`),
      ])
      setConfig(nextConfig)
      setScheduleEnabled(nextConfig.scheduler.enabled)
      setSlots(nextConfig.scheduler.slots)
      setRuns(history.runs)
      setSelectedOperationId((current) => {
        if (preferLatest || !current || !history.runs.some((item) => item.operationId === current)) {
          return history.runs.find((item) => ['completed', 'partial'].includes(item.status))?.operationId
        }
        return current
      })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void loadState() }, [loadState])

  const saveSchedule = async () => {
    setConfigLoading(true)
    setError(undefined)
    try {
      const nextConfig = await apiJson<WorkflowConfig>('/api/v1/daily-reviews/alipay-research-workflow/config', {
        method: 'PUT',
        body: JSON.stringify({ userId: USER_ID, schedulerEnabled: scheduleEnabled, slots }),
      })
      setConfig(nextConfig)
      setScheduleEnabled(nextConfig.scheduler.enabled)
      setSlots(nextConfig.scheduler.slots)
      message.success(nextConfig.scheduler.enabled ? '定时分析已启用' : '定时分析保持关闭')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setConfigLoading(false)
    }
  }

  const authorizeSnapshot = async () => {
    setAuthLoading(true)
    setError(undefined)
    try {
      const nextConfig = await apiJson<WorkflowConfig>('/api/v1/daily-reviews/alipay-research-workflow/snapshot-authorization', {
        method: 'POST',
        body: JSON.stringify({ userId: USER_ID }),
      })
      setConfig(nextConfig)
      message.success('已授权未来7天复用当前最新的已确认截图')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setAuthLoading(false)
    }
  }

  const revokeSnapshot = async () => {
    setAuthLoading(true)
    try {
      const nextConfig = await apiJson<WorkflowConfig>('/api/v1/daily-reviews/alipay-research-workflow/snapshot-authorization/revoke', {
        method: 'POST',
        body: JSON.stringify({ userId: USER_ID, reason: 'portfolio_changed_by_user' }),
      })
      setConfig(nextConfig)
      message.info('已撤销截图复用授权；下次运行前需要更新并确认截图')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setAuthLoading(false)
    }
  }

  const runWorkflow = async () => {
    setRunLoading(true)
    setError(undefined)
    try {
      const result = await apiJson<any>('/api/v1/daily-reviews/alipay-research-workflow/run', {
        method: 'POST',
        body: JSON.stringify({
          userId: USER_ID,
          sessionType: session,
          idempotencyKey: `ui:${USER_ID}:${new Date().toISOString().slice(0, 16)}`,
        }),
      })
      if (!result.started) throw new Error((result.blockers || ['workflow_not_started']).join('、'))
      const operationId = result.comparison?.operation?.id
      await loadState(true)
      if (operationId) setSelectedOperationId(operationId)
      setRefreshKey(Date.now())
      message.success('完整分析和组合对比已保存')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setRunLoading(false)
    }
  }

  const quickResearchRun = async () => {
    setRunLoading(true)
    setError(undefined)
    try {
      const result = await apiJson<{ operationId: string }>('/api/v1/portfolio-backtest/alipay-comparison/run', {
        method: 'POST',
        body: JSON.stringify({ userId: USER_ID, idempotencyKey: `ui-research:${USER_ID}:${Date.now()}` }),
      })
      await loadState(true)
      setSelectedOperationId(result.operationId)
      setRefreshKey(Date.now())
      message.success('组合研究已使用真实数据重新计算并保存')
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError))
    } finally {
      setRunLoading(false)
    }
  }

  const selectedRun = runs.find((item) => item.operationId === selectedOperationId)
  const snapshotValid = Boolean(config?.snapshotAuthorization.valid)

  return (
    <div className="flex min-h-[calc(100vh-7rem)] min-w-0 flex-col gap-4">
      <Card className="border-slate-200 shadow-sm" styles={{ body: { padding: 18 } }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-3xl">
            <div className="text-xs font-bold tracking-[0.14em] text-blue-700">固定分析工作流</div>
            <h1 className="mb-1 mt-1 text-2xl font-bold text-slate-950">支付宝完整分析与持仓组合对比</h1>
            <p className="m-0 text-sm leading-6 text-slate-600">一次运行会完成截图前检、真实行情与均线/轮动刷新、持仓和历史交易约束、手工调仓草案、十组组合回测及简明摘要，并保存可追溯结果。</p>
          </div>
          <Space wrap>
            <Segmented<ReviewSession>
              value={session}
              onChange={setSession}
              options={[{ label: '开盘后', value: 'open' }, { label: '收盘前', value: 'pre_close' }, { label: '手动', value: 'manual' }]}
            />
            <Button size="large" type="primary" icon={<PlayCircleOutlined />} loading={runLoading} disabled={!snapshotValid} onClick={runWorkflow}>运行完整分析</Button>
          </Space>
        </div>
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message="安全边界：系统只做研究、观察、比较和手工计划草案"
          description="不会修改持仓、写入交易记录、创建订单或自动交易。2026年高防御10/15/50/25是当前手工调仓合同；10/25/40/25只用于研究对比，二者不会合并。"
        />
      </Card>

      {error ? <Alert closable onClose={() => setError(undefined)} type="error" showIcon message="操作未完成" description={readableError(error)} /> : null}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={<span><SafetyCertificateOutlined className="mr-2 text-blue-700" />截图复用授权</span>} className="border-slate-200 shadow-sm">
          {loading ? <Spin /> : snapshotValid ? (
            <Space direction="vertical" size={10} className="w-full">
              <Tag color="success" icon={<CheckCircleOutlined />}>可运行</Tag>
              <div className="text-sm text-slate-600">已绑定最新确认截图；有效期至 {formatDateTime(config?.snapshotAuthorization.expiresAt)}</div>
              <Button danger loading={authLoading} onClick={revokeSnapshot}>持仓有变化，撤销授权</Button>
            </Space>
          ) : (
            <Space direction="vertical" size={10} className="w-full">
              <Tag color="warning">需要确认</Tag>
              <div className="text-sm leading-6 text-slate-600">{(config?.snapshotAuthorization.blockers || []).map((item) => authorizationBlocker[item] || item).join('；') || '请授权复用最近确认的持仓截图。'}</div>
              <Space wrap><Button type="primary" loading={authLoading} onClick={authorizeSnapshot}>授权复用7天</Button><Button href="/daily-reviews">去更新截图</Button></Space>
            </Space>
          )}
        </Card>

        <Card title="自动运行（默认关闭）" className="border-slate-200 shadow-sm">
          <Space direction="vertical" size={12} className="w-full">
            <div className="flex items-center justify-between"><span className="text-sm text-slate-700">工作日定时分析</span><Switch checked={scheduleEnabled} onChange={setScheduleEnabled} checkedChildren="开" unCheckedChildren="关" /></div>
            <div className="grid grid-cols-2 gap-2">
              <TimePicker aria-label="第一个运行时间" className="w-full" format="HH:mm" minuteStep={5} allowClear={false} value={dayjs(`2026-01-01T${slots[0] || '09:40'}`)} onChange={(value) => setSlots([value.format('HH:mm'), slots[1] || '14:40'])} />
              <TimePicker aria-label="第二个运行时间" className="w-full" format="HH:mm" minuteStep={5} allowClear={false} value={dayjs(`2026-01-01T${slots[1] || '14:40'}`)} onChange={(value) => setSlots([slots[0] || '09:40', value.format('HH:mm')])} />
            </div>
            <div className="text-xs leading-5 text-slate-500">Asia/Shanghai；默认 09:40 / 14:40。只有截图授权有效且完整前检通过时才运行。</div>
            <Button loading={configLoading} onClick={saveSchedule}>保存定时设置</Button>
          </Space>
        </Card>

        <Card title={<span><HistoryOutlined className="mr-2 text-blue-700" />版本和最近运行</span>} className="border-slate-200 shadow-sm">
          <Space direction="vertical" size={10} className="w-full">
            <div className="text-sm text-slate-600">工作流版本 <Tag>{config?.profileVersion || '—'}</Tag></div>
            <div className="text-sm text-slate-600">最近运行：{formatDateTime(config?.lastRunAt)}</div>
            <div className="text-xs break-all text-slate-400">合同校验：{config?.contractHash?.slice(0, 16) || '—'}…</div>
            <Button icon={<ReloadOutlined />} loading={runLoading} onClick={quickResearchRun}>仅重算组合研究</Button>
          </Space>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm" styles={{ body: { padding: 14 } }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-[260px] flex-1">
            <div className="mb-1 text-xs font-semibold text-slate-500">已持久化的组合研究运行</div>
            <Select
              className="w-full max-w-3xl"
              loading={loading}
              placeholder="请选择运行记录"
              value={selectedOperationId}
              onChange={(value) => { setSelectedOperationId(value); setRefreshKey(Date.now()) }}
              options={runs.filter((item) => ['completed', 'partial'].includes(item.status)).map((item) => ({
                value: item.operationId,
                label: `${formatDateTime(item.completedAt || item.requestedAt)} · ${item.createdBy === 'scheduler' ? '定时' : '手动'} · 年化 ${formatPercent(item.summary?.mainMetrics?.annualizedReturnPercent)} · 月回撤 ${formatPercent(item.summary?.mainMetrics?.monthlyMaxDrawdownPercent)}`,
              }))}
            />
          </div>
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => setRefreshKey(Date.now())} disabled={!reportUrl}>刷新报告</Button>
            <Button type="primary" icon={<ExportOutlined />} disabled={!reportPath} onClick={() => reportPath && window.open(reportPath, '_blank', 'noopener,noreferrer')}>独立打开HTML</Button>
          </Space>
        </div>
        {selectedRun ? <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500"><Tag color={selectedRun.status === 'completed' ? 'success' : 'warning'}>{selectedRun.status}</Tag><span>样本 {selectedRun.summary?.period?.startDate} 至 {selectedRun.summary?.period?.endDate}</span><span>{selectedRun.summary?.period?.tradingDays || 0} 个共同交易日</span><span>数据快照 {selectedRun.summary?.sourceHash?.slice(0, 12)}…</span></div> : null}
      </Card>

      {loading ? (
        <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-slate-200 bg-white"><Spin size="large" /></div>
      ) : reportUrl ? (
        <iframe
          key={`${selectedOperationId}:${refreshKey}`}
          title="支付宝持仓三年组合对比回测"
          src={reportUrl}
          className="min-h-[1200px] w-full flex-1 rounded-xl border border-slate-200 bg-[#eef3f8] shadow-sm"
        />
      ) : (
        <Card className="border-slate-200 shadow-sm"><Empty description="尚无已保存的组合研究"><Button type="primary" loading={runLoading} onClick={quickResearchRun}>使用真实数据生成第一份报告</Button></Empty></Card>
      )}
    </div>
  )
}
