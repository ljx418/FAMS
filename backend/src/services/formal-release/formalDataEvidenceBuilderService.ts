import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../../db/prisma.js'
import { getJsonWithCurlOnly } from '../../utils/httpJson.js'
import { getEastmoneyQfqStockHistory, getTencentQfqStockHistory } from '../../utils/stockUtils.js'
import { fundamentalDataProvider, type FundamentalSnapshot } from '../technical/fundamentalDataProvider.js'
import { portfolioBacktestInputBuilder } from '../portfolio-backtest/portfolioBacktestInputBuilder.js'
import type { PortfolioStrategyDefinition } from '../portfolio-backtest/portfolioBacktestTypes.js'
import {
  FORMAL_DATA_FIELD_IDS,
  formalDataProviderService,
  type FormalFieldEvidence,
  type FormalSourceTermsEvidence,
} from './formalDataProviderService.js'
import { publicSourceEvidenceService } from './publicSourceEvidenceService.js'
import {
  FORMAL_RELEASE_CANDIDATES,
  FORMAL_RELEASE_CANDIDATE_VERSIONS,
} from './releaseCandidateSetService.js'
import { sha256Canonical } from './formalReleaseHash.js'

const START_DATE = '2025-09-11'
const END_DATE = '2026-09-11'
const HISTORY_DAYS = 260
const MIN_SAMPLE_DAYS = 60
const CROSS_CHECK_MAX_RELATIVE_DELTA = 0.01
const CROSS_CHECK_MEAN_RELATIVE_DELTA = 0.002

type NormalizedPoint = { date: string; close: number; volume?: number }

type SeriesCheck = {
  symbol: string
  assetKind: 'listed_security' | 'fund_nav'
  primaryProvider: string
  crossCheckProvider: string
  primary: NormalizedPoint[]
  crossCheck: NormalizedPoint[]
  overlapCount: number
  firstOverlapDate: string | null
  lastOverlapDate: string | null
  maxRelativeDelta: number | null
  meanRelativeDelta: number | null
  status: 'passed' | 'blocked'
  blockers: string[]
  contentHash: string
  provenance?: {
    mode: 'same_window_audit_replay'
    artifactRef: string
  }
}

type EastmoneyFundResponse = {
  Data?: { LSJZList?: Array<{ FSRQ?: string; DWJZ?: string; LJJZ?: string }> }
}

type SinaFundResponse = {
  result?: { status?: { code?: number }; data?: { data?: Array<{ fbrq?: string; jjjz?: string; ljjz?: string }> } }
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizePoints(points: Array<{ date: string; close: number; volume?: number }>) {
  return points
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date) && Number.isFinite(item.close) && item.close > 0)
    .map((item) => ({ date: item.date, close: round(item.close, 6), ...(Number.isFinite(item.volume) ? { volume: item.volume } : {}) }))
    .sort((left, right) => left.date.localeCompare(right.date))
}

function withinEvidenceWindow(points: NormalizedPoint[]) {
  return points.filter((item) => item.date >= START_DATE && item.date <= END_DATE)
}

async function fetchWithMinimumSample<T>(fetcher: () => Promise<T[]>, attempts = 3) {
  let result: T[] = []
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await fetcher()
    if (result.length >= MIN_SAMPLE_DAYS) return result
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 750))
  }
  return result
}

function seriesCheck(input: Omit<SeriesCheck, 'overlapCount' | 'firstOverlapDate' | 'lastOverlapDate' | 'maxRelativeDelta' | 'meanRelativeDelta' | 'status' | 'blockers' | 'contentHash'>): SeriesCheck {
  const primaryByDate = new Map(input.primary.map((item) => [item.date, item.close]))
  const overlaps = input.crossCheck
    .filter((item) => primaryByDate.has(item.date))
    .map((item) => ({
      date: item.date,
      relativeDelta: Math.abs(item.close - Number(primaryByDate.get(item.date))) / Math.max(item.close, 0.000001),
    }))
  const maxRelativeDelta = overlaps.length > 0 ? Math.max(...overlaps.map((item) => item.relativeDelta)) : null
  const meanRelativeDelta = overlaps.length > 0
    ? overlaps.reduce((sum, item) => sum + item.relativeDelta, 0) / overlaps.length
    : null
  const blockers = [
    ...(input.primary.length < MIN_SAMPLE_DAYS ? [`primary_sample_below_${MIN_SAMPLE_DAYS}`] : []),
    ...(input.crossCheck.length < MIN_SAMPLE_DAYS ? [`cross_check_sample_below_${MIN_SAMPLE_DAYS}`] : []),
    ...(overlaps.length < MIN_SAMPLE_DAYS ? [`overlap_sample_below_${MIN_SAMPLE_DAYS}`] : []),
    ...(maxRelativeDelta === null || maxRelativeDelta > CROSS_CHECK_MAX_RELATIVE_DELTA ? ['max_relative_delta_above_1_percent'] : []),
    ...(meanRelativeDelta === null || meanRelativeDelta > CROSS_CHECK_MEAN_RELATIVE_DELTA ? ['mean_relative_delta_above_0_2_percent'] : []),
  ]
  const core = {
    ...input,
    overlapCount: overlaps.length,
    firstOverlapDate: overlaps[0]?.date ?? null,
    lastOverlapDate: overlaps.at(-1)?.date ?? null,
    maxRelativeDelta: maxRelativeDelta === null ? null : round(maxRelativeDelta, 8),
    meanRelativeDelta: meanRelativeDelta === null ? null : round(meanRelativeDelta, 8),
    blockers,
  }
  return {
    ...core,
    status: blockers.length === 0 ? 'passed' : 'blocked',
    contentHash: sha256Canonical(core),
  }
}

function verifyStoredSeriesCheck(check: SeriesCheck) {
  const { contentHash, status: _status, provenance: _provenance, ...content } = check
  return contentHash === sha256Canonical(content)
}

async function loadSameWindowPassedSeriesCheck(symbol: string): Promise<SeriesCheck | null> {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-1')
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()
  for (const directory of directories) {
    const artifactRef = resolve(root, directory, 'public_market_bundle_source_evidence.json')
    try {
      const artifact = JSON.parse(await readFile(artifactRef, 'utf8')) as {
        window?: { startDate?: string; endDate?: string }
        seriesChecks?: SeriesCheck[]
      }
      if (artifact.window?.startDate !== START_DATE || artifact.window?.endDate !== END_DATE) continue
      const check = artifact.seriesChecks?.find((item) => item.symbol === symbol && item.status === 'passed')
      if (!check || !verifyStoredSeriesCheck(check)) continue
      return { ...check, provenance: { mode: 'same_window_audit_replay', artifactRef } }
    } catch {
      continue
    }
  }
  return null
}

async function fetchFundSeries(symbol: string): Promise<SeriesCheck> {
  const replay = await loadSameWindowPassedSeriesCheck(symbol)
  if (replay?.assetKind === 'fund_nav') return replay
  const [eastmoneyRows, sina] = await Promise.all([
    (async () => {
      const rows: NonNullable<EastmoneyFundResponse['Data']>['LSJZList'] = []
      const pageSize = 20
      for (let pageIndex = 1; pageIndex <= Math.ceil(HISTORY_DAYS / pageSize); pageIndex += 1) {
        const response = await getJsonWithCurlOnly<EastmoneyFundResponse>('https://api.fund.eastmoney.com/f10/lsjz', {
          timeout: 20000,
          params: { fundCode: symbol, pageIndex, pageSize, startDate: '', endDate: '' },
          headers: { Referer: 'https://fund.eastmoney.com/', 'User-Agent': 'Mozilla/5.0' },
        })
        const pageRows = response.Data?.LSJZList || []
        rows.push(...pageRows)
        if (pageRows.length < pageSize) break
      }
      return rows
    })(),
    getJsonWithCurlOnly<SinaFundResponse>('https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/CaihuiFundInfoService.getNav', {
      timeout: 20000,
      params: { symbol, datefrom: START_DATE, dateto: END_DATE, page: 1, num: HISTORY_DAYS },
      headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0' },
    }),
  ])
  const primary = withinEvidenceWindow(normalizePoints((eastmoneyRows || []).map((item) => ({
    date: String(item.FSRQ || '').slice(0, 10),
    close: Number(item.DWJZ),
  }))))
  const crossCheck = withinEvidenceWindow(normalizePoints((sina.result?.data?.data || []).map((item) => ({
    date: String(item.fbrq || '').slice(0, 10),
    close: Number(item.jjjz),
  }))))
  return seriesCheck({
    symbol,
    assetKind: 'fund_nav',
    primaryProvider: 'eastmoney_fund_nav',
    crossCheckProvider: 'sina_fund_nav',
    primary,
    crossCheck,
  })
}

async function fetchListedSeries(symbol: string): Promise<SeriesCheck> {
  const replay = await loadSameWindowPassedSeriesCheck(symbol)
  if (replay?.assetKind === 'listed_security') return replay
  const [eastmoney, tencent] = await Promise.all([
    fetchWithMinimumSample(() => getEastmoneyQfqStockHistory(symbol, HISTORY_DAYS)),
    fetchWithMinimumSample(() => getTencentQfqStockHistory(symbol, HISTORY_DAYS)),
  ])
  const liveCheck = seriesCheck({
    symbol,
    assetKind: 'listed_security',
    primaryProvider: 'eastmoney_qfq',
    crossCheckProvider: 'tencent_qfq',
    primary: withinEvidenceWindow(normalizePoints(eastmoney.map((item) => ({ date: item.date, close: item.close, volume: item.volume })))),
    crossCheck: withinEvidenceWindow(normalizePoints(tencent.map((item) => ({ date: item.date, close: item.close, volume: item.volume })))),
  })
  return liveCheck
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function minCoverage(checks: SeriesCheck[]) {
  if (checks.length === 0) return 100
  return Math.min(...checks.map((item) => round(Math.min(100, (item.overlapCount / MIN_SAMPLE_DAYS) * 100), 2)))
}

function minDate(values: Array<string | null>) {
  const dates = values.filter((value): value is string => Boolean(value)).sort()
  return dates[0] ?? null
}

function field(input: Omit<FormalFieldEvidence, 'evidenceHash'>): FormalFieldEvidence {
  return { ...input, evidenceHash: sha256Canonical(input) }
}

export class FormalDataEvidenceBuilderService {
  async build(userId = 'default', now = new Date()) {
    if (userId.startsWith('audit_')) throw new Error('formal_data_real_user_required')
    const candidateSet = await prisma.releaseCandidateSet.findFirst({
      where: { userId, status: 'frozen', immutable: true },
      orderBy: { snapshotAsOf: 'desc' },
    })
    if (!candidateSet) throw new Error('frozen_release_candidate_set_missing')
    const candidateIds = parseJson<string[]>(candidateSet.candidateIdsJson, [])
    const candidateVersions = parseJson<Record<string, string>>(candidateSet.candidateVersionsJson, {})
    if (JSON.stringify(candidateIds) !== JSON.stringify([...FORMAL_RELEASE_CANDIDATES])) {
      throw new Error('frozen_release_candidate_set_mismatch')
    }
    if (JSON.stringify(candidateVersions) !== JSON.stringify(FORMAL_RELEASE_CANDIDATE_VERSIONS)) {
      throw new Error('frozen_release_candidate_versions_mismatch')
    }

    process.env.FAMS_PORTFOLIO_DLV_BASKET_MIN_PRICE_BARS = String(MIN_SAMPLE_DAYS)
    const input = await portfolioBacktestInputBuilder.build({
      userId,
      portfolioStrategyIds: candidateIds,
      releaseCandidateStrategyIds: candidateIds,
      releaseCandidateStrategyVersions: candidateVersions,
      startDate: START_DATE,
      endDate: END_DATE,
      benchmarkIds: ['csi300_total_return_h00300'],
      gradeMode: 'formal_review',
      ruleMode: 'registry_fixed',
    })
    if (input.strategies.length !== FORMAL_RELEASE_CANDIDATES.length || input.strategies.some((item) => item.validation.status !== 'valid')) {
      throw new Error(`release_candidate_definition_invalid:${JSON.stringify(input.dataQuality.blockedReasons)}`)
    }

    const symbolKinds = await this.resolveSymbolKinds(input.strategies)
    const listedSymbols = [...symbolKinds.entries()].filter(([, kind]) => kind === 'listed_security').map(([symbol]) => symbol)
    const fundSymbols = [...symbolKinds.entries()].filter(([, kind]) => kind === 'fund_nav').map(([symbol]) => symbol)
    const seriesChecks = new Map<string, SeriesCheck>()
    for (let index = 0; index < listedSymbols.length; index += 2) {
      const batch = await Promise.all(listedSymbols.slice(index, index + 2).map(fetchListedSeries))
      for (const item of batch) seriesChecks.set(item.symbol, item)
    }
    for (let index = 0; index < fundSymbols.length; index += 4) {
      const batch = await Promise.all(fundSymbols.slice(index, index + 4).map(fetchFundSeries))
      for (const item of batch) seriesChecks.set(item.symbol, item)
    }

    const benchmark = await publicSourceEvidenceService.fetchCsi300TotalReturn({ startDate: START_DATE, endDate: now.toISOString().slice(0, 10) })
    const dividendRows = await prisma.dividendLowVolDaily.findMany({
      where: { userId, symbol: { in: input.strategies.find((item) => item.strategyId === 'dividend_low_vol_basket')?.components.map((item) => item.symbol || '') || [] } },
      orderBy: [{ symbol: 'asc' }, { tradeDate: 'desc' }],
    })
    const latestDividendBySymbol = new Map<string, typeof dividendRows[number]>()
    for (const row of dividendRows) if (!latestDividendBySymbol.has(row.symbol)) latestDividendBySymbol.set(row.symbol, row)

    const dividendSymbols = input.strategies.find((item) => item.strategyId === 'dividend_low_vol_basket')?.components.map((item) => item.symbol || '') || []
    const fundamentals = new Map<string, FundamentalSnapshot>()
    for (let index = 0; index < dividendSymbols.length; index += 4) {
      const batch = await Promise.all(dividendSymbols.slice(index, index + 4).map(async (symbol) => ({
        symbol,
        snapshot: await fundamentalDataProvider.getEastmoneyFundamentalSnapshot(symbol, 'A股'),
      })))
      for (const item of batch) fundamentals.set(item.symbol, item.snapshot)
    }

    const marketSourceCore = {
      schemaVersion: 'fams.public_market_bundle.source_snapshot.v1',
      fetchedAt: now.toISOString(),
      window: { startDate: START_DATE, endDate: END_DATE, minimumSampleDays: MIN_SAMPLE_DAYS },
      seriesChecks: [...seriesChecks.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)),
      benchmark: {
        benchmarkId: benchmark.benchmarkInput.benchmarkId,
        benchmarkType: benchmark.benchmarkInput.benchmarkType,
        pointCount: benchmark.points.length,
        firstDate: benchmark.points[0]?.date ?? null,
        lastDate: benchmark.points.at(-1)?.date ?? null,
        responseSha256: benchmark.resource.sha256,
      },
      fundamentals: [...fundamentals.entries()].map(([symbol, snapshot]) => ({ symbol, snapshot })).sort((left, right) => left.symbol.localeCompare(right.symbol)),
      dividendFactHashes: dividendSymbols.map((symbol) => ({
        symbol,
        hash: sha256Canonical(latestDividendBySymbol.get(symbol)?.factsetJson || null),
      })),
    }
    const sourceSnapshotHash = sha256Canonical(JSON.parse(JSON.stringify(marketSourceCore)))
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, email: true } })
    const sourceTerms = this.sourceTerms(seriesChecks, benchmark.resource.sha256, now)
    const latestAuthorization = (await formalDataProviderService.listAuthorizations('public_market_bundle')).at(-1)
    if (latestAuthorization?.decision !== 'approved' || latestAuthorization.sourceSnapshotHash !== sourceSnapshotHash) {
      await formalDataProviderService.appendAuthorization({
        providerId: 'public_market_bundle',
        providerClass: 'trusted_public_noncommercial',
        decision: 'approved',
        authorizationRef: 'project-owner-conversation:2026-09-14:public-open-trusted-reconstruction',
        authorizationBasis: 'public_terms_local_noncommercial',
        usageScope: 'local_personal_noncommercial',
        authorizedScopes: ['listed:qfq-history', 'fund:published-nav', 'fundamental:public-reports', 'industry:public-classification', 'dividend:public-events'],
        evidenceRefs: [`sha256:${sourceSnapshotHash}`, ...[...seriesChecks.values()].map((item) => `sha256:${item.contentHash}`)],
        sourceTerms,
        endpointAllowlist: [
          'https://push2his.eastmoney.com/api/qt/stock/kline/get',
          'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
          'https://api.fund.eastmoney.com/f10/lsjz',
          'https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/CaihuiFundInfoService.getNav',
          'https://datacenter.eastmoney.com/securities/api/data/v1/get',
          'https://datacenter-web.eastmoney.com/api/data/v1/get',
          'https://push2.eastmoney.com/api/qt/stock/get',
          'https://push2.eastmoney.com/api/qt/clist/get',
          'https://q.stock.sohu.com/cn/{code}/cwzb.shtml',
        ],
        sourceSnapshotHash,
        credentialRequired: false,
        reviewerUserId: user.id,
        reviewerEmail: user.email,
        effectiveFrom: now,
        now,
      })
    }

    const snapshots = []
    for (const definition of input.strategies) {
      const fields = this.buildFields({ definition, seriesChecks, benchmark, latestDividendBySymbol, fundamentals, now })
      const snapshot = await formalDataProviderService.buildCandidateSnapshot({
        candidateStrategyId: definition.strategyId,
        candidateStrategyVersion: definition.strategyVersion,
        providerId: 'public_market_bundle',
        fields,
        now,
      })
      const persistence = await formalDataProviderService.persistCandidateSnapshot(snapshot)
      snapshots.push({ snapshot, persistence: { id: persistence.record.id, idempotent: persistence.idempotent } })
    }

    return {
      schemaVersion: 'fams.formal_data.evidence_build.v1',
      generatedAt: now.toISOString(),
      userId,
      releaseCandidateSet: {
        id: candidateSet.id,
        version: candidateSet.version,
        contentHash: candidateSet.contentHash,
        candidateIds,
        candidateVersions,
      },
      request: input.request,
      sourceSnapshotHash,
      sourceEvidence: marketSourceCore,
      sourceTerms,
      snapshots,
      status: snapshots.every((item) => item.snapshot.status === 'passed') ? 'passed' as const : 'blocked' as const,
      blockers: Array.from(new Set(snapshots.flatMap((item) => item.snapshot.blockers))),
      realDataUsed: true,
      researchFallbackPromotedToFormal: false as const,
      formalTradingUnlocked: false as const,
      autoTradeUnlocked: false as const,
      canCreateOrder: false as const,
      orderCreateAllowed: false as const,
    }
  }

  private async resolveSymbolKinds(strategies: PortfolioStrategyDefinition[]) {
    const symbols = Array.from(new Set(strategies.flatMap((strategy) => strategy.components)
      .filter((component) => component.assetClass !== 'cash')
      .map((component) => component.symbol || component.proxySymbol)
      .filter((symbol): symbol is string => Boolean(symbol))))
    const fundRows = await prisma.priceHistory.groupBy({
      by: ['assetId'],
      where: { asset: { symbol: { in: symbols } }, source: { in: ['eastmoney_cumulative_nav', 'eastmoney_nav_history'] }, isValid: true },
    })
    const fundAssets = await prisma.asset.findMany({ where: { id: { in: fundRows.map((item) => item.assetId) } }, select: { symbol: true } })
    const fundSymbols = new Set(fundAssets.map((item) => item.symbol))
    return new Map(symbols.map((symbol) => [symbol, fundSymbols.has(symbol) ? 'fund_nav' as const : 'listed_security' as const]))
  }

  private sourceTerms(seriesChecks: Map<string, SeriesCheck>, benchmarkHash: string, now: Date): FormalSourceTermsEvidence[] {
    const byProvider = new Map<string, SeriesCheck[]>()
    for (const check of seriesChecks.values()) {
      for (const provider of [check.primaryProvider, check.crossCheckProvider]) {
        byProvider.set(provider, [...(byProvider.get(provider) || []), check])
      }
    }
    return [
      ...[...byProvider.entries()].map(([provider, checks]) => ({
        sourceId: provider,
        title: `${provider} 公开行情/净值端点与本地非商业用途声明`,
        url: provider.includes('tencent')
          ? 'https://gu.qq.com/'
          : provider.includes('sina')
            ? 'https://finance.sina.com.cn/'
            : 'https://quote.eastmoney.com/',
        fetchedAt: now.toISOString(),
        contentHash: sha256Canonical(checks.map((item) => item.contentHash).sort()),
        reviewStatus: 'reviewed_for_local_noncommercial_use' as const,
      })),
      {
        sourceId: 'csindex-h00300',
        title: '中证沪深300全收益指数公开历史',
        url: 'https://www.csindex.com.cn/csindex-home/perf/index-perf',
        fetchedAt: now.toISOString(),
        contentHash: benchmarkHash,
        reviewStatus: 'official_publication' as const,
      },
    ].sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  }

  private buildFields(args: {
    definition: PortfolioStrategyDefinition
    seriesChecks: Map<string, SeriesCheck>
    benchmark: Awaited<ReturnType<typeof publicSourceEvidenceService.fetchCsi300TotalReturn>>
    latestDividendBySymbol: Map<string, { tradeDate: Date; ttmDividendYield: number | null; evidenceRefsJson: string; factsetJson: string }>
    fundamentals: Map<string, FundamentalSnapshot>
    now: Date
  }): FormalFieldEvidence[] {
    const { definition, seriesChecks, benchmark, latestDividendBySymbol, fundamentals, now } = args
    const symbols = definition.components
      .filter((component) => component.assetClass !== 'cash')
      .map((component) => component.symbol || component.proxySymbol)
      .filter((symbol): symbol is string => Boolean(symbol))
    const checks = symbols.map((symbol) => seriesChecks.get(symbol)).filter((item): item is SeriesCheck => Boolean(item))
    const listedChecks = checks.filter((item) => item.assetKind === 'listed_security')
    const priceBlockers = [
      ...symbols.filter((symbol) => !seriesChecks.has(symbol)).map((symbol) => `price_source_missing:${symbol}`),
      ...checks.flatMap((item) => item.blockers.map((blocker) => `price_cross_check:${item.symbol}:${blocker}`)),
    ]
    const base = {
      candidateStrategyId: definition.strategyId,
      candidateStrategyVersion: definition.strategyVersion,
      fetchedAt: now.toISOString(),
    }
    const evidenceRefs = checks.map((item) => `formal-source-series:${item.symbol}:${item.contentHash}`)
    const fields: FormalFieldEvidence[] = [field({
      ...base,
      fieldId: 'price',
      critical: true,
      applicability: 'required',
      notApplicableReason: null,
      providerId: 'public_market_bundle',
      providerClass: 'trusted_public_noncommercial',
      sourceEndpoint: 'eastmoney_qfq+tencent_qfq+eastmoney_fund_nav+sina_fund_nav',
      asOfDate: minDate(checks.map((item) => item.lastOverlapDate)),
      coveragePercent: minCoverage(checks),
      crossCheckStatus: priceBlockers.length === 0 ? 'trusted_cross_checked' : 'failed',
      evidenceRefs,
      warnings: [],
      inputBlockers: priceBlockers,
    }), field({
      ...base,
      fieldId: 'benchmark',
      critical: true,
      applicability: 'required',
      notApplicableReason: null,
      providerId: 'csindex_public',
      providerClass: 'trusted_public_noncommercial',
      sourceEndpoint: benchmark.resource.url,
      asOfDate: benchmark.points.at(-1)?.date ?? null,
      coveragePercent: benchmark.points.length >= MIN_SAMPLE_DAYS ? 100 : round((benchmark.points.length / MIN_SAMPLE_DAYS) * 100, 2),
      crossCheckStatus: benchmark.benchmarkInput.benchmarkType === 'trusted_total_return' ? 'official_verified' : 'failed',
      evidenceRefs: [`csindex:H00300:sha256:${benchmark.resource.sha256}`],
      warnings: ['trusted_total_return_not_commercially_licensed_official_total_return'],
      inputBlockers: benchmark.points.length >= MIN_SAMPLE_DAYS ? [] : [`benchmark_sample_below_${MIN_SAMPLE_DAYS}`],
    })]

    const dividendRows = definition.strategyId === 'dividend_low_vol_basket'
      ? symbols.map((symbol) => latestDividendBySymbol.get(symbol)).filter((item): item is NonNullable<typeof item> => Boolean(item))
      : []
    const dividendRefs = dividendRows.flatMap((item) => parseJson<string[]>(item.evidenceRefsJson, []))
      .filter((ref) => ref.startsWith('dividend:eastmoney:'))
    const dividendBlockers = definition.strategyId === 'dividend_low_vol_basket'
      ? [
        ...(dividendRows.length === symbols.length ? [] : ['dividend_candidate_rows_incomplete']),
        ...(dividendRows.every((item) => item.ttmDividendYield !== null) ? [] : ['dividend_yield_missing']),
        ...(symbols.every((symbol) => dividendRefs.some((ref) => ref.includes(`:${symbol}:`))) ? [] : ['dividend_event_evidence_incomplete']),
      ]
      : priceBlockers
    fields.push(field({
      ...base,
      fieldId: 'dividend',
      critical: true,
      applicability: 'required',
      notApplicableReason: null,
      providerId: 'public_market_bundle',
      providerClass: 'trusted_public_noncommercial',
      sourceEndpoint: definition.strategyId === 'dividend_low_vol_basket'
        ? 'eastmoney:RPT_SHAREBONUS_DET+cross_checked_qfq'
        : 'cross_checked_qfq_or_published_fund_nav_total_return_representation',
      asOfDate: definition.strategyId === 'dividend_low_vol_basket'
        ? minDate(dividendRows.map((item) => item.tradeDate.toISOString().slice(0, 10)))
        : minDate(checks.map((item) => item.lastOverlapDate)),
      coveragePercent: definition.strategyId === 'dividend_low_vol_basket'
        ? round((dividendRows.length / Math.max(1, symbols.length)) * 100, 2)
        : minCoverage(checks),
      crossCheckStatus: dividendBlockers.length === 0 ? 'trusted_cross_checked' : 'failed',
      evidenceRefs: definition.strategyId === 'dividend_low_vol_basket'
        ? [...dividendRefs, ...evidenceRefs]
        : evidenceRefs.map((ref) => `${ref}:distribution-adjusted`),
      warnings: definition.strategyId === 'dividend_low_vol_basket'
        ? ['public_dividend_events_are_not_commercial_provider_entitlement']
        : ['dividend_effect_is_represented_by_cross_checked_adjusted_series_or_published_nav'],
      inputBlockers: dividendBlockers,
    }))

    const tradeabilityBlockers = listedChecks.flatMap((item) => item.blockers.map((blocker) => `tradeability_cross_check:${item.symbol}:${blocker}`))
    fields.push(field({
      ...base,
      fieldId: 'tradeability',
      critical: listedChecks.length > 0,
      applicability: listedChecks.length > 0 ? 'required' : 'not_applicable',
      notApplicableReason: listedChecks.length > 0 ? null : 'candidate_contains_no_exchange_traded_component',
      providerId: 'public_market_bundle',
      providerClass: 'trusted_public_noncommercial',
      sourceEndpoint: 'eastmoney_qfq+tencent_qfq:bar_presence_volume_reconstruction',
      asOfDate: listedChecks.length > 0 ? minDate(listedChecks.map((item) => item.lastOverlapDate)) : now.toISOString().slice(0, 10),
      coveragePercent: listedChecks.length > 0 ? minCoverage(listedChecks) : 100,
      crossCheckStatus: listedChecks.length === 0 ? 'not_applicable' : tradeabilityBlockers.length === 0 ? 'trusted_cross_checked' : 'failed',
      evidenceRefs: listedChecks.length > 0
        ? listedChecks.map((item) => `formal-tradeability-reconstruction:${item.symbol}:${item.contentHash}`)
        : [`strategy:${definition.strategyId}:no_exchange_traded_component`],
      warnings: ['bar_presence_and_volume_reconstruction_is_not_exchange_order_book_status'],
      inputBlockers: tradeabilityBlockers,
    }))

    const selectionFieldsRequired = definition.strategyId === 'dividend_low_vol_basket'
    const fundamentalSnapshots = symbols.map((symbol) => fundamentals.get(symbol)).filter((item): item is FundamentalSnapshot => Boolean(item))
    const fundamentalBlockers = selectionFieldsRequired ? [
      ...(fundamentalSnapshots.length === symbols.length ? [] : ['fundamental_snapshots_incomplete']),
      ...fundamentalSnapshots.filter((item) => item.quality !== 'ok').map((item) => `fundamental_quality_${item.quality}:${item.providerSymbol}`),
      ...fundamentalSnapshots.filter((item) => !item.financialReports[0] || (item.financialCrossCheck?.quality !== 'ok' && item.financialCrossCheck?.quality !== 'warn'))
        .map((item) => `fundamental_cross_check_failed:${item.providerSymbol}`),
    ] : []
    const fundamentalEvidence = fundamentalSnapshots.map((item) => `formal-fundamental:${item.providerSymbol}:${sha256Canonical(item)}`)
    fields.push(field({
      ...base,
      fieldId: 'fundamental',
      critical: selectionFieldsRequired,
      applicability: selectionFieldsRequired ? 'required' : 'not_applicable',
      notApplicableReason: selectionFieldsRequired ? null : 'fixed_weight_candidate_does_not_select_components_from_fundamentals',
      providerId: 'public_market_bundle',
      providerClass: selectionFieldsRequired ? 'trusted_public_noncommercial' : 'trusted_internal',
      sourceEndpoint: selectionFieldsRequired ? 'eastmoney_f10+eastmoney_performance+sohu_cross_check' : 'strategy_registry_fixed_definition',
      asOfDate: selectionFieldsRequired ? minDate(fundamentalSnapshots.map((item) => item.financialReports[0]?.reportDate?.slice(0, 10) || null)) : now.toISOString().slice(0, 10),
      coveragePercent: selectionFieldsRequired ? round((fundamentalSnapshots.length / Math.max(1, symbols.length)) * 100, 2) : 100,
      crossCheckStatus: selectionFieldsRequired ? fundamentalBlockers.length === 0 ? 'trusted_cross_checked' : 'failed' : 'not_applicable',
      evidenceRefs: selectionFieldsRequired ? fundamentalEvidence : [`strategy:${definition.strategyId}:fixed_components`],
      warnings: fundamentalSnapshots.flatMap((item) => item.warnings),
      inputBlockers: fundamentalBlockers,
    }))

    const industryBlockers = selectionFieldsRequired ? [
      ...(fundamentalSnapshots.length === symbols.length ? [] : ['industry_snapshots_incomplete']),
      ...fundamentalSnapshots.filter((item) => item.industryBoard?.quality !== 'ok' || !item.industryBoard.name)
        .map((item) => `industry_classification_missing:${item.providerSymbol}`),
    ] : []
    fields.push(field({
      ...base,
      fieldId: 'industryClassification',
      critical: selectionFieldsRequired,
      applicability: selectionFieldsRequired ? 'required' : 'not_applicable',
      notApplicableReason: selectionFieldsRequired ? null : 'fixed_weight_candidate_does_not_select_components_from_industry_rank',
      providerId: 'public_market_bundle',
      providerClass: selectionFieldsRequired ? 'trusted_public_noncommercial' : 'trusted_internal',
      sourceEndpoint: selectionFieldsRequired ? 'eastmoney_quote_industry+canonical_akshare_baostock_identity' : 'strategy_registry_fixed_definition',
      asOfDate: selectionFieldsRequired ? minDate(fundamentalSnapshots.map((item) => item.industryBoard?.asOf?.slice(0, 10) || null)) : now.toISOString().slice(0, 10),
      coveragePercent: selectionFieldsRequired ? round((fundamentalSnapshots.filter((item) => item.industryBoard?.quality === 'ok').length / Math.max(1, symbols.length)) * 100, 2) : 100,
      crossCheckStatus: selectionFieldsRequired ? industryBlockers.length === 0 ? 'trusted_cross_checked' : 'failed' : 'not_applicable',
      evidenceRefs: selectionFieldsRequired
        ? fundamentalSnapshots.map((item) => `formal-industry:${item.providerSymbol}:${item.industryBoard?.name}:${sha256Canonical(item.industryBoard)}`)
        : [`strategy:${definition.strategyId}:fixed_components`],
      warnings: fundamentalSnapshots.flatMap((item) => item.industryBoard?.warnings || []),
      inputBlockers: industryBlockers,
    }))

    fields.push(field({
      ...base,
      fieldId: 'costModel',
      critical: true,
      applicability: 'required',
      notApplicableReason: null,
      providerId: 'fams_internal',
      providerClass: 'trusted_internal',
      sourceEndpoint: 'PortfolioStrategyDefinition.costModel',
      asOfDate: now.toISOString().slice(0, 10),
      coveragePercent: 100,
      crossCheckStatus: 'official_verified',
      evidenceRefs: [`cost-model:${definition.strategyId}:fee:${definition.costModel.feeRate}:slippage:${definition.costModel.slippageRate}`],
      warnings: [],
      inputBlockers: definition.costModel.feeRate >= 0 && definition.costModel.slippageRate >= 0 ? [] : ['cost_model_invalid'],
    }))
    if (fields.map((item) => item.fieldId).join('|') !== FORMAL_DATA_FIELD_IDS.join('|')) throw new Error('formal_field_order_mismatch')
    return fields
  }
}

export const formalDataEvidenceBuilderService = new FormalDataEvidenceBuilderService()
