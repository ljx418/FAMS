import assert from 'node:assert/strict'

const baseUrl = process.env.FAMS_API_URL || 'http://localhost:4000'
const userId = process.env.FAMS_USER_ID || 'default'

type Position = {
  id: string
  quantity: number
  avgCost: number
  currentPrice: number
  costBasis: number
  marketValue: number
  unrealizedPnl: number
  unrealizedPnlPercent: number
  currentWeight: number
  tags: string[]
  asset: {
    symbol: string
    name: string
    type: string
  }
}

type PositionListResponse = {
  data: Position[]
  summary: {
    totalValue: number
    totalCost: number
    totalPnl: number
    totalPnlPercent: number
    positionsCount: number
    cashValue: number
    cashWeight: number
  }
}

type PositionBin = {
  tag: string
  totalCurrent: number
  totalPnl: number
  totalPnlPercent: number
  assets: Array<{
    symbol: string
    value: number
    pnl: number
    pnlPercent: number
    proportion: number
  }>
}

type PositionBinsResponse = {
  bins: PositionBin[]
  totalValue: number
}

type TagResponse = Array<{ name: string }>

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`)
  assert.equal(response.ok, true, `${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

function assertClose(actual: number, expected: number, message: string, tolerance = 0.02) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`)
}

function isManualTotalValuePosition(position: Position) {
  if (position.asset.type !== 'fund' && position.asset.type !== 'bond') return false
  if (/^(159|510|511|512|513|515|516|517|518|520|560|561|562|563|588|589)\d{3}$/.test(position.asset.symbol)) return false
  if (position.quantity <= 1) return true
  return false
}

async function main() {
  const positionsResponse = await getJson<PositionListResponse>(`/api/v1/positions?userId=${encodeURIComponent(userId)}&limit=500`)
  const binsResponse = await getJson<PositionBinsResponse>(`/api/v1/positions/by-tag/${encodeURIComponent(userId)}`)
  const tags = await getJson<TagResponse>('/api/v1/tags')
  const knownTags = new Set(tags.map((tag) => tag.name))
  const positions = positionsResponse.data

  const totalValue = positions.reduce((sum, position) => sum + (position.marketValue || 0), 0)
  const totalCost = positions.reduce((sum, position) => sum + (position.costBasis || 0), 0)
  const totalPnl = positions.reduce((sum, position) => sum + (position.unrealizedPnl || 0), 0)
  const cashValue = positions
    .filter((position) => position.asset.type === 'cash')
    .reduce((sum, position) => sum + (position.marketValue || 0), 0)

  assert.equal(positionsResponse.summary.positionsCount, positions.length, 'summary positionsCount should match returned open positions')
  assertClose(positionsResponse.summary.totalValue, totalValue, 'summary totalValue should equal sum(position.marketValue)')
  assertClose(positionsResponse.summary.totalCost, totalCost, 'summary totalCost should equal sum(position.costBasis)')
  assertClose(positionsResponse.summary.totalPnl, totalPnl, 'summary totalPnl should equal sum(position.unrealizedPnl)')
  assertClose(positionsResponse.summary.totalPnl, positionsResponse.summary.totalValue - positionsResponse.summary.totalCost, 'summary totalPnl should equal value - cost')
  assertClose(positionsResponse.summary.cashValue, cashValue, 'summary cashValue should equal cash positions')

  for (const position of positions) {
    assertClose(position.costBasis, position.quantity * position.avgCost, `${position.asset.symbol} costBasis should equal quantity × avgCost`)
    assertClose(position.unrealizedPnl, position.marketValue - position.costBasis, `${position.asset.symbol} unrealizedPnl should equal marketValue - costBasis`)
    if (!isManualTotalValuePosition(position)) {
      assertClose(position.marketValue, position.quantity * position.currentPrice, `${position.asset.symbol} marketValue should equal quantity × currentPrice`)
    }
    for (const tag of position.tags || []) {
      assert.ok(knownTags.has(tag), `${position.asset.symbol} tag ${tag} should exist in tag registry`)
    }
  }

  const binsTotalValue = binsResponse.totalValue * 10000
  const binsAssetValue = binsResponse.bins.reduce(
    (sum, bin) => sum + bin.assets.reduce((assetSum, asset) => assetSum + asset.value * 10000, 0),
    0,
  )
  const binsPnl = binsResponse.bins.reduce((sum, bin) => sum + bin.totalPnl * 10000, 0)
  const binsAssetCount = binsResponse.bins.reduce((sum, bin) => sum + bin.assets.length, 0)

  assertClose(binsTotalValue, positionsResponse.summary.totalValue, 'by-tag totalValue should equal summary totalValue')
  assertClose(binsAssetValue, positionsResponse.summary.totalValue, 'by-tag asset values should equal summary totalValue')
  assertClose(binsPnl, positionsResponse.summary.totalPnl, 'by-tag totalPnl should equal summary totalPnl')
  assert.equal(binsAssetCount, positions.length, 'by-tag assets should include each open position exactly once')

  for (const bin of binsResponse.bins) {
    const binAssetValue = bin.assets.reduce((sum, asset) => sum + asset.value, 0)
    assertClose(bin.totalCurrent, binAssetValue, `${bin.tag} totalCurrent should equal asset values`, 0.0001)
  }

  console.log(`position consistency: positions=${positions.length}, totalValue=${positionsResponse.summary.totalValue.toFixed(2)}, bins=${binsResponse.bins.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
