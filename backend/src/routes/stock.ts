/**
 * Stock Routes - 股票分析API路由
 *
 * 端点：
 * - GET /api/v1/stocks/:code - 获取股票完整分析
 * - GET /api/v1/stocks/:code/indicators - 仅获取技术指标
 */

import { FastifyInstance } from 'fastify'
import { stockAnalysisService } from '../services/technical/stockAnalysisService.js'

export async function stockRoutes(app: FastifyInstance) {
  // 获取股票完整分析
  app.get<{ Params: { code: string }; Querystring: { market?: string; days?: number; forceRefresh?: string } }>(
    '/:code',
    async (request, reply) => {
      const { code } = request.params
      const { market = 'A股', days = 30, forceRefresh } = request.query

      try {
        const analysis = await stockAnalysisService.getFullAnalysis(
          code,
          market,
          days,
          { forceRefresh: forceRefresh === 'true' }
        )
        return analysis
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return reply.status(500).send({ error: message })
      }
    }
  )

  // 仅获取技术指标
  app.get<{ Params: { code: string }; Querystring: { market?: string; days?: number } }>(
    '/:code/indicators',
    async (request, reply) => {
      const { code } = request.params
      const { market = 'A股', days = 30 } = request.query

      try {
        const indicators = await stockAnalysisService.getIndicatorsOnly(
          code,
          market,
          days
        )
        return indicators
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return reply.status(500).send({ error: message })
      }
    }
  )
}
