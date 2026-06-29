import type { DataGap } from '../analysis/dataGapTypes.js'

export type DividendLowVolDisposition =
  | 'watch_candidate'
  | 'low_zone_alert'
  | 'build_position_plan'
  | 'add_on_pullback'
  | 'hold_for_dividend'
  | 'trim_high_zone'
  | 'exit_dividend_risk'
  | 'avoid'
  | 'data_insufficient'

export type DividendLowVolAlertType =
  | 'DIVIDEND_LOW_ZONE'
  | 'DIVIDEND_BUILD_PLAN'
  | 'DIVIDEND_ADD_ON_PULLBACK'
  | 'DIVIDEND_HIGH_ZONE'
  | 'DIVIDEND_TRIM'
  | 'DIVIDEND_EXIT_RISK'
  | 'DIVIDEND_REBALANCE_DUE'
  | 'DIVIDEND_DATA_GAP'

export type LeaderVerificationStatus =
  | 'verified_industry_leader'
  | 'leader_candidate'
  | 'leader_partial'
  | 'not_leader'
  | 'insufficient'

export interface DividendRecord {
  year: number
  dividendPerShare: number
  exDividendDate?: string
  payoutDate?: string
  evidenceRef: string
}

export interface DividendLowVolInput {
  assetId?: string
  symbol: string
  name: string
  market?: 'A_SHARE' | 'HK' | 'US' | 'UNKNOWN'
  assetType?: 'stock' | 'etf' | 'fund'
  industry?: string
  isST?: boolean
  isSuspended?: boolean
  isDelisted?: boolean
  listingAgeDays?: number
  price?: number
  positionWeightPercent?: number
  positionContext?: {
    isHolding: boolean
    quantity?: number
    marketValue?: number
    portfolioWeightPercent?: number
    avgCost?: number
    unrealizedPnlPercent?: number
    positionId?: string
  }
  dividendRecords?: DividendRecord[]
  ttmDividendPerShare?: number
  payoutRatio?: number
  operatingCashFlowToNetProfit?: number
  roe?: number
  debtToAsset?: number
  profitGrowth3y?: number
  operatingRevenue?: number
  netProfit?: number
  pe?: number
  pb?: number
  totalMarketCap?: number
  avgTurnoverAmount60?: number
  leaderScore?: number
  marketCapRankScore?: number
  revenueRankScore?: number
  netProfitRankScore?: number
  roeIndustryPercentile?: number
  liquidityRankScore?: number
  industryDividendYieldPercentile?: number
  history?: Array<{
    date: string
    open: number
    high: number
    low: number
    close: number
    volume: number
    amount?: number
    isTradable?: boolean
    tradabilityStatus?: 'tradable' | 'suspended' | 'limit_up_blocked' | 'limit_down_blocked' | 'unknown'
    isSuspended?: boolean
    limitUp?: number
    limitDown?: number
    tradeabilityEvidenceRef?: string
  }>
  evidenceRefs?: string[]
}

export interface DividendLowVolScores {
  dividendScore: number
  leaderScore?: number
  dividendQualityScore: number
  lowVolScore: number
  valuationScore: number
  timingScore: number
  riskScore: number
  financialRiskScore?: number
  portfolioFitScore: number
  evidenceQualityScore: number
  totalResearchScore: number
  evidenceAdjustedScore: number
}

export type DividendLowVolDataTrustGrade = 'A' | 'B' | 'C' | 'D' | 'INSUFFICIENT'

export interface DividendLowVolDataTrustSummary {
  schemaVersion: 'dividend.low_vol.data_trust.v1'
  grade: DividendLowVolDataTrustGrade
  confidencePercent: number
  providerMode: 'formal_provider' | 'free_source_research' | 'mixed' | 'unknown'
  coverageStatus: 'complete' | 'partial' | 'low_coverage' | 'insufficient'
  freshnessStatus: 'fresh' | 'stale' | 'expired' | 'unknown'
  crossCheckStatus: 'verified' | 'partial' | 'fallback' | 'not_checked'
  displayLabel: string
  blockers: string[]
  warnings: string[]
  lastVerifiedAt?: string
  note: string
}

export interface DividendLowVolCalculationAudit {
  schemaVersion: 'dividend.low_vol.calculation_audit.v1'
  formulaVersion: string
  replayStatus: 'passed' | 'failed' | 'insufficient'
  inputFieldCount: number
  missingInputFields: string[]
  formulaRefs: string[]
  mismatchCount: number
  generatedAt: string
  note: string
}

export interface DividendLowVolDiscipline {
  allowedActions: Array<'RESEARCH' | 'OBSERVE' | 'ALERT' | 'PLAN_DRAFT'>
  prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
  planDraftAllowed: boolean
  formalTradeActionAllowed: false
  autoTradeAllowed: false
  positionGuidance: {
    targetPositionPercentRange: [number, number] | null
    firstBuildPercentOfTarget: [number, number] | null
    singleStockCapPercent: number
    industryCapPercent: number
  }
  reviewRequiredBeforeExecution: string[]
}

export type DividendLowVolTradingZoneStrategyId =
  | 'dividend_low_vol_bollinger_reversion_v1'
  | 'dividend_low_vol_yield_ma_reversion_v1'

export type DividendLowVolTradingZoneSignal =
  | 'buy_zone'
  | 'hold_zone'
  | 'sell_zone'
  | 'exit_risk'
  | 'insufficient'

export interface DividendLowVolTradingZonePriceAudit {
  currentPrice?: number
  tradeDate?: string
  sourceType: 'canonical_bar' | 'raw_bar' | 'free_provider_history' | 'market_history' | 'fallback_seed' | 'unknown'
  sourceRefs: string[]
  freshnessStatus: 'fresh' | 'stale' | 'unknown'
  sanityStatus: 'aligned' | 'price_zone_mismatch' | 'insufficient'
  priceToAnchorRatio?: number
  warnings: string[]
}

export interface DividendLowVolTradingZoneStrategy {
  strategyId: DividendLowVolTradingZoneStrategyId
  label: string
  status: 'available' | 'insufficient'
  currentSignal: DividendLowVolTradingZoneSignal
  buyZone: { low: number | null; high: number | null; rationale: string[] }
  sellZone: { low: number | null; high: number | null; rationale: string[] }
  stopLoss: number | null
  indicators: {
    price?: number
    bollingerLower?: number
    bollingerMiddle?: number
    bollingerUpper?: number
    bollingerPercentB?: number
    ma120?: number
    ma250?: number
    rsi14?: number
    atrRatio?: number
    dividendYieldHistoricalPercentile?: number
    lowZoneScore?: number
    highZoneScore?: number
  }
  priceAudit?: DividendLowVolTradingZonePriceAudit
  invalidationConditions: string[]
  evidenceRefs: string[]
}

export interface DividendLowVolTradingZoneResult {
  schemaVersion: 'dividend.low_vol.trading_zone.v1'
  generatedAt: string
  strategyFamily: 'dividend_low_volatility'
  strategyId: 'dividend_low_vol_leader_v1'
  totalCandidates: number
  zones: Array<{
    symbol: string
    name: string
    industry?: string
    price?: number
    candidateGrade?: 'A' | 'B' | 'WATCH' | 'EXCLUDED'
    disposition: DividendLowVolDisposition
    evidenceAdjustedScore: number
    priceAudit?: DividendLowVolTradingZonePriceAudit
    strategies: DividendLowVolTradingZoneStrategy[]
    prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
    notTradingAdvice: true
  }>
  policy: {
    allowedActions: Array<'RESEARCH' | 'OBSERVE' | 'ALERT' | 'PLAN_DRAFT'>
    prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
  }
  notTradingAdvice: true
}

export interface DividendLowVolRollingBacktestResult {
  schemaVersion: 'dividend.low_vol.rolling_backtest.v1'
  generatedAt: string
  strategyFamily: 'dividend_low_volatility'
  strategyId: 'dividend_low_vol_leader_v1'
  status: 'completed' | 'insufficient'
  window: {
    requestedYears: number
    requestedTradingDays: number
    minRequiredTradingDays: number
    maxEffectiveTradingDays: number
  }
  strategyResults: Array<{
    strategyId: DividendLowVolTradingZoneStrategyId
    label: string
    status: 'completed' | 'insufficient'
    sample: {
      candidateCount: number
      effectiveCandidateCount: number
      tradeCount: number
      averageEffectiveTradingDays: number
    }
    metrics: {
      winRatePercent: number | null
      totalReturnPercent: number | null
      annualizedReturnPercent: number | null
      maxDrawdownPercent: number | null
      averageHoldingDays: number | null
      profitFactor: number | null
      dividendContributionPercent: number | null
      capitalGainContributionPercent: number | null
      costDragPercent: number | null
      benchmarkReturnPercent: number | null
      excessReturnPercent: number | null
    }
    signalCounts: {
      buySignals: number
      sellSignals: number
      exitRiskSignals: number
    }
    insufficientItems: string[]
  }>
  conclusion: {
    bestStrategyId: DividendLowVolTradingZoneStrategyId | null
    researchPassed: boolean
    reason: string
  }
  policy: {
    allowedActions: Array<'RESEARCH' | 'OBSERVE' | 'ALERT' | 'PLAN_DRAFT'>
    prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
  }
  notTradingAdvice: true
}

export interface DividendLowVolFactSet {
  schemaVersion: 'dividend.low_vol.factset.v1'
  generatedAt: string
  strategyFamily: 'dividend_low_volatility'
  strategyId: 'dividend_low_vol_v1' | 'dividend_low_vol_leader_v1'
  identity: {
    assetId?: string
    symbol: string
    name: string
    market: 'A_SHARE' | 'HK' | 'US' | 'UNKNOWN'
    assetType: 'stock' | 'etf' | 'fund'
    industry?: string
    isST: boolean
    isSuspended: boolean
    listingAgeDays?: number
  }
  dividend: {
    ttmDividendYield?: number
    avgDividendYield3y?: number
    dividendYieldPercentile3y?: number
    dividendYears: number
    consecutiveDividendYears: number
    cashDividendPerShareHistory: DividendRecord[]
    dpsGrowth3y?: number
    payoutRatio?: number
    dividendCoverageByEarnings?: number
    dividendCoverageByOperatingCashFlow?: number
    specialDividendFlag: boolean
    dividendCutFlag: boolean
    dpsConsecutiveDecline: boolean
    dividendTrapFlag: boolean
    dividendRiskFlags: string[]
    sourceRefs?: {
      dividendHistory: string[]
      ttmDividendYield: string[]
      payoutRatio: string[]
      dpsGrowth: string[]
      dividendRisk: string[]
      crossCheckStatus?: 'cross_checked' | 'single_source' | 'fallback_seed' | 'insufficient'
      missingEvidenceFields?: string[]
    }
  }
  leaderEvidence: {
    status: LeaderVerificationStatus
    marketCapRankVerified: boolean
    revenueRankVerified: boolean
    netProfitRankVerified: boolean
    roePercentileVerified: boolean
    providerCrossCheckedIndustryRank: boolean
    seedFallbackUsed: boolean
    evidenceRefs: string[]
    missingFields: string[]
    note: string
  }
  quality: {
    roe?: number
    debtToAsset?: number
    operatingCashFlowToNetProfit?: number
    earningsStabilityScore?: number
    financialRiskFlags: string[]
  }
  lowVolatility: {
    volatility60d?: number
    volatility120d?: number
    volatility250d?: number
    betaToMarket?: number
    maxDrawdown60d?: number
    maxDrawdown250d?: number
    atr14?: number
    lowVolScore: number
  }
  valuation: {
    pe?: number
    pb?: number
    dividendYieldHistoricalPercentile?: number
    valuationScore: number
  }
  timing: {
    price?: number
    ma20?: number
    ma60?: number
    ma120?: number
    ma250?: number
    rsi14?: number
    drawdownFrom250dHigh?: number
    lowZoneScore: number
    highZoneScore: number
  }
  positionContext: {
    isHolding: boolean
    quantity?: number
    marketValue?: number
    portfolioWeightPercent?: number
    avgCost?: number
    unrealizedPnlPercent?: number
    positionId?: string
    researchTargetWeightPercent?: number
    formalTargetWeightPercent: 0
  }
  scores: DividendLowVolScores
  dataVerification: {
    status: 'cross_checked' | 'single_source' | 'provider_fallback' | 'insufficient'
    providerCount: number
    primaryProvider?: string
    freshnessStatus?: 'fresh' | 'stale' | 'unknown'
    crossCheckedFields: string[]
    warningCount: number
    warnings: string[]
    sourceRefs: string[]
  }
  metricCompleteness: {
    status: 'complete' | 'incomplete'
    displayReady: boolean
    requiredMetrics: string[]
    missingMetrics: string[]
    completeMetricCount: number
    totalMetricCount: number
    note: string
  }
  dataTrust: DividendLowVolDataTrustSummary
  calculationAudit: DividendLowVolCalculationAudit
  candidateGrade?: 'A' | 'B' | 'WATCH' | 'EXCLUDED'
  disposition: DividendLowVolDisposition
  alerts: Array<{
    type: DividendLowVolAlertType
    severity: 'info' | 'warning' | 'danger'
    triggerReason: string
    validUntil?: string
    invalidationConditions: string[]
    evidenceRefs: string[]
  }>
  tradingDiscipline: DividendLowVolDiscipline
  blockedReasons: string[]
  dataGapSummary: DataGap[]
  evidenceRefs: string[]
}
