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
      portfolioStrategyIds: ['current_holdings_buy_and_hold'],
      startDate: '2025-12-04',
      endDate: '2026-06-05',
      initialCapital: 100000,
      rebalanceFrequency: 'quarterly',
      dividendMode: 'reinvest',
      feeRate: 0.0003,
      slippageRate: 0.0005,
      benchmarkIds: ['cash_cny', 'free_source_total_return'],
      gradeMode: 'formal_review',
    },
  })
  assert.equal(response.statusCode, 200)
  const result = response.json()
  const strategy = result.strategies?.find((item: any) => item.definition?.strategyId === 'current_holdings_buy_and_hold')
  assert.ok(strategy, 'current holdings strategy missing')
  assert.equal(strategy.status, 'completed', `current holdings should complete for audit user: ${JSON.stringify(strategy.blockedReasons)}`)
  assert.ok((strategy.definition?.components || []).length >= 3, 'audit current holdings should have at least 3 components')
  assert.ok((strategy.equityCurve || []).length >= 30, 'current holdings should have enough real price points')
  assert.ok(strategy.definition?.snapshot?.totalMarketValue > 0, 'current holdings snapshot should include market value')
  assert.ok((strategy.evidenceRefs || []).some((ref: string) => ref.startsWith('position:')), 'position evidence refs missing')
  assert.deepEqual(result.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.equal(result.notTradingAdvice, true)
  await app.close()
  console.log(JSON.stringify({
    ok: true,
    userId: AUDIT_USER_ID,
    status: strategy.status,
    componentCount: strategy.definition.components.length,
    curvePoints: strategy.equityCurve.length,
    snapshot: strategy.definition.snapshot,
    formalReviewReadiness: strategy.formalReviewReadiness,
    prohibitedActions: result.prohibitedActions,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
