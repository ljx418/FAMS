import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { externalBrainAskService, ExternalBrainAskError } from '../services/external-brain/externalBrainAskService.js'
import { externalBrainPolicyService } from '../services/external-brain/externalBrainPolicyService.js'
import { externalBrainReadService, ExternalBrainReadError } from '../services/external-brain/externalBrainReadService.js'
import {
  EXTERNAL_BRAIN_RESPONSE_SCHEMA_VERSION,
  LOCKED_EXECUTION_BOUNDARY,
  type ExternalBrainAskRequest,
  type ExternalBrainErrorEnvelope,
  type ExternalBrainEvidenceRef,
  type ExternalBrainResponse,
  type ExternalBrainResponseStatus,
  type ExternalBrainSourceKind,
  type ExternalBrainWarning,
} from '../services/external-brain/externalBrainTypes.js'
import { parseSourceRef } from '../services/external-brain/sourceRef.js'

const requestId = (request: FastifyRequest): string => `px-request-${String(request.id)}`

function envelope<T>(request: FastifyRequest, status: ExternalBrainResponseStatus, data: T | null, evidenceRefs: ExternalBrainEvidenceRef[] = [], warnings: ExternalBrainWarning[] = []): ExternalBrainResponse<T> {
  return {
    schemaVersion: EXTERNAL_BRAIN_RESPONSE_SCHEMA_VERSION,
    requestId: requestId(request),
    generatedAt: new Date().toISOString(),
    status,
    data,
    evidenceRefs,
    warnings,
    executionBoundary: LOCKED_EXECUTION_BOUNDARY,
  }
}

function errorEnvelope(request: FastifyRequest, code: string, userMessage: string, recoverable: boolean): ExternalBrainErrorEnvelope {
  const id = requestId(request)
  return {
    schemaVersion: EXTERNAL_BRAIN_RESPONSE_SCHEMA_VERSION,
    requestId: id,
    error: { code, userMessage, recoverable, requestId: id },
    executionBoundary: LOCKED_EXECUTION_BOUNDARY,
  }
}

function sendError(request: FastifyRequest, reply: FastifyReply, status: number, code: string, userMessage: string, recoverable: boolean) {
  return reply.code(status).send(errorEnvelope(request, code, userMessage, recoverable))
}

function handleServiceError(request: FastifyRequest, reply: FastifyReply, error: unknown) {
  if (error instanceof ExternalBrainReadError) {
    return sendError(request, reply, error.category === 'not_found' ? 404 : 400, error.code, error.userMessage, error.recoverable)
  }
  if (error instanceof ExternalBrainAskError) {
    const status = error.category === 'policy' ? 403 : error.category === 'timeout' ? 504 : 400
    return sendError(request, reply, status, error.code, error.userMessage, error.recoverable)
  }
  return sendError(request, reply, 503, 'PX_FAMS_UNAVAILABLE', '本地 FAMS 暂时无法完成请求；当前引用已保留，请稍后重试 GET 或到 FAMS 复核。', true)
}

function evidence(ref: string, asOf?: string): ExternalBrainEvidenceRef {
  const source = parseSourceRef(ref)
  const kind = source?.kind === 'review-evidence' ? 'review'
    : source?.kind === 'op-artifact' ? 'artifact'
      : ref.startsWith('operation:') ? 'operation' : 'artifact'
  return { ref, kind, ...(asOf ? { asOf } : {}) }
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key)) && Object.keys(value).every((key) => allowed.has(key))
}

export async function externalBrainRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (request, reply) => {
    if (externalBrainPolicyService.configuredExtensionIds().length === 0) {
      return sendError(request, reply, 503, 'PX_EXTENSION_ALLOWLIST_NOT_CONFIGURED', '尚未配置获准的 External Brain 扩展 ID。', false)
    }
    const origin = typeof request.headers.origin === 'string' ? request.headers.origin : undefined
    if (!externalBrainPolicyService.isExternalBrainOriginAllowed(origin)) {
      return sendError(request, reply, 403, 'PX_ORIGIN_BLOCKED', '该调用方未获 External Brain API 授权。', false)
    }
    if (externalBrainPolicyService.requestContainsUserId(request)) {
      return sendError(request, reply, 400, 'PX_USER_SCOPE_FIXED', 'External Brain API 固定读取本地默认用户，不接受 userId。', false)
    }
    return undefined
  })

  app.get('/sources', async (request, reply) => {
    const query = request.query as Record<string, unknown>
    if (Object.keys(query).some((key) => !['cursor', 'limit', 'kind'].includes(key))) return sendError(request, reply, 400, 'PX_SCHEMA_INVALID', '来源查询含有未允许字段。', false)
    const limit = query.limit === undefined ? 20 : Number(query.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) return sendError(request, reply, 400, 'PX_LIMIT_INVALID', 'limit 需要是 1 到 50 之间的整数。', true)
    const kind = query.kind === undefined ? 'all' : String(query.kind)
    if (!['all', 'operation_artifact', 'daily_review_evidence'].includes(kind)) return sendError(request, reply, 400, 'PX_SOURCE_KIND_INVALID', 'kind 仅支持 all、operation_artifact 或 daily_review_evidence。', true)
    try {
      const data = await externalBrainReadService.listSources({ cursor: query.cursor === undefined ? undefined : String(query.cursor), limit, kind: kind as 'all' | ExternalBrainSourceKind })
      return envelope(request, data.items.length > 0 ? 'ok' : 'empty', data, data.items.map((item) => evidence(item.sourceRef, item.asOf)))
    } catch (error) {
      return handleServiceError(request, reply, error)
    }
  })

  app.get<{ Params: { sourceRef: string } }>('/sources/:sourceRef', async (request, reply) => {
    try {
      const data = await externalBrainReadService.getSource(request.params.sourceRef)
      return envelope(request, 'ok', data, [evidence(data.sourceRef, data.asOf)])
    } catch (error) {
      return handleServiceError(request, reply, error)
    }
  })

  app.post('/ask', async (request, reply) => {
    const body = request.body
    if (!body || typeof body !== 'object' || Array.isArray(body) || !hasExactKeys(body as Record<string, unknown>, ['schemaVersion', 'workspaceId', 'question', 'contextRefs', 'idempotencyKey'], ['conversationId'])) {
      return sendError(request, reply, 400, 'PX_SCHEMA_INVALID', 'Ask 请求字段缺失或包含未允许字段。', false)
    }
    try {
      const outcome = await externalBrainAskService.ask(body as ExternalBrainAskRequest)
      const response = envelope(request, outcome.status, outcome.data, outcome.data.keyEvidence.map((ref) => evidence(ref, outcome.data.dataAsOf)), outcome.warnings)
      return reply.code(outcome.status === 'accepted' ? 202 : 200).send(response)
    } catch (error) {
      return handleServiceError(request, reply, error)
    }
  })

  app.get<{ Params: { operationId: string } }>('/traces/:operationId', async (request, reply) => {
    try {
      const data = await externalBrainReadService.getTrace(request.params.operationId)
      return envelope(request, 'ok', data, [evidence(`operation:${data.operationId}`, data.completedAt ?? data.startedAt ?? data.requestedAt)])
    } catch (error) {
      return handleServiceError(request, reply, error)
    }
  })

  app.get<{ Params: { scope: string; id: string } }>('/graphs/:scope/:id', async (request, reply) => {
    if (!['daily-review', 'operation'].includes(request.params.scope)) return sendError(request, reply, 400, 'PX_GRAPH_SCOPE_INVALID', '图谱 scope 仅支持 daily-review 或 operation。', true)
    try {
      const data = await externalBrainReadService.getGraph(request.params.scope as 'daily-review' | 'operation', request.params.id)
      return envelope(request, data.nodes.length > 0 ? 'ok' : 'empty', data, data.evidenceRefs.map((ref) => evidence(ref)))
    } catch (error) {
      return handleServiceError(request, reply, error)
    }
  })
}

export function externalBrainOriginForRequest(request: FastifyRequest): string | undefined {
  return typeof request.headers.origin === 'string' ? request.headers.origin : undefined
}
