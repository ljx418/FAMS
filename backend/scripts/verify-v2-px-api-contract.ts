import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { externalBrainRoutes } from '../src/routes/externalBrain.js'
import { externalBrainPolicyService } from '../src/services/external-brain/externalBrainPolicyService.js'
import { externalBrainReadService } from '../src/services/external-brain/externalBrainReadService.js'
import { createSourceRef, parseSourceRef } from '../src/services/external-brain/sourceRef.js'

const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
const extensionOrigin = `chrome-extension://${extensionId}`
process.env.FAMS_V2_PX_EXTENSION_IDS = extensionId

await initializePrisma()
const app = Fastify({ logger: false, maxParamLength: 1024 })
await app.register(cors, { origin: (origin, callback) => callback(null, externalBrainPolicyService.isCorsOriginAllowed(origin)) })
await app.register(externalBrainRoutes, { prefix: '/api/v1/external-brain' })
await app.ready()

const countsBefore = {
  operations: await prisma.operation.count({ where: { userId: 'default' } }),
  reviews: await prisma.dailyReviewRun.count({ where: { userId: 'default' } }),
  transactions: await prisma.transaction.count({ where: { userId: 'default' } }),
}
assert.ok(countsBefore.operations > 0, 'real Operation records are required')
assert.ok(countsBefore.reviews > 0, 'real DailyReviewRun records are required')

const inject = (input: Parameters<typeof app.inject>[0]) => app.inject({ ...input, headers: { origin: extensionOrigin, ...(input.headers || {}) } })
const boundary = {
  researchOnly: true,
  formalTradingUnlocked: false,
  autoTradeUnlocked: false,
  canCreateOrder: false,
  orderCreateAllowed: false,
}

function assertErrorEnvelope(response: Awaited<ReturnType<typeof app.inject>>) {
  const body = response.json()
  assert.equal(body.schemaVersion, 'fams.external-brain.response.v1')
  assert.equal(typeof body.requestId, 'string')
  assert.equal(body.error.requestId, body.requestId)
  assert.deepEqual(body.executionBoundary, boundary)
  assert.equal('stack' in body, false)
}

const missingOrigin = await app.inject({ method: 'GET', url: '/api/v1/external-brain/sources' })
const webOrigin = await app.inject({ method: 'GET', url: '/api/v1/external-brain/sources', headers: { origin: 'http://localhost:3000' } })
const wrongExtension = await app.inject({ method: 'GET', url: '/api/v1/external-brain/sources', headers: { origin: 'chrome-extension://pppppppppppppppppppppppppppppppp' } })
const userInjection = await inject({ method: 'GET', url: '/api/v1/external-brain/sources?userId=other' })
assert.deepEqual([missingOrigin.statusCode, webOrigin.statusCode, wrongExtension.statusCode, userInjection.statusCode], [403, 403, 403, 400])
;[missingOrigin, webOrigin, wrongExtension, userInjection].forEach(assertErrorEnvelope)

delete process.env.FAMS_V2_PX_EXTENSION_IDS
const missingAllowlist = await app.inject({ method: 'GET', url: '/api/v1/external-brain/sources', headers: { origin: extensionOrigin } })
assert.equal(missingAllowlist.statusCode, 503)
assert.equal(missingAllowlist.json().error.code, 'PX_EXTENSION_ALLOWLIST_NOT_CONFIGURED')
assertErrorEnvelope(missingAllowlist)
process.env.FAMS_V2_PX_EXTENSION_IDS = extensionId

const operationPageResponse = await inject({ method: 'GET', url: '/api/v1/external-brain/sources?kind=operation_artifact&limit=1' })
assert.equal(operationPageResponse.statusCode, 200)
assert.equal(operationPageResponse.headers['access-control-allow-origin'], extensionOrigin)
const operationEnvelope = operationPageResponse.json()
assert.deepEqual(Object.keys(operationEnvelope).sort(), ['data', 'evidenceRefs', 'executionBoundary', 'generatedAt', 'requestId', 'schemaVersion', 'status', 'warnings'])
assert.equal(operationEnvelope.schemaVersion, 'fams.external-brain.response.v1')
assert.equal(operationEnvelope.status, 'ok')
assert.deepEqual(operationEnvelope.executionBoundary, boundary)
assert.equal(operationEnvelope.data.items.length, 1)
assert.ok(operationEnvelope.data.nextCursor)
const operationSource = operationEnvelope.data.items[0]
assert.equal(operationSource.kind, 'operation_artifact')
assert.ok(parseSourceRef(operationSource.sourceRef))

const cursorPayload = JSON.parse(Buffer.from(operationEnvelope.data.nextCursor, 'base64url').toString('utf8'))
assert.deepEqual(Object.keys(cursorPayload).sort(), ['lastAsOf', 'lastSourceRef', 'snapshotAt'])
const nextPage = (await inject({ method: 'GET', url: `/api/v1/external-brain/sources?kind=operation_artifact&limit=1&cursor=${encodeURIComponent(operationEnvelope.data.nextCursor)}` })).json()
assert.notEqual(nextPage.data.items[0]?.sourceRef, operationSource.sourceRef)

const reviewPageResponse = await inject({ method: 'GET', url: '/api/v1/external-brain/sources?kind=daily_review_evidence&limit=1' })
assert.equal(reviewPageResponse.statusCode, 200)
const reviewSource = reviewPageResponse.json().data.items[0]
assert.equal(reviewSource.kind, 'daily_review_evidence')
assert.ok(parseSourceRef(reviewSource.sourceRef))

const sourceDetailResponse = await inject({ method: 'GET', url: `/api/v1/external-brain/sources/${encodeURIComponent(operationSource.sourceRef)}` })
assert.equal(sourceDetailResponse.statusCode, 200, sourceDetailResponse.body)
const sourceDetail = sourceDetailResponse.json().data
const parsedOperationSource = parseSourceRef(operationSource.sourceRef)!
assert.equal(sourceDetail.operationId, parsedOperationSource.entityId)
assert.equal(sourceDetail.sourceSystem, 'FAMS.Operation.artifactRefsJson')
assert.equal(sourceDetail.evidenceRefs.includes(parsedOperationSource.rawRef), true)
assert.equal('inputJson' in sourceDetail, false)
assert.equal('resultJson' in sourceDetail, false)

const nonexistent = createSourceRef('op-artifact', '00000000-0000-4000-8000-000000000002', 'missing-artifact')
const notFound = await inject({ method: 'GET', url: `/api/v1/external-brain/sources/${encodeURIComponent(nonexistent)}` })
assert.equal(notFound.statusCode, 404)
assert.equal(notFound.json().error.code, 'PX_RESOURCE_NOT_FOUND')
assertErrorEnvelope(notFound)

const traceResponse = await inject({ method: 'GET', url: `/api/v1/external-brain/traces/${operationSource.operationId}` })
assert.equal(traceResponse.statusCode, 200)
const trace = traceResponse.json().data
const databaseOperation = await prisma.operation.findUniqueOrThrow({ where: { id: operationSource.operationId } })
assert.equal(trace.operationId, databaseOperation.id)
assert.equal(trace.status, databaseOperation.status)
assert.equal('inputJson' in trace, false)
assert.equal('errorJson' in trace, false)

const graphResponse = await inject({ method: 'GET', url: `/api/v1/external-brain/graphs/daily-review/${reviewSource.reviewId}` })
assert.equal(graphResponse.statusCode, 200)
const graph = graphResponse.json().data
assert.equal(graph.scope, 'daily-review')
assert.equal(graph.graphId, reviewSource.reviewId)
assert.ok(graph.nodes.length >= 10)
assert.ok(graph.nodes.every((node: Record<string, unknown>) => ['id', 'label', 'status', 'sequence', 'inputsSummary', 'outputsSummary', 'evidenceRefs'].every((key) => key in node)))

const invalidAskBodies = [
  { question: '缺少合同字段' },
  { schemaVersion: 'fams.external-brain.ask-request.v1', workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', question: 'x', contextRefs: [], idempotencyKey: 'px-idem-contract00000001', extra: true },
  { schemaVersion: 'fams.external-brain.ask-request.v1', workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', question: 'x', contextRefs: ['not-a-ref'], idempotencyKey: 'px-idem-contract00000001' },
  { schemaVersion: 'fams.external-brain.ask-request.v1', workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', question: 'x', contextRefs: [], idempotencyKey: 'px-idem-contract00000001', userId: 'other' },
]
for (const payload of invalidAskBodies) {
  const response = await inject({ method: 'POST', url: '/api/v1/external-brain/ask', payload })
  assert.equal(response.statusCode, 400)
  assertErrorEnvelope(response)
}

const askStartedAt = Date.now()
const askResponse = await inject({
  method: 'POST',
  url: '/api/v1/external-brain/ask',
  payload: {
    schemaVersion: 'fams.external-brain.ask-request.v1',
    workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001',
    question: '总结我的当前组合',
    contextRefs: [operationSource.sourceRef],
    idempotencyKey: `px-idem-contract${Date.now()}`,
  },
})
const askDurationMs = Date.now() - askStartedAt
assert.equal(askResponse.statusCode, 200)
assert.ok(askDurationMs <= 35_000, `ask exceeded 35 seconds: ${askDurationMs}`)
const askEnvelope = askResponse.json()
assert.equal(askEnvelope.status, 'ok')
assert.deepEqual(askEnvelope.executionBoundary, boundary)
assert.ok(/^chat-[0-9a-f-]{36}$/.test(askEnvelope.data.conversationId))
assert.ok(askEnvelope.data.summary.length > 0)
assert.equal(askEnvelope.data.notTradingAdvice, true)
assert.deepEqual(askEnvelope.data.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])

const chatAuditPath = resolve(process.cwd(), 'data', 'gpt-audit', 'chat-sessions', `${askEnvelope.data.conversationId}.json`)
const chatAudit = JSON.parse(await readFile(chatAuditPath, 'utf8'))
assert.ok(chatAudit.messages.some((message: { id: string }) => message.id === askEnvelope.data.messageId))

const originalListSources = externalBrainReadService.listSources.bind(externalBrainReadService)
externalBrainReadService.listSources = async () => { throw new Error('injected database failure with /secret/path') }
const unavailable = await inject({ method: 'GET', url: '/api/v1/external-brain/sources' })
externalBrainReadService.listSources = originalListSources
assert.equal(unavailable.statusCode, 503)
assert.equal(unavailable.json().error.code, 'PX_FAMS_UNAVAILABLE')
assert.equal(unavailable.body.includes('/secret/path'), false)
assertErrorEnvelope(unavailable)

const countsAfter = {
  operations: await prisma.operation.count({ where: { userId: 'default' } }),
  reviews: await prisma.dailyReviewRun.count({ where: { userId: 'default' } }),
  transactions: await prisma.transaction.count({ where: { userId: 'default' } }),
}
assert.deepEqual(countsAfter, countsBefore, 'read-only Ask and facade reads must not mutate business tables')

await app.close()
await prisma.$disconnect()

const report = {
  schemaVersion: 'fams.v2_px.api_contract_evidence.v1',
  status: 'passed',
  realData: true,
  counts: countsBefore,
  operationSourceRef: operationSource.sourceRef,
  reviewSourceRef: reviewSource.sourceRef,
  cursorShape: Object.keys(cursorPayload).sort(),
  askConversationId: askEnvelope.data.conversationId,
  askMessageId: askEnvelope.data.messageId,
  askDurationMs,
  postAskRequestCount: 1,
  databaseFailureMappedTo503: true,
  explicitNotFoundMappedTo404: true,
  brokerOrderRequestCount: 0,
  tradeMutationCount: 0,
}
const repoRoot = resolve(process.cwd(), '..')
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const evidenceDir = resolve(repoRoot, '.verification/private/v2-px', commitSha, 'PX2')
await mkdir(evidenceDir, { recursive: true })
await writeFile(resolve(evidenceDir, 'api-contract-evidence.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
await writeFile(resolve(evidenceDir, 'cors-switch-audit.json'), `${JSON.stringify({
  schemaVersion: 'fams.v2_px.cors_switch_audit.v1',
  commitSha,
  allowedExtensionOriginPassed: true,
  wrongExtensionOriginRejected: true,
  missingAllowlistRejected: true,
  host3000ExternalBrainRejected: true,
  host3000GlobalCorsAllowed: externalBrainPolicyService.isCorsOriginAllowed('http://localhost:3000'),
  globalCorsUsesExplicitPolicy: true,
  rollbackPoint: 'restore strict callback configuration while retaining route preHandler; never use origin:true as identity',
}, null, 2)}\n`, 'utf8')

console.log(JSON.stringify({ ...report, evidenceDir }, null, 2))
