import { FastifyInstance } from 'fastify'
import { brokerReviewReconciliationService } from '../services/review/brokerReviewReconciliationService.js'
import { planExecutionService } from '../services/trade-ledger/planExecutionService.js'
import { tradeLedgerService } from '../services/trade-ledger/tradeLedgerService.js'

function userIdFrom(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : 'default'
}

export async function tradeLedgerRoutes(app: FastifyInstance) {
  app.get('/ingestion-batches', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return {
      schemaVersion: 'fams.trade-ingestion-batch-list.v1',
      asOf: new Date().toISOString(),
      batches: await tradeLedgerService.listBatches(userIdFrom(query.userId), Number(query.limit || 50)),
      warnings: [],
      permissionState: { canCreateOrder: false, orderCreateAllowed: false, formalTradingUnlocked: false, autoTradeUnlocked: false },
    }
  })

  app.get<{ Params: { id: string } }>('/ingestion-batches/:id', async (request) => {
    return tradeLedgerService.getBatch(userIdFrom((request.query as any)?.userId), request.params.id)
  })

  app.post('/reconciliations', async (request) => {
    const body = request.body as Record<string, any>
    return brokerReviewReconciliationService.reconcile({
      userId: userIdFrom(body.userId),
      sessionType: body.sessionType,
      holdingsCaptureId: body.holdingsCaptureId,
      tradesCaptureId: body.tradesCaptureId,
      ordinaryOrdersCaptureId: body.ordinaryOrdersCaptureId,
      conditionalOrdersCaptureId: body.conditionalOrdersCaptureId,
      zeroNewTradesConfirmed: body.zeroNewTradesConfirmed === true,
      zeroOrdinaryOrdersConfirmed: body.zeroOrdinaryOrdersConfirmed === true,
      zeroConditionalOrdersConfirmed: body.zeroConditionalOrdersConfirmed === true,
      singleConfirmation: body.confirmation?.confirmedBy && body.confirmation?.confirmedAt
        ? { confirmedBy: String(body.confirmation.confirmedBy), confirmedAt: String(body.confirmation.confirmedAt) }
        : undefined,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
      ingestionBatchId: typeof body.ingestionBatchId === 'string' ? body.ingestionBatchId : undefined,
      now: body.asOf ? new Date(String(body.asOf)) : undefined,
    })
  })

  app.get('/reconciliations', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return {
      schemaVersion: 'fams.trade-reconciliation-run-list.v1',
      asOf: new Date().toISOString(),
      reconciliations: await tradeLedgerService.listReconciliations(userIdFrom(query.userId), Number(query.limit || 50)),
      warnings: [],
      permissionState: { canCreateOrder: false, orderCreateAllowed: false, formalTradingUnlocked: false, autoTradeUnlocked: false },
    }
  })

  app.get<{ Params: { id: string } }>('/reconciliations/:id', async (request) => {
    return tradeLedgerService.getReconciliation(userIdFrom((request.query as any)?.userId), request.params.id)
  })

  app.post('/execution-links/suggest', async (request) => {
    const body = request.body as Record<string, unknown>
    return planExecutionService.suggest({
      userId: userIdFrom(body.userId),
      transactionId: typeof body.transactionId === 'string' ? body.transactionId : undefined,
      externalOrderObservationId: typeof body.externalOrderObservationId === 'string' ? body.externalOrderObservationId : undefined,
      explicitGridOrderDraftId: typeof body.gridOrderDraftId === 'string' ? body.gridOrderDraftId : undefined,
    })
  })

  app.get('/execution-links/pending', async (request) => {
    const query = request.query as Record<string, string | undefined>
    const userId = userIdFrom(query.userId)
    const [suggested, unmatched, blocked] = await Promise.all([
      planExecutionService.listLinks(userId, { status: 'suggested', limit: Number(query.limit || 100) }),
      planExecutionService.listLinks(userId, { status: 'unmatched', limit: Number(query.limit || 100) }),
      planExecutionService.listLinks(userId, { status: 'blocked', limit: Number(query.limit || 100) }),
    ])
    return {
      schemaVersion: 'fams.plan-execution-pending.v1',
      asOf: new Date().toISOString(),
      suggested,
      unmatched,
      blocked,
      warnings: ['自动匹配仅为候选；未经人工确认不计入实际执行回放。'],
      permissionState: { canCreateOrder: false, orderCreateAllowed: false, formalTradingUnlocked: false, autoTradeUnlocked: false },
    }
  })

  app.post<{ Params: { id: string } }>('/execution-links/:id/decision', async (request) => {
    const body = request.body as Record<string, unknown>
    if (body.confirmed !== true) throw new Error('Explicit confirmation is required to decide an execution match')
    return planExecutionService.decide({
      userId: userIdFrom(body.userId),
      linkId: request.params.id,
      decision: body.decision === 'rejected' ? 'rejected' : 'confirmed',
      confirmedBy: String(body.confirmedBy || ''),
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      idempotencyKey: String(body.idempotencyKey || ''),
    })
  })

  app.get<{ Params: { planId: string } }>('/plans/:planId/lifecycle', async (request) => {
    return planExecutionService.getPlanLifecycle(userIdFrom((request.query as any)?.userId), request.params.planId)
  })

  app.post<{ Params: { draftId: string } }>('/order-drafts/:draftId/events', async (request) => {
    const body = request.body as Record<string, unknown>
    if (body.confirmed !== true) throw new Error('Explicit confirmation is required to record a lifecycle event')
    if (!['accepted', 'cancelled', 'expired'].includes(String(body.eventType))) throw new Error('Unsupported lifecycle event')
    return planExecutionService.appendLifecycleEvent({
      userId: userIdFrom(body.userId),
      gridOrderDraftId: request.params.draftId,
      eventType: body.eventType as 'accepted' | 'cancelled' | 'expired',
      confirmedBy: String(body.confirmedBy || ''),
      idempotencyKey: String(body.idempotencyKey || ''),
      reason: typeof body.reason === 'string' ? body.reason : undefined,
      occurredAt: body.occurredAt ? new Date(String(body.occurredAt)) : undefined,
    })
  })
}
