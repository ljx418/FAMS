import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import { prisma as defaultPrisma } from '../../db/prisma.js'

const execFileAsync = promisify(execFile)

export type RuntimeHealthStatus = 'healthy' | 'critical'

type RuntimeHealthOptions = {
  prisma?: PrismaClient
  includeOperations?: boolean
  includeProviderHealth?: boolean
}

function backendRoot() {
  return process.cwd().endsWith('/backend') ? process.cwd() : resolve(process.cwd(), 'backend')
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

async function hasCommand(command: string, args: string[] = ['--version']) {
  try {
    await execFileAsync(command, args, { timeout: 3000 })
    return true
  } catch {
    return false
  }
}

async function runPragmaWithCli(dbPath: string, sql: string) {
  try {
    const { stdout } = await execFileAsync('sqlite3', [dbPath, sql], { timeout: 15000 })
    return {
      status: 'completed',
      method: 'sqlite3_cli',
      rows: stdout.split('\n').map((value) => value.trim()).filter(Boolean).map((value) => ({ result: value })),
    }
  } catch (error) {
    return { status: 'failed', method: 'sqlite3_cli', error: error instanceof Error ? error.message : String(error), rows: [] as Array<Record<string, unknown>> }
  }
}

async function runPragmaWithNodeSqlite(dbPath: string, sql: string) {
  try {
    const nodeSqlite = await Function('return import("node:sqlite")')()
    const DatabaseSync = nodeSqlite.DatabaseSync
    const db = new DatabaseSync(dbPath, { readOnly: true })
    const rows = db.prepare(sql).all() as Array<Record<string, unknown>>
    db.close()
    return { status: 'completed', method: 'node_sqlite', rows }
  } catch (error) {
    return {
      status: 'failed',
      method: 'node_sqlite',
      error: error instanceof Error ? error.message : String(error),
      rows: [] as Array<Record<string, unknown>>,
    }
  }
}

async function runPragmaWithPrisma(client: PrismaClient, sql: string) {
  try {
    const rows = await client.$queryRawUnsafe<Array<Record<string, unknown>>>(sql)
    return { status: 'completed', method: 'prisma_query_raw', rows }
  } catch (error) {
    return {
      status: 'failed',
      method: 'prisma_query_raw',
      error: error instanceof Error ? error.message : String(error),
      rows: [] as Array<Record<string, unknown>>,
    }
  }
}

async function runSqlitePragma(client: PrismaClient, dbPath: string | null, sql: string) {
  if (!dbPath) return { status: 'not_applicable', rows: [] as Array<Record<string, unknown>> }

  if (await hasCommand('sqlite3')) {
    const cli = await runPragmaWithCli(dbPath, sql)
    if (cli.status === 'completed' && pragmaRowsContainOk(cli.rows)) return cli
  }

  const nodeSqlite = await runPragmaWithNodeSqlite(dbPath, sql)
  if (nodeSqlite.status === 'completed' && pragmaRowsContainOk(nodeSqlite.rows)) return nodeSqlite

  const prismaResult = await runPragmaWithPrisma(client, sql)
  return prismaResult.status === 'completed' && pragmaRowsContainOk(prismaResult.rows)
    ? prismaResult
    : {
      status: 'unavailable',
      method: 'all_fallbacks_failed',
      reason: 'sqlite3_cli_node_sqlite_and_prisma_pragma_failed',
      fallbackErrors: [nodeSqlite.error, prismaResult.error].filter(Boolean),
      rows: [] as Array<Record<string, unknown>>,
    }
}

async function lsof(path: string | null) {
  if (!path) return { status: 'not_applicable', rows: [] as string[] }
  if (!await hasCommand('lsof', ['-v'])) return { status: 'unavailable', reason: 'lsof_not_installed', rows: [] as string[] }
  try {
    const { stdout } = await execFileAsync('lsof', [path], { timeout: 5000 })
    return { status: 'completed', rows: stdout.split('\n').map((line) => line.trim()).filter(Boolean) }
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
      return { file, path: fullPath, sizeBytes: info.size, modifiedAt: info.mtime.toISOString() }
    }))
    return rows.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt)).slice(0, 10)
  } catch {
    return []
  }
}

function pragmaRowsContainOk(rows: Array<Record<string, unknown>>) {
  return JSON.stringify(rows).toLowerCase().includes('ok')
}

export class RuntimeHealthService {
  async check(options: RuntimeHealthOptions = {}) {
    const generatedAt = new Date().toISOString()
    const client = options.prisma || defaultPrisma
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
      db.databaseUrlKind === 'sqlite' ? runSqlitePragma(client, db.path, 'PRAGMA integrity_check;') : Promise.resolve({ status: 'not_applicable', rows: [] as Array<Record<string, unknown>> }),
      db.databaseUrlKind === 'sqlite' ? runSqlitePragma(client, db.path, 'PRAGMA quick_check;') : Promise.resolve({ status: 'not_applicable', rows: [] as Array<Record<string, unknown>> }),
      lsof(db.path),
      recentBackups(db.path),
    ])

    const sqliteHealthy = db.databaseUrlKind !== 'sqlite'
      || (integrityCheck.status === 'completed' && quickCheck.status === 'completed' && pragmaRowsContainOk(integrityCheck.rows) && pragmaRowsContainOk(quickCheck.rows))
    const dbQueriesEnabled = db.databaseUrlKind !== 'sqlite' || sqliteHealthy

    const [operations, providerHealth] = await Promise.all([
      this.recentOperations(client, Boolean(options.includeOperations) && dbQueriesEnabled),
      this.providerHealth(client, Boolean(options.includeProviderHealth) && dbQueriesEnabled),
    ])

    const activeWriterRows = writers.status === 'completed' ? writers.rows.slice(1) : []
    const status: RuntimeHealthStatus = sqliteHealthy ? 'healthy' : 'critical'

    return {
      schemaVersion: 'fams.runtime_health.v1',
      generatedAt,
      status,
      sqliteHealthy,
      notTradingAdvice: true,
      databaseUrlKind: db.databaseUrlKind,
      databaseUrl: db.raw,
      databaseFile: db.path,
      databaseFileStat: dbStat,
      integrityCheck,
      quickCheck,
      activeWriters: writers,
      recentBackups: backups,
      recentOperations: operations,
      providerHealth,
      decision: {
        largeDividendLowVolScanAllowed: status === 'healthy',
        largeBacktestPersistenceAllowed: status === 'healthy',
        validationPromotionAllowed: status === 'healthy',
        blockedActions: status === 'healthy' ? [] : [
          'full_a_persistent_scan',
          'persistence_heavy_backtest',
          'formal_validation_promotion',
        ],
        allowedActions: status === 'healthy'
          ? ['research_scan', 'operation_backtest', 'audit_package']
          : ['small_non_persistent_research_dry_run', 'fixture_tests', 'audit_package'],
        reason: status === 'healthy'
          ? (activeWriterRows.length > 0 ? 'sqlite_health_checks_passed_active_writers_recorded_for_audit' : 'sqlite_health_checks_passed')
          : 'sqlite_health_unconfirmed_or_integrity_check_failed',
        requiredFollowup: status === 'healthy' ? [] : [
          'Stop backend writers before repair or restore.',
          'Back up the current DB file before any repair attempt.',
          'Restore a known-good DB or migrate scan persistence to PostgreSQL staging.',
          'Do not run full-A dividend-low-vol scans or persistence-heavy backtests until health is restored.',
        ],
      },
    }
  }

  private async recentOperations(client: PrismaClient, enabled: boolean) {
    if (!enabled) {
      return { status: 'skipped', reason: 'database_health_not_confirmed_or_not_requested', failedOperations: [], dividendLowVolOperations: [] }
    }
    try {
      const [failed, dividendLowVol] = await Promise.all([
        client.operation.findMany({
          where: { status: { in: ['failed', 'partial'] } },
          orderBy: { updatedAt: 'desc' },
          take: 10,
          select: { id: true, type: true, status: true, errorSummary: true, updatedAt: true },
        }),
        client.operation.findMany({
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
      return { status: 'failed', error: error instanceof Error ? error.message : String(error), failedOperations: [], dividendLowVolOperations: [] }
    }
  }

  private async providerHealth(client: PrismaClient, enabled: boolean) {
    if (!enabled) return { status: 'skipped', reason: 'database_health_not_confirmed_or_not_requested', providers: [] }
    try {
      const rows = await client.providerHealth.findMany({ orderBy: { provider: 'asc' }, take: 30 })
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
}

export const runtimeHealthService = new RuntimeHealthService()
