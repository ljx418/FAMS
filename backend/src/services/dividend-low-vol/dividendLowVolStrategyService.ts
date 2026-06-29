import { dataGapSummaryService } from '../analysis/dataGapSummaryService.js'
import { prisma } from '../../db/prisma.js'
import { dividendLowVolScoringService } from './dividendLowVolScoringService.js'
import { buildDividendLowVolRejectionAudit, DIVIDEND_LOW_VOL_REASON_META } from './dividendLowVolRejectionTaxonomy.js'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type {
  DividendLowVolAlertType,
  DividendLowVolDiscipline,
  DividendLowVolFactSet,
  DividendLowVolInput,
} from './dividendLowVolTypes.js'

function round(value: number | undefined, precision = 2) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value))
}

const BLOCKED_REASON_META: Record<string, { label: string; category: 'data' | 'dividend' | 'leader' | 'liquidity' | 'quality' | 'low_volatility' | 'risk' | 'identity' }> = {
  asset_identity_missing: { label: '资产身份无法确认', category: 'identity' },
  unsupported_asset_type: { label: '不是普通股票', category: 'identity' },
  security_status_st_or_risk: { label: 'ST 或退市风险', category: 'identity' },
  security_suspended: { label: '停牌状态', category: 'identity' },
  security_delisted: { label: '已退市或退市整理', category: 'identity' },
  listing_age_less_than_3y: { label: '上市不满 3 年', category: 'identity' },
  dividend_history_insufficient: { label: '最近三年连续现金分红不足', category: 'data' },
  dividend_yield_missing_or_zero: { label: '股息率缺失或为 0', category: 'data' },
  no_cash_dividend_confirmed: { label: '免费公开源未发现近三年现金分红', category: 'dividend' },
  dividend_yield_below_4_percent: { label: 'TTM 股息率低于 4%', category: 'dividend' },
  avg_dividend_yield_3y_below_3_5_percent: { label: '三年平均股息率低于 3.5%', category: 'dividend' },
  industry_leader_score_below_75: { label: '行业龙头分低于 75', category: 'leader' },
  avg_turnover_60d_below_50m: { label: '60 日日均成交额低于 5000 万', category: 'liquidity' },
  market_cap_below_10b: { label: '总市值低于 100 亿', category: 'liquidity' },
  payout_ratio_negative: { label: '分红支付率为负', category: 'quality' },
  payout_ratio_extreme_high: { label: '分红支付率超过 100%', category: 'quality' },
  payout_ratio_below_20: { label: '分红支付率低于 20%', category: 'quality' },
  payout_ratio_above_policy_band: { label: '分红支付率高于策略安全区间', category: 'quality' },
  dps_growth_negative: { label: '每股分红三年增长为负', category: 'quality' },
  dividend_cut_over_20_percent: { label: '分红削减超过 20%', category: 'quality' },
  dps_consecutive_decline: { label: 'DPS 连续下降', category: 'quality' },
  special_dividend_suspected: { label: '疑似一次性特殊分红', category: 'quality' },
  dividend_trap_risk: { label: '高息陷阱风险', category: 'quality' },
  cashflow_dividend_coverage_weak: { label: '经营现金流覆盖不足', category: 'quality' },
  max_drawdown_250d_above_35: { label: '250 日最大回撤超过 35%', category: 'low_volatility' },
  max_drawdown_60d_above_18: { label: '60 日最大回撤超过 18%', category: 'low_volatility' },
  low_vol_score_below_60: { label: '低波动分低于 60', category: 'low_volatility' },
  dividend_low_vol_evidence_insufficient: { label: '策略证据质量不足', category: 'data' },
}

export class DividendLowVolStrategyService {
  readonly schemaVersion = 'dividend.low_vol.factset.v1'
  readonly strategyFamily = 'dividend_low_volatility'
  readonly strategyId = 'dividend_low_vol_leader_v1'

  buildFactSet(input: DividendLowVolInput): DividendLowVolFactSet {
    const metrics = dividendLowVolScoringService.deriveMarketMetrics(input)
    const scores = dividendLowVolScoringService.score(input, metrics)
    const dividendRisk = this.buildDividendRisk(input, metrics)
    const blockedReasons = unique([
      ...dividendLowVolScoringService.deriveBlockedReasons(input, metrics, scores),
      ...(dividendRisk.dividendTrapFlag ? ['dividend_trap_risk'] : []),
      ...(dividendRisk.dividendCutFlag ? ['dividend_cut_over_20_percent'] : []),
      ...(dividendRisk.dpsConsecutiveDecline ? ['dps_consecutive_decline'] : []),
      ...(dividendRisk.specialDividendFlag ? ['special_dividend_suspected'] : []),
    ])
    const financialRiskFlags = unique([
      ...(input.payoutRatio !== undefined && input.payoutRatio > 90 ? ['payout_ratio_high'] : []),
      ...(input.operatingCashFlowToNetProfit !== undefined && input.operatingCashFlowToNetProfit < 0.7 ? ['operating_cashflow_coverage_weak'] : []),
      ...(input.debtToAsset !== undefined && input.debtToAsset > 70 ? ['debt_to_asset_high'] : []),
      ...(metrics.dpsGrowth3y !== undefined && metrics.dpsGrowth3y < 0 ? ['dps_growth_negative'] : []),
      ...dividendRisk.dividendRiskFlags,
    ])
    const evidenceRefs = unique([
      `dividend-low-vol:${input.symbol}:input`,
      ...(input.evidenceRefs || []),
      ...(input.dividendRecords || []).map((item) => item.evidenceRef),
      ...(input.history && input.history.length > 0 ? [`market-history:${input.symbol}:${input.history[0].date}:${input.history.at(-1)?.date}`] : []),
    ])
    const dataVerification = this.buildDataVerification(evidenceRefs)
    const leaderEvidence = this.buildLeaderEvidence(input, evidenceRefs)
    const dividendSourceRefs = this.buildDividendSourceRefs(evidenceRefs)
    const factSetBase = {
      blockedReasons,
      scores,
      timing: {
        price: metrics.latestPrice,
        rsi14: metrics.rsi14,
        highZoneScore: scores.timingScore,
      },
      dividend: {
        dividendYieldPercentile3y: metrics.dividendYieldPercentile3y,
      },
      quality: {
        financialRiskFlags,
      },
    }
    const rawDisposition = dividendLowVolScoringService.deriveDisposition(input, factSetBase)
    const disposition = rawDisposition === 'build_position_plan' && leaderEvidence.status !== 'verified_industry_leader'
      ? 'watch_candidate'
      : rawDisposition
    const alerts = this.buildAlerts(input, metrics, scores, blockedReasons, financialRiskFlags, evidenceRefs, leaderEvidence.status)
    const dataGapReasons = blockedReasons.filter((reason) => this.isDataGapReason(reason, input, evidenceRefs))
    const dataGapSummary = dataGapSummaryService.build({
      blockedReasons: dataGapReasons,
      assetId: input.assetId,
      symbol: input.symbol,
      assetName: input.name,
      assetType: input.assetType || 'stock',
      evidenceRefs,
    })
    const metricCompleteness = this.buildMetricCompleteness(input, metrics, scores)
    const dataTrust = this.buildDataTrust(input, evidenceRefs, dataVerification, metricCompleteness, leaderEvidence, blockedReasons, scores)
    const calculationAudit = this.buildCalculationAudit(metricCompleteness, scores)

    return {
      schemaVersion: this.schemaVersion,
      generatedAt: new Date().toISOString(),
      strategyFamily: this.strategyFamily,
      strategyId: this.strategyId,
      identity: {
        ...(input.assetId ? { assetId: input.assetId } : {}),
        symbol: input.symbol,
        name: input.name,
        market: input.market || 'A_SHARE',
        assetType: input.assetType || 'stock',
        ...(input.industry ? { industry: input.industry } : {}),
        isST: input.isST === true,
        isSuspended: input.isSuspended === true,
        ...(input.listingAgeDays !== undefined ? { listingAgeDays: input.listingAgeDays } : {}),
      },
      dividend: {
        ttmDividendYield: metrics.ttmDividendYield,
        avgDividendYield3y: metrics.avgDividendYield3y,
        dividendYieldPercentile3y: metrics.dividendYieldPercentile3y,
        dividendYears: metrics.dividendYears,
        consecutiveDividendYears: metrics.consecutiveDividendYears,
        cashDividendPerShareHistory: input.dividendRecords || [],
        dpsGrowth3y: metrics.dpsGrowth3y,
        payoutRatio: round(input.payoutRatio),
        dividendCoverageByEarnings: input.payoutRatio && input.payoutRatio > 0 ? round(100 / input.payoutRatio) : undefined,
        dividendCoverageByOperatingCashFlow: round(input.operatingCashFlowToNetProfit),
        specialDividendFlag: dividendRisk.specialDividendFlag,
        dividendCutFlag: dividendRisk.dividendCutFlag,
        dpsConsecutiveDecline: dividendRisk.dpsConsecutiveDecline,
        dividendTrapFlag: dividendRisk.dividendTrapFlag,
        dividendRiskFlags: dividendRisk.dividendRiskFlags,
        sourceRefs: dividendSourceRefs,
      },
      leaderEvidence,
      quality: {
        roe: round(input.roe),
        debtToAsset: round(input.debtToAsset),
        operatingCashFlowToNetProfit: round(input.operatingCashFlowToNetProfit),
        earningsStabilityScore: input.profitGrowth3y === undefined ? undefined : Math.max(0, Math.min(100, 50 + input.profitGrowth3y)),
        financialRiskFlags,
      },
      lowVolatility: {
        volatility60d: metrics.volatility60d,
        volatility120d: metrics.volatility120d,
        volatility250d: metrics.volatility250d,
        maxDrawdown60d: metrics.maxDrawdown60d,
        maxDrawdown250d: metrics.maxDrawdown250d,
        lowVolScore: scores.lowVolScore,
      },
      valuation: {
        pe: round(input.pe),
        pb: round(input.pb),
        dividendYieldHistoricalPercentile: metrics.dividendYieldPercentile3y,
        valuationScore: scores.valuationScore,
      },
      timing: {
        price: metrics.latestPrice,
        ma20: metrics.ma20,
        ma60: metrics.ma60,
        ma120: metrics.ma120,
        ma250: metrics.ma250,
        rsi14: metrics.rsi14,
        drawdownFrom250dHigh: metrics.drawdownFrom250dHigh,
        lowZoneScore: this.lowZoneScore(metrics.dividendYieldPercentile3y, scores.valuationScore, scores.lowVolScore, metrics.drawdownFrom250dHigh),
        highZoneScore: this.highZoneScore(metrics.dividendYieldPercentile3y, scores.valuationScore, metrics.rsi14, metrics.latestPrice, metrics.ma250),
      },
      positionContext: {
        isHolding: input.positionContext?.isHolding === true || (input.positionWeightPercent || 0) > 0,
        ...(input.positionContext?.quantity !== undefined ? { quantity: round(input.positionContext.quantity, 4) } : {}),
        ...(input.positionContext?.marketValue !== undefined ? { marketValue: round(input.positionContext.marketValue, 2) } : {}),
        ...(input.positionContext?.portfolioWeightPercent !== undefined ? { portfolioWeightPercent: round(input.positionContext.portfolioWeightPercent, 2) } : {}),
        ...(input.positionContext?.avgCost !== undefined ? { avgCost: round(input.positionContext.avgCost, 4) } : {}),
        ...(input.positionContext?.unrealizedPnlPercent !== undefined ? { unrealizedPnlPercent: round(input.positionContext.unrealizedPnlPercent, 2) } : {}),
        ...(input.positionContext?.positionId ? { positionId: input.positionContext.positionId } : {}),
        researchTargetWeightPercent: this.researchTargetWeight(scores),
        formalTargetWeightPercent: 0,
      },
      scores,
      dataVerification,
      metricCompleteness,
      dataTrust,
      calculationAudit,
      candidateGrade: this.candidateGrade(scores, blockedReasons),
      disposition,
      alerts,
      tradingDiscipline: this.buildDiscipline(disposition),
      blockedReasons,
      dataGapSummary,
      evidenceRefs,
    }
  }

  buildCandidatePool(inputs: DividendLowVolInput[], options: { universeSummary?: Record<string, unknown> } = {}) {
    const candidates = inputs
      .map((input) => this.buildFactSet(input))
      .sort((left, right) => right.scores.evidenceAdjustedScore - left.scores.evidenceAdjustedScore)
    const alertSummary = this.buildAlertSummary(candidates)
    const rejectionSummary = this.buildRejectionSummary(candidates)
    const leaderAuditSummary = this.buildLeaderAuditSummary(candidates)
    const metricCompletenessSummary = this.buildMetricCompletenessSummary(candidates)
    const dataTrustSummary = this.buildDataTrustPoolSummary(candidates)
    const calculationAuditSummary = this.buildCalculationAuditPoolSummary(candidates)
    return {
      schemaVersion: 'dividend.low_vol.candidate_pool.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: this.strategyFamily,
      strategyId: this.strategyId,
      total: candidates.length,
      eligibleResearchCandidates: candidates.filter((item) => !['avoid', 'data_insufficient'].includes(item.disposition)).length,
      alertSummary,
      rejectionSummary,
      leaderAuditSummary,
      metricCompletenessSummary,
      dataTrustSummary,
      calculationAuditSummary,
      universeSummary: options.universeSummary,
      candidates,
      policy: {
        allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      },
    }
  }

  async persistCandidatePool(userId: string, inputs: DividendLowVolInput[], options: { sourceOperationId?: string; tradeDate?: string; universeSummary?: Record<string, unknown> } = {}) {
    const pool = this.buildCandidatePool(inputs, { universeSummary: options.universeSummary })
    const tradeDate = new Date(`${(options.tradeDate || new Date().toISOString().slice(0, 10)).slice(0, 10)}T00:00:00.000Z`)
    for (const candidate of pool.candidates) {
      await prisma.dividendLowVolDaily.upsert({
        where: {
          userId_symbol_tradeDate_strategyId: {
            userId,
            symbol: candidate.identity.symbol,
            tradeDate,
            strategyId: candidate.strategyId,
          },
        },
        create: {
          userId,
          assetId: candidate.identity.assetId,
          symbol: candidate.identity.symbol,
          name: candidate.identity.name,
          market: candidate.identity.market,
          tradeDate,
          strategyFamily: candidate.strategyFamily,
          strategyId: candidate.strategyId,
          ttmDividendYield: candidate.dividend.ttmDividendYield,
          avgDividendYield3y: candidate.dividend.avgDividendYield3y,
          dividendYieldPercentile3y: candidate.dividend.dividendYieldPercentile3y,
          consecutiveDividendYears: candidate.dividend.consecutiveDividendYears,
          payoutRatio: candidate.dividend.payoutRatio,
          dividendScore: candidate.scores.dividendScore,
          dividendQualityScore: candidate.scores.dividendQualityScore,
          lowVolScore: candidate.scores.lowVolScore,
          valuationScore: candidate.scores.valuationScore,
          lowZoneScore: candidate.timing.lowZoneScore,
          highZoneScore: candidate.timing.highZoneScore,
          evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
          disposition: candidate.disposition,
          blockedReasonsJson: JSON.stringify(candidate.blockedReasons),
          dataGapSummaryJson: JSON.stringify(candidate.dataGapSummary),
          evidenceRefsJson: JSON.stringify(candidate.evidenceRefs),
          alertsJson: JSON.stringify(candidate.alerts),
          disciplineJson: JSON.stringify(candidate.tradingDiscipline),
          factsetJson: JSON.stringify(candidate),
          sourceOperationId: options.sourceOperationId,
          generatedAt: new Date(candidate.generatedAt),
        },
        update: {
          name: candidate.identity.name,
          market: candidate.identity.market,
          ttmDividendYield: candidate.dividend.ttmDividendYield,
          avgDividendYield3y: candidate.dividend.avgDividendYield3y,
          dividendYieldPercentile3y: candidate.dividend.dividendYieldPercentile3y,
          consecutiveDividendYears: candidate.dividend.consecutiveDividendYears,
          payoutRatio: candidate.dividend.payoutRatio,
          dividendScore: candidate.scores.dividendScore,
          dividendQualityScore: candidate.scores.dividendQualityScore,
          lowVolScore: candidate.scores.lowVolScore,
          valuationScore: candidate.scores.valuationScore,
          lowZoneScore: candidate.timing.lowZoneScore,
          highZoneScore: candidate.timing.highZoneScore,
          evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
          disposition: candidate.disposition,
          blockedReasonsJson: JSON.stringify(candidate.blockedReasons),
          dataGapSummaryJson: JSON.stringify(candidate.dataGapSummary),
          evidenceRefsJson: JSON.stringify(candidate.evidenceRefs),
          alertsJson: JSON.stringify(candidate.alerts),
          disciplineJson: JSON.stringify(candidate.tradingDiscipline),
          factsetJson: JSON.stringify(candidate),
          sourceOperationId: options.sourceOperationId,
          generatedAt: new Date(candidate.generatedAt),
        },
      })
    }
    return pool
  }

  async getLatestCandidatePool(userId: string, options: { limit?: number; symbols?: string[]; scope?: 'latest_trade_date' | 'all_latest_by_symbol' } = {}) {
    const quarantinedSourceOperationIds = await this.getQuarantinedSourceOperationIds()
    const latest = await prisma.dividendLowVolDaily.findFirst({
      where: {
        userId,
        strategyId: this.strategyId,
        ...(quarantinedSourceOperationIds.length > 0 ? { sourceOperationId: { notIn: quarantinedSourceOperationIds } } : {}),
      },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    if (!latest) {
      return this.buildCandidatePool((options.symbols || []).map((symbol) => ({
        symbol,
        name: symbol,
        market: 'A_SHARE',
        assetType: 'stock',
        evidenceRefs: [`dividend-low-vol:manual-symbol:${symbol}`],
      })))
    }
    const maxLimit = Math.max(1, Math.min(Number(process.env.FAMS_DIVIDEND_LOW_VOL_MAX_LIMIT || 6000), options.limit || 20))
    const scope = options.scope || 'latest_trade_date'
    const rows = scope === 'all_latest_by_symbol'
      ? await this.findLatestRowsBySymbol(userId, {
        limit: maxLimit,
        symbols: options.symbols,
        quarantinedSourceOperationIds,
      })
      : await prisma.dividendLowVolDaily.findMany({
        where: {
          userId,
          strategyId: this.strategyId,
          ...(quarantinedSourceOperationIds.length > 0 ? { sourceOperationId: { notIn: quarantinedSourceOperationIds } } : {}),
          tradeDate: latest.tradeDate,
          ...(options.symbols && options.symbols.length > 0 ? { symbol: { in: options.symbols } } : {}),
        },
        orderBy: { evidenceAdjustedScore: 'desc' },
        take: maxLimit,
      })
    const candidates = rows
      .map((row) => this.parseJson<DividendLowVolFactSet | null>(row.factsetJson, null))
      .filter((item): item is DividendLowVolFactSet => Boolean(item))
      .map((item) => ({
        ...item,
        dataVerification: item.dataVerification || this.buildDataVerification(item.evidenceRefs || []),
        metricCompleteness: item.metricCompleteness || this.buildMetricCompletenessFromFactSet(item),
      }))
      .map((item) => ({
        ...item,
        dataTrust: item.dataTrust || this.buildDataTrustFromFactSet(item),
        calculationAudit: item.calculationAudit || this.buildCalculationAudit(item.metricCompleteness, item.scores),
      }))
    return {
      schemaVersion: 'dividend.low_vol.candidate_pool.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: this.strategyFamily,
      strategyId: this.strategyId,
      total: candidates.length,
      eligibleResearchCandidates: candidates.filter((item) => !['avoid', 'data_insufficient'].includes(item.disposition)).length,
      alertSummary: this.buildAlertSummary(candidates),
      rejectionSummary: this.buildRejectionSummary(candidates),
      leaderAuditSummary: this.buildLeaderAuditSummary(candidates),
      metricCompletenessSummary: this.buildMetricCompletenessSummary(candidates),
      dataTrustSummary: this.buildDataTrustPoolSummary(candidates),
      calculationAuditSummary: this.buildCalculationAuditPoolSummary(candidates),
      candidates,
      policy: {
        allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      },
      source: {
        persisted: true,
        tradeDate: latest.tradeDate.toISOString().slice(0, 10),
        scope,
        excludedSourceOperationIds: quarantinedSourceOperationIds,
      },
    }
  }

  private async findLatestRowsBySymbol(userId: string, options: { limit: number; symbols?: string[]; quarantinedSourceOperationIds?: string[] }) {
    const rows = await prisma.dividendLowVolDaily.findMany({
      where: {
        userId,
        strategyId: this.strategyId,
        ...(options.quarantinedSourceOperationIds && options.quarantinedSourceOperationIds.length > 0 ? { sourceOperationId: { notIn: options.quarantinedSourceOperationIds } } : {}),
        ...(options.symbols && options.symbols.length > 0 ? { symbol: { in: options.symbols } } : {}),
      },
      orderBy: [
        { symbol: 'asc' },
        { tradeDate: 'desc' },
        { generatedAt: 'desc' },
      ],
      take: Math.max(options.limit * 3, options.limit),
    })
    const latestBySymbol = new Map<string, (typeof rows)[number]>()
    for (const row of rows) {
      if (!latestBySymbol.has(row.symbol)) latestBySymbol.set(row.symbol, row)
      if (latestBySymbol.size >= options.limit && (!options.symbols || options.symbols.length === 0)) break
    }
    return Array.from(latestBySymbol.values())
      .sort((left, right) => right.evidenceAdjustedScore - left.evidenceAdjustedScore)
      .slice(0, options.limit)
  }

  private async getQuarantinedSourceOperationIds() {
    const fromEnv = (process.env.FAMS_DIVIDEND_LOW_VOL_QUARANTINED_SOURCE_OPERATION_IDS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/gpt-audit')
    const quarantinePath = resolve(packageDir, 'dividend-low-vol-quarantined-source-operations.json')
    const fromFile = await readFile(quarantinePath, 'utf8')
      .then((content) => {
        const parsed = JSON.parse(content)
        if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === 'string')
        if (Array.isArray(parsed.sourceOperationIds)) {
          return parsed.sourceOperationIds.filter((item: unknown): item is string => typeof item === 'string')
        }
        return []
      })
      .catch(() => [])
    return unique([...fromEnv, ...fromFile])
  }

  async getCandidateHistory(userId: string, symbol: string, options: { limit?: number } = {}) {
    const rows = await prisma.dividendLowVolDaily.findMany({
      where: {
        userId,
        strategyId: this.strategyId,
        symbol,
      },
      orderBy: { tradeDate: 'desc' },
      take: Math.max(1, Math.min(120, options.limit || 30)),
    })
    return {
      schemaVersion: 'dividend.low_vol.candidate_history.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: this.strategyFamily,
      strategyId: this.strategyId,
      symbol,
      total: rows.length,
      history: rows.map((row) => ({
        tradeDate: row.tradeDate.toISOString().slice(0, 10),
        ttmDividendYield: row.ttmDividendYield,
        avgDividendYield3y: row.avgDividendYield3y,
        dividendYieldPercentile3y: row.dividendYieldPercentile3y,
        consecutiveDividendYears: row.consecutiveDividendYears,
        payoutRatio: row.payoutRatio,
        dividendScore: row.dividendScore,
        dividendQualityScore: row.dividendQualityScore,
        lowVolScore: row.lowVolScore,
        valuationScore: row.valuationScore,
        lowZoneScore: row.lowZoneScore,
        highZoneScore: row.highZoneScore,
        evidenceAdjustedScore: row.evidenceAdjustedScore,
        disposition: row.disposition,
        blockedReasons: this.parseJson<string[]>(row.blockedReasonsJson, []),
        alerts: this.parseJson<unknown[]>(row.alertsJson, []),
        sourceOperationId: row.sourceOperationId,
        generatedAt: row.generatedAt.toISOString(),
      })),
    }
  }

  async buildGptAuditPackage(userId: string, options: { limit?: number } = {}) {
    const pool = await this.getLatestCandidatePool(userId, { limit: options.limit || 200 })
    const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/gpt-audit')
    await mkdir(packageDir, { recursive: true })
    const generatedAt = new Date().toISOString()
    const trackerPath = resolve(packageDir, 'dividend-low-vol-development-tracker.json')
    const auditBacklogPath = resolve(packageDir, 'dividend-low-vol-audit-backlog.json')
    const tracker = await readFile(trackerPath, 'utf8').then((content) => JSON.parse(content)).catch(() => null)
    const auditBacklog = await readFile(auditBacklogPath, 'utf8').then((content) => JSON.parse(content)).catch(() => null)
    const validationArtifacts = await readdir(packageDir)
      .then((files) => files.filter((file) => file.startsWith('dividend-low-vol-validation-retest-')).sort().slice(-5))
      .catch(() => [])
    const payload = {
      schemaVersion: 'dividend.low_vol.gpt_audit_package.v1',
      generatedAt,
      objective: 'Audit the dividend_low_vol_leader_v1 strategy implementation, data completeness, rejection reasons, alert gates, backtest smoke result, and trading-action safety boundaries.',
      auditInstructions: [
        'Verify that the strategy does not output formal ADD / REDUCE / AUTO_TRADE without validation evidence.',
        'Review whether rejectionSummary separates data gaps from hard-rule failures correctly.',
        'Check whether evidenceRefs and dataVerification are sufficient for research-only output.',
        'Review remaining gaps around leader ranking, financial data completeness, dividend-adjusted backtest, and strategy validation evidence.',
      ],
      strategyBoundary: {
        allowedActions: pool.policy.allowedActions,
        prohibitedActions: pool.policy.prohibitedActions,
        note: 'This package is for GPT audit. It is not a trading recommendation.',
      },
      latestCandidatePool: pool,
      developmentTracker: tracker,
      auditBacklog,
      latestValidationArtifacts: validationArtifacts,
      knownIncompleteItems: [
        'Full 5849-stock scan is supported via operation input but operationally should run queued with cache preheat for large limits.',
        'LeaderScore still needs complete revenue, net profit, ROE percentile and market-share data beyond market-cap/seed fallback.',
        'Backtest remains a smoke/research backtest and is not dividend-adjusted validation evidence.',
        'Dividend-specific OOS, walk-forward, parameter sensitivity and group stability validation are not yet passed.',
        'Formal trade actions remain prohibited by strategy policy in this module.',
      ],
    }
    const fileName = `dividend-low-vol-gpt-audit-${generatedAt.replace(/[:.]/g, '-')}.json`
    const path = resolve(packageDir, fileName)
    await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
    return {
      schemaVersion: 'dividend.low_vol.gpt_audit_package_ref.v1',
      generatedAt,
      path,
      fileName,
      candidateCount: pool.total,
      eligibleResearchCandidates: pool.eligibleResearchCandidates,
      rejectionSummary: (pool as any).rejectionSummary,
      policy: pool.policy,
    }
  }

  private parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  private buildDataVerification(evidenceRefs: string[]): DividendLowVolFactSet['dataVerification'] {
    const providerRefs = evidenceRefs.filter((ref) => ref.startsWith('quote-list-canonical-provider:'))
    const warnings = evidenceRefs.filter((ref) => ref.startsWith('warning:'))
    const crossCheckedFields = [
      ...(evidenceRefs.some((ref) => ref.startsWith('quote-list-canonical:')) ? ['identity_industry_market_cap'] : []),
      ...(evidenceRefs.some((ref) => ref.startsWith('market-bar-canonical:')) && evidenceRefs.some((ref) => ref.startsWith('market-feature-daily:')) ? ['price_history_feature'] : []),
      ...(evidenceRefs.some((ref) => ref.startsWith('dividend:eastmoney:')) || evidenceRefs.some((ref) => ref.startsWith('dividend:public-seed:')) ? ['dividend_history'] : []),
      ...(evidenceRefs.some((ref) => ref.startsWith('fundamental:eastmoney:')) ? ['fundamental_snapshot'] : []),
      ...(evidenceRefs.some((ref) => ref.startsWith('leader:')) ? ['industry_leader'] : []),
    ]
    const providerCount = new Set(providerRefs.map((ref) => ref.split(':').at(-1) || ref)).size
    const fallbackUsed = evidenceRefs.some((ref) => ref.includes('using public') || ref.includes('public-seed') || ref.includes('leader-seed'))
    const status = crossCheckedFields.length < 3
      ? 'insufficient'
      : fallbackUsed
        ? 'provider_fallback'
        : providerCount >= 2
          ? 'cross_checked'
          : 'single_source'
    return {
      status,
      providerCount,
      primaryProvider: providerRefs[0]?.split(':').at(-1) || (fallbackUsed ? 'fallback_seed' : undefined),
      freshnessStatus: evidenceRefs.some((ref) => ref.startsWith('market-bar-canonical:') || ref.startsWith('market-feature-daily:')) ? 'fresh' : 'unknown',
      crossCheckedFields,
      warningCount: warnings.length,
      warnings: warnings.slice(0, 20),
      sourceRefs: evidenceRefs.filter((ref) => !ref.startsWith('warning:')).slice(0, 30),
    }
  }

  private buildLeaderEvidence(input: DividendLowVolInput, evidenceRefs: string[]): DividendLowVolFactSet['leaderEvidence'] {
    const leaderRefs = evidenceRefs.filter((ref) => ref.includes('leader') || ref.includes('industry') || ref.includes('rank') || ref.includes('quote-list-canonical'))
    const hasEvidence = (patterns: string[]) => leaderRefs.some((ref) => patterns.some((pattern) => ref.includes(pattern)))
    const marketCapRankVerified = input.marketCapRankScore !== undefined && hasEvidence(['market_cap_rank', 'marketCapRank', 'daily_basic_market_cap'])
    const revenueRankVerified = input.revenueRankScore !== undefined && hasEvidence(['revenue_rank', 'revenueRank', 'income_revenue'])
    const netProfitRankVerified = input.netProfitRankScore !== undefined && hasEvidence(['net_profit_rank', 'netProfitRank', 'income_net_profit'])
    const roePercentileVerified = input.roeIndustryPercentile !== undefined && input.roeIndustryPercentile >= 60 && hasEvidence(['roe_percentile', 'roeIndustryPercentile', 'fina_indicator_roe'])
    const providerCrossCheckedIndustryRank = leaderRefs.some((ref) => ref.includes('provider_cross_checked_industry_rank'))
    const fullFreeSourceRankEvidence = marketCapRankVerified
      && (revenueRankVerified || netProfitRankVerified)
      && roePercentileVerified
      && providerCrossCheckedIndustryRank
      && leaderRefs.some((ref) => ref.includes('free-source-industry-rank'))
    const seedFallbackUsed = !fullFreeSourceRankEvidence && leaderRefs.some((ref) => ref.includes('seed') || ref.includes('fallback') || ref.includes('public'))
    const missingFields = unique([
      ...(!input.industry ? ['industry'] : []),
      ...(!marketCapRankVerified ? ['market_cap_rank'] : []),
      ...(!(revenueRankVerified || netProfitRankVerified) ? ['revenue_or_net_profit_rank'] : []),
      ...(!roePercentileVerified ? ['roe_industry_percentile'] : []),
      ...(!providerCrossCheckedIndustryRank ? ['provider_cross_checked_industry_rank'] : []),
    ])
    const leaderScore = input.leaderScore || 0
    const canVerify = missingFields.length === 0 && leaderScore >= 75 && !seedFallbackUsed
    const status = canVerify
      ? 'verified_industry_leader'
      : seedFallbackUsed
        ? 'leader_partial'
        : leaderScore < 75 && missingFields.length <= 1
        ? 'not_leader'
        : leaderScore >= 75
          ? 'leader_candidate'
          : 'insufficient'
    return {
      status,
      marketCapRankVerified,
      revenueRankVerified,
      netProfitRankVerified,
      roePercentileVerified,
      providerCrossCheckedIndustryRank,
      seedFallbackUsed,
      evidenceRefs: leaderRefs.slice(0, 30),
      missingFields,
      note: status === 'verified_industry_leader'
        ? 'Industry leader status has rank and cross-check evidence.'
        : 'Market-cap score, seed fallback or single-provider evidence is not enough for verified_industry_leader.',
    }
  }

  private buildDividendSourceRefs(evidenceRefs: string[]) {
    const dividendRefs = evidenceRefs.filter((ref) => ref.includes('dividend'))
    const fundamentalRefs = evidenceRefs.filter((ref) => ref.includes('fundamental') || ref.includes('annual-report') || ref.includes('cashflow') || ref.includes('income'))
    const formalProviderRefs = evidenceRefs.filter((ref) => ref.includes('tushare') || ref.includes('sse') || ref.includes('szse') || ref.includes('provider-contract'))
    const fallbackRefs = evidenceRefs.filter((ref) => ref.includes('public-seed') || ref.includes('fixture') || ref.includes('fallback'))
    const missingEvidenceFields = unique([
      ...(dividendRefs.length === 0 ? ['dividend_history'] : []),
      ...(dividendRefs.length === 0 ? ['ttm_dividend_yield'] : []),
      ...(fundamentalRefs.length === 0 ? ['payout_ratio'] : []),
      ...(dividendRefs.length === 0 ? ['dps_growth'] : []),
      ...(unique([...dividendRefs, ...fundamentalRefs]).length === 0 ? ['dividend_risk'] : []),
    ])
    const crossCheckStatus: NonNullable<DividendLowVolFactSet['dividend']['sourceRefs']>['crossCheckStatus'] = formalProviderRefs.length >= 2
      ? 'cross_checked'
      : formalProviderRefs.length === 1
        ? 'single_source'
        : fallbackRefs.length > 0
          ? 'fallback_seed'
          : missingEvidenceFields.length > 0
            ? 'insufficient'
            : 'single_source'
    return {
      dividendHistory: dividendRefs.slice(0, 20),
      ttmDividendYield: dividendRefs.slice(0, 20),
      payoutRatio: fundamentalRefs.slice(0, 20),
      dpsGrowth: dividendRefs.slice(0, 20),
      dividendRisk: unique([...dividendRefs, ...fundamentalRefs]).slice(0, 30),
      crossCheckStatus,
      missingEvidenceFields,
    }
  }

  private buildDividendRisk(input: DividendLowVolInput, metrics: ReturnType<typeof dividendLowVolScoringService.deriveMarketMetrics>) {
    const records = [...(input.dividendRecords || [])]
      .filter((record) => record.dividendPerShare > 0)
      .sort((left, right) => left.year - right.year)
    const last = records.at(-1)
    const previous = records.at(-2)
    const dividendCutFlag = Boolean(last && previous && last.dividendPerShare < previous.dividendPerShare * 0.8)
    const recentThree = records.slice(-3)
    const dpsConsecutiveDecline = recentThree.length >= 3
      && recentThree[0].dividendPerShare > recentThree[1].dividendPerShare
      && recentThree[1].dividendPerShare > recentThree[2].dividendPerShare
    const previousThree = records.slice(-4, -1)
    const previousAvg = previousThree.length > 0 ? previousThree.reduce((sum, item) => sum + item.dividendPerShare, 0) / previousThree.length : undefined
    const specialDividendFlag = Boolean(last && previousAvg && last.dividendPerShare > previousAvg * 2)
    const dividendTrapFlag = Boolean(
      (metrics.ttmDividendYield !== undefined && metrics.ttmDividendYield >= 8 && (input.profitGrowth3y || 0) < -20)
      || (metrics.ttmDividendYield !== undefined && metrics.ttmDividendYield >= 8 && input.operatingCashFlowToNetProfit !== undefined && input.operatingCashFlowToNetProfit < 0.8)
      || (input.payoutRatio !== undefined && input.payoutRatio > 100)
      || dpsConsecutiveDecline
      || specialDividendFlag,
    )
    const dividendRiskFlags = unique([
      ...(dividendCutFlag ? ['dividend_cut_over_20_percent'] : []),
      ...(dpsConsecutiveDecline ? ['dps_consecutive_decline'] : []),
      ...(specialDividendFlag ? ['special_dividend_suspected'] : []),
      ...(dividendTrapFlag ? ['dividend_trap_risk'] : []),
    ])
    return {
      specialDividendFlag,
      dividendCutFlag,
      dpsConsecutiveDecline,
      dividendTrapFlag,
      dividendRiskFlags,
    }
  }

  private buildLeaderAuditSummary(candidates: DividendLowVolFactSet[]) {
    const total = candidates.length
    const hasLeaderSeed = candidates.filter((candidate) => candidate.evidenceRefs.some((ref) => ref.includes('leader_seed') || ref.startsWith('leader:'))).length
    const hasCanonical = candidates.filter((candidate) => candidate.evidenceRefs.some((ref) => ref.startsWith('quote-list-canonical:'))).length
    const leaderPassed = candidates.filter((candidate) => (candidate.scores.leaderScore || 0) >= 75).length
    const seedFallbackWarnings = candidates.filter((candidate) => candidate.evidenceRefs.some((ref) => ref.includes('using public leader seed cache'))).length
    const byStatus = candidates.reduce<Record<string, number>>((counts, candidate) => {
      const status = candidate.leaderEvidence?.status || 'insufficient'
      counts[status] = (counts[status] || 0) + 1
      return counts
    }, {})
    const verifiedResearchCount = byStatus.verified_industry_leader || 0
    const candidatesWithRankEvidence = candidates.filter((candidate) => candidate.leaderEvidence?.evidenceRefs.some((ref) => ref.includes('free-source-industry-rank'))).length
    return {
      schemaVersion: 'dividend.low_vol.leader_audit_summary.v1',
      total,
      leaderPassed,
      verifiedResearchCount,
      leaderCandidateCount: byStatus.leader_candidate || 0,
      leaderPartialCount: byStatus.leader_partial || 0,
      notLeaderCount: byStatus.not_leader || 0,
      insufficientCount: byStatus.insufficient || 0,
      byStatus,
      canonicalIdentityCoveragePercent: total > 0 ? round((hasCanonical / total) * 100) : 0,
      leaderEvidenceCoveragePercent: total > 0 ? round((hasLeaderSeed / total) * 100) : 0,
      freeSourceRankEvidenceCoveragePercent: total > 0 ? round((candidatesWithRankEvidence / total) * 100) : 0,
      seedFallbackCount: seedFallbackWarnings,
      missingRevenueNetProfitRankCount: candidates.filter((candidate) => !candidate.evidenceRefs.some((ref) => ref.includes('revenue_rank') || ref.includes('net_profit_rank'))).length,
      status: seedFallbackWarnings > 0 || total === 0 ? 'partial' : 'available',
      auditNote: 'verified_industry_leader here means free-source research verification with market-cap/revenue-or-profit/ROE/cross-check evidence. It does not unlock formal ADD/REDUCE/AUTO_TRADE.',
    }
  }

  private buildMetricCompleteness(
    input: DividendLowVolInput,
    metrics: ReturnType<typeof dividendLowVolScoringService.deriveMarketMetrics>,
    scores: ReturnType<typeof dividendLowVolScoringService.score>,
  ): DividendLowVolFactSet['metricCompleteness'] {
    const financialIndustry = /银行|保险|货币金融|证券/.test(input.industry || '')
    const requiredEntries: Array<[string, unknown]> = [
      ['identity.symbol', input.symbol],
      ['identity.name', input.name],
      ['identity.industry', input.industry],
      ['timing.price', metrics.latestPrice],
      ['dividend.ttmDividendYield', metrics.ttmDividendYield],
      ['dividend.avgDividendYield3y', metrics.avgDividendYield3y],
      ['dividend.dividendYieldPercentile3y', metrics.dividendYieldPercentile3y],
      ['dividend.consecutiveDividendYears', metrics.consecutiveDividendYears],
      ['dividend.payoutRatio', input.payoutRatio],
      ['scores.evidenceAdjustedScore', scores.evidenceAdjustedScore],
      ['scores.totalResearchScore', scores.totalResearchScore],
      ['scores.leaderScore', scores.leaderScore],
      ['scores.dividendScore', scores.dividendScore],
      ['scores.dividendQualityScore', scores.dividendQualityScore],
      ['scores.lowVolScore', scores.lowVolScore],
      ['scores.valuationScore', scores.valuationScore],
      ['scores.financialRiskScore', scores.financialRiskScore],
      ['timing.lowZoneScore', this.lowZoneScore(metrics.dividendYieldPercentile3y, scores.valuationScore, scores.lowVolScore, metrics.drawdownFrom250dHigh)],
      ['timing.highZoneScore', this.highZoneScore(metrics.dividendYieldPercentile3y, scores.valuationScore, metrics.rsi14, metrics.latestPrice, metrics.ma250)],
      ['timing.rsi14', metrics.rsi14],
      ['lowVolatility.volatility120d', metrics.volatility120d],
      ['lowVolatility.maxDrawdown60d', metrics.maxDrawdown60d],
      ['quality.roe', input.roe],
      ...(!financialIndustry ? [['quality.operatingCashFlowToNetProfit', input.operatingCashFlowToNetProfit] as [string, unknown]] : []),
      ['valuation.pe', input.pe],
      ['valuation.pb', input.pb],
    ]
    const hasValue = (value: unknown) => {
      if (typeof value === 'number') return Number.isFinite(value)
      return value !== undefined && value !== null && value !== ''
    }
    const missingMetrics = requiredEntries
      .filter(([, value]) => !hasValue(value))
      .map(([key]) => key)
    const displayReady = missingMetrics.length === 0
    return {
      status: displayReady ? 'complete' : 'incomplete',
      displayReady,
      requiredMetrics: requiredEntries.map(([key]) => key),
      missingMetrics: unique(missingMetrics),
      completeMetricCount: requiredEntries.length - missingMetrics.length,
      totalMetricCount: requiredEntries.length,
      note: displayReady
        ? 'All core metrics required by the Dividend Low Volatility page are present; hard-rule failures and risk flags remain visible through disposition, blockedReasons, and dataGapSummary.'
        : 'This row is excluded from the complete strategy table until missing core metrics are resolved.',
    }
  }

  private isDataGapReason(reason: string, input: DividendLowVolInput, evidenceRefs: string[]) {
    if (reason === 'industry_leader_score_below_75') {
      const hasRankEvidence = input.revenueRankScore !== undefined || input.netProfitRankScore !== undefined || input.roeIndustryPercentile !== undefined
      const hasFormalRankRefs = evidenceRefs.some((ref) => (
        ref.includes('revenue_rank')
        || ref.includes('net_profit_rank')
        || ref.includes('roe_percentile')
        || ref.includes('provider_cross_checked_industry_rank')
      ))
      return !hasRankEvidence && !hasFormalRankRefs
    }
    return DIVIDEND_LOW_VOL_REASON_META[reason]?.defaultType === 'data_gap'
  }

  private buildMetricCompletenessSummary(candidates: DividendLowVolFactSet[]) {
    const complete = candidates.filter((candidate) => candidate.metricCompleteness?.displayReady).length
    const missingCounts = new Map<string, number>()
    for (const candidate of candidates) {
      if (candidate.metricCompleteness?.displayReady) continue
      const missing = candidate.metricCompleteness?.missingMetrics || ['metricCompleteness.missing']
      for (const metric of missing) missingCounts.set(metric, (missingCounts.get(metric) || 0) + 1)
    }
    return {
      schemaVersion: 'dividend.low_vol.metric_completeness_summary.v1',
      total: candidates.length,
      completeDisplayReadyCount: complete,
      incompleteDisplayCount: candidates.length - complete,
      completenessPercent: candidates.length > 0 ? round((complete / candidates.length) * 100) : 0,
      topMissingMetrics: Array.from(missingCounts.entries())
        .map(([metric, count]) => ({ metric, count }))
        .sort((left, right) => right.count - left.count)
        .slice(0, 12),
      note: 'Main frontend strategy table should only display completeDisplayReady rows. Incomplete rows remain available through audit summaries, not as filled strategy metrics.',
    }
  }

  private buildMetricCompletenessFromFactSet(candidate: DividendLowVolFactSet): DividendLowVolFactSet['metricCompleteness'] {
    const financialIndustry = /银行|保险|货币金融|证券/.test(candidate.identity.industry || '')
    const requiredEntries: Array<[string, unknown]> = [
      ['identity.symbol', candidate.identity.symbol],
      ['identity.name', candidate.identity.name],
      ['identity.industry', candidate.identity.industry],
      ['timing.price', candidate.timing.price],
      ['dividend.ttmDividendYield', candidate.dividend.ttmDividendYield],
      ['dividend.avgDividendYield3y', candidate.dividend.avgDividendYield3y],
      ['dividend.dividendYieldPercentile3y', candidate.dividend.dividendYieldPercentile3y],
      ['dividend.consecutiveDividendYears', candidate.dividend.consecutiveDividendYears],
      ['dividend.payoutRatio', candidate.dividend.payoutRatio],
      ['scores.evidenceAdjustedScore', candidate.scores.evidenceAdjustedScore],
      ['scores.totalResearchScore', candidate.scores.totalResearchScore],
      ['scores.leaderScore', candidate.scores.leaderScore],
      ['scores.dividendScore', candidate.scores.dividendScore],
      ['scores.dividendQualityScore', candidate.scores.dividendQualityScore],
      ['scores.lowVolScore', candidate.scores.lowVolScore],
      ['scores.valuationScore', candidate.scores.valuationScore],
      ['scores.financialRiskScore', candidate.scores.financialRiskScore],
      ['timing.lowZoneScore', candidate.timing.lowZoneScore],
      ['timing.highZoneScore', candidate.timing.highZoneScore],
      ['timing.rsi14', candidate.timing.rsi14],
      ['lowVolatility.volatility120d', candidate.lowVolatility.volatility120d],
      ['lowVolatility.maxDrawdown60d', candidate.lowVolatility.maxDrawdown60d],
      ['quality.roe', candidate.quality.roe],
      ...(!financialIndustry ? [['quality.operatingCashFlowToNetProfit', candidate.quality.operatingCashFlowToNetProfit] as [string, unknown]] : []),
      ['valuation.pe', candidate.valuation.pe],
      ['valuation.pb', candidate.valuation.pb],
    ]
    const hasValue = (value: unknown) => {
      if (typeof value === 'number') return Number.isFinite(value)
      return value !== undefined && value !== null && value !== ''
    }
    const missingMetrics = requiredEntries
      .filter(([, value]) => !hasValue(value))
      .map(([key]) => key)
    const displayReady = missingMetrics.length === 0
    return {
      status: displayReady ? 'complete' : 'incomplete',
      displayReady,
      requiredMetrics: requiredEntries.map(([key]) => key),
      missingMetrics: unique(missingMetrics),
      completeMetricCount: requiredEntries.length - missingMetrics.length,
      totalMetricCount: requiredEntries.length,
      note: displayReady
        ? 'All core metrics required by the Dividend Low Volatility page are present; hard-rule failures and risk flags remain visible through disposition, blockedReasons, and dataGapSummary.'
        : 'This row is excluded from the complete strategy table until missing core metrics are resolved.',
    }
  }

  private buildDataTrust(
    input: DividendLowVolInput,
    evidenceRefs: string[],
    dataVerification: DividendLowVolFactSet['dataVerification'],
    metricCompleteness: DividendLowVolFactSet['metricCompleteness'],
    leaderEvidence: DividendLowVolFactSet['leaderEvidence'],
    blockedReasons: string[],
    scores: ReturnType<typeof dividendLowVolScoringService.score>,
  ): DividendLowVolFactSet['dataTrust'] {
    const refs = evidenceRefs.join(' ').toLowerCase()
    const hasFormalProvider = refs.includes('tushare') || refs.includes('formal_provider') || refs.includes('formal-provider')
    const hasFreeSource = refs.includes('free') || refs.includes('eastmoney') || refs.includes('sohu') || refs.includes('public') || refs.includes('canonical') || refs.includes('market-history')
    const hasFallback = refs.includes('fallback') || refs.includes('seed') || dataVerification.status === 'provider_fallback' || leaderEvidence.seedFallbackUsed
    const providerMode: DividendLowVolFactSet['dataTrust']['providerMode'] = hasFormalProvider && hasFreeSource
      ? 'mixed'
      : hasFormalProvider
        ? 'formal_provider'
        : hasFreeSource
          ? 'free_source_research'
          : 'unknown'
    const completenessPercent = metricCompleteness.totalMetricCount > 0
      ? ((metricCompleteness.completeMetricCount / metricCompleteness.totalMetricCount) * 100)
      : 0
    const coverageStatus: DividendLowVolFactSet['dataTrust']['coverageStatus'] = metricCompleteness.displayReady
      ? 'complete'
      : completenessPercent >= 70
        ? 'partial'
        : completenessPercent > 0
          ? 'low_coverage'
          : 'insufficient'
    const freshnessStatus = dataVerification.freshnessStatus || (input.history && input.history.length > 0 ? 'fresh' : 'unknown')
    const crossCheckStatus: DividendLowVolFactSet['dataTrust']['crossCheckStatus'] = dataVerification.status === 'cross_checked'
      ? 'verified'
      : hasFallback
        ? 'fallback'
        : dataVerification.status === 'single_source'
          ? 'partial'
          : 'not_checked'
    const blockers = unique([
      ...(!metricCompleteness.displayReady ? metricCompleteness.missingMetrics.map((item) => `missing:${item}`) : []),
      ...(blockedReasons.includes('dividend_low_vol_evidence_insufficient') ? ['strategy_evidence_insufficient'] : []),
      ...(dataVerification.status === 'insufficient' ? ['source_evidence_insufficient'] : []),
      ...(leaderEvidence.status === 'insufficient' ? ['leader_evidence_insufficient'] : []),
    ])
    const warnings = unique([
      ...dataVerification.warnings,
      ...(providerMode === 'free_source_research' ? ['free_source_research_not_formal_provider'] : []),
      ...(hasFallback ? ['fallback_or_seed_evidence_used'] : []),
      ...(leaderEvidence.status !== 'verified_industry_leader' ? [`leader_status:${leaderEvidence.status}`] : []),
      ...(blockedReasons.filter((reason) => ['dividend_trap_risk', 'dps_consecutive_decline', 'dps_growth_negative', 'max_drawdown_250d_above_35'].includes(reason))),
    ])
    const crossCheckScore = crossCheckStatus === 'verified' ? 100 : crossCheckStatus === 'partial' ? 65 : crossCheckStatus === 'fallback' ? 35 : 15
    const providerScore = providerMode === 'formal_provider' ? 100 : providerMode === 'mixed' ? 85 : providerMode === 'free_source_research' ? 55 : 20
    const leaderScore = leaderEvidence.status === 'verified_industry_leader' ? 100 : leaderEvidence.status === 'leader_candidate' ? 65 : leaderEvidence.status === 'leader_partial' ? 45 : 20
    const penalty = (hasFallback ? 15 : 0) + (blockers.length * 8) + (warnings.filter((item) => item.includes('trap') || item.includes('decline')).length * 5)
    const confidencePercent = clamp(
      (scores.evidenceQualityScore * 0.3)
      + (completenessPercent * 0.25)
      + (crossCheckScore * 0.2)
      + (providerScore * 0.15)
      + (leaderScore * 0.1)
      - penalty,
      0,
      100,
    )
    const grade = !metricCompleteness.displayReady || blockers.length > 0
      ? (confidencePercent >= 45 ? 'D' : 'INSUFFICIENT')
      : hasFallback || providerMode === 'free_source_research'
        ? confidencePercent >= 70 ? 'B' : confidencePercent >= 55 ? 'C' : 'D'
        : confidencePercent >= 85 ? 'A' : confidencePercent >= 70 ? 'B' : confidencePercent >= 55 ? 'C' : 'D'
    const displayLabel = grade === 'A'
      ? '正式源高可信'
      : grade === 'B'
        ? '研究级较可信'
        : grade === 'C'
          ? '研究级需复核'
          : grade === 'D'
            ? '低可信需复核'
            : '证据不足'
    return {
      schemaVersion: 'dividend.low_vol.data_trust.v1',
      grade,
      confidencePercent: round(confidencePercent) || 0,
      providerMode,
      coverageStatus,
      freshnessStatus,
      crossCheckStatus,
      displayLabel,
      blockers,
      warnings,
      lastVerifiedAt: new Date().toISOString(),
      note: 'Data trust is a field/source confidence summary. It is not model validation and does not unlock formal ADD/REDUCE/AUTO_TRADE.',
    }
  }

  private buildDataTrustFromFactSet(candidate: DividendLowVolFactSet): DividendLowVolFactSet['dataTrust'] {
    const leaderEvidence = candidate.leaderEvidence || {
      status: 'insufficient' as const,
      marketCapRankVerified: false,
      revenueRankVerified: false,
      netProfitRankVerified: false,
      roePercentileVerified: false,
      providerCrossCheckedIndustryRank: false,
      seedFallbackUsed: false,
      evidenceRefs: [],
      missingFields: ['leaderEvidence'],
      note: 'Persisted factset is missing leader evidence details.',
    }
    return this.buildDataTrust(
      {
        symbol: candidate.identity.symbol,
        name: candidate.identity.name,
        industry: candidate.identity.industry,
        assetType: candidate.identity.assetType,
        history: candidate.timing.price !== undefined ? [{ date: candidate.generatedAt.slice(0, 10), open: candidate.timing.price, high: candidate.timing.price, low: candidate.timing.price, close: candidate.timing.price, volume: 0 }] : [],
      },
      candidate.evidenceRefs || [],
      candidate.dataVerification || this.buildDataVerification(candidate.evidenceRefs || []),
      candidate.metricCompleteness || this.buildMetricCompletenessFromFactSet(candidate),
      leaderEvidence,
      candidate.blockedReasons || [],
      candidate.scores,
    )
  }

  private buildCalculationAudit(
    metricCompleteness: DividendLowVolFactSet['metricCompleteness'],
    scores: DividendLowVolFactSet['scores'],
  ): DividendLowVolFactSet['calculationAudit'] {
    const scoreEntries: Array<[string, unknown]> = [
      ['scores.dividendScore', scores.dividendScore],
      ['scores.dividendQualityScore', scores.dividendQualityScore],
      ['scores.lowVolScore', scores.lowVolScore],
      ['scores.valuationScore', scores.valuationScore],
      ['scores.evidenceQualityScore', scores.evidenceQualityScore],
      ['scores.totalResearchScore', scores.totalResearchScore],
      ['scores.evidenceAdjustedScore', scores.evidenceAdjustedScore],
    ]
    const mismatchCount = scoreEntries.filter(([, value]) => typeof value !== 'number' || !Number.isFinite(value)).length
    const missingInputFields = unique(metricCompleteness.missingMetrics || [])
    const replayStatus = missingInputFields.length > 0
      ? 'insufficient'
      : mismatchCount > 0
        ? 'failed'
        : 'passed'
    return {
      schemaVersion: 'dividend.low_vol.calculation_audit.v1',
      formulaVersion: 'dividend_low_vol_leader_v1.scoring.2026-06',
      replayStatus,
      inputFieldCount: metricCompleteness.completeMetricCount,
      missingInputFields,
      formulaRefs: [
        'DividendScore=yield/3y_yield/consecutive_years/dps_growth/stability',
        'DividendQualityScore=payout/cashflow/earnings/debt/roe',
        'LowVolScore=volatility/drawdown/beta/atr/liquidity',
        'EvidenceAdjustedScore=TotalResearchScore*evidence/validation/tradeability constraints',
      ],
      mismatchCount,
      generatedAt: new Date().toISOString(),
      note: replayStatus === 'passed'
        ? 'All displayed scoring fields are finite and the required formula inputs are present; this is a deterministic calculation check, not a proof of predictive validity.'
        : 'The score cannot be fully replayed until missing inputs or non-finite score values are fixed.',
    }
  }

  private buildDataTrustPoolSummary(candidates: DividendLowVolFactSet[]) {
    const byGrade = candidates.reduce<Record<string, number>>((counts, candidate) => {
      const grade = candidate.dataTrust?.grade || 'INSUFFICIENT'
      counts[grade] = (counts[grade] || 0) + 1
      return counts
    }, {})
    const averageConfidencePercent = candidates.length > 0
      ? round(candidates.reduce((sum, candidate) => sum + (candidate.dataTrust?.confidencePercent || 0), 0) / candidates.length)
      : 0
    const blockers = new Map<string, number>()
    const warnings = new Map<string, number>()
    for (const candidate of candidates) {
      for (const blocker of candidate.dataTrust?.blockers || []) blockers.set(blocker, (blockers.get(blocker) || 0) + 1)
      for (const warning of candidate.dataTrust?.warnings || []) warnings.set(warning, (warnings.get(warning) || 0) + 1)
    }
    return {
      schemaVersion: 'dividend.low_vol.data_trust_summary.v1',
      total: candidates.length,
      averageConfidencePercent,
      byGrade,
      highTrustCount: (byGrade.A || 0) + (byGrade.B || 0),
      insufficientCount: byGrade.INSUFFICIENT || 0,
      topBlockers: Array.from(blockers.entries()).map(([id, count]) => ({ id, count })).sort((left, right) => right.count - left.count).slice(0, 8),
      topWarnings: Array.from(warnings.entries()).map(([id, count]) => ({ id, count })).sort((left, right) => right.count - left.count).slice(0, 8),
      note: 'This summary separates display completeness from data authenticity/confidence. Free-source or fallback evidence remains research-grade only.',
    }
  }

  private buildCalculationAuditPoolSummary(candidates: DividendLowVolFactSet[]) {
    const byReplayStatus = candidates.reduce<Record<string, number>>((counts, candidate) => {
      const status = candidate.calculationAudit?.replayStatus || 'insufficient'
      counts[status] = (counts[status] || 0) + 1
      return counts
    }, {})
    const missing = new Map<string, number>()
    for (const candidate of candidates) {
      for (const field of candidate.calculationAudit?.missingInputFields || []) missing.set(field, (missing.get(field) || 0) + 1)
    }
    return {
      schemaVersion: 'dividend.low_vol.calculation_audit_summary.v1',
      total: candidates.length,
      byReplayStatus,
      replayPassedCount: byReplayStatus.passed || 0,
      replayInsufficientCount: byReplayStatus.insufficient || 0,
      replayFailedCount: byReplayStatus.failed || 0,
      topMissingInputFields: Array.from(missing.entries()).map(([field, count]) => ({ field, count })).sort((left, right) => right.count - left.count).slice(0, 8),
      formulaVersion: 'dividend_low_vol_leader_v1.scoring.2026-06',
      note: 'Calculation audit confirms deterministic scoring inputs and finite outputs. It does not prove model effectiveness or trading readiness.',
    }
  }

  private buildAlertSummary(candidates: DividendLowVolFactSet[]) {
    const buildPlan = candidates.filter((candidate) => candidate.alerts.some((alert) => alert.type === 'DIVIDEND_BUILD_PLAN' || alert.type === 'DIVIDEND_ADD_ON_PULLBACK'))
    const lowZone = candidates.filter((candidate) => candidate.alerts.some((alert) => alert.type === 'DIVIDEND_LOW_ZONE'))
    const sell = candidates.filter((candidate) => candidate.alerts.some((alert) => alert.type === 'DIVIDEND_TRIM' || alert.type === 'DIVIDEND_EXIT_RISK'))
    const highZone = candidates.filter((candidate) => candidate.alerts.some((alert) => alert.type === 'DIVIDEND_HIGH_ZONE'))
    return {
      lowZoneCount: lowZone.length,
      buildPlanCount: buildPlan.length,
      highZoneCount: highZone.length,
      sellAlertCount: sell.length,
      buildPlanSymbols: buildPlan.map((candidate) => candidate.identity.symbol),
      sellAlertSymbols: sell.map((candidate) => candidate.identity.symbol),
    }
  }

  private buildRejectionSummary(candidates: DividendLowVolFactSet[]) {
    const rejectionAudit = buildDividendLowVolRejectionAudit(candidates)
    const rejected = candidates.filter((candidate) => candidate.candidateGrade === 'EXCLUDED' || ['avoid', 'data_insufficient'].includes(candidate.disposition))
    const reasonCounts = new Map<string, number>()
    const categoryCounts = new Map<string, number>()
    for (const candidate of rejected) {
      const reasons = candidate.blockedReasons.length > 0 ? candidate.blockedReasons : ['unknown_rejection']
      for (const reason of reasons) {
        const meta = DIVIDEND_LOW_VOL_REASON_META[reason] || BLOCKED_REASON_META[reason] || { label: reason, category: 'risk' as const }
        reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1)
        categoryCounts.set(meta.category, (categoryCounts.get(meta.category) || 0) + 1)
      }
    }
    const byReason = Array.from(reasonCounts.entries())
      .map(([reason, count]) => ({
        reason,
        label: DIVIDEND_LOW_VOL_REASON_META[reason]?.label || BLOCKED_REASON_META[reason]?.label || reason,
        category: DIVIDEND_LOW_VOL_REASON_META[reason]?.category || BLOCKED_REASON_META[reason]?.category || 'risk',
        count,
      }))
      .sort((left, right) => right.count - left.count)
    const dataIssueCount = rejectionAudit.byType.data_gap.reduce((sum, item) => sum + item.count, 0)
    const hardRuleCount = rejectionAudit.byType.hard_rule_failure.reduce((sum, item) => sum + item.count, 0)
    return {
      rejectedCount: rejected.length,
      dataIssueCount,
      hardRuleCount,
      byType: rejectionAudit.byType,
      byCategory: Array.from(categoryCounts.entries())
        .map(([category, count]) => ({ category, count }))
        .sort((left, right) => right.count - left.count),
      byReason,
      topReasons: byReason.slice(0, 8),
      examples: rejectionAudit.examples,
      note: '同一标的可能同时触发多条剔除原因，因此原因统计之和可能大于剔除标的数。',
    }
  }

  private buildAlerts(
    input: DividendLowVolInput,
    metrics: ReturnType<typeof dividendLowVolScoringService.deriveMarketMetrics>,
    scores: ReturnType<typeof dividendLowVolScoringService.score>,
    blockedReasons: string[],
    financialRiskFlags: string[],
    evidenceRefs: string[],
    leaderStatus: DividendLowVolFactSet['leaderEvidence']['status'],
  ): DividendLowVolFactSet['alerts'] {
    const alerts: DividendLowVolFactSet['alerts'] = []
    const push = (type: DividendLowVolAlertType, severity: 'info' | 'warning' | 'danger', triggerReason: string, invalidationConditions: string[]) => {
      alerts.push({ type, severity, triggerReason, invalidationConditions, evidenceRefs })
    }
    if (blockedReasons.includes('dividend_history_insufficient') || blockedReasons.includes('dividend_yield_missing_or_zero')) {
      push('DIVIDEND_DATA_GAP', 'warning', '分红历史或股息率证据不足，不能进入红利低波候选池。', ['补齐最近三年现金分红记录和证据来源'])
      return alerts
    }
    if (financialRiskFlags.includes('operating_cashflow_coverage_weak') || financialRiskFlags.includes('payout_ratio_high')) {
      push('DIVIDEND_EXIT_RISK', 'danger', '分红质量存在恶化风险，高股息可能来自不可持续支付。', ['支付率回到安全区间', '经营现金流重新覆盖净利润和分红'])
    }
    const lowZone = this.lowZoneScore(metrics.dividendYieldPercentile3y, scores.valuationScore, scores.lowVolScore, metrics.drawdownFrom250dHigh)
    const highZone = this.highZoneScore(metrics.dividendYieldPercentile3y, scores.valuationScore, metrics.rsi14, metrics.latestPrice, metrics.ma250)
    const buyHardBlockers = new Set([
      'security_status_st_or_risk',
      'security_suspended',
      'security_delisted',
      'listing_age_less_than_3y',
      'dividend_history_insufficient',
      'dividend_yield_missing_or_zero',
      'dividend_yield_below_4_percent',
      'avg_dividend_yield_3y_below_3_5_percent',
      'industry_leader_score_below_75',
      'payout_ratio_negative',
      'payout_ratio_extreme_high',
      'payout_ratio_above_policy_band',
      'cashflow_dividend_coverage_weak',
      'dps_growth_negative',
      'max_drawdown_250d_above_35',
      'max_drawdown_60d_above_18',
      'low_vol_score_below_60',
      'dividend_low_vol_evidence_insufficient',
    ])
    const buildPlanEligible = leaderStatus === 'verified_industry_leader' && !blockedReasons.some((reason) => buyHardBlockers.has(reason))
    if (buildPlanEligible && (metrics.dividendYieldPercentile3y || 0) >= 65 && scores.valuationScore >= 60 && scores.lowVolScore >= 60 && (metrics.drawdownFrom250dHigh || 0) >= 8) {
      push('DIVIDEND_LOW_ZONE', 'info', '股息率分位、估值、低波和回撤条件进入低位观察区。', ['股息率分位跌破 55', '分红质量恶化', '波动率显著上升'])
    }
    if (buildPlanEligible && (metrics.dividendYieldPercentile3y || 0) >= 75 && scores.valuationScore >= 70 && scores.dividendQualityScore >= 70 && scores.lowVolScore >= 65 && lowZone >= 70) {
      push('DIVIDEND_BUILD_PLAN', 'warning', '进入首批建仓计划草案条件，但仍需 validation gate 和人工复核。', ['跌破长期风险位', '分红质量恶化', '组合仓位超过纪律上限'])
    }
    if (buildPlanEligible && input.positionWeightPercent && input.positionWeightPercent > 0 && (metrics.dividendYieldPercentile3y || 0) >= 80 && scores.riskScore >= 60) {
      push('DIVIDEND_ADD_ON_PULLBACK', 'warning', '持仓标的仍处红利低估区，可进入加仓观察草案。', ['仓位达到上限', '跌破长期风险位', '分红质量恶化'])
    }
    if (highZone >= 65) {
      push('DIVIDEND_HIGH_ZONE', 'info', '股息率分位压缩或估值升高，进入高位观察区。', ['估值回落', '股息率分位回升至 45 以上'])
    }
    if ((metrics.dividendYieldPercentile3y || 100) <= 25 && scores.valuationScore <= 40 && (metrics.rsi14 || 0) > 70) {
      push('DIVIDEND_TRIM', 'warning', '股息率吸引力下降、估值偏贵且 RSI 偏高，生成减仓提醒草案。', ['估值分回升', 'RSI 回落', '人工复核确认继续持有'])
    }
    return alerts
  }

  private buildDiscipline(disposition: string): DividendLowVolDiscipline {
    const planDraftAllowed = ['low_zone_alert', 'build_position_plan', 'add_on_pullback', 'trim_high_zone', 'exit_dividend_risk'].includes(disposition)
    return {
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      planDraftAllowed,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      positionGuidance: {
        targetPositionPercentRange: planDraftAllowed ? [2, 5] : null,
        firstBuildPercentOfTarget: disposition === 'build_position_plan' ? [25, 40] : null,
        singleStockCapPercent: 5,
        industryCapPercent: 25,
      },
      reviewRequiredBeforeExecution: [
        'validation_evidence gate',
        '停复牌、涨跌停和 ST 状态',
        '分红公告和财报证据',
        '现金、持仓、单票和行业上限',
        '人工审批记录',
      ],
    }
  }

  private researchTargetWeight(scores: ReturnType<typeof dividendLowVolScoringService.score>) {
    const base = scores.leaderScore && scores.leaderScore >= 80 ? 4 : scores.leaderScore && scores.leaderScore >= 75 ? 2.5 : 1
    const leaderMultiplier = scores.leaderScore === undefined ? 0.8 : scores.leaderScore >= 90 ? 1.2 : scores.leaderScore >= 80 ? 1 : scores.leaderScore >= 75 ? 0.8 : 0
    const valuationMultiplier = scores.valuationScore >= 80 ? 1.2 : scores.valuationScore >= 70 ? 1 : scores.valuationScore >= 60 ? 0.8 : 0.4
    const qualityMultiplier = scores.dividendQualityScore >= 80 ? 1.2 : scores.dividendQualityScore >= 70 ? 1 : scores.dividendQualityScore >= 60 ? 0.7 : 0
    const lowVolMultiplier = scores.lowVolScore >= 80 ? 1.2 : scores.lowVolScore >= 70 ? 1 : scores.lowVolScore >= 60 ? 0.7 : 0.3
    const riskMultiplier = clamp(1 - ((scores.financialRiskScore || 0) / 100), 0, 1)
    const evidenceMultiplier = scores.evidenceQualityScore >= 80 ? 1 : scores.evidenceQualityScore >= 60 ? 0.7 : scores.evidenceQualityScore >= 40 ? 0.3 : 0
    return round(clamp(base * leaderMultiplier * valuationMultiplier * qualityMultiplier * lowVolMultiplier * riskMultiplier * evidenceMultiplier, 0, 5))
  }

  private candidateGrade(scores: ReturnType<typeof dividendLowVolScoringService.score>, blockedReasons: string[]) {
    const trap = blockedReasons.some((reason) => [
      'payout_ratio_negative',
      'payout_ratio_extreme_high',
      'payout_ratio_above_policy_band',
      'cashflow_dividend_coverage_weak',
      'security_status_st_or_risk',
      'security_suspended',
      'security_delisted',
      'listing_age_less_than_3y',
      'dividend_yield_below_4_percent',
      'avg_dividend_yield_3y_below_3_5_percent',
      'industry_leader_score_below_75',
      'dps_growth_negative',
      'max_drawdown_250d_above_35',
      'max_drawdown_60d_above_18',
      'low_vol_score_below_60',
    ].includes(reason))
    if (trap || scores.evidenceQualityScore < 40 || (scores.leaderScore || 0) < 70 || (scores.financialRiskScore || 100) > 70) return 'EXCLUDED'
    if ((scores.leaderScore || 0) >= 80 && scores.dividendScore >= 75 && scores.dividendQualityScore >= 75 && scores.lowVolScore >= 70 && scores.valuationScore >= 65 && (scores.financialRiskScore || 100) <= 35 && scores.evidenceQualityScore >= 70) return 'A'
    if ((scores.leaderScore || 0) >= 75 && scores.dividendScore >= 65 && scores.dividendQualityScore >= 65 && scores.lowVolScore >= 60 && scores.valuationScore >= 55 && (scores.financialRiskScore || 100) <= 50 && scores.evidenceQualityScore >= 60) return 'B'
    if ((scores.leaderScore || 0) >= 75 && scores.lowVolScore >= 60 && scores.evidenceQualityScore >= 60 && (scores.financialRiskScore || 100) <= 50) return 'WATCH'
    if ((scores.leaderScore || 0) >= 70 && scores.totalResearchScore >= 60) return 'WATCH'
    return 'EXCLUDED'
  }

  private lowZoneScore(dividendYieldPercentile: number | undefined, valuationScore: number, lowVolScore: number, drawdown: number | undefined) {
    const drawdownScore = drawdown === undefined ? 0 : Math.max(0, Math.min(100, (drawdown / 25) * 100))
    return round(((dividendYieldPercentile || 0) * 0.35) + (valuationScore * 0.25) + (lowVolScore * 0.2) + (drawdownScore * 0.2)) || 0
  }

  private highZoneScore(dividendYieldPercentile: number | undefined, valuationScore: number, rsi14: number | undefined, price: number | undefined, ma250: number | undefined) {
    const yieldCompression = dividendYieldPercentile === undefined ? 0 : 100 - dividendYieldPercentile
    const expensive = 100 - valuationScore
    const distance = price && ma250 ? Math.max(0, Math.min(100, ((price - ma250) / ma250) * 300)) : 0
    return round((yieldCompression * 0.35) + (expensive * 0.25) + ((rsi14 || 0) * 0.2) + (distance * 0.2)) || 0
  }
}

export const dividendLowVolStrategyService = new DividendLowVolStrategyService()
