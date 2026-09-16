import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { investmentStrategyResultSchema } from '../src/services/investment-workflow/investmentStrategyResultContract.js'
import { investmentWorkflowService } from '../src/services/investment-workflow/investmentWorkflowService.js'

const userId = `wf2-contract-${Date.now()}`

async function main() {
  const assets = await prisma.asset.findMany({ where: { type: { in: ['stock', 'etf'] } }, orderBy: { updatedAt: 'desc' }, take: 200 })
  const assetBySymbol = new Map(assets.map((candidate) => [candidate.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, ''), candidate]))
  const latestBar = await prisma.marketBarCanonical.findFirst({
    where: {
      symbol: { in: [...assetBySymbol.keys()] },
      market: 'CN',
      timeframe: '1d',
      dataVersion: 'canonical.v1',
    },
    orderBy: { tradeDate: 'desc' },
  })
  const asset = latestBar ? assetBySymbol.get(latestBar.symbol) || null : null
  assert.ok(asset && latestBar, 'WF-2 requires an existing asset with canonical market data')

  await prisma.user.create({ data: { id: userId, email: `${userId}@local.fams`, passwordHash: 'test-only', name: 'WF-2 contract' } })
  const position = await prisma.position.create({
    data: {
      userId,
      assetId: asset.id,
      openKey: `${userId}:${asset.id}`,
      quantity: 100,
      avgCost: latestBar.closePrice,
      currentPrice: latestBar.closePrice,
      marketValue: latestBar.closePrice * 100,
      costBasis: latestBar.closePrice * 100,
      tags: JSON.stringify(['账户:同花顺']),
      source: 'wf2_real_data_contract',
    },
  })
  await investmentWorkflowService.suggestAssignments(userId)
  const blocked = await investmentWorkflowService.getReadiness(userId)
  const blockedRotation = blocked.strategies.find((item) => item.strategyFamily === 'rotation_volatility')!
  assert.equal(blockedRotation.researchReady, false)
  assert.ok(blockedRotation.blockers.includes('strategy_assignment_confirmation_required'))

  const beforeTransactions = await prisma.transaction.count({ where: { userId } })
  await investmentWorkflowService.confirmAssignment({
    userId,
    positionId: position.id,
    strategyFamily: 'rotation_volatility',
    confirmedBy: 'wf2_contract',
  })
  const ready = await investmentWorkflowService.getReadiness(userId)
  const readyRotation = ready.strategies.find((item) => item.strategyFamily === 'rotation_volatility')!
  assert.equal(readyRotation.researchReady, true)
  assert.equal(readyRotation.manualDraftReady, false)
  assert.equal(await prisma.transaction.count({ where: { userId } }), beforeTransactions)
  assert.equal(ready.permissionState.formalTradingUnlocked, false)
  assert.equal(ready.permissionState.canCreateOrder, false)

  const validResult = {
    schemaVersion: 'fams.investment-strategy-result.v1',
    strategyFamily: 'rotation_volatility',
    strategyVersion: 'wf2-contract-v1',
    inputSnapshotId: 'snapshot-contract',
    snapshotHash: 'a'.repeat(64),
    asOf: latestBar.tradeDate.toISOString(),
    dataHealth: { status: 'fresh', providers: [latestBar.primaryProvider || 'unknown'], blockers: [], warnings: [] },
    conclusion: { status: 'observe', title: '等待策略信号', summary: '当前只验证统一结果合同。' },
    signalLayers: [],
    previousPlanComparison: null,
    manualOrderDrafts: [],
    invalidationConditions: [],
    evidenceRefs: [],
    blockedReasons: [],
    permissionState: {
      researchAllowed: true,
      manualDraftAllowed: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    },
  }
  assert.equal(investmentStrategyResultSchema.safeParse(validResult).success, true)
  assert.equal(investmentStrategyResultSchema.safeParse({
    ...validResult,
    permissionState: { ...validResult.permissionState, formalTradingUnlocked: true },
  }).success, false)
  assert.equal(investmentStrategyResultSchema.safeParse({
    ...validResult,
    conclusion: { status: 'blocked', title: '阻断', summary: '缺少输入。' },
    blockedReasons: [],
  }).success, false)

  console.log(JSON.stringify({
    schemaVersion: 'fams.wf2-readiness-acceptance.v1',
    status: 'passed',
    realData: { symbol: latestBar.symbol, asOf: latestBar.tradeDate, provider: latestBar.primaryProvider },
    gates: {
      unconfirmedAssignmentBlocksResearch: true,
      confirmedAssignmentUnlocksResearchOnly: true,
      manualDraftRemainsBlockedUntilStrategySignal: true,
      unifiedResultRuntimeSchemaPassed: true,
      falseTradingStateRejected: true,
      blockedWithoutReasonRejected: true,
      transactionSideEffectCount: 0,
    },
  }, null, 2))
}

main()
  .finally(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
    await prisma.$disconnect()
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
