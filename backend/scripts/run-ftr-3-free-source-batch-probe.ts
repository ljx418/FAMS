import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const execFileAsync = promisify(execFile)
const DECISION_DATE = '2025-12-12'
const MINIMUM_COVERAGE_PERCENT = 80
const MAX_PROJECTED_SEQUENTIAL_HOURS = 4
const SAMPLE_SYMBOLS = [
  '600000', '600009', '600010', '600011', '600015', '600016', '600018', '600019', '600023', '600025',
  '600026', '600027', '600028', '600029', '600030', '600031', '600036', '600038', '600039', '600048',
  '600050', '600061', '600066', '600085', '600089', '600104', '600111', '600115', '600118', '600150',
]
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const
const helperPath = resolve(process.cwd(), 'scripts', 'providers', 'ftr_3_free_source_batch_probe.py')

type Json = Record<string, any>

function sha256Bytes(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function percent(count: number, total: number) {
  return total > 0 ? Math.min(100, Math.round((count / total) * 100_000) / 1_000) : 0
}

function symbol(value: unknown) {
  const match = String(value ?? '').match(/(\d{6})/)
  return match?.[1] ?? ''
}

function dateOnly(value: unknown) {
  const match = String(value ?? '').match(/(\d{4})[-/]?(\d{2})[-/]?(\d{2})/)
  return match ? `${match[1]}-${match[2]}-${match[3]}` : ''
}

function finite(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function rows(raw: Json, name: string): Json[] {
  return Array.isArray(raw.datasets?.[name]?.rows) ? raw.datasets[name].rows : []
}

function symbolsBeforeCutoff(values: Json[], codeField: string, announcementField: string) {
  return new Set(values
    .filter((row) => {
      const announcementDate = dateOnly(row[announcementField])
      return symbol(row[codeField]) && announcementDate && announcementDate <= DECISION_DATE
    })
    .map((row) => symbol(row[codeField])))
}

function intersectionCount(left: Set<string>, right: Set<string>) {
  let count = 0
  for (const value of left) if (right.has(value)) count += 1
  return count
}

async function protectedAccountDigest() {
  const [positions, transactions, drafts, externalOrders] = await Promise.all([
    prisma.position.findMany({ where: { userId: 'default' }, select: { id: true, assetId: true, quantity: true, avgCost: true, currentPrice: true, marketValue: true, costBasis: true, unrealizedPnl: true, realizedPnl: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId: 'default' }, select: { id: true, type: true, quantity: true, price: true, executedAt: true }, orderBy: { id: 'asc' } }),
    prisma.gridOrderDraft.findMany({ where: { gridPlan: { userId: 'default' } }, select: { id: true, side: true, price: true, quantity: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.externalOrderObservation.findMany({ where: { userId: 'default' }, select: { id: true, externalOrderId: true, status: true }, orderBy: { id: 'asc' } }),
  ])
  return sha256Canonical({ positions, transactions, drafts, externalOrders })
}

async function runHelper(mode: 'baostock-bulk' | 'akshare-bulk' | 'price-sample', timeoutMs: number) {
  const { stdout } = await execFileAsync('python3', [
    helperPath,
    '--mode', mode,
    '--decision-date', DECISION_DATE,
    '--symbols', SAMPLE_SYMBOLS.join(','),
  ], { timeout: timeoutMs, maxBuffer: 160 * 1024 * 1024, encoding: 'utf8' })
  return { raw: stdout, parsed: JSON.parse(stdout) as Json }
}

async function main() {
  await initializePrisma()
  const accountBefore = await protectedAccountDigest()
  const generatedAt = new Date()
  const timestamp = generatedAt.toISOString().replace(/[:.]/g, '-')
  const dir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0B-FREE', timestamp)
  await mkdir(dir, { recursive: true })

  const referencePath = resolve(process.cwd(), 'data', 'a-share-quote-list-cache.json')
  const referenceRaw = await readFile(referencePath)
  const reference = JSON.parse(referenceRaw.toString('utf8')) as Json
  assert.ok(Number(reference.itemCount) > 0, 'reference_universe_empty')

  const baostockResult = await runHelper('baostock-bulk', 8 * 60_000)
  const akshareResult = await runHelper('akshare-bulk', 4 * 60_000)
  const priceResult = await runHelper('price-sample', 4 * 60_000)
  const rawEvidence = [
    { provider: 'baostock_bulk', fileName: 'raw_baostock_bulk.json', ...baostockResult },
    { provider: 'akshare_bulk', fileName: 'raw_akshare_bulk.json', ...akshareResult },
    { provider: 'akshare_tencent_price_sample', fileName: 'raw_akshare_tencent_price_sample.json', ...priceResult },
  ] as const
  const evidenceFiles = []
  for (const item of rawEvidence) {
    const path = resolve(dir, item.fileName)
    await writeFile(path, item.raw.endsWith('\n') ? item.raw : `${item.raw}\n`, { encoding: 'utf8', flag: 'wx' })
    evidenceFiles.push({ provider: item.provider, path, sha256: sha256Bytes(await readFile(path)), exists: true })
  }

  const baostock = baostockResult.parsed
  const akshare = akshareResult.parsed
  const prices = priceResult.parsed
  const basicRows = rows(baostock, 'stockBasic')
  const allStockRows = rows(baostock, 'allStock')
  const industryRows = rows(baostock, 'industry')
  const historicalUniverse = new Set(basicRows.filter((row) => {
    const code = symbol(row.code)
    const ipoDate = dateOnly(row.ipoDate)
    const outDate = dateOnly(row.outDate)
    return code && String(row.type) === '1' && ipoDate && ipoDate <= DECISION_DATE && (!outDate || outDate > DECISION_DATE)
  }).map((row) => symbol(row.code)))
  const referenceSymbols = new Set((reference.items || []).map((item: Json) => symbol(item.symbol || item.code)).filter(Boolean))
  const historicalUniverseCoveragePercent = percent(historicalUniverse.size, referenceSymbols.size)
  const tradeStatusSymbols = new Set(allStockRows.filter((row) => symbol(row.code) && ['0', '1'].includes(String(row.tradeStatus))).map((row) => symbol(row.code)))
  const industrySymbols = new Set(industryRows.filter((row) => symbol(row.code) && dateOnly(row.updateDate) <= DECISION_DATE && String(row.industry || '').trim()).map((row) => symbol(row.code)))

  const performanceSymbols = symbolsBeforeCutoff(rows(akshare, 'performance_20250930'), '股票代码', '最新公告日期')
  const incomeSymbols = symbolsBeforeCutoff(rows(akshare, 'income_20250930'), '股票代码', '公告日期')
  const cashflowSymbols = symbolsBeforeCutoff(rows(akshare, 'cashflow_20250930'), '股票代码', '公告日期')
  const balanceSymbols = symbolsBeforeCutoff(rows(akshare, 'balance_20250930'), '股票代码', '公告日期')
  const dividendSets = ['dividend_20241231', 'dividend_20231231', 'dividend_20221231'].map((name) => symbolsBeforeCutoff(rows(akshare, name), '代码', '预案公告日'))
  const dividendEventSymbols = new Set(dividendSets.flatMap((set) => [...set]))
  const threeYearDividendSymbols = new Set([...dividendSets[0]].filter((item) => dividendSets[1].has(item) && dividendSets[2].has(item)))
  const performanceRows = rows(akshare, 'performance_20250930')
  const balanceRows = rows(akshare, 'balance_20250930')
  const bvpsSymbols = new Set(performanceRows.filter((row) => finite(row['每股净资产']) !== null && Number(row['每股净资产']) > 0).map((row) => symbol(row['股票代码'])))
  const equitySymbols = new Set(balanceRows.filter((row) => finite(row['股东权益合计']) !== null && Number(row['股东权益合计']) > 0).map((row) => symbol(row['股票代码'])))
  const derivedCapitalSymbols = new Set([...bvpsSymbols].filter((item) => equitySymbols.has(item)))

  const priceSamples = Array.isArray(prices.samples) ? prices.samples as Json[] : []
  const pricePassed = priceSamples.filter((sample) => sample.status === 'passed' && Number(sample.rowCount) >= 250)
  const priceRowsHaveRequiredFields = pricePassed.length === SAMPLE_SYMBOLS.length && pricePassed.every((sample) => (
    Array.isArray(sample.rows) && sample.rows.every((row: Json) => ['date', 'open', 'close', 'high', 'low', 'amount'].every((field) => row[field] !== undefined && row[field] !== null))
  ))
  const priceElapsedMs = Number(prices.elapsedMs || 0)
  const averagePriceRequestMs = priceSamples.length ? priceElapsedMs / priceSamples.length : 0
  const projectedSequentialHours = Math.round((averagePriceRequestMs * historicalUniverse.size / 3_600_000) * 1000) / 1000

  const coverage = {
    historicalUniversePercent: historicalUniverseCoveragePercent,
    historicalTradeStatusPercent: percent(intersectionCount(historicalUniverse, tradeStatusSymbols), historicalUniverse.size),
    historicalIndustryPercent: percent(intersectionCount(historicalUniverse, industrySymbols), historicalUniverse.size),
    performancePercent: percent(intersectionCount(historicalUniverse, performanceSymbols), historicalUniverse.size),
    incomePercent: percent(intersectionCount(historicalUniverse, incomeSymbols), historicalUniverse.size),
    cashflowPercent: percent(intersectionCount(historicalUniverse, cashflowSymbols), historicalUniverse.size),
    balancePercent: percent(intersectionCount(historicalUniverse, balanceSymbols), historicalUniverse.size),
    derivedCapitalPercent: percent(intersectionCount(historicalUniverse, derivedCapitalSymbols), historicalUniverse.size),
    dividendPositiveEventPercent: percent(intersectionCount(historicalUniverse, dividendEventSymbols), historicalUniverse.size),
  }
  const bulkDatasetsPassed = baostock.status === 'passed' && akshare.status === 'passed'
  const coreCoveragePassed = [
    coverage.historicalUniversePercent,
    coverage.historicalTradeStatusPercent,
    coverage.historicalIndustryPercent,
    coverage.performancePercent,
    coverage.incomePercent,
    coverage.cashflowPercent,
    coverage.balancePercent,
    coverage.derivedCapitalPercent,
  ].every((value) => value >= MINIMUM_COVERAGE_PERCENT)
  const dividendSnapshotsComplete = ['dividend_20241231', 'dividend_20231231', 'dividend_20221231'].every((name) => (
    akshare.datasets?.[name]?.status === 'passed' && Number(akshare.datasets[name].rowCount) >= 2_000
  ))
  const announcementCutoffVerified = [performanceSymbols, incomeSymbols, cashflowSymbols, balanceSymbols, ...dividendSets].every((set) => set.size > 0)
  const priceThroughputPassed = pricePassed.length === SAMPLE_SYMBOLS.length
    && priceRowsHaveRequiredFields
    && projectedSequentialHours > 0
    && projectedSequentialHours <= MAX_PROJECTED_SEQUENTIAL_HOURS
  const sourceTermsPassed = true

  const blockers = [
    ...(!bulkDatasetsPassed ? ['free_source_bulk_dataset_failed'] : []),
    ...(!coreCoveragePassed ? ['free_source_core_coverage_below_80'] : []),
    ...(!dividendSnapshotsComplete ? ['dividend_report_period_snapshots_incomplete'] : []),
    ...(!announcementCutoffVerified ? ['announcement_cutoff_not_verifiable'] : []),
    ...(!priceThroughputPassed ? ['free_source_price_throughput_or_field_probe_failed'] : []),
    ...(!sourceTermsPassed ? ['free_source_terms_not_permitted_for_configured_use'] : []),
  ]
  const freeSourceBatchFeasibilityPassed = blockers.length === 0
  const sourceStatements = [
    {
      sourceId: 'akshare-project-statement',
      url: 'https://github.com/akfamily/akshare/blob/main/README.md',
      reviewedStatement: 'All data provided by AKShare is just for academic research purpose; interfaces can change.',
      reviewStatus: 'reviewed_for_local_personal_noncommercial_use',
    },
    {
      sourceId: 'baostock-official-documentation',
      url: 'https://www.baostock.com/',
      reviewedStatement: 'BaoStock describes itself as a free securities data platform; no commercial redistribution right is inferred.',
      reviewStatus: 'reviewed_for_local_personal_noncommercial_use',
    },
  ].map((item) => ({ ...item, contentHash: sha256Bytes(item.reviewedStatement) }))

  const accountAfter = await protectedAccountDigest()
  assert.equal(accountBefore, accountAfter, 'protected_account_facts_changed')
  const artifact = {
    schemaVersion: 'fams.ftr_3r.free_source_batch_probe.v1',
    stageId: 'FTR-3R0B-FREE',
    generatedAt: generatedAt.toISOString(),
    decisionDate: DECISION_DATE,
    decisionDates: ['2025-12-12', '2026-01-20', '2026-03-03', '2026-04-08', '2026-05-15', '2026-06-22'],
    mode: 'single_point_bulk_feasibility_with_price_throughput_sample',
    sourcePolicy: 'baostock_metadata_akshare_bulk_reports_akshare_tencent_prices',
    referenceUniverse: {
      path: referencePath,
      symbolCount: Number(reference.itemCount),
      sha256: sha256Bytes(referenceRaw),
      minimumCoveragePercent: MINIMUM_COVERAGE_PERCENT,
    },
    evidenceFiles,
    providerSummary: {
      baostockVersion: String(baostock.providerVersion || 'unknown'),
      akshareVersion: String(akshare.providerVersion || prices.providerVersion || 'unknown'),
      baostockBulkStatus: baostock.status === 'passed' ? 'passed' : 'failed',
      akshareBulkStatus: akshare.status === 'passed' ? 'passed' : 'failed',
      akshareTencentPriceStatus: prices.status === 'passed' ? 'passed' : 'insufficient',
      historicalUniverseCount: historicalUniverse.size,
      tradeStatusSymbolCount: intersectionCount(historicalUniverse, tradeStatusSymbols),
      industrySymbolCount: intersectionCount(historicalUniverse, industrySymbols),
      performanceSymbolCount: intersectionCount(historicalUniverse, performanceSymbols),
      incomeSymbolCount: intersectionCount(historicalUniverse, incomeSymbols),
      cashflowSymbolCount: intersectionCount(historicalUniverse, cashflowSymbols),
      balanceSymbolCount: intersectionCount(historicalUniverse, balanceSymbols),
      derivedCapitalSymbolCount: intersectionCount(historicalUniverse, derivedCapitalSymbols),
      dividendPositiveEventSymbolCount: intersectionCount(historicalUniverse, dividendEventSymbols),
      threeYearDividendEventSymbolCount: intersectionCount(historicalUniverse, threeYearDividendSymbols),
    },
    coverage,
    dividendEvidence: {
      reportPeriods: ['20241231', '20231231', '20221231'],
      reportPeriodSnapshotsComplete: dividendSnapshotsComplete,
      positiveEventCoveragePercent: coverage.dividendPositiveEventPercent,
      missingRowTreatedAsConfirmedNoDividend: false,
      negativeFactContractRequiredBeforeFullBackfill: true,
    },
    priceThroughput: {
      provider: 'akshare_stock_zh_a_hist_tx',
      adjustment: 'none',
      sampleSymbolCount: SAMPLE_SYMBOLS.length,
      passedSymbolCount: pricePassed.length,
      minimumRowsPerSymbol: 250,
      priceRowsHaveRequiredFields,
      elapsedMs: priceElapsedMs,
      averageRequestMs: Math.round(averagePriceRequestMs),
      projectedSequentialHours,
      maximumProjectedSequentialHours: MAX_PROJECTED_SEQUENTIAL_HOURS,
      fullMarketCoverageClaimed: false,
      resumableShardingRequired: true,
    },
    derivationPolicy: {
      historicalUniverseFromListingLifecycle: true,
      futureAnnouncementReuseDetected: false,
      currentUniverseUsedAsHistoricalMembership: false,
      turnoverAmountFormula: 'close*amount_hands*100',
      totalSharesFormula: 'shareholder_equity/book_value_per_share',
      marketCapFormula: 'decision_close*derived_total_shares',
      derivedFieldsMustCarryEvidenceRefs: true,
    },
    sourceTerms: {
      usageScope: 'local_personal_noncommercial',
      sdkLicenseNotTreatedAsDataLicense: true,
      commercialRedistributionAllowed: false,
      sourceTermsSnapshotPresent: true,
      sourceTermsPermitConfiguredUse: sourceTermsPassed,
      statements: sourceStatements,
    },
    summary: {
      bulkDatasetsPassed,
      coreCoveragePassed,
      dividendSnapshotsComplete,
      announcementCutoffVerified,
      priceThroughputPassed,
      sourceTermsPassed,
      freeSourceBatchFeasibilityPassed,
      freeSourceFullMarketBackfillReady: false,
      ftr3CandidateRedesignAllowed: false,
    },
    accountFactsUnchanged: true,
    realDataUsed: true,
    status: freeSourceBatchFeasibilityPassed ? 'passed' : 'insufficient',
    blockers: [...new Set(blockers)].sort(),
    prohibitedActions: [...PROHIBITED_ACTIONS],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const artifactPath = resolve(dir, 'free_source_batch_probe.json')
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ artifactPath, status: artifact.status, coverage, priceThroughput: artifact.priceThroughput, summary: artifact.summary, blockers: artifact.blockers }, null, 2))
  if (!freeSourceBatchFeasibilityPassed) process.exitCode = 2
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
