import { API_BASE } from '../config/api'

// 建议类型
export type SuggestionType = 'grid_order' | 'dca_plan' | 'stop_loss' | 'take_profit' | 'rebalance' | 'buy_candidate' | 'reduce_position' | 'hold_review'

export interface Suggestion {
  id: string
  type: SuggestionType
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  targetSymbol?: string
  assetId?: string
  adviceId?: string
  actionId?: string
  actionType?: 'buy' | 'sell' | 'hold' | 'rebalance' | 'grid_order' | 'dca'
  suggestedQuantity?: number
  suggestedPrice?: number
  suggestedAmount?: number
  confidence?: number
  status?: string
  parameters: Record<string, any>
  createdAt: string
}

export interface StructuredAdviceAction {
  asset_code?: string
  asset_name?: string
  asset_type?: string
  action: 'buy' | 'sell' | 'hold' | 'rebalance' | 'grid_order' | 'dca' | 'watch'
  priority: 'low' | 'medium' | 'high'
  confidence?: number
  reason: string
  suggested_quantity?: number | null
  suggested_amount?: number | null
  suggested_price?: number | null
  target_position_pct?: number | null
  stop_loss?: number | null
  take_profit?: number | null
  requires_asset_creation: boolean
  action_id?: string
  advice_id?: string
}

export interface StructuredAdvice {
  schema_version: string
  generated_at: string
  scope: 'portfolio' | 'holding' | 'candidate' | 'strategy'
  summary: string
  risk_level: 'low' | 'medium' | 'high'
  required_user_confirmation: boolean
  portfolio_view?: {
    total_value: number
    cash_pct: number
    concentration_risk: 'low' | 'medium' | 'high'
    primary_observations: string[]
  }
  portfolio_targets?: Array<{
    bucket: string
    current_pct: number
    target_pct: number
    suggestion: 'increase' | 'decrease' | 'maintain'
  }>
  actions: StructuredAdviceAction[]
  risks: string[]
  disclaimer: string
}

export interface DataReliabilitySummary {
  overallStatus: 'healthy' | 'degraded' | 'failing' | 'unknown'
  averageConfidence: number | null
  warningCount: number
  warnings: string[]
  providerSummary: Array<{
    provider: string
    label: string
    successes: number
    failures: number
    fallbackHits: number
    healthScore: number
    status: 'healthy' | 'degraded' | 'failing' | 'unknown'
  }>
}

export interface MarketDataTraceItem {
  assetId?: string
  symbol: string
  name?: string
  assetType?: string
  source?: string | null
  sourceLabel?: string | null
  price?: number | null
  priceChangePercent?: number | null
  confidenceScore?: number | null
  sourceTime?: string | null
  timestamp?: string | null
  isValid?: boolean | null
  fallbackUsed?: boolean
  warnings?: string[]
}

export interface DailySuggestion {
  date: string
  adviceId?: string
  query?: string | null
  scope?: AnalysisScope
  matchedPositions?: number
  suggestions: Suggestion[]
  structuredAdvice?: StructuredAdvice
  marketDataTrace?: MarketDataTraceItem[]
  dataReliability?: DataReliabilitySummary
  riskLevel: 'low' | 'medium' | 'high'
  overallScore: number
  marketOutlook: string
  disclaimer?: string
}

export type AnalysisScope = 'all' | 'asset' | 'sector'

export interface TargetResearchResult extends DailySuggestion {
  targetType: 'asset' | 'sector'
  input: string
  targetName: string
  recommendation: 'buy' | 'watch' | 'avoid'
  recommendationText: string
  score: number
  quote?: {
    symbol: string
    name?: string
    assetType?: string
    price: number
    priceChange: number
    priceChangePercent: number
    source: string
    sourceLabel?: string | null
    timestamp?: string | null
    sourceTime?: string | null
    isValid: boolean
    confidenceScore?: number
    fallbackUsed?: boolean
    warnings?: string[]
    providerHealth?: Array<{
      provider: string
      label: string
      status: 'used' | 'fallback' | 'compared' | 'unavailable'
    }>
  } | null
  dataReliability?: DataReliabilitySummary
  warnings?: string[]
  matchedAssets?: Array<{
    symbol: string
    name: string
    type: string
    sector?: string
    industry?: string
    lastPrice?: number
  }>
  researchDetail?: {
    news: { summary: string; sentiment: string; watchItems: string[] }
    fundamental: { summary: string; quality: string; valuation: string }
    technical: {
      summary: string
      support?: number
      resistance?: number
      currentPrice?: number
      priceChangePercent?: number
    }
    positionStrategy: {
      holdingValue: number
      avgCost?: number | null
      buyRange?: { min: number; max: number } | null
      strategy: string
    }
  }
  aiAdvice?: {
    provider: 'minimax' | 'deepseek' | 'fallback'
    isAiGenerated: boolean
    status: 'available' | 'insufficient_data'
    observation: string
    confidence: string
    summary: string
    evidence: Array<{ id: string; label: string; value: string; source: string }>
    evidenceRefs: string[]
    reasoning: Array<{ title: string; detail: string; evidenceRefs: string[] }>
    dataGaps: string[]
    riskWarning: string
  } | null
}

export interface StockScreenerResult {
  query: string
  strategy: string
  strategyDefinition?: {
    id: string
    name: string
    description: string
    thresholds: Record<string, number>
    requiredHistoryDays: number
  }
  universeSize: number
  universeTotal?: number
  scannedCount?: number
  universeSource?: string
  matchedCount: number
  candidates: Array<{
    symbol: string
    name: string
    strategyId?: string
    matched: boolean
    score: number
    drawdownPercent: number
    sidewaysRangePercent: number
    lastTwoVolumeRatio: number
    support?: number
    resistance?: number
    currentPrice?: number
    peDynamic?: number
    pb?: number
    totalMarketCap?: number
    floatMarketCap?: number
    historySource?: string
    historyDays?: number
    hardFilterPassed?: boolean
    hardFilterRules?: string[]
    hardFilterFailures?: string[]
    matchedRules?: string[]
    unmatchedReasons?: string[]
    reason: string
    advice: string
    aiAdvice?: TargetResearchResult['aiAdvice']
  }>
  dataQuality?: {
    screened: number
    insufficientHistory: number
    totalUniverse?: number
    scanned?: number
    scanCoveragePercent?: number
    historySources: string[]
  }
  observability?: {
    elapsedMs: number
    concurrency: number
    providerSuccessRate: number
    failureCount: number
    matchedCount: number
  }
  asyncStrategyEvidence?: {
    schemaVersion: 'fams.screener.async_strategy_evidence_ref.v1'
    status: 'referenced' | 'missing'
    evidenceMode: 'async_strategy_evidence'
    evidenceOperationId?: string
    batchId?: string | null
    generatedAt?: string
    backtestDays?: number
    artifactRefs: string[]
    acceptanceStatus?: 'passed' | 'failed' | 'insufficient'
    bestCredibility?: 'high' | 'medium' | 'low' | 'insufficient' | 'unknown'
    bestSampleSize?: number
    scannedCount?: number
    evaluatedCount?: number
    failureCount?: number
    scanCoveragePercent?: number
    validationDecision?: {
      decision: 'TRADING_RESEARCH_ALLOWED' | 'OBSERVE_ONLY' | 'INSUFFICIENT_DATA'
      usableForTradingAdvice: boolean
      confidence: 'high' | 'medium' | 'low' | 'insufficient'
      primaryBlocker?: string
      blockerGateIds: string[]
      reasons: string[]
      requiredNextChecks: string[]
      oosSummary?: {
        diagnosedCandidates: number
        passedCount: number
        failedCount: number
      }
    }
    gateSummary?: Array<{
      id: string
      status: 'passed' | 'failed' | 'insufficient'
      severity: 'blocker' | 'warning'
      message: string
    }>
    topCandidates?: Array<{
      candidateId: string
      strategyId: string
      sampleSize: number
      tradeCount: number
      credibility: 'high' | 'medium' | 'low' | 'insufficient'
      excessReturnPercent: number | null
      outOfSampleStatus: string
      walkForwardStatus: string
      parameterSensitivityStatus: string
      groupStabilityStatus: string
    }>
    usableForTradingAdvice: boolean
    blockedReasons: string[]
    reason?: string
  }
  validationEvidenceMatrix?: {
    schemaVersion: 'fams.screener.validation_evidence_matrix.v1'
    status: 'passed' | 'blocked'
    decision: 'READY_FOR_MANUAL_REVIEW' | 'OBSERVE_ONLY'
    summary: {
      rankedCandidates: number
      diagnosedCandidates: number
      passedCandidates: number
      failedCandidates: number
      insufficientCandidates: number
      primaryBlocker: string
    }
    candidates: Array<{
      candidateId: string
      strategyId: string
      name: string
      sampleSize: number
      tradeCount: number
      credibility: 'high' | 'medium' | 'low' | 'insufficient'
      validation: {
        outOfSample: 'passed' | 'failed' | 'insufficient'
        walkForward: 'passed' | 'failed' | 'insufficient'
        parameterSensitivity: 'passed' | 'failed' | 'insufficient'
        groupStability: 'passed' | 'failed' | 'insufficient'
        allPassed: boolean
      }
      failedChecks: string[]
      blockerTags: string[]
      actionClass: string
      nextAction: string
    }>
    closurePlan: string[]
  }
  validationCandidateDisposition?: {
    schemaVersion: 'fams.screener.validation_candidate_disposition.v1'
    status: 'ready_for_manual_review' | 'research_only' | 'blocked'
    decision: 'READY_FOR_MANUAL_REVIEW' | 'CONTINUE_RESEARCH_ONLY'
    summary: {
      totalCandidates: number
      eligibleManualReview: number
      regimeLimitedCandidates: number
      observeOnly: number
      retiredCandidates: number
      needsMoreSamples: number
    }
    candidates: Array<{
      candidateId: string
      strategyId: string
      name: string
      finalDisposition: string
      allowedActions: string[]
      prohibitedActions: string[]
      failedChecks: string[]
      blockerTags: string[]
      rationale: string
      nextAction: string
    }>
  }
  strategyTournament?: {
    batchId?: string
    persistenceStatus?: 'persisted' | 'failed'
    evaluationDays: number
    holdingDays: number
    generatedAt: string
    benchmark?: {
      samples: number
      averageReturnPercent: number | null
      winRatePercent: number | null
    }
    ranked: Array<{
      strategyId: string
      name: string
      description: string
      signals: number
      wins: number
      losses: number
      winRatePercent: number | null
      averageReturnPercent: number | null
      bestReturnPercent: number | null
      worstReturnPercent: number | null
      benchmarkAverageReturnPercent?: number | null
      excessReturnPercent?: number | null
      sampleSize?: number
      tradeCount?: number
      medianReturnPercent?: number | null
      profitFactor?: number | null
      maxDrawdownPercent?: number | null
      sharpe?: number | null
      sortino?: number | null
      calmar?: number | null
      turnoverPercent?: number | null
      tailLossP95Percent?: number | null
      tailLossP99Percent?: number | null
      equityCurve?: Array<{ index: number; value: number; drawdownPercent: number }>
      evaluatedStocks: number
      latestMatchedCount: number
      credibility?: {
        rating: 'high' | 'medium' | 'low' | 'insufficient'
        score: number
        minSignals: number
        sampleAdequacyPercent: number
        winRateConfidenceInterval?: { low: number; high: number }
        reasons: string[]
      }
      latestCandidates: Array<{ symbol: string; name: string; score: number; reason: string }>
      persistedBacktestId?: string
      persistedResultId?: string
      samples: Array<{
        symbol: string
        name: string
        signalDate?: string
        entryDate?: string
        exitDate?: string
        entryPrice: number
        exitPrice: number
        grossReturnPercent?: number
        returnPercent: number
        win: boolean
        score: number
        blockedReason?: string
        costPercent?: number
      }>
      blockedSamples?: Array<{
        symbol: string
        name: string
        signalDate?: string
        entryDate?: string
        exitDate?: string
        entryPrice: number
        exitPrice: number
        grossReturnPercent?: number
        returnPercent: number
        win: boolean
        score: number
        blockedReason?: string
        costPercent?: number
      }>
      auditHash?: string
      outOfSampleValidation?: {
        schemaVersion: string
        method: string
        status: 'passed' | 'failed' | 'insufficient'
        train: {
          sampleSize: number
          winRatePercent: number | null
          averageReturnPercent: number | null
          benchmarkAverageReturnPercent: number | null
          excessReturnPercent: number | null
        }
        outOfSample: {
          sampleSize: number
          winRatePercent: number | null
          averageReturnPercent: number | null
          benchmarkAverageReturnPercent: number | null
          excessReturnPercent: number | null
        }
        warnings: string[]
      }
      walkForwardValidation?: {
        schemaVersion: string
        method: string
        status: 'passed' | 'failed' | 'insufficient'
        passedWindows: number
        totalWindows: number
        windows: Array<{
          windowIndex: number
          startSignalDate?: string
          endSignalDate?: string
          status: 'passed' | 'failed' | 'insufficient'
          summary: {
            sampleSize: number
            winRatePercent: number | null
            averageReturnPercent: number | null
            benchmarkAverageReturnPercent: number | null
            excessReturnPercent: number | null
          }
        }>
        warnings: string[]
      }
      parameterSensitivity?: {
        schemaVersion: string
        method: string
        status: 'passed' | 'failed' | 'insufficient'
        stableVariantCount: number
        totalVariants: number
        baseThresholds: Record<string, number>
        variants: Array<{
          variantId: string
          thresholds: Record<string, number>
          sampleSize: number
          tradeCount: number
          winRatePercent: number | null
          averageReturnPercent: number | null
          excessReturnPercent: number | null
          maxDrawdownPercent: number | null
          status: 'passed' | 'failed' | 'insufficient'
        }>
        warnings: string[]
      }
      versionBundle?: {
        schemaVersion: string
        signalStrategy?: { id: string; version: string; thresholdHash?: string }
        entryPolicy?: { id: string; version: string }
        exitPolicy?: { id: string; version: string; holdingDays?: number }
        positionSizingPolicy?: { id: string; version: string; notional?: number }
        portfolioPolicy?: { id: string; version: string; maxConcurrentPositions?: number }
        costModel?: Record<string, unknown>
        marketConstraint?: Record<string, unknown>
        engine?: { version: string }
      }
    }>
    notes: string[]
  }
  excludedUniverse?: Array<{
    symbol: string
    name: string
    localType: string
    resolvedType: string
    market: string
    confidenceScore: number
    reason: string
  }>
  failures: Array<{ symbol: string; name: string; error: string }>
  rules: Record<string, string>
  disclaimer?: string
}

export interface DividendLowVolCandidatePool {
  schemaVersion: 'dividend.low_vol.candidate_pool.v1'
  generatedAt: string
  strategyFamily: 'dividend_low_volatility'
  strategyId: 'dividend_low_vol_v1' | 'dividend_low_vol_leader_v1'
  total: number
  eligibleResearchCandidates: number
  alertSummary?: {
    lowZoneCount: number
    buildPlanCount: number
    highZoneCount: number
    sellAlertCount: number
    buildPlanSymbols: string[]
    sellAlertSymbols: string[]
  }
  leaderAuditSummary?: {
    schemaVersion: string
    total: number
    leaderPassed: number
    verifiedResearchCount?: number
    leaderCandidateCount?: number
    leaderPartialCount?: number
    notLeaderCount?: number
    insufficientCount?: number
    byStatus?: Record<string, number>
    canonicalIdentityCoveragePercent: number
    leaderEvidenceCoveragePercent: number
    freeSourceRankEvidenceCoveragePercent?: number
    seedFallbackCount: number
    missingRevenueNetProfitRankCount: number
    status: string
    auditNote: string
  }
  metricCompletenessSummary?: {
    schemaVersion: string
    total: number
    completeDisplayReadyCount: number
    incompleteDisplayCount: number
    completenessPercent: number
    topMissingMetrics: Array<{ metric: string; count: number }>
    note: string
  }
  dataTrustSummary?: {
    schemaVersion: string
    total: number
    averageConfidencePercent?: number
    byGrade: Record<string, number>
    highTrustCount: number
    insufficientCount: number
    topBlockers: Array<{ id: string; count: number }>
    topWarnings: Array<{ id: string; count: number }>
    note: string
  }
  calculationAuditSummary?: {
    schemaVersion: string
    total: number
    byReplayStatus: Record<string, number>
    replayPassedCount: number
    replayInsufficientCount: number
    replayFailedCount: number
    topMissingInputFields: Array<{ field: string; count: number }>
    formulaVersion: string
    note: string
  }
  rejectionSummary?: {
    rejectedCount: number
    dataIssueCount: number
    hardRuleCount: number
    byCategory: Array<{ category: string; count: number }>
    byReason: Array<{ reason: string; label: string; category: string; count: number }>
    topReasons: Array<{ reason: string; label: string; category: string; count: number }>
    note: string
  }
  universeSummary?: {
    schemaVersion: string
    universeSource: string
    universeTotal: number
    prefilteredCount: number
    selectedCount: number
    generatedAt: string
    rules: string[]
  }
  policy: {
    allowedActions: string[]
    prohibitedActions: string[]
  }
  candidates: Array<{
    identity: {
      symbol: string
      name: string
      industry?: string
    }
    dividend: {
      ttmDividendYield?: number
      avgDividendYield3y?: number
      dividendYieldPercentile3y?: number
      consecutiveDividendYears: number
      payoutRatio?: number
      dpsGrowth3y?: number
      specialDividendFlag?: boolean
      dividendCutFlag?: boolean
      dpsConsecutiveDecline?: boolean
      dividendTrapFlag?: boolean
      dividendRiskFlags?: string[]
    }
    scores: {
      dividendScore: number
      leaderScore?: number
      dividendQualityScore: number
      lowVolScore: number
      valuationScore: number
      timingScore?: number
      totalResearchScore?: number
      financialRiskScore?: number
      evidenceQualityScore?: number
      evidenceAdjustedScore: number
    }
    timing: {
      lowZoneScore: number
      highZoneScore: number
      price?: number
      ma20?: number
      ma60?: number
      ma120?: number
      ma250?: number
      rsi14?: number
      drawdownFrom250dHigh?: number
    }
    positionContext?: {
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
    lowVolatility?: {
      volatility60d?: number
      volatility120d?: number
      volatility250d?: number
      maxDrawdown60d?: number
      maxDrawdown250d?: number
      lowVolScore: number
    }
    valuation?: {
      pe?: number
      pb?: number
      dividendYieldHistoricalPercentile?: number
      valuationScore: number
    }
    quality?: {
      roe?: number
      debtToAsset?: number
      operatingCashFlowToNetProfit?: number
      financialRiskFlags: string[]
    }
    leaderEvidence?: {
      status: 'verified_industry_leader' | 'leader_candidate' | 'leader_partial' | 'not_leader' | 'insufficient'
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
    dataVerification?: {
      status: 'cross_checked' | 'single_source' | 'provider_fallback' | 'insufficient'
      providerCount: number
      crossCheckedFields: string[]
      warningCount: number
      warnings: string[]
      sourceRefs: string[]
    }
    metricCompleteness?: {
      status: 'complete' | 'incomplete'
      displayReady: boolean
      requiredMetrics: string[]
      missingMetrics: string[]
      completeMetricCount: number
      totalMetricCount: number
      note: string
    }
    dataTrust?: {
      schemaVersion: string
      grade: 'A' | 'B' | 'C' | 'D' | 'INSUFFICIENT'
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
    calculationAudit?: {
      schemaVersion: string
      formulaVersion: string
      replayStatus: 'passed' | 'failed' | 'insufficient'
      inputFieldCount: number
      missingInputFields: string[]
      formulaRefs: string[]
      mismatchCount: number
      generatedAt: string
      note: string
    }
    disposition: string
    candidateGrade?: 'A' | 'B' | 'WATCH' | 'EXCLUDED'
    alerts: Array<{
      type: string
      severity: 'info' | 'warning' | 'danger'
      triggerReason: string
    }>
    blockedReasons: string[]
    dataGapSummary: Array<{ blockedReason: string; userMessage: string; severity: string }>
    tradingDiscipline: {
      prohibitedActions: string[]
      planDraftAllowed: boolean
      formalTradeActionAllowed: boolean
      autoTradeAllowed: boolean
    }
  }>
  source?: {
    persisted?: boolean
    tradeDate?: string
  }
}

export interface DividendLowVolAlertCheckResult {
  schemaVersion: 'dividend.low_vol.alert_check.v1'
  generatedAt: string
  totalCandidates: number
  totalAlerts: number
  alerts: Array<{
    symbol: string
    name: string
    alertType: string
    severity: 'info' | 'warning' | 'danger'
    message: string
    prohibitedActions: string[]
  }>
  policy: {
    allowedActions: string[]
    prohibitedActions: string[]
  }
}

export interface DividendLowVolPersistedAlerts {
  schemaVersion: 'dividend.low_vol.persisted_alerts.v1'
  generatedAt: string
  tradeDate: string | null
  totalAlerts: number
  alerts: Array<{
    symbol: string
    name: string
    alertType: string
    severity: 'info' | 'warning' | 'danger'
    triggerDate: string
    triggerPrice?: number | null
    message: string
    invalidationConditions: string[]
    evidenceRefs: string[]
    status: string
    prohibitedActions: string[]
  }>
  policy: {
    allowedActions: string[]
    prohibitedActions: string[]
  }
}

export interface DividendLowVolCandidateHistory {
  schemaVersion: 'dividend.low_vol.candidate_history.v1'
  generatedAt: string
  symbol: string
  total: number
  history: Array<{
    tradeDate: string
    ttmDividendYield?: number | null
    dividendScore: number
    dividendQualityScore: number
    lowVolScore: number
    valuationScore: number
    lowZoneScore: number
    highZoneScore: number
    evidenceAdjustedScore: number
    disposition: string
    blockedReasons: string[]
    alerts: unknown[]
    sourceOperationId?: string | null
  }>
}

export interface DividendLowVolAuditPackageRef {
  schemaVersion: 'dividend.low_vol.gpt_audit_package_ref.v1'
  generatedAt: string
  path: string
  fileName: string
  candidateCount: number
  eligibleResearchCandidates: number
  rejectionSummary?: DividendLowVolCandidatePool['rejectionSummary']
  policy: {
    allowedActions: string[]
    prohibitedActions: string[]
  }
}

export interface DividendLowVolBacktestResult {
  schemaVersion: 'dividend.low_vol.backtest_result.v1'
  generatedAt: string
  status: 'completed' | 'insufficient'
  reason?: string
  sample: {
    inputCount: number
    candidateCount: number
    researchEligibleCount: number
    effectivePathCount: number
    tradingDays: number
  }
  metrics?: {
    totalReturnPercent: number
    annualizedReturnPercent: number
    maxDrawdownPercent: number
    dividendContributionPercent: number
    estimatedCostDragPercent?: number
    benchmarkReturnPercent: number
    excessReturnPercent: number
    calmar: number | null
  }
  validationEvidence: {
    status: string
    outOfSample: string
    walkForward: string
    parameterSensitivity: string
    groupStability: string
    reason: string
    diagnostics?: Record<string, number | string | null>
  }
  policy: {
    allowedActions: string[]
    prohibitedActions: string[]
  }
  benchmark?: {
    primary: string
    fallback: string
    status: string
    note: string
  }
  tradeConstraintAudit?: Record<string, unknown>
  rebalanceEvents?: Array<Record<string, unknown>>
}

export interface DividendLowVolTradingZoneResult {
  schemaVersion: 'dividend.low_vol.trading_zone.v1'
  generatedAt: string
  totalCandidates: number
  zones: Array<{
    symbol: string
    name: string
    industry?: string
    price?: number
    candidateGrade?: 'A' | 'B' | 'WATCH' | 'EXCLUDED'
    disposition: string
    evidenceAdjustedScore: number
    priceAudit?: {
      currentPrice?: number
      tradeDate?: string
      sourceType: 'canonical_bar' | 'raw_bar' | 'free_provider_history' | 'market_history' | 'fallback_seed' | 'unknown'
      sourceRefs: string[]
      freshnessStatus: 'fresh' | 'stale' | 'unknown'
      sanityStatus: 'aligned' | 'price_zone_mismatch' | 'insufficient'
      priceToAnchorRatio?: number
      warnings: string[]
    }
    prohibitedActions: string[]
    notTradingAdvice: boolean
    strategies: Array<{
      strategyId: 'dividend_low_vol_bollinger_reversion_v1' | 'dividend_low_vol_yield_ma_reversion_v1'
      label: string
      status: 'available' | 'insufficient'
      currentSignal: 'buy_zone' | 'hold_zone' | 'sell_zone' | 'exit_risk' | 'insufficient'
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
      priceAudit?: {
        currentPrice?: number
        tradeDate?: string
        sourceType: 'canonical_bar' | 'raw_bar' | 'free_provider_history' | 'market_history' | 'fallback_seed' | 'unknown'
        sourceRefs: string[]
        freshnessStatus: 'fresh' | 'stale' | 'unknown'
        sanityStatus: 'aligned' | 'price_zone_mismatch' | 'insufficient'
        priceToAnchorRatio?: number
        warnings: string[]
      }
      invalidationConditions: string[]
      evidenceRefs: string[]
    }>
  }>
  policy: {
    allowedActions: string[]
    prohibitedActions: string[]
  }
  notTradingAdvice: boolean
}

export interface DividendLowVolRollingBacktestResult {
  schemaVersion: 'dividend.low_vol.rolling_backtest.v1'
  generatedAt: string
  status: 'completed' | 'insufficient'
  window: {
    requestedYears: number
    requestedTradingDays: number
    minRequiredTradingDays: number
    maxEffectiveTradingDays: number
  }
  strategyResults: Array<{
    strategyId: string
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
    bestStrategyId: string | null
    researchPassed: boolean
    reason: string
  }
  policy: {
    allowedActions: string[]
    prohibitedActions: string[]
  }
  notTradingAdvice: boolean
}

export interface DividendLowVolValidationRetestResult {
  schemaVersion: 'dividend.low_vol.validation_retest_artifact.v1'
  generatedAt: string
  status: string
  validationEvidenceMatrix: {
    schemaVersion: 'dividend.low_vol.validation_evidence_matrix.v1'
    status: string
    checks: Record<string, {
      status: string
      required: string
      diagnostics: Record<string, unknown>
    }>
  }
  validationDecision: {
    usableForTradingAdvice: boolean
    allowedActions: string[]
    prohibitedActions: string[]
    primaryBlocker: string
    note: string
  }
  artifactRef?: {
    path: string
    fileName: string
  }
}

export interface DividendLowVolValidationGapDiagnosticsResult {
  schemaVersion: 'dividend.low_vol.validation_gap_diagnostics.v1'
  generatedAt: string
  strategyId: string
  status: string
  summary: {
    totalGaps: number
    blockingGapCount: number
    warningGapCount: number
    freeSourceResearchReady: boolean
    freeSourceValidationAllowed: boolean
    formalBacktestReady: boolean
    backtestStatus: string
    totalReturnAuditStatus: string
    validationEvidenceStatus: string
  }
  gaps: Array<{
    id: string
    severity: 'blocker' | 'warning' | 'info'
    category: string
    status: string
    affectedGate: string
    userMessage: string
    developerAction: string
    formalValidationBlocked: boolean
  }>
  backtestSnapshot?: Record<string, unknown>
  dataReadinessSnapshot?: Record<string, unknown>
  allowedActions: string[]
  prohibitedActions: string[]
  notTradingAdvice: boolean
}

export interface DividendLowVolV2ResearchValidationResult {
  schemaVersion: string
  generatedAt: string
  strategyId: string
  status: string
  reason?: string
  latestPool?: {
    total?: number
    completeDisplayReadyCount?: number
    strictV1ResearchCandidates?: number
    strictV1EligibleSymbols?: string[]
  }
  v2ResearchCandidates?: number
  v2EligibleSymbols?: string[]
  candidates?: Array<{
    symbol: string
    name?: string
    industry?: string
    evidenceAdjustedScore?: number
    totalResearchScore?: number
    dividendYield?: number
    leaderScore?: number
    dividendQualityScore?: number
    lowVolScore?: number
    valuationScore?: number
    fatalReasons?: string[]
  }>
  backtest?: {
    sample?: {
      inputCount?: number
      candidateCount?: number
      researchEligibleCount?: number
      effectivePathCount?: number
      tradingDays?: number
    }
    metrics?: {
      totalReturnPercent?: number
      annualizedReturnPercent?: number
      maxDrawdownPercent?: number
      dividendContributionPercent?: number
      benchmarkReturnPercent?: number
      excessReturnPercent?: number
      estimatedCostDragPercent?: number
    }
    validationEvidence?: {
      status?: string
      outOfSample?: string
      walkForward?: string
      parameterSensitivity?: string
      groupStability?: string
      reason?: string
      diagnostics?: Record<string, unknown>
    }
    validationEvidenceMatrix?: {
      status?: string
      checks?: Record<string, {
        status: string
        required?: string
        diagnostics?: Record<string, unknown>
      }>
    }
    validationDecision?: {
      usableForTradingAdvice: boolean
      allowedActions: string[]
      prohibitedActions: string[]
      primaryBlocker?: string
      note?: string
    }
  }
  validationDecision: {
    usableForTradingAdvice: boolean
    allowedActions: string[]
    prohibitedActions: string[]
    primaryBlocker?: string
    note?: string
  }
  policy?: {
    allowedActions: string[]
    prohibitedActions: string[]
  }
  artifactRef?: {
    path: string
    fileName: string
  }
}

export interface DividendLowVolManualDraftReadinessResult {
  schemaVersion: string
  generatedAt: string
  status: string
  readyForManualTradeDraft: boolean
  formalTradeActionAllowed: boolean
  autoTradeAllowed: boolean
  decision?: string
  allowedActions: string[]
  prohibitedActions: string[]
  primaryBlocker?: string | null
  latestEvidence?: {
    operationId: string
    generatedAt: string
    acceptanceStatus: string
    scanCoveragePercent?: number | null
    providerSuccessRate?: number | null
    cacheHitRate?: number | null
    backtestDays?: number | null
    bestSampleSize?: number | null
    bestCredibility?: string | null
    topCandidates?: Array<{
      candidateId: string
      strategyId?: string
      sampleSize?: number
      tradeCount?: number
      credibility?: string
      excessReturnPercent?: number | null
      outOfSampleStatus?: string
      walkForwardStatus?: string
      parameterSensitivityStatus?: string
      groupStabilityStatus?: string
    }>
  } | null
  gates?: Array<{
    id: string
    label?: string
    status: string
    actual?: string | number | null
    required?: string | number
    severity?: string
    message?: string
  }>
  recommendations?: string[]
}

export interface DividendLowVolManualTradeDraftResult {
  schemaVersion: string
  draftId?: string
  generatedAt: string
  persistedAt?: string
  artifactRef?: {
    path: string
    fileName: string
  }
  status: string
  readyForManualTradeDraft: boolean
  formalTradeActionAllowed: boolean
  autoTradeAllowed: boolean
  allowedActions: string[]
  prohibitedActions: string[]
  summary: {
    requestedTopN: number
    draftActionCount: number
    holdingCount: number
    newReviewCount: number
    totalSuggestedDraftWeightPercent: number
    selectionSource?: string
    selectedSymbols?: string[]
    filterSnapshot?: Record<string, unknown>
  }
  actions: Array<{
    rank: number
    symbol: string
    name?: string
    industry?: string
    draftType: string
    disposition?: string
    candidateGrade?: string
    isHolding: boolean
    currentWeightPercent: number
    researchTargetWeightPercent: number
    formalTargetWeightPercent: 0
    suggestedDraftWeightPercent: number
    singleStockCapPercent: number
    metrics: {
      evidenceAdjustedScore?: number | null
      ttmDividendYield?: number | null
      avgDividendYield3y?: number | null
      leaderScore?: number | null
      dividendQualityScore?: number | null
      lowVolScore?: number | null
      valuationScore?: number | null
      lowZoneScore?: number | null
      highZoneScore?: number | null
    }
    validation: {
      readinessStatus: string
      sampleSize?: number | null
      credibility?: string | null
      prohibitedActions: string[]
    }
    rationale: string[]
    guardrails: string[]
    evidenceRefs: string[]
  }>
  userPath: string[]
  notTradingAdvice: boolean
}

export interface DividendLowVolManualTradeDraftReviewResult {
  schemaVersion: string
  reviewId?: string
  generatedAt?: string
  draftId: string
  decision?: 'approve_for_watchlist' | 'needs_more_data' | 'reject_draft'
  reason?: string
  selectedSymbols?: string[]
  formalTradeActionAllowed: false
  autoTradeAllowed: false
  allowedActions?: string[]
  prohibitedActions: string[]
  artifactRef?: {
    path: string
    fileName: string
  }
  watchlistArtifactRef?: {
    path: string
    fileName: string
  } | null
  status?: string
}

export interface DividendLowVolManualWatchlistResult {
  schemaVersion: string
  watchlistId?: string
  generatedAt?: string
  sourceReviewId?: string
  sourceDraftId?: string
  status: string
  entries: Array<{
    symbol: string
    name?: string
    industry?: string
    draftType?: string
    suggestedDraftWeightPercent?: number
    currentWeightPercent?: number
    researchTargetWeightPercent?: number
    formalTargetWeightPercent: 0
    metrics?: Record<string, number | null | undefined>
    rationale?: string[]
    guardrails?: string[]
    evidenceRefs?: string[]
  }>
  formalTradeActionAllowed: false
  autoTradeAllowed: false
  allowedActions?: string[]
  prohibitedActions: string[]
  notTradingAdvice: boolean
  artifactRef?: {
    path: string
    fileName: string
  }
}

export interface DividendLowVolManualPretradeCheckResult {
  schemaVersion: string
  checkId?: string
  generatedAt?: string
  sourceWatchlistId?: string | null
  status: string
  entries: Array<{
    symbol: string
    name?: string
    industry?: string
    draftType?: string
    suggestedDraftWeightPercent?: number
    formalTargetWeightPercent: 0
    executionReady: false
    checks: Array<{
      id: string
      status: 'passed' | 'blocked' | 'manual_review_required' | string
      message: string
    }>
    evidenceRefs?: string[]
  }>
  executionReady: false
  formalTradeActionAllowed: false
  autoTradeAllowed: false
  allowedActions?: string[]
  prohibitedActions: string[]
  requiredHumanReview?: string[]
  notTradingAdvice: boolean
  artifactRef?: {
    path: string
    fileName: string
  }
}

export interface DividendLowVolManualPretradeReviewResult {
  schemaVersion: string
  reviewId?: string
  generatedAt?: string
  sourceCheckId?: string | null
  sourceWatchlistId?: string | null
  reviewer?: string
  decision?: 'continue_observe' | 'needs_more_review' | 'reject_execution'
  reason?: string
  reviewedSymbols?: string[]
  executionReady: false
  formalTradeActionAllowed: false
  autoTradeAllowed: false
  allowedActions?: string[]
  prohibitedActions: string[]
  guardrails?: string[]
  notTradingAdvice: boolean
  artifactRef?: {
    path: string
    fileName: string
  }
  status?: string
}

export interface DividendLowVolManualWorkflowAuditResult {
  schemaVersion: string
  generatedAt: string
  status: 'complete_observation_workflow' | 'partial_workflow' | string
  stages: Array<{
    id: string
    label: string
    status: string
    generatedAt?: string | null
    artifactId?: string | null
    sourceDraftId?: string | null
    sourceReviewId?: string | null
    sourceWatchlistId?: string | null
    sourceCheckId?: string | null
    artifactRef?: {
      path: string
      fileName: string
    } | null
    formalTradeActionAllowed: false
    autoTradeAllowed: false
    prohibitedActions: string[]
  }>
  summary: {
    completedStages: number
    totalStages: number
    latestDecision?: string | null
    executionReady: false
    formalTradeActionAllowed: false
    autoTradeAllowed: false
    prohibitedActions: string[]
  }
  notTradingAdvice: boolean
}

export interface DividendLowVolManualAcceptanceReviewResult {
  schemaVersion: string
  generatedAt: string
  strategyId?: string
  status: string
  knownIncompleteItems?: string[]
  acceptanceChecklist: Array<{
    id: string
    status: string
    evidenceFile?: string
    requiredHumanCheck?: string
  }>
  remainingValidationGaps: Array<{
    id: string
    severity?: string
    category?: string
    status?: string
    affectedGate?: string
    userMessage?: string
    formalValidationBlocked?: boolean
  }>
  decisionBoundary: {
    researchReady: boolean
    freeSourceValidationAllowed: boolean
    manualTradeDraftReady: boolean
    formalTradingUnlocked: boolean
    autoTradeUnlocked: boolean
    prohibitedActions: string[]
  }
  safetyAssertions?: {
    acceptanceReviewDoesNotCreateOrder?: boolean
    formalTradeActionAllowed: boolean
    autoTradeAllowed: boolean
    prohibitedActions: string[]
  }
  artifactRef?: {
    path: string
    fileName: string
    packageDir?: string
  }
  notTradingAdvice: boolean
}

export interface DividendLowVolManualAcceptanceDecisionResult {
  schemaVersion: string
  decisionId?: string
  generatedAt?: string
  sourceAcceptanceStatus?: string
  reviewer?: string
  decision?: 'accept_for_manual_draft_review' | 'needs_more_review' | 'reject_acceptance'
  reason?: string
  decisionBoundary?: DividendLowVolManualAcceptanceReviewResult['decisionBoundary']
  safetyAssertions?: {
    manualAcceptanceDecisionDoesNotCreateOrder?: boolean
    formalTradeActionAllowed: boolean
    autoTradeAllowed: boolean
    prohibitedActions: string[]
  }
  allowedActions?: string[]
  prohibitedActions: string[]
  artifactRef?: {
    path: string
    fileName: string
  }
  status?: string
  notTradingAdvice: boolean
}

export interface DividendLowVolDataReadinessAudit {
  schemaVersion: 'dividend.low_vol.data_readiness_audit.v1'
  generatedAt: string
  status: 'ready_full_universe' | 'ready_free_source_validation' | 'ready_free_source_research' | 'research_scan_partial' | 'blocked'
  providerMode?: 'formal_provider' | 'free_source_research' | 'blocked'
  validationDataMode?: 'free_source_validation' | 'blocked'
  dataTrust?: {
    schemaVersion: string
    grade: 'A' | 'B' | 'C' | 'D' | 'INSUFFICIENT'
    confidencePercent: number
    providerMode: string
    coverageStatus: string
    freshnessStatus: string
    crossCheckStatus: string
    displayLabel: string
    blockers: string[]
    warnings: string[]
    note: string
  }
  allowedActions: string[]
  prohibitedActions: string[]
  canonicalQuoteList: {
    exists: boolean
    itemCount: number
    generatedAt: string | null
    updatedAt: string | null
    path: string
    parseError?: string
  }
  providerIngestion: {
    status: string
    totalFields: number
    available: number
    partial: number
    missing: number
    blocked: number
    tokenInAuditPackage: boolean
  }
  marketData: {
    marketBarRows: number
    marketBarSymbols: number
    latestMarketBarDate: string | null
    latestMarketBarAgeDays?: number | null
    marketFeatureRows: number
    marketFeatureSymbols: number
    latestFeatureDate: string | null
    latestFeatureAgeDays?: number | null
    scanCoveragePercent: number
    featureCoveragePercent: number
  }
  securityAndTradeability: {
    securityStatusRows: number
    securityStatusSymbols: number
    securityStatusCoveragePercent: number
    tradeabilityRows: number
    tradeabilitySymbols: number
    tradeabilityCoveragePercent: number
  }
  candidatePersistence: {
    persistedRows: number
    latestTradeDate: string | null
  }
  gates: {
    researchScanReady: boolean
    fullUniverseReady: boolean
    persistentFullAScanAllowed: boolean
    freeSourceValidationAllowed?: boolean
    formalValidationPromotionAllowed: boolean
    reason: string
  }
  blockers: string[]
  researchBlockers?: string[]
  formalBlockers?: string[]
  providerUpgradeBlockers?: string[]
  recoveryCommands: string[]
}

export interface HoldingResearchItem {
  positionId: string
  assetId: string
  symbol: string
  name: string
  type: string
  tags: string[]
  marketValue: number
  weightHint: string
  summary?: string
  keyEvidence?: string[]
  researchFactStatus?: {
    technical: 'available' | 'partial' | 'missing' | 'not_applicable'
    fundamental: 'available' | 'partial' | 'missing' | 'not_applicable'
    news: 'available' | 'partial' | 'missing' | 'not_applicable'
    valuation: 'available' | 'partial' | 'insufficient' | 'not_applicable'
  }
  researchCoverage?: {
    score: number
    label: 'research_ready' | 'partial' | 'data_insufficient'
    availableDimensions: number
    totalDimensions: number
    primaryGap?: string | null
    nextAction?: string | null
    dimensions: Array<{
      key: 'technical' | 'fundamental' | 'news' | 'valuation'
      label: string
      status: 'available' | 'partial' | 'missing' | 'insufficient' | 'not_applicable'
      evidenceCount: number
      blockerCount: number
    }>
  }
  researchEvidenceDetails?: {
    schemaVersion: 'holding.research.evidence_details.v1'
    technical: {
      source: string
      asOf: string | null
      support: number[]
      resistance: number[]
      fields: Array<{
        key: string
        label: string
        value: number | string | null
        unit: 'score' | 'percent' | 'number' | 'price'
      }>
      availableFieldCount: number
      missingFieldCount: number
      warnings: string[]
    }
    fundamental: {
      status: string
      facts: Array<{
        id: string
        label: string
        value: number | string | null
        source: string
        asOf: string | null
        quality: 'ok' | 'missing' | 'warning'
      }>
      availableFactCount: number
      missingFactCount: number
      warnings: string[]
    }
    valuation: {
      status: string
      conclusion: string
      confidence: string
      valuationBand: string
      method: string
      fields: Array<{
        key: string
        label: string
        value: number | string | null
        unit: 'score' | 'percent' | 'number' | 'price'
      }>
      reasons: string[]
      risks: string[]
      blockedReasons: string[]
    }
    news: {
      sentimentScore: number | null
      eventRiskScore: number | null
      eventCount: number
      events: Array<{
        title: string
        eventType: string
        impact: 'positive' | 'neutral' | 'negative' | 'unknown'
        publishedAt: string
        evidenceRef: string
      }>
    }
    fundLike?: {
      riskLevelProxy?: {
        status: string
        riskLevel: string
        score: number | null
        method: string
        warnings: string[]
      }
      durationProxy?: {
        status: string
        durationBucket: string
        estimatedDurationYears: number | null
        confidence: string
        method: string
        warnings: string[]
      }
      navHistory?: {
        sampleSize: number
        firstDate: string | null
        latestDate: string | null
        source: string
      }
      bondRiskProxy?: {
        status: string
        bondPct: number | null
        topBondConcentrationPct: number | null
        creditRiskFlags: string[]
      }
    }
  }
  fundamental: {
    quality: string
    valuation: string
    risk: string
    details?: string[]
    warnings?: string[]
  }
  technical: {
    trend: string
    currentPrice: number
    avgCost: number
    support?: number
    resistance?: number
    stopReference?: number
    takeProfitReference?: number
    stopReturnPercent?: number | null
    takeProfitReturnPercent?: number | null
    pnlPercent: number
    details?: string[]
    warnings?: string[]
  }
  news: {
    sentiment: string
    watchItems: string[]
    events?: Array<{
      title: string
      eventType: string
      impact: 'positive' | 'neutral' | 'negative' | 'unknown'
      publishedAt: string
      evidenceRef: string
    }>
  }
  valueAssessment?: {
    schemaVersion: 'value.assessment.factset.v1'
    generatedAt: string
    asset: {
      assetId: string
      symbol: string
      name: string
      assetType: string
      market: string
    }
    market: {
      currentPrice: number
      marketValue?: number
      costBasis?: number
      unrealizedPnlPct?: number
      provider: string
      asOf: string | null
    }
    valuation: {
      status: 'available' | 'partial' | 'insufficient' | 'not_applicable'
      conclusion: 'undervalued_watch' | 'reasonable' | 'overvalued_watch' | 'risk_review' | 'insufficient' | 'not_applicable'
      valuationScore: number | null
      qualityScore: number | null
      growthScore: number | null
      financialRiskScore: number | null
      compositeScore: number | null
      confidence: 'high' | 'medium' | 'low' | 'insufficient'
      targetWeightMultiplier: number
      valuationBand: 'cheap' | 'fair' | 'expensive' | 'unknown'
      method: string
      reasons: string[]
      risks: string[]
      blockedReasons: string[]
      warnings: string[]
    }
    facts: Array<{
      id: string
      label: string
      value: number | string | null
      source: string
      asOf: string | null
      quality: 'ok' | 'missing' | 'warning'
    }>
    evidenceRefs: string[]
    providerTrace: Record<string, unknown>
  }
  positionAdvice?: {
    schemaVersion: 'position.advice.factset.v1'
    generatedAt: string
    action: 'ADD' | 'REDUCE' | 'HOLD' | 'OBSERVE' | 'NO_ACTION'
    confidence: 'high' | 'medium' | 'low' | 'insufficient'
    currentWeight: number
    currentWeightPct: number
    targetWeightRange: [number, number]
    suggestedTradeRatio?: number
    reasons: string[]
    risks: string[]
    triggerConditions: string[]
    invalidationConditions: string[]
    blockedReasons: string[]
    evidenceRefs: string[]
    scores: {
      trend: number
      momentum: number
      relativeStrength: number
      volatility: number
      liquidity: number
    }
    explanation?: {
      formula: {
        expression: string
        baseTargetWeight: number
        marketRegimeMultiplier: number
        signalMultiplier: number
        riskPenaltyMultiplier: number
        fivdRCombinedMultiplier?: number
        confidenceMultiplier: number
        finalTargetWeight: number
        currentWeight: number
        delta: number
      }
      actionTriggers: string[]
      riskPenaltyReasons: string[]
      scoreDetails: string[]
      evidenceGaps: string[]
    }
    market: {
      price: number
      priceTime: string | null
      provider: string
      confidence: number
      fallbackUsed: boolean
      warnings: string[]
    }
    fivdRImpact?: {
      schemaVersion: string
      generatedAt: string
      runRef: string
      valuationMultiplier: number
      riskPenaltyMultiplier: number
      evidenceConfidenceMultiplier: number
      validationGateMultiplier: number
      combinedMultiplier: number
      valuationStatus: string
      valuationConfidence: string
      validationUsableForTradingAdvice: boolean
      blockedReasons: string[]
      evidenceRefs: string[]
    } | null
    strategyEvidenceCount: number
    cache?: {
      status: 'fresh' | 'stale' | 'generating' | 'failed' | 'partial'
      refreshed: boolean
      generatedAt: string
      staleAt: string
      nextRefreshAfter: string
      warnings: string[]
    } | null
  } | null
  dataGapSummary?: DataGap[]
  dataGapSummaryMeta?: DataGapSummaryMeta
}

export type FivdRCapabilityState =
  | 'RESEARCH_READY'
  | 'OBSERVE_ONLY'
  | 'DATA_INSUFFICIENT'
  | 'TRADE_BLOCKED'
  | 'SYSTEM_UNAVAILABLE'

export interface DataGap {
  gapId: string
  assetId?: string
  symbol?: string
  assetName?: string
  assetType: 'stock' | 'etf' | 'fund' | 'bond_fund' | 'gold' | 'cash' | 'unknown'
  severity: 'blocking' | 'degrading' | 'optional'
  category:
    | 'asset_identity'
    | 'market_data'
    | 'valuation'
    | 'fundamental'
    | 'financial_report'
    | 'fund_factset'
    | 'gold_macro'
    | 'validation_evidence'
    | 'tradeability'
    | 'news_event'
    | 'provider_health'
  blockedReason: string
  missingFields: string[]
  requiredFor: Array<'research' | 'observe' | 'manual_trade_draft' | 'formal_trade_action'>
  userMessage: string
  developerMessage: string
  suggestedAction: string
  providerCandidates: string[]
  lastAttemptAt?: string
  lastError?: string
  evidenceRefs: string[]
}

export interface DataGapSummaryMeta {
  total: number
  blocking: number
  degrading: number
  optional: number
  byCategory: Record<string, number>
  requiredFor: Record<string, number>
}

export interface FivdRCandidateBatchResult {
  schemaVersion: 'fivd.r.candidate_batch.v1'
  runId: string
  generatedAt: string
  userId: string
  source: string
  strategyQuery?: string
  summary: {
    total: number
    analyzed: number
    observable: number
    manualReviewEligible: number
    retired: number
    blocked: number
    dataGaps?: DataGapSummaryMeta
  }
  candidates: Array<{
    symbol: string
    name: string
    totalScore: number
    signalScore?: number
    researchScore?: number
    evidenceAdjustedScore?: number
    rank: number
    disposition: 'manual_review_eligible' | 'watch_candidate' | 'observe_only' | 'needs_more_evidence' | 'avoid' | 'retire_candidate' | 'trade_blocked' | 'blocked'
    capabilityState?: FivdRCapabilityState
    researchAvailable?: boolean
    observeAllowed?: boolean
    formalTradeActionAllowed?: boolean
    manualTradeDraftAllowed?: boolean
    autoTradeAllowed?: boolean
    allowedActions: string[]
    prohibitedActions: string[]
    dimensions: {
      strategy?: number
      strategyValidation: number
      valuation: number
      expectedReturn: number
      risk: number
      evidenceQuality: number
      marketState: number
      portfolioFit?: number
    }
    blockers: string[]
    dataGapSummary?: DataGap[]
    rationale: string[]
    evidenceRefs: string[]
  }>
}

export interface FivdRAnalysisResult {
  schemaVersion: 'fivd.r.analysis.result.v1'
  runId: string
  generatedAt: string
  userId: string
  scope: 'portfolio' | 'position' | 'candidate'
  modelVersion: string
  dataVersion: string
  orchestrationMode: 'internal_deterministic'
  asset?: {
    assetId: string
    positionId: string
    symbol: string
    name: string
    assetType: string
  }
  summary: {
    status: 'available' | 'partial' | 'insufficient' | 'blocked'
    conclusion: string
    allowedActions: string[]
    prohibitedActions: string[]
    blockedReasons: string[]
  }
  capabilityState?: FivdRCapabilityState
  researchAvailable?: boolean
  observeAllowed?: boolean
  formalTradeActionAllowed?: boolean
  manualTradeDraftAllowed?: boolean
  autoTradeAllowed?: boolean
  dataGapSummary?: DataGap[]
  dataGapSummaryMeta?: DataGapSummaryMeta
  evidenceGate: {
    status: 'pass' | 'partial' | 'blocked'
    evidenceQualityScore: number
    missingData: string[]
    conflictFlags: string[]
    blockedReasons: string[]
    evidenceRefs: string[]
  }
  portfolio?: {
    holdingsCount: number
    holdings: HoldingResearchItem[]
  }
  valuation?: HoldingResearchItem['valueAssessment']
  expectedReturn?: Record<string, unknown>
  tradingDiscipline?: Record<string, unknown>
  strategyValidation?: Record<string, unknown> | null
  candidateDisposition?: StockScreenerResult['validationCandidateDisposition'] | null
  positionAdviceImpact?: Record<string, unknown>
  agentTrace: {
    schemaVersion: 'fivd.r.agent_trace.v1'
    runId: string
    generatedAt: string
    scope: 'portfolio' | 'position' | 'candidate'
    orchestrationMode: 'internal_deterministic'
    status: 'completed' | 'partial' | 'blocked'
    blockedReasons: string[]
    evidenceRefs: string[]
    agents: Array<{
      id: string
      sequence: number
      status: 'completed' | 'blocked' | 'insufficient' | 'skipped'
      inputRefs: string[]
      evidenceRefs: string[]
      blockedReasons: string[]
      producedArtifacts: string[]
      output: string
    }>
  }
  explanation: string
}

export interface FivdRValidationFailureTaxonomy {
  schemaVersion: 'fivd.r.validation_failure_taxonomy.v1'
  generatedAt: string
  runId: string
  sourceOperationId?: string | null
  sourceOperationType?: string | null
  status: 'blocked_for_trading' | 'needs_more_samples' | 'ready_for_manual_review'
  summary: {
    passedCandidates: number
    failedCandidates: number
    insufficientCandidates: number
    diagnosedCandidates: number
    tradeActionAllowed: false
    manualTradeDraftAllowed: false
    autoTradeAllowed: false
    blocker?: string | null
    oosWindows?: number
    failedWindows?: number
    insufficientWindows?: number
    regimeBuckets?: number
    insufficientRegimeBuckets?: number
  }
  failureCategories: Array<{
    category: string
    severity: 'critical' | 'major' | 'minor'
    affectedStrategies: string[]
    affectedCandidates: string[]
    evidenceRefs: string[]
    explanation: string
    nextAction: string
  }>
  recommendation: 'keep_research_only' | 'narrow_strategy_scope' | 'retest_with_longer_window' | 'retire_strategy' | 'requires_new_strategy_family'
  prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
  allowedActions: string[]
  evidenceRefs: string[]
  nextActions: string[]
  auditOpinion?: {
    severity: string
    conclusion: string
  }
  operationId?: string
  artifactRefs?: string[]
}

export interface FivdRDataGapRemediationPlan {
  schemaVersion: 'fivd.r.data_gap_remediation_plan.v1'
  generatedAt: string
  sourceRunId?: string | null
  summary: {
    totalGaps: number
    executableActions: number
    plannedActions: number
    unsupportedActions: number
    blockedByValidationActions: number
  }
  actions: Array<{
    actionId: string
    status: 'executable' | 'planned' | 'unsupported' | 'blocked_by_validation'
    category: string
    gapIds: string[]
    symbols: string[]
    operationType?: 'batch_factset_refresh' | 'fivd_r_validation_retest_audit' | 'fivd_r_asset_identity_resolution' | 'market_bar_cache_preheat'
    operationInput?: Record<string, unknown>
    userMessage: string
    developerMessage: string
    expectedArtifacts: string[]
    limitations: string[]
  }>
  auditOpinion: {
    severity: 'minor' | 'major'
    conclusion: string
  }
}

export interface FivdRDataGapRemediationExecution {
  schemaVersion: 'fivd.r.data_gap_remediation_execution.v1'
  generatedAt: string
  userId: string
  plan: FivdRDataGapRemediationPlan
  startedOperations: Array<{
    actionId: string
    operationId: string
    operationType: string
    status: string
  }>
  skippedActions: Array<{
    actionId: string
    status: string
    reason: string
  }>
  auditOpinion: {
    severity: 'minor' | 'major'
    conclusion: string
  }
}

export interface FivdRResearchSnapshotList {
  schemaVersion: 'fivd.r.research_snapshot_list.v1'
  userId: string
  snapshots: Array<{
    operationId: string
    createdAt: string
    runId?: string
    scope?: string
    asset?: {
      symbol?: string
      name?: string
      assetType?: string
    } | null
    summary?: {
      status?: string
      conclusion?: string
      blockedReasons?: string[]
      prohibitedActions?: string[]
    } | null
    artifactRefs: string[]
  }>
}

export interface FivdRWatchList {
  schemaVersion: 'fivd.r.watch_list.v1'
  userId: string
  decision: string
  count: number
  reviews: Array<{
    id: string
    runId: string
    positionId?: string | null
    symbol?: string | null
    decision: string
    reason: string
    reviewer: string
    modelResultRef: string
    evidenceRefs: string[]
    override: Record<string, unknown>
    previousHash?: string | null
    recordHash: string
    createdAt: string
  }>
  allowedActions: string[]
  prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
}

// 获取每日建议
export async function getDailySuggestions(): Promise<DailySuggestion> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/investment-suggestions?userId=default`)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  const data = await response.json()
  return {
    date: data.date || new Date().toISOString().split('T')[0],
    adviceId: data.adviceId,
    query: data.query,
    scope: data.scope,
    matchedPositions: data.matchedPositions,
    suggestions: data.suggestions || [],
    structuredAdvice: data.structuredAdvice,
    marketDataTrace: data.marketDataTrace,
    dataReliability: data.dataReliability,
    riskLevel: data.riskLevel || 'medium',
    overallScore: data.overallScore || 0,
    marketOutlook: data.marketOutlook || '',
    disclaimer: data.disclaimer,
  }
}

export async function searchInvestmentSuggestions(query: string, scope: AnalysisScope): Promise<DailySuggestion> {
  const params = new URLSearchParams({
    userId: 'default',
    query,
    scope,
  })
  const response = await fetch(`${API_BASE}/api/v1/analysis/investment-suggestions/search?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  const data = await response.json()
  return {
    date: data.date || new Date().toISOString().split('T')[0],
    adviceId: data.adviceId,
    query: data.query,
    scope: data.scope,
    matchedPositions: data.matchedPositions,
    suggestions: data.suggestions || [],
    structuredAdvice: data.structuredAdvice,
    marketDataTrace: data.marketDataTrace,
    dataReliability: data.dataReliability,
    riskLevel: data.riskLevel || 'medium',
    overallScore: data.overallScore || 0,
    marketOutlook: data.marketOutlook || '',
    disclaimer: data.disclaimer,
  }
}

export async function analyzeTarget(input: string, scope: AnalysisScope): Promise<TargetResearchResult> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/target-research`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', input, scope }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getHoldingsResearch(): Promise<HoldingResearchItem[]> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/holdings-research?userId=default`)
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function screenStocks(query: string): Promise<StockScreenerResult> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/stock-screener`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', query }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolCandidates(symbols = '600000,000001,601398', limit = 6, options: { scope?: 'all'; persistedOnly?: boolean } = {}): Promise<DividendLowVolCandidatePool> {
  const params = new URLSearchParams()
  if (options.scope === 'all') params.set('scope', 'all')
  else params.set('symbols', symbols)
  params.set('limit', String(limit))
  if (options.persistedOnly) params.set('persistedOnly', 'true')
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/candidates?${params.toString()}`)
  if (!response.ok) {
    throw new Error('Failed to load dividend low volatility candidates')
  }
  return response.json()
}

export async function getDividendLowVolDataReadiness(): Promise<DividendLowVolDataReadinessAudit> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/data-readiness`)
  if (!response.ok) {
    throw new Error(`Dividend low vol data readiness failed: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolV2ResearchValidation(): Promise<DividendLowVolV2ResearchValidationResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/v2/research-validation`)
  if (!response.ok) {
    throw new Error(`Dividend low vol V2 research validation failed: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolManualDraftReadiness(): Promise<DividendLowVolManualDraftReadinessResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-draft-readiness`)
  if (!response.ok) {
    throw new Error(`Dividend low vol manual draft readiness failed: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolManualTradeDraft(topN = 3): Promise<DividendLowVolManualTradeDraftResult> {
  const params = new URLSearchParams()
  params.set('topN', String(topN))
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-trade-draft?${params.toString()}`)
  if (!response.ok) {
    throw new Error(`Dividend low vol manual trade draft failed: ${response.status}`)
  }
  return response.json()
}

export async function createDividendLowVolManualTradeDraft(topN = 3, options: { selectedSymbols?: string[]; selectionSource?: string; filterSnapshot?: Record<string, unknown> } = {}): Promise<DividendLowVolManualTradeDraftResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-trade-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', topN, requestedBy: 'user', ...options }),
  })
  if (!response.ok) {
    throw new Error(`Dividend low vol manual trade draft create failed: ${response.status}`)
  }
  return response.json()
}

export async function reviewDividendLowVolManualTradeDraft(input: {
  draftId: string
  decision: 'approve_for_watchlist' | 'needs_more_data' | 'reject_draft'
  reason?: string
  selectedSymbols?: string[]
}): Promise<DividendLowVolManualTradeDraftReviewResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-trade-draft/${encodeURIComponent(input.draftId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewer: 'user',
      decision: input.decision,
      reason: input.reason,
      selectedSymbols: input.selectedSymbols,
    }),
  })
  if (!response.ok) {
    throw new Error(`Dividend low vol manual trade draft review failed: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolManualWatchlist(): Promise<DividendLowVolManualWatchlistResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-watchlist`)
  if (!response.ok) {
    throw new Error(`Dividend low vol manual watchlist failed: ${response.status}`)
  }
  return response.json()
}

export async function createDividendLowVolManualPretradeCheck(): Promise<DividendLowVolManualPretradeCheckResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-watchlist/pretrade-check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestedBy: 'user' }),
  })
  if (!response.ok) {
    throw new Error(`Dividend low vol manual pretrade check failed: ${response.status}`)
  }
  return response.json()
}

export async function reviewDividendLowVolManualPretradeCheck(input: {
  decision: 'continue_observe' | 'needs_more_review' | 'reject_execution'
  reason?: string
}): Promise<DividendLowVolManualPretradeReviewResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-watchlist/pretrade-check/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewer: 'user',
      decision: input.decision,
      reason: input.reason,
    }),
  })
  if (!response.ok) {
    throw new Error(`Dividend low vol manual pretrade review failed: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolManualWorkflowAudit(): Promise<DividendLowVolManualWorkflowAuditResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-workflow-audit`)
  if (!response.ok) {
    throw new Error(`Dividend low vol manual workflow audit failed: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolManualAcceptanceReview(): Promise<DividendLowVolManualAcceptanceReviewResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-acceptance-review`)
  if (!response.ok) {
    throw new Error(`Dividend low vol manual acceptance review failed: ${response.status}`)
  }
  return response.json()
}

export async function decideDividendLowVolManualAcceptance(input: {
  decision: 'accept_for_manual_draft_review' | 'needs_more_review' | 'reject_acceptance'
  reason?: string
}): Promise<DividendLowVolManualAcceptanceDecisionResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-acceptance-review/decision`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      reviewer: 'user',
      decision: input.decision,
      reason: input.reason,
    }),
  })
  if (!response.ok) {
    throw new Error(`Dividend low vol manual acceptance decision failed: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolManualAcceptanceDecision(): Promise<DividendLowVolManualAcceptanceDecisionResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/manual-acceptance-decision`)
  if (!response.ok) {
    throw new Error(`Dividend low vol manual acceptance decision failed: ${response.status}`)
  }
  return response.json()
}

export async function startDividendLowVolDailyScanOperation(input: {
  symbols?: string[]
  limit?: number
  universe?: 'provided_symbols' | 'all_a'
  executionMode?: 'inline' | 'queued'
} = {}): Promise<any> {
  const response = await fetch(`${API_BASE}/api/v1/operations/dividend-low-vol-daily-scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'default',
      symbols: input.symbols,
      universe: input.universe || (input.symbols?.length ? 'provided_symbols' : 'all_a'),
      limit: input.limit || (input.symbols?.length || 120),
      executionMode: input.executionMode || 'inline',
    }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function checkDividendLowVolAlerts(symbols = ['600000', '000001', '601398', '600519'], options: { scope?: 'all'; limit?: number } = {}): Promise<DividendLowVolAlertCheckResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/alerts/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options.scope === 'all' ? { scope: 'all', limit: options.limit || 120 } : { symbols: symbols.join(','), limit: options.limit }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolPersistedAlerts(limit = 200): Promise<DividendLowVolPersistedAlerts> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/alerts?limit=${encodeURIComponent(String(limit))}`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolCandidateHistory(symbol: string, limit = 30): Promise<DividendLowVolCandidateHistory> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/${encodeURIComponent(symbol)}/history?limit=${encodeURIComponent(String(limit))}`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function createDividendLowVolAuditPackage(limit = 200): Promise<DividendLowVolAuditPackageRef> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/audit-package`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', limit }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function runDividendLowVolBacktest(symbols = ['600000', '000001', '601398', '600519'], options: { scope?: 'all'; limit?: number } = {}): Promise<DividendLowVolBacktestResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(options.scope === 'all' ? { scope: 'all', limit: options.limit || 120 } : { symbols: symbols.join(','), limit: options.limit }),
      initialCapital: 100000,
      dividendReinvestment: true,
      rebalanceFrequency: 'monthly',
    }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolTradingZones(symbols = ['600000', '000001', '601398', '600519'], options: { scope?: 'all'; limit?: number; persistedOnly?: boolean } = {}): Promise<DividendLowVolTradingZoneResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/trading-zones`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options.persistedOnly
      ? { persistedOnly: true, symbols: symbols.join(','), limit: options.limit || 120 }
      : options.scope === 'all'
      ? { scope: 'all', limit: options.limit || 120 }
      : { symbols: symbols.join(','), limit: options.limit }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function runDividendLowVolRollingBacktest(symbols = ['600000', '000001', '601398', '600519'], options: { scope?: 'all'; limit?: number; years?: number } = {}): Promise<DividendLowVolRollingBacktestResult> {
  const years = options.years || 3
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/rolling-backtest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(options.scope === 'all' ? { scope: 'all', limit: options.limit || 120 } : { symbols: symbols.join(','), limit: options.limit }),
      years,
      historyDays: years * 252,
    }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function runDividendLowVolValidationRetest(symbols = ['600000', '000001', '601398', '600519'], options: { scope?: 'all'; limit?: number } = {}): Promise<DividendLowVolValidationRetestResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/validation-retest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(options.scope === 'all' ? { scope: 'all', limit: options.limit || 120 } : { symbols: symbols.join(','), limit: options.limit }),
      initialCapital: 100000,
      dividendReinvestment: true,
      rebalanceFrequency: 'monthly',
    }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getDividendLowVolValidationGapDiagnostics(symbols = ['600000', '000001', '601398', '600519'], options: { scope?: 'all'; limit?: number } = {}): Promise<DividendLowVolValidationGapDiagnosticsResult> {
  const response = await fetch(`${API_BASE}/api/v1/strategy/dividend-low-vol/validation-gap-diagnostics`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(options.scope === 'all' ? { scope: 'all', limit: options.limit || 120 } : { symbols: symbols.join(','), limit: options.limit }),
      initialCapital: 100000,
      dividendReinvestment: true,
      rebalanceFrequency: 'monthly',
    }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getFivdRAnalysis(params: {
  positionId?: string
  symbol?: string
  scope?: 'position' | 'portfolio'
  forceRefresh?: boolean
} = {}): Promise<FivdRAnalysisResult> {
  const search = new URLSearchParams({ userId: 'default' })
  if (params.positionId) search.set('positionId', params.positionId)
  if (params.symbol) search.set('symbol', params.symbol)
  if (params.scope) search.set('scope', params.scope)
  if (params.forceRefresh) search.set('forceRefresh', 'true')

  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r?${search.toString()}`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getFivdRPortfolioSummary(params: {
  maxCacheAgeMs?: number
} = {}): Promise<FivdRAnalysisResult> {
  const search = new URLSearchParams({ userId: 'default' })
  if (typeof params.maxCacheAgeMs === 'number') search.set('maxCacheAgeMs', String(params.maxCacheAgeMs))

  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/summary?${search.toString()}`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function startFivdRPortfolioRefreshOperation(input: {
  forceRefresh?: boolean
} = {}): Promise<any> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/refresh-operation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', ...input }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getOperationById(operationId: string): Promise<any> {
  const response = await fetch(`${API_BASE}/api/v1/operations/${operationId}`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function scoreFivdRCandidates(input: {
  source: 'stock_screener' | 'manual_list' | 'watchlist'
  strategyQuery?: string
  candidates: Array<{
    symbol: string
    name?: string
    strategyScore?: number
    strategyId?: string
    evidenceRefs?: string[]
  }>
}): Promise<FivdRCandidateBatchResult> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/candidates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', ...input }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function saveFivdRResearchSnapshot(input: {
  result: FivdRAnalysisResult | Record<string, unknown>
  source?: string
  note?: string
}): Promise<{
  schemaVersion: 'fivd.r.research_snapshot.v1'
  operationId: string
  runId: string
  artifactRefs: string[]
}> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/snapshots`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', ...input }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function listFivdRResearchSnapshots(limit = 20): Promise<FivdRResearchSnapshotList> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/snapshots?userId=default&limit=${encodeURIComponent(String(limit))}`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function addFivdRWatch(input: {
  runId: string
  positionId?: string | null
  symbol?: string | null
  reason?: string
  modelResultRef?: string
  evidenceRefs?: string[]
}): Promise<any> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/watch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', reviewer: 'user', source: 'analysis_page', ...input }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function listFivdRWatch(limit = 20): Promise<FivdRWatchList> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/watch?userId=default&decision=manual_watch&limit=${encodeURIComponent(String(limit))}`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function createFivdRRiskAlert(input: {
  symbol?: string | null
  title?: string
  message?: string
  reason?: string
  severity?: 'info' | 'warning' | 'danger'
}): Promise<any> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/risk-alert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', ...input }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function runFivdRValidationRetestAudit(input: {
  operationId?: string
  candidateLimit?: number
} = {}): Promise<any> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/validation-retest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', ...input }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function getLatestFivdRValidationReport(): Promise<FivdRValidationFailureTaxonomy> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/validation-report/latest?userId=default`)
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function createFivdRDataGapRemediationPlan(input: {
  gaps?: DataGap[]
  sourceRunId?: string | null
  source?: 'latest_summary' | 'provided_gaps'
} = {}): Promise<FivdRDataGapRemediationPlan> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/data-gap-remediation-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', ...input }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function startFivdRDataGapRemediation(input: {
  gaps?: DataGap[]
  sourceRunId?: string | null
  source?: 'latest_summary' | 'provided_gaps'
  actionIds?: string[]
} = {}): Promise<FivdRDataGapRemediationExecution> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/data-gap-remediation-operation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', ...input }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function runFivdRInfrastructureAudit(): Promise<any> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/infrastructure-audit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default' }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

export async function createFivdRManualTradeDraft(input: {
  result?: FivdRAnalysisResult
  requestedActions?: Array<Record<string, any>>
} = {}): Promise<any> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/fivd-r/manual-trade-draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default', ...input }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

// 获取每周建议
export async function getWeeklySuggestions(): Promise<any> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/analysis/suggestions?period=weekly`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    return response.json()
  } catch (error) {
    console.error('Failed to fetch weekly suggestions:', error)
    return getMockWeeklySuggestions()
  }
}

// 生成交易计划
export async function generateTradingPlan(symbols: string[]): Promise<{
  planId: string
  actions: Array<{
    symbol: string
    action: 'buy' | 'sell' | 'hold'
    quantity: number
    price: number
    amount: number
    reason: string
  }>
}> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/analysis/trading-plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'default', symbols }),
    })
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    return response.json()
  } catch (error) {
    console.error('Failed to generate trading plan:', error)
    return getMockTradingPlan(symbols)
  }
}

export async function executeAdviceAction(actionId: string): Promise<any> {
  const response = await fetch(`${API_BASE}/api/v1/analysis/advice-actions/${actionId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'default' }),
  })
  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `HTTP error! status: ${response.status}`)
  }
  return response.json()
}

// 创建网格挂单建议
export async function createGridOrder(symbol: string, basePrice: number, gridCount: number = 5): Promise<Suggestion> {
  const grids = []
  const priceRange = 0.1 // ±10% 价格范围
  const gridSize = priceRange / gridCount

  for (let i = 1; i <= gridCount; i++) {
    const price = basePrice * (1 - priceRange / 2 + gridSize * i)
    grids.push({
      level: i,
      price: price.toFixed(2),
      amount: Math.floor(1000 / price),
    })
  }

  return {
    id: `grid_${symbol}_${Date.now()}`,
    type: 'grid_order',
    title: `网格挂单 - ${symbol}`,
    description: `在 ${basePrice} 附近设置 ${gridCount} 个网格点位，每个点位买入 ${Math.floor(1000 / basePrice)} 股`,
    priority: 'medium',
    targetSymbol: symbol,
    parameters: { basePrice, gridCount, grids },
    createdAt: new Date().toISOString(),
  }
}

// 创建定投计划建议
export async function createDCAPlan(symbol: string, amount: number, frequency: 'daily' | 'weekly' | 'monthly'): Promise<Suggestion> {
  return {
    id: `dca_${symbol}_${Date.now()}`,
    type: 'dca_plan',
    title: `定投计划 - ${symbol}`,
    description: `每${frequency === 'daily' ? '日' : frequency === 'weekly' ? '周' : '月'}定投 ${amount} 元`,
    priority: 'low',
    targetSymbol: symbol,
    parameters: { amount, frequency },
    createdAt: new Date().toISOString(),
  }
}

// 创建止损提醒
export async function createStopLossAlert(symbol: string, price: number, reason: string): Promise<Suggestion> {
  return {
    id: `stop_${symbol}_${Date.now()}`,
    type: 'stop_loss',
    title: `止损提醒 - ${symbol}`,
    description: `当价格跌破 ${price} 时触发止损（${reason}）`,
    priority: 'high',
    targetSymbol: symbol,
    parameters: { price, reason },
    createdAt: new Date().toISOString(),
  }
}

function getMockWeeklySuggestions(): any {
  return {
    week: '2026-W16',
    rebalancing: {
      needed: true,
      actions: [
        { type: 'stock', currentRatio: 65, targetRatio: 50, action: 'reduce', amount: 150000 },
        { type: 'bond', currentRatio: 15, targetRatio: 30, action: 'add', amount: 150000 },
      ],
    },
    performanceReview: {
      totalReturn: 3.25,
      topPerformer: { symbol: '600519', returnPercent: 8.5 },
      worstPerformer: { symbol: '000001', returnPercent: -2.3 },
    },
  }
}

function getMockTradingPlan(symbols: string[]): {
  planId: string
  actions: Array<{
    symbol: string
    action: 'buy' | 'sell' | 'hold'
    quantity: number
    price: number
    amount: number
    reason: string
  }>
} {
  return {
    planId: `plan_${Date.now()}`,
    actions: symbols.map(symbol => ({
      symbol,
      action: 'hold' as const,
      quantity: 0,
      price: 0,
      amount: 0,
      reason: '无明显信号，建议持有观察',
    })),
  }
}

export default {
  getDailySuggestions,
  searchInvestmentSuggestions,
  analyzeTarget,
  getDividendLowVolCandidates,
  getDividendLowVolDataReadiness,
  getDividendLowVolV2ResearchValidation,
  getDividendLowVolManualDraftReadiness,
  getDividendLowVolManualTradeDraft,
  getDividendLowVolManualWatchlist,
  getDividendLowVolManualWorkflowAudit,
  createDividendLowVolManualPretradeCheck,
  reviewDividendLowVolManualPretradeCheck,
  createDividendLowVolManualTradeDraft,
  reviewDividendLowVolManualTradeDraft,
  startDividendLowVolDailyScanOperation,
  checkDividendLowVolAlerts,
  getDividendLowVolPersistedAlerts,
  getDividendLowVolCandidateHistory,
  createDividendLowVolAuditPackage,
  runDividendLowVolBacktest,
  getDividendLowVolTradingZones,
  runDividendLowVolRollingBacktest,
  runDividendLowVolValidationRetest,
  getDividendLowVolValidationGapDiagnostics,
  getHoldingsResearch,
  getFivdRAnalysis,
  getFivdRPortfolioSummary,
  startFivdRPortfolioRefreshOperation,
  getOperationById,
  scoreFivdRCandidates,
  saveFivdRResearchSnapshot,
  listFivdRResearchSnapshots,
  addFivdRWatch,
  listFivdRWatch,
  createFivdRRiskAlert,
  runFivdRValidationRetestAudit,
  getLatestFivdRValidationReport,
  runFivdRInfrastructureAudit,
  createFivdRManualTradeDraft,
  getWeeklySuggestions,
  generateTradingPlan,
  executeAdviceAction,
  createGridOrder,
  createDCAPlan,
  createStopLossAlert,
  createFivdRDataGapRemediationPlan,
  startFivdRDataGapRemediation,
}
