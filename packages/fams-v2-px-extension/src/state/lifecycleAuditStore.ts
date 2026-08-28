import type { LifecycleEvent, LifecycleEventType, WorkspaceLifecycleStatus } from '../contracts/types'

const NEXT_STATE: Record<LifecycleEventType, WorkspaceLifecycleStatus | null> = {
  start: 'connecting',
  resume: 'recovering',
  route_intent: 'loading',
  connected: 'ready',
  load_succeeded: 'ready',
  load_empty: 'empty',
  load_failed: 'failed',
  connection_lost: 'disconnected',
  reconnect: 'recovering',
  state_migrated: 'recovering',
  lease_expired: 'closed',
  storage_write_failed: null,
  dispatch_result_unknown: 'blocked',
  close: 'closed',
  blocked: 'blocked',
}

export function nextLifecycleState(current: WorkspaceLifecycleStatus, eventType: LifecycleEventType): WorkspaceLifecycleStatus {
  return NEXT_STATE[eventType] ?? current
}

export function appendLifecycleEvent(input: {
  events: LifecycleEvent[]
  workspaceId: string
  routeId: string
  correlationId: string
  container: LifecycleEvent['container']
  containerInstanceId: string
  eventType: LifecycleEventType
  previousState: WorkspaceLifecycleStatus
  reasonCode?: LifecycleEvent['reasonCode']
  now?: string
}): LifecycleEvent {
  const sequence = (input.events.at(-1)?.sequence ?? 0) + 1
  const nextState = nextLifecycleState(input.previousState, input.eventType)
  return {
    schemaVersion: 'v2-px-lifecycle-event/3',
    eventId: `px-event-${crypto.randomUUID().replaceAll('-', '')}`,
    sequence,
    workspaceId: input.workspaceId,
    routeId: input.routeId,
    correlationId: input.correlationId,
    container: input.container,
    containerInstanceId: input.containerInstanceId,
    eventType: input.eventType,
    previousState: input.previousState,
    nextState,
    ...(input.reasonCode ? { reasonCode: input.reasonCode } : {}),
    storageVersion: 1,
    at: input.now ?? new Date().toISOString(),
  }
}

export function deriveLifecycleState(events: LifecycleEvent[], initial: WorkspaceLifecycleStatus = 'uninitialized'): WorkspaceLifecycleStatus {
  let current = initial
  let expectedSequence = 1
  for (const event of events) {
    if (event.sequence !== expectedSequence || event.previousState !== current) throw new Error('PX lifecycle event order is invalid')
    current = event.nextState
    expectedSequence += 1
  }
  return current
}
