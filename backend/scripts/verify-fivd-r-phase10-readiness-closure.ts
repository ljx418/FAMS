import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function runReadiness(args: string[]) {
  const result = spawnSync(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-production-readiness.ts', ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
  const stdout = result.stdout.trim()
  const jsonStart = stdout.indexOf('{')
  assert(jsonStart >= 0, `readiness output did not include JSON: ${stdout || result.stderr}`)
  const payload = JSON.parse(stdout.slice(jsonStart))
  return {
    exitCode: result.status ?? 0,
    payload,
    stderr: result.stderr.trim(),
  }
}

async function main() {
  const verificationDir = path.resolve(process.cwd(), '..', '.verification')
  await fs.mkdir(verificationDir, { recursive: true })

  const production = runReadiness(['--strict'])
  const trade = runReadiness(['--strict-trade'])
  const tradeReadiness = trade.payload.tradeActionReadiness
  const blockerGateIds = tradeReadiness?.blockerGateIds || []
  const allowedManualModes = tradeReadiness?.readyForManualTradeDraft === true
    ? ['MANUAL_REVIEW', 'PAPER_TRADE']
    : []
  const report = {
    schemaVersion: 'fivd.r.phase10.readiness_closure.v1',
    generatedAt: new Date().toISOString(),
    production: {
      exitCode: production.exitCode,
      analysisAdviceReady: production.payload.analysisAdviceReady,
      productionReady: production.payload.productionReady,
      tradeActionReady: production.payload.tradeActionReady,
      strict: production.payload.strict,
    },
    tradeAction: {
      exitCode: trade.exitCode,
      status: tradeReadiness?.status,
      readyForManualTradeDraft: tradeReadiness?.readyForManualTradeDraft,
      blockerGateIds,
      latestEvidence: tradeReadiness?.latestEvidence || null,
      allowedManualModes,
      autoTradeAllowed: false,
    },
    closureDecision: {
      status: tradeReadiness?.readyForManualTradeDraft === true ? 'ready_for_manual_review_only' : 'blocked',
      reasons: blockerGateIds.length ? blockerGateIds : ['manual_execution_review_required'],
      prohibitedActions: ['AUTO_TRADE', 'FORMAL_ADD_WITHOUT_MANUAL_REVIEW', 'FORMAL_REDUCE_WITHOUT_MANUAL_REVIEW'],
    },
  }

  assert(production.exitCode === 0, 'production readiness strict must pass')
  assert(report.production.analysisAdviceReady === true, 'analysis advice must remain ready')
  assert(report.production.productionReady === true, 'production readiness must remain true')
  assert(report.tradeAction.autoTradeAllowed === false, 'auto trade must remain disabled')
  if (blockerGateIds.includes('validation_evidence')) {
    assert(trade.exitCode !== 0, 'strict trade readiness should fail while validation_evidence blocks')
    assert(report.closureDecision.status === 'blocked', 'closure must remain blocked while validation_evidence blocks')
    assert(report.tradeAction.readyForManualTradeDraft === false, 'manual trade draft must not be ready while validation_evidence blocks')
  } else {
    assert(report.tradeAction.allowedManualModes.includes('MANUAL_REVIEW'), 'manual review mode must be explicit when ready')
    assert(!report.tradeAction.allowedManualModes.includes('AUTO_TRADE'), 'AUTO_TRADE must never be an allowed manual mode')
  }

  const auditPath = path.join(verificationDir, 'fivd-r-phase10-readiness-closure-audit.json')
  await fs.writeFile(auditPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({
    ok: true,
    auditPath,
    checked: {
      closureStatus: report.closureDecision.status,
      analysisAdviceReady: report.production.analysisAdviceReady,
      productionReady: report.production.productionReady,
      tradeActionReady: report.production.tradeActionReady,
      blockerGateIds,
      autoTradeAllowed: report.tradeAction.autoTradeAllowed,
      allowedManualModes,
    },
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
