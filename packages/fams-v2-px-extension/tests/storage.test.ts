import { beforeEach, describe, expect, it, vi } from 'vitest'

const sessionValues: Record<string, unknown> = {}

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: { get: vi.fn(), set: vi.fn() },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: sessionValues[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => Object.assign(sessionValues, values)),
      },
    },
  },
}))

import { PxStorageMigrationBlockedError, readLifecycleEvents, readWorkspaceStates } from '../src/background/chromeStorage'
import { DEFAULT_WORKSPACE_ID } from '../src/contracts/validation'

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
})
