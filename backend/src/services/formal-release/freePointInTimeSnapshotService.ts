import { createHash } from 'node:crypto'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dividendLowVolStrategyService } from '../dividend-low-vol/dividendLowVolStrategyService.js'
import type { DividendLowVolInput, DividendRecord } from '../dividend-low-vol/dividendLowVolTypes.js'

type Json = Record<string, any>

type RawDataset = {
  path: string
  sha256: string
  reportPeriod: string
  rows: Json[]
}

type SecurityDescriptor = {
  symbol: string
  name: string
  industry?: string
  ipoDate: string
  outDate?: string
  performance?: Json
  performanceSource?: RawDataset
  income?: Json
  incomeSource?: RawDataset
  cashflow?: Json
  cashflowSource?: RawDataset
  balance?: Json
  balanceSource?: RawDataset
  growth?: Json
  growthSource?: RawDataset
  dividendRows: Array<{ row: Json; source: RawDataset }>
}

export type FreePointInTimeDecisionPoint = {
  windowId: string
  decisionDate: string
  referenceUniverseCount: number
  minimumRequiredSymbols: number
  historicalUniverseResolved: boolean
  marketBarSymbolCount: number
  marketBarCoveragePercent: number
  tradeabilitySymbolCount: number
  tradeabilityCoveragePercent: number
  historicalSecurityStatusSymbolCount: number
  historicalSecurityStatusCoveragePercent: number
  announcementAwareFundamentalSymbolCount: number
  announcementAwareFundamentalCoveragePercent: number
  candidateEvaluationSnapshotSymbolCount: number
  candidateEvaluationSnapshotCoveragePercent: number
  eligibleResearchCandidateCount: number
  dataInsufficientCandidateCount: number
  failedPriceShardCount: number
  failedStatusShardCount: number
  statusPriceConflictCount: number
  historicalStatusEvidenceMode: 'baostock_direct_daily'
  historicalStatusProxyAllowed: false
  announcementCutoffVerified: boolean
  currentUniverseUsedAsHistoricalMembership: false
  futureAnnouncementReuseDetected: false
  providerFailuresRemainInDenominator: true
  pointInTimeSelectionReady: boolean
  snapshotPath: string
  snapshotSha256: string
  selectedSymbols: string[]
  blockers: string[]
}

const DECISION_DATES = ['2025-12-12', '2026-01-20', '2026-03-03', '2026-04-08', '2026-05-15', '2026-06-22']
const MINIMUM_COVERAGE_PERCENT = 80

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function percent(count: number, total: number) {
  return total === 0 ? 0 : Math.round((count / total) * 100_000) / 1_000
}

function isoPeriod(period: string) {
  return `${period.slice(0, 4)}-${period.slice(4, 6)}-${period.slice(6, 8)}`
}

function daysBetween(from: string, to: string) {
  return Math.max(0, Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000))
}

function announcementDate(row: Json, kind: string) {
  if (kind === 'performance') return text(row['最新公告日期'])?.slice(0, 10)
  if (kind === 'dividend') return text(row['预案公告日'])?.slice(0, 10)
  return text(row['公告日期'])?.slice(0, 10)
}

function symbolOf(row: Json, kind: string) {
  return String(kind === 'dividend' ? row['代码'] : row['股票代码'] || '').padStart(6, '0')
}

function chooseLatest(rows: Array<{ row: Json; source: RawDataset }>, kind: string, decisionDate: string) {
  return rows
    .filter(({ row, source }) => isoPeriod(source.reportPeriod) <= decisionDate && (announcementDate(row, kind) || '9999-12-31') <= decisionDate)
    .sort((left, right) => {
      const period = right.source.reportPeriod.localeCompare(left.source.reportPeriod)
      return period || String(announcementDate(right.row, kind)).localeCompare(String(announcementDate(left.row, kind)))
    })[0]
}

function percentileMap(values: Array<{ symbol: string; value: number | undefined }>) {
  const sorted = values
    .filter((item): item is { symbol: string; value: number } => item.value !== undefined && Number.isFinite(item.value))
    .sort((left, right) => left.value - right.value)
  return new Map(sorted.map((item, index) => [item.symbol, sorted.length <= 1 ? 50 : Math.round((index / (sorted.length - 1)) * 10_000) / 100]))
}

function reportAnnualizationFactor(period?: string) {
  if (!period) return undefined
  if (period.endsWith('0331')) return 4
  if (period.endsWith('0630')) return 2
  if (period.endsWith('0930')) return 4 / 3
  if (period.endsWith('1231')) return 1
  return undefined
}

export class FreePointInTimeSnapshotService {
  async build(lakeDir: string, outputDir: string) {
    const lake = resolve(lakeDir)
    const manifestPath = resolve(lake, 'lake-manifest.json')
    const manifestRaw = await readFile(manifestPath)
    const manifest = JSON.parse(manifestRaw.toString('utf8')) as Json
    if (manifest.schemaVersion !== 'fams.ftr_3r.free_source_lake.v1') throw new Error('free_source_lake_manifest_version_invalid')
    if (JSON.stringify(manifest.decisionDates) !== JSON.stringify(DECISION_DATES)) throw new Error('free_source_lake_decision_dates_mismatch')

    const fileHashes = new Map<string, string>()
    let allArtifactHashesVerified = true
    for (const entry of manifest.files as Json[]) {
      const raw = await readFile(String(entry.path))
      const actual = sha256(raw)
      if (actual !== entry.sha256) allArtifactHashesVerified = false
      fileHashes.set(resolve(String(entry.path)), actual)
    }
    if (!allArtifactHashesVerified) throw new Error('free_source_lake_hash_mismatch')

    const basicPath = resolve(lake, 'raw', 'baostock', 'stock_basic.json')
    const basic = JSON.parse((await readFile(basicPath, 'utf8'))) as Json
    if (basic.liveCall !== true || !Array.isArray(basic.rows)) throw new Error('baostock_stock_basic_invalid')
    const datasets = await this.loadDatasets(lake, fileHashes)
    const sourceRows = this.indexDatasets(datasets)
    const priceFiles = new Set(await readdir(resolve(lake, 'raw', 'prices')))
    const statusFiles = new Set(await readdir(resolve(lake, 'raw', 'status')))
    const failedPriceShardCount = Number(manifest.priceSummary?.symbolCount || 0) - Number(manifest.priceSummary?.completedShardCount || 0)
    const failedStatusShardCount = Number(manifest.statusSummary?.symbolCount || 0) - Number(manifest.statusSummary?.completedShardCount || 0)
    if (manifest.statusSummary?.evidenceMode !== 'baostock_direct_daily' || manifest.statusSummary?.historicalStatusProxyAllowed !== false) {
      throw new Error('direct_historical_status_evidence_required')
    }
    const results: FreePointInTimeDecisionPoint[] = []

    for (let index = 0; index < DECISION_DATES.length; index += 1) {
      const decisionDate = DECISION_DATES[index]
      const universeRows = (basic.rows as Json[]).filter((row) => {
        const symbol = String(row.code || '').split('.').at(-1) || ''
        const ipoDate = String(row.ipoDate || '')
        const outDate = String(row.outDate || '')
        return String(row.type) === '1' && /^\d{6}$/.test(symbol) && ipoDate !== '' && ipoDate <= decisionDate && (outDate === '' || outDate > decisionDate)
      })
      const descriptors = universeRows.map((row) => this.describeSecurity(row, sourceRows, decisionDate))
      const ranks = this.buildIndustryRanks(descriptors, lake, priceFiles, decisionDate)
      const candidates: Json[] = []
      let marketBarSymbolCount = 0
      let tradeabilitySymbolCount = 0
      let historicalSecurityStatusSymbolCount = 0
      let announcementAwareFundamentalSymbolCount = 0
      let candidateEvaluationSnapshotSymbolCount = 0
      let statusPriceConflictCount = 0

      for (const descriptor of descriptors) {
        const pricePath = resolve(lake, 'raw', 'prices', `${descriptor.symbol}.json`)
        let priceShard: Json | undefined
        if (priceFiles.has(`${descriptor.symbol}.json`)) {
          priceShard = JSON.parse((await readFile(pricePath, 'utf8'))) as Json
        }
        const rows = Array.isArray(priceShard?.rows)
          ? (priceShard!.rows as Json[]).filter((row) => String(row.date) <= decisionDate)
          : []
        const exact = rows.find((row) => String(row.date) === decisionDate)
        const statusPath = resolve(lake, 'raw', 'status', `${descriptor.symbol}.json`)
        const statusShard = statusFiles.has(`${descriptor.symbol}.json`)
          ? JSON.parse(await readFile(statusPath, 'utf8')) as Json
          : undefined
        const directStatus = Array.isArray(statusShard?.rows)
          ? (statusShard!.rows as Json[]).find((row) => String(row.date) === decisionDate)
          : undefined
        const historicalStatusResolved = directStatus?.isST !== undefined
          && ['0', '1'].includes(String(directStatus.isST))
          && ['0', '1'].includes(String(directStatus.tradestatus))
        const providerTradable = historicalStatusResolved ? String(directStatus.tradestatus) === '1' : undefined
        const priceTradable = Boolean(exact && Number(exact.amountHands || 0) > 0)
        const statusPriceConflict = historicalStatusResolved && providerTradable !== priceTradable
        if (statusPriceConflict) statusPriceConflictCount += 1
        const tradeabilityResolved = historicalStatusResolved && !statusPriceConflict
        if (exact) marketBarSymbolCount += 1
        if (tradeabilityResolved) tradeabilitySymbolCount += 1
        if (historicalStatusResolved) historicalSecurityStatusSymbolCount += 1
        const fundamentalResolved = Boolean(descriptor.performance && descriptor.income && descriptor.cashflow && descriptor.balance)
        if (fundamentalResolved) announcementAwareFundamentalSymbolCount += 1

        const history = rows.slice(-250).map((row) => ({
          date: String(row.date),
          open: Number(row.open),
          high: Number(row.high),
          low: Number(row.low),
          close: Number(row.close),
          volume: Number(row.amountHands || 0) * 100,
          amount: Number(row.turnoverAmountDerived || 0),
          isTradable: Number(row.amountHands || 0) > 0,
          tradabilityStatus: Number(row.amountHands || 0) > 0 ? 'tradable' as const : 'suspended' as const,
          isSuspended: Number(row.amountHands || 0) <= 0,
          tradeabilityEvidenceRef: `market-history-free-provider:tencent:${descriptor.symbol}:${row.date}:${fileHashes.get(pricePath) || 'missing-hash'}`,
        }))
        const input = this.buildInput(descriptor, history, exact, directStatus, tradeabilityResolved, ranks.get(descriptor.symbol), fileHashes, basicPath, statusPath, decisionDate)
        const factSet = dividendLowVolStrategyService.buildFactSet(input)
        const evaluationReady = history.length >= 250 && historicalStatusResolved && tradeabilityResolved && fundamentalResolved && Boolean(descriptor.industry)
        if (evaluationReady) candidateEvaluationSnapshotSymbolCount += 1
        candidates.push({
          symbol: descriptor.symbol,
          name: descriptor.name,
          industry: descriptor.industry || null,
          evaluationReady,
          historyBarCount: history.length,
          decisionBarPresent: Boolean(exact),
          historicalStatusResolved,
          historicalStatusEvidenceMode: 'baostock_direct_daily',
          historicalStatusProxyUsed: false,
          directIsST: historicalStatusResolved ? String(directStatus.isST) === '1' : null,
          directTradeStatus: historicalStatusResolved ? String(directStatus.tradestatus) : null,
          statusPriceConflict,
          tradeabilityResolved,
          fundamentalResolved,
          sourceAnnouncementDates: [
            announcementDate(descriptor.performance || {}, 'performance'),
            announcementDate(descriptor.income || {}, 'income'),
            announcementDate(descriptor.cashflow || {}, 'cashflow'),
            announcementDate(descriptor.balance || {}, 'balance'),
            announcementDate(descriptor.growth || {}, 'performance'),
            ...descriptor.dividendRows.map(({ row }) => announcementDate(row, 'dividend')),
          ].filter(Boolean),
          derivedFieldAudit: this.buildDerivedFieldAudit(descriptor, input, exact, ranks, decisionDate),
          disposition: factSet.disposition,
          candidateGrade: factSet.candidateGrade,
          scores: factSet.scores,
          blockedReasons: factSet.blockedReasons,
          leaderEvidence: factSet.leaderEvidence,
          dataTrust: factSet.dataTrust,
          metricCompleteness: factSet.metricCompleteness,
          evidenceRefs: factSet.evidenceRefs,
        })
      }

      const minimumRequiredSymbols = Math.ceil(universeRows.length * MINIMUM_COVERAGE_PERCENT / 100)
      const marketBarCoveragePercent = percent(marketBarSymbolCount, universeRows.length)
      const tradeabilityCoveragePercent = percent(tradeabilitySymbolCount, universeRows.length)
      const historicalSecurityStatusCoveragePercent = percent(historicalSecurityStatusSymbolCount, universeRows.length)
      const announcementAwareFundamentalCoveragePercent = percent(announcementAwareFundamentalSymbolCount, universeRows.length)
      const candidateEvaluationSnapshotCoveragePercent = percent(candidateEvaluationSnapshotSymbolCount, universeRows.length)
      const eligible = candidates
        .filter((candidate) => candidate.evaluationReady && !['avoid', 'data_insufficient'].includes(candidate.disposition))
        .sort((left, right) => Number(right.scores?.evidenceAdjustedScore || 0) - Number(left.scores?.evidenceAdjustedScore || 0))
      const blockers = [
        ...(marketBarCoveragePercent >= MINIMUM_COVERAGE_PERCENT ? [] : ['insufficient_market_bar_history']),
        ...(tradeabilityCoveragePercent >= MINIMUM_COVERAGE_PERCENT ? [] : ['insufficient_tradeability_history']),
        ...(historicalSecurityStatusCoveragePercent >= MINIMUM_COVERAGE_PERCENT ? [] : ['insufficient_historical_security_status']),
        ...(announcementAwareFundamentalCoveragePercent >= MINIMUM_COVERAGE_PERCENT ? [] : ['insufficient_announcement_aware_fundamentals']),
        ...(candidateEvaluationSnapshotCoveragePercent >= MINIMUM_COVERAGE_PERCENT ? [] : ['insufficient_candidate_evaluation_snapshot']),
      ]
      const snapshot = {
        schemaVersion: 'fams.ftr_3r.free_source_decision_snapshot.v1',
        generatedAt: new Date().toISOString(),
        windowId: `wf-${String(index + 1).padStart(2, '0')}`,
        decisionDate,
        sourceLakeId: manifest.lakeId,
        sourceLakeManifestSha256: sha256(manifestRaw),
        referenceUniverseCount: universeRows.length,
        selectedSymbols: eligible.slice(0, 10).map((candidate) => candidate.symbol),
        candidates,
        policy: {
          currentUniverseUsedAsHistoricalMembership: false,
          announcementCutoff: `announcementDate<=${decisionDate}`,
          failedPriceShardsRemainInDenominator: true,
          failedStatusShardsRemainInDenominator: true,
          historicalStatusEvidenceMode: 'baostock_direct_daily',
          historicalStatusProxyAllowed: false,
          allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
          prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
        },
      }
      const snapshotPath = resolve(outputDir, `decision-snapshot-${decisionDate}.json`)
      const snapshotRaw = `${JSON.stringify(snapshot)}\n`
      await writeFile(snapshotPath, snapshotRaw, { encoding: 'utf8', flag: 'wx' })
      const pointInTimeSelectionReady = blockers.length === 0
      results.push({
        windowId: snapshot.windowId,
        decisionDate,
        referenceUniverseCount: universeRows.length,
        minimumRequiredSymbols,
        historicalUniverseResolved: universeRows.length > 0,
        marketBarSymbolCount,
        marketBarCoveragePercent,
        tradeabilitySymbolCount,
        tradeabilityCoveragePercent,
        historicalSecurityStatusSymbolCount,
        historicalSecurityStatusCoveragePercent,
        announcementAwareFundamentalSymbolCount,
        announcementAwareFundamentalCoveragePercent,
        candidateEvaluationSnapshotSymbolCount,
        candidateEvaluationSnapshotCoveragePercent,
        eligibleResearchCandidateCount: eligible.length,
        dataInsufficientCandidateCount: candidates.filter((candidate) => candidate.disposition === 'data_insufficient').length,
        failedPriceShardCount,
        failedStatusShardCount,
        statusPriceConflictCount,
        historicalStatusEvidenceMode: 'baostock_direct_daily',
        historicalStatusProxyAllowed: false,
        announcementCutoffVerified: true,
        currentUniverseUsedAsHistoricalMembership: false,
        futureAnnouncementReuseDetected: false,
        providerFailuresRemainInDenominator: true,
        pointInTimeSelectionReady,
        snapshotPath,
        snapshotSha256: sha256(snapshotRaw),
        selectedSymbols: snapshot.selectedSymbols,
        blockers,
      })
    }

    return {
      lakeDir: lake,
      lakeManifestPath: manifestPath,
      lakeManifestSha256: sha256(manifestRaw),
      lakeFileCount: Number(manifest.fileCount),
      allArtifactHashesVerified,
      decisionPoints: results,
    }
  }

  private async loadDatasets(lake: string, fileHashes: Map<string, string>) {
    const directory = resolve(lake, 'raw', 'akshare')
    const names = (await readdir(directory)).filter((name) => name.endsWith('.json')).sort()
    const datasets: Record<string, RawDataset[]> = {}
    for (const name of names) {
      const match = name.match(/^(performance|income|cashflow|balance|growth|dividend)-(\d{8})\.json$/)
      if (!match) continue
      const path = resolve(directory, name)
      const value = JSON.parse((await readFile(path, 'utf8'))) as Json
      if (value.liveCall !== true || !Array.isArray(value.rows)) throw new Error(`akshare_dataset_invalid:${name}`)
      const dataset = { path, sha256: fileHashes.get(path) || '', reportPeriod: match[2], rows: value.rows as Json[] }
      ;(datasets[match[1]] ||= []).push(dataset)
    }
    for (const kind of ['performance', 'income', 'cashflow', 'balance', 'growth', 'dividend']) {
      if (!datasets[kind]?.length) throw new Error(`akshare_dataset_missing:${kind}`)
    }
    return datasets
  }

  private indexDatasets(datasets: Record<string, RawDataset[]>) {
    const indexed: Record<string, Map<string, Array<{ row: Json; source: RawDataset }>>> = {}
    for (const [kind, sources] of Object.entries(datasets)) {
      const map = new Map<string, Array<{ row: Json; source: RawDataset }>>()
      for (const source of sources) {
        for (const row of source.rows) {
          const symbol = symbolOf(row, kind)
          if (!/^\d{6}$/.test(symbol)) continue
          const entries = map.get(symbol) || []
          entries.push({ row, source })
          map.set(symbol, entries)
        }
      }
      indexed[kind] = map
    }
    return indexed
  }

  private describeSecurity(basic: Json, indexed: Record<string, Map<string, Array<{ row: Json; source: RawDataset }>>>, decisionDate: string): SecurityDescriptor {
    const symbol = String(basic.code).split('.').at(-1)!
    const performance = chooseLatest(indexed.performance.get(symbol) || [], 'performance', decisionDate)
    const income = chooseLatest(indexed.income.get(symbol) || [], 'income', decisionDate)
    const cashflow = chooseLatest(indexed.cashflow.get(symbol) || [], 'cashflow', decisionDate)
    const balance = chooseLatest(indexed.balance.get(symbol) || [], 'balance', decisionDate)
    const growth = chooseLatest(indexed.growth.get(symbol) || [], 'performance', decisionDate)
    const dividendRows = (indexed.dividend.get(symbol) || [])
      .filter(({ row, source }) => isoPeriod(source.reportPeriod) <= decisionDate && (announcementDate(row, 'dividend') || '9999-12-31') <= decisionDate)
      .sort((left, right) => left.source.reportPeriod.localeCompare(right.source.reportPeriod))
    return {
      symbol,
      name: text(performance?.row['股票简称']) || symbol,
      industry: text(performance?.row['所处行业']),
      ipoDate: String(basic.ipoDate),
      outDate: text(basic.outDate),
      performance: performance?.row,
      performanceSource: performance?.source,
      income: income?.row,
      incomeSource: income?.source,
      cashflow: cashflow?.row,
      cashflowSource: cashflow?.source,
      balance: balance?.row,
      balanceSource: balance?.source,
      growth: growth?.row,
      growthSource: growth?.source,
      dividendRows,
    }
  }

  private buildIndustryRanks(descriptors: SecurityDescriptor[], lake: string, priceFiles: Set<string>, decisionDate: string) {
    const rows = descriptors.map((descriptor) => {
      const equity = finite(descriptor.balance?.['股东权益合计'])
      const bookValuePerShare = finite(descriptor.performance?.['每股净资产'])
      const totalShares = equity !== undefined && bookValuePerShare !== undefined && bookValuePerShare > 0 ? equity / bookValuePerShare : undefined
      return { descriptor, totalShares, pricePath: priceFiles.has(`${descriptor.symbol}.json`) ? resolve(lake, 'raw', 'prices', `${descriptor.symbol}.json`) : undefined }
    })
    const byIndustry = new Map<string, typeof rows>()
    for (const row of rows) {
      if (!row.descriptor.industry) continue
      const group = byIndustry.get(row.descriptor.industry) || []
      group.push(row)
      byIndustry.set(row.descriptor.industry, group)
    }
    const result = new Map<string, Json>()
    for (const group of byIndustry.values()) {
      const marketCaps: Array<{ symbol: string; value: number | undefined }> = []
      const turnovers: Array<{ symbol: string; value: number | undefined }> = []
      for (const item of group) {
        let price: number | undefined
        let turnover: number | undefined
        if (item.pricePath) {
          const shard = JSON.parse(requireRead(item.pricePath)) as Json
          const history = (shard.rows as Json[]).filter((row) => String(row.date) <= decisionDate)
          price = finite(history.at(-1)?.close)
          const amounts = history.slice(-60).map((row) => finite(row.turnoverAmountDerived)).filter((value): value is number => value !== undefined)
          turnover = amounts.length ? amounts.reduce((sum, value) => sum + value, 0) / amounts.length : undefined
        }
        marketCaps.push({ symbol: item.descriptor.symbol, value: price !== undefined && item.totalShares !== undefined ? price * item.totalShares : undefined })
        turnovers.push({ symbol: item.descriptor.symbol, value: turnover })
      }
      const revenue = percentileMap(group.map(({ descriptor }) => ({ symbol: descriptor.symbol, value: finite(descriptor.income?.['营业总收入']) })))
      const profits = percentileMap(group.map(({ descriptor }) => ({ symbol: descriptor.symbol, value: finite(descriptor.income?.['净利润']) })))
      const roe = percentileMap(group.map(({ descriptor }) => ({ symbol: descriptor.symbol, value: finite(descriptor.performance?.['净资产收益率']) })))
      const marketCap = percentileMap(marketCaps)
      const turnover = percentileMap(turnovers)
      for (const item of group) {
        result.set(item.descriptor.symbol, {
          totalShares: item.totalShares,
          totalMarketCap: marketCaps.find((value) => value.symbol === item.descriptor.symbol)?.value,
          avgTurnoverAmount60: turnovers.find((value) => value.symbol === item.descriptor.symbol)?.value,
          marketCapRankScore: marketCap.get(item.descriptor.symbol),
          revenueRankScore: revenue.get(item.descriptor.symbol),
          netProfitRankScore: profits.get(item.descriptor.symbol),
          roeIndustryPercentile: roe.get(item.descriptor.symbol),
          liquidityRankScore: turnover.get(item.descriptor.symbol),
        })
      }
    }
    return result
  }

  private buildInput(
    descriptor: SecurityDescriptor,
    history: NonNullable<DividendLowVolInput['history']>,
    exact: Json | undefined,
    directStatus: Json | undefined,
    tradeabilityResolved: boolean,
    ranks: Json | undefined,
    fileHashes: Map<string, string>,
    basicPath: string,
    statusPath: string,
    decisionDate: string,
  ): DividendLowVolInput {
    const dividendRecords: DividendRecord[] = descriptor.dividendRows.map(({ row, source }) => ({
      year: Number(source.reportPeriod.slice(0, 4)),
      dividendPerShare: Math.max(0, finite(row['现金分红-现金分红比例']) || 0) / 10,
      ...(text(row['除权除息日']) ? { exDividendDate: text(row['除权除息日'])!.slice(0, 10) } : {}),
      evidenceRef: `dividend:free-akshare:${descriptor.symbol}:${source.reportPeriod}:${announcementDate(row, 'dividend')}:${source.sha256}`,
    }))
    const latestDividend = descriptor.dividendRows.at(-1)?.row
    const latestDps = dividendRecords.at(-1)?.dividendPerShare
    const dividendEps = finite(latestDividend?.['每股收益'])
    const performanceEps = finite(descriptor.performance?.['每股收益'])
    const annualizationFactor = reportAnnualizationFactor(descriptor.performanceSource?.reportPeriod)
    const annualizedEps = performanceEps !== undefined && annualizationFactor !== undefined ? performanceEps * annualizationFactor : undefined
    const bookValuePerShare = finite(descriptor.performance?.['每股净资产'])
    const latestPrice = finite(exact?.close) || history.at(-1)?.close
    const netProfit = finite(descriptor.income?.['净利润'])
    const cashflow = finite(descriptor.cashflow?.['经营性现金流-现金流量净额'])
    const evidenceRefs = [
      `free-source-provider:baostock:stock_basic:${fileHashes.get(basicPath)}`,
      ...(descriptor.performanceSource ? [`free-source-provider:akshare:bulk_financials:${descriptor.performanceSource.sha256}`] : []),
      ...(history.length ? [`free-source-provider:tencent:unadjusted_daily:${descriptor.symbol}`] : []),
      `free-source-lifecycle:${descriptor.symbol}:${descriptor.ipoDate}:${descriptor.outDate || 'active'}:${fileHashes.get(basicPath)}`,
      ...(directStatus ? [`free-source-historical-status:baostock:${descriptor.symbol}:${decisionDate}:${directStatus.tradestatus}:${directStatus.isST}:${fileHashes.get(statusPath)}`] : []),
      ...(descriptor.performanceSource ? [`fundamental:free-akshare:performance:${descriptor.performanceSource.reportPeriod}:${descriptor.performanceSource.sha256}`] : []),
      ...(descriptor.incomeSource ? [`fundamental:free-akshare:income_revenue:income_net_profit:${descriptor.incomeSource.reportPeriod}:${descriptor.incomeSource.sha256}`] : []),
      ...(descriptor.cashflowSource ? [`fundamental:free-akshare:cashflow:${descriptor.cashflowSource.reportPeriod}:${descriptor.cashflowSource.sha256}`] : []),
      ...(descriptor.balanceSource ? [`fundamental:free-akshare:balance:${descriptor.balanceSource.reportPeriod}:${descriptor.balanceSource.sha256}`] : []),
      ...(descriptor.growthSource ? [`fundamental:free-akshare:growth:${descriptor.growthSource.reportPeriod}:${descriptor.growthSource.sha256}`] : []),
      ...(history.length ? [`market-history-free-provider:tencent:${descriptor.symbol}:${history[0].date}:${history.at(-1)?.date}`] : []),
      ...(tradeabilityResolved ? [`free-source-tradeability:${descriptor.symbol}:${decisionDate}:${String(directStatus?.tradestatus) === '1' ? 'direct_tradable_cross_checked' : 'direct_suspended_cross_checked'}`] : []),
      ...(ranks ? [`free-source-industry-rank:${descriptor.symbol}:market_cap_rank:income_revenue:income_net_profit:roe_percentile:provider_cross_checked_industry_rank`] : []),
      ...dividendRecords.map((record) => record.evidenceRef),
    ]
    return {
      symbol: descriptor.symbol,
      name: descriptor.name,
      market: 'A_SHARE',
      assetType: 'stock',
      industry: descriptor.industry,
      isST: directStatus ? String(directStatus.isST) === '1' : undefined,
      isSuspended: directStatus ? String(directStatus.tradestatus) === '0' : undefined,
      isDelisted: false,
      listingAgeDays: daysBetween(descriptor.ipoDate, decisionDate),
      price: latestPrice,
      dividendRecords,
      ttmDividendPerShare: latestDps,
      payoutRatio: latestDps !== undefined && dividendEps !== undefined && dividendEps !== 0 ? (latestDps / dividendEps) * 100 : undefined,
      operatingCashFlowToNetProfit: cashflow !== undefined && netProfit !== undefined && netProfit !== 0 ? cashflow / netProfit : undefined,
      roe: finite(descriptor.performance?.['净资产收益率']),
      debtToAsset: finite(descriptor.balance?.['资产负债率']),
      profitGrowth3y: finite(descriptor.growth?.['净利润-同比增长']) ?? finite(descriptor.growth?.['净利润同比']),
      operatingRevenue: finite(descriptor.income?.['营业总收入']),
      netProfit,
      pe: latestPrice !== undefined && annualizedEps !== undefined && annualizedEps > 0 ? latestPrice / annualizedEps : undefined,
      pb: latestPrice !== undefined && bookValuePerShare !== undefined && bookValuePerShare > 0 ? latestPrice / bookValuePerShare : undefined,
      totalMarketCap: finite(ranks?.totalMarketCap),
      avgTurnoverAmount60: finite(ranks?.avgTurnoverAmount60),
      marketCapRankScore: finite(ranks?.marketCapRankScore),
      revenueRankScore: finite(ranks?.revenueRankScore),
      netProfitRankScore: finite(ranks?.netProfitRankScore),
      roeIndustryPercentile: finite(ranks?.roeIndustryPercentile),
      liquidityRankScore: finite(ranks?.liquidityRankScore),
      history,
      evidenceRefs,
    }
  }

  private buildDerivedFieldAudit(descriptor: SecurityDescriptor, input: DividendLowVolInput, exact: Json | undefined, ranks: Json | undefined, decisionDate: string) {
    const equity = finite(descriptor.balance?.['股东权益合计'])
    const bookValuePerShare = finite(descriptor.performance?.['每股净资产'])
    const eps = finite(descriptor.performance?.['每股收益'])
    const annualizationFactor = reportAnnualizationFactor(descriptor.performanceSource?.reportPeriod)
    const price = finite(exact?.close) ?? input.price
    return {
      totalShares: {
        value: finite(ranks?.totalShares) ?? null,
        unit: 'shares',
        formula: 'shareholder_equity_cny/book_value_per_share_cny',
        inputs: { shareholderEquityCny: equity ?? null, bookValuePerShareCny: bookValuePerShare ?? null },
        reportPeriod: descriptor.balanceSource?.reportPeriod || null,
        announcementDate: announcementDate(descriptor.balance || {}, 'balance') || null,
      },
      marketCap: {
        value: input.totalMarketCap ?? null,
        unit: 'CNY',
        formula: 'decision_close_cny*derived_total_shares',
        inputs: { decisionCloseCny: price ?? null, derivedTotalShares: finite(ranks?.totalShares) ?? null },
        decisionDate,
      },
      averageTurnover60: {
        value: input.avgTurnoverAmount60 ?? null,
        unit: 'CNY/day',
        formula: 'mean(last_60(close_cny*amount_hands*100_shares_per_hand))',
        inputBarCount: Math.min(60, input.history?.length || 0),
        decisionDate,
      },
      pe: {
        value: input.pe ?? null,
        unit: 'ratio',
        formula: 'decision_close_cny/(reported_eps_cny*period_annualization_factor)',
        inputs: { decisionCloseCny: price ?? null, reportedEpsCny: eps ?? null, annualizationFactor: annualizationFactor ?? null },
        reportPeriod: descriptor.performanceSource?.reportPeriod || null,
        announcementDate: announcementDate(descriptor.performance || {}, 'performance') || null,
      },
      pb: {
        value: input.pb ?? null,
        unit: 'ratio',
        formula: 'decision_close_cny/book_value_per_share_cny',
        inputs: { decisionCloseCny: price ?? null, bookValuePerShareCny: bookValuePerShare ?? null },
        reportPeriod: descriptor.performanceSource?.reportPeriod || null,
        announcementDate: announcementDate(descriptor.performance || {}, 'performance') || null,
      },
    }
  }
}

function requireRead(path: string) {
  return readFileSync(path, 'utf8')
}

export const freePointInTimeSnapshotService = new FreePointInTimeSnapshotService()
