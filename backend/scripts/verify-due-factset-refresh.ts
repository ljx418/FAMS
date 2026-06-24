import { prisma } from '../src/db/prisma.js'
import { operationService } from '../src/services/operation/operationService.js'
import { positionAdviceService } from '../src/services/position/positionAdviceService.js'
import { ensureUser } from '../src/utils/user.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function waitForTerminalOperation(operationId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const operation = await operationService.getOperation(operationId)
    if (['completed', 'partial', 'failed', 'cancelled'].includes(operation.status)) {
      return operation
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Operation ${operationId} did not finish`)
}

async function main() {
  requireDevDbMutationAcknowledgement('verify-due-factset-refresh')
  const userId = 'default'
  await ensureUser(prisma, userId)

  const openPositions = await prisma.position.findMany({
    where: { userId, status: 'open' },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })
  const stockPositions = openPositions.filter((position) => position.asset.type === 'stock')
  if (stockPositions.length > 1) {
    const futureAt = new Date(Date.now() + 24 * 60 * 60_000)
    const expiredAt = new Date(Date.now() - 60_000)
    const lowRankStock = stockPositions[stockPositions.length - 1]
    for (const stockPosition of stockPositions) {
      const isLowRankStock = stockPosition.id === lowRankStock.id
      await prisma.stockFactSetCache.upsert({
        where: {
          symbol_market_factsetType_factsetSchemaVersion_lookbackDays_timeframe: {
            symbol: stockPosition.asset.symbol.toUpperCase(),
            market: 'A股',
            factsetType: 'stock_full_analysis',
            factsetSchemaVersion: 'stock.analysis.factset.v1',
            lookbackDays: 80,
            timeframe: '1d',
          },
        },
        create: {
          assetId: stockPosition.assetId,
          symbol: stockPosition.asset.symbol.toUpperCase(),
          market: 'A股',
          factsetType: 'stock_full_analysis',
          factsetSchemaVersion: 'stock.analysis.factset.v1',
          lookbackDays: 80,
          timeframe: '1d',
          status: 'fresh',
          summaryJson: '{}',
          factsJson: '{}',
          analysisJson: '{}',
          staleAt: isLowRankStock ? expiredAt : futureAt,
          nextRefreshAfter: isLowRankStock ? expiredAt : futureAt,
        },
        update: {
          status: 'fresh',
          staleAt: isLowRankStock ? expiredAt : futureAt,
          nextRefreshAfter: isLowRankStock ? expiredAt : futureAt,
        },
      })
    }

    const stockDue = await operationService.scheduleDueFactsetRefresh({
      userId,
      scope: 'stock_factset',
      horizonMinutes: 0,
      limit: 1,
      submit: false,
      force: true,
    })
    if (stockDue.due.stockFactsetCount !== 1 || stockDue.due.symbols[0] !== lowRankStock.asset.symbol.toUpperCase()) {
      throw new Error(`Expected due scan to find low-rank stale stock ${lowRankStock.asset.symbol}, got ${stockDue.due.symbols.join(',')}`)
    }
  }

  const position = await prisma.position.findFirst({
    where: { userId, status: 'open' },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })
  if (!position) throw new Error('No open position available for due factset verification')

  await positionAdviceService.getPositionAdvice(position.id, { forceRefresh: true })
  const expiredAt = new Date(Date.now() - 60_000)
  await prisma.positionAdviceCache.update({
    where: {
      userId_positionId_factsetSchemaVersion: {
        userId,
        positionId: position.id,
        factsetSchemaVersion: 'position.advice.factset.v1',
      },
    },
    data: {
      status: 'fresh',
      staleAt: expiredAt,
      nextRefreshAfter: expiredAt,
    },
  })

  const scheduled = await operationService.scheduleDueFactsetRefresh({
    userId,
    scope: 'position_advice',
    horizonMinutes: 0,
    limit: 1,
    force: true,
  })
  if (!scheduled.submitted || !scheduled.operation?.id) {
    throw new Error(`Expected due factset refresh to submit an operation, got ${scheduled.reason}`)
  }
  if (scheduled.due.positionAdviceCount < 1) {
    throw new Error('Expected due factset refresh to find at least one due position advice cache')
  }

  const completed = await waitForTerminalOperation(scheduled.operation.id)
  if (completed.status !== 'completed' && completed.status !== 'partial') {
    throw new Error(`Expected due refresh operation to complete or partial, got ${completed.status}`)
  }
  const task = completed.tasks?.find((item: any) => item.name === 'position_advice.refresh')
  if (!task || task.status !== 'completed') {
    throw new Error('Expected position_advice.refresh task to complete')
  }

  console.log(JSON.stringify({
    ok: true,
    scheduled: {
      submitted: scheduled.submitted,
      reason: scheduled.reason,
      due: scheduled.due,
    },
    operation: {
      id: completed.id,
      status: completed.status,
      createdBy: completed.createdBy,
      progress: completed.progressPct,
      task: {
        name: task.name,
        status: task.status,
        successCount: task.successCount,
        failureCount: task.failureCount,
      },
    },
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
