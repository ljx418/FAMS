import type { LifecyclePortMessage, WorkspaceStateV1 } from '../contracts/types'
import { isConversationId, isFamsEntityId, isSourceRef } from '../contracts/validation'
import { cleanLedgerStorage } from '../state/idempotencyRegistry'
import { appendLifecycleEvent } from '../state/lifecycleAuditStore'
import {
  chromeLedgerStorage,
  findRecoveryIndexRecord,
  prepareRecoveryIndexStorage,
  PxStorageMigrationBlockedError,
  readLifecycleEvents,
  readWorkspaceStates,
  writeRecoveryIndexRecord,
  writeWorkspaceStateAndEvents,
  type RecoveryIndexRecord,
} from './chromeStorage'
import { LIFECYCLE_STATE_WRITER_KEY, serializeWorkspaceState } from './workspaceStateQueue'
import { operationPoller } from './operationPoller'

type ClientMessage = Extract<LifecyclePortMessage, { kind: 'state_subscribe' | 'recover_request' | 'container_close' }>
type SnapshotMessage = Extract<LifecyclePortMessage, { kind: 'state_snapshot' }>
const BACKGROUND_INSTANCE_ID = 'px-container-background-single-writer'
export const STALE_LEASE_MS = 5 * 60 * 1000

function token(prefix: 'message' | 'route' | 'corr'): string {
  return `px-${prefix}-${crypto.randomUUID().replaceAll('-', '')}`
}

function stateFromRecovery(record: RecoveryIndexRecord, routeId: string, correlationId: string, now: string): WorkspaceStateV1 {
  return {
    schemaVersion: 'v2-px-workspace-state/1',
    workspaceId: record.workspaceId,
    lifecycleStatus: 'uninitialized',
    currentView: record.currentView,
    routeId,
    correlationId,
    ...(record.selectedRef ? { selectedRef: record.selectedRef } : {}),
    ...(record.conversationId ? { conversationId: record.conversationId } : {}),
    ...(record.operationId ? { activeOperationId: record.operationId } : {}),
    ...(record.activeGraph ? { activeGraph: record.activeGraph } : {}),
    connection: { status: 'not_connected' },
    recovery: { status: 'recovering' },
    containerLeases: [],
    lastEventSeq: 0,
    updatedAt: now,
  }
}

function recoveryInput(state: WorkspaceStateV1) {
  return {
    workspaceId: state.workspaceId,
    currentView: state.currentView,
    ...(state.selectedRef ? { selectedRef: state.selectedRef } : {}),
    ...(state.conversationId ? { conversationId: state.conversationId } : {}),
    ...(state.activeOperationId ? { operationId: state.activeOperationId } : {}),
    ...(state.activeGraph ? { activeGraph: state.activeGraph } : {}),
    updatedAt: state.updatedAt,
  }
}

function reconcileSubscription(state: WorkspaceStateV1, message: Extract<ClientMessage, { kind: 'state_subscribe' }>): WorkspaceStateV1 {
  const selectedRef = message.payload.selectedRef
  const next: WorkspaceStateV1 = { ...state, currentView: message.payload.currentView }
  if (message.payload.currentView === 'source_library') {
    delete next.selectedRef
  } else if (message.payload.currentView === 'source_detail' && selectedRef && isSourceRef(selectedRef)) {
    next.selectedRef = selectedRef
  } else if (message.payload.currentView === 'trace' && selectedRef && isFamsEntityId(selectedRef)) {
    next.activeOperationId = selectedRef
  } else if (message.payload.currentView === 'ask' && selectedRef && isConversationId(selectedRef)) {
    next.conversationId = selectedRef
  } else if (message.payload.currentView === 'graph' && selectedRef && next.activeGraph?.id !== selectedRef) {
    delete next.activeGraph
  }
  return next
}

function recoveryOutcome(state: WorkspaceStateV1): SnapshotMessage['payload']['recoveryOutcome'] {
  if (state.recovery.status === 'restored') return 'restored'
  if (state.recovery.status === 'blocked' || state.lifecycleStatus === 'blocked') return 'blocked'
  return 'not_needed'
}

export function createStateSnapshot(state: WorkspaceStateV1, target: 'sidepanel' | 'workspace_page', containerInstanceId: string): SnapshotMessage {
  const now = new Date().toISOString()
  return {
    schemaVersion: 'v2-px-lifecycle-port-message/1',
    messageId: token('message'),
    kind: 'state_snapshot',
    workspaceId: state.workspaceId,
    routeId: state.routeId,
    correlationId: state.correlationId,
    containerInstanceId,
    sourceContainer: 'background',
    targetContainer: target,
    sentAt: now,
    payload: { workspaceState: state, recoveryOutcome: recoveryOutcome(state), snapshotAt: now },
  }
}

async function blockedUnknownStorage(message: ClientMessage): Promise<WorkspaceStateV1> {
  const states = await readWorkspaceStates().catch((error: unknown) => {
    if (error instanceof PxStorageMigrationBlockedError) return {}
    throw error
  })
  const events = await readLifecycleEvents()
  const event = appendLifecycleEvent({
    events,
    workspaceId: message.workspaceId,
    routeId: message.routeId,
    correlationId: message.correlationId,
    container: 'background',
    containerInstanceId: BACKGROUND_INSTANCE_ID,
    eventType: 'blocked',
    previousState: 'uninitialized',
    reasonCode: 'PX_STORAGE_VERSION_UNSUPPORTED',
  })
  const state: WorkspaceStateV1 = {
    schemaVersion: 'v2-px-workspace-state/1', workspaceId: message.workspaceId, lifecycleStatus: 'blocked',
    currentView: message.kind === 'state_subscribe' ? message.payload.currentView : 'source_library',
    routeId: message.routeId, correlationId: message.correlationId,
    connection: { status: 'blocked' }, recovery: { status: 'blocked', reasonCode: 'PX_STORAGE_VERSION_UNSUPPORTED' },
    containerLeases: [], lastEventSeq: event.sequence, updatedAt: event.at,
  }
  await writeWorkspaceStateAndEvents({ ...states, [message.workspaceId]: state }, [...events, event])
  return state
}

export async function initializeLifecycleStorage(now = new Date()): Promise<void> {
  const prepared = await prepareRecoveryIndexStorage(now)
  await cleanLedgerStorage(chromeLedgerStorage, now)
  const states = await readWorkspaceStates()
  let events = await readLifecycleEvents()
  for (const workspaceId of prepared.migratedWorkspaceIds) {
    if (states[workspaceId]) continue
    const record = prepared.records.find((candidate) => candidate.workspaceId === workspaceId)
    if (!record) continue
    const routeId = token('route')
    const correlationId = token('corr')
    const current = stateFromRecovery(record, routeId, correlationId, now.toISOString())
    const event = appendLifecycleEvent({
      events, workspaceId, routeId, correlationId, container: 'background', containerInstanceId: BACKGROUND_INSTANCE_ID,
      eventType: 'state_migrated', previousState: 'uninitialized', reasonCode: 'MIGRATION_OK', now: now.toISOString(),
    })
    events = [...events, event]
    states[workspaceId] = { ...current, lifecycleStatus: event.nextState, lastEventSeq: event.sequence, updatedAt: event.at }
  }
  if (prepared.migratedWorkspaceIds.length > 0) await writeWorkspaceStateAndEvents(states, events)
  await expireStaleLifecycleLeases(now)
}

export async function expireStaleLifecycleLeases(now = new Date()): Promise<void> {
  return serializeWorkspaceState(LIFECYCLE_STATE_WRITER_KEY, () => expireStaleLifecycleLeasesLocked(now))
}

async function expireStaleLifecycleLeasesLocked(now: Date): Promise<void> {
  const states = await readWorkspaceStates()
  let events = await readLifecycleEvents()
  let changed = false
  for (const [workspaceId, current] of Object.entries(states)) {
    const freshLeases = current.containerLeases.filter((lease) => Date.parse(lease.lastSeenAt) > now.getTime() - STALE_LEASE_MS)
    if (freshLeases.length === current.containerLeases.length) continue
    changed = true
    let next: WorkspaceStateV1 = { ...current, containerLeases: freshLeases, updatedAt: now.toISOString() }
    if (freshLeases.length === 0 && current.containerLeases.length > 0 && current.lifecycleStatus !== 'closed') {
      const event = appendLifecycleEvent({
        events, workspaceId, routeId: current.routeId, correlationId: current.correlationId,
        container: 'background', containerInstanceId: BACKGROUND_INSTANCE_ID,
        eventType: 'lease_expired', previousState: current.lifecycleStatus, reasonCode: 'LEASE_TIMEOUT', now: now.toISOString(),
      })
      events = [...events, event]
      next = { ...next, lifecycleStatus: event.nextState, connection: { status: 'not_connected' }, lastEventSeq: event.sequence, updatedAt: event.at }
      operationPoller.stop(workspaceId)
    }
    states[workspaceId] = next
  }
  if (changed) await writeWorkspaceStateAndEvents(states, events)
}

export async function markLifecycleConnectionLost(input: {
  workspaceId: string
  routeId?: string
  correlationId?: string
  container?: 'sidepanel' | 'workspace_page' | 'background'
  containerInstanceId?: string
}): Promise<void> {
  await serializeWorkspaceState(LIFECYCLE_STATE_WRITER_KEY, async () => {
    const states = await readWorkspaceStates()
    const current = states[input.workspaceId]
    if (!current || ['blocked', 'closed', 'disconnected'].includes(current.lifecycleStatus)) return
    let events = await readLifecycleEvents()
    const event = appendLifecycleEvent({
      events, workspaceId: input.workspaceId, routeId: input.routeId ?? current.routeId,
      correlationId: input.correlationId ?? current.correlationId, container: input.container ?? 'background',
      containerInstanceId: input.containerInstanceId ?? BACKGROUND_INSTANCE_ID,
      eventType: 'connection_lost', previousState: current.lifecycleStatus,
    })
    events = [...events, event]
    const next: WorkspaceStateV1 = {
      ...current, lifecycleStatus: event.nextState, connection: { status: 'disconnected' }, recovery: { status: 'recovering' },
      containerLeases: input.containerInstanceId
        ? current.containerLeases.filter((lease) => lease.instanceId !== input.containerInstanceId)
        : current.containerLeases,
      lastEventSeq: event.sequence, updatedAt: event.at,
    }
    await writeWorkspaceStateAndEvents({ ...states, [input.workspaceId]: next }, events)
    operationPoller.stop(input.workspaceId)
  })
}

export async function beginLifecycleReconnect(workspaceId: string): Promise<void> {
  await serializeWorkspaceState(LIFECYCLE_STATE_WRITER_KEY, async () => {
    const states = await readWorkspaceStates()
    const current = states[workspaceId]
    if (!current || current.lifecycleStatus !== 'disconnected') return
    let events = await readLifecycleEvents()
    const event = appendLifecycleEvent({
      events, workspaceId, routeId: current.routeId, correlationId: current.correlationId,
      container: 'background', containerInstanceId: BACKGROUND_INSTANCE_ID,
      eventType: 'reconnect', previousState: current.lifecycleStatus,
    })
    events = [...events, event]
    const next: WorkspaceStateV1 = {
      ...current, lifecycleStatus: event.nextState, connection: { status: 'connecting' }, recovery: { status: 'recovering' },
      lastEventSeq: event.sequence, updatedAt: event.at,
    }
    await writeWorkspaceStateAndEvents({ ...states, [workspaceId]: next }, events)
  })
}

async function subscribeLifecycleLocked(message: Extract<ClientMessage, { kind: 'state_subscribe' }>): Promise<SnapshotMessage> {
  let states: Record<string, WorkspaceStateV1>
  let record: RecoveryIndexRecord | undefined
  let migratedDuringSubscribe = false
  try {
    const prepared = await prepareRecoveryIndexStorage()
    states = await readWorkspaceStates()
    record = prepared.records.find((candidate) => candidate.workspaceId === message.workspaceId) ?? await findRecoveryIndexRecord(message.workspaceId)
    migratedDuringSubscribe = prepared.migratedWorkspaceIds.includes(message.workspaceId)
  } catch (error) {
    if (!(error instanceof PxStorageMigrationBlockedError)) throw error
    const state = await blockedUnknownStorage(message)
    return createStateSnapshot(state, message.sourceContainer, message.containerInstanceId)
  }
  let events = await readLifecycleEvents()
  const current = states[message.workspaceId]
  const now = new Date().toISOString()
  const reconnectingExistingLease = Boolean(current?.containerLeases.some((lease) => lease.instanceId === message.containerInstanceId)
    && message.payload.navigationType === 'restore')
  let next = current ?? (record
    ? stateFromRecovery(record, message.routeId, message.correlationId, now)
    : {
        schemaVersion: 'v2-px-workspace-state/1' as const, workspaceId: message.workspaceId, lifecycleStatus: 'uninitialized' as const,
        currentView: message.payload.currentView, routeId: message.routeId, correlationId: message.correlationId,
        connection: { status: 'not_connected' as const }, recovery: { status: 'not_needed' as const },
        containerLeases: [], lastEventSeq: 0, updatedAt: now,
      })
  // Side Panel renders its own source-library summary. It may observe the
  // canonical Workspace route, but only Workspace may reconcile that route.
  if (message.sourceContainer === 'workspace_page') next = reconcileSubscription(next, message)
  const reconnecting = current?.lifecycleStatus === 'disconnected' || reconnectingExistingLease
  const needsResume = Boolean(record && !current)
    || current?.lifecycleStatus === 'closed'
    || ['reload', 'back_forward', 'restore'].includes(message.payload.navigationType)
  if (!current || needsResume || reconnecting) {
    const eventType = migratedDuringSubscribe ? 'state_migrated' : reconnecting ? 'reconnect' : needsResume ? 'resume' : 'start'
    const event = appendLifecycleEvent({
      events, workspaceId: message.workspaceId, routeId: message.routeId, correlationId: message.correlationId,
      container: message.sourceContainer, containerInstanceId: message.containerInstanceId,
      eventType, previousState: next.lifecycleStatus, ...(eventType === 'state_migrated' ? { reasonCode: 'MIGRATION_OK' as const } : {}),
    })
    events = [...events, event]
    next = {
      ...next, lifecycleStatus: event.nextState, routeId: message.routeId, correlationId: message.correlationId,
      recovery: ['resume', 'reconnect', 'state_migrated'].includes(eventType) ? { status: 'recovering' } : next.recovery,
      lastEventSeq: event.sequence, updatedAt: event.at,
    }
  }
  next = {
    ...next,
    containerLeases: [
      ...next.containerLeases.filter((lease) => lease.instanceId !== message.containerInstanceId),
      { container: message.sourceContainer, instanceId: message.containerInstanceId, lastSeenAt: now },
    ],
    updatedAt: now,
  }
  await writeRecoveryIndexRecord(recoveryInput(next))
  await writeWorkspaceStateAndEvents({ ...states, [message.workspaceId]: next }, events)
  return createStateSnapshot(next, message.sourceContainer, message.containerInstanceId)
}

export async function subscribeLifecycle(message: Extract<ClientMessage, { kind: 'state_subscribe' }>): Promise<SnapshotMessage> {
  await expireStaleLifecycleLeases()
  return serializeWorkspaceState(LIFECYCLE_STATE_WRITER_KEY, () => subscribeLifecycleLocked(message))
}

export async function recoverLifecycle(message: Extract<ClientMessage, { kind: 'recover_request' }>, currentView: WorkspaceStateV1['currentView']): Promise<SnapshotMessage> {
  return subscribeLifecycle({ ...message, kind: 'state_subscribe', payload: { currentView, navigationType: 'restore' } })
}

export async function closeLifecycle(message: Extract<ClientMessage, { kind: 'container_close' }>): Promise<SnapshotMessage | null> {
  const snapshot = await serializeWorkspaceState(LIFECYCLE_STATE_WRITER_KEY, () => closeLifecycleLocked(message))
  const state = snapshot?.payload.workspaceState
  if (!state?.containerLeases.length) operationPoller.stop(message.workspaceId)
  return snapshot
}

async function closeLifecycleLocked(message: Extract<ClientMessage, { kind: 'container_close' }>): Promise<SnapshotMessage | null> {
  const states = await readWorkspaceStates()
  const current = states[message.workspaceId]
  if (!current) return null
  let events = await readLifecycleEvents()
  const leases = current.containerLeases.filter((lease) => lease.instanceId !== message.containerInstanceId)
  let next = { ...current, containerLeases: leases, updatedAt: new Date().toISOString() }
  if (leases.length === 0) {
    const event = appendLifecycleEvent({
      events, workspaceId: message.workspaceId, routeId: message.routeId, correlationId: message.correlationId,
      container: message.sourceContainer, containerInstanceId: message.containerInstanceId,
      eventType: 'close', previousState: current.lifecycleStatus, reasonCode: 'USER_ACTION',
    })
    events = [...events, event]
    next = { ...next, lifecycleStatus: event.nextState, lastEventSeq: event.sequence, updatedAt: event.at }
  }
  await writeRecoveryIndexRecord(recoveryInput(next))
  await writeWorkspaceStateAndEvents({ ...states, [message.workspaceId]: next }, events)
  return createStateSnapshot(next, message.sourceContainer, message.containerInstanceId)
}

export async function currentLifecycleSnapshot(workspaceId: string, target: 'sidepanel' | 'workspace_page', containerInstanceId: string): Promise<SnapshotMessage | null> {
  const state = (await readWorkspaceStates())[workspaceId]
  return state ? createStateSnapshot(state, target, containerInstanceId) : null
}
