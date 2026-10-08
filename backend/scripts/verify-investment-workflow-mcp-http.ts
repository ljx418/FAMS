import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { prisma } from '../src/db/prisma.js'
import { createFamsStreamableHttpServer } from '../src/mcp/streamableHttp.js'

async function main() {
  process.env.FAMS_MCP_PROFILE = 'workflow'
  process.env.FAMS_MCP_DEFAULT_USER_ID = 'default'
  const httpServer = createFamsStreamableHttpServer()
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = httpServer.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  const client = new Client({ name: 'fams-workflow-http-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)))
  const tools = await client.listTools()
  assert(tools.tools.some((tool) => tool.name === 'investment_workflow.get_readiness'))
  assert(tools.tools.some((tool) => tool.name === 'investment_workflow.start_portfolio_review'))
  assert(tools.tools.some((tool) => tool.name === 'backtest.grid_replay.list_sources'))
  assert(tools.tools.some((tool) => tool.name === 'backtest.grid_replay.run'))
  assert(tools.tools.some((tool) => tool.name === 'backtest.grid_replay.get_result'))
  assert(!tools.tools.some((tool) => tool.name === 'create_transaction'))

  const readiness = await client.callTool({ name: 'investment_workflow.get_readiness', arguments: {} })
  assert.equal(readiness.isError, false)
  assert.equal((readiness.structuredContent as any)?.result?.permissionState?.formalTradingUnlocked, false)

  const health = await fetch(`${baseUrl}/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json() as any).profile, 'workflow')
  const rejectedGet = await fetch(`${baseUrl}/mcp`)
  assert.equal(rejectedGet.status, 405)

  await client.close()
  await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()))
  await prisma.$disconnect()
  process.stdout.write(JSON.stringify({
    ok: true,
    transport: 'streamable_http_official_sdk',
    profile: 'workflow',
    endpoint: `${baseUrl}/mcp`,
    toolCount: tools.tools.length,
  }, null, 2) + '\n')
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined)
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
