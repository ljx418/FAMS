import { prisma } from '../../db/prisma.js'
import { FORMAL_RELEASE_REVIEWER_ROLES, type FormalReleaseReviewerContext, type FormalReleaseReviewerRole } from './formalReviewerAuth.js'
import { sha256Canonical } from './formalReleaseHash.js'

export type FormalReleaseSignoffDecision = 'approved' | 'rejected'

export interface FormalReleaseSignoffRecord {
  id: string
  operationId: string
  sequence: number
  role: string
  decision: string
  notes: string
  manifestHash: string
  reviewerUserId: string
  reviewerEmail: string
  previousHash: string | null
  recordHash: string
  createdAt: Date
}

export interface FormalReleaseSignoffStore {
  list(operationId: string): Promise<FormalReleaseSignoffRecord[]>
  create(record: Omit<FormalReleaseSignoffRecord, 'id'>): Promise<FormalReleaseSignoffRecord>
}

const prismaSignoffStore: FormalReleaseSignoffStore = {
  list(operationId) {
    return prisma.formalReleaseSignoff.findMany({ where: { operationId }, orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }] })
  },
  create(record) {
    return prisma.formalReleaseSignoff.create({ data: record })
  },
}

export function computeOperationManifestHash(operation: {
  id: string
  type: string
  status: string
  inputJson: string
  resultJson: string
  artifactRefsJson: string
  completedAt: Date | null
}) {
  const parse = (value: string) => {
    try { return JSON.parse(value) as unknown } catch { return value }
  }
  return sha256Canonical({
    operationId: operation.id,
    operationType: operation.type,
    operationStatus: operation.status,
    input: parse(operation.inputJson),
    result: parse(operation.resultJson),
    artifactRefs: parse(operation.artifactRefsJson),
    completedAt: operation.completedAt?.toISOString() ?? null,
  })
}

export class ManualSignoffService {
  constructor(private readonly store: FormalReleaseSignoffStore = prismaSignoffStore) {}

  async appendSignoff(input: {
    operationId: string
    role: FormalReleaseReviewerRole
    decision: FormalReleaseSignoffDecision
    notes: string
    manifestHash: string
    reviewer: FormalReleaseReviewerContext
    now?: Date
  }) {
    if (!input.reviewer.roles.includes(input.role)) throw new Error(`reviewer_not_authorized_for_role:${input.role}`)
    if (input.reviewer.authSource !== 'jwt_reviewer_roster') throw new Error('signoff_requires_jwt_reviewer_roster')
    if (!/^[a-f0-9]{64}$/.test(input.manifestHash)) throw new Error('signoff_manifest_hash_invalid')
    if (!input.notes.trim()) throw new Error('signoff_notes_required')
    const history = await this.store.list(input.operationId)
    this.assertChain(history)
    if (input.role === 'final_release' && input.decision === 'approved') {
      const prerequisiteAudit = this.buildAudit(input.operationId, input.manifestHash, history)
      const missingPrerequisites = FORMAL_RELEASE_REVIEWER_ROLES
        .filter((role) => role !== 'final_release')
        .filter((role) => prerequisiteAudit.records.find((record) => record.role === role)?.status !== 'approved')
      if (missingPrerequisites.length > 0) throw new Error(`final_release_prerequisite_signoffs_missing:${missingPrerequisites.join(',')}`)
    }
    const previous = history.at(-1)
    const createdAt = input.now ?? new Date()
    const payload = {
      operationId: input.operationId,
      sequence: (previous?.sequence ?? 0) + 1,
      role: input.role,
      decision: input.decision,
      notes: input.notes.trim(),
      manifestHash: input.manifestHash,
      reviewerUserId: input.reviewer.userId,
      reviewerEmail: input.reviewer.email.toLowerCase(),
      previousHash: previous?.recordHash ?? null,
      createdAt,
    }
    const recordHash = sha256Canonical({ ...payload, createdAt: createdAt.toISOString() })
    return this.store.create({ ...payload, recordHash })
  }

  async audit(operationId: string, currentManifestHash: string) {
    const history = await this.store.list(operationId)
    return this.buildAudit(operationId, currentManifestHash, history)
  }

  private buildAudit(operationId: string, currentManifestHash: string, history: FormalReleaseSignoffRecord[]) {
    const chainValid = this.isChainValid(history)
    const latestByRole = new Map<FormalReleaseReviewerRole, FormalReleaseSignoffRecord>()
    for (const record of history) {
      if (FORMAL_RELEASE_REVIEWER_ROLES.includes(record.role as FormalReleaseReviewerRole)) {
        latestByRole.set(record.role as FormalReleaseReviewerRole, record)
      }
    }
    const records = FORMAL_RELEASE_REVIEWER_ROLES.map((role) => {
      const record = latestByRole.get(role)
      const artifactCurrent = record?.manifestHash === currentManifestHash
      const approved = chainValid && artifactCurrent && record?.decision === 'approved'
      return {
        role,
        status: approved ? 'approved' as const : record ? 'blocked' as const : 'missing' as const,
        decision: record?.decision ?? null,
        reviewerUserId: record?.reviewerUserId ?? null,
        reviewerEmail: record?.reviewerEmail ?? null,
        reviewedAt: record?.createdAt.toISOString() ?? null,
        notes: record?.notes ?? null,
        manifestHash: record?.manifestHash ?? null,
        artifactCurrent,
        recordHash: record?.recordHash ?? null,
        blockers: [
          ...(!record ? [`${role}_signoff_missing`] : []),
          ...(record && !artifactCurrent ? [`${role}_signoff_artifact_changed`] : []),
          ...(record?.decision === 'rejected' ? [`${role}_signoff_rejected`] : []),
          ...(!chainValid ? ['manual_signoff_chain_invalid'] : []),
        ],
      }
    })
    const allRequiredSignedOff = records.every((record) => record.status === 'approved')
    return {
      schemaVersion: 'fams.formal_release.manual_signoff_audit.v1' as const,
      operationId,
      currentManifestHash,
      status: allRequiredSignedOff ? 'passed' as const : history.length > 0 ? 'partial' as const : 'missing' as const,
      chainValid,
      appendOnly: true,
      automationSelfApprovalBlocked: true,
      requiredRoles: [...FORMAL_RELEASE_REVIEWER_ROLES],
      records,
      recordCount: history.length,
      allRequiredSignedOff,
      manualSignoffPassed: allRequiredSignedOff,
      blockers: Array.from(new Set(records.flatMap((record) => record.blockers))),
      formalTradingUnlocked: false as const,
      autoTradeUnlocked: false as const,
      canCreateOrder: false as const,
      orderCreateAllowed: false as const,
    }
  }

  private isChainValid(records: FormalReleaseSignoffRecord[]) {
    try { this.assertChain(records); return true } catch { return false }
  }

  private assertChain(records: FormalReleaseSignoffRecord[]) {
    let previousHash: string | null = null
    records.forEach((record, index) => {
      if (record.sequence !== index + 1) throw new Error('manual_signoff_sequence_invalid')
      if (record.previousHash !== previousHash) throw new Error('manual_signoff_previous_hash_invalid')
      const expected = sha256Canonical({
        operationId: record.operationId,
        sequence: record.sequence,
        role: record.role,
        decision: record.decision,
        notes: record.notes,
        manifestHash: record.manifestHash,
        reviewerUserId: record.reviewerUserId,
        reviewerEmail: record.reviewerEmail,
        previousHash: record.previousHash,
        createdAt: record.createdAt.toISOString(),
      })
      if (record.recordHash !== expected) throw new Error('manual_signoff_record_hash_invalid')
      previousHash = record.recordHash
    })
  }
}

export const manualSignoffService = new ManualSignoffService()
