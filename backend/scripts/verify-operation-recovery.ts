import { prisma } from '../src/db/prisma.js'
import { operationService } from '../src/services/operation/operationService.js'
import { ensureUser } from '../src/utils/user.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function waitForTerminalOperation(operationId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const operation = await operationService.getOperation(operationId)
    if (['completed', 'partial', 'failed', 'cancelled'].includes(operation.status)) {
      return operation
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Operation ${operationId} did not finish after recovery`)
}

async function main() {
  requireDevDbMutationAcknowledgement('verify-operation-recovery')
  const userId = 'default'
  await ensureUser(prisma, userId)

  const protectedOperation = await prisma.operation.create({
    data: {
      userId,
      type: 'batch_factset_refresh',
      status: 'running',
      startedAt: new Date(),
      progressPct: 10,
      progressMessage: '模拟仍有有效租约的事实集刷新任务',
      createdBy: 'system',
      leaseOwner: 'other-worker',
      leaseToken: 'other-worker-token',
      leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
      heartbeatAt: new Date(),
      inputJson: JSON.stringify({
        userId,
        scope: 'position_advice',
        limit: 1,
      }),
    },
  })

  const operation = await prisma.operation.create({
    data: {
      userId,
      type: 'batch_factset_refresh',
      status: 'running',
      startedAt: new Date(Date.now() - 60_000),
      progressPct: 40,
      progressCurrent: 0,
      progressTotal: 1,
      progressMessage: '模拟服务中断前的事实集刷新任务',
      createdBy: 'system',
      leaseOwner: 'dead-worker',
      leaseToken: 'dead-worker-token',
      leaseExpiresAt: new Date(Date.now() - 60_000),
      heartbeatAt: new Date(Date.now() - 120_000),
      inputJson: JSON.stringify({
        userId,
        scope: 'position_advice',
        limit: 1,
      }),
      recoveryJson: JSON.stringify({ simulated: true }),
    },
  })

  const recovery = await operationService.recoverInterruptedOperations()
  if (!recovery.operationIds.includes(operation.id)) {
    throw new Error(`Expected recovery to include operation ${operation.id}`)
  }
  if (recovery.operationIds.includes(protectedOperation.id)) {
    throw new Error('Expected recovery to skip operation with active lease')
  }

  const completed = await waitForTerminalOperation(operation.id)
  if (completed.status !== 'completed' && completed.status !== 'partial') {
    throw new Error(`Expected recovered operation to complete or partial, got ${completed.status}`)
  }
  if (completed.recovery?.reason !== 'server_startup') {
    throw new Error('Expected recovered operation to record recovery metadata')
  }
  if (completed.leaseOwner || completed.leaseExpiresAt) {
    throw new Error('Expected completed recovered operation to release its lease owner and expiry')
  }
  if (completed.leaseToken) {
    throw new Error('Expected completed recovered operation to release its lease token')
  }

  const positionTask = completed.tasks?.find((task: any) => task.name === 'position_advice.refresh')
  if (!positionTask || positionTask.status !== 'completed') {
    throw new Error('Expected recovered operation to complete position_advice.refresh task')
  }
  if ((positionTask.successCount || 0) + (positionTask.failureCount || 0) < 1) {
    throw new Error('Expected recovered task to process at least one position')
  }

  const idempotencyKey = `verify-operation-recovery:${Date.now()}`
  const existingIdempotentOperation = await prisma.operation.create({
    data: {
      userId,
      type: 'batch_factset_refresh',
      status: 'queued',
      createdBy: 'system',
      idempotencyKey,
      inputJson: JSON.stringify({
        userId,
        scope: 'position_advice',
        limit: 1,
      }),
    },
  })
  const idempotentResult = await operationService.startBatchFactsetRefreshOperation({
    userId,
    scope: 'position_advice',
    limit: 1,
    createdBy: 'system',
    idempotencyKey,
  })
  if (idempotentResult.id !== existingIdempotentOperation.id) {
    throw new Error('Expected idempotencyKey conflict to return the existing operation')
  }

  console.log(JSON.stringify({
    ok: true,
    recoveredCount: recovery.recoveredCount,
    operationId: operation.id,
    status: completed.status,
    progress: completed.progressPct,
    idempotentOperationId: idempotentResult.id,
    recovery: completed.recovery,
    task: {
      name: positionTask.name,
      status: positionTask.status,
      successCount: positionTask.successCount,
      failureCount: positionTask.failureCount,
    },
  }, null, 2))

  await prisma.operation.update({
    where: { id: protectedOperation.id },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
      cancelRequested: true,
      leaseOwner: null,
      leaseToken: null,
      leaseExpiresAt: null,
      heartbeatAt: new Date(),
      errorSummary: 'Verification cleanup',
      errorJson: JSON.stringify({ message: 'Verification cleanup' }),
    },
  })

  await prisma.operation.update({
    where: { id: existingIdempotentOperation.id },
    data: {
      status: 'cancelled',
      completedAt: new Date(),
      cancelRequested: true,
      errorSummary: 'Verification cleanup',
      errorJson: JSON.stringify({ message: 'Verification cleanup' }),
    },
  })
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
