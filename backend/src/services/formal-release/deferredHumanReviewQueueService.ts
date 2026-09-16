import { sha256Canonical } from './formalReleaseHash.js'

export const DEFERRED_REVIEW_TYPES = [
  'daily_user_experience',
  'v2_px_experience',
  'data',
  'benchmark',
  'model',
  'risk',
  'compliance',
  'final_release',
] as const

export type DeferredReviewType = typeof DEFERRED_REVIEW_TYPES[number]
export type SourceEvidenceStatus = 'automated_pass_human_pending' | 'automated_pass_rebind_after_ftr5' | 'pending_final_package'

export interface DeferredReviewSource {
  reviewType: DeferredReviewType
  evidenceStatus: SourceEvidenceStatus
  rollbackStage: 'UX' | 'V2-PX-PX6-02' | 'FTR-1' | 'FTR-2' | 'FTR-3' | 'FTR-5' | 'FTR-6'
  artifacts: Array<{ path: string; sha256: string }>
}

export class DeferredHumanReviewQueueService {
  build(input: {
    generatedAt: string
    commitSha: string
    gitEvidenceStatus: 'clean_commit' | 'uncommitted_worktree_snapshot'
    worktreeSnapshotHash: string
    sourceManifest: { path: string; sha256: string }
    sources: DeferredReviewSource[]
  }) {
    const types = input.sources.map((source) => source.reviewType)
    if (types.length !== DEFERRED_REVIEW_TYPES.length || new Set(types).size !== DEFERRED_REVIEW_TYPES.length) {
      throw new Error('deferred_review_sources_must_contain_eight_unique_types')
    }
    for (const expected of DEFERRED_REVIEW_TYPES) {
      if (!types.includes(expected)) throw new Error(`deferred_review_source_missing:${expected}`)
    }
    for (const source of input.sources) {
      if (source.artifacts.length === 0) throw new Error(`deferred_review_artifacts_missing:${source.reviewType}`)
      if (source.artifacts.some((artifact) => !/^[a-f0-9]{64}$/.test(artifact.sha256))) {
        throw new Error(`deferred_review_artifact_hash_invalid:${source.reviewType}`)
      }
    }
    return {
      schemaVersion: 'fams.deferred_human_review_queue.v2' as const,
      generatedAt: input.generatedAt,
      commitSha: input.commitSha,
      commitShaRole: 'base_commit_not_artifact_claim' as const,
      gitEvidenceStatus: input.gitEvidenceStatus,
      worktreeSnapshotHash: input.worktreeSnapshotHash,
      sourceManifest: input.sourceManifest,
      executionMode: 'batch_after_automated_scope' as const,
      automationSelfApprovalAllowed: false as const,
      humanAcceptanceStatus: 'pending_batch_review' as const,
      batchHumanReviewReady: true as const,
      manualSignoffPassed: false as const,
      items: input.sources.map((source) => ({
        reviewId: `ftr4-${source.reviewType}-${sha256Canonical({ source, worktreeSnapshotHash: input.worktreeSnapshotHash }).slice(0, 12)}`,
        reviewType: source.reviewType,
        sourceEvidenceStatus: source.evidenceStatus,
        status: 'pending' as const,
        artifactRefs: source.artifacts.map((artifact) => artifact.path),
        artifactHashes: source.artifacts.map((artifact) => artifact.sha256),
        rollbackStage: source.rollbackStage,
        reviewer: null,
        reviewedAt: null,
        blockers: [
          `${source.reviewType}_human_review_pending`,
          ...(source.evidenceStatus === 'automated_pass_rebind_after_ftr5' ? ['ftr5_evidence_rebind_required'] : []),
          ...(source.evidenceStatus === 'pending_final_package' ? ['final_review_package_pending'] : []),
        ],
      })),
      formalTradingUnlocked: false as const,
      autoTradeUnlocked: false as const,
      canCreateOrder: false as const,
      orderCreateAllowed: false as const,
    }
  }
}

export const deferredHumanReviewQueueService = new DeferredHumanReviewQueueService()
