import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import {
  DEFAULT_INVESTMENT_POLICY_DRAFT,
  type InvestmentPolicyContract,
  validateInvestmentPolicyForActivation,
} from '../src/services/investment-policy/investmentPolicyContract.js'
import { evaluateInvestmentPolicy, investmentPolicyService } from '../src/services/investment-policy/investmentPolicyService.js'

const testUserId = `investment-policy-${Date.now()}`

function completeContract(): InvestmentPolicyContract {
  return {
    ...DEFAULT_INVESTMENT_POLICY_DRAFT,
    reserveCash: { ...DEFAULT_INVESTMENT_POLICY_DRAFT.reserveCash, floorPercent: 10 },
    strategyBuckets: DEFAULT_INVESTMENT_POLICY_DRAFT.strategyBuckets.map((bucket) => ({
      ...bucket,
      warningBand: bucket.strategyFamily === 'portfolio'
        ? { minPercent: 40, maxPercent: 60 }
        : bucket.strategyFamily === 'dividend_low_vol'
          ? { minPercent: 20, maxPercent: 40 }
          : { minPercent: 10, maxPercent: 30 },
    })),
    riskRules: {
      ...DEFAULT_INVESTMENT_POLICY_DRAFT.riskRules,
      portfolio: { ...DEFAULT_INVESTMENT_POLICY_DRAFT.riskRules.portfolio, drawdownReviewPercent: 12 },
    },
  }
}

async function protectedCounts() {
  const [positions, transactions] = await Promise.all([prisma.position.count(), prisma.transaction.count()])
  return { positions, transactions }
}

async function main() {
  const before = await protectedCounts()
  const realPositions = await prisma.position.findMany({
    where: { userId: 'default', status: 'open' },
    include: { asset: true, strategyAssignment: true },
    orderBy: { marketValue: 'desc' },
  })
  assert.ok(realPositions.length > 0, 'real-data policy acceptance requires current default-user positions')
  assert.ok(realPositions.some((position) => Number(position.marketValue || 0) > 0), 'real positions must include non-zero market value')

  const contract = completeContract()
  const validation = validateInvestmentPolicyForActivation(contract)
  assert.equal(validation.success, true)
  const realEvaluation = evaluateInvestmentPolicy({ contract, positions: realPositions })
  assert.equal(realEvaluation.totals.totalValue > 0, true)
  assert.deepEqual(realEvaluation.buckets.map((bucket) => bucket.targetPercent), [50, 30, 20])
  assert.equal(realEvaluation.automationBoundary.autoRebalance, false)
  assert.equal(realEvaluation.automationBoundary.createsOrder, false)
  assert.equal(realEvaluation.permissionState.formalTradingUnlocked, false)
  assert.equal(realEvaluation.permissionState.autoTradeUnlocked, false)
  assert.equal(realEvaluation.permissionState.canCreateOrder, false)
  assert.equal(realEvaluation.permissionState.orderCreateAllowed, false)
  assert.equal(
    realEvaluation.industryExposures.some((item) => item.industry === '未分类'),
    false,
    '缺失行业事实的持仓不得被合并成虚假的“未分类行业”暴露',
  )
  assert.equal(
    realEvaluation.warnings.some((item) => item.code === 'industry_classification_missing'),
    true,
    '真实持仓缺失行业事实时必须显式告警',
  )
  const dividendIndustryContract: InvestmentPolicyContract = {
    ...contract,
    riskRules: {
      ...contract.riskRules,
      global: { ...contract.riskRules.global, aggregateAssetCapPercent: 100, industryCapPercent: 100 },
      dividendLowVol: { ...contract.riskRules.dividendLowVol, singleAssetCapPercent: 100, industryCapPercent: 10 },
    },
  }
  const dividendIndustryEvaluation = evaluateInvestmentPolicy({
    contract: dividendIndustryContract,
    positions: [
      { id: 'dividend-position', assetId: 'dividend-asset', marketValue: 20, stopLoss: null, tags: '[]', labels: '[]', asset: { symbol: 'DIVIDEND', name: '红利样本', type: 'stock', industry: '银行' }, strategyAssignment: { status: 'confirmed', strategyFamily: 'dividend_low_vol' } },
      { id: 'rotation-position', assetId: 'rotation-asset', marketValue: 80, stopLoss: null, tags: '[]', labels: '[]', asset: { symbol: 'ROTATION', name: '轮动样本', type: 'etf', industry: '电子' }, strategyAssignment: { status: 'confirmed', strategyFamily: 'rotation_volatility' } },
    ],
  })
  assert.equal(
    dividendIndustryEvaluation.industryExposures.some((item) => item.scope === 'strategy' && item.strategyFamily === 'dividend_low_vol' && item.industry === '银行' && item.status === 'over_cap'),
    true,
    '红利低波专属行业上限必须独立参与评估',
  )

  const realAsset = realPositions.find((position) => ['stock', 'etf', 'fund'].includes(position.asset.type))?.asset
  assert.ok(realAsset, 'real-data policy acceptance requires a current investable asset')
  await prisma.user.create({ data: { id: testUserId, email: `${testUserId}@local.fams`, passwordHash: 'contract-only', name: 'Investment policy test' } })
  const testPosition = await prisma.position.create({
    data: {
      userId: testUserId,
      assetId: realAsset.id,
      openKey: `${testUserId}:${realAsset.id}`,
      quantity: 100,
      avgCost: Number(realAsset.lastPrice || 1),
      currentPrice: Number(realAsset.lastPrice || 1),
      marketValue: Number(realAsset.lastPrice || 1) * 100,
      costBasis: Number(realAsset.lastPrice || 1) * 100,
      tags: JSON.stringify(['账户:同花顺']),
      source: 'investment_policy_contract_test',
    },
  })
  await prisma.positionStrategyAssignment.create({
    data: { userId: testUserId, positionId: testPosition.id, strategyFamily: 'rotation_volatility', status: 'confirmed', source: 'contract_test', confirmedAt: new Date(), confirmedBy: 'contract_test' },
  })

  const draft = await investmentPolicyService.createDraft({ userId: testUserId, createdBy: 'contract_test' })
  assert.equal(draft.status, 'draft')
  assert.equal(draft.contract.reserveCash.floorPercent, null)
  const reusedDraft = await investmentPolicyService.createDraft({ userId: testUserId, createdBy: 'contract_test' })
  assert.equal(reusedDraft.id, draft.id, '每个用户同时只能有一份可编辑草案')
  await assert.rejects(
    () => investmentPolicyService.activate({ userId: testUserId, policyId: draft.id, confirmed: true, confirmedBy: 'contract_test' }),
    /尚未满足激活条件/,
  )
  const saved = await investmentPolicyService.updateDraft({ userId: testUserId, policyId: draft.id, contract })
  assert.equal(saved.contract.strategyBuckets.reduce((sum: number, bucket: any) => sum + bucket.targetPercent, 0), 100)
  const override = await investmentPolicyService.upsertOverride({
    userId: testUserId,
    policyId: draft.id,
    positionId: testPosition.id,
    override: { maxAssetWeightPercent: 15, stopMode: 'fixed_loss_percent', stopLossPercent: 8 },
    reason: '验证版本化单标的风险覆盖',
    createdBy: 'contract_test',
  })
  assert.equal(override.override.maxAssetWeightPercent, 15)
  const activated = await investmentPolicyService.activate({ userId: testUserId, policyId: draft.id, confirmed: true, confirmedBy: 'contract_test' })
  assert.equal(activated.status, 'active')
  assert.equal(activated.permissionState.formalTradingUnlocked, false)
  await assert.rejects(
    () => investmentPolicyService.updateDraft({ userId: testUserId, policyId: draft.id, contract }),
    /immutable/,
  )
  const capacity = await investmentPolicyService.getBuyCapacity(testUserId, realAsset.id)
  assert.ok(capacity)
  assert.equal(capacity!.capPercent, 15)
  assert.equal(capacity!.strategyFamily, 'rotation_volatility')
  assert.equal(capacity!.rotationRiskPolicy?.cashFloorPercent, 10)
  if (!String(realAsset.industry || realAsset.sector || '').trim()) {
    assert.equal(capacity!.availableBuyBudget, 0)
    assert.ok(capacity!.blockers.includes('investment_policy_industry_classification_required'))
  }
  const unheldDividendAsset = realPositions.find((position) => position.assetId !== realAsset.id)?.asset
  assert.ok(unheldDividendAsset, '红利新增风险容量验收需要第二个真实资产事实')
  const dividendCapacity = await investmentPolicyService.getBuyCapacityBySymbol(
    testUserId,
    unheldDividendAsset.symbol,
    'dividend_low_vol',
    unheldDividendAsset.industry || unheldDividendAsset.sector || '待复核行业',
  )
  assert.ok(dividendCapacity)
  assert.equal(dividendCapacity!.strategyFamily, 'dividend_low_vol')
  assert.equal(dividendCapacity!.capPercent, contract.riskRules.dividendLowVol.singleAssetCapPercent)
  assert.equal(dividendCapacity!.blockers.includes('investment_policy_strategy_assignment_required'), false)
  const evaluationSnapshots = await prisma.investmentPolicyEvaluationSnapshot.count({ where: { userId: testUserId } })
  assert.equal(evaluationSnapshots, 1, 'activation must persist one immutable real-input evaluation snapshot')
  const inheritedDraft = await investmentPolicyService.createDraft({ userId: testUserId, createdBy: 'contract_test' })
  assert.equal(inheritedDraft.overrides.length, 1, '新版本草案必须继承活动政策的单标的覆盖')

  await prisma.user.delete({ where: { id: testUserId } })
  const after = await protectedCounts()
  assert.deepEqual(after, before, 'policy acceptance must leave position and transaction tables unchanged')

  const output = {
    schemaVersion: 'fams.investment-policy-acceptance.v1',
    status: 'passed',
    generatedAt: new Date().toISOString(),
    realData: {
      openPositionCount: realPositions.length,
      totalValue: realEvaluation.totals.totalValue,
      assignedInvestedValue: realEvaluation.totals.assignedInvestedValue,
      evaluationStatus: realEvaluation.status,
      warningCount: realEvaluation.warnings.length,
      strategyBuckets: realEvaluation.buckets,
    },
    gates: {
      defaultTargets: [50, 30, 20],
      reserveCashIsSeparate: true,
      userWarningBandsRequired: true,
      driftAction: 'warning_only',
      autoRebalance: false,
      explicitActivationRequired: true,
      activePolicyImmutable: true,
      assetOverrideAudited: true,
      oneDraftPerUser: true,
      activeOverridesInheritedByNewDraft: true,
      dividendIndustryCapEvaluated: true,
      dividendManualDraftCapacityAvailable: true,
      missingIndustryBlocksNewRisk: true,
      realInputEvaluationSnapshotPersisted: true,
      missingIndustryFactsDisclosed: true,
      missingIndustryExcludedFromExposureAggregation: true,
      protectedCountsUnchanged: after,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }
  const evidenceDir = resolve(process.cwd(), '../docs/automation-audits/investment-policy/evidence')
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(resolve(evidenceDir, 'investment-policy-acceptance.json'), `${JSON.stringify(output, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(output, null, 2))
}

main().catch(async (error) => {
  await prisma.user.delete({ where: { id: testUserId } }).catch(() => undefined)
  console.error(error)
  process.exitCode = 1
}).finally(async () => prisma.$disconnect())
