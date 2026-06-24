import assert from 'node:assert/strict'
import { dividendLowVolTradingZoneService } from '../src/services/dividend-low-vol/dividendLowVolTradingZoneService.js'
import type { DividendLowVolInput } from '../src/services/dividend-low-vol/dividendLowVolTypes.js'

function history(start: number, days: number, phase: number) {
  const rows = []
  const startDate = new Date(Date.now() - (days - 1) * 24 * 60 * 60 * 1000)
  for (let index = 0; index < days; index += 1) {
    const close = start + Math.sin((index + phase) / 18) * 0.75 + Math.sin((index + phase) / 7) * 0.18
    rows.push({
      date: new Date(startDate.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      open: close * 0.995,
      high: close * 1.015,
      low: close * 0.985,
      close,
      volume: 9_000_000,
      amount: close * 90_000_000,
      isTradable: true,
      tradabilityStatus: 'tradable' as const,
      isSuspended: false,
      tradeabilityEvidenceRef: `rolling-fixture:tradeability:${index}`,
    })
  }
  return rows
}

function candidate(symbol: string, name: string, phase: number): DividendLowVolInput {
  return {
    symbol,
    name,
    market: 'A_SHARE',
    assetType: 'stock',
    industry: '银行',
    listingAgeDays: 365 * 15,
    price: 10,
    dividendRecords: [
      { year: 2023, dividendPerShare: 0.62, evidenceRef: `rolling-fixture:${symbol}:dividend:2023` },
      { year: 2024, dividendPerShare: 0.7, evidenceRef: `rolling-fixture:${symbol}:dividend:2024` },
      { year: 2025, dividendPerShare: 0.82, evidenceRef: `rolling-fixture:${symbol}:dividend:2025` },
    ],
    ttmDividendPerShare: 0.82,
    payoutRatio: 45,
    operatingCashFlowToNetProfit: 1.2,
    roe: 12,
    debtToAsset: 58,
    pe: 7,
    pb: 0.7,
    totalMarketCap: 300_000_000_000,
    avgTurnoverAmount60: 800_000_000,
    leaderScore: 88,
    marketCapRankScore: 92,
    revenueRankScore: 82,
    netProfitRankScore: 86,
    roeIndustryPercentile: 75,
    liquidityRankScore: 80,
    history: history(10, 780, phase),
    evidenceRefs: [`rolling-fixture:${symbol}:annual-report`, `rolling-fixture:${symbol}:3y-history`],
  }
}

const inputs = [
  candidate('600000', '浦发银行', 0),
  candidate('601398', '工商银行', 11),
  candidate('000001', '平安银行', 23),
]

const zones = dividendLowVolTradingZoneService.buildTradingZones(inputs)
assert.equal(zones.schemaVersion, 'dividend.low_vol.trading_zone.v1')
assert.equal(zones.notTradingAdvice, true)
assert.deepEqual(zones.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
assert.ok(zones.zones.length >= 1)
assert.ok(zones.zones.every((zone) => zone.priceAudit?.freshnessStatus === 'fresh'))
assert.ok(zones.zones.every((zone) => zone.strategies.length === 2))
assert.ok(zones.zones.every((zone) => zone.strategies.some((strategy) => strategy.buyZone.high !== null && strategy.sellZone.low !== null)))
assert.ok(zones.zones.every((zone) => zone.strategies.every((strategy) => strategy.priceAudit, 'strategy must expose price audit')))

const result = dividendLowVolTradingZoneService.runRollingBacktest(inputs, { years: 3, minRequiredTradingDays: 600 })
assert.equal(result.schemaVersion, 'dividend.low_vol.rolling_backtest.v1')
assert.equal(result.window.requestedYears, 3)
assert.equal(result.notTradingAdvice, true)
assert.deepEqual(result.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
assert.equal(result.strategyResults.length, 2)
assert.ok(result.strategyResults.every((strategy) => strategy.sample.effectiveCandidateCount > 0))
assert.ok(result.strategyResults.every((strategy) => strategy.sample.tradeCount > 0))
assert.ok(result.strategyResults.every((strategy) => typeof strategy.metrics.winRatePercent === 'number'))

console.log(JSON.stringify({
  ok: true,
  tradingZones: zones.zones.length,
  rollingBacktest: {
    status: result.status,
    conclusion: result.conclusion,
    strategyResults: result.strategyResults.map((strategy) => ({
      label: strategy.label,
      status: strategy.status,
      tradeCount: strategy.sample.tradeCount,
      winRatePercent: strategy.metrics.winRatePercent,
      totalReturnPercent: strategy.metrics.totalReturnPercent,
      maxDrawdownPercent: strategy.metrics.maxDrawdownPercent,
      prohibitedActions: result.policy.prohibitedActions,
    })),
  },
}, null, 2))
