import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { marketDataService } from '../src/services/market-data/marketDataService.js'
import { priceService } from '../src/services/price/priceService.js'

const EPSILON = 0.02

function assertClose(actual: number | null | undefined, expected: number, message: string) {
  assert.ok(actual !== null && actual !== undefined, `${message}: actual is empty`)
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: expected ${expected}, got ${actual}`)
}

async function main() {
  const originalWarn = console.warn
  console.warn = () => undefined

  const manualPositions = await prisma.position.findMany({
    where: {
      status: 'open',
      asset: { type: { in: ['cash', 'gold'] } },
    },
    include: { asset: true },
  })

  const cashPositions = manualPositions.filter((position) => position.asset.type === 'cash')
  assert.ok(cashPositions.length >= 1, 'expected at least one cash position')

  for (const position of cashPositions) {
    assertClose(position.currentPrice, 1, `${position.asset.name} cash currentPrice`)
    assertClose(position.quantity, position.marketValue || 0, `${position.asset.name} cash quantity should equal marketValue`)
    assertClose(position.costBasis, position.marketValue || 0, `${position.asset.name} cash costBasis should equal marketValue`)
    assertClose(position.unrealizedPnl, 0, `${position.asset.name} cash unrealizedPnl`)
  }

  const goldPositions = manualPositions.filter((position) => position.asset.type === 'gold')
  assert.ok(goldPositions.length >= 1, 'expected at least one gold position')

  const goldQuote = await priceService.getGoldPrice()
  assert.equal(goldQuote.isValid, true, `gold quote should be valid: ${goldQuote.error || 'unknown error'}`)
  assert.ok(goldQuote.price > 200, `gold quote should be CNY/gram, got ${goldQuote.price}`)

  const refreshResult = await marketDataService.refreshAssetMarketData({
    assetIds: [...new Set(goldPositions.map((position) => position.assetId))],
  })
  assert.equal(refreshResult.failed, 0, `gold refresh should not fail: ${JSON.stringify(refreshResult.results)}`)
  for (const result of refreshResult.results) {
    assert.equal(result.success, true, `${result.symbol} refresh should succeed`)
    assert.ok((result.price || 0) > 200, `${result.symbol} should refresh to CNY/gram gold price, got ${result.price}`)
    assert.notEqual(result.source, 'sina', `${result.symbol} gold refresh must not use stock quote source`)
  }

  const refreshedGoldPositions = await prisma.position.findMany({
    where: {
      status: 'open',
      asset: { type: 'gold' },
    },
    include: { asset: true },
  })
  for (const position of refreshedGoldPositions) {
    assert.ok((position.currentPrice || 0) > 200, `${position.asset.name} currentPrice should be CNY/gram`)
    assertClose(position.marketValue, position.quantity * (position.currentPrice || 0), `${position.asset.name} marketValue`)
  }

  console.log(`manual asset editing: cash=${cashPositions.length}, gold=${goldPositions.length}, goldPrice=${goldQuote.price}`)
  console.warn = originalWarn
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
