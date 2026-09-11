import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'

export type AllocationBucketKey = 'cash' | 'gold' | 'bond' | 'equity'

export type AllocationPositionInput = {
  marketValue: number | null
  tags: string
  labels: string
  asset: { type: string; symbol: string; name: string }
}

export type AllocationBucketStatus = {
  key: AllocationBucketKey | 'core' | 'volatility' | 'trading_cash'
  tag: string
  label: string
  targetRatio: number
  targetValue: number
  currentValue: number
  currentRatio: number
  gapValue: number
  deviationPctPoint: number
  triggered: boolean
  triggerReason: string
}

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const roundRatio = (value: number) => Math.round((value + Number.EPSILON) * 10000) / 10000

const parseStrings = (value: string) => {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export function isAlipayPosition(position: AllocationPositionInput) {
  return parseStrings(position.labels).includes('账户:支付宝')
    || parseStrings(position.tags).some((tag) => tag.startsWith('支付宝·'))
}

export function classifyAlipayBucket(position: AllocationPositionInput): AllocationBucketKey | null {
  if (!isAlipayPosition(position)) return null
  const markers = [...parseStrings(position.tags), ...parseStrings(position.labels)]
  if (markers.some((value) => value.includes('资产桶:黄金') || value === '支付宝·黄金')) return 'gold'
  if (markers.some((value) => value.includes('资产桶:债券') || value === '支付宝·债券')) return 'bond'
  if (markers.some((value) => value.includes('资产桶:现金') || value === '支付宝·现金') || position.asset.type === 'cash') return 'cash'
  if (markers.some((value) => value.includes('资产桶:权益') || value === '支付宝·权益')) return 'equity'
  return null
}

const alipayDefinitions: Array<{ key: AllocationBucketKey; tag: string; label: string; targetRatio: number }> = [
  { key: 'cash', tag: '支付宝·现金', label: '现金/存款', targetRatio: 5 },
  { key: 'gold', tag: '支付宝·黄金', label: '黄金', targetRatio: 25 },
  { key: 'bond', tag: '支付宝·债券', label: '债券', targetRatio: 25 },
  { key: 'equity', tag: '支付宝·权益', label: '权益（红利低波+A500）', targetRatio: 45 },
]

const brokerDefinitions = [
  { key: 'core' as const, tag: '同花顺·核心仓', label: '核心仓', targetRatio: 50 },
  { key: 'volatility' as const, tag: '同花顺·波动仓', label: '波动仓上限', targetRatio: 25 },
  { key: 'trading_cash' as const, tag: '同花顺·交易现金', label: '交易现金下限', targetRatio: 25 },
]

function allocateTargets(total: number, ratios: number[]) {
  const cents = Math.round(total * 100)
  const raw = ratios.map((ratio) => cents * ratio / 100)
  const floor = raw.map(Math.floor)
  let remainder = cents - floor.reduce((sum, value) => sum + value, 0)
  const order = raw.map((value, index) => ({ index, fraction: value - floor[index] }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  for (const item of order) {
    if (remainder <= 0) break
    floor[item.index] += 1
    remainder -= 1
  }
  return floor.map((value) => value / 100)
}

function buildStatuses(
  total: number,
  definitions: Array<{ key: any; tag: string; label: string; targetRatio: number }>,
  currentByTag: Map<string, number>,
  thresholdPctPoint: number | null,
) {
  const targets = allocateTargets(total, definitions.map((item) => item.targetRatio))
  return definitions.map((definition, index): AllocationBucketStatus => {
    const currentValue = roundMoney(currentByTag.get(definition.tag) || 0)
    const currentRatio = total > 0 ? currentValue / total * 100 : 0
    const deviationPctPoint = currentRatio - definition.targetRatio
    const triggered = thresholdPctPoint !== null && Math.abs(deviationPctPoint) > thresholdPctPoint
    return {
      ...definition,
      targetValue: targets[index],
      currentValue,
      currentRatio: roundRatio(currentRatio),
      gapValue: roundMoney(targets[index] - currentValue),
      deviationPctPoint: roundRatio(deviationPctPoint),
      triggered,
      triggerReason: thresholdPctPoint === null
        ? '同花顺子层保持既有目标，本阶段不应用支付宝3个百分点门槛。'
        : triggered
          ? `绝对偏离 ${Math.abs(deviationPctPoint).toFixed(2)} 个百分点，大于 ${thresholdPctPoint}。`
          : `绝对偏离 ${Math.abs(deviationPctPoint).toFixed(2)} 个百分点，不大于 ${thresholdPctPoint}。`,
    }
  })
}

export function buildAllocationPlanFromPositions(
  positions: AllocationPositionInput[],
  metadata: { approvedAt?: string; capturedAt?: string; previousPlan?: Record<string, unknown> | null } = {},
) {
  const currentByTag = new Map<string, number>()
  const currentBySymbol = new Map<string, number>()
  const unknownAlipay: string[] = []
  for (const position of positions) {
    const marketValue = Number(position.marketValue || 0)
    currentBySymbol.set(position.asset.symbol, (currentBySymbol.get(position.asset.symbol) || 0) + marketValue)
    const tags = parseStrings(position.tags)
    for (const tag of tags) currentByTag.set(tag, (currentByTag.get(tag) || 0) + marketValue)
    if (isAlipayPosition(position) && !classifyAlipayBucket(position)) unknownAlipay.push(position.asset.symbol)
  }
  const alipayTotal = alipayDefinitions.reduce((sum, item) => sum + (currentByTag.get(item.tag) || 0), 0)
  const brokerTotal = brokerDefinitions.reduce((sum, item) => sum + (currentByTag.get(item.tag) || 0), 0)
  const alipayBuckets = buildStatuses(alipayTotal, alipayDefinitions, currentByTag, 3)
  const brokerBuckets = buildStatuses(brokerTotal, brokerDefinitions, currentByTag, null)
  const bucketByKey = new Map(alipayBuckets.map((bucket) => [bucket.key, bucket]))
  const finalEquityValue = (bucketByKey.get('equity')?.targetValue || 0) / 2
  const equityExits = ['013597', '021634'].map((symbol) => ({
    symbol,
    amount: roundMoney(currentBySymbol.get(symbol) || 0),
    reason: symbol === '013597' ? '退出行业集中基金' : '退出港股QDII',
  }))
  const approvedAt = metadata.approvedAt || new Date().toISOString()
  const capturedAt = metadata.capturedAt || new Date().toISOString()
  return {
    schemaVersion: 'fams.approved-allocation-plan.v2',
    name: '支付宝5/25/25/45＋同花顺核心/波动/现金',
    status: 'approved' as const,
    approvedAt,
    capturedAt,
    generatedAt: new Date().toISOString(),
    totalAssetValue: roundMoney(alipayTotal + brokerTotal),
    currency: 'CNY',
    scope: 'alipay_only' as const,
    rebalancePolicy: {
      accountId: 'alipay',
      method: 'absolute_percentage_point_deviation' as const,
      thresholdPctPoint: 3,
      comparison: 'strictly_greater_than' as const,
      targetOnTrigger: 'full_target' as const,
      pacing: 'rrg_conditioned_four_quarters' as const,
      confirmationMode: 'confirmed_then_ledger' as const,
    },
    accounts: [
      {
        id: 'alipay', name: '支付宝', strategy: '现金5%/黄金25%/债券25%/权益45%',
        currentValue: roundMoney(alipayTotal),
        description: '长期配置账户；偏离目标严格大于3个百分点时生成复核草案。',
        buckets: alipayBuckets,
      },
      {
        id: 'tonghuashun', name: '同花顺', strategy: '核心仓＋波动仓＋交易现金',
        currentValue: roundMoney(brokerTotal),
        description: '保持核心仓50%、波动仓上限25%、交易现金下限25%的既有子层管理。',
        buckets: brokerBuckets,
      },
    ],
    strategyActions: {
      bondReductionTarget: roundMoney(Math.max(0, -(bucketByKey.get('bond')?.gapValue || 0))),
      goldIncreaseTarget: roundMoney(Math.max(0, bucketByKey.get('gold')?.gapValue || 0)),
      equityNetIncreaseTarget: roundMoney(Math.max(0, bucketByKey.get('equity')?.gapValue || 0)),
      cashIncreaseTarget: roundMoney(Math.max(0, bucketByKey.get('cash')?.gapValue || 0)),
      equityExits,
      equityBuys: [
        {
          symbol: '007467',
          amount: roundMoney(Math.max(0, finalEquityValue - (currentBySymbol.get('007467') || 0))),
          finalTargetValue: roundMoney(finalEquityValue),
        },
        {
          symbol: '022430',
          amount: roundMoney(Math.max(0, finalEquityValue - (currentBySymbol.get('022430') || 0))),
          finalTargetValue: roundMoney(finalEquityValue),
        },
      ],
      bondSourcePolicy: 'redeemable_lowest_cost_first_from_009725_013785_preserve_014086',
      trancheRatios: [0.25, 0.25, 0.25, 0.25],
    },
    classification: {
      status: unknownAlipay.length === 0 ? 'complete' : 'blocked',
      unknownAlipaySymbols: unknownAlipay,
    },
    sourceReconciliation: metadata.previousPlan && (metadata.previousPlan as any).sourceReconciliation
      ? (metadata.previousPlan as any).sourceReconciliation
      : null,
    executionBoundary: {
      createsBrokerOrder: false,
      humanConfirmationRequired: true,
      note: '仓位缺口和分批交易仅形成待确认本地草案；不自动创建或发送支付宝/券商订单。',
    },
  }
}

class AllocationPolicyService {
  async getCurrentPlan(userId: string) {
    const user = await ensureUser(prisma, userId)
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
    })
    let settings: Record<string, any> = {}
    try { settings = JSON.parse(user.settings || '{}') } catch { settings = {} }
    const stored = settings.approvedAllocationPlan as Record<string, any> | undefined
    return buildAllocationPlanFromPositions(positions, {
      approvedAt: stored?.schemaVersion === 'fams.approved-allocation-plan.v2' ? stored.approvedAt : undefined,
      capturedAt: stored?.schemaVersion === 'fams.approved-allocation-plan.v2' ? stored.capturedAt : undefined,
      previousPlan: stored || null,
    })
  }

  async applyApprovedPlan(userId: string, capturedAt = new Date()) {
    const user = await ensureUser(prisma, userId)
    let settings: Record<string, any> = {}
    try { settings = JSON.parse(user.settings || '{}') } catch { settings = {} }
    const previousPlan = settings.approvedAllocationPlan || null
    const positions = await prisma.position.findMany({ where: { userId, status: 'open' }, include: { asset: true } })
    const plan = buildAllocationPlanFromPositions(positions, {
      approvedAt: new Date().toISOString(),
      capturedAt: capturedAt.toISOString(),
      previousPlan,
    })
    if (plan.classification.status !== 'complete') throw new Error(`Alipay allocation classification incomplete: ${plan.classification.unknownAlipaySymbols.join(',')}`)
    const positionTargets = Object.fromEntries(plan.accounts.flatMap((account) => account.buckets).map((bucket) => [
      bucket.tag,
      { targetValue: bucket.targetValue / 10_000, setAt: plan.approvedAt, source: plan.schemaVersion },
    ]))
    const history = Array.isArray(settings.approvedAllocationPlanHistory) ? settings.approvedAllocationPlanHistory : []
    await prisma.user.update({
      where: { id: userId },
      data: {
        settings: JSON.stringify({
          ...settings,
          approvedAllocationPlanHistory: previousPlan ? [...history, previousPlan].slice(-10) : history,
          approvedAllocationPlan: plan,
          positionTargets,
        }),
      },
    })
    return plan
  }
}

export const allocationPolicyService = new AllocationPolicyService()
