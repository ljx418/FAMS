import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dividendLowVolBacktestService } from '../src/services/dividend-low-vol/dividendLowVolBacktestService.js'
import { dividendLowVolInputBuilderService } from '../src/services/dividend-low-vol/dividendLowVolInputBuilderService.js'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { prisma } from '../src/db/prisma.js'
import type { DividendLowVolFactSet, DividendLowVolInput } from '../src/services/dividend-low-vol/dividendLowVolTypes.js'

const STRATEGY_ID = 'dividend_low_vol_leader_v2_research'

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

function numberArg(name: string, fallback: number) {
  const raw = arg(name) || process.env[`FAMS_DIVIDEND_LOW_VOL_${name.toUpperCase()}`]
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function unique<T>(items: T[]) {
  return Array.from(new Set(items))
}

function countsBy(items: string[]) {
  const map = new Map<string, number>()
  for (const item of items) map.set(item, (map.get(item) || 0) + 1)
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count)
}

const fatalReasons = new Set([
  'asset_identity_missing',
  'unsupported_asset_type',
  'security_status_st_or_risk',
  'security_suspended',
  'security_delisted',
  'listing_age_less_than_3y',
  'dividend_yield_missing_or_zero',
  'no_cash_dividend_confirmed',
  'payout_ratio_negative',
  'payout_ratio_extreme_high',
  'dividend_trap_risk',
  'special_dividend_suspected',
])

function v2Eligibility(candidate: DividendLowVolFactSet) {
  const reasons: string[] = []
  if (candidate.metricCompleteness?.displayReady !== true) reasons.push('display_metrics_incomplete')
  for (const reason of candidate.blockedReasons) {
    if (fatalReasons.has(reason)) reasons.push(`fatal:${reason}`)
  }
  if ((candidate.dividend.ttmDividendYield || 0) < 3.5) reasons.push('ttm_dividend_yield_below_3_5_percent')
  if ((candidate.dividend.avgDividendYield3y || 0) < 3.0) reasons.push('avg_dividend_yield_3y_below_3_percent')
  if ((candidate.scores.leaderScore || 0) < 65) reasons.push('leader_score_below_65')
  if ((candidate.scores.lowVolScore || 0) < 45) reasons.push('low_vol_score_below_45')
  if ((candidate.scores.evidenceQualityScore || 0) < 60) reasons.push('evidence_quality_below_60')
  if ((candidate.scores.financialRiskScore || 100) > 75) reasons.push('financial_risk_above_75')
  return {
    eligible: reasons.length === 0,
    failedReasons: reasons,
    relaxedFromV1: candidate.blockedReasons.filter((reason) => [
      'dividend_yield_below_4_percent',
      'avg_dividend_yield_3y_below_3_5_percent',
      'industry_leader_score_below_75',
      'payout_ratio_below_20',
      'payout_ratio_above_policy_band',
      'dps_growth_negative',
      'cashflow_dividend_coverage_weak',
      'max_drawdown_250d_above_35',
      'max_drawdown_60d_above_18',
      'low_vol_score_below_60',
      'dividend_cut_over_20_percent',
      'dps_consecutive_decline',
    ].includes(reason)),
  }
}

function toValidationInput(candidate: DividendLowVolFactSet, built?: DividendLowVolInput): DividendLowVolInput {
  const latestDividend = candidate.dividend.cashDividendPerShareHistory[0]?.dividendPerShare
  return {
    symbol: candidate.identity.symbol,
    name: candidate.identity.name,
    market: candidate.identity.market,
    assetType: candidate.identity.assetType,
    industry: candidate.identity.industry,
    isST: candidate.identity.isST,
    isSuspended: candidate.identity.isSuspended,
    listingAgeDays: candidate.identity.listingAgeDays,
    price: candidate.timing.price ?? built?.price,
    dividendRecords: candidate.dividend.cashDividendPerShareHistory,
    ttmDividendPerShare: latestDividend,
    payoutRatio: candidate.dividend.payoutRatio,
    operatingCashFlowToNetProfit: candidate.quality.operatingCashFlowToNetProfit,
    roe: candidate.quality.roe,
    debtToAsset: candidate.quality.debtToAsset,
    pe: candidate.valuation.pe,
    pb: candidate.valuation.pb,
    totalMarketCap: built?.totalMarketCap,
    avgTurnoverAmount60: built?.avgTurnoverAmount60,
    leaderScore: candidate.scores.leaderScore,
    marketCapRankScore: built?.marketCapRankScore,
    revenueRankScore: built?.revenueRankScore,
    netProfitRankScore: built?.netProfitRankScore,
    roeIndustryPercentile: built?.roeIndustryPercentile,
    liquidityRankScore: built?.liquidityRankScore,
    history: built?.history,
    evidenceRefs: unique([
      ...(candidate.evidenceRefs || []),
      ...(built?.evidenceRefs || []),
      `validation-input:${STRATEGY_ID}:${candidate.identity.symbol}`,
    ]),
  }
}

async function main() {
  const startedAt = new Date()
  const userId = arg('userId') || process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const limit = numberArg('limit', 6000)
  const maxCandidates = numberArg('v2Limit', 180)
  const pool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit,
    scope: 'all_latest_by_symbol',
  })
  const evaluated = pool.candidates.map((candidate) => ({
    candidate,
    eligibility: v2Eligibility(candidate),
  }))
  const selected = evaluated
    .filter((item) => item.eligibility.eligible)
    .sort((left, right) => right.candidate.scores.evidenceAdjustedScore - left.candidate.scores.evidenceAdjustedScore)
    .slice(0, maxCandidates)
  const symbols = selected.map((item) => item.candidate.identity.symbol)
  const builtInputs = symbols.length > 0
    ? await dividendLowVolInputBuilderService.buildFromSymbols(symbols, symbols.length)
    : []
  const builtBySymbol = new Map(builtInputs.map((input) => [input.symbol, input]))
  const inputs = selected.map((item) => toValidationInput(item.candidate, builtBySymbol.get(item.candidate.identity.symbol)))
  const backtest = dividendLowVolBacktestService.run(inputs, {
    dividendReinvestment: true,
    validationRunMode: STRATEGY_ID,
    validationInputSource: 'latest_persisted_v2_research_candidates',
    researchEligibilityMode: 'expanded_observation',
  }) as any
  const checks = backtest.validationEvidence || {}
  const candidateValidationPassed = [
    checks.outOfSample,
    checks.walkForward,
    checks.parameterSensitivity,
    checks.groupStability,
  ].every((status) => status === 'candidate_passed')
  const enoughSample = (backtest.sample?.effectivePathCount || 0) >= 100
  const generatedAt = new Date().toISOString()
  const artifact = {
    schemaVersion: 'dividend.low_vol.v2_research_validation.v1',
    generatedAt,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    strategyFamily: dividendLowVolStrategyService.strategyFamily,
    strategyId: STRATEGY_ID,
    status: candidateValidationPassed && enoughSample ? 'research_candidate_passed' : 'research_candidate_insufficient',
    purpose: 'Research-only calibrated v2 rules derived from expanded observation diagnostics. This does not replace v1 or unlock trading.',
    criteria: {
      fatalReasonsExcluded: Array.from(fatalReasons),
      minimums: {
        ttmDividendYieldPercent: 3.5,
        avgDividendYield3yPercent: 3.0,
        leaderScore: 65,
        lowVolScore: 45,
        evidenceQualityScore: 60,
        maxFinancialRiskScore: 75,
      },
      strictBuildPlanStillRequires: [
        'validation_evidence_formal_passed',
        'manual_review',
        'verified_industry_leader',
        'ADD_REDUCE_gate_unlocked',
      ],
    },
    latestPool: {
      total: pool.total,
      completeDisplayReadyCount: pool.metricCompletenessSummary.completeDisplayReadyCount,
      incompleteDisplayCount: pool.metricCompletenessSummary.incompleteDisplayCount,
      strictV1ResearchCandidates: pool.candidates.filter((candidate) => !['avoid', 'data_insufficient'].includes(candidate.disposition)).length,
      v2ResearchCandidates: selected.length,
      v2FailedReasonCounts: countsBy(evaluated.flatMap((item) => item.eligibility.failedReasons)),
      v2RelaxedReasonCounts: countsBy(selected.flatMap((item) => item.eligibility.relaxedFromV1)),
    },
    candidates: selected.slice(0, 80).map((item) => ({
      symbol: item.candidate.identity.symbol,
      name: item.candidate.identity.name,
      industry: item.candidate.identity.industry,
      v1Disposition: item.candidate.disposition,
      evidenceAdjustedScore: item.candidate.scores.evidenceAdjustedScore,
      ttmDividendYield: item.candidate.dividend.ttmDividendYield,
      avgDividendYield3y: item.candidate.dividend.avgDividendYield3y,
      leaderScore: item.candidate.scores.leaderScore,
      lowVolScore: item.candidate.scores.lowVolScore,
      relaxedFromV1: item.eligibility.relaxedFromV1,
    })),
    backtest: {
      sample: backtest.sample,
      metrics: backtest.metrics,
      validationEvidence: backtest.validationEvidence,
      formalBacktestGate: backtest.formalBacktestGate,
    },
    validationDecision: {
      usableForTradingAdvice: false,
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      primaryBlocker: candidateValidationPassed && enoughSample
        ? 'v2_research_passed_but_formal_validation_and_manual_gate_required'
        : 'v2_research_validation_insufficient',
    },
    policy: {
      notTradingAdvice: true,
      doesNotChangeV1CandidatePool: true,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
    },
  }
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const artifactPath = resolve(auditDir, `dividend-low-vol-v2-research-validation-${generatedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    artifactPath,
    status: artifact.status,
    latestPool: artifact.latestPool,
    backtest: artifact.backtest,
    validationDecision: artifact.validationDecision,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
