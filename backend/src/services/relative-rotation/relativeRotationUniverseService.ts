import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../../db/prisma.js'
import { getJsonWithCurlOnly, getTextWithCurlOnly } from '../../utils/httpJson.js'
import { ensureUser } from '../../utils/user.js'
import {
  getSmartChinaIndexHistory,
  getSmartQfqStockHistory,
  resolveChinaIndexIdentity,
  type StockHistoryData,
} from '../../utils/stockUtils.js'
import {
  buildRelativeRotationSeries,
  PRICE_INDEX_CANONICAL_VERSION,
  QFQ_CANONICAL_VERSION,
  RELATIVE_ROTATION_DATA_VERSION,
  RELATIVE_ROTATION_FORMULA_VERSION,
  RELATIVE_ROTATION_TIMELINE_MAX_YEARS,
  type RelativeRotationFrequency,
} from './relativeRotationService.js'

export type RotationMarket = 'CN' | 'HK' | 'US'
export type RotationReadiness = 'verified' | 'limited' | 'insufficient' | 'unavailable'
export type RotationFreshness = 'fresh' | 'delayed' | 'stale' | 'unknown'
export type RotationResearchTargetKind = 'equity' | 'index'
export type RotationResearchBenchmarkMode = 'market_default' | 'equal_weight_targets'
export type RotationResearchTaxonomyStage = '上游资源' | '能源供给' | '核心器件' | '算力与数据' | '软件应用' | 'AI综合主题'

export interface RotationResearchTaxonomy {
  key: 'cn_ai_supply_chain'
  stage: RotationResearchTaxonomyStage
  order: number
  isAggregate: boolean
  representation: 'price_index' | 'etf_price_proxy'
  methodologyUrl: string
}

export interface RotationResearchTargetInput {
  code: string
  name?: string
  kind?: RotationResearchTargetKind
}

export interface NormalizedRotationResearchTarget {
  market: RotationMarket
  kind: RotationResearchTargetKind
  symbol: string
  name: string
  assetType: 'stock' | 'etf' | 'index'
  targetKey: string
  taxonomy?: RotationResearchTaxonomy
}

export interface RotationResearchWindow {
  startDate?: string
  endDate?: string
}

export interface RotationResearchBenchmarkInput {
  mode?: RotationResearchBenchmarkMode
  targetKeys?: string[]
}

const ADJUSTED_CLOSE_CANONICAL_VERSION = 'canonical.adjusted_close.v1'
const WATCHLIST_LIMIT = 30
const MINIMUM_VERIFIED_DAYS = 756
const MAXIMUM_HISTORY_DAYS = 3000
const RESEARCH_TIMELINE_MAX_YEARS = 10
// v3 is isolated from the old generic benchmark/third-party rows.  CSI
// industry and theme research now persists the official CSIndex price levels
// under this version, so a prior symbol mapping can never be reused silently.
const RESEARCH_PRICE_INDEX_CANONICAL_VERSION = 'research.price_index.v3'
const moduleDir = dirname(fileURLToPath(import.meta.url))
const quoteListCachePath = resolve(moduleDir, '../../../data/a-share-quote-list-cache.json')

const knownSecurityNames: Record<string, string> = {
  'CN:515070': '人工智能AI ETF',
  'CN:512480': '半导体ETF',
  'CN:688825': '长鑫科技',
}

const usResearchIndexes: Record<string, { name: string }> = {
  'DX-Y.NYB': { name: '美元指数 DXY' },
}

const CN_AI_SUPPLY_CHAIN_TAXONOMY: Record<string, RotationResearchTaxonomy> = {
  '930708.CSI': {
    key: 'cn_ai_supply_chain',
    stage: '上游资源',
    order: 1,
    isAggregate: false,
    representation: 'price_index',
    methodologyUrl: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/429_930708_Index_Methodology_cn.pdf',
  },
  'H30199.CSI': {
    key: 'cn_ai_supply_chain',
    stage: '能源供给',
    order: 2,
    isAggregate: false,
    representation: 'price_index',
    methodologyUrl: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/H30199_Index_Methodology_cn.pdf',
  },
  'H30184.CSI': {
    key: 'cn_ai_supply_chain',
    stage: '核心器件',
    order: 3,
    isAggregate: false,
    representation: 'price_index',
    methodologyUrl: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/H30184_Index_Methodology_cn.pdf',
  },
  '930851.CSI': {
    key: 'cn_ai_supply_chain',
    stage: '算力与数据',
    order: 4,
    isAggregate: false,
    representation: 'price_index',
    methodologyUrl: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/20231208180232-930851_Index_Methodology_cn.pdf',
  },
  '930601.CSI': {
    key: 'cn_ai_supply_chain',
    stage: '软件应用',
    order: 5,
    isAggregate: false,
    representation: 'price_index',
    methodologyUrl: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/338_930601_Index_Methodology_cn.pdf',
  },
  '930713.CSI': {
    key: 'cn_ai_supply_chain',
    stage: 'AI综合主题',
    order: 6,
    isAggregate: true,
    representation: 'price_index',
    methodologyUrl: 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/20231208175424-930713_Index_Methodology_cn.pdf',
  },
  '512400': {
    key: 'cn_ai_supply_chain',
    stage: '上游资源',
    order: 1,
    isAggregate: false,
    representation: 'etf_price_proxy',
    methodologyUrl: 'https://www.sse.com.cn/disclosure/fund/announcement/c/2021-01-21/512400_20210122_1.pdf',
  },
  '159611': {
    key: 'cn_ai_supply_chain',
    stage: '能源供给',
    order: 2,
    isAggregate: false,
    representation: 'etf_price_proxy',
    methodologyUrl: 'https://www.gffunds.com.cn/funds//?fundcode=159611',
  },
  '512480': {
    key: 'cn_ai_supply_chain',
    stage: '核心器件',
    order: 3,
    isAggregate: false,
    representation: 'etf_price_proxy',
    methodologyUrl: 'https://static.cninfo.com.cn/finalpage/2025-03-31/1222963490.PDF',
  },
  '159890': {
    key: 'cn_ai_supply_chain',
    stage: '算力与数据',
    order: 4,
    isAggregate: false,
    representation: 'etf_price_proxy',
    methodologyUrl: 'https://static.cmfchina.com/web/fundDetail/159890/index.html',
  },
  '159852': {
    key: 'cn_ai_supply_chain',
    stage: '软件应用',
    order: 5,
    isAggregate: false,
    representation: 'etf_price_proxy',
    methodologyUrl: 'https://www.jsfund.cn/Services/cn/jsp/pcf/index.jsp?SiteID=1&fundcode=159852',
  },
  '515070': {
    key: 'cn_ai_supply_chain',
    stage: 'AI综合主题',
    order: 6,
    isAggregate: true,
    representation: 'etf_price_proxy',
    methodologyUrl: 'https://www.hxam.com/upload/resources/file/2026/03/31/5d28bc7b9acd4ba0adea7a108b8addd7.pdf',
  },
}

function researchTaxonomyFor(market: RotationMarket, symbol: string) {
  if (market !== 'CN') return undefined
  return CN_AI_SUPPLY_CHAIN_TAXONOMY[symbol]
}

const ICE_DXY_BASE = 50.14348112

/**
 * ICE publishes the DXY calculation weights.  This is deliberately kept as a
 * named, auditable fallback for the DXY index—not an ETF proxy.  Frankfurter
 * supplies ECB reference FX rates quoted as foreign-currency units per USD.
 */
export function calculateIceDxyFromUsdReferenceRates(rates: Record<string, number>) {
  const eurPerUsd = Number(rates.EUR)
  const jpyPerUsd = Number(rates.JPY)
  const gbpPerUsd = Number(rates.GBP)
  const cadPerUsd = Number(rates.CAD)
  const sekPerUsd = Number(rates.SEK)
  const chfPerUsd = Number(rates.CHF)
  if (![eurPerUsd, jpyPerUsd, gbpPerUsd, cadPerUsd, sekPerUsd, chfPerUsd].every((value) => Number.isFinite(value) && value > 0)) {
    return null
  }
  return ICE_DXY_BASE
    * (1 / eurPerUsd) ** -0.576
    * jpyPerUsd ** 0.136
    * (1 / gbpPerUsd) ** -0.119
    * cadPerUsd ** 0.091
    * sekPerUsd ** 0.042
    * chfPerUsd ** 0.036
}

const marketPolicies = {
  CN: {
    market: 'CN' as const,
    label: 'A股',
    benchmarkId: 'csi300_price_index',
    benchmarkSymbol: '000300.SH',
    benchmarkName: '沪深300',
    currency: 'CNY',
    timezone: 'Asia/Shanghai',
    assetAdjustType: 'qfq',
    assetDataVersion: QFQ_CANONICAL_VERSION,
  },
  HK: {
    market: 'HK' as const,
    label: '港股',
    benchmarkId: 'hang_seng_price_index',
    benchmarkSymbol: '^HSI',
    benchmarkName: '恒生指数',
    currency: 'HKD',
    timezone: 'Asia/Hong_Kong',
    assetAdjustType: 'adjusted',
    assetDataVersion: ADJUSTED_CLOSE_CANONICAL_VERSION,
  },
  US: {
    market: 'US' as const,
    label: '美股',
    benchmarkId: 'sp500_price_index',
    benchmarkSymbol: '^GSPC',
    benchmarkName: '标普500',
    currency: 'USD',
    timezone: 'America/New_York',
    assetAdjustType: 'adjusted',
    assetDataVersion: ADJUSTED_CLOSE_CANONICAL_VERSION,
  },
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10)
const toUtcDate = (value: string) => new Date(`${value.slice(0, 10)}T00:00:00.000Z`)
const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function exchangeForCnSymbol(symbol: string) {
  if (/^(60|68|90|5)/.test(symbol)) return 'SH'
  if (/^(8|4|9)/.test(symbol)) return 'BJ'
  return 'SZ'
}

function isCnEtf(symbol: string) {
  return /^(159|510|511|512|513|515|516|517|518|520|560|561|562|563|588|589)\d{3}$/.test(symbol)
}

export function buildEqualWeightResearchBenchmark(components: Array<{
  targetKey: string
  symbol: string
  name: string
  history: StockHistoryData[]
}>) {
  const usable = components.map((component) => ({
    ...component,
    byDate: new Map(component.history
      .filter((point) => /^\d{4}-\d{2}-\d{2}$/.test(point.date) && Number.isFinite(point.close) && point.close > 0)
      .map((point) => [point.date, point.close])),
  }))
  const commonDates = usable.length === 0
    ? []
    : Array.from(usable[0].byDate.keys())
      .filter((date) => usable.every((component) => component.byDate.has(date)))
      .sort()
  let level = 100
  const history: StockHistoryData[] = commonDates.map((date, index) => {
    if (index > 0) {
      const previousDate = commonDates[index - 1]
      const equalWeightReturn = usable.reduce((sum, component) => {
        const previous = component.byDate.get(previousDate)!
        const current = component.byDate.get(date)!
        return sum + ((current / previous) - 1)
      }, 0) / usable.length
      level *= 1 + equalWeightReturn
    }
    return {
      date,
      open: level,
      high: level,
      low: level,
      close: level,
      volume: 0,
      source: 'derived:equal_weight_targets',
      adjustType: 'none',
    }
  })
  return {
    history,
    components: usable.map((component) => ({
      targetKey: component.targetKey,
      symbol: component.symbol,
      name: component.name,
      weight: usable.length > 0 ? 1 / usable.length : 0,
      sampleDays: component.history.length,
      asOfDate: component.history.at(-1)?.date || null,
    })),
  }
}

export function normalizeRotationTarget(marketInput: string, codeInput: string) {
  const market = String(marketInput || '').trim().toUpperCase() as RotationMarket
  const raw = String(codeInput || '').trim().toUpperCase()
  if (!['CN', 'HK', 'US'].includes(market)) throw new Error('RRG_MARKET_INVALID: market must be CN, HK or US')

  if (market === 'CN') {
    const symbol = raw.replace(/\.(SH|SS|SZ|BJ)$/, '')
    if (!/^\d{6}$/.test(symbol)) throw new Error('RRG_SYMBOL_INVALID: A股代码必须为6位数字')
    return {
      market,
      symbol,
      exchange: exchangeForCnSymbol(symbol),
      currency: 'CNY',
      assetType: isCnEtf(symbol) ? 'etf' : 'stock',
      targetKey: `${market}:${symbol}`,
    }
  }

  if (market === 'HK') {
    const compact = raw.replace(/\.HK$/, '')
    if (!/^\d{1,5}$/.test(compact)) throw new Error('RRG_SYMBOL_INVALID: 港股代码必须为1至5位数字')
    const symbol = `${compact.padStart(5, '0')}.HK`
    return { market, symbol, exchange: 'HK', currency: 'HKD', assetType: 'stock', targetKey: `${market}:${symbol}` }
  }

  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(raw) || raw.startsWith('^')) {
    throw new Error('RRG_SYMBOL_INVALID: 美股代码格式无效')
  }
  return { market, symbol: raw, exchange: 'US', currency: 'USD', assetType: 'stock', targetKey: `${market}:${raw}` }
}

export function normalizeRotationResearchTarget(
  marketInput: string,
  input: RotationResearchTargetInput,
): NormalizedRotationResearchTarget {
  const kind = input.kind === 'index' ? 'index' : 'equity'
  const suppliedName = String(input.name || '').trim()
  if (kind === 'equity') {
    const normalized = normalizeRotationTarget(marketInput, input.code)
    const taxonomy = researchTaxonomyFor(normalized.market, normalized.symbol)
    return {
      market: normalized.market,
      kind,
      symbol: normalized.symbol,
      name: suppliedName || normalized.symbol,
      assetType: normalized.assetType as 'stock' | 'etf',
      targetKey: `${normalized.market}:equity:${normalized.symbol}`,
      ...(taxonomy ? { taxonomy } : {}),
    }
  }

  const market = String(marketInput || '').trim().toUpperCase() as RotationMarket
  if (market === 'US') {
    const symbol = String(input.code || '').trim().toUpperCase()
    const identity = usResearchIndexes[symbol]
    if (!identity) throw new Error('RRG_RESEARCH_INDEX_INVALID: 美股专题当前仅支持美元指数 DX-Y.NYB 作为指数标的')
    return {
      market,
      kind,
      symbol,
      name: suppliedName || identity.name,
      assetType: 'index',
      targetKey: `${market}:index:${symbol}`,
    }
  }
  if (market !== 'CN') throw new Error('RRG_RESEARCH_INDEX_MARKET_INVALID: 当前仅支持 A 股价格指数或美元指数 DXY 作为研究标的')
  const raw = String(input.code || '').trim().toUpperCase()
  const withExchange = /^\d{6}$/.test(raw)
    ? `${raw}.${raw.startsWith('399') ? 'SZ' : 'SH'}`
    : raw
  const identity = resolveChinaIndexIdentity(withExchange, suppliedName || undefined)
  if (!identity) throw new Error('RRG_RESEARCH_INDEX_INVALID: 指数代码须为可识别的 A 股或中证价格指数')
  const taxonomy = researchTaxonomyFor(market, identity.symbol)
  return {
    market,
    kind,
    symbol: identity.symbol,
    name: suppliedName || identity.name,
    assetType: 'index',
    targetKey: `${market}:index:${identity.symbol}`,
    ...(taxonomy ? { taxonomy } : {}),
  }
}

function positionMarket(asset: { symbol: string; exchange: string | null }) : RotationMarket | null {
  if (asset.exchange === 'HK' || asset.symbol.endsWith('.HK')) return 'HK'
  if (asset.exchange === 'US' || /^[A-Z][A-Z0-9.-]{0,9}$/.test(asset.symbol)) return 'US'
  if (/^\d{6}$/.test(asset.symbol)) return 'CN'
  return null
}

function canonicalPositionSymbol(market: RotationMarket, symbol: string) {
  if (market === 'HK') return normalizeRotationTarget('HK', symbol).symbol
  return normalizeRotationTarget(market, symbol).symbol
}

class RelativeRotationUniverseService {
  private historyDaysForYears(years: number) {
    return Math.min(MAXIMUM_HISTORY_DAYS, Math.ceil((years + 1) * 260))
  }

  private isCacheCurrent(history: StockHistoryData[]) {
    const latest = history.at(-1)?.date
    if (!latest) return false
    const ageMs = Date.now() - toUtcDate(latest).getTime()
    return ageMs >= 0 && ageMs <= 4 * 86_400_000
  }

  private yahooSymbol(market: RotationMarket, symbol: string) {
    if (market === 'CN') {
      const exchange = exchangeForCnSymbol(symbol)
      return `${symbol}.${exchange === 'SH' ? 'SS' : exchange}`
    }
    if (market === 'HK') {
      // Internal Hong Kong symbols are normalized to five digits (for example
      // 00175.HK), while Yahoo's chart endpoint expects the exchange ticker
      // without padding (175.HK). Keep the five-digit canonical identity in
      // storage and only adapt the provider request symbol here.
      const compact = symbol.replace(/\.HK$/, '').replace(/^0+/, '') || '0'
      return `${compact}.HK`
    }
    if (market === 'US') return symbol === 'DX-Y.NYB' ? symbol : symbol.replace('.', '-')
    return symbol
  }

  private async fetchYahooHistory(market: RotationMarket, symbol: string, days: number, useAdjustedClose: boolean) {
    const providerSymbol = this.yahooSymbol(market, symbol)
    const period2 = Math.floor(Date.now() / 1000) + 86_400
    const period1 = period2 - Math.ceil(days * 365 / 252 + 30) * 86_400
    // Axios inherits the development proxy here, which can downgrade this
    // upstream HTTPS request.  Use the project's curl-only transport so the
    // official Yahoo index/ETF series is tried before a secondary source.
    const response = await getJsonWithCurlOnly<any>(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(providerSymbol)}`, {
      params: {
        period1,
        period2,
        interval: '1d',
        events: 'div,splits',
        includeAdjustedClose: 'true',
      },
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 6_000,
    })
    const result = response?.chart?.result?.[0]
    if (!result) {
      const providerError = response?.chart?.error?.description
      throw new Error(providerError || `Yahoo未返回 ${symbol} 的历史行情`)
    }
    const timestamps: number[] = result.timestamp || []
    const quote = result.indicators?.quote?.[0] || {}
    const adjusted = result.indicators?.adjclose?.[0]?.adjclose || []
    const history: StockHistoryData[] = []
    for (let index = 0; index < timestamps.length; index += 1) {
      const rawClose = Number(quote.close?.[index])
      const adjustedClose = Number(adjusted[index])
      const close = useAdjustedClose && adjustedClose > 0 ? adjustedClose : rawClose
      if (!Number.isFinite(close) || close <= 0) continue
      const factor = useAdjustedClose && rawClose > 0 && adjustedClose > 0 ? adjustedClose / rawClose : 1
      const open = Number(quote.open?.[index]) * factor
      const high = Number(quote.high?.[index]) * factor
      const low = Number(quote.low?.[index]) * factor
      history.push({
        date: new Date(timestamps[index] * 1000).toISOString().slice(0, 10),
        name: result.meta?.longName || result.meta?.shortName || undefined,
        open: Number.isFinite(open) && open > 0 ? open : close,
        high: Number.isFinite(high) && high > 0 ? high : close,
        low: Number.isFinite(low) && low > 0 ? low : close,
        close,
        volume: Number(quote.volume?.[index]) || 0,
        source: useAdjustedClose ? 'yahoo_adjusted' : 'yahoo_price_index',
        adjustType: 'none',
      })
    }
    return {
      history: history.slice(-days),
      name: result.meta?.longName || result.meta?.shortName || null,
      provider: useAdjustedClose ? 'yahoo_adjusted' : 'yahoo_price_index',
      providerSymbol,
    }
  }

  private async fetchDxyFormulaHistory(days: number) {
    const end = new Date()
    const start = new Date(end)
    // Convert requested trading observations to a calendar range and retain a
    // small buffer for FX/US-holiday mismatches before clipping to `days`.
    start.setUTCDate(start.getUTCDate() - Math.ceil(days * 365 / 252 + 30))
    const response = await getJsonWithCurlOnly<{ rates?: Record<string, Record<string, number>> }>(
      `https://api.frankfurter.dev/v1/${isoDate(start)}..${isoDate(end)}`,
      {
        params: { from: 'USD', to: 'EUR,JPY,GBP,CAD,SEK,CHF' },
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 12_000,
      },
    )
    const history = Object.entries(response.rates || {})
      .flatMap(([date, rates]): StockHistoryData[] => {
        const close = calculateIceDxyFromUsdReferenceRates(rates)
        return close && /^\d{4}-\d{2}-\d{2}$/.test(date)
          ? [{
              date,
              open: close,
              high: close,
              low: close,
              close,
              volume: 0,
              source: 'ecb_dxy_formula',
              adjustType: 'none' as const,
            }]
          : []
      })
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-days)
    if (history.length === 0) throw new Error('ECB参考汇率未返回可复算的DXY历史')
    return {
      history,
      name: '美元指数 DXY（ICE公式复算）',
      provider: 'ecb_dxy_formula',
      providerSymbol: 'ICE_DXY:ECB_REFERENCE_RATES',
    }
  }

  private normalizeDetectedSplits(history: StockHistoryData[]) {
    const rows = history.map((row) => ({ ...row }))
    const commonFactors = [0.1, 0.125, 0.2, 0.25, 1 / 3, 0.5, 2, 3, 4, 5, 8, 10]
    for (let index = 1; index < rows.length; index += 1) {
      const previous = rows[index - 1].close
      const current = rows[index].close
      if (!(previous > 0 && current > 0)) continue
      const observed = current / previous
      const factor = commonFactors.reduce((best, candidate) => (
        Math.abs(candidate - observed) < Math.abs(best - observed) ? candidate : best
      ), commonFactors[0])
      const relativeError = Math.abs(factor - observed) / factor
      if (relativeError > 0.16 || (observed > 0.68 && observed < 1.48)) continue
      for (let cursor = 0; cursor < index; cursor += 1) {
        rows[cursor].open *= factor
        rows[cursor].high *= factor
        rows[cursor].low *= factor
        rows[cursor].close *= factor
      }
    }
    return rows
  }

  private async fetchTencentHongKongHistory(symbol: string, days: number, benchmark = false) {
    const marketSymbol = benchmark ? 'hkHSI' : `hk${symbol.replace(/\.HK$/, '')}`
    const byDate = new Map<string, StockHistoryData>()
    let endDate = ''
    let name: string | null = null
    for (let page = 0; page < Math.ceil(days / 800) + 1; page += 1) {
      const remaining = days - byDate.size
      if (remaining <= 0) break
      const count = Math.min(800, Math.max(120, remaining))
      const response = await getJsonWithCurlOnly<any>('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get', {
        params: { param: `${marketSymbol},day,,${endDate},${count},qfq` },
        headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0' },
        timeout: 12_000,
      })
      const data = response?.data?.[marketSymbol]
      const rows: Array<Array<string | number>> = data?.qfqday || data?.day || []
      name = name || data?.qt?.[marketSymbol]?.[1] || null
      if (rows.length === 0) break
      for (const row of rows) {
        const parsed = {
          date: String(row[0] || ''),
          name: name || undefined,
          open: Number(row[1]),
          close: Number(row[2]),
          high: Number(row[3]),
          low: Number(row[4]),
          volume: Number(row[5]) || 0,
          source: benchmark ? 'tencent_hk_price_index' : 'tencent_hk_price',
          adjustType: 'none' as const,
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(parsed.date) && parsed.close > 0) byDate.set(parsed.date, parsed)
      }
      const oldest = rows.map((row) => String(row[0] || '')).filter(Boolean).sort()[0]
      if (!oldest) break
      const previous = new Date(`${oldest}T00:00:00.000Z`)
      previous.setUTCDate(previous.getUTCDate() - 1)
      const nextEndDate = previous.toISOString().slice(0, 10)
      if (nextEndDate === endDate) break
      endDate = nextEndDate
      if (rows.length < count) break
    }
    const history = Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date)).slice(-days)
    return { history: benchmark ? history : this.normalizeDetectedSplits(history), name, provider: benchmark ? 'tencent_hk_price_index' : 'tencent_hk_split_adjusted', providerSymbol: marketSymbol }
  }

  private async fetchSinaUnitedStatesHistory(symbol: string, days: number, benchmark = false) {
    const providerSymbol = benchmark ? '.INX' : symbol
    const text = await getTextWithCurlOnly(
      `https://stock.finance.sina.com.cn/usstock/api/jsonp.php/var%20data=/US_MinKService.getDailyK`,
      {
        params: { symbol: providerSymbol },
        headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' },
        timeout: 12_000,
      },
    )
    const start = text.indexOf('([')
    const end = text.lastIndexOf(')')
    if (start < 0 || end <= start) throw new Error(`Sina未返回 ${symbol} 的历史行情`)
    const rows = JSON.parse(text.slice(start + 1, end)) as Array<Record<string, string>>
    const history = rows.map((row) => ({
      date: row.d || '',
      open: Number(row.o),
      high: Number(row.h),
      low: Number(row.l),
      close: Number(row.c),
      volume: Number(row.v) || 0,
      source: benchmark ? 'sina_us_price_index' : 'sina_us_price',
      adjustType: 'none' as const,
    })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.close > 0)
      .sort((left, right) => left.date.localeCompare(right.date))
      .slice(-days)
    return {
      history: benchmark ? history : this.normalizeDetectedSplits(history),
      name: null,
      provider: benchmark ? 'sina_us_price_index' : 'sina_us_split_adjusted',
      providerSymbol,
    }
  }

  private async fetchPublicFallbackHistory(market: Exclude<RotationMarket, 'CN'>, symbol: string, days: number, benchmark = false) {
    return market === 'HK'
      ? this.fetchTencentHongKongHistory(symbol, days, benchmark)
      : this.fetchSinaUnitedStatesHistory(symbol, days, benchmark)
  }

  private async loadCanonicalHistory(params: {
    market: RotationMarket
    symbol: string
    adjustType: string
    dataVersion: string
    days: number
  }) {
    const rows = await prisma.marketBarCanonical.findMany({
      where: {
        market: params.market,
        symbol: params.symbol,
        timeframe: '1d',
        adjustType: params.adjustType,
        dataVersion: params.dataVersion,
      },
      orderBy: { tradeDate: 'desc' },
      take: params.days,
    })
    return rows.reverse().map((row) => ({
      date: isoDate(row.tradeDate),
      open: row.openPrice || row.closePrice,
      high: row.highPrice || row.closePrice,
      low: row.lowPrice || row.closePrice,
      close: row.closePrice,
      volume: row.volume || 0,
      source: `cache:${row.primaryProvider || 'canonical'}`,
      adjustType: params.adjustType === 'qfq' ? 'qfq' as const : 'none' as const,
    }))
  }

  private async persistCanonicalHistory(params: {
    market: RotationMarket
    symbol: string
    history: StockHistoryData[]
    provider: string
    providerSymbol: string
    adjustType: string
    dataVersion: string
    expectedDays: number
    currency: string
    timezone: string
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
          market: params.market,
          provider: params.provider,
          adjustType: params.adjustType,
          tradeDate: { in: dates },
        },
      })
      await tx.marketBarCanonical.deleteMany({
        where: {
          symbol: params.symbol,
          market: params.market,
          adjustType: params.adjustType,
          dataVersion: params.dataVersion,
          tradeDate: { in: dates },
        },
      })
      await tx.marketBarRaw.createMany({
        data: valid.map(({ bar, tradeDate }) => {
          const payload = { ...bar, market: params.market, adjustType: params.adjustType }
          return {
            symbol: params.symbol,
            market: params.market,
            provider: params.provider,
            providerSymbol: params.providerSymbol,
            timeframe: '1d',
            tradeDate,
            adjustType: params.adjustType,
            openPrice: bar.open,
            highPrice: bar.high,
            lowPrice: bar.low,
            closePrice: bar.close,
            volume: bar.volume,
            currency: params.currency,
            timezone: params.timezone,
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
          market: params.market,
          timeframe: '1d',
          tradeDate,
          adjustType: params.adjustType,
          openPrice: bar.open,
          highPrice: bar.high,
          lowPrice: bar.low,
          closePrice: bar.close,
          volume: bar.volume,
          primaryProvider: params.provider,
          sourceRefsJson: JSON.stringify([`${params.provider}:${params.providerSymbol}:${bar.date}`]),
          consensusScore: 1,
          confidence: params.market === 'CN' ? 1 : 0.75,
          validationStatus: 'valid',
          dataVersion: params.dataVersion,
          qualityFlagsJson: JSON.stringify(params.market === 'CN' ? [] : ['single_source']),
        })),
      })
    })
    const coverage = await prisma.marketBarCanonical.aggregate({
      where: {
        symbol: params.symbol,
        market: params.market,
        timeframe: '1d',
        adjustType: params.adjustType,
        dataVersion: params.dataVersion,
      },
      _count: { _all: true },
      _min: { tradeDate: true },
      _max: { tradeDate: true },
    })
    const actualBarCount = coverage._count._all
    await prisma.marketDataCoverage.upsert({
      where: {
        symbol_market_timeframe_adjustType_dataVersion: {
          symbol: params.symbol,
          market: params.market,
          timeframe: '1d',
          adjustType: params.adjustType,
          dataVersion: params.dataVersion,
        },
      },
      create: {
        symbol: params.symbol,
        market: params.market,
        timeframe: '1d',
        adjustType: params.adjustType,
        dataVersion: params.dataVersion,
        firstTradeDate: coverage._min.tradeDate,
        lastTradeDate: coverage._max.tradeDate,
        completeFrom: actualBarCount >= MINIMUM_VERIFIED_DAYS ? coverage._min.tradeDate : null,
        completeTo: actualBarCount >= MINIMUM_VERIFIED_DAYS ? coverage._max.tradeDate : null,
        expectedBarCount: params.expectedDays,
        actualBarCount,
        missingCount: Math.max(0, MINIMUM_VERIFIED_DAYS - actualBarCount),
        lastProvider: params.provider,
        lastFetchAt: new Date(),
        lastValidateAt: new Date(),
        status: actualBarCount >= MINIMUM_VERIFIED_DAYS ? 'sufficient' : 'partial',
      },
      update: {
        firstTradeDate: coverage._min.tradeDate,
        lastTradeDate: coverage._max.tradeDate,
        completeFrom: actualBarCount >= MINIMUM_VERIFIED_DAYS ? coverage._min.tradeDate : null,
        completeTo: actualBarCount >= MINIMUM_VERIFIED_DAYS ? coverage._max.tradeDate : null,
        expectedBarCount: Math.max(params.expectedDays, actualBarCount),
        actualBarCount,
        missingCount: Math.max(0, MINIMUM_VERIFIED_DAYS - actualBarCount),
        lastProvider: params.provider,
        lastFetchAt: new Date(),
        lastValidateAt: new Date(),
        status: actualBarCount >= MINIMUM_VERIFIED_DAYS ? 'sufficient' : 'partial',
        staleReason: null,
      },
    })
  }

  private async ensureTargetHistory(market: RotationMarket, symbol: string, days: number, refresh: boolean) {
    const policy = marketPolicies[market]
    const cached = await this.loadCanonicalHistory({
      market,
      symbol,
      adjustType: policy.assetAdjustType,
      dataVersion: policy.assetDataVersion,
      days,
    })
    if (!refresh) return { history: cached, name: null as string | null, providerAttempts: [] as unknown[] }
    if (this.isCacheCurrent(cached)) {
      return { history: cached, name: null as string | null, providerAttempts: [{ provider: 'canonical_cache', status: 'current', returnedDays: cached.length }] }
    }

    try {
      if (market === 'CN') {
        const selected = await getSmartQfqStockHistory(symbol, days)
        if (selected.history.length > 0 && selected.selectedProvider) {
          await this.persistCanonicalHistory({
            market,
            symbol,
            history: selected.history,
            provider: selected.selectedProvider,
            providerSymbol: symbol,
            adjustType: policy.assetAdjustType,
            dataVersion: policy.assetDataVersion,
            expectedDays: days,
            currency: policy.currency,
            timezone: policy.timezone,
          })
        }
        const history = await this.loadCanonicalHistory({ market, symbol, adjustType: policy.assetAdjustType, dataVersion: policy.assetDataVersion, days })
        return { history: history.length > 0 ? history : cached, name: selected.history.find((row) => row.name)?.name || null, providerAttempts: selected.attempts }
      }
      let selected: Awaited<ReturnType<RelativeRotationUniverseService['fetchYahooHistory']>>
      const providerAttempts: unknown[] = []
      try {
        selected = await this.fetchYahooHistory(market, symbol, days, true)
      } catch (yahooError) {
        providerAttempts.push({ provider: 'yahoo_adjusted', status: 'failed', reason: yahooError instanceof Error ? yahooError.message : String(yahooError) })
        selected = await this.fetchPublicFallbackHistory(market, symbol, days, false)
      }
      if (selected.history.length > 0) {
        await this.persistCanonicalHistory({
          market,
          symbol,
          history: selected.history,
          provider: selected.provider,
          providerSymbol: selected.providerSymbol,
          adjustType: policy.assetAdjustType,
          dataVersion: policy.assetDataVersion,
          expectedDays: days,
          currency: policy.currency,
          timezone: policy.timezone,
        })
      }
      const history = await this.loadCanonicalHistory({ market, symbol, adjustType: policy.assetAdjustType, dataVersion: policy.assetDataVersion, days })
      providerAttempts.push({ provider: selected.provider, returnedDays: selected.history.length, status: selected.history.length ? 'success' : 'empty' })
      return { history: history.length > 0 ? history : cached, name: selected.name, providerAttempts }
    } catch (error) {
      return {
        history: cached,
        name: null,
        providerAttempts: [{ provider: market === 'CN' ? 'smart_cn_qfq' : 'yahoo_adjusted', status: 'failed', reason: error instanceof Error ? error.message : String(error) }],
      }
    }
  }

  private async ensureBenchmarkHistory(market: RotationMarket, days: number, refresh: boolean) {
    const policy = marketPolicies[market]
    const cached = await this.loadCanonicalHistory({
      market,
      symbol: policy.benchmarkSymbol,
      adjustType: 'none',
      dataVersion: PRICE_INDEX_CANONICAL_VERSION,
      days,
    })
    if (!refresh) return { history: cached, providerAttempts: [] as unknown[] }
    if (this.isCacheCurrent(cached)) {
      return { history: cached, providerAttempts: [{ provider: 'canonical_cache', status: 'current', returnedDays: cached.length }] }
    }
    try {
      if (market === 'CN') {
        const selected = await getSmartChinaIndexHistory(policy.benchmarkSymbol, days)
        if (selected.history.length > 0 && selected.selectedProvider) {
          await this.persistCanonicalHistory({
            market,
            symbol: policy.benchmarkSymbol,
            history: selected.history,
            provider: selected.selectedProvider,
            providerSymbol: policy.benchmarkSymbol,
            adjustType: 'none',
            dataVersion: PRICE_INDEX_CANONICAL_VERSION,
            expectedDays: days,
            currency: policy.currency,
            timezone: policy.timezone,
          })
        }
        const history = await this.loadCanonicalHistory({ market, symbol: policy.benchmarkSymbol, adjustType: 'none', dataVersion: PRICE_INDEX_CANONICAL_VERSION, days })
        return { history: history.length > 0 ? history : cached, providerAttempts: selected.attempts }
      }
      let selected: Awaited<ReturnType<RelativeRotationUniverseService['fetchYahooHistory']>>
      const providerAttempts: unknown[] = []
      try {
        selected = await this.fetchYahooHistory(market, policy.benchmarkSymbol, days, false)
      } catch (yahooError) {
        providerAttempts.push({ provider: 'yahoo_price_index', status: 'failed', reason: yahooError instanceof Error ? yahooError.message : String(yahooError) })
        selected = await this.fetchPublicFallbackHistory(market, policy.benchmarkSymbol, days, true)
      }
      if (selected.history.length > 0) {
        await this.persistCanonicalHistory({
          market,
          symbol: policy.benchmarkSymbol,
          history: selected.history,
          provider: selected.provider,
          providerSymbol: selected.providerSymbol,
          adjustType: 'none',
          dataVersion: PRICE_INDEX_CANONICAL_VERSION,
          expectedDays: days,
          currency: policy.currency,
          timezone: policy.timezone,
        })
      }
      const history = await this.loadCanonicalHistory({ market, symbol: policy.benchmarkSymbol, adjustType: 'none', dataVersion: PRICE_INDEX_CANONICAL_VERSION, days })
      providerAttempts.push({ provider: selected.provider, returnedDays: selected.history.length, status: selected.history.length ? 'success' : 'empty' })
      return { history: history.length > 0 ? history : cached, providerAttempts }
    } catch (error) {
      return {
        history: cached,
        providerAttempts: [{ provider: market === 'CN' ? 'smart_cn_index' : 'yahoo_price_index', status: 'failed', reason: error instanceof Error ? error.message : String(error) }],
      }
    }
  }

  private sourceProviders(history: StockHistoryData[]) {
    return Array.from(new Set(history.map((row) => String(row.source || '').replace(/^cache:/, '')).filter(Boolean)))
  }

  private freshness(assetHistory: StockHistoryData[], benchmarkHistory: StockHistoryData[]) : { status: RotationFreshness; lag: number | null } {
    const assetDate = assetHistory.at(-1)?.date
    const benchmarkDates = benchmarkHistory.map((row) => row.date).sort()
    if (!assetDate || benchmarkDates.length === 0) return { status: 'unknown', lag: null }
    const lag = benchmarkDates.filter((date) => date > assetDate).length
    return { status: lag === 0 ? 'fresh' : lag === 1 ? 'delayed' : 'stale', lag }
  }

  private readiness(sampleDays: number, benchmarkSampleDays: number, pointCount: number): RotationReadiness {
    if (pointCount >= 12 && sampleDays >= MINIMUM_VERIFIED_DAYS && benchmarkSampleDays >= MINIMUM_VERIFIED_DAYS) return 'verified'
    if (pointCount >= 12) return 'limited'
    if (sampleDays > 0 || benchmarkSampleDays > 0) return 'insufficient'
    return 'unavailable'
  }

  private blockers(params: { frequency: RelativeRotationFrequency; sampleDays: number; benchmarkSampleDays: number; pointCount: number }) {
    const minimumAligned = params.frequency === 'daily' ? 91 : 53
    return [
      ...(params.sampleDays === 0 ? ['asset_history_unavailable'] : []),
      ...(params.benchmarkSampleDays === 0 ? ['benchmark_history_unavailable'] : []),
      ...(params.pointCount < 12 ? [`formula_samples_insufficient:${params.frequency}:${minimumAligned}`] : []),
      ...(params.sampleDays < MINIMUM_VERIFIED_DAYS ? [`verification_history_below_minimum:${params.sampleDays}/${MINIMUM_VERIFIED_DAYS}`] : []),
    ]
  }

  private async persistSeries(itemId: string, frequency: RelativeRotationFrequency, assetHistory: StockHistoryData[], benchmarkHistory: StockHistoryData[]) {
    const item = await prisma.relativeRotationWatchlistItem.findUniqueOrThrow({ where: { id: itemId } })
    const market = item.market as RotationMarket
    const policy = marketPolicies[market]
    const result = buildRelativeRotationSeries(assetHistory, benchmarkHistory, frequency)
    const freshness = this.freshness(assetHistory, benchmarkHistory)
    const readiness = this.readiness(assetHistory.length, benchmarkHistory.length, result.points.length)
    const blockers = this.blockers({ frequency, sampleDays: assetHistory.length, benchmarkSampleDays: benchmarkHistory.length, pointCount: result.points.length })
    const providers = this.sourceProviders(assetHistory)
    const warnings = [
      ...(market === 'CN' ? [] : [`港美股历史行情当前为单一来源：${providers.join(' / ') || 'unavailable'}。`]),
      ...(providers.some((provider) => provider.includes('split_adjusted')) ? ['备用源未提供正式复权因子，系统仅对可识别拆并股跳变做价格连续化。'] : []),
      ...(readiness === 'limited' ? ['公式已可计算，但不足756个交易日，仅作有限历史观察。'] : []),
    ]
    const series = await prisma.relativeRotationWatchlistSeries.upsert({
      where: {
        watchlistItemId_benchmarkId_frequency_formulaVersion: {
          watchlistItemId: itemId,
          benchmarkId: policy.benchmarkId,
          frequency,
          formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
        },
      },
      create: {
        watchlistItemId: itemId,
        benchmarkId: policy.benchmarkId,
        benchmarkSymbol: policy.benchmarkSymbol,
        frequency,
        formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
        dataVersion: RELATIVE_ROTATION_DATA_VERSION,
        adjustType: policy.assetAdjustType,
        readiness,
        freshness: freshness.status,
        freshnessLag: freshness.lag,
        coveragePercent: result.coveragePercent,
        sampleDays: assetHistory.length,
        benchmarkSampleDays: benchmarkHistory.length,
        commonAsOfDate: result.points.at(-1)?.date ? toUtcDate(result.points.at(-1)!.date) : null,
        sourceProvidersJson: JSON.stringify(providers),
        blockersJson: JSON.stringify(blockers),
        warningsJson: JSON.stringify(warnings),
      },
      update: {
        readiness,
        freshness: freshness.status,
        freshnessLag: freshness.lag,
        coveragePercent: result.coveragePercent,
        sampleDays: assetHistory.length,
        benchmarkSampleDays: benchmarkHistory.length,
        commonAsOfDate: result.points.at(-1)?.date ? toUtcDate(result.points.at(-1)!.date) : null,
        sourceProvidersJson: JSON.stringify(providers),
        blockersJson: JSON.stringify(blockers),
        warningsJson: JSON.stringify(warnings),
        refreshedAt: new Date(),
      },
    })
    await prisma.$transaction(async (tx) => {
      await tx.relativeRotationWatchlistPoint.deleteMany({ where: { seriesId: series.id } })
      if (result.points.length > 0) {
        await tx.relativeRotationWatchlistPoint.createMany({
          data: result.points.map((point) => ({
            seriesId: series.id,
            tradeDate: toUtcDate(point.date),
            relativePrice: point.relativePrice,
            relativeTrend: point.relativeTrend,
            relativeMomentum: point.relativeMomentum,
            quadrant: point.quadrant,
            deltaX: point.deltaX,
            deltaY: point.deltaY,
            speed: point.speed,
          })),
        })
      }
    })
    return { frequency, readiness, freshness: freshness.status, sampleDays: assetHistory.length, pointCount: result.points.length, blockers, warnings }
  }

  private async lookupCnName(symbol: string) {
    try {
      const raw = parseJson<any>(await readFile(quoteListCachePath, 'utf8'), {})
      const rows = Array.isArray(raw) ? raw : raw.items || raw.data || raw.list || []
      const found = rows.find((row: any) => String(row.code || row.symbol || '') === symbol)
      return found?.name ? String(found.name) : null
    } catch {
      return null
    }
  }

  private async resolveIdentity(market: RotationMarket, symbol: string) {
    const targetKey = `${market}:${symbol}`
    const local = await prisma.asset.findFirst({
      where: { OR: [{ symbol }, ...(market === 'HK' ? [{ symbol: symbol.replace(/\.HK$/, '') }] : [])] },
    })
    if (local) return { name: local.name, status: 'verified', evidence: [`asset:${local.id}`], warnings: [] as string[] }
    if (knownSecurityNames[targetKey]) return { name: knownSecurityNames[targetKey], status: 'verified', evidence: [`official_identity:${targetKey}`], warnings: [] as string[] }
    if (market === 'CN') {
      const cachedName = await this.lookupCnName(symbol)
      if (cachedName) return { name: cachedName, status: 'verified', evidence: [`a_share_quote_list:${symbol}`], warnings: [] as string[] }
    }
    try {
      const metadata = await this.fetchYahooHistory(market, symbol, 120, market !== 'CN')
      if (metadata.history.length > 0) {
        return {
          name: metadata.name || symbol,
          status: 'verified',
          evidence: [`yahoo_metadata:${metadata.providerSymbol}`],
          warnings: metadata.name ? [] : ['行情已确认代码，但数据源未返回证券名称。'],
        }
      }
    } catch (error) {
      if (market !== 'CN') {
        try {
          const fallback = await this.fetchPublicFallbackHistory(market, symbol, 120, false)
          if (fallback.history.length > 0) {
            return {
              name: fallback.name || symbol,
              status: 'verified',
              evidence: [`${fallback.provider}:${fallback.providerSymbol}`],
              warnings: [
                `Yahoo身份源不可用，已由${fallback.provider}确认代码。`,
                ...(!fallback.name ? ['数据源未返回证券名称，暂以标准代码展示。'] : []),
              ],
            }
          }
        } catch {
          // Preserve the original identity error below when both providers fail.
        }
      }
      return {
        name: symbol,
        status: 'provisional',
        evidence: [`explicit_market_symbol:${targetKey}`],
        warnings: [`身份数据源暂不可用：${error instanceof Error ? error.message : String(error)}`],
      }
    }
    return { name: symbol, status: 'provisional', evidence: [`explicit_market_symbol:${targetKey}`], warnings: ['证券名称尚未由数据源确认。'] }
  }

  private serializeWatchlistItem(item: any) {
    return {
      id: item.id,
      targetKey: `${item.market}:${item.symbol}`,
      market: item.market,
      symbol: item.symbol,
      name: item.name,
      assetType: item.assetType,
      exchange: item.exchange,
      currency: item.currency,
      identityStatus: item.identityStatus,
      identityEvidence: parseJson(item.identityEvidenceJson, []),
      identityWarnings: parseJson(item.identityWarningsJson, []),
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
      series: (item.series || []).map((series: any) => ({
        frequency: series.frequency,
        readiness: series.readiness,
        freshness: series.freshness,
        freshnessLag: series.freshnessLag,
        sampleDays: series.sampleDays,
        commonAsOfDate: series.commonAsOfDate?.toISOString().slice(0, 10) || null,
        refreshedAt: series.refreshedAt.toISOString(),
        blockers: parseJson(series.blockersJson, []),
        warnings: parseJson(series.warningsJson, []),
      })),
    }
  }

  async listWatchlist(userId: string) {
    await ensureUser(prisma, userId)
    const items = await prisma.relativeRotationWatchlistItem.findMany({
      where: { userId },
      include: { series: { orderBy: { frequency: 'asc' } } },
      orderBy: [{ market: 'asc' }, { createdAt: 'asc' }],
    })
    return {
      schemaVersion: 'fams.relative_rotation.watchlist.v1',
      generatedAt: new Date().toISOString(),
      limit: WATCHLIST_LIMIT,
      count: items.length,
      items: items.map((item) => this.serializeWatchlistItem(item)),
    }
  }

  async addWatchlistItem(userId: string, marketInput: string, codeInput: string, options: { refresh?: boolean; years?: number } = {}) {
    await ensureUser(prisma, userId)
    const target = normalizeRotationTarget(marketInput, codeInput)
    const existing = await prisma.relativeRotationWatchlistItem.findUnique({
      where: { userId_market_symbol: { userId, market: target.market, symbol: target.symbol } },
    })
    let item = existing
    let created = false
    if (!item) {
      const count = await prisma.relativeRotationWatchlistItem.count({ where: { userId } })
      if (count >= WATCHLIST_LIMIT) throw new Error(`RRG_WATCHLIST_LIMIT: 自选列表最多${WATCHLIST_LIMIT}个标的`)
      const identity = await this.resolveIdentity(target.market, target.symbol)
      item = await prisma.relativeRotationWatchlistItem.create({
        data: {
          userId,
          market: target.market,
          symbol: target.symbol,
          name: identity.name,
          assetType: target.assetType,
          exchange: target.exchange,
          currency: target.currency,
          identityStatus: identity.status,
          identityEvidenceJson: JSON.stringify(identity.evidence),
          identityWarningsJson: JSON.stringify(identity.warnings),
        },
      })
      created = true
    }
    let refreshResult: unknown = null
    if (options.refresh !== false) refreshResult = await this.refreshWatchlistItem(userId, item.id, { years: options.years })
    const hydrated = await prisma.relativeRotationWatchlistItem.findUniqueOrThrow({
      where: { id: item.id },
      include: { series: true },
    })
    return { created, item: this.serializeWatchlistItem(hydrated), refresh: refreshResult }
  }

  async refreshWatchlistItem(userId: string, itemId: string, options: { years?: number } = {}) {
    const item = await prisma.relativeRotationWatchlistItem.findFirst({ where: { id: itemId, userId } })
    if (!item) throw new Error('RRG_WATCHLIST_NOT_FOUND: 自选标的不存在')
    const market = item.market as RotationMarket
    const years = Math.max(1, Math.min(RELATIVE_ROTATION_TIMELINE_MAX_YEARS, Math.floor(options.years || 8)))
    const days = this.historyDaysForYears(years)
    const run = await prisma.relativeRotationWatchlistRefreshRun.create({
      data: { watchlistItemId: item.id, requestedYears: years },
    })
    try {
      const [asset, benchmark] = await Promise.all([
        this.ensureTargetHistory(market, item.symbol, days, true),
        this.ensureBenchmarkHistory(market, days, true),
      ])
      if (asset.name && (item.identityStatus !== 'verified' || item.name === item.symbol)) {
        await prisma.relativeRotationWatchlistItem.update({
          where: { id: item.id },
          data: {
            name: asset.name,
            identityStatus: 'verified',
            identityEvidenceJson: JSON.stringify([...parseJson<string[]>(item.identityEvidenceJson, []), `history_metadata:${item.symbol}`]),
          },
        })
      }
      const series = []
      for (const frequency of ['weekly', 'daily'] as const) {
        series.push(await this.persistSeries(item.id, frequency, asset.history, benchmark.history))
      }
      const status = series.some((row) => row.readiness === 'verified' || row.readiness === 'limited') ? 'completed' : 'partial'
      const summary = {
        market,
        symbol: item.symbol,
        assetSampleDays: asset.history.length,
        benchmarkSampleDays: benchmark.history.length,
        series,
      }
      await prisma.relativeRotationWatchlistRefreshRun.update({
        where: { id: run.id },
        data: {
          status,
          providerAttemptsJson: JSON.stringify([...asset.providerAttempts, ...benchmark.providerAttempts]),
          summaryJson: JSON.stringify(summary),
          completedAt: new Date(),
        },
      })
      return { runId: run.id, status, ...summary }
    } catch (error) {
      await prisma.relativeRotationWatchlistRefreshRun.update({
        where: { id: run.id },
        data: { status: 'failed', errorMessage: error instanceof Error ? error.message : String(error), completedAt: new Date() },
      })
      throw error
    }
  }

  async deleteWatchlistItem(userId: string, itemId: string) {
    const item = await prisma.relativeRotationWatchlistItem.findFirst({
      where: { id: itemId, userId },
      include: { series: { include: { _count: { select: { points: true } } } }, _count: { select: { refreshRuns: true } } },
    })
    if (!item) throw new Error('RRG_WATCHLIST_NOT_FOUND: 自选标的不存在')
    const [sharedMarketBarsRetained, holding] = await Promise.all([
      prisma.marketBarCanonical.count({ where: { market: item.market, symbol: item.symbol } }),
      prisma.position.findFirst({
        where: { userId, status: 'open', asset: { symbol: { in: [item.symbol, item.symbol.replace(/\.HK$/, '')] } } },
        select: { id: true },
      }),
    ])
    const deletedSeries = item.series.length
    const deletedPoints = item.series.reduce((sum, series) => sum + series._count.points, 0)
    const deletedRefreshRuns = item._count.refreshRuns
    await prisma.relativeRotationWatchlistItem.delete({ where: { id: item.id } })
    return {
      deleted: true,
      targetKey: `${item.market}:${item.symbol}`,
      deletedSeries,
      deletedPoints,
      deletedRefreshRuns,
      sharedMarketBarsRetained,
      stillVisibleViaHolding: Boolean(holding),
    }
  }

  private async targetsForUser(userId: string, market: RotationMarket, frequency: RelativeRotationFrequency) {
    const [positions, watchlist] = await Promise.all([
      prisma.position.findMany({
        where: { userId, status: 'open', asset: { type: { in: ['stock', 'etf'] } } },
        include: { asset: true },
        orderBy: { marketValue: 'desc' },
      }),
      prisma.relativeRotationWatchlistItem.findMany({
        where: { userId, market },
        include: {
          series: {
            where: { frequency },
            include: { points: { orderBy: { tradeDate: 'asc' } } },
          },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ])
    const byKey = new Map<string, any>()
    for (const position of positions) {
      const resolvedMarket = positionMarket(position.asset)
      if (resolvedMarket !== market) continue
      const symbol = canonicalPositionSymbol(market, position.asset.symbol)
      const targetKey = `${market}:${symbol}`
      byKey.set(targetKey, {
        targetKey,
        market,
        symbol,
        name: position.asset.name,
        assetType: position.asset.type,
        sources: ['holding'],
        positionId: position.id,
        assetId: position.assetId,
        watchlistItemId: null,
        series: null,
      })
    }
    for (const item of watchlist) {
      const targetKey = `${market}:${item.symbol}`
      const existing = byKey.get(targetKey)
      if (existing) {
        existing.sources.push('watchlist')
        existing.watchlistItemId = item.id
        existing.series = item.series[0] || null
        existing.name = item.name || existing.name
      } else {
        byKey.set(targetKey, {
          targetKey,
          market,
          symbol: item.symbol,
          name: item.name,
          assetType: item.assetType,
          sources: ['watchlist'],
          positionId: null,
          assetId: null,
          watchlistItemId: item.id,
          series: item.series[0] || null,
        })
      }
    }
    return Array.from(byKey.values())
  }

  private async cachedHoldingSeries(target: any, frequency: RelativeRotationFrequency, years: number) {
    const market = target.market as RotationMarket
    const policy = marketPolicies[market]
    const days = this.historyDaysForYears(years)
    const [assetHistory, benchmarkHistory] = await Promise.all([
      this.loadCanonicalHistory({ market, symbol: target.symbol, adjustType: policy.assetAdjustType, dataVersion: policy.assetDataVersion, days }),
      this.loadCanonicalHistory({ market, symbol: policy.benchmarkSymbol, adjustType: 'none', dataVersion: PRICE_INDEX_CANONICAL_VERSION, days }),
    ])
    const result = buildRelativeRotationSeries(assetHistory, benchmarkHistory, frequency)
    const freshness = this.freshness(assetHistory, benchmarkHistory)
    const providers = this.sourceProviders(assetHistory)
    return {
      readiness: this.readiness(assetHistory.length, benchmarkHistory.length, result.points.length),
      freshness: freshness.status,
      freshnessLag: freshness.lag,
      assetAsOfDate: assetHistory.at(-1)?.date || null,
      coveragePercent: result.coveragePercent,
      sampleDays: assetHistory.length,
      benchmarkSampleDays: benchmarkHistory.length,
      commonAsOfDate: result.points.at(-1)?.date || null,
      sourceProviders: providers,
      blockers: this.blockers({ frequency, sampleDays: assetHistory.length, benchmarkSampleDays: benchmarkHistory.length, pointCount: result.points.length }),
      warnings: market === 'CN' ? [] : [`港美股历史行情当前为单一来源：${providers.join(' / ') || 'unavailable'}。`],
      points: result.points,
      refreshedAt: null,
    }
  }

  async getUniverseTimeline(userId: string, options: { market?: string; frequency?: string; years?: number } = {}) {
    await ensureUser(prisma, userId)
    const market = (['CN', 'HK', 'US'].includes(String(options.market || '').toUpperCase()) ? String(options.market).toUpperCase() : 'CN') as RotationMarket
    const frequency = options.frequency === 'daily' ? 'daily' : 'weekly'
    const years = Math.max(1, Math.min(RELATIVE_ROTATION_TIMELINE_MAX_YEARS, Math.floor(Number(options.years || 8))))
    const policy = marketPolicies[market]
    const requestedHistoryDays = this.historyDaysForYears(years)
    const [targets, benchmarkHistory] = await Promise.all([
      this.targetsForUser(userId, market, frequency),
      this.loadCanonicalHistory({
        market,
        symbol: policy.benchmarkSymbol,
        adjustType: 'none',
        dataVersion: PRICE_INDEX_CANONICAL_VERSION,
        days: requestedHistoryDays,
      }),
    ])
    const benchmarkProviders = this.sourceProviders(benchmarkHistory)
    const items = []
    for (const target of targets) {
      let data: any
      if (target.series) {
        const currentAssetHistory = await this.loadCanonicalHistory({
          market,
          symbol: target.symbol,
          adjustType: policy.assetAdjustType,
          dataVersion: policy.assetDataVersion,
          days: 2,
        })
        const currentFreshness = this.freshness(currentAssetHistory, benchmarkHistory)
        data = {
          readiness: target.series.readiness,
          freshness: currentFreshness.status,
          freshnessLag: currentFreshness.lag,
          assetAsOfDate: currentAssetHistory.at(-1)?.date || null,
          coveragePercent: target.series.coveragePercent,
          sampleDays: target.series.sampleDays,
          benchmarkSampleDays: target.series.benchmarkSampleDays,
          commonAsOfDate: target.series.commonAsOfDate?.toISOString().slice(0, 10) || null,
          sourceProviders: parseJson(target.series.sourceProvidersJson, []),
          blockers: parseJson(target.series.blockersJson, []),
          warnings: parseJson(target.series.warningsJson, []),
          points: target.series.points.map((point: any) => ({
            date: point.tradeDate.toISOString().slice(0, 10),
            relativePrice: point.relativePrice,
            relativeTrend: point.relativeTrend,
            relativeMomentum: point.relativeMomentum,
            quadrant: point.quadrant,
            deltaX: point.deltaX,
            deltaY: point.deltaY,
            speed: point.speed,
          })),
          refreshedAt: target.series.refreshedAt.toISOString(),
        }
      } else {
        data = await this.cachedHoldingSeries(target, frequency, years)
      }
      const endDate = data.commonAsOfDate || isoDate(new Date())
      const start = toUtcDate(endDate)
      start.setUTCFullYear(start.getUTCFullYear() - years)
      const startDate = isoDate(start)
      const points = data.points.filter((point: any) => point.date >= startDate && point.date <= endDate)
      items.push({
        targetKey: target.targetKey,
        market,
        symbol: target.symbol,
        name: target.name,
        assetType: target.assetType,
        sources: target.sources,
        positionId: target.positionId,
        assetId: target.assetId,
        watchlistItemId: target.watchlistItemId,
        deletable: Boolean(target.watchlistItemId),
        dataStatus: data.readiness === 'verified' ? 'ready' : data.readiness === 'limited' ? 'partial' : 'insufficient',
        readiness: data.readiness,
        freshness: data.freshness,
        freshnessLag: data.freshnessLag,
        assetAsOfDate: data.assetAsOfDate,
        coveragePercent: data.coveragePercent,
        sampleDays: data.sampleDays,
        benchmarkSampleDays: data.benchmarkSampleDays,
        firstPointDate: points[0]?.date || null,
        lastPointDate: points.at(-1)?.date || null,
        commonAsOfDate: data.commonAsOfDate,
        sourceProviders: data.sourceProviders,
        blockers: data.blockers,
        warnings: data.warnings,
        refreshedAt: data.refreshedAt,
        points,
      })
    }
    const dates = Array.from(new Set(items.flatMap((item) => item.points.map((point: any) => point.date)))).sort()
    const endDate = dates.at(-1) || isoDate(new Date())
    const start = toUtcDate(endDate)
    start.setUTCFullYear(start.getUTCFullYear() - years)
    return {
      schemaVersion: 'fams.relative_rotation.universe_timeline.v2',
      generatedAt: new Date().toISOString(),
      universe: 'holdings_and_watchlist',
      market,
      benchmark: {
        id: policy.benchmarkId,
        symbol: policy.benchmarkSymbol,
        name: policy.benchmarkName,
        status: benchmarkHistory.length > 0 ? 'price_index' : 'unavailable',
        sourceProviders: benchmarkProviders,
      },
      formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
      frequency,
      requestedYears: years,
      requestedHistoryDays,
      visibleRange: { startDate: isoDate(start), endDate },
      items,
      dates,
      availableDateCount: dates.length,
      eligibleCount: items.length,
      readyCount: items.filter((item) => item.readiness === 'verified').length,
      limitedCount: items.filter((item) => item.readiness === 'limited').length,
      refreshRecommended: items.some((item) => item.freshness !== 'fresh' || ['insufficient', 'unavailable'].includes(item.readiness)),
      refreshReasons: items.flatMap((item) => item.freshness !== 'fresh' ? [`${item.targetKey}:${item.freshness}`] : []),
      notTradingAdvice: true,
    }
  }

  normalizeResearchTargets(marketInput: string, targets: RotationResearchTargetInput[]) {
    const market = String(marketInput || '').trim().toUpperCase() as RotationMarket
    if (!['CN', 'HK', 'US'].includes(market)) throw new Error('RRG_RESEARCH_MARKET_INVALID: market must be CN, HK or US')
    if (!Array.isArray(targets) || targets.length < 1) throw new Error('RRG_RESEARCH_TARGETS_REQUIRED: 至少选择一个研究标的')
    if (targets.length > 16) throw new Error('RRG_RESEARCH_TARGET_LIMIT: 单项研究最多16个标的')
    const normalized = targets.map((target) => normalizeRotationResearchTarget(market, target))
    const seen = new Set<string>()
    for (const target of normalized) {
      if (seen.has(target.targetKey)) throw new Error(`RRG_RESEARCH_TARGET_DUPLICATE: ${target.symbol}`)
      seen.add(target.targetKey)
    }
    return normalized
  }

  private researchTargetStorage(target: NormalizedRotationResearchTarget) {
    const policy = marketPolicies[target.market]
    if (target.kind === 'equity') {
      return {
        market: target.market,
        adjustType: policy.assetAdjustType,
        dataVersion: policy.assetDataVersion,
        currency: policy.currency,
        timezone: policy.timezone,
      }
    }
    if (target.market === 'CN') {
      return {
        market: 'CN' as const,
        adjustType: 'none',
        dataVersion: RESEARCH_PRICE_INDEX_CANONICAL_VERSION,
        currency: marketPolicies.CN.currency,
        timezone: marketPolicies.CN.timezone,
      }
    }
    return {
      market: 'US' as const,
      adjustType: 'none',
      dataVersion: RESEARCH_PRICE_INDEX_CANONICAL_VERSION,
      currency: marketPolicies.US.currency,
      timezone: marketPolicies.US.timezone,
    }
  }

  private loadResearchTargetHistory(target: NormalizedRotationResearchTarget, days: number) {
    const storage = this.researchTargetStorage(target)
    return this.loadCanonicalHistory({
      market: storage.market,
      symbol: target.symbol,
      adjustType: storage.adjustType,
      dataVersion: storage.dataVersion,
      days,
    })
  }

  private async ensureResearchTargetHistory(target: NormalizedRotationResearchTarget, days: number, refresh: boolean) {
    if (target.kind === 'equity') {
      return this.ensureTargetHistory(target.market, target.symbol, days, refresh)
    }

    const storage = this.researchTargetStorage(target)
    const cached = await this.loadResearchTargetHistory(target, days)
    if (!refresh) return { history: cached, name: target.name, providerAttempts: [] as unknown[] }
    const isFormulaDerivedDxy = target.market === 'US' && cached.some((point) => point.source?.includes('ecb_dxy_formula'))
    if (this.isCacheCurrent(cached) && !isFormulaDerivedDxy) {
      return {
        history: cached,
        name: target.name,
        providerAttempts: [{ provider: 'canonical_cache', status: 'current', returnedDays: cached.length }],
      }
    }

    if (target.market === 'US') {
      const providerAttempts: unknown[] = []
      try {
        // DXY is an index level, so use the unadjusted price-index series. Do
        // not substitute an ETF proxy on failure: that would silently alter the
        // meaning of the locked equal-weight macro benchmark.
        const selected = await this.fetchYahooHistory('US', target.symbol, days, false)
        providerAttempts.push({ provider: selected.provider, returnedDays: selected.history.length, status: selected.history.length ? 'success' : 'empty' })
        if (selected.history.length > 0) {
          await this.persistCanonicalHistory({
            market: storage.market,
            symbol: target.symbol,
            history: selected.history,
            provider: selected.provider,
            providerSymbol: selected.providerSymbol,
            adjustType: storage.adjustType,
            dataVersion: storage.dataVersion,
            expectedDays: days,
            currency: storage.currency,
            timezone: storage.timezone,
          })
        }
        const history = await this.loadResearchTargetHistory(target, days)
        if (history.length > 0) {
          return {
            history,
            name: selected.name || target.name,
            providerAttempts,
          }
        }
      } catch (error) {
        providerAttempts.push({ provider: 'yahoo_price_index', status: 'failed', reason: error instanceof Error ? error.message : String(error) })
      }
      try {
        // The fallback replicates the published ICE DXY formula with ECB daily
        // reference rates.  It is explicitly surfaced in source/warnings and
        // is never presented as an official ICE close or substituted with UUP.
        const selected = await this.fetchDxyFormulaHistory(days)
        await this.persistCanonicalHistory({
          market: storage.market,
          symbol: target.symbol,
          history: selected.history,
          provider: selected.provider,
          providerSymbol: selected.providerSymbol,
          adjustType: storage.adjustType,
          dataVersion: storage.dataVersion,
          expectedDays: days,
          currency: storage.currency,
          timezone: storage.timezone,
        })
        const history = await this.loadResearchTargetHistory(target, days)
        return {
          history: history.length > 0 ? history : cached,
          name: selected.name,
          providerAttempts: [...providerAttempts, { provider: selected.provider, returnedDays: selected.history.length, status: 'success' }],
        }
      } catch (error) {
        return {
          history: cached,
          name: target.name,
          providerAttempts: [...providerAttempts, { provider: 'ecb_dxy_formula', status: 'failed', reason: error instanceof Error ? error.message : String(error) }],
        }
      }
    }

    try {
      const selected = await getSmartChinaIndexHistory(target.symbol, days)
      if (selected.history.length > 0 && selected.selectedProvider) {
        await this.persistCanonicalHistory({
          market: storage.market,
          symbol: target.symbol,
          history: selected.history,
          provider: selected.selectedProvider,
          providerSymbol: target.symbol,
          adjustType: storage.adjustType,
          dataVersion: storage.dataVersion,
          expectedDays: days,
          currency: storage.currency,
          timezone: storage.timezone,
        })
      }
      const history = await this.loadResearchTargetHistory(target, days)
      return {
        history: history.length > 0 ? history : cached,
        name: target.name,
        providerAttempts: selected.attempts,
      }
    } catch (error) {
      return {
        history: cached,
        name: target.name,
        providerAttempts: [{ provider: 'smart_cn_index', status: 'failed', reason: error instanceof Error ? error.message : String(error) }],
      }
    }
  }

  private researchPositionSymbol(market: RotationMarket, position: { symbol: string; exchange: string | null }) {
    const symbol = String(position.symbol || '').trim().toUpperCase()
    if (market === 'CN') return /^\d{6}$/.test(symbol) ? symbol : null
    if (market === 'HK' && (position.exchange === 'HK' || symbol.endsWith('.HK'))) {
      return symbol.endsWith('.HK') ? symbol : `${symbol.padStart(5, '0')}.HK`
    }
    if (market === 'US' && (position.exchange === 'US' || /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))) return symbol
    return null
  }

  private relativeReturnCorrelation(left: number[], right: number[]) {
    if (left.length !== right.length || left.length < 3) return null
    const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length
    const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length
    let covariance = 0
    let leftVariance = 0
    let rightVariance = 0
    for (let index = 0; index < left.length; index += 1) {
      const leftDelta = left[index] - leftMean
      const rightDelta = right[index] - rightMean
      covariance += leftDelta * rightDelta
      leftVariance += leftDelta * leftDelta
      rightVariance += rightDelta * rightDelta
    }
    return leftVariance > 0 && rightVariance > 0 ? covariance / Math.sqrt(leftVariance * rightVariance) : null
  }

  normalizeResearchBenchmark(
    targets: NormalizedRotationResearchTarget[],
    input?: RotationResearchBenchmarkInput,
  ): { mode: RotationResearchBenchmarkMode; targetKeys: string[] } {
    const mode = input?.mode === 'equal_weight_targets' ? 'equal_weight_targets' : 'market_default'
    if (mode === 'market_default') return { mode, targetKeys: [] }
    const targetKeys = Array.isArray(input?.targetKeys) ? input!.targetKeys.map(String).filter(Boolean) : []
    const validTargetKeys = new Set(targets.map((target) => target.targetKey))
    if (targetKeys.length < 2) throw new Error('RRG_RESEARCH_BENCHMARK_INVALID: 等权共同基准至少需要两个已选研究标的')
    if (new Set(targetKeys).size !== targetKeys.length || targetKeys.some((key) => !validTargetKeys.has(key))) {
      throw new Error('RRG_RESEARCH_BENCHMARK_INVALID: 等权共同基准包含不存在或重复的标的')
    }
    return { mode, targetKeys }
  }

  private resolveResearchBenchmark(params: {
    market: RotationMarket
    targets: NormalizedRotationResearchTarget[]
    targetData: Array<{ target: NormalizedRotationResearchTarget; assetHistory: StockHistoryData[] }>
    benchmark: { mode: RotationResearchBenchmarkMode; targetKeys: string[] }
    days: number
  }) {
    const policy = marketPolicies[params.market]
    if (params.benchmark.mode === 'market_default') {
      return this.loadCanonicalHistory({
        market: params.market,
        symbol: policy.benchmarkSymbol,
        adjustType: 'none',
        dataVersion: PRICE_INDEX_CANONICAL_VERSION,
        days: params.days,
      }).then((history) => ({
        history,
        id: policy.benchmarkId,
        symbol: policy.benchmarkSymbol,
        name: policy.benchmarkName,
        mode: 'market_default' as const,
        status: history.length > 0 ? 'price_index' as const : 'unavailable' as const,
        sourceProviders: this.sourceProviders(history),
        components: [],
      }))
    }
    const byTargetKey = new Map(params.targetData.map((item) => [item.target.targetKey, item]))
    const selected = params.benchmark.targetKeys.map((targetKey) => byTargetKey.get(targetKey)!).filter(Boolean)
    const composite = buildEqualWeightResearchBenchmark(selected.map(({ target, assetHistory }) => ({
      targetKey: target.targetKey,
      symbol: target.symbol,
      name: target.name,
      history: assetHistory,
    })))
    return Promise.resolve({
      history: composite.history,
      id: 'equal_weight_targets',
      symbol: `EQW:${selected.map((item) => item.target.symbol).join('+')}`,
      name: `${selected.length}资产等权共同基准`,
      mode: 'equal_weight_targets' as const,
      status: composite.history.length > 0 ? 'composite' as const : 'unavailable' as const,
      sourceProviders: Array.from(new Set(selected.flatMap(({ assetHistory }) => this.sourceProviders(assetHistory)))),
      components: composite.components,
    })
  }

  private researchAssociations(items: Array<{ targetKey: string; points: ReturnType<typeof buildRelativeRotationSeries>['points'] }>) {
    const comparableItems = items.filter((item) => item.points.length > 0)
    const pairs: Array<{
      leftTargetKey: string
      rightTargetKey: string
      alignedPointCount: number
      relativeReturnCorrelation: number | null
      sameQuadrantRatio: number | null
      latestCoordinateDistance: number | null
    }> = []
    for (let leftIndex = 0; leftIndex < comparableItems.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < comparableItems.length; rightIndex += 1) {
        const left = comparableItems[leftIndex]
        const right = comparableItems[rightIndex]
        const leftByDate = new Map(left.points.map((point) => [point.date, point]))
        const rightByDate = new Map(right.points.map((point) => [point.date, point]))
        const commonDates = Array.from(leftByDate.keys()).filter((date) => rightByDate.has(date)).sort()
        const matchingQuadrants = commonDates.filter((date) => leftByDate.get(date)?.quadrant === rightByDate.get(date)?.quadrant).length
        const leftReturns: number[] = []
        const rightReturns: number[] = []
        for (let index = 1; index < commonDates.length; index += 1) {
          const previousDate = commonDates[index - 1]
          const date = commonDates[index]
          const leftPrevious = leftByDate.get(previousDate)?.relativePrice || 0
          const leftCurrent = leftByDate.get(date)?.relativePrice || 0
          const rightPrevious = rightByDate.get(previousDate)?.relativePrice || 0
          const rightCurrent = rightByDate.get(date)?.relativePrice || 0
          if (leftPrevious > 0 && leftCurrent > 0 && rightPrevious > 0 && rightCurrent > 0) {
            leftReturns.push((leftCurrent / leftPrevious) - 1)
            rightReturns.push((rightCurrent / rightPrevious) - 1)
          }
        }
        const latestDate = commonDates.at(-1)
        const latestLeft = latestDate ? leftByDate.get(latestDate) : null
        const latestRight = latestDate ? rightByDate.get(latestDate) : null
        pairs.push({
          leftTargetKey: left.targetKey,
          rightTargetKey: right.targetKey,
          alignedPointCount: commonDates.length,
          relativeReturnCorrelation: this.relativeReturnCorrelation(leftReturns, rightReturns),
          sameQuadrantRatio: commonDates.length > 0 ? matchingQuadrants / commonDates.length : null,
          latestCoordinateDistance: latestLeft && latestRight
            ? Math.hypot(latestLeft.relativeTrend - latestRight.relativeTrend, latestLeft.relativeMomentum - latestRight.relativeMomentum)
            : null,
        })
      }
    }
    return pairs
  }

  async getResearchTimeline(userId: string, input: {
    market: string
    frequency?: string
    years?: number
    targets: RotationResearchTargetInput[]
    benchmark?: RotationResearchBenchmarkInput
    window?: RotationResearchWindow
    rollingWeeks?: number
  }) {
    await ensureUser(prisma, userId)
    const market = String(input.market || '').trim().toUpperCase() as RotationMarket
    const frequency = input.frequency === 'daily' ? 'daily' : 'weekly'
    const years = Math.max(1, Math.min(RESEARCH_TIMELINE_MAX_YEARS, Math.floor(Number(input.years || 8))))
    const targets = this.normalizeResearchTargets(market, input.targets)
    const benchmarkInput = this.normalizeResearchBenchmark(targets, input.benchmark)
    const requestedHistoryDays = this.historyDaysForYears(years)
    const [rawTargetData, positions] = await Promise.all([
      Promise.all(targets.map(async (target) => ({
        target,
        assetHistory: await this.loadResearchTargetHistory(target, requestedHistoryDays),
      }))),
      prisma.position.findMany({
        where: { userId, status: 'open' },
        include: { asset: { select: { symbol: true, exchange: true } } },
      }),
    ])
    const benchmark = await this.resolveResearchBenchmark({
      market,
      targets,
      targetData: rawTargetData,
      benchmark: benchmarkInput,
      days: requestedHistoryDays,
    })
    const holdingSymbols = new Set(positions
      .map((position) => this.researchPositionSymbol(market, position.asset))
      .filter((symbol): symbol is string => Boolean(symbol)))
    const targetData = rawTargetData.map(({ target, assetHistory }) => {
      const result = buildRelativeRotationSeries(assetHistory, benchmark.history, frequency)
      const freshness = this.freshness(assetHistory, benchmark.history)
      return { target, assetHistory, result, freshness }
    })
    const allDates = Array.from(new Set(targetData.flatMap(({ result }) => result.points.map((point) => point.date)))).sort()
    const actualEndDate = allDates.at(-1) || isoDate(new Date())
    const startInput = input.window?.startDate || ''
    const endInput = input.window?.endDate || ''
    if (startInput && !/^\d{4}-\d{2}-\d{2}$/.test(startInput)) throw new Error('RRG_RESEARCH_WINDOW_INVALID: startDate 必须为 YYYY-MM-DD')
    if (endInput && !/^\d{4}-\d{2}-\d{2}$/.test(endInput)) throw new Error('RRG_RESEARCH_WINDOW_INVALID: endDate 必须为 YYYY-MM-DD')
    if (startInput && endInput && startInput > endInput) throw new Error('RRG_RESEARCH_WINDOW_INVALID: 起始日期不能晚于结束日期')
    const selectedEndDate = endInput && endInput < actualEndDate ? endInput : actualEndDate
    const defaultStart = new Date(`${selectedEndDate}T00:00:00.000Z`)
    const rollingWeeks = Math.floor(Number(input.rollingWeeks || 0))
    if (rollingWeeks > 0) defaultStart.setUTCDate(defaultStart.getUTCDate() - (rollingWeeks * 7))
    else defaultStart.setUTCFullYear(defaultStart.getUTCFullYear() - years)
    const selectedStartDate = startInput || isoDate(defaultStart)
    const items = targetData.map(({ target, assetHistory, result, freshness }) => {
      const readiness = this.readiness(assetHistory.length, benchmark.history.length, result.points.length)
      // A partial warm-up can yield a handful of mathematical points, but it is
      // not yet an interpretable RRG trajectory.  Keep the evidence/status while
      // withholding those coordinates from the chart and pairwise comparison.
      const points = readiness === 'insufficient' || readiness === 'unavailable'
        ? []
        : result.points.filter((point) => point.date >= selectedStartDate && point.date <= selectedEndDate)
      const providers = this.sourceProviders(assetHistory)
      return {
        targetKey: target.targetKey,
        market,
        symbol: target.symbol,
        name: target.name,
        assetType: target.assetType,
        targetType: target.kind,
        taxonomy: target.taxonomy || null,
        sources: holdingSymbols.has(target.symbol) ? ['research', 'holding'] : ['research'],
        isCurrentHolding: holdingSymbols.has(target.symbol),
        dataStatus: readiness === 'verified' ? 'ready' : readiness === 'limited' ? 'partial' : 'insufficient',
        readiness,
        freshness: freshness.status,
        freshnessLag: freshness.lag,
        assetAsOfDate: assetHistory.at(-1)?.date || null,
        coveragePercent: result.coveragePercent,
        sampleDays: assetHistory.length,
        benchmarkSampleDays: benchmark.history.length,
        firstPointDate: points[0]?.date || null,
        lastPointDate: points.at(-1)?.date || null,
        commonAsOfDate: result.points.at(-1)?.date || null,
        refreshedAt: null,
        sourceProviders: providers,
        blockers: this.blockers({ frequency, sampleDays: assetHistory.length, benchmarkSampleDays: benchmark.history.length, pointCount: result.points.length }),
        warnings: [
          ...(market === 'CN' ? [] : [`港美股历史行情当前为单一来源：${providers.join(' / ') || 'unavailable'}。`]),
          ...(target.kind === 'index' ? ['指数目标使用价格指数口径，不做复权处理。'] : []),
          ...(target.symbol === 'DX-Y.NYB' && providers.includes('ecb_dxy_formula')
            ? ['DXY由 ICE 公开权重公式与 ECB 每日参考汇率复算；它不是 ICE 官方收盘，也不是 ETF 代理。']
            : []),
          ...(benchmark.mode === 'equal_weight_targets' ? ['共同基准为锁定成分的日度等权价格回报组合；未做汇率换算或总收益替代。'] : []),
          ...(['insufficient', 'unavailable'].includes(readiness) ? ['尚未达到有效 RRG 样本门槛，暂不绘制坐标或纳入关联比较。'] : []),
        ],
        points,
      }
    })
    const dates = Array.from(new Set(items.flatMap((item) => item.points.map((point) => point.date)))).sort()
    return {
      schemaVersion: 'fams.relative_rotation.research_timeline.v1',
      generatedAt: new Date().toISOString(),
      universe: 'research',
      market,
      benchmark: {
        id: benchmark.id,
        symbol: benchmark.symbol,
        name: benchmark.name,
        mode: benchmark.mode,
        status: benchmark.status,
        sourceProviders: benchmark.sourceProviders,
        components: benchmark.components,
      },
      formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
      frequency,
      requestedYears: years,
      requestedHistoryDays,
      visibleRange: { startDate: selectedStartDate, endDate: selectedEndDate },
      items,
      dates,
      availableDateCount: dates.length,
      eligibleCount: items.length,
      readyCount: items.filter((item) => item.readiness === 'verified').length,
      limitedCount: items.filter((item) => item.readiness === 'limited').length,
      refreshRecommended: benchmark.history.length === 0 || items.some((item) => item.freshness !== 'fresh' || ['insufficient', 'unavailable'].includes(item.readiness)),
      refreshReasons: [
        ...(benchmark.history.length === 0 ? [`benchmark:${benchmark.id}:unavailable`] : []),
        ...items.flatMap((item) => item.freshness !== 'fresh' ? [`${item.targetKey}:${item.freshness}`] : []),
      ],
      associations: this.researchAssociations(items.map((item) => ({ targetKey: item.targetKey, points: item.points }))),
      notTradingAdvice: true,
    }
  }

  async refreshResearchTimeline(userId: string, input: {
    market: string
    frequency?: string
    years?: number
    targets: RotationResearchTargetInput[]
    benchmark?: RotationResearchBenchmarkInput
    window?: RotationResearchWindow
    rollingWeeks?: number
  }) {
    await ensureUser(prisma, userId)
    const market = String(input.market || '').trim().toUpperCase() as RotationMarket
    const targets = this.normalizeResearchTargets(market, input.targets)
    const benchmarkInput = this.normalizeResearchBenchmark(targets, input.benchmark)
    const years = Math.max(1, Math.min(RESEARCH_TIMELINE_MAX_YEARS, Math.floor(Number(input.years || 8))))
    const days = this.historyDaysForYears(years)
    const marketBenchmark = benchmarkInput.mode === 'market_default'
      ? await this.ensureBenchmarkHistory(market, days, true)
      : null
    // SQLite uses a single connection on the mounted development volume. Refresh
    // sequentially so one target's canonical upsert cannot starve another target
    // from starting its transaction; public price fetches still remain bounded by
    // their provider timeouts.
    const refreshedTargets: Array<{
      targetKey: string
      symbol: string
      asset: Awaited<ReturnType<RelativeRotationUniverseService['ensureResearchTargetHistory']>>
    }> = []
    // Run the price-index leg first. In an equal-weight macro study, a missing
    // index otherwise invalidates the whole composite while slow ETF providers
    // consume the request budget. The remaining assets continue sequentially
    // to preserve SQLite write safety.
    const refreshOrder = [...targets].sort((left, right) => {
      if (left.kind === right.kind) return 0
      return left.kind === 'index' ? -1 : 1
    })
    for (const target of refreshOrder) {
      const asset = await this.ensureResearchTargetHistory(target, days, true)
      refreshedTargets.push({ targetKey: target.targetKey, symbol: target.symbol, asset })
    }
    const compositeBenchmark = benchmarkInput.mode === 'equal_weight_targets'
      ? buildEqualWeightResearchBenchmark(benchmarkInput.targetKeys.map((targetKey) => {
          const target = targets.find((candidate) => candidate.targetKey === targetKey)!
          const refreshed = refreshedTargets.find((candidate) => candidate.targetKey === targetKey)!
          return { targetKey, symbol: target.symbol, name: target.name, history: refreshed.asset.history }
        }))
      : null
    const benchmarkSampleDays = marketBenchmark?.history.length || compositeBenchmark?.history.length || 0
    const results: Array<{
      targetKey: string
      symbol: string
      status: 'completed' | 'partial'
      assetSampleDays: number
      benchmarkSampleDays: number
      providerAttempts: unknown[]
    }> = refreshedTargets.map((target) => ({
      targetKey: target.targetKey,
      symbol: target.symbol,
      status: target.asset.history.length > 0 && benchmarkSampleDays > 0 ? 'completed' : 'partial',
      assetSampleDays: target.asset.history.length,
      benchmarkSampleDays,
      providerAttempts: target.asset.providerAttempts,
    }))
    const timeline = await this.getResearchTimeline(userId, input)
    return {
      schemaVersion: 'fams.relative_rotation.research_refresh.v1',
      generatedAt: new Date().toISOString(),
      market,
      requestedTargets: targets.length,
      completedTargets: results.filter((result) => result.status === 'completed').length,
      results,
      timeline,
    }
  }

  async refreshUniverse(userId: string, input: { market?: string; targetKeys?: string[]; years?: number }) {
    const market = (['CN', 'HK', 'US'].includes(String(input.market || '').toUpperCase()) ? String(input.market).toUpperCase() : 'CN') as RotationMarket
    const years = Math.max(1, Math.min(RELATIVE_ROTATION_TIMELINE_MAX_YEARS, Math.floor(Number(input.years || 8))))
    const targetKeys = new Set((input.targetKeys || []).map(String))
    const targets = targetKeys.size === 0
      ? []
      : (await this.targetsForUser(userId, market, 'weekly')).filter((target) => targetKeys.has(target.targetKey))
    const days = this.historyDaysForYears(years)
    const results = []
    for (const target of targets) {
      if (target.watchlistItemId) {
        results.push(await this.refreshWatchlistItem(userId, target.watchlistItemId, { years }))
      } else {
        const [asset, benchmark] = await Promise.all([
          this.ensureTargetHistory(market, target.symbol, days, true),
          this.ensureBenchmarkHistory(market, days, true),
        ])
        results.push({
          status: asset.history.length > 0 && benchmark.history.length > 0 ? 'completed' : 'partial',
          market,
          symbol: target.symbol,
          assetSampleDays: asset.history.length,
          benchmarkSampleDays: benchmark.history.length,
        })
      }
    }
    return {
      schemaVersion: 'fams.relative_rotation.universe_refresh.v1',
      generatedAt: new Date().toISOString(),
      market,
      requestedTargets: targets.length,
      completedTargets: results.filter((result: any) => result.status === 'completed').length,
      results,
    }
  }
}

export const relativeRotationUniverseService = new RelativeRotationUniverseService()
