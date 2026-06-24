export type PortfolioBacktestAllowedAction = 'RESEARCH' | 'OBSERVE' | 'COMPARE' | 'PLAN_DRAFT'
export type PortfolioBacktestProhibitedAction = 'ADD' | 'REDUCE' | 'ORDER_CREATE' | 'AUTO_TRADE'

export type PortfolioStrategySource = 'preset' | 'current_holdings' | 'dividend_low_vol' | 'custom'
export type PortfolioAssetClass = 'stock' | 'bond' | 'gold' | 'commodity' | 'cash' | 'fund' | 'etf'
export type PortfolioRebalanceFrequency = 'none' | 'monthly' | 'quarterly' | 'annually'
export type PortfolioDividendPolicy = 'cash' | 'reinvest'

export interface PortfolioStrategyComponent {
  assetClass: PortfolioAssetClass
  symbol?: string
  name?: string
  targetWeightPercent: number
  proxySymbol?: string
  proxyReason?: string
  evidenceRefs: string[]
}

export interface PortfolioStrategyDefinition {
  strategyId: string
  strategyVersion: string
  displayName: string
  source: PortfolioStrategySource
  components: PortfolioStrategyComponent[]
  rebalancePolicy: {
    frequency: PortfolioRebalanceFrequency
    thresholdPercent?: number
  }
  dividendPolicy: PortfolioDividendPolicy
  costModel: {
    feeRate: number
    slippageRate: number
    taxRate?: number
  }
  benchmarkPolicy: {
    benchmarkIds: string[]
    proxyAllowed: boolean
  }
  snapshot?: {
    capturedAt: string
    totalMarketValue?: number
    source: string
  }
  validation: {
    status: 'valid' | 'insufficient' | 'invalid'
    blockedReasons: string[]
    warnings: string[]
  }
  evidenceRefs: string[]
}

export interface PortfolioBacktestRequest {
  userId: string
  portfolioStrategyIds: string[]
  startDate: string
  endDate: string
  initialCapital: number
  rebalanceFrequency: PortfolioRebalanceFrequency
  dividendMode: PortfolioDividendPolicy
  feeRate: number
  slippageRate: number
  benchmarkIds: string[]
  customStrategies?: Array<{
    strategyId?: string
    displayName?: string
    components: Array<{
      assetClass: PortfolioAssetClass
      symbol?: string
      name?: string
      targetWeightPercent: number
    }>
  }>
}

export interface PortfolioBacktestInputBuildResult {
  schemaVersion: 'portfolio.strategy_backtest.input.v1'
  generatedAt: string
  request: PortfolioBacktestRequest
  strategies: PortfolioStrategyDefinition[]
  allowedActions: PortfolioBacktestAllowedAction[]
  prohibitedActions: PortfolioBacktestProhibitedAction[]
  notTradingAdvice: true
  dataQuality: {
    status: 'ready' | 'partial' | 'insufficient'
    strategyCount: number
    validStrategyCount: number
    blockedReasons: string[]
    warnings: string[]
  }
}

export interface PortfolioBacktestCurvePoint {
  date: string
  netValue: number
  cumulativeReturnPercent: number
  dailyReturnPercent?: number
  drawdownPercent: number
  benchmark?: Record<string, {
    netValue: number
    cumulativeReturnPercent: number
  }>
}

export interface PortfolioBacktestStrategyResult {
  definition: PortfolioStrategyDefinition
  status: 'completed' | 'partial' | 'insufficient' | 'failed'
  equityCurve: PortfolioBacktestCurvePoint[]
  drawdownCurve: Array<{ date: string; drawdownPercent: number }>
  metrics: {
    totalReturnPercent: number | null
    annualizedReturnPercent: number | null
    maxDrawdownPercent: number | null
    volatilityPercent: number | null
    sharpe: number | null
    calmar: number | null
    monthlyWinRate: number | null
    turnoverRate: number | null
    dividendContributionPercent: number | null
    capitalGainContributionPercent: number | null
    benchmarkReturnPercent: number | null
    excessReturnPercent: number | null
  }
  dataCoverage: {
    priceCoveragePercent: number
    dividendCoveragePercent?: number
    benchmarkCoveragePercent?: number
    missingSymbols: string[]
  }
  blockedReasons: string[]
  warnings: string[]
  evidenceRefs: string[]
}

export interface PortfolioBacktestResult {
  schemaVersion: 'portfolio.strategy_backtest.result.v1'
  generatedAt: string
  userId: string
  request: PortfolioBacktestRequest
  strategies: PortfolioBacktestStrategyResult[]
  allowedActions: PortfolioBacktestAllowedAction[]
  prohibitedActions: PortfolioBacktestProhibitedAction[]
  notTradingAdvice: true
}

export const PORTFOLIO_BACKTEST_ALLOWED_ACTIONS: PortfolioBacktestAllowedAction[] = [
  'RESEARCH',
  'OBSERVE',
  'COMPARE',
  'PLAN_DRAFT',
]

export const PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS: PortfolioBacktestProhibitedAction[] = [
  'ADD',
  'REDUCE',
  'ORDER_CREATE',
  'AUTO_TRADE',
]
