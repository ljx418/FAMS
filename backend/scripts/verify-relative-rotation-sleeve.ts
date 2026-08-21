import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { buildRelativeRotationSeries } from '../src/services/relative-rotation/relativeRotationService.js'
import { transactionService } from '../src/services/transaction/transactionService.js'
import { volatilitySleeveService } from '../src/services/volatility-sleeve/volatilitySleeveService.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

const isoDate = (date: Date) => date.toISOString().slice(0, 10)

function verifyTransparentRotationFormula() {
  const start = new Date('2024-01-01T00:00:00.000Z')
  const asset = []
  const benchmark = []
  for (let index = 0; index < 500; index += 1) {
    const date = new Date(start)
    date.setUTCDate(date.getUTCDate() + index)
    const benchmarkClose = 100 + (index * 0.03)
    const relativePhase = index < 250
      ? 0.92 + (index * 0.0002)
      : 0.97 + ((index - 250) * 0.00075)
    benchmark.push({ date: isoDate(date), close: benchmarkClose })
    asset.push({ date: isoDate(date), close: benchmarkClose * relativePhase })
  }

  const weekly = buildRelativeRotationSeries(asset, benchmark, 'weekly')
  const daily = buildRelativeRotationSeries(asset, benchmark, 'daily')
  assert.equal(weekly.coveragePercent, 100)
  assert.equal(daily.coveragePercent, 100)
  assert.ok(weekly.points.length >= 20, 'weekly series should remain after the transparent warm-up')
  assert.ok(daily.points.length >= 400, 'daily series should remain after the transparent warm-up')
  assert.ok(weekly.points.every((point) => ['leading', 'weakening', 'lagging', 'improving'].includes(point.quadrant)))
  assert.ok(weekly.points.slice(1).every((point) => point.deltaX !== null && point.deltaY !== null && point.speed !== null))
  assert.ok(weekly.points.some((point) => point.relativeTrend > 100), 'strengthening relative price should move relative trend above 100')
}

async function verifySleeveLedgerAndInvariants() {
  requireDevDbMutationAcknowledgement('verify-relative-rotation-sleeve')
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const userId = `verify-rrg-${suffix}`
  let assetId: string | null = null

  try {
    await prisma.user.create({
      data: {
        id: userId,
        email: `${userId}@example.test`,
        passwordHash: 'verification-only',
        name: 'Relative Rotation Verification',
      },
    })
    const asset = await prisma.asset.create({
      data: {
        symbol: `9${String(Date.now()).slice(-5)}`,
        name: 'RRG Sleeve Verification Asset',
        type: 'stock',
        currency: 'CNY',
        exchange: 'SH',
        lastPrice: 10,
      },
    })
    assetId = asset.id
    const position = await prisma.position.create({
      data: {
        userId,
        assetId: asset.id,
        openKey: `${userId}:${asset.id}`,
        quantity: 1000,
        avgCost: 10,
        currentPrice: 10,
        marketValue: 10_000,
        costBasis: 10_000,
        unrealizedPnl: 0,
        source: 'verification',
      },
    })

    const insufficientBacktest = await prisma.volatilityStrategyBacktest.create({
      data: {
        userId,
        positionId: position.id,
        status: 'insufficient',
        recommendedRatio: 0,
        completedAt: new Date(),
      },
    })
    await assert.rejects(
      volatilitySleeveService.activateAllocation({
        userId,
        positionId: position.id,
        backtestId: insufficientBacktest.id,
        confirmedRatio: 0.1,
      }),
      /only a zero volatility allocation/,
    )

    const passedBacktest = await prisma.volatilityStrategyBacktest.create({
      data: {
        userId,
        positionId: position.id,
        status: 'passed',
        sampleDays: 1000,
        recommendedRatio: 0.2,
        recommendedProfile: 'conservative',
        completedAt: new Date(),
      },
    })
    const activated = await volatilitySleeveService.activateAllocation({
      userId,
      positionId: position.id,
      backtestId: passedBacktest.id,
      confirmedRatio: 0.2,
    })
    assert.equal(activated.coreQuantity, 800)
    assert.equal(activated.volatilityQuantity, 200)
    assert.equal(activated.volatilityCostBasis, 2000)

    await assert.rejects(
      transactionService.createTransaction({
        userId,
        assetId: asset.id,
        type: 'sell',
        quantity: 100,
        price: 11,
      }),
      /必须指定 sleeveType/,
    )

    const sellDraft = await prisma.volatilityTradeDraft.create({
      data: {
        userId,
        positionId: position.id,
        allocationId: activated.id,
        analysisDate: new Date('2026-08-20T00:00:00.000Z'),
        side: 'sell',
        suggestedQuantity: 100,
        strategyProfile: 'conservative',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    const sellTransaction = await volatilitySleeveService.confirmDraft({
      userId,
      draftId: sellDraft.id,
      quantity: 100,
      price: 11,
      fee: 1,
    })
    await assert.rejects(transactionService.updateTransaction(sellTransaction.id, { notes: 'forbidden' }), /immutable/)
    await assert.rejects(transactionService.deleteTransaction(sellTransaction.id), /immutable/)

    let current = await prisma.positionSleeveAllocation.findUniqueOrThrow({ where: { id: activated.id } })
    assert.equal(current.coreQuantity, 800)
    assert.equal(current.volatilityQuantity, 100)
    assert.equal(current.volatilityCash, 1099)
    assert.equal(current.volatilityCostBasis, 1000)
    assert.equal(current.volatilityRealizedPnl, 99)

    current = await volatilitySleeveService.transfer({
      userId,
      positionId: position.id,
      direction: 'volatility_to_core',
      amount: 100,
      expectedVersion: current.version,
      notes: 'verification rebalance',
    })
    current = await volatilitySleeveService.transfer({
      userId,
      positionId: position.id,
      direction: 'cash_out',
      amount: 99,
      expectedVersion: current.version,
      notes: 'verification realized profit transfer',
    })

    const buyDraft = await prisma.volatilityTradeDraft.create({
      data: {
        userId,
        positionId: position.id,
        allocationId: activated.id,
        analysisDate: new Date('2026-08-21T00:00:00.000Z'),
        side: 'buy',
        suggestedQuantity: 100,
        strategyProfile: 'conservative',
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    })
    const buyTransaction = await volatilitySleeveService.confirmDraft({
      userId,
      draftId: buyDraft.id,
      quantity: 100,
      price: 10,
    })

    const [finalPosition, finalAllocation, ledgers, confirmedDrafts] = await Promise.all([
      prisma.position.findUniqueOrThrow({ where: { id: position.id } }),
      prisma.positionSleeveAllocation.findUniqueOrThrow({ where: { id: activated.id } }),
      prisma.positionSleeveLedgerEntry.findMany({ where: { allocationId: activated.id } }),
      prisma.volatilityTradeDraft.count({ where: { allocationId: activated.id, status: 'confirmed' } }),
    ])
    assert.equal(finalPosition.quantity, 1000)
    assert.equal(finalAllocation.coreQuantity, 900)
    assert.equal(finalAllocation.volatilityQuantity, 100)
    assert.equal(finalAllocation.volatilityCash, 0)
    assert.equal(finalAllocation.volatilityCostBasis, 1000)
    assert.equal(finalPosition.quantity, finalAllocation.coreQuantity + finalAllocation.volatilityQuantity)
    assert.equal(confirmedDrafts, 2)
    assert.equal(ledgers.filter((entry) => entry.transactionId).length, 2)
    assert.ok(ledgers.length >= 5, 'activation, trades and transfers should all be auditable')
    assert.ok(ledgers.some((entry) => entry.transactionId === buyTransaction.id))
  } finally {
    await prisma.user.deleteMany({ where: { id: userId } })
    if (assetId) await prisma.asset.deleteMany({ where: { id: assetId } })
  }
}

async function main() {
  verifyTransparentRotationFormula()
  await verifySleeveLedgerAndInvariants()
  console.log(JSON.stringify({
    ok: true,
    checks: [
      'transparent weekly/daily rotation formula',
      'failed backtest allocation gate',
      'core/volatility quantity invariant',
      'draft confirmation and immutable sleeve transactions',
      'cash, cost basis and realized PnL ledger',
    ],
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
