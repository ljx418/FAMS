import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'

export const PORTFOLIO_MCP_SCOPES = [
  'portfolio:read',
  'review:run',
  'capture:write',
  'plan:write',
] as const

export type PortfolioMcpScope = typeof PORTFOLIO_MCP_SCOPES[number]

export type PortfolioMcpPrincipal = {
  subject: string
  userId: string
  scopes: Set<PortfolioMcpScope>
  transport: 'stdio' | 'streamable_http'
  tokenId?: string
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')

const parseScopes = (value: string): PortfolioMcpScope[] => {
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed)
      ? parsed.filter((scope): scope is PortfolioMcpScope => (
        typeof scope === 'string' && PORTFOLIO_MCP_SCOPES.includes(scope as PortfolioMcpScope)
      ))
      : []
  } catch {
    return []
  }
}

class PortfolioMcpAuthService {
  private rateWindow = new Map<string, { windowStartedAt: number; count: number }>()
  private storageInitialization: Promise<void> | null = null

  async ensureStorage() {
    if (!this.storageInitialization) this.storageInitialization = (async () => {
      await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "McpAccessToken" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "userId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "tokenPrefix" TEXT NOT NULL,
      "tokenHash" TEXT NOT NULL,
      "scopesJson" TEXT NOT NULL DEFAULT '[]',
      "expiresAt" DATETIME,
      "revokedAt" DATETIME,
      "lastUsedAt" DATETIME,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL,
      CONSTRAINT "McpAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
    )`)
      await prisma.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "McpAccessToken_tokenHash_key" ON "McpAccessToken"("tokenHash")')
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "McpAccessToken_userId_revokedAt_expiresAt_idx" ON "McpAccessToken"("userId", "revokedAt", "expiresAt")')
      await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "McpAccessToken_tokenPrefix_idx" ON "McpAccessToken"("tokenPrefix")')
    })().catch((error) => {
      this.storageInitialization = null
      throw error
    })
    await this.storageInitialization
  }

  localPrincipal(): PortfolioMcpPrincipal {
    const userId = String(process.env.FAMS_MCP_USER_ID || '').trim()
    if (!userId) throw new Error('FAMS_MCP_USER_ID is required for the local portfolio MCP server')
    return {
      subject: `local:${userId}`,
      userId,
      scopes: new Set(PORTFOLIO_MCP_SCOPES),
      transport: 'stdio',
    }
  }

  async createToken(input: {
    userId: string
    name: string
    scopes?: PortfolioMcpScope[]
    expiresAt?: Date | null
  }) {
    await this.ensureStorage()
    await ensureUser(prisma, input.userId)
    const scopes = input.scopes?.length ? [...new Set(input.scopes)] : [...PORTFOLIO_MCP_SCOPES]
    const secret = randomBytes(32).toString('base64url')
    const prefix = randomBytes(6).toString('hex')
    const token = `fams_mcp_${prefix}.${secret}`
    const now = new Date()
    const record = await prisma.mcpAccessToken.create({
      data: {
        id: randomUUID(),
        userId: input.userId,
        name: input.name.trim().slice(0, 100) || 'portfolio-mcp',
        tokenPrefix: `fams_mcp_${prefix}`,
        tokenHash: tokenHash(token),
        scopesJson: JSON.stringify(scopes),
        expiresAt: input.expiresAt || null,
        updatedAt: now,
      },
    })
    return {
      id: record.id,
      userId: record.userId,
      name: record.name,
      token,
      tokenPrefix: record.tokenPrefix,
      scopes,
      expiresAt: record.expiresAt?.toISOString() || null,
      warning: '令牌明文只显示这一次；请立即保存到安全的密钥存储。',
    }
  }

  async listTokens(userId: string) {
    await this.ensureStorage()
    const records = await prisma.mcpAccessToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
    return records.map((record) => ({
      id: record.id,
      name: record.name,
      tokenPrefix: record.tokenPrefix,
      scopes: parseScopes(record.scopesJson),
      expiresAt: record.expiresAt?.toISOString() || null,
      revokedAt: record.revokedAt?.toISOString() || null,
      lastUsedAt: record.lastUsedAt?.toISOString() || null,
      createdAt: record.createdAt.toISOString(),
    }))
  }

  async revokeToken(userId: string, id: string) {
    await this.ensureStorage()
    const result = await prisma.mcpAccessToken.updateMany({
      where: { id, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    if (result.count !== 1) throw new Error('MCP access token not found or already revoked')
    return { id, revoked: true }
  }

  async authenticateBearer(authorization: string | undefined): Promise<PortfolioMcpPrincipal> {
    const match = authorization?.match(/^Bearer\s+([^\s]+)$/i)
    if (!match) throw new Error('MCP_BEARER_TOKEN_REQUIRED')
    await this.ensureStorage()
    const record = await prisma.mcpAccessToken.findUnique({ where: { tokenHash: tokenHash(match[1]) } })
    if (!record || record.revokedAt) throw new Error('MCP_BEARER_TOKEN_INVALID')
    if (record.expiresAt && record.expiresAt.getTime() <= Date.now()) throw new Error('MCP_BEARER_TOKEN_EXPIRED')
    const scopes = parseScopes(record.scopesJson)
    if (scopes.length === 0) throw new Error('MCP_BEARER_TOKEN_HAS_NO_SCOPES')
    await prisma.mcpAccessToken.update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
    return {
      subject: `token:${record.id}`,
      userId: record.userId,
      scopes: new Set(scopes),
      transport: 'streamable_http',
      tokenId: record.id,
    }
  }

  assertScope(principal: PortfolioMcpPrincipal, scope: PortfolioMcpScope) {
    if (!principal.scopes.has(scope)) throw new Error(`MCP_SCOPE_REQUIRED:${scope}`)
  }

  assertRateLimit(principal: PortfolioMcpPrincipal) {
    const now = Date.now()
    const configuredLimit = Number(process.env.FAMS_MCP_RATE_LIMIT_PER_MINUTE || 60)
    const limit = Number.isInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 60
    const key = principal.tokenId || principal.subject
    const current = this.rateWindow.get(key)
    if (!current || now - current.windowStartedAt >= 60_000) {
      this.rateWindow.set(key, { windowStartedAt: now, count: 1 })
      return
    }
    if (current.count >= limit) throw new Error('MCP_RATE_LIMIT_EXCEEDED')
    current.count += 1
  }
}

export const portfolioMcpAuthService = new PortfolioMcpAuthService()
