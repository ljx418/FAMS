/** Loopback-only official MCP Streamable HTTP entrypoint for FAMS. */
import { createServer, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createFamsMcpServer, resolveMcpProfile } from './server.js'

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost'])

export function assertLoopbackHost(host: string) {
  const normalized = host.trim().toLowerCase()
  if (!LOOPBACK_HOSTS.has(normalized)) {
    throw new Error(`Refusing unauthenticated MCP bind to non-loopback host '${host}'`)
  }
  return normalized
}

function methodNotAllowed(response: ServerResponse) {
  response.writeHead(405, { 'content-type': 'application/json; charset=utf-8', allow: 'POST' })
  response.end(JSON.stringify({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Method not allowed. Use POST /mcp.' },
    id: null,
  }))
}

export function createFamsStreamableHttpServer() {
  const profile = resolveMcpProfile()
  const defaultUserId = process.env.FAMS_MCP_DEFAULT_USER_ID || 'default'
  return createServer(async (request, response) => {
    const path = new URL(request.url || '/', 'http://127.0.0.1').pathname
    if (request.method === 'GET' && path === '/health') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ status: 'ok', transport: 'streamable_http', profile }))
      return
    }
    if (path !== '/mcp') {
      response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      response.end(JSON.stringify({ error: 'not_found' }))
      return
    }
    if (request.method !== 'POST') {
      methodNotAllowed(response)
      return
    }

    const mcpServer = createFamsMcpServer({ profile, defaultUserId, transport: 'streamable_http' })
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await mcpServer.connect(transport)
      await transport.handleRequest(request, response)
    } catch (error) {
      process.stderr.write(`[fams-mcp-http] ${error instanceof Error ? error.stack || error.message : String(error)}\n`)
      if (!response.headersSent) {
        response.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        response.end(JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'Internal MCP server error' },
          id: null,
        }))
      }
    } finally {
      await transport.close().catch(() => undefined)
      await mcpServer.close().catch(() => undefined)
    }
  })
}

async function main() {
  const host = assertLoopbackHost(process.env.FAMS_MCP_HTTP_HOST || '127.0.0.1')
  const rawPort = process.env.FAMS_MCP_HTTP_PORT || '4010'
  const port = Number(rawPort)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`Invalid FAMS_MCP_HTTP_PORT '${rawPort}'`)
  const server = createFamsStreamableHttpServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })
  process.stderr.write(`[fams-mcp-http] listening on http://${host}:${port}/mcp\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`[fams-mcp-http] ${error instanceof Error ? error.stack || error.message : String(error)}\n`)
    process.exitCode = 1
  })
}
