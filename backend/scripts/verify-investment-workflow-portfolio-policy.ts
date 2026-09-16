import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import {
  ALIPAY_ALLOCATION_STRATEGY,
  ALIPAY_PERMANENT_PORTFOLIO_STRATEGY,
  resolveAlipayAllocationStrategy,
} from '../src/services/allocation/alipayAllocationStrategy.js'
import { allocationPolicyService, buildAllocationPlanFromPositions, type AllocationPositionInput } from '../src/services/allocation/allocationPolicyService.js'

const userId = `wf4-portfolio-policy-${Date.now()}`
const beforeExpiry = new Date('2026-12-31T15:59:59.000Z')
const afterExpiry = new Date('2026-12-31T16:00:00.000Z')

const position = (bucket: '现金' | '黄金' | '债券' | '权益', value: number): AllocationPositionInput => ({
  marketValue: value,
  tags: JSON.stringify([`支付宝·${bucket}`]),
  labels: JSON.stringify(['账户:支付宝', `资产桶:${bucket}`]),
  asset: { type: bucket === '现金' ? 'cash' : 'fund', symbol: `WF4-${bucket}`, name: `WF4 ${bucket}` },
})

const samplePositions = [
  position('现金', 10),
  position('黄金', 15),
  position('债券', 50),
  position('权益', 25),
]

async function protectedCounts() {
  const [positions, transactions] = await Promise.all([
    prisma.position.count(),
    prisma.transaction.count(),
  ])
  return { positions, transactions }
}

async function main() {
  const globalBefore = await protectedCounts()
  const currentRealPlan = await allocationPolicyService.getCurrentPlan('default')
  assert.equal(currentRealPlan.strategyContract.status, 'active', 'real current date must keep the approved high-defense strategy active')
  assert.equal(currentRealPlan.strategyContract.id, ALIPAY_ALLOCATION_STRATEGY.id)

  const boundaryResolution = resolveAlipayAllocationStrategy({}, beforeExpiry)
  assert.equal(boundaryResolution.status, 'active', '2026-12-31 Shanghai must remain active')
  const expiredResolution = resolveAlipayAllocationStrategy({}, afterExpiry)
  assert.equal(expiredResolution.status, 'transition_confirmation_required')
  assert.equal(expiredResolution.manualDraftAllowed, false)

  const expiredPlan = buildAllocationPlanFromPositions(samplePositions, { asOf: afterExpiry })
  assert.equal(expiredPlan.status, 'confirmation_required')
  assert.equal(expiredPlan.strategyActions.rebalanceRequired, false)
  assert.deepEqual(expiredPlan.strategyActions.triggeredBuckets, [])
  assert.equal(expiredPlan.executionBoundary.manualDraftAllowed, false)
  assert.equal(expiredPlan.executionBoundary.createsBrokerOrder, false)

  await prisma.user.create({
    data: {
      id: userId,
      email: `${userId}@local.test`,
      name: 'WF4 portfolio policy contract user',
      passwordHash: 'wf4-contract-no-login',
    },
  })

  await assert.rejects(
    () => allocationPolicyService.confirmPermanentPortfolioStrategy({
      userId,
      confirmed: true,
      confirmedBy: 'wf4-contract',
      asOf: beforeExpiry,
    }),
    /不能提前切换/,
  )

  const confirmedPlan = await allocationPolicyService.confirmPermanentPortfolioStrategy({
    userId,
    confirmed: true,
    confirmedBy: 'wf4-contract',
    asOf: afterExpiry,
  })
  assert.equal(confirmedPlan.strategyContract.id, ALIPAY_PERMANENT_PORTFOLIO_STRATEGY.id)
  assert.equal(confirmedPlan.strategyContract.status, 'permanent_active')
  assert.deepEqual(confirmedPlan.strategyContract.weights, { cash: 25, gold: 25, bond: 25, equity: 25 })
  assert.equal(confirmedPlan.strategyTransition.confirmation?.confirmedBy, 'wf4-contract')
  assert.equal(confirmedPlan.executionBoundary.createsBrokerOrder, false)
  assert.equal(confirmedPlan.executionBoundary.formalTradingUnlocked, false)
  assert.equal(confirmedPlan.executionBoundary.autoTradeUnlocked, false)
  assert.equal(confirmedPlan.executionBoundary.canCreateOrder, false)
  assert.equal(confirmedPlan.executionBoundary.orderCreateAllowed, false)

  const repeatedPlan = await allocationPolicyService.confirmPermanentPortfolioStrategy({
    userId,
    confirmed: true,
    confirmedBy: 'different-retry-identity',
    asOf: new Date('2027-01-02T00:00:00.000Z'),
  })
  assert.equal(repeatedPlan.strategyTransition.confirmation?.confirmedBy, 'wf4-contract', 'one-time confirmation must be idempotent')

  const storedUser = await prisma.user.findUniqueOrThrow({ where: { id: userId } })
  const settings = JSON.parse(storedUser.settings || '{}')
  assert.equal(settings.alipayAllocationStrategyTransition.confirmed, true)
  assert.equal(settings.alipayAllocationStrategyTransition.toStrategyId, ALIPAY_PERMANENT_PORTFOLIO_STRATEGY.id)

  const globalAfter = await protectedCounts()
  assert.deepEqual(globalAfter, globalBefore, 'WF-4 strategy confirmation must not create positions or transactions')

  const output = {
    schemaVersion: 'fams.investment-workflow.portfolio-policy-audit.v1',
    status: 'passed',
    realCurrentState: {
      checkedAt: new Date().toISOString(),
      strategyId: currentRealPlan.strategyContract.id,
      strategyStatus: currentRealPlan.strategyContract.status,
      capturedAt: currentRealPlan.capturedAt,
      totalAssetValue: currentRealPlan.totalAssetValue,
    },
    boundaryContract: {
      lastActiveInstant: beforeExpiry.toISOString(),
      firstConfirmationRequiredInstant: afterExpiry.toISOString(),
      earlyConfirmationBlocked: true,
      expiredDraftBlocked: true,
      oneTimeConfirmationPersisted: true,
      repeatedConfirmationIdempotent: true,
      permanentWeights: confirmedPlan.strategyContract.weights,
    },
    protectedTablesUnchanged: globalAfter,
    permissionState: {
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }
  const evidenceDir = resolve(process.cwd(), '../docs/automation-audits/investment-workflow/WF-4/evidence')
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(resolve(evidenceDir, 'portfolio-policy-transition-audit.json'), JSON.stringify(output, null, 2))
  console.log(JSON.stringify(output, null, 2))
}

main().finally(async () => {
  await prisma.user.deleteMany({ where: { id: userId } })
  await prisma.$disconnect()
}).catch((error) => {
  console.error(error)
  process.exitCode = 1
})
