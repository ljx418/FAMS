import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'
import { marketFeatureDailyService } from '../src/services/market-data/marketFeatureDailyService.js'

function parseLimit() {
  const value = Number(process.env.FAMS_MARKET_FEATURE_COMPUTE_LIMIT || process.argv.find((item) => item.startsWith('--limit='))?.slice('--limit='.length) || 120)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 120
}

async function main() {
  const limit = parseLimit()
  const grouped = await prisma.marketBarCanonical.groupBy({
    by: ['symbol'],
    where: { market: 'CN', timeframe: '1d', adjustType: 'none', dataVersion: 'canonical.v1' },
    _count: { symbol: true },
    orderBy: { symbol: 'asc' },
    take: limit,
  })
  const symbols = grouped.map((item) => item.symbol)
  const report = await marketFeatureDailyService.computeForSymbols(symbols, {
    market: 'CN',
    lookbackDays: 260,
  })
  console.log(JSON.stringify({
    ok: true,
    inputSymbols: symbols.length,
    report,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
