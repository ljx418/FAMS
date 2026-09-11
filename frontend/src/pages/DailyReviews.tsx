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
  InputNumber,
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
  BellOutlined,
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
import { BrokerReconciliationPanel } from '../components/review/BrokerReconciliationPanel'
import { OpenInExternalBrainButton } from '../components/external-brain/OpenInExternalBrainButton'
import { PX_DEFAULT_WORKSPACE_ID } from '../services/pxExternalBrainBridge'
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

type OneClickPreflight = {
  status: 'ready' | 'blocked'
  canRun: boolean
  blockers: string[]
  warnings: string[]
  sourceSnapshot?: {
    captureId?: string
    asOfDate?: string | null
    statedTotal?: number | null
    reconciliation?: string
    holdingRows?: number
  } | null
  currentPortfolio?: { alipayValue?: number; captureVariance?: number | null; classificationStatus?: string }
  llm?: { enabled?: boolean; provider?: string | null; model?: string | null; failureCode?: string | null }
  previousOneClickReview?: { reviewId?: string; status?: string; generatedAt?: string } | null
}

type ReviewDetail = ReviewListItem & {
  report: {
    schemaVersion?: string
    reviewId?: string
    generatedAt?: string
    completedAt?: string
    sessionType?: string
    portfolio?: {
      totalValue?: number
      cashBudget?: number
      positions?: number
      reviewedAssets?: number
      immediateBuyBudget?: { cashFloorPercent?: number; initial?: number; used?: number; remaining?: number; conditionalBuybackExcludedUntilParentFill?: boolean }
    }
    strategy?: {
      activeStrategyVersionIds?: string[]
      fallback?: string[] | string | null
      assessment?: { status?: string; conclusion?: string; reasons?: string[] }
    }
    assets?: Array<Record<string, any>>
    attentionCandidates?: Array<Record<string, any>>
    decisionSummary?: Record<string, any>
    llmSynthesis?: Record<string, any>
    oneClickWorkflow?: Record<string, any> | null
    reconciliation?: Record<string, any> | null
    relativeRotation?: Record<string, any> | null
    errors?: Array<{ symbol?: string; message?: string }>
    executionBoundary?: Record<string, boolean>
    disclaimer?: string
  }
  operation?: Record<string, any> | null
  advice?: {
    id?: string
    status?: string
    actions?: Array<{
      id: string
      status: string
      suggestedAmount?: number | null
      execution?: { decision?: 'accepted' | 'rejected' | 'modified'; overrideJson?: string; notes?: string | null } | null
    }>
  } | null
  gridPlans?: Array<Record<string, any>>
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const nextError = new Error(payload?.message || payload?.error || `HTTP ${response.status}`) as Error & { payload?: any }
    nextError.payload = payload
    throw nextError
  }
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
const preflightBlockerLabel: Record<string, string> = {
  portfolio_change_declaration_required: '请先声明持仓是否变化',
  confirmed_alipay_portfolio_capture_required: '需要一张已确认的支付宝持仓截图',
  new_alipay_portfolio_capture_required: '持仓有变化，请上传并确认一张新持仓截图',
  alipay_account_summary_required: '截图缺少账户总额与余额宝摘要',
  alipay_holding_rows_required: '截图没有可确认的基金持仓行',
  alipay_capture_reconciliation_failed: '截图明细与账户总额无法逐分对账',
  alipay_positions_do_not_match_capture: '数据库支付宝持仓与最近确认截图不一致',
  alipay_allocation_classification_incomplete: '存在未归入现金、黄金、债券或权益桶的支付宝持仓',
  strict_llm_unavailable: '严格 LLM 汇总当前不可用',
  rrg_benchmark_not_ready: '目标组合基准数据已老化，请刷新行情后再运行',
}

const readableBlocker = (value: string) => preflightBlockerLabel[value]
  || (value.startsWith('rrg_data_not_ready:') ? `${value.split(':')[1]} 的真实轮动数据未达到运行门槛` : value)

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
  const [portfolioState, setPortfolioState] = useState<'unchanged' | 'changed'>('unchanged')
  const [preflight, setPreflight] = useState<OneClickPreflight>()
  const [preflightLoading, setPreflightLoading] = useState(false)
  const [historySession, setHistorySession] = useState<string>('all')
  const [historyStatus, setHistoryStatus] = useState<string>('all')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [auditOpen, setAuditOpen] = useState(false)
  const [auditFocus, setAuditFocus] = useState<{ symbol?: string; evidenceRefs?: string[] }>({})
  const [loading, setLoading] = useState(true)
  const [runLoading, setRunLoading] = useState(false)
  const [decisionLoadingId, setDecisionLoadingId] = useState<string>()
  const [error, setError] = useState<string>()
  const [nodeReviews, setNodeReviews] = useState<Record<string, NodeReviewAnnotation>>({})
  const [browserNotificationPermission, setBrowserNotificationPermission] = useState(() => 'Notification' in window ? window.Notification.permission : 'unsupported')
  const [zeroNewTradesConfirmed, setZeroNewTradesConfirmed] = useState(false)
  const [brokerLoading, setBrokerLoading] = useState(false)
  const [brokerReconciliationPreview, setBrokerReconciliationPreview] = useState<Record<string, any>>()

  const requestBrowserNotifications = async () => {
    if (!('Notification' in window)) {
      message.warning('当前浏览器不支持系统通知。')
      return
    }
    const permission = await window.Notification.requestPermission()
    setBrowserNotificationPermission(permission)
    if (permission === 'granted') message.success('已开启浏览器复盘提醒；应用打开时会在 09:40 和 14:40 通知。')
    else message.warning('浏览器通知未授权，站内提醒与 ChatBox 提醒仍然保留。')
  }

  const checkPreflight = useCallback(async () => {
    setPreflightLoading(true)
    try {
      const result = await apiJson<OneClickPreflight>('/api/v1/daily-reviews/alipay-one-click/preflight', {
        method: 'POST',
        body: JSON.stringify({
          userId: USER_ID,
          portfolioChangedSinceLastCapture: portfolioState === 'changed',
        }),
      })
      setPreflight(result)
      return result
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '预检失败')
      return undefined
    } finally {
      setPreflightLoading(false)
    }
  }, [portfolioState])

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
  useEffect(() => { void checkPreflight() }, [checkPreflight])

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
      const result = await apiJson<{ review?: { id?: string; status?: string }; preflight?: OneClickPreflight }>('/api/v1/daily-reviews/alipay-one-click/run', {
        method: 'POST',
        body: JSON.stringify({
          userId: USER_ID,
          sessionType: session,
          portfolioChangedSinceLastCapture: portfolioState === 'changed',
          idempotencyKey: `alipay-one-click:${session}:${new Date().toISOString()}`,
        }),
      })
      if (result.preflight) setPreflight(result.preflight)
      if (!result.review?.id) throw new Error('复盘已返回，但缺少 reviewId')
      if (result.review.status === 'failed') message.error('严格 LLM 门禁未通过，本轮已失败且金额草案保持阻断。')
      else message.success(`${sessionLabel[session]}一键复盘已生成：${result.review.status || 'completed'}`)
      await loadHistory()
      navigate(`/daily-reviews/${result.review.id}`)
    } catch (nextError) {
      const payload = (nextError as Error & { payload?: any }).payload
      if (payload?.preflight) setPreflight(payload.preflight)
      message.error(nextError instanceof Error ? nextError.message : '生成复盘失败')
    } finally {
      setRunLoading(false)
    }
  }

  const reconcileBroker = async () => {
    setBrokerLoading(true)
    try {
      const result = await apiJson<Record<string, any>>('/api/v1/daily-reviews/reconcile', {
        method: 'POST',
        body: JSON.stringify({ userId: USER_ID, sessionType: session, zeroNewTradesConfirmed }),
      })
      setBrokerReconciliationPreview(result)
      message.success(result.readiness?.requiredInputsReady ? '券商持仓与新成交对账完成。' : '已生成对账报告；强制材料仍有缺口。')
      return result
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '券商对账失败')
      return undefined
    } finally {
      setBrokerLoading(false)
    }
  }

  const runBrokerReview = async () => {
    setBrokerLoading(true)
    try {
      const result = await apiJson<{ review?: { id?: string; status?: string } }>('/api/v1/daily-reviews/run', {
        method: 'POST',
        body: JSON.stringify({
          userId: USER_ID,
          sessionType: session,
          brokerWorkflow: true,
          zeroNewTradesConfirmed,
          executionMode: 'inline',
          idempotencyKey: `broker-review:${session}:${new Date().toISOString()}`,
        }),
      })
      if (!result.review?.id) throw new Error('券商复盘已返回，但缺少 reviewId')
      message.success('券商持仓复盘已生成；所有订单仍是只读草案。')
      await loadHistory()
      navigate(`/daily-reviews/${result.review.id}`)
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '生成券商复盘失败')
    } finally {
      setBrokerLoading(false)
    }
  }

  const confirmBrokerRun = () => Modal.confirm({
    title: `生成${sessionLabel[session]}券商持仓复盘？`,
    icon: <PlayCircleOutlined className="text-blue-600" />,
    content: '系统会先对账最近确认的持仓与成交，再查询实时价、完整交易日收盘价、均线、RRG 和消息面。只生成五段式报告及人工计划草案，不会创建或提交券商订单。',
    okText: '确认生成',
    cancelText: '取消',
    onOk: runBrokerReview,
  })

  const confirmRun = () => Modal.confirm({
    title: `生成${sessionLabel[session]}支付宝一键复盘？`,
    icon: <PlayCircleOutlined className="text-blue-600" />,
    content: '系统将刷新真实净值与轮动数据，综合已确认截图和历史流水，写入一次复盘及待人工确认的金额草案；不会修改当前仓位，不会创建或提交外部订单。',
    okText: '确认生成',
    cancelText: '取消',
    onOk: runReview,
  })

  const retryStrictLlm = async () => {
    if (!detail?.id) return
    setRunLoading(true)
    try {
      const next = await apiJson<ReviewDetail>(`/api/v1/daily-reviews/alipay-one-click/${encodeURIComponent(detail.id)}/retry-llm`, {
        method: 'POST',
        body: JSON.stringify({ userId: USER_ID }),
      })
      setDetail(next)
      if (next.status === 'completed' || next.status === 'partial') message.success('严格 LLM 重试通过，金额草案已恢复为待人工核对。')
      else message.error('严格 LLM 重试仍未通过，金额草案继续保持阻断。')
      await loadHistory()
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '严格 LLM 重试失败')
    } finally {
      setRunLoading(false)
    }
  }

  const saveDraftDecision = async (draft: any, decision: 'accepted' | 'rejected' | 'modified', overrideAmount?: number) => {
    if (!detail?.id || !draft.adviceActionId) return
    setDecisionLoadingId(draft.adviceActionId)
    try {
      const next = await apiJson<ReviewDetail>(`/api/v1/daily-reviews/alipay-one-click/${encodeURIComponent(detail.id)}/actions/${encodeURIComponent(draft.adviceActionId)}/decision`, {
        method: 'POST',
        body: JSON.stringify({ userId: USER_ID, decision, overrideAmount }),
      })
      setDetail(next)
      message.success(decision === 'rejected' ? '已拒绝该草案；未发生交易。' : decision === 'modified' ? '已保存修改金额；未发生交易。' : '已接受该草案；未发生交易。')
    } catch (nextError) {
      message.error(nextError instanceof Error ? nextError.message : '保存人工计划决定失败')
      throw nextError
    } finally {
      setDecisionLoadingId(undefined)
    }
  }

  const requestDraftDecision = (draft: any, decision: 'accepted' | 'rejected' | 'modified') => {
    if (decision === 'modified') {
      let amount = Number(draft.firstTrancheAmount || 0)
      Modal.confirm({
        title: `修改 ${draft.symbol} 的第一批金额`,
        content: <div><p className="text-sm text-slate-600">只能在完整调整额 {formatMoney(draft.fullAmount)} 以内修改；这里只记录计划，不会下单或改持仓。</p><InputNumber className="w-full" min={0.01} max={Number(draft.fullAmount || 0)} precision={2} defaultValue={amount} addonBefore="¥" onChange={(value) => { amount = Number(value) }} /></div>,
        okText: '保存修改',
        cancelText: '取消',
        onOk: () => saveDraftDecision(draft, 'modified', amount),
      })
      return
    }
    Modal.confirm({
      title: decision === 'accepted' ? `接受 ${draft.symbol} 的金额草案？` : `拒绝 ${draft.symbol} 的金额草案？`,
      content: decision === 'accepted'
        ? `将本地记录“接受 ${formatMoney(draft.firstTrancheAmount)}”，不会创建订单、不会改持仓。`
        : '将本地记录为拒绝，不会发生交易。',
      okText: decision === 'accepted' ? '确认接受' : '确认拒绝',
      okButtonProps: { danger: decision === 'rejected' },
      cancelText: '取消',
      onOk: () => saveDraftDecision(draft, decision),
    })
  }

  const assets = detail?.report?.assets || []
  const selectedAsset = assets.find((asset) => asset.assetId === selectedAssetId) || assets[0]
  const selectedNode = workflow?.nodes.find((node) => node.id === selectedNodeId) || workflow?.nodes[0]
  const selectedNodeReview = selectedNode ? nodeReviews[selectedNode.id] || { status: 'pending' as const, note: '', updatedAt: '' } : undefined
  const assessment = detail?.report?.strategy?.assessment
  const attentionCandidates = workflow?.attentionCandidates || detail?.report?.attentionCandidates || []
  const errors = detail?.report?.errors || []
  const oneClick = detail?.report?.oneClickWorkflow
  const alipaySummary = oneClick?.allocation?.accountSummary
  const alipayBuckets = alipaySummary?.buckets || []
  const allocationDrafts = oneClick?.tradeDrafts || []
  const rotationItems = oneClick?.relativeRotation?.items || []
  const adviceActionById = new Map((detail?.advice?.actions || []).map((action) => [action.id, action]))
  const renderDraftDecision = (draft: any) => {
    const action = adviceActionById.get(draft.adviceActionId)
    const decision = action?.execution?.decision
    const blocked = draft.currentState !== 'manual_confirmation_required'
    return <div className="flex flex-wrap items-center gap-1.5" data-testid={`draft-decision-${draft.symbol}`}>
      {decision ? <Tag color={decision === 'rejected' ? 'default' : 'blue'}>{decision === 'accepted' ? '已接受' : decision === 'modified' ? '已修改' : '已拒绝'}</Tag> : <Tag>未决定</Tag>}
      <Button size="small" disabled={blocked} loading={decisionLoadingId === draft.adviceActionId} onClick={() => requestDraftDecision(draft, 'accepted')}>接受</Button>
      <Button size="small" disabled={blocked} onClick={() => requestDraftDecision(draft, 'modified')}>修改</Button>
      <Button size="small" danger onClick={() => requestDraftDecision(draft, 'rejected')}>拒绝</Button>
    </div>
  }
  const showScreenshotWorkflow = portfolioState === 'changed'
    || Boolean(preflight?.blockers?.some((item) => ['confirmed_alipay_portfolio_capture_required', 'new_alipay_portfolio_capture_required', 'alipay_capture_reconciliation_failed'].includes(item)))
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
    const immediateRows = orders.length === 0 ? [{
      key: `${asset.assetId}:observe`, symbol: asset.symbol, name: asset.name,
      planType: 'immediate', strategySource: asset.grid?.strategySource, mode: asset.grid?.mode, side: 'observe', level: null,
      price: null, quantity: null, validUntil: asset.grid?.constraints?.validUntil || null,
      status: asset.grid?.status || 'observe_only', rationale: asset.grid?.summary || asset.grid?.blockers?.join('；'),
    }] : orders.map((order: any) => ({
      key: order.id || `${asset.assetId}:${order.side}:${order.level}`,
      symbol: asset.symbol, name: asset.name, planType: 'immediate', strategySource: asset.grid?.strategySource, mode: asset.grid?.mode,
      side: order.side, level: order.level, price: order.price, quantity: order.quantity,
      validUntil: order.validUntil || asset.grid?.constraints?.validUntil || null,
      status: order.conflictStatus === 'none' ? 'manual_draft' : order.conflictStatus,
      rationale: order.rationale || asset.grid?.summary,
    }))
    const buybackOrders = Array.isArray(asset.buybackGrid?.orders) ? asset.buybackGrid.orders : []
    const buybackRows = buybackOrders.length === 0 ? [{
      key: `${asset.assetId}:buyback-observe`, symbol: asset.symbol, name: asset.name,
      planType: 'conditional_buyback', strategySource: asset.buybackGrid?.strategySource, mode: asset.buybackGrid?.mode, side: 'observe', level: null,
      price: null, quantity: null, validUntil: asset.buybackGrid?.constraints?.validUntil || null,
      status: asset.buybackGrid?.status || 'observe_only', rationale: asset.buybackGrid?.summary || asset.buybackGrid?.blockers?.join('；') || '旧报告未保存条件买回计划',
    }] : buybackOrders.map((order: any) => ({
      key: order.id || `${asset.assetId}:conditional:${order.level}`,
      symbol: asset.symbol, name: asset.name, planType: 'conditional_buyback', strategySource: asset.buybackGrid?.strategySource, mode: asset.buybackGrid?.mode,
      side: order.side, level: order.level, price: order.price, quantity: order.quantity,
      validUntil: order.validUntil || asset.buybackGrid?.constraints?.validUntil || null,
      status: order.status || 'awaiting_parent_fill', rationale: order.rationale || asset.buybackGrid?.summary,
    }))
    return [...immediateRows, ...buybackRows]
  }), [assets])

  const gridColumns: ColumnsType<any> = [
    { title: '标的', dataIndex: 'symbol', fixed: 'left', width: 112, render: (symbol, row) => <div><strong>{symbol}</strong><div className="text-xs text-slate-500">{row.name}</div></div> },
    { title: '计划类型', dataIndex: 'planType', width: 150, render: (value) => <Tag color={value === 'immediate' ? 'blue' : 'gold'}>{value === 'immediate' ? '即时人工计划' : '卖出后条件买回'}</Tag> },
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
            <h1 className="mb-0 mt-4 text-3xl font-semibold tracking-tight text-slate-950 md:text-4xl">券商与支付宝持仓，每日可追溯复盘。</h1>
            <p className="mb-0 mt-3 max-w-3xl text-sm leading-7 text-slate-600 md:text-base">
              券商流程先核对持仓、可卖数量、资金、新成交和现有委托，再刷新真实价格、均线、日频 RRG 与消息证据；支付宝仍保留原有一键配置复盘。两条流程都只产出人工计划，不连接外部下单。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <OpenInExternalBrainButton
              entryId="daily-review"
              label="在外部大脑查看图谱"
              request={detail?.id ? {
                entryAction: 'open_in_workspace',
                routeIntent: 'graph',
                routePayload: { workspaceId: PX_DEFAULT_WORKSPACE_ID, graphScope: 'daily-review', graphId: detail.id },
              } : undefined}
              disabledReason={!detail?.id ? '请先生成或打开一份复盘。' : undefined}
            />
            <Button icon={<HistoryOutlined />} onClick={() => setHistoryOpen(true)}>历史复盘</Button>
            <Button icon={<BellOutlined />} onClick={() => void requestBrowserNotifications()}>{browserNotificationPermission === 'granted' ? '浏览器提醒已开启' : '开启浏览器提醒'}</Button>
            <Button icon={<CloudDownloadOutlined />} disabled={!workflow} onClick={() => workflow && downloadJson(`daily-review-${workflow.reviewId}.json`, { detail, workflow, localNodeReviews: nodeReviews, localNodeReviewsAreFormalSignoff: false })}>导出审计 JSON</Button>
            <Button icon={<CloudDownloadOutlined />} disabled={!detail?.id} onClick={() => detail?.id && window.open(`${API_BASE}/api/v1/daily-reviews/${encodeURIComponent(detail.id)}/report.html?userId=${USER_ID}`, '_blank', 'noopener,noreferrer')}>打开 HTML 报告</Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>刷新</Button>
          </div>
        </div>
        <div className="mt-6 rounded-xl border border-white bg-white/90 p-4 shadow-sm" data-testid="alipay-one-click-controls">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <Segmented
              value={session}
              onChange={(next) => setSession(next as ReviewSession)}
              options={[{ label: '开盘后', value: 'open' }, { label: '收盘前', value: 'pre_close' }, { label: '手动', value: 'manual' }]}
            />
              <Segmented
                aria-label="声明支付宝持仓是否变化"
                value={portfolioState}
                onChange={(next) => setPortfolioState(next as 'unchanged' | 'changed')}
                options={[{ label: '持仓没变化，复用截图', value: 'unchanged' }, { label: '持仓有变化', value: 'changed' }]}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button loading={preflightLoading} onClick={() => void checkPreflight()}>重新检查</Button>
              <Button type="primary" size="large" icon={<PlayCircleOutlined />} loading={runLoading} disabled={!preflight?.canRun} onClick={confirmRun}>一键生成复盘与金额草案</Button>
            </div>
          </div>
          <Alert
            className="mt-4"
            type={preflight?.canRun ? 'success' : 'warning'}
            showIcon
            message={preflightLoading ? '正在检查运行条件' : preflight?.canRun ? '可以运行' : '运行前还需处理'}
            description={preflight?.canRun
              ? `持仓截图已逐分对账（${formatMoney(preflight.sourceSnapshot?.statedTotal)}，数据日 ${preflight.sourceSnapshot?.asOfDate ? new Date(preflight.sourceSnapshot.asOfDate).toLocaleDateString('zh-CN') : '未记录'}）；LLM：${preflight.llm?.provider || 'unknown'} / ${preflight.llm?.model || 'unknown'}。`
              : (preflight?.blockers || ['正在读取预检结果']).map(readableBlocker).join('；')}
          />
        </div>
      </section>

      <Card className="fams-card" styles={{ body: { padding: 20 } }} data-testid="broker-daily-review-entry">
        <SectionHeading eyebrow="BROKER WORKFLOW" title="同花顺截图 → 五段式对账 → 每日波动交易草案" description="持仓与近期成交是强制材料；若今天没有新成交，可显式确认。普通委托、条件单是可选材料，但缺失时新增候选必须人工查重。历史成交如已体现在最新持仓快照中，只记流水，不会二次扣加。" />
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-blue-100 bg-blue-50/60 p-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Segmented value={session} onChange={(next) => setSession(next as ReviewSession)} options={[{ label: '开盘后', value: 'open' }, { label: '收盘前', value: 'pre_close' }, { label: '手动', value: 'manual' }]} />
            <Segmented aria-label="新成交确认" value={zeroNewTradesConfirmed ? 'none' : 'capture'} onChange={(next) => setZeroNewTradesConfirmed(next === 'none')} options={[{ label: '已上传近期成交', value: 'capture' }, { label: '确认今天无新成交', value: 'none' }]} />
          </div>
          <div className="flex flex-wrap gap-2"><Button loading={brokerLoading} onClick={() => void reconcileBroker()}>先只读对账</Button><Button type="primary" icon={<PlayCircleOutlined />} loading={brokerLoading} onClick={confirmBrokerRun}>生成券商复盘</Button></div>
        </div>
        <ScreenshotCapturePanel userId={USER_ID} tradePositionEffectPolicy="included_in_latest_snapshot" onConfirmed={() => void reconcileBroker()} />
      </Card>

      <BrokerReconciliationPanel reconciliation={detail?.report?.reconciliation || brokerReconciliationPreview} />

      <Card className="fams-card" styles={{ body: { padding: 20 } }} data-testid="alipay-screenshot-entry">
        <SectionHeading eyebrow="SOURCE SNAPSHOT" title="持仓或交易有变化时，在这里更新截图" description="持仓不变时可复用最近一次已确认快照；发生买卖、分红再投或转账后，请上传新截图并逐行确认。原图私有保存，缺失行不会自动清仓。" />
        {showScreenshotWorkflow
          ? <ScreenshotCapturePanel userId={USER_ID} tradePositionEffectPolicy="included_in_latest_snapshot" onConfirmed={() => { void refresh(); void checkPreflight() }} />
          : <Alert
              type="info"
              showIcon
              message="正在复用最近一次已确认持仓快照，无需重复上传"
              description={`快照总额 ${formatMoney(preflight?.sourceSnapshot?.statedTotal)}；如果今天发生过买卖、分红再投或转账，请切换为“持仓有变化”。`}
              action={<Button onClick={() => setPortfolioState('changed')}>更新截图</Button>}
            />}
      </Card>

      {error ? <Alert type="error" showIcon message="读取复盘失败" description={error} action={<Button onClick={() => void refresh()}>重试</Button>} /> : null}

      {!detail || !workflow ? (
        <Card><Empty description="还没有每日持仓复盘"><Button type="primary" disabled={!preflight?.canRun} onClick={confirmRun}>生成第一轮一键复盘</Button></Empty></Card>
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

          {oneClick ? (
            <Card className="fams-card" styles={{ body: { padding: 20 } }} data-testid="alipay-one-click-result">
              <SectionHeading eyebrow="ONE-CLICK RESULT" title="本轮支付宝配置与金额草案" description="金额来自已确认持仓总额和批准的5/25/25/45配置；第一批只供你在支付宝人工核对，后续批次继续等待新的周频轮动点。" />
              <Alert
                type={oneClick.readyForHumanReview ? 'success' : 'error'}
                showIcon
                message={oneClick.readyForHumanReview ? '真实数据与严格 LLM 汇总均已通过，可开始人工核对' : '本轮未通过严格 LLM 门禁，金额草案不可用'}
                description={`源截图 ${oneClick.sourceSnapshot?.captureId || '未记录'}；持仓日 ${oneClick.sourceSnapshot?.asOfDate ? new Date(oneClick.sourceSnapshot.asOfDate).toLocaleDateString('zh-CN') : '未记录'}；历史流水 ${oneClick.recentLedger?.entryCount || 0} 条。`}
                action={!oneClick.readyForHumanReview ? <Button loading={runLoading} onClick={() => void retryStrictLlm()}>仅重试 LLM 汇总</Button> : undefined}
              />
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {alipayBuckets.map((bucket: any) => (
                  <div key={bucket.key} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-2"><strong>{bucket.label}</strong><Tag color={bucket.triggered ? 'warning' : 'success'}>{bucket.triggered ? '需调整' : '范围内'}</Tag></div>
                    <div className="mt-3 text-2xl font-semibold text-slate-950">{Number(bucket.current_pct * 100).toFixed(1)}%</div>
                    <div className="mt-1 text-sm text-slate-600">目标 {Number(bucket.target_pct * 100).toFixed(0)}% · 差额 {formatMoney(bucket.gap_value)}</div>
                  </div>
                ))}
              </div>
              <div className="mt-5">
                <h3 className="text-base font-semibold text-slate-950">第一批待人工核对金额</h3>
                <Alert className="mt-3" type="info" showIcon message="这里的接受、修改、拒绝只记录人工计划决定；不会创建订单、不会修改持仓。" />
                <div className="mt-3 grid gap-3 md:hidden" data-testid="alipay-mobile-drafts">
                  {allocationDrafts.map((draft: any) => (
                    <div key={`${draft.symbol}:${draft.action}`} className="rounded-xl border border-slate-200 bg-white p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <Tag color={draft.action === 'buy' ? 'red' : draft.action === 'sell' ? 'green' : 'gold'}>
                              {draft.action === 'buy' ? '买入' : draft.action === 'sell' ? '卖出' : '债券减持复核'}
                            </Tag>
                            <strong className="text-base text-slate-950">{draft.symbol}</strong>
                          </div>
                          <div className="mt-3 text-xs text-slate-500">第一批金额</div>
                          <div className="mt-1 text-2xl font-semibold text-slate-950">{formatMoney(draft.firstTrancheAmount)}</div>
                        </div>
                        <Tag color={draft.currentState === 'manual_confirmation_required' ? 'blue' : 'warning'}>
                          {draft.currentState === 'manual_confirmation_required' ? '待人工核对' : draft.currentState === 'blocked_pending_redeemability_and_fee' ? '先核验赎回与费用' : 'LLM门禁阻断'}
                        </Tag>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3 text-sm">
                        <div><span className="block text-xs text-slate-500">完整调整额</span><strong>{formatMoney(draft.fullAmount)}</strong></div>
                        <div><span className="block text-xs text-slate-500">后续轮动</span><strong>{draft.rrgCurrent?.quadrant || '无坐标'}</strong></div>
                      </div>
                      <div className="mt-2 text-xs leading-5 text-slate-600">
                        {draft.laterTrancheState === 'rrg_condition_met_wait_new_weekly_point' ? '当前条件通过，后续仍等待新的周频点。' : draft.laterTrancheState === 'blocked_by_current_rrg' ? '当前轮动条件未通过，后续批次阻断。' : '结构性调整仍需人工确认。'}
                      </div>
                      <div className="mt-3 border-t border-slate-100 pt-3">{renderDraftDecision(draft)}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 hidden md:block">
                  <Table<any>
                    size="small"
                    pagination={false}
                    rowKey={(record: any) => `${record.symbol}:${record.action}`}
                    dataSource={allocationDrafts}
                    scroll={{ x: 1220 }}
                    columns={[
                      { title: '动作', dataIndex: 'action', width: 90, render: (value) => <Tag color={value === 'buy' ? 'red' : value === 'sell' ? 'green' : 'gold'}>{value === 'buy' ? '买入' : value === 'sell' ? '卖出' : '债券减持复核'}</Tag> },
                      { title: '标的', dataIndex: 'symbol', width: 110 },
                      { title: '第一批金额', dataIndex: 'firstTrancheAmount', width: 150, align: 'right', render: formatMoney },
                      { title: '完整调整额', dataIndex: 'fullAmount', width: 150, align: 'right', render: formatMoney },
                      { title: '当前状态', dataIndex: 'currentState', width: 210, render: (value) => <Tag color={value === 'manual_confirmation_required' ? 'blue' : 'warning'}>{value === 'manual_confirmation_required' ? '待你人工核对' : value === 'blocked_pending_redeemability_and_fee' ? '先核验赎回与费用' : 'LLM门禁阻断'}</Tag> },
                      { title: '后续批次轮动门禁', dataIndex: 'laterTrancheState', width: 250, render: (value: string, record: any) => <span>{record.rrgCurrent?.quadrant || '无坐标'} · {value === 'rrg_condition_met_wait_new_weekly_point' ? '条件通过，仍等新周点' : value === 'blocked_by_current_rrg' ? '当前阻断' : '结构性退出待确认'}</span> },
                      { title: '人工计划决定', key: 'humanDecision', width: 260, render: (_value: unknown, record: any) => renderDraftDecision(record) },
                    ]}
                  />
                </div>
              </div>
              <div className="mt-5">
                <h3 className="text-base font-semibold text-slate-950">当前轮动门禁</h3>
                <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {rotationItems.map((item: any) => (
                    <div key={item.symbol} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between"><strong>{item.symbol}</strong><Tag color={item.gateEligible ? 'success' : 'warning'}>{item.quadrant || '无坐标'}</Tag></div>
                      <div className="mt-2 text-xs leading-5 text-slate-600">{item.readiness} · 数据日 {item.commonAsOfDate || '未知'} · {item.gateEligible ? '当前条件通过' : '当前条件未通过'}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          ) : null}

          <DailyReviewDecisionPanel
            decisionSummary={detail.report.decisionSummary}
            llmSynthesis={detail.report.llmSynthesis}
            attentionCandidates={attentionCandidates}
            onOpenAttentionAudit={(symbol, evidenceRefs) => openNodeAudit('attention', { symbol, evidenceRefs })}
          />

          <Card className="fams-card" styles={{ body: { padding: 20 } }}>
            <SectionHeading eyebrow="WORKFLOW" title="十节点 DAG 审计链" description="节点之间的箭头表示真实数据依赖；双击节点仅查看作用、输入和输出。页面不展示模型私密思维链。" />
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
                    { key: 'freshness', label: '最新价新鲜度', children: <Tag color={selectedAsset.trend?.quote?.freshnessStatus === 'fresh' ? 'success' : 'warning'}>{selectedAsset.trend?.quote?.freshnessStatus || 'unknown'}</Tag> },
                    { key: 'adjustment', label: '日线复权口径', children: selectedAsset.trend?.dataQuality?.historyAdjustment || 'unknown' },
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
            <SectionHeading eyebrow="GRID PLAN" title="波动交易网格完整台账" description="即时人工计划与卖出后条件买回分别标识；条件买回在父卖单成交前未激活且不占当前现金。" />
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
