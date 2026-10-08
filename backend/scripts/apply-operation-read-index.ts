import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const migrationId = '20261008_operation_read_index'
const migrationPath = resolve(process.cwd(), 'prisma/manual-migrations/20261008_operation_read_index.sql')

function argValue(name: string) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] : undefined
}

function databasePathFromInput() {
  const explicit = argValue('--database')
  if (explicit) return resolve(process.cwd(), explicit)
  const url = process.env.DATABASE_URL
  if (url?.startsWith('file:')) return resolve(process.cwd(), url.slice('file:'.length))
  return resolve(process.cwd(), 'prisma/dev.db')
}

function sqlite(databasePath: string, statement: string, readonly = true) {
  const args = readonly ? ['-readonly', databasePath, statement] : [databasePath, statement]
  return execFileSync('sqlite3', args, { encoding: 'utf8' }).trim()
}

function protectedCounts(databasePath: string) {
  return Object.fromEntries(['User', 'Position', 'Transaction', 'Operation'].map((table) => [
    table,
    Number(sqlite(databasePath, `SELECT COUNT(*) FROM "${table}";`)),
  ]))
}

function main() {
  const databasePath = databasePathFromInput()
  if (!existsSync(databasePath) || !statSync(databasePath).isFile()) {
    throw new Error(`SQLite database does not exist: ${databasePath}`)
  }
  if (!existsSync(migrationPath)) throw new Error(`Migration SQL missing: ${migrationPath}`)

  const before = protectedCounts(databasePath)
  const result = spawnSync('sqlite3', [databasePath], {
    input: readFileSync(migrationPath, 'utf8'),
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`Operation read-index migration failed\n${result.stderr || result.stdout}`)
  }

  const after = protectedCounts(databasePath)
  const indexSql = sqlite(
    databasePath,
    `SELECT sql FROM sqlite_master WHERE type='index' AND name='Operation_userId_requestedAt_idx';`,
  )
  const markerCount = Number(sqlite(
    databasePath,
    `SELECT COUNT(*) FROM "_FamsManualMigration" WHERE "id"='${migrationId}';`,
  ))
  const quickCheck = sqlite(databasePath, 'PRAGMA quick_check;')

  if (JSON.stringify(before) !== JSON.stringify(after) || !indexSql || markerCount !== 1 || quickCheck !== 'ok') {
    throw new Error(JSON.stringify({
      message: 'Operation read-index post-migration verification failed',
      before,
      after,
      indexSql,
      markerCount,
      quickCheck,
    }, null, 2))
  }

  console.log(JSON.stringify({
    schemaVersion: 'fams.operation_read_index_migration_result.v1',
    migrationId,
    database: basename(databasePath),
    status: 'applied_or_already_applied',
    protectedCountsBefore: before,
    protectedCountsAfter: after,
    indexSql,
    markerCount,
    quickCheck,
    accountFactsChanged: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
}

main()
