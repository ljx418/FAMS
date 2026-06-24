import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Collapse, Empty, InputNumber, Select, Slider, Spin, Table, Tag, Tooltip, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { FilterOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  checkDividendLowVolAlerts,
  createDividendLowVolManualPretradeCheck,
  createDividendLowVolManualTradeDraft,
  createDividendLowVolAuditPackage,
  decideDividendLowVolManualAcceptance,
  getDividendLowVolCandidateHistory,
  getDividendLowVolCandidates,
  getDividendLowVolDataReadiness,
  getDividendLowVolManualDraftReadiness,
  getDividendLowVolManualAcceptanceReview,
  getDividendLowVolManualAcceptanceDecision,
  getDividendLowVolManualTradeDraft,
  getDividendLowVolTradingZones,
  getDividendLowVolManualWatchlist,
  getDividendLowVolManualWorkflowAudit,
  getDividendLowVolValidationGapDiagnostics,
  getDividendLowVolV2ResearchValidation,
  getDividendLowVolPersistedAlerts,
  reviewDividendLowVolManualTradeDraft,
  reviewDividendLowVolManualPretradeCheck,
  runDividendLowVolBacktest,
  runDividendLowVolRollingBacktest,
  runDividendLowVolValidationRetest,
  startDividendLowVolDailyScanOperation,
  type DividendLowVolAuditPackageRef,
  type DividendLowVolAlertCheckResult,
  type DividendLowVolBacktestResult,
  type DividendLowVolCandidateHistory,
  type DividendLowVolCandidatePool,
  type DividendLowVolDataReadinessAudit,
  type DividendLowVolRollingBacktestResult,
  type DividendLowVolTradingZoneResult,
  type DividendLowVolManualDraftReadinessResult,
  type DividendLowVolManualAcceptanceReviewResult,
  type DividendLowVolManualAcceptanceDecisionResult,
  type DividendLowVolManualTradeDraftReviewResult,
  type DividendLowVolManualTradeDraftResult,
  type DividendLowVolManualWatchlistResult,
  type DividendLowVolManualPretradeCheckResult,
  type DividendLowVolManualPretradeReviewResult,
  type DividendLowVolManualWorkflowAuditResult,
  type DividendLowVolPersistedAlerts,
  type DividendLowVolV2ResearchValidationResult,
  type DividendLowVolValidationRetestResult,
  type DividendLowVolValidationGapDiagnosticsResult,
} from '../services/analysisService'

const SYMBOLS = ['600000', '000001', '601398', '600519']
const DEFAULT_ALL_A_LIMIT = 6000

type Candidate = DividendLowVolCandidatePool['candidates'][number]
type SortKey =
  | 'evidenceAdjustedScore'
  | 'totalResearchScore'
  | 'leaderScore'
  | 'dividendScore'
  | 'dividendQualityScore'
  | 'lowVolScore'
  | 'valuationScore'
  | 'lowZoneScore'
  | 'highZoneScore'
  | 'ttmDividendYield'
  | 'financialRiskScore'

const gradeColor: Record<string, string> = {
  A: '#34d399',
  B: '#38bdf8',
  WATCH: '#fbbf24',
  EXCLUDED: '#94a3b8',
}

const dispositionLabel: Record<string, string> = {
  watch_candidate: '观察候选',
  low_zone_alert: '低位提醒',
  build_position_plan: '建仓草案',
  add_on_pullback: '加仓观察',
  hold_for_dividend: '持有收息',
  trim_high_zone: '高位减仓',
  exit_dividend_risk: '退出风险',
  avoid: '剔除回避',
  data_insufficient: '数据不足',
}

const leaderStatusLabel: Record<string, string> = {
  verified_industry_leader: '免费源研究验证',
  leader_candidate: '龙头候选',
  leader_partial: '部分证据',
  not_leader: '非龙头',
  insufficient: '证据不足',
}

const leaderEvidenceLabel: Record<string, string> = {
  marketCapRankVerified: '市值排名',
  revenueRankVerified: '营收排名',
  netProfitRankVerified: '净利润排名',
  roePercentileVerified: 'ROE 分位',
  providerCrossCheckedIndustryRank: '行业交叉验证',
  seedFallbackUsed: 'Seed fallback',
}

const categoryLabel: Record<string, string> = {
  data: '数据缺口',
  dividend: '红利门槛',
  leader: '行业龙头',
  liquidity: '流动性/市值',
  quality: '分红质量',
  low_volatility: '低波动',
  risk: '风险',
  identity: '资产身份',
}

const blockedReasonLabel: Record<string, string> = {
  asset_identity_missing: '资产身份缺失',
  unsupported_asset_type: '非普通股票',
  security_status_st_or_risk: 'ST/风险警示',
  security_suspended: '停牌',
  security_delisted: '退市风险',
  listing_age_less_than_3y: '上市不满 3 年',
  dividend_history_insufficient: '连续现金分红不足',
  dividend_yield_missing_or_zero: '股息率缺失',
  no_cash_dividend_confirmed: '无近三年现金分红',
  dividend_yield_below_4_percent: '股息率低于 4%',
  avg_dividend_yield_3y_below_3_5_percent: '三年均息低于 3.5%',
  industry_leader_score_below_75: '龙头分低于 75',
  avg_turnover_60d_below_50m: '成交额不足',
  market_cap_below_10b: '市值不足 100 亿',
  payout_ratio_negative: '支付率为负',
  payout_ratio_extreme_high: '支付率超 100%',
  payout_ratio_below_20: '支付率低于 20%',
  payout_ratio_above_policy_band: '支付率偏高',
  dps_growth_negative: 'DPS 增长为负',
  dividend_cut_over_20_percent: '分红削减',
  dps_consecutive_decline: 'DPS 连降',
  special_dividend_suspected: '疑似特殊分红',
  dividend_trap_risk: '高息陷阱风险',
  cashflow_dividend_coverage_weak: '现金流覆盖弱',
  max_drawdown_250d_above_35: '250 日回撤超 35%',
  max_drawdown_60d_above_18: '60 日回撤超 18%',
  low_vol_score_below_60: '低波分低于 60',
  dividend_low_vol_evidence_insufficient: '证据质量不足',
  validation_evidence: '验证未通过',
  dividend_low_vol_validation_insufficient: '策略验证不足',
}

const metricExplanations = [
  { name: '综合分', text: '用于候选池排序，综合行业龙头、红利、质量、低波、估值、时机、证据质量，并受 evidence gate 降权。' },
  { name: '龙头分', text: '衡量行业内市值、营收、净利润、ROE、流动性排名。低于 75 不进入红利低波行业龙头候选。' },
  { name: '红利分', text: '衡量 TTM 股息率、三年平均股息率、连续分红年数、DPS 增长和分红稳定性。股息率低于 4% 会被剔除。' },
  { name: '质量分', text: '衡量支付率安全、现金流覆盖、盈利稳定、负债安全和 ROE，主要用于防高股息陷阱。' },
  { name: '低波分', text: '衡量 120/250 日波动率、最大回撤、Beta/ATR 等。低于 60 不满足低波策略门槛。' },
  { name: '估值分', text: '衡量股息率历史分位、PB/PE 便宜程度和行业红利吸引力。' },
  { name: '低位分', text: '判断是否进入低位观察或建仓草案，关注股息率历史高分位、估值、回撤和企稳。' },
  { name: '高位分', text: '判断是否进入高位观察、减仓或退出提醒，关注股息率被压低、估值升高、RSI 过热和远离均线。' },
  { name: '风险分', text: '越高代表财务或波动风险越高。候选策略会降低风险高的标的优先级。' },
  { name: '证据状态', text: '显示该结论是否来自行情、canonical、分红、财务、行业龙头等多源交叉验证。insufficient 表示不能当成完整事实。' },
]

const formatScore = (value?: number) => Number.isFinite(value) ? Number(value).toFixed(1) : '--'
const priceAuditColor = (status?: string) => {
  if (status === 'aligned') return '#34d399'
  if (status === 'price_zone_mismatch') return '#ef4444'
  return '#fbbf24'
}
const freshnessColor = (status?: string) => status === 'fresh' ? '#34d399' : status === 'stale' ? '#ef4444' : '#fbbf24'
const formatZone = (low?: number | null, high?: number | null) => (
  low !== null && low !== undefined && high !== null && high !== undefined ? `${low.toFixed(2)} - ${high.toFixed(2)}` : '--'
)
const hasNumber = (value?: number) => Number.isFinite(value)
const formatRequiredScore = (value?: number) => Number(value).toFixed(1)
const metricLabel: Record<string, string> = {
  'identity.symbol': '证券代码',
  'identity.name': '证券名称',
  'identity.industry': '行业',
  'timing.price': '价格',
  'dividend.ttmDividendYield': 'TTM 股息率',
  'dividend.avgDividendYield3y': '3 年平均股息率',
  'dividend.dividendYieldPercentile3y': '股息率历史分位',
  'dividend.consecutiveDividendYears': '连续分红年数',
  'dividend.payoutRatio': '支付率',
  'scores.evidenceAdjustedScore': '综合分',
  'scores.totalResearchScore': '研究原始分',
  'scores.leaderScore': '龙头分',
  'scores.dividendScore': '红利分',
  'scores.dividendQualityScore': '质量分',
  'scores.lowVolScore': '低波分',
  'scores.valuationScore': '估值分',
  'scores.financialRiskScore': '风险分',
  'timing.lowZoneScore': '低位分',
  'timing.highZoneScore': '高位分',
  'timing.rsi14': 'RSI14',
  'lowVolatility.volatility120d': '120 日波动率',
  'lowVolatility.maxDrawdown60d': '60 日最大回撤',
  'quality.roe': 'ROE',
  'quality.operatingCashFlowToNetProfit': '经营现金流/净利润',
  'valuation.pe': 'PE',
  'valuation.pb': 'PB',
  'strategy.dataGapSummary': '数据缺口/事实不足',
}
const scoreValue = (candidate: Candidate, key: SortKey) => {
  switch (key) {
    case 'evidenceAdjustedScore': return candidate.scores.evidenceAdjustedScore
    case 'totalResearchScore': return candidate.scores.totalResearchScore || candidate.scores.evidenceAdjustedScore
    case 'leaderScore': return candidate.scores.leaderScore || 0
    case 'dividendScore': return candidate.scores.dividendScore
    case 'dividendQualityScore': return candidate.scores.dividendQualityScore
    case 'lowVolScore': return candidate.scores.lowVolScore
    case 'valuationScore': return candidate.scores.valuationScore
    case 'lowZoneScore': return candidate.timing.lowZoneScore
    case 'highZoneScore': return candidate.timing.highZoneScore
    case 'ttmDividendYield': return candidate.dividend.ttmDividendYield || 0
    case 'financialRiskScore': return candidate.scores.financialRiskScore || 0
    default: return 0
  }
}

const scoreCell = (label: string, value?: number) => (
  <div className="leading-tight">
    <div className="text-[11px] text-gray-500">{label}</div>
    <div className="text-xs text-white">{formatRequiredScore(value)}</div>
  </div>
)

const isCompleteDisplayCandidate = (candidate: Candidate) => {
  if (candidate.metricCompleteness) return candidate.metricCompleteness.displayReady === true
  const financialIndustry = /银行|保险|货币金融|证券/.test(candidate.identity.industry || '')
  const requiredNumbers = [
    candidate.timing.price,
    candidate.dividend.ttmDividendYield,
    candidate.dividend.avgDividendYield3y,
    candidate.dividend.dividendYieldPercentile3y,
    candidate.dividend.payoutRatio,
    candidate.scores.evidenceAdjustedScore,
    candidate.scores.totalResearchScore,
    candidate.scores.leaderScore,
    candidate.scores.dividendScore,
    candidate.scores.dividendQualityScore,
    candidate.scores.lowVolScore,
    candidate.scores.valuationScore,
    candidate.scores.financialRiskScore,
    candidate.timing.lowZoneScore,
    candidate.timing.highZoneScore,
    candidate.timing.rsi14,
    candidate.lowVolatility?.volatility120d,
    candidate.lowVolatility?.maxDrawdown60d,
    candidate.quality?.roe,
    ...(!financialIndustry ? [candidate.quality?.operatingCashFlowToNetProfit] : []),
    candidate.valuation?.pe,
    candidate.valuation?.pb,
  ]
  return Boolean(candidate.identity.symbol && candidate.identity.name && candidate.identity.industry)
    && requiredNumbers.every(hasNumber)
    && candidate.dataGapSummary.length === 0
    && !candidate.alerts.some((alert) => alert.type === 'DIVIDEND_DATA_GAP')
}

const metricBadge = (metric: string) => metricLabel[metric] || metric
const reasonBadge = (reason: string) => blockedReasonLabel[reason] || reason

const DividendLowVol: React.FC = () => {
  const [pool, setPool] = useState<DividendLowVolCandidatePool | null>(null)
  const [alerts, setAlerts] = useState<DividendLowVolAlertCheckResult | null>(null)
  const [persistedAlerts, setPersistedAlerts] = useState<DividendLowVolPersistedAlerts | null>(null)
  const [backtest, setBacktest] = useState<DividendLowVolBacktestResult | null>(null)
  const [tradingZones, setTradingZones] = useState<DividendLowVolTradingZoneResult | null>(null)
  const [rollingBacktest, setRollingBacktest] = useState<DividendLowVolRollingBacktestResult | null>(null)
  const [validationRetest, setValidationRetest] = useState<DividendLowVolValidationRetestResult | null>(null)
  const [validationGapDiagnostics, setValidationGapDiagnostics] = useState<DividendLowVolValidationGapDiagnosticsResult | null>(null)
  const [auditPackage, setAuditPackage] = useState<DividendLowVolAuditPackageRef | null>(null)
  const [dataReadiness, setDataReadiness] = useState<DividendLowVolDataReadinessAudit | null>(null)
  const [manualDraftReadiness, setManualDraftReadiness] = useState<DividendLowVolManualDraftReadinessResult | null>(null)
  const [manualTradeDraft, setManualTradeDraft] = useState<DividendLowVolManualTradeDraftResult | null>(null)
  const [manualDraftReview, setManualDraftReview] = useState<DividendLowVolManualTradeDraftReviewResult | null>(null)
  const [manualWatchlist, setManualWatchlist] = useState<DividendLowVolManualWatchlistResult | null>(null)
  const [manualPretradeCheck, setManualPretradeCheck] = useState<DividendLowVolManualPretradeCheckResult | null>(null)
  const [manualPretradeReview, setManualPretradeReview] = useState<DividendLowVolManualPretradeReviewResult | null>(null)
  const [manualWorkflowAudit, setManualWorkflowAudit] = useState<DividendLowVolManualWorkflowAuditResult | null>(null)
  const [manualAcceptanceReview, setManualAcceptanceReview] = useState<DividendLowVolManualAcceptanceReviewResult | null>(null)
  const [manualAcceptanceDecision, setManualAcceptanceDecision] = useState<DividendLowVolManualAcceptanceDecisionResult | null>(null)
  const [v2ResearchValidation, setV2ResearchValidation] = useState<DividendLowVolV2ResearchValidationResult | null>(null)
  const [historyBySymbol, setHistoryBySymbol] = useState<Record<string, DividendLowVolCandidateHistory>>({})
  const [loading, setLoading] = useState(false)
  const [scanLoading, setScanLoading] = useState(false)
  const [alertLoading, setAlertLoading] = useState(false)
  const [backtestLoading, setBacktestLoading] = useState(false)
  const [tradingZoneLoading, setTradingZoneLoading] = useState(false)
  const [rollingBacktestLoading, setRollingBacktestLoading] = useState(false)
  const [validationLoading, setValidationLoading] = useState(false)
  const [gapDiagnosticsLoading, setGapDiagnosticsLoading] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [manualDraftLoading, setManualDraftLoading] = useState(false)
  const [manualDraftReviewLoading, setManualDraftReviewLoading] = useState(false)
  const [manualPretradeCheckLoading, setManualPretradeCheckLoading] = useState(false)
  const [manualPretradeReviewLoading, setManualPretradeReviewLoading] = useState(false)
  const [manualAcceptanceDecisionLoading, setManualAcceptanceDecisionLoading] = useState(false)
  const [scanLimit, setScanLimit] = useState(DEFAULT_ALL_A_LIMIT)
  const [industryFilter, setIndustryFilter] = useState<string>('all')
  const [gradeFilter, setGradeFilter] = useState<string>('all')
  const [dispositionFilter, setDispositionFilter] = useState<string>('all')
  const [alertFilter, setAlertFilter] = useState<string>('all')
  const [minCompositeScore, setMinCompositeScore] = useState(0)
  const [minLeaderScore, setMinLeaderScore] = useState(0)
  const [minDividendScore, setMinDividendScore] = useState(0)
  const [minQualityScore, setMinQualityScore] = useState(0)
  const [minLowVolScore, setMinLowVolScore] = useState(0)
  const [sortKey, setSortKey] = useState<SortKey>('evidenceAdjustedScore')
  const [sortDirection, setSortDirection] = useState<'desc' | 'asc'>('desc')

  const loadCandidates = async () => {
    setLoading(true)
    try {
      const [readiness, manualDraft, tradeDraft, watchlist, workflowAudit, acceptanceReview, acceptanceDecision, candidates, v2Validation] = await Promise.all([
        getDividendLowVolDataReadiness(),
        getDividendLowVolManualDraftReadiness(),
        getDividendLowVolManualTradeDraft(3),
        getDividendLowVolManualWatchlist(),
        getDividendLowVolManualWorkflowAudit(),
        getDividendLowVolManualAcceptanceReview(),
        getDividendLowVolManualAcceptanceDecision(),
        getDividendLowVolCandidates('', scanLimit, { scope: 'all', persistedOnly: true }),
        getDividendLowVolV2ResearchValidation(),
      ])
      setDataReadiness(readiness)
      setManualDraftReadiness(manualDraft)
      setManualTradeDraft(tradeDraft)
      setManualWatchlist(watchlist)
      setManualWorkflowAudit(workflowAudit)
      setManualAcceptanceReview(acceptanceReview)
      if (acceptanceDecision.status !== 'missing') setManualAcceptanceDecision(acceptanceDecision)
      setPool(candidates)
      setV2ResearchValidation(v2Validation)
    } catch (error) {
      console.error(error)
      message.error('红利低波候选池加载失败')
    } finally {
      setLoading(false)
    }
  }

  const runScan = async () => {
    setScanLoading(true)
    try {
      const operation = await startDividendLowVolDailyScanOperation({ universe: 'all_a', limit: scanLimit, executionMode: 'queued' })
      message.success(`全 A 红利低波扫描已提交任务中心：${(operation.operationId || operation.id || '').slice(0, 8)}`)
    } catch (error) {
      console.error(error)
      message.error('扫描启动失败')
    } finally {
      setScanLoading(false)
    }
  }

  const runAlertCheck = async () => {
    setAlertLoading(true)
    try {
      const result = await checkDividendLowVolAlerts(SYMBOLS, { scope: 'all', limit: scanLimit })
      setAlerts(result)
      message.success(`提醒检查完成：${result.totalAlerts} 条`)
    } catch (error) {
      console.error(error)
      message.error('提醒检查失败')
    } finally {
      setAlertLoading(false)
    }
  }

  const loadPersistedAlerts = async () => {
    try {
      const result = await getDividendLowVolPersistedAlerts(300)
      setPersistedAlerts(result)
      message.success(`已加载持久化提醒：${result.totalAlerts} 条`)
    } catch (error) {
      console.error(error)
      message.error('持久化提醒加载失败')
    }
  }

  const runBacktestCheck = async () => {
    setBacktestLoading(true)
    try {
      const result = await runDividendLowVolBacktest(SYMBOLS, { scope: 'all', limit: scanLimit })
      setBacktest(result)
      message.success(`回测完成：${result.status}`)
    } catch (error) {
      console.error(error)
      message.error('回测失败')
    } finally {
      setBacktestLoading(false)
    }
  }

  const loadTradingZones = async () => {
    setTradingZoneLoading(true)
    try {
      const result = await getDividendLowVolTradingZones(SYMBOLS, { limit: Math.min(scanLimit, 300), persistedOnly: true })
      setTradingZones(result)
      message.success(`买卖区间已生成：${result.zones.length} 个标的`)
    } catch (error) {
      console.error(error)
      message.error('买卖区间生成失败')
    } finally {
      setTradingZoneLoading(false)
    }
  }

  const runRollingBacktestCheck = async () => {
    setRollingBacktestLoading(true)
    try {
      const result = await runDividendLowVolRollingBacktest(SYMBOLS, { scope: 'all', limit: Math.min(scanLimit, 120), years: 3 })
      setRollingBacktest(result)
      message.success(`滚动回测完成：${result.status}`)
    } catch (error) {
      console.error(error)
      message.error('滚动回测失败')
    } finally {
      setRollingBacktestLoading(false)
    }
  }

  const runValidationRetestCheck = async () => {
    setValidationLoading(true)
    try {
      const result = await runDividendLowVolValidationRetest(SYMBOLS, { scope: 'all', limit: scanLimit })
      setValidationRetest(result)
      message.success(`验证复测完成：${result.status}`)
    } catch (error) {
      console.error(error)
      message.error('验证复测失败')
    } finally {
      setValidationLoading(false)
    }
  }

  const runValidationGapDiagnostics = async () => {
    setGapDiagnosticsLoading(true)
    try {
      const result = await getDividendLowVolValidationGapDiagnostics(SYMBOLS, { scope: 'all', limit: scanLimit })
      setValidationGapDiagnostics(result)
      message.success(`验证缺口诊断完成：${result.summary.blockingGapCount} 个阻断项`)
    } catch (error) {
      console.error(error)
      message.error('验证缺口诊断失败')
    } finally {
      setGapDiagnosticsLoading(false)
    }
  }

  const createAuditPackage = async () => {
    setAuditLoading(true)
    try {
      const result = await createDividendLowVolAuditPackage(300)
      setAuditPackage(result)
      message.success(`GPT 审计包已生成：${result.fileName}`)
    } catch (error) {
      console.error(error)
      message.error('GPT 审计包生成失败')
    } finally {
      setAuditLoading(false)
    }
  }

  const createManualTradeDraft = async () => {
    setManualDraftLoading(true)
    try {
      const draft = await createDividendLowVolManualTradeDraft(3)
      setManualTradeDraft(draft)
      setManualDraftReview(null)
      message.success('红利低波人工草案已生成并落盘')
    } catch (error) {
      console.error(error)
      message.error('红利低波人工草案生成失败')
    } finally {
      setManualDraftLoading(false)
    }
  }

  const reviewManualTradeDraft = async (decision: 'approve_for_watchlist' | 'needs_more_data' | 'reject_draft') => {
    if (!manualTradeDraft?.draftId) {
      message.warning('请先生成人工草案')
      return
    }
    setManualDraftReviewLoading(true)
    try {
      const reasonByDecision = {
        approve_for_watchlist: '人工复核通过，进入观察/草案清单；仍禁止正式交易动作。',
        needs_more_data: '需要补充数据或进一步复核，暂不进入观察清单。',
        reject_draft: '人工复核拒绝该草案。',
      }
      const result = await reviewDividendLowVolManualTradeDraft({
        draftId: manualTradeDraft.draftId,
        decision,
        reason: reasonByDecision[decision],
        selectedSymbols: manualTradeDraft.actions.map((action) => action.symbol),
      })
      setManualDraftReview(result)
      if (result.watchlistArtifactRef || decision === 'approve_for_watchlist') {
        const watchlist = await getDividendLowVolManualWatchlist()
        const workflowAudit = await getDividendLowVolManualWorkflowAudit()
        setManualWatchlist(watchlist)
        setManualWorkflowAudit(workflowAudit)
      }
      message.success('人工草案复核已落盘')
    } catch (error) {
      console.error(error)
      message.error('人工草案复核失败')
    } finally {
      setManualDraftReviewLoading(false)
    }
  }

  const createManualPretradeCheck = async () => {
    setManualPretradeCheckLoading(true)
    try {
      const result = await createDividendLowVolManualPretradeCheck()
      setManualPretradeCheck(result)
      setManualPretradeReview(null)
      setManualWorkflowAudit(await getDividendLowVolManualWorkflowAudit())
      message.success('执行前人工检查单已生成')
    } catch (error) {
      console.error(error)
      message.error('执行前人工检查单生成失败')
    } finally {
      setManualPretradeCheckLoading(false)
    }
  }

  const reviewManualPretradeCheck = async (decision: 'continue_observe' | 'needs_more_review' | 'reject_execution') => {
    setManualPretradeReviewLoading(true)
    try {
      const reasonByDecision = {
        continue_observe: '继续保留观察，暂不进入执行。',
        needs_more_review: '仍需补充人工复核。',
        reject_execution: '人工复核拒绝执行。',
      }
      const result = await reviewDividendLowVolManualPretradeCheck({
        decision,
        reason: reasonByDecision[decision],
      })
      setManualPretradeReview(result)
      setManualWorkflowAudit(await getDividendLowVolManualWorkflowAudit())
      message.success('执行前检查结论已落盘')
    } catch (error) {
      console.error(error)
      message.error('执行前检查结论记录失败')
    } finally {
      setManualPretradeReviewLoading(false)
    }
  }

  const decideManualAcceptance = async (decision: 'accept_for_manual_draft_review' | 'needs_more_review' | 'reject_acceptance') => {
    setManualAcceptanceDecisionLoading(true)
    try {
      const reasonByDecision = {
        accept_for_manual_draft_review: '人工验收通过，可继续人工交易计划草案复核；不释放正式交易动作。',
        needs_more_review: '人工验收要求继续复核证据来源、免费源边界和安全 gate。',
        reject_acceptance: '人工验收拒绝，保持观察。',
      }
      const result = await decideDividendLowVolManualAcceptance({
        decision,
        reason: reasonByDecision[decision],
      })
      setManualAcceptanceDecision(result)
      setManualWorkflowAudit(await getDividendLowVolManualWorkflowAudit())
      message.success('人工验收结论已落盘')
    } catch (error) {
      console.error(error)
      message.error('人工验收结论落盘失败')
    } finally {
      setManualAcceptanceDecisionLoading(false)
    }
  }

  const loadCandidateHistory = async (symbol: string) => {
    if (historyBySymbol[symbol]) return
    try {
      const result = await getDividendLowVolCandidateHistory(symbol, 30)
      setHistoryBySymbol((items) => ({ ...items, [symbol]: result }))
    } catch (error) {
      console.error(error)
      message.warning(`${symbol} 历史记录加载失败`)
    }
  }

  useEffect(() => {
    loadCandidates()
  }, [])

  const candidates = pool?.candidates || []
  const completeDisplayCandidates = candidates.filter(isCompleteDisplayCandidate)
  const incompleteDisplayCandidates = candidates.filter((item) => !isCompleteDisplayCandidate(item))
  const eligible = completeDisplayCandidates.filter((item) => !['avoid', 'data_insufficient'].includes(item.disposition))
  const lowZone = completeDisplayCandidates.filter((item) => item.alerts.some((alert) => alert.type === 'DIVIDEND_LOW_ZONE'))
  const buildPlan = completeDisplayCandidates.filter((item) => item.alerts.some((alert) => alert.type === 'DIVIDEND_BUILD_PLAN' || alert.type === 'DIVIDEND_ADD_ON_PULLBACK'))
  const sellAlerts = completeDisplayCandidates.filter((item) => item.alerts.some((alert) => alert.type === 'DIVIDEND_TRIM' || alert.type === 'DIVIDEND_EXIT_RISK'))
  const excluded = candidates.filter((item) => item.candidateGrade === 'EXCLUDED' || item.disposition === 'avoid' || item.disposition === 'data_insufficient')
  const missingMetricSummary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const candidate of incompleteDisplayCandidates) {
      const missing = candidate.metricCompleteness?.missingMetrics || ['strategy.dataGapSummary']
      for (const metric of missing) counts.set(metric, (counts.get(metric) || 0) + 1)
    }
    return Array.from(counts.entries())
      .map(([metric, count]) => ({ metric, count }))
      .sort((left, right) => right.count - left.count)
      .slice(0, 12)
  }, [incompleteDisplayCandidates])

  const industryOptions = useMemo(() => {
    const industries = Array.from(new Set(completeDisplayCandidates.map((item) => item.identity.industry).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, 'zh-CN'))
    return [{ value: 'all', label: '全部行业' }, ...industries.map((industry) => ({ value: industry, label: industry }))]
  }, [completeDisplayCandidates])

  const filteredCandidates = useMemo(() => {
    return completeDisplayCandidates
      .filter((candidate) => industryFilter === 'all' || candidate.identity.industry === industryFilter)
      .filter((candidate) => gradeFilter === 'all' || (candidate.candidateGrade || 'EXCLUDED') === gradeFilter)
      .filter((candidate) => dispositionFilter === 'all' || candidate.disposition === dispositionFilter)
      .filter((candidate) => alertFilter === 'all' || candidate.alerts.some((alert) => alert.type === alertFilter))
      .filter((candidate) => candidate.scores.evidenceAdjustedScore >= minCompositeScore)
      .filter((candidate) => (candidate.scores.leaderScore || 0) >= minLeaderScore)
      .filter((candidate) => candidate.scores.dividendScore >= minDividendScore)
      .filter((candidate) => candidate.scores.dividendQualityScore >= minQualityScore)
      .filter((candidate) => candidate.scores.lowVolScore >= minLowVolScore)
      .sort((left, right) => {
        const diff = scoreValue(left, sortKey) - scoreValue(right, sortKey)
        return sortDirection === 'asc' ? diff : -diff
      })
  }, [alertFilter, completeDisplayCandidates, dispositionFilter, gradeFilter, industryFilter, minCompositeScore, minDividendScore, minLeaderScore, minLowVolScore, minQualityScore, sortDirection, sortKey])

  const rollingMetricByStrategy = useMemo(() => {
    const map = new Map<string, DividendLowVolRollingBacktestResult['strategyResults'][number]>()
    for (const item of rollingBacktest?.strategyResults || []) map.set(item.strategyId, item)
    return map
  }, [rollingBacktest])

  const tradingZoneRows = useMemo(() => {
    return (tradingZones?.zones || [])
      .flatMap((zone) => zone.strategies.map((strategy) => ({
        key: `${zone.symbol}-${strategy.strategyId}`,
        symbol: zone.symbol,
        name: zone.name,
        industry: zone.industry,
        price: zone.price,
        score: zone.evidenceAdjustedScore,
        disposition: zone.disposition,
        priceAudit: zone.priceAudit,
        strategy,
        rolling: rollingMetricByStrategy.get(strategy.strategyId),
      })))
      .sort((left, right) => {
        const signalRank: Record<string, number> = { buy_zone: 0, hold_zone: 1, sell_zone: 2, exit_risk: 3, insufficient: 4 }
        return (signalRank[left.strategy.currentSignal] ?? 9) - (signalRank[right.strategy.currentSignal] ?? 9) || right.score - left.score
      })
      .slice(0, 80)
  }, [rollingMetricByStrategy, tradingZones])

  const tradingZoneColumns: ColumnsType<typeof tradingZoneRows[number]> = [
    {
      title: '标的',
      key: 'symbol',
      width: 160,
      render: (_, row) => (
        <div>
          <div className="text-sm font-medium text-white">{row.symbol} {row.name}</div>
          <div className="text-xs text-gray-500">{row.industry || '行业待确认'}</div>
        </div>
      ),
    },
    {
      title: '模型/信号',
      key: 'strategy',
      width: 180,
      render: (_, row) => (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-gray-300">{row.strategy.label}</span>
          <Tag color={row.strategy.currentSignal === 'buy_zone' ? '#34d399' : row.strategy.currentSignal === 'sell_zone' || row.strategy.currentSignal === 'exit_risk' ? '#f87171' : '#38bdf8'}>
            {row.strategy.currentSignal}
          </Tag>
          {row.strategy.status === 'insufficient' && <Tag color="#fbbf24">需刷新</Tag>}
        </div>
      ),
    },
    {
      title: '价格来源',
      key: 'priceAudit',
      width: 220,
      render: (_, row) => {
        const audit = row.strategy.priceAudit || row.priceAudit
        return (
          <div className="space-y-1 text-xs text-gray-300">
            <div>现价 {formatScore(audit?.currentPrice ?? row.price)} · {audit?.tradeDate || '日期未知'}</div>
            <div className="flex flex-wrap gap-1">
              <Tag color={priceAuditColor(audit?.sanityStatus)}>{audit?.sanityStatus || 'unknown'}</Tag>
              <Tag color={freshnessColor(audit?.freshnessStatus)}>{audit?.freshnessStatus || 'unknown'}</Tag>
              <Tag color="#64748b">{audit?.sourceType || 'unknown'}</Tag>
            </div>
            {audit?.warnings?.[0] && (
              <Tooltip title={audit.warnings.join('；')}>
                <div className="truncate text-amber-200">{audit.warnings[0]}</div>
              </Tooltip>
            )}
          </div>
        )
      },
    },
    {
      title: '买入观察区间',
      key: 'buyZone',
      width: 160,
      render: (_, row) => (
        <div className="text-xs text-gray-300">
          <div>{row.strategy.status === 'available' ? formatZone(row.strategy.buyZone.low, row.strategy.buyZone.high) : '需刷新后重算'}</div>
          <div className="mt-1 text-gray-500">非正式 ADD</div>
        </div>
      ),
    },
    {
      title: '卖出观察区间',
      key: 'sellZone',
      width: 160,
      render: (_, row) => (
        <div className="text-xs text-gray-300">
          <div>{row.strategy.status === 'available' ? formatZone(row.strategy.sellZone.low, row.strategy.sellZone.high) : '需刷新后重算'}</div>
          <div className="mt-1 text-gray-500">非正式 REDUCE</div>
        </div>
      ),
    },
    {
      title: '止损/指标',
      key: 'indicators',
      width: 190,
      render: (_, row) => (
        <div className="grid grid-cols-2 gap-1 text-xs text-gray-400">
          <div>止损 {row.strategy.stopLoss ?? '--'}</div>
          <div>现价 {formatScore(row.strategy.priceAudit?.currentPrice ?? row.price)}</div>
          <div>低位 {formatScore(row.strategy.indicators.lowZoneScore)}</div>
          <div>高位 {formatScore(row.strategy.indicators.highZoneScore)}</div>
          <div>RSI {formatScore(row.strategy.indicators.rsi14)}</div>
          <div>股息分位 {formatScore(row.strategy.indicators.dividendYieldHistoricalPercentile)}</div>
        </div>
      ),
    },
    {
      title: '3 年滚动回测',
      key: 'rolling',
      width: 210,
      render: (_, row) => (
        <div className="grid grid-cols-2 gap-1 text-xs text-gray-400">
          <div>胜率 {formatScore(row.rolling?.metrics.winRatePercent ?? undefined)}%</div>
          <div>交易 {row.rolling?.sample.tradeCount ?? '--'}</div>
          <div>总收益 {formatScore(row.rolling?.metrics.totalReturnPercent ?? undefined)}%</div>
          <div>回撤 {formatScore(row.rolling?.metrics.maxDrawdownPercent ?? undefined)}%</div>
        </div>
      ),
    },
  ]

  const columns: ColumnsType<Candidate> = [
    {
      title: '标的',
      key: 'identity',
      width: 170,
      fixed: 'left',
      render: (_, candidate) => (
        <div>
          <div className="text-sm font-medium text-white">{candidate.identity.symbol} {candidate.identity.name}</div>
          <div className="mt-1 text-xs text-gray-500">{candidate.identity.industry || '行业待确认'}</div>
        </div>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 150,
      render: (_, candidate) => (
        <div className="flex flex-col gap-1">
          <Tag color={gradeColor[candidate.candidateGrade || 'EXCLUDED']}>{candidate.candidateGrade || 'EXCLUDED'}</Tag>
          <Tag color={candidate.disposition === 'avoid' || candidate.disposition === 'data_insufficient' ? '#f87171' : '#38bdf8'}>
            {dispositionLabel[candidate.disposition] || candidate.disposition}
          </Tag>
          {candidate.positionContext?.isHolding && <Tag color="#a78bfa">已持仓 {formatScore(candidate.positionContext.portfolioWeightPercent)}%</Tag>}
        </div>
      ),
    },
    {
      title: '红利',
      key: 'dividend',
      width: 150,
      render: (_, candidate) => (
        <div className="text-xs text-gray-300">
          <div>TTM {formatScore(candidate.dividend.ttmDividendYield)}%</div>
          <div>3 年 {formatScore(candidate.dividend.avgDividendYield3y)}%</div>
          <div>连续 {candidate.dividend.consecutiveDividendYears} 年</div>
        </div>
      ),
    },
    {
      title: '核心分数',
      key: 'scores',
      width: 300,
      render: (_, candidate) => (
        <div className="grid grid-cols-3 gap-2">
          {scoreCell('综合', candidate.scores.evidenceAdjustedScore)}
          {scoreCell('龙头', candidate.scores.leaderScore)}
          {scoreCell('红利', candidate.scores.dividendScore)}
          {scoreCell('质量', candidate.scores.dividendQualityScore)}
          {scoreCell('低波', candidate.scores.lowVolScore)}
          {scoreCell('估值', candidate.scores.valuationScore)}
        </div>
      ),
    },
    {
      title: '买卖区间',
      key: 'timing',
      width: 180,
      render: (_, candidate) => (
        <div className="grid grid-cols-2 gap-2">
          {scoreCell('低位', candidate.timing.lowZoneScore)}
          {scoreCell('高位', candidate.timing.highZoneScore)}
          {scoreCell('RSI', candidate.timing.rsi14)}
          {scoreCell('风险', candidate.scores.financialRiskScore)}
        </div>
      ),
    },
    {
      title: '提醒/剔除原因',
      key: 'reasons',
      render: (_, candidate) => (
        <div className="flex flex-wrap gap-1">
          {candidate.alerts.slice(0, 3).map((alert) => (
            <Tooltip key={`${candidate.identity.symbol}-${alert.type}`} title={alert.triggerReason}>
              <Tag color={alert.severity === 'danger' ? '#f87171' : alert.severity === 'warning' ? '#fbbf24' : '#38bdf8'}>{alert.type}</Tag>
            </Tooltip>
          ))}
          {candidate.dividend.dividendTrapFlag && <Tag color="#ef4444">高息陷阱</Tag>}
          {candidate.dividend.dividendCutFlag && <Tag color="#ef4444">分红削减</Tag>}
          {candidate.dividend.dpsConsecutiveDecline && <Tag color="#f97316">DPS 连降</Tag>}
          {candidate.blockedReasons.slice(0, 4).map((reason) => (
            <Tooltip key={`${candidate.identity.symbol}-${reason}`} title={reason}>
              <Tag color="#64748b">{reasonBadge(reason)}</Tag>
            </Tooltip>
          ))}
          {candidate.blockedReasons.length > 4 && <Tag color="#64748b">+{candidate.blockedReasons.length - 4}</Tag>}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">红利低波行业龙头策略</h1>
          <div className="mt-1 text-sm text-gray-400">全 A 预筛 · 股息率 &gt; 4% · 行业龙头 · 低波动 · 分红可持续 · 建仓/卖出提醒</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <InputNumber min={20} max={6000} step={100} value={scanLimit} onChange={(value) => setScanLimit(Number(value || DEFAULT_ALL_A_LIMIT))} />
          <Button loading={scanLoading} onClick={runScan}>扫描全 A 样本</Button>
          <Button loading={alertLoading} onClick={runAlertCheck}>提醒检查</Button>
          <Button onClick={loadPersistedAlerts}>持久化提醒</Button>
          <Button loading={tradingZoneLoading} onClick={loadTradingZones}>买卖区间</Button>
          <Button loading={rollingBacktestLoading} onClick={runRollingBacktestCheck}>滚动回测</Button>
          <Button loading={backtestLoading} onClick={runBacktestCheck}>回测</Button>
          <Button loading={validationLoading} onClick={runValidationRetestCheck}>验证复测</Button>
          <Button loading={gapDiagnosticsLoading} onClick={runValidationGapDiagnostics}>验证缺口</Button>
          <Button loading={manualDraftLoading} onClick={createManualTradeDraft}>生成人工草案</Button>
          <Button loading={auditLoading} onClick={createAuditPackage}>生成 GPT 审计包</Button>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={loadCandidates}>刷新</Button>
        </div>
      </div>

      <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
        当前为研究/观察提醒，不构成交易指令。正式 ADD / REDUCE 仍受 validation_evidence gate 限制，AUTO_TRADE 始终禁止。
      </div>

      {manualDraftReadiness && (
        <Card title="人工交易计划草案 Gate" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
          <div className="space-y-3 text-xs text-gray-300">
            <div className="flex flex-wrap items-center gap-2">
              <Tag color={manualDraftReadiness.readyForManualTradeDraft ? '#34d399' : '#ef4444'}>
                草案复核 {manualDraftReadiness.readyForManualTradeDraft ? 'READY' : 'BLOCKED'}
              </Tag>
              <Tag color="#64748b">decision {manualDraftReadiness.decision || manualDraftReadiness.status}</Tag>
              <Tag color={manualDraftReadiness.formalTradeActionAllowed ? '#ef4444' : '#34d399'}>
                formal ADD/REDUCE {manualDraftReadiness.formalTradeActionAllowed ? '允许' : '禁止'}
              </Tag>
              <Tag color={manualDraftReadiness.autoTradeAllowed ? '#ef4444' : '#34d399'}>
                AUTO_TRADE {manualDraftReadiness.autoTradeAllowed ? '允许' : '禁止'}
              </Tag>
              <Tag color="#ef4444">禁止 {manualDraftReadiness.prohibitedActions.join(' / ')}</Tag>
            </div>
            {manualDraftReadiness.latestEvidence && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">全 A 覆盖</div>
                  <div className="mt-1 text-white">{formatScore(manualDraftReadiness.latestEvidence.scanCoveragePercent ?? undefined)}%</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">Provider</div>
                  <div className="mt-1 text-white">{formatScore(manualDraftReadiness.latestEvidence.providerSuccessRate ?? undefined)}%</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">Cache</div>
                  <div className="mt-1 text-white">{formatScore(manualDraftReadiness.latestEvidence.cacheHitRate ?? undefined)}%</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">窗口</div>
                  <div className="mt-1 text-white">{manualDraftReadiness.latestEvidence.backtestDays ?? 0} 日</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">样本</div>
                  <div className="mt-1 text-white">{manualDraftReadiness.latestEvidence.bestSampleSize ?? 0}</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">可信度</div>
                  <div className="mt-1 text-white">{manualDraftReadiness.latestEvidence.bestCredibility || 'unknown'}</div>
                </div>
              </div>
            )}
            {(manualDraftReadiness.gates || []).length > 0 && (
              <div className="flex flex-wrap gap-1">
                {(manualDraftReadiness.gates || []).map((gate) => (
                  <Tooltip key={gate.id} title={gate.message || gate.id}>
                    <Tag color={gate.status === 'passed' ? '#34d399' : gate.status === 'warning' ? '#fbbf24' : '#ef4444'}>
                      {gate.label || gate.id}: {gate.actual ?? gate.status}
                    </Tag>
                  </Tooltip>
                ))}
              </div>
            )}
            {(manualDraftReadiness.latestEvidence?.topCandidates || []).length > 0 && (
              <div>
                <div className="mb-1 text-gray-500">草案候选预览</div>
                <div className="flex flex-wrap gap-1">
                  {(manualDraftReadiness.latestEvidence?.topCandidates || []).slice(0, 8).map((candidate) => (
                    <Tag key={candidate.candidateId} color="#38bdf8">
                      {candidate.candidateId} · {formatScore(candidate.excessReturnPercent ?? undefined)}%
                    </Tag>
                  ))}
                </div>
              </div>
            )}
            {manualWorkflowAudit && (
              <div className="rounded border border-white/10 bg-black/10 p-2">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">人工路径审计链</span>
                  <Tag color={manualWorkflowAudit.status === 'complete_observation_workflow' ? '#34d399' : '#fbbf24'}>
                    {manualWorkflowAudit.status}
                  </Tag>
                  <Tag color="#64748b">{manualWorkflowAudit.summary.completedStages}/{manualWorkflowAudit.summary.totalStages}</Tag>
                  <Tag color={manualWorkflowAudit.summary.executionReady ? '#ef4444' : '#34d399'}>
                    execution {manualWorkflowAudit.summary.executionReady ? 'ready' : 'blocked'}
                  </Tag>
                  <Tag color="#ef4444">禁止 {manualWorkflowAudit.summary.prohibitedActions.join(' / ')}</Tag>
                </div>
                <div className="grid gap-2 md:grid-cols-6">
                  {manualWorkflowAudit.stages.map((stage) => (
                    <Tooltip key={stage.id} title={stage.artifactRef?.path || stage.status}>
                      <div className="rounded border border-white/10 bg-[#0f172a] p-2">
                        <div className="text-white">{stage.label}</div>
                        <Tag className="mt-1" color={stage.status === 'missing' ? '#64748b' : '#38bdf8'}>{stage.status}</Tag>
                        <div className="mt-1 truncate text-[11px] text-gray-500">{stage.artifactId || '无产物'}</div>
                      </div>
                    </Tooltip>
                  ))}
                </div>
              </div>
            )}
            {manualAcceptanceReview && (
              <div className="rounded border border-emerald-400/20 bg-emerald-400/10 p-2 text-xs text-emerald-100">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">人工验收回看</span>
                  <Tag color={manualAcceptanceReview.status === 'ready_for_manual_acceptance_review' ? '#34d399' : '#fbbf24'}>
                    {manualAcceptanceReview.status}
                  </Tag>
                  <Tag color={manualAcceptanceReview.decisionBoundary.manualTradeDraftReady ? '#34d399' : '#ef4444'}>
                    草案 {manualAcceptanceReview.decisionBoundary.manualTradeDraftReady ? 'ready' : 'blocked'}
                  </Tag>
                  <Tag color={manualAcceptanceReview.decisionBoundary.formalTradingUnlocked ? '#ef4444' : '#34d399'}>
                    formal {manualAcceptanceReview.decisionBoundary.formalTradingUnlocked ? 'unlocked' : 'locked'}
                  </Tag>
                  <Tag color={manualAcceptanceReview.decisionBoundary.autoTradeUnlocked ? '#ef4444' : '#34d399'}>
                    auto {manualAcceptanceReview.decisionBoundary.autoTradeUnlocked ? 'unlocked' : 'locked'}
                  </Tag>
                  <Tag color="#ef4444">禁止 {manualAcceptanceReview.decisionBoundary.prohibitedActions.join(' / ')}</Tag>
                  <Button size="small" loading={manualAcceptanceDecisionLoading} onClick={() => decideManualAcceptance('accept_for_manual_draft_review')}>
                    验收通过
                  </Button>
                  <Button size="small" loading={manualAcceptanceDecisionLoading} onClick={() => decideManualAcceptance('needs_more_review')}>
                    继续复核
                  </Button>
                  <Button size="small" danger loading={manualAcceptanceDecisionLoading} onClick={() => decideManualAcceptance('reject_acceptance')}>
                    拒绝验收
                  </Button>
                </div>
                <div className="grid gap-2 md:grid-cols-4">
                  {manualAcceptanceReview.acceptanceChecklist.map((item) => (
                    <Tooltip key={item.id} title={item.requiredHumanCheck || item.evidenceFile || item.status}>
                      <div className="rounded border border-white/10 bg-[#0f172a] p-2">
                        <div className="truncate text-white">{item.id}</div>
                        <Tag className="mt-1" color={item.status === 'passed' ? '#34d399' : item.status === 'blocked' ? '#ef4444' : '#fbbf24'}>
                          {item.status}
                        </Tag>
                        <div className="mt-1 truncate text-[11px] text-gray-500">{item.evidenceFile || '审计文件待生成'}</div>
                      </div>
                    </Tooltip>
                  ))}
                </div>
                {manualAcceptanceReview.remainingValidationGaps.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {manualAcceptanceReview.remainingValidationGaps.map((gap) => (
                      <Tooltip key={gap.id} title={gap.userMessage || gap.status}>
                        <Tag color={gap.formalValidationBlocked ? '#ef4444' : '#fbbf24'}>
                          {gap.id}
                        </Tag>
                      </Tooltip>
                    ))}
                  </div>
                )}
                {manualAcceptanceReview.artifactRef?.path && (
                  <div className="mt-2 break-all text-sky-200">验收审计文件：{manualAcceptanceReview.artifactRef.path}</div>
                )}
                {manualAcceptanceDecision && (
                  <div className="mt-2 rounded border border-white/10 bg-black/10 p-2">
                    <div className="flex flex-wrap gap-2">
                      <Tag color={manualAcceptanceDecision.decision === 'accept_for_manual_draft_review' ? '#34d399' : manualAcceptanceDecision.decision === 'reject_acceptance' ? '#ef4444' : '#fbbf24'}>
                        结论 {manualAcceptanceDecision.decision || manualAcceptanceDecision.status}
                      </Tag>
                      <Tag color={manualAcceptanceDecision.safetyAssertions?.formalTradeActionAllowed ? '#ef4444' : '#34d399'}>
                        formal {manualAcceptanceDecision.safetyAssertions?.formalTradeActionAllowed ? '允许' : '禁止'}
                      </Tag>
                      <Tag color={manualAcceptanceDecision.safetyAssertions?.autoTradeAllowed ? '#ef4444' : '#34d399'}>
                        auto {manualAcceptanceDecision.safetyAssertions?.autoTradeAllowed ? '允许' : '禁止'}
                      </Tag>
                      <Tag color="#ef4444">禁止 {manualAcceptanceDecision.prohibitedActions.join(' / ')}</Tag>
                    </div>
                    <div className="mt-2 break-all text-sky-200">
                      结论编号：{manualAcceptanceDecision.decisionId || '--'}
                      {manualAcceptanceDecision.artifactRef?.path ? ` · 审计文件：${manualAcceptanceDecision.artifactRef.path}` : ''}
                    </div>
                    {manualAcceptanceDecision.reason && <div className="mt-1">{manualAcceptanceDecision.reason}</div>}
                  </div>
                )}
              </div>
            )}
            {manualTradeDraft && (
              <div className="rounded border border-white/10 bg-black/10 p-2">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="font-medium text-white">Top 3 人工草案</span>
                  <Tag color={manualTradeDraft.readyForManualTradeDraft ? '#34d399' : '#ef4444'}>{manualTradeDraft.status}</Tag>
                  <Tag color="#64748b">建议权重合计 {formatScore(manualTradeDraft.summary.totalSuggestedDraftWeightPercent)}%</Tag>
                  <Tag color="#ef4444">禁止 {manualTradeDraft.prohibitedActions.join(' / ')}</Tag>
                </div>
                {manualTradeDraft.draftId && (
                  <div className="mb-2 break-all text-sky-200">
                    草案编号：{manualTradeDraft.draftId}
                    {manualTradeDraft.artifactRef?.path ? ` · 审计文件：${manualTradeDraft.artifactRef.path}` : ''}
                  </div>
                )}
                {manualTradeDraft.draftId && (
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Button size="small" loading={manualDraftReviewLoading} onClick={() => reviewManualTradeDraft('approve_for_watchlist')}>
                      批准进入观察
                    </Button>
                    <Button size="small" loading={manualDraftReviewLoading} onClick={() => reviewManualTradeDraft('needs_more_data')}>
                      需要补数据
                    </Button>
                    <Button size="small" danger loading={manualDraftReviewLoading} onClick={() => reviewManualTradeDraft('reject_draft')}>
                      拒绝草案
                    </Button>
                    <span className="text-gray-500">复核只写入审计记录，不生成正式 ADD / REDUCE。</span>
                  </div>
                )}
                {manualDraftReview && (
                  <div className="mb-3 rounded border border-emerald-400/20 bg-emerald-400/10 p-2 text-xs text-emerald-100">
                    <div className="flex flex-wrap gap-2">
                      <Tag color="#34d399">复核 {manualDraftReview.decision || manualDraftReview.status}</Tag>
                      <Tag color="#64748b">formal {manualDraftReview.formalTradeActionAllowed ? '允许' : '禁止'}</Tag>
                      <Tag color="#64748b">auto {manualDraftReview.autoTradeAllowed ? '允许' : '禁止'}</Tag>
                      <Tag color="#ef4444">禁止 {manualDraftReview.prohibitedActions.join(' / ')}</Tag>
                    </div>
                    <div className="mt-2 break-all">
                      复核编号：{manualDraftReview.reviewId || '--'}
                      {manualDraftReview.artifactRef?.path ? ` · 审计文件：${manualDraftReview.artifactRef.path}` : ''}
                      {manualDraftReview.watchlistArtifactRef?.path ? ` · 观察清单：${manualDraftReview.watchlistArtifactRef.path}` : ''}
                    </div>
                    {manualDraftReview.reason && <div className="mt-1">{manualDraftReview.reason}</div>}
                  </div>
                )}
                {manualWatchlist && manualWatchlist.entries.length > 0 && (
                  <div className="mb-3 rounded border border-sky-400/20 bg-sky-400/10 p-2 text-xs text-sky-100">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">人工观察清单</span>
                      <Tag color="#38bdf8">{manualWatchlist.status}</Tag>
                      <Tag color="#64748b">标的 {manualWatchlist.entries.length}</Tag>
                      <Tag color="#ef4444">禁止 {manualWatchlist.prohibitedActions.join(' / ')}</Tag>
                      <Button size="small" loading={manualPretradeCheckLoading} onClick={createManualPretradeCheck}>
                        生成执行前检查单
                      </Button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {manualWatchlist.entries.slice(0, 6).map((entry) => (
                        <div key={entry.symbol} className="rounded border border-white/10 bg-[#0f172a] p-2">
                          <div className="font-medium text-white">{entry.symbol} {entry.name || ''}</div>
                          <div className="mt-1 text-gray-500">{entry.industry || '行业待确认'}</div>
                          <div className="mt-2 grid grid-cols-2 gap-1 text-gray-300">
                            <div>草案 {formatScore(entry.suggestedDraftWeightPercent)}%</div>
                            <div>正式 {formatScore(entry.formalTargetWeightPercent)}%</div>
                            <div>股息 {formatScore(entry.metrics?.ttmDividendYield ?? undefined)}%</div>
                            <div>综合 {formatScore(entry.metrics?.evidenceAdjustedScore ?? undefined)}</div>
                          </div>
                          <div className="mt-2 text-amber-100">{entry.guardrails?.[0] || '观察清单不是正式交易清单。'}</div>
                        </div>
                      ))}
                    </div>
                    {manualWatchlist.artifactRef?.path && <div className="mt-2 break-all text-sky-200">观察清单审计文件：{manualWatchlist.artifactRef.path}</div>}
                  </div>
                )}
                {manualPretradeCheck && (
                  <div className="mb-3 rounded border border-amber-400/20 bg-amber-400/10 p-2 text-xs text-amber-100">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-medium text-white">执行前人工检查单</span>
                      <Tag color="#fbbf24">{manualPretradeCheck.status}</Tag>
                      <Tag color={manualPretradeCheck.executionReady ? '#ef4444' : '#34d399'}>
                        execution {manualPretradeCheck.executionReady ? 'ready' : 'blocked'}
                      </Tag>
                      <Tag color="#ef4444">禁止 {manualPretradeCheck.prohibitedActions.join(' / ')}</Tag>
                      <Button size="small" loading={manualPretradeReviewLoading} onClick={() => reviewManualPretradeCheck('continue_observe')}>
                        继续观察
                      </Button>
                      <Button size="small" loading={manualPretradeReviewLoading} onClick={() => reviewManualPretradeCheck('needs_more_review')}>
                        仍需复核
                      </Button>
                      <Button size="small" danger loading={manualPretradeReviewLoading} onClick={() => reviewManualPretradeCheck('reject_execution')}>
                        拒绝执行
                      </Button>
                    </div>
                    <div className="grid gap-2 md:grid-cols-3">
                      {manualPretradeCheck.entries.slice(0, 6).map((entry) => (
                        <div key={entry.symbol} className="rounded border border-white/10 bg-[#0f172a] p-2">
                          <div className="font-medium text-white">{entry.symbol} {entry.name || ''}</div>
                          <div className="mt-1 text-gray-500">草案 {formatScore(entry.suggestedDraftWeightPercent)}% · 正式 {formatScore(entry.formalTargetWeightPercent)}%</div>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {entry.checks.slice(0, 4).map((check) => (
                              <Tooltip key={`${entry.symbol}-${check.id}`} title={check.message}>
                                <Tag color={check.status === 'passed' ? '#34d399' : check.status === 'blocked' ? '#ef4444' : '#fbbf24'}>{check.id}</Tag>
                              </Tooltip>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="mt-2 text-amber-100">
                      检查单只列出执行前人工复核项；FAMS 不生成正式买入/卖出指令，也不会自动下单。
                    </div>
                    {manualPretradeCheck.artifactRef?.path && <div className="mt-2 break-all text-sky-200">检查单审计文件：{manualPretradeCheck.artifactRef.path}</div>}
                    {manualPretradeReview && (
                      <div className="mt-2 rounded border border-white/10 bg-black/10 p-2">
                        <div className="flex flex-wrap gap-2">
                          <Tag color="#fbbf24">结论 {manualPretradeReview.decision || manualPretradeReview.status}</Tag>
                          <Tag color={manualPretradeReview.executionReady ? '#ef4444' : '#34d399'}>
                            execution {manualPretradeReview.executionReady ? 'ready' : 'blocked'}
                          </Tag>
                          <Tag color="#ef4444">禁止 {manualPretradeReview.prohibitedActions.join(' / ')}</Tag>
                        </div>
                        <div className="mt-2 break-all text-sky-200">
                          结论编号：{manualPretradeReview.reviewId || '--'}
                          {manualPretradeReview.artifactRef?.path ? ` · 审计文件：${manualPretradeReview.artifactRef.path}` : ''}
                        </div>
                        {manualPretradeReview.reason && <div className="mt-1">{manualPretradeReview.reason}</div>}
                      </div>
                    )}
                  </div>
                )}
                <div className="grid gap-2 md:grid-cols-3">
                  {manualTradeDraft.actions.map((action) => (
                    <div key={action.symbol} className="rounded border border-white/10 bg-[#0f172a] p-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="font-medium text-white">{action.rank}. {action.symbol} {action.name || ''}</div>
                        <Tag color={action.draftType.includes('BUILD') ? '#38bdf8' : action.draftType.includes('ADD') ? '#fbbf24' : '#94a3b8'}>
                          {action.draftType}
                        </Tag>
                      </div>
                      <div className="mt-1 text-gray-500">{action.industry || '行业待确认'}</div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-gray-300">
                        <div>股息 {formatScore(action.metrics.ttmDividendYield ?? undefined)}%</div>
                        <div>低波 {formatScore(action.metrics.lowVolScore ?? undefined)}</div>
                        <div>龙头 {formatScore(action.metrics.leaderScore ?? undefined)}</div>
                        <div>综合 {formatScore(action.metrics.evidenceAdjustedScore ?? undefined)}</div>
                        <div>当前 {formatScore(action.currentWeightPercent)}%</div>
                        <div>草案 {formatScore(action.suggestedDraftWeightPercent)}%</div>
                      </div>
                      <div className="mt-2 text-sky-100">
                        {action.rationale[0]}
                      </div>
                      <div className="mt-2 text-amber-100">
                        {action.guardrails[0]}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="rounded border border-sky-400/20 bg-sky-400/10 p-2 text-sky-100">
              READY 只代表可以进入人工交易计划草案复核；页面不会生成正式买入/卖出指令，执行前仍需人工复核停复牌、涨跌停、仓位和组合风险。
            </div>
          </div>
        </Card>
      )}

      {dataReadiness && (
        <div className="rounded-lg border border-white/10 bg-[#111827] p-3 text-xs text-gray-300">
          <div className="flex flex-wrap items-center gap-2">
            <Tag color={dataReadiness.status === 'ready_full_universe' || dataReadiness.status === 'ready_free_source_validation' || dataReadiness.status === 'ready_free_source_research' ? '#34d399' : dataReadiness.status === 'research_scan_partial' ? '#fbbf24' : '#ef4444'}>
              数据就绪：{dataReadiness.status}
            </Tag>
            <Tag color={dataReadiness.providerMode === 'free_source_research' ? '#38bdf8' : dataReadiness.providerMode === 'formal_provider' ? '#34d399' : '#ef4444'}>
              数据模式 {dataReadiness.providerMode || 'unknown'}
            </Tag>
            <Tag color={dataReadiness.gates.persistentFullAScanAllowed ? '#34d399' : '#ef4444'}>
              免费源研究扫描 {dataReadiness.gates.persistentFullAScanAllowed ? '允许' : '阻断'}
            </Tag>
            <Tag color={(dataReadiness.gates.freeSourceValidationAllowed ?? dataReadiness.gates.formalValidationPromotionAllowed) ? '#34d399' : '#ef4444'}>
              免费源验证 {(dataReadiness.gates.freeSourceValidationAllowed ?? dataReadiness.gates.formalValidationPromotionAllowed) ? '允许' : '阻断'}
            </Tag>
            <Tag color="#64748b">canonical {dataReadiness.canonicalQuoteList.itemCount}</Tag>
            <Tag color="#64748b">行情 {dataReadiness.marketData.marketBarSymbols} / {formatScore(dataReadiness.marketData.scanCoveragePercent)}%</Tag>
            <Tag color="#64748b">特征 {dataReadiness.marketData.marketFeatureSymbols} / {formatScore(dataReadiness.marketData.featureCoveragePercent)}%</Tag>
            <Tag color="#64748b">状态 {dataReadiness.securityAndTradeability.securityStatusSymbols} / {formatScore(dataReadiness.securityAndTradeability.securityStatusCoveragePercent)}%</Tag>
            <Tag color="#64748b">交易约束 {dataReadiness.securityAndTradeability.tradeabilitySymbols} / {formatScore(dataReadiness.securityAndTradeability.tradeabilityCoveragePercent)}%</Tag>
            <Tag color={dataReadiness.providerIngestion.status.includes('blocked') ? '#ef4444' : '#fbbf24'}>provider {dataReadiness.providerIngestion.status}</Tag>
          </div>
          {(dataReadiness.researchBlockers || dataReadiness.blockers).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="mr-1 text-gray-500">研究阻断</span>
              {(dataReadiness.researchBlockers || dataReadiness.blockers).map((blocker) => (
                <Tag key={blocker} color="#ef4444">{blocker}</Tag>
              ))}
            </div>
          )}
          {(dataReadiness.providerUpgradeBlockers || dataReadiness.formalBlockers || []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              <span className="mr-1 text-gray-500">Provider 升级项</span>
              {(dataReadiness.providerUpgradeBlockers || dataReadiness.formalBlockers || []).map((blocker) => (
                <Tag key={blocker} color="#f97316">{blocker}</Tag>
              ))}
            </div>
          )}
          <div className="mt-2 text-gray-500">
            恢复顺序：{dataReadiness.recoveryCommands.slice(0, 3).join('  →  ')}
          </div>
        </div>
      )}

      {pool?.universeSummary && (
        <div className="rounded-lg border border-sky-400/20 bg-sky-400/10 px-3 py-2 text-xs text-sky-100">
          全 A universe {pool.universeSummary.universeTotal} 只，预筛行业龙头 {pool.universeSummary.prefilteredCount} 只，本轮复核 {pool.universeSummary.selectedCount} 只。先做行业龙头预筛，再补行情、分红、财务和低波指标。
        </div>
      )}

      {v2ResearchValidation && (
        <Card title="V2 研究验证诊断" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
          <div className="space-y-3 text-xs text-gray-300">
            <div className="flex flex-wrap items-center gap-2">
              <Tag color={v2ResearchValidation.status === 'research_candidate_passed' ? '#34d399' : v2ResearchValidation.status === 'missing' ? '#ef4444' : '#fbbf24'}>
                {v2ResearchValidation.status}
              </Tag>
              <Tag color="#38bdf8">V2 候选 {v2ResearchValidation.v2ResearchCandidates ?? v2ResearchValidation.backtest?.sample?.researchEligibleCount ?? 0}</Tag>
              <Tag color="#64748b">有效路径 {v2ResearchValidation.backtest?.sample?.effectivePathCount ?? 0}</Tag>
              <Tag color="#64748b">严格 V1 {v2ResearchValidation.latestPool?.strictV1ResearchCandidates ?? 0}</Tag>
              <Tag color={v2ResearchValidation.validationDecision.usableForTradingAdvice ? '#ef4444' : '#34d399'}>
                交易解锁 {v2ResearchValidation.validationDecision.usableForTradingAdvice ? '是' : '否'}
              </Tag>
              <Tag color="#ef4444">禁止 {v2ResearchValidation.validationDecision.prohibitedActions.join(' / ')}</Tag>
            </div>
            <div className="rounded border border-amber-400/20 bg-amber-400/10 p-2 text-amber-100">
              V2 是扩大样本后的研究诊断，用于判断策略族是否值得继续验证；它不替代严格 V1 候选池，也不释放正式 ADD / REDUCE / AUTO_TRADE。
            </div>
            {v2ResearchValidation.backtest?.metrics && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">总收益</div>
                  <div className="mt-1 text-white">{formatScore(v2ResearchValidation.backtest.metrics.totalReturnPercent)}%</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">年化</div>
                  <div className="mt-1 text-white">{formatScore(v2ResearchValidation.backtest.metrics.annualizedReturnPercent)}%</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">最大回撤</div>
                  <div className="mt-1 text-white">{formatScore(v2ResearchValidation.backtest.metrics.maxDrawdownPercent)}%</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">股息贡献</div>
                  <div className="mt-1 text-white">{formatScore(v2ResearchValidation.backtest.metrics.dividendContributionPercent)}%</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">Benchmark</div>
                  <div className="mt-1 text-white">{formatScore(v2ResearchValidation.backtest.metrics.benchmarkReturnPercent)}%</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">超额</div>
                  <div className="mt-1 text-white">{formatScore(v2ResearchValidation.backtest.metrics.excessReturnPercent)}%</div>
                </div>
              </div>
            )}
            {v2ResearchValidation.backtest?.validationEvidence && (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                {[
                  ['状态', v2ResearchValidation.backtest.validationEvidence.status],
                  ['OOS', v2ResearchValidation.backtest.validationEvidence.outOfSample],
                  ['Walk', v2ResearchValidation.backtest.validationEvidence.walkForward],
                  ['参数', v2ResearchValidation.backtest.validationEvidence.parameterSensitivity],
                  ['分组', v2ResearchValidation.backtest.validationEvidence.groupStability],
                ].map(([label, value]) => (
                  <div key={String(label)} className="rounded border border-white/10 bg-black/10 p-2">
                    <div className="text-gray-500">{label}</div>
                    <div className="mt-1 text-white">{value || '--'}</div>
                  </div>
                ))}
              </div>
            )}
            {(v2ResearchValidation.candidates || []).length > 0 && (
              <div>
                <div className="mb-2 text-gray-500">研究样本前列</div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
                  {(v2ResearchValidation.candidates || []).slice(0, 8).map((candidate) => (
                    <div key={candidate.symbol} className="rounded border border-white/10 bg-black/10 p-2">
                      <div className="text-white">{candidate.symbol} {candidate.name || ''}</div>
                      <div className="mt-1 text-gray-500">{candidate.industry || '行业待确认'}</div>
                      <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-gray-400">
                        <div>综合 {formatScore(candidate.evidenceAdjustedScore)}</div>
                        <div>股息 {formatScore(candidate.dividendYield)}%</div>
                        <div>龙头 {formatScore(candidate.leaderScore)}</div>
                        <div>低波 {formatScore(candidate.lowVolScore)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {v2ResearchValidation.artifactRef && (
              <div className="break-all text-sky-200">审计落盘：{v2ResearchValidation.artifactRef.path}</div>
            )}
          </div>
        </Card>
      )}

      <Card title="买入/卖出观察区间与滚动策略" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-300">
            <Tag color="#38bdf8">布林低吸高抛</Tag>
            <Tag color="#a78bfa">股息率分位+长期均线</Tag>
            <Tag color="#ef4444">禁止 ADD / REDUCE / AUTO_TRADE</Tag>
            {rollingBacktest && (
              <>
                <Tag color={rollingBacktest.status === 'completed' ? '#34d399' : '#fbbf24'}>3 年滚动 {rollingBacktest.status}</Tag>
                <Tag color={rollingBacktest.conclusion.researchPassed ? '#34d399' : '#fbbf24'}>研究通过 {rollingBacktest.conclusion.researchPassed ? '是' : '否'}</Tag>
                <Tag color="#64748b">最长样本 {rollingBacktest.window.maxEffectiveTradingDays} 日</Tag>
              </>
            )}
          </div>
          <div className="rounded border border-amber-400/20 bg-amber-400/10 p-2 text-xs text-amber-100">
            区间只用于研究观察和人工计划草案：进入买入观察区不等于正式 ADD，进入卖出观察区不等于正式 REDUCE。正式动作仍由 validation_evidence、人工复核、仓位和交易约束共同阻断。
          </div>
          {rollingBacktest && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {rollingBacktest.strategyResults.map((result) => (
                <div key={result.strategyId} className="rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-300">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-white">{result.label}</span>
                    <Tag color={result.status === 'completed' ? '#34d399' : '#fbbf24'}>{result.status}</Tag>
                    <Tag color="#64748b">交易 {result.sample.tradeCount}</Tag>
                    {result.insufficientItems.slice(0, 2).map((item) => <Tag key={item} color="#f97316">{item}</Tag>)}
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <div>胜率 {formatScore(result.metrics.winRatePercent ?? undefined)}%</div>
                    <div>总收益 {formatScore(result.metrics.totalReturnPercent ?? undefined)}%</div>
                    <div>年化 {formatScore(result.metrics.annualizedReturnPercent ?? undefined)}%</div>
                    <div>回撤 {formatScore(result.metrics.maxDrawdownPercent ?? undefined)}%</div>
                    <div>股息 {formatScore(result.metrics.dividendContributionPercent ?? undefined)}%</div>
                    <div>超额 {formatScore(result.metrics.excessReturnPercent ?? undefined)}%</div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {tradingZoneRows.length > 0 ? (
            <Table
              size="small"
              rowKey="key"
              columns={tradingZoneColumns}
              dataSource={tradingZoneRows}
              pagination={{ pageSize: 12 }}
              scroll={{ x: 1280 }}
            />
          ) : (
            <Empty description="点击“买卖区间”生成候选区间；点击“滚动回测”补充 3 年策略验证。" />
          )}
          {rollingBacktest?.conclusion.reason && (
            <div className="rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-300">
              结论：{rollingBacktest.conclusion.reason}
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
        <Card className="bg-[#1a1a2e] border-[surface-border]" styles={{ body: { padding: 14 } }}>
          <div className="text-xs text-gray-400">本轮样本</div>
          <div className="mt-1 text-2xl font-semibold text-white">{candidates.length}</div>
        </Card>
        <Card className="bg-[#1a1a2e] border-[surface-border]" styles={{ body: { padding: 14 } }}>
          <div className="text-xs text-gray-400">完整指标</div>
          <div className="mt-1 text-2xl font-semibold text-emerald-300">{completeDisplayCandidates.length}</div>
        </Card>
        <Card className="bg-[#1a1a2e] border-[surface-border]" styles={{ body: { padding: 14 } }}>
          <div className="text-xs text-gray-400">研究候选</div>
          <div className="mt-1 text-2xl font-semibold text-sky-300">{eligible.length}</div>
        </Card>
        <Card className="bg-[#1a1a2e] border-[surface-border]" styles={{ body: { padding: 14 } }}>
          <div className="text-xs text-gray-400">低位提醒</div>
          <div className="mt-1 text-2xl font-semibold text-sky-300">{lowZone.length}</div>
        </Card>
        <Card className="bg-[#1a1a2e] border-[surface-border]" styles={{ body: { padding: 14 } }}>
          <div className="text-xs text-gray-400">建仓/卖出</div>
          <div className="mt-1 text-2xl font-semibold text-amber-300">{buildPlan.length}/{sellAlerts.length}</div>
        </Card>
      </div>

      <Card title="未纳入完整指标表" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
        <div className="space-y-3 text-xs text-gray-300">
          <div className="flex flex-wrap gap-2">
            <Tag color="#34d399">完整指标 {completeDisplayCandidates.length}</Tag>
            <Tag color="#fbbf24">未纳入 {incompleteDisplayCandidates.length}</Tag>
            <Tag color="#64748b">剔除/回避 {excluded.length}</Tag>
            {pool?.metricCompletenessSummary && <Tag color="#38bdf8">完整率 {formatScore(pool.metricCompletenessSummary.completenessPercent)}%</Tag>}
          </div>
          <div className="text-gray-500">
            主候选表只展示核心策略指标完整、无 data gap、无事实不足提醒的标的；未纳入标的保留在审计摘要中，不用空值或占位符伪造成可比较指标。
          </div>
          {(pool?.metricCompletenessSummary?.topMissingMetrics.length || missingMetricSummary.length) > 0 && (
            <div className="flex flex-wrap gap-2">
              {(pool?.metricCompletenessSummary?.topMissingMetrics || missingMetricSummary).map((item) => (
                <Tag key={item.metric} color="#64748b">{metricBadge(item.metric)} {item.count}</Tag>
              ))}
            </div>
          )}
          {incompleteDisplayCandidates.length > 0 && (
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
              {incompleteDisplayCandidates.slice(0, 8).map((candidate) => (
                <div key={candidate.identity.symbol} className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-white">{candidate.identity.symbol} {candidate.identity.name}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(candidate.metricCompleteness?.missingMetrics || ['strategy.dataGapSummary']).slice(0, 4).map((metric) => (
                      <Tag key={`${candidate.identity.symbol}-${metric}`} color="#fbbf24">{metricBadge(metric)}</Tag>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card title="剔除原因审计" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
          {pool?.rejectionSummary ? (
            <div className="space-y-3 text-xs">
              <div className="flex flex-wrap gap-2">
                <Tag color="#f87171">剔除 {pool.rejectionSummary.rejectedCount}</Tag>
                <Tag color="#fbbf24">数据缺口相关 {pool.rejectionSummary.dataIssueCount}</Tag>
                <Tag color="#38bdf8">硬规则不满足 {pool.rejectionSummary.hardRuleCount}</Tag>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                {pool.rejectionSummary.byCategory.map((item) => (
                  <div key={item.category} className="rounded border border-white/10 bg-black/10 p-2">
                    <div className="text-gray-500">{categoryLabel[item.category] || item.category}</div>
                    <div className="mt-1 text-base font-semibold text-white">{item.count}</div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {pool.rejectionSummary.topReasons.map((item) => (
                  <Tooltip key={item.reason} title={item.reason}>
                    <Tag color={item.category === 'data' ? '#fbbf24' : '#64748b'}>{item.label} {item.count}</Tag>
                  </Tooltip>
                ))}
              </div>
              <div className="text-gray-500">{pool.rejectionSummary.note}</div>
            </div>
          ) : (
            <div className="text-sm text-gray-400">等待后端返回剔除归因。</div>
          )}
        </Card>

        <Card title="龙头数据审计" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
          {pool?.leaderAuditSummary ? (
            <div className="space-y-3 text-xs text-gray-300">
              <div className="flex flex-wrap gap-2">
                <Tag color={pool.leaderAuditSummary.status === 'available' ? '#34d399' : '#fbbf24'}>{pool.leaderAuditSummary.status}</Tag>
                <Tag color="#38bdf8">龙头达标 {pool.leaderAuditSummary.leaderPassed}/{pool.leaderAuditSummary.total}</Tag>
                <Tag color="#64748b">身份覆盖 {formatScore(pool.leaderAuditSummary.canonicalIdentityCoveragePercent)}%</Tag>
                <Tag color="#64748b">龙头证据 {formatScore(pool.leaderAuditSummary.leaderEvidenceCoveragePercent)}%</Tag>
                <Tag color="#38bdf8">免费排名覆盖 {formatScore(pool.leaderAuditSummary.freeSourceRankEvidenceCoveragePercent)}%</Tag>
              </div>
              <div className="flex flex-wrap gap-2">
                <Tag color="#38bdf8">研究验证 {pool.leaderAuditSummary.verifiedResearchCount || 0}</Tag>
                <Tag color="#fbbf24">候选 {pool.leaderAuditSummary.leaderCandidateCount || 0}</Tag>
                <Tag color="#f97316">部分证据 {pool.leaderAuditSummary.leaderPartialCount || 0}</Tag>
                <Tag color="#94a3b8">非龙头 {pool.leaderAuditSummary.notLeaderCount || 0}</Tag>
                <Tag color="#64748b">证据不足 {pool.leaderAuditSummary.insufficientCount || 0}</Tag>
              </div>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">种子/默认补全</div>
                  <div className="mt-1 text-base font-semibold text-white">{pool.leaderAuditSummary.seedFallbackCount}</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">缺营收/净利排名</div>
                  <div className="mt-1 text-base font-semibold text-white">{pool.leaderAuditSummary.missingRevenueNetProfitRankCount}</div>
                </div>
                <div className="rounded border border-white/10 bg-black/10 p-2">
                  <div className="text-gray-500">审计结论</div>
                  <div className="mt-1 text-sm text-amber-100">{pool.leaderAuditSummary.status === 'available' ? '可复核' : '部分缺口'}</div>
                </div>
              </div>
              <div className="text-gray-500">{pool.leaderAuditSummary.auditNote}</div>
            </div>
          ) : (
            <div className="text-sm text-gray-400">等待后端返回行业龙头数据审计。</div>
          )}
        </Card>
      </div>

      <Card title="指标说明" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
          <Collapse
            size="small"
            ghost
            items={metricExplanations.map((item) => ({
              key: item.name,
              label: <span className="text-sm text-slate-200">{item.name}</span>,
              children: <div className="text-xs text-gray-400">{item.text}</div>,
            }))}
          />
      </Card>

      {(persistedAlerts || auditPackage) && (
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
          {persistedAlerts && (
            <Card title={`持久化提醒 ${persistedAlerts.totalAlerts}`} className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
              {persistedAlerts.totalAlerts === 0 ? (
                <div className="text-sm text-gray-400">最新持久化扫描没有打开的红利低波提醒。</div>
              ) : (
                <div className="space-y-2">
                  {persistedAlerts.alerts.slice(0, 8).map((alert) => (
                    <div key={`${alert.symbol}-${alert.alertType}-${alert.triggerDate}`} className="rounded border border-white/10 bg-black/10 p-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-white">{alert.symbol} {alert.name}</span>
                        <Tag color={alert.severity === 'danger' ? '#f87171' : alert.severity === 'warning' ? '#fbbf24' : '#38bdf8'}>{alert.alertType}</Tag>
                        <Tag color="#64748b">{alert.triggerDate}</Tag>
                      </div>
                      <div className="mt-1 text-gray-400">{alert.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
          {auditPackage && (
            <Card title="GPT 审计包" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
              <div className="space-y-2 text-xs text-gray-300">
                <div>文件：<span className="text-white">{auditPackage.fileName}</span></div>
                <div>路径：<span className="break-all text-sky-200">{auditPackage.path}</span></div>
                <div>候选：{auditPackage.candidateCount} · 研究候选：{auditPackage.eligibleResearchCandidates}</div>
                <div>禁止动作：{auditPackage.policy.prohibitedActions.join(' / ')}</div>
              </div>
            </Card>
          )}
        </div>
      )}

      <Card title={<span><FilterOutlined /> 筛选与排序</span>} className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <div className="mb-1 text-xs text-gray-400">行业</div>
            <Select className="w-full" value={industryFilter} options={industryOptions} onChange={setIndustryFilter} showSearch optionFilterProp="label" />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">候选等级</div>
            <Select className="w-full" value={gradeFilter} onChange={setGradeFilter} options={[
              { value: 'all', label: '全部等级' },
              { value: 'A', label: 'A' },
              { value: 'B', label: 'B' },
              { value: 'WATCH', label: 'WATCH' },
              { value: 'EXCLUDED', label: 'EXCLUDED' },
            ]} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">处置状态</div>
            <Select className="w-full" value={dispositionFilter} onChange={setDispositionFilter} options={[
              { value: 'all', label: '全部状态' },
              ...Array.from(new Set(completeDisplayCandidates.map((item) => item.disposition))).map((value) => ({ value, label: dispositionLabel[value] || value })),
            ]} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">提醒类型</div>
            <Select className="w-full" value={alertFilter} onChange={setAlertFilter} options={[
              { value: 'all', label: '全部提醒' },
              ...Array.from(new Set(completeDisplayCandidates.flatMap((item) => item.alerts.map((alert) => alert.type)))).map((value) => ({ value, label: value })),
            ]} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">综合分最低 {minCompositeScore}</div>
            <Slider min={0} max={100} value={minCompositeScore} onChange={setMinCompositeScore} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">龙头分最低 {minLeaderScore}</div>
            <Slider min={0} max={100} value={minLeaderScore} onChange={setMinLeaderScore} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">红利分最低 {minDividendScore}</div>
            <Slider min={0} max={100} value={minDividendScore} onChange={setMinDividendScore} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">质量分最低 {minQualityScore}</div>
            <Slider min={0} max={100} value={minQualityScore} onChange={setMinQualityScore} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">低波分最低 {minLowVolScore}</div>
            <Slider min={0} max={100} value={minLowVolScore} onChange={setMinLowVolScore} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">排序指标</div>
            <Select className="w-full" value={sortKey} onChange={setSortKey} options={[
              { value: 'evidenceAdjustedScore', label: '综合分' },
              { value: 'totalResearchScore', label: '研究原始分' },
              { value: 'leaderScore', label: '龙头分' },
              { value: 'dividendScore', label: '红利分' },
              { value: 'dividendQualityScore', label: '质量分' },
              { value: 'lowVolScore', label: '低波分' },
              { value: 'valuationScore', label: '估值分' },
              { value: 'lowZoneScore', label: '低位分' },
              { value: 'highZoneScore', label: '高位分' },
              { value: 'ttmDividendYield', label: 'TTM 股息率' },
              { value: 'financialRiskScore', label: '风险分' },
            ]} />
          </div>
          <div>
            <div className="mb-1 text-xs text-gray-400">排序方向</div>
            <Select className="w-full" value={sortDirection} onChange={setSortDirection} options={[
              { value: 'desc', label: '从高到低' },
              { value: 'asc', label: '从低到高' },
            ]} />
          </div>
          <div className="flex items-end">
            <Button
              block
              onClick={() => {
                setIndustryFilter('all')
                setGradeFilter('all')
                setDispositionFilter('all')
                setAlertFilter('all')
                setMinCompositeScore(0)
                setMinLeaderScore(0)
                setMinDividendScore(0)
                setMinQualityScore(0)
                setMinLowVolScore(0)
                setSortKey('evidenceAdjustedScore')
                setSortDirection('desc')
              }}
            >
              重置筛选
            </Button>
          </div>
        </div>
      </Card>

      <Card
        title={`完整策略指标候选 ${filteredCandidates.length}/${completeDisplayCandidates.length}`}
        className="bg-[#1a1a2e] border-[surface-border]"
        styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 0 } }}
      >
        {loading ? (
          <div className="flex justify-center py-10"><Spin /></div>
        ) : completeDisplayCandidates.length === 0 ? (
          <Empty description="暂无完整指标候选，缺失项见上方审计摘要" />
        ) : (
          <Table
            rowKey={(candidate) => candidate.identity.symbol}
            columns={columns}
            dataSource={filteredCandidates}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            scroll={{ x: 1100 }}
            expandable={{
              onExpand: (expanded, candidate) => {
                if (expanded) void loadCandidateHistory(candidate.identity.symbol)
              },
              expandedRowRender: (candidate) => (
                <div className="space-y-2 bg-[#111122] p-3 text-xs text-gray-300">
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                    {[
                      ['价格', candidate.timing.price, ''],
                      ['MA120', candidate.timing.ma120, ''],
                      ['MA250', candidate.timing.ma250, ''],
                      ['120 波动', candidate.lowVolatility?.volatility120d, '%'],
                      ['250 回撤', candidate.lowVolatility?.maxDrawdown250d, '%'],
                      ['PE', candidate.valuation?.pe, ''],
                      ['PB', candidate.valuation?.pb, ''],
                      ['支付率', candidate.dividend.payoutRatio, '%'],
                      ['DPS 增长', candidate.dividend.dpsGrowth3y, '%'],
                      ['ROE', candidate.quality?.roe, ''],
                      ['OCF/NP', candidate.quality?.operatingCashFlowToNetProfit, ''],
                      ['当前仓位', candidate.positionContext?.portfolioWeightPercent, '%'],
                      ['研究目标', candidate.positionContext?.researchTargetWeightPercent, '%'],
                      ['正式目标', candidate.positionContext?.formalTargetWeightPercent, '%'],
                    ].filter(([, value]) => hasNumber(value as number | undefined)).map(([label, value, suffix]) => (
                      <div key={String(label)}>{label} {formatRequiredScore(value as number)}{suffix}</div>
                    ))}
                  </div>
                  {candidate.positionContext?.isHolding && (
                    <div className="rounded border border-purple-400/20 bg-purple-400/10 p-2 text-purple-100">
                      已持仓：数量 {formatScore(candidate.positionContext.quantity)} · 市值 {formatScore(candidate.positionContext.marketValue)} · 成本 {formatScore(candidate.positionContext.avgCost)} · 浮盈亏 {formatScore(candidate.positionContext.unrealizedPnlPercent)}%。正式 ADD / REDUCE 仍由交易 gate 控制。
                    </div>
                  )}
                  {candidate.leaderEvidence && (
                    <div className="rounded border border-sky-400/20 bg-sky-400/10 p-2">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="font-medium text-sky-100">行业龙头证据</span>
                        <Tag color={candidate.leaderEvidence.status === 'verified_industry_leader' ? '#38bdf8' : candidate.leaderEvidence.status === 'not_leader' ? '#94a3b8' : '#fbbf24'}>
                          {leaderStatusLabel[candidate.leaderEvidence.status] || candidate.leaderEvidence.status}
                        </Tag>
                        {candidate.leaderEvidence.missingFields.length > 0 && <Tag color="#f97316">缺 {candidate.leaderEvidence.missingFields.join(' / ')}</Tag>}
                      </div>
                      <div className="mb-2 flex flex-wrap gap-2">
                        {([
                          'marketCapRankVerified',
                          'revenueRankVerified',
                          'netProfitRankVerified',
                          'roePercentileVerified',
                          'providerCrossCheckedIndustryRank',
                          'seedFallbackUsed',
                        ] as const).map((key) => (
                          <Tag key={key} color={candidate.leaderEvidence?.[key] ? (key === 'seedFallbackUsed' ? '#f97316' : '#34d399') : '#64748b'}>
                            {leaderEvidenceLabel[key]} {candidate.leaderEvidence?.[key] ? '是' : '否'}
                          </Tag>
                        ))}
                      </div>
                      <div className="text-gray-400">{candidate.leaderEvidence.note}</div>
                      {candidate.leaderEvidence.evidenceRefs.length > 0 && (
                        <div className="mt-2 grid grid-cols-1 gap-1 md:grid-cols-2">
                          {candidate.leaderEvidence.evidenceRefs.slice(0, 8).map((ref) => (
                            <div key={`${candidate.identity.symbol}-${ref}`} className="truncate rounded border border-white/10 bg-black/10 px-2 py-1 text-[11px] text-sky-100" title={ref}>{ref}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {(candidate.dividend.dividendRiskFlags || []).length > 0 && (
                    <div className="rounded border border-rose-400/20 bg-rose-400/10 p-2 text-rose-100">
                      分红风险：{candidate.dividend.dividendRiskFlags?.join(' / ')}
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Tag color={candidate.dividend.specialDividendFlag ? '#f97316' : '#64748b'}>特殊分红 {candidate.dividend.specialDividendFlag ? '是' : '否'}</Tag>
                    <Tag color={candidate.dividend.dividendCutFlag ? '#ef4444' : '#64748b'}>分红削减 {candidate.dividend.dividendCutFlag ? '是' : '否'}</Tag>
                    <Tag color={candidate.dividend.dpsConsecutiveDecline ? '#ef4444' : '#64748b'}>DPS 连降 {candidate.dividend.dpsConsecutiveDecline ? '是' : '否'}</Tag>
                    <Tag color={candidate.dividend.dividendTrapFlag ? '#ef4444' : '#64748b'}>高息陷阱 {candidate.dividend.dividendTrapFlag ? '是' : '否'}</Tag>
                  </div>
                  {candidate.dataVerification && (
                    <div className="flex flex-wrap gap-2">
                      <Tag color={candidate.dataVerification.status === 'cross_checked' ? '#34d399' : candidate.dataVerification.status === 'provider_fallback' ? '#fbbf24' : '#64748b'}>
                        证据 {candidate.dataVerification.status}
                      </Tag>
                      <Tag color="#64748b">providers {candidate.dataVerification.providerCount}</Tag>
                      {candidate.dataVerification.crossCheckedFields.length > 0 && <Tag color="#64748b">fields {candidate.dataVerification.crossCheckedFields.join(' / ')}</Tag>}
                      <Tag color={candidate.dataVerification.warningCount ? '#f59e0b' : '#64748b'}>warnings {candidate.dataVerification.warningCount}</Tag>
                    </div>
                  )}
                  <div className="rounded border border-white/10 bg-black/10 p-2">
                    <div className="mb-2 text-gray-400">最近扫描历史</div>
                    {historyBySymbol[candidate.identity.symbol] ? (
                      <div className="grid grid-cols-1 gap-1 md:grid-cols-3">
                        {historyBySymbol[candidate.identity.symbol].history.slice(0, 6).map((item) => (
                          <div key={`${candidate.identity.symbol}-${item.tradeDate}`} className="rounded border border-white/10 p-2">
                            <div className="text-white">{item.tradeDate}</div>
                            <div className="text-gray-500">综合 {formatScore(item.evidenceAdjustedScore)} · 低位 {formatScore(item.lowZoneScore)} · 高位 {formatScore(item.highZoneScore)}</div>
                            <div className="text-gray-500">{dispositionLabel[item.disposition] || item.disposition}</div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-gray-500">展开后加载历史记录...</div>
                    )}
                  </div>
                </div>
              ),
            }}
          />
        )}
      </Card>

      {(alerts || backtest || validationRetest || validationGapDiagnostics) && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {alerts && (
            <Card title="提醒检查" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' } }}>
              <div className="text-sm text-gray-300">提醒 {alerts.totalAlerts} 条 · 禁止 {alerts.policy.prohibitedActions.join(' / ')}</div>
            </Card>
          )}
          {backtest && (
            <Card title="回测与验证证据" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' } }}>
              <div className="text-sm text-gray-300">{backtest.status} · 样本 {backtest.sample.researchEligibleCount}/{backtest.sample.candidateCount} · validation {backtest.validationEvidence.status}</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-400 md:grid-cols-4">
                <div>OOS {backtest.validationEvidence.outOfSample}</div>
                <div>Walk {backtest.validationEvidence.walkForward}</div>
                <div>参数 {backtest.validationEvidence.parameterSensitivity}</div>
                <div>分组 {backtest.validationEvidence.groupStability}</div>
              </div>
              {backtest.metrics && (
                <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-400 md:grid-cols-4">
                  <div>总收益 {formatScore(backtest.metrics.totalReturnPercent)}%</div>
                  <div>最大回撤 {formatScore(backtest.metrics.maxDrawdownPercent)}%</div>
                  <div>股息贡献 {formatScore(backtest.metrics.dividendContributionPercent)}%</div>
                  <div>成本拖累 {formatScore(backtest.metrics.estimatedCostDragPercent)}%</div>
                  <div>benchmark {formatScore(backtest.metrics.benchmarkReturnPercent)}%</div>
                  <div>超额 {formatScore(backtest.metrics.excessReturnPercent)}%</div>
                </div>
              )}
              {backtest.benchmark && (
                <div className="mt-3 rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-400">
                  Benchmark：{backtest.benchmark.primary} · 当前使用 {backtest.benchmark.fallback} 代理 · {backtest.benchmark.note}
                </div>
              )}
              {backtest.tradeConstraintAudit && (
                <div className="mt-2 rounded border border-amber-400/20 bg-amber-400/10 p-2 text-xs text-amber-100">
                  交易约束审计：费用/滑点已计入；仍缺 {(backtest.tradeConstraintAudit.insufficientItems as string[] | undefined)?.join(' / ') || '无'}。
                </div>
              )}
            </Card>
          )}
          {validationRetest && (
            <Card title="验证复测审计" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' } }}>
              <div className="text-sm text-gray-300">状态 {validationRetest.status} · 交易可用 {validationRetest.validationDecision.usableForTradingAdvice ? '是' : '否'}</div>
              <div className="mt-2 grid grid-cols-1 gap-2 text-xs text-gray-400 md:grid-cols-2">
                {Object.entries(validationRetest.validationEvidenceMatrix.checks).map(([key, check]) => (
                  <div key={key} className="rounded border border-white/10 bg-black/10 p-2">
                    <div className="text-white">{key}: {check.status}</div>
                    <div className="mt-1">{check.required}</div>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded border border-rose-400/20 bg-rose-400/10 p-2 text-xs text-rose-100">
                blocker：{validationRetest.validationDecision.primaryBlocker} · 禁止 {validationRetest.validationDecision.prohibitedActions.join(' / ')}
              </div>
              {validationRetest.artifactRef && (
                <div className="mt-2 break-all text-xs text-sky-200">审计落盘：{validationRetest.artifactRef.path}</div>
              )}
            </Card>
          )}
          {validationGapDiagnostics && (
            <Card title="验证缺口诊断" className="bg-[#1a1a2e] border-[surface-border]" styles={{ header: { color: '#fff', borderBottomColor: '#374151' } }}>
              <div className="space-y-3 text-xs text-gray-300">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag color={validationGapDiagnostics.status === 'formal_validation_gap_clear' ? '#34d399' : '#ef4444'}>
                    {validationGapDiagnostics.status}
                  </Tag>
                  <Tag color="#ef4444">阻断 {validationGapDiagnostics.summary.blockingGapCount}</Tag>
                  <Tag color="#fbbf24">警告 {validationGapDiagnostics.summary.warningGapCount}</Tag>
                  <Tag color={validationGapDiagnostics.summary.formalBacktestReady ? '#34d399' : '#ef4444'}>
                    formal backtest {validationGapDiagnostics.summary.formalBacktestReady ? 'ready' : 'blocked'}
                  </Tag>
                  <Tag color="#ef4444">禁止 {validationGapDiagnostics.prohibitedActions.join(' / ')}</Tag>
                </div>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="rounded border border-white/10 bg-black/10 p-2">
                    <div className="text-gray-500">免费源研究</div>
                    <div className="mt-1 text-white">{validationGapDiagnostics.summary.freeSourceResearchReady ? 'ready' : 'blocked'}</div>
                  </div>
                  <div className="rounded border border-white/10 bg-black/10 p-2">
                    <div className="text-gray-500">免费源验证</div>
                    <div className="mt-1 text-white">{validationGapDiagnostics.summary.freeSourceValidationAllowed ? 'allowed' : 'blocked'}</div>
                  </div>
                  <div className="rounded border border-white/10 bg-black/10 p-2">
                    <div className="text-gray-500">总回报审计</div>
                    <div className="mt-1 text-white">{validationGapDiagnostics.summary.totalReturnAuditStatus}</div>
                  </div>
                  <div className="rounded border border-white/10 bg-black/10 p-2">
                    <div className="text-gray-500">验证状态</div>
                    <div className="mt-1 text-white">{validationGapDiagnostics.summary.validationEvidenceStatus}</div>
                  </div>
                </div>
                <div className="space-y-2">
                  {validationGapDiagnostics.gaps.slice(0, 8).map((gap) => (
                    <div key={`${gap.category}-${gap.id}-${gap.affectedGate}`} className="rounded border border-white/10 bg-black/10 p-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Tag color={gap.severity === 'blocker' ? '#ef4444' : gap.severity === 'warning' ? '#fbbf24' : '#38bdf8'}>{gap.severity}</Tag>
                        <span className="text-white">{gap.id}</span>
                        <Tag color="#64748b">{gap.affectedGate}</Tag>
                      </div>
                      <div className="mt-1 text-gray-300">{gap.userMessage}</div>
                      <div className="mt-1 text-gray-500">{gap.developerAction}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  )
}

export default DividendLowVol
