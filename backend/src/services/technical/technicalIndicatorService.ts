import { prisma } from '../../db/prisma.js'

export type IndicatorQuality = 'ok' | 'insufficient_data' | 'stale' | 'provider_failed'
export type IndicatorSource = 'local_fams' | 'external_provider' | 'local_fallback'

export interface TechnicalBar {
  timestamp: Date
  closePrice: number
  highPrice?: number | null
  lowPrice?: number | null
  openPrice?: number | null
  volume?: number | null
  source?: string | null
}

export interface IndicatorValue<T> {
  value: T | null
  quality: IndicatorQuality
  source: IndicatorSource
  sourceLabel?: string | null
  window: number
  sampleCount: number
  asOf: string | null
  warnings: string[]
}

export interface MacdValue {
  dif: number
  dea: number
  hist: number
}

export interface BollValue {
  upper: number
  middle: number
  lower: number
}

export interface SupportResistanceValue {
  support: number
  resistance: number
}

export interface TechnicalIndicatorSnapshot {
  schemaVersion: 'technical.indicators.v1'
  generatedAt: string
  assetId?: string
  symbol?: string
  rawSampleCount: number
  sampleCount: number
  asOf: string | null
  source: IndicatorSource
  sourceLabel: string | null
  quality: IndicatorQuality
  warnings: string[]
  indicators: {
    ma5: IndicatorValue<number>
    ma10: IndicatorValue<number>
    ma20: IndicatorValue<number>
    ma60: IndicatorValue<number>
    rsi14: IndicatorValue<number>
    macd: IndicatorValue<MacdValue>
    boll20: IndicatorValue<BollValue>
    atr14: IndicatorValue<number>
    volumeRatio20: IndicatorValue<number>
    supportResistance20: IndicatorValue<SupportResistanceValue>
  }
}

export interface TechnicalTradingSignal {
  type: 'buy' | 'sell' | 'hold'
  reason: string
  confidence: number
  indicator: string
  value: number
  sampleCount: number
  asOf: string | null
  source: IndicatorSource
  quality: IndicatorQuality
}

class TechnicalIndicatorService {
  /**
   * Local calculations are audit/fallback facts only. Formal technical advice
   * must come from an external K-line/indicator provider plus a validated model.
   */
  private round(value: number, precision = 4) {
    const factor = 10 ** precision
    return Math.round(value * factor) / factor
  }

  private asOf(bars: TechnicalBar[]) {
    return bars.length > 0 ? bars[bars.length - 1].timestamp.toISOString() : null
  }

  private sourceLabel(bars: TechnicalBar[]) {
    for (let i = bars.length - 1; i >= 0; i -= 1) {
      if (bars[i].source) return bars[i].source || null
    }
    return null
  }

  normalizeBars(bars: TechnicalBar[]) {
    const byDay = new Map<string, TechnicalBar>()
    for (const bar of bars) {
      if (!bar.timestamp || !Number.isFinite(bar.closePrice) || bar.closePrice <= 0) continue
      const day = bar.timestamp.toISOString().slice(0, 10)
      byDay.set(day, bar)
    }
    return Array.from(byDay.values()).sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
  }

  private insufficient<T>(
    window: number,
    sampleCount: number,
    asOf: string | null,
    sourceLabel: string | null,
    message: string
  ): IndicatorValue<T> {
    return {
      value: null,
      quality: 'insufficient_data',
      source: 'local_fams',
      sourceLabel,
      window,
      sampleCount,
      asOf,
      warnings: [message],
    }
  }

  private ok<T>(
    value: T,
    window: number,
    sampleCount: number,
    asOf: string | null,
    sourceLabel: string | null
  ): IndicatorValue<T> {
    return {
      value,
      quality: 'ok',
      source: 'local_fams',
      sourceLabel,
      window,
      sampleCount,
      asOf,
      warnings: [],
    }
  }

  private ma(values: number[], period: number) {
    if (values.length < period) return null
    const slice = values.slice(-period)
    return slice.reduce((sum, value) => sum + value, 0) / period
  }

  private emaSeries(values: number[], period: number) {
    if (values.length === 0) return []
    const multiplier = 2 / (period + 1)
    const result: number[] = [values[0]]
    for (let i = 1; i < values.length; i += 1) {
      result.push((values[i] - result[i - 1]) * multiplier + result[i - 1])
    }
    return result
  }

  private rsi(values: number[], period = 14) {
    if (values.length < period + 1) return null
    let gains = 0
    let losses = 0
    for (let i = 1; i <= period; i += 1) {
      const change = values[i] - values[i - 1]
      if (change >= 0) gains += change
      else losses -= change
    }
    let avgGain = gains / period
    let avgLoss = losses / period
    for (let i = period + 1; i < values.length; i += 1) {
      const change = values[i] - values[i - 1]
      avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period
      avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period
    }
    if (avgLoss === 0) return 100
    const rs = avgGain / avgLoss
    return 100 - (100 / (1 + rs))
  }

  private macd(values: number[], fast = 12, slow = 26, signal = 9): MacdValue | null {
    if (values.length < slow + signal) return null
    const emaFast = this.emaSeries(values, fast)
    const emaSlow = this.emaSeries(values, slow)
    const difSeries = values.map((_, index) => emaFast[index] - emaSlow[index])
    const deaSeries = this.emaSeries(difSeries, signal)
    const dif = difSeries[difSeries.length - 1]
    const dea = deaSeries[deaSeries.length - 1]
    return {
      dif: this.round(dif),
      dea: this.round(dea),
      hist: this.round(2 * (dif - dea)),
    }
  }

  private boll(values: number[], period = 20, multiplier = 2): BollValue | null {
    if (values.length < period) return null
    const slice = values.slice(-period)
    const middle = slice.reduce((sum, value) => sum + value, 0) / period
    const variance = slice.reduce((sum, value) => sum + ((value - middle) ** 2), 0) / period
    const std = Math.sqrt(variance)
    return {
      upper: this.round(middle + multiplier * std),
      middle: this.round(middle),
      lower: this.round(middle - multiplier * std),
    }
  }

  private atr(bars: TechnicalBar[], period = 14) {
    if (bars.length < period + 1) return null
    const trueRanges: number[] = []
    for (let i = 1; i < bars.length; i += 1) {
      const high = bars[i].highPrice ?? bars[i].closePrice
      const low = bars[i].lowPrice ?? bars[i].closePrice
      const prevClose = bars[i - 1].closePrice
      trueRanges.push(Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      ))
    }
    const slice = trueRanges.slice(-period)
    return slice.reduce((sum, value) => sum + value, 0) / period
  }

  private volumeRatio(bars: TechnicalBar[], period = 20) {
    const usable = bars.filter((bar) => Number.isFinite(bar.volume || 0) && (bar.volume || 0) > 0)
    if (usable.length < period + 2) return null
    const previous = usable.slice(-(period + 2), -2)
    const latestTwo = usable.slice(-2)
    const base = previous.reduce((sum, bar) => sum + (bar.volume || 0), 0) / period
    const recent = latestTwo.reduce((sum, bar) => sum + (bar.volume || 0), 0) / latestTwo.length
    return base > 0 ? recent / base : null
  }

  buildSnapshotFromBars(params: {
    assetId?: string
    symbol?: string
    bars: TechnicalBar[]
  }): TechnicalIndicatorSnapshot {
    const normalized = this.normalizeBars(params.bars)
    const closes = normalized.map((bar) => bar.closePrice)
    const sampleCount = normalized.length
    const asOf = this.asOf(normalized)
    const sourceLabel = this.sourceLabel(normalized)
    const warnings: string[] = []
    if (sampleCount < 20) {
      warnings.push(`有效交易日样本不足：${sampleCount} < 20，禁止生成技术面买卖信号。`)
    }

    const buildNumber = (period: number, name: string, compute: () => number | null) => {
      const value = compute()
      return value === null
        ? this.insufficient<number>(period, sampleCount, asOf, sourceLabel, `${name} 需要至少 ${period} 个有效交易日样本，当前 ${sampleCount}。`)
        : this.ok(this.round(value), period, sampleCount, asOf, sourceLabel)
    }

    const macd = this.macd(closes)
    const boll = this.boll(closes)
    const srValue = sampleCount >= 20
      ? {
        support: this.round(Math.min(...normalized.slice(-20).map((bar) => bar.lowPrice ?? bar.closePrice))),
        resistance: this.round(Math.max(...normalized.slice(-20).map((bar) => bar.highPrice ?? bar.closePrice))),
      }
      : null

    return {
      schemaVersion: 'technical.indicators.v1',
      generatedAt: new Date().toISOString(),
      assetId: params.assetId,
      symbol: params.symbol,
      rawSampleCount: params.bars.length,
      sampleCount,
      asOf,
      source: 'local_fams',
      sourceLabel,
      quality: sampleCount >= 20 ? 'ok' : 'insufficient_data',
      warnings,
      indicators: {
        ma5: buildNumber(5, 'MA5', () => this.ma(closes, 5)),
        ma10: buildNumber(10, 'MA10', () => this.ma(closes, 10)),
        ma20: buildNumber(20, 'MA20', () => this.ma(closes, 20)),
        ma60: buildNumber(60, 'MA60', () => this.ma(closes, 60)),
        rsi14: buildNumber(15, 'RSI14', () => this.rsi(closes, 14)),
        macd: macd
          ? this.ok(macd, 35, sampleCount, asOf, sourceLabel)
          : this.insufficient<MacdValue>(35, sampleCount, asOf, sourceLabel, `MACD 需要至少 35 个有效交易日样本，当前 ${sampleCount}。`),
        boll20: boll
          ? this.ok(boll, 20, sampleCount, asOf, sourceLabel)
          : this.insufficient<BollValue>(20, sampleCount, asOf, sourceLabel, `BOLL20 需要至少 20 个有效交易日样本，当前 ${sampleCount}。`),
        atr14: buildNumber(15, 'ATR14', () => this.atr(normalized, 14)),
        volumeRatio20: buildNumber(22, '20日量比', () => this.volumeRatio(normalized, 20)),
        supportResistance20: srValue
          ? this.ok(srValue, 20, sampleCount, asOf, sourceLabel)
          : this.insufficient<SupportResistanceValue>(20, sampleCount, asOf, sourceLabel, `支撑压力位需要至少 20 个有效交易日样本，当前 ${sampleCount}。`),
      },
    }
  }

  async getAssetSnapshot(assetId: string, options: { symbol?: string; days?: number } = {}) {
    const endDate = new Date()
    const startDate = new Date(Date.now() - (options.days || 260) * 24 * 60 * 60 * 1000)
    const history = await prisma.priceHistory.findMany({
      where: {
        assetId,
        timestamp: { gte: startDate, lte: endDate },
        isValid: true,
      },
      orderBy: { timestamp: 'asc' },
      select: {
        timestamp: true,
        closePrice: true,
        highPrice: true,
        lowPrice: true,
        openPrice: true,
        volume: true,
        source: true,
      },
    })
    return this.buildSnapshotFromBars({
      assetId,
      symbol: options.symbol,
      bars: history,
    })
  }

  buildTradingSignals(snapshot: TechnicalIndicatorSnapshot): TechnicalTradingSignal[] {
    if (snapshot.quality !== 'ok') return []
    if (snapshot.source !== 'external_provider') return []
    const signals: TechnicalTradingSignal[] = []
    const rsi = snapshot.indicators.rsi14
    if (rsi.quality === 'ok' && typeof rsi.value === 'number') {
      if (rsi.value < 30) {
        signals.push({
          type: 'buy',
          reason: `RSI14 超卖 ${rsi.value.toFixed(2)}，样本 ${rsi.sampleCount} 个交易日，来源 ${rsi.sourceLabel || rsi.source}`,
          confidence: 70,
          indicator: 'rsi14',
          value: rsi.value,
          sampleCount: rsi.sampleCount,
          asOf: rsi.asOf,
          source: rsi.source,
          quality: rsi.quality,
        })
      } else if (rsi.value > 70) {
        signals.push({
          type: 'sell',
          reason: `RSI14 超买 ${rsi.value.toFixed(2)}，样本 ${rsi.sampleCount} 个交易日，来源 ${rsi.sourceLabel || rsi.source}`,
          confidence: 70,
          indicator: 'rsi14',
          value: rsi.value,
          sampleCount: rsi.sampleCount,
          asOf: rsi.asOf,
          source: rsi.source,
          quality: rsi.quality,
        })
      }
    }

    const ma5 = snapshot.indicators.ma5.value
    const ma20 = snapshot.indicators.ma20.value
    if (snapshot.indicators.ma5.quality === 'ok' && snapshot.indicators.ma20.quality === 'ok' && ma5 && ma20) {
      const spreadPct = ((ma5 - ma20) / ma20) * 100
      if (spreadPct > 2) {
        signals.push({
          type: 'buy',
          reason: `MA5 高于 MA20 ${spreadPct.toFixed(2)}%，趋势偏强，样本 ${snapshot.sampleCount} 个交易日`,
          confidence: 62,
          indicator: 'ma5_ma20_spread',
          value: this.round(spreadPct, 2),
          sampleCount: snapshot.sampleCount,
          asOf: snapshot.asOf,
          source: snapshot.source,
          quality: snapshot.quality,
        })
      } else if (spreadPct < -2) {
        signals.push({
          type: 'sell',
          reason: `MA5 低于 MA20 ${Math.abs(spreadPct).toFixed(2)}%，趋势偏弱，样本 ${snapshot.sampleCount} 个交易日`,
          confidence: 62,
          indicator: 'ma5_ma20_spread',
          value: this.round(spreadPct, 2),
          sampleCount: snapshot.sampleCount,
          asOf: snapshot.asOf,
          source: snapshot.source,
          quality: snapshot.quality,
        })
      }
    }

    const macd = snapshot.indicators.macd.value
    if (snapshot.indicators.macd.quality === 'ok' && macd && Math.abs(macd.hist) > 0) {
      signals.push({
        type: macd.hist > 0 ? 'buy' : 'sell',
        reason: `MACD 柱 ${macd.hist.toFixed(4)}，DIF=${macd.dif.toFixed(4)}，DEA=${macd.dea.toFixed(4)}，样本 ${snapshot.sampleCount} 个交易日`,
        confidence: 58,
        indicator: 'macd_hist',
        value: macd.hist,
        sampleCount: snapshot.sampleCount,
        asOf: snapshot.asOf,
        source: snapshot.source,
        quality: snapshot.quality,
      })
    }
    return signals
  }
}

export const technicalIndicatorService = new TechnicalIndicatorService()
