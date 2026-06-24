import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { prisma } from '../../db/prisma.js'

const execFileAsync = promisify(execFile)

export type AlternativeAssetFactSetStatus = 'available' | 'partial' | 'insufficient'

export type AlternativeAssetMetricWindow = {
  windowDays: 20 | 60 | 120
  sampleSize: number
  startDate: string | null
  endDate: string | null
  rollingReturnPct: number | null
  annualizedVolatilityPct: number | null
  maxDrawdownPct: number | null
  status: AlternativeAssetFactSetStatus
  blockedReasons: string[]
}

export type FundLikeFactSet = {
  schemaVersion: 'fivd.r.fund_like_factset.v1'
  generatedAt: string
  assetId: string
  symbol: string
  assetName: string
  assetType: string
  status: AlternativeAssetFactSetStatus
  fundType: 'fund' | 'bond_fund' | 'bond' | 'etf' | 'unknown'
  navHistory: {
    source: string
    sampleSize: number
    firstDate: string | null
    latestDate: string | null
  }
  profile: {
    status: 'available' | 'missing' | 'provider_failed'
    provider: string
    fundCategory: string | null
    inceptionDate: string | null
    managerNames: string[]
    managementCompany: string | null
    custodian: string | null
    fundScaleText: string | null
    benchmark: string | null
    sourceRefs: string[]
    blockedReasons: string[]
    lastError?: string
  }
  fee: {
    status: 'available' | 'missing' | 'provider_failed'
    provider: string
    managementFeePct: number | null
    custodianFeePct: number | null
    salesServiceFeePct: number | null
    sourceRefs: string[]
    blockedReasons: string[]
    lastError?: string
  }
  bondRiskProxy: {
    status: 'available' | 'missing' | 'provider_failed' | 'not_applicable'
    provider: string
    method: 'top_bond_holding_name_heuristic_v1'
    latestAllocation: {
      reportDate: string | null
      stockPct: number | null
      bondPct: number | null
      cashPct: number | null
      netAssetBillion: number | null
    }
    topBondHoldings: Array<{
      bondCode: string
      bondName: string
      proportionPct: number
      marketValue: number | null
    }>
    topBondConcentrationPct: number | null
    creditRiskFlags: string[]
    sourceRefs: string[]
    blockedReasons: string[]
    lastError?: string
  }
  holdings: {
    status: 'available' | 'missing' | 'provider_failed'
    provider: string
    reportDate: string | null
    topHoldings: Array<{
      stockCode: string
      stockName: string
      proportionPct: number
      shares: number | null
      marketValue: number | null
    }>
    top10ConcentrationPct: number | null
    equityHoldingCount: number
    holdingsStyle: 'concentrated_equity' | 'diversified_equity' | 'low_equity_or_bond_like' | 'unknown'
    sourceRefs: string[]
    blockedReasons: string[]
    lastError?: string
  }
  riskLevelProxy: {
    status: 'available' | 'insufficient'
    provider: 'local_nav_risk_proxy'
    method: 'nav_drawdown_volatility_risk_level_proxy_v1'
    riskLevel: 'low' | 'medium' | 'high' | 'unknown'
    score: number | null
    inputs: {
      sampleSize: number
      maxDrawdownPct: number | null
      annualizedVolatilityPct: number | null
      assetType: string
    }
    evidenceRefs: string[]
    warnings: string[]
  }
  durationProxy: {
    status: 'available' | 'insufficient' | 'not_applicable'
    provider: 'local_nav_bond_allocation_proxy'
    method: 'bond_fund_nav_volatility_allocation_duration_proxy_v1'
    durationBucket: 'short' | 'medium_short' | 'medium' | 'long' | 'unknown'
    estimatedDurationYears: number | null
    confidence: 'low' | 'insufficient'
    inputs: {
      sampleSize: number
      annualizedVolatilityPct: number | null
      maxDrawdownPct: number | null
      bondPct: number | null
      topBondConcentrationPct: number | null
    }
    evidenceRefs: string[]
    warnings: string[]
  }
  windows: AlternativeAssetMetricWindow[]
  missingFields: string[]
  blockedReasons: string[]
  evidenceRefs: string[]
  sourceRefs: string[]
  warnings: string[]
}

export type GoldMacroFactSet = {
  schemaVersion: 'fivd.r.gold_macro_factset.v1'
  generatedAt: string
  assetId: string
  symbol: string
  assetName: string
  assetType: 'gold'
  status: AlternativeAssetFactSetStatus
  goldPriceHistory: {
    source: string
    sampleSize: number
    firstDate: string | null
    latestDate: string | null
  }
  sourceSelection: {
    selectedFamily: 'physical_gold_price_proxy' | 'fund_or_etf_trade_price' | 'unknown'
    selectedSources: string[]
    excludedSources: Array<{
      source: string
      family: 'physical_gold_price_proxy' | 'fund_or_etf_trade_price' | 'unknown'
      sampleSize: number
      minClose: number | null
      maxClose: number | null
      reason: string
    }>
    referencePrice: number | null
    selectionReason: string
  }
  priceScaleCheck: {
    status: 'passed' | 'failed' | 'not_enough_data'
    maxAbsDailyReturnPct: number | null
    thresholdPct: number
    abnormalMoves: Array<{
      fromDate: string
      toDate: string
      fromClose: number
      toClose: number
      dailyReturnPct: number
      fromSource: string
      toSource: string
    }>
  }
  windows: AlternativeAssetMetricWindow[]
  macroProxies: {
    realRateProxy: {
      status: 'available' | 'missing' | 'provider_failed'
      provider: string
      method: 'tips_etf_price_pressure_proxy_v1'
      symbol: 'TIP'
      sampleSize: number
      latestDate: string | null
      latestValue: number | null
      return20dPct: number | null
      return60dPct: number | null
      pressure: 'real_rate_pressure_up' | 'real_rate_pressure_down' | 'flat' | 'unknown'
      sourceRefs: string[]
      lastError?: string
    }
    usdTrendProxy: {
      status: 'available' | 'missing' | 'provider_failed'
      provider: string
      symbol: string
      sampleSize: number
      latestDate: string | null
      latestValue: number | null
      return20dPct: number | null
      return60dPct: number | null
      trend: 'usd_strengthening' | 'usd_weakening' | 'flat' | 'unknown'
      sourceRefs: string[]
      lastError?: string
    }
    inflationExpectationProxy: {
      status: 'available' | 'missing' | 'provider_failed'
      provider: string
      method: 'tips_vs_treasury_etf_relative_proxy_v1'
      symbols: ['TIP', 'IEF']
      sampleSize: number
      latestDate: string | null
      relativeReturn20dPct: number | null
      relativeReturn60dPct: number | null
      signal: 'inflation_expectation_up' | 'inflation_expectation_down' | 'flat' | 'unknown'
      sourceRefs: string[]
      lastError?: string
    }
    status: 'partial' | 'missing'
    blockedReasons: string[]
  }
  missingFields: string[]
  blockedReasons: string[]
  evidenceRefs: string[]
  sourceRefs: string[]
  warnings: string[]
}

type PositionLike = {
  assetId: string
  currentPrice?: number | null
  asset: {
    id: string
    symbol: string
    name: string
    type: string
  }
}

type HistoryPoint = {
  date: Date
  close: number
  source: string
}

function normalizeSymbol(symbol: string) {
  return String(symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
}

function round(value: number | null | undefined, precision = 4) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function formatDate(date?: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null
}

function stddev(values: number[]) {
  if (values.length < 2) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  return Math.sqrt(variance)
}

class AlternativeAssetFactsetService {
  async buildFundLikeFactSet(position: PositionLike): Promise<FundLikeFactSet> {
    const [history, profile, fee, bondRiskProxy, holdings] = await Promise.all([
      this.readLocalHistory(position),
      this.fetchFundProfile(position.asset.symbol),
      this.fetchFundFee(position.asset.symbol),
      this.fetchBondRiskProxy(position.asset.symbol, position.asset.type),
      this.fetchFundHoldings(position.asset.symbol),
    ])
    const windows = this.buildWindows(history)
    const riskLevelProxy = this.deriveRiskLevelProxy(position.asset.type, history, windows)
    const durationProxy = this.deriveDurationProxy(position.asset.type, history, windows, bondRiskProxy)
    const missingFields = this.fundMissingFields(position.asset.type, history, windows, profile, fee, bondRiskProxy, holdings, riskLevelProxy, durationProxy)
    const blockedReasons = [
      ...(history.length < 20 ? ['fund_nav_history_insufficient'] : []),
      ...(history.length < 20 ? ['fund_like_value_factset_missing'] : []),
      ...profile.blockedReasons,
      ...fee.blockedReasons,
      ...holdings.blockedReasons,
      ...(missingFields.includes('riskLevelProxy') ? ['fund_risk_level_missing'] : []),
      ...(missingFields.includes('durationProxy') ? ['bond_duration_proxy_missing'] : []),
      ...bondRiskProxy.blockedReasons,
    ]
    const status = history.length >= 60 ? 'partial' : history.length >= 20 ? 'partial' : 'insufficient'
    return {
      schemaVersion: 'fivd.r.fund_like_factset.v1',
      generatedAt: new Date().toISOString(),
      assetId: position.asset.id,
      symbol: normalizeSymbol(position.asset.symbol),
      assetName: position.asset.name,
      assetType: position.asset.type,
      status,
      fundType: this.fundType(position.asset.type),
      navHistory: this.historySummary(history),
      profile,
      fee,
      bondRiskProxy,
      holdings,
      riskLevelProxy,
      durationProxy,
      windows,
      missingFields,
      blockedReasons: Array.from(new Set(blockedReasons)),
      evidenceRefs: [
        ...this.evidenceRefs(position, history, 'fund-like'),
        ...(profile.status === 'available' ? [`fund-profile:${normalizeSymbol(position.asset.symbol)}:${profile.inceptionDate || 'profile'}`] : []),
        ...(fee.status === 'available' ? [`fund-fee:${normalizeSymbol(position.asset.symbol)}:operation-fee`] : []),
        ...(bondRiskProxy.status === 'available' ? [`bond-risk-proxy:${normalizeSymbol(position.asset.symbol)}:${bondRiskProxy.latestAllocation.reportDate || 'bond-holdings'}`] : []),
        ...(holdings.status === 'available' ? [`fund-holdings:${normalizeSymbol(position.asset.symbol)}:${holdings.reportDate}`] : []),
        ...(riskLevelProxy.status === 'available' ? riskLevelProxy.evidenceRefs : []),
        ...(durationProxy.status === 'available' ? durationProxy.evidenceRefs : []),
      ],
      sourceRefs: Array.from(new Set([
        ...this.sourceRefs(history),
        ...profile.sourceRefs,
        ...fee.sourceRefs,
        ...bondRiskProxy.sourceRefs,
        ...holdings.sourceRefs,
      ])),
      warnings: [
        ...(history.length < 20 ? ['本地净值/价格历史不足 20 条，只能保留 insufficient。'] : []),
        ...(profile.status === 'available' ? [] : ['基金 profile 尚未取得真实 provider 证据。']),
        ...(fee.status === 'available' ? [] : ['基金运作费率尚未取得真实 provider 证据。']),
        ...(bondRiskProxy.status === 'available' || bondRiskProxy.status === 'not_applicable' ? [] : ['债基债券持仓/信用风险代理尚未取得真实 provider 证据。']),
        ...(holdings.status === 'available' ? [] : ['基金持仓风格尚未取得真实 provider 证据。']),
        ...(riskLevelProxy.status === 'available' ? riskLevelProxy.warnings : ['基金风险等级代理无法生成，仍需正式 provider 或人工导入证据。']),
        ...(durationProxy.status === 'available' ? durationProxy.warnings : durationProxy.status === 'not_applicable' ? [] : ['债基久期代理无法生成，仍需正式 provider 或人工导入证据。']),
      ],
    }
  }

  async buildGoldMacroFactSet(position: PositionLike): Promise<GoldMacroFactSet> {
    const [goldHistory, usdTrendProxy, tipsInflationProxies] = await Promise.all([
      this.readGoldScaleConsistentHistory(position),
      this.fetchGoldUsdTrendProxy(),
      this.fetchGoldTipsInflationProxies(),
    ])
    const history = goldHistory.history
    const priceScaleCheck = this.checkGoldPriceScale(history)
    const windows = priceScaleCheck.status === 'failed'
      ? this.blockedWindows(history, 'gold_price_scale_inconsistent')
      : this.buildWindows(history)
    const missingFields = [
      ...(history.length < 20 ? ['goldPriceHistory'] : []),
      ...(priceScaleCheck.status === 'failed' ? ['goldPriceScaleConsistency'] : []),
      ...(tipsInflationProxies.realRateProxy.status === 'available' ? [] : ['realRateProxy']),
      ...(usdTrendProxy.status === 'available' ? [] : ['usdTrend']),
      ...(tipsInflationProxies.inflationExpectationProxy.status === 'available' ? [] : ['inflationExpectationProxy']),
    ]
    const blockedReasons = [
      ...(history.length < 20 ? ['gold_price_history_insufficient'] : []),
      ...(priceScaleCheck.status === 'failed' ? ['gold_price_scale_inconsistent'] : []),
      ...(usdTrendProxy.status === 'available' ? [] : ['gold_usd_trend_proxy_missing']),
      ...(tipsInflationProxies.realRateProxy.status === 'available' ? [] : ['gold_real_rate_proxy_missing']),
      ...(tipsInflationProxies.inflationExpectationProxy.status === 'available' ? [] : ['gold_inflation_expectation_proxy_missing']),
    ]
    return {
      schemaVersion: 'fivd.r.gold_macro_factset.v1',
      generatedAt: new Date().toISOString(),
      assetId: position.asset.id,
      symbol: normalizeSymbol(position.asset.symbol),
      assetName: position.asset.name,
      assetType: 'gold',
      status: history.length >= 20 && priceScaleCheck.status !== 'failed' ? 'partial' : 'insufficient',
      goldPriceHistory: this.historySummary(history),
      sourceSelection: goldHistory.sourceSelection,
      priceScaleCheck,
      windows,
      macroProxies: {
        realRateProxy: tipsInflationProxies.realRateProxy,
        usdTrendProxy,
        inflationExpectationProxy: tipsInflationProxies.inflationExpectationProxy,
        status: usdTrendProxy.status === 'available'
          || tipsInflationProxies.realRateProxy.status === 'available'
          || tipsInflationProxies.inflationExpectationProxy.status === 'available'
          ? 'partial'
          : 'missing',
        blockedReasons: blockedReasons.filter((reason) => reason.startsWith('gold_') && reason.includes('proxy')),
      },
      missingFields,
      blockedReasons,
      evidenceRefs: [
        ...this.evidenceRefs(position, history, 'gold-macro'),
        ...(usdTrendProxy.status === 'available' ? [`gold-usd-trend-proxy:${usdTrendProxy.symbol}:${usdTrendProxy.latestDate}`] : []),
        ...(tipsInflationProxies.realRateProxy.status === 'available' ? [`gold-real-rate-proxy:${tipsInflationProxies.realRateProxy.symbol}:${tipsInflationProxies.realRateProxy.latestDate}`] : []),
        ...(tipsInflationProxies.inflationExpectationProxy.status === 'available' ? [`gold-inflation-expectation-proxy:TIP-IEF:${tipsInflationProxies.inflationExpectationProxy.latestDate}`] : []),
      ],
      sourceRefs: Array.from(new Set([
        ...this.sourceRefs(history),
        ...usdTrendProxy.sourceRefs,
        ...tipsInflationProxies.realRateProxy.sourceRefs,
        ...tipsInflationProxies.inflationExpectationProxy.sourceRefs,
      ])),
      warnings: [
        ...(history.length < 20 ? ['本地黄金价格历史不足 20 条。'] : []),
        ...(priceScaleCheck.status === 'failed' ? ['黄金历史价格出现超过 20% 的单日跳变，疑似金价/基金净值/ETF价格口径混用，已禁止计算收益和波动结论。'] : []),
        ...(usdTrendProxy.status === 'available' ? [] : ['美元趋势代理尚未取得真实 provider 证据。']),
        ...(tipsInflationProxies.realRateProxy.status === 'available' ? [] : ['实际利率压力代理尚未取得真实 provider 证据。']),
        ...(tipsInflationProxies.inflationExpectationProxy.status === 'available' ? [] : ['通胀预期代理尚未取得真实 provider 证据。']),
        '黄金宏观代理为 research-only 市场代理，不等同官方宏观数据或交易信号。',
      ],
    }
  }

  private async readLocalHistory(position: PositionLike): Promise<HistoryPoint[]> {
    const symbol = normalizeSymbol(position.asset.symbol)
    const [priceRows, canonicalRows] = await Promise.all([
      prisma.priceHistory.findMany({
        where: {
          assetId: position.assetId,
          isValid: true,
        },
        orderBy: { timestamp: 'asc' },
        take: 260,
      }),
      prisma.marketBarCanonical.findMany({
        where: {
          OR: [
            { assetId: position.assetId },
            { symbol },
          ],
        },
        orderBy: { tradeDate: 'asc' },
        take: 260,
      }),
    ])
    const byDate = new Map<string, HistoryPoint>()
    for (const row of canonicalRows) {
      const date = formatDate(row.tradeDate)
      if (!date || !Number.isFinite(row.closePrice) || row.closePrice <= 0) continue
      byDate.set(date, {
        date: row.tradeDate,
        close: row.closePrice,
        source: `market_bar_canonical:${row.primaryProvider || 'canonical'}`,
      })
    }
    for (const row of priceRows) {
      const date = formatDate(row.timestamp)
      if (!date || !Number.isFinite(row.closePrice) || row.closePrice <= 0) continue
      if (!byDate.has(date)) {
        byDate.set(date, {
          date: row.timestamp,
          close: row.closePrice,
          source: `price_history:${row.source || 'unknown'}`,
        })
      }
    }
    return Array.from(byDate.values()).sort((left, right) => left.date.getTime() - right.date.getTime())
  }

  private async fetchGoldUsdTrendProxy(): Promise<GoldMacroFactSet['macroProxies']['usdTrendProxy']> {
    const symbol = 'DX-Y.NYB'
    const sourceUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=6mo&interval=1d`
    try {
      const { stdout } = await execFileAsync('curl', [
        '-L',
        '--silent',
        '--show-error',
        '--max-time',
        '15',
        '-A',
        'Mozilla/5.0',
        sourceUrl,
      ], { maxBuffer: 2 * 1024 * 1024 })
      const payload = JSON.parse(stdout.toString())
      const result = payload?.chart?.result?.[0]
      const timestamps: number[] = Array.isArray(result?.timestamp) ? result.timestamp : []
      const closes: Array<number | null> = Array.isArray(result?.indicators?.quote?.[0]?.close)
        ? result.indicators.quote[0].close
        : []
      const points = timestamps
        .map((timestamp, index) => ({
          date: new Date(timestamp * 1000),
          close: Number(closes[index]),
        }))
        .filter((point) => Number.isFinite(point.close) && point.close > 0)
        .sort((left, right) => left.date.getTime() - right.date.getTime())
      if (points.length < 20) {
        return {
          status: 'missing',
          provider: 'yahoo_chart',
          symbol,
          sampleSize: points.length,
          latestDate: formatDate(points[points.length - 1]?.date),
          latestValue: points.length > 0 ? round(points[points.length - 1].close, 4) : null,
          return20dPct: null,
          return60dPct: null,
          trend: 'unknown',
          sourceRefs: [sourceUrl],
          lastError: 'provider_returned_insufficient_dxy_history',
        }
      }
      const return20dPct = this.trailingReturn(points, 20)
      const return60dPct = this.trailingReturn(points, 60)
      const trend = return60dPct === null ? 'unknown'
        : return60dPct > 1 ? 'usd_strengthening'
        : return60dPct < -1 ? 'usd_weakening'
        : 'flat'
      return {
        status: 'available',
        provider: 'yahoo_chart',
        symbol,
        sampleSize: points.length,
        latestDate: formatDate(points[points.length - 1].date),
        latestValue: round(points[points.length - 1].close, 4),
        return20dPct,
        return60dPct,
        trend,
        sourceRefs: [sourceUrl],
      }
    } catch (error) {
      return {
        status: 'provider_failed',
        provider: 'yahoo_chart',
        symbol,
        sampleSize: 0,
        latestDate: null,
        latestValue: null,
        return20dPct: null,
        return60dPct: null,
        trend: 'unknown',
        sourceRefs: [sourceUrl],
        lastError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async fetchGoldTipsInflationProxies(): Promise<{
    realRateProxy: GoldMacroFactSet['macroProxies']['realRateProxy']
    inflationExpectationProxy: GoldMacroFactSet['macroProxies']['inflationExpectationProxy']
  }> {
    const [tip, ief] = await Promise.all([
      this.fetchNasdaqEtfHistory('TIP'),
      this.fetchNasdaqEtfHistory('IEF'),
    ])
    const tipSourceRefs = tip.sourceRefs
    const bothSourceRefs = Array.from(new Set([...tip.sourceRefs, ...ief.sourceRefs]))
    const realRateFallback = (status: 'missing' | 'provider_failed', lastError: string): GoldMacroFactSet['macroProxies']['realRateProxy'] => ({
      status,
      provider: 'nasdaq_historical',
      method: 'tips_etf_price_pressure_proxy_v1',
      symbol: 'TIP',
      sampleSize: tip.points.length,
      latestDate: formatDate(tip.points[tip.points.length - 1]?.date),
      latestValue: tip.points.length > 0 ? round(tip.points[tip.points.length - 1].close, 4) : null,
      return20dPct: null,
      return60dPct: null,
      pressure: 'unknown',
      sourceRefs: tipSourceRefs,
      lastError,
    })
    const inflationFallback = (status: 'missing' | 'provider_failed', lastError: string): GoldMacroFactSet['macroProxies']['inflationExpectationProxy'] => ({
      status,
      provider: 'nasdaq_historical',
      method: 'tips_vs_treasury_etf_relative_proxy_v1',
      symbols: ['TIP', 'IEF'],
      sampleSize: Math.min(tip.points.length, ief.points.length),
      latestDate: formatDate(tip.points[tip.points.length - 1]?.date || ief.points[ief.points.length - 1]?.date),
      relativeReturn20dPct: null,
      relativeReturn60dPct: null,
      signal: 'unknown',
      sourceRefs: bothSourceRefs,
      lastError,
    })
    const tipError = tip.error || (tip.points.length < 20 ? 'provider_returned_insufficient_tip_history' : null)
    const iefError = ief.error || (ief.points.length < 20 ? 'provider_returned_insufficient_ief_history' : null)
    const realRateProxy = tipError
      ? realRateFallback(tip.error ? 'provider_failed' : 'missing', tipError)
      : this.buildTipsRealRateProxy(tip.points, tipSourceRefs)
    const inflationExpectationProxy = tipError || iefError
      ? inflationFallback(tip.error || ief.error ? 'provider_failed' : 'missing', [tipError, iefError].filter(Boolean).join(';'))
      : this.buildTipsInflationExpectationProxy(tip.points, ief.points, bothSourceRefs)
    return { realRateProxy, inflationExpectationProxy }
  }

  private async fetchNasdaqEtfHistory(symbol: 'TIP' | 'IEF'): Promise<{
    points: Array<{ date: Date; close: number }>
    sourceRefs: string[]
    error?: string
  }> {
    const sourceUrl = `https://api.nasdaq.com/api/quote/${symbol}/historical?assetclass=etf&fromdate=2025-12-01&todate=${new Date().toISOString().slice(0, 10)}&limit=200`
    try {
      const { stdout } = await execFileAsync('curl', [
        '-L',
        '--silent',
        '--show-error',
        '--max-time',
        '15',
        '-A',
        'Mozilla/5.0',
        '-H',
        'Accept: application/json, text/plain, */*',
        '-H',
        'Origin: https://www.nasdaq.com',
        '-H',
        'Referer: https://www.nasdaq.com/',
        sourceUrl,
      ], { maxBuffer: 2 * 1024 * 1024 })
      const payload = JSON.parse(stdout.toString())
      const rows: Array<{ date?: string; close?: string }> = Array.isArray(payload?.data?.tradesTable?.rows) ? payload.data.tradesTable.rows : []
      const points = rows
        .map((row: { date?: string; close?: string }) => {
          const date = row.date ? this.parseUsDate(row.date) : null
          const close = this.parseMarketNumber(row.close)
          return date && close !== null ? { date, close } : null
        })
        .filter((point: { date: Date; close: number } | null): point is { date: Date; close: number } => point !== null)
        .sort((left, right) => left.date.getTime() - right.date.getTime())
      return { points, sourceRefs: [sourceUrl] }
    } catch (error) {
      return {
        points: [],
        sourceRefs: [sourceUrl],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private buildTipsRealRateProxy(
    points: Array<{ date: Date; close: number }>,
    sourceRefs: string[]
  ): GoldMacroFactSet['macroProxies']['realRateProxy'] {
    const return20dPct = this.trailingReturn(points, 20)
    const return60dPct = this.trailingReturn(points, 60)
    const pressure = return60dPct === null ? 'unknown'
      : return60dPct < -1 ? 'real_rate_pressure_up'
      : return60dPct > 1 ? 'real_rate_pressure_down'
      : 'flat'
    return {
      status: 'available',
      provider: 'nasdaq_historical',
      method: 'tips_etf_price_pressure_proxy_v1',
      symbol: 'TIP',
      sampleSize: points.length,
      latestDate: formatDate(points[points.length - 1].date),
      latestValue: round(points[points.length - 1].close, 4),
      return20dPct,
      return60dPct,
      pressure,
      sourceRefs,
    }
  }

  private buildTipsInflationExpectationProxy(
    tipPoints: Array<{ date: Date; close: number }>,
    iefPoints: Array<{ date: Date; close: number }>,
    sourceRefs: string[]
  ): GoldMacroFactSet['macroProxies']['inflationExpectationProxy'] {
    const byDate = new Map<string, { tip?: number; ief?: number }>()
    for (const point of tipPoints) {
      const date = formatDate(point.date)
      if (!date) continue
      byDate.set(date, { ...(byDate.get(date) || {}), tip: point.close })
    }
    for (const point of iefPoints) {
      const date = formatDate(point.date)
      if (!date) continue
      byDate.set(date, { ...(byDate.get(date) || {}), ief: point.close })
    }
    const relative = Array.from(byDate.entries())
      .map(([date, value]) => value.tip && value.ief ? { date: new Date(`${date}T00:00:00Z`), close: value.tip / value.ief } : null)
      .filter((point: { date: Date; close: number } | null): point is { date: Date; close: number } => point !== null)
      .sort((left, right) => left.date.getTime() - right.date.getTime())
    const relativeReturn20dPct = this.trailingReturn(relative, 20)
    const relativeReturn60dPct = this.trailingReturn(relative, 60)
    const signal = relativeReturn60dPct === null ? 'unknown'
      : relativeReturn60dPct > 0.5 ? 'inflation_expectation_up'
      : relativeReturn60dPct < -0.5 ? 'inflation_expectation_down'
      : 'flat'
    return {
      status: relative.length >= 20 ? 'available' : 'missing',
      provider: 'nasdaq_historical',
      method: 'tips_vs_treasury_etf_relative_proxy_v1',
      symbols: ['TIP', 'IEF'],
      sampleSize: relative.length,
      latestDate: formatDate(relative[relative.length - 1]?.date),
      relativeReturn20dPct,
      relativeReturn60dPct,
      signal,
      sourceRefs,
      ...(relative.length >= 20 ? {} : { lastError: 'provider_returned_insufficient_relative_history' }),
    }
  }

  private parseUsDate(value: string) {
    const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    if (!match) return null
    return new Date(`${match[3]}-${match[1]}-${match[2]}T00:00:00Z`)
  }

  private parseMarketNumber(value?: string) {
    if (!value) return null
    const numeric = Number(value.replace(/[$,]/g, ''))
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null
  }

  private trailingReturn(points: Array<{ close: number }>, windowDays: number) {
    const slice = points.slice(-windowDays)
    if (slice.length < Math.min(windowDays, 20)) return null
    const first = slice[0].close
    const last = slice[slice.length - 1].close
    if (!Number.isFinite(first) || first <= 0 || !Number.isFinite(last)) return null
    return round((last / first - 1) * 100, 4)
  }

  private async readGoldScaleConsistentHistory(position: PositionLike): Promise<{
    history: HistoryPoint[]
    sourceSelection: GoldMacroFactSet['sourceSelection']
  }> {
    const allHistory = await this.readUnmergedLocalHistory(position)
    const groups = new Map<string, HistoryPoint[]>()
    for (const point of allHistory) {
      if (!groups.has(point.source)) groups.set(point.source, [])
      groups.get(point.source)!.push(point)
    }
    const referencePrice = Number(position.currentPrice || 0) > 0 ? Number(position.currentPrice) : null
    const sourceSummaries = Array.from(groups.entries()).map(([source, points]) => {
      const closes = points.map((point) => point.close).filter((value) => Number.isFinite(value) && value > 0)
      const median = this.median(closes)
      const family = this.goldSourceFamily(source)
      const scaleDistance = referencePrice && median
        ? Math.abs(median / referencePrice - 1)
        : Number.POSITIVE_INFINITY
      return {
        source,
        family,
        points,
        sampleSize: points.length,
        minClose: closes.length > 0 ? Math.min(...closes) : null,
        maxClose: closes.length > 0 ? Math.max(...closes) : null,
        median,
        scaleDistance,
      }
    })
    const sameScale = sourceSummaries
      .filter((item) => item.median !== null && item.scaleDistance <= 0.35)
      .sort((left, right) => (
        (left.family === 'physical_gold_price_proxy' ? -1 : 0)
        - (right.family === 'physical_gold_price_proxy' ? -1 : 0)
        || right.sampleSize - left.sampleSize
        || left.scaleDistance - right.scaleDistance
      ))
    const selected = sameScale[0] || sourceSummaries
      .filter((item) => item.family === 'physical_gold_price_proxy')
      .sort((left, right) => right.sampleSize - left.sampleSize)[0]
    if (!selected) {
      return {
        history: [],
        sourceSelection: {
          selectedFamily: 'unknown',
          selectedSources: [],
          excludedSources: [],
          referencePrice,
          selectionReason: '未找到可用于黄金口径建模的本地历史源。',
        },
      }
    }
    const selectedSources = [selected.source]
    const selectedSet = new Set(selectedSources)
    const selectedHistory = selected.points
      .sort((left, right) => left.date.getTime() - right.date.getTime())
    const excludedSources = sourceSummaries
      .filter((item) => !selectedSet.has(item.source))
      .map((item) => ({
        source: item.source,
        family: item.family,
        sampleSize: item.sampleSize,
        minClose: item.minClose === null ? null : round(item.minClose, 4),
        maxClose: item.maxClose === null ? null : round(item.maxClose, 4),
        reason: item.scaleDistance > 0.35
          ? '与当前黄金持仓价格不在同一尺度，禁止混入收益/波动计算。'
          : '未被 source precedence 选中，保留为审计参考。',
      }))
    return {
      history: this.dedupeHistoryByDate(selectedHistory),
      sourceSelection: {
        selectedFamily: selected.family,
        selectedSources,
        excludedSources,
        referencePrice,
        selectionReason: selected.scaleDistance <= 0.35
          ? '选择与当前黄金持仓价格同尺度的历史源。'
          : '未找到同尺度源，退回 physical gold proxy；样本和尺度 gate 继续约束输出。',
      },
    }
  }

  private async readUnmergedLocalHistory(position: PositionLike): Promise<HistoryPoint[]> {
    const symbol = normalizeSymbol(position.asset.symbol)
    const [priceRows, canonicalRows] = await Promise.all([
      prisma.priceHistory.findMany({
        where: {
          assetId: position.assetId,
          isValid: true,
        },
        orderBy: { timestamp: 'asc' },
        take: 600,
      }),
      prisma.marketBarCanonical.findMany({
        where: {
          OR: [
            { assetId: position.assetId },
            { symbol },
          ],
        },
        orderBy: { tradeDate: 'asc' },
        take: 600,
      }),
    ])
    return [
      ...canonicalRows
        .filter((row) => Number.isFinite(row.closePrice) && row.closePrice > 0)
        .map((row) => ({
          date: row.tradeDate,
          close: row.closePrice,
          source: `market_bar_canonical:${row.primaryProvider || 'canonical'}`,
        })),
      ...priceRows
        .filter((row) => Number.isFinite(row.closePrice) && row.closePrice > 0)
        .map((row) => ({
          date: row.timestamp,
          close: row.closePrice,
          source: `price_history:${row.source || 'unknown'}`,
        })),
    ].sort((left, right) => left.date.getTime() - right.date.getTime())
  }

  private dedupeHistoryByDate(history: HistoryPoint[]) {
    const byDate = new Map<string, HistoryPoint>()
    for (const point of history) {
      const date = formatDate(point.date)
      if (!date) continue
      byDate.set(date, point)
    }
    return Array.from(byDate.values()).sort((left, right) => left.date.getTime() - right.date.getTime())
  }

  private goldSourceFamily(source: string): GoldMacroFactSet['sourceSelection']['selectedFamily'] {
    if (source === 'price_history:goldFund') return 'physical_gold_price_proxy'
    if (source.startsWith('market_bar_canonical') || source === 'price_history:sina' || source === 'price_history:eastmoney') return 'fund_or_etf_trade_price'
    return 'unknown'
  }

  private median(values: number[]) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right)
    if (sorted.length === 0) return null
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  }

  private buildWindows(history: HistoryPoint[]): AlternativeAssetMetricWindow[] {
    return ([20, 60, 120] as const).map((windowDays) => {
      const points = history.slice(-windowDays)
      if (points.length < Math.min(windowDays, 20)) {
        return {
          windowDays,
          sampleSize: points.length,
          startDate: formatDate(points[0]?.date),
          endDate: formatDate(points[points.length - 1]?.date),
          rollingReturnPct: null,
          annualizedVolatilityPct: null,
          maxDrawdownPct: null,
          status: 'insufficient',
          blockedReasons: [`${windowDays}d_sample_insufficient`],
        }
      }
      const closes = points.map((point) => point.close)
      const returns = closes.slice(1).map((close, index) => closes[index] > 0 ? close / closes[index] - 1 : 0)
      return {
        windowDays,
        sampleSize: points.length,
        startDate: formatDate(points[0].date),
        endDate: formatDate(points[points.length - 1].date),
        rollingReturnPct: round((closes[closes.length - 1] / closes[0] - 1) * 100, 4),
        annualizedVolatilityPct: round((stddev(returns) || 0) * Math.sqrt(252) * 100, 4),
        maxDrawdownPct: round(this.maxDrawdown(closes) * 100, 4),
        status: points.length >= windowDays ? 'available' : 'partial',
        blockedReasons: points.length >= windowDays ? [] : [`${windowDays}d_sample_partial`],
      }
    })
  }

  private blockedWindows(history: HistoryPoint[], reason: string): AlternativeAssetMetricWindow[] {
    return ([20, 60, 120] as const).map((windowDays) => {
      const points = history.slice(-windowDays)
      return {
        windowDays,
        sampleSize: points.length,
        startDate: formatDate(points[0]?.date),
        endDate: formatDate(points[points.length - 1]?.date),
        rollingReturnPct: null,
        annualizedVolatilityPct: null,
        maxDrawdownPct: null,
        status: 'insufficient',
        blockedReasons: [reason],
      }
    })
  }

  private checkGoldPriceScale(history: HistoryPoint[]): GoldMacroFactSet['priceScaleCheck'] {
    const thresholdPct = 20
    if (history.length < 2) {
      return {
        status: 'not_enough_data',
        maxAbsDailyReturnPct: null,
        thresholdPct,
        abnormalMoves: [],
      }
    }
    const abnormalMoves: GoldMacroFactSet['priceScaleCheck']['abnormalMoves'] = []
    let maxAbsDailyReturnPct = 0
    for (let index = 1; index < history.length; index += 1) {
      const previous = history[index - 1]
      const current = history[index]
      if (!Number.isFinite(previous.close) || previous.close <= 0 || !Number.isFinite(current.close) || current.close <= 0) continue
      const dailyReturnPct = ((current.close / previous.close) - 1) * 100
      maxAbsDailyReturnPct = Math.max(maxAbsDailyReturnPct, Math.abs(dailyReturnPct))
      if (Math.abs(dailyReturnPct) > thresholdPct) {
        abnormalMoves.push({
          fromDate: formatDate(previous.date) || '',
          toDate: formatDate(current.date) || '',
          fromClose: round(previous.close, 4) || previous.close,
          toClose: round(current.close, 4) || current.close,
          dailyReturnPct: round(dailyReturnPct, 4) || dailyReturnPct,
          fromSource: previous.source,
          toSource: current.source,
        })
      }
    }
    return {
      status: abnormalMoves.length > 0 ? 'failed' : 'passed',
      maxAbsDailyReturnPct: round(maxAbsDailyReturnPct, 4),
      thresholdPct,
      abnormalMoves: abnormalMoves.slice(0, 20),
    }
  }

  private maxDrawdown(closes: number[]) {
    let peak = 0
    let maxDrawdown = 0
    for (const close of closes) {
      peak = Math.max(peak, close)
      if (peak > 0) maxDrawdown = Math.min(maxDrawdown, close / peak - 1)
    }
    return maxDrawdown
  }

  private async fetchFundHoldings(symbol: string): Promise<FundLikeFactSet['holdings']> {
    const fundCode = normalizeSymbol(symbol)
    const sourceUrl = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${fundCode}&topLine=10`
    try {
      const html = await this.fetchEastmoneyF10Html(sourceUrl)
      const reportDate = html.match(/截止至：<font class='px12'>(\d{4}-\d{2}-\d{2})<\/font>/)?.[1] || null
      const topHoldings: FundLikeFactSet['holdings']['topHoldings'] = []
      const holdingRegex = /<td><a href='[^']+'>\s*([A-Za-z0-9.]+)\s*<\/a><\/td><td class='tol'><a href='[^']+'>(.*?)<\/a><\/td>[\s\S]*?<td class='tor'>([\d.]+)%<\/td><td class='tor'>([\d,.]+)<\/td><td class='tor'>([\d,.]+)<\/td>/g
      let match: RegExpExecArray | null
      while ((match = holdingRegex.exec(html)) !== null) {
        topHoldings.push({
          stockCode: match[1].trim(),
          stockName: this.stripHtml(match[2]).trim(),
          proportionPct: round(Number(match[3]), 4) || 0,
          shares: round(Number(match[4].replace(/,/g, '')), 4),
          marketValue: round(Number(match[5].replace(/,/g, '')), 4),
        })
      }
      if (!reportDate || topHoldings.length === 0) {
        return {
          status: 'missing',
          provider: 'eastmoney_f10_jjcc',
          reportDate,
          topHoldings: [],
          top10ConcentrationPct: null,
          equityHoldingCount: 0,
          holdingsStyle: 'unknown',
          sourceRefs: [sourceUrl],
          blockedReasons: ['fund_holdings_factset_missing'],
          lastError: 'provider_returned_empty_holdings',
        }
      }
      const top10ConcentrationPct = round(topHoldings.reduce((sum, holding) => sum + holding.proportionPct, 0), 4)
      return {
        status: 'available',
        provider: 'eastmoney_f10_jjcc',
        reportDate,
        topHoldings,
        top10ConcentrationPct,
        equityHoldingCount: topHoldings.length,
        holdingsStyle: this.deriveHoldingsStyle(topHoldings.length, top10ConcentrationPct),
        sourceRefs: [sourceUrl],
        blockedReasons: [],
      }
    } catch (error) {
      return {
        status: 'provider_failed',
        provider: 'eastmoney_f10_jjcc',
        reportDate: null,
        topHoldings: [],
        top10ConcentrationPct: null,
        equityHoldingCount: 0,
        holdingsStyle: 'unknown',
        sourceRefs: [sourceUrl],
        blockedReasons: ['fund_holdings_factset_missing'],
        lastError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async fetchFundProfile(symbol: string): Promise<FundLikeFactSet['profile']> {
    const fundCode = normalizeSymbol(symbol)
    const sourceUrl = `https://fundf10.eastmoney.com/jbgk_${fundCode}.html`
    try {
      const html = await this.fetchEastmoneyF10Html(sourceUrl)
      const fundCategory = this.extractTableValue(html, '基金类型') || this.extractHeaderLabel(html, '类型')
      const inceptionDate = this.extractDate(this.extractTableValue(html, '成立日期/规模') || this.extractHeaderLabel(html, '成立日期'))
      const managerText = this.extractTableValue(html, '基金经理人') || this.extractHeaderLabel(html, '基金经理')
      const managementCompany = this.extractTableValue(html, '基金管理人') || this.extractHeaderLabel(html, '管理人')
      const custodian = this.extractTableValue(html, '基金托管人')
      const fundScaleText = this.extractTableValue(html, '净资产规模') || this.extractHeaderLabel(html, '净资产规模')
      const benchmark = this.extractTableValue(html, '业绩比较基准')
      const managerNames = this.splitNames(managerText)
      if (!fundCategory || managerNames.length === 0 || !managementCompany || !fundScaleText) {
        return {
          status: 'missing',
          provider: 'eastmoney_f10_jbgk',
          fundCategory,
          inceptionDate,
          managerNames,
          managementCompany,
          custodian,
          fundScaleText,
          benchmark,
          sourceRefs: [sourceUrl],
          blockedReasons: ['fund_profile_factset_missing'],
          lastError: 'provider_returned_incomplete_profile',
        }
      }
      return {
        status: 'available',
        provider: 'eastmoney_f10_jbgk',
        fundCategory,
        inceptionDate,
        managerNames,
        managementCompany,
        custodian,
        fundScaleText,
        benchmark,
        sourceRefs: [sourceUrl],
        blockedReasons: [],
      }
    } catch (error) {
      return {
        status: 'provider_failed',
        provider: 'eastmoney_f10_jbgk',
        fundCategory: null,
        inceptionDate: null,
        managerNames: [],
        managementCompany: null,
        custodian: null,
        fundScaleText: null,
        benchmark: null,
        sourceRefs: [sourceUrl],
        blockedReasons: ['fund_profile_factset_missing'],
        lastError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async fetchFundFee(symbol: string): Promise<FundLikeFactSet['fee']> {
    const fundCode = normalizeSymbol(symbol)
    const sourceUrl = `https://fundf10.eastmoney.com/jjfl_${fundCode}.html`
    try {
      const html = await this.fetchEastmoneyF10Html(sourceUrl)
      const managementFeePct = this.extractPercent(this.extractTableValue(html, '管理费率'))
      const custodianFeePct = this.extractPercent(this.extractTableValue(html, '托管费率'))
      const salesServiceFeePct = this.extractPercent(this.extractTableValue(html, '销售服务费率'))
      if (managementFeePct === null || custodianFeePct === null || salesServiceFeePct === null) {
        return {
          status: 'missing',
          provider: 'eastmoney_f10_jjfl',
          managementFeePct,
          custodianFeePct,
          salesServiceFeePct,
          sourceRefs: [sourceUrl],
          blockedReasons: ['fund_fee_factset_missing'],
          lastError: 'provider_returned_incomplete_fee',
        }
      }
      return {
        status: 'available',
        provider: 'eastmoney_f10_jjfl',
        managementFeePct,
        custodianFeePct,
        salesServiceFeePct,
        sourceRefs: [sourceUrl],
        blockedReasons: [],
      }
    } catch (error) {
      return {
        status: 'provider_failed',
        provider: 'eastmoney_f10_jjfl',
        managementFeePct: null,
        custodianFeePct: null,
        salesServiceFeePct: null,
        sourceRefs: [sourceUrl],
        blockedReasons: ['fund_fee_factset_missing'],
        lastError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async fetchBondRiskProxy(symbol: string, assetType: string): Promise<FundLikeFactSet['bondRiskProxy']> {
    const fundCode = normalizeSymbol(symbol)
    const allocationUrl = `https://fundf10.eastmoney.com/zcpz_${fundCode}.html`
    const bondHoldingUrl = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=zqcc&code=${fundCode}&topLine=10`
    if (assetType !== 'bond' && assetType !== 'bond_fund') {
      return {
        status: 'not_applicable',
        provider: 'eastmoney_f10_zcpz_zqcc',
        method: 'top_bond_holding_name_heuristic_v1',
        latestAllocation: { reportDate: null, stockPct: null, bondPct: null, cashPct: null, netAssetBillion: null },
        topBondHoldings: [],
        topBondConcentrationPct: null,
        creditRiskFlags: [],
        sourceRefs: [allocationUrl, bondHoldingUrl],
        blockedReasons: [],
      }
    }
    try {
      const [allocationHtml, bondHtml] = await Promise.all([
        this.fetchEastmoneyF10Html(allocationUrl),
        this.fetchEastmoneyF10Html(bondHoldingUrl),
      ])
      const latestAllocation = this.parseLatestAssetAllocation(allocationHtml)
      const topBondHoldings = this.parseTopBondHoldings(bondHtml)
      const topBondConcentrationPct = round(topBondHoldings.reduce((sum, holding) => sum + holding.proportionPct, 0), 4)
      const creditRiskFlags = this.deriveCreditRiskFlags(topBondHoldings)
      if (!latestAllocation.reportDate || latestAllocation.bondPct === null || topBondHoldings.length === 0) {
        return {
          status: 'missing',
          provider: 'eastmoney_f10_zcpz_zqcc',
          method: 'top_bond_holding_name_heuristic_v1',
          latestAllocation,
          topBondHoldings,
          topBondConcentrationPct,
          creditRiskFlags,
          sourceRefs: [allocationUrl, bondHoldingUrl],
          blockedReasons: ['bond_credit_risk_proxy_missing'],
          lastError: 'provider_returned_incomplete_bond_proxy',
        }
      }
      return {
        status: 'available',
        provider: 'eastmoney_f10_zcpz_zqcc',
        method: 'top_bond_holding_name_heuristic_v1',
        latestAllocation,
        topBondHoldings,
        topBondConcentrationPct,
        creditRiskFlags,
        sourceRefs: [allocationUrl, bondHoldingUrl],
        blockedReasons: [],
      }
    } catch (error) {
      return {
        status: 'provider_failed',
        provider: 'eastmoney_f10_zcpz_zqcc',
        method: 'top_bond_holding_name_heuristic_v1',
        latestAllocation: { reportDate: null, stockPct: null, bondPct: null, cashPct: null, netAssetBillion: null },
        topBondHoldings: [],
        topBondConcentrationPct: null,
        creditRiskFlags: [],
        sourceRefs: [allocationUrl, bondHoldingUrl],
        blockedReasons: ['bond_credit_risk_proxy_missing'],
        lastError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async fetchEastmoneyF10Html(sourceUrl: string) {
    const { stdout } = await execFileAsync('curl', [
      '-L',
      '--silent',
      '--show-error',
      '--max-time',
      '15',
      '-A',
      'Mozilla/5.0',
      '-e',
      'https://fundf10.eastmoney.com/',
      sourceUrl,
    ], { maxBuffer: 2 * 1024 * 1024 })
    return stdout.toString()
  }

  private stripHtml(value: string) {
    return value
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  }

  private extractTableValue(html: string, label: string) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`<(?:th|td)[^>]*>\\s*${escaped}\\s*<\\/(?:th|td)>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i')
    const match = html.match(regex)
    return match ? this.stripHtml(match[1]) || null : null
  }

  private extractHeaderLabel(html: string, label: string) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const regex = new RegExp(`${escaped}：\\s*(?:&nbsp;)*\\s*(?:<a[^>]*>)?([\\s\\S]*?)(?:<\\/a>|<\\/span>|<\\/label>)`, 'i')
    const match = html.match(regex)
    return match ? this.stripHtml(match[1]) || null : null
  }

  private extractDate(value: string | null) {
    if (!value) return null
    const normalized = value.replace(/年/g, '-').replace(/月/g, '-').replace(/日/g, '')
    return normalized.match(/\d{4}-\d{2}-\d{2}/)?.[0] || null
  }

  private extractPercent(value: string | null) {
    if (!value) return null
    const match = value.match(/([\d.]+)\s*%/)
    return match ? round(Number(match[1]), 4) : null
  }

  private parseLatestAssetAllocation(html: string): FundLikeFactSet['bondRiskProxy']['latestAllocation'] {
    const rowMatch = html.match(/<tr><td>(\d{4}-\d{2}-\d{2})<\/td><td class="tor">([\d.]+)%<\/td><td class="tor">([\d.]+)%<\/td><td class="tor">([\d.]+)%<\/td><td class="tor">([\d.]+)<\/td><\/tr>/)
    if (!rowMatch) {
      return { reportDate: null, stockPct: null, bondPct: null, cashPct: null, netAssetBillion: null }
    }
    return {
      reportDate: rowMatch[1],
      stockPct: round(Number(rowMatch[2]), 4),
      bondPct: round(Number(rowMatch[3]), 4),
      cashPct: round(Number(rowMatch[4]), 4),
      netAssetBillion: round(Number(rowMatch[5]), 4),
    }
  }

  private parseTopBondHoldings(html: string): FundLikeFactSet['bondRiskProxy']['topBondHoldings'] {
    const holdings: FundLikeFactSet['bondRiskProxy']['topBondHoldings'] = []
    const regex = /<tr><td>\d+<\/td><td>([^<]+)<\/td><td class='tol'>(.*?)<\/td><td class='tor'>([\d.]+)%<\/td><td class='tor'>([\d,.]+)<\/td><\/tr>/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(html)) !== null) {
      holdings.push({
        bondCode: match[1].trim(),
        bondName: this.stripHtml(match[2]).trim(),
        proportionPct: round(Number(match[3]), 4) || 0,
        marketValue: round(Number(match[4].replace(/,/g, '')), 4),
      })
    }
    return holdings
  }

  private deriveCreditRiskFlags(holdings: FundLikeFactSet['bondRiskProxy']['topBondHoldings']) {
    const flags: string[] = []
    for (const holding of holdings) {
      const text = holding.bondName
      if (/二级|永续|次级|资本/i.test(text)) flags.push('subordinated_or_capital_bond_exposure')
      if (/银行|农商|城商|农信/i.test(text)) flags.push('bank_credit_exposure')
      if (/证券|券商|证/i.test(text)) flags.push('brokerage_credit_exposure')
      if (/城投|建投|交投|高投|城建|平台/i.test(text)) flags.push('local_platform_credit_exposure')
      if (/企业|公司|产业/i.test(text)) flags.push('corporate_credit_exposure')
    }
    return Array.from(new Set(flags))
  }

  private splitNames(value: string | null) {
    if (!value) return []
    return Array.from(new Set(
      value
        .split(/[、,\s]+/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0 && !item.includes('基金经理'))
    ))
  }

  private deriveHoldingsStyle(count: number, top10ConcentrationPct: number | null): FundLikeFactSet['holdings']['holdingsStyle'] {
    if (!top10ConcentrationPct || count === 0) return 'unknown'
    if (top10ConcentrationPct >= 35) return 'concentrated_equity'
    if (top10ConcentrationPct >= 8) return 'diversified_equity'
    return 'low_equity_or_bond_like'
  }

  private deriveRiskLevelProxy(
    assetType: string,
    history: HistoryPoint[],
    windows: AlternativeAssetMetricWindow[]
  ): FundLikeFactSet['riskLevelProxy'] {
    const available = windows.filter((window) => window.maxDrawdownPct !== null || window.annualizedVolatilityPct !== null)
    const latest = [...available].sort((left, right) => right.windowDays - left.windowDays)[0]
    if (history.length < 20 || !latest) {
      return {
        status: 'insufficient',
        provider: 'local_nav_risk_proxy',
        method: 'nav_drawdown_volatility_risk_level_proxy_v1',
        riskLevel: 'unknown',
        score: null,
        inputs: {
          sampleSize: history.length,
          maxDrawdownPct: null,
          annualizedVolatilityPct: null,
          assetType,
        },
        evidenceRefs: [],
        warnings: ['本地净值/价格历史不足，不能生成研究级风险等级代理。'],
      }
    }
    const maxDrawdownPct = latest.maxDrawdownPct
    const annualizedVolatilityPct = latest.annualizedVolatilityPct
    const drawdown = Math.abs(Number(maxDrawdownPct || 0))
    const volatility = Math.abs(Number(annualizedVolatilityPct || 0))
    const isBondLike = assetType === 'bond' || assetType === 'bond_fund'
    const score = round(Math.min(100, drawdown * (isBondLike ? 5 : 2.5) + volatility * (isBondLike ? 2.2 : 1.4)), 2)
    const riskLevel = score === null
      ? 'unknown'
      : isBondLike
      ? score < 18 ? 'low' : score < 38 ? 'medium' : 'high'
      : score < 28 ? 'low' : score < 55 ? 'medium' : 'high'
    return {
      status: 'available',
      provider: 'local_nav_risk_proxy',
      method: 'nav_drawdown_volatility_risk_level_proxy_v1',
      riskLevel,
      score,
      inputs: {
        sampleSize: history.length,
        maxDrawdownPct,
        annualizedVolatilityPct,
        assetType,
      },
      evidenceRefs: [`fund-risk-level-proxy:${latest.windowDays}d:${latest.endDate || 'local-history'}`],
      warnings: ['风险等级为本地净值/价格历史推导的研究级代理，不是基金公司或销售机构官方风险评级。'],
    }
  }

  private deriveDurationProxy(
    assetType: string,
    history: HistoryPoint[],
    windows: AlternativeAssetMetricWindow[],
    bondRiskProxy: FundLikeFactSet['bondRiskProxy']
  ): FundLikeFactSet['durationProxy'] {
    if (assetType !== 'bond' && assetType !== 'bond_fund') {
      return {
        status: 'not_applicable',
        provider: 'local_nav_bond_allocation_proxy',
        method: 'bond_fund_nav_volatility_allocation_duration_proxy_v1',
        durationBucket: 'unknown',
        estimatedDurationYears: null,
        confidence: 'insufficient',
        inputs: {
          sampleSize: history.length,
          annualizedVolatilityPct: null,
          maxDrawdownPct: null,
          bondPct: null,
          topBondConcentrationPct: null,
        },
        evidenceRefs: [],
        warnings: [],
      }
    }
    const available = windows.filter((window) => window.annualizedVolatilityPct !== null || window.maxDrawdownPct !== null)
    const latest = [...available].sort((left, right) => right.windowDays - left.windowDays)[0]
    if (history.length < 20 || !latest) {
      return {
        status: 'insufficient',
        provider: 'local_nav_bond_allocation_proxy',
        method: 'bond_fund_nav_volatility_allocation_duration_proxy_v1',
        durationBucket: 'unknown',
        estimatedDurationYears: null,
        confidence: 'insufficient',
        inputs: {
          sampleSize: history.length,
          annualizedVolatilityPct: null,
          maxDrawdownPct: null,
          bondPct: bondRiskProxy.latestAllocation.bondPct,
          topBondConcentrationPct: bondRiskProxy.topBondConcentrationPct,
        },
        evidenceRefs: [],
        warnings: ['本地净值/价格历史不足，不能生成债基久期代理。'],
      }
    }
    const volatility = Math.abs(Number(latest.annualizedVolatilityPct || 0))
    const drawdown = Math.abs(Number(latest.maxDrawdownPct || 0))
    const bondPct = bondRiskProxy.latestAllocation.bondPct
    const concentration = bondRiskProxy.topBondConcentrationPct
    const durationBucket = volatility < 1.8 && drawdown < 1.2
      ? 'short'
      : volatility < 3.5 && drawdown < 2.5
      ? 'medium_short'
      : volatility < 6.5 && drawdown < 5
      ? 'medium'
      : 'long'
    const estimatedDurationYears = durationBucket === 'short'
      ? 1.2
      : durationBucket === 'medium_short'
      ? 2.5
      : durationBucket === 'medium'
      ? 4
      : 6
    return {
      status: 'available',
      provider: 'local_nav_bond_allocation_proxy',
      method: 'bond_fund_nav_volatility_allocation_duration_proxy_v1',
      durationBucket,
      estimatedDurationYears,
      confidence: 'low',
      inputs: {
        sampleSize: history.length,
        annualizedVolatilityPct: latest.annualizedVolatilityPct,
        maxDrawdownPct: latest.maxDrawdownPct,
        bondPct,
        topBondConcentrationPct: concentration,
      },
      evidenceRefs: [
        `bond-duration-proxy:${latest.windowDays}d:${latest.endDate || 'local-history'}`,
        ...(bondRiskProxy.status === 'available' ? [`bond-risk-proxy:${bondRiskProxy.latestAllocation.reportDate || 'bond-holdings'}`] : []),
      ],
      warnings: ['久期为本地净值波动/回撤和债券配置推导的研究级代理，不是组合披露的真实加权久期或到期收益率。'],
    }
  }

  private fundMissingFields(
    assetType: string,
    history: HistoryPoint[],
    windows: AlternativeAssetMetricWindow[],
    profile: FundLikeFactSet['profile'],
    fee: FundLikeFactSet['fee'],
    bondRiskProxy: FundLikeFactSet['bondRiskProxy'],
    holdings: FundLikeFactSet['holdings'],
    riskLevelProxy: FundLikeFactSet['riskLevelProxy'],
    durationProxy: FundLikeFactSet['durationProxy']
  ) {
    return [
      ...(history.length < 20 ? ['navHistory'] : []),
      ...(windows.some((window) => window.maxDrawdownPct === null) ? ['drawdown'] : []),
      ...(windows.some((window) => window.annualizedVolatilityPct === null) ? ['volatility'] : []),
      ...(fee.status === 'available' ? [] : ['fee']),
      ...(profile.managerNames.length > 0 ? [] : ['manager']),
      ...(profile.fundScaleText ? [] : ['fundScale']),
      ...(riskLevelProxy.status === 'available' ? [] : ['riskLevelProxy']),
      ...(holdings.status === 'available' ? [] : ['holdingsStyle']),
      ...(['bond', 'bond_fund'].includes(assetType) && durationProxy.status !== 'available' ? ['durationProxy'] : []),
      ...(['bond', 'bond_fund'].includes(assetType) && bondRiskProxy.status !== 'available' ? ['creditRiskProxy'] : []),
    ]
  }

  private fundType(assetType: string): FundLikeFactSet['fundType'] {
    if (assetType === 'bond' || assetType === 'bond_fund') return assetType
    if (assetType === 'fund' || assetType === 'etf') return assetType
    return 'unknown'
  }

  private historySummary(history: HistoryPoint[]) {
    return {
      source: Array.from(new Set(history.map((point) => point.source))).join(',') || 'local_history_missing',
      sampleSize: history.length,
      firstDate: formatDate(history[0]?.date),
      latestDate: formatDate(history[history.length - 1]?.date),
    }
  }

  private evidenceRefs(position: PositionLike, history: HistoryPoint[], scope: string) {
    return [
      `alternative-factset:${scope}:${normalizeSymbol(position.asset.symbol)}`,
      ...(history.length > 0 ? [`local-history:${position.assetId}:${formatDate(history[0].date)}:${formatDate(history[history.length - 1].date)}`] : []),
    ]
  }

  private sourceRefs(history: HistoryPoint[]) {
    return Array.from(new Set(history.map((point) => point.source)))
  }
}

export const alternativeAssetFactsetService = new AlternativeAssetFactsetService()
