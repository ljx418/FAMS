import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { deferredHumanReviewQueueService, type DeferredReviewSource, type DeferredReviewType } from '../src/services/formal-release/deferredHumanReviewQueueService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'
import { ManualSignoffService, type FormalReleaseSignoffRecord, type FormalReleaseSignoffStore } from '../src/services/formal-release/manualSignoffService.js'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(process.cwd(), '..')
const USER_ID = 'default'
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const

type Json = Record<string, any>

function sha256Bytes(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex')
}

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJson(path: string, value: unknown) {
  const body = `${JSON.stringify(value, null, 2)}\n`
  await writeFile(path, body, { encoding: 'utf8', flag: 'wx' })
  return { path: relative(repoRoot, path), sha256: sha256Bytes(body) }
}

async function latestValidDir(stageId: 'A0' | 'FTR-1' | 'FTR-2' | 'FTR-3' | 'FTR-5', fileName: string, predicate: (value: Json) => boolean) {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', stageId)
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      await readFile(resolve(dir, 'INVALIDATED.json'))
      continue
    } catch {
      // Eligible runs have no invalidation marker.
    }
    try {
      const artifact = await readJson(resolve(dir, fileName))
      if (predicate(artifact)) return { dir, artifact }
    } catch {
      // Ignore partial runs.
    }
  }
  throw new Error(`${stageId.toLowerCase()}_eligible_evidence_not_found`)
}

async function protectedAccountDigest() {
  const [positions, transactions, drafts, externalOrders] = await Promise.all([
    prisma.position.findMany({ where: { userId: USER_ID }, select: { id: true, assetId: true, quantity: true, avgCost: true, currentPrice: true, marketValue: true, costBasis: true, unrealizedPnl: true, realizedPnl: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId: USER_ID }, select: { id: true, type: true, quantity: true, price: true, executedAt: true }, orderBy: { id: 'asc' } }),
    prisma.gridOrderDraft.findMany({ where: { gridPlan: { userId: USER_ID } }, select: { id: true, side: true, price: true, quantity: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.externalOrderObservation.findMany({ where: { userId: USER_ID }, select: { id: true, externalOrderId: true, status: true }, orderBy: { id: 'asc' } }),
  ])
  return {
    positionCount: positions.length,
    openPositionCount: positions.filter((item) => item.status === 'open').length,
    positionHash: sha256Canonical(positions),
    transactionCount: transactions.length,
    transactionHash: sha256Canonical(transactions),
    draftCount: drafts.length,
    draftHash: sha256Canonical(drafts),
    externalOrderCount: externalOrders.length,
    externalOrderHash: sha256Canonical(externalOrders),
  }
}

async function gitSnapshot() {
  const [{ stdout: commitStdout }, { stdout: filesStdout }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }),
    execFileAsync('git', ['ls-files', '--modified', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
  ])
  const paths = filesStdout.split('\0').filter(Boolean).sort()
  const files: Array<{ path: string; sha256: string }> = []
  for (const path of paths) {
    const absolute = resolve(repoRoot, path)
    try {
      if ((await stat(absolute)).isFile()) files.push({ path, sha256: sha256Bytes(await readFile(absolute)) })
    } catch {
      files.push({ path, sha256: sha256Bytes('deleted') })
    }
  }
  return {
    baseCommitSha: commitStdout.trim(),
    gitEvidenceStatus: files.length === 0 ? 'clean_commit' as const : 'uncommitted_worktree_snapshot' as const,
    files,
    worktreeSnapshotHash: sha256Canonical(files),
  }
}

class EmptySignoffStore implements FormalReleaseSignoffStore {
  async list(): Promise<FormalReleaseSignoffRecord[]> { return [] }
  async create(): Promise<FormalReleaseSignoffRecord> { throw new Error('automation_signoff_creation_forbidden') }
}

async function main() {
  await initializePrisma()
  const generatedAt = new Date().toISOString()
  const outputDir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-4', generatedAt.replace(/[:.]/g, '-'))
  const evidenceDir = resolve(outputDir, 'evidence')
  await mkdir(evidenceDir, { recursive: true })

  const accountBefore = await protectedAccountDigest()
  assert.ok(accountBefore.openPositionCount > 0, 'real_default_account_has_no_open_positions')
  const statePath = resolve(repoRoot, 'docs', 'current-stage-state.json')
  const state = await readJson(statePath)
  assert.equal(state.statuses.ftr4EntryAllowed, true)
  assert.equal(state.statuses.formalValidationPassed, true)
  assert.equal(state.featureTracks.v2PxExternalBrain.px6_02HumanAcceptanceStatus, 'not_performed_0_of_10')
  for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(state.statuses[field], false)

  const [a0, ftr1, ftr2, ftr3, git] = await Promise.all([
    latestValidDir('A0', 'a0_acceptance_audit.json', (value) => value.status === 'passed' && value.productCandidateVersion === 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time'),
    latestValidDir('FTR-1', '15_data_governance_audit.json', (value) => value.status === 'passed' && value.formalDataGovernancePassed === true),
    latestValidDir('FTR-2', '16_benchmark_qualification_audit.json', (value) => value.status === 'passed' && value.benchmarkQualificationPassed === true),
    latestValidDir('FTR-3', '17_formal_validation_audit.json', (value) => value.status === 'passed' && value.formalValidationPassed === true),
    gitSnapshot(),
  ])
  const ftr5 = state.statuses.ftr5CurrentChainExecutionIsolationPassed === true
    ? await latestValidDir('FTR-5', '13_execution_isolation_audit.json', (value) => value.status === 'ready_for_paper_review'
      && value.accountFactsUnchanged === true
      && value.productionAdapterEnabled === false
      && value.realPositionMutationAllowed === false)
    : null

  const sourcePaths: Record<DeferredReviewType, { stageId: string; evidenceStatus: 'automated_pass_human_pending' | 'automated_pass_rebind_after_ftr5' | 'pending_final_package'; rollbackStage: DeferredReviewSource['rollbackStage']; paths: string[] }> = {
    daily_user_experience: {
      stageId: 'UX-F7', evidenceStatus: 'automated_pass_human_pending', rollbackStage: 'UX', paths: [
        'backend/data/gpt-audit/ux-f7/latest/frontend_runtime_visual_acceptance.json',
        'backend/data/gpt-audit/ux-f7/latest/asset_excel_flow_audit.json',
        'backend/data/gpt-audit/ux-f7/latest/acceptance-report.html',
        'backend/data/gpt-audit/ux-f7/latest/screenshots/dashboard-desktop.png',
        'backend/data/gpt-audit/ux-f7/latest/screenshots/dashboard-mobile.png',
        'backend/data/gpt-audit/ux-f7/latest/screenshots/assets-desktop.png',
        'backend/data/gpt-audit/ux-f7/latest/screenshots/assets-mobile.png',
      ],
    },
    v2_px_experience: {
      stageId: 'V2-PX-PX6-02', evidenceStatus: 'automated_pass_human_pending', rollbackStage: 'V2-PX-PX6-02', paths: [
        'docs/audits/v2-px/PX6_01/ACCEPTANCE_AUDIT.md',
        'docs/audits/v2-px/PX6_01/PRD_SPEC_REVIEW.md',
        'docs/generated/v2-px-human-acceptance.html',
      ],
    },
    data: {
      stageId: 'FTR-1', evidenceStatus: 'automated_pass_human_pending', rollbackStage: 'FTR-1', paths: [
        relative(repoRoot, resolve(ftr1.dir, '15_data_governance_audit.json')),
        relative(repoRoot, resolve(ftr1.dir, 'field_evidence_validation_audit.json')),
        relative(repoRoot, resolve(ftr1.dir, 'provider_authorization_audit.json')),
      ],
    },
    benchmark: {
      stageId: 'FTR-2', evidenceStatus: 'automated_pass_human_pending', rollbackStage: 'FTR-2', paths: [
        relative(repoRoot, resolve(ftr2.dir, '16_benchmark_qualification_audit.json')),
        relative(repoRoot, resolve(ftr2.dir, 'benchmark_total_return_replay.json')),
        relative(repoRoot, resolve(ftr2.dir, 'benchmark_license_review.json')),
      ],
    },
    model: {
      stageId: 'FTR-3', evidenceStatus: 'automated_pass_human_pending', rollbackStage: 'FTR-3', paths: [
        relative(repoRoot, resolve(ftr3.dir, '17_formal_validation_audit.json')),
        relative(repoRoot, resolve(ftr3.dir, 'walk_forward_replay.json')),
        relative(repoRoot, resolve(ftr3.dir, 'parameter_replay.json')),
        relative(repoRoot, resolve(ftr3.dir, 'group_stability.json')),
      ],
    },
    risk: {
      stageId: 'FTR-5', evidenceStatus: ftr5 ? 'automated_pass_human_pending' : 'automated_pass_rebind_after_ftr5', rollbackStage: 'FTR-5', paths: ftr5
        ? [
            relative(repoRoot, resolve(ftr5.dir, '13_execution_isolation_audit.json')),
            relative(repoRoot, resolve(ftr5.dir, 'trade_boundary_wording_audit.json')),
            relative(repoRoot, resolve(ftr5.dir, 'production_adapter_approval_record.json')),
          ]
        : [
            relative(repoRoot, resolve(ftr3.dir, 'tradeability_reconciliation.json')),
            'docs/TRADE_BOUNDARY_CONTRACT.md',
          ],
    },
    compliance: {
      stageId: 'A0', evidenceStatus: 'automated_pass_human_pending', rollbackStage: 'FTR-6', paths: [
        relative(repoRoot, resolve(a0.dir, 'provider_authorization_audit.json')),
        relative(repoRoot, resolve(a0.dir, 'public_source_use_declaration.json')),
        relative(repoRoot, resolve(ftr2.dir, 'benchmark_license_review.json')),
      ],
    },
    final_release: {
      stageId: 'FTR-6', evidenceStatus: 'pending_final_package', rollbackStage: 'FTR-6', paths: [
        relative(repoRoot, resolve(a0.dir, 'a0_acceptance_audit.json')),
        relative(repoRoot, resolve(ftr3.dir, '17_formal_validation_audit.json')),
      ],
    },
  }

  const stateSnapshotPath = resolve(evidenceDir, '00-current-stage-state-snapshot.json')
  await copyFile(statePath, stateSnapshotPath)
  const stateSnapshotRaw = await readFile(stateSnapshotPath)
  const sourceState = { path: relative(repoRoot, stateSnapshotPath), originPath: 'docs/current-stage-state.json', sha256: sha256Bytes(stateSnapshotRaw), bytes: stateSnapshotRaw.byteLength }

  let snapshotIndex = 1
  const sources = []
  for (const reviewType of Object.keys(sourcePaths) as DeferredReviewType[]) {
    const source = sourcePaths[reviewType]
    const artifacts = []
    for (const originPath of source.paths) {
      const origin = resolve(repoRoot, originPath)
      const raw = await readFile(origin)
      const snapshotPath = resolve(evidenceDir, `${String(snapshotIndex).padStart(2, '0')}-${reviewType}-${basename(originPath)}`)
      snapshotIndex += 1
      await copyFile(origin, snapshotPath)
      artifacts.push({ path: relative(repoRoot, snapshotPath), originPath, sha256: sha256Bytes(raw), bytes: raw.byteLength })
    }
    sources.push({ reviewType, stageId: source.stageId, evidenceStatus: source.evidenceStatus, artifacts, rollbackStage: source.rollbackStage })
  }

  const accountAfter = await protectedAccountDigest()
  assert.deepEqual(accountAfter, accountBefore)
  const sourceManifest = {
    schemaVersion: 'fams.ftr_4.queue_source_manifest.v1',
    generatedAt,
    sourceState,
    baseCommitSha: git.baseCommitSha,
    gitEvidenceStatus: git.gitEvidenceStatus,
    worktreeFiles: git.files,
    worktreeSnapshotHash: git.worktreeSnapshotHash,
    sources: sources.map(({ rollbackStage: _rollbackStage, ...source }) => source),
    allArtifactHashesPresent: true,
    invalidatedArtifactIncluded: false,
    protectedAccountDigestBefore: accountBefore,
    protectedAccountDigestAfter: accountAfter,
    accountFactsUnchanged: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const sourceManifestRef = await writeJson(resolve(outputDir, 'ftr4_queue_source_manifest.json'), sourceManifest)
  const queue = deferredHumanReviewQueueService.build({
    generatedAt,
    commitSha: git.baseCommitSha,
    gitEvidenceStatus: git.gitEvidenceStatus,
    worktreeSnapshotHash: git.worktreeSnapshotHash,
    sourceManifest: sourceManifestRef,
    sources: sources.map((source) => ({ reviewType: source.reviewType, evidenceStatus: source.evidenceStatus, rollbackStage: source.rollbackStage, artifacts: source.artifacts.map(({ path, sha256 }) => ({ path, sha256 })) })),
  })
  const queueRef = await writeJson(resolve(outputDir, 'deferred_human_review_queue.json'), queue)
  const operationId = `ftr4-review-${queueRef.sha256.slice(0, 16)}`
  const manualSignoffAudit = await new ManualSignoffService(new EmptySignoffStore()).audit(operationId, queueRef.sha256)
  assert.equal(manualSignoffAudit.manualSignoffPassed, false)
  assert.equal(manualSignoffAudit.recordCount, 0)
  await writeJson(resolve(outputDir, '18_manual_signoff_audit.json'), manualSignoffAudit)
  await writeJson(resolve(outputDir, 'manual_signoff_records.json'), [])
  const manualTradePlanDraftReview = {
    schemaVersion: 'fams.ftr_4.manual_trade_plan_draft_review.v1',
    generatedAt,
    status: 'no_formal_draft_pending_human_review',
    sourceEvidence: [{ path: sourceManifestRef.path, sha256: sourceManifestRef.sha256 }, { path: queueRef.path, sha256: queueRef.sha256 }],
    formalDraftCount: 0,
    formalTargetWeightPercent: 0,
    humanReviewRequired: true,
    automationSelfApprovalAllowed: false,
    prohibitedActions: [...PROHIBITED_ACTIONS],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  await writeJson(resolve(outputDir, 'manual_trade_plan_draft_review.json'), manualTradePlanDraftReview)

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_4.deferred_human_review_queue_run.v1', status: 'passed', auditDir: outputDir,
    queueItemCount: queue.items.length, pendingReviewCount: queue.items.filter((item) => item.status === 'pending').length,
    manualSignoffRecordCount: manualSignoffAudit.recordCount, batchHumanReviewReady: true,
    manualSignoffPassed: false, humanAcceptanceStatus: 'pending_batch_review', accountFactsUnchanged: true,
    gitEvidenceStatus: git.gitEvidenceStatus, worktreeSnapshotHash: git.worktreeSnapshotHash,
    formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }, null, 2))
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1 })
  .finally(async () => { await prisma.$disconnect() })
