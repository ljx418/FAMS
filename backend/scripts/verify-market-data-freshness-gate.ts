import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { factsetRefreshScheduler } from '../src/services/operation/factsetRefreshScheduler.js'
import { marketDataFreshnessService } from '../src/services/market-data/marketDataFreshnessService.js'
import { ensureUser } from '../src/utils/user.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function main() {
  requireDevDbMutationAcknowledgement('verify-market-data-freshness-gate')

  const userId = 'default'
  await ensureUser(prisma, userId)

  const verificationNow = new Date('2026-07-13T10:00:00.000Z') // 18:00 Asia/Shanghai
  const expectedLatestTradeDate = marketDataFreshnessService.expectedLatestTradeDate(verificationNow, 'Asia/Shanghai', 17 * 60)
  assert.equal(expectedLatestTradeDate, '2026-07-13', 'Expected after-close weekday to require same-day market bars')

  const report = await marketDataFreshnessService.buildReport({
    userId,
    scope: 'active_strategy',
    limit: 300,
    now: verificationNow,
    timezone: 'Asia/Shanghai',
  })
  assert.equal(report.schemaVersion, 'fams.market_data.freshness.v1')
  assert.equal(report.expectedLatestTradeDate, '2026-07-13')
  assert.ok(['fresh', 'delayed', 'stale', 'unknown'].includes(report.status))
  assert.ok(report.totalSymbols >= 0, 'Freshness report should expose totalSymbols')
  assert.deepEqual(report.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.equal(report.notTradingAdvice, true)
  assert.equal(report.source.freeSourceStage, true)
  assert.equal(report.source.tushareUpgradeAvailable, true)
  if (report.status === 'stale' || report.status === 'unknown') {
    assert.ok(report.blockers.length > 0, 'stale/unknown freshness must expose blockers')
    assert.notEqual(report.recommendedAction, 'none', 'stale/unknown freshness must recommend a refresh action')
  }

  const audit = await marketDataFreshnessService.writeAudit(report)
  assert.ok(audit.path.endsWith('market_data_freshness_audit.json'), 'Expected market data freshness audit file')

  process.env.FAMS_FACTSET_SCHEDULER_LIMIT = '1'
  process.env.FAMS_FACTSET_SCHEDULER_HORIZON_MINUTES = '0'
  process.env.FAMS_MARKET_BAR_DAILY_REFRESH_ENABLED = 'true'
  process.env.FAMS_MARKET_BAR_DAILY_REFRESH_LIMIT = '3'
  process.env.FAMS_MARKET_BAR_DAILY_REFRESH_DAYS = '120'
  process.env.FAMS_MARKET_BAR_DAILY_REFRESH_FORCE = 'true'
  process.env.FAMS_DIVIDEND_LOW_VOL_DAILY_SCHEDULER_LIMIT = '1'

  await prisma.schedulerLease.upsert({
    where: { name: 'factset_refresh' },
    create: {
      name: 'factset_refresh',
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
    },
    update: {
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: null,
    },
  })

  const scheduled = await factsetRefreshScheduler.runOnce('verification_market_data_freshness_gate', console, verificationNow)
  assert.equal(scheduled.skipped, false, 'Scheduler should run after close when lease is available')
  assert.ok(scheduled.marketBarFreshness, 'Scheduler result should include marketBarFreshness')
  assert.equal(scheduled.marketBarFreshness.expectedLatestTradeDate, '2026-07-13')

  if (['stale', 'unknown'].includes(scheduled.marketBarFreshness.status)) {
    assert.ok(scheduled.marketBarDailyRefresh?.submitted, 'stale/unknown market bars should submit daily refresh')
    assert.equal(
      scheduled.dividendLowVolDailyScan?.reason,
      'market_bar_refresh_required',
      'stale/unknown market bars should block dividend low vol daily scan promotion',
    )
  } else {
    assert.ok(
      scheduled.dividendLowVolDailyScan?.submitted || scheduled.dividendLowVolDailyScan?.reason === 'submitted_or_existing',
      'fresh/delayed market bars should allow dividend low vol daily scan scheduling',
    )
  }

  console.log(JSON.stringify({
    ok: true,
    freshness: {
      status: report.status,
      expectedLatestTradeDate: report.expectedLatestTradeDate,
      latestTradeDate: report.latestTradeDate,
      lagTradingDays: report.lagTradingDays,
      totalSymbols: report.totalSymbols,
      blockers: report.blockers,
    },
    auditPath: audit.path,
    scheduler: {
      marketBarDailyRefresh: scheduled.marketBarDailyRefresh,
      marketBarFreshness: {
        status: scheduled.marketBarFreshness.status,
        expectedLatestTradeDate: scheduled.marketBarFreshness.expectedLatestTradeDate,
        latestTradeDate: scheduled.marketBarFreshness.latestTradeDate,
        lagTradingDays: scheduled.marketBarFreshness.lagTradingDays,
      },
      dividendLowVolDailyScan: scheduled.dividendLowVolDailyScan,
    },
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    factsetRefreshScheduler.stop()
    await prisma.$disconnect()
  })
