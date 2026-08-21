import { prisma } from '../../db/prisma.js'

export type DailyReviewWorkflowNodeStatus = 'complete' | 'partial' | 'blocked' | 'empty' | 'locked'
export type DailyReviewWorkflowProvenance = 'runtime_record' | 'derived_view'

export interface DailyReviewWorkflowValue {
  label: string
  value: string
  evidenceRef?: string
}

export interface DailyReviewWorkflowNode {
  id: string
  sequence: number
  title: string
  purpose: string
  dependsOn: string[]
  status: DailyReviewWorkflowNodeStatus
  provenance: DailyReviewWorkflowProvenance
  inputs: DailyReviewWorkflowValue[]
  outputs: DailyReviewWorkflowValue[]
  evidenceRefs: string[]
  blockerCodes: string[]
}

export interface DailyReviewWorkflowEdge {
  id: string
  source: string
  target: string
}

const NODE_GRAPH: Record<string, { purpose: string; dependsOn: string[] }> = {
  trigger: { purpose: '建立本轮复盘的场次、触发来源和审计运行边界。', dependsOn: [] },
  positions: { purpose: '固化本轮开放持仓与已确认截图台账，形成后续计算的组合基线。', dependsOn: ['trigger'] },
  quotes: { purpose: '采集各资产的时点行情、完整日线和行情来源质量。', dependsOn: ['positions'] },
  indicators: { purpose: '基于完整日线计算 MA5、MA10、MA30 等可复算技术指标。', dependsOn: ['quotes'] },
  fundamentals: { purpose: '读取基本面、估值和消息证据，并与上一轮事实摘要比较。', dependsOn: ['positions'] },
  strategy: { purpose: '汇总技术、基本面和风险门禁，形成组合级策略状态。', dependsOn: ['indicators', 'fundamentals'] },
  attention: { purpose: '对持仓和候选池进行证据化排序，形成需要优先复核的标的列表。', dependsOn: ['strategy'] },
  grid: { purpose: '应用技术锚、ATR 间距、资金、仓位和整手约束，生成人工计划网格草案。', dependsOn: ['positions', 'quotes', 'indicators', 'strategy'] },
  history: { purpose: '把本轮策略和网格与上一轮已完成运行进行比较。', dependsOn: ['strategy', 'grid'] },
  boundary: { purpose: '验证所有结果仍处于研究与人工计划边界，禁止创建或提交订单。', dependsOn: ['strategy', 'attention', 'grid', 'history'] },
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

const finite = (value: unknown) => Number.isFinite(Number(value))
const unique = (values: Array<string | null | undefined>) => [...new Set(values.filter((value): value is string => Boolean(value)))]
const text = (value: unknown, fallback = '未记录') => {
  if (value === null || value === undefined || value === '') return fallback
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return value.length > 0 ? value.join('、') : fallback
  return String(value)
}

const value = (label: string, raw: unknown, evidenceRef?: string): DailyReviewWorkflowValue => ({
  label,
  value: text(raw),
  ...(evidenceRef ? { evidenceRef } : {}),
})

function reviewNodeStatus(status: string): DailyReviewWorkflowNodeStatus {
  if (status === 'completed') return 'complete'
  if (status === 'partial' || status === 'running' || status === 'queued') return 'partial'
  return 'blocked'
}

function candidateEvidence(candidate: any, assets: any[]) {
  const matchedAsset = assets.find((asset) => asset.symbol === candidate?.symbol)
  const evidenceRefs = unique([
    ...(Array.isArray(candidate?.evidenceRefs) ? candidate.evidenceRefs : []),
    ...(Array.isArray(matchedAsset?.fundamentalAndNews?.evidenceRefs) ? matchedAsset.fundamentalAndNews.evidenceRefs : []),
  ])
  const explicit = candidate?.evidenceStatus
  const evidenceStatus = explicit || (evidenceRefs.length > 0 ? 'available' : 'insufficient')
  return { evidenceStatus, evidenceRefs }
}

class DailyReviewWorkflowService {
  async getWorkflow(reviewId: string, expectedUserId?: string) {
    const review = await prisma.dailyReviewRun.findUnique({
      where: { id: reviewId },
      include: {
        operation: true,
        previousRun: { select: { id: true, status: true, generatedAt: true, reportJson: true } },
        positionSnapshots: { select: { id: true, positionId: true, assetId: true, sourceCaptureId: true } },
        marketSnapshots: { select: { id: true, assetId: true, source: true, capturedAt: true } },
        gridPlans: {
          include: {
            asset: { select: { symbol: true, name: true } },
            orders: { orderBy: [{ side: 'asc' }, { level: 'asc' }] },
          },
        },
      },
    })
    if (!review) throw new Error('Daily review run not found')
    if (expectedUserId && review.userId !== expectedUserId) throw new Error('Daily review does not belong to the requested user')

    const confirmedCaptures = await prisma.screenshotCapture.findMany({
      where: {
        userId: review.userId,
        status: 'confirmed',
        confirmedAt: { lte: review.generatedAt },
      },
      orderBy: { confirmedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        documentType: true,
        visionProvider: true,
        confirmedAt: true,
        _count: { select: { rows: true } },
      },
    })

    const report = parseJson<any>(review.reportJson, {})
    const previousReport = parseJson<any>(review.previousRun?.reportJson, {})
    const assets = Array.isArray(report.assets) ? report.assets : []
    const errors = Array.isArray(report.errors) ? report.errors : []
    const candidates = (Array.isArray(report.attentionCandidates) ? report.attentionCandidates : []).map((candidate: any) => ({
      ...candidate,
      ...candidateEvidence(candidate, assets),
    }))
    const executionBoundary = {
      planDraftOnly: report.executionBoundary?.planDraftOnly !== false,
      formalTradingUnlocked: report.executionBoundary?.formalTradingUnlocked === true,
      autoTradeUnlocked: report.executionBoundary?.autoTradeUnlocked === true,
      canCreateOrder: report.executionBoundary?.canCreateOrder === true,
      orderCreateAllowed: report.executionBoundary?.orderCreateAllowed === true,
    }
    const tradeBoundaryDrift = executionBoundary.formalTradingUnlocked
      || executionBoundary.autoTradeUnlocked
      || executionBoundary.canCreateOrder
      || executionBoundary.orderCreateAllowed
    const quoteSources = unique(assets.map((asset: any) => asset?.trend?.quote?.source))
    const quoteWarnings = assets.flatMap((asset: any) => [
      ...(Array.isArray(asset?.trend?.warnings) ? asset.trend.warnings : []),
      ...(Array.isArray(asset?.trend?.dataQuality?.warnings) ? asset.trend.dataQuality.warnings : []),
    ])
    const indicatorCompleteCount = assets.filter((asset: any) => (
      Array.isArray(asset?.trend?.chart)
      && asset.trend.chart.length === 30
      && finite(asset?.trend?.indicators?.ma5)
      && finite(asset?.trend?.indicators?.ma10)
      && finite(asset?.trend?.indicators?.ma30)
    )).length
    const materialCount = assets.filter((asset: any) => asset?.fundamentalAndNews?.level === 'material').length
    const insufficientFactCount = assets.filter((asset: any) => asset?.fundamentalAndNews?.level === 'insufficient').length
    const evidenceRefs = unique(assets.flatMap((asset: any) => asset?.fundamentalAndNews?.evidenceRefs || []))
    const gridBlockers = unique(assets.flatMap((asset: any) => asset?.grid?.blockers || []))
    const orderDraftCount = review.gridPlans.reduce((sum, plan) => sum + plan.orders.length, 0)
    const expectedNonCashAssets = Number(report.portfolio?.reviewedAssets || 0) + errors.length
    const snapshotCounts = {
      positionSnapshots: review.positionSnapshots.length,
      marketSnapshots: review.marketSnapshots.length,
      gridPlans: review.gridPlans.length,
      gridOrderDrafts: orderDraftCount,
    }
    const latestCapture = confirmedCaptures[0] || null
    const captureSummary = {
      confirmedCaptureCount: confirmedCaptures.length,
      confirmedRowCount: confirmedCaptures.reduce((sum, capture) => sum + capture._count.rows, 0),
      latestConfirmedAt: latestCapture?.confirmedAt?.toISOString() || null,
      latestDocumentType: latestCapture?.documentType || null,
      latestVisionProvider: latestCapture?.visionProvider || null,
      latestCaptureRef: latestCapture ? `capture:${latestCapture.id}` : null,
    }

    const nodes: Array<Omit<DailyReviewWorkflowNode, 'purpose' | 'dependsOn'>> = [
      {
        id: 'trigger', sequence: 1, title: '触发评审', status: reviewNodeStatus(review.status), provenance: 'runtime_record',
        inputs: [value('场次', review.sessionType), value('触发来源', review.triggerSource), value('计划时间', review.scheduledFor?.toISOString() || '立即执行')],
        outputs: [value('运行状态', review.status), value('任务进度', `${review.operation?.progressPct || 0}%`), value('任务说明', review.operation?.progressMessage || '无')],
        evidenceRefs: unique([`daily-review:${review.id}`, review.operationId ? `operation:${review.operationId}` : null]),
        blockerCodes: review.status === 'failed' ? ['daily_review_failed'] : [],
      },
      {
        id: 'positions', sequence: 2, title: '持仓快照',
        status: review.positionSnapshots.length >= Number(report.portfolio?.reviewedAssets || 0) ? 'complete' : review.positionSnapshots.length > 0 ? 'partial' : 'blocked',
        provenance: 'runtime_record',
        inputs: [value('当前持仓数', report.portfolio?.positions || 0), value('已确认截图', confirmedCaptures.length), value('截图确认行', captureSummary.confirmedRowCount)],
        outputs: [value('持仓快照', review.positionSnapshots.length), value('成功复盘资产', report.portfolio?.reviewedAssets || 0), value('失败资产', errors.length)],
        evidenceRefs: unique([`PositionSnapshot:${review.positionSnapshots.length}`, captureSummary.latestCaptureRef]),
        blockerCodes: review.positionSnapshots.length === 0 && expectedNonCashAssets > 0 ? ['position_snapshot_missing'] : [],
      },
      {
        id: 'quotes', sequence: 3, title: '行情采集',
        status: assets.length === 0 ? 'blocked' : errors.length > 0 || quoteWarnings.length > 0 ? 'partial' : 'complete',
        provenance: 'runtime_record',
        inputs: [value('请求资产', expectedNonCashAssets), value('行情来源', quoteSources)],
        outputs: [value('成功报价', assets.length), value('行情快照', review.marketSnapshots.length), value('告警数', quoteWarnings.length)],
        evidenceRefs: unique([`MarketSnapshot:${review.marketSnapshots.length}`, ...quoteSources.map((source) => `market-provider:${source}`)]),
        blockerCodes: errors.map((error: any) => `asset_review_error:${text(error.symbol, 'unknown')}`),
      },
      {
        id: 'indicators', sequence: 4, title: '均线计算',
        status: assets.length === 0 ? 'blocked' : indicatorCompleteCount === assets.length ? 'complete' : indicatorCompleteCount > 0 ? 'partial' : 'blocked',
        provenance: 'runtime_record',
        inputs: [value('成功资产', assets.length), value('图表窗口', '30 个完整交易日')],
        outputs: [value('完整 MA 资产', `${indicatorCompleteCount}/${assets.length}`), value('指标', 'MA5 / MA10 / MA30')],
        evidenceRefs: unique(assets.map((asset: any) => asset?.trend?.schemaVersion || 'asset.market-trend.v1')),
        blockerCodes: indicatorCompleteCount < assets.length ? ['indicator_window_incomplete'] : [],
      },
      {
        id: 'fundamentals', sequence: 5, title: '基本面与消息',
        status: assets.length === 0 ? 'blocked' : insufficientFactCount > 0 ? 'partial' : 'complete',
        provenance: 'runtime_record',
        inputs: [value('本轮资产', assets.length), value('上一轮', review.previousRunId || '首轮基线')],
        outputs: [value('重大变化', materialCount), value('证据不足', insufficientFactCount), value('证据引用', evidenceRefs.length)],
        evidenceRefs,
        blockerCodes: insufficientFactCount > 0 ? ['fundamental_or_news_evidence_insufficient'] : [],
      },
      {
        id: 'strategy', sequence: 6, title: '策略评估',
        status: !report.strategy?.assessment ? 'blocked' : report.strategy.assessment.status === 'evidence_insufficient' ? 'partial' : 'complete',
        provenance: 'derived_view',
        inputs: [value('激活策略版本', report.strategy?.activeStrategyVersionIds || []), value('研究兜底', report.strategy?.fallback || '未使用')],
        outputs: [value('总体判断', report.strategy?.assessment?.status), value('结论', report.strategy?.assessment?.conclusion)],
        evidenceRefs: unique([review.adviceId ? `advice:${review.adviceId}` : null, ...evidenceRefs]),
        blockerCodes: report.strategy?.assessment?.status === 'evidence_insufficient' ? ['strategy_evidence_insufficient'] : [],
      },
      {
        id: 'attention', sequence: 7, title: '关注标的',
        status: candidates.length === 0 ? 'empty' : candidates.every((candidate: any) => candidate.source && candidate.reason && candidate.evidenceStatus) ? 'complete' : 'partial',
        provenance: 'derived_view',
        inputs: [value('持仓资产', assets.length), value('候选池日期', report.strategy?.candidatePoolDate || '最新可用')],
        outputs: [value('关注项', candidates.length), value('证据不足项', candidates.filter((candidate: any) => candidate.evidenceStatus === 'insufficient').length)],
        evidenceRefs: unique(candidates.flatMap((candidate: any) => candidate.evidenceRefs || [])),
        blockerCodes: candidates.some((candidate: any) => candidate.evidenceStatus === 'insufficient') ? ['attention_evidence_insufficient'] : [],
      },
      {
        id: 'grid', sequence: 8, title: '系统网格',
        status: assets.length === 0 ? 'empty' : review.gridPlans.length >= assets.length ? 'complete' : review.gridPlans.length > 0 ? 'partial' : 'blocked',
        provenance: 'runtime_record',
        inputs: [value('成功资产', assets.length), value('激活策略版本', report.strategy?.activeStrategyVersionIds || [])],
        outputs: [value('网格计划', review.gridPlans.length), value('人工计划草案档位', orderDraftCount), value('观察计划', review.gridPlans.filter((plan) => plan.status === 'observe_only').length)],
        evidenceRefs: review.gridPlans.map((plan) => `grid-plan:${plan.id}`),
        blockerCodes: gridBlockers,
      },
      {
        id: 'history', sequence: 9, title: '历史比较',
        status: review.previousRun ? 'complete' : 'empty',
        provenance: 'derived_view',
        inputs: [value('上一轮运行', review.previousRun?.id || '无')],
        outputs: [value('上一轮状态', review.previousRun?.status || '首轮基线'), value('上一轮复盘资产', previousReport.portfolio?.reviewedAssets ?? '无')],
        evidenceRefs: review.previousRun ? [`daily-review:${review.previousRun.id}`] : [],
        blockerCodes: review.previousRun ? [] : ['first_run_baseline'],
      },
      {
        id: 'boundary', sequence: 10, title: '执行边界',
        status: tradeBoundaryDrift ? 'blocked' : 'locked',
        provenance: 'runtime_record',
        inputs: [value('研究结果', review.status), value('网格草案', orderDraftCount)],
        outputs: [
          value('formalTradingUnlocked', executionBoundary.formalTradingUnlocked),
          value('autoTradeUnlocked', executionBoundary.autoTradeUnlocked),
          value('canCreateOrder', executionBoundary.canCreateOrder),
          value('orderCreateAllowed', executionBoundary.orderCreateAllowed),
        ],
        evidenceRefs: ['executionBoundary'],
        blockerCodes: tradeBoundaryDrift ? ['trade_boundary_drift'] : ['formal_trading_locked', 'auto_trade_locked'],
      },
    ]

    const enrichedNodes: DailyReviewWorkflowNode[] = nodes.map((node) => ({
      ...node,
      purpose: NODE_GRAPH[node.id]?.purpose || '处理本轮复盘数据。',
      dependsOn: NODE_GRAPH[node.id]?.dependsOn || [],
    }))
    const edges: DailyReviewWorkflowEdge[] = enrichedNodes.flatMap((node) => node.dependsOn.map((source) => ({
      id: `${source}->${node.id}`,
      source,
      target: node.id,
    })))

    return {
      schemaVersion: 'fams.daily-review-audit-workflow.v2',
      generatedAt: new Date().toISOString(),
      reviewId: review.id,
      reviewStatus: review.status,
      sessionType: review.sessionType,
      reviewGeneratedAt: review.generatedAt.toISOString(),
      snapshotCounts,
      captureSummary,
      attentionCandidates: candidates,
      executionBoundary,
      nodes: enrichedNodes,
      edges,
    }
  }
}

export const dailyReviewWorkflowService = new DailyReviewWorkflowService()
