import 'dotenv/config'
import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

type CommandResult = {
  status: 'completed' | 'failed'
  stdout?: string
  stderr?: string
  error?: string
}

type TableExportResult = {
  table: string
  status: 'completed' | 'failed'
  sourceExitCode: number | null
  targetExitCode: number | null
  insertedStatements: number
  stderr: string
}

const keyTables = [
  'Asset',
  'Position',
  'Portfolio',
  'Backtest',
  'BacktestResult',
  'Alert',
  'Operation',
  'OperationTask',
  'MarketBarRaw',
  'MarketBarCanonical',
  'MarketDataCoverage',
  'MarketFeatureDaily',
  'SecurityStatusDaily',
  'MarketTradeabilityDaily',
  'DividendLowVolDaily',
]

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

function backendRoot() {
  return resolve(repoRoot(), 'backend')
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function resolveSqlitePath() {
  const raw = process.env.DATABASE_URL || 'file:./prisma/dev.db'
  if (!raw.startsWith('file:')) {
    throw new Error(`DATABASE_URL is not sqlite file URL: ${raw.replace(/\/\/.*@/, '//***@')}`)
  }
  const value = raw.slice('file:'.length)
  if (value.startsWith('/')) return value
  if (value === './dev.db' || value === 'dev.db') return resolve(backendRoot(), 'prisma/dev.db')
  return resolve(backendRoot(), value)
}

async function sha256(path: string) {
  const hash = createHash('sha256')
  await new Promise<void>((resolvePromise, reject) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolvePromise())
  })
  return hash.digest('hex')
}

async function runSqlite(dbPath: string, sql: string, timeout = 30000): Promise<CommandResult> {
  try {
    const { stdout, stderr } = await execFileAsync('sqlite3', [dbPath, sql], {
      timeout,
      maxBuffer: 64 * 1024 * 1024,
    })
    return { status: 'completed', stdout, stderr }
  } catch (error) {
    return {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function lsof(dbPath: string): Promise<CommandResult & { rows: string[] }> {
  try {
    const { stdout, stderr } = await execFileAsync('lsof', [dbPath], { timeout: 5000 })
    return {
      status: 'completed',
      stdout,
      stderr,
      rows: stdout.split('\n').map((line) => line.trim()).filter(Boolean),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: message.includes('Command failed') ? 'completed' : 'failed',
      error: message,
      rows: [],
    }
  }
}

function sqliteLiteral(value: string) {
  return value.replace(/'/g, "''")
}

async function listMissingIds(sourcePath: string, targetPath: string, table: string, limit = 5000) {
  const sql = [
    `ATTACH '${sqliteLiteral(targetPath)}' AS recovered;`,
    `SELECT id FROM main."${table}" EXCEPT SELECT id FROM recovered."${table}" LIMIT ${limit};`,
  ].join(' ')
  const result = await runSqlite(sourcePath, sql, 120000)
  if (result.status !== 'completed') {
    return {
      table,
      status: 'failed',
      ids: [] as string[],
      error: result.error,
    }
  }
  return {
    table,
    status: 'completed',
    ids: result.stdout?.split('\n').map((value) => value.trim()).filter(Boolean) || [],
  }
}

async function countTable(dbPath: string, table: string) {
  const exists = await runSqlite(dbPath, `SELECT name FROM sqlite_master WHERE type='table' AND name='${sqliteLiteral(table)}';`)
  if (exists.status !== 'completed' || !exists.stdout?.trim()) {
    return {
      table,
      status: exists.status === 'completed' ? 'missing' : 'unreadable',
      count: null,
      error: exists.error,
    }
  }
  const result = await runSqlite(dbPath, `SELECT count(*) FROM "${table}";`, 120000)
  if (result.status !== 'completed') {
    return { table, status: 'unreadable', count: null, error: result.error }
  }
  const parsed = Number(result.stdout?.trim())
  return {
    table,
    status: Number.isFinite(parsed) ? 'completed' : 'unreadable',
    count: Number.isFinite(parsed) ? parsed : null,
    error: Number.isFinite(parsed) ? undefined : `Invalid count output: ${result.stdout}`,
  }
}

async function streamSqliteCommand(sourcePath: string, targetPath: string, dotCommand: '.recover' | '.dump') {
  return new Promise<{ status: 'completed' | 'failed'; sourceExitCode: number | null; targetExitCode: number | null; stderr: string }>((resolvePromise) => {
    const source = spawn('sqlite3', [sourcePath, dotCommand], { stdio: ['ignore', 'pipe', 'pipe'] })
    const target = spawn('sqlite3', [targetPath], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    source.stderr.on('data', (chunk) => { stderr += String(chunk) })
    target.stderr.on('data', (chunk) => { stderr += String(chunk) })
    source.stdout.pipe(target.stdin)

    let sourceExitCode: number | null = null
    let targetExitCode: number | null = null
    const finish = () => {
      if (sourceExitCode === null || targetExitCode === null) return
      resolvePromise({
        status: sourceExitCode === 0 && targetExitCode === 0 ? 'completed' : 'failed',
        sourceExitCode,
        targetExitCode,
        stderr,
      })
    }
    source.on('close', (code) => {
      sourceExitCode = code
      target.stdin.end()
      finish()
    })
    target.on('close', (code) => {
      targetExitCode = code
      finish()
    })
    source.on('error', (error) => {
      stderr += error instanceof Error ? error.message : String(error)
      sourceExitCode = -1
      finish()
    })
    target.on('error', (error) => {
      stderr += error instanceof Error ? error.message : String(error)
      targetExitCode = -1
      finish()
    })
  })
}

async function recoverSqlite(sourcePath: string, targetPath: string) {
  const recover = await streamSqliteCommand(sourcePath, targetPath, '.recover')
  const recoverStat = await stat(targetPath).catch(() => null)
  if (recover.status === 'completed' && recoverStat && recoverStat.size > 0) {
    return {
      method: 'recover',
      ...recover,
    }
  }

  await rm(targetPath, { force: true })
  const dump = await streamSqliteCommand(sourcePath, targetPath, '.dump')
  return {
    method: 'dump_fallback',
    recoverAttempt: recover,
    ...dump,
  }
}

async function createEmptyPrismaSqlite(targetPath: string) {
  const prismaCli = resolve(backendRoot(), 'node_modules/prisma/build/index.js')
  const result = await execFileAsync(process.execPath, [prismaCli, 'db', 'push', '--skip-generate'], {
    cwd: backendRoot(),
    env: {
      ...process.env,
      DATABASE_URL: `file:${targetPath}`,
    },
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
  })
  return {
    status: 'completed' as const,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

async function exportTableInserts(sourcePath: string, targetPath: string, table: string): Promise<TableExportResult> {
  return new Promise((resolvePromise) => {
    const source = spawn('sqlite3', [sourcePath, `.dump ${table}`], { stdio: ['ignore', 'pipe', 'pipe'] })
    const target = spawn('sqlite3', [targetPath], { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    let pending = ''
    let sourceExitCode: number | null = null
    let targetExitCode: number | null = null
    let insertedStatements = 0

    target.stdin.write('PRAGMA foreign_keys=OFF;\nBEGIN TRANSACTION;\n')
    source.stderr.on('data', (chunk) => { stderr += String(chunk) })
    target.stderr.on('data', (chunk) => { stderr += String(chunk) })
    source.stdout.on('data', (chunk) => {
      pending += String(chunk)
      const lines = pending.split('\n')
      pending = lines.pop() || ''
      for (const line of lines) {
        if (/^INSERT INTO\s+/i.test(line)) {
          target.stdin.write(`${line}\n`)
          insertedStatements += 1
        }
      }
    })

    const finish = () => {
      if (sourceExitCode === null || targetExitCode === null) return
      resolvePromise({
        table,
        status: sourceExitCode === 0 && targetExitCode === 0 ? 'completed' : 'failed',
        sourceExitCode,
        targetExitCode,
        insertedStatements,
        stderr,
      })
    }

    source.on('close', (code) => {
      if (/^INSERT INTO\s+/i.test(pending)) {
        target.stdin.write(`${pending}\n`)
        insertedStatements += 1
      }
      target.stdin.write('COMMIT;\n')
      target.stdin.end()
      sourceExitCode = code
      finish()
    })
    target.on('close', (code) => {
      targetExitCode = code
      finish()
    })
    source.on('error', (error) => {
      stderr += error instanceof Error ? error.message : String(error)
      sourceExitCode = -1
      finish()
    })
    target.on('error', (error) => {
      stderr += error instanceof Error ? error.message : String(error)
      targetExitCode = -1
      finish()
    })
  })
}

async function tableExportFallback(sourcePath: string, targetPath: string) {
  await rm(targetPath, { force: true })
  const schemaPush = await createEmptyPrismaSqlite(targetPath)
  const tableResults: TableExportResult[] = []
  for (const table of keyTables) {
    // Sequential table export isolates corruption to individual tables and keeps audit deterministic.
    // eslint-disable-next-line no-await-in-loop
    tableResults.push(await exportTableInserts(sourcePath, targetPath, table))
  }
  return {
    method: 'table_export_fallback',
    schemaPush,
    tableResults,
    status: tableResults.every((row) => row.status === 'completed') ? 'completed' as const : 'failed' as const,
    sourceExitCode: tableResults.every((row) => row.sourceExitCode === 0) ? 0 : 1,
    targetExitCode: tableResults.every((row) => row.targetExitCode === 0) ? 0 : 1,
    stderr: tableResults.map((row) => row.stderr).filter(Boolean).join('\n'),
  }
}

function pragmaOk(result: CommandResult) {
  return result.status === 'completed' && result.stdout?.trim().toLowerCase() === 'ok'
}

async function main() {
  const sourcePath = resolveSqlitePath()
  const now = timestamp()
  const promote = process.argv.includes('--promote')
  const allowQuarantine = process.argv.includes('--allow-quarantine')
  const forceQuarantine = process.argv.includes('--force-quarantine')
  const backupDir = resolve(backendRoot(), 'prisma/backups')
  const auditDir = resolve(backendRoot(), 'data/gpt-audit/sqlite-remediation', now)
  await mkdir(backupDir, { recursive: true })
  await mkdir(auditDir, { recursive: true })

  const beforeWriters = await lsof(sourcePath)
  const sourceStat = await stat(sourcePath)
  const sourceHashBefore = await sha256(sourcePath)
  const backupPath = resolve(backupDir, `dev.db.backup.${now}.db`)
  await copyFile(sourcePath, backupPath)
  const backupHash = await sha256(backupPath)

  const recoveredPath = resolve(backendRoot(), 'prisma', `dev.recovered.${now}.db`)
  let recover = await recoverSqlite(sourcePath, recoveredPath)
  let recoveredStat = await stat(recoveredPath).catch(() => null)
  if (!recoveredStat || recoveredStat.size === 0) {
    recover = await tableExportFallback(sourcePath, recoveredPath)
    recoveredStat = await stat(recoveredPath).catch(() => null)
  }
  const integrityCheck = recoveredStat ? await runSqlite(recoveredPath, 'PRAGMA integrity_check;', 120000) : { status: 'failed' as const, error: 'recovered_db_missing' }
  const quickCheck = recoveredStat ? await runSqlite(recoveredPath, 'PRAGMA quick_check;', 120000) : { status: 'failed' as const, error: 'recovered_db_missing' }

  const sourceCounts = []
  for (const table of keyTables) {
    // Sequential reads avoid adding lock pressure to an already unhealthy SQLite file.
    // eslint-disable-next-line no-await-in-loop
    sourceCounts.push(await countTable(sourcePath, table))
  }
  const recoveredCounts = []
  if (recoveredStat) {
    for (const table of keyTables) {
      // eslint-disable-next-line no-await-in-loop
      recoveredCounts.push(await countTable(recoveredPath, table))
    }
  }
  const recoveredByTable = new Map(recoveredCounts.map((row) => [row.table, row]))
  const reconciliation = sourceCounts.map((sourceRow) => {
    const recoveredRow = recoveredByTable.get(sourceRow.table)
    const sourceReadable = sourceRow.status === 'completed' && typeof sourceRow.count === 'number'
    const recoveredReadable = recoveredRow?.status === 'completed' && typeof recoveredRow.count === 'number'
    return {
      table: sourceRow.table,
      sourceStatus: sourceRow.status,
      sourceCount: sourceRow.count,
      recoveredStatus: recoveredRow?.status || 'missing',
      recoveredCount: recoveredRow?.count ?? null,
      status: sourceReadable && recoveredReadable
        ? sourceRow.count === recoveredRow.count ? 'matched' : 'mismatch'
        : recoveredReadable ? 'source_unreadable_recovered_count_available' : 'unresolved_or_quarantined',
      sourceError: sourceRow.error,
      recoveredError: recoveredRow?.error,
    }
  })
  const quarantineCandidates = []
  for (const row of reconciliation) {
    if (row.status !== 'mismatch') continue
    // eslint-disable-next-line no-await-in-loop
    quarantineCandidates.push(await listMissingIds(sourcePath, recoveredPath, row.table))
  }

  const integrityHealthy = pragmaOk(integrityCheck) && pragmaOk(quickCheck)
  const criticalTables = ['Operation', 'OperationTask', 'MarketBarCanonical', 'DividendLowVolDaily']
  const criticalReconciliation = reconciliation.filter((row) => criticalTables.includes(row.table))
  const criticalTablesRecovered = criticalReconciliation.every((row) => row.recoveredStatus === 'completed')
  const criticalTablesMatched = criticalReconciliation.every((row) => row.status === 'matched')
  const mismatchesAccountedFor = reconciliation
    .filter((row) => row.status === 'mismatch')
    .every((row) => {
      const sourceCount = typeof row.sourceCount === 'number' ? row.sourceCount : 0
      const recoveredCount = typeof row.recoveredCount === 'number' ? row.recoveredCount : 0
      const candidate = quarantineCandidates.find((item) => item.table === row.table)
      return candidate?.status === 'completed' && candidate.ids.length === Math.max(0, sourceCount - recoveredCount)
    })
  const quarantineSummary = reconciliation
    .filter((row) => row.status === 'mismatch')
    .map((row) => {
      const sourceCount = typeof row.sourceCount === 'number' ? row.sourceCount : 0
      const recoveredCount = typeof row.recoveredCount === 'number' ? row.recoveredCount : 0
      const missingCount = Math.max(0, sourceCount - recoveredCount)
      const candidate = quarantineCandidates.find((item) => item.table === row.table)
      const enumeratedMissingCount = candidate?.ids.length || 0
      return {
        table: row.table,
        missingCount,
        enumeratedMissingCount,
        unexplainedMissingCount: Math.max(0, missingCount - enumeratedMissingCount),
        status: missingCount === enumeratedMissingCount ? 'fully_enumerated_quarantine' : 'partially_enumerated_quarantine',
      }
    })
  const safeForManualPromotion = recover.status === 'completed' && integrityHealthy && criticalTablesRecovered && criticalTablesMatched
  const safeForQuarantinePromotion = recover.status === 'completed'
    && integrityHealthy
    && criticalTablesRecovered
    && mismatchesAccountedFor
    && reconciliation.every((row) => row.status !== 'unresolved_or_quarantined')
  const safeForForceQuarantinePromotion = recover.status === 'completed'
    && integrityHealthy
    && criticalTablesRecovered
    && reconciliation.every((row) => row.status !== 'unresolved_or_quarantined')
  const promotionAllowed = safeForManualPromotion
    || (allowQuarantine && safeForQuarantinePromotion)
    || (forceQuarantine && safeForForceQuarantinePromotion)
  const promoted = promote && promotionAllowed
  let promotedBackupPath: string | null = null
  let promotionError: string | null = null

  if (promote && promotionAllowed) {
    promotedBackupPath = resolve(backupDir, `dev.db.pre-promote.${now}.db`)
    try {
      await rename(sourcePath, promotedBackupPath)
      await copyFile(recoveredPath, sourcePath)
    } catch (error) {
      promotionError = error instanceof Error ? error.message : String(error)
    }
  }

  const afterWriters = await lsof(sourcePath)
  const audit = {
    schemaVersion: 'fams.sqlite_remediation_audit.v1',
    generatedAt: new Date().toISOString(),
    status: promoted
      ? promotionError ? 'promotion_failed' : 'promoted_recovered_sqlite'
      : safeForManualPromotion ? 'recover_candidate_ready_for_manual_review' : 'recover_candidate_not_safe_to_promote',
    sourcePath,
    backupPath,
    recoveredPath,
    sourceStat: {
      sizeBytes: sourceStat.size,
      modifiedAt: sourceStat.mtime.toISOString(),
      sha256: sourceHashBefore,
    },
    backup: {
      path: backupPath,
      sha256: backupHash,
      hashMatchesSource: backupHash === sourceHashBefore,
    },
    activeWriters: {
      before: beforeWriters.rows,
      after: afterWriters.rows,
    },
    recover,
    recoveredStat: recoveredStat ? {
      sizeBytes: recoveredStat.size,
      modifiedAt: recoveredStat.mtime.toISOString(),
      sha256: await sha256(recoveredPath),
    } : null,
    integrityCheck,
    quickCheck,
    sourceCounts,
    recoveredCounts,
    reconciliation,
    zeroDataLossGuarantee: {
      note: 'Corrupt source tables that are unreadable are treated as quarantined/unresolved; only tables with readable source and recovered counts can be mathematically reconciled.',
      matchedReadableTables: reconciliation.filter((row) => row.status === 'matched').length,
      mismatchedReadableTables: reconciliation.filter((row) => row.status === 'mismatch').length,
      unresolvedOrQuarantinedTables: reconciliation.filter((row) => row.status === 'unresolved_or_quarantined').length,
      criticalTables,
      criticalTablesRecovered,
      criticalTablesMatched,
      mismatchesAccountedFor,
      safeForForceQuarantinePromotion,
      quarantineSummary,
      quarantineCandidates,
    },
    decision: {
      safeForManualPromotion,
      allowQuarantine,
      forceQuarantine,
      safeForQuarantinePromotion,
      safeForForceQuarantinePromotion,
      promoted,
      promotionError,
      largePersistentTasksAllowedAfterPromotion: promoted && !promotionError,
      requiredFollowup: promoted && !promotionError
        ? [
          'Run npm run check:sqlite-health against promoted DB.',
          'Run full-system E2E and confirm Operations no longer report database disk image is malformed.',
          ...(allowQuarantine && !safeForManualPromotion ? ['Review quarantined row IDs before relying on historical Operation/DividendLowVolDaily completeness.'] : []),
          ...(forceQuarantine && !safeForManualPromotion ? ['Force quarantine accepted: review quarantineSummary and regenerate derived DividendLowVolDaily snapshots before relying on historical completeness.'] : []),
        ]
        : [
          'Do not replace dev.db automatically unless --promote is used and safeForManualPromotion=true, --allow-quarantine is used with safeForQuarantinePromotion=true, or --force-quarantine is explicitly used with safeForForceQuarantinePromotion=true.',
          'If recover candidate is not safe, keep using fixture/dry-run paths and move persistence to PostgreSQL staging.',
          'Review unresolved_or_quarantined tables before any data promotion.',
        ],
    },
    notTradingAdvice: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }

  const auditPath = resolve(auditDir, 'sqlite_remediation_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    status: audit.status,
    auditPath,
    backupPath,
    recoveredPath,
    integrityHealthy,
    safeForManualPromotion,
    safeForQuarantinePromotion,
    safeForForceQuarantinePromotion,
    allowQuarantine,
    forceQuarantine,
    promoted: audit.decision.promoted,
    promotionError,
  }, null, 2))

  if (!promotionAllowed || promotionError) {
    process.exitCode = promote ? 2 : 0
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
