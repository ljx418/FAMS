import { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { operationService } from '../services/operation/operationService.js'
import { volatilitySleeveService } from '../services/volatility-sleeve/volatilitySleeveService.js'
import { relativeRotationService } from '../services/relative-rotation/relativeRotationService.js'

export async function relativeRotationRoutes(app: FastifyInstance) {
  app.get('/holdings', async (request) => {
    const query = request.query as Record<string, string | undefined>
    const frequency = query.frequency === 'daily' ? 'daily' : 'weekly'
    const trail = Math.max(1, Math.min(52, Number(query.trail || 12)))
    return volatilitySleeveService.getOverview(query.userId || 'default', { frequency, trail })
  })

  app.get('/timeline', async (request) => {
    const query = request.query as Record<string, string | undefined>
    const frequency = query.frequency === 'daily' ? 'daily' : 'weekly'
    const years = Math.max(1, Math.min(8, Number(query.years || 8)))
    return relativeRotationService.getHoldingsTimeline(query.userId || 'default', { frequency, years })
  })

  app.post('/timeline/refresh', async (request) => {
    const body = request.body as Record<string, unknown>
    const userId = typeof body.userId === 'string' ? body.userId : 'default'
    const years = Math.max(1, Math.min(8, Number(body.years || 8)))
    return operationService.startRelativeRotationHistoryRefreshOperation({
      userId,
      years,
      executionMode: body.executionMode === 'queued' ? 'queued' : 'inline',
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : 'user',
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    })
  })

  app.post('/backtests', async (request) => {
    const body = request.body as Record<string, unknown>
    return operationService.startRelativeRotationBacktestOperation({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      positionIds: Array.isArray(body.positionIds) ? body.positionIds.map(String) : undefined,
      executionMode: body.executionMode === 'inline' ? 'inline' : 'queued',
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : 'user',
    })
  })

  app.get('/backtests/latest', async (request) => {
    const query = request.query as Record<string, string | undefined>
    if (!query.positionId) throw new Error('positionId is required')
    const backtest = await prisma.volatilityStrategyBacktest.findFirst({
      where: { userId: query.userId || 'default', positionId: query.positionId },
      orderBy: { createdAt: 'desc' },
    })
    if (!backtest) return null
    return {
      ...backtest,
      metrics: JSON.parse(backtest.metricsJson || '{}'),
      candidates: JSON.parse(backtest.candidatesJson || '[]'),
      blockers: JSON.parse(backtest.blockersJson || '[]'),
      warnings: JSON.parse(backtest.warningsJson || '[]'),
    }
  })

  app.post('/daily-analysis', async (request) => {
    const body = request.body as Record<string, unknown>
    return operationService.startVolatilitySleeveDailyAnalysisOperation({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      refresh: body.refresh !== false,
      executionMode: body.executionMode === 'inline' ? 'inline' : 'queued',
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : 'user',
    })
  })

  app.post('/drafts/:draftId/confirm', async (request) => {
    const { draftId } = request.params as { draftId: string }
    const body = request.body as Record<string, unknown>
    return volatilitySleeveService.confirmDraft({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      draftId,
      quantity: Number(body.quantity),
      price: Number(body.price),
      fee: typeof body.fee === 'number' ? body.fee : undefined,
      executedAt: typeof body.executedAt === 'string' ? body.executedAt : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
    })
  })

  app.post('/drafts/:draftId/dismiss', async (request) => {
    const { draftId } = request.params as { draftId: string }
    const body = request.body as Record<string, unknown>
    return volatilitySleeveService.dismissDraft(
      typeof body.userId === 'string' ? body.userId : 'default',
      draftId,
    )
  })
}
