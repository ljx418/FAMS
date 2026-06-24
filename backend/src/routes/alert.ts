import { FastifyInstance } from 'fastify'
import { alertService } from '../services/alert/alertService.js'

const riskCheckSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      refreshPrices: { type: 'boolean' },
    },
  },
}

export async function alertRoutes(app: FastifyInstance) {
  // 获取宽基回撤监控配置
  app.get('/market-watch/rules', async (request) => {
    const { userId } = request.query as any
    return alertService.getMarketWatchRules(userId)
  })

  // 覆盖保存宽基回撤监控配置
  app.put('/market-watch/rules', async (request) => {
    const { userId, rules } = request.body as any
    return alertService.replaceMarketWatchRules(userId, rules)
  })

  // 获取宽基回撤监控结果
  app.get('/market-watch/evaluations', async (request) => {
    const { userId } = request.query as any
    return alertService.evaluateMarketWatch(userId)
  })

  // 立即检查宽基回撤监控并生成告警
  app.post('/market-watch/check', async (request) => {
    const { userId } = request.body as any
    const alertedSymbols = await alertService.checkAndGenerateMarketWatchAlerts(userId)
    return {
      alertedSymbols,
      alertCount: alertedSymbols.length,
    }
  })

  // 获取告警列表
  app.get('/', async (request) => {
    const { userId, status, severity, type } = request.query as any
    return alertService.getAlerts(userId, { status, severity, type })
  })

  // 获取单个告警
  app.get('/:id', async (request) => {
    const { id } = request.params as { id: string }
    return alertService.getAlert(id)
  })

  // 创建告警
  app.post('/', async (request) => {
    return alertService.createAlert(request.body as any)
  })

  // 确认告警
  app.post('/:id/acknowledge', async (request) => {
    const { id } = request.params as { id: string }
    return alertService.acknowledgeAlert(id)
  })

  // 解决告警
  app.post('/:id/resolve', async (request) => {
    const { id } = request.params as { id: string }
    return alertService.resolveAlert(id)
  })

  // 删除告警
  app.delete('/:id', async (request) => {
    const { id } = request.params as { id: string }
    return alertService.deleteAlert(id)
  })

  // 获取活跃告警数量
  app.get('/stats/active-count', async (request) => {
    const { userId } = request.query as any
    return { count: await alertService.getActiveAlertCount(userId) }
  })

  // 获取未读告警
  app.get('/unread', async (request) => {
    const { userId, limit } = request.query as any
    return alertService.getUnreadAlerts(userId, limit)
  })

  // 批量确认告警
  app.post('/batch/acknowledge', async (request) => {
    const { alertIds } = request.body as any
    return alertService.acknowledgeAlerts(alertIds)
  })

  // 批量解决告警
  app.post('/batch/resolve', async (request) => {
    const { alertIds } = request.body as any
    return alertService.resolveAlerts(alertIds)
  })

  // 执行自动风险检查
  app.post('/risk-check', { schema: riskCheckSchema }, async (request) => {
    const { userId, refreshPrices } = request.body as any
    return alertService.runAutoRiskCheck(userId, { refreshPrices: refreshPrices !== false })
  })
}
