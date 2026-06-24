import type { PrismaClient } from '@prisma/client'

// Runtime helper for local/default users created by the current single-user UI.
export async function ensureUser(prisma: PrismaClient, userId: string) {
  if (!userId) {
    throw new Error('userId is required')
  }

  const existing = await prisma.user.findUnique({ where: { id: userId } })
  if (existing) return existing

  const allowDynamicLocalUsers = process.env.FAMS_ALLOW_DYNAMIC_LOCAL_USERS === '1'
  if (userId !== 'default' && !allowDynamicLocalUsers) {
    const error = new Error(`User "${userId}" not found`) as Error & { statusCode?: number; code?: string }
    error.statusCode = 404
    error.code = 'USER_NOT_FOUND'
    throw error
  }

  return prisma.user.upsert({
    where: { id: userId },
    create: {
      id: userId,
      email: `${userId}@local.fams`,
      passwordHash: 'local-development-user',
      name: userId,
    },
    update: {},
  })
}
