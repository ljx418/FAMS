import { FastifyInstance } from 'fastify'
import { analysisService } from '../services/analysis/analysisService.js'
import { positionAdviceService } from '../services/position/positionAdviceService.js'
import { valueAssessmentService } from '../services/valuation/valueAssessmentService.js'
import { fivdRInterventionService } from '../services/analysis/fivdRInterventionService.js'
import { alertService } from '../services/alert/alertService.js'
import { dataGapRemediationService } from '../services/analysis/dataGapRemediationService.js'
import { operationService } from '../services/operation/operationService.js'

export async function analysisRoutes(app: FastifyInstance) {
  // FIVD-R 统一分析入口：P4 策略锦标赛作为内部验证机制，不再暴露为独立产品入口
  app.get('/fivd-r', async (request) => {
    const { userId, positionId, symbol, scope, forceRefresh } = request.query as any
    return analysisService.getFivdRAnalysis(userId || 'default', {
      positionId,
      symbol,
      scope: scope === 'portfolio' || scope === 'position' ? scope : undefined,
      forceRefresh: forceRefresh === 'true',
    })
  })

  app.get('/fivd-r/summary', async (request) => {
    const { userId, maxCacheAgeMs } = request.query as any
    return analysisService.getFivdRPortfolioSummary(userId || 'default', {
      maxCacheAgeMs: maxCacheAgeMs === undefined ? undefined : Number(maxCacheAgeMs),
    })
  })

  app.post('/fivd-r/refresh-operation', async (request) => {
    const body = request.body as any
    return analysisService.startFivdRPortfolioRefreshOperation(body.userId || 'default', {
      forceRefresh: body.forceRefresh === true,
    })
  })

  app.post('/fivd-r/candidates', async (request) => {
    const body = request.body as any
    return analysisService.scoreFivdRCandidates(body.userId || 'default', {
      source: body.source || 'manual_list',
      strategyQuery: body.strategyQuery,
      candidates: Array.isArray(body.candidates) ? body.candidates : [],
    })
  })

  app.post('/fivd-r/snapshots', async (request) => {
    const body = request.body as any
    return analysisService.createFivdRResearchSnapshot(body.userId || 'default', {
      result: body.result && typeof body.result === 'object' ? body.result : {},
      source: body.source,
      note: body.note,
    })
  })

  app.get('/fivd-r/snapshots', async (request) => {
    const { userId, limit } = request.query as any
    return analysisService.listFivdRResearchSnapshots(userId || 'default', Number(limit || 20))
  })

  app.post('/fivd-r/watch', async (request) => {
    const body = request.body as any
    return fivdRInterventionService.createReview({
      userId: body.userId || 'default',
      runId: body.runId,
      positionId: body.positionId || null,
      symbol: body.symbol || null,
      decision: 'manual_watch',
      reason: body.reason || '加入 FIVD-R 观察池，等待后续证据复核。',
      reviewer: body.reviewer || 'user',
      modelResultRef: body.modelResultRef || body.runId,
      evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs : [],
      override: {
        action: 'watchlist_add',
        source: body.source || 'analysis_page',
      },
    })
  })

  app.get('/fivd-r/watch', async (request) => {
    const { userId, runId, positionId, decision, limit } = request.query as any
    const normalizedDecision = decision === 'manual_watch'
      || decision === 'approve_research_only'
      || decision === 'request_more_evidence'
      || decision === 'reject_trade_action'
      ? decision
      : 'manual_watch'
    const reviews = await fivdRInterventionService.listReviews({
      userId: userId || 'default',
      runId,
      positionId,
      decision: normalizedDecision,
      limit: Number(limit || 20),
    })
    return {
      schemaVersion: 'fivd.r.watch_list.v1',
      userId: userId || 'default',
      decision: normalizedDecision,
      count: reviews.length,
      reviews,
      allowedActions: ['RESEARCH', 'OBSERVE', 'SNAPSHOT', 'WATCH', 'RISK_ALERT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
    }
  })

  app.post('/fivd-r/risk-alert', async (request) => {
    const body = request.body as any
    return alertService.createAlert({
      userId: body.userId || 'default',
      type: 'risk',
      title: body.title || `FIVD-R 风险复核 - ${body.symbol || '组合'}`,
      message: body.message || body.reason || 'FIVD-R 触发风险复核，请检查证据缺口、交易纪律和失效条件。',
      severity: body.severity === 'danger' ? 'danger' : body.severity === 'info' ? 'info' : 'warning',
      assetSymbol: body.symbol || undefined,
    })
  })

  app.post('/fivd-r/validation-retest', async (request) => {
    const body = request.body as any
    return analysisService.createFivdRValidationRetestAudit(body.userId || 'default', {
      operationId: body.operationId,
      candidateLimit: body.candidateLimit,
    })
  })

  app.get('/fivd-r/validation-report/latest', async (request) => {
    const { userId } = request.query as any
    return analysisService.getLatestFivdRValidationReport(userId || 'default')
  })

  app.post('/fivd-r/asset-identity-resolution', async (request) => {
    const body = request.body as any
    return analysisService.createFivdRAssetIdentityResolutionReport(body.userId || 'default', {
      symbols: Array.isArray(body.symbols) ? body.symbols : [],
      gaps: Array.isArray(body.gaps) ? body.gaps : [],
      sourceRunId: body.sourceRunId || null,
    })
  })

  app.post('/fivd-r/data-gap-remediation-plan', async (request) => {
    const body = request.body as any
    const userId = body.userId || 'default'
    const source = body.source || 'latest_summary'
    const gaps = Array.isArray(body.gaps)
      ? body.gaps
      : source === 'latest_summary'
      ? ((await analysisService.getFivdRPortfolioSummary(userId)) as any).dataGapSummary || []
      : []
    return dataGapRemediationService.buildPlan({
      userId,
      gaps,
      sourceRunId: body.sourceRunId || null,
    })
  })

  app.post('/fivd-r/data-gap-remediation-operation', async (request) => {
    const body = request.body as any
    const userId = body.userId || 'default'
    const source = body.source || 'latest_summary'
    const requestedActionIds = Array.isArray(body.actionIds) ? new Set(body.actionIds.map((item: unknown) => String(item))) : null
    const gaps = Array.isArray(body.gaps)
      ? body.gaps
      : source === 'latest_summary'
      ? ((await analysisService.getFivdRPortfolioSummary(userId)) as any).dataGapSummary || []
      : []
    const plan = dataGapRemediationService.buildPlan({
      userId,
      gaps,
      sourceRunId: body.sourceRunId || null,
    })
    const executableActions = plan.actions.filter((action) => (
      action.status === 'executable'
      && (!requestedActionIds || requestedActionIds.has(action.actionId))
    ))
    const startedOperations = []
    for (const action of executableActions) {
      if (action.operationType === 'batch_factset_refresh') {
        const input = action.operationInput || {}
        const operation = await operationService.startBatchFactsetRefreshOperation({
          userId,
          scope: input.scope === 'stock_factset' || input.scope === 'position_advice' || input.scope === 'all' ? input.scope : 'stock_factset',
          symbols: Array.isArray(input.symbols) ? input.symbols.map((symbol) => String(symbol)) : action.symbols,
          limit: typeof input.limit === 'number' ? input.limit : action.symbols.length || undefined,
          createdBy: 'fivd_r_data_gap_remediation',
          idempotencyKey: `fivd_r_gap_remediation:${userId}:${action.actionId}:${action.symbols.join(',')}`,
        })
        startedOperations.push({
          actionId: action.actionId,
          operationId: operation.id,
          operationType: action.operationType,
          status: operation.status,
        })
      }
      if (action.operationType === 'fivd_r_validation_retest_audit') {
        const audit = await analysisService.createFivdRValidationRetestAudit(userId, {
          candidateLimit: 20,
        }) as any
        startedOperations.push({
          actionId: action.actionId,
          operationId: audit.operationId,
          operationType: action.operationType,
          status: audit.status,
        })
      }
      if (action.operationType === 'fivd_r_asset_identity_resolution') {
        const report = await analysisService.createFivdRAssetIdentityResolutionReport(userId, {
          symbols: action.symbols,
          gaps,
          sourceRunId: body.sourceRunId || null,
        }) as any
        startedOperations.push({
          actionId: action.actionId,
          operationId: report.operationId,
          operationType: action.operationType,
          status: report.summary?.unresolvedCount > 0 ? 'partial' : 'completed',
        })
      }
      if (action.operationType === 'market_bar_cache_preheat') {
        const input = action.operationInput || {}
        const operation = await operationService.startMarketBarCachePreheatOperation({
          userId,
          symbols: Array.isArray(input.symbols) ? input.symbols.map((symbol) => String(symbol)) : action.symbols,
          limit: typeof input.limit === 'number' ? input.limit : action.symbols.length || undefined,
          days: typeof input.days === 'number' ? input.days : 120,
          chunkSize: typeof input.chunkSize === 'number' ? input.chunkSize : Math.min(20, Math.max(1, action.symbols.length)),
          concurrency: typeof input.concurrency === 'number' ? input.concurrency : 2,
          forceRefresh: input.forceRefresh === true,
          executionMode: 'queued',
          createdBy: 'fivd_r_data_gap_remediation',
          idempotencyKey: `fivd_r_gap_remediation:${userId}:${action.actionId}:${action.symbols.join(',')}`,
        })
        startedOperations.push({
          actionId: action.actionId,
          operationId: operation.id,
          operationType: action.operationType,
          status: operation.status,
        })
      }
    }
    return {
      schemaVersion: 'fivd.r.data_gap_remediation_execution.v1',
      generatedAt: new Date().toISOString(),
      userId,
      plan,
      startedOperations,
      skippedActions: plan.actions.filter((action) => !executableActions.includes(action)).map((action) => ({
        actionId: action.actionId,
        status: action.status,
        reason: action.status === 'executable' ? 'not_requested' : action.userMessage,
      })),
      auditOpinion: {
        severity: plan.summary.unsupportedActions > 0 || plan.summary.plannedActions > 0 ? 'major' : 'minor',
        conclusion: '仅启动当前已有执行器支持的补数/复验动作；unsupported/planned 动作不会被伪造成完成。',
      },
    }
  })

  app.post('/fivd-r/infrastructure-audit', async (request) => {
    const body = request.body as any
    return analysisService.createFivdRInfrastructureAudit(body.userId || 'default')
  })

  app.post('/fivd-r/manual-trade-draft', async (request) => {
    const body = request.body as any
    return analysisService.createFivdRManualTradeDraft(body.userId || 'default', {
      result: body.result && typeof body.result === 'object' ? body.result : {},
      requestedActions: Array.isArray(body.requestedActions) ? body.requestedActions : [],
    })
  })

  app.post('/fivd-r/interventions', async (request) => {
    const body = request.body as any
    return fivdRInterventionService.createReview({
      userId: body.userId || 'default',
      runId: body.runId,
      positionId: body.positionId || null,
      symbol: body.symbol || null,
      decision: body.decision,
      reason: body.reason,
      reviewer: body.reviewer,
      modelResultRef: body.modelResultRef,
      evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs : [],
      override: body.override && typeof body.override === 'object' ? body.override : {},
    })
  })

  app.get('/fivd-r/interventions', async (request) => {
    const { userId, runId, positionId } = request.query as any
    return fivdRInterventionService.listReviews({
      userId: userId || 'default',
      runId,
      positionId,
    })
  })

  app.get('/fivd-r/interventions/audit', async (request) => {
    const { userId, runId } = request.query as any
    if (!runId) throw new Error('runId is required')
    return fivdRInterventionService.verifyChain({
      userId: userId || 'default',
      runId,
    })
  })

  // 获取建议
  app.get('/suggestions', async (request) => {
    const { userId, period } = request.query as any
    return analysisService.getSuggestions(userId || 'default', period || 'daily')
  })

  // 生成投资建议（网格挂单、定投计划、止损提醒）
  app.get('/investment-suggestions', async (request) => {
    const { userId, query, scope } = request.query as any
    return analysisService.generateInvestmentSuggestions(userId || 'default', {
      query,
      scope: scope || 'all',
    })
  })

  // 查询某个标的或板块的分析建议
  app.get('/investment-suggestions/search', async (request) => {
    const { userId, query, scope } = request.query as any
    return analysisService.generateInvestmentSuggestions(userId || 'default', {
      query,
      scope: scope || 'all',
    })
  })

  // 研究用户输入的新标的或新板块，给出是否候选买入
  app.get('/target-research', async (request) => {
    const { userId, input, scope } = request.query as any
    return analysisService.analyzeTarget(userId || 'default', input || '', scope || 'all')
  })

  app.post('/target-research', async (request) => {
    const { userId, input, scope } = request.body as any
    return analysisService.analyzeTarget(userId || 'default', input || '', scope || 'all')
  })

  app.post('/stock-screener', async (request) => {
    const { userId, query } = request.body as any
    return analysisService.screenStocks(userId || 'default', query || '')
  })

  app.get('/holdings-research', async (request) => {
    const { userId } = request.query as any
    return analysisService.getHoldingsResearch(userId || 'default')
  })

  app.get('/position-advice', async (request) => {
    const { userId, deep, forceRefresh } = request.query as any
    return positionAdviceService.getPortfolioAdvice(userId || 'default', {
      includeExternalAnalysis: deep === 'true',
      forceRefresh: forceRefresh === 'true',
    })
  })

  app.get('/position-advice/:positionId', async (request) => {
    const { positionId } = request.params as any
    const { deep, forceRefresh } = request.query as any
    return positionAdviceService.getPositionAdvice(positionId, {
      includeExternalAnalysis: deep !== 'false',
      forceRefresh: forceRefresh === 'true',
    })
  })

  app.get('/value-assessments', async (request) => {
    const { userId } = request.query as any
    return valueAssessmentService.getPortfolioValueAssessments(userId || 'default')
  })

  app.get('/value-assessments/:positionId', async (request) => {
    const { positionId } = request.params as any
    return valueAssessmentService.getPositionValueAssessment(positionId)
  })

  app.get('/advice/:id', async (request) => {
    const { id } = request.params as any
    const { userId } = request.query as any
    return analysisService.getAdviceDetail(userId || 'default', id)
  })

  // 生成交易计划
  app.post('/trading-plan', async (request) => {
    const { userId, symbols } = request.body as any
    return analysisService.generateTradingPlan(userId || 'default', symbols || [])
  })

  // 确认执行建议动作：只记录交易，不自动下单
  app.post('/advice-actions/:id/execute', async (request) => {
    const { id } = request.params as any
    const { userId, overrides } = request.body as any
    return analysisService.executeAdviceAction(userId || 'default', id, overrides || {})
  })

  // 获取每日快照
  app.get('/daily-snapshot', async (request) => {
    const { userId, date } = request.query as any
    return analysisService.getDailySnapshot(userId || 'default', date)
  })

  // 获取风险分析
  app.get('/risk', async () => {
    // 简化实现
    return { riskScore: 65, volatility: 15.2, sharpeRatio: 1.45 }
  })

  // 获取组合分析
  app.get('/portfolio', async () => {
    // 简化实现
    return { totalValue: 1000000, allocation: [] }
  })
}
