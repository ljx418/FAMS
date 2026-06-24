import { prisma } from '../src/db/prisma.js'
import { operationService } from '../src/services/operation/operationService.js'
import { ensureUser } from '../src/utils/user.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function main() {
  requireDevDbMutationAcknowledgement('verify-operation-worker-readiness')

  const userId = 'default'
  await ensureUser(prisma, userId)

  const queued = await operationService.startStockScreenerFullScanOperation({
    userId,
    query: '多策略胜率；全A样本；扫描上限=2；分片大小=10；验证天数=5；持有天数=3；跳过事实集预热=1',
    mode: 'default',
    executionMode: 'queued',
  })
  if (queued.status !== 'queued') {
    throw new Error(`Expected queued worker operation, got ${queued.status}`)
  }

  const startedAt = Date.now()
  const workerResult = await operationService.runNextQueuedOperation({
    types: ['stock_screener_full_scan' as any],
    workerId: 'verification-worker',
  })
  const elapsedMs = Date.now() - startedAt
  if (!workerResult.claimed || !workerResult.operation) {
    throw new Error(`Expected worker to claim operation, got ${workerResult.reason}`)
  }

  const completed = await operationService.getOperation(queued.id)
  if (!['completed', 'partial'].includes(completed.status)) {
    throw new Error(`Expected worker operation to finish, got ${completed.status}`)
  }
  if (completed.leaseOwner || completed.leaseToken || completed.leaseExpiresAt) {
    throw new Error('Expected worker operation to release lease after completion')
  }
  const taskNames = new Set((completed.tasks || []).map((task: any) => task.name))
  for (const required of ['universe.snapshot', 'market_data.warmup', 'market_feature.coverage', 'strategy.evaluate', 'backtest.aggregate', 'artifact.generate']) {
    if (!taskNames.has(required)) {
      throw new Error(`Expected worker operation task ${required}`)
    }
  }
  const strategyTask = (completed.tasks || []).find((task: any) => task.name === 'strategy.evaluate')
  if (!strategyTask?.metrics?.featureFirst) {
    throw new Error('Expected strategy.evaluate to run feature-first current screening')
  }
  if (strategyTask.metrics.featureFirstEvaluatedCount < 1) {
    throw new Error('Expected feature-first screening to evaluate at least one symbol')
  }
  const featureCandidates = (completed.result?.candidates || []).filter((candidate: any) => candidate.historySource === 'feature:market_feature_daily')
  if (featureCandidates.length < 1) {
    throw new Error('Expected current candidates to be sourced from market_feature_daily')
  }
  if (!Array.isArray(completed.artifactRefs) || completed.artifactRefs.length === 0) {
    throw new Error('Expected worker operation to write artifact refs')
  }

  const expired = await prisma.operation.create({
    data: {
      userId,
      type: 'stock_screener_full_scan',
      status: 'running',
      startedAt: new Date(Date.now() - 60_000),
      progressPct: 33,
      progressMessage: '模拟 worker 中断的选股扫描',
      createdBy: 'system',
      leaseOwner: 'dead-worker',
      leaseToken: 'dead-worker-token',
      leaseExpiresAt: new Date(Date.now() - 30_000),
      heartbeatAt: new Date(Date.now() - 60_000),
      inputJson: JSON.stringify({
        userId,
        query: '多策略胜率；全A样本；扫描上限=2；分片大小=10；验证天数=5；持有天数=3；跳过事实集预热=1',
        mode: 'default',
        confirmedFullScan: false,
        executionMode: 'queued',
      }),
    },
  })

  const recovered = await operationService.runNextQueuedOperation({
    types: ['stock_screener_full_scan' as any],
    workerId: 'verification-recovery-worker',
  })
  if (!recovered.claimed || recovered.operation?.id !== expired.id) {
    throw new Error('Expected worker to recover expired stock_screener_full_scan operation')
  }
  const recoveredOperation = await operationService.getOperation(expired.id)
  if (!['completed', 'partial'].includes(recoveredOperation.status)) {
    throw new Error(`Expected recovered screener operation to finish, got ${recoveredOperation.status}`)
  }
  if (recoveredOperation.recovery?.reason !== 'expired_lease_worker_recovery') {
    throw new Error('Expected recovered screener operation to record worker recovery reason')
  }

  const idle = await operationService.runNextQueuedOperation({
    types: ['stock_screener_full_scan' as any],
    workerId: 'verification-idle-worker',
  })
  if (idle.claimed) {
    throw new Error('Expected worker to be idle after verification operations')
  }

  console.log(JSON.stringify({
    ok: true,
    queuedOperationId: queued.id,
    recoveredOperationId: expired.id,
    elapsedMs,
    completed: {
      status: completed.status,
      tasks: completed.tasks?.length || 0,
      artifactRefs: completed.artifactRefs.length,
    },
    recovered: {
      status: recoveredOperation.status,
      recovery: recoveredOperation.recovery,
    },
    idleReason: idle.reason,
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
