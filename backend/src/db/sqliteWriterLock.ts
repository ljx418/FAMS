import { randomUUID } from 'node:crypto'
import { open, readFile, rename, stat, unlink, type FileHandle } from 'node:fs/promises'

type LockMetadata = {
  schemaVersion: 'fams.sqlite-writer-lock.v1'
  pid: number
  acquiredAt: string
  databasePath: string
  nonce: string
}

export type SqliteWriterLock = {
  lockPath: string
  metadata: LockMetadata
  release: () => Promise<void>
}

const INCOMPLETE_LOCK_GRACE_MS = 30_000

function isProcessAlive(pid: number) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error: any) {
    return error?.code === 'EPERM'
  }
}

async function readMetadata(lockPath: string) {
  try {
    return JSON.parse(await readFile(lockPath, 'utf8')) as LockMetadata
  } catch {
    return null
  }
}

async function moveStaleLock(lockPath: string) {
  const stalePath = `${lockPath}.stale-${Date.now()}-${randomUUID()}`
  await rename(lockPath, stalePath)
  return stalePath
}

export async function acquireSqliteWriterLock(databasePath: string): Promise<SqliteWriterLock> {
  const lockPath = `${databasePath}.writer.lock`
  let handle: FileHandle | null = null

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      handle = await open(lockPath, 'wx')
      break
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error
      const existing = await readMetadata(lockPath)
      if (existing && isProcessAlive(existing.pid)) {
        throw new Error(`SQLite writer already active (pid=${existing.pid}, database=${databasePath})`)
      }
      if (!existing) {
        const lockStat = await stat(lockPath).catch(() => null)
        if (!lockStat || Date.now() - lockStat.mtimeMs < INCOMPLETE_LOCK_GRACE_MS) {
          throw new Error(`SQLite writer lock is initializing or unreadable (${lockPath})`)
        }
      }
      await moveStaleLock(lockPath).catch((renameError: any) => {
        if (renameError?.code !== 'ENOENT') throw renameError
      })
    }
  }

  if (!handle) throw new Error(`Unable to acquire SQLite writer lock (${lockPath})`)

  const metadata: LockMetadata = {
    schemaVersion: 'fams.sqlite-writer-lock.v1',
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    databasePath,
    nonce: randomUUID(),
  }
  try {
    await handle.writeFile(`${JSON.stringify(metadata)}\n`, 'utf8')
    await handle.sync()
  } catch (error) {
    await handle.close().catch(() => undefined)
    await unlink(lockPath).catch(() => undefined)
    throw error
  }

  let released = false
  return {
    lockPath,
    metadata,
    release: async () => {
      if (released) return
      released = true
      await handle?.close().catch(() => undefined)
      const current = await readMetadata(lockPath)
      if (current?.nonce === metadata.nonce) await unlink(lockPath).catch(() => undefined)
    },
  }
}
