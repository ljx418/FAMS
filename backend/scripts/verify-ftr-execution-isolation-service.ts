import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ExecutionIsolationService } from '../src/services/formal-release/executionIsolationService.js'
import type { PortfolioManualPlanDraft } from '../src/services/portfolio-backtest/portfolioBacktestTypes.js'

async function main() {
  const service = new ExecutionIsolationService()
  const draft: PortfolioManualPlanDraft = {
    status: 'draft_ready',
    draftType: 'PLAN_DRAFT',
    strategyId: 'candidate-a',
    currentWeightPercent: 20,
    researchTargetWeightPercent: 25,
    formalTargetWeightPercent: 0,
    driftPercent: 5,
    suggestedActionTypes: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
    portfolioRiskCheck: 'passed',
    tradeabilityCheck: 'passed',
    priceFreshnessCheck: 'passed',
    humanReviewChecklist: ['human_review_required'],
    blockedReasons: ['formal_trading_not_unlocked'],
    evidenceRefs: ['fixture:manual-plan-draft'],
  }
  const audit = service.buildAudit('run-ftr-5-test', '2026-08-20T02:00:00.000Z', [draft])
  assert.equal(audit.status, 'ready_for_paper_review')
  assert.equal(audit.mode, 'paper_sandbox_only')
  assert.equal(audit.intents[0].executionMode, 'paper')
  assert.equal(audit.intents[0].formalTargetWeightPercent, 0)
  assert.equal(audit.productionAdapterEnabled, false)
  assert.equal(audit.realPositionMutationAllowed, false)
  assert.equal(audit.orderCreateAllowed, false)
  assert.equal(audit.canCreateOrder, false)

  for (const action of ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE', 'REAL_POSITION_MUTATION'] as const) {
    assert.throws(() => service.assertActionAllowed(action), new RegExp(action))
  }
  assert.equal(service.assertActionAllowed('PAPER_ORDER_INTENT').executionMode, 'paper')
  const approval = service.productionAdapterApprovalRecord()
  assert.equal(approval.status, 'missing')
  assert.equal(approval.approvalEndpointAvailable, false)
  assert.equal(approval.productionAdapterEnabled, false)

  const formalReleaseRoute = await readFile(resolve(process.cwd(), 'src/routes/formalRelease.ts'), 'utf8')
  assert.doesNotMatch(formalReleaseRoute, /app\.(post|put|patch)\(['"]\/.*(enable|unlock|production-adapter)/i)

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_5.execution_isolation_service_verification.v1',
    status: 'passed',
    executionIsolationAudit: audit,
    productionAdapterApprovalRecord: approval,
    prohibitedMutationActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE', 'REAL_POSITION_MUTATION'],
    productionEnableEndpointAbsent: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
