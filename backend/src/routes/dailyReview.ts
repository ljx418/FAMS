import { FastifyInstance } from 'fastify'
import { dailyReviewService } from '../services/review/dailyReviewService.js'
import { dailyReviewScheduler } from '../services/review/dailyReviewScheduler.js'
import { gridStrategyService } from '../services/strategy/gridStrategyService.js'
import { dailyReviewWorkflowService } from '../services/review/dailyReviewWorkflowService.js'

export async function dailyReviewRoutes(app: FastifyInstance) {
  app.post('/run', async (request) => {
    const body = request.body as any
    return dailyReviewService.startReview({
      userId: body.userId || 'default',
      sessionType: body.sessionType || 'manual',
      triggerSource: body.triggerSource || 'user',
      idempotencyKey: body.idempotencyKey,
      executionMode: body.executionMode || 'inline',
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

  app.get('/strategy/templates', async () => ({ schemaVersion: 'fams.grid-strategy-templates.v1', templates: gridStrategyService.listTemplates() }))
  app.post('/strategy/drafts', async (request) => gridStrategyService.createDraft(request.body as any))
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
  app.get<{ Params: { id: string } }>('/:id', async (request) => {
    const query = request.query as any
    return dailyReviewService.getReview(request.params.id, query.userId || 'default')
  })
}
