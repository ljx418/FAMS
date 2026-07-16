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

  const formalValidationAudit = result.formalValidationAudit
  assert.ok(formalValidationAudit, 'formalValidationAudit missing')
  assert.equal(formalValidationAudit.notTradingAdvice, true)
  assert.ok(formalValidationAudit.strategyCount >= 6, 'formal validation should cover the next-stage strategy set')
  assert.ok(Array.isArray(formalValidationAudit.checks), 'formal validation checks missing')
  assert.equal(formalValidationAudit.checks.length, formalValidationAudit.strategyCount)

  if (formalValidationAudit.status === 'passed') {
    assert.equal(formalValidationAudit.blockers.length, 0)
    assert.equal(formalValidationAudit.formalTradingEligible, true)
  } else {
    assert.ok(formalValidationAudit.blockers.length > 0, 'non-passed formal validation must expose blockers')
    assert.equal(formalValidationAudit.formalTradingEligible, false)
  }

  const failureTaxonomy = {
    ...baseAudit('fams.validation_failure_taxonomy.v1', checkedAt),
    status: formalValidationAudit.status,
    blockers: formalValidationAudit.blockers,
    checks: formalValidationAudit.checks.map((check: any) => ({
      strategyId: check.strategyId,
      status: check.status,
      oosStatus: check.oosStatus,
      walkForwardStatus: check.walkForwardStatus,
      parameterSensitivityStatus: check.parameterSensitivityStatus,
      groupStabilityStatus: check.groupStabilityStatus,
      blockers: check.blockers,
    })),
  }

  const modelEffectivenessAudit = {
    ...baseAudit('fams.model_effectiveness_audit.v1', checkedAt),
    status: result.modelEffectiveness?.status || 'missing',
    modelEffectiveness: result.modelEffectiveness,
    formalValidationAudit,
  }

  const audit = {
    ...baseAudit('fams.next_stage.formal_validation_acceptance.v1', checkedAt),
    status: 'contract_passed',
    formalValidationAudit,
    failureTaxonomy,
    modelEffectivenessAudit,
    conclusion: {
      validationComputedFromRealBacktest: true,
      insufficientOrFailedStatesRemainExplicit: formalValidationAudit.status !== 'passed',
      formalValidationPassed: formalValidationAudit.status === 'passed',
      releaseApprovalStatus: 'pending',
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }

  const paths = {
    formalValidationAudit: await writeAuditJson(auditDir, '17_formal_validation_audit.json', audit),
    failureTaxonomy: await writeAuditJson(auditDir, 'validation_failure_taxonomy.json', failureTaxonomy),
    modelEffectivenessAudit: await writeAuditJson(auditDir, 'model_effectiveness_audit.json', modelEffectivenessAudit),
  }
  console.log(JSON.stringify({ ...audit, auditPaths: paths }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
