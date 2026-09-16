import assert from 'node:assert/strict'
import { unlink } from 'node:fs/promises'
import { prisma } from '../src/db/prisma.js'
import { gridStrategyService } from '../src/services/strategy/gridStrategyService.js'
import { screenshotCaptureService } from '../src/services/capture/screenshotCaptureService.js'
import { dailyReviewService } from '../src/services/review/dailyReviewService.js'
import { assetTrendService } from '../src/services/market-data/assetTrendService.js'
import { positionAdviceService } from '../src/services/position/positionAdviceService.js'
import { valueAssessmentService } from '../src/services/valuation/valueAssessmentService.js'
import { famsChatService } from '../src/services/chat/famsChatService.js'
import { callMcpTool } from '../src/mcp/registry.js'
import { resolveDailyReviewScheduleSlot } from '../src/services/review/dailyReviewScheduler.js'
import { getVisionCaptureStatus } from '../src/services/capture/visionCaptureService.js'

process.env.FAMS_DAILY_REVIEW_LLM_ENABLED = '0'

const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`
const userId = `daily-review-test-${suffix}`
const primarySymbol = `T${suffix.slice(-8)}`
const missingSymbol = `M${suffix.slice(-8)}`
let capturePath: string | undefined
let strategyId: string | undefined
const originalTrend = assetTrendService.getSnapshot.bind(assetTrendService)
const originalAdvice = positionAdviceService.getPositionAdvice.bind(positionAdviceService)
const originalValueAssessment = valueAssessmentService.assessPosition.bind(valueAssessmentService)

try {
  assert.equal(resolveDailyReviewScheduleSlot(new Date('2026-08-20T01:30:00.000Z')).sessionType, 'open')
  assert.equal(resolveDailyReviewScheduleSlot(new Date('2026-08-20T06:30:00.000Z')).sessionType, 'pre_close')
  assert.equal(resolveDailyReviewScheduleSlot(new Date('2026-08-22T01:30:00.000Z')).sessionType, null)
  await prisma.user.create({
    data: { id: userId, email: `${userId}@local.test`, passwordHash: 'test-only', name: 'Daily review workflow test' },
  })
  const primaryAsset = await prisma.asset.create({ data: { symbol: primarySymbol, name: '复盘测试资产', type: 'stock', exchange: 'SH' } })
  const missingAsset = await prisma.asset.create({ data: { symbol: missingSymbol, name: '截图未覆盖资产', type: 'stock', exchange: 'SZ' } })
  const position = await prisma.position.create({
    data: {
      userId,
      assetId: primaryAsset.id,
      openKey: `${userId}:${primaryAsset.id}`,
      quantity: 1000,
      avgCost: 10,
      currentPrice: 11,
      marketValue: 11_000,
      costBasis: 10_000,
      unrealizedPnl: 1_000,
      tags: JSON.stringify(['账户:同花顺']),
    },
  })
  const missingPosition = await prisma.position.create({
    data: {
      userId,
      assetId: missingAsset.id,
      openKey: `${userId}:${missingAsset.id}`,
      quantity: 500,
      avgCost: 20,
      currentPrice: 21,
      marketValue: 10_500,
      costBasis: 10_000,
      unrealizedPnl: 500,
      tags: JSON.stringify(['账户:同花顺']),
    },
  })

  const config = gridStrategyService.getTemplate('mean_reversion_atr_v1')
  const grid = gridStrategyService.buildGridDraft({
    config,
    assetType: 'stock',
    currentPrice: 11,
    avgCost: 10,
    quantity: 1000,
    cashBudget: 50_000,
    portfolioValue: 200_000,
    currentMarketValue: 11_000,
    completedBars: 80,
    confidence: 0.9,
    materialChange: 'none',
    ma5: 10.9,
    ma10: 10.5,
    ma30: 10,
    atr14: 0.3,
    now: new Date('2026-08-25T02:30:00.000Z'),
  })
  assert.equal(grid.mode, 'mean_reversion')
  assert.ok(grid.orders.some((order) => order.side === 'buy'))
  assert.ok(grid.orders.some((order) => order.side === 'sell'))
  assert.equal(grid.constraints.notTradingAdvice, true)
  const subLotGrid = gridStrategyService.buildGridDraft({
    config,
    assetType: 'stock',
    currentPrice: 11,
    avgCost: 10,
    quantity: 100,
    cashBudget: 0,
    portfolioValue: 200_000,
    currentMarketValue: 1_100,
    completedBars: 80,
    confidence: 0.9,
    materialChange: 'none',
    ma5: 10.9,
    ma10: 10.5,
    ma30: 10,
    atr14: 0.3,
    now: new Date('2026-08-25T02:30:00.000Z'),
  })
  assert.equal(subLotGrid.mode, 'observe_only')
  assert.ok(subLotGrid.blockers.includes('order_size_below_minimum_lot_or_available_budget'))
  assert.ok(subLotGrid.sideBlockers.buy.includes('buy_budget_or_weight_capacity_exhausted'))
  assert.ok(subLotGrid.sideBlockers.sell.includes('sell_quantity_below_minimum_lot'))
  const strategyDraft = await gridStrategyService.createDraft({ userId, templateId: 'mean_reversion_atr_v1', name: '工作流验证网格' })
  assert.equal(strategyDraft.status, 'draft')
  strategyId = strategyDraft.strategy?.id
  const strategyValidation = await gridStrategyService.validateDraft(strategyDraft.version!.id, userId)
  assert.equal(strategyValidation.status, 'blocked')
  const activationWithoutEvidence = await gridStrategyService.activate(strategyDraft.version!.id, { confirmed: true, confirmedBy: 'workflow-test' }, userId)
  assert.equal(activationWithoutEvidence.status, 'blocked')

  const dates = Array.from({ length: 30 }, (_, index) => {
    const date = new Date('2026-06-01T00:00:00.000Z')
    date.setUTCDate(date.getUTCDate() + index)
    const close = 10 + index * 0.03
    return { date: date.toISOString().slice(0, 10), close, ma5: index >= 4 ? close - 0.06 : null, ma10: index >= 9 ? close - 0.135 : null, ma30: index === 29 ? 10.435 : null }
  })
  assetTrendService.getSnapshot = (async () => ({
    schemaVersion: 'asset.market-trend.v1',
    assetId: primaryAsset.id,
    assetType: 'stock',
    symbol: primarySymbol,
    name: primaryAsset.name,
    currency: 'CNY',
    generatedAt: new Date().toISOString(),
    quote: { price: 11, change: 0.1, changePercent: 0.92, asOf: new Date().toISOString(), source: 'workflow_test', sessionStatus: 'intraday', fallbackUsed: false },
    latestClose: { date: dates.at(-1)!.date, price: dates.at(-1)!.close, source: 'workflow_test' },
    indicators: { ma5: 10.81, ma10: 10.74, ma30: 10.435, asOf: dates.at(-1)!.date, sampleCount: 80, trend: 'bullish', calculationMethod: 'simple_moving_average_completed_daily_close' },
    requestedTradingDays: 30,
    recentCloses: dates.map((item) => ({ date: item.date, close: item.close, source: 'workflow_test' })),
    history: dates.map((item) => ({ date: item.date, open: item.close, high: item.close, low: item.close, close: item.close, volume: 1000, source: 'workflow_test' })),
    historySource: 'workflow_test',
    warnings: [],
    chart: dates,
    dataQuality: { status: 'ok', persistedHistory: true, completedBarCount: 80, warnings: [] },
  })) as typeof assetTrendService.getSnapshot
  positionAdviceService.getPositionAdvice = (async () => ({
    factSet: {
      schemaVersion: 'position.advice.factset.v1',
      generatedAt: new Date().toISOString(),
      portfolio: { totalMarketValue: 21_500, cashRatio: 0, stockRatio: 1, fundRatio: 0, goldRatio: 0, maxSinglePositionRatio: 0.52, targetCashRatio: 0.1, riskProfile: 'balanced' },
      position: { positionId: position.id, assetId: primaryAsset.id, symbol: primarySymbol, name: primaryAsset.name, assetType: 'stock', marketValue: 11_000, currentWeight: 0.51, currentWeightPct: 51, costBasis: 10_000, currentPrice: 11, unrealizedPnl: 1_000, unrealizedPnlPct: 10 },
      market: { price: 11, priceTime: new Date().toISOString(), provider: 'workflow_test', confidence: 0.9, fallbackUsed: false, warnings: [] },
      technical: { trendScore: 70, momentumScore: 65, relativeStrengthScore: 60, volatilityScore: 50, liquidityScore: 80, supportResistance: { support: [10.3], resistance: [11.8] }, indicators: { atr14: 0.3 }, warnings: [] },
      fundamental: { valuationScore: 60, qualityScore: 70, growthScore: 55, financialRiskScore: 20, warnings: [] },
      news: { sentimentScore: 5, eventRiskScore: 10, recentEvents: [] },
      strategyEvidence: { matchedStrategies: [], backtestSummary: [] },
      blockedReasons: [],
      evidenceRefs: ['workflow-test:evidence'],
    },
    advice: { action: 'HOLD', currentWeight: 0.51, targetWeightRange: [0.45, 0.55], confidence: 'medium', reasons: ['workflow test'], risks: [], triggerConditions: [], invalidationConditions: [], evidenceRefs: ['workflow-test:evidence'], blockedReasons: [] },
  })) as typeof positionAdviceService.getPositionAdvice
  valueAssessmentService.assessPosition = (async (reviewPosition) => ({
    schemaVersion: 'value.assessment.factset.v1',
    generatedAt: new Date().toISOString(),
    asset: {
      assetId: reviewPosition.asset.id,
      symbol: reviewPosition.asset.symbol,
      name: reviewPosition.asset.name,
      assetType: reviewPosition.asset.type,
      market: reviewPosition.asset.exchange || 'SH',
    },
    market: {
      currentPrice: Number(reviewPosition.currentPrice || reviewPosition.asset.lastPrice || 11),
      marketValue: Number(reviewPosition.marketValue || 0),
      costBasis: Number(reviewPosition.costBasis || 0),
      provider: 'workflow_test',
      asOf: new Date().toISOString(),
    },
    valuation: {
      status: 'available',
      conclusion: 'risk_review',
      valuationScore: 60,
      qualityScore: 70,
      growthScore: 55,
      financialRiskScore: 20,
      compositeScore: 55,
      confidence: 'medium',
      targetWeightMultiplier: 0.8,
      valuationBand: 'fair',
      method: 'workflow_test',
      reasons: ['workflow test valuation'],
      risks: ['workflow test financial risk'],
      blockedReasons: [],
      warnings: [],
    },
    facts: [],
    evidenceRefs: [`workflow-test:valuation:${reviewPosition.asset.symbol}`],
    providerTrace: { provider: 'workflow_test' },
  })) as typeof valueAssessmentService.assessPosition

  const reviewResult = await dailyReviewService.startReview({ userId, sessionType: 'manual', triggerSource: 'user', executionMode: 'inline', idempotencyKey: `${userId}:manual:test` })
  assert.equal(reviewResult.review?.status, 'completed')
  const reusedReview = await dailyReviewService.startReview({ userId, sessionType: 'manual', triggerSource: 'user', executionMode: 'inline', idempotencyKey: `${userId}:manual:test` })
  assert.equal(reusedReview.reused, true)
  assert.equal(reusedReview.review?.id, reviewResult.review?.id)
  const review = await dailyReviewService.getReview(reviewResult.review!.id, userId)
  const report = review.report as any
  assert.equal(report.schemaVersion, 'fams.daily-portfolio-review.v2')
  assert.equal(report.assets.length, 2)
  assert.equal(report.assets.find((item: any) => item.assetId === primaryAsset.id).trend.chart.length, 30)
  assert.equal(report.assets.find((item: any) => item.assetId === primaryAsset.id).grid.strategySource, 'system_research_fallback')
  assert.equal(report.strategy.assessment.status, 'needs_review')
  assert.equal(report.decisionSummary.schemaVersion, 'fams.daily-review-decision-summary.v1')
  assert.equal(report.llmSynthesis.source, 'deterministic')
  assert.equal(report.llmSynthesis.attemptCount, 0)
  assert.equal(report.assets.find((item: any) => item.assetId === primaryAsset.id).grid.derivation.schemaVersion, 'fams.grid-derivation.v1')
  assert.equal(report.executionBoundary.canCreateOrder, false)
  assert.equal(report.executionBoundary.autoTradeUnlocked, false)
  const history = await dailyReviewService.listReviews({ userId, limit: 1 })
  assert.equal(history.items.length, 1)
  assert.equal(history.items[0].id, review.id)
  const chatReview = await famsChatService.sendMessage({ userId, message: '查看最新持仓复盘' })
  assert.equal(chatReview.intent, 'daily_review_latest')
  assert.equal(chatReview.structuredResult?.resultType, 'daily_review')
  assert.ok((chatReview.structuredResult?.charts.length || 0) >= 1)
  const chatRun = await famsChatService.sendMessage({ userId, message: '现在生成一次当前持仓复盘' })
  assert.equal(chatRun.intent, 'daily_review_run')
  assert.equal(chatRun.requiresConfirmation, true)
  const mcpReview = await callMcpTool('daily_review.get', { userId, reviewId: review.id })
  assert.equal(mcpReview.status, 'completed')

  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl5ZQAAAABJRU5ErkJggg==', 'base64')
  const uploaded = await screenshotCaptureService.upload({ userId, accountSource: 'tonghuashun', buffer: png, mimeType: 'image/png', originalFilename: 'holding.png' })
  capturePath = uploaded.capture.storagePath
  const preview = await screenshotCaptureService.applyExtraction({
    captureId: uploaded.capture.id,
    userId,
    documentType: 'holding',
    rows: [{
      rowType: 'holding',
      rawText: `${primarySymbol} 1200 10.2`,
      fields: { symbol: primarySymbol, quantity: 1200, availableQuantity: 1200, frozenQuantity: 0, avgCost: 10.2, currentPrice: 11.1, marketValue: 13_320 },
      fieldConfidence: { symbol: 0.99, quantity: 0.99, avgCost: 0.98 },
      confidence: 0.98,
    }],
  })
  assert.equal(preview.rows[0].status, 'ready')
  assert.equal((preview.capture.extraction as any).missingHoldings.length, 1)
  const correctedPreview = await screenshotCaptureService.updateRow({
    captureId: uploaded.capture.id,
    rowId: preview.rows[0].id,
    userId,
    update: {
      fields: { symbol: primarySymbol, quantity: 1250, availableQuantity: 1250, frozenQuantity: 0, avgCost: 10.2, currentPrice: 11.1, marketValue: 13_875 },
      confidence: 0.99,
      correctedBy: 'workflow-test',
    },
  })
  assert.equal(correctedPreview.rows[0].status, 'ready')
  assert.equal((correctedPreview.rows[0].fields as any).quantity, 1250)
  assert.equal((correctedPreview.rows[0].diff as any).corrections.length, 1)
  const blockedMcpConfirmation = await callMcpTool('capture.confirm_rows', { userId, captureId: uploaded.capture.id, rowIds: [preview.rows[0].id] })
  assert.equal(blockedMcpConfirmation.status, 'blocked')
  const confirmation = await screenshotCaptureService.confirm({
    captureId: uploaded.capture.id,
    userId,
    rowIds: [preview.rows[0].id],
    confirmed: true,
    confirmedBy: 'workflow-test',
  })
  assert.equal(confirmation.missingHoldingsClosed, 0)
  const updated = await prisma.position.findUnique({ where: { id: position.id } })
  const untouched = await prisma.position.findUnique({ where: { id: missingPosition.id } })
  assert.equal(updated?.quantity, 1250)
  assert.equal(untouched?.quantity, 500)
  assert.equal(untouched?.status, 'open')
  assert.equal(getVisionCaptureStatus().consentRequiredPerUpload, true)
  assert.equal(getVisionCaptureStatus().secretsRedacted, true)

  console.log(JSON.stringify({
    ok: true,
    reviewId: review.id,
    reviewedAssets: report.assets.length,
    gridDraftOrders: grid.orders.length,
    screenshotRows: confirmation.results.length,
    missingHoldingsClosed: confirmation.missingHoldingsClosed,
  }, null, 2))
} finally {
  assetTrendService.getSnapshot = originalTrend
  positionAdviceService.getPositionAdvice = originalAdvice
  valueAssessmentService.assessPosition = originalValueAssessment
  if (strategyId) await prisma.strategy.delete({ where: { id: strategyId } }).catch(() => undefined)
  await prisma.user.delete({ where: { id: userId } }).catch(() => undefined)
  await prisma.asset.deleteMany({ where: { symbol: { in: [primarySymbol, missingSymbol] } } }).catch(() => undefined)
  if (capturePath) await unlink(capturePath).catch(() => undefined)
  await prisma.$disconnect()
}
