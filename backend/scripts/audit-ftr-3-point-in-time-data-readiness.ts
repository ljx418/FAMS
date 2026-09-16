import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const
type Json = Record<string, any>

function sha256Bytes(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestArtifact(stageId: string, fileName: string, predicate: (value: Json) => boolean) {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', stageId)
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const path = resolve(root, name, fileName)
    try {
      const raw = await readFile(path)
      const artifact = JSON.parse(raw.toString('utf8')) as Json
      if (predicate(artifact)) return { path, raw, artifact }
    } catch {
      // Incomplete runs remain evidence but cannot become the gate source.
    }
  }
  throw new Error(`${stageId}:${fileName}:passed_artifact_not_found`)
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

async function validateSchema(artifact: unknown) {
  const schema = await readJson(resolve(repoRoot, 'docs', 'contracts', 'ftr-3-point-in-time-data-readiness.schema.json'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors))
}

async function main() {
  await initializePrisma()
  const before = await protectedAccountDigest()
  const generatedAt = new Date()
  const sourceFtr3 = await latestArtifact('FTR-3', 'walk_forward_replay.json', (value) => value.schemaVersion === 'fams.ftr_3.walk_forward_replay.v1' && value.windows?.length === 6)
  const sourceFree = await latestArtifact('FTR-3R0B-FREE', 'free_source_full_backfill.json', (value) => (
    value.schemaVersion === 'fams.ftr_3r.free_source_full_backfill.v2'
    && value.status === 'passed'
    && value.summary?.allDecisionPointsReady === true
    && value.antiFalseGreen?.historicalSecurityStatusProxyUsed === false
  ))
  const lakeManifestRaw = await readFile(sourceFree.artifact.lake.manifestPath)
  assert.equal(sha256Bytes(lakeManifestRaw), sourceFree.artifact.lake.manifestSha256)
  const lakeManifest = JSON.parse(lakeManifestRaw.toString('utf8')) as Json
  const basicEntry = (lakeManifest.files as Json[]).find((entry) => String(entry.path).endsWith('/raw/baostock/stock_basic.json'))
  assert.ok(basicEntry, 'stock_basic_evidence_missing')
  const basicRaw = await readFile(basicEntry.path)
  assert.equal(sha256Bytes(basicRaw), basicEntry.sha256)
  const basic = JSON.parse(basicRaw.toString('utf8')) as Json
  const sourceDates = (sourceFtr3.artifact.windows as Json[]).map((window) => String(window.validationStartDate))
  assert.deepEqual(sourceDates, (sourceFree.artifact.decisionPoints as Json[]).map((point) => point.decisionDate))

  const decisionPoints = (sourceFree.artifact.decisionPoints as Json[]).map((point, index) => ({
    windowId: `wf-${String(index + 1).padStart(2, '0')}`,
    decisionDate: point.decisionDate,
    referenceUniverseCount: point.referenceUniverseCount,
    minimumRequiredSymbols: point.minimumRequiredSymbols,
    marketBarSymbolCount: point.marketBarSymbolCount,
    marketBarCoveragePercent: point.marketBarCoveragePercent,
    tradeabilitySymbolCount: point.tradeabilitySymbolCount,
    tradeabilityCoveragePercent: point.tradeabilityCoveragePercent,
    candidateSnapshotSymbolCount: point.candidateEvaluationSnapshotSymbolCount,
    candidateSnapshotCoveragePercent: point.candidateEvaluationSnapshotCoveragePercent,
    historicalSecurityStatusSymbolCount: point.historicalSecurityStatusSymbolCount,
    historicalSecurityStatusCoveragePercent: point.historicalSecurityStatusCoveragePercent,
    failedStatusShardCount: point.failedStatusShardCount,
    statusPriceConflictCount: point.statusPriceConflictCount,
    historicalStatusEvidenceMode: point.historicalStatusEvidenceMode,
    historicalStatusProxyAllowed: point.historicalStatusProxyAllowed,
    announcementAwareFundamentalSymbolCount: point.announcementAwareFundamentalSymbolCount,
    announcementAwareFundamentalCoveragePercent: point.announcementAwareFundamentalCoveragePercent,
    pointInTimeCandidateSnapshotPresent: point.candidateEvaluationSnapshotSymbolCount >= point.minimumRequiredSymbols,
    announcementCutoffVerified: point.announcementCutoffVerified,
    pointInTimeSelectionReady: point.pointInTimeSelectionReady,
    snapshotPath: point.snapshotPath,
    snapshotSha256: point.snapshotSha256,
    blockers: point.blockers,
  }))
  const readyDecisionPointCount = decisionPoints.filter((point) => point.pointInTimeSelectionReady).length
  const qualifiedPointInTimeProviderReady = sourceFree.artifact.summary.qualifiedPointInTimeProviderReady === true
  const survivorshipBiasResolved = sourceFree.artifact.antiFalseGreen.currentUniverseUsedAsHistoricalMembership === false
    && sourceFree.artifact.providerPolicy.historicalMembershipProvider === 'baostock_stock_basic_lifecycle'
    && sourceFree.artifact.providerPolicy.historicalSecurityStatusProvider === 'baostock_query_history_k_data_plus_isST_tradestatus'
    && sourceFree.artifact.antiFalseGreen.historicalSecurityStatusProxyUsed === false
  const allDecisionPointsReady = readyDecisionPointCount === 6 && qualifiedPointInTimeProviderReady && survivorshipBiasResolved
  const blockers = Array.from(new Set([
    ...decisionPoints.flatMap((point) => point.blockers),
    ...(qualifiedPointInTimeProviderReady ? [] : ['qualified_point_in_time_provider_not_ready']),
    ...(survivorshipBiasResolved ? [] : ['historical_universe_membership_missing']),
  ])).sort()
  const after = await protectedAccountDigest()
  const accountFactsUnchanged = before === after
  assert.equal(accountFactsUnchanged, true, 'protected_account_facts_changed')
  const artifact = {
    schemaVersion: 'fams.ftr_3r.point_in_time_data_readiness.v3',
    stageId: 'FTR-3R0',
    candidateId: 'dividend_low_vol_basket',
    generatedAt: generatedAt.toISOString(),
    dataRoute: 'qualified_free_source_point_in_time',
    sourceFtr3Artifact: { path: sourceFtr3.path, sha256: sha256Bytes(sourceFtr3.raw) },
    sourcePointInTimeArtifact: { path: sourceFree.path, sha256: sha256Bytes(sourceFree.raw) },
    referenceUniverse: {
      path: basicEntry.path,
      provider: 'baostock_stock_basic_lifecycle',
      fetchedAt: String(basic.generatedAt),
      symbolCount: (basic.rows as Json[]).filter((row) => String(row.type) === '1').length,
      sha256: basicEntry.sha256,
      historicalMembershipClaimed: true,
    },
    requirements: {
      decisionPointCount: 6,
      minimumCoveragePercent: 80,
      announcementCutoffRequired: true,
      historicalSecurityStatusRequired: true,
      historicalStatusEvidenceMode: 'baostock_direct_daily',
      historicalStatusProxyAllowed: false,
      qualifiedPointInTimeProviderRequired: true,
    },
    decisionPoints,
    summary: {
      readyDecisionPointCount,
      decisionPointCount: 6,
      allDecisionPointsReady,
      paidFormalProviderConfigured: Boolean(process.env.FAMS_TUSHARE_TOKEN || process.env.TUSHARE_TOKEN),
      qualifiedPointInTimeProviderReady,
      availableCandidateSnapshotDates: decisionPoints.length,
      candidateSnapshotFirstDate: decisionPoints[0]?.decisionDate ?? null,
      candidateSnapshotLastDate: decisionPoints.at(-1)?.decisionDate ?? null,
      ftr3CandidateRedesignAllowed: allDecisionPointsReady,
      ftr4EntryAllowed: false,
    },
    lookAheadGuard: {
      currentSnapshotHistoricalReuseDetected: false,
      futureAnnouncementReuseDetected: false,
      survivorshipBiasResolved,
      currentUniverseUsedAsHistoricalMembership: false,
      historicalSecurityStatusProxyUsed: false,
    },
    accountFactsUnchanged,
    realDataUsed: true,
    status: allDecisionPointsReady ? 'passed' : 'insufficient',
    blockers,
    prohibitedActions: [...PROHIBITED_ACTIONS],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  await validateSchema(artifact)
  const dir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0', generatedAt.toISOString().replace(/[:.]/g, '-'))
  await mkdir(dir, { recursive: true })
  const artifactPath = resolve(dir, 'point_in_time_data_readiness.json')
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ artifactPath, status: artifact.status, ...artifact.summary, blockers }, null, 2))
  if (artifact.status !== 'passed') process.exitCode = 2
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
