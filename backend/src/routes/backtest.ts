import { FastifyInstance } from 'fastify'
import { backtestService } from '../services/backtest/backtestService.js'
import { scenarioComparisonService } from '../services/backtest/scenarioComparisonService.js'

export async function backtestRoutes(app: FastifyInstance) {
  // 获取策略列表
  app.get('/strategies', async (request) => {
    const { userId } = request.query as any
    return backtestService.getStrategies(userId)
  })

  // 创建策略
  app.post('/strategies', async (request) => {
    const { userId, name, description, type, parameters } = request.body as any
    return backtestService.createStrategy(userId, { name, description, type, parameters })
  })

  // 运行回测
  app.post('/run', async (request) => {
    return backtestService.runBacktest(request.body as any)
  })

  app.post('/run-from-advice', async (request) => {
    return backtestService.runBacktestFromAdvice(request.body as any)
  })

  app.post('/scenario-comparison', async (request, reply) => {
    try {
      return await scenarioComparisonService.compare(request.body as any)
    } catch (error) {
      const statusCode = Number((error as Error & { statusCode?: number }).statusCode || 400)
      return reply.code(statusCode).send({
        code: 'SCENARIO_COMPARISON_FAILED',
        message: error instanceof Error ? error.message : '三场景回放失败',
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        canCreateOrder: false,
        orderCreateAllowed: false,
      })
    }
  })

  app.get('/advice-execution-review', async (request) => {
    const { userId, adviceId, startDate, endDate } = request.query as any
    return backtestService.getAdviceExecutionReview({ userId, adviceId, startDate, endDate })
  })

  app.get('/results', async (request) => {
    const { strategyId } = request.query as any
    return backtestService.getBacktests(strategyId)
  })

  // 获取回测结果
  app.get('/results/:id', async (request) => {
    const { id } = request.params as { id: string }
    return backtestService.getBacktestResult(id)
  })
}
