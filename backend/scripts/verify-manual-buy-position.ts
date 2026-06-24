import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'

const baseUrl = process.env.FAMS_API_URL || 'http://localhost:4000'
const userId = process.env.FAMS_USER_ID || 'default'
const prisma = new PrismaClient()

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const text = await response.text()
  assert.equal(response.ok, true, `${path} returned ${response.status}: ${text}`)
  return (text ? JSON.parse(text) : null) as T
}

async function main() {
  const symbol = `TESTADD${Date.now()}`
  try {
    const result = await requestJson<any>('/api/v1/positions/manual-buy', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        input: symbol,
        name: '临时新增持仓验证',
        assetType: 'fund',
        amount: 8000,
        price: 1.25,
        fee: 0,
        tags: ['验证'],
      }),
    })

    assert.equal(result.position.asset.symbol, symbol)
    assert.equal(Number(result.position.quantity.toFixed(4)), 6400)
    assert.equal(result.position.marketValue, 8000)
    assert.equal(result.transaction.type, 'buy')

    console.log(JSON.stringify({
      ok: true,
      symbol,
      quantity: result.position.quantity,
      marketValue: result.position.marketValue,
      transactionType: result.transaction.type,
    }, null, 2))
  } finally {
    await prisma.transaction.deleteMany({ where: { asset: { symbol } } })
    await prisma.position.deleteMany({ where: { asset: { symbol } } })
    await prisma.asset.deleteMany({ where: { symbol } })
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  await prisma.$disconnect()
  console.error(error)
  process.exit(1)
})
