import { randomUUID } from 'node:crypto'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import { allocationPolicyService, isAlipayPosition } from '../allocation/allocationPolicyService.js'
import { alipayOneClickReviewService } from '../review/alipayOneClickReviewService.js'
import { alipayResearchWorkflowService } from '../review/alipayResearchWorkflowService.js'
import { dailyReviewService } from '../review/dailyReviewService.js'
import { screenshotCaptureService, type CaptureExtractionRow } from '../capture/screenshotCaptureService.js'

type ReviewSession = 'open' | 'pre_close' | 'manual'
type PlanDecision = 'accepted' | 'rejected' | 'modified'

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

const executionBoundary = {
  planDraftOnly: true,
  formalTradingUnlocked: false,
  autoTradeUnlocked: false,
  canCreateOrder: false,
  orderCreateAllowed: false,
} as const

class PortfolioWorkflowFacade {
  async getCurrentState(userId: string, accountScope: 'all' | 'alipay' = 'all') {
    await ensureUser(prisma, userId)
    const [allPositions, allocationPlan, latestCapture, latestReview, pendingTransactions] = await Promise.all([
      prisma.position.findMany({
        where: { userId, status: 'open' },
        include: { asset: true },
        orderBy: { marketValue: 'desc' },
      }),
      allocationPolicyService.getCurrentPlan(userId),
      prisma.screenshotCapture.findFirst({
        where: { userId, documentType: 'fund_portfolio', status: { in: ['confirmed', 'partially_confirmed'] } },
        orderBy: [{ confirmedAt: 'desc' }, { createdAt: 'desc' }],
        select: { id: true, capturedAt: true, confirmedAt: true, status: true, sha256: true },
      }),
      prisma.dailyReviewRun.findFirst({
        where: { userId },
        orderBy: { generatedAt: 'desc' },
        select: { id: true, operationId: true, sessionType: true, status: true, generatedAt: true, completedAt: true },
      }),
      prisma.transaction.count({ where: { userId, status: 'pending' } }),
    ])
    const selected = accountScope === 'alipay' ? allPositions.filter(isAlipayPosition) : allPositions
    const positions = selected.map((position) => ({
      id: position.id,
      assetId: position.assetId,
      symbol: position.asset.symbol,
      name: position.asset.name,
      assetType: position.asset.type,
      quantity: position.quantity,
      averageCost: position.avgCost,
      currentPrice: position.currentPrice,
      marketValue: position.marketValue,
      unrealizedPnl: position.unrealizedPnl,
      valuationBasis: position.valuationBasis,
      priceAsOf: position.asset.lastUpdated?.toISOString() || position.updatedAt.toISOString(),
      tags: parseJson<string[]>(position.tags, []),
      labels: parseJson<string[]>(position.labels, []),
    }))
    const totalValue = positions.reduce((sum, position) => sum + Number(position.marketValue || 0), 0)
    return {
      schemaVersion: 'fams.mcp.portfolio-state.v1',
      generatedAt: new Date().toISOString(),
      accountScope,
      currency: 'CNY',
      totalValue: Number(totalValue.toFixed(2)),
      positionCount: positions.length,
      positions,
      allocationPlan,
      pendingTransactionCount: pendingTransactions,
      latestConfirmedPortfolioCapture: latestCapture ? {
        ...latestCapture,
        capturedAt: latestCapture.capturedAt?.toISOString() || null,
        confirmedAt: latestCapture.confirmedAt?.toISOString() || null,
        sha256: latestCapture.sha256.slice(0, 12),
      } : null,
      latestReview: latestReview ? {
        ...latestReview,
        generatedAt: latestReview.generatedAt.toISOString(),
        completedAt: latestReview.completedAt?.toISOString() || null,
      } : null,
      dataHealth: {
        positionsWithoutPrice: positions.filter((position) => position.currentPrice === null).map((position) => position.symbol),
        classificationStatus: allocationPlan.classification.status,
        unknownAlipaySymbols: allocationPlan.classification.unknownAlipaySymbols,
      },
      executionBoundary,
    }
  }

  preflightReview(userId: string, portfolioChangedSinceLastCapture: boolean) {
    return alipayOneClickReviewService.preflight({ userId, portfolioChangedSinceLastCapture })
  }

  async startReview(input: {
    userId: string
    sessionType: ReviewSession
    portfolioChangedSinceLastCapture: boolean
    idempotencyKey: string
  }) {
    const preflight = await this.preflightReview(input.userId, input.portfolioChangedSinceLastCapture)
    if (!preflight.canRun) {
      return {
        schemaVersion: 'fams.mcp.portfolio-review-start.v1',
        status: 'blocked',
        started: false,
        preflight,
        executionBoundary,
      }
    }
    const existing = await prisma.operation.findUnique({
      where: { type_idempotencyKey: { type: 'portfolio_management_review', idempotencyKey: input.idempotencyKey } },
    })
    if (existing) {
      if (existing.userId !== input.userId) throw new Error('PORTFOLIO_REVIEW_IDEMPOTENCY_USER_CONFLICT')
      return this.toStartedOperation(existing, true)
    }
    const operation = await prisma.operation.create({
      data: {
        userId: input.userId,
        type: 'portfolio_management_review',
        status: 'queued',
        createdBy: 'agent',
        idempotencyKey: input.idempotencyKey,
        inputJson: JSON.stringify(input),
        progressMessage: '等待执行支付宝仓位管理复盘',
      },
    })
    queueMicrotask(() => { void this.executeReviewOperation(operation.id) })
    return this.toStartedOperation(operation, false)
  }

  private toStartedOperation(operation: { id: string; status: string; progressPct: number }, reused: boolean) {
    return {
      schemaVersion: 'fams.mcp.portfolio-review-start.v1',
      status: operation.status,
      started: true,
      reused,
      operationId: operation.id,
      progressPct: operation.progressPct,
      nextAction: { tool: 'portfolio_review_get', arguments: { operationId: operation.id } },
      executionBoundary,
    }
  }

  private async executeReviewOperation(operationId: string) {
    const now = new Date()
    const leaseToken = randomUUID()
    const claimed = await prisma.operation.updateMany({
      where: {
        id: operationId,
        type: 'portfolio_management_review',
        status: { in: ['queued', 'running'] },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        status: 'running',
        startedAt: now,
        progressPct: 5,
        progressMessage: '正在准备仓位、行情和策略上下文',
        leaseOwner: `portfolio-mcp:${process.pid}`,
        leaseToken,
        leaseExpiresAt: new Date(now.getTime() + 10 * 60_000),
        heartbeatAt: now,
      },
    })
    if (claimed.count !== 1) return
    const operation = await prisma.operation.findUnique({ where: { id: operationId } })
    if (!operation) return
    const heartbeat = setInterval(() => {
      const heartbeatAt = new Date()
      void prisma.operation.updateMany({
        where: { id: operationId, status: 'running', leaseToken },
        data: {
          heartbeatAt,
          leaseExpiresAt: new Date(heartbeatAt.getTime() + 10 * 60_000),
        },
      }).catch(() => undefined)
    }, 30_000)
    heartbeat.unref()
    const input = parseJson<{ userId: string; sessionType: ReviewSession; portfolioChangedSinceLastCapture: boolean; idempotencyKey: string }>(operation.inputJson, {
      userId: operation.userId,
      sessionType: 'manual',
      portfolioChangedSinceLastCapture: true,
      idempotencyKey: operation.id,
    })
    try {
      const result = await alipayOneClickReviewService.start({
        userId: operation.userId,
        sessionType: input.sessionType,
        portfolioChangedSinceLastCapture: input.portfolioChangedSinceLastCapture,
        idempotencyKey: `${input.idempotencyKey}:daily-review`,
        triggerSource: 'user',
      })
      if (!result.started) {
        await prisma.operation.update({
          where: { id: operationId },
          data: {
            status: 'failed',
            completedAt: new Date(),
            progressPct: 100,
            progressMessage: '仓位复盘被数据预检阻断',
            resultJson: JSON.stringify({ started: false, preflight: result.preflight }),
            errorSummary: 'portfolio_review_preflight_blocked',
            leaseOwner: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        })
        return
      }
      const reviewId = result.review?.id || null
      const childOperationId = result.operation?.id || null
      await prisma.operation.update({
        where: { id: operationId },
        data: {
          status: result.review?.status === 'failed' ? 'failed' : result.review?.status === 'partial' ? 'partial' : 'completed',
          completedAt: new Date(),
          progressPct: 100,
          progressMessage: result.review?.status === 'failed' ? '仓位复盘失败' : '仓位复盘已完成',
          resultJson: JSON.stringify({ reviewId, childOperationId, reviewStatus: result.review?.status, started: true }),
          artifactRefsJson: JSON.stringify(reviewId ? [`daily-review:${reviewId}`] : []),
          errorSummary: result.review?.status === 'failed' ? 'portfolio_review_failed' : null,
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      await prisma.operation.update({
        where: { id: operationId },
        data: {
          status: 'failed',
          completedAt: new Date(),
          progressPct: 100,
          progressMessage: '仓位复盘执行失败',
          errorSummary: message.slice(0, 500),
          errorJson: JSON.stringify({ message }),
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      }).catch(() => undefined)
    } finally {
      clearInterval(heartbeat)
    }
  }

  async recoverInterruptedReviews() {
    const rows = await prisma.operation.findMany({
      where: {
        type: 'portfolio_management_review',
        status: { in: ['queued', 'running'] },
        cancelRequested: false,
        OR: [{ status: 'queued' }, { leaseExpiresAt: null }, { leaseExpiresAt: { lt: new Date() } }],
      },
      orderBy: { requestedAt: 'asc' },
      take: 10,
      select: { id: true },
    })
    for (const row of rows) queueMicrotask(() => { void this.executeReviewOperation(row.id) })
    return { recoveredCount: rows.length, operationIds: rows.map((row) => row.id) }
  }

  async getReview(userId: string, operationId: string) {
    const operation = await prisma.operation.findUnique({ where: { id: operationId } })
    if (!operation || operation.userId !== userId || operation.type !== 'portfolio_management_review') {
      throw new Error('PORTFOLIO_REVIEW_OPERATION_NOT_FOUND')
    }
    const result = parseJson<{ reviewId?: string; childOperationId?: string; preflight?: unknown }>(operation.resultJson, {})
    let review: Awaited<ReturnType<typeof dailyReviewService.getReview>> | null = null
    if (result.reviewId) review = await dailyReviewService.getReview(result.reviewId, userId)
    const report = review?.report as any
    return {
      schemaVersion: 'fams.mcp.portfolio-review.v1',
      operation: {
        id: operation.id,
        status: operation.status,
        progressPct: operation.progressPct,
        progressMessage: operation.progressMessage,
        requestedAt: operation.requestedAt.toISOString(),
        startedAt: operation.startedAt?.toISOString() || null,
        completedAt: operation.completedAt?.toISOString() || null,
        errorSummary: operation.errorSummary,
      },
      review: review ? {
        id: review.id,
        status: review.status,
        sessionType: review.sessionType,
        generatedAt: review.generatedAt.toISOString(),
        completedAt: review.completedAt?.toISOString() || null,
        portfolio: report?.portfolio || null,
        decisionSummary: report?.decisionSummary || null,
        strategyAssessment: report?.strategy?.assessment || null,
        llmSynthesis: report?.llmSynthesis || null,
        dataQuality: review.dataQuality,
        tradeDrafts: report?.oneClickWorkflow?.tradeDrafts || [],
        attentionCandidates: report?.attentionCandidates || [],
        assets: report?.assets || [],
        reportHref: `/daily-reviews/${encodeURIComponent(review.id)}`,
      } : null,
      blockedResult: result.preflight || null,
      nextAction: ['queued', 'running'].includes(operation.status)
        ? { tool: 'portfolio_review_get', arguments: { operationId }, retryAfterSeconds: 2 }
        : null,
      executionBoundary,
    }
  }

  async getLatestReview(userId: string) {
    const review = await dailyReviewService.getLatest(userId)
    return review || { status: 'empty', executionBoundary }
  }

  async savePlanDecision(input: {
    userId: string
    reviewId: string
    actionId: string
    decision: PlanDecision
    overrideAmount?: number
    notes?: string
  }) {
    const before = await prisma.transaction.count({ where: { userId: input.userId } })
    const result = await alipayOneClickReviewService.decideDraft(input)
    const after = await prisma.transaction.count({ where: { userId: input.userId } })
    if (after !== before) throw new Error('PLAN_DECISION_TRANSACTION_BOUNDARY_VIOLATION')
    return { schemaVersion: 'fams.mcp.portfolio-plan-decision.v1', result, executionBoundary }
  }

  async uploadScreenshot(input: { userId: string; base64: string; mimeType?: string; originalFilename?: string }) {
    const result = await screenshotCaptureService.uploadBase64({
      ...input,
      accountSource: 'alipay',
      conversationId: 'portfolio-mcp',
      capturedAt: new Date(),
    })
    return {
      schemaVersion: 'fams.mcp.portfolio-screenshot-upload.v1',
      captureId: result.capture.id,
      status: result.capture.status,
      reused: result.reused,
      nextAction: { tool: 'portfolio_screenshot_save_extraction', arguments: { captureId: result.capture.id } },
      executionBoundary,
    }
  }

  async saveScreenshotExtraction(input: { userId: string; captureId: string; rows: CaptureExtractionRow[]; rawText?: string }) {
    if (input.rows.some((row) => !['account_summary', 'holding'].includes(row.rowType))) {
      throw new Error('PORTFOLIO_MCP_SCREENSHOT_ROWS_MUST_BE_HOLDINGS_ONLY')
    }
    return screenshotCaptureService.applyExtraction({
      userId: input.userId,
      captureId: input.captureId,
      documentType: 'fund_portfolio',
      rows: input.rows,
      rawText: input.rawText,
      visionProvider: 'portfolio_mcp',
      consentGranted: false,
    })
  }

  async confirmScreenshot(input: { userId: string; captureId: string; rowIds?: string[]; confirmedBy: string }) {
    const capture = await prisma.screenshotCapture.findFirst({
      where: { id: input.captureId, userId: input.userId },
      include: { rows: true },
    })
    if (!capture) throw new Error('PORTFOLIO_SCREENSHOT_NOT_FOUND')
    if (capture.documentType !== 'fund_portfolio') throw new Error('PORTFOLIO_MCP_ONLY_ACCEPTS_FUND_PORTFOLIO_SCREENSHOTS')
    const selected = capture.rows.filter((row) => !input.rowIds || input.rowIds.includes(row.id))
    if (selected.some((row) => !['account_summary', 'holding'].includes(row.rowType))) {
      throw new Error('PORTFOLIO_MCP_SCREENSHOT_CONFIRM_HOLDINGS_ONLY')
    }
    const transactionCount = await prisma.transaction.count({ where: { userId: input.userId } })
    const result = await screenshotCaptureService.confirm({
      captureId: input.captureId,
      userId: input.userId,
      rowIds: input.rowIds,
      confirmed: true,
      confirmedBy: input.confirmedBy,
    })
    const nextTransactionCount = await prisma.transaction.count({ where: { userId: input.userId } })
    if (nextTransactionCount !== transactionCount) throw new Error('SCREENSHOT_CONFIRM_TRANSACTION_BOUNDARY_VIOLATION')
    return { schemaVersion: 'fams.mcp.portfolio-screenshot-confirm.v1', result, executionBoundary }
  }

  authorizeSnapshotReuse(userId: string, captureId?: string) {
    return alipayResearchWorkflowService.authorizeSnapshot({ userId, captureId })
  }

  revokeSnapshotReuse(userId: string, reason?: string) {
    return alipayResearchWorkflowService.revokeSnapshot({ userId, reason })
  }

  getExecutionBoundary() {
    return executionBoundary
  }
}

export const portfolioWorkflowFacade = new PortfolioWorkflowFacade()
