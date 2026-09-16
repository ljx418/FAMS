import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import {
  pointInTimeSimulationBlocker,
  scenarioComparisonService,
  validateActualTransactionRows,
} from '../src/services/backtest/scenarioComparisonService.js'

const userId = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'

async function counts() {
  const [advices, plans, positions, transactions] = await Promise.all([
    prisma.advice.count({ where: { userId } }),
    prisma.gridPlan.count({ where: { userId } }),
    prisma.position.count({ where: { userId } }),
    prisma.transaction.count({ where: { userId } }),
  ])
  return { advices, plans, positions, transactions }
}

async function main() {
  const before = await counts()
  const advice = await prisma.advice.findFirst({
    where: {
      userId,
      adviceInputSnapshotId: { not: null },
      actions: { some: { actionType: { in: ['buy', 'sell'] } } },
    },
    include: { actions: { where: { actionType: { in: ['buy', 'sell'] } } } },
    orderBy: { generatedAt: 'asc' },
  })
  assert.ok(advice, 'a real persisted advice snapshot with buy/sell actions is required')
  const latestBar = await prisma.marketBarCanonical.findFirst({
    where: { tradeDate: { lte: new Date() }, dataVersion: 'canonical.v1' },
    orderBy: { tradeDate: 'desc' },
  })
  assert.ok(latestBar)
  const request = {
    userId,
    sourceType: 'advice' as const,
    sourceId: advice.id,
    replayMode: 'saved_advice_replay' as const,
    startDate: advice.generatedAt.toISOString().slice(0, 10),
    endDate: latestBar.tradeDate.toISOString().slice(0, 10),
  }
  const result = await scenarioComparisonService.compare(request)
  assert.equal(result.status, 'available', `real replay blocked: ${result.blockedReasons.join(',')}`)
  assert.equal(result.scenarios.length, 3)
  assert.deepEqual(result.scenarios.map((scenario) => scenario.id), ['follow_advice', 'hold_without_action', 'actual_transactions'])
  assert.ok(result.scenarios[0].curve.length >= 2)
  assert.ok(result.scenarios.every((scenario) => scenario.curve.length === result.scenarios[0].curve.length))
  assert.deepEqual(
    result.scenarios.map((scenario) => scenario.curve.map((point) => point.date)),
    [0, 1, 2].map(() => result.scenarios[0].curve.map((point) => point.date)),
    'all scenarios must share one timeline',
  )
  assert.ok(result.executionAssumptions.firstAdviceExecutionDate > advice.generatedAt.toISOString().slice(0, 10))
  assert.equal(result.dataHealth.actualTransactionReconciliation, 'exact')
  assert.ok(result.dataHealth.providers.length > 0)
  assert.equal(result.permissionState.formalTradingUnlocked, false)
  assert.equal(result.permissionState.autoTradeUnlocked, false)
  assert.equal(result.permissionState.canCreateOrder, false)
  assert.equal(result.permissionState.orderCreateAllowed, false)

  const repeated = await scenarioComparisonService.compare(request)
  assert.equal(repeated.inputSnapshot.snapshotHash, result.inputSnapshot.snapshotHash)
  assert.deepEqual(repeated.scenarios, result.scenarios)

  const pointInTime = await scenarioComparisonService.compare({ ...request, replayMode: 'point_in_time_simulation' })
  assert.equal(pointInTime.status, 'insufficient')
  assert.ok(pointInTime.blockedReasons.includes('frozen_strategy_version_required_for_point_in_time_simulation'))
  assert.equal(
    pointInTimeSimulationBlocker('frozen-strategy-version-fixture'),
    'point_in_time_dynamic_recompute_not_implemented',
    'a frozen strategy version must not bypass the missing dynamic recompute implementation',
  )

  const mismatch = validateActualTransactionRows([{
    id: 'negative-fixture',
    type: 'buy',
    status: 'confirmed',
    quantity: 100,
    price: 10,
    amount: 1,
    fee: 0,
    executedAt: new Date('2026-08-21T00:00:00.000Z'),
    asset: { symbol: '000001' },
  }])
  assert.equal(mismatch.status, 'insufficient')
  assert.ok(mismatch.blockers.includes('transaction_amount_mismatch:negative-fixture'))

  const actualScenario = result.scenarios.find((scenario) => scenario.id === 'actual_transactions')!
  const firstActual = actualScenario.executedEvents.find((event) => ['buy', 'sell'].includes(event.type))
  if (firstActual) {
    const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: firstActual.id } })
    assert.equal(firstActual.fillPrice, stored.price, 'actual replay must use stored execution price')
  }

  const after = await counts()
  assert.deepEqual(after, before, 'scenario comparison must be read-only')
  const output = {
    schemaVersion: 'fams.investment-workflow.scenario-comparison-audit.v1',
    status: 'passed',
    realData: {
      adviceId: advice.id,
      adviceGeneratedAt: advice.generatedAt.toISOString(),
      startDate: request.startDate,
      endDate: request.endDate,
      observedThrough: result.inputSnapshot.observedThrough,
      providers: result.dataHealth.providers,
      snapshotHash: result.inputSnapshot.snapshotHash,
      transactionCount: result.dataHealth.transactionCount,
    },
    scenarios: result.scenarios.map((scenario) => ({
      id: scenario.id,
      pointCount: scenario.curve.length,
      executedEventCount: scenario.executedEvents.length,
      metrics: scenario.metrics,
    })),
    gates: {
      sharedTimeline: true,
      nextTradableExecution: true,
      actualUsesStoredExecutionPrice: true,
      deterministicReplay: true,
      pointInTimeWithoutFrozenVersionBlocked: true,
      pointInTimeWithFrozenVersionStillBlockedUntilDynamicRecomputeExists: true,
      amountMismatchRejected: true,
      protectedCountsUnchanged: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }
  const evidenceDir = resolve(process.cwd(), '../docs/automation-audits/investment-workflow/WF-5/evidence')
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(resolve(evidenceDir, 'scenario-comparison-contract-audit.json'), JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
