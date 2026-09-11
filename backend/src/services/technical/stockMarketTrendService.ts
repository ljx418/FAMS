import {
  getStockHistory,
  getStockRealtime,
  type StockHistoryData,
  type StockRealtimeData,
} from '../../utils/stockUtils.js'

export type MarketSessionStatus = 'pre_open' | 'intraday' | 'closed'
export type MarketTrend = 'bullish' | 'bearish' | 'mixed'

export interface StockMarketTrendBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  source: string
  adjustType?: 'none' | 'qfq'
}

export interface StockMarketTrendSnapshot {
  schemaVersion: 'stock.market-trend.v1'
  symbol: string
  name: string
  currency: 'CNY'
  generatedAt: string
  quote: {
    price: number
    change: number
    changePercent: number
    asOf: string
    source: string
    sessionStatus: MarketSessionStatus
    fallbackUsed: boolean
    freshnessStatus: 'fresh' | 'stale' | 'fallback'
    ageSeconds: number | null
  }
  latestClose: {
    date: string
    price: number
    source: string
  }
  indicators: {
    ma5: number
    ma10: number
    ma30: number
    asOf: string
    sampleCount: number
    trend: MarketTrend
    calculationMethod: 'simple_moving_average_completed_daily_close'
  }
  requestedTradingDays: number
  recentCloses: Array<{
    date: string
    close: number
    source: string
  }>
  history: StockMarketTrendBar[]
  historySource: string
  warnings: string[]
}

interface ChinaMarketClock {
  date: string
  minuteOfDay: number
  weekday: string
}

function getChinaMarketClock(now: Date): ChinaMarketClock {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || ''
  return {
    date: `${value('year')}-${value('month')}-${value('day')}`,
    minuteOfDay: Number(value('hour')) * 60 + Number(value('minute')),
    weekday: value('weekday'),
  }
}

function getSessionStatus(clock: ChinaMarketClock): MarketSessionStatus {
  if (clock.weekday === 'Sat' || clock.weekday === 'Sun') return 'closed'
  if (clock.minuteOfDay < 9 * 60 + 30) return 'pre_open'
  if (clock.minuteOfDay < 15 * 60) return 'intraday'
  return 'closed'
}

function round(value: number, precision = 4) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function movingAverage(bars: StockMarketTrendBar[], period: number) {
  const values = bars.slice(-period).map((bar) => bar.close)
  if (values.length < period) {
    throw new Error(`MA${period} 需要至少 ${period} 个完整交易日，当前只有 ${values.length} 个。`)
  }
  return round(values.reduce((sum, value) => sum + value, 0) / period)
}

function normalizeHistory(history: StockHistoryData[]): StockMarketTrendBar[] {
  const byDate = new Map<string, StockMarketTrendBar>()
  for (const row of history) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue
    if (![row.open, row.high, row.low, row.close].every((value) => Number.isFinite(value) && value > 0)) continue
    byDate.set(row.date, {
      date: row.date,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: Number.isFinite(row.volume) && row.volume >= 0 ? row.volume : 0,
      source: row.source || 'unknown',
      adjustType: row.adjustType,
    })
  }
  return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function isCompletedDailyBar(bar: StockMarketTrendBar, clock: ChinaMarketClock) {
  if (bar.date < clock.date) return true
  if (bar.date > clock.date) return false
  return getSessionStatus(clock) === 'closed'
}

function determineTrend(price: number, ma5: number, ma10: number, ma30: number): MarketTrend {
  if (price > ma5 && ma5 > ma10 && ma10 > ma30) return 'bullish'
  if (price < ma5 && ma5 < ma10 && ma10 < ma30) return 'bearish'
  return 'mixed'
}

export function buildStockMarketTrendSnapshot(params: {
  symbol: string
  name?: string
  requestedTradingDays?: number
  history: StockHistoryData[]
  realtime?: StockRealtimeData | null
  now?: Date
}): StockMarketTrendSnapshot {
  const now = params.now || new Date()
  const requestedTradingDays = Math.min(120, Math.max(30, Math.floor(params.requestedTradingDays || 30)))
  const clock = getChinaMarketClock(now)
  const normalized = normalizeHistory(params.history)
  const completed = normalized.filter((bar) => isCompletedDailyBar(bar, clock))
  if (completed.length < requestedTradingDays) {
    throw new Error(`完整收盘价样本不足：需要 ${requestedTradingDays} 个交易日，当前只有 ${completed.length} 个。`)
  }

  const latestCompleted = completed[completed.length - 1]
  const recentCompleted = completed.slice(-requestedTradingDays)
  const chartWarmupDays = 29
  const history = completed.slice(-(requestedTradingDays + chartWarmupDays))
  const ma5 = movingAverage(completed, 5)
  const ma10 = movingAverage(completed, 10)
  const ma30 = movingAverage(completed, 30)
  const validRealtime = params.realtime && Number.isFinite(params.realtime.price) && params.realtime.price > 0
    ? params.realtime
    : null
  const latestObservedBar = normalized[normalized.length - 1]
  const fallbackQuote = latestObservedBar || latestCompleted
  const quotePrice = validRealtime?.price || fallbackQuote.close
  const previousClose = latestCompleted.close
  const fallbackChange = quotePrice - previousClose
  const quoteChange = validRealtime?.priceChange ?? fallbackChange
  const quoteChangePercent = validRealtime?.priceChangePercent ?? (previousClose > 0 ? (fallbackChange / previousClose) * 100 : 0)
  const historySources = [...new Set(recentCompleted.map((bar) => bar.source))]
  const warnings: string[] = []
  const sessionStatus = getSessionStatus(clock)
  const realtimeAgeSeconds = validRealtime
    ? Math.max(0, Math.round((now.getTime() - validRealtime.timestamp.getTime()) / 1000))
    : null
  const realtimeFresh = realtimeAgeSeconds !== null
    && realtimeAgeSeconds <= (sessionStatus === 'intraday' ? 15 * 60 : 7 * 24 * 60 * 60)

  if (!validRealtime) warnings.push('实时行情不可用，最新价已回退到行情源最近可用价格。')
  else if (!realtimeFresh) warnings.push(`最新价时间已超出${sessionStatus === 'intraday' ? '15分钟盘中' : '7天非盘中'}新鲜度门槛，不能标记为实时。`)
  if (normalized.some((bar) => bar.date === clock.date) && getSessionStatus(clock) !== 'closed') {
    warnings.push('当日尚未收盘，MA 与最近30日收盘价均排除当日盘中K线。')
  }
  if (historySources.length > 1) warnings.push(`最近收盘价包含多个来源：${historySources.join('、')}。`)

  return {
    schemaVersion: 'stock.market-trend.v1',
    symbol: params.symbol,
    name: validRealtime?.name || params.name || params.history.find((row) => row.name)?.name || params.symbol,
    currency: 'CNY',
    generatedAt: now.toISOString(),
    quote: {
      price: round(quotePrice),
      change: round(quoteChange),
      changePercent: round(quoteChangePercent, 2),
      asOf: validRealtime?.timestamp.toISOString() || `${fallbackQuote.date}T15:00:00+08:00`,
      source: validRealtime?.source || fallbackQuote.source,
      sessionStatus,
      fallbackUsed: !validRealtime,
      freshnessStatus: !validRealtime ? 'fallback' : realtimeFresh ? 'fresh' : 'stale',
      ageSeconds: realtimeAgeSeconds,
    },
    latestClose: {
      date: latestCompleted.date,
      price: latestCompleted.close,
      source: latestCompleted.source,
    },
    indicators: {
      ma5,
      ma10,
      ma30,
      asOf: latestCompleted.date,
      sampleCount: completed.length,
      trend: determineTrend(quotePrice, ma5, ma10, ma30),
      calculationMethod: 'simple_moving_average_completed_daily_close',
    },
    requestedTradingDays,
    recentCloses: recentCompleted.map((bar) => ({
      date: bar.date,
      close: bar.close,
      source: bar.source,
    })),
    history,
    historySource: historySources.join('+') || latestCompleted.source,
    warnings,
  }
}

class StockMarketTrendService {
  async getSnapshot(symbol: string, requestedTradingDays = 30) {
    const normalizedDays = Number.isFinite(requestedTradingDays) ? requestedTradingDays : 30
    const days = Math.min(120, Math.max(30, Math.floor(normalizedDays)))
    const fetchTradingDays = days + 45
    const [history, realtime] = await Promise.all([
      getStockHistory(symbol, fetchTradingDays),
      getStockRealtime(symbol).catch(() => null),
    ])
    return buildStockMarketTrendSnapshot({
      symbol,
      requestedTradingDays: days,
      history,
      realtime,
    })
  }
}

export const stockMarketTrendService = new StockMarketTrendService()
