import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { portfolioBacktestEngine } from '../src/services/portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../src/services/portfolio-backtest/portfolioBacktestInputBuilder.js'

function parseBelowMin(reason: string) {
  const match = reason.match(/component_count_below_min:(\d+)\/(\d+)/)
  if (!match) return null
  return {
    actual: Number(match[1]),
    required: Number(match[2]),
  }
}

async function main() {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  assert.ok(user, 'expected at least one local user for dividend-low-vol basket verification')

  const input = await portfolioBacktestInputBuilder.build({
    userId: user.id,
    portfolioStrategyIds: ['dividend_low_vol_basket'],
    startDate: '2025-12-04',
    endDate: '2026-06-05',
    initialCapital: 100000,
    rebalanceFrequency: 'quarterly',
    dividendMode: 'reinvest',
    feeRate: 0.0003,
    slippageRate: 0.0005,
    benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20'],
  })

  assert.equal(input.schemaVersion, 'portfolio.strategy_backtest.input.v1')
  assert.equal(input.notTradingAdvice, true)
  assert.deepEqual(input.allowedActions, ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'])
  assert.deepEqual(input.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])

  const definition = input.strategies.find((strategy) => strategy.strategyId === 'dividend_low_vol_basket')
  assert.ok(definition, 'dividend low vol basket definition should exist')
  assert.equal(definition.source, 'dividend_low_vol')
  assert.equal(definition.snapshot?.weightPolicy, 'equal_weight')
  assert.ok(definition.snapshot?.capturedAt, 'basket snapshot should include capturedAt')
  assert.ok(definition.snapshot?.source, 'basket snapshot should include source')
  assert.ok(Array.isArray(definition.snapshot?.selectionRules), 'basket snapshot should include selection rules')
  assert.ok((definition.snapshot?.selectionRules || []).length > 0, 'basket selection rules should not be empty')

  const result = await portfolioBacktestEngine.run(input)
  const strategy = result.strategies.find((item) => item.definition.strategyId === 'dividend_low_vol_basket')
  assert.ok(strategy, 'dividend low vol basket backtest result should exist')
  assert.equal(result.notTradingAdvice, true)
  assert.deepEqual(result.allowedActions, ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'])
  assert.deepEqual(result.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])

  const componentCount = strategy.definition.components.length
  const evidenceRefs = strategy.evidenceRefs.concat(strategy.definition.evidenceRefs)
  assert.ok(evidenceRefs.some((ref) => ref.includes('portfolio-strategy:dividend_low_vol_basket')), 'basket should expose portfolio strategy evidence')

  if (strategy.status === 'completed') {
    assert.ok(componentCount >= 3, 'completed dividend basket should include at least three real candidates')
    assert.ok(evidenceRefs.some((ref) => ref.includes('dividend_low_vol_daily')), 'completed basket should expose persisted dividend low vol evidence')
    assert.ok(strategy.metrics.totalReturnPercent !== null, 'completed basket should produce return metrics')
    assert.ok(strategy.equityCurve.length >= 2, 'completed basket should produce an equity curve')
  } else {
    assert.equal(strategy.status, 'insufficient', 'non-completed basket should stay insufficient, not partial/failed')
    assert.ok(
      strategy.blockedReasons.some((reason) => reason.startsWith('dividend_low_vol_candidate_snapshot')),
      'insufficient dividend basket should explain candidate snapshot blocker',
    )
    const belowMin = strategy.blockedReasons.map(parseBelowMin).find(Boolean)
    if (belowMin) {
      assert.ok(belowMin.actual < belowMin.required, 'component_count_below_min blocker should report actual below required')
      assert.equal(strategy.definition.snapshot?.selectedCandidateCount, belowMin.actual)
    }
    assert.equal(strategy.equityCurve.length, 0, 'insufficient basket should not display a completed equity curve')
  }

  console.log(JSON.stringify({
    ok: true,
    schemaVersion: 'dividend_low_vol.basket_snapshot_contract.v1',
    status: strategy.status,
    componentCount,
    snapshot: strategy.definition.snapshot,
    blockedReasons: strategy.blockedReasons,
    warnings: strategy.warnings,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    prohibitedActions: result.prohibitedActions,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
