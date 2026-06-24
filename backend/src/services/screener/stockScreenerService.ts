import { prisma } from '../../db/prisma.js'
import type { MarketFeatureDaily } from '@prisma/client'
import { assetIdentityResolver } from '../asset/assetIdentityResolver.js'
import { getAllAshareStocks, type StockHistoryData } from '../../utils/stockUtils.js'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { Client } from 'pg'
import { marketBarCacheService, type MarketBarCacheStats } from '../market-data/marketBarCacheService.js'
import { marketFeatureDailyService } from '../market-data/marketFeatureDailyService.js'
import { securityStatusService, type MarketTradeabilityFact, type SecurityStatusCoverageSnapshot, type SecurityStatusFact } from '../market-data/securityStatusService.js'
import { stockAnalysisService } from '../technical/stockAnalysisService.js'
import { fundamentalDataProvider } from '../technical/fundamentalDataProvider.js'

export interface ScreenableStockAsset {
  symbol: string
  name: string
  type: string
  market?: string
  exchange?: string
  sourceAssetType?: string
  confidenceScore?: number
  universeSource?: string
  industry?: string
  sector?: string
  officialIndustryGroup?: string
  officialIndustryCode?: string
  totalMarketCap?: number
  floatMarketCap?: number
  peDynamic?: number
  pb?: number
  metadataProvider?: string
  metadataAsOf?: string
  metadataWarnings?: string[]
  securityStatusFact?: SecurityStatusFact
  tradeabilityFact?: MarketTradeabilityFact
}

type ScreenerBacktestAsset = Pick<ScreenableStockAsset, 'symbol' | 'name'> & Partial<ScreenableStockAsset>

export interface ExcludedScreeningAsset {
  symbol: string
  name: string
  localType: string
  resolvedType: string
  market: string
  confidenceScore: number
  reason: string
}

export interface ScreenerFactsetPreheatReport {
  schemaVersion: 'fams.screener.factset_preheat_run.v1'
  generatedAt: string
  userId: string
  universeSource: string
  universeTotal: number
  requestedSymbols: number
  plannedSymbols: number
  attemptedSymbols: number
  successSymbols: number
  failureSymbols: number
  nextOffset: number
  remainingTargetSymbols: number
  elapsedMs: number
  options: {
    maxScan: number
    limit: number
    concurrency: number
    forceRefresh: boolean
    offset: number
    batchSize: number
    perSymbolTimeoutMs: number
    symbols: string[]
  }
  initialCoverage: unknown
  finalCoverage: unknown
  progress: Array<{
    batchIndex: number
    batchStartOffset: number
    plannedSymbols: number
    attemptedSymbols: number
    immediateSuccessSymbols: number
    unresolvedFailureSymbols: number
    elapsedMs: number
    coveragePercent: number | null
    failureCategorySummary: Record<string, number>
  }>
  failureCategorySummary: Record<string, number>
  failures: Array<{ symbol: string; name: string; error: string; category: string; elapsedMs: number }>
  warnings: string[]
}

export interface ScreenerMetric {
  symbol: string
  name: string
  strategyId: ScreenerStrategyId
  strategyMatched?: boolean
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
  matchedRules: string[]
  unmatchedReasons: string[]
  reason: string
  advice: string
}

export interface ScreenerThresholds {
  drawdownPercent: number
  sidewaysRangePercent: number
  lastTwoVolumeRatio: number
  minHistoryDays: number
  reclaimVolumeRatio: number
}

export interface ScreenerOptions {
  maxUniverse?: number
  maxScan?: number
  maxResults: number
  concurrency: number
  marketDataMode: 'cache_only' | 'live_fetch'
  strategyId: ScreenerStrategyId
  backtestDays: number
  holdingDays: number
  thresholds: ScreenerThresholds
  filters: {
    peMin?: number
    peMax?: number
    marketCapMin?: number
    marketCapMax?: number
    industryIncludes?: string
  }
}

export type ScreenerStrategyId = 'a_flush_sideways_volume' | 'volume_platform_breakout' | 'ma_reclaim'

export interface ScreenerBacktestOutcome {
  symbol: string
  name: string
  marketSegment?: string
  industryGroup?: string
  marketCapGroup?: string
  marketRegime?: string
  groupMetadata?: ScreenerOutcomeGroupMetadata
  signalDate?: string
  entryDate?: string
  exitDate?: string
  entryPrice: number
  exitPrice: number
  grossReturnPercent: number
  returnPercent: number
  win: boolean
  score: number
  blockedReason?: string
  costPercent?: number
  entryReason?: string
  exitReason?: string
  notional?: number
  positionSizeMultiplier?: number
  positionSizingReason?: string
}

export interface ScreenerOutcomeGroupMetadataItem {
  value: string
  provider: 'symbol_rule' | 'asset_metadata' | 'eastmoney_fundamental_cache' | 'name_keyword_rule' | 'liquidity_proxy' | 'price_regime_rule' | 'fallback_rule'
  method: string
  confidence: number
  warnings: string[]
  asOf?: string
  sourceRefs?: string[]
}

export interface ScreenerOutcomeGroupMetadata {
  schemaVersion: 'fams.screener.group_metadata.v1'
  marketSegment: ScreenerOutcomeGroupMetadataItem
  industryGroup: ScreenerOutcomeGroupMetadataItem
  marketCapGroup: ScreenerOutcomeGroupMetadataItem
  marketRegime: ScreenerOutcomeGroupMetadataItem
}

export interface ScreenerStrategyBacktest {
  candidateId: string
  strategyId: ScreenerStrategyId
  name: string
  description: string
  executionPolicy: {
    id: string
    label: string
    entryMode: 't1_open' | 't1_close'
    entryLabel: string
    holdingDays: number
    exitMode: 'fixed_hold' | 'stop_take_profit' | 'trailing_stop'
    stopLossPercent?: number
    takeProfitPercent?: number
    trailingStopPercent?: number
    positionSizingMode: 'equal_notional' | 'volatility_scaled'
    positionSizingLabel: string
    regimeFilterMode: 'none' | 'avoid_high_volatility_chop'
    regimeFilterLabel: string
    blockedRegimes?: string[]
  }
  signals: number
  wins: number
  losses: number
  winRatePercent: number | null
  averageReturnPercent: number | null
  bestReturnPercent: number | null
  worstReturnPercent: number | null
  benchmarkAverageReturnPercent: number | null
  excessReturnPercent: number | null
  sampleSize: number
  tradeCount: number
  medianReturnPercent: number | null
  profitFactor: number | null
  maxDrawdownPercent: number | null
  sharpe: number | null
  sortino: number | null
  calmar: number | null
  turnoverPercent: number | null
  tailLossP95Percent: number | null
  tailLossP99Percent: number | null
  equityCurve: Array<{ index: number; value: number; drawdownPercent: number }>
  evaluatedStocks: number
  latestMatchedCount: number
  credibility: {
    rating: 'high' | 'medium' | 'low' | 'insufficient'
    score: number
    minSignals: number
    sampleAdequacyPercent: number
    winRateConfidenceInterval?: { low: number; high: number }
    reasons: string[]
  }
  latestCandidates: Array<Pick<ScreenerMetric, 'symbol' | 'name' | 'score' | 'reason'>>
  samples: ScreenerBacktestOutcome[]
  blockedSamples: ScreenerBacktestOutcome[]
  versionBundle: ScreenerTournamentVersionBundle
  auditHash: string
  outOfSampleValidation: ScreenerOutOfSampleValidation
  walkForwardValidation: ScreenerWalkForwardValidation
  parameterSensitivity: ScreenerParameterSensitivity
  groupStabilityValidation: ScreenerGroupStabilityValidation
  persistedBacktestId?: string
  persistedResultId?: string
  persistedStrategyVersionId?: string
}

export interface ScreenerValidationWindowSummary {
  sampleSize: number
  startSignalDate?: string
  endSignalDate?: string
  winRatePercent: number | null
  averageReturnPercent: number | null
  benchmarkAverageReturnPercent: number | null
  excessReturnPercent: number | null
}

export interface ScreenerOutOfSampleValidation {
  schemaVersion: 'fams.screener.oos_validation.v1'
  method: 'chronological_70_30_split'
  status: 'passed' | 'failed' | 'insufficient'
  train: ScreenerValidationWindowSummary
  outOfSample: ScreenerValidationWindowSummary
  warnings: string[]
}

export interface ScreenerWalkForwardWindow {
  windowIndex: number
  startSignalDate?: string
  endSignalDate?: string
  summary: ScreenerValidationWindowSummary
  status: 'passed' | 'failed' | 'insufficient'
}

export interface ScreenerWalkForwardValidation {
  schemaVersion: 'fams.screener.walk_forward.v1'
  method: 'chronological_3_window_split'
  status: 'passed' | 'failed' | 'insufficient'
  passedWindows: number
  totalWindows: number
  windows: ScreenerWalkForwardWindow[]
  warnings: string[]
}

export interface ScreenerParameterSensitivityVariant {
  variantId: string
  thresholds: ScreenerThresholds
  sampleSize: number
  tradeCount: number
  winRatePercent: number | null
  averageReturnPercent: number | null
  excessReturnPercent: number | null
  maxDrawdownPercent: number | null
  status: 'passed' | 'failed' | 'insufficient'
}

export interface ScreenerParameterSensitivity {
  schemaVersion: 'fams.screener.parameter_sensitivity.v1'
  method: 'local_threshold_grid_v2'
  status: 'passed' | 'failed' | 'insufficient'
  stableVariantCount: number
  totalVariants: number
  baseThresholds: ScreenerThresholds
  variants: ScreenerParameterSensitivityVariant[]
  warnings: string[]
}

export interface ScreenerStabilityGroupBucket {
  key: string
  label: string
  provider: string
  method: string
  confidence: number
  sampleSize: number
  tradeCount: number
  winRatePercent: number | null
  averageReturnPercent: number | null
  excessReturnPercent: number | null
  maxDrawdownPercent: number | null
  status: 'passed' | 'failed' | 'insufficient'
  warnings: string[]
}

export interface ScreenerStabilityDimension {
  dimension: 'market_regime' | 'market_segment' | 'industry_group' | 'market_cap_group'
  label: string
  providerSummary: Array<{
    provider: string
    sampleSize: number
    averageConfidence: number
  }>
  averageConfidence: number
  status: 'passed' | 'failed' | 'insufficient'
  passedGroups: number
  totalGroups: number
  groups: ScreenerStabilityGroupBucket[]
  warnings: string[]
}

export interface ScreenerGroupStabilityValidation {
  schemaVersion: 'fams.screener.group_stability.v1'
  method: 'post_trade_grouped_outcome_audit'
  status: 'passed' | 'failed' | 'insufficient'
  dimensions: ScreenerStabilityDimension[]
  warnings: string[]
}

export interface ScreenerLongSampleAcceptanceReport {
  schemaVersion: 'fams.screener.long_sample_acceptance.v1'
  generatedAt: string
  status: 'passed' | 'failed' | 'insufficient'
  summary: {
    universeSize: number
    scannedCount: number
    evaluatedCount: number
    failureCount: number
    scanCoveragePercent: number
    providerSuccessRate: number
    cacheHitRate: number
    backtestDays: number
    rankedCandidates: number
    bestSampleSize: number
    bestCredibility: 'high' | 'medium' | 'low' | 'insufficient' | 'unknown'
    universeSource: string
    universeTotal: number
  }
  gates: Array<{
    id: string
    label: string
    status: 'passed' | 'failed' | 'insufficient'
    actual: number | string | null
    required: number | string
    severity: 'blocker' | 'warning'
    message: string
  }>
  topCandidates: Array<{
    candidateId: string
    strategyId: ScreenerStrategyId
    sampleSize: number
    tradeCount: number
    credibility: 'high' | 'medium' | 'low' | 'insufficient'
    excessReturnPercent: number | null
    outOfSampleStatus: string
    walkForwardStatus: string
    parameterSensitivityStatus: string
    groupStabilityStatus: string
  }>
  recommendations: string[]
}

export interface ScreenerTournamentVersionBundle {
  schemaVersion: 'fams.screener.tournament_candidate.v1'
  signalStrategy: {
    id: ScreenerStrategyId
    version: string
    thresholdHash: string
  }
  entryPolicy: {
    id: 't1_open' | 't1_close'
    version: string
  }
  exitPolicy: {
    id: 'hold_n_close' | 'stop_take_profit' | 'trailing_stop'
    version: string
    holdingDays: number
    stopLossPercent?: number
    takeProfitPercent?: number
    trailingStopPercent?: number
  }
  positionSizingPolicy: {
    id: 'equal_notional' | 'volatility_scaled'
    version: string
    notional: number
    minMultiplier?: number
    maxMultiplier?: number
    lookbackDays?: number
  }
  portfolioPolicy: {
    id: 'single_signal_sample'
    version: string
    maxConcurrentPositions?: number
  }
  regimeFilterPolicy?: {
    id: 'none' | 'avoid_high_volatility_chop'
    version: string
    blockedRegimes: string[]
    method: string
    note: string
  }
  costModel: {
    id: 'cn_equity_cost'
    version: string
    commissionRate: number
    minCommission: number
    stampDutySellRate: number
    slippageRate: number
  }
  marketConstraint: {
    id: 'cn_a_share_tradeability'
    version: string
    excludeST: boolean
    minListingDays: number
    minAmount: number
    limitUpCannotBuy: boolean
    limitDownCannotSell: boolean
    suspendedCannotTrade: boolean
  }
  engine: {
    version: string
  }
}

export interface ScreenerStrategyTournament {
  batchId?: string
  persistenceStatus?: 'persisted' | 'failed'
  evaluationDays: number
  holdingDays: number
  executionMatrix: {
    schemaVersion: 'fams.screener.execution_matrix.v1'
    signalStrategies: ScreenerStrategyId[]
    executionPolicies: ScreenerExecutionPolicyVariant[]
    totalCandidates: number
  }
  generatedAt: string
  benchmark: {
    samples: number
    averageReturnPercent: number | null
    winRatePercent: number | null
  }
  ranked: ScreenerStrategyBacktest[]
  notes: string[]
  assumptions: {
    schemaVersion: 'fams.screener.backtest.assumptions.v1'
    signalTiming: string
    entryPolicy: string
    exitPolicy: string
    costModel: {
      commissionRate: number
      minCommission: number
      stampDutySellRate: number
      slippageRate: number
    }
    marketConstraints: {
      excludeST: boolean
      minListingDays: number
      minAmount: number
      limitUpCannotBuy: boolean
      limitDownCannotSell: boolean
      suspendedCannotTrade: boolean
    }
    regimeFilters: {
      supportedModes: Array<'none' | 'avoid_high_volatility_chop'>
      method: string
      note: string
    }
  }
}

export interface ScreenerAsyncStrategyEvidence {
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
  validationDecision?: ScreenerValidationDecision
  gateSummary?: Array<{
    id: string
    status: 'passed' | 'failed' | 'insufficient'
    severity: 'blocker' | 'warning'
    message: string
  }>
  topCandidates?: ScreenerLongSampleAcceptanceReport['topCandidates']
  usableForTradingAdvice: boolean
  blockedReasons: string[]
  reason?: string
}

export interface ScreenerValidationDecision {
  schemaVersion: 'fams.screener.validation_decision.v1'
  generatedAt: string
  decision: 'TRADING_RESEARCH_ALLOWED' | 'OBSERVE_ONLY' | 'INSUFFICIENT_DATA'
  allowedActions: Array<'RESEARCH' | 'OBSERVE' | 'PAPER_TRADE' | 'ADD' | 'REDUCE'>
  prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
  usableForTradingAdvice: boolean
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
  primaryBlocker?: string
  blockerGateIds: string[]
  reasons: string[]
  requiredNextChecks: string[]
  evidenceRefs: string[]
  oosSummary?: {
    diagnosedCandidates: number
    passedCount: number
    failedCount: number
  }
  marketStateFindings?: string[]
}

export interface ScreenerReturnDistribution {
  sampleSize: number
  winRatePercent: number | null
  averageReturnPercent: number | null
  medianReturnPercent: number | null
  p25ReturnPercent: number | null
  p75ReturnPercent: number | null
  tailLossP95Percent: number | null
  bestReturnPercent: number | null
  worstReturnPercent: number | null
  positiveCount: number
  negativeCount: number
}

export interface ScreenerOosFailureAnalysis {
  schemaVersion: 'fams.screener.oos_failure_analysis.v1'
  generatedAt: string
  batchId: string | null
  evaluationDays: number
  diagnosedCandidates: number
  passedCount: number
  failedCount: number
  globalConclusion: string
  globalFailureTags: string[]
  candidates: Array<{
    candidateId: string
    strategyId: ScreenerStrategyId
    name: string
    credibility: 'high' | 'medium' | 'low' | 'insufficient'
    oosStatus: 'passed' | 'failed' | 'insufficient'
    train: ScreenerValidationWindowSummary
    outOfSample: ScreenerValidationWindowSummary
    trainDistribution: ScreenerReturnDistribution
    outOfSampleDistribution: ScreenerReturnDistribution
    deterioration: {
      excessReturnDelta: number | null
      averageReturnDelta: number | null
      medianReturnDelta: number | null
      winRateDelta: number | null
    }
    signalDateDistribution: {
      train: Array<{ date: string; count: number }>
      outOfSample: Array<{ date: string; count: number }>
    }
    failureTags: string[]
    recommendedAction: 'OBSERVE_ONLY' | 'RESEARCH_ONLY'
  }>
}

export interface ScreenerOosLayeredValidationReport {
  schemaVersion: 'fams.screener.oos_layered_validation.v1'
  generatedAt: string
  batchId: string | null
  status: 'passed' | 'completed_with_blockers' | 'insufficient'
  method: 'chronological_70_30_split_by_regime_industry_market_cap'
  summary: {
    diagnosedCandidates: number
    dimensions: number
    buckets: number
    passedBuckets: number
    failedBuckets: number
    insufficientBuckets: number
  }
  dimensions: Array<{
    dimension: 'market_regime' | 'industry_group' | 'market_cap_group'
    label: string
    buckets: Array<{
      key: string
      label: string
      candidateCount: number
      train: ScreenerReturnDistribution
      outOfSample: ScreenerReturnDistribution
      deterioration: {
        averageReturnDelta: number | null
        medianReturnDelta: number | null
        winRateDelta: number | null
      }
      status: 'passed' | 'failed' | 'insufficient'
      warnings: string[]
    }>
  }>
  findings: string[]
  nextActions: string[]
}

export interface ScreenerValidationEvidenceMatrixReport {
  schemaVersion: 'fams.screener.validation_evidence_matrix.v1'
  generatedAt: string
  status: 'passed' | 'blocked'
  decision: 'READY_FOR_MANUAL_REVIEW' | 'OBSERVE_ONLY'
  batchId: string | null
  evaluationDays: number
  summary: {
    rankedCandidates: number
    diagnosedCandidates: number
    passedCandidates: number
    failedCandidates: number
    insufficientCandidates: number
    primaryBlocker: 'none' | 'out_of_sample' | 'walk_forward' | 'parameter_sensitivity' | 'group_stability' | 'insufficient_samples'
  }
  candidates: Array<{
    candidateId: string
    strategyId: ScreenerStrategyId
    name: string
    executionPolicy: ScreenerStrategyBacktest['executionPolicy']
    sampleSize: number
    tradeCount: number
    credibility: ScreenerStrategyBacktest['credibility']['rating']
    averageReturnPercent: number | null
    excessReturnPercent: number | null
    maxDrawdownPercent: number | null
    validation: {
      outOfSample: ScreenerOutOfSampleValidation['status']
      walkForward: ScreenerWalkForwardValidation['status']
      parameterSensitivity: ScreenerParameterSensitivity['status']
      groupStability: ScreenerGroupStabilityValidation['status']
      allPassed: boolean
    }
    oos: {
      trainExcessReturnPercent: number | null
      outExcessReturnPercent: number | null
      excessReturnDelta: number | null
      trainAverageReturnPercent: number | null
      outAverageReturnPercent: number | null
      averageReturnDelta: number | null
      trainSampleSize: number
      outSampleSize: number
    }
    failedChecks: Array<'out_of_sample' | 'walk_forward' | 'parameter_sensitivity' | 'group_stability'>
    blockerTags: string[]
    actionClass: 'eligible_manual_review' | 'regime_retest' | 'parameter_retest' | 'group_retest' | 'needs_more_samples' | 'observe_only' | 'retire_candidate'
    nextAction: string
  }>
  closurePlan: string[]
}

export interface ScreenerStrategyFailureMatrixReport {
  schemaVersion: 'fams.screener.strategy_failure_matrix.v1'
  generatedAt: string
  batchId: string | null
  status: 'blocked' | 'ready_for_manual_review'
  summary: {
    diagnosedCandidates: number
    passedCandidates: number
    retestQueue: number
    retireQueue: number
    expandSampleQueue: number
    regimeSpecificQueue: number
    primaryBlocker: ScreenerValidationEvidenceMatrixReport['summary']['primaryBlocker']
    requiresNewStrategyFamily: boolean
  }
  candidates: Array<{
    candidateId: string
    strategyId: ScreenerStrategyId
    name: string
    failedChecks: ScreenerValidationEvidenceMatrixReport['candidates'][number]['failedChecks']
    failedReason: string
    sampleSize: number
    tradeCount: number
    affectedRegimes: string[]
    parameterSensitivityStatus: ScreenerParameterSensitivity['status']
    groupStabilityStatus: ScreenerGroupStabilityValidation['status']
    recommendation: 'retest' | 'narrow_scope' | 'retire' | 'requires_new_strategy_family'
    queue: 'retest_queue' | 'retire_queue' | 'expand_sample_queue' | 'regime_specific_queue' | 'manual_review_queue'
    evidenceRefs: string[]
    prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
  }>
  queues: {
    retestQueue: string[]
    retireQueue: string[]
    expandSampleQueue: string[]
    regimeSpecificQueue: string[]
    manualReviewQueue: string[]
  }
  nextActions: string[]
}

export interface ScreenerStrategyRemediationReport {
  schemaVersion: 'fams.screener.strategy_remediation_report.v1'
  generatedAt: string
  batchId: string | null
  status: 'research_only' | 'ready_for_manual_review'
  summary: {
    totalCandidates: number
    keepForResearch: number
    narrowScope: number
    retire: number
    requiresNewStrategyFamily: boolean
    usableForTradingAdvice: boolean
  }
  remediations: Array<{
    candidateId: string
    strategyId: ScreenerStrategyId
    decision: 'keep_research_only' | 'narrow_scope' | 'retire' | 'manual_review_candidate'
    reason: string
    requiredEvidenceBeforePromotion: string[]
    prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
  }>
  auditOpinion: {
    severity: 'minor' | 'major' | 'critical'
    conclusion: string
  }
  nextActions: string[]
}

export interface ScreenerOosMultiWindowRegimeRetestReport {
  schemaVersion: 'fams.screener.oos_multi_window_regime_retest.v1'
  generatedAt: string
  batchId: string | null
  status: 'passed' | 'completed_with_blockers' | 'insufficient'
  method: 'chronological_multi_split_and_market_regime_retest'
  summary: {
    diagnosedCandidates: number
    analyzedCandidates: number
    windows: number
    passedWindows: number
    failedWindows: number
    insufficientWindows: number
    regimeBuckets: number
    passedRegimeBuckets: number
    failedRegimeBuckets: number
    insufficientRegimeBuckets: number
  }
  candidates: Array<{
    candidateId: string
    strategyId: ScreenerStrategyId
    name: string
    executionPolicy: ScreenerStrategyBacktest['executionPolicy']
    actionClass: ScreenerValidationEvidenceMatrixReport['candidates'][number]['actionClass']
    sampleSize: number
    tradeCount: number
    windows: Array<{
      splitId: 'train_60_oos_40' | 'train_70_oos_30' | 'train_80_oos_20'
      trainRatio: number
      train: ScreenerReturnDistribution
      outOfSample: ScreenerReturnDistribution
      deterioration: {
        averageReturnDelta: number | null
        medianReturnDelta: number | null
        winRateDelta: number | null
      }
      status: 'passed' | 'failed' | 'insufficient'
      warnings: string[]
    }>
    regimeBuckets: Array<{
      regime: string
      train: ScreenerReturnDistribution
      outOfSample: ScreenerReturnDistribution
      status: 'passed' | 'failed' | 'insufficient'
      warnings: string[]
    }>
    conclusion: 'eligible_manual_review' | 'regime_limited_candidate' | 'observe_only' | 'needs_more_samples' | 'retire_candidate'
    nextAction: string
  }>
  findings: string[]
  nextActions: string[]
}

export interface ScreenerValidationCandidateDispositionReport {
  schemaVersion: 'fams.screener.validation_candidate_disposition.v1'
  generatedAt: string
  batchId: string | null
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
    strategyId: ScreenerStrategyId
    name: string
    executionPolicy: ScreenerStrategyBacktest['executionPolicy']
    matrixActionClass: ScreenerValidationEvidenceMatrixReport['candidates'][number]['actionClass']
    retestConclusion?: ScreenerOosMultiWindowRegimeRetestReport['candidates'][number]['conclusion']
    finalDisposition: 'eligible_manual_review' | 'regime_limited_candidate' | 'observe_only' | 'retire_candidate' | 'needs_more_samples'
    allowedActions: Array<'RESEARCH' | 'OBSERVE' | 'PAPER_TRADE' | 'MANUAL_REVIEW'>
    prohibitedActions: Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>
    failedChecks: ScreenerValidationEvidenceMatrixReport['candidates'][number]['failedChecks']
    blockerTags: string[]
    evidenceRefs: string[]
    rationale: string
    nextAction: string
  }>
  rules: string[]
  nextActions: string[]
}

export interface ScreenerInfrastructureReadinessReport {
  schemaVersion: 'fams.screener.infrastructure_readiness.v1'
  generatedAt: string
  status: 'ready' | 'blocked' | 'needs_review'
  database: {
    provider: 'sqlite' | 'postgresql' | 'unknown'
    urlKind: 'file' | 'postgres' | 'other' | 'unset'
    durabilityMode: 'development_local' | 'production_candidate'
  }
  execution: {
    operationId: string
    operationMode: 'default' | 'long_sample_dry_run' | 'long_sample_full'
    executionMode: 'inline' | 'queued' | 'unknown'
    marketDataMode: ScreenerOptions['marketDataMode']
    chunkSize: number
    concurrency: number
    scannedCount: number
    evaluatedCount: number
    artifactCount: number
  }
  gates: Array<{
    id: string
    label: string
    status: 'passed' | 'failed' | 'warning'
    severity: 'blocker' | 'warning'
    message: string
  }>
  migrationPlan: {
    requiredBeforeProductionFullA: string[]
    sqliteAllowedScope: string[]
    postgresqlTarget: string[]
  }
}

export interface ScreenerMarketConstraintCoverageReport {
  schemaVersion: 'fams.screener.market_constraint_coverage.v1'
  generatedAt: string
  status: 'sufficient_for_backtest_audit' | 'needs_official_status_provider'
  constraintVersion: string
  assumptions: ScreenerStrategyTournament['assumptions']['marketConstraints']
  summary: {
    rankedCandidates: number
    executedSamples: number
    blockedSamples: number
    blockedRatioPercent: number
    uniqueBlockedSymbols: number
  }
  blockedReasonSummary: Array<{
    reason: string
    count: number
    symbols: string[]
    evidenceType: 'name_rule' | 'kline_volume' | 'kline_amount' | 'price_limit_heuristic' | 'listing_age' | 'unknown'
    reliability: 'high' | 'medium' | 'low'
    requiresOfficialProvider: boolean
  }>
  providerGaps: string[]
  nextActions: string[]
}

export interface ScreenerP4ClosureReviewReport {
  schemaVersion: 'fams.screener.p4_closure_review.v1'
  generatedAt: string
  phase: 'P4.34'
  status: 'research_ready' | 'blocked_for_trading' | 'blocked_for_production'
  decision: 'CONTINUE_RESEARCH_ONLY' | 'READY_FOR_MANUAL_REVIEW'
  summary: {
    acceptanceStatus: ScreenerLongSampleAcceptanceReport['status']
    validationDecision: ScreenerValidationDecision['decision']
    candidateDispositionStatus?: ScreenerValidationCandidateDispositionReport['status']
    infrastructureStatus: ScreenerInfrastructureReadinessReport['status']
    marketConstraintStatus: ScreenerMarketConstraintCoverageReport['status']
    usableForTradingAdvice: boolean
    productionReady: boolean
  }
  gates: Array<{
    id: string
    label: string
    status: 'passed' | 'failed' | 'warning'
    severity: 'blocker' | 'warning'
    sourceArtifact: string
    message: string
  }>
  completedEvidence: string[]
  remainingBlockers: string[]
  nextActions: string[]
  artifactRefs: string[]
}

export interface ScreenerPostgresShadowReadinessReport {
  schemaVersion: 'fams.infrastructure.postgres_shadow_readiness.v1'
  generatedAt: string
  status: 'not_configured' | 'configured_not_verified' | 'ready'
  mode: 'shadow_only'
  database: {
    currentProvider: ScreenerInfrastructureReadinessReport['database']['provider']
    shadowConfigured: boolean
    shadowUrlKind: 'postgres' | 'unset' | 'other'
  }
  verification: {
    clientTool: 'psql_available' | 'psql_missing'
    connectionChecked: boolean
    schemaChecked: boolean
    stagingChecked: boolean
    pressureChecked: boolean
    notes: string[]
    error?: string
  }
  requiredStages: Array<{
    id: string
    status: 'pending' | 'blocked' | 'passed'
    message: string
  }>
  copyStagingPlan: {
    stagingTables: string[]
    promoteRules: string[]
    pressureTargets: string[]
  }
  nextActions: string[]
}

export interface ScreenerSecurityStatusCoverageReport {
  schemaVersion: 'fams.market.security_status_coverage.v1'
  generatedAt: string
  status: 'not_started' | 'partial' | 'sufficient'
  providerPolicy: 'free_sources_primary_tushare_optional'
  canonicalTables: string[]
  requiredFields: string[]
  coverageSnapshot?: SecurityStatusCoverageSnapshot
  providerCandidates: Array<{
    provider: 'akshare' | 'baostock' | 'eastmoney' | 'exchange_public' | 'tushare'
    role: 'free_primary' | 'free_cross_check' | 'official_reference' | 'configurable_primary'
    configured: boolean
    confidence: 'high' | 'medium' | 'low' | 'unknown'
    limitations: string[]
  }>
  currentFallbacks: string[]
  gates: Array<{
    id: string
    status: 'passed' | 'failed' | 'warning'
    severity: 'blocker' | 'warning'
    message: string
  }>
  nextActions: string[]
}

export interface ScreenerValidationFailureTaxonomyReport {
  schemaVersion: 'fams.screener.validation_failure_taxonomy.v1'
  generatedAt: string
  status: 'blocked_for_trading' | 'needs_more_samples' | 'ready_for_manual_review'
  decision: ScreenerValidationDecision['decision']
  summary: {
    diagnosedCandidates: number
    failedCandidates: number
    passedCandidates: number
    globalFailureTags: string[]
  }
  failureClasses: Array<{
    id: string
    label: string
    severity: 'blocker' | 'warning'
    evidence: string[]
    recommendedAction: string
  }>
  candidateFailures: Array<{
    candidateId: string
    strategyId: ScreenerStrategyId
    oosStatus: 'passed' | 'failed' | 'insufficient'
    failureTags: string[]
    recommendedAction: 'OBSERVE_ONLY' | 'RESEARCH_ONLY'
  }>
  layeredValidation?: {
    status: ScreenerOosLayeredValidationReport['status']
    failedBuckets: number
    insufficientBuckets: number
  }
  nextActions: string[]
}

export interface ScreenerP5ClosureReviewReport {
  schemaVersion: 'fams.screener.p5_closure_review.v1'
  generatedAt: string
  phase: 'P5'
  status: 'partial' | 'blocked_for_production' | 'ready_for_next_phase'
  decision: 'CONTINUE_P5' | 'P5_COMPLETE_RESEARCH_ONLY' | 'READY_FOR_P6_REVIEW'
  summary: {
    postgresShadowStatus: ScreenerPostgresShadowReadinessReport['status']
    securityStatusCoverageStatus: ScreenerSecurityStatusCoverageReport['status']
    validationFailureTaxonomyStatus: ScreenerValidationFailureTaxonomyReport['status']
    p4Decision: ScreenerP4ClosureReviewReport['decision']
    productionReady: boolean
  }
  gates: Array<{
    id: string
    label: string
    status: 'passed' | 'failed' | 'warning'
    severity: 'blocker' | 'warning'
    sourceArtifact: string
    message: string
  }>
  completedEvidence: string[]
  remainingBlockers: string[]
  nextActions: string[]
  artifactRefs: string[]
}

export interface ScreenerOperationTaskUpdate {
  name: string
  chunkIndex?: number
  taskType?: string
  idempotencyKey?: string
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'partial'
  successCount?: number
  failureCount?: number
  provider?: string
  cacheHitRate?: number
  warnings?: string[]
  metrics?: Record<string, unknown>
  error?: unknown
}

export interface ScreenerFullScanOperationCallbacks {
  onTaskUpdate?: (update: ScreenerOperationTaskUpdate) => Promise<void>
  onProgress?: (progressPct: number, partial?: Record<string, unknown>) => Promise<void>
  isCancelled?: () => Promise<boolean>
}

interface ScreenerStrategyDefinition {
  id: ScreenerStrategyId
  name: string
  description: string
}

interface ScreenerExecutionPolicyVariant {
  id: string
  label: string
  entryMode: 't1_open' | 't1_close'
  entryLabel: string
  holdingDays: number
  exitMode: 'fixed_hold' | 'stop_take_profit' | 'trailing_stop'
  stopLossPercent?: number
  takeProfitPercent?: number
  trailingStopPercent?: number
  positionSizingMode: 'equal_notional' | 'volatility_scaled'
  positionSizingLabel: string
  regimeFilterMode: 'none' | 'avoid_high_volatility_chop'
  regimeFilterLabel: string
  blockedRegimes?: string[]
}

class StockScreenerService {
  private adviceDisclaimer = '以上内容仅为系统基于可用数据生成的投资辅助信息，不构成投资建议。请结合自身风险承受能力独立决策。'
  private readonly engineVersion = 'fams.screener.backtest.engine.v2'
  private readonly costModel = {
    commissionRate: 0.00025,
    minCommission: 5,
    stampDutySellRate: 0.0005,
    slippageRate: 0.0005,
  }
  private readonly marketConstraints = {
    excludeST: true,
    minListingDays: 60,
    minAmount: 5_000_000,
    limitUpCannotBuy: true,
    limitDownCannotSell: true,
    suspendedCannotTrade: true,
  }
  private readonly backtestNotional = 10000

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) return `[${value.map((item) => this.stableStringify(item)).join(',')}]`
    return `{${Object.keys(value as Record<string, unknown>).sort().map((key) =>
      `${JSON.stringify(key)}:${this.stableStringify((value as Record<string, unknown>)[key])}`
    ).join(',')}}`
  }

  private hashPayload(value: unknown) {
    return createHash('sha256').update(this.stableStringify(value)).digest('hex')
  }

  private buildVersionBundle(
    strategyId: ScreenerStrategyId,
    options: ScreenerOptions,
    executionPolicy: ScreenerExecutionPolicyVariant
  ): ScreenerTournamentVersionBundle {
    return {
      schemaVersion: 'fams.screener.tournament_candidate.v1',
      signalStrategy: {
        id: strategyId,
        version: 'builtin.v1',
        thresholdHash: this.hashPayload({ strategyId, thresholds: options.thresholds }),
      },
      entryPolicy: {
        id: executionPolicy.entryMode,
        version: executionPolicy.entryMode === 't1_close' ? 'entry.t1_close.v1' : 'entry.t1_open.v1',
      },
      exitPolicy: {
        id: executionPolicy.exitMode === 'trailing_stop'
          ? 'trailing_stop'
          : executionPolicy.exitMode === 'stop_take_profit'
            ? 'stop_take_profit'
            : 'hold_n_close',
        version: executionPolicy.exitMode === 'trailing_stop'
          ? 'exit.trailing_stop.v1'
          : executionPolicy.exitMode === 'stop_take_profit'
            ? 'exit.stop_take_profit.v1'
            : 'exit.hold_n.close.v1',
        holdingDays: executionPolicy.holdingDays,
        stopLossPercent: executionPolicy.stopLossPercent,
        takeProfitPercent: executionPolicy.takeProfitPercent,
        trailingStopPercent: executionPolicy.trailingStopPercent,
      },
      positionSizingPolicy: {
        id: executionPolicy.positionSizingMode,
        version: executionPolicy.positionSizingMode === 'volatility_scaled'
          ? 'sizing.volatility_scaled_notional.v1'
          : 'sizing.equal_notional.v1',
        notional: this.backtestNotional,
        minMultiplier: executionPolicy.positionSizingMode === 'volatility_scaled' ? 0.5 : undefined,
        maxMultiplier: executionPolicy.positionSizingMode === 'volatility_scaled' ? 1 : undefined,
        lookbackDays: executionPolicy.positionSizingMode === 'volatility_scaled' ? 20 : undefined,
      },
      portfolioPolicy: {
        id: 'single_signal_sample',
        version: 'portfolio.single_signal_sample.v1',
      },
      regimeFilterPolicy: {
        id: executionPolicy.regimeFilterMode,
        version: executionPolicy.regimeFilterMode === 'avoid_high_volatility_chop'
          ? 'regime_filter.local_price_window.avoid_high_volatility_chop.v1'
          : 'regime_filter.none.v1',
        blockedRegimes: executionPolicy.blockedRegimes || [],
        method: 'local_price_window_regime_v1',
        note: '当前 regime filter 基于标的自身近20日价格窗口，仅作为回测执行约束，不代表全市场状态。',
      },
      costModel: {
        id: 'cn_equity_cost',
        version: 'cost.cn_equity.v1',
        ...this.costModel,
      },
      marketConstraint: {
        id: 'cn_a_share_tradeability',
        version: 'constraint.cn_a_share_tradeability.v1',
        ...this.marketConstraints,
      },
      engine: {
        version: this.engineVersion,
      },
    }
  }

  private defaultThresholds: ScreenerThresholds = {
    drawdownPercent: 18,
    sidewaysRangePercent: 10,
    lastTwoVolumeRatio: 1.5,
    minHistoryDays: 22,
    reclaimVolumeRatio: 1.2,
  }

  private strategies: Record<ScreenerStrategyId, ScreenerStrategyDefinition> = {
    a_flush_sideways_volume: {
      id: 'a_flush_sideways_volume',
      name: 'A杀后横盘放量',
      description: '筛选经历前高回撤、近20个交易日横盘、最近两个交易日成交量明显放大的 A 股。',
    },
    volume_platform_breakout: {
      id: 'volume_platform_breakout',
      name: '放量突破平台',
      description: '筛选近20个交易日平台整理后，最新收盘价突破平台高点且成交量明显放大的 A 股。',
    },
    ma_reclaim: {
      id: 'ma_reclaim',
      name: '跌破后收复关键均线',
      description: '筛选经历阶段回撤后，前一交易日仍在20日均线下方、最新收盘重新站上20日均线且量能修复的 A 股。',
    },
  }

  private buildBacktestAssumptions(): ScreenerStrategyTournament['assumptions'] {
    return {
      schemaVersion: 'fams.screener.backtest.assumptions.v1',
      signalTiming: 'T日收盘后生成信号，不读取T+1及之后数据。',
      entryPolicy: '入场矩阵支持T+1交易日开盘价买入与T+1交易日收盘价买入；若停牌、涨停或流动性不足则不成交。',
      exitPolicy: '执行矩阵支持固定持有、止损止盈和移动止盈；若停牌或跌停则标记为未成交样本。',
      costModel: this.costModel,
      marketConstraints: this.marketConstraints,
      regimeFilters: {
        supportedModes: ['none', 'avoid_high_volatility_chop'],
        method: 'local_price_window_regime_v1',
        note: '高波动震荡过滤基于单标的近20日价格窗口；被过滤样本进入 blockedSamples，不能从审计样本中消失。',
      },
    }
  }

  private buildExecutionPolicyVariants(baseHoldingDays: number): ScreenerExecutionPolicyVariant[] {
    const normalizedBase = Math.max(1, Math.min(10, Math.floor(baseHoldingDays || 3)))
    const entryPolicies = [
      { entryMode: 't1_open' as const, entryLabel: 'T+1开盘买入' },
      { entryMode: 't1_close' as const, entryLabel: 'T+1收盘买入' },
    ]
    const positionSizingPolicies = [
      { positionSizingMode: 'equal_notional' as const, positionSizingLabel: '等额本金' },
      { positionSizingMode: 'volatility_scaled' as const, positionSizingLabel: '波动率缩放本金' },
    ]
    const noRegimeFilter = {
      regimeFilterMode: 'none' as const,
      regimeFilterLabel: '不过滤局部市场状态',
      blockedRegimes: [] as string[],
    }
    const avoidHighVolatilityChop = {
      regimeFilterMode: 'avoid_high_volatility_chop' as const,
      regimeFilterLabel: '高波动震荡不交易',
      blockedRegimes: ['高波动震荡'],
    }
    const rawHoldingDays = [
      { holdingDays: normalizedBase, label: `基准持有${normalizedBase}日` },
      { holdingDays: Math.max(1, normalizedBase - 1), label: `短持有${Math.max(1, normalizedBase - 1)}日` },
      { holdingDays: Math.min(10, normalizedBase + 2), label: `长持有${Math.min(10, normalizedBase + 2)}日` },
    ]
    const seen = new Set<number>()
    const exitPolicies = rawHoldingDays
      .filter((item) => {
        if (seen.has(item.holdingDays)) return false
        seen.add(item.holdingDays)
        return true
      })
      .flatMap((item) => [
        {
          id: `exit_h${item.holdingDays}`,
          label: item.label,
          holdingDays: item.holdingDays,
          exitMode: 'fixed_hold' as const,
        },
        {
          id: `exit_h${item.holdingDays}_sl5_tp10`,
          label: `${item.label}+止损5%止盈10%`,
          holdingDays: item.holdingDays,
          exitMode: 'stop_take_profit' as const,
          stopLossPercent: 5,
          takeProfitPercent: 10,
        },
        {
          id: `exit_h${item.holdingDays}_trail8`,
          label: `${item.label}+移动止盈8%`,
          holdingDays: item.holdingDays,
          exitMode: 'trailing_stop' as const,
          trailingStopPercent: 8,
        },
      ])
    const buildVariant = (
      entryPolicy: typeof entryPolicies[number],
      exitPolicy: typeof exitPolicies[number],
      positionSizingPolicy: typeof positionSizingPolicies[number],
      regimeFilterPolicy: typeof noRegimeFilter | typeof avoidHighVolatilityChop,
    ): ScreenerExecutionPolicyVariant => {
      const regimeSuffix = regimeFilterPolicy.regimeFilterMode === 'none'
        ? ''
        : `__regime_${regimeFilterPolicy.regimeFilterMode}`
      const regimeLabel = regimeFilterPolicy.regimeFilterMode === 'none'
        ? ''
        : ` + ${regimeFilterPolicy.regimeFilterLabel}`
      return {
        ...exitPolicy,
        ...positionSizingPolicy,
        ...regimeFilterPolicy,
        id: `entry_${entryPolicy.entryMode}__${exitPolicy.id}__size_${positionSizingPolicy.positionSizingMode}${regimeSuffix}`,
        label: `${entryPolicy.entryLabel} + ${exitPolicy.label} + ${positionSizingPolicy.positionSizingLabel}${regimeLabel}`,
        entryMode: entryPolicy.entryMode,
        entryLabel: entryPolicy.entryLabel,
      }
    }

    const baseVariants = entryPolicies.flatMap((entryPolicy) => exitPolicies.flatMap((exitPolicy) =>
      positionSizingPolicies.map((positionSizingPolicy) =>
        buildVariant(entryPolicy, exitPolicy, positionSizingPolicy, noRegimeFilter)
      )
    ))
    const regimeRetestVariants = baseVariants
      .filter((variant) =>
        variant.entryMode === 't1_open' &&
        variant.positionSizingMode === 'equal_notional' &&
        (variant.exitMode === 'fixed_hold' || variant.exitMode === 'stop_take_profit')
      )
      .map((variant) => ({
        ...variant,
        ...avoidHighVolatilityChop,
        id: `${variant.id}__regime_${avoidHighVolatilityChop.regimeFilterMode}`,
        label: `${variant.label} + ${avoidHighVolatilityChop.regimeFilterLabel}`,
      }))
    return [...baseVariants, ...regimeRetestVariants]
  }

  private normalizeStockUniverse(assets: ScreenableStockAsset[], includeDefaults = true) {
    const defaults = [
      { symbol: '601888', name: '中国中免', type: 'stock' },
      { symbol: '600519', name: '贵州茅台', type: 'stock' },
      { symbol: '000001', name: '平安银行', type: 'stock' },
      { symbol: '000651', name: '格力电器', type: 'stock' },
      { symbol: '300750', name: '宁德时代', type: 'stock' },
      { symbol: '002594', name: '比亚迪', type: 'stock' },
      { symbol: '600276', name: '恒瑞医药', type: 'stock' },
      { symbol: '601127', name: '赛力斯', type: 'stock' },
    ]
    const map = new Map<string, ScreenableStockAsset>()
    for (const item of [...assets, ...(includeDefaults ? defaults : [])]) {
      if (/^\d{6}$/.test(item.symbol) && item.type === 'stock') {
        map.set(item.symbol, item)
      }
    }
    return Array.from(map.values())
  }

  private normalizeIndustryBoard(value: unknown) {
    const raw = typeof value === 'string' ? value.trim() : ''
    if (!raw) return undefined
    const match = raw.match(/^(.+?)\s*[（(]([A-Z]{2}\d+)[）)]$/i)
    return {
      name: match ? match[1].trim() : raw,
      code: match ? match[2].trim().toUpperCase() : undefined,
    }
  }

  private numberFactValue(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
  }

  private async enrichUniverseWithCachedFundamentals(assets: ScreenableStockAsset[]) {
    const symbols = Array.from(new Set(assets.map((asset) => asset.symbol).filter(Boolean)))
    if (symbols.length === 0) return assets
    const quoteListSnapshots = await fundamentalDataProvider.getEastmoneyQuoteListSnapshots().catch(() => new Map())

    const caches = await prisma.stockFactSetCache.findMany({
      where: {
        symbol: { in: symbols },
        market: { in: ['A股', 'CN'] },
        factsetType: 'stock_full_analysis',
        factsetSchemaVersion: 'stock.analysis.factset.v1',
        status: { in: ['fresh', 'stale', 'partial'] },
      },
      orderBy: { generatedAt: 'desc' },
    })
    const latestBySymbol = new Map<string, typeof caches[number]>()
    for (const cache of caches) {
      const symbol = cache.symbol.toUpperCase()
      const existing = latestBySymbol.get(symbol)
      if (!existing || (!this.cacheHasScreenerCoverage(existing) && this.cacheHasScreenerCoverage(cache))) {
        latestBySymbol.set(symbol, cache)
      }
    }

    return assets.map((asset) => {
      const quoteSnapshot = quoteListSnapshots.get(asset.symbol)
      const quoteIndustry = this.normalizeIndustryBoard(quoteSnapshot?.industryName)
      const quoteTotalMarketCap = this.numberFactValue(quoteSnapshot?.totalMarketCap)
      const quoteFloatMarketCap = this.numberFactValue(quoteSnapshot?.floatMarketCap)
      const cache = latestBySymbol.get(asset.symbol.toUpperCase())
      if (!cache) {
        const hasQuoteFacts = Boolean(quoteIndustry || quoteTotalMarketCap || quoteFloatMarketCap)
        return {
          ...asset,
          officialIndustryGroup: quoteIndustry?.name || asset.officialIndustryGroup,
          officialIndustryCode: quoteIndustry?.code || asset.officialIndustryCode,
          totalMarketCap: quoteTotalMarketCap || asset.totalMarketCap,
          floatMarketCap: quoteFloatMarketCap || asset.floatMarketCap,
          peDynamic: quoteSnapshot?.peDynamic ?? asset.peDynamic,
          pb: quoteSnapshot?.pb ?? asset.pb,
          metadataProvider: hasQuoteFacts ? (quoteSnapshot?.source || 'fams_quote_list_canonical') : asset.metadataProvider,
          metadataAsOf: quoteSnapshot?.fetchedAt || asset.metadataAsOf,
          metadataWarnings: asset.metadataWarnings || [],
        }
      }
      const factSet = this.parseJson<{ fundamental?: { facts?: Array<{ id: string; value: unknown; asOf?: string | null; source?: string; quality?: string }> } } | null>(
        cache.factsJson,
        null
      )
      const facts = factSet?.fundamental?.facts || []
      const factById = new Map(facts.map((fact) => [fact.id, fact]))
      const industryBoard = this.normalizeIndustryBoard(factById.get('em_industry_board')?.value)
      const totalMarketCap = this.numberFactValue(factById.get('em_total_market_cap')?.value)
      const floatMarketCap = this.numberFactValue(factById.get('em_float_market_cap')?.value)
      const peDynamic = this.numberFactValue(factById.get('em_pe_dynamic')?.value)
      const pb = this.numberFactValue(factById.get('em_pb')?.value)
      const metadataWarnings: string[] = []
      if (cache.status !== 'fresh') metadataWarnings.push(`股票事实集缓存状态为 ${cache.status}，分组仅作审计参考`)
      if (!industryBoard && !quoteIndustry) metadataWarnings.push('股票事实集缓存和 quote-list canonical 均缺少行业板块')
      if (!totalMarketCap && !floatMarketCap && !quoteTotalMarketCap && !quoteFloatMarketCap) metadataWarnings.push('股票事实集缓存和 quote-list canonical 均缺少总市值/流通市值')
      const hasCacheFacts = Boolean(industryBoard || totalMarketCap || floatMarketCap)
      const hasQuoteFacts = Boolean(quoteIndustry || quoteTotalMarketCap || quoteFloatMarketCap)

      return {
        ...asset,
        officialIndustryGroup: industryBoard?.name || quoteIndustry?.name || asset.officialIndustryGroup,
        officialIndustryCode: industryBoard?.code || quoteIndustry?.code || asset.officialIndustryCode,
        totalMarketCap: totalMarketCap || quoteTotalMarketCap || asset.totalMarketCap,
        floatMarketCap: floatMarketCap || quoteFloatMarketCap || asset.floatMarketCap,
        peDynamic: peDynamic ?? quoteSnapshot?.peDynamic ?? asset.peDynamic,
        pb: pb ?? quoteSnapshot?.pb ?? asset.pb,
        metadataProvider: hasCacheFacts ? 'eastmoney_fundamental_cache' : hasQuoteFacts ? (quoteSnapshot?.source || 'fams_quote_list_canonical') : asset.metadataProvider,
        metadataAsOf: factById.get('em_industry_board')?.asOf || factById.get('em_total_market_cap')?.asOf || quoteSnapshot?.fetchedAt || cache.generatedAt.toISOString(),
        metadataWarnings: [...(asset.metadataWarnings || []), ...metadataWarnings],
      }
    })
  }

  private cacheHasScreenerCoverage(cache: { factsJson?: string | null }) {
    const factSet = this.parseJson<{ fundamental?: { facts?: Array<{ id: string; value: unknown; quality?: string }> } } | null>(
      cache.factsJson || '',
      null
    )
    const facts = factSet?.fundamental?.facts || []
    const factById = new Map(facts.map((fact) => [fact.id, fact]))
    const industryBoard = this.normalizeIndustryBoard(factById.get('em_industry_board')?.value)
    const totalMarketCap = this.numberFactValue(factById.get('em_total_market_cap')?.value)
    const floatMarketCap = this.numberFactValue(factById.get('em_float_market_cap')?.value)
    return Boolean(industryBoard && (totalMarketCap || floatMarketCap))
  }

  private buildFactsetPreheatCoverageReport(params: {
    universe: ScreenableStockAsset[]
    scanUniverse: ScreenableStockAsset[]
    initial?: unknown
    preheat?: unknown
  }) {
    const officialProviders = new Set(['eastmoney_fundamental_cache', 'fams_quote_list_canonical', 'eastmoney_quote_list_cache', 'eastmoney_quote_list'])
    const isOfficialProvider = (asset: ScreenableStockAsset) => officialProviders.has(asset.metadataProvider || '')
    const summarize = (assets: ScreenableStockAsset[]) => {
      const total = assets.length
      const officialIndustry = assets.filter((asset) => isOfficialProvider(asset) && Boolean(asset.officialIndustryGroup))
      const officialMarketCap = assets.filter((asset) => isOfficialProvider(asset) && Boolean(asset.totalMarketCap || asset.floatMarketCap))
      const fullyCovered = assets.filter((asset) =>
        isOfficialProvider(asset) &&
        Boolean(asset.officialIndustryGroup) &&
        Boolean(asset.totalMarketCap || asset.floatMarketCap)
      )
      const warningSymbols = assets.filter((asset) => (asset.metadataWarnings || []).length > 0)
      const providerSummary = Array.from(assets.reduce((map, asset) => {
        const provider = asset.metadataProvider || 'missing'
        map.set(provider, (map.get(provider) || 0) + 1)
        return map
      }, new Map<string, number>()).entries()).map(([provider, count]) => ({
        provider,
        count,
        ratioPercent: total > 0 ? Number(((count / total) * 100).toFixed(2)) : 0,
      }))

      return {
        total,
        officialIndustryCount: officialIndustry.length,
        officialIndustryCoveragePercent: total > 0 ? Number(((officialIndustry.length / total) * 100).toFixed(2)) : 0,
        officialMarketCapCount: officialMarketCap.length,
        officialMarketCapCoveragePercent: total > 0 ? Number(((officialMarketCap.length / total) * 100).toFixed(2)) : 0,
        fullOfficialCoverageCount: fullyCovered.length,
        fullOfficialCoveragePercent: total > 0 ? Number(((fullyCovered.length / total) * 100).toFixed(2)) : 0,
        warningCount: warningSymbols.length,
        providerSummary,
        missingIndustrySymbols: assets
          .filter((asset) => !asset.officialIndustryGroup)
          .slice(0, 50)
          .map((asset) => `${asset.symbol}:${asset.name}`),
        missingMarketCapSymbols: assets
          .filter((asset) => !asset.totalMarketCap && !asset.floatMarketCap)
          .slice(0, 50)
          .map((asset) => `${asset.symbol}:${asset.name}`),
      }
    }

    const scanned = summarize(params.scanUniverse)
    const full = summarize(params.universe)
    const warnings: string[] = []
    if (scanned.fullOfficialCoveragePercent < 80) {
      warnings.push(`扫描样本正式行业+市值覆盖率 ${scanned.fullOfficialCoveragePercent}% < 80%，分组稳定性会大量降级到代理规则`)
    }
    if (scanned.officialIndustryCoveragePercent < 80) {
      warnings.push(`扫描样本正式行业覆盖率 ${scanned.officialIndustryCoveragePercent}% < 80%，行业分组可信度不足`)
    }
    if (scanned.officialMarketCapCoveragePercent < 80) {
      warnings.push(`扫描样本正式市值覆盖率 ${scanned.officialMarketCapCoveragePercent}% < 80%，市值分组可信度不足`)
    }
    return {
      schemaVersion: 'fams.screener.factset_preheat_coverage.v1',
      generatedAt: new Date().toISOString(),
      provider: 'stock_factset_cache',
      requiredFacts: ['em_industry_board', 'em_total_market_cap', 'em_float_market_cap'],
      universe: full,
      scanned,
      initial: params.initial,
      preheat: params.preheat,
      warnings,
    }
  }

  private buildLongSampleAcceptanceReport(params: {
    options: ScreenerOptions
    universeSize: number
    universeSource: string
    universeTotal: number
    scannedCount: number
    evaluatedCount: number
    failureCount: number
    scanCoveragePercent: number
    providerSuccessRate: number
    cacheHitRate?: number
    tournament: ScreenerStrategyTournament
    factsetPreheatCoverage?: { scanned?: { fullOfficialCoveragePercent?: number } }
  }): ScreenerLongSampleAcceptanceReport {
    const best = params.tournament.ranked[0]
    const bestSampleSize = Math.max(...params.tournament.ranked.map((item) => item.sampleSize), 0)
    const validationPassedCount = params.tournament.ranked.filter((item) =>
      item.outOfSampleValidation.status === 'passed' &&
      item.walkForwardValidation.status === 'passed' &&
      item.parameterSensitivity.status === 'passed' &&
      item.groupStabilityValidation.status === 'passed'
    ).length
    const factsetCoverage = params.factsetPreheatCoverage?.scanned?.fullOfficialCoveragePercent ?? 0
    const cacheHitRate = params.cacheHitRate ?? 0
    const actualBacktestDays = params.tournament.evaluationDays || params.options.backtestDays
    const gate = (
      id: string,
      label: string,
      passed: boolean,
      actual: number | string | null,
      required: number | string,
      severity: 'blocker' | 'warning',
      message: string,
      insufficient = false
    ) => ({
      id,
      label,
      status: insufficient ? 'insufficient' as const : passed ? 'passed' as const : 'failed' as const,
      actual,
      required,
      severity,
      message,
    })
    const gates: ScreenerLongSampleAcceptanceReport['gates'] = [
      gate(
        'universe_source',
        '全A股票池来源',
        params.universeSource === 'sina_hs_a_all_a_share',
        params.universeSource,
        'sina_hs_a_all_a_share',
        'blocker',
        params.universeSource === 'sina_hs_a_all_a_share' ? '股票池来自全 A provider' : '股票池已降级到 fallback，不能代表全 A 样本'
      ),
      gate(
        'universe_coverage',
        '全A扫描覆盖',
        params.scanCoveragePercent >= 80,
        `${params.scanCoveragePercent}%`,
        '>= 80%',
        'blocker',
        params.scanCoveragePercent >= 80 ? '扫描覆盖达到长样本验收门槛' : '扫描覆盖不足，不能代表全 A 样本'
      ),
      gate(
        'provider_success_rate',
        '行情获取成功率',
        params.providerSuccessRate >= 95,
        `${params.providerSuccessRate}%`,
        '>= 95%',
        'blocker',
        params.providerSuccessRate >= 95 ? '行情获取成功率达标' : '行情失败率偏高，需要先处理 provider 或缓存缺口'
      ),
      gate(
        'cache_hit_rate',
        '历史行情缓存命中率',
        cacheHitRate >= 80,
        `${cacheHitRate}%`,
        '>= 80%',
        'warning',
        cacheHitRate >= 80 ? '缓存命中率可支撑可重复扫描' : '缓存命中率偏低，真实全 A 扫描会过度依赖外部 provider'
      ),
      gate(
        'backtest_window',
        '长窗口回测天数',
        actualBacktestDays >= 60,
        actualBacktestDays,
        '>= 60',
        'blocker',
        actualBacktestDays >= 60 ? '回测窗口达到长样本验收门槛' : '回测窗口仍是短窗，只能作为功能验收'
      ),
      gate(
        'trade_sample_size',
        '策略成交样本量',
        bestSampleSize >= 100,
        bestSampleSize,
        '>= 100',
        'blocker',
        bestSampleSize >= 100 ? '至少一个候选组合达到 medium 样本门槛' : '成交样本不足，不能形成高可信策略结论'
      ),
      gate(
        'validation_evidence',
        '稳定性验证',
        validationPassedCount > 0,
        validationPassedCount,
        '>= 1 个候选组合四项验证全部通过',
        'blocker',
        validationPassedCount > 0 ? '存在可进入候选研究的稳定组合' : '样本外、walk-forward、参数敏感性或分组稳定性仍未全部通过',
        params.tournament.ranked.length === 0
      ),
      gate(
        'factset_coverage',
        '事实集覆盖',
        factsetCoverage >= 80,
        `${factsetCoverage}%`,
        '>= 80%',
        'warning',
        factsetCoverage >= 80 ? '行业/市值事实集覆盖可支撑分组审计' : '行业/市值事实集覆盖不足，分组结论需要降级'
      ),
    ]
    const blockers = gates.filter((item) => item.severity === 'blocker' && item.status !== 'passed')
    const warnings = gates.filter((item) => item.severity === 'warning' && item.status !== 'passed')
    const recommendations: string[] = []
    if (blockers.length > 0) recommendations.push('本次扫描不得作为高可信全 A 长样本结论，只能作为功能验收或候选观察。')
    if (params.scanCoveragePercent < 80) recommendations.push('扩大扫描上限或使用全 A universe，并优先依赖本地 canonical K 线缓存。')
    if (params.providerSuccessRate < 95) recommendations.push('先处理行情 provider 失败、超时或缓存缺口，再重复长样本验收。')
    if (actualBacktestDays < 60) recommendations.push('将回测天数提高到至少 60 个交易日；用于 high 可信评级时继续扩展到多年窗口。')
    if (bestSampleSize < 100) recommendations.push('当前策略信号密度不足，应扩大时间窗口或只保留观察结论，不进入加仓建议。')
    if (warnings.length > 0) recommendations.push('warning 项不会阻断功能验收，但会降低策略可信评级和持仓建议权重。')
    if (recommendations.length === 0) recommendations.push('本次长样本验收通过，可进入人工复核和持仓建议证据联动。')

    return {
      schemaVersion: 'fams.screener.long_sample_acceptance.v1',
      generatedAt: new Date().toISOString(),
      status: blockers.length > 0 ? 'insufficient' : 'passed',
      summary: {
        universeSize: params.universeSize,
        universeSource: params.universeSource,
        universeTotal: params.universeTotal,
        scannedCount: params.scannedCount,
        evaluatedCount: params.evaluatedCount,
        failureCount: params.failureCount,
        scanCoveragePercent: params.scanCoveragePercent,
        providerSuccessRate: params.providerSuccessRate,
        cacheHitRate,
        backtestDays: actualBacktestDays,
        rankedCandidates: params.tournament.ranked.length,
        bestSampleSize,
        bestCredibility: best?.credibility.rating || 'unknown',
      },
      gates,
      topCandidates: params.tournament.ranked.slice(0, 10).map((item) => ({
        candidateId: item.candidateId,
        strategyId: item.strategyId,
        sampleSize: item.sampleSize,
        tradeCount: item.tradeCount,
        credibility: item.credibility.rating,
        excessReturnPercent: item.excessReturnPercent,
        outOfSampleStatus: item.outOfSampleValidation.status,
        walkForwardStatus: item.walkForwardValidation.status,
        parameterSensitivityStatus: item.parameterSensitivity.status,
        groupStabilityStatus: item.groupStabilityValidation.status,
      })),
      recommendations,
    }
  }

  private buildOutOfSampleDiagnostics(params: {
    tournament: ScreenerStrategyTournament
    factsetPreheatCoverage?: { scanned?: { fullOfficialCoveragePercent?: number } }
  }) {
    const diagnosed = params.tournament.ranked
      .filter((item) => item.outOfSampleValidation.status !== 'insufficient')
      .slice(0, 10)
      .map((item) => {
        const validation = item.outOfSampleValidation
        const train = validation.train
        const outOfSample = validation.outOfSample
        const excessDeterioration = train.excessReturnPercent !== null && outOfSample.excessReturnPercent !== null
          ? Number((outOfSample.excessReturnPercent - train.excessReturnPercent).toFixed(2))
          : null
        const averageReturnDeterioration = train.averageReturnPercent !== null && outOfSample.averageReturnPercent !== null
          ? Number((outOfSample.averageReturnPercent - train.averageReturnPercent).toFixed(2))
          : null
        const failedReasons: string[] = []
        if (outOfSample.sampleSize < 10) failedReasons.push('样本外窗口交易数不足')
        if ((outOfSample.excessReturnPercent ?? 0) <= 0) failedReasons.push('样本外超额收益不为正')
        if (excessDeterioration !== null && excessDeterioration < 0) failedReasons.push('样本外超额收益低于训练窗口')
        if (averageReturnDeterioration !== null && averageReturnDeterioration < 0) failedReasons.push('样本外平均收益低于训练窗口')
        if (item.walkForwardValidation.status === 'passed' && item.parameterSensitivity.status === 'passed' && item.groupStabilityValidation.status === 'passed') {
          failedReasons.push('非横截面稳定性问题，优先检查时间切分和市场状态切换')
        }
        return {
          candidateId: item.candidateId,
          strategyId: item.strategyId,
          name: item.name,
          executionPolicy: item.executionPolicy,
          credibility: item.credibility.rating,
          sampleSize: item.sampleSize,
          tradeCount: item.tradeCount,
          excessReturnPercent: item.excessReturnPercent,
          outOfSampleStatus: validation.status,
          train,
          outOfSample,
          excessDeterioration,
          averageReturnDeterioration,
          walkForwardStatus: item.walkForwardValidation.status,
          parameterSensitivityStatus: item.parameterSensitivity.status,
          groupStabilityStatus: item.groupStabilityValidation.status,
          warnings: validation.warnings,
          failedReasons,
          recommendation: validation.status === 'passed'
            ? '样本外验证通过，可继续结合 factset coverage 和持仓约束复核。'
            : '不得进入加仓建议；下一步应复核样本外窗口日期、市场状态、行业/市值覆盖和参数过拟合。'
        }
      })
    const passedCount = diagnosed.filter((item) => item.outOfSampleStatus === 'passed').length
    const failedCount = diagnosed.filter((item) => item.outOfSampleStatus === 'failed').length
    const factsetCoverage = params.factsetPreheatCoverage?.scanned?.fullOfficialCoveragePercent ?? 0
    const globalFindings: string[] = []
    if (diagnosed.length === 0) globalFindings.push('没有可诊断的样本外验证结果。')
    if (failedCount > 0 && passedCount === 0) globalFindings.push('已深度验证候选均未通过样本外验证，当前策略证据不得进入交易建议。')
    if (factsetCoverage < 80) globalFindings.push(`事实集覆盖 ${factsetCoverage}% < 80%，行业/市值分组解释需要降级。`)
    if (diagnosed.some((item) => item.walkForwardStatus === 'passed' && item.parameterSensitivityStatus === 'passed' && item.groupStabilityStatus === 'passed' && item.outOfSampleStatus === 'failed')) {
      globalFindings.push('存在 walk-forward、参数敏感性、分组稳定性通过但样本外失败的候选，优先诊断时间切分窗口和近期市场状态变化。')
    }
    return {
      schemaVersion: 'fams.screener.oos_diagnostics.v1',
      generatedAt: new Date().toISOString(),
      batchId: params.tournament.batchId || null,
      evaluationDays: params.tournament.evaluationDays,
      diagnosedCandidates: diagnosed.length,
      passedCount,
      failedCount,
      insufficientCount: params.tournament.ranked.filter((item) => item.outOfSampleValidation.status === 'insufficient').length,
      factsetCoverage,
      globalFindings,
      candidates: diagnosed,
    }
  }

  private percentileSorted(sortedValues: number[], percentile: number) {
    if (sortedValues.length === 0) return null
    const clamped = Math.min(1, Math.max(0, percentile))
    const index = Math.min(sortedValues.length - 1, Math.max(0, Math.floor((sortedValues.length - 1) * clamped)))
    return Number(sortedValues[index].toFixed(2))
  }

  private buildReturnDistribution(outcomes: ScreenerBacktestOutcome[]): ScreenerReturnDistribution {
    const values = outcomes
      .map((sample) => sample.returnPercent)
      .filter((value) => Number.isFinite(value))
      .sort((a, b) => a - b)
    const sampleSize = values.length
    if (sampleSize === 0) {
      return {
        sampleSize: 0,
        winRatePercent: null,
        averageReturnPercent: null,
        medianReturnPercent: null,
        p25ReturnPercent: null,
        p75ReturnPercent: null,
        tailLossP95Percent: null,
        bestReturnPercent: null,
        worstReturnPercent: null,
        positiveCount: 0,
        negativeCount: 0,
      }
    }
    const positiveCount = values.filter((value) => value > 0).length
    const negativeCount = values.filter((value) => value < 0).length
    const average = values.reduce((sum, value) => sum + value, 0) / sampleSize
    return {
      sampleSize,
      winRatePercent: Number(((positiveCount / sampleSize) * 100).toFixed(2)),
      averageReturnPercent: Number(average.toFixed(2)),
      medianReturnPercent: this.percentileSorted(values, 0.5),
      p25ReturnPercent: this.percentileSorted(values, 0.25),
      p75ReturnPercent: this.percentileSorted(values, 0.75),
      tailLossP95Percent: this.percentileSorted(values, 0.05),
      bestReturnPercent: Number(values[values.length - 1].toFixed(2)),
      worstReturnPercent: Number(values[0].toFixed(2)),
      positiveCount,
      negativeCount,
    }
  }

  private buildSignalDateDistribution(outcomes: ScreenerBacktestOutcome[]) {
    const grouped = new Map<string, number>()
    for (const sample of outcomes) {
      const date = sample.signalDate || 'unknown'
      grouped.set(date, (grouped.get(date) || 0) + 1)
    }
    return Array.from(grouped.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, count]) => ({ date, count }))
  }

  private splitSamplesForOutOfSampleAnalysis(samples: ScreenerBacktestOutcome[]) {
    const sorted = [...samples]
      .filter((sample) => !sample.blockedReason)
      .sort((left, right) => (left.signalDate || '').localeCompare(right.signalDate || ''))
    if (sorted.length < 2) return { trainSamples: sorted, outOfSampleSamples: [] }
    const splitIndex = Math.min(sorted.length - 1, Math.max(1, Math.floor(sorted.length * 0.7)))
    return {
      trainSamples: sorted.slice(0, splitIndex),
      outOfSampleSamples: sorted.slice(splitIndex),
    }
  }

  private buildOosFailureAnalysis(params: {
    tournament: ScreenerStrategyTournament
    outOfSampleDiagnostics: {
      diagnosedCandidates: number
      passedCount: number
      failedCount: number
    }
    outOfSampleMarketStateDiagnostics?: {
      globalFindings?: string[]
    }
  }): ScreenerOosFailureAnalysis {
    const marketFindings = params.outOfSampleMarketStateDiagnostics?.globalFindings || []
    const candidates = params.tournament.ranked.slice(0, 10).map((item) => {
      const { trainSamples, outOfSampleSamples } = this.splitSamplesForOutOfSampleAnalysis(item.samples)
      const trainDistribution = this.buildReturnDistribution(trainSamples)
      const outOfSampleDistribution = this.buildReturnDistribution(outOfSampleSamples)
      const validation = item.outOfSampleValidation
      const deterioration = {
        excessReturnDelta: validation.train.excessReturnPercent !== null && validation.outOfSample.excessReturnPercent !== null
          ? Number((validation.outOfSample.excessReturnPercent - validation.train.excessReturnPercent).toFixed(2))
          : null,
        averageReturnDelta: validation.train.averageReturnPercent !== null && validation.outOfSample.averageReturnPercent !== null
          ? Number((validation.outOfSample.averageReturnPercent - validation.train.averageReturnPercent).toFixed(2))
          : null,
        medianReturnDelta: trainDistribution.medianReturnPercent !== null && outOfSampleDistribution.medianReturnPercent !== null
          ? Number((outOfSampleDistribution.medianReturnPercent - trainDistribution.medianReturnPercent).toFixed(2))
          : null,
        winRateDelta: trainDistribution.winRatePercent !== null && outOfSampleDistribution.winRatePercent !== null
          ? Number((outOfSampleDistribution.winRatePercent - trainDistribution.winRatePercent).toFixed(2))
          : null,
      }
      const failureTags: string[] = []
      if (validation.status === 'failed') failureTags.push('validation_failed')
      if (validation.status === 'insufficient') failureTags.push('oos_sample_insufficient')
      if ((validation.outOfSample.excessReturnPercent ?? 0) <= 0) failureTags.push('oos_excess_non_positive')
      if ((deterioration.excessReturnDelta ?? 0) < 0) failureTags.push('oos_excess_decay')
      if ((deterioration.averageReturnDelta ?? 0) < 0) failureTags.push('oos_average_return_decay')
      if ((deterioration.medianReturnDelta ?? 0) < 0) failureTags.push('oos_median_return_decay')
      if ((deterioration.winRateDelta ?? 0) < 0) failureTags.push('oos_win_rate_decay')
      if (marketFindings.some((finding) => finding.includes('切换'))) failureTags.push('market_regime_shift')
      if (outOfSampleDistribution.tailLossP95Percent !== null && outOfSampleDistribution.tailLossP95Percent < -5) failureTags.push('oos_tail_loss')
      return {
        candidateId: item.candidateId,
        strategyId: item.strategyId,
        name: item.name,
        credibility: item.credibility.rating,
        oosStatus: validation.status,
        train: validation.train,
        outOfSample: validation.outOfSample,
        trainDistribution,
        outOfSampleDistribution,
        deterioration,
        signalDateDistribution: {
          train: this.buildSignalDateDistribution(trainSamples),
          outOfSample: this.buildSignalDateDistribution(outOfSampleSamples),
        },
        failureTags: Array.from(new Set(failureTags)),
        recommendedAction: validation.status === 'passed' ? 'RESEARCH_ONLY' as const : 'OBSERVE_ONLY' as const,
      }
    })
    const passedCount = candidates.filter((item) => item.oosStatus === 'passed').length
    const failedCount = candidates.filter((item) => item.oosStatus === 'failed').length
    const globalFailureTags = Array.from(new Set(candidates.flatMap((item) => item.failureTags)))
    const globalConclusion = failedCount > 0 && passedCount === 0
      ? '已验证候选在样本外窗口全部失败，P4.34 保持交易建议阻断。'
      : passedCount > 0
        ? '存在样本外通过候选，但仍需结合 validation_decision gate 和持仓约束。'
        : '样本外样本不足，当前只能作为研究观察证据。'
    return {
      schemaVersion: 'fams.screener.oos_failure_analysis.v1',
      generatedAt: new Date().toISOString(),
      batchId: params.tournament.batchId || null,
      evaluationDays: params.tournament.evaluationDays,
      diagnosedCandidates: candidates.length,
      passedCount,
      failedCount,
      globalConclusion,
      globalFailureTags,
      candidates,
    }
  }

  private buildOosLayeredValidationReport(params: {
    tournament: ScreenerStrategyTournament
  }): ScreenerOosLayeredValidationReport {
    const dimensions: ScreenerOosLayeredValidationReport['dimensions'] = [
      { dimension: 'market_regime', label: '市场状态', buckets: [] },
      { dimension: 'industry_group', label: '行业分组', buckets: [] },
      { dimension: 'market_cap_group', label: '市值分组', buckets: [] },
    ]
    const dimensionValue = (sample: ScreenerBacktestOutcome, dimension: ScreenerOosLayeredValidationReport['dimensions'][number]['dimension']) => {
      if (dimension === 'market_regime') return sample.marketRegime || '未识别'
      if (dimension === 'industry_group') return sample.industryGroup || '未识别'
      return sample.marketCapGroup || '未识别'
    }
    const candidates = params.tournament.ranked
      .filter((item) => item.outOfSampleValidation.status !== 'insufficient')
      .slice(0, 10)
    for (const dimension of dimensions) {
      const grouped = new Map<string, { train: ScreenerBacktestOutcome[]; oos: ScreenerBacktestOutcome[]; candidates: Set<string> }>()
      for (const candidate of candidates) {
        const split = this.splitSamplesForOutOfSampleAnalysis(candidate.samples)
        for (const sample of split.trainSamples) {
          const key = dimensionValue(sample, dimension.dimension)
          const current = grouped.get(key) || { train: [], oos: [], candidates: new Set<string>() }
          current.train.push(sample)
          current.candidates.add(candidate.candidateId)
          grouped.set(key, current)
        }
        for (const sample of split.outOfSampleSamples) {
          const key = dimensionValue(sample, dimension.dimension)
          const current = grouped.get(key) || { train: [], oos: [], candidates: new Set<string>() }
          current.oos.push(sample)
          current.candidates.add(candidate.candidateId)
          grouped.set(key, current)
        }
      }
      dimension.buckets = Array.from(grouped.entries())
        .map(([key, value]) => {
          const train = this.buildReturnDistribution(value.train)
          const outOfSample = this.buildReturnDistribution(value.oos)
          const deterioration = {
            averageReturnDelta: train.averageReturnPercent !== null && outOfSample.averageReturnPercent !== null
              ? Number((outOfSample.averageReturnPercent - train.averageReturnPercent).toFixed(2))
              : null,
            medianReturnDelta: train.medianReturnPercent !== null && outOfSample.medianReturnPercent !== null
              ? Number((outOfSample.medianReturnPercent - train.medianReturnPercent).toFixed(2))
              : null,
            winRateDelta: train.winRatePercent !== null && outOfSample.winRatePercent !== null
              ? Number((outOfSample.winRatePercent - train.winRatePercent).toFixed(2))
              : null,
          }
          const warnings: string[] = []
          if (outOfSample.sampleSize < 10) warnings.push('样本外分层样本数不足 10。')
          if ((outOfSample.averageReturnPercent ?? 0) <= 0) warnings.push('样本外分层平均收益不为正。')
          if ((deterioration.averageReturnDelta ?? 0) < 0) warnings.push('样本外分层平均收益低于训练窗口。')
          const status: 'passed' | 'failed' | 'insufficient' = outOfSample.sampleSize < 10
            ? 'insufficient'
            : warnings.length === 0
              ? 'passed'
              : 'failed'
          return {
            key,
            label: key,
            candidateCount: value.candidates.size,
            train,
            outOfSample,
            deterioration,
            status,
            warnings,
          }
        })
        .sort((left, right) => right.outOfSample.sampleSize - left.outOfSample.sampleSize || left.key.localeCompare(right.key))
        .slice(0, 20)
    }
    const buckets = dimensions.flatMap((dimension) => dimension.buckets)
    const passedBuckets = buckets.filter((item) => item.status === 'passed').length
    const failedBuckets = buckets.filter((item) => item.status === 'failed').length
    const insufficientBuckets = buckets.filter((item) => item.status === 'insufficient').length
    const findings = [
      ...(failedBuckets > 0 ? [`${failedBuckets} 个分层桶样本外失败，不能解除交易建议阻断。`] : []),
      ...(insufficientBuckets > 0 ? [`${insufficientBuckets} 个分层桶样本外样本不足，需要更长窗口或更多候选。`] : []),
      ...(passedBuckets > 0 ? [`${passedBuckets} 个分层桶通过，仅可作为研究观察证据。`] : []),
      ...(buckets.length === 0 ? ['没有可分层复验的样本外交易样本。'] : []),
    ]
    return {
      schemaVersion: 'fams.screener.oos_layered_validation.v1',
      generatedAt: new Date().toISOString(),
      batchId: params.tournament.batchId || null,
      status: buckets.length === 0
        ? 'insufficient'
        : failedBuckets > 0 || insufficientBuckets > 0
          ? 'completed_with_blockers'
          : 'passed',
      method: 'chronological_70_30_split_by_regime_industry_market_cap',
      summary: {
        diagnosedCandidates: candidates.length,
        dimensions: dimensions.length,
        buckets: buckets.length,
        passedBuckets,
        failedBuckets,
        insufficientBuckets,
      },
      dimensions,
      findings,
      nextActions: [
        '保持参数冻结，先复验失败分层桶的市场状态、行业和市值暴露。',
        '若分层桶样本不足，扩大历史窗口或降低策略晋级等级，不得用调参绕过 OOS。',
        '只有分层 OOS、walk-forward、参数敏感性和分组稳定性同时通过，才允许进入人工交易计划复核。',
      ],
    }
  }

  private buildValidationEvidenceMatrixReport(params: {
    tournament: ScreenerStrategyTournament
    longSampleAcceptance: ScreenerLongSampleAcceptanceReport
  }): ScreenerValidationEvidenceMatrixReport {
    const candidates = params.tournament.ranked.slice(0, 20).map((item) => {
      const validation = {
        outOfSample: item.outOfSampleValidation.status,
        walkForward: item.walkForwardValidation.status,
        parameterSensitivity: item.parameterSensitivity.status,
        groupStability: item.groupStabilityValidation.status,
        allPassed: item.outOfSampleValidation.status === 'passed'
          && item.walkForwardValidation.status === 'passed'
          && item.parameterSensitivity.status === 'passed'
          && item.groupStabilityValidation.status === 'passed',
      }
      const failedChecks: ScreenerValidationEvidenceMatrixReport['candidates'][number]['failedChecks'] = []
      if (validation.outOfSample !== 'passed') failedChecks.push('out_of_sample')
      if (validation.walkForward !== 'passed') failedChecks.push('walk_forward')
      if (validation.parameterSensitivity !== 'passed') failedChecks.push('parameter_sensitivity')
      if (validation.groupStability !== 'passed') failedChecks.push('group_stability')

      const train = item.outOfSampleValidation.train
      const out = item.outOfSampleValidation.outOfSample
      const excessReturnDelta = train.excessReturnPercent !== null && out.excessReturnPercent !== null
        ? Number((out.excessReturnPercent - train.excessReturnPercent).toFixed(2))
        : null
      const averageReturnDelta = train.averageReturnPercent !== null && out.averageReturnPercent !== null
        ? Number((out.averageReturnPercent - train.averageReturnPercent).toFixed(2))
        : null
      const blockerTags: string[] = []
      if (validation.allPassed) blockerTags.push('all_validation_passed')
      if (validation.outOfSample === 'failed') blockerTags.push('oos_failed')
      if (validation.outOfSample === 'insufficient') blockerTags.push('oos_insufficient')
      if ((out.excessReturnPercent ?? 0) <= 0) blockerTags.push('oos_excess_non_positive')
      if (excessReturnDelta !== null && excessReturnDelta < 0) blockerTags.push('oos_excess_decay')
      if (averageReturnDelta !== null && averageReturnDelta < 0) blockerTags.push('oos_average_return_decay')
      if (validation.walkForward === 'failed') blockerTags.push('walk_forward_unstable')
      if (validation.walkForward === 'insufficient') blockerTags.push('walk_forward_insufficient')
      if (validation.parameterSensitivity === 'failed') blockerTags.push('parameter_sensitive')
      if (validation.parameterSensitivity === 'insufficient') blockerTags.push('parameter_sample_insufficient')
      if (validation.groupStability === 'failed') blockerTags.push('group_unstable')
      if (validation.groupStability === 'insufficient') blockerTags.push('group_sample_insufficient')
      if (item.sampleSize < 100 || item.tradeCount < 30) blockerTags.push('sample_size_watch')

      let actionClass: ScreenerValidationEvidenceMatrixReport['candidates'][number]['actionClass'] = 'observe_only'
      let nextAction = '保持观察池，不进入交易建议；等待后续稳定性复验。'
      if (validation.allPassed) {
        actionClass = 'eligible_manual_review'
        nextAction = '可进入人工交易计划复核；仍不得自动交易。'
      } else if (failedChecks.every((check) => check === 'out_of_sample') && item.outOfSampleValidation.status === 'failed') {
        actionClass = 'regime_retest'
        nextAction = '优先做市场状态分层 OOS 和多窗口 OOS；只允许在通过的市场状态下进入人工复核。'
      } else if (validation.parameterSensitivity === 'failed') {
        actionClass = 'parameter_retest'
        nextAction = '复核参数敏感性，若仅单点阈值有效则降级为观察或淘汰。'
      } else if (validation.groupStability === 'failed') {
        actionClass = 'group_retest'
        nextAction = '复核行业、市值和市场状态分组，限制适用范围或降级。'
      } else if (failedChecks.some((check) => {
        const status = check === 'out_of_sample'
          ? validation.outOfSample
          : check === 'walk_forward'
            ? validation.walkForward
            : check === 'parameter_sensitivity'
              ? validation.parameterSensitivity
              : validation.groupStability
        return status === 'insufficient'
      })) {
        actionClass = 'needs_more_samples'
        nextAction = '样本不足，扩大历史窗口或等待更多交易日后复验。'
      } else if (failedChecks.length >= 3) {
        actionClass = 'retire_candidate'
        nextAction = '多项稳定性失败，建议从交易建议候选中淘汰，仅保留审计记录。'
      }

      return {
        candidateId: item.candidateId,
        strategyId: item.strategyId,
        name: item.name,
        executionPolicy: item.executionPolicy,
        sampleSize: item.sampleSize,
        tradeCount: item.tradeCount,
        credibility: item.credibility.rating,
        averageReturnPercent: item.averageReturnPercent,
        excessReturnPercent: item.excessReturnPercent,
        maxDrawdownPercent: item.maxDrawdownPercent,
        validation,
        oos: {
          trainExcessReturnPercent: train.excessReturnPercent,
          outExcessReturnPercent: out.excessReturnPercent,
          excessReturnDelta,
          trainAverageReturnPercent: train.averageReturnPercent,
          outAverageReturnPercent: out.averageReturnPercent,
          averageReturnDelta,
          trainSampleSize: train.sampleSize,
          outSampleSize: out.sampleSize,
        },
        failedChecks,
        blockerTags: Array.from(new Set(blockerTags)),
        actionClass,
        nextAction,
      }
    })
    const passedCandidates = candidates.filter((item) => item.validation.allPassed).length
    const failedCandidates = candidates.filter((item) => item.failedChecks.some((check) => {
      if (check === 'out_of_sample') return item.validation.outOfSample === 'failed'
      if (check === 'walk_forward') return item.validation.walkForward === 'failed'
      if (check === 'parameter_sensitivity') return item.validation.parameterSensitivity === 'failed'
      return item.validation.groupStability === 'failed'
    })).length
    const insufficientCandidates = candidates.filter((item) => item.failedChecks.some((check) => {
      if (check === 'out_of_sample') return item.validation.outOfSample === 'insufficient'
      if (check === 'walk_forward') return item.validation.walkForward === 'insufficient'
      if (check === 'parameter_sensitivity') return item.validation.parameterSensitivity === 'insufficient'
      return item.validation.groupStability === 'insufficient'
    })).length
    const primaryBlocker = (() => {
      if (passedCandidates > 0) return 'none' as const
      const counts = {
        out_of_sample: candidates.filter((item) => item.failedChecks.includes('out_of_sample')).length,
        walk_forward: candidates.filter((item) => item.failedChecks.includes('walk_forward')).length,
        parameter_sensitivity: candidates.filter((item) => item.failedChecks.includes('parameter_sensitivity')).length,
        group_stability: candidates.filter((item) => item.failedChecks.includes('group_stability')).length,
        insufficient_samples: insufficientCandidates,
      }
      const entries = Object.entries(counts).sort((left, right) => right[1] - left[1])
      return (entries[0]?.[1] || 0) > 0
        ? entries[0][0] as ScreenerValidationEvidenceMatrixReport['summary']['primaryBlocker']
        : 'none'
    })()
    const validationGate = params.longSampleAcceptance.gates.find((gate) => gate.id === 'validation_evidence')

    return {
      schemaVersion: 'fams.screener.validation_evidence_matrix.v1',
      generatedAt: new Date().toISOString(),
      status: passedCandidates > 0 ? 'passed' : 'blocked',
      decision: passedCandidates > 0 ? 'READY_FOR_MANUAL_REVIEW' : 'OBSERVE_ONLY',
      batchId: params.tournament.batchId || null,
      evaluationDays: params.tournament.evaluationDays,
      summary: {
        rankedCandidates: params.tournament.ranked.length,
        diagnosedCandidates: candidates.length,
        passedCandidates,
        failedCandidates,
        insufficientCandidates,
        primaryBlocker,
      },
      candidates,
      closurePlan: [
        validationGate?.status === 'passed'
          ? 'validation_evidence gate 已通过；进入人工交易计划复核前仍需人工确认交易约束。'
          : 'validation_evidence gate 未通过；所有候选保持 OBSERVE_ONLY。',
        '优先处理 actionClass=regime_retest 的候选：做市场状态分层 OOS、多窗口 OOS 和近期高波动窗口复验。',
        'actionClass=parameter_retest 的候选不得用单点阈值放行，必须证明参数邻域稳定。',
        'actionClass=group_retest 的候选只能在通过的行业/市值/市场状态桶内保留研究价值。',
        'actionClass=retire_candidate 的候选从交易建议候选池移除，只保留审计记录。',
      ],
    }
  }

  private buildStrategyFailureMatrixReport(params: {
    tournament: ScreenerStrategyTournament
    validationEvidenceMatrix: ScreenerValidationEvidenceMatrixReport
    oosMultiWindowRegimeRetest?: ScreenerOosMultiWindowRegimeRetestReport
  }): ScreenerStrategyFailureMatrixReport {
    const retestById = new Map((params.oosMultiWindowRegimeRetest?.candidates || []).map((item) => [item.candidateId, item]))
    const tournamentById = new Map(params.tournament.ranked.map((item) => [item.candidateId, item]))
    const evidenceRefs = [
      'validation_evidence_matrix.json',
      'out_of_sample_validation.json',
      'walk_forward_validation.json',
      'parameter_sensitivity.json',
      'group_stability_report.json',
      'oos_multi_window_regime_retest.json',
    ]
    const candidates = params.validationEvidenceMatrix.candidates.map((candidate) => {
      const tournamentCandidate = tournamentById.get(candidate.candidateId)
      const retest = retestById.get(candidate.candidateId)
      const affectedRegimes = Array.from(new Set([
        ...(retest?.regimeBuckets || [])
          .filter((bucket) => bucket.status !== 'passed')
          .map((bucket) => bucket.regime),
        ...(tournamentCandidate?.samples || [])
          .map((sample) => sample.marketRegime)
          .filter((item): item is string => Boolean(item)),
      ])).slice(0, 8)
      const failedReason = candidate.validation.allPassed
        ? '四项验证通过，可进入人工复核候选，但仍禁止自动交易。'
        : candidate.blockerTags.length > 0
          ? candidate.blockerTags.join(', ')
          : candidate.failedChecks.join(', ') || 'validation_evidence_not_ready'
      const consecutiveOosFailed = (retest?.windows || []).filter((window) => window.status === 'failed').length >= 2
      let queue: ScreenerStrategyFailureMatrixReport['candidates'][number]['queue'] = 'retest_queue'
      let recommendation: ScreenerStrategyFailureMatrixReport['candidates'][number]['recommendation'] = 'retest'
      if (candidate.validation.allPassed) {
        queue = 'manual_review_queue'
        recommendation = 'retest'
      } else if (consecutiveOosFailed) {
        queue = 'retire_queue'
        recommendation = 'retire'
      } else if (candidate.actionClass === 'needs_more_samples') {
        queue = 'expand_sample_queue'
        recommendation = 'retest'
      } else if (candidate.actionClass === 'regime_retest' || retest?.conclusion === 'regime_limited_candidate') {
        queue = 'regime_specific_queue'
        recommendation = 'narrow_scope'
      } else if (candidate.actionClass === 'retire_candidate' || retest?.conclusion === 'retire_candidate' || candidate.failedChecks.length >= 3) {
        queue = 'retire_queue'
        recommendation = 'retire'
      } else if (candidate.failedChecks.includes('parameter_sensitivity')) {
        queue = 'retest_queue'
        recommendation = 'retest'
      }
      if (
        params.validationEvidenceMatrix.summary.passedCandidates === 0
        && params.validationEvidenceMatrix.summary.failedCandidates > 0
        && candidate.failedChecks.includes('out_of_sample')
        && candidate.failedChecks.includes('parameter_sensitivity')
      ) {
        recommendation = 'requires_new_strategy_family'
      }
      return {
        candidateId: candidate.candidateId,
        strategyId: candidate.strategyId,
        name: candidate.name,
        failedChecks: candidate.failedChecks,
        failedReason,
        sampleSize: candidate.sampleSize,
        tradeCount: candidate.tradeCount,
        affectedRegimes,
        parameterSensitivityStatus: candidate.validation.parameterSensitivity,
        groupStabilityStatus: candidate.validation.groupStability,
        recommendation,
        queue,
        evidenceRefs,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'] as Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>,
      }
    })
    const queueIds = (queue: ScreenerStrategyFailureMatrixReport['candidates'][number]['queue']) => candidates
      .filter((candidate) => candidate.queue === queue)
      .map((candidate) => candidate.candidateId)
    const retestQueue = queueIds('retest_queue')
    const retireQueue = queueIds('retire_queue')
    const expandSampleQueue = queueIds('expand_sample_queue')
    const regimeSpecificQueue = queueIds('regime_specific_queue')
    const manualReviewQueue = queueIds('manual_review_queue')
    const requiresNewStrategyFamily = manualReviewQueue.length === 0
      && candidates.length > 0
      && retireQueue.length + expandSampleQueue.length >= Math.max(2, Math.ceil(candidates.length * 0.6))
    return {
      schemaVersion: 'fams.screener.strategy_failure_matrix.v1',
      generatedAt: new Date().toISOString(),
      batchId: params.validationEvidenceMatrix.batchId,
      status: manualReviewQueue.length > 0 ? 'ready_for_manual_review' : 'blocked',
      summary: {
        diagnosedCandidates: candidates.length,
        passedCandidates: params.validationEvidenceMatrix.summary.passedCandidates,
        retestQueue: retestQueue.length,
        retireQueue: retireQueue.length,
        expandSampleQueue: expandSampleQueue.length,
        regimeSpecificQueue: regimeSpecificQueue.length,
        primaryBlocker: params.validationEvidenceMatrix.summary.primaryBlocker,
        requiresNewStrategyFamily,
      },
      candidates,
      queues: {
        retestQueue,
        retireQueue,
        expandSampleQueue,
        regimeSpecificQueue,
        manualReviewQueue,
      },
      nextActions: [
        ...(requiresNewStrategyFamily ? ['requires_new_strategy_family：同一策略族大面积进入 retire/expand sample，先设计新策略族，不继续扩大调参。'] : []),
        '优先处理 expand_sample_queue：扩大真实样本窗口后重跑四项验证。',
        'regime_specific_queue 只能收窄适用市场状态，不得泛化为全市场交易建议。',
        'parameter_sensitivity 失败候选必须冻结策略定义后重跑参数邻域稳定性，不允许单点参数放行。',
        'retire_queue 从交易建议候选池移除，仅保留研究审计记录。',
        'manualReviewQueue 非空且 validationDecision.usableForTradingAdvice=true 时，才允许进入人工交易草案复核。',
      ],
    }
  }

  private buildStrategyRemediationReport(params: {
    validationDecision: ScreenerValidationDecision
    strategyFailureMatrix: ScreenerStrategyFailureMatrixReport
  }): ScreenerStrategyRemediationReport {
    const remediations = params.strategyFailureMatrix.candidates.map((candidate) => {
      let decision: ScreenerStrategyRemediationReport['remediations'][number]['decision'] = 'keep_research_only'
      if (candidate.queue === 'manual_review_queue' && params.validationDecision.usableForTradingAdvice) decision = 'manual_review_candidate'
      else if (candidate.queue === 'regime_specific_queue') decision = 'narrow_scope'
      else if (candidate.queue === 'retire_queue' || candidate.recommendation === 'requires_new_strategy_family') decision = 'retire'
      const requiredEvidenceBeforePromotion = candidate.failedChecks.length > 0
        ? candidate.failedChecks.map((check) => {
          if (check === 'out_of_sample') return 'OOS 必须在扩展真实窗口中通过，且样本外超额收益不能衰减为非正。'
          if (check === 'walk_forward') return 'walk-forward 至少两个窗口通过，不能只有单窗口偶然有效。'
          if (check === 'parameter_sensitivity') return '参数邻域稳定，不允许单点阈值有效。'
          return '行业、市值、市场状态分组稳定性通过，样本不足时继续研究观察。'
        })
        : ['四项 validation evidence 继续保持通过，并完成独立人工复核。']
      return {
        candidateId: candidate.candidateId,
        strategyId: candidate.strategyId,
        decision,
        reason: candidate.failedReason,
        requiredEvidenceBeforePromotion,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'] as Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>,
      }
    })
    const keepForResearch = remediations.filter((item) => item.decision === 'keep_research_only').length
    const narrowScope = remediations.filter((item) => item.decision === 'narrow_scope').length
    const retire = remediations.filter((item) => item.decision === 'retire').length
    const manualReview = remediations.filter((item) => item.decision === 'manual_review_candidate').length
    const requiresNewStrategyFamily = manualReview === 0
      && retire > 0
      && retire >= Math.max(1, Math.floor(remediations.length * 0.5))
    return {
      schemaVersion: 'fams.screener.strategy_remediation_report.v1',
      generatedAt: new Date().toISOString(),
      batchId: params.strategyFailureMatrix.batchId,
      status: params.validationDecision.usableForTradingAdvice && manualReview > 0 ? 'ready_for_manual_review' : 'research_only',
      summary: {
        totalCandidates: remediations.length,
        keepForResearch,
        narrowScope,
        retire,
        requiresNewStrategyFamily,
        usableForTradingAdvice: params.validationDecision.usableForTradingAdvice,
      },
      remediations,
      auditOpinion: {
        severity: params.validationDecision.usableForTradingAdvice ? 'major' : 'critical',
        conclusion: params.validationDecision.usableForTradingAdvice
          ? '存在可进入人工复核的策略候选，但 AUTO_TRADE 仍禁止。'
          : 'validation_evidence 未通过，所有策略修复只能用于研究观察，不能进入交易动作。',
      },
      nextActions: [
        ...(requiresNewStrategyFamily ? ['当前策略族大面积退役，建议设计新策略族而不是继续调参。'] : []),
        '按 requiredEvidenceBeforePromotion 逐项补证，不降低四项 validation gate。',
        '复跑 long-sample controlled validation 后，再重新生成 validation_evidence_matrix。',
      ],
    }
  }

  private buildOosMultiWindowRegimeRetestReport(params: {
    tournament: ScreenerStrategyTournament
    validationEvidenceMatrix: ScreenerValidationEvidenceMatrixReport
  }): ScreenerOosMultiWindowRegimeRetestReport {
    const matrixById = new Map(params.validationEvidenceMatrix.candidates.map((item) => [item.candidateId, item]))
    const focusCandidateIds = new Set(params.validationEvidenceMatrix.candidates
      .filter((item) => item.failedChecks.includes('out_of_sample') || item.actionClass === 'regime_retest')
      .slice(0, 10)
      .map((item) => item.candidateId))
    const focused = params.tournament.ranked
      .filter((item) => focusCandidateIds.has(item.candidateId))
      .slice(0, 10)
    const splitSpecs = [
      { splitId: 'train_60_oos_40' as const, trainRatio: 0.6 },
      { splitId: 'train_70_oos_30' as const, trainRatio: 0.7 },
      { splitId: 'train_80_oos_20' as const, trainRatio: 0.8 },
    ]
    const buildSplit = (samples: ScreenerBacktestOutcome[], trainRatio: number) => {
      const sorted = [...samples]
        .filter((sample) => !sample.blockedReason)
        .sort((left, right) => (left.signalDate || '').localeCompare(right.signalDate || ''))
      if (sorted.length < 2) return { trainSamples: sorted, outOfSampleSamples: [] }
      const splitIndex = Math.min(sorted.length - 1, Math.max(1, Math.floor(sorted.length * trainRatio)))
      return {
        trainSamples: sorted.slice(0, splitIndex),
        outOfSampleSamples: sorted.slice(splitIndex),
      }
    }
    const buildStatus = (train: ScreenerReturnDistribution, outOfSample: ScreenerReturnDistribution) => {
      const warnings: string[] = []
      if (outOfSample.sampleSize < 10) warnings.push('样本外交易数不足 10。')
      if ((outOfSample.averageReturnPercent ?? 0) <= 0) warnings.push('样本外平均收益不为正。')
      if ((outOfSample.winRatePercent ?? 0) < 45) warnings.push('样本外胜率低于 45%。')
      if (
        train.averageReturnPercent !== null
        && outOfSample.averageReturnPercent !== null
        && outOfSample.averageReturnPercent < train.averageReturnPercent
      ) {
        warnings.push('样本外平均收益低于训练窗口。')
      }
      const status: 'passed' | 'failed' | 'insufficient' = outOfSample.sampleSize < 10
        ? 'insufficient'
        : warnings.length === 0
          ? 'passed'
          : 'failed'
      return { status, warnings }
    }
    const candidates = focused.map((candidate) => {
      const matrixCandidate = matrixById.get(candidate.candidateId)
      const windows = splitSpecs.map((spec) => {
        const split = buildSplit(candidate.samples, spec.trainRatio)
        const train = this.buildReturnDistribution(split.trainSamples)
        const outOfSample = this.buildReturnDistribution(split.outOfSampleSamples)
        const { status, warnings } = buildStatus(train, outOfSample)
        return {
          splitId: spec.splitId,
          trainRatio: spec.trainRatio,
          train,
          outOfSample,
          deterioration: {
            averageReturnDelta: train.averageReturnPercent !== null && outOfSample.averageReturnPercent !== null
              ? Number((outOfSample.averageReturnPercent - train.averageReturnPercent).toFixed(2))
              : null,
            medianReturnDelta: train.medianReturnPercent !== null && outOfSample.medianReturnPercent !== null
              ? Number((outOfSample.medianReturnPercent - train.medianReturnPercent).toFixed(2))
              : null,
            winRateDelta: train.winRatePercent !== null && outOfSample.winRatePercent !== null
              ? Number((outOfSample.winRatePercent - train.winRatePercent).toFixed(2))
              : null,
          },
          status,
          warnings,
        }
      })
      const regimes = new Map<string, { train: ScreenerBacktestOutcome[]; oos: ScreenerBacktestOutcome[] }>()
      const baseSplit = buildSplit(candidate.samples, 0.7)
      for (const sample of baseSplit.trainSamples) {
        const regime = sample.marketRegime || '未识别'
        const current = regimes.get(regime) || { train: [], oos: [] }
        current.train.push(sample)
        regimes.set(regime, current)
      }
      for (const sample of baseSplit.outOfSampleSamples) {
        const regime = sample.marketRegime || '未识别'
        const current = regimes.get(regime) || { train: [], oos: [] }
        current.oos.push(sample)
        regimes.set(regime, current)
      }
      const regimeBuckets = Array.from(regimes.entries())
        .map(([regime, value]) => {
          const train = this.buildReturnDistribution(value.train)
          const outOfSample = this.buildReturnDistribution(value.oos)
          const { status, warnings } = buildStatus(train, outOfSample)
          if (train.sampleSize < 5) warnings.push('训练窗口该市场状态样本少于 5。')
          return {
            regime,
            train,
            outOfSample,
            status: train.sampleSize < 5 ? 'insufficient' as const : status,
            warnings,
          }
        })
        .sort((left, right) => right.outOfSample.sampleSize - left.outOfSample.sampleSize || left.regime.localeCompare(right.regime))
      const passedWindows = windows.filter((item) => item.status === 'passed').length
      const failedWindows = windows.filter((item) => item.status === 'failed').length
      const insufficientWindows = windows.filter((item) => item.status === 'insufficient').length
      const passedRegimes = regimeBuckets.filter((item) => item.status === 'passed').length
      const failedRegimes = regimeBuckets.filter((item) => item.status === 'failed').length
      const insufficientRegimes = regimeBuckets.filter((item) => item.status === 'insufficient').length
      let conclusion: ScreenerOosMultiWindowRegimeRetestReport['candidates'][number]['conclusion'] = 'observe_only'
      let nextAction = '保持观察，不进入交易建议；等待更多样本或更长历史窗口复验。'
      if (insufficientWindows === windows.length || insufficientRegimes === regimeBuckets.length) {
        conclusion = 'needs_more_samples'
        nextAction = '样本不足，先补长样本回测和市场状态覆盖。'
      } else if (failedWindows >= 2 || failedRegimes > 0) {
        conclusion = 'retire_candidate'
        nextAction = '多窗口或市场状态复验失败，建议从交易建议候选池淘汰，仅保留研究审计。'
      } else if (passedWindows >= 2 && passedRegimes > 0 && failedRegimes === 0) {
        conclusion = 'regime_limited_candidate'
        nextAction = '仅在已通过的市场状态桶内保留研究价值；仍需四项 validation evidence 全部通过后才能人工复核。'
      }
      if (matrixCandidate?.validation.allPassed) {
        conclusion = 'eligible_manual_review'
        nextAction = '四项验证已通过，可进入人工交易计划复核；仍不得自动交易。'
      }
      return {
        candidateId: candidate.candidateId,
        strategyId: candidate.strategyId,
        name: candidate.name,
        executionPolicy: candidate.executionPolicy,
        actionClass: matrixCandidate?.actionClass || 'observe_only',
        sampleSize: candidate.sampleSize,
        tradeCount: candidate.tradeCount,
        windows,
        regimeBuckets,
        conclusion,
        nextAction,
      }
    })
    const allWindows = candidates.flatMap((item) => item.windows)
    const allRegimeBuckets = candidates.flatMap((item) => item.regimeBuckets)
    const passedWindows = allWindows.filter((item) => item.status === 'passed').length
    const failedWindows = allWindows.filter((item) => item.status === 'failed').length
    const insufficientWindows = allWindows.filter((item) => item.status === 'insufficient').length
    const passedRegimeBuckets = allRegimeBuckets.filter((item) => item.status === 'passed').length
    const failedRegimeBuckets = allRegimeBuckets.filter((item) => item.status === 'failed').length
    const insufficientRegimeBuckets = allRegimeBuckets.filter((item) => item.status === 'insufficient').length
    const findings = [
      ...(focused.length === 0 ? ['没有需要 OOS 多窗口复验的候选。'] : []),
      ...(failedWindows > 0 ? [`${failedWindows} 个 OOS 多窗口失败，不能解除 validation_evidence 阻断。`] : []),
      ...(failedRegimeBuckets > 0 ? [`${failedRegimeBuckets} 个市场状态桶失败，候选只能保留为观察或淘汰。`] : []),
      ...(insufficientWindows + insufficientRegimeBuckets > 0 ? [`${insufficientWindows + insufficientRegimeBuckets} 个窗口/市场状态桶样本不足。`] : []),
      ...(passedWindows > 0 || passedRegimeBuckets > 0 ? [`${passedWindows} 个窗口、${passedRegimeBuckets} 个市场状态桶通过，仅作为研究证据。`] : []),
    ]
    return {
      schemaVersion: 'fams.screener.oos_multi_window_regime_retest.v1',
      generatedAt: new Date().toISOString(),
      batchId: params.tournament.batchId || null,
      status: candidates.length === 0 || allWindows.length === 0
        ? 'insufficient'
        : failedWindows > 0 || failedRegimeBuckets > 0 || insufficientWindows > 0 || insufficientRegimeBuckets > 0
          ? 'completed_with_blockers'
          : 'passed',
      method: 'chronological_multi_split_and_market_regime_retest',
      summary: {
        diagnosedCandidates: focusCandidateIds.size,
        analyzedCandidates: candidates.length,
        windows: allWindows.length,
        passedWindows,
        failedWindows,
        insufficientWindows,
        regimeBuckets: allRegimeBuckets.length,
        passedRegimeBuckets,
        failedRegimeBuckets,
        insufficientRegimeBuckets,
      },
      candidates,
      findings,
      nextActions: [
        '保持 validation_evidence 原门禁，不用多窗口复验替代四项验证矩阵。',
        '优先淘汰连续多窗口失败的候选；对市场状态受限候选标注适用市场，不得泛化为全市场建议。',
        '样本不足时先补长样本和 feature coverage，再重新生成 strategy_metrics 与验证矩阵。',
      ],
    }
  }

  private buildValidationCandidateDispositionReport(params: {
    validationEvidenceMatrix: ScreenerValidationEvidenceMatrixReport
    oosMultiWindowRegimeRetest: ScreenerOosMultiWindowRegimeRetestReport
  }): ScreenerValidationCandidateDispositionReport {
    const retestById = new Map(params.oosMultiWindowRegimeRetest.candidates.map((item) => [item.candidateId, item]))
    const candidates = params.validationEvidenceMatrix.candidates.map((candidate) => {
      const retest = retestById.get(candidate.candidateId)
      let finalDisposition: ScreenerValidationCandidateDispositionReport['candidates'][number]['finalDisposition'] = 'observe_only'
      let allowedActions: ScreenerValidationCandidateDispositionReport['candidates'][number]['allowedActions'] = ['RESEARCH', 'OBSERVE']
      let rationale = '候选未通过完整 validation evidence，保留观察，不进入交易建议。'
      let nextAction = candidate.nextAction

      if (candidate.validation.allPassed) {
        finalDisposition = 'eligible_manual_review'
        allowedActions = ['RESEARCH', 'OBSERVE', 'PAPER_TRADE', 'MANUAL_REVIEW']
        rationale = 'OOS、walk-forward、参数敏感性和分组稳定性全部通过，可进入人工交易计划复核。'
        nextAction = '进入人工复核前必须再次确认持仓约束、市场可交易状态和用户确认。'
      } else if (candidate.actionClass === 'needs_more_samples' || retest?.conclusion === 'needs_more_samples') {
        finalDisposition = 'needs_more_samples'
        rationale = '候选样本不足，不能判断稳定性。'
        nextAction = '扩大历史窗口、提高样本覆盖或等待更多交易日后重跑验证矩阵。'
      } else if (candidate.actionClass === 'retire_candidate' || retest?.conclusion === 'retire_candidate') {
        finalDisposition = 'retire_candidate'
        rationale = '候选多项验证失败或多窗口/市场状态复验失败，应从交易建议候选池移除。'
        nextAction = '保留审计记录，后续仅作为策略研究反例使用。'
      } else if (retest?.conclusion === 'regime_limited_candidate') {
        finalDisposition = 'regime_limited_candidate'
        rationale = '候选只在局部市场状态桶内有研究价值，不能泛化为全市场交易建议。'
        nextAction = '标注适用市场状态，继续观察；四项 gate 全部通过前不得进入人工交易计划。'
      }

      return {
        candidateId: candidate.candidateId,
        strategyId: candidate.strategyId,
        name: candidate.name,
        executionPolicy: candidate.executionPolicy,
        matrixActionClass: candidate.actionClass,
        retestConclusion: retest?.conclusion,
        finalDisposition,
        allowedActions,
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'] as Array<'ADD' | 'REDUCE' | 'AUTO_TRADE'>,
        failedChecks: candidate.failedChecks,
        blockerTags: candidate.blockerTags,
        evidenceRefs: [
          'validation_evidence_matrix.json',
          ...(retest ? ['oos_multi_window_regime_retest.json'] : []),
        ],
        rationale,
        nextAction,
      }
    })
    const eligibleManualReview = candidates.filter((item) => item.finalDisposition === 'eligible_manual_review').length
    const regimeLimitedCandidates = candidates.filter((item) => item.finalDisposition === 'regime_limited_candidate').length
    const observeOnly = candidates.filter((item) => item.finalDisposition === 'observe_only').length
    const retiredCandidates = candidates.filter((item) => item.finalDisposition === 'retire_candidate').length
    const needsMoreSamples = candidates.filter((item) => item.finalDisposition === 'needs_more_samples').length
    const status: ScreenerValidationCandidateDispositionReport['status'] = eligibleManualReview > 0
      ? 'ready_for_manual_review'
      : retiredCandidates + observeOnly + regimeLimitedCandidates + needsMoreSamples > 0
        ? 'research_only'
        : 'blocked'

    return {
      schemaVersion: 'fams.screener.validation_candidate_disposition.v1',
      generatedAt: new Date().toISOString(),
      batchId: params.validationEvidenceMatrix.batchId,
      status,
      decision: eligibleManualReview > 0 ? 'READY_FOR_MANUAL_REVIEW' : 'CONTINUE_RESEARCH_ONLY',
      summary: {
        totalCandidates: candidates.length,
        eligibleManualReview,
        regimeLimitedCandidates,
        observeOnly,
        retiredCandidates,
        needsMoreSamples,
      },
      candidates,
      rules: [
        '四项 validation evidence 全部通过时，候选只能进入人工复核，不得自动交易。',
        'OOS 或多窗口/市场状态复验失败的候选不得生成 ADD / REDUCE。',
        '局部市场状态有效的候选只能标注研究适用范围，不能泛化为正式交易建议。',
        '样本不足候选只能等待补样本后复验。',
      ],
      nextActions: [
        eligibleManualReview > 0
          ? '对 eligible_manual_review 候选执行人工交易计划复核和持仓约束检查。'
          : '没有候选具备人工复核资格，P4 继续保持研究观察。',
        '将 retire_candidate 从交易建议候选池移除，只保留策略研究审计。',
        '将 regime_limited_candidate 标注适用市场状态，并要求重新跑 full-A validation evidence。',
      ],
    }
  }

  private detectDatabaseProvider(): ScreenerInfrastructureReadinessReport['database'] {
    const url = process.env.DATABASE_URL || ''
    if (!url) {
      return { provider: 'unknown', urlKind: 'unset', durabilityMode: 'development_local' }
    }
    if (url.startsWith('file:')) {
      return { provider: 'sqlite', urlKind: 'file', durabilityMode: 'development_local' }
    }
    if (url.startsWith('postgresql:') || url.startsWith('postgres:')) {
      return { provider: 'postgresql', urlKind: 'postgres', durabilityMode: 'production_candidate' }
    }
    return { provider: 'unknown', urlKind: 'other', durabilityMode: 'development_local' }
  }

  private buildInfrastructureReadinessReport(params: {
    operationId: string
    keyword: string
    options: ScreenerOptions
    chunkSize: number
    scannedCount: number
    evaluatedCount: number
    artifactCount: number
  }): ScreenerInfrastructureReadinessReport {
    const database = this.detectDatabaseProvider()
    const operationMode: ScreenerInfrastructureReadinessReport['execution']['operationMode'] = params.keyword.includes('long_sample_full')
      ? 'long_sample_full'
      : params.keyword.includes('long_sample_dry_run')
        ? 'long_sample_dry_run'
        : 'default'
    const executionMode: ScreenerInfrastructureReadinessReport['execution']['executionMode'] = /executionMode\s*[:=：]\s*queued|执行模式\s*[:=：]\s*queued|queued/i.test(params.keyword)
      ? 'queued'
      : 'inline'
    const gates: ScreenerInfrastructureReadinessReport['gates'] = []
    gates.push({
      id: 'database_provider',
      label: '数据库类型',
      status: database.provider === 'postgresql' ? 'passed' : 'warning',
      severity: database.provider === 'postgresql' ? 'warning' : 'blocker',
      message: database.provider === 'postgresql'
        ? '当前使用 PostgreSQL，可进入正式并发/分区/COPY 验收。'
        : '当前仍使用 SQLite，仅允许本地开发、受控 dry-run 和功能验收；正式全 A 生产验收前需要迁移 PostgreSQL。',
    })
    gates.push({
      id: 'execution_mode',
      label: '执行模式',
      status: executionMode === 'queued' ? 'passed' : 'warning',
      severity: operationMode === 'long_sample_full' && executionMode !== 'queued' ? 'blocker' : 'warning',
      message: executionMode === 'queued'
        ? '任务通过 queued worker 路径执行，具备恢复/租约/可取消基础。'
        : '任务以内联方式启动，适合小样本 smoke；正式全 A 长样本应通过 queued worker 执行。',
    })
    gates.push({
      id: 'market_data_mode',
      label: '行情读取边界',
      status: params.options.marketDataMode === 'cache_only' ? 'passed' : 'failed',
      severity: 'blocker',
      message: params.options.marketDataMode === 'cache_only'
        ? '扫描只读本地 canonical / feature cache，符合 P4.34 架构边界。'
        : '扫描仍允许实时拉取外部行情，不符合正式全 A 选股边界。',
    })
    gates.push({
      id: 'chunk_size',
      label: '分片规模',
      status: params.chunkSize <= 500 ? 'passed' : 'warning',
      severity: params.chunkSize <= 500 ? 'warning' : 'blocker',
      message: params.chunkSize <= 500
        ? `chunkSize=${params.chunkSize} 在当前受控范围内。`
        : `chunkSize=${params.chunkSize} 过大，SQLite/单进程 artifact 生成存在内存和锁风险。`,
    })
    const hasBlocker = gates.some((gate) => gate.status === 'failed' || gate.severity === 'blocker' && gate.status !== 'passed')
    return {
      schemaVersion: 'fams.screener.infrastructure_readiness.v1',
      generatedAt: new Date().toISOString(),
      status: hasBlocker ? 'blocked' : gates.some((gate) => gate.status === 'warning') ? 'needs_review' : 'ready',
      database,
      execution: {
        operationId: params.operationId,
        operationMode,
        executionMode,
        marketDataMode: params.options.marketDataMode,
        chunkSize: params.chunkSize,
        concurrency: params.options.concurrency,
        scannedCount: params.scannedCount,
        evaluatedCount: params.evaluatedCount,
        artifactCount: params.artifactCount,
      },
      gates,
      migrationPlan: {
        requiredBeforeProductionFullA: [
          'PostgreSQL datasource 与 Prisma schema 迁移评审',
          'market_bar_raw / market_bar_canonical / market_feature_daily 按 trade_date 分区',
          'COPY 或 staging table 批量导入行情数据',
          '独立 worker 进程与租约恢复验收',
          '全 A 60 日 strategy_tournament_run queued 压力验收',
        ],
        sqliteAllowedScope: [
          '本地开发',
          '小样本 smoke',
          'cache-only 读取路径验证',
          '受控 dry-run，不作为生产级高可信验收',
        ],
        postgresqlTarget: [
          '并发读写隔离',
          '长样本 artifact 分阶段生成',
          'provider health / coverage 聚合写入',
          '回测样本和行情数据可按日期/批次追溯',
        ],
      },
    }
  }

  private classifyMarketConstraintEvidence(reason: string): {
    evidenceType: ScreenerMarketConstraintCoverageReport['blockedReasonSummary'][number]['evidenceType']
    reliability: ScreenerMarketConstraintCoverageReport['blockedReasonSummary'][number]['reliability']
    requiresOfficialProvider: boolean
  } {
    if (reason.includes('ST') || reason.includes('退市')) {
      return { evidenceType: 'name_rule', reliability: 'medium', requiresOfficialProvider: true }
    }
    if (reason.includes('上市交易日不足')) {
      return { evidenceType: 'listing_age', reliability: 'medium', requiresOfficialProvider: true }
    }
    if (reason.includes('停牌') || reason.includes('成交量为0')) {
      return { evidenceType: 'kline_volume', reliability: 'medium', requiresOfficialProvider: true }
    }
    if (reason.includes('成交额不足')) {
      return { evidenceType: 'kline_amount', reliability: 'high', requiresOfficialProvider: false }
    }
    if (reason.includes('涨停') || reason.includes('跌停')) {
      return { evidenceType: 'price_limit_heuristic', reliability: 'medium', requiresOfficialProvider: true }
    }
    return { evidenceType: 'unknown', reliability: 'low', requiresOfficialProvider: true }
  }

  private buildMarketConstraintCoverageReport(tournament: ScreenerStrategyTournament): ScreenerMarketConstraintCoverageReport {
    const blockedSamples = tournament.ranked.flatMap((item) => item.blockedSamples)
    const executedSamples = tournament.ranked.reduce<number>((sum, item) => sum + item.samples.length, 0)
    const grouped = new Map<string, { count: number; symbols: Set<string> }>()
    for (const sample of blockedSamples) {
      const reason = sample.blockedReason || 'unknown'
      const current = grouped.get(reason) || { count: 0, symbols: new Set<string>() }
      current.count += 1
      current.symbols.add(sample.symbol)
      grouped.set(reason, current)
    }
    const blockedReasonSummary = Array.from(grouped.entries())
      .sort((left, right) => right[1].count - left[1].count)
      .map(([reason, item]) => {
        const evidence = this.classifyMarketConstraintEvidence(reason)
        return {
          reason,
          count: item.count,
          symbols: Array.from(item.symbols).sort().slice(0, 20),
          ...evidence,
        }
      })
    const providerGaps = Array.from(new Set([
      '缺少正式证券状态源，ST/退市当前主要依赖名称规则。',
      '缺少正式停复牌状态源，停牌当前依赖成交量为 0、K 线缺失或 coverage stale。',
      '缺少正式涨跌停价字段，涨跌停当前依赖价格形态启发式。',
      ...blockedReasonSummary
      .filter((item) => item.requiresOfficialProvider)
      .map((item) => {
        if (item.evidenceType === 'name_rule') return '缺少交易所/指数级证券状态源，ST/退市当前主要依赖名称规则。'
        if (item.evidenceType === 'listing_age') return '缺少正式上市日期/上市状态源，上市天数当前依赖本地 K 线长度。'
        if (item.evidenceType === 'kline_volume') return '缺少正式停复牌状态源，停牌当前依赖成交量为 0 或 K 线缺失。'
        if (item.evidenceType === 'price_limit_heuristic') return '缺少正式涨跌停价字段，涨跌停当前依赖价格形态启发式。'
        return '存在未知市场约束阻断原因，需要补充正式 provider 映射。'
      }),
    ]))
    return {
      schemaVersion: 'fams.screener.market_constraint_coverage.v1',
      generatedAt: new Date().toISOString(),
      status: providerGaps.length > 0 ? 'needs_official_status_provider' : 'sufficient_for_backtest_audit',
      constraintVersion: 'constraint.cn_a_share_tradeability.v1',
      assumptions: tournament.assumptions.marketConstraints,
      summary: {
        rankedCandidates: tournament.ranked.length,
        executedSamples,
        blockedSamples: blockedSamples.length,
        blockedRatioPercent: executedSamples + blockedSamples.length > 0
          ? Number(((blockedSamples.length / (executedSamples + blockedSamples.length)) * 100).toFixed(2))
          : 0,
        uniqueBlockedSymbols: new Set(blockedSamples.map((item) => item.symbol)).size,
      },
      blockedReasonSummary,
      providerGaps,
      nextActions: [
        '接入正式证券状态 provider，覆盖 ST、退市、停复牌、上市日期。',
        '将涨跌停价字段落入 market_bar_raw / market_bar_canonical quality flags。',
        '在 PostgreSQL 迁移后对市场约束阻断样本按日期和 provider 追溯。',
      ],
    }
  }

  private buildP4ClosureReviewReport(params: {
    longSampleAcceptance: ScreenerLongSampleAcceptanceReport
    validationDecision: ScreenerValidationDecision
    validationCandidateDisposition?: ScreenerValidationCandidateDispositionReport
    infrastructureReadinessReport: ScreenerInfrastructureReadinessReport
    marketConstraintCoverageReport: ScreenerMarketConstraintCoverageReport
    postgresShadowReadinessReport?: ScreenerPostgresShadowReadinessReport
    securityStatusCoverageReport?: ScreenerSecurityStatusCoverageReport
    validationFailureTaxonomy?: ScreenerValidationFailureTaxonomyReport
  }): ScreenerP4ClosureReviewReport {
    const gates: ScreenerP4ClosureReviewReport['gates'] = []
    const pushGate = (gate: ScreenerP4ClosureReviewReport['gates'][number]) => gates.push(gate)
    const longSampleBlockers = params.longSampleAcceptance.gates.filter((item) => item.severity === 'blocker' && item.status !== 'passed')
    pushGate({
      id: 'long_sample_acceptance',
      label: '长样本验收',
      status: longSampleBlockers.length === 0 ? 'passed' : 'failed',
      severity: 'blocker',
      sourceArtifact: 'long_sample_acceptance.json',
      message: longSampleBlockers.length === 0
        ? '长样本基础 gate 已通过。'
        : `长样本仍有 ${longSampleBlockers.length} 个 blocker：${longSampleBlockers.map((item) => item.id).join(' / ')}`,
    })
    pushGate({
      id: 'validation_decision',
      label: '交易建议边界',
      status: params.validationDecision.usableForTradingAdvice ? 'passed' : 'failed',
      severity: 'blocker',
      sourceArtifact: 'validation_decision.json',
      message: params.validationDecision.usableForTradingAdvice
        ? '验证决策允许进入人工交易计划复核。'
        : `验证决策为 ${params.validationDecision.decision}，禁止 ${params.validationDecision.prohibitedActions.join(' / ')}。`,
    })
    if (params.validationCandidateDisposition) {
      pushGate({
        id: 'candidate_disposition',
        label: '候选组合处置',
        status: params.validationCandidateDisposition.status === 'ready_for_manual_review' ? 'passed' : 'warning',
        severity: params.validationCandidateDisposition.status === 'ready_for_manual_review' ? 'warning' : 'blocker',
        sourceArtifact: 'validation_candidate_disposition.json',
        message: params.validationCandidateDisposition.status === 'ready_for_manual_review'
          ? `${params.validationCandidateDisposition.summary.eligibleManualReview} 个候选可进入人工复核。`
          : `候选处置为 ${params.validationCandidateDisposition.status}，人工复核候选 ${params.validationCandidateDisposition.summary.eligibleManualReview} 个，观察/淘汰/补样本候选 ${params.validationCandidateDisposition.summary.totalCandidates - params.validationCandidateDisposition.summary.eligibleManualReview} 个。`,
      })
    }
    pushGate({
      id: 'infrastructure_readiness',
      label: '基础设施就绪',
      status: params.infrastructureReadinessReport.status === 'ready' ? 'passed' : 'warning',
      severity: params.infrastructureReadinessReport.status === 'ready' ? 'warning' : 'blocker',
      sourceArtifact: 'infrastructure_readiness_report.json',
      message: params.infrastructureReadinessReport.status === 'ready'
        ? '基础设施可进入正式全 A 压力验收。'
        : `基础设施状态为 ${params.infrastructureReadinessReport.status}，正式全 A 生产验收仍需 PostgreSQL/worker 迁移项。`,
    })
    pushGate({
      id: 'market_constraint_provider',
      label: '市场约束正式源',
      status: params.marketConstraintCoverageReport.status === 'sufficient_for_backtest_audit' ? 'passed' : 'warning',
      severity: params.marketConstraintCoverageReport.status === 'sufficient_for_backtest_audit' ? 'warning' : 'blocker',
      sourceArtifact: 'market_constraint_coverage_report.json',
      message: params.marketConstraintCoverageReport.status === 'sufficient_for_backtest_audit'
        ? '市场约束覆盖可支撑回测审计。'
        : `市场约束仍缺正式 provider：${params.marketConstraintCoverageReport.providerGaps.join('；')}`,
    })
    if (params.postgresShadowReadinessReport) {
      pushGate({
        id: 'postgres_shadow_readiness',
        label: 'PostgreSQL Shadow',
        status: params.postgresShadowReadinessReport.status === 'ready' ? 'passed' : 'warning',
        severity: params.postgresShadowReadinessReport.status === 'ready' ? 'warning' : 'blocker',
        sourceArtifact: 'postgres_shadow_readiness_report.json',
        message: params.postgresShadowReadinessReport.status === 'ready'
          ? 'PostgreSQL shadow 压测链路已就绪。'
          : `PostgreSQL shadow 状态为 ${params.postgresShadowReadinessReport.status}，仍不能作为生产级全 A 压测通过。`,
      })
    }
    if (params.securityStatusCoverageReport) {
      pushGate({
        id: 'security_status_coverage',
        label: '证券状态正式源',
        status: params.securityStatusCoverageReport.status === 'sufficient' ? 'passed' : 'warning',
        severity: params.securityStatusCoverageReport.status === 'sufficient' ? 'warning' : 'blocker',
        sourceArtifact: 'security_status_coverage_report.json',
        message: params.securityStatusCoverageReport.status === 'sufficient'
          ? '证券状态、停复牌与涨跌停价正式源覆盖已达验收线。'
          : `证券状态覆盖状态为 ${params.securityStatusCoverageReport.status}，仍需接入混合 provider。`,
      })
    }
    if (params.validationFailureTaxonomy) {
      pushGate({
        id: 'validation_failure_taxonomy',
        label: 'OOS 失败分类',
        status: params.validationFailureTaxonomy.status === 'ready_for_manual_review' ? 'passed' : 'warning',
        severity: params.validationFailureTaxonomy.status === 'ready_for_manual_review' ? 'warning' : 'blocker',
        sourceArtifact: 'validation_failure_taxonomy.json',
        message: params.validationFailureTaxonomy.status === 'ready_for_manual_review'
          ? 'OOS 失败分类未阻断人工复核。'
          : `OOS 失败分类状态为 ${params.validationFailureTaxonomy.status}，继续保持研究观察。`,
      })
    }

    const productionReady = gates.every((gate) => gate.status === 'passed' || gate.severity === 'warning')
    const usableForTradingAdvice = params.validationDecision.usableForTradingAdvice
    const remainingBlockers = gates
      .filter((gate) => gate.severity === 'blocker' && gate.status !== 'passed')
      .map((gate) => `${gate.label}: ${gate.message}`)
    const completedEvidence = [
      '全 A universe、coverage、feature cache 与 feature-first 当前筛选已落地。',
      '策略锦标赛已拆出执行矩阵、成本模型、市场约束、OOS、walk-forward、参数敏感性和分组稳定性证据。',
      'validation decision 已将未通过证据时的动作边界收口为 OBSERVE_ONLY。',
      'validation candidate disposition 已把候选组合分为人工复核、市场状态受限、观察、淘汰和补样本。',
      '基础设施 readiness 与市场约束 provider gap 已进入 Operation artifact 链。',
      'P5 PostgreSQL shadow、混合 provider 与 OOS 失败分类已形成第一段可审计计划产物。',
    ]
    const nextActions = Array.from(new Set([
      ...params.validationDecision.requiredNextChecks,
      ...params.infrastructureReadinessReport.migrationPlan.requiredBeforeProductionFullA,
      ...params.marketConstraintCoverageReport.nextActions,
      ...(params.postgresShadowReadinessReport?.nextActions || []),
      ...(params.securityStatusCoverageReport?.nextActions || []),
      ...(params.validationFailureTaxonomy?.nextActions || []),
    ]))

    return {
      schemaVersion: 'fams.screener.p4_closure_review.v1',
      generatedAt: new Date().toISOString(),
      phase: 'P4.34',
      status: productionReady
        ? usableForTradingAdvice ? 'research_ready' : 'blocked_for_trading'
        : 'blocked_for_production',
      decision: usableForTradingAdvice ? 'READY_FOR_MANUAL_REVIEW' : 'CONTINUE_RESEARCH_ONLY',
      summary: {
        acceptanceStatus: params.longSampleAcceptance.status,
        validationDecision: params.validationDecision.decision,
        candidateDispositionStatus: params.validationCandidateDisposition?.status,
        infrastructureStatus: params.infrastructureReadinessReport.status,
        marketConstraintStatus: params.marketConstraintCoverageReport.status,
        usableForTradingAdvice,
        productionReady,
      },
      gates,
      completedEvidence,
      remainingBlockers,
      nextActions,
      artifactRefs: [
        'long_sample_acceptance.json',
        'validation_decision.json',
        'validation_evidence_matrix.json',
        'validation_candidate_disposition.json',
        'oos_failure_analysis.json',
        'oos_layered_validation.json',
        'infrastructure_readiness_report.json',
        'market_constraint_coverage_report.json',
        'postgres_shadow_readiness_report.json',
        'security_status_coverage_report.json',
        'validation_failure_taxonomy.json',
      ],
    }
  }

  private async buildPostgresShadowReadinessReport(): Promise<ScreenerPostgresShadowReadinessReport> {
    const currentDatabase = this.detectDatabaseProvider()
    const shadowUrl = process.env.FAMS_POSTGRES_SHADOW_DATABASE_URL || process.env.POSTGRES_SHADOW_DATABASE_URL || ''
    const shadowUrlKind: ScreenerPostgresShadowReadinessReport['database']['shadowUrlKind'] = !shadowUrl
      ? 'unset'
      : shadowUrl.startsWith('postgresql:') || shadowUrl.startsWith('postgres:')
        ? 'postgres'
        : 'other'
    const shadowConfigured = shadowUrlKind === 'postgres'
    const psqlAvailable = existsSync('/usr/bin/psql') || existsSync('/bin/psql')
    const verification: ScreenerPostgresShadowReadinessReport['verification'] = {
      clientTool: psqlAvailable ? 'psql_available' : 'psql_missing',
      connectionChecked: false,
      schemaChecked: false,
      stagingChecked: false,
      pressureChecked: false,
      notes: [],
    }
    let shadowVerified = false
    if (shadowConfigured) {
      const client = new Client({
        connectionString: shadowUrl,
        connectionTimeoutMillis: Math.max(1000, Math.min(15000, Number(process.env.FAMS_POSTGRES_SHADOW_TIMEOUT_MS || 5000))),
        statement_timeout: Math.max(1000, Math.min(30000, Number(process.env.FAMS_POSTGRES_SHADOW_STATEMENT_TIMEOUT_MS || 10000))),
      })
      try {
        await client.connect()
        verification.connectionChecked = true
        await client.query('CREATE SCHEMA IF NOT EXISTS fams_shadow')
        await client.query(`
          CREATE TABLE IF NOT EXISTS fams_shadow.staging_market_bar_raw (
            batch_id text NOT NULL,
            symbol text NOT NULL,
            trade_date date NOT NULL,
            close_price numeric NOT NULL,
            raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `)
        await client.query(`
          CREATE TABLE IF NOT EXISTS fams_shadow.staging_quote_list (
            batch_id text NOT NULL,
            symbol text NOT NULL,
            name text,
            source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `)
        await client.query(`
          CREATE TABLE IF NOT EXISTS fams_shadow.staging_security_status (
            batch_id text NOT NULL,
            symbol text NOT NULL,
            trade_date date NOT NULL,
            listing_status text NOT NULL,
            tradability_status text NOT NULL,
            source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
            created_at timestamptz NOT NULL DEFAULT now()
          )
        `)
        verification.schemaChecked = true
        verification.stagingChecked = true
        const batchId = `shadow_smoke_${Date.now()}`
        await client.query('BEGIN')
        await client.query(
          'INSERT INTO fams_shadow.staging_market_bar_raw(batch_id, symbol, trade_date, close_price, raw_payload) VALUES ($1,$2,$3,$4,$5)',
          [batchId, '000001', '2026-05-29', 1.23, JSON.stringify({ provider: 'shadow_smoke' })]
        )
        await client.query(
          'INSERT INTO fams_shadow.staging_quote_list(batch_id, symbol, name, source_refs) VALUES ($1,$2,$3,$4)',
          [batchId, '000001', 'shadow_smoke', JSON.stringify(['shadow_smoke'])]
        )
        await client.query(
          'INSERT INTO fams_shadow.staging_security_status(batch_id, symbol, trade_date, listing_status, tradability_status, source_refs) VALUES ($1,$2,$3,$4,$5,$6)',
          [batchId, '000001', '2026-05-29', 'listed', 'tradable', JSON.stringify(['shadow_smoke'])]
        )
        const smoke = await client.query(
          `SELECT
             (SELECT count(*)::int FROM fams_shadow.staging_market_bar_raw WHERE batch_id=$1) AS raw_count,
             (SELECT count(*)::int FROM fams_shadow.staging_quote_list WHERE batch_id=$1) AS quote_count,
             (SELECT count(*)::int FROM fams_shadow.staging_security_status WHERE batch_id=$1) AS status_count`,
          [batchId]
        )
        await client.query('ROLLBACK')
        const row = smoke.rows[0] || {}
        verification.pressureChecked = row.raw_count === 1 && row.quote_count === 1 && row.status_count === 1
        shadowVerified = verification.connectionChecked && verification.schemaChecked && verification.stagingChecked && verification.pressureChecked
        verification.notes.push(shadowVerified
          ? 'PostgreSQL shadow 连接、schema、staging 表和批量写入烟测已通过。'
          : 'PostgreSQL shadow 已连接，但 staging 烟测未完全通过。')
      } catch (error) {
        verification.error = error instanceof Error ? error.message : String(error)
        verification.notes.push(`PostgreSQL shadow 验证失败：${verification.error}`)
        try {
          await client.query('ROLLBACK')
        } catch {
          // ignore rollback failure after connection errors
        }
      } finally {
        try {
          await client.end()
        } catch {
          // ignore disconnect failure
        }
      }
    } else {
      verification.notes.push(shadowUrlKind === 'unset'
        ? '未配置 shadow PostgreSQL URL，无法执行连接校验。'
        : 'shadow URL 不是 PostgreSQL 连接串，无法执行连接校验。')
    }
    if (!psqlAvailable) {
      verification.notes.push('当前 WSL 未发现 psql；已使用 Node pg client 作为自动验证路径。')
    }
    const requiredStages: ScreenerPostgresShadowReadinessReport['requiredStages'] = [
      {
        id: 'shadow_connection',
        status: verification.connectionChecked ? 'passed' : shadowConfigured ? 'pending' : 'blocked',
        message: verification.connectionChecked ? 'PostgreSQL shadow 连接已验证。' : shadowConfigured ? '已配置 PostgreSQL shadow URL，但连接尚未通过。' : '未配置 FAMS_POSTGRES_SHADOW_DATABASE_URL / POSTGRES_SHADOW_DATABASE_URL。',
      },
      {
        id: 'copy_staging',
        status: verification.stagingChecked ? 'passed' : 'pending',
        message: verification.stagingChecked ? 'shadow staging 表已创建并验证。' : '待实现 COPY/staging 批量导入和 promote 校验。',
      },
      {
        id: 'queued_worker_pressure',
        status: verification.pressureChecked ? 'passed' : 'pending',
        message: verification.pressureChecked ? 'shadow staging 批量写入烟测已通过；全 A queued 压测仍由 infrastructure readiness gate 管控。' : '待执行 shadow staging 写入烟测和全 A 60 日 queued strategy_tournament_run 压测。',
      },
      {
        id: 'lease_recovery',
        status: 'pending',
        message: '待验证 worker lease 过期恢复不会重复污染 canonical。',
      },
    ]
    return {
      schemaVersion: 'fams.infrastructure.postgres_shadow_readiness.v1',
      generatedAt: new Date().toISOString(),
      status: shadowVerified ? 'ready' : shadowConfigured ? 'configured_not_verified' : 'not_configured',
      mode: 'shadow_only',
      database: {
        currentProvider: currentDatabase.provider,
        shadowConfigured,
        shadowUrlKind,
      },
      verification,
      requiredStages,
      copyStagingPlan: {
        stagingTables: ['staging_market_bar_raw', 'staging_quote_list', 'staging_security_status'],
        promoteRules: [
          'staging 只保存批次原始标准化数据，不直接覆盖 canonical。',
          'promote 前必须校验 provider、payloadHash、tradeDate、validationStatus 和 sourceRefs。',
          'canonical 写入必须保留 dataVersion、sourceRefs 和 conflict/warning 标记。',
        ],
        pressureTargets: [
          '5500+ A 股标的 × 最近 120 个交易日 K 线可批量导入。',
          'provider success rate >= 98%，cache hit rate >= 99%。',
          '全 A 60 日 queued strategy_tournament_run 无 OOM、无长时间 DB lock。',
        ],
      },
      nextActions: [
        '配置 FAMS_POSTGRES_SHADOW_DATABASE_URL，建立不替换 SQLite 的 shadow PostgreSQL 环境。',
        '实现 staging -> validate -> promote 的批量导入路径。',
        '用 queued worker 执行全 A 60 日压力验收并生成 infrastructure_pressure_report.json。',
      ],
    }
  }

  private buildSecurityStatusCoverageReport(
    marketConstraintCoverageReport: ScreenerMarketConstraintCoverageReport,
    coverageSnapshot?: SecurityStatusCoverageSnapshot
  ): ScreenerSecurityStatusCoverageReport {
    const tushareConfigured = Boolean(process.env.TUSHARE_TOKEN || process.env.FAMS_TUSHARE_TOKEN)
    const providerCandidates: ScreenerSecurityStatusCoverageReport['providerCandidates'] = [
      {
        provider: 'akshare',
        role: 'free_primary',
        configured: true,
        confidence: 'medium',
        limitations: ['公开网页接口易受源站结构变化影响', '必须缓存并做字段校验'],
      },
      {
        provider: 'baostock',
        role: 'free_cross_check',
        configured: true,
        confidence: 'medium',
        limitations: ['适合历史 K 线和基础数据兜底', '不应作为唯一正式状态源'],
      },
      {
        provider: 'eastmoney',
        role: 'free_cross_check',
        configured: true,
        confidence: 'medium',
        limitations: ['同厂商不同接口不等于独立复核', '需要记录 endpoint 和 payload hash'],
      },
      {
        provider: 'exchange_public',
        role: 'official_reference',
        configured: false,
        confidence: 'high',
        limitations: ['需单独实现交易所公告/状态解析', '覆盖字段和历史回溯需要逐项验证'],
      },
      {
        provider: 'tushare',
        role: 'configurable_primary',
        configured: tushareConfigured,
        confidence: tushareConfigured ? 'high' : 'unknown',
        limitations: ['需要 token、积分、频次和字段权限管理', '无 token 时不得阻断免费源第一段落地'],
      },
    ]
    const hasCanonicalRows = Boolean(coverageSnapshot && coverageSnapshot.statusRows > 0 && coverageSnapshot.tradeabilityRows > 0)
    const hasOfficialRows = Boolean(coverageSnapshot && coverageSnapshot.officialProviderRows > 0)
    const hasFormalTradingStateRows = Boolean(coverageSnapshot && coverageSnapshot.formalTradingStateRows > 0)
    const providerNames = coverageSnapshot?.providerSummary.map((item) => item.provider).join(' / ') || 'none'
    const gates: ScreenerSecurityStatusCoverageReport['gates'] = [
      {
        id: 'canonical_tables',
        status: hasCanonicalRows ? 'warning' : 'failed',
        severity: hasCanonicalRows ? 'warning' : 'blocker',
        message: hasCanonicalRows
          ? `SecurityStatusDaily / MarketTradeabilityDaily 已有 ${coverageSnapshot?.statusRows || 0}/${coverageSnapshot?.tradeabilityRows || 0} 行，provider=${providerNames}。`
          : 'SecurityStatusDaily / MarketTradeabilityDaily 尚未落库，市场约束仍不能读取正式事实层。',
      },
      {
        id: 'official_provider_rows',
        status: hasOfficialRows ? 'passed' : 'failed',
        severity: hasOfficialRows ? 'warning' : 'blocker',
        message: hasOfficialRows
          ? `已存在 ${coverageSnapshot?.officialProviderRows || 0} 行正式/独立 provider 证券状态事实。`
          : '尚无交易所/Tushare/独立正式源证券状态事实，heuristic 行不能作为生产级约束证据。',
      },
      {
        id: 'provider_mix',
        status: 'warning',
        severity: 'warning',
        message: '已确定混合 provider 策略：免费源先落地，Tushare 预留可配置主源。',
      },
      {
        id: 'formal_trade_state_rows',
        status: hasFormalTradingStateRows ? 'passed' : 'warning',
        severity: 'warning',
        message: hasFormalTradingStateRows
          ? `已存在 ${coverageSnapshot?.formalTradingStateRows || 0} 行正式交易状态事实。`
          : '未配置 Tushare/交易所正式交易状态源；免费源仍可输出分析建议，但需降级置信度并禁止自动交易。',
      },
      {
        id: 'provider_gaps',
        status: marketConstraintCoverageReport.providerGaps.length === 0 ? 'passed' : 'warning',
        severity: 'warning',
        message: marketConstraintCoverageReport.providerGaps.length === 0
          ? '市场约束报告未发现正式源缺口。'
          : `正式源增强项未完成：${marketConstraintCoverageReport.providerGaps.join('；')}。免费源分析可用，但交易执行前需人工复核。`,
      },
    ]
    return {
      schemaVersion: 'fams.market.security_status_coverage.v1',
      generatedAt: new Date().toISOString(),
      status: hasCanonicalRows && hasOfficialRows
        ? 'sufficient'
        : hasCanonicalRows
          ? 'partial'
          : 'not_started',
      providerPolicy: 'free_sources_primary_tushare_optional',
      canonicalTables: ['SecurityStatusDaily', 'MarketTradeabilityDaily'],
      requiredFields: [
        'listingStatus',
        'riskFlag',
        'isSuspended',
        'limitUp',
        'limitDown',
        'tradabilityStatus',
        'provider',
        'sourceTimestamp',
        'confidence',
        'sourceRefsJson',
        'warningsJson',
      ],
      providerCandidates,
      coverageSnapshot,
      currentFallbacks: [
        'ST/退市：名称规则',
        '停牌：成交量为 0、K 线缺失或 coverage stale',
        '涨跌停：价格形态启发式',
      ],
      gates,
      nextActions: [
        hasCanonicalRows
          ? '继续完善 SecurityStatusDaily / MarketTradeabilityDaily，接入正式 provider 后替换或复核 heuristic 行。'
          : '新增 SecurityStatusDaily / MarketTradeabilityDaily 事实层。',
        '免费源可作为分析建议事实源，但必须保留 sourceRefs、confidence 和 warnings。',
        '接入 AKShare / BaoStock / Eastmoney 免费源并实现字段级交叉验证。',
        '预留 Tushare token provider，用户选择配置后可作为增强主源或高质量复核源。',
        '让 MarketConstraint 优先读取正式事实层，heuristic fallback 必须降级 confidence。',
      ],
    }
  }

  private buildValidationFailureTaxonomyReport(params: {
    validationDecision: ScreenerValidationDecision
    oosFailureAnalysis: ScreenerOosFailureAnalysis
    oosLayeredValidation?: ScreenerOosLayeredValidationReport
  }): ScreenerValidationFailureTaxonomyReport {
    const tags = new Set(params.oosFailureAnalysis.globalFailureTags)
    const failureClasses: ScreenerValidationFailureTaxonomyReport['failureClasses'] = []
    const addClass = (
      id: string,
      label: string,
      severity: 'blocker' | 'warning',
      evidence: string[],
      recommendedAction: string
    ) => failureClasses.push({ id, label, severity, evidence, recommendedAction })
    if (params.validationDecision.decision !== 'TRADING_RESEARCH_ALLOWED') {
      addClass(
        'validation_gate_blocked',
        '验证 gate 未通过',
        'blocker',
        params.validationDecision.reasons,
        '继续保持 OBSERVE_ONLY，不得输出 ADD / REDUCE / AUTO_TRADE。'
      )
    }
    if (tags.has('market_regime_shift')) {
      addClass(
        'market_regime_shift',
        '市场状态切换',
        'blocker',
        ['OOS failure tags 包含 market_regime_shift。'],
        '新增 regime 分层 OOS，不用单一 chronological split 解释全部场景。'
      )
    }
    if (params.oosLayeredValidation && params.oosLayeredValidation.status !== 'passed') {
      addClass(
        'layered_oos_blocked',
        '分层样本外复验仍有阻断',
        'blocker',
        params.oosLayeredValidation.findings,
        '按市场状态、行业和市值桶逐项复核，不得用整体样本 high 覆盖分层失败。'
      )
    }
    if ([...tags].some((tag) => tag.includes('decay') || tag.includes('non_positive'))) {
      addClass(
        'oos_return_decay',
        '样本外收益衰减',
        'blocker',
        [...tags].filter((tag) => tag.includes('decay') || tag.includes('non_positive')),
        '比较训练窗口与样本外窗口均值、中位数、胜率、尾部亏损。'
      )
    }
    if ([...tags].some((tag) => tag.includes('insufficient'))) {
      addClass(
        'sample_insufficient',
        '样本不足',
        'warning',
        [...tags].filter((tag) => tag.includes('insufficient')),
        '扩大回测窗口或保留研究观察，不得提升可信度。'
      )
    }
    if (failureClasses.length === 0) {
      addClass('no_failure_class', '未发现明确失败分类', 'warning', ['当前 OOS 失败标签为空或不足。'], '补充更长窗口和分组诊断。')
    }
    const failedCandidates = params.oosFailureAnalysis.candidates.filter((item) => item.oosStatus === 'failed').length
    const passedCandidates = params.oosFailureAnalysis.candidates.filter((item) => item.oosStatus === 'passed').length
    return {
      schemaVersion: 'fams.screener.validation_failure_taxonomy.v1',
      generatedAt: new Date().toISOString(),
      status: params.validationDecision.usableForTradingAdvice
        ? 'ready_for_manual_review'
        : params.oosLayeredValidation && params.oosLayeredValidation.status !== 'insufficient'
          ? 'ready_for_manual_review'
          : params.oosFailureAnalysis.diagnosedCandidates === 0
          ? 'needs_more_samples'
          : 'blocked_for_trading',
      decision: params.validationDecision.decision,
      summary: {
        diagnosedCandidates: params.oosFailureAnalysis.diagnosedCandidates,
        failedCandidates,
        passedCandidates,
        globalFailureTags: params.oosFailureAnalysis.globalFailureTags,
      },
      failureClasses,
      candidateFailures: params.oosFailureAnalysis.candidates.slice(0, 10).map((item) => ({
        candidateId: item.candidateId,
        strategyId: item.strategyId,
        oosStatus: item.oosStatus,
        failureTags: item.failureTags,
        recommendedAction: item.recommendedAction,
      })),
      layeredValidation: params.oosLayeredValidation ? {
        status: params.oosLayeredValidation.status,
        failedBuckets: params.oosLayeredValidation.summary.failedBuckets,
        insufficientBuckets: params.oosLayeredValidation.summary.insufficientBuckets,
      } : undefined,
      nextActions: [
        '新增 regime / 日期桶 / 行业 / 市值 / 流动性分层 OOS 诊断。',
        '保持参数冻结和 auditHash，不通过调参追逐 OOS 通过。',
        'validationFailureTaxonomy 未 ready 前继续禁止交易动作。',
      ],
    }
  }

  private buildP5ClosureReviewReport(params: {
    postgresShadowReadinessReport: ScreenerPostgresShadowReadinessReport
    securityStatusCoverageReport: ScreenerSecurityStatusCoverageReport
    validationFailureTaxonomy: ScreenerValidationFailureTaxonomyReport
    p4ClosureReview: ScreenerP4ClosureReviewReport
  }): ScreenerP5ClosureReviewReport {
    const gates: ScreenerP5ClosureReviewReport['gates'] = [
      {
        id: 'postgres_shadow',
        label: 'PostgreSQL Shadow / staging',
        status: params.postgresShadowReadinessReport.status === 'ready' ? 'passed' : 'failed',
        severity: 'blocker',
        sourceArtifact: 'postgres_shadow_readiness_report.json',
        message: params.postgresShadowReadinessReport.status === 'ready'
          ? 'PostgreSQL shadow/staging 压测已 ready。'
          : `PostgreSQL shadow/staging 状态为 ${params.postgresShadowReadinessReport.status}。`,
      },
      {
        id: 'security_status_provider',
        label: '证券状态事实层',
        status: params.securityStatusCoverageReport.status === 'sufficient' ? 'passed' : 'warning',
        severity: params.securityStatusCoverageReport.status === 'sufficient' ? 'warning' : 'blocker',
        sourceArtifact: 'security_status_coverage_report.json',
        message: params.securityStatusCoverageReport.status === 'sufficient'
          ? '证券状态、停复牌和涨跌停价正式源覆盖已满足 P5。'
          : `证券状态覆盖状态为 ${params.securityStatusCoverageReport.status}；canonical 第一段可用，但正式交易状态源仍未闭环。`,
      },
      {
        id: 'validation_failure_taxonomy',
        label: '验证失败分类',
        status: params.validationFailureTaxonomy.status === 'ready_for_manual_review' ? 'passed' : 'warning',
        severity: params.validationFailureTaxonomy.status === 'ready_for_manual_review' ? 'warning' : 'blocker',
        sourceArtifact: 'validation_failure_taxonomy.json',
        message: params.validationFailureTaxonomy.status === 'ready_for_manual_review'
          ? 'OOS 失败分类支持进入人工复核。'
          : `OOS/validation 失败分类状态为 ${params.validationFailureTaxonomy.status}。`,
      },
      {
        id: 'p4_trading_gate',
        label: 'P4 交易建议边界',
        status: params.p4ClosureReview.decision === 'READY_FOR_MANUAL_REVIEW' ? 'passed' : 'failed',
        severity: 'blocker',
        sourceArtifact: 'p4_closure_review.json',
        message: params.p4ClosureReview.decision === 'READY_FOR_MANUAL_REVIEW'
          ? 'P4 允许进入人工复核。'
          : `P4 closure 决策为 ${params.p4ClosureReview.decision}，P5 不得放行交易建议。`,
      },
    ]
    const remainingBlockers = gates
      .filter((gate) => gate.severity === 'blocker' && gate.status !== 'passed')
      .map((gate) => `${gate.label}: ${gate.message}`)
    const productionReady = remainingBlockers.length === 0
    return {
      schemaVersion: 'fams.screener.p5_closure_review.v1',
      generatedAt: new Date().toISOString(),
      phase: 'P5',
      status: productionReady
        ? 'ready_for_next_phase'
        : params.securityStatusCoverageReport.status === 'partial'
          ? 'partial'
          : 'blocked_for_production',
      decision: productionReady
        ? 'READY_FOR_P6_REVIEW'
        : params.securityStatusCoverageReport.status === 'partial'
          ? 'P5_COMPLETE_RESEARCH_ONLY'
          : 'CONTINUE_P5',
      summary: {
        postgresShadowStatus: params.postgresShadowReadinessReport.status,
        securityStatusCoverageStatus: params.securityStatusCoverageReport.status,
        validationFailureTaxonomyStatus: params.validationFailureTaxonomy.status,
        p4Decision: params.p4ClosureReview.decision,
        productionReady,
      },
      gates,
      completedEvidence: [
        'P5 事实集缓存、批量刷新、调度租约和调度状态已完成第一段。',
        'P5.1 已把 Shadow PG、证券状态覆盖和 validation failure taxonomy 纳入 Operation artifact。',
        'P5.2 已落地 SecurityStatusDaily / MarketTradeabilityDaily canonical 事实表。',
        'P5.3 已将 quote-list canonical 多源身份数据接入证券状态事实层，并保留 provider/sourceRefs/confidence/warnings。',
        'P5.4 已新增 OOS 分层复验，按市场状态、行业和市值桶输出阻断证据。',
      ],
      remainingBlockers,
      nextActions: Array.from(new Set([
        ...params.postgresShadowReadinessReport.nextActions,
        ...params.securityStatusCoverageReport.nextActions,
        ...params.validationFailureTaxonomy.nextActions,
        ...params.p4ClosureReview.nextActions,
      ])),
      artifactRefs: [
        'postgres_shadow_readiness_report.json',
        'security_status_coverage_report.json',
        'validation_failure_taxonomy.json',
        'p4_closure_review.json',
        'oos_layered_validation.json',
      ],
    }
  }

  private parseSignalDate(value?: string) {
    if (!value) return null
    const date = new Date(`${value}T00:00:00.000Z`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  private classifyMarketFeatureWindow(summary: {
    avgReturn20d: number | null
    avgReturn60d: number | null
    avgMaxDrawdown20: number | null
    avgVolatility20: number | null
    avgTrendScore: number | null
    strongTrendBreadthPercent: number | null
    weakTrendBreadthPercent: number | null
  }) {
    if ((summary.avgReturn20d ?? 0) <= -5 || (summary.avgMaxDrawdown20 ?? 0) >= 10 || (summary.weakTrendBreadthPercent ?? 0) >= 45) {
      return '弱势回撤'
    }
    if ((summary.avgVolatility20 ?? 0) >= 3 || (summary.avgMaxDrawdown20 ?? 0) >= 7) {
      return '高波动震荡'
    }
    if ((summary.avgTrendScore ?? 0) >= 60 && (summary.strongTrendBreadthPercent ?? 0) >= 35 && (summary.avgReturn20d ?? 0) > 0) {
      return '强趋势'
    }
    return '震荡'
  }

  private async summarizeMarketFeatureWindow(startSignalDate?: string, endSignalDate?: string) {
    const start = this.parseSignalDate(startSignalDate)
    const end = this.parseSignalDate(endSignalDate)
    if (!start || !end) {
      return {
        status: 'insufficient' as const,
        startSignalDate,
        endSignalDate,
        tradingDays: 0,
        featureRows: 0,
        regime: '未知',
        warnings: ['缺少有效日期范围，无法诊断市场状态。'],
      }
    }
    const where = {
      market: 'CN',
      adjustType: 'none',
      dataVersion: 'canonical.v1',
      tradeDate: { gte: start, lte: end },
    }
    const [aggregate, tradingDays, strongTrendRows, weakTrendRows] = await Promise.all([
      prisma.marketFeatureDaily.aggregate({
        where,
        _count: { _all: true },
        _avg: {
          return20d: true,
          return60d: true,
          maxDrawdown20: true,
          maxDrawdown60: true,
          volatility20: true,
          volatility60: true,
          trendScore: true,
          momentumScore: true,
          liquidityScore: true,
        },
      }),
      prisma.marketFeatureDaily.groupBy({
        by: ['tradeDate'],
        where,
        _count: { _all: true },
      }),
      prisma.marketFeatureDaily.count({ where: { ...where, trendScore: { gte: 70 } } }),
      prisma.marketFeatureDaily.count({ where: { ...where, trendScore: { lte: 30 } } }),
    ])
    const featureRows = aggregate._count._all
    const strongTrendBreadthPercent = featureRows > 0 ? Number(((strongTrendRows / featureRows) * 100).toFixed(2)) : null
    const weakTrendBreadthPercent = featureRows > 0 ? Number(((weakTrendRows / featureRows) * 100).toFixed(2)) : null
    const summary = {
      avgReturn20d: aggregate._avg.return20d === null ? null : Number(aggregate._avg.return20d.toFixed(2)),
      avgReturn60d: aggregate._avg.return60d === null ? null : Number(aggregate._avg.return60d.toFixed(2)),
      avgMaxDrawdown20: aggregate._avg.maxDrawdown20 === null ? null : Number(aggregate._avg.maxDrawdown20.toFixed(2)),
      avgMaxDrawdown60: aggregate._avg.maxDrawdown60 === null ? null : Number(aggregate._avg.maxDrawdown60.toFixed(2)),
      avgVolatility20: aggregate._avg.volatility20 === null ? null : Number(aggregate._avg.volatility20.toFixed(2)),
      avgVolatility60: aggregate._avg.volatility60 === null ? null : Number(aggregate._avg.volatility60.toFixed(2)),
      avgTrendScore: aggregate._avg.trendScore === null ? null : Number(aggregate._avg.trendScore.toFixed(2)),
      avgMomentumScore: aggregate._avg.momentumScore === null ? null : Number(aggregate._avg.momentumScore.toFixed(2)),
      avgLiquidityScore: aggregate._avg.liquidityScore === null ? null : Number(aggregate._avg.liquidityScore.toFixed(2)),
      strongTrendBreadthPercent,
      weakTrendBreadthPercent,
    }
    return {
      status: featureRows > 0 ? 'computed' as const : 'insufficient' as const,
      startSignalDate,
      endSignalDate,
      tradingDays: tradingDays.length,
      featureRows,
      regime: this.classifyMarketFeatureWindow(summary),
      ...summary,
      warnings: featureRows > 0 ? [] : ['日期范围内缺少 market_feature_daily 横截面数据。'],
    }
  }

  private async buildOutOfSampleMarketStateDiagnostics(outOfSampleDiagnostics: {
    candidates: Array<{
      candidateId: string
      strategyId: ScreenerStrategyId
      outOfSampleStatus: 'passed' | 'failed' | 'insufficient'
      train: ScreenerValidationWindowSummary
      outOfSample: ScreenerValidationWindowSummary
    }>
  }) {
    const candidates = await Promise.all(outOfSampleDiagnostics.candidates.slice(0, 10).map(async (candidate) => {
      const [trainMarket, outOfSampleMarket] = await Promise.all([
        this.summarizeMarketFeatureWindow(candidate.train.startSignalDate, candidate.train.endSignalDate),
        this.summarizeMarketFeatureWindow(candidate.outOfSample.startSignalDate, candidate.outOfSample.endSignalDate),
      ])
      const return20dDelta = trainMarket.status === 'computed' && outOfSampleMarket.status === 'computed' && trainMarket.avgReturn20d !== null && outOfSampleMarket.avgReturn20d !== null
        ? Number((outOfSampleMarket.avgReturn20d - trainMarket.avgReturn20d).toFixed(2))
        : null
      const drawdown20Delta = trainMarket.status === 'computed' && outOfSampleMarket.status === 'computed' && trainMarket.avgMaxDrawdown20 !== null && outOfSampleMarket.avgMaxDrawdown20 !== null
        ? Number((outOfSampleMarket.avgMaxDrawdown20 - trainMarket.avgMaxDrawdown20).toFixed(2))
        : null
      const weakBreadthDelta = trainMarket.status === 'computed' && outOfSampleMarket.status === 'computed' && trainMarket.weakTrendBreadthPercent !== null && outOfSampleMarket.weakTrendBreadthPercent !== null
        ? Number((outOfSampleMarket.weakTrendBreadthPercent - trainMarket.weakTrendBreadthPercent).toFixed(2))
        : null
      const findings: string[] = []
      if (trainMarket.regime !== outOfSampleMarket.regime) findings.push(`市场状态从${trainMarket.regime}切换为${outOfSampleMarket.regime}`)
      if ((return20dDelta ?? 0) < -2) findings.push('样本外窗口全市场 20 日平均收益明显走弱')
      if ((drawdown20Delta ?? 0) > 2) findings.push('样本外窗口全市场 20 日平均回撤扩大')
      if ((weakBreadthDelta ?? 0) > 5) findings.push('样本外窗口弱趋势宽度上升')
      if (candidate.outOfSampleStatus === 'failed' && findings.length === 0) findings.push('样本外失败未由当前横截面市场状态指标解释，需要进一步检查信号日期分布或行业事实集')
      return {
        candidateId: candidate.candidateId,
        strategyId: candidate.strategyId,
        outOfSampleStatus: candidate.outOfSampleStatus,
        trainMarket,
        outOfSampleMarket,
        deltas: {
          return20dDelta,
          drawdown20Delta,
          weakBreadthDelta,
        },
        findings,
      }
    }))
    const globalFindings = Array.from(new Set(candidates.flatMap((item) => item.findings)))
    return {
      schemaVersion: 'fams.screener.oos_market_state_diagnostics.v1',
      generatedAt: new Date().toISOString(),
      source: 'market_feature_daily.cross_section',
      diagnosedCandidates: candidates.length,
      globalFindings,
      candidates,
    }
  }

  private buildValidationDecision(params: {
    longSampleAcceptance: ScreenerLongSampleAcceptanceReport
    outOfSampleDiagnostics: {
      diagnosedCandidates: number
      passedCount: number
      failedCount: number
      globalFindings?: string[]
    }
    outOfSampleMarketStateDiagnostics?: {
      globalFindings?: string[]
    }
  }): ScreenerValidationDecision {
    const blockerGates = params.longSampleAcceptance.gates.filter((gate) => gate.severity === 'blocker' && gate.status !== 'passed')
    const blockerGateIds = blockerGates.map((gate) => gate.id)
    const validationGate = params.longSampleAcceptance.gates.find((gate) => gate.id === 'validation_evidence')
    const factsetGate = params.longSampleAcceptance.gates.find((gate) => gate.id === 'factset_coverage')
    const reasons: string[] = []
    const requiredNextChecks: string[] = []

    if (params.longSampleAcceptance.status !== 'passed') {
      reasons.push(`长样本验收状态为 ${params.longSampleAcceptance.status}`)
    }
    if (validationGate?.status !== 'passed') {
      reasons.push('没有候选组合同时通过样本外、walk-forward、参数敏感性和分组稳定性验证')
      requiredNextChecks.push('复核 OOS 时间切分窗口和近期市场状态切换')
      requiredNextChecks.push('检查候选组合是否存在参数过拟合或只在训练窗口有效')
    }
    if (params.outOfSampleDiagnostics.failedCount > 0 && params.outOfSampleDiagnostics.passedCount === 0) {
      reasons.push(`样本外验证 ${params.outOfSampleDiagnostics.failedCount}/${params.outOfSampleDiagnostics.diagnosedCandidates} 未通过`)
      requiredNextChecks.push('比较训练窗口与样本外窗口的收益分布、超额收益和回撤')
    }
    if (factsetGate?.status !== 'passed') {
      reasons.push('行业/市值事实覆盖不足，分组稳定性解释需要降级')
      requiredNextChecks.push('补齐行业和市值事实集覆盖')
    }
    for (const finding of params.outOfSampleDiagnostics.globalFindings || []) {
      if (!reasons.includes(finding)) reasons.push(finding)
    }
    for (const finding of params.outOfSampleMarketStateDiagnostics?.globalFindings || []) {
      if (!reasons.includes(finding)) reasons.push(finding)
    }

    const usableForTradingAdvice = blockerGates.length === 0
    const decision: ScreenerValidationDecision['decision'] = usableForTradingAdvice
      ? 'TRADING_RESEARCH_ALLOWED'
      : params.longSampleAcceptance.summary.evaluatedCount > 0
        ? 'OBSERVE_ONLY'
        : 'INSUFFICIENT_DATA'

    return {
      schemaVersion: 'fams.screener.validation_decision.v1',
      generatedAt: new Date().toISOString(),
      decision,
      allowedActions: usableForTradingAdvice ? ['RESEARCH', 'OBSERVE', 'PAPER_TRADE'] : ['RESEARCH', 'OBSERVE'],
      prohibitedActions: usableForTradingAdvice ? ['AUTO_TRADE'] : ['ADD', 'REDUCE', 'AUTO_TRADE'],
      usableForTradingAdvice,
      confidence: usableForTradingAdvice && params.longSampleAcceptance.summary.bestCredibility !== 'unknown'
        ? params.longSampleAcceptance.summary.bestCredibility
        : params.longSampleAcceptance.summary.evaluatedCount > 0
          ? 'low'
          : 'insufficient',
      primaryBlocker: blockerGateIds[0],
      blockerGateIds,
      reasons: reasons.length > 0 ? reasons : ['长样本证据通过基础验收，仍需人工复核后进入交易计划草案。'],
      requiredNextChecks: Array.from(new Set(requiredNextChecks)),
      evidenceRefs: [
        'long_sample_acceptance.json',
        'out_of_sample_diagnostics.json',
        'out_of_sample_market_state.json',
        'oos_failure_analysis.json',
        'oos_layered_validation.json',
      ],
      oosSummary: {
        diagnosedCandidates: params.outOfSampleDiagnostics.diagnosedCandidates,
        passedCount: params.outOfSampleDiagnostics.passedCount,
        failedCount: params.outOfSampleDiagnostics.failedCount,
      },
      marketStateFindings: params.outOfSampleMarketStateDiagnostics?.globalFindings || [],
    }
  }

  private getFactsetPreheatCandidates(assets: ScreenableStockAsset[]) {
    return assets.filter((asset) => !asset.officialIndustryGroup || (!asset.totalMarketCap && !asset.floatMarketCap))
  }

  private parseNumberOption(query: string, names: string[], fallback?: number) {
    for (const name of names) {
      const match = query.match(new RegExp(`${name}\\s*[:=：]\\s*(\\d+(?:\\.\\d+)?)`, 'i'))
      if (match) return Number(match[1])
    }
    return fallback
  }

  private parseComparisonNumber(query: string, names: string[], direction: 'min' | 'max') {
    for (const name of names) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const direct = query.match(new RegExp(`${escapedName}\\s*[:=：]\\s*(\\d+(?:\\.\\d+)?)`, 'i'))
      if (direct) return Number(direct[1])
      const comparison = query.match(new RegExp(`${escapedName}\\s*(<=|>=|<|>|≤|≥)\\s*(\\d+(?:\\.\\d+)?)`, 'i'))
      if (comparison) {
        const operator = comparison[1]
        if (direction === 'max' && ['<', '<=', '≤'].includes(operator)) return Number(comparison[2])
        if (direction === 'min' && ['>', '>=', '≥'].includes(operator)) return Number(comparison[2])
      }
      const cn = query.match(new RegExp(`${escapedName}[^，；,;\\d]*(?:在)?\\s*(\\d+(?:\\.\\d+)?)\\s*(以下|以内|以内|低于|小于|以上|高于|大于)`, 'i'))
      if (cn) {
        const word = cn[2]
        if (direction === 'max' && /以下|以内|低于|小于/.test(word)) return Number(cn[1])
        if (direction === 'min' && /以上|高于|大于/.test(word)) return Number(cn[1])
      }
    }
    return undefined
  }

  private parseMarketCapOption(query: string, direction: 'min' | 'max') {
    const raw = this.parseComparisonNumber(query, ['marketCap', '总市值', '市值'], direction)
    if (raw === undefined) return undefined
    return /亿/.test(query) && raw < 1_000_000 ? raw * 100_000_000 : raw
  }

  parseOptions(query: string): ScreenerOptions {
    const strategyId = this.resolveStrategyId(query)
    return {
      maxUniverse: this.parseNumberOption(query, ['maxUniverse', '样本上限']),
      maxScan: this.parseNumberOption(query, ['maxScan', '扫描上限']),
      maxResults: this.parseNumberOption(query, ['maxResults', '返回数量', '结果上限', '候选上限'], 200)!,
      concurrency: Number(process.env.FAMS_SCREENER_CONCURRENCY || 24),
      marketDataMode: /允许实时行情\s*[:=：]?\s*(1|true|是)|allowLiveMarketFetch\s*[:=]\s*(1|true)/i.test(query)
        ? 'live_fetch'
        : (process.env.FAMS_SCREENER_MARKET_DATA_MODE === 'live_fetch' ? 'live_fetch' : 'cache_only'),
      strategyId,
      backtestDays: this.parseNumberOption(query, ['backtestDays', '回测天数', '验证天数'], 5)!,
      holdingDays: this.parseNumberOption(query, ['holdingDays', '持有天数'], 3)!,
      thresholds: {
        drawdownPercent: this.parseNumberOption(query, ['drawdown', '回撤阈值', '前高回撤'], this.defaultThresholds.drawdownPercent)!,
        sidewaysRangePercent: this.parseNumberOption(query, ['sideways', '横盘振幅', '振幅阈值'], this.defaultThresholds.sidewaysRangePercent)!,
        lastTwoVolumeRatio: this.parseNumberOption(query, ['volumeRatio', '量比阈值', '放量阈值'], this.defaultThresholds.lastTwoVolumeRatio)!,
        minHistoryDays: this.parseNumberOption(query, ['minHistoryDays', '最少K线'], this.defaultThresholds.minHistoryDays)!,
        reclaimVolumeRatio: this.parseNumberOption(query, ['reclaimVolumeRatio', '收复量比阈值'], this.defaultThresholds.reclaimVolumeRatio)!,
      },
      filters: {
        peMin: this.parseComparisonNumber(query, ['peMin', 'PE下限', '市盈率下限', 'PE', '市盈率'], 'min'),
        peMax: this.parseComparisonNumber(query, ['peMax', 'PE上限', '市盈率上限', 'PE', '市盈率'], 'max'),
        marketCapMin: this.parseMarketCapOption(query, 'min'),
        marketCapMax: this.parseMarketCapOption(query, 'max'),
        industryIncludes: query.match(/(?:行业|板块)\s*[:=：]\s*([^，；,;\s]+)/)?.[1],
      },
    }
  }

  private resolveStrategyId(query: string): ScreenerStrategyId {
    if (/突破|平台/.test(query)) return 'volume_platform_breakout'
    if (/均线|收复|站上/.test(query)) return 'ma_reclaim'
    return 'a_flush_sideways_volume'
  }

  private getSeries(history: Array<{ close: number; high: number; low: number; volume: number; source?: string }>) {
    const closes = history.map((item) => item.close).filter((value) => Number.isFinite(value) && value > 0)
    const highs = history.map((item) => item.high).filter((value) => Number.isFinite(value) && value > 0)
    const lows = history.map((item) => item.low).filter((value) => Number.isFinite(value) && value > 0)
    const volumes = history.map((item) => item.volume).filter((value) => Number.isFinite(value) && value >= 0)
    const currentPrice = closes[closes.length - 1]
    const recent20 = closes.slice(-20)
    const recentHigh = Math.max(...recent20)
    const recentLow = Math.min(...recent20)
    const rangeBase = recentLow || currentPrice || 1
    const sidewaysRangePercent = ((recentHigh - recentLow) / rangeBase) * 100
    const previousHigh = Math.max(...highs.slice(0, Math.max(1, highs.length - 20)))
    const drawdownPercent = previousHigh > 0 ? ((previousHigh - currentPrice) / previousHigh) * 100 : 0
    const lastTwoVolume = volumes.slice(-2)
    const baseVolumes = volumes.slice(Math.max(0, volumes.length - 22), Math.max(0, volumes.length - 2))
    const baseVolumeAvg = baseVolumes.reduce((sum, value) => sum + value, 0) / Math.max(baseVolumes.length, 1)
    const lastTwoVolumeAvg = lastTwoVolume.reduce((sum, value) => sum + value, 0) / Math.max(lastTwoVolume.length, 1)
    const lastTwoVolumeRatio = baseVolumeAvg > 0 ? lastTwoVolumeAvg / baseVolumeAvg : 0
    const support = lows.length > 0 ? Math.min(...lows.slice(-20)) : undefined
    const resistance = highs.length > 0 ? Math.max(...highs.slice(-20)) : undefined

    return {
      closes,
      highs,
      lows,
      volumes,
      currentPrice,
      recent20,
      recentHigh,
      recentLow,
      sidewaysRangePercent,
      drawdownPercent,
      lastTwoVolumeRatio,
      support,
      resistance,
      historySource: history.find((item) => item.source)?.source || 'unknown',
      historyDays: history.length,
    }
  }

  private buildMetric(params: {
    asset: Pick<ScreenableStockAsset, 'symbol' | 'name' | 'peDynamic' | 'pb' | 'totalMarketCap' | 'floatMarketCap'>
    history: Array<{ source?: string }>
    strategyId: ScreenerStrategyId
    matched: boolean
    score: number
    drawdownPercent: number
    sidewaysRangePercent: number
    lastTwoVolumeRatio: number
    support?: number
    resistance?: number
    currentPrice?: number
    matchedRules: string[]
    unmatchedReasons: string[]
    reason: string
    matchedAdvice: string
  }): ScreenerMetric {
    return {
      symbol: params.asset.symbol,
      name: params.asset.name,
      strategyId: params.strategyId,
      strategyMatched: params.matched,
      matched: params.matched,
      score: params.score,
      drawdownPercent: Number(params.drawdownPercent.toFixed(2)),
      sidewaysRangePercent: Number(params.sidewaysRangePercent.toFixed(2)),
      lastTwoVolumeRatio: Number(params.lastTwoVolumeRatio.toFixed(2)),
      support: params.support ? Number(params.support.toFixed(3)) : undefined,
      resistance: params.resistance ? Number(params.resistance.toFixed(3)) : undefined,
      currentPrice: params.currentPrice ? Number(params.currentPrice.toFixed(3)) : undefined,
      peDynamic: params.asset.peDynamic,
      pb: params.asset.pb,
      totalMarketCap: params.asset.totalMarketCap,
      floatMarketCap: params.asset.floatMarketCap,
      hardFilterPassed: true,
      hardFilterRules: [],
      hardFilterFailures: [],
      historySource: params.history.find((item) => item.source)?.source || 'unknown',
      historyDays: params.history.length,
      matchedRules: params.matchedRules,
      unmatchedReasons: params.unmatchedReasons,
      reason: params.reason,
      advice: params.matched
        ? params.matchedAdvice
        : `未完全满足当前选股条件：${params.unmatchedReasons.join('；')}。`,
    }
  }

  private applyManualFilters(metric: ScreenerMetric, asset: Partial<ScreenableStockAsset>, options: ScreenerOptions): ScreenerMetric {
    const rules: string[] = []
    const failures: string[] = []
    const pe = asset.peDynamic ?? metric.peDynamic
    const marketCap = asset.totalMarketCap ?? metric.totalMarketCap ?? asset.floatMarketCap ?? metric.floatMarketCap
    const industry = asset.officialIndustryGroup || asset.industry || asset.sector || ''

    if (options.filters.peMin !== undefined) {
      if (typeof pe === 'number' && pe >= options.filters.peMin) rules.push(`PE ${pe.toFixed(2)} >= ${options.filters.peMin}`)
      else failures.push(typeof pe === 'number' ? `PE ${pe.toFixed(2)} < ${options.filters.peMin}` : '缺少 PE 数据，无法通过 PE 下限')
    }
    if (options.filters.peMax !== undefined) {
      if (typeof pe === 'number' && pe <= options.filters.peMax) rules.push(`PE ${pe.toFixed(2)} <= ${options.filters.peMax}`)
      else failures.push(typeof pe === 'number' ? `PE ${pe.toFixed(2)} > ${options.filters.peMax}` : '缺少 PE 数据，无法通过 PE 上限')
    }
    if (options.filters.marketCapMin !== undefined) {
      if (typeof marketCap === 'number' && marketCap >= options.filters.marketCapMin) rules.push(`市值 ${this.formatMarketCap(marketCap)} >= ${this.formatMarketCap(options.filters.marketCapMin)}`)
      else failures.push(typeof marketCap === 'number' ? `市值 ${this.formatMarketCap(marketCap)} < ${this.formatMarketCap(options.filters.marketCapMin)}` : '缺少市值数据，无法通过市值下限')
    }
    if (options.filters.marketCapMax !== undefined) {
      if (typeof marketCap === 'number' && marketCap <= options.filters.marketCapMax) rules.push(`市值 ${this.formatMarketCap(marketCap)} <= ${this.formatMarketCap(options.filters.marketCapMax)}`)
      else failures.push(typeof marketCap === 'number' ? `市值 ${this.formatMarketCap(marketCap)} > ${this.formatMarketCap(options.filters.marketCapMax)}` : '缺少市值数据，无法通过市值上限')
    }
    if (options.filters.industryIncludes) {
      if (industry.includes(options.filters.industryIncludes)) rules.push(`行业/板块包含 ${options.filters.industryIncludes}`)
      else failures.push(industry ? `行业/板块 ${industry} 不包含 ${options.filters.industryIncludes}` : '缺少行业/板块数据，无法通过行业过滤')
    }

    if (rules.length === 0 && failures.length === 0) return metric
    return {
      ...metric,
      peDynamic: pe,
      totalMarketCap: marketCap,
      hardFilterPassed: failures.length === 0,
      hardFilterRules: rules,
      hardFilterFailures: failures,
      matched: metric.matched && failures.length === 0,
      score: failures.length === 0 ? metric.score : Math.max(0, metric.score - 40),
      matchedRules: [...metric.matchedRules, ...rules],
      unmatchedReasons: [...metric.unmatchedReasons, ...failures],
      advice: metric.matched && failures.length === 0
        ? metric.advice
        : `未完全满足当前选股条件：${[...metric.unmatchedReasons, ...failures].join('；')}。`,
    }
  }

  private async enrichPeForFilterCandidates(results: ScreenerMetric[], options: ScreenerOptions) {
    if (options.filters.peMin === undefined && options.filters.peMax === undefined) return results
    const needsPe = results.filter((item) =>
      item.strategyMatched !== false &&
      item.peDynamic === undefined &&
      (item.hardFilterFailures || []).some((failure) => failure.includes('缺少 PE 数据'))
    )
    if (needsPe.length === 0) return results
    const enrichedBySymbol = new Map<string, { peDynamic?: number; pb?: number; totalMarketCap?: number; floatMarketCap?: number }>()
    await this.mapWithConcurrency(needsPe, 4, async (item) => {
      try {
        const snapshot = await fundamentalDataProvider.getEastmoneyValuationSnapshot(item.symbol, 'A股')
        enrichedBySymbol.set(item.symbol, {
          peDynamic: snapshot?.peDynamic,
          pb: snapshot?.pb,
          totalMarketCap: snapshot?.totalMarketCap ?? item.totalMarketCap,
          floatMarketCap: snapshot?.floatMarketCap ?? item.floatMarketCap,
        })
      } catch {
        enrichedBySymbol.set(item.symbol, {})
      }
    })
    return results.map((item) => {
      const enriched = enrichedBySymbol.get(item.symbol)
      if (!enriched) return item
      const base: ScreenerMetric = {
        ...item,
        peDynamic: enriched.peDynamic,
        pb: enriched.pb ?? item.pb,
        totalMarketCap: enriched.totalMarketCap ?? item.totalMarketCap,
        floatMarketCap: enriched.floatMarketCap ?? item.floatMarketCap,
        matched: item.strategyMatched === true,
        unmatchedReasons: (item.unmatchedReasons || []).filter((reason) => !reason.includes('缺少 PE 数据')),
        hardFilterFailures: (item.hardFilterFailures || []).filter((reason) => !reason.includes('缺少 PE 数据')),
      }
      return this.applyManualFilters(base, {
        symbol: item.symbol,
        name: item.name,
        peDynamic: enriched.peDynamic,
        pb: enriched.pb,
        totalMarketCap: enriched.totalMarketCap,
        floatMarketCap: enriched.floatMarketCap,
      }, options)
    })
  }

  private formatMarketCap(value: number) {
    return value >= 100_000_000 ? `${(value / 100_000_000).toFixed(2)}亿` : value.toFixed(0)
  }

  private async buildResolvedStockUniverse(userId: string, options: { maxUniverse?: number; forceRefresh?: boolean } = {}) {
    const heldAssets = await prisma.asset.findMany({
      where: {
        positions: { some: { userId, status: 'open' } },
      },
      select: { symbol: true, name: true, type: true, sector: true, industry: true },
      orderBy: { symbol: 'asc' },
    })

    const resolvedAssets = await Promise.all(heldAssets.map(async (asset) => {
      const identity = await assetIdentityResolver.resolve(asset.symbol)
      return { asset, identity }
    }))

    const heldStocks: ScreenableStockAsset[] = []
    const excludedUniverse: ExcludedScreeningAsset[] = []

    for (const { asset, identity } of resolvedAssets) {
      if (identity.assetType === 'stock' && identity.market === 'CN') {
        heldStocks.push({
          symbol: identity.normalizedSymbol || asset.symbol,
          name: identity.name || asset.name,
          type: 'stock',
          market: identity.market,
          exchange: identity.exchange || undefined,
          sourceAssetType: asset.type,
          confidenceScore: identity.confidenceScore,
          universeSource: 'holding_resolver',
          sector: asset.sector || undefined,
          industry: asset.industry || undefined,
        })
        continue
      }

      excludedUniverse.push({
        symbol: identity.normalizedSymbol || asset.symbol,
        name: identity.name || asset.name,
        localType: asset.type,
        resolvedType: identity.assetType,
        market: identity.market,
        confidenceScore: identity.confidenceScore,
        reason: identity.assetType === 'stock'
          ? `选股当前只覆盖 A 股股票，${identity.market} 市场暂不进入样本池。`
          : `身份解析为 ${identity.assetType}，不按股票策略筛选。`,
      })
    }

    try {
      const allAshareStocks = await getAllAshareStocks(options.forceRefresh)
      const merged = await this.enrichUniverseWithCachedFundamentals(this.normalizeStockUniverse([
        ...allAshareStocks.map((item) => ({
          symbol: item.symbol,
          name: item.name,
          type: 'stock',
          market: item.market,
          exchange: item.exchange,
          confidenceScore: 0.98,
          universeSource: item.source,
        })),
        ...heldStocks,
      ], false))

      return {
        universe: options.maxUniverse && options.maxUniverse > 0 ? merged.slice(0, options.maxUniverse) : merged,
        excludedUniverse,
        universeSource: 'sina_hs_a_all_a_share',
        universeTotal: merged.length,
      }
    } catch (error) {
      const fallback = await this.enrichUniverseWithCachedFundamentals(this.normalizeStockUniverse(heldStocks, true))
      excludedUniverse.push({
        symbol: 'A_SHARE_UNIVERSE',
        name: '全A股样本池',
        localType: 'universe',
        resolvedType: 'unknown',
        market: 'CN',
        confidenceScore: 0,
        reason: `全A股样本池获取失败，已退回本地持仓和默认股票：${error instanceof Error ? error.message : 'unknown error'}`,
      })
      return {
        universe: options.maxUniverse && options.maxUniverse > 0 ? fallback.slice(0, options.maxUniverse) : fallback,
        excludedUniverse,
        universeSource: 'fallback_holdings_and_defaults',
        universeTotal: fallback.length,
      }
    }
  }

  async resolveStockUniverseForPreheat(userId: string, options: { maxUniverse?: number; forceRefresh?: boolean } = {}) {
    return this.buildResolvedStockUniverse(userId, options)
  }

  async preheatScreenerFactsets(
    userId: string,
    options: {
      maxScan?: number
      limit?: number
      concurrency?: number
      forceRefresh?: boolean
      symbols?: string[]
      offset?: number
      batchSize?: number
      perSymbolTimeoutMs?: number
      onProgress?: (progress: ScreenerFactsetPreheatReport['progress'][number]) => void
    } = {},
  ): Promise<ScreenerFactsetPreheatReport> {
    const startedAt = Date.now()
    const maxScan = Math.max(1, Math.min(6000, options.maxScan || 120))
    const limit = Math.max(0, Math.min(maxScan, options.limit ?? maxScan))
    const concurrency = Math.max(1, Math.min(6, options.concurrency || 2))
    const forceRefresh = options.forceRefresh === true
    const offset = Math.max(0, Math.min(maxScan - 1, options.offset || 0))
    const batchSize = Math.max(1, Math.min(1000, options.batchSize || Math.min(limit || maxScan, 300)))
    const perSymbolTimeoutMs = Math.max(1000, Math.min(120_000, options.perSymbolTimeoutMs || 20_000))
    const requestedSymbolSet = new Set((options.symbols || [])
      .map((symbol) => symbol.trim().toUpperCase())
      .filter(Boolean))
    const { universe, universeSource, universeTotal } = await this.buildResolvedStockUniverse(userId, {
      maxUniverse: requestedSymbolSet.size > 0 ? undefined : Math.max(maxScan, limit),
    })
    const scanUniverse = requestedSymbolSet.size > 0
      ? universe.filter((asset) => requestedSymbolSet.has(asset.symbol.toUpperCase())).slice(0, maxScan)
      : universe.slice(0, maxScan)
    const initialCoverage = this.buildFactsetPreheatCoverageReport({ universe, scanUniverse })
    const missingCandidates = this.getFactsetPreheatCandidates(scanUniverse)
    const candidateTargets = (forceRefresh ? scanUniverse : missingCandidates).slice(offset, offset + limit)
    const targets = candidateTargets.slice(0, limit)
    const failures: Array<{ symbol: string; name: string; error: string; category: string; elapsedMs: number }> = []
    const progress: ScreenerFactsetPreheatReport['progress'] = []
    let successSymbols = 0
    let attemptedSymbols = 0

    for (let start = 0; start < targets.length; start += batchSize) {
      const batchStartedAt = Date.now()
      const batch = targets.slice(start, start + batchSize)
      const batchFailures: typeof failures = []
      let batchImmediateSuccessSymbols = 0
      await this.mapWithConcurrency(batch, concurrency, async (asset) => {
        const symbolStartedAt = Date.now()
        attemptedSymbols += 1
        try {
          const factById = await this.withTimeout(
            this.preheatScreenerFundamentalFacts(asset),
            perSymbolTimeoutMs,
            `factset preheat timeout after ${perSymbolTimeoutMs}ms`
          )
          const industryBoard = this.normalizeIndustryBoard(factById.get('em_industry_board')?.value)
          const totalMarketCap = this.numberFactValue(factById.get('em_total_market_cap')?.value)
          const floatMarketCap = this.numberFactValue(factById.get('em_float_market_cap')?.value)
          if (!industryBoard || (!totalMarketCap && !floatMarketCap)) {
            batchFailures.push({
              symbol: asset.symbol,
              name: asset.name,
              error: [
                !industryBoard ? '缺少东方财富行业板块' : null,
                !totalMarketCap && !floatMarketCap ? '缺少总市值/流通市值' : null,
              ].filter(Boolean).join('；'),
              category: !industryBoard && !totalMarketCap && !floatMarketCap ? 'empty_factset' : !industryBoard ? 'industry_missing' : 'market_cap_missing',
              elapsedMs: Date.now() - symbolStartedAt,
            })
            return
          }
          successSymbols += 1
          batchImmediateSuccessSymbols += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          batchFailures.push({
            symbol: asset.symbol,
            name: asset.name,
            error: message,
            category: this.classifyFactsetPreheatFailure(message),
            elapsedMs: Date.now() - symbolStartedAt,
          })
        }
      })
      failures.push(...batchFailures)

      const batchScanUniverse = await this.enrichUniverseWithCachedFundamentals(scanUniverse)
      const batchCoverage = this.buildFactsetPreheatCoverageReport({
        universe,
        scanUniverse: batchScanUniverse,
        initial: (initialCoverage as { scanned?: unknown }).scanned,
      })
      const coveragePercent = typeof (batchCoverage as any)?.scanned?.fullOfficialCoveragePercent === 'number'
        ? (batchCoverage as any).scanned.fullOfficialCoveragePercent
        : null
      const batchCovered = new Set(batchScanUniverse
        .filter((asset) => Boolean(asset.officialIndustryGroup) && Boolean(asset.totalMarketCap || asset.floatMarketCap))
        .map((asset) => asset.symbol.toUpperCase()))
      const unresolvedBatchFailures = batchFailures.filter((failure) => !batchCovered.has(failure.symbol.toUpperCase()))
      const progressItem: ScreenerFactsetPreheatReport['progress'][number] = {
        batchIndex: progress.length + 1,
        batchStartOffset: offset + start,
        plannedSymbols: batch.length,
        attemptedSymbols: batch.length,
        immediateSuccessSymbols: batchImmediateSuccessSymbols,
        unresolvedFailureSymbols: unresolvedBatchFailures.length,
        elapsedMs: Date.now() - batchStartedAt,
        coveragePercent,
        failureCategorySummary: this.summarizeFactsetFailureCategories(batchFailures),
      }
      progress.push(progressItem)
      options.onProgress?.(progressItem)
    }

    const refreshedScanUniverse = await this.enrichUniverseWithCachedFundamentals(scanUniverse)
    const coveredAfterRefresh = new Set(refreshedScanUniverse
      .filter((asset) => Boolean(asset.officialIndustryGroup) && Boolean(asset.totalMarketCap || asset.floatMarketCap))
      .map((asset) => asset.symbol.toUpperCase()))
    const unresolvedFailures = failures.filter((failure) => !coveredAfterRefresh.has(failure.symbol.toUpperCase()))
    const recoveredFailureCount = failures.length - unresolvedFailures.length
    const finalSuccessSymbols = scanUniverse.filter((asset) => coveredAfterRefresh.has(asset.symbol.toUpperCase())).length
    const refreshedBySymbol = new Map(refreshedScanUniverse.map((asset) => [asset.symbol, asset]))
    const refreshedUniverse = universe.map((asset) => refreshedBySymbol.get(asset.symbol) || asset)
    const finalCoverage = this.buildFactsetPreheatCoverageReport({
      universe: refreshedUniverse,
      scanUniverse: refreshedScanUniverse,
      initial: (initialCoverage as { scanned?: unknown }).scanned,
      preheat: {
        planned: targets.length,
        attempted: attemptedSymbols,
        successCount: finalSuccessSymbols,
        immediateSuccessCount: successSymbols,
        failureCount: unresolvedFailures.length,
        recoveredFailureCount,
        forceRefresh,
        limit,
      },
    })
    const warnings = [
      ...((finalCoverage as { warnings?: string[] }).warnings || []),
      ...(universeSource !== 'sina_hs_a_all_a_share' ? [`股票池来源为 ${universeSource}，不能作为全 A 事实集覆盖验收`] : []),
      ...(unresolvedFailures.length > 0 ? [`事实集预热失败 ${unresolvedFailures.length} 个标的`] : []),
      ...(recoveredFailureCount > 0 ? [`事实集预热过程失败 ${recoveredFailureCount} 个标的，但最终缓存复核已覆盖`] : []),
    ]

    return {
      schemaVersion: 'fams.screener.factset_preheat_run.v1',
      generatedAt: new Date().toISOString(),
      userId,
      universeSource,
      universeTotal,
      requestedSymbols: scanUniverse.length,
      plannedSymbols: targets.length,
      attemptedSymbols,
      successSymbols: finalSuccessSymbols,
      failureSymbols: unresolvedFailures.length,
      nextOffset: Math.min(offset + attemptedSymbols, offset + candidateTargets.length),
      remainingTargetSymbols: Math.max(0, candidateTargets.length - attemptedSymbols),
      elapsedMs: Date.now() - startedAt,
      options: { maxScan, limit, concurrency, forceRefresh, offset, batchSize, perSymbolTimeoutMs, symbols: Array.from(requestedSymbolSet) },
      initialCoverage,
      finalCoverage,
      progress,
      failureCategorySummary: this.summarizeFactsetFailureCategories(failures),
      failures: unresolvedFailures.slice(0, 100),
      warnings,
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private classifyFactsetPreheatFailure(message: string) {
    const normalized = message.toLowerCase()
    if (normalized.includes('timeout') || normalized.includes('timed out')) return 'provider_timeout'
    if (normalized.includes('缺少东方财富行业板块')) return 'industry_missing'
    if (normalized.includes('缺少总市值') || normalized.includes('缺少总市值/流通市值')) return 'market_cap_missing'
    if (normalized.includes('未返回') || normalized.includes('empty')) return 'empty_reply'
    if (normalized.includes('network') || normalized.includes('econn') || normalized.includes('socket')) return 'provider_network'
    return 'provider_error'
  }

  private summarizeFactsetFailureCategories(failures: Array<{ category?: string }>) {
    return failures.reduce<Record<string, number>>((summary, item) => {
      const category = item.category || 'unknown'
      summary[category] = (summary[category] || 0) + 1
      return summary
    }, {})
  }

  private async preheatScreenerFundamentalFacts(asset: ScreenableStockAsset) {
    const snapshot = await fundamentalDataProvider.getEastmoneyQuoteListSnapshot(asset.symbol)
    const now = new Date()
    const staleAt = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const industryValue = snapshot?.industryName && snapshot.industryName !== '-'
      ? snapshot.industryName
      : null
    const facts = [
      {
        id: 'em_total_market_cap',
        section: 'fundamental',
        label: '总市值',
        value: snapshot?.totalMarketCap ?? null,
        source: snapshot?.source || 'FAMS quote-list canonical',
        asOf: now.toISOString(),
        quality: snapshot?.totalMarketCap !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'em_float_market_cap',
        section: 'fundamental',
        label: '流通市值',
        value: snapshot?.floatMarketCap ?? null,
        source: snapshot?.source || 'FAMS quote-list canonical',
        asOf: now.toISOString(),
        quality: snapshot?.floatMarketCap !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'em_pe_dynamic',
        section: 'fundamental',
        label: '动态市盈率',
        value: snapshot?.peDynamic ?? null,
        source: snapshot?.source || 'FAMS quote-list canonical',
        asOf: now.toISOString(),
        quality: snapshot?.peDynamic !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'em_pb',
        section: 'fundamental',
        label: '市净率',
        value: snapshot?.pb ?? null,
        source: snapshot?.source || 'FAMS quote-list canonical',
        asOf: now.toISOString(),
        quality: snapshot?.pb !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'em_industry_board',
        section: 'fundamental',
        label: '行业板块',
        value: industryValue,
        source: snapshot?.source || 'FAMS quote-list canonical',
        asOf: now.toISOString(),
        quality: industryValue ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
    ]
    const industryBoard = this.normalizeIndustryBoard(facts.find((fact) => fact.id === 'em_industry_board')?.value)
    const totalMarketCap = this.numberFactValue(facts.find((fact) => fact.id === 'em_total_market_cap')?.value)
    const floatMarketCap = this.numberFactValue(facts.find((fact) => fact.id === 'em_float_market_cap')?.value)
    if (!industryBoard && !totalMarketCap && !floatMarketCap) {
      return new Map(facts.map((fact) => [fact.id, fact]))
    }
    const factSet = {
      schemaVersion: 'stock.analysis.factset.v1',
      symbol: asset.symbol,
      market: 'A股',
      generatedAt: now.toISOString(),
      technical: {
        quality: 'insufficient_data',
        facts: [],
        warnings: ['选股预热只生成基础行业/市值事实，不生成技术面结论。'],
      },
      fundamental: {
        quality: facts.some((fact) => fact.id === 'em_industry_board' && fact.quality === 'ok') &&
          facts.some((fact) => (fact.id === 'em_total_market_cap' || fact.id === 'em_float_market_cap') && fact.quality === 'ok')
          ? 'ok'
          : 'insufficient_data',
        facts,
        warnings: [
          ...(snapshot ? [] : [`东方财富全 A 行情列表未返回 ${asset.symbol} 基础行业/市值事实。`]),
          '选股预热只写入行业/市值基础事实；完整基本面、技术面和消息面由持仓分析链路单独生成。',
        ],
      },
      news: {
        quality: 'insufficient_data',
        facts: [],
        warnings: ['选股预热不生成消息面结论。'],
      },
    }
    const warnings = [
      ...factSet.technical.warnings,
      ...factSet.fundamental.warnings,
      ...factSet.news.warnings,
    ]
    await prisma.stockFactSetCache.upsert({
      where: {
        symbol_market_factsetType_factsetSchemaVersion_lookbackDays_timeframe: {
          symbol: asset.symbol,
          market: 'A股',
          factsetType: 'stock_full_analysis',
          factsetSchemaVersion: 'stock.analysis.factset.v1',
          lookbackDays: 80,
          timeframe: '1d',
        },
      },
      create: {
        symbol: asset.symbol,
        market: 'A股',
        factsetType: 'stock_full_analysis',
        factsetSchemaVersion: 'stock.analysis.factset.v1',
        lookbackDays: 80,
        timeframe: '1d',
        status: 'partial',
        factsJson: JSON.stringify(factSet),
        warningsJson: JSON.stringify(warnings),
        generatedAt: now,
        staleAt,
        nextRefreshAfter: staleAt,
      },
      update: {
        status: 'partial',
        factsJson: JSON.stringify(factSet),
        warningsJson: JSON.stringify(warnings),
        generatedAt: now,
        staleAt,
        nextRefreshAfter: staleAt,
      },
    })
    return new Map(facts.map((fact) => [fact.id, fact]))
  }

  private async mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>
  ): Promise<R[]> {
    const results = new Array<R>(items.length)
    let nextIndex = 0
    async function worker() {
      while (nextIndex < items.length) {
        const index = nextIndex++
        results[index] = await mapper(items[index])
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))
    return results
  }

  evaluateAFlushSidewaysVolume(
    asset: Pick<ScreenableStockAsset, 'symbol' | 'name' | 'peDynamic' | 'pb' | 'totalMarketCap' | 'floatMarketCap'>,
    history: Array<{ close: number; high: number; low: number; volume: number; source?: string }>,
    thresholds: ScreenerThresholds = this.defaultThresholds
  ): ScreenerMetric {
    const series = this.getSeries(history)
    const matchedRules: string[] = []
    const unmatchedReasons: string[] = []
    let score = 0

    if (series.drawdownPercent >= thresholds.drawdownPercent) {
      score += 35
      matchedRules.push(`前高回撤 ${series.drawdownPercent.toFixed(1)}% >= ${thresholds.drawdownPercent}%`)
    } else {
      unmatchedReasons.push(`前高回撤 ${series.drawdownPercent.toFixed(1)}% < ${thresholds.drawdownPercent}%`)
    }

    if (series.sidewaysRangePercent <= thresholds.sidewaysRangePercent) {
      score += 35
      matchedRules.push(`近20日振幅 ${series.sidewaysRangePercent.toFixed(1)}% <= ${thresholds.sidewaysRangePercent}%`)
    } else {
      unmatchedReasons.push(`近20日振幅 ${series.sidewaysRangePercent.toFixed(1)}% > ${thresholds.sidewaysRangePercent}%`)
    }

    if (series.lastTwoVolumeRatio >= thresholds.lastTwoVolumeRatio) {
      score += 30
      matchedRules.push(`近2日量比 ${series.lastTwoVolumeRatio.toFixed(2)} >= ${thresholds.lastTwoVolumeRatio}`)
    } else {
      unmatchedReasons.push(`近2日量比 ${series.lastTwoVolumeRatio.toFixed(2)} < ${thresholds.lastTwoVolumeRatio}`)
    }

    const matched = unmatchedReasons.length === 0

    return this.buildMetric({
      asset,
      history,
      strategyId: 'a_flush_sideways_volume',
      matched,
      score,
      drawdownPercent: series.drawdownPercent,
      sidewaysRangePercent: series.sidewaysRangePercent,
      lastTwoVolumeRatio: series.lastTwoVolumeRatio,
      support: series.support,
      resistance: series.resistance,
      currentPrice: series.currentPrice,
      matchedRules,
      unmatchedReasons,
      reason: `A杀回撤 ${series.drawdownPercent.toFixed(1)}%，近20日振幅 ${series.sidewaysRangePercent.toFixed(1)}%，近2日量比 ${series.lastTwoVolumeRatio.toFixed(2)}。`,
      matchedAdvice: '满足形态初筛，适合进入人工复核清单；若回踩支撑不破且量能继续温和放大，可分批试探。',
    })
  }

  evaluateVolumePlatformBreakout(
    asset: Pick<ScreenableStockAsset, 'symbol' | 'name' | 'peDynamic' | 'pb' | 'totalMarketCap' | 'floatMarketCap'>,
    history: Array<{ close: number; high: number; low: number; volume: number; source?: string }>,
    thresholds: ScreenerThresholds = this.defaultThresholds
  ): ScreenerMetric {
    const series = this.getSeries(history)
    const platformHigh = Math.max(...series.highs.slice(-21, -1))
    const platformLow = Math.min(...series.lows.slice(-21, -1))
    const platformRangePercent = platformLow > 0 ? ((platformHigh - platformLow) / platformLow) * 100 : 999
    const breakoutPercent = platformHigh > 0 ? ((series.currentPrice - platformHigh) / platformHigh) * 100 : -999
    const matchedRules: string[] = []
    const unmatchedReasons: string[] = []
    let score = 0

    if (platformRangePercent <= thresholds.sidewaysRangePercent) {
      score += 30
      matchedRules.push(`平台振幅 ${platformRangePercent.toFixed(1)}% <= ${thresholds.sidewaysRangePercent}%`)
    } else {
      unmatchedReasons.push(`平台振幅 ${platformRangePercent.toFixed(1)}% > ${thresholds.sidewaysRangePercent}%`)
    }
    if (breakoutPercent > 0) {
      score += 40
      matchedRules.push(`最新收盘突破平台高点 ${breakoutPercent.toFixed(2)}%`)
    } else {
      unmatchedReasons.push(`最新收盘未突破平台高点，差 ${Math.abs(breakoutPercent).toFixed(2)}%`)
    }
    if (series.lastTwoVolumeRatio >= thresholds.lastTwoVolumeRatio) {
      score += 30
      matchedRules.push(`近2日量比 ${series.lastTwoVolumeRatio.toFixed(2)} >= ${thresholds.lastTwoVolumeRatio}`)
    } else {
      unmatchedReasons.push(`近2日量比 ${series.lastTwoVolumeRatio.toFixed(2)} < ${thresholds.lastTwoVolumeRatio}`)
    }

    return this.buildMetric({
      asset,
      history,
      strategyId: 'volume_platform_breakout',
      matched: unmatchedReasons.length === 0,
      score,
      drawdownPercent: series.drawdownPercent,
      sidewaysRangePercent: platformRangePercent,
      lastTwoVolumeRatio: series.lastTwoVolumeRatio,
      support: platformLow,
      resistance: platformHigh,
      currentPrice: series.currentPrice,
      matchedRules,
      unmatchedReasons,
      reason: `平台振幅 ${platformRangePercent.toFixed(1)}%，突破幅度 ${breakoutPercent.toFixed(2)}%，近2日量比 ${series.lastTwoVolumeRatio.toFixed(2)}。`,
      matchedAdvice: '满足放量突破平台初筛，适合关注突破后回踩平台高点是否有效支撑。',
    })
  }

  evaluateMaReclaim(
    asset: Pick<ScreenableStockAsset, 'symbol' | 'name' | 'peDynamic' | 'pb' | 'totalMarketCap' | 'floatMarketCap'>,
    history: Array<{ close: number; high: number; low: number; volume: number; source?: string }>,
    thresholds: ScreenerThresholds = this.defaultThresholds
  ): ScreenerMetric {
    const series = this.getSeries(history)
    const ma = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
    const currentMa20 = ma(series.closes.slice(-20))
    const previousMa20 = ma(series.closes.slice(-21, -1))
    const previousClose = series.closes[series.closes.length - 2]
    const currentAboveMa = series.currentPrice > currentMa20
    const previousBelowMa = previousClose < previousMa20
    const reclaimPercent = currentMa20 > 0 ? ((series.currentPrice - currentMa20) / currentMa20) * 100 : -999
    const matchedRules: string[] = []
    const unmatchedReasons: string[] = []
    let score = 0

    if (series.drawdownPercent >= Math.min(thresholds.drawdownPercent, 12)) {
      score += 25
      matchedRules.push(`阶段回撤 ${series.drawdownPercent.toFixed(1)}% 具备修复空间`)
    } else {
      unmatchedReasons.push(`阶段回撤 ${series.drawdownPercent.toFixed(1)}% 不足`)
    }
    if (previousBelowMa && currentAboveMa) {
      score += 45
      matchedRules.push(`前一日低于20日均线，最新收盘收复20日均线 ${reclaimPercent.toFixed(2)}%`)
    } else {
      unmatchedReasons.push('未形成从20日均线下方重新站上的结构')
    }
    if (series.lastTwoVolumeRatio >= thresholds.reclaimVolumeRatio) {
      score += 30
      matchedRules.push(`修复量比 ${series.lastTwoVolumeRatio.toFixed(2)} >= ${thresholds.reclaimVolumeRatio}`)
    } else {
      unmatchedReasons.push(`修复量比 ${series.lastTwoVolumeRatio.toFixed(2)} < ${thresholds.reclaimVolumeRatio}`)
    }

    return this.buildMetric({
      asset,
      history,
      strategyId: 'ma_reclaim',
      matched: unmatchedReasons.length === 0,
      score,
      drawdownPercent: series.drawdownPercent,
      sidewaysRangePercent: Math.abs(reclaimPercent),
      lastTwoVolumeRatio: series.lastTwoVolumeRatio,
      support: currentMa20,
      resistance: series.resistance,
      currentPrice: series.currentPrice,
      matchedRules,
      unmatchedReasons,
      reason: `阶段回撤 ${series.drawdownPercent.toFixed(1)}%，20日均线 ${currentMa20.toFixed(3)}，收复幅度 ${reclaimPercent.toFixed(2)}%，量比 ${series.lastTwoVolumeRatio.toFixed(2)}。`,
      matchedAdvice: '满足均线收复初筛，适合观察收复后的两到三个交易日能否站稳均线。',
    })
  }

  evaluateByStrategy(
    asset: ScreenableStockAsset | ScreenerBacktestAsset,
    history: Array<{ close: number; high: number; low: number; volume: number; source?: string }>,
    options: ScreenerOptions
  ): ScreenerMetric {
    let metric: ScreenerMetric
    if (options.strategyId === 'volume_platform_breakout') {
      metric = this.evaluateVolumePlatformBreakout(asset, history, options.thresholds)
    } else if (options.strategyId === 'ma_reclaim') {
      metric = this.evaluateMaReclaim(asset, history, options.thresholds)
    } else {
      metric = this.evaluateAFlushSidewaysVolume(asset, history, options.thresholds)
    }
    return this.applyManualFilters(metric, asset, options)
  }

  private buildFeatureMetric(params: {
    asset: Pick<ScreenableStockAsset, 'symbol' | 'name' | 'peDynamic' | 'pb' | 'totalMarketCap' | 'floatMarketCap'>
    feature: MarketFeatureDaily
    strategyId: ScreenerStrategyId
    matched: boolean
    score: number
    drawdownPercent: number
    sidewaysRangePercent: number
    lastTwoVolumeRatio: number
    support?: number | null
    resistance?: number | null
    matchedRules: string[]
    unmatchedReasons: string[]
    reason: string
    matchedAdvice: string
  }): ScreenerMetric {
    return {
      symbol: params.asset.symbol,
      name: params.asset.name,
      strategyId: params.strategyId,
      strategyMatched: params.matched,
      matched: params.matched,
      score: Math.round(params.score),
      drawdownPercent: Number(params.drawdownPercent.toFixed(2)),
      sidewaysRangePercent: Number(params.sidewaysRangePercent.toFixed(2)),
      lastTwoVolumeRatio: Number(params.lastTwoVolumeRatio.toFixed(2)),
      support: params.support ? Number(params.support.toFixed(3)) : undefined,
      resistance: params.resistance ? Number(params.resistance.toFixed(3)) : undefined,
      currentPrice: Number(params.feature.closePrice.toFixed(3)),
      peDynamic: params.asset.peDynamic,
      pb: params.asset.pb,
      totalMarketCap: params.asset.totalMarketCap,
      floatMarketCap: params.asset.floatMarketCap,
      hardFilterPassed: true,
      hardFilterRules: [],
      hardFilterFailures: [],
      historySource: 'feature:market_feature_daily',
      historyDays: 1,
      matchedRules: [
        ...params.matchedRules,
        `feature cache asOf=${params.feature.tradeDate.toISOString().slice(0, 10)}`,
      ],
      unmatchedReasons: params.unmatchedReasons,
      reason: `${params.reason}（当前筛选使用 market_feature_daily 预计算特征；回测仍使用 canonical K 线。）`,
      advice: params.matched
        ? params.matchedAdvice
        : `未完全满足当前选股条件：${params.unmatchedReasons.join('；')}。`,
    }
  }

  evaluateByFeatureStrategy(
    asset: ScreenableStockAsset | ScreenerBacktestAsset,
    feature: MarketFeatureDaily,
    options: ScreenerOptions
  ): ScreenerMetric {
    const high20 = feature.rollingHigh20 || feature.closePrice
    const low20 = feature.rollingLow20 || feature.closePrice
    const high60 = feature.rollingHigh60 || high20
    const low60 = feature.rollingLow60 || low20
    const drawdownPercent = feature.maxDrawdown60 ?? feature.maxDrawdown20 ?? 0
    const sidewaysRangePercent = low20 > 0 ? ((high20 - low20) / low20) * 100 : 999
    const lastTwoVolumeRatio = feature.volumeRatio20 || 0
    const matchedRules: string[] = []
    const unmatchedReasons: string[] = []
    let score = 0

    if (options.strategyId === 'volume_platform_breakout') {
      const breakoutPercent = high20 > 0 ? ((feature.closePrice - high20) / high20) * 100 : -999
      if (sidewaysRangePercent <= options.thresholds.sidewaysRangePercent) {
        score += 30
        matchedRules.push(`平台振幅 ${sidewaysRangePercent.toFixed(1)}% <= ${options.thresholds.sidewaysRangePercent}%`)
      } else {
        unmatchedReasons.push(`平台振幅 ${sidewaysRangePercent.toFixed(1)}% > ${options.thresholds.sidewaysRangePercent}%`)
      }
      if (breakoutPercent >= -0.2) {
        score += 40
        matchedRules.push(`最新价接近或突破20日高点 ${breakoutPercent.toFixed(2)}%`)
      } else {
        unmatchedReasons.push(`最新价未接近20日高点，差 ${Math.abs(breakoutPercent).toFixed(2)}%`)
      }
      if (lastTwoVolumeRatio >= options.thresholds.lastTwoVolumeRatio) {
        score += 30
        matchedRules.push(`量比 ${lastTwoVolumeRatio.toFixed(2)} >= ${options.thresholds.lastTwoVolumeRatio}`)
      } else {
        unmatchedReasons.push(`量比 ${lastTwoVolumeRatio.toFixed(2)} < ${options.thresholds.lastTwoVolumeRatio}`)
      }
      return this.applyManualFilters(this.buildFeatureMetric({
        asset,
        feature,
        strategyId: options.strategyId,
        matched: unmatchedReasons.length === 0,
        score,
        drawdownPercent,
        sidewaysRangePercent,
        lastTwoVolumeRatio,
        support: low20,
        resistance: high20,
        matchedRules,
        unmatchedReasons,
        reason: `平台振幅 ${sidewaysRangePercent.toFixed(1)}%，距20日高点 ${breakoutPercent.toFixed(2)}%，量比 ${lastTwoVolumeRatio.toFixed(2)}。`,
        matchedAdvice: '满足 feature-first 放量突破初筛，继续复核突破后成交质量和回踩平台有效性。',
      }), asset, options)
    }

    if (options.strategyId === 'ma_reclaim') {
      const reclaimPercent = feature.ma20 && feature.ma20 > 0 ? ((feature.closePrice - feature.ma20) / feature.ma20) * 100 : -999
      if (drawdownPercent >= Math.min(options.thresholds.drawdownPercent, 12)) {
        score += 25
        matchedRules.push(`阶段回撤 ${drawdownPercent.toFixed(1)}% 具备修复空间`)
      } else {
        unmatchedReasons.push(`阶段回撤 ${drawdownPercent.toFixed(1)}% 不足`)
      }
      if (feature.ma20 && feature.closePrice > feature.ma20 && (feature.ma20Slope ?? -999) >= 0) {
        score += 45
        matchedRules.push(`最新价位于20日均线上方，MA20斜率 ${Number(feature.ma20Slope || 0).toFixed(2)}%`)
      } else {
        unmatchedReasons.push('未形成站上20日均线且MA20斜率修复的结构')
      }
      if (lastTwoVolumeRatio >= options.thresholds.reclaimVolumeRatio) {
        score += 30
        matchedRules.push(`量比 ${lastTwoVolumeRatio.toFixed(2)} >= ${options.thresholds.reclaimVolumeRatio}`)
      } else {
        unmatchedReasons.push(`量比 ${lastTwoVolumeRatio.toFixed(2)} < ${options.thresholds.reclaimVolumeRatio}`)
      }
      return this.applyManualFilters(this.buildFeatureMetric({
        asset,
        feature,
        strategyId: options.strategyId,
        matched: unmatchedReasons.length === 0,
        score,
        drawdownPercent,
        sidewaysRangePercent: Math.abs(reclaimPercent),
        lastTwoVolumeRatio,
        support: feature.ma20,
        resistance: high20,
        matchedRules,
        unmatchedReasons,
        reason: `阶段回撤 ${drawdownPercent.toFixed(1)}%，20日均线 ${Number(feature.ma20 || 0).toFixed(3)}，收复幅度 ${reclaimPercent.toFixed(2)}%，量比 ${lastTwoVolumeRatio.toFixed(2)}。`,
        matchedAdvice: '满足 feature-first 均线收复初筛，继续观察站稳20日均线后的持续性。',
      }), asset, options)
    }

    if (drawdownPercent >= options.thresholds.drawdownPercent) {
      score += 35
      matchedRules.push(`阶段回撤 ${drawdownPercent.toFixed(1)}% >= ${options.thresholds.drawdownPercent}%`)
    } else {
      unmatchedReasons.push(`阶段回撤 ${drawdownPercent.toFixed(1)}% < ${options.thresholds.drawdownPercent}%`)
    }
    if (sidewaysRangePercent <= options.thresholds.sidewaysRangePercent) {
      score += 35
      matchedRules.push(`20日振幅 ${sidewaysRangePercent.toFixed(1)}% <= ${options.thresholds.sidewaysRangePercent}%`)
    } else {
      unmatchedReasons.push(`20日振幅 ${sidewaysRangePercent.toFixed(1)}% > ${options.thresholds.sidewaysRangePercent}%`)
    }
    if (lastTwoVolumeRatio >= options.thresholds.lastTwoVolumeRatio) {
      score += 30
      matchedRules.push(`量比 ${lastTwoVolumeRatio.toFixed(2)} >= ${options.thresholds.lastTwoVolumeRatio}`)
    } else {
      unmatchedReasons.push(`量比 ${lastTwoVolumeRatio.toFixed(2)} < ${options.thresholds.lastTwoVolumeRatio}`)
    }
    return this.applyManualFilters(this.buildFeatureMetric({
      asset,
      feature,
      strategyId: options.strategyId,
      matched: unmatchedReasons.length === 0,
      score,
      drawdownPercent,
      sidewaysRangePercent,
      lastTwoVolumeRatio,
      support: low60,
      resistance: high60,
      matchedRules,
      unmatchedReasons,
      reason: `阶段回撤 ${drawdownPercent.toFixed(1)}%，20日振幅 ${sidewaysRangePercent.toFixed(1)}%，量比 ${lastTwoVolumeRatio.toFixed(2)}。`,
      matchedAdvice: '满足 feature-first A杀后横盘放量初筛，适合进入人工复核清单。',
    }), asset, options)
  }

  evaluateStrategyTournament(
    records: Array<{ asset: { symbol: string; name: string }; history: StockHistoryData[] }>,
    options: ScreenerOptions
  ): ScreenerStrategyTournament {
    const evaluationDays = Math.max(1, Math.min(120, Math.floor(options.backtestDays || 5)))
    const holdingDays = Math.max(1, Math.min(10, Math.floor(options.holdingDays || 3)))
    const executionPolicies = this.buildExecutionPolicyVariants(holdingDays)
    const baseExecutionPolicy = executionPolicies.find((item) =>
      item.entryMode === 't1_open' &&
      item.exitMode === 'fixed_hold' &&
      item.holdingDays === holdingDays
    ) || executionPolicies[0]
    const benchmarkSummary = this.buildBenchmarkSummary(records, options, evaluationDays, baseExecutionPolicy)
    const benchmark = {
      samples: benchmarkSummary.samples,
      averageReturnPercent: benchmarkSummary.averageReturnPercent,
      winRatePercent: benchmarkSummary.winRatePercent,
    }
    const normalizedRecords = records.map((record) => ({
      ...record,
      validHistory: record.history.filter((item) =>
        Number.isFinite(item.close) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low) &&
        Number.isFinite(item.volume) &&
        item.close > 0
      ),
    }))
    const latestMetricCache = new Map<string, ScreenerMetric>()
    const getLatestMetric = (
      record: { asset: { symbol: string; name: string }; validHistory: StockHistoryData[] },
      strategyOptions: ScreenerOptions
    ) => {
      const cacheKey = `${strategyOptions.strategyId}:${record.asset.symbol}:latest`
      const cached = latestMetricCache.get(cacheKey)
      if (cached) return cached
      const metric = this.evaluateByStrategy(record.asset, record.validHistory, strategyOptions)
      latestMetricCache.set(cacheKey, metric)
      return metric
    }
    const signalMatchCache = new Map<string, Array<{ signalIndex: number; metric: ScreenerMetric }>>()
    const getSignalMatches = (
      record: { asset: { symbol: string; name: string }; validHistory: StockHistoryData[] },
      strategyOptions: ScreenerOptions,
      holdingDaysForSignal: number
    ) => {
      const cacheKey = `${strategyOptions.strategyId}:${record.asset.symbol}:${holdingDaysForSignal}:${evaluationDays}`
      const cached = signalMatchCache.get(cacheKey)
      if (cached) return cached
      const matches: Array<{ signalIndex: number; metric: ScreenerMetric }> = []
      for (let offset = 0; offset < evaluationDays; offset += 1) {
        const signalIndex = record.validHistory.length - 2 - holdingDaysForSignal - offset
        if (signalIndex < strategyOptions.thresholds.minHistoryDays - 1) continue
        const signalHistory = record.validHistory.slice(0, signalIndex + 1)
        const metric = this.evaluateByStrategy(record.asset, signalHistory, strategyOptions)
        if (metric.matched) matches.push({ signalIndex, metric })
      }
      signalMatchCache.set(cacheKey, matches)
      return matches
    }
    const signalStrategies = Object.keys(this.strategies) as ScreenerStrategyId[]
    const ranked = signalStrategies.flatMap((strategyId) => executionPolicies.map((executionPolicy) => {
      const candidateId = `${strategyId}__${executionPolicy.id}`
      const strategyOptions: ScreenerOptions = { ...options, strategyId, holdingDays: executionPolicy.holdingDays }
      const outcomes: ScreenerBacktestOutcome[] = []
      const blockedSamples: ScreenerBacktestOutcome[] = []
      const latestMatched: ScreenerMetric[] = []
      let evaluatedStocks = 0
      const candidateBenchmarkSummary = this.buildBenchmarkSummary(records, strategyOptions, evaluationDays, executionPolicy)
      const candidateBenchmarkAverageReturnPercent = candidateBenchmarkSummary.averageReturnPercent

      for (const record of normalizedRecords) {
        const validHistory = record.validHistory
        if (validHistory.length < options.thresholds.minHistoryDays + executionPolicy.holdingDays + 1) continue
        evaluatedStocks += 1

        const latestMetric = getLatestMetric(record, strategyOptions)
        if (latestMetric.matched) latestMatched.push(latestMetric)

        for (const { signalIndex, metric: signalMetric } of getSignalMatches(record, strategyOptions, executionPolicy.holdingDays)) {
          const outcome = this.buildBacktestOutcome({
            asset: record.asset,
            history: validHistory,
            signalIndex,
            executionPolicy,
            score: signalMetric.score,
          })
          if (outcome.blockedReason) blockedSamples.push(outcome)
          else outcomes.push(outcome)
        }
      }

      const wins = outcomes.filter((item) => item.win).length
      const losses = outcomes.length - wins
      const advancedMetrics = this.buildAdvancedMetrics(outcomes, candidateBenchmarkAverageReturnPercent, {
        includeEquityCurve: records.length <= 1000,
      })
      const definition = this.strategies[strategyId]
      const versionBundle = this.buildVersionBundle(strategyId, strategyOptions, executionPolicy)
      const shouldRunDeepValidation = records.length <= 1000 && (
        options.backtestDays < 60 || (
        outcomes.length >= 100 &&
        (advancedMetrics.excessReturnPercent ?? -Infinity) > 0
        )
      )
      const candidateBenchmarkOutcomes = shouldRunDeepValidation
        ? this.buildBenchmarkOutcomes(records, strategyOptions, evaluationDays, executionPolicy)
        : []
      const skippedSummary: ScreenerValidationWindowSummary = {
        sampleSize: outcomes.length,
        winRatePercent: outcomes.length > 0 ? Number(((wins / outcomes.length) * 100).toFixed(2)) : null,
        averageReturnPercent: advancedMetrics.averageReturnPercent,
        benchmarkAverageReturnPercent: candidateBenchmarkAverageReturnPercent,
        excessReturnPercent: advancedMetrics.excessReturnPercent,
      }
      const outOfSampleValidation = shouldRunDeepValidation
        ? this.buildOutOfSampleValidation(outcomes, candidateBenchmarkOutcomes)
        : {
          schemaVersion: 'fams.screener.oos_validation.v1' as const,
          method: 'chronological_70_30_split' as const,
          status: 'insufficient' as const,
          train: skippedSummary,
          outOfSample: { ...skippedSummary, sampleSize: 0 },
          warnings: [records.length > 1000
            ? '全 A 基础聚合阶段不内联深度样本外验证；需由后续 top-N 深度验证子任务补齐。'
            : '未达到深度样本外验证准入条件：需要至少 100 笔成交且扣费滑点后超额收益为正。'],
        }
      const walkForwardValidation = shouldRunDeepValidation
        ? this.buildWalkForwardValidation(outcomes, candidateBenchmarkOutcomes)
        : {
          schemaVersion: 'fams.screener.walk_forward.v1' as const,
          method: 'chronological_3_window_split' as const,
          status: 'insufficient' as const,
          passedWindows: 0,
          totalWindows: 0,
          windows: [],
          warnings: [records.length > 1000
            ? '全 A 基础聚合阶段不内联 walk-forward 验证；需由后续 top-N 深度验证子任务补齐。'
            : '未达到 walk-forward 验证准入条件。'],
        }
      const parameterSensitivity = shouldRunDeepValidation
        ? this.buildParameterSensitivity(records, strategyOptions, strategyId, evaluationDays, executionPolicy, candidateBenchmarkAverageReturnPercent)
        : {
          schemaVersion: 'fams.screener.parameter_sensitivity.v1' as const,
          method: 'local_threshold_grid_v2' as const,
          status: 'insufficient' as const,
          stableVariantCount: 0,
          totalVariants: 0,
          baseThresholds: this.normalizeThresholds(strategyOptions.thresholds),
          variants: [],
          warnings: [records.length > 1000
            ? '全 A 基础聚合阶段不内联参数敏感性验证；需由后续 top-N 深度验证子任务补齐。'
            : '未达到参数敏感性验证准入条件。'],
        }
      const groupStabilityValidation = shouldRunDeepValidation
        ? this.buildGroupStabilityValidation(outcomes, candidateBenchmarkAverageReturnPercent)
        : {
          schemaVersion: 'fams.screener.group_stability.v1' as const,
          method: 'post_trade_grouped_outcome_audit' as const,
          status: 'insufficient' as const,
          dimensions: [],
          warnings: [records.length > 1000
            ? '全 A 基础聚合阶段不内联分组稳定性验证；需由后续 top-N 深度验证子任务补齐。'
            : '未达到分组稳定性验证准入条件。'],
        }
      const auditHash = this.hashPayload({
        candidateId,
        versionBundle,
        outOfSampleValidation,
        walkForwardValidation,
        parameterSensitivity,
        groupStabilityValidation,
        evaluationDays,
        executionPolicy,
        benchmark: candidateBenchmarkAverageReturnPercent,
        metrics: {
          outcomeSummary: {
            total: outcomes.length,
            wins,
            losses,
            averageReturnPercent: advancedMetrics.averageReturnPercent,
            medianReturnPercent: advancedMetrics.medianReturnPercent,
            excessReturnPercent: advancedMetrics.excessReturnPercent,
            maxDrawdownPercent: advancedMetrics.maxDrawdownPercent,
            profitFactor: advancedMetrics.profitFactor,
            tailLossP95Percent: advancedMetrics.tailLossP95Percent,
            tailLossP99Percent: advancedMetrics.tailLossP99Percent,
          },
          outcomeSamples: outcomes.slice(0, 20).map((item) => ({
            symbol: item.symbol,
            signalDate: item.signalDate,
            entryDate: item.entryDate,
            exitDate: item.exitDate,
            returnPercent: item.returnPercent,
          })),
          blockedSummary: {
            total: blockedSamples.length,
          },
          blockedSamples: blockedSamples.slice(0, 20).map((item) => ({
            symbol: item.symbol,
            signalDate: item.signalDate,
            blockedReason: item.blockedReason,
          })),
        },
      })
      return {
        candidateId,
        strategyId,
        name: definition.name,
        description: definition.description,
        executionPolicy,
        signals: outcomes.length,
        wins,
        losses,
        winRatePercent: outcomes.length > 0 ? Number(((wins / outcomes.length) * 100).toFixed(2)) : null,
        averageReturnPercent: advancedMetrics.averageReturnPercent,
        bestReturnPercent: advancedMetrics.bestReturnPercent,
        worstReturnPercent: advancedMetrics.worstReturnPercent,
        benchmarkAverageReturnPercent: candidateBenchmarkAverageReturnPercent,
        excessReturnPercent: advancedMetrics.excessReturnPercent,
        sampleSize: outcomes.length + blockedSamples.length,
        tradeCount: outcomes.length,
        medianReturnPercent: advancedMetrics.medianReturnPercent,
        profitFactor: advancedMetrics.profitFactor,
        maxDrawdownPercent: advancedMetrics.maxDrawdownPercent,
        sharpe: advancedMetrics.sharpe,
        sortino: advancedMetrics.sortino,
        calmar: advancedMetrics.calmar,
        turnoverPercent: advancedMetrics.turnoverPercent,
        tailLossP95Percent: advancedMetrics.tailLossP95Percent,
        tailLossP99Percent: advancedMetrics.tailLossP99Percent,
        equityCurve: advancedMetrics.equityCurve,
        evaluatedStocks,
        latestMatchedCount: latestMatched.length,
        credibility: this.buildStrategyCredibility({
          signals: outcomes.length,
          wins,
          evaluatedStocks,
          totalRecords: records.length,
          providerHistoryRecords: benchmarkSummary.samples,
          excessReturnPercent: advancedMetrics.excessReturnPercent,
          maxDrawdownPercent: advancedMetrics.maxDrawdownPercent,
        }),
        latestCandidates: latestMatched
          .sort((a, b) => b.score - a.score || b.lastTwoVolumeRatio - a.lastTwoVolumeRatio)
          .slice(0, 3)
          .map((item) => ({
            symbol: item.symbol,
            name: item.name,
            score: item.score,
            reason: item.reason,
          })),
        samples: outcomes
          .sort((a, b) => b.score - a.score || b.returnPercent - a.returnPercent)
          .slice(0, 5),
        blockedSamples: blockedSamples.slice(0, 10),
        versionBundle,
        auditHash,
        outOfSampleValidation,
        walkForwardValidation,
        parameterSensitivity,
        groupStabilityValidation,
      }
    })).sort((a, b) =>
      (b.winRatePercent ?? -1) - (a.winRatePercent ?? -1) ||
      (b.averageReturnPercent ?? -999) - (a.averageReturnPercent ?? -999) ||
      b.latestMatchedCount - a.latestMatchedCount
    )
    const configuredDeepValidationLimit = Number(process.env.FAMS_SCREENER_DEEP_VALIDATION_TOP_N || 12)
    const fullUniverseDeepValidationLimit = records.length > 1000
      ? Math.max(3, Math.min(20, Number.isFinite(configuredDeepValidationLimit) ? Math.trunc(configuredDeepValidationLimit) : 12))
      : 0
    const deepValidatedCandidateIds: string[] = []
    if (fullUniverseDeepValidationLimit > 0) {
      for (const candidate of ranked.slice(0, fullUniverseDeepValidationLimit)) {
        const strategyOptions: ScreenerOptions = {
          ...options,
          strategyId: candidate.strategyId,
          holdingDays: candidate.executionPolicy.holdingDays,
        }
        const { outcomes, blockedSamples } = this.collectStrategyOutcomes(records, strategyOptions, evaluationDays, candidate.executionPolicy)
        const benchmarkOutcomesForCandidate = this.buildBenchmarkOutcomes(records, strategyOptions, evaluationDays, candidate.executionPolicy)
        const outOfSampleValidation = this.buildOutOfSampleValidation(outcomes, benchmarkOutcomesForCandidate)
        const walkForwardValidation = this.buildWalkForwardValidation(outcomes, benchmarkOutcomesForCandidate)
        const shouldRunExpensiveValidation =
          outOfSampleValidation.status === 'passed' &&
          walkForwardValidation.status === 'passed'
        const parameterSensitivity = shouldRunExpensiveValidation
          ? this.buildParameterSensitivity(
            records,
            strategyOptions,
            candidate.strategyId,
            evaluationDays,
            candidate.executionPolicy,
            candidate.benchmarkAverageReturnPercent,
          )
          : {
            schemaVersion: 'fams.screener.parameter_sensitivity.v1' as const,
            method: 'local_threshold_grid_v2' as const,
            status: 'insufficient' as const,
            stableVariantCount: 0,
            totalVariants: 0,
            baseThresholds: this.normalizeThresholds(strategyOptions.thresholds),
            variants: [],
            warnings: ['全 A 深度验证短路：OOS 或 walk-forward 未通过，未继续运行高成本参数敏感性；该候选不能通过 validation_evidence。'],
          }
        const groupStabilityValidation = this.buildGroupStabilityValidation(outcomes, candidate.benchmarkAverageReturnPercent)
        candidate.outOfSampleValidation = outOfSampleValidation
        candidate.walkForwardValidation = walkForwardValidation
        candidate.parameterSensitivity = parameterSensitivity
        candidate.groupStabilityValidation = groupStabilityValidation
        candidate.auditHash = this.hashPayload({
          candidateId: candidate.candidateId,
          versionBundle: candidate.versionBundle,
          outOfSampleValidation,
          walkForwardValidation,
          parameterSensitivity,
          groupStabilityValidation,
          evaluationDays,
          executionPolicy: candidate.executionPolicy,
          benchmark: candidate.benchmarkAverageReturnPercent,
          metrics: {
            outcomeSummary: {
              total: outcomes.length,
              wins: outcomes.filter((item) => item.win).length,
              blocked: blockedSamples.length,
              averageReturnPercent: candidate.averageReturnPercent,
              excessReturnPercent: candidate.excessReturnPercent,
              maxDrawdownPercent: candidate.maxDrawdownPercent,
            },
            outcomeSamples: outcomes.slice(0, 20).map((item) => ({
              symbol: item.symbol,
              signalDate: item.signalDate,
              entryDate: item.entryDate,
              exitDate: item.exitDate,
              returnPercent: item.returnPercent,
            })),
          },
        })
        deepValidatedCandidateIds.push(candidate.candidateId)
      }
    }

    return {
      evaluationDays,
      holdingDays,
      executionMatrix: {
        schemaVersion: 'fams.screener.execution_matrix.v1',
        signalStrategies,
        executionPolicies,
        totalCandidates: signalStrategies.length * executionPolicies.length,
      },
      generatedAt: new Date().toISOString(),
      benchmark,
      ranked,
      assumptions: this.buildBacktestAssumptions(),
      notes: [
        `胜率口径：最近 ${evaluationDays} 个可验证交易日内出现策略信号后，按入场策略矩阵执行，分别按 ${executionPolicies.map((item) => item.label).join(' / ')}，并扣除佣金、印花税和滑点。`,
        `基准口径：同一批可验证样本不筛选策略信号，按相同入场策略和对应退出策略后的平均净收益。`,
        '可信度评级会惩罚小样本、低覆盖率和相对基准无超额收益的策略；低可信结果不得作为买入依据。',
        ...(deepValidatedCandidateIds.length > 0
          ? [`全 A 基础聚合后已对 top-${deepValidatedCandidateIds.length} 候选组合补跑深度验证：${deepValidatedCandidateIds.join(', ')}。`]
          : []),
      ],
    }
  }

  private buildBenchmarkOutcomes(
    records: Array<{ asset: { symbol: string; name: string }; history: StockHistoryData[] }>,
    options: ScreenerOptions,
    evaluationDays: number,
    executionPolicy: ScreenerExecutionPolicyVariant
  ): ScreenerBacktestOutcome[] {
    const outcomes: ScreenerBacktestOutcome[] = []
    for (const record of records) {
      const validHistory = record.history.filter((item) =>
        Number.isFinite(item.close) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low) &&
        Number.isFinite(item.volume) &&
        item.close > 0
      )
      if (validHistory.length < options.thresholds.minHistoryDays + executionPolicy.holdingDays + 1) continue
      for (let offset = 0; offset < evaluationDays; offset += 1) {
        const signalIndex = validHistory.length - 2 - executionPolicy.holdingDays - offset
        if (signalIndex < options.thresholds.minHistoryDays - 1) continue
        const outcome = this.buildBacktestOutcome({
          asset: record.asset,
          history: validHistory,
          signalIndex,
          executionPolicy,
          score: 0,
        })
        if (!outcome.blockedReason) outcomes.push(outcome)
      }
    }
    return outcomes
  }

  private buildBenchmarkSummary(
    records: Array<{ asset: { symbol: string; name: string }; history: StockHistoryData[] }>,
    options: ScreenerOptions,
    evaluationDays: number,
    executionPolicy: ScreenerExecutionPolicyVariant
  ) {
    let samples = 0
    let wins = 0
    let returnSum = 0
    for (const record of records) {
      const validHistory = record.history.filter((item) =>
        Number.isFinite(item.close) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low) &&
        Number.isFinite(item.volume) &&
        item.close > 0
      )
      if (validHistory.length < options.thresholds.minHistoryDays + executionPolicy.holdingDays + 1) continue
      for (let offset = 0; offset < evaluationDays; offset += 1) {
        const signalIndex = validHistory.length - 2 - executionPolicy.holdingDays - offset
        if (signalIndex < options.thresholds.minHistoryDays - 1) continue
        const outcome = this.buildBacktestOutcome({
          asset: record.asset,
          history: validHistory,
          signalIndex,
          executionPolicy,
          score: 0,
        })
        if (outcome.blockedReason) continue
        samples += 1
        returnSum += outcome.returnPercent
        if (outcome.win) wins += 1
      }
    }
    const averageReturn = samples > 0 ? returnSum / samples : null
    return {
      samples,
      averageReturnPercent: averageReturn === null ? null : Number(averageReturn.toFixed(2)),
      winRatePercent: samples > 0 ? Number(((wins / samples) * 100).toFixed(2)) : null,
    }
  }

  private getBarAmount(bar: StockHistoryData) {
    const amount = (bar as StockHistoryData & { amount?: number }).amount
    if (Number.isFinite(amount) && (amount || 0) > 0) return amount || 0
    return (bar.volume || 0) * (bar.close || 0) * 100
  }

  private getMarketConstraintBlock(params: {
    asset: ScreenerBacktestAsset
    history: StockHistoryData[]
    signalIndex: number
    entryIndex: number
    exitIndex: number
  }) {
    const { asset, history, signalIndex, entryIndex, exitIndex } = params
    const signal = history[signalIndex]
    const entry = history[entryIndex]
    const exit = history[exitIndex]
    const previousEntry = history[entryIndex - 1]
    const previousExit = history[exitIndex - 1]

    const securityStatus = params.asset.securityStatusFact
    const tradeability = params.asset.tradeabilityFact
    if (securityStatus?.isDelisted || securityStatus?.listingStatus === 'delisted') {
      return `证券状态事实层退市风险标的排除（provider=${securityStatus.provider}, confidence=${securityStatus.confidence}）`
    }
    if (this.marketConstraints.excludeST && (securityStatus?.isSt || securityStatus?.riskFlag === 'st')) {
      return `证券状态事实层ST风险标的排除（provider=${securityStatus.provider}, confidence=${securityStatus.confidence}）`
    }
    if (this.marketConstraints.suspendedCannotTrade && (securityStatus?.isSuspended || tradeability?.isSuspended || tradeability?.tradabilityStatus === 'suspended')) {
      return `证券状态事实层停牌或不可交易（provider=${tradeability?.provider || securityStatus?.provider || 'unknown'}, confidence=${tradeability?.confidence ?? securityStatus?.confidence ?? 0}）`
    }
    if (this.marketConstraints.excludeST && /(^|\s|\*)ST|退/.test(asset.name)) return 'ST或退市风险标的排除'
    if (signalIndex + 1 < this.marketConstraints.minListingDays) return `上市交易日不足${this.marketConstraints.minListingDays}日`
    if (!entry || !exit || !signal) return '缺少入场或退出K线'
    if (this.marketConstraints.suspendedCannotTrade && (entry.volume <= 0 || exit.volume <= 0)) return '停牌或成交量为0'

    const entryAmount = this.getBarAmount(entry)
    const exitAmount = this.getBarAmount(exit)
    if (entryAmount < this.marketConstraints.minAmount || exitAmount < this.marketConstraints.minAmount) return '成交额不足，流动性不满足回测约束'

    const entryPrevClose = previousEntry?.close || signal.close
    const exitPrevClose = previousExit?.close || entry.close
    const entryChangePercent = entryPrevClose > 0 ? ((entry.close - entryPrevClose) / entryPrevClose) * 100 : 0
    const exitChangePercent = exitPrevClose > 0 ? ((exit.close - exitPrevClose) / exitPrevClose) * 100 : 0

    if (this.marketConstraints.limitUpCannotBuy && entryChangePercent >= 9.8 && entry.close >= entry.high * 0.999) return 'T+1涨停，按约束不可买入'
    if (this.marketConstraints.limitDownCannotSell && exitChangePercent <= -9.8 && exit.close <= exit.low * 1.001) return '退出日跌停，按约束不可卖出'
    return null
  }

  private getRegimeFilterBlock(executionPolicy: ScreenerExecutionPolicyVariant, groupContext: { marketRegime?: string; groupMetadata: ScreenerOutcomeGroupMetadata }) {
    if (executionPolicy.regimeFilterMode === 'none') return null
    const blockedRegimes = executionPolicy.blockedRegimes || []
    const marketRegime = groupContext.marketRegime || '未识别'
    if (executionPolicy.regimeFilterMode === 'avoid_high_volatility_chop' && blockedRegimes.includes(marketRegime)) {
      return `市场状态过滤：${marketRegime}不交易（method=${groupContext.groupMetadata.marketRegime.method}, confidence=${groupContext.groupMetadata.marketRegime.confidence}）`
    }
    return null
  }

  private calculateNetReturnPercent(entryOpen: number, exitClose: number, notional = 10000) {
    const buyPrice = entryOpen * (1 + this.costModel.slippageRate)
    const sellPrice = exitClose * (1 - this.costModel.slippageRate)
    const quantity = notional / buyPrice
    const buyCommission = Math.max(notional * this.costModel.commissionRate, this.costModel.minCommission)
    const grossSellValue = quantity * sellPrice
    const sellCommission = Math.max(grossSellValue * this.costModel.commissionRate, this.costModel.minCommission)
    const stampDuty = grossSellValue * this.costModel.stampDutySellRate
    const totalCost = notional + buyCommission
    const netProceeds = grossSellValue - sellCommission - stampDuty
    const grossReturnPercent = ((exitClose - entryOpen) / entryOpen) * 100
    const netReturnPercent = ((netProceeds - totalCost) / totalCost) * 100
    return {
      grossReturnPercent: Number(grossReturnPercent.toFixed(2)),
      returnPercent: Number(netReturnPercent.toFixed(2)),
      costPercent: Number((grossReturnPercent - netReturnPercent).toFixed(2)),
      entryPrice: Number(buyPrice.toFixed(3)),
      exitPrice: Number(sellPrice.toFixed(3)),
    }
  }

  private resolveBacktestEntry(entry: StockHistoryData | undefined, executionPolicy: ScreenerExecutionPolicyVariant) {
    const entryPrice = executionPolicy.entryMode === 't1_close' ? entry?.close : entry?.open
    return {
      entryPrice: entryPrice || 0,
      entryReason: executionPolicy.entryMode === 't1_close' ? 'T+1收盘买入' : 'T+1开盘买入',
    }
  }

  private resolvePositionSizing(history: StockHistoryData[], entryIndex: number, executionPolicy: ScreenerExecutionPolicyVariant) {
    if (executionPolicy.positionSizingMode !== 'volatility_scaled') {
      return {
        notional: this.backtestNotional,
        positionSizeMultiplier: 1,
        positionSizingReason: '等额本金',
      }
    }

    const lookback = history.slice(Math.max(0, entryIndex - 20), entryIndex)
    const returns = lookback.slice(1).map((bar, index) => {
      const previous = lookback[index]
      return previous?.close > 0 ? ((bar.close - previous.close) / previous.close) * 100 : 0
    }).filter((value) => Number.isFinite(value))
    if (returns.length < 5) {
      return {
        notional: Number((this.backtestNotional * 0.5).toFixed(2)),
        positionSizeMultiplier: 0.5,
        positionSizingReason: '波动率样本不足，按0.5倍本金',
      }
    }

    const average = returns.reduce((sum, value) => sum + value, 0) / returns.length
    const variance = returns.reduce((sum, value) => sum + ((value - average) ** 2), 0) / returns.length
    const annualizedVolatilityPercent = Math.sqrt(variance) * Math.sqrt(252)
    const rawMultiplier = annualizedVolatilityPercent <= 20
      ? 1
      : annualizedVolatilityPercent >= 40
        ? 0.5
        : 1 - ((annualizedVolatilityPercent - 20) / 20) * 0.5
    const positionSizeMultiplier = Number(Math.max(0.5, Math.min(1, rawMultiplier)).toFixed(2))
    return {
      notional: Number((this.backtestNotional * positionSizeMultiplier).toFixed(2)),
      positionSizeMultiplier,
      positionSizingReason: `近20日年化波动率${annualizedVolatilityPercent.toFixed(1)}%，按${positionSizeMultiplier}倍本金`,
    }
  }

  private inferMarketSegment(symbol: string): ScreenerOutcomeGroupMetadataItem {
    if (/^68/.test(symbol)) return { value: '科创板', provider: 'symbol_rule', method: 'symbol_prefix_exchange_board_v1', confidence: 0.98, warnings: [] }
    if (/^30/.test(symbol)) return { value: '创业板', provider: 'symbol_rule', method: 'symbol_prefix_exchange_board_v1', confidence: 0.98, warnings: [] }
    if (/^(8|4|9)/.test(symbol)) return { value: '北交所', provider: 'symbol_rule', method: 'symbol_prefix_exchange_board_v1', confidence: 0.95, warnings: [] }
    if (/^60/.test(symbol)) return { value: '沪市主板', provider: 'symbol_rule', method: 'symbol_prefix_exchange_board_v1', confidence: 0.98, warnings: [] }
    if (/^00/.test(symbol)) return { value: '深市主板', provider: 'symbol_rule', method: 'symbol_prefix_exchange_board_v1', confidence: 0.98, warnings: [] }
    return { value: '其他市场', provider: 'fallback_rule', method: 'symbol_prefix_exchange_board_v1', confidence: 0.4, warnings: ['无法从股票代码前缀识别标准市场板块'] }
  }

  private inferIndustryGroup(asset: Pick<ScreenableStockAsset, 'symbol' | 'name' | 'industry' | 'sector' | 'officialIndustryGroup' | 'officialIndustryCode' | 'metadataAsOf' | 'metadataWarnings'>): ScreenerOutcomeGroupMetadataItem {
    if (asset.officialIndustryGroup) {
      return {
        value: asset.officialIndustryCode ? `${asset.officialIndustryGroup}(${asset.officialIndustryCode})` : asset.officialIndustryGroup,
        provider: 'eastmoney_fundamental_cache',
        method: 'stock_factset_em_industry_board_v1',
        confidence: 0.88,
        warnings: asset.metadataWarnings || [],
        asOf: asset.metadataAsOf,
        sourceRefs: [`stock_factset:${asset.symbol}:em_industry_board`],
      }
    }
    if (asset.industry) return { value: asset.industry, provider: 'asset_metadata', method: 'asset_industry_field_v1', confidence: 0.9, warnings: [] }
    if (asset.sector) return { value: asset.sector, provider: 'asset_metadata', method: 'asset_sector_field_v1', confidence: 0.85, warnings: [] }
    const name = asset.name || ''
    const keywordWarning = ['行业来自名称关键词规则，后续需用正式行业分类数据源复核']
    if (/银行|证券|保险|金控/.test(name)) return { value: '金融', provider: 'name_keyword_rule', method: 'cn_stock_name_keyword_industry_v1', confidence: 0.65, warnings: keywordWarning }
    if (/医药|医疗|药|生物|医院/.test(name)) return { value: '医药生物', provider: 'name_keyword_rule', method: 'cn_stock_name_keyword_industry_v1', confidence: 0.65, warnings: keywordWarning }
    if (/酒|食品|饮料|乳业|调味/.test(name)) return { value: '消费', provider: 'name_keyword_rule', method: 'cn_stock_name_keyword_industry_v1', confidence: 0.65, warnings: keywordWarning }
    if (/汽车|锂|电池|新能源|光伏|电力/.test(name)) return { value: '新能源与制造', provider: 'name_keyword_rule', method: 'cn_stock_name_keyword_industry_v1', confidence: 0.65, warnings: keywordWarning }
    if (/软件|科技|电子|半导体|通信|计算机/.test(name)) return { value: '科技', provider: 'name_keyword_rule', method: 'cn_stock_name_keyword_industry_v1', confidence: 0.65, warnings: keywordWarning }
    if (/地产|建筑|建材|钢铁|煤炭|有色|化工/.test(name)) return { value: '周期', provider: 'name_keyword_rule', method: 'cn_stock_name_keyword_industry_v1', confidence: 0.65, warnings: keywordWarning }
    const lastDigit = Number(asset.symbol.slice(-1))
    if (Number.isFinite(lastDigit)) {
      return {
        value: ['金融', '消费', '医药生物', '新能源与制造', '科技', '周期', '公用事业', '工业', '材料', '其他'][lastDigit] || '其他',
        provider: 'fallback_rule',
        method: 'symbol_last_digit_placeholder_industry_v1',
        confidence: 0.2,
        warnings: ['行业为占位分组，仅用于避免所有样本落入同一桶；不得作为正式行业结论'],
      }
    }
    return { value: '未分类', provider: 'fallback_rule', method: 'unknown_industry_v1', confidence: 0.1, warnings: ['缺少行业元数据，无法识别行业分组'] }
  }

  private inferMarketCapGroup(
    history: StockHistoryData[],
    signalIndex: number,
    asset?: Pick<ScreenableStockAsset, 'symbol' | 'totalMarketCap' | 'floatMarketCap' | 'metadataAsOf' | 'metadataWarnings'>
  ): ScreenerOutcomeGroupMetadataItem {
    const marketCap = asset?.floatMarketCap || asset?.totalMarketCap
    if (marketCap && marketCap > 0) {
      const capKind = asset?.floatMarketCap ? '流通市值' : '总市值'
      const sourceRefs = [`stock_factset:${asset?.symbol || 'unknown'}:${asset?.floatMarketCap ? 'em_float_market_cap' : 'em_total_market_cap'}`]
      const warnings = asset?.metadataWarnings || []
      if (marketCap >= 500_000_000_000) return { value: '超大盘', provider: 'eastmoney_fundamental_cache', method: `stock_factset_${capKind}_bucket_v1`, confidence: 0.9, warnings, asOf: asset?.metadataAsOf, sourceRefs }
      if (marketCap >= 100_000_000_000) return { value: '大盘', provider: 'eastmoney_fundamental_cache', method: `stock_factset_${capKind}_bucket_v1`, confidence: 0.9, warnings, asOf: asset?.metadataAsOf, sourceRefs }
      if (marketCap >= 30_000_000_000) return { value: '中盘', provider: 'eastmoney_fundamental_cache', method: `stock_factset_${capKind}_bucket_v1`, confidence: 0.88, warnings, asOf: asset?.metadataAsOf, sourceRefs }
      return { value: '小盘', provider: 'eastmoney_fundamental_cache', method: `stock_factset_${capKind}_bucket_v1`, confidence: 0.86, warnings, asOf: asset?.metadataAsOf, sourceRefs }
    }
    const signalBar = history[signalIndex]
    const amount = signalBar ? this.getBarAmount(signalBar) : 0
    const warnings = ['市值分组当前使用成交额代理，后续需接入正式总市值/流通市值数据源']
    if (amount >= 3_000_000_000) return { value: '大盘高流动性', provider: 'liquidity_proxy', method: 'signal_day_amount_proxy_v1', confidence: 0.55, warnings }
    if (amount >= 800_000_000) return { value: '中盘流动性', provider: 'liquidity_proxy', method: 'signal_day_amount_proxy_v1', confidence: 0.5, warnings }
    if (amount >= this.marketConstraints.minAmount) return { value: '小盘低流动性', provider: 'liquidity_proxy', method: 'signal_day_amount_proxy_v1', confidence: 0.45, warnings }
    return { value: '流动性不足', provider: 'liquidity_proxy', method: 'signal_day_amount_proxy_v1', confidence: 0.6, warnings: ['成交额低于回测流动性约束；该分组不等同于正式小市值'] }
  }

  private inferMarketRegime(history: StockHistoryData[], signalIndex: number): ScreenerOutcomeGroupMetadataItem {
    const window = history.slice(Math.max(0, signalIndex - 20), signalIndex + 1)
    if (window.length < 10) return { value: '样本不足', provider: 'price_regime_rule', method: 'local_price_window_regime_v1', confidence: 0.2, warnings: ['价格窗口少于 10 根K线，无法可靠识别市场状态'] }
    const first = window[0]?.close || 0
    const last = window[window.length - 1]?.close || 0
    const lows = window.map((bar) => bar.low).filter((value) => Number.isFinite(value) && value > 0)
    const highs = window.map((bar) => bar.high).filter((value) => Number.isFinite(value) && value > 0)
    const low = lows.length > 0 ? Math.min(...lows) : last
    const high = highs.length > 0 ? Math.max(...highs) : last
    const trendPercent = first > 0 ? ((last - first) / first) * 100 : 0
    const rangePercent = low > 0 ? ((high - low) / low) * 100 : 0
    const warnings = ['市场状态基于标的自身近20日价格窗口，不代表全市场 regime']
    if (trendPercent >= 8) return { value: '强趋势', provider: 'price_regime_rule', method: 'local_price_window_regime_v1', confidence: 0.7, warnings }
    if (trendPercent <= -8) return { value: '弱势回撤', provider: 'price_regime_rule', method: 'local_price_window_regime_v1', confidence: 0.7, warnings }
    if (rangePercent >= 18) return { value: '高波动震荡', provider: 'price_regime_rule', method: 'local_price_window_regime_v1', confidence: 0.65, warnings }
    return { value: '窄幅震荡', provider: 'price_regime_rule', method: 'local_price_window_regime_v1', confidence: 0.65, warnings }
  }

  private buildOutcomeGroupContext(params: {
    asset: ScreenerBacktestAsset
    history: StockHistoryData[]
    signalIndex: number
  }) {
    const marketSegment = this.inferMarketSegment(params.asset.symbol)
    const industryGroup = this.inferIndustryGroup(params.asset)
    const marketCapGroup = this.inferMarketCapGroup(params.history, params.signalIndex, params.asset)
    const marketRegime = this.inferMarketRegime(params.history, params.signalIndex)
    return {
      marketSegment: marketSegment.value,
      industryGroup: industryGroup.value,
      marketCapGroup: marketCapGroup.value,
      marketRegime: marketRegime.value,
      groupMetadata: {
        schemaVersion: 'fams.screener.group_metadata.v1' as const,
        marketSegment,
        industryGroup,
        marketCapGroup,
        marketRegime,
      },
    }
  }

  private buildBacktestOutcome(params: {
    asset: ScreenerBacktestAsset
    history: StockHistoryData[]
    signalIndex: number
    executionPolicy: ScreenerExecutionPolicyVariant
    score: number
  }): ScreenerBacktestOutcome {
    const entryIndex = params.signalIndex + 1
    const maxExitIndex = entryIndex + params.executionPolicy.holdingDays
    const signal = params.history[params.signalIndex]
    const entry = params.history[entryIndex]
    const resolvedEntry = this.resolveBacktestEntry(entry, params.executionPolicy)
    const resolvedSizing = this.resolvePositionSizing(params.history, entryIndex, params.executionPolicy)
    const selectedExit = this.resolveBacktestExit(params.history, entryIndex, maxExitIndex, params.executionPolicy, resolvedEntry.entryPrice)
    const exitIndex = selectedExit.exitIndex
    const exit = params.history[exitIndex]
    const groupContext = this.buildOutcomeGroupContext({
      asset: params.asset,
      history: params.history,
      signalIndex: params.signalIndex,
    })
    const blockedReason = this.getRegimeFilterBlock(params.executionPolicy, groupContext) || this.getMarketConstraintBlock({
      asset: params.asset,
      history: params.history,
      signalIndex: params.signalIndex,
      entryIndex,
      exitIndex,
    })
    if (blockedReason || !entry || !exit) {
      return {
        symbol: params.asset.symbol,
        name: params.asset.name,
        ...groupContext,
        signalDate: signal?.date,
        entryDate: entry?.date,
        exitDate: exit?.date,
        entryPrice: resolvedEntry.entryPrice ? Number(resolvedEntry.entryPrice.toFixed(3)) : 0,
        exitPrice: selectedExit.exitPrice ? Number(selectedExit.exitPrice.toFixed(3)) : (exit?.close ? Number(exit.close.toFixed(3)) : 0),
        grossReturnPercent: 0,
        returnPercent: 0,
        win: false,
        score: params.score,
        blockedReason: blockedReason || '缺少可成交K线',
        entryReason: resolvedEntry.entryReason,
        exitReason: selectedExit.exitReason,
        notional: resolvedSizing.notional,
        positionSizeMultiplier: resolvedSizing.positionSizeMultiplier,
        positionSizingReason: resolvedSizing.positionSizingReason,
      }
    }

    const net = this.calculateNetReturnPercent(resolvedEntry.entryPrice, selectedExit.exitPrice, resolvedSizing.notional)
    return {
      symbol: params.asset.symbol,
      name: params.asset.name,
      ...groupContext,
      signalDate: signal?.date,
      entryDate: entry.date,
      exitDate: exit.date,
      entryPrice: net.entryPrice,
      exitPrice: net.exitPrice,
      grossReturnPercent: net.grossReturnPercent,
      returnPercent: net.returnPercent,
      win: net.returnPercent > 0,
      score: params.score,
      costPercent: net.costPercent,
      entryReason: resolvedEntry.entryReason,
      exitReason: selectedExit.exitReason,
      notional: resolvedSizing.notional,
      positionSizeMultiplier: resolvedSizing.positionSizeMultiplier,
      positionSizingReason: resolvedSizing.positionSizingReason,
    }
  }

  private resolveBacktestExit(
    history: StockHistoryData[],
    entryIndex: number,
    maxExitIndex: number,
    executionPolicy: ScreenerExecutionPolicyVariant,
    entryPrice: number,
  ) {
    const entry = history[entryIndex]
    const fallbackExit = history[maxExitIndex]
    if (!entry || !fallbackExit) {
      return {
        exitIndex: maxExitIndex,
        exitPrice: fallbackExit?.close || 0,
        exitReason: '缺少可成交K线',
      }
    }

    if (executionPolicy.exitMode === 'fixed_hold') {
      return {
        exitIndex: maxExitIndex,
        exitPrice: fallbackExit.close,
        exitReason: `固定持有${executionPolicy.holdingDays}日`,
      }
    }

    if (executionPolicy.exitMode === 'trailing_stop') {
      const trailingStopPercent = executionPolicy.trailingStopPercent || 8
      let highWaterMark = Math.max(entryPrice, entry.high)
      for (let index = entryIndex; index <= maxExitIndex; index += 1) {
        const bar = history[index]
        if (!bar) break
        highWaterMark = Math.max(highWaterMark, bar.high)
        const trailingStopPrice = highWaterMark * (1 - trailingStopPercent / 100)
        if (bar.low <= trailingStopPrice) {
          return {
            exitIndex: index,
            exitPrice: trailingStopPrice,
            exitReason: `触发移动止盈${trailingStopPercent}%`,
          }
        }
      }
      return {
        exitIndex: maxExitIndex,
        exitPrice: fallbackExit.close,
        exitReason: `未触发移动止盈，固定持有${executionPolicy.holdingDays}日`,
      }
    }

    const stopLossPrice = executionPolicy.stopLossPercent
      ? entryPrice * (1 - executionPolicy.stopLossPercent / 100)
      : null
    const takeProfitPrice = executionPolicy.takeProfitPercent
      ? entryPrice * (1 + executionPolicy.takeProfitPercent / 100)
      : null

    for (let index = entryIndex; index <= maxExitIndex; index += 1) {
      const bar = history[index]
      if (!bar) break
      if (stopLossPrice !== null && bar.low <= stopLossPrice) {
        return {
          exitIndex: index,
          exitPrice: stopLossPrice,
          exitReason: `触发止损${executionPolicy.stopLossPercent}%`,
        }
      }
      if (takeProfitPrice !== null && bar.high >= takeProfitPrice) {
        return {
          exitIndex: index,
          exitPrice: takeProfitPrice,
          exitReason: `触发止盈${executionPolicy.takeProfitPercent}%`,
        }
      }
    }

    return {
      exitIndex: maxExitIndex,
      exitPrice: fallbackExit.close,
      exitReason: `未触发止盈止损，固定持有${executionPolicy.holdingDays}日`,
    }
  }

  private median(values: number[]) {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  }

  private stddev(values: number[]) {
    if (values.length < 2) return 0
    const average = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1)
    return Math.sqrt(variance)
  }

  private percentile(values: number[], percentile: number) {
    if (values.length === 0) return null
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((percentile / 100) * sorted.length) - 1))
    return sorted[index]
  }

  private buildEquityCurve(returns: number[], initialCapital = 100000, includeCurve = true) {
    let equity = initialCapital
    let peak = initialCapital
    let maxDrawdown = 0
    const curve: Array<{ index: number; value: number; drawdownPercent: number }> = []
    returns.forEach((returnPercent, index) => {
      equity *= 1 + returnPercent / 100
      peak = Math.max(peak, equity)
      const drawdownPercent = peak > 0 ? ((equity - peak) / peak) * 100 : 0
      maxDrawdown = Math.min(maxDrawdown, drawdownPercent)
      if (includeCurve) {
        curve.push({
          index: index + 1,
          value: Number(equity.toFixed(2)),
          drawdownPercent: Number(drawdownPercent.toFixed(2)),
        })
      }
    })
    return { curve, maxDrawdownPercent: Number(Math.abs(maxDrawdown).toFixed(2)) }
  }

  private buildAdvancedMetrics(
    outcomes: ScreenerBacktestOutcome[],
    benchmarkAverageReturnPercent: number | null,
    options: { includeEquityCurve?: boolean } = {},
  ) {
    const returns = outcomes.map((item) => item.returnPercent)
    const average = returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : null
    const wins = outcomes.filter((item) => item.returnPercent > 0)
    const losses = outcomes.filter((item) => item.returnPercent <= 0)
    const grossProfit = wins.reduce((sum, item) => sum + item.returnPercent, 0)
    const grossLoss = Math.abs(losses.reduce((sum, item) => sum + item.returnPercent, 0))
    const downside = returns.filter((value) => value < 0)
    const std = this.stddev(returns)
    const downsideStd = this.stddev(downside)
    const equity = this.buildEquityCurve(returns, 100000, options.includeEquityCurve !== false)
    const medianReturn = this.median(returns)
    const tailLossP95 = this.percentile(returns, 5)
    const tailLossP99 = this.percentile(returns, 1)
    const excessReturnPercent = average === null || benchmarkAverageReturnPercent === null
      ? null
      : average - benchmarkAverageReturnPercent
    return {
      averageReturnPercent: average === null ? null : Number(average.toFixed(2)),
      medianReturnPercent: medianReturn === null ? null : Number(medianReturn.toFixed(2)),
      bestReturnPercent: returns.length > 0 ? Number(Math.max(...returns).toFixed(2)) : null,
      worstReturnPercent: returns.length > 0 ? Number(Math.min(...returns).toFixed(2)) : null,
      excessReturnPercent: excessReturnPercent === null ? null : Number(excessReturnPercent.toFixed(2)),
      profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? Number(grossProfit.toFixed(2)) : null,
      maxDrawdownPercent: returns.length > 0 ? equity.maxDrawdownPercent : null,
      sharpe: average === null || std === 0 ? null : Number((average / std).toFixed(2)),
      sortino: average === null || downsideStd === 0 ? null : Number((average / downsideStd).toFixed(2)),
      calmar: average === null || !equity.maxDrawdownPercent ? null : Number((average / equity.maxDrawdownPercent).toFixed(2)),
      turnoverPercent: Number((outcomes.length * 100).toFixed(2)),
      tailLossP95Percent: tailLossP95 === null ? null : Number(tailLossP95.toFixed(2)),
      tailLossP99Percent: tailLossP99 === null ? null : Number(tailLossP99.toFixed(2)),
      equityCurve: equity.curve,
    }
  }

  private buildWindowSummary(
    outcomes: ScreenerBacktestOutcome[],
    benchmarkAverageReturnPercent: number | null
  ): ScreenerValidationWindowSummary {
    const sortedDates = outcomes
      .map((item) => item.signalDate)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .sort()
    const wins = outcomes.filter((item) => item.win).length
    const average = outcomes.length > 0
      ? outcomes.reduce((sum, item) => sum + item.returnPercent, 0) / outcomes.length
      : null
    const excess = average === null || benchmarkAverageReturnPercent === null
      ? null
      : average - benchmarkAverageReturnPercent
    return {
      sampleSize: outcomes.length,
      startSignalDate: sortedDates[0],
      endSignalDate: sortedDates[sortedDates.length - 1],
      winRatePercent: outcomes.length > 0 ? Number(((wins / outcomes.length) * 100).toFixed(2)) : null,
      averageReturnPercent: average === null ? null : Number(average.toFixed(2)),
      benchmarkAverageReturnPercent,
      excessReturnPercent: excess === null ? null : Number(excess.toFixed(2)),
    }
  }

  private buildOutOfSampleValidation(
    outcomes: ScreenerBacktestOutcome[],
    benchmarkOutcomes: ScreenerBacktestOutcome[]
  ): ScreenerOutOfSampleValidation {
    const sortedOutcomes = [...outcomes].sort((a, b) =>
      this.parseDateOrFallback(a.signalDate, new Date(0)).getTime() -
      this.parseDateOrFallback(b.signalDate, new Date(0)).getTime()
    )
    const sortedBenchmark = [...benchmarkOutcomes].sort((a, b) =>
      this.parseDateOrFallback(a.signalDate, new Date(0)).getTime() -
      this.parseDateOrFallback(b.signalDate, new Date(0)).getTime()
    )
    const splitIndex = Math.max(1, Math.floor(sortedOutcomes.length * 0.7))
    const benchmarkSplitIndex = Math.max(1, Math.floor(sortedBenchmark.length * 0.7))
    const train = sortedOutcomes.slice(0, splitIndex)
    const outOfSample = sortedOutcomes.slice(splitIndex)
    const benchmarkTrain = sortedBenchmark.slice(0, benchmarkSplitIndex)
    const benchmarkOutOfSample = sortedBenchmark.slice(benchmarkSplitIndex)
    const benchmarkTrainAverage = benchmarkTrain.length > 0
      ? Number((benchmarkTrain.reduce((sum, item) => sum + item.returnPercent, 0) / benchmarkTrain.length).toFixed(2))
      : null
    const benchmarkOutAverage = benchmarkOutOfSample.length > 0
      ? Number((benchmarkOutOfSample.reduce((sum, item) => sum + item.returnPercent, 0) / benchmarkOutOfSample.length).toFixed(2))
      : null
    const trainSummary = this.buildWindowSummary(train, benchmarkTrainAverage)
    const outSummary = this.buildWindowSummary(outOfSample, benchmarkOutAverage)
    const warnings: string[] = []

    if (outcomes.length < 30) warnings.push(`可执行样本 ${outcomes.length} < 30，样本外验证仅作审计记录`)
    if (outOfSample.length < 10) warnings.push(`样本外窗口 ${outOfSample.length} < 10，稳定性不足`)
    if (outSummary.excessReturnPercent !== null && outSummary.excessReturnPercent <= 0) warnings.push('样本外超额收益不为正')
    if (trainSummary.averageReturnPercent !== null && outSummary.averageReturnPercent !== null && outSummary.averageReturnPercent < trainSummary.averageReturnPercent * 0.5) {
      warnings.push('样本外平均收益显著低于训练窗口')
    }

    let status: ScreenerOutOfSampleValidation['status'] = 'insufficient'
    if (outcomes.length >= 30 && outOfSample.length >= 10) {
      status = outSummary.excessReturnPercent !== null && outSummary.excessReturnPercent > 0 ? 'passed' : 'failed'
    }

    return {
      schemaVersion: 'fams.screener.oos_validation.v1',
      method: 'chronological_70_30_split',
      status,
      train: trainSummary,
      outOfSample: outSummary,
      warnings,
    }
  }

  private buildWalkForwardValidation(
    outcomes: ScreenerBacktestOutcome[],
    benchmarkOutcomes: ScreenerBacktestOutcome[]
  ): ScreenerWalkForwardValidation {
    const sortedOutcomes = [...outcomes].sort((a, b) =>
      this.parseDateOrFallback(a.signalDate, new Date(0)).getTime() -
      this.parseDateOrFallback(b.signalDate, new Date(0)).getTime()
    )
    const sortedBenchmark = [...benchmarkOutcomes].sort((a, b) =>
      this.parseDateOrFallback(a.signalDate, new Date(0)).getTime() -
      this.parseDateOrFallback(b.signalDate, new Date(0)).getTime()
    )
    const windowCount = 3
    const windows: ScreenerWalkForwardWindow[] = []

    for (let index = 0; index < windowCount; index += 1) {
      const start = Math.floor((sortedOutcomes.length * index) / windowCount)
      const end = Math.floor((sortedOutcomes.length * (index + 1)) / windowCount)
      const benchmarkStart = Math.floor((sortedBenchmark.length * index) / windowCount)
      const benchmarkEnd = Math.floor((sortedBenchmark.length * (index + 1)) / windowCount)
      const windowOutcomes = sortedOutcomes.slice(start, end)
      const benchmarkWindow = sortedBenchmark.slice(benchmarkStart, benchmarkEnd)
      const benchmarkAverage = benchmarkWindow.length > 0
        ? Number((benchmarkWindow.reduce((sum, item) => sum + item.returnPercent, 0) / benchmarkWindow.length).toFixed(2))
        : null
      const summary = this.buildWindowSummary(windowOutcomes, benchmarkAverage)
      const status: ScreenerWalkForwardWindow['status'] = windowOutcomes.length < 10
        ? 'insufficient'
        : summary.excessReturnPercent !== null && summary.excessReturnPercent > 0
          ? 'passed'
          : 'failed'
      windows.push({
        windowIndex: index + 1,
        startSignalDate: windowOutcomes[0]?.signalDate,
        endSignalDate: windowOutcomes[windowOutcomes.length - 1]?.signalDate,
        summary,
        status,
      })
    }

    const warnings: string[] = []
    const usableWindows = windows.filter((window) => window.status !== 'insufficient')
    const passedWindows = windows.filter((window) => window.status === 'passed').length
    if (outcomes.length < 30) warnings.push(`可执行样本 ${outcomes.length} < 30，walk-forward 仅作审计记录`)
    if (usableWindows.length < 2) warnings.push('可用窗口少于 2 个，无法判断跨窗口稳定性')
    if (usableWindows.length >= 2 && passedWindows < Math.ceil(usableWindows.length / 2)) warnings.push('通过窗口数不足，策略跨窗口稳定性不足')

    let status: ScreenerWalkForwardValidation['status'] = 'insufficient'
    if (outcomes.length >= 30 && usableWindows.length >= 2) {
      status = passedWindows >= Math.ceil(usableWindows.length / 2) ? 'passed' : 'failed'
    }

    return {
      schemaVersion: 'fams.screener.walk_forward.v1',
      method: 'chronological_3_window_split',
      status,
      passedWindows,
      totalWindows: windows.length,
      windows,
      warnings,
    }
  }

  private normalizeThresholds(thresholds: ScreenerThresholds): ScreenerThresholds {
    return {
      drawdownPercent: Number(Math.max(1, thresholds.drawdownPercent).toFixed(2)),
      sidewaysRangePercent: Number(Math.max(1, thresholds.sidewaysRangePercent).toFixed(2)),
      lastTwoVolumeRatio: Number(Math.max(0.1, thresholds.lastTwoVolumeRatio).toFixed(2)),
      minHistoryDays: Math.max(10, Math.floor(thresholds.minHistoryDays)),
      reclaimVolumeRatio: Number(Math.max(0.1, thresholds.reclaimVolumeRatio).toFixed(2)),
    }
  }

  private buildThresholdVariants(strategyId: ScreenerStrategyId, thresholds: ScreenerThresholds) {
    const base = this.normalizeThresholds(thresholds)
    const variants = new Map<string, { variantId: string; thresholds: ScreenerThresholds }>()
    const pushVariant = (variantId: string, variantThresholds: ScreenerThresholds) => {
      const normalized = this.normalizeThresholds(variantThresholds)
      const key = JSON.stringify(normalized)
      if (!variants.has(key)) variants.set(key, { variantId, thresholds: normalized })
    }
    pushVariant('base', base)

    if (strategyId === 'ma_reclaim') {
      const volumeGrid = [
        { id: 'looser_reclaim_volume', value: base.reclaimVolumeRatio - 0.2 },
        { id: 'base_reclaim_volume', value: base.reclaimVolumeRatio },
        { id: 'stricter_reclaim_volume', value: base.reclaimVolumeRatio + 0.2 },
      ]
      const drawdownGrid = [
        { id: 'looser_drawdown', value: base.drawdownPercent - 2 },
        { id: 'base_drawdown', value: base.drawdownPercent },
        { id: 'stricter_drawdown', value: base.drawdownPercent + 2 },
      ]
      for (const volume of volumeGrid) {
        for (const drawdown of drawdownGrid) {
          const variantId = volume.id === 'base_reclaim_volume' && drawdown.id === 'base_drawdown'
            ? 'base'
            : `${volume.id}__${drawdown.id}`
          pushVariant(variantId, {
            ...base,
            reclaimVolumeRatio: volume.value,
            drawdownPercent: drawdown.value,
          })
        }
      }
    } else {
      const volumeGrid = [
        { id: 'looser_volume', value: base.lastTwoVolumeRatio - 0.3 },
        { id: 'base_volume', value: base.lastTwoVolumeRatio },
        { id: 'stricter_volume', value: base.lastTwoVolumeRatio + 0.3 },
      ]
      const sidewaysGrid = [
        { id: 'stricter_sideways', value: base.sidewaysRangePercent - 2 },
        { id: 'base_sideways', value: base.sidewaysRangePercent },
        { id: 'looser_sideways', value: base.sidewaysRangePercent + 2 },
      ]
      for (const volume of volumeGrid) {
        for (const sideways of sidewaysGrid) {
          const variantId = volume.id === 'base_volume' && sideways.id === 'base_sideways'
            ? 'base'
            : `${volume.id}__${sideways.id}`
          pushVariant(variantId, {
            ...base,
            lastTwoVolumeRatio: volume.value,
            sidewaysRangePercent: sideways.value,
          })
        }
      }
    }
    return Array.from(variants.values()).sort((left, right) => {
      if (left.variantId === 'base') return -1
      if (right.variantId === 'base') return 1
      return left.variantId.localeCompare(right.variantId)
    })
  }

  private collectStrategyOutcomes(
    records: Array<{ asset: ScreenerBacktestAsset; history: StockHistoryData[] }>,
    options: ScreenerOptions,
    evaluationDays: number,
    executionPolicy: ScreenerExecutionPolicyVariant
  ) {
    const outcomes: ScreenerBacktestOutcome[] = []
    const blockedSamples: ScreenerBacktestOutcome[] = []
    for (const record of records) {
      const validHistory = record.history.filter((item) =>
        Number.isFinite(item.close) &&
        Number.isFinite(item.high) &&
        Number.isFinite(item.low) &&
        Number.isFinite(item.volume) &&
        item.close > 0
      )
      if (validHistory.length < options.thresholds.minHistoryDays + executionPolicy.holdingDays + 1) continue

      for (let offset = 0; offset < evaluationDays; offset += 1) {
        const signalIndex = validHistory.length - 2 - executionPolicy.holdingDays - offset
        if (signalIndex < options.thresholds.minHistoryDays - 1) continue
        const signalHistory = validHistory.slice(0, signalIndex + 1)
        const signalMetric = this.evaluateByStrategy(record.asset, signalHistory, options)
        if (!signalMetric.matched) continue
        const outcome = this.buildBacktestOutcome({
          asset: record.asset,
          history: validHistory,
          signalIndex,
          executionPolicy,
          score: signalMetric.score,
        })
        if (outcome.blockedReason) blockedSamples.push(outcome)
        else outcomes.push(outcome)
      }
    }
    return { outcomes, blockedSamples }
  }

  private buildParameterSensitivity(
    records: Array<{ asset: { symbol: string; name: string }; history: StockHistoryData[] }>,
    options: ScreenerOptions,
    strategyId: ScreenerStrategyId,
    evaluationDays: number,
    executionPolicy: ScreenerExecutionPolicyVariant,
    benchmarkAverageReturnPercent: number | null
  ): ScreenerParameterSensitivity {
    const variants = this.buildThresholdVariants(strategyId, options.thresholds).map((variant) => {
      const variantOptions: ScreenerOptions = {
        ...options,
        strategyId,
        thresholds: variant.thresholds,
      }
      const { outcomes, blockedSamples } = this.collectStrategyOutcomes(records, variantOptions, evaluationDays, executionPolicy)
      const wins = outcomes.filter((item) => item.win).length
      const metrics = this.buildAdvancedMetrics(outcomes, benchmarkAverageReturnPercent)
      const status: ScreenerParameterSensitivityVariant['status'] = outcomes.length < 10
        ? 'insufficient'
        : (metrics.excessReturnPercent ?? 0) > 0
          ? 'passed'
          : 'failed'
      return {
        variantId: variant.variantId,
        thresholds: variant.thresholds,
        sampleSize: outcomes.length + blockedSamples.length,
        tradeCount: outcomes.length,
        winRatePercent: outcomes.length > 0 ? Number(((wins / outcomes.length) * 100).toFixed(2)) : null,
        averageReturnPercent: metrics.averageReturnPercent,
        excessReturnPercent: metrics.excessReturnPercent,
        maxDrawdownPercent: metrics.maxDrawdownPercent,
        status,
      }
    })
    const usable = variants.filter((item) => item.status !== 'insufficient')
    const stableVariantCount = variants.filter((item) => item.status === 'passed').length
    const warnings: string[] = []
    if (usable.length < 3) warnings.push('可用参数变体少于 3 个，参数敏感性仅作审计记录')
    if (usable.length >= 3 && stableVariantCount < Math.ceil(usable.length / 2)) warnings.push('通过参数变体不足，策略可能对阈值敏感')

    let status: ScreenerParameterSensitivity['status'] = 'insufficient'
    if (usable.length >= 3) {
      status = stableVariantCount >= Math.ceil(usable.length / 2) ? 'passed' : 'failed'
    }

    return {
      schemaVersion: 'fams.screener.parameter_sensitivity.v1',
      method: 'local_threshold_grid_v2',
      status,
      stableVariantCount,
      totalVariants: variants.length,
      baseThresholds: this.normalizeThresholds(options.thresholds),
      variants,
      warnings,
    }
  }

  private buildGroupStabilityValidation(
    outcomes: ScreenerBacktestOutcome[],
    benchmarkAverageReturnPercent: number | null
  ): ScreenerGroupStabilityValidation {
    const dimensions: ScreenerStabilityDimension[] = [
      this.buildStabilityDimension('market_regime', '市场状态', outcomes, benchmarkAverageReturnPercent, (item) => item.marketRegime || '未识别'),
      this.buildStabilityDimension('market_segment', '市场板块', outcomes, benchmarkAverageReturnPercent, (item) => item.marketSegment || '未识别'),
      this.buildStabilityDimension('industry_group', '行业分组', outcomes, benchmarkAverageReturnPercent, (item) => item.industryGroup || '未识别'),
      this.buildStabilityDimension('market_cap_group', '市值/流动性代理', outcomes, benchmarkAverageReturnPercent, (item) => item.marketCapGroup || '未识别'),
    ]
    const usableDimensions = dimensions.filter((item) => item.status !== 'insufficient')
    const passedDimensions = usableDimensions.filter((item) => item.status === 'passed').length
    const warnings: string[] = []
    if (outcomes.length < 30) warnings.push(`可执行样本 ${outcomes.length} < 30，分组稳定性仅作审计记录`)
    for (const dimension of dimensions) {
      warnings.push(...dimension.warnings.map((warning) => `${dimension.label}: ${warning}`))
    }

    let status: ScreenerGroupStabilityValidation['status'] = 'insufficient'
    if (outcomes.length >= 30 && usableDimensions.length >= 2) {
      status = passedDimensions >= Math.ceil(usableDimensions.length / 2) ? 'passed' : 'failed'
    }

    return {
      schemaVersion: 'fams.screener.group_stability.v1',
      method: 'post_trade_grouped_outcome_audit',
      status,
      dimensions,
      warnings,
    }
  }

  private buildStabilityDimension(
    dimension: ScreenerStabilityDimension['dimension'],
    label: string,
    outcomes: ScreenerBacktestOutcome[],
    benchmarkAverageReturnPercent: number | null,
    getKey: (item: ScreenerBacktestOutcome) => string
  ): ScreenerStabilityDimension {
    const grouped = new Map<string, ScreenerBacktestOutcome[]>()
    for (const outcome of outcomes) {
      const key = getKey(outcome)
      grouped.set(key, [...(grouped.get(key) || []), outcome])
    }
    const groups = Array.from(grouped.entries())
      .map(([key, groupOutcomes]) => {
        const metadata = this.resolveGroupMetadataSummary(dimension, groupOutcomes)
        const summary = this.buildWindowSummary(groupOutcomes, benchmarkAverageReturnPercent)
        const advanced = this.buildAdvancedMetrics(groupOutcomes, benchmarkAverageReturnPercent)
        const warnings: string[] = [...metadata.warnings]
        if (groupOutcomes.length < 10) warnings.push(`分组样本 ${groupOutcomes.length} < 10`)
        if ((summary.excessReturnPercent ?? 0) <= 0) warnings.push('分组超额收益不为正')
        const status: ScreenerStabilityGroupBucket['status'] = groupOutcomes.length < 10
          ? 'insufficient'
          : (summary.excessReturnPercent ?? 0) > 0
            ? 'passed'
            : 'failed'
        return {
          key,
          label: key,
          provider: metadata.provider,
          method: metadata.method,
          confidence: metadata.averageConfidence,
          sampleSize: groupOutcomes.length,
          tradeCount: groupOutcomes.length,
          winRatePercent: summary.winRatePercent,
          averageReturnPercent: summary.averageReturnPercent,
          excessReturnPercent: summary.excessReturnPercent,
          maxDrawdownPercent: advanced.maxDrawdownPercent,
          status,
          warnings,
        }
      })
      .sort((left, right) => right.sampleSize - left.sampleSize || left.key.localeCompare(right.key))
    const usableGroups = groups.filter((item) => item.status !== 'insufficient')
    const passedGroups = usableGroups.filter((item) => item.status === 'passed').length
    const providerSummary = this.buildGroupProviderSummary(groups)
    const averageConfidence = groups.length > 0
      ? Number((groups.reduce((sum, item) => sum + item.confidence * item.sampleSize, 0) / Math.max(groups.reduce((sum, item) => sum + item.sampleSize, 0), 1)).toFixed(3))
      : 0
    const warnings: string[] = []
    if (groups.length < 2) warnings.push('有效分组少于 2 个，无法判断跨组稳定性')
    if (usableGroups.length < 2) warnings.push('可用分组少于 2 个，分组稳定性仅作审计记录')
    if (usableGroups.length >= 2 && passedGroups < Math.ceil(usableGroups.length / 2)) warnings.push('通过分组不足，策略跨组稳定性不足')

    let status: ScreenerStabilityDimension['status'] = 'insufficient'
    if (usableGroups.length >= 2) {
      status = passedGroups >= Math.ceil(usableGroups.length / 2) ? 'passed' : 'failed'
    }

    return {
      dimension,
      label,
      providerSummary,
      averageConfidence,
      status,
      passedGroups,
      totalGroups: groups.length,
      groups,
      warnings,
    }
  }

  private getOutcomeMetadataItem(
    dimension: ScreenerStabilityDimension['dimension'],
    outcome: ScreenerBacktestOutcome
  ): ScreenerOutcomeGroupMetadataItem | undefined {
    if (dimension === 'market_regime') return outcome.groupMetadata?.marketRegime
    if (dimension === 'market_segment') return outcome.groupMetadata?.marketSegment
    if (dimension === 'industry_group') return outcome.groupMetadata?.industryGroup
    if (dimension === 'market_cap_group') return outcome.groupMetadata?.marketCapGroup
    return undefined
  }

  private resolveGroupMetadataSummary(
    dimension: ScreenerStabilityDimension['dimension'],
    outcomes: ScreenerBacktestOutcome[]
  ) {
    const items = outcomes
      .map((outcome) => this.getOutcomeMetadataItem(dimension, outcome))
      .filter((item): item is ScreenerOutcomeGroupMetadataItem => Boolean(item))
    if (items.length === 0) {
      return {
        provider: 'unknown',
        method: 'missing_group_metadata',
        averageConfidence: 0,
        warnings: ['缺少分组元数据血缘'],
      }
    }
    const providerCounts = new Map<string, number>()
    const methodCounts = new Map<string, number>()
    const warningSet = new Set<string>()
    for (const item of items) {
      providerCounts.set(item.provider, (providerCounts.get(item.provider) || 0) + 1)
      methodCounts.set(item.method, (methodCounts.get(item.method) || 0) + 1)
      item.warnings.forEach((warning) => warningSet.add(warning))
    }
    const topByCount = (counts: Map<string, number>) => [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] || 'unknown'
    const averageConfidence = items.reduce((sum, item) => sum + item.confidence, 0) / items.length
    return {
      provider: topByCount(providerCounts),
      method: topByCount(methodCounts),
      averageConfidence: Number(averageConfidence.toFixed(3)),
      warnings: [...warningSet],
    }
  }

  private buildGroupProviderSummary(groups: ScreenerStabilityGroupBucket[]) {
    const map = new Map<string, { sampleSize: number; confidenceWeightedSum: number }>()
    for (const group of groups) {
      const current = map.get(group.provider) || { sampleSize: 0, confidenceWeightedSum: 0 }
      current.sampleSize += group.sampleSize
      current.confidenceWeightedSum += group.confidence * group.sampleSize
      map.set(group.provider, current)
    }
    return [...map.entries()]
      .map(([provider, value]) => ({
        provider,
        sampleSize: value.sampleSize,
        averageConfidence: Number((value.confidenceWeightedSum / Math.max(value.sampleSize, 1)).toFixed(3)),
      }))
      .sort((left, right) => right.sampleSize - left.sampleSize || left.provider.localeCompare(right.provider))
  }

  private buildStrategyCredibility(params: {
    signals: number
    wins: number
    evaluatedStocks: number
    totalRecords: number
    providerHistoryRecords: number
    excessReturnPercent: number | null
    maxDrawdownPercent?: number | null
  }) {
    const minSignals = 100
    const sampleAdequacyPercent = Number((Math.min(params.signals / minSignals, 1) * 100).toFixed(2))
    const coveragePercent = params.totalRecords > 0 ? (params.evaluatedStocks / params.totalRecords) * 100 : 0
    const reasons: string[] = []
    let score = 0

    if (params.signals >= 300) {
      score += 45
      reasons.push(`信号样本 ${params.signals} >= 300，达到高可信样本门槛`)
    } else if (params.signals >= minSignals) {
      score += 45
      reasons.push(`信号样本 ${params.signals} >= ${minSignals}`)
    } else if (params.signals >= 30) {
      score += 25
      reasons.push(`信号样本 ${params.signals} >= 30，但未达到中可信样本门槛`)
    } else if (params.signals > 0) {
      score += Math.round((params.signals / minSignals) * 35)
      reasons.push(`信号样本 ${params.signals} < 30，结论为样本不足`)
    } else {
      reasons.push('没有可验证信号，不能评估策略胜率')
    }

    if (coveragePercent >= 80) {
      score += 25
      reasons.push(`K线覆盖率 ${coveragePercent.toFixed(1)}%`)
    } else if (coveragePercent >= 50) {
      score += 15
      reasons.push(`K线覆盖率 ${coveragePercent.toFixed(1)}%，可用但需扩大样本`)
    } else {
      reasons.push(`K线覆盖率 ${coveragePercent.toFixed(1)}%，样本覆盖不足`)
    }

    if ((params.excessReturnPercent ?? 0) > 0) {
      score += 20
      reasons.push(`相对同窗口基准超额 ${params.excessReturnPercent}%`)
    } else if (params.excessReturnPercent !== null) {
      reasons.push(`相对同窗口基准无超额收益 ${params.excessReturnPercent}%`)
    } else {
      reasons.push('基准收益不足，无法计算超额收益')
    }

    if (params.providerHistoryRecords >= params.totalRecords) {
      score += 10
    }
    if ((params.maxDrawdownPercent ?? 0) <= 12 && params.signals >= 30) {
      score += 5
      reasons.push(`最大回撤 ${params.maxDrawdownPercent}% 可控`)
    }

    const interval = params.signals > 0
      ? this.wilsonInterval(params.wins, params.signals)
      : undefined
    if (interval) {
      reasons.push(`95%胜率置信区间 ${interval.low}% - ${interval.high}%`)
    }

    const rating: 'high' | 'medium' | 'low' | 'insufficient' = params.signals < 30
      ? 'insufficient'
      : params.signals >= 300 && score >= 75 && (params.excessReturnPercent ?? 0) > 0
      ? 'high'
      : params.signals >= 100 && score >= 50 && (params.excessReturnPercent ?? 0) > 0
      ? 'medium'
      : 'low'

    return {
      rating,
      score: Math.min(100, score),
      minSignals,
      sampleAdequacyPercent,
      winRateConfidenceInterval: interval,
      reasons,
    }
  }

  private wilsonInterval(wins: number, total: number) {
    if (total <= 0) return undefined
    const z = 1.96
    const phat = wins / total
    const denominator = 1 + (z * z) / total
    const center = (phat + (z * z) / (2 * total)) / denominator
    const margin = (z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total)) / denominator
    return {
      low: Number((Math.max(0, center - margin) * 100).toFixed(2)),
      high: Number((Math.min(1, center + margin) * 100).toFixed(2)),
    }
  }

  private parseDateOrFallback(value: string | undefined, fallback: Date) {
    if (!value) return fallback
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? fallback : date
  }

  private parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  private async getLatestAsyncStrategyEvidence(
    userId: string,
    options: ScreenerOptions,
    currentOperationId?: string
  ): Promise<ScreenerAsyncStrategyEvidence> {
    const operations = await prisma.operation.findMany({
      where: {
        userId,
        type: { in: ['strategy_tournament_run', 'stock_screener_full_scan'] },
        status: { in: ['completed', 'succeeded', 'partial'] },
        ...(currentOperationId ? { id: { not: currentOperationId } } : {}),
      },
      orderBy: [
        { completedAt: 'desc' },
        { requestedAt: 'desc' },
      ],
      take: 10,
    })

    const candidates: ScreenerAsyncStrategyEvidence[] = []

    for (const operation of operations) {
      const result = this.parseJson<Record<string, any>>(operation.resultJson, {})
      const evidenceRefs = result.evidenceRefs && typeof result.evidenceRefs === 'object'
        ? result.evidenceRefs as Record<string, any>
        : {}
      const acceptance = result.longSampleAcceptance && typeof result.longSampleAcceptance === 'object'
        ? result.longSampleAcceptance as ScreenerLongSampleAcceptanceReport
        : null
      const validationDecision = result.validationDecision && typeof result.validationDecision === 'object'
        ? result.validationDecision as ScreenerValidationDecision
        : undefined
      const artifactRefs = Array.isArray(evidenceRefs.artifactRefs)
        ? evidenceRefs.artifactRefs.filter((ref: unknown): ref is string => typeof ref === 'string')
        : this.parseJson<string[]>(operation.artifactRefsJson, [])
      const backtestDays = typeof evidenceRefs.backtestDays === 'number'
        ? evidenceRefs.backtestDays
        : typeof acceptance?.summary?.backtestDays === 'number'
          ? acceptance.summary.backtestDays
          : undefined

      if (!artifactRefs.length || !backtestDays) {
        continue
      }

      const blockedReasons: string[] = []
      if (backtestDays < Math.max(60, options.backtestDays)) {
        blockedReasons.push(`证据窗口 ${backtestDays} 日低于当前要求 ${Math.max(60, options.backtestDays)} 日`)
      }
      if (acceptance?.status !== 'passed') {
        blockedReasons.push(`长样本验收状态为 ${acceptance?.status || 'unknown'}`)
      }
      if (!['high', 'medium'].includes(acceptance?.summary?.bestCredibility || 'unknown')) {
        blockedReasons.push(`最佳策略可信度为 ${acceptance?.summary?.bestCredibility || 'unknown'}`)
      }
      const blockerFailures = (acceptance?.gates || []).filter((gate) => gate.severity === 'blocker' && gate.status !== 'passed')
      if (blockerFailures.length > 0) {
        blockedReasons.push(`仍有 ${blockerFailures.length} 个 blocker gate 未通过`)
      }

      candidates.push({
        schemaVersion: 'fams.screener.async_strategy_evidence_ref.v1',
        status: 'referenced',
        evidenceMode: 'async_strategy_evidence',
        evidenceOperationId: operation.id,
        batchId: typeof evidenceRefs.batchId === 'string' ? evidenceRefs.batchId : null,
        generatedAt: typeof evidenceRefs.generatedAt === 'string'
          ? evidenceRefs.generatedAt
          : operation.completedAt?.toISOString() || operation.requestedAt.toISOString(),
        backtestDays,
        artifactRefs,
        acceptanceStatus: acceptance?.status,
        bestCredibility: acceptance?.summary?.bestCredibility,
        bestSampleSize: acceptance?.summary?.bestSampleSize,
        scannedCount: acceptance?.summary?.scannedCount,
        evaluatedCount: acceptance?.summary?.evaluatedCount,
        failureCount: acceptance?.summary?.failureCount,
        scanCoveragePercent: acceptance?.summary?.scanCoveragePercent,
        validationDecision,
        gateSummary: (acceptance?.gates || []).map((gate) => ({
          id: gate.id,
          status: gate.status,
          severity: gate.severity,
          message: gate.message,
        })),
        topCandidates: acceptance?.topCandidates || [],
        usableForTradingAdvice: blockedReasons.length === 0,
        blockedReasons,
      })
    }

    if (candidates.length > 0) {
      return candidates.sort((a, b) => {
        const score = (item: ScreenerAsyncStrategyEvidence) => {
          const blockerCount = (item.gateSummary || []).filter((gate) => gate.severity === 'blocker' && gate.status !== 'passed').length
          const scanCoverage = item.scanCoveragePercent || 0
          const validationPenalty = item.validationDecision?.primaryBlocker === 'validation_evidence' ? -5 : 0
          const acceptedBonus = item.acceptanceStatus === 'passed' ? 1000 : 0
          const coverageBonus = scanCoverage >= 80 ? 300 : 0
          const fullScanBonus = scanCoverage >= 99 ? 200 : 0
          const credibilityBonus = item.bestCredibility === 'high' ? 80 : item.bestCredibility === 'medium' ? 40 : 0
          const blockerPenalty = blockerCount * 50
          const generatedAt = item.generatedAt ? new Date(item.generatedAt).getTime() : 0
          return acceptedBonus + coverageBonus + fullScanBonus + credibilityBonus + validationPenalty - blockerPenalty + generatedAt / 1e13
        }
        return score(b) - score(a)
      })[0]
    }

    return {
      schemaVersion: 'fams.screener.async_strategy_evidence_ref.v1',
      status: 'missing',
      evidenceMode: 'async_strategy_evidence',
      artifactRefs: [],
      usableForTradingAdvice: false,
      blockedReasons: ['尚无可引用的 strategy_tournament_run 产物'],
      reason: '请先运行 strategy_tournament_run 生成 60 日长窗策略证据。',
    }
  }

  private inferTournamentPeriod(tournament: ScreenerStrategyTournament) {
    const now = new Date(tournament.generatedAt)
    const signalDates = tournament.ranked.flatMap((strategy) => strategy.samples.map((sample) => sample.signalDate).filter(Boolean) as string[])
    const exitDates = tournament.ranked.flatMap((strategy) => strategy.samples.map((sample) => sample.exitDate).filter(Boolean) as string[])
    const startDate = signalDates.length > 0
      ? signalDates.map((date) => this.parseDateOrFallback(date, now)).sort((a, b) => a.getTime() - b.getTime())[0]
      : now
    const endDate = exitDates.length > 0
      ? exitDates.map((date) => this.parseDateOrFallback(date, now)).sort((a, b) => b.getTime() - a.getTime())[0]
      : now
    return { startDate, endDate }
  }

  async persistStrategyTournamentRun(params: {
    userId: string
    query: string
    options: ScreenerOptions
    tournament: ScreenerStrategyTournament
    dataQuality: Record<string, unknown>
    observability: Record<string, unknown>
    universe: { source: string; size: number; total?: number; scanned: number }
  }): Promise<ScreenerStrategyTournament> {
    const batchId = randomUUID()
    const { startDate, endDate } = this.inferTournamentPeriod(params.tournament)
    const initialCapital = 100000
    const persistedBacktests: Array<{ candidateId: string; strategyId: ScreenerStrategyId; backtestId: string; resultId: string; strategyVersionId: string }> = []

    for (const ranked of params.tournament.ranked) {
      const definition = this.strategies[ranked.strategyId]
      const strategy = await this.findOrCreateBuiltinStrategy(params.userId, ranked.strategyId, params.options)
      const strategyVersion = await this.findOrCreateStrategyVersion(strategy.id, ranked.strategyId, ranked.versionBundle, ranked.auditHash)
      const averageReturn = ranked.averageReturnPercent ?? 0
      const backtest = await prisma.backtest.create({
        data: {
          strategyId: strategy.id,
          name: `AI选股短窗验证 ${definition.name} ${batchId.slice(0, 8)}`,
          startDate,
          endDate,
          initialCapital,
          finalCapital: Number((initialCapital * (1 + averageReturn / 100)).toFixed(2)),
          totalReturn: ranked.averageReturnPercent,
          annualizedReturn: null,
          maxDrawdown: ranked.maxDrawdownPercent,
          sharpeRatio: ranked.sharpe,
          winRate: ranked.winRatePercent,
          tradesCount: ranked.tradeCount,
          status: 'completed',
          progress: 100,
          completedAt: new Date(),
        },
      })

      const result = await prisma.backtestResult.create({
        data: {
          backtestId: backtest.id,
          periodStart: startDate,
          periodEnd: endDate,
          totalReturn: ranked.averageReturnPercent,
          annualizedReturn: null,
          maxDrawdown: ranked.maxDrawdownPercent,
          sharpeRatio: ranked.sharpe,
          winRate: ranked.winRatePercent,
          profitFactor: ranked.profitFactor,
          tradesCount: ranked.tradeCount,
          equityCurve: JSON.stringify(ranked.samples.map((sample) => ({
            date: sample.exitDate || sample.entryDate || sample.signalDate,
            value: Number((initialCapital * (1 + sample.returnPercent / 100)).toFixed(2)),
            returnPercent: sample.returnPercent,
            symbol: sample.symbol,
          }))),
          monthlyReturns: JSON.stringify([]),
          reviewReportJson: JSON.stringify({
            schemaVersion: 'fams.screener.tournament_run.v1',
            kind: 'stock_screener_strategy_tournament',
            batchId,
            query: params.query,
            candidateId: ranked.candidateId,
            strategyId: ranked.strategyId,
            strategyName: ranked.name,
            executionPolicy: ranked.executionPolicy,
            strategyVersionId: strategyVersion.id,
            generatedAt: params.tournament.generatedAt,
            auditHash: ranked.auditHash,
            versionBundle: ranked.versionBundle,
            outOfSampleValidation: ranked.outOfSampleValidation,
            walkForwardValidation: ranked.walkForwardValidation,
            parameterSensitivity: ranked.parameterSensitivity,
            groupStabilityValidation: ranked.groupStabilityValidation,
            evaluationDays: params.tournament.evaluationDays,
            holdingDays: params.tournament.holdingDays,
            candidateHoldingDays: ranked.executionPolicy.holdingDays,
            executionMatrix: params.tournament.executionMatrix,
            thresholds: params.options.thresholds,
            universe: params.universe,
            dataQuality: params.dataQuality,
            observability: params.observability,
            metrics: {
              signals: ranked.signals,
              sampleSize: ranked.sampleSize,
              tradeCount: ranked.tradeCount,
              wins: ranked.wins,
              losses: ranked.losses,
              winRatePercent: ranked.winRatePercent,
              averageReturnPercent: ranked.averageReturnPercent,
              medianReturnPercent: ranked.medianReturnPercent,
              bestReturnPercent: ranked.bestReturnPercent,
              worstReturnPercent: ranked.worstReturnPercent,
              benchmarkAverageReturnPercent: ranked.benchmarkAverageReturnPercent,
              excessReturnPercent: ranked.excessReturnPercent,
              profitFactor: ranked.profitFactor,
              maxDrawdownPercent: ranked.maxDrawdownPercent,
              sharpe: ranked.sharpe,
              sortino: ranked.sortino,
              calmar: ranked.calmar,
              turnoverPercent: ranked.turnoverPercent,
              tailLossP95Percent: ranked.tailLossP95Percent,
              tailLossP99Percent: ranked.tailLossP99Percent,
              equityCurve: ranked.equityCurve,
              evaluatedStocks: ranked.evaluatedStocks,
              latestMatchedCount: ranked.latestMatchedCount,
              credibility: ranked.credibility,
              outOfSampleValidation: ranked.outOfSampleValidation,
              walkForwardValidation: ranked.walkForwardValidation,
              parameterSensitivity: ranked.parameterSensitivity,
              groupStabilityValidation: ranked.groupStabilityValidation,
            },
            benchmark: params.tournament.benchmark,
            assumptions: params.tournament.assumptions,
            engineVersion: this.engineVersion,
            samples: ranked.samples,
            blockedSamples: ranked.blockedSamples,
            latestCandidates: ranked.latestCandidates,
            notes: params.tournament.notes,
          }),
        },
      })

      persistedBacktests.push({
        candidateId: ranked.candidateId,
        strategyId: ranked.strategyId,
        backtestId: backtest.id,
        resultId: result.id,
        strategyVersionId: strategyVersion.id,
      })
    }

    return {
      ...params.tournament,
      batchId,
      persistenceStatus: 'persisted',
      ranked: params.tournament.ranked.map((ranked) => {
        const persisted = persistedBacktests.find((item) => item.candidateId === ranked.candidateId)
        return {
          ...ranked,
          persistedBacktestId: persisted?.backtestId,
          persistedResultId: persisted?.resultId,
          persistedStrategyVersionId: persisted?.strategyVersionId,
        }
      }),
      notes: [
        ...params.tournament.notes,
        `已保存为回测批次 ${batchId}，每个策略 × 执行策略候选组合各生成一条 Backtest 记录。`,
      ],
    }
  }

  private async findOrCreateBuiltinStrategy(userId: string, strategyId: ScreenerStrategyId, options: ScreenerOptions) {
    const definition = this.strategies[strategyId]
    const name = `AI选股/${definition.name}`
    const existing = await prisma.strategy.findFirst({
      where: {
        userId,
        type: 'stock_screener',
        name,
      },
      orderBy: { createdAt: 'desc' },
    })
    const parameters = {
      schemaVersion: 'fams.screener.strategy.v1',
      strategyId,
      versionBundle: this.buildVersionBundle(strategyId, options, this.buildExecutionPolicyVariants(options.holdingDays)[0]),
      strategyVersion: 'builtin.v1',
      executionPolicyVersion: 'entry.t1_open.v1+exit.hold_n.close.v1+sizing.equal_notional.v1',
      positionSizingPolicyVersion: 'sizing.equal_notional.v1',
      portfolioPolicyVersion: 'portfolio.single_signal_sample.v1',
      costModelVersion: 'cost.cn_equity.v1',
      marketConstraintVersion: 'constraint.cn_a_share_tradeability.v1',
      engineVersion: this.engineVersion,
      thresholds: options.thresholds,
      backtestDefaults: {
        evaluationDays: options.backtestDays,
        holdingDays: options.holdingDays,
      },
    }
    if (existing) {
      return prisma.strategy.update({
        where: { id: existing.id },
        data: {
          description: definition.description,
          parameters: JSON.stringify(parameters),
          isActive: true,
        },
      })
    }
    return prisma.strategy.create({
      data: {
        userId,
        name,
        description: definition.description,
        type: 'stock_screener',
        parameters: JSON.stringify(parameters),
        isActive: true,
      },
    })
  }

  private async findOrCreateStrategyVersion(
    strategyId: string,
    strategyKey: ScreenerStrategyId,
    versionBundle: ScreenerTournamentVersionBundle,
    auditHash: string,
  ) {
    const existing = await prisma.strategyVersion.findFirst({
      where: { strategyId, auditHash },
    })
    const data = {
      strategyKey,
      schemaVersion: versionBundle.schemaVersion,
      signalStrategyId: versionBundle.signalStrategy.id,
      signalVersion: versionBundle.signalStrategy.version,
      thresholdHash: versionBundle.signalStrategy.thresholdHash,
      entryPolicyId: versionBundle.entryPolicy.id,
      entryPolicyVersion: versionBundle.entryPolicy.version,
      exitPolicyId: versionBundle.exitPolicy.id,
      exitPolicyVersion: versionBundle.exitPolicy.version,
      holdingDays: versionBundle.exitPolicy.holdingDays,
      sizingPolicyId: versionBundle.positionSizingPolicy.id,
      sizingVersion: versionBundle.positionSizingPolicy.version,
      portfolioPolicyId: versionBundle.portfolioPolicy.id,
      portfolioVersion: versionBundle.portfolioPolicy.version,
      costModelId: versionBundle.costModel.id,
      costModelVersion: versionBundle.costModel.version,
      constraintId: versionBundle.marketConstraint.id,
      constraintVersion: versionBundle.marketConstraint.version,
      engineVersion: versionBundle.engine.version,
      versionBundleJson: JSON.stringify(versionBundle),
      auditHash,
      isActive: true,
    }
    const strategyVersion = existing
      ? await prisma.strategyVersion.update({
        where: { id: existing.id },
        data,
      })
      : await prisma.strategyVersion.create({
        data: {
          strategyId,
          ...data,
        },
      })

    const strategy = await prisma.strategy.findUnique({ where: { id: strategyId } })
    if (strategy) {
      const parameters = this.parseJson<Record<string, unknown>>(strategy.parameters, {})
      await prisma.strategy.update({
        where: { id: strategyId },
        data: {
          parameters: JSON.stringify({
            ...parameters,
            latestStrategyVersionId: strategyVersion.id,
            latestAuditHash: auditHash,
            latestVersionBundle: versionBundle,
          }),
        },
      })
    }

    return strategyVersion
  }

  private async getHistoryForScreening(symbol: string, days: number, options: ScreenerOptions) {
    const result = await this.getHistoryForScreeningWithStats(symbol, days, options)
    return result.history
  }

  private async getHistoryForScreeningWithStats(symbol: string, days: number, options: ScreenerOptions) {
    if (options.marketDataMode === 'live_fetch') {
      return marketBarCacheService.getHistory(symbol, days, { market: 'CN', provider: 'sina' })
    }
    return marketBarCacheService.getCachedHistory(symbol, days, { market: 'CN' })
  }

  private chunk<T>(items: T[], size: number) {
    const chunks: T[][] = []
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size))
    }
    return chunks
  }

  async runFullMarketScanOperation(
    operationId: string,
    userId: string,
    query: string,
    callbacks: ScreenerFullScanOperationCallbacks = {}
  ) {
    const startedAt = Date.now()
    const normalizedUserId = userId || 'default'
    const keyword = query.trim() || '多策略胜率；全A样本；验证天数=5；持有天数=3'
    const options = this.parseOptions(keyword)
    options.concurrency = Math.max(1, Math.min(options.concurrency, Number(process.env.FAMS_SCREENER_OPERATION_CONCURRENCY || 6)))
    const chunkSize = Math.max(10, Math.min(500, this.parseNumberOption(keyword, ['chunkSize', '分片大小'], 100)!))
    const factsetPreheatLimit = Math.max(0, Math.min(200, this.parseNumberOption(keyword, ['factsetPreheatLimit', '事实集预热上限', '预热上限'], Number(process.env.FAMS_SCREENER_FACTSET_PREHEAT_LIMIT || 20))!))
    const factsetCoverageThreshold = Math.max(0, Math.min(100, this.parseNumberOption(keyword, ['factsetCoverageThreshold', '事实集覆盖阈值', '覆盖率阈值'], Number(process.env.FAMS_SCREENER_FACTSET_COVERAGE_THRESHOLD || 80))!))
    const quoteListMarketCapWarmupLimit = Math.max(0, Math.min(2000, this.parseNumberOption(keyword, ['quoteListMarketCapWarmupLimit', '市值补齐上限', 'quoteListWarmupLimit'], Number(process.env.FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_LIMIT || 200))!))
    const skipFactsetPreheat = /跳过事实集预热\s*[:=：]?\s*(1|true|是)|skipFactsetPreheat\s*[:=]\s*(1|true)/i.test(keyword)
    const failures: Array<{ symbol: string; name: string; error: string }> = []
    const backtestRecords: Array<{ asset: ScreenableStockAsset; history: StockHistoryData[] }> = []
    const chunkSummaries: Array<Record<string, unknown>> = []

    const assertNotCancelled = async () => {
      if (await callbacks.isCancelled?.()) {
        const error = new Error('Operation cancelled')
        ;(error as Error & { code?: string }).code = 'OPERATION_CANCELLED'
        throw error
      }
    }

    const updateTask = async (update: ScreenerOperationTaskUpdate) => {
      await callbacks.onTaskUpdate?.(update)
    }

    await updateTask({ name: 'universe.snapshot', status: 'running' })
    await assertNotCancelled()
    const { universe: resolvedUniverse, excludedUniverse, universeSource, universeTotal } = await this.buildResolvedStockUniverse(normalizedUserId, {
      maxUniverse: options.maxUniverse,
    })
    let universe = resolvedUniverse
    const interactiveDefaultMaxScan = Math.max(20, Math.min(1000, Number(process.env.FAMS_INTERACTIVE_SCREENER_MAX_SCAN || 500)))
    const explicitFullScan = /完整全A|全A完整|完整扫描|confirmedFullScan\s*[:=]\s*(1|true)/i.test(keyword)
    const maxScan = options.maxScan && options.maxScan > 0
      ? options.maxScan
      : explicitFullScan
        ? universe.length
        : Math.min(universe.length, interactiveDefaultMaxScan)
    let scanUniverse = universe.slice(0, maxScan)
    const initialFactsetPreheatCoverage = this.buildFactsetPreheatCoverageReport({ universe, scanUniverse })
    await updateTask({
      name: 'universe.snapshot',
      status: 'completed',
      successCount: scanUniverse.length,
      metrics: {
        totalUniverse: universe.length,
        universeTotal,
        scanned: scanUniverse.length,
        excluded: excludedUniverse.length,
        source: universeSource,
      },
    })
    let factsetPreheatSummary: Record<string, unknown> = {
      enabled: !skipFactsetPreheat,
      thresholdPercent: factsetCoverageThreshold,
      limit: factsetPreheatLimit,
      attempted: 0,
      successCount: 0,
      failureCount: 0,
      skippedReason: skipFactsetPreheat ? 'skipFactsetPreheat' : undefined,
      failures: [],
    }
    if (!skipFactsetPreheat && initialFactsetPreheatCoverage.scanned.fullOfficialCoveragePercent < factsetCoverageThreshold) {
      const missingAssets = this.getFactsetPreheatCandidates(scanUniverse).slice(0, factsetPreheatLimit)
      const failuresForPreheat: Array<{ symbol: string; name: string; error: string }> = []
      let successCount = 0
      await updateTask({
        name: 'factset.preheat_missing',
        status: missingAssets.length > 0 ? 'running' : 'completed',
        successCount: 0,
        failureCount: 0,
        provider: 'stockAnalysisService',
        metrics: {
          thresholdPercent: factsetCoverageThreshold,
          beforeCoveragePercent: initialFactsetPreheatCoverage.scanned.fullOfficialCoveragePercent,
          totalMissing: this.getFactsetPreheatCandidates(scanUniverse).length,
          planned: missingAssets.length,
          limit: factsetPreheatLimit,
        },
      })
      for (const asset of missingAssets) {
        await assertNotCancelled()
        try {
          await stockAnalysisService.getFullAnalysis(asset.symbol, 'A股', 80, { forceRefresh: true })
          successCount += 1
        } catch (error) {
          failuresForPreheat.push({
            symbol: asset.symbol,
            name: asset.name,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      if (missingAssets.length > 0) {
        scanUniverse = await this.enrichUniverseWithCachedFundamentals(scanUniverse)
        const refreshedBySymbol = new Map(scanUniverse.map((asset) => [asset.symbol, asset]))
        universe = universe.map((asset) => refreshedBySymbol.get(asset.symbol) || asset)
      }
      factsetPreheatSummary = {
        enabled: true,
        thresholdPercent: factsetCoverageThreshold,
        limit: factsetPreheatLimit,
        planned: missingAssets.length,
        attempted: missingAssets.length,
        successCount,
        failureCount: failuresForPreheat.length,
        failures: failuresForPreheat.slice(0, 50),
      }
      await updateTask({
        name: 'factset.preheat_missing',
        status: failuresForPreheat.length > 0 && successCount === 0 ? 'failed' : 'completed',
        successCount,
        failureCount: failuresForPreheat.length,
        provider: 'stockAnalysisService',
        warnings: failuresForPreheat.slice(0, 10).map((failure) => `${failure.symbol}: ${failure.error}`),
        metrics: factsetPreheatSummary,
      })
    } else if (!skipFactsetPreheat) {
      factsetPreheatSummary = {
        ...factsetPreheatSummary,
        skippedReason: 'coverage_threshold_satisfied',
        beforeCoveragePercent: initialFactsetPreheatCoverage.scanned.fullOfficialCoveragePercent,
      }
    }
    const factsetPreheatCoverage = this.buildFactsetPreheatCoverageReport({
      universe,
      scanUniverse,
      initial: initialFactsetPreheatCoverage.scanned,
      preheat: factsetPreheatSummary,
    })
    const factsetNextAction = factsetPreheatCoverage.scanned.fullOfficialCoveragePercent < factsetCoverageThreshold &&
      factsetPreheatCoverage.scanned.officialIndustryCoveragePercent >= factsetCoverageThreshold &&
      factsetPreheatCoverage.scanned.officialMarketCapCoveragePercent < factsetCoverageThreshold &&
      quoteListMarketCapWarmupLimit > 0
      ? {
          code: 'NEEDS_QUOTE_LIST_MARKET_CAP_WARMUP',
          operationType: 'quote_list_market_cap_warmup',
          message: '正式行业覆盖已达标，但市值覆盖不足，请先执行 quote-list 市值补齐。',
          suggestedInput: {
            userId: normalizedUserId,
            limit: quoteListMarketCapWarmupLimit,
            chunkSize: Math.min(chunkSize, 100),
            executionMode: 'queued',
          },
          coverage: {
            thresholdPercent: factsetCoverageThreshold,
            fullOfficialCoveragePercent: factsetPreheatCoverage.scanned.fullOfficialCoveragePercent,
            officialIndustryCoveragePercent: factsetPreheatCoverage.scanned.officialIndustryCoveragePercent,
            officialMarketCapCoveragePercent: factsetPreheatCoverage.scanned.officialMarketCapCoveragePercent,
            missingMarketCapCount: factsetPreheatCoverage.scanned.total - factsetPreheatCoverage.scanned.officialMarketCapCount,
          },
        }
      : null
    await updateTask({
      name: 'factset.preheat_coverage',
      status: 'completed',
      successCount: factsetPreheatCoverage.scanned.fullOfficialCoverageCount,
      failureCount: factsetPreheatCoverage.scanned.total - factsetPreheatCoverage.scanned.fullOfficialCoverageCount,
      provider: 'stock_factset_cache',
      warnings: factsetPreheatCoverage.warnings,
      metrics: {
        scanned: factsetPreheatCoverage.scanned.total,
        officialIndustryCoveragePercent: factsetPreheatCoverage.scanned.officialIndustryCoveragePercent,
        officialMarketCapCoveragePercent: factsetPreheatCoverage.scanned.officialMarketCapCoveragePercent,
        fullOfficialCoveragePercent: factsetPreheatCoverage.scanned.fullOfficialCoveragePercent,
        missingIndustryPreview: factsetPreheatCoverage.scanned.missingIndustrySymbols.slice(0, 10),
        missingMarketCapPreview: factsetPreheatCoverage.scanned.missingMarketCapSymbols.slice(0, 10),
      },
    })
    await callbacks.onProgress?.(10, { scannedCount: 0, universeSize: universe.length })

    const marketDataCoverageReport = await marketBarCacheService.getCoverageReport(scanUniverse.map((asset) => asset.symbol), 120)
    const marketDataCoverageBySymbol = new Map(marketDataCoverageReport.items.map((item) => [item.symbol, item]))
    await updateTask({
      name: 'market_data.coverage',
      status: 'completed',
      successCount: marketDataCoverageReport.sufficientSymbols,
      failureCount: marketDataCoverageReport.insufficientSymbols,
      provider: 'market_data_coverage',
      warnings: marketDataCoverageReport.items
        .filter((item) => !item.sufficient)
        .slice(0, 50)
        .map((item) => `${item.symbol}: ${item.status || 'insufficient'} ${item.latestDate || 'no latest bar'}`),
      metrics: {
        marketDataMode: options.marketDataMode,
        requestedDays: marketDataCoverageReport.requestedDays,
        totalSymbols: marketDataCoverageReport.totalSymbols,
        sufficientSymbols: marketDataCoverageReport.sufficientSymbols,
        insufficientSymbols: marketDataCoverageReport.insufficientSymbols,
        staleSymbols: marketDataCoverageReport.staleSymbols,
      },
    })
    const featureTargets = marketDataCoverageReport.items
      .filter((item) => item.sufficient)
      .map((item) => item.symbol)
    const latestFeatureBySymbol = await marketFeatureDailyService.getLatestFeatures(featureTargets, { market: 'CN' })
    const marketFeatureCoverageReport = {
      schemaVersion: 'fams.screener.market_feature_coverage.v1',
      generatedAt: new Date().toISOString(),
      requestedSymbols: featureTargets.length,
      coveredSymbols: latestFeatureBySymbol.size,
      missingSymbols: featureTargets.filter((symbol) => !latestFeatureBySymbol.has(symbol)).slice(0, 100),
      coveragePercent: featureTargets.length > 0 ? Number(((latestFeatureBySymbol.size / featureTargets.length) * 100).toFixed(2)) : 100,
      sample: Array.from(latestFeatureBySymbol.entries()).slice(0, 20).map(([symbol, feature]) => ({
        symbol,
        tradeDate: feature.tradeDate.toISOString().slice(0, 10),
        trendScore: feature.trendScore,
        momentumScore: feature.momentumScore,
        volumeRatio20: feature.volumeRatio20,
        rsi14: feature.rsi14,
        atr14: feature.atr14,
      })),
    }
    await updateTask({
      name: 'market_feature.coverage',
      status: marketFeatureCoverageReport.missingSymbols.length > 0 ? 'partial' : 'completed',
      successCount: marketFeatureCoverageReport.coveredSymbols,
      failureCount: marketFeatureCoverageReport.requestedSymbols - marketFeatureCoverageReport.coveredSymbols,
      provider: 'market_feature_daily',
      warnings: marketFeatureCoverageReport.missingSymbols.slice(0, 50).map((symbol) => `${symbol}: missing latest feature cache`),
      metrics: marketFeatureCoverageReport,
    })

    const chunks = this.chunk(scanUniverse, chunkSize)
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
      await assertNotCancelled()
      const chunkItems = chunks[chunkIndex]
      const chunkStartedAt = Date.now()
      const chunkStats: MarketBarCacheStats[] = []
      const chunkWarnings: string[] = []
      let successCount = 0
      let failureCount = 0

      await updateTask({
        name: 'market_data.warmup',
        chunkIndex,
        status: 'running',
        metrics: { chunkSize: chunkItems.length, from: chunkIndex * chunkSize, to: chunkIndex * chunkSize + chunkItems.length - 1 },
      })

      const warmupResults = await this.mapWithConcurrency(chunkItems, options.concurrency, async (asset) => {
        try {
          const coverage = marketDataCoverageBySymbol.get(asset.symbol)
          if (options.marketDataMode === 'cache_only' && !coverage?.sufficient) {
            failureCount += 1
            const reason = coverage?.stale
              ? `缓存已过期，最新K线 ${coverage.latestDate || '未知'}`
              : `本地 canonical K线不足，仅 ${coverage?.cachedBars || 0} 条`
            const retryable = coverage?.retryable === true
            const category = coverage?.warningCategory || 'unknown'
            const recommendedAction = coverage?.recommendedAction || 'review_provider_mapping'
            return {
              asset,
              history: null,
              failure: {
                symbol: asset.symbol,
                name: asset.name,
                code: retryable ? 'NEEDS_MARKET_DATA_WARMUP' : 'MARKET_DATA_COVERAGE_NON_RETRYABLE',
                category,
                retryable,
                recommendedAction,
                error: retryable
                  ? `${reason}。请先执行 market_bar_cache_preheat / market_data.warmup 后再扫描。`
                  : `${reason}，分类为 ${category}，当前不再重复派生 warmup；建议 ${recommendedAction}。`,
              },
            }
          }
          let marketResult = await this.getHistoryForScreeningWithStats(asset.symbol, 120, options)
          if (marketResult.history.length < options.thresholds.minHistoryDays) {
            marketResult = await this.getHistoryForScreeningWithStats(asset.symbol, 180, options)
          }
          chunkStats.push(marketResult.stats)
          for (const warning of marketResult.stats.warnings) {
            chunkWarnings.push(`${asset.symbol}: ${warning}`)
          }
          if (marketResult.history.length < options.thresholds.minHistoryDays) {
            failureCount += 1
            return {
              asset,
              history: null,
              failure: {
                symbol: asset.symbol,
                name: asset.name,
                error: `历史K线不足${options.thresholds.minHistoryDays}个交易日，仅返回 ${marketResult.history.length} 条，已从候选池排除。`,
              },
            }
          }
          successCount += 1
          return { asset, history: marketResult.history, failure: null }
        } catch (error) {
          failureCount += 1
          return {
            asset,
            history: null,
            failure: { symbol: asset.symbol, name: asset.name, error: error instanceof Error ? error.message : '选股数据获取失败' },
          }
        }
      })

      for (const item of warmupResults) {
        if (item.history) backtestRecords.push({ asset: item.asset, history: item.history })
        if (item.failure) failures.push(item.failure)
      }

      const cacheHitRate = chunkStats.length > 0
        ? Number((chunkStats.reduce((sum, item) => sum + item.cacheHitRate, 0) / chunkStats.length).toFixed(2))
        : 0
      const providers = Array.from(new Set(chunkStats.map((item) => item.provider))).join(',') || 'unknown'
      const chunkSummary = {
        chunkIndex,
        successCount,
        failureCount,
        durationMs: Date.now() - chunkStartedAt,
        marketDataMode: options.marketDataMode,
        provider: providers,
        cacheHitRate,
        validationWarnings: chunkWarnings.slice(0, 25),
      }
      chunkSummaries.push(chunkSummary)
      await updateTask({
        name: 'market_data.warmup',
        chunkIndex,
        status: failureCount > 0 && successCount === 0 ? 'failed' : 'completed',
        successCount,
        failureCount,
        provider: providers,
        cacheHitRate,
        warnings: chunkWarnings.slice(0, 50),
        metrics: chunkSummary,
      })
      await callbacks.onProgress?.(
        Math.min(65, 10 + Math.round(((chunkIndex + 1) / Math.max(chunks.length, 1)) * 55)),
        { completedChunks: chunkIndex + 1, totalChunks: chunks.length, scannedCount: backtestRecords.length, failureCount: failures.length }
      )
    }

    await assertNotCancelled()
    await updateTask({ name: 'security_status.canonicalize', status: 'running', successCount: backtestRecords.length })
    let securityStatusCoverageSnapshot = await securityStatusService.upsertHeuristicFromRecords(backtestRecords)
    if (process.env.FAMS_TUSHARE_TOKEN || process.env.TUSHARE_TOKEN) {
      securityStatusCoverageSnapshot = await securityStatusService.upsertTushareTradingStatus(
        backtestRecords.map((record) => record.asset.symbol),
        securityStatusCoverageSnapshot.latestTradeDate || undefined
      )
    }
    const latestSecurityFacts = await securityStatusService.getLatestFacts(backtestRecords.map((record) => record.asset.symbol))
    for (const record of backtestRecords) {
      const facts = latestSecurityFacts.get(record.asset.symbol)
      if (!facts) continue
      record.asset = {
        ...record.asset,
        securityStatusFact: facts.securityStatus,
        tradeabilityFact: facts.tradeability,
      }
    }
    await updateTask({
      name: 'security_status.canonicalize',
      status: securityStatusCoverageSnapshot.statusRows > 0 && securityStatusCoverageSnapshot.tradeabilityRows > 0 ? 'completed' : 'partial',
      successCount: securityStatusCoverageSnapshot.symbolsWithStatus,
      failureCount: Math.max(0, backtestRecords.length - securityStatusCoverageSnapshot.symbolsWithStatus),
      provider: securityStatusCoverageSnapshot.providerSummary.map((item) => item.provider).join(',') || 'none',
      warnings: securityStatusCoverageSnapshot.warnings,
      metrics: {
        requestedSymbols: securityStatusCoverageSnapshot.requestedSymbols,
        statusRows: securityStatusCoverageSnapshot.statusRows,
        tradeabilityRows: securityStatusCoverageSnapshot.tradeabilityRows,
        officialProviderRows: securityStatusCoverageSnapshot.officialProviderRows,
        heuristicRows: securityStatusCoverageSnapshot.heuristicRows,
        formalTradingStateRows: securityStatusCoverageSnapshot.formalTradingStateRows,
        latestTradeDate: securityStatusCoverageSnapshot.latestTradeDate,
      },
    })

    await assertNotCancelled()
    await updateTask({ name: 'strategy.evaluate', status: 'running', metrics: { records: backtestRecords.length, featureFirst: true } })
    let results = backtestRecords.map((record) => {
      const feature = latestFeatureBySymbol.get(record.asset.symbol)
      return feature
        ? this.evaluateByFeatureStrategy(record.asset, feature, options)
        : this.evaluateByStrategy(record.asset, record.history, options)
    })
    results = await this.enrichPeForFilterCandidates(results, options)
    const featureFirstEvaluatedCount = results.filter((item) => item.historySource === 'feature:market_feature_daily').length
    const matched = results
      .filter((item) => item.matched)
      .sort((a, b) => b.score - a.score || b.lastTwoVolumeRatio - a.lastTwoVolumeRatio)
    const fallback = results
      .filter((item) => !item.matched)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, 5 - matched.length))
    const resultLimit = Math.max(1, Math.min(1000, Math.floor(options.maxResults || 200)))
    const candidates = [...matched, ...fallback.filter((item) => item.hardFilterPassed !== false)].slice(0, resultLimit)
    await updateTask({
      name: 'strategy.evaluate',
      status: 'completed',
      successCount: results.length,
      failureCount: failures.length,
      metrics: {
        matchedCount: matched.length,
        candidateCount: candidates.length,
        strategyId: options.strategyId,
        featureFirst: true,
        featureFirstEvaluatedCount,
        historyFallbackEvaluatedCount: results.length - featureFirstEvaluatedCount,
      },
    })
    await callbacks.onProgress?.(76, { evaluatedCount: results.length, matchedCount: matched.length })

    const dataQuality = {
      marketDataMode: options.marketDataMode,
      marketDataWarmupRequired: marketDataCoverageReport.retryableWarmupSymbols.length > 0,
      marketDataCoverage: {
        schemaVersion: marketDataCoverageReport.schemaVersion,
        requestedDays: marketDataCoverageReport.requestedDays,
        totalSymbols: marketDataCoverageReport.totalSymbols,
        sufficientSymbols: marketDataCoverageReport.sufficientSymbols,
        insufficientSymbols: marketDataCoverageReport.insufficientSymbols,
        staleSymbols: marketDataCoverageReport.staleSymbols,
        missingSymbols: marketDataCoverageReport.missingSymbols.slice(0, 50),
        staleSymbolList: marketDataCoverageReport.staleSymbolList.slice(0, 50),
        retryableWarmupSymbols: marketDataCoverageReport.retryableWarmupSymbols.slice(0, 50),
        nonRetryableWarningSymbols: marketDataCoverageReport.nonRetryableWarningSymbols.slice(0, 50),
        warningSummary: marketDataCoverageReport.warningSummary,
        nextAction: marketDataCoverageReport.retryableWarmupSymbols.length > 0 ? 'NEEDS_MARKET_DATA_WARMUP' : null,
      },
      marketFeatureCoverage: marketFeatureCoverageReport,
      featureFirstScreening: {
        enabled: true,
        evaluatedCount: featureFirstEvaluatedCount,
        fallbackCount: results.length - featureFirstEvaluatedCount,
        source: 'market_feature_daily',
        note: '当前候选筛选使用最新特征缓存；策略锦标赛和历史回测仍使用 canonical K 线窗口。',
      },
      screened: results.length,
      insufficientHistory: failures.length,
      totalUniverse: universe.length,
      scanned: scanUniverse.length,
      scanCoveragePercent: universe.length > 0 ? Number(((scanUniverse.length / universe.length) * 100).toFixed(2)) : 0,
      chunkSize,
      totalChunks: chunks.length,
      partialSuccess: failures.length > 0,
      historySources: Array.from(new Set(results.map((item) => item.historySource || 'unknown'))),
      factsetPreheatCoverage,
      securityStatusCoverage: securityStatusCoverageSnapshot,
    }
    const observability = {
      elapsedMs: Date.now() - startedAt,
      concurrency: options.concurrency,
      marketDataMode: options.marketDataMode,
      providerSuccessRate: scanUniverse.length > 0 ? Number(((results.length / scanUniverse.length) * 100).toFixed(2)) : 0,
      failureCount: failures.length,
      matchedCount: matched.length,
      cacheHitRate: chunkSummaries.length > 0
        ? Number((chunkSummaries.reduce((sum, item) => sum + Number(item.cacheHitRate || 0), 0) / chunkSummaries.length).toFixed(2))
        : 0,
    }

    await assertNotCancelled()
    await updateTask({ name: 'backtest.aggregate', status: 'running', successCount: backtestRecords.length })
    let strategyTournament = this.evaluateStrategyTournament(backtestRecords, options)
    try {
      strategyTournament = await this.persistStrategyTournamentRun({
        userId: normalizedUserId,
        query: keyword,
        options,
        tournament: strategyTournament,
        dataQuality,
        observability,
        universe: {
          source: universeSource,
          size: universe.length,
          total: universeTotal,
          scanned: scanUniverse.length,
        },
      })
      await updateTask({
        name: 'backtest.aggregate',
        status: 'completed',
        successCount: strategyTournament.ranked.reduce((sum, item) => sum + item.signals, 0),
        metrics: { batchId: strategyTournament.batchId, rankedStrategies: strategyTournament.ranked.length },
      })
    } catch (error) {
      strategyTournament = {
        ...strategyTournament,
        persistenceStatus: 'failed',
        notes: [
          ...strategyTournament.notes,
          `回测批次保存失败：${error instanceof Error ? error.message : 'unknown error'}`,
        ],
      }
      await updateTask({
        name: 'backtest.aggregate',
        status: 'failed',
        failureCount: 1,
        error,
        metrics: { rankedStrategies: strategyTournament.ranked.length },
      })
    }
    await callbacks.onProgress?.(88, { batchId: strategyTournament.batchId, rankedStrategies: strategyTournament.ranked.length })

    const longSampleAcceptance = this.buildLongSampleAcceptanceReport({
      options,
      universeSize: universe.length,
      universeSource,
      universeTotal,
      scannedCount: scanUniverse.length,
      evaluatedCount: results.length,
      failureCount: failures.length,
      scanCoveragePercent: dataQuality.scanCoveragePercent,
      providerSuccessRate: observability.providerSuccessRate,
      cacheHitRate: observability.cacheHitRate,
      tournament: strategyTournament,
      factsetPreheatCoverage,
    })
    const outOfSampleDiagnostics = this.buildOutOfSampleDiagnostics({
      tournament: strategyTournament,
      factsetPreheatCoverage,
    })
    const outOfSampleMarketStateDiagnostics = await this.buildOutOfSampleMarketStateDiagnostics(outOfSampleDiagnostics)
    const oosFailureAnalysis = this.buildOosFailureAnalysis({
      tournament: strategyTournament,
      outOfSampleDiagnostics,
      outOfSampleMarketStateDiagnostics,
    })
    const oosLayeredValidation = this.buildOosLayeredValidationReport({
      tournament: strategyTournament,
    })
    const validationEvidenceMatrix = this.buildValidationEvidenceMatrixReport({
      tournament: strategyTournament,
      longSampleAcceptance,
    })
    const oosMultiWindowRegimeRetest = this.buildOosMultiWindowRegimeRetestReport({
      tournament: strategyTournament,
      validationEvidenceMatrix,
    })
    const validationCandidateDisposition = this.buildValidationCandidateDispositionReport({
      validationEvidenceMatrix,
      oosMultiWindowRegimeRetest,
    })
    const validationDecision = this.buildValidationDecision({
      longSampleAcceptance,
      outOfSampleDiagnostics,
      outOfSampleMarketStateDiagnostics,
    })
    const strategyFailureMatrix = this.buildStrategyFailureMatrixReport({
      tournament: strategyTournament,
      validationEvidenceMatrix,
      oosMultiWindowRegimeRetest,
    })
    const strategyRemediationReport = this.buildStrategyRemediationReport({
      validationDecision,
      strategyFailureMatrix,
    })
    const asyncStrategyEvidence = await this.getLatestAsyncStrategyEvidence(normalizedUserId, options, operationId)

    await assertNotCancelled()
    await updateTask({ name: 'artifact.generate', status: 'running' })
    const providerHealthReport = await marketBarCacheService.getProviderHealthReport()
    const artifacts = {
      'leaderboard.json': strategyTournament.ranked.map((item, index) => ({
        candidateId: item.candidateId,
        strategyId: item.strategyId,
        name: item.name,
        executionPolicy: item.executionPolicy,
        rank: index + 1,
        signals: item.signals,
        sampleSize: item.sampleSize,
        tradeCount: item.tradeCount,
        winRatePercent: item.winRatePercent,
        averageReturnPercent: item.averageReturnPercent,
        medianReturnPercent: item.medianReturnPercent,
        excessReturnPercent: item.excessReturnPercent,
        maxDrawdownPercent: item.maxDrawdownPercent,
        sharpe: item.sharpe,
        sortino: item.sortino,
        calmar: item.calmar,
        profitFactor: item.profitFactor,
        credibility: item.credibility,
        equityCurve: item.equityCurve,
        auditHash: item.auditHash,
        strategyVersionId: item.persistedStrategyVersionId,
        versionBundle: item.versionBundle,
        outOfSampleValidation: item.outOfSampleValidation,
        walkForwardValidation: item.walkForwardValidation,
        parameterSensitivity: item.parameterSensitivity,
        groupStabilityValidation: item.groupStabilityValidation,
      })),
      'candidate_list.json': candidates.map((candidate) => ({ ...candidate, aiAdvice: null })),
      'strategy_metrics.json': strategyTournament,
      'execution_matrix.json': strategyTournament.executionMatrix,
      'sample_trades.csv': [
        'candidateId,strategyId,executionPolicy,entryReason,positionSizingReason,notional,positionSizeMultiplier,symbol,name,marketSegment,marketSegmentProvider,industryGroup,industryProvider,marketCapGroup,marketCapProvider,marketRegime,marketRegimeProvider,groupConfidence,signalDate,entryDate,exitDate,entryPrice,exitPrice,grossReturnPercent,returnPercent,costPercent,win,score,exitReason,blockedReason',
        ...strategyTournament.ranked.flatMap((strategy) => [
          ...strategy.samples,
          ...strategy.blockedSamples,
        ].map((sample) => [
          strategy.candidateId,
          strategy.strategyId,
          strategy.executionPolicy.id,
          sample.entryReason ? `"${sample.entryReason}"` : '',
          sample.positionSizingReason ? `"${sample.positionSizingReason}"` : '',
          sample.notional ?? '',
          sample.positionSizeMultiplier ?? '',
          sample.symbol,
          `"${sample.name}"`,
          sample.marketSegment ? `"${sample.marketSegment}"` : '',
          sample.groupMetadata?.marketSegment.provider || '',
          sample.industryGroup ? `"${sample.industryGroup}"` : '',
          sample.groupMetadata?.industryGroup.provider || '',
          sample.marketCapGroup ? `"${sample.marketCapGroup}"` : '',
          sample.groupMetadata?.marketCapGroup.provider || '',
          sample.marketRegime ? `"${sample.marketRegime}"` : '',
          sample.groupMetadata?.marketRegime.provider || '',
          sample.groupMetadata
            ? Math.min(
              sample.groupMetadata.marketSegment.confidence,
              sample.groupMetadata.industryGroup.confidence,
              sample.groupMetadata.marketCapGroup.confidence,
              sample.groupMetadata.marketRegime.confidence
            )
            : '',
          sample.signalDate || '',
          sample.entryDate || '',
          sample.exitDate || '',
          sample.entryPrice,
          sample.exitPrice,
          sample.grossReturnPercent,
          sample.returnPercent,
          sample.costPercent ?? '',
          sample.win,
          sample.score,
          sample.exitReason ? `"${sample.exitReason}"` : '',
          sample.blockedReason ? `"${sample.blockedReason}"` : '',
        ].join(','))),
      ].join('\n'),
      'equity_curve.json': Object.fromEntries(strategyTournament.ranked.map((strategy) => [
        strategy.candidateId,
        this.buildEquityCurve(strategy.samples.map((sample) => sample.returnPercent)).curve,
      ])),
      'drawdown_curve.json': Object.fromEntries(strategyTournament.ranked.map((strategy) => [
        strategy.candidateId,
        this.buildEquityCurve(strategy.samples.map((sample) => sample.returnPercent)).curve.map((point) => ({
          index: point.index,
          drawdownPercent: point.drawdownPercent,
        })),
      ])),
      'backtest_assumptions.json': {
        ...strategyTournament.assumptions,
        engineVersion: this.engineVersion,
        executionMatrix: strategyTournament.executionMatrix,
        tournamentCandidates: strategyTournament.ranked.map((item) => ({
          candidateId: item.candidateId,
          strategyId: item.strategyId,
          executionPolicy: item.executionPolicy,
          auditHash: item.auditHash,
          versionBundle: item.versionBundle,
        })),
      },
      'strategy_manifest.json': {
        schemaVersion: 'fams.screener.strategy_manifest.v1',
        batchId: strategyTournament.batchId,
        generatedAt: strategyTournament.generatedAt,
        candidates: strategyTournament.ranked.map((item) => ({
          candidateId: item.candidateId,
          strategyId: item.strategyId,
          name: item.name,
          description: item.description,
          executionPolicy: item.executionPolicy,
          auditHash: item.auditHash,
          strategyVersionId: item.persistedStrategyVersionId,
          versionBundle: item.versionBundle,
          metrics: {
            sampleSize: item.sampleSize,
            tradeCount: item.tradeCount,
            winRatePercent: item.winRatePercent,
            averageReturnPercent: item.averageReturnPercent,
            excessReturnPercent: item.excessReturnPercent,
            maxDrawdownPercent: item.maxDrawdownPercent,
            credibility: item.credibility.rating,
            outOfSampleValidation: item.outOfSampleValidation,
            walkForwardValidation: item.walkForwardValidation,
            parameterSensitivity: item.parameterSensitivity,
            groupStabilityValidation: item.groupStabilityValidation,
          },
        })),
      },
      'out_of_sample_validation.json': Object.fromEntries(strategyTournament.ranked.map((item) => [
        item.candidateId,
        item.outOfSampleValidation,
      ])),
      'out_of_sample_diagnostics.json': outOfSampleDiagnostics,
      'out_of_sample_market_state.json': outOfSampleMarketStateDiagnostics,
      'oos_failure_analysis.json': oosFailureAnalysis,
      'oos_layered_validation.json': oosLayeredValidation,
      'validation_evidence_matrix.json': validationEvidenceMatrix,
      'oos_multi_window_regime_retest.json': oosMultiWindowRegimeRetest,
      'validation_candidate_disposition.json': validationCandidateDisposition,
      'validation_decision.json': validationDecision,
      'strategy_failure_matrix.json': strategyFailureMatrix,
      'strategy_remediation_report.json': strategyRemediationReport,
      'walk_forward_validation.json': Object.fromEntries(strategyTournament.ranked.map((item) => [
        item.candidateId,
        item.walkForwardValidation,
      ])),
      'parameter_sensitivity.json': Object.fromEntries(strategyTournament.ranked.map((item) => [
        item.candidateId,
        item.parameterSensitivity,
      ])),
      'group_stability_report.json': Object.fromEntries(strategyTournament.ranked.map((item) => [
        item.candidateId,
        item.groupStabilityValidation,
      ])),
      'long_sample_acceptance.json': longSampleAcceptance,
      'factset_preheat_coverage.json': factsetPreheatCoverage,
      'coverage_report.json': {
        schemaVersion: 'fams.screener.coverage_report.v1',
        factsetNextAction,
        marketDataMode: options.marketDataMode,
        marketDataWarmupRequired: marketDataCoverageReport.retryableWarmupSymbols.length > 0,
        nextAction: marketDataCoverageReport.retryableWarmupSymbols.length > 0 ? {
          code: 'NEEDS_MARKET_DATA_WARMUP',
          operationType: 'market_bar_cache_preheat',
          suggestedInput: {
            userId: normalizedUserId,
            limit: scanUniverse.length,
            days: 120,
            chunkSize,
            concurrency: Math.min(options.concurrency, 4),
            forceRefresh: false,
            executionMode: 'queued',
          },
        } : null,
        marketDataCoverage: marketDataCoverageReport,
        marketFeatureCoverage: marketFeatureCoverageReport,
      },
      'market_feature_coverage.json': marketFeatureCoverageReport,
      'data_quality_report.json': {
        dataQuality,
        observability,
        chunkSummaries,
        failures,
        excludedUniverse,
        factsetPreheatCoverage,
        factsetNextAction,
        longSampleAcceptance,
        outOfSampleDiagnostics,
        outOfSampleMarketStateDiagnostics,
        oosFailureAnalysis,
        oosLayeredValidation,
        validationEvidenceMatrix,
        oosMultiWindowRegimeRetest,
        validationCandidateDisposition,
        validationDecision,
        strategyFailureMatrix,
        strategyRemediationReport,
        asyncStrategyEvidence,
      },
      'provider_health_report.json': providerHealthReport,
    }
    const infrastructureReadinessReport = this.buildInfrastructureReadinessReport({
      operationId,
      keyword,
      options,
      chunkSize,
      scannedCount: scanUniverse.length,
      evaluatedCount: results.length,
      artifactCount: Object.keys(artifacts).length + 8,
    })
    const marketConstraintCoverageReport = this.buildMarketConstraintCoverageReport(strategyTournament)
    const postgresShadowReadinessReport = await this.buildPostgresShadowReadinessReport()
    const securityStatusCoverageReport = this.buildSecurityStatusCoverageReport(marketConstraintCoverageReport, securityStatusCoverageSnapshot)
    const validationFailureTaxonomy = this.buildValidationFailureTaxonomyReport({
      validationDecision,
      oosFailureAnalysis,
      oosLayeredValidation,
    })
    const p4ClosureReview = this.buildP4ClosureReviewReport({
      longSampleAcceptance,
      validationDecision,
      validationCandidateDisposition,
      infrastructureReadinessReport,
      marketConstraintCoverageReport,
      postgresShadowReadinessReport,
      securityStatusCoverageReport,
      validationFailureTaxonomy,
    })
    const p5ClosureReview = this.buildP5ClosureReviewReport({
      postgresShadowReadinessReport,
      securityStatusCoverageReport,
      validationFailureTaxonomy,
      p4ClosureReview,
    })
    ;(artifacts as Record<string, unknown>)['infrastructure_readiness_report.json'] = infrastructureReadinessReport
    ;(artifacts as Record<string, unknown>)['market_constraint_coverage_report.json'] = marketConstraintCoverageReport
    ;(artifacts as Record<string, unknown>)['postgres_shadow_readiness_report.json'] = postgresShadowReadinessReport
    ;(artifacts as Record<string, unknown>)['security_status_coverage_report.json'] = securityStatusCoverageReport
    ;(artifacts as Record<string, unknown>)['validation_failure_taxonomy.json'] = validationFailureTaxonomy
    ;(artifacts as Record<string, unknown>)['p4_closure_review.json'] = p4ClosureReview
    ;(artifacts as Record<string, unknown>)['p5_closure_review.json'] = p5ClosureReview
    ;(artifacts as Record<string, any>)['data_quality_report.json'].infrastructureReadinessReport = infrastructureReadinessReport
    ;(artifacts as Record<string, any>)['data_quality_report.json'].marketConstraintCoverageReport = marketConstraintCoverageReport
    ;(artifacts as Record<string, any>)['data_quality_report.json'].postgresShadowReadinessReport = postgresShadowReadinessReport
    ;(artifacts as Record<string, any>)['data_quality_report.json'].securityStatusCoverageReport = securityStatusCoverageReport
    ;(artifacts as Record<string, any>)['data_quality_report.json'].validationFailureTaxonomy = validationFailureTaxonomy
    ;(artifacts as Record<string, any>)['data_quality_report.json'].oosLayeredValidation = oosLayeredValidation
    ;(artifacts as Record<string, any>)['data_quality_report.json'].validationEvidenceMatrix = validationEvidenceMatrix
    ;(artifacts as Record<string, any>)['data_quality_report.json'].oosMultiWindowRegimeRetest = oosMultiWindowRegimeRetest
    ;(artifacts as Record<string, any>)['data_quality_report.json'].validationCandidateDisposition = validationCandidateDisposition
    ;(artifacts as Record<string, any>)['data_quality_report.json'].strategyFailureMatrix = strategyFailureMatrix
    ;(artifacts as Record<string, any>)['data_quality_report.json'].strategyRemediationReport = strategyRemediationReport
    ;(artifacts as Record<string, any>)['data_quality_report.json'].p4ClosureReview = p4ClosureReview
    ;(artifacts as Record<string, any>)['data_quality_report.json'].p5ClosureReview = p5ClosureReview
    const artifactRefs = Object.keys(artifacts).map((filename) => `operation_artifact:${operationId}:${filename}`)
    await updateTask({
      name: 'artifact.generate',
      status: 'completed',
      successCount: artifactRefs.length,
      metrics: { artifactRefs },
    })

    observability.elapsedMs = Date.now() - startedAt
    return {
      query: keyword,
      strategy: this.strategies[options.strategyId].name,
      strategyDefinition: {
        id: this.strategies[options.strategyId].id,
        name: this.strategies[options.strategyId].name,
        description: this.strategies[options.strategyId].description,
        thresholds: options.thresholds,
        requiredHistoryDays: options.thresholds.minHistoryDays,
      },
      universeSize: universe.length,
      universeTotal,
      scannedCount: scanUniverse.length,
      universeSource,
      excludedUniverse,
      dataQuality,
      factsetPreheatCoverage,
      factsetNextAction,
      longSampleAcceptance,
      outOfSampleDiagnostics,
      outOfSampleMarketStateDiagnostics,
      oosFailureAnalysis,
      oosLayeredValidation,
      validationEvidenceMatrix,
      oosMultiWindowRegimeRetest,
      validationCandidateDisposition,
      validationDecision,
      strategyFailureMatrix,
      strategyRemediationReport,
      infrastructureReadinessReport,
      marketConstraintCoverageReport,
      postgresShadowReadinessReport,
      securityStatusCoverageReport,
      validationFailureTaxonomy,
      p4ClosureReview,
      p5ClosureReview,
      asyncStrategyEvidence,
      observability,
      strategyTournament,
      matchedCount: matched.length,
      partialSuccess: failures.length > 0,
      nextAction: marketDataCoverageReport.retryableWarmupSymbols.length > 0 ? {
        code: 'NEEDS_MARKET_DATA_WARMUP',
        operationType: 'market_bar_cache_preheat',
        message: '本地 canonical 行情缓存不足或过期，请先执行 K线预热。',
        suggestedInput: {
          userId: normalizedUserId,
          limit: scanUniverse.length,
          days: 120,
          chunkSize,
          concurrency: Math.min(options.concurrency, 4),
          forceRefresh: false,
          executionMode: 'queued',
        },
      } : null,
      candidates: candidates.map((candidate) => ({ ...candidate, aiAdvice: null })),
      failures,
      chunkSummary: {
        totalChunks: chunks.length,
        completedChunks: chunkSummaries.length,
        chunkSize,
        chunks: chunkSummaries,
      },
      artifactRefs,
      artifacts,
      rules: {
        drawdownPercent: `前高回撤 >= ${options.thresholds.drawdownPercent}%`,
        sidewaysRangePercent: `近20个交易日收盘价振幅 <= ${options.thresholds.sidewaysRangePercent}%`,
        lastTwoVolumeRatio: `最近2个交易日均量 / 前20日均量 >= ${options.thresholds.lastTwoVolumeRatio}`,
        ...(options.filters.peMax !== undefined ? { peMax: `市盈率 PE <= ${options.filters.peMax}` } : {}),
        ...(options.filters.peMin !== undefined ? { peMin: `市盈率 PE >= ${options.filters.peMin}` } : {}),
        ...(options.filters.marketCapMax !== undefined ? { marketCapMax: `总市值 <= ${this.formatMarketCap(options.filters.marketCapMax)}` } : {}),
        ...(options.filters.marketCapMin !== undefined ? { marketCapMin: `总市值 >= ${this.formatMarketCap(options.filters.marketCapMin)}` } : {}),
        ...(options.filters.industryIncludes ? { industryIncludes: `行业/板块包含 ${options.filters.industryIncludes}` } : {}),
      },
      disclaimer: this.adviceDisclaimer,
    }
  }

  async screenStocks(userId: string, query: string) {
    const startedAt = Date.now()
    const normalizedUserId = userId || 'default'
    const keyword = query.trim() || 'A杀后横盘并放量'
    const options = this.parseOptions(keyword)
    const { universe, excludedUniverse, universeSource, universeTotal } = await this.buildResolvedStockUniverse(normalizedUserId, {
      maxUniverse: options.maxUniverse,
    })
    const maxScan = options.maxScan && options.maxScan > 0 ? options.maxScan : universe.length
    const scanUniverse = universe.slice(0, maxScan)
    const factsetPreheatCoverage = this.buildFactsetPreheatCoverageReport({ universe, scanUniverse })
    const results: ScreenerMetric[] = []
    const failures: Array<{ symbol: string; name: string; error: string }> = []
    const backtestRecords: Array<{ asset: ScreenableStockAsset; history: StockHistoryData[] }> = []

    const screeningResults = await this.mapWithConcurrency(scanUniverse, options.concurrency, async (asset) => {
      try {
        let history = await this.getHistoryForScreening(asset.symbol, 120, options)
        if (history.length < options.thresholds.minHistoryDays) {
          history = await this.getHistoryForScreening(asset.symbol, 180, options)
        }
        if (history.length < options.thresholds.minHistoryDays) {
          return {
            result: null,
            history: null,
            asset: null,
            failure: {
              symbol: asset.symbol,
              name: asset.name,
              error: `历史K线不足${options.thresholds.minHistoryDays}个交易日，仅返回 ${history.length} 条，已从候选池排除。`,
            },
          }
        }
        return { result: this.evaluateByStrategy(asset, history, options), history, asset, failure: null }
      } catch (error) {
        return {
          result: null,
          history: null,
          asset: null,
          failure: { symbol: asset.symbol, name: asset.name, error: error instanceof Error ? error.message : '选股数据获取失败' },
        }
      }
    })
    for (const item of screeningResults) {
      if (item.result) results.push(item.result)
      if (item.result && item.history && item.asset) backtestRecords.push({ asset: item.asset, history: item.history })
      if (item.failure) failures.push(item.failure)
    }
    const enrichedResults = await this.enrichPeForFilterCandidates(results, options)
    results.splice(0, results.length, ...enrichedResults)

    const matched = results
      .filter((item) => item.matched)
      .sort((a, b) => b.score - a.score || b.lastTwoVolumeRatio - a.lastTwoVolumeRatio)
    const fallback = results
      .filter((item) => !item.matched)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(0, 5 - matched.length))
    const resultLimit = Math.max(1, Math.min(1000, Math.floor(options.maxResults || 200)))
    const candidates = [...matched, ...fallback.filter((item) => item.hardFilterPassed !== false)].slice(0, resultLimit)
    const dataQuality = {
      marketDataMode: options.marketDataMode,
      screened: results.length,
      insufficientHistory: failures.length,
      totalUniverse: universe.length,
      scanned: scanUniverse.length,
      scanCoveragePercent: universe.length > 0 ? Number(((scanUniverse.length / universe.length) * 100).toFixed(2)) : 0,
      historySources: Array.from(new Set(results.map((item) => item.historySource || 'unknown'))),
      factsetPreheatCoverage,
    }
    const observability = {
      elapsedMs: Date.now() - startedAt,
      concurrency: options.concurrency,
      marketDataMode: options.marketDataMode,
      providerSuccessRate: scanUniverse.length > 0 ? Number(((results.length / scanUniverse.length) * 100).toFixed(2)) : 0,
      failureCount: failures.length,
      matchedCount: matched.length,
    }
    const allowInlineBacktest = /即时回测\s*[:=：]?\s*(1|true|是)|inlineBacktest\s*[:=]\s*(1|true)/i.test(keyword)
    const asyncStrategyEvidence = await this.getLatestAsyncStrategyEvidence(normalizedUserId, options)
    let strategyTournament: ScreenerStrategyTournament | undefined
    let longSampleAcceptance: ScreenerLongSampleAcceptanceReport | undefined
    let validationEvidenceMatrix: ScreenerValidationEvidenceMatrixReport | undefined
    let oosMultiWindowRegimeRetest: ScreenerOosMultiWindowRegimeRetestReport | undefined
    let validationCandidateDisposition: ScreenerValidationCandidateDispositionReport | undefined
    if (allowInlineBacktest) {
      strategyTournament = this.evaluateStrategyTournament(backtestRecords, options)
      try {
        strategyTournament = await this.persistStrategyTournamentRun({
          userId: normalizedUserId,
          query: keyword,
          options,
          tournament: strategyTournament,
          dataQuality,
          observability,
          universe: {
            source: universeSource,
            size: universe.length,
            total: universeTotal,
            scanned: scanUniverse.length,
          },
        })
      } catch (error) {
        strategyTournament = {
          ...strategyTournament,
          persistenceStatus: 'failed',
          notes: [
            ...strategyTournament.notes,
            `回测批次保存失败：${error instanceof Error ? error.message : 'unknown error'}`,
          ],
        }
      }
      longSampleAcceptance = this.buildLongSampleAcceptanceReport({
        options,
        universeSize: universe.length,
        universeSource,
        universeTotal,
        scannedCount: scanUniverse.length,
        evaluatedCount: results.length,
        failureCount: failures.length,
        scanCoveragePercent: dataQuality.scanCoveragePercent,
        providerSuccessRate: observability.providerSuccessRate,
        tournament: strategyTournament,
        factsetPreheatCoverage,
      })
      validationEvidenceMatrix = this.buildValidationEvidenceMatrixReport({
        tournament: strategyTournament,
        longSampleAcceptance,
      })
      oosMultiWindowRegimeRetest = this.buildOosMultiWindowRegimeRetestReport({
        tournament: strategyTournament,
        validationEvidenceMatrix,
      })
      validationCandidateDisposition = this.buildValidationCandidateDispositionReport({
        validationEvidenceMatrix,
        oosMultiWindowRegimeRetest,
      })
    }
    const elapsedMs = Date.now() - startedAt
    observability.elapsedMs = elapsedMs

    return {
      query: keyword,
      strategy: this.strategies[options.strategyId].name,
      strategyDefinition: {
        id: this.strategies[options.strategyId].id,
        name: this.strategies[options.strategyId].name,
        description: this.strategies[options.strategyId].description,
        thresholds: options.thresholds,
        requiredHistoryDays: options.thresholds.minHistoryDays,
      },
      universeSize: universe.length,
      universeTotal,
      scannedCount: scanUniverse.length,
      universeSource,
      excludedUniverse,
      dataQuality,
      factsetPreheatCoverage,
      longSampleAcceptance,
      validationEvidenceMatrix,
      oosMultiWindowRegimeRetest,
      validationCandidateDisposition,
      asyncStrategyEvidence,
      observability,
      strategyTournament,
      matchedCount: matched.length,
      candidates: candidates.map((candidate) => ({
        ...candidate,
        aiAdvice: null,
      })),
      failures,
      rules: {
        drawdownPercent: `前高回撤 >= ${options.thresholds.drawdownPercent}%`,
        sidewaysRangePercent: `近20个交易日收盘价振幅 <= ${options.thresholds.sidewaysRangePercent}%`,
        lastTwoVolumeRatio: `最近2个交易日均量 / 前20日均量 >= ${options.thresholds.lastTwoVolumeRatio}`,
        ...(options.filters.peMax !== undefined ? { peMax: `市盈率 PE <= ${options.filters.peMax}` } : {}),
        ...(options.filters.peMin !== undefined ? { peMin: `市盈率 PE >= ${options.filters.peMin}` } : {}),
        ...(options.filters.marketCapMax !== undefined ? { marketCapMax: `总市值 <= ${this.formatMarketCap(options.filters.marketCapMax)}` } : {}),
        ...(options.filters.marketCapMin !== undefined ? { marketCapMin: `总市值 >= ${this.formatMarketCap(options.filters.marketCapMin)}` } : {}),
        ...(options.filters.industryIncludes ? { industryIncludes: `行业/板块包含 ${options.filters.industryIncludes}` } : {}),
      },
      disclaimer: this.adviceDisclaimer,
    }
  }
}

export const stockScreenerService = new StockScreenerService()
