import type {
  PortfolioBacktestFormalReviewReadiness,
  PortfolioBacktestReadinessSummary,
  PortfolioBacktestResult,
  PortfolioBenchmarkQualificationAudit,
  PortfolioDataGradeAudit,
  PortfolioExecutionIsolationAudit,
  PortfolioFormalTradingReleaseGateAudit,
  PortfolioFormalTradingUnlockChecklist,
  PortfolioFormalValidationAudit,
  PortfolioLongHorizonDataCoverageAudit,
  PortfolioManualSignoffAudit,
  PortfolioReleaseDataGovernanceAudit,
} from '../portfolio-backtest/portfolioBacktestTypes.js'

export interface ReleaseGateInput {
  formalReviewReadiness: PortfolioBacktestFormalReviewReadiness
  dataGradeAudit: PortfolioDataGradeAudit
  modelEffectiveness: NonNullable<PortfolioBacktestResult['modelEffectiveness']>
  formalTradingUnlockChecklist: PortfolioFormalTradingUnlockChecklist
  readinessSummary: PortfolioBacktestReadinessSummary
  executionIsolationAudit: PortfolioExecutionIsolationAudit
  dataGovernanceAudit: PortfolioReleaseDataGovernanceAudit
  benchmarkQualificationAudit: PortfolioBenchmarkQualificationAudit
  formalValidationAudit: PortfolioFormalValidationAudit
  manualSignoffAudit: PortfolioManualSignoffAudit
  longHorizonDataCoverageAudit: PortfolioLongHorizonDataCoverageAudit
  runtimeHealth?: Record<string, unknown>
}

export class ReleaseGateService {
  build(args: ReleaseGateInput): PortfolioFormalTradingReleaseGateAudit {
    const runtimeStatus = typeof args.runtimeHealth?.status === 'string' ? args.runtimeHealth.status : 'unknown'
    const checks: PortfolioFormalTradingReleaseGateAudit['checks'] = [
      { id: 'runtime_health', status: runtimeStatus === 'healthy' ? 'passed' : 'requires_review', blocker: runtimeStatus === 'healthy' ? undefined : `runtime_health_not_confirmed:${runtimeStatus}`, evidenceRefs: ['runtimeHealthService.check'] },
      { id: 'formal_review_readiness', status: args.formalReviewReadiness.ready ? 'passed' : 'blocked', blocker: args.formalReviewReadiness.ready ? undefined : 'formal_review_readiness_not_passed', evidenceRefs: ['portfolioBacktest.formalReviewReadiness'] },
      { id: 'long_horizon_real_data_backtest', status: args.longHorizonDataCoverageAudit.longHorizonRealDataBacktestReady ? 'passed' : 'blocked', blocker: args.longHorizonDataCoverageAudit.longHorizonRealDataBacktestReady ? undefined : 'long_horizon_real_data_backtest_not_ready', evidenceRefs: args.longHorizonDataCoverageAudit.periods.flatMap((period) => period.evidenceRefs) },
      { id: 'data_grade', status: args.dataGradeAudit.status === 'passed' ? 'passed' : 'blocked', blocker: args.dataGradeAudit.status === 'passed' ? undefined : `data_grade_${args.dataGradeAudit.status}`, evidenceRefs: args.dataGradeAudit.items.flatMap((item) => item.evidenceRefs) },
      { id: 'field_level_data_governance', status: args.dataGovernanceAudit.status === 'passed' ? 'passed' : 'blocked', blocker: args.dataGovernanceAudit.status === 'passed' ? undefined : 'field_level_data_governance_not_passed', evidenceRefs: args.dataGovernanceAudit.items.flatMap((item) => item.evidenceRefs) },
      { id: 'official_or_cross_checked_benchmark', status: args.benchmarkQualificationAudit.canSupportFormalTrading ? 'passed' : 'blocked', blocker: args.benchmarkQualificationAudit.canSupportFormalTrading ? undefined : 'official_authorized_total_return_benchmark_not_reviewed', evidenceRefs: args.benchmarkQualificationAudit.evidenceRefs },
      { id: 'model_effectiveness', status: args.modelEffectiveness.status === 'passed' ? 'passed' : 'blocked', blocker: args.modelEffectiveness.status === 'passed' ? undefined : `model_effectiveness_${args.modelEffectiveness.status}`, evidenceRefs: ['portfolioBacktest.modelEffectiveness'] },
      { id: 'formal_validation', status: args.formalValidationAudit.status === 'passed' ? 'passed' : 'blocked', blocker: args.formalValidationAudit.status === 'passed' ? undefined : `formal_validation_${args.formalValidationAudit.status}`, evidenceRefs: args.formalValidationAudit.checks.flatMap((check) => check.evidenceRefs) },
      { id: 'execution_isolation', status: args.executionIsolationAudit.paperTradingReady && !args.executionIsolationAudit.orderCreateAllowed ? 'passed' : 'blocked', blocker: args.executionIsolationAudit.paperTradingReady ? undefined : 'paper_or_sandbox_intent_missing', evidenceRefs: args.executionIsolationAudit.evidenceRefs },
      { id: 'manual_human_signoff', status: args.manualSignoffAudit.allRequiredSignedOff ? 'passed' : 'blocked', blocker: args.manualSignoffAudit.allRequiredSignedOff ? undefined : 'human_reviewer_confirmation_not_completed', evidenceRefs: args.manualSignoffAudit.records.flatMap((record) => record.evidenceRefs) },
      { id: 'production_order_adapter', status: 'blocked', blocker: 'production_order_adapter_not_enabled', evidenceRefs: ['portfolio.execution_isolation_audit.v1'] },
      { id: 'auto_trade_policy', status: 'blocked', blocker: 'auto_trade_policy_locked', evidenceRefs: ['portfolio.backtest.trade_gate_contract.v1'] },
    ]
    const blockers = Array.from(new Set([
      ...checks.map((check) => check.blocker).filter((blocker): blocker is string => Boolean(blocker)),
      ...args.dataGovernanceAudit.blockers,
      ...args.benchmarkQualificationAudit.blockers,
      ...args.formalValidationAudit.blockers,
      ...args.manualSignoffAudit.blockers,
      ...args.longHorizonDataCoverageAudit.blockers,
      ...args.formalTradingUnlockChecklist.blockers,
      ...args.readinessSummary.blockers,
    ]))
    return {
      schemaVersion: 'portfolio.formal_trading_release_gate_audit.v1',
      status: 'blocked',
      formalTradingEligible: args.readinessSummary.formalTradingEligible,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      orderCreateAllowed: false,
      canCreateOrder: false,
      checks,
      blockers,
      warnings: ['formal_review_ready_does_not_mean_formal_trading_unlocked', 'manual_plan_drafts_must_not_create_orders'],
      notTradingAdvice: true,
    }
  }
}

export const releaseGateService = new ReleaseGateService()
