import assert from 'node:assert/strict'
import {
  allocateLargestRemainder,
  gridStrategyService,
  resolveGridTradingRules,
  roundGridPrice,
  shanghaiSessionClose,
} from '../src/services/strategy/gridStrategyService.js'

const duringSession = new Date('2026-08-25T02:30:00.000Z')
const afterSession = new Date('2026-08-25T07:01:00.000Z')
const config = gridStrategyService.getTemplate('mean_reversion_atr_v1')

assert.deepEqual(resolveGridTradingRules('stock', 'CN'), {
  market: 'CN', priceTick: 0.01, priceDecimals: 2, lotSize: 100, buyPriceRounding: 'down', sellPriceRounding: 'up',
})
assert.equal(resolveGridTradingRules('etf', 'CN').priceTick, 0.001)
assert.equal(roundGridPrice(10.237, 0.01, 'buy'), 10.23)
assert.equal(roundGridPrice(10.237, 0.01, 'sell'), 10.24)
assert.equal(roundGridPrice(0.60837, 0.001, 'buy'), 0.608)
assert.equal(roundGridPrice(0.60837, 0.001, 'sell'), 0.609)
assert.deepEqual(allocateLargestRemainder(100, [0.4, 0.35, 0.25], 3, 100), [100, 0, 0])
assert.deepEqual(allocateLargestRemainder(300, [0.4, 0.35, 0.25], 3, 100), [100, 100, 100])
assert.equal(shanghaiSessionClose(duringSession).toISOString(), '2026-08-25T07:00:00.000Z')

const build = (assetType: 'stock' | 'etf', availablePortfolioBuyBudget: number, overrides: Record<string, unknown> = {}) => gridStrategyService.buildGridDraft({
  config,
  assetType,
  market: 'CN',
  currentPrice: assetType === 'stock' ? 10 : 0.608,
  avgCost: assetType === 'stock' ? 12 : 0.7681513687600644,
  quantity: assetType === 'stock' ? 1_000 : 62_100,
  cashBudget: 36_000.33,
  availablePortfolioBuyBudget,
  portfolioValue: 100_000,
  currentMarketValue: assetType === 'stock' ? 10_000 : 17_756.8,
  completedBars: 30,
  confidence: 0.9,
  materialChange: 'none',
  valuationStatus: assetType === 'stock' ? 'available' : 'not_applicable',
  valuationConclusion: assetType === 'stock' ? 'reasonable' : 'not_applicable',
  ma5: assetType === 'stock' ? 10.1 : 0.61,
  ma10: assetType === 'stock' ? 10.2 : 0.612,
  ma30: assetType === 'stock' ? 9.8 : 0.62,
  atr14: assetType === 'stock' ? 0.3 : 0.02,
  now: duringSession,
  ...overrides,
})

const first = build('stock', 5_000)
const firstBuyAmount = first.orders.filter((order) => order.side === 'buy').reduce((sum, order) => sum + Number(order.amount), 0)
assert.ok(first.orders.some((order) => order.side === 'buy'))
assert.ok(first.orders.some((order) => order.side === 'sell'))
assert.ok(firstBuyAmount <= 5_000 + 0.000001)
for (const order of first.orders) {
  assert.equal(Number(order.quantity) % 100, 0)
  assert.ok(Math.abs(Number(order.price) * 100 - Math.round(Number(order.price) * 100)) < 1e-8)
  assert.equal(order.validUntil, '2026-08-25T07:00:00.000Z')
}
assert.equal(first.orders.filter((order) => order.side === 'sell').reduce((sum, order) => sum + Number(order.quantity), 0), 300)

const remaining = Number((5_000 - firstBuyAmount).toFixed(2))
const second = build('etf', remaining)
const secondBuyAmount = second.orders.filter((order) => order.side === 'buy').reduce((sum, order) => sum + Number(order.amount), 0)
assert.ok(firstBuyAmount + secondBuyAmount <= 5_000 + 0.000001)
for (const order of second.orders) {
  assert.equal(Number(order.quantity) % 100, 0)
  assert.ok(Math.abs(Number(order.price) * 1_000 - Math.round(Number(order.price) * 1_000)) < 1e-8)
}

const parentSellOrders = first.orders.filter((order) => order.side === 'sell').map((order, index) => ({
  id: `parent-${index + 1}`,
  level: Number(order.level),
  price: Number(order.price),
  quantity: Number(order.quantity),
  validUntil: String(order.validUntil),
}))
const buyback = gridStrategyService.buildConditionalBuybackDraft({
  parentGridPlanId: 'parent-plan',
  parentSellOrders,
  spacingAbsolute: first.derivation.spacing.absoluteAmount,
  assetType: 'stock',
  market: 'CN',
  now: duringSession,
})
assert.equal(buyback.status, 'awaiting_parent_fill')
assert.equal(buyback.constraints.consumesImmediateCashBeforeFill, false)
assert.equal(buyback.orders.length, parentSellOrders.length)
buyback.orders.forEach((order, index) => {
  const parent = parentSellOrders[index]
  assert.equal(order.status, 'awaiting_parent_fill')
  assert.equal(order.quantity, parent.quantity)
  assert.equal(order.price, roundGridPrice(parent.price - first.derivation.spacing.absoluteAmount, 0.01, 'buy'))
  assert.equal(order.triggerCondition.parentOrderDraftId, parent.id)
  assert.equal(order.triggerCondition.parentGridPlanId, 'parent-plan')
  assert.equal(order.triggerCondition.consumesImmediateCashBeforeFill, false)
})

const closed = build('stock', 5_000, { now: afterSession })
assert.equal(closed.orders.length, 0)
assert.ok(closed.blockers.includes('session_closed'))
assert.equal(closed.constraints.validUntil, '2026-08-25T07:00:00.000Z')

console.log(JSON.stringify({
  status: 'PASS',
  priceRules: { stockTick: 0.01, etfTick: 0.001, lotSize: 100 },
  largestRemainder: { oneLotAcrossThreeLevels: [100, 0, 0], threeLotsAcrossThreeLevels: [100, 100, 100] },
  portfolioBudget: { initial: 5_000, firstUsed: firstBuyAmount, secondUsed: secondBuyAmount, totalUsed: Number((firstBuyAmount + secondBuyAmount).toFixed(2)) },
  parentSellOrders,
  conditionalBuybacks: buyback.orders,
  sessionClose: closed.constraints.validUntil,
  executionBoundary: { brokerOrdersCreated: 0 },
}, null, 2))
