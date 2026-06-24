/**
 * FAMS MCP HTTP Bridge
 *
 * HTTP route 只负责传输层；工具契约、manifest 和 handler 由 registry 统一提供，
 * 便于后续 stdio MCP provider 复用同一套能力。
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  buildDomainPackManifest,
  callMcpBatch,
  callMcpTool,
  listMcpTools,
  McpCallContext,
} from './registry.js'

const firstHeader = (value: string | string[] | undefined) => (
  Array.isArray(value) ? value[0] : value
)

const resolveHttpCallContext = (request: FastifyRequest): McpCallContext => {
  const headerUserId = firstHeader(request.headers['x-fams-user-id'] as string | string[] | undefined)
    || firstHeader(request.headers['x-user-id'] as string | string[] | undefined)

  return {
    requestId: request.id,
    transport: 'http',
    userId: headerUserId,
    userContextSource: headerUserId ? 'http_header' : undefined,
  }
}

export async function mcpRouter(app: FastifyInstance) {
  app.get('/domain-pack', async () => buildDomainPackManifest())

  app.get('/tools', async () => listMcpTools())

  app.post('/call', async (request: FastifyRequest<{
    Body: { name: string; parameters?: Record<string, unknown> }
  }>, reply: FastifyReply) => {
    const { name, parameters } = request.body
    const result = await callMcpTool(name, parameters, resolveHttpCallContext(request))

    if (!result.success) {
      const statusCode = result.error?.code === 'TOOL_NOT_FOUND' ? 404 : 500
      return reply.status(statusCode).send(result)
    }

    return result
  })

  app.post('/batch', async (request: FastifyRequest<{
    Body: { calls: Array<{ name: string; parameters?: Record<string, unknown> }> }
  }>) => {
    return callMcpBatch(request.body.calls || [], resolveHttpCallContext(request))
  })
}
