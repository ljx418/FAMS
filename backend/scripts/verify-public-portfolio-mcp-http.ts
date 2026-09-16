import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { prisma } from '../src/db/prisma.js'
import { publicPortfolioMcpHttpRouter } from '../src/mcp/portfolioHttp.js'
import { portfolioMcpAuthService } from '../src/services/mcp/portfolioMcpAuthService.js'

async function main() {
  process.env.FAMS_MCP_ALLOWED_ORIGINS = 'https://chatgpt.com'
  const issued = await portfolioMcpAuthService.createToken({
    userId: 'default',
    name: `automated-http-acceptance-${Date.now()}`,
    scopes: ['portfolio:read'],
    expiresAt: new Date(Date.now() + 10 * 60_000),
  })
  const storedToken = await prisma.mcpAccessToken.findUniqueOrThrow({ where: { id: issued.id } })
  assert.notEqual(storedToken.tokenHash, issued.token)
  assert(!JSON.stringify(storedToken).includes(issued.token), 'plaintext bearer token was persisted')
  const expiredToken = await portfolioMcpAuthService.createToken({
    userId: 'default',
    name: `automated-http-expired-${Date.now()}`,
    scopes: ['portfolio:read'],
    expiresAt: new Date(Date.now() - 1_000),
  })
  const app = Fastify({ logger: false })
  await app.register(publicPortfolioMcpHttpRouter, { prefix: '/mcp' })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const address = app.server.address() as AddressInfo
  const endpoint = `http://127.0.0.1:${address.port}/mcp`
  const authHeaders = { authorization: `Bearer ${issued.token}` }

  try {
    const noToken = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    })
    assert.equal(noToken.status, 401)

    const badOrigin = await fetch(endpoint, {
      method: 'POST',
      headers: { ...authHeaders, origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} }),
    })
    assert.equal(badOrigin.status, 403)

    const expired = await fetch(endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${expiredToken.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }),
    })
    assert.equal(expired.status, 401)

    process.env.FAMS_MCP_RATE_LIMIT_PER_MINUTE = '1'
    const initializationBody = JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'raw-rate-limit-test', version: '1.0.0' },
      },
    })
    const firstLimitedRequest = await fetch(endpoint, {
      method: 'POST',
      headers: { ...authHeaders, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: initializationBody,
    })
    assert.equal(firstLimitedRequest.status, 200)
    const rateLimited = await fetch(endpoint, {
      method: 'POST',
      headers: { ...authHeaders, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
      body: initializationBody,
    })
    assert.equal(rateLimited.status, 429)
    process.env.FAMS_MCP_RATE_LIMIT_PER_MINUTE = '60'

    const client = new Client({ name: 'fams-public-portfolio-http-test', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
      requestInit: { headers: authHeaders },
    }))
    const listed = await client.listTools()
    assert.equal(listed.tools.length, 10)
    assert(listed.tools.some((tool) => tool.name === 'portfolio_get_current_state'))
    assert(!listed.tools.some((tool) => tool.name === 'transaction.create_manual_record'))
    const current = await client.callTool({ name: 'portfolio_get_current_state', arguments: { accountScope: 'alipay' } })
    assert.notEqual(current.isError, true)
    assert.equal((current.structuredContent as any)?.executionBoundary?.formalTradingUnlocked, false)
    const denied = await client.callTool({
      name: 'portfolio_snapshot_revoke_reuse',
      arguments: { reason: '远程最小权限验收' },
    })
    assert.equal(denied.isError, true)
    assert.equal((denied.structuredContent as any)?.code, 'MCP_SCOPE_REQUIRED')
    await client.close()

    await portfolioMcpAuthService.revokeToken('default', issued.id)
    const revoked = await fetch(endpoint, {
      method: 'POST',
      headers: { ...authHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'initialize', params: {} }),
    })
    assert.equal(revoked.status, 401)

    process.stdout.write(JSON.stringify({
      ok: true,
      transport: 'streamable_http_official_sdk',
      endpoint,
      bearerRequired: true,
      originAllowlistEnforced: true,
      scopeBoundaryEnforced: true,
      revocationEnforced: true,
      expirationEnforced: true,
      rateLimitEnforced: true,
      plaintextTokenPersisted: false,
      realPortfolioPositionCount: (current.structuredContent as any)?.positionCount,
    }, null, 2) + '\n')
  } finally {
    await prisma.mcpAccessToken.deleteMany({ where: { id: { in: [issued.id, expiredToken.id] } } }).catch(() => undefined)
    await app.close().catch(() => undefined)
    await prisma.$disconnect().catch(() => undefined)
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined)
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
