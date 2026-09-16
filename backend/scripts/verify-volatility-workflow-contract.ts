import assert from 'node:assert/strict'
import { brokerReviewReconciliationService } from '../src/services/review/brokerReviewReconciliationService.js'
import { dailyReviewService } from '../src/services/review/dailyReviewService.js'
import { volatilityWorkflowService } from '../src/services/review/volatilityWorkflowService.js'

const reconciliation = {
  schemaVersion: 'fams.daily-review-reconciliation.v1',
  generatedAt: '2026-09-12T07:00:00.000Z',
  sessionType: 'pre_close',
  strategyState: { version: 'fams.grid-strategy.v2', gridMode: 'downtrend_defensive' },
  readiness: {
    researchAllowed: true,
    requiredInputsReady: true,
    holdingsFieldsComplete: true,
    ordersFullyReconciled: false,
    draftStatus: 'manual_dedup_required',
    captures: {
      holdings: { captureId: 'holding-capture', fresh: true },
      trades: { captureId: 'trade-capture', fresh: true },
      ordinaryOrders: { captureId: null, fresh: false },
      conditionalOrders: { captureId: null, fresh: false },
    },
  },
  confirmedFacts: {
    positions: [{ symbol: '600276', quantity: '800', sellableQuantity: '800' }],
    account: { availableCash: '34210.77' },
    historicalFillsAlreadyIncludedInSnapshot: true,
    doNotReplayHistoricalFills: true,
  },
  reconciliationDifferences: [{ scope: 'capture', role: 'ordinary_orders', action: 'manual_dedup' }],
  pendingRules: [],
  proposedOrders: {
    retained: [],
    cancelCandidates: [],
    addCandidates: [{ symbol: '600276', disposition: 'manual_dedup' }],
    blocked: [{ symbol: '601127', blocker: 'awaiting_parent_fill' }],
  },
  executionPermission: { canCreateOrder: false, autoTradeUnlocked: false },
}

const originalReconcile = brokerReviewReconciliationService.reconcile.bind(brokerReviewReconciliationService)
const originalStart = dailyReviewService.startReview.bind(dailyReviewService)
let capturedStartInput: any = null

try {
  ;(brokerReviewReconciliationService as any).reconcile = async () => reconciliation
  ;(dailyReviewService as any).startReview = async (input: any) => {
    capturedStartInput = input
    return {
      operation: { id: 'operation-test', status: 'queued' },
      review: { id: 'review-test' },
      reused: false,
    }
  }

  const preflight = await volatilityWorkflowService.reconcile({ userId: 'default', sessionType: 'pre_close' })
  assert.equal(preflight.schemaVersion, 'fams.volatility-workflow.v1')
  assert.equal(preflight.status, 'completed')
  assert.equal(preflight.readiness.actionDraftsAllowed, true)
  assert.equal(preflight.readiness.ordersFullyReconciled, false)
  assert.equal(preflight.fivePartReport.proposedOrders.addCandidates[0].disposition, 'manual_dedup')
  assert.equal(preflight.fivePartReport.proposedOrders.blocked[0].blocker, 'awaiting_parent_fill')
  assert.equal(preflight.fivePartReport.confirmedFacts.doNotReplayHistoricalFills, true)
  assert.equal(preflight.executionBoundary.canCreateOrder, false)

  const run = await volatilityWorkflowService.run({ userId: 'default', sessionType: 'pre_close' })
  assert.equal(run.operationId, 'operation-test')
  assert.equal(run.operation_id, 'operation-test')
  assert.equal(run.reviewId, 'review-test')
  assert.deepEqual(run.outputFormats, ['application/json', 'text/html'])
  assert(run.stages.includes('latest_price_30_closes_ma5_ma10_ma30'))
  assert(run.stages.includes('daily_relative_rotation'))
  assert(run.stages.includes('fundamental_and_news_change'))
  assert.equal(run.executionBoundary.orderCreateAllowed, false)
  assert.deepEqual(run.nextActions[0], {
    type: 'poll_result', tool: 'volatility_workflow.get_result', operationId: 'operation-test',
  })
  assert.equal(capturedStartInput.brokerWorkflow, true)
  assert.equal(capturedStartInput.executionMode, 'queued')
  assert.equal(capturedStartInput.oneClickContext.hostVisionOnly, true)
  assert.match(capturedStartInput.idempotencyKey, /^volatility:[a-f0-9]{32}$/)

  process.stdout.write(JSON.stringify({
    status: 'PASS',
    schemaVersion: run.schemaVersion,
    stages: run.stages,
    manualDedupPreserved: true,
    parentFillGatePreserved: true,
    historicalFillReplayBlocked: true,
    brokerOrdersCreated: 0,
  }, null, 2) + '\n')
} finally {
  ;(brokerReviewReconciliationService as any).reconcile = originalReconcile
  ;(dailyReviewService as any).startReview = originalStart
}
