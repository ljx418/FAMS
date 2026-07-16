import assert from 'node:assert/strict'
import {
  assertTradeBoundaryLocked,
  baseAudit,
  checkedAtIso,
  createNextStageAuditDir,
  runNextStagePortfolioBacktest,
  writeAuditJson,
} from './lib/nextStagePortfolioBacktestScenario.js'

async function main() {
  const checkedAt = checkedAtIso()
  const auditDir = await createNextStageAuditDir(checkedAt)
  const result = await runNextStagePortfolioBacktest()
  assertTradeBoundaryLocked(result)

  const releaseGateAudit = result.releaseGateAudit
  assert.ok(releaseGateAudit, 'releaseGateAudit missing')
  assert.equal(releaseGateAudit.status, 'blocked', 'release gate must remain blocked until human approval and production readiness')
  assert.equal(releaseGateAudit.notTradingAdvice, true)
  assert.equal(releaseGateAudit.formalTradingUnlocked, false)
  assert.equal(releaseGateAudit.autoTradeUnlocked, false)
  assert.equal(releaseGateAudit.canCreateOrder, false)
  assert.equal(releaseGateAudit.orderCreateAllowed, false)

  for (const id of [
    'field_level_data_governance',
    'official_or_cross_checked_benchmark',
    'formal_validation',
    'execution_isolation',
    'manual_human_signoff',
    'production_order_adapter',
    'auto_trade_policy',
  ]) {
    assert.ok(releaseGateAudit.checks.some((check: any) => check.id === id), `release gate check missing: ${id}`)
  }

  assert.ok(
    releaseGateAudit.blockers.includes('human_reviewer_confirmation_not_completed')
      || releaseGateAudit.blockers.includes('production_order_adapter_not_enabled'),
    'release gate should expose human or production adapter blockers',
  )

  const audit = {
    ...baseAudit('fams.next_stage.release_gate_acceptance.v1', checkedAt),
    status: 'contract_passed_release_blocked',
    releaseGateAudit,
    upstreamStatuses: {
      dataGovernance: result.dataGovernanceAudit?.status || 'missing',
      benchmarkQualification: result.benchmarkQualificationAudit?.status || 'missing',
      formalValidation: result.formalValidationAudit?.status || 'missing',
      manualSignoff: result.manualSignoffAudit?.status || 'missing',
      executionIsolation: result.executionIsolationAudit?.status || 'missing',
    },
    conclusion: {
      releaseGateImplemented: true,
      blockerHandlingIsExplicit: true,
      formalValidationPassedDoesNotUnlockTrading: true,
      releaseApprovalStatus: 'pending',
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }

  const path = await writeAuditJson(auditDir, '14_release_gate_audit.json', audit)
  console.log(JSON.stringify({ ...audit, auditPath: path }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
