import { prisma } from '../../db/prisma.js'
import type { MarketFeatureDaily } from '@prisma/client'

interface CanonicalBar {
  symbol: string
  assetId: string | null
  tradeDate: Date
  closePrice: number
  highPrice: number | null
  lowPrice: number | null
  volume: number | null
}

interface FeatureComputeReportItem {
  symbol: string
  status: 'computed' | 'insufficient' | 'failed'
  bars: number
  features: number
  latestTradeDate: string | null
  warnings: string[]
}

export interface MarketFeatureComputeReport {
  schemaVersion: 'fams.market_feature_daily.compute_report.v1'
  generatedAt: string
  market: string
  requestedSymbols: number
  computedSymbols: number
  insufficientSymbols: number
  failedSymbols: number
  featureRows: number
  items: FeatureComputeReportItem[]
}

class MarketFeatureDailyService {
  private formatDate(date: Date) {
    return date.toISOString().slice(0, 10)
  }

  private average(values: number[]) {
    const valid = values.filter((value) => Number.isFinite(value))
    if (valid.length === 0) return null
    return valid.reduce((sum, value) => sum + value, 0) / valid.length
  }

  private percentReturn(current: number, previous?: number) {
    if (!previous || previous <= 0 || !Number.isFinite(current)) return null
    return ((current - previous) / previous) * 100
  }

  private standardDeviation(values: number[]) {
    if (values.length < 2) return null
    const avg = this.average(values)
    if (avg === null) return null
    const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1)
    return Math.sqrt(variance)
  }

  private maxDrawdown(values: number[]) {
    let peak = 0
    let drawdown = 0
    for (const value of values) {
      if (!Number.isFinite(value) || value <= 0) continue
      peak = Math.max(peak, value)
      if (peak > 0) drawdown = Math.min(drawdown, ((value - peak) / peak) * 100)
    }
    return Math.abs(drawdown)
  }

  private rsi(closes: number[], period = 14) {
    if (closes.length < period + 1) return null
    let gain = 0
    let loss = 0
    const slice = closes.slice(-period - 1)
    for (let index = 1; index < slice.length; index += 1) {
      const delta = slice[index] - slice[index - 1]
      if (delta >= 0) gain += delta
      else loss += Math.abs(delta)
    }
    const avgGain = gain / period
    const avgLoss = loss / period
    if (avgLoss === 0) return avgGain === 0 ? 50 : 100
    const rs = avgGain / avgLoss
    return 100 - (100 / (1 + rs))
  }

  private atr(bars: CanonicalBar[], period = 14) {
    if (bars.length < period + 1) return null
    const recent = bars.slice(-period - 1)
    const trueRanges: number[] = []
    for (let index = 1; index < recent.length; index += 1) {
      const current = recent[index]
      const previous = recent[index - 1]
      const high = current.highPrice || current.closePrice
      const low = current.lowPrice || current.closePrice
      trueRanges.push(Math.max(
        high - low,
        Math.abs(high - previous.closePrice),
        Math.abs(low - previous.closePrice),
      ))
    }
    return this.average(trueRanges)
  }

  private scoreRange(value: number | null, min: number, max: number) {
    if (value === null || !Number.isFinite(value)) return null
    return Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100))
  }

  private buildFeatureRows(symbol: string, bars: CanonicalBar[]) {
    const rows = []
    for (let index = 0; index < bars.length; index += 1) {
      const window = bars.slice(0, index + 1)
      const closes = window.map((bar) => bar.closePrice)
      const volumes = window.map((bar) => bar.volume || 0)
      const current = bars[index]
      if (closes.length < 20) continue

      const ma5 = this.average(closes.slice(-5))
      const ma10 = this.average(closes.slice(-10))
      const ma20 = this.average(closes.slice(-20))
      const ma60 = closes.length >= 60 ? this.average(closes.slice(-60)) : null
      const ma120 = closes.length >= 120 ? this.average(closes.slice(-120)) : null
      const ma250 = closes.length >= 250 ? this.average(closes.slice(-250)) : null
      const previousMa20 = closes.length >= 21 ? this.average(closes.slice(-21, -1)) : null
      const previousMa60 = closes.length >= 61 ? this.average(closes.slice(-61, -1)) : null
      const highs = window.map((bar) => bar.highPrice || bar.closePrice).filter((value) => Number.isFinite(value) && value > 0)
      const lows = window.map((bar) => bar.lowPrice || bar.closePrice).filter((value) => Number.isFinite(value) && value > 0)
      const returns = closes.slice(1).map((close, i) => this.percentReturn(close, closes[i]) || 0)
      const return20d = this.percentReturn(current.closePrice, closes[index - 20])
      const return60d = this.percentReturn(current.closePrice, closes[index - 60])
      const volatility20 = returns.length >= 20 ? this.standardDeviation(returns.slice(-20)) : null
      const volatility60 = returns.length >= 60 ? this.standardDeviation(returns.slice(-60)) : null
      const volumeMa20 = this.average(volumes.slice(-20))
      const volumeRatio20 = volumeMa20 && volumeMa20 > 0 ? (current.volume || 0) / volumeMa20 : null
      const atr14 = this.atr(window)
      const rsi14 = this.rsi(closes)
      const trendScoreParts = [
        ma20 && current.closePrice > ma20 ? 35 : 0,
        ma60 && current.closePrice > ma60 ? 35 : 0,
        ma20 && previousMa20 && ma20 > previousMa20 ? 15 : 0,
        ma60 && previousMa60 && ma60 > previousMa60 ? 15 : 0,
      ]
      const momentumScore = this.scoreRange(return20d, -15, 20)
      const liquidityScore = this.scoreRange(Math.log10(Math.max(current.volume || 0, 1)), 4, 8)
      const qualityFlags = [
        ...(closes.length < 60 ? ['short_history_lt_60'] : []),
        ...(current.volume === null || current.volume <= 0 ? ['missing_or_zero_volume'] : []),
        ...(atr14 === null ? ['atr14_unavailable'] : []),
      ]

      rows.push({
        assetId: current.assetId,
        symbol,
        market: 'CN',
        tradeDate: current.tradeDate,
        adjustType: 'none',
        dataVersion: 'canonical.v1',
        closePrice: current.closePrice,
        return1d: this.percentReturn(current.closePrice, closes[index - 1]),
        return5d: this.percentReturn(current.closePrice, closes[index - 5]),
        return20d,
        return60d,
        ma5,
        ma10,
        ma20,
        ma60,
        ma120,
        ma250,
        ma20Slope: ma20 && previousMa20 ? ((ma20 - previousMa20) / previousMa20) * 100 : null,
        ma60Slope: ma60 && previousMa60 ? ((ma60 - previousMa60) / previousMa60) * 100 : null,
        rollingHigh20: highs.length >= 20 ? Math.max(...highs.slice(-20)) : null,
        rollingLow20: lows.length >= 20 ? Math.min(...lows.slice(-20)) : null,
        rollingHigh60: highs.length >= 60 ? Math.max(...highs.slice(-60)) : null,
        rollingLow60: lows.length >= 60 ? Math.min(...lows.slice(-60)) : null,
        volumeMa5: this.average(volumes.slice(-5)),
        volumeMa20,
        volumeRatio20,
        atr14,
        rsi14,
        volatility20,
        volatility60,
        maxDrawdown20: this.maxDrawdown(closes.slice(-20)),
        maxDrawdown60: closes.length >= 60 ? this.maxDrawdown(closes.slice(-60)) : null,
        relativeStrength20: return20d,
        relativeStrength60: return60d,
        liquidityScore,
        trendScore: trendScoreParts.reduce((sum, value) => sum + value, 0),
        momentumScore,
        qualityFlagsJson: JSON.stringify(qualityFlags),
        computedAt: new Date(),
      })
    }
    return rows
  }

  async computeForSymbols(symbols: string[], options: { market?: string; lookbackDays?: number } = {}): Promise<MarketFeatureComputeReport> {
    const market = options.market || 'CN'
    const uniqueSymbols = Array.from(new Set(symbols.filter((symbol) => /^\d{6}$/.test(symbol))))
    const lookbackDays = Math.max(60, Math.min(320, options.lookbackDays || 260))
    const items: FeatureComputeReportItem[] = []
    let featureRows = 0

    for (const symbol of uniqueSymbols) {
      try {
        const bars = await prisma.marketBarCanonical.findMany({
          where: { symbol, market, timeframe: '1d', adjustType: 'none', dataVersion: 'canonical.v1' },
          orderBy: { tradeDate: 'desc' },
          take: lookbackDays,
          select: {
            symbol: true,
            assetId: true,
            tradeDate: true,
            closePrice: true,
            highPrice: true,
            lowPrice: true,
            volume: true,
          },
        })
        const ordered = bars.reverse()
        if (ordered.length < 20) {
          items.push({ symbol, status: 'insufficient', bars: ordered.length, features: 0, latestTradeDate: null, warnings: ['canonical bars less than 20'] })
          continue
        }
        const rows = this.buildFeatureRows(symbol, ordered)
        const tradeDates = rows.map((row) => row.tradeDate)
        await prisma.$transaction(async (tx) => {
          await tx.marketFeatureDaily.deleteMany({
            where: { symbol, market, adjustType: 'none', dataVersion: 'canonical.v1', tradeDate: { in: tradeDates } },
          })
          if (rows.length > 0) {
            await tx.marketFeatureDaily.createMany({ data: rows })
          }
        })
        featureRows += rows.length
        items.push({
          symbol,
          status: rows.length > 0 ? 'computed' : 'insufficient',
          bars: ordered.length,
          features: rows.length,
          latestTradeDate: ordered.length > 0 ? this.formatDate(ordered[ordered.length - 1].tradeDate) : null,
          warnings: rows.length > 0 ? [] : ['no feature rows generated'],
        })
      } catch (error) {
        items.push({
          symbol,
          status: 'failed',
          bars: 0,
          features: 0,
          latestTradeDate: null,
          warnings: [error instanceof Error ? error.message : String(error)],
        })
      }
    }

    return {
      schemaVersion: 'fams.market_feature_daily.compute_report.v1',
      generatedAt: new Date().toISOString(),
      market,
      requestedSymbols: uniqueSymbols.length,
      computedSymbols: items.filter((item) => item.status === 'computed').length,
      insufficientSymbols: items.filter((item) => item.status === 'insufficient').length,
      failedSymbols: items.filter((item) => item.status === 'failed').length,
      featureRows,
      items,
    }
  }

  async getLatestFeatures(symbols: string[], options: { market?: string } = {}) {
    const market = options.market || 'CN'
    const uniqueSymbols = Array.from(new Set(symbols.filter((symbol) => /^\d{6}$/.test(symbol))))
    const latestBySymbol = new Map<string, MarketFeatureDaily>()
    for (let index = 0; index < uniqueSymbols.length; index += 500) {
      const batch = uniqueSymbols.slice(index, index + 500)
      const grouped = await prisma.marketFeatureDaily.groupBy({
        by: ['symbol'],
        where: { symbol: { in: batch }, market, adjustType: 'none', dataVersion: 'canonical.v1' },
        _max: { tradeDate: true },
      })
      const latestDates = grouped
        .filter((item) => item._max.tradeDate)
        .map((item) => ({ symbol: item.symbol, tradeDate: item._max.tradeDate! }))
      if (latestDates.length === 0) continue
      for (let pairIndex = 0; pairIndex < latestDates.length; pairIndex += 100) {
        const pairBatch = latestDates.slice(pairIndex, pairIndex + 100)
        const rows = await prisma.marketFeatureDaily.findMany({
          where: {
            market,
            adjustType: 'none',
            dataVersion: 'canonical.v1',
            OR: pairBatch.map((item) => ({
              symbol: item.symbol,
              tradeDate: item.tradeDate,
            })),
          },
        })
        for (const row of rows) {
          latestBySymbol.set(row.symbol, row)
        }
      }
    }
    return latestBySymbol
  }
}

export const marketFeatureDailyService = new MarketFeatureDailyService()
