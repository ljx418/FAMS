import type {
  PortfolioBacktestRequest,
  PortfolioBacktestStrategyResult,
  PortfolioBenchmarkQualificationAudit,
  PortfolioFormalValidationAudit,
  PortfolioModelEffectivenessStatus,
} from '../portfolio-backtest/portfolioBacktestTypes.js'
import { sha256Canonical } from './formalReleaseHash.js'
import type { FormalValidationProfileSet } from './formalValidationProfileService.js'

export interface ReleaseCandidateMetricEvidence {
  strategyId: string
  strategyVersion: string
  releaseEffectivePathCount: number
  industryGroupCount: number
  marketRegimeGroupCount?: number
  liquidityGroupCount?: number
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
    validationProfileSet?: FormalValidationProfileSet
  }): PortfolioFormalValidationAudit {
    if (input.validationProfileSet) return this.evaluateProfileAware({
      candidateSet: input.candidateSet,
      metrics: input.metrics,
      validationProfileSet: input.validationProfileSet,
    })
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

  private evaluateProfileAware(input: {
    candidateSet: ReturnType<FormalValidationService['freezeCandidateSet']>
    metrics: ReleaseCandidateMetricEvidence[]
    validationProfileSet: FormalValidationProfileSet
  }): PortfolioFormalValidationAudit {
    const assignments = input.validationProfileSet.candidateAssignments
    const candidateIds = input.candidateSet.releaseCandidateStrategyIds
    if (assignments.length !== candidateIds.length
      || assignments.some((assignment, index) => assignment.candidateId !== candidateIds[index])) {
      throw new Error('formal_validation_profile_candidate_inventory_mismatch')
    }
    const metricsById = new Map(input.metrics.map((item) => [item.strategyId, item]))
    const checks = assignments.map((assignment) => {
      const metric = metricsById.get(assignment.candidateId)
      const commonBlockers: string[] = []
      if (!metric) commonBlockers.push('release_candidate_result_missing')
      if (metric && metric.strategyVersion !== assignment.candidateVersion) commonBlockers.push('release_candidate_version_mismatch')

      if (!assignment.formalGateApplicable) {
        const evidenceRefs = metric?.evidenceRefs || []
        return {
          strategyId: assignment.candidateId,
          strategyVersion: assignment.candidateVersion,
          candidateRole: assignment.candidateRole,
          validationProfileId: assignment.validationProfileId,
          formalGateApplicable: false,
          formalGateStatus: 'not_applicable' as const,
          status: commonBlockers.length > 0 ? 'insufficient' as const : 'warning' as const,
          oosStatus: metric?.oosStatus || 'insufficient' as const,
          walkForwardStatus: metric && metric.walkForwardWindows > 0 ? metric.oosStatus : 'insufficient' as const,
          parameterSensitivityStatus: metric?.parameterSensitivityStatus || 'insufficient' as const,
          groupStabilityStatus: metric?.groupStabilityStatus || 'not_applicable' as const,
          releaseEffectivePathCount: metric?.releaseEffectivePathCount || 0,
          industryGroupCount: metric?.industryGroupCount || 0,
          marketRegimeGroupCount: metric?.marketRegimeGroupCount || 0,
          liquidityGroupCount: metric?.liquidityGroupCount || 0,
          blockers: Array.from(new Set([...commonBlockers, ...(metric?.failureTaxonomy || [])])),
          evidenceRefs,
        }
      }

      const blockers = [...commonBlockers]
      if (assignment.validationProfileId !== 'equity_selection_release_v1') blockers.push('unsupported_product_validation_profile')
      if (!assignment.benchmarkId) blockers.push('product_candidate_benchmark_missing')
      if (!metric || metric.releaseEffectivePathCount < 30) blockers.push('release_effective_path_count_below_30')
      if (!metric || metric.industryGroupCount < 3) blockers.push('industry_group_count_below_3')
      if (!metric || (metric.marketRegimeGroupCount || 0) < 3) blockers.push('market_regime_group_count_below_3')
      if (!metric || (metric.liquidityGroupCount || 0) < 3) blockers.push('liquidity_group_count_below_3')
      if (!metric || metric.walkForwardWindows < 6) blockers.push('walk_forward_windows_below_6')
      if (!metric || metric.walkForwardPassedRatio === null || metric.walkForwardPassedRatio < 0.6) blockers.push('walk_forward_passed_ratio_below_0_6')
      if (!metric || metric.oosStatus !== 'passed') blockers.push(`oos_${metric?.oosStatus || 'insufficient'}`)
      if (!metric || metric.parameterSensitivityStatus !== 'passed') blockers.push(`parameter_sensitivity_${metric?.parameterSensitivityStatus || 'insufficient'}`)
      if (!metric || metric.groupStabilityStatus !== 'passed') blockers.push(`group_stability_${metric?.groupStabilityStatus || 'insufficient'}`)
      if (!metric?.tradeConstraintsComplete) blockers.push('trade_constraints_incomplete')
      if (!metric || !['official_total_return', 'trusted_total_return'].includes(metric.benchmarkStatus)) blockers.push('release_benchmark_not_official_or_trusted_total_return')
      if (!metric?.benchmarkQualificationPassed) blockers.push('benchmark_qualification_not_passed')
      blockers.push(...(metric?.failureTaxonomy || []))
      const uniqueBlockers = Array.from(new Set(blockers))
      const status: PortfolioModelEffectivenessStatus = uniqueBlockers.length === 0
        ? 'passed'
        : uniqueBlockers.some((blocker) => blocker.includes('failed')) ? 'failed' : 'insufficient'
      return {
        strategyId: assignment.candidateId,
        strategyVersion: assignment.candidateVersion,
        candidateRole: assignment.candidateRole,
        validationProfileId: assignment.validationProfileId,
        formalGateApplicable: true,
        formalGateStatus: status,
        status,
        oosStatus: metric?.oosStatus || 'insufficient' as const,
        walkForwardStatus: metric && metric.walkForwardWindows >= 6 && (metric.walkForwardPassedRatio ?? 0) >= 0.6 ? 'passed' as const : 'insufficient' as const,
        parameterSensitivityStatus: metric?.parameterSensitivityStatus || 'insufficient' as const,
        groupStabilityStatus: metric?.groupStabilityStatus || 'insufficient' as const,
        releaseEffectivePathCount: metric?.releaseEffectivePathCount || 0,
        industryGroupCount: metric?.industryGroupCount || 0,
        marketRegimeGroupCount: metric?.marketRegimeGroupCount || 0,
        liquidityGroupCount: metric?.liquidityGroupCount || 0,
        blockers: uniqueBlockers,
        evidenceRefs: metric?.evidenceRefs || [],
      }
    })
    const applicableChecks = checks.filter((check) => check.formalGateApplicable)
    if (applicableChecks.length === 0) throw new Error('formal_validation_product_candidate_missing')
    const passedStrategies = applicableChecks.filter((check) => check.formalGateStatus === 'passed').length
    const failedStrategies = applicableChecks.filter((check) => check.formalGateStatus === 'failed').length
    const insufficientStrategies = applicableChecks.filter((check) => check.formalGateStatus === 'insufficient').length
    const allReleaseCandidatesPassed = passedStrategies === applicableChecks.length
    const status: PortfolioModelEffectivenessStatus = failedStrategies > 0
      ? 'failed'
      : insufficientStrategies > 0 ? 'insufficient' : 'passed'
    const applicableBlockers = Array.from(new Set(applicableChecks.flatMap((check) => check.blockers)))
    const warningStrategies = checks.filter((check) => !check.formalGateApplicable).length
    const minApplicable = (field: 'industryGroupCount' | 'marketRegimeGroupCount' | 'liquidityGroupCount') => Math.min(...applicableChecks.map((check) => check[field]))
    return {
      schemaVersion: 'portfolio.formal_validation_audit.v1',
      stageId: 'FTR-3',
      status,
      formalTradingEligible: allReleaseCandidatesPassed,
      formalValidationPassed: allReleaseCandidatesPassed,
      allReleaseCandidatesPassed,
      releaseCandidateSet: input.candidateSet,
      validationProfileSet: input.validationProfileSet as unknown as Record<string, unknown>,
      releaseEffectivePathCount: applicableChecks.reduce((sum, check) => sum + check.releaseEffectivePathCount, 0),
      industryGroupCount: minApplicable('industryGroupCount'),
      marketRegimeGroupCount: minApplicable('marketRegimeGroupCount'),
      liquidityGroupCount: minApplicable('liquidityGroupCount'),
      strategyCount: checks.length,
      productReleaseCandidateCount: applicableChecks.length,
      passedStrategies,
      warningStrategies,
      insufficientStrategies,
      failedStrategies,
      notApplicableStrategies: warningStrategies,
      checks,
      blockers: applicableBlockers,
      warnings: [
        ...(allReleaseCandidatesPassed ? [] : ['formal_validation_not_all_product_release_candidates_passed']),
        ...checks.filter((check) => !check.formalGateApplicable).map((check) => `formal_gate_not_applicable:${check.strategyId}`),
        'formal_validation_passed_does_not_unlock_trading',
      ],
      humanAcceptanceStatus: 'pending_batch_review',
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      notTradingAdvice: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
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
