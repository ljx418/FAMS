import { dividendLowVolStrategyService } from './dividendLowVolStrategyService.js'
import type {
  DividendLowVolFactSet,
  DividendLowVolInput,
  DividendLowVolRollingBacktestResult,
  DividendLowVolTradingZonePriceAudit,
  DividendLowVolTradingZoneResult,
  DividendLowVolTradingZoneSignal,
  DividendLowVolTradingZoneStrategy,
  DividendLowVolTradingZoneStrategyId,
} from './dividendLowVolTypes.js'

type Bar = NonNullable<DividendLowVolInput['history']>[number]

const POLICY = {
  allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'] as const,
  prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'] as const,
}

function finite(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function round(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function mean(values: number[]) {
  return values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : undefined
}

function roundOptional(value: number | null | undefined, digits = 2) {
  const rounded = round(value, digits)
  return rounded === null ? undefined : rounded
}

function std(values: number[]) {
  const avg = mean(values)
  if (avg === undefined || values.length < 2) return undefined
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

function movingAverage(values: number[], days: number, index = values.length - 1) {
  const end = index + 1
  const start = end - days
  if (start < 0) return undefined
  return mean(values.slice(start, end))
}

function rsi(values: number[], days = 14, index = values.length - 1) {
  if (index < days) return undefined
  let gains = 0
  let losses = 0
  for (let cursor = index - days + 1; cursor <= index; cursor += 1) {
    const change = values[cursor] - values[cursor - 1]
    if (change >= 0) gains += change
    else losses += Math.abs(change)
  }
  if (losses === 0) return 100
  const rs = gains / losses
  return 100 - (100 / (1 + rs))
}

function atrRatio(history: Bar[], days = 14, index = history.length - 1) {
  if (index < days) return undefined
  const ranges: number[] = []
  for (let cursor = index - days + 1; cursor <= index; cursor += 1) {
    const previous = history[cursor - 1]?.close ?? history[cursor].close
    const high = history[cursor].high
    const low = history[cursor].low
    ranges.push(Math.max(high - low, Math.abs(high - previous), Math.abs(low - previous)))
  }
  const atr = mean(ranges)
  const price = history[index]?.close
  return atr !== undefined && price > 0 ? atr / price : undefined
}

function bollinger(values: number[], days = 20, width = 2, index = values.length - 1) {
  const end = index + 1
  const start = end - days
  if (start < 0) return undefined
  const window = values.slice(start, end)
  const middle = mean(window)
  const deviation = std(window)
  if (middle === undefined || deviation === undefined) return undefined
  const upper = middle + width * deviation
  const lower = middle - width * deviation
  const price = values[index]
  const percentB = upper === lower ? undefined : (price - lower) / (upper - lower)
  return { lower, middle, upper, percentB }
}

function maxDrawdownFromReturns(returns: number[]) {
  let equity = 1
  let peak = 1
  let maxDrawdown = 0
  for (const tradeReturn of returns) {
    equity *= 1 + tradeReturn
    peak = Math.max(peak, equity)
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1)
  }
  return maxDrawdown * 100
}

function annualizedReturn(totalReturn: number, tradingDays: number) {
  if (tradingDays <= 0) return 0
  return ((1 + totalReturn) ** (252 / tradingDays) - 1) * 100
}

function latestEvidenceDate(evidenceRefs: string[]) {
  const dates = evidenceRefs
    .flatMap((ref) => Array.from(ref.matchAll(/20\d{2}-\d{2}-\d{2}/g)).map((match) => match[0]))
    .sort()
  return dates.at(-1)
}

function daysBetween(date: string, now = new Date()) {
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) return undefined
  return Math.floor((Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - parsed.getTime()) / (24 * 60 * 60 * 1000))
}

function isTradable(bar: Bar, side: 'buy' | 'sell') {
  if (bar.isTradable === false || bar.isSuspended === true || bar.tradabilityStatus === 'suspended') return false
  if (side === 'buy' && bar.tradabilityStatus === 'limit_up_blocked') return false
  if (side === 'sell' && bar.tradabilityStatus === 'limit_down_blocked') return false
  return true
}

export class DividendLowVolTradingZoneService {
  buildTradingZones(inputs: DividendLowVolInput[], options: { limit?: number } = {}): DividendLowVolTradingZoneResult {
    const generatedAt = new Date().toISOString()
    const pool = dividendLowVolStrategyService.buildCandidatePool(inputs)
    const inputBySymbol = new Map(inputs.map((input) => [input.symbol, input]))
    const limit = Math.max(1, Math.min(500, Number(options.limit || 120)))
    const zones = pool.candidates.slice(0, limit).map((candidate) => {
      const input = inputBySymbol.get(candidate.identity.symbol)
      return {
        symbol: candidate.identity.symbol,
        name: candidate.identity.name,
        industry: candidate.identity.industry,
        price: candidate.timing.price,
        candidateGrade: candidate.candidateGrade,
        disposition: candidate.disposition,
        evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
        priceAudit: this.buildPriceAudit(candidate, input?.history || [], candidate.evidenceRefs),
        strategies: this.buildStrategies(candidate, input?.history || [], candidate.evidenceRefs),
        prohibitedActions: [...POLICY.prohibitedActions],
        notTradingAdvice: true as const,
      }
    })
    return {
      schemaVersion: 'dividend.low_vol.trading_zone.v1',
      generatedAt,
      strategyFamily: 'dividend_low_volatility',
      strategyId: 'dividend_low_vol_leader_v1',
      totalCandidates: pool.total,
      zones,
      policy: {
        allowedActions: [...POLICY.allowedActions],
        prohibitedActions: [...POLICY.prohibitedActions],
      },
      notTradingAdvice: true,
    }
  }

  buildTradingZonesFromFactSets(candidates: DividendLowVolFactSet[], options: { limit?: number } = {}): DividendLowVolTradingZoneResult {
    const generatedAt = new Date().toISOString()
    const limit = Math.max(1, Math.min(500, Number(options.limit || 120)))
    const selected = [...candidates]
      .sort((left, right) => right.scores.evidenceAdjustedScore - left.scores.evidenceAdjustedScore)
      .slice(0, limit)
    return {
      schemaVersion: 'dividend.low_vol.trading_zone.v1',
      generatedAt,
      strategyFamily: 'dividend_low_volatility',
      strategyId: 'dividend_low_vol_leader_v1',
      totalCandidates: candidates.length,
      zones: selected.map((candidate) => ({
        symbol: candidate.identity.symbol,
        name: candidate.identity.name,
        industry: candidate.identity.industry,
        price: candidate.timing.price,
        candidateGrade: candidate.candidateGrade,
        disposition: candidate.disposition,
        evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
        priceAudit: this.buildPriceAudit(candidate, [], candidate.evidenceRefs),
        strategies: this.buildStrategies(candidate, [], candidate.evidenceRefs),
        prohibitedActions: [...POLICY.prohibitedActions],
        notTradingAdvice: true,
      })),
      policy: {
        allowedActions: [...POLICY.allowedActions],
        prohibitedActions: [...POLICY.prohibitedActions],
      },
      notTradingAdvice: true,
    }
  }

  runRollingBacktest(inputs: DividendLowVolInput[], options: { years?: number; minRequiredTradingDays?: number } = {}): DividendLowVolRollingBacktestResult {
    const generatedAt = new Date().toISOString()
    const years = Math.max(1, Math.min(5, Number(options.years || 3)))
    const requestedTradingDays = years * 252
    const minRequiredTradingDays = Math.max(120, Math.min(requestedTradingDays, Number(options.minRequiredTradingDays || Math.round(requestedTradingDays * 0.8))))
    const pool = dividendLowVolStrategyService.buildCandidatePool(inputs)
    const inputBySymbol = new Map(inputs.map((input) => [input.symbol, input]))
    const candidates = pool.candidates.filter((candidate) => candidate.disposition !== 'avoid' && candidate.disposition !== 'data_insufficient')
    const strategyResults = ([
      'dividend_low_vol_bollinger_reversion_v1',
      'dividend_low_vol_yield_ma_reversion_v1',
    ] as DividendLowVolTradingZoneStrategyId[]).map((strategyId) => this.backtestStrategy(strategyId, candidates, inputBySymbol, requestedTradingDays, minRequiredTradingDays))
    const completed = strategyResults.filter((item) => item.status === 'completed')
    const best = completed
      .filter((item) => item.metrics.winRatePercent !== null)
      .sort((left, right) => (right.metrics.winRatePercent || 0) - (left.metrics.winRatePercent || 0) || (right.metrics.excessReturnPercent || 0) - (left.metrics.excessReturnPercent || 0))[0]
    const researchPassed = Boolean(best && (best.metrics.winRatePercent || 0) >= 55 && best.sample.tradeCount >= 10 && (best.metrics.totalReturnPercent || 0) > 0)
    const maxEffectiveTradingDays = Math.max(0, ...inputs.map((input) => input.history?.length || 0))
    return {
      schemaVersion: 'dividend.low_vol.rolling_backtest.v1',
      generatedAt,
      strategyFamily: 'dividend_low_volatility',
      strategyId: 'dividend_low_vol_leader_v1',
      status: completed.length > 0 ? 'completed' : 'insufficient',
      window: {
        requestedYears: years,
        requestedTradingDays,
        minRequiredTradingDays,
        maxEffectiveTradingDays,
      },
      strategyResults,
      conclusion: {
        bestStrategyId: best?.strategyId || null,
        researchPassed,
        reason: best
          ? `Best research model is ${best.label}; winRate=${best.metrics.winRatePercent}%, totalReturn=${best.metrics.totalReturnPercent}%, formal actions remain locked.`
          : `No strategy has enough ${years}-year history and executable rolling signals.`,
      },
      policy: {
        allowedActions: [...POLICY.allowedActions],
        prohibitedActions: [...POLICY.prohibitedActions],
      },
      notTradingAdvice: true,
    }
  }

  private buildStrategies(candidate: DividendLowVolFactSet, history: Bar[], evidenceRefs: string[]): DividendLowVolTradingZoneStrategy[] {
    return [
      this.buildBollingerStrategy(candidate, history, evidenceRefs),
      this.buildYieldMaStrategy(candidate, history, evidenceRefs),
    ]
  }

  private buildBollingerStrategy(candidate: DividendLowVolFactSet, history: Bar[], evidenceRefs: string[]): DividendLowVolTradingZoneStrategy {
    const closes = history.map((bar) => bar.close).filter((value) => Number.isFinite(value))
    const bands = bollinger(closes)
    const price = finite(candidate.timing.price) ?? closes.at(-1)
    if (!bands || price === undefined) return this.insufficientStrategy('dividend_low_vol_bollinger_reversion_v1', '布林低吸高抛模型', 'requires at least 20 valid closes', evidenceRefs, this.buildPriceAudit(candidate, history, evidenceRefs))
    const priceAudit = this.buildPriceAudit(candidate, history, evidenceRefs, bands.middle)
    if (priceAudit.sanityStatus !== 'aligned') {
      return this.insufficientStrategy('dividend_low_vol_bollinger_reversion_v1', '布林低吸高抛模型', priceAudit.warnings[0] || 'price source failed sanity check', evidenceRefs, priceAudit)
    }
    const buyLow = bands.lower * 0.98
    const buyHigh = Math.min(bands.middle, bands.lower * 1.03)
    const sellLow = bands.upper * 0.98
    const sellHigh = bands.upper * 1.03
    const stopLoss = Math.min(candidate.timing.ma250 ? candidate.timing.ma250 * 0.94 : bands.lower * 0.94, buyLow * 0.96)
    const signal = this.zoneSignal(price, buyHigh, sellLow, stopLoss, candidate)
    return {
      strategyId: 'dividend_low_vol_bollinger_reversion_v1',
      label: '布林低吸高抛模型',
      status: 'available',
      currentSignal: signal,
      buyZone: {
        low: round(buyLow),
        high: round(buyHigh),
        rationale: ['价格接近 20 日布林下轨时观察低吸区间', '只对已通过红利低波候选过滤的标的生效'],
      },
      sellZone: {
        low: round(sellLow),
        high: round(sellHigh),
        rationale: ['价格接近 20 日布林上轨时进入高位/滚动卖出观察区', '高位分或分红质量恶化时优先风险提醒'],
      },
      stopLoss: round(stopLoss),
      indicators: {
        price: roundOptional(price),
        bollingerLower: roundOptional(bands.lower),
        bollingerMiddle: roundOptional(bands.middle),
        bollingerUpper: roundOptional(bands.upper),
        bollingerPercentB: roundOptional(bands.percentB, 3),
        ma120: roundOptional(candidate.timing.ma120),
        ma250: roundOptional(candidate.timing.ma250),
        rsi14: roundOptional(candidate.timing.rsi14),
        atrRatio: roundOptional(atrRatio(history), 4),
        dividendYieldHistoricalPercentile: roundOptional(candidate.dividend.dividendYieldPercentile3y),
        lowZoneScore: roundOptional(candidate.timing.lowZoneScore),
        highZoneScore: roundOptional(candidate.timing.highZoneScore),
      },
      priceAudit,
      invalidationConditions: ['分红质量恶化', '跌破止损区间且 10 日内无法收复', 'validation_evidence 未通过时不得升级为正式交易动作'],
      evidenceRefs: [...new Set([...evidenceRefs, `trading-zone:bollinger:${candidate.identity.symbol}:20d:2std`])],
    }
  }

  private buildYieldMaStrategy(candidate: DividendLowVolFactSet, history: Bar[], evidenceRefs: string[]): DividendLowVolTradingZoneStrategy {
    const closes = history.map((bar) => bar.close).filter((value) => Number.isFinite(value))
    const price = finite(candidate.timing.price) ?? closes.at(-1)
    const ma120 = finite(candidate.timing.ma120) ?? movingAverage(closes, 120)
    const ma250 = finite(candidate.timing.ma250) ?? movingAverage(closes, 250)
    if (price === undefined || (!ma120 && !ma250)) return this.insufficientStrategy('dividend_low_vol_yield_ma_reversion_v1', '股息率分位+长期均线模型', 'requires price and MA120/MA250 evidence', evidenceRefs, this.buildPriceAudit(candidate, history, evidenceRefs))
    const anchor = Math.min(...[ma120, ma250].filter((value): value is number => value !== undefined))
    const longAnchor = ma250 ?? ma120 ?? anchor
    const priceAudit = this.buildPriceAudit(candidate, history, evidenceRefs, anchor)
    if (priceAudit.sanityStatus !== 'aligned') {
      return this.insufficientStrategy('dividend_low_vol_yield_ma_reversion_v1', '股息率分位+长期均线模型', priceAudit.warnings[0] || 'price source failed sanity check', evidenceRefs, priceAudit)
    }
    const buyLow = anchor * 0.97
    const buyHigh = anchor * 1.04
    const sellLow = longAnchor * 1.15
    const sellHigh = longAnchor * 1.25
    const stopLoss = longAnchor * 0.92
    const signal = this.zoneSignal(price, buyHigh, sellLow, stopLoss, candidate)
    return {
      strategyId: 'dividend_low_vol_yield_ma_reversion_v1',
      label: '股息率分位+长期均线模型',
      status: 'available',
      currentSignal: signal,
      buyZone: {
        low: round(buyLow),
        high: round(buyHigh),
        rationale: ['股息率处于历史较高分位且价格回到 MA120/MA250 附近时进入低位观察', '适合红利低波核心仓的分批计划草案'],
      },
      sellZone: {
        low: round(sellLow),
        high: round(sellHigh),
        rationale: ['价格相对 MA250 溢价较高或股息率分位压缩时进入滚动减仓观察区', '不因单日上涨直接触发正式 REDUCE'],
      },
      stopLoss: round(stopLoss),
      indicators: {
        price: roundOptional(price),
        ma120: roundOptional(ma120),
        ma250: roundOptional(ma250),
        rsi14: roundOptional(candidate.timing.rsi14 ?? rsi(closes)),
        atrRatio: roundOptional(atrRatio(history), 4),
        dividendYieldHistoricalPercentile: roundOptional(candidate.dividend.dividendYieldPercentile3y),
        lowZoneScore: roundOptional(candidate.timing.lowZoneScore),
        highZoneScore: roundOptional(candidate.timing.highZoneScore),
      },
      priceAudit,
      invalidationConditions: ['股息率跌破 4% 或分红削减', '跌破 MA250 风险位且低波属性失效', 'validation_evidence 未通过时不得升级为正式交易动作'],
      evidenceRefs: [...new Set([...evidenceRefs, `trading-zone:yield-ma:${candidate.identity.symbol}:ma120-ma250`])],
    }
  }

  private insufficientStrategy(strategyId: DividendLowVolTradingZoneStrategyId, label: string, reason: string, evidenceRefs: string[], priceAudit?: DividendLowVolTradingZonePriceAudit): DividendLowVolTradingZoneStrategy {
    return {
      strategyId,
      label,
      status: 'insufficient',
      currentSignal: 'insufficient',
      buyZone: { low: null, high: null, rationale: [reason] },
      sellZone: { low: null, high: null, rationale: [reason] },
      stopLoss: null,
      indicators: {},
      priceAudit,
      invalidationConditions: ['补齐行情、红利和估值证据后重算'],
      evidenceRefs,
    }
  }

  private buildPriceAudit(candidate: DividendLowVolFactSet, history: Bar[], evidenceRefs: string[], anchor?: number): DividendLowVolTradingZonePriceAudit {
    const historySourceRefs = history
      .map((bar) => bar.tradeabilityEvidenceRef)
      .filter((ref): ref is string => Boolean(ref))
    const sourceRefs = [...evidenceRefs, ...historySourceRefs].filter((ref) => (
      ref.startsWith('market-bar-canonical:') ||
      ref.startsWith('market-bar-raw:') ||
      ref.startsWith('market-history-free-provider:') ||
      ref.startsWith('market-history:') ||
      ref.includes('public-seed') ||
      ref.includes('fallback') ||
      ref.includes('fixture:')
    ))
    const historyDate = history.at(-1)?.date
    const tradeDate = historyDate || latestEvidenceDate(sourceRefs)
    const ageDays = tradeDate ? daysBetween(tradeDate) : undefined
    const freshnessStatus = ageDays === undefined ? 'unknown' : ageDays <= 7 ? 'fresh' : 'stale'
    const sourceType: DividendLowVolTradingZonePriceAudit['sourceType'] = sourceRefs.some((ref) => ref.startsWith('market-bar-canonical:'))
      ? 'canonical_bar'
      : sourceRefs.some((ref) => ref.startsWith('market-bar-raw:'))
        ? 'raw_bar'
        : sourceRefs.some((ref) => ref.startsWith('market-history-free-provider:'))
          ? 'free_provider_history'
          : sourceRefs.some((ref) => ref.startsWith('market-history:'))
            ? 'market_history'
            : sourceRefs.some((ref) => ref.includes('public-seed') || ref.includes('fallback'))
              ? 'fallback_seed'
              : history.length > 0
                ? 'market_history'
                : 'unknown'
    const currentPrice = finite(candidate.timing.price) ?? history.at(-1)?.close
    const warnings: string[] = []
    if (freshnessStatus === 'stale') warnings.push(`price evidence is stale: latest trade date ${tradeDate}`)
    if (sourceType === 'unknown') warnings.push('price source is unknown; refresh market history before using trading zones')
    if (sourceType === 'fallback_seed') warnings.push('price source uses fallback seed; refresh provider/canonical history before using trading zones')
    const priceToAnchorRatio = currentPrice !== undefined && anchor && anchor > 0 ? currentPrice / anchor : undefined
    let sanityStatus: DividendLowVolTradingZonePriceAudit['sanityStatus'] = currentPrice !== undefined ? 'aligned' : 'insufficient'
    if (currentPrice === undefined) warnings.push('current price is missing')
    if (priceToAnchorRatio !== undefined && (priceToAnchorRatio < 0.55 || priceToAnchorRatio > 1.85)) {
      sanityStatus = 'price_zone_mismatch'
      warnings.push(`price/anchor mismatch: price=${round(currentPrice)}, anchor=${round(anchor)}, ratio=${round(priceToAnchorRatio, 3)}`)
    }
    if (freshnessStatus !== 'fresh' || sourceType === 'unknown') sanityStatus = sanityStatus === 'price_zone_mismatch' ? sanityStatus : 'insufficient'
    return {
      currentPrice: roundOptional(currentPrice),
      tradeDate,
      sourceType,
      sourceRefs: (sourceRefs.length > 0 ? sourceRefs : historyDate ? [`market-history:input:${candidate.identity.symbol}:${historyDate}`] : []).slice(0, 8),
      freshnessStatus,
      sanityStatus,
      priceToAnchorRatio: roundOptional(priceToAnchorRatio, 3),
      warnings,
    }
  }

  private zoneSignal(price: number, buyHigh: number, sellLow: number, stopLoss: number, candidate: DividendLowVolFactSet): DividendLowVolTradingZoneSignal {
    if (candidate.dividend.dividendTrapFlag || price <= stopLoss || candidate.disposition === 'exit_dividend_risk') return 'exit_risk'
    if (price <= buyHigh && candidate.timing.lowZoneScore >= 60 && (candidate.scores.financialRiskScore || 0) <= 55) return 'buy_zone'
    if (price >= sellLow || candidate.timing.highZoneScore >= 75) return 'sell_zone'
    return 'hold_zone'
  }

  private backtestStrategy(
    strategyId: DividendLowVolTradingZoneStrategyId,
    candidates: DividendLowVolFactSet[],
    inputBySymbol: Map<string, DividendLowVolInput>,
    requestedTradingDays: number,
    minRequiredTradingDays: number
  ): DividendLowVolRollingBacktestResult['strategyResults'][number] {
    const label = strategyId === 'dividend_low_vol_bollinger_reversion_v1' ? '布林低吸高抛模型' : '股息率分位+长期均线模型'
    const tradeReturns: number[] = []
    const holdingDays: number[] = []
    let buySignals = 0
    let sellSignals = 0
    let exitRiskSignals = 0
    let dividendContribution = 0
    let costDrag = 0
    let benchmarkReturns: number[] = []
    const effectiveDays: number[] = []
    for (const candidate of candidates) {
      const history = (inputBySymbol.get(candidate.identity.symbol)?.history || []).slice(-requestedTradingDays)
      if (history.length < minRequiredTradingDays) continue
      const closes = history.map((bar) => bar.close)
      if (closes.length < minRequiredTradingDays) continue
      effectiveDays.push(history.length)
      benchmarkReturns.push(closes.at(-1)! / closes[0] - 1)
      let holding = false
      let entryPrice = 0
      let entryIndex = 0
      const annualYield = Math.max(0, (candidate.dividend.ttmDividendYield || 0) / 100)
      for (let index = 60; index < history.length; index += 1) {
        const signal = this.historicalSignal(strategyId, candidate, history, index)
        const bar = history[index]
        if (!holding && signal === 'buy_zone' && isTradable(bar, 'buy')) {
          holding = true
          entryPrice = bar.close
          entryIndex = index
          buySignals += 1
          continue
        }
        if (holding && (signal === 'sell_zone' || signal === 'exit_risk') && isTradable(bar, 'sell')) {
          const days = index - entryIndex
          const gross = bar.close / entryPrice - 1
          const dividend = annualYield * (days / 252)
          const cost = 0.002
          tradeReturns.push(gross + dividend - cost)
          dividendContribution += dividend
          costDrag += cost
          holdingDays.push(days)
          if (signal === 'sell_zone') sellSignals += 1
          else exitRiskSignals += 1
          holding = false
        }
      }
      if (holding) {
        const last = history.at(-1)!
        const days = history.length - 1 - entryIndex
        const gross = last.close / entryPrice - 1
        const dividend = annualYield * (days / 252)
        const cost = 0.002
        tradeReturns.push(gross + dividend - cost)
        dividendContribution += dividend
        costDrag += cost
        holdingDays.push(days)
      }
    }
    const wins = tradeReturns.filter((value) => value > 0).length
    const losses = tradeReturns.filter((value) => value < 0).map(Math.abs)
    const gains = tradeReturns.filter((value) => value > 0)
    const compounded = tradeReturns.reduce((equity, value) => equity * (1 + value), 1) - 1
    const averageEffectiveTradingDays = mean(effectiveDays) || 0
    const benchmarkReturn = mean(benchmarkReturns)
    const insufficientItems = [
      ...(effectiveDays.length === 0 ? ['three_year_history_not_available'] : []),
      ...(tradeReturns.length < 10 ? ['rolling_trade_sample_below_10'] : []),
      ...(benchmarkReturn === undefined ? ['benchmark_path_unavailable'] : []),
    ]
    return {
      strategyId,
      label,
      status: insufficientItems.length === 0 ? 'completed' : 'insufficient',
      sample: {
        candidateCount: candidates.length,
        effectiveCandidateCount: effectiveDays.length,
        tradeCount: tradeReturns.length,
        averageEffectiveTradingDays: round(averageEffectiveTradingDays, 0) || 0,
      },
      metrics: {
        winRatePercent: tradeReturns.length > 0 ? round((wins / tradeReturns.length) * 100) : null,
        totalReturnPercent: tradeReturns.length > 0 ? round(compounded * 100) : null,
        annualizedReturnPercent: tradeReturns.length > 0 ? round(annualizedReturn(compounded, Math.max(1, averageEffectiveTradingDays))) : null,
        maxDrawdownPercent: tradeReturns.length > 0 ? round(maxDrawdownFromReturns(tradeReturns)) : null,
        averageHoldingDays: holdingDays.length > 0 ? round(mean(holdingDays), 0) : null,
        profitFactor: losses.length > 0 ? round((gains.reduce((sum, value) => sum + value, 0) || 0) / losses.reduce((sum, value) => sum + value, 0)) : gains.length > 0 ? 99 : null,
        dividendContributionPercent: tradeReturns.length > 0 ? round(dividendContribution * 100) : null,
        capitalGainContributionPercent: tradeReturns.length > 0 ? round((tradeReturns.reduce((sum, value) => sum + value, 0) + costDrag - dividendContribution) * 100) : null,
        costDragPercent: tradeReturns.length > 0 ? round(costDrag * 100) : null,
        benchmarkReturnPercent: benchmarkReturn !== undefined ? round(benchmarkReturn * 100) : null,
        excessReturnPercent: benchmarkReturn !== undefined && tradeReturns.length > 0 ? round((compounded - benchmarkReturn) * 100) : null,
      },
      signalCounts: {
        buySignals,
        sellSignals,
        exitRiskSignals,
      },
      insufficientItems,
    }
  }

  private historicalSignal(strategyId: DividendLowVolTradingZoneStrategyId, candidate: DividendLowVolFactSet, history: Bar[], index: number): DividendLowVolTradingZoneSignal {
    const closes = history.map((bar) => bar.close)
    const price = closes[index]
    if (strategyId === 'dividend_low_vol_bollinger_reversion_v1') {
      const bands = bollinger(closes, 20, 2, index)
      if (!bands) return 'insufficient'
      const stopLoss = bands.lower * 0.88
      if (price <= stopLoss) return 'exit_risk'
      if ((bands.percentB || 0) <= 0.05 && candidate.timing.lowZoneScore >= 55) return 'buy_zone'
      if ((bands.percentB || 0) >= 0.55) return 'sell_zone'
      return 'hold_zone'
    }
    const ma120 = movingAverage(closes, 120, index)
    const ma250 = movingAverage(closes, 250, index) ?? ma120
    if (!ma120 && !ma250) return 'insufficient'
    const anchor = Math.min(...[ma120, ma250].filter((value): value is number => value !== undefined))
    const longAnchor = ma250 ?? ma120 ?? anchor
    if (price <= longAnchor * 0.92) return 'exit_risk'
    const yieldPercentile = candidate.dividend.dividendYieldPercentile3y || 0
    if (price <= anchor * 1.04 && yieldPercentile >= 60 && candidate.timing.lowZoneScore >= 55) return 'buy_zone'
    if (price >= longAnchor * 1.15 || yieldPercentile <= 35 || candidate.timing.highZoneScore >= 75) return 'sell_zone'
    return 'hold_zone'
  }
}

export const dividendLowVolTradingZoneService = new DividendLowVolTradingZoneService()
