import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function main() {
  const { stdout } = await execFileAsync('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/check-sqlite-health.ts'], { timeout: 120000 })
  const result = JSON.parse(stdout)
  assert.equal(result.ok, true)
  assert.ok(result.path.endsWith('11_runtime_health_audit.json'))
  const audit = JSON.parse(await readFile(result.path, 'utf8'))
  assert.equal(audit.schemaVersion, 'dividend.low_vol.runtime_health_audit.v1')
  assert.ok(['healthy', 'critical'].includes(audit.status))
  assert.equal(typeof audit.decision.largeDividendLowVolScanAllowed, 'boolean')
  if (audit.status !== 'healthy') {
    assert.equal(audit.decision.largeDividendLowVolScanAllowed, false)
    assert.equal(audit.decision.largeBacktestPersistenceAllowed, false)
    assert.ok(audit.decision.requiredFollowup.length > 0)
  }
  console.log(JSON.stringify({
    ok: true,
    status: audit.status,
    integrityMethod: audit.runtimeHealth.integrityCheck.method || audit.runtimeHealth.integrityCheck.reason,
    largeScanAllowed: audit.decision.largeDividendLowVolScanAllowed,
    path: result.path,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
