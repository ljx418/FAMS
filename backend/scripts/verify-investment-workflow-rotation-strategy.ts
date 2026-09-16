import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { investmentWorkflowService } from '../src/services/investment-workflow/investmentWorkflowService.js'
import { rotationVolatilityStrategyService } from '../src/services/investment-workflow/rotationVolatilityStrategyService.js'

const userId = `wf3-real-bars-${Date.now()}`
const symbols = ['000001', '603323']
const createdAssetIds: string[] = []

async function main() {
  const bars = await Promise.all(symbols.map((symbol) => prisma.marketBarCanonical.findMany({
    where: { symbol, market: 'CN', timeframe: '1d', dataVersion: 'canonical.v1' },
    orderBy: { tradeDate: 'desc' },
    take: 120,
  })))
  assert.ok(bars.every((rows) => rows.length >= 120), 'WF-3 requires at least 120 real canonical bars for each peer')
  assert.ok(bars.flat().every((bar) => Boolean(bar.primaryProvider)), 'real canonical bars must identify their provider')

  await prisma.user.create({ data: { id: userId, email: `${userId}@local.test`, name: 'WF3 isolated contract user', passwordHash: 'wf3-contract-no-login' } })
  const positions = []
  for (let index = 0; index < symbols.length; index += 1) {
    const symbol = symbols[index]
    const existing = await prisma.asset.findUnique({ where: { symbol } })
    const latest = bars[index][0]
    const asset = existing || await prisma.asset.create({
      data: {
        symbol,
        name: symbol === '000001' ? '平安银行' : '苏农银行',
        type: 'stock',
        exchange: symbol.startsWith('6') ? 'SH' : 'SZ',
        lastPrice: latest.closePrice,
        lastUpdated: latest.tradeDate,
      },
    })
    if (!existing) createdAssetIds.push(asset.id)
    const position = await prisma.position.create({
      data: {
        userId,
        assetId: asset.id,
        quantity: 1000,
        avgCost: latest.closePrice,
        currentPrice: latest.closePrice,
        marketValue: latest.closePrice * 1000,
        costBasis: latest.closePrice * 1000,
        tags: JSON.stringify(['同花顺', '账户:ths']),
        labels: JSON.stringify(['行业轮动']),
        source: 'wf3_isolated_contract_fixture_using_real_market_bars',
        openKey: `${userId}:${asset.id}`,
      },
    })
    positions.push(position)
  }

  await assert.rejects(
    () => investmentWorkflowService.createResearchSnapshot({ userId, strategyFamily: 'rotation_volatility', accountSource: 'tonghuashun' }),
    /No confirmed positions/,
    'unconfirmed strategy assignments must block snapshot creation',
  )

  for (const position of positions) {
    await investmentWorkflowService.confirmAssignment({
      userId,
      positionId: position.id,
      strategyFamily: 'rotation_volatility',
      confirmedBy: 'wf3-contract-test',
    })
  }

  const snapshot = await investmentWorkflowService.createResearchSnapshot({
    userId,
    strategyFamily: 'rotation_volatility',
    accountSource: 'tonghuashun',
  })
  const repeatedSnapshot = await investmentWorkflowService.createResearchSnapshot({
    userId,
    strategyFamily: 'rotation_volatility',
    accountSource: 'tonghuashun',
  })
  assert.equal(repeatedSnapshot.id, snapshot.id, 'identical real inputs must reuse the immutable snapshot')
  assert.equal(repeatedSnapshot.inputHash, snapshot.inputHash)
  const resolvedIndustries = snapshot.input.positions.map((position: any) => position.industry)
  assert.ok(resolvedIndustries.every(Boolean) && new Set(resolvedIndustries).size === 1, 'real canonical quote-list classification must build one peer group')
  assert.ok(snapshot.providerSummary.some((provider) => provider.includes('sina')), 'canonical provider must be disclosed')
  assert.ok(snapshot.providerSummary.some((provider) => provider.includes('quote_list') || provider === 'asset_master'), 'the provider actually used for industry classification must be disclosed')

  const transactionsBefore = await prisma.transaction.count({ where: { userId } })
  const result = await rotationVolatilityStrategyService.run({ userId, snapshot, materialChange: 'none' })
  const transactionsAfter = await prisma.transaction.count({ where: { userId } })
  assert.equal(transactionsAfter, transactionsBefore)
  assert.equal(result.targets.length, 2)
  assert.equal(result.transactionSideEffectCount, 0)
  assert.equal(result.permissionState.formalTradingUnlocked, false)
  assert.equal(result.permissionState.autoTradeUnlocked, false)
  assert.ok(result.targets.every((target) => target.result.signalLayers.map((layer) => layer.id).join(',') === 'peer_group,rrg_rank,ma_trend,macd_momentum,volume_confirmation,grid_constraints'))
  assert.ok(result.targets.every((target) => target.result.signalLayers[0].status === 'passed'))
  assert.ok(result.targets.every((target) => target.result.manualOrderDrafts.length === 0), 'stale end-of-day prices must not produce a precise new draft')
  assert.ok(result.targets.every((target) => target.result.blockedReasons.includes('precise_quote_within_15_minutes_unavailable')))

  const secondRun = await rotationVolatilityStrategyService.run({ userId, snapshot, materialChange: 'none' })
  assert.deepEqual(
    secondRun.targets.map((target) => target.result.signalLayers.map((layer) => ({ id: layer.id, status: layer.status, value: layer.value }))),
    result.targets.map((target) => target.result.signalLayers.map((layer) => ({ id: layer.id, status: layer.status, value: layer.value }))),
    'the same immutable snapshot must produce deterministic signal values',
  )

  const reviewRun = await prisma.dailyReviewRun.create({
    data: {
      userId,
      sessionType: 'wf3_contract',
      triggerSource: 'isolated_contract_test',
      status: 'completed',
      completedAt: new Date(),
    },
  })
  const reusablePlan = await prisma.gridPlan.create({
    data: {
      userId,
      dailyReviewRunId: reviewRun.id,
      assetId: positions[0].assetId,
      mode: 'trend_pullback',
      status: 'draft',
      summary: 'WF-3 有效既有人工计划复用合同',
      validUntil: new Date(Date.now() + 60 * 60 * 1000),
      evidenceRefsJson: JSON.stringify(['wf3:existing-plan-contract']),
      orders: {
        create: [{
          side: 'buy',
          level: 1,
          price: Number((bars[0][0].closePrice * 0.98).toFixed(2)),
          quantity: 100,
          amount: Number((bars[0][0].closePrice * 0.98 * 100).toFixed(2)),
          validUntil: new Date(Date.now() + 60 * 60 * 1000),
          rationale: '仅验证已有人工计划优先复用，不创建订单。',
        }],
      },
    },
  })
  const reuseRun = await rotationVolatilityStrategyService.run({ userId, snapshot, positionIds: [positions[0].id], materialChange: 'none' })
  assert.equal(reuseRun.targets[0].result.previousPlanComparison?.previousPlanId, reusablePlan.id)
  assert.equal(reuseRun.targets[0].result.previousPlanComparison?.disposition, 'reuse')
  assert.equal(reuseRun.targets[0].result.manualOrderDrafts.length, 1)
  assert.equal(reuseRun.targets[0].result.manualOrderDrafts[0].createsOrder, false)
  assert.equal(await prisma.transaction.count({ where: { userId } }), transactionsBefore)

  const output = {
    schemaVersion: result.schemaVersion,
    status: 'passed',
    realData: {
      symbols,
      barCounts: bars.map((rows) => rows.length),
      asOf: bars.map((rows) => rows[0].tradeDate.toISOString()),
      providers: Array.from(new Set(bars.flat().map((bar) => bar.primaryProvider))),
      industry: snapshot.input.positions.map((position: any) => position.industry),
      industryProvider: snapshot.input.positions.map((position: any) => position.industryEvidence?.provider),
      snapshotHash: snapshot.inputHash,
    },
    gates: {
      unconfirmedAssignmentBlocked: true,
      peerGroupResolvedFromRealIndustryFacts: true,
      hierarchicalSignalLayerCount: result.targets[0].result.signalLayers.length,
      preciseDraftBlockedWithoutFreshQuote: true,
      deterministicReplay: true,
      existingGridPlanReused: true,
      transactionSideEffectCount: result.transactionSideEffectCount,
      formalTradingUnlocked: result.permissionState.formalTradingUnlocked,
      autoTradeUnlocked: result.permissionState.autoTradeUnlocked,
      canCreateOrder: result.permissionState.canCreateOrder,
      orderCreateAllowed: result.permissionState.orderCreateAllowed,
    },
  }
  const evidenceDir = resolve(process.cwd(), '../docs/automation-audits/investment-workflow/WF-3/evidence')
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(resolve(evidenceDir, 'rotation-volatility-contract-audit.json'), JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
}

main().finally(async () => {
  await prisma.user.deleteMany({ where: { id: userId } })
  if (createdAssetIds.length > 0) await prisma.asset.deleteMany({ where: { id: { in: createdAssetIds } } })
  await prisma.$disconnect()
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
