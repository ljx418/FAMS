import { prisma } from '../../db/prisma.js'
import { dailyReviewWorkflowService } from '../review/dailyReviewWorkflowService.js'
import {
  DEFAULT_EXTERNAL_BRAIN_USER_ID,
  type ExternalBrainFreshnessStatus,
  type ExternalBrainGraph,
  type ExternalBrainSourceDetail,
  type ExternalBrainSourceKind,
  type ExternalBrainSourcePage,
  type ExternalBrainSourceSummary,
  type ExternalBrainTrace,
  type ExternalBrainTrustStatus,
} from './externalBrainTypes.js'
import { createSourceRef, parseSourceRef } from './sourceRef.js'

const FRESH_WINDOW_MS = 24 * 60 * 60 * 1000

const unique = (values: unknown[]): string[] => [...new Set(values.filter((value): value is string => typeof value === 'string' && value.length > 0))]
const iso = (value: Date): string => value.toISOString()

function parseStringArray(value: string): string[] {
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) throw new Error('PX_STORED_REF_ARRAY_INVALID')
  return unique(parsed)
}

function collectEvidenceRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectEvidenceRefs(item, refs))
    return refs
  }
  if (!value || typeof value !== 'object') return refs
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/evidenceRefs$/i.test(key) && Array.isArray(nested)) refs.push(...nested.filter((item): item is string => typeof item === 'string'))
    collectEvidenceRefs(nested, refs)
  }
  return refs
}

function freshness(asOf: string, snapshotAt: string): ExternalBrainFreshnessStatus {
  const age = Date.parse(snapshotAt) - Date.parse(asOf)
  if (!Number.isFinite(age)) return 'unknown'
  return age <= FRESH_WINDOW_MS ? 'fresh' : 'stale'
}

function trust(status: string): ExternalBrainTrustStatus {
  if (['completed', 'succeeded'].includes(status)) return 'available'
  if (['queued', 'running', 'partial', 'cancelling'].includes(status)) return 'partial'
  if (['failed', 'cancelled', 'blocked'].includes(status)) return 'blocked'
  return 'missing'
}

type SourceCursor = { snapshotAt: string; lastAsOf: string; lastSourceRef: string }

function encodeCursor(cursor: SourceCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(value: string | undefined): SourceCursor | null {
  if (!value) return null
  try {
    const bytes = Buffer.from(value, 'base64url')
    if (bytes.toString('base64url') !== value) throw new Error('noncanonical')
    const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>
    if (Object.keys(parsed).sort().join(',') !== 'lastAsOf,lastSourceRef,snapshotAt') throw new Error('shape')
    const snapshotAt = String(parsed.snapshotAt)
    const lastAsOf = String(parsed.lastAsOf)
    const lastSourceRef = String(parsed.lastSourceRef)
    if (!Number.isFinite(Date.parse(snapshotAt)) || !Number.isFinite(Date.parse(lastAsOf)) || !parseSourceRef(lastSourceRef)) throw new Error('value')
    return { snapshotAt, lastAsOf, lastSourceRef }
  } catch {
    throw new ExternalBrainReadError('PX_CURSOR_INVALID', '分页位置无效，请从第一页重新加载。', true, 'invalid')
  }
}

export class ExternalBrainReadError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
    readonly recoverable: boolean,
    readonly category: 'not_found' | 'invalid',
  ) {
    super(code)
  }
}

class ExternalBrainReadService {
  async listSources(input: { cursor?: string; limit?: number; kind?: 'all' | ExternalBrainSourceKind }): Promise<ExternalBrainSourcePage> {
    const cursor = decodeCursor(input.cursor)
    const snapshotAt = cursor?.snapshotAt ?? new Date().toISOString()
    const limit = input.limit ?? 20
    const [operations, reviews] = await Promise.all([
      prisma.operation.findMany({
        where: { userId: DEFAULT_EXTERNAL_BRAIN_USER_ID, createdAt: { lte: new Date(snapshotAt) } },
        select: { id: true, type: true, status: true, progressMessage: true, requestedAt: true, startedAt: true, completedAt: true, artifactRefsJson: true },
      }),
      prisma.dailyReviewRun.findMany({
        where: { userId: DEFAULT_EXTERNAL_BRAIN_USER_ID, createdAt: { lte: new Date(snapshotAt) } },
        select: { id: true, operationId: true, sessionType: true, status: true, generatedAt: true, completedAt: true, reportJson: true },
      }),
    ])

    const operationSources = operations.flatMap((operation): ExternalBrainSourceSummary[] => {
      const asOf = iso(operation.completedAt ?? operation.startedAt ?? operation.requestedAt)
      return parseStringArray(operation.artifactRefsJson).map((rawRef) => ({
        sourceRef: createSourceRef('op-artifact', operation.id, rawRef),
        kind: 'operation_artifact',
        title: `任务产物 · ${operation.type}`,
        summary: operation.progressMessage || `任务状态：${operation.status}`,
        asOf,
        freshnessStatus: freshness(asOf, snapshotAt),
        trustStatus: trust(operation.status),
        operationId: operation.id,
      }))
    })

    const reviewSources = reviews.flatMap((review): ExternalBrainSourceSummary[] => {
      const asOf = iso(review.completedAt ?? review.generatedAt)
      const refs = unique(collectEvidenceRefs(JSON.parse(review.reportJson)))
      return refs.map((rawRef) => ({
        sourceRef: createSourceRef('review-evidence', review.id, rawRef),
        kind: 'daily_review_evidence',
        title: `复盘证据 · ${review.sessionType}`,
        summary: `复盘状态：${review.status}`,
        asOf,
        freshnessStatus: freshness(asOf, snapshotAt),
        trustStatus: trust(review.status),
        reviewId: review.id,
        ...(review.operationId ? { operationId: review.operationId } : {}),
      }))
    })

    const sorted = [...operationSources, ...reviewSources]
      .filter((item) => !input.kind || input.kind === 'all' || item.kind === input.kind)
      .sort((left, right) => right.asOf.localeCompare(left.asOf) || left.sourceRef.localeCompare(right.sourceRef))
      .filter((item) => !cursor || item.asOf < cursor.lastAsOf || (item.asOf === cursor.lastAsOf && item.sourceRef > cursor.lastSourceRef))
    const items = sorted.slice(0, limit)
    const last = items.at(-1)
    return {
      items,
      nextCursor: last && sorted.length > items.length
        ? encodeCursor({ snapshotAt, lastAsOf: last.asOf, lastSourceRef: last.sourceRef })
        : null,
    }
  }

  async getSource(sourceRef: string): Promise<ExternalBrainSourceDetail> {
    const parsed = parseSourceRef(sourceRef)
    if (!parsed) throw new ExternalBrainReadError('PX_SOURCE_REF_INVALID', '来源标识无效。', false, 'invalid')
    if (parsed.kind === 'op-artifact') {
      const operation = await prisma.operation.findFirst({ where: { id: parsed.entityId, userId: DEFAULT_EXTERNAL_BRAIN_USER_ID } })
      if (!operation) throw new ExternalBrainReadError('PX_RESOURCE_NOT_FOUND', '来源已不可用。', false, 'not_found')
      const refs = parseStringArray(operation.artifactRefsJson)
      if (!refs.includes(parsed.rawRef)) throw new ExternalBrainReadError('PX_RESOURCE_NOT_FOUND', '来源已不可用。', false, 'not_found')
      const asOf = iso(operation.completedAt ?? operation.startedAt ?? operation.requestedAt)
      return {
        sourceRef,
        kind: 'operation_artifact',
        title: `任务产物 · ${operation.type}`,
        summary: operation.progressMessage || `任务状态：${operation.status}`,
        asOf,
        sourceSystem: 'FAMS.Operation.artifactRefsJson',
        freshnessStatus: freshness(asOf, new Date().toISOString()),
        trustStatus: trust(operation.status),
        operationId: operation.id,
        relatedOperationId: operation.id,
        evidenceRefs: [parsed.rawRef],
        displaySections: [{ id: 'provenance', title: '来源信息', items: [
          { label: '任务类型', value: operation.type, evidenceRef: parsed.rawRef },
          { label: '任务状态', value: operation.status, evidenceRef: parsed.rawRef },
          { label: '原始引用', value: parsed.rawRef, evidenceRef: parsed.rawRef },
        ] }],
      }
    }

    const review = await prisma.dailyReviewRun.findFirst({ where: { id: parsed.entityId, userId: DEFAULT_EXTERNAL_BRAIN_USER_ID } })
    if (!review) throw new ExternalBrainReadError('PX_RESOURCE_NOT_FOUND', '来源已不可用。', false, 'not_found')
    const refs = unique(collectEvidenceRefs(JSON.parse(review.reportJson)))
    if (!refs.includes(parsed.rawRef)) throw new ExternalBrainReadError('PX_RESOURCE_NOT_FOUND', '来源已不可用。', false, 'not_found')
    const asOf = iso(review.completedAt ?? review.generatedAt)
    return {
      sourceRef,
      kind: 'daily_review_evidence',
      title: `复盘证据 · ${review.sessionType}`,
      summary: `复盘状态：${review.status}`,
      asOf,
      sourceSystem: 'FAMS.DailyReviewRun.reportJson.evidenceRefs',
      freshnessStatus: freshness(asOf, new Date().toISOString()),
      trustStatus: trust(review.status),
      reviewId: review.id,
      relatedReviewId: review.id,
      ...(review.operationId ? { operationId: review.operationId, relatedOperationId: review.operationId } : {}),
      evidenceRefs: [parsed.rawRef],
      displaySections: [{ id: 'provenance', title: '来源信息', items: [
        { label: '复盘场次', value: review.sessionType, evidenceRef: parsed.rawRef },
        { label: '复盘状态', value: review.status, evidenceRef: parsed.rawRef },
        { label: '原始引用', value: parsed.rawRef, evidenceRef: parsed.rawRef },
      ] }],
    }
  }

  async assertSourceRefMembership(sourceRef: string): Promise<void> {
    await this.getSource(sourceRef)
  }

  async getTrace(operationId: string): Promise<ExternalBrainTrace> {
    const operation = await prisma.operation.findFirst({
      where: { id: operationId, userId: DEFAULT_EXTERNAL_BRAIN_USER_ID },
      include: { tasks: { orderBy: { createdAt: 'asc' } } },
    })
    if (!operation) throw new ExternalBrainReadError('PX_RESOURCE_NOT_FOUND', '没有找到该任务。', false, 'not_found')
    let recoverySummary: string | undefined
    const recovery = JSON.parse(operation.recoveryJson) as Record<string, unknown>
    if (Object.keys(recovery).length > 0) recoverySummary = String(recovery.summary || recovery.status || recovery.reason || '存在恢复记录')
    return {
      operationId: operation.id,
      type: operation.type,
      status: operation.status,
      progressPct: operation.progressPct,
      requestedAt: iso(operation.requestedAt),
      ...(operation.startedAt ? { startedAt: iso(operation.startedAt) } : {}),
      ...(operation.completedAt ? { completedAt: iso(operation.completedAt) } : {}),
      tasks: operation.tasks.map((task) => ({
        id: task.id,
        name: task.name,
        status: task.status,
        ...(task.startedAt ? { startedAt: iso(task.startedAt) } : {}),
        ...(task.completedAt ? { completedAt: iso(task.completedAt) } : {}),
        ...(task.durationMs !== null ? { durationMs: task.durationMs } : {}),
        successCount: task.successCount,
        failureCount: task.failureCount,
      })),
      artifactRefs: parseStringArray(operation.artifactRefsJson),
      ...(operation.errorSummary ? { errorSummary: operation.errorSummary } : {}),
      ...(recoverySummary ? { recoverySummary } : {}),
    }
  }

  async getGraph(scope: 'daily-review' | 'operation', id: string): Promise<ExternalBrainGraph> {
    if (scope === 'daily-review') {
      const review = await prisma.dailyReviewRun.findFirst({ where: { id, userId: DEFAULT_EXTERNAL_BRAIN_USER_ID } })
      if (!review) throw new ExternalBrainReadError('PX_RESOURCE_NOT_FOUND', '没有找到该复盘关系图。', false, 'not_found')
      const workflow = await dailyReviewWorkflowService.getWorkflow(id, DEFAULT_EXTERNAL_BRAIN_USER_ID)
      return {
        graphId: id,
        scope,
        status: review.status,
        nodes: workflow.nodes.map((node) => ({
          id: node.id,
          label: node.title,
          status: node.status,
          sequence: node.sequence,
          inputsSummary: node.inputs.map((item) => `${item.label}：${item.value}`),
          outputsSummary: node.outputs.map((item) => `${item.label}：${item.value}`),
          evidenceRefs: unique(node.evidenceRefs),
        })),
        edges: workflow.edges,
        evidenceRefs: unique(workflow.nodes.flatMap((node) => node.evidenceRefs)),
      }
    }

    const trace = await this.getTrace(id)
    const rootId = `operation:${trace.operationId}`
    return {
      graphId: id,
      scope,
      status: trace.status,
      nodes: [
        { id: rootId, label: trace.type, status: trace.status, sequence: 0, inputsSummary: [], outputsSummary: [`产物 ${trace.artifactRefs.length} 项`], evidenceRefs: trace.artifactRefs },
        ...trace.tasks.map((task, index) => ({
          id: `task:${task.id}`,
          label: task.name,
          status: task.status,
          sequence: index + 1,
          inputsSummary: [],
          outputsSummary: [`成功 ${task.successCount}；失败 ${task.failureCount}`],
          evidenceRefs: trace.artifactRefs,
        })),
      ],
      edges: trace.tasks.map((task, index) => ({
        id: `${index === 0 ? rootId : `task:${trace.tasks[index - 1]!.id}`}->task:${task.id}`,
        source: index === 0 ? rootId : `task:${trace.tasks[index - 1]!.id}`,
        target: `task:${task.id}`,
      })),
      evidenceRefs: trace.artifactRefs,
    }
  }
}

export const externalBrainReadService = new ExternalBrainReadService()
