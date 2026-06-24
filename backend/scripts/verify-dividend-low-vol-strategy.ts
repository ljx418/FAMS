import assert from 'node:assert/strict'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import type { DividendLowVolInput } from '../src/services/dividend-low-vol/dividendLowVolTypes.js'

function history(options: { start: number; days: number; drift: number; amplitude?: number }) {
  const rows: DividendLowVolInput['history'] = []
  const startDate = new Date('2025-01-01T00:00:00.000Z')
  for (let index = 0; index < options.days; index += 1) {
    const wave = Math.sin(index / 13) * (options.amplitude || 0.6)
    const close = options.start + (index * options.drift) + wave
    const date = new Date(startDate.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    rows.push({
      date,
      open: close * 0.995,
      high: close * 1.01,
      low: close * 0.99,
      close,
      volume: 10_000_000,
      amount: close * 10_000_000,
    })
  }
  return rows
}

const baseDividendRecords = [
  { year: 2023, dividendPerShare: 0.65, evidenceRef: 'fixture:dividend:2023' },
  { year: 2024, dividendPerShare: 0.72, evidenceRef: 'fixture:dividend:2024' },
  { year: 2025, dividendPerShare: 0.82, evidenceRef: 'fixture:dividend:2025' },
]

function assertResearchOnly(result: any, label: string) {
  assert.ok(result.tradingDiscipline.allowedActions.includes('RESEARCH'), `${label} should allow research`)
  assert.ok(result.tradingDiscipline.allowedActions.includes('OBSERVE'), `${label} should allow observe`)
  assert.ok(result.tradingDiscipline.allowedActions.includes('ALERT'), `${label} should allow alerts`)
  assert.ok(result.tradingDiscipline.allowedActions.includes('PLAN_DRAFT'), `${label} should allow plan draft only`)
  assert.deepEqual(result.tradingDiscipline.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'], `${label} must prohibit trade actions`)
  assert.equal(result.tradingDiscipline.formalTradeActionAllowed, false, `${label} must not allow formal trade action`)
  assert.equal(result.tradingDiscipline.autoTradeAllowed, false, `${label} must not allow auto trade`)
}

async function main() {
  const lowZone = dividendLowVolStrategyService.buildFactSet({
    symbol: '600000',
    name: '浦发银行',
    industry: '银行',
    listingAgeDays: 365 * 15,
    price: 10,
    dividendRecords: baseDividendRecords,
    ttmDividendPerShare: 0.82,
    payoutRatio: 45,
    operatingCashFlowToNetProfit: 1.25,
    roe: 12,
    debtToAsset: 58,
    profitGrowth3y: 8,
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
    industryDividendYieldPercentile: 82,
    history: history({ start: 12.5, days: 260, drift: -0.006, amplitude: 0.35 }),
    evidenceRefs: ['fixture:annual-report:600000'],
  })
  assert.equal(lowZone.schemaVersion, 'dividend.low_vol.factset.v1')
  assert.equal(lowZone.strategyFamily, 'dividend_low_volatility')
  assert.ok(['low_zone_alert', 'build_position_plan', 'watch_candidate'].includes(lowZone.disposition), `unexpected low-zone disposition ${lowZone.disposition}`)
  assert.ok(lowZone.scores.evidenceAdjustedScore > 50, 'low-zone candidate should have usable research score')
  assert.ok(lowZone.evidenceRefs.length >= 4, 'low-zone candidate must expose evidence refs')
  assertResearchOnly(lowZone, 'low-zone candidate')

  const trap = dividendLowVolStrategyService.buildFactSet({
    symbol: '600001',
    name: '高息陷阱样本',
    industry: '周期',
    listingAgeDays: 365 * 8,
    price: 4,
    dividendRecords: [
      { year: 2023, dividendPerShare: 0.9, evidenceRef: 'fixture:trap:2023' },
      { year: 2024, dividendPerShare: 0.7, evidenceRef: 'fixture:trap:2024' },
      { year: 2025, dividendPerShare: 0.45, evidenceRef: 'fixture:trap:2025' },
    ],
    payoutRatio: 145,
    operatingCashFlowToNetProfit: 0.35,
    roe: 4,
    debtToAsset: 82,
    profitGrowth3y: -28,
    pe: 5,
    pb: 0.5,
    totalMarketCap: 180_000_000_000,
    avgTurnoverAmount60: 600_000_000,
    leaderScore: 82,
    history: history({ start: 9, days: 260, drift: -0.02, amplitude: 1.8 }),
    evidenceRefs: ['fixture:trap:annual-report'],
  })
  assert.equal(trap.disposition, 'avoid', 'high dividend trap must be avoided')
  assert.ok(trap.blockedReasons.includes('payout_ratio_extreme_high'), 'trap must flag extreme payout ratio')
  assert.ok(trap.blockedReasons.includes('cashflow_dividend_coverage_weak'), 'trap must flag weak cashflow coverage')
  assert.ok(trap.alerts.some((item) => item.type === 'DIVIDEND_EXIT_RISK'), 'trap must create exit risk alert')
  assertResearchOnly(trap, 'high dividend trap')

  const missing = dividendLowVolStrategyService.buildFactSet({
    symbol: '600002',
    name: '缺分红数据样本',
    listingAgeDays: 365 * 5,
    price: 11,
    history: history({ start: 11, days: 120, drift: 0.002 }),
  })
  assert.equal(missing.disposition, 'data_insufficient')
  assert.ok(missing.blockedReasons.includes('dividend_history_insufficient'), 'missing dividend history must block')
  assert.ok(missing.dataGapSummary.length > 0, 'missing case must expose data gaps')
  assert.ok(missing.alerts.some((item) => item.type === 'DIVIDEND_DATA_GAP'), 'missing case must create data gap alert')
  assertResearchOnly(missing, 'missing dividend data')

  const highZone = dividendLowVolStrategyService.buildFactSet({
    symbol: '600003',
    name: '高位样本',
    industry: '公用事业',
    listingAgeDays: 365 * 12,
    price: 22,
    dividendRecords: [
      { year: 2023, dividendPerShare: 0.86, evidenceRef: 'fixture:high-zone:2023' },
      { year: 2024, dividendPerShare: 0.92, evidenceRef: 'fixture:high-zone:2024' },
      { year: 2025, dividendPerShare: 1.0, evidenceRef: 'fixture:high-zone:2025' },
    ],
    ttmDividendPerShare: 1.0,
    payoutRatio: 40,
    operatingCashFlowToNetProfit: 1.1,
    roe: 10,
    debtToAsset: 45,
    profitGrowth3y: 5,
    pe: 36,
    pb: 3.5,
    totalMarketCap: 260_000_000_000,
    avgTurnoverAmount60: 700_000_000,
    leaderScore: 84,
    history: history({ start: 11, days: 260, drift: 0.04, amplitude: 0.4 }),
    evidenceRefs: ['fixture:high-zone:annual-report'],
  })
  assert.ok(['trim_high_zone', 'watch_candidate', 'data_insufficient'].includes(highZone.disposition), `unexpected high-zone disposition ${highZone.disposition}`)
  assert.ok(highZone.alerts.some((item) => item.type === 'DIVIDEND_HIGH_ZONE' || item.type === 'DIVIDEND_TRIM'), 'high-zone case must create high/trim alert')
  assertResearchOnly(highZone, 'high-zone candidate')

  const pool = dividendLowVolStrategyService.buildCandidatePool([lowZoneInput(), trapInput(), missingInput()])
  assert.equal(pool.strategyId, 'dividend_low_vol_leader_v1')
  assert.deepEqual(pool.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.equal(pool.total, 3)
  assert.ok(pool.candidates[0].scores.evidenceAdjustedScore >= pool.candidates[1].scores.evidenceAdjustedScore, 'pool should sort by evidence adjusted score')

  console.log(JSON.stringify({
    ok: true,
    lowZone: {
      disposition: lowZone.disposition,
      evidenceAdjustedScore: lowZone.scores.evidenceAdjustedScore,
      alerts: lowZone.alerts.map((item) => item.type),
      prohibitedActions: lowZone.tradingDiscipline.prohibitedActions,
    },
    trap: {
      disposition: trap.disposition,
      blockedReasons: trap.blockedReasons,
      alerts: trap.alerts.map((item) => item.type),
    },
    missing: {
      disposition: missing.disposition,
      blockedReasons: missing.blockedReasons,
      dataGapCount: missing.dataGapSummary.length,
    },
    highZone: {
      disposition: highZone.disposition,
      highZoneScore: highZone.timing.highZoneScore,
      alerts: highZone.alerts.map((item) => item.type),
    },
    poolTop: pool.candidates.slice(0, 3).map((item) => ({
      symbol: item.identity.symbol,
      disposition: item.disposition,
      score: item.scores.evidenceAdjustedScore,
    })),
  }, null, 2))
}

function lowZoneInput(): DividendLowVolInput {
  return {
    symbol: '600000',
    name: '浦发银行',
    listingAgeDays: 365 * 15,
    price: 10,
    dividendRecords: baseDividendRecords,
    ttmDividendPerShare: 0.82,
    payoutRatio: 45,
    operatingCashFlowToNetProfit: 1.25,
    roe: 12,
    debtToAsset: 58,
    profitGrowth3y: 8,
    pe: 7,
    pb: 0.7,
    totalMarketCap: 300_000_000_000,
    avgTurnoverAmount60: 800_000_000,
    leaderScore: 88,
    history: history({ start: 12.5, days: 260, drift: -0.006, amplitude: 0.35 }),
    evidenceRefs: ['fixture:annual-report:600000'],
  }
}

function trapInput(): DividendLowVolInput {
  return {
    symbol: '600001',
    name: '高息陷阱样本',
    listingAgeDays: 365 * 8,
    price: 4,
    dividendRecords: [
      { year: 2023, dividendPerShare: 0.9, evidenceRef: 'fixture:trap:2023' },
      { year: 2024, dividendPerShare: 0.7, evidenceRef: 'fixture:trap:2024' },
      { year: 2025, dividendPerShare: 0.45, evidenceRef: 'fixture:trap:2025' },
    ],
    payoutRatio: 145,
    operatingCashFlowToNetProfit: 0.35,
    totalMarketCap: 180_000_000_000,
    avgTurnoverAmount60: 600_000_000,
    leaderScore: 82,
    history: history({ start: 9, days: 260, drift: -0.02, amplitude: 1.8 }),
  }
}

function missingInput(): DividendLowVolInput {
  return {
    symbol: '600002',
    name: '缺分红数据样本',
    listingAgeDays: 365 * 5,
    price: 11,
    history: history({ start: 11, days: 120, drift: 0.002 }),
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
