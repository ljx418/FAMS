import { prisma } from '../../db/prisma.js'
import { assetIdentityResolver } from '../asset/assetIdentityResolver.js'
import { marketDataService } from './marketDataService.js'
import {
  buildStockMarketTrendSnapshot,
  stockMarketTrendService,
  type StockMarketTrendSnapshot,
} from '../technical/stockMarketTrendService.js'
import type { StockHistoryData, StockRealtimeData } from '../../utils/stockUtils.js'

export interface AssetTrendRequest {
  assetId?: string
  symbol?: string
  days?: number
  persist?: boolean
}

export interface AssetTrendSnapshot extends Omit<StockMarketTrendSnapshot, 'schemaVersion' | 'currency'> {
  schemaVersion: 'asset.market-trend.v1'
  assetId: string | null
  assetType: string
  currency: string
  chart: Array<{
    date: string
    close: number
    ma5: number | null
    ma10: number | null
    ma30: number | null
  }>
  dataQuality: {
    status: 'ok' | 'partial' | 'insufficient'
    persistedHistory: boolean
    completedBarCount: number
    historyAdjustment: 'none' | 'qfq' | 'mixed'
    realtimePriceAvailable: boolean
    realtimePriceFresh: boolean
    warnings: string[]
  }
}

const averageAt = (values: number[], endIndex: number, period: number) => {
  const start = endIndex - period + 1
  if (start < 0) return null
  const slice = values.slice(start, endIndex + 1)
  return Number((slice.reduce((sum, value) => sum + value, 0) / period).toFixed(4))
}

const asDate = (value: Date) => value.toISOString().slice(0, 10)

class AssetTrendService {
  private async resolveAsset(input: AssetTrendRequest) {
    if (input.assetId) {
      const asset = await prisma.asset.findUnique({ where: { id: input.assetId } })
      if (!asset) throw new Error('Asset not found')
      return asset
    }
    if (!input.symbol?.trim()) throw new Error('assetId or symbol is required')
    const identity = await assetIdentityResolver.resolve(input.symbol)
    return identity.matchedAsset || prisma.asset.findUnique({ where: { symbol: identity.normalizedSymbol } })
  }

  private async loadLocalHistory(assetId: string | null, symbol: string, market: string, take: number): Promise<StockHistoryData[]> {
    const qfq = await prisma.marketBarCanonical.findMany({
      where: { symbol, market, timeframe: '1d', adjustType: 'qfq', dataVersion: 'canonical.v1' },
      orderBy: { tradeDate: 'desc' }, take,
    })
    const canonical = qfq.length >= 30 ? qfq : await prisma.marketBarCanonical.findMany({
      where: { symbol, market, timeframe: '1d', adjustType: 'none', dataVersion: 'canonical.v1' },
      orderBy: { tradeDate: 'desc' }, take,
    })
    if (canonical.length >= 30) {
      return canonical.reverse().map((bar) => ({
        date: asDate(bar.tradeDate),
        open: bar.openPrice ?? bar.closePrice,
        high: bar.highPrice ?? bar.closePrice,
        low: bar.lowPrice ?? bar.closePrice,
        close: bar.closePrice,
        volume: bar.volume ?? 0,
        source: bar.primaryProvider || 'market_bar_canonical',
        adjustType: bar.adjustType === 'qfq' ? 'qfq' : 'none',
      }))
    }
    if (!assetId) return []
    const legacy = await prisma.priceHistory.findMany({
      where: { assetId, isValid: true },
      orderBy: { timestamp: 'desc' },
      take,
    })
    return legacy.reverse().map((bar) => ({
      date: asDate(bar.timestamp),
      open: bar.openPrice ?? bar.closePrice,
      high: bar.highPrice ?? bar.closePrice,
      low: bar.lowPrice ?? bar.closePrice,
      close: bar.closePrice,
      volume: bar.volume ?? 0,
      source: bar.source || 'price_history',
      adjustType: 'none',
    }))
  }

  private async quote(symbol: string, assetType: string): Promise<StockRealtimeData | null> {
    const quote = await marketDataService.getQuote({ symbol, assetType, source: 'auto' }).catch(() => null)
    if (!quote?.price || quote.price <= 0) return null
    return {
      symbol,
      name: quote.name || symbol,
      price: quote.price,
      priceChange: quote.priceChange || 0,
      priceChangePercent: quote.priceChangePercent || 0,
      timestamp: quote.timestamp ? new Date(quote.timestamp) : new Date(),
      source: quote.source || 'market_data_service',
    }
  }

  private async persistHistory(assetId: string | null, symbol: string, market: string, snapshot: StockMarketTrendSnapshot) {
    await prisma.$transaction(snapshot.history.map((bar) => prisma.marketBarCanonical.upsert({
      where: {
        symbol_market_tradeDate_adjustType_dataVersion: {
          symbol,
          market,
          tradeDate: new Date(`${bar.date}T00:00:00.000Z`),
          adjustType: bar.adjustType === 'qfq' ? 'qfq' : 'none',
          dataVersion: 'canonical.v1',
        },
      },
      create: {
        assetId,
        symbol,
        market,
        timeframe: '1d',
        tradeDate: new Date(`${bar.date}T00:00:00.000Z`),
        adjustType: bar.adjustType === 'qfq' ? 'qfq' : 'none',
        openPrice: bar.open,
        highPrice: bar.high,
        lowPrice: bar.low,
        closePrice: bar.close,
        volume: bar.volume,
        primaryProvider: bar.source,
        sourceRefsJson: JSON.stringify([`${bar.source}:${symbol}:${bar.date}`]),
        confidence: 0.75,
        validationStatus: 'valid',
        dataVersion: 'canonical.v1',
      },
      update: {
        assetId,
        openPrice: bar.open,
        highPrice: bar.high,
        lowPrice: bar.low,
        closePrice: bar.close,
        volume: bar.volume,
        primaryProvider: bar.source,
        sourceRefsJson: JSON.stringify([`${bar.source}:${symbol}:${bar.date}`]),
        validationStatus: 'valid',
      },
    })))
  }

  private enrich(
    snapshot: StockMarketTrendSnapshot,
    asset: { id: string; type: string; currency: string } | null,
    persistedHistory: boolean,
  ): AssetTrendSnapshot {
    const closes = snapshot.history.map((bar) => bar.close)
    const warmup = Math.max(0, snapshot.history.length - snapshot.requestedTradingDays)
    const chart = snapshot.history.map((bar, index) => ({
      date: bar.date,
      close: bar.close,
      ma5: averageAt(closes, index, 5),
      ma10: averageAt(closes, index, 10),
      ma30: averageAt(closes, index, 30),
    })).slice(warmup)
    const adjustments = new Set(snapshot.history.map((bar) => bar.adjustType || 'none'))
    const historyAdjustment = adjustments.size > 1 ? 'mixed' : adjustments.has('qfq') ? 'qfq' : 'none'
    const warnings = [...snapshot.warnings]
    if (historyAdjustment !== 'qfq' && ['stock', 'etf'].includes(asset?.type || 'stock')) {
      warnings.push('完整日线未能确认前复权口径；均线只可作为降级参考。')
    }
    return {
      ...snapshot,
      schemaVersion: 'asset.market-trend.v1',
      assetId: asset?.id || null,
      assetType: asset?.type || 'stock',
      currency: asset?.currency || snapshot.currency,
      chart,
      dataQuality: {
        status: snapshot.quote.fallbackUsed || warnings.length > 0 ? 'partial' : 'ok',
        persistedHistory,
        completedBarCount: snapshot.indicators.sampleCount,
        historyAdjustment,
        realtimePriceAvailable: !snapshot.quote.fallbackUsed,
        realtimePriceFresh: snapshot.quote.freshnessStatus === 'fresh',
        warnings,
      },
    }
  }

  async getSnapshot(input: AssetTrendRequest): Promise<AssetTrendSnapshot> {
    const days = Math.min(120, Math.max(30, Math.floor(input.days || 30)))
    const asset = await this.resolveAsset(input)
    const identity = asset ? null : await assetIdentityResolver.resolve(String(input.symbol))
    const symbol = asset?.symbol || identity?.normalizedSymbol || String(input.symbol)
    const assetType = asset?.type || identity?.assetType || 'stock'
    const market = asset?.exchange === 'HK' || identity?.market === 'HK'
      ? 'HK'
      : asset?.exchange === 'US' || identity?.market === 'US'
        ? 'US'
        : 'CN'
    if (assetType === 'cash') throw new Error('Cash assets do not have market trend history')

    let snapshot: StockMarketTrendSnapshot
    const localHistory = await this.loadLocalHistory(asset?.id || null, symbol, market, days + 45)
    const canFetchFreshChinaSeries = market === 'CN' && ['stock', 'etf'].includes(assetType) && /^\d{6}$/.test(symbol)
    if (canFetchFreshChinaSeries) {
      snapshot = await stockMarketTrendService.getSnapshot(symbol, days).catch(async (error) => {
        if (localHistory.length < days) throw error
        const fallback = buildStockMarketTrendSnapshot({
          symbol,
          name: asset?.name || identity?.name,
          requestedTradingDays: days,
          history: localHistory,
          realtime: await this.quote(symbol, assetType),
        })
        fallback.warnings.push(`实时日线刷新失败，使用本地缓存：${error instanceof Error ? error.message : String(error)}`)
        return fallback
      })
    } else if (localHistory.length >= days) {
      snapshot = buildStockMarketTrendSnapshot({
        symbol,
        name: asset?.name || identity?.name,
        requestedTradingDays: days,
        history: localHistory,
        realtime: await this.quote(symbol, assetType),
      })
    } else {
      throw new Error(`Historical data is insufficient for ${symbol}: ${localHistory.length} completed bars`)
    }

    let persistedHistory = false
    if (input.persist !== false) {
      await this.persistHistory(asset?.id || null, symbol, market, snapshot)
      persistedHistory = true
    }
    return this.enrich(snapshot, asset ? { id: asset.id, type: asset.type, currency: asset.currency } : null, persistedHistory)
  }
}

export const assetTrendService = new AssetTrendService()
