import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

async function runStrictTrade() {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolveResult, reject) => {
    const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'scripts/verify-production-readiness.ts', '--strict-trade'], { cwd: process.cwd(), env: process.env })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.on('error', reject)
    child.on('close', (code) => resolveResult({ code, stdout, stderr }))
  })
}

async function latestGate() {
  const root = resolve(process.cwd(), 'data/gpt-audit/formal-release-readiness/FTR-6')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    try {
      return JSON.parse(await readFile(resolve(root, name, '14_release_gate_audit.json'), 'utf8'))
    } catch {
      // Ignore incomplete runs.
    }
  }
  throw new Error('ftr6_release_gate_not_found')
}

async function main() {
  const result = await runStrictTrade()
  assert.equal(result.code, 1, `strict trade command must remain blocked; stderr=${result.stderr}`)
  const jsonStart = result.stdout.indexOf('{')
  assert.ok(jsonStart >= 0, 'strict trade output JSON missing')
  const readiness = JSON.parse(result.stdout.slice(jsonStart))
  const gate = await latestGate()
  assert.equal(readiness.strictTrade, true)
  assert.equal(readiness.tradeActionReady, false)
  assert.equal(readiness.formalTradingReleaseReady, false)
  assert.equal(gate.status, 'blocked')
  for (const object of [readiness, gate]) {
    for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(object[field], false)
  }
  console.log(JSON.stringify({
    schemaVersion: 'fams.formal_release.strict_trade_expected_block_verification.v1',
    status: 'passed_expected_block',
    underlyingExitCode: result.code,
    strictTrade: true,
    tradeActionReady: false,
    releaseGateStatus: 'blocked',
    formalTradingReleaseReady: false,
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
