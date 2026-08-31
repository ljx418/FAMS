import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({ local: {} as Record<string, unknown>, session: {} as Record<string, unknown>, writes: 0 }))
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'a'.repeat(32) },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage.local[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => { storage.writes += 1; Object.assign(storage.local, structuredClone(values)) }),
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: storage.session[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => { storage.writes += 1; Object.assign(storage.session, structuredClone(values)) }),
      },
    },
  },
}))

import { handleLifecyclePort } from '../src/background/lifecyclePortManager'

class FakePort {
  name = 'v2-px-lifecycle/1'
  sender = { url: `chrome-extension://${'a'.repeat(32)}/workspace.html` }
  disconnected = false
  posted: unknown[] = []
  messageListener: (message: unknown) => void = () => undefined
  disconnectListener: () => void = () => undefined
  onMessage = { addListener: (listener: (message: unknown) => void) => { this.messageListener = listener } }
  onDisconnect = { addListener: (listener: () => void) => { this.disconnectListener = listener } }
  postMessage(message: unknown) { this.posted.push(message) }
  disconnect() { this.disconnected = true; this.disconnectListener() }
  send(message: unknown) { this.messageListener(message) }
}

const common = {
  schemaVersion: 'v2-px-lifecycle-port-message/1', messageId: 'px-message-lifecycleport000001',
  workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', routeId: 'px-route-lifecycleport000001',
  correlationId: 'px-corr-lifecycleport000001', containerInstanceId: 'px-container-workspace000001',
  sourceContainer: 'workspace_page', targetContainer: 'background', sentAt: '2026-08-31T00:00:00.000Z',
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('LC-A lifecycle port boundary', () => {
  beforeEach(() => {
    for (const key of Object.keys(storage.local)) delete storage.local[key]
    for (const key of Object.keys(storage.session)) delete storage.session[key]
    storage.writes = 0
  })

  it('disconnects a non-subscribe first message with zero side effects', async () => {
    const port = new FakePort()
    handleLifecyclePort(port)
    port.send({ ...common, kind: 'recover_request', payload: { reason: 'manual_retry' } })
    await settle()
    expect(port.disconnected).toBe(true)
    expect(storage.writes).toBe(0)
  })

  it('rejects Host/path impersonation and secret-like payloads with zero side effects', async () => {
    const host = new FakePort()
    host.sender.url = `http://localhost:3000/operations`
    handleLifecyclePort(host)
    expect(host.disconnected).toBe(true)

    const secret = new FakePort()
    handleLifecyclePort(secret)
    secret.send({ ...common, kind: 'state_subscribe', payload: { currentView: 'source_library', navigationType: 'open', token: 'forbidden' } })
    await settle()
    expect(secret.disconnected).toBe(true)
    expect(storage.writes).toBe(0)
  })

  it('accepts one strict subscribe and returns a Background-owned snapshot', async () => {
    const port = new FakePort()
    handleLifecyclePort(port)
    port.send({ ...common, kind: 'state_subscribe', payload: { currentView: 'source_library', navigationType: 'open' } })
    await settle()
    await settle()
    expect(port.disconnected).toBe(false)
    expect(port.posted).toEqual([expect.objectContaining({ kind: 'state_snapshot', sourceContainer: 'background', targetContainer: 'workspace_page' })])
    expect(storage.writes).toBeGreaterThan(0)
    expect(JSON.stringify({ local: storage.local, session: storage.session })).not.toMatch(/question|answer|cookie|token|Authorization/i)
  })

  it('does not process Port subscriptions before the Background initialization gate resolves', async () => {
    let resolveReady: () => void = () => {}
    const readiness = new Promise<void>((resolve) => { resolveReady = resolve })
    const port = new FakePort()
    handleLifecyclePort(port, readiness)
    port.send({ ...common, kind: 'state_subscribe', payload: { currentView: 'source_library', navigationType: 'open' } })
    await settle()
    expect(storage.writes).toBe(0)
    expect(port.posted).toEqual([])
    resolveReady()
    await settle(); await settle()
    expect(port.posted).toEqual([expect.objectContaining({ kind: 'state_snapshot' })])
    expect(storage.writes).toBeGreaterThan(0)
  })

  it('blocks an unknown recovery major without overwriting another workspace session state', async () => {
    const otherWorkspaceId = 'px-ws-00000000-0000-4000-8000-000000000002'
    storage.local.recoveryIndex = [{ schemaVersion: 'v2-px-recovery-index/99', opaque: { preserve: true } }]
    storage.session.workspaceStates = {
      [otherWorkspaceId]: {
        schemaVersion: 'v2-px-workspace-state/1', workspaceId: otherWorkspaceId, lifecycleStatus: 'ready',
        currentView: 'source_library', routeId: 'px-route-otherworkspace00001', correlationId: 'px-corr-otherworkspace00001',
        connection: { status: 'connected' }, recovery: { status: 'not_needed' }, containerLeases: [],
        lastEventSeq: 0, updatedAt: '2026-08-31T00:00:00.000Z',
      },
    }
    const port = new FakePort()
    handleLifecyclePort(port)
    port.send({ ...common, kind: 'state_subscribe', payload: { currentView: 'source_library', navigationType: 'open' } })
    await settle()
    await settle()
    expect(storage.local.recoveryIndex).toEqual([{ schemaVersion: 'v2-px-recovery-index/99', opaque: { preserve: true } }])
    expect(storage.session.workspaceStates).toMatchObject({
      [otherWorkspaceId]: { lifecycleStatus: 'ready' },
      [common.workspaceId]: { lifecycleStatus: 'blocked', recovery: { reasonCode: 'PX_STORAGE_VERSION_UNSUPPORTED' } },
    })
  })

  it('lets Side Panel observe recovery without clobbering the canonical Workspace view', async () => {
    storage.local.recoveryIndex = [{
      schemaVersion: 'v2-px-recovery-index/2', workspaceId: common.workspaceId, currentView: 'trace',
      operationId: '18bb115d-5733-4ce7-8c94-81df30f2b000', updatedAt: '2026-08-31T00:00:00.000Z',
      expiresAt: '2026-09-30T00:00:00.000Z',
    }]
    const port = new FakePort()
    port.sender.url = `chrome-extension://${'a'.repeat(32)}/sidepanel.html`
    handleLifecyclePort(port)
    port.send({
      ...common, sourceContainer: 'sidepanel', containerInstanceId: 'px-container-sidepanel000001',
      kind: 'state_subscribe', payload: { currentView: 'source_library', navigationType: 'open' },
    })
    await settle()
    await settle()
    expect(port.posted).toEqual([expect.objectContaining({
      kind: 'state_snapshot',
      payload: expect.objectContaining({ workspaceState: expect.objectContaining({ currentView: 'trace', activeOperationId: '18bb115d-5733-4ce7-8c94-81df30f2b000' }) }),
    })])
    expect(storage.local.recoveryIndex).toEqual([expect.objectContaining({ currentView: 'trace', operationId: '18bb115d-5733-4ce7-8c94-81df30f2b000' })])
  })

  it('records an unexpected Port loss and performs one reconnect transition', async () => {
    const first = new FakePort()
    handleLifecyclePort(first)
    first.send({ ...common, kind: 'state_subscribe', payload: { currentView: 'source_library', navigationType: 'open' } })
    await settle(); await settle()
    first.disconnect()
    await settle(); await settle()
    expect(storage.session.workspaceStates).toMatchObject({ [common.workspaceId]: { lifecycleStatus: 'disconnected', connection: { status: 'disconnected' } } })
    expect(storage.session.lifecycleEvents).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'connection_lost', nextState: 'disconnected' })]))

    const second = new FakePort()
    handleLifecyclePort(second)
    second.send({ ...common, kind: 'state_subscribe', payload: { currentView: 'source_library', navigationType: 'restore' } })
    await settle(); await settle()
    expect(second.posted).toEqual([expect.objectContaining({ payload: expect.objectContaining({ workspaceState: expect.objectContaining({ lifecycleStatus: 'recovering' }) }) })])
    expect(storage.session.lifecycleEvents).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'reconnect', nextState: 'recovering' })]))
  })

  it('keeps the workspace live until the last of two containers closes', async () => {
    const workspace = new FakePort()
    const sidepanel = new FakePort()
    sidepanel.sender.url = `chrome-extension://${'a'.repeat(32)}/sidepanel.html`
    handleLifecyclePort(workspace); handleLifecyclePort(sidepanel)
    workspace.send({ ...common, kind: 'state_subscribe', payload: { currentView: 'source_library', navigationType: 'open' } })
    sidepanel.send({ ...common, sourceContainer: 'sidepanel', containerInstanceId: 'px-container-sidepanel000001', kind: 'state_subscribe', payload: { currentView: 'source_library', navigationType: 'open' } })
    await settle(); await settle(); await settle()
    workspace.send({ ...common, kind: 'container_close', payload: { reason: 'user_close' } })
    await settle(); await settle()
    expect(storage.session.workspaceStates).toMatchObject({ [common.workspaceId]: { lifecycleStatus: 'connecting', containerLeases: [expect.objectContaining({ container: 'sidepanel' })] } })
    sidepanel.send({ ...common, sourceContainer: 'sidepanel', containerInstanceId: 'px-container-sidepanel000001', kind: 'container_close', payload: { reason: 'user_close' } })
    await settle(); await settle()
    expect(storage.session.workspaceStates).toMatchObject({ [common.workspaceId]: { lifecycleStatus: 'closed', containerLeases: [] } })
    expect(storage.session.lifecycleEvents).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'close', nextState: 'closed' })]))
  })
})
