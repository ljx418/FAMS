import { prisma } from '../../db/prisma.js'
import { getTencentRawStockHistory } from '../../utils/stockUtils.js'
import {
  PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
  PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
  type PortfolioBacktestInputBuildResult,
  type PortfolioFixedRuleStudy,
  type PortfolioScenarioPolicyId,
  type PortfolioStartDateSensitivityPoint,
} from './portfolioBacktestTypes.js'
import {
  portfolioScenarioEngine,
  type PortfolioScenarioBar,
} from './portfolioScenarioEngine.js'
import { portfolioStrategyRegistry } from './portfolioStrategyRegistry.js'
import {
  CLASSIC_PORTFOLIO_OFFICIAL_DISTRIBUTIONS,
  CLASSIC_PORTFOLIO_SYMBOL_NAMES,
} from './classicPortfolioStudyService.js'

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function dateDiff(startDate: string, endDate: string) {
  return Math.max(0, Math.round((new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime()) / 86400000))
}

function median(values: number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function commonDates(symbols: string[], barsBySymbol: Map<string, Map<string, PortfolioScenarioBar>>) {
  if (symbols.length === 0) return []
  let dates = Array.from(barsBySymbol.get(symbols[0])?.keys() || [])
  for (const symbol of symbols.slice(1)) {
    const available = barsBySymbol.get(symbol) || new Map()
    dates = dates.filter((date) => available.has(date))
  }
  return dates.sort()
}

function isoWeekKey(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`)
  const weekday = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() - weekday + 1)
  return value.toISOString().slice(0, 10)
}

function weeklyStartDates(dates: string[]) {
  const starts: string[] = []
  let previousKey = ''
  for (const date of dates) {
    const key = isoWeekKey(date)
    if (key !== previousKey) starts.push(date)
    previousKey = key
  }
  return starts
}

function fixedPolicy(frequency: string): PortfolioScenarioPolicyId | null {
  if (frequency === 'none') return 'buy_and_hold'
  if (frequency === 'monthly') return 'monthly'
  if (frequency === 'quarterly') return 'quarterly'
  return null
}

export class PortfolioFixedRuleStudyService {
  async run(input: PortfolioBacktestInputBuildResult): Promise<PortfolioFixedRuleStudy | undefined> {
    if (input.request.ruleMode !== 'registry_fixed') return undefined
    const classicIds = new Set(portfolioStrategyRegistry.classicResearchStrategyIds())
    const definitions = input.strategies.filter((item) => classicIds.has(item.strategyId))
    if (definitions.length === 0) return undefined

    const config = input.request.scenarioAnalysis!
    const minimumTradingDays = input.request.startDateSensitivity?.minimumTradingDaysForAnnualization || 20
    const symbols = Array.from(new Set(definitions.flatMap((definition) => definition.components
      .filter((component) => component.assetClass !== 'cash')
      .map((component) => component.symbol || component.proxySymbol)
      .filter((symbol): symbol is string => Boolean(symbol)))))
    const barsBySymbol = new Map<string, Map<string, PortfolioScenarioBar>>()
    const providersBySymbol = new Map<string, Set<string>>()
    const missingOpenBySymbol = new Map<string, number>()

    for (const symbol of symbols) {
      const rows = await prisma.marketBarCanonical.findMany({
        where: {
          symbol,
          market: 'CN',
          timeframe: '1d',
          adjustType: 'none',
          dataVersion: 'canonical.v1',
          tradeDate: {
            gte: new Date(`${input.request.startDate}T00:00:00.000Z`),
            lte: new Date(`${input.request.endDate}T23:59:59.999Z`),
          },
          closePrice: { gt: 0 },
        },
        orderBy: { tradeDate: 'asc' },
        select: { tradeDate: true, openPrice: true, closePrice: true, primaryProvider: true },
      })
      missingOpenBySymbol.set(symbol, rows.filter((row) => !row.openPrice || row.openPrice <= 0).length)
      providersBySymbol.set(symbol, new Set(rows.map((row) => row.primaryProvider || 'unknown')))
      barsBySymbol.set(symbol, new Map(rows.map((row) => {
        const date = isoDate(row.tradeDate)
        return [date, {
          date,
          open: row.openPrice && row.openPrice > 0 ? row.openPrice : row.closePrice,
          close: row.closePrice,
        }]
      })))
    }

    const crossChecks = new Map<string, Awaited<ReturnType<typeof getTencentRawStockHistory>>>()
    await Promise.all(symbols.map(async (symbol) => {
      crossChecks.set(symbol, await getTencentRawStockHistory(symbol, 800).catch(() => []))
    }))
    const distributionsBySymbol = new Map(symbols.map((symbol) => [
      symbol,
      (CLASSIC_PORTFOLIO_OFFICIAL_DISTRIBUTIONS[symbol] || []).filter((event) => (
        event.recordDate >= input.request.startDate && event.paymentDate <= input.request.endDate
      )),
    ]))

    const unionDates = Array.from(new Set(Array.from(barsBySymbol.values()).flatMap((bars) => Array.from(bars.keys())))).sort()
    const dataItems = symbols.map((symbol) => {
      const bars = barsBySymbol.get(symbol) || new Map()
      const dates = Array.from(bars.keys()).sort()
      const firstDate = dates[0] || null
      const lastDate = dates.at(-1) || null
      const coveragePercent = unionDates.length > 0 ? round((dates.length / unionDates.length) * 100) : 0
      const missingOpen = missingOpenBySymbol.get(symbol) || 0
      const crossCheckRows = crossChecks.get(symbol) || []
      const deviations = crossCheckRows.flatMap((row) => {
        const canonical = bars.get(row.date)?.close
        return canonical && row.close > 0 ? [Math.abs(canonical / row.close - 1) * 100] : []
      })
      const latestCrossCheck = [...crossCheckRows].reverse().find((row) => bars.has(row.date) && row.close > 0)
      const latestCanonical = latestCrossCheck ? bars.get(latestCrossCheck.date)?.close : null
      const latestCloseDeviationPercent = latestCrossCheck && latestCanonical
        ? Math.abs(latestCanonical / latestCrossCheck.close - 1) * 100
        : null
      const requiredCrossChecks = Math.min(700, Math.max(20, Math.floor(dates.length * 0.95)))
      const dateBoundaryReady = Boolean(firstDate && lastDate
        && dateDiff(input.request.startDate, firstDate) <= 7
        && dateDiff(lastDate, input.request.endDate) <= 7)
      const crossCheckPassed = deviations.length >= requiredCrossChecks
        && latestCloseDeviationPercent !== null
        && latestCloseDeviationPercent <= 0.5
      const distributionEvents = distributionsBySymbol.get(symbol) || []
      const status = coveragePercent >= 98 && dateBoundaryReady && crossCheckPassed && missingOpen === 0
      return {
        symbol,
        name: CLASSIC_PORTFOLIO_SYMBOL_NAMES[symbol] || symbol,
        firstDate,
        lastDate,
        bars: dates.length,
        coveragePercent,
        sourceProviders: Array.from(providersBySymbol.get(symbol) || []),
        crossCheckProvider: 'tencent_raw_daily_history',
        crossCheckedBars: deviations.length,
        medianCloseDeviationPercent: median(deviations) === null ? null : round(median(deviations)!, 4),
        latestCloseDeviationPercent: latestCloseDeviationPercent === null ? null : round(latestCloseDeviationPercent, 4),
        crossCheckStatus: crossCheckPassed ? 'passed' as const : 'blocked' as const,
        distributionEvents: distributionEvents.length,
        distributionEventSource: distributionEvents.length > 0 ? 'official_sse_registry' as const : 'not_detected' as const,
        officialDistributionEvidenceRefs: distributionEvents.map((event) => event.evidenceRef),
        totalReturnAdjustmentStatus: crossCheckPassed
          ? distributionEvents.length > 0 ? 'official_cash_distributions' as const : 'not_detected' as const
          : 'insufficient' as const,
        status: status ? 'passed' as const : 'blocked' as const,
        warnings: [
          ...(missingOpen > 0 ? [`missing_open_blocks_fixed_rule_study:${missingOpen}`] : []),
          ...(!dateBoundaryReady ? ['requested_date_boundary_not_covered'] : []),
          ...(!crossCheckPassed ? [`tencent_raw_cross_check_blocked:bars=${deviations.length}:required=${requiredCrossChecks}:latest=${latestCloseDeviationPercent}`] : []),
          'official_cash_distribution_registry_is_static_and_audited_through_2026-08-28',
        ],
      }
    })

    const allCommonDates = commonDates(symbols, barsBySymbol)
    const dataBlockers = dataItems
      .filter((item) => item.status === 'blocked')
      .map((item) => `fixed_rule_data_truth_failed:${item.symbol}`)
    const weeklyStarts = input.request.startDateSensitivity?.enabled
      ? weeklyStartDates(allCommonDates)
      : []

    const strategies = definitions.map((definition) => {
      const policyId = fixedPolicy(definition.rebalancePolicy.frequency)
      if (!policyId) {
        const insufficient = portfolioScenarioEngine.run({
          strategyId: definition.strategyId,
          components: definition.components,
          barsBySymbol,
          dates: [],
          scenarioId: 'buy_and_hold',
          initialCapital: input.request.initialCapital,
          feeRate: input.request.feeRate,
          minCommissionCny: config.minCommissionCny,
          slippageRate: input.request.slippageRate,
          cashAnnualRate: config.cashAnnualRate,
          lotSize: config.lotSize,
          driftThresholdPercentagePoints: config.driftThresholdPercentagePoints,
          validationMonths: config.validationMonths,
          distributionsBySymbol,
        })
        insufficient.blockedReasons = [`registry_fixed_frequency_unsupported:${definition.rebalancePolicy.frequency}`]
        return {
          strategyId: definition.strategyId,
          displayName: definition.displayName,
          strategyVersion: definition.strategyVersion,
          components: definition.components,
          appliedPolicy: {
            source: 'strategy_registry' as const,
            frequency: definition.rebalancePolicy.frequency,
            scenarioId: 'buy_and_hold' as const,
            frozenBeforeMarketDataEvaluation: true as const,
          },
          primaryRun: insufficient,
          sensitivity: [] as PortfolioStartDateSensitivityPoint[],
        }
      }

      const primaryRun = portfolioScenarioEngine.run({
        strategyId: definition.strategyId,
        components: definition.components,
        barsBySymbol,
        dates: allCommonDates,
        scenarioId: policyId,
        initialCapital: input.request.initialCapital,
        feeRate: input.request.feeRate,
        minCommissionCny: config.minCommissionCny,
        slippageRate: input.request.slippageRate,
        cashAnnualRate: config.cashAnnualRate,
        lotSize: config.lotSize,
        driftThresholdPercentagePoints: config.driftThresholdPercentagePoints,
        validationMonths: config.validationMonths,
        distributionsBySymbol,
      })
      const sensitivity = weeklyStarts.map((startDate): PortfolioStartDateSensitivityPoint => {
        const startIndex = allCommonDates.indexOf(startDate)
        const dates = allCommonDates.slice(startIndex)
        const run = portfolioScenarioEngine.run({
          strategyId: definition.strategyId,
          components: definition.components,
          barsBySymbol,
          dates,
          scenarioId: policyId,
          initialCapital: input.request.initialCapital,
          feeRate: input.request.feeRate,
          minCommissionCny: config.minCommissionCny,
          slippageRate: input.request.slippageRate,
          cashAnnualRate: config.cashAnnualRate,
          lotSize: config.lotSize,
          driftThresholdPercentagePoints: config.driftThresholdPercentagePoints,
          validationMonths: config.validationMonths,
          distributionsBySymbol,
        })
        const enoughForAnnualization = dates.length >= minimumTradingDays
        return {
          startDate,
          actualStartDate: dates[0] || startDate,
          endDate: dates.at(-1) || startDate,
          holdingTradingDays: dates.length,
          status: enoughForAnnualization ? 'completed' : 'insufficient',
          totalReturnPercent: run.metrics.totalReturnPercent,
          peakReturnPercent: round(Math.max(0, ...run.equityCurve.map((point) => point.cumulativeReturnPercent))),
          annualizedReturnPercent: enoughForAnnualization ? run.metrics.annualizedReturnPercent : null,
          maxDrawdownPercent: run.metrics.maxDrawdownPercent,
          endingValue: run.metrics.endingValue,
          pnlAmount: round(run.metrics.endingValue - input.request.initialCapital, 2),
          tradeCount: run.metrics.tradeCount,
          totalCostCny: run.metrics.totalCostCny,
          warnings: enoughForAnnualization ? [] : [`annualization_insufficient_trading_days:${dates.length}/${minimumTradingDays}`],
        }
      })

      return {
        strategyId: definition.strategyId,
        displayName: definition.displayName,
        strategyVersion: definition.strategyVersion,
        components: definition.components,
        appliedPolicy: {
          source: 'strategy_registry' as const,
          frequency: definition.rebalancePolicy.frequency,
          scenarioId: policyId,
          frozenBeforeMarketDataEvaluation: true as const,
        },
        primaryRun,
        sensitivity,
      }
    })

    const aggregateSensitivity = weeklyStarts.flatMap((startDate) => {
      const points = strategies.flatMap((strategy) => {
        const point = strategy.sensitivity.find((item) => item.startDate === startDate)
        return point ? [{ strategyId: strategy.strategyId, point }] : []
      })
      if (points.length === 0) return []
      const best = [...points].sort((left, right) => right.point.totalReturnPercent - left.point.totalReturnPercent)[0]
      return [{
        startDate,
        endDate: points[0].point.endDate,
        holdingTradingDays: points[0].point.holdingTradingDays,
        strategyCount: points.length,
        maximumTerminalReturnPercent: round(Math.max(...points.map(({ point }) => point.totalReturnPercent))),
        averageTerminalReturnPercent: round(points.reduce((sum, { point }) => sum + point.totalReturnPercent, 0) / points.length),
        worstMaxDrawdownPercent: round(Math.min(...points.map(({ point }) => point.maxDrawdownPercent))),
        bestStrategyId: best.strategyId,
      }]
    })

    const auditPassed = dataBlockers.length === 0 && allCommonDates.length >= 2
    return {
      schemaVersion: 'portfolio.fixed_rule_study.v1',
      generatedAt: new Date().toISOString(),
      requestedPeriod: { startDate: input.request.startDate, endDate: input.request.endDate },
      actualPeriod: {
        startDate: allCommonDates[0] || null,
        endDate: allCommonDates.at(-1) || null,
        tradingDays: allCommonDates.length,
      },
      initialCapital: input.request.initialCapital,
      ruleMode: 'registry_fixed',
      executionAssumptions: {
        signalTime: 'previous_close',
        executionPrice: 'next_open',
        lotSize: config.lotSize,
        feeRate: input.request.feeRate,
        minCommissionCny: config.minCommissionCny,
        slippageRate: input.request.slippageRate,
        stampDutyRate: 0,
        cashAssetId: 'CNY_FIXED_1PCT',
        cashAnnualRate: config.cashAnnualRate,
      },
      dataTruthAudit: {
        status: auditPassed ? 'passed' : 'blocked',
        minimumRequiredCoveragePercent: 98,
        items: dataItems,
        blockers: [
          ...dataBlockers,
          ...(allCommonDates.length >= 2 ? [] : [`common_trading_days_below_2:${allCommonDates.length}`]),
        ],
        warnings: [
          'free_provider_market_bars_are_research_grade',
          'cash_1pct_is_user_selected_model_assumption_not_a_bank_security',
          'official_distribution_registry_is_complete_only_through_2026-08-28',
        ],
        evidenceRefs: [
          ...symbols.map((symbol) => `market_bar_canonical:${symbol}:${input.request.startDate}:${input.request.endDate}`),
          ...symbols.map((symbol) => `tencent_raw_daily_history_cross_check:${symbol}:800`),
          ...symbols.flatMap((symbol) => (CLASSIC_PORTFOLIO_OFFICIAL_DISTRIBUTIONS[symbol] || []).map((event) => event.evidenceRef)),
        ],
      },
      strategies,
      aggregateSensitivity,
      sensitivityConfig: {
        sampling: 'weekly_first_trading_day',
        minimumTradingDaysForAnnualization: minimumTradingDays,
        startPointCount: weeklyStarts.length,
      },
      methodology: {
        historicalRuleOptimizationUsed: false,
        futureDataUsedToChooseRule: false,
        summary: '组合定义、权重和调仓频率在读取行情结果前由策略注册表冻结；起投敏感性只改变起投日。',
      },
      allowedActions: PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
      prohibitedActions: PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
  }
}

export const portfolioFixedRuleStudyService = new PortfolioFixedRuleStudyService()
