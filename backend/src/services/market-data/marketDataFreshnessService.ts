import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../../db/prisma.js'

export type MarketDataFreshnessStatus = 'fresh' | 'delayed' | 'stale' | 'unknown'
export type MarketDataFreshnessScope = 'active_strategy' | 'holdings' | 'dividend_low_vol' | 'all_cached'

export interface MarketDataFreshnessOptions {
  userId?: string
  scope?: MarketDataFreshnessScope
  symbols?: string[]
  limit?: number
  now?: Date
  timezone?: string
  afterCloseMinutes?: number
}

export interface MarketDataFreshnessReport {
  schemaVersion: 'fams.market_data.freshness.v1'
  generatedAt: string
  userId: string
  scope: MarketDataFreshnessScope
  timezone: string
  afterCloseMinutes: number
  expectedLatestTradeDate: string
  latestTradeDate: string | null
  status: MarketDataFreshnessStatus
  lagTradingDays: number | null
  totalSymbols: number
  freshSymbols: number
  delayedSymbols: number
  staleSymbols: number
  unknownSymbols: number
  providerSummary: Array<{ provider: string; symbolCount: number; latestTradeDate: string | null }>
  blockers: string[]
  warnings: string[]
  recommendedAction: 'none' | 'refresh_market_bar_cache' | 'run_market_bar_preheat_then_rescan'
  sampleItems: Array<{
    symbol: string
    latestTradeDate: string | null
    sourceProvider: string | null
    validationStatus: string | null
    status: MarketDataFreshnessStatus
    lagTradingDays: number | null
  }>
  source: {
    table: 'market_bar_canonical'
    dataVersion: 'canonical.v1'
    freeSourceStage: true
    tushareUpgradeAvailable: true
    note: string
  }
  allowedActions: string[]
  prohibitedActions: string[]
  notTradingAdvice: true
}

const DEFAULT_USER_ID = 'default'
export const DEFAULT_MARKET_DATA_TIMEZONE = 'Asia/Shanghai'
export const DEFAULT_MARKET_DATA_AFTER_CLOSE_MINUTES = 17 * 60
const PORTFOLIO_PROXY_SYMBOLS = ['510300', '510500', '512100', '511010', '518880']

function normalizeSymbol(symbol: string) {
  return String(symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ|SS)$/, '')
}

function isSixDigitSymbol(symbol: string) {
  return /^\d{6}$/.test(symbol)
}

function formatDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function parseDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00.000Z`)
}

function addDays(dateKey: string, days: number) {
  const date = parseDateKey(dateKey)
  date.setUTCDate(date.getUTCDate() + days)
  return formatDate(date)
}

function isWeekday(dateKey: string) {
  const day = parseDateKey(dateKey).getUTCDay()
  return day !== 0 && day !== 6
}

function previousWeekday(dateKey: string) {
  let cursor = addDays(dateKey, -1)
  while (!isWeekday(cursor)) cursor = addDays(cursor, -1)
  return cursor
}

function localDateKey(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

function localWeekday(date: Date, timezone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  }).format(date)
}

function localMinutes(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const part = (type: string) => parts.find((item) => item.type === type)?.value || '0'
  return Number(part('hour')) * 60 + Number(part('minute'))
}

function expectedLatestTradeDate(now: Date, timezone: string, afterCloseMinutes: number) {
  const today = localDateKey(now, timezone)
  const weekday = localWeekday(now, timezone)
  if (weekday === 'Sat' || weekday === 'Sun') {
    let cursor = today
    while (!isWeekday(cursor)) cursor = addDays(cursor, -1)
    return cursor
  }
  if (localMinutes(now, timezone) >= afterCloseMinutes) return today
  return previousWeekday(today)
}

function tradingDayLag(latestTradeDate: string | null, expectedTradeDate: string) {
  if (!latestTradeDate) return null
  if (latestTradeDate >= expectedTradeDate) return 0
  let lag = 0
  let cursor = latestTradeDate
  while (cursor < expectedTradeDate) {
    cursor = addDays(cursor, 1)
    if (isWeekday(cursor)) lag += 1
  }
  return lag
}

function statusFromLag(lagTradingDays: number | null): MarketDataFreshnessStatus {
  if (lagTradingDays === null) return 'unknown'
  if (lagTradingDays <= 0) return 'fresh'
  if (lagTradingDays <= 1) return 'delayed'
  return 'stale'
}

function maxStatus(items: Array<{ status: MarketDataFreshnessStatus }>): MarketDataFreshnessStatus {
  if (items.length === 0) return 'unknown'
  if (items.some((item) => item.status === 'unknown')) return 'unknown'
  if (items.some((item) => item.status === 'stale')) return 'stale'
  if (items.some((item) => item.status === 'delayed')) return 'delayed'
  return 'fresh'
}

export class MarketDataFreshnessService {
  expectedLatestTradeDate(now = new Date(), timezone = DEFAULT_MARKET_DATA_TIMEZONE, afterCloseMinutes = DEFAULT_MARKET_DATA_AFTER_CLOSE_MINUTES) {
    return expectedLatestTradeDate(now, timezone, afterCloseMinutes)
  }

  tradingDayLag(latestTradeDate: string | null, expectedTradeDate: string) {
    return tradingDayLag(latestTradeDate, expectedTradeDate)
  }

  async collectRelevantSymbols(options: MarketDataFreshnessOptions = {}) {
    const userId = options.userId || DEFAULT_USER_ID
    const scope = options.scope || 'active_strategy'
    const limit = Math.max(1, Math.min(6000, Number(options.limit || 300)))
    const explicitSymbols = Array.from(new Set((options.symbols || [])
      .map(normalizeSymbol)
      .filter(isSixDigitSymbol)))
    if (explicitSymbols.length > 0) return explicitSymbols.slice(0, limit)

    const symbols: string[] = []
    if (scope === 'active_strategy' || scope === 'holdings') {
      const positions = await prisma.position.findMany({
        where: { userId, status: 'open' },
        include: { asset: true },
        orderBy: [{ marketValue: 'desc' }, { updatedAt: 'desc' }],
        take: limit,
      })
      symbols.push(...positions.map((position) => normalizeSymbol(position.asset?.symbol || '')).filter(isSixDigitSymbol))
    }

    if (scope === 'active_strategy' || scope === 'dividend_low_vol') {
      const latestCandidates = await prisma.dividendLowVolDaily.findMany({
        where: { userId },
        select: { symbol: true },
        orderBy: [{ tradeDate: 'desc' }, { evidenceAdjustedScore: 'desc' }],
        distinct: ['symbol'],
        take: limit,
      })
      symbols.push(...latestCandidates.map((item) => normalizeSymbol(item.symbol)).filter(isSixDigitSymbol))
    }

    if (scope === 'active_strategy') {
      symbols.push(...PORTFOLIO_PROXY_SYMBOLS)
    }

    if (scope === 'all_cached' || symbols.length === 0) {
      const cachedSymbols = await prisma.marketBarCanonical.findMany({
        where: { market: 'CN', dataVersion: 'canonical.v1' },
        select: { symbol: true },
        orderBy: { updatedAt: 'desc' },
        distinct: ['symbol'],
        take: limit,
      })
      symbols.push(...cachedSymbols.map((item) => normalizeSymbol(item.symbol)).filter(isSixDigitSymbol))
    }

    return Array.from(new Set(symbols)).slice(0, limit)
  }

  async buildReport(options: MarketDataFreshnessOptions = {}): Promise<MarketDataFreshnessReport> {
    const userId = options.userId || DEFAULT_USER_ID
    const scope = options.scope || 'active_strategy'
    const timezone = options.timezone || DEFAULT_MARKET_DATA_TIMEZONE
    const afterCloseMinutes = options.afterCloseMinutes ?? DEFAULT_MARKET_DATA_AFTER_CLOSE_MINUTES
    const expected = expectedLatestTradeDate(options.now || new Date(), timezone, afterCloseMinutes)
    const symbols = await this.collectRelevantSymbols({ ...options, userId, scope })

    const items: MarketDataFreshnessReport['sampleItems'] = []
    for (let index = 0; index < symbols.length; index += 1000) {
      const batch = symbols.slice(index, index + 1000)
      const rows = await prisma.marketBarCanonical.findMany({
        where: {
          symbol: { in: batch },
          market: 'CN',
          dataVersion: 'canonical.v1',
        },
        select: {
          symbol: true,
          tradeDate: true,
          primaryProvider: true,
          validationStatus: true,
        },
        orderBy: [{ symbol: 'asc' }, { tradeDate: 'desc' }],
        distinct: ['symbol'],
      })
      const rowBySymbol = new Map(rows.map((row) => [row.symbol, row]))
      for (const symbol of batch) {
        const row = rowBySymbol.get(symbol)
        const latestTradeDate = row?.tradeDate ? formatDate(row.tradeDate) : null
        const lagTradingDays = tradingDayLag(latestTradeDate, expected)
        items.push({
          symbol,
          latestTradeDate,
          sourceProvider: row?.primaryProvider || null,
          validationStatus: row?.validationStatus || null,
          status: statusFromLag(lagTradingDays),
          lagTradingDays,
        })
      }
    }

    const latestTradeDate = items
      .map((item) => item.latestTradeDate)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null
    const lagTradingDays = tradingDayLag(latestTradeDate, expected)
    const status = maxStatus(items)
    const providerAccumulator = new Map<string, { provider: string; symbolCount: number; latestTradeDate: string | null }>()
    for (const item of items) {
      const provider = item.sourceProvider || 'unknown'
      const current = providerAccumulator.get(provider) || { provider, symbolCount: 0, latestTradeDate: null }
      current.symbolCount += 1
      if (item.latestTradeDate && (!current.latestTradeDate || item.latestTradeDate > current.latestTradeDate)) {
        current.latestTradeDate = item.latestTradeDate
      }
      providerAccumulator.set(provider, current)
    }

    const blockers = status === 'fresh' || status === 'delayed' ? [] : [`market_bar_freshness_${status}`]
    const warnings = [
      ...(status === 'delayed' ? [`最新行情比预期交易日 ${expected} 晚 1 个交易日；免费数据源可能收盘后延迟。`] : []),
      ...(status === 'stale' ? [`最新行情 ${latestTradeDate || '未知'} 未达到预期交易日 ${expected}，需要先刷新 K 线。`] : []),
      ...(status === 'unknown' ? ['当前范围没有可验证的本地 K 线行情，需要先预热行情缓存。'] : []),
      '当前为免费数据源研究阶段，Tushare token 接口保留为后续升级项。',
    ]

    return {
      schemaVersion: 'fams.market_data.freshness.v1',
      generatedAt: new Date().toISOString(),
      userId,
      scope,
      timezone,
      afterCloseMinutes,
      expectedLatestTradeDate: expected,
      latestTradeDate,
      status,
      lagTradingDays,
      totalSymbols: items.length,
      freshSymbols: items.filter((item) => item.status === 'fresh').length,
      delayedSymbols: items.filter((item) => item.status === 'delayed').length,
      staleSymbols: items.filter((item) => item.status === 'stale').length,
      unknownSymbols: items.filter((item) => item.status === 'unknown').length,
      providerSummary: Array.from(providerAccumulator.values()).sort((a, b) => b.symbolCount - a.symbolCount),
      blockers,
      warnings,
      recommendedAction: status === 'fresh' ? 'none' : status === 'delayed' ? 'refresh_market_bar_cache' : 'run_market_bar_preheat_then_rescan',
      sampleItems: items.slice(0, 100),
      source: {
        table: 'market_bar_canonical',
        dataVersion: 'canonical.v1',
        freeSourceStage: true,
        tushareUpgradeAvailable: true,
        note: 'Freshness gate checks local canonical daily bars from free providers. It does not certify formal trading data.',
      },
      allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      notTradingAdvice: true,
    }
  }

  async writeAudit(report: MarketDataFreshnessReport, options: { dir?: string } = {}) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = options.dir || resolve(process.cwd(), 'data', 'gpt-audit', 'market-data-freshness', timestamp)
    await mkdir(dir, { recursive: true })
    const path = resolve(dir, 'market_data_freshness_audit.json')
    await writeFile(path, JSON.stringify(report, null, 2), 'utf8')
    return { dir, path }
  }
}

export const marketDataFreshnessService = new MarketDataFreshnessService()
