import 'dotenv/config'
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
    evidenceRefs: Array.from(new Set([
      ...(candidate.evidenceRefs || []),
      ...(built?.evidenceRefs || []),
      `validation-input:latest-persisted-factset:${candidate.identity.symbol}`,
    ])),
  }
}

async function main() {
  const userId = arg('userId') || process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const limit = numberArg('limit', 6000)
  const pool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit,
    scope: 'all_latest_by_symbol',
  })
  const researchCandidates = pool.candidates.filter((candidate) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
  const symbols = Array.from(new Set(researchCandidates.map((candidate) => candidate.identity.symbol)))
  const builtInputs = symbols.length > 0
    ? await dividendLowVolInputBuilderService.buildFromSymbols(symbols, symbols.length)
    : []
  const builtBySymbol = new Map(builtInputs.map((input) => [input.symbol, input]))
  const inputs = researchCandidates.map((candidate) => toValidationInput(candidate, builtBySymbol.get(candidate.identity.symbol)))
  const retest = await dividendLowVolBacktestService.runValidationRetest(inputs, {
    dividendReinvestment: true,
    validationRunMode: 'real_latest_persisted',
    validationInputSource: 'latest_persisted_research_candidates',
  }) as any
  console.log(JSON.stringify({
    ok: true,
    artifactRef: retest.artifactRef,
    latestPool: {
      total: pool.total,
      completeDisplayReadyCount: pool.metricCompletenessSummary.completeDisplayReadyCount,
      incompleteDisplayCount: pool.metricCompletenessSummary.incompleteDisplayCount,
      eligibleResearchCandidates: researchCandidates.length,
      symbols,
    },
    validation: {
      status: retest.status,
      matrixStatus: retest.validationEvidenceMatrix.status,
      usableForTradingAdvice: retest.validationDecision.usableForTradingAdvice,
      primaryBlocker: retest.validationDecision.primaryBlocker,
      prohibitedActions: retest.validationDecision.prohibitedActions,
      checks: retest.validationEvidenceMatrix.checks,
    },
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
