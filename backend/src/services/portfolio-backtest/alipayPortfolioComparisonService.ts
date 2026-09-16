import { prisma } from '../../db/prisma.js'
import {
  getSinaDomesticFuturesHistory,
  getTencentQfqStockHistory,
  type StockHistoryData,
} from '../../utils/stockUtils.js'
import { createHash } from 'node:crypto'

export type AlipayComparisonPriceBar = {
  date: string
  open: number
  close: number
  source: string
  proxy: boolean
  directSymbol: string
}

export type AlipayTargetBucketWeights = {
  cash: number
  gold: number
  bond: number
  equity: number
}

export type AlipayPortfolioComparisonRunOptions = {
  targetBucketWeights?: AlipayTargetBucketWeights
  targetStrategyId?: string
  targetDisplayName?: string
  driftThresholdPercentagePoints?: number
  requestedYears?: number
  minimumTradingDays?: number
  dataSourceProfile?: 'legacy_three_year_v1' | 'expanded_seven_year_v2'
}

type PriceBar = AlipayComparisonPriceBar

type SeriesAudit = {
  symbol: string
  name: string
  firstDate: string | null
  lastDate: string | null
  bars: number
  directBars: number
  proxyBars: number
  proxySymbol: string | null
  proxySymbols: string[]
  proxyMethod: string | null
  proxyRationale: string | null
  proxyRisk: 'none' | 'low' | 'medium' | 'high'
  sources: string[]
  status: 'passed' | 'insufficient'
  warnings: string[]
}

type Component = {
  symbol: string
  name: string
  targetWeightPercent: number
  bucket: 'cash' | 'gold' | 'bond' | 'equity' | 'stock' | 'commodity'
  execution: 'fund_nav' | 'etf_open'
}

type Trade = {
  decisionDate: string
  executionDate: string
  reason: 'initial_allocation' | 'drift_rebalance' | 'grid_buy' | 'grid_sell' | 'take_profit' | 'stop_loss' | 'monthly_reentry'
  symbol: string
  name: string
  side: 'BUY' | 'SELL'
  quantity: number
  price: number
  grossAmount: number
  cost: number
  cashAfter: number
}

type CurvePoint = {
  date: string
  portfolioValue: number
  netValue: number
  cumulativeReturnPercent: number
  drawdownPercent: number
}

export type ComparisonMetrics = {
  totalReturnPercent: number
  annualizedReturnPercent: number
  maxDrawdownPercent: number
  monthlyMaxDrawdownPercent: number
  worstMonthlyReturnPercent: number | null
  monthlyWinRatePercent: number | null
  volatilityPercent: number
  sharpe: number | null
  calmar: number | null
  endingValue: number
  totalCostCny: number
  grossTurnoverCny: number
  rebalanceTurnoverCny: number
  rebalanceTurnoverPercentOfInitialCapital: number
  tradeCount: number
}

export type ComparisonStrategy = {
  strategyId: string
  displayName: string
  group: 'target' | 'baseline' | 'single' | 'classic'
  status: 'completed' | 'insufficient'
  policyLabel: string
  components: Component[]
  metrics: ComparisonMetrics
  costStressMetrics: ComparisonMetrics | null
  costStressCurve?: CurvePoint[]
  costStressTrades?: Trade[]
  curve: CurvePoint[]
  monthlyCurve: CurvePoint[]
  trades: Trade[]
  triggerCounts: {
    drift: number
    gridBuy: number
    gridSell: number
    takeProfit: number
    stopLoss: number
    reentry: number
  }
  proxyCoveragePercent: number
  warnings: string[]
}

export type AlipayPortfolioComparisonStudy = {
  schemaVersion: 'portfolio.alipay_comparison.v1'
  generatedAt: string
  status: 'completed' | 'insufficient'
  userId: string
  accountId: 'alipay'
  period: {
    requestedYears: number
    startDate: string | null
    endDate: string | null
    tradingDays: number
  }
  snapshot: {
    capturedAt: string
    initialCapital: number
    positionCount: number
    positions: Array<{ symbol: string; name: string; marketValue: number; bucket: string | null }>
  }
  frozenRules: {
    targetBucketWeights: AlipayTargetBucketWeights
    driftThresholdPercentagePoints: number
    driftComparison: 'strictly_greater_than'
    singleAssetInitialWeightPercent: 85
    singleAssetCashWeightPercent: 15
    gridMovePercent: 3
    gridNotionalPercentOfInitialCapital: 3
    takeProfitPercent: 10
    stopLossPercent: -10
    reentryPolicy: 'next_calendar_month_first_available_nav'
    cashAnnualRate: 0.01
    baseFundTradingCost: 'user_confirmed_free_conversion'
    costStress: { feeRate: 0.0003; slippageRate: 0.0005 }
  }
  dataAudit: {
    status: 'passed' | 'insufficient'
    sourceProfile: 'legacy_three_year_v1' | 'expanded_seven_year_v2'
    minimumTradingDays: number
    items: SeriesAudit[]
    blockers: string[]
    warnings: string[]
  }
  sourceSnapshot: {
    schemaVersion: 'portfolio.alipay_comparison.source_snapshot.v1'
    sourceHash: string
    commonDates: string[]
    series: Record<string, AlipayComparisonPriceBar[]>
  }
  strategies: ComparisonStrategy[]
  sensitivity: {
    directHistoryOnly: {
      startDate: string | null
      endDate: string | null
      tradingDays: number
      strategies: Array<{
        strategyId: string
        displayName: string
        annualizedReturnPercent: number
        monthlyMaxDrawdownPercent: number
        differenceFromPrimaryAnnualizedPercentagePoints: number
        differenceFromPrimaryMonthlyDrawdownPercentagePoints: number
      }>
      warning: string
    }
  }
  ranking: {
    byAnnualizedReturn: string[]
    byMonthlyDrawdown: string[]
    bestAnnualizedReturnStrategyId: string | null
    lowestMonthlyDrawdownStrategyId: string | null
    bestCalmarStrategyId: string | null
  }
  conclusion: {
    confidence: 'low'
    headline: string
    mainVersusComparators: Array<{
      comparatorStrategyId: string
      comparatorName: string
      annualizedReturnDifferencePercentagePoints: number
      monthlyDrawdownDifferencePercentagePoints: number
      judgment: 'dominates' | 'tradeoff' | 'lags'
      summary: string
    }>
    bullCase: string[]
    bearCase: string[]
    thesisBreakers: string[]
  }
  allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE']
  prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']
  notTradingAdvice: true
}

export type AlipayPortfolioWindowComparison = {
  schemaVersion: 'portfolio.alipay_comparison.window.v1'
  generatedAt: string
  sourceRunHash: string
  requestedPeriod: { startDate: string; endDate: string }
  effectivePeriod: { startDate: string; endDate: string; tradingDays: number }
  sampleQuality: 'standard' | 'short'
  warnings: string[]
  continuousPath: { label: string; strategies: ComparisonStrategy[] }
  restartAtWindowStart: { label: string; strategies: ComparisonStrategy[] }
  allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE']
  prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']
  notTradingAdvice: true
}

const FUND_NAMES: Record<string, string> = {
  '002611': '博时黄金ETF联接C',
  '007467': '华泰柏瑞中证红利低波动ETF联接C',
  '009725': '东方红优质甄选一年持有期混合A',
  '013597': '招商中证全指证券公司指数C',
  '013785': '东方红优质甄选一年持有期混合C',
  '014086': '兴全恒悦180天持有期债券A',
  '021634': '招商中证香港科技ETF联接(QDII)C',
  '022430': '华夏中证A500ETF联接A',
}

const ETF_NAMES: Record<string, string> = {
  '510300': '沪深300ETF',
  '510500': '中证500ETF',
  '511010': '五年国债ETF',
  '511260': '十年国债ETF',
  '512890': '红利低波ETF',
  '512880': '证券ETF',
  '513050': '中概互联网ETF',
  '513180': '恒生科技ETF',
  '513770': '港股互联网ETF',
  '159750': '港股科技50ETF招商',
  '159920': '恒生ETF',
  '518880': '黄金ETF',
  '159985': '豆粕ETF',
}

const FUND_SYMBOLS = Object.keys(FUND_NAMES)
const ETF_SYMBOLS = Object.keys(ETF_NAMES)
const CLASSIC_STRATEGY_SYMBOLS = ['510300', '510500', '511010', '511260', '512890', '518880', '159985']
const CASH_ANNUAL_RATE = 0.01
const DEFAULT_DRIFT_THRESHOLD = 3
const MINIMUM_TRADING_DAYS = 700
const MINIMUM_WINDOW_TRADING_DAYS = 20

type ProxyAuditPolicy = Pick<SeriesAudit, 'proxySymbols' | 'proxyMethod' | 'proxyRationale' | 'proxyRisk'>

const NO_PROXY_POLICY: ProxyAuditPolicy = {
  proxySymbols: [],
  proxyMethod: null,
  proxyRationale: null,
  proxyRisk: 'none',
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function shiftYears(date: string, years: number) {
  const value = new Date(`${date}T00:00:00.000Z`)
  value.setUTCFullYear(value.getUTCFullYear() + years)
  return isoDate(value)
}

function dayDiff(left: string, right: string) {
  return Math.max(0, Math.round((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000))
}

function commonDates(series: Map<string, PriceBar>[]) {
  if (series.length === 0) return []
  let dates = Array.from(series[0].keys())
  for (const item of series.slice(1)) dates = dates.filter((date) => item.has(date))
  return dates.sort()
}

function monthEndCurve(curve: CurvePoint[]) {
  const months = new Map<string, CurvePoint>()
  for (const point of curve) months.set(point.date.slice(0, 7), point)
  return Array.from(months.values()).sort((left, right) => left.date.localeCompare(right.date))
}

function calculateMetrics(curve: CurvePoint[], trades: Trade[], initialCapital: number): ComparisonMetrics {
  if (curve.length < 2 || initialCapital <= 0) {
    return {
      totalReturnPercent: 0, annualizedReturnPercent: 0, maxDrawdownPercent: 0,
      monthlyMaxDrawdownPercent: 0, worstMonthlyReturnPercent: null, monthlyWinRatePercent: null,
      volatilityPercent: 0, sharpe: null, calmar: null, endingValue: initialCapital,
      totalCostCny: 0, tradeCount: trades.length,
      grossTurnoverCny: 0, rebalanceTurnoverCny: 0, rebalanceTurnoverPercentOfInitialCapital: 0,
    }
  }
  const endingValue = curve.at(-1)!.portfolioValue
  const elapsedDays = Math.max(1, dayDiff(curve[0].date, curve.at(-1)!.date))
  const totalReturn = endingValue / initialCapital - 1
  const annualizedReturn = (1 + totalReturn) ** (365 / elapsedDays) - 1
  const dailyReturns = curve.slice(1).map((point, index) => point.portfolioValue / curve[index].portfolioValue - 1)
  const dailyMean = dailyReturns.reduce((sum, item) => sum + item, 0) / Math.max(1, dailyReturns.length)
  const dailyVariance = dailyReturns.length > 1
    ? dailyReturns.reduce((sum, item) => sum + (item - dailyMean) ** 2, 0) / (dailyReturns.length - 1)
    : 0
  const volatility = Math.sqrt(dailyVariance) * Math.sqrt(252)
  const dailyRiskFree = (1 + CASH_ANNUAL_RATE) ** (1 / 252) - 1
  const sharpe = volatility > 0 ? ((dailyMean - dailyRiskFree) * 252) / volatility : null
  const maxDrawdown = Math.min(...curve.map((point) => point.drawdownPercent)) / 100
  const monthly = monthEndCurve(curve)
  let monthlyPeak = monthly[0]?.portfolioValue || initialCapital
  let monthlyMaxDrawdown = 0
  const monthlyReturns: number[] = []
  for (let index = 0; index < monthly.length; index += 1) {
    monthlyPeak = Math.max(monthlyPeak, monthly[index].portfolioValue)
    monthlyMaxDrawdown = Math.min(monthlyMaxDrawdown, monthly[index].portfolioValue / monthlyPeak - 1)
    if (index > 0) monthlyReturns.push(monthly[index].portfolioValue / monthly[index - 1].portfolioValue - 1)
  }
  const grossTurnoverCny = trades.reduce((sum, item) => sum + item.grossAmount, 0)
  const rebalanceTurnoverCny = trades
    .filter((item) => item.reason === 'drift_rebalance')
    .reduce((sum, item) => sum + item.grossAmount, 0)
  return {
    totalReturnPercent: round(totalReturn * 100),
    annualizedReturnPercent: round(annualizedReturn * 100),
    maxDrawdownPercent: round(maxDrawdown * 100),
    monthlyMaxDrawdownPercent: round(monthlyMaxDrawdown * 100),
    worstMonthlyReturnPercent: monthlyReturns.length > 0 ? round(Math.min(...monthlyReturns) * 100) : null,
    monthlyWinRatePercent: monthlyReturns.length > 0 ? round((monthlyReturns.filter((item) => item > 0).length / monthlyReturns.length) * 100) : null,
    volatilityPercent: round(volatility * 100),
    sharpe: sharpe === null ? null : round(sharpe),
    calmar: maxDrawdown < 0 ? round(annualizedReturn / Math.abs(maxDrawdown)) : null,
    endingValue: round(endingValue, 2),
    totalCostCny: round(trades.reduce((sum, item) => sum + item.cost, 0), 2),
    grossTurnoverCny: round(grossTurnoverCny, 2),
    rebalanceTurnoverCny: round(rebalanceTurnoverCny, 2),
    rebalanceTurnoverPercentOfInitialCapital: round(rebalanceTurnoverCny / initialCapital * 100),
    tradeCount: trades.length,
  }
}

function bucketFromLabels(tags: string, labels: string, type: string) {
  const raw = `${tags} ${labels}`
  if (raw.includes('资产桶:现金') || raw.includes('支付宝·现金') || type === 'cash') return 'cash'
  if (raw.includes('资产桶:黄金') || raw.includes('支付宝·黄金')) return 'gold'
  if (raw.includes('资产桶:债券') || raw.includes('支付宝·债券')) return 'bond'
  if (raw.includes('资产桶:权益') || raw.includes('支付宝·权益')) return 'equity'
  return null
}

function toEtfSeries(rows: StockHistoryData[], symbol: string) {
  return new Map(rows
    .filter((row) => row.date && row.close > 0)
    .map((row) => [row.date, {
      date: row.date,
      open: row.open > 0 ? row.open : row.close,
      close: row.close,
      source: row.source || 'tencent_qfq',
      proxy: false,
      directSymbol: symbol,
    } satisfies PriceBar]))
}

function buildWeightedReturnProxy(input: {
  proxyId: string
  components: Array<{ symbol: string; weightPercent: number; series?: Map<string, PriceBar>; cashAnnualRate?: number }>
}) {
  const sourceLabel = input.components.map((item) => `${item.symbol}@${item.weightPercent}`).join('+')
  const marketComponents = input.components.filter((item) => item.series)
  const dates = commonDates(marketComponents.map((item) => item.series!))
  const output = new Map<string, PriceBar>()
  let previousDate: string | null = null
  let previousClose = 1
  for (const date of dates) {
    if (!previousDate) {
      output.set(date, {
        date,
        open: previousClose,
        close: previousClose,
        source: `research_proxy_blend:${input.proxyId}:${sourceLabel}`,
        proxy: true,
        directSymbol: input.proxyId,
      })
      previousDate = date
      continue
    }
    let openFactor = 0
    let closeFactor = 0
    for (const component of input.components) {
      if (component.series) {
        const previousBar = component.series.get(previousDate)
        const currentBar = component.series.get(date)
        if (!previousBar || !currentBar) continue
        openFactor += component.weightPercent / 100 * (currentBar.open / previousBar.close)
        closeFactor += component.weightPercent / 100 * (currentBar.close / previousBar.close)
      } else {
        const cashFactor = (1 + (component.cashAnnualRate ?? CASH_ANNUAL_RATE)) ** (dayDiff(previousDate, date) / 365)
        openFactor += component.weightPercent / 100 * cashFactor
        closeFactor += component.weightPercent / 100 * cashFactor
      }
    }
    const open = previousClose * openFactor
    const close = previousClose * closeFactor
    output.set(date, {
      date,
      open,
      close,
      source: `research_proxy_blend:${input.proxyId}:${sourceLabel}`,
      proxy: true,
      directSymbol: input.proxyId,
    })
    previousClose = close
    previousDate = date
  }
  return output
}

function stitchBeforeInception(direct: Map<string, PriceBar>, proxy: Map<string, PriceBar>, _symbol: string, proxySymbol: string) {
  const directDates = Array.from(direct.keys()).sort()
  const firstDirectDate = directDates[0]
  if (!firstDirectDate) return direct
  const proxyAnchorDate = Array.from(proxy.keys()).filter((date) => date <= firstDirectDate).sort().at(-1)
  if (!proxyAnchorDate) return direct
  const directPrice = direct.get(firstDirectDate)!.close
  const proxyPrice = proxy.get(proxyAnchorDate)!.close
  const scale = directPrice / proxyPrice
  const stitched = new Map<string, PriceBar>()
  for (const [date, bar] of proxy.entries()) {
    if (date >= firstDirectDate) continue
    stitched.set(date, {
      date,
      open: bar.open * scale,
      close: bar.close * scale,
      source: `proxy:${proxySymbol}:${bar.source}`,
      proxy: true,
      directSymbol: bar.directSymbol || proxySymbol,
    })
  }
  for (const [date, bar] of direct.entries()) stitched.set(date, bar)
  return stitched
}

function tradePrice(bar: PriceBar, execution: Component['execution'], side: Trade['side'], slippageRate: number) {
  const raw = execution === 'etf_open' ? bar.open : bar.close
  return raw * (side === 'BUY' ? 1 + slippageRate : 1 - slippageRate)
}

function buildCurvePoint(date: string, value: number, initialCapital: number, peak: number): CurvePoint {
  return {
    date,
    portfolioValue: round(value, 2),
    netValue: round(value / initialCapital, 6),
    cumulativeReturnPercent: round((value / initialCapital - 1) * 100),
    drawdownPercent: peak > 0 ? round((value / peak - 1) * 100) : 0,
  }
}

function runWeightedStrategy(input: {
  strategyId: string
  displayName: string
  group: ComparisonStrategy['group']
  components: Component[]
  dates: string[]
  seriesBySymbol: Map<string, Map<string, PriceBar>>
  initialCapital: number
  policy: 'buy_hold' | 'bucket_drift' | 'component_drift'
  feeRate: number
  slippageRate: number
  minCommissionCny: number
  lotSize: number
  driftThresholdPercentagePoints: number
  minimumTradingDays?: number
}): ComparisonStrategy {
  const holdings = new Map<string, number>()
  const trades: Trade[] = []
  let cash = input.initialCapital
  let previousDate = input.dates[0]
  let pendingDecision: { date: string } | null = null
  let peak = input.initialCapital
  const curve: CurvePoint[] = []
  const nonCash = input.components.filter((item) => item.bucket !== 'cash')
  const targetByBucket = new Map<string, number>()
  for (const component of input.components) targetByBucket.set(component.bucket, (targetByBucket.get(component.bucket) || 0) + component.targetWeightPercent)

  const valueAt = (date: string, field: 'close' | 'execution' = 'close') => cash + nonCash.reduce((sum, component) => {
    const bar = input.seriesBySymbol.get(component.symbol)?.get(date)
    if (!bar) return sum
    const price = field === 'execution' ? (component.execution === 'etf_open' ? bar.open : bar.close) : bar.close
    return sum + (holdings.get(component.symbol) || 0) * price
  }, 0)

  const executeRebalance = (decisionDate: string, executionDate: string, reason: Trade['reason']) => {
    const total = valueAt(executionDate, 'execution')
    for (const component of nonCash) {
      const bar = input.seriesBySymbol.get(component.symbol)!.get(executionDate)!
      const rawPrice = component.execution === 'etf_open' ? bar.open : bar.close
      const currentQuantity = holdings.get(component.symbol) || 0
      const targetValue = total * component.targetWeightPercent / 100
      const currentValue = currentQuantity * rawPrice
      if (currentValue <= targetValue + 0.01) continue
      const desiredQuantity = (currentValue - targetValue) / rawPrice
      const quantity = input.lotSize > 1 ? Math.floor(desiredQuantity / input.lotSize) * input.lotSize : desiredQuantity
      if (quantity <= 0) continue
      const price = tradePrice(bar, component.execution, 'SELL', input.slippageRate)
      const gross = quantity * price
      const commission = Math.max(input.minCommissionCny, gross * input.feeRate)
      holdings.set(component.symbol, currentQuantity - quantity)
      cash += gross - commission
      trades.push({
        decisionDate, executionDate, reason, symbol: component.symbol, name: component.name, side: 'SELL',
        quantity: round(quantity, 6), price: round(price, 6), grossAmount: round(gross, 2), cost: round(commission + quantity * Math.abs(price - rawPrice), 2), cashAfter: round(cash, 2),
      })
    }
    for (const component of nonCash) {
      const bar = input.seriesBySymbol.get(component.symbol)!.get(executionDate)!
      const rawPrice = component.execution === 'etf_open' ? bar.open : bar.close
      const currentQuantity = holdings.get(component.symbol) || 0
      const targetValue = total * component.targetWeightPercent / 100
      const currentValue = currentQuantity * rawPrice
      if (currentValue >= targetValue - 0.01) continue
      const price = tradePrice(bar, component.execution, 'BUY', input.slippageRate)
      const desiredQuantity = (targetValue - currentValue) / price
      let quantity = input.lotSize > 1 ? Math.floor(desiredQuantity / input.lotSize) * input.lotSize : desiredQuantity
      while (quantity > 0) {
        const gross = quantity * price
        const commission = Math.max(input.minCommissionCny, gross * input.feeRate)
        if (gross + commission <= cash + 0.0001) break
        quantity = input.lotSize > 1 ? quantity - input.lotSize : Math.max(0, (cash - input.minCommissionCny) / Math.max(price * (1 + input.feeRate), 0.000001))
        if (input.lotSize === 1) break
      }
      if (quantity <= 0) continue
      const gross = quantity * price
      const commission = Math.max(input.minCommissionCny, gross * input.feeRate)
      holdings.set(component.symbol, currentQuantity + quantity)
      cash -= gross + commission
      trades.push({
        decisionDate, executionDate, reason, symbol: component.symbol, name: component.name, side: 'BUY',
        quantity: round(quantity, 6), price: round(price, 6), grossAmount: round(gross, 2), cost: round(commission + quantity * Math.abs(price - rawPrice), 2), cashAfter: round(cash, 2),
      })
    }
  }

  let driftCount = 0
  for (let index = 0; index < input.dates.length; index += 1) {
    const date = input.dates[index]
    if (index > 0 && cash > 0) cash *= (1 + CASH_ANNUAL_RATE) ** (dayDiff(previousDate, date) / 365)
    if (index === 0) executeRebalance(date, date, 'initial_allocation')
    else if (pendingDecision) {
      executeRebalance(pendingDecision.date, date, 'drift_rebalance')
      pendingDecision = null
    }
    const value = valueAt(date)
    peak = Math.max(peak, value)
    curve.push(buildCurvePoint(date, value, input.initialCapital, peak))
    previousDate = date
    if (index >= input.dates.length - 1 || input.policy === 'buy_hold' || pendingDecision) continue

    const actualByBucket = new Map<string, number>()
    for (const component of nonCash) {
      const marketValue = (holdings.get(component.symbol) || 0) * input.seriesBySymbol.get(component.symbol)!.get(date)!.close
      actualByBucket.set(component.bucket, (actualByBucket.get(component.bucket) || 0) + marketValue / value * 100)
    }
    actualByBucket.set('cash', cash / value * 100)
    const driftTriggered = input.policy === 'bucket_drift'
      ? Array.from(targetByBucket.entries()).some(([bucket, target]) => Math.abs((actualByBucket.get(bucket) || 0) - target) > input.driftThresholdPercentagePoints)
      : nonCash.some((component) => {
        const actual = ((holdings.get(component.symbol) || 0) * input.seriesBySymbol.get(component.symbol)!.get(date)!.close / value) * 100
        return Math.abs(actual - component.targetWeightPercent) > input.driftThresholdPercentagePoints
      })
    if (driftTriggered) {
      pendingDecision = { date }
      driftCount += 1
    }
  }

  const proxyCoveragePercent = round(input.components.reduce((sum, component) => {
    if (component.bucket === 'cash') return sum
    const series = input.seriesBySymbol.get(component.symbol)
    const proxyDays = input.dates.filter((date) => series?.get(date)?.proxy).length
    return sum + component.targetWeightPercent * (proxyDays / Math.max(1, input.dates.length))
  }, 0))
  const metrics = calculateMetrics(curve, trades, input.initialCapital)
  return {
    strategyId: input.strategyId,
    displayName: input.displayName,
    group: input.group,
    status: input.dates.length >= (input.minimumTradingDays ?? MINIMUM_TRADING_DAYS) ? 'completed' : 'insufficient',
    policyLabel: input.policy === 'buy_hold' ? '当前权重买入并持有' : `绝对偏离严格大于${input.driftThresholdPercentagePoints}个百分点后恢复目标`,
    components: input.components,
    metrics,
    costStressMetrics: null,
    curve,
    monthlyCurve: monthEndCurve(curve),
    trades,
    triggerCounts: { drift: driftCount, gridBuy: 0, gridSell: 0, takeProfit: 0, stopLoss: 0, reentry: 0 },
    proxyCoveragePercent,
    warnings: [
      ...(proxyCoveragePercent > 0 ? ['部分区间使用成立前代理序列，详见数据审计。'] : []),
      ...(input.group === 'classic' ? ['ETF使用腾讯前复权日线；费率0.03%、滑点0.05%、最低佣金5元、100份整数手。'] : ['基金累计净值已包含分红，基础场景采用用户确认的免费转换口径。']),
    ],
  }
}

function runSingleGridStrategy(input: {
  strategyId: string
  displayName: string
  symbol: string
  dates: string[]
  series: Map<string, PriceBar>
  initialCapital: number
  feeRate: number
  slippageRate: number
  minimumTradingDays?: number
}): ComparisonStrategy {
  const component: Component = { symbol: input.symbol, name: FUND_NAMES[input.symbol], targetWeightPercent: 85, bucket: input.symbol === '002611' ? 'gold' : 'equity', execution: 'fund_nav' }
  const cashComponent: Component = { symbol: 'CNY_FIXED_1PCT', name: '现金模型（年化1%）', targetWeightPercent: 15, bucket: 'cash', execution: 'fund_nav' }
  const trades: Trade[] = []
  const curve: CurvePoint[] = []
  let cash = input.initialCapital
  let quantity = 0
  let invested = false
  let waitingUntilMonth: string | null = null
  let cycleEntryPrice = 0
  let lastGridPrice = 0
  let pending: { decisionDate: string; reason: Trade['reason']; side: Trade['side'] } | null = null
  let peak = input.initialCapital
  let previousDate = input.dates[0]
  const counts = { drift: 0, gridBuy: 0, gridSell: 0, takeProfit: 0, stopLoss: 0, reentry: 0 }

  const execute = (date: string, reason: Trade['reason'], side: Trade['side']) => {
    const bar = input.series.get(date)!
    const rawPrice = bar.close
    const price = rawPrice * (side === 'BUY' ? 1 + input.slippageRate : 1 - input.slippageRate)
    let tradedQuantity = 0
    if (reason === 'initial_allocation' || reason === 'monthly_reentry') {
      const total = cash + quantity * rawPrice
      const targetValue = total * 0.85
      const currentValue = quantity * rawPrice
      if (currentValue < targetValue) tradedQuantity = Math.min(cash / Math.max(price * (1 + input.feeRate), 0.000001), (targetValue - currentValue) / price)
    } else if (reason === 'grid_buy') {
      tradedQuantity = Math.min(cash / Math.max(price * (1 + input.feeRate), 0.000001), input.initialCapital * 0.03 / price)
    } else if (reason === 'grid_sell') {
      tradedQuantity = Math.min(quantity, input.initialCapital * 0.03 / price)
    } else {
      tradedQuantity = quantity
    }
    if (tradedQuantity <= 0) return
    const gross = tradedQuantity * price
    const fee = gross * input.feeRate
    if (side === 'BUY') {
      cash -= gross + fee
      quantity += tradedQuantity
      invested = true
      if (reason === 'initial_allocation' || reason === 'monthly_reentry') {
        cycleEntryPrice = price
        lastGridPrice = price
      } else {
        lastGridPrice = price
      }
    } else {
      cash += gross - fee
      quantity -= tradedQuantity
      if (reason === 'grid_sell') lastGridPrice = price
      if (reason === 'take_profit' || reason === 'stop_loss') {
        quantity = 0
        invested = false
        const exit = new Date(`${date}T00:00:00.000Z`)
        exit.setUTCMonth(exit.getUTCMonth() + 1, 1)
        waitingUntilMonth = exit.toISOString().slice(0, 7)
      }
    }
    trades.push({
      decisionDate: pending?.decisionDate || date,
      executionDate: date,
      reason,
      symbol: input.symbol,
      name: FUND_NAMES[input.symbol],
      side,
      quantity: round(tradedQuantity, 6),
      price: round(price, 6),
      grossAmount: round(gross, 2),
      cost: round(fee + tradedQuantity * Math.abs(price - rawPrice), 2),
      cashAfter: round(cash, 2),
    })
  }

  for (let index = 0; index < input.dates.length; index += 1) {
    const date = input.dates[index]
    const reentryMonth = waitingUntilMonth as string | null
    if (index > 0 && cash > 0) cash *= (1 + CASH_ANNUAL_RATE) ** (dayDiff(previousDate, date) / 365)
    if (index === 0) execute(date, 'initial_allocation', 'BUY')
    else if (pending) {
      execute(date, pending.reason, pending.side)
      pending = null
    } else if (!invested && reentryMonth !== null && date.slice(0, 7) >= reentryMonth) {
      execute(date, 'monthly_reentry', 'BUY')
      counts.reentry += 1
      waitingUntilMonth = null
    }

    const value = cash + quantity * input.series.get(date)!.close
    peak = Math.max(peak, value)
    curve.push(buildCurvePoint(date, value, input.initialCapital, peak))
    previousDate = date
    if (index >= input.dates.length - 1 || !invested || pending) continue

    const close = input.series.get(date)!.close
    const cycleReturn = cycleEntryPrice > 0 ? (close / cycleEntryPrice - 1) * 100 : 0
    const gridMove = lastGridPrice > 0 ? (close / lastGridPrice - 1) * 100 : 0
    if (cycleReturn >= 10) {
      pending = { decisionDate: date, reason: 'take_profit', side: 'SELL' }
      counts.takeProfit += 1
    } else if (cycleReturn <= -10) {
      pending = { decisionDate: date, reason: 'stop_loss', side: 'SELL' }
      counts.stopLoss += 1
    } else if (gridMove >= 3 && quantity > 0) {
      pending = { decisionDate: date, reason: 'grid_sell', side: 'SELL' }
      counts.gridSell += 1
    } else if (gridMove <= -3 && cash > 0.01) {
      pending = { decisionDate: date, reason: 'grid_buy', side: 'BUY' }
      counts.gridBuy += 1
    }
  }

  const proxyDays = input.dates.filter((date) => input.series.get(date)?.proxy).length
  const proxyCoveragePercent = round(85 * proxyDays / Math.max(1, input.dates.length))
  return {
    strategyId: input.strategyId,
    displayName: input.displayName,
    group: 'single',
    status: input.dates.length >= (input.minimumTradingDays ?? MINIMUM_TRADING_DAYS) ? 'completed' : 'insufficient',
    policyLabel: '85%单品+15%现金；3%价格网格；±10%清仓；次月首日再入场',
    components: [component, cashComponent],
    metrics: calculateMetrics(curve, trades, input.initialCapital),
    costStressMetrics: null,
    curve,
    monthlyCurve: monthEndCurve(curve),
    trades,
    triggerCounts: counts,
    proxyCoveragePercent,
    warnings: [
      '每个净值日最多执行一档，止盈止损优先于网格。',
      ...(proxyCoveragePercent > 0 ? ['成立前区间使用代理序列，敏感度需单独判断。'] : []),
      '基础场景按用户确认的免费转换口径计算。',
    ],
  }
}

function addCostStress(base: ComparisonStrategy, stress: ComparisonStrategy) {
  return {
    ...base,
    costStressMetrics: stress.metrics,
    costStressCurve: stress.curve,
    costStressTrades: stress.trades,
  }
}

function makeConclusion(strategies: ComparisonStrategy[], requestedYears: number, driftThresholdPercentagePoints: number) {
  const main = strategies.find((item) => item.group === 'target')!
  const comparatorIds = ['current_alipay_buy_hold', 'single_007467_grid', 'single_002611_grid', 'single_022430_grid']
  const comparisons = comparatorIds.map((strategyId) => {
    const other = strategies.find((item) => item.strategyId === strategyId)!
    const annualizedDiff = round(main.metrics.annualizedReturnPercent - other.metrics.annualizedReturnPercent)
    const drawdownDiff = round(main.metrics.monthlyMaxDrawdownPercent - other.metrics.monthlyMaxDrawdownPercent)
    const returnBetter = annualizedDiff > 0
    const riskBetter = drawdownDiff > 0
    const judgment = returnBetter && riskBetter ? 'dominates' as const : !returnBetter && !riskBetter ? 'lags' as const : 'tradeoff' as const
    const summary = judgment === 'dominates'
      ? `主组合年化高${Math.abs(annualizedDiff).toFixed(2)}个百分点，月末最大回撤改善${Math.abs(drawdownDiff).toFixed(2)}个百分点。`
      : judgment === 'lags'
        ? `主组合年化低${Math.abs(annualizedDiff).toFixed(2)}个百分点，月末最大回撤也差${Math.abs(drawdownDiff).toFixed(2)}个百分点。`
        : `存在收益与回撤交换：年化差${annualizedDiff.toFixed(2)}个百分点，月末最大回撤差${drawdownDiff.toFixed(2)}个百分点。`
    return {
      comparatorStrategyId: strategyId,
      comparatorName: other.displayName,
      annualizedReturnDifferencePercentagePoints: annualizedDiff,
      monthlyDrawdownDifferencePercentagePoints: drawdownDiff,
      judgment,
      summary,
    }
  })
  const dominated = comparisons.filter((item) => item.judgment === 'dominates').length
  const lagged = comparisons.filter((item) => item.judgment === 'lags').length
  const headline = dominated === comparisons.length
    ? `主组合在本次近${requestedYears}年样本中同时改善收益与月度回撤。`
    : lagged === comparisons.length
      ? `主组合在本次近${requestedYears}年样本中没有体现出相对优势。`
      : `主组合对${dominated}个对照形成收益/回撤双优，对${lagged}个对照双弱，其余为收益与风险交换。`
  return {
    confidence: 'low' as const,
    headline,
    mainVersusComparators: comparisons,
    bullCase: ['多资产之间的低相关性可能降低单一资产回撤。', `${driftThresholdPercentagePoints}个百分点偏离再平衡可在明显漂移后恢复风险预算。`],
    bearCase: ['债券桶包含混合型产品，不能等同纯利率债。', '成立较晚的基金使用分层代理，长周期结果含结构偏差。', `近${requestedYears}年仍不是所有宏观情景的完整覆盖。`],
    thesisBreakers: [`仅真实历史敏感度结果与近${requestedYears}年主结果方向相反。`, '成本压力场景令主组合风险收益排序发生反转。', '后续滚动窗口中主组合连续两个年度同时落后当前持仓与三类单品。'],
  }
}

function serializeSourceSnapshot(
  snapshotPositions: AlipayPortfolioComparisonStudy['snapshot']['positions'],
  dates: string[],
  seriesBySymbol: Map<string, Map<string, PriceBar>>,
): AlipayPortfolioComparisonStudy['sourceSnapshot'] {
  const series = Object.fromEntries(Array.from(seriesBySymbol.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([symbol, values]) => [symbol, dates.flatMap((date) => {
      const bar = values.get(date)
      return bar ? [bar] : []
    })]))
  const sourceHash = createHash('sha256')
    .update(JSON.stringify({ positions: snapshotPositions, dates, series }))
    .digest('hex')
  return {
    schemaVersion: 'portfolio.alipay_comparison.source_snapshot.v1',
    sourceHash,
    commonDates: dates,
    series,
  }
}

function sourceMaps(snapshot: AlipayPortfolioComparisonStudy['sourceSnapshot']) {
  return new Map(Object.entries(snapshot.series).map(([symbol, bars]) => [
    symbol,
    new Map(bars.map((bar) => [bar.date, bar])),
  ]))
}

function triggerCounts(trades: Trade[]) {
  return {
    drift: trades.filter((item) => item.reason === 'drift_rebalance').length,
    gridBuy: trades.filter((item) => item.reason === 'grid_buy').length,
    gridSell: trades.filter((item) => item.reason === 'grid_sell').length,
    takeProfit: trades.filter((item) => item.reason === 'take_profit').length,
    stopLoss: trades.filter((item) => item.reason === 'stop_loss').length,
    reentry: trades.filter((item) => item.reason === 'monthly_reentry').length,
  }
}

function rebaseCurve(points: CurvePoint[]) {
  if (points.length === 0) return []
  const initial = points[0].portfolioValue
  let peak = initial
  return points.map((point) => {
    peak = Math.max(peak, point.portfolioValue)
    return buildCurvePoint(point.date, point.portfolioValue, initial, peak)
  })
}

function sliceContinuousStrategy(strategy: ComparisonStrategy, startDate: string, endDate: string): ComparisonStrategy {
  const curve = rebaseCurve(strategy.curve.filter((point) => point.date >= startDate && point.date <= endDate))
  const trades = strategy.trades.filter((trade) => trade.executionDate >= startDate && trade.executionDate <= endDate)
  const initialCapital = curve[0]?.portfolioValue || 0
  return {
    ...strategy,
    status: curve.length >= MINIMUM_WINDOW_TRADING_DAYS ? 'completed' : 'insufficient',
    policyLabel: `${strategy.policyLabel}；连续路径切片（继承窗口前状态）`,
    metrics: calculateMetrics(curve, trades, initialCapital),
    costStressMetrics: null,
    curve,
    monthlyCurve: monthEndCurve(curve),
    trades,
    triggerCounts: triggerCounts(trades),
    warnings: [...strategy.warnings, '连续路径切片继承窗口开始前的仓位、网格和再入场状态。'],
  }
}

export class AlipayPortfolioComparisonService {
  async run(
    userId = 'default',
    options: AlipayPortfolioComparisonRunOptions = {},
  ): Promise<AlipayPortfolioComparisonStudy> {
    const requestedYears = options.requestedYears ?? 3
    if (!Number.isInteger(requestedYears) || requestedYears < 1 || requestedYears > 10) {
      throw new Error(`requested_years_invalid:${requestedYears}`)
    }
    const dataSourceProfile = options.dataSourceProfile || (requestedYears > 3
      ? 'expanded_seven_year_v2'
      : 'legacy_three_year_v1')
    // QDII and mainland funds do not share every exchange trading day.  Seven
    // calendar years therefore use a 1,500-common-observation gate plus an
    // exact calendar-span check in the acceptance runner.
    const minimumTradingDays = options.minimumTradingDays ?? (requestedYears >= 7 ? 1500 : MINIMUM_TRADING_DAYS)
    if (!Number.isInteger(minimumTradingDays) || minimumTradingDays < 20) {
      throw new Error(`minimum_trading_days_invalid:${minimumTradingDays}`)
    }
    const driftThresholdPercentagePoints = options.driftThresholdPercentagePoints ?? DEFAULT_DRIFT_THRESHOLD
    if (!Number.isFinite(driftThresholdPercentagePoints) || driftThresholdPercentagePoints <= 0 || driftThresholdPercentagePoints > 20) {
      throw new Error(`drift_threshold_invalid:${driftThresholdPercentagePoints}`)
    }
    const requestedMarketDays = Math.min(3000, Math.max(900, Math.ceil(requestedYears * 270) + 30))
    const targetBucketWeights: AlipayTargetBucketWeights = options.targetBucketWeights || {
      cash: 10,
      gold: 25,
      bond: 40,
      equity: 25,
    }
    const targetWeightTotal = Object.values(targetBucketWeights).reduce((sum, value) => sum + value, 0)
    if (Object.values(targetBucketWeights).some((value) => !Number.isFinite(value) || value < 0) || Math.abs(targetWeightTotal - 100) > 0.000001) {
      throw new Error(`target_bucket_weights_invalid:${targetWeightTotal}`)
    }
    const targetWeightLabel = [
      targetBucketWeights.cash,
      targetBucketWeights.gold,
      targetBucketWeights.bond,
      targetBucketWeights.equity,
    ].map((value) => Number.isInteger(value) ? String(value) : String(round(value, 3))).join('/')
    const isDefaultTarget = targetWeightLabel === '10/25/40/25'
    const driftThresholdId = String(round(driftThresholdPercentagePoints, 3)).replace('.', '_')
    const targetStrategyId = options.targetStrategyId || (isDefaultTarget && driftThresholdPercentagePoints === DEFAULT_DRIFT_THRESHOLD
      ? 'approved_10_25_40_25_drift3'
      : `research_${targetWeightLabel.replaceAll('/', '_')}_drift${driftThresholdId}`)
    const targetDisplayName = options.targetDisplayName || `目标${targetWeightLabel}组合`
    const capturedAt = new Date().toISOString()
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
      orderBy: { createdAt: 'asc' },
    })
    const alipay = positions.filter((position) => `${position.tags} ${position.labels}`.includes('支付宝'))
    const snapshotPositions = alipay.map((position) => ({
      symbol: position.asset.symbol,
      name: position.asset.name,
      marketValue: round(Math.max(0, position.marketValue ?? (position.quantity * (position.currentPrice || position.asset.lastPrice || 0))), 2),
      bucket: bucketFromLabels(position.tags, position.labels, position.asset.type),
    }))
    const initialCapital = round(snapshotPositions.reduce((sum, item) => sum + item.marketValue, 0), 2)

    const assets = await prisma.asset.findMany({ where: { symbol: { in: FUND_SYMBOLS } }, select: { id: true, symbol: true } })
    const assetBySymbol = new Map(assets.map((asset) => [asset.symbol, asset.id]))
    const directFundSeries = new Map<string, Map<string, PriceBar>>()
    for (const symbol of FUND_SYMBOLS) {
      const assetId = assetBySymbol.get(symbol)
      const rows = assetId ? await prisma.priceHistory.findMany({
        where: { assetId, isValid: true, closePrice: { gt: 0 } },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, closePrice: true, source: true },
      }) : []
      directFundSeries.set(symbol, new Map(rows.map((row) => {
        const date = isoDate(row.timestamp)
        return [date, { date, open: row.closePrice, close: row.closePrice, source: row.source || 'price_history', proxy: false, directSymbol: symbol }]
      })))
    }

    const etfRows = await Promise.all(ETF_SYMBOLS.map(async (symbol) => [symbol, await getTencentQfqStockHistory(symbol, requestedMarketDays)] as const))
    const etfSeries = new Map(etfRows.map(([symbol, rows]) => [symbol, toEtfSeries(rows, symbol)]))
    const seriesBySymbol = new Map<string, Map<string, PriceBar>>()
    for (const [symbol, series] of directFundSeries) seriesBySymbol.set(symbol, series)
    for (const [symbol, series] of etfSeries) seriesBySymbol.set(symbol, series)
    const proxyPolicies = new Map<string, ProxyAuditPolicy>()
    if (dataSourceProfile === 'expanded_seven_year_v2') {
      const defensiveHybridProxy = buildWeightedReturnProxy({
        proxyId: 'BENCH_009725_90B_8CSI300_2HSI',
        components: [
          { symbol: '511010', weightPercent: 90, series: etfSeries.get('511010')! },
          { symbol: '510300', weightPercent: 8, series: etfSeries.get('510300')! },
          { symbol: '159920', weightPercent: 2, series: etfSeries.get('159920')! },
        ],
      })
      const extendedAClass = stitchBeforeInception(
        directFundSeries.get('009725')!, defensiveHybridProxy, '009725', 'BENCH_009725_90B_8CSI300_2HSI',
      )
      const longBondProxy = buildWeightedReturnProxy({
        proxyId: 'BENCH_014086_95B_5CASH',
        components: [
          { symbol: '511010', weightPercent: 95, series: etfSeries.get('511010')! },
          { symbol: 'CNY_FIXED_1PCT', weightPercent: 5, cashAnnualRate: CASH_ANNUAL_RATE },
        ],
      })
      const a500BroadMarketProxy = buildWeightedReturnProxy({
        proxyId: 'PROXY_A500_70CSI300_30CSI500',
        components: [
          { symbol: '510300', weightPercent: 70, series: etfSeries.get('510300')! },
          { symbol: '510500', weightPercent: 30, series: etfSeries.get('510500')! },
        ],
      })
      const extendedHangSengTech = stitchBeforeInception(
        etfSeries.get('513180')!, etfSeries.get('513050')!, '513180', '513050',
      )
      const extendedHongKongTech = stitchBeforeInception(
        etfSeries.get('159750')!, extendedHangSengTech, '159750', '513180_CHAIN',
      )
      const m0Rows = await getSinaDomesticFuturesHistory('M0', requestedMarketDays)
      const m0Series = toEtfSeries(m0Rows, 'M0')
      seriesBySymbol.set('M0', m0Series)
      seriesBySymbol.set('BENCH_009725_90B_8CSI300_2HSI', defensiveHybridProxy)
      seriesBySymbol.set('BENCH_014086_95B_5CASH', longBondProxy)
      seriesBySymbol.set('PROXY_A500_70CSI300_30CSI500', a500BroadMarketProxy)
      seriesBySymbol.set('009725', extendedAClass)
      seriesBySymbol.set('013785', stitchBeforeInception(directFundSeries.get('013785')!, extendedAClass, '013785', '009725_CHAIN'))
      seriesBySymbol.set('013597', stitchBeforeInception(directFundSeries.get('013597')!, etfSeries.get('512880')!, '013597', '512880'))
      seriesBySymbol.set('014086', stitchBeforeInception(directFundSeries.get('014086')!, longBondProxy, '014086', 'BENCH_014086_95B_5CASH'))
      seriesBySymbol.set('021634', stitchBeforeInception(directFundSeries.get('021634')!, extendedHongKongTech, '021634', '159750_CHAIN'))
      seriesBySymbol.set('022430', stitchBeforeInception(directFundSeries.get('022430')!, a500BroadMarketProxy, '022430', 'PROXY_A500_70CSI300_30CSI500'))
      seriesBySymbol.set('159985', stitchBeforeInception(etfSeries.get('159985')!, m0Series, '159985', 'M0'))
      proxyPolicies.set('009725', {
        proxySymbols: ['511010', '510300', '159920'],
        proxyMethod: '成立前按基金业绩比较基准90%债券/8%沪深300/2%恒生近似构造日收益并在首个净值日缩放衔接',
        proxyRationale: '对应基金合同披露的90%中债综合、8%沪深300、2%恒生基准；免费源用五年国债ETF近似中债综合财富指数',
        proxyRisk: 'high',
      })
      proxyPolicies.set('013785', {
        proxySymbols: ['009725', '511010', '510300', '159920'],
        proxyMethod: 'C类成立前先接同一基金A类，A类成立前再接90/8/2基准近似',
        proxyRationale: 'A/C份额共享投资组合，主要差异是销售服务费；更早区间只能使用基准近似',
        proxyRisk: 'medium',
      })
      proxyPolicies.set('013597', {
        proxySymbols: ['512880'],
        proxyMethod: '成立前接中证全指证券公司指数ETF并在首个净值日缩放衔接',
        proxyRationale: '基金与代理ETF均跟踪中证全指证券公司指数',
        proxyRisk: 'low',
      })
      proxyPolicies.set('014086', {
        proxySymbols: ['511010', 'CNY_FIXED_1PCT'],
        proxyMethod: '成立前按95%五年国债ETF/5%现金构造日收益并在首个净值日缩放衔接',
        proxyRationale: '近似基金95%中债综合财富/5%一年期存款基准；无法完整复现信用债、久期和主动管理',
        proxyRisk: 'high',
      })
      proxyPolicies.set('021634', {
        proxySymbols: ['159750', '513180', '513050'],
        proxyMethod: '基金成立前依次使用目标ETF、恒生科技ETF、中概互联网ETF分层回溯并逐层缩放衔接',
        proxyRationale: '优先同一中证香港科技目标ETF；更早区间按相邻港股科技风险暴露补足',
        proxyRisk: 'high',
      })
      proxyPolicies.set('022430', {
        proxySymbols: ['510300', '510500'],
        proxyMethod: '成立前按70%沪深300ETF/30%中证500ETF构造宽基日收益并在首个净值日缩放衔接',
        proxyRationale: '中证A500发布前不存在同标的可交易历史，只能用大中盘宽基近似',
        proxyRisk: 'high',
      })
      proxyPolicies.set('159985', {
        proxySymbols: ['M0'],
        proxyMethod: 'ETF上市前接新浪豆粕连续合约日线并在首个ETF交易日缩放衔接',
        proxyRationale: '补足2019年9月至ETF上市之间的商品风险暴露；连续合约存在换月和基差风险',
        proxyRisk: 'medium',
      })
    } else {
      seriesBySymbol.set('021634', stitchBeforeInception(directFundSeries.get('021634')!, etfSeries.get('513770')!, '021634', '513770'))
      seriesBySymbol.set('022430', stitchBeforeInception(directFundSeries.get('022430')!, etfSeries.get('510300')!, '022430', '510300'))
      proxyPolicies.set('021634', {
        proxySymbols: ['513770'],
        proxyMethod: '成立前使用港股互联网ETF并在首个真实净值日衔接',
        proxyRationale: '旧版三年研究口径',
        proxyRisk: 'high',
      })
      proxyPolicies.set('022430', {
        proxySymbols: ['510300'],
        proxyMethod: '成立前使用沪深300ETF并在首个真实净值日衔接',
        proxyRationale: '旧版三年研究口径',
        proxyRisk: 'high',
      })
    }

    const requiredSymbols = Array.from(new Set([...FUND_SYMBOLS, ...CLASSIC_STRATEGY_SYMBOLS]))
    const allDates = commonDates(requiredSymbols.map((symbol) => seriesBySymbol.get(symbol) || new Map()))
    const latestDate = allDates.at(-1) || null
    const requestedStart = latestDate ? shiftYears(latestDate, -requestedYears) : null
    const dates = requestedStart ? allDates.filter((date) => date >= requestedStart) : []
    const sourceSnapshot = serializeSourceSnapshot(snapshotPositions, dates, seriesBySymbol)

    const dataItems: SeriesAudit[] = requiredSymbols.map((symbol) => {
      const series = seriesBySymbol.get(symbol) || new Map()
      const visible = dates.map((date) => series.get(date)).filter((item): item is PriceBar => Boolean(item))
      const warnings: string[] = []
      const proxyPolicy = proxyPolicies.get(symbol) || NO_PROXY_POLICY
      if (visible.some((item) => item.proxy) && proxyPolicy.proxyMethod) warnings.push(proxyPolicy.proxyMethod)
      if (visible.length < minimumTradingDays) warnings.push(`共同样本不足${minimumTradingDays}日`)
      return {
        symbol,
        name: FUND_NAMES[symbol] || ETF_NAMES[symbol] || symbol,
        firstDate: visible[0]?.date || null,
        lastDate: visible.at(-1)?.date || null,
        bars: visible.length,
        directBars: visible.filter((item) => !item.proxy).length,
        proxyBars: visible.filter((item) => item.proxy).length,
        proxySymbol: proxyPolicy.proxySymbols[0] || null,
        ...proxyPolicy,
        sources: Array.from(new Set(visible.map((item) => item.source))),
        status: visible.length >= minimumTradingDays ? 'passed' : 'insufficient',
        warnings,
      }
    })
    const blockers = [
      ...(initialCapital > 0 ? [] : ['alipay_snapshot_market_value_missing']),
      ...(alipay.length === 9 ? [] : [`alipay_position_count_unexpected:${alipay.length}/9`]),
      ...(dates.length >= minimumTradingDays ? [] : [`common_trading_days_insufficient:${dates.length}/${minimumTradingDays}`]),
      ...dataItems.filter((item) => item.status !== 'passed').map((item) => `series_insufficient:${item.symbol}:${item.bars}`),
    ]

    const positionBySymbol = new Map(snapshotPositions.map((item) => [item.symbol, item]))
    const bondSymbols = ['009725', '013785', '014086']
    const bondTotal = bondSymbols.reduce((sum, symbol) => sum + (positionBySymbol.get(symbol)?.marketValue || 0), 0)
    const targetComponents: Component[] = [
      { symbol: 'ALIPAY-YUEBAO', name: '余额宝现金模型', targetWeightPercent: targetBucketWeights.cash, bucket: 'cash', execution: 'fund_nav' },
      { symbol: '002611', name: FUND_NAMES['002611'], targetWeightPercent: targetBucketWeights.gold, bucket: 'gold', execution: 'fund_nav' },
      ...bondSymbols.map((symbol): Component => ({
        symbol, name: FUND_NAMES[symbol], targetWeightPercent: round(targetBucketWeights.bond * (positionBySymbol.get(symbol)?.marketValue || 0) / Math.max(1, bondTotal), 6), bucket: 'bond', execution: 'fund_nav',
      })),
      { symbol: '007467', name: FUND_NAMES['007467'], targetWeightPercent: targetBucketWeights.equity / 2, bucket: 'equity', execution: 'fund_nav' },
      { symbol: '022430', name: FUND_NAMES['022430'], targetWeightPercent: targetBucketWeights.equity / 2, bucket: 'equity', execution: 'fund_nav' },
    ]
    const bondWeightSum = targetComponents.filter((item) => item.bucket === 'bond').reduce((sum, item) => sum + item.targetWeightPercent, 0)
    if (Math.abs(bondWeightSum - targetBucketWeights.bond) > 0.000001) {
      const largestBond = targetComponents.filter((item) => item.bucket === 'bond').sort((left, right) => right.targetWeightPercent - left.targetWeightPercent)[0]
      largestBond.targetWeightPercent = round(largestBond.targetWeightPercent + (targetBucketWeights.bond - bondWeightSum), 6)
    }
    const currentComponents: Component[] = snapshotPositions.map((position): Component => ({
      symbol: position.symbol,
      name: position.name,
      targetWeightPercent: round(position.marketValue / Math.max(1, initialCapital) * 100, 6),
      bucket: (position.bucket || 'equity') as Component['bucket'],
      execution: 'fund_nav',
    }))

    const classicDefinitions: Array<{ id: string; name: string; components: Component[] }> = [
      { id: 'all_weather', name: '全天候组合', components: [
        ['510300', 30, 'stock'], ['511260', 40, 'bond'], ['511010', 15, 'bond'], ['518880', 7.5, 'gold'], ['159985', 7.5, 'commodity'],
      ].map(([symbol, weight, bucket]) => ({ symbol: String(symbol), name: ETF_NAMES[String(symbol)], targetWeightPercent: Number(weight), bucket: bucket as Component['bucket'], execution: 'etf_open' })) },
      { id: 'permanent_portfolio', name: '永久组合', components: [
        { symbol: '510300', name: ETF_NAMES['510300'], targetWeightPercent: 25, bucket: 'stock', execution: 'etf_open' },
        { symbol: '511260', name: ETF_NAMES['511260'], targetWeightPercent: 25, bucket: 'bond', execution: 'etf_open' },
        { symbol: '518880', name: ETF_NAMES['518880'], targetWeightPercent: 25, bucket: 'gold', execution: 'etf_open' },
        { symbol: 'CNY_FIXED_1PCT', name: '现金模型（年化1%）', targetWeightPercent: 25, bucket: 'cash', execution: 'fund_nav' },
      ] },
      { id: 'china_60_40', name: '中国版60/40', components: [
        ['510300', 60, 'stock'], ['511260', 20, 'bond'], ['511010', 20, 'bond'],
      ].map(([symbol, weight, bucket]) => ({ symbol: String(symbol), name: ETF_NAMES[String(symbol)], targetWeightPercent: Number(weight), bucket: bucket as Component['bucket'], execution: 'etf_open' })) },
      { id: 'china_golden_butterfly', name: '中国版黄金蝴蝶', components: [
        ['510300', 20, 'stock'], ['510500', 20, 'stock'], ['511260', 20, 'bond'], ['511010', 20, 'bond'], ['518880', 20, 'gold'],
      ].map(([symbol, weight, bucket]) => ({ symbol: String(symbol), name: ETF_NAMES[String(symbol)], targetWeightPercent: Number(weight), bucket: bucket as Component['bucket'], execution: 'etf_open' })) },
      { id: 'dividend_low_vol_60_40', name: '红利低波60/40', components: [
        ['512890', 60, 'stock'], ['511260', 20, 'bond'], ['511010', 20, 'bond'],
      ].map(([symbol, weight, bucket]) => ({ symbol: String(symbol), name: ETF_NAMES[String(symbol)], targetWeightPercent: Number(weight), bucket: bucket as Component['bucket'], execution: 'etf_open' })) },
    ]

    const fundWeightedInput = (strategyId: string, displayName: string, group: ComparisonStrategy['group'], components: Component[], policy: 'buy_hold' | 'bucket_drift') => ({
      strategyId, displayName, group, components, dates, seriesBySymbol, initialCapital, policy,
      feeRate: 0, slippageRate: 0, minCommissionCny: 0, lotSize: 1, driftThresholdPercentagePoints, minimumTradingDays,
    } as const)
    const stressWeightedInput = (strategyId: string, displayName: string, group: ComparisonStrategy['group'], components: Component[], policy: 'buy_hold' | 'bucket_drift') => ({
      strategyId, displayName, group, components, dates, seriesBySymbol, initialCapital, policy,
      feeRate: 0.0003, slippageRate: 0.0005, minCommissionCny: 0, lotSize: 1, driftThresholdPercentagePoints, minimumTradingDays,
    } as const)

    const main = addCostStress(
      runWeightedStrategy(fundWeightedInput(targetStrategyId, targetDisplayName, 'target', targetComponents, 'bucket_drift')),
      runWeightedStrategy(stressWeightedInput(targetStrategyId, targetDisplayName, 'target', targetComponents, 'bucket_drift')),
    )
    const current = addCostStress(
      runWeightedStrategy(fundWeightedInput('current_alipay_buy_hold', '当前支付宝持仓买入并持有', 'baseline', currentComponents, 'buy_hold')),
      runWeightedStrategy(stressWeightedInput('current_alipay_buy_hold', '当前支付宝持仓买入并持有', 'baseline', currentComponents, 'buy_hold')),
    )
    const singles = ['007467', '002611', '022430'].map((symbol) => {
      const id = `single_${symbol}_grid`
      const name = `${symbol} ${FUND_NAMES[symbol]}单品网格`
      return addCostStress(
        runSingleGridStrategy({ strategyId: id, displayName: name, symbol, dates, series: seriesBySymbol.get(symbol)!, initialCapital, feeRate: 0, slippageRate: 0, minimumTradingDays }),
        runSingleGridStrategy({ strategyId: id, displayName: name, symbol, dates, series: seriesBySymbol.get(symbol)!, initialCapital, feeRate: 0.0003, slippageRate: 0.0005, minimumTradingDays }),
      )
    })
    const classics = classicDefinitions.map((definition) => runWeightedStrategy({
      strategyId: definition.id,
      displayName: definition.name,
      group: 'classic',
      components: definition.components,
      dates,
      seriesBySymbol,
      initialCapital,
      policy: 'component_drift',
      feeRate: 0.0003,
      slippageRate: 0.0005,
      minCommissionCny: 5,
      lotSize: 100,
      driftThresholdPercentagePoints,
      minimumTradingDays,
    }))
    const strategies = [main, current, ...singles, ...classics]
    const directSeriesBySymbol = new Map(seriesBySymbol)
    for (const symbol of FUND_SYMBOLS) directSeriesBySymbol.set(symbol, directFundSeries.get(symbol) || new Map())
    const directDates = commonDates(FUND_SYMBOLS.map((symbol) => directSeriesBySymbol.get(symbol) || new Map()))
      .filter((date) => !latestDate || date <= latestDate)
    const directMain = runWeightedStrategy({ ...fundWeightedInput(targetStrategyId, targetDisplayName, 'target', targetComponents, 'bucket_drift'), dates: directDates, seriesBySymbol: directSeriesBySymbol })
    const directCurrent = runWeightedStrategy({ ...fundWeightedInput('current_alipay_buy_hold', '当前支付宝持仓买入并持有', 'baseline', currentComponents, 'buy_hold'), dates: directDates, seriesBySymbol: directSeriesBySymbol })
    const directSingles = ['007467', '002611', '022430'].map((symbol) => runSingleGridStrategy({
      strategyId: `single_${symbol}_grid`,
      displayName: `${symbol} ${FUND_NAMES[symbol]}单品网格`,
      symbol,
      dates: directDates,
      series: directSeriesBySymbol.get(symbol)!,
      initialCapital,
      feeRate: 0,
      slippageRate: 0,
    }))
    const directSensitivityStrategies = [directMain, directCurrent, ...directSingles].map((item) => {
      const primary = strategies.find((strategy) => strategy.strategyId === item.strategyId)!
      return {
        strategyId: item.strategyId,
        displayName: item.displayName,
        annualizedReturnPercent: item.metrics.annualizedReturnPercent,
        monthlyMaxDrawdownPercent: item.metrics.monthlyMaxDrawdownPercent,
        differenceFromPrimaryAnnualizedPercentagePoints: round(item.metrics.annualizedReturnPercent - primary.metrics.annualizedReturnPercent),
        differenceFromPrimaryMonthlyDrawdownPercentagePoints: round(item.metrics.monthlyMaxDrawdownPercent - primary.metrics.monthlyMaxDrawdownPercent),
      }
    })
    const completed = strategies.filter((item) => item.status === 'completed')
    const byAnnualizedReturn = [...completed].sort((left, right) => right.metrics.annualizedReturnPercent - left.metrics.annualizedReturnPercent).map((item) => item.strategyId)
    const byMonthlyDrawdown = [...completed].sort((left, right) => right.metrics.monthlyMaxDrawdownPercent - left.metrics.monthlyMaxDrawdownPercent).map((item) => item.strategyId)
    const byCalmar = [...completed].sort((left, right) => (right.metrics.calmar ?? -999) - (left.metrics.calmar ?? -999))

    return {
      schemaVersion: 'portfolio.alipay_comparison.v1',
      generatedAt: capturedAt,
      status: blockers.length === 0 && completed.length === strategies.length ? 'completed' : 'insufficient',
      userId,
      accountId: 'alipay',
      period: { requestedYears, startDate: dates[0] || null, endDate: dates.at(-1) || null, tradingDays: dates.length },
      snapshot: { capturedAt, initialCapital, positionCount: alipay.length, positions: snapshotPositions },
      frozenRules: {
        targetBucketWeights,
        driftThresholdPercentagePoints,
        driftComparison: 'strictly_greater_than',
        singleAssetInitialWeightPercent: 85,
        singleAssetCashWeightPercent: 15,
        gridMovePercent: 3,
        gridNotionalPercentOfInitialCapital: 3,
        takeProfitPercent: 10,
        stopLossPercent: -10,
        reentryPolicy: 'next_calendar_month_first_available_nav',
        cashAnnualRate: 0.01,
        baseFundTradingCost: 'user_confirmed_free_conversion',
        costStress: { feeRate: 0.0003, slippageRate: 0.0005 },
      },
      dataAudit: {
        status: blockers.length === 0 ? 'passed' : 'insufficient',
        sourceProfile: dataSourceProfile,
        minimumTradingDays,
        items: dataItems,
        blockers,
        warnings: [
          '基金累计净值来自项目本地Eastmoney历史缓存，属于研究级免费数据。',
          'ETF及代理序列来自腾讯前复权日线，属于研究级免费数据。',
          ...(dataSourceProfile === 'expanded_seven_year_v2'
            ? [
              '豆粕ETF上市前使用新浪豆粕连续合约日线；连续合约存在换月与基差风险。',
              '成立较晚基金的分层代理仅用于长期敏感度研究，不代表该基金当时可交易。',
            ]
            : ['021634和022430成立前代理仅用于敏感度研究，不代表真实可交易历史。']),
        ],
      },
      sourceSnapshot,
      strategies,
      sensitivity: {
        directHistoryOnly: {
          startDate: directDates[0] || null,
          endDate: directDates.at(-1) || null,
          tradingDays: directDates.length,
          strategies: directSensitivityStrategies,
          warning: `该敏感度只使用所有当前基金共同拥有的真实净值区间，不使用成立前代理；区间不足${requestedYears}年，只用于检查代理是否改变结论方向。`,
        },
      },
      ranking: {
        byAnnualizedReturn,
        byMonthlyDrawdown,
        bestAnnualizedReturnStrategyId: byAnnualizedReturn[0] || null,
        lowestMonthlyDrawdownStrategyId: byMonthlyDrawdown[0] || null,
        bestCalmarStrategyId: byCalmar[0]?.strategyId || null,
      },
      conclusion: makeConclusion(strategies, requestedYears, driftThresholdPercentagePoints),
      allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE'],
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      notTradingAdvice: true,
    }
  }

  runWindow(
    study: AlipayPortfolioComparisonStudy,
    requestedStartDate: string,
    requestedEndDate: string,
    options: { targetDriftThresholdPercentagePoints?: number } = {},
  ): AlipayPortfolioWindowComparison {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(requestedStartDate) || !/^\d{4}-\d{2}-\d{2}$/.test(requestedEndDate)) {
      throw new Error('window_date_format_invalid')
    }
    if (requestedStartDate > requestedEndDate) throw new Error('window_date_order_invalid')
    const dates = study.sourceSnapshot.commonDates.filter((date) => date >= requestedStartDate && date <= requestedEndDate)
    if (dates.length < MINIMUM_WINDOW_TRADING_DAYS) throw new Error(`window_trading_days_insufficient:${dates.length}/${MINIMUM_WINDOW_TRADING_DAYS}`)
    const startDate = dates[0]
    const endDate = dates.at(-1)!
    const targetDriftThresholdPercentagePoints = options.targetDriftThresholdPercentagePoints
      ?? study.frozenRules.driftThresholdPercentagePoints
    if (!Number.isFinite(targetDriftThresholdPercentagePoints) || targetDriftThresholdPercentagePoints <= 0 || targetDriftThresholdPercentagePoints > 20) {
      throw new Error(`drift_threshold_invalid:${targetDriftThresholdPercentagePoints}`)
    }
    const seriesBySymbol = sourceMaps(study.sourceSnapshot)
    const initialCapital = study.snapshot.initialCapital
    const continuous = study.strategies.map((strategy) => sliceContinuousStrategy(strategy, startDate, endDate))
    const restarted = study.strategies.map((strategy) => {
      if (strategy.group === 'single') {
        const symbol = strategy.components.find((item) => item.bucket !== 'cash')!.symbol
        const base = runSingleGridStrategy({
          strategyId: strategy.strategyId,
          displayName: strategy.displayName,
          symbol,
          dates,
          series: seriesBySymbol.get(symbol)!,
          initialCapital,
          feeRate: 0,
          slippageRate: 0,
          minimumTradingDays: MINIMUM_WINDOW_TRADING_DAYS,
        })
        const stress = runSingleGridStrategy({
          strategyId: strategy.strategyId,
          displayName: strategy.displayName,
          symbol,
          dates,
          series: seriesBySymbol.get(symbol)!,
          initialCapital,
          feeRate: 0.0003,
          slippageRate: 0.0005,
          minimumTradingDays: MINIMUM_WINDOW_TRADING_DAYS,
        })
        return {
          ...addCostStress(base, stress),
          policyLabel: `${base.policyLabel}；窗口首日重新建仓`,
          warnings: [...base.warnings, '窗口重启口径不继承所选开始日前的策略状态。'],
        }
      }
      const policy = strategy.group === 'baseline'
        ? 'buy_hold' as const
        : strategy.group === 'target'
          ? 'bucket_drift' as const
          : 'component_drift' as const
      const isClassic = strategy.group === 'classic'
      const driftThresholdPercentagePoints = strategy.group === 'target'
        ? targetDriftThresholdPercentagePoints
        : study.frozenRules.driftThresholdPercentagePoints
      const base = runWeightedStrategy({
        strategyId: strategy.strategyId,
        displayName: strategy.displayName,
        group: strategy.group,
        components: strategy.components,
        dates,
        seriesBySymbol,
        initialCapital,
        policy,
        feeRate: isClassic ? 0.0003 : 0,
        slippageRate: isClassic ? 0.0005 : 0,
        minCommissionCny: isClassic ? 5 : 0,
        lotSize: isClassic ? 100 : 1,
        driftThresholdPercentagePoints,
        minimumTradingDays: MINIMUM_WINDOW_TRADING_DAYS,
      })
      if (isClassic) return { ...base, policyLabel: `${base.policyLabel}；窗口首日重新建仓`, warnings: [...base.warnings, '窗口重启口径不继承所选开始日前的策略状态。'] }
      const stress = runWeightedStrategy({
        strategyId: strategy.strategyId,
        displayName: strategy.displayName,
        group: strategy.group,
        components: strategy.components,
        dates,
        seriesBySymbol,
        initialCapital,
        policy,
        feeRate: 0.0003,
        slippageRate: 0.0005,
        minCommissionCny: 0,
        lotSize: 1,
        driftThresholdPercentagePoints,
        minimumTradingDays: MINIMUM_WINDOW_TRADING_DAYS,
      })
      return {
        ...addCostStress(base, stress),
        policyLabel: `${base.policyLabel}；窗口首日重新建仓`,
        warnings: [...base.warnings, '窗口重启口径不继承所选开始日前的策略状态。'],
      }
    })
    return {
      schemaVersion: 'portfolio.alipay_comparison.window.v1',
      generatedAt: new Date().toISOString(),
      sourceRunHash: study.sourceSnapshot.sourceHash,
      requestedPeriod: { startDate: requestedStartDate, endDate: requestedEndDate },
      effectivePeriod: { startDate, endDate, tradingDays: dates.length },
      sampleQuality: dates.length >= 252 ? 'standard' : 'short',
      warnings: [
        ...(dates.length < 252 ? ['所选窗口不足252个交易日，年化指标对起止日期敏感。'] : []),
        '连续路径切片回答该段历史经历；窗口重启回答从该日起重新执行规则的结果。',
        '历史回测不构成未来收益承诺。',
      ],
      continuousPath: { label: '连续路径切片', strategies: continuous },
      restartAtWindowStart: { label: '窗口首日重新建仓', strategies: restarted },
      allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE'],
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      notTradingAdvice: true,
    }
  }
}

export const alipayPortfolioComparisonService = new AlipayPortfolioComparisonService()

export const alipayPortfolioComparisonTesting = {
  runWeightedStrategy,
}
