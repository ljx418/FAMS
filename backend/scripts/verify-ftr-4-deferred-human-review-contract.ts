import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { DEFERRED_REVIEW_TYPES, DeferredHumanReviewQueueService, type DeferredReviewSource } from '../src/services/formal-release/deferredHumanReviewQueueService.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')

async function compile(name: string) {
  const schema = JSON.parse(await readFile(resolve(repoRoot, 'docs', 'contracts', name), 'utf8'))
  return new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false }).compile(schema)
}

function expectRejected(label: string, validate: any, value: unknown) {
  assert.equal(validate(value), false, `${label} unexpectedly passed`)
  return label
}

async function main() {
  const queueValidate = await compile('deferred-human-review-queue.schema.json')
  const auditValidate = await compile('ftr-4-manual-signoff-audit.schema.json')
  const recordsValidate = await compile('ftr-4-manual-signoff-records.schema.json')
  const draftValidate = await compile('ftr-4-manual-trade-plan-draft-review.schema.json')
  const service = new DeferredHumanReviewQueueService()
  const sources: DeferredReviewSource[] = DEFERRED_REVIEW_TYPES.map((reviewType) => ({
    reviewType,
    evidenceStatus: reviewType === 'risk' ? 'automated_pass_rebind_after_ftr5' : reviewType === 'final_release' ? 'pending_final_package' : 'automated_pass_human_pending',
    rollbackStage: reviewType === 'daily_user_experience' ? 'UX' : reviewType === 'v2_px_experience' ? 'V2-PX-PX6-02' : reviewType === 'data' ? 'FTR-1' : reviewType === 'benchmark' ? 'FTR-2' : reviewType === 'model' ? 'FTR-3' : reviewType === 'risk' ? 'FTR-5' : 'FTR-6',
    artifacts: [{ path: `evidence/${reviewType}.json`, sha256: `${DEFERRED_REVIEW_TYPES.indexOf(reviewType) + 1}`.repeat(64).slice(0, 64) }],
  }))
  const queue = service.build({
    generatedAt: '2026-09-15T00:00:00.000Z', commitSha: 'a'.repeat(40), gitEvidenceStatus: 'uncommitted_worktree_snapshot',
    worktreeSnapshotHash: 'b'.repeat(64), sourceManifest: { path: 'manifest.json', sha256: 'c'.repeat(64) }, sources,
  })
  assert.equal(queueValidate(queue), true, JSON.stringify(queueValidate.errors))

  const manualAudit = {
    schemaVersion: 'fams.formal_release.manual_signoff_audit.v1', operationId: 'ftr4-review-' + 'd'.repeat(16), currentManifestHash: 'e'.repeat(64),
    status: 'missing', chainValid: true, appendOnly: true, automationSelfApprovalBlocked: true,
    requiredRoles: ['data', 'model', 'risk', 'compliance', 'final_release'],
    records: ['data', 'model', 'risk', 'compliance', 'final_release'].map((role) => ({ role, status: 'missing', decision: null, reviewerUserId: null, reviewerEmail: null, reviewedAt: null, notes: null, manifestHash: null, artifactCurrent: false, recordHash: null, blockers: [`${role}_signoff_missing`] })),
    recordCount: 0, allRequiredSignedOff: false, manualSignoffPassed: false,
    blockers: ['data_signoff_missing', 'model_signoff_missing', 'risk_signoff_missing', 'compliance_signoff_missing', 'final_release_signoff_missing'],
    formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  assert.equal(auditValidate(manualAudit), true, JSON.stringify(auditValidate.errors))
  assert.equal(recordsValidate([]), true)
  const draft = {
    schemaVersion: 'fams.ftr_4.manual_trade_plan_draft_review.v1', generatedAt: '2026-09-15T00:00:00.000Z', status: 'no_formal_draft_pending_human_review',
    sourceEvidence: [{ path: 'manifest.json', sha256: 'c'.repeat(64) }], formalDraftCount: 0, formalTargetWeightPercent: 0,
    humanReviewRequired: true, automationSelfApprovalAllowed: false, prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  assert.equal(draftValidate(draft), true, JSON.stringify(draftValidate.errors))

  const rejected = [
    expectRejected('automated_review_marked_passed', queueValidate, { ...queue, items: queue.items.map((item, index) => index === 0 ? { ...item, status: 'passed', reviewer: 'agent', reviewedAt: '2026-09-15T00:01:00Z' } : item) }),
    expectRejected('artifact_commit_claim_spoofed', queueValidate, { ...queue, commitShaRole: 'artifact_commit' }),
    expectRejected('review_type_duplicated', queueValidate, { ...queue, items: queue.items.map((item, index) => index === 1 ? { ...item, reviewType: 'daily_user_experience' } : item) }),
    expectRejected('manual_signoff_self_approved', auditValidate, { ...manualAudit, status: 'passed', manualSignoffPassed: true }),
    expectRejected('manual_signoff_record_injected', recordsValidate, [{ role: 'final_release' }]),
    expectRejected('formal_draft_target_weight_injected', draftValidate, { ...draft, formalDraftCount: 1, formalTargetWeightPercent: 25 }),
    expectRejected('order_creation_unlocked', draftValidate, { ...draft, canCreateOrder: true, orderCreateAllowed: true }),
  ]
  await assert.rejects(async () => service.build({ generatedAt: queue.generatedAt, commitSha: queue.commitSha, gitEvidenceStatus: queue.gitEvidenceStatus, worktreeSnapshotHash: queue.worktreeSnapshotHash, sourceManifest: queue.sourceManifest, sources: sources.slice(0, 7) }), /eight_unique_types/)
  rejected.push('missing_review_type_service_rejected')

  console.log(JSON.stringify({ schemaVersion: 'fams.ftr_4.deferred_human_review_contract_verification.v1', status: 'passed', positiveSchemasPassed: 4, negativeFixturesPassed: rejected.length, rejected, automationSelfApprovalBlocked: true, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false }, null, 2))
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
