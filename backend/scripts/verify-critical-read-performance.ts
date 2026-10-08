import 'dotenv/config'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'

const baseUrl = process.env.FAMS_API_URL || 'http://127.0.0.1:4000'
const userId = process.env.FAMS_USER_ID || 'default'
const p95BudgetMs = Number(process.env.FAMS_CRITICAL_READ_P95_BUDGET_MS || 1500)
const maxBudgetMs = Number(process.env.FAMS_CRITICAL_READ_MAX_BUDGET_MS || 3000)

type Sample = { status: number; durationMs: number; bytes: number }

const percentile = (values: number[], ratio: number) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] || 0
}

async function sample(path: string) {
  const warmupStarted = performance.now()
  const warmup = await fetch(`${baseUrl}${path}`)
  const warmupBody = await warmup.text()
  assert.equal(warmup.status, 200, `${path} warmup returned ${warmup.status}`)
  assert.ok(warmupBody.length > 2, `${path} warmup returned an empty body`)
  const samples: Sample[] = []
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now()
    const response = await fetch(`${baseUrl}${path}`)
    const body = await response.text()
    samples.push({
      status: response.status,
      durationMs: Number((performance.now() - started).toFixed(2)),
      bytes: Buffer.byteLength(body),
    })
  }
  const durations = samples.map((item) => item.durationMs)
  return {
    path,
    warmupMs: Number((performance.now() - warmupStarted).toFixed(2)),
    statusCodes: [...new Set(samples.map((item) => item.status))],
    responseBytes: [...new Set(samples.map((item) => item.bytes))],
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    maxMs: Math.max(...durations),
    samples,
  }
}

async function main() {
  const templatesResponse = await fetch(`${baseUrl}/api/v1/portfolio-backtest/templates`)
  assert.equal(templatesResponse.status, 200)
  const templates = await templatesResponse.json() as any
  const strategyIds = (templates.templates || []).map((item: any) => item.strategyId).filter(Boolean).slice(0, 6)
  const paths = [
    `/api/v1/investment-workflow/readiness?userId=${encodeURIComponent(userId)}`,
    `/api/v1/relative-rotation/holdings?userId=${encodeURIComponent(userId)}&frequency=weekly&trail=12`,
    '/api/v1/portfolio-backtest/templates',
    `/api/v1/portfolio-backtest/runs?userId=${encodeURIComponent(userId)}&limit=20`,
    `/api/v1/portfolio-backtest/runs/latest-compatible?userId=${encodeURIComponent(userId)}&strategyIds=${encodeURIComponent(strategyIds.join(','))}`,
    `/api/v1/daily-reviews?userId=${encodeURIComponent(userId)}&page=1&pageSize=20`,
    `/api/v1/analysis/advice-summaries?userId=${encodeURIComponent(userId)}&limit=50`,
    `/api/v1/backtest/scenario-comparison/point-in-time-sources?userId=${encodeURIComponent(userId)}`,
  ]
  const protectedBefore = {
    positions: await prisma.position.count({ where: { userId, status: 'open' } }),
    transactions: await prisma.transaction.count({ where: { userId } }),
    operations: await prisma.operation.count({ where: { userId } }),
  }
  const results = []
  for (const path of paths) results.push(await sample(path))
  const protectedAfter = {
    positions: await prisma.position.count({ where: { userId, status: 'open' } }),
    transactions: await prisma.transaction.count({ where: { userId } }),
    operations: await prisma.operation.count({ where: { userId } }),
  }
  assert.deepEqual(protectedAfter, protectedBefore, 'critical read performance test changed protected account facts')
  for (const result of results) {
    assert.deepEqual(result.statusCodes, [200], `${result.path} returned a non-200 status`)
    assert.ok(result.p95Ms <= p95BudgetMs, `${result.path} p95 ${result.p95Ms}ms exceeds ${p95BudgetMs}ms`)
    assert.ok(result.maxMs <= maxBudgetMs, `${result.path} max ${result.maxMs}ms exceeds ${maxBudgetMs}ms`)
    assert.equal(result.responseBytes.length, 1, `${result.path} response size changed across warm reads`)
  }
  const audit = {
    schemaVersion: 'fams.critical_read_performance_audit.v1',
    generatedAt: new Date().toISOString(),
    status: 'passed',
    realData: true,
    userId,
    budgets: { p95Ms: p95BudgetMs, maxMs: maxBudgetMs },
    protectedBefore,
    protectedAfter,
    results,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const dir = resolve(process.cwd(), 'data', 'gpt-audit', 'critical-read-performance', audit.generatedAt.replace(/[:.]/g, '-'))
  await mkdir(dir, { recursive: true })
  const auditPath = resolve(dir, 'critical_read_performance_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(async () => prisma.$disconnect())
