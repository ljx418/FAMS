import { createHash } from 'node:crypto'
import { prisma } from '../../db/prisma.js'
import { getSinaStockHistory, getStockHistory, type StockHistoryData } from '../../utils/stockUtils.js'

export interface MarketBarCacheStats {
  symbol: string
  provider: string
  requestedDays: number
  returnedDays: number
  cacheHits: number
  cacheMisses: number
  cacheHitRate: number
  fetched: number
  warnings: string[]
  failureCategory?: MarketBarFailureCategory
  failureRetryable?: boolean
  providerAttempts?: number
  durationMs: number
}

export interface MarketBarCacheResult {
  history: StockHistoryData[]
  stats: MarketBarCacheStats
}

export type MarketBarFailureCategory =
  | 'provider_timeout'
  | 'empty_reply'
  | 'canonical_missing'
  | 'stale_cache'
  | 'non_retryable_symbol'
  | 'provider_error'
  | 'cache_persist_failed'

interface ProviderHealthAccumulator {
  provider: string
  endpoint: string
  windowStart: Date
  windowEnd: Date
  requestCount: number
  successCount: number
  failureCount: number
  timeoutCount: number
  error4xxCount: number
  error5xxCount: number
  badDataCount: number
  lastSuccessAt?: Date
  lastFailureAt?: Date
  lastError?: string
  metrics: Record<string, unknown>
}

export interface MarketBarCoverageItem {
  symbol: string
  cachedBars: number
  latestDate: string | null
  sufficient: boolean
  stale: boolean
  status?: 'sufficient' | 'partial' | 'stale' | 'failed' | 'unknown'
  staleReason?: string
  warningCategory?: 'none' | 'limited_listing_history' | 'stale_after_preheat' | 'no_local_history' | 'insufficient_history' | 'unknown'
  warningSeverity?: 'info' | 'warning' | 'error'
  retryable?: boolean
  recommendedAction?: 'none' | 'warmup_missing_bars' | 'review_listing_or_suspension' | 'review_provider_mapping'
}

export interface MarketBarCoverageReport {
  schemaVersion: 'fams.market_bar.coverage.v1'
  generatedAt: string
  requestedDays: number
  totalSymbols: number
  sufficientSymbols: number
  insufficientSymbols: number
  staleSymbols: number
  averageCachedBars: number
  estimatedCacheHitRate: number
  missingSymbols: string[]
  staleSymbolList: string[]
  retryableWarmupSymbols: string[]
  nonRetryableWarningSymbols: string[]
  warningSummary: {
    retryableWarmupCount: number
    nonRetryableWarningCount: number
    byCategory: Record<string, number>
  }
  items: MarketBarCoverageItem[]
}

class MarketBarCacheService {
  private requestTimestamps = new Map<string, number[]>()
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly staleWindowMs = 7 * 24 * 60 * 60 * 1000
  private providerHealthAccumulators = new Map<string, ProviderHealthAccumulator>()
  private lastProviderHealthFlushAt = 0

  private async enqueueWrite<T>(writer: () => Promise<T>): Promise<T> {
    const task = this.writeQueue.then(writer)
    this.writeQueue = task.then(() => undefined, () => undefined)
    return task
  }

  private hashPayload(payload: unknown) {
    return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
  }

  private parseDate(value: string) {
    const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
    return Number.isNaN(date.getTime()) ? null : date
  }

  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10)
  }

  private chunk<T>(items: T[], size: number) {
    const chunks: T[][] = []
    for (let index = 0; index < items.length; index += size) {
      chunks.push(items.slice(index, index + size))
    }
    return chunks
  }

  private async getProviderHealth(provider: string) {
    const existing = await prisma.providerHealth.findUnique({ where: { provider } })
    if (existing) return existing
    return this.enqueueWrite(() => prisma.providerHealth.create({
      data: {
        provider,
        endpoint: 'daily_bars',
        status: 'healthy',
        circuitState: 'closed',
        rateLimitPerMinute: Number(process.env.FAMS_PROVIDER_RATE_LIMIT_PER_MINUTE || 120),
      },
    }))
  }

  private async waitForRateLimit(provider: string, limitPerMinute: number) {
    const now = Date.now()
    const windowStart = now - 60_000
    const entries = (this.requestTimestamps.get(provider) || []).filter((time) => time > windowStart)
    if (entries.length >= limitPerMinute) {
      const waitMs = Math.max(0, entries[0] + 60_000 - now)
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5_000)))
    }
    entries.push(Date.now())
    this.requestTimestamps.set(provider, entries)
  }

  private async assertProviderUsable(provider: string) {
    const health = await this.getProviderHealth(provider)
    if (health.status === 'open_circuit' && health.nextRetryAt && health.nextRetryAt > new Date()) {
      throw new Error(`Provider ${provider} circuit open until ${health.nextRetryAt.toISOString()}`)
    }
    await this.waitForRateLimit(provider, health.rateLimitPerMinute || 120)
    return health
  }

  private accumulateProviderHealth(provider: string, patch: Partial<ProviderHealthAccumulator>) {
    const now = new Date()
    const current = this.providerHealthAccumulators.get(provider) || {
      provider,
      endpoint: 'daily_bars',
      windowStart: now,
      windowEnd: now,
      requestCount: 0,
      successCount: 0,
      failureCount: 0,
      timeoutCount: 0,
      error4xxCount: 0,
      error5xxCount: 0,
      badDataCount: 0,
      metrics: {},
    }
    current.windowEnd = now
    current.requestCount += patch.requestCount || 0
    current.successCount += patch.successCount || 0
    current.failureCount += patch.failureCount || 0
    current.timeoutCount += patch.timeoutCount || 0
    current.error4xxCount += patch.error4xxCount || 0
    current.error5xxCount += patch.error5xxCount || 0
    current.badDataCount += patch.badDataCount || 0
    current.lastSuccessAt = patch.lastSuccessAt || current.lastSuccessAt
    current.lastFailureAt = patch.lastFailureAt || current.lastFailureAt
    current.lastError = patch.lastError || current.lastError
    current.metrics = { ...current.metrics, ...(patch.metrics || {}) }
    this.providerHealthAccumulators.set(provider, current)
    return current
  }

  private async maybeFlushProviderHealth() {
    const totalRequests = Array.from(this.providerHealthAccumulators.values()).reduce((sum, item) => sum + item.requestCount, 0)
    if (totalRequests < 50 && Date.now() - this.lastProviderHealthFlushAt < 60_000) return
    await this.flushProviderHealth()
  }

  private async recordProviderSuccess(provider: string, metrics: Record<string, unknown> = {}) {
    this.accumulateProviderHealth(provider, {
      requestCount: 1,
      successCount: 1,
      lastSuccessAt: new Date(),
      metrics,
    })
    await this.maybeFlushProviderHealth()
  }

  private async recordProviderFailure(provider: string, error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    this.accumulateProviderHealth(provider, {
      requestCount: 1,
      failureCount: 1,
      timeoutCount: /timeout|timed out/i.test(errorMessage) ? 1 : 0,
      error4xxCount: /\b4\d\d\b/.test(errorMessage) ? 1 : 0,
      error5xxCount: /\b5\d\d\b/.test(errorMessage) ? 1 : 0,
      badDataCount: /empty|invalid|bad data/i.test(errorMessage) ? 1 : 0,
      lastFailureAt: new Date(),
      lastError: errorMessage,
    })
    await this.maybeFlushProviderHealth()
  }

  async flushProviderHealth() {
    const batches = Array.from(this.providerHealthAccumulators.values())
    if (batches.length === 0) return
    this.providerHealthAccumulators.clear()
    this.lastProviderHealthFlushAt = Date.now()
    await this.enqueueWrite(async () => {
      for (const item of batches) {
        const existing = await prisma.providerHealth.findUnique({ where: { provider: item.provider } })
        const consecutiveFailures = item.successCount > 0
          ? 0
          : (existing?.consecutiveFailures || 0) + item.failureCount
        const openCircuit = consecutiveFailures >= 5
        const backoffMs = Math.min(15 * 60_000, 2 ** Math.min(consecutiveFailures, 8) * 1000)
        const status = openCircuit ? 'open_circuit' : (item.failureCount > 0 ? 'degraded' : 'healthy')
        const circuitState = openCircuit ? 'open' : 'closed'
        const data = {
          endpoint: item.endpoint,
          status,
          circuitState,
          windowStart: item.windowStart,
          windowEnd: item.windowEnd,
          requestCount: (existing?.requestCount || 0) + item.requestCount,
          successCount: (existing?.successCount || 0) + item.successCount,
          failureCount: (existing?.failureCount || 0) + item.failureCount,
          timeoutCount: (existing?.timeoutCount || 0) + item.timeoutCount,
          error4xxCount: (existing?.error4xxCount || 0) + item.error4xxCount,
          error5xxCount: (existing?.error5xxCount || 0) + item.error5xxCount,
          badDataCount: (existing?.badDataCount || 0) + item.badDataCount,
          consecutiveFailures,
          circuitOpenedAt: openCircuit ? (existing?.circuitOpenedAt || new Date()) : null,
          nextRetryAt: openCircuit ? new Date(Date.now() + backoffMs) : null,
          cooldownUntil: openCircuit ? new Date(Date.now() + backoffMs) : null,
          lastSuccessAt: item.lastSuccessAt || existing?.lastSuccessAt || null,
          lastFailureAt: item.lastFailureAt || existing?.lastFailureAt || null,
          lastError: item.failureCount > 0 ? item.lastError || existing?.lastError || null : null,
          metricsJson: JSON.stringify(item.metrics),
          rateLimitPerMinute: existing?.rateLimitPerMinute || Number(process.env.FAMS_PROVIDER_RATE_LIMIT_PER_MINUTE || 120),
        }
        if (existing) {
          await prisma.providerHealth.update({
            where: { provider: item.provider },
            data,
          })
        } else {
          await prisma.providerHealth.create({
            data: {
              provider: item.provider,
              ...data,
            },
          })
        }
      }
    })
  }

  async getProviderHealthReport() {
    await this.flushProviderHealth()
    return prisma.providerHealth.findMany({ orderBy: { provider: 'asc' } })
  }

  private resolveCoverageStatus(item: Pick<MarketBarCoverageItem, 'cachedBars' | 'sufficient' | 'stale'>) {
    if (item.sufficient) return 'sufficient'
    if (item.stale && item.cachedBars > 0) return 'stale'
    if (item.cachedBars > 0) return 'partial'
    return 'unknown'
  }

  private async upsertCoverageReport(report: MarketBarCoverageReport, market: string, provider?: string) {
    await this.enqueueWrite(async () => {
      const now = new Date()
      const rows = report.items.map((item) => {
        const status = this.resolveCoverageStatus(item)
        const latestDate = item.latestDate ? this.parseDate(item.latestDate) : null
        return {
            symbol: item.symbol,
            market,
            timeframe: '1d',
            adjustType: 'none',
            dataVersion: 'canonical.v1',
            firstTradeDate: null,
            lastTradeDate: latestDate,
            completeFrom: null,
            completeTo: item.sufficient ? latestDate : null,
            expectedBarCount: report.requestedDays,
            actualBarCount: item.cachedBars,
            missingCount: Math.max(0, Math.min(report.requestedDays, 90) - item.cachedBars),
            missingRangesJson: JSON.stringify(item.sufficient ? [] : [{ reason: item.stale ? 'stale' : 'insufficient_bars', latestDate: item.latestDate }]),
            lastProvider: provider || null,
            lastFetchAt: provider ? now : null,
            lastValidateAt: now,
            status,
            staleReason: item.stale ? 'latest_bar_older_than_7_days' : null,
          }
      })
      for (const batch of this.chunk(rows, 1000)) {
        await prisma.$transaction(async (tx) => {
          await tx.marketDataCoverage.deleteMany({
            where: {
              market,
              timeframe: '1d',
              adjustType: 'none',
              dataVersion: 'canonical.v1',
              symbol: { in: batch.map((item) => item.symbol) },
            },
          })
          await tx.marketDataCoverage.createMany({ data: batch })
        })
      }
    })
  }

  private classifyCoverageWarning(params: {
    cachedBars: number
    latest: Date | null
    days: number
    stale: boolean
    sufficient: boolean
  }): Pick<MarketBarCoverageItem, 'warningCategory' | 'warningSeverity' | 'retryable' | 'recommendedAction'> {
    if (params.sufficient) {
      return {
        warningCategory: 'none',
        warningSeverity: 'info',
        retryable: false,
        recommendedAction: 'none',
      }
    }

    const minBars = Math.min(params.days, 90)
    if (params.cachedBars <= 0) {
      return {
        warningCategory: 'no_local_history',
        warningSeverity: 'error',
        retryable: true,
        recommendedAction: 'warmup_missing_bars',
      }
    }

    if (params.stale) {
      return {
        warningCategory: 'stale_after_preheat',
        warningSeverity: 'warning',
        retryable: true,
        recommendedAction: 'warmup_missing_bars',
      }
    }

    if (params.cachedBars < minBars && params.latest) {
      return {
        warningCategory: 'limited_listing_history',
        warningSeverity: 'info',
        retryable: false,
        recommendedAction: 'review_listing_or_suspension',
      }
    }

    if (params.cachedBars < minBars) {
      return {
        warningCategory: 'insufficient_history',
        warningSeverity: 'warning',
        retryable: true,
        recommendedAction: 'warmup_missing_bars',
      }
    }

    return {
      warningCategory: 'unknown',
      warningSeverity: 'warning',
      retryable: true,
      recommendedAction: 'review_provider_mapping',
    }
  }

  private buildCoverageItem(symbol: string, cachedBars: number, latest: Date | null, days: number): MarketBarCoverageItem {
    const minBars = Math.min(days, 90)
    const stale = latest ? latest.getTime() < Date.now() - this.staleWindowMs : true
    const sufficient = cachedBars >= minBars && !stale
    const status = this.resolveCoverageStatus({ cachedBars, sufficient, stale })
    const classification = this.classifyCoverageWarning({ cachedBars, latest, days, stale, sufficient })
    return {
      symbol,
      cachedBars,
      latestDate: latest ? this.formatDate(latest) : null,
      sufficient,
      stale,
      status,
      staleReason: stale ? 'latest_bar_older_than_7_days' : undefined,
      ...classification,
    }
  }

  private coverageRowToItem(row: {
    symbol: string
    actualBarCount: number
    lastTradeDate: Date | null
    expectedBarCount: number
    status: string
  }, days: number): MarketBarCoverageItem | null {
    if (row.expectedBarCount < Math.min(days, 90)) return null
    if (!['sufficient', 'partial', 'stale', 'failed', 'unknown'].includes(row.status)) return null
    return this.buildCoverageItem(row.symbol, row.actualBarCount, row.lastTradeDate, days)
  }

  async getCoverageReport(symbols: string[], days: number, market = 'CN', options: { forceRebuild?: boolean } = {}): Promise<MarketBarCoverageReport> {
    const uniqueSymbols = Array.from(new Set(symbols.filter((symbol) => /^\d{6}$/.test(symbol))))
    const minBars = Math.min(days, 90)
    const itemBySymbol = new Map<string, MarketBarCoverageItem>()

    if (!options.forceRebuild) {
      for (const batch of this.chunk(uniqueSymbols, 1000)) {
        const coverageRows = await prisma.marketDataCoverage.findMany({
          where: {
            symbol: { in: batch },
            market,
            timeframe: '1d',
            adjustType: 'none',
            dataVersion: 'canonical.v1',
          },
          select: {
            symbol: true,
            actualBarCount: true,
            lastTradeDate: true,
            expectedBarCount: true,
            status: true,
          },
        })
        for (const row of coverageRows) {
          const item = this.coverageRowToItem(row, days)
          if (item) itemBySymbol.set(row.symbol, item)
        }
      }
    }

    const symbolsNeedingCanonicalBackfill = uniqueSymbols.filter((symbol) => !itemBySymbol.has(symbol))
    for (const batch of this.chunk(symbolsNeedingCanonicalBackfill, 1000)) {
      const aggregates = await prisma.marketBarCanonical.groupBy({
        by: ['symbol'],
        where: {
          symbol: { in: batch },
          market,
          dataVersion: 'canonical.v1',
        },
        _count: { _all: true },
        _max: { tradeDate: true },
      })
      const aggregateBySymbol = new Map(aggregates.map((item) => [item.symbol, item]))
      for (const symbol of batch) {
        const aggregate = aggregateBySymbol.get(symbol)
        itemBySymbol.set(symbol, this.buildCoverageItem(
          symbol,
          aggregate?._count._all || 0,
          aggregate?._max.tradeDate || null,
          days,
        ))
      }
    }

    const items = uniqueSymbols.map((symbol) => itemBySymbol.get(symbol) || this.buildCoverageItem(symbol, 0, null, days))
    const sufficientSymbols = items.filter((item) => item.sufficient).length
    const staleSymbols = items.filter((item) => item.stale).length
    const retryableWarmupSymbols = items.filter((item) => !item.sufficient && item.retryable).map((item) => item.symbol)
    const nonRetryableWarningSymbols = items.filter((item) => !item.sufficient && !item.retryable).map((item) => item.symbol)
    const byCategory = items.reduce<Record<string, number>>((acc, item) => {
      const category = item.warningCategory || (item.sufficient ? 'none' : 'unknown')
      acc[category] = (acc[category] || 0) + 1
      return acc
    }, {})
    const averageCachedBars = items.length > 0
      ? Number((items.reduce((sum, item) => sum + Math.min(item.cachedBars, days), 0) / items.length).toFixed(2))
      : 0
    const report: MarketBarCoverageReport = {
      schemaVersion: 'fams.market_bar.coverage.v1',
      generatedAt: new Date().toISOString(),
      requestedDays: days,
      totalSymbols: items.length,
      sufficientSymbols,
      insufficientSymbols: items.length - sufficientSymbols,
      staleSymbols,
      averageCachedBars,
      estimatedCacheHitRate: days > 0 ? Number(((averageCachedBars / days) * 100).toFixed(2)) : 0,
      missingSymbols: items.filter((item) => item.cachedBars < minBars).map((item) => item.symbol),
      staleSymbolList: items.filter((item) => item.stale).map((item) => item.symbol),
      retryableWarmupSymbols,
      nonRetryableWarningSymbols,
      warningSummary: {
        retryableWarmupCount: retryableWarmupSymbols.length,
        nonRetryableWarningCount: nonRetryableWarningSymbols.length,
        byCategory,
      },
      items,
    }
    await this.upsertCoverageReport(report, market)
    return report
  }

  async getCachedHistory(symbol: string, days: number, options: { market?: string } = {}): Promise<MarketBarCacheResult> {
    const startedAt = Date.now()
    const market = options.market || 'CN'
    const history = await this.getCached(symbol, days, market)
    const sufficient = this.isCacheSufficient(history, days)
    return {
      history,
      stats: {
        symbol,
        provider: 'cache',
        requestedDays: days,
        returnedDays: history.length,
        cacheHits: history.length,
        cacheMisses: Math.max(0, days - history.length),
        cacheHitRate: days > 0 ? Number(((Math.min(history.length, days) / days) * 100).toFixed(2)) : 0,
        fetched: 0,
        warnings: sufficient ? [] : ['canonical cache insufficient or stale; warmup required'],
        failureCategory: sufficient ? undefined : this.classifyCacheGap(history, days)?.category,
        failureRetryable: sufficient ? undefined : this.classifyCacheGap(history, days)?.retryable,
        providerAttempts: 0,
        durationMs: Date.now() - startedAt,
      },
    }
  }

  private async getCached(symbol: string, days: number, market = 'CN') {
    const rows = await prisma.marketBarCanonical.findMany({
      where: { symbol, market, dataVersion: 'canonical.v1' },
      orderBy: { tradeDate: 'desc' },
      take: days,
    })
    return rows
      .sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime())
      .map((row) => ({
        date: this.formatDate(row.tradeDate),
        open: row.openPrice || row.closePrice,
        high: row.highPrice || row.closePrice,
        low: row.lowPrice || row.closePrice,
        close: row.closePrice,
        volume: row.volume || 0,
        source: `cache:${JSON.parse(row.sourceRefsJson || '[]')[0]?.provider || 'canonical'}`,
      }))
  }

  private isCacheSufficient(history: StockHistoryData[], days: number) {
    if (history.length < Math.min(days, 90)) return false
    const latest = history[history.length - 1]?.date
    if (!latest) return false
    const latestTime = new Date(`${latest}T00:00:00.000Z`).getTime()
    return latestTime >= Date.now() - 7 * 24 * 60 * 60 * 1000
  }

  private latestCachedDate(history: StockHistoryData[]) {
    return history[history.length - 1]?.date || null
  }

  private classifyProviderFailure(error: unknown): { category: MarketBarFailureCategory; retryable: boolean; message: string } {
    const message = error instanceof Error ? error.message : String(error)
    if (/invalid symbol|non[-_ ]?retryable|unsupported symbol/i.test(message)) {
      return { category: 'non_retryable_symbol', retryable: false, message }
    }
    if (/timeout|timed out|abort/i.test(message)) {
      return { category: 'provider_timeout', retryable: true, message }
    }
    if (/empty|no data|returned empty/i.test(message)) {
      return { category: 'empty_reply', retryable: true, message }
    }
    return { category: 'provider_error', retryable: true, message }
  }

  private classifyCacheGap(cached: StockHistoryData[], days: number): { category: MarketBarFailureCategory; retryable: boolean } | null {
    if (this.isCacheSufficient(cached, days)) return null
    if (cached.length <= 0) return { category: 'canonical_missing', retryable: true }
    const latest = this.latestCachedDate(cached)
    const latestTime = latest ? new Date(`${latest}T00:00:00.000Z`).getTime() : 0
    if (!latestTime || latestTime < Date.now() - this.staleWindowMs) {
      return { category: 'stale_cache', retryable: true }
    }
    return { category: 'canonical_missing', retryable: true }
  }

  private async fetchProviderHistoryWithRetry(symbol: string, days: number, provider: string) {
    if (!/^\d{6}$/.test(symbol)) {
      throw new Error(`non-retryable symbol: ${symbol}`)
    }

    const maxAttempts = Math.max(1, Math.min(5, Number(process.env.FAMS_PROVIDER_FETCH_RETRIES || 3)))
    const baseDelayMs = Math.max(0, Math.min(10_000, Number(process.env.FAMS_PROVIDER_RETRY_DELAY_MS || 800)))
    let lastError: unknown = new Error('provider returned empty history')
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.assertProviderUsable(provider)
        const fetched = await Promise.race([
          this.fetchProviderHistory(symbol, days, provider),
          new Promise<StockHistoryData[]>((_, reject) => setTimeout(() => reject(new Error('provider timeout after 12000ms')), 12_000)),
        ])
        if (fetched.length > 0) {
          return { history: fetched, attempts: attempt }
        }
        throw new Error('provider returned empty history')
      } catch (error) {
        lastError = error
        const classification = this.classifyProviderFailure(error)
        if (!classification.retryable || attempt >= maxAttempts) break
        const delayMs = baseDelayMs * attempt
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      }
    }
    throw lastError
  }

  private async fetchProviderHistory(symbol: string, days: number, provider: string) {
    const normalized = provider.toLowerCase()
    if (normalized.includes('eastmoney')) {
      const eastmoneyHistory = await getStockHistory(symbol, days)
      if (eastmoneyHistory.length > 0) return eastmoneyHistory
      return getSinaStockHistory(symbol, days)
    }

    const sinaHistory = await getSinaStockHistory(symbol, days)
    if (sinaHistory.length >= Math.min(days, 90)) return sinaHistory
    const fallbackHistory = await getStockHistory(symbol, days)
    return fallbackHistory.length > sinaHistory.length ? fallbackHistory : sinaHistory
  }

  async getHistory(symbol: string, days: number, options: { market?: string; provider?: string; forceRefresh?: boolean } = {}): Promise<MarketBarCacheResult> {
    const startedAt = Date.now()
    const provider = options.provider || 'sina'
    const market = options.market || 'CN'
    const warnings: string[] = []
    const cached = options.forceRefresh ? [] : await this.getCached(symbol, days, market)
    const cacheGap = this.classifyCacheGap(cached, days)
    if (this.isCacheSufficient(cached, days)) {
      return {
        history: cached,
        stats: {
          symbol,
          provider: 'cache',
          requestedDays: days,
          returnedDays: cached.length,
          cacheHits: cached.length,
          cacheMisses: 0,
          cacheHitRate: 100,
          fetched: 0,
          warnings,
          providerAttempts: 0,
          durationMs: Date.now() - startedAt,
        },
      }
    }

    let fetched: StockHistoryData[] = []
    let failureCategory: MarketBarFailureCategory | undefined = cacheGap?.category
    let failureRetryable: boolean | undefined = cacheGap?.retryable
    let providerAttempts = 0
    try {
      const providerResult = await this.fetchProviderHistoryWithRetry(symbol, days, provider)
      fetched = providerResult.history
      providerAttempts = providerResult.attempts
      if (fetched.length > 0) {
        await this.recordProviderSuccess(provider, { lastFetchedBars: fetched.length })
      } else {
        warnings.push('provider returned empty history')
        const emptyError = new Error('provider returned empty history')
        const classification = this.classifyProviderFailure(emptyError)
        failureCategory = classification.category
        failureRetryable = classification.retryable
        await this.recordProviderFailure(provider, emptyError)
      }
    } catch (error) {
      const classification = this.classifyProviderFailure(error)
      warnings.push(classification.message)
      failureCategory = classification.category
      failureRetryable = classification.retryable
      await this.recordProviderFailure(provider, error)
    }

    if (fetched.length > 0) {
      try {
        await this.enqueueUpsertBars(symbol, fetched, { market, provider })
      } catch (error) {
        warnings.push(`cache persist failed: ${error instanceof Error ? error.message : String(error)}`)
        failureCategory = 'cache_persist_failed'
        failureRetryable = true
      }
    }

    const refreshedCache = await this.getCached(symbol, days, market)
    const history = refreshedCache.length > 0 ? refreshedCache : fetched
    const refreshedSufficient = this.isCacheSufficient(refreshedCache, days)
    if (refreshedSufficient) {
      failureCategory = undefined
      failureRetryable = undefined
    } else {
      const refreshedGap = this.classifyCacheGap(refreshedCache, days)
      failureCategory = refreshedGap?.category
      failureRetryable = refreshedGap?.retryable
      if (fetched.length > 0 && refreshedGap?.category === 'stale_cache') {
        warnings.push('canonical cache remains stale after provider fetch')
      } else if (fetched.length > 0 && refreshedGap?.category === 'canonical_missing') {
        warnings.push('canonical cache remains insufficient after provider fetch')
      }
    }
    const cacheHits = cached.length
    const cacheMisses = Math.max(0, days - cacheHits)
    return {
      history,
      stats: {
        symbol,
        provider,
        requestedDays: days,
        returnedDays: history.length,
        cacheHits,
        cacheMisses,
        cacheHitRate: days > 0 ? Number(((cacheHits / days) * 100).toFixed(2)) : 0,
        fetched: fetched.length,
        warnings,
        failureCategory,
        failureRetryable,
        providerAttempts,
        durationMs: Date.now() - startedAt,
      },
    }
  }

  private async enqueueUpsertBars(symbol: string, history: StockHistoryData[], options: { market: string; provider: string }) {
    return this.enqueueWrite(() => this.upsertBars(symbol, history, options))
  }

  private async upsertBars(symbol: string, history: StockHistoryData[], options: { market: string; provider: string }) {
    const deduped = new Map<string, {
      bar: StockHistoryData
      tradeDate: Date
      qualityFlags: string[]
      rawPayloadHash: string
      rawPayload: Record<string, unknown>
    }>()

    for (const bar of history) {
      const tradeDate = this.parseDate(bar.date)
      if (!tradeDate || !Number.isFinite(bar.close) || bar.close <= 0) continue
      const qualityFlags = [
        ...(!Number.isFinite(bar.open) || bar.open <= 0 ? ['missing_open'] : []),
        ...(!Number.isFinite(bar.high) || bar.high <= 0 ? ['missing_high'] : []),
        ...(!Number.isFinite(bar.low) || bar.low <= 0 ? ['missing_low'] : []),
        ...(!Number.isFinite(bar.volume) || bar.volume < 0 ? ['invalid_volume'] : []),
      ]
      const rawPayload = { ...bar, source: bar.source || options.provider }
      const rawPayloadHash = this.hashPayload(rawPayload)
      deduped.set(this.formatDate(tradeDate), {
        bar,
        tradeDate,
        qualityFlags,
        rawPayloadHash,
        rawPayload,
      })
    }

    const rows = Array.from(deduped.values())
    if (rows.length === 0) return

    const tradeDates = rows.map((row) => row.tradeDate)
    await prisma.$transaction(async (tx) => {
      await tx.marketBarRaw.deleteMany({
        where: {
          symbol,
          market: options.market,
          provider: options.provider,
          adjustType: 'none',
          tradeDate: { in: tradeDates },
        },
      })
      await tx.marketBarCanonical.deleteMany({
        where: {
          symbol,
          market: options.market,
          adjustType: 'none',
          dataVersion: 'canonical.v1',
          tradeDate: { in: tradeDates },
        },
      })

      await tx.marketBarRaw.createMany({
        data: rows.map(({ bar, tradeDate, qualityFlags, rawPayloadHash, rawPayload }) => ({
          symbol,
          market: options.market,
          exchange: this.inferExchange(symbol),
          provider: options.provider,
          providerSymbol: symbol,
          timeframe: '1d',
          tradeDate,
          adjustType: 'none',
          openPrice: bar.open,
          highPrice: bar.high,
          lowPrice: bar.low,
          closePrice: bar.close,
          volume: bar.volume,
          amount: null,
          currency: options.market === 'CN' ? 'CNY' : null,
          timezone: 'Asia/Shanghai',
          sourceTimestamp: tradeDate,
          qualityFlagsJson: JSON.stringify(qualityFlags),
          validationStatus: qualityFlags.length > 0 ? 'valid_with_warnings' : 'valid',
          rawPayloadHash,
          rawPayloadJson: JSON.stringify(rawPayload),
          fetchedAt: new Date(),
        })),
      })

      const rawRows = await tx.marketBarRaw.findMany({
        where: {
          symbol,
          market: options.market,
          provider: options.provider,
          adjustType: 'none',
          tradeDate: { in: tradeDates },
        },
        select: {
          id: true,
          tradeDate: true,
          rawPayloadHash: true,
        },
      })
      const rawRefByDate = new Map(rawRows.map((row) => [
        this.formatDate(row.tradeDate),
        { rawId: row.id, hash: row.rawPayloadHash },
      ]))

      await tx.marketBarCanonical.createMany({
        data: rows.map(({ bar, tradeDate, qualityFlags, rawPayloadHash }) => {
          const rawRef = rawRefByDate.get(this.formatDate(tradeDate))
          return {
            symbol,
            market: options.market,
            assetId: null,
            timeframe: '1d',
            tradeDate,
            adjustType: 'none',
            openPrice: bar.open,
            highPrice: bar.high,
            lowPrice: bar.low,
            closePrice: bar.close,
            volume: bar.volume,
            amount: null,
            primaryProvider: options.provider,
            sourceRefsJson: JSON.stringify([{
              rawId: rawRef?.rawId || null,
              symbol,
              tradeDate: this.formatDate(tradeDate),
              provider: options.provider,
              hash: rawRef?.hash || rawPayloadHash,
            }]),
            consensusScore: 1,
            confidence: qualityFlags.length > 0 ? 0.85 : 1,
            validationStatus: qualityFlags.length > 0 ? 'valid_with_warnings' : 'valid',
            dataVersion: 'canonical.v1',
            qualityFlagsJson: JSON.stringify(qualityFlags),
          }
        }),
      })
    })
  }

  private inferExchange(symbol: string) {
    if (/^(6|9)/.test(symbol)) return 'SH'
    if (/^(0|2|3)/.test(symbol)) return 'SZ'
    if (/^(4|8)/.test(symbol)) return 'BJ'
    return undefined
  }
}

export const marketBarCacheService = new MarketBarCacheService()
