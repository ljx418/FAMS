import { prisma } from '../../db/prisma.js'
import { getChinaIndexHistory } from '../../utils/stockUtils.js'
import { PortfolioBacktestCurvePoint } from './portfolioBacktestTypes.js'

type BenchmarkSeries = Map<string, { netValue: number; cumulativeReturnPercent: number }>
type BenchmarkStatus = 'formal_total_return' | 'price_index' | 'research_proxy' | 'unavailable'

export type PortfolioBenchmarkResult = {
  seriesById: Record<string, BenchmarkSeries>
  statusById: Record<string, BenchmarkStatus>
  coveragePercent: number
  warnings: string[]
  evidenceRefs: string[]
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export class PortfolioBenchmarkService {
  async buildBenchmarks(benchmarkIds: string[], dates: string[], startDate: string, endDate: string): Promise<PortfolioBenchmarkResult> {
    const seriesById: Record<string, BenchmarkSeries> = {}
    const statusById: Record<string, BenchmarkStatus> = {}
    const warnings: string[] = []
    const evidenceRefs: string[] = []

    if (benchmarkIds.includes('cash_cny')) {
      const cash = new Map<string, { netValue: number; cumulativeReturnPercent: number }>()
      for (const date of dates) {
        cash.set(date, { netValue: 1, cumulativeReturnPercent: 0 })
      }
      seriesById.cash_cny = cash
      statusById.cash_cny = 'price_index'
      evidenceRefs.push(`portfolio-benchmark:cash_cny:${startDate}:${endDate}`)
    }

    if (benchmarkIds.includes('csi300_price_index')) {
      const csi300 = await this.buildChinaIndexBenchmark('csi300_price_index', '000300.SH', dates, startDate, endDate)
      if (csi300.series.size > 0) {
        seriesById.csi300_price_index = csi300.series
        statusById.csi300_price_index = 'price_index'
        evidenceRefs.push(...csi300.evidenceRefs)
        warnings.push('csi300_price_index_is_price_index_not_total_return_benchmark')
      } else {
        statusById.csi300_price_index = 'unavailable'
        warnings.push('csi300_price_index_unavailable')
      }
    }

    if (benchmarkIds.includes('local_equal_weight_20')) {
      const local = await this.buildLocalEqualWeightBenchmark(dates, startDate, endDate, 20)
      if (local.series.size > 0) {
        seriesById.local_equal_weight_20 = local.series
        statusById.local_equal_weight_20 = 'research_proxy'
        evidenceRefs.push(...local.evidenceRefs)
        warnings.push('local_equal_weight_20_is_research_proxy_not_formal_benchmark')
      } else {
        statusById.local_equal_weight_20 = 'unavailable'
        warnings.push('local_equal_weight_20_unavailable')
      }
    }

    const unsupported = benchmarkIds.filter((id) => !['cash_cny', 'csi300_price_index', 'local_equal_weight_20'].includes(id))
    for (const id of unsupported) {
      statusById[id] = 'unavailable'
      warnings.push(`benchmark_unavailable_or_not_formal:${id}`)
    }

    const requestedSlots = Math.max(1, dates.length * Math.max(1, benchmarkIds.length))
    const coveredSlots = Object.values(seriesById).reduce((sum, series) => sum + series.size, 0)
    return {
      seriesById,
      statusById,
      coveragePercent: round((coveredSlots / requestedSlots) * 100, 2),
      warnings,
      evidenceRefs,
    }
  }

  curvePointBenchmark(seriesById: PortfolioBenchmarkResult['seriesById'], date: string): PortfolioBacktestCurvePoint['benchmark'] {
    const benchmark: PortfolioBacktestCurvePoint['benchmark'] = {}
    for (const [id, series] of Object.entries(seriesById)) {
      const point = series.get(date)
      if (point) benchmark[id] = point
    }
    return benchmark
  }

  benchmarkReturnPercent(seriesById: PortfolioBenchmarkResult['seriesById'], preferredIds: string[]) {
    const selectedId = preferredIds.find((id) => id !== 'cash_cny' && seriesById[id]) || preferredIds.find((id) => seriesById[id])
    if (!selectedId) return null
    const points = Array.from(seriesById[selectedId].values())
    return points.at(-1)?.cumulativeReturnPercent ?? null
  }

  private async buildChinaIndexBenchmark(id: string, symbol: string, dates: string[], startDate: string, endDate: string) {
    const days = Math.max(260, Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 30)
    const rows = await getChinaIndexHistory(symbol, days).catch(() => [])
    const byDate = new Map(rows.map((row) => [row.date, row.close]))
    const baseDate = dates.find((date) => {
      const price = byDate.get(date)
      return Number.isFinite(price) && Number(price) > 0
    })
    const basePrice = baseDate ? byDate.get(baseDate) : undefined
    const series = new Map<string, { netValue: number; cumulativeReturnPercent: number }>()
    if (!baseDate || !basePrice || basePrice <= 0) {
      return { series, evidenceRefs: [`portfolio-benchmark:${id}:insufficient`] }
    }

    for (const date of dates) {
      const price = byDate.get(date)
      if (!price || price <= 0) continue
      const netValue = price / basePrice
      series.set(date, {
        netValue: round(netValue, 6),
        cumulativeReturnPercent: round((netValue - 1) * 100, 4),
      })
    }

    return {
      series,
      evidenceRefs: [
        `portfolio-benchmark:${id}:${symbol}:${startDate}:${endDate}:price_index`,
      ],
    }
  }

  private async buildLocalEqualWeightBenchmark(dates: string[], startDate: string, endDate: string, take: number) {
    const grouped = await prisma.marketBarCanonical.groupBy({
      by: ['symbol'],
      where: {
        market: 'CN',
        timeframe: '1d',
        adjustType: 'none',
        dataVersion: 'canonical.v1',
        closePrice: { gt: 0 },
      },
      _count: { _all: true },
      orderBy: { _count: { symbol: 'desc' } },
      take,
    })
    const symbols = grouped.filter((item) => item._count._all >= 30).map((item) => item.symbol)
    const priceBySymbol = new Map<string, Map<string, number>>()
    await Promise.all(symbols.map(async (symbol) => {
      const rows = await prisma.marketBarCanonical.findMany({
        where: {
          symbol,
          market: 'CN',
          timeframe: '1d',
          adjustType: 'none',
          dataVersion: 'canonical.v1',
          closePrice: { gt: 0 },
          tradeDate: {
            gte: new Date(startDate),
            lte: new Date(`${endDate}T23:59:59.999Z`),
          },
        },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, closePrice: true },
      })
      priceBySymbol.set(symbol, new Map(rows.map((row) => [isoDate(row.tradeDate), row.closePrice])))
    }))

    const series = new Map<string, { netValue: number; cumulativeReturnPercent: number }>()
    const basePrices = new Map<string, number>()
    for (const symbol of symbols) {
      const price = priceBySymbol.get(symbol)?.get(dates[0])
      if (price && price > 0) basePrices.set(symbol, price)
    }

    if (basePrices.size < 2) {
      return { series, evidenceRefs: ['portfolio-benchmark:local_equal_weight_20:insufficient'] }
    }

    for (const date of dates) {
      const values: number[] = []
      for (const [symbol, basePrice] of basePrices.entries()) {
        const price = priceBySymbol.get(symbol)?.get(date)
        if (price && price > 0) values.push(price / basePrice)
      }
      if (values.length < Math.max(2, Math.floor(basePrices.size * 0.8))) continue
      const netValue = values.reduce((sum, value) => sum + value, 0) / values.length
      series.set(date, {
        netValue: round(netValue, 6),
        cumulativeReturnPercent: round((netValue - 1) * 100, 4),
      })
    }

    return {
      series,
      evidenceRefs: [
        `portfolio-benchmark:local_equal_weight_20:${startDate}:${endDate}`,
        ...symbols.map((symbol) => `market_bar_canonical:${symbol}`),
      ],
    }
  }
}

export const portfolioBenchmarkService = new PortfolioBenchmarkService()
