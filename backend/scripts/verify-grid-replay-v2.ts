import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  applyParentChildActivation,
  calculateSellableQuantity,
  calculateTransactionCosts,
  evaluateGridOrderEvidence,
  gridReplayService,
  roundBuyQuantityToLot,
  resolvePlanEffectiveValidity,
  type Candle,
  type CostModel,
} from '../src/services/backtest/gridReplayService.js'
import { callMcpTool, mcpTools } from '../src/mcp/registry.js'
import { prisma } from '../src/db/prisma.js'

const dailyBar = (date: string, low: number, high: number): Candle => ({
  date,
  open: (low + high) / 2,
  high,
  low,
  close: (low + high) / 2,
  volume: 1,
  provider: 'fixture',
  sourceRef: `fixture:${date}`,
  adjustType: 'none',
})

async function main() {
  const genericBacktestSource = await readFile(
    new URL('../src/services/backtest/backtestService.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(genericBacktestSource, /Math\.random/, 'generic backtest must not synthesize random prices')
  assert.doesNotMatch(genericBacktestSource, /initialCapital\s*\?\?\s*100_?000/, 'generic backtest must not invent default capital')
  assert.match(genericBacktestSource, /Real historical price data missing/, 'generic backtest must fail explicitly when real history is unavailable')

  const sameDay = dailyBar('2026-09-22', 9, 11)
  const nextDay = dailyBar('2026-09-23', 9, 11)

  const preOpen = evaluateGridOrderEvidence({
    decisionAt: new Date('2026-09-22T00:30:00.000Z'),
    validUntil: new Date('2026-09-22T07:00:00.000Z'),
    side: 'buy', limitPrice: 10, dailyBars: [sameDay], intradayBars: [],
  })
  assert.equal(preOpen.status, 'hit', 'pre-open order may use same-day daily OHLC')

  const intradayNoMinutes = evaluateGridOrderEvidence({
    decisionAt: new Date('2026-09-22T02:00:00.000Z'),
    validUntil: new Date('2026-09-22T07:00:00.000Z'),
    side: 'buy', limitPrice: 10, dailyBars: [sameDay], intradayBars: [],
  })
  assert.equal(intradayNoMinutes.status, 'insufficient_intraday_evidence', 'intraday daily bar must not look ahead')

  const intradayWithMinutes = evaluateGridOrderEvidence({
    decisionAt: new Date('2026-09-22T02:00:00.000Z'),
    validUntil: new Date('2026-09-22T07:00:00.000Z'),
    side: 'buy', limitPrice: 10, dailyBars: [sameDay], intradayBars: [{ ...sameDay, timestamp: '2026-09-22T03:00:00.000Z', timeframe: '1m' }],
  })
  assert.equal(intradayWithMinutes.status, 'hit')
  assert.equal(intradayWithMinutes.evidenceResolution, 'minute')

  const afterClose = evaluateGridOrderEvidence({
    decisionAt: new Date('2026-09-22T08:00:00.000Z'),
    validUntil: new Date('2026-09-23T07:00:00.000Z'),
    side: 'buy', limitPrice: 10, dailyBars: [sameDay, nextDay], intradayBars: [],
  })
  assert.equal(afterClose.status, 'hit')
  assert.equal(afterClose.hitDate, '2026-09-23', 'after-close order starts next session')

  const costs: CostModel = {
    commissionRate: 0.0003,
    minimumCommission: 5,
    stampDutyRate: 0.0005,
    transferFeeRate: 0.00001,
    slippageRate: 0.0005,
    stampDutyApplies: true,
    transferFeeApplies: true,
  }
  assert.equal(calculateTransactionCosts(10_000, 'buy', costs), 5.1)
  assert.equal(calculateTransactionCosts(10_000, 'sell', costs), 10.1)
  assert.equal(roundBuyQuantityToLot(550, 100), 500)
  assert.equal(calculateSellableQuantity([{ date: '2026-09-22', quantity: 100 }, { date: '2026-09-21', quantity: 200 }], '2026-09-22', true), 200)

  const validity = resolvePlanEffectiveValidity([
    { id: 'old', mode: 'mean_reversion', previousPlanId: null, parentScope: 'root', createdAt: new Date('2026-09-21T01:00:00Z'), validUntil: new Date('2026-09-30T07:00:00Z') },
    { id: 'child-scope', mode: 'mean_reversion', previousPlanId: null, parentScope: 'parent-order', createdAt: new Date('2026-09-21T02:00:00Z'), validUntil: new Date('2026-09-30T07:00:00Z') },
    { id: 'new', mode: 'mean_reversion', previousPlanId: 'old', parentScope: 'root', createdAt: new Date('2026-09-22T01:00:00Z'), validUntil: new Date('2026-09-30T07:00:00Z') },
  ])
  assert.equal(validity.get('old')?.toISOString(), '2026-09-22T01:00:00.000Z', 'new plan must supersede old plan')
  assert.equal(validity.get('child-scope')?.toISOString(), '2026-09-30T07:00:00.000Z', 'different parent scope must not supersede child plan')

  const parentMarkers = applyParentChildActivation([
    { id: 'parent', parentOrderId: null, status: 'hit', statusReason: '', hitDate: '2026-09-22', hitAt: null, evidenceResolution: 'daily' },
    { id: 'same-day-child', parentOrderId: 'parent', status: 'hit', statusReason: '', hitDate: '2026-09-22', hitAt: null, evidenceResolution: 'daily' },
    { id: 'later-child', parentOrderId: 'parent', status: 'hit', statusReason: '', hitDate: '2026-09-23', hitAt: null, evidenceResolution: 'daily' },
    { id: 'unfilled-parent', parentOrderId: null, status: 'missed', statusReason: '', hitDate: null, hitAt: null, evidenceResolution: null },
    { id: 'blocked-child', parentOrderId: 'unfilled-parent', status: 'hit', statusReason: '', hitDate: '2026-09-23', hitAt: null, evidenceResolution: 'daily' },
  ])
  assert.equal(parentMarkers[1].status, 'ambiguous')
  assert.equal(parentMarkers[2].status, 'hit')
  assert.equal(parentMarkers[4].status, 'blocked_parent_not_filled')

  for (const name of ['backtest.grid_replay.list_sources', 'backtest.grid_replay.run', 'backtest.grid_replay.get_result']) {
    assert.ok(mcpTools[name], `${name} must be registered`)
  }
  assert.equal(mcpTools['backtest.grid_replay.list_sources'].permissions.writes, false)
  assert.equal(mcpTools['backtest.grid_replay.run'].safety.execution, 'async_operation')
  assert.equal(mcpTools['backtest.grid_replay.get_result'].permissions.writes, false)

  const beforePositions = await prisma.position.findMany({
    where: { userId: 'default' },
    select: { id: true, quantity: true, avgCost: true, status: true, updatedAt: true },
    orderBy: { id: 'asc' },
  })
  const sourceEnvelope = await callMcpTool('backtest.grid_replay.list_sources', { userId: 'default' }, { transport: 'stdio', userId: 'default', userContextSource: 'stdio_context' })
  assert.equal(sourceEnvelope.status, 'completed')
  const sources = ((sourceEnvelope.result as any)?.sources || []).filter((source: any) => source.orderCount > 0)
  assert.ok(sources.length > 0, 'real database must expose at least one saved grid source')

  let intradayEvidenceCount = 0
  for (const source of sources) {
    const input = { userId: 'default', assetId: source.assetId, startDate: '2026-08-01', endDate: source.observedThrough || '2026-10-08' }
    const first: any = await gridReplayService.replay(input)
    const second: any = await gridReplayService.replay(input)
    assert.equal(first.inputSnapshot.snapshotHash, second.inputSnapshot.snapshotHash, `${source.symbol} replay hash must be deterministic`)
    assert.equal(first.permissionState.canCreateOrder, false)
    assert.equal(first.permissionState.autoTradeUnlocked, false)
    const falseMisses = first.markers.filter((marker: any) => marker.sessionPhase === 'intraday' && marker.decisionDate === marker.effectiveValidUntil && marker.status === 'missed')
    assert.equal(falseMisses.length, 0, `${source.symbol} has false same-day intraday misses`)
    intradayEvidenceCount += first.markers.filter((marker: any) => marker.status === 'insufficient_intraday_evidence').length
    if (first.blockedReasons.includes('post_decision_intraday_evidence_missing')) {
      assert.equal(first.status, 'insufficient')
      assert.equal(first.qualityAssessment.verdict, 'insufficient_evidence')
    }
  }
  assert.ok(intradayEvidenceCount > 0, 'real saved intraday plans must surface missing minute evidence')

  const operationSummaries: Array<Record<string, unknown>> = []
  for (const source of sources) {
    const operationEnvelope = await callMcpTool('backtest.grid_replay.run', {
      userId: 'default', assetId: source.assetId, startDate: '2026-08-01', endDate: source.observedThrough || '2026-10-08',
      idempotencyKey: `grid-replay-v2-acceptance-${source.symbol}-${Date.now()}`,
    }, { transport: 'stdio', userId: 'default', userContextSource: 'stdio_context' })
    assert.equal(operationEnvelope.status, 'completed')
    const operationId = String((operationEnvelope.result as any)?.operationId || '')
    assert.ok(operationId)
    const resultEnvelope = await callMcpTool('backtest.grid_replay.get_result', { userId: 'default', operationId }, { transport: 'stdio', userId: 'default', userContextSource: 'stdio_context' })
    assert.equal(resultEnvelope.status, 'completed')
    assert.equal((resultEnvelope.result as any)?.type, 'grid_replay_backtest')
    const replay = (resultEnvelope.result as any)?.result
    assert.equal(replay?.schemaVersion, 'fams.backtest.grid_replay.v3')
    assert.ok(Array.isArray(replay?.executionAttribution?.confirmed))
    assert.ok(Array.isArray(replay?.executionAttribution?.unmatchedOrUnconfirmed))
    operationSummaries.push({
      symbol: source.symbol,
      operationId,
      status: replay.status,
      verdict: replay.qualityAssessment.verdict,
      evidenceConfidence: replay.qualityAssessment.evidenceConfidence,
      simulatedIncrementalReturnVsHoldPercent: replay.qualityAssessment.simulated.incrementalReturnVsHoldPercent,
      simulatedMaxDrawdownDeltaVsHoldPercent: replay.qualityAssessment.simulated.maxDrawdownDeltaVsHoldPercent,
      simulatedExecutedAdviceCount: replay.qualityAssessment.simulated.executedAdviceCount,
      simulatedCompletedCycles: replay.qualityAssessment.simulated.completedCycles,
      actualEvaluationStatus: replay.qualityAssessment.actual.evaluationStatus,
      actualAttributionCoveragePercent: replay.qualityAssessment.actual.attributionCoveragePercent,
      markerSummary: replay.markerSummary,
      blockedReasons: replay.blockedReasons,
    })
  }

  const afterPositions = await prisma.position.findMany({
    where: { userId: 'default' },
    select: { id: true, quantity: true, avgCost: true, status: true, updatedAt: true },
    orderBy: { id: 'asc' },
  })
  assert.deepEqual(afterPositions, beforePositions, 'grid replay must not mutate positions')
  console.log(JSON.stringify({
    ok: true,
    fixtureCoverage: ['real_data_guard', 'pre_open', 'intraday_missing', 'intraday_minute', 'after_close', 'fees', 'lot_size', 't_plus_one', 'plan_supersession', 'parent_child_activation'],
    realSources: sources.map((source: any) => source.symbol),
    intradayEvidenceCount,
    operationSummaries,
  }, null, 2))
}

main().finally(() => prisma.$disconnect())
