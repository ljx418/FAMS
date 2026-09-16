import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'

const requestSchema = z.object({
  userId: z.string().min(1),
  sourceType: z.enum(['advice', 'grid_plan']),
  sourceId: z.string().min(1),
  replayMode: z.enum(['saved_advice_replay', 'point_in_time_simulation']).default('saved_advice_replay'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  initialCapital: z.number().positive().optional(),
  commissionRate: z.number().min(0).max(0.02).default(0.0003),
  slippageRate: z.number().min(0).max(0.02).default(0.0005),
})

export type ScenarioComparisonRequest = z.input<typeof requestSchema>

type SnapshotPosition = {
  assetId: string
  symbol: string
  assetType: string
  quantity: number
  currentPrice: number
  marketValue: number
}

type SourceAction = {
  id: string
  symbol: string
  assetId: string
  assetType: string
  side: 'buy' | 'sell' | 'hold'
  quantity: number | null
  amount: number | null
  suggestedPrice: number | null
  status: string
}

type PricePoint = { date: string; close: number; provider: string; sourceRef: string }
type ReplayEvent = {
  id: string
  date: string
  symbol: string
  type: string
  quantity: number
  price: number
  amount: number
  fee: number
  sourceRef: string
}

type SourceBundle = {
  sourceType: 'advice' | 'grid_plan'
  sourceId: string
  generatedAt: Date
  strategyVersionId: string | null
  snapshotRef: string
  positions: SnapshotPosition[]
  actions: SourceAction[]
  evidenceRefs: string[]
}

const round = (value: number, digits = 6) => Number(value.toFixed(digits))
const dateKey = (value: Date | string) => new Date(value).toISOString().slice(0, 10)
const parseArray = (value: string | null | undefined) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
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

function normalizeSnapshotPosition(row: any, assetById: Map<string, any>): SnapshotPosition | null {
  const asset = row.assetId ? assetById.get(String(row.assetId)) : null
  const symbol = String(row.symbol || asset?.symbol || '').trim().replace(/\.(SH|SZ|BJ|SS)$/i, '')
  const assetId = String(row.assetId || asset?.id || '')
  const quantity = Number(row.quantity || 0)
  const currentPrice = Number(row.currentPrice || row.avgCost || asset?.lastPrice || 0)
  const marketValue = Number(row.marketValue || (quantity * currentPrice) || 0)
  if (!symbol || !assetId || !Number.isFinite(quantity) || quantity < 0) return null
  return {
    assetId,
    symbol,
    assetType: String(row.assetType || asset?.type || 'unknown'),
    quantity,
    currentPrice: currentPrice > 0 ? currentPrice : marketValue > 0 && quantity > 0 ? marketValue / quantity : 0,
    marketValue,
  }
}

export function validateActualTransactionRows(rows: Array<{
  id: string
  type: string
  status: string
  quantity: number
  price: number
  amount: number
  fee: number
  executedAt: Date
  asset: { symbol: string }
}>) {
  const blockers: string[] = []
  for (const row of rows) {
    if (row.status !== 'confirmed') blockers.push(`transaction_not_confirmed:${row.id}`)
    if (!['buy', 'sell', 'dividend', 'split', 'fee'].includes(row.type)) blockers.push(`transaction_type_unsupported:${row.id}:${row.type}`)
    if (['buy', 'sell'].includes(row.type)) {
      const expected = Math.abs(Number(row.quantity) * Number(row.price))
      const actual = Math.abs(Number(row.amount))
      const tolerance = Math.max(1, expected * 0.01)
      if (!Number.isFinite(expected) || !Number.isFinite(actual) || Math.abs(expected - actual) > tolerance) {
        blockers.push(`transaction_amount_mismatch:${row.id}`)
      }
    }
    if (Number.isNaN(row.executedAt.getTime())) blockers.push(`transaction_time_invalid:${row.id}`)
    if (!row.asset?.symbol) blockers.push(`transaction_asset_missing:${row.id}`)
  }
  return { status: blockers.length === 0 ? 'exact' as const : 'insufficient' as const, blockers }
}

export function pointInTimeSimulationBlocker(strategyVersionId: string | null) {
  return strategyVersionId
    ? 'point_in_time_dynamic_recompute_not_implemented'
    : 'frozen_strategy_version_required_for_point_in_time_simulation'
}

class ScenarioComparisonService {
  private async loadSource(input: z.output<typeof requestSchema>): Promise<SourceBundle> {
    if (input.sourceType === 'advice') {
      const advice = await prisma.advice.findFirst({
        where: { id: input.sourceId, userId: input.userId },
        include: {
          adviceInputSnapshot: true,
          actions: { include: { asset: true }, orderBy: { createdAt: 'asc' } },
        },
      })
      if (!advice) throw Object.assign(new Error('Advice not found'), { statusCode: 404 })
      if (!advice.adviceInputSnapshot) throw Object.assign(new Error('Advice input snapshot missing'), { statusCode: 422 })
      const rawPositions = parseArray(advice.adviceInputSnapshot.positionSnapshotJson)
      const assetIds = Array.from(new Set([
        ...rawPositions.map((row: any) => String(row.assetId || '')).filter(Boolean),
        ...advice.actions.map((action) => action.assetId).filter((value): value is string => Boolean(value)),
      ]))
      const assets = await prisma.asset.findMany({ where: { id: { in: assetIds } } })
      const assetById = new Map(assets.map((asset) => [asset.id, asset]))
      return {
        sourceType: 'advice',
        sourceId: advice.id,
        generatedAt: advice.generatedAt,
        strategyVersionId: null,
        snapshotRef: `advice-input-snapshot:${advice.adviceInputSnapshot.id}`,
        positions: rawPositions.flatMap((row: any) => {
          const normalized = normalizeSnapshotPosition(row, assetById)
          return normalized ? [normalized] : []
        }),
        actions: advice.actions.flatMap((action): SourceAction[] => {
          if (!action.asset) return []
          const side = action.actionType === 'buy' ? 'buy' : action.actionType === 'sell' ? 'sell' : 'hold'
          return [{
            id: action.id,
            symbol: action.asset.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, ''),
            assetId: action.asset.id,
            assetType: action.asset.type,
            side,
            quantity: action.suggestedQuantity,
            amount: action.suggestedAmount,
            suggestedPrice: action.suggestedPrice,
            status: action.status,
          }]
        }),
        evidenceRefs: [`advice:${advice.id}`, `advice-input-snapshot:${advice.adviceInputSnapshot.id}`],
      }
    }

    const plan = await prisma.gridPlan.findFirst({
      where: { id: input.sourceId, userId: input.userId },
      include: {
        asset: true,
        orders: { orderBy: [{ side: 'asc' }, { level: 'asc' }] },
        dailyReviewRun: { include: { positionSnapshots: { include: { asset: true } } } },
      },
    })
    if (!plan) throw Object.assign(new Error('Grid plan not found'), { statusCode: 404 })
    return {
      sourceType: 'grid_plan',
      sourceId: plan.id,
      generatedAt: plan.createdAt,
      strategyVersionId: plan.strategyVersionId,
      snapshotRef: `daily-review-run:${plan.dailyReviewRunId}`,
      positions: plan.dailyReviewRun.positionSnapshots.map((row) => ({
        assetId: row.assetId,
        symbol: row.asset.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, ''),
        assetType: row.asset.type,
        quantity: row.quantity,
        currentPrice: Number(row.currentPrice || row.avgCost || 0),
        marketValue: Number(row.marketValue || row.quantity * (row.currentPrice || row.avgCost || 0)),
      })),
      actions: plan.orders.map((order) => ({
        id: order.id,
        symbol: plan.asset.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, ''),
        assetId: plan.assetId,
        assetType: plan.asset.type,
        side: order.side === 'buy' ? 'buy' as const : order.side === 'sell' ? 'sell' as const : 'hold' as const,
        quantity: order.quantity,
        amount: order.amount,
        suggestedPrice: order.price,
        status: order.status,
      })),
      evidenceRefs: [`grid-plan:${plan.id}`, `daily-review-run:${plan.dailyReviewRunId}`],
    }
  }

  private async loadPriceSeries(bundle: SourceBundle, startDate: string, endDate: string) {
    const positionAssets = bundle.positions.map((position) => ({ id: position.assetId, symbol: position.symbol }))
    const actionAssets = bundle.actions.map((action) => ({ id: action.assetId, symbol: action.symbol }))
    const assets = Array.from(new Map([...positionAssets, ...actionAssets].map((item) => [item.symbol, item])).values())
    const start = new Date(`${startDate}T00:00:00.000Z`)
    start.setUTCDate(start.getUTCDate() - 10)
    const end = new Date(`${endDate}T23:59:59.999Z`)
    const bySymbol = new Map<string, PricePoint[]>()
    const providers = new Set<string>()
    for (const asset of assets) {
      const preferred = await prisma.marketBarCanonical.findMany({
        where: {
          symbol: asset.symbol,
          market: 'CN',
          timeframe: '1d',
          dataVersion: 'canonical.v1',
          adjustType: 'qfq',
          tradeDate: { gte: start, lte: end },
        },
        orderBy: { tradeDate: 'asc' },
      })
      const canonical = preferred.length > 0 ? preferred : await prisma.marketBarCanonical.findMany({
        where: {
          symbol: asset.symbol,
          market: 'CN',
          timeframe: '1d',
          dataVersion: 'canonical.v1',
          tradeDate: { gte: start, lte: end },
        },
        orderBy: { tradeDate: 'asc' },
      })
      const points: PricePoint[] = canonical.map((row) => {
        const provider = row.primaryProvider || 'market_bar_canonical'
        providers.add(provider)
        return { date: dateKey(row.tradeDate), close: row.closePrice, provider, sourceRef: `market-bar-canonical:${row.id}` }
      })
      if (points.length === 0) {
        const history = await prisma.priceHistory.findMany({
          where: { assetId: asset.id, isValid: true, timestamp: { gte: start, lte: end } },
          orderBy: { timestamp: 'asc' },
        })
        for (const row of history) {
          const provider = row.source || 'price_history'
          providers.add(provider)
          points.push({ date: dateKey(row.timestamp), close: row.closePrice, provider, sourceRef: `price-history:${row.id}` })
        }
      }
      bySymbol.set(asset.symbol, points)
    }
    return { bySymbol, providers: Array.from(providers).sort() }
  }

  private priceAt(series: PricePoint[], date: string, fallback = 0) {
    let resolved = fallback
    for (const point of series) {
      if (point.date > date) break
      resolved = point.close
    }
    return resolved
  }

  private buildDates(series: Map<string, PricePoint[]>, startDate: string, endDate: string) {
    return Array.from(new Set(Array.from(series.values()).flatMap((points) => points
      .map((point) => point.date)
      .filter((date) => date >= startDate && date <= endDate)))).sort()
  }

  private metrics(curve: Array<{ date: string; equity: number; cumulativeReturnPercent: number; drawdownPercent: number }>) {
    if (curve.length === 0) return { totalReturnPercent: null, maxDrawdownPercent: null, startValue: null, endValue: null }
    return {
      totalReturnPercent: curve[curve.length - 1].cumulativeReturnPercent,
      maxDrawdownPercent: round(Math.min(...curve.map((point) => point.drawdownPercent))),
      startValue: curve[0].equity,
      endValue: curve[curve.length - 1].equity,
    }
  }

  private replay(input: {
    id: 'follow_advice' | 'hold_without_action' | 'actual_transactions'
    dates: string[]
    positions: SnapshotPosition[]
    prices: Map<string, PricePoint[]>
    initialCapital: number
    events: ReplayEvent[]
    commissionRate: number
    slippageRate: number
  }) {
    const quantities = new Map(input.positions.map((position) => [position.symbol, position.quantity]))
    const firstDate = input.dates[0]
    const initialPositionValue = input.positions.reduce((sum, position) => (
      sum + position.quantity * this.priceAt(input.prices.get(position.symbol) || [], firstDate, position.currentPrice)
    ), 0)
    let cash = Math.max(0, input.initialCapital - initialPositionValue)
    const eventsByDate = new Map<string, ReplayEvent[]>()
    for (const event of input.events) {
      const replayDate = input.dates.find((date) => date >= event.date)
      if (!replayDate) continue
      eventsByDate.set(replayDate, [...(eventsByDate.get(replayDate) || []), event])
    }
    const executedEvents: Array<ReplayEvent & { replayDate: string; fillPrice: number; executedQuantity: number; chargedFee: number }> = []
    const curve: Array<{ date: string; equity: number; cumulativeReturnPercent: number; drawdownPercent: number }> = []
    let peak = 0
    let baseline = 0
    for (const date of input.dates) {
      for (const event of eventsByDate.get(date) || []) {
        if (event.type === 'dividend') {
          cash += Math.abs(event.amount)
          executedEvents.push({ ...event, replayDate: date, fillPrice: 0, executedQuantity: 0, chargedFee: 0 })
          continue
        }
        if (event.type === 'fee') {
          cash -= Math.abs(event.amount || event.fee)
          executedEvents.push({ ...event, replayDate: date, fillPrice: 0, executedQuantity: 0, chargedFee: Math.abs(event.amount || event.fee) })
          continue
        }
        if (event.type === 'split') {
          quantities.set(event.symbol, (quantities.get(event.symbol) || 0) + event.quantity)
          executedEvents.push({ ...event, replayDate: date, fillPrice: 0, executedQuantity: event.quantity, chargedFee: 0 })
          continue
        }
        const marketPrice = input.id === 'actual_transactions' && event.price > 0
          ? event.price
          : this.priceAt(input.prices.get(event.symbol) || [], date, event.price)
        const fillPrice = event.type === 'buy'
          ? marketPrice * (1 + input.slippageRate)
          : marketPrice * (1 - input.slippageRate)
        const rawQuantity = event.quantity > 0 ? event.quantity : event.amount > 0 ? event.amount / fillPrice : 0
        const lotSize = Number.isInteger(rawQuantity) && rawQuantity >= 100 ? 100 : 0.0001
        let executedQuantity = Math.floor(rawQuantity / lotSize) * lotSize
        if (event.type === 'buy') {
          const affordable = Math.floor((cash / (fillPrice * (1 + input.commissionRate))) / lotSize) * lotSize
          executedQuantity = Math.min(executedQuantity, Math.max(0, affordable))
          const chargedFee = executedQuantity * fillPrice * input.commissionRate
          cash -= executedQuantity * fillPrice + chargedFee
          quantities.set(event.symbol, (quantities.get(event.symbol) || 0) + executedQuantity)
          executedEvents.push({ ...event, replayDate: date, fillPrice: round(fillPrice), executedQuantity: round(executedQuantity, 4), chargedFee: round(chargedFee) })
        } else if (event.type === 'sell') {
          executedQuantity = Math.min(executedQuantity, quantities.get(event.symbol) || 0)
          const chargedFee = executedQuantity * fillPrice * input.commissionRate
          cash += executedQuantity * fillPrice - chargedFee
          quantities.set(event.symbol, Math.max(0, (quantities.get(event.symbol) || 0) - executedQuantity))
          executedEvents.push({ ...event, replayDate: date, fillPrice: round(fillPrice), executedQuantity: round(executedQuantity, 4), chargedFee: round(chargedFee) })
        }
      }
      const holdingValue = Array.from(quantities.entries()).reduce((sum, [symbol, quantity]) => (
        sum + quantity * this.priceAt(input.prices.get(symbol) || [], date)
      ), 0)
      const equity = Math.max(0, cash + holdingValue)
      if (curve.length === 0) baseline = equity || input.initialCapital
      peak = Math.max(peak, equity)
      curve.push({
        date,
        equity: round(equity, 2),
        cumulativeReturnPercent: round(baseline > 0 ? (equity / baseline - 1) * 100 : 0),
        drawdownPercent: round(peak > 0 ? (equity / peak - 1) * 100 : 0),
      })
    }
    return { curve, metrics: this.metrics(curve), executedEvents }
  }

  async compare(request: ScenarioComparisonRequest) {
    const input = requestSchema.parse(request)
    await ensureUser(prisma, input.userId)
    if (input.startDate > input.endDate) throw Object.assign(new Error('startDate must not be after endDate'), { statusCode: 400 })
    const bundle = await this.loadSource(input)
    const blockers: string[] = []
    if (input.replayMode === 'point_in_time_simulation') {
      blockers.push(pointInTimeSimulationBlocker(bundle.strategyVersionId))
    }
    if (dateKey(bundle.generatedAt) > input.endDate) blockers.push('source_generated_after_backtest_window')
    const priceMatrix = await this.loadPriceSeries(bundle, input.startDate, input.endDate)
    const dates = this.buildDates(priceMatrix.bySymbol, input.startDate, input.endDate)
    if (dates.length < 2) blockers.push('common_replay_timeline_insufficient')
    for (const position of bundle.positions.filter((item) => item.quantity > 0)) {
      if ((priceMatrix.bySymbol.get(position.symbol) || []).length === 0 && position.currentPrice <= 0) blockers.push(`position_price_missing:${position.symbol}`)
    }
    for (const action of bundle.actions.filter((item) => item.side !== 'hold')) {
      if ((priceMatrix.bySymbol.get(action.symbol) || []).length === 0) blockers.push(`action_price_missing:${action.symbol}`)
    }

    const assetIds = Array.from(new Set([...bundle.positions.map((item) => item.assetId), ...bundle.actions.map((item) => item.assetId)]))
    const transactions = await prisma.transaction.findMany({
      where: {
        userId: input.userId,
        assetId: { in: assetIds },
        executedAt: { gte: new Date(`${input.startDate}T00:00:00.000Z`), lte: new Date(`${input.endDate}T23:59:59.999Z`) },
      },
      include: { asset: true },
      orderBy: { executedAt: 'asc' },
    })
    const reconciliation = validateActualTransactionRows(transactions)
    blockers.push(...reconciliation.blockers)

    const frozenInput = {
      sourceType: bundle.sourceType,
      sourceId: bundle.sourceId,
      snapshotRef: bundle.snapshotRef,
      generatedAt: bundle.generatedAt.toISOString(),
      strategyVersionId: bundle.strategyVersionId,
      positions: bundle.positions,
      actions: bundle.actions,
      startDate: input.startDate,
      endDate: input.endDate,
      prices: Array.from(priceMatrix.bySymbol.entries()).map(([symbol, rows]) => ({ symbol, rows })),
      transactions: transactions.map((row) => ({
        id: row.id,
        symbol: row.asset.symbol,
        type: row.type,
        status: row.status,
        quantity: row.quantity,
        price: row.price,
        amount: row.amount,
        fee: row.fee,
        executedAt: row.executedAt.toISOString(),
      })),
      commissionRate: input.commissionRate,
      slippageRate: input.slippageRate,
    }
    const snapshotHash = hash(frozenInput)
    if (blockers.length > 0) {
      return {
        schemaVersion: 'fams.backtest.scenario-comparison.v1',
        status: 'insufficient' as const,
        replayMode: input.replayMode,
        source: { type: bundle.sourceType, id: bundle.sourceId, snapshotRef: bundle.snapshotRef, strategyVersionId: bundle.strategyVersionId },
        inputSnapshot: { snapshotHash, startDate: input.startDate, endDate: input.endDate, observedThrough: dates.at(-1) || null },
        dataHealth: { status: 'insufficient', providers: priceMatrix.providers, actualTransactionReconciliation: reconciliation.status },
        scenarios: [],
        evidenceRefs: bundle.evidenceRefs,
        blockedReasons: Array.from(new Set(blockers)),
        permissionState: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
      }
    }

    const firstDateAfterSource = dates.find((date) => date > dateKey(bundle.generatedAt))
    if (!firstDateAfterSource && bundle.actions.some((action) => action.side !== 'hold')) {
      return {
        schemaVersion: 'fams.backtest.scenario-comparison.v1',
        status: 'insufficient' as const,
        replayMode: input.replayMode,
        source: { type: bundle.sourceType, id: bundle.sourceId, snapshotRef: bundle.snapshotRef, strategyVersionId: bundle.strategyVersionId },
        inputSnapshot: { snapshotHash, startDate: input.startDate, endDate: input.endDate, observedThrough: dates.at(-1) || null },
        dataHealth: { status: 'insufficient', providers: priceMatrix.providers, actualTransactionReconciliation: reconciliation.status },
        scenarios: [],
        evidenceRefs: bundle.evidenceRefs,
        blockedReasons: ['next_tradable_date_after_source_missing'],
        permissionState: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
      }
    }

    const initialCapital = input.initialCapital || Math.max(100_000, bundle.positions.reduce((sum, item) => sum + item.marketValue, 0))
    const adviceEvents: ReplayEvent[] = bundle.actions.filter((action) => action.side !== 'hold').map((action) => ({
      id: action.id,
      date: firstDateAfterSource || input.startDate,
      symbol: action.symbol,
      type: action.side,
      quantity: Number(action.quantity || 0),
      price: Number(action.suggestedPrice || 0),
      amount: Number(action.amount || 0),
      fee: 0,
      sourceRef: `${bundle.sourceType}-action:${action.id}`,
    }))
    const actualEvents: ReplayEvent[] = transactions.map((row) => ({
      id: row.id,
      date: dateKey(row.executedAt),
      symbol: row.asset.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, ''),
      type: row.type,
      quantity: row.quantity,
      price: row.price,
      amount: row.amount,
      fee: row.fee,
      sourceRef: `transaction:${row.id}`,
    }))
    const replayBase = { dates, positions: bundle.positions, prices: priceMatrix.bySymbol, initialCapital, commissionRate: input.commissionRate, slippageRate: input.slippageRate }
    const follow = this.replay({ id: 'follow_advice', ...replayBase, events: adviceEvents })
    const hold = this.replay({ id: 'hold_without_action', ...replayBase, events: [] })
    const actual = this.replay({ id: 'actual_transactions', ...replayBase, events: actualEvents, commissionRate: 0, slippageRate: 0 })
    const scenarios = [
      { id: 'follow_advice', label: '按建议执行', status: 'available', ...follow },
      { id: 'hold_without_action', label: '不执行建议', status: 'available', ...hold },
      { id: 'actual_transactions', label: '实际交易流水', status: 'available', ...actual },
    ]
    const shiftedDates = [0, 5, 10].flatMap((offset) => dates[offset] ? [{
      startDate: dates[offset],
      offsetTradingDays: offset,
      holdTerminalReturnPercent: this.metrics(hold.curve.slice(offset)).totalReturnPercent,
    }] : [])
    const closedActions = bundle.actions.filter((action) => action.status === 'executed')
    return {
      schemaVersion: 'fams.backtest.scenario-comparison.v1',
      status: 'available' as const,
      replayMode: input.replayMode,
      source: { type: bundle.sourceType, id: bundle.sourceId, snapshotRef: bundle.snapshotRef, strategyVersionId: bundle.strategyVersionId },
      inputSnapshot: { snapshotHash, startDate: input.startDate, endDate: input.endDate, observedThrough: dates.at(-1), generatedAt: bundle.generatedAt.toISOString() },
      executionAssumptions: {
        adviceExecutionTiming: 'next_tradable_date_after_source',
        firstAdviceExecutionDate: firstDateAfterSource || null,
        commissionRate: input.commissionRate,
        slippageRate: input.slippageRate,
        lotPolicy: 'stock_or_etf_integer_100_when_quantity_is_integer_at_least_100_otherwise_fractional_0.0001',
      },
      dataHealth: {
        status: 'sufficient',
        providers: priceMatrix.providers,
        observedThrough: dates.at(-1),
        actualTransactionReconciliation: reconciliation.status,
        transactionCount: transactions.length,
      },
      scenarios,
      timeSensitivity: shiftedDates,
      adviceOutcome: {
        totalActionCount: bundle.actions.length,
        closedActionCount: closedActions.length,
        openActionCountExcludedFromWinRate: bundle.actions.length - closedActions.length,
        winRatePercent: null,
        expectedProfitLoss: null,
        note: '未形成可审计闭环收益的建议不进入胜率和期望盈亏分母。',
      },
      evidenceRefs: Array.from(new Set([
        ...bundle.evidenceRefs,
        ...Array.from(priceMatrix.bySymbol.values()).flatMap((rows) => rows.map((row) => row.sourceRef)),
        ...actualEvents.map((event) => event.sourceRef),
      ])),
      blockedReasons: [],
      permissionState: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    }
  }
}

export const scenarioComparisonService = new ScenarioComparisonService()
