/**
 * Analysis Service - 分析服务
 *
 * 职责：
 * 1. 生成每日/每周投资建议
 * 2. 风险分析
 * 3. 生成每日快照
 * 4. 标签和行业分析
 */

import { prisma } from '../../db/prisma.js'
import { positionService } from '../position/positionService.js'
import { transactionService } from '../transaction/transactionService.js'
import { marketDataService } from '../market-data/marketDataService.js'
import { llmService } from '../llm/llmService.js'
import { assetIdentityResolver } from '../asset/assetIdentityResolver.js'
import { stockScreenerService } from '../screener/stockScreenerService.js'
import { technicalIndicatorService } from '../technical/technicalIndicatorService.js'
import { marketFeatureDailyService } from '../market-data/marketFeatureDailyService.js'
import { marketBarCacheService } from '../market-data/marketBarCacheService.js'
import { securityStatusService } from '../market-data/securityStatusService.js'
import { valueAssessmentService } from '../valuation/valueAssessmentService.js'
import { positionAdviceService } from '../position/positionAdviceService.js'
import { dataGapSummaryService } from './dataGapSummaryService.js'
import { buildFivdRCapabilityFlags, deriveFivdRCapabilityState } from './fivdRCapabilityState.js'
import { deriveProhibitedActions } from './fivdRProhibitedActions.js'
import { researchAssetIdentityService } from '../asset/researchAssetIdentityService.js'
import { ensureUser } from '../../utils/user.js'

type AdviceActionType = 'buy' | 'sell' | 'hold' | 'rebalance' | 'grid_order' | 'dca'
type SuggestionType = 'grid_order' | 'dca_plan' | 'stop_loss' | 'take_profit' | 'rebalance' | 'buy_candidate' | 'reduce_position' | 'hold_review'
type AnalysisScope = 'all' | 'asset' | 'sector'
type FivdRResearchFactStatus = 'available' | 'partial' | 'missing' | 'not_applicable'

interface SuggestionRecord {
  id: string
  type: SuggestionType
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  targetSymbol?: string
  assetId?: string
  parameters: Record<string, any>
  createdAt: string
  adviceId?: string
  actionId?: string
  actionType?: AdviceActionType
  suggestedQuantity?: number
  suggestedPrice?: number
  suggestedAmount?: number
  confidence?: number
  status?: string
}

interface StructuredAdviceAction {
  asset_code?: string
  asset_name?: string
  asset_type?: string
  action: AdviceActionType | 'watch'
  priority: 'low' | 'medium' | 'high'
  confidence?: number
  reason: string
  suggested_quantity?: number | null
  suggested_amount?: number | null
  suggested_price?: number | null
  target_position_pct?: number | null
  stop_loss?: number | null
  take_profit?: number | null
  requires_asset_creation: boolean
}

interface StructuredAdvicePayload {
  schema_version: string
  generated_at: string
  scope: 'portfolio' | 'holding' | 'candidate' | 'strategy'
  summary: string
  risk_level: 'low' | 'medium' | 'high'
  required_user_confirmation: boolean
  portfolio_view?: {
    total_value: number
    cash_pct: number
    concentration_risk: 'low' | 'medium' | 'high'
    primary_observations: string[]
  }
  portfolio_targets?: Array<{
    bucket: string
    current_pct: number
    target_pct: number
    suggestion: 'increase' | 'decrease' | 'maintain'
  }>
  actions: StructuredAdviceAction[]
  risks: string[]
  disclaimer: string
}

interface AllocationSummary {
  totalValue: number
  byType: Array<{ type: string; value: number; ratio: number }>
  byTag: Array<{ tag: string; value: number; ratio: number }>
}

interface DataReliabilitySummary {
  overallStatus: 'healthy' | 'degraded' | 'failing' | 'unknown'
  averageConfidence: number | null
  warningCount: number
  warnings: string[]
  providerSummary: Array<{
    provider: string
    label: string
    successes: number
    failures: number
    fallbackHits: number
    healthScore: number
    status: 'healthy' | 'degraded' | 'failing' | 'unknown'
  }>
}

interface AdviceExecutionReview {
  executableActions: number
  executedActions: number
  pendingActions: number
  acceptedActions: number
  rejectedActions: number
  skippedActions: number
  executionRate: number
  suggestedNotional: number
  executedNotional: number
  buySide: {
    actionCount: number
    executedCount: number
    suggestedNotional: number
    executedNotional: number
    simulatedCurrentValue: number
    executedCurrentValue: number
    simulatedCurrentPnl: number
    executedCurrentPnl: number
  }
  sellSide: {
    actionCount: number
    executedCount: number
    suggestedNotional: number
    executedNotional: number
  }
  notes: string[]
}

interface FivdRCandidateInput {
  symbol: string
  name?: string
  strategyScore?: number
  strategyId?: string
  evidenceRefs?: string[]
}

interface AdviceExecutionReviewAction {
  actionType: string
  status: string
  suggestedQuantity: number | null
  suggestedAmount: number | null
  suggestedPrice: number | null
  asset: { lastPrice: number | null } | null
  execution: { decision: string } | null
  transactions: Array<{
    quantity: number
    price: number
  }>
}

class AnalysisService {
  private readonly adviceDisclaimer = 'AI 建议仅用于辅助决策，不自动交易，不构成投资建议。'
  private fivdRPortfolioCache: {
    userId: string
    generatedAt: number
    result: Record<string, any>
  } | null = null
  private fivdRPortfolioSummaryCache: {
    userId: string
    generatedAt: number
    result: Record<string, any>
  } | null = null

  private parseJson<T>(value: string | null | undefined, fallback: T): T {
    if (!value) return fallback
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  private async ensureUser(userId: string) {
    return ensureUser(prisma, userId)
  }

  private isBoardLotAsset(assetType: string) {
    return assetType === 'stock' || assetType === 'etf'
  }

  private normalizeTradeQuantity(assetType: string, quantity: number) {
    if (!Number.isFinite(quantity) || quantity <= 0) return 0
    if (!this.isBoardLotAsset(assetType)) return Math.floor(quantity * 10000) / 10000
    return Math.floor(quantity / 100) * 100
  }

  private estimateBuyQuantity(assetType: string, amount: number, price: number) {
    if (!price || price <= 0) return 0
    const rawQuantity = amount / price
    if (!this.isBoardLotAsset(assetType)) return Math.floor(rawQuantity * 10000) / 10000
    return Math.max(100, Math.floor(rawQuantity / 100) * 100)
  }

  private getPriorityScore(priority: 'low' | 'medium' | 'high') {
    return priority === 'high' ? 3 : priority === 'medium' ? 2 : 1
  }

  private getActionRiskHints(suggestions: SuggestionRecord[]) {
    const hints = new Set<string>()
    if (suggestions.some((item) => item.type === 'stop_loss' || item.type === 'take_profit')) {
      hints.add('已有止盈止损触发信号，需优先控制仓位纪律。')
    }
    if (suggestions.some((item) => item.type === 'reduce_position' || item.type === 'rebalance')) {
      hints.add('当前组合存在集中度或配置偏离风险。')
    }
    if (suggestions.some((item) => item.type === 'buy_candidate')) {
      hints.add('新增买入建议应结合现金比例和单标的上限审慎确认。')
    }
    if (hints.size === 0) {
      hints.add('当前建议以观察和纪律管理为主，仍需结合市场波动控制仓位。')
    }
    return Array.from(hints)
  }

  private buildPortfolioTargets(allocation: AllocationSummary) {
    void allocation
    return []
  }

  private summarizeReliability(params: {
    quoteResults?: Array<{
      confidenceScore?: number
      warnings?: string[]
      fallbackUsed?: boolean
    } | null>
  }): DataReliabilitySummary {
    const providerSummary = marketDataService.getProviderHealthSummary()
    const failingProviders = providerSummary.filter((item) => item.status === 'failing')
    const degradedProviders = providerSummary.filter((item) => item.status === 'degraded')
    const quoteResults = (params.quoteResults || []).filter(Boolean)
    const confidenceValues = quoteResults
      .map((item) => item?.confidenceScore)
      .filter((value): value is number => typeof value === 'number')
    const warningSet = new Set<string>()

    quoteResults.forEach((item) => {
      ;(item?.warnings || []).forEach((warning) => warningSet.add(warning))
      if (item?.fallbackUsed) {
        warningSet.add('部分建议使用了回退行情源，请结合主数据源复核。')
      }
    })

    if (failingProviders.length > 0) {
      warningSet.add(`存在 ${failingProviders.length} 个行情源处于 failing 状态。`)
    } else if (degradedProviders.length > 0) {
      warningSet.add(`存在 ${degradedProviders.length} 个行情源处于 degraded 状态。`)
    }

    const averageConfidence = confidenceValues.length > 0
      ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
      : null

    const overallStatus = failingProviders.length > 0
      ? 'failing'
      : degradedProviders.length > 0
      ? 'degraded'
      : providerSummary.some((item) => item.status === 'healthy')
      ? 'healthy'
      : 'unknown'

    return {
      overallStatus,
      averageConfidence: averageConfidence === null ? null : Number(averageConfidence.toFixed(4)),
      warningCount: warningSet.size,
      warnings: Array.from(warningSet),
      providerSummary,
    }
  }

  private buildAdviceExecutionReview(actions: AdviceExecutionReviewAction[]) {
    const executableActions = actions.filter((action) => action.actionType === 'buy' || action.actionType === 'sell')
    const executedActions = executableActions.filter((action) => action.status === 'executed' || action.transactions.length > 0)
    const acceptedActions = executableActions.filter((action) => action.execution?.decision === 'accepted').length
    const rejectedActions = executableActions.filter((action) => action.execution?.decision === 'rejected').length
    const skippedActions = executableActions.filter((action) => action.status === 'skipped' || action.execution?.decision === 'expired').length

    const summary: AdviceExecutionReview = {
      executableActions: executableActions.length,
      executedActions: executedActions.length,
      pendingActions: Math.max(0, executableActions.length - executedActions.length),
      acceptedActions,
      rejectedActions,
      skippedActions,
      executionRate: executableActions.length > 0 ? Number((executedActions.length / executableActions.length).toFixed(4)) : 0,
      suggestedNotional: 0,
      executedNotional: 0,
      buySide: {
        actionCount: 0,
        executedCount: 0,
        suggestedNotional: 0,
        executedNotional: 0,
        simulatedCurrentValue: 0,
        executedCurrentValue: 0,
        simulatedCurrentPnl: 0,
        executedCurrentPnl: 0,
      },
      sellSide: {
        actionCount: 0,
        executedCount: 0,
        suggestedNotional: 0,
        executedNotional: 0,
      },
      notes: [],
    }

    executableActions.forEach((action: AdviceExecutionReviewAction) => {
      const currentPrice = action.asset?.lastPrice || 0
      const suggestedPrice = action.suggestedPrice || currentPrice || 0
      const suggestedQuantity = action.suggestedQuantity
        || (
          action.suggestedAmount && suggestedPrice > 0
            ? action.suggestedAmount / suggestedPrice
            : 0
        )
      const suggestedNotional = action.suggestedAmount || (suggestedQuantity > 0 && suggestedPrice > 0 ? suggestedQuantity * suggestedPrice : 0)
      const executedQuantity = action.transactions.reduce((sum: number, transaction) => sum + transaction.quantity, 0)
      const executedNotional = action.transactions.reduce((sum: number, transaction) => sum + (transaction.quantity * transaction.price), 0)

      summary.suggestedNotional += suggestedNotional
      summary.executedNotional += executedNotional

      if (action.actionType === 'buy') {
        summary.buySide.actionCount += 1
        summary.buySide.suggestedNotional += suggestedNotional
        summary.buySide.executedNotional += executedNotional
        if (action.transactions.length > 0) {
          summary.buySide.executedCount += 1
        }

        if (suggestedQuantity > 0 && currentPrice > 0) {
          const simulatedCurrentValue = suggestedQuantity * currentPrice
          summary.buySide.simulatedCurrentValue += simulatedCurrentValue
          summary.buySide.simulatedCurrentPnl += simulatedCurrentValue - suggestedNotional
        }

        if (executedQuantity > 0 && currentPrice > 0) {
          const executedCurrentValue = executedQuantity * currentPrice
          summary.buySide.executedCurrentValue += executedCurrentValue
          summary.buySide.executedCurrentPnl += executedCurrentValue - executedNotional
        }
      }

      if (action.actionType === 'sell') {
        summary.sellSide.actionCount += 1
        summary.sellSide.suggestedNotional += suggestedNotional
        summary.sellSide.executedNotional += executedNotional
        if (action.transactions.length > 0) {
          summary.sellSide.executedCount += 1
        }
      }
    })

    if (summary.buySide.actionCount > 0) {
      summary.notes.push('买入类建议已按当前资产价格估算模拟持有与实际执行的浮盈亏。')
    }
    if (summary.sellSide.actionCount > 0) {
      summary.notes.push('卖出类建议当前仅统计建议金额与已执行金额，未纳入收益复原。')
    }
    if (summary.executableActions === 0) {
      summary.notes.push('当前建议批次没有可直接执行的买卖动作。')
    }

    summary.suggestedNotional = Number(summary.suggestedNotional.toFixed(2))
    summary.executedNotional = Number(summary.executedNotional.toFixed(2))
    summary.buySide.suggestedNotional = Number(summary.buySide.suggestedNotional.toFixed(2))
    summary.buySide.executedNotional = Number(summary.buySide.executedNotional.toFixed(2))
    summary.buySide.simulatedCurrentValue = Number(summary.buySide.simulatedCurrentValue.toFixed(2))
    summary.buySide.executedCurrentValue = Number(summary.buySide.executedCurrentValue.toFixed(2))
    summary.buySide.simulatedCurrentPnl = Number(summary.buySide.simulatedCurrentPnl.toFixed(2))
    summary.buySide.executedCurrentPnl = Number(summary.buySide.executedCurrentPnl.toFixed(2))
    summary.sellSide.suggestedNotional = Number(summary.sellSide.suggestedNotional.toFixed(2))
    summary.sellSide.executedNotional = Number(summary.sellSide.executedNotional.toFixed(2))

    return summary
  }

  private buildStructuredAdvicePayload(params: {
    suggestions: SuggestionRecord[]
    positions: any[]
    allocation: AllocationSummary
    generatedAt: Date
    scope: StructuredAdvicePayload['scope']
    summary: string
    riskLevel: 'low' | 'medium' | 'high'
  }): StructuredAdvicePayload {
    const totalValue = params.positions.reduce((sum, position) => sum + (position.marketValue || 0), 0)
    const cashValue = params.positions
      .filter((position) => position.asset?.type === 'cash')
      .reduce((sum, position) => sum + (position.marketValue || 0), 0)
    const cashPct = totalValue > 0 ? cashValue / totalValue : 0
    const concentrationRisk = params.suggestions.some((item) => item.type === 'rebalance' || item.type === 'reduce_position')
      ? 'high'
      : params.riskLevel === 'high'
      ? 'high'
      : params.riskLevel === 'medium'
      ? 'medium'
      : 'low'

    return {
      schema_version: 'v1',
      generated_at: params.generatedAt.toISOString(),
      scope: params.scope,
      summary: params.summary,
      risk_level: params.riskLevel,
      required_user_confirmation: true,
      portfolio_view: {
        total_value: Number(totalValue.toFixed(2)),
        cash_pct: Number(cashPct.toFixed(4)),
        concentration_risk: concentrationRisk,
        primary_observations: this.getActionRiskHints(params.suggestions),
      },
      portfolio_targets: this.buildPortfolioTargets(params.allocation),
      actions: params.suggestions.map((suggestion) => ({
        asset_code: suggestion.targetSymbol,
        asset_name: suggestion.title.split(' - ')[1] || suggestion.title,
        asset_type: params.positions.find((position) => position.asset?.symbol === suggestion.targetSymbol)?.asset?.type,
        action: suggestion.actionType || 'watch',
        priority: suggestion.priority,
        confidence: suggestion.confidence,
        reason: suggestion.description,
        suggested_quantity: suggestion.suggestedQuantity ?? null,
        suggested_amount: suggestion.suggestedAmount ?? null,
        suggested_price: suggestion.suggestedPrice ?? null,
        target_position_pct: typeof suggestion.parameters?.targetPositionPct === 'number'
          ? suggestion.parameters.targetPositionPct
          : null,
        stop_loss: typeof suggestion.parameters?.thresholdPercent === 'number' && suggestion.type === 'stop_loss'
          ? suggestion.parameters.thresholdPercent
          : params.positions.find((position) => position.asset?.symbol === suggestion.targetSymbol)?.stopLoss ?? null,
        take_profit: typeof suggestion.parameters?.thresholdPercent === 'number' && suggestion.type === 'take_profit'
          ? suggestion.parameters.thresholdPercent
          : params.positions.find((position) => position.asset?.symbol === suggestion.targetSymbol)?.takeProfit ?? null,
        requires_asset_creation: Boolean(!suggestion.assetId && suggestion.actionType === 'buy'),
      })),
      risks: this.getActionRiskHints(params.suggestions),
      disclaimer: this.adviceDisclaimer,
    }
  }

  private getEffectiveCostBasis(position: any) {
    if (position.unrealizedPnl !== null && position.unrealizedPnl !== undefined) {
      return (position.marketValue || 0) - position.unrealizedPnl
    }
    return position.costBasis || 0
  }

  private getPositionPnlPercent(position: any) {
    const effectiveCostBasis = this.getEffectiveCostBasis(position)
    if (effectiveCostBasis > 0 && position.unrealizedPnl !== null && position.unrealizedPnl !== undefined) {
      return (position.unrealizedPnl / effectiveCostBasis) * 100
    }
    if (effectiveCostBasis > 0) {
      return (((position.marketValue || 0) - effectiveCostBasis) / effectiveCostBasis) * 100
    }
    const price = position.currentPrice || position.asset?.lastPrice || 0
    return position.avgCost > 0 && price > 0 ? ((price - position.avgCost) / position.avgCost) * 100 : 0
  }

  private buildPositionAnalysisContext(position: any, signals: Array<{ type: string; reason: string; confidence: number }>) {
    const currentPrice = position.currentPrice || position.asset?.lastPrice || position.avgCost || 0
    const pnlPercent = this.getPositionPnlPercent(position)
    const support = currentPrice > 0 ? currentPrice * 0.92 : undefined
    const resistance = currentPrice > 0 ? currentPrice * 1.08 : undefined
    const trend = signals.find((signal) => signal.type === 'sell')
      ? '技术信号转弱'
      : signals.find((signal) => signal.type === 'buy')
      ? '技术信号改善'
      : currentPrice > position.avgCost * 1.05
      ? '价格强于成本线'
      : currentPrice < position.avgCost * 0.95
      ? '价格弱于成本线'
      : '成本附近震荡'

    return {
      fundamental: {
        quality: position.asset.type === 'stock'
          ? '需复核盈利质量、行业景气度、现金流和估值分位'
          : position.asset.type === 'fund' || position.asset.type === 'etf'
          ? '关注跟踪标的、费用率、规模、流动性和持仓集中度'
          : '关注资产属性、流动性和组合稳定性',
        valuation: position.asset.type === 'stock'
          ? '估值数据待接入，当前先用成本区间和价格位置做风险约束'
          : '净值类资产重点看回撤、波动和底层资产估值',
        risk: pnlPercent < -12
          ? '亏损较深，先确认基本面是否恶化，避免机械补仓'
          : pnlPercent > 20
          ? '浮盈较大，关注止盈和回撤保护'
          : '盈亏处于可复核区间，重点看仓位上限和趋势确认',
      },
      technical: {
        trend,
        currentPrice,
        avgCost: position.avgCost || 0,
        pnlPercent,
        support,
        resistance,
        stopReturnPercent: position.stopLoss ?? null,
        takeProfitReturnPercent: position.takeProfit ?? null,
        stopReference: support,
        takeProfitReference: resistance,
        signals: signals.map((signal) => ({
          type: signal.type,
          reason: signal.reason,
          confidence: signal.confidence,
        })),
      },
      news: {
        sentiment: '未接入实时新闻源，暂按中性处理',
        watchItems: [
          '最近一季财报、业绩预告或基金持仓变化',
          '行业政策、监管变化和需求景气度',
          '是否放量突破压力位或跌破支撑位',
        ],
      },
    }
  }

  private inferTargetType(input: string, scope: AnalysisScope): 'asset' | 'sector' {
    if (scope === 'asset' || scope === 'sector') return scope
    const keyword = input.trim()
    if (/^\d{4,6}(\.[A-Z]{2})?$/i.test(keyword)) return 'asset'
    if (/^[A-Z]{1,8}(\.[A-Z]{1,4})?$/i.test(keyword)) return 'asset'
    return 'sector'
  }

  private inferAssetType(symbol: string): string | undefined {
    const normalized = symbol.trim()
    if (/^\d{6}$/.test(normalized)) {
      if (/^(5|1)/.test(normalized)) return 'fund'
      return 'stock'
    }
    if (/^\d{4,5}(\.HK)?$/i.test(normalized)) return 'stock'
    return undefined
  }

  private buildQuoteSnapshot(quote: any, identity?: any) {
    if (!quote && !identity) return null
    return {
      symbol: quote?.symbol || identity?.normalizedSymbol || null,
      name: quote?.name || identity?.name || null,
      assetType: quote?.assetType || identity?.assetType || null,
      market: identity?.market || null,
      exchange: identity?.exchange || null,
      price: quote?.price ?? null,
      source: quote?.source || null,
      sourceLabel: quote?.sourceLabel || quote?.source || null,
      sourceTime: quote?.timestamp || null,
      isValid: quote?.isValid ?? null,
      confidenceScore: quote?.confidenceScore ?? identity?.confidenceScore ?? null,
      fallbackUsed: Boolean(quote?.fallbackUsed),
      warnings: [...new Set([...(quote?.warnings || []), ...(identity?.warnings || [])])],
    }
  }

  private parseJsonStringArray(value?: string | null): string[] {
    if (!value) return []
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : []
    } catch {
      return []
    }
  }

  private matchesAnalysisQuery(position: any, query?: string, scope: AnalysisScope = 'all') {
    const keyword = (query || '').trim().toLowerCase()
    if (!keyword) return true

    const asset = position.asset || {}
    const positionTags = [
      ...this.parseJsonStringArray(position.tags),
      ...this.parseJsonStringArray(position.labels),
    ]
    const assetTags = (asset.assetTags || []).flatMap((assetTag: any) => [
      assetTag.tag?.name,
      assetTag.tag?.category,
    ])

    const assetFields = [
      asset.symbol,
      asset.name,
    ]
    const sectorFields = [
      asset.type,
      asset.exchange,
      asset.sector,
      asset.industry,
      ...positionTags,
      ...assetTags,
    ]

    const fields = scope === 'asset'
      ? assetFields
      : scope === 'sector'
      ? sectorFields
      : [...assetFields, ...sectorFields]

    return fields
      .filter(Boolean)
      .some((field) => String(field).toLowerCase().includes(keyword))
  }

  private async getQuoteForAdviceSnapshot(position: any) {
    if (!position.asset?.symbol || position.asset.type === 'cash') {
      return null
    }

    const timeoutMs = 3500
    try {
      return await Promise.race([
        marketDataService.getQuote({
          symbol: position.asset.symbol,
          assetType: position.asset.type,
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
      ])
    } catch {
      return null
    }
  }

  /**
   * 获取每日/每周建议
   */
  async getSuggestions(userId: string, period: 'daily' | 'weekly') {
    if (period === 'daily') {
      return this.getDailySuggestions(userId)
    } else {
      return this.getWeeklySuggestions(userId)
    }
  }

  /**
   * 每日建议
   */
  private async getDailySuggestions(userId: string) {
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
    })

    const actions: Array<{
      type: 'buy' | 'sell' | 'hold'
      assetId: string
      symbol: string
      reason: string
      confidence: number
      quantity?: number
      price?: number
      estimatedAmount?: number
    }> = []

    const warnings: Array<{
      level: 'info' | 'warning' | 'danger'
      message: string
      assetId?: string
    }> = []

    for (const position of positions) {
      const currentPrice = position.currentPrice || 0
      const positionPnlPercent = this.getPositionPnlPercent(position)
      // 检查止损止盈：stopLoss / takeProfit 存储收益率百分比阈值。
      if (position.stopLoss !== null && position.stopLoss !== undefined && positionPnlPercent <= position.stopLoss) {
        actions.push({
          type: 'sell',
          assetId: position.assetId,
          symbol: position.asset.symbol,
          reason: `触及止损收益率阈值 ${position.stopLoss.toFixed(2)}%`,
          confidence: 95,
          quantity: position.quantity,
          price: currentPrice,
          estimatedAmount: position.quantity * currentPrice,
        })
        continue
      }

      if (position.takeProfit !== null && position.takeProfit !== undefined && positionPnlPercent >= position.takeProfit) {
        const sellQuantity = this.normalizeTradeQuantity(position.asset.type, position.quantity * 0.5)
        actions.push({
          type: 'sell',
          assetId: position.assetId,
          symbol: position.asset.symbol,
          reason: `触及止盈收益率阈值 ${position.takeProfit.toFixed(2)}%`,
          confidence: 90,
          quantity: sellQuantity,
          price: currentPrice,
          estimatedAmount: sellQuantity * currentPrice,
        })
        continue
      }

      // 获取RSI等技术指标
      const signals = await this.getTradingSignals(position.assetId)

      if (signals.length > 0) {
        for (const signal of signals) {
          actions.push({
            type: signal.type,
            assetId: position.assetId,
            symbol: position.asset.symbol,
            reason: signal.reason,
            confidence: signal.confidence,
          })
        }
      } else {
        actions.push({
          type: 'hold',
          assetId: position.assetId,
          symbol: position.asset.symbol,
          reason: '无明显信号',
          confidence: 100,
        })
      }
    }

    return {
      date: new Date().toISOString().split('T')[0],
      actions,
      warnings,
    }
  }

  /**
   * 每周建议
   */
  private async getWeeklySuggestions(userId: string) {
    const summary = await positionService.getPositionSummary(userId)
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
    })

    // 计算当前配置
    const allocation = this.calculateAllocation(positions)

    // 检查再平衡需求
    const rebalancingNeeded = await this.checkRebalancingNeed(allocation, userId)

    // 计算表现最好的和最差的持仓
    const withReturns = positions.map((p) => ({
      symbol: p.asset.symbol,
      returnPercent: (p.costBasis || 0) > 0 ? ((p.marketValue || 0) - (p.costBasis || 0)) / (p.costBasis || 1) * 100 : 0,
      marketValue: p.marketValue || 0,
    }))

    const sortedByReturn = [...withReturns].sort((a, b) => b.returnPercent - a.returnPercent)
    const topPerformer = sortedByReturn.length > 0 ? sortedByReturn[0] : null
    const worstPerformer = sortedByReturn.length > 0 ? sortedByReturn[sortedByReturn.length - 1] : null

    // 表现回顾
    const performance = {
      totalReturn: summary.totalPnlPercent,
      totalValue: summary.totalValue,
      topPerformer: topPerformer
        ? { symbol: topPerformer.symbol, returnPercent: topPerformer.returnPercent }
        : null,
      worstPerformer: worstPerformer
        ? { symbol: worstPerformer.symbol, returnPercent: worstPerformer.returnPercent }
        : null,
      positionsCount: summary.positionsCount,
    }

    return {
      week: this.getWeekNumber(new Date()),
      allocation,
      rebalancing: rebalancingNeeded,
      performanceReview: performance,
    }
  }

  /**
   * 获取交易信号
   */
  private async getTradingSignals(assetId: string): Promise<Array<{
    type: 'buy' | 'sell' | 'hold'
    reason: string
    confidence: number
  }>> {
    const signals: Array<{
      type: 'buy' | 'sell' | 'hold'
      reason: string
      confidence: number
    }> = []

    try {
      const snapshot = await technicalIndicatorService.getAssetSnapshot(assetId, { days: 260 })
      const technicalSignals = technicalIndicatorService.buildTradingSignals(snapshot)
      signals.push(...technicalSignals.map((signal) => ({
        type: signal.type,
        reason: signal.reason,
        confidence: signal.confidence,
      })))
    } catch (error) {
      console.error('Failed to calculate signals:', error)
    }

    return signals
  }

  /**
   * 计算资产配置
   */
  private calculateAllocation(positions: any[]) {
    const totalValue = positions.reduce((sum, p) => sum + (p.marketValue || 0), 0)
    const byType: Record<string, number> = {}
    const byTag: Record<string, number> = {}

    for (const position of positions) {
      byType[position.asset.type] = (byType[position.asset.type] || 0) + position.marketValue
      const tags = JSON.parse(position.tags || '[]')
      for (const tag of tags) {
        byTag[tag] = (byTag[tag] || 0) + position.marketValue
      }
    }

    return {
      totalValue,
      byType: Object.entries(byType).map(([type, value]) => ({
        type,
        value,
        ratio: totalValue > 0 ? (value / totalValue) * 100 : 0,
      })),
      byTag: Object.entries(byTag).map(([tag, value]) => ({
        tag,
        value,
        ratio: totalValue > 0 ? (value / totalValue) * 100 : 0,
      })),
    }
  }

  /**
   * 检查再平衡需求
   */
  private async checkRebalancingNeed(allocation: ReturnType<typeof this.calculateAllocation>, userId?: string) {
    // 默认目标配置
    const defaultTargetByType: Record<string, number> = {
      stock: 40,
      bond: 30,
      gold: 10,
      cash: 20,
    }

    let targetByType = { ...defaultTargetByType }

    // 如果提供了userId，尝试从用户的组合配置中获取目标配置
    if (userId) {
      try {
        const portfolios = await prisma.portfolio.findMany({
          where: { userId },
          include: { allocations: true },
        })

        if (portfolios.length > 0) {
          // 使用第一个组合的配置
          const mainPortfolio = portfolios[0]
          for (const alloc of mainPortfolio.allocations) {
            if (alloc.assetType) {
              targetByType[alloc.assetType] = alloc.targetRatio
            }
          }
        }
      } catch (error) {
        console.error('Failed to fetch portfolio allocation:', error)
      }
    }

    const actions: Array<{
      type: string
      currentRatio: number
      targetRatio: number
      action: 'add' | 'reduce' | 'maintain'
      amount: number
    }> = []

    let needed = false

    for (const item of allocation.byType) {
      const target = targetByType[item.type] || 0
      const diff = Math.abs(item.ratio - target)
      if (diff > 5) { // 偏离目标5%以上需要调整
        needed = true
        actions.push({
          type: item.type,
          currentRatio: item.ratio,
          targetRatio: target,
          action: item.ratio > target ? 'reduce' : 'add',
          amount: Math.abs(item.ratio - target) / 100 * allocation.totalValue,
        })
      }
    }

    return { needed, actions, targetByType }
  }

  /**
   * 获取周数
   */
  private getWeekNumber(date: Date): string {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
    const dayNum = d.getUTCDay() || 7
    d.setUTCDate(d.getUTCDate() + 4 - dayNum)
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
    return `${d.getUTCFullYear()}-W${weekNo.toString().padStart(2, '0')}`
  }

  /**
   * 生成每日快照
   */
  async getDailySnapshot(userId: string, date?: string) {
    const targetDate = date ? new Date(date) : new Date()
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0))
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999))

    let snapshot = await prisma.dailySnapshot.findFirst({
      where: {
        userId,
        date: { gte: startOfDay, lte: endOfDay },
      },
    })

    if (!snapshot) {
      const summary = await positionService.getPositionSummary(userId)
      const positions = await prisma.position.findMany({
        where: { userId, status: 'open' },
        include: { asset: true },
      })

      // 计算资产配置
      const allocation = this.calculateAllocation(positions)

      // 按日收益排序
      const withReturns = positions.map((p) => ({
        ...p,
        returnPercent: (p.costBasis || 0) > 0 ? ((p.marketValue || 0) - (p.costBasis || 0)) / (p.costBasis || 1) * 100 : 0,
      }))

      const topGainers = withReturns
        .filter((p) => p.returnPercent > 0)
        .sort((a, b) => b.returnPercent - a.returnPercent)
        .slice(0, 5)
        .map((p) => ({ symbol: p.asset.symbol, returnPercent: p.returnPercent }))

      const topLosers = withReturns
        .filter((p) => p.returnPercent < 0)
        .sort((a, b) => a.returnPercent - b.returnPercent)
        .slice(0, 5)
        .map((p) => ({ symbol: p.asset.symbol, returnPercent: p.returnPercent }))

      // 计算现金余额：从用户设置中获取或默认为0
      const user = await prisma.user.findUnique({ where: { id: userId } })
      const userSettings = JSON.parse(user?.settings || '{}')
      const cashBalance = userSettings.cashBalance || 0

      snapshot = await prisma.dailySnapshot.create({
        data: {
          userId,
          date: startOfDay,
          totalValue: summary.totalValue,
          cashBalance,
          positionsCount: summary.positionsCount,
          topGainers: JSON.stringify(topGainers),
          topLosers: JSON.stringify(topLosers),
          allocation: JSON.stringify(allocation),
          pnlDay: summary.totalPnl,
          pnlPercent: summary.totalPnlPercent,
        },
      })
    }

    return {
      id: snapshot.id,
      date: snapshot.date,
      totalValue: snapshot.totalValue,
      cashBalance: snapshot.cashBalance,
      positionsCount: snapshot.positionsCount,
      topGainers: JSON.parse(snapshot.topGainers),
      topLosers: JSON.parse(snapshot.topLosers),
      allocation: JSON.parse(snapshot.allocation || '{}'),
      pnlDay: snapshot.pnlDay,
      pnlPercent: snapshot.pnlPercent,
    }
  }

  /**
   * 生成每日快照（别名方法，用于MCP工具）
   */
  async generateDailySnapshot(userId: string, date?: string) {
    return this.getDailySnapshot(userId, date)
  }

  /**
   * 生成投资建议（网格挂单、定投计划、止损提醒）
   */
  async generateInvestmentSuggestions(userId: string, options: {
    query?: string
    scope?: AnalysisScope
  } = {}) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)

    const allPositions = await prisma.position.findMany({
      where: { userId: normalizedUserId, status: 'open' },
      include: {
        asset: {
          include: {
            assetTags: {
              include: { tag: true },
            },
          },
        },
      },
    })
    const scope = options.scope || 'all'
    const query = options.query?.trim()
    const positions = scope === 'all'
      ? allPositions
      : allPositions.filter((position) => this.matchesAnalysisQuery(position, query, scope))
    const nonCashPositions = positions.filter((position) => position.asset.type !== 'cash')
    const quoteResults = await Promise.all(nonCashPositions.map((position) => this.getQuoteForAdviceSnapshot(position)))
    const quoteByPositionId = new Map(nonCashPositions.map((position, index) => [position.id, quoteResults[index]]))

    const suggestions: SuggestionRecord[] = []

    for (const position of positions) {
      const currentPrice = position.currentPrice || 0
      const isTradeableMarketAsset = position.asset.type !== 'cash' && currentPrice > 0
      const positionPnlPercent = this.getPositionPnlPercent(position)
      const isLossReview = isTradeableMarketAsset && positionPnlPercent < -10

      // 获取技术指标
      const signals = await this.getTradingSignals(position.assetId)
      const analysisContext = this.buildPositionAnalysisContext(position, signals)
      const sellSignal = signals.find(s => s.type === 'sell' && s.confidence >= 75)
      const buySignal = signals.find(s => s.type === 'buy' && s.confidence >= 70)
      const isFundLike = position.asset.type === 'fund' || position.asset.type === 'etf'
      let suggestion: SuggestionRecord | null = null

      if (
        isTradeableMarketAsset &&
        position.stopLoss !== null &&
        position.stopLoss !== undefined &&
        positionPnlPercent <= position.stopLoss
      ) {
        const suggestedQuantity = this.normalizeTradeQuantity(position.asset.type, position.quantity)
        suggestion = {
          id: `stop_${position.assetId}_${Date.now()}`,
          type: 'stop_loss',
          title: `止损提醒 - ${position.asset.name}`,
          description: `当前收益率 ${positionPnlPercent.toFixed(2)}% 已触及止损阈值 ${position.stopLoss.toFixed(2)}%，优先控制回撤，建议按纪律减仓或卖出。`,
          priority: 'high',
          targetSymbol: position.asset.symbol,
          assetId: position.assetId,
          parameters: { thresholdPercent: position.stopLoss, currentReturnPercent: positionPnlPercent, reason: '触及止损收益率阈值', analysis: analysisContext },
          actionType: suggestedQuantity > 0 ? 'sell' : 'hold',
          suggestedQuantity,
          suggestedPrice: currentPrice,
          suggestedAmount: suggestedQuantity * currentPrice,
          confidence: 0.95,
          createdAt: new Date().toISOString(),
        }
      } else if (sellSignal) {
        const suggestedQuantity = this.normalizeTradeQuantity(position.asset.type, position.quantity * 0.5)
        suggestion = {
          id: `reduce_${position.assetId}_${Date.now()}`,
          type: 'reduce_position',
          title: `减仓观察 - ${position.asset.name}`,
          description: `${sellSignal.reason}，趋势转弱，建议先降低暴露或等待重新站稳关键均线`,
          priority: 'medium',
          targetSymbol: position.asset.symbol,
          assetId: position.assetId,
          parameters: { price: currentPrice * 0.95, reason: sellSignal.reason, analysis: analysisContext },
          actionType: suggestedQuantity > 0 ? 'sell' : 'hold',
          suggestedQuantity,
          suggestedPrice: currentPrice,
          suggestedAmount: suggestedQuantity * currentPrice,
          confidence: sellSignal.confidence / 100,
          createdAt: new Date().toISOString(),
        }
      } else if (
        isTradeableMarketAsset &&
        position.takeProfit !== null &&
        position.takeProfit !== undefined &&
        positionPnlPercent >= position.takeProfit
      ) {
        const suggestedQuantity = this.normalizeTradeQuantity(position.asset.type, position.quantity * 0.5)
        suggestion = {
          id: `profit_${position.assetId}_${Date.now()}`,
          type: 'take_profit',
          title: `止盈提醒 - ${position.asset.name}`,
          description: `当前收益率 ${positionPnlPercent.toFixed(2)}% 已触及止盈阈值 ${position.takeProfit.toFixed(2)}%，建议锁定部分利润并保留观察仓。`,
          priority: 'high',
          targetSymbol: position.asset.symbol,
          assetId: position.assetId,
          parameters: { thresholdPercent: position.takeProfit, currentReturnPercent: positionPnlPercent, reason: '触及止盈收益率阈值', analysis: analysisContext },
          actionType: suggestedQuantity > 0 ? 'sell' : 'hold',
          suggestedQuantity,
          suggestedPrice: currentPrice,
          suggestedAmount: suggestedQuantity * currentPrice,
          confidence: 0.9,
          createdAt: new Date().toISOString(),
        }
      } else if (isLossReview) {
        const lossPercent = positionPnlPercent.toFixed(2)
        const targetAmount = this.isBoardLotAsset(position.asset.type)
          ? Math.max(10000, currentPrice * 100)
          : 1000
        const suggestedQuantity = this.estimateBuyQuantity(position.asset.type, targetAmount, currentPrice)
        suggestion = {
          id: `dca_${position.assetId}_${Date.now()}`,
          type: isFundLike ? 'dca_plan' : 'hold_review',
          title: `${isFundLike ? '分批补仓' : '亏损复盘'} - ${position.asset.name}`,
          description: isFundLike
            ? `持仓亏损 ${lossPercent}%，若长期逻辑未变，可考虑小额分批补仓降低平均成本`
            : `持仓亏损 ${lossPercent}%，单一股票应先复核基本面和趋势，不默认补仓`,
          priority: isFundLike ? 'low' : 'medium',
          targetSymbol: position.asset.symbol,
          assetId: position.assetId,
          parameters: {
            amount: suggestedQuantity * currentPrice,
            frequency: 'weekly',
            currentLoss: lossPercent,
            analysis: analysisContext,
          },
          actionType: isFundLike && suggestedQuantity > 0 ? 'buy' : 'hold',
          suggestedQuantity: isFundLike ? suggestedQuantity : undefined,
          suggestedPrice: currentPrice,
          suggestedAmount: isFundLike ? suggestedQuantity * currentPrice : undefined,
          confidence: 0.65,
          createdAt: new Date().toISOString(),
        }
      } else if (isTradeableMarketAsset && buySignal) {
        const targetAmount = this.isBoardLotAsset(position.asset.type)
          ? Math.max(10000, currentPrice * 100)
          : 1000
        const suggestedQuantity = this.estimateBuyQuantity(position.asset.type, targetAmount, currentPrice)
        suggestion = {
          id: `buy_${position.assetId}_${Date.now()}`,
          type: 'buy_candidate',
          title: `加仓候选 - ${position.asset.name}`,
          description: `${buySignal.reason}，但仍需结合仓位上限和基本面确认，适合小仓位分批验证。`,
          priority: 'medium',
          targetSymbol: position.asset.symbol,
          assetId: position.assetId,
          parameters: { amount: suggestedQuantity * currentPrice, reason: buySignal.reason, analysis: analysisContext },
          actionType: suggestedQuantity > 0 ? 'buy' : 'hold',
          suggestedQuantity,
          suggestedPrice: currentPrice,
          suggestedAmount: suggestedQuantity * currentPrice,
          confidence: buySignal.confidence / 100,
          createdAt: new Date().toISOString(),
        }
      } else if (isTradeableMarketAsset) {
        suggestion = {
          id: `hold_${position.assetId}_${Date.now()}`,
          type: 'hold_review',
          title: `持有观察 - ${position.asset.name}`,
          description: `当前没有强交易信号，建议围绕成本、支撑位、压力位和仓位上限继续观察。`,
          priority: 'low',
          targetSymbol: position.asset.symbol,
          assetId: position.assetId,
          parameters: { analysis: analysisContext },
          actionType: 'hold',
          suggestedPrice: currentPrice,
          confidence: 0.55,
          createdAt: new Date().toISOString(),
        }
      }

      if (suggestion) {
        suggestions.push(suggestion)
      }
    }

    // 再平衡建议
    const allocation = this.calculateAllocation(positions)
    const rebalancing = await this.checkRebalancingNeed(allocation, normalizedUserId)
    if (!query && rebalancing.needed) {
      suggestions.push({
        id: `rebalance_${Date.now()}`,
        type: 'rebalance',
        title: '资产再平衡',
        description: '当前配置偏离目标，建议调整',
        priority: 'medium',
        parameters: rebalancing,
        actionType: 'rebalance',
        confidence: 0.7,
        createdAt: new Date().toISOString(),
      })
    }

    // 计算风险等级
    const riskScore = this.calculateRiskScore(positions)
    const riskLevel = riskScore > 70 ? 'high' : riskScore > 40 ? 'medium' : 'low'
    const dataReliability = this.summarizeReliability({ quoteResults })
    const generatedAt = new Date()
    const marketDataTrace = nonCashPositions.map((position) => {
      const quote = quoteByPositionId.get(position.id)
      return {
      assetId: position.assetId,
      symbol: position.asset.symbol,
      name: position.asset.name,
      assetType: position.asset.type,
      source: quote?.source || null,
      sourceLabel: quote?.sourceLabel || null,
      price: quote?.price ?? position.currentPrice ?? null,
      priceChangePercent: quote?.priceChangePercent ?? null,
      confidenceScore: quote?.confidenceScore ?? null,
      sourceTime: quote?.timestamp || null,
      isValid: quote?.isValid ?? null,
      fallbackUsed: quote?.fallbackUsed || false,
      warnings: quote?.warnings || [],
    }})
    const inputSnapshot = {
      generatedAt: generatedAt.toISOString(),
      query: query || null,
      scope,
      positions: positions.map((position) => ({
        assetId: position.assetId,
        symbol: position.asset.symbol,
        assetType: position.asset.type,
        quantity: position.quantity,
        avgCost: position.avgCost,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        costBasis: position.costBasis,
        stopLoss: position.stopLoss,
        takeProfit: position.takeProfit,
      })),
      allocation,
      dataReliability,
    }
    const sortedSuggestions = [...suggestions].sort((a, b) => this.getPriorityScore(b.priority) - this.getPriorityScore(a.priority))
    const structuredAdvice = this.buildStructuredAdvicePayload({
      suggestions: sortedSuggestions,
      positions,
      allocation,
      generatedAt,
      scope: query ? (scope === 'asset' ? 'holding' : 'candidate') : 'portfolio',
      summary: sortedSuggestions.length > 0
        ? `已生成 ${sortedSuggestions.length} 条结构化建议，优先处理高优先级纪律和仓位相关动作。`
        : '当前未生成明确动作建议，建议继续观察仓位与市场信号。',
      riskLevel,
    })

    const adviceInputSnapshot = await prisma.adviceInputSnapshot.create({
      data: {
        userId: normalizedUserId,
        capturedAt: generatedAt,
        portfolioSnapshotJson: JSON.stringify({
          totalValue: allocation.totalValue,
          totalCost: positions.reduce((sum, position) => sum + (position.costBasis || 0), 0),
          byType: allocation.byType,
          byTag: allocation.byTag,
          query: query || null,
          scope,
          dataReliability,
        }),
        positionSnapshotJson: JSON.stringify(inputSnapshot.positions),
        marketSnapshotJson: JSON.stringify(marketDataTrace),
        constraintsJson: JSON.stringify({
          requiresUserConfirmation: true,
          adviceScope: query ? (scope === 'asset' ? 'holding' : 'candidate') : 'portfolio',
          disclaimer: this.adviceDisclaimer,
        }),
        promptVersion: 'rules-engine-v1',
      },
    })

    const totalMarketValue = positions.reduce((sum, position) => sum + (position.marketValue || 0), 0)
    const totalCostBasis = positions.reduce((sum, position) => sum + (position.costBasis || 0), 0)
    const positionSnapshots = await Promise.all(positions.map((position) => prisma.positionSnapshot.create({
      data: {
        userId: normalizedUserId,
        positionId: position.id,
        assetId: position.assetId,
        capturedAt: generatedAt,
        quantity: position.quantity,
        avgCost: position.avgCost,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        costBasis: position.costBasis,
        actualWeightPct: totalMarketValue > 0 ? Number(((position.marketValue || 0) / totalMarketValue).toFixed(6)) : null,
        costWeightPct: totalCostBasis > 0 ? Number(((position.costBasis || 0) / totalCostBasis).toFixed(6)) : null,
      },
    })))

    const marketSnapshots = await Promise.all(nonCashPositions
      .map((position) => ({ position, quote: quoteByPositionId.get(position.id) }))
      .filter(({ quote, position }) => quote?.price || position.currentPrice)
      .map(({ position, quote }) => prisma.marketSnapshot.create({
        data: {
          assetId: position.assetId,
          capturedAt: generatedAt,
          price: quote?.price ?? position.currentPrice ?? null,
          currency: quote?.currency || null,
          source: quote?.sourceLabel || quote?.source || null,
          confidenceScore: quote?.confidenceScore ?? null,
          dayChangePct: quote?.priceChangePercent ?? null,
          valuationJson: JSON.stringify({
            marketValue: position.marketValue,
            costBasis: position.costBasis,
            sourceTime: quote?.timestamp || null,
            source: quote?.sourceLabel || quote?.source || null,
          }),
          technicalJson: JSON.stringify({
            warnings: quote?.warnings || [],
            fallbackUsed: quote?.fallbackUsed || false,
          }),
        },
      })))

    const advice = await prisma.advice.create({
      data: {
        userId: normalizedUserId,
        adviceInputSnapshotId: adviceInputSnapshot.id,
        generatedAt,
        summaryText: structuredAdvice.summary,
        disclaimerText: this.adviceDisclaimer,
        inputSnapshotJson: JSON.stringify(inputSnapshot),
        recommendationJson: JSON.stringify({ structuredAdvice, suggestions: sortedSuggestions, dataReliability }),
        rationaleText: '规则引擎基于止盈止损、技术信号、亏损定投和配置偏离生成建议。',
        riskLevel,
        status: 'proposed',
      },
    })

    const actionRows = await Promise.all(sortedSuggestions.map((suggestion) => prisma.adviceAction.create({
      data: {
        adviceId: advice.id,
        assetId: suggestion.assetId,
        actionType: suggestion.actionType || 'hold',
        suggestedQuantity: suggestion.suggestedQuantity,
        suggestedAmount: suggestion.suggestedAmount,
        suggestedPrice: suggestion.suggestedPrice,
        confidence: suggestion.confidence,
        reason: suggestion.description,
        status: 'proposed',
      },
    })))

    const suggestionsWithActions = sortedSuggestions.map((suggestion, index) => ({
      ...suggestion,
      adviceId: advice.id,
      actionId: actionRows[index]?.id,
      status: actionRows[index]?.status || 'proposed',
    }))
    const structuredAdviceWithActions = {
      ...structuredAdvice,
      actions: structuredAdvice.actions.map((action, index) => ({
        ...action,
        action_id: actionRows[index]?.id,
        advice_id: advice.id,
      })),
    }

    await prisma.advice.update({
      where: { id: advice.id },
      data: { recommendationJson: JSON.stringify({ structuredAdvice: structuredAdviceWithActions, suggestions: suggestionsWithActions, dataReliability }) },
    })

    const snapshotIds = {
      adviceInputSnapshotId: adviceInputSnapshot.id,
      positionSnapshotIds: positionSnapshots.map((snapshot) => snapshot.id),
      marketSnapshotIds: marketSnapshots.map((snapshot) => snapshot.id),
    }
    const artifactRefs = [
      `advice:${advice.id}`,
      `advice_input_snapshot:${adviceInputSnapshot.id}`,
      ...snapshotIds.positionSnapshotIds.map((id) => `position_snapshot:${id}`),
      ...snapshotIds.marketSnapshotIds.map((id) => `market_snapshot:${id}`),
    ]

    return {
      date: new Date().toISOString().split('T')[0],
      adviceId: advice.id,
      adviceInputSnapshotId: adviceInputSnapshot.id,
      snapshotIds,
      artifactRefs,
      query: query || null,
      scope,
      matchedPositions: positions.length,
      structuredAdvice: structuredAdviceWithActions,
      suggestions: suggestionsWithActions,
      marketDataTrace,
      dataReliability,
      riskLevel,
      overallScore: 100 - riskScore,
      marketOutlook: this.getMarketOutlook(positions),
      disclaimer: this.adviceDisclaimer,
    }
  }

  /**
   * 生成交易计划
   */
  async generateTradingPlan(userId: string, symbols: string[]) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)

    const positions = await prisma.position.findMany({
      where: { userId: normalizedUserId, status: 'open', asset: { symbol: { in: symbols } } },
      include: { asset: true },
    })

    const actions: Array<{
      symbol: string
      action: 'buy' | 'sell' | 'hold'
      quantity: number
      price: number
      amount: number
      reason: string
    }> = []

    for (const position of positions) {
      const signals = await this.getTradingSignals(position.assetId)
      const currentPrice = position.currentPrice || 0

      if (signals.length > 0) {
        const signal = signals[0]
        const quantity = this.estimateBuyQuantity(position.asset.type, 10000, currentPrice)

        if (signal.type === 'buy') {
          actions.push({
            symbol: position.asset.symbol,
            action: 'buy',
            quantity,
            price: currentPrice,
            amount: quantity * currentPrice,
            reason: signal.reason,
          })
        } else if (signal.type === 'sell') {
          const sellQuantity = this.normalizeTradeQuantity(position.asset.type, position.quantity)
          actions.push({
            symbol: position.asset.symbol,
            action: 'sell',
            quantity: sellQuantity,
            price: currentPrice,
            amount: sellQuantity * currentPrice,
            reason: signal.reason,
          })
        } else {
          actions.push({
            symbol: position.asset.symbol,
            action: 'hold',
            quantity: 0,
            price: currentPrice,
            amount: 0,
            reason: '无明显信号',
          })
        }
      } else {
        actions.push({
          symbol: position.asset.symbol,
          action: 'hold',
          quantity: 0,
          price: currentPrice,
          amount: 0,
          reason: '无明显信号，建议持有观察',
        })
      }
    }

    return {
      planId: `plan_${Date.now()}`,
      actions,
    }
  }

  async getAdviceDetail(userId: string, adviceId: string) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)

    const advice = await prisma.advice.findFirst({
      where: { id: adviceId, userId: normalizedUserId },
      include: {
        adviceInputSnapshot: true,
        actions: {
          include: {
            asset: true,
            execution: true,
            transactions: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    if (!advice) {
      throw new Error('Advice not found')
    }

    const recommendationJson = this.parseJson<Record<string, any>>(advice.recommendationJson, {})
    const inputSnapshotJson = this.parseJson<Record<string, any>>(advice.inputSnapshotJson, {})
    const adviceInputSnapshot = advice.adviceInputSnapshot
    const snapshotPayload = adviceInputSnapshot
      ? {
          adviceInputSnapshotId: adviceInputSnapshot.id,
          capturedAt: adviceInputSnapshot.capturedAt,
          portfolio: this.parseJson<Record<string, any>>(adviceInputSnapshot.portfolioSnapshotJson, {}),
          positions: this.parseJson<any[]>(adviceInputSnapshot.positionSnapshotJson, []),
          market: this.parseJson<any[]>(adviceInputSnapshot.marketSnapshotJson, []),
          constraints: this.parseJson<Record<string, any>>(adviceInputSnapshot.constraintsJson, {}),
        }
      : null

    const actions = advice.actions.map((action) => ({
      id: action.id,
      assetId: action.assetId,
      assetSymbol: action.asset?.symbol || null,
      assetName: action.asset?.name || null,
      actionType: action.actionType,
      suggestedQuantity: action.suggestedQuantity,
      suggestedAmount: action.suggestedAmount,
      suggestedPrice: action.suggestedPrice,
      confidence: action.confidence,
      reason: action.reason,
      status: action.status,
      executedAt: action.executedAt,
      execution: action.execution ? {
        id: action.execution.id,
        decision: action.execution.decision,
        executedAt: action.execution.executedAt,
        notes: action.execution.notes,
      } : null,
      transactions: action.transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        quantity: transaction.quantity,
        price: transaction.price,
        executedAt: transaction.executedAt,
      })),
    }))
    const executionReview = this.buildAdviceExecutionReview(advice.actions)

    return {
      adviceId: advice.id,
      generatedAt: advice.generatedAt,
      summaryText: advice.summaryText,
      disclaimerText: advice.disclaimerText,
      riskLevel: advice.riskLevel,
      status: advice.status,
      schemaVersion: advice.schemaVersion,
      rationaleText: advice.rationaleText,
      query: inputSnapshotJson.query || null,
      scope: inputSnapshotJson.scope || null,
      structuredAdvice: recommendationJson.structuredAdvice || null,
      suggestions: recommendationJson.suggestions || [],
      dataReliability: recommendationJson.dataReliability || null,
      inputSnapshot: snapshotPayload,
      actions,
      executionReview,
      artifactRefs: [
        `advice:${advice.id}`,
        ...(adviceInputSnapshot ? [`advice_input_snapshot:${adviceInputSnapshot.id}`] : []),
      ],
    }
  }

  async executeAdviceAction(userId: string, actionId: string, overrides: {
    quantity?: number
    price?: number
    fee?: number
    notes?: string
  } = {}) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)

    const action = await prisma.adviceAction.findUnique({
      where: { id: actionId },
      include: {
        asset: true,
        advice: true,
      },
    })

    if (!action || action.advice.userId !== normalizedUserId) {
      throw new Error('Advice action not found')
    }

    if (action.status === 'executed') {
      throw new Error('Advice action already executed')
    }

    if (action.actionType !== 'buy' && action.actionType !== 'sell') {
      throw new Error('Only buy/sell advice actions can be executed')
    }

    if (!action.assetId || !action.asset) {
      throw new Error('Advice action has no linked asset')
    }

    const quantity = this.normalizeTradeQuantity(
      action.asset.type,
      overrides.quantity ?? action.suggestedQuantity ?? 0
    )
    const price = overrides.price ?? action.suggestedPrice ?? action.asset.lastPrice ?? 0

    if (quantity <= 0 || price <= 0) {
      throw new Error('Advice action has invalid quantity or price')
    }

    const transaction = await transactionService.createTransaction({
      userId: normalizedUserId,
      assetId: action.assetId,
      type: action.actionType as 'buy' | 'sell',
      quantity,
      price,
      fee: overrides.fee || 0,
      notes: overrides.notes || `由分析建议确认记录：${action.reason || action.actionType}`,
      adviceActionId: action.id,
    })

    await prisma.adviceAction.update({
      where: { id: action.id },
      data: {
        status: 'executed',
        executedAt: new Date(),
      },
    })

    const siblingActions = await prisma.adviceAction.findMany({
      where: { adviceId: action.adviceId },
    })
    const executableActions = siblingActions.filter((item) => item.actionType === 'buy' || item.actionType === 'sell')
    const executedCount = executableActions.filter((item) => (
      item.id === action.id ? true : item.status === 'executed'
    )).length

    await prisma.advice.update({
      where: { id: action.adviceId },
      data: {
        status: executableActions.length > 0 && executedCount >= executableActions.length
          ? 'accepted'
          : 'partially_executed',
      },
    })

    return {
      actionId: action.id,
      adviceId: action.adviceId,
      status: 'executed',
      transaction,
    }
  }

  async analyzeTarget(userId: string, input: string, scope: AnalysisScope = 'all') {
    const normalizedUserId = userId || 'default'
    const keyword = input.trim()
    if (!keyword) {
      throw new Error('Target input is required')
    }

    await this.ensureUser(normalizedUserId)
    const localAssets = await prisma.asset.findMany({
      where: {
        OR: [
          { symbol: { equals: keyword } },
          { name: { contains: keyword } },
        ],
      },
    })
    const localAssetMatch = localAssets[0] || (await prisma.asset.findMany()).find((asset) => (
      asset.name.length >= 2 && keyword.includes(asset.name)
    ))
    const targetType = localAssetMatch ? 'asset' : this.inferTargetType(keyword, scope)
    const generatedAt = new Date()

    if (targetType === 'asset') {
      const identity = await assetIdentityResolver.resolve(keyword)
      const existingAsset = localAssetMatch || await prisma.asset.findFirst({
        where: {
          OR: [
            { symbol: { equals: identity.normalizedSymbol } },
            { name: { contains: keyword } },
          ],
        },
      })
      const symbol = identity.normalizedSymbol || existingAsset?.symbol || keyword.toUpperCase()
      const assetType = identity.assetType !== 'unknown'
        ? identity.assetType
        : existingAsset?.type || this.inferAssetType(symbol)

      let quote: Awaited<ReturnType<typeof marketDataService.getQuote>> | null = null
      const warnings: string[] = [...identity.warnings]
      try {
        quote = await Promise.race([
          marketDataService.getQuote({ symbol, source: 'auto', assetType }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 10000)),
        ])
        if (!quote) {
          warnings.push('行情查询超过10秒，未使用本地旧价替代。')
        }
      } catch (error) {
        warnings.push(error instanceof Error ? error.message : '行情获取失败')
      }
      const mergedWarnings = [...warnings, ...(quote?.warnings || [])]
      const linkedAsset = existingAsset && (
        !quote?.name ||
        existingAsset.name === quote.name ||
        existingAsset.name.includes(quote.name) ||
        quote.name.includes(existingAsset.name)
      )
        ? existingAsset
        : null

      const priceChangePercent = quote?.priceChangePercent ?? 0
      const holdingPositions = existingAsset
        ? await prisma.position.findMany({
          where: { userId: normalizedUserId, assetId: existingAsset.id, status: 'open' },
        })
        : []
      const holdingValue = holdingPositions.reduce((sum, position) => sum + (position.marketValue || 0), 0)
      const avgCost = holdingPositions.length > 0
        ? holdingPositions.reduce((sum, position) => sum + position.avgCost * position.quantity, 0) /
          Math.max(holdingPositions.reduce((sum, position) => sum + position.quantity, 0), 1)
        : null
      let score = 50
      if (quote?.isValid) score += 10
      if (priceChangePercent <= -2 && priceChangePercent >= -8) score += 12
      if (priceChangePercent < -8) score -= 8
      if (priceChangePercent >= 4) score -= 10
      if (quote?.price && quote.price > 0) score += 8
      if (mergedWarnings.length > 0) score -= 12
      if (quote?.fallbackUsed) score -= 4
      if ((quote?.providerComparisons || []).some((item) => item.deviationPercent >= 1)) score -= 6

      const recommendation = score >= 70 ? 'buy' : score >= 45 ? 'watch' : 'avoid'
      const actionType: AdviceActionType = recommendation === 'buy' ? 'buy' : 'hold'
      const suggestedPrice = quote?.price || existingAsset?.lastPrice || undefined
      const suggestedQuantity = actionType === 'buy' && suggestedPrice
        ? this.estimateBuyQuantity(assetType || 'stock', this.isBoardLotAsset(assetType || '') ? 10000 : 1000, suggestedPrice)
        : undefined
      const suggestedAmount = suggestedQuantity && suggestedPrice ? suggestedQuantity * suggestedPrice : undefined
      const reason = recommendation === 'buy'
        ? '行情可获取且短期涨跌幅未明显过热，可作为候选买入标的，建议小仓位试探并设置止损。'
        : recommendation === 'watch'
        ? '当前信息不足或价格信号不够强，建议先加入观察，等待更明确的价格和趋势确认。'
        : '行情质量或短期价格状态不支持立即买入，建议暂缓。'
      const support = suggestedPrice ? Number((suggestedPrice * 0.96).toFixed(3)) : undefined
      const resistance = suggestedPrice ? Number((suggestedPrice * 1.08).toFixed(3)) : undefined
      const researchDetail = {
        news: {
          summary: '已合并到统一标的研究入口。当前版本优先使用本地行情和持仓上下文，外部消息面会在行情 Provider 稳定后接入。',
          sentiment: mergedWarnings.length > 0 ? '谨慎' : '中性',
          watchItems: mergedWarnings.length > 0 ? mergedWarnings.slice(0, 3) : ['关注成交量能否配合价格突破', '关注所属板块和指数同步性'],
        },
        fundamental: {
          summary: existingAsset
            ? `${existingAsset.name} 已在本地资产池中，类型为 ${assetType || '未知'}。`
            : '新标的尚未进入本地资产池，基本面需补充财报、估值和行业对比数据。',
          quality: existingAsset ? '本地可识别' : '待补充',
          valuation: '待接入估值 Provider',
        },
        technical: {
          summary: priceChangePercent >= 4
            ? '短线涨幅偏高，追买性价比下降。'
            : priceChangePercent <= -8
            ? '短线跌幅较大，需等待止跌确认。'
            : '短线价格波动处于可观察区间。',
          support,
          resistance,
          currentPrice: suggestedPrice,
          priceChangePercent,
        },
        positionStrategy: {
          holdingValue,
          avgCost,
          buyRange: suggestedPrice
            ? { min: Number((suggestedPrice * 0.97).toFixed(3)), max: Number((suggestedPrice * 1.01).toFixed(3)) }
            : null,
          strategy: holdingPositions.length > 0
            ? '已有持仓，优先按成本线、支撑位和目标仓位做分批加减仓，不建议一次性补满。'
            : '无持仓，若进入买入区间且行情源可靠，可用小仓位试探，跌破支撑位停止加仓。',
        },
      }
      let aiAdvice: Awaited<ReturnType<typeof llmService.generateStockAdvice>> | null = null
      if (/^\d{6}$/.test(symbol) && assetType === 'stock' && identity.market === 'CN') {
        try {
          aiAdvice = await this.getTimedStockAdvice(symbol)
          if (!aiAdvice) {
            mergedWarnings.push('AI分析超过15秒，已先返回行情与持仓研究结果')
          }
        } catch (error) {
          mergedWarnings.push(error instanceof Error ? `AI分析失败：${error.message}` : 'AI分析失败')
        }
      }

      const suggestion: SuggestionRecord = {
        id: `research_${symbol}_${Date.now()}`,
        type: recommendation === 'buy' ? 'dca_plan' : 'rebalance',
        title: `${recommendation === 'buy' ? '候选买入' : recommendation === 'watch' ? '观察建议' : '暂缓买入'} - ${quote?.name || existingAsset?.name || symbol}`,
        description: reason,
        priority: recommendation === 'buy' ? 'medium' : recommendation === 'watch' ? 'low' : 'high',
        targetSymbol: symbol,
        assetId: linkedAsset?.id,
        parameters: {
          targetType,
          identity,
          symbol,
          name: quote?.name || existingAsset?.name,
          price: suggestedPrice,
          sourceTime: quote?.timestamp,
          priceChangePercent,
          score,
          recommendation,
          warnings: mergedWarnings,
          source: quote?.source,
          sourceLabel: quote?.sourceLabel,
          confidenceScore: quote?.confidenceScore,
          fallbackUsed: quote?.fallbackUsed,
        },
        actionType,
        suggestedQuantity,
        suggestedPrice,
        suggestedAmount,
        confidence: Math.max(0.35, Math.min(0.85, score / 100)),
        createdAt: generatedAt.toISOString(),
      }
      const structuredAdvice = this.buildStructuredAdvicePayload({
        suggestions: [suggestion],
        positions: linkedAsset ? [{
          asset: linkedAsset,
          marketValue: 0,
          stopLoss: null,
          takeProfit: null,
        }] : [],
        allocation: {
          totalValue: 0,
          byType: [],
          byTag: [],
        },
        generatedAt,
        scope: 'candidate',
        summary: recommendation === 'buy'
          ? '标的满足候选买入条件，但仍需人工确认仓位和风险约束。'
          : recommendation === 'watch'
          ? '当前更适合先观察，等待更明确的价格和趋势信号。'
          : '当前不满足立即买入条件，建议暂缓。',
        riskLevel: recommendation === 'avoid' ? 'high' : 'medium',
      })
      const dataReliability = this.summarizeReliability({ quoteResults: [quote] })
      const quoteSnapshot = this.buildQuoteSnapshot(quote, identity)

      const advice = await prisma.advice.create({
        data: {
          userId: normalizedUserId,
          generatedAt,
          inputSnapshotJson: JSON.stringify({ targetType, input: keyword, identity, quote: quoteSnapshot, warnings: mergedWarnings, dataReliability }),
          recommendationJson: JSON.stringify({ targetType, input: keyword, identity, recommendation, score, structuredAdvice, suggestions: [suggestion], dataReliability, researchDetail, aiAdvice }),
          rationaleText: reason,
          riskLevel: recommendation === 'buy' ? 'medium' : recommendation === 'watch' ? 'medium' : 'high',
          status: 'proposed',
        },
      })

      const action = await prisma.adviceAction.create({
        data: {
          adviceId: advice.id,
        assetId: linkedAsset?.id,
          actionType,
          suggestedQuantity,
          suggestedAmount,
          suggestedPrice,
          confidence: suggestion.confidence,
          reason,
          status: 'proposed',
        },
      })

      const suggestionWithAction = {
        ...suggestion,
        adviceId: advice.id,
        actionId: action.id,
        status: action.status,
      }
      const structuredAdviceWithActions = {
        ...structuredAdvice,
        actions: structuredAdvice.actions.map((structuredAction) => ({
          ...structuredAction,
          action_id: action.id,
          advice_id: advice.id,
        })),
      }

      await prisma.advice.update({
        where: { id: advice.id },
        data: { recommendationJson: JSON.stringify({ targetType, input: keyword, identity, recommendation, score, structuredAdvice: structuredAdviceWithActions, suggestions: [suggestionWithAction], dataReliability, researchDetail, aiAdvice }) },
      })

      return {
        date: generatedAt.toISOString().split('T')[0],
        adviceId: advice.id,
        targetType,
        input: keyword,
        targetName: quote?.name || aiAdvice?.name || existingAsset?.name || symbol,
        recommendation,
        recommendationText: recommendation === 'buy' ? '建议候选买入' : recommendation === 'watch' ? '建议观察' : '暂不建议买入',
        score,
        identity,
        quote,
        warnings: mergedWarnings,
        dataReliability,
        researchDetail,
        aiAdvice,
        structuredAdvice: structuredAdviceWithActions,
        suggestions: [suggestionWithAction],
        riskLevel: recommendation === 'avoid' ? 'high' : 'medium',
        overallScore: score,
        marketOutlook: reason,
        disclaimer: this.adviceDisclaimer,
      }
    }

    const matchedAssets = await prisma.asset.findMany({
      where: {
        OR: [
          { name: { contains: keyword } },
          { symbol: { contains: keyword } },
          { type: { contains: keyword } },
          { sector: { contains: keyword } },
          { industry: { contains: keyword } },
          { assetTags: { some: { tag: { OR: [{ name: { contains: keyword } }, { category: { contains: keyword } }] } } } },
        ],
      },
      include: {
        positions: {
          where: { userId: normalizedUserId, status: 'open' },
        },
      },
      take: 20,
    })

    const heldValue = matchedAssets.reduce((sum, asset) => (
      sum + asset.positions.reduce((innerSum, position) => innerSum + (position.marketValue || 0), 0)
    ), 0)
    const score = matchedAssets.length >= 5 ? 58 : matchedAssets.length > 0 ? 52 : 42
    const recommendation = score >= 70 ? 'buy' : score >= 45 ? 'watch' : 'avoid'
    const reason = matchedAssets.length > 0
      ? `已识别到 ${matchedAssets.length} 个相关标的，当前更适合作为板块观察清单，建议先选龙头或ETF分批验证。`
      : '暂未匹配到可靠标的池，缺少行情和成分股支撑，不建议直接买入该板块。'

    return {
      date: generatedAt.toISOString().split('T')[0],
      targetType,
      input: keyword,
      targetName: keyword,
      recommendation,
      recommendationText: recommendation === 'buy' ? '建议候选买入' : recommendation === 'watch' ? '建议观察' : '暂不建议买入',
      score,
      matchedAssets: matchedAssets.map((asset) => ({
        symbol: asset.symbol,
        name: asset.name,
        type: asset.type,
        sector: asset.sector,
        industry: asset.industry,
        lastPrice: asset.lastPrice,
      })),
      heldValue,
      warnings: matchedAssets.length === 0 ? ['未匹配到本地标的池，建议先补充板块成分或指数/ETF代码'] : [],
      suggestions: [],
      riskLevel: matchedAssets.length > 0 ? 'medium' : 'high',
      overallScore: score,
      marketOutlook: reason,
    }
  }

  private async getTimedStockAdvice(symbol: string, timeoutMs = 15000) {
    return Promise.race([
      llmService.generateStockAdvice(symbol, 'A股'),
      new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), timeoutMs)
      }),
    ])
  }

  async screenStocks(userId: string, query: string) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    return stockScreenerService.screenStocks(normalizedUserId, query)
  }

  async getFivdRPortfolioSummary(userId: string, options: {
    maxCacheAgeMs?: number
  } = {}) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const maxCacheAgeMs = Math.max(0, Number(options.maxCacheAgeMs ?? 5 * 60 * 1000))
    const now = Date.now()
    if (
      this.fivdRPortfolioCache
      && this.fivdRPortfolioCache.userId === normalizedUserId
      && now - this.fivdRPortfolioCache.generatedAt <= maxCacheAgeMs
    ) {
      return {
        ...this.fivdRPortfolioCache.result,
        cacheMeta: {
          source: 'memory_full_result',
          cacheAgeMs: now - this.fivdRPortfolioCache.generatedAt,
          fastPath: true,
        },
      }
    }
    if (
      this.fivdRPortfolioSummaryCache
      && this.fivdRPortfolioSummaryCache.userId === normalizedUserId
      && now - this.fivdRPortfolioSummaryCache.generatedAt <= maxCacheAgeMs
    ) {
      return {
        ...this.fivdRPortfolioSummaryCache.result,
        cacheMeta: {
          ...(this.fivdRPortfolioSummaryCache.result.cacheMeta || {}),
          source: 'memory_summary',
          cacheAgeMs: now - this.fivdRPortfolioSummaryCache.generatedAt,
          fastPath: true,
        },
      }
    }

    const generatedAt = new Date().toISOString()
    const runId = `fivd-r:summary:${normalizedUserId}:${now}`
    const latestValidation = await this.getLatestFivdRValidationSummaryEvidence()
    const [holdingsCount, nonCashHoldingsCount] = await Promise.all([
      prisma.position.count({ where: { userId: normalizedUserId, status: 'open' } }),
      prisma.position.count({
        where: {
          userId: normalizedUserId,
          status: 'open',
          asset: { type: { not: 'cash' } },
        },
      }),
    ])
    const blockerSet = new Set<string>()
    if (latestValidation?.validationDecision?.usableForTradingAdvice !== true) blockerSet.add('validation_evidence')
    const validationSummary = latestValidation?.strategyValidation?.validationEvidenceMatrix?.summary as any
    if (validationSummary?.primaryBlocker) blockerSet.add(String(validationSummary.primaryBlocker))
    const oosSummary = latestValidation?.strategyValidation?.oosMultiWindowRegimeRetest?.summary as any
    if (Number(oosSummary?.insufficientWindows || 0) > 0 || Number(oosSummary?.insufficientRegimeBuckets || 0) > 0) {
      blockerSet.add('market_regime_retest_insufficient')
    }
    const blockedReasons = Array.from(blockerSet)
    const validationUsable = latestValidation?.validationDecision?.usableForTradingAdvice === true
    const evidenceRefs = latestValidation?.evidenceRefs || []
    const dataGapSummary = dataGapSummaryService.build({
      blockedReasons,
      symbol: 'PORTFOLIO',
      assetName: '组合',
      assetType: 'unknown',
      evidenceRefs,
    })
    const prohibitedActions = deriveProhibitedActions({
      validationEvidencePassed: validationUsable,
      dataSufficient: dataGapSummary.every((gap) => gap.severity !== 'blocking' || !gap.requiredFor.includes('research')),
    })
    const capabilityState = deriveFivdRCapabilityState({
      summaryStatus: blockedReasons.length > 0 ? 'partial' : 'available',
      blockedReasons,
      missingData: ['portfolio_holding_detail_lazy_loaded'],
      prohibitedActions,
      validationEvidencePassed: validationUsable,
      dataGapSummary,
    })
    const response = {
      schemaVersion: 'fivd.r.analysis.result.v1',
      runId,
      generatedAt,
      userId: normalizedUserId,
      scope: 'portfolio',
      modelVersion: 'fivd-r-unified-v1',
      dataVersion: latestValidation?.generatedAt || generatedAt,
      orchestrationMode: 'internal_deterministic',
      summary: {
        status: blockedReasons.length > 0 ? 'partial' : 'available',
        conclusion: validationUsable
          ? 'FIVD-R 快速摘要可用；完整持仓研究仍建议后台刷新。'
          : 'FIVD-R 快速摘要可用；交易动作仍受 validation_evidence 阻断。',
        allowedActions: validationUsable ? ['RESEARCH', 'OBSERVE', 'PAPER_TRADE', 'MANUAL_REVIEW'] : ['RESEARCH', 'OBSERVE'],
        prohibitedActions,
        blockedReasons,
      },
      evidenceGate: {
        status: blockedReasons.includes('validation_evidence') ? 'partial' : 'pass',
        evidenceQualityScore: latestValidation?.validationDecision?.confidence === 'high' ? 80 : 55,
        missingData: ['portfolio_holding_detail_lazy_loaded'],
        conflictFlags: [],
        blockedReasons,
        evidenceRefs,
      },
      dataGapSummary,
      dataGapSummaryMeta: dataGapSummaryService.aggregate(dataGapSummary),
      capabilityState,
      ...buildFivdRCapabilityFlags({
        capabilityState,
        validationEvidencePassed: validationUsable,
        dataSufficient: dataGapSummary.every((gap) => gap.severity !== 'blocking' || !gap.requiredFor.includes('research')),
      }),
      portfolio: {
        holdingsCount,
        holdings: [],
      },
      strategyValidation: latestValidation?.strategyValidation || null,
      candidateDisposition: latestValidation?.candidateDisposition || null,
      agentTrace: this.buildFivdRAgentTrace({
        runId,
        generatedAt,
        scope: 'portfolio',
        blockedReasons,
        evidenceRefs: latestValidation?.evidenceRefs || [],
        latestValidation,
        valuationStatus: 'skipped',
        disciplineStatus: nonCashHoldingsCount > 0 ? 'skipped' : 'completed',
      }),
      explanation: '快速摘要只读取验证证据和持仓计数；完整持仓研究、估值和交易纪律由后台刷新或用户手动刷新触发。',
      cacheMeta: {
        source: 'fast_summary',
        fastPath: true,
        cacheAgeMs: null,
      },
    }
    this.fivdRPortfolioSummaryCache = {
      userId: normalizedUserId,
      generatedAt: now,
      result: response,
    }
    return response
  }

  async startFivdRPortfolioRefreshOperation(userId: string, input: {
    forceRefresh?: boolean
  } = {}) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const now = new Date()
    const operation = await prisma.operation.create({
      data: {
        userId: normalizedUserId,
        type: 'fivd_r_portfolio_refresh',
        status: 'queued',
        requestedAt: now,
        progressPct: 0,
        progressCurrent: 0,
        progressTotal: 100,
        progressMessage: 'FIVD-R portfolio refresh queued',
        createdBy: 'user',
        inputJson: JSON.stringify({
          userId: normalizedUserId,
          scope: 'portfolio',
          forceRefresh: input.forceRefresh === true,
        }),
      },
    })

    void this.executeFivdRPortfolioRefreshOperation(operation.id, normalizedUserId, input).catch((error) => {
      console.error('FIVD-R portfolio refresh operation failed outside handler:', error)
    })

    return {
      operationId: operation.id,
      operation_id: operation.id,
      id: operation.id,
      status: operation.status,
      requestedAt: operation.requestedAt,
      progressPct: operation.progressPct,
    }
  }

  private async executeFivdRPortfolioRefreshOperation(operationId: string, userId: string, _input: {
    forceRefresh?: boolean
  }) {
    const startedAt = new Date()
    const startResult = await prisma.operation.updateMany({
      where: {
        id: operationId,
        status: { notIn: ['cancelled', 'cancelling'] },
      },
      data: {
        status: 'running',
        startedAt,
        progressPct: 10,
        progressCurrent: 10,
        progressTotal: 100,
        progressMessage: 'FIVD-R portfolio refresh running',
        heartbeatAt: startedAt,
      },
    })
    if (startResult.count === 0) return

    try {
      if (!await this.updateFivdRRefreshProgress(operationId, 25, 'FIVD-R validation evidence loading')) return
      const generatedAt = new Date().toISOString()
      const runId = `fivd-r:${userId}:${Date.now()}`
      const latestValidation = await this.withTimeout(
        this.getLatestFivdRValidationSummaryEvidence(),
        this.getConfiguredTimeoutMs('FAMS_FIVDR_REFRESH_VALIDATION_TIMEOUT_MS', 15_000),
        'validation_evidence_timeout',
      )

      if (!await this.updateFivdRRefreshProgress(operationId, 45, 'FIVD-R holdings research loading')) return
      let holdings: Awaited<ReturnType<AnalysisService['getHoldingsResearch']>> = []
      const refreshWarnings: string[] = []
      try {
        holdings = await this.withTimeout(
          this.getHoldingsResearch(userId),
          this.getConfiguredTimeoutMs('FAMS_FIVDR_REFRESH_HOLDINGS_TIMEOUT_MS', 30_000),
          'holdings_research_timeout',
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : 'holdings_research_failed'
        refreshWarnings.push(message)
      }

      if (!await this.updateFivdRRefreshProgress(operationId, 85, 'FIVD-R portfolio result building')) return
      const result = this.buildFivdRPortfolioResult({
        userId,
        generatedAt,
        runId,
        latestValidation,
        holdings,
        refreshWarnings,
      })
      this.fivdRPortfolioCache = {
        userId,
        generatedAt: Date.now(),
        result,
      }
      const completedAt = new Date()
      const durationMs = completedAt.getTime() - startedAt.getTime()
      const artifactName = 'fivd_r_portfolio_analysis.json'
      const artifactRefs = [`operation_artifact:${operationId}:${artifactName}`]
      const payload = {
        schemaVersion: 'fivd.r.portfolio_refresh_operation.v1',
        operationId,
        generatedAt: completedAt.toISOString(),
        durationMs,
        fivdRAnalysis: result,
        artifacts: {
          [artifactName]: result,
        },
        artifactRefs,
      }
      const partialSuccess = refreshWarnings.length > 0
      await prisma.operation.updateMany({
        where: {
          id: operationId,
          status: { notIn: ['cancelled', 'cancelling'] },
        },
        data: {
          status: partialSuccess ? 'partial' : 'completed',
          completedAt,
          progressPct: 100,
          progressCurrent: 100,
          progressTotal: 100,
          progressMessage: partialSuccess
            ? `FIVD-R portfolio refresh partial: ${refreshWarnings.join(', ')}`
            : 'FIVD-R portfolio refresh completed',
          resultJson: JSON.stringify(payload),
          artifactRefsJson: JSON.stringify(artifactRefs),
          heartbeatAt: completedAt,
        },
      })
    } catch (error) {
      const completedAt = new Date()
      await prisma.operation.updateMany({
        where: {
          id: operationId,
          status: { notIn: ['cancelled', 'cancelling'] },
        },
        data: {
          status: 'failed',
          completedAt,
          progressPct: 100,
          progressCurrent: 100,
          progressTotal: 100,
          progressMessage: 'FIVD-R portfolio refresh failed',
          errorSummary: error instanceof Error ? error.message : 'Unknown FIVD-R refresh error',
          errorJson: JSON.stringify({
            message: error instanceof Error ? error.message : 'Unknown FIVD-R refresh error',
          }),
          heartbeatAt: completedAt,
        },
      })
    }
  }

  private async updateFivdRRefreshProgress(operationId: string, progressPct: number, progressMessage: string) {
    const updateResult = await prisma.operation.updateMany({
      where: {
        id: operationId,
        status: { notIn: ['cancelled', 'cancelling'] },
        cancelRequested: false,
      },
      data: {
        progressPct,
        progressCurrent: progressPct,
        progressTotal: 100,
        progressMessage,
        heartbeatAt: new Date(),
      },
    })
    return updateResult.count > 0
  }

  private getConfiguredTimeoutMs(envName: string, fallbackMs: number) {
    const rawValue = process.env[envName]
    const parsedValue = rawValue ? Number(rawValue) : NaN
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackMs
  }

  private async withTimeout<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined
    try {
      return await Promise.race([
        work,
        new Promise<T>((_, reject) => {
          timeout = setTimeout(() => reject(new Error(message)), timeoutMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
  }

  private buildFivdRPortfolioResult(params: {
    userId: string
    generatedAt: string
    runId: string
    latestValidation: Awaited<ReturnType<AnalysisService['getLatestFivdRValidationEvidence']>>
    holdings: any[]
    refreshWarnings?: string[]
  }) {
    const { userId, generatedAt, runId, latestValidation, holdings, refreshWarnings = [] } = params
    const blockerSet = new Set<string>()
    for (const holding of holdings) {
      for (const reason of holding.positionAdvice?.blockedReasons || []) blockerSet.add(reason)
      for (const reason of holding.valueAssessment?.valuation?.blockedReasons || []) blockerSet.add(reason)
    }
    if (latestValidation?.validationDecision?.usableForTradingAdvice !== true) blockerSet.add('validation_evidence')
    for (const warning of refreshWarnings) blockerSet.add(warning)
    const blockedReasons = Array.from(blockerSet)
    const validationUsable = latestValidation?.validationDecision?.usableForTradingAdvice === true
    const evidenceRefs = latestValidation?.evidenceRefs || []
    const dataGapSummary = [
      ...dataGapSummaryService.build({
        blockedReasons,
        symbol: 'PORTFOLIO',
        assetName: '组合',
        assetType: 'unknown',
        evidenceRefs,
      }),
      ...holdings.flatMap((holding) => dataGapSummaryService.build({
        blockedReasons: [
          ...(holding.positionAdvice?.blockedReasons || holding.positionAdvice?.advice?.blockedReasons || []),
          ...(holding.valueAssessment?.valuation?.blockedReasons || []),
        ],
        assetId: holding.assetId,
        symbol: holding.symbol,
        assetName: holding.name,
        assetType: holding.type || holding.assetType,
        evidenceRefs: [
          ...(holding.positionAdvice?.evidenceRefs || holding.positionAdvice?.advice?.evidenceRefs || []),
          ...(holding.valueAssessment?.evidenceRefs || []),
        ],
      })),
    ]
    const dataSufficient = dataGapSummary.every((gap) => gap.severity !== 'blocking' || !gap.requiredFor.includes('research'))
    const prohibitedActions = deriveProhibitedActions({
      validationEvidencePassed: validationUsable,
      dataSufficient,
    })
    const capabilityState = deriveFivdRCapabilityState({
      summaryStatus: blockerSet.size > 0 ? 'partial' : 'available',
      blockedReasons,
      missingData: refreshWarnings,
      prohibitedActions,
      validationEvidencePassed: validationUsable,
      dataGapSummary,
    })
    return {
      schemaVersion: 'fivd.r.analysis.result.v1',
      runId,
      generatedAt,
      userId,
      scope: 'portfolio',
      modelVersion: 'fivd-r-unified-v1',
      dataVersion: latestValidation?.generatedAt || generatedAt,
      orchestrationMode: 'internal_deterministic',
      summary: {
        status: blockerSet.size > 0 ? 'partial' : 'available',
        conclusion: validationUsable
          ? 'FIVD-R 研究链路可用，存在候选可进入人工复核。'
          : 'FIVD-R 研究链路可用；交易动作仍受 validation_evidence 阻断。',
        allowedActions: validationUsable ? ['RESEARCH', 'OBSERVE', 'PAPER_TRADE', 'MANUAL_REVIEW'] : ['RESEARCH', 'OBSERVE'],
        prohibitedActions,
        blockedReasons,
      },
      evidenceGate: {
        status: blockerSet.has('validation_evidence') ? 'partial' : 'pass',
        evidenceQualityScore: latestValidation?.validationDecision?.confidence === 'high' ? 80 : 55,
        missingData: refreshWarnings,
        conflictFlags: [],
        blockedReasons,
        evidenceRefs,
      },
      dataGapSummary,
      dataGapSummaryMeta: dataGapSummaryService.aggregate(dataGapSummary),
      capabilityState,
      ...buildFivdRCapabilityFlags({
        capabilityState,
        validationEvidencePassed: validationUsable && !blockerSet.has('validation_evidence'),
        dataSufficient,
      }),
      portfolio: {
        holdingsCount: holdings.length,
        holdings,
      },
      strategyValidation: latestValidation?.strategyValidation || null,
      candidateDisposition: latestValidation?.candidateDisposition || null,
      refreshWarnings,
      agentTrace: this.buildFivdRAgentTrace({
        runId,
        generatedAt,
        scope: 'portfolio',
        blockedReasons,
        evidenceRefs: latestValidation?.evidenceRefs || [],
        latestValidation,
        valuationStatus: holdings.some((holding) => holding.valueAssessment) ? 'completed' : 'insufficient',
        disciplineStatus: holdings.some((holding) => holding.positionAdvice) ? 'completed' : 'insufficient',
      }),
      explanation: 'FIVD-R 已统一消费价值评估、持仓建议和原 P4 验证锦标赛产物；P4 不再作为对外入口展示。',
    }
  }

  async getFivdRAnalysis(userId: string, options: {
    positionId?: string
    symbol?: string
    scope?: 'position' | 'portfolio'
    forceRefresh?: boolean
  } = {}) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const generatedAt = new Date().toISOString()
    const runId = `fivd-r:${normalizedUserId}:${Date.now()}`
    const latestValidation = await this.getLatestFivdRValidationEvidence()

    if (options.scope === 'portfolio' || (!options.positionId && !options.symbol)) {
      const holdings = await this.getHoldingsResearch(normalizedUserId)
      const response = this.buildFivdRPortfolioResult({
        userId: normalizedUserId,
        generatedAt,
        runId,
        latestValidation,
        holdings,
      })
      this.fivdRPortfolioCache = {
        userId: normalizedUserId,
        generatedAt: Date.now(),
        result: response,
      }
      return response
    }

    const position = await this.findFivdRPosition(normalizedUserId, options)
    if (!position) {
      const blockedReasons = ['asset_identity_missing', 'position_context_missing']
      const validationUsable = latestValidation?.validationDecision?.usableForTradingAdvice === true
      const dataGapSummary = dataGapSummaryService.build({
        blockedReasons: ['asset_identity_missing', ...(validationUsable ? [] : ['validation_evidence'])],
        symbol: options.symbol || options.positionId || 'UNKNOWN',
        assetName: options.symbol || '候选标的',
        assetType: 'unknown',
        evidenceRefs: latestValidation?.evidenceRefs || [],
      })
      const prohibitedActions = deriveProhibitedActions({ validationEvidencePassed: validationUsable, dataSufficient: false })
      const capabilityState = deriveFivdRCapabilityState({
        summaryStatus: 'blocked',
        blockedReasons,
        missingData: ['assetIdentity', 'positionContext'],
        prohibitedActions,
        validationEvidencePassed: validationUsable,
        dataGapSummary,
      })
      return {
        schemaVersion: 'fivd.r.analysis.result.v1',
        runId,
        generatedAt,
        userId: normalizedUserId,
        scope: 'candidate',
        modelVersion: 'fivd-r-unified-v1',
        dataVersion: latestValidation?.generatedAt || generatedAt,
        orchestrationMode: 'internal_deterministic',
        summary: {
          status: 'blocked',
          conclusion: '未找到匹配持仓；候选标的分析需要先完成资产身份解析和事实集采集。',
          allowedActions: ['RESEARCH'],
          prohibitedActions,
          blockedReasons,
        },
        evidenceGate: {
          status: 'blocked',
          evidenceQualityScore: 0,
          missingData: ['assetIdentity', 'positionContext'],
          conflictFlags: [],
          blockedReasons,
          evidenceRefs: [],
        },
        dataGapSummary,
        dataGapSummaryMeta: dataGapSummaryService.aggregate(dataGapSummary),
        capabilityState,
        ...buildFivdRCapabilityFlags({
          capabilityState,
          validationEvidencePassed: validationUsable,
          dataSufficient: false,
        }),
        strategyValidation: latestValidation?.strategyValidation || null,
        candidateDisposition: latestValidation?.candidateDisposition || null,
        agentTrace: this.buildFivdRAgentTrace({
          runId,
          generatedAt,
          scope: 'candidate',
          blockedReasons: ['asset_identity_missing', 'position_context_missing'],
          evidenceRefs: [],
          latestValidation,
          evidenceStatus: 'blocked',
          valuationStatus: 'skipped',
          disciplineStatus: 'skipped',
        }),
        explanation: '当前第一段 FIVD-R 统一入口优先支持已有持仓；新候选会在后续接入资产身份解析和候选事实集。',
      }
    }

    const [valuation, positionAdvice, expectedReturn] = await Promise.all([
      valueAssessmentService.assessPosition(position),
      position.asset.type === 'cash'
        ? Promise.resolve(null)
        : positionAdviceService.getPositionAdvice(position.id, {
          includeExternalAnalysis: false,
          externalAnalysisMode: 'cached',
          forceRefresh: options.forceRefresh === true,
        }).catch((error) => ({
          error: error instanceof Error ? error.message : 'position advice failed',
        })),
      this.buildFivdRExpectedReturn(position),
    ])
    const advice: any = positionAdvice && !('error' in positionAdvice) ? positionAdvice : null
    const blockedReasons = Array.from(new Set([
      ...(valuation.valuation.blockedReasons || []),
      ...(advice?.advice?.blockedReasons || []),
      ...(latestValidation?.validationDecision?.usableForTradingAdvice === true ? [] : ['validation_evidence']),
      ...(!advice && position.asset.type !== 'cash' ? ['position_advice_missing'] : []),
    ]))
    const validationUsable = latestValidation?.validationDecision?.usableForTradingAdvice === true
    const evidenceRefs = Array.from(new Set([
      ...valuation.evidenceRefs,
      ...(advice?.advice?.evidenceRefs || []),
      ...(latestValidation?.evidenceRefs || []),
    ]))
    const dataGapSummary = dataGapSummaryService.build({
      blockedReasons,
      assetId: position.assetId,
      symbol: position.asset.symbol,
      assetName: position.asset.name,
      assetType: position.asset.type,
      evidenceRefs,
    })
    const dataSufficient = dataGapSummary.every((gap) => gap.severity !== 'blocking' || !gap.requiredFor.includes('research'))
    const validationEffectivelyUsable = validationUsable && !blockedReasons.includes('validation_evidence')
    const formalTradeActionAllowed = false
    const prohibitedActions = deriveProhibitedActions({
      validationEvidencePassed: validationEffectivelyUsable,
      dataSufficient,
    })
    const capabilityState = deriveFivdRCapabilityState({
      summaryStatus: blockedReasons.length > 0 ? 'partial' : 'available',
      blockedReasons,
      missingData: blockedReasons.filter((reason) => reason.includes('missing') || reason.includes('insufficient')),
      prohibitedActions,
      validationEvidencePassed: validationUsable,
      dataGapSummary,
    })
    const tradingDiscipline = this.buildFivdRTradingDiscipline({
      position,
      advice,
      valuation,
      expectedReturn,
      blockedReasons,
      formalTradeActionAllowed,
      generatedAt,
    })

    return {
      schemaVersion: 'fivd.r.analysis.result.v1',
      runId,
      generatedAt,
      userId: normalizedUserId,
      scope: 'position',
      modelVersion: 'fivd-r-unified-v1',
      dataVersion: latestValidation?.generatedAt || generatedAt,
      orchestrationMode: 'internal_deterministic',
      asset: {
        assetId: position.assetId,
        positionId: position.id,
        symbol: position.asset.symbol,
        name: position.asset.name,
        assetType: position.asset.type,
      },
      summary: {
        status: blockedReasons.length > 0 ? 'partial' : 'available',
        conclusion: formalTradeActionAllowed
          ? 'FIVD-R 验证通过，可进入人工交易计划复核。'
          : 'FIVD-R 可输出研究结论；formal ADD / REDUCE 仍被 gate 阻断。',
        allowedActions: formalTradeActionAllowed ? ['RESEARCH', 'OBSERVE', 'PAPER_TRADE', 'MANUAL_REVIEW'] : ['RESEARCH', 'OBSERVE'],
        prohibitedActions,
        blockedReasons,
      },
      evidenceGate: {
        status: blockedReasons.includes('validation_evidence') ? 'partial' : blockedReasons.length > 0 ? 'partial' : 'pass',
        evidenceQualityScore: valuation.valuation.confidence === 'medium' ? 65 : valuation.valuation.confidence === 'low' ? 45 : 30,
        missingData: blockedReasons.filter((reason) => reason.includes('missing') || reason.includes('insufficient')),
        conflictFlags: [],
        blockedReasons,
        evidenceRefs,
      },
      dataGapSummary,
      dataGapSummaryMeta: dataGapSummaryService.aggregate(dataGapSummary),
      capabilityState,
      ...buildFivdRCapabilityFlags({
        capabilityState,
        validationEvidencePassed: validationUsable,
        dataSufficient,
      }),
      valuation,
      expectedReturn,
      tradingDiscipline,
      strategyValidation: latestValidation?.strategyValidation || null,
      candidateDisposition: latestValidation?.candidateDisposition || null,
      positionAdviceImpact: {
        schemaVersion: 'fivd.r.position_advice_impact.v1',
        targetWeightMultiplier: valuation.valuation.targetWeightMultiplier,
        validationGateMultiplier: validationEffectivelyUsable ? 1 : 0,
        formalTradeActionAllowed,
      },
      agentTrace: this.buildFivdRAgentTrace({
        runId,
        generatedAt,
        scope: 'position',
        blockedReasons,
        evidenceRefs,
        latestValidation,
        valuationStatus: valuation.valuation.status === 'insufficient' ? 'insufficient' : 'completed',
        disciplineStatus: advice ? 'completed' : position.asset.type === 'cash' ? 'completed' : 'insufficient',
      }),
      explanation: '统一 FIVD-R 入口已将价值评估、交易纪律、P4 验证锦标赛和候选处置合并为一个结构化结果；LLM 只能解释该结果，不能新增交易结论。',
    }
  }

  async scoreFivdRCandidates(userId: string, options: {
    source: 'stock_screener' | 'manual_list' | 'watchlist' | string
    strategyQuery?: string
    candidates: FivdRCandidateInput[]
  }) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const generatedAt = new Date().toISOString()
    const runId = `fivd-r:candidates:${normalizedUserId}:${Date.now()}`
    const latestValidation = await this.getLatestFivdRValidationEvidence()
    const normalizedCandidates = options.candidates
      .map((candidate) => ({
        ...candidate,
        symbol: this.normalizeCandidateSymbol(candidate.symbol),
      }))
      .filter((candidate) => /^\d{6}$/.test(candidate.symbol))
      .slice(0, 50)
    const symbols = Array.from(new Set(normalizedCandidates.map((candidate) => candidate.symbol)))
    const [assets, features, identities] = await Promise.all([
      prisma.asset.findMany({
        where: { symbol: { in: symbols } },
      }),
      marketFeatureDailyService.getLatestFeatures(symbols, { market: 'CN' }).catch(() => new Map()),
      Promise.all(symbols.map((symbol) => researchAssetIdentityService.resolve(symbol).catch(() => null))),
    ])
    const assetBySymbol = new Map(assets.map((asset) => [this.normalizeCandidateSymbol(asset.symbol), asset]))
    const identityBySymbol = new Map(identities.filter(Boolean).map((identity) => [identity!.symbol, identity!]))
    const validationUsable = latestValidation?.validationDecision?.usableForTradingAdvice === true
    const candidateDisposition = latestValidation?.candidateDisposition as any
    const dispositionByName = new Map<string, any>(
      Array.isArray(candidateDisposition?.candidates)
        ? candidateDisposition.candidates.map((candidate: any) => [String(candidate.name || '').trim(), candidate])
        : []
    )
    const scored = normalizedCandidates.map((candidate) => {
      const identity = identityBySymbol.get(candidate.symbol)
      const asset = assetBySymbol.get(candidate.symbol)
      const feature = features.get(candidate.symbol)
      const sourceDisposition = dispositionByName.get(candidate.name || asset?.name || identity?.name || '')
      const strategyValidation = this.clampScore(this.safeScore(candidate.strategyScore, 50))
      const trend = this.clampScore(Number(feature?.trendScore ?? 50))
      const momentum = this.clampScore(Number(feature?.momentumScore ?? 50))
      const liquidity = this.clampScore(Number(feature?.liquidityScore ?? 50))
      const drawdown = Math.abs(Number(feature?.maxDrawdown20 ?? 0))
      const volatility = Math.abs(Number(feature?.volatility20 ?? 0))
      const risk = this.clampScore(80 - drawdown * 1.2 - volatility * 0.8)
      const expectedReturn = this.clampScore(50 + Number(feature?.return20d ?? 0) * 1.2 + Number(feature?.relativeStrength60 ?? 0) * 0.5)
      const identityResolved = Boolean(asset || identity?.resolved)
      const valuation = asset ? 55 : identityResolved ? 45 : 35
      const evidenceQuality = this.clampScore(
        35
        + (feature ? 30 : 0)
        + (asset ? 15 : identityResolved ? 8 : 0)
        + (Array.isArray(candidate.evidenceRefs) && candidate.evidenceRefs.length > 0 ? 10 : 0)
        + (latestValidation ? 10 : 0)
      )
      const marketState = this.clampScore((trend + momentum + liquidity) / 3)
      const blockers = [
        ...(!identityResolved ? ['asset_identity_missing'] : []),
        ...(!feature ? ['technical_feature_missing'] : []),
        ...(!validationUsable ? ['validation_evidence'] : []),
        ...(evidenceQuality < 55 ? ['candidate_evidence_insufficient'] : []),
        ...(sourceDisposition?.finalDisposition === 'retire_candidate' ? ['candidate_retired_by_validation'] : []),
      ]
      const signalScore = this.clampScore(
        strategyValidation * 0.45
        + trend * 0.2
        + momentum * 0.15
        + liquidity * 0.1
        + risk * 0.1
      )
      const researchScore = this.clampScore(
        strategyValidation * 0.25
        + valuation * 0.2
        + expectedReturn * 0.15
        + risk * 0.15
        + evidenceQuality * 0.15
        + marketState * 0.1
      )
      const assetIdentityMultiplier = identityResolved ? 1 : 0.3
      const validationMultiplier = validationUsable ? 1 : 0.5
      const dataCompletenessMultiplier = !feature ? 0.2 : evidenceQuality < 55 ? 0.55 : 1
      const tradeabilityMultiplier = 1
      const evidenceAdjustedScore = this.clampScore(
        researchScore
        * assetIdentityMultiplier
        * validationMultiplier
        * dataCompletenessMultiplier
        * tradeabilityMultiplier
      )
      const candidateEvidenceRefs = Array.from(new Set([
        ...(candidate.evidenceRefs || []),
        ...(feature ? [`market-feature-daily:${candidate.symbol}:${feature.tradeDate.toISOString().slice(0, 10)}`] : []),
        ...(asset ? [`asset:${asset.id}`] : []),
        ...(identity?.evidenceRefs || []),
        ...(latestValidation?.evidenceRefs || []),
      ]))
      const dataGapSummary = dataGapSummaryService.build({
        blockedReasons: Array.from(new Set(blockers)),
        assetId: asset?.id || identity?.assetId,
        symbol: candidate.symbol,
        assetName: candidate.name || asset?.name || identity?.name || candidate.symbol,
        assetType: asset?.type || identity?.assetType || 'unknown',
        evidenceRefs: candidateEvidenceRefs,
        lastError: identity?.warnings?.join('；') || undefined,
      })
      const dataSufficient = dataGapSummary.every((gap) => gap.severity !== 'blocking' || !gap.requiredFor.includes('research'))
      const prohibitedActions = deriveProhibitedActions({
        validationEvidencePassed: validationUsable,
        dataSufficient,
      })
      const capabilityState = deriveFivdRCapabilityState({
        summaryStatus: blockers.length > 0 ? 'partial' : 'available',
        blockedReasons: Array.from(new Set(blockers)),
        missingData: dataGapSummary.flatMap((gap) => gap.missingFields),
        prohibitedActions,
        validationEvidencePassed: validationUsable,
        dataGapSummary,
      })
      const disposition = sourceDisposition?.finalDisposition === 'retire_candidate'
        ? 'retire_candidate'
        : !identityResolved || !feature || evidenceQuality < 45
        ? 'needs_more_evidence'
        : validationUsable && sourceDisposition?.finalDisposition === 'eligible_manual_review'
        ? 'manual_review_eligible'
        : blockers.includes('validation_evidence')
        ? 'observe_only'
        : evidenceAdjustedScore >= 70
        ? 'observe_only'
        : 'needs_more_evidence'
      return {
        symbol: candidate.symbol,
        name: candidate.name || asset?.name || identity?.name || candidate.symbol,
        totalScore: Math.round(evidenceAdjustedScore),
        signalScore: Math.round(signalScore),
        researchScore: Math.round(researchScore),
        evidenceAdjustedScore: Math.round(evidenceAdjustedScore),
        rank: 0,
        disposition,
        capabilityState,
        ...buildFivdRCapabilityFlags({
          capabilityState,
          validationEvidencePassed: validationUsable,
          dataSufficient,
        }),
        allowedActions: disposition === 'manual_review_eligible'
          ? ['RESEARCH', 'OBSERVE', 'SNAPSHOT', 'WATCH', 'RISK_ALERT']
          : identityResolved && feature ? ['RESEARCH', 'OBSERVE', 'SNAPSHOT', 'WATCH', 'RISK_ALERT'] : ['RESEARCH'],
        prohibitedActions,
        dimensions: {
          strategy: Math.round(strategyValidation),
          strategyValidation: Math.round(strategyValidation),
          valuation: Math.round(valuation),
          expectedReturn: Math.round(expectedReturn),
          risk: Math.round(risk),
          evidenceQuality: Math.round(evidenceQuality),
          marketState: Math.round(marketState),
        },
        blockers: Array.from(new Set(blockers)),
        dataGapSummary,
        rationale: [
          `策略信号分 ${Math.round(signalScore)}，研究分 ${Math.round(researchScore)}，证据折扣后 ${Math.round(evidenceAdjustedScore)}。`,
          !identityResolved ? '策略信号可能较强，但资产身份未完整确认，不能进入观察或交易动作。' : `资产身份置信度 ${identity?.confidenceScore ?? 1}。`,
          feature
            ? `使用 market_feature_daily:${candidate.symbol}:${feature.tradeDate.toISOString().slice(0, 10)}。`
            : '缺少 market_feature_daily，不能完成技术趋势和预期收益复核。',
          validationUsable
            ? 'validation evidence 当前允许进入人工复核，但仍禁止自动交易。'
            : 'validation evidence 未放行，候选只能用于研究观察。',
        ],
        evidenceRefs: candidateEvidenceRefs,
      }
    })
      .sort((left, right) => right.evidenceAdjustedScore - left.evidenceAdjustedScore || right.signalScore - left.signalScore || left.symbol.localeCompare(right.symbol))
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }))

    return {
      schemaVersion: 'fivd.r.candidate_batch.v1',
      runId,
      generatedAt,
      userId: normalizedUserId,
      source: options.source,
      strategyQuery: options.strategyQuery,
      summary: {
        total: options.candidates.length,
        analyzed: scored.length,
        observable: scored.filter((candidate) => candidate.disposition === 'observe_only').length,
        manualReviewEligible: scored.filter((candidate) => candidate.disposition === 'manual_review_eligible').length,
        retired: scored.filter((candidate) => candidate.disposition === 'retire_candidate').length,
        blocked: scored.filter((candidate) => candidate.disposition === 'blocked' || candidate.capabilityState === 'TRADE_BLOCKED').length,
        dataGaps: dataGapSummaryService.aggregate(scored.flatMap((candidate) => candidate.dataGapSummary)),
      },
      candidates: scored,
    }
  }

  async createFivdRResearchSnapshot(userId: string, input: {
    result: Record<string, any>
    source?: string
    note?: string
  }) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const result = input.result && typeof input.result === 'object' ? input.result : {}
    const runId = String(result.runId || `fivd-r:snapshot:${Date.now()}`)
    const generatedAt = new Date()
    const artifactName = 'fivd_r_research_snapshot.json'
    const payload = {
      schemaVersion: 'fivd.r.research_snapshot.v1',
      generatedAt: generatedAt.toISOString(),
      userId: normalizedUserId,
      source: input.source || 'analysis_page',
      note: input.note || '',
      runId,
      scope: result.scope || 'unknown',
      asset: result.asset || null,
      summary: result.summary || null,
      evidenceGate: result.evidenceGate || null,
      tradingDiscipline: result.tradingDiscipline || null,
      positionAdviceImpact: result.positionAdviceImpact || null,
      strategyValidation: result.strategyValidation || null,
      candidateDisposition: result.candidateDisposition || null,
      evidenceRefs: Array.from(new Set([
        ...(Array.isArray(result.evidenceGate?.evidenceRefs) ? result.evidenceGate.evidenceRefs : []),
        ...(Array.isArray(result.agentTrace?.evidenceRefs) ? result.agentTrace.evidenceRefs : []),
      ])),
    }
    const operation = await prisma.operation.create({
      data: {
        userId: normalizedUserId,
        type: 'fivd_r_research_snapshot',
        status: 'completed',
        requestedAt: generatedAt,
        startedAt: generatedAt,
        completedAt: generatedAt,
        progressPct: 100,
        createdBy: 'user',
        idempotencyKey: `${runId}:${generatedAt.getTime()}`,
        inputJson: JSON.stringify({ runId, source: input.source || 'analysis_page' }),
        resultJson: JSON.stringify({
          ...payload,
          artifacts: { [artifactName]: payload },
          artifactRefs: [],
        }),
        artifactRefsJson: JSON.stringify([]),
      },
    })
    const artifactRefs = [`operation_artifact:${operation.id}:${artifactName}`]
    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        resultJson: JSON.stringify({
          ...payload,
          artifacts: { [artifactName]: payload },
          artifactRefs,
        }),
        artifactRefsJson: JSON.stringify(artifactRefs),
      },
    })
    return {
      ...payload,
      operationId: operation.id,
      artifactRefs,
    }
  }

  async listFivdRResearchSnapshots(userId: string, limit = 20) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const operations = await prisma.operation.findMany({
      where: {
        userId: normalizedUserId,
        type: 'fivd_r_research_snapshot',
        status: { in: ['completed', 'succeeded'] },
      },
      orderBy: { completedAt: 'desc' },
      take: Math.max(1, Math.min(100, Number(limit) || 20)),
    })
    return {
      schemaVersion: 'fivd.r.research_snapshot_list.v1',
      userId: normalizedUserId,
      snapshots: operations.map((operation) => {
        const result = this.parseJson<Record<string, any>>(operation.resultJson, {})
        return {
          operationId: operation.id,
          createdAt: operation.completedAt?.toISOString() || operation.requestedAt.toISOString(),
          runId: result.runId,
          scope: result.scope,
          asset: result.asset,
          summary: result.summary,
          artifactRefs: this.parseJson<string[]>(operation.artifactRefsJson, []),
        }
      }),
    }
  }

  async createFivdRAssetIdentityResolutionReport(userId: string, input: {
    symbols?: string[]
    gaps?: Array<Record<string, any>>
    sourceRunId?: string | null
  } = {}) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const generatedAt = new Date()
    const normalizeSymbol = (value: unknown) => String(value || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
    const requestedSymbols = Array.from(new Set([
      ...(Array.isArray(input.symbols) ? input.symbols : []),
      ...(Array.isArray(input.gaps) ? input.gaps.map((gap) => gap?.symbol) : []),
    ].map(normalizeSymbol).filter(Boolean)))

    const identities = []
    for (const symbol of requestedSymbols) {
      const identity = await researchAssetIdentityService.resolve(symbol)
      identities.push({
        symbol: identity.symbol,
        name: identity.name || null,
        assetId: identity.assetId || null,
        assetType: identity.assetType,
        market: identity.market,
        exchange: identity.exchange || null,
        confidenceScore: identity.confidenceScore,
        resolved: identity.resolved,
        lightweightResearchIdentity: identity.lightweightResearchIdentity,
        matchedAsset: identity.resolution.matchedAsset || null,
        candidates: identity.resolution.candidates,
        evidenceRefs: identity.evidenceRefs,
        evidence: identity.resolution.evidence,
        warnings: identity.warnings,
      })
    }

    const unresolvedCount = identities.filter((identity) => !identity.resolved).length
    const resolvedCount = identities.length - unresolvedCount
    const payload = {
      schemaVersion: 'fivd.r.asset_identity_resolution_report.v1',
      generatedAt: generatedAt.toISOString(),
      userId: normalizedUserId,
      runId: `fivd-r-asset-identity:${normalizedUserId}:${generatedAt.getTime()}`,
      sourceRunId: input.sourceRunId || null,
      requestedSymbols,
      summary: {
        requestedSymbols: requestedSymbols.length,
        resolvedCount,
        unresolvedCount,
        lightweightResearchIdentities: identities.filter((identity) => identity.lightweightResearchIdentity).length,
        matchedOfficialAssets: identities.filter((identity) => identity.assetId).length,
      },
      identities,
      blockedReasons: unresolvedCount > 0 ? ['asset_identity_missing'] : [],
      allowedActions: ['RESEARCH', 'OBSERVE'],
      prohibitedActions: deriveProhibitedActions({
        validationEvidencePassed: false,
        dataSufficient: false,
      }),
      auditOpinion: {
        severity: unresolvedCount > 0 ? 'major' : 'minor',
        conclusion: unresolvedCount > 0
          ? '部分候选仍无法完成资产身份解析，只能作为研究线索，不能进入观察或交易动作。'
          : '候选已生成可审计 research identity；本报告不写入正式资产账本，也不补齐估值/基本面事实集。',
      },
    }

    return this.createFivdRAuditOperation(
      normalizedUserId,
      'fivd_r_asset_identity_resolution',
      payload,
      'asset_identity_resolution_report.json',
      generatedAt
    )
  }

  async createFivdRValidationRetestAudit(userId: string, input: {
    operationId?: string
    candidateLimit?: number
  } = {}) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const source = await this.getFivdRValidationSourceOperation(input.operationId)
    const generatedAt = new Date()
    if (!source) {
      const dataGapSummary = dataGapSummaryService.build({
        blockedReasons: ['validation_evidence'],
        symbol: 'VALIDATION_EVIDENCE',
        assetName: '验证证据',
        assetType: 'unknown',
        evidenceRefs: [],
      })
      const payload = {
        schemaVersion: 'fivd.r.validation_evidence_retest_audit.v1',
        generatedAt: generatedAt.toISOString(),
        userId: normalizedUserId,
        sourceOperationId: null,
        status: 'blocked',
        decision: 'CONTINUE_RESEARCH_ONLY',
        summary: {
          blocker: 'validation_source_missing',
          rankedCandidates: 0,
          passedCandidates: 0,
          failedCandidates: 0,
          insufficientCandidates: 0,
        },
        gates: [{ id: 'validation_evidence', status: 'blocked', reason: '未找到可复验的真实验证产物。' }],
        dataGapSummary,
        dataGapSummaryMeta: dataGapSummaryService.aggregate(dataGapSummary),
        candidateAudits: [],
        requiredNextChecks: ['重新运行全量选股/策略锦标赛，并生成 validation_evidence_matrix.json。'],
        auditOpinion: {
          severity: 'critical',
          conclusion: '缺少真实验证产物，不能进入任何交易草案或人工下单复核。',
        },
      }
      const validationFailureTaxonomy = this.buildFivdRValidationFailureTaxonomy({
        generatedAt,
        sourceOperation: null,
        validationDecision: {},
        matrix: {},
        oosRetest: {},
        disposition: {},
        candidates: [],
        candidateAudits: [],
        gates: payload.gates,
        blocker: 'validation_source_missing',
        usableForTradingAdvice: false,
        existingTaxonomy: null,
      })
      return this.createFivdRAuditOperation(
        normalizedUserId,
        'fivd_r_validation_retest_audit',
        {
          ...payload,
          validationFailureTaxonomy,
        },
        'validation_evidence_retest_report.json',
        generatedAt,
        { 'validation_failure_taxonomy.json': validationFailureTaxonomy }
      )
    }

    const result = this.parseJson<Record<string, any>>(source.resultJson, {})
    const validationDecision = result.validationDecision || result.dataQuality?.validationDecision || {}
    const matrix = result.validationEvidenceMatrix || result.dataQuality?.validationEvidenceMatrix || {}
    const oosRetest = result.oosMultiWindowRegimeRetest || result.dataQuality?.oosMultiWindowRegimeRetest || {}
    const disposition = result.validationCandidateDisposition || result.dataQuality?.validationCandidateDisposition || {}
    const candidates = Array.isArray(matrix.candidates)
      ? matrix.candidates
      : Array.isArray(matrix.rankedCandidates)
      ? matrix.rankedCandidates
      : []
    const candidateLimit = Math.max(1, Math.min(50, Number(input.candidateLimit) || 20))
    const matrixSummary = matrix.summary || {}
    const passedCandidateCount = Number(matrixSummary.passedCandidates || 0)
    const failedCandidateCount = Number(matrixSummary.failedCandidates || 0)
    const insufficientCandidateCount = Number(matrixSummary.insufficientCandidates || 0)
    const passedCandidates = candidates.filter((candidate: any) => candidate.validation?.allPassed === true || candidate.validation?.overall === 'passed' || candidate.overallStatus === 'passed')
    const failedCandidates = candidates.filter((candidate: any) => candidate.validation?.overall === 'failed' || candidate.overallStatus === 'failed' || (Array.isArray(candidate.failedChecks) && candidate.failedChecks.length > 0))
    const insufficientCandidates = candidates.filter((candidate: any) => candidate.validation?.overall === 'insufficient' || candidate.overallStatus === 'insufficient' || (Array.isArray(candidate.blockerTags) && candidate.blockerTags.some((tag: string) => tag.includes('insufficient'))))
    const usableForTradingAdvice = validationDecision.usableForTradingAdvice === true
    const oosFailed = candidates.some((candidate: any) => {
      const status = candidate.validation?.outOfSample || candidate.validation?.checks?.outOfSample?.status || candidate.outOfSample?.status
      return status === 'failed'
    })
    const sensitivityInsufficient = candidates.some((candidate: any) => {
      const status = candidate.validation?.parameterSensitivity || candidate.validation?.checks?.parameterSensitivity?.status || candidate.parameterSensitivity?.status
      return status === 'insufficient' || status === 'failed'
    })
    const windowSummary = oosRetest.summary || {}
    const retestInsufficient = Number(windowSummary.insufficientWindows || 0) > 0
      || Number(windowSummary.insufficientRegimeBuckets || 0) > 0
    const blocker = validationDecision.primaryBlocker
      || matrixSummary.primaryBlocker
      || matrix.primaryBlocker
      || (oosFailed ? 'out_of_sample' : sensitivityInsufficient ? 'parameter_sensitivity' : usableForTradingAdvice ? null : 'validation_evidence')
    const status = usableForTradingAdvice && Math.max(passedCandidateCount, passedCandidates.length) > 0 && !blocker ? 'passed' : 'blocked'
    const candidateAudits = candidates.slice(0, candidateLimit).map((candidate: any, index: number) => {
      const validation = candidate.validation || {}
      const checks = validation.checks || {}
      const failedChecks = Array.isArray(validation.failedChecks)
        ? validation.failedChecks
        : Array.isArray(candidate.failedChecks)
        ? candidate.failedChecks
        : Object.entries(checks).filter(([, value]: any) => value?.status === 'failed').map(([key]) => key)
      const blockerTags = Array.isArray(validation.blockerTags)
        ? validation.blockerTags
        : Array.isArray(candidate.blockerTags)
        ? candidate.blockerTags
        : []
      const overall = validation.allPassed === true
        ? 'passed'
        : failedChecks.length > 0
        ? 'failed'
        : validation.overall || candidate.overallStatus || 'insufficient'
      return {
        rank: candidate.rank || index + 1,
        name: candidate.name || candidate.symbol || `candidate_${index + 1}`,
        strategyId: candidate.strategyId || null,
        validationStatus: overall,
        failedChecks,
        blockerTags,
        outOfSample: checks.outOfSample || validation.outOfSample || candidate.oos || candidate.outOfSample || null,
        parameterSensitivity: checks.parameterSensitivity || validation.parameterSensitivity || candidate.parameterSensitivity || null,
        walkForward: checks.walkForward || validation.walkForward || candidate.walkForward || null,
        groupStability: checks.groupStability || validation.groupStability || candidate.groupStability || null,
        nextAction: overall === 'passed' ? 'eligible_for_manual_review_after_global_gate' : 'continue_research_or_retire',
        auditOpinion: overall === 'passed'
          ? '候选自身通过，但仍受全局交易证据门禁约束。'
          : '候选未通过复验，不能作为交易动作依据。',
      }
    })
    const gates = [
      {
        id: 'full_a_strategy_evidence',
        status: candidates.length > 0 ? 'pass' : 'blocked',
        reason: candidates.length > 0 ? `读取到 ${candidates.length} 个候选验证记录。` : '未读取到候选验证记录。',
      },
      {
        id: 'validation_evidence',
        status: usableForTradingAdvice ? 'pass' : 'blocked',
        reason: usableForTradingAdvice ? 'validationDecision 已允许人工复核。' : `validationDecision 未放行：${blocker || 'validation_evidence'}。`,
      },
      {
        id: 'out_of_sample',
        status: oosFailed ? 'blocked' : candidates.length > 0 ? 'pass' : 'insufficient',
        reason: oosFailed ? '存在 OOS 失败候选。' : '未发现候选级 OOS 失败。',
      },
      {
        id: 'parameter_sensitivity',
        status: sensitivityInsufficient ? 'blocked' : candidates.length > 0 ? 'pass' : 'insufficient',
        reason: sensitivityInsufficient ? '参数敏感性存在失败或样本不足。' : '参数敏感性未发现阻断。',
      },
      {
        id: 'market_regime_retest',
        status: retestInsufficient ? 'blocked' : oosRetest.status === 'passed' ? 'pass' : 'insufficient',
        reason: retestInsufficient ? '多窗口/市场状态复验仍有样本不足。' : `复验状态：${oosRetest.status || 'unknown'}。`,
      },
      {
        id: 'candidate_disposition',
        status: disposition.status === 'ready_for_manual_review' ? 'pass' : 'blocked',
        reason: disposition.status ? `候选处置状态：${disposition.status}。` : '缺少候选处置报告。',
      },
    ]
    const requiredNextChecks = Array.from(new Set([
      ...(Array.isArray(validationDecision.blockedReasons) ? validationDecision.blockedReasons : []),
      ...(blocker ? [blocker] : []),
      ...(oosFailed ? ['扩展 OOS 时间窗并确认超额收益不再衰减。'] : []),
      ...(sensitivityInsufficient ? ['补足参数敏感性样本并复验。'] : []),
      ...(retestInsufficient ? ['补足市场状态桶样本，重跑多窗口 regime retest。'] : []),
    ]))
    const validationBlockedReasons = Array.from(new Set([
      ...(usableForTradingAdvice ? [] : ['validation_evidence']),
      ...(retestInsufficient ? ['market_regime_retest_insufficient'] : []),
      ...(blocker && blocker !== 'validation_evidence' ? [blocker] : []),
    ]))
    const dataGapSummary = dataGapSummaryService.build({
      blockedReasons: validationBlockedReasons,
      symbol: 'VALIDATION_EVIDENCE',
      assetName: '验证证据',
      assetType: 'unknown',
      evidenceRefs: [
        `operation:${source.id}`,
        'validation_evidence_matrix.json',
        'oos_multi_window_regime_retest.json',
      ],
    })
    const payload = {
      schemaVersion: 'fivd.r.validation_evidence_retest_audit.v1',
      generatedAt: generatedAt.toISOString(),
      userId: normalizedUserId,
      sourceOperationId: source.id,
      sourceOperationType: source.type,
      status,
      decision: status === 'passed' ? 'READY_FOR_MANUAL_TRADE_DRAFT' : 'CONTINUE_RESEARCH_ONLY',
      summary: {
        blocker,
        usableForTradingAdvice,
        rankedCandidates: candidates.length,
        diagnosedCandidates: candidateAudits.length,
        passedCandidates: Math.max(passedCandidateCount, passedCandidates.length),
        failedCandidates: Math.max(failedCandidateCount, failedCandidates.length),
        insufficientCandidates: Math.max(insufficientCandidateCount, insufficientCandidates.length),
        oosWindowSummary: windowSummary,
      },
      gates,
      dataGapSummary,
      dataGapSummaryMeta: dataGapSummaryService.aggregate(dataGapSummary),
      candidateAudits,
      requiredNextChecks,
      auditOpinion: {
        severity: status === 'passed' ? 'minor' : 'major',
        conclusion: status === 'passed'
          ? '复验证据满足进入人工交易草案门槛，但仍禁止自动交易。'
          : '复验证据未通过，FIVD-R 只能用于研究、观察和风险提醒。',
      },
    }
    const artifacts = result.artifacts && typeof result.artifacts === 'object' ? result.artifacts as Record<string, any> : {}
    const validationFailureTaxonomy = this.buildFivdRValidationFailureTaxonomy({
      generatedAt,
      sourceOperation: source,
      validationDecision,
      matrix,
      oosRetest,
      disposition,
      candidates,
      candidateAudits,
      gates,
      blocker,
      usableForTradingAdvice,
      existingTaxonomy: artifacts['validation_failure_taxonomy.json'] || result.validationFailureTaxonomy || result.dataQuality?.validationFailureTaxonomy || null,
    })
    return this.createFivdRAuditOperation(
      normalizedUserId,
      'fivd_r_validation_retest_audit',
      {
        ...payload,
        validationFailureTaxonomy,
      },
      'validation_evidence_retest_report.json',
      generatedAt,
      { 'validation_failure_taxonomy.json': validationFailureTaxonomy }
    )
  }

  async getLatestFivdRValidationReport(userId: string) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const latestAudit = await prisma.operation.findFirst({
      where: {
        userId: normalizedUserId,
        type: 'fivd_r_validation_retest_audit',
        status: { in: ['completed', 'succeeded'] },
      },
      orderBy: [
        { completedAt: 'desc' },
        { requestedAt: 'desc' },
      ],
    })
    if (latestAudit) {
      const auditResult = this.parseJson<Record<string, any>>(latestAudit.resultJson, {})
      const artifacts = auditResult.artifacts && typeof auditResult.artifacts === 'object' ? auditResult.artifacts as Record<string, any> : {}
      const report = artifacts['validation_failure_taxonomy.json'] || auditResult.validationFailureTaxonomy
      if (report) {
        return {
          ...report,
          operationId: latestAudit.id,
          artifactRefs: this.parseJson<string[]>(latestAudit.artifactRefsJson, []),
        }
      }
    }

    const source = await this.getFivdRValidationSourceOperation()
    if (!source) {
      return this.buildFivdRValidationFailureTaxonomy({
        generatedAt: new Date(),
        sourceOperation: null,
        validationDecision: {},
        matrix: {},
        oosRetest: {},
        disposition: {},
        candidates: [],
        candidateAudits: [],
        gates: [{ id: 'validation_evidence', status: 'blocked', reason: '未找到可审计的验证证据源。' }],
        blocker: 'validation_source_missing',
        usableForTradingAdvice: false,
        existingTaxonomy: null,
      })
    }

    const result = this.parseJson<Record<string, any>>(source.resultJson, {})
    const validationDecision = result.validationDecision || result.dataQuality?.validationDecision || {}
    const matrix = result.validationEvidenceMatrix || result.dataQuality?.validationEvidenceMatrix || {}
    const oosRetest = result.oosMultiWindowRegimeRetest || result.dataQuality?.oosMultiWindowRegimeRetest || {}
    const disposition = result.validationCandidateDisposition || result.dataQuality?.validationCandidateDisposition || {}
    const artifacts = result.artifacts && typeof result.artifacts === 'object' ? result.artifacts as Record<string, any> : {}
    const candidates = Array.isArray(matrix.candidates)
      ? matrix.candidates
      : Array.isArray(matrix.rankedCandidates)
      ? matrix.rankedCandidates
      : []
    const usableForTradingAdvice = validationDecision.usableForTradingAdvice === true
    return this.buildFivdRValidationFailureTaxonomy({
      generatedAt: new Date(),
      sourceOperation: source,
      validationDecision,
      matrix,
      oosRetest,
      disposition,
      candidates,
      candidateAudits: [],
      gates: [],
      blocker: validationDecision.primaryBlocker || matrix.summary?.primaryBlocker || matrix.primaryBlocker || (usableForTradingAdvice ? null : 'validation_evidence'),
      usableForTradingAdvice,
      existingTaxonomy: artifacts['validation_failure_taxonomy.json'] || result.validationFailureTaxonomy || result.dataQuality?.validationFailureTaxonomy || null,
    })
  }

  async createFivdRInfrastructureAudit(userId: string) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const generatedAt = new Date()
    const postgresShadowPromise = (stockScreenerService as any).buildPostgresShadowReadinessReport?.()
    const postgresShadow = postgresShadowPromise ? await postgresShadowPromise.catch(() => null) : null
    const coverageSnapshot = await securityStatusService.getCoverageSnapshot(['000001', '600000']).catch(() => null)
    const staleRunning = await prisma.operation.count({
      where: {
        status: 'running',
        leaseExpiresAt: { lt: generatedAt },
      },
    })
    const recentFailures = await prisma.operation.count({
      where: {
        status: 'failed',
        requestedAt: { gte: new Date(generatedAt.getTime() - 24 * 60 * 60 * 1000) },
      },
    })
    const dbUrl = process.env.DATABASE_URL || ''
    const primaryDatabase = dbUrl.startsWith('postgres') ? 'postgresql' : dbUrl.startsWith('file:') ? 'sqlite' : 'unknown'
    const gates = [
      {
        id: 'primary_database',
        status: primaryDatabase === 'postgresql' ? 'pass' : 'blocked',
        reason: primaryDatabase === 'postgresql' ? '主库已使用 PostgreSQL。' : `当前主库为 ${primaryDatabase}，生产版仍需迁移 PostgreSQL。`,
      },
      {
        id: 'postgres_shadow',
        status: postgresShadow?.status === 'ready' ? 'pass' : 'blocked',
        reason: postgresShadow?.status === 'ready' ? 'PostgreSQL shadow readiness 为 ready。' : 'PostgreSQL shadow readiness 未通过或不可用。',
      },
      {
        id: 'worker_recovery',
        status: staleRunning === 0 ? 'pass' : 'blocked',
        reason: staleRunning === 0 ? '未发现过期 running lease。' : `存在 ${staleRunning} 个过期 running operation。`,
      },
      {
        id: 'recent_operation_failures',
        status: recentFailures === 0 ? 'pass' : 'warning',
        reason: recentFailures === 0 ? '最近 24 小时未发现失败 operation。' : `最近 24 小时有 ${recentFailures} 个失败 operation。`,
      },
      {
        id: 'security_status_coverage',
        status: coverageSnapshot ? 'pass' : 'warning',
        reason: coverageSnapshot ? '可生成 security status coverage snapshot。' : 'security status coverage snapshot 不可用。',
      },
    ]
    const fatalOrMajor = gates.filter((gate) => gate.status === 'blocked')
    const payload = {
      schemaVersion: 'fivd.r.infrastructure_audit.v1',
      generatedAt: generatedAt.toISOString(),
      userId: normalizedUserId,
      status: fatalOrMajor.length === 0 ? 'passed' : 'blocked',
      gates,
      postgresShadow,
      coverageSnapshot,
      operationHealth: {
        staleRunning,
        recentFailures,
      },
      auditOpinion: {
        severity: fatalOrMajor.length === 0 ? 'minor' : 'major',
        conclusion: fatalOrMajor.length === 0
          ? '基础设施审计未发现生产阻断项。'
          : '基础设施仍存在生产阻断项，不能宣称生产完成。',
      },
    }
    return this.createFivdRAuditOperation(normalizedUserId, 'fivd_r_infrastructure_audit', payload, 'fivd_r_infrastructure_audit.json', generatedAt)
  }

  private buildFivdRValidationFailureTaxonomy(params: {
    generatedAt: Date
    sourceOperation: { id: string; type: string } | null
    validationDecision: Record<string, any>
    matrix: Record<string, any>
    oosRetest: Record<string, any>
    disposition: Record<string, any>
    candidates: any[]
    candidateAudits: any[]
    gates: Array<Record<string, any>>
    blocker: string | null
    usableForTradingAdvice: boolean
    existingTaxonomy: Record<string, any> | null
  }) {
    const matrixSummary = params.matrix?.summary || {}
    const retestSummary = params.oosRetest?.summary || {}
    const existingSummary = params.existingTaxonomy?.summary || {}
    const passedCandidates = Number(matrixSummary.passedCandidates ?? existingSummary.passedCandidates ?? 0)
    const failedCandidates = Number(matrixSummary.failedCandidates ?? existingSummary.failedCandidates ?? 0)
    const insufficientCandidates = Number(matrixSummary.insufficientCandidates ?? 0)
    const diagnosedCandidates = Math.max(
      params.candidates.length,
      params.candidateAudits.length,
      Number(existingSummary.diagnosedCandidates || 0),
      passedCandidates + failedCandidates + insufficientCandidates
    )
    const failedWindows = Number(retestSummary.failedWindows || 0)
    const insufficientWindows = Number(retestSummary.insufficientWindows || 0)
    const insufficientRegimeBuckets = Number(retestSummary.insufficientRegimeBuckets || 0)
    const blockedGateIds = new Set<string>()
    for (const gate of params.gates || []) {
      if (['blocked', 'failed'].includes(String(gate.status))) blockedGateIds.add(String(gate.id))
    }
    for (const reason of params.validationDecision?.blockedReasons || []) blockedGateIds.add(String(reason))
    if (params.blocker) blockedGateIds.add(params.blocker)
    if (!params.usableForTradingAdvice) blockedGateIds.add('validation_evidence')
    if (failedCandidates > 0 || failedWindows > 0 || blockedGateIds.has('out_of_sample')) blockedGateIds.add('out_of_sample')
    if (blockedGateIds.has('parameter_sensitivity')) blockedGateIds.add('parameter_sensitivity')
    if (insufficientWindows > 0 || insufficientRegimeBuckets > 0 || blockedGateIds.has('market_regime_retest')) blockedGateIds.add('market_regime')
    if (insufficientCandidates > 0 || diagnosedCandidates === 0) blockedGateIds.add('sample_size')
    if (params.disposition?.status && params.disposition.status !== 'ready_for_manual_review') blockedGateIds.add('candidate_quality')
    const existingClasses = Array.isArray(params.existingTaxonomy?.failureClasses) ? params.existingTaxonomy.failureClasses : []
    for (const item of existingClasses) {
      if (typeof item?.id === 'string') blockedGateIds.add(item.id)
    }

    const evidenceBase = [
      ...(params.sourceOperation ? [`operation:${params.sourceOperation.id}`] : []),
      'validation_evidence_matrix.json',
      'out_of_sample_validation.json',
      'walk_forward_validation.json',
      'parameter_sensitivity.json',
      'oos_multi_window_regime_retest.json',
      'validation_candidate_disposition.json',
      'strategy_failure_matrix.json',
      'strategy_remediation_report.json',
    ]
    const categoryMap: Record<string, {
      category: string
      severity: 'critical' | 'major' | 'minor'
      explanation: string
      nextAction: string
    }> = {
      validation_evidence: {
        category: 'validation_evidence',
        severity: 'critical',
        explanation: '全局 validation evidence 未放行，研究结果不能转换为 ADD / REDUCE 或人工交易草案。',
        nextAction: '继续复跑并审计样本外、walk-forward、参数敏感性和分组稳定性，直到同一候选组合全部通过。',
      },
      out_of_sample: {
        category: 'out_of_sample',
        severity: 'critical',
        explanation: '样本外验证失败或收益衰减，策略信号不能证明在未见样本中稳定有效。',
        nextAction: '扩展 OOS 时间窗，比较训练窗口与样本外均值、中位数、胜率和尾部亏损。',
      },
      parameter_sensitivity: {
        category: 'parameter_sensitivity',
        severity: 'critical',
        explanation: '参数扰动后结论不稳或样本不足，存在调参过拟合风险。',
        nextAction: '冻结策略定义，重跑参数网格稳定性，不通过调参追逐单次通过。',
      },
      market_regime: {
        category: 'market_regime',
        severity: 'major',
        explanation: '多窗口或市场状态桶复验样本不足，当前市场状态泛化能力未被证明。',
        nextAction: '按市场状态、日期桶、行业、市值和流动性分层补样本并复验。',
      },
      sample_size: {
        category: 'sample_size',
        severity: 'major',
        explanation: '候选或分层验证样本不足，统计置信度不够。',
        nextAction: '扩大回测窗口、候选池和分层样本，保持研究观察。',
      },
      candidate_quality: {
        category: 'candidate_quality',
        severity: 'major',
        explanation: '候选处置未达到 ready_for_manual_review，候选组合仍需研究或退役。',
        nextAction: '复核候选处置、失败标签和证据引用，淘汰不可复现候选。',
      },
      validation_gate_blocked: {
        category: 'validation_evidence',
        severity: 'critical',
        explanation: '历史 screener taxonomy 显示验证 gate 未通过。',
        nextAction: '保持 OBSERVE_ONLY，不得输出交易动作。',
      },
      market_regime_shift: {
        category: 'market_regime',
        severity: 'major',
        explanation: '历史 OOS taxonomy 标记市场状态切换。',
        nextAction: '新增 regime 分层 OOS，不用整体样本覆盖状态切换风险。',
      },
      layered_oos_blocked: {
        category: 'market_regime',
        severity: 'major',
        explanation: '历史分层 OOS 复验仍有阻断。',
        nextAction: '按分层桶逐项补齐验证样本。',
      },
      oos_return_decay: {
        category: 'out_of_sample',
        severity: 'critical',
        explanation: '历史 taxonomy 标记样本外收益衰减。',
        nextAction: '复核训练/样本外分布差异和极端亏损。',
      },
      sample_insufficient: {
        category: 'sample_size',
        severity: 'major',
        explanation: '历史 taxonomy 标记样本不足。',
        nextAction: '扩大样本，不得提升可信度。',
      },
    }
    const rawFailureCategories = Array.from(blockedGateIds)
      .map((id) => categoryMap[id] ? {
        category: categoryMap[id].category,
        severity: categoryMap[id].severity,
        affectedStrategies: params.candidates.slice(0, 10).map((candidate) => candidate.strategyId || candidate.candidateId || candidate.symbol || candidate.name).filter(Boolean),
        affectedCandidates: params.candidates.slice(0, 10).map((candidate, index) => candidate.candidateId || candidate.symbol || candidate.name || `candidate_${index + 1}`),
        evidenceRefs: evidenceBase,
        explanation: categoryMap[id].explanation,
        nextAction: categoryMap[id].nextAction,
      } : null)
      .filter(Boolean)
    const severityRank = { critical: 3, major: 2, minor: 1 } as Record<string, number>
    const failureCategories = Object.values(rawFailureCategories.reduce((acc: Record<string, any>, item: any) => {
      const current = acc[item.category]
      if (!current) {
        acc[item.category] = { ...item }
        return acc
      }
      acc[item.category] = {
        ...current,
        severity: severityRank[item.severity] > severityRank[current.severity] ? item.severity : current.severity,
        affectedStrategies: Array.from(new Set([...current.affectedStrategies, ...item.affectedStrategies])),
        affectedCandidates: Array.from(new Set([...current.affectedCandidates, ...item.affectedCandidates])),
        evidenceRefs: Array.from(new Set([...current.evidenceRefs, ...item.evidenceRefs])),
        explanation: `${current.explanation} ${item.explanation}`.trim(),
        nextAction: Array.from(new Set([current.nextAction, item.nextAction])).join('；'),
      }
      return acc
    }, {}))
    if (failureCategories.length === 0) {
      failureCategories.push({
        category: 'data_quality',
        severity: 'major',
        affectedStrategies: [],
        affectedCandidates: [],
        evidenceRefs: evidenceBase,
        explanation: '未找到可解释 validation evidence 的足够 artifact。',
        nextAction: '重新运行全量策略锦标赛并生成完整 validation artifact。',
      })
    }

    const recommendation = params.usableForTradingAdvice
      ? 'narrow_strategy_scope'
      : failureCategories.some((item: any) => item.category === 'out_of_sample')
      ? 'requires_new_strategy_family'
      : failureCategories.some((item: any) => item.category === 'market_regime')
      ? 'retest_with_longer_window'
      : failureCategories.some((item: any) => item.category === 'candidate_quality')
      ? 'retire_strategy'
      : 'keep_research_only'

    return {
      schemaVersion: 'fivd.r.validation_failure_taxonomy.v1',
      generatedAt: params.generatedAt.toISOString(),
      runId: `fivd-r-validation-taxonomy:${params.generatedAt.getTime()}`,
      sourceOperationId: params.sourceOperation?.id || null,
      sourceOperationType: params.sourceOperation?.type || null,
      status: params.usableForTradingAdvice ? 'ready_for_manual_review' : 'blocked_for_trading',
      summary: {
        passedCandidates,
        failedCandidates,
        insufficientCandidates,
        diagnosedCandidates,
        tradeActionAllowed: false,
        manualTradeDraftAllowed: false,
        autoTradeAllowed: false,
        blocker: params.blocker || (params.usableForTradingAdvice ? null : 'validation_evidence'),
        oosWindows: Number(retestSummary.windows || 0),
        failedWindows,
        insufficientWindows,
        regimeBuckets: Number(retestSummary.regimeBuckets || 0),
        insufficientRegimeBuckets,
      },
      failureCategories,
      recommendation,
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      allowedActions: ['RESEARCH', 'OBSERVE', 'SNAPSHOT', 'WATCH', 'RISK_ALERT'],
      evidenceRefs: evidenceBase,
      nextActions: Array.from(new Set(failureCategories.map((item: any) => item.nextAction))),
      auditOpinion: {
        severity: params.usableForTradingAdvice ? 'major' : 'critical',
        conclusion: params.usableForTradingAdvice
          ? '验证证据可能接近人工复核，但 AUTO_TRADE 仍禁止，正式动作仍需独立人工流程。'
          : 'validation evidence 未通过，FIVD-R 必须保持研究/观察模式。',
      },
    }
  }

  async createFivdRManualTradeDraft(userId: string, input: {
    result?: Record<string, any>
    requestedActions?: Array<Record<string, any>>
  } = {}) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const generatedAt = new Date()
    const latestValidation = await this.getLatestFivdRValidationEvidence()
    const allowed = latestValidation?.validationDecision?.usableForTradingAdvice === true
      && latestValidation?.candidateDisposition?.status === 'ready_for_manual_review'
    const blockedReasons = allowed ? [] : ['validation_evidence']
    const dataGapSummary = dataGapSummaryService.build({
      blockedReasons,
      symbol: 'MANUAL_TRADE_DRAFT',
      assetName: '人工交易草案',
      assetType: 'unknown',
      evidenceRefs: latestValidation?.evidenceRefs || [],
    })
    const prohibitedActions = deriveProhibitedActions({
      validationEvidencePassed: allowed,
      dataSufficient: allowed,
    })
    const capabilityState = deriveFivdRCapabilityState({
      summaryStatus: allowed ? 'available' : 'blocked',
      blockedReasons,
      missingData: dataGapSummary.flatMap((gap) => gap.missingFields),
      prohibitedActions,
      validationEvidencePassed: allowed,
      dataGapSummary,
    })
    const payload = {
      schemaVersion: 'fivd.r.manual_trade_draft.v1',
      generatedAt: generatedAt.toISOString(),
      userId: normalizedUserId,
      status: allowed ? 'manual_review_required' : 'blocked',
      ready: allowed,
      capabilityState,
      ...buildFivdRCapabilityFlags({
        capabilityState,
        validationEvidencePassed: allowed,
        dataSufficient: allowed,
      }),
      sourceRunId: input.result?.runId || null,
      requestedActions: Array.isArray(input.requestedActions) ? input.requestedActions : [],
      blockedReasons,
      dataGapSummary,
      dataGapSummaryMeta: dataGapSummaryService.aggregate(dataGapSummary),
      prohibitedActions,
      draft: allowed ? {
        actions: [],
        guardrails: ['人工确认仓位、价格、止损、资金占用后才能记录交易。'],
        prohibitedActions: ['AUTO_TRADE'],
      } : null,
      validationRef: latestValidation ? {
        operationId: latestValidation.operationId,
        evidenceRefs: latestValidation.evidenceRefs,
      } : null,
      auditOpinion: {
        severity: allowed ? 'minor' : 'major',
        conclusion: allowed
          ? '可创建人工复核草案，但不会自动下单或自动记录交易。'
          : '证据门禁未通过，拒绝创建交易草案。',
      },
    }
    return this.createFivdRAuditOperation(normalizedUserId, 'fivd_r_manual_trade_draft', payload, 'fivd_r_manual_trade_draft.json', generatedAt)
  }

  private async findFivdRPosition(userId: string, options: { positionId?: string; symbol?: string }) {
    if (options.positionId) {
      return prisma.position.findFirst({
        where: { id: options.positionId, userId, status: 'open' },
        include: { asset: true },
      })
    }
    const symbol = (options.symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
    if (!symbol) return null
    return prisma.position.findFirst({
      where: {
        userId,
        status: 'open',
        asset: {
          symbol: { in: [symbol, `${symbol}.SH`, `${symbol}.SZ`, `${symbol}.BJ`] },
        },
      },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    })
  }

  private normalizeCandidateSymbol(symbol: string) {
    return String(symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
  }

  private safeScore(value: unknown, fallback: number) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }

  private clampScore(value: number) {
    return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  }

  private buildFivdRTradingDiscipline(params: {
    position: any
    advice: any
    valuation: any
    expectedReturn: any
    blockedReasons: string[]
    formalTradeActionAllowed: boolean
    generatedAt: string
  }) {
    const { position, advice, valuation, expectedReturn, blockedReasons, formalTradeActionAllowed, generatedAt } = params
    const validFrom = generatedAt
    const validUntilDate = new Date(generatedAt)
    validUntilDate.setDate(validUntilDate.getDate() + 14)
    const action = advice?.advice?.action || (position.asset.type === 'cash' ? 'NO_ACTION' : 'OBSERVE')
    const confidence = advice?.advice?.confidence || 'insufficient'
    const targetWeightRange = advice?.advice?.targetWeightRange || [0, 0]
    const currentWeight = advice?.advice?.currentWeight ?? null
    const targetWeightMultiplier = valuation?.valuation?.targetWeightMultiplier ?? 1
    const validationBlocked = blockedReasons.includes('validation_evidence')
    const expectedReturnAvailable = expectedReturn?.status === 'available'
    const bucket = this.resolveFivdRDisciplineBucket(position, currentWeight, confidence)
    const disciplineType = position.asset.type === 'cash'
      ? 'no_action'
      : validationBlocked || confidence === 'insufficient'
        ? 'hold_review'
        : action === 'REDUCE'
          ? 'risk_control'
          : 'rebalance_watch'

    if (position.asset.type === 'cash') {
      return {
        schemaVersion: 'fivd.r.trading_discipline.v2',
        action: 'NO_ACTION',
        confidence: 'insufficient',
        bucket: 'cash',
        disciplineType: 'no_action',
        validFrom,
        validUntil: validUntilDate.toISOString(),
        reviewCadence: 'monthly',
        currentWeight,
        targetWeightRange: [0, 0],
        maxAllowedWeight: null,
        targetWeightMultiplier: 0,
        formalTradeActionAllowed: false,
        addConditions: [],
        reduceConditions: [],
        stopConditions: [],
        takeProfitConditions: [],
        invalidationConditions: ['现金类资产不生成买卖纪律。'],
        blockedReasons: Array.from(new Set([...blockedReasons, 'cash_no_trade_discipline'])),
      }
    }

    const maxAllowedWeight = bucket === 'core' ? 0.18 : bucket === 'satellite' ? 0.08 : 0.03
    const commonGateConditions = [
      'evidenceGate.status 必须为 pass。',
      'validationDecision.usableForTradingAdvice 必须为 true。',
      'candidateDisposition.status 必须为 ready_for_manual_review。',
      '人工确认完成前不得进入正式交易计划。',
    ]
    const addConditions = formalTradeActionAllowed ? [
      '目标仓位上沿高于当前仓位至少 2%。',
      'expectedReturn 20d 或 60d 为 available 且 p50 非负。',
      '仓位增加后不超过 maxAllowedWeight。',
      ...commonGateConditions,
    ] : []
    const reduceConditions = [
      '当前仓位超过目标仓位上沿或 maxAllowedWeight。',
      '估值/质量/风险评分降级导致 targetWeightMultiplier 下调。',
      'validation_evidence 未通过时只能作为人工复核观察条件，不得自动减仓。',
    ]
    const stopConditions = bucket === 'satellite' || bucket === 'watchlist'
      ? [
        '跌破持仓级失效条件或 positionAdvice invalidationConditions。',
        'expectedReturn 60d available 且 p25 显著为负时进入人工复核。',
        '出现停牌、退市风险、重大 provider 冲突时进入风险复核。',
      ]
      : [
        '核心仓基本面或资产身份事实发生重大冲突。',
        '连续复核周期内 evidenceGate 无法恢复到 pass。',
      ]
    const takeProfitConditions = bucket === 'satellite'
      ? [
        '达到人工设定止盈阈值或目标仓位上限。',
        '短期收益显著超过 expectedReturn p75 后进入人工复核。',
      ]
      : [
        '超过目标权重上限时做再平衡复核，不自动止盈。',
      ]
    const invalidationConditions = Array.from(new Set([
      ...(advice?.advice?.invalidationConditions || []),
      ...(!expectedReturnAvailable ? ['expectedReturn 样本不足，不能作为加仓依据。'] : []),
      ...blockedReasons.map((reason) => `阻断：${reason}`),
    ]))

    return {
      schemaVersion: 'fivd.r.trading_discipline.v2',
      action,
      confidence,
      bucket,
      disciplineType,
      validFrom,
      validUntil: validUntilDate.toISOString(),
      reviewCadence: bucket === 'core' ? 'biweekly' : 'weekly',
      currentWeight,
      targetWeightRange,
      maxAllowedWeight,
      targetWeightMultiplier,
      formalTradeActionAllowed,
      addConditions,
      reduceConditions,
      stopConditions,
      takeProfitConditions,
      invalidationConditions,
      blockedReasons,
    }
  }

  private resolveFivdRDisciplineBucket(position: any, currentWeight: number | null, confidence: string) {
    if (position.asset.type === 'cash') return 'cash'
    if (confidence === 'insufficient') return 'watchlist'
    if (typeof currentWeight === 'number' && currentWeight >= 0.08) return 'core'
    if (['stock', 'fund', 'etf', 'bond', 'gold'].includes(position.asset.type)) return 'satellite'
    return 'unknown'
  }

  private async buildFivdRExpectedReturn(position: any) {
    const reviewDate = new Date().toISOString().slice(0, 10)
    if (position.asset.type === 'cash') {
      return {
        schemaVersion: 'fivd.r.expected_return.distribution.v1',
        status: 'insufficient',
        method: 'historical_holding_period_return_distribution',
        reviewDate,
        maxObservedTradeDate: null,
        source: 'not_applicable_for_cash',
        windows: {},
        distribution: null,
        confidence: 'insufficient',
        sampleSize: 0,
        evidenceRefs: [],
        blockedReasons: ['cash_expected_return_not_applicable'],
      }
    }

    const history = await this.getExpectedReturnHistory(position, reviewDate)
    const maxObservedTradeDate = history.length > 0 ? history[history.length - 1].date : null
    const evidenceRefs = Array.from(new Set(history.flatMap((item) => item.evidenceRefs)))
    const windows = {
      '20d': this.calculateReturnDistribution(history, 20),
      '60d': this.calculateReturnDistribution(history, 60),
    }
    const availableWindows = Object.values(windows).filter((window) => window.status === 'available')
    const blockedReasons = Array.from(new Set([
      ...(history.length === 0 ? ['historical_price_missing'] : []),
      ...Object.entries(windows)
        .filter(([, window]) => window.status !== 'available')
        .map(([window]) => `${window}_sample_insufficient`),
    ]))

    return {
      schemaVersion: 'fivd.r.expected_return.distribution.v1',
      status: availableWindows.length > 0 ? 'available' : 'insufficient',
      method: 'historical_holding_period_return_distribution',
      reviewDate,
      maxObservedTradeDate,
      source: 'local_canonical_market_bar_or_price_history',
      windows,
      distribution: availableWindows[0]?.distribution || null,
      confidence: availableWindows.length >= 2
        ? 'medium'
        : availableWindows.length === 1
          ? 'low'
          : 'insufficient',
      sampleSize: Math.max(0, ...Object.values(windows).map((window) => window.sampleSize)),
      evidenceRefs,
      blockedReasons,
    }
  }

  private async getExpectedReturnHistory(position: any, reviewDate: string) {
    const byDate = new Map<string, { date: string; close: number; evidenceRefs: string[] }>()
    const addPoint = (date: string, close: number, evidenceRef: string) => {
      if (!date || date > reviewDate || !Number.isFinite(close) || close <= 0) return
      const current = byDate.get(date)
      if (current) {
        current.evidenceRefs = Array.from(new Set([...current.evidenceRefs, evidenceRef]))
        return
      }
      byDate.set(date, { date, close, evidenceRefs: [evidenceRef] })
    }

    try {
      const cached = await marketBarCacheService.getCachedHistory(position.asset.symbol, 180, { market: 'CN' })
      for (const item of cached.history) {
        addPoint(item.date, item.close, `market-bar-canonical:${position.asset.symbol}:${item.date}`)
      }
    } catch {
      // Cache misses are represented by insufficient evidence, not by synthetic returns.
    }

    const startDate = new Date(`${reviewDate}T00:00:00.000Z`)
    startDate.setDate(startDate.getDate() - 260)
    const priceRows = await prisma.priceHistory.findMany({
      where: {
        assetId: position.assetId,
        timestamp: {
          gte: startDate,
          lte: new Date(`${reviewDate}T23:59:59.999Z`),
        },
        isValid: true,
      },
      orderBy: { timestamp: 'asc' },
      take: 260,
    })
    for (const item of priceRows) {
      addPoint(item.timestamp.toISOString().slice(0, 10), item.closePrice, `price-history:${position.assetId}:${item.timestamp.toISOString().slice(0, 10)}`)
    }

    return Array.from(byDate.values()).sort((a, b) => a.date.localeCompare(b.date))
  }

  private calculateReturnDistribution(
    history: Array<{ date: string; close: number; evidenceRefs: string[] }>,
    horizonDays: number
  ) {
    const returns: number[] = []
    for (let index = horizonDays; index < history.length; index += 1) {
      const previous = history[index - horizonDays]
      const current = history[index]
      if (!previous?.close || !current?.close || previous.close <= 0) continue
      returns.push((current.close - previous.close) / previous.close)
    }
    if (returns.length < Math.max(10, Math.floor(horizonDays / 2))) {
      return {
        status: 'insufficient',
        horizonDays,
        sampleSize: returns.length,
        confidence: 'insufficient',
        distribution: null,
        probabilityUp: null,
        probabilityDown: null,
        maxDrawdown: this.calculateMaxDrawdown(history.map((item) => item.close)),
        blockedReasons: ['return_sample_insufficient'],
      }
    }

    const sorted = [...returns].sort((a, b) => a - b)
    const quantile = (q: number) => {
      const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * q)))
      return Number(sorted[index].toFixed(6))
    }
    const probabilityUp = returns.filter((value) => value > 0).length / returns.length
    const probabilityDown = returns.filter((value) => value < 0).length / returns.length
    return {
      status: 'available',
      horizonDays,
      sampleSize: returns.length,
      confidence: returns.length >= 80 ? 'medium' : 'low',
      distribution: {
        p05: quantile(0.05),
        p25: quantile(0.25),
        p50: quantile(0.5),
        p75: quantile(0.75),
        p95: quantile(0.95),
      },
      probabilityUp: Number(probabilityUp.toFixed(4)),
      probabilityDown: Number(probabilityDown.toFixed(4)),
      maxDrawdown: this.calculateMaxDrawdown(history.map((item) => item.close)),
      blockedReasons: [],
    }
  }

  private calculateMaxDrawdown(closes: number[]) {
    let peak = 0
    let maxDrawdown = 0
    for (const close of closes) {
      if (!Number.isFinite(close) || close <= 0) continue
      peak = Math.max(peak, close)
      if (peak > 0) {
        maxDrawdown = Math.min(maxDrawdown, (close - peak) / peak)
      }
    }
    return Number(maxDrawdown.toFixed(6))
  }

  private async createFivdRAuditOperation(
    userId: string,
    type: string,
    payload: Record<string, any>,
    artifactName: string,
    generatedAt = new Date(),
    extraArtifacts: Record<string, any> = {}
  ) {
    const artifacts = {
      [artifactName]: payload,
      ...extraArtifacts,
    }
    const operation = await prisma.operation.create({
      data: {
        userId,
        type,
        status: 'completed',
        requestedAt: generatedAt,
        startedAt: generatedAt,
        completedAt: generatedAt,
        progressPct: 100,
        createdBy: 'agent',
        idempotencyKey: `${type}:${generatedAt.getTime()}:${Math.random().toString(36).slice(2)}`,
        inputJson: JSON.stringify({
          schemaVersion: payload.schemaVersion,
          sourceOperationId: payload.sourceOperationId || null,
          sourceRunId: payload.sourceRunId || null,
        }),
        resultJson: JSON.stringify({
          ...payload,
          artifacts,
          artifactRefs: [],
        }),
        artifactRefsJson: JSON.stringify([]),
      },
    })
    const artifactRefs = Object.keys(artifacts).map((filename) => `operation_artifact:${operation.id}:${filename}`)
    await prisma.operation.update({
      where: { id: operation.id },
      data: {
        resultJson: JSON.stringify({
          ...payload,
          operationId: operation.id,
          artifacts,
          artifactRefs,
        }),
        artifactRefsJson: JSON.stringify(artifactRefs),
      },
    })
    return {
      ...payload,
      operationId: operation.id,
      artifactRefs,
    }
  }

  private async getFivdRValidationSourceOperation(operationId?: string) {
    if (operationId) {
      return prisma.operation.findFirst({
        where: {
          id: operationId,
          type: { in: ['stock_screener_full_scan', 'strategy_tournament_run'] },
          status: { in: ['completed', 'succeeded', 'partial'] },
        },
      })
    }
    return prisma.operation.findFirst({
      where: {
        type: { in: ['stock_screener_full_scan', 'strategy_tournament_run'] },
        status: { in: ['completed', 'succeeded', 'partial'] },
      },
      orderBy: [
        { completedAt: 'desc' },
        { requestedAt: 'desc' },
      ],
    })
  }

  private async getLatestFivdRValidationSummaryEvidence() {
    const auditOperation = await prisma.operation.findFirst({
      where: {
        type: 'fivd_r_validation_retest_audit',
        status: { in: ['completed', 'succeeded'] },
      },
      orderBy: [
        { completedAt: 'desc' },
        { requestedAt: 'desc' },
      ],
      select: {
        id: true,
        requestedAt: true,
        completedAt: true,
        resultJson: true,
      },
    })
    if (auditOperation) {
      const result = this.parseJson<Record<string, any>>(auditOperation.resultJson, {})
      const summary = result.summary || {}
      const usableForTradingAdvice = result.status === 'passed' || result.decision === 'READY_FOR_MANUAL_TRADE_DRAFT'
      return {
        operationId: result.sourceOperationId || auditOperation.id,
        generatedAt: auditOperation.completedAt?.toISOString() || auditOperation.requestedAt.toISOString(),
        validationDecision: {
          decision: usableForTradingAdvice ? 'READY_FOR_MANUAL_TRADE_DRAFT' : 'OBSERVE_ONLY',
          usableForTradingAdvice,
          confidence: summary.passedCandidates > 0 ? 'high' : 'medium',
        },
        strategyValidation: {
          schemaVersion: 'fivd.r.strategy_validation.v1',
          source: 'fivd_r_validation_retest_audit',
          operationId: result.sourceOperationId || auditOperation.id,
          validationEvidenceMatrix: {
            schemaVersion: 'fivd.r.validation_evidence_matrix.summary.v1',
            decision: result.decision || null,
            summary: {
              rankedCandidates: summary.rankedCandidates ?? null,
              diagnosedCandidates: summary.diagnosedCandidates ?? null,
              passedCandidates: summary.passedCandidates ?? null,
              failedCandidates: summary.failedCandidates ?? null,
              insufficientCandidates: summary.insufficientCandidates ?? null,
              primaryBlocker: summary.blocker || null,
            },
          },
          oosMultiWindowRegimeRetest: {
            status: result.status || 'blocked',
            summary: summary.oosWindowSummary || null,
          },
          p4ClosureReview: null,
        },
        candidateDisposition: null,
        evidenceRefs: [
          `operation:${auditOperation.id}`,
          ...(Array.isArray(result.artifactRefs) ? result.artifactRefs : []),
        ],
      }
    }
    return this.getLatestFivdRValidationEvidence()
  }

  private async getLatestFivdRValidationEvidence() {
    const operation = await this.getFivdRValidationSourceOperation()
    if (!operation) return null
    const result = this.parseJson<Record<string, any>>(operation.resultJson, {})
    const validationDecision = result.validationDecision || result.dataQuality?.validationDecision || null
    const validationEvidenceMatrix = result.validationEvidenceMatrix || result.dataQuality?.validationEvidenceMatrix || null
    const oosMultiWindowRegimeRetest = result.oosMultiWindowRegimeRetest || result.dataQuality?.oosMultiWindowRegimeRetest || null
    const candidateDisposition = result.validationCandidateDisposition || result.dataQuality?.validationCandidateDisposition || null
    const p4ClosureReview = result.p4ClosureReview || result.dataQuality?.p4ClosureReview || null
    return {
      operationId: operation.id,
      generatedAt: operation.completedAt?.toISOString() || operation.requestedAt.toISOString(),
      validationDecision,
      strategyValidation: {
        schemaVersion: 'fivd.r.strategy_validation.v1',
        source: 'fivd_r_internal_validation_tournament',
        operationId: operation.id,
        validationEvidenceMatrix,
        oosMultiWindowRegimeRetest,
        p4ClosureReview,
      },
      candidateDisposition,
      evidenceRefs: [
        `operation:${operation.id}`,
        'validation_evidence_matrix.json',
        'oos_multi_window_regime_retest.json',
        'validation_candidate_disposition.json',
        'p4_closure_review.json',
      ],
    }
  }

  private buildFivdRAgentTrace(params: {
    runId: string
    generatedAt: string
    scope: 'portfolio' | 'position' | 'candidate'
    blockedReasons: string[]
    evidenceRefs: string[]
    latestValidation: Awaited<ReturnType<AnalysisService['getLatestFivdRValidationEvidence']>>
    evidenceStatus?: 'completed' | 'blocked' | 'insufficient' | 'skipped'
    valuationStatus?: 'completed' | 'blocked' | 'insufficient' | 'skipped'
    disciplineStatus?: 'completed' | 'blocked' | 'insufficient' | 'skipped'
  }) {
    const validationStatus = params.latestValidation
      ? params.latestValidation.validationDecision?.usableForTradingAdvice === true
        ? 'completed'
        : 'insufficient'
      : 'insufficient'
    const evidenceStatus = params.evidenceStatus || (params.blockedReasons.includes('asset_identity_missing') ? 'blocked' : 'completed')
    const valuationStatus = params.valuationStatus || 'completed'
    const disciplineStatus = params.disciplineStatus || 'completed'
    const explanationStatus = params.blockedReasons.includes('asset_identity_missing') ? 'blocked' : 'completed'
    const validationEvidenceRefs = params.latestValidation?.evidenceRefs || []
    const validationArtifacts = params.latestValidation ? [
      'validation_evidence_matrix.json',
      'oos_multi_window_regime_retest.json',
      'validation_candidate_disposition.json',
      'p4_closure_review.json',
    ] : []
    const agents = [
      {
        id: 'evidence_agent',
        sequence: 1,
        status: evidenceStatus,
        inputRefs: ['position', 'asset', 'market_cache', 'provider_health'],
        evidenceRefs: params.evidenceRefs.filter((ref) => !validationEvidenceRefs.includes(ref)),
        blockedReasons: params.blockedReasons.filter((reason) => ['asset_identity_missing', 'position_context_missing'].includes(reason)),
        producedArtifacts: [],
        output: evidenceStatus === 'blocked'
          ? 'asset identity or position context missing; downstream valuation is not executed'
          : 'market, factset and provider evidence collected from existing caches and artifacts',
      },
      {
        id: 'valuation_agent',
        sequence: 2,
        status: valuationStatus,
        inputRefs: ['evidence_agent'],
        evidenceRefs: params.evidenceRefs.filter((ref) => ref.startsWith('stock-factset-cache') || ref.startsWith('quote-list-canonical') || ref.startsWith('financial-report')),
        blockedReasons: params.blockedReasons.filter((reason) => reason.includes('valuation') || reason.includes('fundamental') || reason.includes('metrics')),
        producedArtifacts: ['value.assessment.factset.v1'],
        output: valuationStatus === 'skipped'
          ? 'valuation skipped because no position context exists'
          : 'valueAssessmentService result attached when position context exists',
      },
      {
        id: 'validation_tournament_agent',
        sequence: 3,
        status: validationStatus,
        inputRefs: ['strategy_tournament_operation', 'validation_evidence_artifacts'],
        evidenceRefs: validationEvidenceRefs,
        blockedReasons: params.latestValidation?.validationDecision?.usableForTradingAdvice === true ? [] : ['validation_evidence'],
        producedArtifacts: validationArtifacts,
        output: params.latestValidation ? `operation:${params.latestValidation.operationId}` : 'no strategy validation operation found',
      },
      {
        id: 'discipline_agent',
        sequence: 4,
        status: disciplineStatus,
        inputRefs: ['valuation_agent', 'validation_tournament_agent', 'position_advice_cache'],
        evidenceRefs: params.evidenceRefs.filter((ref) => ref.includes('position') || ref.includes('advice') || ref.includes('strategy')),
        blockedReasons: params.blockedReasons.filter((reason) => reason.includes('advice') || reason.includes('validation_evidence')),
        producedArtifacts: ['fivd.r.trading_discipline.v1', 'fivd.r.position_advice_impact.v1'],
        output: disciplineStatus === 'insufficient'
          ? 'position advice impact is partial; formal action gate remains blocked'
          : 'position advice impact and formal action gate computed deterministically',
      },
      {
        id: 'explanation_agent',
        sequence: 5,
        status: explanationStatus,
        inputRefs: ['summary', 'evidenceGate', 'valuation_agent', 'discipline_agent'],
        evidenceRefs: params.evidenceRefs,
        blockedReasons: explanationStatus === 'blocked' ? params.blockedReasons : [],
        producedArtifacts: ['fivd.r.analysis.result.v1'],
        output: 'structured explanation only; no new trade conclusion generated',
      },
    ]
    const status = agents.some((agent) => agent.status === 'blocked')
      ? 'blocked'
      : agents.some((agent) => agent.status === 'insufficient')
      ? 'partial'
      : 'completed'

    return {
      schemaVersion: 'fivd.r.agent_trace.v1',
      runId: params.runId,
      generatedAt: params.generatedAt,
      scope: params.scope,
      orchestrationMode: 'internal_deterministic',
      status,
      blockedReasons: params.blockedReasons,
      evidenceRefs: params.evidenceRefs,
      agents,
    }
  }

  async getHoldingsResearch(userId: string) {
    const normalizedUserId = userId || 'default'
    await this.ensureUser(normalizedUserId)
    const positions = await prisma.position.findMany({
      where: { userId: normalizedUserId, status: 'open', asset: { type: { not: 'cash' } } },
      include: {
        asset: {
          include: {
            assetTags: { include: { tag: true } },
          },
        },
      },
      orderBy: { marketValue: 'desc' },
    })

    const adviceCaches = await prisma.positionAdviceCache.findMany({
      where: {
        userId: normalizedUserId,
        positionId: { in: positions.filter((position) => position.asset.type !== 'cash').map((position) => position.id) },
        factsetSchemaVersion: 'position.advice.factset.v1',
        status: { in: ['fresh', 'stale', 'partial'] },
      },
      orderBy: { generatedAt: 'desc' },
    })
    const adviceByPositionId = new Map<string, {
      factSet: any
      advice: any
      cache: {
        status: string
        refreshed: boolean
        generatedAt: string
        staleAt: string
        nextRefreshAfter: string
        warnings: string[]
      }
    }>()
    for (const cache of adviceCaches) {
      if (adviceByPositionId.has(cache.positionId)) continue
      const factSet = this.parseJson<any>(cache.factsJson, null)
      const advice = this.parseJson<any>(cache.adviceJson, null)
      if (!factSet || !advice) continue
      adviceByPositionId.set(cache.positionId, {
        factSet,
        advice,
        cache: {
          status: cache.status,
          refreshed: false,
          generatedAt: cache.generatedAt.toISOString(),
          staleAt: cache.staleAt.toISOString(),
          nextRefreshAfter: cache.nextRefreshAfter.toISOString(),
          warnings: this.parseJson<string[]>(cache.warningsJson, []),
        },
      })
    }
    const featureBySymbol = await marketFeatureDailyService.getLatestFeatures(
      positions
        .filter((position) => ['stock', 'etf'].includes(position.asset.type) && /^\d{6}$/.test(position.asset.symbol))
        .map((position) => position.asset.symbol),
      { market: 'CN' }
    )
    const valueAssessments = await Promise.all(positions.map((position) => valueAssessmentService.assessPosition(position)))
    const valueAssessmentByPositionId = new Map(positions.map((position, index) => [position.id, valueAssessments[index]]))

    return positions.map((position) => {
      const positionAdvice = this.augmentAdviceWithMarketFeatureForDisplay(
        adviceByPositionId.get(position.id),
        featureBySymbol.get(position.asset.symbol),
        position.asset.type
      )
      const price = position.currentPrice || position.asset.lastPrice || position.avgCost || 0
      const avgCost = position.avgCost || 0
      const pnlPercent = this.getPositionPnlPercent(position)
      const support = price > 0 ? price * 0.92 : undefined
      const resistance = price > 0 ? price * 1.08 : undefined
      const assetType = position.asset.type
      const isStock = assetType === 'stock'
      const isFundLike = ['fund', 'bond', 'etf'].includes(assetType)
      const isCash = assetType === 'cash'
      const isGold = assetType === 'gold'
      const trend = price > avgCost * 1.05
        ? '强于成本线'
        : price < avgCost * 0.95
        ? '弱于成本线'
        : '成本附近震荡'
      const positionRisk = pnlPercent < -12
        ? '亏损扩大，避免情绪化补仓'
        : pnlPercent > 20
        ? '已有较大浮盈，关注止盈和回撤'
        : '风险中性，重点看仓位和趋势'
      const tags = [
        ...this.parseJsonStringArray(position.tags),
        ...position.asset.assetTags.map((assetTag) => assetTag.tag.name),
      ].filter((tag, index, arr) => tag && arr.indexOf(tag) === index)
      const stopPolicy = [
        typeof position.stopLoss === 'number' ? `止损收益率 ${position.stopLoss}%` : null,
        typeof position.takeProfit === 'number' ? `止盈收益率 ${position.takeProfit}%` : null,
      ].filter(Boolean).join('；') || '未设置持仓级止盈止损'
      const adviceBlockedReasons = positionAdvice?.advice?.blockedReasons || []
      const factSet = positionAdvice?.factSet
      const fundamentalWarnings = factSet?.fundamental?.warnings || []
      const newsEvents = factSet?.news?.recentEvents || []
      const technicalIndicators = factSet?.technical?.indicators || {}
      const qualityText = isStock
        ? adviceBlockedReasons.includes('fundamental_factset_insufficient')
          ? '基本面事实集未生成或不足：当前不能用基本面支持加仓/减仓，只能展示风险缺口。'
          : factSet?.fundamental?.valuationScore !== undefined
          ? `基本面事实集可用：估值分 ${factSet.fundamental.valuationScore ?? '--'}，质量分 ${factSet.fundamental.qualityScore ?? '--'}，成长分 ${factSet.fundamental.growthScore ?? '--'}。`
          : '基本面事实集未接入当前持仓缓存，本卡片不生成基本面结论。'
        : isFundLike
        ? '需要继续补基金规模、费率、跟踪误差、持仓集中度和基金经理变更。'
        : isCash
        ? '无基本面分析需求，主要校验金额口径和可用性。'
        : isGold
        ? '黄金以金价来源、克重、市值和收益率为核心，基本面关注宏观和避险属性。'
        : '需要结合外部来源继续补充资产基本面证据。'
      const valuationText = isStock
        ? fundamentalWarnings.length > 0
          ? `缺口：${fundamentalWarnings.join('；')}`
          : `估值分 ${factSet?.fundamental?.valuationScore ?? '--'}；财务风险分 ${factSet?.fundamental?.financialRiskScore ?? '--'}。`
        : isFundLike
        ? '基金/ETF/债基以官方净值、回撤、底层资产和流动性为核心；当前先展示净值与盈亏口径。'
        : isGold
        ? '黄金按元/克金价跟踪，重点关注价格来源、组合避险占比和回撤。'
        : isCash
        ? '现金按金额口径维护，承担流动性和待建仓资金池功能。'
        : '当前资产类型以持仓成本、现价和组合权重为主要研究输入。'
      const newsSentiment = isStock
        ? newsEvents.length > 0
          ? `消息面分 ${factSet?.news?.sentimentScore ?? '--'}，事件风险分 ${factSet?.news?.eventRiskScore ?? '--'}；最近 ${newsEvents.length} 条事件。`
          : '消息面事实集未生成：当前没有可引用的新闻/公告事件，不生成消息面方向判断。'
        : isFundLike
        ? '关注指数/基金公告、调仓、规模变化、申赎限制和底层行业新闻。'
        : isGold
        ? '关注美元指数、实际利率、央行购金和避险事件。'
        : isCash
        ? '关注资金用途、可用期限和是否触发建仓计划。'
        : '关注与该资产类型直接相关的公告和市场事件。'
      const adviceSummary = isCash
        ? `现金类持仓 ${this.formatCurrency(position.marketValue || 0)}，不生成买卖建议，作为流动性和待建仓资金池管理。`
        : positionAdvice
        ? `${this.positionAdviceActionLabel(positionAdvice.advice.action)}，可信度 ${this.positionAdviceConfidenceLabel(positionAdvice.advice.confidence)}；${positionAdvice.advice.reasons[0] || '按仓位、趋势、风险和策略证据综合评估。'}`
        : `${trend}，${positionRisk}；当前仅展示持仓事实摘要。`
      const valueAssessment = valueAssessmentByPositionId.get(position.id)
      const keyEvidence = [
        `市值 ${this.formatCurrency(position.marketValue || 0)}`,
        `收益率 ${pnlPercent.toFixed(2)}%`,
        isCash ? '现金不参与仓位建议引擎' : `现价 ${this.formatCurrency(price)} / 成本 ${this.formatCurrency(avgCost)}`,
        valueAssessment && valueAssessment.valuation.status !== 'not_applicable'
          ? `价值评分 ${valueAssessment.valuation.compositeScore ?? '--'} / ${valueAssessment.valuation.confidence}`
          : null,
        positionAdvice ? `证据 ${positionAdvice.advice.evidenceRefs.length} 条` : null,
        featureBySymbol.has(position.asset.symbol)
          ? `技术特征 ${featureBySymbol.get(position.asset.symbol)!.tradeDate.toISOString().slice(0, 10)}`
          : this.isExchangeTradedFundCode(position.asset.symbol)
          ? 'ETF 价格/成本参考'
          : null,
      ].filter(Boolean) as string[]
      const researchFactStatus = this.buildHoldingResearchFactStatus({
        assetType,
        factSet,
        valueAssessment,
        positionAdvice,
        marketFeatureAvailable: featureBySymbol.has(position.asset.symbol),
        isCash,
      })
      const holdingBlockedReasons = Array.from(new Set([
        ...(valueAssessment?.valuation?.blockedReasons || []),
        ...(positionAdvice?.advice?.blockedReasons || []),
      ])).filter((reason) => this.shouldKeepHoldingBlockedReason(reason, valueAssessment))
      const dataGapSummary = dataGapSummaryService.build({
        blockedReasons: holdingBlockedReasons,
        assetId: position.assetId,
        symbol: position.asset.symbol,
        assetName: position.asset.name,
        assetType: position.asset.type,
        evidenceRefs: [
          ...(valueAssessment?.evidenceRefs || []),
          ...(positionAdvice?.advice?.evidenceRefs || []),
        ],
      })
      const dataGapSummaryMeta = dataGapSummaryService.aggregate(dataGapSummary)
      const researchCoverage = this.buildHoldingResearchCoverage({
        researchFactStatus,
        dataGapSummary,
        valueAssessment,
        positionAdvice,
        newsEvents,
      })
      const researchEvidenceDetails = this.buildHoldingResearchEvidenceDetails({
        factSet,
        valueAssessment,
        positionAdvice,
        technicalIndicators,
        newsEvents,
        dataGapSummary,
      })

      return {
        positionId: position.id,
        assetId: position.assetId,
        symbol: position.asset.symbol,
        name: position.asset.name,
        type: position.asset.type,
        tags,
        marketValue: position.marketValue || 0,
        weightHint: (position.marketValue || 0) > 0 ? '纳入组合仓位监控' : '市值待刷新',
        summary: adviceSummary,
        keyEvidence,
        researchFactStatus,
        researchCoverage,
        researchEvidenceDetails,
        dataGapSummary,
        dataGapSummaryMeta,
        fundamental: {
          quality: qualityText,
          valuation: valuationText,
          risk: `${positionRisk}；${stopPolicy}`,
          details: this.buildFundamentalDetails(factSet, isStock),
          warnings: fundamentalWarnings,
        },
        technical: {
          trend,
          currentPrice: price,
          avgCost,
          support,
          resistance,
          stopReference: support,
          takeProfitReference: resistance,
          stopReturnPercent: position.stopLoss ?? null,
          takeProfitReturnPercent: position.takeProfit ?? null,
          pnlPercent,
          details: this.buildTechnicalDetails(positionAdvice, technicalIndicators),
          warnings: factSet?.technical?.warnings || [],
        },
        news: {
          sentiment: newsSentiment,
          watchItems: [
            isStock ? '财报、业绩预告、重大合同和监管公告' : '产品公告、持仓变化和费率调整',
            isStock ? '行业政策、竞争格局和新闻事件强度' : '底层指数/行业的趋势和回撤',
            '放量突破、跌破支撑、异常波动和止盈止损触发',
          ],
          events: newsEvents,
        },
        valueAssessment,
        positionAdvice: positionAdvice && !isCash ? {
          schemaVersion: positionAdvice.factSet.schemaVersion,
          generatedAt: positionAdvice.factSet.generatedAt,
          action: positionAdvice.advice.action,
          confidence: positionAdvice.advice.confidence,
          currentWeight: positionAdvice.advice.currentWeight,
          currentWeightPct: positionAdvice.advice.currentWeight * 100,
          targetWeightRange: positionAdvice.advice.targetWeightRange,
          suggestedTradeRatio: positionAdvice.advice.suggestedTradeRatio,
          reasons: positionAdvice.advice.reasons,
          risks: positionAdvice.advice.risks,
          triggerConditions: positionAdvice.advice.triggerConditions,
          invalidationConditions: positionAdvice.advice.invalidationConditions,
          blockedReasons: positionAdvice.advice.blockedReasons,
          evidenceRefs: positionAdvice.advice.evidenceRefs,
          scores: {
            trend: positionAdvice.factSet.technical.trendScore,
            momentum: positionAdvice.factSet.technical.momentumScore,
            relativeStrength: positionAdvice.factSet.technical.relativeStrengthScore,
            volatility: positionAdvice.factSet.technical.volatilityScore,
            liquidity: positionAdvice.factSet.technical.liquidityScore,
          },
          explanation: this.buildPositionAdviceExplanation(positionAdvice),
          market: positionAdvice.factSet.market,
          fivdRImpact: positionAdvice.advice.fivdRImpact || positionAdvice.factSet.fivdRImpact || null,
          strategyEvidenceCount: positionAdvice.factSet.strategyEvidence.backtestSummary.length,
          cache: positionAdvice.cache ? {
            status: positionAdvice.cache.status,
            refreshed: positionAdvice.cache.refreshed,
            generatedAt: positionAdvice.cache.generatedAt,
            staleAt: positionAdvice.cache.staleAt,
            nextRefreshAfter: positionAdvice.cache.nextRefreshAfter,
            warnings: positionAdvice.cache.warnings,
          } : null,
        } : null,
      }
    })
  }

  private formatCurrency(value: number) {
    return `¥${(Number.isFinite(value) ? value : 0).toFixed(2)}`
  }

  private buildHoldingResearchFactStatus(params: {
    assetType: string
    factSet: any
    valueAssessment: Awaited<ReturnType<typeof valueAssessmentService.assessPosition>> | undefined
    positionAdvice: any
    marketFeatureAvailable: boolean
    isCash: boolean
  }): {
    technical: FivdRResearchFactStatus
    fundamental: FivdRResearchFactStatus
    news: FivdRResearchFactStatus
    valuation: 'available' | 'partial' | 'insufficient' | 'not_applicable'
  } {
    const { assetType, factSet, valueAssessment, positionAdvice, marketFeatureAvailable, isCash } = params
    const stockLike = ['stock', 'etf'].includes(assetType)
    const technical = isCash
      ? 'not_applicable'
      : factSet?.technical?.indicators && Object.keys(factSet.technical.indicators).length > 0
        ? 'available'
        : marketFeatureAvailable
          ? 'partial'
          : stockLike
            ? 'missing'
            : 'partial'
    const fundamental = isCash
      ? 'not_applicable'
      : valueAssessment?.valuation?.status === 'available'
        ? 'available'
        : valueAssessment?.valuation?.status === 'partial'
          ? 'partial'
          : stockLike
            ? 'missing'
            : 'partial'
    const newsEvents = factSet?.news?.recentEvents || []
    const news = isCash
      ? 'not_applicable'
      : Array.isArray(newsEvents) && newsEvents.length > 0
        ? 'available'
        : stockLike && positionAdvice
          ? 'partial'
          : stockLike
            ? 'missing'
            : 'partial'
    return {
      technical,
      fundamental,
      news,
      valuation: valueAssessment?.valuation?.status || (isCash ? 'not_applicable' : 'insufficient'),
    }
  }

  private shouldKeepHoldingBlockedReason(
    reason: string,
    valueAssessment: Awaited<ReturnType<typeof valueAssessmentService.assessPosition>> | undefined
  ) {
    const fundLikeFactSet = valueAssessment?.providerTrace?.fundLikeFactSet as any
    if (!fundLikeFactSet) return true
    const currentBlockedReasons = new Set(fundLikeFactSet.blockedReasons || [])
    if (reason === 'fund_nav_history_insufficient') return currentBlockedReasons.has(reason)
    if (reason === 'fund_like_value_factset_missing') return currentBlockedReasons.has(reason)
    if (reason === 'fund_risk_level_missing') return currentBlockedReasons.has(reason)
    if (reason === 'bond_duration_proxy_missing') return currentBlockedReasons.has(reason)
    if (reason === 'bond_credit_risk_proxy_missing') return currentBlockedReasons.has(reason)
    return true
  }

  private buildHoldingResearchCoverage(params: {
    researchFactStatus: {
      technical: FivdRResearchFactStatus
      fundamental: FivdRResearchFactStatus
      news: FivdRResearchFactStatus
      valuation: 'available' | 'partial' | 'insufficient' | 'not_applicable'
    }
    dataGapSummary: ReturnType<typeof dataGapSummaryService.build>
    valueAssessment: Awaited<ReturnType<typeof valueAssessmentService.assessPosition>> | undefined
    positionAdvice: any
    newsEvents: any[]
  }) {
    const { researchFactStatus, dataGapSummary, valueAssessment, positionAdvice, newsEvents } = params
    const dimensions = [
      {
        key: 'technical',
        label: '技术指标',
        status: researchFactStatus.technical,
        evidenceCount: positionAdvice?.factSet?.technical?.indicators ? Object.keys(positionAdvice.factSet.technical.indicators).length : 0,
        blockerCount: dataGapSummary.filter((gap) => gap.category === 'market_data' || gap.category === 'provider_health').length,
      },
      {
        key: 'fundamental',
        label: '基本面/事实集',
        status: researchFactStatus.fundamental,
        evidenceCount: valueAssessment?.facts?.filter((fact) => fact.quality === 'ok').length || 0,
        blockerCount: dataGapSummary.filter((gap) => ['fundamental', 'financial_report', 'fund_factset', 'gold_macro'].includes(gap.category)).length,
      },
      {
        key: 'news',
        label: '消息/事件',
        status: researchFactStatus.news,
        evidenceCount: Array.isArray(newsEvents) ? newsEvents.length : 0,
        blockerCount: dataGapSummary.filter((gap) => gap.category === 'news_event').length,
      },
      {
        key: 'valuation',
        label: '估值/价值',
        status: researchFactStatus.valuation,
        evidenceCount: valueAssessment?.valuation?.status && valueAssessment.valuation.status !== 'not_applicable' ? 1 : 0,
        blockerCount: dataGapSummary.filter((gap) => gap.category === 'valuation' || gap.category === 'validation_evidence').length,
      },
    ] as const
    const applicable = dimensions.filter((dimension) => dimension.status !== 'not_applicable')
    const scoreByStatus: Record<string, number> = {
      available: 100,
      partial: 62,
      insufficient: 30,
      missing: 0,
      not_applicable: 0,
    }
    const rawScore = applicable.length > 0
      ? applicable.reduce((sum, dimension) => sum + (scoreByStatus[dimension.status] ?? 0), 0) / applicable.length
      : 0
    const blockingPenalty = dataGapSummary.filter((gap) => gap.severity === 'blocking' && gap.requiredFor.includes('research')).length * 12
    const degradingPenalty = dataGapSummary.filter((gap) => gap.severity === 'degrading' && gap.requiredFor.includes('research')).length * 5
    const score = Math.max(0, Math.min(100, Math.round(rawScore - blockingPenalty - degradingPenalty)))
    const label = score >= 75
      ? 'research_ready'
      : score >= 45
      ? 'partial'
      : 'data_insufficient'
    const primaryGap = dataGapSummary.find((gap) => gap.severity === 'blocking')
      || dataGapSummary.find((gap) => gap.severity === 'degrading')
      || null

    return {
      score,
      label,
      availableDimensions: applicable.filter((dimension) => dimension.status === 'available').length,
      totalDimensions: applicable.length,
      primaryGap: primaryGap?.blockedReason || null,
      nextAction: primaryGap?.suggestedAction || null,
      dimensions,
    }
  }

  private buildHoldingResearchEvidenceDetails(params: {
    factSet: any
    valueAssessment: Awaited<ReturnType<typeof valueAssessmentService.assessPosition>> | undefined
    positionAdvice: any
    technicalIndicators: any
    newsEvents: any[]
    dataGapSummary: ReturnType<typeof dataGapSummaryService.build>
  }) {
    const { factSet, valueAssessment, positionAdvice, technicalIndicators, newsEvents, dataGapSummary } = params
    const technical = positionAdvice?.factSet?.technical || factSet?.technical || {}
    const indicators = technicalIndicators || technical.indicators || {}
    const support = Array.isArray(technical.supportResistance?.support) ? technical.supportResistance.support : []
    const resistance = Array.isArray(technical.supportResistance?.resistance) ? technical.supportResistance.resistance : []
    const technicalFields = [
      { key: 'trendScore', label: '趋势分', value: this.normalizeEvidenceValue(technical.trendScore), unit: 'score' },
      { key: 'momentumScore', label: '动量分', value: this.normalizeEvidenceValue(technical.momentumScore), unit: 'score' },
      { key: 'relativeStrengthScore', label: '相对强弱分', value: this.normalizeEvidenceValue(technical.relativeStrengthScore), unit: 'score' },
      { key: 'volatilityScore', label: '波动分', value: this.normalizeEvidenceValue(technical.volatilityScore), unit: 'score' },
      { key: 'liquidityScore', label: '流动性分', value: this.normalizeEvidenceValue(technical.liquidityScore), unit: 'score' },
      { key: 'return20d', label: '20日收益', value: this.normalizeEvidenceValue(indicators.return20d), unit: 'percent' },
      { key: 'return60d', label: '60日收益', value: this.normalizeEvidenceValue(indicators.return60d), unit: 'percent' },
      { key: 'rsi14', label: 'RSI14', value: this.normalizeEvidenceValue(indicators.rsi14), unit: 'number' },
      { key: 'ma20', label: 'MA20', value: this.normalizeEvidenceValue(indicators.ma20), unit: 'price' },
      { key: 'ma60', label: 'MA60', value: this.normalizeEvidenceValue(indicators.ma60), unit: 'price' },
      { key: 'ma120', label: 'MA120', value: this.normalizeEvidenceValue(indicators.ma120), unit: 'price' },
      { key: 'atr14', label: 'ATR14', value: this.normalizeEvidenceValue(indicators.atr14), unit: 'price' },
      { key: 'volatility20', label: '20日波动率', value: this.normalizeEvidenceValue(indicators.volatility20), unit: 'percent' },
      { key: 'maxDrawdown20', label: '20日最大回撤', value: this.normalizeEvidenceValue(indicators.maxDrawdown20), unit: 'percent' },
      { key: 'volumeRatio20', label: '量比20', value: this.normalizeEvidenceValue(indicators.volumeRatio20), unit: 'number' },
    ]
    const valuation = valueAssessment?.valuation
    const fundLikeFactSet = valueAssessment?.providerTrace?.fundLikeFactSet as any
    const valuationFields = valuation ? [
      { key: 'valuationScore', label: '估值分', value: this.normalizeEvidenceValue(valuation.valuationScore), unit: 'score' },
      { key: 'qualityScore', label: '质量分', value: this.normalizeEvidenceValue(valuation.qualityScore), unit: 'score' },
      { key: 'growthScore', label: '成长分', value: this.normalizeEvidenceValue(valuation.growthScore), unit: 'score' },
      { key: 'financialRiskScore', label: '财务风险分', value: this.normalizeEvidenceValue(valuation.financialRiskScore), unit: 'score' },
      { key: 'compositeScore', label: '综合价值分', value: this.normalizeEvidenceValue(valuation.compositeScore), unit: 'score' },
    ] : []
    const fundamentalFacts = (valueAssessment?.facts || []).map((fact) => ({
      id: fact.id,
      label: fact.label,
      value: fact.value ?? null,
      source: fact.source,
      asOf: fact.asOf,
      quality: fact.quality,
    }))
    const technicalGapReasons = dataGapSummary
      .filter((gap) => gap.category === 'market_data' || gap.category === 'provider_health')
      .map((gap) => gap.blockedReason)
    const fundamentalGapReasons = dataGapSummary
      .filter((gap) => ['fundamental', 'financial_report', 'fund_factset', 'gold_macro'].includes(gap.category))
      .map((gap) => gap.blockedReason)

    return {
      schemaVersion: 'holding.research.evidence_details.v1',
      technical: {
        source: indicators.source || 'position_advice_factset',
        asOf: indicators.tradeDate || positionAdvice?.factSet?.generatedAt || null,
        support,
        resistance,
        fields: technicalFields,
        availableFieldCount: technicalFields.filter((field) => field.value !== null).length,
        missingFieldCount: technicalFields.filter((field) => field.value === null).length,
        warnings: Array.from(new Set([...(technical.warnings || []), ...technicalGapReasons])),
      },
      fundamental: {
        status: valueAssessment?.valuation?.status || 'insufficient',
        facts: fundamentalFacts,
        availableFactCount: fundamentalFacts.filter((fact) => fact.quality === 'ok').length,
        missingFactCount: fundamentalFacts.filter((fact) => fact.quality !== 'ok').length,
        warnings: Array.from(new Set([...(factSet?.fundamental?.warnings || []), ...fundamentalGapReasons])),
      },
      valuation: {
        status: valuation?.status || 'insufficient',
        conclusion: valuation?.conclusion || 'insufficient',
        confidence: valuation?.confidence || 'insufficient',
        valuationBand: valuation?.valuationBand || 'unknown',
        method: valuation?.method || 'unknown',
        fields: valuationFields,
        reasons: valuation?.reasons || [],
        risks: valuation?.risks || [],
        blockedReasons: valuation?.blockedReasons || [],
      },
      news: {
        sentimentScore: factSet?.news?.sentimentScore ?? null,
        eventRiskScore: factSet?.news?.eventRiskScore ?? null,
        eventCount: Array.isArray(newsEvents) ? newsEvents.length : 0,
        events: Array.isArray(newsEvents) ? newsEvents.slice(0, 5) : [],
      },
      fundLike: fundLikeFactSet ? {
        riskLevelProxy: fundLikeFactSet.riskLevelProxy ? {
          status: fundLikeFactSet.riskLevelProxy.status,
          riskLevel: fundLikeFactSet.riskLevelProxy.riskLevel,
          score: fundLikeFactSet.riskLevelProxy.score,
          method: fundLikeFactSet.riskLevelProxy.method,
          warnings: fundLikeFactSet.riskLevelProxy.warnings || [],
        } : undefined,
        durationProxy: fundLikeFactSet.durationProxy ? {
          status: fundLikeFactSet.durationProxy.status,
          durationBucket: fundLikeFactSet.durationProxy.durationBucket,
          estimatedDurationYears: fundLikeFactSet.durationProxy.estimatedDurationYears,
          confidence: fundLikeFactSet.durationProxy.confidence,
          method: fundLikeFactSet.durationProxy.method,
          warnings: fundLikeFactSet.durationProxy.warnings || [],
        } : undefined,
        navHistory: fundLikeFactSet.navHistory,
        bondRiskProxy: fundLikeFactSet.bondRiskProxy ? {
          status: fundLikeFactSet.bondRiskProxy.status,
          bondPct: fundLikeFactSet.bondRiskProxy.latestAllocation?.bondPct ?? null,
          topBondConcentrationPct: fundLikeFactSet.bondRiskProxy.topBondConcentrationPct ?? null,
          creditRiskFlags: fundLikeFactSet.bondRiskProxy.creditRiskFlags || [],
        } : undefined,
      } : undefined,
    }
  }

  private buildPositionAdviceExplanation(positionAdvice: any) {
    const factSet = positionAdvice?.factSet || {}
    const advice = positionAdvice?.advice || {}
    const currentWeight = Number(factSet.position?.currentWeight || 0)
    const baseTargetWeight = Number(factSet.position?.targetWeight || 0)
    const trendScore = Number(factSet.technical?.trendScore ?? 50)
    const momentumScore = Number(factSet.technical?.momentumScore ?? 50)
    const volatilityScore = Number(factSet.technical?.volatilityScore ?? 50)
    const cashRatio = Number(factSet.portfolio?.cashRatio || 0)
    const maxSinglePositionRatio = Number(factSet.portfolio?.maxSinglePositionRatio || 0)
    const marketRegimeMultiplier = cashRatio < 0.03 ? 0.6 : 0.7
    const signalMultiplier = trendScore >= 70 && momentumScore >= 60
      ? 1.2
      : trendScore >= 50
      ? 1
      : trendScore >= 35
      ? 0.8
      : trendScore >= 25
      ? 0.5
      : 0.2
    let riskPenaltyMultiplier = 1
    const riskPenaltyReasons: string[] = []
    if (currentWeight > 0.15) {
      riskPenaltyMultiplier *= 0.4
      riskPenaltyReasons.push('单票仓位超过 15%，风险惩罚 ×0.4')
    }
    if (maxSinglePositionRatio > 0.2) {
      riskPenaltyMultiplier *= 0.8
      riskPenaltyReasons.push('组合最大单票仓位超过 20%，风险惩罚 ×0.8')
    }
    if (volatilityScore < 35) {
      riskPenaltyMultiplier *= 0.7
      riskPenaltyReasons.push(`波动分 ${volatilityScore} < 35，风险惩罚 ×0.7`)
    }
    if (Number(factSet.news?.eventRiskScore || 0) >= 50) {
      riskPenaltyMultiplier *= 0.6
      riskPenaltyReasons.push('消息面事件风险 >= 50，风险惩罚 ×0.6')
    }
    const confidenceMultiplier = advice.confidence === 'high'
      ? 1
      : advice.confidence === 'medium'
      ? 0.7
      : advice.confidence === 'low'
      ? 0.3
      : 0
    const fivdRCombinedMultiplier = Number(factSet.fivdRImpact?.combinedMultiplier ?? 1)
    const finalTargetWeight = baseTargetWeight
      * marketRegimeMultiplier
      * signalMultiplier
      * riskPenaltyMultiplier
      * fivdRCombinedMultiplier
      * confidenceMultiplier
    const actionTriggers = []
    if (factSet.position?.assetType === 'cash') actionTriggers.push('现金类不生成交易动作。')
    if (currentWeight > 0.15) actionTriggers.push(`当前仓位 ${(currentWeight * 100).toFixed(2)}% > 15%，触发集中度减仓规则。`)
    if (trendScore < 30) actionTriggers.push(`趋势分 ${trendScore} < 30，触发趋势风控减仓规则。`)
    if ((advice.blockedReasons || []).includes('market_price_missing')) actionTriggers.push('当前价格缺失，禁止交易动作。')
    if (['low', 'insufficient'].includes(advice.confidence)) actionTriggers.push(`综合可信度为 ${advice.confidence}，加仓动作会被降级为观察。`)
    if ((advice.blockedReasons || []).includes('validation_evidence')) actionTriggers.push('FIVD-R validation evidence 未通过，ADD / REDUCE 降级为观察。')
    const delta = finalTargetWeight - currentWeight

    return {
      formula: {
        expression: 'targetWeight = baseTargetWeight * marketRegimeMultiplier * signalMultiplier * riskPenaltyMultiplier * fivdRCombinedMultiplier * confidenceMultiplier',
        baseTargetWeight,
        marketRegimeMultiplier,
        signalMultiplier,
        riskPenaltyMultiplier: Number(riskPenaltyMultiplier.toFixed(4)),
        fivdRCombinedMultiplier: Number(fivdRCombinedMultiplier.toFixed(4)),
        confidenceMultiplier,
        finalTargetWeight: Number(finalTargetWeight.toFixed(6)),
        currentWeight,
        delta: Number(delta.toFixed(6)),
      },
      actionTriggers,
      riskPenaltyReasons,
      scoreDetails: this.buildTechnicalDetails(positionAdvice, factSet.technical?.indicators || []),
      evidenceGaps: [
        ...(advice.blockedReasons || []),
        ...(factSet.technical?.warnings || []),
        ...(factSet.fundamental?.warnings || []),
        ...((factSet.news?.recentEvents || []).length === 0 ? ['news_factset_missing_or_empty'] : []),
      ],
    }
  }

  private buildTechnicalDetails(positionAdvice: any, indicators: any) {
    const factSet = positionAdvice?.factSet || {}
    const technical = factSet.technical || {}
    const support = technical.supportResistance?.support || []
    const resistance = technical.supportResistance?.resistance || []
    return [
      `趋势分 ${technical.trendScore ?? '--'}：来自 ${indicators.source || 'unknown'}，MA20=${this.formatOptionalNumber(indicators.ma20)}，MA60=${this.formatOptionalNumber(indicators.ma60)}，MA120=${this.formatOptionalNumber(indicators.ma120)}。`,
      `动量分 ${technical.momentumScore ?? '--'}：20日收益=${this.formatOptionalPercent(indicators.return20d)}，60日收益=${this.formatOptionalPercent(indicators.return60d)}，RSI14=${this.formatOptionalNumber(indicators.rsi14)}。`,
      `相对强弱 ${technical.relativeStrengthScore ?? '--'}：relativeStrength60=${this.formatOptionalPercent(indicators.relativeStrength60)}。`,
      `波动分 ${technical.volatilityScore ?? '--'}：20日波动率=${this.formatOptionalPercent(indicators.volatility20)}，20日最大回撤=${this.formatOptionalPercent(indicators.maxDrawdown20)}，ATR14=${this.formatOptionalNumber(indicators.atr14)}。`,
      `流动性分 ${technical.liquidityScore ?? '--'}：量比20=${this.formatOptionalNumber(indicators.volumeRatio20)}。`,
      `支撑/压力：${support.join(', ') || '--'} / ${resistance.join(', ') || '--'}。`,
    ]
  }

  private buildFundamentalDetails(factSet: any, isStock: boolean) {
    if (!isStock) return ['非股票资产暂不使用股票财务基本面模型。']
    const fundamental = factSet?.fundamental
    if (!fundamental || (fundamental.warnings || []).length > 0) {
      return [
        '当前持仓缓存没有可用基本面事实集。',
        ...((fundamental?.warnings || []).map((warning: string) => `缺口：${warning}`)),
      ]
    }
    return [
      `估值分 ${fundamental.valuationScore ?? '--'}，质量分 ${fundamental.qualityScore ?? '--'}，成长分 ${fundamental.growthScore ?? '--'}，财务风险分 ${fundamental.financialRiskScore ?? '--'}。`,
      `行业分位：${fundamental.industryRank ? JSON.stringify(fundamental.industryRank) : '--'}。`,
    ]
  }

  private formatOptionalNumber(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? parsed.toFixed(3) : '--'
  }

  private normalizeEvidenceValue(value: unknown): number | string | null {
    if (value === null || value === undefined || value === '') return null
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : String(value)
  }

  private formatOptionalPercent(value: unknown) {
    const parsed = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(parsed) ? `${parsed.toFixed(2)}%` : '--'
  }

  private positionAdviceActionLabel(action: string) {
    const labels: Record<string, string> = {
      ADD: '加仓观察',
      REDUCE: '减仓观察',
      HOLD: '持有',
      OBSERVE: '观察',
      NO_ACTION: '无动作',
    }
    return labels[action] || action
  }

  private positionAdviceConfidenceLabel(confidence: string) {
    const labels: Record<string, string> = {
      high: '高',
      medium: '中',
      low: '低',
      insufficient: '证据不足',
    }
    return labels[confidence] || confidence
  }

  private augmentAdviceWithMarketFeatureForDisplay(positionAdvice: any, feature: any, assetType: string) {
    if (!positionAdvice || !['stock', 'etf'].includes(assetType)) return positionAdvice

    const symbol = positionAdvice.factSet?.position?.symbol || ''
    const isEtfLike = assetType === 'etf' || this.isExchangeTradedFundCode(symbol)
    if (!feature && !isEtfLike) return positionAdvice

    const evidenceRef = feature
      ? `market-feature-daily:${feature.symbol}:${feature.tradeDate.toISOString().slice(0, 10)}`
      : `position-price-technical:${symbol}`
    const technical = positionAdvice.factSet?.technical || {}
    const blockedReasons = (positionAdvice.advice?.blockedReasons || [])
      .filter((reason: string) => {
        if (reason === 'technical_factset_missing') return false
        if (isEtfLike && reason === 'fundamental_factset_insufficient') return false
        return true
      })
    const evidenceRefs = [...new Set([...(positionAdvice.advice?.evidenceRefs || []), evidenceRef])]
    const qualityFlags = feature ? this.parseJsonStringArray(feature.qualityFlagsJson) : ['etf_feature_cache_missing']
    const currentPrice = positionAdvice.factSet?.position?.currentPrice || 0
    const costBasis = positionAdvice.factSet?.position?.costBasis || 0
    const inferredTrendScore = currentPrice > 0 && costBasis > 0
      ? currentPrice >= costBasis * 1.03 ? 65 : currentPrice <= costBasis * 0.97 ? 35 : 50
      : technical.trendScore
    const inferredMomentumScore = currentPrice > 0 && costBasis > 0
      ? Math.max(20, Math.min(80, 50 + ((currentPrice - costBasis) / costBasis) * 100))
      : technical.momentumScore

    return {
      ...positionAdvice,
      factSet: {
        ...positionAdvice.factSet,
        technical: {
          ...technical,
          trendScore: feature && typeof feature.trendScore === 'number' ? feature.trendScore : inferredTrendScore,
          momentumScore: feature && typeof feature.momentumScore === 'number' ? feature.momentumScore : inferredMomentumScore,
          relativeStrengthScore: feature && typeof feature.relativeStrength60 === 'number'
            ? Math.max(0, Math.min(100, Math.round(50 + feature.relativeStrength60 * 100)))
            : technical.relativeStrengthScore,
          volatilityScore: feature && typeof feature.volatility20 === 'number'
            ? Math.max(0, Math.min(100, Math.round(100 - feature.volatility20 * 200)))
            : technical.volatilityScore,
          liquidityScore: feature && typeof feature.liquidityScore === 'number' ? feature.liquidityScore : technical.liquidityScore,
          supportResistance: {
            support: feature && typeof feature.rollingLow20 === 'number'
              ? [feature.rollingLow20]
              : currentPrice > 0 ? [currentPrice * 0.92] : (technical.supportResistance?.support || []),
            resistance: feature && typeof feature.rollingHigh20 === 'number'
              ? [feature.rollingHigh20]
              : currentPrice > 0 ? [currentPrice * 1.08] : (technical.supportResistance?.resistance || []),
          },
          indicators: {
            ...(technical.indicators || {}),
            source: feature ? 'market_feature_daily' : 'position_price_fallback',
            tradeDate: feature ? feature.tradeDate.toISOString().slice(0, 10) : null,
            close: feature ? feature.closePrice : currentPrice,
            return20d: feature?.return20d,
            return60d: feature?.return60d,
            ma20: feature?.ma20,
            ma60: feature?.ma60,
            volumeRatio20: feature?.volumeRatio20,
            atr14: feature?.atr14,
            rsi14: feature?.rsi14,
            volatility20: feature?.volatility20,
            maxDrawdown20: feature?.maxDrawdown20,
            relativeStrength60: feature?.relativeStrength60,
            qualityFlags,
          },
          warnings: [
            ...new Set([
              ...(technical.warnings || []),
              feature
                ? '已补充 market_feature_daily 技术特征证据，列表页不再因外部技术评级缺失而空白。'
                : 'ETF 行情特征缓存缺失，已用持仓现价/成本生成展示参考；正式建议仍需补齐 ETF canonical 特征。',
              ...qualityFlags.map((flag) => `技术特征质量标记：${flag}`),
            ]),
          ],
        },
        evidenceRefs,
      },
      advice: {
        ...positionAdvice.advice,
        blockedReasons,
        evidenceRefs,
        risks: (positionAdvice.advice?.risks || []).filter((risk: string) => {
          if ((feature || isEtfLike) && risk.includes('外部技术指标事实集未生成')) return false
          if (isEtfLike && risk.includes('基本面事实集未生成')) return false
          return true
        }),
      },
    }
  }

  private isExchangeTradedFundCode(symbol: string): boolean {
    return /^(159|510|511|512|513|515|516|517|518|520|560|561|562|563|588|589)\d{3}$/.test(symbol)
  }

  /**
   * 计算风险评分
   */
  private calculateRiskScore(positions: any[]): number {
    if (positions.length === 0) return 0

    let totalRisk = 0
    for (const position of positions) {
      const lossPercent = Math.max(0, -this.getPositionPnlPercent(position) / 100)
      totalRisk += lossPercent * 100
    }
    return totalRisk / positions.length
  }

  /**
   * 获取市场展望
   */
  private getMarketOutlook(positions: any[]): string {
    if (positions.length === 0) return '暂无持仓'

    const gainers = positions.filter(p => this.getPositionPnlPercent(p) > 0).length
    const losers = positions.length - gainers

    if (gainers > losers * 2) return '整体持仓表现优秀，注意利润锁定'
    if (losers > gainers * 2) return '整体持仓承压，建议关注止损'
    return '市场处于震荡阶段，建议保持仓位'
  }
}

export const analysisService = new AnalysisService()
