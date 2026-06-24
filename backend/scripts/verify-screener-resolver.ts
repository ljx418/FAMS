import assert from 'node:assert/strict'

const baseUrl = process.env.FAMS_API_URL || 'http://localhost:4000'
const userId = process.env.FAMS_USER_ID || 'default'

type ScreenerResponse = {
  query: string
  strategyDefinition?: {
    id: string
    thresholds: Record<string, number>
    requiredHistoryDays: number
  }
  universeSize: number
  universeTotal?: number
  scannedCount?: number
  universeSource?: string
  dataQuality?: {
    screened: number
    insufficientHistory: number
    totalUniverse?: number
    scanned?: number
    scanCoveragePercent?: number
    historySources: string[]
  }
  candidates: Array<{ symbol: string; name: string }>
  observability?: {
    elapsedMs: number
    providerSuccessRate: number
    failureCount: number
  }
  excludedUniverse?: Array<{
    symbol: string
    name: string
    localType: string
    resolvedType: string
    market: string
    reason: string
  }>
  failures: Array<{ symbol: string; error: string }>
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
  const result = await postJson<ScreenerResponse>('/api/v1/analysis/stock-screener', {
    userId,
    query: 'A杀后近20个交易日横盘，最近两个交易日成交量明显放大；扫描上限=120',
  })

  assert.equal(result.universeSource, 'sina_hs_a_all_a_share', 'screener should use full A-share universe')
  assert.ok(result.universeSize >= 3000, `screener universe should include all A-shares, got ${result.universeSize}`)
  assert.equal(result.scannedCount, 120, 'regression should scan the configured sample count')
  assert.ok(Array.isArray(result.excludedUniverse), 'screener should expose excluded universe diagnostics')
  assert.equal(result.strategyDefinition?.id, 'a_flush_sideways_volume', 'screener should expose structured strategy definition')
  assert.equal(result.strategyDefinition?.thresholds.drawdownPercent, 18, 'default drawdown threshold should be explicit')
  assert.ok(result.observability, 'screener should expose observability metrics')
  assert.equal(result.observability?.failureCount, result.failures.length, 'observability failure count should match failures')
  assert.ok(result.dataQuality, 'screener should expose data quality diagnostics')
  assert.equal(result.failures.length, 0, `baseline screener should not have insufficient history failures: ${result.failures.map((item) => `${item.symbol}:${item.error}`).join('; ')}`)
  assert.equal(result.dataQuality?.insufficientHistory, 0, 'baseline screener should have complete history coverage')
  assert.ok((result.dataQuality?.historySources || []).length > 0, 'screener should expose history provider sources')

  const invalidCandidates = result.candidates.filter((item) => !/^\d{6}$/.test(item.symbol))
  assert.equal(invalidCandidates.length, 0, `invalid stock candidates: ${invalidCandidates.map((item) => item.symbol).join(', ')}`)
  const failedCandidate = result.candidates.find((candidate) => result.failures.some((failure) => failure.symbol === candidate.symbol))
  assert.equal(failedCandidate, undefined, `${failedCandidate?.symbol} should not be a candidate when history is insufficient`)

  const excluded513770 = (result.excludedUniverse || []).find((item) => item.symbol === '513770')
  if (excluded513770) {
    assert.equal(excluded513770.resolvedType, 'etf', '513770 should be excluded from stock screener as ETF')
  }

  console.log(
    `screener resolver: universe=${result.universeSize}, candidates=${result.candidates.length}, excluded=${result.excludedUniverse?.length || 0}, failures=${result.failures.length}`
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
