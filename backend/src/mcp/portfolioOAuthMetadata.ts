import type { FastifyInstance, FastifyReply } from 'fastify'
import { PortfolioMcpOAuthError, portfolioMcpOAuthService } from '../services/mcp/portfolioMcpOAuthService.js'

export async function portfolioMcpOAuthMetadataRouter(app: FastifyInstance) {
  const metadataHandler = async (_request: unknown, reply: FastifyReply) => {
    try {
      reply.header('Access-Control-Allow-Origin', '*')
      reply.header('Cache-Control', 'public, max-age=300')
      return portfolioMcpOAuthService.protectedResourceMetadata()
    } catch (error) {
      const status = error instanceof PortfolioMcpOAuthError ? error.statusCode : 503
      return reply.code(status).send({ error: 'oauth_resource_metadata_unavailable' })
    }
  }
  app.get('/.well-known/oauth-protected-resource', metadataHandler)
  app.get('/.well-known/oauth-protected-resource/mcp', metadataHandler)
  app.get('/api/v1/mcp/public-release-readiness', async () => portfolioMcpOAuthService.readiness())
}
