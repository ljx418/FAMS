import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { resolveDatabaseUrl } from './databaseUrl.js'

export const databaseConfig = resolveDatabaseUrl()

export const prisma = new PrismaClient({
  datasources: {
    db: { url: databaseConfig.url },
  },
})

let initialization: Promise<void> | null = null

export function initializePrisma() {
  if (!initialization) {
    initialization = (async () => {
      await prisma.$connect()
      if (databaseConfig.kind === 'sqlite') {
        // journal_mode is persistent; run startup pragmas sequentially before serving requests.
        await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL')
        await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 30000')
      }
      await prisma.$queryRawUnsafe('SELECT 1')
    })().catch((error) => {
      initialization = null
      throw error
    })
  }
  return initialization
}
