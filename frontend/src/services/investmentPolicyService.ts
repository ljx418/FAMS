import { API_BASE } from '../config/api'

export type StrategyFamily = 'portfolio' | 'dividend_low_vol' | 'rotation_volatility'

export type InvestmentPolicyContract = {
  schemaVersion: 'fams.investment-policy.v1'
  name: string
  reserveCash: { floorPercent: number | null; classification: 'cash_outside_portfolio_strategy' }
  strategyBuckets: Array<{
    strategyFamily: StrategyFamily
    targetPercent: number
    warningBand: { minPercent: number | null; maxPercent: number | null }
  }>
  portfolioTemplate: {
    templateId: 'four_asset_balanced'
    displayName: '四资产均衡组合'
    components: Array<{ assetClass: 'equity_index' | 'bond_fund' | 'gold' | 'cash'; targetPercent: number }>
    activationMode: 'explicit_confirmation'
  }
  riskRules: {
    global: { aggregateAssetCapPercent: number; industryCapPercent: number; driftAction: 'warning_only'; existingOverCapAction: 'warn_and_block_new_risk' }
    portfolio: { stopMode: 'drawdown_and_thesis_review'; drawdownReviewPercent: number | null; priceStopCreatesOrder: false }
    dividendLowVol: { singleAssetCapPercent: number; industryCapPercent: number; stopMode: 'fundamental_and_dynamic_zone' }
    rotationVolatility: { singleAssetCapPercent: number; cashFloorPercent: number; stopMode: 'atr_and_trend_invalidation' }
  }
  tradeBoundary: {
    formalTradingUnlocked: false
    autoTradeUnlocked: false
    canCreateOrder: false
    orderCreateAllowed: false
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']
  }
}

export type PolicyRecord = {
  id: string
  version: number
  name: string
  status: 'draft' | 'active' | 'superseded'
  contractHash: string
  createdBy: string
  activatedBy: string | null
  activatedAt: string | null
  updatedAt: string
  contract: InvestmentPolicyContract
  overrides?: Array<{ assetId: string; override: Record<string, unknown>; reason: string }>
}

export type PolicyEvaluation = {
  schemaVersion: string
  status: 'incomplete' | 'warning' | 'within_policy'
  totals: { totalValue: number; reserveCashValue: number; reserveCashPercent: number; assignedInvestedValue: number; policyInvestableValue: number | null }
  buckets: Array<{ strategyFamily: StrategyFamily; targetPercent: number; currentPercent: number; currentValue: number; targetValue: number | null; warningBand: { minPercent: number | null; maxPercent: number | null }; status: string; action: 'warning_only' }>
  positions: Array<{ positionId: string; assetId: string; symbol: string; name: string; industry: string; strategyFamily: StrategyFamily | 'unclassified'; reserveCash: boolean; marketValue: number; currentWeightPercent: number; capPercent: number; capStatus: string; newRiskAllowed: boolean; stopPolicy: { mode: string; percent: number | null }; override?: Record<string, unknown> | null }>
  industryExposures: Array<{ scope: 'global' | 'strategy'; strategyFamily: StrategyFamily | null; industry: string; marketValue: number; currentWeightPercent: number; capPercent: number; status: string }>
  warnings: Array<{ code: string; message: string; severity: string }>
  automationBoundary: { driftAction: 'warning_only'; autoRebalance: false; createsOrder: false }
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`)
  return payload as T
}

export const investmentPolicyApi = {
  current: (userId = 'default') => requestJson<{
    activePolicy: PolicyRecord | null
    latestDraft: PolicyRecord | null
    legacyPortfolioPlan: { strategyId?: string; name?: string; status?: string; remainsActiveUntilExplicitPolicyActivation: boolean } | null
  }>(`/api/v1/investment-policy/current?userId=${encodeURIComponent(userId)}`),
  createDraft: (userId = 'default') => requestJson<PolicyRecord>('/api/v1/investment-policy/drafts', {
    method: 'POST', body: JSON.stringify({ userId, createdBy: 'fams_policy_page_user' }),
  }),
  updateDraft: (policyId: string, contract: InvestmentPolicyContract, userId = 'default') => requestJson<PolicyRecord>(`/api/v1/investment-policy/drafts/${encodeURIComponent(policyId)}`, {
    method: 'PUT', body: JSON.stringify({ userId, contract }),
  }),
  activate: (policyId: string, userId = 'default') => requestJson<{ status: string; policy: PolicyRecord; evaluation: PolicyEvaluation }>(`/api/v1/investment-policy/${encodeURIComponent(policyId)}/activate`, {
    method: 'POST', body: JSON.stringify({ userId, confirmed: true, confirmedBy: 'fams_policy_page_user' }),
  }),
  evaluation: (policyId?: string, userId = 'default') => requestJson<PolicyEvaluation | null>(`/api/v1/investment-policy/evaluation?userId=${encodeURIComponent(userId)}${policyId ? `&policyId=${encodeURIComponent(policyId)}` : ''}`),
  saveOverride: (policyId: string, positionId: string, input: { maxAssetWeightPercent: number | null; stopMode: string; stopLossPercent: number | null; reason: string }, userId = 'default') => requestJson(`/api/v1/investment-policy/${encodeURIComponent(policyId)}/overrides/${encodeURIComponent(positionId)}`, {
    method: 'PUT',
    body: JSON.stringify({
      userId,
      createdBy: 'fams_policy_page_user',
      reason: input.reason,
      override: { maxAssetWeightPercent: input.maxAssetWeightPercent, stopMode: input.stopMode, stopLossPercent: input.stopLossPercent },
    }),
  }),
}
