import { BACKEND_ORIGINS } from '../../background/connection'
import { isSourceRef } from '../../contracts/validation'
import {
  FamsApiError,
  type AskResult,
  type ExecutionBoundary,
  type ExternalBrainResponse,
  type GraphResult,
  type SourceDetail,
  type SourcePage,
  type TraceResult,
} from './types'

type Fetcher = typeof fetch
type RequestMethod = 'GET' | 'POST'
type Validator<T> = (value: unknown) => value is T

const sleep = (delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs))
const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const exactKeys = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',')
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

function isBoundary(value: unknown): value is ExecutionBoundary {
  return isObject(value)
    && exactKeys(value, ['researchOnly', 'formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed'])
    && value.researchOnly === true
    && value.formalTradingUnlocked === false
    && value.autoTradeUnlocked === false
    && value.canCreateOrder === false
    && value.orderCreateAllowed === false
}

function validateEnvelope<T>(value: unknown, validateData: Validator<T>): ExternalBrainResponse<T> {
  if (!isObject(value) || !exactKeys(value, ['schemaVersion', 'requestId', 'generatedAt', 'status', 'data', 'evidenceRefs', 'warnings', 'executionBoundary'])) throw new Error('envelope_shape')
  if (value.schemaVersion !== 'fams.external-brain.response.v1' || typeof value.requestId !== 'string' || !Number.isFinite(Date.parse(String(value.generatedAt)))) throw new Error('envelope_identity')
  if (!['ok', 'accepted', 'empty', 'blocked', 'unavailable'].includes(String(value.status)) || !isBoundary(value.executionBoundary)) throw new Error('envelope_status')
  if (!Array.isArray(value.evidenceRefs) || value.evidenceRefs.some((item) => !isObject(item) || typeof item.ref !== 'string' || !['artifact', 'review', 'operation', 'browser'].includes(String(item.kind)))) throw new Error('envelope_evidence')
  if (!Array.isArray(value.warnings) || value.warnings.some((item) => !isObject(item) || typeof item.code !== 'string' || typeof item.message !== 'string' || typeof item.recoverable !== 'boolean')) throw new Error('envelope_warnings')
  if (value.data === null || !validateData(value.data)) throw new Error('envelope_data')
  return value as ExternalBrainResponse<T>
}

const isSourceItem = (value: unknown) => isObject(value)
  && isSourceRef(value.sourceRef)
  && ['operation_artifact', 'daily_review_evidence'].includes(String(value.kind))
  && typeof value.title === 'string'
  && typeof value.summary === 'string'
  && Number.isFinite(Date.parse(String(value.asOf)))
  && ['fresh', 'stale', 'unknown'].includes(String(value.freshnessStatus))
  && ['available', 'partial', 'blocked', 'missing'].includes(String(value.trustStatus))

const isSourcePage: Validator<SourcePage> = (value): value is SourcePage => isObject(value)
  && Array.isArray(value.items) && value.items.every(isSourceItem)
  && (value.nextCursor === null || typeof value.nextCursor === 'string')

const isSourceDetail: Validator<SourceDetail> = (value): value is SourceDetail => isSourceItem(value)
  && isObject(value)
  && ['FAMS.Operation.artifactRefsJson', 'FAMS.DailyReviewRun.reportJson.evidenceRefs'].includes(String(value.sourceSystem))
  && isStringArray(value.evidenceRefs)
  && Array.isArray(value.displaySections)

const isAskResult: Validator<AskResult> = (value): value is AskResult => isObject(value)
  && /^chat-[0-9a-f-]{36}$/.test(String(value.conversationId))
  && typeof value.messageId === 'string'
  && typeof value.summary === 'string'
  && isStringArray(value.keyEvidence)
  && Number.isFinite(Date.parse(String(value.dataAsOf)))
  && typeof value.confidence === 'number'
  && isStringArray(value.nextActions)
  && isStringArray(value.artifactRefs)
  && isStringArray(value.prohibitedActions)
  && value.notTradingAdvice === true

const isTrace: Validator<TraceResult> = (value): value is TraceResult => isObject(value)
  && typeof value.operationId === 'string'
  && typeof value.type === 'string'
  && typeof value.status === 'string'
  && typeof value.progressPct === 'number'
  && Array.isArray(value.tasks)
  && isStringArray(value.artifactRefs)

const isGraph: Validator<GraphResult> = (value): value is GraphResult => isObject(value)
  && typeof value.graphId === 'string'
  && ['daily-review', 'operation'].includes(String(value.scope))
  && typeof value.status === 'string'
  && Array.isArray(value.nodes)
  && Array.isArray(value.edges)
  && isStringArray(value.evidenceRefs)

export class FamsApiClient {
  private activeOrigin: string | null = null

  constructor(private readonly fetcher: Fetcher = fetch, private readonly origins: readonly string[] = BACKEND_ORIGINS) {}

  listSources(input: { cursor?: string; limit?: number; kind?: 'all' | 'operation_artifact' | 'daily_review_evidence' } = {}) {
    const query = new URLSearchParams()
    if (input.cursor) query.set('cursor', input.cursor)
    if (input.limit) query.set('limit', String(input.limit))
    if (input.kind) query.set('kind', input.kind)
    return this.request('GET', `/api/v1/external-brain/sources${query.size > 0 ? `?${query}` : ''}`, isSourcePage)
  }

  getSource(sourceRef: string) {
    return this.request('GET', `/api/v1/external-brain/sources/${encodeURIComponent(sourceRef)}`, isSourceDetail)
  }

  ask(input: { workspaceId: string; question: string; conversationId?: string; contextRefs: string[]; idempotencyKey: string }) {
    return this.request('POST', '/api/v1/external-brain/ask', isAskResult, {
      schemaVersion: 'fams.external-brain.ask-request.v1',
      workspaceId: input.workspaceId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      question: input.question,
      contextRefs: input.contextRefs,
      idempotencyKey: input.idempotencyKey,
    })
  }

  getTrace(operationId: string) {
    return this.request('GET', `/api/v1/external-brain/traces/${encodeURIComponent(operationId)}`, isTrace)
  }

  getGraph(scope: 'daily-review' | 'operation', id: string) {
    return this.request('GET', `/api/v1/external-brain/graphs/${scope}/${encodeURIComponent(id)}`, isGraph)
  }

  private async request<T>(method: RequestMethod, path: string, validateData: Validator<T>, body?: unknown): Promise<ExternalBrainResponse<T>> {
    const delays = method === 'GET' ? [0, 250, 1000] : [0]
    let lastError: unknown
    for (const delayMs of delays) {
      if (delayMs > 0) await sleep(delayMs)
      try {
        const origin = await this.resolveOrigin()
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), method === 'POST' ? 35_000 : 8_000)
        try {
          const response = await this.fetcher(`${origin}${path}`, {
            method,
            headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
            cache: 'no-store',
          })
          const payload = await response.json().catch(() => null) as unknown
          if (!response.ok) {
            const error = isObject(payload) && isObject(payload.error) ? payload.error : {}
            throw new FamsApiError(String(error.code || 'PX_API_REQUEST_FAILED'), String(error.userMessage || '本地 FAMS 请求失败。'), error.recoverable !== false, response.status, typeof error.requestId === 'string' ? error.requestId : undefined)
          }
          try {
            return validateEnvelope(payload, validateData)
          } catch {
            throw new FamsApiError('PX_API_RESPONSE_INVALID', '本地 FAMS 返回了无法验证的响应，已阻止显示。', false, response.status)
          }
        } finally {
          clearTimeout(timer)
        }
      } catch (error) {
        lastError = error
        const retryable = !(error instanceof FamsApiError) || error.status === 503
        if (method === 'POST' || !retryable) throw error
        this.activeOrigin = null
      }
    }
    if (lastError instanceof FamsApiError) throw lastError
    throw new FamsApiError('PX_BACKEND_UNAVAILABLE', '无法连接本地 FAMS。请确认后端已启动，再重试。', true)
  }

  private async resolveOrigin(): Promise<string> {
    if (this.activeOrigin) return this.activeOrigin
    for (const origin of this.origins) {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 3_000)
      try {
        const response = await this.fetcher(`${origin}/health`, { signal: controller.signal, cache: 'no-store' })
        if (response.ok) { this.activeOrigin = origin; return origin }
      } catch {
        // Only the second frozen local origin may be attempted.
      } finally {
        clearTimeout(timer)
      }
    }
    throw new FamsApiError('PX_BACKEND_UNAVAILABLE', '本地 FAMS 暂时不可用。', true)
  }
}
