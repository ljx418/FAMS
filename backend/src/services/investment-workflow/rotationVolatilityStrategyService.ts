import { prisma } from '../../db/prisma.js'
import { buildRelativeRotationSeries, type RotationInputPoint } from '../relative-rotation/relativeRotationService.js'
import { gridStrategyService } from '../strategy/gridStrategyService.js'
import { technicalIndicatorService, type TechnicalBar } from '../technical/technicalIndicatorService.js'
import { investmentStrategyResultSchema, type InvestmentStrategyResult } from './investmentStrategyResultContract.js'

const STRATEGY_VERSION = 'rotation-volatility-hierarchical.v1'
const PRECISE_QUOTE_MAX_AGE_MS = 15 * 60 * 1000

type SnapshotBar = {
  tradeDate: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
  provider: string | null
  validationStatus: string
  sourceRefs: unknown[]
}

type SnapshotPosition = {
  positionId: string
  assetId: string
  symbol: string
  name: string
  type: string
  sector?: string | null
  industry?: string | null
  exchange?: string | null
  priceAsOf?: string | null
  quantity: number
  avgCost: number
  currentPrice: number | null
  marketValue: number | null
  accountMarkers: string[]
}

type ResearchSnapshot = {
  id: string
  inputHash: string
  asOf: Date | string
  providerSummary: string[]
  dataHealth: { status?: string; blockers?: string[]; warnings?: string[] }
  evidenceRefs: unknown[]
  input: {
    userId: string
    strategyFamily: string
    positions: SnapshotPosition[]
    dailyBars: Record<string, SnapshotBar[]>
  }
}

type StrategyRunInput = {
  userId: string
  snapshot: ResearchSnapshot
  positionIds?: string[]
  forceRecalculate?: boolean
  materialChange?: 'none' | 'watch' | 'material' | 'insufficient'
}

function normalizeSymbol(value: string) {
  return String(value || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ|SS)$/, '')
}

function numberOrNull(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function average(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function groupKey(position: SnapshotPosition) {
  const classification = String(position.industry || position.sector || '').trim()
  if (!classification) return null
  return position.type === 'etf' ? `ETF:${classification}` : `STOCK:${classification}`
}

function buildEqualWeightBenchmark(positionBars: Array<{ position: SnapshotPosition; bars: SnapshotBar[] }>): RotationInputPoint[] {
  if (positionBars.length < 2) return []
  const maps = positionBars.map(({ bars }) => new Map(bars.map((bar) => [bar.tradeDate, bar.close])))
  const dates = positionBars[0].bars
    .map((bar) => bar.tradeDate)
    .filter((date) => maps.every((map) => Number.isFinite(map.get(date)) && Number(map.get(date)) > 0))
    .sort()
  if (dates.length === 0) return []
  let level = 100
  return dates.map((date, index) => {
    if (index > 0) {
      const previousDate = dates[index - 1]
      const periodReturns = maps.map((map) => Number(map.get(date)) / Number(map.get(previousDate)) - 1)
      level *= 1 + (average(periodReturns) || 0)
    }
    return { date, close: level }
  })
}

function toTechnicalBars(bars: SnapshotBar[]): TechnicalBar[] {
  return bars.map((bar) => ({
    timestamp: new Date(`${bar.tradeDate}T00:00:00.000Z`),
    openPrice: bar.open,
    highPrice: bar.high,
    lowPrice: bar.low,
    closePrice: bar.close,
    volume: bar.volume,
    source: bar.provider,
  }))
}

function latestEvidenceRefs(bars: SnapshotBar[]) {
  const refs = bars.slice(-5).flatMap((bar) => bar.sourceRefs || [])
  return refs.length > 0 ? refs : bars.slice(-5).map((bar) => `canonical:${bar.provider || 'unknown'}:${bar.tradeDate}`)
}

function exactProhibitedActions(): ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] {
  return ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']
}

export class RotationVolatilityStrategyService {
  private async accountBudget(userId: string) {
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
    })
    const portfolioValue = positions.reduce((sum, position) => sum + Number(position.marketValue || 0), 0)
    const cashBudget = positions
      .filter((position) => position.asset.type === 'cash')
      .filter((position) => `${position.tags} ${position.labels}`.toLowerCase().includes('同花顺'))
      .reduce((sum, position) => sum + Number(position.marketValue || position.currentPrice || 0), 0)
    return { portfolioValue, cashBudget }
  }

  private async latestGridPlan(userId: string, assetId: string) {
    return prisma.gridPlan.findFirst({
      where: { userId, assetId },
      include: { orders: { where: { status: { notIn: ['cancelled', 'filled', 'dismissed'] } }, orderBy: [{ side: 'asc' }, { level: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    })
  }

  async run(input: StrategyRunInput) {
    if (input.snapshot.input.strategyFamily !== 'rotation_volatility') {
      throw new Error('Rotation strategy requires a rotation_volatility research snapshot')
    }
    const requestedIds = new Set(input.positionIds || [])
    const selected = input.snapshot.input.positions.filter((position) => requestedIds.size === 0 || requestedIds.has(position.positionId))
    if (selected.length === 0) throw new Error('No requested confirmed rotation positions exist in the research snapshot')
    if (requestedIds.size > 0 && selected.length !== requestedIds.size) {
      throw new Error('Every requested position must exist in the confirmed immutable research snapshot')
    }

    const barsByPosition = input.snapshot.input.positions.map((position) => ({
      position,
      bars: [...(input.snapshot.input.dailyBars[normalizeSymbol(position.symbol)] || [])].sort((left, right) => left.tradeDate.localeCompare(right.tradeDate)),
    }))
    const grouped = new Map<string, typeof barsByPosition>()
    for (const item of barsByPosition) {
      const key = groupKey(item.position)
      if (!key) continue
      grouped.set(key, [...(grouped.get(key) || []), item])
    }
    const { portfolioValue, cashBudget } = await this.accountBudget(input.userId)
    const transactionCountBefore = await prisma.transaction.count({ where: { userId: input.userId } })

    const targets = []
    for (const position of selected) {
      const bars = barsByPosition.find((item) => item.position.positionId === position.positionId)?.bars || []
      const evidenceRefs = latestEvidenceRefs(bars)
      const classification = groupKey(position)
      const peers = classification ? grouped.get(classification) || [] : []
      const benchmark = buildEqualWeightBenchmark(peers)
      const rotation = buildRelativeRotationSeries(
        bars.map((bar) => ({ date: bar.tradeDate, close: bar.close })),
        benchmark,
        'daily',
      )
      const latestRotation = rotation.points.at(-1) || null
      const technicalBars = toTechnicalBars(bars)
      const technical = technicalIndicatorService.buildSnapshotFromBars({ assetId: position.assetId, symbol: position.symbol, bars: technicalBars })
      const previousTechnical = technicalIndicatorService.buildSnapshotFromBars({ assetId: position.assetId, symbol: position.symbol, bars: technicalBars.slice(0, -1) })
      const closes = bars.map((bar) => bar.close)
      const ma30 = closes.length >= 30 ? average(closes.slice(-30)) : null
      const close = closes.at(-1) || null
      const ma5 = numberOrNull(technical.indicators.ma5.value)
      const ma10 = numberOrNull(technical.indicators.ma10.value)
      const macd = technical.indicators.macd.value
      const previousMacd = previousTechnical.indicators.macd.value
      const volumeRatio20 = numberOrNull(technical.indicators.volumeRatio20.value)
      const previousHigh20 = bars.length >= 21 ? Math.max(...bars.slice(-21, -1).map((bar) => Number(bar.high || bar.close))) : null
      const breakout = close !== null && previousHigh20 !== null && close > previousHigh20
      const rrgPassed = peers.length >= 2 && rotation.alignedObservations >= 80 && Boolean(latestRotation && ['leading', 'improving'].includes(latestRotation.quadrant))
      const trendPassed = close !== null && ma30 !== null && ma5 !== null && ma10 !== null && close >= ma30 && ma5 >= ma10
      const macdPassed = Boolean(macd && previousMacd && macd.hist > 0 && macd.hist >= previousMacd.hist)
      const volumePassed = !breakout || (volumeRatio20 !== null && volumeRatio20 >= 1.2)
      const dataBlocked = (input.snapshot.dataHealth.blockers || []).length > 0 || bars.length < 80
      const newBuyGatePassed = !dataBlocked && rrgPassed && trendPassed && macdPassed && volumePassed
      const priceAsOf = position.priceAsOf ? new Date(position.priceAsOf) : null
      const preciseQuoteReady = Boolean(priceAsOf && !Number.isNaN(priceAsOf.getTime()) && Date.now() - priceAsOf.getTime() <= PRECISE_QUOTE_MAX_AGE_MS)
      const materialChange = input.materialChange || 'none'
      const previousPlan = await this.latestGridPlan(input.userId, position.assetId)
      const previousStillValid = Boolean(previousPlan?.validUntil && previousPlan.validUntil.getTime() > Date.now())
      const disposition = previousPlan
        ? materialChange === 'material' || materialChange === 'insufficient' || !previousStillValid
          ? 'invalidate' as const
          : input.forceRecalculate
            ? 'revise' as const
            : 'reuse' as const
        : null
      const previousPlanComparison = previousPlan ? {
        previousPlanId: previousPlan.id,
        disposition: disposition!,
        reasons: disposition === 'reuse'
          ? ['existing_plan_is_current', 'no_material_change', 'existing_grid_takes_priority']
          : disposition === 'revise'
            ? ['user_requested_recalculation', 'previous_plan_retained_for_audit']
            : [previousStillValid ? `material_change_${materialChange}` : 'previous_plan_expired'],
      } : null

      let manualOrderDrafts: InvestmentStrategyResult['manualOrderDrafts'] = []
      let gridBlockers: string[] = []
      if (previousPlan && disposition === 'reuse') {
        manualOrderDrafts = previousPlan.orders.map((order) => ({
          side: order.side.toUpperCase() as 'BUY' | 'SELL',
          price: order.price,
          quantity: order.quantity,
          validUntil: (order.validUntil || previousPlan.validUntil)!.toISOString(),
          rationale: order.rationale || '复用仍在有效期内的既有人工计划网格。',
          invalidationConditions: ['计划到期', '波动状态变化', '出现重大事实变化', '用户明确重算'],
          createsOrder: false as const,
        }))
      } else if (newBuyGatePassed && preciseQuoteReady && close !== null) {
        const draft = gridStrategyService.buildGridDraft({
          config: gridStrategyService.getTemplate('trend_pullback_v1'),
          assetType: position.type,
          market: position.exchange === 'HK' ? 'HK' : 'CN',
          currentPrice: position.currentPrice || close,
          avgCost: position.avgCost,
          quantity: position.quantity,
          cashBudget,
          availablePortfolioBuyBudget: cashBudget,
          portfolioValue,
          currentMarketValue: position.marketValue || position.quantity * (position.currentPrice || close),
          completedBars: bars.length,
          confidence: 1,
          materialChange,
          ma5,
          ma10,
          ma30,
          atr14: numberOrNull(technical.indicators.atr14.value),
          support: technical.indicators.supportResistance20.value?.support || null,
          resistance: technical.indicators.supportResistance20.value?.resistance || null,
        })
        gridBlockers = draft.blockers
        manualOrderDrafts = draft.orders.map((order) => ({
          side: String(order.side).toUpperCase() as 'BUY' | 'SELL',
          price: Number(order.price),
          quantity: Number(order.quantity),
          validUntil: String(order.validUntil),
          rationale: String(order.rationale),
          invalidationConditions: ['跌破 MA30', 'RRG 离开 leading/improving', 'MACD 柱转负', '数据时点失效'],
          createsOrder: false as const,
        }))
      } else {
        if (!newBuyGatePassed) gridBlockers.push('hierarchical_new_buy_gate_not_passed')
        if (!preciseQuoteReady) gridBlockers.push('precise_quote_within_15_minutes_unavailable')
      }

      const blockedReasons = [...new Set([
        ...(classification ? [] : ['peer_classification_missing']),
        ...(peers.length >= 2 ? [] : ['comparable_peer_count_below_two']),
        ...(bars.length >= 80 ? [] : [`completed_daily_bar_count_${bars.length}_below_80`]),
        ...(input.snapshot.dataHealth.blockers || []),
        ...gridBlockers,
      ])]
      const researchSufficient = peers.length >= 2 && bars.length >= 80 && benchmark.length >= 80
      const conclusionStatus: InvestmentStrategyResult['conclusion']['status'] = !researchSufficient
        ? 'insufficient'
        : dataBlocked
          ? 'blocked'
          : manualOrderDrafts.length > 0
            ? 'ready'
            : 'observe'
      const result = investmentStrategyResultSchema.parse({
        schemaVersion: 'fams.investment-strategy-result.v1',
        strategyFamily: 'rotation_volatility',
        strategyVersion: STRATEGY_VERSION,
        inputSnapshotId: input.snapshot.id,
        snapshotHash: input.snapshot.inputHash,
        asOf: new Date(input.snapshot.asOf).toISOString(),
        dataHealth: {
          status: dataBlocked ? (bars.length < 80 ? 'insufficient' : 'stale') : (input.snapshot.dataHealth.status || 'unknown'),
          providers: input.snapshot.providerSummary.length > 0 ? input.snapshot.providerSummary : ['unknown'],
          blockers: input.snapshot.dataHealth.blockers || [],
          warnings: [
            ...(input.snapshot.dataHealth.warnings || []),
            ...(!preciseQuoteReady ? ['缺少 15 分钟内报价，仅展示研究结论，不新生成精确价格和数量。'] : []),
          ],
        },
        conclusion: {
          status: conclusionStatus,
          title: conclusionStatus === 'ready' ? `${position.name} 已形成人工计划清单` : conclusionStatus === 'observe' ? `${position.name} 当前保持观察` : `${position.name} 暂不能形成完整策略结论`,
          summary: manualOrderDrafts.length > 0
            ? `${previousPlanComparison?.disposition === 'reuse' ? '优先复用既有网格' : '五层门控通过并生成新草案'}，共 ${manualOrderDrafts.length} 条；系统不会创建订单。`
            : `RRG、趋势、MACD、成交量与数据时点已逐层检查；当前有 ${blockedReasons.length} 项限制，未生成精确人工计划。`,
        },
        signalLayers: [
          {
            id: 'peer_group', label: '同类比较组', status: classification && peers.length >= 2 ? 'passed' : 'insufficient',
            value: peers.length, threshold: 2,
            reason: classification ? `${classification} 共 ${peers.length} 个已确认同类标的。` : '资产缺少行业或板块分类，禁止跨行业拼接 RRG。', evidenceRefs,
          },
          {
            id: 'rrg_rank', label: 'RRG 相对轮动', status: peers.length < 2 || rotation.alignedObservations < 80 ? 'insufficient' : rrgPassed ? 'passed' : 'failed',
            value: latestRotation?.quadrant || null, threshold: 'leading_or_improving',
            reason: latestRotation ? `最近象限 ${latestRotation.quadrant}，共同日线 ${rotation.alignedObservations}。` : '共同历史不足，无法生成透明相对强度与动量。', evidenceRefs,
          },
          {
            id: 'ma_trend', label: '均线趋势', status: ma30 === null || ma5 === null || ma10 === null || close === null ? 'insufficient' : trendPassed ? 'passed' : 'failed',
            value: close === null ? null : `close=${close.toFixed(3)},MA5=${ma5?.toFixed(3)},MA10=${ma10?.toFixed(3)},MA30=${ma30?.toFixed(3)}`,
            threshold: 'close>=MA30 && MA5>=MA10', reason: trendPassed ? '价格和短期均线满足新增买入趋势门控。' : '价格或短期均线未同时满足趋势门控。', evidenceRefs,
          },
          {
            id: 'macd_momentum', label: 'MACD 动量', status: !macd || !previousMacd ? 'insufficient' : macdPassed ? 'passed' : 'failed',
            value: macd?.hist ?? null, threshold: previousMacd ? `>0 && >=${previousMacd.hist}` : '>0_and_non_decreasing', reason: macdPassed ? 'MACD 柱为正且不低于前一完整交易日。' : 'MACD 动量未通过新增买入门控。', evidenceRefs,
          },
          {
            id: 'volume_confirmation', label: '成交量确认', status: breakout ? volumeRatio20 === null ? 'insufficient' : volumePassed ? 'passed' : 'failed' : 'not_applicable',
            value: volumeRatio20, threshold: breakout ? 1.2 : null, reason: breakout ? `发生 20 日突破，量比 ${volumeRatio20?.toFixed(2) || '不足'}。` : '未发生 20 日价格突破，成交量层不作为阻断项。', evidenceRefs,
          },
          {
            id: 'grid_constraints', label: '网格与交易单位', status: manualOrderDrafts.length > 0 ? 'passed' : preciseQuoteReady ? 'blocked' : 'insufficient',
            value: manualOrderDrafts.length, threshold: 'ATR/tick/lot/cash/position', reason: manualOrderDrafts.length > 0 ? '人工计划已通过价格步长、整手、现金和仓位约束。' : '未满足精确草案所需的数据时点或上游门控。', evidenceRefs,
          },
        ],
        previousPlanComparison,
        manualOrderDrafts,
        invalidationConditions: ['数据时点失效', 'RRG 象限或动量门控失效', '价格跌破 MA30', '重大事实变化', '计划有效期结束'],
        evidenceRefs: [...new Set([...input.snapshot.evidenceRefs, ...evidenceRefs])],
        blockedReasons,
        permissionState: {
          researchAllowed: !dataBlocked,
          manualDraftAllowed: manualOrderDrafts.length > 0,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          canCreateOrder: false,
          orderCreateAllowed: false,
          prohibitedActions: exactProhibitedActions(),
        },
      })
      targets.push({ positionId: position.positionId, assetId: position.assetId, symbol: position.symbol, name: position.name, result })
    }

    const transactionCountAfter = await prisma.transaction.count({ where: { userId: input.userId } })
    if (transactionCountAfter !== transactionCountBefore) throw new Error('Strategy run violated the no-transaction-side-effect invariant')
    return {
      schemaVersion: 'fams.investment-strategy-run.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: 'rotation_volatility' as const,
      inputSnapshotId: input.snapshot.id,
      snapshotHash: input.snapshot.inputHash,
      targets,
      transactionSideEffectCount: 0,
      permissionState: {
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        canCreateOrder: false,
        orderCreateAllowed: false,
        prohibitedActions: exactProhibitedActions(),
      },
    }
  }
}

export const rotationVolatilityStrategyService = new RotationVolatilityStrategyService()
