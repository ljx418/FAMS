import { FastifyInstance } from 'fastify'
import { operationService } from '../services/operation/operationService.js'
import { positionService } from '../services/position/positionService.js'

const numericPositionFields = {
  quantity: { type: 'number', minimum: 0 },
  avgCost: { type: 'number', minimum: 0 },
  currentPrice: { type: 'number', minimum: 0 },
  costBasis: { type: 'number', minimum: 0 },
  marketValue: { type: 'number', minimum: 0 },
  unrealizedPnl: { type: 'number' },
  stopLoss: { type: ['number', 'null'] },
  takeProfit: { type: ['number', 'null'] },
}

const tagArraySchema = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
}

const createPositionSchema = {
  body: {
    type: 'object',
    required: ['userId', 'assetId', 'quantity', 'avgCost'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      assetId: { type: 'string', minLength: 1 },
      quantity: numericPositionFields.quantity,
      avgCost: numericPositionFields.avgCost,
      tags: tagArraySchema,
      labels: tagArraySchema,
      stopLoss: numericPositionFields.stopLoss,
      takeProfit: numericPositionFields.takeProfit,
    },
  },
}

const updatePositionSchema = {
  params: {
    type: 'object',
    required: ['id'],
    properties: {
      id: { type: 'string', minLength: 1 },
    },
  },
  body: {
    type: 'object',
    minProperties: 1,
    additionalProperties: false,
    properties: {
      ...numericPositionFields,
      tags: tagArraySchema,
      labels: tagArraySchema,
    },
  },
}

const manualBuyPositionSchema = {
  body: {
    type: 'object',
    required: ['userId', 'input'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      input: { type: 'string', minLength: 1 },
      name: { type: 'string' },
      assetType: { type: 'string', enum: ['stock', 'fund', 'bond', 'gold', 'cash', 'crypto', 'etf', 'reit'] },
      amount: { type: 'number', minimum: 0 },
      quantity: { type: 'number', minimum: 0 },
      price: { type: 'number', minimum: 0 },
      fee: { type: 'number', minimum: 0 },
      tags: tagArraySchema,
      notes: { type: 'string' },
      executedAt: { type: 'string' },
    },
  },
}

export async function positionRoutes(app: FastifyInstance) {
  // 获取仓位列表
  app.get('/', async (request) => {
    const { userId, status, assetType, tags, page, limit } = request.query as any
    return positionService.getPositions(userId, { status, assetType, tags, page, limit })
  })

  app.post('/manual-buy', { schema: manualBuyPositionSchema }, async (request) => {
    const { userId, ...data } = request.body as any
    return positionService.createManualBuyPosition(userId, data)
  })

  // 获取单个仓位
  app.get('/:id', async (request) => {
    const { id } = request.params as any
    return positionService.getPosition(id)
  })

  // 创建仓位
  app.post('/', { schema: createPositionSchema }, async (request) => {
    const { userId, assetId, quantity, avgCost, tags, labels, stopLoss, takeProfit } = request.body as any
    return positionService.createPosition(userId, { assetId, quantity, avgCost, tags, labels, stopLoss, takeProfit })
  })

  // 更新仓位
  app.put('/:id', { schema: updatePositionSchema }, async (request) => {
    const { id } = request.params as any
    const data = request.body as any
    return positionService.updatePosition(id, data)
  })

  app.patch('/:id', { schema: updatePositionSchema }, async (request) => {
    const { id } = request.params as any
    const data = request.body as any
    return positionService.updatePosition(id, data)
  })

  // 删除单个仓位
  app.delete('/:id', async (request) => {
    const { id } = request.params as any
    return positionService.deletePosition(id)
  })

  // 清空所有仓位
  app.delete('/', async (request) => {
    const { userId } = request.query as any
    if (!userId) {
      throw new Error('userId is required')
    }
    return positionService.clearAllPositions(userId)
  })

  // 批量保存仓位
  app.post('/save', async (request) => {
    const { userId, positions } = request.body as any
    if (!userId || !positions) {
      throw new Error('userId and positions are required')
    }
    return positionService.batchSavePositions(userId, positions)
  })

  // 同步仓位：统一进入异步 Operation，避免绕过任务中心
  app.post('/sync', async (request) => {
    const { userId } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }
    return operationService.startRefreshPricesOperation({ userId })
  })

  // 平仓
  app.post('/:id/close', async (request) => {
    const { id } = request.params as any
    return positionService.closePosition(id)
  })

  // 刷新价格
  app.post('/refresh-prices', async (request) => {
    const { userId } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }
    return operationService.startRefreshPricesOperation({ userId })
  })

  app.get('/targets/:userId', async (request) => {
    const { userId } = request.params as any
    return positionService.getPositionTargets(userId)
  })

  app.put('/targets/:userId/:tag', async (request) => {
    const { userId, tag } = request.params as any
    const { targetValue } = request.body as any
    return positionService.updatePositionTarget(userId, decodeURIComponent(tag), Number(targetValue))
  })

  // 计算止损止盈
  app.get('/:id/analysis', async (request) => {
    const { id } = request.params as any
    return positionService.calculateStopLossTakeProfit(id)
  })

  // 按标签分组获取仓位（粮仓可视化）
  app.get('/by-tag/:userId', async (request) => {
    const { userId } = request.params as any
    return positionService.getPositionsByTag(userId)
  })
}
