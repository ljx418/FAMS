import { PrismaClient } from '@prisma/client'

export const prisma = new PrismaClient()

void (async () => {
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL')
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 30000')
  } catch (error) {
    console.warn('SQLite pragma initialization failed:', error instanceof Error ? error.message : error)
  }
})()
