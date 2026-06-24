import type {
  PortfolioDividendPolicy,
  PortfolioRebalanceFrequency,
  PortfolioStrategyComponent,
  PortfolioStrategyDefinition,
} from './portfolioBacktestTypes.js'

type RegistryOptions = {
  rebalanceFrequency?: PortfolioRebalanceFrequency
  dividendPolicy?: PortfolioDividendPolicy
  feeRate?: number
  slippageRate?: number
  benchmarkIds?: string[]
}

const DEFAULT_OPTIONS: Required<RegistryOptions> = {
  rebalanceFrequency: 'quarterly',
  dividendPolicy: 'reinvest',
  feeRate: 0.0003,
  slippageRate: 0.0005,
  benchmarkIds: ['cash_cny'],
}

function baseDefinition(
  params: {
    strategyId: string
    displayName: string
    components: PortfolioStrategyComponent[]
    evidenceRefs: string[]
  },
  options: RegistryOptions = {},
): PortfolioStrategyDefinition {
  const resolved = { ...DEFAULT_OPTIONS, ...options }
  const blockedReasons: string[] = []
  const warnings: string[] = []
  const weightSum = params.components.reduce((sum, item) => sum + item.targetWeightPercent, 0)
  if (Math.abs(weightSum - 100) > 0.01) {
    blockedReasons.push(`weight_sum_not_100:${Number(weightSum.toFixed(4))}`)
  }

  for (const component of params.components) {
    if (component.proxySymbol && !component.proxyReason) {
      blockedReasons.push(`proxy_reason_missing:${component.proxySymbol}`)
    }
    if (!component.symbol && component.assetClass !== 'cash') {
      warnings.push(`symbol_missing_for_asset_class:${component.assetClass}`)
    }
  }

  return {
    strategyId: params.strategyId,
    strategyVersion: 'portfolio.strategy.v1',
    displayName: params.displayName,
    source: 'preset',
    components: params.components,
    rebalancePolicy: {
      frequency: resolved.rebalanceFrequency,
    },
    dividendPolicy: resolved.dividendPolicy,
    costModel: {
      feeRate: resolved.feeRate,
      slippageRate: resolved.slippageRate,
    },
    benchmarkPolicy: {
      benchmarkIds: resolved.benchmarkIds,
      proxyAllowed: true,
    },
    validation: {
      status: blockedReasons.length > 0 ? 'invalid' : 'valid',
      blockedReasons,
      warnings,
    },
    evidenceRefs: params.evidenceRefs,
  }
}

export class PortfolioStrategyRegistry {
  getPresetStrategy(strategyId: string, options: RegistryOptions = {}) {
    if (strategyId === 'permanent_portfolio') return this.buildPermanentPortfolio(options)
    if (strategyId === 'all_weather') return this.buildAllWeatherPortfolio(options)
    return null
  }

  listPresetTemplates() {
    return [
      {
        strategyId: 'permanent_portfolio',
        displayName: '永久组合',
        description: '股票、债券、黄金、现金各 25% 的研究组合模板。',
      },
      {
        strategyId: 'all_weather',
        displayName: '全天候组合',
        description: '股票、长期债券、中期债券、黄金、大宗商品的研究组合模板。',
      },
      {
        strategyId: 'current_holdings_buy_and_hold',
        displayName: '当前真实持仓买入并持有',
        description: '按当前系统持仓权重生成组合定义，用于研究回测。',
      },
      {
        strategyId: 'dividend_low_vol_basket',
        displayName: '红利低波候选篮子',
        description: '基于红利低波候选池的研究篮子，缺候选时会标记 insufficient。',
      },
      {
        strategyId: 'custom_weight_portfolio',
        displayName: '自定义权重组合',
        description: '用户输入资产和目标权重，权重必须合计 100%。',
      },
      {
        strategyId: 'local_real_data_sample_60_40',
        displayName: '本地真实行情样本 60/40',
        description: '从本地 market_bar_canonical 中选择两个覆盖较好的真实标的，用于验证组合回测路径。',
      },
      {
        strategyId: 'local_real_data_equal_weight_5',
        displayName: '本地真实行情样本等权 5',
        description: '从本地 market_bar_canonical 中选择五个覆盖较好的真实标的，按等权构建研究样本。',
      },
      {
        strategyId: 'local_real_data_concentrated_3',
        displayName: '本地真实行情样本集中 3',
        description: '从本地 market_bar_canonical 中选择三个覆盖较好的真实标的，按 50/30/20 构建研究样本。',
      },
    ]
  }

  private buildPermanentPortfolio(options: RegistryOptions = {}) {
    return baseDefinition({
      strategyId: 'permanent_portfolio',
      displayName: '永久组合',
      components: [
        this.component('stock', 25, '510300', '沪深300ETF代理', 'A 股权益代理，后续可替换为正式宽基指数 total return 数据'),
        this.component('bond', 25, '511010', '国债ETF代理', '债券资产代理，后续可替换为正式债券指数 total return 数据'),
        this.component('gold', 25, '518880', '黄金ETF代理', '黄金资产代理，后续可替换为正式黄金现货或 ETF total return 数据'),
        { assetClass: 'cash', name: '现金', targetWeightPercent: 25, evidenceRefs: ['portfolio-template:permanent:cash'] },
      ],
      evidenceRefs: ['portfolio-template:permanent_portfolio:v1'],
    }, options)
  }

  private buildAllWeatherPortfolio(options: RegistryOptions = {}) {
    return baseDefinition({
      strategyId: 'all_weather',
      displayName: '全天候组合',
      components: [
        this.component('stock', 30, '510300', '沪深300ETF代理', '股票资产代理，后续可替换为正式宽基指数 total return 数据'),
        this.component('bond', 40, '511010', '长期国债ETF代理', '长期债券资产代理，后续可替换为正式长期国债指数 total return 数据'),
        this.component('bond', 15, '511260', '十年国债ETF代理', '中期债券资产代理，后续可替换为正式中期债券指数 total return 数据'),
        this.component('gold', 7.5, '518880', '黄金ETF代理', '黄金资产代理，后续可替换为正式黄金 total return 数据'),
        this.component('commodity', 7.5, '159985', '豆粕ETF代理', '商品资产代理，后续可替换为正式商品指数 total return 数据'),
      ],
      evidenceRefs: ['portfolio-template:all_weather:v1'],
    }, options)
  }

  private component(
    assetClass: PortfolioStrategyComponent['assetClass'],
    targetWeightPercent: number,
    proxySymbol: string,
    name: string,
    proxyReason: string,
  ): PortfolioStrategyComponent {
    return {
      assetClass,
      symbol: proxySymbol,
      name,
      targetWeightPercent,
      proxySymbol,
      proxyReason,
      evidenceRefs: [`portfolio-template:proxy:${proxySymbol}`],
    }
  }
}

export const portfolioStrategyRegistry = new PortfolioStrategyRegistry()
