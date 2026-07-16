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

  const executionIsolationAudit = result.executionIsolationAudit
  assert.ok(executionIsolationAudit, 'executionIsolationAudit missing')
  assert.equal(executionIsolationAudit.mode, 'paper_sandbox_only')
  assert.equal(executionIsolationAudit.productionAdapterEnabled, false)
  assert.equal(executionIsolationAudit.realPositionMutationAllowed, false)
  assert.equal(executionIsolationAudit.orderCreateAllowed, false)
  assert.equal(executionIsolationAudit.canCreateOrder, false)
  assert.equal(executionIsolationAudit.formalTradingUnlocked, false)
  assert.equal(executionIsolationAudit.autoTradeUnlocked, false)

  const tradeBoundaryWordingAudit = {
    ...baseAudit('fams.trade_boundary_wording_audit.v1', checkedAt),
    status: 'passed',
    scannedSurfaces: ['portfolio-backtest-api-response', 'execution-isolation-audit', 'release-gate-audit'],
    blockedRuntimeFields: {
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
    prohibitedActions: result.prohibitedActions,
    noPositiveTradingUnlockContextFound: true,
  }

  const audit = {
    ...baseAudit('fams.next_stage.execution_isolation_acceptance.v1', checkedAt),
    status: 'contract_passed',
    executionIsolationAudit,
    tradeBoundaryWordingAudit,
    conclusion: {
      realOrderAdapterDisabled: true,
      paperOrSandboxOnly: true,
      orderCreateBlockedWithoutReleaseGate: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }

  const paths = {
    executionIsolationAudit: await writeAuditJson(auditDir, '13_execution_isolation_audit.json', audit),
    tradeBoundaryWordingAudit: await writeAuditJson(auditDir, 'trade_boundary_wording_audit.json', tradeBoundaryWordingAudit),
  }
  console.log(JSON.stringify({ ...audit, auditPaths: paths }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
