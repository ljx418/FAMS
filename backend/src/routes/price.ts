import { FastifyInstance } from 'fastify'
import { priceService } from '../services/price/priceService.js'
import { marketDataService } from '../services/market-data/marketDataService.js'
import { assetIdentityResolver } from '../services/asset/assetIdentityResolver.js'

export async function priceRoutes(app: FastifyInstance) {
  app.get('/providers', async () => {
    return marketDataService.listProviders()
  })

  // 获取实时价格
  app.get('/realtime', async (request) => {
    const { symbol, source, assetType } = request.query as any
    if (!symbol) {
      throw new Error('symbol is required')
    }
    const identity = await assetIdentityResolver.resolve(String(symbol))
    if (!assetType && identity.assetType === 'unknown') {
      return {
        symbol,
        price: null,
        isValid: false,
        source: null,
        identity,
        warnings: identity.warnings,
      }
    }
    try {
      const quote = await Promise.race([
        marketDataService.getQuote({
          symbol: identity.normalizedSymbol,
          source: source || 'auto',
          assetType: assetType || identity.assetType,
        }),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('Realtime quote request timed out after 10 seconds')), 10000)
        }),
      ])
      return {
        ...quote,
        identity,
        warnings: [...new Set([...(quote.warnings || []), ...(identity.warnings || [])])],
      }
    } catch (error) {
      return {
        symbol: identity.normalizedSymbol,
        name: identity.name,
        assetType: assetType || identity.assetType,
        price: identity.matchedAsset?.lastPrice ?? null,
        currency: identity.currency,
        timestamp: identity.matchedAsset?.lastUpdated ?? null,
        source: identity.matchedAsset?.lastPrice ? 'local_last_price' : null,
        sourceLabel: identity.matchedAsset?.lastPrice ? '本地最近价格' : null,
        isValid: false,
        confidenceScore: identity.matchedAsset?.lastPrice ? 0.45 : 0.1,
        fallbackUsed: Boolean(identity.matchedAsset?.lastPrice),
        identity,
        warnings: [
          ...(identity.warnings || []),
          error instanceof Error ? error.message : 'Realtime quote request failed',
          identity.matchedAsset?.lastPrice ? '实时行情失败，已回退到本地最近价格。' : '实时行情失败，且本地没有可用最近价格。',
        ],
      }
    }
  })

  // 批量获取价格
  app.post('/batch', async (request) => {
    const { symbols } = request.body as any
    return priceService.getBatchPrices(symbols)
  })

  // 刷新资产价格，写回 Asset.lastPrice / PriceHistory，并返回来源和警告
  app.post('/refresh', async (request) => {
    const { assetIds, symbols, userId } = request.body as any
    return marketDataService.refreshAssetMarketData({ assetIds, symbols, userId })
  })

  // 获取价格历史
  app.get('/history/:assetId', async (request) => {
    const { assetId } = request.params as any
    const { startDate, endDate } = request.query as any
    return priceService.getPriceHistory(assetId, new Date(startDate), new Date(endDate))
  })

  // 获取金价（三源交叉验证）
  app.get('/gold', async () => {
    return priceService.getGoldPrice()
  })
}
