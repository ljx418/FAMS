import assert from 'node:assert/strict'

const tolerance = 0.000001

function buy(current: { quantity: number; costBasis: number }, trade: { quantity: number; price: number; fee: number }) {
  const quantity = current.quantity + trade.quantity
  const costBasis = current.costBasis + trade.quantity * trade.price + trade.fee
  return {
    quantity,
    costBasis,
    avgCost: costBasis / quantity,
  }
}

function sellTonghuashun(
  current: { quantity: number; costBasis: number },
  trade: { quantity: number; price: number; fee: number }
) {
  const sellProceeds = trade.quantity * trade.price - trade.fee
  const quantity = current.quantity - trade.quantity
  const costBasis = quantity > 0 ? current.costBasis - sellProceeds : 0
  return {
    quantity,
    sellProceeds,
    costBasis,
    avgCost: quantity > 0 ? costBasis / quantity : 0,
    realizedPnlForOpenPosition: 0,
  }
}

function assertClose(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, got ${actual}`)
}

function verifyRecentSellTrades() {
  const cases = [
    {
      symbol: '513770',
      before: { quantity: 94800, costBasis: 47115.6 },
      trade: { quantity: 12000, price: 0.43, fee: 10 },
      expected: { quantity: 82800, sellProceeds: 5150, costBasis: 41965.6, avgCost: 0.5068309178743962 },
    },
    {
      symbol: '159851',
      before: { quantity: 51200, costBasis: 41011.2 },
      trade: { quantity: 13100, price: 0.769, fee: 0 },
      expected: { quantity: 38100, sellProceeds: 10073.9, costBasis: 30937.3, avgCost: 0.812002624671916 },
    },
    {
      symbol: '601127',
      before: { quantity: 2000, costBasis: 268412.8 },
      trade: { quantity: 100, price: 91.6, fee: 10 },
      expected: { quantity: 1900, sellProceeds: 9150, costBasis: 259262.8, avgCost: 136.4541052631579 },
    },
  ]

  for (const item of cases) {
    const result = sellTonghuashun(item.before, item.trade)
    assertClose(result.quantity, item.expected.quantity, `${item.symbol} quantity`)
    assertClose(result.sellProceeds, item.expected.sellProceeds, `${item.symbol} sell proceeds`)
    assertClose(result.costBasis, item.expected.costBasis, `${item.symbol} cost basis`)
    assertClose(result.avgCost, item.expected.avgCost, `${item.symbol} avg cost`)
    assert.equal(result.realizedPnlForOpenPosition, 0, `${item.symbol} open position realized pnl`)
    console.log(`${item.symbol}: avgCost=${result.avgCost}, costBasis=${result.costBasis}`)
  }
}

function verifyBuyAfterSell() {
  const afterSell = sellTonghuashun(
    { quantity: 1000, costBasis: 10000 },
    { quantity: 200, price: 8, fee: 5 }
  )
  assertClose(afterSell.quantity, 800, 'after sell quantity')
  assertClose(afterSell.costBasis, 8405, 'after sell cost basis')
  assertClose(afterSell.avgCost, 10.50625, 'after sell avg cost')

  const afterBuy = buy(afterSell, { quantity: 100, price: 9, fee: 5 })
  assertClose(afterBuy.quantity, 900, 'after buy quantity')
  assertClose(afterBuy.costBasis, 9310, 'after buy cost basis')
  assertClose(afterBuy.avgCost, 10.344444444444445, 'after buy avg cost')
  console.log(`buy-after-sell: avgCost=${afterBuy.avgCost}, costBasis=${afterBuy.costBasis}`)
}

function main() {
  verifyRecentSellTrades()
  verifyBuyAfterSell()
}

main()
