import type { DividendLowVolFactSet } from './dividendLowVolTypes.js'

export type DividendLowVolRejectionType =
  | 'data_gap'
  | 'hard_rule_failure'
  | 'risk_flag'
  | 'validation_blocker'

export type DividendLowVolReasonCategory =
  | 'data'
  | 'dividend'
  | 'leader'
  | 'liquidity'
  | 'quality'
  | 'low_volatility'
  | 'risk'
  | 'identity'
  | 'validation'

export interface DividendLowVolRejectionReasonMeta {
  label: string
  category: DividendLowVolReasonCategory
  defaultType: DividendLowVolRejectionType
}

export const DIVIDEND_LOW_VOL_REASON_META: Record<string, DividendLowVolRejectionReasonMeta> = {
  asset_identity_missing: { label: '资产身份无法确认', category: 'identity', defaultType: 'data_gap' },
  unsupported_asset_type: { label: '不是普通股票', category: 'identity', defaultType: 'hard_rule_failure' },
  security_status_st_or_risk: { label: 'ST 或退市风险', category: 'identity', defaultType: 'hard_rule_failure' },
  security_suspended: { label: '停牌状态', category: 'identity', defaultType: 'hard_rule_failure' },
  security_delisted: { label: '已退市或退市整理', category: 'identity', defaultType: 'hard_rule_failure' },
  listing_age_less_than_3y: { label: '上市不满 3 年', category: 'identity', defaultType: 'hard_rule_failure' },
  dividend_history_insufficient: { label: '最近三年连续现金分红不足', category: 'data', defaultType: 'data_gap' },
  dividend_yield_missing_or_zero: { label: '股息率缺失或为 0', category: 'data', defaultType: 'data_gap' },
  no_cash_dividend_confirmed: { label: '免费公开源未发现近三年现金分红', category: 'dividend', defaultType: 'hard_rule_failure' },
  dividend_yield_below_4_percent: { label: 'TTM 股息率低于 4%', category: 'dividend', defaultType: 'hard_rule_failure' },
  avg_dividend_yield_3y_below_3_5_percent: { label: '三年平均股息率低于 3.5%', category: 'dividend', defaultType: 'hard_rule_failure' },
  industry_leader_score_below_75: { label: '行业龙头分低于 75', category: 'leader', defaultType: 'hard_rule_failure' },
  avg_turnover_60d_below_50m: { label: '60 日日均成交额低于 5000 万', category: 'liquidity', defaultType: 'hard_rule_failure' },
  market_cap_below_10b: { label: '总市值低于 100 亿', category: 'liquidity', defaultType: 'hard_rule_failure' },
  payout_ratio_negative: { label: '分红支付率为负', category: 'quality', defaultType: 'hard_rule_failure' },
  payout_ratio_extreme_high: { label: '分红支付率超过 100%', category: 'quality', defaultType: 'hard_rule_failure' },
  payout_ratio_below_20: { label: '分红支付率低于 20%', category: 'quality', defaultType: 'hard_rule_failure' },
  payout_ratio_above_policy_band: { label: '分红支付率高于策略安全区间', category: 'quality', defaultType: 'hard_rule_failure' },
  dps_growth_negative: { label: '每股分红三年增长为负', category: 'quality', defaultType: 'risk_flag' },
  dividend_cut_over_20_percent: { label: '分红削减超过 20%', category: 'quality', defaultType: 'risk_flag' },
  dps_consecutive_decline: { label: 'DPS 连续下降', category: 'quality', defaultType: 'risk_flag' },
  special_dividend_suspected: { label: '疑似一次性特殊分红', category: 'quality', defaultType: 'risk_flag' },
  dividend_trap_risk: { label: '高息陷阱风险', category: 'quality', defaultType: 'risk_flag' },
  cashflow_dividend_coverage_weak: { label: '经营现金流覆盖不足', category: 'quality', defaultType: 'risk_flag' },
  max_drawdown_250d_above_35: { label: '250 日最大回撤超过 35%', category: 'low_volatility', defaultType: 'hard_rule_failure' },
  max_drawdown_60d_above_18: { label: '60 日最大回撤超过 18%', category: 'low_volatility', defaultType: 'hard_rule_failure' },
  low_vol_score_below_60: { label: '低波动分低于 60', category: 'low_volatility', defaultType: 'hard_rule_failure' },
  dividend_low_vol_evidence_insufficient: { label: '策略证据质量不足', category: 'data', defaultType: 'data_gap' },
  validation_evidence: { label: 'validation evidence 未通过', category: 'validation', defaultType: 'validation_blocker' },
  dividend_low_vol_validation_insufficient: { label: '红利低波验证证据不足', category: 'validation', defaultType: 'validation_blocker' },
}

function hasCompleteLeaderEvidence(candidate?: DividendLowVolFactSet) {
  if (!candidate) return false
  const refs = candidate.evidenceRefs || []
  const hasIndustry = Boolean(candidate.identity.industry) || refs.some((ref) => ref.includes('industry'))
  const hasMarketCapRank = refs.some((ref) => ref.includes('market_cap_rank') || ref.includes('marketCapRank'))
  const hasRevenueRank = refs.some((ref) => ref.includes('revenue_rank') || ref.includes('revenueRank'))
  const hasNetProfitRank = refs.some((ref) => ref.includes('net_profit_rank') || ref.includes('netProfitRank'))
  const hasRoeRank = refs.some((ref) => ref.includes('roe_percentile') || ref.includes('roeIndustryPercentile'))
  const hasCrossCheck = refs.some((ref) => ref.includes('provider_cross_checked_industry_rank'))
  return hasIndustry && hasMarketCapRank && (hasRevenueRank || hasNetProfitRank) && hasRoeRank && hasCrossCheck
}

export function classifyDividendLowVolRejectionReason(reason: string, candidate?: DividendLowVolFactSet): {
  reason: string
  label: string
  category: DividendLowVolReasonCategory
  type: DividendLowVolRejectionType
} {
  const meta = DIVIDEND_LOW_VOL_REASON_META[reason] || { label: reason, category: 'risk' as const, defaultType: 'risk_flag' as const }
  if (reason === 'industry_leader_score_below_75' && !hasCompleteLeaderEvidence(candidate)) {
    return { reason, label: meta.label, category: meta.category, type: 'data_gap' }
  }
  return { reason, label: meta.label, category: meta.category, type: meta.defaultType }
}

export function buildDividendLowVolRejectionAudit(candidates: DividendLowVolFactSet[]) {
  const rejected = candidates.filter((candidate) => candidate.candidateGrade === 'EXCLUDED' || ['avoid', 'data_insufficient'].includes(candidate.disposition))
  const counts = new Map<string, {
    reason: string
    label: string
    category: DividendLowVolReasonCategory
    type: DividendLowVolRejectionType
    count: number
    examples: string[]
  }>()
  const byType: Record<DividendLowVolRejectionType, Array<{
    reason: string
    label: string
    category: DividendLowVolReasonCategory
    count: number
    examples: string[]
  }>> = {
    data_gap: [],
    hard_rule_failure: [],
    risk_flag: [],
    validation_blocker: [],
  }

  for (const candidate of rejected) {
    const reasons = candidate.blockedReasons.length > 0 ? candidate.blockedReasons : ['unknown_rejection']
    for (const reason of reasons) {
      const classified = classifyDividendLowVolRejectionReason(reason, candidate)
      const existing = counts.get(reason) || {
        ...classified,
        count: 0,
        examples: [],
      }
      existing.count += 1
      if (existing.examples.length < 5) existing.examples.push(`${candidate.identity.symbol}:${candidate.disposition}`)
      counts.set(reason, existing)
    }
  }

  const topReasons = Array.from(counts.values()).sort((left, right) => right.count - left.count)
  for (const item of topReasons) {
    byType[item.type].push({
      reason: item.reason,
      label: item.label,
      category: item.category,
      count: item.count,
      examples: item.examples,
    })
  }

  return {
    schemaVersion: 'dividend.low_vol.rejection_audit.v1',
    generatedAt: new Date().toISOString(),
    rejectedCount: rejected.length,
    byType,
    topReasons,
    examples: rejected.slice(0, 10).map((candidate) => ({
      symbol: candidate.identity.symbol,
      name: candidate.identity.name,
      disposition: candidate.disposition,
      candidateGrade: candidate.candidateGrade,
      reasons: candidate.blockedReasons.map((reason) => classifyDividendLowVolRejectionReason(reason, candidate)),
    })),
    userMessage: '剔除原因已分为缺数据、硬规则失败、风险标记和验证阻断；风险标记不会再被展示成数据缺口。',
    developerMessage: 'Use byType.data_gap for data remediation queues; do not remediate risk_flag/hard_rule_failure as provider data gaps unless a classifier explicitly marks evidence incomplete.',
    suggestedFix: 'Prioritize data_gap items for provider ingestion; keep hard_rule_failure and risk_flag as strategy decisions unless new evidence changes the underlying fact.',
  }
}
