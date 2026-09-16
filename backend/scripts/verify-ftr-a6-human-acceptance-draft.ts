import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import {
  HUMAN_ACCEPTANCE_REVIEW_TYPES,
  HumanAcceptanceDraftService,
  type HumanAcceptanceDraftItem,
} from '../src/services/formal-release/humanAcceptanceDraftService.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const sourceManifestSha256 = 'a'.repeat(64)
const reviewQueueSha256 = 'b'.repeat(64)
const packageId = 'ftr6-provisional-0123456789abcdef'

function emptyItems(): HumanAcceptanceDraftItem[] {
  return HUMAN_ACCEPTANCE_REVIEW_TYPES.map((reviewType) => ({
    reviewType,
    status: 'not_run',
    severity: 'none',
    actualResult: '',
    expectedDifference: '',
    reproductionSteps: '',
    remediationSuggestion: '',
    evidenceRefs: [],
  }))
}

async function expectRejected(name: string, task: () => Promise<unknown>, expectedMessage: RegExp, rejected: string[]) {
  await assert.rejects(task, expectedMessage, `negative fixture accepted: ${name}`)
  rejected.push(name)
}

async function main() {
  const repoRoot = await mkdtemp(resolve(tmpdir(), 'fams-a6-draft-'))
  const packageRoot = resolve(repoRoot, 'backend/data/gpt-audit/formal-release-readiness/FTR-6')
  const packageDir = resolve(packageRoot, '2026-09-15T00-00-00-000Z')
  const queuePath = 'backend/data/gpt-audit/formal-release-readiness/FTR-4/test/deferred_human_review_queue.json'
  const draftRoot = resolve(repoRoot, '.verification/private/formal-release/A6')
  await mkdir(packageDir, { recursive: true })
  await mkdir(resolve(repoRoot, queuePath, '..'), { recursive: true })
  await writeFile(resolve(repoRoot, queuePath), JSON.stringify({
    items: HUMAN_ACCEPTANCE_REVIEW_TYPES.map((reviewType, index) => ({
      reviewType,
      rollbackStage: reviewType === 'daily_user_experience' ? 'UX' : `FTR-${Math.min(index, 6)}`,
      artifactRefs: [`evidence/${reviewType}.json`],
      artifactHashes: [String(index + 1).repeat(64).slice(0, 64)],
    })),
  }))
  await writeFile(resolve(packageDir, 'formal_release_review_manifest.json'), JSON.stringify({
    schemaVersion: 'fams.formal_release.provisional_review_manifest.v2',
    packageId,
    generatedAt: '2026-09-15T00:00:00.000Z',
    sourceManifest: { path: 'evidence/source.json', sha256: sourceManifestSha256 },
    reviewQueue: { path: queuePath, sha256: reviewQueueSha256, itemCount: 8, pendingCount: 8, approvedCount: 0 },
    packageChecks: { allSourceArtifactsPresent: true, artifactHashesVerified: true },
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }))

  const service = new HumanAcceptanceDraftService(repoRoot, draftRoot, packageRoot)
  const context = await service.context()
  assert.equal(context.package.packageId, packageId)
  assert.equal(context.reviewItems.length, 8)
  assert.deepEqual(context.reviewItems.map((item) => item.reviewType), HUMAN_ACCEPTANCE_REVIEW_TYPES)
  assert.equal(context.draft.revision, 0)
  assert.equal(context.officialSignoffCreated, false)
  assert.equal(context.humanAcceptanceStatus, 'pending_batch_review')

  const firstItems = emptyItems()
  firstItems[0] = {
    ...firstItems[0],
    status: 'passed',
    actualResult: '已在真实本地资产数据上完成普通用户路径核验。',
    evidenceRefs: ['private-evidence/a6/daily-user-experience.png'],
  }
  const saved = await service.save({ packageId, sourceManifestSha256, expectedRevision: 0, items: firstItems })
  assert.equal(saved.draft.revision, 1)
  assert.equal(saved.draft.overallStatus, 'in_progress')
  assert.equal(saved.officialSignoffCreated, false)
  assert.deepEqual(saved.draft.tradeBoundary, {
    productionAdapterEnabled: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  })

  const persistedPath = resolve(draftRoot, packageId, 'human-feedback-draft.json')
  const persisted = JSON.parse(await readFile(persistedPath, 'utf8'))
  const schema = JSON.parse(await readFile(resolve(process.cwd(), '../docs/contracts/ftr-a6-human-acceptance-draft.schema.json'), 'utf8'))
  const validate = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false }).compile(schema)
  assert.equal(validate(persisted), true, JSON.stringify(validate.errors))

  const rejected: string[] = []
  await expectRejected('stale_revision', () => service.save({ packageId, sourceManifestSha256, expectedRevision: 0, items: firstItems }), /human_review_draft_revision_conflict/, rejected)
  await expectRejected('wrong_package', () => service.save({ packageId: 'ftr6-provisional-ffffffffffffffff', sourceManifestSha256, expectedRevision: 1, items: firstItems }), /human_review_package_not_current/, rejected)
  await expectRejected('wrong_source_hash', () => service.save({ packageId, sourceManifestSha256: 'f'.repeat(64), expectedRevision: 1, items: firstItems }), /human_review_source_manifest_hash_not_current/, rejected)
  await expectRejected('missing_review_type', () => service.save({ packageId, sourceManifestSha256, expectedRevision: 1, items: firstItems.slice(0, 7) }), /human_review_items_must_contain_eight_types/, rejected)
  const duplicated = firstItems.map((item) => ({ ...item }))
  duplicated[1].reviewType = duplicated[0].reviewType
  await expectRejected('duplicate_review_type', () => service.save({ packageId, sourceManifestSha256, expectedRevision: 1, items: duplicated }), /human_review_type_duplicated/, rejected)
  const unsafeField = firstItems.map((item) => ({ ...item })) as Array<HumanAcceptanceDraftItem & { formalTradingUnlocked?: boolean }>
  unsafeField[0].formalTradingUnlocked = true
  await expectRejected('official_field_injected', () => service.save({ packageId, sourceManifestSha256, expectedRevision: 1, items: unsafeField }), /human_review_item_unknown_field/, rejected)
  const unsafeEvidence = firstItems.map((item) => ({ ...item }))
  unsafeEvidence[0].evidenceRefs = ['../secret.txt']
  await expectRejected('unsafe_evidence_ref', () => service.save({ packageId, sourceManifestSha256, expectedRevision: 1, items: unsafeEvidence }), /human_review_evidence_ref_unsafe/, rejected)
  const secretText = firstItems.map((item) => ({ ...item }))
  secretText[0].actualResult = 'api_key=1234567890abcdef'
  await expectRejected('sensitive_feedback', () => service.save({ packageId, sourceManifestSha256, expectedRevision: 1, items: secretText }), /actual_result_sensitive_content_detected/, rejected)
  const missingSeverity = firstItems.map((item) => ({ ...item }))
  missingSeverity[1].status = 'failed'
  await expectRejected('failure_without_severity', () => service.save({ packageId, sourceManifestSha256, expectedRevision: 1, items: missingSeverity }), /human_review_failure_severity_required/, rejected)
  const prematureFinal = firstItems.map((item) => ({ ...item }))
  prematureFinal[7].status = 'passed'
  await expectRejected('premature_final_release_pass', () => service.save({ packageId, sourceManifestSha256, expectedRevision: 1, items: prematureFinal }), /final_release_review_requires_previous_reviews_passed/, rejected)

  const allPassed = emptyItems().map((item) => ({
    ...item,
    status: 'passed' as const,
    actualResult: `人工反馈草稿：${item.reviewType} 已完成。`,
  }))
  const ready = await service.save({ packageId, sourceManifestSha256, expectedRevision: 1, items: allPassed })
  assert.equal(ready.draft.revision, 2)
  assert.equal(ready.draft.overallStatus, 'ready_for_authorized_signoff')
  assert.equal(ready.officialSignoffCreated, false)

  console.log(JSON.stringify({
    schemaVersion: 'fams.formal_release.a6_human_acceptance_draft_contract_verification.v1',
    status: 'passed',
    exactReviewTypeCount: HUMAN_ACCEPTANCE_REVIEW_TYPES.length,
    persistencePath: '.verification/private/formal-release/A6/<packageId>/human-feedback-draft.json',
    positiveSchemaValidationPassed: true,
    negativeFixturesPassed: rejected.length,
    rejected,
    finalDraftState: ready.draft.overallStatus,
    officialSignoffCreated: false,
    humanAcceptanceStatus: 'pending_batch_review',
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
