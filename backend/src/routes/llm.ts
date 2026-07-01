/**
 * LLM Routes - 基于大语言模型的股票分析API
 *
 * 端点：
 * - POST /api/v1/llm/stock-advice - 获取股票 AI 事实观察
 */

import { FastifyInstance } from 'fastify'
import { llmService } from '../services/llm/llmService.js'
import { assetIdentityResolver } from '../services/asset/assetIdentityResolver.js'
import { getFamsLlmPublicStatus } from '../config/llmConfig.js'

export async function llmRoutes(app: FastifyInstance) {
  app.get('/status', async () => {
    return getFamsLlmPublicStatus()
  })

  // 获取股票 AI 事实观察
  app.post<{
    Body: { symbol: string; market?: string }
  }>(
    '/stock-advice',
    async (request, reply) => {
      const { symbol, market = 'A股' } = request.body

      if (!symbol) {
        return reply.status(400).send({ error: '股票代码不能为空' })
      }

      try {
        const identity = await assetIdentityResolver.resolve(symbol)
        if (identity.assetType !== 'stock' || identity.market !== 'CN') {
          return reply.status(400).send({
            error: 'AI股票分析仅支持已识别为 A 股股票的标的',
            identity,
            warnings: [
              ...identity.warnings,
              '请使用统一标的研究入口分析 ETF、基金、债券或板块。',
            ],
          })
        }

        const advice = await llmService.generateStockAdvice(identity.normalizedSymbol, market)
        return {
          ...advice,
          identity,
        }
      } catch (error: any) {
        console.error('LLM 股票分析错误:', error.message)
        return reply.status(500).send({
          error: error.message || 'AI 分析失败'
        })
      }
    }
  )
}
