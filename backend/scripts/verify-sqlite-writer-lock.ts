import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'
import { acquireSqliteWriterLock } from '../src/db/sqliteWriterLock.js'

const databasePath = `/tmp/fams-sqlite-writer-lock-${process.pid}-${Date.now()}.db`
const first = await acquireSqliteWriterLock(databasePath)

await assert.rejects(
  () => acquireSqliteWriterLock(databasePath),
  /SQLite writer already active/,
)

await first.release()
await assert.rejects(() => access(first.lockPath))

const second = await acquireSqliteWriterLock(databasePath)
await second.release()
await assert.rejects(() => access(second.lockPath))

process.stdout.write(`${JSON.stringify({ status: 'passed', lockPath: first.lockPath, duplicateWriterRejected: true, reacquireAfterRelease: true }, null, 2)}\n`)
