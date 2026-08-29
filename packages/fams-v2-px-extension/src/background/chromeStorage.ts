import { browser } from 'wxt/browser'
import type { LedgerRecord, LedgerStorage } from '../state/idempotencyRegistry'
import type { LifecycleEvent, WorkspaceStateV1 } from '../contracts/types'
import type { RouteIntent } from '../contracts/types'
import { DEFAULT_WORKSPACE_ID, isConversationId, isFamsEntityId, isSourceRef, isWorkspaceId } from '../contracts/validation'
import { stableJson } from '../contracts/stableJson'
import { appendLifecycleEvent } from '../state/lifecycleAuditStore'

const LEDGER_KEY = 'dispatchLedger'
const EVENTS_KEY = 'lifecycleEvents'
const WORKSPACES_KEY = 'workspaceStates'
const RECOVERY_INDEX_KEY = 'recoveryIndex'
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

export type RecoveryIndexRecord = {
  schemaVersion: 'v2-px-recovery-index/1'
  workspaceId: string
  currentView: RouteIntent
  selectedRef?: string
  conversationId?: string
  operationId?: string
  updatedAt: string
  expiresAt: string
}

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

function validRecoveryRecord(value: unknown): value is RecoveryIndexRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const required = ['schemaVersion', 'workspaceId', 'currentView', 'updatedAt', 'expiresAt']
  const optional = ['selectedRef', 'conversationId', 'operationId']
  const allowed = new Set([...required, ...optional])
  if (!required.every((key) => key in record) || Object.keys(record).some((key) => !allowed.has(key))) return false
  if (record.schemaVersion !== 'v2-px-recovery-index/1' || !isWorkspaceId(record.workspaceId)) return false
  if (!['source_library', 'source_detail', 'ask', 'trace', 'graph'].includes(String(record.currentView))) return false
  if (!Number.isFinite(Date.parse(String(record.updatedAt))) || !Number.isFinite(Date.parse(String(record.expiresAt)))) return false
  if ('selectedRef' in record && !isSourceRef(record.selectedRef)) return false
  if ('conversationId' in record && !isConversationId(record.conversationId)) return false
  if ('operationId' in record && !isFamsEntityId(record.operationId)) return false
  return true
}

export async function readRecoveryIndex(): Promise<RecoveryIndexRecord[]> {
  const value = await browser.storage.local.get(RECOVERY_INDEX_KEY)
  const raw = value[RECOVERY_INDEX_KEY]
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.some((record) => !validRecoveryRecord(record))) {
    throw new PxStorageMigrationBlockedError('Unknown recovery index storage version or shape')
  }
  return raw as RecoveryIndexRecord[]
}

export async function writeRecoveryIndexRecord(
  input: Omit<RecoveryIndexRecord, 'schemaVersion' | 'expiresAt'>,
  now = new Date(),
): Promise<void> {
  const records = (await readRecoveryIndex())
    .filter((record) => Date.parse(record.expiresAt) > now.getTime() && record.workspaceId !== input.workspaceId)
    .sort((left, right) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    .slice(-19)
  const expected: RecoveryIndexRecord = {
    schemaVersion: 'v2-px-recovery-index/1',
    ...input,
    expiresAt: new Date(now.getTime() + THIRTY_DAYS_MS).toISOString(),
  }
  if (!validRecoveryRecord(expected)) throw new PxStorageMigrationBlockedError('Recovery index record is invalid')
  await browser.storage.local.set({ [RECOVERY_INDEX_KEY]: [...records, expected] })
  const readback = await readRecoveryIndex()
  const actual = readback.find((record) => record.workspaceId === expected.workspaceId)
  if (!actual || stableJson(actual) !== stableJson(expected)) throw new Error('PX recovery index readback verification failed')
}

export async function readLifecycleEvents(): Promise<LifecycleEvent[]> {
  const value = await browser.storage.session.get(EVENTS_KEY)
  return Array.isArray(value[EVENTS_KEY]) ? value[EVENTS_KEY] as LifecycleEvent[] : []
}

export async function writeLifecycleEvents(events: LifecycleEvent[]): Promise<void> {
  await browser.storage.session.set({ [EVENTS_KEY]: events.slice(-1000) })
}

export async function writeWorkspaceStateAndEvents(
  states: Record<string, WorkspaceStateV1>,
  events: LifecycleEvent[],
): Promise<void> {
  const entries = Object.entries(states)
    .sort(([, left], [, right]) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    .slice(-20)
  await browser.storage.session.set({
    [EVENTS_KEY]: events.slice(-1000),
    [WORKSPACES_KEY]: Object.fromEntries(entries),
  })
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
