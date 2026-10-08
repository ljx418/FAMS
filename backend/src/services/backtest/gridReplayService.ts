import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { operationService } from '../operation/operationService.js'
import { ensureUser } from '../../utils/user.js'

const datePattern = /^\d{4}-\d{2}-\d{2}$/

export const gridReplayRequestSchema = z.object({
  userId: z.string().trim().min(1).default('default'),
  assetId: z.string().trim().min(1),
  startDate: z.string().regex(datePattern),
  endDate: z.string().regex(datePattern),
  initialCapital: z.number().positive().optional(),
  initialCash: z.number().min(0).optional(),
  commissionRate: z.number().min(0).max(0.02).default(0.0003),
  minimumCommission: z.number().min(0).max(100).default(5),
  stampDutyRate: z.number().min(0).max(0.02).default(0.0005),
  transferFeeRate: z.number().min(0).max(0.02).default(0.00001),
  slippageRate: z.number().min(0).max(0.02).default(0.0005),
  dataResolution: z.enum(['minute_preferred_daily_conservative', 'daily_conservative']).default('minute_preferred_daily_conservative'),
}).strict()

export const gridReplayOperationSchema = gridReplayRequestSchema.extend({
  idempotencyKey: z.string().trim().min(8).max(180).optional(),
}).strict()

export const gridReplayResultQuerySchema = z.object({
  userId: z.string().trim().min(1),
  operationId: z.string().uuid(),
}).strict()

export type Side = 'buy' | 'sell'
export type SessionPhase = 'pre_open' | 'intraday' | 'after_close'
export type MarkerStatus =
  | 'hit'
  | 'missed'
  | 'ambiguous'
  | 'pending_data'
  | 'insufficient_intraday_evidence'
  | 'blocked_parent_not_filled'
  | 'blocked_sellability'
  | 'blocked_non_actionable'
  | 'superseded'

export type Candle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
  provider: string
  sourceRef: string
  adjustType: string
}

export type IntradayBar = Candle & { timestamp: string; timeframe: string }

type ReplayEvent = {
  id: string
  date: string
  timestamp: string | null
  side: Side
  quantity: number
  price: number
  sourceRef: string
  evidenceResolution: 'minute' | 'daily' | 'actual_transaction'
}

export type Marker = {
  id: string
  planId: string
  strategyVersionId: string | null
  decisionAt: string
  decisionDate: string
  sessionPhase: SessionPhase
  validUntil: string
  effectiveValidUntil: string
  side: Side
  level: number
  price: number
  quantity: number
  orderStatus: string
  status: MarkerStatus
  statusReason: string
  hitDate: string | null
  hitAt: string | null
  evidenceResolution: 'minute' | 'daily' | null
  parentOrderId: string | null
  sourceRef: string
}

export type CostModel = {
  commissionRate: number
  minimumCommission: number
  stampDutyRate: number
  transferFeeRate: number
  slippageRate: number
  stampDutyApplies: boolean
  transferFeeApplies: boolean
}

const round = (value: number, digits = 6) => Number(value.toFixed(digits))
const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try { return JSON.parse(value || '') as T } catch { return fallback }
}

const shanghaiParts = (value: Date | string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(value))
  const pick = (type: string) => parts.find((part) => part.type === type)?.value || '00'
  return { date: `${pick('year')}-${pick('month')}-${pick('day')}`, minutes: Number(pick('hour')) * 60 + Number(pick('minute')) }
}
const dateKey = (value: Date | string) => shanghaiParts(value).date
export const resolveShanghaiSessionPhase = (value: Date | string): SessionPhase => {
  const minutes = shanghaiParts(value).minutes
  if (minutes < 570) return 'pre_open'
  if (minutes <= 900) return 'intraday'
  return 'after_close'
}
const minDate = (...values: Array<Date | null | undefined>) => {
  const present = values.filter((value): value is Date => Boolean(value))
  return present.length > 0 ? new Date(Math.min(...present.map((value) => value.getTime()))) : null
}
const hashStable = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

const numericCashFromObject = (value: unknown): number | null => {
  const preferred = new Set(['availablecash', 'cashbalance', 'cashbudget', 'availableamount', 'availablefunds', 'availablebalance', '可用金额', '资金余额', '可取金额'])
  const queue: unknown[] = [value]
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || typeof current !== 'object') continue
    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (preferred.has(key.replace(/[_\s-]/g, '').toLowerCase()) && typeof child === 'number' && Number.isFinite(child) && child >= 0) return child
      if (child && typeof child === 'object') queue.push(child)
    }
  }
  return null
}
const triggerRef = (trigger: Record<string, unknown>, keys: string[]) => {
  for (const key of keys) {
    const value = trigger[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}
const isFundLike = (assetType: string, symbol: string) => ['fund', 'etf'].includes(assetType.toLowerCase()) || /^(1[56]|5[16])\d{4}/.test(symbol.replace(/\D/g, ''))
const inferLotSize = (assetType: string, symbol: string, constraints: Record<string, unknown>) => {
  const explicit = Number(constraints.lotSize)
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  if (/HK/i.test(symbol)) return 100
  return ['stock', 'fund', 'etf'].includes(assetType.toLowerCase()) ? 100 : 1
}

export const calculateTransactionCosts = (notional: number, side: Side, model: CostModel) => {
  if (notional <= 0) return 0
  return Math.max(model.minimumCommission, notional * model.commissionRate)
    + (side === 'sell' && model.stampDutyApplies ? notional * model.stampDutyRate : 0)
    + (model.transferFeeApplies ? notional * model.transferFeeRate : 0)
}

export const roundBuyQuantityToLot = (quantity: number, lotSize: number) => (
  Math.max(0, Math.floor(Math.max(0, quantity) / lotSize) * lotSize)
)

export const calculateSellableQuantity = (
  lots: Array<{ date: string; quantity: number }>,
  tradeDate: string,
  tPlusOne: boolean,
) => lots.filter((lot) => !tPlusOne || lot.date < tradeDate).reduce((sum, lot) => sum + lot.quantity, 0)

export const evaluateGridOrderEvidence = (input: {
  decisionAt: Date
  validUntil: Date
  side: Side
  limitPrice: number
  dailyBars: Candle[]
  intradayBars: IntradayBar[]
}) => {
  const decisionDate = dateKey(input.decisionAt)
  const validUntilDate = dateKey(input.validUntil)
  const phase = resolveShanghaiSessionPhase(input.decisionAt)
  const reached = (bar: Pick<Candle, 'low' | 'high'>) => input.side === 'buy' ? bar.low <= input.limitPrice : bar.high >= input.limitPrice
  const minuteHit = input.intradayBars.find((bar) => {
    const at = new Date(bar.timestamp)
    return at >= input.decisionAt && at <= input.validUntil && reached(bar)
  })
  const dailyHit = input.dailyBars.find((bar) => (
    bar.date >= decisionDate
    && bar.date <= validUntilDate
    && (bar.date !== decisionDate || phase === 'pre_open')
    && reached(bar)
  ))
  if (minuteHit && (!dailyHit || minuteHit.date <= dailyHit.date)) return {
    status: 'hit' as const,
    reason: 'price_reached_in_post_decision_intraday_bar',
    hitDate: minuteHit.date,
    hitAt: minuteHit.timestamp,
    evidenceResolution: 'minute' as const,
  }
  if (dailyHit) return {
    status: 'hit' as const,
    reason: dailyHit.date === decisionDate ? 'pre_open_order_reached_in_same_day_daily_bar' : 'price_reached_in_later_daily_bar',
    hitDate: dailyHit.date,
    hitAt: null,
    evidenceResolution: 'daily' as const,
  }
  const observedThrough = input.dailyBars.at(-1)?.date || null
  const hasMinuteEvidence = input.intradayBars.some((bar) => {
    const at = new Date(bar.timestamp)
    return at >= input.decisionAt && at <= input.validUntil
  })
  if (phase === 'intraday' && validUntilDate === decisionDate && !hasMinuteEvidence) return {
    status: 'insufficient_intraday_evidence' as const,
    reason: 'daily_ohlc_cannot_prove_post_decision_intraday_trigger',
    hitDate: null,
    hitAt: null,
    evidenceResolution: null,
  }
  if (!observedThrough || validUntilDate > observedThrough) return {
    status: 'pending_data' as const,
    reason: 'market_data_does_not_cover_full_validity_window',
    hitDate: null,
    hitAt: null,
    evidenceResolution: null,
  }
  return {
    status: 'missed' as const,
    reason: 'price_not_reached_within_evidenced_validity',
    hitDate: null,
    hitAt: null,
    evidenceResolution: null,
  }
}

export const resolvePlanEffectiveValidity = (plans: Array<{
  id: string
  mode: string
  previousPlanId: string | null
  parentScope: string
  createdAt: Date
  validUntil: Date | null
}>) => {
  const result = new Map<string, Date>()
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index]
    const successor = plans.slice(index + 1).find((candidate) => (
      candidate.previousPlanId === plan.id
      || (candidate.mode === plan.mode && candidate.parentScope === plan.parentScope)
    ))
    result.set(plan.id, minDate(plan.validUntil, successor?.createdAt) || plan.createdAt)
  }
  return result
}

export const applyParentChildActivation = <T extends Pick<Marker,
  'id' | 'parentOrderId' | 'status' | 'statusReason' | 'hitDate' | 'hitAt' | 'evidenceResolution'
>>(markers: T[]) => {
  const byId = new Map(markers.map((marker) => [marker.id, marker]))
  for (const marker of markers) {
    if (!marker.parentOrderId || !['hit', 'missed', 'pending_data', 'insufficient_intraday_evidence'].includes(marker.status)) continue
    const parent = byId.get(marker.parentOrderId)
    if (!parent || parent.status !== 'hit' || !parent.hitDate) {
      marker.status = 'blocked_parent_not_filled'
      marker.statusReason = parent ? `parent_order_${parent.status}` : 'parent_order_not_found_in_replay_window'
      marker.hitDate = null; marker.hitAt = null; marker.evidenceResolution = null
    } else if (marker.hitDate === parent.hitDate && (!marker.hitAt || !parent.hitAt || marker.hitAt <= parent.hitAt)) {
      marker.status = 'ambiguous'
      marker.statusReason = 'daily_or_equal_time_evidence_cannot_prove_parent_filled_before_child'
    } else if (marker.hitDate && marker.hitDate < parent.hitDate) {
      marker.status = 'blocked_parent_not_filled'
      marker.statusReason = 'child_price_was_reached_before_parent_fill'
      marker.hitDate = null; marker.hitAt = null; marker.evidenceResolution = null
    }
  }
  return markers
}

class GridReplayService {
  async listSources(userId = 'default') {
    await ensureUser(prisma, userId)
    const [positions, planAssets] = await Promise.all([
      prisma.position.findMany({ where: { userId }, include: { asset: true, strategyAssignment: true }, orderBy: [{ status: 'asc' }, { marketValue: 'desc' }] }),
      prisma.gridPlan.findMany({ where: { userId }, select: { assetId: true }, distinct: ['assetId'] }),
    ])
    const positionByAsset = new Map<string, typeof positions[number]>()
    for (const position of positions) {
      const existing = positionByAsset.get(position.assetId)
      if (!existing || (position.status === 'open' && existing.status !== 'open')) positionByAsset.set(position.assetId, position)
    }
    const assetIds = Array.from(new Set([...positionByAsset.keys(), ...planAssets.map((item) => item.assetId)]))
    const [assets, plans] = await Promise.all([
      prisma.asset.findMany({ where: { id: { in: assetIds } }, orderBy: { symbol: 'asc' } }),
      assetIds.length ? prisma.gridPlan.findMany({ where: { userId, assetId: { in: assetIds } }, include: { orders: true }, orderBy: { createdAt: 'desc' } }) : [],
    ])
    const summaryByAsset = new Map<string, { planCount: number; orderCount: number; latestPlanAt: string | null }>()
    for (const plan of plans) {
      const current = summaryByAsset.get(plan.assetId) || { planCount: 0, orderCount: 0, latestPlanAt: null }
      current.planCount += 1
      current.orderCount += plan.orders.length
      current.latestPlanAt ||= plan.createdAt.toISOString()
      summaryByAsset.set(plan.assetId, current)
    }
    const latestBars = await Promise.all(assets.map(async (asset) => {
      const bare = asset.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, '')
      const bar = await prisma.marketBarCanonical.findFirst({
        where: { OR: [{ assetId: asset.id }, { symbol: { in: [asset.symbol, bare] } }], timeframe: '1d', adjustType: 'none' },
        orderBy: { tradeDate: 'desc' }, select: { tradeDate: true },
      })
      const history = bar ? null : await prisma.priceHistory.findFirst({ where: { assetId: asset.id, isValid: true }, orderBy: { timestamp: 'desc' }, select: { timestamp: true } })
      return [asset.id, bar ? dateKey(bar.tradeDate) : history ? dateKey(history.timestamp) : null] as const
    }))
    const observed = new Map(latestBars)
    return {
      schemaVersion: 'fams.backtest.grid_replay_sources.v2', generatedAt: new Date().toISOString(),
      sources: assets.map((asset) => {
        const position = positionByAsset.get(asset.id)
        const summary = summaryByAsset.get(asset.id) || { planCount: 0, orderCount: 0, latestPlanAt: null }
        const blockers = [...(summary.orderCount ? [] : ['saved_grid_orders_missing']), ...(observed.get(asset.id) ? [] : ['unadjusted_real_ohlc_missing'])]
        return {
          positionId: position?.id || null, positionStatus: position?.status || 'historical_plan_only', assetId: asset.id,
          symbol: asset.symbol, name: asset.name, assetType: asset.type, quantity: position?.quantity || 0, marketValue: position?.marketValue || null,
          strategyFamily: position?.strategyAssignment?.strategyFamily || 'unclassified', assignmentStatus: position?.strategyAssignment?.status || 'unassigned',
          ...summary, observedThrough: observed.get(asset.id) || null, replayReady: blockers.length === 0, blockers,
        }
      }),
      allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE'], prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'], notTradingAdvice: true,
    }
  }

  private async loadCandles(assetId: string, symbol: string, startDate: string, endDate: string) {
    const bare = symbol.replace(/\.(SH|SZ|BJ|SS)$/i, '')
    const start = new Date(`${startDate}T00:00:00.000Z`)
    const end = new Date(`${endDate}T23:59:59.999Z`)
    const rows = await prisma.marketBarCanonical.findMany({
      where: { OR: [{ assetId }, { symbol: { in: [symbol, bare] } }], timeframe: '1d', tradeDate: { gte: start, lte: end }, closePrice: { gt: 0 } },
      orderBy: [{ tradeDate: 'asc' }, { updatedAt: 'desc' }],
    })
    const byDate = new Map<string, Candle>()
    const scores = new Map<string, number>()
    for (const row of rows) {
      const date = dateKey(row.tradeDate)
      const score = (row.adjustType === 'none' ? 100 : row.adjustType === 'adjusted' ? 10 : 0) + (row.dataVersion === 'canonical.v1' ? 2 : 0)
      if ((scores.get(date) ?? -1) >= score) continue
      scores.set(date, score)
      byDate.set(date, { date, open: Number(row.openPrice || row.closePrice), high: Number(row.highPrice || row.closePrice), low: Number(row.lowPrice || row.closePrice), close: row.closePrice, volume: row.volume, provider: row.primaryProvider || 'market_bar_canonical', sourceRef: `market-bar-canonical:${row.id}`, adjustType: row.adjustType })
    }
    if (!byDate.size) {
      const history = await prisma.priceHistory.findMany({ where: { assetId, isValid: true, timestamp: { gte: start, lte: end }, closePrice: { gt: 0 } }, orderBy: { timestamp: 'asc' } })
      for (const row of history) {
        const date = dateKey(row.timestamp)
        byDate.set(date, { date, open: Number(row.openPrice || row.closePrice), high: Number(row.highPrice || row.closePrice), low: Number(row.lowPrice || row.closePrice), close: row.closePrice, volume: row.volume, provider: row.source || 'price_history', sourceRef: `price-history:${row.id}`, adjustType: 'none' })
      }
    }
    return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date))
  }

  private async loadIntradayBars(assetId: string, symbol: string, startDate: string, endDate: string) {
    const bare = symbol.replace(/\.(SH|SZ|BJ|SS)$/i, '')
    const rows = await prisma.marketBarCanonical.findMany({
      where: { OR: [{ assetId }, { symbol: { in: [symbol, bare] } }], timeframe: { not: '1d' }, tradeTime: { not: null }, tradeDate: { gte: new Date(`${startDate}T00:00:00.000Z`), lte: new Date(`${endDate}T23:59:59.999Z`) }, closePrice: { gt: 0 } },
      orderBy: [{ tradeTime: 'asc' }, { updatedAt: 'desc' }],
    })
    const seen = new Set<string>()
    const bars: IntradayBar[] = []
    for (const row of rows) {
      if (!row.tradeTime) continue
      const key = `${row.tradeTime.toISOString()}:${row.timeframe}`
      if (seen.has(key)) continue
      seen.add(key)
      bars.push({ timestamp: row.tradeTime.toISOString(), timeframe: row.timeframe, date: dateKey(row.tradeTime), open: Number(row.openPrice || row.closePrice), high: Number(row.highPrice || row.closePrice), low: Number(row.lowPrice || row.closePrice), close: row.closePrice, volume: row.volume, provider: row.primaryProvider || 'market_bar_canonical', sourceRef: `market-bar-canonical:${row.id}`, adjustType: row.adjustType })
    }
    return bars
  }

  private costs(notional: number, side: Side, model: CostModel) {
    return calculateTransactionCosts(notional, side, model)
  }

  private buildScenario(
    id: 'follow_grid' | 'hold_without_grid' | 'actual_transactions', candles: Candle[], initialQuantity: number, initialCash: number,
    events: ReplayEvent[], lotSize: number, tPlusOne: boolean, costModel: CostModel,
  ) {
    let quantity = initialQuantity
    let cash = initialCash
    const lots: Array<{ date: string; quantity: number; unitCost: number }> = initialQuantity > 0 ? [{ date: '0000-00-00', quantity: initialQuantity, unitCost: candles[0]?.close || 0 }] : []
    const eventsByDate = new Map<string, ReplayEvent[]>()
    for (const event of events) eventsByDate.set(event.date, [...(eventsByDate.get(event.date) || []), event])
    const executedEvents: Array<ReplayEvent & { fillPrice: number; requestedQuantity: number; executedQuantity: number; fee: number; blockedQuantity: number; blockReason: string | null; realizedPnl: number | null }> = []
    const curve: Array<{ date: string; equity: number; cumulativeReturnPercent: number; drawdownPercent: number; cash: number; quantity: number; exposurePercent: number }> = []
    const realized: number[] = []
    let baseline = 0
    let peak = 0
    let grossTurnover = 0
    let totalFees = 0
    for (const candle of candles) {
      const dailyEvents = [...(eventsByDate.get(candle.date) || [])].sort((a, b) => (a.timestamp || `${a.date}T15:00:00`).localeCompare(b.timestamp || `${b.date}T15:00:00`))
      for (const event of dailyEvents) {
        const fillPrice = event.price * (event.side === 'buy' ? 1 + costModel.slippageRate : 1 - costModel.slippageRate)
        const requestedQuantity = Math.max(0, event.quantity)
        let executedQuantity = 0
        let blockReason: string | null = null
        let eventRealized: number | null = null
        if (event.side === 'buy') {
          executedQuantity = roundBuyQuantityToLot(Math.min(requestedQuantity, fillPrice > 0 ? cash / fillPrice : 0), lotSize)
          while (executedQuantity > 0 && executedQuantity * fillPrice + this.costs(executedQuantity * fillPrice, 'buy', costModel) > cash) executedQuantity -= lotSize
          if (executedQuantity <= 0) blockReason = cash <= 0 ? 'insufficient_cash' : 'lot_size_or_cost_constraint'
          if (executedQuantity > 0) {
            const notional = executedQuantity * fillPrice
            const fee = this.costs(notional, 'buy', costModel)
            cash -= notional + fee
            quantity += executedQuantity
            lots.push({ date: candle.date, quantity: executedQuantity, unitCost: (notional + fee) / executedQuantity })
            grossTurnover += notional; totalFees += fee
            executedEvents.push({ ...event, fillPrice: round(fillPrice), requestedQuantity, executedQuantity, fee: round(fee), blockedQuantity: round(requestedQuantity - executedQuantity, 4), blockReason, realizedPnl: null })
          }
        } else {
          const sellable = calculateSellableQuantity(lots, candle.date, tPlusOne)
          executedQuantity = Math.min(requestedQuantity, quantity, sellable)
          if (executedQuantity < requestedQuantity && executedQuantity > lotSize) executedQuantity = Math.floor(executedQuantity / lotSize) * lotSize
          if (executedQuantity <= 0) blockReason = sellable <= 0 ? 't_plus_one_or_sellability_constraint' : 'position_insufficient'
          if (executedQuantity > 0) {
            const notional = executedQuantity * fillPrice
            const fee = this.costs(notional, 'sell', costModel)
            let remaining = executedQuantity; let matchedCost = 0
            for (const lot of lots) {
              if (remaining <= 0 || (tPlusOne && lot.date >= candle.date)) continue
              const matched = Math.min(remaining, lot.quantity)
              lot.quantity -= matched; remaining -= matched; matchedCost += matched * lot.unitCost
            }
            cash += notional - fee; quantity -= executedQuantity; eventRealized = notional - fee - matchedCost
            realized.push(eventRealized); grossTurnover += notional; totalFees += fee
            executedEvents.push({ ...event, fillPrice: round(fillPrice), requestedQuantity, executedQuantity, fee: round(fee), blockedQuantity: round(requestedQuantity - executedQuantity, 4), blockReason, realizedPnl: round(eventRealized) })
          }
        }
        if (executedQuantity <= 0) executedEvents.push({ ...event, fillPrice: round(fillPrice), requestedQuantity, executedQuantity: 0, fee: 0, blockedQuantity: requestedQuantity, blockReason, realizedPnl: eventRealized })
      }
      const invested = Math.max(0, quantity * candle.close)
      const equity = Math.max(0, cash + invested)
      if (!curve.length) baseline = equity
      peak = Math.max(peak, equity)
      curve.push({ date: candle.date, equity: round(equity, 2), cumulativeReturnPercent: round(baseline > 0 ? (equity / baseline - 1) * 100 : 0), drawdownPercent: round(peak > 0 ? (equity / peak - 1) * 100 : 0), cash: round(cash, 2), quantity: round(quantity, 4), exposurePercent: round(equity > 0 ? invested / equity * 100 : 0) })
    }
    const returns = curve.slice(1).map((point, index) => curve[index].equity > 0 ? point.equity / curve[index].equity - 1 : 0)
    const mean = returns.length ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0
    const variance = returns.length > 1 ? returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1) : 0
    const downside = returns.filter((value) => value < 0)
    const downsideDeviation = downside.length ? Math.sqrt(downside.reduce((sum, value) => sum + value ** 2, 0) / downside.length) : 0
    const gains = realized.filter((value) => value > 0).reduce((sum, value) => sum + value, 0)
    const losses = Math.abs(realized.filter((value) => value < 0).reduce((sum, value) => sum + value, 0))
    const startValue = curve[0]?.equity || 0
    return {
      id, label: id === 'follow_grid' ? '计划触发模拟' : id === 'hold_without_grid' ? '不执行建议' : '已确认归因的实际成交', curve,
      metrics: {
        totalReturnPercent: curve.at(-1)?.cumulativeReturnPercent ?? null,
        annualizedReturnPercent: curve.length > 1 && startValue > 0 ? round(((curve.at(-1)!.equity / startValue) ** (252 / (curve.length - 1)) - 1) * 100) : null,
        maxDrawdownPercent: curve.length ? round(Math.min(...curve.map((point) => point.drawdownPercent))) : null,
        sharpeRatio: variance > 0 ? round(mean / Math.sqrt(variance) * Math.sqrt(252)) : null,
        sortinoRatio: downsideDeviation > 0 ? round(mean / downsideDeviation * Math.sqrt(252)) : null,
        startValue: curve[0]?.equity ?? null, endValue: curve.at(-1)?.equity ?? null,
        executedEventCount: executedEvents.filter((event) => event.executedQuantity > 0).length,
        blockedEventCount: executedEvents.filter((event) => event.executedQuantity <= 0).length,
        completedCycles: realized.length, profitFactor: losses > 0 ? round(gains / losses) : gains > 0 ? null : 0,
        turnoverPercent: startValue > 0 ? round(grossTurnover / startValue * 100) : null, totalFees: round(totalFees, 2),
        averageExposurePercent: curve.length ? round(curve.reduce((sum, point) => sum + point.exposurePercent, 0) / curve.length) : null,
        endingCash: curve.at(-1)?.cash ?? null, endingQuantity: curve.at(-1)?.quantity ?? null,
      },
      executedEvents,
    }
  }

  async replay(request: unknown) {
    const input = gridReplayRequestSchema.parse(request)
    await ensureUser(prisma, input.userId)
    if (input.startDate > input.endDate) throw Object.assign(new Error('startDate must not be after endDate'), { statusCode: 400 })
    const asset = await prisma.asset.findFirst({ where: { id: input.assetId, OR: [{ positions: { some: { userId: input.userId } } }, { gridPlans: { some: { userId: input.userId } } }] } })
    if (!asset) throw Object.assign(new Error('asset with position or saved grid plan not found'), { statusCode: 404 })
    const position = await prisma.position.findFirst({ where: { userId: input.userId, assetId: input.assetId }, include: { strategyAssignment: true }, orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }] })
    const allPlans = await prisma.gridPlan.findMany({
      where: { userId: input.userId, assetId: input.assetId, createdAt: { lte: new Date(`${input.endDate}T23:59:59.999Z`) }, orders: { some: {} } },
      include: { orders: { orderBy: [{ side: 'asc' }, { level: 'asc' }] }, dailyReviewRun: { include: { positionSnapshots: true } } }, orderBy: { createdAt: 'asc' },
    })
    const plans = allPlans.filter((plan) => dateKey(plan.validUntil || plan.createdAt) >= input.startDate)
    const firstPlanDate = plans[0] ? dateKey(plans[0].createdAt) : input.startDate
    const actualStartDate = firstPlanDate > input.startDate ? firstPlanDate : input.startDate
    const [candles, intradayBars] = await Promise.all([
      this.loadCandles(input.assetId, asset.symbol, actualStartDate, input.endDate),
      input.dataResolution === 'minute_preferred_daily_conservative' ? this.loadIntradayBars(input.assetId, asset.symbol, actualStartDate, input.endDate) : Promise.resolve([]),
    ])
    const blockers: string[] = []
    const warnings: string[] = []
    if (!plans.length) blockers.push('saved_grid_plan_missing_in_requested_window')
    if (candles.length < 2) blockers.push('real_ohlc_timeline_insufficient')
    if (candles.some((candle) => candle.adjustType !== 'none')) blockers.push('absolute_order_price_requires_unadjusted_bars')
    const earliestPlanSnapshot = plans[0]?.dailyReviewRun?.positionSnapshots.find((snapshot) => snapshot.assetId === input.assetId)
    const historicalSnapshot = await prisma.positionSnapshot.findFirst({ where: { userId: input.userId, assetId: input.assetId, capturedAt: { lte: new Date(`${actualStartDate}T23:59:59.999Z`) } }, orderBy: { capturedAt: 'desc' } })
    const initialSnapshot = earliestPlanSnapshot || historicalSnapshot
    if (!initialSnapshot && !position) blockers.push('position_snapshot_missing_at_replay_start')
    if (!initialSnapshot) warnings.push('current_position_used_because_historical_snapshot_missing')
    const initialQuantity = Number(initialSnapshot?.quantity ?? position?.quantity ?? 0)
    const initialPrice = Number(candles[0]?.close || initialSnapshot?.currentPrice || position?.currentPrice || position?.avgCost || 0)
    const reportCash = numericCashFromObject(parseJson<Record<string, unknown>>(plans[0]?.dailyReviewRun?.reportJson, {}))
    const initialCash = input.initialCash ?? (input.initialCapital !== undefined ? Math.max(0, input.initialCapital - initialQuantity * initialPrice) : reportCash ?? 0)
    if (input.initialCash === undefined && input.initialCapital === undefined && reportCash === null) warnings.push('account_cash_snapshot_missing_assumed_zero')
    const initialCapital = initialCash + initialQuantity * initialPrice
    const constraintsByPlan = new Map(plans.map((plan) => [plan.id, parseJson<Record<string, unknown>>(plan.constraintsJson, {})]))
    const parentScope = (planId: string) => typeof constraintsByPlan.get(planId)?.parentGridPlanId === 'string' ? String(constraintsByPlan.get(planId)?.parentGridPlanId) : 'root'
    const effectiveUntilByPlan = resolvePlanEffectiveValidity(plans.map((plan) => ({
      id: plan.id,
      mode: plan.mode,
      previousPlanId: plan.previousPlanId,
      parentScope: parentScope(plan.id),
      createdAt: plan.createdAt,
      validUntil: plan.validUntil,
    })))
    const orderRefToId = new Map<string, string>()
    for (const plan of plans) for (const order of plan.orders) {
      const ref = triggerRef(parseJson(order.triggerConditionJson, {}), ['orderRef'])
      if (ref) orderRefToId.set(ref, order.id)
    }
    const activeStatuses = new Set(['active', 'proposed', 'awaiting_parent_fill', 'awaiting_sellability'])
    const markers: Marker[] = []
    const semanticOrders = new Set<string>()
    for (const plan of plans) {
      const decisionAt = plan.createdAt
      const decisionDate = dateKey(decisionAt)
      const phase = resolveShanghaiSessionPhase(decisionAt)
      for (const order of plan.orders) {
        const side: Side = order.side === 'sell' ? 'sell' : 'buy'
        const originalUntil = minDate(order.validUntil, plan.validUntil) || plan.createdAt
        const effectiveUntil = minDate(originalUntil, effectiveUntilByPlan.get(plan.id)) || originalUntil
        const validUntil = dateKey(originalUntil)
        const effectiveValidUntil = dateKey(effectiveUntil)
        const semanticKey = `${decisionAt.toISOString()}:${effectiveUntil.toISOString()}:${side}:${order.level}:${round(order.price, 4)}:${round(order.quantity, 4)}`
        if (semanticOrders.has(semanticKey)) continue
        semanticOrders.add(semanticKey)
        const trigger = parseJson<Record<string, unknown>>(order.triggerConditionJson, {})
        const rawParent = triggerRef(trigger, ['parentOrderDraftId', 'parentOrderId', 'parentOrderRef'])
        const parentOrderId = rawParent ? orderRefToId.get(rawParent) || rawParent : null
        let status: MarkerStatus = 'missed'; let statusReason = 'price_not_reached_within_evidenced_validity'
        let hitDate: string | null = null; let hitAt: string | null = null; let evidenceResolution: 'minute' | 'daily' | null = null
        if (!activeStatuses.has(order.status)) { status = 'blocked_non_actionable'; statusReason = `order_status_${order.status}_is_not_actionable` }
        else if (order.status === 'awaiting_sellability') { status = 'blocked_sellability'; statusReason = 'order_was_waiting_for_sellable_quantity' }
        else if (effectiveUntil < decisionAt) { status = 'superseded'; statusReason = 'plan_superseded_before_order_activation' }
        else {
          const evidence = evaluateGridOrderEvidence({ decisionAt, validUntil: effectiveUntil, side, limitPrice: order.price, dailyBars: candles, intradayBars })
          status = evidence.status
          statusReason = evidence.reason
          hitDate = evidence.hitDate
          hitAt = evidence.hitAt
          evidenceResolution = evidence.evidenceResolution
          if (status === 'missed' && effectiveUntil < originalUntil) { status = 'superseded'; statusReason = 'order_expired_when_a_new_plan_superseded_it' }
        }
        markers.push({ id: order.id, planId: plan.id, strategyVersionId: plan.strategyVersionId, decisionAt: decisionAt.toISOString(), decisionDate, sessionPhase: phase, validUntil, effectiveValidUntil, side, level: order.level, price: order.price, quantity: order.quantity, orderStatus: order.status, status, statusReason, hitDate, hitAt, evidenceResolution, parentOrderId, sourceRef: `grid-order-draft:${order.id}` })
      }
    }
    applyParentChildActivation(markers)
    const directions = new Map<string, Set<Side>>()
    for (const marker of markers.filter((item) => item.status === 'hit' && item.hitDate && item.evidenceResolution === 'daily')) {
      const key = `${marker.planId}:${marker.hitDate}`; directions.set(key, new Set([...(directions.get(key) || []), marker.side]))
    }
    for (const marker of markers) if (marker.status === 'hit' && marker.hitDate && marker.evidenceResolution === 'daily' && directions.get(`${marker.planId}:${marker.hitDate}`)?.size === 2) { marker.status = 'ambiguous'; marker.statusReason = 'daily_ohlc_cannot_prove_two_sided_execution_sequence' }
    const gridEvents: ReplayEvent[] = markers.filter((marker) => marker.status === 'hit' && marker.hitDate).map((marker) => ({ id: marker.id, date: marker.hitDate!, timestamp: marker.hitAt, side: marker.side, quantity: marker.quantity, price: marker.price, sourceRef: marker.sourceRef, evidenceResolution: marker.evidenceResolution || 'daily' }))
    const actualReplayStart = initialSnapshot?.capturedAt || new Date(`${actualStartDate}T00:00:00.000Z`)
    const transactions = await prisma.transaction.findMany({
      where: { userId: input.userId, assetId: input.assetId, status: 'confirmed', type: { in: ['buy', 'sell'] }, executedAt: { gt: actualReplayStart, lte: new Date(`${input.endDate}T23:59:59.999Z`) } },
      include: {
        planExecutionLinks: {
          where: { matchStatus: 'confirmed' },
          include: { gridOrderDraft: { include: { gridPlan: true } } },
        },
      },
      orderBy: { executedAt: 'asc' },
    })
    const replayPlanIds = new Set(plans.map((plan) => plan.id))
    const attributedTransactions = transactions.flatMap((transaction) => {
      const link = transaction.planExecutionLinks.find((candidate) => candidate.gridOrderDraft?.gridPlan
        && replayPlanIds.has(candidate.gridOrderDraft.gridPlan.id))
      return link ? [{ transaction, link, draft: link.gridOrderDraft! }] : []
    })
    const unattributedTransactions = transactions.filter((transaction) => !attributedTransactions.some((item) => item.transaction.id === transaction.id))
    const actualEvents: ReplayEvent[] = attributedTransactions.map(({ transaction, link }) => ({
      id: transaction.id,
      date: dateKey(transaction.executedAt),
      timestamp: transaction.executedAt.toISOString(),
      side: transaction.type === 'sell' ? 'sell' : 'buy',
      quantity: Math.abs(transaction.quantity),
      price: transaction.price,
      sourceRef: `plan-execution-link:${link.id}:transaction:${transaction.id}`,
      evidenceResolution: 'actual_transaction',
    }))
    const lotSize = inferLotSize(asset.type, asset.symbol, plans[0] ? constraintsByPlan.get(plans[0].id) || {} : {})
    const tPlusOne = ['stock', 'etf', 'fund'].includes(asset.type.toLowerCase()) && !/HK|US/i.test(`${asset.exchange || ''}${asset.symbol}`)
    const costModel: CostModel = { commissionRate: input.commissionRate, minimumCommission: input.minimumCommission, stampDutyRate: input.stampDutyRate, transferFeeRate: input.transferFeeRate, slippageRate: input.slippageRate, stampDutyApplies: !isFundLike(asset.type, asset.symbol), transferFeeApplies: !isFundLike(asset.type, asset.symbol) && /SH|SS|^6/i.test(`${asset.exchange || ''}${asset.symbol}`) }
    const scenarios = candles.length >= 2 ? [
      this.buildScenario('follow_grid', candles, initialQuantity, initialCash, gridEvents, lotSize, tPlusOne, costModel),
      this.buildScenario('hold_without_grid', candles, initialQuantity, initialCash, [], lotSize, tPlusOne, costModel),
      this.buildScenario('actual_transactions', candles, initialQuantity, initialCash, actualEvents, lotSize, tPlusOne, { ...costModel, slippageRate: 0 }),
    ] : []
    const follow = scenarios.find((scenario) => scenario.id === 'follow_grid')
    const hold = scenarios.find((scenario) => scenario.id === 'hold_without_grid')
    const actual = scenarios.find((scenario) => scenario.id === 'actual_transactions')
    const alpha = follow?.metrics.totalReturnPercent != null && hold?.metrics.totalReturnPercent != null ? round(follow.metrics.totalReturnPercent - hold.metrics.totalReturnPercent) : null
    const drawdownDelta = follow?.metrics.maxDrawdownPercent != null && hold?.metrics.maxDrawdownPercent != null ? round(follow.metrics.maxDrawdownPercent - hold.metrics.maxDrawdownPercent) : null
    const actualAlpha = actual?.metrics.totalReturnPercent != null && hold?.metrics.totalReturnPercent != null ? round(actual.metrics.totalReturnPercent - hold.metrics.totalReturnPercent) : null
    const attributedDrafts = new Map<string, { quantity: number; draftQuantity: number }>()
    for (const item of attributedTransactions) {
      const current = attributedDrafts.get(item.draft.id) || { quantity: 0, draftQuantity: item.draft.quantity }
      current.quantity += Math.abs(item.transaction.quantity)
      attributedDrafts.set(item.draft.id, current)
    }
    const executedDraftCount = attributedDrafts.size
    const partialDraftCount = [...attributedDrafts.values()].filter((item) => item.quantity > 0 && item.quantity < item.draftQuantity - 0.000001).length
    const matchedTriggeredDraftCount = markers.filter((marker) => marker.status === 'hit' && attributedDrafts.has(marker.id)).length
    const attributedQuantity = attributedTransactions.reduce((sum, item) => sum + Math.abs(item.transaction.quantity), 0)
    const weightedSlippage = attributedQuantity > 0
      ? attributedTransactions.reduce((sum, item) => {
          const signed = item.transaction.type === 'buy' ? item.transaction.price - item.draft.price : item.draft.price - item.transaction.price
          return sum + signed * Math.abs(item.transaction.quantity)
        }, 0) / attributedQuantity
      : null
    const attributionCoverage = transactions.length > 0 ? attributedTransactions.length / transactions.length : null
    const evidenced = markers.filter((marker) => ['hit', 'missed'].includes(marker.status)).length
    const evidenceConfidence = markers.length ? evidenced / markers.length : 0
    if (markers.some((marker) => marker.status === 'insufficient_intraday_evidence')) blockers.push('post_decision_intraday_evidence_missing')
    const verdict = evidenceConfidence < 0.8 ? 'insufficient_evidence' : !gridEvents.length ? 'no_triggered_advice_to_evaluate' : candles.length < 60 ? (alpha !== null && alpha > 0 ? 'preliminary_positive' : alpha !== null && alpha < 0 ? 'preliminary_negative' : 'preliminary_neutral') : (alpha !== null && alpha > 0 ? 'positive' : alpha !== null && alpha < 0 ? 'negative' : 'neutral')
    const frozenInput = { engineVersion: 'grid-replay.v3', userId: input.userId, assetId: input.assetId, requestedStartDate: input.startDate, actualStartDate, endDate: input.endDate, initialSnapshotId: initialSnapshot?.id || null, initialQuantity, initialCash, planIds: plans.map((plan) => plan.id), strategyVersionIds: Array.from(new Set(plans.map((plan) => plan.strategyVersionId).filter(Boolean))), candleRefs: candles.map((candle) => candle.sourceRef), intradayBarRefs: intradayBars.map((bar) => bar.sourceRef), transactionIds: transactions.map((transaction) => transaction.id), confirmedExecutionLinkIds: attributedTransactions.map((item) => item.link.id), costModel, lotSize, tPlusOne }
    const status = blockers.length === 0 && evidenceConfidence >= 0.8 && evidenced > 0 ? 'available' : 'insufficient'
    return {
      schemaVersion: 'fams.backtest.grid_replay.v3', engineVersion: 'grid-replay.v3', generatedAt: new Date().toISOString(), status,
      asset: { assetId: asset.id, symbol: asset.symbol, name: asset.name, assetType: asset.type, strategyFamily: position?.strategyAssignment?.strategyFamily || 'unclassified', assignmentStatus: position?.strategyAssignment?.status || 'unassigned' },
      requestedPeriod: { startDate: input.startDate, endDate: input.endDate }, actualPeriod: { startDate: candles[0]?.date || null, endDate: candles.at(-1)?.date || null, tradingDays: candles.length },
      inputSnapshot: { snapshotHash: hashStable(frozenInput), initialSnapshotId: initialSnapshot?.id || null, initialQuantity, initialCash: round(initialCash, 2), initialCapital: round(initialCapital, 2), initialCashSource: input.initialCash !== undefined ? 'request_initial_cash' : input.initialCapital !== undefined ? 'request_total_capital_less_position_value' : reportCash !== null ? 'daily_review_account_snapshot' : 'missing_assumed_zero', planCount: plans.length, uniqueOrderCount: markers.length, strategyVersionIds: frozenInput.strategyVersionIds },
      executionRules: { timeZone: 'Asia/Shanghai', lotSize, settlement: tPlusOne ? 'T+1' : 'same_day_sellability_not_restricted', priceAdjustment: 'none_preferred_for_absolute_saved_order_prices', planSupersession: 'previousPlanId_or_same_mode_and_parent_scope', parentChildActivation: 'child_eligible_only_after_parent_fill', costModel },
      dataHealth: { status: status === 'available' ? 'ready' : 'insufficient', providers: Array.from(new Set(candles.map((candle) => candle.provider))).sort(), observedThrough: candles.at(-1)?.date || null, dailyBarCount: candles.length, intradayBarCount: intradayBars.length, actualTransactionCount: transactions.length, confirmedAttributedTransactionCount: attributedTransactions.length, unattributedTransactionCount: unattributedTransactions.length, attributionCoverage: attributionCoverage === null ? null : round(attributionCoverage, 4), evidenceConfidence: round(evidenceConfidence, 4), duplicatePlanOrdersRemoved: plans.reduce((sum, plan) => sum + plan.orders.filter((order) => activeStatuses.has(order.status)).length, 0) - markers.filter((marker) => activeStatuses.has(marker.orderStatus)).length, markerStatusCounts: markers.reduce<Record<string, number>>((counts, marker) => { counts[marker.status] = (counts[marker.status] || 0) + 1; return counts }, {}) },
      qualityAssessment: {
        verdict,
        simulated: { incrementalReturnVsHoldPercent: alpha, maxDrawdownDeltaVsHoldPercent: drawdownDelta, executedAdviceCount: follow?.metrics.executedEventCount || 0, completedCycles: follow?.metrics.completedCycles || 0, profitFactor: follow?.metrics.profitFactor ?? null, turnoverPercent: follow?.metrics.turnoverPercent ?? null, totalFees: follow?.metrics.totalFees ?? null },
        actual: { evaluationStatus: transactions.length === 0 ? 'no_actual_transactions' : attributedTransactions.length === 0 ? 'insufficient_attribution' : 'available', incrementalReturnVsHoldPercent: attributedTransactions.length > 0 ? actualAlpha : null, attributionCoveragePercent: attributionCoverage === null ? null : round(attributionCoverage * 100, 2), planExecutionRatePercent: gridEvents.length > 0 ? round(matchedTriggeredDraftCount / gridEvents.length * 100, 2) : null, partialFillRatePercent: executedDraftCount > 0 ? round(partialDraftCount / executedDraftCount * 100, 2) : null, weightedAbsoluteSlippage: weightedSlippage === null ? null : round(weightedSlippage, 6), recordedFees: round(attributedTransactions.reduce((sum, item) => sum + item.transaction.fee, 0), 2) },
        evidenceConfidence: round(evidenceConfidence, 4),
        interpretation: verdict === 'insufficient_evidence' ? '现有证据不能评价建议质量；不得把缺少分钟行情解释为建议未命中。' : candles.length < 60 ? '样本不足 60 个交易日，只能作初步评价，不能据此确认策略长期盈利能力。' : '结论仍需滚动窗口、样本外与参数敏感性检验。',
      },
      executionAttribution: {
        confirmed: attributedTransactions.map((item) => ({ transactionId: item.transaction.id, planExecutionLinkId: item.link.id, gridOrderDraftId: item.draft.id, gridPlanId: item.draft.gridPlan.id, quantity: item.transaction.quantity, price: item.transaction.price, fee: item.transaction.fee })),
        unmatchedOrUnconfirmed: unattributedTransactions.map((transaction) => ({ transactionId: transaction.id, quantity: transaction.quantity, price: transaction.price, executedAt: transaction.executedAt, reason: transaction.planExecutionLinks.length > 0 ? 'confirmed_link_outside_replay_plan_scope' : 'no_confirmed_plan_execution_link' })),
      },
      candles, markers, scenarios,
      methodology: { activation: 'pre_open_can_use_same_day_daily_ohlc; intraday_requires_post_decision_intraday_bars; after_close_starts_next_trading_session', hitRule: 'buy_when_eligible_low_lte_limit; sell_when_eligible_high_gte_limit', sameDaySequenceRule: 'daily_two_sided_or_parent_child_same_day_sequence_is_ambiguous_and_excluded_from_returns', evidenceRule: 'missing_post_decision_intraday_bars_is_insufficient_intraday_evidence_not_missed', duplicateRule: 'same decision timestamp, effective validity, side, level, price and quantity counted once', executionPrice: 'saved_limit_price_plus_directional_slippage', settlementRule: 'A_share_stock_and_equity_ETF_buys_are_not_sellable_until_a_later_trade_date', actualTransactionRule: 'only transactions with a user-confirmed PlanExecutionLink to a replayed draft enter actual execution returns; unconfirmed and unmatched facts remain visible but are excluded' },
      evidenceRefs: [...(initialSnapshot ? [`position-snapshot:${initialSnapshot.id}`] : []), ...plans.map((plan) => `grid-plan:${plan.id}`), ...candles.map((candle) => candle.sourceRef), ...intradayBars.map((bar) => bar.sourceRef), ...transactions.map((transaction) => `transaction:${transaction.id}`), ...attributedTransactions.map((item) => `plan-execution-link:${item.link.id}`)],
      blockedReasons: Array.from(new Set(blockers)), warnings: Array.from(new Set(warnings)),
      permissionState: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false }, allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE'], prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'], notTradingAdvice: true,
    }
  }

  async startReplayOperation(request: unknown): Promise<unknown> {
    const parsed = gridReplayOperationSchema.parse(request)
    const { idempotencyKey, ...replayInput } = parsed
    await ensureUser(prisma, replayInput.userId)
    const effectiveKey = idempotencyKey || null
    let operation = effectiveKey ? await prisma.operation.findFirst({ where: { type: 'grid_replay_backtest', idempotencyKey: effectiveKey } }) : null
    if (operation && operation.userId !== replayInput.userId) throw Object.assign(new Error('idempotency key belongs to another user'), { statusCode: 409 })
    if (!operation) {
      operation = await prisma.operation.create({ data: { userId: replayInput.userId, type: 'grid_replay_backtest', status: 'running', startedAt: new Date(), progressPct: 10, progressCurrent: 10, progressTotal: 100, progressMessage: '正在按保存时点回放网格建议', createdBy: 'agent', idempotencyKey: effectiveKey, inputJson: JSON.stringify(replayInput) } })
      try {
        const result = await this.replay(replayInput)
        const artifactRef = `operation_artifact:${operation.id}:grid-replay-result.json`
        await prisma.operation.update({ where: { id: operation.id }, data: { status: 'completed', completedAt: new Date(), progressPct: 100, progressCurrent: 100, progressMessage: '网格建议回放完成', resultJson: JSON.stringify({ ...result, artifacts: { 'grid-replay-result.json': result } }), artifactRefsJson: JSON.stringify([artifactRef]) } })
      } catch (error) {
        await prisma.operation.update({ where: { id: operation.id }, data: { status: 'failed', completedAt: new Date(), progressPct: 100, progressCurrent: 100, progressMessage: '网格建议回放失败', errorSummary: error instanceof Error ? error.message : String(error), errorJson: JSON.stringify({ message: error instanceof Error ? error.message : String(error) }) } })
      }
    }
    return operationService.getOperation(operation.id, replayInput.userId)
  }

  async getReplayOperation(userId: string, operationId: string): Promise<unknown> {
    const operation = await operationService.getOperation(operationId, userId)
    if (operation.type !== 'grid_replay_backtest') throw Object.assign(new Error('operation is not a grid replay backtest'), { statusCode: 400 })
    return operation
  }
}

export const gridReplayService = new GridReplayService()
