import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { prisma } from '../src/db/prisma.js'
import { assertLoopbackHost, createFamsStreamableHttpServer } from '../src/mcp/streamableHttp.js'

async function main() {
  assert.equal(assertLoopbackHost('127.0.0.1'), '127.0.0.1')
  assert.throws(() => assertLoopbackHost('0.0.0.0'), /Refusing unauthenticated MCP bind/)
  assert.throws(() => assertLoopbackHost('192.168.1.20'), /Refusing unauthenticated MCP bind/)

  process.env.FAMS_MCP_PROFILE = 'volatility'
  process.env.FAMS_MCP_DEFAULT_USER_ID = 'default'
  const httpServer = createFamsStreamableHttpServer()
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject)
    httpServer.listen(0, '127.0.0.1', resolve)
  })
  const address = httpServer.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  const client = new Client({ name: 'fams-volatility-http-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`)))
  const listed = await client.listTools()
  assert(listed.tools.some((tool) => tool.name === 'volatility_workflow.run'))
  assert(!listed.tools.some((tool) => tool.name === 'transaction.create_manual_record'))

  const health = await fetch(`${baseUrl}/health`)
  assert.equal(health.status, 200)
  assert.equal((await health.json() as any).profile, 'volatility')
  const rejectedGet = await fetch(`${baseUrl}/mcp`)
  assert.equal(rejectedGet.status, 405)

  await client.close()
  await new Promise<void>((resolve, reject) => httpServer.close((error) => error ? reject(error) : resolve()))
  await prisma.$disconnect()
  process.stdout.write(JSON.stringify({
    ok: true,
    transport: 'streamable_http_official_sdk',
    endpoint: `${baseUrl}/mcp`,
    loopbackOnly: true,
    toolCount: listed.tools.length,
  }, null, 2) + '\n')
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined)
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
