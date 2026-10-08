import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../../db/prisma.js'
import { operationService } from '../operation/operationService.js'
import { brokerReviewReconciliationService, type BrokerReviewReconciliationInput } from './brokerReviewReconciliationService.js'
import { dailyReviewHtmlService } from './dailyReviewHtmlService.js'
import { dailyReviewService, type DailyReviewSession } from './dailyReviewService.js'
import { downtrendReanchorService, type ReanchorDecisionInput } from '../strategy/downtrendReanchorService.js'

export const VOLATILITY_WORKFLOW_SCHEMA_VERSION = 'fams.volatility-workflow.v1' as const

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..')
const defaultStatePath = resolve(repoRoot, '波动交易工作流迁移-20260908/strategy_state.json')

const executionBoundary = Object.freeze({
  mode: 'monitor_and_draft_only',
  planDraftOnly: true,
  formalTradingUnlocked: false,
  autoTradeUnlocked: false,
  canCreateOrder: false,
  orderCreateAllowed: false,
  brokerConnectionAvailable: false,
  userMustExecuteInBroker: true,
})

export interface VolatilityCaptureInput {
  holdingsCaptureId?: string
  tradesCaptureId?: string
  ordinaryOrdersCaptureId?: string
  conditionalOrdersCaptureId?: string
  zeroNewTradesConfirmed?: boolean
  zeroOrdinaryOrdersConfirmed?: boolean
  zeroConditionalOrdersConfirmed?: boolean
}

export interface VolatilityReconcileInput extends VolatilityCaptureInput {
  userId: string
  sessionType?: DailyReviewSession
}

export interface VolatilityRunInput extends VolatilityReconcileInput {
  idempotencyKey?: string
  confirmation?: VolatilitySingleConfirmation
}

export interface VolatilitySingleConfirmation {
  confirmed: true
  confirmedBy: string
  confirmedAt: string
  checkHash: string
  acknowledgedDraftOnly: true
}

export interface VolatilityResultInput {
  userId: string
  operationId?: string
  reviewId?: string
  includeHtml?: boolean
}

export type VolatilityReanchorDecisionInput = ReanchorDecisionInput

function shanghaiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}

function stableHash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function brokerInput(input: VolatilityReconcileInput, singleConfirmation?: BrokerReviewReconciliationInput['singleConfirmation']): BrokerReviewReconciliationInput {
  return {
    userId: input.userId,
    sessionType: input.sessionType,
    holdingsCaptureId: input.holdingsCaptureId,
    tradesCaptureId: input.tradesCaptureId,
    ordinaryOrdersCaptureId: input.ordinaryOrdersCaptureId,
    conditionalOrdersCaptureId: input.conditionalOrdersCaptureId,
    zeroNewTradesConfirmed: input.zeroNewTradesConfirmed === true,
    zeroOrdinaryOrdersConfirmed: input.zeroOrdinaryOrdersConfirmed === true,
    zeroConditionalOrdersConfirmed: input.zeroConditionalOrdersConfirmed === true,
    singleConfirmation,
    persist: false,
  }
}

function hostVisionGate(reconciliation: any) {
  const captures = reconciliation?.readiness?.captures || {}
  const missingRoles = [
    captures.holdings?.fresh ? null : 'holdings',
    captures.trades?.fresh ? null : 'trades',
  ].filter((item): item is string => Boolean(item))
  if (missingRoles.length === 0) {
    return {
      required: false,
      code: null,
      missingRoles: [],
      message: '宿主提供的结构化截图事实已达到下单前对账新鲜度要求。',
    }
  }
  return {
    required: true,
    code: 'HOST_VISION_REQUIRED',
    missingRoles,
    message: `缺少15分钟内已确认的${missingRoles.join('/')}结构化截图事实；请由宿主识图后提交，服务端不会自行调用视觉模型。`,
  }
}

function fivePartReport(reconciliation: any) {
  return {
    confirmedFacts: reconciliation.confirmedFacts,
    reconciliationDifferences: reconciliation.reconciliationDifferences || [],
    pendingRules: reconciliation.pendingRules || [],
    proposedOrders: {
      retained: reconciliation.proposedOrders?.retained || [],
      cancelCandidates: reconciliation.proposedOrders?.cancelCandidates || [],
      addCandidates: reconciliation.proposedOrders?.addCandidates || [],
      blocked: reconciliation.proposedOrders?.blocked || [],
    },
    executionPermission: executionBoundary,
  }
}

function normalizeReconciliation(reconciliation: any) {
  const hostVision = hostVisionGate(reconciliation)
  return {
    schemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
    kind: 'reconciliation',
    status: reconciliation.readiness?.requiredInputsReady ? 'completed' : 'blocked',
    generatedAt: reconciliation.generatedAt,
    sessionType: reconciliation.sessionType,
    readiness: {
      ...reconciliation.readiness,
      researchAllowed: true,
      actionDraftsAllowed: reconciliation.readiness?.requiredInputsReady === true,
    },
    hostVision,
    fivePartReport: fivePartReport(reconciliation),
    executionBoundary,
    source: {
      schemaVersion: reconciliation.schemaVersion,
      strategyState: reconciliation.strategyState,
    },
    nextActions: hostVision.required
      ? [{
          type: 'provide_structured_capture',
          tool: 'capture.apply_extraction',
          missingRoles: hostVision.missingRoles,
          message: '宿主完成视觉识别后，先预览并人工确认行，再重新对账。',
        }]
      : [{ type: 'run_review', tool: 'volatility_workflow.run' }],
  }
}

class VolatilityWorkflowService {
  getExecutionBoundary() {
    return executionBoundary
  }

  async readStrategyState() {
    const sourcePath = process.env.FAMS_BROKER_STRATEGY_STATE_PATH || defaultStatePath
    const raw = await readFile(sourcePath, 'utf8')
    const state = JSON.parse(raw) as Record<string, any>
    return { sourcePath, state }
  }

  async getActiveStrategyResource(userId = 'default') {
    const { sourcePath, state } = await this.readStrategyState()
    const legacyConfigs = Object.fromEntries((state.positions || [])
      .filter((position: any) => position.downtrend_grid)
      .map((position: any) => [String(position.symbol), position.downtrend_grid]))
    const resolvedConfigs = await downtrendReanchorService.resolveConfigs(userId, legacyConfigs)
    return {
      schemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
      kind: 'active_strategy',
      sourcePath,
      strategyVersion: state.strategy_version || null,
      preparedOn: state.prepared_on || null,
      authorization: state.authorization || null,
      gridPolicy: state.grid_policy || null,
      positions: (state.positions || []).map((position: any) => {
        const resolved = resolvedConfigs.get(String(position.symbol))
        return {
          ...position,
          effectiveDowntrendGrid: resolved?.config || position.downtrend_grid || null,
          downtrendGridSource: resolved ? {
            authority: resolved.source,
            strategyVersionId: resolved.sourceStrategyVersionId,
            precedence: resolved.source === 'active_strategy_version'
              ? 'database_active_strategy_version_over_legacy_strategy_state'
              : 'legacy_strategy_state_fallback',
          } : null,
        }
      }),
      cashPolicy: state.cash_policy || null,
      executionBoundary,
    }
  }

  async getRulesResource() {
    const { sourcePath, state } = await this.readStrategyState()
    return {
      schemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
      kind: 'rules',
      sourcePath,
      userRules: (state.positions || []).map((position: any) => ({
        symbol: position.symbol,
        name: position.name,
        userPolicy: position.user_policy || null,
        derivedCurrentAllocation: position.derived_current_allocation || null,
        stop: position.stop || null,
      })),
      gridPolicy: state.grid_policy || null,
      cashPolicy: state.cash_policy || null,
      unresolvedItems: state.unresolved_items || [],
      invariants: {
        historicalFillsAlreadyIncludedInSnapshot: true,
        doNotReplayHistoricalFills: true,
        doNotRewriteWholeGridForIntradayColor: true,
        screenshotsAreFactsOnlyAfterHumanConfirmation: true,
      },
      downtrendReanchorPolicy: {
        policyVersion: 'fams.reanchor-policy.v1',
        anchorBasis: 'latest_completed_daily_close',
        triggers: {
          configuredEvents: ['completed_fill_cycle', 'pause_trigger', 'two_closes_above_ma5_with_nonfalling_ma5'],
          agedDrift: { minimumCompletedSessions: 5, atrMultiple: 2 },
          immediateExtremeDrift: { atrMultiple: 3 },
          atrUnavailableFallbackPercent: { stock: 5, etf: 3 },
        },
        translationFormula: 'candidate_price = latest_completed_close * (old_level_price / old_fixed_anchor)',
        rounding: 'buy_down_sell_up_to_market_tick',
        portfolioGate: 'single_confirmation_mode_downgrades_candidate_symbol_to_observe_only_without_blocking_other_symbols',
        rejectionEffect: 'rejected_or_suggested_symbol_is_observe_only',
        activation: 'workflow_candidates_are_suggestion_only_and_never_auto_activate',
        execution: 'strategy_state_only_no_broker_order',
      },
      executionBoundary,
    }
  }

  private async confirmationRequest(input: VolatilityReconcileInput, reconciliation: any) {
    const captures = reconciliation?.readiness?.captures || {}
    const roles = ['holdings', 'trades', 'ordinaryOrders', 'conditionalOrders'] as const
    const selected = await Promise.all(roles.map(async (role) => {
      const captureId = captures[role]?.captureId || null
      if (!captureId) return { role, captureId: null, capture: null }
      const capture = await prisma.screenshotCapture.findFirst({
        where: { id: captureId, userId: input.userId },
        include: { rows: { where: { status: 'confirmed' }, orderBy: { rowIndex: 'asc' } } },
      })
      return {
        role,
        captureId,
        capture: capture ? {
          id: capture.id,
          sha256: capture.sha256,
          documentType: capture.documentType,
          updatedAt: capture.updatedAt.toISOString(),
          rows: capture.rows.map((row) => ({
            rowType: row.rowType,
            rowIndex: row.rowIndex,
            assetId: row.assetId,
            fields: (() => { try { return JSON.parse(row.fieldsJson) } catch { return {} } })(),
            updatedAt: row.updatedAt.toISOString(),
          })),
        } : null,
      }
    }))
    const bundle = {
      schemaVersion: 'fams.volatility-single-confirmation.v1',
      userId: input.userId,
      sessionType: input.sessionType || 'manual',
      captures: selected,
      zeroConfirmations: {
        newTrades: input.zeroNewTradesConfirmed === true,
        ordinaryOrders: input.zeroOrdinaryOrdersConfirmed === true,
        conditionalOrders: input.zeroConditionalOrdersConfirmed === true,
      },
      executionBoundary,
    }
    return {
      required: true,
      mode: 'single_confirmation',
      checkHash: stableHash(bundle),
      expiresInSeconds: 900,
      bundle,
      confirmationFields: ['confirmed', 'confirmedBy', 'confirmedAt', 'checkHash', 'acknowledgedDraftOnly'],
      message: '请一次确认本整包持仓、成交、普通委托、条件单及仅生成草案的执行边界；确认后运行期间不再要求第二次确认。',
    }
  }

  private validateConfirmation(confirmation: VolatilitySingleConfirmation | undefined, checkHash: string, now = new Date()) {
    if (!confirmation) return 'missing_confirmation'
    if (confirmation.confirmed !== true || confirmation.acknowledgedDraftOnly !== true || !confirmation.confirmedBy?.trim()) return 'invalid_confirmation'
    const confirmedAt = new Date(confirmation.confirmedAt)
    if (Number.isNaN(confirmedAt.getTime())) return 'invalid_confirmation_time'
    if (confirmedAt.getTime() > now.getTime() + 60_000) return 'confirmation_time_in_future'
    if (now.getTime() - confirmedAt.getTime() > 15 * 60_000) return 'confirmation_expired'
    if (confirmation.checkHash !== checkHash) return 'check_hash_mismatch'
    return null
  }

  async reconcile(input: VolatilityReconcileInput) {
    const reconciliation = await brokerReviewReconciliationService.reconcile(brokerInput(input))
    const normalized = normalizeReconciliation(reconciliation)
    const confirmationRequest = await this.confirmationRequest(input, reconciliation)
    return {
      ...normalized,
      confirmationRequest,
      nextActions: normalized.hostVision.required ? normalized.nextActions : [{
        type: 'confirm_once_and_run', tool: 'volatility_workflow.run', checkHash: confirmationRequest.checkHash,
      }],
    }
  }

  async run(input: VolatilityRunInput) {
    const sessionType = input.sessionType || 'manual'
    const reconciliation = await brokerReviewReconciliationService.reconcile(brokerInput(input))
    const confirmationRequest = await this.confirmationRequest(input, reconciliation)
    const confirmationError = this.validateConfirmation(input.confirmation, confirmationRequest.checkHash)
    const uncheckedPreflight = { ...normalizeReconciliation(reconciliation), confirmationRequest }
    if (confirmationError) {
      return {
        schemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
        kind: 'workflow_confirmation_required',
        status: 'confirmation_required',
        id: null,
        operationId: null,
        operation_id: null,
        reviewId: null,
        confirmationError,
        preflight: uncheckedPreflight,
        executionBoundary,
        nextActions: [{ type: 'confirm_once_and_run', tool: 'volatility_workflow.run', checkHash: confirmationRequest.checkHash }],
      }
    }
    const confirmedCaptureIds = Object.fromEntries(confirmationRequest.bundle.captures.map((item: any) => [item.role, item.captureId])) as Record<string, string | null>
    const pinnedInput = {
      ...input,
      holdingsCaptureId: confirmedCaptureIds.holdings || undefined,
      tradesCaptureId: confirmedCaptureIds.trades || undefined,
      ordinaryOrdersCaptureId: confirmedCaptureIds.ordinaryOrders || undefined,
      conditionalOrdersCaptureId: confirmedCaptureIds.conditionalOrders || undefined,
    }
    const singleConfirmation = { confirmedBy: input.confirmation!.confirmedBy.trim(), confirmedAt: input.confirmation!.confirmedAt }
    const confirmedReconciliation = await brokerReviewReconciliationService.reconcile(brokerInput(pinnedInput, singleConfirmation))
    const strategyVersion = reconciliation.strategyState?.version || 'unknown'
    const idempotencyKey = input.idempotencyKey || `volatility:${stableHash({
      userId: input.userId,
      date: shanghaiDate(),
      sessionType,
      strategyVersion,
      holdingsCaptureId: input.holdingsCaptureId || reconciliation.readiness?.captures?.holdings?.captureId || null,
      tradesCaptureId: input.tradesCaptureId || reconciliation.readiness?.captures?.trades?.captureId || null,
      ordinaryOrdersCaptureId: input.ordinaryOrdersCaptureId || reconciliation.readiness?.captures?.ordinaryOrders?.captureId || null,
      conditionalOrdersCaptureId: input.conditionalOrdersCaptureId || reconciliation.readiness?.captures?.conditionalOrders?.captureId || null,
      zeroNewTradesConfirmed: input.zeroNewTradesConfirmed === true,
      zeroOrdinaryOrdersConfirmed: input.zeroOrdinaryOrdersConfirmed === true,
      zeroConditionalOrdersConfirmed: input.zeroConditionalOrdersConfirmed === true,
      checkHash: input.confirmation!.checkHash,
    }).slice(0, 32)}`
    const started = await dailyReviewService.startReview({
      userId: input.userId,
      sessionType,
      triggerSource: 'agent',
      idempotencyKey,
      executionMode: 'queued',
      brokerWorkflow: true,
      brokerReconciliationInput: {
        holdingsCaptureId: pinnedInput.holdingsCaptureId,
        tradesCaptureId: pinnedInput.tradesCaptureId,
        ordinaryOrdersCaptureId: pinnedInput.ordinaryOrdersCaptureId,
        conditionalOrdersCaptureId: pinnedInput.conditionalOrdersCaptureId,
        zeroNewTradesConfirmed: input.zeroNewTradesConfirmed === true,
        zeroOrdinaryOrdersConfirmed: input.zeroOrdinaryOrdersConfirmed === true,
        zeroConditionalOrdersConfirmed: input.zeroConditionalOrdersConfirmed === true,
        singleConfirmation,
        persist: false,
      },
      oneClickContext: {
        volatilityWorkflowSchemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
        hostVisionOnly: true,
        singleConfirmationMode: true,
        singleConfirmation: { ...singleConfirmation, checkHash: input.confirmation!.checkHash },
        executionBoundary,
      },
    })
    const preflight = { ...normalizeReconciliation(confirmedReconciliation), confirmationRequest, singleConfirmationAccepted: true }
    return {
      schemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
      kind: 'workflow_run',
      status: started.operation?.status || 'queued',
      id: started.operation?.id || null,
      operationId: started.operation?.id || null,
      operation_id: started.operation?.id || null,
      progressPct: started.operation?.progressPct ?? 0,
      reviewId: started.review?.id || null,
      reused: started.reused,
      idempotencyKey,
      preflight,
      stages: [
        'strategy_and_user_rules',
        'broker_reconciliation',
        'latest_price_30_closes_ma5_ma10_ma30',
        'daily_relative_rotation',
        'fundamental_and_news_change',
        'strategy_diff',
        'manual_order_drafts',
        'cash_and_risk_gates',
        'json_and_html_report',
      ],
      outputFormats: ['application/json', 'text/html'],
      artifactRefs: started.review?.id ? [`daily-review:${started.review.id}`] : [],
      executionBoundary,
      nextActions: [
        { type: 'poll_result', tool: 'volatility_workflow.get_result', operationId: started.operation?.id },
        ...(preflight.hostVision.required ? preflight.nextActions : []),
      ],
    }
  }

  async decideReanchor(input: VolatilityReanchorDecisionInput) {
    const decision: any = await downtrendReanchorService.decide(input)
    const review = await dailyReviewService.getReview(input.reviewId, input.userId)
    const report = review.report as any
    const operationInput = review.operation?.inputJson
      ? JSON.parse(review.operation.inputJson) as Record<string, any>
      : {}
    const decidedAt = new Date()
    const currentGate = report.reanchorGate || {}
    const candidates = Array.isArray(currentGate.candidates)
      ? currentGate.candidates.map((candidate: any) => candidate.candidateStrategyVersionId === input.versionId
        ? {
            ...candidate,
            state: decision.status === 'blocked' ? candidate.state : 'decision_recorded',
            ...(decision.status === 'blocked' ? {} : {
              decision: {
                value: input.decision,
                confirmedBy: input.confirmedBy,
                reason: input.reason || null,
                decidedAt: decidedAt.toISOString(),
                acknowledgedNoBrokerExecution: input.acknowledgedNoBrokerExecution,
              },
            }),
          }
        : candidate)
      : []

    if (decision.status !== 'resolved') {
      const nextReport = {
        ...report,
        reanchorGate: {
          ...currentGate,
          state: decision.status === 'blocked' ? 'blocked' : 'awaiting_confirmation',
          candidates,
          lastDecisionResult: decision,
        },
      }
      await prisma.dailyReviewRun.update({ where: { id: review.id }, data: { reportJson: JSON.stringify(nextReport) } })
      return {
        schemaVersion: 'fams.reanchor-decision-result.v1',
        reviewId: review.id,
        decision,
        continuation: null,
        executionBoundary,
        nextActions: decision.status === 'awaiting_other_decisions'
          ? [{ type: 'decide_remaining_candidates', tool: 'volatility_workflow.decide_reanchor', candidates: decision.remainingCandidates }]
          : [{ type: 'rerun_workflow_with_fresh_evidence', tool: 'volatility_workflow.run' }],
      }
    }

    const resolvedReport = {
      ...report,
      reanchorGate: {
        ...currentGate,
        state: 'resolved',
        ordersActionable: false,
        originalDraftsRemainBlocked: true,
        candidates,
        decisions: decision.decisions,
        confirmedVersionIds: decision.confirmedVersionIds,
        rejectedSymbols: decision.rejectedSymbols,
        resolvedAt: decidedAt.toISOString(),
        continuationRequired: true,
      },
    }
    await prisma.$transaction([
      prisma.dailyReviewRun.update({
        where: { id: review.id },
        data: { status: 'reanchor_resolved', completedAt: decidedAt, reportJson: JSON.stringify(resolvedReport) },
      }),
      ...(review.operationId ? [prisma.operation.update({
        where: { id: review.operationId },
        data: {
          status: 'reanchor_resolved',
          completedAt: decidedAt,
          progressPct: 100,
          progressMessage: '固定网格重锚决定已全部记录；旧拟单继续阻断，正在生成续跑复盘',
          resultJson: JSON.stringify({ reviewId: review.id, status: 'reanchor_resolved', reanchorGate: resolvedReport.reanchorGate }),
        },
      })] : []),
    ])

    const continuation = await dailyReviewService.startReview({
      userId: input.userId,
      sessionType: review.sessionType as DailyReviewSession,
      triggerSource: 'agent',
      idempotencyKey: `reanchor-continuation:${review.id}`,
      executionMode: 'queued',
      previousRunId: review.id,
      brokerWorkflow: operationInput.brokerWorkflow === true,
      brokerReconciliationInput: operationInput.brokerReconciliationInput || undefined,
      requireLlmSuccess: operationInput.requireLlmSuccess === true,
      oneClickContext: {
        ...(operationInput.oneClickContext || {}),
        volatilityWorkflowSchemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
        hostVisionOnly: true,
        executionBoundary,
        reanchorDecisionContext: {
          sourceReviewId: review.id,
          confirmedVersionIds: decision.confirmedVersionIds,
          rejectedSymbols: decision.rejectedSymbols,
          decisions: decision.decisions,
        },
      },
    })
    const finalReport = {
      ...resolvedReport,
      reanchorGate: {
        ...resolvedReport.reanchorGate,
        continuationReviewId: continuation.review?.id || null,
        continuationOperationId: continuation.operation?.id || null,
      },
    }
    await prisma.dailyReviewRun.update({ where: { id: review.id }, data: { reportJson: JSON.stringify(finalReport) } })
    return {
      schemaVersion: 'fams.reanchor-decision-result.v1',
      reviewId: review.id,
      decision,
      continuation: {
        reviewId: continuation.review?.id || null,
        operationId: continuation.operation?.id || null,
        status: continuation.operation?.status || 'queued',
        reused: continuation.reused,
      },
      executionBoundary,
      nextActions: [{
        type: 'poll_continuation_result',
        tool: 'volatility_workflow.get_result',
        operationId: continuation.operation?.id || null,
      }],
    }
  }

  async getResult(input: VolatilityResultInput) {
    if (Boolean(input.operationId) === Boolean(input.reviewId)) {
      throw new Error('exactly_one_of_operationId_or_reviewId_is_required')
    }
    let reviewId = input.reviewId || null
    let operation: any = null
    if (input.operationId) {
      const owned = await prisma.operation.findFirst({
        where: { id: input.operationId, userId: input.userId },
        select: { id: true },
      })
      if (!owned) throw new Error('Operation not found for default user')
      operation = await operationService.getOperation(input.operationId, input.userId)
      const linked = await prisma.dailyReviewRun.findFirst({
        where: { operationId: input.operationId, userId: input.userId },
        select: { id: true },
      })
      reviewId = linked?.id || null
    }
    if (!reviewId) {
      return {
        schemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
        kind: 'workflow_result',
        status: operation?.status || 'queued',
        operation,
        review: null,
        executionBoundary,
      }
    }
    const review = await dailyReviewService.getReview(reviewId, input.userId)
    if (!operation && review.operationId) operation = await operationService.getOperation(review.operationId, input.userId)
    const reportAvailable = ['completed', 'partial', 'awaiting_reanchor_confirmation', 'reanchor_resolved'].includes(review.status)
    const complete = ['completed', 'partial'].includes(review.status)
    const html = reportAvailable && input.includeHtml !== false
      ? await dailyReviewHtmlService.render(review.id, input.userId)
      : null
    return {
      schemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
      kind: 'workflow_result',
      status: review.status,
      operation,
      review: {
        id: review.id,
        operationId: review.operationId,
        sessionType: review.sessionType,
        generatedAt: review.generatedAt,
        completedAt: review.completedAt,
        dataQuality: review.dataQuality,
        strategyVersionIds: review.strategyVersionIds,
        report: review.report,
      },
      artifacts: {
        jsonResourceUri: `fams://volatility/reviews/${review.id}`,
        html: html ? { filename: html.filename, contentType: 'text/html; charset=utf-8', content: html.html } : null,
      },
      executionBoundary,
      nextActions: review.status === 'awaiting_reanchor_confirmation'
        ? (Array.isArray((review.report as any)?.reanchorGate?.candidates)
            ? (review.report as any).reanchorGate.candidates
              .filter((candidate: any) => !candidate.decision)
              .map((candidate: any) => ({
                type: 'decide_reanchor_candidate',
                tool: 'volatility_workflow.decide_reanchor',
                reviewId: review.id,
                versionId: candidate.candidateStrategyVersionId,
                candidateHash: candidate.candidateHash,
                symbol: candidate.symbol,
              }))
            : [])
        : review.status === 'reanchor_resolved' && (review.report as any)?.reanchorGate?.continuationOperationId
          ? [{
              type: 'poll_continuation_result',
              tool: 'volatility_workflow.get_result',
              operationId: (review.report as any).reanchorGate.continuationOperationId,
            }]
          : complete
            ? [{ type: 'manual_broker_review', message: '在同花顺查重、核对可卖数量和现金后由用户手工操作。' }]
            : [{
                type: 'poll_result',
                tool: 'volatility_workflow.get_result',
                ...(review.operationId ? { operationId: review.operationId } : { reviewId: review.id }),
              }],
    }
  }

  async getReviewResource(reviewId: string, userId: string) {
    const result = await this.getResult({ userId, reviewId, includeHtml: false })
    return result
  }

  async getLatestReconciledResource(userId: string) {
    const latest = await dailyReviewService.getLatest(userId)
    const latestReport = latest?.report as any
    if (latestReport?.reconciliation) return normalizeReconciliation(latestReport.reconciliation)
    return this.reconcile({ userId, sessionType: 'manual' })
  }
}

export const volatilityWorkflowService = new VolatilityWorkflowService()
