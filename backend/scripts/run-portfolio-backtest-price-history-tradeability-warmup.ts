import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'

function parseSymbols() {
  const raw = process.argv.find((item) => item.startsWith('--symbols='))?.slice('--symbols='.length)
    || process.env.FAMS_PORTFOLIO_PRICE_HISTORY_TRADEABILITY_SYMBOLS
    || '510300,511010,511260,518880,159985'
  return Array.from(new Set(raw.split(',').map((item) => item.trim()).filter((item) => /^\d{6}$/.test(item))))
}

function parseDays() {
  const value = Number(process.argv.find((item) => item.startsWith('--days='))?.slice('--days='.length)
    || process.env.FAMS_PORTFOLIO_PRICE_HISTORY_TRADEABILITY_DAYS
    || 260)
  return Number.isFinite(value) && value > 0 ? Math.min(520, Math.floor(value)) : 260
}

function dateText(value: Date) {
  return value.toISOString().slice(0, 10)
}

async function main() {
  const symbols = parseSymbols()
  const days = parseDays()
  let symbolsWithPriceHistory = 0
  let statusRowsUpserted = 0
  let tradeabilityRowsUpserted = 0
  const skipped: Array<{ symbol: string; reason: string }> = []

  for (const symbol of symbols) {
    const asset = await prisma.asset.findFirst({ where: { symbol } })
    if (!asset) {
      skipped.push({ symbol, reason: 'asset_missing' })
      continue
    }
    const rows = (await prisma.priceHistory.findMany({
      where: { assetId: asset.id, isValid: true, closePrice: { gt: 0 } },
      orderBy: { timestamp: 'desc' },
      take: days,
    })).sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime())
    if (rows.length === 0) {
      skipped.push({ symbol, reason: 'price_history_missing' })
      continue
    }
    symbolsWithPriceHistory += 1
    await prisma.$transaction(async (tx) => {
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index]
        const previous = index > 0 ? rows[index - 1] : null
        const tradeDate = new Date(`${dateText(row.timestamp)}T00:00:00.000Z`)
        const sourceRefsJson = JSON.stringify([{
          provider: 'price_history',
          method: 'price_history_derived_tradeability.v1',
          symbol,
          tradeDate: dateText(tradeDate),
          priceHistoryId: row.id,
        }])
        const warningsJson = JSON.stringify([
          '免费源交易状态由 price_history 推导；可用于正式评审前置，不等同交易所官方逐笔交易状态。',
          ...(previous ? [] : ['首个窗口日缺少前收盘价，涨跌停价不可计算。']),
        ])
        await tx.securityStatusDaily.upsert({
          where: {
            symbol_market_tradeDate_dataVersion: {
              symbol,
              market: 'CN',
              tradeDate,
              dataVersion: 'security_status.v1',
            },
          },
          create: {
            assetId: asset.id,
            symbol,
            market: 'CN',
            tradeDate,
            listingStatus: 'listed',
            riskFlag: 'normal',
            isSt: false,
            isDelisted: false,
            isSuspended: false,
            provider: 'price_history',
            sourceTimestamp: new Date(),
            confidence: previous ? 0.58 : 0.48,
            sourceRefsJson,
            warningsJson,
            validationStatus: 'valid',
            dataVersion: 'security_status.v1',
          },
          update: {
            assetId: asset.id,
            provider: 'price_history',
            sourceTimestamp: new Date(),
            confidence: previous ? 0.58 : 0.48,
            sourceRefsJson,
            warningsJson,
            validationStatus: 'valid',
          },
        })
        statusRowsUpserted += 1
        await tx.marketTradeabilityDaily.upsert({
          where: {
            symbol_market_tradeDate_dataVersion: {
              symbol,
              market: 'CN',
              tradeDate,
              dataVersion: 'tradeability.v1',
            },
          },
          create: {
            assetId: asset.id,
            symbol,
            market: 'CN',
            tradeDate,
            isTradable: true,
            tradabilityStatus: 'tradable',
            isSuspended: false,
            limitUp: previous ? Number((previous.closePrice * 1.1).toFixed(3)) : null,
            limitDown: previous ? Number((previous.closePrice * 0.9).toFixed(3)) : null,
            provider: 'price_history',
            sourceTimestamp: new Date(),
            confidence: previous ? 0.58 : 0.48,
            sourceRefsJson,
            warningsJson,
            qualityFlagsJson: JSON.stringify(['free_source_price_history_derived', ...(previous ? [] : ['missing_previous_close_for_limit_price'])]),
            validationStatus: 'valid',
            dataVersion: 'tradeability.v1',
          },
          update: {
            assetId: asset.id,
            isTradable: true,
            tradabilityStatus: 'tradable',
            isSuspended: false,
            limitUp: previous ? Number((previous.closePrice * 1.1).toFixed(3)) : null,
            limitDown: previous ? Number((previous.closePrice * 0.9).toFixed(3)) : null,
            provider: 'price_history',
            sourceTimestamp: new Date(),
            confidence: previous ? 0.58 : 0.48,
            sourceRefsJson,
            warningsJson,
            qualityFlagsJson: JSON.stringify(['free_source_price_history_derived', ...(previous ? [] : ['missing_previous_close_for_limit_price'])]),
            validationStatus: 'valid',
          },
        })
        tradeabilityRowsUpserted += 1
      }
    }, { maxWait: 10000, timeout: 30000 })
  }

  console.log(JSON.stringify({
    ok: true,
    schemaVersion: 'portfolio.backtest.price_history_tradeability_warmup.v1',
    requestedSymbols: symbols.length,
    symbolsWithPriceHistory,
    statusRowsUpserted,
    tradeabilityRowsUpserted,
    skipped,
    note: 'Generated price_history-derived tradeability facts for portfolio formal-review readiness; not official exchange trading state.',
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
