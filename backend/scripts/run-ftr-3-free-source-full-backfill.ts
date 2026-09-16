import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'
import { freePointInTimeSnapshotService } from '../src/services/formal-release/freePointInTimeSnapshotService.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const lakeDir = resolve(process.cwd(), 'data', 'formal-release', 'ftr3-free-source-v1')
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const

function runCollector() {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('python3', [
      resolve(process.cwd(), 'scripts', 'providers', 'ftr_3_free_source_full_backfill.py'),
      '--lake-dir', lakeDir,
      '--workers', '4',
      '--mode', 'all',
    ], { stdio: 'inherit' })
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('free_source_full_backfill_exceeded_6h'))
    }, 6 * 60 * 60 * 1000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else reject(new Error(`free_source_collector_exit_${code}`))
    })
  })
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
  const schema = JSON.parse(await readFile(resolve(repoRoot, 'docs', 'contracts', 'ftr-3-free-source-full-backfill.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors))
}

async function latestPassedBatchProbe() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0B-FREE')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const path = resolve(root, name, 'free_source_batch_probe.json')
    try {
      const raw = await readFile(path, 'utf8')
      const artifact = JSON.parse(raw)
      if (artifact.status === 'passed' && artifact.summary?.sourceTermsPassed === true && artifact.sourceTerms?.usageScope === 'local_personal_noncommercial') {
        return { path, raw, artifact }
      }
    } catch {
      // Partial attempts are retained but cannot become the source-terms authority.
    }
  }
  throw new Error('passed_free_source_terms_evidence_not_found')
}

async function main() {
  await runCollector()
  await initializePrisma()
  const before = await protectedAccountDigest()
  const sourceTerms = await latestPassedBatchProbe()
  const generatedAt = new Date()
  const outputDir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0B-FREE', generatedAt.toISOString().replace(/[:.]/g, '-'))
  await mkdir(outputDir, { recursive: true })
  const result = await freePointInTimeSnapshotService.build(lakeDir, outputDir)
  const readyDecisionPointCount = result.decisionPoints.filter((point) => point.pointInTimeSelectionReady).length
  const allDecisionPointsReady = readyDecisionPointCount === 6 && result.allArtifactHashesVerified
  const after = await protectedAccountDigest()
  const accountFactsUnchanged = before === after
  assert.equal(accountFactsUnchanged, true, 'protected_account_facts_changed')
  const blockers = Array.from(new Set([
    ...result.decisionPoints.flatMap((point) => point.blockers),
    ...(result.allArtifactHashesVerified ? [] : ['artifact_hash_verification_failed']),
  ])).sort()
  const artifact = {
    schemaVersion: 'fams.ftr_3r.free_source_full_backfill.v2',
    stageId: 'FTR-3R0B-FREE',
    generatedAt: generatedAt.toISOString(),
    dataRoute: 'qualified_free_source_point_in_time',
    lake: {
      lakeId: 'ftr3-free-source-v1',
      path: result.lakeDir,
      manifestPath: result.lakeManifestPath,
      manifestSha256: result.lakeManifestSha256,
      fileCount: result.lakeFileCount,
      allArtifactHashesVerified: result.allArtifactHashesVerified,
    },
    providerPolicy: {
      paidCredentialRequired: false,
      historicalMembershipProvider: 'baostock_stock_basic_lifecycle',
      historicalSecurityStatusProvider: 'baostock_query_history_k_data_plus_isST_tradestatus',
      priceAndTradeabilityProvider: 'baostock_tradestatus_cross_checked_by_tencent_unadjusted_daily',
      fundamentalAndDividendProvider: 'akshare_eastmoney_bulk',
      providerFailuresRemainInDenominator: true,
      currentSnapshotFallbackAllowed: false,
      mockDataAllowed: false,
    },
    sourceTermsEvidence: {
      path: sourceTerms.path,
      sha256: sha256Canonical(JSON.parse(sourceTerms.raw)),
      usageScope: sourceTerms.artifact.sourceTerms.usageScope,
      sourceTermsPermitConfiguredUse: sourceTerms.artifact.sourceTerms.sourceTermsPermitConfiguredUse,
      commercialRedistributionAllowed: sourceTerms.artifact.sourceTerms.commercialRedistributionAllowed,
      sdkLicenseNotTreatedAsDataLicense: sourceTerms.artifact.sourceTerms.sdkLicenseNotTreatedAsDataLicense,
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
    decisionPoints: result.decisionPoints,
    summary: {
      readyDecisionPointCount,
      decisionPointCount: 6,
      allDecisionPointsReady,
      freeSourceFullMarketBackfillReady: allDecisionPointsReady,
      qualifiedPointInTimeProviderReady: allDecisionPointsReady,
      ftr3CandidateRedesignAllowed: allDecisionPointsReady,
      ftr4EntryAllowed: false,
    },
    antiFalseGreen: {
      currentUniverseUsedAsHistoricalMembership: false,
      futureAnnouncementReuseDetected: false,
      providerFailuresRemovedFromDenominator: false,
      rawShardOverwriteAllowed: false,
      mockOrCurrentSnapshotFallbackUsed: false,
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
  const artifactPath = resolve(outputDir, 'free_source_full_backfill.json')
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
