export const PRODUCT_ID = 'fams-v2-px' as const

export type EntryContainer = 'sidepanel' | 'workspace_page' | 'host_app'
export type TargetContainer = 'sidepanel' | 'workspace_page' | 'background'
export type EntryAction = 'view_source' | 'open_workspace' | 'open_in_workspace'
export type RouteIntent = 'source_library' | 'source_detail' | 'ask' | 'trace' | 'graph'
export type PermissionType = 'read_only_direct' | 'compute_quick_run' | 'confirm_before_operation' | 'permanently_blocked'

export type IntentRoute = {
  schemaVersion: 'v2-px-intent-route/3'
  productId: typeof PRODUCT_ID
  repository: 'https://github.com/ljx418/FAMS.git'
  commitSha: string
  entryContainer: EntryContainer
  entryAction: EntryAction
  routeIntent: RouteIntent
  targetContainer: Exclude<TargetContainer, 'background'>
  routeId: string
  correlationId: string
  idempotencyKey: string
  permissionType: PermissionType
  routePayload:
    | { workspaceId: string; filter?: string }
    | { workspaceId: string; sourceRef: string }
    | { workspaceId: string; conversationId?: string }
    | { workspaceId: string; operationId: string; sourceRef?: string }
    | { workspaceId: string; graphScope: 'daily-review' | 'operation'; graphId: string; focusNodeId?: string }
  audit: {
    createdAt: string
    sourceContainer: EntryContainer
    schemaValidated: true
    semanticValidationRequired: true
  }
}

export type OperationCommandType = 'query' | 'refresh_index' | 'ingest_source'

export type OperationCommand = {
  schemaVersion: 'v2-px-operation-command/2'
  productId: typeof PRODUCT_ID
  commandId: string
  idempotencyKey: string
  payloadDigest: string
  routeId: string
  correlationId: string
  commandType: OperationCommandType
  sourceContainer: 'sidepanel' | 'workspace_page'
  targetContainer: 'background'
  permissionType: 'read_only_direct' | 'compute_quick_run'
  payload:
    | { workspaceId: string; question: string; contextRefs: string[]; conversationId?: string }
    | { workspaceId: string }
    | { workspaceId: string; sourceRef: string; contentDigest: string }
  requestedAt: string
}

type RuntimeMessageCommon = {
  schemaVersion: 'v2-px-runtime-message/1'
  routeId: string
  correlationId: string
  idempotencyKey: string
  sourceContainer: EntryContainer
  targetContainer: TargetContainer
  sentAt: string
}

export type RuntimeMessage = RuntimeMessageCommon & (
  | { messageType: 'intent_route'; payload: IntentRoute }
  | { messageType: 'operation_command'; payload: OperationCommand }
  | {
      messageType: 'operation_poll'
      sourceContainer: 'workspace_page'
      targetContainer: 'background'
      payload: { workspaceId: string; operationId: string; controlId: string }
    }
)

export const LIFECYCLE_PORT_NAME = 'v2-px-lifecycle/1' as const

type LifecyclePortCommon = {
  schemaVersion: 'v2-px-lifecycle-port-message/1'
  messageId: string
  workspaceId: string
  routeId: string
  correlationId: string
  containerInstanceId: string
  sentAt: string
}

export type LifecyclePortMessage = LifecyclePortCommon & (
  | {
      kind: 'state_subscribe'
      sourceContainer: 'sidepanel' | 'workspace_page'
      targetContainer: 'background'
      payload: { currentView: RouteIntent; selectedRef?: string; navigationType: 'open' | 'navigate' | 'reload' | 'back_forward' | 'restore' }
    }
  | {
      kind: 'recover_request'
      sourceContainer: 'sidepanel' | 'workspace_page'
      targetContainer: 'background'
      payload: { reason: 'manual_retry' | 'port_reconnect' | 'session_missing' }
    }
  | {
      kind: 'container_close'
      sourceContainer: 'sidepanel' | 'workspace_page'
      targetContainer: 'background'
      payload: { reason: 'user_close' | 'page_unload' }
    }
  | {
      kind: 'state_snapshot'
      sourceContainer: 'background'
      targetContainer: 'sidepanel' | 'workspace_page'
      payload: { workspaceState: WorkspaceStateV1; recoveryOutcome: 'not_needed' | 'restored' | 'blocked'; snapshotAt: string }
    }
  | {
      kind: 'lifecycle_error'
      sourceContainer: 'background'
      targetContainer: 'sidepanel' | 'workspace_page'
      payload: { code: 'PX_SCHEMA_INVALID' | 'PX_POLICY_BLOCKED' | 'PX_STORAGE_VERSION_UNSUPPORTED' | 'PX_BACKEND_UNAVAILABLE'; userMessage: string; recoverable: boolean }
    }
)

export type PxErrorCode =
  | 'PX_SCHEMA_INVALID'
  | 'PX_POLICY_BLOCKED'
  | 'PX_PERMISSION_REQUIRED'
  | 'PX_BACKEND_UNAVAILABLE'
  | 'PX_IDEMPOTENCY_CONFLICT'
  | 'PX_STORAGE_WRITE_FAILED_BEFORE_EFFECT'
  | 'PX_STORAGE_VERSION_UNSUPPORTED'
  | 'PX_RESULT_NOT_PERSISTED'
  | 'PX_UNKNOWN_DISPATCH_RESULT'
  | 'PX_NOT_IMPLEMENTED'

export type CommandResult = {
  schemaVersion: 'v2-px-command-result/1'
  commandId: string
  routeId: string
  correlationId: string
  status: 'accepted' | 'completed' | 'empty' | 'blocked' | 'failed' | 'unknown_result'
  resultRef?: { conversationId?: string; messageId?: string; operationId?: string; sourceRef?: string }
  error?: { code: PxErrorCode; userMessage: string; recoverable: boolean }
  completedAt: string
}

export type WorkspaceLifecycleStatus =
  | 'uninitialized'
  | 'connecting'
  | 'ready'
  | 'loading'
  | 'empty'
  | 'failed'
  | 'disconnected'
  | 'recovering'
  | 'blocked'
  | 'closed'

export const LIFECYCLE_EVENT_TYPES = [
  'start',
  'resume',
  'route_intent',
  'connected',
  'load_succeeded',
  'load_empty',
  'load_failed',
  'connection_lost',
  'reconnect',
  'state_migrated',
  'lease_expired',
  'storage_write_failed',
  'dispatch_result_unknown',
  'close',
  'blocked',
] as const

export type LifecycleEventType = typeof LIFECYCLE_EVENT_TYPES[number]

export type LifecycleEvent = {
  schemaVersion: 'v2-px-lifecycle-event/3'
  eventId: string
  sequence: number
  workspaceId: string
  routeId: string
  correlationId: string
  container: 'sidepanel' | 'workspace_page' | 'background'
  containerInstanceId: string
  eventType: LifecycleEventType
  previousState: WorkspaceLifecycleStatus
  nextState: WorkspaceLifecycleStatus
  reasonCode?: PxErrorCode | 'USER_ACTION' | 'HEALTH_OK' | 'EMPTY_RESULT' | 'LEASE_TIMEOUT' | 'MIGRATION_OK'
  storageVersion: 1
  at: string
}

export type WorkspaceStateV1 = {
  schemaVersion: 'v2-px-workspace-state/1'
  workspaceId: string
  lifecycleStatus: WorkspaceLifecycleStatus
  currentView: RouteIntent
  routeId: string
  correlationId: string
  selectedRef?: string
  conversationId?: string
  activeOperationId?: string
  activeGraph?: { scope: 'daily-review' | 'operation'; id: string; focusNodeId?: string }
  connection: {
    status: 'not_connected' | 'connecting' | 'connected' | 'disconnected' | 'blocked'
    lastHealthAt?: string
  }
  recovery: {
    status: 'not_needed' | 'recovering' | 'restored' | 'blocked'
    reasonCode?: PxErrorCode
  }
  containerLeases: Array<{ container: 'sidepanel' | 'workspace_page'; instanceId: string; lastSeenAt: string }>
  lastEventSeq: number
  updatedAt: string
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: string[] }
