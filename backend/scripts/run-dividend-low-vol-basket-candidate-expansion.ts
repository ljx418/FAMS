import 'dotenv/config'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { dividendLowVolInputBuilderService } from '../src/services/dividend-low-vol/dividendLowVolInputBuilderService.js'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { dividendLowVolUniverseService } from '../src/services/dividend-low-vol/dividendLowVolUniverseService.js'
import { portfolioBacktestEngine } from '../src/services/portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../src/services/portfolio-backtest/portfolioBacktestInputBuilder.js'

type CandidatePool = ReturnType<typeof dividendLowVolStrategyService.buildCandidatePool>

const STRATEGY_ID = 'dividend_low_vol_leader_v1'
const GENERATED_AT = new Date().toISOString()

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

function numberArg(name: string, fallback: number, min = 0) {
  const raw = arg(name) || process.env[`FAMS_DIVIDEND_LOW_VOL_${name.toUpperCase()}`]
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= min ? Math.floor(parsed) : fallback
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

function countsBy(values: string[]) {
  const map = new Map<string, number>()
  for (const value of values) map.set(value, (map.get(value) || 0) + 1)
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count)
}

function latestBacktestWindow() {
  const endDate = arg('endDate') || process.env.FAMS_DIVIDEND_LOW_VOL_BASKET_END_DATE || '2026-06-05'
  const startDate = arg('startDate') || process.env.FAMS_DIVIDEND_LOW_VOL_BASKET_START_DATE || '2025-12-04'
  return { startDate, endDate }
}

function detectCatastrophicProviderFailure(pool: CandidatePool, actualChunkSize: number) {
  if (actualChunkSize < 20) return null
  const missingByMetric = new Map(pool.metricCompletenessSummary.topMissingMetrics.map((item) => [item.metric, item.count]))
  const coreMarketMissingThreshold = Math.ceil(actualChunkSize * 0.6)
  const coreFundamentalMissingThreshold = Math.ceil(actualChunkSize * 0.8)
  const missingMarketData =
    (missingByMetric.get('timing.price') || 0) >= coreMarketMissingThreshold &&
    (missingByMetric.get('dividend.ttmDividendYield') || 0) >= coreMarketMissingThreshold
  const missingFundamentals =
    (missingByMetric.get('valuation.pe') || 0) >= coreFundamentalMissingThreshold &&
    (missingByMetric.get('valuation.pb') || 0) >= coreFundamentalMissingThreshold &&
    (missingByMetric.get('quality.roe') || 0) >= coreFundamentalMissingThreshold
  const allDisplayIncomplete = pool.metricCompletenessSummary.completeDisplayReadyCount === 0
  if (allDisplayIncomplete && missingMarketData && missingFundamentals) {
    return {
      code: 'provider_failure_suspected_all_core_metrics_missing',
      severity: 'critical',
      message: 'Whole chunk is missing market, dividend, valuation and quality metrics. Persistence is blocked for this chunk.',
      evidence: {
        actualChunkSize,
        completeDisplayReadyCount: pool.metricCompletenessSummary.completeDisplayReadyCount,
        topMissingMetrics: pool.metricCompletenessSummary.topMissingMetrics.slice(0, 12),
      },
    }
  }
  return null
}

async function resolveTradeDate() {
  const explicit = arg('tradeDate') || process.env.FAMS_DIVIDEND_LOW_VOL_TRADE_DATE
  if (explicit) return explicit.slice(0, 10)
  const latest = await prisma.marketBarCanonical.aggregate({
    where: {
      market: 'CN',
      timeframe: '1d',
      adjustType: 'none',
      dataVersion: 'canonical.v1',
      closePrice: { gt: 0 },
    },
    _max: { tradeDate: true },
  })
  return latest._max.tradeDate ? isoDate(latest._max.tradeDate) : new Date().toISOString().slice(0, 10)
}

async function latestBasketStatus(userId: string, startDate: string, endDate: string) {
  const input = await portfolioBacktestInputBuilder.build({
    userId,
    portfolioStrategyIds: ['dividend_low_vol_basket'],
    startDate,
    endDate,
    initialCapital: 100000,
    rebalanceFrequency: 'quarterly',
    dividendMode: 'reinvest',
    feeRate: 0.0003,
    slippageRate: 0.0005,
    benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20'],
  })
  const result = await portfolioBacktestEngine.run(input)
  const strategy = result.strategies.find((item) => item.definition.strategyId === 'dividend_low_vol_basket')
  return {
    status: strategy?.status || 'missing',
    componentCount: strategy?.definition.components.length || 0,
    snapshot: strategy?.definition.snapshot,
    blockedReasons: strategy?.blockedReasons || [],
    warnings: strategy?.warnings || [],
    metrics: strategy?.metrics,
    prohibitedActions: result.prohibitedActions,
  }
}

async function latestExpansionAuditPath() {
  const root = resolve(process.cwd(), 'data/gpt-audit')
  const entries = await readdir(root).catch(() => [])
  return entries
    .filter((name) => name.startsWith('dividend-low-vol-basket-candidate-expansion-') && name.endsWith('.json'))
    .sort()
    .at(-1)
}

async function main() {
  const startedAt = new Date()
  const userId = arg('userId') || process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const offset = numberArg('offset', 0)
  const chunkSize = Math.max(1, numberArg('chunkSize', 50, 1))
  const maxChunks = Math.max(1, numberArg('maxChunks', 40, 1))
  const targetLimit = Math.max(offset + chunkSize, numberArg('targetLimit', 2000, 1))
  const minComponents = Math.max(1, numberArg('minComponents', 3, 1))
  const { startDate, endDate } = latestBacktestWindow()
  const tradeDate = await resolveTradeDate()
  const sourceOperationPrefix = arg('operationPrefix') || `dividend-low-vol-basket-expansion:${tradeDate}`

  const universe = await dividendLowVolUniverseService.getAllAShareInputs({ limit: targetLimit })
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })

  const beforeBasket = await latestBasketStatus(userId, startDate, endDate)
  const chunks = []
  let finalBasket = beforeBasket
  let stoppedReason = 'max_chunks_reached'

  for (let chunkIndex = 0; chunkIndex < maxChunks; chunkIndex += 1) {
    const currentOffset = offset + (chunkIndex * chunkSize)
    const chunk = universe.inputs.slice(currentOffset, currentOffset + chunkSize)
    if (chunk.length === 0) {
      stoppedReason = 'universe_exhausted'
      break
    }

    const sourceOperationId = `${sourceOperationPrefix}:${currentOffset}:${chunk.length}`
    const inputs = await dividendLowVolInputBuilderService.buildFromInputs(chunk, chunk.length)
    const dryRunPool = dividendLowVolStrategyService.buildCandidatePool(inputs, {
      universeSummary: {
        ...universe.summary,
        scanMode: 'basket_candidate_expansion_dry_run',
        targetLimit,
        offset: currentOffset,
        chunkSize,
        actualChunkSize: chunk.length,
      },
    })
    const persistenceBlocker = detectCatastrophicProviderFailure(dryRunPool, chunk.length)
    const persistedPool = persistenceBlocker
      ? dryRunPool
      : await dividendLowVolStrategyService.persistCandidatePool(userId, inputs, {
        tradeDate,
        sourceOperationId,
        universeSummary: {
          ...universe.summary,
          scanMode: 'basket_candidate_expansion',
          targetLimit,
          offset: currentOffset,
          chunkSize,
          actualChunkSize: chunk.length,
        },
      })

    finalBasket = await latestBasketStatus(userId, startDate, endDate)
    chunks.push({
      chunkIndex,
      offset: currentOffset,
      chunkSize,
      actualChunkSize: chunk.length,
      nextOffset: currentOffset + chunk.length,
      symbols: chunk.map((item) => item.symbol),
      persisted: !persistenceBlocker,
      blocker: persistenceBlocker,
      pool: {
        total: persistedPool.total,
        eligibleResearchCandidates: persistedPool.eligibleResearchCandidates,
        completeDisplayReadyCount: persistedPool.metricCompletenessSummary.completeDisplayReadyCount,
        incompleteDisplayCount: persistedPool.metricCompletenessSummary.incompleteDisplayCount,
        topMissingMetrics: persistedPool.metricCompletenessSummary.topMissingMetrics.slice(0, 12),
        dispositionCounts: countsBy(persistedPool.candidates.map((candidate) => candidate.disposition)),
        leaderStatusCounts: countsBy(persistedPool.candidates.map((candidate) => candidate.leaderEvidence.status)),
        eligibleSymbols: persistedPool.candidates
          .filter((candidate) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
          .map((candidate) => ({
            symbol: candidate.identity.symbol,
            name: candidate.identity.name,
            disposition: candidate.disposition,
            candidateGrade: candidate.candidateGrade,
            evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
            leaderVerificationStatus: candidate.leaderEvidence.status,
            blockedReasons: candidate.blockedReasons,
          })),
      },
      basketAfterChunk: finalBasket,
    })

    if (finalBasket.status === 'completed' && finalBasket.componentCount >= minComponents) {
      stoppedReason = 'min_components_reached'
      break
    }
  }

  const latestPool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit: targetLimit,
    scope: 'all_latest_by_symbol',
  })
  const status = finalBasket.status === 'completed' && finalBasket.componentCount >= minComponents
    ? 'completed'
    : 'blocked_by_real_data'
  const report = {
    schemaVersion: 'dividend.low_vol.basket_candidate_expansion_audit.v1',
    generatedAt: GENERATED_AT,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    status,
    stoppedReason,
    notTradingAdvice: true,
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    input: {
      userId,
      tradeDate,
      startDate,
      endDate,
      offset,
      chunkSize,
      maxChunks,
      targetLimit,
      minComponents,
      sourceOperationPrefix,
    },
    beforeBasket,
    finalBasket,
    latestPool: {
      total: latestPool.total,
      eligibleResearchCandidates: latestPool.eligibleResearchCandidates,
      completeDisplayReadyCount: latestPool.metricCompletenessSummary.completeDisplayReadyCount,
      completenessPercent: latestPool.metricCompletenessSummary.completenessPercent,
      dispositionCounts: countsBy(latestPool.candidates.map((candidate) => candidate.disposition)),
      leaderStatusCounts: countsBy(latestPool.candidates.map((candidate) => candidate.leaderEvidence.status)),
      topMissingMetrics: latestPool.metricCompletenessSummary.topMissingMetrics.slice(0, 12),
      eligibleSymbols: latestPool.candidates
        .filter((candidate) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
        .map((candidate) => ({
          symbol: candidate.identity.symbol,
          name: candidate.identity.name,
          tradeDate: candidate.generatedAt,
          disposition: candidate.disposition,
          candidateGrade: candidate.candidateGrade,
          evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
          leaderVerificationStatus: candidate.leaderEvidence.status,
          blockedReasons: candidate.blockedReasons,
        })),
    },
    chunks,
    decision: status === 'completed'
      ? 'dividend_low_vol_basket_research_grade_completed'
      : 'return_to_development_plan_candidate_expansion_or_data_source_upgrade',
    riskAssessment: {
      fatalSpecDeviation: 0,
      majorSpecDeviation: 0,
      falseAcceptanceRisk: status === 'completed' ? 'controlled_by_component_count_and_evidence_refs' : 'controlled_by_blocked_status',
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    },
  }
  const reportPath = resolve(auditDir, `dividend-low-vol-basket-candidate-expansion-${GENERATED_AT.replace(/[:.]/g, '-')}.json`)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    reportPath,
    status: report.status,
    stoppedReason,
    durationMs: report.durationMs,
    beforeBasket: report.beforeBasket,
    finalBasket: report.finalBasket,
    chunks: report.chunks.map((chunk) => ({
      chunkIndex: chunk.chunkIndex,
      offset: chunk.offset,
      actualChunkSize: chunk.actualChunkSize,
      persisted: chunk.persisted,
      eligibleResearchCandidates: chunk.pool.eligibleResearchCandidates,
      selectedCandidateCount: chunk.basketAfterChunk.snapshot?.selectedCandidateCount,
      basketStatus: chunk.basketAfterChunk.status,
      blockedReasons: chunk.basketAfterChunk.blockedReasons,
    })),
    latestExpansionAuditFile: await latestExpansionAuditPath(),
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
