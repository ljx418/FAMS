import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../../db/prisma.js'
import { operationService } from '../operation/operationService.js'
import { brokerReviewReconciliationService, type BrokerReviewReconciliationInput } from './brokerReviewReconciliationService.js'
import { dailyReviewHtmlService } from './dailyReviewHtmlService.js'
import { dailyReviewService, type DailyReviewSession } from './dailyReviewService.js'

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
}

export interface VolatilityReconcileInput extends VolatilityCaptureInput {
  userId: string
  sessionType?: DailyReviewSession
}

export interface VolatilityRunInput extends VolatilityReconcileInput {
  idempotencyKey?: string
}

export interface VolatilityResultInput {
  userId: string
  operationId?: string
  reviewId?: string
  includeHtml?: boolean
}

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

function brokerInput(input: VolatilityReconcileInput): BrokerReviewReconciliationInput {
  return {
    userId: input.userId,
    sessionType: input.sessionType,
    holdingsCaptureId: input.holdingsCaptureId,
    tradesCaptureId: input.tradesCaptureId,
    ordinaryOrdersCaptureId: input.ordinaryOrdersCaptureId,
    conditionalOrdersCaptureId: input.conditionalOrdersCaptureId,
    zeroNewTradesConfirmed: input.zeroNewTradesConfirmed === true,
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

  async getActiveStrategyResource() {
    const { sourcePath, state } = await this.readStrategyState()
    return {
      schemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
      kind: 'active_strategy',
      sourcePath,
      strategyVersion: state.strategy_version || null,
      preparedOn: state.prepared_on || null,
      authorization: state.authorization || null,
      gridPolicy: state.grid_policy || null,
      positions: state.positions || [],
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
      executionBoundary,
    }
  }

  async reconcile(input: VolatilityReconcileInput) {
    const reconciliation = await brokerReviewReconciliationService.reconcile(brokerInput(input))
    return normalizeReconciliation(reconciliation)
  }

  async run(input: VolatilityRunInput) {
    const sessionType = input.sessionType || 'manual'
    const reconciliation = await brokerReviewReconciliationService.reconcile(brokerInput(input))
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
    }).slice(0, 32)}`
    const started = await dailyReviewService.startReview({
      userId: input.userId,
      sessionType,
      triggerSource: 'agent',
      idempotencyKey,
      executionMode: 'queued',
      brokerWorkflow: true,
      brokerReconciliationInput: {
        holdingsCaptureId: input.holdingsCaptureId,
        tradesCaptureId: input.tradesCaptureId,
        ordinaryOrdersCaptureId: input.ordinaryOrdersCaptureId,
        conditionalOrdersCaptureId: input.conditionalOrdersCaptureId,
        zeroNewTradesConfirmed: input.zeroNewTradesConfirmed === true,
      },
      oneClickContext: {
        volatilityWorkflowSchemaVersion: VOLATILITY_WORKFLOW_SCHEMA_VERSION,
        hostVisionOnly: true,
        executionBoundary,
      },
    })
    const preflight = normalizeReconciliation(reconciliation)
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
    const complete = ['completed', 'partial'].includes(review.status)
    const html = complete && input.includeHtml !== false
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
      nextActions: complete
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
