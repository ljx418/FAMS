import { createHash } from 'node:crypto'
import { z } from 'zod'

export const investmentPolicyStrategyFamilySchema = z.enum([
  'portfolio',
  'dividend_low_vol',
  'rotation_volatility',
])

const warningBandSchema = z.object({
  minPercent: z.number().min(0).max(100).nullable(),
  maxPercent: z.number().min(0).max(100).nullable(),
}).strict()

const strategyBucketSchema = z.object({
  strategyFamily: investmentPolicyStrategyFamilySchema,
  targetPercent: z.number().min(0).max(100),
  warningBand: warningBandSchema,
}).strict()

const balancedComponentSchema = z.object({
  assetClass: z.enum(['equity_index', 'bond_fund', 'gold', 'cash']),
  targetPercent: z.number().min(0).max(100),
}).strict()

export const investmentPolicyContractSchema = z.object({
  schemaVersion: z.literal('fams.investment-policy.v1'),
  name: z.string().trim().min(1).max(120),
  reserveCash: z.object({
    floorPercent: z.number().min(0).max(50).nullable(),
    classification: z.literal('cash_outside_portfolio_strategy'),
  }).strict(),
  strategyBuckets: z.array(strategyBucketSchema).length(3),
  portfolioTemplate: z.object({
    templateId: z.literal('four_asset_balanced'),
    displayName: z.literal('四资产均衡组合'),
    components: z.array(balancedComponentSchema).length(4),
    activationMode: z.literal('explicit_confirmation'),
  }).strict(),
  riskRules: z.object({
    global: z.object({
      aggregateAssetCapPercent: z.number().positive().max(100),
      industryCapPercent: z.number().positive().max(100),
      driftAction: z.literal('warning_only'),
      existingOverCapAction: z.literal('warn_and_block_new_risk'),
    }).strict(),
    portfolio: z.object({
      stopMode: z.literal('drawdown_and_thesis_review'),
      drawdownReviewPercent: z.number().positive().max(80).nullable(),
      priceStopCreatesOrder: z.literal(false),
    }).strict(),
    dividendLowVol: z.object({
      singleAssetCapPercent: z.number().positive().max(100),
      industryCapPercent: z.number().positive().max(100),
      stopMode: z.literal('fundamental_and_dynamic_zone'),
    }).strict(),
    rotationVolatility: z.object({
      singleAssetCapPercent: z.number().positive().max(100),
      cashFloorPercent: z.number().min(0).max(100),
      stopMode: z.literal('atr_and_trend_invalidation'),
    }).strict(),
  }).strict(),
  tradeBoundary: z.object({
    formalTradingUnlocked: z.literal(false),
    autoTradeUnlocked: z.literal(false),
    canCreateOrder: z.literal(false),
    orderCreateAllowed: z.literal(false),
    prohibitedActions: z.tuple([
      z.literal('ADD'),
      z.literal('REDUCE'),
      z.literal('ORDER_CREATE'),
      z.literal('AUTO_TRADE'),
    ]),
  }).strict(),
}).strict().superRefine((contract, context) => {
  const families = contract.strategyBuckets.map((bucket) => bucket.strategyFamily)
  if (new Set(families).size !== 3) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['strategyBuckets'], message: '三类策略桶必须各出现一次' })
  }
  const targetSum = contract.strategyBuckets.reduce((sum, bucket) => sum + bucket.targetPercent, 0)
  if (Math.abs(targetSum - 100) > 0.0001) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['strategyBuckets'], message: '策略桶目标比例合计必须为100%' })
  }
  for (const [index, bucket] of contract.strategyBuckets.entries()) {
    const { minPercent, maxPercent } = bucket.warningBand
    if (minPercent !== null && maxPercent !== null && (minPercent > bucket.targetPercent || maxPercent < bucket.targetPercent || minPercent > maxPercent)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['strategyBuckets', index, 'warningBand'], message: '警示区间必须包含目标比例' })
    }
  }
  const componentNames = contract.portfolioTemplate.components.map((item) => item.assetClass)
  if (new Set(componentNames).size !== 4) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['portfolioTemplate', 'components'], message: '四资产均衡组合必须包含四种不同资产' })
  }
  const componentSum = contract.portfolioTemplate.components.reduce((sum, item) => sum + item.targetPercent, 0)
  if (Math.abs(componentSum - 100) > 0.0001) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['portfolioTemplate', 'components'], message: '四资产内部权重合计必须为100%' })
  }
})

export const investmentPolicyAssetOverrideSchema = z.object({
  maxAssetWeightPercent: z.number().positive().max(100).nullable().optional(),
  stopMode: z.enum(['inherit', 'fixed_loss_percent', 'model']).default('inherit'),
  stopLossPercent: z.number().positive().max(80).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.stopMode === 'fixed_loss_percent' && !value.stopLossPercent) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['stopLossPercent'], message: '固定止损模式必须填写损失百分比' })
  }
})

export type InvestmentPolicyContract = z.infer<typeof investmentPolicyContractSchema>
export type InvestmentPolicyAssetOverride = z.infer<typeof investmentPolicyAssetOverrideSchema>
export type InvestmentPolicyStrategyFamily = z.infer<typeof investmentPolicyStrategyFamilySchema>

export const DEFAULT_INVESTMENT_POLICY_DRAFT: InvestmentPolicyContract = {
  schemaVersion: 'fams.investment-policy.v1',
  name: '三策略资金政策',
  reserveCash: { floorPercent: null, classification: 'cash_outside_portfolio_strategy' },
  strategyBuckets: [
    { strategyFamily: 'portfolio', targetPercent: 50, warningBand: { minPercent: null, maxPercent: null } },
    { strategyFamily: 'dividend_low_vol', targetPercent: 30, warningBand: { minPercent: null, maxPercent: null } },
    { strategyFamily: 'rotation_volatility', targetPercent: 20, warningBand: { minPercent: null, maxPercent: null } },
  ],
  portfolioTemplate: {
    templateId: 'four_asset_balanced',
    displayName: '四资产均衡组合',
    components: [
      { assetClass: 'equity_index', targetPercent: 25 },
      { assetClass: 'bond_fund', targetPercent: 25 },
      { assetClass: 'gold', targetPercent: 25 },
      { assetClass: 'cash', targetPercent: 25 },
    ],
    activationMode: 'explicit_confirmation',
  },
  riskRules: {
    global: {
      aggregateAssetCapPercent: 20,
      industryCapPercent: 25,
      driftAction: 'warning_only',
      existingOverCapAction: 'warn_and_block_new_risk',
    },
    portfolio: { stopMode: 'drawdown_and_thesis_review', drawdownReviewPercent: null, priceStopCreatesOrder: false },
    dividendLowVol: { singleAssetCapPercent: 5, industryCapPercent: 25, stopMode: 'fundamental_and_dynamic_zone' },
    rotationVolatility: { singleAssetCapPercent: 20, cashFloorPercent: 10, stopMode: 'atr_and_trend_invalidation' },
  },
  tradeBoundary: {
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
  },
}

export function validateInvestmentPolicyForActivation(input: unknown) {
  const parsed = investmentPolicyContractSchema.safeParse(input)
  if (!parsed.success) return parsed
  const issues: z.ZodIssue[] = []
  if (parsed.data.reserveCash.floorPercent === null) {
    issues.push({ code: z.ZodIssueCode.custom, path: ['reserveCash', 'floorPercent'], message: '激活前必须填写备用现金下限' })
  }
  parsed.data.strategyBuckets.forEach((bucket, index) => {
    if (bucket.warningBand.minPercent === null || bucket.warningBand.maxPercent === null) {
      issues.push({ code: z.ZodIssueCode.custom, path: ['strategyBuckets', index, 'warningBand'], message: '激活前必须填写每个策略桶的警示上下限' })
    }
  })
  if (parsed.data.riskRules.portfolio.drawdownReviewPercent === null) {
    issues.push({ code: z.ZodIssueCode.custom, path: ['riskRules', 'portfolio', 'drawdownReviewPercent'], message: '激活前必须填写组合回撤复核线' })
  }
  return issues.length === 0
    ? parsed
    : { success: false as const, error: new z.ZodError(issues) }
}

export function stableInvestmentPolicyJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableInvestmentPolicyJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableInvestmentPolicyJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function hashInvestmentPolicy(value: unknown) {
  return createHash('sha256').update(stableInvestmentPolicyJson(value)).digest('hex')
}
