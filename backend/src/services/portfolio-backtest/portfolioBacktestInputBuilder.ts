import { prisma } from '../../db/prisma.js'
import { portfolioProxyMarketDataService } from './portfolioProxyMarketDataService.js'
import { portfolioStrategyRegistry } from './portfolioStrategyRegistry.js'
import {
  PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
  PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
  PortfolioBacktestInputBuildResult,
  PortfolioBacktestRequest,
  PortfolioStrategyComponent,
  PortfolioStrategyDefinition,
} from './portfolioBacktestTypes.js'

const DEFAULT_REQUEST = {
  initialCapital: 100000,
  rebalanceFrequency: 'quarterly' as const,
  dividendMode: 'reinvest' as const,
  feeRate: 0.0003,
  slippageRate: 0.0005,
  benchmarkIds: ['cash_cny'],
}

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function normalizeAssetClass(type?: string | null): PortfolioStrategyComponent['assetClass'] {
  const normalized = String(type || '').toLowerCase()
  if (normalized === 'stock') return 'stock'
  if (normalized === 'bond') return 'bond'
  if (normalized === 'gold') return 'gold'
  if (normalized === 'commodity') return 'commodity'
  if (normalized === 'cash') return 'cash'
  if (normalized === 'fund') return 'fund'
  if (normalized === 'etf') return 'etf'
  return 'fund'
}

export class PortfolioBacktestInputBuilder {
  async build(request: Partial<PortfolioBacktestRequest> & { userId: string }): Promise<PortfolioBacktestInputBuildResult> {
    const resolved: PortfolioBacktestRequest = {
      userId: request.userId,
      portfolioStrategyIds: request.portfolioStrategyIds?.length
        ? request.portfolioStrategyIds
        : ['permanent_portfolio', 'all_weather', 'current_holdings_buy_and_hold'],
      startDate: request.startDate || new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      endDate: request.endDate || new Date().toISOString().slice(0, 10),
      initialCapital: request.initialCapital || DEFAULT_REQUEST.initialCapital,
      rebalanceFrequency: request.rebalanceFrequency || DEFAULT_REQUEST.rebalanceFrequency,
      dividendMode: request.dividendMode || DEFAULT_REQUEST.dividendMode,
      feeRate: request.feeRate ?? DEFAULT_REQUEST.feeRate,
      slippageRate: request.slippageRate ?? DEFAULT_REQUEST.slippageRate,
      benchmarkIds: request.benchmarkIds?.length ? request.benchmarkIds : DEFAULT_REQUEST.benchmarkIds,
      customStrategies: request.customStrategies || [],
    }

    const strategies: PortfolioStrategyDefinition[] = []
    const warnings: string[] = []
    const blockedReasons: string[] = []

    for (const strategyId of resolved.portfolioStrategyIds) {
      const preset = portfolioStrategyRegistry.getPresetStrategy(strategyId, {
        rebalanceFrequency: resolved.rebalanceFrequency,
        dividendPolicy: resolved.dividendMode,
        feeRate: resolved.feeRate,
        slippageRate: resolved.slippageRate,
        benchmarkIds: resolved.benchmarkIds,
      })
      if (preset) {
        strategies.push(await this.applyProxyMarketDataGate(preset, resolved))
        continue
      }

      if (strategyId === 'current_holdings_buy_and_hold') {
        strategies.push(await this.buildCurrentHoldingsStrategy(resolved))
        continue
      }

      if (strategyId === 'dividend_low_vol_basket') {
        strategies.push(this.buildDividendLowVolBasketStrategy(resolved))
        continue
      }

      if (strategyId === 'local_real_data_sample_60_40') {
        strategies.push(await this.buildLocalRealDataSampleStrategy(resolved, {
          strategyId,
          displayName: '本地真实行情样本 60/40',
          weights: [60, 40],
        }))
        continue
      }

      if (strategyId === 'local_real_data_equal_weight_5') {
        strategies.push(await this.buildLocalRealDataSampleStrategy(resolved, {
          strategyId,
          displayName: '本地真实行情样本等权 5',
          weights: [20, 20, 20, 20, 20],
        }))
        continue
      }

      if (strategyId === 'local_real_data_concentrated_3') {
        strategies.push(await this.buildLocalRealDataSampleStrategy(resolved, {
          strategyId,
          displayName: '本地真实行情样本集中 3',
          weights: [50, 30, 20],
        }))
        continue
      }

      if (strategyId === 'custom_weight_portfolio') {
        const customDefinitions = this.buildCustomStrategies(resolved)
        if (customDefinitions.length === 0) {
          blockedReasons.push('custom_weight_portfolio_requested_without_custom_strategies')
        }
        strategies.push(...customDefinitions)
        continue
      }

      blockedReasons.push(`unknown_strategy:${strategyId}`)
    }

    const validStrategyCount = strategies.filter((strategy) => strategy.validation.status === 'valid').length
    for (const strategy of strategies) {
      warnings.push(...strategy.validation.warnings.map((item) => `${strategy.strategyId}:${item}`))
      blockedReasons.push(...strategy.validation.blockedReasons.map((item) => `${strategy.strategyId}:${item}`))
    }

    return {
      schemaVersion: 'portfolio.strategy_backtest.input.v1',
      generatedAt: new Date().toISOString(),
      request: resolved,
      strategies,
      allowedActions: PORTFOLIO_BACKTEST_ALLOWED_ACTIONS,
      prohibitedActions: PORTFOLIO_BACKTEST_PROHIBITED_ACTIONS,
      notTradingAdvice: true,
      dataQuality: {
        status: validStrategyCount === strategies.length && strategies.length > 0
          ? 'ready'
          : validStrategyCount > 0
            ? 'partial'
            : 'insufficient',
        strategyCount: strategies.length,
        validStrategyCount,
        blockedReasons: Array.from(new Set(blockedReasons)),
        warnings: Array.from(new Set(warnings)),
      },
    }
  }

  private async applyProxyMarketDataGate(
    strategy: PortfolioStrategyDefinition,
    request: PortfolioBacktestRequest,
  ): Promise<PortfolioStrategyDefinition> {
    if (!['permanent_portfolio', 'all_weather'].includes(strategy.strategyId)) {
      return strategy
    }

    const proxySymbols = strategy.components
      .map((component) => component.proxySymbol || component.symbol)
      .filter((symbol): symbol is string => typeof symbol === 'string' && /^\d{6}$/.test(symbol))

    const coverage = await portfolioProxyMarketDataService.ensureCoverage(proxySymbols, request.startDate, request.endDate, {
      minRequiredBars: 250,
    })

    return {
      ...strategy,
      validation: {
        status: coverage.status === 'ready' && strategy.validation.status === 'valid'
          ? 'valid'
          : coverage.status === 'insufficient'
            ? 'insufficient'
            : 'insufficient',
        blockedReasons: Array.from(new Set([
          ...strategy.validation.blockedReasons,
          ...coverage.blockedReasons,
        ])),
        warnings: Array.from(new Set([
          ...strategy.validation.warnings,
          ...coverage.warnings,
          `proxy_market_data_coverage_status:${coverage.status}`,
        ])),
      },
      evidenceRefs: Array.from(new Set([
        ...strategy.evidenceRefs,
        ...coverage.items.flatMap((item) => item.evidenceRefs),
      ])),
    }
  }

  private async buildCurrentHoldingsStrategy(request: PortfolioBacktestRequest): Promise<PortfolioStrategyDefinition> {
    const positions = await prisma.position.findMany({
      where: { userId: request.userId, status: 'open' },
      include: { asset: true },
      orderBy: { createdAt: 'asc' },
    })

    const totalMarketValue = positions.reduce((sum, position) => {
      const marketValue = position.marketValue ?? ((position.currentPrice || position.asset.lastPrice || 0) * position.quantity)
      return sum + Math.max(0, marketValue)
    }, 0)

    const blockedReasons: string[] = []
    const warnings: string[] = []

    if (positions.length === 0) blockedReasons.push('current_holdings_missing')
    if (totalMarketValue <= 0) blockedReasons.push('current_holdings_market_value_missing')

    const components: PortfolioStrategyComponent[] = totalMarketValue > 0
      ? positions
        .map((position) => {
          const marketValue = position.marketValue ?? ((position.currentPrice || position.asset.lastPrice || 0) * position.quantity)
          return {
            assetClass: normalizeAssetClass(position.asset.type),
            symbol: position.asset.symbol,
            name: position.asset.name,
            targetWeightPercent: round((Math.max(0, marketValue) / totalMarketValue) * 100, 4),
            evidenceRefs: [`position:${position.id}`, `asset:${position.assetId}`],
          }
        })
        .filter((component) => component.targetWeightPercent > 0)
      : []

    const weightSum = components.reduce((sum, component) => sum + component.targetWeightPercent, 0)
    if (components.length > 0 && Math.abs(weightSum - 100) > 0.05) {
      const largest = components.reduce((best, item) => item.targetWeightPercent > best.targetWeightPercent ? item : best, components[0])
      largest.targetWeightPercent = round(largest.targetWeightPercent + (100 - weightSum), 4)
      warnings.push(`current_holdings_weight_normalized:${round(weightSum, 4)}`)
    }

    return {
      strategyId: 'current_holdings_buy_and_hold',
      strategyVersion: 'portfolio.strategy.current_holdings_buy_and_hold.v1',
      displayName: '当前真实持仓买入并持有',
      source: 'current_holdings',
      components,
      rebalancePolicy: { frequency: 'none' },
      dividendPolicy: request.dividendMode,
      costModel: {
        feeRate: request.feeRate,
        slippageRate: request.slippageRate,
      },
      benchmarkPolicy: {
        benchmarkIds: request.benchmarkIds,
        proxyAllowed: true,
      },
      snapshot: {
        capturedAt: new Date().toISOString(),
        totalMarketValue: round(totalMarketValue, 2),
        source: 'positions:open',
      },
      validation: {
        status: blockedReasons.length > 0 ? 'insufficient' : 'valid',
        blockedReasons,
        warnings,
      },
      evidenceRefs: ['portfolio-strategy:current_holdings_buy_and_hold:v1', ...components.flatMap((item) => item.evidenceRefs)],
    }
  }

  private buildDividendLowVolBasketStrategy(request: PortfolioBacktestRequest): PortfolioStrategyDefinition {
    return {
      strategyId: 'dividend_low_vol_basket',
      strategyVersion: 'portfolio.strategy.dividend_low_vol_basket.v1',
      displayName: '红利低波候选篮子',
      source: 'dividend_low_vol',
      components: [],
      rebalancePolicy: { frequency: request.rebalanceFrequency },
      dividendPolicy: request.dividendMode,
      costModel: {
        feeRate: request.feeRate,
        slippageRate: request.slippageRate,
      },
      benchmarkPolicy: {
        benchmarkIds: request.benchmarkIds,
        proxyAllowed: true,
      },
      validation: {
        status: 'insufficient',
        blockedReasons: ['dividend_low_vol_candidate_snapshot_not_loaded'],
        warnings: ['PBT-2 only builds strategy inputs; basket components require candidate snapshot wiring in PBT-3/PBT-4.'],
      },
      evidenceRefs: ['portfolio-strategy:dividend_low_vol_basket:v1'],
    }
  }

  private async buildLocalRealDataSampleStrategy(
    request: PortfolioBacktestRequest,
    options: { strategyId: string; displayName: string; weights: number[] },
  ): Promise<PortfolioStrategyDefinition> {
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
      take: options.weights.length,
    })

    const blockedReasons: string[] = []
    const warnings: string[] = ['local_real_data_sample_is_for_path_validation_not_recommendation']
    if (grouped.length < options.weights.length || grouped.some((item) => item._count._all < 30)) {
      blockedReasons.push('local_real_market_bar_sample_insufficient')
    }

    const components: PortfolioStrategyComponent[] = grouped.slice(0, options.weights.length).map((item, index) => ({
      assetClass: 'stock',
      symbol: item.symbol,
      name: `本地真实行情样本 ${item.symbol}`,
      targetWeightPercent: options.weights[index],
      evidenceRefs: [`market_bar_canonical:${item.symbol}:count:${item._count._all}`],
    }))

    return {
      strategyId: options.strategyId,
      strategyVersion: `portfolio.strategy.${options.strategyId}.v1`,
      displayName: options.displayName,
      source: 'preset',
      components,
      rebalancePolicy: { frequency: request.rebalanceFrequency },
      dividendPolicy: request.dividendMode,
      costModel: {
        feeRate: request.feeRate,
        slippageRate: request.slippageRate,
      },
      benchmarkPolicy: {
        benchmarkIds: request.benchmarkIds,
        proxyAllowed: true,
      },
      validation: {
        status: blockedReasons.length > 0 ? 'insufficient' : 'valid',
        blockedReasons,
        warnings,
      },
      evidenceRefs: [`portfolio-strategy:${options.strategyId}:v1`, ...components.flatMap((item) => item.evidenceRefs)],
    }
  }

  private buildCustomStrategies(request: PortfolioBacktestRequest): PortfolioStrategyDefinition[] {
    return (request.customStrategies || []).map((custom, index) => {
      const strategyId = custom.strategyId || `custom_weight_portfolio_${index + 1}`
      const components = custom.components.map((item) => ({
        assetClass: item.assetClass,
        symbol: item.symbol,
        name: item.name,
        targetWeightPercent: round(item.targetWeightPercent, 4),
        evidenceRefs: [`portfolio-custom:${strategyId}:${item.symbol || item.assetClass}`],
      }))
      const weightSum = components.reduce((sum, item) => sum + item.targetWeightPercent, 0)
      const blockedReasons = Math.abs(weightSum - 100) > 0.01 ? [`weight_sum_not_100:${round(weightSum, 4)}`] : []
      return {
        strategyId,
        strategyVersion: 'portfolio.strategy.custom_weight.v1',
        displayName: custom.displayName || '自定义权重组合',
        source: 'custom',
        components,
        rebalancePolicy: { frequency: request.rebalanceFrequency },
        dividendPolicy: request.dividendMode,
        costModel: {
          feeRate: request.feeRate,
          slippageRate: request.slippageRate,
        },
        benchmarkPolicy: {
          benchmarkIds: request.benchmarkIds,
          proxyAllowed: true,
        },
        validation: {
          status: blockedReasons.length > 0 ? 'invalid' : 'valid',
          blockedReasons,
          warnings: [],
        },
        evidenceRefs: [`portfolio-strategy:${strategyId}:custom_weight:v1`, ...components.flatMap((item) => item.evidenceRefs)],
      }
    })
  }
}

export const portfolioBacktestInputBuilder = new PortfolioBacktestInputBuilder()
