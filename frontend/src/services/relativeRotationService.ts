import axios from 'axios'

export type RotationQuadrant = 'leading' | 'weakening' | 'lagging' | 'improving'
export type RotationMarket = 'CN' | 'HK' | 'US'
export type RotationReadiness = 'verified' | 'limited' | 'insufficient' | 'unavailable'
export type RotationFreshness = 'fresh' | 'delayed' | 'stale' | 'unknown'

export interface RotationPoint {
  date: string
  relativePrice: number
  relativeTrend: number
  relativeMomentum: number
  quadrant: RotationQuadrant
  deltaX: number | null
  deltaY: number | null
  speed: number | null
}

export interface RotationResult {
  symbol: string
  benchmarkId: string
  benchmarkSymbol: string
  benchmarkStatus: 'price_index'
  frequency: 'weekly' | 'daily'
  formulaVersion: string
  adjustType: 'qfq'
  dataStatus: 'ready' | 'partial' | 'insufficient'
  coveragePercent: number
  sampleDays: number
  commonAsOfDate: string | null
  points: RotationPoint[]
  blockers: string[]
}

export interface SleeveAllocation {
  id: string
  status: string
  coreQuantity: number
  volatilityQuantity: number
  volatilityCash: number
  volatilityCostBasis: number
  volatilityRealizedPnl: number
  recommendedRatio: number | null
  confirmedRatio: number
  strategyProfile: 'conservative' | 'strict'
  version: number
  volatilityNav: number
  volatilityUnrealizedPnl: number
  volatilityTotalPnl: number
  invariantDelta: number
}

export interface VolatilityBacktest {
  id: string
  status: string
  sampleDays: number
  recommendedRatio: number
  recommendedProfile: 'conservative' | 'strict'
  metrics: {
    baseline?: { totalReturnPercent: number; maxDrawdownPercent: number }
    recommended?: {
      outOfSampleExcessReturnPercent: number
      maxDrawdownPercent: number
      buyHoldMaxDrawdownPercent: number
      walkForwardPassRatioPercent: number
      tradeCount: number
    } | null
  }
  blockers: string[]
  warnings: string[]
}

export interface VolatilityDraft {
  id: string
  side: 'buy' | 'sell'
  status: string
  suggestedQuantity: number
  referencePriceLow: number | null
  referencePriceHigh: number | null
  rrgQuadrant: RotationQuadrant | null
  rrgEntryFactor: number | null
  timing: { close?: number; ema20?: number; atr14?: number; rsi14?: number; heldDays?: number; stopTriggered?: boolean }
  rationale: string[]
  strategyProfile: string
  expiresAt: string
  analysisDate: string
}

export interface RotationHoldingItem {
  positionId: string
  assetId: string
  symbol: string
  name: string
  assetType: string
  eligible: boolean
  dataStatus: string
  blockers: string[]
  position: {
    quantity: number
    avgCost: number
    currentPrice: number | null
    marketValue: number | null
    costBasis: number | null
    unrealizedPnl: number | null
  }
  allocation: SleeveAllocation | null
  latestBacktest: VolatilityBacktest | null
  latestDraft: VolatilityDraft | null
  rotation: RotationResult | null
}

export interface RotationHoldingsReport {
  schemaVersion: string
  generatedAt: string
  universe: 'current_holdings'
  benchmark: { id: string; symbol: string; name: string; status: 'price_index' }
  formulaVersion: string
  frequency: 'weekly' | 'daily'
  trail: number
  items: RotationHoldingItem[]
  eligibleCount: number
  unsupportedCount: number
  notTradingAdvice: true
}

export interface RotationTimelineItem {
  targetKey: string
  market: RotationMarket
  sources: Array<'holding' | 'watchlist'>
  positionId: string | null
  assetId: string | null
  watchlistItemId: string | null
  deletable: boolean
  symbol: string
  name: string
  assetType: string
  dataStatus: 'ready' | 'partial' | 'insufficient'
  readiness: RotationReadiness
  freshness: RotationFreshness
  freshnessLag: number | null
  assetAsOfDate: string | null
  coveragePercent: number
  sampleDays: number
  benchmarkSampleDays: number
  firstPointDate: string | null
  lastPointDate: string | null
  commonAsOfDate: string | null
  refreshedAt: string | null
  sourceProviders: string[]
  points: RotationPoint[]
  blockers: string[]
  warnings: string[]
}

export interface RotationTimelineReport {
  schemaVersion: 'fams.relative_rotation.universe_timeline.v2'
  generatedAt: string
  universe: 'holdings_and_watchlist'
  market: RotationMarket
  benchmark: {
    id: string
    symbol: string
    name: string
    status: 'price_index' | 'unavailable'
    sourceProviders: string[]
  }
  formulaVersion: string
  frequency: 'weekly' | 'daily'
  requestedYears: number
  requestedHistoryDays: number
  visibleRange: { startDate: string; endDate: string }
  items: RotationTimelineItem[]
  dates: string[]
  availableDateCount: number
  eligibleCount: number
  readyCount: number
  limitedCount: number
  refreshRecommended: boolean
  refreshReasons: string[]
  notTradingAdvice: true
}

export interface RotationWatchlistItem {
  id: string
  targetKey: string
  market: RotationMarket
  symbol: string
  name: string
  assetType: string
  exchange: string | null
  currency: string
  identityStatus: 'verified' | 'provisional'
  identityEvidence: string[]
  identityWarnings: string[]
  createdAt: string
  updatedAt: string
  series: Array<{
    frequency: 'weekly' | 'daily'
    readiness: RotationReadiness
    freshness: RotationFreshness
    freshnessLag: number | null
    sampleDays: number
    commonAsOfDate: string | null
    refreshedAt: string
    blockers: string[]
    warnings: string[]
  }>
}

export interface RotationWatchlistReport {
  schemaVersion: 'fams.relative_rotation.watchlist.v1'
  generatedAt: string
  limit: number
  count: number
  items: RotationWatchlistItem[]
}

export interface OperationDto {
  id?: string
  operationId?: string
  type: string
  status: string
  progressPct?: number
  progressMessage?: string
  result?: Record<string, unknown>
  error?: Record<string, unknown>
}

export async function getRotationHoldings(frequency: 'weekly' | 'daily' = 'weekly', trail = 12) {
  const response = await axios.get<RotationHoldingsReport>('/api/v1/relative-rotation/holdings', {
    params: { userId: 'default', frequency, trail },
  })
  return response.data
}

export async function getRotationTimeline(frequency: 'weekly' | 'daily' = 'weekly', years = 8, market: RotationMarket = 'CN') {
  const response = await axios.get<RotationTimelineReport>('/api/v1/relative-rotation/universe/timeline', {
    params: { userId: 'default', frequency, years, market },
  })
  return response.data
}

export async function getRotationWatchlist() {
  const response = await axios.get<RotationWatchlistReport>('/api/v1/relative-rotation/watchlist', {
    params: { userId: 'default' },
  })
  return response.data
}

export async function addRotationWatchlistItem(input: { market: RotationMarket; code: string }) {
  const response = await axios.post<{ created: boolean; item: RotationWatchlistItem; refresh: Record<string, unknown> | null }>(
    '/api/v1/relative-rotation/watchlist',
    { userId: 'default', market: input.market, code: input.code, refresh: true, years: 8 },
  )
  return response.data
}

export async function deleteRotationWatchlistItem(itemId: string) {
  const response = await axios.delete<{
    deleted: true
    targetKey: string
    deletedSeries: number
    deletedPoints: number
    deletedRefreshRuns: number
    sharedMarketBarsRetained: number
    stillVisibleViaHolding: boolean
  }>(`/api/v1/relative-rotation/watchlist/${itemId}`, { params: { userId: 'default' } })
  return response.data
}

export async function refreshRotationUniverse(market: RotationMarket, targetKeys: string[], years = 8) {
  const response = await axios.post<{
    schemaVersion: 'fams.relative_rotation.universe_refresh.v1'
    requestedTargets: number
    completedTargets: number
  }>('/api/v1/relative-rotation/universe/refresh', {
    userId: 'default',
    market,
    targetKeys,
    years,
  })
  return response.data
}

export async function refreshRotationTimeline(years = 8, idempotencyKey?: string) {
  const response = await axios.post<OperationDto>('/api/v1/relative-rotation/timeline/refresh', {
    userId: 'default',
    years,
    executionMode: 'inline',
    idempotencyKey,
  })
  return response.data
}

export async function runRotationBacktest(positionIds?: string[]) {
  const response = await axios.post<OperationDto>('/api/v1/relative-rotation/backtests', {
    userId: 'default',
    positionIds,
    executionMode: 'inline',
  })
  return response.data
}

export async function runVolatilityDailyAnalysis() {
  const response = await axios.post<OperationDto>('/api/v1/relative-rotation/daily-analysis', {
    userId: 'default',
    refresh: true,
    executionMode: 'inline',
  })
  return response.data
}

export async function getOperation(operationId: string) {
  const response = await axios.get<OperationDto>(`/api/v1/operations/${operationId}`)
  return response.data
}

export async function activateSleeve(positionId: string, input: {
  backtestId: string
  confirmedRatio: number
  strategyProfile: 'conservative' | 'strict'
}) {
  const response = await axios.post(`/api/v1/positions/${positionId}/sleeves/activate`, {
    userId: 'default',
    ...input,
  })
  return response.data
}

export async function transferSleeve(positionId: string, input: {
  direction: 'core_to_volatility' | 'volatility_to_core' | 'cash_in' | 'cash_out'
  amount: number
  expectedVersion: number
  notes?: string
}) {
  const response = await axios.post(`/api/v1/positions/${positionId}/sleeves/transfer`, {
    userId: 'default',
    ...input,
  })
  return response.data
}

export async function confirmVolatilityDraft(draftId: string, input: {
  quantity: number
  price: number
  fee?: number
  executedAt?: string
  notes?: string
}) {
  const response = await axios.post(`/api/v1/relative-rotation/drafts/${draftId}/confirm`, {
    userId: 'default',
    ...input,
  })
  return response.data
}

export async function dismissVolatilityDraft(draftId: string) {
  const response = await axios.post(`/api/v1/relative-rotation/drafts/${draftId}/dismiss`, { userId: 'default' })
  return response.data
}
