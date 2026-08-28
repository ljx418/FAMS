import { describe, expect, it } from 'vitest'
import { appendLifecycleEvent, deriveLifecycleState } from '../src/state/lifecycleAuditStore'

describe('lifecycle/3 event-derived state', () => {
  it('derives recovery transitions from ordered events', () => {
    const common = {
      workspaceId: 'default_workspace', routeId: 'px-route-lifecycle00000009', correlationId: 'px-corr-lifecycle00000009',
      container: 'background' as const, containerInstanceId: 'background-single-writer',
    }
    const start = appendLifecycleEvent({ events: [], ...common, eventType: 'start', previousState: 'uninitialized', now: '2026-08-28T00:00:00.000Z' })
    const connected = appendLifecycleEvent({ events: [start], ...common, eventType: 'connected', previousState: 'connecting', now: '2026-08-28T00:00:01.000Z' })
    const lost = appendLifecycleEvent({ events: [start, connected], ...common, eventType: 'connection_lost', previousState: 'ready', now: '2026-08-28T00:00:02.000Z' })
    const reconnect = appendLifecycleEvent({ events: [start, connected, lost], ...common, eventType: 'reconnect', previousState: 'disconnected', now: '2026-08-28T00:00:03.000Z' })
    expect(deriveLifecycleState([start, connected, lost, reconnect])).toBe('recovering')
  })

  it('rejects event order or self-reported previous state drift', () => {
    const event = appendLifecycleEvent({
      events: [], workspaceId: 'default_workspace', routeId: 'px-route-lifecycle00000010', correlationId: 'px-corr-lifecycle00000010',
      container: 'background', containerInstanceId: 'background-single-writer', eventType: 'connected', previousState: 'connecting',
    })
    expect(() => deriveLifecycleState([event])).toThrow('event order')
  })
})
