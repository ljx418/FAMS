import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type ResolvedDatabaseUrl = {
  kind: 'sqlite' | 'postgresql' | 'unknown'
  raw: string
  url: string
  sqlitePath: string | null
}

const BACKEND_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const PRISMA_ROOT = resolve(BACKEND_ROOT, 'prisma')

function canonicalizeExistingPath(path: string) {
  const configuredPath = process.env.FAMS_SQLITE_DATABASE_PATH?.trim()
  const selectedPath = configuredPath || path
  // DrvFS is case-insensitive for this workspace, but Linux treats differently
  // cased spellings as distinct SQLite/WAL identities. Normalize the whole mounted
  // path so processes started from `workSpace` and `workspace` cannot diverge.
  if (process.platform === 'linux' && /^\/mnt\/[a-z]\//i.test(selectedPath)) {
    return selectedPath.toLowerCase()
  }
  try {
    // Keep the casing supplied by the repository's own import URL. DrvFS accepts
    // case aliases, but Prisma's SQLite engine can fail to open WAL/SHM files when
    // the database is reached through a differently-cased alias.
    return existsSync(selectedPath) ? realpathSync.native(selectedPath) : selectedPath
  } catch {
    return selectedPath
  }
}

function defaultSqliteConnectionLimit(sqlitePath: string) {
  // SQLite WAL/SHM files on WSL DrvFS are not reliable when Prisma opens several
  // connections concurrently through the Windows mount. A single connection also
  // makes the connection-scoped busy_timeout pragma apply to every request.
  const isWindowsMountedPath = process.platform === 'linux' && /^\/mnt\/[a-z]\//i.test(sqlitePath)
  return isWindowsMountedPath ? 1 : 4
}

function withSqliteConnectionLimit(query: string, sqlitePath: string) {
  const params = new URLSearchParams(query)
  if (!params.has('connection_limit')) {
    const fallback = defaultSqliteConnectionLimit(sqlitePath)
    const configured = Number(process.env.FAMS_SQLITE_CONNECTION_LIMIT || fallback)
    params.set('connection_limit', String(Number.isInteger(configured) && configured > 0 ? configured : fallback))
  }
  return params.toString()
}

export function resolveDatabaseUrl(rawValue = process.env.DATABASE_URL || 'file:./dev.db'): ResolvedDatabaseUrl {
  if (!rawValue.startsWith('file:')) {
    return {
      kind: rawValue.startsWith('postgres') ? 'postgresql' : 'unknown',
      raw: rawValue,
      url: rawValue,
      sqlitePath: null,
    }
  }

  const value = rawValue.slice('file:'.length)
  const queryIndex = value.indexOf('?')
  const filePart = queryIndex >= 0 ? value.slice(0, queryIndex) : value
  const query = queryIndex >= 0 ? value.slice(queryIndex + 1) : ''
  const decoded = decodeURIComponent(filePart)
  const absolute = isAbsolute(decoded)
    ? decoded
    : decoded === './prisma/dev.db' || decoded === 'prisma/dev.db'
      ? resolve(BACKEND_ROOT, 'prisma/dev.db')
      : resolve(PRISMA_ROOT, decoded)
  const sqlitePath = canonicalizeExistingPath(absolute)
  const resolvedQuery = withSqliteConnectionLimit(query, sqlitePath)

  return {
    kind: 'sqlite',
    raw: rawValue,
    url: `file:${sqlitePath}${resolvedQuery ? `?${resolvedQuery}` : ''}`,
    sqlitePath,
  }
}

export function getBackendRoot() {
  return BACKEND_ROOT
}
