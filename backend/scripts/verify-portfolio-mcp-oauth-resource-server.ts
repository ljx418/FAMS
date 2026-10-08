import assert from 'node:assert/strict'
import { generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AddressInfo } from 'node:net'
import Fastify from 'fastify'
import jwt from 'jsonwebtoken'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { prisma } from '../src/db/prisma.js'
import { publicPortfolioMcpHttpRouter } from '../src/mcp/portfolioHttp.js'
import { portfolioMcpOAuthMetadataRouter } from '../src/mcp/portfolioOAuthMetadata.js'
import { portfolioMcpAuthService } from '../src/services/mcp/portfolioMcpAuthService.js'
import { portfolioMcpOAuthService } from '../src/services/mcp/portfolioMcpOAuthService.js'

const checkedAt = new Date().toISOString()
const envKeys = [
  'FAMS_MCP_OAUTH_ENABLED',
  'FAMS_MCP_PUBLIC_BASE_URL',
  'FAMS_MCP_OAUTH_ISSUER',
  'FAMS_MCP_OAUTH_AUDIENCE',
  'FAMS_MCP_OAUTH_JWKS_URI',
  'FAMS_MCP_OAUTH_USER_ID_CLAIM',
  'FAMS_MCP_ALLOWED_ORIGINS',
  'FAMS_MCP_RATE_LIMIT_PER_MINUTE',
] as const
const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]))

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'fams-test-key', alg: 'RS256', use: 'sig' }
const wrongKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
const issuer = 'https://issuer.example.test'
const audience = 'https://mcp.example.test/mcp'

function initializeBody(id: number) {
  return JSON.stringify({
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'fams-oauth-resource-server-test', version: '1.0.0' },
    },
  })
}

function signToken(input: {
  issuer?: string
  audience?: string
  scope?: string
  userId?: string
  expiresIn?: number
  key?: typeof privateKey
}) {
  return jwt.sign({
    fams_user_id: input.userId ?? 'default',
    scope: input.scope ?? 'portfolio:read',
  }, input.key || privateKey, {
    algorithm: 'RS256',
    keyid: 'fams-test-key',
    subject: `oauth-user-${randomUUID()}`,
    issuer: input.issuer ?? issuer,
    audience: input.audience ?? audience,
    expiresIn: input.expiresIn ?? 300,
  })
}

const jwksApp = Fastify({ logger: false })
jwksApp.get('/jwks', async () => ({ keys: [jwk] }))
await jwksApp.listen({ host: '127.0.0.1', port: 0 })
const jwksAddress = jwksApp.server.address() as AddressInfo
const jwksUri = `http://127.0.0.1:${jwksAddress.port}/jwks`

process.env.FAMS_MCP_OAUTH_ENABLED = 'true'
process.env.FAMS_MCP_PUBLIC_BASE_URL = 'https://mcp.example.test'
process.env.FAMS_MCP_OAUTH_ISSUER = issuer
process.env.FAMS_MCP_OAUTH_AUDIENCE = audience
process.env.FAMS_MCP_OAUTH_JWKS_URI = jwksUri
process.env.FAMS_MCP_OAUTH_USER_ID_CLAIM = 'fams_user_id'
process.env.FAMS_MCP_ALLOWED_ORIGINS = 'https://chatgpt.com'
process.env.FAMS_MCP_RATE_LIMIT_PER_MINUTE = '100'

const app = Fastify({ logger: false })
await app.register(portfolioMcpOAuthMetadataRouter)
await app.register(publicPortfolioMcpHttpRouter, { prefix: '/mcp' })
await app.listen({ host: '127.0.0.1', port: 0 })
const address = app.server.address() as AddressInfo
const baseUrl = `http://127.0.0.1:${address.port}`
const endpoint = `${baseUrl}/mcp`
let localTokenId: string | null = null

try {
  const metadataResponse = await fetch(`${baseUrl}/.well-known/oauth-protected-resource/mcp`)
  assert.equal(metadataResponse.status, 200)
  assert.equal(metadataResponse.headers.get('access-control-allow-origin'), '*')
  const metadata = await metadataResponse.json() as any
  assert.equal(metadata.resource, audience)
  assert.deepEqual(metadata.authorization_servers, [issuer])
  assert(metadata.scopes_supported.includes('portfolio:read'))
  assert.deepEqual(metadata.bearer_methods_supported, ['header'])

  const noToken = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: initializeBody(1),
  })
  assert.equal(noToken.status, 401)
  assert.match(noToken.headers.get('www-authenticate') || '', /resource_metadata="https:\/\/mcp\.example\.test\/\.well-known\/oauth-protected-resource\/mcp"/)

  const malformedOpaqueToken = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: 'Bearer malformed-local-token',
      origin: 'https://chatgpt.com',
      'content-type': 'application/json',
    },
    body: initializeBody(2),
  })
  assert.equal(malformedOpaqueToken.status, 401, 'Unknown non-JWT bearer tokens must remain authentication failures, not OAuth configuration errors')

  const rawCases = [
    { id: 'wrong_issuer', token: signToken({ issuer: 'https://wrong.example.test' }), expected: 401 },
    { id: 'wrong_audience', token: signToken({ audience: 'https://wrong.example.test/mcp' }), expected: 401 },
    { id: 'wrong_signature', token: signToken({ key: wrongKey }), expected: 401 },
    { id: 'expired', token: signToken({ expiresIn: -10 }), expected: 401 },
    { id: 'missing_scope', token: signToken({ scope: 'unrelated:read' }), expected: 403 },
  ]
  for (const [index, item] of rawCases.entries()) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${item.token}`,
        origin: 'https://chatgpt.com',
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
      },
      body: initializeBody(10 + index),
    })
    assert.equal(response.status, item.expected, `${item.id} should return ${item.expected}`)
    assert.match(response.headers.get('www-authenticate') || '', /resource_metadata=/)
  }

  const validToken = signToken({})
  const client = new Client({ name: 'fams-oauth-resource-server-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: {
      headers: {
        authorization: `Bearer ${validToken}`,
        origin: 'https://chatgpt.com',
      },
    },
  }))
  const listed = await client.listTools()
  assert.equal(listed.tools.length, 10)
  assert.equal(listed.tools.some((tool) => /order|broker/i.test(tool.name)), false)
  const current = await client.callTool({ name: 'portfolio_get_current_state', arguments: { accountScope: 'all' } })
  assert.notEqual(current.isError, true)
  assert.ok(Number((current.structuredContent as any)?.positionCount) > 0)
  assert.equal((current.structuredContent as any)?.executionBoundary?.formalTradingUnlocked, false)
  await client.close()

  const issued = await portfolioMcpAuthService.createToken({
    userId: 'default',
    name: `oauth-compatibility-${Date.now()}`,
    scopes: ['portfolio:read'],
    expiresAt: new Date(Date.now() + 5 * 60_000),
  })
  localTokenId = issued.id
  const localPrincipal = await portfolioMcpAuthService.authenticateHttpBearer(`Bearer ${issued.token}`)
  assert.equal(localPrincipal.authType, 'local_opaque_token')
  const oauthPrincipal = await portfolioMcpAuthService.authenticateHttpBearer(`Bearer ${validToken}`)
  assert.equal(oauthPrincipal.authType, 'oauth_jwt')

  const localReadiness = portfolioMcpOAuthService.readiness()
  assert.equal(localReadiness.oauthResourceServerCodeReady, true)
  assert.equal(localReadiness.oauthConfigurationPresent, true)
  assert.equal(localReadiness.oauthConfigurationPreflightReady, false, 'Loopback HTTP JWKS must not pass public preflight')
  assert.equal(localReadiness.externalHttpsDeploymentVerified, false)
  assert.equal(localReadiness.publicInternetReleaseReady, false)

  process.env.FAMS_MCP_OAUTH_JWKS_URI = 'https://issuer.example.test/jwks'
  const httpsConfigurationReadiness = portfolioMcpOAuthService.readiness()
  assert.equal(httpsConfigurationReadiness.oauthConfigurationPreflightReady, true)
  assert.equal(httpsConfigurationReadiness.externalHttpsDeploymentVerified, false)
  assert.equal(httpsConfigurationReadiness.publicInternetReleaseReady, false)
  process.env.FAMS_MCP_OAUTH_JWKS_URI = jwksUri

  const audit = {
    schemaVersion: 'fams.portfolio_mcp.oauth_resource_server.verification.v1',
    status: 'passed',
    checkedAt,
    metadata,
    validJwtReadOnlyMcpCallPassed: true,
    realPortfolioPositionCount: (current.structuredContent as any)?.positionCount,
    rejectedCases: rawCases.map(({ id, expected }) => ({ id, expectedStatus: expected })),
    localOpaqueTokenCompatibilityPassed: true,
    principalTypesSeparated: true,
    loopbackPreflight: localReadiness,
    httpsConfigurationPreflight: httpsConfigurationReadiness,
    externalHttpsDeploymentVerified: false,
    publicInternetReleaseReady: false,
    brokerOrderToolsExposed: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const dir = resolve(process.cwd(), 'data', 'gpt-audit', 'portfolio-mcp-oauth', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(dir, { recursive: true })
  const auditPath = resolve(dir, 'portfolio_mcp_oauth_resource_server_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  process.stdout.write(`${JSON.stringify({ ...audit, auditPath }, null, 2)}\n`)
} finally {
  if (localTokenId) await prisma.mcpAccessToken.deleteMany({ where: { id: localTokenId } }).catch(() => undefined)
  await app.close().catch(() => undefined)
  await jwksApp.close().catch(() => undefined)
  await prisma.$disconnect().catch(() => undefined)
  for (const key of envKeys) {
    const value = originalEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}
