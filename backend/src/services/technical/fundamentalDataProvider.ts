import { getJson } from '../../utils/httpJson.js'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type FundamentalQuality = 'ok' | 'provider_failed' | 'unsupported_market' | 'missing_data'

export interface FundamentalSnapshot {
  provider: 'eastmoney'
  providerLabel: string
  providerSymbol: string | null
  sourceUrl: string
  financialSourceUrl: string
  industrySourceUrl: string
  performanceSourceUrl: string
  independentSourceUrl: string
  announcementSourceUrl: string
  asOf: string
  quality: FundamentalQuality
  metrics: {
    peDynamic?: number
    pb?: number
    totalMarketCap?: number
    floatMarketCap?: number
    latestPrice?: number
  }
  financialReports: FundamentalFinancialReport[]
  financialCrossCheck?: FundamentalFinancialCrossCheck
  independentFinancialCrossCheck?: FundamentalFinancialCrossCheck
  officialAnnouncement?: FundamentalAnnouncementReference
  industryBoard?: FundamentalIndustryBoard
  industryComparison?: FundamentalIndustryComparison
  warnings: string[]
}

export interface FundamentalIndustryBoard {
  provider: 'eastmoney'
  providerLabel: string
  sourceUrl: string
  asOf: string
  quality: 'ok' | 'missing_data'
  name?: string
  code?: string
  warnings: string[]
}

export interface FundamentalAnnouncementReference {
  provider: 'sohu'
  providerLabel: string
  sourceUrl: string
  asOf: string
  quality: 'located' | 'missing_data' | 'provider_failed'
  title?: string
  disclosureDate?: string
  reportDate?: string
  reportName?: string
  pdfUrl?: string
  warnings: string[]
}

export interface FundamentalFinancialCrossCheck {
  provider: 'eastmoney' | 'sohu'
  providerLabel: string
  sourceUrl: string
  reportName: 'RPT_LICO_FN_CPD' | 'SOHU_CWZB'
  asOf: string
  quality: 'ok' | 'warn' | 'failed' | 'missing_data'
  matchedReportDate?: string
  checks: Array<{
    id: string
    label: string
    primaryValue?: number
    crossValue?: number
    deltaPercent?: number
    status: 'pass' | 'warn' | 'fail' | 'missing'
  }>
  warnings: string[]
}

export interface FundamentalIndustryComparison {
  provider: 'eastmoney'
  boardCode: string
  boardName: string
  sourceUrl: string
  asOf: string
  sampleSize: number
  metrics: {
    peDynamicPercentile?: number
    pbPercentile?: number
    totalMarketCapPercentile?: number
    roePercentile?: number
    debtAssetRatioPercentile?: number
  }
  peers: Array<{
    code: string
    name: string
    peDynamic?: number
    pb?: number
    totalMarketCap?: number
    roeWeighted?: number
    debtAssetRatio?: number
  }>
  warnings: string[]
}

type FundamentalIndustryPeer = FundamentalIndustryComparison['peers'][number]

export type EastmoneyQuoteListSnapshot = {
  code: string
  name: string
  totalMarketCap?: number
  floatMarketCap?: number
  peDynamic?: number
  pb?: number
  industryName?: string
  source?: string
  fetchedAt?: string
}

type QuoteListCacheFile = {
  schemaVersion: 'fams.a_share_quote_list_cache.v1'
  provider: 'eastmoney'
  fetchedAt: string
  itemCount: number
  items: EastmoneyQuoteListSnapshot[]
}

const quoteListCachePath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/a-share-quote-list-cache.json')
const canonicalQuoteListCachePath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/a-share-quote-list-canonical.json')

export interface FundamentalFinancialReport {
  reportDate: string
  reportName: string
  noticeDate?: string
  currency?: string
  operatingRevenue?: number
  operatingRevenueYoY?: number
  parentNetProfit?: number
  parentNetProfitYoY?: number
  roeWeighted?: number
  grossMargin?: number
  netMargin?: number
  debtAssetRatio?: number
  operatingCashFlow?: number
  operatingCashFlowToRevenue?: number
  basicEps?: number
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined
}

function getEastmoneySecid(code: string, market: string) {
  const normalized = code.trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
  if (market !== 'A股' && market !== 'CN') return null
  if (/^(60|68|90)\d{4}$/.test(normalized)) return `1.${normalized}`
  if (/^(00|30|20)\d{4}$/.test(normalized)) return `0.${normalized}`
  if (/^(8|4|9)\d{5}$/.test(normalized)) return `0.${normalized}`
  return null
}

function getEastmoneySecucode(code: string, market: string) {
  const normalized = code.trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
  if (market !== 'A股' && market !== 'CN') return null
  if (/^(60|68|90)\d{4}$/.test(normalized)) return `${normalized}.SH`
  if (/^(00|30|20)\d{4}$/.test(normalized)) return `${normalized}.SZ`
  if (/^(8|4|9)\d{5}$/.test(normalized)) return `${normalized}.BJ`
  return null
}

function normalizeAshareCode(code: string) {
  return code.trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
}

function boardCodeFromIndustryName(industryName?: string) {
  const map: Record<string, string> = {
    乘用车: 'BK1262',
    综合乘用车: 'BK1520',
    汽车整车: 'BK1029',
  }
  return industryName ? map[industryName] : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function percentileRank(values: number[], target: number | undefined, higherIsBetter = true) {
  if (target === undefined || values.length === 0) return undefined
  const usable = values.filter((value) => Number.isFinite(value))
  if (usable.length === 0) return undefined
  const betterOrEqualCount = higherIsBetter
    ? usable.filter((value) => value <= target).length
    : usable.filter((value) => value >= target).length
  return Math.round((betterOrEqualCount / usable.length) * 10000) / 100
}

function deltaPercent(primaryValue: number | undefined, crossValue: number | undefined) {
  if (primaryValue === undefined || crossValue === undefined) return undefined
  const denominator = Math.max(Math.abs(primaryValue), 0.000001)
  return Math.round((Math.abs(primaryValue - crossValue) / denominator) * 10000) / 100
}

function statusFromChecks(checks: FundamentalFinancialCrossCheck['checks']) {
  const failedCount = checks.filter((check) => check.status === 'fail').length
  const warnCount = checks.filter((check) => check.status === 'warn' || check.status === 'missing').length
  if (failedCount > 0) return 'failed'
  if (warnCount > 0) return 'warn'
  return 'ok'
}

class FundamentalDataProvider {
  private quoteListSnapshotPromise?: Promise<Map<string, EastmoneyQuoteListSnapshot>>

  async getEastmoneyValuationSnapshot(code: string, market = 'A股') {
    const providerSymbol = getEastmoneySecid(code, market)
    if (!providerSymbol) return null
    const response = await getJson<{ data?: Record<string, unknown> }>('https://push2.eastmoney.com/api/qt/stock/get', {
      params: {
        secid: providerSymbol,
        fields: 'f12,f14,f20,f21,f43,f116,f117,f162,f167',
        ut: 'fa5fd1943c7b386f172d6893dbfba10b',
        fltt: 2,
        invt: 2,
      },
      headers: {
        Referer: 'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 5000,
    })
    const data = response.data
    if (!data) return null
    return {
      peDynamic: finite(data.f162),
      pb: finite(data.f167),
      latestPrice: finite(data.f43),
      totalMarketCap: finite(data.f20) || finite(data.f116),
      floatMarketCap: finite(data.f21) || finite(data.f117),
    }
  }

  async getEastmoneyFundamentalSnapshot(code: string, market = 'A股'): Promise<FundamentalSnapshot> {
    const providerSymbol = getEastmoneySecid(code, market)
    const secucode = getEastmoneySecucode(code, market)
    const sourceUrl = 'https://push2.eastmoney.com/api/qt/stock/get'
    const financialSourceUrl = 'https://datacenter.eastmoney.com/securities/api/data/v1/get'
    const industrySourceUrl = 'https://push2.eastmoney.com/api/qt/clist/get'
    const performanceSourceUrl = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
    const independentSourceUrl = 'https://q.stock.sohu.com/cn/{code}/cwzb.shtml'
    const announcementSourceUrl = 'https://q.stock.sohu.com/cn/{code}/bw.shtml'
    const base = {
      provider: 'eastmoney' as const,
      providerLabel: 'Eastmoney Quote/Fundamental',
      providerSymbol,
      sourceUrl,
      financialSourceUrl,
      industrySourceUrl,
      performanceSourceUrl,
      independentSourceUrl,
      announcementSourceUrl,
      asOf: new Date().toISOString(),
    }

    if (!providerSymbol || !secucode) {
      return {
        ...base,
        quality: 'unsupported_market',
        metrics: {},
        financialReports: [],
        financialCrossCheck: undefined,
        independentFinancialCrossCheck: undefined,
        officialAnnouncement: undefined,
        industryBoard: undefined,
        industryComparison: undefined,
        warnings: [`${market} ${code} 暂不支持东方财富基本面指标。`],
      }
    }

    let metrics: FundamentalSnapshot['metrics'] = {}
    let industryName: string | undefined
    let industryCode: string | undefined
    const warnings: string[] = []

    try {
      const response = await getJson<{ data?: Record<string, unknown> }>(sourceUrl, {
        params: {
          secid: providerSymbol,
          fields: 'f12,f14,f20,f21,f43,f57,f58,f100,f102,f116,f117,f127,f129,f162,f167',
          ut: 'fa5fd1943c7b386f172d6893dbfba10b',
          fltt: 2,
          invt: 2,
        },
        headers: {
          Referer: 'https://quote.eastmoney.com/',
          'User-Agent': 'Mozilla/5.0',
        },
        timeout: 8000,
      })

      const data = response.data
      if (!data) {
        return {
          ...base,
          quality: 'missing_data',
          metrics: {},
          financialReports: [],
          warnings: [`东方财富未返回 ${providerSymbol} 基本面指标。`],
        }
      }

      metrics = {
        latestPrice: finite(data.f43),
        totalMarketCap: finite(data.f20) || finite(data.f116),
        floatMarketCap: finite(data.f21) || finite(data.f117),
        peDynamic: finite(data.f162),
        pb: finite(data.f167),
      }
      industryName = text(data.f100) || text(data.f127)
      industryCode = text(data.f102) || text(data.f129)
    } catch (error) {
      warnings.push(`东方财富估值指标获取失败：${error instanceof Error ? error.message : String(error)}`)
    }

    try {
      const fallback = await this.getEastmoneyQuoteListSnapshot(normalizeAshareCode(code))
      if (fallback) {
        metrics = {
          ...metrics,
          totalMarketCap: metrics.totalMarketCap ?? fallback.totalMarketCap,
          floatMarketCap: metrics.floatMarketCap ?? fallback.floatMarketCap,
        }
        industryName = industryName || fallback.industryName
      }
    } catch (error) {
      warnings.push(`东方财富全 A 列表兜底指标获取失败：${error instanceof Error ? error.message : String(error)}`)
    }

    let financialReports: FundamentalFinancialReport[] = []
    try {
      financialReports = await this.getEastmoneyFinancialReports(secucode)
    } catch (error) {
      warnings.push(`东方财富财务报表指标获取失败：${error instanceof Error ? error.message : String(error)}`)
    }

    let financialCrossCheck: FundamentalFinancialCrossCheck | undefined
    try {
      financialCrossCheck = await this.getEastmoneyFinancialCrossCheck(normalizeAshareCode(code), financialReports[0])
    } catch (error) {
      warnings.push(`东方财富业绩报表复核获取失败：${error instanceof Error ? error.message : String(error)}`)
    }

    let independentFinancialCrossCheck: FundamentalFinancialCrossCheck | undefined
    try {
      independentFinancialCrossCheck = await this.getSohuFinancialCrossCheck(normalizeAshareCode(code), financialReports[0])
    } catch (error) {
      warnings.push(`搜狐证券财务指标复核获取失败：${error instanceof Error ? error.message : String(error)}`)
    }

    let officialAnnouncement: FundamentalAnnouncementReference | undefined
    try {
      officialAnnouncement = await this.getSohuAnnouncementReference(normalizeAshareCode(code), financialReports[0])
    } catch (error) {
      warnings.push(`搜狐证券公告原文定位失败：${error instanceof Error ? error.message : String(error)}`)
    }

    let industryComparison: FundamentalIndustryComparison | undefined
    const industryBoard = this.buildIndustryBoard(industryName, industryCode)
    try {
      industryComparison = await this.getEastmoneyIndustryComparison({
        code: normalizeAshareCode(code),
        boardName: industryBoard?.name,
        boardCode: industryBoard?.code,
        metrics,
        latestReport: financialReports[0],
      })
    } catch (error) {
      warnings.push(`东方财富行业分位获取失败：${error instanceof Error ? error.message : String(error)}`)
    }

    const usableCount = Object.values(metrics).filter((value) => typeof value === 'number').length
    const financialUsableCount = financialReports.length > 0
      ? Object.entries(financialReports[0]).filter(([key, value]) => key !== 'reportDate' && key !== 'reportName' && typeof value === 'number').length
      : 0

    return {
      ...base,
      quality: usableCount >= 2 || financialUsableCount >= 4 ? 'ok' : warnings.length > 0 ? 'provider_failed' : 'missing_data',
      metrics,
      financialReports,
      financialCrossCheck,
      independentFinancialCrossCheck,
      officialAnnouncement,
      industryBoard,
      industryComparison,
      warnings: [
        ...warnings,
        ...(financialCrossCheck?.warnings || []),
        ...(independentFinancialCrossCheck?.warnings || []),
        ...(officialAnnouncement?.warnings || []),
        ...(industryComparison?.warnings || []),
        ...(usableCount >= 2 ? [] : [`东方财富 ${providerSymbol} 可用估值字段不足。`]),
        ...(financialUsableCount >= 4 ? [] : [`东方财富 ${secucode} 可用财务报表字段不足。`]),
      ],
    }
  }

  private buildIndustryBoard(industryName?: string, industryCode?: string): FundamentalIndustryBoard | undefined {
    const name = industryName && industryName !== '-' ? industryName : undefined
    const code = industryCode && /^BK\d+$/i.test(industryCode) ? industryCode.toUpperCase() : boardCodeFromIndustryName(name)
    if (!name) return undefined
    return {
      provider: 'eastmoney',
      providerLabel: 'Eastmoney A Share Quote List',
      sourceUrl: 'https://push2.eastmoney.com/api/qt/clist/get',
      asOf: new Date().toISOString(),
      quality: 'ok',
      name,
      code,
      warnings: code ? [] : [`东方财富行业 ${name} 未返回板块代码，行业分位增强将跳过。`],
    }
  }

  async getEastmoneyQuoteListSnapshot(code: string) {
    const snapshots = await this.getEastmoneyQuoteListSnapshots()
    return snapshots.get(code)
  }

  async getEastmoneyQuoteListSnapshots() {
    if (!this.quoteListSnapshotPromise) {
      const cached = await this.readQuoteListCache()
      const valuationRows = Array.from(cached.values()).filter((item) => item.peDynamic !== undefined || item.pb !== undefined).length
      const valuationCoverage = cached.size > 0 ? valuationRows / cached.size : 0
      if (
        cached.size > 0 &&
        valuationCoverage >= 0.5 &&
        !/^(1|true|yes)$/i.test(process.env.FAMS_REFRESH_QUOTE_LIST_CACHE || '')
      ) {
        this.quoteListSnapshotPromise = Promise.resolve(cached)
        return this.quoteListSnapshotPromise
      }
      this.quoteListSnapshotPromise = this.fetchEastmoneyQuoteListSnapshots()
        .then(async (snapshots) => {
          if (snapshots.size > 0) await this.writeQuoteListCache(snapshots)
          return snapshots
        })
        .catch((error) => {
          this.quoteListSnapshotPromise = undefined
          return this.readQuoteListCache()
            .then((cached) => {
              if (cached.size > 0) return cached
              throw error
            })
        })
    }
    return this.quoteListSnapshotPromise
  }

  async readQuoteListCache() {
    const canonical = await this.readQuoteListCacheFile(canonicalQuoteListCachePath, 'fams.a_share_quote_list_canonical.v1')
    if (canonical.size > 0) return canonical
    return this.readQuoteListCacheFile(quoteListCachePath, 'fams.a_share_quote_list_cache.v1')
  }

  private async readQuoteListCacheFile(path: string, schemaVersion: string) {
    try {
      const parsed = JSON.parse(await readFile(path, 'utf8')) as QuoteListCacheFile
      if (parsed.schemaVersion !== schemaVersion) return new Map<string, EastmoneyQuoteListSnapshot>()
      return new Map((parsed.items || [])
        .filter((item) => /^\d{6}$/.test(item.code))
        .map((item) => [item.code, { ...item, source: item.source || (schemaVersion.includes('canonical') ? 'fams_quote_list_canonical' : 'eastmoney_quote_list_cache'), fetchedAt: item.fetchedAt || parsed.fetchedAt }]))
    } catch {
      return new Map<string, EastmoneyQuoteListSnapshot>()
    }
  }

  private async writeQuoteListCache(snapshots: Map<string, EastmoneyQuoteListSnapshot>) {
    const fetchedAt = new Date().toISOString()
    const items = Array.from(snapshots.values())
      .filter((item) => item.totalMarketCap !== undefined || item.floatMarketCap !== undefined || item.industryName)
      .map((item) => ({ ...item, source: 'eastmoney_quote_list', fetchedAt }))
    if (items.length === 0) return
    await mkdir(dirname(quoteListCachePath), { recursive: true })
    await writeFile(quoteListCachePath, JSON.stringify({
      schemaVersion: 'fams.a_share_quote_list_cache.v1',
      provider: 'eastmoney',
      fetchedAt,
      itemCount: items.length,
      items,
    } satisfies QuoteListCacheFile, null, 2))
  }

  private async fetchEastmoneyQuoteListSnapshots(): Promise<Map<string, EastmoneyQuoteListSnapshot>> {
    const pageSize = 100
    const fetchPage = (pageNumber: number) => getJson<{
      data?: {
        total?: number
        diff?: Record<string, Record<string, unknown>> | Array<Record<string, unknown>>
      }
    }>('https://push2.eastmoney.com/api/qt/clist/get', {
      params: {
        pn: pageNumber,
        pz: pageSize,
        fs: 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23',
        fields: 'f12,f14,f9,f20,f21,f23,f100',
        ut: 'fa5fd1943c7b386f172d6893dbfba10b',
        fltt: 2,
        invt: 2,
      },
      headers: {
        Referer: 'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 12000,
    })

    const fetchPageWithRetry = async (pageNumber: number) => {
      let lastError: unknown
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await fetchPage(pageNumber)
        } catch (error) {
          lastError = error
          await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
        }
      }
      throw lastError instanceof Error ? lastError : new Error(`Eastmoney quote list page ${pageNumber} failed`)
    }

    const firstPage = await fetchPageWithRetry(1)
    const total = firstPage.data?.total || 0
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const pages = [firstPage]
    for (let pageNumber = 2; pageNumber <= totalPages; pageNumber += 1) {
      try {
        pages.push(await fetchPageWithRetry(pageNumber))
      } catch {
        // Keep partial quote-list coverage rather than failing every symbol's fundamental snapshot.
      }
      await new Promise((resolve) => setTimeout(resolve, 80))
    }

    const rows = pages.flatMap((response) => (
      Array.isArray(response.data?.diff)
        ? response.data?.diff || []
        : Object.values(response.data?.diff || {})
    ))
    return rows.reduce((map, item) => {
      const rowCode = text(item.f12)
      if (!rowCode) return map
      map.set(rowCode, {
        code: rowCode,
        name: text(item.f14) || rowCode,
        totalMarketCap: finite(item.f20),
        floatMarketCap: finite(item.f21),
        peDynamic: finite(item.f9),
        pb: finite(item.f23),
        industryName: text(item.f100),
      })
      return map
    }, new Map<string, EastmoneyQuoteListSnapshot>())
  }

  private async getEastmoneyFinancialReports(secucode: string): Promise<FundamentalFinancialReport[]> {
    const response = await getJson<{
      result?: {
        data?: Array<Record<string, unknown>>
      }
    }>('https://datacenter.eastmoney.com/securities/api/data/v1/get', {
      params: {
        reportName: 'RPT_F10_FINANCE_MAINFINADATA',
        columns: 'SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,REPORT_DATE,REPORT_DATE_NAME,NOTICE_DATE,CURRENCY,EPSJB,TOTALOPERATEREVE,TOTALOPERATEREVETZ,PARENTNETPROFIT,PARENTNETPROFITTZ,ROEJQ,XSMLL,XSJLL,ZCFZL,NETCASH_OPERATE_PK,JYXJLYYSR',
        filter: `(SECUCODE="${secucode}")`,
        pageNumber: 1,
        pageSize: 4,
        sortColumns: 'REPORT_DATE',
        sortTypes: -1,
        source: 'HSF10',
        client: 'PC',
      },
      headers: {
        Referer: 'https://data.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 8000,
    })

    return (response.result?.data || [])
      .map((item) => ({
        reportDate: text(item.REPORT_DATE) || '',
        reportName: text(item.REPORT_DATE_NAME) || text(item.REPORT_TYPE) || '',
        noticeDate: text(item.NOTICE_DATE),
        currency: text(item.CURRENCY),
        operatingRevenue: finite(item.TOTALOPERATEREVE),
        operatingRevenueYoY: finite(item.TOTALOPERATEREVETZ),
        parentNetProfit: finite(item.PARENTNETPROFIT),
        parentNetProfitYoY: finite(item.PARENTNETPROFITTZ),
        roeWeighted: finite(item.ROEJQ),
        grossMargin: finite(item.XSMLL),
        netMargin: finite(item.XSJLL),
        debtAssetRatio: finite(item.ZCFZL),
        operatingCashFlow: finite(item.NETCASH_OPERATE_PK),
        operatingCashFlowToRevenue: finite(item.JYXJLYYSR),
        basicEps: finite(item.EPSJB),
      }))
      .filter((item) => item.reportDate)
  }

  private async getEastmoneyFinancialCrossCheck(
    code: string,
    primaryReport?: FundamentalFinancialReport
  ): Promise<FundamentalFinancialCrossCheck | undefined> {
    if (!primaryReport?.reportDate) return undefined

    const response = await getJson<{
      result?: {
        data?: Array<Record<string, unknown>>
      }
    }>('https://datacenter-web.eastmoney.com/api/data/v1/get', {
      params: {
        reportName: 'RPT_LICO_FN_CPD',
        columns: 'SECURITY_CODE,SECURITY_NAME_ABBR,REPORTDATE,DATATYPE,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT,BASIC_EPS,WEIGHTAVG_ROE,XSMLL,BOARD_NAME,BOARD_CODE',
        filter: `(SECURITY_CODE="${code}")`,
        pageNumber: 1,
        pageSize: 8,
        sortColumns: 'REPORTDATE',
        sortTypes: -1,
        source: 'WEB',
        client: 'WEB',
      },
      headers: {
        Referer: 'https://data.eastmoney.com/bbsj/yjbb/',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 8000,
    })

    const primaryDate = primaryReport.reportDate.slice(0, 10)
    const matched = (response.result?.data || []).find((item) => text(item.REPORTDATE)?.startsWith(primaryDate))
    if (!matched) {
      return {
        provider: 'eastmoney',
        providerLabel: 'Eastmoney Performance Report',
        sourceUrl: 'https://datacenter-web.eastmoney.com/api/data/v1/get',
        reportName: 'RPT_LICO_FN_CPD',
        asOf: new Date().toISOString(),
        quality: 'missing_data',
        checks: [],
        warnings: [`东方财富业绩报表未找到 ${code} ${primaryDate} 可复核记录。`],
      }
    }

    const buildCheck = (
      id: string,
      label: string,
      primaryValue: number | undefined,
      crossValue: number | undefined,
      passThreshold: number,
      warnThreshold: number
    ) => {
      const delta = deltaPercent(primaryValue, crossValue)
      return {
        id,
        label,
        primaryValue,
        crossValue,
        deltaPercent: delta,
        status: delta === undefined ? 'missing' as const : delta <= passThreshold ? 'pass' as const : delta <= warnThreshold ? 'warn' as const : 'fail' as const,
      }
    }

    const checks = [
      buildCheck('operating_revenue_crosscheck', '营业收入复核', primaryReport.operatingRevenue, finite(matched.TOTAL_OPERATE_INCOME), 0.01, 0.1),
      buildCheck('parent_net_profit_crosscheck', '归母净利润复核', primaryReport.parentNetProfit, finite(matched.PARENT_NETPROFIT), 0.01, 0.1),
      buildCheck('basic_eps_crosscheck', '每股收益复核', primaryReport.basicEps, finite(matched.BASIC_EPS), 0.5, 2),
      buildCheck('roe_crosscheck', 'ROE 复核', primaryReport.roeWeighted, finite(matched.WEIGHTAVG_ROE), 0.5, 2),
      buildCheck('gross_margin_crosscheck', '毛利率复核', primaryReport.grossMargin, finite(matched.XSMLL), 0.5, 2),
    ]
    return {
      provider: 'eastmoney',
      providerLabel: 'Eastmoney Performance Report',
      sourceUrl: 'https://datacenter-web.eastmoney.com/api/data/v1/get',
      reportName: 'RPT_LICO_FN_CPD',
      asOf: new Date().toISOString(),
      quality: statusFromChecks(checks),
      matchedReportDate: text(matched.REPORTDATE),
      checks,
      warnings: [
        '财报复核当前使用东方财富 F10 主指标与东方财富数据中心业绩报表两个接口交叉校验，仍属于同厂不同接口；后续需接入新浪或交易所公告全文作为独立来源。',
        ...(checks.some((check) => check.status === 'fail') ? ['东方财富业绩报表复核存在失败项。'] : []),
      ],
    }
  }

  private async getSohuFinancialCrossCheck(
    code: string,
    primaryReport?: FundamentalFinancialReport
  ): Promise<FundamentalFinancialCrossCheck | undefined> {
    if (!primaryReport?.reportDate) return undefined

    const sourceUrl = `https://q.stock.sohu.com/cn/${code}/cwzb.shtml`
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    })
    if (!response.ok) {
      throw new Error(`Sohu financial page returned HTTP ${response.status}`)
    }

    const html = new TextDecoder('gb18030').decode(Buffer.from(await response.arrayBuffer()))
    const parsed = this.parseSohuFinancialMetrics(html)
    const primaryDate = primaryReport.reportDate.slice(0, 10)
    if (parsed.reportDate && parsed.reportDate !== primaryDate) {
      return {
        provider: 'sohu',
        providerLabel: 'Sohu Securities Financial Indicators',
        sourceUrl,
        reportName: 'SOHU_CWZB',
        asOf: new Date().toISOString(),
        quality: 'missing_data',
        matchedReportDate: parsed.reportDate,
        checks: [],
        warnings: [`搜狐证券最新报告期 ${parsed.reportDate} 与主源 ${primaryDate} 不一致，独立复核未使用。`],
      }
    }

    const buildCheck = (
      id: string,
      label: string,
      primaryValue: number | undefined,
      crossValue: number | undefined,
      passThreshold: number,
      warnThreshold: number
    ) => {
      const delta = deltaPercent(primaryValue, crossValue)
      return {
        id,
        label,
        primaryValue,
        crossValue,
        deltaPercent: delta,
        status: delta === undefined ? 'missing' as const : delta <= passThreshold ? 'pass' as const : delta <= warnThreshold ? 'warn' as const : 'fail' as const,
      }
    }

    const checks = [
      buildCheck('sohu_operating_revenue_crosscheck', '搜狐营业收入复核', primaryReport.operatingRevenue, parsed.operatingRevenue, 0.05, 0.2),
      buildCheck('sohu_parent_net_profit_crosscheck', '搜狐净利润复核', primaryReport.parentNetProfit, parsed.netProfit, 0.05, 0.2),
      buildCheck('sohu_basic_eps_crosscheck', '搜狐每股收益复核', primaryReport.basicEps, parsed.basicEps, 0.5, 2),
      buildCheck('sohu_roe_crosscheck', '搜狐 ROE 复核', primaryReport.roeWeighted, parsed.roeWeighted, 0.5, 2),
      buildCheck('sohu_debt_asset_ratio_crosscheck', '搜狐资产负债率复核', primaryReport.debtAssetRatio, parsed.debtAssetRatio, 0.5, 2),
    ]

    return {
      provider: 'sohu',
      providerLabel: 'Sohu Securities Financial Indicators',
      sourceUrl,
      reportName: 'SOHU_CWZB',
      asOf: new Date().toISOString(),
      quality: statusFromChecks(checks),
      matchedReportDate: parsed.reportDate,
      checks,
      warnings: [
        ...(checks.some((check) => check.status === 'fail') ? ['搜狐证券财务指标复核存在失败项。'] : []),
        ...(checks.some((check) => check.status === 'missing') ? ['搜狐证券财务指标复核存在缺失项。'] : []),
      ],
    }
  }

  private async getSohuAnnouncementReference(
    code: string,
    primaryReport?: FundamentalFinancialReport
  ): Promise<FundamentalAnnouncementReference | undefined> {
    if (!primaryReport?.reportDate) return undefined

    const sourceUrl = `https://q.stock.sohu.com/cn/${code}/bw.shtml`
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
      },
    })
    if (!response.ok) {
      throw new Error(`Sohu announcement page returned HTTP ${response.status}`)
    }

    const html = new TextDecoder('gb18030').decode(Buffer.from(await response.arrayBuffer()))
    const expectedKeyword = this.expectedAnnouncementKeyword(primaryReport)
    const rowPattern = /<tr id="tr(\d+)"[\s\S]*?<td class="e1">([\s\S]*?)<\/td>[\s\S]*?<td class="e2">([\s\S]*?)<\/td>[\s\S]*?<\/tr>[\s\S]*?<tr class=more[\s\S]*?id="more\1"[\s\S]*?<td class="e1" colspan="3">([\s\S]*?)<\/td>/g
    const candidates = [...html.matchAll(rowPattern)].map((match) => {
      const disclosureDate = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const title = match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const details = match[4]
      const pdfUrl = details.match(/https?:\/\/static\.sse\.com\.cn\/[^"'<> \n\r]+\.pdf/)?.[0]
      return { disclosureDate, title, pdfUrl }
    })
    const matched = candidates.find((item) => item.title.includes(expectedKeyword) && item.pdfUrl)

    if (!matched) {
      return {
        provider: 'sohu',
        providerLabel: 'Sohu Securities Announcement Memo',
        sourceUrl,
        asOf: new Date().toISOString(),
        quality: 'missing_data',
        reportDate: primaryReport.reportDate,
        reportName: primaryReport.reportName,
        warnings: [`搜狐证券备忘页未定位到 ${code} ${primaryReport.reportName} 的上交所公告 PDF。`],
      }
    }

    return {
      provider: 'sohu',
      providerLabel: 'Sohu Securities Announcement Memo',
      sourceUrl,
      asOf: new Date().toISOString(),
      quality: 'located',
      title: matched.title,
      disclosureDate: matched.disclosureDate,
      reportDate: primaryReport.reportDate,
      reportName: primaryReport.reportName,
      pdfUrl: matched.pdfUrl?.replace(/^http:\/\//, 'https://'),
      warnings: ['公告原文 PDF 已定位，但 PDF 表格字段抽取尚未接入；当前仅作为官方原文链接 evidence。'],
    }
  }

  private expectedAnnouncementKeyword(report: FundamentalFinancialReport) {
    if (report.reportName.includes('一季报')) return '第一季度报告'
    if (report.reportName.includes('半年报')) return '半年度报告'
    if (report.reportName.includes('三季报')) return '第三季度报告'
    if (report.reportName.includes('年报')) return '年度报告'
    return report.reportName
  }

  private parseSohuFinancialMetrics(html: string) {
    const tableStart = html.indexOf('table class="reportA"')
    if (tableStart < 0) {
      throw new Error('Sohu financial table not found')
    }
    const tableEnd = html.indexOf('</table>', tableStart)
    const table = html.slice(tableStart, tableEnd > tableStart ? tableEnd : undefined)
    const rowMap = new Map<string, string[]>()
    for (const match of table.matchAll(/<tr[\s\S]*?<\/tr>/g)) {
      const row = match[0]
      const header = row.match(/<th[^>]*>([\s\S]*?)<\/th>/)?.[1]
        ?.replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (!header) continue
      const values = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => (
        cell[1]
          .replace(/<span[^>]*>/g, '')
          .replace(/<\/span>/g, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      ))
      rowMap.set(header, values)
    }

    const readFirstValue = (label: string) => {
      const token = rowMap.get(label)?.[0]
      return finite(token === '--' ? undefined : token)
    }
    const reportDate = rowMap.get('报告期')?.[0]

    return {
      reportDate,
      basicEps: readFirstValue('每股收益'),
      roeWeighted: readFirstValue('净资产收益率'),
      debtAssetRatio: readFirstValue('资产负债率'),
      operatingRevenue: readFirstValue('主营业务收入') === undefined ? undefined : readFirstValue('主营业务收入')! * 10000,
      netProfit: readFirstValue('净利润') === undefined ? undefined : readFirstValue('净利润')! * 10000,
    }
  }

  private async getEastmoneyIndustryComparison(params: {
    code: string
    boardName?: string
    boardCode?: string
    metrics: FundamentalSnapshot['metrics']
    latestReport?: FundamentalFinancialReport
  }): Promise<FundamentalIndustryComparison | undefined> {
    const boardCode = params.boardCode || boardCodeFromIndustryName(params.boardName)
    if (!boardCode || !params.boardName) {
      return undefined
    }

    const response = await getJson<{
      data?: {
        total?: number
        diff?: Record<string, Record<string, unknown>>
      }
    }>('https://push2.eastmoney.com/api/qt/clist/get', {
      params: {
        pn: 1,
        pz: 120,
        fs: `b:${boardCode}`,
        fields: 'f12,f14,f9,f20,f23,f115',
        ut: 'fa5fd1943c7b386f172d6893dbfba10b',
        fltt: 2,
        invt: 2,
      },
      headers: {
        Referer: `https://quote.eastmoney.com/bk/90.${boardCode}.html`,
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 8000,
    })

    const rawPeers: FundamentalIndustryPeer[] = Object.values(response.data?.diff || {})
      .map((item) => ({
        code: text(item.f12) || '',
        name: text(item.f14) || '',
        peDynamic: finite(item.f115) || finite(item.f9),
        pb: finite(item.f23),
        totalMarketCap: finite(item.f20),
      }))
      .filter((item) => item.code && item.name)

    const targetPeer = rawPeers.find((item) => item.code === params.code)
    if (targetPeer) {
      targetPeer.peDynamic = params.metrics.peDynamic ?? targetPeer.peDynamic
      targetPeer.pb = params.metrics.pb ?? targetPeer.pb
      targetPeer.totalMarketCap = params.metrics.totalMarketCap ?? targetPeer.totalMarketCap
      targetPeer.roeWeighted = params.latestReport?.roeWeighted
      targetPeer.debtAssetRatio = params.latestReport?.debtAssetRatio
    }

    const peers = await this.enrichPeersWithFinancials(rawPeers)
    const target = peers.find((item) => item.code === params.code) || targetPeer
    const warnings: string[] = []
    if (!target) warnings.push(`东方财富行业 ${params.boardName} 未找到目标股票 ${params.code}。`)

    return {
      provider: 'eastmoney',
      boardCode,
      boardName: params.boardName,
      sourceUrl: 'https://push2.eastmoney.com/api/qt/clist/get',
      asOf: new Date().toISOString(),
      sampleSize: peers.length,
      metrics: {
        peDynamicPercentile: percentileRank(peers.map((item) => item.peDynamic).filter((value): value is number => typeof value === 'number'), target?.peDynamic, false),
        pbPercentile: percentileRank(peers.map((item) => item.pb).filter((value): value is number => typeof value === 'number'), target?.pb, false),
        totalMarketCapPercentile: percentileRank(peers.map((item) => item.totalMarketCap).filter((value): value is number => typeof value === 'number'), target?.totalMarketCap, true),
        roePercentile: percentileRank(peers.map((item) => item.roeWeighted).filter((value): value is number => typeof value === 'number'), target?.roeWeighted, true),
        debtAssetRatioPercentile: percentileRank(peers.map((item) => item.debtAssetRatio).filter((value): value is number => typeof value === 'number'), target?.debtAssetRatio, false),
      },
      peers,
      warnings: [
        ...warnings,
        ...(peers.length >= 5 ? [] : [`东方财富行业 ${params.boardName} 可用同业样本不足。`]),
      ],
    }
  }

  private async enrichPeersWithFinancials(peers: FundamentalIndustryPeer[]) {
    const limitedPeers = peers.slice(0, 30)
    const enriched = await Promise.all(limitedPeers.map(async (peer) => {
      const secucode = getEastmoneySecucode(peer.code, 'A股')
      if (!secucode) return peer
      try {
        const reports = await this.getEastmoneyFinancialReports(secucode)
        const latest = reports[0]
        return {
          ...peer,
          roeWeighted: latest?.roeWeighted,
          debtAssetRatio: latest?.debtAssetRatio,
        }
      } catch {
        return peer
      }
    }))
    return enriched
  }
}

export const fundamentalDataProvider = new FundamentalDataProvider()
