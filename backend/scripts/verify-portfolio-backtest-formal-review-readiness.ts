import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { portfolioBacktestRoutes } from '../src/routes/portfolioBacktest.js'

const AUDIT_USER_ID = process.env.FAMS_PORTFOLIO_BACKTEST_AUDIT_USER_ID || 'audit_portfolio_backtest_user'

async function main() {
  const app = Fastify({ logger: false })
  await app.register(portfolioBacktestRoutes, { prefix: '/api/v1/portfolio-backtest' })
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/portfolio-backtest/run',
    payload: {
      userId: AUDIT_USER_ID,
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
      benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20', 'free_source_total_return'],
      gradeMode: 'formal_review',
      executionMode: 'sync',
    },
  })
  assert.equal(response.statusCode, 200)
  const result = response.json()
  const statuses = result.strategies.map((item: any) => ({ id: item.definition?.strategyId, status: item.status, blockers: item.blockedReasons }))
  assert.equal(result.strategies.length, 7)
  assert.equal(result.strategies.filter((item: any) => item.status === 'completed').length, 7, `expected 7/7 completed strategies: ${JSON.stringify(statuses)}`)
  assert.equal(result.formalReviewReadiness?.ready, true, `formal review readiness blocked: ${JSON.stringify(result.formalReviewReadiness)}`)
  assert.equal(result.formalReviewReadiness?.status, 'passed')
  assert.equal(result.formalReviewReadiness?.benchmarkStatuses?.free_source_total_return, 'free_source_total_return')
  assert.equal(result.formalReviewReadiness?.tradeConstraintCoverage?.status, 'passed')
  assert.equal(result.formalReviewReadiness?.dividendReturnCoverage?.status, 'passed')
  assert.ok(result.dataGradeAudit, 'data grade audit should be present')
  assert.ok(result.dataGradeAudit?.items?.length >= 4, 'data grade audit should cover price/benchmark/dividend/tradeability')
  assert.ok(result.modelEffectiveness, 'model effectiveness aggregate should be present')
  assert.ok(result.readinessSummary, 'unified readiness summary should be present')
  assert.equal(result.readinessSummary.researchReady, true)
  assert.equal(result.readinessSummary.formalReviewReady, true)
  assert.equal(result.readinessSummary.manualDraftReady, true)
  assert.equal(result.readinessSummary.formalTradingUnlocked, false)
  assert.equal(result.readinessSummary.autoTradeUnlocked, false)
  assert.ok(Array.isArray(result.manualPlanDrafts), 'manual plan drafts should be present')
  assert.equal(result.manualPlanDrafts.length, result.strategies.length)
  assert.ok(result.formalTradingUnlockChecklist, 'formal trading unlock checklist should be present')
  assert.equal(result.formalTradingUnlockChecklist.formalTradingUnlocked, false)
  assert.equal(result.formalTradingUnlockChecklist.autoTradeUnlocked, false)
  assert.ok(result.executionIsolationAudit, 'execution isolation audit should be present')
  assert.equal(result.executionIsolationAudit.status, 'ready_for_paper_review')
  assert.equal(result.executionIsolationAudit.paperTradingReady, true)
  assert.equal(result.executionIsolationAudit.sandboxReady, true)
  assert.equal(result.executionIsolationAudit.productionAdapterEnabled, false)
  assert.equal(result.executionIsolationAudit.realPositionMutationAllowed, false)
  assert.equal(result.executionIsolationAudit.orderCreateAllowed, false)
  assert.equal(result.executionIsolationAudit.canCreateOrder, false)
  assert.ok(Array.isArray(result.paperOrderIntents), 'paper order intents should be present')
  assert.equal(result.paperOrderIntents.length, result.manualPlanDrafts.length)
  assert.ok(result.releaseGateAudit, 'formal trading release gate audit should be present')
  assert.equal(result.releaseGateAudit.status, 'blocked')
  assert.equal(result.releaseGateAudit.formalTradingUnlocked, false)
  assert.equal(result.releaseGateAudit.autoTradeUnlocked, false)
  assert.equal(result.releaseGateAudit.orderCreateAllowed, false)
  assert.equal(result.releaseGateAudit.canCreateOrder, false)
  assert.ok(result.dataGovernanceAudit, 'release data governance audit should be present')
  assert.ok(result.dataGovernanceAudit.items?.length >= 4, 'release data governance audit should cover release fields')
  for (const item of result.dataGovernanceAudit.items) {
    assert.ok(item.sourceProvider, `data governance item ${item.fieldId} should expose sourceProvider`)
    assert.ok(item.sourceEndpoint, `data governance item ${item.fieldId} should expose sourceEndpoint`)
    assert.ok(item.asOfDate, `data governance item ${item.fieldId} should expose asOfDate`)
    assert.ok(item.fetchedAt, `data governance item ${item.fieldId} should expose fetchedAt`)
    assert.ok(item.freshnessStatus, `data governance item ${item.fieldId} should expose freshnessStatus`)
    assert.equal(typeof item.coveragePercent, 'number', `data governance item ${item.fieldId} should expose coveragePercent`)
    assert.ok(Array.isArray(item.evidenceRefs), `data governance item ${item.fieldId} should expose evidenceRefs`)
  }
  assert.ok(result.benchmarkQualificationAudit, 'benchmark qualification audit should be present')
  assert.ok(result.formalValidationAudit, 'formal validation audit should be present')
  assert.ok(result.manualSignoffAudit, 'manual signoff audit should be present')
  assert.ok(result.longHorizonDataCoverageAudit, 'long horizon data coverage audit should be present')
  assert.ok(result.multiPeriodBacktestResult, 'multi-period backtest result should be present')
  assert.ok(result.dividendTotalReturnAudit, 'dividend total return audit should be present')
  assert.equal(result.benchmarkQualificationAudit.canSupportFormalReview, true)
  assert.equal(result.benchmarkQualificationAudit.canSupportFormalTrading, false)
  assert.equal(result.manualSignoffAudit.allRequiredSignedOff, false)
  assert.equal(result.manualSignoffAudit.canCreateOrder, false)
  assert.equal(
    result.longHorizonDataCoverageAudit.longHorizonRealDataBacktestReady,
    result.longHorizonDataCoverageAudit.blockers.length === 0,
    'long horizon readiness should be derived from actual 1y/3y/5y evidence blockers',
  )
  assert.equal(result.multiPeriodBacktestResult.notTradingAdvice, true)
  assert.ok(
    !result.multiPeriodBacktestResult.blockers.includes('period_replay_not_materialized_in_current_request'),
    'multi-period result must materially replay the requested periods',
  )
  assert.ok(result.multiPeriodBacktestResult.periods.every((period: any) => period.requestedStartDate && period.requestedEndDate))
  assert.equal(result.dividendTotalReturnAudit.notTradingAdvice, true)
  assert.ok(result.releaseGateAudit.checks.some((check: any) => check.id === 'field_level_data_governance'))
  assert.ok(result.releaseGateAudit.checks.some((check: any) => check.id === 'long_horizon_real_data_backtest'))
  assert.ok(result.releaseGateAudit.checks.some((check: any) => check.id === 'formal_validation'))
  assert.ok(result.releaseGateAudit.checks.some((check: any) => check.id === 'manual_human_signoff'))
  assert.ok(
    result.releaseGateAudit.blockers.includes('human_reviewer_confirmation_not_completed')
      || result.releaseGateAudit.blockers.includes('production_order_adapter_not_enabled'),
    'release gate should keep human review or production adapter blockers',
  )
  assert.deepEqual(result.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.equal(result.notTradingAdvice, true)
  await app.close()
  console.log(JSON.stringify({
    ok: true,
    userId: AUDIT_USER_ID,
    completedStrategies: `${result.strategies.filter((item: any) => item.status === 'completed').length}/${result.strategies.length}`,
    formalReviewReadiness: result.formalReviewReadiness,
    prohibitedActions: result.prohibitedActions,
    notTradingAdvice: result.notTradingAdvice,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
