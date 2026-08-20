import type { PortfolioExecutionIsolationAudit, PortfolioManualPlanDraft, PortfolioPaperOrderIntent } from '../portfolio-backtest/portfolioBacktestTypes.js'

export type FormalReleaseExecutionAction = 'RESEARCH' | 'OBSERVE' | 'COMPARE' | 'ALERT' | 'PLAN_DRAFT' | 'MANUAL_TRADE_DRAFT' | 'PAPER_ORDER_INTENT' | 'ADD' | 'REDUCE' | 'ORDER_CREATE' | 'AUTO_TRADE' | 'REAL_POSITION_MUTATION'

const PROHIBITED_MUTATIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE', 'REAL_POSITION_MUTATION'] as const

export class ExecutionIsolationService {
  buildAudit(runId: string, generatedAt: string, manualPlanDrafts: PortfolioManualPlanDraft[]): PortfolioExecutionIsolationAudit {
    const intents: PortfolioPaperOrderIntent[] = manualPlanDrafts.map((draft) => ({
      schemaVersion: 'portfolio.paper_order_intent.v1',
      intentId: `paper-intent:${runId}:${draft.strategyId}`,
      generatedAt,
      source: 'manual_plan_draft',
      executionMode: 'paper',
      strategyId: draft.strategyId,
      draftStatus: draft.status,
      currentWeightPercent: draft.currentWeightPercent,
      researchTargetWeightPercent: draft.researchTargetWeightPercent,
      formalTargetWeightPercent: 0,
      notionalAmount: null,
      suggestedActionTypes: draft.suggestedActionTypes,
      canCreateOrder: false,
      orderCreateAllowed: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      blockedReasons: Array.from(new Set([
        ...draft.blockedReasons,
        'production_order_adapter_not_enabled',
        'formal_trading_release_gate_not_passed',
      ])),
      evidenceRefs: draft.evidenceRefs,
      notTradingAdvice: true,
    }))
    const blockers = Array.from(new Set([
      ...(intents.length === 0 ? ['manual_plan_draft_missing'] : []),
      'production_order_adapter_not_enabled',
      'real_position_mutation_disabled',
      'formal_trading_release_gate_not_passed',
      'auto_trade_policy_locked',
    ]))
    return {
      schemaVersion: 'portfolio.execution_isolation_audit.v1',
      status: intents.length > 0 ? 'ready_for_paper_review' : 'blocked',
      mode: 'paper_sandbox_only',
      paperTradingReady: intents.length > 0,
      sandboxReady: intents.length > 0,
      productionAdapterEnabled: false,
      realPositionMutationAllowed: false,
      orderCreateAllowed: false,
      canCreateOrder: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      intents,
      blockers,
      warnings: ['paper_or_sandbox_intents_are_for_manual_review_only', 'no_real_order_or_position_mutation_is_permitted'],
      evidenceRefs: Array.from(new Set(intents.flatMap((intent) => intent.evidenceRefs))),
      notTradingAdvice: true,
    }
  }

  assertActionAllowed(action: FormalReleaseExecutionAction) {
    if ((PROHIBITED_MUTATIONS as readonly string[]).includes(action)) throw new Error(`formal_release_execution_action_blocked:${action}`)
    return { action, allowed: true as const, executionMode: action === 'PAPER_ORDER_INTENT' ? 'paper' as const : 'non_mutating' as const }
  }

  productionAdapterApprovalRecord() {
    return {
      schemaVersion: 'fams.production_adapter.approval_record.v1' as const,
      status: 'missing' as const,
      separateHighRiskApprovalRequired: true,
      approvalEndpointAvailable: false,
      productionAdapterEnabled: false as const,
      realPositionMutationAllowed: false as const,
      formalTradingUnlocked: false as const,
      autoTradeUnlocked: false as const,
      canCreateOrder: false as const,
      orderCreateAllowed: false as const,
      blockers: ['production_order_adapter_human_approval_missing', 'production_order_adapter_not_enabled'],
    }
  }
}

export const executionIsolationService = new ExecutionIsolationService()
