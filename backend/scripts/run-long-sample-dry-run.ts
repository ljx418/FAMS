import { operationService } from '../src/services/operation/operationService.js'
import { prisma } from '../src/db/prisma.js'
import { marketBarCacheService } from '../src/services/market-data/marketBarCacheService.js'
import { stockScreenerService } from '../src/services/screener/stockScreenerService.js'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function parseNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function percent(numerator: number, denominator: number) {
  return denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(2)) : 0
}

async function runPreflight(params: { userId: string; scanLimit: number; days: number }) {
  const { universe, universeSource, universeTotal } = await stockScreenerService.resolveStockUniverseForPreheat(params.userId, {
    maxUniverse: params.scanLimit,
  })
  const symbols = universe.map((asset) => asset.symbol)
  const coverage = await marketBarCacheService.getCoverageReport(symbols, params.days, 'CN', { forceRebuild: true })
  const providerHealth = await marketBarCacheService.getProviderHealthReport()
  const sinaHealth = providerHealth.find((item: any) => item.provider === 'sina') || providerHealth[0]
  const providerRequests = Number(sinaHealth?.requestCount || 0)
  const providerSuccessRate = providerRequests > 0
    ? percent(Number(sinaHealth?.successCount || 0), providerRequests)
    : 100
  const scanCoveragePercent = percent(coverage.sufficientSymbols, coverage.totalSymbols)
  const evaluatedCount = coverage.sufficientSymbols
  const evaluatedCoveragePercent = percent(evaluatedCount, coverage.totalSymbols)
  const gates = [
    {
      id: 'scan_coverage',
      actual: scanCoveragePercent,
      required: '>= 80',
      passed: scanCoveragePercent >= 80,
    },
    {
      id: 'provider_success_rate',
      actual: providerSuccessRate,
      required: '>= 95',
      passed: providerSuccessRate >= 95,
    },
    {
      id: 'cache_hit_rate',
      actual: coverage.estimatedCacheHitRate,
      required: '>= 80',
      passed: coverage.estimatedCacheHitRate >= 80,
    },
    {
      id: 'evaluated_to_scanned',
      actual: evaluatedCoveragePercent,
      required: '>= 80',
      passed: evaluatedCoveragePercent >= 80,
    },
  ]
  const passed = gates.every((gate) => gate.passed)
  return {
    passed,
    schemaVersion: 'fams.long_sample.market_data_preflight.v1',
    generatedAt: new Date().toISOString(),
    universeSource,
    universeTotal,
    scanLimit: params.scanLimit,
    requestedDays: params.days,
    scannedCount: coverage.totalSymbols,
    evaluatedCount,
    scanCoveragePercent,
    providerSuccessRate,
    cacheHitRate: coverage.estimatedCacheHitRate,
    providerHealth: sinaHealth
      ? {
          provider: sinaHealth.provider,
          requestCount: sinaHealth.requestCount,
          successCount: sinaHealth.successCount,
          failureCount: sinaHealth.failureCount,
          timeoutCount: sinaHealth.timeoutCount,
          badDataCount: sinaHealth.badDataCount,
          lastError: sinaHealth.lastError,
        }
      : null,
    gates,
    failureSummary: coverage.warningSummary,
    warmupCommands: [
      'npm run run:quote-list-canonical-refresh',
      `FAMS_MARKET_BAR_PREHEAT_LIMIT=${params.scanLimit} FAMS_MARKET_BAR_PREHEAT_DAYS=${params.days} npm run run:market-bar-cache-preheat`,
      `FAMS_LONG_SAMPLE_SCAN_LIMIT=${params.scanLimit} npm run run:long-sample-controlled`,
    ],
    insufficientSamples: coverage.items
      .filter((item) => !item.sufficient)
      .slice(0, 50)
      .map((item) => ({
        symbol: item.symbol,
        cachedBars: item.cachedBars,
        latestDate: item.latestDate,
        status: item.status,
        category: item.warningCategory,
        retryable: item.retryable,
        recommendedAction: item.recommendedAction,
      })),
  }
}

async function main() {
  const userId = process.env.FAMS_LONG_SAMPLE_USER_ID || 'default'
  const timeoutMs = parseNumberEnv('FAMS_LONG_SAMPLE_DRY_RUN_TIMEOUT_MS', 20 * 60 * 1000)
  const pollMs = parseNumberEnv('FAMS_LONG_SAMPLE_DRY_RUN_POLL_MS', 3000)
  const scanLimit = parseNumberEnv('FAMS_LONG_SAMPLE_SCAN_LIMIT', 120)
  const preflightDays = parseNumberEnv('FAMS_LONG_SAMPLE_PREFLIGHT_DAYS', parseNumberEnv('FAMS_MARKET_BAR_PREHEAT_DAYS', 180))
  const backtestDays = parseNumberEnv('FAMS_LONG_SAMPLE_BACKTEST_DAYS', 60)
  const holdingDays = parseNumberEnv('FAMS_LONG_SAMPLE_HOLDING_DAYS', 3)
  const chunkSize = parseNumberEnv('FAMS_LONG_SAMPLE_CHUNK_SIZE', 100)
  const skipFactsetPreheat = process.env.FAMS_LONG_SAMPLE_SKIP_FACTSET_PREHEAT !== '0'
  const query = process.env.FAMS_LONG_SAMPLE_QUERY || [
    '多策略胜率',
    '全A样本',
    `扫描上限=${scanLimit}`,
    `验证天数=${backtestDays}`,
    `持有天数=${holdingDays}`,
    `分片大小=${chunkSize}`,
    skipFactsetPreheat ? '跳过事实集预热=1' : '跳过事实集预热=0',
  ].join('；')
  const startedAt = Date.now()

  const preflight = await runPreflight({ userId, scanLimit, days: preflightDays })
  console.log(JSON.stringify({
    event: 'market_data_preflight',
    ...preflight,
  }, null, 2))
  if (!preflight.passed) {
    process.exitCode = 2
    return
  }

  const operation = await operationService.startStockScreenerFullScanOperation({
    userId,
    mode: 'long_sample_dry_run',
    query,
  })
  const operationId = operation.id
  console.log(JSON.stringify({
    event: 'submitted',
    operationId,
    mode: 'long_sample_dry_run',
    userId,
    query: operation.input?.query,
  }))

  let lastProgress = -1
  while (Date.now() - startedAt < timeoutMs) {
    const current = await operationService.getOperation(operationId)
    if (current.progressPct !== lastProgress) {
      lastProgress = current.progressPct
      console.log(JSON.stringify({
        event: 'progress',
        operationId,
        status: current.status,
        progressPct: current.progressPct,
        progressMessage: current.progressMessage || null,
      }))
    }

    if (['completed', 'succeeded', 'failed', 'cancelled', 'partial'].includes(current.status)) {
      const artifactRef = (current.artifactRefs || []).find((ref: string) => ref.endsWith(':long_sample_acceptance.json'))
      const artifact = artifactRef ? await operationService.getArtifact(artifactRef) : null
      const acceptance = artifact?.data as any
      console.log(JSON.stringify({
        event: 'finished',
        operationId,
        status: current.status,
        artifactRef,
        longSampleStatus: acceptance?.status || null,
        summary: acceptance?.summary || null,
        failedGates: Array.isArray(acceptance?.gates)
          ? acceptance.gates.filter((gate: any) => gate.status !== 'passed').map((gate: any) => ({
            id: gate.id,
            status: gate.status,
            severity: gate.severity,
            actual: gate.actual,
            required: gate.required,
          }))
          : [],
        recommendations: acceptance?.recommendations || [],
      }, null, 2))
      if (current.status === 'failed' || current.status === 'cancelled') {
        process.exitCode = 1
      }
      return
    }

    await sleep(pollMs)
  }

  await operationService.cancelOperation(operationId)
  throw new Error(`long sample dry-run timed out after ${timeoutMs}ms; operation ${operationId} was cancelled`)
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
