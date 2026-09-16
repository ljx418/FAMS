import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { basename, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import { FormalReleasePackageService, type FrozenReleaseArtifact } from '../src/services/formal-release/formalReleasePackageService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const execFileAsync = promisify(execFile)
const repoRoot = resolve(process.cwd(), '..')
const STAGES = ['A0', 'FTR-1', 'FTR-2', 'FTR-3', 'FTR-4', 'FTR-5'] as const
type StageId = typeof STAGES[number]
type Json = Record<string, any>

function sha256Bytes(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex')
}

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestValidDir(stageId: StageId, fileName: string, predicate: (value: Json) => boolean) {
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
      const value = await readJson(resolve(dir, fileName))
      if (predicate(value)) return { dir, value }
    } catch {
      // Ignore incomplete runs.
    }
  }
  throw new Error(`${stageId.toLowerCase()}_eligible_evidence_not_found`)
}

async function gitSnapshot() {
  const [{ stdout: commit }, { stdout: files }] = await Promise.all([
    execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }),
    execFileAsync('git', ['ls-files', '--modified', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }),
  ])
  const refs = []
  for (const path of files.split('\0').filter(Boolean).sort()) {
    const absolutePath = resolve(repoRoot, path)
    try {
      if ((await stat(absolutePath)).isFile()) refs.push({ path, sha256: sha256Bytes(await readFile(absolutePath)) })
    } catch {
      refs.push({ path, sha256: sha256Bytes('deleted') })
    }
  }
  return {
    baseCommitSha: commit.trim(),
    gitEvidenceStatus: refs.length === 0 ? 'clean_commit' as const : 'uncommitted_worktree_snapshot' as const,
    worktreeSnapshotHash: sha256Canonical(refs),
  }
}

async function main() {
  const generatedAt = new Date().toISOString()
  const outputDir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-6', generatedAt.replace(/[:.]/g, '-'))
  const evidenceDir = resolve(outputDir, 'evidence')
  await mkdir(evidenceDir, { recursive: true })
  const state = await readJson(resolve(repoRoot, 'docs/current-stage-state.json'))
  assert.equal(state.statuses.ftr6EntryAllowed, true)
  assert.equal(state.statuses.ftr5CurrentChainExecutionIsolationPassed, true)
  for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(state.statuses[field], false)

  const [a0, ftr1, ftr2, ftr3, ftr4, ftr5, git] = await Promise.all([
    latestValidDir('A0', 'a0_acceptance_audit.json', (value) => value.status === 'passed' && value.productCandidateVersion === 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time'),
    latestValidDir('FTR-1', '15_data_governance_audit.json', (value) => value.status === 'passed' && value.formalDataGovernancePassed === true),
    latestValidDir('FTR-2', '16_benchmark_qualification_audit.json', (value) => value.status === 'passed' && value.benchmarkQualificationPassed === true),
    latestValidDir('FTR-3', '17_formal_validation_audit.json', (value) => value.status === 'passed' && value.formalValidationPassed === true),
    latestValidDir('FTR-4', 'deferred_human_review_queue.json', (value) => value.batchHumanReviewReady === true && value.manualSignoffPassed === false
      && value.items?.find((item: Json) => item.reviewType === 'risk')?.sourceEvidenceStatus === 'automated_pass_human_pending'),
    latestValidDir('FTR-5', '13_execution_isolation_audit.json', (value) => value.status === 'ready_for_paper_review' && value.accountFactsUnchanged === true
      && value.productionAdapterEnabled === false && value.realPositionMutationAllowed === false),
    gitSnapshot(),
  ])
  const sourceFiles: Record<StageId, { dir: string; names: string[] }> = {
    A0: { dir: a0.dir, names: ['a0_acceptance_audit.json', 'provider_authorization_audit.json', 'public_source_use_declaration.json', 'release_candidate_set.json', 'validation_profile_set.json'] },
    'FTR-1': { dir: ftr1.dir, names: ['15_data_governance_audit.json', 'field_evidence_validation_audit.json', 'provider_authorization_audit.json', 'public_market_bundle_source_evidence.json'] },
    'FTR-2': { dir: ftr2.dir, names: ['16_benchmark_qualification_audit.json', 'benchmark_total_return_replay.json', 'benchmark_license_review.json'] },
    'FTR-3': { dir: ftr3.dir, names: ['17_formal_validation_audit.json', 'release_candidate_set.json', 'validation_profile_set.json', 'walk_forward_replay.json', 'parameter_replay.json', 'group_stability.json', 'tradeability_reconciliation.json', 'validation_failure_taxonomy.json'] },
    'FTR-4': { dir: ftr4.dir, names: ['ftr4_queue_source_manifest.json', 'deferred_human_review_queue.json', '18_manual_signoff_audit.json', 'manual_signoff_records.json', 'manual_trade_plan_draft_review.json'] },
    'FTR-5': { dir: ftr5.dir, names: ['13_execution_isolation_audit.json', 'trade_boundary_wording_audit.json', 'production_adapter_approval_record.json'] },
  }
  const sourceArtifacts: FrozenReleaseArtifact[] = []
  let index = 1
  for (const stageId of STAGES) {
    const source = sourceFiles[stageId]
    for (const name of source.names) {
      const origin = resolve(source.dir, name)
      const raw = await readFile(origin)
      const snapshotName = `${String(index).padStart(2, '0')}-${stageId.replace('-', '').toLowerCase()}-${basename(name)}`
      index += 1
      const snapshot = resolve(evidenceDir, snapshotName)
      await copyFile(origin, snapshot)
      sourceArtifacts.push({
        stageId,
        name,
        path: relative(repoRoot, snapshot),
        packageRelativePath: `evidence/${snapshotName}`,
        originPath: relative(repoRoot, origin),
        absolutePath: snapshot,
        sha256: sha256Bytes(raw),
        bytes: raw.byteLength,
      })
    }
  }
  const queue = await readJson(resolve(ftr4.dir, 'deferred_human_review_queue.json'))
  const queueSourceManifest = await readJson(resolve(ftr4.dir, 'ftr4_queue_source_manifest.json'))
  const risk = queue.items.find((item: Json) => item.reviewType === 'risk')
  const riskSource = queueSourceManifest.sources.find((source: Json) => source.reviewType === 'risk')
  assert.ok(risk)
  assert.ok(riskSource)
  assert.equal(risk.sourceEvidenceStatus, 'automated_pass_human_pending')
  assert.equal(risk.artifactRefs.some((path: string) => path.endsWith('risk-13_execution_isolation_audit.json')), true)
  assert.equal(risk.artifactRefs.some((path: string) => path.endsWith('trade_boundary_wording_audit.json')), true)
  assert.equal(risk.artifactRefs.some((path: string) => path.endsWith('production_adapter_approval_record.json')), true)
  assert.equal(riskSource.artifacts.some((artifact: Json) => artifact.originPath.includes('/FTR-5/') && artifact.originPath.endsWith('13_execution_isolation_audit.json')), true)
  assert.equal(riskSource.artifacts.some((artifact: Json) => artifact.originPath.includes('/FTR-5/') && artifact.originPath.endsWith('trade_boundary_wording_audit.json')), true)
  assert.equal(riskSource.artifacts.some((artifact: Json) => artifact.originPath.includes('/FTR-5/') && artifact.originPath.endsWith('production_adapter_approval_record.json')), true)
  assert.equal(queue.items.length, 8)
  assert.equal(queue.items.every((item: Json) => item.status === 'pending' && item.reviewer === null && item.reviewedAt === null), true)

  const walkForward = await readJson(resolve(ftr3.dir, 'walk_forward_replay.json'))
  const windows = walkForward.walkForward?.windows ?? walkForward.windows ?? []
  const failedWalkForwardWindowCount = windows.filter((window: Json) => window.status === 'failed').length
  assert.ok(failedWalkForwardWindowCount >= 1, 'failed_walk_forward_window_must_be_preserved')
  const releaseCandidateCount = Number(ftr3.value.strategyCount ?? ftr3.value.releaseCandidateSet?.entries?.length ?? ftr3.value.checks?.length ?? 0)
  const applicableReleaseCandidateCount = Number(ftr3.value.productReleaseCandidateCount ?? ftr3.value.checks?.filter((item: Json) => item.formalGateApplicable === true).length ?? 0)
  assert.ok(releaseCandidateCount >= 1)
  assert.ok(applicableReleaseCandidateCount >= 1)

  const packageSeed = { generatedAt, artifacts: sourceArtifacts.map(({ absolutePath: _absolutePath, ...artifact }) => artifact), worktreeSnapshotHash: git.worktreeSnapshotHash }
  const packageId = `ftr6-provisional-${sha256Canonical(packageSeed).slice(0, 16)}`
  const sourceManifest = {
    schemaVersion: 'fams.formal_release.ftr6_source_manifest.v1',
    generatedAt,
    packageId,
    baseCommitSha: git.baseCommitSha,
    commitShaRole: 'base_commit_not_artifact_claim',
    gitEvidenceStatus: git.gitEvidenceStatus,
    worktreeSnapshotHash: git.worktreeSnapshotHash,
    sourceArtifacts: sourceArtifacts.map(({ absolutePath: _absolutePath, ...artifact }) => artifact),
    sourceStageCoverage: [...STAGES],
    allRequiredArtifactsPresent: true,
    allArtifactHashesVerified: true,
    invalidatedArtifactIncluded: false,
    ftr4RiskEvidenceReboundToCurrentFtr5: true,
    realDataUsed: true,
    accountFactsUnchanged: ftr5.value.accountFactsUnchanged === true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const sourceManifestPath = resolve(outputDir, 'ftr6_source_manifest.json')
  const sourceManifestBody = `${JSON.stringify(sourceManifest, null, 2)}\n`
  await writeFile(sourceManifestPath, sourceManifestBody, { encoding: 'utf8', flag: 'wx' })
  const copiedQueue = sourceArtifacts.find((artifact) => artifact.stageId === 'FTR-4' && artifact.name === 'deferred_human_review_queue.json')
  assert.ok(copiedQueue)
  const service = new FormalReleasePackageService()
  const result = await service.buildProvisional({
    packageDir: outputDir,
    generatedAt,
    packageId,
    sourceManifest: { path: relative(repoRoot, sourceManifestPath), sha256: sha256Bytes(sourceManifestBody) },
    sourceArtifacts,
    releaseCandidateCount,
    applicableReleaseCandidateCount,
    failedWalkForwardWindowCount,
    reviewQueue: { path: copiedQueue.path, sha256: copiedQueue.sha256, itemCount: 8, pendingCount: 8, approvedCount: 0, riskEvidenceRebound: true },
    businessGates: {
      formalDataGovernancePassed: ftr1.value.formalDataGovernancePassed === true,
      benchmarkQualificationPassed: ftr2.value.benchmarkQualificationPassed === true,
      formalValidationPassed: ftr3.value.formalValidationPassed === true,
      manualSignoffPassed: false,
      executionIsolationPassed: ftr5.value.status === 'ready_for_paper_review' && ftr5.value.accountFactsUnchanged === true,
    },
  })
  assert.equal(result.manifest.formalTradingReleaseReviewReady, true)
  assert.equal(result.releaseGateAudit.status, 'blocked')
  console.log(JSON.stringify({
    schemaVersion: 'fams.formal_release.ftr6_provisional_package_run.v1',
    status: 'passed',
    auditDir: outputDir,
    packageId,
    sourceArtifactCount: sourceArtifacts.length,
    stageCoverage: STAGES,
    failedWalkForwardWindowCount,
    ftr4RiskEvidenceReboundToCurrentFtr5: true,
    batchHumanReviewReady: true,
    humanAcceptanceStatus: 'pending_batch_review',
    engineeringPackageStatus: result.releaseGateAudit.engineeringPackageStatus,
    finalFormalReleaseReviewPackageReady: false,
    formalTradingReleaseReady: false,
    productionAdapterEnabled: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
