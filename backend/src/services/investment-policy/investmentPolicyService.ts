import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import { allocationPolicyService } from '../allocation/allocationPolicyService.js'
import {
  DEFAULT_INVESTMENT_POLICY_DRAFT,
  hashInvestmentPolicy,
  investmentPolicyAssetOverrideSchema,
  investmentPolicyContractSchema,
  type InvestmentPolicyAssetOverride,
  type InvestmentPolicyContract,
  type InvestmentPolicyStrategyFamily,
  validateInvestmentPolicyForActivation,
} from './investmentPolicyContract.js'

const round = (value: number, digits = 4) => Number(value.toFixed(digits))

function parseArray(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function serializePolicy(policy: any) {
  if (!policy) return null
  return {
    ...policy,
    contract: investmentPolicyContractSchema.parse(JSON.parse(policy.contractJson)),
    contractJson: undefined,
    overrides: Array.isArray(policy.overrides)
      ? policy.overrides.map((item: any) => ({ ...item, override: JSON.parse(item.overrideJson), overrideJson: undefined }))
      : undefined,
  }
}

function policyPositionValue(position: any) {
  const marketValue = Number(position.marketValue)
  if (Number.isFinite(marketValue) && marketValue >= 0) return marketValue
  const currentPrice = Number(position.currentPrice)
  const quantity = Number(position.quantity)
  if (Number.isFinite(currentPrice) && currentPrice > 0 && Number.isFinite(quantity)) return currentPrice * quantity
  return Math.max(0, Number(position.costBasis || 0))
}

function positionMarkers(position: any) {
  return [...parseArray(position.tags), ...parseArray(position.labels)]
}

function resolvedFamily(position: any): InvestmentPolicyStrategyFamily | 'unclassified' {
  const assignment = position.strategyAssignment
  if (assignment?.status !== 'confirmed') return 'unclassified'
  return ['portfolio', 'dividend_low_vol', 'rotation_volatility'].includes(assignment.strategyFamily)
    ? assignment.strategyFamily
    : 'unclassified'
}

function isReserveCash(position: any, family: InvestmentPolicyStrategyFamily | 'unclassified') {
  if (position.asset.type !== 'cash') return false
  const markers = positionMarkers(position).join(' ')
  return family !== 'portfolio' || /备用现金|交易现金|资金角色:备用现金/.test(markers)
}

function capForFamily(contract: InvestmentPolicyContract, family: InvestmentPolicyStrategyFamily | 'unclassified') {
  if (family === 'dividend_low_vol') return Math.min(contract.riskRules.global.aggregateAssetCapPercent, contract.riskRules.dividendLowVol.singleAssetCapPercent)
  if (family === 'rotation_volatility') return Math.min(contract.riskRules.global.aggregateAssetCapPercent, contract.riskRules.rotationVolatility.singleAssetCapPercent)
  return contract.riskRules.global.aggregateAssetCapPercent
}

export function evaluateInvestmentPolicy(input: {
  contract: InvestmentPolicyContract
  positions: any[]
  overrides?: Array<{ assetId: string; override: InvestmentPolicyAssetOverride; reason?: string }>
  policyVersionId?: string | null
  contractHash?: string | null
}) {
  const contract = investmentPolicyContractSchema.parse(input.contract)
  const overrideByAsset = new Map((input.overrides || []).map((item) => [item.assetId, item]))
  const positionRows = input.positions.map((position) => {
    const family = resolvedFamily(position)
    const value = policyPositionValue(position)
    const reserveCash = isReserveCash(position, family)
    const override = overrideByAsset.get(position.assetId)?.override
    const defaultCap = capForFamily(contract, family)
    const capPercent = override?.maxAssetWeightPercent ?? defaultCap
    return { position, family, value, reserveCash, override: override || null, capPercent }
  })
  const totalValue = positionRows.reduce((sum, row) => sum + row.value, 0)
  const reserveCashValue = positionRows.filter((row) => row.reserveCash).reduce((sum, row) => sum + row.value, 0)
  const assignedRows = positionRows.filter((row) => !row.reserveCash && row.family !== 'unclassified')
  const assignedInvestedValue = assignedRows.reduce((sum, row) => sum + row.value, 0)
  const reserveFloorPercent = contract.reserveCash.floorPercent
  const policyInvestableValue = reserveFloorPercent === null ? null : totalValue * (100 - reserveFloorPercent) / 100
  const warnings: Array<Record<string, unknown>> = []

  if (reserveFloorPercent === null) {
    warnings.push({ code: 'reserve_cash_floor_not_configured', severity: 'warning', message: '备用现金下限尚未配置。' })
  } else if (totalValue > 0 && reserveCashValue / totalValue * 100 + 1e-8 < reserveFloorPercent) {
    warnings.push({ code: 'reserve_cash_below_floor', severity: 'warning', message: `备用现金占比低于 ${reserveFloorPercent}% 下限；只告警，不自动调仓。` })
  }

  const buckets = contract.strategyBuckets.map((bucket) => {
    const currentValue = assignedRows.filter((row) => row.family === bucket.strategyFamily).reduce((sum, row) => sum + row.value, 0)
    const currentPercent = assignedInvestedValue > 0 ? currentValue / assignedInvestedValue * 100 : 0
    const min = bucket.warningBand.minPercent
    const max = bucket.warningBand.maxPercent
    const status = min === null || max === null ? 'not_configured' : currentPercent < min ? 'below_warning_band' : currentPercent > max ? 'above_warning_band' : 'within_warning_band'
    if (status === 'below_warning_band' || status === 'above_warning_band') {
      warnings.push({
        code: `strategy_bucket_${status}`,
        severity: 'warning',
        strategyFamily: bucket.strategyFamily,
        message: `${bucket.strategyFamily} 当前 ${currentPercent.toFixed(2)}%，超出用户设置的展示警示区间；不会自动再平衡。`,
      })
    }
    return {
      strategyFamily: bucket.strategyFamily,
      targetPercent: bucket.targetPercent,
      warningBand: bucket.warningBand,
      currentValue: round(currentValue, 2),
      currentPercent: round(currentPercent),
      targetValue: policyInvestableValue === null ? null : round(policyInvestableValue * bucket.targetPercent / 100, 2),
      status,
      action: 'warning_only' as const,
    }
  })

  const industries = new Map<string, number>()
  const dividendIndustries = new Map<string, number>()
  const positionsMissingIndustry: string[] = []
  const positions = positionRows.map((row) => {
    const currentWeightPercent = totalValue > 0 ? row.value / totalValue * 100 : 0
    const resolvedIndustry = String(row.position.asset.industry || row.position.asset.sector || '').trim()
    const industry = resolvedIndustry || '未分类'
    if (row.position.asset.type !== 'cash') {
      if (resolvedIndustry) {
        industries.set(resolvedIndustry, (industries.get(resolvedIndustry) || 0) + row.value)
        if (row.family === 'dividend_low_vol') {
          dividendIndustries.set(resolvedIndustry, (dividendIndustries.get(resolvedIndustry) || 0) + row.value)
        }
      }
      else positionsMissingIndustry.push(row.position.asset.symbol)
    }
    const overCap = currentWeightPercent > row.capPercent + 1e-8
    if (overCap) {
      warnings.push({
        code: 'asset_cap_exceeded', severity: 'warning', positionId: row.position.id, symbol: row.position.asset.symbol,
        message: `${row.position.asset.name} 当前占总资产 ${currentWeightPercent.toFixed(2)}%，超过 ${row.capPercent}% 上限；阻止新增风险但不自动卖出。`,
      })
    }
    const stopPolicy = row.override?.stopMode === 'fixed_loss_percent'
      ? { mode: 'fixed_loss_percent', percent: row.override.stopLossPercent }
      : row.position.stopLoss
        ? { mode: 'position_fixed_percent', percent: Math.abs(Number(row.position.stopLoss)) }
        : row.family === 'portfolio'
          ? { mode: 'drawdown_and_thesis_review', percent: contract.riskRules.portfolio.drawdownReviewPercent }
          : row.family === 'dividend_low_vol'
            ? { mode: contract.riskRules.dividendLowVol.stopMode, percent: null }
            : row.family === 'rotation_volatility'
              ? { mode: contract.riskRules.rotationVolatility.stopMode, percent: null }
              : { mode: 'unclassified', percent: null }
    return {
      positionId: row.position.id,
      assetId: row.position.assetId,
      symbol: row.position.asset.symbol,
      name: row.position.asset.name,
      industry,
      strategyFamily: row.family,
      reserveCash: row.reserveCash,
      marketValue: round(row.value, 2),
      currentWeightPercent: round(currentWeightPercent),
      capPercent: row.capPercent,
      capStatus: overCap ? 'over_cap' : 'within_cap',
      newRiskAllowed: !overCap && row.family !== 'unclassified',
      stopPolicy,
      override: row.override,
    }
  })

  const globalIndustryExposures = [...industries.entries()].map(([industry, value]) => {
    const currentWeightPercent = totalValue > 0 ? value / totalValue * 100 : 0
    const overCap = currentWeightPercent > contract.riskRules.global.industryCapPercent + 1e-8
    if (overCap) warnings.push({ code: 'global_industry_cap_exceeded', severity: 'warning', industry, message: `${industry} 占总资产 ${currentWeightPercent.toFixed(2)}%，超过全局 ${contract.riskRules.global.industryCapPercent}% 上限。` })
    return { scope: 'global' as const, strategyFamily: null, industry, marketValue: round(value, 2), currentWeightPercent: round(currentWeightPercent), capPercent: contract.riskRules.global.industryCapPercent, status: overCap ? 'over_cap' : 'within_cap' }
  })
  const dividendIndustryExposures = [...dividendIndustries.entries()].map(([industry, value]) => {
    const currentWeightPercent = totalValue > 0 ? value / totalValue * 100 : 0
    const overCap = currentWeightPercent > contract.riskRules.dividendLowVol.industryCapPercent + 1e-8
    if (overCap) warnings.push({ code: 'dividend_industry_cap_exceeded', severity: 'warning', industry, message: `红利低波中 ${industry} 占总资产 ${currentWeightPercent.toFixed(2)}%，超过 ${contract.riskRules.dividendLowVol.industryCapPercent}% 上限。` })
    return { scope: 'strategy' as const, strategyFamily: 'dividend_low_vol' as const, industry, marketValue: round(value, 2), currentWeightPercent: round(currentWeightPercent), capPercent: contract.riskRules.dividendLowVol.industryCapPercent, status: overCap ? 'over_cap' : 'within_cap' }
  })
  const industryExposures = [...globalIndustryExposures, ...dividendIndustryExposures]
    .sort((left, right) => right.marketValue - left.marketValue)

  const unclassified = positionRows.filter((row) => row.family === 'unclassified' && !row.reserveCash)
  if (positionsMissingIndustry.length > 0) {
    warnings.push({
      code: 'industry_classification_missing',
      severity: 'warning',
      count: positionsMissingIndustry.length,
      symbols: positionsMissingIndustry,
      message: `${positionsMissingIndustry.length} 项非现金持仓缺少行业分类，未纳入行业上限聚合。`,
    })
  }
  if (unclassified.length > 0) warnings.push({ code: 'unclassified_positions_present', severity: 'warning', count: unclassified.length, message: `${unclassified.length} 项持仓尚未确认策略归类。` })

  return {
    schemaVersion: 'fams.investment-policy-evaluation.v1',
    generatedAt: new Date().toISOString(),
    policyVersionId: input.policyVersionId || null,
    contractHash: input.contractHash || hashInvestmentPolicy(contract),
    totals: {
      totalValue: round(totalValue, 2),
      reserveCashValue: round(reserveCashValue, 2),
      reserveCashPercent: totalValue > 0 ? round(reserveCashValue / totalValue * 100) : 0,
      assignedInvestedValue: round(assignedInvestedValue, 2),
      policyInvestableValue: policyInvestableValue === null ? null : round(policyInvestableValue, 2),
    },
    buckets,
    positions,
    industryExposures,
    warnings,
    status: warnings.some((item) => item.code === 'unclassified_positions_present') ? 'incomplete' : warnings.length > 0 ? 'warning' : 'within_policy',
    automationBoundary: { driftAction: 'warning_only', autoRebalance: false, createsOrder: false },
    permissionState: contract.tradeBoundary,
  }
}

class InvestmentPolicyService {
  private async policyWithOverrides(id: string) {
    return prisma.investmentPolicyVersion.findUnique({ where: { id }, include: { overrides: true } })
  }

  async getCurrent(userId: string) {
    await ensureUser(prisma, userId)
    const [active, latestDraft, legacyPortfolioPlan] = await Promise.all([
      prisma.investmentPolicyVersion.findFirst({ where: { userId, status: 'active' }, include: { overrides: true }, orderBy: { activatedAt: 'desc' } }),
      prisma.investmentPolicyVersion.findFirst({ where: { userId, status: 'draft' }, include: { overrides: true }, orderBy: { updatedAt: 'desc' } }),
      allocationPolicyService.getCurrentPlan(userId).catch(() => null),
    ])
    return {
      schemaVersion: 'fams.investment-policy-state.v1',
      activePolicy: serializePolicy(active),
      latestDraft: serializePolicy(latestDraft),
      legacyPortfolioPlan: legacyPortfolioPlan ? {
        strategyId: legacyPortfolioPlan.strategyContract?.id,
        name: legacyPortfolioPlan.strategyContract?.name,
        status: legacyPortfolioPlan.strategyContract?.status,
        remainsActiveUntilExplicitPolicyActivation: !active,
      } : null,
      policyTransition: {
        mode: 'explicit_confirmation',
        legacyPolicyAutomaticallyReplaced: false,
      },
      permissionState: DEFAULT_INVESTMENT_POLICY_DRAFT.tradeBoundary,
    }
  }

  async createDraft(input: { userId: string; createdBy: string; contract?: unknown }) {
    await ensureUser(prisma, input.userId)
    if (!input.createdBy.trim()) throw new Error('createdBy is required')
    const existingDraft = await prisma.investmentPolicyVersion.findFirst({
      where: { userId: input.userId, status: 'draft' },
      include: { overrides: true },
      orderBy: { updatedAt: 'desc' },
    })
    if (existingDraft) return serializePolicy(existingDraft)
    const latest = await prisma.investmentPolicyVersion.findFirst({ where: { userId: input.userId }, orderBy: { version: 'desc' } })
    const active = await prisma.investmentPolicyVersion.findFirst({ where: { userId: input.userId, status: 'active' }, include: { overrides: true }, orderBy: { activatedAt: 'desc' } })
    const base = input.contract || (active ? JSON.parse(active.contractJson) : DEFAULT_INVESTMENT_POLICY_DRAFT)
    const contract = investmentPolicyContractSchema.parse(base)
    const version = (latest?.version || 0) + 1
    const created = await prisma.$transaction(async (tx) => {
      const policy = await tx.investmentPolicyVersion.create({
        data: {
          userId: input.userId,
          version,
          name: contract.name,
          status: 'draft',
          contractJson: JSON.stringify(contract),
          contractHash: hashInvestmentPolicy(contract),
          createdBy: input.createdBy.trim(),
        },
      })
      if (active?.overrides.length) {
        await tx.investmentPolicyAssetOverride.createMany({
          data: active.overrides.map((item) => ({
            policyVersionId: policy.id,
            userId: input.userId,
            assetId: item.assetId,
            overrideJson: item.overrideJson,
            reason: `继承自政策 v${active.version}：${item.reason}`,
            createdBy: input.createdBy.trim(),
          })),
        })
      }
      return tx.investmentPolicyVersion.findUniqueOrThrow({ where: { id: policy.id }, include: { overrides: true } })
    })
    return serializePolicy(created)
  }

  async updateDraft(input: { userId: string; policyId: string; contract: unknown }) {
    const existing = await prisma.investmentPolicyVersion.findFirst({ where: { id: input.policyId, userId: input.userId } })
    if (!existing) throw new Error('Investment policy draft not found')
    if (existing.status !== 'draft') throw new Error('Active or superseded investment policies are immutable')
    const contract = investmentPolicyContractSchema.parse(input.contract)
    const updated = await prisma.investmentPolicyVersion.update({
      where: { id: existing.id },
      data: { name: contract.name, contractJson: JSON.stringify(contract), contractHash: hashInvestmentPolicy(contract) },
      include: { overrides: true },
    })
    return serializePolicy(updated)
  }

  async activate(input: { userId: string; policyId: string; confirmed: boolean; confirmedBy: string }) {
    if (input.confirmed !== true || !input.confirmedBy.trim()) throw new Error('激活投资政策必须明确确认并填写确认人')
    const existing = await this.policyWithOverrides(input.policyId)
    if (!existing || existing.userId !== input.userId) throw new Error('Investment policy draft not found')
    if (existing.status !== 'draft') throw new Error('Only a draft investment policy can be activated')
    const contract = JSON.parse(existing.contractJson)
    const validation = validateInvestmentPolicyForActivation(contract)
    if (!validation.success) {
      const error = new Error('投资政策尚未满足激活条件') as Error & { issues?: unknown }
      error.issues = validation.error.issues
      throw error
    }
    const positions = await prisma.position.findMany({
      where: { userId: input.userId, status: 'open' },
      include: { asset: true, strategyAssignment: true },
      orderBy: { updatedAt: 'desc' },
    })
    const evaluation = evaluateInvestmentPolicy({
      contract: validation.data,
      positions,
      overrides: existing.overrides.map((item) => ({
        assetId: item.assetId,
        override: investmentPolicyAssetOverrideSchema.parse(JSON.parse(item.overrideJson)),
        reason: item.reason,
      })),
      policyVersionId: existing.id,
      contractHash: existing.contractHash,
    })
    const inputAsOf = positions.reduce((latest, position) => position.updatedAt > latest ? position.updatedAt : latest, existing.updatedAt)
    const snapshotHash = hashInvestmentPolicy({ policyId: existing.id, contractHash: existing.contractHash, inputAsOf: inputAsOf.toISOString(), evaluation })
    const now = new Date()
    const activated = await prisma.$transaction(async (tx) => {
      await tx.investmentPolicyVersion.updateMany({
        where: { userId: input.userId, status: 'active', id: { not: existing.id } },
        data: { status: 'superseded', supersededAt: now },
      })
      const result = await tx.investmentPolicyVersion.updateMany({
        where: { id: existing.id, userId: input.userId, status: 'draft' },
        data: { status: 'active', activatedAt: now, activatedBy: input.confirmedBy.trim() },
      })
      if (result.count !== 1) throw new Error('投资政策草案已变更，请刷新后重试')
      await tx.investmentPolicyEvaluationSnapshot.upsert({
        where: { snapshotHash },
        create: {
          policyVersionId: existing.id,
          userId: input.userId,
          snapshotHash,
          evaluatedAt: now,
          inputAsOf,
          evaluationJson: JSON.stringify(evaluation),
          evidenceRefsJson: JSON.stringify(positions.map((position) => `position:${position.id}:${position.updatedAt.toISOString()}`)),
        },
        update: {},
      })
      return tx.investmentPolicyVersion.findUniqueOrThrow({ where: { id: existing.id }, include: { overrides: true } })
    })
    return {
      status: 'active',
      policy: serializePolicy(activated),
      evaluation,
      legacyPortfolioPolicyReplacedByExplicitConfirmation: true,
      permissionState: validation.data.tradeBoundary,
    }
  }

  async upsertOverride(input: { userId: string; policyId: string; positionId: string; override: unknown; reason: string; createdBy: string }) {
    const policy = await prisma.investmentPolicyVersion.findFirst({ where: { id: input.policyId, userId: input.userId } })
    if (!policy) throw new Error('Investment policy not found')
    if (policy.status !== 'draft') throw new Error('Asset overrides can only be changed on a draft policy')
    if (!input.reason.trim() || !input.createdBy.trim()) throw new Error('Override reason and createdBy are required')
    const position = await prisma.position.findFirst({ where: { id: input.positionId, userId: input.userId } })
    if (!position) throw new Error('Position not found')
    const override = investmentPolicyAssetOverrideSchema.parse(input.override)
    const saved = await prisma.investmentPolicyAssetOverride.upsert({
      where: { policyVersionId_assetId: { policyVersionId: policy.id, assetId: position.assetId } },
      create: { policyVersionId: policy.id, userId: input.userId, assetId: position.assetId, overrideJson: JSON.stringify(override), reason: input.reason.trim(), createdBy: input.createdBy.trim() },
      update: { overrideJson: JSON.stringify(override), reason: input.reason.trim(), createdBy: input.createdBy.trim() },
    })
    return { ...saved, override, overrideJson: undefined }
  }

  async evaluate(userId: string, policyId?: string, persist = false) {
    await ensureUser(prisma, userId)
    const policy = policyId
      ? await this.policyWithOverrides(policyId)
      : await prisma.investmentPolicyVersion.findFirst({ where: { userId, status: 'active' }, include: { overrides: true }, orderBy: { activatedAt: 'desc' } })
    if (!policy || policy.userId !== userId) return null
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true, strategyAssignment: true },
      orderBy: { updatedAt: 'desc' },
    })
    const evaluation = evaluateInvestmentPolicy({
      contract: JSON.parse(policy.contractJson),
      positions,
      overrides: policy.overrides.map((item) => ({ assetId: item.assetId, override: investmentPolicyAssetOverrideSchema.parse(JSON.parse(item.overrideJson)), reason: item.reason })),
      policyVersionId: policy.id,
      contractHash: policy.contractHash,
    })
    if (persist) {
      const inputAsOf = positions.reduce((latest, position) => position.updatedAt > latest ? position.updatedAt : latest, policy.updatedAt)
      const snapshotHash = hashInvestmentPolicy({ policyId: policy.id, contractHash: policy.contractHash, inputAsOf: inputAsOf.toISOString(), evaluation })
      await prisma.investmentPolicyEvaluationSnapshot.upsert({
        where: { snapshotHash },
        create: { policyVersionId: policy.id, userId, snapshotHash, evaluatedAt: new Date(), inputAsOf, evaluationJson: JSON.stringify(evaluation), evidenceRefsJson: JSON.stringify(positions.map((position) => `position:${position.id}:${position.updatedAt.toISOString()}`)) },
        update: {},
      })
    }
    return evaluation
  }

  async getBuyCapacity(
    userId: string,
    assetId: string,
    expectedFamily?: InvestmentPolicyStrategyFamily,
    industryHint?: string | null,
  ) {
    const policy = await prisma.investmentPolicyVersion.findFirst({ where: { userId, status: 'active' }, include: { overrides: true }, orderBy: { activatedAt: 'desc' } })
    if (!policy) return null
    const contract = investmentPolicyContractSchema.parse(JSON.parse(policy.contractJson))
    const positions = await prisma.position.findMany({ where: { userId, status: 'open' }, include: { asset: true, strategyAssignment: true } })
    const targetPositions = positions.filter((position) => position.assetId === assetId)
    const target = targetPositions[0]
    const asset = target?.asset || await prisma.asset.findUnique({ where: { id: assetId } })
    if (!asset) return null
    const totalValue = positions.reduce((sum, position) => sum + policyPositionValue(position), 0)
    const family = target ? resolvedFamily(target) : expectedFamily || 'unclassified'
    const overrideRow = policy.overrides.find((item) => item.assetId === assetId)
    const override = overrideRow ? investmentPolicyAssetOverrideSchema.parse(JSON.parse(overrideRow.overrideJson)) : null
    const capPercent = override?.maxAssetWeightPercent ?? capForFamily(contract, family)
    const currentAssetValue = targetPositions.reduce((sum, position) => sum + policyPositionValue(position), 0)
    const assetCapacity = Math.max(0, totalValue * capPercent / 100 - currentAssetValue)
    const industry = asset.industry || asset.sector || industryHint || null
    const globalIndustryValue = industry
      ? positions.filter((position) => (position.asset.industry || position.asset.sector) === industry).reduce((sum, position) => sum + policyPositionValue(position), 0)
      : 0
    const globalIndustryCapacity = industry
      ? Math.max(0, totalValue * contract.riskRules.global.industryCapPercent / 100 - globalIndustryValue)
      : 0
    const dividendIndustryValue = industry && family === 'dividend_low_vol'
      ? positions
        .filter((position) => resolvedFamily(position) === 'dividend_low_vol' && (position.asset.industry || position.asset.sector) === industry)
        .reduce((sum, position) => sum + policyPositionValue(position), 0)
      : 0
    const strategyIndustryCapacity = industry && family === 'dividend_low_vol'
      ? Math.max(0, totalValue * contract.riskRules.dividendLowVol.industryCapPercent / 100 - dividendIndustryValue)
      : Number.POSITIVE_INFINITY
    const availableBuyBudget = industry
      ? Math.min(assetCapacity, globalIndustryCapacity, strategyIndustryCapacity)
      : 0
    return {
      policyVersionId: policy.id,
      assetId,
      strategyFamily: family,
      capPercent,
      availableBuyBudget: round(availableBuyBudget, 2),
      blockers: [
        ...(assetCapacity <= 0 ? ['investment_policy_asset_cap_exhausted'] : []),
        ...(!industry ? ['investment_policy_industry_classification_required'] : []),
        ...(globalIndustryCapacity <= 0 && industry ? ['investment_policy_global_industry_cap_exhausted'] : []),
        ...(strategyIndustryCapacity <= 0 ? ['investment_policy_strategy_industry_cap_exhausted'] : []),
        ...(family === 'unclassified' ? ['investment_policy_strategy_assignment_required'] : []),
      ],
      rotationRiskPolicy: family === 'rotation_volatility' ? {
        maxAssetWeightPercent: capPercent,
        cashFloorPercent: contract.riskRules.rotationVolatility.cashFloorPercent,
      } : null,
    }
  }

  async getBuyCapacityBySymbol(
    userId: string,
    symbol: string,
    expectedFamily: InvestmentPolicyStrategyFamily,
    industryHint?: string | null,
  ) {
    const asset = await prisma.asset.findUnique({ where: { symbol } })
    if (!asset) return null
    return this.getBuyCapacity(userId, asset.id, expectedFamily, industryHint)
  }
}

export const investmentPolicyService = new InvestmentPolicyService()
