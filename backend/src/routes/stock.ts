/**
 * Stock Routes - 股票分析API路由
 *
 * 端点：
 * - GET /api/v1/stocks/:code - 获取股票完整分析
 * - GET /api/v1/stocks/:code/trend - 获取真实最新价、收盘历史和 MA5/MA10/MA30
 * - GET /api/v1/stocks/:code/indicators - 仅获取技术指标
 */

import { FastifyInstance } from 'fastify'
import { stockAnalysisService } from '../services/technical/stockAnalysisService.js'
import { stockMarketTrendService } from '../services/technical/stockMarketTrendService.js'

export async function stockRoutes(app: FastifyInstance) {
  // 最新价、完整收盘价和 MA5/MA10/MA30。盘中K线不会混入收盘均线。
  app.get<{ Params: { code: string }; Querystring: { days?: number } }>(
    '/:code/trend',
    async (request, reply) => {
      const { code } = request.params
      const days = Number(request.query.days || 30)
      if (!/^\d{6}$/.test(code)) {
        return reply.status(400).send({ error: 'code must be a 6-digit A-share or exchange-traded fund symbol' })
      }
      if (!Number.isFinite(days) || days < 30 || days > 120) {
        return reply.status(400).send({ error: 'days must be a number between 30 and 120' })
      }

      try {
        return await stockMarketTrendService.getSnapshot(code, days)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error'
        return reply.status(502).send({ error: message })
      }
    }
  )

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
