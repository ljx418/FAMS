import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { prisma } from '../src/db/prisma.js'
import { dailyReviewRoutes } from '../src/routes/dailyReview.js'

try {
  const latest = await prisma.dailyReviewRun.findFirst({
    where: { userId: 'default', status: { in: ['completed', 'partial'] } },
    orderBy: { generatedAt: 'desc' },
    select: { id: true },
  })
  assert.ok(latest, 'default 账户必须存在真实复盘记录')

  const app = Fastify()
  await app.register(dailyReviewRoutes, { prefix: '/api/v1/daily-reviews' })
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/daily-reviews/${latest.id}/workflow?userId=default`,
  })
  assert.equal(response.statusCode, 200, response.body)
  const workflow = response.json()
  assert.equal(workflow.schemaVersion, 'fams.daily-review-audit-workflow.v2')
  assert.deepEqual(workflow.nodes.map((node) => node.id), [
    'trigger',
    'positions',
    'quotes',
    'indicators',
    'fundamentals',
    'strategy',
    'attention',
    'grid',
    'history',
    'boundary',
  ])
  assert.deepEqual(workflow.nodes.map((node) => node.sequence), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  for (const node of workflow.nodes) {
    assert.ok(['complete', 'partial', 'blocked', 'empty', 'locked'].includes(node.status), `${node.id} 状态非法`)
    assert.ok(['runtime_record', 'derived_view'].includes(node.provenance), `${node.id} provenance 非法`)
    assert.ok(Array.isArray(node.inputs) && node.inputs.length > 0, `${node.id} 缺少输入`)
    assert.ok(Array.isArray(node.outputs) && node.outputs.length > 0, `${node.id} 缺少输出`)
    assert.ok(typeof node.purpose === 'string' && node.purpose.length > 0, `${node.id} 缺少节点作用`)
    assert.ok(Array.isArray(node.dependsOn), `${node.id} 缺少依赖数组`)
    assert.ok(Array.isArray(node.evidenceRefs), `${node.id} 缺少证据数组`)
    assert.ok(Array.isArray(node.blockerCodes), `${node.id} 缺少阻断数组`)
  }
  const nodeIds = new Set(workflow.nodes.map((node: any) => node.id))
  assert.ok(Array.isArray(workflow.edges) && workflow.edges.length > 0)
  for (const edge of workflow.edges) {
    assert.ok(nodeIds.has(edge.source) && nodeIds.has(edge.target), `非法 DAG 边：${edge.id}`)
  }
  const indegree = new Map(workflow.nodes.map((node: any) => [node.id, 0]))
  for (const edge of workflow.edges) indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1)
  const queue = [...indegree.entries()].filter(([, value]) => value === 0).map(([id]) => id)
  let visited = 0
  while (queue.length) {
    const source = queue.shift()!
    visited += 1
    for (const edge of workflow.edges.filter((item: any) => item.source === source)) {
      const next = (indegree.get(edge.target) || 0) - 1
      indegree.set(edge.target, next)
      if (next === 0) queue.push(edge.target)
    }
  }
  assert.equal(visited, workflow.nodes.length, '工作流必须为无环图')
  assert.equal(workflow.nodes.at(-1)?.status, 'locked')
  assert.deepEqual(workflow.executionBoundary, {
    planDraftOnly: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  })
  assert.ok(workflow.snapshotCounts.positionSnapshots > 0)
  assert.ok(workflow.snapshotCounts.marketSnapshots > 0)
  assert.ok(workflow.captureSummary.confirmedCaptureCount > 0)
  assert.ok(workflow.attentionCandidates.every((candidate: any) => (
    candidate.source && candidate.reason && candidate.evidenceStatus && Array.isArray(candidate.evidenceRefs)
  )))
  const evidenceText = JSON.stringify(workflow)
  assert.doesNotMatch(evidenceText, /workflow_test|fixture|mock_provider/i)

  console.log(JSON.stringify({
    ok: true,
    reviewId: workflow.reviewId,
    reviewStatus: workflow.reviewStatus,
    nodes: workflow.nodes.length,
    positionSnapshots: workflow.snapshotCounts.positionSnapshots,
    marketSnapshots: workflow.snapshotCounts.marketSnapshots,
    gridPlans: workflow.snapshotCounts.gridPlans,
    confirmedCaptures: workflow.captureSummary.confirmedCaptureCount,
    quoteNode: workflow.nodes.find((node) => node.id === 'quotes'),
  }, null, 2))
  await app.close()
} finally {
  await prisma.$disconnect()
}
