import type { Prisma } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import { sha256, stableJson } from './tradeLedgerService.js'

type ExecutionSource =
  | { kind: 'transaction'; id: string; assetId: string; side: string; quantity: number; price: number; occurredAt: Date; evidenceRef: string }
  | { kind: 'order_observation'; id: string; assetId: string | null; side: string; quantity: number; price: number | null; occurredAt: Date; evidenceRef: string }

type MatchDecision = 'confirmed' | 'rejected'

function parseJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T } catch { return fallback }
}

function normalizedSide(value: string) {
  return String(value || '').trim().toLowerCase()
}

function priceTolerance(price: number) {
  return price < 2 ? 0.001 : Math.max(0.01, price * 0.002)
}

function conflict(message: string, code: string) {
  const error = new Error(message) as Error & { statusCode?: number; code?: string }
  error.statusCode = 409
  error.code = code
  return error
}

class PlanExecutionService {
  private async loadSource(userId: string, input: { transactionId?: string; externalOrderObservationId?: string }): Promise<ExecutionSource> {
    if (Boolean(input.transactionId) === Boolean(input.externalOrderObservationId)) {
      throw new Error('Exactly one execution source is required')
    }
    if (input.transactionId) {
      const transaction = await prisma.transaction.findFirst({ where: { id: input.transactionId, userId } })
      if (!transaction) throw new Error('Transaction not found')
      if (!['buy', 'sell'].includes(normalizedSide(transaction.type))) throw new Error('Only buy/sell transactions can be linked to a plan')
      return {
        kind: 'transaction',
        id: transaction.id,
        assetId: transaction.assetId,
        side: normalizedSide(transaction.type),
        quantity: Math.abs(transaction.quantity),
        price: transaction.price,
        occurredAt: transaction.executedAt,
        evidenceRef: `transaction:${transaction.id}`,
      }
    }
    const observation = await prisma.externalOrderObservation.findFirst({
      where: { id: input.externalOrderObservationId!, userId },
    })
    if (!observation) throw new Error('External order observation not found')
    return {
      kind: 'order_observation',
      id: observation.id,
      assetId: observation.assetId,
      side: normalizedSide(observation.side),
      quantity: Math.abs(observation.quantity),
      price: observation.limitPrice,
      occurredAt: observation.submittedAt || observation.observedAt,
      evidenceRef: `external_order_observation:${observation.id}`,
    }
  }

  private async candidates(userId: string, source: ExecutionSource) {
    if (!source.assetId) return []
    return prisma.gridOrderDraft.findMany({
      where: {
        side: source.side,
        status: { in: ['proposed', 'accepted', 'active', 'submitted', 'partially_filled', 'manual_confirmation_required'] },
        OR: [{ validUntil: null }, { validUntil: { gte: source.occurredAt } }],
        gridPlan: {
          userId,
          assetId: source.assetId,
          createdAt: { lte: source.occurredAt },
          status: { notIn: ['cancelled', 'expired', 'superseded'] },
        },
      },
      include: { gridPlan: true },
      orderBy: [{ createdAt: 'desc' }, { level: 'asc' }],
    })
  }

  private matchScore(source: ExecutionSource, draft: { price: number; quantity: number }) {
    if (source.price === null) return { method: 'heuristic' as const, confidence: source.quantity === draft.quantity ? 0.72 : 0.55 }
    const priceDelta = Math.abs(source.price - draft.price)
    const exactPrice = priceDelta <= priceTolerance(draft.price)
    const exactQuantity = Math.abs(source.quantity - draft.quantity) < 0.000001
    if (exactPrice && exactQuantity) return { method: 'exact_composite' as const, confidence: 0.98 }
    if (priceDelta / draft.price <= 0.01 && source.quantity <= draft.quantity) return { method: 'heuristic' as const, confidence: 0.75 }
    return null
  }

  private linkKey(source: ExecutionSource, gridOrderDraftId: string | null) {
    return sha256({ sourceKind: source.kind, sourceId: source.id, gridOrderDraftId })
  }

  async suggest(input: {
    userId: string
    transactionId?: string
    externalOrderObservationId?: string
    explicitGridOrderDraftId?: string
  }) {
    await ensureUser(prisma, input.userId)
    const source = await this.loadSource(input.userId, input)
    let candidates = await this.candidates(input.userId, source)
    let explicit = false
    if (input.explicitGridOrderDraftId) {
      const requested = await prisma.gridOrderDraft.findFirst({
        where: { id: input.explicitGridOrderDraftId, gridPlan: { userId: input.userId } },
        include: { gridPlan: true },
      })
      if (!requested) throw new Error('Explicit grid order draft not found')
      candidates = [requested]
      explicit = true
    }
    const matched = candidates.flatMap((draft) => {
      if (draft.gridPlan.assetId !== source.assetId || normalizedSide(draft.side) !== source.side) return []
      const scored = explicit ? { method: 'explicit_draft_id' as const, confidence: 1 } : this.matchScore(source, draft)
      return scored ? [{ draft, ...scored }] : []
    })
    const rows = matched.length > 0 ? matched : [{ draft: null, method: 'heuristic' as const, confidence: 0 }]
    const links = []
    for (const row of rows) {
      const key = this.linkKey(source, row.draft?.id || null)
      links.push(await prisma.planExecutionLink.upsert({
        where: { linkKey: key },
        update: {},
        create: {
          linkKey: key,
          userId: input.userId,
          gridOrderDraftId: row.draft?.id || null,
          transactionId: source.kind === 'transaction' ? source.id : null,
          externalOrderObservationId: source.kind === 'order_observation' ? source.id : null,
          matchStatus: row.draft ? 'suggested' : 'unmatched',
          matchMethod: row.method,
          confidence: row.confidence,
          reason: row.draft
            ? `${row.method} match requires explicit user confirmation`
            : 'No eligible plan draft matched this execution fact',
          evidenceRefsJson: stableJson([source.evidenceRef]),
        },
        include: { gridOrderDraft: { include: { gridPlan: true } }, transaction: true, externalOrderObservation: true },
      }))
    }
    return { source, links: links.map((link) => this.presentLink(link)) }
  }

  async suggestForIngestionBatch(userId: string, ingestionBatchId: string) {
    const batch = await prisma.tradeIngestionBatch.findFirst({
      where: { id: ingestionBatchId, userId },
      include: { transactions: true, externalOrderObservations: true },
    })
    if (!batch) throw new Error('Trade ingestion batch not found')
    const results = []
    for (const transaction of batch.transactions) {
      if (['buy', 'sell'].includes(normalizedSide(transaction.type))) {
        results.push(await this.suggest({ userId, transactionId: transaction.id }))
      }
    }
    for (const observation of batch.externalOrderObservations) {
      results.push(await this.suggest({ userId, externalOrderObservationId: observation.id }))
    }
    return { ingestionBatchId, results }
  }

  async decide(input: {
    userId: string
    linkId: string
    decision: MatchDecision
    confirmedBy: string
    reason?: string
    idempotencyKey: string
  }) {
    await ensureUser(prisma, input.userId)
    if (!input.confirmedBy.trim()) throw new Error('confirmedBy is required')
    if (!input.idempotencyKey.trim()) throw new Error('idempotencyKey is required')
    const link = await prisma.planExecutionLink.findFirst({
      where: { id: input.linkId, userId: input.userId },
      include: { gridOrderDraft: { include: { gridPlan: true } }, transaction: true, externalOrderObservation: true },
    })
    if (!link) throw new Error('Plan execution link not found')
    if (link.matchStatus === input.decision) return this.presentLink(link)
    if (link.matchStatus === 'confirmed') throw conflict('A confirmed execution link is immutable', 'CONFIRMED_EXECUTION_LINK_IMMUTABLE')
    if (input.decision === 'confirmed' && !link.gridOrderDraft) {
      throw conflict('An unmatched fact must first be linked to a concrete draft', 'EXECUTION_DRAFT_REQUIRED')
    }

    return prisma.$transaction(async (tx) => {
      if (input.decision === 'rejected') {
        const rejected = await tx.planExecutionLink.update({
          where: { id: link.id },
          data: { matchStatus: 'rejected', reason: input.reason || link.reason, confirmedBy: input.confirmedBy.trim(), confirmedAt: new Date() },
          include: { gridOrderDraft: { include: { gridPlan: true } }, transaction: true, externalOrderObservation: true },
        })
        return this.presentLink(rejected)
      }
      const sourceFilter: Prisma.PlanExecutionLinkWhereInput = link.transactionId
        ? { transactionId: link.transactionId }
        : { externalOrderObservationId: link.externalOrderObservationId }
      const otherConfirmed = await tx.planExecutionLink.findFirst({
        where: { ...sourceFilter, matchStatus: 'confirmed', id: { not: link.id } },
      })
      if (otherConfirmed) throw conflict('This execution fact is already confirmed against another draft', 'EXECUTION_ALREADY_ATTRIBUTED')
      const draft = link.gridOrderDraft!
      const sourceAssetId = link.transaction?.assetId || link.externalOrderObservation?.assetId
      const sourceSide = normalizedSide(link.transaction?.type || link.externalOrderObservation?.side || '')
      if (sourceAssetId !== draft.gridPlan.assetId || sourceSide !== normalizedSide(draft.side)) {
        throw conflict('Execution asset or side does not match the selected draft', 'EXECUTION_DRAFT_MISMATCH')
      }
      const confirmedTransactionLinks = await tx.planExecutionLink.findMany({
        where: { gridOrderDraftId: draft.id, matchStatus: 'confirmed', transactionId: { not: null }, id: { not: link.id } },
        include: { transaction: true },
      })
      const existingFilled = confirmedTransactionLinks.reduce((sum, item) => sum + Math.abs(item.transaction?.quantity || 0), 0)
      const addedFilled = Math.abs(link.transaction?.quantity || 0)
      if (existingFilled + addedFilled > draft.quantity + 0.000001) {
        throw conflict('Confirmed transaction quantity would exceed the draft quantity', 'DRAFT_QUANTITY_EXCEEDED')
      }
      const confirmedAt = new Date()
      const confirmed = await tx.planExecutionLink.update({
        where: { id: link.id },
        data: { matchStatus: 'confirmed', reason: input.reason || link.reason, confirmedBy: input.confirmedBy.trim(), confirmedAt },
        include: { gridOrderDraft: { include: { gridPlan: true } }, transaction: true, externalOrderObservation: true },
      })
      const eventType = link.transactionId
        ? existingFilled + addedFilled >= draft.quantity - 0.000001 ? 'filled' : 'partially_filled'
        : Number(link.externalOrderObservation?.filledQuantity || 0) > 0 ? 'partially_filled' : 'submitted'
      const eventQuantity = link.transaction?.quantity || link.externalOrderObservation?.filledQuantity || link.externalOrderObservation?.quantity || null
      const eventPrice = link.transaction?.price || link.externalOrderObservation?.limitPrice || null
      await tx.gridOrderDraftEvent.upsert({
        where: { gridOrderDraftId_idempotencyKey: { gridOrderDraftId: draft.id, idempotencyKey: input.idempotencyKey } },
        update: {},
        create: {
          gridOrderDraftId: draft.id,
          idempotencyKey: input.idempotencyKey,
          eventType,
          quantity: eventQuantity,
          price: eventPrice,
          sourceType: link.transactionId ? 'transaction' : 'broker_observation',
          sourceRef: link.transactionId ? `transaction:${link.transactionId}` : `external_order_observation:${link.externalOrderObservationId}`,
          evidenceRefsJson: link.evidenceRefsJson,
          metadataJson: stableJson({ planExecutionLinkId: link.id, confirmedBy: input.confirmedBy.trim() }),
          occurredAt: link.transaction?.executedAt || link.externalOrderObservation?.submittedAt || confirmedAt,
        },
      })
      await tx.gridOrderDraft.update({ where: { id: draft.id }, data: { status: eventType } })
      return this.presentLink(confirmed)
    })
  }

  async appendLifecycleEvent(input: {
    userId: string
    gridOrderDraftId: string
    eventType: 'accepted' | 'cancelled' | 'expired'
    confirmedBy: string
    idempotencyKey: string
    reason?: string
    occurredAt?: Date
  }) {
    await ensureUser(prisma, input.userId)
    if (!input.confirmedBy.trim()) throw new Error('confirmedBy is required')
    if (!input.idempotencyKey.trim()) throw new Error('idempotencyKey is required')
    const draft = await prisma.gridOrderDraft.findFirst({
      where: { id: input.gridOrderDraftId, gridPlan: { userId: input.userId } },
    })
    if (!draft) throw new Error('Grid order draft not found')
    const terminal = new Set(['filled', 'cancelled', 'expired', 'superseded'])
    if (terminal.has(draft.status) && draft.status !== input.eventType) {
      throw conflict(`Terminal draft status ${draft.status} cannot transition to ${input.eventType}`, 'DRAFT_TERMINAL_STATE')
    }
    const existing = await prisma.gridOrderDraftEvent.findUnique({
      where: { gridOrderDraftId_idempotencyKey: { gridOrderDraftId: draft.id, idempotencyKey: input.idempotencyKey } },
    })
    const expectedMetadata = stableJson({ confirmedBy: input.confirmedBy.trim(), reason: input.reason || null })
    if (existing) {
      if (existing.eventType !== input.eventType || existing.metadataJson !== expectedMetadata) {
        throw conflict('The lifecycle event idempotency key was already used with different content', 'DRAFT_EVENT_IDEMPOTENCY_CONFLICT')
      }
      return existing
    }
    return prisma.$transaction(async (tx) => {
      const event = await tx.gridOrderDraftEvent.create({
        data: {
          gridOrderDraftId: draft.id,
          idempotencyKey: input.idempotencyKey,
          eventType: input.eventType,
          quantity: draft.quantity,
          price: draft.price,
          sourceType: 'user',
          sourceRef: `user:${input.confirmedBy.trim()}`,
          metadataJson: expectedMetadata,
          occurredAt: input.occurredAt || new Date(),
        },
      })
      await tx.gridOrderDraft.update({ where: { id: draft.id }, data: { status: input.eventType } })
      return event
    })
  }

  async listLinks(userId: string, options: { status?: string; limit?: number } = {}) {
    const links = await prisma.planExecutionLink.findMany({
      where: { userId, ...(options.status ? { matchStatus: options.status } : {}) },
      include: { gridOrderDraft: { include: { gridPlan: true } }, transaction: true, externalOrderObservation: true },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(options.limit || 100, 1), 500),
    })
    return links.map((link) => this.presentLink(link))
  }

  async getPlanLifecycle(userId: string, gridPlanId: string) {
    const plan = await prisma.gridPlan.findFirst({
      where: { id: gridPlanId, userId },
      include: {
        orders: {
          include: {
            events: { orderBy: { occurredAt: 'asc' } },
            executionLinks: { include: { transaction: true, externalOrderObservation: true }, orderBy: { createdAt: 'asc' } },
          },
          orderBy: [{ side: 'asc' }, { level: 'asc' }],
        },
        investmentStrategyRun: true,
        dailyReviewRun: true,
      },
    })
    if (!plan) throw new Error('Grid plan not found')
    return {
      ...plan,
      constraints: parseJson(plan.constraintsJson, {}),
      changeReasons: parseJson(plan.changeReasonsJson, []),
      evidenceRefs: parseJson(plan.evidenceRefsJson, []),
      orders: plan.orders.map((order) => ({
        ...order,
        triggerCondition: parseJson(order.triggerConditionJson, {}),
        evidenceRefs: parseJson(order.evidenceRefsJson, []),
        events: order.events.map((event) => ({
          ...event,
          evidenceRefs: parseJson(event.evidenceRefsJson, []),
          metadata: parseJson(event.metadataJson, {}),
        })),
        executionLinks: order.executionLinks.map((link) => this.presentLink(link)),
      })),
    }
  }

  presentLink<T extends { evidenceRefsJson: string }>(link: T) {
    return { ...link, evidenceRefs: parseJson(link.evidenceRefsJson, []) }
  }
}

export const planExecutionService = new PlanExecutionService()
