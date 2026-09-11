import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { marketDataFreshnessService } from '../src/services/market-data/marketDataFreshnessService.js'

const now = new Date()

try {
  const report = await marketDataFreshnessService.buildReport({
    userId: process.env.FAMS_USER_ID || 'default',
    scope: 'active_strategy',
    limit: 300,
    now,
    timezone: 'Asia/Shanghai',
  })

  const expectedLatestTradeDate = marketDataFreshnessService.expectedLatestTradeDate(now, 'Asia/Shanghai')
  assert.equal(report.expectedLatestTradeDate, expectedLatestTradeDate, 'Report did not use the execution-time freshness boundary')
  assert.ok(report.totalSymbols > 0, 'Current freshness report has no active-strategy symbols')
  assert.ok(report.latestTradeDate, 'Current freshness report has no latest trade date')
  assert.ok(['fresh', 'delayed'].includes(report.status), `Current market data is not acceptable: ${report.status}`)
  assert.ok(report.lagTradingDays !== null && report.lagTradingDays <= 1, `Latest market data lags ${String(report.lagTradingDays)} trading days`)
  assert.deepEqual(report.blockers, [], `Current freshness blockers: ${report.blockers.join(', ')}`)
  assert.equal(report.notTradingAdvice, true)
  assert.deepEqual(report.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.ok(
    report.providerSummary.every((item) => !/mock|fixture|test/i.test(item.provider)),
    'Current freshness report contains a test provider',
  )
  assert.ok(
    report.providerSummary.every((item) => item.provider !== 'eastmoney_cumulative_nav'),
    'Fund cumulative NAV must be validated by the fund workflow, not the canonical stock-bar freshness gate',
  )

  const audit = await marketDataFreshnessService.writeAudit(report)
  console.log(JSON.stringify({
    schemaVersion: 'fams.current_market_data_freshness_verification.v1',
    status: 'passed',
    checkedAt: now.toISOString(),
    expectedLatestTradeDate: report.expectedLatestTradeDate,
    latestTradeDate: report.latestTradeDate,
    freshnessStatus: report.status,
    lagTradingDays: report.lagTradingDays,
    totalSymbols: report.totalSymbols,
    freshSymbols: report.freshSymbols,
    delayedSymbols: report.delayedSymbols,
    staleSymbols: report.staleSymbols,
    unknownSymbols: report.unknownSymbols,
    auditPath: audit.path,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
  }, null, 2))
} finally {
  await prisma.$disconnect().catch(() => undefined)
}
