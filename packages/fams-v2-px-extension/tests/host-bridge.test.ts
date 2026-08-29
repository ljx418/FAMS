import { describe, expect, it, vi } from 'vitest'
import {
  PX_DEFAULT_WORKSPACE_ID,
  buildPxHostRuntimeMessage,
  sendPxHostRouteWithDependencies,
  type PxHostBridgeDependencies,
  type PxHostRouteRequest,
} from '../../../frontend/src/services/pxExternalBrainBridge'

const extensionId = 'abcdefghijklmnopabcdefghijklmnop'
const reviewId = 'a39d4ba3-e272-46a7-ba5f-e3a495d499be'
const operationId = '3add7c80-2c68-4b6c-9a8b-7b531de9b78e'

const requests: PxHostRouteRequest[] = [
  { entryAction: 'open_workspace', routeIntent: 'ask', routePayload: { workspaceId: PX_DEFAULT_WORKSPACE_ID } },
  { entryAction: 'open_in_workspace', routeIntent: 'graph', routePayload: { workspaceId: PX_DEFAULT_WORKSPACE_ID, graphScope: 'daily-review', graphId: reviewId } },
  { entryAction: 'open_in_workspace', routeIntent: 'trace', routePayload: { workspaceId: PX_DEFAULT_WORKSPACE_ID, operationId } },
]

describe('FAMS Host bridge', () => {
  it('builds the three strict host intent routes without question, secret or business objects', () => {
    for (const request of requests) {
      const message = buildPxHostRuntimeMessage(request, 'a'.repeat(40))
      expect(message.messageType).toBe('intent_route')
      expect(message.sourceContainer).toBe('host_app')
      expect(message.targetContainer).toBe('workspace_page')
      expect(message.payload.targetContainer).toBe('workspace_page')
      expect(message.payload.routePayload).toEqual(request.routePayload)
      expect(message.routeId).toBe(message.payload.routeId)
      expect(message.correlationId).toBe(message.payload.correlationId)
      expect(JSON.stringify(message)).not.toMatch(/question|answer|cookie|token|rawscreenshot|accountimage/i)
    }
  })

  it('blocks invalid IDs and additional payload fields before calling Chrome', async () => {
    const sendMessage = vi.fn()
    const invalid = {
      entryAction: 'open_in_workspace',
      routeIntent: 'trace',
      routePayload: { workspaceId: PX_DEFAULT_WORKSPACE_ID, operationId: 'not-a-uuid', question: '不得发送' },
    } as unknown as PxHostRouteRequest
    const result = await sendPxHostRouteWithDependencies(invalid, { extensionId, runtime: { sendMessage } })
    expect(result.status).toBe('invalid_context')
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it.each([undefined, '', 'zzzz'])('keeps configuration failure visible and sends nothing for ID=%s', async (configuredId) => {
    const sendMessage = vi.fn()
    const result = await sendPxHostRouteWithDependencies(requests[0]!, { extensionId: configuredId, runtime: { sendMessage } })
    expect(result.status).toBe('configuration_required')
    expect(result.userMessage).toMatch(/配置|扩展 ID/)
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('returns accepted identifiers and ack timing from the real callback shape', async () => {
    let clock = 100
    const runtime = {
      sendMessage: (_id: string, message: ReturnType<typeof buildPxHostRuntimeMessage>, callback: (response: unknown) => void) => {
        clock = 149
        callback({ status: 'accepted', routeId: message.routeId, correlationId: message.correlationId })
      },
    }
    const result = await sendPxHostRouteWithDependencies(requests[0]!, { extensionId, runtime, now: () => clock })
    expect(result).toMatchObject({ ok: true, status: 'accepted', ackMs: 49 })
    expect(result.routeId).toMatch(/^px-route-/)
    expect(result.correlationId).toMatch(/^px-corr-/)
  })

  it('sanitizes runtime.lastError and does not leak its raw message', async () => {
    const runtime: PxHostBridgeDependencies['runtime'] = {
      lastError: { message: 'Could not establish connection. Receiving end does not exist.' },
      sendMessage: (_id, _message, callback) => callback(undefined),
    }
    const result = await sendPxHostRouteWithDependencies(requests[0]!, { extensionId, runtime })
    expect(result.status).toBe('unavailable')
    expect(result.userMessage).toMatch(/安装|启用|扩展 ID/)
    expect(result.userMessage).not.toMatch(/Could not establish|Receiving end|runtime\.lastError/)
  })

  it('times out honestly and never changes the result when the callback is absent', async () => {
    vi.useFakeTimers()
    try {
      const promise = sendPxHostRouteWithDependencies(requests[0]!, {
        extensionId,
        runtime: { sendMessage: vi.fn() },
        timeoutMs: 10,
      })
      await vi.advanceTimersByTimeAsync(11)
      await expect(promise).resolves.toMatchObject({ ok: false, status: 'timed_out' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a safe Background policy reason without retrying', async () => {
    const sendMessage = vi.fn((_id, _message, callback) => callback({ status: 'blocked', error: { userMessage: '当前对象未通过合同校验。' } }))
    const result = await sendPxHostRouteWithDependencies(requests[2]!, { extensionId, runtime: { sendMessage } })
    expect(result).toMatchObject({ ok: false, status: 'blocked', userMessage: '当前对象未通过合同校验。' })
    expect(sendMessage).toHaveBeenCalledTimes(1)
  })
})
