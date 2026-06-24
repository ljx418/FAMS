import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const prisma = new PrismaClient()

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

function backendRoot() {
  return resolve(repoRoot(), 'backend')
}

function auditRoot() {
  return resolve(backendRoot(), 'data/gpt-audit/dividend-low-vol')
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function resolveSqlitePath() {
  const url = process.env.DATABASE_URL || 'file:./prisma/dev.db'
  if (!url.startsWith('file:')) {
    return { databaseUrlKind: url.startsWith('postgres') ? 'postgresql' : 'unknown', path: null as string | null, raw: url }
  }
  const filePath = url.slice('file:'.length)
  const absolute = filePath.startsWith('/')
    ? filePath
    : filePath === './dev.db' || filePath === 'dev.db'
      ? resolve(backendRoot(), 'prisma/dev.db')
      : resolve(backendRoot(), filePath)
  return { databaseUrlKind: 'sqlite', path: absolute, raw: 'file:***REDACTED***' }
}

async function hasSqliteCli() {
  try {
    await execFileAsync('sqlite3', ['--version'], { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

async function runPragma(dbPath: string | null, sql: string) {
  if (!dbPath) return { status: 'not_applicable', rows: [] as Array<Record<string, string>> }
  if (await hasSqliteCli()) {
    try {
      const { stdout } = await execFileAsync('sqlite3', [dbPath, sql], { timeout: 15000 })
      return {
        status: 'completed',
        method: 'sqlite3_cli',
        rows: stdout.split('\n').map((value) => value.trim()).filter(Boolean).map((value) => ({ result: value })),
      }
    } catch (error) {
      return { status: 'failed', method: 'sqlite3_cli', error: error instanceof Error ? error.message : String(error), rows: [] }
    }
  }
  try {
    const nodeSqlite = await Function('return import("node:sqlite")')()
    const DatabaseSync = nodeSqlite.DatabaseSync
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare(sql).all() as Array<Record<string, string>>
    db.close()
    return {
      status: 'completed',
      method: 'node_sqlite',
      rows,
    }
  } catch (error) {
    return {
      status: 'unavailable',
      method: 'node_sqlite',
      reason: 'sqlite_cli_and_node_sqlite_unavailable_or_failed',
      error: error instanceof Error ? error.message : String(error),
      rows: [],
    }
  }
}

async function lsof(path: string | null) {
  if (!path) return { status: 'not_applicable', rows: [] as string[] }
  try {
    const { stdout } = await execFileAsync('lsof', [path], { timeout: 5000 })
    return {
      status: 'completed',
      rows: stdout.split('\n').map((line) => line.trim()).filter(Boolean),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { status: message.includes('Command failed') ? 'completed' : 'failed', rows: [] as string[], error: message }
  }
}

async function recentBackups(dbPath: string | null) {
  if (!dbPath) return []
  const dir = dirname(dbPath)
  const base = dbPath.split('/').at(-1) || 'dev.db'
  try {
    const files = await readdir(dir)
    const backupFiles = files.filter((file) => file !== base && (file.includes(base) || file.endsWith('.db') || file.endsWith('.sqlite')))
    const rows = await Promise.all(backupFiles.map(async (file) => {
      const fullPath = resolve(dir, file)
      const info = await stat(fullPath)
      return {
        file,
        path: fullPath,
        sizeBytes: info.size,
        modifiedAt: info.mtime.toISOString(),
      }
    }))
    return rows.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt)).slice(0, 10)
  } catch {
    return []
  }
}

async function recentOperations(enabled: boolean) {
  if (!enabled) {
    return {
      status: 'skipped',
      reason: 'database_health_not_confirmed',
      failedOperations: [],
      dividendLowVolOperations: [],
    }
  }
  try {
    const [failed, dividendLowVol] = await Promise.all([
      prisma.operation.findMany({
        where: { status: { in: ['failed', 'partial'] } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { id: true, type: true, status: true, errorMessage: true, updatedAt: true },
      }),
      prisma.operation.findMany({
        where: { type: { contains: 'dividend_low_vol' } },
        orderBy: { updatedAt: 'desc' },
        take: 10,
        select: { id: true, type: true, status: true, progressPct: true, updatedAt: true },
      }),
    ])
    return {
      status: 'completed',
      failedOperations: failed.map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString() })),
      dividendLowVolOperations: dividendLowVol.map((item) => ({ ...item, updatedAt: item.updatedAt.toISOString() })),
    }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      failedOperations: [],
      dividendLowVolOperations: [],
    }
  }
}

async function providerHealth(enabled: boolean) {
  if (!enabled) return { status: 'skipped', reason: 'database_health_not_confirmed', providers: [] }
  try {
    const rows = await prisma.providerHealth.findMany({
      orderBy: { provider: 'asc' },
      take: 30,
    })
    return {
      status: 'completed',
      providers: rows.map((row) => ({
        provider: row.provider,
        status: row.status,
        successCount: row.successCount,
        failureCount: row.failureCount,
        lastSuccessAt: row.lastSuccessAt?.toISOString() || null,
        lastFailureAt: row.lastFailureAt?.toISOString() || null,
      })),
    }
  } catch (error) {
    return { status: 'failed', error: error instanceof Error ? error.message : String(error), providers: [] }
  }
}

async function main() {
  const generatedAt = new Date().toISOString()
  const db = resolveSqlitePath()
  const dbStat = db.path ? await stat(db.path).then((info) => ({
    exists: true,
    sizeBytes: info.size,
    modifiedAt: info.mtime.toISOString(),
    sha256Prefix: createHash('sha256').update(`${db.path}:${info.size}:${info.mtimeMs}`).digest('hex').slice(0, 16),
  })).catch((error) => ({
    exists: false,
    error: error instanceof Error ? error.message : String(error),
  })) : { exists: false, reason: 'not_sqlite_database_url' }

  const [integrityCheck, quickCheck, writers, backups] = await Promise.all([
    db.databaseUrlKind === 'sqlite' ? runPragma(db.path, 'PRAGMA integrity_check;') : Promise.resolve({ status: 'not_applicable', rows: [] }),
    db.databaseUrlKind === 'sqlite' ? runPragma(db.path, 'PRAGMA quick_check;') : Promise.resolve({ status: 'not_applicable', rows: [] }),
    lsof(db.path),
    recentBackups(db.path),
  ])
  const integrityText = JSON.stringify(integrityCheck.rows)
  const quickText = JSON.stringify(quickCheck.rows)
  const sqliteHealthy = db.databaseUrlKind !== 'sqlite'
    || (integrityCheck.status === 'completed' && quickCheck.status === 'completed' && integrityText.includes('ok') && quickText.includes('ok'))
  const dbQueriesEnabled = db.databaseUrlKind !== 'sqlite' || sqliteHealthy
  const [operations, health] = await Promise.all([
    recentOperations(dbQueriesEnabled),
    providerHealth(dbQueriesEnabled),
  ])
  const status = sqliteHealthy ? 'healthy' : 'critical'
  const audit = {
    schemaVersion: 'dividend.low_vol.runtime_health_audit.v1',
    generatedAt,
    strategyFamily: 'dividend_low_volatility',
    strategyId: 'dividend_low_vol_leader_v1',
    status,
    notTradingAdvice: true,
    allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    runtimeHealth: {
      databaseUrlKind: db.databaseUrlKind,
      databaseUrl: db.raw,
      databaseFile: db.path,
      databaseFileStat: dbStat,
      integrityCheck,
      quickCheck,
      activeWriters: writers,
      recentBackups: backups,
      recentOperations: operations,
      providerHealth: health,
    },
    decision: {
      largeDividendLowVolScanAllowed: sqliteHealthy,
      largeBacktestPersistenceAllowed: sqliteHealthy,
      reason: sqliteHealthy ? 'sqlite_health_checks_passed_or_not_sqlite' : 'sqlite_integrity_check_failed_or_unavailable',
      requiredFollowup: sqliteHealthy ? [] : [
        'Stop backend writers before repair or restore.',
        'Back up the current DB file before any repair attempt.',
        'Restore a known-good DB or migrate scan persistence to PostgreSQL staging.',
        'Do not run full-A dividend-low-vol scans or persistence-heavy backtests until health is restored.',
      ],
    },
  }
  const dir = resolve(auditRoot(), timestamp())
  await mkdir(dir, { recursive: true })
  const path = resolve(dir, '11_runtime_health_audit.json')
  await writeFile(path, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: true, status, path, sqliteHealthy }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
