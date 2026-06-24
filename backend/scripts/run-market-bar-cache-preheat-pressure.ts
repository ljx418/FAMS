import { prisma } from '../src/db/prisma.js'
import { operationService } from '../src/services/operation/operationService.js'
import { ensureUser } from '../src/utils/user.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

function parseNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function parseBooleanEnv(name: string, fallback = false) {
  const value = process.env[name]
  if (value == null) return fallback
  return /^(1|true|yes)$/i.test(value)
}

function sizeBytes(value: unknown) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

async function main() {
  requireDevDbMutationAcknowledgement('run-market-bar-cache-preheat-pressure')

  const userId = process.env.FAMS_MARKET_BAR_PRESSURE_USER_ID || 'default'
  const limit = parseNumberEnv('FAMS_MARKET_BAR_PRESSURE_LIMIT', 80)
  const days = parseNumberEnv('FAMS_MARKET_BAR_PRESSURE_DAYS', 120)
  const chunkSize = parseNumberEnv('FAMS_MARKET_BAR_PRESSURE_CHUNK_SIZE', 20)
  const concurrency = parseNumberEnv('FAMS_MARKET_BAR_PRESSURE_CONCURRENCY', 4)
  const forceRefresh = parseBooleanEnv('FAMS_MARKET_BAR_PRESSURE_FORCE', true)
  const workerId = process.env.FAMS_MARKET_BAR_PRESSURE_WORKER_ID || 'market-bar-cache-preheat-pressure-worker'

  await ensureUser(prisma, userId)

  const queued = await operationService.startMarketBarCachePreheatOperation({
    userId,
    limit,
    days,
    chunkSize,
    concurrency,
    forceRefresh,
    executionMode: 'queued',
    createdBy: 'verification',
  })
  if (queued.status !== 'queued') {
    throw new Error(`Expected queued pressure operation, got ${queued.status}`)
  }

  const startedAt = Date.now()
  const worker = await operationService.runNextQueuedOperation({
    types: ['market_bar_cache_preheat' as any],
    workerId,
  })
  const elapsedMs = Date.now() - startedAt
  if (!worker.claimed || worker.operation?.id !== queued.id) {
    throw new Error(`Expected pressure worker to claim operation ${queued.id}, got ${worker.reason}`)
  }

  const completed = await operationService.getOperation(queued.id)
  if (!['completed', 'partial'].includes(completed.status)) {
    throw new Error(`Expected completed or partial pressure operation, got ${completed.status}`)
  }

  const result = completed.result || {}
  const artifactRef = completed.artifactRefs.find((ref: string) => ref.includes('market_bar_cache_preheat_report.json'))
  if (!artifactRef) {
    throw new Error('Expected pressure operation artifact ref')
  }
  const artifact = await operationService.getArtifact(artifactRef)
  const report = artifact.data as Record<string, any>
  const providerHealth = await prisma.providerHealth.findUnique({ where: { provider: 'sina' } })
  const tasks = completed.tasks || []
  const failedTasks = tasks.filter((task: any) => task.status === 'failed')
  const timeoutWarnings = [
    completed.errorSummary,
    ...tasks.flatMap((task: any) => [
      ...(Array.isArray(task.warnings) ? task.warnings : []),
      task.error?.message,
    ]),
  ].filter(Boolean).filter((message: string) => /timeout|timed out|database is locked/i.test(message))

  if (failedTasks.length > 0) {
    throw new Error(`Expected no failed pressure chunks, got ${failedTasks.length}`)
  }
  if (timeoutWarnings.length > 0) {
    throw new Error(`Pressure run exposed timeout/database-lock warnings: ${timeoutWarnings.slice(0, 3).join('; ')}`)
  }

  console.log(JSON.stringify({
    ok: true,
    operationId: completed.id,
    status: completed.status,
    elapsedMs,
    input: {
      limit,
      days,
      chunkSize,
      concurrency,
      forceRefresh,
    },
    result: {
      schemaVersion: result.schemaVersion,
      requestedSymbols: result.requestedSymbols,
      attemptedSymbols: result.attemptedSymbols,
      successCount: result.successCount,
      warningCount: result.warningCount,
      failureCount: result.failureCount,
      coverageWarningCount: result.coverageWarningCount,
      fetchedBars: result.fetchedBars,
      beforeCoverage: result.beforeCoverage,
      afterCoverage: result.afterCoverage,
    },
    tasks: {
      count: tasks.length,
      completed: tasks.filter((task: any) => task.status === 'completed').length,
      partial: tasks.filter((task: any) => task.status === 'partial').length,
      failed: failedTasks.length,
      totalSuccess: tasks.reduce((sum: number, task: any) => sum + (task.successCount || 0), 0),
      totalFailure: tasks.reduce((sum: number, task: any) => sum + (task.failureCount || 0), 0),
      avgCacheHitRate: tasks.length > 0
        ? Number((tasks.reduce((sum: number, task: any) => sum + (task.cacheHitRate || 0), 0) / tasks.length).toFixed(2))
        : null,
      maxDurationMs: tasks.reduce((max: number, task: any) => Math.max(max, task.durationMs || 0), 0),
    },
    artifact: {
      ref: artifactRef,
      reportBytes: sizeBytes(report),
      chunkReports: Array.isArray(report.chunkReports) ? report.chunkReports.length : 0,
    },
    providerHealth: providerHealth ? {
      provider: providerHealth.provider,
      status: providerHealth.status,
      circuitState: providerHealth.circuitState,
      requestCount: providerHealth.requestCount,
      successCount: providerHealth.successCount,
      failureCount: providerHealth.failureCount,
      timeoutCount: providerHealth.timeoutCount,
      consecutiveFailures: providerHealth.consecutiveFailures,
      lastError: providerHealth.lastError,
    } : null,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
