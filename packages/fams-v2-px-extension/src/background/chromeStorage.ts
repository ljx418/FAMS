import { browser } from 'wxt/browser'
import type { LedgerRecord, LedgerStorage } from '../state/idempotencyRegistry'
import type { LifecycleEvent, WorkspaceStateV1 } from '../contracts/types'
import { DEFAULT_WORKSPACE_ID } from '../contracts/validation'
import { appendLifecycleEvent } from '../state/lifecycleAuditStore'

const LEDGER_KEY = 'dispatchLedger'
const EVENTS_KEY = 'lifecycleEvents'
const WORKSPACES_KEY = 'workspaceStates'

export class PxStorageMigrationBlockedError extends Error {
  readonly code = 'PX_STORAGE_VERSION_BLOCKED'

  constructor(message: string) {
    super(message)
    this.name = 'PxStorageMigrationBlockedError'
  }
}

export const chromeLedgerStorage: LedgerStorage = {
  async readAll() {
    const value = await browser.storage.local.get(LEDGER_KEY)
    return Array.isArray(value[LEDGER_KEY]) ? value[LEDGER_KEY] as LedgerRecord[] : []
  },
  async writeAll(records) {
    await browser.storage.local.set({ [LEDGER_KEY]: records })
  },
}

export async function readLifecycleEvents(): Promise<LifecycleEvent[]> {
  const value = await browser.storage.session.get(EVENTS_KEY)
  return Array.isArray(value[EVENTS_KEY]) ? value[EVENTS_KEY] as LifecycleEvent[] : []
}

export async function writeLifecycleEvents(events: LifecycleEvent[]): Promise<void> {
  await browser.storage.session.set({ [EVENTS_KEY]: events.slice(-1000) })
}

export async function readWorkspaceStates(): Promise<Record<string, WorkspaceStateV1>> {
  const value = await browser.storage.session.get(WORKSPACES_KEY)
  if (!value[WORKSPACES_KEY] || typeof value[WORKSPACES_KEY] !== 'object') return {}
  const raw = value[WORKSPACES_KEY] as Record<string, WorkspaceStateV1>
  for (const [key, state] of Object.entries(raw)) {
    if (!state || state.schemaVersion !== 'v2-px-workspace-state/1') {
      throw new PxStorageMigrationBlockedError(`Unknown workspace storage version at ${key}`)
    }
  }
  const legacy = raw.default_workspace
  if (!legacy) return raw
  if (raw[DEFAULT_WORKSPACE_ID]) {
    throw new PxStorageMigrationBlockedError('Legacy and reserved default workspace states conflict')
  }

  const events = await readLifecycleEvents()
  const routeId = legacy.routeId || `px-route-${crypto.randomUUID().replaceAll('-', '')}`
  const correlationId = legacy.correlationId || `px-corr-${crypto.randomUUID().replaceAll('-', '')}`
  const event = appendLifecycleEvent({
    events,
    workspaceId: DEFAULT_WORKSPACE_ID,
    routeId,
    correlationId,
    container: 'background',
    containerInstanceId: 'background-single-writer',
    eventType: 'state_migrated',
    previousState: 'uninitialized',
    reasonCode: 'MIGRATION_OK',
  })
  const migrated: WorkspaceStateV1 = {
    ...legacy,
    workspaceId: DEFAULT_WORKSPACE_ID,
    lifecycleStatus: event.nextState,
    routeId,
    correlationId,
    recovery: { status: 'restored' },
    lastEventSeq: event.sequence,
    updatedAt: event.at,
  }
  const { default_workspace: _removed, ...remaining } = raw
  const states = { ...remaining, [DEFAULT_WORKSPACE_ID]: migrated }
  await browser.storage.session.set({
    [EVENTS_KEY]: [...events, event].slice(-1000),
    [WORKSPACES_KEY]: states,
  })
  return states
}

export async function writeWorkspaceStates(states: Record<string, WorkspaceStateV1>): Promise<void> {
  const entries = Object.entries(states)
    .sort(([, left], [, right]) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    .slice(-20)
  await browser.storage.session.set({ [WORKSPACES_KEY]: Object.fromEntries(entries) })
}
