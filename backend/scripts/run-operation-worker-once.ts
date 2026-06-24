import { operationService } from '../src/services/operation/operationService.js'
import { prisma } from '../src/db/prisma.js'

async function main() {
  const type = process.env.FAMS_OPERATION_WORKER_TYPE
  const result = await operationService.runNextQueuedOperation({
    types: type ? [type as any] : undefined,
    workerId: process.env.FAMS_OPERATION_WORKER_ID || 'manual-worker-once',
  })
  console.log(JSON.stringify({
    event: 'worker_once_finished',
    claimed: result.claimed,
    reason: result.reason,
    operationId: result.operation?.id || null,
    status: result.operation?.status || null,
    type: result.operation?.type || null,
    artifactRefs: result.operation?.artifactRefs || [],
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
