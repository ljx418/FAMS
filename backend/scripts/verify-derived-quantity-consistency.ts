import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'

const EPSILON = 0.02

async function main() {
  const positions = await prisma.position.findMany({
    where: {
      status: 'open',
      asset: { type: { in: ['fund', 'bond', 'gold'] } },
    },
    include: { asset: true },
  })

  let checked = 0
  for (const position of positions) {
    if (!position.currentPrice || position.currentPrice <= 0 || !position.marketValue || position.marketValue <= 0) {
      continue
    }

    checked += 1
    const expectedQuantity = position.marketValue / position.currentPrice
    const expectedAvgCost = (position.costBasis || 0) / expectedQuantity
    assert.ok(
      Math.abs(position.quantity - expectedQuantity) <= EPSILON,
      `${position.asset.symbol} quantity should equal marketValue/currentPrice: expected ${expectedQuantity}, got ${position.quantity}`,
    )
    assert.ok(
      Math.abs(position.avgCost - expectedAvgCost) <= EPSILON,
      `${position.asset.symbol} avgCost should equal costBasis/quantity: expected ${expectedAvgCost}, got ${position.avgCost}`,
    )
  }

  console.log(`derived quantity consistency: checked=${checked}`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
