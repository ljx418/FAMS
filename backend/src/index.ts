import 'dotenv/config'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import swagger from '@fastify/swagger'
import swaggerUi from '@fastify/swagger-ui'
import multipart from '@fastify/multipart'
import { prisma } from './db/prisma.js'
import { positionRoutes } from './routes/position.js'
import { assetRoutes } from './routes/asset.js'
import { transactionRoutes } from './routes/transaction.js'
import { analysisRoutes } from './routes/analysis.js'
import { portfolioRoutes } from './routes/portfolio.js'
import { backtestRoutes } from './routes/backtest.js'
import { portfolioBacktestRoutes } from './routes/portfolioBacktest.js'
import { alertRoutes } from './routes/alert.js'
import { priceRoutes } from './routes/price.js'
import { stockRoutes } from './routes/stock.js'
import { fundRoutes } from './routes/fund.js'
import { tagRoutes } from './routes/tag.js'
import { authRoutes } from './routes/auth.js'
import { mcpRouter } from './mcp/index.js'
import { agentRouter } from './agents/router.js'
import { workflowRouter } from './workflow/router.js'
import { llmRoutes } from './routes/llm.js'
import { templateRoutes } from './routes/template.js'
import { operationRoutes } from './routes/operation.js'
import { strategyRoutes } from './routes/strategy.js'
import { errorHandler } from './middleware/errorHandler.js'
import { operationService } from './services/operation/operationService.js'
import { factsetRefreshScheduler } from './services/operation/factsetRefreshScheduler.js'
import { runtimeHealthService } from './services/runtime/runtimeHealthService.js'

const app = Fastify({ logger: true })

// 初始化Fastify插件
async function initPlugins() {
  await app.register(cors, { origin: true })
  await app.register(multipart, {
    limits: {
      fileSize: 10 * 1024 * 1024, // 10MB
    },
  })
  await app.register(swagger, {
    openapi: {
      info: {
        title: 'FAMS API',
        description: 'Financial Asset Management System API',
        version: '1.0.0',
      },
      servers: [{ url: 'http://localhost:4000' }],
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
        },
      },
    },
  })
  await app.register(swaggerUi, { routePrefix: '/api-docs' })
}

// 注册路由
async function registerRoutes() {
  app.get('/health', async () => {
    const startedAt = new Date(Date.now() - Math.floor(process.uptime() * 1000)).toISOString()
    let database: 'ok' | 'failed' = 'ok'
    let operationHealth: Record<string, unknown> = {}
    let schedulerStatus: Record<string, unknown> | null = null
    let runtimeHealth: Record<string, unknown> | null = null
    try {
      await prisma.$queryRaw`SELECT 1`
      runtimeHealth = await runtimeHealthService.check({
        prisma,
        includeOperations: true,
        includeProviderHealth: true,
      })
      const [runningOperations, queuedOperations, activeFivdRRefresh] = await Promise.all([
        prisma.operation.count({ where: { status: 'running' } }),
        prisma.operation.count({ where: { status: 'queued' } }),
        prisma.operation.findFirst({
          where: {
            type: 'fivd_r_portfolio_refresh',
            status: { in: ['queued', 'running'] },
            cancelRequested: false,
          },
          select: {
            id: true,
            status: true,
            progressPct: true,
            progressMessage: true,
            requestedAt: true,
            startedAt: true,
          },
          orderBy: { requestedAt: 'desc' },
        }),
      ])
      operationHealth = {
        runningOperations,
        queuedOperations,
        activeFivdRRefresh,
      }
      schedulerStatus = await factsetRefreshScheduler.getStatus().catch(() => null)
    } catch {
      database = 'failed'
    }
    return {
      schemaVersion: 'fams.health.v1',
      status: database === 'ok' && (runtimeHealth as any)?.status !== 'critical' ? 'ok' : 'degraded',
      generatedAt: new Date().toISOString(),
      service: 'fams-backend',
      uptimeSeconds: Math.floor(process.uptime()),
      startedAt,
      database,
      runtimeHealth,
      operations: operationHealth,
      schedulers: {
        factsetRefresh: schedulerStatus,
      },
    }
  })

  await app.register(authRoutes, { prefix: '/api/v1/auth' })
  await app.register(assetRoutes, { prefix: '/api/v1/assets' })
  await app.register(templateRoutes, { prefix: '/api/v1/assets' })
  await app.register(positionRoutes, { prefix: '/api/v1/positions' })
  await app.register(transactionRoutes, { prefix: '/api/v1/transactions' })
  await app.register(portfolioRoutes, { prefix: '/api/v1/portfolios' })
  await app.register(analysisRoutes, { prefix: '/api/v1/analysis' })
  await app.register(backtestRoutes, { prefix: '/api/v1/backtest' })
  await app.register(portfolioBacktestRoutes, { prefix: '/api/v1/portfolio-backtest' })
  await app.register(alertRoutes, { prefix: '/api/v1/alerts' })
  await app.register(operationRoutes, { prefix: '/api/v1/operations' })
  await app.register(priceRoutes, { prefix: '/api/v1/prices' })
  await app.register(stockRoutes, { prefix: '/api/v1/stocks' })
  await app.register(strategyRoutes, { prefix: '/api/v1/strategy' })
  await app.register(fundRoutes, { prefix: '/api/v1/fund' })
  await app.register(tagRoutes, { prefix: '/api/v1/tags' })

  // AI Agent相关路由
  await app.register(mcpRouter, { prefix: '/api/v1/mcp' })
  await app.register(agentRouter, { prefix: '/api/v1/agents' })
  await app.register(workflowRouter, { prefix: '/api/v1/workflows' })

  // LLM 路由
  await app.register(llmRoutes, { prefix: '/api/v1/llm' })
}

// 错误处理
app.setErrorHandler(errorHandler)

// 启动服务
async function start() {
  try {
    await initPlugins()
    await registerRoutes()
    const recoveredOperations = await operationService.recoverInterruptedOperations()
    if (recoveredOperations.recoveredCount > 0) {
      app.log.info({
        recoveredCount: recoveredOperations.recoveredCount,
        operationIds: recoveredOperations.operationIds,
      }, 'Recovered interrupted operations')
    }

    await app.listen({ port: 4000, host: '0.0.0.0' })
    factsetRefreshScheduler.start(app.log)
    console.log('🚀 FAMS API Server running at http://localhost:4000')
    console.log('📖 API Docs available at http://localhost:4000/api-docs')
    console.log('🤖 MCP Router available at http://localhost:4000/api/v1/mcp')
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

// 优雅关闭
process.on('SIGTERM', async () => {
  factsetRefreshScheduler.stop()
  await prisma.$disconnect()
  await app.close()
})

start()

export { app, prisma }
