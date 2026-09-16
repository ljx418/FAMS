import { FastifyInstance } from 'fastify'
import { investmentWorkflowService } from '../services/investment-workflow/investmentWorkflowService.js'
import { rotationVolatilityStrategyService } from '../services/investment-workflow/rotationVolatilityStrategyService.js'

export async function investmentWorkflowRoutes(app: FastifyInstance) {
  app.get('/readiness', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return investmentWorkflowService.getReadiness(query.userId || 'default')
  })

  app.get('/assignments', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return investmentWorkflowService.listAssignments(query.userId || 'default')
  })

  app.put('/assignments/:positionId', async (request) => {
    const params = request.params as { positionId: string }
    const body = request.body as Record<string, unknown>
    return investmentWorkflowService.confirmAssignment({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      positionId: params.positionId,
      strategyFamily: body.strategyFamily as any,
      confirmedBy: String(body.confirmedBy || ''),
    })
  })

  app.get('/strategy-assignments', async (request) => {
    const query = request.query as Record<string, string | undefined>
    return investmentWorkflowService.listAssignments(query.userId || 'default')
  })

  app.post('/strategy-assignments/suggest', async (request) => {
    const body = request.body as Record<string, unknown>
    return investmentWorkflowService.suggestAssignments(typeof body.userId === 'string' ? body.userId : 'default')
  })

  app.post('/strategy-assignments/:positionId/confirm', async (request) => {
    const params = request.params as { positionId: string }
    const body = request.body as Record<string, unknown>
    return investmentWorkflowService.confirmAssignment({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      positionId: params.positionId,
      strategyFamily: body.strategyFamily as any,
      confirmedBy: String(body.confirmedBy || ''),
    })
  })

  app.post('/research-snapshots', async (request) => {
    const body = request.body as Record<string, unknown>
    return investmentWorkflowService.createResearchSnapshot({
      userId: typeof body.userId === 'string' ? body.userId : 'default',
      strategyFamily: body.strategyFamily as any,
      accountSource: body.accountSource as any,
      positionIds: Array.isArray(body.positionIds) ? body.positionIds.map(String) : undefined,
    })
  })

  app.get('/research-snapshots/:snapshotId', async (request) => {
    const params = request.params as { snapshotId: string }
    const query = request.query as Record<string, string | undefined>
    return investmentWorkflowService.getResearchSnapshot(query.userId || 'default', params.snapshotId)
  })

  app.post('/strategy-runs', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const userId = typeof body.userId === 'string' ? body.userId : 'default'
    const strategyFamily = String(body.strategyFamily || '')
    if (strategyFamily !== 'rotation_volatility') {
      throw new Error('WF-3 strategy-runs currently supports rotation_volatility only')
    }
    const requestedPositionIds = Array.isArray(body.positionIds) ? body.positionIds.map(String) : undefined
    let snapshot
    try {
      snapshot = await investmentWorkflowService.createResearchSnapshot({
        userId,
        strategyFamily: 'rotation_volatility',
        accountSource: 'tonghuashun',
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('No confirmed positions')) {
        return reply.code(409).send({
          schemaVersion: 'fams.investment-strategy-run-blocked.v1',
          status: 'blocked',
          code: 'STRATEGY_ASSIGNMENT_CONFIRMATION_REQUIRED',
          message: '请先在仓位管理中确认行业轮动/波动仓的策略归类，再运行策略。',
          blockedReasons: ['strategy_assignment_confirmation_required'],
          permissionState: {
            formalTradingUnlocked: false,
            autoTradeUnlocked: false,
            canCreateOrder: false,
            orderCreateAllowed: false,
          },
        })
      }
      throw error
    }
    return rotationVolatilityStrategyService.run({
      userId,
      snapshot,
      positionIds: requestedPositionIds,
      forceRecalculate: body.forceRecalculate === true,
      materialChange: ['none', 'watch', 'material', 'insufficient'].includes(String(body.materialChange))
        ? body.materialChange as 'none' | 'watch' | 'material' | 'insufficient'
        : 'none',
    })
  })
}
