import { browser } from 'wxt/browser'
import type { LedgerRecord, LedgerStorage } from '../state/idempotencyRegistry'
import type { LifecycleEvent, WorkspaceStateV1 } from '../contracts/types'

const LEDGER_KEY = 'dispatchLedger'
const EVENTS_KEY = 'lifecycleEvents'
const WORKSPACES_KEY = 'workspaceStates'

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
  return value[WORKSPACES_KEY] && typeof value[WORKSPACES_KEY] === 'object'
    ? value[WORKSPACES_KEY] as Record<string, WorkspaceStateV1>
    : {}
}

export async function writeWorkspaceStates(states: Record<string, WorkspaceStateV1>): Promise<void> {
  const entries = Object.entries(states)
    .sort(([, left], [, right]) => Date.parse(left.updatedAt) - Date.parse(right.updatedAt))
    .slice(-20)
  await browser.storage.session.set({ [WORKSPACES_KEY]: Object.fromEntries(entries) })
}
