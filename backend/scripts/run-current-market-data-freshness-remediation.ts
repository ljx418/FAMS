import { prisma } from '../src/db/prisma.js'
import { marketBarCacheService } from '../src/services/market-data/marketBarCacheService.js'
import { marketDataFreshnessService } from '../src/services/market-data/marketDataFreshnessService.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await mapper(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, () => worker()))
  return results
}

requireDevDbMutationAcknowledgement('run-current-market-data-freshness-remediation')

try {
  const userId = process.env.FAMS_USER_ID || 'default'
  const now = new Date()
  const expectedLatestTradeDate = marketDataFreshnessService.expectedLatestTradeDate(now, 'Asia/Shanghai')
  const symbols = await marketDataFreshnessService.collectRelevantSymbols({
    userId,
    scope: 'active_strategy',
    limit: 300,
  })
  const latestRows = await prisma.marketBarCanonical.findMany({
    where: {
      market: 'CN',
      dataVersion: 'canonical.v1',
      symbol: { in: symbols },
    },
    select: { symbol: true, tradeDate: true },
    orderBy: [{ symbol: 'asc' }, { tradeDate: 'desc' }],
    distinct: ['symbol'],
  })
  const latestBySymbol = new Map(latestRows.map((row) => [row.symbol, isoDate(row.tradeDate)]))
  const remediationTargets = symbols.filter((symbol) => {
    const lag = marketDataFreshnessService.tradingDayLag(latestBySymbol.get(symbol) || null, expectedLatestTradeDate)
    return lag === null || lag > 1
  })

  const results = await mapWithConcurrency(remediationTargets, 4, async (symbol) => {
    try {
      const result = await marketBarCacheService.getHistory(symbol, 120, {
        market: 'CN',
        provider: 'sina',
        forceRefresh: true,
      })
      return {
        status: result.stats.returnedDays > 0 ? 'completed' : 'failed',
        warnings: result.stats.warnings.length,
        failureCategory: result.stats.failureCategory || null,
      }
    } catch (error) {
      return {
        status: 'failed',
        warnings: 1,
        failureCategory: error instanceof Error ? error.name : 'unknown_error',
      }
    }
  })

  const report = await marketDataFreshnessService.buildReport({
    userId,
    scope: 'active_strategy',
    limit: 300,
    now,
    timezone: 'Asia/Shanghai',
  })
  console.log(JSON.stringify({
    schemaVersion: 'fams.current_market_data_freshness_remediation.v1',
    status: ['fresh', 'delayed'].includes(report.status) ? 'completed' : 'partial',
    checkedAt: now.toISOString(),
    expectedLatestTradeDate,
    activeStrategySymbolCount: symbols.length,
    remediationTargetCount: remediationTargets.length,
    completedTargetCount: results.filter((item) => item.status === 'completed').length,
    failedTargetCount: results.filter((item) => item.status === 'failed').length,
    warningTargetCount: results.filter((item) => item.warnings > 0).length,
    failureCategories: Array.from(new Set(results.map((item) => item.failureCategory).filter(Boolean))),
    after: {
      status: report.status,
      latestTradeDate: report.latestTradeDate,
      freshSymbols: report.freshSymbols,
      delayedSymbols: report.delayedSymbols,
      staleSymbols: report.staleSymbols,
      unknownSymbols: report.unknownSymbols,
      blockers: report.blockers,
    },
  }, null, 2))
} finally {
  await prisma.$disconnect().catch(() => undefined)
}
