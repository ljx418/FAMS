import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'

type CanonicalFile = {
  items?: Array<{
    code: string
    name?: string
    sourceProviders?: string[]
    sourceRefs?: string[]
  }>
}

function parseLimit() {
  const value = Number(process.env.FAMS_TRADEABILITY_FROM_BARS_LIMIT || process.argv.find((item) => item.startsWith('--limit='))?.slice('--limit='.length) || 520)
  return Number.isFinite(value) && value > 0 ? Math.min(5849, Math.floor(value)) : 520
}

function parseDays() {
  const value = Number(process.env.FAMS_TRADEABILITY_FROM_BARS_DAYS || process.argv.find((item) => item.startsWith('--days='))?.slice('--days='.length) || 260)
  return Number.isFinite(value) && value > 0 ? Math.min(520, Math.floor(value)) : 260
}

function parseSymbols() {
  const raw = process.argv.find((item) => item.startsWith('--symbols='))?.slice('--symbols='.length)
    || process.env.FAMS_TRADEABILITY_FROM_BARS_SYMBOLS
    || ''
  return raw.split(',').map((item) => item.trim()).filter((item) => /^\d{6}$/.test(item))
}

function classifyName(name?: string) {
  const text = name || ''
  return {
    isSt: /(^|\s)(ST|\*ST|PT)/i.test(text),
    isDelisted: /退市|退/.test(text),
    riskFlag: /(^|\s)(ST|\*ST|PT)/i.test(text) ? 'st' : /退市|退/.test(text) ? 'delisting_risk' : 'normal',
    listingStatus: /退市|退/.test(text) ? 'delisted' : 'listed',
  }
}

function dateText(value: Date) {
  return value.toISOString().slice(0, 10)
}

async function main() {
  const limit = parseLimit()
  const days = parseDays()
  const requestedSymbols = parseSymbols()
  const canonicalPath = resolve(process.cwd(), 'data/a-share-quote-list-canonical.json')
  const canonical = JSON.parse(await readFile(canonicalPath, 'utf8')) as CanonicalFile
  const canonicalByCode = new Map((canonical.items || []).filter((item) => /^\d{6}$/.test(item.code)).map((item) => [item.code, item]))
  const symbols = requestedSymbols.length > 0
    ? requestedSymbols.slice(0, limit)
    : (await prisma.marketBarCanonical.groupBy({
      by: ['symbol'],
      where: { market: 'CN', timeframe: '1d', adjustType: 'none', dataVersion: 'canonical.v1' },
      orderBy: { symbol: 'asc' },
      take: limit,
    })).map((item) => item.symbol)

  let statusRows = 0
  let tradeabilityRows = 0
  let symbolsWithBars = 0
  const chunkSize = Math.max(25, Math.min(200, Number(process.env.FAMS_TRADEABILITY_FROM_BARS_CHUNK_SIZE || 80) || 80))
  for (let index = 0; index < symbols.length; index += chunkSize) {
    const chunk = symbols.slice(index, index + chunkSize)
    const barsBySymbol = new Map<string, Array<{
      assetId: string | null
      symbol: string
      tradeDate: Date
      closePrice: number
      volume: number
      sourceRefsJson: string | null
    }>>()
    await Promise.all(chunk.map(async (symbol) => {
      const symbolBars = await prisma.marketBarCanonical.findMany({
        where: {
          symbol,
          market: 'CN',
          timeframe: '1d',
          adjustType: 'none',
          dataVersion: 'canonical.v1',
        },
        orderBy: { tradeDate: 'desc' },
        take: days,
        select: {
          assetId: true,
          symbol: true,
          tradeDate: true,
          closePrice: true,
          volume: true,
          sourceRefsJson: true,
        },
      })
      barsBySymbol.set(symbol, symbolBars)
    }))
    await prisma.$transaction(async (tx) => {
      for (const symbol of chunk) {
        const symbolBars = [...(barsBySymbol.get(symbol) || [])].sort((left, right) => left.tradeDate.getTime() - right.tradeDate.getTime())
        if (symbolBars.length === 0) continue
        symbolsWithBars += 1
        const canonicalItem = canonicalByCode.get(symbol)
        const nameClass = classifyName(canonicalItem?.name)
        for (let offset = 0; offset < symbolBars.length; offset += 1) {
          const bar = symbolBars[offset]
          const previous = offset > 0 ? symbolBars[offset - 1] : null
          const isSuspended = (bar.volume || 0) <= 0
          const sourceRefsJson = JSON.stringify([{
            provider: 'market_bar_canonical',
            method: 'bar_derived_tradeability.v1',
            symbol,
            tradeDate: dateText(bar.tradeDate),
            barSourceRefs: JSON.parse(bar.sourceRefsJson || '[]'),
            canonicalSourceRefs: canonicalItem?.sourceRefs || [],
            canonicalProviders: canonicalItem?.sourceProviders || [],
          }])
          const warningsJson = JSON.stringify([
            '免费源交易状态由 market_bar_canonical 历史 K 线推导；可用于研究验证，不等同交易所正式逐笔交易状态。',
            ...(previous ? [] : ['首个窗口日缺少前收盘价，涨跌停价不可计算。']),
          ])
          await tx.securityStatusDaily.upsert({
            where: {
              symbol_market_tradeDate_dataVersion: {
                symbol,
                market: 'CN',
                tradeDate: bar.tradeDate,
                dataVersion: 'security_status.v1',
              },
            },
            create: {
              assetId: bar.assetId,
              symbol,
              market: 'CN',
              tradeDate: bar.tradeDate,
              listingStatus: nameClass.listingStatus,
              riskFlag: nameClass.riskFlag,
              isSt: nameClass.isSt,
              isDelisted: nameClass.isDelisted,
              isSuspended,
              provider: 'market_bar_canonical',
              sourceTimestamp: new Date(),
              confidence: isSuspended ? 0.6 : 0.55,
              sourceRefsJson,
              warningsJson,
              validationStatus: 'valid',
              dataVersion: 'security_status.v1',
            },
            update: {
              assetId: bar.assetId,
              isSuspended,
              provider: 'market_bar_canonical',
              sourceTimestamp: new Date(),
              confidence: isSuspended ? 0.6 : 0.55,
              sourceRefsJson,
              warningsJson,
              validationStatus: 'valid',
            },
          })
          statusRows += 1
          await tx.marketTradeabilityDaily.upsert({
            where: {
              symbol_market_tradeDate_dataVersion: {
                symbol,
                market: 'CN',
                tradeDate: bar.tradeDate,
                dataVersion: 'tradeability.v1',
              },
            },
            create: {
              assetId: bar.assetId,
              symbol,
              market: 'CN',
              tradeDate: bar.tradeDate,
              isTradable: !nameClass.isDelisted && !isSuspended,
              tradabilityStatus: isSuspended ? 'suspended' : 'tradable',
              isSuspended,
              limitUp: previous ? Number((previous.closePrice * 1.1).toFixed(3)) : null,
              limitDown: previous ? Number((previous.closePrice * 0.9).toFixed(3)) : null,
              provider: 'market_bar_canonical',
              sourceTimestamp: new Date(),
              confidence: previous ? 0.55 : 0.45,
              sourceRefsJson,
              warningsJson,
              qualityFlagsJson: JSON.stringify(['free_source_bar_derived', ...(previous ? [] : ['missing_previous_close_for_limit_price'])]),
              validationStatus: 'valid',
              dataVersion: 'tradeability.v1',
            },
            update: {
              assetId: bar.assetId,
              isTradable: !nameClass.isDelisted && !isSuspended,
              tradabilityStatus: isSuspended ? 'suspended' : 'tradable',
              isSuspended,
              limitUp: previous ? Number((previous.closePrice * 1.1).toFixed(3)) : null,
              limitDown: previous ? Number((previous.closePrice * 0.9).toFixed(3)) : null,
              provider: 'market_bar_canonical',
              sourceTimestamp: new Date(),
              confidence: previous ? 0.55 : 0.45,
              sourceRefsJson,
              warningsJson,
              qualityFlagsJson: JSON.stringify(['free_source_bar_derived', ...(previous ? [] : ['missing_previous_close_for_limit_price'])]),
              validationStatus: 'valid',
            },
          })
          tradeabilityRows += 1
        }
      }
    }, { maxWait: 10000, timeout: 30000 })
  }

  const coverage = await prisma.marketTradeabilityDaily.groupBy({
    by: ['symbol'],
    where: { market: 'CN', dataVersion: 'tradeability.v1', provider: 'market_bar_canonical' },
  })
  console.log(JSON.stringify({
    ok: true,
    limit,
    days,
    requestedSymbols: symbols.length,
    symbolsWithBars,
    statusRowsUpserted: statusRows,
    tradeabilityRowsUpserted: tradeabilityRows,
    marketBarCanonicalTradeabilitySymbols: coverage.length,
    note: 'Generated free-source bar-derived security status and tradeability facts for research validation only; ADD/REDUCE/AUTO_TRADE remain prohibited.',
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
