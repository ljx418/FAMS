import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { dividendLowVolInputBuilderService } from '../src/services/dividend-low-vol/dividendLowVolInputBuilderService.js'

async function main() {
  const symbol = '689999'
  const tradeDate = new Date('2026-01-05T00:00:00.000Z')
  await prisma.marketBarCanonical.upsert({
    where: {
      symbol_market_tradeDate_adjustType_dataVersion: {
        symbol,
        market: 'CN',
        tradeDate,
        adjustType: 'none',
        dataVersion: 'canonical.v1',
      },
    },
    create: {
      symbol,
      market: 'CN',
      tradeDate,
      timeframe: '1d',
      adjustType: 'none',
      dataVersion: 'canonical.v1',
      openPrice: 10,
      highPrice: 10.5,
      lowPrice: 9.8,
      closePrice: 10.2,
      volume: 1_000_000,
      amount: 10_200_000,
      primaryProvider: 'verify',
      sourceRefsJson: '["verify:bar"]',
    },
    update: {
      closePrice: 10.2,
      amount: 10_200_000,
    },
  })
  await prisma.marketTradeabilityDaily.upsert({
    where: {
      symbol_market_tradeDate_dataVersion: {
        symbol,
        market: 'CN',
        tradeDate,
        dataVersion: 'tradeability.v1',
      },
    },
    create: {
      symbol,
      market: 'CN',
      tradeDate,
      dataVersion: 'tradeability.v1',
      isTradable: true,
      tradabilityStatus: 'tradable',
      isSuspended: false,
      limitUp: 11.22,
      limitDown: 9.18,
      provider: 'verify_free_source',
      confidence: 0.8,
      sourceRefsJson: '["verify:tradeability"]',
    },
    update: {
      isTradable: true,
      tradabilityStatus: 'tradable',
      isSuspended: false,
      limitUp: 11.22,
      limitDown: 9.18,
      provider: 'verify_free_source',
    },
  })
  const built = await dividendLowVolInputBuilderService.buildFromSymbol(symbol)
  const row = built.history?.find((item) => item.date === '2026-01-05')
  assert.ok(row, 'builder must include market bar row')
  assert.equal(row?.isTradable, true)
  assert.equal(row?.tradabilityStatus, 'tradable')
  assert.equal(row?.isSuspended, false)
  assert.equal(row?.limitUp, 11.22)
  assert.equal(row?.limitDown, 9.18)
  assert.ok(row?.tradeabilityEvidenceRef?.includes('market-tradeability-daily:689999:2026-01-05:verify_free_source'))
  console.log(JSON.stringify({
    ok: true,
    symbol,
    tradeabilityMerged: {
      isTradable: row?.isTradable,
      tradabilityStatus: row?.tradabilityStatus,
      limitUp: row?.limitUp,
      limitDown: row?.limitDown,
      evidenceRef: row?.tradeabilityEvidenceRef,
    },
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.marketTradeabilityDaily.deleteMany({ where: { symbol: '689999', provider: 'verify_free_source' } }).catch(() => undefined)
    await prisma.marketBarCanonical.deleteMany({ where: { symbol: '689999', primaryProvider: 'verify' } }).catch(() => undefined)
    await prisma.$disconnect().catch(() => undefined)
  })
