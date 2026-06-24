import { prisma } from '../src/db/prisma.js'
import { operationService } from '../src/services/operation/operationService.js'
import { ensureUser } from '../src/utils/user.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  requireDevDbMutationAcknowledgement('verify-market-bar-cache-preheat-worker')

  const userId = 'default'
  await ensureUser(prisma, userId)

  const queued = await operationService.startMarketBarCachePreheatOperation({
    userId,
    limit: 4,
    days: 120,
    chunkSize: 2,
    concurrency: 2,
    forceRefresh: true,
    executionMode: 'queued',
    createdBy: 'verification',
  })
  assert(queued.status === 'queued', `Expected queued market bar cache preheat operation, got ${queued.status}`)

  const startedAt = Date.now()
  const worker = await operationService.runNextQueuedOperation({
    types: ['market_bar_cache_preheat' as any],
    workerId: 'market-bar-cache-preheat-verification',
  })
  const elapsedMs = Date.now() - startedAt
  assert(worker.claimed && worker.operation?.id === queued.id, `Expected worker to claim market bar preheat operation, got ${worker.reason}`)

  const completed = await operationService.getOperation(queued.id)
  assert(['completed', 'partial'].includes(completed.status), `Expected completed or partial market bar preheat operation, got ${completed.status}`)
  assert(!completed.leaseOwner && !completed.leaseToken && !completed.leaseExpiresAt, 'Expected completed market bar preheat operation to release worker lease')
  assert(Array.isArray(completed.artifactRefs), 'Expected operation artifactRefs array')
  const reportRef = completed.artifactRefs.find((ref: string) => ref.includes('market_bar_cache_preheat_report.json'))
  assert(reportRef, 'Expected market_bar_cache_preheat_report.json artifact ref')

  const tasks = completed.tasks || []
  assert(tasks.length >= 1, 'Expected at least one market bar cache preheat task')
  assert(tasks.every((task: any) => ['completed', 'partial'].includes(task.status)), 'Expected all preheat tasks to be completed or partial')
  const preheatTasks = tasks.filter((task: any) => task.taskType === 'market_bar.cache_preheat')
  const featureTask = tasks.find((task: any) => task.taskType === 'market_feature.compute')
  assert(preheatTasks.length >= 1, 'Expected at least one market_bar.cache_preheat task')
  assert(preheatTasks.every((task: any) => typeof task.cacheHitRate === 'number'), 'Expected every preheat chunk task to record cacheHitRate')
  assert(featureTask, 'Expected market_feature.compute task after K-line preheat')
  assert(featureTask.successCount >= 1, 'Expected market_feature.compute to generate feature cache for at least one symbol')

  const result = completed.result || {}
  assert(result.schemaVersion === 'fams.market_bar.cache_preheat_result.v1', 'Expected market bar preheat result schemaVersion')
  assert(result.requestedSymbols === 4, `Expected requestedSymbols=4, got ${result.requestedSymbols}`)
  assert(typeof result.attemptedSymbols === 'number', 'Expected attemptedSymbols in result')
  assert(result.beforeCoverage && result.afterCoverage, 'Expected beforeCoverage and afterCoverage in result')

  const artifact = await operationService.getArtifact(reportRef)
  assert(artifact?.data && typeof artifact.data === 'object', 'Expected readable market bar cache preheat artifact data')
  const report = artifact.data as Record<string, any>
  assert(report.schemaVersion === 'fams.market_bar.cache_preheat_report.v1', 'Expected market bar preheat artifact schemaVersion')
  assert(report.beforeCoverage && report.afterCoverage, 'Expected coverage snapshots in artifact')
  assert(Array.isArray(report.chunkReports), 'Expected chunkReports in artifact')

  const cancelled = await operationService.startMarketBarCachePreheatOperation({
    userId,
    limit: 4,
    days: 30,
    chunkSize: 10,
    concurrency: 1,
    executionMode: 'queued',
    createdBy: 'verification',
  })
  const cancelledOperation = await operationService.cancelOperation(cancelled.id)
  assert(cancelledOperation.status === 'cancelled', `Expected queued preheat operation to cancel immediately, got ${cancelledOperation.status}`)
  assert(cancelledOperation.cancelRequested === true, 'Expected cancelled preheat operation to set cancelRequested')

  const expired = await prisma.operation.create({
    data: {
      userId,
      type: 'market_bar_cache_preheat',
      status: 'running',
      startedAt: new Date(Date.now() - 60_000),
      progressPct: 25,
      progressCurrent: 1,
      progressTotal: 4,
      progressMessage: '模拟 worker 中断的 K 线预热',
      createdBy: 'verification',
      leaseOwner: 'dead-market-bar-worker',
      leaseToken: 'dead-market-bar-worker-token',
      leaseExpiresAt: new Date(Date.now() - 30_000),
      heartbeatAt: new Date(Date.now() - 60_000),
      inputJson: JSON.stringify({
        userId,
        limit: 2,
        days: 5,
        chunkSize: 10,
        concurrency: 1,
        forceRefresh: false,
        executionMode: 'queued',
      }),
      idempotencyKey: `verify-market-bar-cache-preheat-recovery-${Date.now()}`,
    },
  })

  const recovered = await operationService.runNextQueuedOperation({
    types: ['market_bar_cache_preheat' as any],
    workerId: 'market-bar-cache-preheat-recovery-verification',
  })
  assert(recovered.claimed && recovered.operation?.id === expired.id, 'Expected worker to recover expired market bar preheat operation')

  const recoveredOperation = await operationService.getOperation(expired.id)
  assert(['completed', 'partial'].includes(recoveredOperation.status), `Expected recovered preheat operation to finish, got ${recoveredOperation.status}`)
  assert(recoveredOperation.recovery?.reason === 'expired_lease_worker_recovery', 'Expected recovered preheat operation to record worker recovery reason')

  console.log(JSON.stringify({
    ok: true,
    operationId: completed.id,
    status: completed.status,
    elapsedMs,
    result: {
      requestedSymbols: result.requestedSymbols,
      attemptedSymbols: result.attemptedSymbols,
      successCount: result.successCount,
      warningCount: result.warningCount,
      failureCount: result.failureCount,
      fetchedBars: result.fetchedBars,
      afterSufficientSymbols: result.afterCoverage?.sufficientSymbols,
      afterInsufficientSymbols: result.afterCoverage?.insufficientSymbols,
      featureReport: result.featureReport,
    },
    tasks: preheatTasks.map((task: any) => ({
      chunkIndex: task.chunkIndex,
      status: task.status,
      successCount: task.successCount,
      failureCount: task.failureCount,
      provider: task.provider,
      cacheHitRate: task.cacheHitRate,
      durationMs: task.durationMs,
    })),
    featureTask: {
      status: featureTask.status,
      successCount: featureTask.successCount,
      failureCount: featureTask.failureCount,
      metrics: featureTask.metrics,
    },
    cancelled: {
      operationId: cancelledOperation.id,
      status: cancelledOperation.status,
      cancelRequested: cancelledOperation.cancelRequested,
    },
    recovered: {
      operationId: recoveredOperation.id,
      status: recoveredOperation.status,
      recovery: recoveredOperation.recovery,
    },
    artifactRefs: completed.artifactRefs,
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
