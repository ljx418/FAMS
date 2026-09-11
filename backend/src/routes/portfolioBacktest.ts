import { FastifyInstance } from 'fastify'
import { prisma } from '../db/prisma.js'
import { portfolioBacktestEngine } from '../services/portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../services/portfolio-backtest/portfolioBacktestInputBuilder.js'
import { portfolioBacktestReviewService } from '../services/portfolio-backtest/portfolioBacktestReviewService.js'
import { portfolioStrategyRegistry } from '../services/portfolio-backtest/portfolioStrategyRegistry.js'
import { portfolioFixedRuleStudyService } from '../services/portfolio-backtest/portfolioFixedRuleStudyService.js'
import { renderAlipayPortfolioComparisonHtml } from '../services/portfolio-backtest/alipayPortfolioComparisonHtml.js'
import { alipayResearchWorkflowService } from '../services/review/alipayResearchWorkflowService.js'
import { runtimeHealthService } from '../services/runtime/runtimeHealthService.js'
import { ensureUser } from '../utils/user.js'

export async function portfolioBacktestRoutes(app: FastifyInstance) {
  app.post('/alipay-comparison/run', async (request) => {
    const body = (request.body || {}) as { userId?: string; idempotencyKey?: string }
    const userId = typeof body.userId === 'string' && body.userId.trim() ? body.userId.trim() : 'default'
    const result = await alipayResearchWorkflowService.runComparison({
      userId,
      createdBy: 'user',
      idempotencyKey: typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim() ? body.idempotencyKey.trim() : undefined,
    })
    return {
      schemaVersion: 'portfolio.alipay_comparison.run_submission.v1',
      operationId: result.operation.id,
      status: result.operation.status,
      reused: result.reused,
      summary: result.summary,
      reportUrl: `/api/v1/portfolio-backtest/alipay-comparison/runs/${encodeURIComponent(result.operation.id)}/report?userId=${encodeURIComponent(userId)}`,
      allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE'],
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      notTradingAdvice: true,
    }
  })

  app.get('/alipay-comparison/report', async (request, reply) => {
    const query = (request.query || {}) as { userId?: string; operationId?: string }
    const userId = typeof query.userId === 'string' && query.userId.trim() ? query.userId.trim() : 'default'
    const saved = query.operationId
      ? await alipayResearchWorkflowService.loadStudy(query.operationId, userId).catch(() => null)
      : await alipayResearchWorkflowService.getLatest(userId)
    if (!saved) return reply.status(404).type('text/html; charset=utf-8').send('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>尚无持久化回测</title><body><h1>尚无持久化回测</h1><p>请返回持仓组合对比页面，点击“运行完整分析”。</p></body></html>')
    return reply
      .header('Cache-Control', 'no-store')
      .type('text/html; charset=utf-8')
      .send(renderAlipayPortfolioComparisonHtml(saved.study, { operationId: saved.operation.id }))
  })

  app.get('/alipay-comparison/runs', async (request) => {
    const query = (request.query || {}) as { userId?: string; limit?: string }
    return alipayResearchWorkflowService.listRuns(
      typeof query.userId === 'string' && query.userId.trim() ? query.userId.trim() : 'default',
      Number.parseInt(String(query.limit || '20'), 10) || 20,
    )
  })

  app.get('/alipay-comparison/runs/:operationId', async (request, reply) => {
    const { operationId } = request.params as { operationId: string }
    const query = (request.query || {}) as { userId?: string }
    try {
      const saved = await alipayResearchWorkflowService.loadStudy(operationId, query.userId || 'default')
      return {
        schemaVersion: 'portfolio.alipay_comparison.saved_run_detail.v1',
        operationId: saved.operation.id,
        status: saved.operation.status,
        summary: saved.summary,
        study: saved.study,
        notTradingAdvice: true,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.status(message.includes('not_found') ? 404 : 409).send({ error: message, retryable: false })
    }
  })

  app.get('/alipay-comparison/runs/:operationId/report', async (request, reply) => {
    const { operationId } = request.params as { operationId: string }
    const query = (request.query || {}) as { userId?: string }
    try {
      const saved = await alipayResearchWorkflowService.loadStudy(operationId, query.userId || 'default')
      return reply.header('Cache-Control', 'no-store').type('text/html; charset=utf-8')
        .send(renderAlipayPortfolioComparisonHtml(saved.study, { operationId: saved.operation.id }))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return reply.status(message.includes('not_found') ? 404 : 409).send({ error: message, retryable: false })
    }
  })

  app.post('/alipay-comparison/runs/:operationId/window', async (request, reply) => {
    const { operationId } = request.params as { operationId: string }
    const body = (request.body || {}) as { userId?: string; startDate?: string; endDate?: string }
    if (!body.startDate || !body.endDate) return reply.status(400).send({ error: 'startDate_and_endDate_required', retryable: false })
    try {
      return await alipayResearchWorkflowService.runWindow({
        operationId,
        userId: body.userId || 'default',
        startDate: body.startDate,
        endDate: body.endDate,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = message.includes('not_found') ? 404 : message.startsWith('window_') ? 422 : 409
      return reply.status(status).send({ error: message, retryable: false })
    }
  })

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
        '13_execution_isolation_audit.json': {
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
        '14_release_gate_audit.json': {
          schemaVersion: 'portfolio.backtest.formal_trading_release_gate_audit.v1',
          generatedAt: generatedAt.toISOString(),
          releaseGateAudit: result.releaseGateAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '15_data_governance_audit.json': {
          schemaVersion: 'portfolio.backtest.release_data_governance_audit.v1',
          generatedAt: generatedAt.toISOString(),
          dataGovernanceAudit: result.dataGovernanceAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '16_benchmark_qualification_audit.json': {
          schemaVersion: 'portfolio.backtest.benchmark_qualification_audit.v1',
          generatedAt: generatedAt.toISOString(),
          benchmarkQualificationAudit: result.benchmarkQualificationAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '17_formal_validation_audit.json': {
          schemaVersion: 'portfolio.backtest.formal_validation_audit.v1',
          generatedAt: generatedAt.toISOString(),
          formalValidationAudit: result.formalValidationAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '18_manual_signoff_audit.json': {
          schemaVersion: 'portfolio.backtest.manual_signoff_audit.v1',
          generatedAt: generatedAt.toISOString(),
          manualSignoffAudit: result.manualSignoffAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '19_long_horizon_data_coverage_audit.json': {
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
        '20_multi_period_backtest_result.json': {
          schemaVersion: 'portfolio.backtest.multi_period_backtest_result.v1',
          generatedAt: generatedAt.toISOString(),
          multiPeriodBacktestResult: result.multiPeriodBacktestResult,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '21_dividend_total_return_audit.json': {
          schemaVersion: 'portfolio.backtest.dividend_total_return_audit.v1',
          generatedAt: generatedAt.toISOString(),
          dividendTotalReturnAudit: result.dividendTotalReturnAudit,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '22_classic_portfolio_three_year_study.json': {
          schemaVersion: 'portfolio.backtest.classic_portfolio_three_year_study.v1',
          generatedAt: generatedAt.toISOString(),
          classicPortfolioStudy: result.classicPortfolioStudy,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          orderCreateAllowed: false,
          canCreateOrder: false,
          notTradingAdvice: true,
        },
        '23_fixed_rule_primary_run.json': {
          schemaVersion: 'portfolio.backtest.fixed_rule_primary_run.v1',
          generatedAt: generatedAt.toISOString(),
          requestedPeriod: result.fixedRuleStudy?.requestedPeriod || null,
          actualPeriod: result.fixedRuleStudy?.actualPeriod || null,
          initialCapital: result.fixedRuleStudy?.initialCapital || input.request.initialCapital,
          ruleMode: result.fixedRuleStudy?.ruleMode || null,
          executionAssumptions: result.fixedRuleStudy?.executionAssumptions || null,
          methodology: result.fixedRuleStudy?.methodology || null,
          strategies: (result.fixedRuleStudy?.strategies || []).map((strategy) => ({
            strategyId: strategy.strategyId,
            displayName: strategy.displayName,
            strategyVersion: strategy.strategyVersion,
            components: strategy.components,
            appliedPolicy: strategy.appliedPolicy,
            primaryRun: strategy.primaryRun,
          })),
          notTradingAdvice: true,
        },
        '24_fixed_rule_trade_ledger.json': {
          schemaVersion: 'portfolio.backtest.fixed_rule_trade_ledger.v1',
          generatedAt: generatedAt.toISOString(),
          strategies: (result.fixedRuleStudy?.strategies || []).map((strategy) => ({
            strategyId: strategy.strategyId,
            displayName: strategy.displayName,
            appliedPolicy: strategy.appliedPolicy,
            trades: strategy.primaryRun.trades,
          })),
          notTradingAdvice: true,
        },
        '25_start_date_sensitivity.json': {
          schemaVersion: 'portfolio.backtest.start_date_sensitivity.v1',
          generatedAt: generatedAt.toISOString(),
          config: result.fixedRuleStudy?.sensitivityConfig || null,
          strategies: (result.fixedRuleStudy?.strategies || []).map((strategy) => ({
            strategyId: strategy.strategyId,
            displayName: strategy.displayName,
            appliedPolicy: strategy.appliedPolicy,
            sensitivity: strategy.sensitivity,
          })),
          aggregateSensitivity: result.fixedRuleStudy?.aggregateSensitivity || [],
          methodology: result.fixedRuleStudy?.methodology || null,
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

  app.post('/fixed-rule-detail', async (request, reply) => {
    const body = request.body as Record<string, unknown>
    const runtimeHealth = await runtimeHealthService.check({ prisma, lightweight: true })
    if (!runtimeHealth.sqliteHealthy) {
      return reply.status(503).send({
        schemaVersion: 'portfolio.fixed_rule_detail.blocked.v1',
        status: 'blocked',
        blockedReasons: ['sqlite_health_check_failed'],
        notTradingAdvice: true,
      })
    }
    const input = await portfolioBacktestInputBuilder.build({
      ...(body || {}),
      userId: typeof body?.userId === 'string' ? body.userId : 'default',
      ruleMode: 'registry_fixed',
      scenarioAnalysis: {
        ...((body?.scenarioAnalysis as Record<string, unknown>) || {}),
        enabled: false,
      },
      startDateSensitivity: {
        enabled: false,
        sampling: 'weekly_first_trading_day',
        minimumTradingDaysForAnnualization: 20,
      },
    } as any)
    const fixedRuleStudy = await portfolioFixedRuleStudyService.run(input)
    return {
      schemaVersion: 'portfolio.fixed_rule_detail.v1',
      generatedAt: new Date().toISOString(),
      fixedRuleStudy,
      allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      notTradingAdvice: true,
    }
  })

  app.get('/runs', async (request) => {
    const query = request.query as { userId?: string; limit?: string }
    const userId = String(query.userId || 'default')
    const limit = Math.min(100, Math.max(1, Number.parseInt(String(query.limit || '20'), 10) || 20))
    const operations = await prisma.operation.findMany({
      where: { userId, type: 'portfolio_backtest_run' },
      orderBy: { requestedAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        requestedAt: true,
        completedAt: true,
        inputJson: true,
        resultJson: true,
        artifactRefsJson: true,
      },
    })
    const parse = <T,>(value: string, fallback: T): T => {
      try { return JSON.parse(value) as T } catch { return fallback }
    }
    return {
      schemaVersion: 'portfolio.strategy_backtest.run_history.v1',
      generatedAt: new Date().toISOString(),
      userId,
      runs: operations.map((operation) => {
        const input = parse<Record<string, any>>(operation.inputJson, {})
        const result = parse<Record<string, any>>(operation.resultJson, {})
        const artifacts = result.artifacts || {}
        const fixed = artifacts['23_fixed_rule_primary_run.json'] || null
        return {
          operationId: operation.id,
          status: operation.status,
          requestedAt: operation.requestedAt,
          completedAt: operation.completedAt,
          strategyIds: input.portfolioStrategyIds || [],
          startDate: input.startDate || null,
          endDate: fixed?.actualPeriod?.endDate || input.endDate || null,
          initialCapital: input.initialCapital || null,
          ruleMode: input.ruleMode || 'request_override',
          fixedRuleAvailable: Boolean(fixed?.strategies?.length),
          artifactRefs: parse<string[]>(operation.artifactRefsJson, []),
        }
      }),
      notTradingAdvice: true,
    }
  })

  app.get('/runs/:operationId', async (request, reply) => {
    const { operationId } = request.params as { operationId: string }
    const query = request.query as { userId?: string }
    const operation = await prisma.operation.findFirst({
      where: {
        id: operationId,
        type: 'portfolio_backtest_run',
        ...(query.userId ? { userId: String(query.userId) } : {}),
      },
    })
    if (!operation) return reply.status(404).send({ error: 'portfolio_backtest_run_not_found' })
    let parsed: Record<string, any> = {}
    try { parsed = JSON.parse(operation.resultJson) } catch { parsed = {} }
    const result = parsed.artifacts?.['03_backtest_results.json']?.result || null
    return {
      schemaVersion: 'portfolio.strategy_backtest.saved_run.v1',
      operationId: operation.id,
      status: operation.status,
      requestedAt: operation.requestedAt,
      completedAt: operation.completedAt,
      result,
      artifactRefs: JSON.parse(operation.artifactRefsJson || '[]'),
      notTradingAdvice: true,
    }
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
