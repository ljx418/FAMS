import { prisma } from '../../db/prisma.js'
import { marketBarCacheService } from '../market-data/marketBarCacheService.js'

export interface PortfolioProxyCoverageItem {
  symbol: string
  requestedDays: number
  minRequiredBars: number
  cachedBarsBefore: number
  cachedBarsAfter: number
  latestTradeDate: string | null
  coverageStatus: 'ready' | 'partial' | 'insufficient'
  freshnessStatus: 'fresh' | 'stale' | 'unknown'
  sourceProvider: string
  sourceEndpoint: string
  fetchedAt: string
  evidenceRefs: string[]
  warnings: string[]
}

export interface PortfolioProxyCoverageReport {
  schemaVersion: 'portfolio.proxy_market_data_coverage.v1'
  generatedAt: string
  minRequiredBars: number
  requestedDays: number
  status: 'ready' | 'partial' | 'insufficient'
  items: PortfolioProxyCoverageItem[]
  blockedReasons: string[]
  warnings: string[]
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function daysBetween(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime()
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime()
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 365
  return Math.max(1, Math.ceil((end - start) / 86400000) + 1)
}

export class PortfolioProxyMarketDataService {
  async ensureCoverage(
    symbols: string[],
    startDate: string,
    endDate: string,
    options: { minRequiredBars?: number; forceRefresh?: boolean } = {},
  ): Promise<PortfolioProxyCoverageReport> {
    const uniqueSymbols = Array.from(new Set(symbols.filter((symbol) => /^\d{6}$/.test(symbol))))
    const minRequiredBars = Math.max(1, options.minRequiredBars ?? 250)
    const requestedDays = Math.max(minRequiredBars + 30, daysBetween(startDate, endDate))
    const items: PortfolioProxyCoverageItem[] = []
    const blockedReasons: string[] = []
    const warnings: string[] = []

    for (const symbol of uniqueSymbols) {
      const cachedBarsBefore = await this.countBars(symbol)
      let providerWarnings: string[] = []
      let sourceProvider = 'market_bar_canonical'
      if (cachedBarsBefore < minRequiredBars || options.forceRefresh) {
        const result = await marketBarCacheService.getHistory(symbol, requestedDays, {
          market: 'CN',
          provider: 'eastmoney_sina_free_proxy',
          forceRefresh: options.forceRefresh,
        })
        sourceProvider = result.stats.provider
        providerWarnings = result.stats.warnings
      }

      const cachedBarsAfter = await this.countBars(symbol)
      const latestTradeDate = await this.latestTradeDate(symbol)
      const freshnessStatus = this.freshness(latestTradeDate)
      const coverageStatus = cachedBarsAfter >= minRequiredBars
        ? 'ready'
        : cachedBarsAfter > 0
          ? 'partial'
          : 'insufficient'
      const itemWarnings = [
        ...providerWarnings,
        ...(freshnessStatus !== 'fresh' ? [`proxy_market_data_${freshnessStatus}:${symbol}`] : []),
        ...(coverageStatus !== 'ready' ? [`proxy_market_bar_coverage_below_${minRequiredBars}:${symbol}:${cachedBarsAfter}`] : []),
      ]
      if (coverageStatus !== 'ready') {
        blockedReasons.push(`proxy_market_bar_coverage_below_${minRequiredBars}:${symbol}:${cachedBarsAfter}`)
      }
      warnings.push(...itemWarnings)
      items.push({
        symbol,
        requestedDays,
        minRequiredBars,
        cachedBarsBefore,
        cachedBarsAfter,
        latestTradeDate,
        coverageStatus,
        freshnessStatus,
        sourceProvider,
        sourceEndpoint: 'marketBarCacheService.getHistory:free_provider',
        fetchedAt: new Date().toISOString(),
        evidenceRefs: [
          `market_bar_canonical:${symbol}:${startDate}:${endDate}:count:${cachedBarsAfter}`,
          `portfolio-proxy-market-data:${symbol}:minRequiredBars:${minRequiredBars}`,
        ],
        warnings: Array.from(new Set(itemWarnings)),
      })
    }

    const readyCount = items.filter((item) => item.coverageStatus === 'ready').length
    return {
      schemaVersion: 'portfolio.proxy_market_data_coverage.v1',
      generatedAt: new Date().toISOString(),
      minRequiredBars,
      requestedDays,
      status: readyCount === items.length && items.length > 0 ? 'ready' : readyCount > 0 ? 'partial' : 'insufficient',
      items,
      blockedReasons: Array.from(new Set(blockedReasons)),
      warnings: Array.from(new Set(warnings)),
    }
  }

  private async countBars(symbol: string) {
    return prisma.marketBarCanonical.count({
      where: {
        symbol,
        market: 'CN',
        timeframe: '1d',
        adjustType: 'none',
        dataVersion: 'canonical.v1',
        closePrice: { gt: 0 },
      },
    })
  }

  private async latestTradeDate(symbol: string) {
    const row = await prisma.marketBarCanonical.findFirst({
      where: {
        symbol,
        market: 'CN',
        timeframe: '1d',
        adjustType: 'none',
        dataVersion: 'canonical.v1',
        closePrice: { gt: 0 },
      },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return row ? isoDate(row.tradeDate) : null
  }

  private freshness(latestTradeDate: string | null): PortfolioProxyCoverageItem['freshnessStatus'] {
    if (!latestTradeDate) return 'unknown'
    const latest = new Date(`${latestTradeDate}T00:00:00.000Z`).getTime()
    if (!Number.isFinite(latest)) return 'unknown'
    return latest >= Date.now() - 10 * 24 * 60 * 60 * 1000 ? 'fresh' : 'stale'
  }
}

export const portfolioProxyMarketDataService = new PortfolioProxyMarketDataService()
