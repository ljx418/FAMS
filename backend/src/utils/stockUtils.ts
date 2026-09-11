/**
 * Stock Utils - 股票数据获取工具
 *
 * 职责：封装股票相关数据获取逻辑，从各种数据源获取真实数据
 */

import axios from 'axios'
import iconv from 'iconv-lite'
import { compactHttpError, getJson, getJsonWithCurlOnly, getTextWithCurlOnly } from './httpJson.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface StockRealtimeData {
  symbol: string
  name: string
  price: number
  priceChange: number
  priceChangePercent: number
  open?: number
  high?: number
  low?: number
  volume?: number
  turnover?: number
  timestamp: Date
  source: string
}

export interface StockHistoryData {
  date: string
  name?: string
  open: number
  high: number
  low: number
  close: number
  volume: number
  amount?: number
  source?: string
  adjustType?: 'none' | 'qfq'
}

export type HistoryProviderAttemptStatus = 'success' | 'partial' | 'empty' | 'failed' | 'skipped'

export interface HistoryProviderAttempt {
  provider: string
  status: HistoryProviderAttemptStatus
  requestedDays: number
  returnedDays: number
  firstDate: string | null
  lastDate: string | null
  durationMs: number
  reason?: string
}

export interface SmartHistoryResult {
  history: StockHistoryData[]
  selectedProvider: string | null
  attempts: HistoryProviderAttempt[]
}

export interface AShareStockItem {
  symbol: string
  name: string
  exchange: 'SH' | 'SZ' | 'BJ'
  market: 'CN'
  type: 'stock'
  source: string
}

export interface ChinaIndexIdentity {
  symbol: string
  sinaSymbol: string
  exchange: 'SH' | 'SZ'
  name: string
  /**
   * The official China Securities Index performance API uses the bare index
   * code (including the H-prefixed codes), rather than an exchange symbol.
   * Keeping it explicit avoids treating a CSI index as a listed security.
   */
  csindexCode?: string
  /**
   * Some CSI theme and industry indexes are not exchange-traded `.SH`/`.SZ`
   * instruments.  Eastmoney assigns them a distinct quote identity (for
   * example `2.H30184`).  Keep that provider identity explicit instead of
   * inferring an exchange from a six-digit-looking code.
   */
  eastmoneySecid?: string
  /** Yahoo's index identity, where it publishes the same CSI price index. */
  yahooSymbol?: string
}

let aShareUniverseCache: {
  loadedAt: number
  items: AShareStockItem[]
} | null = null

const A_SHARE_UNIVERSE_CACHE_TTL_MS = 6 * 60 * 60 * 1000
const A_SHARE_UNIVERSE_PERSISTENT_CACHE_FILE = process.env.FAMS_A_SHARE_UNIVERSE_CACHE_FILE ||
  resolve(dirname(fileURLToPath(import.meta.url)), '../../data/a-share-universe-cache.json')

function getChinaStockExchange(stockCode: string): 'SH' | 'SZ' | 'BJ' {
  if (/^(5)\d{5}$/.test(stockCode)) return 'SH'
  if (/^(1)\d{5}$/.test(stockCode)) return 'SZ'
  if (/^(60|68|90)\d{4}$/.test(stockCode)) return 'SH'
  if (/^(8|4|9)\d{5}$/.test(stockCode)) return 'BJ'
  return 'SZ'
}

function getSinaMarketPrefix(stockCode: string) {
  const exchange = getChinaStockExchange(stockCode)
  if (exchange === 'SH') return 'sh'
  if (exchange === 'BJ') return 'bj'
  return 'sz'
}

function getEastmoneySecid(stockCode: string) {
  const exchange = getChinaStockExchange(stockCode)
  if (exchange === 'SH') return `1.${stockCode}`
  if (exchange === 'BJ') return `0.${stockCode}`
  return `0.${stockCode}`
}

interface HistoryProviderCandidate {
  provider: string
  fetch: () => Promise<StockHistoryData[]>
}

const historyProviderCircuits = new Map<string, { consecutiveFailures: number; openUntil: number }>()
const HISTORY_PROVIDER_FAILURE_THRESHOLD = 2
const HISTORY_PROVIDER_COOLDOWN_MS = 5 * 60 * 1000

function normalizeHistory(history: StockHistoryData[], adjustType: 'none' | 'qfq') {
  const byDate = new Map<string, StockHistoryData>()
  for (const row of history) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue
    if (![row.open, row.high, row.low, row.close].every((value) => Number.isFinite(value) && value > 0)) continue
    if (row.high < Math.max(row.open, row.close) || row.low > Math.min(row.open, row.close)) continue
    byDate.set(row.date, {
      ...row,
      volume: Number.isFinite(row.volume) && row.volume >= 0 ? row.volume : 0,
      adjustType,
    })
  }
  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date))
}

function isHistoryFresh(history: StockHistoryData[]) {
  const latest = history.at(-1)?.date
  if (!latest) return false
  const latestTime = new Date(`${latest}T00:00:00.000Z`).getTime()
  return Number.isFinite(latestTime) && latestTime >= Date.now() - 14 * 24 * 60 * 60 * 1000
}

async function fetchSmartHistory(
  candidates: HistoryProviderCandidate[],
  requestedDays: number,
  adjustType: 'none' | 'qfq',
): Promise<SmartHistoryResult> {
  const attempts: HistoryProviderAttempt[] = []
  const requiredDays = requestedDays
  let best: { provider: string; history: StockHistoryData[] } | null = null

  for (const candidate of candidates) {
    const circuit = historyProviderCircuits.get(candidate.provider)
    if (circuit?.openUntil && circuit.openUntil > Date.now()) {
      attempts.push({
        provider: candidate.provider,
        status: 'skipped',
        requestedDays,
        returnedDays: 0,
        firstDate: null,
        lastDate: null,
        durationMs: 0,
        reason: `circuit_open_until:${new Date(circuit.openUntil).toISOString()}`,
      })
      continue
    }

    const startedAt = Date.now()
    try {
      const history = normalizeHistory(await candidate.fetch(), adjustType)
      const fresh = isHistoryFresh(history)
      const sufficient = history.length >= requiredDays && fresh
      attempts.push({
        provider: candidate.provider,
        status: history.length === 0 ? 'empty' : sufficient ? 'success' : 'partial',
        requestedDays,
        returnedDays: history.length,
        firstDate: history[0]?.date || null,
        lastDate: history.at(-1)?.date || null,
        durationMs: Date.now() - startedAt,
        ...(!fresh && history.length > 0 ? { reason: 'latest_bar_is_stale' } : {}),
      })

      if (history.length > (best?.history.length || 0)) best = { provider: candidate.provider, history }
      if (sufficient) {
        historyProviderCircuits.set(candidate.provider, { consecutiveFailures: 0, openUntil: 0 })
        return { history, selectedProvider: candidate.provider, attempts }
      }

      // A newly listed asset can legitimately return fewer rows than requested.
      // Fresh partial coverage is useful and must not trip the provider circuit.
      if (history.length > 0 && fresh) {
        historyProviderCircuits.set(candidate.provider, { consecutiveFailures: 0, openUntil: 0 })
      } else {
        const consecutiveFailures = (circuit?.consecutiveFailures || 0) + 1
        historyProviderCircuits.set(candidate.provider, {
          consecutiveFailures,
          openUntil: consecutiveFailures >= HISTORY_PROVIDER_FAILURE_THRESHOLD
            ? Date.now() + HISTORY_PROVIDER_COOLDOWN_MS
            : 0,
        })
      }
    } catch (error) {
      const consecutiveFailures = (circuit?.consecutiveFailures || 0) + 1
      historyProviderCircuits.set(candidate.provider, {
        consecutiveFailures,
        openUntil: consecutiveFailures >= HISTORY_PROVIDER_FAILURE_THRESHOLD
          ? Date.now() + HISTORY_PROVIDER_COOLDOWN_MS
          : 0,
      })
      attempts.push({
        provider: candidate.provider,
        status: 'failed',
        requestedDays,
        returnedDays: 0,
        firstDate: null,
        lastDate: null,
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    history: best?.history || [],
    selectedProvider: best?.provider || null,
    attempts,
  }
}

const CHINA_INDEX_MAP: Record<string, ChinaIndexIdentity> = {
  '000001': { symbol: '000001.SH', sinaSymbol: 'sh000001', exchange: 'SH', name: '上证指数' },
  '000001.SH': { symbol: '000001.SH', sinaSymbol: 'sh000001', exchange: 'SH', name: '上证指数' },
  sh000001: { symbol: '000001.SH', sinaSymbol: 'sh000001', exchange: 'SH', name: '上证指数' },
  '000300': { symbol: '000300.SH', sinaSymbol: 'sh000300', exchange: 'SH', name: '沪深300' },
  '000300.SH': { symbol: '000300.SH', sinaSymbol: 'sh000300', exchange: 'SH', name: '沪深300' },
  sh000300: { symbol: '000300.SH', sinaSymbol: 'sh000300', exchange: 'SH', name: '沪深300' },
  '000905': { symbol: '000905.SH', sinaSymbol: 'sh000905', exchange: 'SH', name: '中证500' },
  '000905.SH': { symbol: '000905.SH', sinaSymbol: 'sh000905', exchange: 'SH', name: '中证500' },
  sh000905: { symbol: '000905.SH', sinaSymbol: 'sh000905', exchange: 'SH', name: '中证500' },
  '000852': { symbol: '000852.SH', sinaSymbol: 'sh000852', exchange: 'SH', name: '中证1000' },
  '000852.SH': { symbol: '000852.SH', sinaSymbol: 'sh000852', exchange: 'SH', name: '中证1000' },
  sh000852: { symbol: '000852.SH', sinaSymbol: 'sh000852', exchange: 'SH', name: '中证1000' },
  '000688': { symbol: '000688.SH', sinaSymbol: 'sh000688', exchange: 'SH', name: '科创50' },
  '000688.SH': { symbol: '000688.SH', sinaSymbol: 'sh000688', exchange: 'SH', name: '科创50' },
  sh000688: { symbol: '000688.SH', sinaSymbol: 'sh000688', exchange: 'SH', name: '科创50' },
  '399006': { symbol: '399006.SZ', sinaSymbol: 'sz399006', exchange: 'SZ', name: '创业板指' },
  '399006.SZ': { symbol: '399006.SZ', sinaSymbol: 'sz399006', exchange: 'SZ', name: '创业板指' },
  sz399006: { symbol: '399006.SZ', sinaSymbol: 'sz399006', exchange: 'SZ', name: '创业板指' },
}

/**
 * Vetted CSI indexes used by the domestic AI supply-chain RRG research.
 *
 * The canonical symbols deliberately retain the CSI namespace.  In
 * particular, H-prefixed indexes cannot be represented truthfully as either
 * Shanghai or Shenzhen exchange indexes.  The alias map below accepts common
 * user input while emitting one stable canonical symbol and target key.
 */
const CSI_RESEARCH_INDEXES: Array<ChinaIndexIdentity & { aliases: string[] }> = [
  {
    symbol: '930708.CSI',
    sinaSymbol: 'sh930708',
    exchange: 'SH',
    csindexCode: '930708',
    eastmoneySecid: '1.930708',
    yahooSymbol: '930708.SS',
    name: '中证有色金属指数',
    aliases: ['930708', '930708.CSI', '930708.SH', 'SH930708'],
  },
  {
    symbol: 'H30199.CSI',
    sinaSymbol: 'shH30199',
    exchange: 'SH',
    csindexCode: 'H30199',
    eastmoneySecid: '2.H30199',
    yahooSymbol: 'H30199.SS',
    name: '中证全指电力公用事业指数',
    aliases: ['H30199', 'H30199.CSI'],
  },
  {
    symbol: 'H30184.CSI',
    sinaSymbol: 'shH30184',
    exchange: 'SH',
    csindexCode: 'H30184',
    eastmoneySecid: '2.H30184',
    yahooSymbol: 'H30184.SS',
    name: '中证全指半导体产品与设备指数',
    aliases: ['H30184', 'H30184.CSI'],
  },
  {
    symbol: '930851.CSI',
    sinaSymbol: 'sh930851',
    exchange: 'SH',
    csindexCode: '930851',
    eastmoneySecid: '1.930851',
    yahooSymbol: '930851.SS',
    name: '中证云计算与大数据主题指数',
    aliases: ['930851', '930851.CSI', '930851.SH', 'SH930851'],
  },
  {
    symbol: '930601.CSI',
    sinaSymbol: 'sh930601',
    exchange: 'SH',
    csindexCode: '930601',
    eastmoneySecid: '1.930601',
    yahooSymbol: '930601.SS',
    name: '中证软件服务指数',
    aliases: ['930601', '930601.CSI', '930601.SH', 'SH930601'],
  },
  {
    symbol: '930713.CSI',
    sinaSymbol: 'sh930713',
    exchange: 'SH',
    csindexCode: '930713',
    eastmoneySecid: '1.930713',
    yahooSymbol: '930713.SS',
    name: '中证人工智能主题指数',
    aliases: ['930713', '930713.CSI', '930713.SH', 'SH930713'],
  },
]

for (const index of CSI_RESEARCH_INDEXES) {
  const { aliases, ...identity } = index
  for (const alias of aliases) {
    CHINA_INDEX_MAP[alias] = identity
    CHINA_INDEX_MAP[alias.toUpperCase()] = identity
  }
}

export function resolveChinaIndexIdentity(symbol: string, fallbackName?: string): ChinaIndexIdentity | null {
  const raw = String(symbol || '').trim()
  if (!raw) return null

  const normalized = raw.toUpperCase()
  const direct = CHINA_INDEX_MAP[raw] || CHINA_INDEX_MAP[normalized]
  if (direct) {
    return fallbackName && fallbackName !== direct.name ? { ...direct, name: fallbackName } : direct
  }

  const compact = normalized.replace(/\.(SH|SZ|CSI)$/, '')
  const mapped = CHINA_INDEX_MAP[compact]
  if (mapped) {
    return fallbackName && fallbackName !== mapped.name ? { ...mapped, name: fallbackName } : mapped
  }

  if (/^SH\d{6}$/i.test(raw)) {
    const code = raw.slice(2)
    return { symbol: `${code}.SH`, sinaSymbol: `sh${code}`, exchange: 'SH', name: fallbackName || raw }
  }

  if (/^SZ\d{6}$/i.test(raw)) {
    const code = raw.slice(2)
    return { symbol: `${code}.SZ`, sinaSymbol: `sz${code}`, exchange: 'SZ', name: fallbackName || raw }
  }

  if (/^\d{6}\.SH$/.test(normalized)) {
    const code = normalized.slice(0, 6)
    return { symbol: normalized, sinaSymbol: `sh${code}`, exchange: 'SH', name: fallbackName || normalized }
  }

  if (/^\d{6}\.SZ$/.test(normalized)) {
    const code = normalized.slice(0, 6)
    return { symbol: normalized, sinaSymbol: `sz${code}`, exchange: 'SZ', name: fallbackName || normalized }
  }

  return null
}

/**
 * 获取A股实时价格
 * 数据来源：东方财富
 */
export async function getChinaStockRealtime(stockCode: string): Promise<StockRealtimeData | null> {
  try {
    // 东方财富实时行情接口
    const response = await getJson<{ data?: Record<string, any> }>(
      `https://push2.eastmoney.com/api/qt/stock/get`,
      {
        params: {
          secid: getEastmoneySecid(stockCode),
          fields: 'f43,f44,f45,f46,f47,f48,f57,f58,f107,f169,f170,f171',
          ut: 'fa5fd1943c7b386f172d6893dbfba10b',
          fltt: 2,
          invt: 2,
        },
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 5000,
      }
    )

    const data = response.data
    if (!data) return null

    return {
      symbol: stockCode,
      name: data.f58 || stockCode,
      price: parseFloat(data.f43) || 0,
      priceChange: parseFloat(data.f169) || 0,
      priceChangePercent: parseFloat(data.f170) || 0,
      open: parseFloat(data.f46) || 0,
      high: parseFloat(data.f44) || 0,
      low: parseFloat(data.f45) || 0,
      volume: data.f48 || 0,
      timestamp: new Date(),
      source: 'eastmoney',
    }
  } catch (error) {
    console.error(`Failed to fetch China stock realtime for ${stockCode}:`, compactHttpError(error))
    return null
  }
}

async function getSinaStockRealtime(stockCode: string): Promise<StockRealtimeData | null> {
  try {
    const marketPrefix = getSinaMarketPrefix(stockCode)
    const response = await axios.get(`http://hq.sinajs.cn/list=${marketPrefix}${stockCode}`, {
      headers: {
        Referer: 'https://finance.sina.com.cn',
        'User-Agent': 'Mozilla/5.0',
      },
      responseType: 'arraybuffer',
      timeout: 10000,
    })

    const text = iconv.decode(Buffer.from(response.data), 'gb18030')
    const match = text.match(/="(.+)";/)
    if (!match) return null

    const fields = match[1].split(',')
    const name = fields[0]
    const open = parseFloat(fields[1]) || 0
    const previousClose = parseFloat(fields[2]) || 0
    const price = parseFloat(fields[3]) || previousClose || open
    const high = parseFloat(fields[4]) || price
    const low = parseFloat(fields[5]) || price
    const volume = parseInt(fields[8], 10) || 0
    const turnover = parseFloat(fields[9]) || 0
    const priceChange = previousClose > 0 ? price - previousClose : 0
    const priceChangePercent = previousClose > 0 ? (priceChange / previousClose) * 100 : 0

    if (!name || !price) return null

    return {
      symbol: stockCode,
      name,
      price,
      priceChange,
      priceChangePercent,
      open,
      high,
      low,
      volume,
      turnover,
      timestamp: new Date(),
      source: 'sina',
    }
  } catch (error) {
    console.error(`Failed to fetch Sina stock realtime for ${stockCode}:`, compactHttpError(error))
    return null
  }
}

/**
 * 获取A股历史K线数据
 * 数据来源：东方财富
 */
/**
 * 获取东方财富 A 股前复权日线。
 *
 * 与 getChinaStockHistory 不同，这个严格入口不会回退到不复权数据，适合
 * 相对轮动、回测等必须保证复权口径一致的研究链路。
 */
export async function getEastmoneyQfqStockHistory(
  stockCode: string,
  days: number = 30
): Promise<StockHistoryData[]> {
  try {
    const endDate = new Date()
    const startDate = new Date()
    const calendarLookbackDays = Math.ceil(days * (365 / 252)) + 14
    startDate.setDate(startDate.getDate() - calendarLookbackDays)

    const startDateStr = startDate.toISOString().split('T')[0].replace(/-/g, '')
    const endDateStr = endDate.toISOString().split('T')[0].replace(/-/g, '')

    // 东方财富K线接口
    const response = await getJson<{ data?: { name?: string; klines?: string[] } }>(
      `https://push2his.eastmoney.com/api/qt/stock/kline/get`,
      {
        params: {
          secid: getEastmoneySecid(stockCode),
          fields1: 'f1,f2,f3,f4,f5,f6',
          fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
          klt: '101', // 日K线
          fqt: '1', // 前复权
          beg: startDateStr,
          end: endDateStr,
          lmt: days,
        },
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 5000,
      }
    )

    const data = response.data
    if (!data?.klines) return []

    return data.klines.map((line: string) => {
      const [date, open, close, high, low, volume] = line.split(',')
      return {
        date,
        name: data.name,
        open: parseFloat(open),
        close: parseFloat(close),
        high: parseFloat(high),
        low: parseFloat(low),
        volume: parseInt(volume),
        source: 'eastmoney',
        adjustType: 'qfq',
      }
    })
  } catch (error) {
    console.error(`Failed to fetch Eastmoney qfq history for ${stockCode}:`, compactHttpError(error))
    return []
  }
}

interface TencentKlineResponse {
  code?: number
  msg?: string
  data?: Record<string, {
    qfqday?: Array<Array<string | number>>
    day?: Array<Array<string | number>>
  }>
}

function parseTencentKlineRows(
  payload: TencentKlineResponse,
  marketSymbol: string,
  adjustType: 'none' | 'qfq',
  provider: string,
) {
  if (payload.code !== undefined && payload.code !== 0) {
    throw new Error(`Tencent history error ${payload.code}: ${payload.msg || 'unknown error'}`)
  }
  const data = payload.data?.[marketSymbol]
  // Newly listed securities without any corporate action may not expose a
  // separate qfqday array. In that case the adjustment factor is effectively
  // 1, so the same-provider day series is the valid qfq fallback.
  const rows = adjustType === 'qfq' ? (data?.qfqday || data?.day) : data?.day
  return (rows || []).map((row) => ({
    date: String(row[0] || ''),
    open: Number(row[1]),
    close: Number(row[2]),
    high: Number(row[3]),
    low: Number(row[4]),
    volume: Number(row[5]) || 0,
    source: provider,
    adjustType,
  }))
}

const shiftIsoDate = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

async function getTencentHistoryPages(params: {
  marketSymbol: string
  days: number
  adjustType: 'none' | 'qfq'
  provider: string
}) {
  const requestedDays = Math.max(120, Math.min(3000, Math.floor(params.days)))
  const byDate = new Map<string, StockHistoryData>()
  let endDate = ''
  let previousOldest = ''

  // Tencent returns at most 800 daily rows per request. Keep every page on the
  // same provider/adjustment basis, paging backwards from the oldest row.
  for (let page = 0; page < Math.ceil(requestedDays / 800) + 1; page += 1) {
    const remaining = requestedDays - byDate.size
    if (remaining <= 0) break
    const count = Math.min(800, Math.max(120, remaining))
    const response = await getJson<TencentKlineResponse>(
      'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
      {
        params: {
          param: `${params.marketSymbol},day,,${endDate},${count},${params.adjustType === 'qfq' ? 'qfq' : 'bfq'}`,
        },
        headers: {
          Referer: 'https://gu.qq.com/',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 10000,
      },
    )
    const rows = parseTencentKlineRows(response, params.marketSymbol, params.adjustType, params.provider)
    if (rows.length === 0) break
    for (const row of rows) byDate.set(row.date, row)
    const oldest = rows.reduce((value, row) => row.date < value ? row.date : value, rows[0].date)
    if (!oldest || oldest === previousOldest) break
    previousOldest = oldest
    endDate = shiftIsoDate(oldest, -1)
    if (!endDate || rows.length < count) break
  }

  return Array.from(byDate.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-requestedDays)
}

export async function getTencentQfqStockHistory(
  stockCode: string,
  days: number = 756,
): Promise<StockHistoryData[]> {
  try {
    const marketSymbol = `${getSinaMarketPrefix(stockCode)}${stockCode}`
    return getTencentHistoryPages({
      marketSymbol,
      days,
      adjustType: 'qfq',
      provider: 'tencent_qfq',
    })
  } catch (error) {
    console.error(`Failed to fetch Tencent qfq history for ${stockCode}:`, compactHttpError(error))
    return []
  }
}

export async function getTencentRawStockHistory(
  stockCode: string,
  days: number = 756,
): Promise<StockHistoryData[]> {
  try {
    const marketSymbol = `${getSinaMarketPrefix(stockCode)}${stockCode}`
    return getTencentHistoryPages({
      marketSymbol,
      days,
      adjustType: 'none',
      provider: 'tencent_raw',
    })
  } catch (error) {
    console.error(`Failed to fetch Tencent raw history for ${stockCode}:`, compactHttpError(error))
    return []
  }
}

/**
 * Fetch the Sina domestic-futures continuous-contract daily series.
 *
 * This endpoint returns JSONP rather than JSON.  The helper intentionally
 * exposes it as research-grade history so callers can disclose the roll and
 * basis risk when a continuous future is used as an ETF pre-inception proxy.
 */
export async function getSinaDomesticFuturesHistory(
  symbol: string,
  days: number = 756,
): Promise<StockHistoryData[]> {
  try {
    const normalizedSymbol = String(symbol || '').trim().toUpperCase()
    if (!/^[A-Z]{1,3}0$/.test(normalizedSymbol)) return []
    const raw = await getTextWithCurlOnly(
      `https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_${normalizedSymbol}=/InnerFuturesNewService.getDailyKLine`,
      {
        params: { symbol: normalizedSymbol },
        headers: {
          Referer: 'https://finance.sina.com.cn/futures/',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 10000,
      },
    )
    const start = raw.indexOf('([')
    const end = raw.lastIndexOf('])')
    if (start < 0 || end <= start) return []
    const rows = JSON.parse(raw.slice(start + 1, end + 1)) as Array<{
      d?: string
      o?: string
      h?: string
      l?: string
      c?: string
      v?: string
    }>
    return normalizeHistory(rows.map((row) => ({
      date: String(row.d || ''),
      open: Number(row.o),
      high: Number(row.h),
      low: Number(row.l),
      close: Number(row.c),
      volume: Number(row.v) || 0,
      source: `sina_domestic_futures_continuous:${normalizedSymbol}`,
      adjustType: 'none' as const,
    })), 'none').slice(-Math.max(120, Math.min(3000, Math.floor(days))))
  } catch (error) {
    console.error(`Failed to fetch Sina domestic futures history for ${symbol}:`, compactHttpError(error))
    return []
  }
}

export async function getSmartQfqStockHistory(
  stockCode: string,
  days: number = 756,
): Promise<SmartHistoryResult> {
  const requestedDays = Math.max(120, Math.min(3000, Math.floor(days)))
  return fetchSmartHistory([
    { provider: 'eastmoney_qfq', fetch: () => getEastmoneyQfqStockHistory(stockCode, requestedDays) },
    { provider: 'tencent_qfq', fetch: () => getTencentQfqStockHistory(stockCode, requestedDays) },
  ], requestedDays, 'qfq')
}

export async function getChinaStockHistory(
  stockCode: string,
  days: number = 30
): Promise<StockHistoryData[]> {
  const adjusted = await getSmartQfqStockHistory(stockCode, days)
  if (adjusted.history.length > 0) return adjusted.history

  const sinaHistory = await getSinaStockHistory(stockCode, days)
  if (sinaHistory.length > 0) return sinaHistory

  console.error(`Failed to fetch China stock history for ${stockCode}`)
  return []
}

export async function getSinaStockHistory(stockCode: string, days: number): Promise<StockHistoryData[]> {
  try {
    const marketPrefix = getSinaMarketPrefix(stockCode)
    const rows = await getJsonWithCurlOnly<Array<{
      day?: string
      open?: string
      high?: string
      low?: string
      close?: string
      volume?: string
    }>>(
      'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketData.getKLineData',
      {
        params: {
          symbol: `${marketPrefix}${stockCode}`,
          scale: 240,
          ma: 'no',
          datalen: Math.max(days, 30),
        },
        headers: {
          Referer: 'https://finance.sina.com.cn',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 8000,
      }
    )

    return (rows || [])
      .map((row) => ({
        date: row.day || '',
        open: parseFloat(row.open || '0'),
        high: parseFloat(row.high || '0'),
        low: parseFloat(row.low || '0'),
        close: parseFloat(row.close || '0'),
        volume: parseInt(row.volume || '0', 10),
        source: 'sina',
      }))
      .filter((row) => row.date && row.close > 0 && row.high > 0 && row.low > 0)
  } catch (error) {
    console.error(`Failed to fetch Sina stock history for ${stockCode}:`, compactHttpError(error))
    return []
  }
}

export async function getSinaHistoryBySymbol(sinaSymbol: string, days: number): Promise<StockHistoryData[]> {
  try {
    const rows = await getJsonWithCurlOnly<Array<{
      day?: string
      open?: string
      high?: string
      low?: string
      close?: string
      volume?: string
    }>>(
      'https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketData.getKLineData',
      {
        params: {
          symbol: sinaSymbol,
          scale: 240,
          ma: 'no',
          datalen: Math.max(days, 30),
        },
        headers: {
          Referer: 'https://finance.sina.com.cn',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 10000,
      }
    )

    return (rows || [])
      .map((row) => ({
        date: row.day || '',
        open: parseFloat(row.open || '0'),
        high: parseFloat(row.high || '0'),
        low: parseFloat(row.low || '0'),
        close: parseFloat(row.close || '0'),
        volume: parseInt(row.volume || '0', 10),
        source: 'sina',
      }))
      .filter((row) => row.date && row.close > 0 && row.high > 0 && row.low > 0)
  } catch (error) {
    console.error(`Failed to fetch Sina history for ${sinaSymbol}:`, compactHttpError(error))
    return []
  }
}

export async function getTencentIndexHistory(symbol: string, days: number = 756): Promise<StockHistoryData[]> {
  const identity = resolveChinaIndexIdentity(symbol)
  if (!identity) throw new Error(`Unsupported China index symbol: ${symbol}`)
  try {
    return getTencentHistoryPages({
      marketSymbol: identity.sinaSymbol,
      days,
      adjustType: 'none',
      provider: 'tencent_price_index',
    })
  } catch (error) {
    console.error(`Failed to fetch Tencent index history for ${identity.sinaSymbol}:`, compactHttpError(error))
    return []
  }
}

/**
 * Fetch unadjusted daily index levels from Eastmoney.  This is intentionally
 * separate from the A-share qfq endpoint: RRG research indexes are price
 * indexes and must never be adjusted or silently replaced by ETF proxies.
 */
export async function getEastmoneyIndexHistory(symbol: string, days: number = 756): Promise<StockHistoryData[]> {
  const identity = resolveChinaIndexIdentity(symbol)
  if (!identity?.eastmoneySecid) return []

  try {
    const endDate = new Date()
    const startDate = new Date()
    const calendarLookbackDays = Math.ceil(days * (365 / 252)) + 21
    startDate.setDate(startDate.getDate() - calendarLookbackDays)

    const response = await getJson<{ data?: { name?: string; klines?: string[] } }>(
      'https://push2his.eastmoney.com/api/qt/stock/kline/get',
      {
        params: {
          secid: identity.eastmoneySecid,
          fields1: 'f1,f2,f3,f4,f5,f6',
          fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
          klt: '101',
          fqt: '0',
          beg: startDate.toISOString().slice(0, 10).replace(/-/g, ''),
          end: endDate.toISOString().slice(0, 10).replace(/-/g, ''),
          lmt: Math.max(days, 120),
        },
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 12_000,
      },
    )

    return (response.data?.klines || [])
      .map((line) => {
        const [date, open, close, high, low, volume] = line.split(',')
        return {
          date: date || '',
          name: response.data?.name || identity.name,
          open: Number(open),
          high: Number(high),
          low: Number(low),
          close: Number(close),
          volume: Number(volume),
          source: 'eastmoney_price_index',
          adjustType: 'none' as const,
        }
      })
      .filter((row) => row.date && row.close > 0 && row.high > 0 && row.low > 0)
  } catch (error) {
    console.error(`Failed to fetch Eastmoney index history for ${identity.eastmoneySecid}:`, compactHttpError(error))
    return []
  }
}

interface CsindexPerformanceRow {
  tradeDate?: string
  indexCode?: string
  indexNameCnAll?: string
  indexNameCn?: string
  open?: number | null
  high?: number | null
  low?: number | null
  close?: number | null
  tradingVol?: number | null
}

interface CsindexPerformanceResponse {
  code?: string | number
  msg?: string
  data?: CsindexPerformanceRow[]
}

const CSINDEX_PERFORMANCE_ENDPOINT = 'https://www.csindex.com.cn/csindex-home/perf/index-perf'
const CSINDEX_BATCH_CALENDAR_DAYS = 1_000

const csindexDate = (date: Date) => date.toISOString().slice(0, 10).replace(/-/g, '')

const finitePositive = (value: unknown) => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

export function normalizeCsindexOfficialPerformanceRows(
  rows: CsindexPerformanceRow[],
  identity: ChinaIndexIdentity,
): StockHistoryData[] {
  const expectedCode = identity.csindexCode
  const byDate = new Map<string, StockHistoryData>()
  for (const row of rows) {
    if (String(row.indexCode || '').toUpperCase() !== expectedCode) continue
    const rawDate = String(row.tradeDate || '')
    if (!/^\d{8}$/.test(rawDate)) continue
    const close = finitePositive(row.close)
    if (!close) continue
    const open = finitePositive(row.open) || close
    const high = Math.max(close, open, finitePositive(row.high) || close)
    const low = Math.min(close, open, finitePositive(row.low) || close)
    const volume = Number(row.tradingVol)
    const date = `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
    byDate.set(date, {
      date,
      name: row.indexNameCnAll || row.indexNameCn || identity.name,
      open,
      high,
      low,
      close,
      volume: Number.isFinite(volume) && volume >= 0 ? volume : 0,
      source: 'csindex_official_price_index',
      adjustType: 'none',
    })
  }
  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date))
}

/**
 * Fetch raw CSI price-index levels from the official China Securities Index
 * performance endpoint.  The endpoint is queried in bounded calendar batches
 * so an intermittent response cannot turn a complete research series into an
 * all-or-nothing failure.  CSI only guarantees a close for some older dates;
 * close is therefore mirrored into missing OHLC fields for the canonical bar
 * shape while RRG itself continues to use the unadjusted close only.
 */
export async function getCsindexOfficialIndexHistory(symbol: string, days: number = 756): Promise<StockHistoryData[]> {
  const identity = resolveChinaIndexIdentity(symbol)
  if (!identity?.csindexCode) return []

  const requestedDays = Math.max(120, Math.min(3000, Math.floor(days)))
  const end = new Date()
  end.setUTCHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - Math.ceil(requestedDays * (365 / 252)) - 28)

  const history = new Map<string, StockHistoryData>()
  let batchStart = new Date(start)
  while (batchStart <= end) {
    const batchEnd = new Date(Math.min(
      end.getTime(),
      batchStart.getTime() + ((CSINDEX_BATCH_CALENDAR_DAYS - 1) * 24 * 60 * 60 * 1000),
    ))
    try {
      const response = await getJsonWithCurlOnly<CsindexPerformanceResponse>(CSINDEX_PERFORMANCE_ENDPOINT, {
        params: {
          indexCode: identity.csindexCode,
          startDate: csindexDate(batchStart),
          endDate: csindexDate(batchEnd),
        },
        headers: {
          Referer: 'https://www.csindex.com.cn/',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 20_000,
      })
      if (String(response.code || '') !== '200') return []
      for (const row of normalizeCsindexOfficialPerformanceRows(response.data || [], identity)) history.set(row.date, row)
    } catch (error) {
      console.error(`Failed to fetch official CSI index history for ${identity.csindexCode}:`, compactHttpError(error))
      return []
    }
    batchStart = new Date(batchEnd)
    batchStart.setUTCDate(batchStart.getUTCDate() + 1)
  }

  return Array.from(history.values())
    .sort((left, right) => left.date.localeCompare(right.date))
    .slice(-requestedDays)
}

/**
 * Yahoo is retained as a non-official fallback for legacy China index targets.
 * CSI supply-chain research indexes use getCsindexOfficialIndexHistory instead.
 */
export async function getYahooChinaIndexHistory(symbol: string, days: number = 756): Promise<StockHistoryData[]> {
  const identity = resolveChinaIndexIdentity(symbol)
  if (!identity?.yahooSymbol) return []

  try {
    const end = Math.floor(Date.now() / 1000) + 86_400
    const start = end - Math.ceil(days * (365 / 252)) * 86_400
    const response = await getJsonWithCurlOnly<{
      chart?: {
        error?: { description?: string } | null
        result?: Array<{
          meta?: { longName?: string; shortName?: string }
          timestamp?: number[]
          indicators?: { quote?: Array<{ open?: Array<number | null>; high?: Array<number | null>; low?: Array<number | null>; close?: Array<number | null>; volume?: Array<number | null> }> }
        }> | null
      }
    }>(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(identity.yahooSymbol)}`, {
      params: { period1: start, period2: end, interval: '1d', events: 'history' },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 12_000,
    })
    const payload = response.chart?.result?.[0]
    if (!payload || response.chart?.error) return []
    const quote = payload.indicators?.quote?.[0]
    const timestamps = payload.timestamp || []
    if (!quote || timestamps.length === 0) return []
    const name = payload.meta?.longName || payload.meta?.shortName || identity.name
    const history = timestamps.map((timestamp, index) => ({
      date: new Date(timestamp * 1000).toISOString().slice(0, 10),
      name,
      open: Number(quote.open?.[index]),
      high: Number(quote.high?.[index]),
      low: Number(quote.low?.[index]),
      close: Number(quote.close?.[index]),
      volume: Number(quote.volume?.[index] || 0),
      source: 'yahoo_cn_price_index',
      adjustType: 'none' as const,
    })).filter((row) => row.close > 0 && row.high > 0 && row.low > 0)
    // Yahoo may expose only an intraday snapshot for an otherwise valid CSI
    // ticker.  One live point is not historical price-index evidence and must
    // not be cached as a usable RRG source.
    return history.length >= Math.min(120, days) ? history : []
  } catch (error) {
    console.error(`Failed to fetch Yahoo China index history for ${identity.yahooSymbol}:`, compactHttpError(error))
    return []
  }
}

export async function getSmartChinaIndexHistory(
  symbol: string,
  days: number = 756,
): Promise<SmartHistoryResult> {
  const identity = resolveChinaIndexIdentity(symbol)
  if (!identity) throw new Error(`Unsupported China index symbol: ${symbol}`)
  const requestedDays = Math.max(120, Math.min(3000, Math.floor(days)))
  if (identity.csindexCode) {
    return fetchSmartHistory([
      { provider: 'csindex_official_price_index', fetch: () => getCsindexOfficialIndexHistory(identity.symbol, requestedDays) },
    ], requestedDays, 'none')
  }
  return fetchSmartHistory([
    ...(identity.yahooSymbol
      ? [{ provider: 'yahoo_cn_price_index', fetch: () => getYahooChinaIndexHistory(identity.symbol, requestedDays) }]
      : []),
    ...(identity.eastmoneySecid
      ? [{ provider: 'eastmoney_price_index', fetch: () => getEastmoneyIndexHistory(identity.symbol, requestedDays) }]
      : []),
    { provider: 'sina_price_index', fetch: () => getSinaHistoryBySymbol(identity.sinaSymbol, requestedDays) },
    { provider: 'tencent_price_index', fetch: () => getTencentIndexHistory(identity.symbol, requestedDays) },
  ], requestedDays, 'none')
}

export async function getChinaIndexHistory(symbol: string, days: number = 260): Promise<StockHistoryData[]> {
  const identity = resolveChinaIndexIdentity(symbol)
  if (!identity) {
    throw new Error(`Unsupported China index symbol: ${symbol}`)
  }

  if (identity.csindexCode) return getCsindexOfficialIndexHistory(identity.symbol, days)
  if (identity.yahooSymbol) return getYahooChinaIndexHistory(identity.symbol, days)
  if (identity.eastmoneySecid) return getEastmoneyIndexHistory(identity.symbol, days)
  return getSinaHistoryBySymbol(identity.sinaSymbol, days)
}

async function fetchSinaAshareUniverse(): Promise<AShareStockItem[]> {
  const countRaw = await getJsonWithCurlOnly<string | number>(
    'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeStockCount',
    {
      params: { node: 'hs_a' },
      headers: {
        Referer: 'https://vip.stock.finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 10000,
    }
  )
  const count = Number(String(countRaw).replace(/"/g, '')) || 0
  if (count <= 0) throw new Error('Sina A-share universe returned empty count')

  const pageSize = 80
  const pageCount = Math.ceil(count / pageSize)
  const pages = Array.from({ length: pageCount }, (_, index) => index + 1)
  const results: AShareStockItem[] = []
  const concurrency = 6
  let nextIndex = 0

  async function worker() {
    while (nextIndex < pages.length) {
      const page = pages[nextIndex++]
      const rows = await getJsonWithCurlOnly<Array<{ code?: string; name?: string; symbol?: string }>>(
        'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData',
        {
          params: {
            page,
            num: pageSize,
            sort: 'symbol',
            asc: 1,
            node: 'hs_a',
            symbol: '',
            _s_r_a: 'page',
          },
          headers: {
            Referer: 'https://vip.stock.finance.sina.com.cn/',
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 12000,
        }
      )

      for (const row of rows || []) {
        const code = String(row.code || '').trim()
        const name = String(row.name || '').trim()
        if (!/^\d{6}$/.test(code) || !name) continue
        results.push({
          symbol: code,
          name,
          exchange: getChinaStockExchange(code),
          market: 'CN',
          type: 'stock',
          source: 'sina_hs_a',
        })
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))
  const unique = new Map<string, AShareStockItem>()
  for (const item of results) unique.set(item.symbol, item)
  return Array.from(unique.values()).sort((a, b) => a.symbol.localeCompare(b.symbol))
}

export async function getAllAshareStocks(forceRefresh = false): Promise<AShareStockItem[]> {
  const now = Date.now()
  if (!forceRefresh && aShareUniverseCache && now - aShareUniverseCache.loadedAt < A_SHARE_UNIVERSE_CACHE_TTL_MS) {
    return aShareUniverseCache.items
  }

  try {
    const items = await fetchSinaAshareUniverse()
    if (items.length < 3000) {
      throw new Error(`A-share universe is unexpectedly small: ${items.length}`)
    }
    aShareUniverseCache = { loadedAt: now, items }
    void persistAshareUniverse(items, now)
    return items
  } catch (error) {
    if (!forceRefresh && aShareUniverseCache && aShareUniverseCache.items.length >= 3000) {
      return aShareUniverseCache.items
    }
    const persisted = await loadPersistedAshareUniverse()
    if (!forceRefresh && persisted && persisted.items.length >= 3000) {
      aShareUniverseCache = persisted
      return persisted.items
    }
    throw error
  }
}

async function persistAshareUniverse(items: AShareStockItem[], loadedAt: number) {
  try {
    await mkdir(dirname(A_SHARE_UNIVERSE_PERSISTENT_CACHE_FILE), { recursive: true })
    await writeFile(
      A_SHARE_UNIVERSE_PERSISTENT_CACHE_FILE,
      JSON.stringify({
        schemaVersion: 'fams.a_share_universe_cache.v1',
        loadedAt,
        items,
      }),
      'utf8'
    )
  } catch (error) {
    console.warn(`Failed to persist A-share universe cache: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function loadPersistedAshareUniverse() {
  try {
    const parsed = JSON.parse(await readFile(A_SHARE_UNIVERSE_PERSISTENT_CACHE_FILE, 'utf8')) as {
      loadedAt?: number
      items?: AShareStockItem[]
    }
    const items = Array.isArray(parsed.items)
      ? parsed.items.filter((item) => /^\d{6}$/.test(item.symbol) && item.name)
      : []
    if (items.length < 3000) return null
    return {
      loadedAt: Number(parsed.loadedAt) || Date.now(),
      items,
    }
  } catch {
    return null
  }
}

/**
 * 获取股票实时价格（自动判断市场）
 * 优先使用A股接口，其他市场暂用模拟数据
 */
export async function getStockRealtime(stockCode: string): Promise<StockRealtimeData> {
  // A股（6位数字代码）
  if (/^\d{6}$/.test(stockCode)) {
    const result = await getChinaStockRealtime(stockCode)
    if (result) return result
    const sinaResult = await getSinaStockRealtime(stockCode)
    if (sinaResult) return sinaResult
  }

  // 如果获取失败，返回错误数据而不是模拟数据
  throw new Error(`无法获取 ${stockCode} 的实时价格`)
}

/**
 * 获取股票历史K线（自动判断市场）
 */
export async function getStockHistory(
  stockCode: string,
  days: number = 30
): Promise<StockHistoryData[]> {
  // A股
  if (/^\d{6}$/.test(stockCode)) {
    return getChinaStockHistory(stockCode, days)
  }

  // 其他市场暂不支持
  throw new Error(`暂不支持获取 ${stockCode} 的历史数据`)
}
