import { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { portfolioBacktestEngine } from '../services/portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../services/portfolio-backtest/portfolioBacktestInputBuilder.js'
import { portfolioBacktestReviewService } from '../services/portfolio-backtest/portfolioBacktestReviewService.js'
import { portfolioStrategyRegistry } from '../services/portfolio-backtest/portfolioStrategyRegistry.js'
import { runtimeHealthService } from '../services/runtime/runtimeHealthService.js'
import { ensureUser } from '../utils/user.js'

export async function portfolioBacktestRoutes(app: FastifyInstance) {
  app.get('/templates', async () => {
    const runtimeHealth = await runtimeHealthService.check({ prisma, lightweight: true })
    return {
      schemaVersion: 'portfolio.strategy_backtest.templates.v1',
      generatedAt: new Date().toISOString(),
      templates: portfolioStrategyRegistry.listPresetTemplates(),
      allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      notTradingAdvice: true,
      runtimeHealth: {
        status: runtimeHealth.status,
        sqliteHealthy: runtimeHealth.sqliteHealthy,
        decision: runtimeHealth.decision,
      },
    }
  })

  app.post('/run', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const runtimeHealth = await runtimeHealthService.check({
      prisma,
      lightweight: body?.executionMode !== 'operation',
    })
    if (body?.executionMode === 'operation' && runtimeHealth.decision.largeBacktestPersistenceAllowed !== true) {
      return reply.status(503).send({
        schemaVersion: 'portfolio.strategy_backtest.operation_submission_blocked.v1',
        status: 'blocked',
        blockedReasons: ['runtime_health_blocks_operation_persistence'],
        runtimeHealth: {
          status: runtimeHealth.status,
          sqliteHealthy: runtimeHealth.sqliteHealthy,
          decision: runtimeHealth.decision,
        },
        allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
        prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
        notTradingAdvice: true,
      })
    }
    const input = await portfolioBacktestInputBuilder.build({
      ...(body || {}),
      userId: typeof body?.userId === 'string' ? body.userId : 'default',
    } as any)
    input.runtimeHealth = {
      status: runtimeHealth.status,
      sqliteHealthy: runtimeHealth.sqliteHealthy,
      decision: runtimeHealth.decision,
    }
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
          runtimeHealth: result.runtimeHealth,
          notTradingAdvice: true,
        },
        '02_input_data_coverage.json': {
          schemaVersion: 'portfolio.backtest.input_data_coverage.v1',
          generatedAt: generatedAt.toISOString(),
          runtimeHealth: result.runtimeHealth,
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
          readinessSummary: result.readinessSummary,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          formalTradingUnlockChecklist: result.formalTradingUnlockChecklist,
          runtimeHealth: result.runtimeHealth,
          notTradingAdvice: true,
        },
        '07_formal_review_readiness.json': {
          schemaVersion: 'portfolio.backtest.formal_review_readiness.v1',
          generatedAt: generatedAt.toISOString(),
          gradeMode: input.request.gradeMode || 'research',
          readinessSummary: result.readinessSummary,
          formalReviewReadiness: result.formalReviewReadiness,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          notTradingAdvice: true,
          prohibitedActions: result.prohibitedActions,
        },
        '08_data_grade_audit.json': {
          schemaVersion: 'portfolio.backtest.data_grade_audit.v1',
          generatedAt: generatedAt.toISOString(),
          aggregate: result.dataGradeAudit,
          strategies: result.strategies.map((strategy) => ({
            strategyId: strategy.definition.strategyId,
            displayName: strategy.definition.displayName,
            dataGradeAudit: strategy.dataGradeAudit,
          })),
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          notTradingAdvice: true,
        },
        '09_model_effectiveness_audit.json': {
          schemaVersion: 'portfolio.backtest.model_effectiveness_audit.v1',
          generatedAt: generatedAt.toISOString(),
          aggregate: result.modelEffectiveness,
          strategies: result.strategies.map((strategy) => ({
            strategyId: strategy.definition.strategyId,
            displayName: strategy.definition.displayName,
            modelEffectiveness: strategy.modelEffectiveness,
          })),
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          notTradingAdvice: true,
        },
        '10_manual_plan_draft_audit.json': {
          schemaVersion: 'portfolio.backtest.manual_plan_draft_audit.v1',
          generatedAt: generatedAt.toISOString(),
          manualPlanDrafts: result.manualPlanDrafts,
          policy: {
            allowedActions: result.allowedActions,
            prohibitedActions: result.prohibitedActions,
            formalTargetWeightPercent: 0,
          },
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          notTradingAdvice: true,
        },
        '11_formal_trading_unlock_checklist.json': {
          schemaVersion: 'portfolio.backtest.formal_trading_unlock_checklist.v1',
          generatedAt: generatedAt.toISOString(),
          formalTradingUnlockChecklist: result.formalTradingUnlockChecklist,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          notTradingAdvice: true,
        },
        '12_execution_isolation_audit.json': {
          schemaVersion: 'portfolio.backtest.execution_isolation_audit.v1',
          generatedAt: generatedAt.toISOString(),
          executionIsolationAudit: result.executionIsolationAudit,
          paperOrderIntents: result.paperOrderIntents,
          productionAdapterEnabled: false,
          realPositionMutationAllowed: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          notTradingAdvice: true,
        },
        '13_formal_trading_release_gate_audit.json': {
          schemaVersion: 'portfolio.backtest.formal_trading_release_gate_audit.v1',
          generatedAt: generatedAt.toISOString(),
          releaseGateAudit: result.releaseGateAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '14_release_data_governance_audit.json': {
          schemaVersion: 'portfolio.backtest.release_data_governance_audit.v1',
          generatedAt: generatedAt.toISOString(),
          dataGovernanceAudit: result.dataGovernanceAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '15_benchmark_qualification_audit.json': {
          schemaVersion: 'portfolio.backtest.benchmark_qualification_audit.v1',
          generatedAt: generatedAt.toISOString(),
          benchmarkQualificationAudit: result.benchmarkQualificationAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '16_formal_validation_audit.json': {
          schemaVersion: 'portfolio.backtest.formal_validation_audit.v1',
          generatedAt: generatedAt.toISOString(),
          formalValidationAudit: result.formalValidationAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '17_manual_signoff_audit.json': {
          schemaVersion: 'portfolio.backtest.manual_signoff_audit.v1',
          generatedAt: generatedAt.toISOString(),
          manualSignoffAudit: result.manualSignoffAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '18_long_horizon_data_coverage_audit.json': {
          schemaVersion: 'portfolio.backtest.long_horizon_data_coverage_audit.v1',
          generatedAt: generatedAt.toISOString(),
          longHorizonDataCoverageAudit: result.longHorizonDataCoverageAudit,
          longHorizonRealDataBacktestReady: result.longHorizonDataCoverageAudit?.longHorizonRealDataBacktestReady === true,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '19_multi_period_backtest_result.json': {
          schemaVersion: 'portfolio.backtest.multi_period_backtest_result.v1',
          generatedAt: generatedAt.toISOString(),
          multiPeriodBacktestResult: result.multiPeriodBacktestResult,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '20_dividend_total_return_audit.json': {
          schemaVersion: 'portfolio.backtest.dividend_total_return_audit.v1',
          generatedAt: generatedAt.toISOString(),
          dividendTotalReturnAudit: result.dividendTotalReturnAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
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
            runId: result.runId,
            strategyCount: result.strategies.length,
            completedStrategyCount: result.strategies.filter((strategy) => strategy.status === 'completed').length,
            partialStrategyCount: result.strategies.filter((strategy) => strategy.status === 'partial').length,
            insufficientStrategyCount: result.strategies.filter((strategy) => strategy.status === 'insufficient').length,
            allowedActions: result.allowedActions,
            prohibitedActions: result.prohibitedActions,
            readinessSummary: result.readinessSummary,
            runtimeHealth: result.runtimeHealth,
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
        runtimeHealth: result.runtimeHealth,
        notTradingAdvice: true,
      }
    }
    return result
  })

  app.get('/reviews/:runId', async (request) => {
    const { runId } = request.params as { runId: string }
    return portfolioBacktestReviewService.getReview(runId)
  })

  app.post('/reviews/:runId', async (request, reply) => {
    const { runId } = request.params as { runId: string }
    const body = request.body as {
      reviewerId?: string
      role?: 'data' | 'model' | 'risk' | 'compliance' | 'final_release'
      decision?: string
      notes?: string
      blockedReasons?: string[]
      humanReviewChecklist?: string[]
    }
    if (!body?.reviewerId) {
      return reply.status(400).send({ error: 'reviewerId is required' })
    }
    if (!['approve_for_manual_review', 'request_changes', 'reject'].includes(String(body.decision))) {
      return reply.status(400).send({ error: 'decision must be approve_for_manual_review, request_changes, or reject' })
    }
    return portfolioBacktestReviewService.saveReview({
      runId,
      reviewerId: body.reviewerId,
      role: body.role,
      decision: body.decision as any,
      notes: body.notes,
      blockedReasons: body.blockedReasons,
      humanReviewChecklist: body.humanReviewChecklist,
    })
  })
}
