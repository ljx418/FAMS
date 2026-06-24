import crypto from 'node:crypto'
import { prisma } from '../../db/prisma.js'

type FivdRReviewDecision = 'approve_research_only' | 'request_more_evidence' | 'reject_trade_action' | 'manual_watch'

export interface CreateFivdRInterventionReviewInput {
  userId: string
  runId: string
  positionId?: string | null
  symbol?: string | null
  decision: FivdRReviewDecision
  reason: string
  reviewer: string
  modelResultRef: string
  evidenceRefs: string[]
  override?: Record<string, unknown>
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function hashPayload(payload: Record<string, unknown>) {
  return crypto.createHash('sha256').update(stableStringify(payload)).digest('hex')
}

class FivdRInterventionService {
  async createReview(input: CreateFivdRInterventionReviewInput) {
    if (!input.reason.trim()) {
      throw new Error('reason is required for FIVD-R intervention review')
    }
    if (!input.reviewer.trim()) {
      throw new Error('reviewer is required for FIVD-R intervention review')
    }
    if (!input.modelResultRef.trim()) {
      throw new Error('modelResultRef is required for FIVD-R intervention review')
    }

    const previous = await prisma.fivdRInterventionReview.findFirst({
      where: { userId: input.userId, runId: input.runId },
      orderBy: { createdAt: 'desc' },
    })
    const payload = {
      schemaVersion: 'fivd.r.intervention_review.v1',
      userId: input.userId,
      runId: input.runId,
      positionId: input.positionId || null,
      symbol: input.symbol || null,
      decision: input.decision,
      reason: input.reason.trim(),
      reviewer: input.reviewer.trim(),
      modelResultRef: input.modelResultRef.trim(),
      evidenceRefs: [...new Set(input.evidenceRefs)],
      override: input.override || {},
      previousHash: previous?.recordHash || null,
    }
    const recordHash = hashPayload(payload)
    return prisma.fivdRInterventionReview.create({
      data: {
        userId: input.userId,
        runId: input.runId,
        positionId: input.positionId || null,
        symbol: input.symbol || null,
        decision: input.decision,
        reason: input.reason.trim(),
        reviewer: input.reviewer.trim(),
        modelResultRef: input.modelResultRef.trim(),
        evidenceRefsJson: JSON.stringify(payload.evidenceRefs),
        overrideJson: JSON.stringify(payload.override),
        previousHash: previous?.recordHash || null,
        recordHash,
      },
    })
  }

  async listReviews(params: { userId: string; runId?: string; positionId?: string; decision?: FivdRReviewDecision; limit?: number }) {
    const records = await prisma.fivdRInterventionReview.findMany({
      where: {
        userId: params.userId,
        ...(params.runId ? { runId: params.runId } : {}),
        ...(params.positionId ? { positionId: params.positionId } : {}),
        ...(params.decision ? { decision: params.decision } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.max(1, Math.min(100, Number(params.limit) || 20)),
    })
    return records.map((record) => ({
      id: record.id,
      userId: record.userId,
      runId: record.runId,
      positionId: record.positionId,
      symbol: record.symbol,
      decision: record.decision,
      reason: record.reason,
      reviewer: record.reviewer,
      modelResultRef: record.modelResultRef,
      evidenceRefs: JSON.parse(record.evidenceRefsJson || '[]'),
      override: JSON.parse(record.overrideJson || '{}'),
      previousHash: record.previousHash,
      recordHash: record.recordHash,
      createdAt: record.createdAt.toISOString(),
    }))
  }

  async verifyChain(params: { userId: string; runId: string }) {
    const records = await prisma.fivdRInterventionReview.findMany({
      where: { userId: params.userId, runId: params.runId },
      orderBy: { createdAt: 'asc' },
    })
    let previousHash: string | null = null
    const checks = records.map((record) => {
      const payload = {
        schemaVersion: 'fivd.r.intervention_review.v1',
        userId: record.userId,
        runId: record.runId,
        positionId: record.positionId,
        symbol: record.symbol,
        decision: record.decision,
        reason: record.reason,
        reviewer: record.reviewer,
        modelResultRef: record.modelResultRef,
        evidenceRefs: JSON.parse(record.evidenceRefsJson || '[]'),
        override: JSON.parse(record.overrideJson || '{}'),
        previousHash: record.previousHash,
      }
      const recomputedHash = hashPayload(payload)
      const ok = record.previousHash === previousHash && record.recordHash === recomputedHash
      previousHash = record.recordHash
      return {
        id: record.id,
        createdAt: record.createdAt.toISOString(),
        previousHash: record.previousHash,
        recordHash: record.recordHash,
        recomputedHash,
        ok,
      }
    })
    return {
      schemaVersion: 'fivd.r.intervention_review_chain_audit.v1',
      userId: params.userId,
      runId: params.runId,
      records: records.length,
      ok: checks.every((check) => check.ok),
      checks,
    }
  }
}

export const fivdRInterventionService = new FivdRInterventionService()
