import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import {
  normalizeRotationTarget,
  relativeRotationUniverseService,
} from '../src/services/relative-rotation/relativeRotationUniverseService.js'
import { QFQ_CANONICAL_VERSION } from '../src/services/relative-rotation/relativeRotationService.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function main() {
  requireDevDbMutationAcknowledgement('verify-relative-rotation-watchlist')
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`
  const ownerId = `verify-rrg-watch-owner-${suffix}`
  const peerId = `verify-rrg-watch-peer-${suffix}`
  const limitId = `verify-rrg-watch-limit-${suffix}`
  const symbol = `98${String(Date.now()).slice(-4)}`
  let assetId: string | null = null

  assert.deepEqual(normalizeRotationTarget('CN', '515070.SH'), {
    market: 'CN', symbol: '515070', exchange: 'SH', currency: 'CNY', assetType: 'etf', targetKey: 'CN:515070',
  })
  assert.equal(normalizeRotationTarget('HK', '700').symbol, '00700.HK')
  assert.equal(normalizeRotationTarget('US', 'brk.b').symbol, 'BRK.B')
  await assert.rejects(async () => normalizeRotationTarget('CN', '700'), /6位数字/)

  try {
    await prisma.user.createMany({
      data: [ownerId, peerId, limitId].map((id) => ({
        id,
        email: `${id}@example.test`,
        passwordHash: 'verification-only',
        name: 'RRG Watchlist Verification',
      })),
    })

    const asset = await prisma.asset.create({
      data: {
        symbol,
        name: 'RRG Watchlist Verification Asset',
        type: 'stock',
        currency: 'CNY',
        exchange: 'SH',
        lastPrice: 10,
      },
    })
    assetId = asset.id
    await prisma.position.create({
      data: {
        userId: ownerId,
        assetId: asset.id,
        openKey: `${ownerId}:${asset.id}`,
        quantity: 100,
        avgCost: 10,
        currentPrice: 10,
        marketValue: 1000,
        costBasis: 1000,
        unrealizedPnl: 0,
        source: 'verification',
      },
    })

    const ownerItem = await prisma.relativeRotationWatchlistItem.create({
      data: {
        userId: ownerId,
        market: 'CN',
        symbol,
        name: 'RRG Watchlist Verification Asset',
        currency: 'CNY',
        exchange: 'SH',
        identityStatus: 'verified',
      },
    })
    const peerItem = await prisma.relativeRotationWatchlistItem.create({
      data: {
        userId: peerId,
        market: 'CN',
        symbol,
        name: 'Peer RRG Watchlist Verification Asset',
        currency: 'CNY',
        exchange: 'SH',
        identityStatus: 'verified',
      },
    })
    const series = await prisma.relativeRotationWatchlistSeries.create({
      data: {
        watchlistItemId: ownerItem.id,
        benchmarkId: 'csi300_price_index',
        benchmarkSymbol: '000300.SH',
        frequency: 'weekly',
        formulaVersion: 'transparent_relative_rotation.v1',
        dataVersion: 'relative_rotation.timeline.v1',
        adjustType: 'qfq',
        readiness: 'limited',
        freshness: 'fresh',
        sampleDays: 120,
        benchmarkSampleDays: 120,
        commonAsOfDate: new Date('2026-08-20T00:00:00.000Z'),
        points: {
          create: {
            tradeDate: new Date('2026-08-20T00:00:00.000Z'),
            relativePrice: 1.02,
            relativeTrend: 101,
            relativeMomentum: 100.5,
            quadrant: 'leading',
          },
        },
      },
    })
    await prisma.relativeRotationWatchlistRefreshRun.create({
      data: { watchlistItemId: ownerItem.id, status: 'completed', completedAt: new Date() },
    })
    await prisma.marketBarCanonical.create({
      data: {
        assetId: asset.id,
        symbol,
        market: 'CN',
        timeframe: '1d',
        tradeDate: new Date('2026-08-20T00:00:00.000Z'),
        adjustType: 'qfq',
        closePrice: 10,
        primaryProvider: 'verification_shared_market_data',
        validationStatus: 'valid',
        dataVersion: QFQ_CANONICAL_VERSION,
      },
    })

    const idempotent = await relativeRotationUniverseService.addWatchlistItem(ownerId, 'CN', symbol, { refresh: false })
    assert.equal(idempotent.created, false)
    assert.equal(idempotent.item.id, ownerItem.id)

    const merged = await relativeRotationUniverseService.getUniverseTimeline(ownerId, { market: 'CN', frequency: 'weekly', years: 1 })
    const mergedItem = merged.items.find((item) => item.targetKey === `CN:${symbol}`)
    assert.ok(mergedItem)
    assert.deepEqual(mergedItem.sources.sort(), ['holding', 'watchlist'])
    assert.equal(merged.items.filter((item) => item.targetKey === `CN:${symbol}`).length, 1)

    const emptyRefresh = await relativeRotationUniverseService.refreshUniverse(ownerId, {
      market: 'CN',
      targetKeys: [],
      years: 1,
    })
    assert.equal(emptyRefresh.requestedTargets, 0)
    assert.equal(emptyRefresh.completedTargets, 0)
    assert.deepEqual(emptyRefresh.results, [])

    await prisma.relativeRotationWatchlistItem.createMany({
      data: Array.from({ length: 30 }, (_, index) => ({
        userId: limitId,
        market: 'CN',
        symbol: `97${String(index).padStart(4, '0')}`,
        name: `Limit item ${index + 1}`,
        currency: 'CNY',
      })),
    })
    await assert.rejects(
      relativeRotationUniverseService.addWatchlistItem(limitId, 'CN', '969999', { refresh: false }),
      /最多30个标的/,
    )

    const deletion = await relativeRotationUniverseService.deleteWatchlistItem(ownerId, ownerItem.id)
    assert.equal(deletion.deletedSeries, 1)
    assert.equal(deletion.deletedPoints, 1)
    assert.equal(deletion.deletedRefreshRuns, 1)
    assert.equal(deletion.sharedMarketBarsRetained, 1)
    assert.equal(deletion.stillVisibleViaHolding, true)
    assert.equal(await prisma.relativeRotationWatchlistSeries.count({ where: { id: series.id } }), 0)
    assert.equal(await prisma.relativeRotationWatchlistItem.count({ where: { id: peerItem.id } }), 1)
    assert.equal(await prisma.marketBarCanonical.count({ where: { market: 'CN', symbol } }), 1)

    console.log(JSON.stringify({
      ok: true,
      checks: [
        'CN/HK/US symbol normalization and validation',
        'idempotent watchlist add',
        'holding and watchlist merge without duplicate target',
        'empty visible target set never expands to refresh-all',
        '30 item watchlist boundary',
        'user-owned RRG cascade deletion',
        'peer watchlist and shared canonical bars retained',
      ],
    }, null, 2))
  } finally {
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, peerId, limitId] } } })
    await prisma.marketBarCanonical.deleteMany({ where: { market: 'CN', symbol, primaryProvider: 'verification_shared_market_data' } })
    if (assetId) await prisma.asset.deleteMany({ where: { id: assetId } })
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
