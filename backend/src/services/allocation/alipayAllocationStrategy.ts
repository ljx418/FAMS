export const ALIPAY_ALLOCATION_STRATEGY = {
  id: 'approved_allocation_v3_high_defense_10_15_50_25_2026',
  name: '支付宝2026年高防御10/15/50/25',
  label: '现金10%/黄金15%/债券50%/权益25%',
  effectiveFrom: '2026-09-01',
  effectiveUntil: '2026-12-31',
  weights: {
    cash: 10,
    gold: 15,
    bond: 50,
    equity: 25,
  },
} as const

export const ALIPAY_PERMANENT_PORTFOLIO_STRATEGY = {
  id: 'approved_allocation_v4_permanent_25_25_25_25',
  name: '支付宝永久组合25/25/25/25',
  label: '现金25%/黄金25%/长期债券25%/股票25%',
  effectiveFrom: '2027-01-01',
  effectiveUntil: null,
  weights: {
    cash: 25,
    gold: 25,
    bond: 25,
    equity: 25,
  },
} as const

export const ALIPAY_STRATEGY_TRANSITION_SCHEMA_VERSION = 'fams.alipay-strategy-transition.v1'

export type AlipayStrategyTransitionConfirmation = {
  schemaVersion: typeof ALIPAY_STRATEGY_TRANSITION_SCHEMA_VERSION
  confirmed: true
  confirmedAt: string
  confirmedBy: string
  fromStrategyId: typeof ALIPAY_ALLOCATION_STRATEGY.id
  toStrategyId: typeof ALIPAY_PERMANENT_PORTFOLIO_STRATEGY.id
}

export type AlipayAllocationStrategyStatus =
  | 'not_yet_effective'
  | 'active'
  | 'expired'
  | 'transition_confirmation_required'
  | 'permanent_active'

const shanghaiDate = (date: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function getAlipayAllocationStrategyStatus(asOf = new Date()): AlipayAllocationStrategyStatus {
  const date = shanghaiDate(asOf)
  if (date < ALIPAY_ALLOCATION_STRATEGY.effectiveFrom) return 'not_yet_effective'
  if (date > ALIPAY_ALLOCATION_STRATEGY.effectiveUntil) return 'expired'
  return 'active'
}

export function isValidAlipayStrategyTransitionConfirmation(
  value: unknown,
): value is AlipayStrategyTransitionConfirmation {
  if (!value || typeof value !== 'object') return false
  const confirmation = value as Record<string, unknown>
  return confirmation.schemaVersion === ALIPAY_STRATEGY_TRANSITION_SCHEMA_VERSION
    && confirmation.confirmed === true
    && typeof confirmation.confirmedAt === 'string'
    && !Number.isNaN(Date.parse(confirmation.confirmedAt))
    && typeof confirmation.confirmedBy === 'string'
    && confirmation.confirmedBy.trim().length > 0
    && confirmation.fromStrategyId === ALIPAY_ALLOCATION_STRATEGY.id
    && confirmation.toStrategyId === ALIPAY_PERMANENT_PORTFOLIO_STRATEGY.id
}

export function resolveAlipayAllocationStrategy(
  settings: Record<string, unknown> = {},
  asOf = new Date(),
) {
  const highDefenseStatus = getAlipayAllocationStrategyStatus(asOf)
  const rawConfirmation = settings.alipayAllocationStrategyTransition
  const confirmation = isValidAlipayStrategyTransitionConfirmation(rawConfirmation)
    ? rawConfirmation
    : null

  if (highDefenseStatus === 'expired' && confirmation) {
    return {
      strategy: ALIPAY_PERMANENT_PORTFOLIO_STRATEGY,
      status: 'permanent_active' as const,
      confirmationRequired: false,
      manualDraftAllowed: true,
      confirmation,
      nextStrategy: null,
    }
  }

  if (highDefenseStatus === 'expired') {
    return {
      strategy: ALIPAY_ALLOCATION_STRATEGY,
      status: 'transition_confirmation_required' as const,
      confirmationRequired: true,
      manualDraftAllowed: false,
      confirmation: null,
      nextStrategy: ALIPAY_PERMANENT_PORTFOLIO_STRATEGY,
    }
  }

  return {
    strategy: ALIPAY_ALLOCATION_STRATEGY,
    status: highDefenseStatus,
    confirmationRequired: false,
    manualDraftAllowed: highDefenseStatus === 'active',
    confirmation: null,
    nextStrategy: highDefenseStatus === 'active' ? ALIPAY_PERMANENT_PORTFOLIO_STRATEGY : null,
  }
}
