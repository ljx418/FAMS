import { prisma } from '../src/db/prisma.js'
import { stockAnalysisService } from '../src/services/technical/stockAnalysisService.js'

async function main() {
  const symbol = '601127'
  const market = 'A股'

  const refreshed = await stockAnalysisService.getFullAnalysis(symbol, market, 80, {
    forceRefresh: true,
  })
  const cached = await stockAnalysisService.getFullAnalysis(symbol, market, 80)
  const row = await prisma.stockFactSetCache.findUnique({
    where: {
      symbol_market_factsetType_factsetSchemaVersion_lookbackDays_timeframe: {
        symbol,
        market,
        factsetType: 'stock_full_analysis',
        factsetSchemaVersion: 'stock.analysis.factset.v1',
        lookbackDays: 80,
        timeframe: '1d',
      },
    },
  })

  if (!refreshed.cache?.refreshed) {
    throw new Error('Expected forceRefresh stock analysis to refresh cache')
  }
  if (cached.cache?.refreshed !== false) {
    throw new Error('Expected second stock analysis call to hit fresh cache')
  }
  if (!row || row.status !== 'fresh') {
    throw new Error('Expected StockFactSetCache row with fresh status')
  }
  if (row.lookbackDays !== 80 || row.timeframe !== '1d') {
    throw new Error(`Expected StockFactSetCache row to include 80/1d metadata, got ${row.lookbackDays}/${row.timeframe}`)
  }
  if (cached.factSet.technical.facts.length === 0 || cached.factSet.fundamental.facts.length === 0) {
    throw new Error('Expected cached stock fact set to keep technical and fundamental facts')
  }

  const alternateLookbackDays = 60
  const refreshedAlternate = await stockAnalysisService.getFullAnalysis(symbol, market, alternateLookbackDays, {
    forceRefresh: true,
  })
  const alternateRow = await prisma.stockFactSetCache.findUnique({
    where: {
      symbol_market_factsetType_factsetSchemaVersion_lookbackDays_timeframe: {
        symbol,
        market,
        factsetType: 'stock_full_analysis',
        factsetSchemaVersion: 'stock.analysis.factset.v1',
        lookbackDays: alternateLookbackDays,
        timeframe: '1d',
      },
    },
  })
  if (!refreshedAlternate.cache?.refreshed || !alternateRow) {
    throw new Error(`Expected ${alternateLookbackDays}-day stock analysis to write an independent cache row`)
  }
  if (alternateRow.id === row.id) {
    throw new Error(`Expected ${alternateLookbackDays}-day and 80-day stock factset caches to use different rows`)
  }

  const expiredAt = new Date(Date.now() - 60_000)
  await prisma.stockFactSetCache.update({
    where: {
      symbol_market_factsetType_factsetSchemaVersion_lookbackDays_timeframe: {
        symbol,
        market,
        factsetType: 'stock_full_analysis',
        factsetSchemaVersion: 'stock.analysis.factset.v1',
        lookbackDays: 80,
        timeframe: '1d',
      },
    },
    data: {
      status: 'fresh',
      nextRefreshAfter: expiredAt,
      staleAt: expiredAt,
    },
  })

  const stale = await stockAnalysisService.getFullAnalysis(symbol, market, 80)
  if (stale.cache?.status !== 'stale') {
    throw new Error(`Expected expired stock factset cache to return stale, got ${stale.cache?.status}`)
  }

  let refreshedAfterStale = await stockAnalysisService.getFullAnalysis(symbol, market, 80)
  for (let attempt = 0; attempt < 12 && refreshedAfterStale.cache?.status !== 'fresh'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5_000))
    refreshedAfterStale = await stockAnalysisService.getFullAnalysis(symbol, market, 80)
  }
  if (refreshedAfterStale.cache?.status !== 'fresh') {
    throw new Error(`Expected background refresh to restore fresh cache, got ${refreshedAfterStale.cache?.status}`)
  }

  console.log(JSON.stringify({
    ok: true,
    symbol,
    refreshed: refreshed.cache,
    cached: cached.cache,
    stale: stale.cache,
    refreshedAfterStale: refreshedAfterStale.cache,
    factCounts: {
      technical: cached.factSet.technical.facts.length,
      fundamental: cached.factSet.fundamental.facts.length,
      news: cached.factSet.news.facts.length,
    },
    cacheRow: {
      status: row.status,
      lookbackDays: row.lookbackDays,
      timeframe: row.timeframe,
      generatedAt: row.generatedAt,
      nextRefreshAfter: row.nextRefreshAfter,
    },
    alternateCacheRow: {
      status: alternateRow.status,
      lookbackDays: alternateRow.lookbackDays,
      timeframe: alternateRow.timeframe,
    },
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
