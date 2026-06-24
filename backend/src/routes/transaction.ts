import { FastifyInstance, FastifyRequest } from 'fastify'
import { transactionService, CreateTransactionParams, ImportMapping } from '../services/transaction/transactionService.js'
import { alertService } from '../services/alert/alertService.js'

const createTransactionSchema = {
  body: {
    type: 'object',
    required: ['userId', 'assetId', 'type', 'quantity', 'price'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      assetId: { type: 'string', minLength: 1 },
      type: { type: 'string', enum: ['buy', 'sell', 'dividend', 'fee', 'deposit', 'withdraw'] },
      quantity: { type: 'number', exclusiveMinimum: 0 },
      price: { type: 'number', minimum: 0 },
      fee: { type: 'number', minimum: 0 },
      broker: { type: 'string' },
      confirmationNo: { type: 'string' },
      executedAt: { type: 'string' },
      notes: { type: 'string' },
      adviceActionId: { type: 'string' },
    },
  },
}

export async function transactionRoutes(app: FastifyInstance) {
  // 获取交易列表
  app.get('/', async (request: FastifyRequest<{ Querystring: Record<string, string> }>) => {
    const { userId, assetId, type, startDate, endDate, status, page, limit } = request.query
    return transactionService.getTransactions(userId, {
      assetId,
      type,
      startDate: startDate ? new Date(startDate) : undefined,
      endDate: endDate ? new Date(endDate) : undefined,
      status,
      page: page ? parseInt(page) : 1,
      limit: limit ? parseInt(limit) : 20,
    })
  })

  // 创建交易
  app.post('/', { schema: createTransactionSchema }, async (request: FastifyRequest<{ Body: CreateTransactionParams }>) => {
    const transaction = await transactionService.createTransaction(request.body)
    let alertedSymbols: string[] = []

    try {
      alertedSymbols = await alertService.runAutoRiskCheck(request.body.userId, { refreshPrices: false })
    } catch (error) {
      app.log.warn({ error }, 'Risk check failed after transaction creation')
    }

    return {
      ...transaction,
      riskCheck: {
        alertedSymbols,
      },
    }
  })

  // 更新交易
  app.put('/:id', async (request: FastifyRequest<{ Params: { id: string }; Body: Record<string, unknown> }>) => {
    const { id } = request.params
    return transactionService.updateTransaction(id, request.body as any)
  })

  // 删除交易
  app.delete('/:id', async (request: FastifyRequest<{ Params: { id: string } }>) => {
    const { id } = request.params
    return transactionService.deleteTransaction(id)
  })

  // 批量导入交易
  app.post('/import', async (request: FastifyRequest<{ Body: { userId: string; file: unknown; mapping: Record<string, string> } }>) => {
    const { userId, file, mapping } = request.body as { userId: string; file: unknown; mapping: Record<string, string> }

    if (!userId) {
      throw new Error('userId is required')
    }

    if (!file) {
      throw new Error('file is required')
    }

    if (!mapping || !mapping.date || !mapping.symbol || !mapping.type || !mapping.quantity || !mapping.price) {
      throw new Error('mapping must include: date, symbol, type, quantity, price')
    }

    // 处理文件数据：支持 ArrayBuffer, Buffer, base64 字符串
    let fileBuffer: Buffer
    if (typeof file === 'string') {
      // 尝试解析为 base64
      const base64Data = file.replace(/^data:.*?;base64,/, '')
      fileBuffer = Buffer.from(base64Data, 'base64')
    } else if (Buffer.isBuffer(file)) {
      fileBuffer = file
    } else if (Array.isArray(file)) {
      fileBuffer = Buffer.from(file as number[])
    } else {
      throw new Error('Unsupported file format')
    }

    return transactionService.importTransactions(userId, fileBuffer, mapping as unknown as ImportMapping)
  })
}
