import { FastifyInstance } from 'fastify'
import { portfolioService } from '../services/portfolio/portfolioService.js'

export async function portfolioRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const { userId } = request.query as any
    return portfolioService.getPortfolios(userId)
  })

  app.post('/', async (request) => {
    const body = request.body as any
    return portfolioService.createPortfolio(body.userId, body)
  })

  app.get('/analysis', async (request) => {
    const { userId, portfolioId } = request.query as any
    return portfolioService.getAnalysis(userId, portfolioId)
  })
}
