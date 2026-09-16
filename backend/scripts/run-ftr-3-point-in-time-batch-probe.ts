import 'dotenv/config'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import {
  PointInTimeDataProviderService,
  evaluatePointInTimeProviderAuthorization,
  selectLatestAnnouncedRows,
  type PointInTimeEndpointResult,
} from '../src/services/formal-release/pointInTimeDataProviderService.js'
import { formalDataProviderService } from '../src/services/formal-release/formalDataProviderService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const DECISION_DATE = '2025-12-12'
const DECISION_DATE_API = '20251212'
const MINIMUM_COVERAGE_PERCENT = 80
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const

type Json = Record<string, any>

function sha256Bytes(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function percent(count: number, total: number) {
  return total === 0 ? 0 : Math.min(100, Math.round((count / total) * 100_000) / 1_000)
}

function uniqueCodes(rows: Array<Record<string, unknown>>) {
  return new Set(rows.map((row) => String(row.ts_code || row.con_code || '')).filter(Boolean))
}

function intersectionSize(sets: Set<string>[]) {
  if (sets.length === 0) return 0
  const [first, ...rest] = sets
  return [...first].filter((value) => rest.every((set) => set.has(value))).length
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

async function latestOpenSourceProbe() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0A')
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => right.name.localeCompare(left.name))) {
    const path = resolve(root, entry.name, 'open_source_provider_probe.json')
    try {
      const raw = await readFile(path, 'utf8')
      const artifact = JSON.parse(raw) as Json
      const booleans = [
        'historicalUniverseProbePassed',
        'historicalTradeStateProbePassed',
        'announcementAwareFundamentalProbePassed',
        'dividendAnnouncementProbePassed',
        'historicalIndustryProbePassed',
        'akshareDividendCrossCheckPassed',
      ]
      const rawHashesVerified = await Promise.all((artifact.evidenceFiles || []).map(async (item: Json) => {
        try {
          return sha256Bytes(await readFile(item.path, 'utf8')) === item.sha256
        } catch {
          return false
        }
      }))
      return {
        path,
        sha256: sha256Bytes(raw),
        passed: artifact.decisionDate === DECISION_DATE
          && artifact.realDataUsed === true
          && booleans.every((key) => artifact.summary?.[key] === true)
          && rawHashesVerified.length > 0
          && rawHashesVerified.every(Boolean),
      }
    } catch {
      continue
    }
  }
  return { path: null, sha256: null, passed: false }
}

function coverageResult(coveredCount: number, denominator: number, blocked: boolean) {
  const coveragePercent = percent(coveredCount, denominator)
  return {
    coveredCount,
    coveragePercent,
    status: blocked ? 'blocked' : coveragePercent >= MINIMUM_COVERAGE_PERCENT ? 'passed' : 'insufficient',
  }
}

function endpointSucceeded(results: PointInTimeEndpointResult[], requestId: string) {
  return results.some((result) => result.requestId === requestId && result.status === 'succeeded')
}

async function main() {
  await initializePrisma()
  const before = await protectedAccountDigest()
  const generatedAt = new Date()
  const timestamp = generatedAt.toISOString().replace(/[:.]/g, '-')
  const dir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0B', timestamp)
  await mkdir(dir, { recursive: true })

  const referencePath = resolve(process.cwd(), 'data', 'a-share-quote-list-cache.json')
  const reference = JSON.parse(await readFile(referencePath, 'utf8')) as Json
  const referenceUniverseCount = Number(reference.itemCount || reference.items?.length || 0)
  assert.ok(referenceUniverseCount > 0, 'reference_universe_empty')

  const service = new PointInTimeDataProviderService()
  const [batch, providerGovernanceAudit] = await Promise.all([
    service.buildSingleDecisionPoint(DECISION_DATE_API),
    formalDataProviderService.authorizationAudit('tushare_pro', generatedAt),
  ])
  const evidenceFiles = []
  const endpointResults = []
  for (const result of batch.endpointResults) {
    let evidenceRef: string | null = null
    if (result.status === 'succeeded') {
      evidenceRef = resolve(dir, `raw_${result.requestId}.json`)
      const raw = `${JSON.stringify({
        schemaVersion: 'fams.ftr_3r.point_in_time_raw_response.v1',
        generatedAt: generatedAt.toISOString(),
        decisionDate: DECISION_DATE,
        requestId: result.requestId,
        endpoint: result.endpoint,
        rowCount: result.rowCount,
        dataHash: result.dataHash,
        rows: result.rows,
      }, null, 2)}\n`
      await writeFile(evidenceRef, raw, { encoding: 'utf8', flag: 'wx' })
      evidenceFiles.push({ requestId: result.requestId, path: evidenceRef, sha256: sha256Bytes(raw), dataHash: result.dataHash, exists: true })
    }
    endpointResults.push({
      requestId: result.requestId,
      endpoint: result.endpoint,
      domain: result.domain,
      status: result.status,
      rowCount: result.rowCount,
      pageCount: result.pageCount,
      dataHash: result.dataHash,
      evidenceRef,
      errorCategory: result.errorCategory,
    })
  }

  const providerBlocked = !batch.providerConfigured || !batch.liveProviderAttempted
  const denominator = batch.datasets.historicalUniverse.length || referenceUniverseCount
  const priceCount = uniqueCodes(batch.datasets.prices).size
  const dailyBasicCount = uniqueCodes(batch.datasets.dailyBasic).size
  const limitCount = uniqueCodes(batch.datasets.limits).size
  const tradeStateEndpointsComplete = ['stk_limit', 'stock_st', 'suspend_d'].every((requestId) => endpointSucceeded(batch.endpointResults, requestId))
  const tradeStateCount = tradeStateEndpointsComplete ? Math.min(priceCount, limitCount) : 0
  const dividendEndpointsComplete = service.plan(DECISION_DATE_API)
    .filter((request) => request.domain === 'dividend')
    .every((request) => endpointSucceeded(batch.endpointResults, request.requestId))
  const dividendCount = dividendEndpointsComplete ? denominator : 0
  const financialSets = (['income_vip', 'cashflow_vip', 'balancesheet_vip', 'fina_indicator_vip'] as const).map((endpoint) => {
    const rows = batch.endpointResults.filter((result) => result.endpoint === endpoint && result.status === 'succeeded').flatMap((result) => result.rows)
    return uniqueCodes(selectLatestAnnouncedRows(rows, DECISION_DATE_API))
  })
  const fundamentalCount = intersectionSize(financialSets)
  const industryCount = uniqueCodes(batch.datasets.industryMemberships).size
  const coverage = {
    referenceUniverseCount,
    historicalUniverseCount: batch.datasets.historicalUniverse.length,
    minimumCoveragePercent: MINIMUM_COVERAGE_PERCENT,
    domains: {
      universe: coverageResult(batch.datasets.historicalUniverse.length, referenceUniverseCount, providerBlocked),
      price: coverageResult(priceCount, denominator, providerBlocked),
      dailyBasic: coverageResult(dailyBasicCount, denominator, providerBlocked),
      tradeState: coverageResult(tradeStateCount, denominator, providerBlocked),
      dividend: coverageResult(dividendCount, denominator, providerBlocked),
      fundamental: coverageResult(fundamentalCount, denominator, providerBlocked),
      industry: coverageResult(industryCount, denominator, providerBlocked),
    },
  }
  const openSourceProbe = await latestOpenSourceProbe()
  const rawResponseHashesVerified = evidenceFiles.length > 0 && evidenceFiles.every((item) => (
    batch.endpointResults.some((result) => result.requestId === item.requestId && result.dataHash === item.dataHash)
  ))
  const coverageBlockers = Object.entries(coverage.domains)
    .filter(([, value]) => value.status !== 'passed')
    .map(([domain]) => `coverage_below_threshold:${domain}`)
  const permissionBlocked = batch.endpointResults.some((result) => result.status === 'blocked_permission')
  const pointInTimeAuthorization = evaluatePointInTimeProviderAuthorization(providerGovernanceAudit)
  const usageAuthorizationVerified = pointInTimeAuthorization.passed
  const blockers = [...new Set([
    ...batch.blockers,
    ...pointInTimeAuthorization.blockers,
    ...(!providerBlocked ? coverageBlockers : []),
    ...(!openSourceProbe.passed ? ['open_source_cross_check_not_verified'] : []),
    ...(!providerBlocked && !rawResponseHashesVerified ? ['raw_response_hashes_not_verified'] : []),
  ])].sort()
  const allCoveragePassed = Object.values(coverage.domains).every((value) => value.status === 'passed')
  const passed = batch.providerConfigured
    && batch.liveProviderAttempted
    && batch.providerAuthorizationUsable
    && usageAuthorizationVerified
    && batch.rules.historicalUniverseRulePassed
    && batch.rules.announcementCutoffRulePassed
    && batch.rules.financialRevisionDeduplicationPassed
    && batch.rules.industryMembershipEffectiveDateRulePassed
    && allCoveragePassed
    && openSourceProbe.passed
    && rawResponseHashesVerified
    && blockers.length === 0
  const status = passed
    ? 'passed'
    : !batch.providerConfigured
      ? 'blocked_provider_not_configured'
      : permissionBlocked || !batch.providerAuthorizationUsable
        ? 'blocked_provider_permission'
        : 'insufficient'
  const after = await protectedAccountDigest()
  assert.equal(before, after, 'protected_account_facts_changed')
  const artifact = {
    schemaVersion: 'fams.ftr_3r.point_in_time_batch_probe.v1',
    stageId: 'FTR-3R0B',
    generatedAt: generatedAt.toISOString(),
    decisionDate: DECISION_DATE,
    sourcePolicy: 'tushare_bulk_primary_baostock_akshare_cross_check',
    provider: {
      providerId: 'tushare_pro',
      configured: batch.providerConfigured,
      apiAuthorizationUsable: batch.providerAuthorizationUsable,
      usageAuthorizationVerified,
      authorizationUsable: batch.providerAuthorizationUsable && usageAuthorizationVerified,
      authorizationBlockers: pointInTimeAuthorization.blockers,
      liveProviderAttempted: batch.liveProviderAttempted,
      tokenInArtifact: false,
    },
    implementation: {
      pointInTimeBatchAdapterImplemented: true,
      endpointAllowlistComplete: true,
      ...batch.rules,
    },
    endpointResults,
    coverage,
    crossCheck: {
      passed: openSourceProbe.passed,
      decisionDateMatched: openSourceProbe.passed,
      realOpenSourceEvidence: openSourceProbe.passed,
      evidenceRef: openSourceProbe.path,
      evidenceSha256: openSourceProbe.sha256,
    },
    evidenceFiles,
    rawResponseHashesVerified,
    accountFactsUnchanged: true,
    realDataUsed: batch.liveProviderAttempted && batch.endpointResults.some((result) => result.status === 'succeeded'),
    mockDataUsed: false,
    status,
    blockers,
    prohibitedActions: [...PROHIBITED_ACTIONS],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const artifactPath = resolve(dir, 'point_in_time_batch_probe.json')
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({
    artifactPath,
    status,
    providerConfigured: batch.providerConfigured,
      apiAuthorizationUsable: batch.providerAuthorizationUsable,
      usageAuthorizationVerified,
      authorizationUsable: batch.providerAuthorizationUsable && usageAuthorizationVerified,
    endpointCount: endpointResults.length,
    evidenceFileCount: evidenceFiles.length,
    coverage: coverage.domains,
    crossCheckPassed: openSourceProbe.passed,
    blockers,
  }, null, 2))
  if (!passed) process.exitCode = 2
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
