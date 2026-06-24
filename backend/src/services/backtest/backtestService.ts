/**
 * Backtest Service - 回测服务
 *
 * 职责：
 * 1. 策略管理
 * 2. 回测执行
 * 3. 回测结果分析
 */

import { prisma } from '../../db/prisma.js'
import { priceService } from '../price/priceService.js'

interface BacktestParams {
  strategyId: string
  startDate: string
  endDate: string
  initialCapital: number
  symbols?: string[]
}

interface AdviceBacktestParams {
  userId: string
  adviceId: string
  startDate?: string
  endDate?: string
  initialCapital?: number
}

interface StrategyData {
  id: string
  userId: string
  name: string
  description: string | null
  type: string
  parameters: string
}

interface PricePoint {
  date: Date
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface EquityPoint {
  date: Date
  equity: number
  drawdown: number
}

interface Trade {
  date: Date
  type: 'buy' | 'sell'
  symbol: string
  quantity: number
  price: number
  pnl?: number
}

interface BacktestMetrics {
  totalReturn: number
  annualizedReturn: number
  maxDrawdown: number
  sharpeRatio: number
  winRate: number
  profitFactor: number
  tradesCount: number
  winningTrades: number
  losingTrades: number
  avgWin: number
  avgLoss: number
}

interface MonthlyReturn {
  year: number
  month: number
  return: number
}

interface Signal {
  symbol: string
  action: 'buy' | 'sell'
  quantity: number
  price: number
  reason: string
}

interface AdviceExecutionWindowReview {
  adviceId: string
  startDate: string
  endDate: string
  executableActions: number
  executedActions: number
  pendingActions: number
  executionRate: number
  buySide: {
    suggestedNotional: number
    executedNotional: number
    simulatedEndValue: number
    executedEndValue: number
    simulatedPnl: number
    executedPnl: number
    simulatedReturnPct: number | null
    executedReturnPct: number | null
  }
  sellSide: {
    suggestedNotional: number
    executedNotional: number
    suggestedCostBasis: number
    executedCostBasis: number
    simulatedRealizedPnl: number
    executedRealizedPnl: number
    simulatedRealizedReturnPct: number | null
    executedRealizedReturnPct: number | null
  }
  notes: string[]
}

interface PersistedBacktestReviewReport {
  kind: 'advice_execution_review'
  version: 'v1'
  adviceId: string
  strategyId: string
  backtestId: string
  generatedAt: string
  windowReview: AdviceExecutionWindowReview
}

class BacktestService {
  private async getHistoricalOrLatestPrice(assetId: string, endDate: Date, fallbackPrice?: number | null) {
    const historyPoint = await prisma.priceHistory.findFirst({
      where: {
        assetId,
        timestamp: { lte: endDate },
        isValid: true,
      },
      orderBy: { timestamp: 'desc' },
    })

    if (historyPoint?.closePrice && historyPoint.closePrice > 0) {
      return historyPoint.closePrice
    }

    if (fallbackPrice && fallbackPrice > 0) {
      return fallbackPrice
    }

    return 0
  }

  /**
   * 获取策略列表
   */
  async getStrategies(userId: string) {
    return prisma.strategy.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })
  }

  /**
   * 创建策略
   */
  async createStrategy(userId: string, data: {
    name: string
    description?: string
    type: string
    parameters: Record<string, any>
  }) {
    return prisma.strategy.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        type: data.type,
        parameters: JSON.stringify(data.parameters),
      },
    })
  }

  /**
   * 更新策略
   */
  async updateStrategy(strategyId: string, data: {
    name?: string
    description?: string
    type?: string
    parameters?: Record<string, any>
    isActive?: boolean
  }) {
    const updateData: any = { ...data }
    if (data.parameters) {
      updateData.parameters = JSON.stringify(data.parameters)
    }
    return prisma.strategy.update({
      where: { id: strategyId },
      data: updateData,
    })
  }

  /**
   * 删除策略
   */
  async deleteStrategy(strategyId: string) {
    return prisma.strategy.delete({
      where: { id: strategyId },
    })
  }

  /**
   * 运行回测
   */
  async runBacktest(params: BacktestParams) {
    const strategy = await prisma.strategy.findUnique({
      where: { id: params.strategyId },
    })

    if (!strategy) {
      throw new Error('Strategy not found')
    }

    // 创建回测记录
    const backtest = await prisma.backtest.create({
      data: {
        strategyId: params.strategyId,
        startDate: new Date(params.startDate),
        endDate: new Date(params.endDate),
        initialCapital: params.initialCapital,
        status: 'running',
        progress: 0,
      },
    })

    // 异步执行回测
    this.executeBacktest(backtest.id, strategy, params).catch((error) => {
      console.error('Backtest failed:', error)
      prisma.backtest.update({
        where: { id: backtest.id },
        data: { status: 'failed' },
      })
    })

    return { backtestId: backtest.id, status: 'running' }
  }

  async runBacktestFromAdvice(params: AdviceBacktestParams) {
    const advice = await prisma.advice.findFirst({
      where: { id: params.adviceId, userId: params.userId },
      include: {
        actions: {
          include: { asset: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!advice) {
      throw new Error('Advice not found')
    }

    const recommendationJson = JSON.parse(advice.recommendationJson || '{}')
    const suggestionRows = Array.isArray(recommendationJson.suggestions) ? recommendationJson.suggestions : []
    const symbols = Array.from(new Set(
      advice.actions
        .map((action) => action.asset?.symbol)
        .filter((symbol): symbol is string => Boolean(symbol))
    ))

    if (symbols.length === 0) {
      throw new Error('Advice has no backtestable symbols')
    }

    const strategy = await prisma.strategy.create({
      data: {
        userId: params.userId,
        name: `Advice Backtest ${advice.id.slice(0, 8)}`,
        description: `Generated from advice ${advice.id}`,
        type: 'advice_snapshot',
        parameters: JSON.stringify({
          adviceId: advice.id,
          symbols,
          actions: advice.actions.map((action) => ({
            symbol: action.asset?.symbol,
            actionType: action.actionType,
            suggestedQuantity: action.suggestedQuantity,
            suggestedAmount: action.suggestedAmount,
            suggestedPrice: action.suggestedPrice,
            reason: action.reason,
          })),
          suggestions: suggestionRows,
        }),
      },
    })

    const startDate = params.startDate || advice.generatedAt.toISOString().split('T')[0]
    const endDate = params.endDate || new Date().toISOString().split('T')[0]
    const initialCapital = params.initialCapital || 100000

    const runResult = await this.runBacktest({
      strategyId: strategy.id,
      startDate,
      endDate,
      initialCapital,
      symbols,
    })

    return {
      ...runResult,
      strategyId: strategy.id,
      adviceId: advice.id,
      symbols,
      startDate,
      endDate,
      initialCapital,
    }
  }

  async getAdviceExecutionReview(params: AdviceBacktestParams): Promise<AdviceExecutionWindowReview> {
    const advice = await prisma.advice.findFirst({
      where: { id: params.adviceId, userId: params.userId },
      include: {
        adviceInputSnapshot: true,
        actions: {
          include: {
            asset: true,
            transactions: {
              orderBy: { executedAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!advice) {
      throw new Error('Advice not found')
    }

    const startDate = new Date(params.startDate || advice.generatedAt.toISOString().split('T')[0])
    const endDate = new Date(params.endDate || new Date().toISOString().split('T')[0])
    const executableActions = advice.actions.filter((action) => action.actionType === 'buy' || action.actionType === 'sell')
    const executedActions = executableActions.filter((action) => action.status === 'executed' || action.transactions.length > 0)
    const snapshotPositions = advice.adviceInputSnapshot
      ? JSON.parse(advice.adviceInputSnapshot.positionSnapshotJson || '[]') as Array<{
          assetId?: string
          avgCost?: number
          quantity?: number
        }>
      : []
    const snapshotCostByAssetId = new Map<string, { avgCost: number; quantity: number }>()
    for (const row of snapshotPositions) {
      if (row.assetId) {
        snapshotCostByAssetId.set(row.assetId, {
          avgCost: row.avgCost || 0,
          quantity: row.quantity || 0,
        })
      }
    }

    const summary: AdviceExecutionWindowReview = {
      adviceId: advice.id,
      startDate: startDate.toISOString().split('T')[0],
      endDate: endDate.toISOString().split('T')[0],
      executableActions: executableActions.length,
      executedActions: executedActions.length,
      pendingActions: Math.max(0, executableActions.length - executedActions.length),
      executionRate: executableActions.length > 0 ? Number((executedActions.length / executableActions.length).toFixed(4)) : 0,
      buySide: {
        suggestedNotional: 0,
        executedNotional: 0,
        simulatedEndValue: 0,
        executedEndValue: 0,
        simulatedPnl: 0,
        executedPnl: 0,
        simulatedReturnPct: null,
        executedReturnPct: null,
      },
      sellSide: {
        suggestedNotional: 0,
        executedNotional: 0,
        suggestedCostBasis: 0,
        executedCostBasis: 0,
        simulatedRealizedPnl: 0,
        executedRealizedPnl: 0,
        simulatedRealizedReturnPct: null,
        executedRealizedReturnPct: null,
      },
      notes: [],
    }

    for (const action of executableActions) {
      const symbolEndPrice = action.assetId
        ? await this.getHistoricalOrLatestPrice(action.assetId, endDate, action.asset?.lastPrice)
        : 0
      const suggestedPrice = action.suggestedPrice || symbolEndPrice || 0
      const suggestedQuantity = action.suggestedQuantity
        || (action.suggestedAmount && suggestedPrice > 0 ? action.suggestedAmount / suggestedPrice : 0)
      const suggestedNotional = action.suggestedAmount || (suggestedQuantity > 0 && suggestedPrice > 0 ? suggestedQuantity * suggestedPrice : 0)
      const windowTransactions = action.transactions.filter((transaction) => transaction.executedAt >= startDate && transaction.executedAt <= endDate)
      const executedQuantity = windowTransactions.reduce((sum, transaction) => sum + transaction.quantity, 0)
      const executedNotional = windowTransactions.reduce((sum, transaction) => sum + (transaction.quantity * transaction.price), 0)

      if (action.actionType === 'buy') {
        summary.buySide.suggestedNotional += suggestedNotional
        summary.buySide.executedNotional += executedNotional

        if (suggestedQuantity > 0 && symbolEndPrice > 0) {
          const simulatedEndValue = suggestedQuantity * symbolEndPrice
          summary.buySide.simulatedEndValue += simulatedEndValue
          summary.buySide.simulatedPnl += simulatedEndValue - suggestedNotional
        }

        if (executedQuantity > 0 && symbolEndPrice > 0) {
          const executedEndValue = executedQuantity * symbolEndPrice
          summary.buySide.executedEndValue += executedEndValue
          summary.buySide.executedPnl += executedEndValue - executedNotional
        }
      }

      if (action.actionType === 'sell') {
        const snapshotCost = action.assetId ? (snapshotCostByAssetId.get(action.assetId)?.avgCost || 0) : 0
        const simulatedCostBasis = suggestedQuantity > 0 && snapshotCost > 0 ? suggestedQuantity * snapshotCost : 0
        const executedCostBasis = executedQuantity > 0 && snapshotCost > 0 ? executedQuantity * snapshotCost : 0
        summary.sellSide.suggestedNotional += suggestedNotional
        summary.sellSide.executedNotional += executedNotional
        summary.sellSide.suggestedCostBasis += simulatedCostBasis
        summary.sellSide.executedCostBasis += executedCostBasis
        summary.sellSide.simulatedRealizedPnl += suggestedNotional - simulatedCostBasis
        summary.sellSide.executedRealizedPnl += executedNotional - executedCostBasis
      }
    }

    summary.buySide.suggestedNotional = Number(summary.buySide.suggestedNotional.toFixed(2))
    summary.buySide.executedNotional = Number(summary.buySide.executedNotional.toFixed(2))
    summary.buySide.simulatedEndValue = Number(summary.buySide.simulatedEndValue.toFixed(2))
    summary.buySide.executedEndValue = Number(summary.buySide.executedEndValue.toFixed(2))
    summary.buySide.simulatedPnl = Number(summary.buySide.simulatedPnl.toFixed(2))
    summary.buySide.executedPnl = Number(summary.buySide.executedPnl.toFixed(2))
    summary.sellSide.suggestedNotional = Number(summary.sellSide.suggestedNotional.toFixed(2))
    summary.sellSide.executedNotional = Number(summary.sellSide.executedNotional.toFixed(2))
    summary.sellSide.suggestedCostBasis = Number(summary.sellSide.suggestedCostBasis.toFixed(2))
    summary.sellSide.executedCostBasis = Number(summary.sellSide.executedCostBasis.toFixed(2))
    summary.sellSide.simulatedRealizedPnl = Number(summary.sellSide.simulatedRealizedPnl.toFixed(2))
    summary.sellSide.executedRealizedPnl = Number(summary.sellSide.executedRealizedPnl.toFixed(2))

    summary.buySide.simulatedReturnPct = summary.buySide.suggestedNotional > 0
      ? Number(((summary.buySide.simulatedPnl / summary.buySide.suggestedNotional) * 100).toFixed(4))
      : null
    summary.buySide.executedReturnPct = summary.buySide.executedNotional > 0
      ? Number(((summary.buySide.executedPnl / summary.buySide.executedNotional) * 100).toFixed(4))
      : null
    summary.sellSide.simulatedRealizedReturnPct = summary.sellSide.suggestedCostBasis > 0
      ? Number(((summary.sellSide.simulatedRealizedPnl / summary.sellSide.suggestedCostBasis) * 100).toFixed(4))
      : null
    summary.sellSide.executedRealizedReturnPct = summary.sellSide.executedCostBasis > 0
      ? Number(((summary.sellSide.executedRealizedPnl / summary.sellSide.executedCostBasis) * 100).toFixed(4))
      : null

    summary.notes.push('区间复盘使用回测结束日或最近可得历史收盘价估算建议模拟与实际执行结果。')
    if (summary.sellSide.suggestedNotional > 0 || summary.sellSide.executedNotional > 0) {
      summary.notes.push('卖出类建议已按建议生成时持仓成本复原已实现收益，适用于快速复盘。')
    }

    return summary
  }

  /**
   * 执行回测
   */
  private async executeBacktest(
    backtestId: string,
    strategy: StrategyData,
    params: BacktestParams
  ) {
    const startDate = new Date(params.startDate)
    const endDate = new Date(params.endDate)
    const parameters = JSON.parse(strategy.parameters || '{}')
    const symbols = params.symbols || parameters.symbols || ['AAPL', 'GOOGL', 'MSFT', 'AMZN', 'TSLA']

    // 获取回测期间的所有交易日
    const tradingDays = this.getTradingDays(startDate, endDate)

    // 获取所有资产的价格历史
    const assetPrices = await this.fetchAssetPrices(symbols, startDate, endDate)

    let capital = params.initialCapital
    let positions: Map<string, { quantity: number; avgCost: number }> = new Map()
    const equityCurve: EquityPoint[] = []
    const trades: Trade[] = []

    let peakEquity = capital

    for (let i = 0; i < tradingDays.length; i++) {
      const day = tradingDays[i]
      const progress = Math.round((i / tradingDays.length) * 100)

      // 更新进度
      await prisma.backtest.update({
        where: { id: backtestId },
        data: { progress },
      })

      // 获取当日价格
      const dayPrices = this.getDayPrices(day, assetPrices)

      // 根据策略生成信号
      const signals = this.generateSignals(strategy.type, parameters, dayPrices, positions, i, assetPrices, tradingDays)

      // 执行交易
      for (const signal of signals) {
        if (signal.action === 'buy' && capital >= signal.price * signal.quantity) {
          capital -= signal.price * signal.quantity
          const existing = positions.get(signal.symbol)
          if (existing) {
            const totalQty = existing.quantity + signal.quantity
            const totalCost = existing.avgCost * existing.quantity + signal.price * signal.quantity
            positions.set(signal.symbol, { quantity: totalQty, avgCost: totalCost / totalQty })
          } else {
            positions.set(signal.symbol, { quantity: signal.quantity, avgCost: signal.price })
          }
          trades.push({ date: day, type: 'buy', symbol: signal.symbol, quantity: signal.quantity, price: signal.price })
        } else if (signal.action === 'sell') {
          const existing = positions.get(signal.symbol)
          if (existing && existing.quantity >= signal.quantity) {
            capital += signal.price * signal.quantity
            existing.quantity -= signal.quantity
            if (existing.quantity === 0) {
              positions.delete(signal.symbol)
            }
            trades.push({ date: day, type: 'sell', symbol: signal.symbol, quantity: signal.quantity, price: signal.price })
          }
        }
      }

      // 计算当日权益
      let dayEquity = capital
      for (const [symbol, pos] of positions) {
        const priceData = dayPrices.get(symbol)
        if (priceData) {
          dayEquity += pos.quantity * priceData.close
        }
      }

      // 更新峰值和回撤
      if (dayEquity > peakEquity) peakEquity = dayEquity
      const drawdown = peakEquity > 0 ? (peakEquity - dayEquity) / peakEquity : 0

      equityCurve.push({ date: day, equity: dayEquity, drawdown })
    }

    // 计算回测指标
    const metrics = this.calculateMetrics(equityCurve, trades, params.initialCapital)

    // 计算月度收益
    const monthlyReturns = this.calculateMonthlyReturns(equityCurve)
    let reviewReport: PersistedBacktestReviewReport | null = null

    if (strategy.type === 'advice_snapshot' && parameters.adviceId) {
      try {
        const windowReview = await this.getAdviceExecutionReview({
          userId: strategy.userId,
          adviceId: parameters.adviceId,
          startDate: params.startDate,
          endDate: params.endDate,
        })
        reviewReport = {
          kind: 'advice_execution_review',
          version: 'v1',
          adviceId: parameters.adviceId,
          strategyId: strategy.id,
          backtestId,
          generatedAt: new Date().toISOString(),
          windowReview,
        }
      } catch (error) {
        console.error('Failed to build persisted backtest review report:', error)
      }
    }

    // 更新回测结果
    await prisma.backtest.update({
      where: { id: backtestId },
      data: {
        status: 'completed',
        progress: 100,
        finalCapital: metrics.totalReturn > 0 ? params.initialCapital * (1 + metrics.totalReturn / 100) : params.initialCapital * (1 - Math.abs(metrics.totalReturn) / 100),
        totalReturn: metrics.totalReturn,
        annualizedReturn: metrics.annualizedReturn,
        maxDrawdown: metrics.maxDrawdown,
        sharpeRatio: metrics.sharpeRatio,
        winRate: metrics.winRate,
        tradesCount: metrics.tradesCount,
        completedAt: new Date(),
      },
    })

    // 保存回测结果详情
    await prisma.backtestResult.create({
      data: {
        backtestId,
        periodStart: startDate,
        periodEnd: endDate,
        totalReturn: metrics.totalReturn,
        annualizedReturn: metrics.annualizedReturn,
        maxDrawdown: metrics.maxDrawdown,
        sharpeRatio: metrics.sharpeRatio,
        winRate: metrics.winRate,
        profitFactor: metrics.profitFactor,
        tradesCount: metrics.tradesCount,
        equityCurve: JSON.stringify(equityCurve),
        monthlyReturns: JSON.stringify(monthlyReturns),
        reviewReportJson: JSON.stringify(reviewReport || {}),
      },
    })

    // 保存交易信号
    for (const trade of trades) {
      await prisma.tradeSignal.create({
        data: {
          backtestId,
          assetSymbol: trade.symbol,
          signalType: trade.type === 'buy' ? 'buy' : 'sell',
          action: trade.type,
          quantity: trade.quantity,
          price: trade.price,
          confidence: 100,
          reason: `${trade.type === 'buy' ? '买入' : '卖出'} ${trade.symbol}`,
          executed: true,
          executedAt: trade.date,
        },
      })
    }
  }

  /**
   * 获取交易日列表
   */
  private getTradingDays(startDate: Date, endDate: Date): Date[] {
    const days: Date[] = []
    const current = new Date(startDate)

    while (current <= endDate) {
      const dayOfWeek = current.getDay()
      if (dayOfWeek !== 0 && dayOfWeek !== 6) {
        days.push(new Date(current))
      }
      current.setDate(current.getDate() + 1)
    }

    return days
  }

  /**
   * 获取指定日期的价格数据
   */
  private getDayPrices(day: Date, assetPrices: Map<string, PricePoint[]>): Map<string, PricePoint> {
    const prices = new Map<string, PricePoint>()
    const dayStart = new Date(day)
    dayStart.setHours(0, 0, 0, 0)
    const dayEnd = new Date(day)
    dayEnd.setHours(23, 59, 59, 999)

    for (const [symbol, points] of assetPrices) {
      const dayPoint = points.find(p => {
        const pDate = new Date(p.date)
        return pDate >= dayStart && pDate <= dayEnd
      })
      if (dayPoint) {
        prices.set(symbol, dayPoint)
      }
    }

    return prices
  }

  /**
   * 获取历史价格数据
   */
  private async fetchAssetPrices(symbols: string[], startDate: Date, endDate: Date): Promise<Map<string, PricePoint[]>> {
    const assetPrices = new Map<string, PricePoint[]>()

    // 查找或创建资产
    for (const symbol of symbols) {
      let asset = await prisma.asset.findUnique({
        where: { symbol },
      })

      if (!asset) {
        asset = await prisma.asset.create({
          data: {
            symbol,
            name: symbol,
            type: 'stock',
          },
        })
      }

      // 获取价格历史
      const priceHistory = await priceService.getPriceHistory(asset.id, startDate, endDate)

      if (priceHistory.data.length > 0) {
        const points: PricePoint[] = priceHistory.data.map((h) => ({
          date: h.timestamp,
          open: h.openPrice || h.closePrice,
          high: h.highPrice || h.closePrice,
          low: h.lowPrice || h.closePrice,
          close: h.closePrice,
          volume: h.volume || 0,
        }))
        assetPrices.set(symbol, points)
      }
    }

    // 如果没有历史数据，生成模拟数据用于测试
    if (assetPrices.size === 0) {
      const tradingDays = this.getTradingDays(startDate, endDate)
      for (const symbol of symbols) {
        const points: PricePoint[] = []
        let price = 100 + Math.random() * 100

        for (const day of tradingDays) {
          const change = (Math.random() - 0.5) * 0.04 * price
          const open = price
          const close = price + change
          const high = Math.max(open, close) * (1 + Math.random() * 0.02)
          const low = Math.min(open, close) * (1 - Math.random() * 0.02)

          points.push({
            date: new Date(day),
            open,
            high,
            low,
            close,
            volume: Math.random() * 10000000,
          })

          price = close
        }

        assetPrices.set(symbol, points)
      }
    }

    return assetPrices
  }

  /**
   * 生成交易信号
   */
  private generateSignals(
    strategyType: string,
    parameters: Record<string, any>,
    dayPrices: Map<string, PricePoint>,
    positions: Map<string, { quantity: number; avgCost: number }>,
    dayIndex: number,
    assetPrices: Map<string, PricePoint[]>,
    tradingDays: Date[]
  ): Signal[] {
    const signals: Signal[] = []

    switch (strategyType) {
      case 'moving_average_crossover':
        return this.generateMAcrossoverSignals(parameters, dayPrices, positions, assetPrices, tradingDays)

      case 'rsi_mean_reversion':
        return this.generateRSISignals(parameters, dayPrices, positions, assetPrices, tradingDays)

      case 'macd_momentum':
        return this.generateMACDSignals(parameters, dayPrices, positions, assetPrices, tradingDays)

      case 'bollinger_bands':
        return this.generateBollingerSignals(parameters, dayPrices, positions, assetPrices, tradingDays)

      case 'momentum':
      case 'mean_reversion':
      case 'trend_following':
      case 'custom':
        // 默认使用均线交叉策略
        return this.generateMAcrossoverSignals(parameters, dayPrices, positions, assetPrices, tradingDays)

      case 'advice_snapshot':
        return this.generateAdviceSnapshotSignals(parameters, dayPrices, positions, dayIndex)

      default:
        return signals
    }
  }

  private generateAdviceSnapshotSignals(
    parameters: Record<string, any>,
    dayPrices: Map<string, PricePoint>,
    positions: Map<string, { quantity: number; avgCost: number }>,
    dayIndex: number
  ): Signal[] {
    if (dayIndex !== 0) return []

    const actions = Array.isArray(parameters.actions) ? parameters.actions : []
    const signals: Signal[] = []

    for (const action of actions) {
      const symbol = action.symbol
      if (!symbol) continue
      const priceData = dayPrices.get(symbol)
      if (!priceData) continue

      if ((action.actionType === 'buy' || action.actionType === 'dca' || action.actionType === 'grid_order' || action.actionType === 'rebalance') && !positions.get(symbol)) {
        const quantity = action.suggestedQuantity && action.suggestedQuantity > 0
          ? action.suggestedQuantity
          : Math.max(100, Math.floor(((action.suggestedAmount || 10000) / priceData.close) / 100) * 100)
        if (quantity > 0) {
          signals.push({
            symbol,
            action: 'buy',
            quantity,
            price: priceData.close,
            reason: action.reason || 'Advice snapshot buy signal',
          })
        }
      }
    }

    return signals
  }

  /**
   * 均线交叉策略信号生成
   * MA5 上穿 MA20 → 买入信号
   * MA5 下穿 MA20 → 卖出信号
   */
  private generateMAcrossoverSignals(
    parameters: Record<string, any>,
    dayPrices: Map<string, PricePoint>,
    positions: Map<string, { quantity: number; avgCost: number }>,
    assetPrices: Map<string, PricePoint[]>,
    _tradingDays: Date[]
  ): Signal[] {
    const signals: Signal[] = []
    const fastPeriod = parameters.fastPeriod || 5
    const slowPeriod = parameters.slowPeriod || 20

    for (const [symbol, priceData] of dayPrices) {
      const history = assetPrices.get(symbol) || []
      const position = positions.get(symbol)

      // 需要足够的历史数据计算MA
      const dayHistory = history.filter(p => new Date(p.date) <= new Date(priceData.date))
      if (dayHistory.length < slowPeriod) continue

      const recentPrices = dayHistory.slice(-slowPeriod).map(p => p.close)

      const fastMA = this.calculateMA(recentPrices, fastPeriod)
      const slowMA = this.calculateMA(recentPrices, slowPeriod)

      // 获取前一天的数据
      if (dayHistory.length < slowPeriod + 1) continue
      const prevPrices = dayHistory.slice(-slowPeriod - 1).map(p => p.close)
      const prevFastMA = this.calculateMA(prevPrices.slice(0, -1), fastPeriod)
      const prevSlowMA = this.calculateMA(prevPrices.slice(0, -1), slowPeriod)

      // 金叉：fastMA上穿slowMA
      if (prevFastMA <= prevSlowMA && fastMA > slowMA && !position) {
        const quantity = Math.floor(10000 / priceData.close / 100) * 100
        if (quantity > 0) {
          signals.push({
            symbol,
            action: 'buy',
            quantity,
            price: priceData.close,
            reason: `MA${fastPeriod}(${fastMA.toFixed(2)}) 上穿 MA${slowPeriod}(${slowMA.toFixed(2)})`,
          })
        }
      }

      // 死叉：fastMA下穿slowMA
      if (prevFastMA >= prevSlowMA && fastMA < slowMA && position && position.quantity > 0) {
        signals.push({
          symbol,
          action: 'sell',
          quantity: position.quantity,
          price: priceData.close,
          reason: `MA${fastPeriod}(${fastMA.toFixed(2)}) 下穿 MA${slowPeriod}(${slowMA.toFixed(2)})`,
        })
      }
    }

    return signals
  }

  /**
   * RSI均值回归策略信号生成
   * RSI < 30 → 超卖，买入信号
   * RSI > 70 → 超买，卖出信号
   */
  private generateRSISignals(
    parameters: Record<string, any>,
    dayPrices: Map<string, PricePoint>,
    positions: Map<string, { quantity: number; avgCost: number }>,
    assetPrices: Map<string, PricePoint[]>,
    _tradingDays: Date[]
  ): Signal[] {
    const signals: Signal[] = []
    const rsiPeriod = parameters.rsiPeriod || 14
    const oversold = parameters.oversold || 30
    const overbought = parameters.overbought || 70

    for (const [symbol, priceData] of dayPrices) {
      const history = assetPrices.get(symbol) || []
      const position = positions.get(symbol)

      const dayHistory = history.filter(p => new Date(p.date) <= new Date(priceData.date))
      if (dayHistory.length < rsiPeriod) continue

      const recentPrices = dayHistory.slice(-rsiPeriod).map(p => p.close)
      const rsi = this.calculateRSI(recentPrices)

      // 超卖且没有持仓 -> 买入
      if (rsi < oversold && !position) {
        const quantity = Math.floor(10000 / priceData.close / 100) * 100
        if (quantity > 0) {
          signals.push({
            symbol,
            action: 'buy',
            quantity,
            price: priceData.close,
            reason: `RSI(${rsi.toFixed(2)}) < ${oversold} 超卖`,
          })
        }
      }

      // 超买且有持仓 -> 卖出
      if (rsi > overbought && position && position.quantity > 0) {
        signals.push({
          symbol,
          action: 'sell',
          quantity: position.quantity,
          price: priceData.close,
          reason: `RSI(${rsi.toFixed(2)}) > ${overbought} 超买`,
        })
      }
    }

    return signals
  }

  /**
   * MACD动量策略信号生成
   * MACD > Signal → 买入
   * MACD < Signal → 卖出
   */
  private generateMACDSignals(
    parameters: Record<string, any>,
    dayPrices: Map<string, PricePoint>,
    positions: Map<string, { quantity: number; avgCost: number }>,
    assetPrices: Map<string, PricePoint[]>,
    _tradingDays: Date[]
  ): Signal[] {
    const signals: Signal[] = []
    const fastPeriod = parameters.fastPeriod || 12
    const slowPeriod = parameters.slowPeriod || 26
    const signalPeriod = parameters.signalPeriod || 9

    for (const [symbol, priceData] of dayPrices) {
      const history = assetPrices.get(symbol) || []
      const position = positions.get(symbol)

      const dayHistory = history.filter(p => new Date(p.date) <= new Date(priceData.date))
      if (dayHistory.length < slowPeriod + signalPeriod) continue

      const recentPrices = dayHistory.slice(-(slowPeriod + signalPeriod)).map(p => p.close)
      const macd = this.calculateMACD(recentPrices, fastPeriod, slowPeriod, signalPeriod)

      // MACD > Signal 且没有持仓 -> 买入
      if (macd.macd > macd.signal && !position) {
        const quantity = Math.floor(10000 / priceData.close / 100) * 100
        if (quantity > 0) {
          signals.push({
            symbol,
            action: 'buy',
            quantity,
            price: priceData.close,
            reason: `MACD(${macd.macd.toFixed(2)}) > Signal(${macd.signal.toFixed(2)})`,
          })
        }
      }

      // MACD < Signal 且有持仓 -> 卖出
      if (macd.macd < macd.signal && position && position.quantity > 0) {
        signals.push({
          symbol,
          action: 'sell',
          quantity: position.quantity,
          price: priceData.close,
          reason: `MACD(${macd.macd.toFixed(2)}) < Signal(${macd.signal.toFixed(2)})`,
        })
      }
    }

    return signals
  }

  /**
   * 布林带策略信号生成
   * 价格触及下轨 → 买入
   * 价格触及上轨 → 卖出
   */
  private generateBollingerSignals(
    parameters: Record<string, any>,
    dayPrices: Map<string, PricePoint>,
    positions: Map<string, { quantity: number; avgCost: number }>,
    assetPrices: Map<string, PricePoint[]>,
    _tradingDays: Date[]
  ): Signal[] {
    const signals: Signal[] = []
    const period = parameters.period || 20
    const stdDev = parameters.stdDev || 2

    for (const [symbol, priceData] of dayPrices) {
      const history = assetPrices.get(symbol) || []
      const position = positions.get(symbol)

      const dayHistory = history.filter(p => new Date(p.date) <= new Date(priceData.date))
      if (dayHistory.length < period) continue

      const recentPrices = dayHistory.slice(-period).map(p => p.close)
      const bollinger = this.calculateBollingerBands(recentPrices, stdDev)

      // 价格触及下轨且没有持仓 -> 买入
      if (priceData.close <= bollinger.lower && !position) {
        const quantity = Math.floor(10000 / priceData.close / 100) * 100
        if (quantity > 0) {
          signals.push({
            symbol,
            action: 'buy',
            quantity,
            price: priceData.close,
            reason: `价格触及下轨(${bollinger.lower.toFixed(2)})`,
          })
        }
      }

      // 价格触及上轨且有持仓 -> 卖出
      if (priceData.close >= bollinger.upper && position && position.quantity > 0) {
        signals.push({
          symbol,
          action: 'sell',
          quantity: position.quantity,
          price: priceData.close,
          reason: `价格触及上轨(${bollinger.upper.toFixed(2)})`,
        })
      }
    }

    return signals
  }

  /**
   * 计算简单移动平均
   */
  private calculateMA(prices: number[], period: number): number {
    if (prices.length < period) return 0
    const recent = prices.slice(-period)
    return recent.reduce((a, b) => a + b, 0) / period
  }

  /**
   * 计算RSI
   */
  private calculateRSI(prices: number[], period: number = 14): number {
    if (prices.length < period + 1) return 50

    let gains = 0
    let losses = 0

    for (let i = prices.length - period; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1]
      if (change > 0) gains += change
      else losses -= change
    }

    const avgGain = gains / period
    const avgLoss = losses / period

    if (avgLoss === 0) return 100
    const rs = avgGain / avgLoss
    return 100 - (100 / (1 + rs))
  }

  /**
   * 计算MACD
   */
  private calculateMACD(
    prices: number[],
    fastPeriod: number,
    slowPeriod: number,
    _signalPeriod: number
  ): { macd: number; signal: number; histogram: number } {
    const fastEMA = this.calculateEMA(prices, fastPeriod)
    const slowEMA = this.calculateEMA(prices, slowPeriod)
    const macd = fastEMA - slowEMA

    // 简化：Signal线用MACD的EMA代替
    const signal = macd * 0.9 // 简化计算

    return {
      macd,
      signal,
      histogram: macd - signal,
    }
  }

  /**
   * 计算EMA
   */
  private calculateEMA(prices: number[], period: number): number {
    if (prices.length < period) return prices[prices.length - 1]

    const multiplier = 2 / (period + 1)
    let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period

    for (let i = period; i < prices.length; i++) {
      ema = (prices[i] - ema) * multiplier + ema
    }

    return ema
  }

  /**
   * 计算布林带
   */
  private calculateBollingerBands(prices: number[], stdDevMultiplier: number): { upper: number; middle: number; lower: number } {
    const period = prices.length
    const middle = prices.reduce((a, b) => a + b, 0) / period

    const squaredDiffs = prices.map(p => Math.pow(p - middle, 2))
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / period
    const stdDev = Math.sqrt(variance)

    return {
      upper: middle + stdDevMultiplier * stdDev,
      middle,
      lower: middle - stdDevMultiplier * stdDev,
    }
  }

  /**
   * 计算回测指标
   */
  private calculateMetrics(
    equityCurve: EquityPoint[],
    trades: Trade[],
    initialCapital: number
  ): BacktestMetrics {
    const finalEquity = equityCurve[equityCurve.length - 1]?.equity || initialCapital

    // 总收益率
    const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100

    // 年化收益率
    const tradingDays = equityCurve.length
    const years = tradingDays / 252
    const annualizedReturn = years > 0 ? (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100 : 0

    // 最大回撤
    const maxDrawdown = Math.max(...equityCurve.map(e => e.drawdown)) * 100

    // 计算日收益率
    const dailyReturns: number[] = []
    for (let i = 1; i < equityCurve.length; i++) {
      const dailyReturn = (equityCurve[i].equity - equityCurve[i - 1].equity) / equityCurve[i - 1].equity
      dailyReturns.push(dailyReturn)
    }

    // 夏普比率 (假设无风险利率为3%)
    const avgDailyReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length
    const variance = dailyReturns.reduce((sum, r) => sum + Math.pow(r - avgDailyReturn, 2), 0) / dailyReturns.length
    const stdDev = Math.sqrt(variance)
    const sharpeRatio = stdDev > 0 ? (avgDailyReturn * 252 - 0.03) / (stdDev * Math.sqrt(252)) : 0

    // 交易统计
    const tradesCount = trades.length
    // 计算每笔卖出的盈亏
    let totalWin = 0
    let totalLoss = 0
    let winningTrades = 0
    let losingTrades = 0

    // 简化计算：用买入均价和卖出价计算盈亏
    const buyTrades: Map<string, { quantity: number; totalCost: number }> = new Map()

    for (const trade of trades) {
      if (trade.type === 'buy') {
        const existing = buyTrades.get(trade.symbol) || { quantity: 0, totalCost: 0 }
        existing.quantity += trade.quantity
        existing.totalCost += trade.price * trade.quantity
        buyTrades.set(trade.symbol, existing)
      } else {
        const buyInfo = buyTrades.get(trade.symbol)
        if (buyInfo && buyInfo.quantity >= trade.quantity) {
          const avgBuyPrice = buyInfo.totalCost / buyInfo.quantity
          const pnl = (trade.price - avgBuyPrice) * trade.quantity

          if (pnl > 0) {
            totalWin += pnl
            winningTrades++
          } else {
            totalLoss += Math.abs(pnl)
            losingTrades++
          }

          buyInfo.quantity -= trade.quantity
          buyInfo.totalCost = avgBuyPrice * buyInfo.quantity
        }
      }
    }

    const winRate = tradesCount > 0 ? (winningTrades / tradesCount) * 100 : 0
    const avgWin = winningTrades > 0 ? totalWin / winningTrades : 0
    const avgLoss = losingTrades > 0 ? totalLoss / losingTrades : 0
    const profitFactor = totalLoss > 0 ? totalWin / totalLoss : totalWin > 0 ? Infinity : 0

    return {
      totalReturn,
      annualizedReturn,
      maxDrawdown,
      sharpeRatio,
      winRate,
      profitFactor,
      tradesCount,
      winningTrades,
      losingTrades,
      avgWin,
      avgLoss,
    }
  }

  /**
   * 计算月度收益
   */
  private calculateMonthlyReturns(equityCurve: EquityPoint[]): MonthlyReturn[] {
    const monthly: MonthlyReturn[] = []
    const byMonth: Map<string, { start: number; end: number }> = new Map()

    for (const point of equityCurve) {
      const key = `${point.date.getFullYear()}-${point.date.getMonth()}`
      if (!byMonth.has(key)) {
        byMonth.set(key, { start: point.equity, end: point.equity })
      } else {
        byMonth.get(key)!.end = point.equity
      }
    }

    for (const [key, values] of byMonth) {
      if (values.end !== values.start) {
        const [year, month] = key.split('-').map(Number)
        const monthlyReturn = ((values.end - values.start) / values.start) * 100
        monthly.push({ year, month, return: monthlyReturn })
      }
    }

    return monthly
  }

  /**
   * 获取回测结果
   */
  async getBacktestResult(backtestId: string) {
    const backtest = await prisma.backtest.findUnique({
      where: { id: backtestId },
      include: {
        results: true,
        signals: {
          where: { executed: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!backtest) {
      throw new Error('Backtest not found')
    }

    const result = backtest.results[0]
    let equityCurve: EquityPoint[] = []
    let monthlyReturns: MonthlyReturn[] = []
    let reviewReport: PersistedBacktestReviewReport | null = null

    if (result) {
      equityCurve = JSON.parse(result.equityCurve || '[]')
      monthlyReturns = JSON.parse(result.monthlyReturns || '[]')
      reviewReport = JSON.parse(result.reviewReportJson || '{}')
    }

    return {
      id: backtest.id,
      strategyId: backtest.strategyId,
      startDate: backtest.startDate,
      endDate: backtest.endDate,
      initialCapital: backtest.initialCapital,
      finalCapital: backtest.finalCapital,
      status: backtest.status,
      progress: backtest.progress,
      metrics: {
        totalReturn: backtest.totalReturn,
        annualizedReturn: backtest.annualizedReturn,
        maxDrawdown: backtest.maxDrawdown,
        sharpeRatio: backtest.sharpeRatio,
        winRate: backtest.winRate,
        tradesCount: backtest.tradesCount,
      },
      reviewReport,
      artifactRefs: reviewReport?.kind === 'advice_execution_review'
        ? [
            `backtest:${backtest.id}`,
            `backtest_result:${result?.id || ''}`,
            `report:${reviewReport.kind}:${backtest.id}`,
          ].filter(Boolean)
        : [`backtest:${backtest.id}`, `backtest_result:${result?.id || ''}`].filter(Boolean),
      equityCurve,
      monthlyReturns,
      trades: backtest.signals.map(s => ({
        date: s.executedAt,
        type: s.action,
        symbol: s.assetSymbol,
        quantity: s.quantity,
        price: s.price,
      })),
    }
  }

  /**
   * 获取回测列表
   */
  async getBacktests(strategyId?: string) {
    const where = strategyId ? { strategyId } : {}
    return prisma.backtest.findMany({
      where,
      include: {
        strategy: true,
      },
      orderBy: { createdAt: 'desc' },
    })
  }
}

export const backtestService = new BacktestService()
