import { prisma } from '../../db/prisma.js'
import {
  PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
  PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
  PortfolioBacktestCurvePoint,
  PortfolioBacktestFormalReviewReadiness,
  PortfolioBacktestInputBuildResult,
  PortfolioBacktestReadinessSummary,
  PortfolioBacktestResult,
  PortfolioBacktestStrategyResult,
  PortfolioDataGradeAudit,
  PortfolioDataGradeItem,
  PortfolioDividendTotalReturnAudit,
  PortfolioFormalTradingUnlockChecklist,
  PortfolioExecutionIsolationAudit,
  PortfolioLongHorizonDataCoverageAudit,
  PortfolioManualPlanDraft,
  PortfolioModelEffectiveness,
  PortfolioModelEffectivenessStatus,
  PortfolioMultiPeriodBacktestResult,
  PortfolioPaperOrderIntent,
  PortfolioFormalTradingReleaseGateAudit,
  PortfolioBenchmarkQualificationAudit,
  PortfolioFormalValidationAudit,
  PortfolioManualSignoffAudit,
  PortfolioProviderClass,
  PortfolioReleaseDataGovernanceAudit,
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

type LongHorizonPeriodDefinition = {
  periodId: '1y' | '3y' | '5y' | 'custom'
  label: string
  requestedStartDate: string
  requestedEndDate: string
  requiredTradingDays: number
  requiredCalendarDays: number
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
  private priceSeriesCache = new Map<string, Promise<LoadedPriceSeries>>()

  async run(input: PortfolioBacktestInputBuildResult): Promise<PortfolioBacktestResult> {
    const strategies: PortfolioBacktestStrategyResult[] = []
    for (const definition of input.strategies) {
      strategies.push(await this.runStrategy(definition, input))
    }
    const generatedAt = new Date().toISOString()
    const runId = `portfolio-backtest-${generatedAt.replace(/[:.]/g, '-')}`
    const formalReviewReadiness = await this.buildFormalReviewReadiness(input, strategies)
    const dataGradeAudit = this.aggregateDataGradeAudit(strategies)
    const modelEffectiveness = this.aggregateModelEffectiveness(strategies)
    const manualPlanDrafts = strategies.map((strategy) => strategy.manualPlanDraft).filter((draft): draft is PortfolioManualPlanDraft => Boolean(draft))
    const formalTradingUnlockChecklist = this.buildFormalTradingUnlockChecklist(formalReviewReadiness, dataGradeAudit, modelEffectiveness)
    const readinessSummary = this.buildReadinessSummary({
      strategies,
      formalReviewReadiness,
      dataGradeAudit,
      modelEffectiveness,
      manualPlanDrafts,
      formalTradingUnlockChecklist,
    })
    const executionIsolationAudit = this.buildExecutionIsolationAudit(runId, generatedAt, manualPlanDrafts)
    const dataGovernanceAudit = this.buildDataGovernanceAudit(generatedAt, dataGradeAudit)
    const benchmarkQualificationAudit = this.buildBenchmarkQualificationAudit(formalReviewReadiness)
    const formalValidationAudit = this.buildFormalValidationAudit(strategies)
    const manualSignoffAudit = this.buildManualSignoffAudit()
    const multiPeriodBacktestResult = await this.buildMultiPeriodBacktestResult(input, strategies)
    const longHorizonDataCoverageAudit = this.buildLongHorizonDataCoverageAudit(multiPeriodBacktestResult)
    const dividendTotalReturnAudit = this.buildDividendTotalReturnAudit(input, strategies)
    const releaseGateAudit = this.buildReleaseGateAudit({
      formalReviewReadiness,
      dataGradeAudit,
      modelEffectiveness,
      formalTradingUnlockChecklist,
      readinessSummary,
      executionIsolationAudit,
      dataGovernanceAudit,
      benchmarkQualificationAudit,
      formalValidationAudit,
      manualSignoffAudit,
      longHorizonDataCoverageAudit,
      runtimeHealth: input.runtimeHealth,
    })

    return {
      schemaVersion: 'portfolio.strategy_backtest.result.v1',
      generatedAt,
      runId,
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
      readinessSummary,
      paperOrderIntents: executionIsolationAudit.intents,
      executionIsolationAudit,
      releaseGateAudit,
      dataGovernanceAudit,
      benchmarkQualificationAudit,
      formalValidationAudit,
      manualSignoffAudit,
      longHorizonDataCoverageAudit,
      multiPeriodBacktestResult,
      dividendTotalReturnAudit,
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
      asOfDate: input.request.endDate,
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
    const cacheKey = `${symbol}:${startDate}:${endDate}`
    const cached = this.priceSeriesCache.get(cacheKey)
    if (cached) return cached
    const pending = this.loadPriceSeriesUncached(symbol, startDate, endDate)
    this.priceSeriesCache.set(cacheKey, pending)
    if (this.priceSeriesCache.size > 500) {
      const firstKey = this.priceSeriesCache.keys().next().value
      if (firstKey) this.priceSeriesCache.delete(firstKey)
    }
    return pending
  }

  private async loadPriceSeriesUncached(symbol: string, startDate: string, endDate: string): Promise<LoadedPriceSeries> {
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
    asOfDate: string
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
        asOfDate: args.asOfDate,
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
        asOfDate: args.asOfDate,
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
        asOfDate: args.asOfDate,
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
        asOfDate: args.asOfDate,
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

    const sensitivityVariants = ['rebalance_monthly', 'rebalance_quarterly', 'fee_plus_20bp', 'slippage_plus_20bp', 'dividend_cash']
    const stableVariants = equityCurve.length >= 90 && metrics.maxDrawdownPercent !== null && metrics.maxDrawdownPercent >= -35
      ? sensitivityVariants.slice(0, 3)
      : []
    const resolvedParameterSensitivityStatus: PortfolioModelEffectivenessStatus = stableVariants.length >= 3 ? 'warning' : 'insufficient'
    failureTaxonomy.push(resolvedParameterSensitivityStatus === 'warning'
      ? 'parameter_sensitivity_research_proxy_not_formal_replay'
      : 'parameter_sensitivity_not_replayed_yet')

    const groupStabilityStatus: PortfolioModelEffectiveness['groupStabilityStatus'] =
      definition.source === 'dividend_low_vol'
        ? (equityCurve.length >= 90 ? 'warning' : 'insufficient')
        : 'not_applicable'
    if (groupStabilityStatus === 'warning') {
      failureTaxonomy.push('group_stability_research_proxy_not_formal_replay')
    } else if (groupStabilityStatus === 'insufficient') {
      failureTaxonomy.push('group_stability_not_replayed_yet')
    }

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
      oos: {
        status: outOfSampleReturnPercent === null
          ? 'insufficient'
          : outOfSampleReturnPercent < 0 || (outOfSampleExcessReturnPercent !== null && outOfSampleExcessReturnPercent < 0)
            ? 'warning'
            : 'passed',
        trainReturnPercent: inSampleReturnPercent,
        testReturnPercent: outOfSampleReturnPercent,
        testExcessReturnPercent: outOfSampleExcessReturnPercent,
        evidenceRefs: [`portfolio-oos:${definition.strategyId}:split:60_40`],
      },
      walkForward: {
        status: walkForwardWindows === 0
          ? 'insufficient'
          : walkForwardPassedWindows / walkForwardWindows >= 0.6
            ? 'passed'
            : 'warning',
        windows: walkForwardWindows,
        passedWindows: walkForwardPassedWindows,
        passRatioPercent: walkForwardWindows > 0 ? round((walkForwardPassedWindows / walkForwardWindows) * 100, 4) : null,
        evidenceRefs: [`portfolio-walk-forward:${definition.strategyId}:windows:${walkForwardWindows}:passed:${walkForwardPassedWindows}`],
      },
      parameterSensitivityStatus: resolvedParameterSensitivityStatus,
      parameterSensitivity: {
        status: resolvedParameterSensitivityStatus,
        testedVariants: sensitivityVariants,
        stableVariants,
        evidenceRefs: [`portfolio-parameter-sensitivity:${definition.strategyId}:research_proxy`],
        notes: [
          '当前为曲线稳定性代理审计，不替代完整参数网格重放。',
          '正式交易解锁前必须运行真实参数邻域回放。',
        ],
      },
      groupStabilityStatus,
      groupStability: {
        status: groupStabilityStatus,
        groups: definition.source === 'dividend_low_vol'
          ? [
            {
              groupId: 'dividend_low_vol_basket',
              status: groupStabilityStatus,
              evidenceRefs: definition.evidenceRefs.filter((ref) => ref.includes('dividend')),
            },
          ]
          : [
            {
              groupId: definition.source,
              status: 'not_applicable',
              evidenceRefs: definition.evidenceRefs,
            },
          ],
        evidenceRefs: [`portfolio-group-stability:${definition.strategyId}:${definition.source}`],
        notes: groupStabilityStatus === 'not_applicable'
          ? ['该预设组合不按行业/流动性分组验证。']
          : ['当前为研究级分组审计，正式交易前需补行业、市场状态和流动性分组。'],
      },
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

  private buildExecutionIsolationAudit(
    runId: string,
    generatedAt: string,
    manualPlanDrafts: PortfolioManualPlanDraft[],
  ): PortfolioExecutionIsolationAudit {
    const intents: PortfolioPaperOrderIntent[] = manualPlanDrafts.map((draft) => ({
      schemaVersion: 'portfolio.paper_order_intent.v1',
      intentId: `paper-intent:${runId}:${draft.strategyId}`,
      generatedAt,
      source: 'manual_plan_draft',
      executionMode: 'paper',
      strategyId: draft.strategyId,
      draftStatus: draft.status,
      currentWeightPercent: draft.currentWeightPercent,
      researchTargetWeightPercent: draft.researchTargetWeightPercent,
      formalTargetWeightPercent: 0,
      notionalAmount: null,
      suggestedActionTypes: draft.suggestedActionTypes,
      canCreateOrder: false,
      orderCreateAllowed: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      blockedReasons: Array.from(new Set([
        ...draft.blockedReasons,
        'production_order_adapter_not_enabled',
        'formal_trading_release_gate_not_passed',
      ])),
      evidenceRefs: draft.evidenceRefs,
      notTradingAdvice: true,
    }))

    const blockers = Array.from(new Set([
      ...(intents.length === 0 ? ['manual_plan_draft_missing'] : []),
      'production_order_adapter_not_enabled',
      'real_position_mutation_disabled',
      'formal_trading_release_gate_not_passed',
      'auto_trade_policy_locked',
    ]))

    return {
      schemaVersion: 'portfolio.execution_isolation_audit.v1',
      status: intents.length > 0 ? 'ready_for_paper_review' : 'blocked',
      mode: 'paper_sandbox_only',
      paperTradingReady: intents.length > 0,
      sandboxReady: intents.length > 0,
      productionAdapterEnabled: false,
      realPositionMutationAllowed: false,
      orderCreateAllowed: false,
      canCreateOrder: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      intents,
      blockers,
      warnings: [
        'paper_or_sandbox_intents_are_for_manual_review_only',
        'no_real_order_or_position_mutation_is_permitted',
      ],
      evidenceRefs: Array.from(new Set(intents.flatMap((intent) => intent.evidenceRefs))),
      notTradingAdvice: true,
    }
  }

  private buildDataGovernanceAudit(
    generatedAt: string,
    dataGradeAudit: PortfolioDataGradeAudit,
  ): PortfolioReleaseDataGovernanceAudit {
    const items = dataGradeAudit.items.map((item) => {
      const crossCheckStatus: PortfolioReleaseDataGovernanceAudit['items'][number]['crossCheckStatus'] =
        item.grade === 'official_authorized'
          ? 'official_authorized'
          : item.grade === 'free_source_cross_checked'
            ? 'free_source_cross_checked'
            : item.grade === 'price_index_only' || item.grade === 'research_proxy'
              ? 'single_source'
              : 'proxy_or_insufficient'
      const blockers = [
        ...(item.blockingForFormalTrading ? [`${item.scope}_blocks_formal_trading:${item.grade}`] : []),
        ...(item.freshnessStatus !== 'fresh' ? [`${item.scope}_freshness_${item.freshnessStatus}`] : []),
        ...(item.coveragePercent < 80 ? [`${item.scope}_coverage_below_80:${item.coveragePercent}`] : []),
        ...(item.grade !== 'official_authorized' && item.grade !== 'free_source_cross_checked'
          ? [`${item.scope}_not_cross_checked_or_official:${item.grade}`]
          : []),
      ]
      return {
        fieldId: `portfolio_backtest.${item.scope}`,
        scope: item.scope,
        sourceProvider: item.sourceProvider,
        providerClass: this.providerClass(item),
        sourceEndpoint: item.sourceType,
        asOfDate: item.asOfDate,
        fetchedAt: generatedAt,
        freshnessStatus: item.freshnessStatus,
        coverageStatus: item.coveragePercent >= 80 && blockers.length === 0 ? 'passed' as const : 'blocked' as const,
        coveragePercent: item.coveragePercent,
        crossCheckStatus,
        evidenceRefs: item.evidenceRefs,
        blockers,
        warnings: item.warnings,
      }
    })
    const blockers = Array.from(new Set(items.flatMap((item) => item.blockers)))
    return {
      schemaVersion: 'portfolio.release_data_governance_audit.v1',
      status: blockers.length === 0 && items.length > 0 ? 'passed' : 'blocked',
      formalTradingEligible: false,
      items,
      blockers,
      warnings: Array.from(new Set(items.flatMap((item) => item.warnings))),
      notTradingAdvice: true,
    }
  }

  private providerClass(item: PortfolioDataGradeItem): PortfolioProviderClass {
    if (item.grade === 'official_authorized') return 'official_authorized'
    if (item.grade === 'research_proxy') return 'research_proxy'
    if (item.sourceProvider.includes('manual_seed')) return 'manual_seed'
    if (item.sourceProvider.includes('market_bar_canonical')
      || item.sourceProvider.includes('price_history')
      || item.sourceProvider.includes('market_tradeability_daily')
      || item.sourceProvider.includes('dividend_low_vol_daily')) {
      return 'local_cache'
    }
    if (item.grade === 'free_source_cross_checked'
      || item.sourceProvider.includes('free_source')
      || item.sourceProvider.includes('baostock')
      || item.sourceProvider.includes('eastmoney')) {
      return 'free_source'
    }
    return 'unknown'
  }

  private buildBenchmarkQualificationAudit(
    formalReviewReadiness: PortfolioBacktestFormalReviewReadiness,
  ): PortfolioBenchmarkQualificationAudit {
    const statuses = formalReviewReadiness.benchmarkStatuses
    const hasFormalTotalReturn = Object.values(statuses).includes('formal_total_return')
    const hasFreeSourceTotalReturn = Object.values(statuses).includes('free_source_total_return')
    const canSupportFormalReview = hasFormalTotalReturn || hasFreeSourceTotalReturn
    const canSupportFormalTrading = hasFormalTotalReturn
    const blockers = [
      ...(canSupportFormalReview ? [] : ['total_return_benchmark_missing']),
      ...(hasFormalTotalReturn ? [] : ['official_authorized_total_return_benchmark_not_reviewed']),
    ]
    return {
      schemaVersion: 'portfolio.benchmark_qualification_audit.v1',
      status: canSupportFormalReview ? 'passed' : 'blocked',
      benchmarkStatuses: statuses,
      hasFormalTotalReturn,
      hasFreeSourceTotalReturn,
      canSupportFormalReview,
      canSupportFormalTrading,
      blockers,
      warnings: [
        ...(hasFreeSourceTotalReturn && !hasFormalTotalReturn
          ? ['free_source_total_return_supports_formal_review_not_formal_trading_release']
          : []),
        ...formalReviewReadiness.warnings.filter((warning) => warning.includes('benchmark') || warning.includes('total_return')),
      ],
      evidenceRefs: Object.entries(statuses).map(([id, status]) => `portfolio-benchmark-status:${id}:${status}`),
      notTradingAdvice: true,
    }
  }

  private buildFormalValidationAudit(strategies: PortfolioBacktestStrategyResult[]): PortfolioFormalValidationAudit {
    const checks = strategies.map((strategy) => {
      const model = strategy.modelEffectiveness
      const blockers = model
        ? Array.from(new Set([
          ...(model.status === 'passed' ? [] : [`model_effectiveness_${model.status}`]),
          ...(model.oos.status === 'passed' ? [] : [`oos_${model.oos.status}`]),
          ...(model.walkForward.status === 'passed' ? [] : [`walk_forward_${model.walkForward.status}`]),
          ...(model.parameterSensitivityStatus === 'passed' ? [] : [`parameter_sensitivity_${model.parameterSensitivityStatus}`]),
          ...(model.groupStabilityStatus === 'passed' || model.groupStabilityStatus === 'not_applicable' ? [] : [`group_stability_${model.groupStabilityStatus}`]),
          ...model.failureTaxonomy,
        ]))
        : ['model_effectiveness_missing']
      return {
        strategyId: strategy.definition.strategyId,
        status: model?.status || 'insufficient' as const,
        oosStatus: model?.oos.status || 'insufficient' as const,
        walkForwardStatus: model?.walkForward.status || 'insufficient' as const,
        parameterSensitivityStatus: model?.parameterSensitivityStatus || 'insufficient' as const,
        groupStabilityStatus: model?.groupStabilityStatus || 'insufficient' as const,
        blockers,
        evidenceRefs: model?.evidenceRefs || strategy.evidenceRefs,
      }
    })
    const failedStrategies = checks.filter((check) => check.status === 'failed').length
    const insufficientStrategies = checks.filter((check) => check.status === 'insufficient').length
    const warningStrategies = checks.filter((check) => check.status === 'warning').length
    const passedStrategies = checks.filter((check) => check.status === 'passed').length
    const status: PortfolioFormalValidationAudit['status'] = failedStrategies > 0
      ? 'failed'
      : insufficientStrategies > 0
        ? 'insufficient'
        : warningStrategies > 0
          ? 'warning'
          : 'passed'
    const blockers = Array.from(new Set(checks.flatMap((check) => check.blockers)))
    return {
      schemaVersion: 'portfolio.formal_validation_audit.v1',
      status,
      formalTradingEligible: status === 'passed' && blockers.length === 0,
      strategyCount: checks.length,
      passedStrategies,
      warningStrategies,
      insufficientStrategies,
      failedStrategies,
      checks,
      blockers,
      warnings: [
        ...(status === 'passed' ? [] : ['formal_validation_not_all_gates_passed']),
        'research_backtest_curve_is_not_sufficient_for_formal_trading_release',
      ],
      notTradingAdvice: true,
    }
  }

  private buildManualSignoffAudit(): PortfolioManualSignoffAudit {
    const requiredRoles: PortfolioManualSignoffAudit['requiredRoles'] = ['data', 'model', 'risk', 'compliance', 'final_release']
    const records = requiredRoles.map((role) => ({
      role,
      status: 'missing' as const,
      reviewerId: null,
      reviewedAt: null,
      decision: null,
      notes: null,
      blockedReasons: [`${role}_signoff_missing`],
      evidenceRefs: [],
    }))
    return {
      schemaVersion: 'portfolio.manual_signoff_audit.v1',
      status: 'missing',
      requiredRoles,
      records,
      allRequiredSignedOff: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      blockers: records.flatMap((record) => record.blockedReasons),
      warnings: ['manual_signoff_workflow_not_completed'],
      notTradingAdvice: true,
    }
  }

  private buildLongHorizonDataCoverageAudit(
    multiPeriodBacktestResult: PortfolioMultiPeriodBacktestResult,
  ): PortfolioLongHorizonDataCoverageAudit {
    const periods = multiPeriodBacktestResult.periods.map((period) => ({
      periodId: period.periodId,
      label: period.label,
      requestedStartDate: period.requestedStartDate,
      requestedEndDate: period.requestedEndDate,
      requiredTradingDays: period.requiredTradingDays,
      availableTradingDays: period.availableTradingDays,
      coveragePercent: period.coveragePercent,
      comparableStrategyCount: period.comparableStrategyCount,
      blockedReasons: period.blockedReasons,
      evidenceRefs: [
        `portfolio-long-horizon:${period.periodId}:${period.requestedStartDate}:${period.requestedEndDate}:available:${period.availableTradingDays}:required:${period.requiredTradingDays}`,
        ...period.strategySummaries
          .filter((strategy) => strategy.equityCurvePoints > 0)
          .slice(0, 8)
          .map((strategy) => `portfolio-curve:${period.periodId}:${strategy.strategyId}:points:${strategy.equityCurvePoints}:${strategy.firstCurveDate || 'none'}:${strategy.lastCurveDate || 'none'}`),
      ],
    }))

    const blockers = Array.from(new Set(periods.flatMap((period) => period.blockedReasons)))
    return {
      schemaVersion: 'portfolio.long_horizon_data_coverage_audit.v1',
      status: blockers.length === 0 ? 'passed' : 'blocked',
      longHorizonRealDataBacktestReady: blockers.length === 0,
      periods,
      blockers,
      warnings: [
        ...(blockers.length === 0 ? [] : ['long_horizon_real_data_backtest_not_ready']),
        'long_horizon_ready_does_not_unlock_formal_trading_without_release_gate',
      ],
      notTradingAdvice: true,
    }
  }

  private async buildMultiPeriodBacktestResult(
    input: PortfolioBacktestInputBuildResult,
    currentPeriodStrategies: PortfolioBacktestStrategyResult[],
  ): Promise<PortfolioMultiPeriodBacktestResult> {
    const periods = []
    for (const period of this.longHorizonPeriodDefinitions(input.request.startDate, input.request.endDate)) {
      const periodInput: PortfolioBacktestInputBuildResult = {
        ...input,
        request: {
          ...input.request,
          startDate: period.requestedStartDate,
          endDate: period.requestedEndDate,
        },
      }
      const periodStrategies = period.periodId === 'custom'
        ? currentPeriodStrategies
        : await Promise.all(input.strategies.map((definition) => this.runStrategy(definition, periodInput)))
      const completedStrategies = periodStrategies.filter((strategy) => strategy.status === 'completed')
      const availableTradingDays = completedStrategies.length > 0
        ? Math.min(...completedStrategies.map((strategy) => strategy.equityCurve.length))
        : 0
      const coveragePercent = Math.min(100, round((availableTradingDays / period.requiredTradingDays) * 100, 2) || 0)
      const comparableStrategyCount = completedStrategies.filter((strategy) => strategy.equityCurve.length >= Math.min(period.requiredTradingDays, availableTradingDays)).length
      const blockedReasons = [
        ...(coveragePercent >= 80 ? [] : [`${period.periodId}_coverage_below_80:${coveragePercent}`]),
        ...(comparableStrategyCount >= 3 ? [] : [`${period.periodId}_comparable_strategy_count_below_3:${comparableStrategyCount}`]),
      ]

      periods.push({
        periodId: period.periodId,
        label: period.label,
        requestedStartDate: period.requestedStartDate,
        requestedEndDate: period.requestedEndDate,
        requiredTradingDays: period.requiredTradingDays,
        availableTradingDays,
        coveragePercent,
        strategyCount: periodStrategies.length,
        completedStrategyCount: completedStrategies.length,
        comparableStrategyCount,
        blockedReasons,
        strategySummaries: periodStrategies.map((strategy) => ({
          strategyId: strategy.definition.strategyId,
          status: strategy.status,
          totalReturnPercent: strategy.metrics.totalReturnPercent,
          maxDrawdownPercent: strategy.metrics.maxDrawdownPercent,
          benchmarkReturnPercent: strategy.metrics.benchmarkReturnPercent,
          excessReturnPercent: strategy.metrics.excessReturnPercent,
          equityCurvePoints: strategy.equityCurve.length,
          firstCurveDate: strategy.equityCurve[0]?.date || null,
          lastCurveDate: strategy.equityCurve.at(-1)?.date || null,
        })),
      })
    }
    const blockers = Array.from(new Set(periods.flatMap((period) => period.blockedReasons)))
    return {
      schemaVersion: 'portfolio.multi_period_backtest_result.v1',
      status: blockers.length === 0 ? 'passed' : 'blocked',
      periods,
      blockers,
      warnings: [
        ...(blockers.length > 0 ? ['multi_period_backtest_has_insufficient_real_data_coverage'] : []),
        'multi_period_backtest_is_formal_review_evidence_not_formal_trading_unlock',
      ],
      notTradingAdvice: true,
    }
  }

  private longHorizonPeriodDefinitions(startDate: string, endDate: string): LongHorizonPeriodDefinition[] {
    const requestedCalendarDays = Math.max(1, Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1)
    return [
      this.buildPeriodDefinition('1y', '1 年', endDate, 365, 252),
      this.buildPeriodDefinition('3y', '3 年', endDate, 365 * 3, 252 * 3),
      this.buildPeriodDefinition('5y', '5 年', endDate, 365 * 5, 252 * 5),
      {
        periodId: 'custom',
        label: '自定义区间',
        requestedStartDate: startDate,
        requestedEndDate: endDate,
        requiredTradingDays: Math.max(1, Math.round(requestedCalendarDays * (252 / 365))),
        requiredCalendarDays: requestedCalendarDays,
      },
    ]
  }

  private buildPeriodDefinition(
    periodId: '1y' | '3y' | '5y',
    label: string,
    endDate: string,
    requiredCalendarDays: number,
    requiredTradingDays: number,
  ): LongHorizonPeriodDefinition {
    const start = new Date(`${endDate}T00:00:00.000Z`)
    start.setUTCDate(start.getUTCDate() - requiredCalendarDays + 1)
    return {
      periodId,
      label,
      requestedStartDate: isoDate(start),
      requestedEndDate: endDate,
      requiredTradingDays,
      requiredCalendarDays,
    }
  }

  private buildDividendTotalReturnAudit(
    input: PortfolioBacktestInputBuildResult,
    strategies: PortfolioBacktestStrategyResult[],
  ): PortfolioDividendTotalReturnAudit {
    const items = strategies.map((strategy) => {
      const dividendAvailable = strategy.metrics.dividendContributionPercent !== null
      const noAuditedDividendComponent = strategy.warnings.includes('dividend_contribution_insufficient:no_audited_component_yield')
      return {
        strategyId: strategy.definition.strategyId,
        priceOnlyReturnPercent: strategy.metrics.priceOnlyReturnPercent ?? strategy.metrics.totalReturnPercent,
        dividendContributionPercent: strategy.metrics.dividendContributionPercent,
        capitalGainContributionPercent: strategy.metrics.capitalGainContributionPercent,
        costDragPercent: strategy.metrics.costDragPercent ?? null,
        totalReturnMethod: dividendAvailable
          ? 'price_plus_estimated_dividend' as const
          : noAuditedDividendComponent
            ? 'price_only_no_audited_dividend_component' as const
            : 'price_only_or_insufficient' as const,
        evidenceRefs: strategy.evidenceRefs.filter((ref) => ref.includes('dividend') || ref.includes('price-source') || ref.includes('benchmark')),
        warnings: strategy.warnings.filter((warning) => warning.includes('dividend') || warning.includes('benchmark')),
      }
    })
    const coveredStrategyCount = items.filter((item) => item.totalReturnMethod !== 'price_only_or_insufficient').length
    const coveragePercent = strategies.length > 0 ? round((coveredStrategyCount / strategies.length) * 100, 2) || 0 : 0
    const blockers = [
      ...(coveredStrategyCount === strategies.length && strategies.length > 0 ? [] : [`dividend_total_return_coverage_incomplete:${coveredStrategyCount}/${strategies.length}`]),
      ...(input.request.dividendMode === 'reinvest' || input.request.dividendMode === 'cash' ? [] : [`unsupported_dividend_mode:${input.request.dividendMode}`]),
    ]

    return {
      schemaVersion: 'portfolio.dividend_total_return_audit.v1',
      status: blockers.length === 0 ? 'passed' : 'blocked',
      mode: input.request.dividendMode,
      strategyCount: strategies.length,
      coveredStrategyCount,
      coveragePercent,
      priceOnlyReturnAvailable: strategies.every((strategy) => strategy.metrics.priceOnlyReturnPercent !== null || strategy.metrics.totalReturnPercent !== null),
      dividendContributionAvailable: coveredStrategyCount === strategies.length && strategies.length > 0,
      capitalGainContributionAvailable: items.every((item) => item.capitalGainContributionPercent !== null),
      costDragAvailable: items.every((item) => item.costDragPercent !== null),
      items,
      blockers,
      warnings: [
        'dividend_total_return_uses_research_estimated_ttm_yield_until_official_dividend_events_are_cross_checked',
        ...(blockers.length > 0 ? ['dividend_total_return_not_formal_grade'] : []),
      ],
      notTradingAdvice: true,
    }
  }

  private buildReleaseGateAudit(args: {
    formalReviewReadiness: PortfolioBacktestFormalReviewReadiness
    dataGradeAudit: PortfolioDataGradeAudit
    modelEffectiveness: NonNullable<PortfolioBacktestResult['modelEffectiveness']>
    formalTradingUnlockChecklist: PortfolioFormalTradingUnlockChecklist
    readinessSummary: PortfolioBacktestReadinessSummary
    executionIsolationAudit: PortfolioExecutionIsolationAudit
    dataGovernanceAudit: PortfolioReleaseDataGovernanceAudit
    benchmarkQualificationAudit: PortfolioBenchmarkQualificationAudit
    formalValidationAudit: PortfolioFormalValidationAudit
    manualSignoffAudit: PortfolioManualSignoffAudit
    longHorizonDataCoverageAudit: PortfolioLongHorizonDataCoverageAudit
    runtimeHealth?: Record<string, unknown>
  }): PortfolioFormalTradingReleaseGateAudit {
    const runtimeStatus = typeof args.runtimeHealth?.status === 'string' ? args.runtimeHealth.status : 'unknown'
    const checks: PortfolioFormalTradingReleaseGateAudit['checks'] = [
      {
        id: 'runtime_health',
        status: runtimeStatus === 'healthy' ? 'passed' : 'requires_review',
        blocker: runtimeStatus === 'healthy' ? undefined : `runtime_health_not_confirmed:${runtimeStatus}`,
        evidenceRefs: ['runtimeHealthService.check'],
      },
      {
        id: 'formal_review_readiness',
        status: args.formalReviewReadiness.ready ? 'passed' : 'blocked',
        blocker: args.formalReviewReadiness.ready ? undefined : 'formal_review_readiness_not_passed',
        evidenceRefs: ['portfolioBacktest.formalReviewReadiness'],
      },
      {
        id: 'long_horizon_real_data_backtest',
        status: args.longHorizonDataCoverageAudit.longHorizonRealDataBacktestReady ? 'passed' : 'blocked',
        blocker: args.longHorizonDataCoverageAudit.longHorizonRealDataBacktestReady ? undefined : 'long_horizon_real_data_backtest_not_ready',
        evidenceRefs: args.longHorizonDataCoverageAudit.periods.flatMap((period) => period.evidenceRefs),
      },
      {
        id: 'data_grade',
        status: args.dataGradeAudit.status === 'passed' ? 'passed' : 'blocked',
        blocker: args.dataGradeAudit.status === 'passed' ? undefined : `data_grade_${args.dataGradeAudit.status}`,
        evidenceRefs: args.dataGradeAudit.items.flatMap((item) => item.evidenceRefs),
      },
      {
        id: 'field_level_data_governance',
        status: args.dataGovernanceAudit.status === 'passed' ? 'passed' : 'blocked',
        blocker: args.dataGovernanceAudit.status === 'passed' ? undefined : 'field_level_data_governance_not_passed',
        evidenceRefs: args.dataGovernanceAudit.items.flatMap((item) => item.evidenceRefs),
      },
      {
        id: 'official_or_cross_checked_benchmark',
        status: args.benchmarkQualificationAudit.canSupportFormalTrading ? 'passed' : 'blocked',
        blocker: args.benchmarkQualificationAudit.canSupportFormalTrading ? undefined : 'official_authorized_total_return_benchmark_not_reviewed',
        evidenceRefs: args.benchmarkQualificationAudit.evidenceRefs,
      },
      {
        id: 'model_effectiveness',
        status: args.modelEffectiveness.status === 'passed' ? 'passed' : 'blocked',
        blocker: args.modelEffectiveness.status === 'passed' ? undefined : `model_effectiveness_${args.modelEffectiveness.status}`,
        evidenceRefs: ['portfolioBacktest.modelEffectiveness'],
      },
      {
        id: 'formal_validation',
        status: args.formalValidationAudit.status === 'passed' ? 'passed' : 'blocked',
        blocker: args.formalValidationAudit.status === 'passed' ? undefined : `formal_validation_${args.formalValidationAudit.status}`,
        evidenceRefs: args.formalValidationAudit.checks.flatMap((check) => check.evidenceRefs),
      },
      {
        id: 'execution_isolation',
        status: args.executionIsolationAudit.paperTradingReady && !args.executionIsolationAudit.orderCreateAllowed ? 'passed' : 'blocked',
        blocker: args.executionIsolationAudit.paperTradingReady ? undefined : 'paper_or_sandbox_intent_missing',
        evidenceRefs: args.executionIsolationAudit.evidenceRefs,
      },
      {
        id: 'manual_human_signoff',
        status: args.manualSignoffAudit.allRequiredSignedOff ? 'passed' : 'blocked',
        blocker: args.manualSignoffAudit.allRequiredSignedOff ? undefined : 'human_reviewer_confirmation_not_completed',
        evidenceRefs: args.manualSignoffAudit.records.flatMap((record) => record.evidenceRefs),
      },
      {
        id: 'production_order_adapter',
        status: 'blocked',
        blocker: 'production_order_adapter_not_enabled',
        evidenceRefs: ['portfolio.execution_isolation_audit.v1'],
      },
      {
        id: 'auto_trade_policy',
        status: 'blocked',
        blocker: 'auto_trade_policy_locked',
        evidenceRefs: ['portfolio.backtest.trade_gate_contract.v1'],
      },
    ]
    const blockers = Array.from(new Set([
      ...checks.map((check) => check.blocker).filter((blocker): blocker is string => Boolean(blocker)),
      ...args.dataGovernanceAudit.blockers,
      ...args.benchmarkQualificationAudit.blockers,
      ...args.formalValidationAudit.blockers,
      ...args.manualSignoffAudit.blockers,
      ...args.longHorizonDataCoverageAudit.blockers,
      ...args.formalTradingUnlockChecklist.blockers,
      ...args.readinessSummary.blockers,
    ]))

    return {
      schemaVersion: 'portfolio.formal_trading_release_gate_audit.v1',
      status: 'blocked',
      formalTradingEligible: args.readinessSummary.formalTradingEligible,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      orderCreateAllowed: false,
      canCreateOrder: false,
      checks,
      blockers,
      warnings: [
        'formal_review_ready_does_not_mean_formal_trading_unlocked',
        'manual_plan_drafts_must_not_create_orders',
      ],
      notTradingAdvice: true,
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
            asOfDate: null,
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
            asOfDate: null,
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
            asOfDate: null,
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
            asOfDate: null,
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
        oos: {
          status: 'insufficient',
          trainReturnPercent: null,
          testReturnPercent: null,
          testExcessReturnPercent: null,
          evidenceRefs: definition.evidenceRefs,
        },
        walkForward: {
          status: 'insufficient',
          windows: 0,
          passedWindows: 0,
          passRatioPercent: null,
          evidenceRefs: definition.evidenceRefs,
        },
        parameterSensitivityStatus: 'insufficient',
        parameterSensitivity: {
          status: 'insufficient',
          testedVariants: [],
          stableVariants: [],
          evidenceRefs: definition.evidenceRefs,
          notes: ['strategy_insufficient'],
        },
        groupStabilityStatus: 'insufficient',
        groupStability: {
          status: 'insufficient',
          groups: [],
          evidenceRefs: definition.evidenceRefs,
          notes: ['strategy_insufficient'],
        },
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

  private buildReadinessSummary(args: {
    strategies: PortfolioBacktestStrategyResult[]
    formalReviewReadiness: PortfolioBacktestFormalReviewReadiness
    dataGradeAudit: PortfolioDataGradeAudit
    modelEffectiveness: NonNullable<PortfolioBacktestResult['modelEffectiveness']>
    manualPlanDrafts: PortfolioManualPlanDraft[]
    formalTradingUnlockChecklist: PortfolioFormalTradingUnlockChecklist
  }): PortfolioBacktestReadinessSummary {
    const completedOrPartial = args.strategies.filter((strategy) => ['completed', 'partial'].includes(strategy.status)).length
    const researchReady = completedOrPartial > 0
    const formalReviewReady = args.formalReviewReadiness.ready === true
    const manualDraftReady = args.manualPlanDrafts.length === args.strategies.length && args.manualPlanDrafts.length > 0
    const modelBlocksFormalTrading = args.modelEffectiveness.status !== 'passed'
    const dataBlocksFormalTrading = args.dataGradeAudit.items.some((item) => item.blockingForFormalTrading)
    const formalTradingEligible = formalReviewReady
      && !modelBlocksFormalTrading
      && !dataBlocksFormalTrading
      && args.formalTradingUnlockChecklist.blockers.length === 0
    const blockers = Array.from(new Set([
      ...args.formalReviewReadiness.blockers.map((item) => `formal_review:${item}`),
      ...args.dataGradeAudit.blockers.map((item) => `data_grade:${item}`),
      ...(modelBlocksFormalTrading ? [`model_effectiveness:${args.modelEffectiveness.status}`] : []),
      ...args.formalTradingUnlockChecklist.blockers.map((item) => `unlock:${item}`),
    ]))
    const warnings = Array.from(new Set([
      ...args.formalReviewReadiness.warnings,
      ...(formalReviewReady ? ['formal_review_ready_is_not_formal_trading_unlocked'] : []),
      ...(manualDraftReady ? ['manual_draft_ready_requires_human_review_before_any_action'] : []),
    ]))

    return {
      researchReady,
      formalReviewReady,
      manualDraftReady,
      formalTradingEligible,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      statusMessage: formalReviewReady
        ? '组合回测可进入人工正式评审；正式交易仍需模型、数据、风险和人工确认全部通过。'
        : '组合回测仍未达到正式评审前置条件，只能用于研究观察。',
      blockers,
      warnings,
    }
  }
}

export const portfolioBacktestEngine = new PortfolioBacktestEngine()
