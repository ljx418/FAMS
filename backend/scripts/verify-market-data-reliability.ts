import assert from 'node:assert/strict'

const baseUrl = process.env.FAMS_API_URL || 'http://localhost:4000'
const userId = process.env.FAMS_USER_ID || 'default'

type PriceResponse = {
  symbol: string
  assetType: string
  price: number | null
  source: string | null
  timestamp: string | null
  fallbackUsed: boolean
  warnings?: string[]
}

type ResolveResponse = {
  normalizedSymbol: string
  assetType: string
  matchedAsset?: { type: string } | null
}

type OperationResponse = {
  id: string
  operation_id?: string
  operationId?: string
  status: string
  progressPct?: number
  result?: {
    refreshed?: number
    failed?: number
    externalRefreshed?: number
    retainedLocalPrices?: number
    results?: Array<{
      symbol: string
      success: boolean
      source?: string
      fallbackUsed?: boolean
      abnormalPriceJump?: boolean
    }>
  }
}

type PositionListResponse = {
  data: Array<{
    quantity: number
    currentPrice: number
    costBasis: number
    marketValue: number
    unrealizedPnl: number
    asset: {
      symbol: string
      type: string
      lastPriceSource?: string | null
    }
  }>
}

type TargetResearchResponse = {
  identity?: {
    assetType: string
    normalizedSymbol: string
  }
  quote?: {
    source?: string
    timestamp?: string
    fallbackUsed?: boolean
  }
  dataReliability?: {
    warnings?: string[]
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`)
  assert.equal(response.ok, true, `${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  assert.equal(response.ok, true, `${path} returned ${response.status}`)
  return response.json() as Promise<T>
}

async function postRaw(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

async function verifyResolve(symbol: string, expectedType: string) {
  const resolved = await getJson<ResolveResponse>(`/api/v1/assets/resolve?input=${encodeURIComponent(symbol)}`)
  assert.equal(resolved.assetType, expectedType, `${symbol} should resolve as ${expectedType}`)
  console.log(`resolve ${symbol}: ${resolved.assetType}`)
}

async function verifyQuote(symbol: string, expected: { assetType: string; sources: string[] }) {
  const quote = await getJson<PriceResponse>(`/api/v1/prices/realtime?symbol=${encodeURIComponent(symbol)}`)
  assert.equal(quote.assetType, expected.assetType, `${symbol} assetType`)
  assert.equal(quote.fallbackUsed, false, `${symbol} should not use local fallback`)
  assert.equal(typeof quote.price, 'number', `${symbol} should return numeric price`)
  assert.ok(quote.price !== null && quote.price > 0, `${symbol} should return positive price`)
  assert.ok(quote.timestamp, `${symbol} should return source timestamp`)
  assert.ok(quote.source && expected.sources.includes(quote.source), `${symbol} source ${quote.source} not in ${expected.sources.join(', ')}`)
  console.log(`quote ${symbol}: ${quote.price} from ${quote.source} at ${quote.timestamp}`)
}

async function pollOperation(operationId: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const operation = await getJson<OperationResponse>(`/api/v1/operations/${operationId}`)
    if (['completed', 'failed', 'cancelled'].includes(operation.status)) {
      return operation
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`Operation ${operationId} did not finish in time`)
}

async function verifyFullRefresh() {
  const positions = await getJson<PositionListResponse>(`/api/v1/positions?userId=${encodeURIComponent(userId)}&limit=100`)
  const heldSymbols = new Set(positions.data.map((position) => position.asset.symbol))
  const started = await postJson<OperationResponse>('/api/v1/operations/refresh-prices', { userId })
  const operationId = started.operation_id || started.operationId || started.id
  assert.ok(operationId, 'refresh operation id is required')
  const operation = await pollOperation(operationId)

  assert.equal(operation.status, 'completed', 'refresh operation should complete')
  assert.equal(operation.result?.failed, 0, 'refresh should have no failed items')
  assert.equal(operation.result?.retainedLocalPrices, 0, 'refresh should not retain local prices')
  assert.ok((operation.result?.externalRefreshed || 0) > 0, 'refresh should update from external sources')

  const results = operation.result?.results || []
  for (const symbol of ['513770', '015311', '009725', '007467', '006476', '021634']) {
    if (!heldSymbols.has(symbol)) {
      continue
    }
    const result = results.find((item) => item.symbol === symbol)
    assert.ok(result, `refresh result should include ${symbol}`)
    assert.equal(result.success, true, `${symbol} refresh should succeed`)
    assert.equal(result.fallbackUsed || false, false, `${symbol} should not use local fallback`)
    assert.equal(result.abnormalPriceJump || false, false, `${symbol} should not be flagged as abnormal jump in baseline regression`)
  }

  console.log(`refresh ${operationId}: external=${operation.result?.externalRefreshed}, failed=0, retained=0`)
}

async function verifyPositionPriceSource() {
  const positions = await getJson<PositionListResponse>(`/api/v1/positions?userId=${encodeURIComponent(userId)}&limit=100`)
  const position = positions.data.find((item) => item.asset.symbol === '513770')
  assert.ok(position, '513770 position should exist')
  assert.equal(position.asset.lastPriceSource, 'sina', '513770 position should expose latest price source')
  console.log(`position 513770 source: ${position.asset.lastPriceSource}`)
}

function assertClose(actual: number, expected: number, message: string, tolerance = 0.01) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, got ${actual}`)
}

function isExchangeTradedFundCode(symbol: string) {
  return /^(159|510|511|512|513|515|516|517|518|520|560|561|562|563|588|589)\d{3}$/.test(symbol)
}

function isManualTotalValueFund(position: PositionListResponse['data'][number]) {
  if (position.asset.type !== 'fund' && position.asset.type !== 'bond') return false
  if (isExchangeTradedFundCode(position.asset.symbol)) return false
  if (position.quantity <= 1) return true
  return false
}

async function verifyFundValuation() {
  const positions = await getJson<PositionListResponse>(`/api/v1/positions?userId=${encodeURIComponent(userId)}&limit=100`)

  for (const symbol of ['019062', '011613', '014064', '021634', '015311', '007467', '014674', '015916', '013597', '012857', '501008']) {
    const position = positions.data.find((item) => item.asset.symbol === symbol)
    if (!position) {
      continue
    }
    if (isManualTotalValueFund(position)) {
      assert.ok(position.marketValue > 1000, `${symbol} manual market value should be preserved as total amount`)
    } else {
      assertClose(position.marketValue, position.quantity * position.currentPrice, `${symbol} market value should equal quantity × latest NAV`)
    }
    assertClose(position.unrealizedPnl, position.marketValue - position.costBasis, `${symbol} unrealized PnL should equal market value - cost basis`)
  }

  for (const symbol of ['013785', '009725', '014086']) {
    const position = positions.data.find((item) => item.asset.symbol === symbol)
    assert.ok(position, `${symbol} bond position should exist`)
    assertClose(position.marketValue, position.quantity * position.currentPrice, `${symbol} bond market value should equal quantity × latest NAV`)
    assertClose(position.unrealizedPnl, position.marketValue - position.costBasis, `${symbol} bond unrealized PnL should equal market value - cost basis`)
  }

  console.log('fund valuation: share-based funds and bonds recalculated; only quantity<=1 manual total-value positions preserved')
}

async function verifyAnalysisUsesResolver() {
  const research = await postJson<TargetResearchResponse>('/api/v1/analysis/target-research', {
    userId,
    input: '513770',
    scope: 'asset',
  })
  assert.equal(research.identity?.assetType, 'etf', 'target research should use resolver identity for 513770')
  assert.equal(research.quote?.source, 'sina', 'target research should include quote source')
  assert.equal(research.quote?.fallbackUsed || false, false, 'target research should not use local fallback for 513770')
  assert.ok(research.quote?.timestamp, 'target research should include source timestamp')

  const llmResponse = await postRaw('/api/v1/llm/stock-advice', { symbol: '513770', market: 'A股' })
  assert.equal(llmResponse.status, 400, 'LLM stock advice should reject ETF symbol 513770')
  const body = await llmResponse.json() as { identity?: { assetType?: string } }
  assert.equal(body.identity?.assetType, 'etf', 'LLM rejection should include resolver identity')
  console.log('analysis resolver guard: 513770 target research ok, LLM stock advice rejected ETF')
}

async function main() {
  await verifyResolve('513770', 'etf')
  await verifyResolve('007467', 'fund')
  await verifyResolve('019062', 'fund')
  await verifyResolve('012857', 'fund')

  await verifyQuote('513770', { assetType: 'etf', sources: ['sina'] })
  await verifyQuote('015311', { assetType: 'fund', sources: ['eastmoney_nav'] })
  await verifyQuote('009725', { assetType: 'bond', sources: ['eastmoney_nav'] })
  await verifyQuote('007467', { assetType: 'fund', sources: ['eastmoney_nav'] })
  await verifyQuote('006476', { assetType: 'fund', sources: ['eastmoney_nav'] })
  await verifyQuote('021634', { assetType: 'fund', sources: ['eastmoney_nav'] })

  await verifyFullRefresh()
  await verifyPositionPriceSource()
  await verifyFundValuation()
  await verifyAnalysisUsesResolver()
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
