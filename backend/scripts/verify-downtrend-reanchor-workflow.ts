import assert from 'node:assert/strict'
import { downtrendReanchorService } from '../src/services/strategy/downtrendReanchorService.js'
import type { DowntrendDefensiveConfig } from '../src/services/strategy/gridStrategyService.js'

const config: DowntrendDefensiveConfig = {
  schemaVersion: 'fams.grid-strategy.v2',
  templateId: 'test_downtrend',
  name: '测试固定网格',
  mode: 'downtrend_defensive',
  status: 'active',
  fixedAnchor: {
    price: 100,
    asOf: '2026-09-15T15:00:00+08:00',
    reanchorOnlyAfter: ['completed_fill_cycle', 'pause_trigger', 'two_closes_above_ma5_with_nonfalling_ma5'],
  },
  allocation: { core: 800, satellite: 200, reboundExit: 200, hardCap: 1200 },
  riskPolicy: {
    cashFloorPercent: 10,
    feeReserve: 10,
    unfilledSellProceedsCountAsCash: false,
    pauseRule: { metric: 'daily_close', operator: 'below', threshold: 80, action: 'pause_pending_net_buys', appliesTo: 'capacity_build' },
  },
  levels: [
    { orderRef: 'buy-1', side: 'buy', price: 96, quantity: 100, orderRole: 'satellite_cycle', activationStatus: 'active', rationale: '旧锚下方4%' },
    { orderRef: 'sell-1', side: 'sell', price: 104, quantity: 100, orderRole: 'rebound_exit', activationStatus: 'active', rationale: '旧锚上方4%' },
  ],
}

const chart = [
  ['2026-09-16', 99, 100],
  ['2026-09-17', 98, 99],
  ['2026-09-18', 97, 98],
  ['2026-09-21', 96, 97],
  ['2026-09-22', 95, 96],
  ['2026-09-23', 94, 95],
].map(([date, close, ma5]) => ({ date: String(date), close: Number(close), ma5: Number(ma5) }))

const evaluation = downtrendReanchorService.evaluate({
  symbol: 'TEST',
  assetType: 'stock',
  market: 'CN',
  config,
  latestCompletedDate: '2026-09-23',
  latestCompletedClose: 94,
  livePrice: 93.5,
  atr14: 2,
  chart,
  completedFillCycle: false,
})

assert.equal(evaluation.required, true)
assert.equal(evaluation.anchor.ageCompletedSessions, 6)
assert.equal(evaluation.drift.atrMultiple, 3)
assert(evaluation.reasonCodes.includes('aged_anchor_drift'))
assert(evaluation.reasonCodes.includes('immediate_extreme_drift'))
assert.equal(evaluation.triggers.find((item) => item.code === 'completed_fill_cycle')?.state, 'false')

const candidate = downtrendReanchorService.buildCandidate({ config, evaluation, assetType: 'stock', market: 'CN' })
assert.equal(candidate.config.fixedAnchor.price, 94)
assert.equal(candidate.config.allocation.core, config.allocation.core)
assert.equal(candidate.config.allocation.satellite, config.allocation.satellite)
assert.equal(candidate.config.levels[0].quantity, 100)
assert.equal(candidate.config.levels[0].orderRole, 'satellite_cycle')
assert.equal(candidate.config.levels[0].price, 90.24)
assert.equal(candidate.config.levels[1].price, 97.76)
assert.equal(candidate.formula, 'candidate_price = latest_completed_close * (old_level_price / old_fixed_anchor)')

const young = downtrendReanchorService.evaluate({
  symbol: 'TEST', assetType: 'stock', market: 'CN', config,
  latestCompletedDate: '2026-09-17', latestCompletedClose: 96, livePrice: 96, atr14: 2,
  chart: chart.slice(0, 2), completedFillCycle: false,
})
assert.equal(young.required, false, '不足5日且未到3 ATR时不应只因日内下跌重锚')

const etfFallback = downtrendReanchorService.evaluate({
  symbol: 'ETF', assetType: 'etf', market: 'CN', config,
  latestCompletedDate: '2026-09-23', latestCompletedClose: 96.9, livePrice: 96.8, atr14: null,
  chart, completedFillCycle: false,
})
assert(etfFallback.reasonCodes.includes('aged_anchor_drift'), 'ETF在ATR缺失时应使用3%门槛')

const stockFallback = downtrendReanchorService.evaluate({
  symbol: 'STOCK', assetType: 'stock', market: 'CN', config,
  latestCompletedDate: '2026-09-23', latestCompletedClose: 96.9, livePrice: 96.8, atr14: null,
  chart, completedFillCycle: false,
})
assert.equal(stockFallback.reasonCodes.includes('aged_anchor_drift'), false, '个股在ATR缺失时应使用5%门槛')

const completedCycle = downtrendReanchorService.evaluate({
  symbol: 'CYCLE', assetType: 'stock', market: 'CN', config,
  latestCompletedDate: '2026-09-16', latestCompletedClose: 99, livePrice: 99, atr14: 2,
  chart: chart.slice(0, 1), completedFillCycle: true,
})
assert.deepEqual(completedCycle.reasonCodes, ['completed_fill_cycle'], '可追溯成交闭环应能独立触发重锚')

const roundedEvaluation = downtrendReanchorService.evaluate({
  symbol: 'ROUND', assetType: 'stock', market: 'CN', config,
  latestCompletedDate: '2026-09-23', latestCompletedClose: 93.97, livePrice: 93.97, atr14: 1,
  chart, completedFillCycle: false,
})
const roundedCandidate = downtrendReanchorService.buildCandidate({ config, evaluation: roundedEvaluation, assetType: 'stock', market: 'CN' })
assert.equal(roundedCandidate.config.levels[0].price, 90.21, '买价应向下按最小价位取整')
assert.equal(roundedCandidate.config.levels[1].price, 97.73, '卖价应向上按最小价位取整')

process.stdout.write(JSON.stringify({
  status: 'PASS',
  policyVersion: evaluation.policyVersion,
  triggerReasons: evaluation.reasonCodes,
  translatedLevels: candidate.levelDiffs,
  completedCycleTrigger: completedCycle.reasonCodes,
  directionalRounding: roundedCandidate.config.levels.map((level) => ({ side: level.side, price: level.price })),
  fallbackThresholds: { stock: 5, etf: 3 },
  brokerOrdersCreated: 0,
}, null, 2) + '\n')
