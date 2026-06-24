import { FastifyInstance } from 'fastify'
import { operationService } from '../services/operation/operationService.js'
import { factsetRefreshScheduler } from '../services/operation/factsetRefreshScheduler.js'

const refreshPricesSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      assetIds: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      symbols: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
    },
  },
}

const checkAlertsSchema = {
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

const generateDailyAdviceSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      query: { type: 'string' },
      scope: { type: 'string', enum: ['all', 'asset', 'sector'] },
      parentOperationId: { type: 'string', minLength: 1 },
    },
  },
}

const runBacktestSchema = {
  body: {
    type: 'object',
    required: ['userId', 'adviceId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      adviceId: { type: 'string', minLength: 1 },
      startDate: { type: 'string' },
      endDate: { type: 'string' },
      initialCapital: { type: 'number', minimum: 0 },
      parentOperationId: { type: 'string', minLength: 1 },
    },
  },
}

const stockScreenerFullScanSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      query: { type: 'string' },
      mode: { type: 'string', enum: ['default', 'long_sample_dry_run', 'long_sample_full'] },
      confirmedFullScan: { type: 'boolean' },
      parentOperationId: { type: 'string', minLength: 1 },
    },
  },
}

const strategyTournamentRunSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      query: { type: 'string' },
      maxScan: { type: 'number', minimum: 1 },
      backtestDays: { type: 'number', minimum: 1 },
      holdingDays: { type: 'number', minimum: 1 },
      chunkSize: { type: 'number', minimum: 1 },
      confirmedFullScan: { type: 'boolean' },
      parentOperationId: { type: 'string', minLength: 1 },
      executionMode: { type: 'string', enum: ['inline', 'queued'] },
    },
  },
}

const batchFactsetRefreshSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      scope: { type: 'string', enum: ['all', 'position_advice', 'stock_factset'] },
      symbols: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      limit: { type: 'number', minimum: 1 },
      parentOperationId: { type: 'string', minLength: 1 },
    },
  },
}

const dueFactsetRefreshSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      scope: { type: 'string', enum: ['all', 'position_advice', 'stock_factset'] },
      horizonMinutes: { type: 'number', minimum: 0 },
      limit: { type: 'number', minimum: 1 },
      submit: { type: 'boolean' },
      force: { type: 'boolean' },
    },
  },
}

const quoteListMarketCapWarmupSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      symbols: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      limit: { type: 'number', minimum: 1 },
      chunkSize: { type: 'number', minimum: 1 },
      parentOperationId: { type: 'string', minLength: 1 },
      executionMode: { type: 'string', enum: ['inline', 'queued'] },
    },
  },
}

const marketBarCachePreheatSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      limit: { type: 'number', minimum: 1 },
      days: { type: 'number', minimum: 1 },
      chunkSize: { type: 'number', minimum: 1 },
      concurrency: { type: 'number', minimum: 1 },
      forceRefresh: { type: 'boolean' },
      parentOperationId: { type: 'string', minLength: 1 },
      executionMode: { type: 'string', enum: ['inline', 'queued'] },
    },
  },
}

const dividendLowVolDailyScanSchema = {
  body: {
    type: 'object',
    required: ['userId'],
    additionalProperties: false,
    properties: {
      userId: { type: 'string', minLength: 1 },
      symbols: {
        type: 'array',
        items: { type: 'string', minLength: 1 },
      },
      limit: { type: 'number', minimum: 1 },
      universe: { type: 'string', enum: ['provided_symbols', 'all_a'] },
      parentOperationId: { type: 'string', minLength: 1 },
      executionMode: { type: 'string', enum: ['inline', 'queued'] },
    },
  },
}

export async function operationRoutes(app: FastifyInstance) {
  app.get('/schedulers/factset-refresh', async () => {
    return factsetRefreshScheduler.getStatus()
  })

  app.get('/', async (request) => {
    const { userId, type, status, limit } = request.query as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.listOperations({
      userId,
      type,
      status,
      limit: limit ? Number(limit) : undefined,
    })
  })

  app.get('/artifacts/:ref', async (request) => {
    const { ref } = request.params as any
    return operationService.getArtifact(decodeURIComponent(ref))
  })

  app.get('/:id', async (request) => {
    const { id } = request.params as any
    return operationService.getOperation(id)
  })

  app.post('/:id/retry', async (request) => {
    const { id } = request.params as any
    return operationService.retryOperation(id)
  })

  app.post('/:id/cancel', async (request) => {
    const { id } = request.params as any
    return operationService.cancelOperation(id)
  })

  app.post('/refresh-prices', { schema: refreshPricesSchema }, async (request) => {
    const { userId, assetIds, symbols } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.startRefreshPricesOperation({
      userId,
      assetIds,
      symbols,
    })
  })

  app.post('/check-alerts', { schema: checkAlertsSchema }, async (request) => {
    const { userId, refreshPrices } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.startCheckAlertsOperation({
      userId,
      refreshPrices,
    })
  })

  app.post('/generate-daily-advice', { schema: generateDailyAdviceSchema }, async (request) => {
    const { userId, query, scope, parentOperationId } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.startGenerateDailyAdviceOperation({
      userId,
      query,
      scope,
      parentOperationId,
    })
  })

  app.post('/run-backtest', { schema: runBacktestSchema }, async (request) => {
    const { userId, adviceId, startDate, endDate, initialCapital, parentOperationId } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }
    if (!adviceId) {
      throw new Error('adviceId is required')
    }

    return operationService.startRunBacktestOperation({
      userId,
      adviceId,
      startDate,
      endDate,
      initialCapital,
      parentOperationId,
    })
  })

  app.post('/stock-screener-full-scan', { schema: stockScreenerFullScanSchema }, async (request) => {
    const { userId, query, mode, confirmedFullScan, parentOperationId } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.startStockScreenerFullScanOperation({
      userId,
      query,
      mode,
      confirmedFullScan,
      parentOperationId,
    })
  })

  app.post('/strategy-tournament-run', { schema: strategyTournamentRunSchema }, async (request) => {
    const { userId, query, maxScan, backtestDays, holdingDays, chunkSize, confirmedFullScan, parentOperationId, executionMode } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.startStrategyTournamentRunOperation({
      userId,
      query,
      maxScan,
      backtestDays,
      holdingDays,
      chunkSize,
      confirmedFullScan,
      parentOperationId,
      executionMode,
    })
  })

  app.post('/refresh-factsets', { schema: batchFactsetRefreshSchema }, async (request) => {
    const { userId, scope, symbols, limit, parentOperationId } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.startBatchFactsetRefreshOperation({
      userId,
      scope: scope || 'all',
      symbols,
      limit,
      parentOperationId,
    })
  })

  app.post('/refresh-due-factsets', { schema: dueFactsetRefreshSchema }, async (request) => {
    const { userId, scope, horizonMinutes, limit, submit, force } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.scheduleDueFactsetRefresh({
      userId,
      scope: scope || 'all',
      horizonMinutes,
      limit,
      submit,
      force,
    })
  })

  app.post('/quote-list-market-cap-warmup', { schema: quoteListMarketCapWarmupSchema }, async (request) => {
    const { userId, limit, chunkSize, parentOperationId, executionMode } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.startQuoteListMarketCapWarmupOperation({
      userId,
      limit,
      chunkSize,
      parentOperationId,
      executionMode,
    })
  })

  app.post('/market-bar-cache-preheat', { schema: marketBarCachePreheatSchema }, async (request) => {
    const { userId, symbols, limit, days, chunkSize, concurrency, forceRefresh, parentOperationId, executionMode } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.startMarketBarCachePreheatOperation({
      userId,
      symbols: Array.isArray(symbols) ? symbols : undefined,
      limit,
      days,
      chunkSize,
      concurrency,
      forceRefresh,
      parentOperationId,
      executionMode,
    })
  })

  app.post('/dividend-low-vol-daily-scan', { schema: dividendLowVolDailyScanSchema }, async (request) => {
    const { userId, symbols, limit, universe, parentOperationId, executionMode } = request.body as any
    if (!userId) {
      throw new Error('userId is required')
    }

    return operationService.startDividendLowVolDailyScanOperation({
      userId,
      symbols: Array.isArray(symbols) ? symbols : undefined,
      limit,
      universe,
      parentOperationId,
      executionMode,
    })
  })
}
