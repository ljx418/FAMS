import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { scenarioComparisonService } from '../src/services/backtest/scenarioComparisonService.js'
import { simulateFrozenDowntrendGrid, type PointInTimeCandle } from '../src/services/backtest/pointInTimeGridSimulation.js'

const userId = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stable(child)}`).join(',')}}`
  return JSON.stringify(value)
}
const digest = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex')
const dateKey = (value: Date) => value.toISOString().slice(0, 10)

async function protectedDigest() {
  const [positions, transactions, advices, plans, versions] = await Promise.all([
    prisma.position.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.advice.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.gridPlan.findMany({ where: { userId }, orderBy: { id: 'asc' } }),
    prisma.strategyVersion.findMany({ where: { strategy: { userId } }, orderBy: { id: 'asc' } }),
  ])
  return {
    counts: { positions: positions.length, transactions: transactions.length, advices: advices.length, plans: plans.length, versions: versions.length },
    hash: digest({ positions, transactions, advices, plans, versions }),
  }
}

async function main() {
  const before = await protectedDigest()
  const sourceResponse = await scenarioComparisonService.listPointInTimeSources(userId)
  const source = sourceResponse.sources.find((item) => item.supported && item.observedFrom && item.observedThrough)
  assert.ok(source, 'a real frozen grid strategy with canonical OHLC is required')
  assert.equal(source.blockers.length, 0)

  const result = await scenarioComparisonService.compare({
    userId,
    sourceType: 'grid_plan',
    sourceId: source.sourceId,
    replayMode: 'point_in_time_simulation',
    startDate: source.observedFrom!,
    endDate: source.observedThrough!,
    initialCapital: 100000,
    commissionRate: 0.0003,
    slippageRate: 0.0005,
  })
  assert.equal(result.status, 'available', `point-in-time replay blocked: ${result.blockedReasons.join(',')}`)
  assert.equal(result.replayMode, 'point_in_time_simulation')
  assert.deepEqual(result.scenarios.map((item: any) => item.id), ['follow_advice', 'hold_without_action', 'actual_transactions'])
  assert.ok(result.dailyDecisions.length >= 30)
  assert.ok(result.dailyDecisions.every((item: any) => item.visibleThrough <= item.decisionDate))
  assert.ok(result.dailyDecisions.every((item: any) => Array.isArray(item.evidenceRefs) && item.evidenceRefs.length > 0))
  assert.ok(result.strategy.configHash.match(/^[a-f0-9]{64}$/))
  assert.ok(result.inputSnapshot.snapshotHash.match(/^[a-f0-9]{64}$/))
  assert.equal(result.strategy.historicalPolicyApplication, true, 'current frozen strategy applied retrospectively must be disclosed')
  assert.ok(result.warnings.includes('frozen_strategy_created_after_backtest_start_historical_policy_application'))
  assert.equal(result.permissionState.formalTradingUnlocked, false)
  assert.equal(result.permissionState.autoTradeUnlocked, false)
  assert.equal(result.permissionState.canCreateOrder, false)
  assert.equal(result.permissionState.orderCreateAllowed, false)

  const plan = await prisma.gridPlan.findUniqueOrThrow({
    where: { id: source.sourceId },
    include: { asset: true, strategyVersion: true, dailyReviewRun: { include: { positionSnapshots: true } } },
  })
  assert.ok(plan.strategyVersion)
  const rows = await prisma.marketBarCanonical.findMany({
    where: {
      symbol: source.symbol, market: 'CN', timeframe: '1d', dataVersion: 'canonical.v1',
      tradeDate: { gte: new Date(`${source.observedFrom}T00:00:00.000Z`), lte: new Date(`${source.observedThrough}T23:59:59.999Z`) },
    },
    orderBy: [{ tradeDate: 'asc' }, { updatedAt: 'desc' }],
  })
  const byDate = new Map<string, PointInTimeCandle>()
  const scores = new Map<string, number>()
  for (const row of rows) {
    const date = dateKey(row.tradeDate)
    const score = (row.adjustType === 'none' ? 100 : row.adjustType === 'qfq' ? 20 : 0) + (row.validationStatus === 'valid' ? 5 : 0)
    if ((scores.get(date) ?? -1) >= score) continue
    scores.set(date, score)
    byDate.set(date, {
      date, open: Number(row.openPrice || row.closePrice), high: Number(row.highPrice || row.closePrice),
      low: Number(row.lowPrice || row.closePrice), close: row.closePrice,
      provider: row.primaryProvider || 'market_bar_canonical', sourceRef: `market-bar-canonical:${row.id}`,
    })
  }
  const candles = Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  assert.ok(candles.length >= 30)
  const position = plan.dailyReviewRun?.positionSnapshots.find((item) => item.assetId === plan.assetId)
  const engineInput = {
    strategyVersionId: plan.strategyVersion!.id,
    strategyVersionCreatedAt: plan.strategyVersion!.createdAt.toISOString(),
    strategyAuditHash: plan.strategyVersion!.auditHash,
    strategyConfig: JSON.parse(plan.strategyVersion!.versionBundleJson),
    asset: { id: plan.assetId, symbol: source.symbol, assetType: plan.asset.type, market: 'CN' },
    initialQuantity: Number(position?.quantity || 0), initialCapital: 100000, commissionRate: 0.0003, slippageRate: 0.0005,
  }
  const prefixLength = Math.max(20, Math.floor(candles.length * 0.7))
  const prefix = simulateFrozenDowntrendGrid({ ...engineInput, candles: candles.slice(0, prefixLength) })
  const full = simulateFrozenDowntrendGrid({ ...engineInput, candles })
  assert.equal(prefix.status, 'available')
  assert.equal(full.status, 'available')
  assert.deepEqual(full.decisions.slice(0, prefixLength), prefix.decisions, 'later real bars must not change prior decisions')
  assert.deepEqual(full.curve.slice(0, prefixLength), prefix.curve, 'later real bars must not change prior equity points')

  const repeated = await scenarioComparisonService.compare({
    userId, sourceType: 'grid_plan', sourceId: source.sourceId, replayMode: 'point_in_time_simulation',
    startDate: source.observedFrom!, endDate: source.observedThrough!, initialCapital: 100000,
  })
  assert.equal(repeated.inputSnapshot.snapshotHash, result.inputSnapshot.snapshotHash)
  assert.deepEqual(repeated.scenarios, result.scenarios)
  const after = await protectedDigest()
  assert.deepEqual(after, before, 'point-in-time acceptance must not mutate protected account facts')

  const audit = {
    schemaVersion: 'fams.investment-workflow.point-in-time-simulation-audit.v1',
    status: 'passed',
    generatedAt: new Date().toISOString(),
    realData: {
      sourceId: source.sourceId, assetId: source.assetId, symbol: source.symbol, strategyVersionId: source.strategyVersionId,
      strategySchemaVersion: source.strategySchemaVersion, startDate: source.observedFrom, endDate: source.observedThrough,
      tradingDays: result.dailyDecisions.length, providers: result.dataHealth.providers,
      actualTransactionCount: result.dataHealth.transactionCount, inputSnapshotHash: result.inputSnapshot.snapshotHash,
    },
    scenarios: result.scenarios.map((item: any) => ({ id: item.id, points: item.curve.length, executedEvents: item.executedEvents.length, metrics: item.metrics })),
    gates: {
      realCanonicalOhlcUsed: true, frozenStrategyVersionUsed: true, dailyVisibilityBounded: true,
      futureRealBarAppendInvariancePassed: true, deterministicReplayPassed: true,
      retrospectivePolicyDisclosurePresent: true, protectedAccountDigestUnchanged: true,
      formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
    },
    protectedFacts: before,
  }
  const evidenceDir = resolve(process.cwd(), '../docs/automation-audits/investment-workflow/WF-8/evidence')
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(resolve(evidenceDir, 'point-in-time-simulation-audit.json'), JSON.stringify(audit, null, 2))
  console.log(JSON.stringify(audit, null, 2))
}

main().finally(() => prisma.$disconnect()).catch((error) => {
  console.error(error)
  process.exitCode = 1
})

