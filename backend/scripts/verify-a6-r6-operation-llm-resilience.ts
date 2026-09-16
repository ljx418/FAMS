import { strict as assert } from 'node:assert'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { operationService } from '../src/services/operation/operationService.js'
import { dailyReviewSynthesisService, getDailyReviewLlmReadiness } from '../src/services/review/dailyReviewSynthesisService.js'

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

async function main() {
  const root = resolve(process.cwd(), '..')
  const userId = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'
  const operations = await operationService.listOperations({ userId, limit: 200 }) as any[]
  assert.ok(operations.length > 0, 'real Operation history is required')
  assert.ok(operations.every((item) => ['user_task', 'background_maintenance'].includes(item.taskGroup)))
  assert.ok(operations.every((item) => ['available', 'partial', 'none'].includes(item.resultAvailability)))
  assert.ok(operations.every((item) => ['active', 'completed', 'partial', 'failed', 'core_result_available_enrichment_failed'].includes(item.outcomeCategory)))
  const userTasks = operations.filter((item) => item.taskGroup === 'user_task')
  const backgroundMaintenance = operations.filter((item) => item.taskGroup === 'background_maintenance')
  const needsAttention = operations.filter((item) => (
    ['failed', 'partial', 'cancelled'].includes(item.status)
    || item.outcomeCategory === 'core_result_available_enrichment_failed'
  ))
  assert.equal(userTasks.length + backgroundMaintenance.length, operations.length, 'task grouping must preserve complete history')
  const coreResultFailures = operations.filter((item) => item.outcomeCategory === 'core_result_available_enrichment_failed')
  coreResultFailures.forEach((item) => assert.notEqual(item.resultAvailability, 'none'))

  const reviewRows = await prisma.dailyReviewRun.findMany({
    where: { userId },
    orderBy: { generatedAt: 'desc' },
    take: 30,
    select: { id: true, generatedAt: true, status: true, reportJson: true },
  })
  const selected = reviewRows
    .map((row) => ({ ...row, report: parseJson<any>(row.reportJson, {}) }))
    .find((row) => row.report?.decisionSummary && Array.isArray(row.report?.attentionCandidates))
  assert.ok(selected, 'a persisted real daily review with synthesis input is required')

  const before = await Promise.all([
    prisma.advice.count({ where: { userId } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.position.count({ where: { userId, status: 'open' } }),
  ])
  const readiness = getDailyReviewLlmReadiness()
  assert.equal(readiness.enabled, true, 'real LLM must be enabled for R6 acceptance')
  const synthesis = await dailyReviewSynthesisService.synthesize({
    strategyAssessment: selected.report.strategy?.assessment,
    decisionSummary: selected.report.decisionSummary,
    attentionCandidates: selected.report.attentionCandidates,
    assets: selected.report.assets,
    portfolioComparison: selected.report.portfolioComparison || null,
  }) as any
  assert.equal(synthesis.status, 'available', `strict real LLM failed after finite failover: ${synthesis.failureCode || 'unknown'}`)
  assert.equal(synthesis.source, 'llm', 'deterministic fallback cannot count as LLM success')
  assert.ok(synthesis.attemptCount >= 1 && synthesis.attemptCount <= 2, 'provider attempts must be finite')
  assert.equal(synthesis.providerAttempts.length, synthesis.attemptCount)
  assert.equal(synthesis.providerAttempts.at(-1)?.outcome, 'succeeded')
  synthesis.providerAttempts.forEach((attempt: Record<string, unknown>) => {
    assert.deepEqual(Object.keys(attempt).sort(), ['failureCode', 'httpStatus', 'model', 'outcome', 'provider'])
  })
  if (synthesis.providerAttempts.length === 2) {
    assert.equal(synthesis.providerAttempts[0].provider, 'deepseek')
    assert.equal(synthesis.providerAttempts[0].outcome, 'failed')
    assert.equal(synthesis.providerAttempts[1].provider, 'minimax')
  }
  const after = await Promise.all([
    prisma.advice.count({ where: { userId } }),
    prisma.transaction.count({ where: { userId } }),
    prisma.position.count({ where: { userId, status: 'open' } }),
  ])
  assert.deepEqual(after, before, 'R6 acceptance must not change protected account facts')

  const frontendSource = await readFile(resolve(root, 'frontend/src/pages/Operations.tsx'), 'utf8')
  assert.ok(frontendSource.includes("useState<'user_task' | 'needs_attention' | 'background_maintenance' | 'all'>('user_task')"))
  assert.ok(frontendSource.includes('核心结果可用'))
  assert.ok(frontendSource.includes('内容增强失败'))

  const audit = {
    schemaVersion: 'fams.a6.r6.operation_llm_resilience_audit.v1',
    generatedAt: new Date().toISOString(),
    realData: true,
    persistedReview: { id: selected.id, generatedAt: selected.generatedAt, status: selected.status },
    operationHistory: {
      total: operations.length,
      userTaskCount: userTasks.length,
      needsAttentionCount: needsAttention.length,
      backgroundMaintenanceCount: backgroundMaintenance.length,
      coreResultEnrichmentFailureCount: coreResultFailures.length,
      historyPreserved: true,
    },
    llm: {
      primaryProvider: readiness.provider,
      failoverAvailable: readiness.failoverAvailable,
      maximumAttempts: readiness.maximumAttempts,
      finalProvider: synthesis.provider,
      attemptCount: synthesis.attemptCount,
      providerAttempts: synthesis.providerAttempts,
      deterministicFallbackCountedAsSuccess: false,
      secretsRedacted: true,
    },
    protectedCountsBefore: { advice: before[0], transaction: before[1], openPosition: before[2] },
    protectedCountsAfter: { advice: after[0], transaction: after[1], openPosition: after[2] },
    tradeBoundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    overallStatus: 'passed',
  }
  const output = resolve(root, 'docs/automation-audits/a6-feedback-remediation/R6/operation-llm-resilience-audit.json')
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    overallStatus: audit.overallStatus,
    operationHistory: audit.operationHistory,
    llm: audit.llm,
  }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
