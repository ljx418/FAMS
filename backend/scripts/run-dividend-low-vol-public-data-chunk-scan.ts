import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dividendLowVolInputBuilderService } from '../src/services/dividend-low-vol/dividendLowVolInputBuilderService.js'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { dividendLowVolUniverseService } from '../src/services/dividend-low-vol/dividendLowVolUniverseService.js'
import { prisma } from '../src/db/prisma.js'

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

function numberArg(name: string, fallback: number) {
  const raw = arg(name) || process.env[`FAMS_DIVIDEND_LOW_VOL_${name.toUpperCase()}`]
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback
}

function countsBy<T extends string>(items: T[]) {
  const map = new Map<T, number>()
  for (const item of items) map.set(item, (map.get(item) || 0) + 1)
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count)
}

function detectCatastrophicProviderFailure(pool: ReturnType<typeof dividendLowVolStrategyService.buildCandidatePool>, chunkSize: number) {
  if (chunkSize < 50) return null
  const missingByMetric = new Map(pool.metricCompletenessSummary.topMissingMetrics.map((item) => [item.metric, item.count]))
  const coreMarketMissingThreshold = Math.ceil(chunkSize * 0.6)
  const coreFundamentalMissingThreshold = Math.ceil(chunkSize * 0.8)
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
      message: 'The whole chunk is missing market, dividend, valuation and quality metrics. Persistence is blocked to avoid polluting the trusted candidate pool.',
      evidence: {
        chunkSize,
        completeDisplayReadyCount: pool.metricCompletenessSummary.completeDisplayReadyCount,
        topMissingMetrics: pool.metricCompletenessSummary.topMissingMetrics.slice(0, 12),
      },
    }
  }
  return null
}

async function main() {
  const startedAt = new Date()
  const userId = arg('userId') || process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const tradeDate = arg('tradeDate') || new Date().toISOString().slice(0, 10)
  const offset = numberArg('offset', 0)
  const chunkSize = Math.max(1, numberArg('chunkSize', Number(process.env.FAMS_DIVIDEND_LOW_VOL_CHUNK_SIZE || 250)))
  const targetLimit = Math.max(offset + chunkSize, numberArg('targetLimit', offset + chunkSize))
  const sourceOperationId = arg('operationId') || `dividend-low-vol-public-chunk:${tradeDate}:${offset}:${chunkSize}`
  const universe = await dividendLowVolUniverseService.getAllAShareInputs({ limit: targetLimit })
  const chunk = universe.inputs.slice(offset, offset + chunkSize)
  const inputs = await dividendLowVolInputBuilderService.buildFromInputs(chunk, chunk.length)
  const universeSummary = {
    ...universe.summary,
    scanMode: 'chunked_public_free_source_scan',
    targetLimit,
    offset,
    chunkSize,
    actualChunkSize: chunk.length,
  }
  const dryRunChunkPool = dividendLowVolStrategyService.buildCandidatePool(inputs, { universeSummary })
  const persistenceBlocker = detectCatastrophicProviderFailure(dryRunChunkPool, chunk.length)
  const chunkPool = persistenceBlocker
    ? dryRunChunkPool
    : await dividendLowVolStrategyService.persistCandidatePool(userId, inputs, {
      tradeDate,
      sourceOperationId,
      universeSummary,
    })
  const cumulativePool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit: targetLimit,
    scope: 'all_latest_by_symbol',
  })
  const generatedAt = new Date().toISOString()
  const report = {
    schemaVersion: 'dividend.low_vol.public_data_chunk_scan_report.v1',
    generatedAt,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    userId,
    tradeDate,
    sourceOperationId,
    chunk: {
      offset,
      chunkSize,
      targetLimit,
      actualChunkSize: chunk.length,
      nextOffset: offset + chunk.length,
      exhausted: offset + chunk.length >= universe.summary.prefilteredCount || chunk.length < chunkSize,
      symbols: chunk.map((item) => item.symbol),
    },
    persistence: {
      persisted: !persistenceBlocker,
      blockedReason: persistenceBlocker?.code,
      blocker: persistenceBlocker,
      sourceOperationId,
      note: persistenceBlocker
        ? 'This chunk was evaluated in dry-run mode only. Existing persisted candidates were left unchanged.'
        : 'This chunk was persisted to DividendLowVolDaily.',
    },
    universeSummary: universe.summary,
    chunkPool: {
      total: chunkPool.total,
      completeDisplayReadyCount: chunkPool.metricCompletenessSummary.completeDisplayReadyCount,
      incompleteDisplayCount: chunkPool.metricCompletenessSummary.incompleteDisplayCount,
      eligibleResearchCandidates: chunkPool.eligibleResearchCandidates,
      topMissingMetrics: chunkPool.metricCompletenessSummary.topMissingMetrics.slice(0, 12),
      dispositionCounts: countsBy(chunkPool.candidates.map((candidate) => candidate.disposition)),
      eligibleSymbols: chunkPool.candidates
        .filter((candidate) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
        .map((candidate) => ({
          symbol: candidate.identity.symbol,
          name: candidate.identity.name,
          disposition: candidate.disposition,
          evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
          leaderVerificationStatus: candidate.leaderEvidence.status,
        })),
    },
    cumulativePool: {
      total: cumulativePool.total,
      completeDisplayReadyCount: cumulativePool.metricCompletenessSummary.completeDisplayReadyCount,
      incompleteDisplayCount: cumulativePool.metricCompletenessSummary.incompleteDisplayCount,
      completenessPercent: cumulativePool.metricCompletenessSummary.completenessPercent,
      eligibleResearchCandidates: cumulativePool.eligibleResearchCandidates,
      topMissingMetrics: cumulativePool.metricCompletenessSummary.topMissingMetrics.slice(0, 12),
      dispositionCounts: countsBy(cumulativePool.candidates.map((candidate) => candidate.disposition)),
      leaderStatusCounts: countsBy(cumulativePool.candidates.map((candidate) => candidate.leaderEvidence.status)),
      eligibleSymbols: cumulativePool.candidates
        .filter((candidate) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
        .map((candidate) => ({
          symbol: candidate.identity.symbol,
          name: candidate.identity.name,
          disposition: candidate.disposition,
          evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
          leaderVerificationStatus: candidate.leaderEvidence.status,
        })),
    },
    policy: {
      notTradingAdvice: true,
      sourceClass: 'free_public_research_sources',
      allowedActions: cumulativePool.policy.allowedActions,
      prohibitedActions: cumulativePool.policy.prohibitedActions,
      note: 'Chunked scan expands research evidence coverage only. It does not unlock ADD, REDUCE, or AUTO_TRADE.',
    },
  }
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const reportPath = resolve(auditDir, `dividend-low-vol-public-data-chunk-scan-${generatedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    reportPath,
    durationMs: report.durationMs,
    chunk: report.chunk,
    persistence: report.persistence,
    chunkPool: report.chunkPool,
    cumulativePool: report.cumulativePool,
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
