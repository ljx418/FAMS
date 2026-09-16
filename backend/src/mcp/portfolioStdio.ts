import 'dotenv/config'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { initializePrisma, prisma } from '../db/prisma.js'
import { createPublicPortfolioMcpServer } from './publicPortfolioServer.js'
import { portfolioMcpAuthService } from '../services/mcp/portfolioMcpAuthService.js'

async function main() {
  const principal = portfolioMcpAuthService.localPrincipal()
  await initializePrisma()
  const server = createPublicPortfolioMcpServer(principal)
  const transport = new StdioServerTransport()
  await server.connect(transport)

  const shutdown = async () => {
    await server.close().catch(() => undefined)
    await prisma.$disconnect().catch(() => undefined)
    process.exit(0)
  }
  process.once('SIGINT', () => { void shutdown() })
  process.once('SIGTERM', () => { void shutdown() })
}

main().catch((error) => {
  process.stderr.write(`Portfolio MCP failed to start: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
