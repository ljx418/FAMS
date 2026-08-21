import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'

const spacingPolicySchema = z.object({
  type: z.enum(['atr_multiple', 'fixed_percent']),
  value: z.number().positive().max(10),
  minPercent: z.number().positive().max(20).default(1),
  maxPercent: z.number().positive().max(30).default(4),
}).strict().refine((value) => value.minPercent <= value.maxPercent, 'minPercent must not exceed maxPercent')

export const gridStrategyConfigSchema = z.object({
  schemaVersion: z.literal('fams.grid-strategy.v1'),
  templateId: z.string().min(1),
  name: z.string().min(1).max(100),
  mode: z.enum(['mean_reversion', 'trend_pullback', 'cost_support', 'observe_only']),
  applicableAssetTypes: z.array(z.enum(['stock', 'etf', 'fund', 'bond', 'gold'])).min(1),
  factRequirements: z.object({
    minCompletedBars: z.number().int().min(30).max(250).default(30),
    minConfidence: z.number().min(0).max(1).default(0.6),
    blockBuyOnMaterialChange: z.boolean().default(true),
  }).strict(),
  anchorPolicy: z.object({
    primary: z.enum(['current_price', 'ma10', 'average_cost', 'support_resistance']),
  }).strict(),
  spacingPolicy: spacingPolicySchema,
  levelPolicy: z.object({
    buyLevels: z.number().int().min(0).max(5),
    sellLevels: z.number().int().min(0).max(5),
  }).strict(),
  sizingPolicy: z.object({
    maxAdjustmentPercent: z.number().positive().max(50),
    levelWeights: z.array(z.number().positive()).min(1).max(5),
  }).strict(),
  riskPolicy: z.object({
    cashFloorPercent: z.number().min(0).max(100),
    maxAssetWeightPercent: z.number().positive().max(100),
    validMinutes: z.number().int().min(5).max(1440),
  }).strict(),
}).strict()

export type GridStrategyConfig = z.infer<typeof gridStrategyConfigSchema>

const templates: GridStrategyConfig[] = [
  {
    schemaVersion: 'fams.grid-strategy.v1',
    templateId: 'mean_reversion_atr_v1',
    name: '均值回归 ATR 网格',
    mode: 'mean_reversion',
    applicableAssetTypes: ['stock', 'etf', 'fund'],
    factRequirements: { minCompletedBars: 30, minConfidence: 0.65, blockBuyOnMaterialChange: true },
    anchorPolicy: { primary: 'ma10' },
    spacingPolicy: { type: 'atr_multiple', value: 0.75, minPercent: 1, maxPercent: 4 },
    levelPolicy: { buyLevels: 3, sellLevels: 3 },
    sizingPolicy: { maxAdjustmentPercent: 30, levelWeights: [0.4, 0.35, 0.25] },
    riskPolicy: { cashFloorPercent: 10, maxAssetWeightPercent: 20, validMinutes: 330 },
  },
  {
    schemaVersion: 'fams.grid-strategy.v1',
    templateId: 'trend_pullback_v1',
    name: '趋势回踩网格',
    mode: 'trend_pullback',
    applicableAssetTypes: ['stock', 'etf'],
    factRequirements: { minCompletedBars: 30, minConfidence: 0.7, blockBuyOnMaterialChange: true },
    anchorPolicy: { primary: 'support_resistance' },
    spacingPolicy: { type: 'atr_multiple', value: 1, minPercent: 1.5, maxPercent: 5 },
    levelPolicy: { buyLevels: 2, sellLevels: 3 },
    sizingPolicy: { maxAdjustmentPercent: 30, levelWeights: [0.6, 0.4, 0.25] },
    riskPolicy: { cashFloorPercent: 10, maxAssetWeightPercent: 20, validMinutes: 330 },
  },
  {
    schemaVersion: 'fams.grid-strategy.v1',
    templateId: 'cost_support_v1',
    name: '成本与支撑压力网格',
    mode: 'cost_support',
    applicableAssetTypes: ['stock', 'etf', 'fund', 'bond', 'gold'],
    factRequirements: { minCompletedBars: 30, minConfidence: 0.6, blockBuyOnMaterialChange: true },
    anchorPolicy: { primary: 'average_cost' },
    spacingPolicy: { type: 'atr_multiple', value: 1, minPercent: 1, maxPercent: 5 },
    levelPolicy: { buyLevels: 2, sellLevels: 2 },
    sizingPolicy: { maxAdjustmentPercent: 25, levelWeights: [0.6, 0.4] },
    riskPolicy: { cashFloorPercent: 10, maxAssetWeightPercent: 20, validMinutes: 330 },
  },
  {
    schemaVersion: 'fams.grid-strategy.v1',
    templateId: 'observe_only_v1',
    name: '观察模式',
    mode: 'observe_only',
    applicableAssetTypes: ['stock', 'etf', 'fund', 'bond', 'gold'],
    factRequirements: { minCompletedBars: 30, minConfidence: 1, blockBuyOnMaterialChange: true },
    anchorPolicy: { primary: 'current_price' },
    spacingPolicy: { type: 'fixed_percent', value: 2, minPercent: 2, maxPercent: 2 },
    levelPolicy: { buyLevels: 0, sellLevels: 0 },
    sizingPolicy: { maxAdjustmentPercent: 1, levelWeights: [1] },
    riskPolicy: { cashFloorPercent: 100, maxAssetWeightPercent: 1, validMinutes: 60 },
  },
]

const stableJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

const hash = (value: unknown) => createHash('sha256').update(stableJson(value)).digest('hex')

const merge = (base: unknown, override: unknown): any => {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return override ?? base
  if (!base || typeof base !== 'object' || Array.isArray(base)) return override
  const result: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
    result[key] = merge(result[key], value)
  }
  return result
}

export interface GridBuildInput {
  config: GridStrategyConfig
  assetType: string
  currentPrice: number
  avgCost: number
  quantity: number
  cashBudget: number
  portfolioValue?: number
  currentMarketValue?: number
  completedBars: number
  confidence: number
  materialChange: 'none' | 'watch' | 'material' | 'insufficient'
  ma5?: number | null
  ma10?: number | null
  ma30?: number | null
  atr14?: number | null
  support?: number | null
  resistance?: number | null
  externalOrders?: Array<{ side: string; price: number | null; status: string }>
  now?: Date
}

class GridStrategyService {
  listTemplates() {
    return templates.map((config) => ({
      id: config.templateId,
      name: config.name,
      mode: config.mode,
      config,
      notTradingAdvice: true,
    }))
  }

  getTemplate(templateId: string) {
    const template = templates.find((item) => item.templateId === templateId)
    if (!template) throw new Error(`Unknown strategy template: ${templateId}`)
    return structuredClone(template)
  }

  validateConfig(config: unknown) {
    const parsed = gridStrategyConfigSchema.safeParse(config)
    if (!parsed.success) {
      return {
        valid: false as const,
        config: null,
        errors: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      }
    }
    const maxLevels = Math.max(parsed.data.levelPolicy.buyLevels, parsed.data.levelPolicy.sellLevels)
    const errors: Array<{ path: string; message: string }> = []
    if (parsed.data.sizingPolicy.levelWeights.length < maxLevels && maxLevels > 0) {
      errors.push({ path: 'sizingPolicy.levelWeights', message: 'levelWeights must cover every configured grid level' })
    }
    return { valid: errors.length === 0, config: parsed.data, errors }
  }

  async createDraft(input: {
    userId: string
    templateId: string
    name?: string
    description?: string
    overrides?: Record<string, unknown>
  }) {
    await ensureUser(prisma, input.userId)
    const base = this.getTemplate(input.templateId)
    const candidate = merge(base, input.overrides || {})
    if (input.name) candidate.name = input.name
    const validation = this.validateConfig(candidate)
    if (!validation.valid || !validation.config) {
      return { status: 'blocked', validation, notTradingAdvice: true }
    }
    const config = validation.config
    const auditHash = hash(config)
    const strategy = await prisma.strategy.create({
      data: {
        userId: input.userId,
        name: config.name,
        description: input.description || `由 ${config.templateId} 创建的声明式网格策略`,
        type: `grid_${config.mode}`,
        parameters: JSON.stringify(config),
        isActive: false,
      },
    })
    const version = await prisma.strategyVersion.create({
      data: {
        strategyId: strategy.id,
        strategyKey: `grid:${strategy.id}`,
        schemaVersion: config.schemaVersion,
        signalStrategyId: config.mode,
        signalVersion: 'v1',
        thresholdHash: hash({ spacing: config.spacingPolicy, facts: config.factRequirements }),
        entryPolicyId: 'grid_levels',
        entryPolicyVersion: 'v1',
        exitPolicyId: 'grid_levels',
        exitPolicyVersion: 'v1',
        sizingPolicyId: 'weighted_grid_sizing',
        sizingVersion: 'v1',
        portfolioPolicyId: 'cash_and_weight_limits',
        portfolioVersion: 'v1',
        costModelId: 'manual_plan_draft',
        costModelVersion: 'v1',
        constraintId: 'fams_trade_boundary',
        constraintVersion: 'v1',
        engineVersion: 'grid-plan-engine.v1',
        versionBundleJson: JSON.stringify(config),
        auditHash,
        isActive: false,
        validationJson: JSON.stringify({ schema: validation, history: { status: 'pending' } }),
      },
    })
    return { status: 'draft', strategy, version, validation, notTradingAdvice: true }
  }

  async validateDraft(versionId: string, expectedUserId?: string) {
    const version = await prisma.strategyVersion.findUnique({
      where: { id: versionId },
      include: { strategy: true },
    })
    if (!version) throw new Error('Strategy version not found')
    if (expectedUserId && version.strategy.userId !== expectedUserId) throw new Error('Strategy version does not belong to the requested user')
    const validation = this.validateConfig(JSON.parse(version.versionBundleJson || '{}'))
    if (!validation.valid || !validation.config) {
      await prisma.strategyVersion.update({ where: { id: versionId }, data: { validationJson: JSON.stringify({ schema: validation }) } })
      return { status: 'blocked', validation, historyReplay: null, notTradingAdvice: true }
    }
    const positions = await prisma.position.findMany({
      where: { userId: version.strategy.userId, status: 'open' },
      include: { asset: true },
    })
    const applicable = positions.filter((position) => validation.config!.applicableAssetTypes.includes(position.asset.type as any))
    const coverage = await Promise.all(applicable.map(async (position) => {
      const market = position.asset.exchange === 'HK' ? 'HK' : position.asset.exchange === 'US' ? 'US' : 'CN'
      const rows = await prisma.marketBarCanonical.findMany({
        where: { symbol: position.asset.symbol, market, timeframe: '1d', adjustType: 'none', dataVersion: 'canonical.v1' },
        select: { tradeDate: true, closePrice: true },
        orderBy: { tradeDate: 'desc' },
        take: Math.max(validation.config!.factRequirements.minCompletedBars, 60),
      })
      const closes = rows.reverse().map((row) => row.closePrice).filter((value) => Number.isFinite(value) && value > 0)
      const minSpacing = validation.config!.spacingPolicy.minPercent / 100
      let touchEvents = 0
      let peak = closes[0] || 0
      let maxDrawdown = 0
      for (let index = 1; index < closes.length; index += 1) {
        if (Math.abs(closes[index] / closes[index - 1] - 1) >= minSpacing) touchEvents += 1
        peak = Math.max(peak, closes[index])
        if (peak > 0) maxDrawdown = Math.min(maxDrawdown, closes[index] / peak - 1)
      }
      const low = closes.length > 0 ? Math.min(...closes) : 0
      const high = closes.length > 0 ? Math.max(...closes) : 0
      const observedRangePercent = low > 0 ? (high / low - 1) * 100 : 0
      const historySufficient = closes.length >= validation.config!.factRequirements.minCompletedBars
      const evidenceSufficient = historySufficient && touchEvents >= 2
      return {
        symbol: position.asset.symbol,
        bars: closes.length,
        sufficient: evidenceSufficient,
        evidence: {
          minSpacingPercent: validation.config!.spacingPolicy.minPercent,
          gridTouchEvents: touchEvents,
          observedRangePercent: Number(observedRangePercent.toFixed(4)),
          maxDrawdownPercent: Number((maxDrawdown * 100).toFixed(4)),
          performanceClaimed: false,
        },
      }
    }))
    const sufficient = coverage.filter((item) => item.sufficient).length
    const historyReplay = {
      status: applicable.length === 0 ? 'no_positions' : sufficient === applicable.length ? 'passed' : 'insufficient',
      applicablePositions: applicable.length,
      sufficientPositions: sufficient,
      coverage,
      metrics: {
        sampleBars: coverage.reduce((sum, item) => sum + item.bars, 0),
        gridTouchEvents: coverage.reduce((sum, item) => sum + item.evidence.gridTouchEvents, 0),
        maxObservedDrawdownPercent: coverage.length > 0 ? Math.min(...coverage.map((item) => item.evidence.maxDrawdownPercent)) : null,
        totalReturn: null,
        turnover: null,
      },
      note: '这是历史覆盖和网格触碰机会检查，不声明收益表现；完整收益、成本和回撤仍应在现有回测页复核。',
    }
    const activatable = validation.valid && historyReplay.status === 'passed' && historyReplay.metrics.gridTouchEvents >= applicable.length * 2
    const result = { schema: validation, historyReplay, activatable }
    await prisma.strategyVersion.update({
      where: { id: versionId },
      data: { validationJson: JSON.stringify(result), validatedAt: new Date() },
    })
    return { status: activatable ? 'validated' : 'blocked', validation, historyReplay, notTradingAdvice: true }
  }

  async activate(versionId: string, confirmation: { confirmed?: boolean; confirmedBy?: string }, expectedUserId?: string) {
    if (confirmation.confirmed !== true || !confirmation.confirmedBy?.trim()) {
      return { status: 'blocked', code: 'HUMAN_CONFIRMATION_REQUIRED', notTradingAdvice: true }
    }
    const version = await prisma.strategyVersion.findUnique({ where: { id: versionId }, include: { strategy: true } })
    if (!version) throw new Error('Strategy version not found')
    if (expectedUserId && version.strategy.userId !== expectedUserId) throw new Error('Strategy version does not belong to the requested user')
    const validation = JSON.parse(version.validationJson || '{}') as { activatable?: boolean }
    if (!version.validatedAt || validation.activatable !== true) {
      return { status: 'blocked', code: 'STRATEGY_VALIDATION_REQUIRED', notTradingAdvice: true }
    }
    await prisma.$transaction([
      prisma.strategyVersion.updateMany({ where: { strategyId: version.strategyId }, data: { isActive: false } }),
      prisma.strategyVersion.update({ where: { id: versionId }, data: { isActive: true, activatedAt: new Date() } }),
      prisma.strategy.update({ where: { id: version.strategyId }, data: { isActive: true, parameters: version.versionBundleJson } }),
    ])
    return {
      status: 'active',
      strategyId: version.strategyId,
      strategyVersionId: versionId,
      activatedBy: confirmation.confirmedBy,
      notTradingAdvice: true,
    }
  }

  async getActiveConfigs(userId: string) {
    const versions = await prisma.strategyVersion.findMany({
      where: { isActive: true, strategy: { userId, isActive: true, type: { startsWith: 'grid_' } } },
      include: { strategy: true },
      orderBy: { activatedAt: 'desc' },
    })
    return versions.flatMap((version) => {
      const validation = this.validateConfig(JSON.parse(version.versionBundleJson || '{}'))
      return validation.valid && validation.config ? [{ version, config: validation.config }] : []
    })
  }

  buildGridDraft(input: GridBuildInput) {
    const config = input.config
    const blockers: string[] = []
    if (!config.applicableAssetTypes.includes(input.assetType as any)) blockers.push('asset_type_not_supported')
    if (input.completedBars < config.factRequirements.minCompletedBars) blockers.push('completed_history_insufficient')
    if (input.confidence < config.factRequirements.minConfidence) blockers.push('market_data_confidence_low')
    if (input.materialChange === 'material' && config.factRequirements.blockBuyOnMaterialChange) blockers.push('material_change_requires_review')
    if (input.materialChange === 'insufficient') blockers.push('fundamental_or_news_evidence_insufficient')
    if (config.mode === 'trend_pullback' && !(input.ma5 && input.ma10 && input.ma30 && input.ma5 >= input.ma10 && input.ma10 >= input.ma30)) {
      blockers.push('trend_alignment_not_met')
    }
    if (config.mode === 'observe_only') blockers.push('observe_only_strategy')
    if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) blockers.push('current_price_invalid')

    const anchor = config.anchorPolicy.primary === 'ma10'
      ? input.ma10 || input.currentPrice
      : config.anchorPolicy.primary === 'average_cost'
        ? input.avgCost || input.currentPrice
        : config.anchorPolicy.primary === 'support_resistance'
          ? ((input.support || input.currentPrice) + (input.resistance || input.currentPrice)) / 2
          : input.currentPrice
    const rawSpacingPercent = config.spacingPolicy.type === 'atr_multiple' && input.atr14 && input.currentPrice > 0
      ? (input.atr14 * config.spacingPolicy.value / input.currentPrice) * 100
      : config.spacingPolicy.value
    const spacingPercent = Math.max(config.spacingPolicy.minPercent, Math.min(config.spacingPolicy.maxPercent, rawSpacingPercent))
    const spacing = input.currentPrice * spacingPercent / 100
    const isBoardLot = input.assetType === 'stock' || input.assetType === 'etf'
    const unit = isBoardLot ? 100 : 0.01
    const normalizeQuantity = (value: number) => Math.max(0, Math.floor(value / unit) * unit)
    const weights = config.sizingPolicy.levelWeights
    const maxAdjustment = config.sizingPolicy.maxAdjustmentPercent / 100
    const cashAfterFloor = Math.max(0, input.cashBudget - (input.portfolioValue || input.cashBudget) * config.riskPolicy.cashFloorPercent / 100)
    const weightCapacity = input.portfolioValue && input.portfolioValue > 0
      ? Math.max(0, input.portfolioValue * config.riskPolicy.maxAssetWeightPercent / 100 - (input.currentMarketValue || input.quantity * input.currentPrice))
      : Number.POSITIVE_INFINITY
    const buyBudget = Math.max(0, Math.min(cashAfterFloor * maxAdjustment, weightCapacity))
    const sellQuantity = Math.max(0, input.quantity * maxAdjustment)
    const buyWeightSum = weights.slice(0, config.levelPolicy.buyLevels).reduce((sum, value) => sum + value, 0) || 1
    const sellWeightSum = weights.slice(0, config.levelPolicy.sellLevels).reduce((sum, value) => sum + value, 0) || 1
    const now = input.now || new Date()
    const validUntil = new Date(now.getTime() + config.riskPolicy.validMinutes * 60_000)
    const external = (input.externalOrders || []).filter((order) => ['pending', 'submitted', 'partial', 'open'].includes(order.status))
    const conflict = (side: 'buy' | 'sell', price: number) => external.some((order) => order.side === side && order.price && Math.abs(order.price - price) <= spacing * 0.35)

    if (blockers.length > 0) {
      return {
        mode: 'observe_only' as const,
        orders: [],
        blockers,
        summary: `观察模式：${blockers.join('、')}`,
        constraints: { anchor, spacingPercent, validUntil: validUntil.toISOString(), notTradingAdvice: true },
      }
    }

    const orders: Array<Record<string, unknown>> = []
    for (let level = 1; level <= config.levelPolicy.buyLevels; level += 1) {
      const base = config.mode === 'cost_support' ? Math.min(input.currentPrice, input.support || anchor, anchor) : Math.min(input.currentPrice, anchor)
      const price = Number(Math.max(0.0001, base - spacing * level).toFixed(4))
      const allocated = buyBudget * (weights[level - 1] / buyWeightSum)
      const quantity = normalizeQuantity(allocated / price)
      if (quantity <= 0) continue
      orders.push({
        side: 'buy', level, price, quantity, amount: Number((price * quantity).toFixed(2)),
        validUntil: validUntil.toISOString(),
        conflictStatus: conflict('buy', price) ? 'overlaps_external' : 'none',
        triggerCondition: { priceAtOrBelow: price },
        rationale: `以 ${anchor.toFixed(4)} 为锚，间距 ${spacingPercent.toFixed(2)}% 的第 ${level} 档买入草案`,
      })
    }
    for (let level = 1; level <= config.levelPolicy.sellLevels; level += 1) {
      const base = config.mode === 'cost_support' ? Math.max(input.currentPrice, input.resistance || anchor, anchor) : Math.max(input.currentPrice, anchor)
      const price = Number((base + spacing * level).toFixed(4))
      const quantity = normalizeQuantity(sellQuantity * (weights[level - 1] / sellWeightSum))
      if (quantity <= 0) continue
      orders.push({
        side: 'sell', level, price, quantity, amount: Number((price * quantity).toFixed(2)),
        validUntil: validUntil.toISOString(),
        conflictStatus: conflict('sell', price) ? 'overlaps_external' : 'none',
        triggerCondition: { priceAtOrAbove: price },
        rationale: `以 ${anchor.toFixed(4)} 为锚，间距 ${spacingPercent.toFixed(2)}% 的第 ${level} 档卖出草案`,
      })
    }
    if (orders.length === 0) {
      return {
        mode: 'observe_only' as const,
        orders: [],
        blockers: ['order_size_below_minimum_lot_or_available_budget'],
        summary: '观察模式：可用现金或允许调整数量不足以形成最小交易单位。',
        constraints: {
          anchor: Number(anchor.toFixed(4)), spacingPercent: Number(spacingPercent.toFixed(4)),
          maxAdjustmentPercent: config.sizingPolicy.maxAdjustmentPercent,
          cashFloorPercent: config.riskPolicy.cashFloorPercent,
          maxAssetWeightPercent: config.riskPolicy.maxAssetWeightPercent,
          validUntil: validUntil.toISOString(), notTradingAdvice: true,
        },
      }
    }
    return {
      mode: config.mode,
      orders,
      blockers: [],
      summary: `生成 ${orders.filter((order) => order.side === 'buy').length} 档买入、${orders.filter((order) => order.side === 'sell').length} 档卖出人工计划草案。`,
      constraints: {
        anchor: Number(anchor.toFixed(4)), spacingPercent: Number(spacingPercent.toFixed(4)),
        maxAdjustmentPercent: config.sizingPolicy.maxAdjustmentPercent,
        cashFloorPercent: config.riskPolicy.cashFloorPercent,
        maxAssetWeightPercent: config.riskPolicy.maxAssetWeightPercent,
        validUntil: validUntil.toISOString(), notTradingAdvice: true,
      },
    }
  }
}

export const gridStrategyService = new GridStrategyService()
