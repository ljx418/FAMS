import { prisma } from '../../db/prisma.js'
import {
  PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
  PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
  PortfolioBacktestCurvePoint,
  PortfolioBacktestFormalReviewReadiness,
  PortfolioBacktestInputBuildResult,
  PortfolioBacktestResult,
  PortfolioBacktestStrategyResult,
  PortfolioDataGradeAudit,
  PortfolioDataGradeItem,
  PortfolioFormalTradingUnlockChecklist,
  PortfolioManualPlanDraft,
  PortfolioModelEffectiveness,
  PortfolioModelEffectivenessStatus,
  PortfolioSourceDataGrade,
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
    const formalReviewReadiness = await this.buildFormalReviewReadiness(input, strategies)
    const dataGradeAudit = this.aggregateDataGradeAudit(strategies)
    const modelEffectiveness = this.aggregateModelEffectiveness(strategies)
    const manualPlanDrafts = strategies.map((strategy) => strategy.manualPlanDraft).filter((draft): draft is PortfolioManualPlanDraft => Boolean(draft))
    const formalTradingUnlockChecklist = this.buildFormalTradingUnlockChecklist(formalReviewReadiness, dataGradeAudit, modelEffectiveness)

    return {
      schemaVersion: 'portfolio.strategy_backtest.result.v1',
      generatedAt: new Date().toISOString(),
      userId: input.request.userId,
      request: input.request,
      strategies,
      allowedActions: PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
      prohibitedActions: PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
      notTradingAdvice: true,
      runtimeHealth: input.runtimeHealth,
      formalReviewReadiness,
      dataGradeAudit,
      modelEffectiveness,
      manualPlanDrafts,
      formalTradingUnlockChecklist,
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
    let totalCost = 0
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
        totalCost += rebalanceResult.cost
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
    const metrics = this.metrics(equityCurve, dailyReturns, turnoverNotional, totalCost, initialCapital, benchmarkReturnPercent, dividendContributionPercent)
    const requestedCalendarDays = Math.max(1, Math.round((new Date(input.request.endDate).getTime() - new Date(input.request.startDate).getTime()) / 86400000) + 1)
    const expectedTradingDays = Math.max(1, Math.round(requestedCalendarDays * (252 / 365)))
    const priceCoveragePercent = Math.min(100, round((dates.length / expectedTradingDays) * 100, 2) || 0)
    const formalReviewReadiness = await this.buildStrategyFormalReviewReadiness(input, definition, dates, benchmarks.statusById, dividendContributionPercent, blockedReasons, warnings)
    const evidenceRefs = [
      ...definition.evidenceRefs,
      ...benchmarks.evidenceRefs,
      `portfolio-backtest:price-source:${Array.from(new Set(priceSourcesBySymbol.values())).join('+')}:${input.request.startDate}:${input.request.endDate}`,
    ]
    const dataGradeAudit = this.buildStrategyDataGradeAudit({
      priceCoveragePercent,
      benchmarkStatuses: benchmarks.statusById,
      benchmarkCoveragePercent: benchmarks.coveragePercent,
      dividendContributionPercent,
      formalReviewReadiness,
      evidenceRefs,
      warnings: [
        ...warnings,
        ...benchmarks.warnings,
        ...Object.entries(benchmarks.statusById).map(([id, status]) => `benchmark_status:${id}:${status}`),
      ],
    })
    const modelEffectiveness = this.buildStrategyModelEffectiveness(definition, equityCurve, metrics)
    const manualPlanDraft = this.buildManualPlanDraft(definition, formalReviewReadiness, modelEffectiveness, dataGradeAudit)

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
      evidenceRefs,
      formalReviewReadiness,
      dataGradeAudit,
      modelEffectiveness,
      manualPlanDraft,
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

  private async buildStrategyFormalReviewReadiness(
    input: PortfolioBacktestInputBuildResult,
    definition: PortfolioStrategyDefinition,
    dates: string[],
    benchmarkStatuses: Record<string, any>,
    dividendContributionPercent: number | null,
    blockedReasons: string[],
    warnings: string[],
  ): Promise<PortfolioBacktestFormalReviewReadiness> {
    const tradeConstraintCoverage = await this.tradeConstraintCoverage(definition, dates)
    const benchmarkReady = Object.values(benchmarkStatuses).some((status) => status === 'formal_total_return' || status === 'free_source_total_return')
    const dividendAudited = dividendContributionPercent !== null || warnings.includes('dividend_contribution_insufficient:no_audited_component_yield')
    const blockers = [
      ...(input.request.gradeMode === 'formal_review' ? [] : ['grade_mode_not_formal_review']),
      ...(blockedReasons.length === 0 ? [] : blockedReasons.map((reason) => `strategy_blocked:${reason}`)),
      ...(benchmarkReady ? [] : ['total_return_benchmark_missing']),
      ...(tradeConstraintCoverage.status === 'passed' ? [] : ['trade_constraint_coverage_blocked']),
      ...(dividendAudited ? [] : ['dividend_return_not_audited']),
    ]
    return {
      status: blockers.length === 0 ? 'passed' : 'blocked',
      ready: blockers.length === 0,
      blockers,
      warnings: [
        ...warnings,
        ...(Object.values(benchmarkStatuses).includes('free_source_total_return')
          ? ['free_source_total_return_is_formal_review_ready_not_official_authorized']
          : []),
      ],
      benchmarkStatuses,
      tradeConstraintCoverage,
      dividendReturnCoverage: {
        status: dividendAudited ? 'passed' : 'blocked',
        strategyCount: 1,
        coveredStrategies: dividendAudited ? 1 : 0,
        coveragePercent: dividendAudited ? 100 : 0,
        blockers: dividendAudited ? [] : ['dividend_return_not_audited'],
      },
    }
  }

  private async buildFormalReviewReadiness(
    input: PortfolioBacktestInputBuildResult,
    strategies: PortfolioBacktestStrategyResult[],
  ): Promise<PortfolioBacktestFormalReviewReadiness> {
    const benchmarkStatuses: Record<string, any> = {}
    for (const strategy of strategies) {
      for (const warning of strategy.warnings || []) {
        const match = warning.match(/^benchmark_status:([^:]+):(.+)$/)
        if (match) benchmarkStatuses[match[1]] = match[2]
      }
    }
    const benchmarkReady = Object.values(benchmarkStatuses).some((status) => status === 'formal_total_return' || status === 'free_source_total_return')
    const completedCount = strategies.filter((strategy) => strategy.status === 'completed').length
    const tradeConstraintCoverage = await this.aggregateTradeConstraintCoverage(input)
    const coveredStrategies = strategies.filter((strategy) => {
      if (strategy.metrics.dividendContributionPercent !== null) return true
      return strategy.warnings.includes('dividend_contribution_insufficient:no_audited_component_yield')
        || strategy.warnings.includes('dividend_contribution_estimated_from_ttm_yield_research_only')
    }).length
    const dividendReturnCoverage = {
      status: coveredStrategies === strategies.length && strategies.length > 0 ? 'passed' as const : 'blocked' as const,
      strategyCount: strategies.length,
      coveredStrategies,
      coveragePercent: strategies.length > 0 ? round((coveredStrategies / strategies.length) * 100, 2) || 0 : 0,
      blockers: coveredStrategies === strategies.length ? [] : ['dividend_return_coverage_incomplete'],
    }
    const blockers = [
      ...(input.request.gradeMode === 'formal_review' ? [] : ['grade_mode_not_formal_review']),
      ...(completedCount === strategies.length && strategies.length > 0 ? [] : [`completed_strategy_count_below_required:${completedCount}/${strategies.length}`]),
      ...(benchmarkReady ? [] : ['total_return_benchmark_missing']),
      ...(tradeConstraintCoverage.status === 'passed' ? [] : ['trade_constraint_coverage_blocked']),
      ...(dividendReturnCoverage.status === 'passed' ? [] : dividendReturnCoverage.blockers),
    ]
    return {
      status: blockers.length === 0 ? 'passed' : 'blocked',
      ready: blockers.length === 0,
      blockers,
      warnings: [
        'formal_review_ready_does_not_unlock_add_reduce_order_create_or_auto_trade',
        ...(Object.values(benchmarkStatuses).includes('free_source_total_return')
          ? ['free_source_total_return_is_formal_review_ready_not_official_authorized']
          : []),
      ],
      benchmarkStatuses,
      tradeConstraintCoverage,
      dividendReturnCoverage,
    }
  }

  private async aggregateTradeConstraintCoverage(input: PortfolioBacktestInputBuildResult) {
    const symbols = Array.from(new Set(input.strategies.flatMap((definition) => definition.components
      .filter((component) => component.assetClass !== 'cash')
      .map((component) => component.symbol || component.proxySymbol)
      .filter((symbol): symbol is string => Boolean(symbol)))))
    const dates = await this.resolveAllCommonDates(input)
    return this.tradeConstraintCoverageForSymbols(symbols, dates)
  }

  private async resolveAllCommonDates(input: PortfolioBacktestInputBuildResult) {
    const dates = new Set<string>()
    for (const definition of input.strategies) {
      for (const component of definition.components) {
        if (component.assetClass === 'cash') continue
        const symbol = component.symbol || component.proxySymbol
        if (!symbol) continue
        const loaded = await this.loadPriceSeries(symbol, input.request.startDate, input.request.endDate)
        for (const date of loaded.series.keys()) dates.add(date)
      }
    }
    return Array.from(dates).sort()
  }

  private async tradeConstraintCoverage(definition: PortfolioStrategyDefinition, dates: string[]) {
    const symbols = Array.from(new Set(definition.components
      .filter((component) => component.assetClass !== 'cash')
      .map((component) => component.symbol || component.proxySymbol)
      .filter((symbol): symbol is string => Boolean(symbol))))
    return this.tradeConstraintCoverageForSymbols(symbols, dates)
  }

  private async tradeConstraintCoverageForSymbols(symbols: string[], dates: string[]) {
    if (symbols.length === 0 || dates.length === 0) {
      return {
        status: 'blocked' as const,
        requiredRows: symbols.length * dates.length,
        coveredRows: 0,
        coveragePercent: 0,
        missingSymbols: symbols,
        evidenceRefs: [],
      }
    }
    const rows = await prisma.marketTradeabilityDaily.findMany({
      where: {
        symbol: { in: symbols },
        market: 'CN',
        dataVersion: 'tradeability.v1',
        tradeDate: {
          gte: new Date(`${dates[0]}T00:00:00.000Z`),
          lte: new Date(`${dates.at(-1)}T23:59:59.999Z`),
        },
      },
      select: {
        symbol: true,
        tradeDate: true,
        isTradable: true,
        tradabilityStatus: true,
        isSuspended: true,
        limitUp: true,
        limitDown: true,
        provider: true,
        sourceRefsJson: true,
      },
    })
    const dateSet = new Set(dates)
    const covered = rows.filter((row) => dateSet.has(isoDate(row.tradeDate)) && row.limitUp !== null && row.limitDown !== null)
    const coveredBySymbol = new Set(covered.map((row) => row.symbol))
    const requiredRows = symbols.length * dates.length
    const coveragePercent = requiredRows > 0 ? round((covered.length / requiredRows) * 100, 2) || 0 : 0
    return {
      status: coveragePercent >= 80 && symbols.every((symbol) => coveredBySymbol.has(symbol)) ? 'passed' as const : 'blocked' as const,
      requiredRows,
      coveredRows: covered.length,
      coveragePercent,
      missingSymbols: symbols.filter((symbol) => !coveredBySymbol.has(symbol)),
      evidenceRefs: [
        `market_tradeability_daily:${dates[0]}:${dates.at(-1)}:symbols:${symbols.length}:covered:${covered.length}`,
        ...Array.from(new Set(covered.slice(0, 20).map((row) => `market_tradeability_daily:${row.symbol}:${isoDate(row.tradeDate)}:${row.provider}`))),
      ],
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
    totalCost: number,
    initialCapital: number,
    benchmarkReturnPercent: number | null,
    dividendContributionPercent: number | null,
  ) {
    const first = equityCurve[0]
    const last = equityCurve[equityCurve.length - 1]
    if (!first || !last) {
      return {
        totalReturnPercent: null,
        priceOnlyReturnPercent: null,
        annualizedReturnPercent: null,
        maxDrawdownPercent: null,
        volatilityPercent: null,
        sharpe: null,
        calmar: null,
        monthlyWinRate: null,
        turnoverRate: null,
        dividendContributionPercent: null,
        capitalGainContributionPercent: null,
        costDragPercent: null,
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
      priceOnlyReturnPercent: round(totalReturnPercent, 4),
      annualizedReturnPercent: round(annualizedReturnPercent, 4),
      maxDrawdownPercent: round(maxDrawdownPercent, 4),
      volatilityPercent: round(volatilityPercent, 4),
      sharpe: round(sharpe, 4),
      calmar: round(calmar, 4),
      monthlyWinRate: months.size > 0 ? round((positiveMonths.size / months.size) * 100, 4) : null,
      turnoverRate: round((turnoverNotional / initialCapital) * 100, 4),
      dividendContributionPercent: round(resolvedDividendContributionPercent, 4),
      capitalGainContributionPercent: round(capitalGainContributionPercent, 4),
      costDragPercent: round((totalCost / initialCapital) * 100, 4),
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

  private buildStrategyDataGradeAudit(args: {
    priceCoveragePercent: number
    benchmarkStatuses: Record<string, any>
    benchmarkCoveragePercent: number
    dividendContributionPercent: number | null
    formalReviewReadiness: PortfolioBacktestFormalReviewReadiness
    evidenceRefs: string[]
    warnings: string[]
  }): PortfolioDataGradeAudit {
    const benchmarkGrade = this.benchmarkGrade(Object.values(args.benchmarkStatuses))
    const items: PortfolioDataGradeItem[] = [
      {
        scope: 'price',
        grade: args.priceCoveragePercent >= 80 ? 'free_source_cross_checked' : 'insufficient',
        sourceProvider: 'price_history+market_bar_canonical',
        sourceType: 'historical_close',
        freshnessStatus: args.priceCoveragePercent >= 80 ? 'fresh' : 'unknown',
        coveragePercent: args.priceCoveragePercent,
        blockingForFormalTrading: args.priceCoveragePercent < 80,
        evidenceRefs: args.evidenceRefs.filter((ref) => ref.includes('price-source') || ref.includes('market_bar') || ref.includes('price_history')),
        warnings: args.priceCoveragePercent >= 80 ? [] : ['price_coverage_below_80_percent'],
      },
      {
        scope: 'benchmark',
        grade: benchmarkGrade,
        sourceProvider: Object.entries(args.benchmarkStatuses).map(([id, status]) => `${id}:${status}`).join(',') || 'none',
        sourceType: 'benchmark_curve',
        freshnessStatus: args.benchmarkCoveragePercent >= 80 ? 'fresh' : 'unknown',
        coveragePercent: args.benchmarkCoveragePercent,
        blockingForFormalTrading: benchmarkGrade !== 'official_authorized' && benchmarkGrade !== 'free_source_cross_checked',
        evidenceRefs: args.evidenceRefs.filter((ref) => ref.includes('benchmark') || ref.includes('index')),
        warnings: args.warnings.filter((warning) => warning.includes('benchmark')),
      },
      {
        scope: 'dividend',
        grade: args.dividendContributionPercent === null ? 'insufficient' : 'free_source_cross_checked',
        sourceProvider: 'dividend_low_vol_daily',
        sourceType: 'estimated_ttm_dividend_yield',
        freshnessStatus: args.dividendContributionPercent === null ? 'unknown' : 'fresh',
        coveragePercent: args.dividendContributionPercent === null ? 0 : 100,
        blockingForFormalTrading: args.dividendContributionPercent === null,
        evidenceRefs: args.evidenceRefs.filter((ref) => ref.includes('dividend')),
        warnings: args.dividendContributionPercent === null
          ? ['dividend_contribution_insufficient:no_audited_component_yield']
          : ['dividend_contribution_estimated_from_ttm_yield_research_only'],
      },
      {
        scope: 'tradeability',
        grade: args.formalReviewReadiness.tradeConstraintCoverage.status === 'passed' ? 'free_source_cross_checked' : 'insufficient',
        sourceProvider: 'market_tradeability_daily',
        sourceType: 'limit_up_down_and_suspension_state',
        freshnessStatus: args.formalReviewReadiness.tradeConstraintCoverage.status === 'passed' ? 'fresh' : 'unknown',
        coveragePercent: args.formalReviewReadiness.tradeConstraintCoverage.coveragePercent,
        blockingForFormalTrading: args.formalReviewReadiness.tradeConstraintCoverage.status !== 'passed',
        evidenceRefs: args.formalReviewReadiness.tradeConstraintCoverage.evidenceRefs,
        warnings: args.formalReviewReadiness.tradeConstraintCoverage.status === 'passed' ? [] : ['trade_constraint_coverage_blocked'],
      },
    ]

    const blockers = items
      .filter((item) => item.blockingForFormalTrading)
      .map((item) => `${item.scope}_data_grade_blocked:${item.grade}`)

    return {
      status: blockers.length === 0 ? 'passed' : 'blocked',
      aggregateGrade: this.aggregateGrade(items),
      formalTradingEligible: false,
      items,
      blockers,
    }
  }

  private aggregateDataGradeAudit(strategies: PortfolioBacktestStrategyResult[]): PortfolioDataGradeAudit {
    const items = strategies.flatMap((strategy) => strategy.dataGradeAudit?.items || [])
    const blockers = Array.from(new Set(strategies.flatMap((strategy) => strategy.dataGradeAudit?.blockers || [])))
    return {
      status: blockers.length === 0 && items.length > 0 ? 'passed' : blockers.length > 0 ? 'blocked' : 'warning',
      aggregateGrade: this.aggregateGrade(items),
      formalTradingEligible: false,
      items,
      blockers,
    }
  }

  private benchmarkGrade(statuses: any[]): PortfolioSourceDataGrade {
    if (statuses.includes('formal_total_return')) return 'official_authorized'
    if (statuses.includes('free_source_total_return')) return 'free_source_cross_checked'
    if (statuses.includes('price_index')) return 'price_index_only'
    if (statuses.includes('research_proxy')) return 'research_proxy'
    return 'insufficient'
  }

  private aggregateGrade(items: PortfolioDataGradeItem[]): PortfolioSourceDataGrade {
    if (items.length === 0) return 'insufficient'
    const rank: Record<PortfolioSourceDataGrade, number> = {
      official_authorized: 4,
      free_source_cross_checked: 3,
      price_index_only: 2,
      research_proxy: 1,
      insufficient: 0,
    }
    return items.reduce<PortfolioSourceDataGrade>((worst, item) => (rank[item.grade] < rank[worst] ? item.grade : worst), 'official_authorized')
  }

  private buildStrategyModelEffectiveness(
    definition: PortfolioStrategyDefinition,
    equityCurve: PortfolioBacktestCurvePoint[],
    metrics: PortfolioBacktestStrategyResult['metrics'],
  ): PortfolioModelEffectiveness {
    const failureTaxonomy: string[] = []
    if (equityCurve.length < 60) failureTaxonomy.push(`effective_path_count_below_60:${equityCurve.length}`)

    const splitIndex = Math.max(1, Math.floor(equityCurve.length * 0.6))
    const first = equityCurve[0]
    const split = equityCurve[splitIndex]
    const last = equityCurve.at(-1)
    const inSampleReturnPercent = first && split ? round(((split.netValue / first.netValue) - 1) * 100, 4) : null
    const outOfSampleReturnPercent = split && last ? round(((last.netValue / split.netValue) - 1) * 100, 4) : null
    const outOfSampleExcessReturnPercent = outOfSampleReturnPercent !== null && metrics.benchmarkReturnPercent !== null
      ? round(outOfSampleReturnPercent - (metrics.benchmarkReturnPercent * 0.4), 4)
      : null

    const walkForwardWindows = equityCurve.length >= 60 ? 6 : 0
    let walkForwardPassedWindows = 0
    if (walkForwardWindows > 0) {
      const windowSize = Math.floor(equityCurve.length / walkForwardWindows)
      for (let index = 0; index < walkForwardWindows; index += 1) {
        const start = equityCurve[index * windowSize]
        const end = equityCurve[Math.min(((index + 1) * windowSize) - 1, equityCurve.length - 1)]
        const windowReturn = start && end ? ((end.netValue / start.netValue) - 1) * 100 : null
        if (windowReturn !== null && windowReturn >= -8) walkForwardPassedWindows += 1
      }
      if (walkForwardPassedWindows / walkForwardWindows < 0.6) {
        failureTaxonomy.push(`walk_forward_pass_ratio_below_60:${walkForwardPassedWindows}/${walkForwardWindows}`)
      }
    } else {
      failureTaxonomy.push('walk_forward_windows_insufficient')
    }

    if (outOfSampleReturnPercent !== null && outOfSampleReturnPercent < 0) {
      failureTaxonomy.push(`out_of_sample_return_negative:${outOfSampleReturnPercent}`)
    }
    if (outOfSampleExcessReturnPercent !== null && outOfSampleExcessReturnPercent < 0) {
      failureTaxonomy.push(`out_of_sample_excess_return_negative:${outOfSampleExcessReturnPercent}`)
    }
    if (metrics.maxDrawdownPercent !== null && metrics.maxDrawdownPercent < -35) {
      failureTaxonomy.push(`max_drawdown_below_minus_35:${metrics.maxDrawdownPercent}`)
    }

    const parameterSensitivityStatus: PortfolioModelEffectivenessStatus = 'insufficient'
    const groupStabilityStatus: PortfolioModelEffectiveness['groupStabilityStatus'] =
      definition.source === 'dividend_low_vol' ? 'insufficient' : 'not_applicable'
    failureTaxonomy.push('parameter_sensitivity_not_replayed_yet')
    if (groupStabilityStatus === 'insufficient') failureTaxonomy.push('group_stability_not_replayed_yet')

    const hardFailed = failureTaxonomy.some((item) => item.startsWith('max_drawdown_below_minus_35'))
    const status: PortfolioModelEffectivenessStatus = hardFailed
      ? 'failed'
      : failureTaxonomy.length > 0
        ? (equityCurve.length < 60 ? 'insufficient' : 'warning')
        : 'passed'

    return {
      status,
      inSampleReturnPercent,
      outOfSampleReturnPercent,
      outOfSampleExcessReturnPercent,
      maxDrawdownPercent: metrics.maxDrawdownPercent,
      walkForwardWindows,
      walkForwardPassedWindows,
      parameterSensitivityStatus,
      groupStabilityStatus,
      failureTaxonomy: Array.from(new Set(failureTaxonomy)),
      evidenceRefs: [
        `portfolio-model-effectiveness:${definition.strategyId}:curve_points:${equityCurve.length}`,
        ...definition.evidenceRefs,
      ],
    }
  }

  private aggregateModelEffectiveness(strategies: PortfolioBacktestStrategyResult[]): NonNullable<PortfolioBacktestResult['modelEffectiveness']> {
    const items = strategies.map((strategy) => strategy.modelEffectiveness).filter((item): item is PortfolioModelEffectiveness => Boolean(item))
    const blockers = Array.from(new Set(items.flatMap((item) => item.failureTaxonomy)))
    return {
      status: items.some((item) => item.status === 'failed')
        ? 'failed'
        : items.some((item) => item.status === 'insufficient')
          ? 'insufficient'
          : items.some((item) => item.status === 'warning')
            ? 'warning'
            : 'passed',
      strategyCount: items.length,
      passedStrategies: items.filter((item) => item.status === 'passed').length,
      warningStrategies: items.filter((item) => item.status === 'warning').length,
      insufficientStrategies: items.filter((item) => item.status === 'insufficient').length,
      failedStrategies: items.filter((item) => item.status === 'failed').length,
      blockers,
    }
  }

  private buildManualPlanDraft(
    definition: PortfolioStrategyDefinition,
    formalReviewReadiness: PortfolioBacktestFormalReviewReadiness,
    modelEffectiveness: PortfolioModelEffectiveness,
    dataGradeAudit: PortfolioDataGradeAudit,
  ): PortfolioManualPlanDraft {
    const dataBlocked = dataGradeAudit.blockers
    const modelBlocked = modelEffectiveness.status === 'passed' ? [] : modelEffectiveness.failureTaxonomy
    const blockedReasons = Array.from(new Set([
      'formal_trading_not_unlocked',
      'manual_review_not_completed',
      ...formalReviewReadiness.blockers,
      ...dataBlocked,
      ...modelBlocked,
    ]))
    return {
      status: blockedReasons.length === 0 ? 'draft_ready' : 'blocked',
      draftType: 'PLAN_DRAFT',
      strategyId: definition.strategyId,
      currentWeightPercent: definition.source === 'current_holdings' ? 100 : null,
      researchTargetWeightPercent: 100,
      formalTargetWeightPercent: 0,
      driftPercent: definition.source === 'current_holdings' ? 0 : null,
      suggestedActionTypes: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
      portfolioRiskCheck: 'insufficient',
      tradeabilityCheck: formalReviewReadiness.tradeConstraintCoverage.status === 'passed' ? 'passed' : 'blocked',
      priceFreshnessCheck: dataGradeAudit.items.find((item) => item.scope === 'price')?.grade === 'insufficient' ? 'insufficient' : 'passed',
      humanReviewChecklist: [
        'official_benchmark_or_free_source_review',
        'model_effectiveness_review',
        'trade_constraints_review',
        'portfolio_risk_review',
        'price_freshness_review',
        'final_human_confirmation',
      ],
      blockedReasons,
      evidenceRefs: [
        ...definition.evidenceRefs,
        ...formalReviewReadiness.tradeConstraintCoverage.evidenceRefs,
        ...modelEffectiveness.evidenceRefs,
      ],
    }
  }

  private buildFormalTradingUnlockChecklist(
    formalReviewReadiness: PortfolioBacktestFormalReviewReadiness,
    dataGradeAudit: PortfolioDataGradeAudit,
    modelEffectiveness: NonNullable<PortfolioBacktestResult['modelEffectiveness']>,
  ): PortfolioFormalTradingUnlockChecklist {
    const officialBenchmarkReviewed = Object.values(formalReviewReadiness.benchmarkStatuses).includes('formal_total_return')
    const modelEffectivenessReviewed = modelEffectiveness.status === 'passed'
    const tradeConstraintsReviewed = formalReviewReadiness.tradeConstraintCoverage.status === 'passed'
    const priceFreshnessReviewed = dataGradeAudit.items.some((item) => item.scope === 'price' && item.freshnessStatus === 'fresh' && item.coveragePercent >= 80)
    const blockers = Array.from(new Set([
      ...(officialBenchmarkReviewed ? [] : ['official_authorized_total_return_benchmark_not_reviewed']),
      ...(modelEffectivenessReviewed ? [] : ['model_effectiveness_not_formal_passed']),
      ...(tradeConstraintsReviewed ? [] : ['trade_constraints_not_reviewed']),
      ...(priceFreshnessReviewed ? [] : ['price_freshness_not_reviewed']),
      'portfolio_risk_manual_review_not_completed',
      'human_reviewer_confirmation_not_completed',
      'auto_trade_policy_locked',
    ]))
    return {
      status: 'blocked',
      officialBenchmarkReviewed,
      modelEffectivenessReviewed,
      tradeConstraintsReviewed,
      portfolioRiskReviewed: false,
      priceFreshnessReviewed,
      humanReviewerConfirmed: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      blockers,
    }
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
        priceOnlyReturnPercent: null,
        annualizedReturnPercent: null,
        maxDrawdownPercent: null,
        volatilityPercent: null,
        sharpe: null,
        calmar: null,
        monthlyWinRate: null,
        turnoverRate: null,
        dividendContributionPercent: null,
        capitalGainContributionPercent: null,
        costDragPercent: null,
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
      formalReviewReadiness: {
        status: 'blocked',
        ready: false,
        blockers: blockedReasons.length > 0 ? blockedReasons : ['strategy_insufficient'],
        warnings,
        benchmarkStatuses: {},
        tradeConstraintCoverage: {
          status: 'blocked',
          requiredRows: 0,
          coveredRows: 0,
          coveragePercent: 0,
          missingSymbols,
          evidenceRefs: [],
        },
        dividendReturnCoverage: {
          status: 'blocked',
          strategyCount: 1,
          coveredStrategies: 0,
          coveragePercent: 0,
          blockers: ['strategy_insufficient'],
        },
      },
      dataGradeAudit: {
        status: 'blocked',
        aggregateGrade: 'insufficient',
        formalTradingEligible: false,
        items: [
          {
            scope: 'price',
            grade: 'insufficient',
            sourceProvider: 'none',
            sourceType: 'historical_close',
            freshnessStatus: 'unknown',
            coveragePercent: 0,
            blockingForFormalTrading: true,
            evidenceRefs: definition.evidenceRefs,
            warnings,
          },
          {
            scope: 'benchmark',
            grade: 'insufficient',
            sourceProvider: 'none',
            sourceType: 'benchmark_curve',
            freshnessStatus: 'unknown',
            coveragePercent: 0,
            blockingForFormalTrading: true,
            evidenceRefs: [],
            warnings: ['strategy_insufficient'],
          },
          {
            scope: 'dividend',
            grade: 'insufficient',
            sourceProvider: 'none',
            sourceType: 'dividend_return',
            freshnessStatus: 'unknown',
            coveragePercent: 0,
            blockingForFormalTrading: true,
            evidenceRefs: [],
            warnings: ['strategy_insufficient'],
          },
          {
            scope: 'tradeability',
            grade: 'insufficient',
            sourceProvider: 'none',
            sourceType: 'limit_up_down_and_suspension_state',
            freshnessStatus: 'unknown',
            coveragePercent: 0,
            blockingForFormalTrading: true,
            evidenceRefs: [],
            warnings: ['strategy_insufficient'],
          },
        ],
        blockers: ['strategy_insufficient'],
      },
      modelEffectiveness: {
        status: 'insufficient',
        inSampleReturnPercent: null,
        outOfSampleReturnPercent: null,
        outOfSampleExcessReturnPercent: null,
        maxDrawdownPercent: null,
        walkForwardWindows: 0,
        walkForwardPassedWindows: 0,
        parameterSensitivityStatus: 'insufficient',
        groupStabilityStatus: 'insufficient',
        failureTaxonomy: ['strategy_insufficient', ...blockedReasons],
        evidenceRefs: definition.evidenceRefs,
      },
      manualPlanDraft: {
        status: 'blocked',
        draftType: 'PLAN_DRAFT',
        strategyId: definition.strategyId,
        currentWeightPercent: definition.source === 'current_holdings' ? 100 : null,
        researchTargetWeightPercent: null,
        formalTargetWeightPercent: 0,
        driftPercent: null,
        suggestedActionTypes: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
        portfolioRiskCheck: 'insufficient',
        tradeabilityCheck: 'insufficient',
        priceFreshnessCheck: 'insufficient',
        humanReviewChecklist: [
          'repair_strategy_input',
          'rerun_backtest',
          'complete_human_review',
        ],
        blockedReasons: ['strategy_insufficient', ...blockedReasons],
        evidenceRefs: definition.evidenceRefs,
      },
    }
  }
}

export const portfolioBacktestEngine = new PortfolioBacktestEngine()
