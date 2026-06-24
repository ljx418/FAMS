import { prisma } from '../../db/prisma.js'
import {
  PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
  PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
  PortfolioBacktestCurvePoint,
  PortfolioBacktestInputBuildResult,
  PortfolioBacktestResult,
  PortfolioBacktestStrategyResult,
  PortfolioStrategyDefinition,
} from './portfolioBacktestTypes.js'
import { portfolioBenchmarkService } from './portfolioBenchmarkService.js'

type PriceSeries = Map<string, number>
type PriceSource = 'price_history' | 'market_bar_canonical'

type LoadedPriceSeries = {
  source: PriceSource
  series: PriceSeries
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function round(value: number | null | undefined, digits = 4) {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function annualizationFactor(days: number) {
  return days > 0 ? 365 / days : 0
}

export class PortfolioBacktestEngine {
  async run(input: PortfolioBacktestInputBuildResult): Promise<PortfolioBacktestResult> {
    const strategies: PortfolioBacktestStrategyResult[] = []
    for (const definition of input.strategies) {
      strategies.push(await this.runStrategy(definition, input))
    }

    return {
      schemaVersion: 'portfolio.strategy_backtest.result.v1',
      generatedAt: new Date().toISOString(),
      userId: input.request.userId,
      request: input.request,
      strategies,
      allowedActions: PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
      prohibitedActions: PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
  }

  private async runStrategy(
    definition: PortfolioStrategyDefinition,
    input: PortfolioBacktestInputBuildResult,
  ): Promise<PortfolioBacktestStrategyResult> {
    const blockedReasons = [...definition.validation.blockedReasons]
    const warnings = [...definition.validation.warnings]
    const missingSymbols: string[] = []

    if (definition.validation.status !== 'valid') {
      return this.insufficient(definition, blockedReasons, warnings, missingSymbols)
    }

    const seriesBySymbol = new Map<string, PriceSeries>()
    const priceSourcesBySymbol = new Map<string, PriceSource>()
    for (const component of definition.components) {
      if (component.assetClass === 'cash') continue
      const symbol = component.symbol || component.proxySymbol
      if (!symbol) {
        missingSymbols.push(`${component.assetClass}:symbol_missing`)
        continue
      }
      const loaded = await this.loadPriceSeries(symbol, input.request.startDate, input.request.endDate)
      if (loaded.series.size < 2) {
        missingSymbols.push(symbol)
        continue
      }
      seriesBySymbol.set(symbol, loaded.series)
      priceSourcesBySymbol.set(symbol, loaded.source)
    }

    if (missingSymbols.length > 0) {
      blockedReasons.push(...missingSymbols.map((symbol) => `price_history_missing:${symbol}`))
    }

    const dates = this.resolveCommonDates(definition, seriesBySymbol)
    if (dates.length < 2) {
      blockedReasons.push('common_price_dates_insufficient')
      return this.insufficient(definition, blockedReasons, warnings, missingSymbols)
    }

    const initialCapital = input.request.initialCapital
    let portfolioValue = initialCapital
    let peak = initialCapital
    let lastValue = initialCapital
    let turnoverNotional = 0
    const shares = new Map<string, number>()
    const equityCurve: PortfolioBacktestCurvePoint[] = []
    const dailyReturns: number[] = []
    let lastRebalanceKey = ''
    const benchmarks = await portfolioBenchmarkService.buildBenchmarks(input.request.benchmarkIds, dates, input.request.startDate, input.request.endDate)

    for (let index = 0; index < dates.length; index += 1) {
      const date = dates[index]
      const shouldRebalance = index === 0 || this.shouldRebalance(date, lastRebalanceKey, input.request.rebalanceFrequency)
      if (shouldRebalance) {
        const rebalanceResult = this.rebalance(definition, seriesBySymbol, date, portfolioValue, shares)
        turnoverNotional += rebalanceResult.turnover
        portfolioValue -= rebalanceResult.cost
        lastRebalanceKey = this.rebalanceKey(date, input.request.rebalanceFrequency)
      }

      portfolioValue = this.valuePortfolio(definition, seriesBySymbol, date, shares, portfolioValue)
      peak = Math.max(peak, portfolioValue)
      const dailyReturnPercent = index === 0 ? 0 : ((portfolioValue / lastValue) - 1) * 100
      if (index > 0) dailyReturns.push(dailyReturnPercent / 100)
      const drawdownPercent = peak > 0 ? ((portfolioValue / peak) - 1) * 100 : 0
      equityCurve.push({
        date,
        netValue: round(portfolioValue / initialCapital, 6) || 0,
        cumulativeReturnPercent: round(((portfolioValue / initialCapital) - 1) * 100, 4) || 0,
        dailyReturnPercent: round(dailyReturnPercent, 4) || 0,
        drawdownPercent: round(drawdownPercent, 4) || 0,
        benchmark: portfolioBenchmarkService.curvePointBenchmark(benchmarks.seriesById, date),
      })
      lastValue = portfolioValue
    }

    const benchmarkReturnPercent = portfolioBenchmarkService.benchmarkReturnPercent(benchmarks.seriesById, input.request.benchmarkIds)
    const dividendContributionPercent = await this.estimateDividendContributionPercent(definition, input, dates)
    const metrics = this.metrics(equityCurve, dailyReturns, turnoverNotional, initialCapital, benchmarkReturnPercent, dividendContributionPercent)
    const requestedDays = Math.max(1, Math.round((new Date(input.request.endDate).getTime() - new Date(input.request.startDate).getTime()) / 86400000) + 1)
    const priceCoveragePercent = round((dates.length / requestedDays) * 100, 2) || 0

    return {
      definition,
      status: blockedReasons.length > 0 ? 'partial' : 'completed',
      equityCurve,
      drawdownCurve: equityCurve.map((point) => ({ date: point.date, drawdownPercent: point.drawdownPercent })),
      metrics,
      dataCoverage: {
        priceCoveragePercent,
        dividendCoveragePercent: dividendContributionPercent === null ? 0 : 100,
        benchmarkCoveragePercent: benchmarks.coveragePercent,
        missingSymbols,
      },
      blockedReasons,
      warnings: [
        ...warnings,
        ...benchmarks.warnings,
        ...Object.entries(benchmarks.statusById).map(([id, status]) => `benchmark_status:${id}:${status}`),
        ...(dividendContributionPercent === null
          ? ['dividend_contribution_insufficient:no_audited_component_yield']
          : ['dividend_contribution_estimated_from_ttm_yield_research_only']),
      ],
      evidenceRefs: [
        ...definition.evidenceRefs,
        ...benchmarks.evidenceRefs,
        `portfolio-backtest:price-source:${Array.from(new Set(priceSourcesBySymbol.values())).join('+')}:${input.request.startDate}:${input.request.endDate}`,
      ],
    }
  }

  private async loadPriceSeries(symbol: string, startDate: string, endDate: string): Promise<LoadedPriceSeries> {
    const asset = await prisma.asset.findFirst({
      where: { symbol },
      select: { id: true },
    })
    if (asset) {
      const rows = await prisma.priceHistory.findMany({
        where: {
          assetId: asset.id,
          isValid: true,
          timestamp: {
            gte: new Date(startDate),
            lte: new Date(`${endDate}T23:59:59.999Z`),
          },
        },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, closePrice: true },
      })

      const priceHistorySeries = new Map(rows.filter((row) => row.closePrice > 0).map((row) => [isoDate(row.timestamp), row.closePrice]))
      if (priceHistorySeries.size >= 2) {
        return { source: 'price_history', series: priceHistorySeries }
      }
    }

    const canonicalRows = await prisma.marketBarCanonical.findMany({
      where: {
        symbol,
        market: 'CN',
        timeframe: '1d',
        adjustType: 'none',
        dataVersion: 'canonical.v1',
        tradeDate: {
          gte: new Date(startDate),
          lte: new Date(`${endDate}T23:59:59.999Z`),
        },
      },
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true, closePrice: true },
    })

    return {
      source: 'market_bar_canonical',
      series: new Map(canonicalRows.filter((row) => row.closePrice > 0).map((row) => [isoDate(row.tradeDate), row.closePrice])),
    }
  }

  private resolveCommonDates(definition: PortfolioStrategyDefinition, seriesBySymbol: Map<string, PriceSeries>) {
    const nonCashSymbols = definition.components
      .filter((component) => component.assetClass !== 'cash')
      .map((component) => component.symbol || component.proxySymbol)
      .filter((symbol): symbol is string => Boolean(symbol))
      .filter((symbol) => seriesBySymbol.has(symbol))

    if (nonCashSymbols.length === 0) return []
    let dates = Array.from(seriesBySymbol.get(nonCashSymbols[0])!.keys())
    for (const symbol of nonCashSymbols.slice(1)) {
      const current = seriesBySymbol.get(symbol)!
      dates = dates.filter((date) => current.has(date))
    }
    return dates.sort()
  }

  private shouldRebalance(date: string, lastKey: string, frequency: string) {
    if (frequency === 'none') return lastKey === ''
    const key = this.rebalanceKey(date, frequency)
    return key !== lastKey
  }

  private rebalanceKey(date: string, frequency: string) {
    const [year, month] = date.split('-').map(Number)
    if (frequency === 'monthly') return `${year}-${month}`
    if (frequency === 'quarterly') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
    if (frequency === 'annually') return `${year}`
    return 'none'
  }

  private rebalance(
    definition: PortfolioStrategyDefinition,
    seriesBySymbol: Map<string, PriceSeries>,
    date: string,
    portfolioValue: number,
    shares: Map<string, number>,
  ) {
    let turnover = 0
    for (const component of definition.components) {
      if (component.assetClass === 'cash') continue
      const symbol = component.symbol || component.proxySymbol
      if (!symbol) continue
      const price = seriesBySymbol.get(symbol)?.get(date)
      if (!price || price <= 0) continue
      const targetValue = portfolioValue * (component.targetWeightPercent / 100)
      const currentValue = (shares.get(symbol) || 0) * price
      turnover += Math.abs(targetValue - currentValue)
      shares.set(symbol, targetValue / price)
    }
    const cost = turnover * (definition.costModel.feeRate + definition.costModel.slippageRate)
    return { turnover, cost }
  }

  private valuePortfolio(
    definition: PortfolioStrategyDefinition,
    seriesBySymbol: Map<string, PriceSeries>,
    date: string,
    shares: Map<string, number>,
    currentValue: number,
  ) {
    let value = 0
    let investedWeight = 0
    for (const component of definition.components) {
      if (component.assetClass === 'cash') continue
      const symbol = component.symbol || component.proxySymbol
      const price = symbol ? seriesBySymbol.get(symbol)?.get(date) : undefined
      if (!symbol || !price) continue
      value += (shares.get(symbol) || 0) * price
      investedWeight += component.targetWeightPercent
    }
    const cashWeight = Math.max(0, 100 - investedWeight)
    if (cashWeight > 0) {
      value += currentValue * (cashWeight / 100)
    }
    return value
  }

  private metrics(
    equityCurve: PortfolioBacktestCurvePoint[],
    dailyReturns: number[],
    turnoverNotional: number,
    initialCapital: number,
    benchmarkReturnPercent: number | null,
    dividendContributionPercent: number | null,
  ) {
    const first = equityCurve[0]
    const last = equityCurve[equityCurve.length - 1]
    if (!first || !last) {
      return {
        totalReturnPercent: null,
        annualizedReturnPercent: null,
        maxDrawdownPercent: null,
        volatilityPercent: null,
        sharpe: null,
        calmar: null,
        monthlyWinRate: null,
        turnoverRate: null,
        dividendContributionPercent: null,
        capitalGainContributionPercent: null,
        benchmarkReturnPercent: null,
        excessReturnPercent: null,
      }
    }

    const totalReturnPercent = last.cumulativeReturnPercent
    const days = Math.max(1, equityCurve.length)
    const annualizedReturnPercent = ((1 + totalReturnPercent / 100) ** annualizationFactor(days) - 1) * 100
    const mean = dailyReturns.length ? dailyReturns.reduce((sum, item) => sum + item, 0) / dailyReturns.length : 0
    const variance = dailyReturns.length ? dailyReturns.reduce((sum, item) => sum + ((item - mean) ** 2), 0) / dailyReturns.length : 0
    const volatilityPercent = Math.sqrt(variance) * Math.sqrt(252) * 100
    const sharpe = volatilityPercent > 0 ? annualizedReturnPercent / volatilityPercent : null
    const maxDrawdownPercent = Math.min(...equityCurve.map((point) => point.drawdownPercent))
    const calmar = Math.abs(maxDrawdownPercent) > 0 ? annualizedReturnPercent / Math.abs(maxDrawdownPercent) : null
    const positiveMonths = new Set<string>()
    const months = new Set<string>()
    for (const point of equityCurve) {
      const month = point.date.slice(0, 7)
      months.add(month)
      if ((point.dailyReturnPercent || 0) > 0) positiveMonths.add(month)
    }

    const resolvedDividendContributionPercent = dividendContributionPercent === null ? null : Math.max(0, dividendContributionPercent)
    const capitalGainContributionPercent = resolvedDividendContributionPercent === null
      ? totalReturnPercent
      : totalReturnPercent - resolvedDividendContributionPercent

    return {
      totalReturnPercent: round(totalReturnPercent, 4),
      annualizedReturnPercent: round(annualizedReturnPercent, 4),
      maxDrawdownPercent: round(maxDrawdownPercent, 4),
      volatilityPercent: round(volatilityPercent, 4),
      sharpe: round(sharpe, 4),
      calmar: round(calmar, 4),
      monthlyWinRate: months.size > 0 ? round((positiveMonths.size / months.size) * 100, 4) : null,
      turnoverRate: round((turnoverNotional / initialCapital) * 100, 4),
      dividendContributionPercent: round(resolvedDividendContributionPercent, 4),
      capitalGainContributionPercent: round(capitalGainContributionPercent, 4),
      benchmarkReturnPercent: benchmarkReturnPercent === null ? null : round(benchmarkReturnPercent, 4),
      excessReturnPercent: benchmarkReturnPercent === null ? null : round(totalReturnPercent - benchmarkReturnPercent, 4),
    }
  }

  private async estimateDividendContributionPercent(
    definition: PortfolioStrategyDefinition,
    input: PortfolioBacktestInputBuildResult,
    dates: string[],
  ) {
    if (input.request.dividendMode !== 'cash' && input.request.dividendMode !== 'reinvest') return null
    const nonCashComponents = definition.components.filter((component) => component.assetClass !== 'cash')
    if (nonCashComponents.length === 0 || dates.length < 2) return null

    const years = Math.max(0, dates.length / 252)
    let weightedYield = 0
    let coveredWeight = 0
    for (const component of nonCashComponents) {
      const symbol = component.symbol || component.proxySymbol
      if (!symbol) continue
      const fact = await prisma.dividendLowVolDaily.findFirst({
        where: {
          symbol,
          ttmDividendYield: { not: null },
        },
        orderBy: { tradeDate: 'desc' },
        select: { ttmDividendYield: true },
      })
      const yieldValue = fact?.ttmDividendYield
      if (yieldValue === null || yieldValue === undefined || !Number.isFinite(yieldValue) || yieldValue <= 0) continue
      const normalizedYield = yieldValue > 1 ? yieldValue / 100 : yieldValue
      weightedYield += (component.targetWeightPercent / 100) * normalizedYield
      coveredWeight += component.targetWeightPercent
    }

    if (coveredWeight <= 0 || weightedYield <= 0) return null
    return weightedYield * years * 100
  }

  private insufficient(
    definition: PortfolioStrategyDefinition,
    blockedReasons: string[],
    warnings: string[],
    missingSymbols: string[],
  ): PortfolioBacktestStrategyResult {
    return {
      definition,
      status: 'insufficient',
      equityCurve: [],
      drawdownCurve: [],
      metrics: {
        totalReturnPercent: null,
        annualizedReturnPercent: null,
        maxDrawdownPercent: null,
        volatilityPercent: null,
        sharpe: null,
        calmar: null,
        monthlyWinRate: null,
        turnoverRate: null,
        dividendContributionPercent: null,
        capitalGainContributionPercent: null,
        benchmarkReturnPercent: null,
        excessReturnPercent: null,
      },
      dataCoverage: {
        priceCoveragePercent: 0,
        dividendCoveragePercent: 0,
        benchmarkCoveragePercent: 0,
        missingSymbols,
      },
      blockedReasons,
      warnings,
      evidenceRefs: definition.evidenceRefs,
    }
  }
}

export const portfolioBacktestEngine = new PortfolioBacktestEngine()
