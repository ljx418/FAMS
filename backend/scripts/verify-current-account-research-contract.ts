import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { prisma } from '../src/db/prisma.js'
import { allocationPolicyService } from '../src/services/allocation/allocationPolicyService.js'
import { alipayOneClickReviewService } from '../src/services/review/alipayOneClickReviewService.js'

const USER_ID = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function assertLockedBoundary(boundary: Record<string, unknown>) {
  assert.equal(boundary.formalTradingUnlocked, false)
  assert.equal(boundary.autoTradeUnlocked, false)
  assert.equal(boundary.canCreateOrder, false)
  assert.equal(boundary.orderCreateAllowed, false)
}

async function protectedCounts() {
  const [positions, transactions, externalOrders] = await Promise.all([
    prisma.position.count({ where: { userId: USER_ID } }),
    prisma.transaction.count({ where: { userId: USER_ID } }),
    prisma.externalOrderObservation.count(),
  ])
  return { positions, transactions, externalOrders }
}

async function main() {
  const before = await protectedCounts()
  const [preflight, changedPreflight, plan] = await Promise.all([
    alipayOneClickReviewService.preflight({ userId: USER_ID, portfolioChangedSinceLastCapture: false }),
    alipayOneClickReviewService.preflight({ userId: USER_ID, portfolioChangedSinceLastCapture: true }),
    allocationPolicyService.getCurrentPlan(USER_ID),
  ])

  const snapshot = preflight.sourceSnapshot as Record<string, unknown> | null
  assert.equal(preflight.canRun, true, `current snapshot preflight blocked: ${preflight.blockers.join(',')}`)
  assert.equal(snapshot?.reconciliation, 'exact')
  assert.ok(Number(snapshot?.holdingRows) > 0)
  assert.ok(Number(snapshot?.statedTotal) > 0)
  assert.equal(money(Number(snapshot?.statedTotal)), money(Number(snapshot?.calculatedTotal)))
  assert.equal(money(Number(preflight.currentPortfolio.captureVariance)), 0)
  assert.equal(preflight.currentPortfolio.classificationStatus, 'complete')

  const captureTime = Date.parse(String(snapshot?.confirmedAt || snapshot?.capturedAt || ''))
  const previousReviewTime = Date.parse(String(changedPreflight.previousOneClickReview?.generatedAt || ''))
  const hasNewCaptureSincePreviousReview = Number.isFinite(captureTime)
    && Number.isFinite(previousReviewTime)
    && captureTime > previousReviewTime
  assert.equal(changedPreflight.canRun, hasNewCaptureSincePreviousReview)
  assert.equal(
    changedPreflight.blockers.includes('new_alipay_portfolio_capture_required'),
    !hasNewCaptureSincePreviousReview,
  )

  const account = plan.accounts.find((item) => item.id === 'alipay')
  assert.ok(account)
  assert.equal(money(account.currentValue), money(Number(snapshot?.statedTotal)))
  assert.deepEqual(
    account.buckets.map((bucket) => [bucket.key, bucket.targetRatio]),
    [['cash', 5], ['gold', 25], ['bond', 25], ['equity', 45]],
  )
  assert.equal(money(account.buckets.reduce((sum, bucket) => sum + bucket.currentValue, 0)), money(account.currentValue))
  assert.equal(money(account.buckets.reduce((sum, bucket) => sum + bucket.targetValue, 0)), money(account.currentValue))
  assert.deepEqual(plan.strategyActions.trancheRatios, [0.25, 0.25, 0.25, 0.25])
  for (const value of [
    plan.strategyActions.bondReductionTarget,
    plan.strategyActions.goldIncreaseTarget,
    plan.strategyActions.equityNetIncreaseTarget,
    plan.strategyActions.cashIncreaseTarget,
  ]) {
    assert.ok(Number.isFinite(value) && value >= 0)
  }
  assert.equal(plan.executionBoundary.createsBrokerOrder, false)
  assert.equal(plan.executionBoundary.humanConfirmationRequired, true)

  const result = await alipayOneClickReviewService.start({
    userId: USER_ID,
    sessionType: 'manual',
    portfolioChangedSinceLastCapture: false,
    idempotencyKey: `current-account-contract:${new Date().toISOString()}:${randomUUID()}`,
    triggerSource: 'user',
  })
  assert.equal(result.started, true, `one-click review blocked: ${result.preflight.blockers.join(',')}`)
  assert.ok(result.review)
  let resolvedReview: any = result.review
  let report = JSON.parse(result.review.reportJson || '{}') as any
  let llmRetryCount = 0
  const retryableLlmFailures = new Set([
    'llm_numeric_narrative_rejected',
    'llm_request_failed',
    'llm_json_invalid',
    'llm_schema_invalid',
  ])
  while (
    resolvedReview.status === 'failed'
    && retryableLlmFailures.has(report.llmGate?.failureCode)
    && llmRetryCount < 2
  ) {
    resolvedReview = await alipayOneClickReviewService.retryLlm({
      userId: USER_ID,
      reviewId: result.review.id,
    })
    report = resolvedReview.report
    llmRetryCount += 1
  }
  assert.equal(resolvedReview.status, 'completed')
  assert.equal(report.oneClickWorkflow?.sourceSnapshot?.captureId, snapshot?.captureId)
  assert.equal(report.llmGate?.required, true)
  assert.equal(report.llmGate?.passed, true)
  assert.equal(report.llmSynthesis?.source, 'llm')
  assert.equal(report.oneClickWorkflow?.readyForHumanReview, true)
  assert.equal(report.oneClickWorkflow?.draftAvailability, 'manual_confirmation_required')
  assert.equal(Array.isArray(report.errors), true)
  assert.equal(report.errors.length, 0)
  assertLockedBoundary(report.executionBoundary || {})

  const drafts = Array.isArray(report.oneClickWorkflow?.tradeDrafts)
    ? report.oneClickWorkflow.tradeDrafts
    : []
  assert.ok(drafts.length > 0)
  for (const draft of drafts) {
    assert.ok(Number.isFinite(Number(draft.fullAmount)) && Number(draft.fullAmount) >= 0)
    assert.ok(Number.isFinite(Number(draft.firstTrancheAmount)) && Number(draft.firstTrancheAmount) >= 0)
    assert.ok(Number(draft.firstTrancheAmount) <= Number(draft.fullAmount))
    assert.ok(draft.adviceActionId)
  }

  assert.ok(result.comparison)
  assert.equal(result.comparison?.operation.status, 'completed')
  assert.equal(result.context.workflowContract.contract.executionBoundary.createsExternalOrder, false)
  assert.deepEqual(
    result.comparison?.summary?.prohibitedActions,
    ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
  )

  const postRunChangedPreflight = await alipayOneClickReviewService.preflight({
    userId: USER_ID,
    portfolioChangedSinceLastCapture: true,
  })
  assert.equal(postRunChangedPreflight.canRun, false)
  assert.ok(postRunChangedPreflight.blockers.includes('new_alipay_portfolio_capture_required'))

  const after = await protectedCounts()
  assert.deepEqual(after, before)

  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    sourceAsOfDate: snapshot?.asOfDate || snapshot?.capturedAt || snapshot?.confirmedAt,
    holdingRows: snapshot?.holdingRows,
    allocationBuckets: account.buckets.length,
    reviewStatus: resolvedReview.status,
    reviewedAssets: Array.isArray(report.assets) ? report.assets.length : 0,
    draftCount: drafts.length,
    comparisonStatus: result.comparison?.operation.status,
    llm: {
      source: report.llmSynthesis?.source,
      modelConfigured: Boolean(report.llmSynthesis?.model),
      retryCount: llmRetryCount,
    },
    protectedTablesUnchanged: true,
    executionBoundary: report.executionBoundary,
  }, null, 2)}\n`)
}

main().finally(() => prisma.$disconnect())
