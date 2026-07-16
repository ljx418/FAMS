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

  const manualSignoffAudit = result.manualSignoffAudit
  assert.ok(manualSignoffAudit, 'manualSignoffAudit missing')
  assert.equal(manualSignoffAudit.notTradingAdvice, true)
  assert.deepEqual(manualSignoffAudit.requiredRoles, ['data', 'model', 'risk', 'compliance', 'final_release'])
  assert.equal(manualSignoffAudit.allRequiredSignedOff, false)
  assert.equal(manualSignoffAudit.canCreateOrder, false)
  assert.ok(manualSignoffAudit.records.every((record: any) => record.status === 'missing'), 'automation must not self-sign manual approval')

  const manualTradePlanDraftReview = {
    ...baseAudit('fams.manual_trade_plan_draft_review.v1', checkedAt),
    status: result.manualPlanDrafts?.length > 0 ? 'drafts_available_for_human_review' : 'no_draft_available',
    manualPlanDrafts: result.manualPlanDrafts || [],
    manualSignoffAudit,
    safetyAssertions: {
      automationSelfApprovalAllowed: false,
      formalTargetWeightPercent: 0,
      canCreateOrder: false,
      orderCreateAllowed: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    },
  }

  const audit = {
    ...baseAudit('fams.next_stage.manual_signoff_acceptance.v1', checkedAt),
    status: 'contract_passed',
    manualSignoffAudit,
    manualTradePlanDraftReview,
    conclusion: {
      manualReviewerRequired: true,
      automationSelfApprovalBlocked: true,
      formalTargetWeightPercent: 0,
      canCreateOrder: false,
      orderCreateAllowed: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    },
  }

  const paths = {
    manualSignoffAudit: await writeAuditJson(auditDir, '18_manual_signoff_audit.json', audit),
    manualTradePlanDraftReview: await writeAuditJson(auditDir, 'manual_trade_plan_draft_review.json', manualTradePlanDraftReview),
  }
  console.log(JSON.stringify({ ...audit, auditPaths: paths }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
