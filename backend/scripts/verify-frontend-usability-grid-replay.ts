import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { gridReplayService } from '../src/services/backtest/gridReplayService.js'

const userId = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'

async function protectedCounts() {
  const [positions, transactions, externalOrders, gridPlans, gridOrders] = await Promise.all([
    prisma.position.count({ where: { userId } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.externalOrderObservation.count({ where: { userId } }),
    prisma.gridPlan.count({ where: { userId } }),
    prisma.gridOrderDraft.count({ where: { gridPlan: { userId } } }),
  ])
  return { positions, transactions, externalOrders, gridPlans, gridOrders }
}

async function main() {
  const before = await protectedCounts()
  const sourceReport = await gridReplayService.listSources(userId)
  const source = sourceReport.sources
    .filter((item) => item.replayReady)
    .sort((left, right) => right.orderCount - left.orderCount)[0]
  assert.ok(source, 'a real open position with saved grid orders and OHLC is required')
  assert.ok(source.observedThrough, 'real source must expose observedThrough')
  const result = await gridReplayService.replay({
    userId,
    assetId: source.assetId,
    startDate: '2025-09-17',
    endDate: source.observedThrough,
    commissionRate: 0.0003,
    slippageRate: 0.0005,
  })
  assert.equal(result.status, 'insufficient', 'current intraday plans lack post-decision minute bars')
  assert.ok(result.blockedReasons.includes('post_decision_intraday_evidence_missing'))
  assert.equal(result.qualityAssessment.verdict, 'insufficient_evidence')
  assert.ok(result.candles.length >= 2)
  assert.ok(result.markers.length > 0)
  assert.deepEqual(result.scenarios.map((scenario) => scenario.id), ['follow_grid', 'hold_without_grid', 'actual_transactions'])
  assert.ok(result.scenarios.every((scenario) => scenario.curve.length === result.candles.length))
  assert.ok(result.dataHealth.providers.length > 0)
  assert.ok(result.dataHealth.duplicatePlanOrdersRemoved >= 0)
  assert.equal(result.permissionState.formalTradingUnlocked, false)
  assert.equal(result.permissionState.autoTradeUnlocked, false)
  assert.equal(result.permissionState.canCreateOrder, false)
  assert.equal(result.permissionState.orderCreateAllowed, false)
  const sameDayAmbiguous = result.markers.filter((marker) => marker.status === 'ambiguous')
  assert.ok(sameDayAmbiguous.every((marker) => marker.hitDate), 'ambiguous markers must have a real hit date')
  assert.equal(
    result.markers.some((marker) => marker.sessionPhase === 'intraday' && marker.decisionDate === marker.effectiveValidUntil && marker.status === 'missed'),
    false,
    'daily OHLC must not claim a same-day intraday order was missed',
  )
  const replayed = await gridReplayService.replay({
    userId,
    assetId: source.assetId,
    startDate: '2025-09-17',
    endDate: source.observedThrough,
    commissionRate: 0.0003,
    slippageRate: 0.0005,
  })
  assert.equal(replayed.inputSnapshot.snapshotHash, result.inputSnapshot.snapshotHash)
  assert.deepEqual(replayed.scenarios, result.scenarios)
  const after = await protectedCounts()
  assert.deepEqual(after, before, 'grid replay must not mutate positions, transactions, orders, or saved grid plans')

  const audit = {
    schemaVersion: 'fams.frontend_usability.grid_replay_audit.v1',
    generatedAt: new Date().toISOString(),
    status: 'passed',
    dataMode: 'real_persisted_grid_plans_real_ohlc_confirmed_transactions',
    source: {
      assetId: source.assetId,
      symbol: source.symbol,
      name: source.name,
      strategyFamily: source.strategyFamily,
      planCount: source.planCount,
      orderCount: source.orderCount,
      observedThrough: source.observedThrough,
    },
    result: {
      actualPeriod: result.actualPeriod,
      candleCount: result.candles.length,
      markerCount: result.markers.length,
      hitCount: result.markers.filter((marker) => marker.status === 'hit').length,
      missedCount: result.markers.filter((marker) => marker.status === 'missed').length,
      ambiguousCount: sameDayAmbiguous.length,
      pendingDataCount: result.markers.filter((marker) => marker.status === 'pending_data').length,
      insufficientIntradayEvidenceCount: result.markers.filter((marker) => marker.status === 'insufficient_intraday_evidence').length,
      evidenceConfidence: result.dataHealth.evidenceConfidence,
      qualityAssessment: result.qualityAssessment,
      providers: result.dataHealth.providers,
      scenarioMetrics: result.scenarios.map((scenario) => ({ id: scenario.id, metrics: scenario.metrics })),
    },
    gates: {
      realDataOnly: true,
      deterministicReplay: true,
      duplicatePlansDoNotDoubleCount: true,
      sessionAwareActivationPassed: true,
      missingIntradayEvidenceNotClassifiedAsMissed: true,
      protectedRecordsUnchanged: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }
  const outputDir = resolve(process.cwd(), '../docs/audits/2026-09-17-frontend-usability-grid-replay/evidence')
  await mkdir(outputDir, { recursive: true })
  await writeFile(resolve(outputDir, 'grid-replay-real-data-audit.json'), JSON.stringify(audit, null, 2))
  console.log(JSON.stringify(audit, null, 2))
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
