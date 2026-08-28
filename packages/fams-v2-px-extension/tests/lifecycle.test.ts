import { describe, expect, it } from 'vitest'
import { appendLifecycleEvent, deriveLifecycleState } from '../src/state/lifecycleAuditStore'

describe('lifecycle/3 event-derived state', () => {
  it('derives recovery transitions from ordered events', () => {
    const common = {
      workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', routeId: 'px-route-lifecycle00000009', correlationId: 'px-corr-lifecycle00000009',
      container: 'background' as const, containerInstanceId: 'background-single-writer',
    }
    const start = appendLifecycleEvent({ events: [], ...common, eventType: 'start', previousState: 'uninitialized', now: '2026-08-28T00:00:00.000Z' })
    const connected = appendLifecycleEvent({ events: [start], ...common, eventType: 'connected', previousState: 'connecting', now: '2026-08-28T00:00:01.000Z' })
    const lost = appendLifecycleEvent({ events: [start, connected], ...common, eventType: 'connection_lost', previousState: 'ready', now: '2026-08-28T00:00:02.000Z' })
    const reconnect = appendLifecycleEvent({ events: [start, connected, lost], ...common, eventType: 'reconnect', previousState: 'disconnected', now: '2026-08-28T00:00:03.000Z' })
    expect(deriveLifecycleState([start, connected, lost, reconnect])).toBe('recovering')
  })

  it('rejects event order or self-reported previous state drift', () => {
    expect(() => appendLifecycleEvent({
      events: [], workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', routeId: 'px-route-lifecycle00000010', correlationId: 'px-corr-lifecycle00000010',
      container: 'background', containerInstanceId: 'background-single-writer', eventType: 'connected', previousState: 'connecting',
    })).toThrow('previous state drift')
  })

  it('keeps sequence monotonic per workspace and rejects mixed streams and gaps', () => {
    const firstWorkspace = 'px-ws-00000000-0000-4000-8000-000000000001'
    const secondWorkspace = 'px-ws-00fdc188-0b6b-4731-81eb-d5fc91de01ed'
    const common = { routeId: 'px-route-lifecycle00000011', correlationId: 'px-corr-lifecycle00000011', container: 'background' as const, containerInstanceId: 'background-single-writer' }
    const one = appendLifecycleEvent({ events: [], workspaceId: firstWorkspace, ...common, eventType: 'start', previousState: 'uninitialized' })
    const two = appendLifecycleEvent({ events: [one], workspaceId: secondWorkspace, ...common, eventType: 'start', previousState: 'uninitialized' })
    const three = appendLifecycleEvent({ events: [one, two], workspaceId: firstWorkspace, ...common, eventType: 'connected', previousState: 'connecting' })
    expect([one.sequence, two.sequence, three.sequence]).toEqual([1, 1, 2])
    expect(() => deriveLifecycleState([one, two])).toThrow('mixes workspaces')
    expect(() => deriveLifecycleState([one, { ...three, sequence: 3 }])).toThrow('sequence has a gap')
  })
})
