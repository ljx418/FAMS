import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const MIGRATION_ID = '20261008_trade_plan_ledger'
const migrationPath = resolve(process.cwd(), 'prisma/manual-migrations/20261008_trade_plan_ledger.sql')

function argValue(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function databasePathFromInput() {
  const explicit = argValue('--database')
  if (explicit) return resolve(process.cwd(), explicit)
  const url = process.env.DATABASE_URL
  if (url?.startsWith('file:')) {
    const raw = url.slice('file:'.length)
    return resolve(process.cwd(), raw)
  }
  throw new Error('Provide --database <sqlite-file> or a file: DATABASE_URL')
}

function sqlite(databasePath: string, statement: string, readonly = true) {
  const args = readonly ? ['-readonly', databasePath, statement] : [databasePath, statement]
  return execFileSync('sqlite3', args, { encoding: 'utf8' }).trim()
}

function hashRows(databasePath: string, query: string) {
  const output = execFileSync('sqlite3', ['-readonly', '-quote', databasePath, query], {
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
  })
  return createHash('sha256').update(output).digest('hex')
}

const legacyQueries = {
  Transaction: `SELECT "id","positionId","userId","assetId","type","quantity","price","fee","amount","broker","confirmationNo","status","executedAt","notes","source","adviceActionId","sourceImportKey","sourceCaptureRowId","sleeveType","volatilityTradeDraftId","createdAt","updatedAt" FROM "Transaction" ORDER BY "id"`,
  Position: 'SELECT * FROM "Position" ORDER BY "id"',
  GridPlan: `SELECT "id","userId","dailyReviewRunId","assetId","strategyVersionId","previousPlanId","mode","status","summary","constraintsJson","changeReasonsJson","evidenceRefsJson","validUntil","createdAt","updatedAt" FROM "GridPlan" ORDER BY "id"`,
  GridOrderDraft: 'SELECT * FROM "GridOrderDraft" ORDER BY "id"',
  ExternalOrderObservation: `SELECT "id","userId","assetId","captureRowId","side","status","quantity","filledQuantity","limitPrice","submittedAt","externalOrderId","validUntil","observedAt","rawJson","createdAt","updatedAt" FROM "ExternalOrderObservation" ORDER BY "id"`,
}

function snapshot(databasePath: string) {
  return Object.fromEntries(Object.entries(legacyQueries).map(([name, query]) => {
    const count = Number(sqlite(databasePath, `SELECT COUNT(*) FROM "${name}";`))
    return [name, { count, hash: hashRows(databasePath, query) }]
  }))
}

function main() {
  const databasePath = databasePathFromInput()
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) {
    throw new Error(`SQLite database does not exist: ${databasePath}`)
  }
  if (!existsSync(migrationPath)) throw new Error(`Migration SQL missing: ${migrationPath}`)

  const markerTableExists = sqlite(
    databasePath,
    `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='_FamsManualMigration';`,
  ) === '1'
  const alreadyApplied = markerTableExists && sqlite(
    databasePath,
    `SELECT COUNT(*) FROM "_FamsManualMigration" WHERE "id"='${MIGRATION_ID}';`,
  ) === '1'

  if (alreadyApplied) {
    const integrity = sqlite(databasePath, 'PRAGMA integrity_check;')
    const foreignKeyViolations = sqlite(databasePath, 'PRAGMA foreign_key_check;')
    console.log(JSON.stringify({
      schemaVersion: 'fams.trade-plan-ledger-migration-result.v1',
      migrationId: MIGRATION_ID,
      database: basename(databasePath),
      status: 'already_applied',
      integrity,
      foreignKeyViolations: foreignKeyViolations ? foreignKeyViolations.split('\n') : [],
    }, null, 2))
    return
  }

  const before = snapshot(databasePath)
  const backupPath = `${databasePath}.pre-${MIGRATION_ID}-${Date.now()}.bak`
  copyFileSync(databasePath, backupPath)

  const result = spawnSync('sqlite3', [databasePath], {
    input: readFileSync(migrationPath, 'utf8'),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`Migration failed; original backup retained at ${backupPath}\n${result.stderr || result.stdout}`)
  }

  const after = snapshot(databasePath)
  const invariantFailures = Object.keys(before).filter((name) => {
    const key = name as keyof typeof before
    return before[key].count !== after[key].count || before[key].hash !== after[key].hash
  })
  const integrity = sqlite(databasePath, 'PRAGMA integrity_check;')
  const foreignKeyViolations = sqlite(databasePath, 'PRAGMA foreign_key_check;')
  const markerCount = Number(sqlite(databasePath, `SELECT COUNT(*) FROM "_FamsManualMigration" WHERE "id"='${MIGRATION_ID}';`))

  if (invariantFailures.length || integrity !== 'ok' || foreignKeyViolations || markerCount !== 1) {
    throw new Error(JSON.stringify({
      message: 'Post-migration verification failed; restore from retained backup',
      backupPath,
      invariantFailures,
      integrity,
      foreignKeyViolations,
      markerCount,
    }, null, 2))
  }

  const positionEffects = sqlite(
    databasePath,
    'SELECT "positionEffect", COUNT(*) FROM "Transaction" GROUP BY "positionEffect" ORDER BY "positionEffect";',
  ).split('\n').filter(Boolean)

  console.log(JSON.stringify({
    schemaVersion: 'fams.trade-plan-ledger-migration-result.v1',
    migrationId: MIGRATION_ID,
    database: basename(databasePath),
    status: 'applied',
    backupPath,
    before,
    after,
    positionEffects,
    integrity,
    foreignKeyViolations: [],
  }, null, 2))
}

main()
