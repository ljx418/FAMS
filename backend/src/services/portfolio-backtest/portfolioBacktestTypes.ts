export type PortfolioBacktestAllowedAction = 'RESEARCH' | 'OBSERVE' | 'COMPARE' | 'PLAN_DRAFT'
export type PortfolioBacktestProhibitedAction = 'ADD' | 'REDUCE' | 'ORDER_CREATE' | 'AUTO_TRADE'

export type PortfolioStrategySource = 'preset' | 'current_holdings' | 'dividend_low_vol' | 'custom'
export type PortfolioAssetClass = 'stock' | 'bond' | 'gold' | 'commodity' | 'cash' | 'fund' | 'etf'
export type PortfolioRebalanceFrequency = 'none' | 'monthly' | 'quarterly' | 'annually'
export type PortfolioScenarioPolicyId = 'buy_and_hold' | 'weekly' | 'semi_monthly' | 'monthly' | 'quarterly' | 'drift_3pp'
export type PortfolioDividendPolicy = 'cash' | 'reinvest'
export type PortfolioBacktestGradeMode = 'research' | 'formal_review'
export type PortfolioBenchmarkStatus = 'official_total_return' | 'trusted_total_return' | 'free_source_total_return' | 'price_index' | 'research_proxy' | 'unavailable'
export type PortfolioSourceDataGrade = 'official_authorized' | 'free_source_cross_checked' | 'price_index_only' | 'research_proxy' | 'insufficient'
export type PortfolioProviderClass = 'official_authorized' | 'free_source' | 'local_cache' | 'research_proxy' | 'manual_seed' | 'unknown'
export type PortfolioModelEffectivenessStatus = 'passed' | 'warning' | 'insufficient' | 'failed'
export type PortfolioManualSignoffRole = 'data' | 'model' | 'risk' | 'compliance' | 'final_release'

export interface PortfolioDataGradeItem {
  scope: 'price' | 'benchmark' | 'dividend' | 'tradeability'
  grade: PortfolioSourceDataGrade
  sourceProvider: string
  sourceType: string
  asOfDate: string | null
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

export interface PortfolioPaperOrderIntent {
  schemaVersion: 'portfolio.paper_order_intent.v1'
  intentId: string
  generatedAt: string
  source: 'manual_plan_draft'
  executionMode: 'paper' | 'sandbox'
  strategyId: string
  draftStatus: PortfolioManualPlanDraft['status']
  currentWeightPercent: number | null
  researchTargetWeightPercent: number | null
  formalTargetWeightPercent: 0
  notionalAmount: null
  suggestedActionTypes: PortfolioBacktestAllowedAction[]
  canCreateOrder: false
  orderCreateAllowed: false
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  blockedReasons: string[]
  evidenceRefs: string[]
  notTradingAdvice: true
}

export interface PortfolioExecutionIsolationAudit {
  schemaVersion: 'portfolio.execution_isolation_audit.v1'
  status: 'ready_for_paper_review' | 'blocked'
  mode: 'paper_sandbox_only'
  paperTradingReady: boolean
  sandboxReady: boolean
  productionAdapterEnabled: false
  realPositionMutationAllowed: false
  orderCreateAllowed: false
  canCreateOrder: false
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  intents: PortfolioPaperOrderIntent[]
  blockers: string[]
  warnings: string[]
  evidenceRefs: string[]
  notTradingAdvice: true
}

export interface PortfolioFormalTradingReleaseGateAudit {
  schemaVersion: 'portfolio.formal_trading_release_gate_audit.v1'
  status: 'blocked'
  formalTradingEligible: boolean
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  orderCreateAllowed: false
  canCreateOrder: false
  checks: Array<{
    id: string
    status: 'passed' | 'blocked' | 'requires_review'
    blocker?: string
    evidenceRefs: string[]
  }>
  blockers: string[]
  warnings: string[]
  notTradingAdvice: true
}

export interface PortfolioReleaseDataGovernanceAudit {
  schemaVersion: 'portfolio.release_data_governance_audit.v1'
  status: 'passed' | 'blocked'
  formalTradingEligible: boolean
  items: Array<{
    fieldId: string
    scope: PortfolioDataGradeItem['scope']
    sourceProvider: string
    providerClass: PortfolioProviderClass
    sourceEndpoint: string
    asOfDate: string | null
    fetchedAt: string
    freshnessStatus: PortfolioDataGradeItem['freshnessStatus']
    coverageStatus: 'passed' | 'blocked'
    coveragePercent: number
    crossCheckStatus: 'official_authorized' | 'free_source_cross_checked' | 'single_source' | 'proxy_or_insufficient'
    evidenceRefs: string[]
    blockers: string[]
    warnings: string[]
  }>
  blockers: string[]
  warnings: string[]
  notTradingAdvice: true
}

export interface PortfolioBenchmarkQualificationAudit {
  schemaVersion: 'portfolio.benchmark_qualification_audit.v1'
  status: 'passed' | 'blocked'
  benchmarkStatuses: Record<string, PortfolioBenchmarkStatus>
  hasFormalTotalReturn: boolean
  hasFreeSourceTotalReturn: boolean
  canSupportFormalReview: boolean
  canSupportFormalTrading: boolean
  blockers: string[]
  warnings: string[]
  evidenceRefs: string[]
  notTradingAdvice: true
}

export interface PortfolioFormalValidationAudit {
  schemaVersion: 'portfolio.formal_validation_audit.v1'
  status: PortfolioModelEffectivenessStatus
  formalTradingEligible: boolean
  formalValidationPassed: boolean
  allReleaseCandidatesPassed: boolean
  releaseCandidateSet: {
    schemaVersion: 'fams.release_candidate_set.v1'
    releaseCandidateStrategyIds: string[]
    releaseCandidateStrategyVersions: Record<string, string>
    excludedStrategies: Array<{ strategyId: string; reason: string }>
    candidateSetHash: string
    frozen: true
  }
  releaseEffectivePathCount: number
  industryGroupCount: number
  strategyCount: number
  passedStrategies: number
  warningStrategies: number
  insufficientStrategies: number
  failedStrategies: number
  checks: Array<{
    strategyId: string
    status: PortfolioModelEffectivenessStatus
    oosStatus: PortfolioModelEffectivenessStatus
    walkForwardStatus: PortfolioModelEffectivenessStatus
    parameterSensitivityStatus: PortfolioModelEffectivenessStatus
    groupStabilityStatus: PortfolioModelEffectivenessStatus | 'not_applicable'
    blockers: string[]
    evidenceRefs: string[]
  }>
  blockers: string[]
  warnings: string[]
  notTradingAdvice: true
}

export interface PortfolioManualSignoffAudit {
  schemaVersion: 'portfolio.manual_signoff_audit.v1'
  status: 'missing' | 'partial' | 'passed'
  requiredRoles: PortfolioManualSignoffRole[]
  records: Array<{
    role: PortfolioManualSignoffRole
    status: 'missing' | 'recorded'
    reviewerId: string | null
    reviewedAt: string | null
    decision: string | null
    notes: string | null
    blockedReasons: string[]
    evidenceRefs: string[]
  }>
  allRequiredSignedOff: boolean
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  canCreateOrder: false
  blockers: string[]
  warnings: string[]
  notTradingAdvice: true
}

export interface PortfolioLongHorizonDataCoverageAudit {
  schemaVersion: 'portfolio.long_horizon_data_coverage_audit.v1'
  status: 'passed' | 'blocked'
  longHorizonRealDataBacktestReady: boolean
  periods: Array<{
    periodId: '1y' | '3y' | '5y' | 'custom'
    label: string
    requestedStartDate: string
    requestedEndDate: string
    requiredTradingDays: number
    availableTradingDays: number
    coveragePercent: number
    comparableStrategyCount: number
    blockedReasons: string[]
    evidenceRefs: string[]
  }>
  blockers: string[]
  warnings: string[]
  notTradingAdvice: true
}

export interface PortfolioMultiPeriodBacktestResult {
  schemaVersion: 'portfolio.multi_period_backtest_result.v1'
  status: 'passed' | 'blocked'
  periods: Array<{
    periodId: '1y' | '3y' | '5y' | 'custom'
    label: string
    requestedStartDate: string
    requestedEndDate: string
    requiredTradingDays: number
    availableTradingDays: number
    coveragePercent: number
    strategyCount: number
    completedStrategyCount: number
    comparableStrategyCount: number
    blockedReasons: string[]
    strategySummaries: Array<{
      strategyId: string
      status: PortfolioBacktestStrategyResult['status']
      totalReturnPercent: number | null
      maxDrawdownPercent: number | null
      benchmarkReturnPercent: number | null
      excessReturnPercent: number | null
      equityCurvePoints: number
      firstCurveDate: string | null
      lastCurveDate: string | null
    }>
  }>
  blockers: string[]
  warnings: string[]
  notTradingAdvice: true
}

export interface PortfolioDividendTotalReturnAudit {
  schemaVersion: 'portfolio.dividend_total_return_audit.v1'
  status: 'passed' | 'blocked'
  mode: PortfolioDividendPolicy
  strategyCount: number
  coveredStrategyCount: number
  coveragePercent: number
  priceOnlyReturnAvailable: boolean
  dividendContributionAvailable: boolean
  capitalGainContributionAvailable: boolean
  costDragAvailable: boolean
  items: Array<{
    strategyId: string
    priceOnlyReturnPercent: number | null
    dividendContributionPercent: number | null
    capitalGainContributionPercent: number | null
    costDragPercent: number | null
    totalReturnMethod: 'price_plus_estimated_dividend' | 'price_only_no_audited_dividend_component' | 'price_only_or_insufficient'
    evidenceRefs: string[]
    warnings: string[]
  }>
  blockers: string[]
  warnings: string[]
  notTradingAdvice: true
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
  releaseCandidateStrategyIds: string[]
  releaseCandidateStrategyVersions: Record<string, string>
  excludedStrategies: Array<{
    strategyId: string
    reason: string
  }>
  ruleMode?: 'request_override' | 'registry_fixed'
  startDateSensitivity?: {
    enabled: boolean
    sampling: 'weekly_first_trading_day'
    minimumTradingDaysForAnnualization: number
  }
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
  scenarioAnalysis?: {
    enabled: boolean
    policyIds: PortfolioScenarioPolicyId[]
    executionPrice: 'next_open'
    lotSize: number
    minCommissionCny: number
    cashAnnualRate: number
    driftThresholdPercentagePoints: number
    validationMonths: number
  }
}

export interface PortfolioScenarioTrade {
  decisionDate: string
  executionDate: string
  reason: 'initial_allocation' | 'calendar_rebalance' | 'drift_threshold' | 'dividend_reinvestment'
  symbol: string
  name: string
  side: 'BUY' | 'SELL'
  quantity: number
  lots: number
  rawOpenPrice: number
  simulatedPrice: number
  grossAmount: number
  commission: number
  slippageCost: number
  totalCost: number
  postTradeWeightPercent: number
  cashAfter: number
}

export interface PortfolioScenarioMetrics {
  totalReturnPercent: number
  annualizedReturnPercent: number
  maxDrawdownPercent: number
  volatilityPercent: number
  sharpe: number | null
  calmar: number | null
  turnoverRatePercent: number
  totalCostCny: number
  costDragPercent: number
  tradeCount: number
  endingValue: number
}

export interface PortfolioScenarioResult {
  scenarioId: PortfolioScenarioPolicyId
  scenarioLabel: string
  status: 'completed' | 'insufficient'
  metrics: PortfolioScenarioMetrics
  validationMetrics: PortfolioScenarioMetrics
  equityCurve: PortfolioBacktestCurvePoint[]
  positionCurve: PortfolioPositionCurvePoint[]
  trades: PortfolioScenarioTrade[]
  decisionDates: string[]
  blockedReasons: string[]
  warnings: string[]
}

export interface PortfolioPositionCurvePoint {
  date: string
  portfolioValue: number
  pnlAmount: number
  cashAmount: number
  cashWeightPercent: number
  components: Array<{
    symbol: string
    name: string
    quantity: number
    marketValue: number
    weightPercent: number
  }>
}

export interface PortfolioStartDateSensitivityPoint {
  startDate: string
  actualStartDate: string
  endDate: string
  holdingTradingDays: number
  status: 'completed' | 'insufficient'
  totalReturnPercent: number
  peakReturnPercent: number
  annualizedReturnPercent: number | null
  maxDrawdownPercent: number
  endingValue: number
  pnlAmount: number
  tradeCount: number
  totalCostCny: number
  warnings: string[]
}

export interface PortfolioFixedRuleStudy {
  schemaVersion: 'portfolio.fixed_rule_study.v1'
  generatedAt: string
  requestedPeriod: { startDate: string; endDate: string }
  actualPeriod: { startDate: string | null; endDate: string | null; tradingDays: number }
  initialCapital: number
  ruleMode: 'registry_fixed'
  executionAssumptions: PortfolioClassicStudy['executionAssumptions']
  dataTruthAudit: PortfolioClassicStudy['dataTruthAudit']
  strategies: Array<{
    strategyId: string
    displayName: string
    strategyVersion: string
    components: PortfolioStrategyComponent[]
    appliedPolicy: {
      source: 'strategy_registry'
      frequency: PortfolioRebalanceFrequency
      scenarioId: PortfolioScenarioPolicyId
      frozenBeforeMarketDataEvaluation: true
    }
    primaryRun: PortfolioScenarioResult
    sensitivity: PortfolioStartDateSensitivityPoint[]
  }>
  aggregateSensitivity: Array<{
    startDate: string
    endDate: string
    holdingTradingDays: number
    strategyCount: number
    maximumTerminalReturnPercent: number
    averageTerminalReturnPercent: number
    worstMaxDrawdownPercent: number
    bestStrategyId: string
  }>
  sensitivityConfig: {
    sampling: 'weekly_first_trading_day'
    minimumTradingDaysForAnnualization: number
    startPointCount: number
  }
  methodology: {
    historicalRuleOptimizationUsed: false
    futureDataUsedToChooseRule: false
    summary: string
  }
  allowedActions: PortfolioBacktestAllowedAction[]
  prohibitedActions: PortfolioBacktestProhibitedAction[]
  notTradingAdvice: true
}

export interface PortfolioClassicStudy {
  schemaVersion: 'portfolio.classic_strategy_study.v1'
  generatedAt: string
  requestedPeriod: { startDate: string; endDate: string }
  actualPeriod: { startDate: string | null; endDate: string | null; tradingDays: number }
  initialCapital: number
  executionAssumptions: {
    signalTime: 'previous_close'
    executionPrice: 'next_open'
    lotSize: number
    feeRate: number
    minCommissionCny: number
    slippageRate: number
    stampDutyRate: 0
    cashAssetId: 'CNY_FIXED_1PCT'
    cashAnnualRate: number
  }
  dataTruthAudit: {
    status: 'passed' | 'blocked'
    minimumRequiredCoveragePercent: 98
    items: Array<{
      symbol: string
      name: string
      firstDate: string | null
      lastDate: string | null
      bars: number
      coveragePercent: number
      sourceProviders: string[]
      crossCheckProvider: string
      crossCheckedBars: number
      medianCloseDeviationPercent: number | null
      latestCloseDeviationPercent: number | null
      crossCheckStatus: 'passed' | 'blocked'
      distributionEvents: number
      distributionEventSource: 'official_sse_registry' | 'not_detected'
      officialDistributionEvidenceRefs: string[]
      totalReturnAdjustmentStatus: 'official_cash_distributions' | 'not_detected' | 'insufficient'
      status: 'passed' | 'blocked'
      warnings: string[]
    }>
    blockers: string[]
    warnings: string[]
    evidenceRefs: string[]
  }
  strategies: Array<{
    strategyId: string
    displayName: string
    components: PortfolioStrategyComponent[]
    scenarios: PortfolioScenarioResult[]
    preferredScenarioId: PortfolioScenarioPolicyId | null
    preferenceReason: string
    nextDecision: {
      decisionDate: string | null
      executionDate: string | null
      rule: string
      calendarSource: string
    }
  }>
  conclusion: {
    bestStrategyId: string | null
    bestScenarioId: PortfolioScenarioPolicyId | null
    summary: string
    confidence: 'medium' | 'low' | 'insufficient'
    horizon: 'three_year_research'
    caveats: string[]
  }
  allowedActions: PortfolioBacktestAllowedAction[]
  prohibitedActions: PortfolioBacktestProhibitedAction[]
  notTradingAdvice: true
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
  portfolioValue?: number
  pnlAmount?: number
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
  paperOrderIntents?: PortfolioPaperOrderIntent[]
  executionIsolationAudit?: PortfolioExecutionIsolationAudit
  releaseGateAudit?: PortfolioFormalTradingReleaseGateAudit
  dataGovernanceAudit?: PortfolioReleaseDataGovernanceAudit
  benchmarkQualificationAudit?: PortfolioBenchmarkQualificationAudit
  formalValidationAudit?: PortfolioFormalValidationAudit
  manualSignoffAudit?: PortfolioManualSignoffAudit
  longHorizonDataCoverageAudit?: PortfolioLongHorizonDataCoverageAudit
  multiPeriodBacktestResult?: PortfolioMultiPeriodBacktestResult
  dividendTotalReturnAudit?: PortfolioDividendTotalReturnAudit
  classicPortfolioStudy?: PortfolioClassicStudy
  fixedRuleStudy?: PortfolioFixedRuleStudy
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
