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

export type RotationResearchTargetKind = 'equity' | 'index'
export type RotationResearchBenchmarkMode = 'market_default' | 'equal_weight_targets'
export type RotationResearchTaxonomyStage = '上游资源' | '能源供给' | '核心器件' | '算力与数据' | '软件应用' | 'AI综合主题'

export interface RotationResearchTaxonomy {
  key: 'cn_ai_supply_chain'
  stage: RotationResearchTaxonomyStage
  order: number
  isAggregate: boolean
  representation: 'price_index' | 'etf_price_proxy'
  methodologyUrl: string
}

export interface RotationResearchTarget {
  targetKey?: string
  code: string
  name?: string
  kind: RotationResearchTargetKind
}

export type RotationResearchPeriod =
  | { mode: 'rolling'; rollingWeeks: number }
  | { mode: 'fixed'; startDate: string; endDate: string }

export interface RotationResearchBenchmark {
  mode: RotationResearchBenchmarkMode
  targetKeys: string[]
}

export interface RotationResearchStudyInput {
  name: string
  market: RotationMarket
  frequency: 'weekly' | 'daily'
  historyYears?: number
  benchmark?: RotationResearchBenchmark
  period: RotationResearchPeriod
  targets: RotationResearchTarget[]
  comparisonTargetKeys?: string[]
}

export interface RotationResearchStudy extends RotationResearchStudyInput {
  id: string
  comparisonTargetKeys: string[]
  targets: Array<RotationResearchTarget & { targetKey: string; name: string }>
  createdAt: string
  updatedAt: string
}

export interface RotationResearchTimelineItem extends Omit<RotationTimelineItem, 'sources'> {
  sources: Array<'research' | 'holding'>
  targetType: RotationResearchTargetKind
  isCurrentHolding: boolean
  taxonomy: RotationResearchTaxonomy | null
}

export interface RotationResearchAssociation {
  leftTargetKey: string
  rightTargetKey: string
  alignedPointCount: number
  relativeReturnCorrelation: number | null
  sameQuadrantRatio: number | null
  latestCoordinateDistance: number | null
}

export interface RotationResearchTimelineReport {
  schemaVersion: 'fams.relative_rotation.research_timeline.v1'
  generatedAt: string
  universe: 'research'
  market: RotationMarket
  benchmark: {
    id: string
    symbol: string
    name: string
    mode: RotationResearchBenchmarkMode
    status: 'price_index' | 'composite' | 'unavailable'
    sourceProviders: string[]
    components: Array<{
      targetKey: string
      symbol: string
      name: string
      weight: number
      sampleDays: number
      asOfDate: string | null
    }>
  }
  formulaVersion: string
  frequency: 'weekly' | 'daily'
  requestedYears: number
  requestedHistoryDays: number
  visibleRange: { startDate: string; endDate: string }
  items: RotationResearchTimelineItem[]
  dates: string[]
  availableDateCount: number
  eligibleCount: number
  readyCount: number
  limitedCount: number
  refreshRecommended: boolean
  refreshReasons: string[]
  associations: RotationResearchAssociation[]
  study: RotationResearchStudy | null
  comparisonTargetKeys: string[]
  notTradingAdvice: true
}

export interface RotationResearchStudiesReport {
  schemaVersion: 'fams.relative_rotation.research_studies.v1'
  generatedAt: string
  studies: RotationResearchStudy[]
}

export interface RotationResearchRefreshReport {
  schemaVersion: 'fams.relative_rotation.research_refresh.v1'
  generatedAt: string
  market: RotationMarket
  requestedTargets: number
  completedTargets: number
  results: Array<Record<string, unknown>>
  timeline: RotationResearchTimelineReport
  study: RotationResearchStudy | null
  comparisonTargetKeys: string[]
}

export type PortfolioRotationGroupKey = 'all' | 'cn_equity' | 'hk_equity' | 'gold' | 'bond' | 'cash'

export interface PortfolioRotationItem extends Omit<RotationTimelineItem, 'dataStatus' | 'readiness' | 'freshness'> {
  dataStatus: RotationTimelineItem['dataStatus'] | 'not_applicable'
  readiness: RotationReadiness | 'not_applicable'
  freshness: RotationFreshness | 'not_applicable'
  formulaSufficient: boolean
  latestQuadrant: RotationQuadrant | null
  gateEligible: boolean
  gateReason: string
}

export interface PortfolioRotationGroup {
  key: PortfolioRotationGroupKey
  label: string
  purpose: 'allocation_gate' | 'tracking_diagnostic' | 'relative_diagnostic' | 'not_applicable'
  benchmark: {
    symbol: string | null
    name: string | null
    kind: 'multi_asset_composite' | 'price_index' | 'exchange_proxy' | 'not_applicable'
    sampleDays: number
    asOfDate: string | null
    freshnessLag: number | null
    sourceProviders?: string[]
    components?: Array<{
      key: string
      symbol: string
      name: string
      weight: number
      sampleDays: number
    }>
  }
  items: PortfolioRotationItem[]
  dates: string[]
  availableDateCount: number
  readyCount: number
  limitedCount: number
}

export interface PortfolioRotationReport {
  schemaVersion: 'fams.relative_rotation.portfolio_universe.v2'
  generatedAt: string
  universe: 'all_current_holdings'
  formulaVersion: string
  frequency: 'weekly' | 'daily'
  requestedYears: number
  freshnessReferenceDate: string
  freshnessTimezone: string
  freshnessAfterCloseMinutes: number
  groups: PortfolioRotationGroup[]
  coverage: {
    positionCount: number
    representedCount: number
    plottedCount: number
    notApplicableCount: number
    verifiedCount: number
    limitedCount: number
    insufficientCount: number
  }
  dataPolicy: Record<string, string>
  notTradingAdvice: true
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

export interface IndustryCrowdingPoint {
  date: string
  behaviorScore: number | null
  flowCrowdingScore20: number | null
  capitalFlowScore: number | null
  relativeReturn20: number | null
  amountExpansion: number | null
  volatilityExpansion: number | null
  flowIntensity20: number | null
  flowIntensity: number | null
  mainNetInflow20: number | null
  dailyMainNetInflow: number | null
  dailyFlowIntensity: number | null
  flowObservationCount: number
  behaviorEligibleCount: number
  flowEligibleCount: number
}

export interface IndustryCrowdingBoard {
  code: string
  name: string
  dataStatus: 'ready' | 'partial' | 'unavailable'
  priceStatus: string
  flowStatus: string
  lastPriceDate: string | null
  lastFlowDate: string | null
  lastError: string | null
  sourceProviders: string[]
  latest: IndustryCrowdingPoint | null
  points: IndustryCrowdingPoint[]
}

export interface IndustryCrowdingReport {
  schemaVersion: 'fams.relative_rotation.industry_crowding.v2'
  generatedAt: string
  year: number
  frequency: 'daily' | 'weekly'
  asOfDate: string | null
  asOfDates: { behavior: string | null; capitalFlow: string | null; marketFlow: string | null }
  boardCount: number
  readyCount: number
  partialCount: number
  unavailableCount: number
  dates: string[]
  coverageByDate: Array<{ date: string; behaviorEligibleCount: number; flowEligibleCount: number }>
  boards: IndustryCrowdingBoard[]
  marketFlow: {
    marketKey: string
    name: string
    provider: string
    points: Array<{
      date: string
      mainNetInflow: number | null
      dailyFlowIntensity: number | null
      fiveDayFlowIntensity: number | null
    }>
  }
  benchmark: { symbol: string; name: string; sampleDays: number; provider: string }
  methodology: { behaviorScore: string; capitalFlowScore: string; provider: string }
  summaries: {
    highestBehavior: { code: string; name: string; score: number | null } | null
    highestFlow: { code: string; name: string; score: number | null } | null
    largestDivergence: { code: string; name: string; score: number } | null
  }
  warnings: string[]
  notTradingAdvice: true
}

export interface IndustryCrowdingRefreshReport {
  schemaVersion: 'fams.relative_rotation.industry_crowding_refresh.v2'
  year: number
  universeBoards: number
  requestedBoards: number
  skippedFreshBoards: number
  refreshedBoards: number
  flowReadyBoards: number
  readyBoards: number
  failedBoards: string[]
  incompleteBoards: string[]
  marketFlow: { refreshed: boolean; pointCount: number; warning: string | null }
  warnings: string[]
}

export async function getIndustryCrowdingReport(input: { year?: number; frequency?: 'daily' | 'weekly'; boardCodes?: string[] } = {}) {
  const response = await axios.get<IndustryCrowdingReport>('/api/v1/relative-rotation/industry-crowding', {
    params: {
      userId: 'default',
      year: input.year,
      frequency: input.frequency || 'weekly',
      boardCodes: input.boardCodes?.join(','),
    },
  })
  return response.data
}

export async function refreshIndustryCrowdingReport(year?: number) {
  const response = await axios.post<IndustryCrowdingRefreshReport>('/api/v1/relative-rotation/industry-crowding/refresh', {
    userId: 'default',
    year,
  })
  return response.data
}

export async function refreshIndustryCrowdingMarketFlow() {
  const response = await axios.post<{ refreshed: boolean; pointCount: number; warning: string | null }>('/api/v1/relative-rotation/industry-crowding/market-flow/refresh', {
    userId: 'default',
  })
  return response.data
}

export async function getRotationHoldings(frequency: 'weekly' | 'daily' = 'weekly', trail = 12) {
  const response = await axios.get<RotationHoldingsReport>('/api/v1/relative-rotation/holdings', {
    params: { userId: 'default', frequency, trail },
  })
  return response.data
}

export async function getPortfolioRotation(frequency: 'weekly' | 'daily' = 'weekly', years = 8) {
  const response = await axios.get<PortfolioRotationReport>('/api/v1/relative-rotation/portfolio-universe', {
    params: { userId: 'default', frequency, years },
  })
  return response.data
}

export async function refreshPortfolioRotation() {
  const response = await axios.post<{
    schemaVersion: 'fams.relative_rotation.portfolio_refresh.v1'
    requestedTargets: number
    completedTargets: number
  }>('/api/v1/relative-rotation/portfolio-universe/refresh', { userId: 'default' })
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

export async function getRotationResearchStudies() {
  const response = await axios.get<RotationResearchStudiesReport>('/api/v1/relative-rotation/research/studies', {
    params: { userId: 'default' },
  })
  return response.data
}

export async function createRotationResearchStudy(study: RotationResearchStudyInput) {
  const response = await axios.post<RotationResearchStudy>('/api/v1/relative-rotation/research/studies', {
    userId: 'default',
    study,
  })
  return response.data
}

export async function updateRotationResearchStudy(studyId: string, study: RotationResearchStudyInput) {
  const response = await axios.patch<RotationResearchStudy>(`/api/v1/relative-rotation/research/studies/${studyId}`, {
    userId: 'default',
    study,
  })
  return response.data
}

export async function deleteRotationResearchStudy(studyId: string) {
  const response = await axios.delete<{ deleted: true; studyId: string }>(`/api/v1/relative-rotation/research/studies/${studyId}`, {
    params: { userId: 'default' },
  })
  return response.data
}

export async function getRotationResearchTimeline(input: { studyId?: string; study?: RotationResearchStudyInput }) {
  const response = await axios.post<RotationResearchTimelineReport>('/api/v1/relative-rotation/research/timeline', {
    userId: 'default',
    ...input,
  })
  return response.data
}

export async function refreshRotationResearchTimeline(input: { studyId?: string; study?: RotationResearchStudyInput }) {
  const response = await axios.post<RotationResearchRefreshReport>('/api/v1/relative-rotation/research/refresh', {
    userId: 'default',
    ...input,
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
