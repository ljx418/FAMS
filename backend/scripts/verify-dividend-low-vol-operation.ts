import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { operationRoutes } from '../src/routes/operation.js'
import { prisma } from '../src/db/prisma.js'

async function waitForOperation(app: Awaited<ReturnType<typeof Fastify>>, operationId: string) {
  const terminal = new Set(['completed', 'succeeded', 'failed', 'cancelled', 'partial'])
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/operations/${operationId}`,
    })
    assert.equal(response.statusCode, 200)
    const operation = response.json()
    if (terminal.has(operation.status)) {
      return operation
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Operation ${operationId} did not reach terminal status`)
}

async function main() {
  const app = Fastify({ logger: false })
  await app.register(operationRoutes, { prefix: '/api/v1/operations' })
  await app.ready()

  const startResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/operations/dividend-low-vol-daily-scan',
    payload: {
      userId: 'default',
      symbols: ['600000', '000001'],
      limit: 2,
      executionMode: 'inline',
    },
  })
  assert.equal(startResponse.statusCode, 200)
  const started = startResponse.json()
  assert.equal(started.type, 'dividend_low_vol_daily_scan')
  assert.ok(['queued', 'running', 'completed', 'succeeded'].includes(started.status))

  const completed = await waitForOperation(app, started.id)
  assert.equal(completed.status, 'completed')
  assert.equal(completed.result.schemaVersion, 'dividend.low_vol.operation_result.v1')
  assert.equal(completed.result.pool.schemaVersion, 'dividend.low_vol.candidate_pool.v1')
  assert.equal(completed.result.pool.strategyFamily, 'dividend_low_volatility')
  assert.deepEqual(completed.result.policy.prohibitedActions, ['ADD', 'REDUCE', 'AUTO_TRADE'])
  assert.ok(completed.artifactRefs.some((ref: string) => ref.startsWith('dividend-low-vol:daily-scan:')))
  assert.ok(completed.tasks.some((task: any) => task.name === 'dividend_low_vol.daily_scan' && task.status === 'completed'))
  assert.ok(completed.nextActions.some((action: any) => action.type === 'open_analysis'))

  const persistedRows = await prisma.dividendLowVolDaily.findMany({
    where: { sourceOperationId: started.id },
    orderBy: { symbol: 'asc' },
  })
  assert.equal(persistedRows.length, 2)
  assert.ok(persistedRows.every((row) => row.strategyId === 'dividend_low_vol_leader_v1'))
  assert.ok(persistedRows.every((row) => row.disciplineJson.includes('AUTO_TRADE')))

  console.log(JSON.stringify({
    ok: true,
    operation: {
      id: completed.id,
      status: completed.status,
      type: completed.type,
      progressPct: completed.progressPct,
      taskCount: completed.tasks.length,
      nextActions: completed.nextActions.map((action: any) => action.type),
    },
    result: {
      schemaVersion: completed.result.schemaVersion,
      total: completed.result.pool.total,
      prohibitedActions: completed.result.policy.prohibitedActions,
    },
    persisted: {
      rows: persistedRows.length,
      symbols: persistedRows.map((row) => row.symbol),
      dispositions: persistedRows.map((row) => row.disposition),
    },
  }, null, 2))

  await app.close()
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
