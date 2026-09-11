import { prisma } from '../../db/prisma.js'
import {
  PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
  PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
  type PortfolioBacktestInputBuildResult,
  type PortfolioClassicStudy,
  type PortfolioScenarioPolicyId,
  type PortfolioScenarioResult,
} from './portfolioBacktestTypes.js'
import {
  portfolioScenarioEngine,
  type PortfolioCashDistributionEvent,
  type PortfolioScenarioBar,
} from './portfolioScenarioEngine.js'
import { portfolioStrategyRegistry } from './portfolioStrategyRegistry.js'
import { getTencentRawStockHistory } from '../../utils/stockUtils.js'

export const CLASSIC_PORTFOLIO_SYMBOL_NAMES: Record<string, string> = {
  '510300': '沪深300ETF',
  '510500': '中证500ETF',
  '511010': '五年国债ETF',
  '511260': '十年国债ETF',
  '512890': '红利低波ETF',
  '518880': '黄金ETF',
  '159985': '豆粕ETF',
}

const OFFICIAL_2026_CLOSED_DATES = new Set([
  '2026-01-01', '2026-01-02',
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20', '2026-02-23',
  '2026-04-06',
  '2026-05-01', '2026-05-04', '2026-05-05',
  '2026-06-19',
  '2026-09-25',
  '2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07',
])

const POLICY_IDS: PortfolioScenarioPolicyId[] = ['buy_and_hold', 'weekly', 'semi_monthly', 'monthly', 'quarterly', 'drift_3pp']

export const CLASSIC_PORTFOLIO_OFFICIAL_DISTRIBUTIONS: Record<string, PortfolioCashDistributionEvent[]> = {
  '510300': [
    { recordDate: '2024-01-17', exDate: '2024-01-18', paymentDate: '2024-01-23', amountPerShare: 0.069, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2024-01-11/510300_20240111_QQFV.pdf' },
    { recordDate: '2025-06-17', exDate: '2025-06-18', paymentDate: '2025-06-27', amountPerShare: 0.088, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-06-11/510300_20250611_ZAU4.pdf' },
    { recordDate: '2026-01-16', exDate: '2026-01-19', paymentDate: '2026-01-27', amountPerShare: 0.123, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-01-12/510300_20260112_VTCZ.pdf' },
  ],
  '510500': [
    { recordDate: '2024-05-16', exDate: '2024-05-17', paymentDate: '2024-05-22', amountPerShare: 0.087, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2024-05-10/510500_20240510_LM77.pdf' },
    { recordDate: '2025-01-15', exDate: '2025-01-16', paymentDate: '2025-01-21', amountPerShare: 0.091, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-01-09/510500_20250109_GIJW.pdf' },
    { recordDate: '2026-01-15', exDate: '2026-01-16', paymentDate: '2026-01-21', amountPerShare: 0.062, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-01-09/510500_20260109_5K7U.pdf' },
    { recordDate: '2026-07-14', exDate: '2026-07-15', paymentDate: '2026-07-20', amountPerShare: 0.149, evidenceRef: 'https://www.sse.com.cn/assortment/options/disclo/update/c/c_20260708_10824766.shtml' },
  ],
  '511010': [
    { recordDate: '2025-09-22', exDate: '2025-09-23', paymentDate: '2025-09-26', amountPerShare: 1.45, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-09-18/511010_20250918_FU3S.pdf' },
    { recordDate: '2025-12-25', exDate: '2025-12-26', paymentDate: '2025-12-31', amountPerShare: 0.6542, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-12-23/511010_20251223_0M89.pdf' },
    { recordDate: '2026-03-24', exDate: '2026-03-25', paymentDate: '2026-03-30', amountPerShare: 0.5715, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-03-20/511010_20260320_Y87H.pdf' },
    { recordDate: '2026-06-24', exDate: '2026-06-25', paymentDate: '2026-06-30', amountPerShare: 0.8144, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-06-22/511010_20260622_0EYP.pdf' },
  ],
  '511260': [
    { recordDate: '2025-09-22', exDate: '2025-09-23', paymentDate: '2025-09-26', amountPerShare: 1.36, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-09-18/511260_20250918_HDYX.pdf' },
    { recordDate: '2025-12-25', exDate: '2025-12-26', paymentDate: '2025-12-31', amountPerShare: 0.833, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2025-12-23/511260_20251223_ZED8.pdf' },
    { recordDate: '2026-03-24', exDate: '2026-03-25', paymentDate: '2026-03-30', amountPerShare: 0.6711, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-03-20/511260_20260320_QYES.pdf' },
    { recordDate: '2026-06-24', exDate: '2026-06-25', paymentDate: '2026-06-30', amountPerShare: 1.2686, evidenceRef: 'https://www.sse.com.cn/disclosure/fund/announcement/c/new/2026-06-22/511260_20260622_BWI3.pdf' },
  ],
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function round(value: number, digits = 2) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function median(values: number[]) {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function dateDiff(startDate: string, endDate: string) {
  return Math.max(0, Math.round((new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime()) / 86400000))
}

function isTradingDay(date: Date) {
  const day = date.getUTCDay()
  const key = isoDate(date)
  return day !== 0 && day !== 6 && !OFFICIAL_2026_CLOSED_DATES.has(key)
}

function nextTradingDay(afterDate: string) {
  const value = new Date(`${afterDate}T00:00:00.000Z`)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    value.setUTCDate(value.getUTCDate() + 1)
    if (isTradingDay(value)) return isoDate(value)
  }
  return null
}

function nextWeekdayOnOrAfter(afterDate: string, weekday: number) {
  const value = new Date(`${afterDate}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (value.getUTCDay() === weekday && isTradingDay(value)) return isoDate(value)
    value.setUTCDate(value.getUTCDate() + 1)
  }
  return null
}

function nextMonthBoundary(afterDate: string, semiMonthly: boolean) {
  const after = new Date(`${afterDate}T00:00:00.000Z`)
  const candidates: Date[] = []
  for (let monthOffset = 0; monthOffset < 3; monthOffset += 1) {
    const year = after.getUTCFullYear()
    const month = after.getUTCMonth() + monthOffset
    if (semiMonthly) candidates.push(new Date(Date.UTC(year, month, 15)))
    candidates.push(new Date(Date.UTC(year, month + 1, 0)))
  }
  for (const candidate of candidates.sort((left, right) => left.getTime() - right.getTime())) {
    while (!isTradingDay(candidate)) candidate.setUTCDate(candidate.getUTCDate() - 1)
    if (candidate.getTime() > after.getTime()) return isoDate(candidate)
  }
  return null
}

function nextQuarterBoundary(afterDate: string) {
  const after = new Date(`${afterDate}T00:00:00.000Z`)
  for (let offset = 0; offset < 6; offset += 1) {
    const month = after.getUTCMonth() + offset
    if (![2, 5, 8, 11].includes(((month % 12) + 12) % 12)) continue
    const candidate = new Date(Date.UTC(after.getUTCFullYear(), month + 1, 0))
    while (!isTradingDay(candidate)) candidate.setUTCDate(candidate.getUTCDate() - 1)
    if (candidate.getTime() > after.getTime()) return isoDate(candidate)
  }
  return null
}

function nextDecision(policyId: PortfolioScenarioPolicyId, asOfDate: string) {
  let decisionDate: string | null = null
  let rule = ''
  if (policyId === 'buy_and_hold') rule = '仅期初建仓，不设固定再平衡日'
  if (policyId === 'weekly') {
    decisionDate = nextWeekdayOnOrAfter(asOfDate, 5)
    rule = '每周最后交易日15:00后检查'
  }
  if (policyId === 'semi_monthly') {
    decisionDate = nextMonthBoundary(asOfDate, true)
    rule = '每月15日前最后交易日及月末最后交易日15:00后检查'
  }
  if (policyId === 'monthly') {
    decisionDate = nextMonthBoundary(asOfDate, false)
    rule = '每月最后交易日15:00后检查'
  }
  if (policyId === 'quarterly') {
    decisionDate = nextQuarterBoundary(asOfDate)
    rule = '每季度最后交易日15:00后检查'
  }
  if (policyId === 'drift_3pp') {
    decisionDate = nextTradingDay(asOfDate)
    rule = '每个交易日15:00后检查绝对权重偏离是否达到3个百分点'
  }
  return {
    decisionDate,
    executionDate: decisionDate ? nextTradingDay(decisionDate) : null,
    rule,
    calendarSource: 'SSE 2026 official holiday schedule; weekday fallback outside the published 2026 window',
  }
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

function preferredScenario(scenarios: PortfolioScenarioResult[]) {
  const completed = scenarios.filter((item) => item.status === 'completed')
  if (completed.length === 0) return { id: null, reason: '没有可比较的完整情景。' }
  const baseline = completed.find((item) => item.scenarioId === 'buy_and_hold')
  const eligible = completed.filter((item) => {
    if (!baseline) return true
    return item.validationMetrics.totalReturnPercent >= baseline.validationMetrics.totalReturnPercent - 1
      && item.validationMetrics.maxDrawdownPercent >= baseline.validationMetrics.maxDrawdownPercent - 2
  })
  const ranked = (eligible.length > 0 ? eligible : completed).sort((left, right) => {
    const sharpeDiff = (right.validationMetrics.sharpe ?? -999) - (left.validationMetrics.sharpe ?? -999)
    if (Math.abs(sharpeDiff) > 0.05) return sharpeDiff
    return left.metrics.turnoverRatePercent - right.metrics.turnoverRatePercent
  })
  const selected = ranked[0]
  return {
    id: selected.scenarioId,
    reason: `后12个月验证收益 ${selected.validationMetrics.totalReturnPercent.toFixed(2)}%，最大回撤 ${selected.validationMetrics.maxDrawdownPercent.toFixed(2)}%，Sharpe ${selected.validationMetrics.sharpe?.toFixed(2) ?? '--'}；同档结果优先选择换手更低者。`,
  }
}

export class ClassicPortfolioStudyService {
  async run(input: PortfolioBacktestInputBuildResult): Promise<PortfolioClassicStudy | undefined> {
    const config = input.request.scenarioAnalysis
    if (!config?.enabled) return undefined
    const classicIds = new Set(portfolioStrategyRegistry.classicResearchStrategyIds())
    const definitions = input.strategies.filter((item) => classicIds.has(item.strategyId))
    if (definitions.length === 0) return undefined

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
      const missingOpen = rows.filter((row) => !row.openPrice || row.openPrice <= 0).length
      missingOpenBySymbol.set(symbol, missingOpen)
      providersBySymbol.set(symbol, new Set(rows.map((row) => row.primaryProvider || 'unknown')))
      barsBySymbol.set(symbol, new Map(rows.map((row) => {
        const date = isoDate(row.tradeDate)
        return [date, { date, open: row.openPrice && row.openPrice > 0 ? row.openPrice : row.closePrice, close: row.closePrice }]
      })))
    }

    const crossChecks = new Map<string, Awaited<ReturnType<typeof getTencentRawStockHistory>>>()
    await Promise.all(symbols.map(async (symbol) => {
      const history = await getTencentRawStockHistory(symbol, 800).catch(() => [])
      crossChecks.set(symbol, history)
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
      const coveragePercent = unionDates.length > 0 ? round((dates.length / unionDates.length) * 100) : 0
      const firstDate = dates[0] || null
      const lastDate = dates.at(-1) || null
      const dateBoundaryReady = Boolean(firstDate && lastDate
        && dateDiff(input.request.startDate, firstDate) <= 7
        && dateDiff(lastDate, input.request.endDate) <= 7)
      const missingOpen = missingOpenBySymbol.get(symbol) || 0
      const crossCheckRows = crossChecks.get(symbol) || []
      const deviations = crossCheckRows.flatMap((row) => {
        const canonical = bars.get(row.date)?.close
        return canonical && row.close > 0 ? [Math.abs(canonical / row.close - 1) * 100] : []
      })
      const medianCloseDeviationPercent = median(deviations)
      const latestCrossCheck = [...crossCheckRows].reverse().find((row) => bars.has(row.date) && row.close > 0)
      const latestCanonical = latestCrossCheck ? bars.get(latestCrossCheck.date)?.close : null
      const latestCloseDeviationPercent = latestCrossCheck && latestCanonical
        ? Math.abs(latestCanonical / latestCrossCheck.close - 1) * 100
        : null
      const distributionEvents = distributionsBySymbol.get(symbol) || []
      const crossCheckPassed = deviations.length >= 700
        && latestCloseDeviationPercent !== null
        && latestCloseDeviationPercent <= 0.5
      const warnings = [
        ...(missingOpen > 0 ? [`missing_open_fallback_to_close:${missingOpen}`] : []),
        ...(!dateBoundaryReady ? ['requested_date_boundary_not_covered'] : []),
        ...(!crossCheckPassed ? [`tencent_raw_cross_check_blocked:bars=${deviations.length}:latest=${latestCloseDeviationPercent}`] : []),
        'official_cash_distribution_registry_is_static_and_audited_through_2026-08-28',
      ]
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
        medianCloseDeviationPercent: medianCloseDeviationPercent === null ? null : round(medianCloseDeviationPercent, 4),
        latestCloseDeviationPercent: latestCloseDeviationPercent === null ? null : round(latestCloseDeviationPercent, 4),
        crossCheckStatus: crossCheckPassed ? 'passed' as const : 'blocked' as const,
        distributionEvents: distributionEvents.length,
        distributionEventSource: distributionEvents.length > 0 ? 'official_sse_registry' as const : 'not_detected' as const,
        officialDistributionEvidenceRefs: distributionEvents.map((event) => event.evidenceRef),
        totalReturnAdjustmentStatus: crossCheckRows.length >= 700
          ? distributionEvents.length > 0 ? 'official_cash_distributions' as const : 'not_detected' as const
          : 'insufficient' as const,
        status: coveragePercent >= 98 && dateBoundaryReady && crossCheckPassed ? 'passed' as const : 'blocked' as const,
        warnings,
      }
    })
    const dataBlockers = dataItems.filter((item) => item.status === 'blocked').map((item) => `real_data_truth_requirement_failed:${item.symbol}:coverage=${item.coveragePercent}:cross_check=${item.crossCheckStatus}`)
    const allCommonDates = commonDates(symbols, barsBySymbol)

    const policyIds = config.policyIds?.length ? config.policyIds : POLICY_IDS
    const strategies = definitions.map((definition) => {
      const strategySymbols = definition.components
        .filter((component) => component.assetClass !== 'cash')
        .map((component) => component.symbol || component.proxySymbol)
        .filter((symbol): symbol is string => Boolean(symbol))
      const dates = commonDates(strategySymbols, barsBySymbol)
      const scenarios = policyIds.map((scenarioId) => portfolioScenarioEngine.run({
        strategyId: definition.strategyId,
        components: definition.components,
        barsBySymbol,
        dates,
        scenarioId,
        initialCapital: input.request.initialCapital,
        feeRate: input.request.feeRate,
        minCommissionCny: config.minCommissionCny,
        slippageRate: input.request.slippageRate,
        cashAnnualRate: config.cashAnnualRate,
        lotSize: config.lotSize,
        driftThresholdPercentagePoints: config.driftThresholdPercentagePoints,
        validationMonths: config.validationMonths,
        distributionsBySymbol,
      }))
      const preference = preferredScenario(scenarios)
      return {
        strategyId: definition.strategyId,
        displayName: definition.displayName,
        components: definition.components,
        scenarios,
        preferredScenarioId: preference.id,
        preferenceReason: preference.reason,
        nextDecision: preference.id ? nextDecision(preference.id, input.request.endDate) : nextDecision('buy_and_hold', input.request.endDate),
      }
    })

    const best = strategies
      .map((strategy) => ({ strategy, scenario: strategy.scenarios.find((item) => item.scenarioId === strategy.preferredScenarioId) }))
      .filter((item): item is { strategy: typeof strategies[number]; scenario: PortfolioScenarioResult } => Boolean(item.scenario))
      .sort((left, right) => {
        const sharpeDiff = (right.scenario.validationMetrics.sharpe ?? -999) - (left.scenario.validationMetrics.sharpe ?? -999)
        if (Math.abs(sharpeDiff) > 0.05) return sharpeDiff
        return right.scenario.validationMetrics.totalReturnPercent - left.scenario.validationMetrics.totalReturnPercent
      })[0]
    const auditPassed = dataBlockers.length === 0 && allCommonDates.length >= 700
    const summary = best
      ? `${best.strategy.displayName}在后12个月验证期的风险收益排序领先；建议频率为${best.scenario.scenarioLabel}。该结论仅覆盖近三年，不能外推为长期必然有效。`
      : '真实行情或共同交易日不足，无法形成组合及调仓频率结论。'

    return {
      schemaVersion: 'portfolio.classic_strategy_study.v1',
      generatedAt: new Date().toISOString(),
      requestedPeriod: { startDate: input.request.startDate, endDate: input.request.endDate },
      actualPeriod: {
        startDate: allCommonDates[0] || null,
        endDate: allCommonDates.at(-1) || null,
        tradingDays: allCommonDates.length,
      },
      initialCapital: input.request.initialCapital,
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
          ...(allCommonDates.length >= 700 ? [] : [`all_asset_common_trading_days_below_700:${allCommonDates.length}`]),
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
          'https://www.sse.com.cn/disclosure/dealinstruc/closed/list/',
        ],
      },
      strategies,
      conclusion: {
        bestStrategyId: auditPassed ? best?.strategy.strategyId || null : null,
        bestScenarioId: auditPassed ? best?.scenario.scenarioId || null : null,
        summary: auditPassed ? summary : `数据真实性门禁未通过：${dataBlockers.length}个标的覆盖或独立源核验不足，暂不输出有效性推荐。`,
        confidence: auditPassed ? 'low' : 'insufficient',
        horizon: 'three_year_research',
        caveats: [
          '三年样本不足以证明跨周期长期有效。',
          '中国版黄金蝴蝶使用中证500近似小盘价值、五年国债近似短债，存在代理偏差。',
          '固定1%现金收益假设依赖分批存款能够保持近似流动性。',
          '历史最优调仓频率可能过拟合，必须继续前向观察。',
        ],
      },
      allowedActions: PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
      prohibitedActions: PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
  }
}

export const classicPortfolioStudyService = new ClassicPortfolioStudyService()
