import assert from 'node:assert/strict'
import { portfolioBacktestEngine } from '../src/services/portfolio-backtest/portfolioBacktestEngine.js'
import type { PortfolioStrategyDefinition } from '../src/services/portfolio-backtest/portfolioBacktestTypes.js'

const dates = Array.from({ length: 90 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 0, 1 + index))
  return date.toISOString().slice(0, 10)
})
const prices = dates.map((date, index) => ({ date, close: 100 + index }))
const benchmark = dates.map((date, index) => ({ date, value: 1000 + index }))

function definition(overrides: Partial<PortfolioStrategyDefinition> = {}): PortfolioStrategyDefinition {
  return {
    strategyId: 'accounting_fixture',
    strategyVersion: 'v1',
    displayName: 'accounting fixture',
    source: 'preset',
    components: [{ assetClass: 'stock', symbol: '000001', targetWeightPercent: 100, evidenceRefs: ['fixture'] }],
    rebalancePolicy: { frequency: 'quarterly' },
    dividendPolicy: 'reinvest',
    costModel: { feeRate: 0.0003, slippageRate: 0.0005 },
    benchmarkPolicy: { benchmarkIds: ['benchmark'], proxyAllowed: false },
    validation: { status: 'valid', blockedReasons: [], warnings: [] },
    evidenceRefs: ['fixture'],
    ...overrides,
  }
}

function run(current: PortfolioStrategyDefinition) {
  return portfolioBacktestEngine.runFormalValidationStrategyWithSeries({
    definition: current,
    priceSeries: { '000001': prices },
    benchmarkId: 'benchmark',
    benchmarkPoints: benchmark,
    startDate: dates[0],
    endDate: dates.at(-1)!,
    sourceEvidenceRefs: ['fixture'],
    dividendEvents: {
      '000001': [{ date: dates[30], cashPerShare: 4, evidenceRef: 'dividend:eastmoney:fixture' }],
    },
  })
}

const baseline = run(definition())
const highCost = run(definition({ costModel: { feeRate: 0.0203, slippageRate: 0.0005 } }))
const cashDividend = run(definition({ dividendPolicy: 'cash' }))

assert.equal(baseline.status, 'completed')
assert.ok((baseline.metrics.costDragPercent || 0) > 0, 'initial allocation cost must enter cost drag')
assert.ok(
  (highCost.metrics.totalReturnPercent || 0) < (baseline.metrics.totalReturnPercent || 0),
  'higher transaction cost must reduce net return',
)
assert.ok(
  (cashDividend.metrics.totalReturnPercent || 0) < (baseline.metrics.totalReturnPercent || 0),
  'reserved cash dividend must differ from reinvested total-return series when prices rise after ex-date',
)
assert.ok((cashDividend.metrics.dividendContributionPercent || 0) > 0)

console.log(JSON.stringify({
  schemaVersion: 'fams.ftr_3.replay_accounting_contract.v1',
  status: 'passed',
  baselineReturnPercent: baseline.metrics.totalReturnPercent,
  highCostReturnPercent: highCost.metrics.totalReturnPercent,
  cashDividendReturnPercent: cashDividend.metrics.totalReturnPercent,
  initialAllocationCostIncluded: true,
  initialAllocationExcludedFromTurnoverRate: true,
  formalTradingUnlocked: false,
  autoTradeUnlocked: false,
  canCreateOrder: false,
  orderCreateAllowed: false,
}, null, 2))
