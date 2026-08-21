import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { PrismaClient } from '@prisma/client'
import { databaseConfig, prisma } from '../src/db/prisma.js'

const USER_ID = 'default'
const API_BASE = process.env.FAMS_REAL_E2E_API_BASE || 'http://127.0.0.1:4000'
const repoRoot = resolve(import.meta.dirname, '../..')
const evidenceRoot = resolve(repoRoot, '.verification/daily-review-v1/DRV1-7')
const auditRoot = resolve(repoRoot, 'backend/data/gpt-audit/daily-portfolio-review-v1/DRV1-7')

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, normalize(item)]))
  }
  return value
}

function hash(value: unknown) {
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex')
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function closeTo(actual: unknown, expected: number, label: string) {
  const numeric = Number(actual)
  assert.ok(Number.isFinite(numeric), `${label} 非有限数：${String(actual)}`)
  assert.ok(Math.abs(numeric - expected) <= 1e-10, `${label} 不一致：actual=${numeric}, expected=${expected}`)
}

async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  assert.ok(response.ok, `${path} HTTP ${response.status}: ${JSON.stringify(payload)}`)
  return payload as T
}

async function protectedSnapshot(client: PrismaClient = prisma) {
  const [positions, transactions, externalOrders] = await Promise.all([
    client.position.findMany({ where: { userId: USER_ID }, orderBy: { id: 'asc' } }),
    client.transaction.findMany({ where: { userId: USER_ID }, orderBy: { id: 'asc' } }),
    client.externalOrderObservation.findMany({ where: { userId: USER_ID }, orderBy: { id: 'asc' } }),
  ])
  return {
    position: { count: positions.length, hash: hash(positions) },
    transaction: { count: transactions.length, hash: hash(transactions) },
    externalOrderObservation: { count: externalOrders.length, hash: hash(externalOrders) },
  }
}

async function allowedCounts(client: PrismaClient = prisma) {
  const [dailyReviews, operations, positionSnapshots, marketSnapshots, gridPlans, gridOrderDrafts, adviceInputs, advices, alerts] = await Promise.all([
    client.dailyReviewRun.count({ where: { userId: USER_ID } }),
    client.operation.count({ where: { userId: USER_ID } }),
    client.positionSnapshot.count({ where: { userId: USER_ID } }),
    client.marketSnapshot.count({ where: { dailyReviewRun: { userId: USER_ID } } }),
    client.gridPlan.count({ where: { userId: USER_ID } }),
    client.gridOrderDraft.count({ where: { gridPlan: { userId: USER_ID } } }),
    client.adviceInputSnapshot.count({ where: { userId: USER_ID } }),
    client.advice.count({ where: { userId: USER_ID } }),
    client.alert.count({ where: { userId: USER_ID } }),
  ])
  return { dailyReviews, operations, positionSnapshots, marketSnapshots, gridPlans, gridOrderDrafts, adviceInputs, advices, alerts }
}

const startedAt = new Date()
const runStamp = startedAt.toISOString().replace(/[:.]/g, '-')
const resumeReviewId = process.env.FAMS_REAL_E2E_REVIEW_ID?.trim() || null
const resumeBackupPath = process.env.FAMS_REAL_E2E_PRE_RUN_DB?.trim() || null
const evidenceDir = resumeBackupPath ? resolve(resumeBackupPath, '..') : resolve(evidenceRoot, runStamp)
const auditDir = resolve(auditRoot, runStamp)
let backupClient: PrismaClient | null = null

try {
  await Promise.all([mkdir(evidenceDir, { recursive: true }), mkdir(auditDir, { recursive: true })])
  assert.equal(databaseConfig.kind, 'sqlite', '真实 E2E 当前只支持 SQLite')
  assert.ok(databaseConfig.sqlitePath, 'SQLite 路径缺失')
  const backupPath = resumeBackupPath || null
  if (resumeReviewId) {
    assert.ok(resumeBackupPath, '只读续验必须提供 FAMS_REAL_E2E_PRE_RUN_DB')
    backupClient = new PrismaClient({ datasources: { db: { url: `file:${backupPath!}?connection_limit=1` } } })
  }

  const baselineClient = backupClient || prisma

  const [protectedBefore, countsBefore, nonCashPositions, latestBefore] = await Promise.all([
    protectedSnapshot(baselineClient),
    allowedCounts(baselineClient),
    baselineClient.position.findMany({
      where: { userId: USER_ID, status: 'open', asset: { type: { not: 'cash' } } },
      include: { asset: true },
      orderBy: { asset: { symbol: 'asc' } },
    }),
    baselineClient.dailyReviewRun.findFirst({ where: { userId: USER_ID }, orderBy: { generatedAt: 'desc' }, select: { id: true } }),
  ])
  assert.equal(nonCashPositions.length, 6, `预期 6 个非现金持仓，实际 ${nonCashPositions.length}`)
  await writeFile(resolve(evidenceDir, 'pre-run-protected-snapshot.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), protectedBefore, countsBefore }, null, 2)}\n`, 'utf8')

  const idempotencyKey = resumeReviewId ? 'read-only-resume-existing-review' : `drv1-7-real-e2e:${startedAt.toISOString()}`
  let reviewId = resumeReviewId || ''
  if (!resumeReviewId) {
    const runResult = await apiJson<any>('/api/v1/daily-reviews/run', {
      method: 'POST',
      body: JSON.stringify({
        userId: USER_ID,
        sessionType: 'manual',
        triggerSource: 'drv1_7_real_e2e',
        executionMode: 'inline',
        idempotencyKey,
      }),
    })
    assert.equal(runResult.reused, false, '本轮真实 E2E 不应复用旧复盘')
    reviewId = String(runResult.review?.id || '')
  }
  assert.ok(reviewId, '真实复盘缺少 reviewId')
  assert.notEqual(reviewId, latestBefore?.id, '真实复盘没有生成新记录')

  const [detail, workflow] = await Promise.all([
    apiJson<any>(`/api/v1/daily-reviews/${encodeURIComponent(reviewId)}?userId=${USER_ID}`),
    apiJson<any>(`/api/v1/daily-reviews/${encodeURIComponent(reviewId)}/workflow?userId=${USER_ID}`),
  ])
  const report = detail.report || {}
  const assets = Array.isArray(report.assets) ? report.assets : []
  const errors = Array.isArray(report.errors) ? report.errors : []
  assert.ok(['completed', 'partial'].includes(detail.status), `真实复盘状态不可验收：${detail.status}`)
  assert.equal(assets.length + errors.length, nonCashPositions.length, '成功与失败资产没有覆盖全部非现金持仓')
  assert.ok(assets.length >= 1, '真实复盘没有任何成功资产')
  assert.equal(report.schemaVersion, 'fams.daily-portfolio-review.v2')
  assert.equal(report.decisionSummary?.schemaVersion, 'fams.daily-review-decision-summary.v1')
  assert.equal(report.decisionSummary?.assets?.length, assets.length, '结论摘要没有覆盖成功资产')
  assert.equal(report.llmSynthesis?.schemaVersion, 'fams.daily-review-llm-synthesis.v1')
  assert.ok(['available', 'fallback'].includes(report.llmSynthesis?.status), '一次性汇总缺少可审计状态')
  assert.ok([0, 1].includes(report.llmSynthesis?.attemptCount), '一次性汇总请求次数越界')
  assert.equal(report.llmSynthesis?.attempted, report.llmSynthesis?.attemptCount === 1)
  const accountedSymbols = [...assets.map((asset: any) => asset.symbol), ...errors.map((error: any) => error.symbol)].sort()
  assert.deepEqual(accountedSymbols, nonCashPositions.map((position) => position.asset.symbol).sort(), '持仓资产覆盖不一致')
  for (const error of errors) assert.ok(String(error.message || '').trim(), `${error.symbol || error.assetId} 缺少明确错误`)

  const assetEvidence = assets.map((asset: any) => {
    const points = asset.trend?.chart
    assert.ok(Array.isArray(points), `${asset.symbol} 缺少 chart`)
    assert.equal(points.length, 30, `${asset.symbol} 图表点数不是 30`)
    const dates = points.map((point: any) => String(point.date))
    assert.equal(new Set(dates).size, 30, `${asset.symbol} 日期不唯一`)
    assert.ok(dates.every((date: string, index: number) => index === 0 || date > dates[index - 1]), `${asset.symbol} 日期未严格递增`)
    const closes = points.map((point: any) => Number(point.close))
    assert.ok(closes.every(Number.isFinite), `${asset.symbol} 收盘值含非有限数`)
    const source = String(asset.trend?.quote?.source || '')
    assert.ok(source, `${asset.symbol} 行情 provider 缺失`)
    assert.doesNotMatch(source, /mock|fixture|workflow_test/i, `${asset.symbol} 使用了测试 provider`)
    const expected = {
      ma5: Number(average(closes.slice(-5)).toFixed(4)),
      ma10: Number(average(closes.slice(-10)).toFixed(4)),
      ma30: Number(average(closes).toFixed(4)),
    }
    closeTo(asset.trend?.indicators?.ma5, expected.ma5, `${asset.symbol} indicators.ma5`)
    closeTo(asset.trend?.indicators?.ma10, expected.ma10, `${asset.symbol} indicators.ma10`)
    closeTo(asset.trend?.indicators?.ma30, expected.ma30, `${asset.symbol} indicators.ma30`)
    const finalPoint = points.at(-1)
    closeTo(finalPoint.ma5, expected.ma5, `${asset.symbol} chart.ma5`)
    closeTo(finalPoint.ma10, expected.ma10, `${asset.symbol} chart.ma10`)
    closeTo(finalPoint.ma30, expected.ma30, `${asset.symbol} chart.ma30`)
    assert.ok(asset.grid?.id, `${asset.symbol} 缺少已保存 GridPlan`)
    assert.equal(asset.grid?.derivation?.schemaVersion, 'fams.grid-derivation.v1', `${asset.symbol} 缺少可复算网格推导`)
    assert.ok(Number.isFinite(Number(asset.grid?.derivation?.anchor?.value)), `${asset.symbol} 网格锚点无效`)
    assert.ok(Number.isFinite(Number(asset.grid?.derivation?.spacing?.finalPercent)), `${asset.symbol} 网格间距无效`)
    assert.ok(asset.valuationContext?.applicability, `${asset.symbol} 缺少价值评估上下文`)
    const decisionAsset = report.decisionSummary.assets.find((item: any) => item.symbol === asset.symbol)
    assert.ok(decisionAsset, `${asset.symbol} 缺少结论摘要`)
    assert.deepEqual(
      (decisionAsset.orders || []).map((order: any) => [order.id, order.side, order.level, order.price, order.quantity]),
      (asset.grid?.orders || []).map((order: any) => [order.id, order.side, order.level, order.price, order.quantity]),
      `${asset.symbol} 页面订单清单不是已保存 GridOrderDraft 的准确投影`,
    )
    return { symbol: asset.symbol, source, dates: { first: dates[0], last: dates.at(-1) }, expected, gridOrders: asset.grid?.orders?.length || 0 }
  })

  assert.equal(workflow.schemaVersion, 'fams.daily-review-audit-workflow.v2')
  assert.equal(workflow.nodes?.length, 10)
  assert.equal(workflow.edges?.length, 17)
  assert.ok(workflow.nodes.every((node: any) => node.purpose && Array.isArray(node.dependsOn)), 'DAG 节点缺少作用或依赖')
  const nodeIds = new Set(workflow.nodes.map((node: any) => node.id))
  assert.ok(workflow.edges.every((edge: any) => nodeIds.has(edge.source) && nodeIds.has(edge.target)), 'DAG 连线引用未知节点')
  assert.deepEqual(workflow.executionBoundary, {
    planDraftOnly: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  })
  assert.equal(workflow.snapshotCounts.positionSnapshots, assets.length)
  assert.equal(workflow.snapshotCounts.marketSnapshots, assets.length)
  assert.equal(workflow.snapshotCounts.gridPlans, assets.length)
  assert.ok((workflow.attentionCandidates || []).every((candidate: any) => (
    candidate.source && candidate.reason && candidate.evidenceStatus && Array.isArray(candidate.evidenceRefs) && candidate.evidenceRefs.length > 0
  )), '关注标的来源/理由/证据不完整')
  assert.doesNotMatch(JSON.stringify(assetEvidence), /mock|fixture|workflow_test/i)

  const [protectedAfter, countsAfter] = await Promise.all([protectedSnapshot(), allowedCounts()])
  assert.deepEqual(protectedAfter, protectedBefore, '受保护的仓位/交易/外部委托观察发生漂移')
  assert.equal(countsAfter.dailyReviews, countsBefore.dailyReviews + 1, '本轮没有且仅新增一条 DailyReviewRun')

  const finishedAt = new Date()
  const audit = {
    schemaVersion: 'fams.daily-portfolio-review-real-e2e.v1',
    status: 'passed',
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    reviewId,
    operationId: detail.operationId,
    idempotencyKey,
    validationMode: resumeReviewId ? 'read_only_resume_after_acceptance_precision_fix' : 'single_real_api_run',
    backupPath,
    backupMode: resumeReviewId ? 'read_only_resume_backup' : 'protected_table_hashes_without_live_full_database_copy',
    nonCashPositions: nonCashPositions.map((position) => ({ symbol: position.asset.symbol, assetId: position.assetId, positionId: position.id })),
    reviewedAssets: assets.length,
    failedAssets: errors,
    assetEvidence,
    workflow: {
      nodes: workflow.nodes.length,
      edges: workflow.edges.length,
      snapshotCounts: workflow.snapshotCounts,
      captureSummary: workflow.captureSummary,
      attentionCandidates: workflow.attentionCandidates.length,
      executionBoundary: workflow.executionBoundary,
    },
    protectedTables: { before: protectedBefore, after: protectedAfter, unchanged: true },
    allowedCounts: { before: countsBefore, after: countsAfter },
    assertions: {
      realProviderOnly: true,
      thirtyUniqueAscendingCloses: true,
      movingAveragesRecomputed: true,
      decisionSummaryMatchesPersistedDrafts: true,
      valuationAndGridDerivationPersisted: true,
      llmSynthesisAtMostOneRequest: true,
      dagContractV2: true,
      allNonCashPositionsAccountedFor: true,
      oneNewReviewOnly: true,
      protectedTablesUnchanged: true,
      tradingBoundaryUnchanged: true,
    },
  }
  await Promise.all([
    writeFile(resolve(evidenceDir, 'real-data-e2e.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8'),
    writeFile(resolve(auditDir, 'real-data-e2e.json'), `${JSON.stringify({ ...audit, backupPath: backupPath ? '[redacted-local-verification-path]' : null }, null, 2)}\n`, 'utf8'),
  ])
  console.log(JSON.stringify(audit, null, 2))
} finally {
  if (backupClient) await backupClient.$disconnect()
  await prisma.$disconnect()
}
