import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { portfolioBacktestEngine } from '../src/services/portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../src/services/portfolio-backtest/portfolioBacktestInputBuilder.js'

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

async function findRealPriceHistoryAssets() {
  const grouped = await prisma.priceHistory.groupBy({
    by: ['assetId'],
    where: { isValid: true },
    _count: { _all: true },
    orderBy: { _count: { assetId: 'desc' } },
    take: 20,
  })

  const candidates = []
  for (const item of grouped) {
    if (item._count._all < 30) continue
    const asset = await prisma.asset.findUnique({
      where: { id: item.assetId },
      select: { id: true, symbol: true, name: true, type: true },
    })
    if (!asset?.symbol) continue
    const [first, last] = await Promise.all([
      prisma.priceHistory.findFirst({
        where: { assetId: item.assetId, isValid: true },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true },
      }),
      prisma.priceHistory.findFirst({
        where: { assetId: item.assetId, isValid: true },
        orderBy: { timestamp: 'desc' },
        select: { timestamp: true },
      }),
    ])
    if (!first || !last) continue
    candidates.push({ ...asset, count: item._count._all, first: first.timestamp, last: last.timestamp })
  }
  return candidates
}

async function findRealMarketBarAssets() {
  const grouped = await prisma.marketBarCanonical.groupBy({
    by: ['symbol'],
    where: {
      market: 'CN',
      timeframe: '1d',
      adjustType: 'none',
      dataVersion: 'canonical.v1',
      closePrice: { gt: 0 },
    },
    _count: { _all: true },
    orderBy: { _count: { symbol: 'desc' } },
    take: 50,
  })

  const candidates = []
  for (const item of grouped) {
    if (item._count._all < 30) continue
    const [asset, first, last] = await Promise.all([
      prisma.asset.findFirst({
        where: { symbol: item.symbol },
        select: { id: true, symbol: true, name: true, type: true },
      }),
      prisma.marketBarCanonical.findFirst({
        where: {
          symbol: item.symbol,
          market: 'CN',
          timeframe: '1d',
          adjustType: 'none',
          dataVersion: 'canonical.v1',
          closePrice: { gt: 0 },
        },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true },
      }),
      prisma.marketBarCanonical.findFirst({
        where: {
          symbol: item.symbol,
          market: 'CN',
          timeframe: '1d',
          adjustType: 'none',
          dataVersion: 'canonical.v1',
          closePrice: { gt: 0 },
        },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      }),
    ])
    if (!first || !last) continue
    candidates.push({
      id: asset?.id || `market-bar:${item.symbol}`,
      symbol: asset?.symbol || item.symbol,
      name: asset?.name || item.symbol,
      type: asset?.type || 'stock',
      count: item._count._all,
      first: first.tradeDate,
      last: last.tradeDate,
      source: 'market_bar_canonical',
    })
  }
  return candidates
}

async function main() {
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  assert.ok(user, 'expected at least one real local user in database')

  const openPositionCount = await prisma.position.count({
    where: { userId: user.id, status: 'open' },
  })

  const result = await portfolioBacktestInputBuilder.build({
    userId: user.id,
    portfolioStrategyIds: [
      'permanent_portfolio',
      'all_weather',
      'current_holdings_buy_and_hold',
      'custom_weight_portfolio',
    ],
    startDate: '2024-01-01',
    endDate: '2026-06-23',
    initialCapital: 100000,
    rebalanceFrequency: 'quarterly',
    dividendMode: 'reinvest',
    feeRate: 0.0003,
    slippageRate: 0.0005,
    benchmarkIds: ['cash_cny', 'csi300_proxy'],
    customStrategies: [
      {
        strategyId: 'custom_valid_60_40',
        displayName: '自定义 60/40',
        components: [
          { assetClass: 'stock', symbol: '510300', name: '沪深300ETF代理', targetWeightPercent: 60 },
          { assetClass: 'bond', symbol: '511010', name: '国债ETF代理', targetWeightPercent: 40 },
        ],
      },
      {
        strategyId: 'custom_invalid_80',
        displayName: '自定义错误权重',
        components: [
          { assetClass: 'stock', symbol: '510300', name: '沪深300ETF代理', targetWeightPercent: 80 },
        ],
      },
    ],
  })

  assert.equal(result.schemaVersion, 'portfolio.strategy_backtest.input.v1')
  assert.equal(result.notTradingAdvice, true)
  assert.deepEqual(result.allowedActions, ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'])
  assert.deepEqual(result.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])

  const permanent = result.strategies.find((item) => item.strategyId === 'permanent_portfolio')
  assert.ok(permanent, 'permanent portfolio definition should exist')
  assert.equal(permanent.validation.status, 'valid')
  assert.equal(permanent.components.length, 4)
  assert.ok(permanent.components.filter((item) => item.proxySymbol).every((item) => item.proxyReason), 'proxy components must explain proxyReason')

  const allWeather = result.strategies.find((item) => item.strategyId === 'all_weather')
  assert.ok(allWeather, 'all weather definition should exist')
  assert.equal(allWeather.validation.status, 'valid')
  assert.equal(Number(allWeather.components.reduce((sum, item) => sum + item.targetWeightPercent, 0).toFixed(4)), 100)

  const currentHoldings = result.strategies.find((item) => item.strategyId === 'current_holdings_buy_and_hold')
  assert.ok(currentHoldings, 'current holdings definition should exist')
  assert.ok(currentHoldings.snapshot?.capturedAt)
  if (openPositionCount > 0) {
    assert.equal(currentHoldings.validation.status, 'valid')
    assert.ok((currentHoldings.snapshot?.totalMarketValue || 0) > 0)
    assert.ok(currentHoldings.components.length > 0)
  } else {
    assert.equal(currentHoldings.validation.status, 'insufficient')
    assert.ok(currentHoldings.validation.blockedReasons.includes('current_holdings_missing'))
  }

  const validCustom = result.strategies.find((item) => item.strategyId === 'custom_valid_60_40')
  assert.ok(validCustom)
  assert.equal(validCustom.validation.status, 'valid')

  const invalidCustom = result.strategies.find((item) => item.strategyId === 'custom_invalid_80')
  assert.ok(invalidCustom)
  assert.equal(invalidCustom.validation.status, 'invalid')
  assert.ok(invalidCustom.validation.blockedReasons.some((item) => item.startsWith('weight_sum_not_100')))

  assert.ok(result.dataQuality.strategyCount >= 5)
  assert.ok(result.dataQuality.validStrategyCount >= 3)
  assert.ok(result.dataQuality.blockedReasons.some((item) => item.includes('custom_invalid_80:weight_sum_not_100')))

  const priceHistoryAssets = await findRealPriceHistoryAssets()
  const marketBarAssets = priceHistoryAssets.length >= 2 ? [] : await findRealMarketBarAssets()
  const realAssets = priceHistoryAssets.length >= 2 ? priceHistoryAssets : marketBarAssets
  assert.ok(realAssets.length >= 2, 'expected at least two real local assets with >=30 price rows from PriceHistory or MarketBarCanonical')
  const selectedAssets = realAssets.slice(0, 2)
  const startDateMs = Math.max(...selectedAssets.map((item) => item.first.getTime()))
  const endDateMs = Math.min(...selectedAssets.map((item) => item.last.getTime()))
  assert.ok(endDateMs > startDateMs, 'expected overlapping real price history date range')

  const realBacktestInput = await portfolioBacktestInputBuilder.build({
    userId: user.id,
    portfolioStrategyIds: ['custom_weight_portfolio'],
    startDate: isoDate(new Date(startDateMs)),
    endDate: isoDate(new Date(endDateMs)),
    initialCapital: 100000,
    rebalanceFrequency: 'quarterly',
    dividendMode: 'reinvest',
    feeRate: 0.0003,
    slippageRate: 0.0005,
    benchmarkIds: ['cash_cny'],
    customStrategies: [
      {
        strategyId: 'custom_real_data_60_40',
        displayName: '真实数据 60/40 组合',
        components: [
          {
            assetClass: selectedAssets[0].type === 'stock' ? 'stock' : 'fund',
            symbol: selectedAssets[0].symbol,
            name: selectedAssets[0].name,
            targetWeightPercent: 60,
          },
          {
            assetClass: selectedAssets[1].type === 'stock' ? 'stock' : 'fund',
            symbol: selectedAssets[1].symbol,
            name: selectedAssets[1].name,
            targetWeightPercent: 40,
          },
        ],
      },
    ],
  })

  const backtest = await portfolioBacktestEngine.run(realBacktestInput)
  assert.equal(backtest.schemaVersion, 'portfolio.strategy_backtest.result.v1')
  assert.equal(backtest.notTradingAdvice, true)
  assert.deepEqual(backtest.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.equal(backtest.strategies.length, 1)
  const realStrategy = backtest.strategies[0]
  assert.equal(realStrategy.status, 'completed')
  assert.ok(realStrategy.equityCurve.length >= 30, 'expected real-data curve with >=30 points')
  assert.ok(realStrategy.drawdownCurve.length === realStrategy.equityCurve.length)
  assert.ok(typeof realStrategy.metrics.totalReturnPercent === 'number')
  assert.ok(typeof realStrategy.metrics.maxDrawdownPercent === 'number')
  assert.ok((realStrategy.dataCoverage.priceCoveragePercent || 0) > 0)

  console.log(JSON.stringify({
    ok: true,
    userId: user.id,
    openPositionCount,
    schemaVersion: result.schemaVersion,
    dataQuality: result.dataQuality,
    strategies: result.strategies.map((strategy) => ({
      strategyId: strategy.strategyId,
      source: strategy.source,
      status: strategy.validation.status,
      componentCount: strategy.components.length,
      snapshot: strategy.snapshot,
      blockedReasons: strategy.validation.blockedReasons,
      warnings: strategy.validation.warnings,
    })),
    prohibitedActions: result.prohibitedActions,
    notTradingAdvice: result.notTradingAdvice,
    realDataBacktest: {
      selectedAssets,
      priceSource: selectedAssets.every((item) => 'source' in item && item.source === 'market_bar_canonical') ? 'market_bar_canonical' : 'price_history',
      startDate: realBacktestInput.request.startDate,
      endDate: realBacktestInput.request.endDate,
      curvePoints: realStrategy.equityCurve.length,
      status: realStrategy.status,
      metrics: realStrategy.metrics,
      dataCoverage: realStrategy.dataCoverage,
      blockedReasons: realStrategy.blockedReasons,
      warnings: realStrategy.warnings,
    },
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
