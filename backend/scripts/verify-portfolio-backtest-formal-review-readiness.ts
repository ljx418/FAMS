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
  assert.ok(Array.isArray(result.manualPlanDrafts), 'manual plan drafts should be present')
  assert.equal(result.manualPlanDrafts.length, result.strategies.length)
  assert.ok(result.formalTradingUnlockChecklist, 'formal trading unlock checklist should be present')
  assert.equal(result.formalTradingUnlockChecklist.formalTradingUnlocked, false)
  assert.equal(result.formalTradingUnlockChecklist.autoTradeUnlocked, false)
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
