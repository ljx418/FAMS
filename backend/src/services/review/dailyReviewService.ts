import { createHash } from 'node:crypto'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import { assetTrendService, type AssetTrendSnapshot } from '../market-data/assetTrendService.js'
import { positionAdviceService, type PositionAdviceResult } from '../position/positionAdviceService.js'
import { gridStrategyService, type GridStrategyConfig } from '../strategy/gridStrategyService.js'
import { valueAssessmentService, type ValueAssessmentFactSet } from '../valuation/valueAssessmentService.js'
import { dailyReviewSynthesisService } from './dailyReviewSynthesisService.js'

export type DailyReviewSession = 'open' | 'pre_close' | 'manual'

export interface StartDailyReviewInput {
  userId: string
  sessionType?: DailyReviewSession
  triggerSource?: 'user' | 'scheduler' | 'agent'
  scheduledFor?: Date
  idempotencyKey?: string
  executionMode?: 'inline' | 'queued'
  requireLlmSuccess?: boolean
}

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

const finite = (value: unknown): number | null => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const stableHash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function classifyMaterialChange(current: PositionAdviceResult, previous: any, valuation?: ValueAssessmentFactSet | null) {
  const news = current.factSet.news
  const fundamental = current.factSet.fundamental
  const evidenceStale = current.cache?.status === 'stale'
  const financialRiskScore = valuation?.valuation.financialRiskScore ?? fundamental?.financialRiskScore ?? null
  const hasFundamentalScores = [
    valuation?.valuation.valuationScore,
    valuation?.valuation.qualityScore,
    valuation?.valuation.growthScore,
    financialRiskScore,
    fundamental?.valuationScore,
    fundamental?.qualityScore,
    fundamental?.growthScore,
  ].some((item) => typeof item === 'number' && Number.isFinite(item))
  const evidenceUnavailable = (!news && !fundamental)
    || evidenceStale
    || (current.factSet.position.assetType === 'stock' && valuation?.valuation.status === 'insufficient' && !hasFundamentalScores)
  const currentFacts = {
    valuationStatus: valuation?.valuation.status ?? 'unavailable',
    valuationConclusion: valuation?.valuation.conclusion ?? 'insufficient',
    valuationBand: valuation?.valuation.valuationBand ?? 'unknown',
    valuationScore: valuation?.valuation.valuationScore ?? fundamental?.valuationScore ?? null,
    qualityScore: valuation?.valuation.qualityScore ?? fundamental?.qualityScore ?? null,
    growthScore: valuation?.valuation.growthScore ?? fundamental?.growthScore ?? null,
    financialRiskScore,
    sentimentScore: news?.sentimentScore ?? null,
    eventRiskScore: news?.eventRiskScore ?? null,
    events: (news?.recentEvents || []).slice(0, 5).map((event) => ({
      title: event.title,
      eventType: event.eventType,
      impact: event.impact,
      publishedAt: event.publishedAt,
      evidenceRef: event.evidenceRef,
    })),
  }
  const previousFacts = previous?.fundamentalAndNews?.facts || null
  let level: 'none' | 'watch' | 'material' | 'insufficient' = 'none'
  const reasons: string[] = []
  if (evidenceUnavailable) {
    level = 'insufficient'
    reasons.push(evidenceStale ? '基本面与消息面缓存已过期，已安排后台刷新；本轮禁止据此提高仓位。' : '基本面与消息面证据不足，禁止据此提高仓位。')
  } else if ((news?.eventRiskScore || 0) >= 50
    || (typeof financialRiskScore === 'number' && financialRiskScore < 35)
    || valuation?.valuation.conclusion === 'risk_review') {
    level = 'material'
    reasons.push('事件风险或财务风险达到重大变化复核阈值。')
  } else if (previousFacts && stableHash(previousFacts) !== stableHash(currentFacts)) {
    level = 'watch'
    reasons.push('相较上一轮复盘，基本面或消息面事实摘要发生变化。')
  } else {
    reasons.push(previousFacts ? '未识别出相较上一轮的重大事实变化。' : '本轮作为变化基线，后续将逐轮比较。')
  }
  return {
    level,
    reasons,
    facts: currentFacts,
    evidenceRefs: [...new Set([...(current.factSet.evidenceRefs || []), ...(valuation?.evidenceRefs || [])])],
  }
}

function valuationContext(assessment: ValueAssessmentFactSet | null, assetType: string) {
  if (assetType !== 'stock') {
    return {
      applicability: 'not_applicable',
      status: 'not_applicable',
      conclusion: 'not_applicable',
      valuationBand: 'unknown',
      compositeScore: null,
      confidence: 'insufficient',
      method: 'stock_valuation_not_applicable',
      reasons: ['ETF、基金及其他非个股资产不套用个股估值模型。'],
      risks: [],
      blockedReasons: [],
      evidenceRefs: assessment?.evidenceRefs || [],
      asOf: assessment?.generatedAt || null,
    }
  }
  const value = assessment?.valuation
  return {
    applicability: 'stock_relative_valuation',
    status: value?.status || 'insufficient',
    conclusion: value?.conclusion || 'insufficient',
    valuationBand: value?.valuationBand || 'unknown',
    compositeScore: value?.compositeScore ?? null,
    confidence: value?.confidence || 'insufficient',
    method: value?.method || 'stock_relative_valuation_quality_growth_risk_v1',
    reasons: value?.reasons || ['价值评估证据不足。'],
    risks: value?.risks || [],
    blockedReasons: value?.blockedReasons || ['value_assessment_evidence_insufficient'],
    evidenceRefs: assessment?.evidenceRefs || [],
    asOf: assessment?.generatedAt || null,
  }
}

async function withTimeout<T>(work: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      work,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(code)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function gridChange(previous: any, next: any) {
  if (!previous) return { changed: true, reasons: ['首次生成网格草案。'], previousPlanId: null }
  const previousOrders = Array.isArray(previous.orders) ? previous.orders : []
  const nextOrders = Array.isArray(next.orders) ? next.orders : []
  const previousSignature = previousOrders.map((order: any) => [order.side, order.level, order.price, order.quantity])
  const nextSignature = nextOrders.map((order: any) => [order.side, order.level, order.price, order.quantity])
  const changed = previous.mode !== next.mode || stableHash(previousSignature) !== stableHash(nextSignature)
  const reasons = changed
    ? ['价格、风险门槛或策略证据变化导致网格草案更新。']
    : ['网格关键价位与数量未发生实质变化。']
  return { changed, reasons, previousPlanId: previous.id }
}

function fallbackGridConfig(assetType: string) {
  if (['stock', 'etf', 'fund'].includes(assetType)) return gridStrategyService.getTemplate('mean_reversion_atr_v1')
  if (['gold', 'bond', 'bond_fund'].includes(assetType)) return gridStrategyService.getTemplate('cost_support_v1')
  return gridStrategyService.getTemplate('observe_only_v1')
}

function gridAssetType(assetType: string) {
  return assetType === 'bond_fund' ? 'bond' : assetType
}

function gridMarket(exchange: string | null | undefined) {
  if (exchange === 'HK') return 'HK'
  if (exchange === 'US') return 'US'
  return 'CN'
}

function buildDecisionSummary(assetReviews: any[], strategyAssessment: any) {
  const assets = assetReviews.map((item) => {
    const orders = Array.isArray(item.grid?.orders) ? item.grid.orders : []
    const conditionalBuybackOrders = Array.isArray(item.buybackGrid?.orders) ? item.buybackGrid.orders : []
    const buyOrders = orders.filter((order: any) => order.side === 'buy')
    const sellOrders = orders.filter((order: any) => order.side === 'sell')
    const action = buyOrders.length > 0 && sellOrders.length > 0
      ? 'manual_two_sided_grid'
      : buyOrders.length > 0
        ? 'manual_buy_grid'
        : sellOrders.length > 0
          ? 'manual_sell_grid'
          : item.fundamentalAndNews?.level === 'material'
            ? 'needs_review'
            : 'observe'
    const priority = item.fundamentalAndNews?.level === 'material'
      || (item.position?.weightPct || 0) > 25
      ? 'high'
      : item.fundamentalAndNews?.level === 'watch'
        || item.grid?.blockers?.length > 0
        ? 'medium'
        : 'normal'
    return {
      assetId: item.assetId,
      symbol: item.symbol,
      name: item.name,
      action,
      priority,
      conclusion: item.grid?.summary || '本轮仅观察。',
      currentPrice: item.trend?.quote?.price ?? null,
      quoteAsOf: item.trend?.quote?.asOf ?? null,
      valuationContext: item.valuationContext,
      gridDerivation: item.grid?.derivation || null,
      adjustment: item.grid?.adjustment || { changed: false, reasons: [] },
      blockers: item.grid?.blockers || [],
      orders: orders.map((order: any) => ({
        id: order.id,
        side: order.side,
        level: order.level,
        price: order.price,
        quantity: order.quantity,
        amount: order.amount,
        validUntil: order.validUntil,
        conflictStatus: order.conflictStatus,
        rationale: order.rationale,
      })),
      conditionalBuyback: {
        status: item.buybackGrid?.status || 'observe_only',
        summary: item.buybackGrid?.summary || '本轮没有可绑定的父卖单。',
        blockers: item.buybackGrid?.blockers || [],
        derivation: item.buybackGrid?.derivation || null,
        adjustment: item.buybackGrid?.adjustment || { changed: false, reasons: [] },
        orders: conditionalBuybackOrders.map((order: any) => ({
          id: order.id,
          side: order.side,
          level: order.level,
          price: order.price,
          quantity: order.quantity,
          amount: order.amount,
          validUntil: order.validUntil,
          status: order.status,
          conflictStatus: order.conflictStatus,
          triggerCondition: parseJson(order.triggerConditionJson, {}),
          rationale: order.rationale,
        })),
      },
      evidenceRefs: [...new Set([
        ...(item.fundamentalAndNews?.evidenceRefs || []),
        ...(item.valuationContext?.evidenceRefs || []),
      ])],
    }
  })
  return {
    schemaVersion: 'fams.daily-review-decision-summary.v1',
    status: strategyAssessment.status,
    headline: strategyAssessment.conclusion,
    highPrioritySymbols: assets.filter((item) => item.priority === 'high').map((item) => item.symbol),
    counts: {
      assets: assets.length,
      buyDrafts: assets.reduce((sum, item) => sum + item.orders.filter((order: any) => order.side === 'buy').length, 0),
      sellDrafts: assets.reduce((sum, item) => sum + item.orders.filter((order: any) => order.side === 'sell').length, 0),
      conditionalBuybackDrafts: assets.reduce((sum, item) => sum + item.conditionalBuyback.orders.length, 0),
      observeAssets: assets.filter((item) => item.orders.length === 0).length,
    },
    assets,
    executionMode: 'manual_plan_draft_only',
  }
}

class DailyReviewService {
  async startReview(input: StartDailyReviewInput) {
    await ensureUser(prisma, input.userId)
    const sessionType = input.sessionType || 'manual'
    const triggerSource = input.triggerSource || 'user'
    const scheduledFor = input.scheduledFor || null
    const idempotencyKey = input.idempotencyKey || null
    if (idempotencyKey) {
      const existing = await prisma.operation.findUnique({
        where: { type_idempotencyKey: { type: 'daily_portfolio_review', idempotencyKey } },
        include: { dailyReviewRun: true },
      })
      if (existing) return { operation: existing, review: existing.dailyReviewRun, reused: true }
    }
    const previous = await prisma.dailyReviewRun.findFirst({
      where: { userId: input.userId, status: { in: ['completed', 'partial'] } },
      orderBy: { generatedAt: 'desc' },
    })
    const operation = await prisma.operation.create({
      data: {
        userId: input.userId,
        type: 'daily_portfolio_review',
        status: 'queued',
        createdBy: triggerSource,
        idempotencyKey,
        inputJson: JSON.stringify({
          sessionType,
          triggerSource,
          scheduledFor: scheduledFor?.toISOString() || null,
          requireLlmSuccess: input.requireLlmSuccess === true,
        }),
        progressMessage: '等待生成每日持仓复盘',
      },
    })
    const review = await prisma.dailyReviewRun.create({
      data: {
        userId: input.userId,
        operationId: operation.id,
        previousRunId: previous?.id || null,
        sessionType,
        triggerSource,
        scheduledFor,
        status: 'queued',
      },
    })
    const execute = () => this.executeReview(review.id).catch((error) => this.markReviewFailed(review.id, error))
    if (input.executionMode === 'queued') queueMicrotask(execute)
    else await execute()
    return {
      operation: await prisma.operation.findUnique({ where: { id: operation.id } }),
      review: await prisma.dailyReviewRun.findUnique({ where: { id: review.id } }),
      reused: false,
    }
  }

  async executeReview(reviewId: string) {
    const review = await prisma.dailyReviewRun.findUnique({
      where: { id: reviewId },
      include: { previousRun: true, operation: true },
    })
    if (!review) throw new Error('Daily review run not found')
    if (['completed', 'partial', 'failed'].includes(review.status)) return this.getReview(reviewId, review.userId)
    const startedAt = new Date()
    const operationInput = parseJson<any>(review.operation?.inputJson, {})
    const requireLlmSuccess = operationInput.requireLlmSuccess === true
    if (review.status === 'running') {
      await prisma.$transaction([
        prisma.gridPlan.deleteMany({ where: { dailyReviewRunId: review.id } }),
        prisma.marketSnapshot.deleteMany({ where: { dailyReviewRunId: review.id } }),
        prisma.positionSnapshot.deleteMany({ where: { dailyReviewRunId: review.id } }),
      ])
    }
    await prisma.$transaction([
      prisma.dailyReviewRun.update({ where: { id: reviewId }, data: { status: 'running', generatedAt: startedAt } }),
      ...(review.operationId ? [prisma.operation.update({
        where: { id: review.operationId },
        data: { status: 'running', startedAt, progressPct: 5, progressMessage: '正在读取持仓、行情与策略证据' },
      })] : []),
    ])

    const positions = await prisma.position.findMany({
      where: { userId: review.userId, status: 'open' },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    })
    const previousReport = parseJson<any>(review.previousRun?.reportJson, {})
    const activeConfigs = await gridStrategyService.getActiveConfigs(review.userId)
    const investablePositions = positions.filter((position) => position.asset.type !== 'cash')
    const assetTimeoutMs = Math.max(5_000, Number(process.env.FAMS_DAILY_REVIEW_ASSET_TIMEOUT_MS || 45_000))
    const trendResults = await Promise.allSettled(investablePositions.map((position) => withTimeout(
      assetTrendService.getSnapshot({ assetId: position.assetId, days: 30, persist: true }),
      assetTimeoutMs,
      `daily_review_trend_timeout:${position.asset.symbol}`,
    )))
    const trendByAsset = new Map<string, AssetTrendSnapshot>()
    const trendErrorByAsset = new Map<string, Error>()
    trendResults.forEach((result, index) => {
      const position = investablePositions[index]
      if (result.status === 'fulfilled') trendByAsset.set(position.assetId, result.value)
      else trendErrorByAsset.set(position.assetId, result.reason instanceof Error ? result.reason : new Error(String(result.reason)))
    })
    const cashBudget = positions.filter((position) => position.asset.type === 'cash')
      .reduce((sum, position) => sum + (position.marketValue ?? position.quantity * (position.currentPrice || 1)), 0)
    const totalValue = positions.reduce((sum, position) => {
      if (position.asset.type === 'cash') return sum + (position.marketValue ?? position.quantity * (position.currentPrice || 1))
      const liveTrend = trendByAsset.get(position.assetId)
      return sum + (liveTrend
        ? position.quantity * liveTrend.quote.price
        : (position.marketValue ?? position.quantity * (position.currentPrice || position.avgCost)))
    }, 0)
    const portfolioPricing = {
      basis: 'review_quote_price',
      livePricedAssets: investablePositions.filter((position) => trendByAsset.has(position.assetId)).map((position) => position.asset.symbol),
      fallbackPricedAssets: investablePositions.filter((position) => !trendByAsset.has(position.assetId)).map((position) => position.asset.symbol),
      cashBasis: 'open_cash_position_market_value',
    }
    const gridConfigFor = (position: (typeof positions)[number]) => {
      const applicable = activeConfigs.find((item) => item.config.applicableAssetTypes.includes(gridAssetType(position.asset.type) as any)) || null
      return applicable?.config || fallbackGridConfig(position.asset.type)
    }
    const portfolioCashFloorPercent = investablePositions.length > 0
      ? Math.max(...investablePositions.map((position) => gridConfigFor(position).riskPolicy.cashFloorPercent))
      : 0
    const initialImmediateBuyBudget = Math.max(0, cashBudget - totalValue * portfolioCashFloorPercent / 100)
    let remainingImmediateBuyBudget = initialImmediateBuyBudget
    const errors: Array<{ assetId: string; symbol: string; message: string }> = []
    const assetReviews: any[] = []

    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[index]
      if (position.asset.type === 'cash') continue
      try {
        const trend = trendByAsset.get(position.assetId)
        if (!trend) throw trendErrorByAsset.get(position.assetId) || new Error(`daily_review_trend_unavailable:${position.asset.symbol}`)
        let positionAdvice: PositionAdviceResult
        let externalOrders: any[]
        let valueAssessment: ValueAssessmentFactSet | null
        let evidenceMode: 'current_factset' | 'cached_degraded_after_timeout' = 'current_factset'
        let evidenceWarning: string | null = null
        try {
          [positionAdvice, externalOrders, valueAssessment] = await withTimeout(Promise.all([
            positionAdviceService.getPositionAdvice(position.id, {
              useCache: false,
              externalAnalysisMode: process.env.FAMS_DAILY_REVIEW_EXTERNAL_ANALYSIS_MODE === 'live' ? 'live' : 'cached',
            }),
            prisma.externalOrderObservation.findMany({
              where: { userId: review.userId, assetId: position.assetId, status: { in: ['pending', 'submitted', 'partial', 'open'] } },
              orderBy: { observedAt: 'desc' },
              take: 20,
            }),
            valueAssessmentService.assessPosition(position).catch(() => null),
          ]), assetTimeoutMs, `daily_review_asset_timeout:${position.asset.symbol}`)
        } catch (primaryError) {
          evidenceMode = 'cached_degraded_after_timeout'
          evidenceWarning = primaryError instanceof Error ? primaryError.message : String(primaryError)
          ;[positionAdvice, externalOrders, valueAssessment] = await withTimeout(Promise.all([
            positionAdviceService.getPositionAdvice(position.id, {
              useCache: true,
              externalAnalysisMode: 'cached',
              skipBackgroundRefresh: true,
            }),
            prisma.externalOrderObservation.findMany({
              where: { userId: review.userId, assetId: position.assetId, status: { in: ['pending', 'submitted', 'partial', 'open'] } },
              orderBy: { observedAt: 'desc' },
              take: 20,
            }),
            withTimeout(valueAssessmentService.assessPosition(position), 8_000, `daily_review_value_timeout:${position.asset.symbol}`).catch(() => null),
          ]), 12_000, `daily_review_cached_fallback_timeout:${position.asset.symbol}`)
        }
        const previousAsset = (previousReport.assets || []).find((item: any) => item.assetId === position.assetId)
        const materialChange = classifyMaterialChange(positionAdvice, previousAsset, valueAssessment)
        const valueContext = valuationContext(valueAssessment, position.asset.type)
        const applicable = activeConfigs.find((item) => item.config.applicableAssetTypes.includes(gridAssetType(position.asset.type) as any)) || null
        const config: GridStrategyConfig = applicable?.config || fallbackGridConfig(position.asset.type)
        const strategySource = applicable ? 'active_validated_strategy' : config.mode === 'observe_only' ? 'observe_only_fallback' : 'system_research_fallback'
        const indicators = positionAdvice.factSet.technical.indicators || {}
        const support = positionAdvice.factSet.technical.supportResistance.support[0] || null
        const resistance = positionAdvice.factSet.technical.supportResistance.resistance[0] || null
        const marketConfidence = Math.max(
          positionAdvice.factSet.market.confidence,
          trend.quote.fallbackUsed ? 0.4 : trend.dataQuality.status === 'ok' ? 0.8 : 0.6,
        )
        const gridDraft = gridStrategyService.buildGridDraft({
          config,
          assetType: gridAssetType(position.asset.type),
          market: gridMarket(position.asset.exchange),
          currentPrice: trend.quote.price,
          avgCost: position.avgCost,
          quantity: position.quantity,
          cashBudget,
          availablePortfolioBuyBudget: remainingImmediateBuyBudget,
          portfolioValue: totalValue,
          currentMarketValue: position.quantity * trend.quote.price,
          completedBars: trend.indicators.sampleCount,
          confidence: marketConfidence,
          materialChange: materialChange.level,
          valuationStatus: valueContext.status,
          valuationConclusion: valueContext.conclusion,
          ma5: trend.indicators.ma5,
          ma10: trend.indicators.ma10,
          ma30: trend.indicators.ma30,
          atr14: finite((indicators as any).atr14 ?? (indicators as any).atr),
          support,
          resistance,
          externalOrders: externalOrders.map((order) => ({ side: order.side, price: order.limitPrice, status: order.status })),
          now: startedAt,
        })
        const previousPlan = await prisma.gridPlan.findFirst({
          where: { userId: review.userId, assetId: position.assetId, mode: { not: 'conditional_buyback' } },
          include: { orders: { orderBy: [{ side: 'asc' }, { level: 'asc' }] } },
          orderBy: { createdAt: 'desc' },
        })
        const change = gridChange(previousPlan, gridDraft)
        const validUntil = gridDraft.constraints.validUntil ? new Date(gridDraft.constraints.validUntil) : null
        const gridPlan = await prisma.gridPlan.create({
          data: {
            userId: review.userId,
            dailyReviewRunId: review.id,
            assetId: position.assetId,
            strategyVersionId: applicable?.version.id || null,
            previousPlanId: previousPlan?.id || null,
            mode: gridDraft.mode,
            status: gridDraft.orders.length > 0 ? 'draft' : 'observe_only',
            summary: gridDraft.summary,
            constraintsJson: JSON.stringify({
              ...gridDraft.constraints,
              derivation: gridDraft.derivation,
              sideBlockers: gridDraft.sideBlockers,
            }),
            changeReasonsJson: JSON.stringify(change.reasons),
            evidenceRefsJson: JSON.stringify(materialChange.evidenceRefs),
            validUntil,
            orders: {
              create: gridDraft.orders.map((order: any) => ({
                side: order.side,
                level: order.level,
                price: order.price,
                quantity: order.quantity,
                amount: order.amount,
                validUntil: order.validUntil ? new Date(order.validUntil) : validUntil,
                triggerConditionJson: JSON.stringify(order.triggerCondition || {}),
                rationale: order.rationale,
                conflictStatus: order.conflictStatus || 'none',
                evidenceRefsJson: JSON.stringify(materialChange.evidenceRefs),
              })),
            },
          },
          include: { orders: true },
        })
        const immediateBuyAmount = gridPlan.orders
          .filter((order) => order.side === 'buy')
          .reduce((sum, order) => sum + order.amount, 0)
        remainingImmediateBuyBudget = Math.max(0, remainingImmediateBuyBudget - immediateBuyAmount)

        const previousBuybackPlan = await prisma.gridPlan.findFirst({
          where: { userId: review.userId, assetId: position.assetId, mode: 'conditional_buyback' },
          include: { orders: { orderBy: [{ side: 'asc' }, { level: 'asc' }] } },
          orderBy: { createdAt: 'desc' },
        })
        const buybackDraft = gridStrategyService.buildConditionalBuybackDraft({
          parentGridPlanId: gridPlan.id,
          parentSellOrders: gridPlan.orders
            .filter((order) => order.side === 'sell')
            .map((order) => ({ id: order.id, level: order.level, price: order.price, quantity: order.quantity, validUntil: order.validUntil })),
          spacingAbsolute: Number((gridDraft.derivation as any).spacing?.absoluteAmount || 0),
          assetType: gridAssetType(position.asset.type),
          market: gridMarket(position.asset.exchange),
          now: startedAt,
        })
        const buybackChange = gridChange(previousBuybackPlan, buybackDraft)
        const buybackValidUntil = buybackDraft.constraints.validUntil ? new Date(buybackDraft.constraints.validUntil) : null
        const buybackPlan = await prisma.gridPlan.create({
          data: {
            userId: review.userId,
            dailyReviewRunId: review.id,
            assetId: position.assetId,
            strategyVersionId: applicable?.version.id || null,
            previousPlanId: previousBuybackPlan?.id || null,
            mode: buybackDraft.mode,
            status: buybackDraft.status,
            summary: buybackDraft.summary,
            constraintsJson: JSON.stringify({ ...buybackDraft.constraints, derivation: buybackDraft.derivation }),
            changeReasonsJson: JSON.stringify(buybackChange.reasons),
            evidenceRefsJson: JSON.stringify(materialChange.evidenceRefs),
            validUntil: buybackValidUntil,
            orders: {
              create: buybackDraft.orders.map((order) => ({
                side: order.side,
                level: order.level,
                price: order.price,
                quantity: order.quantity,
                amount: order.amount,
                validUntil: new Date(order.validUntil),
                triggerConditionJson: JSON.stringify(order.triggerCondition),
                rationale: order.rationale,
                conflictStatus: order.conflictStatus,
                evidenceRefsJson: JSON.stringify(materialChange.evidenceRefs),
                status: order.status,
              })),
            },
          },
          include: { orders: true },
        })
        const marketValue = position.quantity * trend.quote.price
        await prisma.$transaction([
          prisma.marketSnapshot.create({
            data: {
              assetId: position.assetId,
              dailyReviewRunId: review.id,
              capturedAt: startedAt,
              price: trend.quote.price,
              currency: trend.currency,
              source: trend.quote.source,
              confidenceScore: marketConfidence,
              dayChangePct: trend.quote.changePercent,
              technicalJson: JSON.stringify({ indicators: trend.indicators, chart: trend.chart, warnings: trend.warnings }),
              valuationJson: JSON.stringify(positionAdvice.factSet.fundamental || {}),
            },
          }),
          prisma.positionSnapshot.create({
            data: {
              userId: review.userId,
              positionId: position.id,
              assetId: position.assetId,
              dailyReviewRunId: review.id,
              capturedAt: startedAt,
              quantity: position.quantity,
              avgCost: position.avgCost,
              currentPrice: trend.quote.price,
              marketValue,
              costBasis: position.quantity * position.avgCost,
              actualWeightPct: totalValue > 0 ? marketValue / totalValue * 100 : null,
            },
          }),
        ])
        assetReviews.push({
          assetId: position.assetId,
          symbol: position.asset.symbol,
          name: position.asset.name,
          position: { quantity: position.quantity, avgCost: position.avgCost, marketValue, weightPct: totalValue > 0 ? marketValue / totalValue * 100 : null },
          trend,
          marketConfidence,
          recommendation: positionAdvice.advice,
          evidenceMode,
          evidenceWarnings: evidenceWarning ? [evidenceWarning] : [],
          fundamentalAndNews: materialChange,
          valuationContext: valueContext,
          grid: {
            id: gridPlan.id,
            strategyVersionId: applicable?.version.id || null,
            strategySource,
            templateId: config.templateId,
            mode: gridPlan.mode,
            status: gridPlan.status,
            summary: gridPlan.summary,
            orders: gridPlan.orders,
            constraints: gridDraft.constraints,
            derivation: gridDraft.derivation,
            sideBlockers: gridDraft.sideBlockers,
            blockers: gridDraft.blockers,
            adjustment: change,
          },
          buybackGrid: {
            id: buybackPlan.id,
            parentGridPlanId: gridPlan.id,
            strategyVersionId: applicable?.version.id || null,
            strategySource,
            templateId: config.templateId,
            mode: buybackPlan.mode,
            status: buybackPlan.status,
            summary: buybackPlan.summary,
            orders: buybackPlan.orders,
            constraints: buybackDraft.constraints,
            derivation: buybackDraft.derivation,
            blockers: buybackDraft.blockers,
            adjustment: buybackChange,
          },
        })
      } catch (error) {
        errors.push({ assetId: position.assetId, symbol: position.asset.symbol, message: error instanceof Error ? error.message : String(error) })
      }
      if (review.operationId) {
        const progress = positions.length > 0 ? Math.min(85, 10 + Math.round((index + 1) / positions.length * 70)) : 85
        await prisma.operation.update({ where: { id: review.operationId }, data: { progressPct: progress, progressMessage: `已分析 ${index + 1}/${positions.length} 个持仓` } })
      }
    }

    const latestPoolDate = await prisma.dividendLowVolDaily.findFirst({
      where: { userId: review.userId },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    const poolCandidates = latestPoolDate ? await prisma.dividendLowVolDaily.findMany({
      where: { userId: review.userId, tradeDate: latestPoolDate.tradeDate },
      orderBy: { evidenceAdjustedScore: 'desc' },
      take: 5,
    }) : []
    const candidates = [
      ...assetReviews.map((item) => ({
        symbol: item.symbol,
        name: item.name,
        source: 'holding',
        action: item.recommendation.action,
        confidence: item.recommendation.confidence,
        reason: item.fundamentalAndNews.level === 'material'
          ? '基本面或消息面达到重大变化复核阈值'
          : item.fundamentalAndNews.level === 'insufficient'
            ? '基本面或消息面证据不足'
            : item.grid.blockers.length > 0
              ? `网格受限：${item.grid.blockers.join('、')}`
              : '当前持仓例行关注',
        evidenceStatus: item.fundamentalAndNews.evidenceRefs.length > 0
          ? item.fundamentalAndNews.level === 'insufficient' ? 'partial' : 'available'
          : 'insufficient',
        evidenceRefs: item.fundamentalAndNews.evidenceRefs,
      })),
      ...poolCandidates.filter((candidate) => !assetReviews.some((item) => item.symbol === candidate.symbol)).map((candidate) => ({
        evidenceRefs: parseJson<string[]>(candidate.evidenceRefsJson, []),
        blockedReasons: parseJson<string[]>(candidate.blockedReasonsJson, []),
        dataGaps: parseJson<string[]>(candidate.dataGapSummaryJson, []),
        symbol: candidate.symbol,
        name: candidate.name,
        source: 'dividend_low_vol_candidate_pool',
        disposition: candidate.disposition,
        evidenceAdjustedScore: candidate.evidenceAdjustedScore,
        reason: `红利低波候选池：${candidate.disposition}`,
        evidenceStatus: parseJson<string[]>(candidate.evidenceRefsJson, []).length === 0
          ? 'insufficient'
          : parseJson<string[]>(candidate.dataGapSummaryJson, []).length > 0 ? 'partial' : 'available',
      })),
    ].slice(0, Math.max(5, assetReviews.length))
    const materialAssets = assetReviews.filter((item) => item.fundamentalAndNews.level === 'material')
    const insufficientAssets = assetReviews.filter((item) => item.fundamentalAndNews.level === 'insufficient')
    const strategyAssessment = materialAssets.length > 0
      ? {
          status: 'needs_review',
          conclusion: `${materialAssets.length} 个持仓出现重大事实变化，原策略需要人工复核。`,
          reasons: materialAssets.map((item) => `${item.symbol}：${item.fundamentalAndNews.reasons.join('；')}`),
        }
      : insufficientAssets.length > 0
        ? {
            status: 'evidence_insufficient',
            conclusion: `${insufficientAssets.length} 个持仓证据不足，暂不据此调整原策略。`,
            reasons: insufficientAssets.map((item) => `${item.symbol}：基本面或消息面证据不足`),
          }
        : {
            status: 'maintain',
            conclusion: '未识别出足以改变原策略的重大事实，继续按现有研究计划观察。',
            reasons: ['本轮事实变化未达到重大变化阈值。'],
          }
    const deterministicStatus = errors.length === 0 ? 'completed' : assetReviews.length > 0 ? 'partial' : 'failed'
    const decisionSummary = buildDecisionSummary(assetReviews, strategyAssessment)
    if (review.operationId) {
      await prisma.operation.update({
        where: { id: review.operationId },
        data: { progressPct: 90, progressMessage: '正在生成一次性证据汇总' },
      })
    }
    const llmSynthesis = await dailyReviewSynthesisService.synthesize({
      strategyAssessment,
      decisionSummary,
      attentionCandidates: candidates,
      assets: assetReviews,
    })
    const llmGate = {
      required: requireLlmSuccess,
      passed: llmSynthesis.status === 'available',
      status: llmSynthesis.status,
      source: llmSynthesis.source,
      attemptCount: llmSynthesis.attemptCount,
      failureCode: llmSynthesis.failureCode,
    }
    const llmRequiredFailure = requireLlmSuccess && !llmGate.passed
    const status = llmRequiredFailure ? 'failed' : deterministicStatus
    const completedAt = new Date()
    const report = {
      schemaVersion: 'fams.daily-portfolio-review.v2',
      reviewId: review.id,
      generatedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      sessionType: review.sessionType,
      triggerSource: review.triggerSource,
      portfolio: {
        totalValue,
        cashBudget,
        positions: positions.length,
        reviewedAssets: assetReviews.length,
        pricing: portfolioPricing,
        immediateBuyBudget: {
          cashFloorPercent: portfolioCashFloorPercent,
          initial: Number(initialImmediateBuyBudget.toFixed(2)),
          used: Number((initialImmediateBuyBudget - remainingImmediateBuyBudget).toFixed(2)),
          remaining: Number(remainingImmediateBuyBudget.toFixed(2)),
          conditionalBuybackExcludedUntilParentFill: true,
        },
      },
      strategy: {
        activeStrategyVersionIds: activeConfigs.map((item) => item.version.id),
        fallback: activeConfigs.length === 0 ? ['mean_reversion_atr_v1', 'cost_support_v1'] : null,
        assessment: strategyAssessment,
      },
      assets: assetReviews,
      attentionCandidates: candidates,
      decisionSummary,
      llmSynthesis,
      llmGate,
      errors,
      executionBoundary: {
        planDraftOnly: true,
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        canCreateOrder: false,
        orderCreateAllowed: false,
      },
      disclaimer: '本结果是研究与人工计划草案，不构成投资建议，不会向券商创建或提交订单。',
    }
    const adviceInput = await prisma.adviceInputSnapshot.create({
      data: {
        userId: review.userId,
        capturedAt: startedAt,
        portfolioSnapshotJson: JSON.stringify(report.portfolio),
        positionSnapshotJson: JSON.stringify(assetReviews.map((item) => item.position)),
        marketSnapshotJson: JSON.stringify(assetReviews.map((item) => ({ assetId: item.assetId, trend: item.trend }))),
        constraintsJson: JSON.stringify(report.executionBoundary),
        promptVersion: 'daily-portfolio-review.v2',
      },
    })
    const advice = await prisma.advice.create({
      data: {
        userId: review.userId,
        adviceInputSnapshotId: adviceInput.id,
        generatedAt: startedAt,
        schemaVersion: 'daily-portfolio-review.v2',
        summaryText: `${review.sessionType === 'open' ? '开盘后' : review.sessionType === 'pre_close' ? '收盘前' : '手动'}复盘：完成 ${assetReviews.length}/${positions.filter((item) => item.asset.type !== 'cash').length} 个资产分析。`,
        disclaimerText: report.disclaimer,
        inputSnapshotJson: JSON.stringify({ reviewId: review.id, previousRunId: review.previousRunId }),
        recommendationJson: JSON.stringify({ assets: assetReviews.map((item) => ({ assetId: item.assetId, recommendation: item.recommendation, grid: item.grid, buybackGrid: item.buybackGrid })), candidates }),
        rationaleText: '基于当前持仓、最近30个完整交易日收盘价、MA5/MA10/MA30、已有基本面与消息面证据及已激活策略版本生成。',
        status: 'proposed',
      },
    })
    await prisma.alert.create({
      data: {
        userId: review.userId,
        type: 'daily_review',
        title: `${review.sessionType === 'open' ? '开盘后' : review.sessionType === 'pre_close' ? '收盘前' : '手动'}持仓复盘已生成`,
        message: llmRequiredFailure
          ? `确定性复盘已保存，但要求的真实 LLM 汇总未通过：${llmSynthesis.failureCode || llmSynthesis.status}。`
          : status === 'completed' ? `已完成 ${assetReviews.length} 个持仓资产复盘。` : `复盘状态为 ${status}，${errors.length} 个资产需要补充数据。`,
        severity: status === 'completed' ? 'info' : 'warning',
        triggeredAt: completedAt,
      },
    })
    await prisma.$transaction([
      prisma.dailyReviewRun.update({
        where: { id: review.id },
        data: {
          adviceId: advice.id,
          status,
          completedAt,
          strategyVersionIdsJson: JSON.stringify(activeConfigs.map((item) => item.version.id)),
          reportJson: JSON.stringify(report),
          dataQualityJson: JSON.stringify({ status, deterministicStatus, reviewedAssets: assetReviews.length, failedAssets: errors.length, errors, llmGate }),
        },
      }),
      ...(review.operationId ? [prisma.operation.update({
        where: { id: review.operationId },
        data: {
          status,
          completedAt,
          progressPct: 100,
          progressCurrent: assetReviews.length,
          progressTotal: positions.filter((item) => item.asset.type !== 'cash').length,
          progressMessage: llmRequiredFailure
            ? '确定性复盘已保存，但要求的真实 LLM 汇总未通过'
            : status === 'completed' ? '每日持仓复盘已完成' : `复盘完成，但有 ${errors.length} 个资产数据不足`,
          resultJson: JSON.stringify({ reviewId: review.id, adviceId: advice.id, status, attentionCandidates: candidates, llmGate }),
          errorJson: JSON.stringify({ assetErrors: errors, llmGate }),
          errorSummary: llmRequiredFailure
            ? `要求的真实 LLM 汇总未通过：${llmSynthesis.failureCode || llmSynthesis.status}`
            : errors.length > 0 ? errors.map((item) => `${item.symbol}: ${item.message}`).join('; ') : null,
        },
      })] : []),
    ])
    return this.getReview(review.id, review.userId)
  }

  async getReview(reviewId: string, expectedUserId?: string) {
    const review = await prisma.dailyReviewRun.findUnique({
      where: { id: reviewId },
      include: {
        operation: true,
        advice: true,
        gridPlans: { include: { asset: true, orders: { orderBy: [{ side: 'asc' }, { level: 'asc' }] } } },
      },
    })
    if (!review) throw new Error('Daily review run not found')
    if (expectedUserId && review.userId !== expectedUserId) throw new Error('Daily review does not belong to the requested user')
    return {
      ...review,
      report: parseJson(review.reportJson, {}),
      dataQuality: parseJson(review.dataQualityJson, {}),
      strategyVersionIds: parseJson(review.strategyVersionIdsJson, []),
    }
  }

  async getLatest(userId: string, sessionType?: DailyReviewSession) {
    const review = await prisma.dailyReviewRun.findFirst({
      where: { userId, ...(sessionType ? { sessionType } : {}) },
      orderBy: { generatedAt: 'desc' },
      select: { id: true },
    })
    return review ? this.getReview(review.id, userId) : null
  }

  async listReviews(input: {
    userId: string
    sessionType?: DailyReviewSession
    status?: string
    cursor?: string
    limit?: number
  }) {
    const limit = Math.min(50, Math.max(1, Math.floor(input.limit || 20)))
    const rows = await prisma.dailyReviewRun.findMany({
      where: {
        userId: input.userId,
        ...(input.sessionType ? { sessionType: input.sessionType } : {}),
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: [{ generatedAt: 'desc' }, { id: 'desc' }],
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      take: limit + 1,
      include: { _count: { select: { gridPlans: true, marketSnapshots: true, positionSnapshots: true } } },
    })
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit).map((review) => {
      const report = parseJson<any>(review.reportJson, {})
      const dataQuality = parseJson<any>(review.dataQualityJson, {})
      return {
        id: review.id,
        operationId: review.operationId,
        previousRunId: review.previousRunId,
        sessionType: review.sessionType,
        triggerSource: review.triggerSource,
        status: review.status,
        generatedAt: review.generatedAt,
        completedAt: review.completedAt,
        portfolio: report.portfolio || null,
        strategyAssessment: report.strategy?.assessment || null,
        dataQuality,
        counts: review._count,
      }
    })
    return {
      schemaVersion: 'fams.daily-portfolio-review-list.v1',
      items,
      nextCursor: hasMore ? items.at(-1)?.id || null : null,
      hasMore,
    }
  }

  private async markReviewFailed(reviewId: string, error: unknown) {
    const review = await prisma.dailyReviewRun.findUnique({ where: { id: reviewId }, select: { operationId: true } })
    if (!review) return null
    const completedAt = new Date()
    const message = error instanceof Error ? error.message : String(error)
    await prisma.$transaction([
      prisma.dailyReviewRun.update({
        where: { id: reviewId },
        data: { status: 'failed', completedAt, dataQualityJson: JSON.stringify({ status: 'failed', error: message }) },
      }),
      ...(review.operationId ? [prisma.operation.update({
        where: { id: review.operationId },
        data: {
          status: 'failed',
          completedAt,
          progressPct: 100,
          progressMessage: '每日持仓复盘失败',
          errorSummary: message,
          errorJson: JSON.stringify({ message }),
        },
      })] : []),
    ])
    return null
  }

  async recoverInterruptedReviews() {
    const reviews = await prisma.dailyReviewRun.findMany({
      where: { status: { in: ['queued', 'running'] } },
      orderBy: { createdAt: 'asc' },
      take: 10,
      select: { id: true, operationId: true, status: true },
    })
    for (const review of reviews) queueMicrotask(() => { void this.executeReview(review.id).catch((error) => this.markReviewFailed(review.id, error)) })
    return { recoveredCount: reviews.length, reviewIds: reviews.map((review) => review.id), operationIds: reviews.flatMap((review) => review.operationId ? [review.operationId] : []) }
  }
}

export const dailyReviewService = new DailyReviewService()
