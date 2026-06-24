import { prisma } from '../../db/prisma.js'
import { fundamentalDataProvider, type FundamentalSnapshot } from '../technical/fundamentalDataProvider.js'
import { alternativeAssetFactsetService, type FundLikeFactSet, type GoldMacroFactSet } from './alternativeAssetFactsetService.js'

type IndustryComparisonMetrics = NonNullable<FundamentalSnapshot['industryComparison']>['metrics']
type AssetType = 'stock' | 'etf' | 'fund' | 'bond_fund' | 'bond' | 'gold' | 'cash' | string
type ValueAssessmentStatus = 'available' | 'partial' | 'insufficient' | 'not_applicable'
type ValueConclusion = 'undervalued_watch' | 'reasonable' | 'overvalued_watch' | 'risk_review' | 'insufficient' | 'not_applicable'

export interface ValueAssessmentFactSet {
  schemaVersion: 'value.assessment.factset.v1'
  generatedAt: string
  asset: {
    assetId: string
    symbol: string
    name: string
    assetType: AssetType
    market: string
  }
  market: {
    currentPrice: number
    marketValue?: number
    costBasis?: number
    unrealizedPnlPct?: number
    provider: string
    asOf: string | null
  }
  valuation: {
    status: ValueAssessmentStatus
    conclusion: ValueConclusion
    valuationScore: number | null
    qualityScore: number | null
    growthScore: number | null
    financialRiskScore: number | null
    compositeScore: number | null
    confidence: 'high' | 'medium' | 'low' | 'insufficient'
    targetWeightMultiplier: number
    valuationBand: 'cheap' | 'fair' | 'expensive' | 'unknown'
    method: string
    reasons: string[]
    risks: string[]
    blockedReasons: string[]
    warnings: string[]
  }
  facts: Array<{
    id: string
    label: string
    value: number | string | null
    source: string
    asOf: string | null
    quality: 'ok' | 'missing' | 'warning'
  }>
  evidenceRefs: string[]
  providerTrace: Record<string, unknown>
}

type PositionLike = {
  id: string
  assetId: string
  quantity?: number
  avgCost?: number
  currentPrice?: number | null
  marketValue?: number | null
  costBasis?: number | null
  unrealizedPnl?: number | null
  asset: {
    id: string
    symbol: string
    name: string
    type: AssetType
    exchange?: string | null
    lastPrice?: number | null
    lastUpdated?: Date | string | null
  }
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number | null | undefined, precision = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
}

class ValueAssessmentService {
  readonly schemaVersion = 'value.assessment.factset.v1'

  async getPortfolioValueAssessments(userId = 'default') {
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    })

    const results = await Promise.all(positions.map((position) => this.assessPosition(position)))
    return {
      schemaVersion: 'value.assessment.batch.v1',
      generatedAt: new Date().toISOString(),
      userId,
      results,
    }
  }

  async getPositionValueAssessment(positionId: string) {
    const position = await prisma.position.findUnique({
      where: { id: positionId },
      include: { asset: true },
    })
    if (!position) throw new Error('Position not found')
    return this.assessPosition(position)
  }

  async assessPosition(position: PositionLike): Promise<ValueAssessmentFactSet> {
    const assetType = (position.asset.type || '').toLowerCase()
    if (assetType === 'cash') return this.buildCashAssessment(position)
    if (assetType === 'stock') return this.buildStockAssessment(position)
    if (['etf', 'fund', 'bond_fund', 'bond'].includes(assetType)) return this.buildFundLikeAssessment(position)
    if (assetType === 'gold') return this.buildGoldAssessment(position)
    return this.buildUnsupportedAssessment(position)
  }

  private async buildStockAssessment(position: PositionLike): Promise<ValueAssessmentFactSet> {
    const symbol = normalizeSymbol(position.asset.symbol)
    const now = new Date().toISOString()
    const cached = await this.readCachedStockAnalysis(symbol)
    const fundamentalSnapshot = cached?.analysis?.fundamentalSnapshot as FundamentalSnapshot | undefined
    const quoteSnapshot = await fundamentalDataProvider.getEastmoneyQuoteListSnapshot(symbol).catch(() => undefined)

    let metrics = {
      peDynamic: finite(fundamentalSnapshot?.metrics?.peDynamic) ?? finite(quoteSnapshot?.peDynamic),
      pb: finite(fundamentalSnapshot?.metrics?.pb) ?? finite(quoteSnapshot?.pb),
      totalMarketCap: finite(fundamentalSnapshot?.metrics?.totalMarketCap) ?? finite(quoteSnapshot?.totalMarketCap),
      floatMarketCap: finite(fundamentalSnapshot?.metrics?.floatMarketCap) ?? finite(quoteSnapshot?.floatMarketCap),
      latestPrice: finite(fundamentalSnapshot?.metrics?.latestPrice) ?? finite(position.currentPrice) ?? finite(position.asset.lastPrice),
    }
    const latestReport = fundamentalSnapshot?.financialReports?.[0]
    const derivedMetrics = this.deriveStockValuationMetrics(metrics, latestReport)
    metrics = {
      ...metrics,
      peDynamic: metrics.peDynamic ?? derivedMetrics.peDynamic,
      pb: metrics.pb ?? derivedMetrics.pb,
    }
    const industryComparison = fundamentalSnapshot?.industryComparison
    const warnings = [
      ...(cached?.warnings || []),
      ...(fundamentalSnapshot?.warnings || []),
      ...(quoteSnapshot ? [] : ['quote_list_canonical 未命中该股票，估值只能使用已缓存的持仓/股票事实。']),
    ]

    const valuationScore = this.scoreStockValuation(metrics.peDynamic, metrics.pb, industryComparison?.metrics)
    const qualityScore = this.scoreStockQuality(latestReport)
    const growthScore = this.scoreStockGrowth(latestReport)
    const financialRiskScore = this.scoreStockFinancialSafety(latestReport)
    const availableScores = [valuationScore, qualityScore, growthScore, financialRiskScore].filter((score): score is number => typeof score === 'number')
    const compositeScore = availableScores.length >= 2
      ? round(((valuationScore ?? 45) * 0.35) + ((qualityScore ?? 45) * 0.3) + ((growthScore ?? 45) * 0.2) + ((financialRiskScore ?? 45) * 0.15))
      : null
    const blockedReasons = [
      ...(!metrics.peDynamic && !metrics.pb ? ['valuation_metrics_missing'] : []),
      ...(!latestReport ? ['financial_report_missing'] : []),
      ...(availableScores.length < 2 ? ['value_assessment_evidence_insufficient'] : []),
    ]
    const confidence = availableScores.length >= 4 && industryComparison?.sampleSize && industryComparison.sampleSize >= 20
      ? 'medium'
      : availableScores.length >= 2
      ? 'low'
      : 'insufficient'
    const valuationBand = compositeScore === null
      ? 'unknown'
      : compositeScore >= 70
      ? 'cheap'
      : compositeScore >= 45
      ? 'fair'
      : 'expensive'
    const conclusion: ValueConclusion = blockedReasons.length > 0
      ? 'insufficient'
      : compositeScore !== null && compositeScore >= 72
      ? 'undervalued_watch'
      : compositeScore !== null && compositeScore < 40
      ? 'overvalued_watch'
      : financialRiskScore !== null && financialRiskScore < 35
      ? 'risk_review'
      : 'reasonable'
    const targetWeightMultiplier = this.targetMultiplier(conclusion, confidence, compositeScore)
    const facts = [
      this.fact('pe_dynamic', '动态市盈率 PE', round(metrics.peDynamic), metrics.peDynamic === derivedMetrics.peDynamic ? 'derived_from_market_cap_financial_report' : quoteSnapshot?.source || fundamentalSnapshot?.providerLabel || 'fundamental_cache', fundamentalSnapshot?.asOf || quoteSnapshot?.fetchedAt || latestReport?.reportDate || null),
      this.fact('pb', '市净率 PB', round(metrics.pb), metrics.pb === derivedMetrics.pb ? 'derived_from_market_cap_financial_report' : quoteSnapshot?.source || fundamentalSnapshot?.providerLabel || 'fundamental_cache', fundamentalSnapshot?.asOf || quoteSnapshot?.fetchedAt || latestReport?.reportDate || null),
      this.fact('total_market_cap', '总市值', round(metrics.totalMarketCap, 0), quoteSnapshot?.source || fundamentalSnapshot?.providerLabel || 'fundamental_cache', fundamentalSnapshot?.asOf || quoteSnapshot?.fetchedAt || null),
      this.fact('industry', '行业', fundamentalSnapshot?.industryBoard?.name || quoteSnapshot?.industryName || null, quoteSnapshot?.source || fundamentalSnapshot?.providerLabel || 'fundamental_cache', fundamentalSnapshot?.asOf || quoteSnapshot?.fetchedAt || null),
      this.fact('roe_weighted', '加权 ROE', round(latestReport?.roeWeighted), fundamentalSnapshot?.providerLabel || 'fundamental_cache', latestReport?.reportDate || null),
      this.fact('revenue_yoy', '营收同比', round(latestReport?.operatingRevenueYoY), fundamentalSnapshot?.providerLabel || 'fundamental_cache', latestReport?.reportDate || null),
      this.fact('profit_yoy', '归母净利同比', round(latestReport?.parentNetProfitYoY), fundamentalSnapshot?.providerLabel || 'fundamental_cache', latestReport?.reportDate || null),
      this.fact('debt_asset_ratio', '资产负债率', round(latestReport?.debtAssetRatio), fundamentalSnapshot?.providerLabel || 'fundamental_cache', latestReport?.reportDate || null),
      this.fact('cashflow_to_revenue', '经营现金流/营收', round(latestReport?.operatingCashFlowToRevenue), fundamentalSnapshot?.providerLabel || 'fundamental_cache', latestReport?.reportDate || null),
    ]

    return {
      schemaVersion: this.schemaVersion,
      generatedAt: now,
      asset: this.assetInfo(position),
      market: this.marketInfo(position, metrics.latestPrice, fundamentalSnapshot?.providerLabel || quoteSnapshot?.source || 'position_cache', fundamentalSnapshot?.asOf || quoteSnapshot?.fetchedAt || null),
      valuation: {
        status: blockedReasons.length > 0 ? (availableScores.length > 0 ? 'partial' : 'insufficient') : 'available',
        conclusion,
        valuationScore: round(valuationScore),
        qualityScore: round(qualityScore),
        growthScore: round(growthScore),
        financialRiskScore: round(financialRiskScore),
        compositeScore,
        confidence,
        targetWeightMultiplier,
        valuationBand,
        method: 'stock_relative_valuation_quality_growth_risk_v1',
        reasons: this.stockReasons({ valuationScore, qualityScore, growthScore, financialRiskScore, metrics, latestReport, industryComparison }),
        risks: this.stockRisks({ financialRiskScore, latestReport, warnings }),
        blockedReasons,
        warnings,
      },
      facts,
      evidenceRefs: [
        ...(cached ? [`stock-factset-cache:${symbol}:stock_full_analysis`] : []),
        ...(quoteSnapshot ? [`quote-list-canonical:${symbol}`] : []),
        ...(latestReport?.reportDate ? [`financial-report:${symbol}:${latestReport.reportDate}`] : []),
      ],
      providerTrace: {
        stockFactSetCache: cached ? { status: cached.status, generatedAt: cached.generatedAt } : null,
        quoteListCanonical: quoteSnapshot ? { source: quoteSnapshot.source, fetchedAt: quoteSnapshot.fetchedAt } : null,
        fundamentalSnapshot: fundamentalSnapshot ? { provider: fundamentalSnapshot.provider, quality: fundamentalSnapshot.quality, asOf: fundamentalSnapshot.asOf } : null,
      },
    }
  }

  private async buildFundLikeAssessment(position: PositionLike): Promise<ValueAssessmentFactSet> {
    const assetType = (position.asset.type || '').toLowerCase()
    const isBond = assetType === 'bond' || assetType === 'bond_fund'
    const factSet = await alternativeAssetFactsetService.buildFundLikeFactSet(position)
    const availableWindows = factSet.windows.filter((window) => window.status === 'available' || window.status === 'partial')
    const returnScore = this.scoreReturnProfile(factSet.windows)
    const riskScore = this.scoreDrawdownRisk(factSet.windows, isBond ? 8 : 20)
    const compositeScore = returnScore !== null && riskScore !== null
      ? round(returnScore * 0.45 + riskScore * 0.45 + (factSet.navHistory.sampleSize >= 120 ? 10 : 0))
      : null
    const blockedReasons = Array.from(new Set(factSet.blockedReasons))
    const confidence = factSet.navHistory.sampleSize >= 120 ? 'low' : factSet.navHistory.sampleSize >= 20 ? 'low' : 'insufficient'
    return this.genericAssessment(position, {
      status: factSet.status,
      conclusion: 'insufficient',
      method: isBond ? 'bond_fund_local_nav_risk_factset_v1' : 'fund_etf_local_nav_risk_factset_v1',
      valuationScore: null,
      qualityScore: round(returnScore),
      growthScore: null,
      financialRiskScore: round(riskScore),
      compositeScore,
      confidence,
      targetWeightMultiplier: factSet.status === 'insufficient' ? 0.3 : 0.6,
      valuationBand: 'unknown',
      reasons: [
        availableWindows.length > 0
          ? `已基于本地真实净值/价格历史计算 ${availableWindows.map((window) => `${window.windowDays}d`).join('/')} 收益、波动和回撤。`
          : '本地净值/价格历史样本不足，不能计算基金/债基风险收益指标。',
        isBond
          ? this.fundLikeRemainingGapReason(factSet, true)
          : this.fundLikeRemainingGapReason(factSet, false),
      ],
      risks: factSet.warnings,
      blockedReasons,
      warnings: ['本阶段基金/ETF/债基只输出研究级风险收益事实集，不生成确定性低估/高估判断。', ...factSet.warnings],
    }, [
      this.fact('market_value', '当前市值', round(position.marketValue, 2), 'position_book', null),
      this.fact('current_nav_or_price', '当前净值/现价', round(position.currentPrice, 4), 'position_book', null),
      this.fact('cost_basis', '成本', round(position.costBasis, 2), 'position_book', null),
      this.fact('fund_risk_level_proxy', '基金风险等级代理', factSet.riskLevelProxy.riskLevel, factSet.riskLevelProxy.provider, factSet.navHistory.latestDate),
      this.fact('fund_risk_score_proxy', '基金风险分代理', round(factSet.riskLevelProxy.score, 2), factSet.riskLevelProxy.provider, factSet.navHistory.latestDate),
      ...(isBond ? [
        this.fact('bond_duration_bucket_proxy', '债基久期桶代理', factSet.durationProxy.durationBucket, factSet.durationProxy.provider, factSet.navHistory.latestDate),
        this.fact('bond_estimated_duration_years_proxy', '债基估算久期年限代理', round(factSet.durationProxy.estimatedDurationYears, 2), factSet.durationProxy.provider, factSet.navHistory.latestDate),
        this.fact('bond_allocation_pct', '债券配置比例', round(factSet.durationProxy.inputs.bondPct, 2), factSet.bondRiskProxy.provider, factSet.bondRiskProxy.latestAllocation.reportDate),
        this.fact('top_bond_concentration_pct', '前十大债券集中度', round(factSet.durationProxy.inputs.topBondConcentrationPct, 2), factSet.bondRiskProxy.provider, factSet.bondRiskProxy.latestAllocation.reportDate),
      ] : []),
      ...this.windowFacts(factSet.windows, 'fund_local_history'),
    ], {
      alternativeFactSet: factSet,
      evidenceRefs: factSet.evidenceRefs,
      providerTrace: { fundLikeFactSet: factSet },
    })
  }

  private async buildGoldAssessment(position: PositionLike): Promise<ValueAssessmentFactSet> {
    const factSet = await alternativeAssetFactsetService.buildGoldMacroFactSet(position)
    const returnScore = this.scoreReturnProfile(factSet.windows)
    const riskScore = this.scoreDrawdownRisk(factSet.windows, 25)
    const compositeScore = returnScore !== null && riskScore !== null
      ? round(returnScore * 0.35 + riskScore * 0.45 + 10)
      : null
    return this.genericAssessment(position, {
      status: factSet.status,
      conclusion: 'insufficient',
      method: 'gold_local_price_macro_proxy_factset_v1',
      valuationScore: null,
      qualityScore: round(returnScore),
      growthScore: null,
      financialRiskScore: round(riskScore),
      compositeScore,
      confidence: factSet.goldPriceHistory.sampleSize >= 20 ? 'low' : 'insufficient',
      targetWeightMultiplier: factSet.status === 'insufficient' ? 0.4 : 0.7,
      valuationBand: 'unknown',
      reasons: [
        '黄金不能套用股票估值；本阶段基于本地真实价格历史计算收益、波动和回撤。',
        '实际利率、美元趋势和通胀预期代理尚未接入，因此黄金宏观事实集保持 partial/insufficient。',
      ],
      risks: factSet.warnings,
      blockedReasons: factSet.blockedReasons,
      warnings: ['当前黄金只输出研究级价格风险事实集，不生成确定性价值结论。', ...factSet.warnings],
    }, [
      this.fact('gold_price', '金价/克', round(position.currentPrice, 4), 'position_book', null),
      this.fact('gold_market_value', '黄金市值', round(position.marketValue, 2), 'position_book', null),
      this.fact('gold_quantity', '克重', round(position.quantity, 4), 'position_book', null),
      ...this.windowFacts(factSet.windows, 'gold_local_history'),
    ], {
      alternativeFactSet: factSet,
      evidenceRefs: factSet.evidenceRefs,
      providerTrace: { goldMacroFactSet: factSet },
    })
  }

  private buildCashAssessment(position: PositionLike): ValueAssessmentFactSet {
    return this.genericAssessment(position, {
      status: 'not_applicable',
      conclusion: 'not_applicable',
      method: 'cash_liquidity_bucket_v1',
      valuationScore: null,
      qualityScore: null,
      growthScore: null,
      financialRiskScore: null,
      compositeScore: null,
      confidence: 'insufficient',
      targetWeightMultiplier: 1,
      valuationBand: 'unknown',
      reasons: ['现金不做价值评估，只作为流动性、备用金和待建仓资金池管理。'],
      risks: ['现金主要风险是机会成本和资金用途期限错配。'],
      blockedReasons: [],
      warnings: [],
    }, [
      this.fact('cash_amount', '现金金额', round(position.marketValue ?? position.quantity, 2), 'position_book', null),
    ])
  }

  private buildUnsupportedAssessment(position: PositionLike): ValueAssessmentFactSet {
    return this.genericAssessment(position, {
      status: 'insufficient',
      conclusion: 'insufficient',
      method: 'unsupported_asset_value_model_v1',
      valuationScore: null,
      qualityScore: null,
      growthScore: null,
      financialRiskScore: null,
      compositeScore: null,
      confidence: 'insufficient',
      targetWeightMultiplier: 0,
      valuationBand: 'unknown',
      reasons: [`资产类型 ${position.asset.type} 暂无价值评估模型。`],
      risks: ['缺少资产类型专属估值方法和数据源。'],
      blockedReasons: ['unsupported_asset_type'],
      warnings: [],
    }, [])
  }

  private genericAssessment(
    position: PositionLike,
    valuation: ValueAssessmentFactSet['valuation'],
    facts: ValueAssessmentFactSet['facts'],
    options: {
      alternativeFactSet?: FundLikeFactSet | GoldMacroFactSet
      evidenceRefs?: string[]
      providerTrace?: Record<string, unknown>
    } = {}
  ): ValueAssessmentFactSet {
    return {
      schemaVersion: this.schemaVersion,
      generatedAt: new Date().toISOString(),
      asset: this.assetInfo(position),
      market: this.marketInfo(position, finite(position.currentPrice) ?? finite(position.asset.lastPrice), 'position_book', position.asset.lastUpdated ? new Date(position.asset.lastUpdated).toISOString() : null),
      valuation,
      facts,
      evidenceRefs: [
        ...facts.map((fact) => `value-fact:${position.asset.symbol}:${fact.id}`),
        ...(options.evidenceRefs || []),
      ],
      providerTrace: { positionBook: true, ...(options.providerTrace || {}) },
    }
  }

  private windowFacts(windows: Array<{ windowDays: number; sampleSize: number; rollingReturnPct: number | null; annualizedVolatilityPct: number | null; maxDrawdownPct: number | null; endDate: string | null }>, source: string) {
    return windows.flatMap((window) => [
      this.fact(`${window.windowDays}d_return`, `${window.windowDays}日收益率`, round(window.rollingReturnPct, 4), source, window.endDate),
      this.fact(`${window.windowDays}d_volatility`, `${window.windowDays}日年化波动率`, round(window.annualizedVolatilityPct, 4), source, window.endDate),
      this.fact(`${window.windowDays}d_max_drawdown`, `${window.windowDays}日最大回撤`, round(window.maxDrawdownPct, 4), source, window.endDate),
      this.fact(`${window.windowDays}d_sample_size`, `${window.windowDays}日样本量`, window.sampleSize, source, window.endDate),
    ])
  }

  private scoreReturnProfile(windows: Array<{ windowDays: number; rollingReturnPct: number | null }>) {
    const values = windows
      .filter((window) => window.rollingReturnPct !== null)
      .map((window) => Number(window.rollingReturnPct))
    if (values.length === 0) return null
    const weighted = values.reduce((sum, value) => sum + value, 0) / values.length
    return clamp(50 + weighted * 1.2, 10, 90)
  }

  private scoreDrawdownRisk(windows: Array<{ windowDays: number; maxDrawdownPct: number | null; annualizedVolatilityPct: number | null }>, drawdownTolerance: number) {
    const values = windows.filter((window) => window.maxDrawdownPct !== null || window.annualizedVolatilityPct !== null)
    if (values.length === 0) return null
    const penalties = values.map((window) => {
      const drawdown = Math.abs(Number(window.maxDrawdownPct || 0))
      const volatility = Math.max(0, Number(window.annualizedVolatilityPct || 0))
      return (drawdown / Math.max(1, drawdownTolerance)) * 18 + volatility * 0.7
    })
    const penalty = penalties.reduce((sum, value) => sum + value, 0) / penalties.length
    return clamp(80 - penalty, 5, 90)
  }

  private fundLikeRemainingGapReason(factSet: FundLikeFactSet, isBond: boolean) {
    const available: string[] = []
    if (factSet.profile.status === 'available') available.push('profile')
    if (factSet.fee.status === 'available') available.push('运作费率')
    if (factSet.holdings.status === 'available') available.push('前十大持仓风格')
    if (factSet.bondRiskProxy.status === 'available') available.push('债券持仓/信用风险代理')
    const missing = [
      '风险等级',
      ...(isBond ? ['久期', '到期收益率', '利率敏感性'] : ['跟踪误差']),
    ]
    return available.length > 0
      ? `${isBond ? '债基' : '基金/ETF'}已接入${available.join('、')}事实；仍缺${missing.join('、')}。`
      : `${isBond ? '债基' : '基金/ETF'}仍缺 profile、运作费率、持仓风格、${missing.join('、')}。`
  }

  private scoreStockValuation(
    pe?: number,
    pb?: number,
    industry?: IndustryComparisonMetrics
  ) {
    const scores: number[] = []
    if (pe !== undefined && pe > 0) {
      scores.push(pe <= 10 ? 88 : pe <= 18 ? 75 : pe <= 30 ? 55 : pe <= 50 ? 35 : 20)
    }
    if (pb !== undefined && pb > 0) {
      scores.push(pb <= 1 ? 82 : pb <= 2 ? 68 : pb <= 4 ? 48 : pb <= 8 ? 30 : 18)
    }
    if (industry?.peDynamicPercentile !== undefined) scores.push(clamp(100 - industry.peDynamicPercentile))
    if (industry?.pbPercentile !== undefined) scores.push(clamp(100 - industry.pbPercentile))
    if (scores.length === 0) return null
    return scores.reduce((sum, score) => sum + score, 0) / scores.length
  }

  private deriveStockValuationMetrics(
    metrics: { totalMarketCap?: number; peDynamic?: number; pb?: number },
    report?: FundamentalSnapshot['financialReports'][number]
  ) {
    const marketCap = finite(metrics.totalMarketCap)
    const netProfit = finite(report?.parentNetProfit)
    const roeWeighted = finite(report?.roeWeighted)
    const annualizationFactor = this.reportAnnualizationFactor(report?.reportDate, report?.reportName)
    const annualizedNetProfit = netProfit !== undefined ? netProfit * annualizationFactor : undefined
    const peDynamic = metrics.peDynamic ?? (
      marketCap !== undefined && annualizedNetProfit !== undefined && annualizedNetProfit > 0
        ? marketCap / annualizedNetProfit
        : undefined
    )
    const impliedEquity = netProfit !== undefined && roeWeighted !== undefined && roeWeighted > 0
      ? netProfit / (roeWeighted / 100)
      : undefined
    const pb = metrics.pb ?? (
      marketCap !== undefined && impliedEquity !== undefined && impliedEquity > 0
        ? marketCap / impliedEquity
        : undefined
    )
    return {
      peDynamic,
      pb,
      annualizedNetProfit,
      impliedEquity,
      annualizationFactor,
    }
  }

  private reportAnnualizationFactor(reportDate?: string, reportName?: string) {
    const text = `${reportDate || ''} ${reportName || ''}`
    if (/三季|09-30|Q3/i.test(text)) return 4 / 3
    if (/中报|半年|06-30|Q2/i.test(text)) return 2
    if (/一季|03-31|Q1/i.test(text)) return 4
    return 1
  }

  private scoreStockQuality(report?: FundamentalSnapshot['financialReports'][number]) {
    if (!report) return null
    const scores: number[] = []
    const roe = finite(report.roeWeighted)
    const gross = finite(report.grossMargin)
    const net = finite(report.netMargin)
    const cashflow = finite(report.operatingCashFlowToRevenue)
    if (roe !== undefined) scores.push(clamp((roe + 5) * 4))
    if (gross !== undefined) scores.push(clamp(gross * 2))
    if (net !== undefined) scores.push(clamp((net + 5) * 4))
    if (cashflow !== undefined) scores.push(clamp((cashflow + 20) * 2))
    if (scores.length === 0) return null
    return scores.reduce((sum, score) => sum + score, 0) / scores.length
  }

  private scoreStockGrowth(report?: FundamentalSnapshot['financialReports'][number]) {
    if (!report) return null
    const scores: number[] = []
    const revenue = finite(report.operatingRevenueYoY)
    const profit = finite(report.parentNetProfitYoY)
    if (revenue !== undefined) scores.push(clamp(50 + revenue))
    if (profit !== undefined) scores.push(clamp(50 + profit * 0.8))
    if (scores.length === 0) return null
    return scores.reduce((sum, score) => sum + score, 0) / scores.length
  }

  private scoreStockFinancialSafety(report?: FundamentalSnapshot['financialReports'][number]) {
    if (!report) return null
    const scores: number[] = []
    const debt = finite(report.debtAssetRatio)
    const cashflow = finite(report.operatingCashFlowToRevenue)
    const profit = finite(report.parentNetProfit)
    if (debt !== undefined) scores.push(clamp(100 - debt))
    if (cashflow !== undefined) scores.push(clamp(50 + cashflow * 2))
    if (profit !== undefined) scores.push(profit > 0 ? 70 : 20)
    if (scores.length === 0) return null
    return scores.reduce((sum, score) => sum + score, 0) / scores.length
  }

  private targetMultiplier(conclusion: ValueConclusion, confidence: ValueAssessmentFactSet['valuation']['confidence'], compositeScore: number | null) {
    if (conclusion === 'insufficient' || conclusion === 'not_applicable') return conclusion === 'not_applicable' ? 1 : 0.3
    if (confidence === 'insufficient') return 0.3
    if (conclusion === 'undervalued_watch') return 1.1
    if (conclusion === 'overvalued_watch' || conclusion === 'risk_review') return 0.6
    if (compositeScore !== null && compositeScore < 45) return 0.75
    return 1
  }

  private stockReasons(input: {
    valuationScore: number | null
    qualityScore: number | null
    growthScore: number | null
    financialRiskScore: number | null
    metrics: { peDynamic?: number; pb?: number; totalMarketCap?: number }
    latestReport?: FundamentalSnapshot['financialReports'][number]
    industryComparison?: FundamentalSnapshot['industryComparison']
  }) {
    const reasons: string[] = []
    if (input.metrics.peDynamic !== undefined) reasons.push(`PE=${round(input.metrics.peDynamic)} 纳入相对估值评分。`)
    if (input.metrics.pb !== undefined) reasons.push(`PB=${round(input.metrics.pb)} 纳入资产估值评分。`)
    if (input.latestReport?.roeWeighted !== undefined) reasons.push(`最新财报 ROE=${round(input.latestReport.roeWeighted)}%，纳入质量评分。`)
    if (input.latestReport?.operatingRevenueYoY !== undefined || input.latestReport?.parentNetProfitYoY !== undefined) {
      reasons.push(`营收/利润同比用于成长评分：营收 ${round(input.latestReport.operatingRevenueYoY)}%，利润 ${round(input.latestReport.parentNetProfitYoY)}%。`)
    }
    if (input.industryComparison?.sampleSize) reasons.push(`行业对比样本 ${input.industryComparison.sampleSize} 个，用于估值分位参考。`)
    if (reasons.length === 0) reasons.push('当前缺少足够基本面估值事实，不能形成价值结论。')
    return reasons
  }

  private stockRisks(input: {
    financialRiskScore: number | null
    latestReport?: FundamentalSnapshot['financialReports'][number]
    warnings: string[]
  }) {
    const risks: string[] = []
    if (input.latestReport?.debtAssetRatio !== undefined && input.latestReport.debtAssetRatio > 70) {
      risks.push(`资产负债率 ${round(input.latestReport.debtAssetRatio)}% 偏高。`)
    }
    if (input.latestReport?.parentNetProfit !== undefined && input.latestReport.parentNetProfit < 0) {
      risks.push('最新财报归母净利润为负。')
    }
    if (input.financialRiskScore !== null && input.financialRiskScore < 40) {
      risks.push('财务安全评分偏低，价值折扣不能直接转化为加仓依据。')
    }
    if (input.warnings.length > 0) risks.push(`存在 ${input.warnings.length} 条 provider/事实集 warning。`)
    return risks.length > 0 ? risks : ['未发现可量化的高强度财务风险，但仍需结合公告和行业变化复核。']
  }

  private async readCachedStockAnalysis(symbol: string) {
    const cache = await prisma.stockFactSetCache.findFirst({
      where: {
        symbol,
        factsetType: 'stock_full_analysis',
        factsetSchemaVersion: 'stock.analysis.factset.v1',
      },
      orderBy: { generatedAt: 'desc' },
    })
    if (!cache) return null
    return {
      status: cache.status,
      generatedAt: cache.generatedAt.toISOString(),
      analysis: this.parseJson<Record<string, any>>(cache.analysisJson, {}),
      warnings: this.parseJson<string[]>(cache.warningsJson, []),
    }
  }

  private assetInfo(position: PositionLike): ValueAssessmentFactSet['asset'] {
    return {
      assetId: position.assetId,
      symbol: position.asset.symbol,
      name: position.asset.name,
      assetType: position.asset.type,
      market: position.asset.exchange || 'CN',
    }
  }

  private marketInfo(position: PositionLike, price: number | undefined, provider: string, asOf: string | null): ValueAssessmentFactSet['market'] {
    const marketValue = finite(position.marketValue)
    const costBasis = finite(position.costBasis)
    return {
      currentPrice: price ?? 0,
      marketValue,
      costBasis,
      unrealizedPnlPct: marketValue !== undefined && costBasis && costBasis > 0 ? round(((marketValue - costBasis) / costBasis) * 100) ?? undefined : undefined,
      provider,
      asOf,
    }
  }

  private fact(
    id: string,
    label: string,
    value: number | string | null,
    source: string,
    asOf: string | null
  ): ValueAssessmentFactSet['facts'][number] {
    return {
      id,
      label,
      value,
      source,
      asOf,
      quality: value === null || value === undefined ? 'missing' : 'ok',
    }
  }

  private parseJson<T>(raw: string, fallback: T): T {
    try {
      return JSON.parse(raw) as T
    } catch {
      return fallback
    }
  }
}

export const valueAssessmentService = new ValueAssessmentService()
