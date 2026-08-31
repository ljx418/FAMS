import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakePort {
  posted: Array<Record<string, unknown>> = []
  messageListeners: Array<(message: unknown) => void> = []
  disconnectListeners: Array<() => void> = []
  onMessage = { addListener: (listener: (message: unknown) => void) => { this.messageListeners.push(listener) } }
  onDisconnect = { addListener: (listener: () => void) => { this.disconnectListeners.push(listener) } }
  postMessage(message: Record<string, unknown>) { this.posted.push(message) }
  disconnect() { this.disconnectListeners.forEach((listener) => listener()) }
  emitMessage(message: unknown) { this.messageListeners.forEach((listener) => listener(message)) }
}

const ports = vi.hoisted(() => [] as FakePort[])
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      connect: vi.fn(() => { const port = new FakePort(); ports.push(port); return port }),
    },
  },
}))

import { openLifecycleChannel } from '../src/ui/lifecycleClient'

describe('bounded lifecycle Port reconnect client', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    ports.splice(0)
    const values = new Map<string, string>()
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('performance', { getEntriesByType: () => [{ type: 'navigate' }] })
    vi.stubGlobal('document', { referrer: '' })
    vi.stubGlobal('location', { origin: `chrome-extension://${'a'.repeat(32)}` })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reconnects exactly once after 250ms and subscribes with restore', async () => {
    const lost = vi.fn()
    const exhausted = vi.fn()
    const channel = openLifecycleChannel({
      workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', container: 'workspace_page', currentView: 'trace',
      selectedRef: '18bb115d-5733-4ce7-8c94-81df30f2b000', onConnectionLost: lost, onReconnectExhausted: exhausted,
    })
    expect(ports).toHaveLength(1)
    expect(ports[0]?.posted[0]).toMatchObject({ kind: 'state_subscribe', payload: { currentView: 'trace', navigationType: 'open' } })
    ports[0]?.disconnect()
    expect(lost).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(249)
    expect(ports).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(ports).toHaveLength(2)
    expect(ports[1]?.posted[0]).toMatchObject({ kind: 'state_subscribe', payload: { currentView: 'trace', navigationType: 'restore' } })

    const subscribe = ports[1]!.posted[0]!
    const now = new Date().toISOString()
    ports[1]?.emitMessage({
      ...subscribe, messageId: 'px-message-clientreconnect0001', kind: 'state_snapshot', sourceContainer: 'background', targetContainer: 'workspace_page', sentAt: now,
      payload: {
        workspaceState: { schemaVersion: 'v2-px-workspace-state/1', workspaceId: subscribe.workspaceId },
        recoveryOutcome: 'restored', snapshotAt: now,
      },
    })
    await expect(channel.firstSnapshot).resolves.toMatchObject({ kind: 'state_snapshot' })
    ports[1]?.disconnect()
    expect(lost).toHaveBeenCalledTimes(2)
    expect(exhausted).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(ports).toHaveLength(2)
  })
})
