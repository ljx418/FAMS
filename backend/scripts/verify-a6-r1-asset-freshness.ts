import { strict as assert } from 'node:assert'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { positionService } from '../src/services/position/positionService.js'
import { operationService } from '../src/services/operation/operationService.js'

const userId = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'
const terminalStatuses = new Set(['completed', 'succeeded', 'partial', 'failed', 'cancelled'])

async function waitForOperation(operationId: string) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    const operation = await operationService.getOperation(operationId) as any
    if (terminalStatuses.has(operation.status)) return operation
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }
  throw new Error(`refresh operation did not finish in time: ${operationId}`)
}

async function main() {
  const beforeTransactions = await prisma.transaction.count({ where: { userId } })
  const openPositions = await prisma.position.findMany({
    where: { userId, status: 'open' },
    include: { asset: true },
  })
  assert.ok(openPositions.length > 0, 'real acceptance account must contain open positions')

  const summaryBefore = await positionService.getPositionSummary(userId)
  const directTotal = openPositions.reduce((sum, position) => sum + Number(position.marketValue || 0), 0)
  assert.ok(Math.abs(summaryBefore.totalValue - directTotal) <= 0.01, 'summary total must match real position rows')
  assert.equal(summaryBefore.priceFreshness.thresholdHours, 12)
  assert.ok(['fresh', 'stale', 'missing', 'refreshing'].includes(summaryBefore.priceFreshness.status))

  const idempotencyKey = `a6-r1-real-refresh:${userId}:${Date.now()}`
  const [first, second] = await Promise.all([
    operationService.startRefreshPricesOperation({
      userId,
      reason: 'stale_on_entry',
      createdBy: 'acceptance:a6-r1',
      idempotencyKey,
    }),
    operationService.startRefreshPricesOperation({
      userId,
      reason: 'stale_on_entry',
      createdBy: 'acceptance:a6-r1',
      idempotencyKey,
    }),
  ]) as any[]
  assert.equal(first.id, second.id, 'concurrent refresh requests must reuse one operation')

  const completed = await waitForOperation(first.id)
  assert.ok(terminalStatuses.has(completed.status))
  const refreshRows = Array.isArray(completed.result?.results) ? completed.result.results : []
  const duplicateWriteFailures = refreshRows.filter((item: any) => String(item.error || '').includes('Unique constraint failed'))
  assert.equal(duplicateWriteFailures.length, 0, 'repeat quote persistence must be idempotent')
  assert.ok(Number(completed.result?.externalRefreshed || completed.result?.refreshed || 0) > 0, 'real refresh must persist at least one external quote')
  const summaryAfter = await positionService.getPositionSummary(userId)
  const afterRows = await prisma.position.findMany({ where: { userId, status: 'open' } })
  const directAfter = afterRows.reduce((sum, position) => sum + Number(position.marketValue || 0), 0)
  assert.ok(Math.abs(summaryAfter.totalValue - directAfter) <= 0.01, 'refreshed summary must match real position rows')

  const afterTransactions = await prisma.transaction.count({ where: { userId } })
  assert.equal(afterTransactions, beforeTransactions, 'price refresh must not create transaction facts')

  const audit = {
    schemaVersion: 'fams.a6.r1.asset_freshness_audit.v1',
    generatedAt: new Date().toISOString(),
    userId,
    realData: true,
    openPositionCount: openPositions.length,
    directTotalBefore: directTotal,
    summaryTotalBefore: summaryBefore.totalValue,
    directTotalAfter: directAfter,
    summaryTotalAfter: summaryAfter.totalValue,
    freshnessBefore: summaryBefore.priceFreshness,
    freshnessAfter: summaryAfter.priceFreshness,
    refreshOperation: {
      operationId: first.id,
      status: completed.status,
      idempotencyKey,
      concurrentRequestReused: first.id === second.id,
      duplicateWriteFailureCount: duplicateWriteFailures.length,
      result: completed.result,
    },
    accountFactGuard: {
      transactionCountBefore: beforeTransactions,
      transactionCountAfter: afterTransactions,
      unchanged: beforeTransactions === afterTransactions,
    },
    gates: {
      summaryMatchesPositionRows: Math.abs(summaryAfter.totalValue - directAfter) <= 0.01,
      thresholdHoursIs12: summaryAfter.priceFreshness.thresholdHours === 12,
      refreshRequestIsIdempotent: first.id === second.id,
      quotePersistenceIsIdempotent: duplicateWriteFailures.length === 0,
      transactionFactsUnchanged: beforeTransactions === afterTransactions,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
    overallStatus: 'passed',
  }

  const outputDir = resolve(process.cwd(), '..', 'docs', 'automation-audits', 'a6-feedback-remediation', 'R1')
  await mkdir(outputDir, { recursive: true })
  await writeFile(resolve(outputDir, 'asset-freshness-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ overallStatus: audit.overallStatus, operationId: first.id, status: completed.status, totalValue: summaryAfter.totalValue }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
