import { beforeEach, describe, expect, it, vi } from 'vitest'

const sessionValues: Record<string, unknown> = {}
const localValues: Record<string, unknown> = {}

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: localValues[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(localValues, values)),
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionValues[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(sessionValues, values)),
      },
    },
  },
}))

import { PxStorageMigrationBlockedError, prepareRecoveryIndexStorage, readLifecycleEvents, readRecoveryIndex, readWorkspaceStates, writeRecoveryIndexRecord } from '../src/background/chromeStorage'
import { beginLifecycleReconnect, expireStaleLifecycleLeases, initializeLifecycleStorage, markLifecycleConnectionLost } from '../src/background/lifecycleCoordinator'
import { DEFAULT_WORKSPACE_ID } from '../src/contracts/validation'
import { appendLifecycleEvent } from '../src/state/lifecycleAuditStore'

const legacyState = {
  schemaVersion: 'v2-px-workspace-state/1' as const,
  workspaceId: 'default_workspace',
  lifecycleStatus: 'ready' as const,
  currentView: 'source_library' as const,
  routeId: 'px-route-migration00000001',
  correlationId: 'px-corr-migration00000001',
  connection: { status: 'connected' as const },
  recovery: { status: 'not_needed' as const },
  containerLeases: [],
  lastEventSeq: 0,
  updatedAt: '2026-08-28T00:00:00.000Z',
}

describe('workspace storage migration', () => {
  beforeEach(() => {
    for (const key of Object.keys(sessionValues)) delete sessionValues[key]
    for (const key of Object.keys(localValues)) delete localValues[key]
  })

  it('atomically migrates default_workspace and emits state_migrated', async () => {
    sessionValues.workspaceStates = { default_workspace: legacyState }
    sessionValues.lifecycleEvents = []
    const states = await readWorkspaceStates()
    expect(states.default_workspace).toBeUndefined()
    expect(states[DEFAULT_WORKSPACE_ID]).toMatchObject({ workspaceId: DEFAULT_WORKSPACE_ID, lifecycleStatus: 'recovering', lastEventSeq: 1 })
    expect(await readLifecycleEvents()).toEqual([
      expect.objectContaining({ workspaceId: DEFAULT_WORKSPACE_ID, eventType: 'state_migrated', sequence: 1, previousState: 'uninitialized', nextState: 'recovering' }),
    ])
  })

  it('blocks unknown storage versions instead of guessing', async () => {
    sessionValues.workspaceStates = { default_workspace: { ...legacyState, schemaVersion: 'v2-px-workspace-state/99' } }
    await expect(readWorkspaceStates()).rejects.toBeInstanceOf(PxStorageMigrationBlockedError)
  })

  it('keeps a verified 20-item/30-day recovery index without question or answer bodies', async () => {
    const now = new Date('2026-08-29T00:00:00.000Z')
    for (let index = 0; index < 21; index += 1) {
      await writeRecoveryIndexRecord({
        workspaceId: `px-ws-00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        currentView: index % 2 === 0 ? 'ask' : 'trace',
        operationId: 'cd46818b-4983-4df4-9975-e67fead6ade2',
        updatedAt: new Date(now.getTime() + index * 1000).toISOString(),
      }, now)
    }
    const records = await readRecoveryIndex()
    expect(records).toHaveLength(20)
    expect(JSON.stringify(localValues)).not.toMatch(/question|answer|cookie|token|Authorization/i)
  })

  it('cleans expired recovery records and blocks an unknown recovery schema', async () => {
    localValues.recoveryIndex = [{
      schemaVersion: 'v2-px-recovery-index/1', workspaceId: DEFAULT_WORKSPACE_ID, currentView: 'ask',
      updatedAt: '2026-06-01T00:00:00.000Z', expiresAt: '2026-06-30T00:00:00.000Z',
    }]
    await writeRecoveryIndexRecord({ workspaceId: DEFAULT_WORKSPACE_ID, currentView: 'source_library', updatedAt: '2026-08-29T00:00:00.000Z' }, new Date('2026-08-29T00:00:00.000Z'))
    expect(await readRecoveryIndex()).toEqual([expect.objectContaining({ currentView: 'source_library' })])
    localValues.recoveryIndex = [{ schemaVersion: 'v2-px-recovery-index/99' }]
    await expect(readRecoveryIndex()).rejects.toBeInstanceOf(PxStorageMigrationBlockedError)
  })

  it('migrates the only known recovery v1 to v2, emits state_migrated, and preserves unknown major bytes', async () => {
    localValues.recoveryIndex = [{
      schemaVersion: 'v2-px-recovery-index/1', workspaceId: DEFAULT_WORKSPACE_ID, currentView: 'trace',
      operationId: 'cd46818b-4983-4df4-9975-e67fead6ade2', updatedAt: '2026-08-29T00:00:00.000Z', expiresAt: '2026-09-29T00:00:00.000Z',
    }]
    await initializeLifecycleStorage(new Date('2026-08-31T00:00:00.000Z'))
    expect(localValues.recoveryIndex).toEqual([expect.objectContaining({ schemaVersion: 'v2-px-recovery-index/2', currentView: 'trace' })])
    expect(await readLifecycleEvents()).toEqual([expect.objectContaining({ eventType: 'state_migrated', reasonCode: 'MIGRATION_OK' })])

    const unknown = [{ schemaVersion: 'v2-px-recovery-index/99', opaque: { keep: 'exactly' } }]
    localValues.recoveryIndex = structuredClone(unknown)
    await expect(prepareRecoveryIndexStorage()).rejects.toBeInstanceOf(PxStorageMigrationBlockedError)
    expect(localValues.recoveryIndex).toEqual(unknown)
  })

  it('expires the last stale lease to closed and derives disconnect/reconnect events', async () => {
    const start = appendLifecycleEvent({
      events: [], workspaceId: DEFAULT_WORKSPACE_ID, routeId: 'px-route-leaselifecycle0001', correlationId: 'px-corr-leaselifecycle0001',
      container: 'workspace_page', containerInstanceId: 'px-container-leaselifecycle0001', eventType: 'start', previousState: 'uninitialized',
      now: '2026-08-31T00:00:00.000Z',
    })
    const ready = appendLifecycleEvent({
      events: [start], workspaceId: DEFAULT_WORKSPACE_ID, routeId: start.routeId, correlationId: start.correlationId,
      container: 'background', containerInstanceId: 'px-container-background000001', eventType: 'load_succeeded', previousState: start.nextState,
      now: '2026-08-31T00:00:01.000Z',
    })
    sessionValues.lifecycleEvents = [start, ready]
    sessionValues.workspaceStates = {
      [DEFAULT_WORKSPACE_ID]: {
        schemaVersion: 'v2-px-workspace-state/1', workspaceId: DEFAULT_WORKSPACE_ID, lifecycleStatus: 'ready', currentView: 'source_library',
        routeId: start.routeId, correlationId: start.correlationId, connection: { status: 'connected' }, recovery: { status: 'restored' },
        containerLeases: [{ container: 'workspace_page', instanceId: 'px-container-leaselifecycle0001', lastSeenAt: '2026-08-31T00:00:00.000Z' }],
        lastEventSeq: 2, updatedAt: ready.at,
      },
    }
    await expireStaleLifecycleLeases(new Date('2026-08-31T00:06:00.000Z'))
    expect(sessionValues.workspaceStates).toMatchObject({ [DEFAULT_WORKSPACE_ID]: { lifecycleStatus: 'closed', containerLeases: [] } })
    expect(sessionValues.lifecycleEvents).toEqual(expect.arrayContaining([expect.objectContaining({ eventType: 'lease_expired', nextState: 'closed', reasonCode: 'LEASE_TIMEOUT' })]))

    const events = sessionValues.lifecycleEvents as Array<Record<string, unknown>>
    const closed = events.at(-1)!
    sessionValues.workspaceStates = {
      [DEFAULT_WORKSPACE_ID]: {
        ...(sessionValues.workspaceStates as Record<string, Record<string, unknown>>)[DEFAULT_WORKSPACE_ID],
        lifecycleStatus: closed.nextState, containerLeases: [{ container: 'workspace_page', instanceId: 'px-container-leaselifecycle0002', lastSeenAt: '2026-08-31T00:06:00.000Z' }],
      },
    }
    // A new subscription normally resumes closed first; exercise the dedicated
    // live disconnect/reconnect transition from a fresh ready stream below.
    sessionValues.lifecycleEvents = [start, ready]
    sessionValues.workspaceStates = {
      [DEFAULT_WORKSPACE_ID]: {
        schemaVersion: 'v2-px-workspace-state/1', workspaceId: DEFAULT_WORKSPACE_ID, lifecycleStatus: 'ready', currentView: 'source_library',
        routeId: start.routeId, correlationId: start.correlationId, connection: { status: 'connected' }, recovery: { status: 'restored' },
        containerLeases: [{ container: 'workspace_page', instanceId: 'px-container-leaselifecycle0002', lastSeenAt: '2026-08-31T00:06:00.000Z' }],
        lastEventSeq: 2, updatedAt: ready.at,
      },
    }
    await markLifecycleConnectionLost({ workspaceId: DEFAULT_WORKSPACE_ID, container: 'workspace_page', containerInstanceId: 'px-container-leaselifecycle0002' })
    await beginLifecycleReconnect(DEFAULT_WORKSPACE_ID)
    expect(sessionValues.workspaceStates).toMatchObject({ [DEFAULT_WORKSPACE_ID]: { lifecycleStatus: 'recovering', connection: { status: 'connecting' }, recovery: { status: 'recovering' } } })
    expect((sessionValues.lifecycleEvents as Array<Record<string, unknown>>).slice(-2)).toEqual([
      expect.objectContaining({ eventType: 'connection_lost', nextState: 'disconnected' }),
      expect.objectContaining({ eventType: 'reconnect', nextState: 'recovering' }),
    ])
  })
})
