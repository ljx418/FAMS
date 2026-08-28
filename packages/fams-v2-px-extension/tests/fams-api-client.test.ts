import { describe, expect, it, vi } from 'vitest'
import { FamsApiClient } from '../src/adapters/fams/FamsApiClient'

const sourceRef = 'op-artifact:3d292179-cd6d-4e73-9a35-0097b6809436:YQ'
const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
const boundary = { researchOnly: true, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false } as const
const sourceData = { items: [{ sourceRef, kind: 'operation_artifact', title: '真实产物', summary: '完成', asOf: '2026-08-28T00:00:00.000Z', freshnessStatus: 'fresh', trustStatus: 'available', operationId: '3d292179-cd6d-4e73-9a35-0097b6809436' }], nextCursor: null }

function envelope(data: unknown) {
  return { schemaVersion: 'fams.external-brain.response.v1', requestId: 'px-request-test', generatedAt: '2026-08-28T00:00:00.000Z', status: 'ok', data, evidenceRefs: [], warnings: [], executionBoundary: boundary }
}

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('FamsApiClient exact envelope and retry boundary', () => {
  it('validates and returns an exact source envelope', async () => {
    const fetcher = vi.fn(async (input: string | URL | Request) => String(input).endsWith('/health') ? response({ ok: true }) : response(envelope(sourceData))) as unknown as typeof fetch
    const result = await new FamsApiClient(extensionId, fetcher, ['http://localhost:4000']).listSources()
    expect(result.data?.items[0]?.sourceRef).toBe(sourceRef)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('retries GET for 503 only and succeeds on the third API attempt', async () => {
    let apiCalls = 0
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      if (String(input).endsWith('/health')) return response({ ok: true })
      apiCalls += 1
      return apiCalls < 3 ? response({ error: { code: 'PX_FAMS_UNAVAILABLE', userMessage: '稍后重试', recoverable: true, requestId: 'x' } }, 503) : response(envelope(sourceData))
    }) as unknown as typeof fetch
    await expect(new FamsApiClient(extensionId, fetcher, ['http://localhost:4000']).listSources()).resolves.toMatchObject({ status: 'ok' })
    expect(apiCalls).toBe(3)
  })

  it('does not retry GET 500 or malformed success envelopes', async () => {
    for (const payload of [
      response({ error: { code: 'PX_INTERNAL', userMessage: '失败', recoverable: true, requestId: 'x' } }, 500),
      response({ ...envelope(sourceData), warnings: undefined }),
    ]) {
      let apiCalls = 0
      const fetcher = vi.fn(async (input: string | URL | Request) => {
        if (String(input).endsWith('/health')) return response({ ok: true })
        apiCalls += 1
        return payload.clone()
      }) as unknown as typeof fetch
      await expect(new FamsApiClient(extensionId, fetcher, ['http://localhost:4000']).listSources()).rejects.toBeTruthy()
      expect(apiCalls).toBe(1)
    }
  })

  it('never retries POST after dispatch', async () => {
    let postCalls = 0
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/health')) return response({ ok: true })
      if (init?.method === 'POST') { postCalls += 1; throw new TypeError('injected response loss') }
      return response(envelope(sourceData))
    }) as unknown as typeof fetch
    await expect(new FamsApiClient(extensionId, fetcher, ['http://localhost:4000']).ask({
      workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', question: '真实问题', contextRefs: [], idempotencyKey: 'px-idem-client00000001',
    })).rejects.toBeTruthy()
    expect(postCalls).toBe(1)
  })

  it('rejects a non-v4 conversation id without retrying Ask', async () => {
    let postCalls = 0
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/health')) return response({ ok: true })
      postCalls += 1
      return response(envelope({
        conversationId: 'chat-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', messageId: 'message-1', summary: '摘要', keyEvidence: [], dataAsOf: '2026-08-28T00:00:00.000Z', confidence: 0.8, nextActions: [], artifactRefs: [], prohibitedActions: [], notTradingAdvice: true,
      }))
    }) as unknown as typeof fetch
    await expect(new FamsApiClient(extensionId, fetcher, ['http://localhost:4000']).ask({
      workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', question: '真实问题', contextRefs: [], idempotencyKey: 'px-idem-invalidchat00001',
    })).rejects.toMatchObject({ code: 'PX_API_RESPONSE_INVALID' })
    expect(postCalls).toBe(1)
  })

  it('sends the exact public extension id header on health, GET and POST', async () => {
    const observed: Array<{ url: string; extensionId: string | null; method: string }> = []
    const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers)
      observed.push({ url: String(input), extensionId: headers.get('X-FAMS-Extension-Id'), method: init?.method ?? 'GET' })
      if (String(input).endsWith('/health')) return response({ ok: true })
      if (init?.method === 'POST') return response(envelope({
        conversationId: 'chat-00fdc188-0b6b-4731-81eb-d5fc91de01ed', messageId: 'message-1', summary: '摘要', keyEvidence: [], dataAsOf: '2026-08-28T00:00:00.000Z', confidence: 0.8, nextActions: ['核对'], artifactRefs: [], prohibitedActions: ['ORDER_CREATE'], notTradingAdvice: true,
      }))
      return response(envelope(sourceData))
    }) as unknown as typeof fetch
    const client = new FamsApiClient(extensionId, fetcher, ['http://localhost:4000'])
    await client.listSources()
    await client.ask({ workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', question: '真实问题', contextRefs: [], idempotencyKey: 'px-idem-header00000001' })
    expect(observed.length).toBe(3)
    expect(observed.every((item) => item.extensionId === extensionId)).toBe(true)
    expect(observed.map((item) => item.method)).toEqual(['GET', 'GET', 'POST'])
  })

  it('invokes the browser fetch function with the global receiver', async () => {
    const fetcher = vi.fn(function (this: unknown, input: string | URL | Request) {
      if (this !== globalThis) throw new TypeError('Illegal invocation')
      return Promise.resolve(String(input).endsWith('/health') ? response({ ok: true }) : response(envelope(sourceData)))
    }) as unknown as typeof fetch
    await expect(new FamsApiClient(extensionId, fetcher, ['http://localhost:4000']).listSources()).resolves.toMatchObject({ status: 'ok' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
