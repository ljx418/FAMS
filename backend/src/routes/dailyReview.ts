import { FastifyInstance } from 'fastify'
import { dailyReviewService } from '../services/review/dailyReviewService.js'
import { dailyReviewScheduler } from '../services/review/dailyReviewScheduler.js'
import { gridStrategyService } from '../services/strategy/gridStrategyService.js'
import { dailyReviewWorkflowService } from '../services/review/dailyReviewWorkflowService.js'
import { alipayOneClickReviewService } from '../services/review/alipayOneClickReviewService.js'
import { alipayResearchWorkflowService } from '../services/review/alipayResearchWorkflowService.js'
import { alipayResearchWorkflowScheduler } from '../services/review/alipayResearchWorkflowScheduler.js'
import { brokerReviewReconciliationService } from '../services/review/brokerReviewReconciliationService.js'
import { dailyReviewHtmlService } from '../services/review/dailyReviewHtmlService.js'
import { brokerReviewReminderScheduler } from '../services/review/brokerReviewReminderScheduler.js'

export async function dailyReviewRoutes(app: FastifyInstance) {
  app.post('/reconcile', async (request) => {
    const body = request.body as any
    return brokerReviewReconciliationService.reconcile({
      userId: body.userId || 'default',
      sessionType: body.sessionType || 'manual',
      holdingsCaptureId: body.holdingsCaptureId,
      tradesCaptureId: body.tradesCaptureId,
      ordinaryOrdersCaptureId: body.ordinaryOrdersCaptureId,
      conditionalOrdersCaptureId: body.conditionalOrdersCaptureId,
      zeroNewTradesConfirmed: body.zeroNewTradesConfirmed === true,
    })
  })

  app.get('/alipay-research-workflow/config', async (request) => {
    const query = request.query as any
    return alipayResearchWorkflowService.getConfig(query.userId || 'default')
  })

  app.put('/alipay-research-workflow/config', async (request) => {
    const body = request.body as any
    return alipayResearchWorkflowService.updateConfig({
      userId: body.userId || 'default',
      schedulerEnabled: typeof body.schedulerEnabled === 'boolean' ? body.schedulerEnabled : undefined,
      slots: Array.isArray(body.slots) ? body.slots : undefined,
    })
  })

  app.post('/alipay-research-workflow/snapshot-authorization', async (request) => {
    const body = request.body as any
    return alipayResearchWorkflowService.authorizeSnapshot({ userId: body.userId || 'default', captureId: body.captureId })
  })

  app.post('/alipay-research-workflow/snapshot-authorization/revoke', async (request) => {
    const body = request.body as any
    return alipayResearchWorkflowService.revokeSnapshot({ userId: body.userId || 'default', reason: body.reason })
  })

  app.post('/alipay-research-workflow/run', async (request, reply) => {
    const body = request.body as any
    const userId = body.userId || 'default'
    let portfolioChangedSinceLastCapture = body.portfolioChangedSinceLastCapture
    if (typeof portfolioChangedSinceLastCapture !== 'boolean') {
      const authorization = await alipayResearchWorkflowService.checkSnapshotAuthorization(userId)
      if (!authorization.valid) return reply.status(409).send({
        schemaVersion: 'fams.alipay-research-workflow-blocked.v1',
        started: false,
        blockers: authorization.blockers,
        retryable: true,
      })
      portfolioChangedSinceLastCapture = false
    }
    const result = await alipayOneClickReviewService.start({
      userId,
      sessionType: body.sessionType || 'manual',
      portfolioChangedSinceLastCapture,
      idempotencyKey: body.idempotencyKey,
      triggerSource: body.triggerSource === 'scheduler' ? 'scheduler' : 'user',
    })
    if (!result.started) reply.code(409)
    return result
  })

  app.get('/alipay-research-workflow/scheduler/status', async (request) => {
    const query = request.query as any
    return alipayResearchWorkflowScheduler.getStatus(query.userId || 'default')
  })

  app.post('/alipay-one-click/preflight', async (request) => {
    const body = request.body as any
    return alipayOneClickReviewService.preflight({
      userId: body.userId || 'default',
      portfolioChangedSinceLastCapture: body.portfolioChangedSinceLastCapture,
    })
  })

  app.post('/alipay-one-click/run', async (request, reply) => {
    const body = request.body as any
    const result = await alipayOneClickReviewService.start({
      userId: body.userId || 'default',
      sessionType: body.sessionType || 'manual',
      portfolioChangedSinceLastCapture: body.portfolioChangedSinceLastCapture,
      idempotencyKey: body.idempotencyKey,
      triggerSource: body.triggerSource === 'scheduler' ? 'scheduler' : 'user',
    })
    if (!result.started) reply.code(409)
    return result
  })

  app.post<{ Params: { id: string } }>('/alipay-one-click/:id/retry-llm', async (request) => {
    const body = request.body as any
    return alipayOneClickReviewService.retryLlm({ userId: body.userId || 'default', reviewId: request.params.id })
  })

  app.post<{ Params: { id: string; actionId: string } }>('/alipay-one-click/:id/actions/:actionId/decision', async (request) => {
    const body = request.body as any
    return alipayOneClickReviewService.decideDraft({
      userId: body.userId || 'default',
      reviewId: request.params.id,
      actionId: request.params.actionId,
      decision: body.decision,
      overrideAmount: body.overrideAmount,
      notes: body.notes,
    })
  })

  app.post('/run', async (request) => {
    const body = request.body as any
    return dailyReviewService.startReview({
      userId: body.userId || 'default',
      sessionType: body.sessionType || 'manual',
      triggerSource: body.triggerSource || 'user',
      idempotencyKey: body.idempotencyKey,
      executionMode: body.executionMode || 'inline',
      requireLlmSuccess: body.requireLlmSuccess === true,
      brokerWorkflow: body.brokerWorkflow !== false,
      brokerReconciliationInput: {
        holdingsCaptureId: body.holdingsCaptureId,
        tradesCaptureId: body.tradesCaptureId,
        ordinaryOrdersCaptureId: body.ordinaryOrdersCaptureId,
        conditionalOrdersCaptureId: body.conditionalOrdersCaptureId,
        zeroNewTradesConfirmed: body.zeroNewTradesConfirmed === true,
      },
    })
  })

  app.get('/latest', async (request) => {
    const query = request.query as any
    return dailyReviewService.getLatest(query.userId || 'default', query.sessionType)
  })

  app.get('/', async (request) => {
    const query = request.query as any
    return dailyReviewService.listReviews({
      userId: query.userId || 'default',
      sessionType: query.sessionType,
      status: query.status,
      cursor: query.cursor,
      limit: query.limit === undefined ? undefined : Number(query.limit),
    })
  })

  app.get('/scheduler/status', async () => dailyReviewScheduler.getStatus())
  app.post('/scheduler/run-once', async () => dailyReviewScheduler.runOnce('manual'))
  app.get('/broker-reminders/status', async () => brokerReviewReminderScheduler.getStatus())
  app.post('/broker-reminders/run-once', async () => brokerReviewReminderScheduler.runOnce('manual'))

  app.get('/strategy/templates', async () => ({ schemaVersion: 'fams.grid-strategy-templates.v1', templates: gridStrategyService.listTemplates() }))
  app.post('/strategy/drafts', async (request) => gridStrategyService.createDraft(request.body as any))
  app.post('/strategy/downtrend-drafts', async (request) => {
    const body = request.body as any
    return gridStrategyService.createDowntrendDraft({ userId: body.userId || 'default', config: body.config, description: body.description })
  })
  app.post<{ Params: { versionId: string } }>('/strategy/versions/:versionId/validate', async (request) => {
    const body = request.body as any
    return gridStrategyService.validateDraft(request.params.versionId, body.userId || 'default')
  })
  app.post<{ Params: { versionId: string } }>('/strategy/versions/:versionId/activate', async (request) => {
    const body = request.body as any
    return gridStrategyService.activate(request.params.versionId, body, body.userId || 'default')
  })
  app.get<{ Params: { id: string } }>('/:id/workflow', async (request) => {
    const query = request.query as any
    return dailyReviewWorkflowService.getWorkflow(request.params.id, query.userId || 'default')
  })
  app.get<{ Params: { id: string } }>('/:id/report.html', async (request, reply) => {
    const query = request.query as any
    const rendered = await dailyReviewHtmlService.render(request.params.id, query.userId || 'default')
    return reply
      .header('Content-Type', 'text/html; charset=utf-8')
      .header('Content-Disposition', `inline; filename="${rendered.filename}"`)
      .send(rendered.html)
  })
  app.get<{ Params: { id: string } }>('/:id', async (request) => {
    const query = request.query as any
    return dailyReviewService.getReview(request.params.id, query.userId || 'default')
  })
}
