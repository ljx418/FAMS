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
const SAMPLE_SYMBOLS = ['600887', '000001', '300750']
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const
const helperPath = resolve(process.cwd(), 'scripts', 'providers', 'ftr_3_point_in_time_probe.py')

type Json = Record<string, any>

function sha256Bytes(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function percent(count: number, total: number) {
  return total === 0 ? 0 : Math.min(100, Math.round((count / total) * 100_000) / 1_000)
}

function includesAll(values: unknown, required: string[]) {
  return Array.isArray(values) && required.every((item) => values.includes(item))
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

async function runHelper(mode: 'universe' | 'samples' | 'akshare', timeoutSeconds: number) {
  const args = [
    helperPath,
    '--mode', mode,
    '--decision-date', DECISION_DATE,
    '--symbols', SAMPLE_SYMBOLS.join(','),
    '--timeout-seconds', String(timeoutSeconds),
  ]
  try {
    const result = await execFileAsync('python3', args, {
      timeout: (timeoutSeconds + 15) * 1000,
      maxBuffer: 100 * 1024 * 1024,
      encoding: 'utf8',
    })
    return { raw: result.stdout, parsed: JSON.parse(result.stdout) as Json, processError: null }
  } catch (error: any) {
    const raw = typeof error?.stdout === 'string' && error.stdout.trim()
      ? error.stdout
      : `${JSON.stringify({
        provider: mode === 'akshare' ? 'akshare' : 'baostock',
        mode,
        decisionDate: DECISION_DATE,
        liveCall: true,
        status: error?.killed ? 'timeout' : 'error',
        warning: String(error?.message || error).slice(0, 500),
        generatedAt: new Date().toISOString(),
      }, null, 2)}\n`
    return { raw, parsed: JSON.parse(raw) as Json, processError: String(error?.message || error) }
  }
}

async function main() {
  await initializePrisma()
  const before = await protectedAccountDigest()
  const generatedAt = new Date()
  const timestamp = generatedAt.toISOString().replace(/[:.]/g, '-')
  const dir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0A', timestamp)
  await mkdir(dir, { recursive: true })

  const referencePath = resolve(process.cwd(), 'data', 'a-share-quote-list-cache.json')
  const referenceRaw = await readFile(referencePath, 'utf8')
  const reference = JSON.parse(referenceRaw) as Json
  assert.ok(Number(reference.itemCount) > 0, 'reference_universe_empty')
  assert.equal(reference.items?.length, reference.itemCount, 'reference_universe_count_mismatch')
  const minimumRequiredSymbols = Math.ceil(reference.itemCount * MINIMUM_COVERAGE_PERCENT / 100)

  const providerTimeoutSeconds = Math.max(30, Math.min(420, Number(process.env.FAMS_FTR3R_PROVIDER_TIMEOUT_SECONDS || 420)))
  const universeResult = await runHelper('universe', providerTimeoutSeconds)
  const sampleResult = await runHelper('samples', 120)
  const akshareResult = await runHelper('akshare', 90)
  const rawResults = [
    { provider: 'baostock_universe', fileName: 'raw_baostock_universe.json', ...universeResult },
    { provider: 'baostock_samples', fileName: 'raw_baostock_samples.json', ...sampleResult },
    { provider: 'akshare_dividend', fileName: 'raw_akshare_dividend.json', ...akshareResult },
  ] as const
  const evidenceFiles = []
  for (const item of rawResults) {
    const path = resolve(dir, item.fileName)
    await writeFile(path, item.raw.endsWith('\n') ? item.raw : `${item.raw}\n`, { encoding: 'utf8', flag: 'wx' })
    evidenceFiles.push({ provider: item.provider, path, sha256: sha256Bytes(await readFile(path, 'utf8')), exists: true })
  }

  const universe = universeResult.parsed
  const samples = sampleResult.parsed
  const akshare = akshareResult.parsed
  const universeSymbolCount = Number(universe.symbolCount || 0)
  const universeCoveragePercent = percent(universeSymbolCount, reference.itemCount)
  const sampleRows = Array.isArray(samples.samples) ? samples.samples as Json[] : []
  const historyTradeStateFieldsPresent = sampleRows.length > 0 && sampleRows.every((item) => (
    includesAll(item.historyFields, ['date', 'code', 'close', 'tradestatus', 'isST']) && item.history?.length > 0
  ))
  const announcementAwareFundamentalFieldsPresent = sampleRows.some((item) => (
    includesAll(item.profitFields, ['code', 'pubDate', 'statDate', 'netProfit'])
    && item.profit?.some((row: Json) => row.pubDate && row.pubDate <= DECISION_DATE)
  ))
  const dividendAnnouncementFieldsPresent = sampleRows.some((item) => (
    includesAll(item.dividendFields, ['code', 'dividPlanAnnounceDate', 'dividOperateDate', 'dividCashPsBeforeTax'])
    && item.dividend?.some((row: Json) => row.dividPlanAnnounceDate && row.dividPlanAnnounceDate <= DECISION_DATE)
  ))
  const listingLifecycleFieldsPresent = sampleRows.length > 0 && sampleRows.every((item) => (
    includesAll(item.basicFields, ['code', 'ipoDate', 'outDate', 'status']) && item.basic?.length > 0
  ))
  const historicalIndustryFieldsPresent = sampleRows.length > 0 && sampleRows.every((item) => (
    includesAll(item.industryFields, ['updateDate', 'code', 'industry', 'industryClassification'])
    && item.industry?.some((row: Json) => row.updateDate && row.updateDate <= DECISION_DATE)
  ))
  const akshareDividendAnnouncementFieldsPresent = includesAll(akshare.columns, ['业绩披露日期', '预案公告日', '除权除息日', '最新公告日期'])
    && Number(akshare.rowCount || 0) > 0

  const adapterPath = resolve(process.cwd(), 'src', 'services', 'dividend-low-vol', 'formalProviderIngestionService.ts')
  const adapterText = await readFile(adapterPath, 'utf8')
  const currentAdapterSingleSymbolOnly = adapterText.includes('tsCodes[0]')
  const currentAdapterAnnouncementFieldsMissing = !adapterText.includes("fields: 'ts_code,ann_date,f_ann_date,end_date")
  const currentAdapterIndustryMembershipMissing = !adapterText.includes("apiName: 'index_member_all'")
  const currentAdapterHistoricalStatusEndpointsMissing = !adapterText.includes("apiName: 'stock_st'") || !adapterText.includes("apiName: 'suspend_d'")
  const batchImplementationReady = !currentAdapterSingleSymbolOnly
    && !currentAdapterAnnouncementFieldsMissing
    && !currentAdapterIndustryMembershipMissing
    && !currentAdapterHistoricalStatusEndpointsMissing

  const historicalUniverseProbePassed = universe.status === 'passed' && universeCoveragePercent >= MINIMUM_COVERAGE_PERCENT
  const historicalTradeStateProbePassed = historyTradeStateFieldsPresent
  const announcementAwareFundamentalProbePassed = announcementAwareFundamentalFieldsPresent
  const dividendAnnouncementProbePassed = dividendAnnouncementFieldsPresent
  const historicalIndustryProbePassed = historicalIndustryFieldsPresent
  const akshareDividendCrossCheckPassed = akshare.status === 'passed' && akshareDividendAnnouncementFieldsPresent
  const fullMarketBackfillReady = historicalUniverseProbePassed
    && historicalTradeStateProbePassed
    && announcementAwareFundamentalProbePassed
    && dividendAnnouncementProbePassed
    && listingLifecycleFieldsPresent
    && historicalIndustryProbePassed
    && akshareDividendCrossCheckPassed
    && batchImplementationReady
  const blockers = [
    ...(!historicalUniverseProbePassed ? ['historical_universe_bulk_probe_failed'] : []),
    ...(!historicalTradeStateProbePassed ? ['historical_trade_state_probe_failed'] : []),
    ...(!announcementAwareFundamentalProbePassed ? ['announcement_aware_fundamental_probe_failed'] : []),
    ...(!dividendAnnouncementProbePassed ? ['dividend_announcement_probe_failed'] : []),
    ...(!listingLifecycleFieldsPresent ? ['listing_lifecycle_probe_failed'] : []),
    ...(!historicalIndustryProbePassed ? ['historical_industry_probe_failed'] : []),
    ...(!akshareDividendCrossCheckPassed ? ['akshare_dividend_cross_check_failed'] : []),
    ...(!batchImplementationReady ? ['point_in_time_batch_adapter_not_implemented'] : []),
  ]
  const recommendedPrimaryMode = historicalUniverseProbePassed
    ? 'tushare_bulk_with_open_source_cross_check'
    : (process.env.FAMS_TUSHARE_TOKEN || process.env.TUSHARE_TOKEN)
      ? 'tushare_bulk_with_open_source_cross_check'
      : 'blocked_pending_provider'

  const after = await protectedAccountDigest()
  assert.equal(before, after, 'protected_account_facts_changed')
  const artifact = {
    schemaVersion: 'fams.ftr_3r.open_source_provider_probe.v1',
    stageId: 'FTR-3R0A',
    generatedAt: generatedAt.toISOString(),
    decisionDate: DECISION_DATE,
    mode: 'full_market_single_decision_point_probe',
    sourcePolicy: 'baostock_primary_akshare_cross_check_official_disclosure_evidence',
    referenceUniverse: {
      path: referencePath,
      symbolCount: Number(reference.itemCount),
      sha256: sha256Bytes(referenceRaw),
      minimumCoveragePercent: MINIMUM_COVERAGE_PERCENT,
      minimumRequiredSymbols,
    },
    evidenceFiles,
    providerProbes: {
      baostock: {
        version: String(universe.providerVersion || samples.providerVersion || 'unknown'),
        liveCall: true,
        universeStatus: ['passed', 'timeout'].includes(universe.status) ? universe.status : 'error',
        universeSymbolCount,
        universeCoveragePercent,
        universeElapsedMs: Number(universe.elapsedMs || providerTimeoutSeconds * 1000),
        historyTradeStateFieldsPresent,
        announcementAwareFundamentalFieldsPresent,
        dividendAnnouncementFieldsPresent,
        listingLifecycleFieldsPresent,
        historicalIndustryFieldsPresent,
        sampleSymbolCount: sampleRows.length,
      },
      akshare: {
        version: String(akshare.providerVersion || 'unknown'),
        liveCall: true,
        status: akshare.status === 'passed' ? 'passed' : 'error',
        rowCount: Number(akshare.rowCount || 0),
        dividendAnnouncementFieldsPresent: akshareDividendAnnouncementFieldsPresent,
      },
      tushare: {
        configured: Boolean(process.env.FAMS_TUSHARE_TOKEN || process.env.TUSHARE_TOKEN),
        tokenInArtifact: false,
        currentAdapterSingleSymbolOnly,
        currentAdapterAnnouncementFieldsMissing,
        currentAdapterIndustryMembershipMissing,
        currentAdapterHistoricalStatusEndpointsMissing,
      },
    },
    sourceTerms: {
      usageScope: 'local_personal_noncommercial',
      sdkLicenseNotTreatedAsDataLicense: true,
      reviewStatus: 'reviewable',
      references: [
        'https://www.baostock.com/',
        'https://akshare.akfamily.xyz/data/stock/stock.html',
        'docs/FORMAL_DATA_GOVERNANCE_CONTRACT.md#21-本阶段公开数据授权路线',
      ],
    },
    adapterGapAssessment: {
      batchImplementationReady,
      historicalUniverseAdapterReady: false,
      announcementCutoffAdapterReady: false,
      historicalIndustryMembershipAdapterReady: false,
      historicalTradeStateAdapterReady: false,
      recommendedPrimaryMode,
    },
    summary: {
      historicalUniverseProbePassed,
      historicalTradeStateProbePassed,
      announcementAwareFundamentalProbePassed,
      dividendAnnouncementProbePassed,
      historicalIndustryProbePassed,
      akshareDividendCrossCheckPassed,
      fullMarketBackfillReady,
      ftr3r0bEntryAllowed: fullMarketBackfillReady,
    },
    accountFactsUnchanged: true,
    realDataUsed: true,
    status: fullMarketBackfillReady ? 'passed' : 'insufficient',
    blockers: Array.from(new Set(blockers)).sort(),
    prohibitedActions: [...PROHIBITED_ACTIONS],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const artifactPath = resolve(dir, 'open_source_provider_probe.json')
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ artifactPath, status: artifact.status, ...artifact.summary, blockers: artifact.blockers, recommendedPrimaryMode }, null, 2))
  if (artifact.status !== 'passed') process.exitCode = 2
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
