import { postJson } from '../../utils/httpJson.js'

export type ExternalTechnicalQuality = 'ok' | 'provider_failed' | 'unsupported_market' | 'missing_data'

export interface ExternalTechnicalIndicators {
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

export interface ExternalTechnicalRating {
  allScore?: number
  maScore?: number
  oscillatorScore?: number
  all: string
  ma: string
  oscillator: string
}

export interface ExternalTechnicalConfidenceCheck {
  name: string
  status: 'pass' | 'warn' | 'fail'
  detail: string
  deltaPercent?: number
}

export interface ExternalTechnicalConfidence {
  score: number
  level: 'high' | 'medium' | 'low'
  sourceCount: number
  checks: ExternalTechnicalConfidenceCheck[]
}

export interface ExternalTechnicalSnapshot {
  provider: 'tradingview'
  providerLabel: string
  providerSymbol: string | null
  sourceUrl: string
  asOf: string
  quality: ExternalTechnicalQuality
  model: {
    name: string
    version: string
    description: string
  }
  rating: ExternalTechnicalRating | null
  indicators: ExternalTechnicalIndicators
  confidence: ExternalTechnicalConfidence
  warnings: string[]
}

interface TradingViewScanResponse {
  totalCount?: number
  data?: Array<{ s?: string; d?: Array<number | null> }>
}

const TRADINGVIEW_COLUMNS = [
  'Recommend.All',
  'Recommend.MA',
  'Recommend.Other',
  'RSI',
  'MACD.macd',
  'MACD.signal',
  'Stoch.K',
  'Stoch.D',
  'BB.upper',
  'BB.lower',
  'ATR',
  'close',
  'volume',
  'change',
  'SMA5',
  'SMA10',
  'SMA20',
] as const

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function ratingLabel(score?: number) {
  if (score === undefined) return '暂无'
  if (score <= -0.5) return '强烈卖出'
  if (score <= -0.1) return '卖出'
  if (score < 0.1) return '中性'
  if (score < 0.5) return '买入'
  return '强烈买入'
}

function confidence(score: number, sourceCount: number, checks: ExternalTechnicalConfidenceCheck[]): ExternalTechnicalConfidence {
  return {
    score,
    level: score >= 80 ? 'high' : score >= 60 ? 'medium' : 'low',
    sourceCount,
    checks,
  }
}

function resolveTradingViewSymbol(code: string, market: string) {
  const normalized = code.trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
  if (market !== 'A股' && market !== 'CN') return null
  if (/^(60|68|90)\d{4}$/.test(normalized)) return `SSE:${normalized}`
  if (/^(00|30|20)\d{4}$/.test(normalized)) return `SZSE:${normalized}`
  if (/^(8|4|9)\d{5}$/.test(normalized)) return `BSE:${normalized}`
  return null
}

class ExternalTechnicalDataProvider {
  async getTradingViewTechnicalSnapshot(code: string, market = 'A股'): Promise<ExternalTechnicalSnapshot> {
    const providerSymbol = resolveTradingViewSymbol(code, market)
    const base: Omit<ExternalTechnicalSnapshot, 'quality' | 'rating' | 'indicators' | 'confidence' | 'warnings'> = {
      provider: 'tradingview',
      providerLabel: 'TradingView Scanner',
      providerSymbol,
      sourceUrl: 'https://scanner.tradingview.com/china/scan',
      asOf: new Date().toISOString(),
      model: {
        name: 'TradingView Technical Ratings',
        version: 'scanner.Recommend.All/MA/Other',
        description: '外部技术评级模型，聚合均线组和振荡器组。FAMS 只展示评级和指标，不把它直接包装成买卖建议。',
      },
    }

    if (!providerSymbol) {
      return {
        ...base,
        quality: 'unsupported_market',
        rating: null,
        indicators: {},
        confidence: confidence(0, 0, [{
          name: 'provider_symbol',
          status: 'fail',
          detail: '标的无法映射到 TradingView 中国市场代码。',
        }]),
        warnings: [`${market} ${code} 暂不支持 TradingView 中国市场技术指标。`],
      }
    }

    try {
      const response = await postJson<TradingViewScanResponse>(
        'https://scanner.tradingview.com/china/scan',
        {
          symbols: {
            tickers: [providerSymbol],
            query: { types: [] },
          },
          columns: TRADINGVIEW_COLUMNS,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Referer: 'https://www.tradingview.com/',
            'User-Agent': 'Mozilla/5.0',
          },
          timeout: 8000,
        }
      )

      const row = response.data?.[0]
      const values = row?.d || []
      if (!row || values.length === 0) {
        return {
          ...base,
          quality: 'missing_data',
          rating: null,
          indicators: {},
          confidence: confidence(20, 1, [{
            name: 'tradingview_response',
            status: 'fail',
            detail: 'TradingView 返回为空。',
          }]),
          warnings: [`TradingView 未返回 ${providerSymbol} 的技术指标。`],
        }
      }

      const allScore = finite(values[0])
      const maScore = finite(values[1])
      const oscillatorScore = finite(values[2])
      const macd = finite(values[4])
      const macdSignal = finite(values[5])

      return {
        ...base,
        providerSymbol: row.s || providerSymbol,
        quality: 'ok',
        rating: {
          allScore,
          maScore,
          oscillatorScore,
          all: ratingLabel(allScore),
          ma: ratingLabel(maScore),
          oscillator: ratingLabel(oscillatorScore),
        },
        indicators: {
          rsi14: finite(values[3]),
          macd,
          macdSignal,
          macdHistogram: macd !== undefined && macdSignal !== undefined ? macd - macdSignal : undefined,
          stochK: finite(values[6]),
          stochD: finite(values[7]),
          bollUpper: finite(values[8]),
          bollLower: finite(values[9]),
          atr14: finite(values[10]),
          close: finite(values[11]),
          volume: finite(values[12]),
          changePercent: finite(values[13]),
          sma5: finite(values[14]),
          sma10: finite(values[15]),
          sma20: finite(values[16]),
        },
        confidence: confidence(70, 1, [{
          name: 'tradingview_response',
          status: 'pass',
          detail: 'TradingView Scanner 返回技术评级和指标。',
        }]),
        warnings: [],
      }
    } catch (error) {
      return {
        ...base,
        quality: 'provider_failed',
        rating: null,
        indicators: {},
        confidence: confidence(0, 0, [{
          name: 'tradingview_response',
          status: 'fail',
          detail: 'TradingView 请求失败。',
        }]),
        warnings: [`TradingView 技术指标获取失败：${error instanceof Error ? error.message : String(error)}`],
      }
    }
  }
}

export const externalTechnicalDataProvider = new ExternalTechnicalDataProvider()
