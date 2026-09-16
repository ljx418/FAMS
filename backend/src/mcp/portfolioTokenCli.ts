import 'dotenv/config'
import { initializePrisma, prisma } from '../db/prisma.js'
import { portfolioMcpAuthService, PORTFOLIO_MCP_SCOPES, type PortfolioMcpScope } from '../services/mcp/portfolioMcpAuthService.js'

const args = process.argv.slice(2)
const command = args[0]
const value = (name: string) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : undefined
}

const output = (data: unknown) => process.stdout.write(`${JSON.stringify(data, null, 2)}\n`)

async function main() {
  await initializePrisma()
  if (command === 'create') {
    const userId = value('user') || 'default'
    const name = value('name') || 'portfolio-mcp'
    const days = value('expires-days') ? Number(value('expires-days')) : 30
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('--expires-days must be an integer between 1 and 365')
    const requestedScopes = value('scopes')?.split(',').map((scope) => scope.trim()).filter(Boolean)
    if (requestedScopes?.some((scope) => !PORTFOLIO_MCP_SCOPES.includes(scope as PortfolioMcpScope))) {
      throw new Error(`--scopes must use: ${PORTFOLIO_MCP_SCOPES.join(',')}`)
    }
    output(await portfolioMcpAuthService.createToken({
      userId,
      name,
      scopes: requestedScopes as PortfolioMcpScope[] | undefined,
      expiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    }))
    return
  }
  if (command === 'list') {
    output({ userId: value('user') || 'default', tokens: await portfolioMcpAuthService.listTokens(value('user') || 'default') })
    return
  }
  if (command === 'revoke') {
    const id = value('id')
    if (!id) throw new Error('--id is required')
    output(await portfolioMcpAuthService.revokeToken(value('user') || 'default', id))
    return
  }
  throw new Error('Usage: portfolioTokenCli create|list|revoke [--user default] [--name name] [--expires-days 30] [--scopes portfolio:read,...] [--id token-id]')
}

main()
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
