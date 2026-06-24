import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dividendLowVolBacktestService } from '../src/services/dividend-low-vol/dividendLowVolBacktestService.js'
import { dividendLowVolInputBuilderService } from '../src/services/dividend-low-vol/dividendLowVolInputBuilderService.js'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { prisma } from '../src/db/prisma.js'
import type { DividendLowVolFactSet, DividendLowVolInput } from '../src/services/dividend-low-vol/dividendLowVolTypes.js'

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

function expandSampleReason(candidate: DividendLowVolFactSet) {
  if (candidate.metricCompleteness?.displayReady !== true) return null
  if (candidate.blockedReasons.some((reason) => fatalReasons.has(reason))) return null
  if ((candidate.dividend.ttmDividendYield || 0) < 3.5) return null
  if ((candidate.scores.leaderScore || 0) < 65) return null
  if ((candidate.scores.lowVolScore || 0) < 45) return null
  if ((candidate.scores.evidenceQualityScore || 0) < 60) return null
  const nearMiss = candidate.blockedReasons.filter((reason) => [
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
  ].includes(reason))
  return nearMiss.length > 0 ? nearMiss : ['strict_research_candidate']
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
      `validation-input:expanded-observation:${candidate.identity.symbol}`,
    ]),
  }
}

async function main() {
  const startedAt = new Date()
  const userId = arg('userId') || process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const limit = numberArg('limit', 6000)
  const maxExpanded = numberArg('expandedLimit', 160)
  const pool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit,
    scope: 'all_latest_by_symbol',
  })
  const strictCandidates = pool.candidates.filter((candidate) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
  const expandQueue = pool.candidates
    .map((candidate) => ({ candidate, reasons: expandSampleReason(candidate) }))
    .filter((item): item is { candidate: DividendLowVolFactSet; reasons: string[] } => Array.isArray(item.reasons))
    .sort((left, right) => right.candidate.scores.evidenceAdjustedScore - left.candidate.scores.evidenceAdjustedScore)
    .slice(0, maxExpanded)
  const symbols = unique(expandQueue.map((item) => item.candidate.identity.symbol))
  const builtInputs = symbols.length > 0
    ? await dividendLowVolInputBuilderService.buildFromSymbols(symbols, symbols.length)
    : []
  const builtBySymbol = new Map(builtInputs.map((input) => [input.symbol, input]))
  const inputs = expandQueue.map((item) => toValidationInput(item.candidate, builtBySymbol.get(item.candidate.identity.symbol)))
  const backtest = dividendLowVolBacktestService.run(inputs, {
    dividendReinvestment: true,
    validationRunMode: 'expanded_observation_queue',
    validationInputSource: 'latest_persisted_expand_sample_queue',
    researchEligibilityMode: 'expanded_observation',
  }) as any
  const generatedAt = new Date().toISOString()
  const status = backtest.sample?.effectivePathCount >= 100
    ? 'expanded_sample_ready_for_research_validation'
    : 'expanded_sample_still_insufficient'
  const artifact = {
    schemaVersion: 'dividend.low_vol.expanded_sample_validation.v1',
    generatedAt,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    strategyId: dividendLowVolStrategyService.strategyId,
    status,
    purpose: 'Research-only expanded sample diagnostics. This artifact does not change candidate disposition and cannot unlock ADD / REDUCE / AUTO_TRADE.',
    latestPool: {
      total: pool.total,
      completeDisplayReadyCount: pool.metricCompletenessSummary.completeDisplayReadyCount,
      incompleteDisplayCount: pool.metricCompletenessSummary.incompleteDisplayCount,
      strictResearchCandidates: strictCandidates.length,
      expandedQueueCandidates: expandQueue.length,
    },
    expandSampleQueue: {
      selectedCount: expandQueue.length,
      reasonCounts: countsBy(expandQueue.flatMap((item) => item.reasons)),
      topSymbols: expandQueue.slice(0, 30).map((item) => ({
        symbol: item.candidate.identity.symbol,
        name: item.candidate.identity.name,
        industry: item.candidate.identity.industry,
        disposition: item.candidate.disposition,
        evidenceAdjustedScore: item.candidate.scores.evidenceAdjustedScore,
        ttmDividendYield: item.candidate.dividend.ttmDividendYield,
        leaderScore: item.candidate.scores.leaderScore,
        lowVolScore: item.candidate.scores.lowVolScore,
        reasons: item.reasons,
      })),
    },
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
      primaryBlocker: status === 'expanded_sample_ready_for_research_validation'
        ? 'strict_strategy_oos_and_manual_gate_still_required'
        : 'expanded_sample_size_insufficient',
    },
    policy: {
      notTradingAdvice: true,
      doesNotChangeCandidatePool: true,
      doesNotUnlockBuildPlan: true,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
    },
  }
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const artifactPath = resolve(auditDir, `dividend-low-vol-expanded-sample-validation-${generatedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    artifactPath,
    status,
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
