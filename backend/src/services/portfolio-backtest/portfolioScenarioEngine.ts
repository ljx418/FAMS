import type {
  PortfolioBacktestCurvePoint,
  PortfolioScenarioMetrics,
  PortfolioScenarioPolicyId,
  PortfolioScenarioResult,
  PortfolioScenarioTrade,
  PortfolioPositionCurvePoint,
  PortfolioStrategyComponent,
} from './portfolioBacktestTypes.js'

export interface PortfolioScenarioBar {
  date: string
  open: number
  close: number
}

export interface PortfolioCashDistributionEvent {
  recordDate: string
  exDate: string
  paymentDate: string
  amountPerShare: number
  evidenceRef: string
}

export interface PortfolioScenarioEngineInput {
  strategyId: string
  components: PortfolioStrategyComponent[]
  barsBySymbol: Map<string, Map<string, PortfolioScenarioBar>>
  dates: string[]
  scenarioId: PortfolioScenarioPolicyId
  initialCapital: number
  feeRate: number
  minCommissionCny: number
  slippageRate: number
  cashAnnualRate: number
  lotSize: number
  driftThresholdPercentagePoints: number
  validationMonths: number
  distributionsBySymbol?: Map<string, PortfolioCashDistributionEvent[]>
}

type ValuationPoint = PortfolioBacktestCurvePoint & { portfolioValue: number }

const SCENARIO_LABELS: Record<PortfolioScenarioPolicyId, string> = {
  buy_and_hold: '不调仓',
  weekly: '每周强制恢复',
  semi_monthly: '每半月强制恢复',
  monthly: '每月强制恢复',
  quarterly: '每季度强制恢复',
  drift_3pp: '偏离3个百分点触发',
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function dayDiff(startDate: string, endDate: string) {
  return Math.max(0, Math.round((new Date(`${endDate}T00:00:00.000Z`).getTime() - new Date(`${startDate}T00:00:00.000Z`).getTime()) / 86400000))
}

function calendarKey(date: string, policy: PortfolioScenarioPolicyId) {
  const value = new Date(`${date}T00:00:00.000Z`)
  const year = value.getUTCFullYear()
  const month = value.getUTCMonth() + 1
  if (policy === 'weekly') {
    const copy = new Date(value)
    const weekday = copy.getUTCDay() || 7
    copy.setUTCDate(copy.getUTCDate() - weekday + 1)
    return `W:${copy.toISOString().slice(0, 10)}`
  }
  if (policy === 'semi_monthly') return `${year}-${month}-${value.getUTCDate() <= 15 ? 'H1' : 'H2'}`
  if (policy === 'monthly') return `${year}-${month}`
  if (policy === 'quarterly') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`
  return policy
}

function isCalendarDecision(dates: string[], index: number, policy: PortfolioScenarioPolicyId) {
  if (!['weekly', 'semi_monthly', 'monthly', 'quarterly'].includes(policy)) return false
  const nextDate = dates[index + 1]
  if (!nextDate) return false
  return calendarKey(dates[index], policy) !== calendarKey(nextDate, policy)
}

function emptyMetrics(initialCapital: number): PortfolioScenarioMetrics {
  return {
    totalReturnPercent: 0,
    annualizedReturnPercent: 0,
    maxDrawdownPercent: 0,
    volatilityPercent: 0,
    sharpe: null,
    calmar: null,
    turnoverRatePercent: 0,
    totalCostCny: 0,
    costDragPercent: 0,
    tradeCount: 0,
    endingValue: initialCapital,
  }
}

function calculateMetrics(
  curve: ValuationPoint[],
  trades: PortfolioScenarioTrade[],
  initialValue: number,
  cashAnnualRate: number,
): PortfolioScenarioMetrics {
  if (curve.length < 2 || initialValue <= 0) return emptyMetrics(initialValue)
  const endingValue = curve.at(-1)!.portfolioValue
  const elapsedDays = Math.max(1, dayDiff(curve[0].date, curve.at(-1)!.date))
  const totalReturn = endingValue / initialValue - 1
  const annualizedReturn = (1 + totalReturn) ** (365 / elapsedDays) - 1
  const returns: number[] = []
  for (let index = 1; index < curve.length; index += 1) {
    const previous = curve[index - 1].portfolioValue
    if (previous > 0) returns.push(curve[index].portfolioValue / previous - 1)
  }
  const mean = returns.length > 0 ? returns.reduce((sum, item) => sum + item, 0) / returns.length : 0
  const variance = returns.length > 0 ? returns.reduce((sum, item) => sum + ((item - mean) ** 2), 0) / returns.length : 0
  const volatility = Math.sqrt(variance) * Math.sqrt(252)
  const dailyRiskFree = (1 + cashAnnualRate) ** (1 / 252) - 1
  const excessMean = mean - dailyRiskFree
  const sharpe = volatility > 0 ? (excessMean * 252) / volatility : null
  const maxDrawdown = Math.min(...curve.map((point) => point.drawdownPercent)) / 100
  const totalCost = trades.reduce((sum, trade) => sum + trade.totalCost, 0)
  const turnover = trades.reduce((sum, trade) => sum + trade.rawOpenPrice * trade.quantity, 0)
  return {
    totalReturnPercent: round(totalReturn * 100),
    annualizedReturnPercent: round(annualizedReturn * 100),
    maxDrawdownPercent: round(maxDrawdown * 100),
    volatilityPercent: round(volatility * 100),
    sharpe: sharpe === null ? null : round(sharpe),
    calmar: maxDrawdown < 0 ? round(annualizedReturn / Math.abs(maxDrawdown)) : null,
    turnoverRatePercent: round((turnover / initialValue) * 100),
    totalCostCny: round(totalCost, 2),
    costDragPercent: round((totalCost / initialValue) * 100),
    tradeCount: trades.length,
    endingValue: round(endingValue, 2),
  }
}

function subtractMonths(date: string, months: number) {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCMonth(value.getUTCMonth() - months)
  return value.toISOString().slice(0, 10)
}

export class PortfolioScenarioEngine {
  run(input: PortfolioScenarioEngineInput): PortfolioScenarioResult {
    if (input.dates.length < 2) {
      return {
        scenarioId: input.scenarioId,
        scenarioLabel: SCENARIO_LABELS[input.scenarioId],
        status: 'insufficient',
        metrics: emptyMetrics(input.initialCapital),
        validationMetrics: emptyMetrics(input.initialCapital),
        equityCurve: [],
        positionCurve: [],
        trades: [],
        decisionDates: [],
        blockedReasons: ['common_price_dates_insufficient'],
        warnings: [],
      }
    }

    const nonCash = input.components.filter((item) => item.assetClass !== 'cash' && item.symbol)
    const holdings = new Map<string, number>()
    let cash = input.initialCapital
    let pendingDecision: { date: string; reason: PortfolioScenarioTrade['reason'] } | null = {
      date: input.dates[0],
      reason: 'initial_allocation',
    }
    const trades: PortfolioScenarioTrade[] = []
    const decisionDates: string[] = [input.dates[0]]
    const curve: ValuationPoint[] = []
    const positionCurve: PortfolioPositionCurvePoint[] = []
    let peak = input.initialCapital
    let previousValue = input.initialCapital
    let previousDate = input.dates[0]
    const distributionEntitlements = new Map<string, number>()

    const priceAt = (symbol: string, date: string, field: 'open' | 'close') => input.barsBySymbol.get(symbol)?.get(date)?.[field] || 0
    const portfolioValueAt = (date: string, field: 'open' | 'close') => cash + nonCash.reduce((sum, item) => {
      const symbol = item.symbol!
      return sum + (holdings.get(symbol) || 0) * priceAt(symbol, date, field)
    }, 0)

    const weightsAtClose = (date: string) => {
      const total = portfolioValueAt(date, 'close')
      const nonCashWeights = nonCash.map((item) => ({
        target: item.targetWeightPercent,
        actual: total > 0 ? (((holdings.get(item.symbol!) || 0) * priceAt(item.symbol!, date, 'close')) / total) * 100 : 0,
      }))
      const cashTarget = input.components
        .filter((item) => item.assetClass === 'cash')
        .reduce((sum, item) => sum + item.targetWeightPercent, 0)
      return cashTarget > 0
        ? [...nonCashWeights, { target: cashTarget, actual: total > 0 ? (cash / total) * 100 : 0 }]
        : nonCashWeights
    }

    const executeRebalance = (decisionDate: string, executionDate: string, reason: PortfolioScenarioTrade['reason']) => {
      const totalAtOpen = portfolioValueAt(executionDate, 'open')
      const targets = new Map<string, number>()
      for (const component of nonCash) {
        const rawOpen = priceAt(component.symbol!, executionDate, 'open')
        if (rawOpen <= 0) continue
        const buyPrice = rawOpen * (1 + input.slippageRate)
        const targetValue = totalAtOpen * (component.targetWeightPercent / 100)
        targets.set(component.symbol!, Math.max(0, Math.floor(targetValue / buyPrice / input.lotSize) * input.lotSize))
      }

      const generated: PortfolioScenarioTrade[] = []
      const createTrade = (component: PortfolioStrategyComponent, side: 'BUY' | 'SELL', quantity: number) => {
        if (quantity < input.lotSize) return
        const rawOpenPrice = priceAt(component.symbol!, executionDate, 'open')
        const simulatedPrice = rawOpenPrice * (side === 'BUY' ? 1 + input.slippageRate : 1 - input.slippageRate)
        const grossAmount = simulatedPrice * quantity
        const commission = Math.max(input.minCommissionCny, grossAmount * input.feeRate)
        const slippageCost = rawOpenPrice * quantity * input.slippageRate
        if (side === 'BUY') {
          cash -= grossAmount + commission
          holdings.set(component.symbol!, (holdings.get(component.symbol!) || 0) + quantity)
        } else {
          cash += grossAmount - commission
          holdings.set(component.symbol!, Math.max(0, (holdings.get(component.symbol!) || 0) - quantity))
        }
        generated.push({
          decisionDate,
          executionDate,
          reason,
          symbol: component.symbol!,
          name: component.name || component.symbol!,
          side,
          quantity,
          lots: quantity / input.lotSize,
          rawOpenPrice: round(rawOpenPrice, 4),
          simulatedPrice: round(simulatedPrice, 4),
          grossAmount: round(grossAmount, 2),
          commission: round(commission, 2),
          slippageCost: round(slippageCost, 2),
          totalCost: round(commission + slippageCost, 2),
          postTradeWeightPercent: 0,
          cashAfter: 0,
        })
      }

      for (const component of nonCash) {
        const current = holdings.get(component.symbol!) || 0
        const target = targets.get(component.symbol!) || 0
        const quantity = Math.floor((current - target) / input.lotSize) * input.lotSize
        if (quantity > 0) createTrade(component, 'SELL', quantity)
      }
      for (const component of nonCash) {
        const current = holdings.get(component.symbol!) || 0
        const target = targets.get(component.symbol!) || 0
        let quantity = Math.floor((target - current) / input.lotSize) * input.lotSize
        const rawOpen = priceAt(component.symbol!, executionDate, 'open')
        while (quantity >= input.lotSize) {
          const gross = rawOpen * (1 + input.slippageRate) * quantity
          const commission = Math.max(input.minCommissionCny, gross * input.feeRate)
          if (gross + commission <= cash + 0.0001) break
          quantity -= input.lotSize
        }
        if (quantity > 0) createTrade(component, 'BUY', quantity)
      }

      const totalAfter = portfolioValueAt(executionDate, 'open')
      for (const trade of generated) {
        trade.postTradeWeightPercent = totalAfter > 0
          ? round((((holdings.get(trade.symbol) || 0) * priceAt(trade.symbol, executionDate, 'open')) / totalAfter) * 100)
          : 0
        trade.cashAfter = round(cash, 2)
      }
      trades.push(...generated)
    }

    const applyDistributionReinvestment = (date: string) => {
      for (const component of nonCash) {
        const symbol = component.symbol!
        const event = input.distributionsBySymbol?.get(symbol)?.find((item) => item.paymentDate === date)
        if (!event) continue
        const entitlementKey = `${symbol}:${event.recordDate}:${event.paymentDate}`
        const entitledQuantity = distributionEntitlements.get(entitlementKey) || 0
        const heldQuantity = holdings.get(symbol) || 0
        if (entitledQuantity <= 0 || event.amountPerShare <= 0) continue
        const dividendCash = entitledQuantity * event.amountPerShare
        cash += dividendCash
        const rawOpenPrice = priceAt(symbol, date, 'open')
        if (rawOpenPrice <= 0) continue
        const simulatedPrice = rawOpenPrice * (1 + input.slippageRate)
        let quantity = Math.floor(dividendCash / simulatedPrice / input.lotSize) * input.lotSize
        while (quantity >= input.lotSize) {
          const grossAmount = simulatedPrice * quantity
          const commission = Math.max(input.minCommissionCny, grossAmount * input.feeRate)
          if (grossAmount + commission <= dividendCash + 0.0001) break
          quantity -= input.lotSize
        }
        if (quantity < input.lotSize) continue
        const grossAmount = simulatedPrice * quantity
        const commission = Math.max(input.minCommissionCny, grossAmount * input.feeRate)
        const slippageCost = rawOpenPrice * quantity * input.slippageRate
        cash -= grossAmount + commission
        holdings.set(symbol, heldQuantity + quantity)
        const totalAfter = portfolioValueAt(date, 'open')
        trades.push({
          decisionDate: date,
          executionDate: date,
          reason: 'dividend_reinvestment',
          symbol,
          name: component.name || symbol,
          side: 'BUY',
          quantity,
          lots: quantity / input.lotSize,
          rawOpenPrice: round(rawOpenPrice, 4),
          simulatedPrice: round(simulatedPrice, 4),
          grossAmount: round(grossAmount, 2),
          commission: round(commission, 2),
          slippageCost: round(slippageCost, 2),
          totalCost: round(commission + slippageCost, 2),
          postTradeWeightPercent: totalAfter > 0 ? round(((holdings.get(symbol) || 0) * rawOpenPrice / totalAfter) * 100) : 0,
          cashAfter: round(cash, 2),
        })
      }
    }

    for (let index = 0; index < input.dates.length; index += 1) {
      const date = input.dates[index]
      if (index > 0 && cash > 0) {
        cash *= (1 + input.cashAnnualRate) ** (dayDiff(previousDate, date) / 365)
      }
      applyDistributionReinvestment(date)
      if (pendingDecision) {
        executeRebalance(pendingDecision.date, date, pendingDecision.reason)
        pendingDecision = null
      }

      const value = portfolioValueAt(date, 'close')
      peak = Math.max(peak, value)
      const dailyReturnPercent = index === 0 || previousValue <= 0 ? 0 : (value / previousValue - 1) * 100
      const point: ValuationPoint = {
        date,
        portfolioValue: value,
        netValue: round(value / input.initialCapital, 6),
        pnlAmount: round(value - input.initialCapital, 2),
        cumulativeReturnPercent: round((value / input.initialCapital - 1) * 100),
        dailyReturnPercent: round(dailyReturnPercent),
        drawdownPercent: peak > 0 ? round((value / peak - 1) * 100) : 0,
      }
      curve.push(point)
      positionCurve.push({
        date,
        portfolioValue: round(value, 2),
        pnlAmount: round(value - input.initialCapital, 2),
        cashAmount: round(cash, 2),
        cashWeightPercent: value > 0 ? round((cash / value) * 100) : 0,
        components: nonCash.map((component) => {
          const symbol = component.symbol!
          const quantity = holdings.get(symbol) || 0
          const marketValue = quantity * priceAt(symbol, date, 'close')
          return {
            symbol,
            name: component.name || symbol,
            quantity,
            marketValue: round(marketValue, 2),
            weightPercent: value > 0 ? round((marketValue / value) * 100) : 0,
          }
        }),
      })
      previousValue = value
      previousDate = date

      for (const component of nonCash) {
        const symbol = component.symbol!
        for (const event of input.distributionsBySymbol?.get(symbol) || []) {
          if (event.recordDate !== date) continue
          distributionEntitlements.set(`${symbol}:${event.recordDate}:${event.paymentDate}`, holdings.get(symbol) || 0)
        }
      }

      if (index >= input.dates.length - 1 || pendingDecision) continue
      const calendarTriggered = isCalendarDecision(input.dates, index, input.scenarioId)
      const driftTriggered = input.scenarioId === 'drift_3pp'
        && weightsAtClose(date).some((item) => Math.abs(item.actual - item.target) >= input.driftThresholdPercentagePoints)
      if (calendarTriggered || driftTriggered) {
        pendingDecision = {
          date,
          reason: driftTriggered ? 'drift_threshold' : 'calendar_rebalance',
        }
        decisionDates.push(date)
      }

    }

    const validationStart = subtractMonths(input.dates.at(-1)!, input.validationMonths)
    const validationCurve = curve.filter((point) => point.date >= validationStart)
    const validationTrades = trades.filter((trade) => trade.executionDate >= validationStart)
    const validationInitialValue = validationCurve[0]?.portfolioValue || input.initialCapital
    const metrics = calculateMetrics(curve, trades, input.initialCapital, input.cashAnnualRate)
    const validationMetrics = calculateMetrics(validationCurve, validationTrades, validationInitialValue, input.cashAnnualRate)

    return {
      scenarioId: input.scenarioId,
      scenarioLabel: SCENARIO_LABELS[input.scenarioId],
      status: 'completed',
      metrics,
      validationMetrics,
      equityCurve: curve.map((point) => ({ ...point, portfolioValue: round(point.portfolioValue, 2) })),
      positionCurve,
      trades,
      decisionDates,
      blockedReasons: [],
      warnings: [
        'research_simulation_only',
        'integer_lot_and_minimum_commission_applied',
        'cash_accrues_at_fixed_annual_rate_1pct',
        'official_cash_distributions_are_entitled_on_record_date_and_reinvested_on_payment_date; residual_cash_is_kept_when_one_lot_cannot_be_bought',
      ],
    }
  }
}

export const portfolioScenarioEngine = new PortfolioScenarioEngine()
