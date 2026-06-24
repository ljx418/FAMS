import type { DividendLowVolInput, DividendLowVolScores } from './dividendLowVolTypes.js'

function finite(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

function round(value: number | null | undefined, precision = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function percentileFromRange(value: number | undefined, low: number, high: number) {
  if (value === undefined) return undefined
  return clamp(((value - low) / (high - low)) * 100)
}

function inversePercentile(value: number | undefined, low: number, high: number) {
  const percentile = percentileFromRange(value, low, high)
  return percentile === undefined ? undefined : clamp(100 - percentile)
}

function closes(history: DividendLowVolInput['history']) {
  return (history || []).map((item) => finite(item.close)).filter((item): item is number => item !== undefined && item > 0)
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, item) => sum + item, 0) / values.length : undefined
}

function movingAverage(values: number[], days: number) {
  const slice = values.slice(-days)
  return round(mean(slice))
}

function annualizedVolatility(values: number[], days: number) {
  const slice = values.slice(-(days + 1))
  if (slice.length < Math.min(days, 20)) return undefined
  const returns: number[] = []
  for (let index = 1; index < slice.length; index += 1) {
    const previous = slice[index - 1]
    if (previous > 0) returns.push((slice[index] - previous) / previous)
  }
  const avg = mean(returns)
  if (avg === undefined || returns.length < 2) return undefined
  const variance = returns.reduce((sum, item) => sum + ((item - avg) ** 2), 0) / (returns.length - 1)
  return round(Math.sqrt(variance) * Math.sqrt(252) * 100)
}

function maxDrawdown(values: number[], days: number) {
  const slice = values.slice(-days)
  if (slice.length < Math.min(days, 20)) return undefined
  let peak = slice[0]
  let drawdown = 0
  for (const value of slice) {
    peak = Math.max(peak, value)
    if (peak > 0) drawdown = Math.min(drawdown, ((value - peak) / peak) * 100)
  }
  return round(Math.abs(drawdown))
}

function rsi(values: number[], days = 14) {
  const slice = values.slice(-(days + 1))
  if (slice.length < days + 1) return undefined
  let gains = 0
  let losses = 0
  for (let index = 1; index < slice.length; index += 1) {
    const change = slice[index] - slice[index - 1]
    if (change >= 0) gains += change
    else losses += Math.abs(change)
  }
  if (losses === 0) return 100
  return round(100 - (100 / (1 + (gains / losses))))
}

function drawdownFromHigh(values: number[], days: number) {
  const slice = values.slice(-days)
  const latest = slice.at(-1)
  const high = slice.length ? Math.max(...slice) : undefined
  if (!latest || !high || high <= 0) return undefined
  return round(((high - latest) / high) * 100)
}

function weighted(parts: Array<[number | undefined, number]>, fallback = 0) {
  let score = 0
  let weight = 0
  for (const [value, partWeight] of parts) {
    if (value === undefined) continue
    score += value * partWeight
    weight += partWeight
  }
  return round(weight > 0 ? score / weight : fallback) || 0
}

function payoutSafetyScore(payoutRatio: number | undefined, industry?: string) {
  if (payoutRatio === undefined) return undefined
  const matureIndustry = /银行|保险|公用|高速|电力|水务|燃气|货币金融/.test(industry || '')
  const upper = matureIndustry ? 90 : 80
  if (payoutRatio < 0 || payoutRatio > 100) return 0
  if (payoutRatio >= 35 && payoutRatio <= 65) return 100
  if (payoutRatio >= 20 && payoutRatio < 35) return 70 + ((payoutRatio - 20) / 15) * 30
  if (payoutRatio > 65 && payoutRatio <= upper) return 100 - ((payoutRatio - 65) / Math.max(upper - 65, 1)) * 40
  return 0
}

export class DividendLowVolScoringService {
  deriveMarketMetrics(input: DividendLowVolInput) {
    const series = closes(input.history)
    const latestPrice = finite(input.price) ?? series.at(-1)
    const allDividendRecords = [...(input.dividendRecords || [])]
      .filter((item) => Number.isFinite(item.year) && Number.isFinite(item.dividendPerShare))
      .sort((a, b) => a.year - b.year)
    const positiveDividendRecords = allDividendRecords.filter((item) => item.dividendPerShare > 0)
    const dividendYears = new Set(positiveDividendRecords.map((item) => item.year)).size
    const consecutiveDividendYears = this.consecutiveYears(positiveDividendRecords.map((item) => item.year))
    const recentThree = positiveDividendRecords.slice(-3)
    const recentDividendEvidence = allDividendRecords.slice(-3)
    const ttmDividendPerShare = finite(input.ttmDividendPerShare) ?? recentDividendEvidence.at(-1)?.dividendPerShare
    const ttmDividendYield = latestPrice && ttmDividendPerShare !== undefined ? round((ttmDividendPerShare / latestPrice) * 100) : undefined
    const avgDividendYield3y = latestPrice && recentDividendEvidence.length > 0
      ? round(((recentDividendEvidence.reduce((sum, item) => sum + item.dividendPerShare, 0) / recentDividendEvidence.length) / latestPrice) * 100)
      : undefined
    const first = recentThree.at(0)?.dividendPerShare
    const last = recentThree.at(-1)?.dividendPerShare
    const dpsGrowth3y = first && last ? round(((last - first) / first) * 100) : undefined
    const volatility60d = annualizedVolatility(series, 60)
    const volatility120d = annualizedVolatility(series, 120)
    const volatility250d = annualizedVolatility(series, 250)
    const maxDrawdown60d = maxDrawdown(series, 60)
    const maxDrawdown250d = maxDrawdown(series, 250)
    const drawdownFrom250dHigh = drawdownFromHigh(series, 250)
    const ma20 = movingAverage(series, 20)
    const ma60 = movingAverage(series, 60)
    const ma120 = movingAverage(series, 120)
    const ma250 = movingAverage(series, 250)
    const rsi14 = rsi(series)
    const dividendYieldPercentile3y = percentileFromRange(ttmDividendYield, 1, 7)

    return {
      latestPrice,
      dividendYears,
      consecutiveDividendYears,
      ttmDividendYield,
      avgDividendYield3y,
      dividendYieldPercentile3y,
      dpsGrowth3y,
      volatility60d,
      volatility120d,
      volatility250d,
      maxDrawdown60d,
      maxDrawdown250d,
      drawdownFrom250dHigh,
      ma20,
      ma60,
      ma120,
      ma250,
      rsi14,
    }
  }

  score(input: DividendLowVolInput, metrics = this.deriveMarketMetrics(input)): DividendLowVolScores {
    const payoutRatio = finite(input.payoutRatio)
    const operatingCashFlowToNetProfit = finite(input.operatingCashFlowToNetProfit)
    const roe = finite(input.roe)
    const debtToAsset = finite(input.debtToAsset)
    const pe = finite(input.pe)
    const pb = finite(input.pb)
    const dividendYieldScore = metrics.ttmDividendYield === undefined ? undefined : clamp(((metrics.ttmDividendYield - 4) / (8 - 4)) * 100)
    const avgDividendYieldScore = metrics.avgDividendYield3y === undefined ? undefined : clamp(((metrics.avgDividendYield3y - 3.5) / (7 - 3.5)) * 100)
    const consecutiveDividendYearsScore = clamp((metrics.consecutiveDividendYears / 10) * 100)
    const dpsGrowthScore = percentileFromRange(metrics.dpsGrowth3y, -20, 20)
    const dividendStabilityScore = input.dividendRecords && input.dividendRecords.length >= 3 ? 80 : input.dividendRecords?.length ? 45 : 0

    const dividendScore = weighted([
      [dividendYieldScore, 0.45],
      [avgDividendYieldScore, 0.25],
      [consecutiveDividendYearsScore, 0.15],
      [dpsGrowthScore, 0.1],
      [dividendStabilityScore, 0.05],
    ])
    const payoutRatioSafety = payoutSafetyScore(payoutRatio, input.industry)
    const financialIndustry = /银行|保险|货币金融|证券/.test(input.industry || '')
    const cashflowCoverage = operatingCashFlowToNetProfit === undefined
      ? (financialIndustry ? 70 : undefined)
      : clamp(((operatingCashFlowToNetProfit - 0.8) / (1.5 - 0.8)) * 100)
    const earningsStability = percentileFromRange(finite(input.profitGrowth3y), -30, 30)
    const debtSafety = debtToAsset === undefined ? undefined : clamp(100 - debtToAsset)
    const roeQuality = percentileFromRange(roe, 0, 20)
    const dividendQualityScore = weighted([
      [payoutRatioSafety, 0.25],
      [cashflowCoverage, 0.25],
      [earningsStability, 0.2],
      [debtSafety, 0.15],
      [roeQuality, 0.15],
    ])
    const lowVolScore = weighted([
      [inversePercentile(metrics.volatility250d, 8, 55), 0.35],
      [inversePercentile(metrics.volatility120d, 8, 55), 0.25],
      [inversePercentile(metrics.maxDrawdown250d, 5, 60), 0.2],
      [70, 0.1],
      [input.history?.some((item) => (item.amount || 0) > 0) ? 70 : 45, 0.1],
    ])
    const marketCapScore = input.totalMarketCap === undefined ? undefined : clamp(((input.totalMarketCap / 100_000_000) - 100) / (3000 - 100) * 100)
    const turnoverScore = input.avgTurnoverAmount60 === undefined ? undefined : clamp((input.avgTurnoverAmount60 - 50_000_000) / (500_000_000 - 50_000_000) * 100)
    const leaderScore = input.leaderScore ?? weighted([
      [input.marketCapRankScore ?? marketCapScore, 0.3],
      [input.revenueRankScore, 0.25],
      [input.netProfitRankScore, 0.25],
      [input.roeIndustryPercentile ?? roeQuality, 0.1],
      [input.liquidityRankScore ?? turnoverScore, 0.1],
    ], input.industry && marketCapScore !== undefined ? marketCapScore : 0)
    const dividendYieldHistoricalPercentile = metrics.dividendYieldPercentile3y
    const pbCheapness = pb === undefined ? undefined : clamp(100 - ((pb - 0.5) / 5) * 100)
    const peCheapness = pe === undefined ? undefined : clamp(100 - ((pe - 5) / 45) * 100)
    const valuationScore = weighted([
      [dividendYieldHistoricalPercentile, 0.4],
      [pbCheapness, 0.2],
      [peCheapness, 0.15],
      [finite(input.industryDividendYieldPercentile), 0.15],
      [payoutRatioSafety, 0.1],
    ])
    const lowZoneScore = weighted([
      [dividendYieldHistoricalPercentile, 0.35],
      [valuationScore, 0.25],
      [metrics.drawdownFrom250dHigh ? clamp((metrics.drawdownFrom250dHigh / 25) * 100) : undefined, 0.2],
      [lowVolScore, 0.2],
    ])
    const highZoneScore = weighted([
      [dividendYieldHistoricalPercentile === undefined ? undefined : 100 - dividendYieldHistoricalPercentile, 0.35],
      [valuationScore === undefined ? undefined : 100 - valuationScore, 0.25],
      [metrics.rsi14, 0.2],
      [metrics.ma250 && metrics.latestPrice ? clamp(((metrics.latestPrice - metrics.ma250) / metrics.ma250) * 100 * 3) : undefined, 0.2],
    ])
    const riskScore = weighted([
      [payoutRatioSafety, 0.25],
      [cashflowCoverage, 0.25],
      [debtSafety, 0.2],
      [lowVolScore, 0.2],
      [input.isST || input.isSuspended || input.isDelisted ? 0 : 90, 0.1],
    ])
    const financialRiskScore = clamp(100 - riskScore)
    const portfolioFitScore = input.positionWeightPercent === undefined ? 70 : input.positionWeightPercent <= 5 ? 80 : input.positionWeightPercent <= 10 ? 55 : 20
    const evidenceQualityScore = this.evidenceQuality(input, metrics)
    const timingScore = Math.max(lowZoneScore, highZoneScore >= 70 ? highZoneScore : 0)
    const totalResearchScore = weighted([
      [leaderScore, 0.2],
      [dividendScore, 0.2],
      [dividendQualityScore, 0.2],
      [lowVolScore, 0.15],
      [valuationScore, 0.1],
      [timingScore, 0.1],
      [evidenceQualityScore, 0.05],
    ]) - (financialRiskScore * 0.2)
    const evidenceAdjustedScore = round(totalResearchScore * (0.45 + evidenceQualityScore / 180)) || 0
    return {
      dividendScore,
      leaderScore,
      dividendQualityScore,
      lowVolScore,
      valuationScore,
      timingScore,
      riskScore,
      financialRiskScore,
      portfolioFitScore,
      evidenceQualityScore,
      totalResearchScore: round(totalResearchScore) || 0,
      evidenceAdjustedScore,
    }
  }

  deriveBlockedReasons(input: DividendLowVolInput, metrics = this.deriveMarketMetrics(input), scores = this.score(input, metrics)) {
    const noCashDividendConfirmed = input.dividendRecords && input.dividendRecords.length >= 3 && input.dividendRecords.every((item) => item.dividendPerShare === 0)
    return [
      ...(!/^\d{6}$/.test(input.symbol) ? ['asset_identity_missing'] : []),
      ...(input.assetType && input.assetType !== 'stock' ? ['unsupported_asset_type'] : []),
      ...(input.isST ? ['security_status_st_or_risk'] : []),
      ...(input.isSuspended ? ['security_suspended'] : []),
      ...(input.isDelisted ? ['security_delisted'] : []),
      ...(input.listingAgeDays !== undefined && input.listingAgeDays < 365 * 3 ? ['listing_age_less_than_3y'] : []),
      ...(metrics.consecutiveDividendYears < 3 && !noCashDividendConfirmed ? ['dividend_history_insufficient'] : []),
      ...(noCashDividendConfirmed ? ['no_cash_dividend_confirmed'] : []),
      ...(metrics.ttmDividendYield === undefined ? ['dividend_yield_missing_or_zero'] : []),
      ...(metrics.ttmDividendYield !== undefined && metrics.ttmDividendYield < 4 ? ['dividend_yield_below_4_percent'] : []),
      ...(metrics.avgDividendYield3y !== undefined && metrics.avgDividendYield3y < 3.5 ? ['avg_dividend_yield_3y_below_3_5_percent'] : []),
      ...((scores.leaderScore || 0) < 75 ? ['industry_leader_score_below_75'] : []),
      ...(input.avgTurnoverAmount60 !== undefined && input.avgTurnoverAmount60 < 50_000_000 ? ['avg_turnover_60d_below_50m'] : []),
      ...(input.totalMarketCap !== undefined && input.totalMarketCap < 10_000_000_000 ? ['market_cap_below_10b'] : []),
      ...(input.payoutRatio !== undefined && input.payoutRatio < 0 ? ['payout_ratio_negative'] : []),
      ...(input.payoutRatio !== undefined && input.payoutRatio > 100 ? ['payout_ratio_extreme_high'] : []),
      ...(input.payoutRatio !== undefined && input.payoutRatio < 20 ? ['payout_ratio_below_20'] : []),
      ...(input.payoutRatio !== undefined && input.payoutRatio > (/银行|保险|货币金融|公用|高速|电力/.test(input.industry || '') ? 90 : 80) ? ['payout_ratio_above_policy_band'] : []),
      ...(metrics.dpsGrowth3y !== undefined && metrics.dpsGrowth3y < 0 ? ['dps_growth_negative'] : []),
      ...(input.operatingCashFlowToNetProfit !== undefined && input.operatingCashFlowToNetProfit < 0.8 && !/银行|保险|货币金融|证券/.test(input.industry || '') ? ['cashflow_dividend_coverage_weak'] : []),
      ...(metrics.maxDrawdown250d !== undefined && metrics.maxDrawdown250d > 35 ? ['max_drawdown_250d_above_35'] : []),
      ...(metrics.maxDrawdown60d !== undefined && metrics.maxDrawdown60d > 18 ? ['max_drawdown_60d_above_18'] : []),
      ...(scores.lowVolScore < 60 ? ['low_vol_score_below_60'] : []),
      ...(scores.evidenceQualityScore < 50 ? ['dividend_low_vol_evidence_insufficient'] : []),
    ]
  }

  deriveDisposition(input: DividendLowVolInput, factSet: {
    blockedReasons: string[]
    scores: DividendLowVolScores
    timing: { rsi14?: number; highZoneScore: number }
    dividend: { dividendYieldPercentile3y?: number }
    quality: { financialRiskFlags: string[] }
  }) {
    if (factSet.blockedReasons.includes('dividend_yield_missing_or_zero')) return 'data_insufficient'
    if (
      factSet.blockedReasons.includes('dividend_history_insufficient')
      && !factSet.blockedReasons.includes('dividend_yield_below_4_percent')
      && !factSet.blockedReasons.includes('avg_dividend_yield_3y_below_3_5_percent')
      && !factSet.blockedReasons.includes('no_cash_dividend_confirmed')
    ) return 'data_insufficient'
    if (factSet.blockedReasons.some((reason) => [
      'security_status_st_or_risk',
      'security_suspended',
      'security_delisted',
      'listing_age_less_than_3y',
      'payout_ratio_negative',
      'payout_ratio_extreme_high',
      'payout_ratio_above_policy_band',
      'cashflow_dividend_coverage_weak',
      'industry_leader_score_below_75',
      'dividend_yield_below_4_percent',
      'avg_dividend_yield_3y_below_3_5_percent',
      'dps_growth_negative',
      'dividend_trap_risk',
      'dividend_cut_over_20_percent',
      'dps_consecutive_decline',
      'special_dividend_suspected',
      'max_drawdown_250d_above_35',
      'max_drawdown_60d_above_18',
      'low_vol_score_below_60',
      'no_cash_dividend_confirmed',
    ].includes(reason))) return 'avoid'
    if (factSet.quality.financialRiskFlags.length > 0 && factSet.scores.riskScore < 45) return 'exit_dividend_risk'
    if ((factSet.dividend.dividendYieldPercentile3y || 0) <= 25 && factSet.scores.valuationScore <= 40 && (factSet.timing.rsi14 || 0) > 70) return 'trim_high_zone'
    if ((factSet.dividend.dividendYieldPercentile3y || 0) >= 75 && factSet.scores.valuationScore >= 70 && factSet.scores.dividendQualityScore >= 70 && factSet.scores.lowVolScore >= 65) {
      return input.positionWeightPercent && input.positionWeightPercent > 0 ? 'add_on_pullback' : 'build_position_plan'
    }
    if ((factSet.dividend.dividendYieldPercentile3y || 0) >= 65 && factSet.scores.valuationScore >= 60 && factSet.scores.lowVolScore >= 60) return 'low_zone_alert'
    if (factSet.timing.highZoneScore >= 75 && (factSet.dividend.dividendYieldPercentile3y || 100) <= 35) return 'trim_high_zone'
    if (factSet.scores.leaderScore !== undefined && factSet.scores.leaderScore >= 75 && factSet.scores.lowVolScore >= 60 && factSet.scores.evidenceQualityScore >= 60) return 'watch_candidate'
    if (factSet.scores.dividendScore >= 70 && factSet.scores.dividendQualityScore >= 65 && factSet.scores.lowVolScore >= 60) return 'watch_candidate'
    return 'data_insufficient'
  }

  private consecutiveYears(years: number[]) {
    if (years.length === 0) return 0
    const unique = Array.from(new Set(years)).sort((a, b) => b - a)
    let count = 1
    for (let index = 1; index < unique.length; index += 1) {
      if (unique[index] === unique[index - 1] - 1) count += 1
      else break
    }
    return count
  }

  private evidenceQuality(input: DividendLowVolInput, metrics: ReturnType<DividendLowVolScoringService['deriveMarketMetrics']>) {
    let score = 0
    if ((input.dividendRecords || []).length >= 3) score += 30
    else if ((input.dividendRecords || []).length > 0) score += 12
    if (metrics.ttmDividendYield !== undefined) score += 15
    if (input.payoutRatio !== undefined) score += 12
    if (input.operatingCashFlowToNetProfit !== undefined) score += 12
    if (input.roe !== undefined || input.debtToAsset !== undefined) score += 10
    if ((input.history || []).length >= 120) score += 16
    else if ((input.history || []).length >= 60) score += 8
    if ((input.evidenceRefs || []).length > 0) score += 5
    return clamp(score)
  }
}

export const dividendLowVolScoringService = new DividendLowVolScoringService()
