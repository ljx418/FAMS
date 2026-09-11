import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { gridStrategyService, type DowntrendDefensiveConfig } from '../src/services/strategy/gridStrategyService.js'

const state = JSON.parse(await readFile(resolve(process.cwd(), '../波动交易工作流迁移-20260908/strategy_state.json'), 'utf8'))
const positions = new Map(state.positions.map((position: any) => [position.symbol, position]))
const now = new Date('2026-09-11T04:00:00.000Z')
const availableCash = 34_210.77
const totalAssets = 224_036.25
const cashFloor = Number((totalAssets * .05).toFixed(2))
let remainingBudget = availableCash - cashFloor
for (const symbol of ['600276', '159851', '513770', '601127']) {
  const validation = gridStrategyService.validateDowntrendConfig((positions.get(symbol) as any).downtrend_grid)
  assert.equal(validation.valid, true, `${symbol} v2 config should validate`)
}
const invalidExit = structuredClone((positions.get('601127') as any).downtrend_grid)
invalidExit.levels.find((level: any) => level.orderRole === 'rebound_exit').parentOrderRef = 'S_SELL_5000'
assert.equal(gridStrategyService.validateDowntrendConfig(invalidExit).valid, false)

function build(symbol: string, close: number) {
  const position: any = positions.get(symbol)
  assert.ok(position?.downtrend_grid, `${symbol} downtrend config missing`)
  const draft = gridStrategyService.buildDowntrendDefensiveDraft({
    config: position.downtrend_grid as DowntrendDefensiveConfig,
    assetType: ['159851', '513770'].includes(symbol) ? 'etf' : 'stock',
    market: 'CN',
    currentQuantity: position.snapshot.quantity,
    sellableQuantity: position.snapshot.sellable_quantity,
    currentClose: close,
    cashBudget: availableCash,
    availablePortfolioBuyBudget: remainingBudget,
    portfolioValue: totalAssets,
    ignoreFrozenForCapacity: position.downtrend_grid.capacityOverride?.ignoreFrozenForCapacity === true,
    now,
  })
  assert.equal(draft.mode, 'downtrend_defensive')
  const commitment = Number((draft.derivation as any).cashGate.immediateCashCommitment)
  remainingBudget -= commitment
  return draft
}

const hengrui = build('600276', 42.14)
const fintech = build('159851', .595)
const hkInternet = build('513770', .331)
const seres = build('601127', 46.15)
const active = (draft: any) => draft.orders.filter((order: any) => order.activationStatus === 'active')
const byRef = (draft: any, ref: string) => draft.orders.find((order: any) => order.triggerCondition.orderRef === ref)

assert.deepEqual(active(hengrui).map((order: any) => [order.side, order.price, order.quantity]), [
  ['buy', 40.9, 100], ['buy', 39.5, 100], ['buy', 38.1, 100],
])
assert.equal(hengrui.orders.filter((order: any) => order.side === 'sell').every((order: any) => order.activationStatus === 'awaiting_parent_fill'), true)
assert.equal(hengrui.orders.filter((order: any) => order.side === 'sell').reduce((sum: number, order: any) => sum + order.quantity, 0), 300)
assert.equal((hengrui.derivation as any).allocation.currentCore, 800)
assert.equal((hengrui.derivation as any).allocation.stageBuildCapacity, 300)

assert.deepEqual(active(seres).map((order: any) => [order.orderRole, order.price, order.quantity]), [
  ['rebound_exit', 47.4, 100], ['rebound_exit', 48.7, 100],
  ['satellite_cycle', 50, 100], ['satellite_cycle', 52.7, 100],
])
assert.equal(seres.orders.filter((order: any) => order.orderRole === 'rebound_exit').reduce((sum: number, order: any) => sum + order.quantity, 0), 200)
assert.equal(seres.orders.filter((order: any) => order.orderRole === 'conditional_buyback').reduce((sum: number, order: any) => sum + order.quantity, 0), 200)
assert.equal(seres.orders.some((order: any) => order.parentOrderRef === 'S_EXIT_4740' || order.parentOrderRef === 'S_EXIT_4870'), false)
assert.equal(seres.orders.some((order: any) => order.orderRole === 'capacity_build'), false)

assert.equal(active(fintech).filter((order: any) => order.side === 'sell').reduce((sum: number, order: any) => sum + order.quantity, 0), 15_000)
assert.equal(byRef(fintech, 'F_SELL_655').activationStatus, 'awaiting_sellability')
assert.equal((fintech.derivation as any).allocation.nonCoreSellable, 17_100)
assert.deepEqual(active(fintech).filter((order: any) => order.orderRole === 'capacity_build').map((order: any) => order.price), [.57, .545])
assert.equal((hkInternet.derivation as any).allocation.ignoreFrozenForCapacity, true)
assert.equal(active(hkInternet).filter((order: any) => order.orderRole === 'capacity_build').reduce((sum: number, order: any) => sum + order.quantity, 0), 10_000)

const activeBuyPrincipal = [hengrui, fintech, hkInternet, seres]
  .flatMap((draft: any) => active(draft))
  .filter((order: any) => order.side === 'buy')
  .reduce((sum: number, order: any) => sum + order.amount, 0)
const fees = [hengrui, fintech, hkInternet, seres]
  .reduce((sum: number, draft: any) => sum + Number((draft.derivation as any).cashGate.immediateCashCommitment - (draft.derivation as any).cashGate.activeBuyPrincipal), 0)
assert.equal(activeBuyPrincipal, 20_575)
assert.equal(fees, 30)
assert.equal(Number((availableCash - activeBuyPrincipal - fees).toFixed(2)), 13_605.77)
assert.ok(availableCash - activeBuyPrincipal - fees >= cashFloor)

const pausedHengrui = gridStrategyService.buildDowntrendDefensiveDraft({
  config: (positions.get('600276') as any).downtrend_grid,
  assetType: 'stock', market: 'CN', currentQuantity: 800, sellableQuantity: 800,
  currentClose: 37.49, cashBudget: availableCash, availablePortfolioBuyBudget: availableCash - cashFloor,
  portfolioValue: totalAssets, now,
})
assert.equal(pausedHengrui.orders.filter((order: any) => order.orderRole === 'capacity_build').every((order: any) => order.activationStatus === 'dormant'), true)

const pausedFintech = gridStrategyService.buildDowntrendDefensiveDraft({
  config: (positions.get('159851') as any).downtrend_grid,
  assetType: 'etf', market: 'CN', currentQuantity: 60_000, sellableQuantity: 60_000,
  currentClose: .534, cashBudget: availableCash, availablePortfolioBuyBudget: availableCash - cashFloor,
  portfolioValue: totalAssets, now,
})
assert.equal(pausedFintech.orders.filter((order: any) => order.orderRole === 'capacity_build').every((order: any) => order.activationStatus === 'dormant'), true)
assert.equal(pausedFintech.orders.filter((order: any) => order.orderRole === 'conditional_buyback').every((order: any) => order.activationStatus === 'awaiting_parent_fill'), true)

const directBuyback = gridStrategyService.buildConditionalBuybackDraft({
  parentGridPlanId: 'test-plan', spacingAbsolute: 2, assetType: 'stock', market: 'CN', now,
  parentSellOrders: [
    { id: 'exit', level: 1, price: 47.4, quantity: 100, orderRole: 'rebound_exit', orderRef: 'S_EXIT_4740' },
    { id: 'cycle', level: 2, price: 50, quantity: 100, orderRole: 'satellite_cycle', orderRef: 'S_SELL_5000' },
  ],
})
assert.equal(directBuyback.orders.length, 1)
assert.equal(directBuyback.orders[0].parentOrderRef, 'S_SELL_5000')

assert.equal(state.authorization.live_execution_authorized, false)
assert.equal(state.authorization.broker_connection_available, false)
console.log(JSON.stringify({
  status: 'PASS', schemaVersion: state.grid_policy.schemaVersion,
  activeBuyPrincipal, feeReserve: fees, projectedCash: 13_605.77, cashFloor,
  activeOrders: { hengrui: active(hengrui).length, fintech: active(fintech).length, hkInternet: active(hkInternet).length, seres: active(seres).length },
  invariants: { coreNeverSold: true, reboundExitHasNoBuyback: true, sellabilityGate: true, pauseRules: true, brokerOrdersCreated: 0 },
}, null, 2))
