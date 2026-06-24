import type { KLineData } from '../components/charts'
import { API_BASE } from '../config/api'

export interface StockAnalysisResponse {
  stock_code: string
  stock_name: string
  market: string
  current_price: number
  price_change: number
  price_change_percent: number
  volume: number
  turnover: number
  ma5: number
  ma10: number
  ma20: number
  rsi: number
  volatility: number
  highest_price: number
  lowest_price: number
  average_price: number
  trend: string
  recommendation: string
  currency: string
  analysis_time: string
  pe_ratio?: number
  pb_ratio?: number
  roe?: number
  macd_dif?: number
  macd_dea?: number
  macd_histogram?: number
  boll_upper?: number
  boll_middle?: number
  boll_lower?: number
  kdj_k?: number
  kdj_d?: number
  kdj_j?: number
  atr?: number
  support?: number
  resistance?: number
  external_technical?: {
    provider: string
    providerLabel: string
    providerSymbol: string | null
    sourceUrl: string
    asOf: string
    quality: string
    model: {
      name: string
      version: string
      description: string
    }
    rating: null | {
      allScore?: number
      maScore?: number
      oscillatorScore?: number
      all: string
      ma: string
      oscillator: string
    }
    confidence: {
      score: number
      level: 'high' | 'medium' | 'low'
      sourceCount: number
      checks: Array<{
        name: string
        status: 'pass' | 'warn' | 'fail'
        detail: string
        deltaPercent?: number
      }>
    }
    indicators: {
      close?: number
      changePercent?: number
      volume?: number
      rsi14?: number
      macd?: number
      macdSignal?: number
      macdHistogram?: number
      stochK?: number
      stochD?: number
      bollUpper?: number
      bollLower?: number
      atr14?: number
      sma5?: number
      sma10?: number
      sma20?: number
    }
    warnings: string[]
  }
  technical_advice?: {
    status: 'available' | 'blocked'
    stance: 'constructive' | 'neutral' | 'defensive' | 'avoid_chase' | 'insufficient_data'
    summary: string
    observation: string
    risk: string
    actionBoundary: string
    model: {
      id: string
      name: string
      version: string
      source: string
      confidenceGate: number
    }
    evidence: Array<{
      id: string
      label: string
      value: string
      source: string
    }>
    blockedReasons: string[]
  }
  fact_set?: {
    schemaVersion: string
    symbol: string
    market: string
    generatedAt: string
    technical: StockAnalysisFactSection
    fundamental: StockAnalysisFactSection
    news: StockAnalysisFactSection
  }
  fundamental_snapshot?: {
    providerLabel: string
    providerSymbol: string | null
    asOf: string
    quality: string
    metrics: {
      peDynamic?: number
      pb?: number
      totalMarketCap?: number
      floatMarketCap?: number
      latestPrice?: number
    }
    financialReports: Array<{
      reportDate: string
      reportName: string
      noticeDate?: string
      currency?: string
      operatingRevenue?: number
      operatingRevenueYoY?: number
      parentNetProfit?: number
      parentNetProfitYoY?: number
      roeWeighted?: number
      grossMargin?: number
      netMargin?: number
      debtAssetRatio?: number
      operatingCashFlow?: number
      operatingCashFlowToRevenue?: number
      basicEps?: number
    }>
    financialCrossCheck?: {
      providerLabel: string
      reportName: string
      asOf: string
      quality: 'ok' | 'warn' | 'failed' | 'missing_data'
      matchedReportDate?: string
      checks: Array<{
        id: string
        label: string
        primaryValue?: number
        crossValue?: number
        deltaPercent?: number
        status: 'pass' | 'warn' | 'fail' | 'missing'
      }>
      warnings: string[]
    }
    independentFinancialCrossCheck?: {
      providerLabel: string
      reportName: string
      asOf: string
      quality: 'ok' | 'warn' | 'failed' | 'missing_data'
      matchedReportDate?: string
      checks: Array<{
        id: string
        label: string
        primaryValue?: number
        crossValue?: number
        deltaPercent?: number
        status: 'pass' | 'warn' | 'fail' | 'missing'
      }>
      warnings: string[]
    }
    officialAnnouncement?: {
      providerLabel: string
      sourceUrl: string
      asOf: string
      quality: 'located' | 'missing_data' | 'provider_failed'
      title?: string
      disclosureDate?: string
      reportDate?: string
      reportName?: string
      pdfUrl?: string
      warnings: string[]
    }
    industryComparison?: {
      boardCode: string
      boardName: string
      asOf: string
      sampleSize: number
      metrics: {
        peDynamicPercentile?: number
        pbPercentile?: number
        totalMarketCapPercentile?: number
        roePercentile?: number
        debtAssetRatioPercentile?: number
      }
      warnings: string[]
    }
    warnings: string[]
  }
  news_snapshot?: {
    providerLabel: string
    asOf: string
    quality: string
    events: Array<{
      id: string
      title: string
      summary: string
      source: string
      publishedAt: string
      url: string
      eventType: string
      sentiment: 'positive' | 'neutral' | 'negative'
      relevance: number
    }>
    warnings: string[]
  }
  analysis_summary?: {
    schemaVersion: string
    generatedAt: string
    overallStatus: 'partial' | 'blocked'
    technical: StockAnalysisSummarySection
    fundamental: StockAnalysisSummarySection
    news: StockAnalysisSummarySection
    blockedReasons: string[]
  }
  cache?: {
    status: 'fresh' | 'stale' | 'generating' | 'failed' | 'partial'
    refreshed: boolean
    generatedAt: string
    staleAt: string
    nextRefreshAfter: string
    warnings: string[]
  }
}

export interface StockAnalysisSummarySection {
  status: 'available' | 'partial' | 'blocked'
  summary: string
  evidenceRefs: string[]
  blockedReasons: string[]
}

export interface StockAnalysisFactSection {
  quality: 'ok' | 'insufficient_data' | 'provider_failed'
  facts: Array<{
    id: string
    section: 'technical' | 'fundamental' | 'news'
    label: string
    value: string | number | null
    source: string
    asOf: string | null
    quality: 'ok' | 'insufficient_data' | 'provider_failed'
    evidenceType: string
  }>
  warnings: string[]
}

export interface FinancialQuarter {
  quarter: string
  revenue?: number
  netProfit?: number
  grossMargin?: number
  roe?: number
  debtRatio?: number
  operatingCashFlow?: number
  researchExpense?: number
}

export interface FinancialResponse {
  stock_code: string
  quarters: FinancialQuarter[]
}

export async function getStockAnalysis(stockCode: string, market: string = 'A股'): Promise<StockAnalysisResponse> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/stocks/${stockCode}?market=${encodeURIComponent(market)}`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)

    const data = await response.json()

    // 映射后端字段名到前端期望的格式
    return {
      stock_code: data.code,
      stock_name: data.name,
      market: market,
      current_price: data.currentPrice,
      price_change: data.priceChange,
      price_change_percent: data.priceChangePercent,
      volume: data.volume,
      turnover: data.turnover,
      ma5: data.ma5,
      ma10: data.ma10,
      ma20: data.ma20,
      rsi: data.rsi,
      volatility: data.volatility,
      highest_price: data.highestPrice,
      lowest_price: data.lowestPrice,
      average_price: data.averagePrice,
      trend: data.trend,
      recommendation: data.recommendation,
      currency: data.currency,
      analysis_time: data.analysisTime,
      pe_ratio: data.peRatio,
      pb_ratio: data.pbRatio,
      macd_dif: data.macd?.dif,
      macd_dea: data.macd?.dea,
      macd_histogram: data.macd?.macdHist,
      boll_upper: data.boll?.upper,
      boll_middle: data.boll?.middle,
      boll_lower: data.boll?.lower,
      kdj_k: data.kdj?.k,
      kdj_d: data.kdj?.d,
      kdj_j: data.kdj?.j,
      atr: data.atr,
      support: data.supportResistance?.support,
      resistance: data.supportResistance?.resistance,
      external_technical: data.externalTechnical,
      technical_advice: data.technicalAdvice,
      fact_set: data.factSet,
      fundamental_snapshot: data.fundamentalSnapshot,
      news_snapshot: data.newsSnapshot,
      analysis_summary: data.analysisSummary,
      cache: data.cache,
    }
  } catch (error) {
    console.error('Stock analysis API failed:', error)
    throw error
  }
}

// Commented out - currently unused but kept for future reference
// function getMockStockAnalysis(stockCode: string): StockAnalysisResponse {
//   const stockName = stockCode.startsWith('6') ? '贵州茅台' : stockCode.startsWith('0') ? '平安银行' : '比亚迪'
//   const basePrice = stockCode.startsWith('6') ? 1680.0 : stockCode.startsWith('0') ? 12.5 : 280.0
//
//   return {
//     stock_code: stockCode,
//     stock_name: stockName,
//     market: stockCode.startsWith('6') ? '上证' : stockCode.startsWith('0') ? '深证' : '创业板',
//     current_price: basePrice,
//     price_change: basePrice * 0.023,
//     price_change_percent: 2.34,
//     volume: 45678900,
//     turnover: 7654321000,
//     ma5: basePrice * 0.98,
//     ma10: basePrice * 0.96,
//     ma20: basePrice * 0.94,
//     rsi: 58.6,
//     volatility: 0.025,
//     highest_price: basePrice * 1.05,
//     lowest_price: basePrice * 0.92,
//     average_price: basePrice * 0.99,
//     trend: '上涨',
//     recommendation: '顺势而为，建议持有。RSI指标处于强势区域，MACD金叉形成，可考虑加仓。',
//     currency: 'CNY',
//     analysis_time: new Date().toISOString(),
//     pe_ratio: stockCode.startsWith('6') ? 32.5 : stockCode.startsWith('0') ? 8.2 : 45.8,
//     pb_ratio: stockCode.startsWith('6') ? 12.8 : stockCode.startsWith('0') ? 0.85 : 6.5,
//     roe: stockCode.startsWith('6') ? 28.5 : stockCode.startsWith('0') ? 10.2 : 15.8,
//     macd_dif: 0.45,
//     macd_dea: 0.32,
//     macd_histogram: 0.26,
//     boll_upper: basePrice * 1.04,
//     boll_middle: basePrice,
//     boll_lower: basePrice * 0.96,
//     kdj_k: 65.5,
//     kdj_d: 62.3,
//     kdj_j: 72.0,
//     atr: 3.25,
//     support: basePrice * 0.92,
//     resistance: basePrice * 1.05,
//   }
// }

export async function getFinancialData(stockCode: string): Promise<FinancialResponse> {
  try {
    const response = await fetch(`${API_BASE}/financial/${stockCode}`)
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`)
    return response.json()
  } catch (error) {
    console.warn('Financial API not available, using mock data:', error)
    return {
      stock_code: stockCode,
      quarters: [
        { quarter: '2024Q3', revenue: 892.56, netProfit: 125.34, grossMargin: 35.2, roe: 8.5, debtRatio: 45.2, operatingCashFlow: 98.5, researchExpense: 45.2 },
        { quarter: '2024Q2', revenue: 876.23, netProfit: 118.45, grossMargin: 34.8, roe: 8.1, debtRatio: 44.8, operatingCashFlow: 105.3, researchExpense: 43.8 },
        { quarter: '2024Q1', revenue: 845.67, netProfit: 108.92, grossMargin: 33.5, roe: 7.6, debtRatio: 46.2, operatingCashFlow: 88.7, researchExpense: 42.5 },
        { quarter: '2023Q4', revenue: 912.34, netProfit: 132.56, grossMargin: 36.2, roe: 9.2, debtRatio: 43.5, operatingCashFlow: 115.2, researchExpense: 46.8 },
        { quarter: '2023Q3', revenue: 865.45, netProfit: 115.78, grossMargin: 34.9, roe: 8.0, debtRatio: 44.2, operatingCashFlow: 95.6, researchExpense: 44.2 },
      ]
    }
  }
}

// Generate mock K-line data for chart display (from analysis response)
export function generateKLineDataFromAnalysis(analysis: StockAnalysisResponse, days: number = 90): KLineData[] {
  const data: KLineData[] = []
  const basePrice = analysis.current_price

  for (let i = 0; i < days; i++) {
    const date = new Date()
    date.setDate(date.getDate() - (days - i))
    const dateStr = date.toISOString().split('T')[0]

    const volatility = analysis.volatility || 0.03
    const change = (Math.random() - 0.5) * 2 * volatility
    const open = basePrice
    const close = basePrice * (1 + change)
    const high = Math.max(open, close) * (1 + Math.random() * 0.015)
    const low = Math.min(open, close) * (1 - Math.random() * 0.015)
    const volume = Math.floor(Math.random() * 80000) + 20000

    data.push({ date: dateStr, open, high, low, close, volume })
  }

  return data
}

// Generate mock MACD data from analysis (for chart display)
export interface MACDData {
  date: string
  dif: number
  dea: number
  macd: number
}

// LLM 股票建议接口
export interface LLMEvidencePoint {
  id: string
  label: string
  value: string
  source: string
}

export interface LLMReasoningPoint {
  title: string
  detail: string
  evidenceRefs: string[]
}

export interface LLMStockAdvice {
  symbol: string
  name: string
  provider: 'minimax' | 'deepseek' | 'fallback'
  isAiGenerated: boolean
  status: 'available' | 'insufficient_data'
  observation: string
  confidence: string
  summary: string
  evidence: LLMEvidencePoint[]
  evidenceRefs: string[]
  reasoning: LLMReasoningPoint[]
  dataGaps: string[]
  riskWarning: string
  disclaimer: string
}

// 获取 LLM 股票分析建议
export async function getLLMStockAdvice(symbol: string, market: string = 'A股'): Promise<LLMStockAdvice> {
  try {
    const response = await fetch(`${API_BASE}/api/v1/llm/stock-advice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol, market })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.error || `HTTP error! status: ${response.status}`)
    return data
  } catch (error) {
    console.error('LLM Stock Advice API failed:', error)
    throw error
  }
}

export function generateMACDDataFromAnalysis(klineData: KLineData[]): MACDData[] {
  const data: MACDData[] = []
  let prevEma12 = klineData[0]?.close || 100
  let prevEma26 = klineData[0]?.close || 100

  for (let i = 0; i < klineData.length; i++) {
    const close = klineData[i].close
    const ema12 = (2 / 13) * close + (11 / 13) * prevEma12
    const ema26 = (2 / 27) * close + (25 / 26) * prevEma26
    const dif = ema12 - ema26
    const dea = (2 / 10) * dif + (8 / 10) * (data[i - 1]?.dea || dif)
    const macd = 2 * (dif - dea)

    data.push({
      date: klineData[i].date,
      dif,
      dea,
      macd,
    })

    prevEma12 = ema12
    prevEma26 = ema26
  }

  return data
}
