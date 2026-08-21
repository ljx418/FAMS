import { prisma } from '../../db/prisma.js'
import { transactionService } from '../transaction/transactionService.js'
import {
  RELATIVE_ROTATION_FORMULA_VERSION,
  relativeRotationService,
  type RelativeRotationSeriesPoint,
} from '../relative-rotation/relativeRotationService.js'
import {
  VOLATILITY_STRATEGY_VERSION,
  volatilityBacktestService,
  type VolatilityStrategyProfile,
} from './volatilityBacktestService.js'
import type { StockHistoryData } from '../../utils/stockUtils.js'

const round = (value: number, digits = 4) => {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

const boardLotQuantity = (quantity: number) => Math.max(0, Math.floor(quantity / 100) * 100)
const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

const emaLast = (values: number[], period: number) => {
  if (values.length === 0) return null
  const multiplier = 2 / (period + 1)
  let result = values[0]
  for (let index = 1; index < values.length; index += 1) {
    result = (values[index] * multiplier) + (result * (1 - multiplier))
  }
  return result
}

const calculateRsi14 = (closes: number[]) => {
  if (closes.length < 15) return null
  const values = closes.slice(-15)
  let gains = 0
  let losses = 0
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1]
    if (delta >= 0) gains += delta
    else losses += Math.abs(delta)
  }
  if (losses === 0) return gains === 0 ? 50 : 100
  const ratio = gains / losses
  return 100 - (100 / (1 + ratio))
}

const calculateAtr14 = (bars: StockHistoryData[]) => {
  if (bars.length < 15) return null
  const values = bars.slice(-15)
  const ranges: number[] = []
  for (let index = 1; index < values.length; index += 1) {
    ranges.push(Math.max(
      values[index].high - values[index].low,
      Math.abs(values[index].high - values[index - 1].close),
      Math.abs(values[index].low - values[index - 1].close),
    ))
  }
  return ranges.reduce((sum, value) => sum + value, 0) / ranges.length
}

const rrgEntryFactor = (profile: VolatilityStrategyProfile, point: RelativeRotationSeriesPoint | undefined) => {
  if (!point) return 0
  const headingRight = (point.deltaX || 0) > 0
  if (profile === 'strict') {
    if (point.quadrant === 'leading' && headingRight) return 1
    if (point.quadrant === 'improving' && headingRight) return 0.5
    return 0
  }
  if ((point.quadrant === 'leading' || point.quadrant === 'improving') && headingRight) return 1
  if (point.quadrant === 'leading' || point.quadrant === 'improving') return 0.5
  return 0
}

class VolatilitySleeveService {
  async getOverview(userId: string, options: { frequency?: 'weekly' | 'daily'; trail?: number } = {}) {
    const report = await relativeRotationService.getHoldingsRotation(userId, options)
    return {
      ...report,
      items: report.items.map((item) => {
        const allocation = item.allocation
        const currentPrice = item.position.currentPrice || 0
        const volatilityNav = allocation
          ? (allocation.volatilityQuantity * currentPrice) + allocation.volatilityCash
          : 0
        return {
          ...item,
          allocation: allocation ? {
            ...allocation,
            volatilityNav: round(volatilityNav, 2),
            volatilityUnrealizedPnl: round(
              (allocation.volatilityQuantity * currentPrice) - allocation.volatilityCostBasis,
              2,
            ),
            volatilityTotalPnl: round(
              allocation.volatilityRealizedPnl
                + ((allocation.volatilityQuantity * currentPrice) - allocation.volatilityCostBasis),
              2,
            ),
            invariantDelta: round(
              item.position.quantity - allocation.coreQuantity - allocation.volatilityQuantity,
              6,
            ),
          } : null,
          latestBacktest: item.latestBacktest ? this.formatBacktest(item.latestBacktest) : null,
          latestDraft: item.latestDraft ? this.formatDraft(item.latestDraft) : null,
        }
      }),
    }
  }

  async runBacktest(params: { userId: string; positionId: string; operationId?: string }) {
    return volatilityBacktestService.runPositionBacktest(params)
  }

  async activateAllocation(params: {
    userId: string
    positionId: string
    backtestId: string
    confirmedRatio?: number
    strategyProfile?: VolatilityStrategyProfile
  }) {
    const position = await prisma.position.findFirst({
      where: { id: params.positionId, userId: params.userId, status: 'open' },
      include: { asset: true, sleeveAllocation: true },
    })
    if (!position) throw new Error('Position not found')
    if (position.sleeveAllocation?.status === 'active') throw new Error('Position sleeve allocation is already active')
    if (!['stock', 'etf'].includes(position.asset.type) || !/^\d{6}$/.test(position.asset.symbol)) {
      throw new Error('Only CN A-share and exchange-traded ETF positions can activate sleeves')
    }
    const backtest = await prisma.volatilityStrategyBacktest.findFirst({
      where: { id: params.backtestId, userId: params.userId, positionId: params.positionId },
    })
    if (!backtest || !['passed', 'insufficient'].includes(backtest.status)) throw new Error('Completed backtest not found')
    const ratio = params.confirmedRatio ?? backtest.recommendedRatio
    if (!Number.isFinite(ratio) || ratio < 0 || ratio > 0.4 || Math.abs((ratio * 10) - Math.round(ratio * 10)) > 0.0001) {
      throw new Error('confirmedRatio must be one of 0, 0.1, 0.2, 0.3 or 0.4')
    }
    if (backtest.status !== 'passed' && ratio > 0) {
      throw new Error('Backtest did not pass the out-of-sample gate; only a zero volatility allocation may be confirmed')
    }
    const volatilityQuantity = boardLotQuantity(position.quantity * ratio)
    const coreQuantity = round(position.quantity - volatilityQuantity, 6)
    const volatilityCostBasis = round(volatilityQuantity * position.avgCost, 2)
    const strategyProfile = params.strategyProfile || (backtest.recommendedProfile as VolatilityStrategyProfile)

    return prisma.$transaction(async (tx) => {
      const allocation = position.sleeveAllocation
        ? await tx.positionSleeveAllocation.update({
          where: { id: position.sleeveAllocation.id },
          data: {
            status: 'active',
            coreQuantity,
            volatilityQuantity,
            volatilityCash: 0,
            volatilityCostBasis,
            volatilityRealizedPnl: 0,
            recommendedRatio: backtest.recommendedRatio,
            confirmedRatio: ratio,
            strategyProfile,
            sourceBacktestId: backtest.id,
            version: { increment: 1 },
            activatedAt: new Date(),
            closedAt: null,
          },
        })
        : await tx.positionSleeveAllocation.create({
          data: {
            userId: params.userId,
            positionId: params.positionId,
            coreQuantity,
            volatilityQuantity,
            volatilityCash: 0,
            volatilityCostBasis,
            volatilityRealizedPnl: 0,
            recommendedRatio: backtest.recommendedRatio,
            confirmedRatio: ratio,
            strategyProfile,
            sourceBacktestId: backtest.id,
          },
        })
      await tx.positionSleeveLedgerEntry.create({
        data: {
          allocationId: allocation.id,
          userId: params.userId,
          positionId: params.positionId,
          entryType: 'activate',
          sleeveType: 'volatility',
          quantityDelta: volatilityQuantity,
          costBasisDelta: volatilityCostBasis,
          notes: '依据历史回测建议确认核心仓/波动仓初始拆分',
          metadataJson: JSON.stringify({
            totalQuantity: position.quantity,
            coreQuantity,
            volatilityQuantity,
            recommendedRatio: backtest.recommendedRatio,
            confirmedRatio: ratio,
            backtestId: backtest.id,
          }),
        },
      })
      return allocation
    })
  }

  async transfer(params: {
    userId: string
    positionId: string
    direction: 'core_to_volatility' | 'volatility_to_core' | 'cash_in' | 'cash_out'
    amount: number
    expectedVersion?: number
    notes?: string
  }) {
    if (!Number.isFinite(params.amount) || params.amount <= 0) throw new Error('amount must be greater than zero')
    const allocation = await prisma.positionSleeveAllocation.findFirst({
      where: { userId: params.userId, positionId: params.positionId, status: 'active' },
      include: { position: true },
    })
    if (!allocation) throw new Error('Active sleeve allocation not found')
    if (params.expectedVersion !== undefined && allocation.version !== params.expectedVersion) {
      throw new Error('Sleeve allocation has changed; refresh before retrying')
    }
    let coreDelta = 0
    let volatilityDelta = 0
    let cashDelta = 0
    let costBasisDelta = 0
    if (params.direction === 'core_to_volatility' || params.direction === 'volatility_to_core') {
      const quantity = params.amount
      if (!Number.isInteger(quantity) || quantity < 100 || quantity % 100 !== 0) {
        throw new Error('Security transfer quantity must be an exact board lot multiple (100)')
      }
      if (params.direction === 'core_to_volatility') {
        if (quantity > allocation.coreQuantity) throw new Error('Transfer exceeds core quantity')
        coreDelta = -quantity
        volatilityDelta = quantity
        costBasisDelta = round(quantity * allocation.position.avgCost, 2)
      } else {
        if (quantity > allocation.volatilityQuantity) throw new Error('Transfer exceeds volatility quantity')
        coreDelta = quantity
        volatilityDelta = -quantity
        costBasisDelta = allocation.volatilityQuantity > 0
          ? -round(allocation.volatilityCostBasis * (quantity / allocation.volatilityQuantity), 2)
          : 0
      }
    } else if (params.direction === 'cash_in') {
      cashDelta = round(params.amount, 2)
    } else {
      if (params.amount > allocation.volatilityCash) throw new Error('Transfer exceeds volatility cash')
      cashDelta = -round(params.amount, 2)
    }

    return prisma.$transaction(async (tx) => {
      const updated = await tx.positionSleeveAllocation.update({
        where: { id: allocation.id },
        data: {
          coreQuantity: { increment: coreDelta },
          volatilityQuantity: { increment: volatilityDelta },
          volatilityCash: { increment: cashDelta },
          volatilityCostBasis: { increment: costBasisDelta },
          version: { increment: 1 },
        },
      })
      await tx.positionSleeveLedgerEntry.create({
        data: {
          allocationId: allocation.id,
          userId: params.userId,
          positionId: params.positionId,
          entryType: params.direction.startsWith('cash') ? 'cash_transfer' : 'security_transfer',
          sleeveType: 'volatility',
          quantityDelta: volatilityDelta,
          cashDelta,
          costBasisDelta,
          notes: params.notes,
          metadataJson: JSON.stringify({ direction: params.direction, coreQuantityDelta: coreDelta }),
        },
      })
      return updated
    })
  }

  async getLedger(userId: string, positionId: string, limit = 200) {
    const allocation = await prisma.positionSleeveAllocation.findFirst({ where: { userId, positionId } })
    if (!allocation) return { allocation: null, entries: [] }
    const entries = await prisma.positionSleeveLedgerEntry.findMany({
      where: { allocationId: allocation.id },
      orderBy: { occurredAt: 'desc' },
      take: Math.max(1, Math.min(1000, limit)),
      include: { transaction: true },
    })
    return { allocation, entries }
  }

  async generateDailyAnalysis(params: { userId: string; operationId?: string; refresh?: boolean }) {
    const now = new Date()
    await prisma.volatilityTradeDraft.updateMany({
      where: { userId: params.userId, status: 'pending', expiresAt: { lt: now } },
      data: { status: 'expired' },
    })
    const allocations = await prisma.positionSleeveAllocation.findMany({
      where: { userId: params.userId, status: 'active' },
      include: { position: { include: { asset: true } }, ledgerEntries: { orderBy: { occurredAt: 'desc' }, take: 20 } },
    })
    const results = []
    for (const allocation of allocations) {
      const symbol = allocation.position.asset.symbol
      try {
        const rotation = await relativeRotationService.computeSymbol({
          symbol,
          frequency: 'weekly',
          trail: 12,
          days: 1260,
          refresh: params.refresh !== false,
        })
        const history = await relativeRotationService.ensureQfqHistory(symbol, { days: 120, refresh: false })
        const closes = history.map((row) => row.close)
        const latest = history.at(-1)
        const ema20 = emaLast(closes.slice(-80), 20)
        const atr14 = calculateAtr14(history)
        const rsi14 = calculateRsi14(closes)
        const point = rotation.allPoints.at(-1)
        if (!latest || !ema20 || !atr14 || rsi14 === null || !point || rotation.dataStatus !== 'ready') {
          results.push({ positionId: allocation.positionId, symbol, status: 'blocked', reason: 'analysis_inputs_insufficient' })
          continue
        }
        const profile = allocation.strategyProfile === 'strict' ? 'strict' : 'conservative'
        const factor = rrgEntryFactor(profile, point)
        const latestBuy = allocation.ledgerEntries.find((entry) => entry.entryType === 'buy' || entry.entryType === 'activate')
        const heldDays = latestBuy
          ? Math.max(0, Math.floor((now.getTime() - latestBuy.occurredAt.getTime()) / 86400000))
          : 0
        const averageCost = allocation.volatilityQuantity > 0
          ? allocation.volatilityCostBasis / allocation.volatilityQuantity
          : 0
        const stopTriggered = allocation.volatilityQuantity > 0
          && averageCost > 0
          && latest.close <= averageCost - (2 * atr14)
        const sellSignal = allocation.volatilityQuantity > 0
          && (stopTriggered || ((latest.close >= ema20 + (0.75 * atr14) || rsi14 >= 65 || heldDays >= 20) && heldDays >= 5))
        const buySignal = allocation.volatilityCash > 0
          && factor > 0
          && latest.close <= ema20 - (0.75 * atr14)
          && rsi14 <= 45
        let draft = null
        if (sellSignal || buySignal) {
          const side = sellSignal ? 'sell' : 'buy'
          const volatilityNav = (allocation.volatilityQuantity * latest.close) + allocation.volatilityCash
          const trancheBudget = volatilityNav * 0.25 * (side === 'buy' ? factor : 1)
          const quantity = side === 'sell'
            ? Math.min(allocation.volatilityQuantity, boardLotQuantity(trancheBudget / latest.close))
            : boardLotQuantity(Math.min(trancheBudget, allocation.volatilityCash) / latest.close)
          if (quantity > 0) {
            const analysisDate = new Date(`${latest.date}T00:00:00.000Z`)
            const expiresAt = new Date(now.getTime() + (72 * 60 * 60 * 1000))
            const persistedDraft = await prisma.volatilityTradeDraft.upsert({
              where: {
                positionId_analysisDate_side_strategyVersion: {
                  positionId: allocation.positionId,
                  analysisDate,
                  side,
                  strategyVersion: VOLATILITY_STRATEGY_VERSION,
                },
              },
              create: {
                userId: params.userId,
                positionId: allocation.positionId,
                allocationId: allocation.id,
                analysisDate,
                side,
                suggestedQuantity: quantity,
                referencePriceLow: round(latest.close - (0.25 * atr14), 3),
                referencePriceHigh: round(latest.close + (0.25 * atr14), 3),
                rrgQuadrant: point.quadrant,
                rrgEntryFactor: factor,
                timingJson: JSON.stringify({ close: latest.close, ema20, atr14, rsi14, heldDays, stopTriggered }),
                rationaleJson: JSON.stringify(this.buildRationale(side, point, { ema20, atr14, rsi14, heldDays, stopTriggered })),
                strategyProfile: profile,
                operationId: params.operationId,
                expiresAt,
              },
              update: {
                suggestedQuantity: quantity,
                referencePriceLow: round(latest.close - (0.25 * atr14), 3),
                referencePriceHigh: round(latest.close + (0.25 * atr14), 3),
                rrgQuadrant: point.quadrant,
                rrgEntryFactor: factor,
                timingJson: JSON.stringify({ close: latest.close, ema20, atr14, rsi14, heldDays, stopTriggered }),
                rationaleJson: JSON.stringify(this.buildRationale(side, point, { ema20, atr14, rsi14, heldDays, stopTriggered })),
                strategyProfile: profile,
                operationId: params.operationId,
                expiresAt,
              },
            })
            // Re-running the workflow is idempotent: a confirmed, dismissed or expired
            // draft for the same trading day is never resurrected.
            draft = persistedDraft.status === 'pending' ? persistedDraft : null
          }
        }
        results.push({
          positionId: allocation.positionId,
          symbol,
          status: draft ? 'draft_created' : 'observed',
          rotation: point,
          timing: { close: latest.close, ema20, atr14, rsi14, heldDays, stopTriggered },
          rrgEntryFactor: factor,
          draft: draft ? this.formatDraft(draft) : null,
        })
      } catch (error) {
        results.push({
          positionId: allocation.positionId,
          symbol,
          status: 'failed',
          reason: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return {
      schemaVersion: 'fams.volatility_sleeve.daily_analysis.v1',
      generatedAt: now.toISOString(),
      formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
      strategyVersion: VOLATILITY_STRATEGY_VERSION,
      analyzedAllocations: allocations.length,
      draftCount: results.filter((item) => item.status === 'draft_created').length,
      blockedCount: results.filter((item) => item.status === 'blocked' || item.status === 'failed').length,
      results,
      allowedActions: ['RESEARCH', 'OBSERVE', 'PLAN_DRAFT'],
      prohibitedActions: ['ORDER_CREATE', 'AUTO_TRADE'],
      notTradingAdvice: true,
    }
  }

  async confirmDraft(params: {
    userId: string
    draftId: string
    quantity: number
    price: number
    fee?: number
    executedAt?: string
    notes?: string
  }) {
    const draft = await prisma.volatilityTradeDraft.findFirst({
      where: { id: params.draftId, userId: params.userId },
      include: { position: true, allocation: true },
    })
    if (!draft || draft.status !== 'pending') throw new Error('Pending volatility trade draft not found')
    if (draft.allocation.status !== 'active' || draft.position.status !== 'open') {
      throw new Error('Volatility sleeve is no longer active for this position')
    }
    if (draft.expiresAt < new Date()) {
      await prisma.volatilityTradeDraft.update({ where: { id: draft.id }, data: { status: 'expired' } })
      throw new Error('Volatility trade draft has expired')
    }
    const quantity = params.quantity
    if (!Number.isInteger(quantity) || quantity < 100 || quantity % 100 !== 0 || quantity > draft.suggestedQuantity) {
      throw new Error('Confirmed quantity must be an exact board lot within suggested quantity')
    }
    if (!Number.isFinite(params.price) || params.price <= 0) throw new Error('Confirmed price must be greater than zero')
    if (params.fee !== undefined && (!Number.isFinite(params.fee) || params.fee < 0)) throw new Error('fee must be zero or greater')
    const executedAt = params.executedAt ? new Date(params.executedAt) : new Date()
    if (Number.isNaN(executedAt.getTime())) throw new Error('executedAt must be a valid date')
    return transactionService.createTransaction({
      userId: params.userId,
      assetId: draft.position.assetId,
      type: draft.side as 'buy' | 'sell',
      quantity,
      price: params.price,
      fee: params.fee || 0,
      executedAt,
      notes: params.notes || `波动仓草稿 ${draft.id} 人工确认`,
      source: 'volatility_draft_confirmed',
      sleeveType: 'volatility',
      volatilityTradeDraftId: draft.id,
    })
  }

  async dismissDraft(userId: string, draftId: string) {
    const result = await prisma.volatilityTradeDraft.updateMany({
      where: { id: draftId, userId, status: 'pending' },
      data: { status: 'dismissed', dismissedAt: new Date() },
    })
    if (result.count === 0) throw new Error('Pending volatility trade draft not found')
    return prisma.volatilityTradeDraft.findUnique({ where: { id: draftId } })
  }

  private buildRationale(
    side: string,
    point: RelativeRotationSeriesPoint,
    timing: { ema20: number; atr14: number; rsi14: number; heldDays: number; stopTriggered: boolean },
  ) {
    return [
      `相对轮动处于 ${point.quadrant} 象限，趋势变化 ${round(point.deltaX || 0, 3)}。`,
      side === 'buy'
        ? `收盘价回落至 EMA20 下方 0.75 ATR，RSI14=${round(timing.rsi14, 1)}，满足波动仓分批观察条件。`
        : `满足波动仓退出条件：RSI14=${round(timing.rsi14, 1)}，持有约 ${timing.heldDays} 日${timing.stopTriggered ? '，并触发 2 ATR 保护条件' : ''}。`,
      '草稿只使用波动仓可用证券或独立现金，核心仓不参与。',
    ]
  }

  private formatBacktest(backtest: {
    id: string
    status: string
    sampleDays: number
    recommendedRatio: number
    recommendedProfile: string
    metricsJson: string
    candidatesJson: string
    blockersJson: string
    warningsJson: string
    createdAt: Date
    completedAt: Date | null
  }) {
    return {
      id: backtest.id,
      status: backtest.status,
      sampleDays: backtest.sampleDays,
      recommendedRatio: backtest.recommendedRatio,
      recommendedProfile: backtest.recommendedProfile,
      metrics: parseJson(backtest.metricsJson, {}),
      candidates: parseJson(backtest.candidatesJson, []),
      blockers: parseJson(backtest.blockersJson, []),
      warnings: parseJson(backtest.warningsJson, []),
      createdAt: backtest.createdAt,
      completedAt: backtest.completedAt,
    }
  }

  private formatDraft(draft: {
    id: string
    side: string
    status: string
    suggestedQuantity: number
    referencePriceLow: number | null
    referencePriceHigh: number | null
    rrgQuadrant: string | null
    rrgEntryFactor: number | null
    timingJson: string
    rationaleJson: string
    strategyProfile: string
    expiresAt: Date
    analysisDate: Date
  }) {
    return {
      id: draft.id,
      side: draft.side,
      status: draft.status,
      suggestedQuantity: draft.suggestedQuantity,
      referencePriceLow: draft.referencePriceLow,
      referencePriceHigh: draft.referencePriceHigh,
      rrgQuadrant: draft.rrgQuadrant,
      rrgEntryFactor: draft.rrgEntryFactor,
      timing: parseJson(draft.timingJson, {}),
      rationale: parseJson(draft.rationaleJson, []),
      strategyProfile: draft.strategyProfile,
      expiresAt: draft.expiresAt,
      analysisDate: draft.analysisDate,
    }
  }
}

export const volatilitySleeveService = new VolatilitySleeveService()
