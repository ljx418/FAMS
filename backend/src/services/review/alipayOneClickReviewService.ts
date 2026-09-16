import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import { analysisService } from '../analysis/analysisService.js'
import { ALIPAY_ALLOCATION_STRATEGY } from '../allocation/alipayAllocationStrategy.js'
import { allocationPolicyService } from '../allocation/allocationPolicyService.js'
import { dailyReviewSynthesisService, getDailyReviewLlmReadiness } from './dailyReviewSynthesisService.js'
import { dailyReviewService, type DailyReviewSession } from './dailyReviewService.js'
import { alipayResearchWorkflowService } from './alipayResearchWorkflowService.js'

const parseJson = <T>(value: string | null | undefined, fallback: T): T => {
  try {
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

class AlipayOneClickReviewService {
  private async ensureAdviceActions(review: any, report: any) {
    const drafts = Array.isArray(report.oneClickWorkflow?.tradeDrafts) ? report.oneClickWorkflow.tradeDrafts : []
    if (!review.adviceId || drafts.length === 0) return report
    const [assets, existingActions] = await Promise.all([
      prisma.asset.findMany({ where: { symbol: { in: drafts.map((draft: any) => String(draft.symbol)) } } }),
      prisma.adviceAction.findMany({ where: { adviceId: review.adviceId }, include: { asset: true }, orderBy: { createdAt: 'asc' } }),
    ])
    const assetBySymbol = new Map(assets.map((asset) => [asset.symbol, asset.id]))
    const actions: Array<{ id: string }> = []
    for (const draft of drafts) {
      const desiredStatus = draft.currentState === 'manual_confirmation_required' ? 'proposed' : 'blocked'
      const existing = existingActions.find((action) => action.asset?.symbol === String(draft.symbol) && action.actionType === String(draft.action || 'hold'))
      const action = existing
        ? await prisma.adviceAction.update({ where: { id: existing.id }, data: { status: desiredStatus, suggestedAmount: Number(draft.firstTrancheAmount) || null } })
        : await prisma.adviceAction.create({
            data: {
              adviceId: review.adviceId,
              assetId: assetBySymbol.get(String(draft.symbol)) || null,
              actionType: String(draft.action || 'hold'),
              suggestedAmount: Number(draft.firstTrancheAmount) || null,
              confidence: desiredStatus === 'proposed' ? 0.85 : 0.7,
              reason: String(draft.reason || draft.title || ''),
              status: desiredStatus,
            },
          })
      actions.push(action)
    }
    const nextReport = {
      ...report,
      oneClickWorkflow: {
        ...report.oneClickWorkflow,
        tradeDrafts: drafts.map((draft: any, index: number) => ({ ...draft, adviceActionId: actions[index]?.id || null })),
      },
    }
    const recommendation = parseJson<any>(review.advice?.recommendationJson, {})
    await prisma.$transaction([
      prisma.dailyReviewRun.update({ where: { id: review.id }, data: { reportJson: JSON.stringify(nextReport) } }),
      prisma.advice.update({
        where: { id: review.adviceId },
        data: { recommendationJson: JSON.stringify({ ...recommendation, oneClickWorkflow: nextReport.oneClickWorkflow }) },
      }),
    ])
    return nextReport
  }

  async preflight(input: { userId: string; portfolioChangedSinceLastCapture?: boolean }) {
    const userId = input.userId || 'default'
    await ensureUser(prisma, userId)
    const [captures, latestRuns, positions, allocationPlan] = await Promise.all([
      prisma.screenshotCapture.findMany({
        where: {
          userId,
          documentType: 'fund_portfolio',
          status: { in: ['confirmed', 'partially_confirmed'] },
        },
        include: { rows: { orderBy: { rowIndex: 'asc' } } },
        orderBy: [{ confirmedAt: 'desc' }, { createdAt: 'desc' }],
        take: 5,
      }),
      prisma.dailyReviewRun.findMany({
        where: { userId, status: { in: ['completed', 'partial', 'failed'] } },
        include: { operation: true },
        orderBy: { generatedAt: 'desc' },
        take: 20,
      }),
      prisma.position.findMany({ where: { userId, status: 'open' }, include: { asset: true } }),
      allocationPolicyService.getCurrentPlan(userId),
    ])
    const blockers: string[] = []
    const warnings: string[] = []
    if (typeof input.portfolioChangedSinceLastCapture !== 'boolean') blockers.push('portfolio_change_declaration_required')
    const latestCapture = captures[0] || null
    if (!latestCapture) blockers.push('confirmed_alipay_portfolio_capture_required')

    const latestOneClickRun = latestRuns.find((run) => {
      const operationInput = parseJson<any>(run.operation?.inputJson, {})
      return Boolean(operationInput.oneClickContext)
    }) || null
    if (input.portfolioChangedSinceLastCapture === true && latestCapture && latestOneClickRun) {
      const captureTime = latestCapture.confirmedAt || latestCapture.createdAt
      if (captureTime <= latestOneClickRun.generatedAt) blockers.push('new_alipay_portfolio_capture_required')
    }

    let sourceSnapshot: Record<string, unknown> | null = null
    if (latestCapture) {
      const visibleRows = latestCapture.rows.filter((row) => row.status === 'confirmed')
      const accountRow = visibleRows.find((row) => row.rowType === 'account_summary')
      const accountFields = parseJson<Record<string, any>>(accountRow?.fieldsJson, {})
      const holdingRows = visibleRows.filter((row) => row.rowType === 'holding')
      const holdingTotal = holdingRows.reduce((sum, row) => {
        const fields = parseJson<Record<string, any>>(row.fieldsJson, {})
        return sum + (Number(fields.marketValue) || 0)
      }, 0)
      const availableCash = Number(accountFields.availableCash)
      const statedTotal = Number(accountFields.totalAssets)
      const calculatedTotal = money(holdingTotal + (Number.isFinite(availableCash) ? availableCash : 0))
      const variance = Number.isFinite(statedTotal) ? money(statedTotal - calculatedTotal) : null
      if (!accountRow) blockers.push('alipay_account_summary_required')
      if (holdingRows.length === 0) blockers.push('alipay_holding_rows_required')
      if (variance === null || Math.abs(variance) > 0.01) blockers.push('alipay_capture_reconciliation_failed')
      sourceSnapshot = {
        captureId: latestCapture.id,
        confirmedAt: latestCapture.confirmedAt?.toISOString() || null,
        capturedAt: latestCapture.capturedAt?.toISOString() || null,
        asOfDate: accountFields.asOfDate || null,
        holdingRows: holdingRows.length,
        holdingTotal: money(holdingTotal),
        availableCash: Number.isFinite(availableCash) ? money(availableCash) : null,
        statedTotal: Number.isFinite(statedTotal) ? money(statedTotal) : null,
        calculatedTotal,
        variance,
        reconciliation: variance !== null && Math.abs(variance) <= 0.01 ? 'exact' : 'failed',
      }
    }

    const currentAlipayValue = money(positions
      .filter((position: any) => {
        const markers = `${position.tags} ${position.labels}`
        return markers.includes('账户:支付宝') || markers.includes('支付宝·')
      })
      .reduce((sum, position) => sum + Number(position.marketValue || 0), 0))
    const capturedTotal = Number(sourceSnapshot?.statedTotal)
    const positionVariance = sourceSnapshot && Number.isFinite(capturedTotal) ? money(currentAlipayValue - capturedTotal) : null
    if (positionVariance !== null && Math.abs(positionVariance) > 0.01) blockers.push('alipay_positions_do_not_match_capture')
    if (allocationPlan.classification.status !== 'complete') blockers.push('alipay_allocation_classification_incomplete')
    if (allocationPlan.strategyContract.status !== 'active') blockers.push(`alipay_allocation_strategy_${allocationPlan.strategyContract.status}`)

    const llm = getDailyReviewLlmReadiness()
    if (!llm.enabled) blockers.push('strict_llm_unavailable')
    const duplicateBlockers = [...new Set(blockers)]
    if (latestCapture && latestOneClickRun && input.portfolioChangedSinceLastCapture === false) {
      warnings.push('本轮复用最近一次已确认持仓截图；请确认自该截图后没有买卖、分红再投或转账。')
    }
    return {
      schemaVersion: 'fams.alipay-one-click-preflight.v1',
      status: duplicateBlockers.length === 0 ? 'ready' : 'blocked',
      canRun: duplicateBlockers.length === 0,
      portfolioChangedSinceLastCapture: input.portfolioChangedSinceLastCapture ?? null,
      blockers: duplicateBlockers,
      warnings,
      sourceSnapshot,
      currentPortfolio: {
        alipayValue: currentAlipayValue,
        captureVariance: positionVariance,
        classificationStatus: allocationPlan.classification.status,
        unknownSymbols: allocationPlan.classification.unknownAlipaySymbols,
      },
      llm,
      previousOneClickReview: latestOneClickRun ? {
        reviewId: latestOneClickRun.id,
        status: latestOneClickRun.status,
        generatedAt: latestOneClickRun.generatedAt.toISOString(),
      } : null,
    }
  }

  async start(input: {
    userId: string
    sessionType?: DailyReviewSession
    portfolioChangedSinceLastCapture?: boolean
    idempotencyKey?: string
    triggerSource?: 'user' | 'scheduler'
  }) {
    const preflight = await this.preflight(input)
    if (!preflight.canRun) return { started: false as const, preflight }
    const context = await analysisService.getAlipayOneClickContext(input.userId, { refreshRrg: true })
    const allocationItems = context.relativeRotation.items || []
    const itemBlockers = allocationItems
      .filter((item: any) => !item.formulaSufficient || !['fresh', 'delayed'].includes(item.freshness))
      .map((item: any) => `rrg_data_not_ready:${item.symbol}`)
    const benchmarkLag = Number(context.relativeRotation.benchmark?.freshnessLag)
    const dataBlockers = [
      ...itemBlockers,
      ...(!Number.isFinite(benchmarkLag) || benchmarkLag >= 2 ? ['rrg_benchmark_not_ready'] : []),
    ]
    if (dataBlockers.length > 0) {
      return {
        started: false as const,
        preflight: {
          ...preflight,
          status: 'blocked',
          canRun: false,
          blockers: [...preflight.blockers, ...dataBlockers],
        },
        context,
      }
    }
    const oneClickContext = {
      ...context,
      sourceSnapshot: preflight.sourceSnapshot,
      preflight: {
        status: preflight.status,
        warnings: preflight.warnings,
        portfolioChangedSinceLastCapture: preflight.portfolioChangedSinceLastCapture,
      },
    }
    let comparison: Awaited<ReturnType<typeof alipayResearchWorkflowService.runComparison>> | null = null
    let comparisonFailure: string | null = null
    try {
      comparison = await alipayResearchWorkflowService.runComparison({
        userId: input.userId,
        createdBy: input.triggerSource || 'user',
        idempotencyKey: input.idempotencyKey ? `${input.idempotencyKey}:portfolio-comparison` : undefined,
      })
    } catch (error) {
      comparisonFailure = error instanceof Error ? error.message : String(error)
    }
    const completeContext = {
      ...oneClickContext,
      workflowContract: alipayResearchWorkflowService.getContract(),
      portfolioComparison: comparison ? {
        operationId: comparison.operation.id,
        status: comparison.operation.status,
        summary: comparison.summary,
        actualAllocationContract: ALIPAY_ALLOCATION_STRATEGY.id,
        researchComparisonContract: 'alipay_research_10_25_40_25_v1',
      } : {
        operationId: null,
        status: 'failed',
        summary: null,
        failureCode: comparisonFailure || 'portfolio_comparison_unavailable',
        actualAllocationContract: ALIPAY_ALLOCATION_STRATEGY.id,
        researchComparisonContract: 'alipay_research_10_25_40_25_v1',
      },
    }
    const result = await dailyReviewService.startReview({
      userId: input.userId,
      sessionType: input.sessionType || 'manual',
      triggerSource: input.triggerSource || 'user',
      executionMode: 'inline',
      requireLlmSuccess: true,
      idempotencyKey: input.idempotencyKey,
      oneClickContext: completeContext,
    })
    if (comparison?.operation.id && result.operation?.id) {
      await alipayResearchWorkflowService.linkParent(comparison.operation.id, result.operation.id, input.userId)
    }
    return { started: true as const, preflight, context: completeContext, comparison, ...result }
  }

  async retryLlm(input: { userId: string; reviewId: string }) {
    const review = await prisma.dailyReviewRun.findUnique({
      where: { id: input.reviewId },
      include: { operation: true, advice: true },
    })
    if (!review || review.userId !== input.userId) throw new Error('One-click review not found')
    const report = parseJson<any>(review.reportJson, {})
    if (!report.oneClickWorkflow) throw new Error('Review is not an Alipay one-click review')
    if (review.status !== 'failed') {
      await this.ensureAdviceActions(review, report)
      return dailyReviewService.getReview(review.id, input.userId)
    }
    const benchmarkLag = Number(report.oneClickWorkflow?.relativeRotation?.benchmark?.freshnessLag)
    if (!Number.isFinite(benchmarkLag) || benchmarkLag >= 2) throw new Error('RRG benchmark is stale; run a full review instead')
    const llm = getDailyReviewLlmReadiness()
    if (!llm.enabled) throw new Error('Strict LLM is unavailable')
    const synthesis = await dailyReviewSynthesisService.synthesize({
      strategyAssessment: report.strategy?.assessment,
      decisionSummary: report.decisionSummary,
      attentionCandidates: report.attentionCandidates,
      assets: report.assets,
    })
    const passed = synthesis.status === 'available'
    const operationInput = parseJson<any>(review.operation?.inputJson, {})
    const originalDrafts = operationInput.oneClickContext?.tradeDrafts || []
    const completedStatus = Array.isArray(report.errors) && report.errors.length > 0 ? 'partial' : 'completed'
    const nextStatus = passed ? completedStatus : 'failed'
    const completedAt = new Date()
    const nextReport = {
      ...report,
      completedAt: completedAt.toISOString(),
      llmSynthesis: synthesis,
      llmGate: {
        required: true,
        passed,
        status: synthesis.status,
        source: synthesis.source,
        attemptCount: synthesis.attemptCount,
        failureCode: synthesis.failureCode,
      },
      oneClickWorkflow: {
        ...report.oneClickWorkflow,
        readyForHumanReview: passed,
        draftAvailability: passed ? 'manual_confirmation_required' : 'blocked_by_strict_llm_gate',
        tradeDrafts: passed ? originalDrafts : report.oneClickWorkflow.tradeDrafts,
      },
    }
    const previousDataQuality = parseJson<any>(review.dataQualityJson, {})
    const dataQuality = {
      ...previousDataQuality,
      status: nextStatus,
      llmGate: nextReport.llmGate,
      llmRetryAt: completedAt.toISOString(),
      llmRetryHistory: [
        ...(Array.isArray(previousDataQuality.llmRetryHistory) ? previousDataQuality.llmRetryHistory : []),
        {
          retriedAt: completedAt.toISOString(),
          previousGate: report.llmGate || previousDataQuality.llmGate || null,
          resultGate: nextReport.llmGate,
        },
      ].slice(-10),
    }
    const recommendation = parseJson<any>(review.advice?.recommendationJson, {})
    await prisma.$transaction([
      prisma.dailyReviewRun.update({
        where: { id: review.id },
        data: { status: nextStatus, completedAt, reportJson: JSON.stringify(nextReport), dataQualityJson: JSON.stringify(dataQuality) },
      }),
      ...(review.adviceId ? [prisma.advice.update({
        where: { id: review.adviceId },
        data: {
          status: passed ? 'proposed' : 'blocked',
          recommendationJson: JSON.stringify({ ...recommendation, oneClickWorkflow: nextReport.oneClickWorkflow }),
        },
      })] : []),
      ...(review.operationId ? [prisma.operation.update({
        where: { id: review.operationId },
        data: {
          status: nextStatus,
          completedAt,
          progressPct: 100,
          progressMessage: passed ? '严格 LLM 重试通过，复盘可人工核对' : '严格 LLM 重试未通过',
          errorSummary: passed ? null : `要求的真实 LLM 汇总未通过：${synthesis.failureCode || synthesis.status}`,
        },
      })] : []),
    ])
    await this.ensureAdviceActions(review, nextReport)
    return dailyReviewService.getReview(review.id, input.userId)
  }

  async decideDraft(input: {
    userId: string
    reviewId: string
    actionId: string
    decision: 'accepted' | 'rejected' | 'modified'
    overrideAmount?: number
    notes?: string
  }) {
    const decision = String(input.decision || '') as 'accepted' | 'rejected' | 'modified'
    if (!['accepted', 'rejected', 'modified'].includes(decision)) throw new Error('decision must be accepted, rejected, or modified')
    const review = await prisma.dailyReviewRun.findUnique({
      where: { id: input.reviewId },
      include: { advice: { include: { actions: { include: { execution: true } } } } },
    })
    if (!review || review.userId !== input.userId) throw new Error('One-click review not found')
    const report = parseJson<any>(review.reportJson, {})
    const drafts = Array.isArray(report.oneClickWorkflow?.tradeDrafts) ? report.oneClickWorkflow.tradeDrafts : []
    if (!report.oneClickWorkflow || report.oneClickWorkflow.readyForHumanReview !== true) throw new Error('One-click drafts are not ready for human review')
    if (!review.advice || !review.advice.actions.some((action) => action.id === input.actionId)) throw new Error('Advice action does not belong to this review')
    const draft = drafts.find((item: any) => item.adviceActionId === input.actionId)
    if (!draft) throw new Error('One-click draft not found')
    const blocked = draft.currentState !== 'manual_confirmation_required'
    if (blocked && decision !== 'rejected') throw new Error('Blocked draft can only be rejected until its prerequisites are resolved')
    const overrideAmount = Number(input.overrideAmount)
    if (decision === 'modified') {
      if (!Number.isFinite(overrideAmount) || overrideAmount <= 0) throw new Error('overrideAmount must be positive for a modified decision')
      if (overrideAmount > Number(draft.fullAmount || 0)) throw new Error('overrideAmount cannot exceed the full adjustment amount')
    }
    const notes = String(input.notes || '').trim().slice(0, 500)
    const decidedAt = new Date()
    const plannedAmount = decision === 'rejected'
      ? null
      : money(decision === 'modified' ? overrideAmount : Number(draft.firstTrancheAmount || 0))
    const decisionEvidence = {
      decision,
      plannedAmount,
      originalSuggestedAmount: money(Number(draft.firstTrancheAmount || 0)),
      decisionScope: 'plan_draft_only',
      createsExternalOrder: false,
      positionMutation: false,
    }
    const nextDrafts = drafts.map((item: any) => item.adviceActionId === input.actionId
      ? { ...item, humanDecision: { ...decisionEvidence, notes: notes || null, decidedAt: decidedAt.toISOString() } }
      : item)
    const decisionByActionId = new Map(review.advice.actions.map((action) => [action.id, action.execution?.decision || null]))
    decisionByActionId.set(input.actionId, decision)
    const decidableDrafts = nextDrafts.filter((item: any) => item.currentState === 'manual_confirmation_required')
    const allDecidableResolved = decidableDrafts.length > 0 && decidableDrafts.every((item: any) => decisionByActionId.has(item.adviceActionId) && decisionByActionId.get(item.adviceActionId))
    const anyAccepted = decidableDrafts.some((item: any) => ['accepted', 'modified'].includes(String(decisionByActionId.get(item.adviceActionId) || '')))
    const adviceStatus = allDecidableResolved ? (anyAccepted ? 'accepted' : 'rejected') : 'proposed'
    const nextReport = {
      ...report,
      oneClickWorkflow: {
        ...report.oneClickWorkflow,
        tradeDrafts: nextDrafts,
        humanDecisionSummary: {
          resolved: nextDrafts.filter((item: any) => Boolean(item.humanDecision)).length,
          total: nextDrafts.length,
          allDecidableResolved,
          updatedAt: decidedAt.toISOString(),
        },
      },
    }
    await prisma.$transaction([
      prisma.adviceExecution.upsert({
        where: { adviceActionId: input.actionId },
        create: {
          adviceActionId: input.actionId,
          decision,
          overrideJson: JSON.stringify(decisionEvidence),
          executedAt: null,
          notes: notes || '人工计划草案决定；未发生交易。',
        },
        update: {
          decision,
          overrideJson: JSON.stringify(decisionEvidence),
          executedAt: null,
          notes: notes || '人工计划草案决定；未发生交易。',
        },
      }),
      prisma.adviceAction.update({
        where: { id: input.actionId },
        data: { status: decision === 'rejected' ? 'rejected' : 'accepted', executedAt: null },
      }),
      prisma.advice.update({ where: { id: review.advice.id }, data: { status: adviceStatus } }),
      prisma.dailyReviewRun.update({ where: { id: review.id }, data: { reportJson: JSON.stringify(nextReport) } }),
    ])
    return dailyReviewService.getReview(review.id, input.userId)
  }
}

export const alipayOneClickReviewService = new AlipayOneClickReviewService()
