import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Modal,
  Segmented,
  Select,
  Skeleton,
  Statistic,
  Table,
  Tag,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  AuditOutlined,
  CloudDownloadOutlined,
  HistoryOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons'
import { API_BASE } from '../config/api'
import { ScreenshotCapturePanel } from '../components/capture/ScreenshotCapturePanel'
import { DailyReviewWorkflowDag, type ReviewWorkflowEdge, type ReviewWorkflowNode } from '../components/review/DailyReviewWorkflowDag'
import { DailyReviewAuditDrawer } from '../components/review/DailyReviewAuditDrawer'
import { DailyReviewDecisionPanel } from '../components/review/DailyReviewDecisionPanel'
import { colors } from '../styles/chartTheme'

const USER_ID = 'default'
const NODE_REVIEW_STORAGE_PREFIX = 'fams.dailyReview.nodeReviews.v1'

type ReviewSession = 'open' | 'pre_close' | 'manual'
type NodeReviewStatus = 'pending' | 'pass' | 'issue'
type NodeReviewAnnotation = { status: NodeReviewStatus; note: string; updatedAt: string }

type WorkflowNode = ReviewWorkflowNode

type Workflow = {
  schemaVersion: string
  reviewId: string
  reviewStatus: string
  sessionType: string
  reviewGeneratedAt: string
  snapshotCounts: {
    positionSnapshots: number
    marketSnapshots: number
    gridPlans: number
    gridOrderDrafts: number
  }
  captureSummary: {
    confirmedCaptureCount: number
    confirmedRowCount: number
    latestConfirmedAt: string | null
    latestDocumentType: string | null
    latestVisionProvider: string | null
    latestCaptureRef: string | null
  }
  attentionCandidates: Array<Record<string, any>>
  executionBoundary: {
    planDraftOnly: boolean
    formalTradingUnlocked: boolean
    autoTradeUnlocked: boolean
    canCreateOrder: boolean
    orderCreateAllowed: boolean
  }
  nodes: WorkflowNode[]
  edges: ReviewWorkflowEdge[]
}

type ReviewListItem = {
  id: string
  operationId?: string | null
  previousRunId?: string | null
  sessionType: string
  triggerSource: string
  status: string
  generatedAt: string
  completedAt?: string | null
  portfolio?: { totalValue?: number; cashBudget?: number; positions?: number; reviewedAssets?: number } | null
  strategyAssessment?: { status?: string; conclusion?: string } | null
  counts?: { gridPlans?: number; marketSnapshots?: number; positionSnapshots?: number }
}

type ReviewHistory = {
  schemaVersion: string
  items: ReviewListItem[]
  nextCursor?: string | null
  hasMore: boolean
}

type ReviewDetail = ReviewListItem & {
  report: {
    schemaVersion?: string
    reviewId?: string
    generatedAt?: string
    completedAt?: string
    sessionType?: string
    portfolio?: { totalValue?: number; cashBudget?: number; positions?: number; reviewedAssets?: number }
    strategy?: {
      activeStrategyVersionIds?: string[]
      fallback?: string[] | string | null
      assessment?: { status?: string; conclusion?: string; reasons?: string[] }
    }
    assets?: Array<Record<string, any>>
    attentionCandidates?: Array<Record<string, any>>
    decisionSummary?: Record<string, any>
    llmSynthesis?: Record<string, any>
    errors?: Array<{ symbol?: string; message?: string }>
    executionBoundary?: Record<string, boolean>
    disclaimer?: string
  }
  operation?: Record<string, any> | null
  gridPlans?: Array<Record<string, any>>
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`)
  return payload as T
}

const formatDateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'medium', hour12: false }).format(new Date(value))
  : '未记录'

const formatMoney = (value?: number | null) => new Intl.NumberFormat('zh-CN', {
  style: 'currency', currency: 'CNY', maximumFractionDigits: 2,
}).format(Number(value || 0))

const formatNumber = (value?: number | null, digits = 2) => {
  if (value === null || value === undefined) return '—'
  return Number.isFinite(Number(value))
    ? Number(value).toLocaleString('zh-CN', { maximumFractionDigits: digits })
    : '—'
}

const ensureSentenceEnding = (value: string) => /[。！？.!?]$/.test(value) ? value : `${value}。`

const sessionLabel: Record<string, string> = { open: '开盘后', pre_close: '收盘前', manual: '手动' }

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description?: string }) {
  return (
    <div className="mb-4">
      <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-blue-700">{eyebrow}</div>
      <h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">{title}</h2>
      {description ? <p className="mb-0 mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p> : null}
    </div>
  )
}

export default function DailyReviews() {
  const { reviewId } = useParams<{ reviewId?: string }>()
  const navigate = useNavigate()
  const [history, setHistory] = useState<ReviewHistory>({ schemaVersion: '', items: [], hasMore: false })
  const [detail, setDetail] = useState<ReviewDetail>()
  const [workflow, setWorkflow] = useState<Workflow>()
  const [selectedNodeId, setSelectedNodeId] = useState('trigger')
  const [selectedAssetId, setSelectedAssetId] = useState<string>()
  const [session, setSession] = useState<ReviewSession>('manual')
  const [historySession, setHistorySession] = useState<string>('all')
  const [historyStatus, setHistoryStatus] = useState<string>('all')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditFocus, setAuditFocus] = useState<{ symbol?: string; evidenceRefs?: string[] }>({})
  const [loading, setLoading] = useState(true)
  const [runLoading, setRunLoading] = useState(false)
  const [error, setError] = useState<string>()
  const [nodeReviews, setNodeReviews] = useState<Record<string, NodeReviewAnnotation>>({})

  const loadHistory = useCallback(async () => {
    const params = new URLSearchParams({ userId: USER_ID, limit: '50' })
    if (historySession !== 'all') params.set('sessionType', historySession)
    if (historyStatus !== 'all') params.set('status', historyStatus)
    const next = await apiJson<ReviewHistory>(`/api/v1/daily-reviews?${params}`)
    setHistory(next)
    return next
  }, [historySession, historyStatus])

  const loadReview = useCallback(async (id: string) => {
    const [nextDetail, nextWorkflow] = await Promise.all([
      apiJson<ReviewDetail>(`/api/v1/daily-reviews/${encodeURIComponent(id)}?userId=${USER_ID}`),
      apiJson<Workflow>(`/api/v1/daily-reviews/${encodeURIComponent(id)}/workflow?userId=${USER_ID}`),
    ])
    setDetail(nextDetail)
    setWorkflow(nextWorkflow)
    setSelectedNodeId((current) => nextWorkflow.nodes.some((node) => node.id === current) ? current : 'trigger')
    const firstAssetId = nextDetail.report?.assets?.[0]?.assetId
    setSelectedAssetId((current) => nextDetail.report?.assets?.some((asset) => asset.assetId === current) ? current : firstAssetId)
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      const nextHistory = await loadHistory()
      const targetId = reviewId || nextHistory.items[0]?.id
      if (!targetId) {
        setDetail(undefined)
        setWorkflow(undefined)
        return
      }
      await loadReview(targetId)
      if (!reviewId) navigate(`/daily-reviews/${targetId}`, { replace: true })
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '读取每日复盘失败')
    } finally {
      setLoading(false)
    }
  }, [loadHistory, loadReview, navigate, reviewId])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!workflow?.reviewId) {
      setNodeReviews({})
      return
    }
    try {
      const stored = window.localStorage.getItem(`${NODE_REVIEW_STORAGE_PREFIX}:${workflow.reviewId}`)
      setNodeReviews(stored ? JSON.parse(stored) as Record<string, NodeReviewAnnotation> : {})
    } catch {
      setNodeReviews({})
    }
  }, [workflow?.reviewId])

  const updateNodeReview = (nodeId: string, patch: Partial<Pick<NodeReviewAnnotation, 'status' | 'note'>>) => {
    if (!workflow?.reviewId) return
    setNodeReviews((current) => {
      const existing = current[nodeId] || { status: 'pending' as const, note: '', updatedAt: new Date().toISOString() }
      const next = { ...current, [nodeId]: { ...existing, ...patch, updatedAt: new Date().toISOString() } }
      window.localStorage.setItem(`${NODE_REVIEW_STORAGE_PREFIX}:${workflow.reviewId}`, JSON.stringify(next))
      return next
    })
  }

  const runReview = async () => {
    setRunLoading(true)
    try {
      const result = await apiJson<{ review?: { id?: string; status?: string } }>('/api/v1/daily-reviews/run', {
        method: 'POST',
        body: JSON.stringify({
          userId: USER_ID,
          sessionType: session,
          triggerSource: 'user',
          executionMode: 'inline',
          idempotencyKey: `daily-review-workbench:${session}:${new Date().toISOString()}`,
        }),
      })
      if (!result.review?.id) throw new Error('复盘已返回，但缺少 reviewId')
      message.success(`${sessionLabel[session]}复盘已生成：${result.review.status || 'completed'}`)
      await loadHistory()
      navigate(`/daily-reviews/${result.review.id}`)
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '生成复盘失败')
    } finally {
      setRunLoading(false)
    }
  }

  const confirmRun = () => Modal.confirm({
    title: `生成${sessionLabel[session]}持仓复盘？`,
    icon: <PlayCircleOutlined className="text-blue-600" />,
    content: '系统将写入复盘、持仓/行情快照、建议、提醒和人工计划网格草案；不会修改当前仓位，不会创建券商订单。',
    okText: '确认生成',
    cancelText: '取消',
    onOk: runReview,
  })

  const assets = detail?.report?.assets || []
  const selectedAsset = assets.find((asset) => asset.assetId === selectedAssetId) || assets[0]
  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId) || workflow?.nodes[0]
  const selectedNodeReview = selectedNode ? nodeReviews[selectedNode.id] || { status: 'pending' as const, note: '', updatedAt: '' } : undefined
  const assessment = detail?.report?.strategy?.assessment
  const attentionCandidates = workflow?.attentionCandidates || detail?.report?.attentionCandidates || []
  const errors = detail?.report?.errors || []
  const openNodeAudit = (nodeId: string, focus?: { symbol?: string; evidenceRefs?: string[] }) => {
    setSelectedNodeId(nodeId)
    setAuditFocus(focus || {})
    setAuditOpen(true)
  }

  const chartOption = useMemo(() => {
    const points = selectedAsset?.trend?.chart || []
    return {
      animationDuration: 320,
      color: [colors.primary, colors.ma5, colors.ma10, colors.ma30],
      tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => formatNumber(Number(value), 4) },
      legend: { top: 4, data: ['收盘价', 'MA5', 'MA10', 'MA30'] },
      grid: { left: 46, right: 24, top: 48, bottom: 42, containLabel: true },
      xAxis: { type: 'category', boundaryGap: false, data: points.map((point: any) => point.date), axisLabel: { color: '#64748b' } },
      yAxis: { type: 'value', scale: true, axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
      series: [
        { name: '收盘价', type: 'line', symbol: 'none', lineStyle: { width: 3 }, data: points.map((point: any) => point.close) },
        { name: 'MA5', type: 'line', symbol: 'none', lineStyle: { width: 1.5 }, data: points.map((point: any) => point.ma5) },
        { name: 'MA10', type: 'line', symbol: 'none', lineStyle: { width: 1.5 }, data: points.map((point: any) => point.ma10) },
        { name: 'MA30', type: 'line', symbol: 'none', lineStyle: { width: 1.5 }, data: points.map((point: any) => point.ma30) },
      ],
    }
  }, [selectedAsset])

  const gridRows = useMemo(() => assets.flatMap((asset: any) => {
    const orders = Array.isArray(asset.grid?.orders) ? asset.grid.orders : []
    if (orders.length === 0) return [{
      key: `${asset.assetId}:observe`, symbol: asset.symbol, name: asset.name,
      strategySource: asset.grid?.strategySource, mode: asset.grid?.mode, side: 'observe', level: null,
      price: null, quantity: null, validUntil: asset.grid?.constraints?.validUntil || null,
      status: asset.grid?.status || 'observe_only', rationale: asset.grid?.summary || asset.grid?.blockers?.join('；'),
    }]
    return orders.map((order: any) => ({
      key: order.id || `${asset.assetId}:${order.side}:${order.level}`,
      symbol: asset.symbol, name: asset.name, strategySource: asset.grid?.strategySource, mode: asset.grid?.mode,
      side: order.side, level: order.level, price: order.price, quantity: order.quantity,
      validUntil: order.validUntil || asset.grid?.constraints?.validUntil || null,
      status: order.conflictStatus === 'none' ? 'manual_draft' : order.conflictStatus,
      rationale: order.rationale || asset.grid?.summary,
    }))
  }), [assets])

  const gridColumns: ColumnsType<any> = [
    { title: '标的', dataIndex: 'symbol', fixed: 'left', width: 112, render: (symbol, row) => <div><strong>{symbol}</strong><div className="text-xs text-slate-500">{row.name}</div></div> },
    { title: '策略来源', dataIndex: 'strategySource', width: 160, render: (source) => <Tag>{source || 'unknown'}</Tag> },
    { title: '方向', dataIndex: 'side', width: 90, render: (side) => <Tag color={side === 'buy' ? 'red' : side === 'sell' ? 'green' : 'default'}>{side === 'buy' ? '买入草案' : side === 'sell' ? '卖出草案' : '观察'}</Tag> },
    { title: '档位', dataIndex: 'level', width: 70, render: (level) => level ?? '—' },
    { title: '价格', dataIndex: 'price', width: 100, align: 'right', render: (price) => formatNumber(price, 4) },
    { title: '数量', dataIndex: 'quantity', width: 100, align: 'right', render: (quantity) => formatNumber(quantity, 0) },
    { title: '有效期', dataIndex: 'validUntil', width: 176, render: formatDateTime },
    { title: '状态', dataIndex: 'status', width: 120, render: (status) => <Tag color={status === 'manual_draft' ? 'blue' : 'default'}>{status}</Tag> },
    { title: '理由/阻断', dataIndex: 'rationale', width: 320, render: (reason) => <span className="text-sm text-slate-600">{reason || '未记录'}</span> },
  ]

  if (loading && !detail) return <Skeleton active paragraph={{ rows: 12 }} />

  return (
    <div className="mx-auto max-w-[1600px] space-y-5" data-testid="daily-review-workbench">
      <section className="overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-white via-blue-50/70 to-slate-100 p-5 shadow-sm md:p-7">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1 text-xs font-semibold text-blue-700">
              <AuditOutlined /> 每日持仓复盘 · 公开审计工作台
            </div>
            <h1 className="mb-0 mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">从持仓事实到人工计划草案，每一步都可单独核查。</h1>
            <p className="mb-0 mt-3 max-w-3xl text-sm leading-7 text-slate-600 md:text-base">
              本页展示实际运行的输入、输出、证据和阻断项，不展示模型私密思维链。所有网格都是研究级人工计划草案，不连接券商。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>历史复盘</Button>
            <Button icon={<CloudDownloadOutlined />} disabled={!workflow} onClick={() => workflow && downloadJson(`daily-review-${workflow.reviewId}.json`, { detail, workflow, localNodeReviews: nodeReviews, localNodeReviewsAreFormalSignoff: false })}>导出审计 JSON</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>刷新</Button>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 rounded-xl border border-white bg-white/85 p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Segmented
              value={session}
              onChange={(next) => setSession(next as ReviewSession)}
              options={[{ label: '开盘后', value: 'open' }, { label: '收盘前', value: 'pre_close' }, { label: '手动', value: 'manual' }]}
            />
            <span className="text-sm text-slate-500">运行会新增审计快照；不会修改仓位或创建订单。</span>
          </div>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={runLoading} onClick={confirmRun}>生成当前持仓复盘</Button>
        </div>
      </section>

      {error ? <Alert type="error" showIcon message="读取复盘失败" description={error} action={<Button onClick={() => void refresh()}>重试</Button>} /> : null}

      {!detail || !workflow ? (
        <Card><Empty description="还没有每日持仓复盘"><Button type="primary" onClick={confirmRun}>生成第一轮复盘</Button></Empty></Card>
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6" aria-label="复盘摘要">
            <Card><Statistic title="组合总值" value={detail.report.portfolio?.totalValue || 0} formatter={() => formatMoney(detail.report.portfolio?.totalValue)} /></Card>
            <Card><Statistic title="现金预算" value={detail.report.portfolio?.cashBudget || 0} formatter={() => formatMoney(detail.report.portfolio?.cashBudget)} /></Card>
            <Card><Statistic title="成功资产" value={detail.report.portfolio?.reviewedAssets || 0} suffix={`/ ${detail.report.portfolio?.positions || 0} 持仓`} /></Card>
            <Card><Statistic title="失败资产" value={errors.length} valueStyle={{ color: errors.length ? colors.warning : colors.success }} /></Card>
            <Card><Statistic title="网格草案档位" value={workflow.snapshotCounts.gridOrderDrafts} /></Card>
            <Card><Statistic title="已确认截图 / 行" value={`${workflow.captureSummary.confirmedCaptureCount} / ${workflow.captureSummary.confirmedRowCount}`} /></Card>
          </section>

          <Alert
            type={errors.length ? 'warning' : 'success'}
            showIcon
            message={`${sessionLabel[detail.sessionType] || detail.sessionType}复盘 · ${detail.status}`}
            description={`生成于 ${formatDateTime(detail.generatedAt)}；策略判断：${ensureSentenceEnding(assessment?.conclusion || '未生成')}${errors.length ? `有 ${errors.length} 个资产明确降级。` : '本轮资产处理完整。'}`}
          />

          <DailyReviewDecisionPanel
            decisionSummary={detail.report.decisionSummary}
            llmSynthesis={detail.report.llmSynthesis}
            attentionCandidates={attentionCandidates}
            onOpenAttentionAudit={(symbol, evidenceRefs) => openNodeAudit('attention', { symbol, evidenceRefs })}
          />

          <Card className="fams-card" styles={{ body: { padding: 20 } }}>
            <SectionHeading eyebrow="WORKFLOW" title="十节点 DAG 审计链" description="节点之间的箭头表示真实数据依赖；双击节点仅查看作用、输入和输出。" />
            <DailyReviewWorkflowDag
              nodes={workflow.nodes}
              edges={workflow.edges || []}
              selectedNodeId={selectedNode?.id || 'trigger'}
              nodeReviewStatuses={Object.fromEntries(Object.entries(nodeReviews).map(([key, value]) => [key, value.status]))}
              onSelectNode={(nodeId) => { setSelectedNodeId(nodeId); setAuditFocus({}) }}
              onOpenAudit={(nodeId) => openNodeAudit(nodeId)}
            />
          </Card>

          <Card className="fams-card" styles={{ body: { padding: 20 } }}>
            <SectionHeading eyebrow="CAPTURE LEDGER" title="导入持仓、成交或委托截图" description="与 ChatBox 共用同一套私有保存、单次视觉同意、逐行纠错和人工确认流程；确认后刷新本复盘的截图台账摘要。" />
            <ScreenshotCapturePanel userId={USER_ID} onConfirmed={() => void refresh()} />
          </Card>

          <Card className="fams-card" styles={{ body: { padding: 20 } }}>
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <SectionHeading eyebrow="MARKET" title="最新价格与 30 日均线" description="固定使用 30 个完整交易日收盘点；来源、时间和降级信息随资产一起切换。" />
              <Select
                className="min-w-[260px]"
                aria-label="选择行情资产"
                virtual={false}
                value={selectedAsset?.assetId}
                onChange={setSelectedAssetId}
                options={assets.map((asset: any) => ({ value: asset.assetId, label: `${asset.symbol} · ${asset.name}` }))}
              />
            </div>
            {selectedAsset ? (
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
                <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-2"><ReactECharts option={chartOption} style={{ height: 390 }} notMerge lazyUpdate /></div>
                <div className="space-y-3">
                  <Card size="small"><div className="text-sm text-slate-500">{selectedAsset.symbol} {selectedAsset.name}</div><div className="mt-1 text-3xl font-semibold text-slate-950">{formatNumber(selectedAsset.trend?.quote?.price, 4)}</div><div className="mt-2 flex flex-wrap gap-2"><Tag color="blue">{selectedAsset.trend?.quote?.source || 'unknown'}</Tag><Tag>{formatDateTime(selectedAsset.trend?.quote?.asOf)}</Tag></div></Card>
                  <Descriptions size="small" bordered column={1} items={[
                    { key: 'ma5', label: 'MA5', children: formatNumber(selectedAsset.trend?.indicators?.ma5, 4) },
                    { key: 'ma10', label: 'MA10', children: formatNumber(selectedAsset.trend?.indicators?.ma10, 4) },
                    { key: 'ma30', label: 'MA30', children: formatNumber(selectedAsset.trend?.indicators?.ma30, 4) },
                    { key: 'count', label: '完成日线样本', children: selectedAsset.trend?.indicators?.sampleCount || '—' },
                    { key: 'points', label: '图表点数', children: selectedAsset.trend?.chart?.length || 0 },
                    { key: 'quality', label: '数据质量', children: <Tag color={selectedAsset.trend?.dataQuality?.status === 'ok' ? 'success' : 'warning'}>{selectedAsset.trend?.dataQuality?.status || 'unknown'}</Tag> },
                  ]} />
                </div>
              </div>
            ) : <Empty description="本轮没有成功资产" />}
          </Card>

          <Card className="fams-card">
            <SectionHeading eyebrow="RESEARCH" title="策略与事实变化" description="这里只展示事实变化结论；可读关注摘要位于页面顶部，原始证据位于高级审计。" />
            <Alert type={assessment?.status === 'maintain' ? 'success' : assessment?.status === 'needs_review' ? 'warning' : 'info'} showIcon message={assessment?.status || '未生成总体判断'} description={assessment?.conclusion || '没有可展示的策略判断'} />
            <div className="mt-4 grid gap-3 lg:grid-cols-2">{assets.map((asset: any) => <div key={asset.assetId} className="rounded-lg border border-slate-200 p-3"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{asset.symbol} · {asset.name}</strong><Tag color={asset.fundamentalAndNews?.level === 'material' ? 'error' : asset.fundamentalAndNews?.level === 'insufficient' ? 'warning' : 'success'}>{asset.fundamentalAndNews?.level || 'unknown'}</Tag></div><p className="mb-0 mt-2 text-sm leading-6 text-slate-600">{asset.fundamentalAndNews?.reasons?.join('；') || '未记录变化原因'}</p></div>)}</div>
          </Card>

          <Card className="fams-card">
            <SectionHeading eyebrow="GRID PLAN" title="波动交易网格草案" description="仅展示实际保存的系统研究计划。买入和卖出均为人工计划草案，不会创建订单。" />
            <Table columns={gridColumns} dataSource={gridRows} pagination={false} scroll={{ x: 1240 }} size="small" />
          </Card>

          <Alert
            type="warning"
            showIcon
            icon={<SafetyCertificateOutlined />}
            message="执行边界已锁定"
            description={<div className="mt-2 flex flex-wrap gap-2">{Object.entries(workflow.executionBoundary).map(([key, value]) => <Tag key={key} color={value ? 'error' : 'success'}>{key}={String(value)}</Tag>)}</div>}
          />
        </>
      )}

      <Drawer title="历史持仓复盘" width={520} open={historyOpen} onClose={() => setHistoryOpen(false)}>
        <div className="mb-4 grid grid-cols-2 gap-3">
          <Select aria-label="筛选复盘场次" virtual={false} value={historySession} onChange={setHistorySession} options={[{ value: 'all', label: '全部场次' }, { value: 'open', label: '开盘后' }, { value: 'pre_close', label: '收盘前' }, { value: 'manual', label: '手动' }]} />
          <Select aria-label="筛选复盘状态" virtual={false} value={historyStatus} onChange={setHistoryStatus} options={[{ value: 'all', label: '全部状态' }, { value: 'completed', label: '已完成' }, { value: 'partial', label: '部分完成' }, { value: 'failed', label: '失败' }]} />
        </div>
        <div className="space-y-3">{history.items.length ? history.items.map((item) => <button key={item.id} type="button" onClick={() => { navigate(`/daily-reviews/${item.id}`); setHistoryOpen(false) }} className={`w-full rounded-xl border p-4 text-left ${item.id === detail?.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}><div className="flex items-center justify-between gap-3"><div className="font-semibold text-slate-900">{sessionLabel[item.sessionType] || item.sessionType}复盘</div><Badge status={item.status === 'completed' ? 'success' : item.status === 'partial' ? 'warning' : 'error'} text={item.status} /></div><div className="mt-2 text-sm text-slate-500">{formatDateTime(item.generatedAt)}</div><div className="mt-2 text-sm text-slate-600">复盘资产 {item.portfolio?.reviewedAssets ?? 0} · 网格 {item.counts?.gridPlans ?? 0}</div></button>) : <Empty description="当前筛选没有历史复盘" />}</div>
      </Drawer>

      <DailyReviewAuditDrawer
        open={auditOpen}
        node={selectedNode}
        annotation={selectedNodeReview}
        focusSymbol={auditFocus.symbol}
        focusEvidenceRefs={auditFocus.evidenceRefs}
        onClose={() => { setAuditOpen(false); setAuditFocus({}) }}
        onChangeAnnotation={(patch) => selectedNode && updateNodeReview(selectedNode.id, patch)}
      />
    </div>
  )
}
