/**
 * Fund Routes - 基金API路由
 *
 * 端点：
 * - GET /api/v1/fund/history/:code - 获取基金历史净值
 * - GET /api/v1/fund/realtime/:code - 获取基金实时估值
 * - GET /api/v1/fund/holdings/:code - 获取基金持仓明细
 * - GET /api/v1/fund/holdings-realtime/:code - 获取基金持仓实时估算
 */

import { FastifyInstance } from 'fastify'
import {
  getFundRealtime,
  getFundHistory,
  getFundHoldings,
  getHoldingStockRealtime,
  type FundHistoryRecord,
} from '../utils/fundUtils.js'
import { prisma } from '../db/prisma.js'

export async function fundRoutes(app: FastifyInstance) {
  /**
   * 获取基金实时估值（快捷路由）
   * GET /api/v1/fund/:code
   */
  app.get('/:code', async (request, reply) => {
    const { code } = request.params as { code: string }
    // 重定向到 realtime 路由
    const fundData = await getFundRealtime(code)

    if (!fundData) {
      return reply.status(404).send({ error: `无法获取基金 ${code} 的实时数据` })
    }

    return {
      fundCode: code,
      name: fundData.name,
      price: fundData.price,
      priceChange: fundData.priceChange,
      priceChangePercent: fundData.priceChangePercent,
      updateTime: fundData.gztime,
      source: fundData.source,
    }
  })

  /**
   * 获取基金历史净值
   * GET /api/v1/fund/history/:code?period=1M
   */
  app.get('/history/:code', async (request) => {
    const { code } = request.params as { code: string }
    const { period } = request.query as { period?: string }

    // 验证period参数
    const validPeriods = ['1M', '6M', '1Y', '3Y']
    const p = validPeriods.includes(period || '') ? period : '1M'

    return getFundHistory(code, p as '1M' | '6M' | '1Y' | '3Y')
  })

  /**
   * 获取基金实时估值和基本信息
   * GET /api/v1/fund/realtime/:code
   */
  app.get('/realtime/:code', async (request) => {
    const { code } = request.params as { code: string }
    const fundData = await getFundRealtime(code)

    if (!fundData) {
      return { error: `无法获取基金 ${code} 的实时数据` }
    }

    return {
      fundCode: code,
      name: fundData.name,
      price: fundData.price,
      priceChange: fundData.priceChange,
      priceChangePercent: fundData.priceChangePercent,
      updateTime: fundData.gztime,
      source: fundData.source,
    }
  })

  /**
   * 获取基金持仓明细
   * GET /api/v1/fund/holdings/:code
   */
  app.get('/holdings/:code', async (request) => {
    const { code } = request.params as { code: string }
    return getFundHoldings(code)
  })

  /**
   * 获取基金持仓实时估算涨跌幅
   * GET /api/v1/fund/holdings-realtime/:code
   *
   * 基于持仓股票实时涨跌计算基金实时估算涨跌幅
   */
  app.get('/holdings-realtime/:code', async (request, reply) => {
    const { code } = request.params as { code: string }

    try {
      // 1. 获取基金持仓明细
      const holdingsData = await getFundHoldings(code)

      if (!holdingsData || !holdingsData.holdings || holdingsData.holdings.length === 0) {
        return reply.status(404).send({ error: '无法获取基金持仓数据' })
      }

      // 2. 获取每只持仓股票的实时价格
      const holdingsWithPrice = await Promise.all(
        holdingsData.holdings.map(async (holding) => {
          try {
            const priceData = await getHoldingStockRealtime(holding.stockCode)
            return {
              stockCode: holding.stockCode,
              stockName: holding.stockName,
              proportion: holding.proportion,
              currentPrice: priceData.price,
              priceChange: priceData.priceChange,
              priceChangePercent: priceData.priceChangePercent,
            }
          } catch (error) {
            // 如果某只股票获取价格失败，返回默认值
            return {
              stockCode: holding.stockCode,
              stockName: holding.stockName,
              proportion: holding.proportion,
              currentPrice: 0,
              priceChange: 0,
              priceChangePercent: 0,
            }
          }
        })
      )

      // 3. 计算估算涨跌幅 (Σ proportion * priceChangePercent)
      const estimatedChange = holdingsWithPrice.reduce(
        (sum, h) => sum + (h.proportion * h.priceChangePercent) / 100,
        0
      )

      // 4. 获取基金实际涨跌幅
      const fundData = await getFundRealtime(code)
      const actualChange = fundData?.priceChangePercent ?? 0

      return {
        fundCode: code,
        holdings: holdingsWithPrice,
        estimatedChange: Math.round(estimatedChange * 100) / 100,
        actualChange: Math.round(actualChange * 100) / 100,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return reply.status(500).send({ error: message })
    }
  })

  /**
   * 查询持有指定股票的基金列表（来自用户自选基金）
   * GET /api/v1/fund/by-stock/:stockCode?period=1M
   */
  app.get('/by-stock/:stockCode', async (request) => {
    const { stockCode } = request.params as { stockCode: string }
    const { period } = request.query as { period?: string }
    const { userId } = request.query as { userId?: string }
    const p = (['1M', '6M', '1Y', '3Y'].includes(period || '')) ? period as '1M' | '6M' | '1Y' | '3Y' : '1M'
    const uid = userId || 'default'

    // 获取用户所有的基金持仓
    const fundPositions = await prisma.position.findMany({
      where: { userId: uid, status: 'open', asset: { type: 'fund' } },
      include: { asset: true },
    })

    if (fundPositions.length === 0) {
      return { funds: [], trends: {} }
    }

    // 逐个检查哪些基金的持仓中包含该股票
    const fundCodes = fundPositions.map(fp => fp.asset.symbol)
    const holdingsResults = await Promise.allSettled(
      fundCodes.map(async (code) => {
        const holdings = await getFundHoldings(code)
        const holding = holdings.holdings.find(h => h.stockCode === stockCode)
        if (!holding) return null
        const history = await getFundHistory(code, p)
        const changePercent = history.records.length >= 2
          ? ((history.records[history.records.length - 1].nav - history.records[0].nav) / history.records[0].nav) * 100
          : 0
        return {
          fundCode: code,
          fundName: holdings.fundName,
          reportDate: holdings.reportDate,
          proportion: holding.proportion,
          changePercent,
          historyRecords: history.records,
        }
      })
    )

    const matched = holdingsResults
      .filter((r): r is PromiseFulfilledResult<{
        fundCode: string
        fundName: string
        reportDate: string
        proportion: number
        changePercent: number
        historyRecords: FundHistoryRecord[]
      }> => r.status === 'fulfilled' && r.value !== null)
      .map((r) => r.value)

    return {
      stockCode,
      matchedFunds: matched.length,
      funds: matched.map(f => ({
        fundCode: f.fundCode,
        fundName: f.fundName,
        reportDate: f.reportDate,
        proportion: f.proportion,
        changePercent: Math.round(f.changePercent * 100) / 100,
      })),
      trends: matched.reduce((acc, f) => {
        acc[f.fundCode] = f.historyRecords
        return acc
      }, {} as Record<string, typeof matched[0]['historyRecords']>),
    }
  })
}
