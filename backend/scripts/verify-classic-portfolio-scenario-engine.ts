import assert from 'node:assert/strict'
import { portfolioScenarioEngine, type PortfolioScenarioBar } from '../src/services/portfolio-backtest/portfolioScenarioEngine.js'

const dates = [
  '2026-01-05', '2026-01-06', '2026-01-07', '2026-01-08', '2026-01-09',
  '2026-01-12', '2026-01-13', '2026-01-14', '2026-01-15', '2026-01-16',
]

function bars(values: Array<{ open: number; close: number }>) {
  return new Map(dates.map((date, index) => [date, { date, ...values[index] } satisfies PortfolioScenarioBar]))
}

const base = {
  strategyId: 'synthetic_50_50',
  components: [
    { assetClass: 'stock' as const, symbol: 'TEST01', name: '测试ETF', targetWeightPercent: 50, evidenceRefs: [] },
    { assetClass: 'cash' as const, symbol: 'CNY_FIXED_1PCT', name: '现金', targetWeightPercent: 50, evidenceRefs: [] },
  ],
  dates,
  initialCapital: 100000,
  feeRate: 0.0003,
  minCommissionCny: 5,
  slippageRate: 0.0005,
  cashAnnualRate: 0.01,
  lotSize: 100,
  driftThresholdPercentagePoints: 3,
  validationMonths: 12,
}

const flatBars = bars(dates.map(() => ({ open: 10, close: 10 })))
const buyAndHold = portfolioScenarioEngine.run({
  ...base,
  barsBySymbol: new Map([['TEST01', flatBars]]),
  scenarioId: 'buy_and_hold',
})
assert.equal(buyAndHold.status, 'completed')
assert.equal(buyAndHold.trades.length, 1)
assert.equal(buyAndHold.trades[0].reason, 'initial_allocation')
assert.equal(buyAndHold.trades[0].quantity % 100, 0)
assert.equal(buyAndHold.trades[0].commission, 14.71)
assert.ok(buyAndHold.metrics.endingValue > 99970, 'cash interest should accrue while explicit costs remain visible')
assert.equal(buyAndHold.positionCurve.length, dates.length)
assert.equal(buyAndHold.equityCurve.length, dates.length)
assert.equal(buyAndHold.equityCurve[0].portfolioValue, buyAndHold.positionCurve[0].portfolioValue)
assert.equal(buyAndHold.equityCurve[0].pnlAmount, buyAndHold.positionCurve[0].pnlAmount)
for (const point of buyAndHold.positionCurve) {
  const weightSum = point.cashWeightPercent + point.components.reduce((sum, component) => sum + component.weightPercent, 0)
  assert.ok(Math.abs(weightSum - 100) <= 0.05, `position weights must reconcile on ${point.date}: ${weightSum}`)
  assert.ok(point.components.every((component) => component.quantity % 100 === 0))
}

const weeklyBars = bars(dates.map((_, index) => ({
  open: index === 5 ? 20 : 10,
  close: index >= 4 ? 20 : 10,
})))
const weekly = portfolioScenarioEngine.run({
  ...base,
  barsBySymbol: new Map([['TEST01', weeklyBars]]),
  scenarioId: 'weekly',
})
const calendarTrades = weekly.trades.filter((trade) => trade.reason === 'calendar_rebalance')
assert.ok(calendarTrades.length > 0)
assert.ok(calendarTrades.every((trade) => trade.decisionDate === '2026-01-09'))
assert.ok(calendarTrades.every((trade) => trade.executionDate === '2026-01-12'))
assert.ok(weekly.trades.filter((trade) => trade.executionDate <= '2026-01-09').every((trade) => trade.reason === 'initial_allocation'))

const drift = portfolioScenarioEngine.run({
  ...base,
  barsBySymbol: new Map([['TEST01', weeklyBars]]),
  scenarioId: 'drift_3pp',
})
const driftTrades = drift.trades.filter((trade) => trade.reason === 'drift_threshold')
assert.ok(driftTrades.length > 0)
assert.ok(driftTrades.every((trade) => trade.executionDate > trade.decisionDate), 'drift signal must execute on a later trading day')
assert.ok(drift.trades.every((trade) => trade.quantity % 100 === 0))
assert.ok(drift.trades.every((trade) => trade.cashAfter >= -0.01), 'integer-lot buys must not overdraw cash')

// Cash is a target bucket too. A broad decline can push cash outside its band
// while each risky asset remains less than 3 percentage points from target.
const cashDriftDates = ['2026-01-05', '2026-01-06', '2026-01-07']
const cashDriftBars = new Map(['A', 'B', 'C'].map((symbol) => [symbol, new Map(cashDriftDates.map((date, index) => [
  date,
  { date, open: index === 0 ? 1 : 0.566, close: index === 0 ? 1 : 0.566 },
]))]))
const cashDrift = portfolioScenarioEngine.run({
  ...base,
  strategyId: 'cash_drift_gate',
  components: [
    ...['A', 'B', 'C'].map((symbol) => ({ assetClass: 'stock' as const, symbol, name: symbol, targetWeightPercent: 95 / 3, evidenceRefs: [] })),
    { assetClass: 'cash' as const, symbol: 'CNY_FIXED_1PCT', name: '现金', targetWeightPercent: 5, evidenceRefs: [] },
  ],
  dates: cashDriftDates,
  barsBySymbol: cashDriftBars,
  lotSize: 1,
  feeRate: 0,
  minCommissionCny: 0,
  slippageRate: 0,
  scenarioId: 'drift_3pp',
})
assert.ok(cashDrift.decisionDates.includes('2026-01-06'), 'cash drift above 3pp must trigger a rebalance decision')

const cashOnly = portfolioScenarioEngine.run({
  ...base,
  strategyId: 'cash_only',
  components: [{ assetClass: 'cash' as const, symbol: 'CNY_FIXED_1PCT', name: '现金', targetWeightPercent: 100, evidenceRefs: [] }],
  barsBySymbol: new Map(),
  scenarioId: 'buy_and_hold',
})
assert.equal(cashOnly.trades.length, 0)
assert.ok(cashOnly.metrics.endingValue > 100000)

console.log(JSON.stringify({
  ok: true,
  buyAndHold: buyAndHold.metrics,
  weeklyTradeCount: weekly.trades.length,
  driftTradeCount: drift.trades.length,
  cashOnlyEndingValue: cashOnly.metrics.endingValue,
}, null, 2))
