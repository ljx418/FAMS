import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { DEFERRED_REVIEW_TYPES, deferredHumanReviewQueueService } from '../src/services/formal-release/deferredHumanReviewQueueService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const USER_ID = 'default'

async function readJson(path: string) { return JSON.parse(await readFile(path, 'utf8')) }
function sha256Bytes(value: Buffer) { return createHash('sha256').update(value).digest('hex') }

async function latestAuditDir() {
  if (process.env.FTR4_AUDIT_DIR) return resolve(process.env.FTR4_AUDIT_DIR)
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-4')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      const queue = await readJson(resolve(dir, 'deferred_human_review_queue.json'))
      if (queue.batchHumanReviewReady === true && queue.manualSignoffPassed === false) return dir
    } catch {
      // Ignore partial runs.
    }
  }
  throw new Error('ftr4_review_queue_not_found')
}

async function validateSchema(schemaName: string, value: unknown) {
  const schema = await readJson(resolve(repoRoot, 'docs', 'contracts', schemaName))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  assert.equal(validate(value), true, `${schemaName}: ${JSON.stringify(validate.errors)}`)
}

async function protectedAccountDigest() {
  const [positions, transactions, drafts, externalOrders] = await Promise.all([
    prisma.position.findMany({ where: { userId: USER_ID }, select: { id: true, assetId: true, quantity: true, avgCost: true, currentPrice: true, marketValue: true, costBasis: true, unrealizedPnl: true, realizedPnl: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId: USER_ID }, select: { id: true, type: true, quantity: true, price: true, executedAt: true }, orderBy: { id: 'asc' } }),
    prisma.gridOrderDraft.findMany({ where: { gridPlan: { userId: USER_ID } }, select: { id: true, side: true, price: true, quantity: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.externalOrderObservation.findMany({ where: { userId: USER_ID }, select: { id: true, externalOrderId: true, status: true }, orderBy: { id: 'asc' } }),
  ])
  return {
    positionCount: positions.length, openPositionCount: positions.filter((item) => item.status === 'open').length, positionHash: sha256Canonical(positions),
    transactionCount: transactions.length, transactionHash: sha256Canonical(transactions), draftCount: drafts.length, draftHash: sha256Canonical(drafts),
    externalOrderCount: externalOrders.length, externalOrderHash: sha256Canonical(externalOrders),
  }
}

async function main() {
  await initializePrisma()
  const dir = await latestAuditDir()
  const artifacts = {
    sourceManifest: await readJson(resolve(dir, 'ftr4_queue_source_manifest.json')),
    queue: await readJson(resolve(dir, 'deferred_human_review_queue.json')),
    manualAudit: await readJson(resolve(dir, '18_manual_signoff_audit.json')),
    records: await readJson(resolve(dir, 'manual_signoff_records.json')),
    draftReview: await readJson(resolve(dir, 'manual_trade_plan_draft_review.json')),
  }
  await Promise.all([
    validateSchema('ftr-4-queue-source-manifest.schema.json', artifacts.sourceManifest),
    validateSchema('deferred-human-review-queue.schema.json', artifacts.queue),
    validateSchema('ftr-4-manual-signoff-audit.schema.json', artifacts.manualAudit),
    validateSchema('ftr-4-manual-signoff-records.schema.json', artifacts.records),
    validateSchema('ftr-4-manual-trade-plan-draft-review.schema.json', artifacts.draftReview),
  ])

  const manifestPath = resolve(repoRoot, artifacts.queue.sourceManifest.path)
  assert.equal(sha256Bytes(await readFile(manifestPath)), artifacts.queue.sourceManifest.sha256)
  assert.equal(resolve(manifestPath), resolve(dir, 'ftr4_queue_source_manifest.json'))
  assert.equal(artifacts.sourceManifest.gitEvidenceStatus, artifacts.queue.gitEvidenceStatus)
  assert.equal(artifacts.sourceManifest.worktreeSnapshotHash, artifacts.queue.worktreeSnapshotHash)
  assert.equal(sha256Canonical(artifacts.sourceManifest.worktreeFiles), artifacts.sourceManifest.worktreeSnapshotHash)

  const stateSnapshotRaw = await readFile(resolve(repoRoot, artifacts.sourceManifest.sourceState.path))
  assert.equal(sha256Bytes(stateSnapshotRaw), artifacts.sourceManifest.sourceState.sha256)
  const stateSnapshot = JSON.parse(stateSnapshotRaw.toString('utf8'))
  assert.equal(stateSnapshot.statuses.ftr4EntryAllowed, true)
  assert.equal(stateSnapshot.statuses.formalValidationPassed, true)
  assert.equal(stateSnapshot.featureTracks.v2PxExternalBrain.px6_02HumanAcceptanceStatus, 'not_performed_0_of_10')

  for (const source of artifacts.sourceManifest.sources) {
    for (const artifact of source.artifacts) {
      const raw = await readFile(resolve(repoRoot, artifact.path))
      assert.equal(raw.byteLength, artifact.bytes, `artifact byte count mismatch: ${artifact.path}`)
      assert.equal(sha256Bytes(raw), artifact.sha256, `artifact hash mismatch: ${artifact.path}`)
    }
  }
  assert.deepEqual(artifacts.sourceManifest.protectedAccountDigestAfter, artifacts.sourceManifest.protectedAccountDigestBefore)
  assert.deepEqual(await protectedAccountDigest(), artifacts.sourceManifest.protectedAccountDigestAfter)

  assert.deepEqual(artifacts.queue.items.map((item: any) => item.reviewType), [...DEFERRED_REVIEW_TYPES])
  assert.equal(new Set(artifacts.queue.items.map((item: any) => item.reviewType)).size, 8)
  assert.equal(artifacts.queue.items.every((item: any) => item.status === 'pending' && item.reviewer === null && item.reviewedAt === null), true)
  for (const item of artifacts.queue.items) {
    const source = artifacts.sourceManifest.sources.find((candidate: any) => candidate.reviewType === item.reviewType)
    assert.ok(source)
    assert.deepEqual(item.artifactRefs, source.artifacts.map((artifact: any) => artifact.path))
    assert.deepEqual(item.artifactHashes, source.artifacts.map((artifact: any) => artifact.sha256))
  }
  const riskSource = artifacts.sourceManifest.sources.find((source: any) => source.reviewType === 'risk')
  assert.ok(riskSource)
  if (stateSnapshot.statuses.ftr5CurrentChainExecutionIsolationPassed === true) {
    assert.equal(riskSource.evidenceStatus, 'automated_pass_human_pending')
    assert.equal(riskSource.artifacts.some((artifact: any) => artifact.originPath.endsWith('/13_execution_isolation_audit.json')), true)
    assert.equal(riskSource.artifacts.some((artifact: any) => artifact.originPath.endsWith('/trade_boundary_wording_audit.json')), true)
    assert.equal(riskSource.artifacts.some((artifact: any) => artifact.originPath.endsWith('/production_adapter_approval_record.json')), true)
    assert.equal(artifacts.queue.items.find((item: any) => item.reviewType === 'risk').blockers.includes('ftr5_evidence_rebind_required'), false)
  }
  const rebuilt = deferredHumanReviewQueueService.build({
    generatedAt: artifacts.queue.generatedAt,
    commitSha: artifacts.queue.commitSha,
    gitEvidenceStatus: artifacts.queue.gitEvidenceStatus,
    worktreeSnapshotHash: artifacts.queue.worktreeSnapshotHash,
    sourceManifest: artifacts.queue.sourceManifest,
    sources: artifacts.sourceManifest.sources.map((source: any) => ({
      reviewType: source.reviewType,
      evidenceStatus: source.evidenceStatus,
      rollbackStage: artifacts.queue.items.find((item: any) => item.reviewType === source.reviewType).rollbackStage,
      artifacts: source.artifacts.map(({ path, sha256 }: any) => ({ path, sha256 })),
    })),
  })
  assert.deepEqual(rebuilt, artifacts.queue)

  assert.deepEqual(artifacts.records, [])
  assert.equal(artifacts.manualAudit.recordCount, 0)
  assert.equal(artifacts.manualAudit.manualSignoffPassed, false)
  assert.equal(artifacts.manualAudit.automationSelfApprovalBlocked, true)
  assert.deepEqual(artifacts.manualAudit.requiredRoles, ['data', 'model', 'risk', 'compliance', 'final_release'])
  assert.deepEqual(artifacts.manualAudit.records.map((item: any) => item.status), ['missing', 'missing', 'missing', 'missing', 'missing'])
  assert.equal(artifacts.draftReview.formalDraftCount, 0)
  assert.equal(artifacts.draftReview.formalTargetWeightPercent, 0)
  assert.deepEqual(artifacts.draftReview.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  for (const artifact of [artifacts.sourceManifest, artifacts.queue, artifacts.manualAudit, artifacts.draftReview]) {
    for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(artifact[field], false)
  }

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_4.deferred_human_review_queue_verification.v1', status: 'passed', auditDir: dir,
    schemaValidationPassed: true, semanticValidationPassed: true, sourceManifestVerified: true,
    queueItemCount: 8, uniqueReviewTypeCount: 8, pendingReviewCount: 8, approvedReviewCount: 0,
    allQueuedArtifactHashesVerified: true, manualSignoffRecordCount: 0, automationSelfApprovalBlocked: true,
    batchHumanReviewReady: true, manualSignoffPassed: false, humanAcceptanceStatus: 'pending_batch_review',
    v2PxHumanExperienceStatus: 'not_performed_0_of_10', accountFactsUnchanged: true,
    formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => { await prisma.$disconnect() })
