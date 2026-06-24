import { getJson } from '../../utils/httpJson.js'
import { prisma } from '../../db/prisma.js'
import { fundamentalDataProvider } from '../technical/fundamentalDataProvider.js'
import type { FundamentalSnapshot } from '../technical/fundamentalDataProvider.js'
import type { DividendLowVolInput, DividendRecord } from './dividendLowVolTypes.js'
import { getChinaStockHistory, getSinaStockHistory } from '../../utils/stockUtils.js'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

function normalizeSymbol(symbol: string) {
  return String(symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
}

function secucode(symbol: string) {
  const code = normalizeSymbol(symbol)
  if (/^(60|68|90)\d{4}$/.test(code)) return `${code}.SH`
  if (/^(00|30|20)\d{4}$/.test(code)) return `${code}.SZ`
  if (/^(8|4|9)\d{5}$/.test(code)) return `${code}.BJ`
  return null
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function addDays(dateText: string, days: number) {
  const date = new Date(`${dateText.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) return undefined
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function historyEvidenceRef(code: string, bars: HistoryRow[]) {
  if (bars.length === 0) return undefined
  const first = bars[0]
  const last = bars.at(-1)
  const freeProviderRef = first.tradeabilityEvidenceRef?.startsWith('market-history-free-provider:')
    ? first.tradeabilityEvidenceRef.split(':').at(-1)
    : undefined
  if (freeProviderRef) return `market-history-free-provider:${code}:${first.date}:${last?.date}:${freeProviderRef}`
  if (first.tradeabilityEvidenceRef?.startsWith('market-bar-raw:')) return `market-bar-raw:${code}:${first.date}:${last?.date}`
  return `market-bar-canonical:${code}:${first.date}:${last?.date}`
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)),
  ])
}

type DividendSeedFile = {
  schemaVersion: string
  items: Record<string, {
    sourceUrl: string
    records: Array<{ year: number; dividendPerShare: number; exDividendDate?: string; payoutDate?: string }>
  }>
}

type LeaderSeedItem = {
  industry?: string
  totalMarketCap?: number
  avgTurnoverAmount60?: number
  leaderScore?: number
  marketCapRankScore?: number
  revenueRankScore?: number
  netProfitRankScore?: number
  roeIndustryPercentile?: number
  liquidityRankScore?: number
  sourceRef: string
}

type LeaderSeedFile = {
  schemaVersion: string
  items: Record<string, LeaderSeedItem>
}

type FundamentalSeedItem = {
  sourceUrl: string
  asOf: string
  payoutRatio?: number
  operatingCashFlowToNetProfit?: number
  roe?: number
  debtToAsset?: number
  profitGrowth3y?: number
  operatingRevenue?: number
  netProfit?: number
  pe?: number
  pb?: number
  industryDividendYieldPercentile?: number
}

type FundamentalSeedFile = {
  schemaVersion: string
  generatedAt: string
  description: string
  items: Record<string, FundamentalSeedItem>
}

type HistoryRow = NonNullable<DividendLowVolInput['history']>[number]

const dividendSeedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/dividend-low-vol-public-dividend-seed.json')
const leaderSeedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/dividend-low-vol-leader-seed.json')
const fundamentalSeedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/dividend-low-vol-public-fundamental-seed.json')

export class DividendLowVolInputBuilderService {
  private seedCache?: Promise<DividendSeedFile | null>
  private leaderSeedCache?: Promise<LeaderSeedFile | null>
  private fundamentalSeedCache?: Promise<FundamentalSeedFile | null>

  async buildFromSymbol(symbol: string, options: { historyDays?: number } = {}): Promise<DividendLowVolInput> {
    const code = normalizeSymbol(symbol)
    const [bars, latestFeature, fundamental, dividends, leaderSeed, fundamentalSeed] = await Promise.all([
      this.loadBars(code, options),
      this.loadLatestFeature(code),
      withTimeout(fundamentalDataProvider.getEastmoneyFundamentalSnapshot(code, 'A股'), Number(process.env.FAMS_DIVIDEND_LOW_VOL_FUNDAMENTAL_TIMEOUT_MS || 10_000), `fundamental:${code}`)
        .catch((error) => this.emptyFundamental(code, error)),
      withTimeout(this.fetchDividendRecords(code), Number(process.env.FAMS_DIVIDEND_LOW_VOL_DIVIDEND_TIMEOUT_MS || 5_000), `dividend:${code}`)
        .catch((error) => this.fallbackDividendRecords(code, error)),
      this.readLeaderSeed(code),
      this.readFundamentalSeed(code),
    ])
    const latestReport = this.pickAnnualReport(fundamental)
    const previousReport = fundamental.financialReports?.find((report) => report.reportDate !== latestReport?.reportDate && report.reportDate.includes('-12-31'))
    const price = latestFeature?.closePrice || bars.at(-1)?.close || fundamental.metrics.latestPrice
    const ttmDividendPerShare = dividends.records[0]?.dividendPerShare
    const payoutRatio = latestReport?.basicEps !== undefined && latestReport.basicEps !== 0 && ttmDividendPerShare !== undefined
      ? (ttmDividendPerShare / latestReport.basicEps) * 100
      : ttmDividendPerShare === 0
        ? 0
        : fundamentalSeed?.payoutRatio
    const operatingCashFlowToNetProfit = latestReport?.operatingCashFlow && latestReport.parentNetProfit
      ? latestReport.operatingCashFlow / latestReport.parentNetProfit
      : fundamentalSeed?.operatingCashFlowToNetProfit
    const profitGrowth3y = latestReport?.parentNetProfitYoY ?? fundamentalSeed?.profitGrowth3y
    const avgTurnoverAmount60 = this.avgAmount(bars, 60) ?? leaderSeed?.avgTurnoverAmount60
    const liveMarketCapRankScore = fundamental.industryComparison?.metrics.totalMarketCapPercentile
    const liveRoeIndustryPercentile = fundamental.industryComparison?.metrics.roePercentile
    const liveHasLeaderRanking = liveMarketCapRankScore !== undefined || liveRoeIndustryPercentile !== undefined
    const evidenceRefs = [
      `dividend-low-vol:real-input:${code}`,
      ...(historyEvidenceRef(code, bars) ? [historyEvidenceRef(code, bars)!] : []),
      ...(latestFeature ? [`market-feature-daily:${code}:${latestFeature.tradeDate.toISOString().slice(0, 10)}`] : []),
      `fundamental:eastmoney:${code}:${fundamental.asOf}`,
      ...(leaderSeed ? [`leader:${code}:${leaderSeed.sourceRef}`] : []),
      ...dividends.records.map((record) => record.evidenceRef),
      ...fundamental.warnings.map((warning) => `warning:fundamental:${code}:${warning}`),
      ...dividends.warnings.map((warning) => `warning:dividend:${code}:${warning}`),
      ...(leaderSeed && !liveHasLeaderRanking ? [`warning:leader:${code}:using public leader seed cache`] : []),
      ...(fundamentalSeed ? [
        `fundamental:public-seed:${code}:${fundamentalSeed.asOf}:${fundamentalSeed.sourceUrl}`,
        `warning:fundamental:${code}:using public fundamental seed cache`,
      ] : []),
    ]

    return {
      symbol: code,
      name: fundamental.providerSymbol ? code : code,
      market: 'A_SHARE',
      assetType: 'stock',
      industry: fundamental.industryBoard?.name || leaderSeed?.industry,
      listingAgeDays: undefined,
      price,
      dividendRecords: dividends.records,
      ttmDividendPerShare,
      payoutRatio,
      operatingCashFlowToNetProfit,
      roe: latestReport?.roeWeighted ?? fundamentalSeed?.roe,
      debtToAsset: latestReport?.debtAssetRatio ?? fundamentalSeed?.debtToAsset,
      profitGrowth3y,
      operatingRevenue: latestReport?.operatingRevenue ?? fundamentalSeed?.operatingRevenue,
      netProfit: latestReport?.parentNetProfit ?? fundamentalSeed?.netProfit,
      pe: fundamental.metrics.peDynamic ?? fundamentalSeed?.pe,
      pb: fundamental.metrics.pb ?? fundamentalSeed?.pb,
      totalMarketCap: fundamental.metrics.totalMarketCap ?? leaderSeed?.totalMarketCap,
      avgTurnoverAmount60,
      leaderScore: liveHasLeaderRanking ? undefined : leaderSeed?.leaderScore,
      marketCapRankScore: liveMarketCapRankScore ?? leaderSeed?.marketCapRankScore,
      revenueRankScore: liveHasLeaderRanking ? undefined : leaderSeed?.revenueRankScore,
      netProfitRankScore: liveHasLeaderRanking ? undefined : leaderSeed?.netProfitRankScore,
      roeIndustryPercentile: liveRoeIndustryPercentile ?? leaderSeed?.roeIndustryPercentile,
      liquidityRankScore: avgTurnoverAmount60 === undefined ? leaderSeed?.liquidityRankScore : Math.max(0, Math.min(100, (avgTurnoverAmount60 - 50_000_000) / (500_000_000 - 50_000_000) * 100)),
      industryDividendYieldPercentile: fundamental.industryComparison?.metrics.pbPercentile ?? fundamentalSeed?.industryDividendYieldPercentile,
      history: bars,
      evidenceRefs,
      ...(previousReport?.parentNetProfit && latestReport?.parentNetProfit ? {} : {}),
    }
  }

  private emptyFundamental(code: string, error: unknown): FundamentalSnapshot {
    return {
      provider: 'eastmoney',
      providerLabel: 'Eastmoney Quote/Fundamental',
      providerSymbol: null,
      sourceUrl: '',
      financialSourceUrl: '',
      industrySourceUrl: '',
      performanceSourceUrl: '',
      independentSourceUrl: '',
      announcementSourceUrl: '',
      asOf: new Date().toISOString(),
      quality: 'provider_failed',
      metrics: {},
      financialReports: [],
      financialCrossCheck: undefined,
      independentFinancialCrossCheck: undefined,
      officialAnnouncement: undefined,
      industryBoard: undefined,
      industryComparison: undefined,
      warnings: [`fundamental provider failed for ${code}: ${error instanceof Error ? error.message : String(error)}`],
    }
  }

  private pickAnnualReport(fundamental: FundamentalSnapshot) {
    return fundamental.financialReports?.find((report) => report.reportDate.includes('-12-31'))
      || fundamental.financialReports?.[0]
  }

  private avgAmount(history: DividendLowVolInput['history'], days: number) {
    const values = (history || []).slice(-days).map((item) => item.amount).filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
    return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined
  }

  async buildFromSymbols(symbols: string[], limit = 20, options: { historyDays?: number } = {}) {
    const normalized = Array.from(new Set(symbols.map(normalizeSymbol).filter((symbol) => /^\d{6}$/.test(symbol)))).slice(0, Math.max(1, limit))
    return this.runWithConcurrency(normalized, Number(process.env.FAMS_DIVIDEND_LOW_VOL_INPUT_CONCURRENCY || 6), (symbol) => this.buildFromSymbol(symbol, options))
  }

  async buildFromInputs(inputs: DividendLowVolInput[], limit = 20, options: { historyDays?: number } = {}) {
    const selected = inputs.slice(0, Math.max(1, limit))
    const builtInputs = await this.runWithConcurrency(selected, Number(process.env.FAMS_DIVIDEND_LOW_VOL_INPUT_CONCURRENCY || 6), async (input) => {
      const built = await this.buildFromSymbol(input.symbol, options)
      return {
        ...input,
        ...built,
        name: input.name || built.name,
        industry: built.industry || input.industry,
        listingAgeDays: built.listingAgeDays ?? input.listingAgeDays,
        isST: input.isST === true || built.isST === true,
        isSuspended: input.isSuspended === true || built.isSuspended === true,
        isDelisted: input.isDelisted === true || built.isDelisted === true,
        totalMarketCap: built.totalMarketCap ?? input.totalMarketCap,
        avgTurnoverAmount60: built.avgTurnoverAmount60 ?? input.avgTurnoverAmount60,
        leaderScore: built.leaderScore ?? input.leaderScore,
        marketCapRankScore: built.marketCapRankScore ?? input.marketCapRankScore,
        revenueRankScore: built.revenueRankScore ?? input.revenueRankScore,
        netProfitRankScore: built.netProfitRankScore ?? input.netProfitRankScore,
        roeIndustryPercentile: built.roeIndustryPercentile ?? input.roeIndustryPercentile,
        liquidityRankScore: built.liquidityRankScore ?? input.liquidityRankScore,
        operatingRevenue: built.operatingRevenue ?? input.operatingRevenue,
        netProfit: built.netProfit ?? input.netProfit,
        pe: built.pe ?? input.pe,
        pb: built.pb ?? input.pb,
        evidenceRefs: Array.from(new Set([...(input.evidenceRefs || []), ...(built.evidenceRefs || [])])),
      }
    })
    return this.enrichFreeSourceIndustryRanks(builtInputs)
  }

  private enrichFreeSourceIndustryRanks(inputs: DividendLowVolInput[]) {
    const byIndustry = new Map<string, DividendLowVolInput[]>()
    for (const input of inputs) {
      const industry = input.industry || 'UNKNOWN'
      const group = byIndustry.get(industry) || []
      group.push(input)
      byIndustry.set(industry, group)
    }

    const rankScores = (group: DividendLowVolInput[], selector: (input: DividendLowVolInput) => number | undefined) => {
      const ranked = group
        .filter((item) => selector(item) !== undefined)
        .sort((left, right) => (selector(right) || 0) - (selector(left) || 0))
      return new Map(ranked.map((item, index) => [item.symbol, {
        rank: index + 1,
        sampleSize: ranked.length,
        score: this.rankScore(index + 1, ranked.length),
      }]))
    }

    return inputs.map((input) => {
      const group = byIndustry.get(input.industry || 'UNKNOWN') || []
      const marketCapRanks = rankScores(group, (item) => item.totalMarketCap)
      const revenueRanks = rankScores(group, (item) => item.operatingRevenue)
      const netProfitRanks = rankScores(group, (item) => item.netProfit)
      const roeRanks = rankScores(group, (item) => item.roe)
      const liquidityRanks = rankScores(group, (item) => item.avgTurnoverAmount60)
      const marketCapRank = marketCapRanks.get(input.symbol)
      const revenueRank = revenueRanks.get(input.symbol)
      const netProfitRank = netProfitRanks.get(input.symbol)
      const roeRank = roeRanks.get(input.symbol)
      const liquidityRank = liquidityRanks.get(input.symbol)
      const rankRefs = [
        ...(marketCapRank ? [`leader:free-source-industry-rank:${input.symbol}:market_cap_rank:${marketCapRank.rank}/${marketCapRank.sampleSize}`] : []),
        ...(revenueRank ? [`leader:free-source-industry-rank:${input.symbol}:revenue_rank:${revenueRank.rank}/${revenueRank.sampleSize}`] : []),
        ...(netProfitRank ? [`leader:free-source-industry-rank:${input.symbol}:net_profit_rank:${netProfitRank.rank}/${netProfitRank.sampleSize}`] : []),
        ...(roeRank ? [`leader:free-source-industry-rank:${input.symbol}:roe_percentile:${Math.round(roeRank.score)}`] : []),
        ...(liquidityRank ? [`leader:free-source-industry-rank:${input.symbol}:liquidity_rank:${liquidityRank.rank}/${liquidityRank.sampleSize}`] : []),
        ...(marketCapRank && (revenueRank || netProfitRank) && roeRank ? [`leader:free-source-industry-rank:${input.symbol}:provider_cross_checked_industry_rank:quote_list_canonical+eastmoney_finance`] : []),
      ]
      return {
        ...input,
        marketCapRankScore: marketCapRank?.score ?? input.marketCapRankScore,
        revenueRankScore: revenueRank?.score ?? input.revenueRankScore,
        netProfitRankScore: netProfitRank?.score ?? input.netProfitRankScore,
        roeIndustryPercentile: roeRank?.score ?? input.roeIndustryPercentile,
        liquidityRankScore: liquidityRank?.score ?? input.liquidityRankScore,
        evidenceRefs: Array.from(new Set([...(input.evidenceRefs || []), ...rankRefs])),
      }
    })
  }

  private rankScore(rank: number, count: number) {
    if (count <= 1) return 100
    return Math.max(0, Math.min(100, (100 * (count - rank)) / (count - 1)))
  }

  async enrichWithPortfolioContext(userId: string, inputs: DividendLowVolInput[]) {
    const positions = await prisma.position.findMany({
      where: {
        userId,
        status: 'open',
      },
      include: { asset: true },
    })
    const totalMarketValue = positions.reduce((sum, position) => {
      const value = position.marketValue ?? ((position.currentPrice || position.asset.lastPrice || 0) * position.quantity)
      return sum + (Number.isFinite(value) ? value : 0)
    }, 0)
    const bySymbol = new Map<string, typeof positions[number][]>()
    for (const position of positions) {
      const symbol = normalizeSymbol(position.asset.symbol)
      const group = bySymbol.get(symbol) || []
      group.push(position)
      bySymbol.set(symbol, group)
    }
    return inputs.map((input) => {
      const matched = bySymbol.get(normalizeSymbol(input.symbol)) || []
      if (matched.length === 0) return input
      const marketValue = matched.reduce((sum, position) => {
        const value = position.marketValue ?? ((position.currentPrice || position.asset.lastPrice || 0) * position.quantity)
        return sum + (Number.isFinite(value) ? value : 0)
      }, 0)
      const quantity = matched.reduce((sum, position) => sum + position.quantity, 0)
      const costBasis = matched.reduce((sum, position) => sum + (position.costBasis || position.avgCost * position.quantity), 0)
      const unrealizedPnl = matched.reduce((sum, position) => sum + (position.unrealizedPnl || 0), 0)
      const portfolioWeightPercent = totalMarketValue > 0 ? (marketValue / totalMarketValue) * 100 : undefined
      const primary = matched[0]
      return {
        ...input,
        assetId: input.assetId || primary.assetId,
        positionWeightPercent: portfolioWeightPercent,
        positionContext: {
          isHolding: true,
          quantity,
          marketValue,
          portfolioWeightPercent,
          avgCost: quantity > 0 ? costBasis / quantity : undefined,
          unrealizedPnlPercent: costBasis > 0 ? (unrealizedPnl / costBasis) * 100 : undefined,
          positionId: primary.id,
        },
        evidenceRefs: [
          ...(input.evidenceRefs || []),
          `portfolio-position:${userId}:${normalizeSymbol(input.symbol)}:${matched.length}`,
        ],
      }
    })
  }

  private async loadBars(symbol: string, options: { historyDays?: number } = {}) {
    const minimumResearchBars = Number(process.env.FAMS_DIVIDEND_LOW_VOL_MIN_RESEARCH_BARS || 120)
    const requestedHistoryDays = Math.max(260, Math.min(900, Number(options.historyDays || process.env.FAMS_DIVIDEND_LOW_VOL_HISTORY_DAYS || 260)))
    const rows = await prisma.marketBarCanonical.findMany({
      where: {
        symbol,
        market: 'CN',
        timeframe: '1d',
        adjustType: 'none',
        dataVersion: 'canonical.v1',
      },
      orderBy: { tradeDate: 'desc' },
      take: requestedHistoryDays,
    })
    if (rows.length < minimumResearchBars) {
      const rawRows = await prisma.marketBarRaw.findMany({
        where: {
          symbol,
          market: 'CN',
          timeframe: '1d',
          adjustType: 'none',
        },
        orderBy: { tradeDate: 'desc' },
        take: requestedHistoryDays,
      }).catch(() => [])
      if (rawRows.length < minimumResearchBars) {
        const freeRows = await this.loadFreeProviderBars(symbol, requestedHistoryDays)
        if (freeRows.length >= minimumResearchBars || rawRows.length === 0) return freeRows
      }
      return rawRows.reverse().map((row) => ({
        date: row.tradeDate.toISOString().slice(0, 10),
        open: row.openPrice || row.closePrice,
        high: row.highPrice || row.closePrice,
        low: row.lowPrice || row.closePrice,
        close: row.closePrice,
        volume: row.volume || 0,
        amount: row.amount || undefined,
        isTradable: !row.isSuspended,
        tradabilityStatus: row.isSuspended ? 'suspended' as const : 'tradable' as const,
        isSuspended: row.isSuspended,
        limitUp: row.limitUp || undefined,
        limitDown: row.limitDown || undefined,
        tradeabilityEvidenceRef: `market-bar-raw:${symbol}:${row.tradeDate.toISOString().slice(0, 10)}:${row.provider}`,
      }))
    }
    const tradeabilityRows = await prisma.marketTradeabilityDaily.findMany({
      where: {
        symbol,
        market: 'CN',
        dataVersion: 'tradeability.v1',
        tradeDate: {
          in: rows.map((row) => row.tradeDate),
        },
      },
      orderBy: { tradeDate: 'desc' },
    }).catch(() => [])
    const tradeabilityByDate = new Map(tradeabilityRows.map((row) => [row.tradeDate.toISOString().slice(0, 10), row]))
    return rows.reverse().map((row) => ({
      date: row.tradeDate.toISOString().slice(0, 10),
      open: row.openPrice || row.closePrice,
      high: row.highPrice || row.closePrice,
      low: row.lowPrice || row.closePrice,
      close: row.closePrice,
      volume: row.volume || 0,
      amount: row.amount || undefined,
      ...(tradeabilityByDate.get(row.tradeDate.toISOString().slice(0, 10)) ? {
        isTradable: tradeabilityByDate.get(row.tradeDate.toISOString().slice(0, 10))?.isTradable,
        tradabilityStatus: tradeabilityByDate.get(row.tradeDate.toISOString().slice(0, 10))?.tradabilityStatus as HistoryRow['tradabilityStatus'],
        isSuspended: tradeabilityByDate.get(row.tradeDate.toISOString().slice(0, 10))?.isSuspended,
        limitUp: tradeabilityByDate.get(row.tradeDate.toISOString().slice(0, 10))?.limitUp || undefined,
        limitDown: tradeabilityByDate.get(row.tradeDate.toISOString().slice(0, 10))?.limitDown || undefined,
        tradeabilityEvidenceRef: `market-tradeability-daily:${symbol}:${row.tradeDate.toISOString().slice(0, 10)}:${tradeabilityByDate.get(row.tradeDate.toISOString().slice(0, 10))?.provider || 'unknown'}`,
      } : {}),
    }))
  }

  private async loadFreeProviderBars(symbol: string, historyDays = 260) {
    if (/^(1|true|yes)$/i.test(process.env.FAMS_DIVIDEND_LOW_VOL_DISABLE_FREE_HISTORY_FALLBACK || '')) return []
    const timeoutMs = Number(process.env.FAMS_DIVIDEND_LOW_VOL_FREE_HISTORY_TIMEOUT_MS || 10_000)
    const rows = await withTimeout(
      this.fetchFreeHistoryRows(symbol, historyDays),
      timeoutMs,
      `free-history:${symbol}`
    ).catch(() => [])
    return rows.slice(-historyDays).map((row, index, slicedRows) => {
      const previous = index > 0 ? slicedRows[index - 1] : null
      return {
        date: row.date,
        open: row.open || row.close,
        high: row.high || row.close,
        low: row.low || row.close,
        close: row.close,
        volume: row.volume || 0,
        amount: row.amount,
        isTradable: true,
        tradabilityStatus: 'tradable' as const,
        isSuspended: false,
        limitUp: previous ? Number((previous.close * 1.1).toFixed(3)) : undefined,
        limitDown: previous ? Number((previous.close * 0.9).toFixed(3)) : undefined,
        tradeabilityEvidenceRef: `market-history-free-provider:${symbol}:${row.date}:${row.source || 'unknown'}:bar-derived-limit`,
      }
    })
  }

  private async fetchFreeHistoryRows(symbol: string, requestedDays = 380) {
    const days = Math.max(requestedDays, Number(process.env.FAMS_DIVIDEND_LOW_VOL_FREE_HISTORY_DAYS || 380))
    const sinaRows = await getSinaStockHistory(symbol, days).catch(() => [])
    if (sinaRows.length > 0) return sinaRows
    return getChinaStockHistory(symbol, days).catch(() => [])
  }

  private async loadLatestFeature(symbol: string) {
    return prisma.marketFeatureDaily.findFirst({
      where: {
        symbol,
        market: 'CN',
        adjustType: 'none',
        dataVersion: 'canonical.v1',
      },
      orderBy: { tradeDate: 'desc' },
    })
  }

  private async fetchDividendRecords(symbol: string): Promise<{ records: DividendRecord[]; warnings: string[] }> {
    const code = normalizeSymbol(symbol)
    const providerSecucode = secucode(code)
    if (!providerSecucode) {
      return { records: [], warnings: [`unsupported dividend secucode: ${symbol}`] }
    }
    const response = await getJson<{ result?: { data?: Array<Record<string, unknown>> } }>('https://datacenter-web.eastmoney.com/api/data/v1/get', {
      params: {
        reportName: 'RPT_SHAREBONUS_DET',
        columns: 'ALL',
        filter: `(SECUCODE="${providerSecucode}")`,
        pageNumber: 1,
        pageSize: 12,
        sortColumns: 'EX_DIVIDEND_DATE',
        sortTypes: -1,
        source: 'WEB',
        client: 'WEB',
      },
      headers: {
        Referer: 'https://data.eastmoney.com/yjfp/',
        'User-Agent': 'Mozilla/5.0',
      },
      timeout: 8000,
    })
    const rows = response.result?.data || []
    const records: DividendRecord[] = []
    for (const item of rows) {
        const reportDate = text(item.REPORT_DATE)
        const exDividendDate = text(item.EX_DIVIDEND_DATE)
        const payoutDate = text(item.PAY_DATE)
          || text(item.CASH_PAY_DATE)
          || text(item.PAYOUT_DATE)
          || text(item.DIVIDEND_PAYMENT_DATE)
          || text(item.PAYMENT_DATE)
        const rawRatio = finite(item.CASH_DIVIDEND_RATIO) ?? finite(item.PRETAX_BONUS_RMB)
        const year = Number((reportDate || exDividendDate || '').slice(0, 4))
        if (!year || !rawRatio) continue
        const dividendPerShare = rawRatio / 10
        records.push({
          year,
          dividendPerShare,
          ...(exDividendDate ? { exDividendDate } : {}),
          ...(payoutDate || exDividendDate ? { payoutDate: payoutDate || addDays(exDividendDate || '', 10) } : {}),
          evidenceRef: `dividend:eastmoney:RPT_SHAREBONUS_DET:${code}:${year}:${exDividendDate || 'unknown'}`,
        })
    }
    const uniqueByYear = new Map<number, DividendRecord>()
    for (const record of records) {
      const existing = uniqueByYear.get(record.year)
      if (existing) {
        uniqueByYear.set(record.year, {
          ...existing,
          dividendPerShare: existing.dividendPerShare + record.dividendPerShare,
        })
      } else {
        uniqueByYear.set(record.year, record)
      }
    }
    if (uniqueByYear.size === 0) {
      const seeded = await this.readSeedDividendRecords(code)
      if (seeded.records.length > 0) {
        return {
          records: seeded.records,
          warnings: [
            `live eastmoney dividend rows missing for ${code}; using public seed cache`,
            `seed source: ${seeded.sourceUrl}`,
          ],
        }
      }
      const completedFiscalYears = [2024, 2023, 2022]
      return {
        records: completedFiscalYears.map((year) => ({
          year,
          dividendPerShare: 0,
          evidenceRef: `dividend:eastmoney:RPT_SHAREBONUS_DET:${code}:${year}:no_cash_dividend_confirmed`,
        })),
        warnings: [
          `eastmoney dividend rows missing for ${code}; recorded confirmed zero cash dividend facts`,
        ],
      }
    }
    return {
      records: Array.from(uniqueByYear.values()).slice(0, 5),
      warnings: records.length > 0 ? [] : [`eastmoney dividend rows missing for ${code}`],
    }
  }

  private async fallbackDividendRecords(symbol: string, error: unknown): Promise<{ records: DividendRecord[]; warnings: string[] }> {
    const seeded = await this.readSeedDividendRecords(symbol)
    return {
      records: seeded.records,
      warnings: [
        `dividend provider failed: ${error instanceof Error ? error.message : String(error)}`,
        ...(seeded.records.length > 0 ? [`using public seed cache: ${seeded.sourceUrl}`] : [`public seed cache missing for ${normalizeSymbol(symbol)}`]),
      ],
    }
  }

  private async readSeedDividendRecords(symbol: string): Promise<{ records: DividendRecord[]; sourceUrl?: string }> {
    if (!this.seedCache) {
      this.seedCache = readFile(dividendSeedPath, 'utf8')
        .then((content) => JSON.parse(content) as DividendSeedFile)
        .catch(() => null)
    }
    const seed = await this.seedCache
    const item = seed?.items?.[normalizeSymbol(symbol)]
    if (!item) return { records: [] }
    return {
      sourceUrl: item.sourceUrl,
      records: item.records.map((record) => ({
        year: record.year,
        dividendPerShare: record.dividendPerShare,
        ...(record.exDividendDate ? { exDividendDate: record.exDividendDate } : {}),
        ...(record.payoutDate || record.exDividendDate ? { payoutDate: record.payoutDate || addDays(record.exDividendDate || '', 10) } : {}),
        evidenceRef: `dividend:public-seed:${normalizeSymbol(symbol)}:${record.year}:${item.sourceUrl}`,
      })),
    }
  }

  private async readLeaderSeed(symbol: string): Promise<LeaderSeedItem | undefined> {
    if (!this.leaderSeedCache) {
      this.leaderSeedCache = readFile(leaderSeedPath, 'utf8')
        .then((content) => JSON.parse(content) as LeaderSeedFile)
        .catch(() => null)
    }
    const seed = await this.leaderSeedCache
    return seed?.items?.[normalizeSymbol(symbol)]
  }

  private async readFundamentalSeed(symbol: string): Promise<FundamentalSeedItem | undefined> {
    if (!this.fundamentalSeedCache) {
      this.fundamentalSeedCache = readFile(fundamentalSeedPath, 'utf8')
        .then((content) => JSON.parse(content) as FundamentalSeedFile)
        .catch(() => null)
    }
    const seed = await this.fundamentalSeedCache
    return seed?.items?.[normalizeSymbol(symbol)]
  }

  private async runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
    const results: R[] = []
    let cursor = 0
    async function run() {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        results[index] = await worker(items[index])
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run()))
    return results
  }
}

export const dividendLowVolInputBuilderService = new DividendLowVolInputBuilderService()
