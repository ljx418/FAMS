import assert from 'node:assert/strict'
import { buildIndustryCrowdingScores } from '../src/services/relative-rotation/industryCrowdingService.js'

const businessDates: string[] = []
for (let cursor = new Date('2025-10-01T00:00:00.000Z'); businessDates.length < 110; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
  const day = cursor.getUTCDay()
  if (day !== 0 && day !== 6) businessDates.push(cursor.toISOString().slice(0, 10))
}

const makeBoard = (code: string, name: string, dailyGrowth: number, flowPerDay: number, amountGrowth: number, volatility: number) => ({
  code,
  name,
  bars: businessDates.map((date, index) => {
    const close = 100 * ((1 + dailyGrowth) ** index) * (1 + (Math.sin(index * 0.7) * volatility))
    const amount = 100_000_000 * (index > 75 ? amountGrowth : 1)
    return {
      date,
      open: close * 0.995,
      high: close * 1.005,
      low: close * 0.99,
      close,
      volume: amount / close,
      amount,
      mainNetInflow: flowPerDay,
      mainNetInflowRatio: flowPerDay / amount,
    }
  }),
})

const benchmark = businessDates.map((date, index) => ({ date, close: 100 * ((1.0005) ** index) }))
const scored = buildIndustryCrowdingScores({
  year: 2026,
  benchmark,
  boards: [
    makeBoard('BK0001', '高热度高流入', 0.004, 12_000_000, 2.5, 0.012),
    makeBoard('BK0002', '低热度低流入', -0.001, -8_000_000, 0.7, 0.002),
    makeBoard('BK0003', '中性行业', 0.0008, 500_000, 1.1, 0.006),
  ],
})

const high = scored.get('BK0001') || []
const low = scored.get('BK0002') || []
const neutral = scored.get('BK0003') || []

assert.ok(high.length > 0, 'should produce scores after the 60-trading-day lookback')
assert.ok(high.every((point) => point.date.startsWith('2026-')), 'display points must not include the 2025 calculation lookback')
assert.equal(high.length, low.length)
assert.equal(high.length, neutral.length)
assert.ok(high.at(-1)?.behaviorScore !== null, 'behavior score needs all three transparent inputs')
assert.ok(high.at(-1)?.flowCrowdingScore20 !== null, '20-day normalized flow score needs a 20-day main-flow window')
assert.ok((high.at(-1)?.behaviorScore || 0) > (low.at(-1)?.behaviorScore || 0), 'momentum and amount expansion should rank above the low-heat sector')
assert.ok((high.at(-1)?.flowCrowdingScore20 || 0) > (low.at(-1)?.flowCrowdingScore20 || 0), 'positive normalized flow intensity should rank above outflow')
assert.equal(high.at(-1)?.capitalFlowScore, high.at(-1)?.flowCrowdingScore20, 'deprecated score alias must not diverge from the normalized score')
assert.equal(high.at(-1)?.dailyMainNetInflow, 12_000_000, 'daily raw flow is exposed only as an explanatory field')
assert.equal(high.at(-1)?.dailyFlowIntensity, 0.048, 'daily flow strength must be normalized by same-day turnover')
assert.equal(high.at(-1)?.flowIntensity20, 0.048, '20-day flow strength must remain a turnover-normalized ratio')
assert.equal(high.at(-1)?.behaviorEligibleCount, 3, 'behavior components must share one eligible cross section')
assert.equal(high.at(-1)?.flowEligibleCount, 3, 'flow score must disclose its eligible cross section')
assert.ok((high.at(-1)?.flowObservationCount || 0) >= 16, 'flow score must disclose its observation threshold')

console.log(JSON.stringify({
  schemaVersion: 'fams.relative_rotation.industry_crowding_verification.v2',
  generatedPoints: high.length,
  latest: {
    highBehavior: high.at(-1)?.behaviorScore,
    lowBehavior: low.at(-1)?.behaviorScore,
    highFlow: high.at(-1)?.flowCrowdingScore20,
    lowFlow: low.at(-1)?.flowCrowdingScore20,
    highDailyFlowIntensity: high.at(-1)?.dailyFlowIntensity,
  },
  status: 'passed',
}, null, 2))
