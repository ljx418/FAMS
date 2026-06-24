/**
 * Stock Analysis Service - 股票分析服务
 *
 * 职责：
 * 1. 整合价格数据和技术指标计算
 * 2. 提供完整的股票分析结果
 * 3. 支持详细分析和仅技术指标两种模式
 *
 * 依赖：technicalService.ts, stockUtils.ts
 */

import { getStockRealtime, getStockHistory } from '../../utils/stockUtils.js'
import {
  externalTechnicalDataProvider,
  type ExternalTechnicalSnapshot,
  type ExternalTechnicalConfidenceCheck,
} from './externalTechnicalDataProvider.js'
import {
  technicalAdviceModelRegistry,
  type TechnicalAdviceModelOutput,
} from './technicalAdviceModelRegistry.js'
import {
  stockAnalysisFactSetBuilder,
  type StockAnalysisFactSet,
} from './stockAnalysisFactSet.js'
import {
  fundamentalDataProvider,
  type FundamentalSnapshot,
} from './fundamentalDataProvider.js'
import {
  newsDataProvider,
  type NewsSnapshot,
} from './newsDataProvider.js'
import {
  stockAnalysisSummaryService,
  type StockAnalysisSummary,
} from './stockAnalysisSummaryService.js'
import {
  technicalService,
  MACDResult,
  BOLLResult,
  KDJResult,
  SupportResistance,
  TrendType
} from './technicalService.js'
import { technicalIndicatorService } from './technicalIndicatorService.js'
import { prisma } from '../../db/prisma.js'

export interface StockIndicators {
  // 均线
  ma5: number
  ma10: number
  ma20: number
  // 技术指标
  rsi: number
  macd: MACDResult
  boll: BOLLResult
  kdj: KDJResult
  atr: number
  volatility: number
  // 支撑阻力
  supportResistance: SupportResistance
  // 趋势
  trend: TrendType
}

export interface StockAnalysis extends StockIndicators {
  // 基本信息
  code: string
  name: string
  currentPrice: number
  priceChange: number
  priceChangePercent: number
  volume: number
  turnover: number
  highestPrice: number
  lowestPrice: number
  averagePrice: number
  currency: string
  analysisTime: string
  // 投资建议
  recommendation: string
  externalTechnical: ExternalTechnicalSnapshot
  technicalAdvice: TechnicalAdviceModelOutput
  factSet: StockAnalysisFactSet
  fundamentalSnapshot: FundamentalSnapshot
  newsSnapshot: NewsSnapshot
  analysisSummary: StockAnalysisSummary
  cache?: {
    status: 'fresh' | 'stale' | 'generating' | 'failed' | 'partial'
    refreshed: boolean
    generatedAt: string
    staleAt: string
    nextRefreshAfter: string
    lookbackDays: number
    timeframe: string
    warnings: string[]
  }
  peRatio?: number
  pbRatio?: number
}

interface StockAnalysisOptions {
  useCache?: boolean
  forceRefresh?: boolean
  cacheTtlMs?: number
  cacheOnly?: boolean
  skipBackgroundRefresh?: boolean
}

class StockAnalysisService {
  private readonly factsetSchemaVersion = 'stock.analysis.factset.v1'
  private readonly factsetType = 'stock_full_analysis'
  private readonly timeframe = '1d'
  private readonly defaultCacheTtlMs = 60 * 60 * 1000
  private readonly backgroundRefreshKeys = new Set<string>()

  /**
   * 获取股票完整分析（包含基本信息和技术指标）
   * @param code 股票代码
   * @param market 市场类型 (A股/美股/港股/指数)
   * @param days 数据天数，默认30天
   */
  async getFullAnalysis(
    code: string,
    market: string = 'A股',
    days: number = 30,
    options: StockAnalysisOptions = {}
  ): Promise<StockAnalysis> {
    const normalizedCode = this.normalizeSymbol(code)
    const normalizedMarket = market || 'A股'
    if (options.useCache !== false && !options.forceRefresh) {
      const cached = await this.readCachedAnalysis(normalizedCode, normalizedMarket, days, options)
      if (cached) return cached
    }

    if (options.cacheOnly) {
      throw new Error(`股票分析缓存不存在或不可用：${normalizedCode}`)
    }

    try {
      const analysis = await this.buildFullAnalysis(normalizedCode, normalizedMarket, days)
      if (options.useCache !== false) {
        return this.writeCachedAnalysis(analysis, normalizedMarket, days, options.cacheTtlMs)
      }
      return analysis
    } catch (error) {
      if (options.useCache !== false) {
        await this.writeFailedCache(normalizedCode, normalizedMarket, days, error)
      }
      throw error
    }
  }

  private async buildFullAnalysis(code: string, market: string = 'A股', days: number = 30): Promise<StockAnalysis> {
    // 1. 获取真实历史K线数据
    let priceHistory: Array<{ closePrice: number; highPrice: number; lowPrice: number; volume: number; name?: string }> = []

    try {
      // 使用 stockUtils 获取真实历史数据
      const historyData = await getStockHistory(code, days)

      if (historyData && historyData.length > 0) {
        priceHistory = historyData.map(h => ({
          closePrice: h.close,
          highPrice: h.high,
          lowPrice: h.low,
          volume: h.volume,
          name: h.name,
        }))
      }
    } catch (error) {
      console.error(`Failed to get stock history for ${code}:`, error)
    }

    if (!priceHistory || priceHistory.length === 0) {
      throw new Error(`无法获取 ${code} 的真实历史K线，不能生成技术分析`)
    }

    // 2. 提取价格数组
    const closes = priceHistory.map(p => p.closePrice)
    const highs = priceHistory.map(p => p.highPrice)
    const lows = priceHistory.map(p => p.lowPrice)
    const volumes = priceHistory.map(p => p.volume)

    // 3. 当前价格和变化
    const currentPrice = closes[closes.length - 1]
    const previousClose = closes[closes.length - 2] ?? currentPrice
    const priceChange = currentPrice - previousClose
    const priceChangePercent = previousClose !== 0 ? (priceChange / previousClose) * 100 : 0

    // 4. 计算技术指标
    const indicators = this.calculateIndicators(closes, highs, lows)

    // 4.1 获取外部成熟技术指标和技术评级，正式技术面展示优先使用该来源。
    const externalTechnical = this.enrichExternalTechnicalConfidence(
      await externalTechnicalDataProvider.getTradingViewTechnicalSnapshot(code, market),
      indicators,
      currentPrice
    )
    const technicalAdvice = technicalAdviceModelRegistry.evaluateTradingViewRatings(externalTechnical)
    const fundamentalSnapshot = await fundamentalDataProvider.getEastmoneyFundamentalSnapshot(code, market)

    let realtimeData = null
    try {
      realtimeData = await getStockRealtime(code)
    } catch (error) {
      console.warn(`Failed to get realtime data for ${code}:`, error)
    }
    const stockName = realtimeData?.name || priceHistory.find((item) => item.name)?.name || this.getStockName(code)
    const newsSnapshot = await newsDataProvider.getEastmoneyNewsSnapshot(code, stockName)

    const factSet = stockAnalysisFactSetBuilder.buildTechnicalFactSet({
      symbol: code,
      market,
      externalTechnical,
      localIndicators: indicators,
      technicalAdvice,
      fundamentalSnapshot,
      newsSnapshot,
    })
    const analysisSummary = stockAnalysisSummaryService.buildSummary(factSet, technicalAdvice)

    // 5. 计算成交额
    const turnover = volumes.reduce((a, b) => a + b, 0) * currentPrice

    // 6. 生成技术事实说明。本地计算只用于审计展示，不生成买卖建议。
    const recommendation = this.generateEvidenceBasedRecommendation(indicators, priceChangePercent, externalTechnical, technicalAdvice)

    // 7. 组装完整分析结果
    return {
      code,
      name: stockName,
      currentPrice: Math.round(currentPrice * 100) / 100,
      priceChange: Math.round(priceChange * 100) / 100,
      priceChangePercent: Math.round(priceChangePercent * 100) / 100,
      volume: volumes[volumes.length - 1] ?? 0,
      turnover,
      highestPrice: Math.max(...closes),
      lowestPrice: Math.min(...closes),
      averagePrice: closes.reduce((a, b) => a + b, 0) / closes.length,
      currency: this.getCurrency(market),
      analysisTime: new Date().toISOString(),
      recommendation,
      externalTechnical,
      technicalAdvice,
      factSet,
      fundamentalSnapshot,
      newsSnapshot,
      analysisSummary,
      peRatio: fundamentalSnapshot.metrics.peDynamic,
      pbRatio: fundamentalSnapshot.metrics.pb,
      ...indicators
    }
  }

  private async readCachedAnalysis(
    symbol: string,
    market: string,
    days: number,
    options: StockAnalysisOptions
  ): Promise<StockAnalysis | null> {
    const cache = await prisma.stockFactSetCache.findUnique({
      where: {
        symbol_market_factsetType_factsetSchemaVersion_lookbackDays_timeframe: {
          symbol,
          market,
          factsetType: this.factsetType,
          factsetSchemaVersion: this.factsetSchemaVersion,
          lookbackDays: days,
          timeframe: this.timeframe,
        },
      },
    })
    if (!cache || !['fresh', 'stale', 'partial'].includes(cache.status)) return null
    const analysis = this.parseJson<StockAnalysis | null>(cache.analysisJson, null)
    if (!analysis) return null

    const isFresh = cache.status === 'fresh' && cache.nextRefreshAfter.getTime() > Date.now()
    if (!isFresh && !options.skipBackgroundRefresh) {
      await prisma.stockFactSetCache.update({
        where: { id: cache.id },
        data: { status: 'stale' },
      }).catch(() => undefined)
      this.triggerBackgroundRefresh(symbol, market, days, options)
    }

    return {
      ...analysis,
      cache: {
        status: isFresh ? 'fresh' : 'stale',
        refreshed: false,
        generatedAt: cache.generatedAt.toISOString(),
        staleAt: cache.staleAt.toISOString(),
        nextRefreshAfter: cache.nextRefreshAfter.toISOString(),
        lookbackDays: cache.lookbackDays,
        timeframe: cache.timeframe,
        warnings: this.parseJson<string[]>(cache.warningsJson, []),
      },
    }
  }

  private triggerBackgroundRefresh(symbol: string, market: string, days: number, options: StockAnalysisOptions) {
    const key = `${symbol}:${market}:${this.factsetType}:${days}:${this.timeframe}`
    if (this.backgroundRefreshKeys.has(key)) return
    this.backgroundRefreshKeys.add(key)
    setTimeout(() => {
      this.buildFullAnalysis(symbol, market, days)
        .then((analysis) => this.writeCachedAnalysis(analysis, market, days, options.cacheTtlMs))
        .catch((error) => this.writeFailedCache(symbol, market, days, error))
        .finally(() => {
          this.backgroundRefreshKeys.delete(key)
        })
    }, 0)
  }

  private async writeCachedAnalysis(
    analysis: StockAnalysis,
    market: string,
    days: number,
    cacheTtlMs = this.defaultCacheTtlMs
  ): Promise<StockAnalysis> {
    const protectedAnalysis = await this.protectFundamentalCoverageOnRefresh(analysis, market)
    const now = new Date()
    const staleAt = new Date(now.getTime() + cacheTtlMs)
    const warnings = [...new Set([
      ...protectedAnalysis.externalTechnical.warnings,
      ...protectedAnalysis.factSet.technical.warnings,
      ...protectedAnalysis.factSet.fundamental.warnings,
      ...protectedAnalysis.factSet.news.warnings,
      ...protectedAnalysis.fundamentalSnapshot.warnings,
      ...protectedAnalysis.newsSnapshot.warnings,
      ...protectedAnalysis.analysisSummary.blockedReasons,
    ])]
    const evidenceRefs = [
      ...protectedAnalysis.factSet.technical.facts.map((fact) => `stock-fact:${protectedAnalysis.code}:technical:${fact.id}`),
      ...protectedAnalysis.factSet.fundamental.facts.map((fact) => `stock-fact:${protectedAnalysis.code}:fundamental:${fact.id}`),
      ...protectedAnalysis.factSet.news.facts.map((fact) => `stock-fact:${protectedAnalysis.code}:news:${fact.id}`),
    ]
    const providerTrace = {
      externalTechnical: {
        provider: protectedAnalysis.externalTechnical.provider,
        providerLabel: protectedAnalysis.externalTechnical.providerLabel,
        providerSymbol: protectedAnalysis.externalTechnical.providerSymbol,
        quality: protectedAnalysis.externalTechnical.quality,
        confidence: protectedAnalysis.externalTechnical.confidence,
        asOf: protectedAnalysis.externalTechnical.asOf,
      },
      fundamental: {
        providerLabel: protectedAnalysis.fundamentalSnapshot.providerLabel,
        quality: protectedAnalysis.fundamentalSnapshot.quality,
        asOf: protectedAnalysis.fundamentalSnapshot.asOf,
      },
      news: {
        providerLabel: protectedAnalysis.newsSnapshot.providerLabel,
        quality: protectedAnalysis.newsSnapshot.quality,
        asOf: protectedAnalysis.newsSnapshot.asOf,
      },
    }
    const analysisForCache = { ...protectedAnalysis, cache: undefined }

    await prisma.stockFactSetCache.upsert({
      where: {
        symbol_market_factsetType_factsetSchemaVersion_lookbackDays_timeframe: {
          symbol: analysis.code,
          market,
          factsetType: this.factsetType,
          factsetSchemaVersion: this.factsetSchemaVersion,
          lookbackDays: days,
          timeframe: this.timeframe,
        },
      },
      create: {
        assetId: await this.findAssetId(protectedAnalysis.code),
        symbol: protectedAnalysis.code,
        market,
        factsetType: this.factsetType,
        factsetSchemaVersion: this.factsetSchemaVersion,
        lookbackDays: days,
        timeframe: this.timeframe,
        status: 'fresh',
        summaryJson: JSON.stringify(protectedAnalysis.analysisSummary),
        factsJson: JSON.stringify(protectedAnalysis.factSet),
        analysisJson: JSON.stringify(analysisForCache),
        evidenceRefsJson: JSON.stringify(evidenceRefs),
        providerTraceJson: JSON.stringify(providerTrace),
        warningsJson: JSON.stringify(warnings),
        generatedAt: now,
        staleAt,
        nextRefreshAfter: staleAt,
      },
      update: {
        assetId: await this.findAssetId(protectedAnalysis.code),
        status: 'fresh',
        summaryJson: JSON.stringify(protectedAnalysis.analysisSummary),
        factsJson: JSON.stringify(protectedAnalysis.factSet),
        analysisJson: JSON.stringify(analysisForCache),
        evidenceRefsJson: JSON.stringify(evidenceRefs),
        providerTraceJson: JSON.stringify(providerTrace),
        warningsJson: JSON.stringify(warnings),
        generatedAt: now,
        staleAt,
        nextRefreshAfter: staleAt,
      },
    })

    return {
      ...protectedAnalysis,
      cache: {
        status: 'fresh',
        refreshed: true,
        generatedAt: now.toISOString(),
        staleAt: staleAt.toISOString(),
        nextRefreshAfter: staleAt.toISOString(),
        lookbackDays: days,
        timeframe: this.timeframe,
        warnings,
      },
    }
  }

  private async protectFundamentalCoverageOnRefresh(analysis: StockAnalysis, market: string): Promise<StockAnalysis> {
    const requiredFactIds = ['em_industry_board', 'em_total_market_cap', 'em_float_market_cap']
    const facts = analysis.factSet.fundamental.facts
    const hasIndustry = facts.some((fact) => fact.id === 'em_industry_board' && fact.quality === 'ok' && fact.value)
    const hasMarketCap = facts.some((fact) =>
      (fact.id === 'em_total_market_cap' || fact.id === 'em_float_market_cap') &&
      fact.quality === 'ok' &&
      typeof fact.value === 'number' &&
      fact.value > 0
    )
    if (hasIndustry && hasMarketCap) return analysis

    const previousCaches = await prisma.stockFactSetCache.findMany({
      where: {
        symbol: analysis.code,
        market,
        factsetType: this.factsetType,
        factsetSchemaVersion: this.factsetSchemaVersion,
        status: { in: ['fresh', 'stale', 'partial'] },
      },
      orderBy: { generatedAt: 'desc' },
      take: 8,
    })
    for (const cache of previousCaches) {
      const previous = this.parseJson<StockAnalysis['factSet'] | null>(cache.factsJson, null)
      const previousFacts = previous?.fundamental?.facts || []
      const previousHasIndustry = previousFacts.some((fact) => fact.id === 'em_industry_board' && fact.quality === 'ok' && fact.value)
      const previousHasMarketCap = previousFacts.some((fact) =>
        (fact.id === 'em_total_market_cap' || fact.id === 'em_float_market_cap') &&
        fact.quality === 'ok' &&
        typeof fact.value === 'number' &&
        fact.value > 0
      )
      if (!previousHasIndustry || !previousHasMarketCap) continue

      const previousById = new Map(previousFacts.filter((fact) => requiredFactIds.includes(fact.id)).map((fact) => [fact.id, fact]))
      const nextFacts = facts.map((fact) => {
        if (!requiredFactIds.includes(fact.id)) return fact
        const previousFact = previousById.get(fact.id)
        if (!previousFact) return fact
        const currentOk = fact.quality === 'ok' && fact.value
        return currentOk ? fact : {
          ...previousFact,
          source: `${previousFact.source} / previous-cache`,
        }
      })
      for (const [id, previousFact] of previousById.entries()) {
        if (!nextFacts.some((fact) => fact.id === id)) {
          nextFacts.push({ ...previousFact, source: `${previousFact.source} / previous-cache` })
        }
      }
      return {
        ...analysis,
        factSet: {
          ...analysis.factSet,
          fundamental: {
            ...analysis.factSet.fundamental,
            facts: nextFacts,
            warnings: [
              ...analysis.factSet.fundamental.warnings,
              `本次刷新未取得完整行业/市值事实，已保留 ${cache.generatedAt.toISOString()} 的上一版基础事实，禁止将本次缺失视为 provider 成功。`,
            ],
          },
        },
      }
    }
    return analysis
  }

  private async writeFailedCache(symbol: string, market: string, days: number, error: unknown) {
    const now = new Date()
    const nextRefreshAfter = new Date(now.getTime() + 10 * 60 * 1000)
    await prisma.stockFactSetCache.upsert({
      where: {
        symbol_market_factsetType_factsetSchemaVersion_lookbackDays_timeframe: {
          symbol,
          market,
          factsetType: this.factsetType,
          factsetSchemaVersion: this.factsetSchemaVersion,
          lookbackDays: days,
          timeframe: this.timeframe,
        },
      },
      create: {
        assetId: await this.findAssetId(symbol),
        symbol,
        market,
        factsetType: this.factsetType,
        factsetSchemaVersion: this.factsetSchemaVersion,
        lookbackDays: days,
        timeframe: this.timeframe,
        status: 'failed',
        summaryJson: JSON.stringify({ symbol, error: String(error) }),
        warningsJson: JSON.stringify([String(error)]),
        generatedAt: now,
        staleAt: now,
        nextRefreshAfter,
      },
      update: {
        status: 'failed',
        summaryJson: JSON.stringify({ symbol, error: String(error) }),
        warningsJson: JSON.stringify([String(error)]),
        staleAt: now,
        nextRefreshAfter,
      },
    })
  }

  /**
   * 仅获取技术指标
   * @param code 股票代码
   * @param market 市场类型
   * @param days 数据天数
   */
  async getIndicatorsOnly(code: string, _market: string = 'A股', days: number = 30): Promise<StockIndicators> {
    let priceHistory: Array<{ closePrice: number; highPrice: number; lowPrice: number; volume: number }> = []

    try {
      // 使用 stockUtils 获取真实历史数据
      const historyData = await getStockHistory(code, days)

      if (historyData && historyData.length > 0) {
        priceHistory = historyData.map(h => ({
          closePrice: h.close,
          highPrice: h.high,
          lowPrice: h.low,
          volume: h.volume
        }))
      }
    } catch (error) {
      console.error(`Failed to get stock history for ${code}:`, error)
    }

    if (!priceHistory || priceHistory.length === 0) {
      throw new Error(`无法获取 ${code} 的价格数据`)
    }

    const closes = priceHistory.map(p => p.closePrice)
    const highs = priceHistory.map(p => p.highPrice)
    const lows = priceHistory.map(p => p.lowPrice)

    return this.calculateIndicators(closes, highs, lows)
  }

  /**
   * 计算技术指标
   * @param closes 收盘价数组
   * @param highs 最高价数组
   * @param lows 最低价数组
   */
  private calculateIndicators(closes: number[], highs: number[], lows: number[]): StockIndicators {
    const bars = closes.map((closePrice, index) => ({
      timestamp: new Date(Date.now() - (closes.length - index) * 24 * 60 * 60 * 1000),
      closePrice,
      highPrice: highs[index],
      lowPrice: lows[index],
      source: 'stock_history',
    }))
    const snapshot = technicalIndicatorService.buildSnapshotFromBars({ bars })
    if (snapshot.quality !== 'ok') {
      throw new Error(snapshot.warnings[0] || '技术指标样本不足')
    }

    const ma5 = snapshot.indicators.ma5.value
    const ma10 = snapshot.indicators.ma10.value
    const ma20 = snapshot.indicators.ma20.value
    const rsi = snapshot.indicators.rsi14.value
    const macd = snapshot.indicators.macd.value
    const boll = snapshot.indicators.boll20.value
    const atr = snapshot.indicators.atr14.value
    const supportResistance = snapshot.indicators.supportResistance20.value
    if (!ma5 || !ma10 || !ma20 || typeof rsi !== 'number' || !macd || !boll || typeof atr !== 'number' || !supportResistance) {
      throw new Error('技术指标样本不足，不能生成完整股票技术分析')
    }

    // KDJ
    const kdj = technicalService.calculateKDJ(highs, lows, closes)

    // 波动率
    const volatility = technicalService.calculateVolatility(closes)

    // 趋势
    const trend = technicalService.determineTrend(ma5, ma10, ma20, closes[closes.length - 1])

    return {
      ma5: Math.round(ma5 * 100) / 100,
      ma10: Math.round(ma10 * 100) / 100,
      ma20: Math.round(ma20 * 100) / 100,
      rsi: Math.round(rsi * 100) / 100,
      macd: {
        dif: macd.dif,
        dea: macd.dea,
        macdHist: macd.hist
      },
      boll: {
        upper: Math.round(boll.upper * 100) / 100,
        middle: Math.round(boll.middle * 100) / 100,
        lower: Math.round(boll.lower * 100) / 100
      },
      kdj: {
        k: Math.round(kdj.k * 100) / 100,
        d: Math.round(kdj.d * 100) / 100,
        j: Math.round(kdj.j * 100) / 100
      },
      atr: Math.round(atr * 10000) / 10000,
      volatility: Math.round(volatility * 100) / 100,
      supportResistance: {
        support: Math.round(supportResistance.support * 100) / 100,
        resistance: Math.round(supportResistance.resistance * 100) / 100
      },
      trend
    }
  }

  private generateEvidenceBasedRecommendation(
    indicators: StockIndicators,
    priceChangePercent: number,
    externalTechnical?: ExternalTechnicalSnapshot,
    technicalAdvice?: TechnicalAdviceModelOutput
  ): string {
    const externalLine = externalTechnical?.quality === 'ok' && externalTechnical.rating
      ? `外部技术评级：综合=${externalTechnical.rating.all}，均线=${externalTechnical.rating.ma}，振荡器=${externalTechnical.rating.oscillator}，来源=${externalTechnical.providerLabel}。`
      : `外部技术评级暂不可用：${externalTechnical?.warnings?.[0] || '未获取到外部指标'}。`
    const lines = [
      externalLine,
      technicalAdvice?.status === 'available'
        ? `技术建议模型：${technicalAdvice.summary}；${technicalAdvice.actionBoundary}`
        : `技术建议模型已阻断：${technicalAdvice?.blockedReasons?.join('；') || '未运行'}。`,
      `技术面当前仅展示审计事实，不构成买卖建议；正式建议需要接入外部成熟K线/指标源和已验证策略模型。`,
      `本地复核指标：趋势=${indicators.trend}，RSI14=${indicators.rsi.toFixed(2)}，MACD柱=${indicators.macd.macdHist.toFixed(4)}。`,
      `均线：MA5=${indicators.ma5.toFixed(2)}，MA10=${indicators.ma10.toFixed(2)}，MA20=${indicators.ma20.toFixed(2)}；近一日涨跌=${priceChangePercent.toFixed(2)}%。`,
      `区间参考：支撑=${indicators.supportResistance.support.toFixed(2)}，压力=${indicators.supportResistance.resistance.toFixed(2)}，ATR14=${indicators.atr.toFixed(4)}。`,
    ]
    if (indicators.rsi > 70) {
      lines.push('RSI14 处于超买区，只作为风险观察事实；未接入可靠模型前不能据此生成卖出建议。')
    } else if (indicators.rsi < 30) {
      lines.push('RSI14 处于超卖区，只作为风险观察事实；未接入可靠模型前不能据此生成买入建议。')
    } else {
      lines.push('RSI14 处于中性区；后续必须结合外部模型、基本面、消息面和持仓约束再生成建议。')
    }
    return lines.join('\n')
  }

  private enrichExternalTechnicalConfidence(
    snapshot: ExternalTechnicalSnapshot,
    indicators: StockIndicators,
    currentPrice: number
  ): ExternalTechnicalSnapshot {
    const checks: ExternalTechnicalConfidenceCheck[] = [...snapshot.confidence.checks]
    const pushDeltaCheck = (
      name: string,
      label: string,
      externalValue: number | undefined,
      auditValue: number,
      passThreshold: number,
      warnThreshold: number
    ) => {
      if (externalValue === undefined || !Number.isFinite(auditValue) || auditValue <= 0) {
        checks.push({
          name,
          status: 'warn',
          detail: `${label} 缺少可对账字段。`,
        })
        return
      }
      const denominator = Math.max(Math.abs(auditValue), 0.000001)
      const deltaPercent = Math.abs((externalValue - auditValue) / denominator) * 100
      checks.push({
        name,
        status: deltaPercent <= passThreshold ? 'pass' : deltaPercent <= warnThreshold ? 'warn' : 'fail',
        detail: `${label} 外部值 ${externalValue.toFixed(4)}，K线复核值 ${auditValue.toFixed(4)}，差异 ${deltaPercent.toFixed(2)}%。`,
        deltaPercent: Math.round(deltaPercent * 100) / 100,
      })
    }

    pushDeltaCheck('close_cross_source', '收盘价', snapshot.indicators.close, currentPrice, 1.5, 3)
    pushDeltaCheck('sma20_cross_source', 'SMA20', snapshot.indicators.sma20, indicators.ma20, 2, 5)
    pushDeltaCheck('rsi14_cross_source', 'RSI14', snapshot.indicators.rsi14, indicators.rsi, 8, 15)

    if (snapshot.indicators.macdHistogram === undefined) {
      checks.push({
        name: 'macd_direction_cross_source',
        status: 'warn',
        detail: 'MACD 缺少可对账字段。',
      })
    } else {
      const externalDirection = Math.sign(snapshot.indicators.macdHistogram)
      const auditDirection = Math.sign(indicators.macd.macdHist)
      checks.push({
        name: 'macd_direction_cross_source',
        status: externalDirection === 0 || auditDirection === 0 || externalDirection === auditDirection ? 'pass' : 'warn',
        detail: `MACD 方向外部=${externalDirection}, K线复核=${auditDirection}。`,
      })
    }

    let score = snapshot.quality === 'ok' ? 62 : 15
    if (snapshot.rating) score += 8
    const usableIndicatorCount = Object.values(snapshot.indicators).filter((value) => typeof value === 'number' && Number.isFinite(value)).length
    score += Math.min(10, usableIndicatorCount)
    for (const check of checks) {
      if (check.status === 'pass') score += 4
      if (check.status === 'warn') score -= 2
      if (check.status === 'fail') score -= 10
    }
    score = Math.max(0, Math.min(95, Math.round(score)))

    const sourceCount = checks.some((check) => check.name.includes('cross_source')) ? 2 : snapshot.confidence.sourceCount
    return {
      ...snapshot,
      confidence: {
        score,
        level: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low',
        sourceCount,
        checks,
      },
      warnings: [
        ...snapshot.warnings,
        ...(score < 60 ? ['外部技术指标与K线复核结果一致性不足，禁止生成技术面建议。'] : []),
      ],
    }
  }

  /**
   * 获取股票名称（简化版，实际应从数据源获取）
   */
  private getStockName(code: string): string {
    // 实际应调用数据源获取，这里返回代码作为占位
    return `股票-${code}`
  }

  /**
   * 获取市场对应货币
   */
  private getCurrency(market: string): string {
    const currencyMap: Record<string, string> = {
      'A股': 'CNY',
      '美股': 'USD',
      '港股': 'HKD',
      '指数': 'CNY'
    }
    return currencyMap[market] ?? 'CNY'
  }

  private normalizeSymbol(symbol: string): string {
    return String(symbol || '').trim().toUpperCase()
  }

  private async findAssetId(symbol: string): Promise<string | null> {
    const asset = await prisma.asset.findUnique({
      where: { symbol },
      select: { id: true },
    })
    return asset?.id ?? null
  }

  private parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }
}

export const stockAnalysisService = new StockAnalysisService()
