import { z } from 'zod'

const evidenceRefSchema = z.union([
  z.string().min(1),
  z.object({ path: z.string().min(1).optional(), uri: z.string().min(1).optional(), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).passthrough(),
])

export const investmentStrategyResultSchema = z.object({
  schemaVersion: z.literal('fams.investment-strategy-result.v1'),
  strategyFamily: z.enum(['rotation_volatility', 'dividend_low_vol', 'portfolio']),
  strategyVersion: z.string().min(1),
  inputSnapshotId: z.string().min(1),
  snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
  asOf: z.string().datetime(),
  dataHealth: z.object({
    status: z.enum(['fresh', 'delayed', 'stale', 'unknown', 'insufficient']),
    providers: z.array(z.string().min(1)),
    blockers: z.array(z.string().min(1)),
    warnings: z.array(z.string().min(1)),
  }).strict(),
  conclusion: z.object({
    status: z.enum(['ready', 'observe', 'blocked', 'insufficient']),
    title: z.string().min(1),
    summary: z.string().min(1),
  }).strict(),
  signalLayers: z.array(z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    status: z.enum(['passed', 'failed', 'blocked', 'insufficient', 'not_applicable']),
    value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    threshold: z.union([z.string(), z.number(), z.boolean(), z.null()]),
    reason: z.string().min(1),
    evidenceRefs: z.array(evidenceRefSchema),
  }).strict()),
  previousPlanComparison: z.object({
    previousPlanId: z.string().min(1),
    disposition: z.enum(['reuse', 'revise', 'invalidate']),
    reasons: z.array(z.string().min(1)),
  }).strict().nullable(),
  manualOrderDrafts: z.array(z.object({
    side: z.enum(['BUY', 'SELL']),
    price: z.number().positive(),
    quantity: z.number().positive(),
    validUntil: z.string().datetime(),
    rationale: z.string().min(1),
    invalidationConditions: z.array(z.string().min(1)).min(1),
    createsOrder: z.literal(false),
  }).strict()),
  invalidationConditions: z.array(z.string().min(1)),
  evidenceRefs: z.array(evidenceRefSchema),
  blockedReasons: z.array(z.string().min(1)),
  permissionState: z.object({
    researchAllowed: z.boolean(),
    manualDraftAllowed: z.boolean(),
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
}).strict().superRefine((value, context) => {
  if (value.manualOrderDrafts.length > 0 && value.permissionState.manualDraftAllowed !== true) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['manualOrderDrafts'], message: 'manual drafts require manualDraftAllowed=true' })
  }
  if (['blocked', 'insufficient'].includes(value.conclusion.status) && value.blockedReasons.length === 0) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['blockedReasons'], message: 'blocked results require at least one reason' })
  }
})

export type InvestmentStrategyResult = z.infer<typeof investmentStrategyResultSchema>
