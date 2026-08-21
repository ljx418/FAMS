import { prisma } from '../../db/prisma.js'
import {
  DEFAULT_ROTATION_BENCHMARK_ID,
  RELATIVE_ROTATION_FORMULA_VERSION,
  relativeRotationService,
  type RelativeRotationSeriesPoint,
} from '../relative-rotation/relativeRotationService.js'
import type { StockHistoryData } from '../../utils/stockUtils.js'

export const VOLATILITY_STRATEGY_VERSION = 'volatility_swing.v1'
export type VolatilityStrategyProfile = 'conservative' | 'strict'

interface BacktestCandidate {
  ratio: number
  profile: VolatilityStrategyProfile
  totalReturnPercent: number
  buyHoldReturnPercent: number
  excessReturnPercent: number
  validationReturnPercent: number
  validationBuyHoldReturnPercent: number
  validationExcessReturnPercent: number
  validationMaxDrawdownPercent: number
  validationBuyHoldMaxDrawdownPercent: number
  outOfSampleReturnPercent: number
  outOfSampleBuyHoldReturnPercent: number
  outOfSampleExcessReturnPercent: number
  outOfSampleMaxDrawdownPercent: number
  outOfSampleBuyHoldMaxDrawdownPercent: number
  maxDrawdownPercent: number
  buyHoldMaxDrawdownPercent: number
  tradeCount: number
  roundTrips: number
  walkForwardPassedWindows: number
  walkForwardWindows: number
  walkForwardPassRatioPercent: number
  totalCost: number
  selectionEligible: boolean
  testPassed: boolean
  passed: boolean
  blockers: string[]
}

interface SimulationPoint {
  date: string
  value: number
  buyHoldValue: number
}

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const average = (values: number[]) => values.length > 0
  ? values.reduce((sum, value) => sum + value, 0) / values.length
  : 0

const emaLast = (values: number[], period: number) => {
  if (values.length === 0) return null
  const multiplier = 2 / (period + 1)
  let value = values[0]
  for (let index = 1; index < values.length; index += 1) {
    value = (values[index] * multiplier) + (value * (1 - multiplier))
  }
  return value
}

const rsi14 = (closes: number[]) => {
  if (closes.length < 15) return null
  const recent = closes.slice(-15)
  let gains = 0
  let losses = 0
  for (let index = 1; index < recent.length; index += 1) {
    const delta = recent[index] - recent[index - 1]
    if (delta >= 0) gains += delta
    else losses += Math.abs(delta)
  }
  if (losses === 0) return gains === 0 ? 50 : 100
  const rs = (gains / 14) / (losses / 14)
  return 100 - (100 / (1 + rs))
}

const atr14 = (bars: StockHistoryData[]) => {
  if (bars.length < 15) return null
  const recent = bars.slice(-15)
  const ranges: number[] = []
  for (let index = 1; index < recent.length; index += 1) {
    const current = recent[index]
    const previous = recent[index - 1]
    ranges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ))
  }
  return average(ranges)
}

const maxDrawdownPercent = (values: number[]) => {
  let peak = 0
  let maxDrawdown = 0
  for (const value of values) {
    peak = Math.max(peak, value)
    if (peak > 0) maxDrawdown = Math.max(maxDrawdown, ((peak - value) / peak) * 100)
  }
  return round(maxDrawdown)
}

const percentageReturn = (start: number, end: number) => start > 0 ? ((end / start) - 1) * 100 : 0

const latestRotationAt = (points: RelativeRotationSeriesPoint[], date: string) => {
  let matched: RelativeRotationSeriesPoint | null = null
  for (const point of points) {
    if (point.date >= date) break
    matched = point
  }
  return matched
}

const entryFactor = (profile: VolatilityStrategyProfile, rotation: RelativeRotationSeriesPoint | null) => {
  if (!rotation) return 0
  const headingRight = (rotation.deltaX || 0) > 0
  if (profile === 'strict') {
    if (rotation.quadrant === 'leading' && headingRight) return 1
    if (rotation.quadrant === 'improving' && headingRight) return 0.5
    return 0
  }
  if ((rotation.quadrant === 'leading' || rotation.quadrant === 'improving') && headingRight) return 1
  if (rotation.quadrant === 'leading' || rotation.quadrant === 'improving') return 0.5
  return 0
}

class VolatilityBacktestService {
  private readonly minimumSampleDays = 756
  private readonly preferredSampleDays = 1260
  private readonly feeRate = 0.0003
  private readonly slippageRate = 0.0005
  private readonly sellTaxRate = 0.0005

  async runPositionBacktest(params: { userId: string; positionId: string; operationId?: string }) {
    const position = await prisma.position.findFirst({
      where: { id: params.positionId, userId: params.userId, status: 'open' },
      include: { asset: true },
    })
    if (!position) throw new Error('Position not found')
    if (!['stock', 'etf'].includes(position.asset.type) || !/^\d{6}$/.test(position.asset.symbol)) {
      throw new Error('Only current CN A-share and exchange-traded ETF positions are supported')
    }
    const record = await prisma.volatilityStrategyBacktest.create({
      data: {
        userId: params.userId,
        positionId: params.positionId,
        status: 'running',
        operationId: params.operationId,
      },
    })

    try {
      const rotation = await relativeRotationService.computeSymbol({
        symbol: position.asset.symbol,
        frequency: 'weekly',
        trail: 52,
        days: this.preferredSampleDays,
        refresh: true,
      })
      const history = await relativeRotationService.ensureQfqHistory(position.asset.symbol, {
        days: this.preferredSampleDays,
        refresh: false,
      })
      const blockers: string[] = []
      if (history.length < this.minimumSampleDays) {
        blockers.push(`history_below_minimum:${history.length}/${this.minimumSampleDays}`)
      }
      if (rotation.allPoints.length < 12) blockers.push('relative_rotation_history_insufficient')

      const candidates: BacktestCandidate[] = []
      if (blockers.length === 0) {
        for (const ratio of [0.1, 0.2, 0.3, 0.4]) {
          for (const profile of ['conservative', 'strict'] as const) {
            candidates.push(this.simulate(history, rotation.allPoints, ratio, profile))
          }
        }
      }
      const validationCandidates = candidates
        .filter((candidate) => candidate.selectionEligible)
        .sort((left, right) => {
          const excessDelta = right.validationExcessReturnPercent - left.validationExcessReturnPercent
          if (Math.abs(excessDelta) > 1) return excessDelta
          if (left.ratio !== right.ratio) return left.ratio - right.ratio
          if (left.profile !== right.profile) return left.profile === 'conservative' ? -1 : 1
          return 0
        })
      const selectedForLockedTest = validationCandidates[0] || null
      const recommended = selectedForLockedTest?.testPassed ? selectedForLockedTest : null
      const finalBlockers = [
        ...blockers,
        ...(!selectedForLockedTest && blockers.length === 0 ? ['no_candidate_passed_training_validation_gate'] : []),
        ...(selectedForLockedTest && !selectedForLockedTest.testPassed
          ? ['selected_candidate_failed_locked_out_of_sample_gate', ...selectedForLockedTest.blockers.filter((item) => item.startsWith('locked_test_'))]
          : []),
      ]
      const baseline = history.length > 1
        ? {
          totalReturnPercent: round(percentageReturn(history[0].close, history.at(-1)!.close)),
          maxDrawdownPercent: maxDrawdownPercent(history.map((row) => row.close)),
        }
        : null
      return await prisma.volatilityStrategyBacktest.update({
        where: { id: record.id },
        data: {
          status: recommended ? 'passed' : 'insufficient',
          historyStart: history[0] ? new Date(`${history[0].date}T00:00:00.000Z`) : null,
          historyEnd: history.at(-1) ? new Date(`${history.at(-1)!.date}T00:00:00.000Z`) : null,
          sampleDays: history.length,
          recommendedRatio: recommended?.ratio || 0,
          recommendedProfile: recommended?.profile || 'conservative',
          metricsJson: JSON.stringify({
            baseline,
            recommended,
            selectedForLockedTest,
            preferredSampleDays: this.preferredSampleDays,
            minimumSampleDays: this.minimumSampleDays,
            split: {
              trainingPercent: 60,
              validationPercent: 20,
              lockedTestPercent: 20,
              selectionRule: 'ratio_and_profile_selected_on_training_validation_only',
              lockedTestRule: 'selected_candidate_evaluated_once_without_reselection',
            },
            costModel: {
              feeRate: this.feeRate,
              slippageRate: this.slippageRate,
              sellTaxRate: this.sellTaxRate,
            },
          }),
          candidatesJson: JSON.stringify(candidates.map((candidate) => ({
            ...candidate,
            selectedForLockedTest: candidate === selectedForLockedTest,
          }))),
          blockersJson: JSON.stringify(finalBlockers),
          warningsJson: JSON.stringify([
            'price_only_research_backtest',
            'csi300_price_index_is_not_total_return_benchmark',
            'signals_execute_at_next_trading_day_open',
          ]),
          completedAt: new Date(),
        },
      })
    } catch (error) {
      await prisma.volatilityStrategyBacktest.update({
        where: { id: record.id },
        data: {
          status: 'failed',
          blockersJson: JSON.stringify([error instanceof Error ? error.message : String(error)]),
          completedAt: new Date(),
        },
      }).catch(() => undefined)
      throw error
    }
  }

  async runCurrentHoldings(params: { userId: string; operationId?: string; positionIds?: string[] }) {
    const positions = await prisma.position.findMany({
      where: {
        userId: params.userId,
        status: 'open',
        ...(params.positionIds?.length ? { id: { in: params.positionIds } } : {}),
        asset: { type: { in: ['stock', 'etf'] }, symbol: { not: '' } },
      },
      include: { asset: true },
    })
    const eligible = positions.filter((position) => /^\d{6}$/.test(position.asset.symbol))
    const results = []
    for (const position of eligible) {
      try {
        results.push(await this.runPositionBacktest({
          userId: params.userId,
          positionId: position.id,
          operationId: params.operationId,
        }))
      } catch (error) {
        results.push({
          positionId: position.id,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return {
      schemaVersion: 'fams.volatility_sleeve.backtest_batch.v1',
      generatedAt: new Date().toISOString(),
      benchmarkId: DEFAULT_ROTATION_BENCHMARK_ID,
      formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
      strategyVersion: VOLATILITY_STRATEGY_VERSION,
      requestedPositions: positions.length,
      eligiblePositions: eligible.length,
      results,
      notTradingAdvice: true,
    }
  }

  private simulate(
    history: StockHistoryData[],
    rotations: RelativeRotationSeriesPoint[],
    ratio: number,
    profile: VolatilityStrategyProfile,
  ): BacktestCandidate {
    const bars = history.filter((bar) => Number.isFinite(bar.close) && bar.close > 0)
    const initialCapital = 100_000
    const firstPrice = bars[0].close
    const totalShares = initialCapital / firstPrice
    const coreShares = totalShares * (1 - ratio)
    let volatilityShares = totalShares * ratio
    let volatilityCash = 0
    let volatilityCostBasis = initialCapital * ratio
    let lastBuyIndex = 0
    let tradeCount = 0
    let buyCount = 0
    let sellCount = 0
    let totalCost = 0
    const tradeEvents: Array<{ index: number; side: 'buy' | 'sell' }> = []
    const trancheNotional = initialCapital * ratio * 0.25
    const curve: SimulationPoint[] = []

    for (let index = 0; index < bars.length; index += 1) {
      const bar = bars[index]
      if (index >= 60) {
        const signalBars = bars.slice(0, index)
        const closes = signalBars.map((item) => item.close)
        const close = closes.at(-1)!
        const ema20 = emaLast(closes.slice(-80), 20)
        const atr = atr14(signalBars)
        const rsi = rsi14(closes)
        const rotation = latestRotationAt(rotations, bar.date)
        if (ema20 && atr && rsi !== null) {
          const averageVolatilityCost = volatilityShares > 0 ? volatilityCostBasis / volatilityShares : 0
          const stopTriggered = volatilityShares > 0 && averageVolatilityCost > 0 && close <= averageVolatilityCost - (2 * atr)
          const regularExit = close >= ema20 + (0.75 * atr) || rsi >= 65 || index - lastBuyIndex >= 20
          if (volatilityShares > 0 && (stopTriggered || (regularExit && index - lastBuyIndex >= 5))) {
            const shares = Math.min(volatilityShares, (totalShares * ratio) * 0.25)
            const executionPrice = (bar.open || bar.close) * (1 - this.slippageRate)
            const gross = shares * executionPrice
            const cost = gross * (this.feeRate + this.sellTaxRate)
            const carryingCost = volatilityShares > 0 ? volatilityCostBasis * (shares / volatilityShares) : 0
            volatilityShares -= shares
            volatilityCash += gross - cost
            volatilityCostBasis = Math.max(0, volatilityCostBasis - carryingCost)
            totalCost += cost + (shares * (bar.open || bar.close) * this.slippageRate)
            tradeCount += 1
            sellCount += 1
            tradeEvents.push({ index, side: 'sell' })
          } else if (close <= ema20 - (0.75 * atr) && rsi <= 45 && volatilityCash > 0) {
            const factor = entryFactor(profile, rotation)
            if (factor > 0) {
              const executionPrice = (bar.open || bar.close) * (1 + this.slippageRate)
              const desiredGross = trancheNotional * factor
              const shares = Math.min(desiredGross / executionPrice, volatilityCash / (executionPrice * (1 + this.feeRate)))
              if (shares > 0) {
                const gross = shares * executionPrice
                const cost = gross * this.feeRate
                volatilityShares += shares
                volatilityCash -= gross + cost
                volatilityCostBasis += gross + cost
                lastBuyIndex = index
                totalCost += cost + (shares * (bar.open || bar.close) * this.slippageRate)
                tradeCount += 1
                buyCount += 1
                tradeEvents.push({ index, side: 'buy' })
              }
            }
          }
        }
      }
      const value = (coreShares + volatilityShares) * bar.close + volatilityCash
      curve.push({
        date: bar.date,
        value,
        buyHoldValue: totalShares * bar.close,
      })
    }

    const validationStartIndex = Math.floor(curve.length * 0.6)
    const lockedTestStartIndex = Math.floor(curve.length * 0.8)
    const validation = curve.slice(validationStartIndex, lockedTestStartIndex + 1)
    const oos = curve.slice(lockedTestStartIndex)
    const totalReturnPercent = percentageReturn(curve[0].value, curve.at(-1)!.value)
    const buyHoldReturnPercent = percentageReturn(curve[0].buyHoldValue, curve.at(-1)!.buyHoldValue)
    const validationReturn = percentageReturn(validation[0].value, validation.at(-1)!.value)
    const validationBuyHoldReturn = percentageReturn(validation[0].buyHoldValue, validation.at(-1)!.buyHoldValue)
    const oosReturn = percentageReturn(oos[0].value, oos.at(-1)!.value)
    const oosBuyHoldReturn = percentageReturn(oos[0].buyHoldValue, oos.at(-1)!.buyHoldValue)
    const strategyDrawdown = maxDrawdownPercent(curve.map((point) => point.value))
    const buyHoldDrawdown = maxDrawdownPercent(curve.map((point) => point.buyHoldValue))
    const validationStrategyDrawdown = maxDrawdownPercent(validation.map((point) => point.value))
    const validationBuyHoldDrawdown = maxDrawdownPercent(validation.map((point) => point.buyHoldValue))
    const oosStrategyDrawdown = maxDrawdownPercent(oos.map((point) => point.value))
    const oosBuyHoldDrawdown = maxDrawdownPercent(oos.map((point) => point.buyHoldValue))
    const walkForwardWindows = 3
    let walkForwardPassedWindows = 0
    const walkStart = Math.floor(curve.length * 0.2)
    const walkWindowSize = Math.max(1, Math.floor((lockedTestStartIndex - walkStart) / walkForwardWindows))
    for (let index = 0; index < walkForwardWindows; index += 1) {
      const windowStart = walkStart + (index * walkWindowSize)
      const windowEnd = index === walkForwardWindows - 1
        ? lockedTestStartIndex
        : walkStart + ((index + 1) * walkWindowSize)
      const window = curve.slice(windowStart, windowEnd + 1)
      if (window.length < 2) continue
      const strategyReturn = percentageReturn(window[0].value, window.at(-1)!.value)
      const holdReturn = percentageReturn(window[0].buyHoldValue, window.at(-1)!.buyHoldValue)
      if (strategyReturn >= holdReturn) walkForwardPassedWindows += 1
    }
    const passRatio = (walkForwardPassedWindows / walkForwardWindows) * 100
    const preTestBuyCount = tradeEvents.filter((event) => event.index < lockedTestStartIndex && event.side === 'buy').length
    const preTestSellCount = tradeEvents.filter((event) => event.index < lockedTestStartIndex && event.side === 'sell').length
    const selectionRoundTrips = Math.min(preTestBuyCount, preTestSellCount)
    const selectionBlockers = [
      ...(validationReturn - validationBuyHoldReturn <= 0 ? ['validation_excess_return_not_positive'] : []),
      ...(validationStrategyDrawdown > validationBuyHoldDrawdown + 2 ? ['validation_max_drawdown_worse_than_buy_hold_by_over_2pct'] : []),
      ...(passRatio < 60 ? ['walk_forward_pass_ratio_below_60pct'] : []),
      ...(selectionRoundTrips < 2 ? ['pre_test_complete_round_trips_below_2'] : []),
    ]
    const lockedTestBlockers = [
      ...(oosReturn - oosBuyHoldReturn <= 0 ? ['locked_test_excess_return_not_positive'] : []),
      ...(oosStrategyDrawdown > oosBuyHoldDrawdown + 2 ? ['locked_test_max_drawdown_worse_than_buy_hold_by_over_2pct'] : []),
    ]
    const blockers = [...selectionBlockers, ...lockedTestBlockers]
    return {
      ratio,
      profile,
      totalReturnPercent: round(totalReturnPercent),
      buyHoldReturnPercent: round(buyHoldReturnPercent),
      excessReturnPercent: round(totalReturnPercent - buyHoldReturnPercent),
      validationReturnPercent: round(validationReturn),
      validationBuyHoldReturnPercent: round(validationBuyHoldReturn),
      validationExcessReturnPercent: round(validationReturn - validationBuyHoldReturn),
      validationMaxDrawdownPercent: validationStrategyDrawdown,
      validationBuyHoldMaxDrawdownPercent: validationBuyHoldDrawdown,
      outOfSampleReturnPercent: round(oosReturn),
      outOfSampleBuyHoldReturnPercent: round(oosBuyHoldReturn),
      outOfSampleExcessReturnPercent: round(oosReturn - oosBuyHoldReturn),
      outOfSampleMaxDrawdownPercent: oosStrategyDrawdown,
      outOfSampleBuyHoldMaxDrawdownPercent: oosBuyHoldDrawdown,
      maxDrawdownPercent: strategyDrawdown,
      buyHoldMaxDrawdownPercent: buyHoldDrawdown,
      tradeCount,
      roundTrips: Math.min(buyCount, sellCount),
      walkForwardPassedWindows,
      walkForwardWindows,
      walkForwardPassRatioPercent: round(passRatio),
      totalCost: round(totalCost, 2),
      selectionEligible: selectionBlockers.length === 0,
      testPassed: lockedTestBlockers.length === 0,
      passed: blockers.length === 0,
      blockers,
    }
  }
}

export const volatilityBacktestService = new VolatilityBacktestService()
