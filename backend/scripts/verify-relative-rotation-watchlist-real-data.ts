import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { relativeRotationUniverseService } from '../src/services/relative-rotation/relativeRotationUniverseService.js'
import {
  buildRelativeRotationSeries,
  PRICE_INDEX_CANONICAL_VERSION,
  QFQ_CANONICAL_VERSION,
} from '../src/services/relative-rotation/relativeRotationService.js'

async function history(market: string, symbol: string, adjustType: string, dataVersion: string) {
  const rows = await prisma.marketBarCanonical.findMany({
    where: { market, symbol, timeframe: '1d', adjustType, dataVersion },
    orderBy: { tradeDate: 'asc' },
  })
  return rows.map((row) => ({
    date: row.tradeDate.toISOString().slice(0, 10),
    close: row.closePrice,
    provider: row.primaryProvider || 'unknown',
  }))
}

async function main() {
  const [watchlist, weekly, daily] = await Promise.all([
    relativeRotationUniverseService.listWatchlist('default'),
    relativeRotationUniverseService.getUniverseTimeline('default', { market: 'CN', frequency: 'weekly', years: 8 }),
    relativeRotationUniverseService.getUniverseTimeline('default', { market: 'CN', frequency: 'daily', years: 8 }),
  ])
  const expected = ['CN:512480', 'CN:515070', 'CN:688825']
  assert.deepEqual(watchlist.items.map((item) => item.targetKey).sort(), expected)

  for (const targetKey of ['CN:512480', 'CN:515070']) {
    const weeklyItem = weekly.items.find((item) => item.targetKey === targetKey)
    const dailyItem = daily.items.find((item) => item.targetKey === targetKey)
    assert.equal(weeklyItem?.readiness, 'verified')
    assert.equal(dailyItem?.readiness, 'verified')
    assert.ok((weeklyItem?.sampleDays || 0) >= 756)
    assert.ok((weeklyItem?.points.length || 0) >= 12)
    assert.ok((dailyItem?.points.length || 0) >= 12)
  }
  const cxmt = weekly.items.find((item) => item.targetKey === 'CN:688825')
  assert.equal(cxmt?.readiness, 'insufficient')
  assert.ok((cxmt?.sampleDays || 0) > 0 && (cxmt?.sampleDays || 0) < 756)
  assert.equal(cxmt?.points.length, 0)
  assert.ok(cxmt?.blockers.some((blocker) => blocker.startsWith('formula_samples_insufficient')))

  const multiMarket = [
    { market: 'HK', asset: '00700.HK', benchmark: '^HSI', adjustType: 'adjusted', dataVersion: 'canonical.adjusted_close.v1' },
    { market: 'US', asset: 'AAPL', benchmark: '^GSPC', adjustType: 'adjusted', dataVersion: 'canonical.adjusted_close.v1' },
  ]
  const sourceEvidence = []
  for (const sample of multiMarket) {
    const [assetHistory, benchmarkHistory] = await Promise.all([
      history(sample.market, sample.asset, sample.adjustType, sample.dataVersion),
      history(sample.market, sample.benchmark, 'none', PRICE_INDEX_CANONICAL_VERSION),
    ])
    assert.ok(assetHistory.length >= 756, `${sample.asset} should have at least 756 real daily bars`)
    assert.ok(benchmarkHistory.length >= 756, `${sample.benchmark} should have at least 756 real daily bars`)
    const weeklySeries = buildRelativeRotationSeries(assetHistory, benchmarkHistory, 'weekly')
    const dailySeries = buildRelativeRotationSeries(assetHistory, benchmarkHistory, 'daily')
    assert.ok(weeklySeries.points.length >= 12)
    assert.ok(dailySeries.points.length >= 12)
    assert.ok(assetHistory.every((row) => Number.isFinite(row.close) && row.close > 0))
    sourceEvidence.push({
      market: sample.market,
      asset: sample.asset,
      assetBars: assetHistory.length,
      benchmark: sample.benchmark,
      benchmarkBars: benchmarkHistory.length,
      firstDate: assetHistory[0].date,
      lastDate: assetHistory.at(-1)?.date,
      assetProviders: Array.from(new Set(assetHistory.map((row) => row.provider))),
      benchmarkProviders: Array.from(new Set(benchmarkHistory.map((row) => row.provider))),
      weeklyPoints: weeklySeries.points.length,
      dailyPoints: dailySeries.points.length,
    })
  }

  const cnEvidence = []
  for (const symbol of ['515070', '512480', '688825']) {
    const bars = await history('CN', symbol, 'qfq', QFQ_CANONICAL_VERSION)
    cnEvidence.push({
      symbol,
      bars: bars.length,
      firstDate: bars[0]?.date || null,
      lastDate: bars.at(-1)?.date || null,
      providers: Array.from(new Set(bars.map((row) => row.provider))),
    })
  }

  console.log(JSON.stringify({
    ok: true,
    checkedAt: new Date().toISOString(),
    defaultWatchlist: expected,
    cnEvidence,
    multiMarket: sourceEvidence,
    conclusion: 'AI ETF and semiconductor ETF are verified; CXMT is correctly gated as insufficient; HK/US multi-market formulas are reproducible from persisted real canonical bars.',
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
