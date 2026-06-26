import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { portfolioBacktestRoutes } from '../src/routes/portfolioBacktest.js'

async function main() {
  const app = Fastify({ logger: false })
  await app.register(portfolioBacktestRoutes, { prefix: '/api/v1/portfolio-backtest' })

  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/portfolio-backtest/run',
    payload: {
      userId: 'audit_portfolio_backtest_user',
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
  assert.equal(result.notTradingAdvice, true)
  assert.deepEqual(result.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.equal(result.readinessSummary?.formalTradingUnlocked, false)
  assert.equal(result.readinessSummary?.autoTradeUnlocked, false)
  assert.equal(result.releaseGateAudit?.orderCreateAllowed, false)
  assert.equal(result.releaseGateAudit?.canCreateOrder, false)

  const longHorizon = result.longHorizonDataCoverageAudit
  const multiPeriod = result.multiPeriodBacktestResult
  assert.ok(longHorizon, 'long horizon audit should be present')
  assert.ok(multiPeriod, 'multi-period result should be present')
  assert.equal(longHorizon.notTradingAdvice, true)
  assert.equal(multiPeriod.notTradingAdvice, true)

  const periodIds = new Set(multiPeriod.periods.map((period: any) => period.periodId))
  for (const expected of ['1y', '3y', '5y', 'custom']) {
    assert.ok(periodIds.has(expected), `missing period replay for ${expected}`)
  }
  assert.ok(
    !multiPeriod.blockers.includes('period_replay_not_materialized_in_current_request'),
    'period replay placeholder blocker must not remain after materialized multi-period implementation',
  )

  const materializedPeriods = multiPeriod.periods.filter((period: any) => period.periodId !== 'custom')
  assert.ok(materializedPeriods.length >= 3, '1y/3y/5y materialized periods should be present')
  for (const period of materializedPeriods) {
    assert.ok(period.requestedStartDate < period.requestedEndDate, `${period.periodId} should expose a valid date range`)
    assert.ok(typeof period.availableTradingDays === 'number', `${period.periodId} should expose available trading days`)
    assert.ok(typeof period.coveragePercent === 'number', `${period.periodId} should expose coverage percent`)
    assert.ok(Array.isArray(period.strategySummaries), `${period.periodId} should expose strategy summaries`)
    assert.equal(period.strategySummaries.length, period.strategyCount, `${period.periodId} should summarize every strategy`)
  }
  assert.ok(
    materializedPeriods.some((period: any) => period.strategySummaries.some((strategy: any) => strategy.equityCurvePoints > 0)),
    'at least one long-horizon period should replay against available real price data',
  )

  const oneYear = multiPeriod.periods.find((period: any) => period.periodId === '1y')
  assert.ok(oneYear, '1y replay should be present')
  assert.ok(oneYear.strategySummaries.some((strategy: any) => strategy.status === 'completed' && strategy.equityCurvePoints > 0), '1y replay should include completed real-data strategy curves')

  assert.equal(
    longHorizon.longHorizonRealDataBacktestReady,
    longHorizon.blockers.length === 0,
    'long horizon readiness should be derived from blockers',
  )
  assert.equal(result.releaseGateAudit?.status, 'blocked', 'formal trading release gate must remain blocked')

  await app.close()
  console.log(JSON.stringify({
    ok: true,
    periods: multiPeriod.periods.map((period: any) => ({
      periodId: period.periodId,
      range: `${period.requestedStartDate}..${period.requestedEndDate}`,
      coveragePercent: period.coveragePercent,
      completedStrategyCount: period.completedStrategyCount,
      comparableStrategyCount: period.comparableStrategyCount,
      blockedReasons: period.blockedReasons,
    })),
    longHorizonStatus: longHorizon.status,
    releaseGateStatus: result.releaseGateAudit?.status,
    formalTradingUnlocked: result.readinessSummary?.formalTradingUnlocked,
    autoTradeUnlocked: result.readinessSummary?.autoTradeUnlocked,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
