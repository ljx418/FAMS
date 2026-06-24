import assert from 'node:assert/strict'

const baseUrl = process.env.FAMS_API_URL || 'http://localhost:4000'
const userId = process.env.FAMS_USER_ID || 'default'

type MarketDataTraceItem = {
  symbol: string
  price: number | null
  source?: string | null
  sourceLabel?: string | null
  sourceTime?: string | null
  fallbackUsed?: boolean
}

type DailyAdviceResponse = {
  matchedPositions: number
  marketDataTrace?: MarketDataTraceItem[]
  dataReliability?: {
    overallStatus: string
    providerSummary: unknown[]
  }
}

type TargetResearchResponse = {
  targetName: string
  quote?: {
    symbol: string
    price: number
    source: string
    timestamp?: string | null
    sourceTime?: string | null
    fallbackUsed?: boolean
  }
  dataReliability?: {
    overallStatus: string
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

async function main() {
  const daily = await getJson<DailyAdviceResponse>(`/api/v1/analysis/investment-suggestions?userId=${encodeURIComponent(userId)}`)
  assert.ok(Array.isArray(daily.marketDataTrace), 'daily advice should include marketDataTrace')
  assert.equal(daily.marketDataTrace?.length, daily.matchedPositions, 'marketDataTrace should align with matched positions')
  assert.ok(daily.dataReliability?.providerSummary?.length, 'daily advice should include provider reliability summary')

  const sourcedItems = (daily.marketDataTrace || []).filter((item) => item.source || item.sourceLabel)
  assert.ok(sourcedItems.length > 0, 'marketDataTrace should include sourced market data')
  for (const item of sourcedItems) {
    assert.equal(typeof item.symbol, 'string', 'trace item symbol is required')
    assert.ok(typeof item.price === 'number' && item.price > 0, `${item.symbol} trace price should be positive`)
    assert.equal(item.fallbackUsed || false, false, `${item.symbol} should not use local fallback in baseline trace`)
  }

  const research = await postJson<TargetResearchResponse>('/api/v1/analysis/target-research', {
    userId,
    input: '513770',
    scope: 'asset',
  })
  assert.equal(research.quote?.symbol, '513770', 'target research quote symbol')
  assert.equal(research.quote?.source, 'sina', 'target research should expose quote source')
  assert.ok(research.quote?.timestamp || research.quote?.sourceTime, 'target research should expose quote source time')
  assert.equal(research.quote?.fallbackUsed || false, false, 'target research should not use local fallback for 513770')

  console.log(`analysis trace: dailyTrace=${daily.marketDataTrace?.length}, target=${research.quote?.symbol} source=${research.quote?.source}`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
