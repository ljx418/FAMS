import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createPublicPortfolioMcpServer } from './publicPortfolioServer.js'
import { portfolioMcpAuthService } from '../services/mcp/portfolioMcpAuthService.js'

const firstHeader = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value

const configuredOrigins = () => new Set(String(process.env.FAMS_MCP_ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean))

const jsonRpcError = (reply: FastifyReply, statusCode: number, code: number, message: string) => reply
  .code(statusCode)
  .send({ jsonrpc: '2.0', id: null, error: { code, message } })

const validateOrigin = (request: FastifyRequest) => {
  const origin = firstHeader(request.headers.origin as string | string[] | undefined)
  if (!origin) return true
  return configuredOrigins().has(origin)
}

export async function publicPortfolioMcpHttpRouter(app: FastifyInstance) {
  app.get('/', async (_request, reply) => jsonRpcError(reply, 405, -32000, 'Method not allowed for stateless MCP transport'))
  app.delete('/', async (_request, reply) => jsonRpcError(reply, 405, -32000, 'Method not allowed for stateless MCP transport'))

  app.post('/', { bodyLimit: 14 * 1024 * 1024 }, async (request, reply) => {
    if (!validateOrigin(request)) return jsonRpcError(reply, 403, -32001, 'MCP origin is not allowed')

    let principal
    try {
      const authorization = firstHeader(request.headers.authorization as string | string[] | undefined)
      principal = await portfolioMcpAuthService.authenticateBearer(authorization)
      portfolioMcpAuthService.assertRateLimit(principal)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'MCP authentication failed'
      const status = message === 'MCP_RATE_LIMIT_EXCEEDED' ? 429 : 401
      return jsonRpcError(reply, status, -32002, message)
    }

    const server = createPublicPortfolioMcpServer(principal)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    try {
      await server.connect(transport)
      reply.hijack()
      reply.raw.once('close', () => {
        void transport.close().catch(() => undefined)
        void server.close().catch(() => undefined)
      })
      await transport.handleRequest(request.raw, reply.raw, request.body)
      return reply
    } catch {
      await transport.close().catch(() => undefined)
      await server.close().catch(() => undefined)
      if (!reply.raw.headersSent) return jsonRpcError(reply, 500, -32603, 'Internal MCP server error')
      reply.raw.end()
      return reply
    }
  })
}
