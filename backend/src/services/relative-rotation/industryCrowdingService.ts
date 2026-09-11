import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import { getJsonWithCurlOnly, getTextWithCurlOnly } from '../../utils/httpJson.js'
import { getSmartChinaIndexHistory, getTencentIndexHistory } from '../../utils/stockUtils.js'

export type IndustryCrowdingFrequency = 'daily' | 'weekly'

type IndustryBar = {
  date: string
  open: number | null
  high: number | null
  low: number | null
  close: number
  volume: number | null
  amount: number | null
  mainNetInflow: number | null
  mainNetInflowRatio: number | null
}

type BenchmarkBar = { date: string; close: number }

export interface IndustryCrowdingPoint {
  date: string
  behaviorScore: number | null
  flowCrowdingScore20: number | null
  /** @deprecated Use flowCrowdingScore20. Kept for one API version. */
  capitalFlowScore: number | null
  relativeReturn20: number | null
  amountExpansion: number | null
  volatilityExpansion: number | null
  flowIntensity20: number | null
  /** @deprecated Use flowIntensity20. Kept for one API version. */
  flowIntensity: number | null
  mainNetInflow20: number | null
  dailyMainNetInflow: number | null
  dailyFlowIntensity: number | null
  flowObservationCount: number
  behaviorEligibleCount: number
  flowEligibleCount: number
}

export interface IndustryCrowdingBoardReport {
  code: string
  name: string
  dataStatus: 'ready' | 'partial' | 'unavailable'
  priceStatus: string
  flowStatus: string
  lastPriceDate: string | null
  lastFlowDate: string | null
  lastError: string | null
  sourceProviders: string[]
  latest: IndustryCrowdingPoint | null
  points: IndustryCrowdingPoint[]
}

export interface IndustryCrowdingMarketPoint {
  date: string
  mainNetInflow: number | null
  dailyFlowIntensity: number | null
  fiveDayFlowIntensity: number | null
}

export interface IndustryCrowdingBoardRefreshResult {
  code: string
  priceRefreshed: boolean
  flowRefreshed: boolean
  priceReady: boolean
  flowReady: boolean
  pointCount: number
  flowPointCount: number
  warnings: string[]
}

// 东方财富的 push 节点会按网络出口分流，不能假定根域名始终可达。这里保留
// 同一公开接口的节点顺序；页面目录是最后的同源、可审计降级入口。
const EASTMONEY_LIST_ENDPOINTS = [
  'https://29.push2.eastmoney.com/api/qt/clist/get',
  'https://82.push2.eastmoney.com/api/qt/clist/get',
  'https://17.push2.eastmoney.com/api/qt/clist/get',
  'https://push2.eastmoney.com/api/qt/clist/get',
]
const EASTMONEY_KLINE_ENDPOINTS = [
  'https://82.push2his.eastmoney.com/api/qt/stock/kline/get',
  'https://99.push2his.eastmoney.com/api/qt/stock/kline/get',
  'https://17.push2his.eastmoney.com/api/qt/stock/kline/get',
  'https://push2his.eastmoney.com/api/qt/stock/kline/get',
]
const EASTMONEY_FLOW_ENDPOINTS = [
  'https://82.push2his.eastmoney.com/api/qt/stock/fflow/daykline/get',
  'https://99.push2his.eastmoney.com/api/qt/stock/fflow/daykline/get',
  'https://17.push2his.eastmoney.com/api/qt/stock/fflow/daykline/get',
  'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get',
]
// push2 keeps a current-day flow snapshot available even when the historical
// hosts are throttled by the network exit.  It is a same-provider fallback,
// clearly tagged as a snapshot rather than fabricated history.
const EASTMONEY_FLOW_LIVE_ENDPOINTS = [
  'https://29.push2.eastmoney.com/api/qt/stock/fflow/daykline/get',
  'https://82.push2.eastmoney.com/api/qt/stock/fflow/daykline/get',
  'https://17.push2.eastmoney.com/api/qt/stock/fflow/daykline/get',
  'https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get',
]
const EASTMONEY_INDUSTRY_DIRECTORY_PAGE = 'https://data.eastmoney.com/bkzj/'
const INDUSTRY_PROVIDER = 'eastmoney_industry'
const INDUSTRY_PRICE_PROVIDER = 'eastmoney_industry_kline'
const INDUSTRY_FLOW_PROVIDER = 'eastmoney_industry_main_flow'
const MARKET_FLOW_PROVIDER = 'eastmoney_sh_sz_main_flow'
const MARKET_FLOW_KEY = 'cn_sh_sz'
const BENCHMARK_SYMBOL = '000300.SH'
const BENCHMARK_DATA_VERSION = 'industry_crowding.benchmark.v1'
const LOOKBACK_TRADING_DAYS = 60
const SCORE_WINDOW_DAYS = 20
const MIN_FLOW_OBSERVATIONS = 16

const eastmoneyHeaders = {
  Referer: 'https://quote.eastmoney.com/',
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://quote.eastmoney.com',
}

const eastmoneyMarketHeaders = {
  Referer: 'https://data.eastmoney.com/zjlx/dpzjlx.html',
  'User-Agent': 'Mozilla/5.0',
  Accept: 'application/json, text/plain, */*',
  Origin: 'https://data.eastmoney.com',
}

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const finite = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/,/g, '').replace(/%$/, ''))
  return Number.isFinite(parsed) ? parsed : null
}

const utcDate = (value: string) => new Date(`${value}T00:00:00.000Z`)
const isoDate = (value: Date) => value.toISOString().slice(0, 10)

function currentShanghaiYear() {
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', timeZone: 'Asia/Shanghai' }).formatToParts(new Date())
  return Number(parts.find((part) => part.type === 'year')?.value || new Date().getUTCFullYear())
}

function normalizeYear(value: unknown) {
  const current = currentShanghaiYear()
  const parsed = Math.floor(Number(value || current))
  return Number.isFinite(parsed) ? Math.max(2010, Math.min(current, parsed)) : current
}

function historyStartForYear(year: number) {
  const start = new Date(Date.UTC(year, 0, 1))
  // 约130个自然日可覆盖约60个A股交易日，窗口只用于计算、不在图上展示。
  start.setUTCDate(start.getUTCDate() - 130)
  return start
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function standardDeviation(values: number[]) {
  const average = mean(values)
  if (average === null || values.length < 2) return null
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / values.length)
}

function flowIntensity(netInflow: number | null, amount: number | null) {
  return netInflow !== null && amount !== null && amount > 0
    ? round(netInflow / amount, 8)
    : null
}

function percentileRank(values: Array<{ key: string; value: number }>) {
  const result = new Map<string, number>()
  const sorted = [...values].sort((left, right) => left.value - right.value)
  if (sorted.length === 1) {
    result.set(sorted[0].key, 50)
    return result
  }
  for (let index = 0; index < sorted.length; index += 1) {
    const current = sorted[index]
    let first = index
    let last = index
    while (first > 0 && sorted[first - 1].value === current.value) first -= 1
    while (last < sorted.length - 1 && sorted[last + 1].value === current.value) last += 1
    result.set(current.key, round((((first + last) / 2) / (sorted.length - 1)) * 100, 2))
  }
  return result
}

function isoWeekKey(date: string) {
  const value = utcDate(date)
  const day = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() + 4 - day)
  const yearStart = new Date(Date.UTC(value.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((value.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7)
  return `${value.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

/**
 * 透明、无前视的行业拥挤度计算。输入须包含展示期前至少60个交易日；
 * 只输出目标自然年内已具备完整计算窗口的点。
 */
export function buildIndustryCrowdingScores(input: {
  year: number
  boards: Array<{ code: string; name: string; bars: IndustryBar[] }>
  benchmark: BenchmarkBar[]
}) {
  const startDate = `${input.year}-01-01`
  const benchmarkByDate = new Map(input.benchmark.map((row) => [row.date, row.close]))
  type RawPoint = Omit<IndustryCrowdingPoint,
    'behaviorScore' | 'flowCrowdingScore20' | 'capitalFlowScore' | 'behaviorEligibleCount' | 'flowEligibleCount'>
  const rawByBoard = new Map<string, RawPoint[]>()

  for (const board of input.boards) {
    const bars = [...board.bars].sort((left, right) => left.date.localeCompare(right.date))
    const rawPoints: RawPoint[] = []
    for (let index = LOOKBACK_TRADING_DAYS; index < bars.length; index += 1) {
      const current = bars[index]
      if (current.date < startDate || current.close <= 0) continue
      const baseline = bars[index - SCORE_WINDOW_DAYS]
      const benchmarkCurrent = benchmarkByDate.get(current.date)
      const benchmarkBaseline = benchmarkByDate.get(baseline.date)
      const recentBars = bars.slice(index - SCORE_WINDOW_DAYS + 1, index + 1)
      const longBars = bars.slice(index - LOOKBACK_TRADING_DAYS + 1, index + 1)
      const recentAmounts = recentBars.map((row) => row.amount).filter((value): value is number => value !== null && value > 0)
      const longAmounts = longBars.map((row) => row.amount).filter((value): value is number => value !== null && value > 0)
      const recentReturns = bars.slice(index - SCORE_WINDOW_DAYS, index + 1)
        .slice(1)
        .map((row, returnIndex) => row.close / bars[index - SCORE_WINDOW_DAYS + returnIndex].close - 1)
        .filter((value) => Number.isFinite(value))
      const longReturns = bars.slice(index - LOOKBACK_TRADING_DAYS, index + 1)
        .slice(1)
        .map((row, returnIndex) => row.close / bars[index - LOOKBACK_TRADING_DAYS + returnIndex].close - 1)
        .filter((value) => Number.isFinite(value))
      const recentFlowRows = recentBars.filter((row) => row.mainNetInflow !== null && row.amount !== null && row.amount > 0)
      const recentAmount = mean(recentAmounts)
      const longAmount = mean(longAmounts)
      const recentVolatility = standardDeviation(recentReturns)
      const longVolatility = standardDeviation(longReturns)
      const mainNetInflow20 = recentFlowRows.length >= MIN_FLOW_OBSERVATIONS
        ? recentFlowRows.reduce((sum, row) => sum + (row.mainNetInflow || 0), 0)
        : null
      const eligibleFlowAmount = recentFlowRows.reduce((sum, row) => sum + (row.amount || 0), 0)
      const flowIntensity20 = mainNetInflow20 !== null && eligibleFlowAmount > 0
        ? round(mainNetInflow20 / eligibleFlowAmount, 8)
        : null
      rawPoints.push({
        date: current.date,
        relativeReturn20: benchmarkCurrent && benchmarkBaseline && baseline.close > 0
          ? round((current.close / baseline.close - 1) - (benchmarkCurrent / benchmarkBaseline - 1), 6)
          : null,
        amountExpansion: recentAmount && longAmount && longAmount > 0 ? round(recentAmount / longAmount, 6) : null,
        volatilityExpansion: recentVolatility && longVolatility && longVolatility > 0
          ? round(recentVolatility / longVolatility, 6)
          : null,
        flowIntensity20,
        // Compatibility only. The UI reads flowIntensity20 so a raw amount can
        // never accidentally occupy this visual dimension.
        flowIntensity: flowIntensity20,
        mainNetInflow20,
        dailyMainNetInflow: current.mainNetInflow,
        dailyFlowIntensity: flowIntensity(current.mainNetInflow, current.amount),
        flowObservationCount: recentFlowRows.length,
      })
    }
    rawByBoard.set(board.code, rawPoints)
  }

  const dates = Array.from(new Set(Array.from(rawByBoard.values()).flatMap((points) => points.map((point) => point.date)))).sort()
  const scoredByBoard = new Map<string, IndustryCrowdingPoint[]>()
  for (const code of rawByBoard.keys()) scoredByBoard.set(code, [])

  for (const date of dates) {
    const rows = Array.from(rawByBoard.entries()).flatMap(([code, points]) => points.filter((point) => point.date === date).map((point) => ({ code, point })))
    // A score must be ranked in one common cross section.  Ranking each
    // component against different, changing subsets makes a 90 on two days
    // incomparable when a source has gaps.
    const behaviorRows = rows.filter((row) => row.point.relativeReturn20 !== null && row.point.amountExpansion !== null && row.point.volatilityExpansion !== null)
    const flowRows = rows.filter((row) => row.point.flowIntensity20 !== null)
    const relativeRanks = percentileRank(behaviorRows.map((row) => ({ key: row.code, value: row.point.relativeReturn20! })))
    const amountRanks = percentileRank(behaviorRows.map((row) => ({ key: row.code, value: row.point.amountExpansion! })))
    const volatilityRanks = percentileRank(behaviorRows.map((row) => ({ key: row.code, value: row.point.volatilityExpansion! })))
    const flowRanks = percentileRank(flowRows.map((row) => ({ key: row.code, value: row.point.flowIntensity20! })))
    for (const row of rows) {
      const momentum = relativeRanks.get(row.code)
      const amount = amountRanks.get(row.code)
      const volatility = volatilityRanks.get(row.code)
      scoredByBoard.get(row.code)!.push({
        ...row.point,
        behaviorScore: momentum === undefined || amount === undefined || volatility === undefined
          ? null
          : round((momentum * 0.4) + (amount * 0.4) + (volatility * 0.2), 2),
        flowCrowdingScore20: flowRanks.get(row.code) ?? null,
        capitalFlowScore: flowRanks.get(row.code) ?? null,
        behaviorEligibleCount: behaviorRows.length,
        flowEligibleCount: flowRows.length,
      })
    }
  }

  return scoredByBoard
}

const latestOf = <T extends { date: string }>(rows: T[]) => rows.length ? rows[rows.length - 1] : null

class IndustryCrowdingService {
  private async getFromEastmoneyNodes<T>(endpoints: string[], params: Record<string, unknown>, headers = eastmoneyHeaders) {
    const failures: string[] = []
    for (const endpoint of endpoints) {
      try {
        // The corporate proxy can leave axios sockets half-open for these
        // rotating hosts.  The project curl path has deterministic timeouts
        // and a retry, which makes a failed node bounded before trying the
        // next same-source node.
        return await getJsonWithCurlOnly<T>(endpoint, { params, headers, timeout: 5_000 })
      } catch (error) {
        failures.push(`${new URL(endpoint).host}:${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new Error(`all_eastmoney_nodes_failed:${failures.join(' | ').slice(0, 900)}`)
  }

  private async fetchIndustryDirectoryFromPage() {
    const html = await getTextWithCurlOnly(EASTMONEY_INDUSTRY_DIRECTORY_PAGE, {
      headers: { Referer: 'https://data.eastmoney.com/bkzj/', 'User-Agent': 'Mozilla/5.0' },
      timeout: 15_000,
    })
    // This first selector panel is explicitly labelled “行业”; later panels
    // are “概念” and “地域”.  Restricting the scrape to it prevents a source
    // taxonomy mismatch from silently mixing concepts into this research.
    const industryPanel = html.match(/<div class=["']pop-cont["']>([\s\S]*?)<\/div>\s*<div class=["']pop-cont/i)?.[1] || ''
    const rows = Array.from(industryPanel.matchAll(/href=["']\/bkzj\/(BK\d{4,})\.html["'][^>]*>([^<]+)</gi))
      .map((match) => ({ code: match[1].toUpperCase(), name: match[2].trim() }))
      .filter((row) => row.name)
    return Array.from(new Map(rows.map((row) => [row.code, row])).values())
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
  }

  private async fetchIndustryDirectory() {
    try {
      const fromPage = await this.fetchIndustryDirectoryFromPage()
      if (fromPage.length > 0) return fromPage
    } catch {
      // The structured endpoint below is the fallback only.  It is kept for
      // temporary page-delivery failures, not as a second taxonomy.
    }
    try {
      const directoryByCode = new Map<string, { code: string; name: string }>()
      // The service currently caps a single response at 100 records even if pz
      // is larger.  Paginate explicitly so "全部行业" really means the whole
      // 东财行业目录, not only the first screen of it.
      for (let page = 1; page <= 10; page += 1) {
        const response = await this.getFromEastmoneyNodes<{ data?: { total?: number; diff?: Record<string, Record<string, unknown>> | Array<Record<string, unknown>> } }>(EASTMONEY_LIST_ENDPOINTS, {
          pn: page,
          pz: 100,
          po: 1,
          np: 1,
          ut: 'bd1d9ddb04089700cf9c27f6f7426281',
          fltt: 2,
          invt: 2,
          fid: 'f3',
          fs: 'm:90+t:2+f:!50',
          fields: 'f12,f14',
        })
        const diff = response.data?.diff || {}
        const rows = Array.isArray(diff) ? diff : Object.values(diff)
        for (const row of rows) {
          const code = String(row.f12 || '').toUpperCase()
          const name = String(row.f14 || '').trim()
          if (/^BK\d{4,}$/i.test(code) && name) directoryByCode.set(code, { code, name })
        }
        const total = Number(response.data?.total || 0)
        if (rows.length === 0 || rows.length < 100 || (total > 0 && page * 100 >= total)) break
      }
      const directory = Array.from(directoryByCode.values())
        .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))
      if (directory.length > 0) return directory
    } catch (error) {
      throw new Error(`eastmoney_industry_directory_unavailable:${error instanceof Error ? error.message : String(error)}`)
    }
    throw new Error('eastmoney_industry_directory_empty')
  }

  private async fetchPriceBars(boardCode: string, startDate: Date) {
    const response = await this.getFromEastmoneyNodes<{ data?: { klines?: string[] } }>(EASTMONEY_KLINE_ENDPOINTS, {
      secid: `90.${boardCode}`,
      fields1: 'f1,f2,f3,f4,f5,f6',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61',
      klt: 101,
      fqt: 0,
      beg: isoDate(startDate).replace(/-/g, ''),
      end: '20500101',
      lmt: 500,
      ut: 'fa5fd1943c7b386f172d6893dbfba10b',
    })
    return (response.data?.klines || []).map((line) => {
      const [date, open, close, high, low, volume, amount] = line.split(',')
      return { date, open: finite(open), close: finite(close), high: finite(high), low: finite(low), volume: finite(volume), amount: finite(amount) }
    }).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && row.close !== null && row.close > 0)
  }

  private async fetchFlowBars(boardCode: string) {
    const response = await this.getFromEastmoneyNodes<{ data?: { klines?: string[] } }>(EASTMONEY_FLOW_ENDPOINTS, {
      lmt: 500,
      klt: 101,
      secid: `90.${boardCode}`,
      fields1: 'f1,f2,f3,f7',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
      ut: 'b2884a393a59ad64002292a3e90d46a5',
    })
    const values: Array<[string, { mainNetInflow: number | null; mainNetInflowRatio: number | null }]> = []
    for (const line of response.data?.klines || []) {
      const fields = line.split(',')
      const date = fields[0] || ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
      // f52 为主力净流入额；f57 为主力净流入占比（百分点）。日内强度
      // 仍以同日净额/成交额计算，避免把来源的展示单位混进评分公式。
      values.push([date, { mainNetInflow: finite(fields[1]), mainNetInflowRatio: finite(fields[6]) }])
    }
    return new Map(values)
  }

  private async refreshBoard(board: { code: string; name: string }, startDate: Date) {
    let priceRows: Awaited<ReturnType<IndustryCrowdingService['fetchPriceBars']>> = []
    let flowRows = new Map<string, { mainNetInflow: number | null; mainNetInflowRatio: number | null }>()
    const warnings: string[] = []
    const [priceResult, flowResult] = await Promise.allSettled([
      this.fetchPriceBars(board.code, startDate),
      this.fetchFlowBars(board.code),
    ])
    if (priceResult.status === 'fulfilled') priceRows = priceResult.value
    else warnings.push(`price:${priceResult.reason instanceof Error ? priceResult.reason.message : String(priceResult.reason)}`)
    if (flowResult.status === 'fulfilled') flowRows = flowResult.value
    else warnings.push(`flow:${flowResult.reason instanceof Error ? flowResult.reason.message : String(flowResult.reason)}`)
    if (priceRows.length === 0) {
      const error = warnings.join(' | ') || 'price_history_empty'
      await prisma.industryCrowdingBoard.update({
        where: { code: board.code },
        data: {
          priceStatus: 'failed',
          flowStatus: flowResult.status === 'rejected' ? 'failed' : 'unavailable',
          lastAttemptAt: new Date(),
          retryCount: { increment: 1 },
          nextRetryAt: new Date(Date.now() + 30 * 60_000),
          lastError: error.slice(0, 1800),
        },
      })
      return {
        code: board.code,
        priceRefreshed: false,
        flowRefreshed: flowResult.status === 'fulfilled' && flowRows.size > 0,
        priceReady: false,
        flowReady: false,
        pointCount: 0,
        flowPointCount: 0,
        warnings,
      }
    }

    const oldRows = await prisma.industryCrowdingDaily.findMany({
      where: { boardCode: board.code, tradeDate: { gte: startDate } },
      select: { tradeDate: true, mainNetInflow: true, mainNetInflowRatio: true, flowProvider: true },
    })
    const oldFlow = new Map(oldRows.map((row) => [isoDate(row.tradeDate), row]))
    const rows = priceRows.map((price) => {
      const flow = flowRows.get(price.date)
      const cachedFlow = oldFlow.get(price.date)
      const mainNetInflow = flow?.mainNetInflow ?? cachedFlow?.mainNetInflow ?? null
      const mainNetInflowRatio = flow?.mainNetInflowRatio ?? cachedFlow?.mainNetInflowRatio ?? null
      const qualityFlags = [
        ...(price.amount && price.amount > 0 ? [] : ['amount_unavailable']),
        ...(mainNetInflow === null ? ['main_flow_unavailable'] : []),
      ]
      return {
        boardCode: board.code,
        tradeDate: utcDate(price.date),
        openPrice: price.open,
        highPrice: price.high,
        lowPrice: price.low,
        closePrice: price.close!,
        volume: price.volume,
        amount: price.amount,
        mainNetInflow,
        mainNetInflowRatio,
        priceProvider: INDUSTRY_PRICE_PROVIDER,
        flowProvider: flow ? INDUSTRY_FLOW_PROVIDER : cachedFlow?.flowProvider || null,
        sourceTimestamp: utcDate(price.date),
        qualityFlagsJson: JSON.stringify(qualityFlags),
        rawPayloadJson: JSON.stringify({ price, flow: flow || null }),
        fetchedAt: new Date(),
      }
    })
    const flowPointCount = rows.filter((row) => row.mainNetInflow !== null && row.amount !== null && row.amount > 0).length
    const latestPrice = rows.at(-1)?.tradeDate || null
    const latestFlow = [...rows].reverse().find((row) => row.mainNetInflow !== null)?.tradeDate || null
    const latestTwentyRows = rows.slice(-SCORE_WINDOW_DAYS)
    const flowReady = latestTwentyRows.filter((row) => row.mainNetInflow !== null && row.amount !== null && row.amount > 0).length >= MIN_FLOW_OBSERVATIONS
    const priceReady = rows.length >= LOOKBACK_TRADING_DAYS
    const error = warnings.join(' | ')
    await prisma.$transaction([
      prisma.industryCrowdingDaily.deleteMany({ where: { boardCode: board.code, tradeDate: { gte: startDate } } }),
      prisma.industryCrowdingDaily.createMany({ data: rows }),
      prisma.industryCrowdingBoard.update({
        where: { code: board.code },
        data: {
          sourceUpdatedAt: new Date(),
          priceStatus: priceReady ? 'ready' : 'partial',
          flowStatus: flowReady ? 'ready' : flowPointCount > 0 ? 'partial' : flowResult.status === 'rejected' ? 'failed' : 'unavailable',
          lastPriceDate: latestPrice,
          lastFlowDate: latestFlow,
          lastAttemptAt: new Date(),
          retryCount: priceReady && flowReady ? 0 : { increment: 1 },
          nextRetryAt: priceReady && flowReady ? null : new Date(Date.now() + 30 * 60_000),
          lastError: error ? error.slice(0, 1800) : null,
        },
      }),
    ])
    return {
      code: board.code,
      priceRefreshed: true,
      flowRefreshed: flowResult.status === 'fulfilled' && flowRows.size > 0,
      priceReady,
      flowReady,
      pointCount: rows.length,
      flowPointCount,
      warnings,
    }
  }

  private parseMarketFlowBars(klines: string[], latestSnapshot = false) {
    return klines.flatMap((line) => {
      const fields = line.split(',')
      const date = fields[0] || ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
      const sourceRatio = finite(fields[6])
      return [{
        date,
        mainNetInflow: finite(fields[1]),
        // Eastmoney f57 is expressed in percentage points, not a decimal.
        mainNetInflowRatio: sourceRatio === null ? null : round(sourceRatio / 100, 8),
        raw: line,
        latestSnapshot,
      }]
    })
  }

  private async fetchMarketFlowBars() {
    const params = {
      lmt: 500,
      klt: 101,
      secid: '1.000001',
      secid2: '0.399001',
      fields1: 'f1,f2,f3,f7',
      fields2: 'f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63,f64,f65',
      ut: 'b2884a393a59ad64002292a3e90d46a5',
    }
    try {
      const response = await this.getFromEastmoneyNodes<{ data?: { klines?: string[] } }>(EASTMONEY_FLOW_ENDPOINTS, params, eastmoneyMarketHeaders)
      const history = this.parseMarketFlowBars(response.data?.klines || [])
      if (history.length > 0) return history
    } catch {
      // Fall through to the same-provider current-day endpoint below.
    }
    const response = await this.getFromEastmoneyNodes<{ data?: { klines?: string[] } }>(EASTMONEY_FLOW_LIVE_ENDPOINTS, { ...params, lmt: 1 }, eastmoneyMarketHeaders)
    return this.parseMarketFlowBars(response.data?.klines || [], true)
  }

  private async refreshMarketFlowCache() {
    try {
      const rows = await this.fetchMarketFlowBars()
      if (rows.length === 0) return { refreshed: false, pointCount: 0, warning: 'market_flow_empty' }
      const dates = rows.map((row) => utcDate(row.date))
      await prisma.$transaction([
        prisma.industryCrowdingMarketDaily.deleteMany({ where: { marketKey: MARKET_FLOW_KEY, tradeDate: { in: dates } } }),
        prisma.industryCrowdingMarketDaily.createMany({
          data: rows.map((row) => ({
            marketKey: MARKET_FLOW_KEY,
            tradeDate: utcDate(row.date),
            mainNetInflow: row.mainNetInflow,
            mainNetInflowRatio: row.mainNetInflowRatio,
            provider: MARKET_FLOW_PROVIDER,
            sourceTimestamp: utcDate(row.date),
            qualityFlagsJson: JSON.stringify([
              ...(row.mainNetInflow === null ? ['main_flow_unavailable'] : []),
              ...(row.mainNetInflowRatio === null ? ['main_flow_ratio_unavailable'] : []),
              ...(row.latestSnapshot ? ['latest_snapshot_fallback'] : []),
            ]),
            rawPayloadJson: JSON.stringify({ kline: row.raw }),
            fetchedAt: new Date(),
          })),
        }),
      ])
      return { refreshed: true, pointCount: rows.length, warning: null }
    } catch (error) {
      return { refreshed: false, pointCount: 0, warning: `market_flow:${error instanceof Error ? error.message : String(error)}` }
    }
  }

  private async marketFlowPoints(startDate: Date) {
    const rows = await prisma.industryCrowdingMarketDaily.findMany({
      where: { marketKey: MARKET_FLOW_KEY, tradeDate: { gte: startDate } },
      select: { tradeDate: true, mainNetInflow: true, mainNetInflowRatio: true },
      orderBy: { tradeDate: 'asc' },
    })
    return rows.map((row, index) => {
      const ratios = rows.slice(Math.max(0, index - 4), index + 1)
        .map((item) => item.mainNetInflowRatio)
        .filter((value): value is number => value !== null)
      return {
        date: isoDate(row.tradeDate),
        mainNetInflow: row.mainNetInflow,
        dailyFlowIntensity: row.mainNetInflowRatio,
        fiveDayFlowIntensity: ratios.length ? round(ratios.reduce((sum, value) => sum + value, 0) / ratios.length, 8) : null,
      }
    })
  }

  async refreshMarketFlow(userId: string) {
    await ensureUser(prisma, userId)
    return this.refreshMarketFlowCache()
  }

  private async refreshBenchmark(startDate: Date) {
    try {
      const [smartResult, tencentResult] = await Promise.allSettled([
        getSmartChinaIndexHistory(BENCHMARK_SYMBOL, 500),
        getTencentIndexHistory(BENCHMARK_SYMBOL, 500),
      ])
      const candidates = [
        ...(smartResult.status === 'fulfilled' && smartResult.value.history.length
          ? [{ history: smartResult.value.history, provider: smartResult.value.selectedProvider || 'smart_cn_index' }]
          : []),
        ...(tencentResult.status === 'fulfilled' && tencentResult.value.length
          ? [{ history: tencentResult.value, provider: 'tencent_price_index' }]
          : []),
      ].sort((left, right) => {
        const leftDate = left.history.at(-1)?.date || ''
        const rightDate = right.history.at(-1)?.date || ''
        return rightDate.localeCompare(leftDate) || right.history.length - left.history.length
      })
      const selected = candidates[0]
      if (!selected) return 0
      const rows = selected.history.filter((row) => row.date >= isoDate(startDate) && row.close > 0)
      if (rows.length === 0) return 0
      const dates = rows.map((row) => utcDate(row.date))
      await prisma.$transaction([
        prisma.marketBarCanonical.deleteMany({
          where: { symbol: BENCHMARK_SYMBOL, market: 'CN', adjustType: 'none', dataVersion: BENCHMARK_DATA_VERSION, tradeDate: { in: dates } },
        }),
        prisma.marketBarCanonical.createMany({
          data: rows.map((row) => ({
            symbol: BENCHMARK_SYMBOL,
            market: 'CN',
            timeframe: '1d',
            tradeDate: utcDate(row.date),
            adjustType: 'none',
            openPrice: row.open,
            highPrice: row.high,
            lowPrice: row.low,
            closePrice: row.close,
            volume: row.volume || null,
            amount: row.amount || null,
            primaryProvider: selected.provider,
            sourceRefsJson: JSON.stringify([`${selected.provider}:${BENCHMARK_SYMBOL}:${row.date}`]),
            consensusScore: 1,
            confidence: 1,
            validationStatus: 'valid',
            dataVersion: BENCHMARK_DATA_VERSION,
            qualityFlagsJson: '[]',
          })),
        }),
      ])
      return rows.length
    } catch {
      return 0
    }
  }

  private async benchmarkBars(startDate: Date) {
    const rows = await prisma.marketBarCanonical.findMany({
      where: { symbol: BENCHMARK_SYMBOL, market: 'CN', adjustType: 'none', dataVersion: BENCHMARK_DATA_VERSION, tradeDate: { gte: startDate } },
      select: { tradeDate: true, closePrice: true },
      orderBy: { tradeDate: 'asc' },
    })
    if (rows.length >= LOOKBACK_TRADING_DAYS) return rows.map((row) => ({ date: isoDate(row.tradeDate), close: row.closePrice }))

    // 复用项目中已验证的沪深300日线缓存作为只读回退；它仍然是同一指数，
    // 但不会把其他数据版本混入本研究自己的写入空间。
    const cached = await prisma.marketBarCanonical.findMany({
      where: {
        symbol: BENCHMARK_SYMBOL,
        market: 'CN',
        adjustType: 'none',
        timeframe: '1d',
        tradeDate: { gte: startDate },
        closePrice: { gt: 0 },
      },
      select: { tradeDate: true, closePrice: true, updatedAt: true },
      orderBy: [{ tradeDate: 'asc' }, { updatedAt: 'desc' }],
    })
    const byDate = new Map<string, number>()
    for (const row of cached) {
      const date = isoDate(row.tradeDate)
      if (!byDate.has(date)) byDate.set(date, row.closePrice)
    }
    return Array.from(byDate.entries()).map(([date, close]) => ({ date, close }))
  }

  private async benchmarkProvider(startDate: Date) {
    const row = await prisma.marketBarCanonical.findFirst({
      where: { symbol: BENCHMARK_SYMBOL, market: 'CN', adjustType: 'none', dataVersion: BENCHMARK_DATA_VERSION, tradeDate: { gte: startDate } },
      select: { primaryProvider: true },
      orderBy: { tradeDate: 'desc' },
    })
    return row?.primaryProvider || 'cached_price_index'
  }

  private collapseFrequency(points: IndustryCrowdingPoint[], frequency: IndustryCrowdingFrequency) {
    if (frequency === 'daily') return points
    const byWeek = new Map<string, IndustryCrowdingPoint>()
    for (const point of points) byWeek.set(isoWeekKey(point.date), point)
    return Array.from(byWeek.values())
  }

  async refresh(userId: string, input: {
    year?: number
    boardCodes?: string[]
    concurrency?: number
    batchSize?: number
    force?: boolean
    respectRetryAfter?: boolean
    onBoardResult?: (result: IndustryCrowdingBoardRefreshResult, completed: number, total: number) => Promise<void> | void
  } = {}) {
    await ensureUser(prisma, userId)
    const year = normalizeYear(input.year)
    const startDate = historyStartForYear(year)
    const warnings: string[] = []
    let directory: Array<{ code: string; name: string }> = []
    let directoryLoaded = false
    try {
      directory = await this.fetchIndustryDirectory()
      directoryLoaded = directory.length > 0
    } catch (error) {
      warnings.push(`industry_directory_unavailable:${error instanceof Error ? error.message : String(error)}`)
    }
    if (directoryLoaded) {
      await prisma.$transaction(async (tx) => {
        await tx.industryCrowdingBoard.updateMany({ data: { isActive: false } })
        for (const board of directory) {
          await tx.industryCrowdingBoard.upsert({
            where: { code: board.code },
            create: { code: board.code, name: board.name, boardType: 'industry', provider: INDUSTRY_PROVIDER, isActive: true },
            update: { name: board.name, boardType: 'industry', provider: INDUSTRY_PROVIDER, isActive: true },
          })
        }
      })
    } else {
      directory = await prisma.industryCrowdingBoard.findMany({ where: { isActive: true }, select: { code: true, name: true }, orderBy: { name: 'asc' } })
      if (directory.length === 0) {
        return {
          schemaVersion: 'fams.relative_rotation.industry_crowding_refresh.v2',
          year,
          universeBoards: 0,
          requestedBoards: 0,
          skippedFreshBoards: 0,
          refreshedBoards: 0,
          flowReadyBoards: 0,
          readyBoards: 0,
          failedBoards: [],
          incompleteBoards: [],
          marketFlow: { refreshed: false, pointCount: 0, warning: 'industry_directory_and_cache_unavailable' },
          warnings: [...warnings, 'industry_directory_and_cache_unavailable'],
        }
      }
      warnings.push('industry_directory_cache_reused')
    }
    const requestedCodes = new Set((input.boardCodes || []).map((code) => String(code).toUpperCase()).filter(Boolean))
    const scopedDirectory = requestedCodes.size
      ? directory.filter((board) => requestedCodes.has(board.code))
      : directory
    const cachedBoards = await prisma.industryCrowdingBoard.findMany({
      where: { code: { in: scopedDirectory.map((board) => board.code) } },
      select: {
        code: true,
        sourceUpdatedAt: true,
        priceStatus: true,
        flowStatus: true,
        nextRetryAt: true,
        daily: {
          where: { tradeDate: { gte: startDate } },
          select: { tradeDate: true, amount: true, mainNetInflow: true },
          orderBy: { tradeDate: 'asc' },
        },
      },
    })
    const cachedByCode = new Map(cachedBoards.map((board) => [board.code, board]))
    const freshnessFloor = Date.now() - (4 * 60 * 60 * 1000)
    const now = new Date()
    const refreshTargets = scopedDirectory.filter((board) => {
      const cached = cachedByCode.get(board.code)
      if (!cached) return true
      const recent = cached.daily.slice(-SCORE_WINDOW_DAYS)
      const hasPriceWindow = cached.daily.length >= LOOKBACK_TRADING_DAYS
      const hasFlowWindow = recent.filter((row) => row.mainNetInflow !== null && row.amount !== null && row.amount > 0).length >= MIN_FLOW_OBSERVATIONS
      const stale = !cached.sourceUpdatedAt || cached.sourceUpdatedAt.getTime() < freshnessFloor
      const retryDeferred = input.respectRetryAfter === true && cached.nextRetryAt !== null && cached.nextRetryAt > now
      return !retryDeferred && (input.force === true || !hasPriceWindow || !hasFlowWindow || stale)
    })
    const skippedFreshBoards = scopedDirectory.length - refreshTargets.length
    if (skippedFreshBoards > 0) warnings.push(`fresh_industry_cache_reused:${skippedFreshBoards}`)
    const results: IndustryCrowdingBoardRefreshResult[] = []
    const concurrency = Math.max(1, Math.min(2, Math.floor(input.concurrency || 2)))
    const batchSize = Math.max(concurrency, Math.min(12, Math.floor(input.batchSize || 6)))
    let completed = 0
    for (let batchStart = 0; batchStart < refreshTargets.length; batchStart += batchSize) {
      const batch = refreshTargets.slice(batchStart, batchStart + batchSize)
      let cursor = 0
      const workers = Array.from({ length: Math.min(concurrency, batch.length) }, async () => {
        while (cursor < batch.length) {
          const board = batch[cursor++]
          const result = await this.refreshBoard(board, startDate)
          results.push(result)
          completed += 1
          await input.onBoardResult?.(result, completed, refreshTargets.length)
        }
      })
      await Promise.all(workers)
    }
    await this.refreshBenchmark(startDate)
    const marketFlow = await this.refreshMarketFlowCache()
    const failed = results.filter((result) => !result.priceRefreshed)
    const incomplete = results.filter((result) => !result.priceReady || !result.flowReady)
    return {
      schemaVersion: 'fams.relative_rotation.industry_crowding_refresh.v2',
      year,
      universeBoards: directory.length,
      requestedBoards: refreshTargets.length,
      skippedFreshBoards,
      refreshedBoards: results.filter((result) => result.priceRefreshed).length,
      flowReadyBoards: results.filter((result) => result.flowReady).length,
      readyBoards: results.filter((result) => result.priceReady && result.flowReady).length,
      failedBoards: failed.map((result) => result.code),
      incompleteBoards: incomplete.map((result) => result.code),
      marketFlow,
      warnings: [...warnings, ...(marketFlow.warning ? [marketFlow.warning] : []), ...results.flatMap((result) => result.warnings.map((warning) => `${result.code}:${warning}`))].slice(0, 80),
    }
  }

  async getReport(userId: string, input: { year?: number; frequency?: string; boardCodes?: string[] } = {}) {
    await ensureUser(prisma, userId)
    const year = normalizeYear(input.year)
    const frequency: IndustryCrowdingFrequency = input.frequency === 'daily' ? 'daily' : 'weekly'
    const startDate = historyStartForYear(year)
    const requestedCodes = new Set((input.boardCodes || []).map((code) => String(code).toUpperCase()).filter(Boolean))
    const boards = await prisma.industryCrowdingBoard.findMany({
      where: { isActive: true, ...(requestedCodes.size ? { code: { in: Array.from(requestedCodes) } } : {}) },
      include: {
        daily: {
          where: { tradeDate: { gte: startDate } },
          orderBy: { tradeDate: 'asc' },
        },
      },
      orderBy: { name: 'asc' },
    })
    const benchmark = await this.benchmarkBars(startDate)
    const latestBoardDate = boards.flatMap((board) => board.daily.map((row) => isoDate(row.tradeDate))).sort().at(-1) || null
    const scored = buildIndustryCrowdingScores({
      year,
      boards: boards.map((board) => ({
        code: board.code,
        name: board.name,
        bars: board.daily.map((row) => ({
          date: isoDate(row.tradeDate),
          open: row.openPrice,
          high: row.highPrice,
          low: row.lowPrice,
          close: row.closePrice,
          volume: row.volume,
          amount: row.amount,
          mainNetInflow: row.mainNetInflow,
          mainNetInflowRatio: row.mainNetInflowRatio,
        })),
      })),
      benchmark,
    })
    const reports: IndustryCrowdingBoardReport[] = boards.map((board) => {
      const points = this.collapseFrequency(scored.get(board.code) || [], frequency)
      const anyBehavior = points.some((point) => point.behaviorScore !== null)
      const anyFlow = points.some((point) => point.capitalFlowScore !== null)
      return {
        code: board.code,
        name: board.name,
        dataStatus: anyBehavior && anyFlow ? 'ready' : anyBehavior || anyFlow ? 'partial' : 'unavailable',
        priceStatus: board.priceStatus,
        flowStatus: board.flowStatus,
        lastPriceDate: board.lastPriceDate ? isoDate(board.lastPriceDate) : null,
        lastFlowDate: board.lastFlowDate ? isoDate(board.lastFlowDate) : null,
        lastError: board.lastError,
        sourceProviders: [INDUSTRY_PRICE_PROVIDER, ...(anyFlow ? [INDUSTRY_FLOW_PROVIDER] : [])],
        latest: latestOf(points),
        points,
      }
    })
    const dates = Array.from(new Set(reports.flatMap((board) => board.points.map((point) => point.date)))).sort()
    const behaviorAsOfDate = reports.flatMap((board) => board.points)
      .filter((point) => point.behaviorScore !== null).map((point) => point.date).sort().at(-1) || null
    const flowAsOfDate = reports.flatMap((board) => board.points)
      .filter((point) => point.flowCrowdingScore20 !== null).map((point) => point.date).sort().at(-1) || null
    // Summary cards must compare the same market date. Falling back to each
    // industry's last non-null point can rank stale data as today's leader.
    const latestBehavior = behaviorAsOfDate
      ? reports.map((board) => ({ board, point: board.points.find((point) => point.date === behaviorAsOfDate && point.behaviorScore !== null) || null }))
        .filter((row): row is { board: IndustryCrowdingBoardReport; point: IndustryCrowdingPoint } => row.point !== null)
      : []
    const latestFlow = flowAsOfDate
      ? reports.map((board) => ({ board, point: board.points.find((point) => point.date === flowAsOfDate && point.flowCrowdingScore20 !== null) || null }))
        .filter((row): row is { board: IndustryCrowdingBoardReport; point: IndustryCrowdingPoint } => row.point !== null)
      : []
    const comparableAsOfDate = [...dates].reverse().find((date) => reports.some((board) => {
      const point = board.points.find((item) => item.date === date)
      return point?.behaviorScore !== null && point?.flowCrowdingScore20 !== null
    })) || null
    const latestComparable = comparableAsOfDate
      ? reports.map((board) => ({
        board,
        point: board.points.find((point) => point.date === comparableAsOfDate && point.behaviorScore !== null && point.flowCrowdingScore20 !== null) || null,
      })).filter((row): row is { board: IndustryCrowdingBoardReport; point: IndustryCrowdingPoint } => row.point !== null)
      : []
    const highestBehavior = [...latestBehavior].sort((left, right) => right.point.behaviorScore! - left.point.behaviorScore!)[0] || null
    const highestFlow = [...latestFlow].sort((left, right) => right.point.flowCrowdingScore20! - left.point.flowCrowdingScore20!)[0] || null
    const largestDivergence = [...latestComparable]
      .sort((left, right) => Math.abs(right.point.behaviorScore! - right.point.flowCrowdingScore20!) - Math.abs(left.point.behaviorScore! - left.point.flowCrowdingScore20!))[0] || null
    const coverageByDate = dates.map((date) => {
      const points = reports.flatMap((board) => board.points.filter((point) => point.date === date))
      return {
        date,
        behaviorEligibleCount: points.find((point) => point.behaviorScore !== null)?.behaviorEligibleCount || 0,
        flowEligibleCount: points.find((point) => point.flowCrowdingScore20 !== null)?.flowEligibleCount || 0,
      }
    })
    const marketFlow = await this.marketFlowPoints(startDate)
    return {
      schemaVersion: 'fams.relative_rotation.industry_crowding.v2',
      generatedAt: new Date().toISOString(),
      year,
      frequency,
      // 两条图表各自注明自己的可用截止日；若指数收盘尚未落库，不以盘中
      // 行业数据伪造交易行为分数。
      asOfDate: behaviorAsOfDate || flowAsOfDate,
      asOfDates: { behavior: behaviorAsOfDate, capitalFlow: flowAsOfDate, marketFlow: marketFlow.at(-1)?.date || null },
      boardCount: reports.length,
      readyCount: reports.filter((board) => board.dataStatus === 'ready').length,
      partialCount: reports.filter((board) => board.dataStatus === 'partial').length,
      unavailableCount: reports.filter((board) => board.dataStatus === 'unavailable').length,
      dates,
      coverageByDate,
      boards: reports,
      marketFlow: {
        marketKey: MARKET_FLOW_KEY,
        name: '沪深两市',
        provider: MARKET_FLOW_PROVIDER,
        points: marketFlow,
      },
      benchmark: { symbol: BENCHMARK_SYMBOL, name: '沪深300', sampleDays: benchmark.length, provider: await this.benchmarkProvider(startDate) },
      methodology: {
        behaviorScore: '20日相对沪深300收益40% + 20/60日成交额放大40% + 20/60日波动放大20%；每日行业横截面分位0–100。',
        capitalFlowScore: '近20日主力净流入 / 近20日成交额；每日行业横截面分位0–100。原始净流入金额不参与颜色映射。',
        provider: '东方财富行业板块公开行情与主力资金流；市场背景使用东方财富沪深两市联合口径，不由行业板块相加；不等同于申万行业、基金申赎或机构真实持仓。',
      },
      summaries: {
        highestBehavior: highestBehavior ? { code: highestBehavior.board.code, name: highestBehavior.board.name, score: highestBehavior.point!.behaviorScore } : null,
        highestFlow: highestFlow ? { code: highestFlow.board.code, name: highestFlow.board.name, score: highestFlow.point!.flowCrowdingScore20 } : null,
        largestDivergence: largestDivergence ? {
          code: largestDivergence.board.code,
          name: largestDivergence.board.name,
          score: round(Math.abs(largestDivergence.point!.behaviorScore! - largestDivergence.point!.flowCrowdingScore20!), 2),
        } : null,
      },
      warnings: [
        ...(boards.length === 0 ? ['尚无行业拥挤度缓存；请先刷新行业数据。'] : []),
        ...(benchmark.length < LOOKBACK_TRADING_DAYS ? ['沪深300基准历史不足，交易行为拥挤度暂不可完整计算。'] : []),
        ...(latestBoardDate && (benchmark.at(-1)?.date || '') < latestBoardDate ? ['沪深300基准尚未更新至行业最新日期；本次读取不会隐式刷新数据，请使用“刷新行业数据”。'] : []),
        ...(marketFlow.length === 0 ? ['沪深两市资金流缓存为空；刷新行业数据后将补齐第三张市场背景图。'] : []),
        ...(reports.some((board) => board.dataStatus === 'unavailable')
          ? [`${reports.filter((board) => board.dataStatus === 'unavailable').length} 个东方财富行业板块尚未获得足够历史数据，未绘入热力图；刷新会仅补齐缺失板块。`]
          : []),
      ],
      notTradingAdvice: true,
    }
  }
}

export const industryCrowdingService = new IndustryCrowdingService()
