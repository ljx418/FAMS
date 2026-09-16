import assert from 'node:assert/strict'
import { unlink } from 'node:fs/promises'
import { prisma } from '../src/db/prisma.js'
import { screenshotCaptureService } from '../src/services/capture/screenshotCaptureService.js'
import { investmentWorkflowService } from '../src/services/investment-workflow/investmentWorkflowService.js'

const userId = `wf1-contract-${Date.now()}`
let capturePath: string | null = null

async function main() {
  const [currentPositions, fallbackAssets] = await Promise.all([
    prisma.position.findMany({
      where: {
        userId: 'default',
        status: 'open',
        asset: { type: { in: ['stock', 'etf'] } },
      },
      include: { asset: true },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    }),
    prisma.asset.findMany({
      where: { type: { in: ['stock', 'etf'] } },
      orderBy: { updatedAt: 'desc' },
      take: 200,
    }),
  ])
  const assets = [
    ...currentPositions.map((position) => position.asset),
    ...fallbackAssets.filter((asset) => !currentPositions.some((position) => position.assetId === asset.id)),
  ]
  const candidateSymbols = [...new Set(assets
    .map((asset) => asset.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, ''))
    .filter((symbol) => /^\d{6}$/.test(symbol)))]
  const barCounts = await prisma.marketBarCanonical.groupBy({
    by: ['symbol'],
    where: {
      symbol: { in: candidateSymbols },
      market: 'CN',
      timeframe: '1d',
      dataVersion: 'canonical.v1',
    },
    _count: { _all: true },
  })
  const barCountBySymbol = new Map(barCounts.map((row) => [row.symbol, row._count._all]))
  const realAsset = assets.find((asset) => (barCountBySymbol.get(asset.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, '')) || 0) >= 30) || null
  const realBarCount = realAsset
    ? barCountBySymbol.get(realAsset.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, '')) || 0
    : 0
  assert.ok(realAsset, 'WF-1 real-data acceptance requires an existing asset with at least 30 canonical daily bars')

  await prisma.user.create({
    data: { id: userId, email: `${userId}@local.fams`, passwordHash: 'contract-test-only', name: 'WF-1 contract test' },
  })
  const position = await prisma.position.create({
    data: {
      userId,
      assetId: realAsset.id,
      openKey: `${userId}:${realAsset.id}`,
      quantity: 100,
      avgCost: realAsset.lastPrice || 1,
      currentPrice: realAsset.lastPrice || 1,
      marketValue: (realAsset.lastPrice || 1) * 100,
      costBasis: (realAsset.lastPrice || 1) * 100,
      tags: JSON.stringify(['账户:同花顺']),
      source: 'wf1_real_data_contract',
    },
  })

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5ZQAAAABJRU5ErkJggg==', 'base64')
  const uploaded = await screenshotCaptureService.upload({
    userId,
    accountSource: 'tonghuashun',
    buffer: png,
    mimeType: 'image/png',
    originalFilename: 'wf1-account-source-contract.png',
  })
  capturePath = uploaded.capture.storagePath
  assert.equal(uploaded.capture.accountSource, 'tonghuashun')

  await assert.rejects(
    screenshotCaptureService.upload({ userId, accountSource: 'alipay', buffer: png, mimeType: 'image/png' }),
    /different account source/,
  )
  const sourceConflictPreview = await screenshotCaptureService.applyExtraction({
    captureId: uploaded.capture.id,
    userId,
    documentType: 'holding',
    rows: [{
      rowType: 'holding',
      rawText: `${realAsset.symbol} 100`,
      fields: { accountId: 'alipay', symbol: realAsset.symbol, quantity: 100, availableQuantity: 100, frozenQuantity: 0, avgCost: realAsset.lastPrice || 1 },
      fieldConfidence: { symbol: 0.99, quantity: 0.99, avgCost: 0.99 },
      confidence: 0.99,
    }],
  })
  assert.equal(sourceConflictPreview.rows[0].status, 'blocked')
  assert.ok(sourceConflictPreview.rows[0].diff.issues.includes('account_source_conflict'))
  assert.equal(sourceConflictPreview.rows[0].fields.accountId, 'tonghuashun')

  const transactionCountBefore = await prisma.transaction.count({ where: { userId } })
  const suggested = await investmentWorkflowService.suggestAssignments(userId)
  assert.equal(suggested.assignments.length, 1)
  assert.equal(suggested.assignments[0].strategyFamily, 'rotation_volatility')
  assert.equal(suggested.assignments[0].status, 'suggested')
  const confirmed = await investmentWorkflowService.confirmAssignment({
    userId,
    positionId: position.id,
    strategyFamily: 'rotation_volatility',
    confirmedBy: 'wf1_contract_test',
  })
  assert.equal(confirmed.status, 'confirmed')

  const firstSnapshot = await investmentWorkflowService.createResearchSnapshot({
    userId,
    strategyFamily: 'rotation_volatility',
    accountSource: 'tonghuashun',
    positionIds: [position.id],
  })
  const secondSnapshot = await investmentWorkflowService.createResearchSnapshot({
    userId,
    strategyFamily: 'rotation_volatility',
    accountSource: 'tonghuashun',
    positionIds: [position.id],
  })
  assert.equal(firstSnapshot.id, secondSnapshot.id, 'identical real inputs must reuse the immutable snapshot')
  assert.match(firstSnapshot.inputHash, /^[a-f0-9]{64}$/)
  assert.equal(firstSnapshot.immutable, true)
  assert.equal(firstSnapshot.input.positions.length, 1)
  assert.ok(firstSnapshot.input.dailyBars[realAsset.symbol.replace(/\.(SH|SZ|BJ|SS)$/i, '')].length >= 30)
  assert.ok(firstSnapshot.providerSummary.length >= 1)
  assert.deepEqual(firstSnapshot.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.equal(await prisma.transaction.count({ where: { userId } }), transactionCountBefore)

  console.log(JSON.stringify({
    schemaVersion: 'fams.wf1-foundation-acceptance.v1',
    status: 'passed',
    realData: {
      assetSymbol: realAsset.symbol,
      canonicalDailyBarCount: realBarCount,
      snapshotAsOf: firstSnapshot.asOf,
      providers: firstSnapshot.providerSummary,
      freshnessStatus: firstSnapshot.freshnessStatus,
    },
    gates: {
      accountSourcePersisted: true,
      crossAccountReuseBlocked: true,
      extractionSourceConflictBlocked: true,
      assignmentRequiresConfirmation: true,
      immutableSnapshotIdempotent: true,
      transactionSideEffectCount: 0,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }, null, 2))
}

main()
  .finally(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
    if (capturePath) await unlink(capturePath).catch(() => undefined)
    await prisma.$disconnect()
  })
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
