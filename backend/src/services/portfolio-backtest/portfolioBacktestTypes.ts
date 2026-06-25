export type PortfolioBacktestAllowedAction = 'RESEARCH' | 'OBSERVE' | 'COMPARE' | 'PLAN_DRAFT'
export type PortfolioBacktestProhibitedAction = 'ADD' | 'REDUCE' | 'ORDER_CREATE' | 'AUTO_TRADE'

export type PortfolioStrategySource = 'preset' | 'current_holdings' | 'dividend_low_vol' | 'custom'
export type PortfolioAssetClass = 'stock' | 'bond' | 'gold' | 'commodity' | 'cash' | 'fund' | 'etf'
export type PortfolioRebalanceFrequency = 'none' | 'monthly' | 'quarterly' | 'annually'
export type PortfolioDividendPolicy = 'cash' | 'reinvest'
export type PortfolioBacktestGradeMode = 'research' | 'formal_review'
export type PortfolioBenchmarkStatus = 'formal_total_return' | 'free_source_total_return' | 'price_index' | 'research_proxy' | 'unavailable'
export type PortfolioSourceDataGrade = 'official_authorized' | 'free_source_cross_checked' | 'price_index_only' | 'research_proxy' | 'insufficient'
export type PortfolioModelEffectivenessStatus = 'passed' | 'warning' | 'insufficient' | 'failed'

export interface PortfolioDataGradeItem {
  scope: 'price' | 'benchmark' | 'dividend' | 'tradeability'
  grade: PortfolioSourceDataGrade
  sourceProvider: string
  sourceType: string
  freshnessStatus: 'fresh' | 'stale' | 'unknown'
  coveragePercent: number
  blockingForFormalTrading: boolean
  evidenceRefs: string[]
  warnings: string[]
}

export interface PortfolioDataGradeAudit {
  status: 'passed' | 'warning' | 'blocked'
  aggregateGrade: PortfolioSourceDataGrade
  formalTradingEligible: boolean
  items: PortfolioDataGradeItem[]
  blockers: string[]
}

export interface PortfolioModelEffectiveness {
  status: PortfolioModelEffectivenessStatus
  inSampleReturnPercent: number | null
  outOfSampleReturnPercent: number | null
  outOfSampleExcessReturnPercent: number | null
  maxDrawdownPercent: number | null
  walkForwardWindows: number
  walkForwardPassedWindows: number
  oos: {
    status: PortfolioModelEffectivenessStatus
    trainReturnPercent: number | null
    testReturnPercent: number | null
    testExcessReturnPercent: number | null
    evidenceRefs: string[]
  }
  walkForward: {
    status: PortfolioModelEffectivenessStatus
    windows: number
    passedWindows: number
    passRatioPercent: number | null
    evidenceRefs: string[]
  }
  parameterSensitivityStatus: PortfolioModelEffectivenessStatus
  parameterSensitivity: {
    status: PortfolioModelEffectivenessStatus
    testedVariants: string[]
    stableVariants: string[]
    evidenceRefs: string[]
    notes: string[]
  }
  groupStabilityStatus: PortfolioModelEffectivenessStatus | 'not_applicable'
  groupStability: {
    status: PortfolioModelEffectivenessStatus | 'not_applicable'
    groups: Array<{
      groupId: string
      status: PortfolioModelEffectivenessStatus | 'not_applicable'
      evidenceRefs: string[]
    }>
    evidenceRefs: string[]
    notes: string[]
  }
  failureTaxonomy: string[]
  evidenceRefs: string[]
}

export interface PortfolioManualPlanDraft {
  status: 'draft_ready' | 'blocked'
  draftType: 'PLAN_DRAFT'
  strategyId: string
  currentWeightPercent: number | null
  researchTargetWeightPercent: number | null
  formalTargetWeightPercent: 0
  driftPercent: number | null
  suggestedActionTypes: PortfolioBacktestAllowedAction[]
  portfolioRiskCheck: 'passed' | 'blocked' | 'insufficient'
  tradeabilityCheck: 'passed' | 'blocked' | 'insufficient'
  priceFreshnessCheck: 'passed' | 'blocked' | 'insufficient'
  humanReviewChecklist: string[]
  blockedReasons: string[]
  evidenceRefs: string[]
}

export interface PortfolioFormalTradingUnlockChecklist {
  status: 'blocked'
  officialBenchmarkReviewed: boolean
  modelEffectivenessReviewed: boolean
  tradeConstraintsReviewed: boolean
  portfolioRiskReviewed: boolean
  priceFreshnessReviewed: boolean
  humanReviewerConfirmed: false
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  blockers: string[]
}

export interface PortfolioBacktestReadinessSummary {
  researchReady: boolean
  formalReviewReady: boolean
  manualDraftReady: boolean
  formalTradingEligible: boolean
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  statusMessage: string
  blockers: string[]
  warnings: string[]
}

export interface PortfolioBacktestFormalReviewReadiness {
  status: 'passed' | 'blocked'
  ready: boolean
  blockers: string[]
  warnings: string[]
  benchmarkStatuses: Record<string, PortfolioBenchmarkStatus>
  tradeConstraintCoverage: {
    status: 'passed' | 'blocked'
    requiredRows: number
    coveredRows: number
    coveragePercent: number
    missingSymbols: string[]
    evidenceRefs: string[]
  }
  dividendReturnCoverage: {
    status: 'passed' | 'blocked'
    strategyCount: number
    coveredStrategies: number
    coveragePercent: number
    blockers: string[]
  }
}

export interface PortfolioStrategyComponent {
  assetClass: PortfolioAssetClass
  symbol?: string
  name?: string
  targetWeightPercent: number
  proxySymbol?: string
  proxyReason?: string
  evidenceRefs: string[]
}

export interface PortfolioStrategyDefinition {
  strategyId: string
  strategyVersion: string
  displayName: string
  source: PortfolioStrategySource
  components: PortfolioStrategyComponent[]
  rebalancePolicy: {
    frequency: PortfolioRebalanceFrequency
    thresholdPercent?: number
  }
  dividendPolicy: PortfolioDividendPolicy
  costModel: {
    feeRate: number
    slippageRate: number
    taxRate?: number
  }
  benchmarkPolicy: {
    benchmarkIds: string[]
    proxyAllowed: boolean
  }
  snapshot?: {
    capturedAt: string
    totalMarketValue?: number
    source: string
    tradeDate?: string
    refreshTime?: string
    strategyVersion?: string
    selectionRules?: string[]
    candidateCount?: number
    selectedCandidateCount?: number
    weightPolicy?: 'equal_weight' | 'score_weighted' | 'custom'
    evidenceRefs?: string[]
  }
  validation: {
    status: 'valid' | 'insufficient' | 'invalid'
    blockedReasons: string[]
    warnings: string[]
  }
  evidenceRefs: string[]
}

export interface PortfolioBacktestRequest {
  userId: string
  portfolioStrategyIds: string[]
  startDate: string
  endDate: string
  initialCapital: number
  rebalanceFrequency: PortfolioRebalanceFrequency
  dividendMode: PortfolioDividendPolicy
  feeRate: number
  slippageRate: number
  benchmarkIds: string[]
  gradeMode?: PortfolioBacktestGradeMode
  customStrategies?: Array<{
    strategyId?: string
    displayName?: string
    components: Array<{
      assetClass: PortfolioAssetClass
      symbol?: string
      name?: string
      targetWeightPercent: number
    }>
  }>
}

export interface PortfolioBacktestInputBuildResult {
  schemaVersion: 'portfolio.strategy_backtest.input.v1'
  generatedAt: string
  request: PortfolioBacktestRequest
  strategies: PortfolioStrategyDefinition[]
  allowedActions: PortfolioBacktestAllowedAction[]
  prohibitedActions: PortfolioBacktestProhibitedAction[]
  notTradingAdvice: true
  dataQuality: {
    status: 'ready' | 'partial' | 'insufficient'
    strategyCount: number
    validStrategyCount: number
    blockedReasons: string[]
    warnings: string[]
  }
  runtimeHealth?: Record<string, unknown>
}

export interface PortfolioBacktestCurvePoint {
  date: string
  netValue: number
  cumulativeReturnPercent: number
  dailyReturnPercent?: number
  drawdownPercent: number
  benchmark?: Record<string, {
    netValue: number
    cumulativeReturnPercent: number
  }>
}

export interface PortfolioBacktestStrategyResult {
  definition: PortfolioStrategyDefinition
  status: 'completed' | 'partial' | 'insufficient' | 'failed'
  equityCurve: PortfolioBacktestCurvePoint[]
  drawdownCurve: Array<{ date: string; drawdownPercent: number }>
  metrics: {
    totalReturnPercent: number | null
    priceOnlyReturnPercent?: number | null
    annualizedReturnPercent: number | null
    maxDrawdownPercent: number | null
    volatilityPercent: number | null
    sharpe: number | null
    calmar: number | null
    monthlyWinRate: number | null
    turnoverRate: number | null
    dividendContributionPercent: number | null
    capitalGainContributionPercent: number | null
    costDragPercent?: number | null
    benchmarkReturnPercent: number | null
    excessReturnPercent: number | null
  }
  dataCoverage: {
    priceCoveragePercent: number
    dividendCoveragePercent?: number
    benchmarkCoveragePercent?: number
    missingSymbols: string[]
  }
  blockedReasons: string[]
  warnings: string[]
  evidenceRefs: string[]
  formalReviewReadiness?: PortfolioBacktestFormalReviewReadiness
  dataGradeAudit?: PortfolioDataGradeAudit
  modelEffectiveness?: PortfolioModelEffectiveness
  manualPlanDraft?: PortfolioManualPlanDraft
}

export interface PortfolioBacktestResult {
  schemaVersion: 'portfolio.strategy_backtest.result.v1'
  generatedAt: string
  runId: string
  userId: string
  request: PortfolioBacktestRequest
  strategies: PortfolioBacktestStrategyResult[]
  allowedActions: PortfolioBacktestAllowedAction[]
  prohibitedActions: PortfolioBacktestProhibitedAction[]
  notTradingAdvice: true
  runtimeHealth?: Record<string, unknown>
  formalReviewReadiness?: PortfolioBacktestFormalReviewReadiness
  dataGradeAudit?: PortfolioDataGradeAudit
  modelEffectiveness?: {
    status: PortfolioModelEffectivenessStatus
    strategyCount: number
    passedStrategies: number
    warningStrategies: number
    insufficientStrategies: number
    failedStrategies: number
    blockers: string[]
  }
  manualPlanDrafts?: PortfolioManualPlanDraft[]
  formalTradingUnlockChecklist?: PortfolioFormalTradingUnlockChecklist
  readinessSummary?: PortfolioBacktestReadinessSummary
}

export const PORTFOLIO_BACKTEST_ALLOWED_ACTIONS: PortfolioBacktestAllowedAction[] = [
  'RESEARCH',
  'OBSERVE',
  'COMPARE',
  'PLAN_DRAFT',
]

export const PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS: PortfolioBacktestProhibitedAction[] = [
  'ADD',
  'REDUCE',
  'ORDER_CREATE',
  'AUTO_TRADE',
]
