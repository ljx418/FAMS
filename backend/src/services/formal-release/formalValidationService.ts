import type {
  PortfolioBacktestRequest,
  PortfolioBacktestStrategyResult,
  PortfolioBenchmarkQualificationAudit,
  PortfolioFormalValidationAudit,
  PortfolioModelEffectivenessStatus,
} from '../portfolio-backtest/portfolioBacktestTypes.js'
import { sha256Canonical } from './formalReleaseHash.js'

export interface ReleaseCandidateMetricEvidence {
  strategyId: string
  strategyVersion: string
  releaseEffectivePathCount: number
  industryGroupCount: number
  walkForwardWindows: number
  walkForwardPassedRatio: number | null
  oosStatus: PortfolioModelEffectivenessStatus
  parameterSensitivityStatus: PortfolioModelEffectivenessStatus
  groupStabilityStatus: PortfolioModelEffectivenessStatus | 'not_applicable'
  tradeConstraintsComplete: boolean
  benchmarkStatus: 'official_total_return' | 'trusted_total_return' | 'free_source_total_return' | 'price_index' | 'research_proxy' | 'unavailable'
  benchmarkQualificationPassed: boolean
  evidenceRefs: string[]
  failureTaxonomy: string[]
}

export class FormalValidationService {
  freezeCandidateSet(input: {
    releaseCandidateStrategyIds: string[]
    releaseCandidateStrategyVersions: Record<string, string>
    excludedStrategies: Array<{ strategyId: string; reason: string }>
  }) {
    const ids = Array.from(new Set(input.releaseCandidateStrategyIds.map((item) => item.trim()).filter(Boolean)))
    if (ids.length === 0) throw new Error('release_candidate_set_empty')
    const versions = Object.fromEntries(ids.map((id) => {
      const version = input.releaseCandidateStrategyVersions[id]?.trim()
      if (!version) throw new Error(`release_candidate_version_missing:${id}`)
      return [id, version]
    }))
    const excludedStrategies = input.excludedStrategies.map((item) => ({
      strategyId: item.strategyId.trim(),
      reason: item.reason.trim(),
    }))
    if (excludedStrategies.some((item) => !item.strategyId || !item.reason)) throw new Error('excluded_strategy_reason_required')
    if (new Set(excludedStrategies.map((item) => item.strategyId)).size !== excludedStrategies.length) throw new Error('excluded_strategy_duplicate')
    if (excludedStrategies.some((item) => ids.includes(item.strategyId))) throw new Error('release_candidate_cannot_be_excluded')
    const core = {
      releaseCandidateStrategyIds: ids,
      releaseCandidateStrategyVersions: versions,
      excludedStrategies,
    }
    return {
      schemaVersion: 'fams.release_candidate_set.v1' as const,
      ...core,
      candidateSetHash: sha256Canonical(core),
      frozen: true as const,
    }
  }

  evaluate(input: {
    candidateSet: ReturnType<FormalValidationService['freezeCandidateSet']>
    metrics: ReleaseCandidateMetricEvidence[]
  }): PortfolioFormalValidationAudit {
    const metricsById = new Map(input.metrics.map((item) => [item.strategyId, item]))
    const checks = input.candidateSet.releaseCandidateStrategyIds.map((strategyId) => {
      const expectedVersion = input.candidateSet.releaseCandidateStrategyVersions[strategyId]
      const metric = metricsById.get(strategyId)
      const blockers: string[] = []
      if (!metric) blockers.push('release_candidate_result_missing')
      if (metric && metric.strategyVersion !== expectedVersion) blockers.push('release_candidate_version_mismatch')
      if (!metric || metric.releaseEffectivePathCount < 30) blockers.push('release_effective_path_count_below_30')
      if (!metric || metric.industryGroupCount < 3) blockers.push('industry_group_count_below_3')
      if (!metric || metric.walkForwardWindows < 6) blockers.push('walk_forward_windows_below_6')
      if (!metric || metric.walkForwardPassedRatio === null || metric.walkForwardPassedRatio < 0.6) blockers.push('walk_forward_passed_ratio_below_0_6')
      if (!metric || metric.oosStatus !== 'passed') blockers.push(`oos_${metric?.oosStatus || 'insufficient'}`)
      if (!metric || ['insufficient', 'failed'].includes(metric.parameterSensitivityStatus)) blockers.push(`parameter_sensitivity_${metric?.parameterSensitivityStatus || 'insufficient'}`)
      if (!metric || ['insufficient', 'failed'].includes(metric.groupStabilityStatus)) blockers.push(`group_stability_${metric?.groupStabilityStatus || 'insufficient'}`)
      if (!metric?.tradeConstraintsComplete) blockers.push('trade_constraints_incomplete')
      if (!metric || !['official_total_return', 'trusted_total_return'].includes(metric.benchmarkStatus)) blockers.push('release_benchmark_not_official_or_trusted_total_return')
      if (!metric?.benchmarkQualificationPassed) blockers.push('benchmark_qualification_not_passed')
      blockers.push(...(metric?.failureTaxonomy || []))
      const uniqueBlockers = Array.from(new Set(blockers))
      const status: PortfolioModelEffectivenessStatus = uniqueBlockers.length === 0
        ? 'passed'
        : uniqueBlockers.some((blocker) => blocker.includes('failed')) ? 'failed' : 'insufficient'
      return {
        strategyId,
        strategyVersion: expectedVersion,
        status,
        oosStatus: metric?.oosStatus || 'insufficient',
        walkForwardStatus: metric && metric.walkForwardWindows >= 6 && (metric.walkForwardPassedRatio ?? 0) >= 0.6 ? 'passed' as const : 'insufficient' as const,
        parameterSensitivityStatus: metric?.parameterSensitivityStatus || 'insufficient',
        groupStabilityStatus: metric?.groupStabilityStatus || 'insufficient',
        releaseEffectivePathCount: metric?.releaseEffectivePathCount || 0,
        industryGroupCount: metric?.industryGroupCount || 0,
        blockers: uniqueBlockers,
        evidenceRefs: metric?.evidenceRefs || [],
      }
    })
    const failedStrategies = checks.filter((check) => check.status === 'failed').length
    const insufficientStrategies = checks.filter((check) => check.status === 'insufficient').length
    const warningStrategies = 0
    const passedStrategies = checks.filter((check) => check.status === 'passed').length
    const allReleaseCandidatesPassed = checks.length > 0 && passedStrategies === checks.length
    const status: PortfolioModelEffectivenessStatus = failedStrategies > 0
      ? 'failed'
      : insufficientStrategies > 0
        ? 'insufficient'
        : warningStrategies > 0
          ? 'warning'
          : 'passed'
    const blockers = Array.from(new Set(checks.flatMap((check) => check.blockers)))
    return {
      schemaVersion: 'portfolio.formal_validation_audit.v1',
      status,
      formalTradingEligible: allReleaseCandidatesPassed,
      formalValidationPassed: allReleaseCandidatesPassed,
      allReleaseCandidatesPassed,
      releaseCandidateSet: input.candidateSet,
      releaseEffectivePathCount: checks.reduce((sum, check) => sum + check.releaseEffectivePathCount, 0),
      industryGroupCount: Math.min(...checks.map((check) => check.industryGroupCount)),
      strategyCount: checks.length,
      passedStrategies,
      warningStrategies,
      insufficientStrategies,
      failedStrategies,
      checks,
      blockers,
      warnings: [
        ...(allReleaseCandidatesPassed ? [] : ['formal_validation_not_all_release_candidates_passed']),
        'formal_validation_passed_does_not_unlock_trading',
      ],
      notTradingAdvice: true,
    }
  }

  evaluatePortfolioBacktest(args: {
    request: PortfolioBacktestRequest
    strategies: PortfolioBacktestStrategyResult[]
    benchmarkQualificationAudit: PortfolioBenchmarkQualificationAudit
  }) {
    const candidateSet = this.freezeCandidateSet({
      releaseCandidateStrategyIds: args.request.releaseCandidateStrategyIds,
      releaseCandidateStrategyVersions: args.request.releaseCandidateStrategyVersions,
      excludedStrategies: args.request.excludedStrategies,
    })
    const qualifiedBenchmark = Object.values(args.benchmarkQualificationAudit.benchmarkStatuses)
      .find((status) => status === 'official_total_return' || status === 'trusted_total_return') || 'unavailable'
    const metrics = args.strategies.map((strategy): ReleaseCandidateMetricEvidence => ({
      strategyId: strategy.definition.strategyId,
      strategyVersion: strategy.definition.strategyVersion,
      releaseEffectivePathCount: 0,
      industryGroupCount: strategy.modelEffectiveness?.groupStability.groups.filter((group) => group.status === 'passed').length || 0,
      walkForwardWindows: strategy.modelEffectiveness?.walkForward.windows || 0,
      walkForwardPassedRatio: strategy.modelEffectiveness?.walkForward.passRatioPercent === null
        || strategy.modelEffectiveness?.walkForward.passRatioPercent === undefined
        ? null
        : strategy.modelEffectiveness.walkForward.passRatioPercent / 100,
      oosStatus: strategy.modelEffectiveness?.oos.status || 'insufficient',
      parameterSensitivityStatus: strategy.modelEffectiveness?.parameterSensitivityStatus || 'insufficient',
      groupStabilityStatus: strategy.modelEffectiveness?.groupStabilityStatus || 'insufficient',
      tradeConstraintsComplete: strategy.formalReviewReadiness?.tradeConstraintCoverage.status === 'passed',
      benchmarkStatus: qualifiedBenchmark,
      benchmarkQualificationPassed: args.benchmarkQualificationAudit.canSupportFormalTrading,
      evidenceRefs: strategy.modelEffectiveness?.evidenceRefs || strategy.evidenceRefs,
      failureTaxonomy: strategy.modelEffectiveness?.failureTaxonomy || ['model_effectiveness_missing'],
    }))
    return this.evaluate({ candidateSet, metrics })
  }
}

export const formalValidationService = new FormalValidationService()
