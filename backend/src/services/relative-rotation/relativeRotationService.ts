import { createHash } from 'node:crypto'
import { prisma } from '../../db/prisma.js'
import {
  getSmartChinaIndexHistory,
  getSmartQfqStockHistory,
  type HistoryProviderAttempt,
  type StockHistoryData,
} from '../../utils/stockUtils.js'
import { marketBarCacheService } from '../market-data/marketBarCacheService.js'

export const RELATIVE_ROTATION_FORMULA_VERSION = 'transparent_relative_rotation.v1'
export const RELATIVE_ROTATION_DATA_VERSION = 'relative_rotation.v1'
export const QFQ_CANONICAL_VERSION = 'canonical.qfq.v1'
export const PRICE_INDEX_CANONICAL_VERSION = 'benchmark.price_index.v1'
export const DEFAULT_ROTATION_BENCHMARK_ID = 'csi300_price_index'
export const DEFAULT_ROTATION_BENCHMARK_SYMBOL = '000300.SH'
export const RELATIVE_ROTATION_TIMELINE_MAX_YEARS = 8

export type RelativeRotationFrequency = 'weekly' | 'daily'
export type RelativeRotationQuadrant = 'leading' | 'weakening' | 'lagging' | 'improving'

export interface RotationInputPoint {
  date: string
  close: number
  open?: number
  high?: number
  low?: number
  volume?: number
}

export interface RelativeRotationSeriesPoint {
  date: string
  relativePrice: number
  relativeTrend: number
  relativeMomentum: number
  quadrant: RelativeRotationQuadrant
  deltaX: number | null
  deltaY: number | null
  speed: number | null
}

export interface RotationSeriesResult {
  points: RelativeRotationSeriesPoint[]
  alignedObservations: number
  assetObservations: number
  benchmarkObservations: number
  coveragePercent: number
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10)
const toUtcDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
const round = (value: number, digits = 6) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const ema = (values: number[], period: number) => {
  if (values.length === 0) return []
  const multiplier = 2 / (period + 1)
  const result = [values[0]]
  for (let index = 1; index < values.length; index += 1) {
    result.push((values[index] * multiplier) + (result[index - 1] * (1 - multiplier)))
  }
  return result
}

const weekKey = (date: string) => {
  const value = toUtcDate(date)
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() - day + 1)
  return isoDate(value)
}

const resampleWeekly = (points: RotationInputPoint[]) => {
  const latestByWeek = new Map<string, RotationInputPoint>()
  for (const point of points) latestByWeek.set(weekKey(point.date), point)
  return Array.from(latestByWeek.values()).sort((left, right) => left.date.localeCompare(right.date))
}

const resolveQuadrant = (trend: number, momentum: number): RelativeRotationQuadrant => {
  if (trend >= 100 && momentum >= 100) return 'leading'
  if (trend >= 100 && momentum < 100) return 'weakening'
  if (trend < 100 && momentum < 100) return 'lagging'
  return 'improving'
}

export function buildRelativeRotationSeries(
  assetPoints: RotationInputPoint[],
  benchmarkPoints: RotationInputPoint[],
  frequency: RelativeRotationFrequency = 'weekly',
): RotationSeriesResult {
  const assetByDate = new Map(assetPoints
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0)
    .map((point) => [point.date, point]))
  const benchmarkByDate = new Map(benchmarkPoints
    .filter((point) => point.date && Number.isFinite(point.close) && point.close > 0)
    .map((point) => [point.date, point]))
  const alignedDaily = Array.from(assetByDate.keys())
    .filter((date) => benchmarkByDate.has(date))
    .sort()
    .map((date) => ({
      date,
      close: assetByDate.get(date)!.close / benchmarkByDate.get(date)!.close,
    }))
  const aligned = frequency === 'weekly' ? resampleWeekly(alignedDaily) : alignedDaily
  const relativePrices = aligned.map((point) => point.close)
  const trendFastPeriod = frequency === 'weekly' ? 10 : 20
  const trendSlowPeriod = frequency === 'weekly' ? 30 : 60
  const momentumFastPeriod = frequency === 'weekly' ? 4 : 5
  const momentumSlowPeriod = frequency === 'weekly' ? 12 : 20
  const trendFast = ema(relativePrices, trendFastPeriod)
  const trendSlow = ema(relativePrices, trendSlowPeriod)
  const trendSeries = relativePrices.map((_, index) => 100 * trendFast[index] / trendSlow[index])
  const momentumFast = ema(trendSeries, momentumFastPeriod)
  const momentumSlow = ema(trendSeries, momentumSlowPeriod)
  const warmup = trendSlowPeriod + momentumSlowPeriod
  const points: RelativeRotationSeriesPoint[] = []

  for (let index = warmup - 1; index < aligned.length; index += 1) {
    const relativeTrend = trendSeries[index]
    const relativeMomentum = 100 * momentumFast[index] / momentumSlow[index]
    if (!Number.isFinite(relativeTrend) || !Number.isFinite(relativeMomentum)) continue
    const previous = points.at(-1)
    const deltaX = previous ? relativeTrend - previous.relativeTrend : null
    const deltaY = previous ? relativeMomentum - previous.relativeMomentum : null
    points.push({
      date: aligned[index].date,
      relativePrice: round(aligned[index].close, 8),
      relativeTrend: round(relativeTrend, 6),
      relativeMomentum: round(relativeMomentum, 6),
      quadrant: resolveQuadrant(relativeTrend, relativeMomentum),
      deltaX: deltaX === null ? null : round(deltaX, 6),
      deltaY: deltaY === null ? null : round(deltaY, 6),
      speed: deltaX === null || deltaY === null ? null : round(Math.hypot(deltaX, deltaY), 6),
    })
  }

  const alignedObservations = aligned.length
  const coverageBase = Math.max(1, Math.min(assetPoints.length, benchmarkPoints.length))
  return {
    points,
    alignedObservations,
    assetObservations: assetPoints.length,
    benchmarkObservations: benchmarkPoints.length,
    coveragePercent: round((alignedDaily.length / coverageBase) * 100, 2),
  }
}

class RelativeRotationService {
  private readonly preferredHistoryDays = 1260
  private readonly minimumHistoryDays = 756
  private readonly maximumHistoryDays = 3000

  private historyToInput(history: StockHistoryData[]): RotationInputPoint[] {
    return history
      .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.close) && row.close > 0)
      .map((row) => ({
        date: row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      }))
      .sort((left, right) => left.date.localeCompare(right.date))
  }

  private async recordSourceAttempts(attempts: HistoryProviderAttempt[]) {
    for (const attempt of attempts) {
      if (attempt.status === 'skipped') continue
      await marketBarCacheService.recordExternalProviderAttempt({
        provider: attempt.provider,
        success: attempt.status === 'success' || (attempt.status === 'partial' && attempt.returnedDays > 0),
        returnedDays: attempt.returnedDays,
        durationMs: attempt.durationMs,
        reason: attempt.reason || (attempt.status === 'partial'
          ? `insufficient coverage: ${attempt.returnedDays}/${attempt.requestedDays}`
          : undefined),
      })
    }
    if (attempts.some((attempt) => attempt.status !== 'skipped')) {
      await marketBarCacheService.flushProviderHealth()
    }
  }

  private async loadCanonicalHistory(symbol: string, adjustType: string, dataVersion: string, days: number) {
    const rows = await prisma.marketBarCanonical.findMany({
      where: { symbol, market: 'CN', timeframe: '1d', adjustType, dataVersion },
      orderBy: { tradeDate: 'desc' },
      take: days,
    })
    return rows.reverse().map((row) => ({
      date: isoDate(row.tradeDate),
      open: row.openPrice || row.closePrice,
      high: row.highPrice || row.closePrice,
      low: row.lowPrice || row.closePrice,
      close: row.closePrice,
      volume: row.volume || 0,
      source: `cache:${row.primaryProvider || 'canonical'}`,
      adjustType: adjustType === 'qfq' ? 'qfq' as const : 'none' as const,
    }))
  }

  private async persistCanonicalHistory(params: {
    symbol: string
    history: StockHistoryData[]
    provider: string
    adjustType: 'none' | 'qfq'
    dataVersion: string
    expectedDays?: number
  }) {
    const valid = params.history
      .map((bar) => ({ bar, tradeDate: toUtcDate(bar.date) }))
      .filter(({ bar, tradeDate }) => !Number.isNaN(tradeDate.getTime()) && Number.isFinite(bar.close) && bar.close > 0)
    if (valid.length === 0) return
    const dates = valid.map((row) => row.tradeDate)
    await prisma.$transaction(async (tx) => {
      await tx.marketBarRaw.deleteMany({
        where: {
          symbol: params.symbol,
          market: 'CN',
          provider: params.provider,
          adjustType: params.adjustType,
          tradeDate: { in: dates },
        },
      })
      await tx.marketBarCanonical.deleteMany({
        where: {
          symbol: params.symbol,
          market: 'CN',
          adjustType: params.adjustType,
          dataVersion: params.dataVersion,
          tradeDate: { in: dates },
        },
      })
      await tx.marketBarRaw.createMany({
        data: valid.map(({ bar, tradeDate }) => {
          const payload = { ...bar, adjustType: params.adjustType, provider: params.provider }
          return {
            symbol: params.symbol,
            market: 'CN',
            provider: params.provider,
            providerSymbol: params.symbol,
            timeframe: '1d',
            tradeDate,
            adjustType: params.adjustType,
            openPrice: bar.open,
            highPrice: bar.high,
            lowPrice: bar.low,
            closePrice: bar.close,
            volume: bar.volume,
            currency: 'CNY',
            timezone: 'Asia/Shanghai',
            sourceTimestamp: tradeDate,
            validationStatus: 'valid',
            rawPayloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
            rawPayloadJson: JSON.stringify(payload),
          }
        }),
      })
      await tx.marketBarCanonical.createMany({
        data: valid.map(({ bar, tradeDate }) => ({
          symbol: params.symbol,
          market: 'CN',
          timeframe: '1d',
          tradeDate,
          adjustType: params.adjustType,
          openPrice: bar.open,
          highPrice: bar.high,
          lowPrice: bar.low,
          closePrice: bar.close,
          volume: bar.volume,
          primaryProvider: params.provider,
          sourceRefsJson: JSON.stringify([`${params.provider}:${params.symbol}:${bar.date}:${params.adjustType}`]),
          consensusScore: 1,
          confidence: 1,
          validationStatus: 'valid',
          dataVersion: params.dataVersion,
          qualityFlagsJson: '[]',
        })),
      })
    })

    const persistedCoverage = await prisma.marketBarCanonical.aggregate({
      where: {
        symbol: params.symbol,
        market: 'CN',
        timeframe: '1d',
        adjustType: params.adjustType,
        dataVersion: params.dataVersion,
      },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    })
    const actualBarCount = persistedCoverage._count._all
    const first = persistedCoverage._min.tradeDate
    const last = persistedCoverage._max.tradeDate
    const existingCoverage = await prisma.marketDataCoverage.findUnique({
      where: {
        symbol_market_timeframe_adjustType_dataVersion: {
          symbol: params.symbol,
          market: 'CN',
          timeframe: '1d',
          adjustType: params.adjustType,
          dataVersion: params.dataVersion,
        },
      },
      select: { expectedBarCount: true },
    })
    const expectedBarCount = Math.max(
      this.preferredHistoryDays,
      params.expectedDays || 0,
      existingCoverage?.expectedBarCount || 0,
    )
    await prisma.marketDataCoverage.upsert({
      where: {
        symbol_market_timeframe_adjustType_dataVersion: {
          symbol: params.symbol,
          market: 'CN',
          timeframe: '1d',
          adjustType: params.adjustType,
          dataVersion: params.dataVersion,
        },
      },
      create: {
        symbol: params.symbol,
        market: 'CN',
        timeframe: '1d',
        adjustType: params.adjustType,
        dataVersion: params.dataVersion,
        firstTradeDate: first,
        lastTradeDate: last,
        completeFrom: actualBarCount >= this.minimumHistoryDays ? first : null,
        completeTo: actualBarCount >= this.minimumHistoryDays ? last : null,
        expectedBarCount,
        actualBarCount,
        missingCount: Math.max(0, this.minimumHistoryDays - actualBarCount),
        lastProvider: params.provider,
        lastFetchAt: new Date(),
        lastValidateAt: new Date(),
        status: actualBarCount >= this.minimumHistoryDays ? 'sufficient' : 'partial',
        staleReason: null,
      },
      update: {
        firstTradeDate: first,
        lastTradeDate: last,
        completeFrom: actualBarCount >= this.minimumHistoryDays ? first : null,
        completeTo: actualBarCount >= this.minimumHistoryDays ? last : null,
        expectedBarCount,
        actualBarCount,
        missingCount: Math.max(0, this.minimumHistoryDays - actualBarCount),
        lastProvider: params.provider,
        lastFetchAt: new Date(),
        lastValidateAt: new Date(),
        status: actualBarCount >= this.minimumHistoryDays ? 'sufficient' : 'partial',
        staleReason: null,
      },
    })
  }

  async ensureQfqHistory(symbol: string, options: { days?: number; refresh?: boolean } = {}) {
    const days = Math.max(120, Math.min(this.maximumHistoryDays, Math.floor(options.days || this.preferredHistoryDays)))
    const cached = await this.loadCanonicalHistory(symbol, 'qfq', QFQ_CANONICAL_VERSION, days)
    if (!options.refresh) return cached
    const coverage = await prisma.marketDataCoverage.findUnique({
      where: {
        symbol_market_timeframe_adjustType_dataVersion: {
          symbol,
          market: 'CN',
          timeframe: '1d',
          adjustType: 'qfq',
          dataVersion: QFQ_CANONICAL_VERSION,
        },
      },
      select: { expectedBarCount: true },
    })
    const requestedDays = coverage && coverage.expectedBarCount >= days ? Math.min(days, 180) : days
    const selection = await getSmartQfqStockHistory(symbol, requestedDays)
    await this.recordSourceAttempts(selection.attempts)
    if (selection.history.length > 0 && selection.selectedProvider) {
      await this.persistCanonicalHistory({
        symbol,
        history: selection.history,
        provider: selection.selectedProvider,
        adjustType: 'qfq',
        dataVersion: QFQ_CANONICAL_VERSION,
        expectedDays: requestedDays,
      })
    }
    return this.loadCanonicalHistory(symbol, 'qfq', QFQ_CANONICAL_VERSION, days)
  }

  async ensureBenchmarkHistory(options: { days?: number; refresh?: boolean } = {}) {
    const days = Math.max(120, Math.min(this.maximumHistoryDays, Math.floor(options.days || this.preferredHistoryDays)))
    const cached = await this.loadCanonicalHistory(DEFAULT_ROTATION_BENCHMARK_SYMBOL, 'none', PRICE_INDEX_CANONICAL_VERSION, days)
    if (!options.refresh) return cached
    const coverage = await prisma.marketDataCoverage.findUnique({
      where: {
        symbol_market_timeframe_adjustType_dataVersion: {
          symbol: DEFAULT_ROTATION_BENCHMARK_SYMBOL,
          market: 'CN',
          timeframe: '1d',
          adjustType: 'none',
          dataVersion: PRICE_INDEX_CANONICAL_VERSION,
        },
      },
      select: { expectedBarCount: true },
    })
    const requestedDays = coverage && coverage.expectedBarCount >= days ? Math.min(days, 180) : days
    const selection = await getSmartChinaIndexHistory(DEFAULT_ROTATION_BENCHMARK_SYMBOL, requestedDays)
      .catch(() => ({ history: [], selectedProvider: null, attempts: [] }))
    await this.recordSourceAttempts(selection.attempts)
    if (selection.history.length > 0 && selection.selectedProvider) {
      await this.persistCanonicalHistory({
        symbol: DEFAULT_ROTATION_BENCHMARK_SYMBOL,
        history: selection.history.map((row) => ({ ...row, adjustType: 'none' })),
        provider: selection.selectedProvider,
        adjustType: 'none',
        dataVersion: PRICE_INDEX_CANONICAL_VERSION,
        expectedDays: requestedDays,
      })
    }
    return this.loadCanonicalHistory(DEFAULT_ROTATION_BENCHMARK_SYMBOL, 'none', PRICE_INDEX_CANONICAL_VERSION, days)
  }

  async computeSymbol(params: {
    symbol: string
    frequency?: RelativeRotationFrequency
    trail?: number
    days?: number
    refresh?: boolean
    persist?: boolean
  }) {
    const frequency = params.frequency || 'weekly'
    const days = params.days || this.preferredHistoryDays
    const [assetHistory, benchmarkHistory] = await Promise.all([
      this.ensureQfqHistory(params.symbol, { days, refresh: params.refresh }),
      this.ensureBenchmarkHistory({ days, refresh: params.refresh }),
    ])
    const result = buildRelativeRotationSeries(
      this.historyToInput(assetHistory),
      this.historyToInput(benchmarkHistory),
      frequency,
    )
    const dataStatus = assetHistory.length < this.minimumHistoryDays || benchmarkHistory.length < this.minimumHistoryDays
      ? 'insufficient'
      : result.points.length < 12
        ? 'partial'
        : 'ready'
    const persistedPoints = result.points
    if (persistedPoints.length > 0 && params.persist !== false) {
      const dates = persistedPoints.map((point) => toUtcDate(point.date))
      await prisma.$transaction(async (tx) => {
        await tx.relativeRotationPoint.deleteMany({
          where: {
            symbol: params.symbol,
            benchmarkId: DEFAULT_ROTATION_BENCHMARK_ID,
            frequency,
            formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
            tradeDate: { in: dates },
          },
        })
        await tx.relativeRotationPoint.createMany({
          data: persistedPoints.map((point) => ({
            symbol: params.symbol,
            benchmarkId: DEFAULT_ROTATION_BENCHMARK_ID,
            frequency,
            tradeDate: toUtcDate(point.date),
            relativePrice: point.relativePrice,
            relativeTrend: point.relativeTrend,
            relativeMomentum: point.relativeMomentum,
            quadrant: point.quadrant,
            deltaX: point.deltaX,
            deltaY: point.deltaY,
            speed: point.speed,
            dataStatus,
            coveragePercent: result.coveragePercent,
            evidenceRefsJson: JSON.stringify([
              `market_bar_canonical:${params.symbol}:qfq:${QFQ_CANONICAL_VERSION}`,
              `market_bar_canonical:${DEFAULT_ROTATION_BENCHMARK_SYMBOL}:none:${PRICE_INDEX_CANONICAL_VERSION}`,
            ]),
          })),
        })
      })
    }
    return {
      symbol: params.symbol,
      benchmarkId: DEFAULT_ROTATION_BENCHMARK_ID,
      benchmarkSymbol: DEFAULT_ROTATION_BENCHMARK_SYMBOL,
      benchmarkStatus: 'price_index' as const,
      frequency,
      formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
      adjustType: 'qfq' as const,
      dataStatus,
      coveragePercent: result.coveragePercent,
      sampleDays: assetHistory.length,
      commonAsOfDate: persistedPoints.at(-1)?.date || null,
      points: persistedPoints.slice(-Math.max(1, Math.min(52, params.trail || 12))),
      allPoints: persistedPoints,
      blockers: [
        ...(assetHistory.length < this.minimumHistoryDays ? [`history_below_minimum:${assetHistory.length}/${this.minimumHistoryDays}`] : []),
        ...(benchmarkHistory.length < this.minimumHistoryDays ? [`benchmark_history_below_minimum:${benchmarkHistory.length}/${this.minimumHistoryDays}`] : []),
        ...(result.points.length < 12 ? [`rotation_points_insufficient:${result.points.length}/12`] : []),
      ],
    }
  }

  private historyDaysForYears(years: number) {
    return Math.min(this.maximumHistoryDays, Math.ceil((years + 1) * 260))
  }

  private yearsBefore(date: string, years: number) {
    const value = toUtcDate(date)
    value.setUTCFullYear(value.getUTCFullYear() - years)
    return isoDate(value)
  }

  private sourceProviders(history: StockHistoryData[]) {
    return Array.from(new Set(history
      .map((row) => String(row.source || '').replace(/^cache:/, ''))
      .filter(Boolean)))
  }

  async getHoldingsTimeline(userId: string, options: {
    frequency?: RelativeRotationFrequency
    years?: number
  } = {}) {
    const frequency = options.frequency || 'weekly'
    const years = Math.max(1, Math.min(RELATIVE_ROTATION_TIMELINE_MAX_YEARS, Math.floor(options.years || 8)))
    const requestedDays = this.historyDaysForYears(years)
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    })
    const eligiblePositions = positions.filter((position) => (
      ['stock', 'etf'].includes(position.asset.type) && /^\d{6}$/.test(position.asset.symbol)
    ))
    const benchmarkHistory = await this.ensureBenchmarkHistory({ days: requestedDays, refresh: false })
    const asOfDate = benchmarkHistory.at(-1)?.date || isoDate(new Date())
    const visibleStartDate = this.yearsBefore(asOfDate, years)
    const coverageRows = await prisma.marketDataCoverage.findMany({
      where: {
        symbol: { in: [DEFAULT_ROTATION_BENCHMARK_SYMBOL, ...eligiblePositions.map((position) => position.asset.symbol)] },
        market: 'CN',
        timeframe: '1d',
        dataVersion: { in: [QFQ_CANONICAL_VERSION, PRICE_INDEX_CANONICAL_VERSION] },
      },
      select: { symbol: true, expectedBarCount: true, lastTradeDate: true },
    })
    const coverageBySymbol = new Map(coverageRows.map((row) => [row.symbol, row]))

    const items = await Promise.all(eligiblePositions.map(async (position) => {
      const history = await this.ensureQfqHistory(position.asset.symbol, { days: requestedDays, refresh: false })
      const result = buildRelativeRotationSeries(
        this.historyToInput(history),
        this.historyToInput(benchmarkHistory),
        frequency,
      )
      const points = result.points.filter((point) => point.date >= visibleStartDate && point.date <= asOfDate)
      const dataStatus = history.length < this.minimumHistoryDays || benchmarkHistory.length < this.minimumHistoryDays
        ? 'insufficient'
        : points.length < 12
          ? 'partial'
          : 'ready'
      return {
        positionId: position.id,
        assetId: position.assetId,
        symbol: position.asset.symbol,
        name: position.asset.name,
        assetType: position.asset.type,
        eligible: true,
        dataStatus,
        coveragePercent: result.coveragePercent,
        sampleDays: history.length,
        firstPointDate: points[0]?.date || null,
        lastPointDate: points.at(-1)?.date || null,
        sourceProviders: this.sourceProviders(history),
        points,
        blockers: [
          ...(history.length < this.minimumHistoryDays ? [`history_below_minimum:${history.length}/${this.minimumHistoryDays}`] : []),
          ...(points.length < 12 ? [`rotation_points_insufficient:${points.length}/12`] : []),
        ],
      }
    }))

    const allDates = Array.from(new Set(items.flatMap((item) => item.points.map((point) => point.date)))).sort()
    const targetSymbols = [DEFAULT_ROTATION_BENCHMARK_SYMBOL, ...eligiblePositions.map((position) => position.asset.symbol)]
    const refreshReasons = targetSymbols.flatMap((symbol) => {
      const coverage = coverageBySymbol.get(symbol)
      if (!coverage) return [`history_not_prepared:${symbol}`]
      if (coverage.expectedBarCount < requestedDays) return [`long_history_not_prepared:${symbol}`]
      return []
    })

    return {
      schemaVersion: 'fams.relative_rotation.timeline.v1',
      generatedAt: new Date().toISOString(),
      universe: 'current_holdings' as const,
      benchmark: {
        id: DEFAULT_ROTATION_BENCHMARK_ID,
        symbol: DEFAULT_ROTATION_BENCHMARK_SYMBOL,
        name: '沪深300',
        status: 'price_index' as const,
        sourceProviders: this.sourceProviders(benchmarkHistory),
      },
      formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
      frequency,
      requestedYears: years,
      requestedHistoryDays: requestedDays,
      visibleRange: {
        startDate: visibleStartDate,
        endDate: asOfDate,
      },
      items,
      dates: allDates,
      availableDateCount: allDates.length,
      eligibleCount: eligiblePositions.length,
      readyCount: items.filter((item) => item.dataStatus === 'ready').length,
      refreshRecommended: refreshReasons.length > 0,
      refreshReasons,
      notTradingAdvice: true as const,
    }
  }

  async refreshHoldingsTimeline(userId: string, options: { years?: number } = {}) {
    const years = Math.max(1, Math.min(RELATIVE_ROTATION_TIMELINE_MAX_YEARS, Math.floor(options.years || 8)))
    const requestedDays = this.historyDaysForYears(years)
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open', asset: { type: { in: ['stock', 'etf'] } } },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    })
    const eligiblePositions = positions.filter((position) => /^\d{6}$/.test(position.asset.symbol))
    const benchmarkHistory = await this.ensureBenchmarkHistory({ days: requestedDays, refresh: true })
    const results = []
    for (const position of eligiblePositions) {
      const history = await this.ensureQfqHistory(position.asset.symbol, { days: requestedDays, refresh: true })
      const frequencyPoints: Record<RelativeRotationFrequency, number> = { weekly: 0, daily: 0 }
      for (const frequency of ['weekly', 'daily'] as const) {
        const rotation = await this.computeSymbol({
          symbol: position.asset.symbol,
          frequency,
          days: requestedDays,
          refresh: false,
          trail: frequency === 'weekly' ? 52 : 120,
        })
        frequencyPoints[frequency] = rotation.allPoints.length
      }
      results.push({
        positionId: position.id,
        symbol: position.asset.symbol,
        name: position.asset.name,
        sampleDays: history.length,
        firstDate: history[0]?.date || null,
        lastDate: history.at(-1)?.date || null,
        sourceProviders: this.sourceProviders(history),
        frequencyPoints,
      })
    }
    return {
      schemaVersion: 'fams.relative_rotation.timeline_refresh.v1',
      generatedAt: new Date().toISOString(),
      requestedYears: years,
      requestedHistoryDays: requestedDays,
      benchmark: {
        symbol: DEFAULT_ROTATION_BENCHMARK_SYMBOL,
        sampleDays: benchmarkHistory.length,
        firstDate: benchmarkHistory[0]?.date || null,
        lastDate: benchmarkHistory.at(-1)?.date || null,
        sourceProviders: this.sourceProviders(benchmarkHistory),
      },
      requestedPositions: eligiblePositions.length,
      readyPositions: results.filter((item) => item.frequencyPoints.weekly >= 12).length,
      results,
    }
  }

  async getHoldingsRotation(userId: string, options: {
    frequency?: RelativeRotationFrequency
    trail?: number
    refresh?: boolean
  } = {}) {
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: {
        asset: true,
        sleeveAllocation: true,
        volatilityBacktests: { orderBy: { createdAt: 'desc' }, take: 1 },
        volatilityTradeDrafts: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
      orderBy: { marketValue: 'desc' },
    })
    const items = []
    for (const position of positions) {
      const eligible = ['stock', 'etf'].includes(position.asset.type) && /^\d{6}$/.test(position.asset.symbol)
      if (!eligible) {
        items.push({
          positionId: position.id,
          assetId: position.assetId,
          symbol: position.asset.symbol,
          name: position.asset.name,
          assetType: position.asset.type,
          eligible: false,
          dataStatus: 'unsupported',
          blockers: ['only_cn_a_share_and_exchange_traded_etf_supported'],
          position: this.positionSummary(position),
          allocation: position.sleeveAllocation,
          latestBacktest: position.volatilityBacktests[0] || null,
          latestDraft: position.volatilityTradeDrafts[0] || null,
          rotation: null,
        })
        continue
      }
      const rotation = await this.computeSymbol({
        symbol: position.asset.symbol,
        frequency: options.frequency,
        trail: options.trail,
        refresh: options.refresh,
      })
      items.push({
        positionId: position.id,
        assetId: position.assetId,
        symbol: position.asset.symbol,
        name: position.asset.name,
        assetType: position.asset.type,
        eligible: true,
        dataStatus: rotation.dataStatus,
        blockers: rotation.blockers,
        position: this.positionSummary(position),
        allocation: position.sleeveAllocation,
        latestBacktest: position.volatilityBacktests[0] || null,
        latestDraft: position.volatilityTradeDrafts[0] || null,
        rotation,
      })
    }
    return {
      schemaVersion: 'fams.relative_rotation.holdings.v1',
      generatedAt: new Date().toISOString(),
      universe: 'current_holdings',
      benchmark: {
        id: DEFAULT_ROTATION_BENCHMARK_ID,
        symbol: DEFAULT_ROTATION_BENCHMARK_SYMBOL,
        name: '沪深300',
        status: 'price_index',
      },
      formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
      frequency: options.frequency || 'weekly',
      trail: options.trail || 12,
      items,
      eligibleCount: items.filter((item) => item.eligible).length,
      unsupportedCount: items.filter((item) => !item.eligible).length,
      notTradingAdvice: true,
    }
  }

  private positionSummary(position: {
    quantity: number
    avgCost: number
    currentPrice: number | null
    marketValue: number | null
    costBasis: number | null
    unrealizedPnl: number | null
  }) {
    return {
      quantity: position.quantity,
      avgCost: position.avgCost,
      currentPrice: position.currentPrice,
      marketValue: position.marketValue,
      costBasis: position.costBasis,
      unrealizedPnl: position.unrealizedPnl,
    }
  }
}

export const relativeRotationService = new RelativeRotationService()
