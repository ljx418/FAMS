import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'

function parseLimit() {
  const value = Number(process.env.FAMS_FREE_BENCHMARK_SYMBOL_LIMIT || process.argv.find((item) => item.startsWith('--limit='))?.slice('--limit='.length) || 300)
  return Number.isFinite(value) && value > 0 ? Math.min(1000, Math.floor(value)) : 300
}

function parseDays() {
  const value = Number(process.env.FAMS_FREE_BENCHMARK_DAYS || process.argv.find((item) => item.startsWith('--days='))?.slice('--days='.length) || 120)
  return Number.isFinite(value) && value > 0 ? Math.min(520, Math.floor(value)) : 120
}

function parseSymbols() {
  const raw = process.argv.find((item) => item.startsWith('--symbols='))?.slice('--symbols='.length)
    || process.env.FAMS_FREE_BENCHMARK_SYMBOLS
    || ''
  return Array.from(new Set(raw.split(',').map((item) => item.trim()).filter((item) => /^\d{6}$/.test(item))))
}

async function main() {
  const limit = parseLimit()
  const days = parseDays()
  const requestedSymbols = parseSymbols()
  const output = resolve(process.cwd(), process.argv.find((item) => item.startsWith('--output='))?.slice('--output='.length)
    || process.env.FAMS_FREE_BENCHMARK_OUTPUT
    || 'data/market-benchmarks/h30269-total-return-free-source.json')
  const symbols = requestedSymbols.length > 0
    ? requestedSymbols.slice(0, limit)
    : (await prisma.marketBarCanonical.groupBy({
      by: ['symbol'],
      where: { market: 'CN', timeframe: '1d', adjustType: 'none', dataVersion: 'canonical.v1' },
      orderBy: { symbol: 'asc' },
      take: limit,
    })).map((item) => item.symbol)
  const bars = await prisma.marketBarCanonical.findMany({
    where: {
      symbol: { in: symbols },
      market: 'CN',
      timeframe: '1d',
      adjustType: 'none',
      dataVersion: 'canonical.v1',
    },
    orderBy: [{ tradeDate: 'asc' }, { symbol: 'asc' }],
  })
  const bySymbol = new Map<string, typeof bars>()
  for (const bar of bars) {
    const group = bySymbol.get(bar.symbol) || []
    group.push(bar)
    bySymbol.set(bar.symbol, group)
  }
  const eligible = [...bySymbol.entries()]
    .map(([symbol, rows]) => [symbol, rows.slice(-days)] as const)
    .filter(([, rows]) => rows.length >= Math.min(days, 60))
  const dates = Array.from(new Set(eligible.flatMap(([, rows]) => rows.map((row) => row.tradeDate.toISOString().slice(0, 10))))).sort()
  const baseBySymbol = new Map(eligible.map(([symbol, rows]) => [symbol, rows[0].closePrice]))
  const values = []
  for (const date of dates) {
    const relativeValues = []
    for (const [symbol, rows] of eligible) {
      const row = rows.find((item) => item.tradeDate.toISOString().slice(0, 10) === date)
      const base = baseBySymbol.get(symbol)
      if (row && base && base > 0) relativeValues.push(row.closePrice / base)
    }
    if (relativeValues.length < Math.max(3, Math.floor(eligible.length * 0.5))) continue
    const average = relativeValues.reduce((sum, value) => sum + value, 0) / relativeValues.length
    values.push({
      date,
      value: Number((1000 * average).toFixed(4)),
      evidenceRef: `market-bar-canonical-equal-weight-benchmark:${date}:symbols=${relativeValues.length}`,
    })
  }
  const artifact = {
    schemaVersion: 'dividend.low_vol.free_source_total_return_benchmark.v1',
    generatedAt: new Date().toISOString(),
    name: 'FAMS free-source equal-weight A-share price-return benchmark',
    source: 'market_bar_canonical_equal_weight_price_return',
    note: 'This is a local free-source benchmark built from market_bar_canonical close prices. It is not official H30269 and does not include index-level dividend total-return data.',
    symbolCount: eligible.length,
    requestedSymbols: symbols.length,
    days,
    pointCount: values.length,
    points: values,
    evidenceRefs: values.map((point) => point.evidenceRef).slice(0, 50),
    validation: {
      status: values.length >= 60 ? 'available' : 'insufficient',
      blockers: values.length >= 60 ? [] : ['free_source_benchmark_sample_insufficient'],
    },
  }
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    output,
    requestedSymbols: symbols.length,
    eligibleSymbols: eligible.length,
    pointCount: values.length,
    status: artifact.validation.status,
    blockers: artifact.validation.blockers,
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
