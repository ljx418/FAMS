import { dividendLowVolStrategyService } from './dividendLowVolStrategyService.js'
import type { DividendLowVolFactSet, DividendLowVolInput } from './dividendLowVolTypes.js'
import { dividendLowVolFreeSourceBenchmarkService } from './freeSourceBenchmarkService.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type BacktestOptions = {
  initialCapital?: number
  dividendReinvestment?: boolean
  rebalanceFrequency?: 'monthly' | 'weekly'
  transactionCostBps?: number
  slippageBps?: number
  benchmarkSeries?: Array<{ date: string; value: number; evidenceRef?: string }>
  benchmarkName?: string
  benchmarkSource?: string
  validationRunMode?: string
  validationInputSource?: string
  researchEligibilityMode?: 'strict_disposition' | 'expanded_observation'
}

function round(value: number, precision = 4) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function maxDrawdown(values: number[]) {
  let peak = values[0] || 0
  let worst = 0
  for (const value of values) {
    peak = Math.max(peak, value)
    if (peak > 0) worst = Math.min(worst, (value - peak) / peak)
  }
  return round(worst * 100, 2)
}

function safePercent(numerator: number, denominator: number) {
  if (denominator <= 0) return 0
  return round((numerator / denominator) * 100, 2)
}

function isFormalTradeabilityEvidence(ref?: string) {
  return Boolean(ref && (
    ref.includes('market-tradeability-daily') ||
    ref.includes('stk_limit') ||
    ref.includes('formal-provider') ||
    ref.includes('tushare')
  ))
}

function isFreeSourceTradeabilityEvidence(ref?: string) {
  return Boolean(ref && (
    ref.includes('market-history-free-provider') ||
    ref.includes('bar-derived-limit') ||
    ref.includes('free-source:tradeability') ||
    ref.includes('audit-fixture:tradeability')
  ))
}

export class DividendLowVolBacktestService {
  run(inputs: DividendLowVolInput[], options: BacktestOptions = {}) {
    const pool = dividendLowVolStrategyService.buildCandidatePool(inputs)
    const tradable = pool.candidates.filter((candidate) => this.isResearchTradable(candidate, options.researchEligibilityMode || 'strict_disposition'))
    if (tradable.length === 0) {
      return this.insufficient(pool, 'no_research_eligible_candidates')
    }

    const historyBySymbol = new Map(inputs.map((input) => [input.symbol, input.history || []]))
    const paths = tradable
      .map((candidate) => historyBySymbol.get(candidate.identity.symbol) || [])
      .filter((path) => path.length >= 20)
    if (paths.length === 0) {
      return this.insufficient(pool, 'history_insufficient_for_backtest')
    }

    const initialCapital = options.initialCapital || 100_000
    const minLength = Math.min(...paths.map((path) => path.length))
    const equityCurve = []
    const dividendYieldContribution = tradable.reduce((sum, candidate) => sum + (candidate.dividend.ttmDividendYield || 0), 0) / Math.max(tradable.length, 1)
    const rebalanceStep = options.rebalanceFrequency === 'weekly' ? 5 : 21
    const transactionCostRate = ((options.transactionCostBps ?? 12) + (options.slippageBps ?? 8)) / 10000
    const rebalanceEvents = []
    for (let index = 0; index < minLength; index += 1) {
      const basketReturn = paths.reduce((sum, path) => sum + (path[index].close / path[0].close - 1), 0) / paths.length
      const dividendReturn = options.dividendReinvestment === false ? 0 : (dividendYieldContribution / 100) * (index / Math.max(minLength - 1, 1))
      const rebalanceCount = Math.floor(index / rebalanceStep)
      const costDrag = rebalanceCount * transactionCostRate
      const value = initialCapital * (1 + basketReturn + dividendReturn - costDrag)
      if (index > 0 && index % rebalanceStep === 0) {
        rebalanceEvents.push({
          index,
          date: paths[0][index].date,
          candidateCount: tradable.length,
          estimatedCostPercent: round(transactionCostRate * 100, 4),
        })
      }
      equityCurve.push({
        index,
        date: paths[0][index].date,
        value: round(value, 2),
        drawdownPercent: 0,
      })
    }
    const values = equityCurve.map((point) => point.value)
    let peak = values[0] || initialCapital
    for (const point of equityCurve) {
      peak = Math.max(peak, point.value)
      point.drawdownPercent = peak > 0 ? round(((point.value - peak) / peak) * 100, 2) : 0
    }
    const totalReturnPercent = ((values.at(-1) || initialCapital) / initialCapital - 1) * 100
    const priceOnlyReturnPercent = paths.reduce((sum, path) => sum + (path[minLength - 1].close / path[0].close - 1), 0) / paths.length * 100
    const dividendContributionPercent = options.dividendReinvestment === false ? 0 : dividendYieldContribution
    const capitalGainContributionPercent = totalReturnPercent - dividendContributionPercent
    const maxDrawdownPercent = maxDrawdown(values)
    const days = minLength
    const annualizedReturnPercent = ((1 + totalReturnPercent / 100) ** (252 / Math.max(days, 1)) - 1) * 100
    const localBenchmark = options.benchmarkSeries && options.benchmarkSeries.length > 0
      ? null
      : dividendLowVolFreeSourceBenchmarkService.loadLocalTotalReturnBenchmark()
    const effectiveOptions = localBenchmark?.status === 'available'
      ? {
        ...options,
        benchmarkSeries: localBenchmark.points,
        benchmarkName: localBenchmark.name,
        benchmarkSource: localBenchmark.source,
      }
      : options
    const benchmarkAssessment = this.benchmarkReturn(paths, minLength, effectiveOptions)
    const benchmarkReturnPercent = benchmarkAssessment.returnPercent
    const excessReturnPercent = totalReturnPercent - benchmarkReturnPercent
    const tradeConstraintAssessment = this.assessTradeConstraints(paths, tradable)
    const formalBenchmarkReady = benchmarkAssessment.status === 'free_source_total_return'
    const exDividendTotalReturnReady = tradeConstraintAssessment.exDividendAdjustedTotalReturnSeriesReady
    const limitTradeabilityReady = tradeConstraintAssessment.limitUpDownDailyStateReady
    const suspensionStateReady = tradeConstraintAssessment.suspensionDailyStateReady
    const tradeConstraintInsufficientItems = [
      ...(!limitTradeabilityReady ? ['limit_up_down_daily_state'] : []),
      ...(!suspensionStateReady ? ['suspension_daily_state'] : []),
      ...(!exDividendTotalReturnReady ? ['ex_dividend_adjusted_total_return_series'] : []),
    ]
    const formalBacktestReady = formalBenchmarkReady && tradeConstraintInsufficientItems.length === 0
    const validationEvidence = this.buildValidationEvidence({
      equityCurve,
      tradable,
      paths,
      minLength,
      excessReturnPercent,
    })

    return {
      schemaVersion: 'dividend.low_vol.backtest_result.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: dividendLowVolStrategyService.strategyFamily,
      strategyId: dividendLowVolStrategyService.strategyId,
      status: 'completed',
      options: {
        initialCapital,
        dividendReinvestment: options.dividendReinvestment !== false,
        rebalanceFrequency: options.rebalanceFrequency || 'monthly',
        transactionCostBps: options.transactionCostBps ?? 12,
        slippageBps: options.slippageBps ?? 8,
        researchEligibilityMode: options.researchEligibilityMode || 'strict_disposition',
      },
      sample: {
        inputCount: inputs.length,
        candidateCount: pool.total,
        researchEligibleCount: tradable.length,
        effectivePathCount: paths.length,
        tradingDays: minLength,
      },
      metrics: {
        totalReturnPercent: round(totalReturnPercent, 2),
        annualizedReturnPercent: round(annualizedReturnPercent, 2),
        maxDrawdownPercent,
        dividendContributionPercent: round(dividendContributionPercent, 2),
        capitalGainContributionPercent: round(capitalGainContributionPercent, 2),
        priceOnlyReturnPercent: round(priceOnlyReturnPercent, 2),
        estimatedCostDragPercent: round(Math.floor((minLength - 1) / rebalanceStep) * transactionCostRate * 100, 2),
        benchmarkReturnPercent: round(benchmarkReturnPercent, 2),
        excessReturnPercent: round(excessReturnPercent, 2),
        calmar: maxDrawdownPercent < 0 ? round(annualizedReturnPercent / Math.abs(maxDrawdownPercent), 3) : null,
      },
      validationEvidence: {
        ...validationEvidence,
        reason: 'Research backtest only. Dividend-adjusted OOS/walk-forward/parameter/group validation must be promoted through the formal validation evidence pipeline before ADD / REDUCE.',
      },
      policy: pool.policy,
      benchmark: {
        primary: benchmarkAssessment.name,
        fallback: 'equal_weight_research_candidate_basket',
        status: benchmarkAssessment.status,
        source: benchmarkAssessment.source,
        evidenceRefs: benchmarkAssessment.evidenceRefs,
        localFreeSourceLoad: localBenchmark ? {
          status: localBenchmark.status,
          path: localBenchmark.path,
          pointCount: localBenchmark.points.length,
          blockers: localBenchmark.blockers,
        } : undefined,
        note: formalBenchmarkReady
          ? 'Free-source total-return benchmark series is provided with evidence references.'
          : 'Index-level total-return benchmark data is not yet wired into this module; benchmarkReturnPercent uses equal-weight candidate price paths as a proxy.',
      },
      tradeConstraintAudit: {
        schemaVersion: 'dividend.low_vol.trade_constraint_audit.v1',
        feeAndSlippageApplied: true,
        dividendReinvestmentApplied: options.dividendReinvestment !== false,
        exDividendAdjustedTotalReturnSeries: exDividendTotalReturnReady ? 'available_from_dividend_records' : 'not_available',
        limitUpDownConstraint: limitTradeabilityReady ? 'available_from_free_source_tradeability' : 'not_available_in_current_market_bar_schema',
        suspensionConstraint: suspensionStateReady ? 'available_from_free_source_tradeability' : 'not_available_or_partial',
        stDelistConstraint: 'handled_before_candidate_entry',
        insufficientItems: tradeConstraintInsufficientItems,
        coverage: tradeConstraintAssessment.coverage,
        evidenceRefs: tradeConstraintAssessment.evidenceRefs,
      },
      formalBacktestGate: {
        ready: formalBacktestReady,
        officialTotalReturnBenchmarkReady: formalBenchmarkReady,
        exDividendAdjustedTotalReturnSeriesReady: exDividendTotalReturnReady,
        limitUpDownDailyStateReady: limitTradeabilityReady,
        suspensionDailyStateReady: suspensionStateReady,
        blockers: [
          ...(!formalBenchmarkReady ? ['official_total_return_benchmark_missing_or_proxy'] : []),
          ...tradeConstraintInsufficientItems,
        ],
      },
      rebalanceEvents,
      equityCurve,
      candidates: tradable.map((candidate) => ({
        symbol: candidate.identity.symbol,
        disposition: candidate.disposition,
        evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
      })),
    }
  }

  async runValidationRetest(inputs: DividendLowVolInput[], options: BacktestOptions = {}) {
    const backtest = this.run(inputs, options)
    const evidence = (backtest as any).validationEvidence || {}
    const formalBacktestGate = (backtest as any).formalBacktestGate || {
      ready: false,
      blockers: ['formal_backtest_gate_missing'],
    }
    const checks = {
      outOfSample: {
        status: evidence.outOfSample || 'insufficient',
        required: 'OOS return positive and excess return positive.',
        diagnostics: evidence.diagnostics || {},
      },
      walkForward: {
        status: evidence.walkForward || 'insufficient',
        required: 'At least two effective walk-forward windows pass.',
        diagnostics: evidence.diagnostics || {},
      },
      parameterSensitivity: {
        status: evidence.parameterSensitivity || 'insufficient',
        required: 'Candidate score dispersion and neighbor stability must be acceptable.',
        diagnostics: evidence.diagnostics || {},
      },
      groupStability: {
        status: evidence.groupStability || 'insufficient',
        required: 'At least two industry/regime/liquidity groups have enough samples.',
        diagnostics: evidence.diagnostics || {},
      },
      totalReturnBacktest: {
        status: formalBacktestGate.ready ? 'passed' : 'insufficient',
        required: 'Official total-return benchmark, ex-dividend adjusted total-return series, limit-up/down state and suspension state must be available.',
        diagnostics: formalBacktestGate,
      },
    }
    const allPassed = Object.values(checks).every((check) => check.status === 'candidate_passed' || check.status === 'passed')
    const generatedAt = new Date().toISOString()
    const artifact = {
      schemaVersion: 'dividend.low_vol.validation_retest_artifact.v1',
      generatedAt,
      validationRunMode: options.validationRunMode || 'unspecified',
      validationInputSource: options.validationInputSource || 'unspecified',
      strategyFamily: dividendLowVolStrategyService.strategyFamily,
      strategyId: dividendLowVolStrategyService.strategyId,
      status: allPassed ? 'candidate_ready_for_manual_validation_review' : 'insufficient',
      validationEvidenceMatrix: {
        schemaVersion: 'dividend.low_vol.validation_evidence_matrix.v1',
        status: allPassed ? 'candidate_passed' : 'insufficient',
        checks,
      },
      validationDecision: {
        usableForTradingAdvice: false,
        allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
        primaryBlocker: allPassed ? 'formal_trade_gate_still_requires_manual_review' : 'dividend_low_vol_validation_insufficient',
        note: 'Dividend-low-vol retest artifact is strategy-specific research validation. It does not by itself unlock formal ADD / REDUCE.',
      },
      backtest,
    }
    const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/gpt-audit')
    await mkdir(packageDir, { recursive: true })
    const mode = (options.validationRunMode || '').replace(/[^a-z0-9_-]/gi, '-').replace(/^-+|-+$/g, '')
    const fileName = `dividend-low-vol-validation-retest-${mode ? `${mode}-` : ''}${generatedAt.replace(/[:.]/g, '-')}.json`
    const path = resolve(packageDir, fileName)
    await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    return {
      ...artifact,
      artifactRef: {
        path,
        fileName,
      },
    }
  }

  private isResearchTradable(candidate: DividendLowVolFactSet, mode: BacktestOptions['researchEligibilityMode']) {
    if (mode !== 'expanded_observation') return !['avoid', 'data_insufficient'].includes(candidate.disposition)
    const fatalReasons = new Set([
      'asset_identity_missing',
      'unsupported_asset_type',
      'security_status_st_or_risk',
      'security_suspended',
      'security_delisted',
      'listing_age_less_than_3y',
      'dividend_yield_missing_or_zero',
      'no_cash_dividend_confirmed',
      'payout_ratio_negative',
      'payout_ratio_extreme_high',
      'dividend_trap_risk',
      'special_dividend_suspected',
    ])
    if (candidate.blockedReasons.some((reason) => fatalReasons.has(reason))) return false
    if ((candidate.dividend.ttmDividendYield || 0) < 3.5) return false
    if ((candidate.scores.leaderScore || 0) < 65) return false
    if ((candidate.scores.lowVolScore || 0) < 45) return false
    if ((candidate.scores.evidenceQualityScore || 0) < 60) return false
    return candidate.metricCompleteness?.displayReady === true
  }

  private benchmarkReturn(
    paths: Array<Array<{ close: number }>>,
    minLength: number,
    options: BacktestOptions,
  ) {
    const series = (options.benchmarkSeries || []).filter((point) => Number.isFinite(point.value) && point.value > 0)
    if (series.length >= Math.min(minLength, 60)) {
      const start = series[0].value
      const end = series[Math.min(series.length, minLength) - 1]?.value || series.at(-1)?.value || start
      return {
        returnPercent: (end / start - 1) * 100,
        status: 'free_source_total_return',
        name: options.benchmarkName || 'Free-source total-return benchmark',
        source: options.benchmarkSource || 'free_source',
        evidenceRefs: series.map((point) => point.evidenceRef).filter((ref): ref is string => Boolean(ref)).slice(0, 20),
      }
    }
    if (paths.length === 0 || minLength <= 1) {
      return {
        returnPercent: 0,
        status: 'proxy',
        name: 'CSI Dividend Low Volatility Index H30269',
        source: 'missing_candidate_paths_proxy',
        evidenceRefs: [],
      }
    }
    const returns = paths.map((path) => (path[minLength - 1].close / path[0].close - 1) * 100)
    return {
      returnPercent: returns.reduce((sum, value) => sum + value, 0) / returns.length,
      status: 'proxy',
      name: 'CSI Dividend Low Volatility Index H30269',
      source: 'equal_weight_research_candidate_basket_proxy',
      evidenceRefs: [],
    }
  }

  private assessTradeConstraints(
    paths: Array<Array<{
      isTradable?: boolean
      tradabilityStatus?: string
      isSuspended?: boolean
      limitUp?: number
      limitDown?: number
      tradeabilityEvidenceRef?: string
    }>>,
    tradable: DividendLowVolFactSet[],
  ) {
    const rows = paths.flat()
    const rowCount = rows.length
    const limitRows = rows.filter((row) => Number.isFinite(row.limitUp) && Number.isFinite(row.limitDown)).length
    const suspensionRows = rows.filter((row) => typeof row.isSuspended === 'boolean' || row.tradabilityStatus === 'suspended').length
    const tradabilityRows = rows.filter((row) => typeof row.isTradable === 'boolean' || typeof row.tradabilityStatus === 'string').length
    const evidencedTradeabilityRows = rows.filter((row) => row.tradeabilityEvidenceRef).length
    const formalTradeabilityRows = rows.filter((row) => isFormalTradeabilityEvidence(row.tradeabilityEvidenceRef)).length
    const freeSourceTradeabilityRows = rows.filter((row) => isFreeSourceTradeabilityEvidence(row.tradeabilityEvidenceRef)).length
    const barDerivedLimitRows = rows.filter((row) => row.tradeabilityEvidenceRef?.includes('bar-derived-limit')).length
    const limitCoveragePercent = safePercent(limitRows, rowCount)
    const suspensionCoveragePercent = safePercent(suspensionRows, rowCount)
    const tradabilityCoveragePercent = safePercent(tradabilityRows, rowCount)
    const evidencedTradeabilityCoveragePercent = safePercent(evidencedTradeabilityRows, rowCount)
    const formalTradeabilityCoveragePercent = safePercent(formalTradeabilityRows, rowCount)
    const freeSourceTradeabilityCoveragePercent = safePercent(freeSourceTradeabilityRows, rowCount)
    const barDerivedLimitCoveragePercent = safePercent(barDerivedLimitRows, rowCount)
    const dividendRecordCount = tradable.reduce((sum, candidate) => sum + candidate.dividend.cashDividendPerShareHistory.length, 0)
    const dividendRecordsWithDates = tradable.reduce((sum, candidate) => sum + candidate.dividend.cashDividendPerShareHistory
      .filter((record) => record.exDividendDate && record.payoutDate)
      .length, 0)
    const dividendDateCoveragePercent = safePercent(dividendRecordsWithDates, dividendRecordCount)
    const limitUpDownDailyStateReady = limitCoveragePercent >= 80 && evidencedTradeabilityCoveragePercent >= 80
    const suspensionDailyStateReady = suspensionCoveragePercent >= 80 && tradabilityCoveragePercent >= 80 && evidencedTradeabilityCoveragePercent >= 80
    const tradeabilityDataQuality = formalTradeabilityCoveragePercent >= 80
      ? 'formal_provider'
      : freeSourceTradeabilityCoveragePercent >= 80 || barDerivedLimitCoveragePercent >= 80
        ? 'free_source_research'
        : evidencedTradeabilityCoveragePercent >= 80
          ? 'evidenced_unknown_source'
          : 'insufficient'
    return {
      limitUpDownDailyStateReady,
      suspensionDailyStateReady,
      exDividendAdjustedTotalReturnSeriesReady: dividendDateCoveragePercent >= 80,
      coverage: {
        rowCount,
        limitRows,
        suspensionRows,
        tradabilityRows,
        evidencedTradeabilityRows,
        formalTradeabilityRows,
        freeSourceTradeabilityRows,
        barDerivedLimitRows,
        limitCoveragePercent,
        suspensionCoveragePercent,
        tradabilityCoveragePercent,
        evidencedTradeabilityCoveragePercent,
        formalTradeabilityCoveragePercent,
        freeSourceTradeabilityCoveragePercent,
        barDerivedLimitCoveragePercent,
        dividendRecordCount,
        dividendRecordsWithDates,
        dividendDateCoveragePercent,
        thresholds: {
          limitUpDownDailyStateReadyPercent: 80,
          suspensionDailyStateReadyPercent: 80,
          evidenceRequiredPercent: 80,
          dividendDateCoverageRequiredPercent: 80,
        },
        sourceQuality: {
          tradeabilityDataQuality,
          formalProviderReady: formalTradeabilityCoveragePercent >= 80,
          freeSourceResearchReady: tradeabilityDataQuality === 'free_source_research',
          barDerivedLimitApplied: barDerivedLimitRows > 0,
        },
      },
      evidenceRefs: [
        ...rows.map((row) => row.tradeabilityEvidenceRef).filter((ref): ref is string => Boolean(ref)).slice(0, 20),
        ...tradable.flatMap((candidate) => candidate.dividend.cashDividendPerShareHistory.map((record) => record.evidenceRef)).slice(0, 20),
      ],
    }
  }

  private buildValidationEvidence(params: {
    equityCurve: Array<{ value: number }>
    tradable: DividendLowVolFactSet[]
    paths: Array<Array<{ close: number }>>
    minLength: number
    excessReturnPercent: number
  }) {
    const { equityCurve, tradable, paths, minLength, excessReturnPercent } = params
    const values = equityCurve.map((point) => point.value)
    const split = Math.floor(values.length * 0.7)
    const trainReturn = values.length > 1 && split > 1 ? (values[split - 1] / values[0] - 1) * 100 : undefined
    const oosReturn = values.length > split + 1 ? ((values.at(-1) || values[split]) / values[split] - 1) * 100 : undefined
    const oos = oosReturn !== undefined && oosReturn > 0 && excessReturnPercent > 0 ? 'candidate_passed' : oosReturn === undefined ? 'insufficient' : 'failed'
    const windowSize = Math.max(20, Math.floor(minLength / 3))
    const windows = [
      values.slice(0, windowSize),
      values.slice(windowSize, windowSize * 2),
      values.slice(windowSize * 2, windowSize * 3),
    ].filter((window) => window.length >= 20)
    const passedWindows = windows.filter((window) => (window.at(-1) || 0) > window[0]).length
    const walkForward = windows.length >= 2 && passedWindows >= 2 ? 'candidate_passed' : windows.length < 2 ? 'insufficient' : 'failed'
    const scoreDispersion = this.stddev(tradable.map((candidate) => candidate.scores.evidenceAdjustedScore))
    const parameterSensitivity = tradable.length >= 3 && scoreDispersion <= 25 ? 'candidate_passed' : tradable.length < 3 ? 'insufficient' : 'failed'
    const industries = new Set(tradable.map((candidate) => candidate.identity.industry || 'UNKNOWN'))
    const groupStability = industries.size >= 2 && paths.length >= 3 ? 'candidate_passed' : 'insufficient'
    const allCandidatePassed = [oos, walkForward, parameterSensitivity, groupStability].every((status) => status === 'candidate_passed')
    return {
      status: allCandidatePassed ? 'candidate_ready_for_formal_validation' : (paths.length >= 3 && minLength >= 120 ? 'candidate_ready_for_validation' : 'insufficient'),
      outOfSample: oos,
      walkForward,
      parameterSensitivity,
      groupStability,
      diagnostics: {
        trainReturnPercent: trainReturn === undefined ? null : round(trainReturn, 2),
        outOfSampleReturnPercent: oosReturn === undefined ? null : round(oosReturn, 2),
        walkForwardWindows: windows.length,
        walkForwardPassedWindows: passedWindows,
        scoreDispersion: round(scoreDispersion, 2),
        industryGroupCount: industries.size,
      },
    }
  }

  private stddev(values: number[]) {
    if (values.length === 0) return 0
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length
    const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length
    return Math.sqrt(variance)
  }

  private insufficient(pool: ReturnType<typeof dividendLowVolStrategyService.buildCandidatePool>, reason: string) {
    return {
      schemaVersion: 'dividend.low_vol.backtest_result.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: dividendLowVolStrategyService.strategyFamily,
      strategyId: dividendLowVolStrategyService.strategyId,
      status: 'insufficient',
      reason,
      sample: {
        inputCount: pool.total,
        candidateCount: pool.total,
        researchEligibleCount: pool.eligibleResearchCandidates,
        effectivePathCount: 0,
        tradingDays: 0,
      },
      validationEvidence: {
        status: 'insufficient',
        outOfSample: 'insufficient',
        walkForward: 'insufficient',
        parameterSensitivity: 'insufficient',
        groupStability: 'insufficient',
        reason,
      },
      policy: pool.policy,
      equityCurve: [],
      candidates: [],
    }
  }
}

export const dividendLowVolBacktestService = new DividendLowVolBacktestService()
