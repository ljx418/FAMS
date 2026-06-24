import assert from 'node:assert/strict'
import { stockScreenerService } from '../src/services/screener/stockScreenerService.js'
import { operationService } from '../src/services/operation/operationService.js'
import { securityStatusService } from '../src/services/market-data/securityStatusService.js'
import { prisma } from '../src/db/prisma.js'

function buildHistory(options: { matched: boolean }) {
  const rows: Array<{ close: number; high: number; low: number; volume: number; source: string }> = []
  const baseVolume = 1000

  for (let index = 0; index < 40; index += 1) {
    const isRecent = index >= 20
    const close = options.matched
      ? isRecent
        ? 80 + ((index % 4) - 1.5) * 0.8
        : 115 - index * 0.8
      : isRecent
        ? 90 + ((index % 6) - 2.5) * 5
        : 100 - index * 0.1
    const volume = options.matched && index >= 38 ? 2200 : baseVolume
    rows.push({
      close,
      high: close * (index < 20 ? 1.08 : 1.02),
      low: close * 0.98,
      volume,
      source: 'fixture',
    })
  }

  return rows
}

function buildPlatformBreakoutHistory() {
  const rows: Array<{ close: number; high: number; low: number; volume: number; source: string }> = []
  for (let index = 0; index < 40; index += 1) {
    const close = index < 39 ? 50 + ((index % 5) - 2) * 0.35 : 52.2
    rows.push({
      close,
      high: index < 39 ? close * 1.008 : 52.5,
      low: close * 0.992,
      volume: index >= 38 ? 2200 : 1000,
      source: 'fixture',
    })
  }
  return rows
}

function buildMaReclaimHistory() {
  const rows: Array<{ close: number; high: number; low: number; volume: number; source: string }> = []
  for (let index = 0; index < 40; index += 1) {
    let close = 90 - index * 0.45
    if (index >= 20) close = 78 + (index - 20) * 0.15
    if (index === 38) close = 77.0
    if (index === 39) close = 82.5
    rows.push({
      close,
      high: index < 10 ? close * 1.28 : close * 1.02,
      low: close * 0.98,
      volume: index >= 38 ? 1700 : 1000,
      source: 'fixture',
    })
  }
  return rows
}

function buildWinningBacktestHistory() {
  const rows: Array<{
    date: string
    open: number
    close: number
    high: number
    low: number
    volume: number
    amount: number
    source: string
  }> = []
  for (let index = 0; index < 90; index += 1) {
    const isRecent = index >= 60
    let close = isRecent ? 80 + ((index % 4) - 1.5) * 0.45 : 128 - index * 0.75
    if (index >= 86) close = 81 + (index - 86) * 0.75
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10)
    rows.push({
      date,
      open: close,
      close,
      high: close * (index < 50 ? 1.08 : 1.02),
      low: close * 0.98,
      volume: index >= 80 ? 2400 : 1000,
      amount: close * (index >= 80 ? 2400 : 1000) * 100,
      source: 'fixture',
    })
  }
  return rows
}

async function main() {
  const matched = stockScreenerService.evaluateAFlushSidewaysVolume(
    { symbol: '600000', name: '策略命中样例' },
    buildHistory({ matched: true })
  )
  assert.equal(matched.matched, true, 'synthetic matched fixture should match')
  assert.equal(matched.unmatchedReasons.length, 0, 'matched fixture should not have unmatched reasons')
  assert.ok(matched.matchedRules.length >= 3, 'matched fixture should explain all matched rules')
  assert.ok(matched.score >= 90, 'matched fixture should have high score')

  const rejected = stockScreenerService.evaluateAFlushSidewaysVolume(
    { symbol: '600001', name: '策略未命中样例' },
    buildHistory({ matched: false })
  )
  assert.equal(rejected.matched, false, 'synthetic rejected fixture should not match')
  assert.ok(rejected.unmatchedReasons.length > 0, 'rejected fixture should explain unmatched reasons')
  assert.ok(rejected.advice.includes('未完全满足'), 'rejected fixture should carry actionable rejection text')

  const options = stockScreenerService.parseOptions('A杀横盘放量；扫描上限=33；回撤阈值=20；横盘振幅=8；量比阈值=1.8')
  assert.equal(options.maxScan, 33)
  assert.equal(options.strategyId, 'a_flush_sideways_volume')
  assert.equal(options.thresholds.drawdownPercent, 20)
  assert.equal(options.thresholds.sidewaysRangePercent, 8)
  assert.equal(options.thresholds.lastTwoVolumeRatio, 1.8)
  assert.equal(options.backtestDays, 5)
  assert.equal(options.holdingDays, 3)

  const breakoutOptions = stockScreenerService.parseOptions('放量突破平台；扫描上限=30')
  assert.equal(breakoutOptions.strategyId, 'volume_platform_breakout')
  const breakout = stockScreenerService.evaluateByStrategy(
    { symbol: '600002', name: '平台突破样例' },
    buildPlatformBreakoutHistory(),
    breakoutOptions
  )
  assert.equal(breakout.strategyId, 'volume_platform_breakout')
  assert.equal(breakout.matched, true, 'platform breakout fixture should match')
  assert.ok(breakout.matchedRules.some((rule) => rule.includes('突破平台高点')), 'platform breakout should explain breakout rule')

  const reclaimOptions = stockScreenerService.parseOptions('跌破后收复关键均线；扫描上限=30')
  assert.equal(reclaimOptions.strategyId, 'ma_reclaim')
  const reclaim = stockScreenerService.evaluateByStrategy(
    { symbol: '600003', name: '均线收复样例' },
    buildMaReclaimHistory(),
    reclaimOptions
  )
  assert.equal(reclaim.strategyId, 'ma_reclaim')
  assert.equal(reclaim.matched, true, 'MA reclaim fixture should match')
  assert.ok(reclaim.matchedRules.some((rule) => rule.includes('收复20日均线')), 'MA reclaim should explain reclaim rule')

  const tournament = stockScreenerService.evaluateStrategyTournament(
    [
      {
        asset: {
          symbol: '600004',
          name: '短窗胜率样例',
          type: 'stock',
          officialIndustryGroup: '乘用车',
          officialIndustryCode: 'BK1262',
          floatMarketCap: 36_000_000_000,
          metadataAsOf: '2026-03-27T15:00:00.000Z',
          metadataWarnings: [],
        },
        history: buildWinningBacktestHistory(),
      },
    ],
    stockScreenerService.parseOptions('多策略胜率；验证天数=5；持有天数=3')
  )
  const aFlushBacktest = tournament.ranked.find((item) => item.strategyId === 'a_flush_sideways_volume')
  assert.ok(aFlushBacktest, 'tournament should include A flush strategy')
  assert.equal(tournament.executionMatrix.schemaVersion, 'fams.screener.execution_matrix.v1', 'tournament should expose execution matrix')
  assert.equal(tournament.executionMatrix.totalCandidates, 126, '3 signal strategies x 42 core and regime-retest execution policies should be evaluated')
  assert.ok(
    tournament.executionMatrix.executionPolicies.some((item) => item.exitMode === 'stop_take_profit'),
    'execution matrix should include stop-loss/take-profit policies'
  )
  assert.ok(
    tournament.executionMatrix.executionPolicies.some((item) => item.entryMode === 't1_close'),
    'execution matrix should include T+1 close entry policies'
  )
  assert.ok(
    tournament.executionMatrix.executionPolicies.some((item) => item.exitMode === 'trailing_stop'),
    'execution matrix should include trailing stop exit policies'
  )
  assert.ok(
    tournament.executionMatrix.executionPolicies.some((item) => item.positionSizingMode === 'volatility_scaled'),
    'execution matrix should include volatility-scaled sizing policies'
  )
  assert.ok(
    tournament.executionMatrix.executionPolicies.some((item) => item.regimeFilterMode === 'avoid_high_volatility_chop'),
    'execution matrix should include local regime filter policies'
  )
  assert.ok(tournament.ranked.every((item) => item.candidateId && item.executionPolicy), 'ranked items should expose candidate id and execution policy')
  assert.ok((aFlushBacktest?.signals || 0) >= 1, 'A flush backtest should find at least one signal')
  assert.ok((aFlushBacktest?.wins || 0) >= 1, 'A flush backtest should count winning signal')
  assert.ok((aFlushBacktest?.tradeCount || 0) >= 1, 'A flush backtest should count executable trades')
  assert.ok(aFlushBacktest?.samples[0]?.entryDate, 'sample should use T+1 entry date')
  assert.ok(aFlushBacktest?.samples[0]?.entryReason, 'sample should expose entry reason')
  assert.ok(aFlushBacktest?.samples[0]?.positionSizingReason, 'sample should expose position sizing reason')
  assert.ok(typeof aFlushBacktest?.samples[0]?.grossReturnPercent === 'number', 'sample should include gross return')
  assert.ok(typeof aFlushBacktest?.samples[0]?.costPercent === 'number', 'sample should include cost impact')
  assert.ok(typeof aFlushBacktest?.maxDrawdownPercent === 'number', 'strategy should include max drawdown')
  assert.ok(typeof aFlushBacktest?.profitFactor === 'number' || aFlushBacktest?.profitFactor === null, 'strategy should include profit factor')
  assert.ok((aFlushBacktest?.equityCurve.length || 0) >= 1, 'strategy should include equity curve')
  assert.equal(aFlushBacktest?.versionBundle.schemaVersion, 'fams.screener.tournament_candidate.v1', 'strategy should include version bundle')
  assert.match(aFlushBacktest?.auditHash || '', /^[a-f0-9]{64}$/, 'strategy should include audit hash')
  assert.equal(aFlushBacktest?.outOfSampleValidation.schemaVersion, 'fams.screener.oos_validation.v1', 'strategy should include out-of-sample validation')
  assert.equal(aFlushBacktest?.walkForwardValidation.schemaVersion, 'fams.screener.walk_forward.v1', 'strategy should include walk-forward validation')
  assert.equal(aFlushBacktest?.parameterSensitivity.schemaVersion, 'fams.screener.parameter_sensitivity.v1', 'strategy should include parameter sensitivity')
  assert.equal(aFlushBacktest?.groupStabilityValidation.schemaVersion, 'fams.screener.group_stability.v1', 'strategy should include grouped stability validation')
  assert.ok(aFlushBacktest?.groupStabilityValidation.dimensions.some((item) => item.dimension === 'market_segment'), 'group stability should include market segment dimension')
  assert.ok(aFlushBacktest?.groupStabilityValidation.dimensions.every((item) => typeof item.averageConfidence === 'number'), 'group stability should expose dimension confidence')
  assert.ok(aFlushBacktest?.samples[0]?.groupMetadata?.schemaVersion, 'sample should expose group metadata lineage')
  assert.equal(aFlushBacktest?.samples[0]?.groupMetadata?.industryGroup.provider, 'eastmoney_fundamental_cache', 'official industry cache should be preferred when available')
  assert.equal(aFlushBacktest?.samples[0]?.groupMetadata?.marketCapGroup.provider, 'eastmoney_fundamental_cache', 'official market-cap cache should be preferred when available')
  assert.ok(tournament.assumptions.entryPolicy.includes('T+1'), 'tournament should expose T+1 entry assumptions')
  assert.equal(tournament.evaluationDays, 5)
  assert.equal(tournament.holdingDays, 3)

  const coverageReport = (stockScreenerService as any).buildFactsetPreheatCoverageReport({
    universe: [
      {
        symbol: '600004',
        name: '短窗胜率样例',
        type: 'stock',
        officialIndustryGroup: '乘用车',
        officialIndustryCode: 'BK1262',
        totalMarketCap: 120_000_000_000,
        metadataProvider: 'eastmoney_fundamental_cache',
      },
      { symbol: '600005', name: '缺失缓存样例', type: 'stock' },
    ],
    scanUniverse: [
      {
        symbol: '600004',
        name: '短窗胜率样例',
        type: 'stock',
        officialIndustryGroup: '乘用车',
        officialIndustryCode: 'BK1262',
        totalMarketCap: 120_000_000_000,
        metadataProvider: 'eastmoney_fundamental_cache',
      },
      { symbol: '600005', name: '缺失缓存样例', type: 'stock' },
    ],
    initial: { fullOfficialCoveragePercent: 0 },
    preheat: { attempted: 1, successCount: 1, failureCount: 0 },
  })
  assert.equal(coverageReport.schemaVersion, 'fams.screener.factset_preheat_coverage.v1')
  assert.equal(coverageReport.scanned.fullOfficialCoverageCount, 1)
  assert.equal(coverageReport.scanned.fullOfficialCoveragePercent, 50)
  assert.equal(coverageReport.preheat.successCount, 1)
  assert.ok(coverageReport.scanned.missingIndustrySymbols.some((item: string) => item.includes('600005')))
  assert.ok(coverageReport.warnings.some((item: string) => item.includes('覆盖率')))

  const longSampleAcceptance = (stockScreenerService as any).buildLongSampleAcceptanceReport({
    options: stockScreenerService.parseOptions('多策略胜率；验证天数=5；持有天数=3'),
    universeSize: 2,
    universeSource: 'fixture',
    universeTotal: 2,
    scannedCount: 2,
    evaluatedCount: 1,
    failureCount: 1,
    scanCoveragePercent: 100,
    providerSuccessRate: 50,
    cacheHitRate: 100,
    tournament,
    factsetPreheatCoverage: coverageReport,
  })
  assert.equal(longSampleAcceptance.schemaVersion, 'fams.screener.long_sample_acceptance.v1')
  assert.equal(longSampleAcceptance.status, 'insufficient', 'short-window fixture must not pass long-sample acceptance')
  assert.ok(longSampleAcceptance.gates.some((item: any) => item.id === 'backtest_window' && item.status === 'failed'))
  assert.ok(longSampleAcceptance.recommendations.some((item: string) => item.includes('不得作为高可信全 A 长样本结论')))
  const validationDecision = (stockScreenerService as any).buildValidationDecision({
    longSampleAcceptance,
    outOfSampleDiagnostics: {
      diagnosedCandidates: 3,
      passedCount: 0,
      failedCount: 3,
      globalFindings: ['已深度验证候选均未通过样本外验证，当前策略证据不得进入交易建议。'],
    },
    outOfSampleMarketStateDiagnostics: {
      globalFindings: ['市场状态从弱势回撤切换为高波动震荡'],
    },
  })
  assert.equal(validationDecision.schemaVersion, 'fams.screener.validation_decision.v1')
  assert.equal(validationDecision.decision, 'OBSERVE_ONLY')
  assert.equal(validationDecision.usableForTradingAdvice, false)
  assert.ok(validationDecision.prohibitedActions.includes('ADD'))
  assert.ok(validationDecision.prohibitedActions.includes('REDUCE'))
  assert.ok(validationDecision.reasons.some((item: string) => item.includes('样本外')))
  assert.ok(validationDecision.evidenceRefs.includes('oos_failure_analysis.json'))
  const oosFailureAnalysis = (stockScreenerService as any).buildOosFailureAnalysis({
    tournament,
    outOfSampleDiagnostics: {
      diagnosedCandidates: 3,
      passedCount: 0,
      failedCount: 3,
    },
    outOfSampleMarketStateDiagnostics: {
      globalFindings: ['市场状态从弱势回撤切换为高波动震荡'],
    },
  })
  assert.equal(oosFailureAnalysis.schemaVersion, 'fams.screener.oos_failure_analysis.v1')
  assert.ok(Array.isArray(oosFailureAnalysis.candidates))
  assert.ok(oosFailureAnalysis.candidates.length > 0)
  assert.ok(Array.isArray(oosFailureAnalysis.globalFailureTags))
  assert.ok(oosFailureAnalysis.globalFailureTags.includes('market_regime_shift'))
  assert.ok(oosFailureAnalysis.candidates[0].trainDistribution)
  assert.ok(oosFailureAnalysis.candidates[0].outOfSampleDistribution)
  assert.ok(oosFailureAnalysis.candidates[0].signalDateDistribution)
  const oosLayeredValidation = (stockScreenerService as any).buildOosLayeredValidationReport({
    tournament,
  })
  assert.equal(oosLayeredValidation.schemaVersion, 'fams.screener.oos_layered_validation.v1')
  assert.ok(['passed', 'completed_with_blockers', 'insufficient'].includes(oosLayeredValidation.status))
  assert.equal(oosLayeredValidation.summary.dimensions, 3)
  assert.ok(oosLayeredValidation.dimensions.some((item: any) => item.dimension === 'market_regime'))
  const validationEvidenceMatrix = (stockScreenerService as any).buildValidationEvidenceMatrixReport({
    tournament,
    longSampleAcceptance,
  })
  assert.equal(validationEvidenceMatrix.schemaVersion, 'fams.screener.validation_evidence_matrix.v1')
  assert.ok(['passed', 'blocked'].includes(validationEvidenceMatrix.status))
  assert.ok(['READY_FOR_MANUAL_REVIEW', 'OBSERVE_ONLY'].includes(validationEvidenceMatrix.decision))
  assert.ok(Array.isArray(validationEvidenceMatrix.candidates))
  assert.ok(validationEvidenceMatrix.candidates.length > 0)
  assert.ok(validationEvidenceMatrix.candidates[0].validation)
  assert.ok(Array.isArray(validationEvidenceMatrix.candidates[0].failedChecks))
  assert.ok(validationEvidenceMatrix.closurePlan.some((item: string) => item.includes('validation_evidence')))
  const oosMultiWindowRegimeRetest = (stockScreenerService as any).buildOosMultiWindowRegimeRetestReport({
    tournament,
    validationEvidenceMatrix,
  })
  assert.equal(oosMultiWindowRegimeRetest.schemaVersion, 'fams.screener.oos_multi_window_regime_retest.v1')
  assert.ok(['passed', 'completed_with_blockers', 'insufficient'].includes(oosMultiWindowRegimeRetest.status))
  assert.ok(oosMultiWindowRegimeRetest.method.includes('multi_split'))
  assert.ok(Array.isArray(oosMultiWindowRegimeRetest.candidates))
  assert.ok(oosMultiWindowRegimeRetest.summary.windows >= 0)
  assert.ok(oosMultiWindowRegimeRetest.nextActions.some((item: string) => item.includes('validation_evidence')))
  const validationCandidateDisposition = (stockScreenerService as any).buildValidationCandidateDispositionReport({
    validationEvidenceMatrix,
    oosMultiWindowRegimeRetest,
  })
  assert.equal(validationCandidateDisposition.schemaVersion, 'fams.screener.validation_candidate_disposition.v1')
  assert.ok(['ready_for_manual_review', 'research_only', 'blocked'].includes(validationCandidateDisposition.status))
  assert.ok(['READY_FOR_MANUAL_REVIEW', 'CONTINUE_RESEARCH_ONLY'].includes(validationCandidateDisposition.decision))
  assert.ok(validationCandidateDisposition.summary.totalCandidates > 0)
  assert.ok(validationCandidateDisposition.candidates.every((item: any) => item.prohibitedActions.includes('AUTO_TRADE')))
  assert.ok(validationCandidateDisposition.rules.some((item: string) => item.includes('ADD / REDUCE')))
  const strategyFailureMatrix = (stockScreenerService as any).buildStrategyFailureMatrixReport({
    tournament,
    validationEvidenceMatrix,
    oosMultiWindowRegimeRetest,
  })
  assert.equal(strategyFailureMatrix.schemaVersion, 'fams.screener.strategy_failure_matrix.v1')
  assert.ok(['blocked', 'ready_for_manual_review'].includes(strategyFailureMatrix.status))
  assert.equal(strategyFailureMatrix.summary.diagnosedCandidates, validationEvidenceMatrix.candidates.length)
  assert.ok(Array.isArray(strategyFailureMatrix.queues.retestQueue))
  assert.ok(Array.isArray(strategyFailureMatrix.queues.retireQueue))
  assert.ok(Array.isArray(strategyFailureMatrix.queues.expandSampleQueue))
  assert.ok(Array.isArray(strategyFailureMatrix.queues.regimeSpecificQueue))
  assert.ok(strategyFailureMatrix.candidates.every((item: any) => item.prohibitedActions.includes('AUTO_TRADE')))
  assert.ok(strategyFailureMatrix.nextActions.some((item: string) => item.includes('validationDecision.usableForTradingAdvice')))
  const strategyRemediationReport = (stockScreenerService as any).buildStrategyRemediationReport({
    validationDecision,
    strategyFailureMatrix,
  })
  assert.equal(strategyRemediationReport.schemaVersion, 'fams.screener.strategy_remediation_report.v1')
  assert.ok(['research_only', 'ready_for_manual_review'].includes(strategyRemediationReport.status))
  assert.equal(strategyRemediationReport.summary.usableForTradingAdvice, validationDecision.usableForTradingAdvice)
  assert.ok(strategyRemediationReport.remediations.length > 0)
  assert.ok(strategyRemediationReport.remediations.every((item: any) => item.prohibitedActions.includes('AUTO_TRADE')))
  assert.ok(strategyRemediationReport.nextActions.some((item: string) => item.includes('validation_evidence_matrix')))
  const infrastructureReadinessReport = (stockScreenerService as any).buildInfrastructureReadinessReport({
    operationId: 'test-operation',
    keyword: '多策略胜率；全A样本；扫描上限=5；验证天数=5；持有天数=3；分片大小=5',
    options: stockScreenerService.parseOptions('多策略胜率；验证天数=5；持有天数=3'),
    chunkSize: 5,
    scannedCount: 5,
    evaluatedCount: 4,
    artifactCount: 24,
  })
  assert.equal(infrastructureReadinessReport.schemaVersion, 'fams.screener.infrastructure_readiness.v1')
  assert.ok(['blocked', 'needs_review', 'ready'].includes(infrastructureReadinessReport.status))
  assert.ok(infrastructureReadinessReport.gates.some((item: any) => item.id === 'database_provider'))
  assert.ok(infrastructureReadinessReport.gates.some((item: any) => item.id === 'market_data_mode' && item.status === 'passed'))
  assert.ok(infrastructureReadinessReport.migrationPlan.requiredBeforeProductionFullA.some((item: string) => item.includes('PostgreSQL')))
  const marketConstraintCoverageReport = (stockScreenerService as any).buildMarketConstraintCoverageReport(tournament)
  assert.equal(marketConstraintCoverageReport.schemaVersion, 'fams.screener.market_constraint_coverage.v1')
  assert.equal(marketConstraintCoverageReport.constraintVersion, 'constraint.cn_a_share_tradeability.v1')
  assert.ok(marketConstraintCoverageReport.summary.rankedCandidates > 0)
  assert.ok(Array.isArray(marketConstraintCoverageReport.blockedReasonSummary))
  assert.ok(marketConstraintCoverageReport.nextActions.some((item: string) => item.includes('证券状态')))
  const postgresShadowReadinessReport = await (stockScreenerService as any).buildPostgresShadowReadinessReport()
  assert.equal(postgresShadowReadinessReport.schemaVersion, 'fams.infrastructure.postgres_shadow_readiness.v1')
  assert.equal(postgresShadowReadinessReport.mode, 'shadow_only')
  assert.ok(postgresShadowReadinessReport.copyStagingPlan.stagingTables.includes('staging_market_bar_raw'))
  assert.ok(['not_configured', 'configured_not_verified', 'ready'].includes(postgresShadowReadinessReport.status))
  assert.ok(['psql_available', 'psql_missing'].includes(postgresShadowReadinessReport.verification.clientTool))
  await securityStatusService.upsertHeuristicFromRecords([{
    asset: { symbol: '600099', name: '*ST证券状态测试' },
    history: buildWinningBacktestHistory(),
  }])
  const securityStatusSnapshot = await securityStatusService.getCoverageSnapshot(['600099'])
  assert.equal(securityStatusSnapshot.schemaVersion, 'fams.market.security_status_coverage_snapshot.v1')
  assert.equal(securityStatusSnapshot.symbolsWithStatus, 1)
  assert.equal(securityStatusSnapshot.symbolsWithTradeability, 1)
  assert.ok(securityStatusSnapshot.heuristicRows + securityStatusSnapshot.officialProviderRows >= 2)
  assert.equal(securityStatusSnapshot.formalTradingStateRows, 0)
  const latestSecurityFacts = await securityStatusService.getLatestFacts(['600099'])
  assert.ok(['heuristic', 'quote_list_canonical', 'baostock'].includes(latestSecurityFacts.get('600099')?.securityStatus?.provider || ''))
  const securityStatusCoverageReport = (stockScreenerService as any).buildSecurityStatusCoverageReport(marketConstraintCoverageReport, securityStatusSnapshot)
  assert.equal(securityStatusCoverageReport.schemaVersion, 'fams.market.security_status_coverage.v1')
  assert.equal(securityStatusCoverageReport.status, 'sufficient')
  assert.equal(securityStatusCoverageReport.providerPolicy, 'free_sources_primary_tushare_optional')
  assert.ok(securityStatusCoverageReport.providerCandidates.some((item: any) => item.provider === 'tushare'))
  assert.ok(securityStatusCoverageReport.requiredFields.includes('limitUp'))
  assert.equal(securityStatusCoverageReport.coverageSnapshot?.symbolsWithStatus, 1)
  assert.ok(securityStatusCoverageReport.gates.some((item: any) => item.id === 'formal_trade_state_rows' && item.status === 'warning'))
  const validationFailureTaxonomy = (stockScreenerService as any).buildValidationFailureTaxonomyReport({
    validationDecision,
    oosFailureAnalysis,
    oosLayeredValidation,
  })
  assert.equal(validationFailureTaxonomy.schemaVersion, 'fams.screener.validation_failure_taxonomy.v1')
  assert.ok(['blocked_for_trading', 'ready_for_manual_review'].includes(validationFailureTaxonomy.status))
  assert.ok(validationFailureTaxonomy.failureClasses.some((item: any) => item.id === 'validation_gate_blocked'))
  assert.equal(validationFailureTaxonomy.layeredValidation?.status, oosLayeredValidation.status)
  assert.ok(validationFailureTaxonomy.nextActions.some((item: string) => item.includes('分层 OOS')))
  const p4ClosureReview = (stockScreenerService as any).buildP4ClosureReviewReport({
    longSampleAcceptance,
    validationDecision,
    validationCandidateDisposition,
    infrastructureReadinessReport,
    marketConstraintCoverageReport,
    postgresShadowReadinessReport,
    securityStatusCoverageReport,
    validationFailureTaxonomy,
  })
  assert.equal(p4ClosureReview.schemaVersion, 'fams.screener.p4_closure_review.v1')
  assert.equal(p4ClosureReview.phase, 'P4.34')
  assert.equal(p4ClosureReview.decision, 'CONTINUE_RESEARCH_ONLY')
  assert.equal(p4ClosureReview.summary.usableForTradingAdvice, false)
  assert.ok(p4ClosureReview.gates.some((item: any) => item.id === 'validation_decision' && item.status === 'failed'))
  assert.ok(p4ClosureReview.remainingBlockers.some((item: string) => item.includes('交易建议边界')))
  assert.ok(p4ClosureReview.artifactRefs.includes('market_constraint_coverage_report.json'))
  assert.ok(p4ClosureReview.artifactRefs.includes('validation_candidate_disposition.json'))
  assert.ok(p4ClosureReview.artifactRefs.includes('postgres_shadow_readiness_report.json'))
  assert.ok(p4ClosureReview.gates.some((item: any) => item.id === 'candidate_disposition'))
  assert.ok(p4ClosureReview.gates.some((item: any) => item.id === 'security_status_coverage'))
  const p5ClosureReview = (stockScreenerService as any).buildP5ClosureReviewReport({
    postgresShadowReadinessReport,
    securityStatusCoverageReport,
    validationFailureTaxonomy,
    p4ClosureReview,
  })
  assert.equal(p5ClosureReview.schemaVersion, 'fams.screener.p5_closure_review.v1')
  assert.equal(p5ClosureReview.phase, 'P5')
  assert.equal(p5ClosureReview.summary.productionReady, false)
  assert.ok(p5ClosureReview.gates.some((item: any) => item.id === 'postgres_shadow' && ['passed', 'failed'].includes(item.status)))
  assert.ok(p5ClosureReview.gates.some((item: any) => item.id === 'security_status_provider' && item.status === 'passed'))
  assert.ok(p5ClosureReview.gates.some((item: any) => item.id === 'p4_trading_gate' && item.severity === 'blocker'))
  assert.ok(p5ClosureReview.artifactRefs.includes('security_status_coverage_report.json'))
  await assert.rejects(
    () => operationService.startStockScreenerFullScanOperation({
      userId: '__screener_test__',
      mode: 'long_sample_full',
    }),
    /confirmedFullScan=true/,
    'full long-sample scan should require explicit confirmation'
  )

  const persisted = await stockScreenerService.persistStrategyTournamentRun({
    userId: '__screener_test__',
    query: '多策略胜率持久化测试',
    options: stockScreenerService.parseOptions('多策略胜率；验证天数=5；持有天数=3'),
    tournament,
    dataQuality: { screened: 1, insufficientHistory: 0, historySources: ['fixture'] },
    observability: { elapsedMs: 1, providerSuccessRate: 100 },
    universe: { source: 'fixture', size: 1, total: 1, scanned: 1 },
  })
  assert.equal(persisted.persistenceStatus, 'persisted')
  assert.ok(persisted.batchId, 'persisted tournament should have batch id')
  assert.ok(
    persisted.ranked.every((item) => item.persistedBacktestId && item.persistedResultId && item.persistedStrategyVersionId),
    'each strategy ranking should link to persisted strategy version, backtest and result ids'
  )
  const persistedStrategyVersion = await prisma.strategyVersion.findUnique({
    where: { id: persisted.ranked[0].persistedStrategyVersionId! },
  })
  assert.equal(persistedStrategyVersion?.strategyKey, persisted.ranked[0].strategyId, 'strategy version should keep strategy key')
  assert.equal(persistedStrategyVersion?.schemaVersion, 'fams.screener.tournament_candidate.v1', 'strategy version should keep schema version')
  assert.equal(persistedStrategyVersion?.auditHash, persisted.ranked[0].auditHash, 'strategy version should keep audit hash')
  assert.ok(persistedStrategyVersion?.versionBundleJson.includes('signalStrategy'), 'strategy version should keep version bundle json')
  const persistedBacktest = await prisma.backtest.findUnique({
    where: { id: persisted.ranked[0].persistedBacktestId! },
    include: { results: true, strategy: true },
  })
  assert.equal(persistedBacktest?.status, 'completed')
  assert.equal(persistedBacktest?.strategy.type, 'stock_screener')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes(persisted.batchId!), 'review report should carry batch id')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes('strategyVersionId'), 'review report should carry strategy version id')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes('candidateId'), 'review report should carry candidate id')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes('executionMatrix'), 'review report should carry execution matrix')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes('versionBundle'), 'review report should carry version bundle')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes('auditHash'), 'review report should carry audit hash')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes('outOfSampleValidation'), 'review report should carry out-of-sample validation')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes('walkForwardValidation'), 'review report should carry walk-forward validation')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes('parameterSensitivity'), 'review report should carry parameter sensitivity')
  assert.ok(persistedBacktest?.results[0]?.reviewReportJson.includes('groupStabilityValidation'), 'review report should carry grouped stability validation')
  await prisma.backtest.deleteMany({
    where: { id: { in: persisted.ranked.map((item) => item.persistedBacktestId!).filter(Boolean) } },
  })
  await prisma.strategy.deleteMany({ where: { userId: '__screener_test__' } })

  console.log(JSON.stringify({
    ok: true,
    matched: {
      score: matched.score,
      matchedRules: matched.matchedRules,
    },
    rejected: {
      score: rejected.score,
      unmatchedReasons: rejected.unmatchedReasons,
    },
    options,
    breakout: {
      score: breakout.score,
      matchedRules: breakout.matchedRules,
    },
    reclaim: {
      score: reclaim.score,
      matchedRules: reclaim.matchedRules,
    },
    tournament: {
      batchId: persisted.batchId,
      ranked: tournament.ranked.map((item) => ({
        strategyId: item.strategyId,
        signals: item.signals,
              wins: item.wins,
              winRatePercent: item.winRatePercent,
              maxDrawdownPercent: item.maxDrawdownPercent,
              sharpe: item.sharpe,
            })),
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
