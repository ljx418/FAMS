import { createHash } from 'node:crypto'
import {
  downtrendDefensiveConfigSchema,
  resolveGridTradingRules,
  type DowntrendDefensiveConfig,
} from '../strategy/gridStrategyService.js'

export type PointInTimeCandle = {
  date: string
  open: number
  high: number
  low: number
  close: number
  provider: string
  sourceRef: string
}

export type PointInTimeSimulationInput = {
  strategyVersionId: string
  strategyVersionCreatedAt: string
  strategyAuditHash: string
  strategyConfig: unknown
  asset: { id: string; symbol: string; assetType: string; market: string }
  candles: PointInTimeCandle[]
  initialQuantity: number
  initialCapital: number
  commissionRate: number
  slippageRate: number
}

type SimulatedLot = { acquiredOn: string; quantity: number; unitCost: number }

const round = (value: number, digits = 6) => Number(value.toFixed(digits))
const stableStringify = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}
const hash = (value: unknown) => createHash('sha256').update(stableStringify(value)).digest('hex')

function metrics(curve: Array<{ equity: number; cumulativeReturnPercent: number; drawdownPercent: number }>) {
  if (curve.length === 0) return { totalReturnPercent: null, maxDrawdownPercent: null, startValue: null, endValue: null }
  return {
    totalReturnPercent: curve.at(-1)!.cumulativeReturnPercent,
    maxDrawdownPercent: round(Math.min(...curve.map((point) => point.drawdownPercent))),
    startValue: curve[0].equity,
    endValue: curve.at(-1)!.equity,
  }
}

function assertCandles(candles: PointInTimeCandle[]) {
  const blockers: string[] = []
  let previous = ''
  for (const candle of candles) {
    if (candle.date <= previous) blockers.push(`point_in_time_candle_order_invalid:${candle.date}`)
    if (![candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value) && value > 0)) {
      blockers.push(`point_in_time_ohlc_invalid:${candle.date}`)
    }
    if (candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close) || candle.high < candle.low) {
      blockers.push(`point_in_time_ohlc_range_invalid:${candle.date}`)
    }
    previous = candle.date
  }
  return Array.from(new Set(blockers))
}

function triggerOrder(
  candle: PointInTimeCandle,
  order: DowntrendDefensiveConfig['levels'][number],
) {
  return order.side === 'buy' ? candle.low <= order.price : candle.high >= order.price
}

function orderedTriggeredLevels(
  candle: PointInTimeCandle,
  levels: DowntrendDefensiveConfig['levels'],
) {
  const triggered = levels.filter((level) => triggerOrder(candle, level))
  const buyFirst = candle.close >= candle.open
  return triggered.sort((left, right) => {
    if (left.side !== right.side) {
      if (buyFirst) return left.side === 'buy' ? -1 : 1
      return left.side === 'sell' ? -1 : 1
    }
    if (left.side === 'buy') return right.price - left.price
    return left.price - right.price
  })
}

export function simulateFrozenDowntrendGrid(input: PointInTimeSimulationInput) {
  const parsed = downtrendDefensiveConfigSchema.safeParse(input.strategyConfig)
  if (!parsed.success) {
    return {
      status: 'insufficient' as const,
      blockedReasons: ['point_in_time_strategy_schema_not_supported'],
      warnings: [],
      decisions: [],
      executedEvents: [],
      curve: [],
      metrics: metrics([]),
    }
  }
  const blockers = assertCandles(input.candles)
  if (input.candles.length < 2) blockers.push('point_in_time_real_ohlc_insufficient')
  if (!Number.isFinite(input.initialCapital) || input.initialCapital <= 0) blockers.push('point_in_time_initial_capital_invalid')
  if (blockers.length > 0) {
    return {
      status: 'insufficient' as const,
      blockedReasons: Array.from(new Set(blockers)),
      warnings: [],
      decisions: [],
      executedEvents: [],
      curve: [],
      metrics: metrics([]),
    }
  }

  const config = parsed.data
  const rules = resolveGridTradingRules(input.asset.assetType, input.asset.market)
  const firstClose = input.candles[0].close
  let quantity = Math.max(0, input.initialQuantity)
  let cash = Math.max(0, input.initialCapital - quantity * firstClose)
  const lots: SimulatedLot[] = quantity > 0 ? [{ acquiredOn: '0000-00-00', quantity, unitCost: firstClose }] : []
  const completed = new Set<string>()
  const parentFillDate = new Map<string, string>()
  const executedEvents: Array<Record<string, unknown>> = []
  const decisions: Array<Record<string, unknown>> = []
  const curve: Array<{ date: string; equity: number; cumulativeReturnPercent: number; drawdownPercent: number; cash: number; quantity: number }> = []
  const warnings = new Set<string>()
  let peak = 0
  let baseline = 0

  for (let candleIndex = 0; candleIndex < input.candles.length; candleIndex += 1) {
    const candle = input.candles[candleIndex]
    const previous = input.candles[candleIndex - 1]
    const pauseRule = config.riskPolicy.pauseRule
    const buyPaused = Boolean(pauseRule && previous && previous.close < pauseRule.threshold)
    const eligible = config.levels.filter((level) => {
      if (completed.has(level.orderRef)) return false
      if (level.side === 'buy' && buyPaused && pauseRule?.appliesTo === 'all_satellite_buys') return false
      if (level.side === 'buy' && buyPaused && pauseRule?.appliesTo === 'capacity_build' && level.orderRole === 'capacity_build') return false
      if (!level.parentOrderRef) return level.activationStatus === 'active'
      const filledOn = parentFillDate.get(level.parentOrderRef)
      return Boolean(filledOn && filledOn < candle.date)
    })
    const triggered = orderedTriggeredLevels(candle, eligible)
    if (new Set(triggered.map((level) => level.side)).size > 1) warnings.add('daily_ohlc_path_assumption_used_for_two_sided_trigger')
    const executedRefs: string[] = []
    const blocked: Array<{ orderRef: string; reason: string }> = []

    for (const level of triggered) {
      const fillPrice = level.price * (level.side === 'buy' ? 1 + input.slippageRate : 1 - input.slippageRate)
      if (level.side === 'buy') {
        const capacity = Math.max(0, config.allocation.hardCap - quantity)
        const requested = Math.min(level.quantity, capacity)
        const lotQuantity = Math.floor(requested / rules.lotSize) * rules.lotSize
        const affordable = Math.floor((cash / (fillPrice * (1 + input.commissionRate))) / rules.lotSize) * rules.lotSize
        const executedQuantity = Math.max(0, Math.min(lotQuantity, affordable))
        if (executedQuantity <= 0) {
          blocked.push({ orderRef: level.orderRef, reason: capacity <= 0 ? 'hard_position_cap_reached' : 'cash_or_lot_constraint' })
          continue
        }
        const notional = executedQuantity * fillPrice
        const fee = notional * input.commissionRate
        cash -= notional + fee
        quantity += executedQuantity
        lots.push({ acquiredOn: candle.date, quantity: executedQuantity, unitCost: (notional + fee) / executedQuantity })
        completed.add(level.orderRef)
        parentFillDate.set(level.orderRef, candle.date)
        executedRefs.push(level.orderRef)
        executedEvents.push({
          id: `${input.strategyVersionId}:${candle.date}:${level.orderRef}`,
          date: candle.date,
          symbol: input.asset.symbol,
          type: 'buy',
          side: 'buy',
          orderRef: level.orderRef,
          orderRole: level.orderRole,
          requestedQuantity: level.quantity,
          executedQuantity: round(executedQuantity, 4),
          price: level.price,
          fillPrice: round(fillPrice, rules.priceDecimals),
          fee: round(fee, 2),
          sourceRef: candle.sourceRef,
        })
        continue
      }

      const sellable = lots.filter((lot) => lot.acquiredOn < candle.date).reduce((sum, lot) => sum + lot.quantity, 0)
      const executedQuantity = Math.max(0, Math.min(level.quantity, quantity, sellable))
      if (executedQuantity <= 0) {
        blocked.push({ orderRef: level.orderRef, reason: sellable <= 0 ? 't_plus_one_or_sellability_constraint' : 'position_insufficient' })
        continue
      }
      let remaining = executedQuantity
      for (const lot of lots) {
        if (remaining <= 0 || lot.acquiredOn >= candle.date || lot.quantity <= 0) continue
        const matched = Math.min(remaining, lot.quantity)
        lot.quantity -= matched
        remaining -= matched
      }
      const notional = executedQuantity * fillPrice
      const fee = notional * input.commissionRate
      cash += notional - fee
      quantity -= executedQuantity
      completed.add(level.orderRef)
      parentFillDate.set(level.orderRef, candle.date)
      executedRefs.push(level.orderRef)
      executedEvents.push({
        id: `${input.strategyVersionId}:${candle.date}:${level.orderRef}`,
        date: candle.date,
        symbol: input.asset.symbol,
        type: 'sell',
        side: 'sell',
        orderRef: level.orderRef,
        orderRole: level.orderRole,
        requestedQuantity: level.quantity,
        executedQuantity: round(executedQuantity, 4),
        price: level.price,
        fillPrice: round(fillPrice, rules.priceDecimals),
        fee: round(fee, 2),
        sourceRef: candle.sourceRef,
      })
    }

    decisions.push({
      decisionDate: candle.date,
      visibleThrough: candle.date,
      priorCompletedClose: previous?.close ?? null,
      buyPaused,
      evaluatedOrderRefs: eligible.map((level) => level.orderRef),
      triggeredOrderRefs: triggered.map((level) => level.orderRef),
      executedOrderRefs: executedRefs,
      blocked,
      evidenceRefs: [candle.sourceRef],
    })
    const equity = Math.max(0, cash + quantity * candle.close)
    if (curve.length === 0) baseline = equity
    peak = Math.max(peak, equity)
    curve.push({
      date: candle.date,
      equity: round(equity, 2),
      cumulativeReturnPercent: round(baseline > 0 ? (equity / baseline - 1) * 100 : 0),
      drawdownPercent: round(peak > 0 ? (equity / peak - 1) * 100 : 0),
      cash: round(cash, 2),
      quantity: round(quantity, 4),
    })
  }

  const strategyConfigHash = hash(config)
  const inputSnapshotHash = hash({
    strategyVersionId: input.strategyVersionId,
    strategyAuditHash: input.strategyAuditHash,
    strategyConfigHash,
    asset: input.asset,
    candles: input.candles,
    initialQuantity: input.initialQuantity,
    initialCapital: input.initialCapital,
    commissionRate: input.commissionRate,
    slippageRate: input.slippageRate,
  })
  const strategyCreatedDate = input.strategyVersionCreatedAt.slice(0, 10)
  const historicalPolicyApplication = strategyCreatedDate > input.candles[0].date
  if (historicalPolicyApplication) warnings.add('frozen_strategy_created_after_backtest_start_historical_policy_application')

  return {
    status: 'available' as const,
    blockedReasons: [],
    warnings: Array.from(warnings),
    strategy: {
      id: input.strategyVersionId,
      schemaVersion: config.schemaVersion,
      auditHash: input.strategyAuditHash,
      configHash: strategyConfigHash,
      createdAt: input.strategyVersionCreatedAt,
      historicalPolicyApplication,
    },
    inputSnapshotHash,
    decisions,
    executedEvents,
    curve,
    metrics: metrics(curve),
  }
}

