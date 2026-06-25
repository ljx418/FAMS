import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/db/prisma.js'
import { runtimeHealthService } from '../src/services/runtime/runtimeHealthService.js'

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

function auditRoot() {
  return resolve(repoRoot(), 'backend/data/gpt-audit/dividend-low-vol')
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

async function main() {
  const runtimeHealth = await runtimeHealthService.check({
    prisma,
    includeOperations: true,
    includeProviderHealth: true,
  })
  const audit = {
    schemaVersion: 'dividend.low_vol.runtime_health_audit.v1',
    generatedAt: runtimeHealth.generatedAt,
    strategyFamily: 'dividend_low_volatility',
    strategyId: 'dividend_low_vol_leader_v1',
    status: runtimeHealth.status,
    notTradingAdvice: true,
    allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    runtimeHealth,
    decision: runtimeHealth.decision,
  }

  const dir = resolve(auditRoot(), timestamp())
  await mkdir(dir, { recursive: true })
  const path = resolve(dir, '11_runtime_health_audit.json')
  await writeFile(path, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    status: audit.status,
    path,
    sqliteHealthy: runtimeHealth.sqliteHealthy,
    strict: process.argv.includes('--strict') || process.env.FAMS_SQLITE_HEALTH_STRICT === '1',
  }, null, 2))

  if ((process.argv.includes('--strict') || process.env.FAMS_SQLITE_HEALTH_STRICT === '1') && audit.status !== 'healthy') {
    process.exitCode = 2
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
