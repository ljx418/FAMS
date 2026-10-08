import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { gridStrategyService, type DowntrendDefensiveConfig } from '../src/services/strategy/gridStrategyService.js'
import { compileVolatilityPortfolioBudget, finalizeVolatilityDraftSafety } from '../src/services/review/volatilityDraftSafetyService.js'

const state = JSON.parse(await readFile(resolve(process.cwd(), '../波动交易工作流迁移-20260908/strategy_state.json'), 'utf8'))
const positions = new Map<string, any>(state.positions.map((position: any) => [position.symbol, position]))
const now = new Date('2026-10-08T02:00:00.000Z')
const portfolioValue = 227_077.35
const cashBudget = 49_918.35

const hengruiConfig = structuredClone(positions.get('600276').downtrend_grid) as DowntrendDefensiveConfig
const hengruiBuys = hengruiConfig.levels.filter((level) => level.orderRole === 'capacity_build')
;[hengruiBuys[0].price, hengruiBuys[1].price, hengruiBuys[2].price] = [45.81, 44.24, 42.67]

const inputs = [
  { symbol: '600276', config: hengruiConfig, assetType: 'stock', quantity: 800, close: 47.2, live: 47.13, atr14: 1.1264 },
  { symbol: '159851', config: positions.get('159851').downtrend_grid, assetType: 'etf', quantity: 65_000, close: .578, live: .57, atr14: .02 },
  { symbol: '513770', config: positions.get('513770').downtrend_grid, assetType: 'etf', quantity: 130_000, close: .329, live: .329, atr14: .01 },
  { symbol: '601127', config: positions.get('601127').downtrend_grid, assetType: 'stock', quantity: 900, close: 46.94, live: 46.94, atr14: 1.2 },
]

function replay() {
  const assets = inputs.map((input) => {
    const draft = gridStrategyService.buildDowntrendDefensiveDraft({
      config: input.config,
      assetType: input.assetType,
      market: 'CN',
      currentQuantity: input.quantity,
      sellableQuantity: input.quantity,
      currentClose: input.close,
      atr14: input.atr14,
      livePrice: input.live,
      quoteAsOf: now.toISOString(),
      quoteAgeSeconds: 0,
      quoteFresh: true,
      cashBudget,
      availablePortfolioBuyBudget: 20_575,
      portfolioValue,
      ignoreFrozenForCapacity: input.symbol === '513770',
      now,
    })
    return { symbol: input.symbol, grid: finalizeVolatilityDraftSafety(draft) }
  })
  return compileVolatilityPortfolioBudget(assets, {
    principalLimit: 20_575,
    cashSpendLimit: cashBudget - portfolioValue * .05,
  })
}

const beforeCounts = {
  positions: await prisma.position.count(),
  transactions: await prisma.transaction.count(),
  externalOrders: await prisma.externalOrderObservation.count(),
}
const runs = [replay(), replay(), replay()]
const hashes = runs.map((run) => createHash('sha256').update(JSON.stringify(run)).digest('hex'))
assert.equal(new Set(hashes).size, 1, 'fixed inputs must produce the same three replay hashes')

const result = runs[0]
const allOrders = result.assets.flatMap((asset) => asset.grid.orders || [])
const active = allOrders.filter((order) => order.activationStatus === 'active')
const manual = allOrders.filter((order) => order.activationStatus === 'manual_confirmation_required')
const currentCandidates = allOrders.filter((order) => ['active', 'manual_confirmation_required'].includes(order.activationStatus))
assert.equal(currentCandidates.length, 11)
assert.equal(active.length, 10)
assert.equal(active.filter((order) => order.side === 'buy').length, 4)
assert.equal(active.filter((order) => order.side === 'sell').length, 6)
assert.equal(manual.length, 1)

const hengrui = result.assets.find((asset) => asset.symbol === '600276')!
const deepestHengrui = hengrui.grid.orders!.find((order) => order.price === 42.67)!
assert.equal(deepestHengrui.activationStatus, 'dormant')
assert.equal(deepestHengrui.triggerCondition.blocker, 'distance_above_3_atr')
assert.ok(deepestHengrui.triggerCondition.reachability.distanceAtr > 3)

const seres = result.assets.find((asset) => asset.symbol === '601127')!
const retiredExits = seres.grid.orders!.filter((order) => order.orderRole === 'rebound_exit')
assert.equal(retiredExits.length, 2)
assert.equal(retiredExits.every((order) => order.activationStatus === 'dormant'), true)
assert.equal(retiredExits.every((order) => order.triggerCondition.effectiveDisposition === 'retired_for_position'), true)
assert.deepEqual(seres.grid.orders!.filter((order) => order.activationStatus === 'active').map((order) => [order.price, order.quantity]), [[50, 100]])

const fintech = result.assets.find((asset) => asset.symbol === '159851')!
const marketableBuy = fintech.grid.orders!.find((order) => order.price === .57 && order.orderRole === 'capacity_build')!
assert.equal(marketableBuy.activationStatus, 'manual_confirmation_required')
assert.equal(marketableBuy.triggerCondition.blocker, 'marketable_now')

for (const order of active) {
  assert.deepEqual(order.triggerCondition.blockers, [])
  assert.equal(order.conflictStatus, 'none')
  assert.equal(order.triggerCondition.quote.fresh, true)
  assert.equal(order.triggerCondition.marketableNow, false)
  if (order.side === 'buy' && order.orderRole === 'capacity_build') {
    assert.ok(order.triggerCondition.reachability.distanceAtr <= 3)
  }
}

const missingAtr = gridStrategyService.buildDowntrendDefensiveDraft({
  config: hengruiConfig, assetType: 'stock', market: 'CN', currentQuantity: 800, sellableQuantity: 800,
  currentClose: 47.2, atr14: null, livePrice: 47.13, quoteAsOf: now.toISOString(), quoteAgeSeconds: 0, quoteFresh: true,
  cashBudget, availablePortfolioBuyBudget: 20_575, portfolioValue, now,
})
assert.equal(missingAtr.orders.filter((order) => order.orderRole === 'capacity_build').every((order) => order.activationStatus === 'dormant'), true)
assert.equal(missingAtr.orders.filter((order) => order.orderRole === 'capacity_build').every((order) => order.triggerCondition.blocker === 'reachability_unknown'), true)

const staleQuote = gridStrategyService.buildDowntrendDefensiveDraft({
  config: positions.get('513770').downtrend_grid, assetType: 'etf', market: 'CN', currentQuantity: 130_000, sellableQuantity: 130_000,
  currentClose: .329, atr14: .01, livePrice: .329, quoteAsOf: now.toISOString(), quoteAgeSeconds: 121, quoteFresh: false,
  cashBudget, availablePortfolioBuyBudget: 20_575, portfolioValue, now,
})
assert.equal(staleQuote.orders
  .filter((order) => order.triggerCondition.configuredStatus === 'active')
  .every((order) => order.activationStatus === 'manual_confirmation_required'), true)

const contradictory = structuredClone(result.assets.find((asset) => asset.symbol === '513770')!.grid)
const corrupted = contradictory.orders.find((order: any) => order.activationStatus === 'active')
corrupted.triggerCondition.blocker = 'injected_test_blocker'
corrupted.triggerCondition.blockers = ['injected_test_blocker']
const validated = finalizeVolatilityDraftSafety(contradictory)
assert.equal(validated.orders.find((order: any) => order.triggerCondition.orderRef === corrupted.triggerCondition.orderRef).activationStatus, 'dormant')

const missingReachability = structuredClone(result.assets.find((asset) => asset.symbol === '600276')!.grid)
const activeReachableBuy = missingReachability.orders.find((order: any) => order.side === 'buy' && order.activationStatus === 'active')
activeReachableBuy.triggerCondition.reachability.distanceAtr = null
const reachabilityValidated = finalizeVolatilityDraftSafety(missingReachability)
assert.equal(reachabilityValidated.orders.find((order: any) => order.triggerCondition.orderRef === activeReachableBuy.triggerCondition.orderRef).triggerCondition.blocker, 'reachability_unknown')

const staleFinalGate = structuredClone(result.assets.find((asset) => asset.symbol === '513770')!.grid)
const activeSell = staleFinalGate.orders.find((order: any) => order.side === 'sell' && order.activationStatus === 'active')
activeSell.triggerCondition.quote.ageSeconds = 121
const quoteValidated = finalizeVolatilityDraftSafety(staleFinalGate)
assert.equal(quoteValidated.orders.find((order: any) => order.triggerCondition.orderRef === activeSell.triggerCondition.orderRef).activationStatus, 'manual_confirmation_required')
const singleConfirmationQuoteValidated = finalizeVolatilityDraftSafety(staleFinalGate, { singleConfirmationMode: true })
assert.equal(singleConfirmationQuoteValidated.orders.find((order: any) => order.triggerCondition.orderRef === activeSell.triggerCondition.orderRef).activationStatus, 'dormant')
const singleConfirmationInput = structuredClone(fintech.grid)
const singleMarketableInput = singleConfirmationInput.orders.find((order: any) => order.price === .57 && order.orderRole === 'capacity_build')
singleMarketableInput.status = 'active'
singleMarketableInput.activationStatus = 'active'
const singleConfirmationMarketable = finalizeVolatilityDraftSafety(singleConfirmationInput, { singleConfirmationMode: true })
assert.equal(singleConfirmationMarketable.orders.find((order: any) => order.price === .57 && order.orderRole === 'capacity_build').activationStatus, 'dormant')
assert.equal(singleConfirmationMarketable.orders.some((order: any) => order.activationStatus === 'manual_confirmation_required'), false)

const constrained = compileVolatilityPortfolioBudget(result.assets, { principalLimit: 6_000, cashSpendLimit: 6_020 })
assert.equal(constrained.summary.status, 'passed')
assert.ok(constrained.summary.activeBuyPrincipal <= 6_000)
assert.ok(constrained.summary.immediateCashCommitment <= 6_020)
assert.deepEqual(constrained.summary.slept.map((row) => row.distanceAtr), [...constrained.summary.slept.map((row) => row.distanceAtr)].sort((a, b) => Number(b) - Number(a)))

const afterCounts = {
  positions: await prisma.position.count(),
  transactions: await prisma.transaction.count(),
  externalOrders: await prisma.externalOrderObservation.count(),
}
assert.deepEqual(afterCounts, beforeCounts, 'safety replay must not write positions, transactions, or broker observations')
await prisma.$disconnect()

console.log(JSON.stringify({
  status: 'PASS',
  tests: 19,
  fixedSnapshot: { candidates: currentCandidates.length, active: active.length, activeBuys: 4, activeSells: 6, manualConfirmation: manual.length },
  portfolioBudget: result.summary,
  deterministicReplay: { runs: 3, hash: hashes[0] },
  sideEffects: { before: beforeCounts, after: afterCounts, unchanged: true, brokerOrdersCreated: 0 },
}, null, 2))
