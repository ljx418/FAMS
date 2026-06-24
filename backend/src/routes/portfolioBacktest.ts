import { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { portfolioBacktestEngine } from '../services/portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../services/portfolio-backtest/portfolioBacktestInputBuilder.js'
import { portfolioStrategyRegistry } from '../services/portfolio-backtest/portfolioStrategyRegistry.js'
import { ensureUser } from '../utils/user.js'

export async function portfolioBacktestRoutes(app: FastifyInstance) {
  app.get('/templates', async () => {
    return {
      schemaVersion: 'portfolio.strategy_backtest.templates.v1',
      generatedAt: new Date().toISOString(),
      templates: portfolioStrategyRegistry.listPresetTemplates(),
      allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      notTradingAdvice: true,
    }
  })

  app.post('/run', async (request) => {
    const body = request.body as Record<string, unknown>
    const input = await portfolioBacktestInputBuilder.build({
      ...(body || {}),
      userId: typeof body?.userId === 'string' ? body.userId : 'default',
    } as any)
    const result = await portfolioBacktestEngine.run(input)
    if (body?.executionMode === 'operation') {
      await ensureUser(prisma, input.request.userId)
      const generatedAt = new Date()
      const artifacts = {
        '01_request_and_strategy_definitions.json': {
          schemaVersion: 'portfolio.backtest.request_and_strategy_definitions.v1',
          generatedAt: generatedAt.toISOString(),
          request: input.request,
          strategies: input.strategies,
          allowedActions: result.allowedActions,
          prohibitedActions: result.prohibitedActions,
          notTradingAdvice: true,
        },
        '02_input_data_coverage.json': {
          schemaVersion: 'portfolio.backtest.input_data_coverage.v1',
          generatedAt: generatedAt.toISOString(),
          inputDataQuality: input.dataQuality,
          strategyCoverage: result.strategies.map((strategy) => ({
            strategyId: strategy.definition.strategyId,
            status: strategy.status,
            dataCoverage: strategy.dataCoverage,
            blockedReasons: strategy.blockedReasons,
            warnings: strategy.warnings,
            evidenceRefs: strategy.evidenceRefs,
          })),
        },
        '03_backtest_results.json': {
          schemaVersion: 'portfolio.backtest.results.v1',
          generatedAt: generatedAt.toISOString(),
          result,
        },
        '04_benchmark_comparison.json': {
          schemaVersion: 'portfolio.backtest.benchmark_comparison.v1',
          generatedAt: generatedAt.toISOString(),
          benchmarkIds: input.request.benchmarkIds,
          comparisons: result.strategies.map((strategy) => ({
            strategyId: strategy.definition.strategyId,
            benchmarkReturnPercent: strategy.metrics.benchmarkReturnPercent,
            excessReturnPercent: strategy.metrics.excessReturnPercent,
            benchmarkCoveragePercent: strategy.dataCoverage.benchmarkCoveragePercent,
            warnings: strategy.warnings.filter((warning) => warning.includes('benchmark')),
          })),
        },
        '05_frontend_user_path.json': {
          schemaVersion: 'portfolio.backtest.frontend_user_path.v1',
          generatedAt: generatedAt.toISOString(),
          expectedPath: [
            '打开策略回测页',
            '选择组合模板',
            '设置区间和参数',
            '运行组合回测',
            '查看多组合曲线、指标、benchmark、缺口和非交易提示',
            '进入任务中心查看 artifact',
          ],
          notTradingAdvice: true,
        },
        '06_trade_gate_contract.json': {
          schemaVersion: 'portfolio.backtest.trade_gate_contract.v1',
          generatedAt: generatedAt.toISOString(),
          allowedActions: result.allowedActions,
          prohibitedActions: result.prohibitedActions,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          notTradingAdvice: true,
        },
      }
      const operation = await prisma.operation.create({
        data: {
          userId: input.request.userId,
          type: 'portfolio_backtest_run',
          status: 'completed',
          requestedAt: generatedAt,
          startedAt: generatedAt,
          completedAt: generatedAt,
          progressPct: 100,
          progressCurrent: 100,
          progressTotal: 100,
          progressMessage: '组合策略回测已完成',
          createdBy: 'user',
          inputJson: JSON.stringify(input.request),
          resultJson: JSON.stringify({
            schemaVersion: 'portfolio.backtest.operation_result.v1',
            generatedAt: generatedAt.toISOString(),
            status: 'completed',
            strategyCount: result.strategies.length,
            completedStrategyCount: result.strategies.filter((strategy) => strategy.status === 'completed').length,
            partialStrategyCount: result.strategies.filter((strategy) => strategy.status === 'partial').length,
            insufficientStrategyCount: result.strategies.filter((strategy) => strategy.status === 'insufficient').length,
            allowedActions: result.allowedActions,
            prohibitedActions: result.prohibitedActions,
            notTradingAdvice: true,
            artifacts,
          }),
          artifactRefsJson: JSON.stringify(Object.keys(artifacts).map((filename) => `operation_artifact:__OPERATION_ID__:${filename}`)),
        },
      })
      const artifactRefs = Object.keys(artifacts).map((filename) => `operation_artifact:${operation.id}:${filename}`)
      await prisma.operation.update({
        where: { id: operation.id },
        data: { artifactRefsJson: JSON.stringify(artifactRefs) },
      })
      return {
        schemaVersion: 'portfolio.strategy_backtest.operation_submission.v1',
        operationId: operation.id,
        status: 'completed',
        result,
        artifactRefs,
        allowedActions: result.allowedActions,
        prohibitedActions: result.prohibitedActions,
        notTradingAdvice: true,
      }
    }
    return result
  })
}
