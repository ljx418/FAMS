import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { analysisService } from '../src/services/analysis/analysisService.js'
import { ALIPAY_ALLOCATION_STRATEGY } from '../src/services/allocation/alipayAllocationStrategy.js'
import { allocationPolicyService, buildAllocationPlanFromPositions, type AllocationPositionInput } from '../src/services/allocation/allocationPolicyService.js'
import { alipayOneClickReviewService } from '../src/services/review/alipayOneClickReviewService.js'
import { alipayResearchWorkflowService } from '../src/services/review/alipayResearchWorkflowService.js'

const USER_ID = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'
const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

async function protectedCounts() {
  const [positions, transactions, externalOrders] = await Promise.all([
    prisma.position.count({ where: { userId: USER_ID } }),
    prisma.transaction.count({ where: { userId: USER_ID } }),
    prisma.externalOrderObservation.count({ where: { userId: USER_ID } }),
  ])
  return { positions, transactions, externalOrders }
}

const boundaryPosition = (bucket: '现金' | '黄金' | '债券' | '权益', value: number): AllocationPositionInput => ({
  marketValue: value,
  tags: JSON.stringify([`支付宝·${bucket}`]),
  labels: JSON.stringify(['账户:支付宝', `资产桶:${bucket}`]),
  asset: { type: bucket === '现金' ? 'cash' : 'fund', symbol: `TEST-${bucket}`, name: `测试${bucket}` },
})

async function main() {
  const before = await protectedCounts()
  const [plan, preflight, workflowConfig] = await Promise.all([
    allocationPolicyService.getCurrentPlan(USER_ID),
    alipayOneClickReviewService.preflight({ userId: USER_ID, portfolioChangedSinceLastCapture: false }),
    alipayResearchWorkflowService.getConfig(USER_ID),
  ])
  const alipay = plan.accounts.find((account) => account.id === 'alipay')
  assert.ok(alipay)
  assert.equal(plan.schemaVersion, 'fams.approved-allocation-plan.v3')
  assert.equal(plan.strategyContract.id, ALIPAY_ALLOCATION_STRATEGY.id)
  assert.equal(plan.strategyContract.status, 'active')
  assert.deepEqual(plan.strategyContract.weights, ALIPAY_ALLOCATION_STRATEGY.weights)
  assert.deepEqual(
    alipay.buckets.map((bucket) => [bucket.key, bucket.targetRatio]),
    [['cash', 10], ['gold', 15], ['bond', 50], ['equity', 25]],
  )
  assert.equal(money(alipay.currentValue), money(Number(preflight.sourceSnapshot?.statedTotal)))
  assert.equal(money(alipay.buckets.reduce((sum, bucket) => sum + bucket.targetValue, 0)), money(alipay.currentValue))
  assert.equal(preflight.sourceSnapshot?.reconciliation, 'exact')
  assert.equal(preflight.currentPortfolio.captureVariance, 0)
  assert.equal(preflight.canRun, true, `preflight blocked: ${preflight.blockers.join(',')}`)
  assert.equal(plan.strategyActions.rebalanceRequired, false)
  assert.deepEqual(plan.strategyActions.triggeredBuckets, [])
  assert.deepEqual(plan.strategyActions.equityExits, [])
  assert.deepEqual(plan.strategyActions.equityBuys, [])

  const context = await analysisService.getAlipayOneClickContext(USER_ID, { refreshRrg: false })
  assert.deepEqual(context.tradeDrafts, [], 'within-threshold portfolio must create zero trade drafts')
  assert.equal(workflowConfig.contract.actualAllocationContract.id, ALIPAY_ALLOCATION_STRATEGY.id)
  assert.deepEqual(workflowConfig.contract.actualAllocationContract.weights, ALIPAY_ALLOCATION_STRATEGY.weights)
  assert.equal(workflowConfig.contract.researchComparisonContract.id, 'alipay_research_10_25_40_25_v1')

  const exactBoundary = buildAllocationPlanFromPositions([
    boundaryPosition('现金', 13),
    boundaryPosition('黄金', 15),
    boundaryPosition('债券', 47),
    boundaryPosition('权益', 25),
  ])
  assert.equal(exactBoundary.strategyActions.rebalanceRequired, false, 'exactly 3pp must not trigger')
  assert.deepEqual(exactBoundary.strategyActions.equityExits, [])
  assert.deepEqual(exactBoundary.strategyActions.equityBuys, [])

  const overBoundary = buildAllocationPlanFromPositions([
    boundaryPosition('现金', 13.01),
    boundaryPosition('黄金', 15),
    boundaryPosition('债券', 46.99),
    boundaryPosition('权益', 25),
  ])
  assert.equal(overBoundary.strategyActions.rebalanceRequired, true, 'strictly greater than 3pp must trigger')

  const after = await protectedCounts()
  assert.deepEqual(after, before, 'verification must not mutate positions, transactions, or external orders')
  process.stdout.write(`${JSON.stringify({
    status: 'passed',
    strategy: plan.strategyContract,
    sourceSnapshot: preflight.sourceSnapshot,
    currentTotal: alipay.currentValue,
    buckets: alipay.buckets.map((bucket) => ({
      key: bucket.key,
      currentRatio: bucket.currentRatio,
      targetRatio: bucket.targetRatio,
      deviationPctPoint: bucket.deviationPctPoint,
      gapValue: bucket.gapValue,
      triggered: bucket.triggered,
    })),
    rebalanceRequired: plan.strategyActions.rebalanceRequired,
    tradeDraftCount: context.tradeDrafts.length,
    boundary: { exactly3ppTriggered: false, above3ppTriggered: true },
    protectedTablesUnchanged: true,
  }, null, 2)}\n`)
}

main().finally(() => prisma.$disconnect())
