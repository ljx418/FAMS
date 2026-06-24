import { prisma } from '../src/db/prisma.js'
import { factsetRefreshScheduler, isAshareTradingWindow } from '../src/services/operation/factsetRefreshScheduler.js'
import { positionAdviceService } from '../src/services/position/positionAdviceService.js'
import { ensureUser } from '../src/utils/user.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function waitForTerminalOperation(operationId: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const operation = await prisma.operation.findUnique({ where: { id: operationId } })
    if (operation && ['completed', 'partial', 'failed', 'cancelled'].includes(operation.status)) {
      return operation
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error(`Operation ${operationId} did not finish`)
}

async function main() {
  requireDevDbMutationAcknowledgement('verify-factset-refresh-scheduler')
  process.env.FAMS_FACTSET_SCHEDULER_LIMIT = '1'
  process.env.FAMS_FACTSET_SCHEDULER_HORIZON_MINUTES = '0'
  process.env.FAMS_DIVIDEND_LOW_VOL_DAILY_SCHEDULER_LIMIT = '1'
  const userId = 'default'
  await ensureUser(prisma, userId)

  const tradingTime = new Date('2026-05-21T02:00:00.000Z') // 10:00 Asia/Shanghai
  if (!isAshareTradingWindow(tradingTime, 'Asia/Shanghai')) {
    throw new Error('Expected 2026-05-21 10:00 Asia/Shanghai to be trading window')
  }
  const tradingSkip = await factsetRefreshScheduler.runOnce('verification_trading_window', console, tradingTime)
  if (tradingSkip.reason !== 'trading_window') {
    throw new Error(`Expected scheduler to skip during trading window, got ${tradingSkip.reason}`)
  }

  await prisma.schedulerLease.upsert({
    where: { name: 'factset_refresh' },
    create: {
      name: 'factset_refresh',
      leaseOwner: 'other-scheduler',
      leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
      heartbeatAt: new Date(),
      lastResultJson: JSON.stringify({ verification: true }),
    },
    update: {
      leaseOwner: 'other-scheduler',
      leaseExpiresAt: new Date(Date.now() + 10 * 60_000),
      heartbeatAt: new Date(),
    },
  })
  const leaseSkip = await factsetRefreshScheduler.runOnce('verification_lease_blocked', console, new Date('2026-05-21T12:00:00.000Z'))
  if (leaseSkip.reason !== 'scheduler_lease_not_acquired') {
    throw new Error(`Expected scheduler lease skip, got ${leaseSkip.reason}`)
  }
  await prisma.schedulerLease.update({
    where: { name: 'factset_refresh' },
    data: {
      leaseOwner: null,
      leaseExpiresAt: null,
      heartbeatAt: new Date(),
    },
  })

  const position = await prisma.position.findFirst({
    where: { userId, status: 'open' },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })
  if (position) {
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
  }

  const afterHours = new Date('2026-05-21T12:00:00.000Z') // 20:00 Asia/Shanghai
  const scheduled = await factsetRefreshScheduler.runOnce('verification_after_hours', console, afterHours)
  if (position && (!scheduled.submitted || !scheduled.operation?.id)) {
    throw new Error(`Expected scheduler to submit after-hours due refresh, got ${scheduled.reason}`)
  }
  if (!scheduled.dividendLowVolDailyScan?.submitted || !scheduled.dividendLowVolDailyScan?.operationId) {
    throw new Error(`Expected scheduler to submit dividend low vol daily scan, got ${JSON.stringify(scheduled.dividendLowVolDailyScan)}`)
  }
  const completed = position ? await waitForTerminalOperation(scheduled.operation.id) : null
  if (completed && completed.status !== 'completed' && completed.status !== 'partial') {
    throw new Error(`Expected scheduled operation to complete or partial, got ${completed.status}`)
  }
  if (completed && completed.createdBy !== 'scheduler') {
    throw new Error(`Expected scheduled operation createdBy=scheduler, got ${completed.createdBy}`)
  }

  console.log(JSON.stringify({
    ok: true,
    tradingSkip: {
      reason: tradingSkip.reason,
      skipped: tradingSkip.skipped,
    },
    leaseSkip: {
      reason: leaseSkip.reason,
      skipped: leaseSkip.skipped,
    },
    scheduled: {
      submitted: scheduled.submitted,
      reason: scheduled.reason,
      due: scheduled.due,
      dividendLowVolDailyScan: scheduled.dividendLowVolDailyScan,
    },
    operation: completed ? {
      id: completed.id,
      status: completed.status,
      createdBy: completed.createdBy,
      progressPct: completed.progressPct,
    } : null,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    factsetRefreshScheduler.stop()
    await prisma.$disconnect()
  })
