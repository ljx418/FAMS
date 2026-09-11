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

export const gridOrderRoleSchema = z.enum([
  'capacity_build',
  'satellite_cycle',
  'rebound_exit',
  'conditional_buyback',
])

export type GridOrderRole = z.infer<typeof gridOrderRoleSchema>

const downtrendLevelSchema = z.object({
  orderRef: z.string().min(1),
  side: z.enum(['buy', 'sell']),
  price: z.number().positive(),
  quantity: z.number().positive(),
  orderRole: gridOrderRoleSchema,
  parentOrderRef: z.string().min(1).nullable().optional(),
  activationStatus: z.enum(['active', 'awaiting_parent_fill', 'awaiting_sellability', 'dormant']).default('active'),
  rationale: z.string().min(1),
}).strict()

export const downtrendDefensiveConfigSchema = z.object({
  schemaVersion: z.literal('fams.grid-strategy.v2'),
  templateId: z.string().min(1),
  name: z.string().min(1),
  mode: z.literal('downtrend_defensive'),
  status: z.string().min(1).optional(),
  source_id: z.string().min(1).optional(),
  fixedAnchor: z.object({
    price: z.number().positive(),
    asOf: z.string().min(1),
    reanchorOnlyAfter: z.array(z.enum(['completed_fill_cycle', 'pause_trigger', 'two_closes_above_ma5_with_nonfalling_ma5'])).min(1),
  }).strict(),
  allocation: z.object({
    core: z.number().nonnegative(),
    satellite: z.number().nonnegative(),
    reboundExit: z.number().nonnegative().default(0),
    hardCap: z.number().positive(),
    stageBuildCap: z.number().nonnegative().optional(),
  }).strict().refine((value) => value.core + value.satellite + value.reboundExit === value.hardCap, 'allocation sleeves must equal hardCap'),
  riskPolicy: z.object({
    cashFloorPercent: z.number().min(0).max(100),
    feeReserve: z.number().nonnegative().default(0),
    unfilledSellProceedsCountAsCash: z.literal(false),
    pauseRule: z.object({
      metric: z.literal('daily_close'),
      operator: z.literal('below'),
      threshold: z.number().positive(),
      action: z.literal('pause_pending_net_buys'),
      appliesTo: z.enum(['capacity_build', 'all_satellite_buys']).default('capacity_build'),
    }).strict().nullable(),
  }).strict(),
  capacityOverride: z.object({
    ignoreFrozenForCapacity: z.boolean(),
    reason: z.string().min(1),
  }).strict().optional(),
  levels: z.array(downtrendLevelSchema),
}).strict()

export type DowntrendDefensiveConfig = z.infer<typeof downtrendDefensiveConfigSchema>

export interface DowntrendDefensiveBuildInput {
  config: DowntrendDefensiveConfig
  assetType: string
  market?: string
  currentQuantity: number
  sellableQuantity: number
  currentClose?: number | null
  cashBudget: number
  availablePortfolioBuyBudget: number
  portfolioValue: number
  externalOrders?: Array<{ side: string; price: number | null; status: string }>
  ignoreFrozenForCapacity?: boolean
  now?: Date
}

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
  market?: string
  currentPrice: number
  avgCost: number
  quantity: number
  cashBudget: number
  availablePortfolioBuyBudget?: number
  portfolioValue?: number
  currentMarketValue?: number
  completedBars: number
  confidence: number
  materialChange: 'none' | 'watch' | 'material' | 'insufficient'
  valuationStatus?: string | null
  valuationConclusion?: string | null
  ma5?: number | null
  ma10?: number | null
  ma30?: number | null
  atr14?: number | null
  support?: number | null
  resistance?: number | null
  externalOrders?: Array<{ side: string; price: number | null; status: string }>
  now?: Date
}

export type GridPriceDirection = 'buy' | 'sell'

export function resolveGridTradingRules(assetType: string, market = 'CN') {
  const isChina = market === 'CN'
  const priceTick = assetType === 'etf' && isChina ? 0.001 : assetType === 'stock' && isChina ? 0.01 : 0.0001
  const lotSize = isChina && (assetType === 'stock' || assetType === 'etf') ? 100 : 0.01
  return {
    market,
    priceTick,
    priceDecimals: priceTick === 0.001 ? 3 : priceTick === 0.01 ? 2 : 4,
    lotSize,
    buyPriceRounding: 'down' as const,
    sellPriceRounding: 'up' as const,
  }
}

export function roundGridPrice(value: number, tick: number, direction: GridPriceDirection) {
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(tick) || tick <= 0) return 0
  const decimals = tick === 0.001 ? 3 : tick === 0.01 ? 2 : 4
  const scaled = direction === 'buy'
    ? Math.floor((value + tick * 1e-9) / tick)
    : Math.ceil((value - tick * 1e-9) / tick)
  return Number((Math.max(1, scaled) * tick).toFixed(decimals))
}

function normalizeToLot(value: number, lotSize: number) {
  const decimals = lotSize < 1 ? 2 : 0
  return Number((Math.max(0, Math.floor((value + lotSize * 1e-9) / lotSize)) * lotSize).toFixed(decimals))
}

export function allocateLargestRemainder(totalQuantity: number, weights: number[], levels: number, lotSize: number) {
  if (levels <= 0 || lotSize <= 0) return []
  const usableWeights = weights.slice(0, levels)
  const weightSum = usableWeights.reduce((sum, value) => sum + value, 0)
  const totalLots = Math.floor((totalQuantity + lotSize * 1e-9) / lotSize)
  if (totalLots <= 0 || weightSum <= 0) return Array.from({ length: levels }, () => 0)
  const exact = usableWeights.map((weight) => totalLots * weight / weightSum)
  const allocatedLots = exact.map((value) => Math.floor(value))
  let remaining = totalLots - allocatedLots.reduce((sum, value) => sum + value, 0)
  const ranking = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (let index = 0; remaining > 0; index = (index + 1) % ranking.length) {
    allocatedLots[ranking[index].index] += 1
    remaining -= 1
  }
  const decimals = lotSize < 1 ? 2 : 0
  return allocatedLots.map((lots) => Number((lots * lotSize).toFixed(decimals)))
}

function allocateBuyLots(budget: number, prices: number[], weights: number[], lotSize: number) {
  if (budget <= 0 || prices.length === 0) return prices.map(() => 0)
  const usableWeights = weights.slice(0, prices.length)
  const weightSum = usableWeights.reduce((sum, value) => sum + value, 0) || 1
  const targets = usableWeights.map((weight) => budget * weight / weightSum)
  const exactLots = prices.map((price, index) => targets[index] / (price * lotSize))
  const lots = exactLots.map((value) => Math.max(0, Math.floor(value)))
  let remaining = budget - lots.reduce((sum, value, index) => sum + value * lotSize * prices[index], 0)
  const ranking = exactLots
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index)
  for (const item of ranking) {
    const lotAmount = prices[item.index] * lotSize
    if (remaining + 1e-8 >= lotAmount) {
      lots[item.index] += 1
      remaining -= lotAmount
    }
  }
  const decimals = lotSize < 1 ? 2 : 0
  return lots.map((value) => Number((value * lotSize).toFixed(decimals)))
}

export function shanghaiSessionClose(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value)
  return new Date(Date.UTC(value('year'), value('month') - 1, value('day'), 7, 0, 0, 0))
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

  validateDowntrendConfig(config: unknown) {
    const parsed = downtrendDefensiveConfigSchema.safeParse(config)
    if (!parsed.success) {
      return {
        valid: false as const,
        config: null,
        errors: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      }
    }
    const refs = new Set<string>()
    const errors: Array<{ path: string; message: string }> = []
    parsed.data.levels.forEach((level, index) => {
      if (refs.has(level.orderRef)) errors.push({ path: `levels.${index}.orderRef`, message: 'orderRef must be unique' })
      refs.add(level.orderRef)
    })
    parsed.data.levels.forEach((level, index) => {
      if (level.parentOrderRef && !refs.has(level.parentOrderRef)) errors.push({ path: `levels.${index}.parentOrderRef`, message: 'parentOrderRef must reference a configured level' })
      if (level.orderRole === 'rebound_exit' && (level.side !== 'sell' || level.parentOrderRef)) errors.push({ path: `levels.${index}`, message: 'rebound_exit must be an unpaired sell' })
      if (level.orderRole === 'conditional_buyback' && (level.side !== 'buy' || !level.parentOrderRef)) errors.push({ path: `levels.${index}`, message: 'conditional_buyback must be a paired buy' })
    })
    return { valid: errors.length === 0, config: parsed.data, errors }
  }

  async createDowntrendDraft(input: { userId: string; config: unknown; description?: string }) {
    await ensureUser(prisma, input.userId)
    const validation = this.validateDowntrendConfig(input.config)
    if (!validation.valid || !validation.config) return { status: 'blocked', validation, notTradingAdvice: true }
    const config = validation.config
    const auditHash = hash(config)
    const strategy = await prisma.strategy.create({
      data: {
        userId: input.userId,
        name: config.name,
        description: input.description || '下跌趋势防御网格草案；显式价位、仓位角色、父单和暂停线。',
        type: 'grid_downtrend_defensive',
        parameters: JSON.stringify(config),
        isActive: false,
      },
    })
    const version = await prisma.strategyVersion.create({
      data: {
        strategyId: strategy.id, strategyKey: `grid:${strategy.id}`,
        schemaVersion: config.schemaVersion,
        signalStrategyId: config.mode, signalVersion: 'v2',
        thresholdHash: hash({ pause: config.riskPolicy.pauseRule, anchor: config.fixedAnchor }),
        entryPolicyId: 'explicit_role_aware_levels', entryPolicyVersion: 'v2',
        exitPolicyId: 'paired_or_permanent_exit', exitPolicyVersion: 'v2',
        sizingPolicyId: 'core_satellite_rebound_capacity', sizingVersion: 'v2',
        portfolioPolicyId: 'hard_cash_floor_no_unfilled_proceeds', portfolioVersion: 'v2',
        costModelId: 'manual_plan_draft', costModelVersion: 'v1',
        constraintId: 'fams_trade_boundary', constraintVersion: 'v1',
        engineVersion: 'grid-plan-engine.v2',
        versionBundleJson: JSON.stringify(config), auditHash, isActive: false,
        validationJson: JSON.stringify({ schema: validation, activatable: false, reason: 'manual_draft_only' }),
      },
    })
    return { status: 'draft', strategy, version, validation, executionBoundary: { canCreateOrder: false }, notTradingAdvice: true }
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
    const globalBlockers: string[] = []
    const buyBlockers: string[] = []
    const sellBlockers: string[] = []
    if (!config.applicableAssetTypes.includes(input.assetType as any)) globalBlockers.push('asset_type_not_supported')
    if (input.completedBars < config.factRequirements.minCompletedBars) globalBlockers.push('completed_history_insufficient')
    if (input.confidence < config.factRequirements.minConfidence) globalBlockers.push('market_data_confidence_low')
    if (input.materialChange === 'material' && config.factRequirements.blockBuyOnMaterialChange) buyBlockers.push('material_change_requires_review')
    if (input.materialChange === 'insufficient') globalBlockers.push('fundamental_or_news_evidence_insufficient')
    if (input.assetType === 'stock' && ['insufficient', 'unavailable'].includes(input.valuationStatus || '')) {
      buyBlockers.push('stock_valuation_evidence_insufficient')
    }
    if (input.assetType === 'stock' && ['risk_review', 'overvalued_watch'].includes(input.valuationConclusion || '')) {
      buyBlockers.push(`stock_valuation_${input.valuationConclusion}`)
    }
    if (config.mode === 'trend_pullback' && !(input.ma5 && input.ma10 && input.ma30 && input.ma5 >= input.ma10 && input.ma10 >= input.ma30)) {
      globalBlockers.push('trend_alignment_not_met')
    }
    if (config.mode === 'observe_only') globalBlockers.push('observe_only_strategy')
    if (!Number.isFinite(input.currentPrice) || input.currentPrice <= 0) globalBlockers.push('current_price_invalid')

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
    const tradingRules = resolveGridTradingRules(input.assetType, input.market || 'CN')
    const unit = tradingRules.lotSize
    const weights = config.sizingPolicy.levelWeights
    const maxAdjustment = config.sizingPolicy.maxAdjustmentPercent / 100
    const cashAfterFloor = Math.max(0, input.cashBudget - (input.portfolioValue || input.cashBudget) * config.riskPolicy.cashFloorPercent / 100)
    const weightCapacity = input.portfolioValue && input.portfolioValue > 0
      ? Math.max(0, input.portfolioValue * config.riskPolicy.maxAssetWeightPercent / 100 - (input.currentMarketValue || input.quantity * input.currentPrice))
      : Number.POSITIVE_INFINITY
    const portfolioBudgetRemainingBefore = Number.isFinite(input.availablePortfolioBuyBudget)
      ? Math.max(0, Number(input.availablePortfolioBuyBudget))
      : cashAfterFloor
    const buyBudget = Math.max(0, Math.min(cashAfterFloor * maxAdjustment, weightCapacity, portfolioBudgetRemainingBefore))
    const sellQuantity = normalizeToLot(Math.max(0, input.quantity * maxAdjustment), unit)
    if (buyBudget <= 0 && config.levelPolicy.buyLevels > 0) buyBlockers.push('buy_budget_or_weight_capacity_exhausted')
    if (sellQuantity < unit && config.levelPolicy.sellLevels > 0) sellBlockers.push('sell_quantity_below_minimum_lot')
    const now = input.now || new Date()
    const validUntil = shanghaiSessionClose(now)
    if (now.getTime() >= validUntil.getTime()) globalBlockers.push('session_closed')
    const external = (input.externalOrders || []).filter((order) => ['pending', 'submitted', 'partial', 'open'].includes(order.status))
    const conflict = (side: 'buy' | 'sell', price: number) => external.some((order) => order.side === side && order.price && Math.abs(order.price - price) <= spacing * 0.35)

    const anchorSource = config.anchorPolicy.primary === 'ma10'
      ? input.ma10 ? 'ma10' : 'current_price_fallback'
      : config.anchorPolicy.primary === 'average_cost'
        ? input.avgCost ? 'average_cost' : 'current_price_fallback'
        : config.anchorPolicy.primary === 'support_resistance'
          ? input.support || input.resistance ? 'support_resistance_midpoint' : 'current_price_fallback'
          : 'current_price'
    const derivation = {
      schemaVersion: 'fams.grid-derivation.v1',
      anchor: {
        policy: config.anchorPolicy.primary,
        source: anchorSource,
        value: Number(anchor.toFixed(4)),
        inputs: {
          currentPrice: input.currentPrice,
          averageCost: input.avgCost,
          ma10: input.ma10 ?? null,
          support: input.support ?? null,
          resistance: input.resistance ?? null,
        },
      },
      spacing: {
        policy: config.spacingPolicy.type,
        policyValue: config.spacingPolicy.value,
        atr14: input.atr14 ?? null,
        rawPercent: Number(rawSpacingPercent.toFixed(4)),
        minPercent: config.spacingPolicy.minPercent,
        maxPercent: config.spacingPolicy.maxPercent,
        finalPercent: Number(spacingPercent.toFixed(4)),
        absoluteAmount: Number(spacing.toFixed(4)),
      },
      tradingRules,
      validity: {
        policy: 'session_close',
        timeZone: 'Asia/Shanghai',
        generatedAt: now.toISOString(),
        validUntil: validUntil.toISOString(),
        sessionClosed: now.getTime() >= validUntil.getTime(),
      },
      sizing: {
        cashBudget: input.cashBudget,
        portfolioValue: input.portfolioValue ?? null,
        currentMarketValue: input.currentMarketValue ?? input.quantity * input.currentPrice,
        cashFloorPercent: config.riskPolicy.cashFloorPercent,
        cashAfterFloor: Number(cashAfterFloor.toFixed(2)),
        maxAssetWeightPercent: config.riskPolicy.maxAssetWeightPercent,
        weightCapacity: Number.isFinite(weightCapacity) ? Number(weightCapacity.toFixed(2)) : null,
        maxAdjustmentPercent: config.sizingPolicy.maxAdjustmentPercent,
        buyBudget: Number(buyBudget.toFixed(2)),
        portfolioBudgetRemainingBefore: Number(portfolioBudgetRemainingBefore.toFixed(2)),
        sellQuantity: Number(sellQuantity.toFixed(4)),
        lotSize: unit,
        levelWeights: weights,
      },
      gates: {
        global: [...new Set(globalBlockers)],
        buy: [...new Set(buyBlockers)],
        sell: [...new Set(sellBlockers)],
      },
    }

    if (globalBlockers.length > 0) {
      return {
        mode: 'observe_only' as const,
        orders: [],
        blockers: [...new Set(globalBlockers)],
        sideBlockers: derivation.gates,
        summary: `观察模式：${[...new Set(globalBlockers)].join('、')}`,
        constraints: {
          anchor, spacingPercent, validUntil: validUntil.toISOString(), validityPolicy: 'session_close',
          priceTick: tradingRules.priceTick, lotSize: tradingRules.lotSize, notTradingAdvice: true,
        },
        derivation,
      }
    }

    const orders: Array<Record<string, unknown>> = []
    if (buyBlockers.length === 0 && config.levelPolicy.buyLevels > 0) {
      const base = config.mode === 'cost_support' ? Math.min(input.currentPrice, input.support || anchor, anchor) : Math.min(input.currentPrice, anchor)
      const prices = Array.from({ length: config.levelPolicy.buyLevels }, (_value, index) => (
        roundGridPrice(Math.max(tradingRules.priceTick, base - spacing * (index + 1)), tradingRules.priceTick, 'buy')
      ))
      const quantities = allocateBuyLots(buyBudget, prices, weights, unit)
      prices.forEach((price, index) => {
        const quantity = quantities[index]
        if (quantity <= 0) return
        orders.push({
          side: 'buy', level: index + 1, price, quantity, amount: Number((price * quantity).toFixed(2)),
          validUntil: validUntil.toISOString(),
          conflictStatus: conflict('buy', price) ? 'overlaps_external' : 'none',
          triggerCondition: { priceAtOrBelow: price },
          rationale: `以 ${anchor.toFixed(4)} 为锚，间距 ${spacingPercent.toFixed(2)}% 的第 ${index + 1} 档买入草案；价格按 ${tradingRules.priceTick} 元步长向下取整`,
        })
      })
    }
    if (sellBlockers.length === 0 && config.levelPolicy.sellLevels > 0) {
      const base = config.mode === 'cost_support' ? Math.max(input.currentPrice, input.resistance || anchor, anchor) : Math.max(input.currentPrice, anchor)
      const quantities = allocateLargestRemainder(sellQuantity, weights, config.levelPolicy.sellLevels, unit)
      quantities.forEach((quantity, index) => {
        if (quantity <= 0) return
        const price = roundGridPrice(base + spacing * (index + 1), tradingRules.priceTick, 'sell')
        orders.push({
          side: 'sell', level: index + 1, price, quantity, amount: Number((price * quantity).toFixed(2)),
          validUntil: validUntil.toISOString(),
          conflictStatus: conflict('sell', price) ? 'overlaps_external' : 'none',
          triggerCondition: { priceAtOrAbove: price },
          rationale: `以 ${anchor.toFixed(4)} 为锚，间距 ${spacingPercent.toFixed(2)}% 的第 ${index + 1} 档卖出草案；价格按 ${tradingRules.priceTick} 元步长向上取整，数量按最大余数法分配`,
        })
      })
    }
    const immediateBuyAmount = orders
      .filter((order) => order.side === 'buy')
      .reduce((sum, order) => sum + Number(order.amount || 0), 0)
    ;(derivation.sizing as Record<string, unknown>).immediateBuyAmount = Number(immediateBuyAmount.toFixed(2))
    ;(derivation.sizing as Record<string, unknown>).portfolioBudgetRemainingAfter = Number(Math.max(0, portfolioBudgetRemainingBefore - immediateBuyAmount).toFixed(2))
    if (orders.length === 0) {
      const blockers = [...new Set([
        ...buyBlockers,
        ...sellBlockers,
        'order_size_below_minimum_lot_or_available_budget',
      ])]
      return {
        mode: 'observe_only' as const,
        orders: [],
        blockers,
        sideBlockers: derivation.gates,
        summary: '观察模式：可用现金或允许调整数量不足以形成最小交易单位。',
        constraints: {
          anchor: Number(anchor.toFixed(4)), spacingPercent: Number(spacingPercent.toFixed(4)),
          maxAdjustmentPercent: config.sizingPolicy.maxAdjustmentPercent,
          cashFloorPercent: config.riskPolicy.cashFloorPercent,
          maxAssetWeightPercent: config.riskPolicy.maxAssetWeightPercent,
          priceTick: tradingRules.priceTick,
          lotSize: tradingRules.lotSize,
          validityPolicy: 'session_close',
          validUntil: validUntil.toISOString(), notTradingAdvice: true,
        },
        derivation,
      }
    }
    const sideSummary = [
      orders.some((order) => order.side === 'buy') ? null : buyBlockers.length ? `买入受限：${[...new Set(buyBlockers)].join('、')}` : null,
      orders.some((order) => order.side === 'sell') ? null : sellBlockers.length ? `卖出受限：${[...new Set(sellBlockers)].join('、')}` : null,
    ].filter(Boolean)
    return {
      mode: config.mode,
      orders,
      blockers: [...new Set([...buyBlockers, ...sellBlockers])],
      sideBlockers: derivation.gates,
      summary: `生成 ${orders.filter((order) => order.side === 'buy').length} 档买入、${orders.filter((order) => order.side === 'sell').length} 档卖出人工计划草案。${sideSummary.length ? ` ${sideSummary.join('；')}。` : ''}`,
      constraints: {
        anchor: Number(anchor.toFixed(4)), spacingPercent: Number(spacingPercent.toFixed(4)),
        maxAdjustmentPercent: config.sizingPolicy.maxAdjustmentPercent,
        cashFloorPercent: config.riskPolicy.cashFloorPercent,
        maxAssetWeightPercent: config.riskPolicy.maxAssetWeightPercent,
        priceTick: tradingRules.priceTick,
        lotSize: tradingRules.lotSize,
        immediateBuyAmount: Number(immediateBuyAmount.toFixed(2)),
        portfolioBudgetRemainingBefore: Number(portfolioBudgetRemainingBefore.toFixed(2)),
        portfolioBudgetRemainingAfter: Number(Math.max(0, portfolioBudgetRemainingBefore - immediateBuyAmount).toFixed(2)),
        validityPolicy: 'session_close',
        validUntil: validUntil.toISOString(), notTradingAdvice: true,
      },
      derivation,
    }
  }

  buildDowntrendDefensiveDraft(input: DowntrendDefensiveBuildInput) {
    const parsed = downtrendDefensiveConfigSchema.safeParse(input.config)
    if (!parsed.success) {
      return {
        mode: 'observe_only' as const,
        orders: [],
        blockers: ['downtrend_config_invalid'],
        sideBlockers: { global: ['downtrend_config_invalid'], buy: [], sell: [] },
        summary: '观察模式：下跌趋势防御网格配置无效。',
        constraints: { notTradingAdvice: true, validationErrors: parsed.error.issues },
        derivation: { schemaVersion: 'fams.grid-derivation.v2', validationErrors: parsed.error.issues },
      }
    }
    const config = parsed.data
    const now = input.now || new Date()
    const validUntil = shanghaiSessionClose(now)
    const tradingRules = resolveGridTradingRules(input.assetType, input.market || 'CN')
    const globalBlockers: string[] = []
    const buyBlockers: string[] = []
    const sellBlockers: string[] = []
    const refs = new Set<string>()
    for (const level of config.levels) {
      if (refs.has(level.orderRef)) globalBlockers.push(`duplicate_order_ref:${level.orderRef}`)
      refs.add(level.orderRef)
    }
    for (const level of config.levels) {
      if (level.parentOrderRef && !refs.has(level.parentOrderRef)) globalBlockers.push(`parent_order_ref_not_found:${level.orderRef}`)
      if (level.orderRole === 'rebound_exit' && (level.side !== 'sell' || level.parentOrderRef)) globalBlockers.push(`invalid_rebound_exit:${level.orderRef}`)
      if (level.orderRole === 'conditional_buyback' && (level.side !== 'buy' || !level.parentOrderRef)) globalBlockers.push(`invalid_conditional_buyback:${level.orderRef}`)
    }
    if (now.getTime() >= validUntil.getTime()) globalBlockers.push('session_closed')
    if (input.currentQuantity > config.allocation.hardCap) globalBlockers.push('quantity_hard_cap_already_exceeded')

    const currentReboundExit = Math.min(config.allocation.reboundExit, Math.max(0, input.currentQuantity - config.allocation.core - config.allocation.satellite))
    const currentSatellite = Math.min(config.allocation.satellite, Math.max(0, input.currentQuantity - config.allocation.core - currentReboundExit))
    const remainingSatelliteCapacity = Math.max(0, config.allocation.satellite - currentSatellite)
    const stageBuildCapacity = Math.min(remainingSatelliteCapacity, config.allocation.stageBuildCap ?? remainingSatelliteCapacity)
    const nonCoreSellable = Math.max(0, input.sellableQuantity - Math.min(config.allocation.core, input.currentQuantity))
    let remainingReboundSell = Math.min(currentReboundExit, nonCoreSellable)
    let remainingSatelliteSell = Math.min(currentSatellite, Math.max(0, nonCoreSellable - remainingReboundSell))
    let remainingBuild = Math.min(stageBuildCapacity, Math.max(0, config.allocation.hardCap - input.currentQuantity))
    let remainingBuyBudget = Math.max(0, input.availablePortfolioBuyBudget - config.riskPolicy.feeReserve)
    const pauseTriggered = Boolean(
      config.riskPolicy.pauseRule
      && Number.isFinite(Number(input.currentClose))
      && Number(input.currentClose) < config.riskPolicy.pauseRule.threshold,
    )
    const activeExternal = (input.externalOrders || []).filter((order) => ['pending', 'submitted', 'partial', 'open', 'triggered'].includes(order.status))
    const conflict = (side: string, price: number) => activeExternal.some((order) => (
      order.side.toLowerCase() === side.toLowerCase()
      && order.price !== null
      && Math.abs(Number(order.price) - price) <= tradingRules.priceTick / 2
    ))
    const sourceLevels = new Map(config.levels.map((level) => [level.orderRef, level]))
    const sideLevel = { buy: 0, sell: 0 }
    const orders: Array<Record<string, unknown>> = []

    if (globalBlockers.length === 0) {
      for (const configured of config.levels) {
        const price = roundGridPrice(configured.price, tradingRules.priceTick, configured.side)
        const quantity = normalizeToLot(configured.quantity, tradingRules.lotSize)
        let activationStatus = configured.activationStatus
        let blocker: string | null = null
        const parent = configured.parentOrderRef ? sourceLevels.get(configured.parentOrderRef) : null

        if (quantity <= 0) blocker = 'quantity_below_minimum_lot'
        if (configured.orderRole === 'rebound_exit' && !blocker) {
          if (remainingReboundSell < quantity) blocker = 'rebound_exit_capacity_exhausted'
          else remainingReboundSell -= quantity
        } else if (configured.side === 'sell' && activationStatus === 'active' && !blocker) {
          if (remainingSatelliteSell < quantity) {
            blocker = 'satellite_sellability_not_yet_available'
            activationStatus = 'awaiting_sellability'
          } else remainingSatelliteSell -= quantity
        } else if (configured.orderRole === 'capacity_build' && configured.side === 'buy' && activationStatus === 'active' && !blocker) {
          if (pauseTriggered) {
            blocker = 'daily_close_pause_triggered'
            activationStatus = 'dormant'
          } else if (remainingBuild < quantity) {
            blocker = 'satellite_stage_or_hard_cap_exhausted'
            activationStatus = 'dormant'
          } else if (remainingBuyBudget + 1e-8 < price * quantity) {
            blocker = 'portfolio_cash_floor_gate'
            activationStatus = 'dormant'
          } else {
            remainingBuild -= quantity
            remainingBuyBudget -= price * quantity
          }
        } else if (configured.orderRole === 'conditional_buyback' && !blocker) {
          if (!parent || parent.side !== 'sell' || parent.quantity < configured.quantity) blocker = 'invalid_parent_sell_capacity'
          const buybackPaused = pauseTriggered && config.riskPolicy.pauseRule?.appliesTo === 'all_satellite_buys'
          activationStatus = buybackPaused ? 'dormant' : 'awaiting_parent_fill'
          if (buybackPaused) blocker = 'daily_close_pause_triggered'
        } else if (configured.parentOrderRef && configured.side === 'sell' && !blocker) {
          if (!parent || parent.side !== 'buy' || parent.quantity < configured.quantity) blocker = 'invalid_parent_buy_capacity'
          activationStatus = 'awaiting_parent_fill'
        }

        sideLevel[configured.side] += 1
        if (blocker) {
          if (configured.side === 'buy') buyBlockers.push(blocker)
          else sellBlockers.push(blocker)
        }
        const orderPauseRule = configured.side === 'buy' ? config.riskPolicy.pauseRule : null
        const triggerCondition = {
          schemaVersion: 'fams.grid-order-trigger.v2',
          orderRef: configured.orderRef,
          orderRole: configured.orderRole,
          parentOrderRef: configured.parentOrderRef || null,
          activationStatus,
          pauseRule: orderPauseRule,
          blocker,
          ...(configured.side === 'buy' ? { priceAtOrBelow: price } : { priceAtOrAbove: price }),
          consumesImmediateCashBeforeFill: configured.side === 'buy' && activationStatus === 'active',
        }
        orders.push({
          side: configured.side,
          level: sideLevel[configured.side],
          price,
          quantity,
          amount: Number((price * quantity).toFixed(2)),
          validUntil: validUntil.toISOString(),
          status: activationStatus,
          conflictStatus: conflict(configured.side, price) ? 'overlaps_external' : activationStatus === 'active' ? 'none' : 'not_active',
          orderRole: configured.orderRole,
          parentOrderRef: configured.parentOrderRef || null,
          activationStatus,
          pauseRule: orderPauseRule,
          triggerCondition,
          rationale: configured.rationale,
        })
      }
    }

    const activeBuyPrincipal = orders
      .filter((order) => order.side === 'buy' && order.activationStatus === 'active')
      .reduce((sum, order) => sum + Number(order.amount), 0)
    const immediateCashCommitment = activeBuyPrincipal > 0 ? activeBuyPrincipal + config.riskPolicy.feeReserve : 0
    const projectedCash = input.cashBudget - immediateCashCommitment
    const cashFloorAmount = input.portfolioValue * config.riskPolicy.cashFloorPercent / 100
    if (projectedCash + 1e-8 < cashFloorAmount) {
      globalBlockers.push('portfolio_cash_floor_gate')
    }
    const derivation = {
      schemaVersion: 'fams.grid-derivation.v2',
      fixedAnchor: config.fixedAnchor,
      allocation: {
        ...config.allocation,
        currentCore: Math.min(config.allocation.core, input.currentQuantity),
        currentSatellite,
        currentReboundExit,
        remainingSatelliteCapacity,
        stageBuildCapacity,
        sellableQuantity: input.sellableQuantity,
        nonCoreSellable,
        ignoreFrozenForCapacity: input.ignoreFrozenForCapacity === true,
      },
      cashGate: {
        cashBudget: input.cashBudget,
        cashFloorPercent: config.riskPolicy.cashFloorPercent,
        cashFloorAmount: Number(cashFloorAmount.toFixed(2)),
        unfilledSellProceedsCountAsCash: false,
        feeReserve: config.riskPolicy.feeReserve,
        activeBuyPrincipal: Number(activeBuyPrincipal.toFixed(2)),
        immediateCashCommitment: Number(immediateCashCommitment.toFixed(2)),
        projectedCash: Number(projectedCash.toFixed(2)),
        portfolioBudgetRemainingBefore: Number(input.availablePortfolioBuyBudget.toFixed(2)),
        portfolioBudgetRemainingAfter: Number(Math.max(0, input.availablePortfolioBuyBudget - immediateCashCommitment).toFixed(2)),
      },
      pause: { rule: config.riskPolicy.pauseRule, currentClose: input.currentClose ?? null, triggered: pauseTriggered },
      tradingRules,
      validity: { policy: 'session_close', timeZone: 'Asia/Shanghai', generatedAt: now.toISOString(), validUntil: validUntil.toISOString() },
      gates: { global: [...new Set(globalBlockers)], buy: [...new Set(buyBlockers)], sell: [...new Set(sellBlockers)] },
    }
    if (globalBlockers.length > 0) {
      return {
        mode: 'observe_only' as const,
        orders: [],
        blockers: [...new Set(globalBlockers)],
        sideBlockers: derivation.gates,
        summary: `观察模式：${[...new Set(globalBlockers)].join('、')}`,
        constraints: { ...derivation.cashGate, fixedAnchor: config.fixedAnchor, validUntil: validUntil.toISOString(), notTradingAdvice: true },
        derivation,
      }
    }
    return {
      mode: config.mode,
      orders,
      blockers: [...new Set([...buyBlockers, ...sellBlockers])],
      sideBlockers: derivation.gates,
      summary: `下跌趋势防御网格：${orders.filter((order) => order.activationStatus === 'active').length} 张当前拟单，${orders.filter((order) => order.activationStatus !== 'active').length} 张条件/等待单。`,
      constraints: {
        ...derivation.cashGate,
        fixedAnchor: config.fixedAnchor,
        reanchorOnlyAfter: config.fixedAnchor.reanchorOnlyAfter,
        validUntil: validUntil.toISOString(),
        priceTick: tradingRules.priceTick,
        lotSize: tradingRules.lotSize,
        notTradingAdvice: true,
      },
      derivation,
    }
  }

  buildConditionalBuybackDraft(input: {
    parentGridPlanId: string
    parentSellOrders: Array<{ id: string; level: number; price: number; quantity: number; validUntil?: Date | string | null; orderRole?: GridOrderRole; orderRef?: string | null }>
    spacingAbsolute: number
    assetType: string
    market?: string
    now?: Date
  }) {
    const now = input.now || new Date()
    const validUntil = shanghaiSessionClose(now)
    const tradingRules = resolveGridTradingRules(input.assetType, input.market || 'CN')
    const blockers: string[] = []
    if (now.getTime() >= validUntil.getTime()) blockers.push('session_closed')
    if (!Number.isFinite(input.spacingAbsolute) || input.spacingAbsolute <= 0) blockers.push('grid_spacing_invalid')
    if (input.parentSellOrders.length === 0) blockers.push('parent_sell_draft_unavailable')
    const derivationRows: Array<Record<string, unknown>> = []
    const eligibleParents = input.parentSellOrders.filter((parent) => parent.orderRole !== 'rebound_exit')
    if (input.parentSellOrders.length > 0 && eligibleParents.length === 0) blockers.push('rebound_exit_has_no_buyback')
    const orders = blockers.some((item) => item !== 'rebound_exit_has_no_buyback') ? [] : eligibleParents.flatMap((parent) => {
      const rawPrice = parent.price - input.spacingAbsolute
      const price = roundGridPrice(rawPrice, tradingRules.priceTick, 'buy')
      const quantity = normalizeToLot(parent.quantity, tradingRules.lotSize)
      if (rawPrice <= 0 || price <= 0 || quantity <= 0) return []
      const triggerCondition = {
        schemaVersion: 'fams.grid-order-trigger.v2',
        orderRole: 'conditional_buyback',
        parentOrderRef: parent.orderRef || null,
        activationStatus: 'awaiting_parent_fill',
        activationPolicy: 'after_parent_sell_fill',
        parentGridPlanId: input.parentGridPlanId,
        parentOrderDraftId: parent.id,
        parentSellLevel: parent.level,
        parentSellPrice: parent.price,
        requiredFilledQuantity: quantity,
        consumesImmediateCashBeforeFill: false,
      }
      derivationRows.push({
        level: parent.level,
        parentOrderDraftId: parent.id,
        parentSellPrice: parent.price,
        spacingAbsolute: input.spacingAbsolute,
        rawBuybackPrice: rawPrice,
        roundedBuybackPrice: price,
        priceTick: tradingRules.priceTick,
        quantity,
      })
      return [{
        side: 'buy' as const,
        level: parent.level,
        price,
        quantity,
        amount: Number((price * quantity).toFixed(2)),
        validUntil: validUntil.toISOString(),
        status: 'awaiting_parent_fill',
        orderRole: 'conditional_buyback' as const,
        parentOrderRef: parent.orderRef || null,
        activationStatus: 'awaiting_parent_fill' as const,
        pauseRule: null,
        conflictStatus: 'not_active_until_parent_fill',
        triggerCondition,
        rationale: `仅在父卖单第 ${parent.level} 档确认成交 ${quantity} 后激活；按父卖价下移一个本轮间距并以 ${tradingRules.priceTick} 元步长向下取整`,
      }]
    })
    return {
      mode: 'conditional_buyback' as const,
      status: orders.length > 0 ? 'awaiting_parent_fill' as const : 'observe_only' as const,
      orders,
      blockers: [...new Set(blockers)],
      summary: orders.length > 0
        ? `生成 ${orders.length} 档卖出成交后条件买回草案；永久反弹减仓不会生成买回，父卖单成交前不占用当前现金。`
        : `未生成条件买回草案：${[...new Set(blockers)].join('、')}`,
      constraints: {
        parentGridPlanId: input.parentGridPlanId,
        activationPolicy: 'after_parent_sell_fill',
        consumesImmediateCashBeforeFill: false,
        spacingAbsolute: Number(input.spacingAbsolute.toFixed(4)),
        priceTick: tradingRules.priceTick,
        lotSize: tradingRules.lotSize,
        validityPolicy: 'session_close',
        validUntil: validUntil.toISOString(),
        notTradingAdvice: true,
      },
      derivation: {
        schemaVersion: 'fams.conditional-buyback-derivation.v1',
        formula: 'parent_sell_price - one_final_grid_spacing',
        tradingRules,
        validity: { policy: 'session_close', timeZone: 'Asia/Shanghai', generatedAt: now.toISOString(), validUntil: validUntil.toISOString() },
        parents: derivationRows,
      },
    }
  }
}

export const gridStrategyService = new GridStrategyService()
