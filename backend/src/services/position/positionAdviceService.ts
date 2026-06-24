import { prisma } from '../../db/prisma.js'
import { positionService } from './positionService.js'
import { stockAnalysisService, type StockAnalysis } from '../technical/stockAnalysisService.js'
import { marketFeatureDailyService } from '../market-data/marketFeatureDailyService.js'
import { valueAssessmentService } from '../valuation/valueAssessmentService.js'
import type { MarketFeatureDaily } from '@prisma/client'

type AssetType = 'stock' | 'etf' | 'fund' | 'bond_fund' | 'bond' | 'gold' | 'cash' | 'crypto' | 'reit' | string
type AdviceConfidence = 'high' | 'medium' | 'low' | 'insufficient'
type AdviceAction = 'ADD' | 'REDUCE' | 'HOLD' | 'OBSERVE' | 'NO_ACTION'

interface PositionAdviceOptions {
  includeExternalAnalysis?: boolean
  externalAnalysisMode?: 'none' | 'cached' | 'live'
  useCache?: boolean
  forceRefresh?: boolean
  cacheTtlMs?: number
}

export interface PositionAdviceFactSet {
  schemaVersion: 'position.advice.factset.v1'
  generatedAt: string
  portfolio: {
    totalMarketValue: number
    cashRatio: number
    stockRatio: number
    fundRatio: number
    goldRatio: number
    maxSinglePositionRatio: number
    targetCashRatio: number
    riskProfile: 'conservative' | 'balanced' | 'aggressive'
  }
  position: {
    positionId: string
    assetId: string
    symbol: string
    name: string
    assetType: AssetType
    marketValue: number
    currentWeight: number
    currentWeightPct: number
    targetWeight?: number
    costBasis: number
    currentPrice: number
    unrealizedPnl: number
    unrealizedPnlPct: number
    holdingDays?: number
  }
  market: {
    price: number
    priceTime: string | null
    provider: string
    confidence: number
    fallbackUsed: boolean
    warnings: string[]
  }
  technical: {
    trendScore: number
    momentumScore: number
    relativeStrengthScore: number
    volatilityScore: number
    liquidityScore: number
    supportResistance: {
      support: number[]
      resistance: number[]
    }
    indicators: Record<string, unknown>
    warnings: string[]
  }
  fundamental?: {
    valuationScore?: number
    qualityScore?: number
    growthScore?: number
    financialRiskScore?: number
    industryRank?: Record<string, number>
    warnings: string[]
  }
  news?: {
    sentimentScore: number
    eventRiskScore: number
    recentEvents: Array<{
      title: string
      eventType: string
      impact: 'positive' | 'neutral' | 'negative' | 'unknown'
      publishedAt: string
      evidenceRef: string
    }>
  }
  strategyEvidence: {
    matchedStrategies: string[]
    backtestSummary: Array<{
      strategyId: string
      sampleSize: number
      winRate: number
      avgReturn: number
      benchmarkReturn: number
      excessReturn: number
      confidence: AdviceConfidence
    }>
  }
  fivdRImpact?: {
    schemaVersion: 'fivd.r.position_advice_adapter.v1'
    generatedAt: string
    runRef: string
    valuationMultiplier: number
    riskPenaltyMultiplier: number
    evidenceConfidenceMultiplier: number
    validationGateMultiplier: number
    combinedMultiplier: number
    valuationStatus: string
    valuationConfidence: AdviceConfidence
    validationUsableForTradingAdvice: boolean
    blockedReasons: string[]
    evidenceRefs: string[]
  }
  blockedReasons: string[]
  evidenceRefs: string[]
}

export interface PositionAdvice {
  action: AdviceAction
  currentWeight: number
  targetWeightRange: [number, number]
  suggestedTradeRatio?: number
  confidence: AdviceConfidence
  reasons: string[]
  risks: string[]
  triggerConditions: string[]
  invalidationConditions: string[]
  evidenceRefs: string[]
  blockedReasons: string[]
  fivdRImpact?: PositionAdviceFactSet['fivdRImpact']
}

export interface PositionAdviceResult {
  factSet: PositionAdviceFactSet
  advice: PositionAdvice
  cache?: {
    status: 'fresh' | 'stale' | 'generating' | 'failed' | 'partial'
    refreshed: boolean
    generatedAt: string
    staleAt: string
    nextRefreshAfter: string
    warnings: string[]
  }
}

class PositionAdviceService {
  private readonly factsetSchemaVersion = 'position.advice.factset.v1'
  private readonly defaultCacheTtlMs = 6 * 60 * 60 * 1000
  private readonly backgroundRefreshKeys = new Set<string>()

  async getPositionAdvice(positionId: string, options: PositionAdviceOptions = {}): Promise<PositionAdviceResult> {
    const rawPosition = await prisma.position.findUnique({
      where: { id: positionId },
      include: {
        asset: {
          include: {
            assetTags: { include: { tag: true } },
            priceHistory: { orderBy: { timestamp: 'desc' }, take: 1 },
          },
        },
      },
    })

    if (!rawPosition) {
      throw new Error('Position not found')
    }

    const portfolio = await this.buildPortfolioFacts(rawPosition.userId)
    const formatted = await positionService.getPosition(positionId)
    return this.getPositionAdviceForFormattedPosition(formatted, portfolio, options)
  }

  async getPortfolioAdvice(userId: string, options: PositionAdviceOptions = {}): Promise<{
    schemaVersion: 'position.advice.batch.v1'
    generatedAt: string
    userId: string
    results: PositionAdviceResult[]
  }> {
    const positions = await positionService.getPositions(userId, {
      status: 'open',
      limit: 1000,
      sortBy: 'market_value',
      order: 'desc',
    })
    const portfolio = await this.buildPortfolioFacts(userId)
    const results: PositionAdviceResult[] = []

    for (const position of positions.data) {
      results.push(await this.getPositionAdviceForFormattedPosition(position, portfolio, options))
    }

    return {
      schemaVersion: 'position.advice.batch.v1',
      generatedAt: new Date().toISOString(),
      userId,
      results,
    }
  }

  private async getPositionAdviceForFormattedPosition(
    position: any,
    portfolio: PositionAdviceFactSet['portfolio'],
    options: PositionAdviceOptions
  ): Promise<PositionAdviceResult> {
    if (options.useCache === false || options.includeExternalAnalysis === true) {
      const factSet = await this.buildFactSet(position, portfolio, options)
      return {
        factSet,
        advice: this.generateAdvice(factSet),
      }
    }

    const cached = await this.readCachedAdvice(position, options)
    if (cached) return cached

    return this.refreshCachedAdvice(position, portfolio, options)
  }

  private async readCachedAdvice(position: any, options: PositionAdviceOptions): Promise<PositionAdviceResult | null> {
    if (options.forceRefresh) return null
    const cache = await prisma.positionAdviceCache.findUnique({
      where: {
        userId_positionId_factsetSchemaVersion: {
          userId: position.userId || 'default',
          positionId: position.id,
          factsetSchemaVersion: this.factsetSchemaVersion,
        },
      },
    })
    if (!cache) return null

    const now = Date.now()
    const sourceUpdatedAt = position.updatedAt ? new Date(position.updatedAt).getTime() : 0
    const isFresh = cache.status === 'fresh'
      && cache.nextRefreshAfter.getTime() > now
      && cache.generatedAt.getTime() >= sourceUpdatedAt

    const factSet = this.parseJson<PositionAdviceFactSet | null>(cache.factsJson, null)
    const advice = this.parseJson<PositionAdvice | null>(cache.adviceJson, null)
    if (!factSet || !advice) return null

    if (!isFresh) {
      await prisma.positionAdviceCache.update({
        where: { id: cache.id },
        data: { status: 'stale' },
      }).catch(() => undefined)
      this.triggerBackgroundRefresh(position, options)
    }

    return {
      factSet,
      advice,
      cache: {
        status: isFresh ? 'fresh' : 'stale',
        refreshed: false,
        generatedAt: cache.generatedAt.toISOString(),
        staleAt: cache.staleAt.toISOString(),
        nextRefreshAfter: cache.nextRefreshAfter.toISOString(),
        warnings: this.parseJson<string[]>(cache.warningsJson, []),
      },
    }
  }

  private triggerBackgroundRefresh(position: any, options: PositionAdviceOptions) {
    const key = `${position.userId || 'default'}:${position.id}:${this.factsetSchemaVersion}`
    if (this.backgroundRefreshKeys.has(key)) return
    this.backgroundRefreshKeys.add(key)
    setTimeout(() => {
      this.buildPortfolioFacts(position.userId || 'default')
        .then((portfolio) => this.refreshCachedAdvice(position, portfolio, options))
        .catch(() => undefined)
        .finally(() => {
          this.backgroundRefreshKeys.delete(key)
        })
    }, 0)
  }

  private async refreshCachedAdvice(
    position: any,
    portfolio: PositionAdviceFactSet['portfolio'],
    options: PositionAdviceOptions
  ): Promise<PositionAdviceResult> {
    const now = new Date()
    const ttlMs = options.cacheTtlMs || this.defaultCacheTtlMs
    const staleAt = new Date(now.getTime() + ttlMs)
    const nextRefreshAfter = staleAt

    try {
      const factSet = await this.buildFactSet(position, portfolio, options)
      const advice = this.generateAdvice(factSet)
      const warnings = [...new Set([
        ...factSet.market.warnings,
        ...factSet.technical.warnings,
        ...(factSet.fundamental?.warnings ?? []),
        ...advice.risks,
      ])]
      const providerTrace = {
        market: factSet.market,
        technicalWarnings: factSet.technical.warnings,
        blockedReasons: advice.blockedReasons,
      }

      await prisma.positionAdviceCache.upsert({
        where: {
          userId_positionId_factsetSchemaVersion: {
            userId: position.userId || 'default',
            positionId: position.id,
            factsetSchemaVersion: this.factsetSchemaVersion,
          },
        },
        create: {
          userId: position.userId || 'default',
          positionId: position.id,
          assetId: position.asset.id,
          factsetSchemaVersion: this.factsetSchemaVersion,
          status: 'fresh',
          summaryJson: JSON.stringify({
            symbol: factSet.position.symbol,
            name: factSet.position.name,
            action: advice.action,
            confidence: advice.confidence,
            currentWeight: advice.currentWeight,
            targetWeightRange: advice.targetWeightRange,
          }),
          factsJson: JSON.stringify(factSet),
          adviceJson: JSON.stringify(advice),
          evidenceRefsJson: JSON.stringify(advice.evidenceRefs),
          providerTraceJson: JSON.stringify(providerTrace),
          warningsJson: JSON.stringify(warnings),
          generatedAt: now,
          staleAt,
          nextRefreshAfter,
        },
        update: {
          assetId: position.asset.id,
          status: 'fresh',
          summaryJson: JSON.stringify({
            symbol: factSet.position.symbol,
            name: factSet.position.name,
            action: advice.action,
            confidence: advice.confidence,
            currentWeight: advice.currentWeight,
            targetWeightRange: advice.targetWeightRange,
          }),
          factsJson: JSON.stringify(factSet),
          adviceJson: JSON.stringify(advice),
          evidenceRefsJson: JSON.stringify(advice.evidenceRefs),
          providerTraceJson: JSON.stringify(providerTrace),
          warningsJson: JSON.stringify(warnings),
          generatedAt: now,
          staleAt,
          nextRefreshAfter,
        },
      })

      return {
        factSet,
        advice,
        cache: {
          status: 'fresh',
          refreshed: true,
          generatedAt: now.toISOString(),
          staleAt: staleAt.toISOString(),
          nextRefreshAfter: nextRefreshAfter.toISOString(),
          warnings,
        },
      }
    } catch (error) {
      await prisma.positionAdviceCache.upsert({
        where: {
          userId_positionId_factsetSchemaVersion: {
            userId: position.userId || 'default',
            positionId: position.id,
            factsetSchemaVersion: this.factsetSchemaVersion,
          },
        },
        create: {
          userId: position.userId || 'default',
          positionId: position.id,
          assetId: position.asset.id,
          factsetSchemaVersion: this.factsetSchemaVersion,
          status: 'failed',
          summaryJson: JSON.stringify({ symbol: position.asset.symbol, error: String(error) }),
          warningsJson: JSON.stringify([String(error)]),
          generatedAt: now,
          staleAt: now,
          nextRefreshAfter: new Date(now.getTime() + 10 * 60 * 1000),
        },
        update: {
          status: 'failed',
          warningsJson: JSON.stringify([String(error)]),
          staleAt: now,
          nextRefreshAfter: new Date(now.getTime() + 10 * 60 * 1000),
        },
      })
      throw error
    }
  }

  private async buildPortfolioFacts(userId: string): Promise<PositionAdviceFactSet['portfolio']> {
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
    })
    const totalMarketValue = positions.reduce((sum, position) => sum + this.safeNumber(position.marketValue), 0)
    const typeValue = (types: string[]) => positions
      .filter((position) => types.includes(position.asset.type))
      .reduce((sum, position) => sum + this.safeNumber(position.marketValue), 0)
    const maxSinglePositionRatio = totalMarketValue > 0
      ? Math.max(...positions.map((position) => this.safeNumber(position.marketValue) / totalMarketValue), 0)
      : 0

    return {
      totalMarketValue,
      cashRatio: this.ratio(typeValue(['cash']), totalMarketValue),
      stockRatio: this.ratio(typeValue(['stock', 'etf', 'reit']), totalMarketValue),
      fundRatio: this.ratio(typeValue(['fund', 'bond', 'bond_fund']), totalMarketValue),
      goldRatio: this.ratio(typeValue(['gold']), totalMarketValue),
      maxSinglePositionRatio,
      targetCashRatio: 0.1,
      riskProfile: 'balanced',
    }
  }

  private async buildFactSet(
    position: any,
    portfolio: PositionAdviceFactSet['portfolio'],
    options: PositionAdviceOptions
  ): Promise<PositionAdviceFactSet> {
    const generatedAt = new Date().toISOString()
    const assetType = this.normalizeAssetType(position.asset.type)
    const evidenceRefs = [
      `position:${position.id}`,
      `asset:${position.asset.id}`,
      `portfolio:${position.asset.id}:${generatedAt}`,
    ]
    const marketWarnings: string[] = []
    const blockedReasons: string[] = []
    const priceTime = position.asset.lastUpdated ? new Date(position.asset.lastUpdated).toISOString() : null
    const provider = position.asset.lastPriceSource || 'unknown'
    const fallbackUsed = provider === 'unknown' || provider === 'manual'
    const currentPrice = this.safeNumber(position.currentPrice ?? position.asset.lastPrice)

    if (fallbackUsed && assetType !== 'cash') {
      marketWarnings.push('行情来源缺失或为人工来源，禁止把该结果作为确定性加仓依据。')
      blockedReasons.push('market_provider_missing_or_manual')
    }
    if (!currentPrice && assetType !== 'cash') {
      marketWarnings.push('当前价格缺失。')
      blockedReasons.push('market_price_missing')
    }

    const stockAnalysis = await this.maybeLoadStockAnalysis(
      position.asset.symbol,
      assetType,
      options.externalAnalysisMode ?? (options.includeExternalAnalysis === true ? 'live' : 'none')
    )
    const marketFeature = await this.maybeLoadMarketFeature(position.asset.symbol, assetType)
    const technical = this.buildTechnicalFacts(stockAnalysis, marketFeature, assetType, blockedReasons, evidenceRefs)
    const fundamental = this.buildFundamentalFacts(stockAnalysis, assetType, blockedReasons, evidenceRefs)
    const news = this.buildNewsFacts(stockAnalysis, assetType, evidenceRefs)
    const strategyEvidence = await this.buildStrategyEvidence(position.asset.symbol, assetType, evidenceRefs, blockedReasons)
    const fivdRImpact = await this.buildFivdRPositionAdviceImpact(position, evidenceRefs, blockedReasons)
    const marketValue = this.safeNumber(position.marketValue)
    const costBasis = this.safeNumber(position.costBasis)
    const currentWeight = this.ratio(marketValue, portfolio.totalMarketValue)
    const openedAt = position.openedAt ? new Date(position.openedAt).getTime() : undefined
    const holdingDays = openedAt ? Math.max(0, Math.floor((Date.now() - openedAt) / 86400000)) : undefined

    return {
      schemaVersion: 'position.advice.factset.v1',
      generatedAt,
      portfolio,
      position: {
        positionId: position.id,
        assetId: position.asset.id,
        symbol: position.asset.symbol,
        name: position.asset.name,
        assetType,
        marketValue,
        currentWeight,
        currentWeightPct: currentWeight * 100,
        targetWeight: this.baseTargetWeight(assetType),
        costBasis,
        currentPrice,
        unrealizedPnl: this.safeNumber(position.unrealizedPnl),
        unrealizedPnlPct: this.safeNumber(position.unrealizedPnlPercent),
        holdingDays,
      },
      market: {
        price: currentPrice,
        priceTime,
        provider,
        confidence: fallbackUsed ? 0.3 : 0.8,
        fallbackUsed,
        warnings: marketWarnings,
      },
      technical,
      fundamental,
      news,
      strategyEvidence,
      fivdRImpact,
      blockedReasons: [...new Set(blockedReasons)],
      evidenceRefs: [...new Set(evidenceRefs)],
    }
  }

  private async buildFivdRPositionAdviceImpact(
    position: any,
    evidenceRefs: string[],
    blockedReasons: string[]
  ): Promise<PositionAdviceFactSet['fivdRImpact']> {
    const generatedAt = new Date().toISOString()
    const [valuation, latestValidation] = await Promise.all([
      valueAssessmentService.assessPosition(position).catch(() => null),
      this.loadLatestFivdRValidationEvidence(),
    ])
    const valuationMultiplier = this.clampMultiplier(
      this.safeNumber(valuation?.valuation?.targetWeightMultiplier, 1)
    )
    const valuationConfidence = this.normalizeAdviceConfidence(valuation?.valuation?.confidence)
    const evidenceConfidenceMultiplier = this.confidenceMultiplier(valuationConfidence)
    const riskPenaltyMultiplier = this.fivdRRiskPenaltyMultiplier(valuation)
    const validationUsableForTradingAdvice = latestValidation?.validationDecision?.usableForTradingAdvice === true
    const validationGateMultiplier = validationUsableForTradingAdvice ? 1 : 0
    const adapterEvidenceRefs = [
      `fivd-r:position:${position.id}:${generatedAt}`,
      ...(valuation?.evidenceRefs ?? []),
      ...(latestValidation?.evidenceRefs ?? []),
    ]
    const adapterBlockedReasons = [
      ...(valuation?.valuation?.blockedReasons ?? []),
      ...(!validationUsableForTradingAdvice ? ['validation_evidence'] : []),
    ]

    evidenceRefs.push(...adapterEvidenceRefs)
    blockedReasons.push(...adapterBlockedReasons)

    return {
      schemaVersion: 'fivd.r.position_advice_adapter.v1',
      generatedAt,
      runRef: `fivd-r:position:${position.id}:${generatedAt}`,
      valuationMultiplier,
      riskPenaltyMultiplier,
      evidenceConfidenceMultiplier,
      validationGateMultiplier,
      combinedMultiplier: this.roundRatio(
        valuationMultiplier * riskPenaltyMultiplier * evidenceConfidenceMultiplier * validationGateMultiplier
      ),
      valuationStatus: valuation?.valuation?.status ?? 'unavailable',
      valuationConfidence,
      validationUsableForTradingAdvice,
      blockedReasons: [...new Set(adapterBlockedReasons)],
      evidenceRefs: [...new Set(adapterEvidenceRefs)],
    }
  }

  private async loadLatestFivdRValidationEvidence(): Promise<{
    operationId: string
    generatedAt: string
    validationDecision: Record<string, any> | null
    candidateDisposition: Record<string, any> | null
    evidenceRefs: string[]
  } | null> {
    const operation = await prisma.operation.findFirst({
      where: {
        type: { in: ['stock_screener_full_scan', 'strategy_tournament_run'] },
        status: { in: ['completed', 'succeeded', 'partial'] },
      },
      orderBy: [
        { completedAt: 'desc' },
        { requestedAt: 'desc' },
      ],
    })
    if (!operation) return null
    const result = this.parseJson<Record<string, any>>(operation.resultJson, {})
    const validationDecision = result.validationDecision && typeof result.validationDecision === 'object'
      ? result.validationDecision as Record<string, any>
      : null
    const candidateDisposition = result.validationCandidateDisposition && typeof result.validationCandidateDisposition === 'object'
      ? result.validationCandidateDisposition as Record<string, any>
      : null
    return {
      operationId: operation.id,
      generatedAt: operation.completedAt?.toISOString() || operation.requestedAt.toISOString(),
      validationDecision,
      candidateDisposition,
      evidenceRefs: [
        `operation:${operation.id}`,
        'validation_decision.json',
        ...(candidateDisposition ? ['validation_candidate_disposition.json'] : []),
      ],
    }
  }

  private async maybeLoadStockAnalysis(
    symbol: string,
    assetType: AssetType,
    mode: 'none' | 'cached' | 'live'
  ): Promise<StockAnalysis | null> {
    if (mode === 'none' || !['stock', 'etf'].includes(assetType)) return null
    try {
      return await stockAnalysisService.getFullAnalysis(symbol, 'A股', 80, mode === 'cached'
        ? { cacheOnly: true, skipBackgroundRefresh: true }
        : {})
    } catch {
      return null
    }
  }

  private async maybeLoadMarketFeature(symbol: string, assetType: AssetType): Promise<MarketFeatureDaily | null> {
    if (!['stock', 'etf'].includes(assetType) || !/^\d{6}$/.test(symbol)) return null
    try {
      return (await marketFeatureDailyService.getLatestFeatures([symbol], { market: 'CN' })).get(symbol) ?? null
    } catch {
      return null
    }
  }

  private buildTechnicalFacts(
    stockAnalysis: StockAnalysis | null,
    marketFeature: MarketFeatureDaily | null,
    assetType: AssetType,
    blockedReasons: string[],
    evidenceRefs: string[]
  ): PositionAdviceFactSet['technical'] {
    if (!stockAnalysis) {
      if (marketFeature && ['stock', 'etf'].includes(assetType)) {
        evidenceRefs.push(`market-feature-daily:${marketFeature.symbol}:${marketFeature.tradeDate.toISOString().slice(0, 10)}`)
        const close = this.safeNumber(marketFeature.closePrice)
        const support = this.safeNumber(marketFeature.rollingLow20)
        const resistance = this.safeNumber(marketFeature.rollingHigh20)
        const qualityFlags = this.parseJson<string[]>(marketFeature.qualityFlagsJson, [])
        return {
          trendScore: this.safeNumber(marketFeature.trendScore, 50),
          momentumScore: this.safeNumber(marketFeature.momentumScore, 50),
          relativeStrengthScore: this.scoreFromRelativeStrength(marketFeature.relativeStrength60),
          volatilityScore: this.scoreFromVolatility(marketFeature.volatility20),
          liquidityScore: this.safeNumber(marketFeature.liquidityScore, 50),
          supportResistance: {
            support: support > 0 ? [support] : [],
            resistance: resistance > 0 ? [resistance] : [],
          },
          indicators: {
            source: 'market_feature_daily',
            tradeDate: marketFeature.tradeDate.toISOString().slice(0, 10),
            close,
            return20d: marketFeature.return20d,
            return60d: marketFeature.return60d,
            ma20: marketFeature.ma20,
            ma60: marketFeature.ma60,
            ma120: marketFeature.ma120,
            ma20Slope: marketFeature.ma20Slope,
            ma60Slope: marketFeature.ma60Slope,
            volumeRatio20: marketFeature.volumeRatio20,
            atr14: marketFeature.atr14,
            rsi14: marketFeature.rsi14,
            volatility20: marketFeature.volatility20,
            maxDrawdown20: marketFeature.maxDrawdown20,
            relativeStrength60: marketFeature.relativeStrength60,
            qualityFlags,
          },
          warnings: [
            '技术面使用本地 canonical 行情预计算特征；外部技术评级未缓存时不单独作为确定性加仓依据。',
            ...qualityFlags.map((flag) => `技术特征质量标记：${flag}`),
          ],
        }
      }
      if (['stock', 'etf'].includes(assetType)) {
        blockedReasons.push('technical_factset_missing')
      }
      return {
        trendScore: assetType === 'cash' ? 100 : 50,
        momentumScore: 50,
        relativeStrengthScore: 50,
        volatilityScore: 50,
        liquidityScore: assetType === 'cash' ? 100 : 50,
        supportResistance: { support: [], resistance: [] },
        indicators: {},
        warnings: ['外部技术指标事实集未生成，本次建议不得输出加仓。'],
      }
    }

    evidenceRefs.push(`stock-analysis:${stockAnalysis.code}:${stockAnalysis.analysisTime}`)
    const rating = stockAnalysis.externalTechnical.rating
    const confidenceScore = stockAnalysis.externalTechnical.confidence.score
    const trendScore = typeof rating?.maScore === 'number'
      ? this.scoreFromSignedRating(rating.maScore)
      : this.scoreFromTrend(stockAnalysis.trend)
    const momentumScore = typeof rating?.oscillatorScore === 'number'
      ? this.scoreFromSignedRating(rating.oscillatorScore)
      : this.scoreFromRsi(stockAnalysis.rsi)
    const volatilityScore = Math.max(0, Math.min(100, 100 - stockAnalysis.volatility * 100))

    if (confidenceScore < 60) {
      blockedReasons.push('technical_provider_confidence_low')
    }

    return {
      trendScore,
      momentumScore,
      relativeStrengthScore: 50,
      volatilityScore,
      liquidityScore: stockAnalysis.turnover > 50_000_000 ? 80 : stockAnalysis.turnover > 10_000_000 ? 60 : 35,
      supportResistance: {
        support: [stockAnalysis.supportResistance.support],
        resistance: [stockAnalysis.supportResistance.resistance],
      },
      indicators: {
        rsi14: stockAnalysis.rsi,
        ma20: stockAnalysis.ma20,
        atr14: stockAnalysis.atr,
        externalRating: rating,
        externalConfidence: stockAnalysis.externalTechnical.confidence,
        technicalAdvice: stockAnalysis.technicalAdvice,
      },
      warnings: [
        ...stockAnalysis.externalTechnical.warnings,
        ...stockAnalysis.technicalAdvice.blockedReasons,
      ],
    }
  }

  private buildFundamentalFacts(
    stockAnalysis: StockAnalysis | null,
    assetType: AssetType,
    blockedReasons: string[],
    evidenceRefs: string[]
  ): PositionAdviceFactSet['fundamental'] {
    if (assetType === 'etf') {
      return { warnings: ['ETF 暂不使用股票财务基本面模型，主要使用指数/行情/流动性事实集。'] }
    }
    if (!['stock', 'etf'].includes(assetType)) {
      return { warnings: ['该资产类型暂不使用股票基本面模型。'] }
    }
    if (!stockAnalysis || stockAnalysis.factSet.fundamental.quality !== 'ok') {
      blockedReasons.push('fundamental_factset_insufficient')
      return { warnings: stockAnalysis?.factSet.fundamental.warnings ?? ['基本面事实集未生成。'] }
    }
    evidenceRefs.push(`fundamental:${stockAnalysis.code}:${stockAnalysis.factSet.generatedAt}`)
    return {
      valuationScore: this.scoreValuation(stockAnalysis.peRatio, stockAnalysis.pbRatio),
      qualityScore: 50,
      growthScore: 50,
      financialRiskScore: 50,
      warnings: stockAnalysis.factSet.fundamental.warnings,
    }
  }

  private buildNewsFacts(
    stockAnalysis: StockAnalysis | null,
    assetType: AssetType,
    evidenceRefs: string[]
  ): PositionAdviceFactSet['news'] {
    if (!['stock', 'etf'].includes(assetType)) {
      return { sentimentScore: 50, eventRiskScore: 0, recentEvents: [] }
    }
    if (!stockAnalysis || stockAnalysis.factSet.news.quality !== 'ok') {
      return { sentimentScore: 50, eventRiskScore: 30, recentEvents: [] }
    }

    evidenceRefs.push(`news:${stockAnalysis.code}:${stockAnalysis.factSet.generatedAt}`)
    const events = stockAnalysis.newsSnapshot.events.slice(0, 5).map((event, index) => ({
      title: event.title,
      eventType: event.eventType,
      impact: this.mapSentiment(event.sentiment),
      publishedAt: event.publishedAt,
      evidenceRef: `news:${stockAnalysis.code}:${index}`,
    }))
    const negativeCount = events.filter((event) => event.impact === 'negative').length
    const positiveCount = events.filter((event) => event.impact === 'positive').length

    return {
      sentimentScore: Math.max(0, Math.min(100, 50 + positiveCount * 10 - negativeCount * 15)),
      eventRiskScore: Math.min(100, negativeCount * 25),
      recentEvents: events,
    }
  }

  private async buildStrategyEvidence(
    symbol: string,
    assetType: AssetType,
    evidenceRefs: string[],
    blockedReasons: string[]
  ): Promise<PositionAdviceFactSet['strategyEvidence']> {
    if (!['stock', 'etf'].includes(assetType)) {
      return {
        matchedStrategies: [],
        backtestSummary: [],
      }
    }

    const reports = await prisma.backtestResult.findMany({
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { backtest: true },
    })
    const summaries: PositionAdviceFactSet['strategyEvidence']['backtestSummary'] = []

    for (const result of reports) {
      const report = this.parseJson<Record<string, unknown>>(result.reviewReportJson, {})
      const text = JSON.stringify(report)
      if (!text.includes(symbol)) continue
      const sampleSize = this.safeNumber(result.tradesCount)
      const winRate = this.safeNumber(result.winRate)
      const avgReturn = this.safeNumber(result.totalReturn)
      const benchmarkReturn = this.safeNumber((report as { benchmarkReturn?: number }).benchmarkReturn)
      summaries.push({
        strategyId: result.backtest.strategyId,
        sampleSize,
        winRate,
        avgReturn,
        benchmarkReturn,
        excessReturn: avgReturn - benchmarkReturn,
        confidence: this.confidenceFromBacktest(sampleSize, avgReturn - benchmarkReturn),
      })
      evidenceRefs.push(`backtest-result:${result.id}`)
    }

    if (summaries.length === 0) {
      const latestScreenerEvidence = await this.loadLatestScreenerEvidence()
      if (latestScreenerEvidence) {
        summaries.push(latestScreenerEvidence.summary)
        evidenceRefs.push(latestScreenerEvidence.evidenceRef)
        evidenceRefs.push(...latestScreenerEvidence.evidenceRefs)
        blockedReasons.push(...latestScreenerEvidence.blockedReasons)
      } else {
        blockedReasons.push('strategy_evidence_missing')
      }
    }

    return {
      matchedStrategies: [...new Set(summaries.map((summary) => summary.strategyId))],
      backtestSummary: summaries,
    }
  }

  private async loadLatestScreenerEvidence(): Promise<{
    evidenceRef: string
    evidenceRefs: string[]
    blockedReasons: string[]
    summary: PositionAdviceFactSet['strategyEvidence']['backtestSummary'][number]
  } | null> {
    const operation = await prisma.operation.findFirst({
      where: {
        type: { in: ['stock_screener_full_scan', 'strategy_tournament_run'] },
        status: { in: ['completed', 'succeeded', 'partial'] },
      },
      orderBy: [
        { completedAt: 'desc' },
        { requestedAt: 'desc' },
      ],
    })
    if (!operation) return null
    const result = this.parseJson<Record<string, any>>(operation.resultJson, {})
    const acceptance = result.longSampleAcceptance && typeof result.longSampleAcceptance === 'object'
      ? result.longSampleAcceptance as Record<string, any>
      : null
    const summary = acceptance?.summary && typeof acceptance.summary === 'object'
      ? acceptance.summary as Record<string, any>
      : {}
    const bestSampleSize = this.safeNumber(summary.bestSampleSize)
    const bestCredibility = typeof summary.bestCredibility === 'string'
      ? summary.bestCredibility as AdviceConfidence
      : 'insufficient'
    if (bestSampleSize <= 0) return null
    const validationDecision = result.validationDecision && typeof result.validationDecision === 'object'
      ? result.validationDecision as Record<string, any>
      : null
    const candidateDisposition = result.validationCandidateDisposition && typeof result.validationCandidateDisposition === 'object'
      ? result.validationCandidateDisposition as Record<string, any>
      : null
    const validationUsable = validationDecision?.usableForTradingAdvice === true
    const evidenceRefs = [
      'validation_decision.json',
      ...(candidateDisposition ? ['validation_candidate_disposition.json'] : []),
    ]
    const blockedReasons = [
      ...(!validationUsable ? ['validation_evidence'] : []),
      ...(candidateDisposition?.status && candidateDisposition.status !== 'ready_for_manual_review'
        ? ['candidate_disposition_research_only']
        : []),
    ]
    return {
      evidenceRef: `operation:${operation.id}:long-sample-evidence`,
      evidenceRefs,
      blockedReasons,
      summary: {
        strategyId: 'full_a_async_screener_evidence',
        sampleSize: bestSampleSize,
        winRate: 0,
        avgReturn: 0,
        benchmarkReturn: 0,
        excessReturn: 0,
        confidence: !validationUsable
          ? 'low'
          : ['high', 'medium', 'low', 'insufficient'].includes(bestCredibility)
          ? bestCredibility
          : 'insufficient',
      },
    }
  }

  private generateAdvice(factSet: PositionAdviceFactSet): PositionAdvice {
    const confidence = this.overallConfidence(factSet)
    const baseTarget = this.baseTargetWeight(factSet.position.assetType)
    const targetWeight = baseTarget
      * this.marketRegimeMultiplier(factSet)
      * this.signalMultiplier(factSet)
      * this.riskPenaltyMultiplier(factSet)
      * (factSet.fivdRImpact?.combinedMultiplier ?? 1)
      * this.confidenceMultiplier(confidence)
    const targetWeightRange: [number, number] = [
      this.roundRatio(targetWeight * 0.9),
      this.roundRatio(targetWeight * 1.1),
    ]
    const delta = targetWeight - factSet.position.currentWeight
    const reasons = this.buildReasons(factSet, targetWeight, confidence)
    const risks = this.buildRisks(factSet)
    const blockedReasons = [...new Set(factSet.blockedReasons)]
    let action: AdviceAction

    if (factSet.position.assetType === 'cash') {
      action = 'NO_ACTION'
    } else if (factSet.position.currentWeight > 0.15 || factSet.technical.trendScore < 30) {
      action = 'REDUCE'
    } else if (blockedReasons.includes('market_price_missing')) {
      action = 'NO_ACTION'
    } else if (confidence === 'low' || confidence === 'insufficient') {
      action = 'OBSERVE'
    } else if (delta > 0.02) {
      action = 'ADD'
    } else if (delta < -0.02) {
      action = 'REDUCE'
    } else {
      action = 'HOLD'
    }

    if (action === 'ADD' && (confidence === 'low' || confidence === 'insufficient')) {
      action = 'OBSERVE'
    }
    if ((action === 'ADD' || action === 'REDUCE') && blockedReasons.includes('validation_evidence')) {
      action = 'OBSERVE'
    }

    return {
      action,
      currentWeight: this.roundRatio(factSet.position.currentWeight),
      targetWeightRange,
      suggestedTradeRatio: action === 'ADD' || action === 'REDUCE'
        ? this.roundRatio(Math.sign(delta) * Math.min(Math.abs(delta), 0.03))
        : undefined,
      confidence,
      reasons,
      risks,
      triggerConditions: [
        '行情 provider 多源校验通过且价格未回退到人工来源。',
        '策略回测可信度至少达到 medium。',
        '触发后仍满足单票和同类资产仓位上限。',
      ],
      invalidationConditions: [
        '价格跌破关键趋势位或外部技术指标可信度降至 low。',
        '出现重大负面公告、财务风险或 provider 数据冲突。',
        '策略样本外回测失效或扣费滑点后超额收益转负。',
      ],
      evidenceRefs: factSet.evidenceRefs,
      blockedReasons,
      fivdRImpact: factSet.fivdRImpact,
    }
  }

  private overallConfidence(factSet: PositionAdviceFactSet): AdviceConfidence {
    if (factSet.blockedReasons.includes('market_price_missing')) return 'insufficient'
    if (factSet.strategyEvidence.backtestSummary.length === 0) {
      if (['fund', 'bond_fund', 'bond', 'gold'].includes(factSet.position.assetType)) {
        return factSet.market.confidence >= 0.6 ? 'medium' : 'low'
      }
      return 'insufficient'
    }
    if (factSet.market.confidence < 0.6 || factSet.technical.trendScore < 20) return 'low'
    const bestStrategy = factSet.strategyEvidence.backtestSummary
      .map((summary) => summary.confidence)
      .sort((a, b) => this.confidenceRank(b) - this.confidenceRank(a))[0]
    if (!bestStrategy || bestStrategy === 'insufficient') return 'insufficient'
    if (bestStrategy === 'low' || factSet.blockedReasons.length > 0) return 'low'
    if (bestStrategy === 'medium' && factSet.market.confidence >= 0.8) return 'medium'
    return bestStrategy
  }

  private buildReasons(factSet: PositionAdviceFactSet, targetWeight: number, confidence: AdviceConfidence): string[] {
    if (confidence === 'insufficient') {
      return [
        `当前仓位 ${(factSet.position.currentWeight * 100).toFixed(2)}%，证据不足，暂不生成可执行目标仓位。`,
        `趋势分 ${factSet.technical.trendScore}，动量分 ${factSet.technical.momentumScore}，流动性分 ${factSet.technical.liquidityScore}。`,
        `策略证据数量 ${factSet.strategyEvidence.backtestSummary.length}，综合可信度 ${confidence}。`,
      ]
    }

    return [
      `当前仓位 ${(factSet.position.currentWeight * 100).toFixed(2)}%，规则目标仓位 ${(targetWeight * 100).toFixed(2)}%。`,
      `趋势分 ${factSet.technical.trendScore}，动量分 ${factSet.technical.momentumScore}，流动性分 ${factSet.technical.liquidityScore}。`,
      `策略证据数量 ${factSet.strategyEvidence.backtestSummary.length}，综合可信度 ${confidence}。`,
      ...(factSet.fivdRImpact ? [
        `FIVD-R Adapter 乘数 ${factSet.fivdRImpact.combinedMultiplier}，validation gate ${factSet.fivdRImpact.validationGateMultiplier}。`,
      ] : []),
    ]
  }

  private buildRisks(factSet: PositionAdviceFactSet): string[] {
    const risks = [
      ...factSet.market.warnings,
      ...factSet.technical.warnings,
      ...(factSet.fundamental?.warnings ?? []),
    ]
    if (factSet.position.currentWeight > 0.15) {
      risks.push('单一持仓超过 15%，优先进入集中度风险检查。')
    }
    if (factSet.news && factSet.news.eventRiskScore >= 50) {
      risks.push('消息面事件风险较高。')
    }
    if (factSet.fivdRImpact?.validationGateMultiplier === 0) {
      risks.push('FIVD-R validation evidence 未通过，PositionAdvice 不输出 formal ADD / REDUCE。')
    }
    return [...new Set(risks)]
  }

  private fivdRRiskPenaltyMultiplier(valuation: Awaited<ReturnType<typeof valueAssessmentService.assessPosition>> | null): number {
    const financialRiskScore = valuation?.valuation?.financialRiskScore
    if (typeof financialRiskScore !== 'number') return valuation?.valuation?.status === 'insufficient' ? 0.7 : 1
    if (financialRiskScore < 35) return 0.5
    if (financialRiskScore < 50) return 0.8
    return 1
  }

  private normalizeAdviceConfidence(value: unknown): AdviceConfidence {
    return value === 'high' || value === 'medium' || value === 'low' || value === 'insufficient'
      ? value
      : 'insufficient'
  }

  private clampMultiplier(value: number): number {
    return Math.max(0, Math.min(1.5, value))
  }

  private marketRegimeMultiplier(factSet: PositionAdviceFactSet): number {
    if (factSet.portfolio.cashRatio < 0.03) return 0.6
    return 0.7
  }

  private signalMultiplier(factSet: PositionAdviceFactSet): number {
    if (factSet.technical.trendScore >= 70 && factSet.technical.momentumScore >= 60) return 1.2
    if (factSet.technical.trendScore >= 50) return 1
    if (factSet.technical.trendScore >= 35) return 0.8
    if (factSet.technical.trendScore >= 25) return 0.5
    return 0.2
  }

  private riskPenaltyMultiplier(factSet: PositionAdviceFactSet): number {
    let multiplier = 1
    if (factSet.position.currentWeight > 0.15) multiplier *= 0.4
    if (factSet.portfolio.maxSinglePositionRatio > 0.2) multiplier *= 0.8
    if (factSet.technical.volatilityScore < 35) multiplier *= 0.7
    if ((factSet.news?.eventRiskScore ?? 0) >= 50) multiplier *= 0.6
    return multiplier
  }

  private confidenceMultiplier(confidence: AdviceConfidence): number {
    if (confidence === 'high') return 1
    if (confidence === 'medium') return 0.7
    if (confidence === 'low') return 0.3
    return 0
  }

  private baseTargetWeight(assetType: AssetType): number {
    if (assetType === 'stock') return 0.08
    if (assetType === 'etf') return 0.1
    if (assetType === 'fund' || assetType === 'bond_fund' || assetType === 'bond') return 0.12
    if (assetType === 'gold') return 0.08
    if (assetType === 'cash') return 0
    return 0.05
  }

  private confidenceFromBacktest(sampleSize: number, excessReturn: number): AdviceConfidence {
    if (sampleSize < 30) return 'insufficient'
    if (sampleSize < 100) return 'low'
    if (sampleSize >= 300 && excessReturn > 0.03) return 'high'
    if (excessReturn > 0) return 'medium'
    return 'low'
  }

  private confidenceRank(confidence: AdviceConfidence): number {
    return { insufficient: 0, low: 1, medium: 2, high: 3 }[confidence]
  }

  private scoreFromSignedRating(value: number): number {
    return Math.max(0, Math.min(100, Math.round((value + 1) * 50)))
  }

  private scoreFromRsi(rsi: number): number {
    if (!Number.isFinite(rsi)) return 50
    if (rsi >= 45 && rsi <= 65) return 70
    if (rsi > 65 && rsi <= 75) return 60
    if (rsi >= 30 && rsi < 45) return 55
    return 35
  }

  private scoreFromTrend(trend: string): number {
    if (trend === 'uptrend') return 75
    if (trend === 'downtrend') return 25
    return 50
  }

  private scoreValuation(peRatio?: number, pbRatio?: number): number {
    let score = 50
    if (typeof peRatio === 'number' && peRatio > 0) score += peRatio < 20 ? 15 : peRatio > 60 ? -15 : 0
    if (typeof pbRatio === 'number' && pbRatio > 0) score += pbRatio < 2 ? 10 : pbRatio > 8 ? -10 : 0
    return Math.max(0, Math.min(100, score))
  }

  private mapSentiment(sentiment: string): 'positive' | 'neutral' | 'negative' | 'unknown' {
    if (sentiment === 'positive') return 'positive'
    if (sentiment === 'negative') return 'negative'
    if (sentiment === 'neutral') return 'neutral'
    return 'unknown'
  }

  private normalizeAssetType(assetType: string): AssetType {
    if (assetType === 'bond') return 'bond_fund'
    return assetType
  }

  private scoreFromRelativeStrength(value: number | null): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 50
    return Math.max(0, Math.min(100, Math.round(50 + value * 100)))
  }

  private scoreFromVolatility(value: number | null): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 50
    return Math.max(0, Math.min(100, Math.round(100 - value * 200)))
  }

  private safeNumber(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }

  private ratio(numerator: number, denominator: number): number {
    return denominator > 0 ? numerator / denominator : 0
  }

  private roundRatio(value: number): number {
    return Math.round(value * 10000) / 10000
  }

  private parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
}

export const positionAdviceService = new PositionAdviceService()
