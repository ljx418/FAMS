import { prisma } from '../src/db/prisma.js'
import { marketBarCacheService, type MarketBarCacheStats } from '../src/services/market-data/marketBarCacheService.js'
import { stockScreenerService } from '../src/services/screener/stockScreenerService.js'

function parseNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parseSymbols() {
  const raw = process.argv.find((item) => item.startsWith('--symbols='))?.slice('--symbols='.length)
    || process.env.FAMS_MARKET_BAR_PREHEAT_SYMBOLS
    || ''
  return Array.from(new Set(raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d{6}$/.test(item))))
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index], index)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, () => worker()))
  return results
}

function summarizeFailureCategories(stats: MarketBarCacheStats[]) {
  return stats.reduce<Record<string, number>>((summary, item) => {
    const category = item.failureCategory || (item.warnings.length > 0 ? 'provider_error' : 'none')
    summary[category] = (summary[category] || 0) + 1
    return summary
  }, {})
}

async function main() {
  const userId = process.env.FAMS_MARKET_BAR_PREHEAT_USER_ID || 'default'
  const limit = parseNumberEnv('FAMS_MARKET_BAR_PREHEAT_LIMIT', 120)
  const days = parseNumberEnv('FAMS_MARKET_BAR_PREHEAT_DAYS', 120)
  const concurrency = parseNumberEnv('FAMS_MARKET_BAR_PREHEAT_CONCURRENCY', 4)
  const forceRefresh = /^(1|true|yes)$/i.test(process.env.FAMS_MARKET_BAR_PREHEAT_FORCE || '')
  const requestedSymbols = parseSymbols()
  const startedAt = Date.now()

  const resolved = requestedSymbols.length > 0
    ? { universe: requestedSymbols.map((symbol) => ({ symbol })), universeSource: 'provided_symbols', universeTotal: requestedSymbols.length }
    : await stockScreenerService.resolveStockUniverseForPreheat(userId, {
      maxUniverse: limit,
    })
  const symbols = resolved.universe.map((asset) => asset.symbol)
  const universeSource = resolved.universeSource
  const universeTotal = resolved.universeTotal
  const before = await marketBarCacheService.getCoverageReport(symbols, days)
  const minCacheHitBars = Math.ceil(days * 0.8)
  const topUpSymbols = new Set(before.items
    .filter((item) => item.sufficient && item.cachedBars < minCacheHitBars)
    .map((item) => item.symbol))
  const targets = before.items
    .filter((item) => forceRefresh || (!item.sufficient && item.retryable !== false) || (item.sufficient && item.cachedBars < minCacheHitBars))
    .map((item) => item.symbol)

  console.log(JSON.stringify({
    event: 'preheat_started',
    userId,
    universeSource,
    universeTotal,
    limit,
    days,
    concurrency,
    forceRefresh,
    before: {
      totalSymbols: before.totalSymbols,
      sufficientSymbols: before.sufficientSymbols,
      estimatedCacheHitRate: before.estimatedCacheHitRate,
      staleSymbols: before.staleSymbols,
      minCacheHitBars,
    },
    targets: targets.length,
  }))

  const results = await mapWithConcurrency(targets, concurrency, async (symbol, index) => {
    const result = await marketBarCacheService.getHistory(symbol, days, {
      market: 'CN',
      provider: 'sina',
      forceRefresh: forceRefresh || topUpSymbols.has(symbol),
    })
    if ((index + 1) % 20 === 0 || index === targets.length - 1) {
      console.log(JSON.stringify({
        event: 'preheat_progress',
        completed: index + 1,
        total: targets.length,
      }))
    }
    return result.stats
  })

  const after = await marketBarCacheService.getCoverageReport(symbols, days, 'CN', { forceRebuild: true })
  const failureStats = results.filter((item) => item.returnedDays < Math.min(days, 90) || item.warnings.length > 0)
  const failureCategorySummary = summarizeFailureCategories(failureStats)
  console.log(JSON.stringify({
    event: 'preheat_finished',
    elapsedMs: Date.now() - startedAt,
    universeSource,
    universeTotal,
    requestedSymbols: symbols.length,
    attemptedSymbols: targets.length,
    successSymbols: results.length - failureStats.length,
    warningSymbols: failureStats.length,
    fetchedBars: results.reduce((sum, item) => sum + item.fetched, 0),
    before: {
      sufficientSymbols: before.sufficientSymbols,
      insufficientSymbols: before.insufficientSymbols,
      staleSymbols: before.staleSymbols,
      estimatedCacheHitRate: before.estimatedCacheHitRate,
    },
    after: {
      sufficientSymbols: after.sufficientSymbols,
      insufficientSymbols: after.insufficientSymbols,
      staleSymbols: after.staleSymbols,
      estimatedCacheHitRate: after.estimatedCacheHitRate,
    },
    failureCategorySummary,
    warnings: failureStats.slice(0, 20).map((item) => ({
      symbol: item.symbol,
      returnedDays: item.returnedDays,
      failureCategory: item.failureCategory || null,
      retryable: item.failureRetryable ?? null,
      providerAttempts: item.providerAttempts ?? null,
      warnings: item.warnings,
    })),
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
