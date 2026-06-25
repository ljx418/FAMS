import 'dotenv/config'
import { prisma } from '../src/db/prisma.js'

const AUDIT_USER_ID = process.env.FAMS_PORTFOLIO_BACKTEST_AUDIT_USER_ID || 'audit_portfolio_backtest_user'
const SYMBOLS = (process.env.FAMS_PORTFOLIO_BACKTEST_AUDIT_SYMBOLS || '000513,601398,000333')
  .split(',')
  .map((item) => item.trim())
  .filter((item) => /^\d{6}$/.test(item))

function exchangeFor(symbol: string) {
  return /^(6|9)/.test(symbol) ? 'SH' : /^(8|4)/.test(symbol) ? 'BJ' : 'SZ'
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

async function main() {
  await prisma.user.upsert({
    where: { id: AUDIT_USER_ID },
    create: {
      id: AUDIT_USER_ID,
      email: `${AUDIT_USER_ID}@local.fams`,
      passwordHash: 'local-development-user',
      name: 'Portfolio Backtest Audit User',
      settings: JSON.stringify({
        purpose: 'audit-only portfolio backtest sample holdings',
        notRealUserPortfolio: true,
      }),
    },
    update: {
      settings: JSON.stringify({
        purpose: 'audit-only portfolio backtest sample holdings',
        notRealUserPortfolio: true,
      }),
    },
  })

  const seeded = []
  for (const [index, symbol] of SYMBOLS.entries()) {
    const latestBar = await prisma.marketBarCanonical.findFirst({
      where: {
        symbol,
        market: 'CN',
        timeframe: '1d',
        adjustType: 'none',
        dataVersion: 'canonical.v1',
        closePrice: { gt: 0 },
      },
      orderBy: { tradeDate: 'desc' },
    })
    if (!latestBar) {
      seeded.push({ symbol, status: 'skipped', reason: 'market_bar_canonical_missing' })
      continue
    }
    const asset = await prisma.asset.upsert({
      where: { symbol },
      create: {
        symbol,
        name: `审计样例持仓 ${symbol}`,
        type: 'stock',
        currency: 'CNY',
        exchange: exchangeFor(symbol),
        lastPrice: latestBar.closePrice,
        lastUpdated: latestBar.tradeDate,
      },
      update: {
        lastPrice: latestBar.closePrice,
        lastUpdated: latestBar.tradeDate,
      },
    })
    const targetMarketValue = [40000, 35000, 25000][index] || 20000
    const quantity = Math.max(100, Math.floor(targetMarketValue / latestBar.closePrice / 100) * 100)
    const marketValue = round(quantity * latestBar.closePrice, 2)
    const avgCost = round(latestBar.closePrice * (index === 0 ? 0.97 : index === 1 ? 1.02 : 0.99), 4)
    const costBasis = round(quantity * avgCost, 2)
    const openKey = `${AUDIT_USER_ID}:${asset.id}`
    const existing = await prisma.position.findUnique({ where: { openKey } })
    const position = await prisma.position.upsert({
      where: { openKey },
      create: {
        userId: AUDIT_USER_ID,
        assetId: asset.id,
        openKey,
        quantity,
        avgCost,
        currentPrice: latestBar.closePrice,
        marketValue,
        costBasis,
        unrealizedPnl: round(marketValue - costBasis, 2),
        positionType: 'long',
        status: 'open',
        tags: JSON.stringify(['audit_sample', 'portfolio_backtest']),
        labels: JSON.stringify(['真实行情样例', '仅用于组合回测验收']),
        notes: 'Audit-only sample holding for real-data portfolio backtest validation. Not a real user portfolio.',
        source: 'portfolio_backtest_audit_seed',
        openedAt: latestBar.tradeDate,
      },
      update: {
        quantity,
        avgCost,
        currentPrice: latestBar.closePrice,
        marketValue,
        costBasis,
        unrealizedPnl: round(marketValue - costBasis, 2),
        status: 'open',
        tags: JSON.stringify(['audit_sample', 'portfolio_backtest']),
        labels: JSON.stringify(['真实行情样例', '仅用于组合回测验收']),
        notes: 'Audit-only sample holding for real-data portfolio backtest validation. Not a real user portfolio.',
        source: 'portfolio_backtest_audit_seed',
      },
    })
    if (!existing) {
      await prisma.transaction.create({
        data: {
          positionId: position.id,
          userId: AUDIT_USER_ID,
          assetId: asset.id,
          type: 'buy',
          quantity,
          price: avgCost,
          fee: round(costBasis * 0.0003, 2),
          amount: costBasis,
          status: 'confirmed',
          executedAt: latestBar.tradeDate,
          notes: 'Audit-only sample buy transaction for portfolio backtest validation.',
          source: 'portfolio_backtest_audit_seed',
        },
      })
    }
    seeded.push({
      symbol,
      status: 'upserted',
      positionId: position.id,
      tradeDate: latestBar.tradeDate.toISOString().slice(0, 10),
      quantity,
      currentPrice: latestBar.closePrice,
      marketValue,
      evidenceRefs: [
        `market_bar_canonical:${symbol}:${latestBar.tradeDate.toISOString().slice(0, 10)}`,
        `position:${position.id}`,
      ],
    })
  }

  const openPositions = await prisma.position.count({
    where: { userId: AUDIT_USER_ID, status: 'open' },
  })

  console.log(JSON.stringify({
    ok: true,
    schemaVersion: 'portfolio.backtest.audit_holdings_seed.v1',
    userId: AUDIT_USER_ID,
    requestedSymbols: SYMBOLS,
    openPositions,
    seeded,
    notTradingAdvice: true,
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
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
