import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { operationRoutes } from '../src/routes/operation.js'
import { portfolioBacktestRoutes } from '../src/routes/portfolioBacktest.js'

async function main() {
  const app = Fastify({ logger: false })
  await app.register(portfolioBacktestRoutes, { prefix: '/api/v1/portfolio-backtest' })
  await app.register(operationRoutes, { prefix: '/api/v1/operations' })

  const templatesResponse = await app.inject({
    method: 'GET',
    url: '/api/v1/portfolio-backtest/templates',
  })
  assert.equal(templatesResponse.statusCode, 200)
  const templates = templatesResponse.json()
  assert.equal(templates.notTradingAdvice, true)
  assert.ok(Array.isArray(templates.templates))
  assert.ok(templates.templates.some((item: any) => item.strategyId === 'permanent_portfolio'))
  assert.deepEqual(templates.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])

  const runResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/portfolio-backtest/run',
    payload: {
      userId: 'default',
      portfolioStrategyIds: [
        'local_real_data_sample_60_40',
        'local_real_data_equal_weight_5',
        'local_real_data_concentrated_3',
        'dividend_low_vol_basket',
        'permanent_portfolio',
        'all_weather',
        'current_holdings_buy_and_hold',
      ],
      startDate: '2025-12-04',
      endDate: '2026-06-05',
      initialCapital: 100000,
      rebalanceFrequency: 'quarterly',
      dividendMode: 'reinvest',
      feeRate: 0.0003,
      slippageRate: 0.0005,
      benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20'],
    },
  })
  assert.equal(runResponse.statusCode, 200)
  const result = runResponse.json()
  assert.equal(result.schemaVersion, 'portfolio.strategy_backtest.result.v1')
  assert.equal(result.notTradingAdvice, true)
  assert.deepEqual(result.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.ok(Array.isArray(result.strategies))
  assert.ok(result.strategies.length >= 6)
  assert.ok(result.strategies.some((item: any) => item.definition?.strategyId === 'current_holdings_buy_and_hold'))
  assert.ok(result.dataGradeAudit, 'result should include aggregate data grade audit')
  assert.ok(result.modelEffectiveness, 'result should include aggregate model effectiveness')
  assert.ok(Array.isArray(result.manualPlanDrafts), 'result should include manual plan drafts')
  assert.ok(result.formalTradingUnlockChecklist, 'result should include formal trading unlock checklist')
  assert.ok(result.runId, 'result should include auditable runId')
  assert.ok(result.readinessSummary, 'result should include unified readiness summary')
  assert.ok(result.executionIsolationAudit, 'result should include execution isolation audit')
  assert.ok(Array.isArray(result.paperOrderIntents), 'result should include paper order intents')
  assert.ok(result.releaseGateAudit, 'result should include release gate audit')
  assert.ok(result.dataGovernanceAudit, 'result should include release data governance audit')
  assert.ok(result.benchmarkQualificationAudit, 'result should include benchmark qualification audit')
  assert.ok(result.formalValidationAudit, 'result should include formal validation audit')
  assert.ok(result.manualSignoffAudit, 'result should include manual signoff audit')
  assert.ok(result.longHorizonDataCoverageAudit, 'result should include long horizon data coverage audit')
  assert.ok(result.multiPeriodBacktestResult, 'result should include multi-period backtest result audit')
  assert.ok(result.dividendTotalReturnAudit, 'result should include dividend total return audit')
  assert.equal(result.readinessSummary.researchReady, true)
  assert.equal(result.readinessSummary.formalTradingUnlocked, false)
  assert.equal(result.readinessSummary.autoTradeUnlocked, false)
  assert.equal(result.readinessSummary.formalReviewReady, result.formalReviewReadiness?.ready === true)
  assert.equal(result.formalTradingUnlockChecklist.formalTradingUnlocked, false)
  assert.equal(result.formalTradingUnlockChecklist.autoTradeUnlocked, false)
  assert.equal(result.executionIsolationAudit.productionAdapterEnabled, false)
  assert.equal(result.executionIsolationAudit.realPositionMutationAllowed, false)
  assert.equal(result.executionIsolationAudit.orderCreateAllowed, false)
  assert.equal(result.executionIsolationAudit.canCreateOrder, false)
  assert.equal(result.executionIsolationAudit.formalTradingUnlocked, false)
  assert.equal(result.executionIsolationAudit.autoTradeUnlocked, false)
  assert.equal(result.releaseGateAudit.status, 'blocked')
  assert.equal(result.releaseGateAudit.orderCreateAllowed, false)
  assert.equal(result.releaseGateAudit.canCreateOrder, false)
  assert.equal(result.releaseGateAudit.formalTradingUnlocked, false)
  assert.equal(result.releaseGateAudit.autoTradeUnlocked, false)
  assert.equal(result.dataGovernanceAudit.formalTradingEligible, false)
  assert.equal(result.benchmarkQualificationAudit.canSupportFormalTrading, false)
  assert.equal(result.formalValidationAudit.formalTradingEligible, false)
  assert.equal(result.manualSignoffAudit.allRequiredSignedOff, false)
  assert.equal(result.manualSignoffAudit.canCreateOrder, false)
  assert.equal(
    result.longHorizonDataCoverageAudit.longHorizonRealDataBacktestReady,
    result.longHorizonDataCoverageAudit.blockers.length === 0,
    'long-horizon readiness should reflect actual real-data blockers instead of being hard-coded blocked',
  )
  assert.equal(result.longHorizonDataCoverageAudit.notTradingAdvice, true)
  assert.ok(result.longHorizonDataCoverageAudit.periods.some((period: any) => period.periodId === '1y'))
  assert.ok(result.longHorizonDataCoverageAudit.periods.some((period: any) => period.periodId === '3y'))
  assert.ok(result.longHorizonDataCoverageAudit.periods.some((period: any) => period.periodId === '5y'))
  assert.ok(result.longHorizonDataCoverageAudit.periods.some((period: any) => period.periodId === 'custom'))
  assert.equal(result.multiPeriodBacktestResult.notTradingAdvice, true)
  assert.ok(result.multiPeriodBacktestResult.periods.length >= 4)
  assert.ok(
    !result.multiPeriodBacktestResult.blockers.includes('period_replay_not_materialized_in_current_request'),
    'multi-period result must be produced by real period replay, not a placeholder blocker',
  )
  for (const period of result.multiPeriodBacktestResult.periods) {
    assert.ok(period.requestedStartDate, `period ${period.periodId} should expose requestedStartDate`)
    assert.ok(period.requestedEndDate, `period ${period.periodId} should expose requestedEndDate`)
    assert.ok(typeof period.availableTradingDays === 'number', `period ${period.periodId} should expose availableTradingDays`)
    assert.ok(typeof period.coveragePercent === 'number', `period ${period.periodId} should expose coveragePercent`)
    assert.ok(Array.isArray(period.strategySummaries), `period ${period.periodId} should expose strategySummaries`)
    assert.ok(period.strategySummaries.length === period.strategyCount, `period ${period.periodId} strategy summaries should match strategy count`)
  }
  assert.equal(result.dividendTotalReturnAudit.notTradingAdvice, true)
  assert.ok(typeof result.dividendTotalReturnAudit.coveragePercent === 'number')
  assert.ok(result.releaseGateAudit.checks.some((check: any) => check.id === 'field_level_data_governance'))
  assert.ok(result.releaseGateAudit.checks.some((check: any) => check.id === 'long_horizon_real_data_backtest'))
  assert.ok(result.releaseGateAudit.checks.some((check: any) => check.id === 'formal_validation'))
  assert.ok(result.releaseGateAudit.checks.some((check: any) => check.id === 'manual_human_signoff'))
  assert.ok(result.paperOrderIntents.length >= result.strategies.length)
  for (const intent of result.paperOrderIntents) {
    assert.equal(intent.schemaVersion, 'portfolio.paper_order_intent.v1')
    assert.equal(intent.formalTargetWeightPercent, 0)
    assert.equal(intent.canCreateOrder, false)
    assert.equal(intent.orderCreateAllowed, false)
    assert.equal(intent.formalTradingUnlocked, false)
    assert.equal(intent.autoTradeUnlocked, false)
    assert.equal(intent.notTradingAdvice, true)
  }
  const localCompleted = result.strategies.filter((item: any) => item.definition?.strategyId?.startsWith('local_real_data_') && item.status === 'completed')
  assert.ok(localCompleted.length >= 3, 'expected at least three completed local real-data strategies')
  const localSample = result.strategies.find((item: any) => item.definition?.strategyId === 'local_real_data_sample_60_40')
  assert.ok(localSample, 'local real-data sample strategy should be returned')
  assert.equal(localSample.status, 'completed')
  assert.ok((localSample.equityCurve?.length || 0) >= 30)
  assert.ok(localSample.metrics?.benchmarkReturnPercent !== null, 'local benchmark return should be available')
  assert.ok(localSample.metrics?.excessReturnPercent !== null, 'local benchmark excess return should be available')
  const permanent = result.strategies.find((item: any) => item.definition?.strategyId === 'permanent_portfolio')
  assert.ok(permanent, 'permanent portfolio strategy should be returned')
  assert.equal(permanent.status, 'completed', 'permanent portfolio should complete once ETF proxy bars are ready')
  assert.ok((permanent.equityCurve?.length || 0) >= 30, 'permanent portfolio curve should use real proxy bars')
  assert.ok(permanent.warnings?.some((warning: string) => warning === 'benchmark_status:csi300_price_index:price_index' || warning === 'csi300_price_index_is_price_index_not_total_return_benchmark'), 'CSI300 price index benchmark status should be visible')
  const allWeather = result.strategies.find((item: any) => item.definition?.strategyId === 'all_weather')
  assert.ok(allWeather, 'all weather strategy should be returned')
  assert.equal(allWeather.status, 'completed', 'all weather should complete once ETF proxy bars are ready')
  const dividendLowVolBasket = result.strategies.find((item: any) => item.definition?.strategyId === 'dividend_low_vol_basket')
  assert.ok(dividendLowVolBasket, 'dividend low vol basket strategy should be returned')
  assert.equal(dividendLowVolBasket.definition?.source, 'dividend_low_vol')
  assert.equal(dividendLowVolBasket.definition?.snapshot?.weightPolicy, 'equal_weight')
  assert.ok(Array.isArray(dividendLowVolBasket.definition?.snapshot?.selectionRules), 'dividend basket must expose selection rules')
  assert.ok(
    dividendLowVolBasket.status === 'completed'
      || dividendLowVolBasket.blockedReasons?.some((reason: string) => reason.startsWith('dividend_low_vol_candidate_snapshot')),
    'dividend basket must complete from real snapshot or expose snapshot blocked reason',
  )
  if (dividendLowVolBasket.status === 'completed') {
    assert.ok((dividendLowVolBasket.definition?.components?.length || 0) >= 3, 'completed dividend basket should contain real snapshot components')
    assert.ok((dividendLowVolBasket.evidenceRefs || []).some((ref: string) => ref.includes('dividend_low_vol_daily')), 'completed dividend basket should expose dividend snapshot evidence')
  }
  for (const strategy of result.strategies) {
    if ((strategy.equityCurve?.length || 0) === 0) continue
    assert.ok(strategy.modelEffectiveness?.oos, `model effectiveness should expose OOS details for ${strategy.definition?.strategyId}`)
    assert.ok(strategy.modelEffectiveness?.walkForward, `model effectiveness should expose walk-forward details for ${strategy.definition?.strategyId}`)
    assert.ok(strategy.modelEffectiveness?.parameterSensitivity, `model effectiveness should expose parameter sensitivity details for ${strategy.definition?.strategyId}`)
    assert.ok(strategy.modelEffectiveness?.groupStability, `model effectiveness should expose group stability details for ${strategy.definition?.strategyId}`)
    assert.ok(
      strategy.metrics?.dividendContributionPercent !== null
        || strategy.warnings?.includes('dividend_contribution_insufficient:no_audited_component_yield'),
      `dividend contribution must be computed or explicitly marked insufficient for ${strategy.definition?.strategyId}`,
    )
  }

  const operationResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/portfolio-backtest/run',
    payload: {
      userId: 'default',
      portfolioStrategyIds: ['permanent_portfolio', 'all_weather', 'local_real_data_sample_60_40'],
      startDate: '2025-12-04',
      endDate: '2026-06-05',
      initialCapital: 100000,
      rebalanceFrequency: 'quarterly',
      dividendMode: 'reinvest',
      feeRate: 0.0003,
      slippageRate: 0.0005,
      benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20'],
      executionMode: 'operation',
    },
  })
  assert.equal(operationResponse.statusCode, 200)
  const operationSubmission = operationResponse.json()
  assert.equal(operationSubmission.schemaVersion, 'portfolio.strategy_backtest.operation_submission.v1')
  assert.equal(operationSubmission.status, 'completed')
  assert.ok(operationSubmission.operationId)
  assert.ok(operationSubmission.result?.readinessSummary, 'operation result should expose readiness summary')
  assert.ok(Array.isArray(operationSubmission.artifactRefs))
  assert.ok(operationSubmission.artifactRefs.length >= 13)
  assert.deepEqual(operationSubmission.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  const artifactRef = operationSubmission.artifactRefs.find((ref: string) => ref.includes('06_trade_gate_contract.json'))
  assert.ok(artifactRef, 'operation should expose trade gate artifact')
  for (const requiredArtifact of [
    '08_data_grade_audit.json',
    '09_model_effectiveness_audit.json',
    '10_manual_plan_draft_audit.json',
    '11_formal_trading_unlock_checklist.json',
    '12_execution_isolation_audit.json',
    '13_formal_trading_release_gate_audit.json',
    '14_release_data_governance_audit.json',
    '15_benchmark_qualification_audit.json',
    '16_formal_validation_audit.json',
    '17_manual_signoff_audit.json',
  ]) {
    assert.ok(operationSubmission.artifactRefs.some((ref: string) => ref.includes(requiredArtifact)), `operation should expose ${requiredArtifact}`)
  }
  const artifactResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/operations/artifacts/${encodeURIComponent(artifactRef)}`,
  })
  assert.equal(artifactResponse.statusCode, 200)
  const artifact = artifactResponse.json()
  assert.equal(artifact.data?.schemaVersion, 'portfolio.backtest.trade_gate_contract.v1')
  assert.equal(artifact.data?.formalTradingUnlocked, false)
  assert.equal(artifact.data?.autoTradeUnlocked, false)
  assert.equal(artifact.data?.readinessSummary?.formalTradingUnlocked, false)

  const initialReviewResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/portfolio-backtest/reviews/${encodeURIComponent(result.runId)}`,
  })
  assert.equal(initialReviewResponse.statusCode, 200)
  const initialReview = initialReviewResponse.json()
  assert.equal(initialReview.status, 'not_reviewed')
  assert.equal(initialReview.canCreateOrder, false)

  const saveReviewResponse = await app.inject({
    method: 'POST',
    url: `/api/v1/portfolio-backtest/reviews/${encodeURIComponent(result.runId)}`,
    payload: {
      reviewerId: 'api_contract_reviewer',
      role: 'final_release',
      decision: 'approve_for_manual_review',
      notes: 'contract test review record',
      blockedReasons: result.readinessSummary.blockers,
    },
  })
  assert.equal(saveReviewResponse.statusCode, 200)
  const savedReview = saveReviewResponse.json()
  assert.equal(savedReview.status, 'saved')
  assert.equal(savedReview.review?.role, 'final_release')
  assert.equal(savedReview.formalTradingUnlocked, false)
  assert.equal(savedReview.autoTradeUnlocked, false)
  assert.equal(savedReview.canCreateOrder, false)
  assert.deepEqual(savedReview.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])

  await app.close()
  console.log(JSON.stringify({
    ok: true,
    templates: templates.templates.length,
    strategyStatuses: result.strategies.map((item: any) => ({
      strategyId: item.definition?.strategyId,
      status: item.status,
      curvePoints: item.equityCurve?.length || 0,
      blockedReasons: item.blockedReasons || [],
      warnings: item.warnings || [],
    })),
    prohibitedActions: result.prohibitedActions,
    notTradingAdvice: result.notTradingAdvice,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
