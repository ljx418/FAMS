import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { marketDataService, type ProviderReliabilitySnapshotItem } from '../src/services/market-data/marketDataService.js'
import {
  classifyMarketDataReliability,
  marketDataReliabilityService,
} from '../src/services/market-data/marketDataReliabilityService.js'

const userId = process.env.FAMS_USER_ID || 'default'

function provider(overrides: Partial<ProviderReliabilitySnapshotItem> = {}): ProviderReliabilitySnapshotItem {
  return {
    provider: 'eastmoney',
    label: 'Eastmoney',
    capabilities: ['quote'],
    attempted: true,
    successes: 1,
    failures: 0,
    fallbackHits: 0,
    consecutiveFailures: 0,
    lastSuccessAt: new Date().toISOString(),
    lastFailureAt: null,
    circuitOpen: false,
    circuitOpenUntil: null,
    healthScore: 1,
    status: 'healthy',
    ...overrides,
  }
}

async function protectedCounts() {
  const [positions, transactions, operations] = await Promise.all([
    prisma.position.count({ where: { userId, status: 'open' } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.operation.count({ where: { userId } }),
  ])
  return { positions, transactions, operations }
}

try {
  const before = await protectedCounts()
  assert.ok(before.positions > 0, 'Default account has no real open positions')

  const position = await prisma.position.findFirst({
    where: {
      userId,
      status: 'open',
      asset: { type: { in: ['stock', 'etf'] } },
    },
    include: { asset: true },
    orderBy: [{ marketValue: 'desc' }, { updatedAt: 'desc' }],
  })
  assert.ok(position?.asset?.symbol, 'No real stock/ETF holding is available for the provider probe')

  let liveProbeSucceeded = false
  let liveProbeFallbackUsed = false
  let liveProbeSource: string | null = null
  let liveProbeFailureCategory: 'provider_failure' | null = null
  try {
    const quote = await marketDataService.getQuote({
      symbol: position.asset.symbol,
      assetType: position.asset.type,
      source: 'auto',
    })
    liveProbeSucceeded = quote.isValid
    liveProbeFallbackUsed = quote.fallbackUsed
    liveProbeSource = quote.source
  } catch {
    liveProbeFailureCategory = 'provider_failure'
  }

  const semanticCases = [
    { id: 'fresh_healthy', expected: 'healthy', actual: classifyMarketDataReliability({ freshnessStatus: 'fresh', providers: [provider()] }).status },
    { id: 'delayed_is_degraded', expected: 'degraded', actual: classifyMarketDataReliability({ freshnessStatus: 'delayed', providers: [provider()] }).status },
    { id: 'fallback_is_degraded', expected: 'degraded', actual: classifyMarketDataReliability({ freshnessStatus: 'fresh', providers: [provider({ fallbackHits: 1 })] }).status },
    { id: 'failing_is_degraded', expected: 'degraded', actual: classifyMarketDataReliability({ freshnessStatus: 'fresh', providers: [provider({ successes: 0, failures: 1, healthScore: 0, status: 'failing' })] }).status },
    { id: 'unobserved_is_degraded', expected: 'degraded', actual: classifyMarketDataReliability({ freshnessStatus: 'fresh', providers: [provider({ attempted: false, successes: 0, lastSuccessAt: null, healthScore: 0, status: 'unknown' })] }).status },
    { id: 'stale_is_blocked', expected: 'blocked', actual: classifyMarketDataReliability({ freshnessStatus: 'stale', providers: [provider()] }).status },
    { id: 'unknown_is_blocked', expected: 'blocked', actual: classifyMarketDataReliability({ freshnessStatus: 'unknown', providers: [provider()] }).status },
  ]
  semanticCases.forEach((item) => assert.equal(item.actual, item.expected, `Semantic case failed: ${item.id}`))

  const report = await marketDataReliabilityService.buildReport({ userId, scope: 'holdings', limit: 300 })
  assert.ok(report.freshness.totalSymbols > 0, 'Reliability report has no real holding symbols')
  assert.equal(report.mode, 'free_source_research')
  assert.equal(report.realtimeGuarantee, false)
  assert.ok(['healthy', 'degraded', 'blocked'].includes(report.status))
  assert.deepEqual(report.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.equal(report.formalTradingUnlocked, false)
  assert.equal(report.autoTradeUnlocked, false)
  assert.equal(report.canCreateOrder, false)
  assert.equal(report.orderCreateAllowed, false)
  assert.ok(report.providerRuntime.every((item) => !/mock|fixture|test/i.test(item.provider)))
  assert.ok(report.providerRuntime.every((item) => !Object.prototype.hasOwnProperty.call(item, 'lastError')), 'Raw provider errors must be redacted')
  if (report.freshness.status === 'stale' || report.freshness.status === 'unknown') {
    assert.equal(report.status, 'blocked', 'Stale/unknown canonical data must block reliability')
  }
  if (report.providerRuntime.some((item) => item.fallbackHits > 0)) {
    assert.notEqual(report.status, 'healthy', 'Fallback evidence must not be healthy')
  }

  const after = await protectedCounts()
  assert.deepEqual(after, before, 'Reliability verification changed protected account facts')
  const audit = await marketDataReliabilityService.writeAudit(report)
  const serialized = JSON.stringify(report)
  assert.ok(!/(api[_-]?key|authorization|bearer\s+[a-z0-9._-]{8,}|accountAmount|marketValue)/i.test(serialized), 'Reliability report contains a secret or account amount field')

  console.log(JSON.stringify({
    schemaVersion: 'fams.market_data.reliability.verification.v1',
    status: 'passed',
    checkedAt: new Date().toISOString(),
    realData: {
      userId,
      openPositionCount: before.positions,
      probedSymbol: position.asset.symbol,
      providerAttempted: true,
      providerSucceeded: liveProbeSucceeded,
      providerFallbackUsed: liveProbeFallbackUsed,
      providerSource: liveProbeSource,
      failureCategory: liveProbeFailureCategory,
      canonicalFreshness: report.freshness.status,
      canonicalLatestTradeDate: report.freshness.latestTradeDate,
      reliabilityStatus: report.status,
    },
    semanticCases,
    protectedCountsBefore: before,
    protectedCountsAfter: after,
    auditPath: audit.path,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
} finally {
  await prisma.$disconnect().catch(() => undefined)
}
