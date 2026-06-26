/**
 * Stock Utils - 股票数据获取工具
 *
 * 职责：封装股票相关数据获取逻辑，从各种数据源获取真实数据
 */

import axios from 'axios'
import iconv from 'iconv-lite'
import { compactHttpError, getJson, getJsonWithCurlOnly } from './httpJson.js'
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

export function resolveChinaIndexIdentity(symbol: string, fallbackName?: string): ChinaIndexIdentity | null {
  const raw = String(symbol || '').trim()
  if (!raw) return null

  const normalized = raw.toUpperCase()
  const direct = CHINA_INDEX_MAP[raw] || CHINA_INDEX_MAP[normalized]
  if (direct) {
    return fallbackName && fallbackName !== direct.name ? { ...direct, name: fallbackName } : direct
  }

  const compact = normalized.replace(/\.(SH|SZ)$/, '')
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
export async function getChinaStockHistory(
  stockCode: string,
  days: number = 30
): Promise<StockHistoryData[]> {
  let eastmoneyError: unknown = null
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
      }
    })
  } catch (error) {
    eastmoneyError = error
  }

  const sinaHistory = await getSinaStockHistory(stockCode, days)
  if (sinaHistory.length > 0) return sinaHistory

  console.error(`Failed to fetch China stock history for ${stockCode}:`, compactHttpError(eastmoneyError))
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

    return rows
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

    return rows
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

export async function getChinaIndexHistory(symbol: string, days: number = 260): Promise<StockHistoryData[]> {
  const identity = resolveChinaIndexIdentity(symbol)
  if (!identity) {
    throw new Error(`Unsupported China index symbol: ${symbol}`)
  }

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
