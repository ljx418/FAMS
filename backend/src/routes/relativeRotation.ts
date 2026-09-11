import { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { operationService } from '../services/operation/operationService.js'
import { volatilitySleeveService } from '../services/volatility-sleeve/volatilitySleeveService.js'
import { relativeRotationService } from '../services/relative-rotation/relativeRotationService.js'
import { relativeRotationUniverseService } from '../services/relative-rotation/relativeRotationUniverseService.js'
import { portfolioRelativeRotationService } from '../services/relative-rotation/portfolioRelativeRotationService.js'
import { industryCrowdingService } from '../services/relative-rotation/industryCrowdingService.js'
import {
  relativeRotationResearchStudyService,
  type ResearchStudyInput,
  type ResearchTimelineRequest,
} from '../services/relative-rotation/relativeRotationResearchStudyService.js'

export async function relativeRotationRoutes(app: FastifyInstance) {
  app.get('/industry-crowding', async (request) => {
    const query = request.query as Record<string, string | undefined>
    const boardCodes = query.boardCodes
      ? query.boardCodes.split(',').map((code) => code.trim()).filter(Boolean)
      : undefined
    return industryCrowdingService.getReport(query.userId || 'default', {
      year: Number(query.year),
      frequency: query.frequency,
      boardCodes,
    })
  })

  app.post('/industry-crowding/refresh', async (request) => {
    const body = request.body as Record<string, unknown>
    return industryCrowdingService.refresh(
      typeof body.userId === 'string' ? body.userId : 'default',
      { year: Number(body.year) },
    )
  })

  app.post('/industry-crowding/backfill', async (request) => {
    const body = request.body as Record<string, unknown>
    return operationService.startIndustryCrowdingBackfillOperation({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      year: typeof body.year === 'number' ? body.year : undefined,
      boardCodes: Array.isArray(body.boardCodes) ? body.boardCodes.map(String) : undefined,
      executionMode: body.executionMode === 'queued' ? 'queued' : 'inline',
      createdBy: typeof body.createdBy === 'string' ? body.createdBy : 'user',
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    })
  })

  app.post('/industry-crowding/market-flow/refresh', async (request) => {
    const body = request.body as Record<string, unknown>
    return industryCrowdingService.refreshMarketFlow(typeof body.userId === 'string' ? body.userId : 'default')
  })

  app.get('/portfolio-universe', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return portfolioRelativeRotationService.getReport(query.userId || 'default', {
      frequency: query.frequency,
      years: Number(query.years || 8),
    })
  })

  app.post('/portfolio-universe/refresh', async (request) => {
    const body = request.body as Record<string, unknown>
    return portfolioRelativeRotationService.refresh(typeof body.userId === 'string' ? body.userId : 'default')
  })

  app.get('/research/studies', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return relativeRotationResearchStudyService.listStudies(query.userId || 'default')
  })

  app.post('/research/studies', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const study = await relativeRotationResearchStudyService.createStudy(
      typeof body.userId === 'string' ? body.userId : 'default',
      body.study as ResearchStudyInput,
    )
    reply.code(201)
    return study
  })

  app.patch('/research/studies/:studyId', async (request) => {
    const { studyId } = request.params as { studyId: string }
    const body = request.body as Record<string, unknown>
    return relativeRotationResearchStudyService.updateStudy(
      typeof body.userId === 'string' ? body.userId : 'default',
      studyId,
      body.study as ResearchStudyInput,
    )
  })

  app.delete('/research/studies/:studyId', async (request) => {
    const { studyId } = request.params as { studyId: string }
    const query = request.query as Record<string, string | undefined>
    return relativeRotationResearchStudyService.deleteStudy(query.userId || 'default', studyId)
  })

  app.post('/research/timeline', async (request) => {
    const body = request.body as Record<string, unknown>
    return relativeRotationResearchStudyService.getTimeline(
      typeof body.userId === 'string' ? body.userId : 'default',
      { studyId: typeof body.studyId === 'string' ? body.studyId : undefined, study: body.study as ResearchStudyInput | undefined } as ResearchTimelineRequest,
    )
  })

  app.post('/research/refresh', async (request) => {
    const body = request.body as Record<string, unknown>
    return relativeRotationResearchStudyService.refreshTimeline(
      typeof body.userId === 'string' ? body.userId : 'default',
      { studyId: typeof body.studyId === 'string' ? body.studyId : undefined, study: body.study as ResearchStudyInput | undefined } as ResearchTimelineRequest,
    )
  })

  app.get('/watchlist', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return relativeRotationUniverseService.listWatchlist(query.userId || 'default')
  })

  app.post('/watchlist', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const result = await relativeRotationUniverseService.addWatchlistItem(
      typeof body.userId === 'string' ? body.userId : 'default',
      String(body.market || ''),
      String(body.code || ''),
      {
        refresh: body.refresh !== false,
        years: typeof body.years === 'number' ? body.years : undefined,
      },
    )
    reply.code(result.created ? 201 : 200)
    return result
  })

  app.delete('/watchlist/:itemId', async (request) => {
    const { itemId } = request.params as { itemId: string }
    const query = request.query as Record<string, string | undefined>
    return relativeRotationUniverseService.deleteWatchlistItem(query.userId || 'default', itemId)
  })

  app.get('/universe/timeline', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return relativeRotationUniverseService.getUniverseTimeline(query.userId || 'default', {
      market: query.market,
      frequency: query.frequency,
      years: Number(query.years || 8),
    })
  })

  app.post('/universe/refresh', async (request) => {
    const body = request.body as Record<string, unknown>
    return relativeRotationUniverseService.refreshUniverse(
      typeof body.userId === 'string' ? body.userId : 'default',
      {
        market: typeof body.market === 'string' ? body.market : 'CN',
        targetKeys: Array.isArray(body.targetKeys) ? body.targetKeys.map(String) : [],
        years: typeof body.years === 'number' ? body.years : 8,
      },
    )
  })

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
