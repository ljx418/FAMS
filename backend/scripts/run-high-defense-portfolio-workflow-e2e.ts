import assert from 'node:assert/strict'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { prisma } from '../src/db/prisma.js'

const TERMINAL = new Set(['completed', 'partial', 'failed', 'cancelled'])
const IDEMPOTENCY_KEY = process.env.FAMS_ACCEPTANCE_IDEMPOTENCY_KEY || 'high-defense-fix-2026-09-15-v1'

async function protectedCounts() {
  const [positions, transactions, externalOrders] = await Promise.all([
    prisma.position.count({ where: { userId: 'default' } }),
    prisma.transaction.count({ where: { userId: 'default' } }),
    prisma.externalOrderObservation.count({ where: { userId: 'default' } }),
  ])
  return { positions, transactions, externalOrders }
}

async function main() {
  const before = await protectedCounts()
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/mcp/portfolioStdio.js'],
    cwd: process.cwd(),
    env: {
      ...getDefaultEnvironment(),
      DATABASE_URL: process.env.DATABASE_URL || 'file:./prisma/dev.db',
      FAMS_MCP_USER_ID: 'default',
    },
    stderr: 'pipe',
  })
  let stderr = ''
  transport.stderr?.on('data', (chunk) => { stderr += String(chunk) })
  const client = new Client({ name: 'fams-high-defense-e2e', version: '1.0.0' })
  await client.connect(transport)
  try {
    const currentResult = await client.callTool({ name: 'portfolio_get_current_state', arguments: { accountScope: 'alipay' } })
    assert.notEqual(currentResult.isError, true)
    const current = currentResult.structuredContent as any
    const alipay = current.allocationPlan.accounts.find((account: any) => account.id === 'alipay')
    assert.equal(current.allocationPlan.strategyContract.id, 'approved_allocation_v3_high_defense_10_15_50_25_2026')
    assert.equal(current.allocationPlan.strategyContract.status, 'active')
    assert.deepEqual(alipay.buckets.map((bucket: any) => [bucket.key, bucket.targetRatio]), [
      ['cash', 10], ['gold', 15], ['bond', 50], ['equity', 25],
    ])
    assert.equal(current.allocationPlan.strategyActions.rebalanceRequired, false)

    const preflightResult = await client.callTool({
      name: 'portfolio_review_preflight',
      arguments: { portfolioChangedSinceLastCapture: false },
    })
    assert.notEqual(preflightResult.isError, true)
    const preflight = preflightResult.structuredContent as any
    assert.equal(preflight.canRun, true, `preflight blocked: ${(preflight.blockers || []).join(',')}`)

    const startResult = await client.callTool({
      name: 'portfolio_review_start',
      arguments: {
        sessionType: 'manual',
        portfolioChangedSinceLastCapture: false,
        idempotencyKey: IDEMPOTENCY_KEY,
      },
    })
    assert.notEqual(startResult.isError, true)
    const started = startResult.structuredContent as any
    assert.equal(started.started, true)
    assert.ok(started.operationId)

    let result: any = null
    const deadline = Date.now() + 12 * 60_000
    while (Date.now() < deadline) {
      const fetched = await client.callTool({
        name: 'portfolio_review_get',
        arguments: { operationId: started.operationId },
      })
      assert.notEqual(fetched.isError, true)
      result = fetched.structuredContent as any
      if (TERMINAL.has(result.operation.status)) break
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
    assert.ok(result && TERMINAL.has(result.operation.status), 'portfolio workflow did not reach a terminal state')
    assert.deepEqual(result.review?.tradeDrafts || [], [], 'within-threshold review must expose zero trade drafts')

    const reviewRow = result.review?.id
      ? await prisma.dailyReviewRun.findUnique({ where: { id: result.review.id } })
      : null
    const report = reviewRow?.reportJson ? JSON.parse(reviewRow.reportJson) : {}
    const llmFailureCode = report.llmGate?.failureCode || null
    const llmError = Array.isArray(report.errors) ? report.errors.find((item: any) => item.step === 'llm_synthesis') : null
    const deterministicPassed = result.review?.tradeDrafts?.length === 0
      && current.allocationPlan.strategyActions.rebalanceRequired === false
      && preflight.sourceSnapshot?.reconciliation === 'exact'
    const workflowOutcome = result.operation.status === 'completed'
      ? 'passed'
      : deterministicPassed && llmFailureCode
        ? 'conditional_pass_external_llm_blocked'
        : 'failed'

    const after = await protectedCounts()
    assert.deepEqual(after, before, 'workflow must not mutate positions, transactions, or external orders')
    process.stdout.write(`${JSON.stringify({
      status: workflowOutcome,
      operation: result.operation,
      review: result.review ? {
        id: result.review.id,
        status: result.review.status,
        tradeDraftCount: result.review.tradeDrafts?.length || 0,
        reportHref: result.review.reportHref,
      } : null,
      strategy: current.allocationPlan.strategyContract,
      currentTotal: alipay.currentValue,
      buckets: alipay.buckets.map((bucket: any) => ({
        key: bucket.key,
        currentRatio: bucket.currentRatio,
        targetRatio: bucket.targetRatio,
        deviationPctPoint: bucket.deviationPctPoint,
        triggered: bucket.triggered,
      })),
      sourceReconciliation: preflight.sourceSnapshot?.reconciliation,
      llm: {
        passed: report.llmGate?.passed === true,
        failureCode: llmFailureCode,
        error: llmError?.message || null,
      },
      protectedTablesUnchanged: true,
      stderr: stderr.trim() || null,
    }, null, 2)}\n`)
    if (workflowOutcome === 'failed') process.exitCode = 1
  } finally {
    await client.close()
    await prisma.$disconnect()
  }
}

main().catch(async (error) => {
  await prisma.$disconnect().catch(() => undefined)
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`)
  process.exitCode = 1
})
