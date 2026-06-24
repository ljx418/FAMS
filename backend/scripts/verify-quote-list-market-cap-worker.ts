import { operationService } from '../src/services/operation/operationService.js'
import { prisma } from '../src/db/prisma.js'
import { ensureUser } from '../src/utils/user.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function main() {
  requireDevDbMutationAcknowledgement('verify-quote-list-market-cap-worker')
  const userId = 'default'
  await ensureUser(prisma, userId)

  const queued = await operationService.startQuoteListMarketCapWarmupOperation({
    userId,
    limit: 4,
    chunkSize: 2,
    executionMode: 'queued',
    createdBy: 'verification',
  })
  if (queued.status !== 'queued') {
    throw new Error(`Expected queued quote-list market cap warmup operation, got ${queued.status}`)
  }

  const worker = await operationService.runNextQueuedOperation({
    types: ['quote_list_market_cap_warmup' as any],
    workerId: 'quote-list-market-cap-worker-verification',
  })
  if (!worker.claimed || worker.operation?.id !== queued.id) {
    throw new Error(`Expected worker to claim quote-list market cap operation, got ${worker.reason}`)
  }

  const completed = await operationService.getOperation(queued.id)
  if (!['completed', 'partial'].includes(completed.status)) {
    throw new Error(`Expected completed or partial quote-list market cap operation, got ${completed.status}`)
  }
  if (!Array.isArray(completed.artifactRefs) || !completed.artifactRefs.some((ref: string) => ref.includes('quote_list_market_cap_warmup_report.json'))) {
    throw new Error('Expected quote-list market cap warmup artifact ref')
  }
  const tasks = completed.tasks || []
  if (tasks.length !== 2 || tasks.some((task: any) => !['completed', 'partial'].includes(task.status))) {
    throw new Error('Expected two completed or partial quote-list market cap warmup chunk tasks')
  }
  const totalSuccess = tasks.reduce((sum: number, task: any) => sum + (task.successCount || 0), 0)
  const totalFailure = tasks.reduce((sum: number, task: any) => sum + (task.failureCount || 0), 0)
  if (totalSuccess + totalFailure < 4) {
    throw new Error(`Expected all 4 symbols to be accounted for, got success=${totalSuccess}, failure=${totalFailure}`)
  }
  if (totalSuccess < 1) {
    throw new Error(`Expected at least 1 successful market cap derivation, got ${totalSuccess}`)
  }
  const health = await prisma.providerHealth.findUnique({ where: { provider: 'baostock_market_cap' } })
  if (!health) {
    throw new Error('Expected baostock_market_cap provider health row')
  }
  if (health.endpoint !== 'quote_list_market_cap') {
    throw new Error(`Expected quote_list_market_cap endpoint, got ${health.endpoint}`)
  }
  if (health.successCount < totalSuccess) {
    throw new Error(`Expected provider health successCount >= ${totalSuccess}, got ${health.successCount}`)
  }

  const artifact = await operationService.getArtifact(completed.artifactRefs.find((ref: string) => ref.includes('quote_list_market_cap_warmup_report.json')))
  if (!artifact?.data || typeof artifact.data !== 'object') {
    throw new Error('Expected readable quote-list market cap artifact data')
  }
  const report = artifact.data as { failureCount?: number; failedSymbols?: Array<{ symbol?: string; warning?: string }> }
  if (completed.status === 'partial') {
    if (!report.failureCount || report.failureCount < 1) {
      throw new Error('Expected partial quote-list market cap artifact to include failureCount')
    }
    if (!Array.isArray(report.failedSymbols) || report.failedSymbols.length < 1 || !report.failedSymbols[0]?.warning) {
      throw new Error('Expected partial quote-list market cap artifact to include failedSymbols with warning')
    }
  }

  console.log(JSON.stringify({
    ok: true,
    operationId: completed.id,
    status: completed.status,
    tasks: tasks.map((task: any) => ({
      chunkIndex: task.chunkIndex,
      status: task.status,
      successCount: task.successCount,
      failureCount: task.failureCount,
      provider: task.provider,
    })),
    providerHealth: {
      provider: health.provider,
      endpoint: health.endpoint,
      status: health.status,
      requestCount: health.requestCount,
      successCount: health.successCount,
      failureCount: health.failureCount,
    },
    totalSuccess,
    totalFailure,
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
