import {
  LIFECYCLE_EVENT_TYPES,
  PRODUCT_ID,
  type EntryAction,
  type EntryContainer,
  type IntentRoute,
  type LifecyclePortMessage,
  type OperationCommand,
  type RouteIntent,
  type RuntimeMessage,
  type ValidationResult,
} from './types'

const ENTRY_CONTAINERS = ['sidepanel', 'workspace_page', 'host_app'] as const
const ENTRY_ACTIONS = ['view_source', 'open_workspace', 'open_in_workspace'] as const
const ROUTE_INTENTS = ['source_library', 'source_detail', 'ask', 'trace', 'graph'] as const
const PERMISSIONS = ['read_only_direct', 'compute_quick_run', 'confirm_before_operation', 'permanently_blocked'] as const
const SECRET_KEYS = /^(authorization|cookie|token|secret|password|accountimage|rawscreenshot)$/i
export const DEFAULT_WORKSPACE_ID = 'px-ws-00000000-0000-4000-8000-000000000001' as const
const FAMS_ENTITY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const WORKSPACE_ID_PATTERN = /^px-ws-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONVERSATION_ID_PATTERN = /^chat-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SOURCE_REF_PATTERN = /^(op-artifact|review-evidence):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Za-z0-9_-]{2,686})$/
const FOCUS_NODE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const ROUTE_ID_PATTERN = /^px-route-[a-z0-9][a-z0-9-]{7,80}$/
const CORRELATION_PATTERN = /^px-corr-[a-z0-9][a-z0-9-]{7,80}$/
const IDEMPOTENCY_PATTERN = /^px-idem-[a-z0-9][a-z0-9-]{7,120}$/
const COMMAND_PATTERN = /^px-command-[a-z0-9][a-z0-9-]{7,80}$/
const MESSAGE_PATTERN = /^px-message-[a-z0-9][a-z0-9-]{7,80}$/
const CONTAINER_INSTANCE_PATTERN = /^px-container-[a-z0-9][a-z0-9-]{7,100}$/
const SHA_PATTERN = /^[a-f0-9]{64}$/
const COMMIT_PATTERN = /^[a-f0-9]{40}$/

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === 'string' && allowed.includes(value as T[number])
}

function isDateTime(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function decodeCanonicalBase64Url(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.includes('=') || value.length % 4 === 1) return null
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(`${standard}${'='.repeat((4 - standard.length % 4) % 4)}`)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const canonical = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
    return canonical === value ? bytes : null
  } catch {
    return null
  }
}

export function isFamsEntityId(value: unknown): value is string {
  return typeof value === 'string' && FAMS_ENTITY_ID_PATTERN.test(value)
}

export function isWorkspaceId(value: unknown): value is string {
  return typeof value === 'string' && WORKSPACE_ID_PATTERN.test(value)
}

export function isConversationId(value: unknown): value is string {
  return typeof value === 'string' && CONVERSATION_ID_PATTERN.test(value)
}

export function parseSourceRef(value: unknown): { kind: 'op-artifact' | 'review-evidence'; entityId: string; rawRef: string } | null {
  if (typeof value !== 'string' || value.length > 768) return null
  const matched = SOURCE_REF_PATTERN.exec(value)
  if (!matched) return null
  const bytes = decodeCanonicalBase64Url(matched[3]!)
  if (!bytes || bytes.length < 1 || bytes.length > 512) return null
  try {
    const rawRef = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (new TextEncoder().encode(rawRef).length !== bytes.length) return null
    return { kind: matched[1] as 'op-artifact' | 'review-evidence', entityId: matched[2]!, rawRef }
  } catch {
    return null
  }
}

export function isSourceRef(value: unknown): value is string {
  return parseSourceRef(value) !== null
}

export function isContextRef(value: unknown): value is string {
  return isFamsEntityId(value) || isSourceRef(value)
}

function scanSecretLike(value: unknown, path = '$', issues: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanSecretLike(item, `${path}[${index}]`, issues))
    return issues
  }
  if (!isObject(value)) return issues
  for (const [key, nested] of Object.entries(value)) {
    if (SECRET_KEYS.test(key)) issues.push(`secret-like field forbidden: ${path}.${key}`)
    scanSecretLike(nested, `${path}.${key}`, issues)
  }
  return issues
}

export function expectedTargetContainer(entry: EntryContainer, action: EntryAction): 'sidepanel' | 'workspace_page' {
  if (action !== 'view_source') return 'workspace_page'
  return entry === 'sidepanel' ? 'sidepanel' : 'workspace_page'
}

function validateRoutePayload(intent: RouteIntent, value: unknown, issues: string[]): void {
  if (!isObject(value)) {
    issues.push('routePayload must be an object')
    return
  }
  const workspaceId = value.workspaceId
  if (!isWorkspaceId(workspaceId)) issues.push('workspaceId is invalid')

  const specs: Record<RouteIntent, { required: string[]; optional: string[] }> = {
    source_library: { required: ['workspaceId'], optional: ['filter'] },
    source_detail: { required: ['workspaceId', 'sourceRef'], optional: [] },
    ask: { required: ['workspaceId'], optional: ['conversationId'] },
    trace: { required: ['workspaceId', 'operationId'], optional: ['sourceRef'] },
    graph: { required: ['workspaceId', 'graphScope', 'graphId'], optional: ['focusNodeId'] },
  }
  const spec = specs[intent]
  if (!hasExactKeys(value, spec.required, spec.optional)) issues.push(`routePayload keys do not match ${intent}`)
  if ('question' in value) issues.push('question is forbidden in intent route')
  if ('sourceRef' in value && !isSourceRef(value.sourceRef)) issues.push('sourceRef is invalid')
  for (const key of ['operationId', 'graphId']) {
    if (key in value && !isFamsEntityId(value[key])) issues.push(`${key} is invalid`)
  }
  if ('conversationId' in value && !isConversationId(value.conversationId)) issues.push('conversationId is invalid')
  if ('focusNodeId' in value && (typeof value.focusNodeId !== 'string' || !FOCUS_NODE_ID_PATTERN.test(value.focusNodeId))) issues.push('focusNodeId is invalid')
  if ('filter' in value && (typeof value.filter !== 'string' || value.filter.length > 120)) issues.push('filter is invalid')
  if (intent === 'graph' && !['daily-review', 'operation'].includes(String(value.graphScope))) issues.push('graphScope is invalid')
}

export function validateIntentRoute(input: unknown): ValidationResult<IntentRoute> {
  const issues = scanSecretLike(input)
  if (!isObject(input)) return { ok: false, issues: [...issues, 'intent route must be an object'] }
  const required = [
    'schemaVersion', 'productId', 'repository', 'commitSha', 'entryContainer', 'entryAction', 'routeIntent',
    'targetContainer', 'routeId', 'correlationId', 'idempotencyKey', 'permissionType', 'routePayload', 'audit',
  ]
  if (!hasExactKeys(input, required)) issues.push('intent route contains missing or additional fields')
  if (input.schemaVersion !== 'v2-px-intent-route/3') issues.push('schemaVersion must be intent-route/3')
  if (input.productId !== PRODUCT_ID) issues.push('productId is invalid')
  if (input.repository !== 'https://github.com/ljx418/FAMS.git') issues.push('repository is invalid')
  if (typeof input.commitSha !== 'string' || !COMMIT_PATTERN.test(input.commitSha)) issues.push('commitSha is invalid')
  if (!isOneOf(input.entryContainer, ENTRY_CONTAINERS)) issues.push('entryContainer is invalid')
  if (!isOneOf(input.entryAction, ENTRY_ACTIONS)) issues.push('entryAction is invalid')
  if (!isOneOf(input.routeIntent, ROUTE_INTENTS)) issues.push('routeIntent is invalid')
  if (!isOneOf(input.permissionType, PERMISSIONS)) issues.push('permissionType is invalid')
  if (typeof input.routeId !== 'string' || !ROUTE_ID_PATTERN.test(input.routeId)) issues.push('routeId is invalid')
  if (typeof input.correlationId !== 'string' || !CORRELATION_PATTERN.test(input.correlationId)) issues.push('correlationId is invalid')
  if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) issues.push('idempotencyKey is invalid')
  if (isOneOf(input.entryContainer, ENTRY_CONTAINERS) && isOneOf(input.entryAction, ENTRY_ACTIONS)) {
    const expected = expectedTargetContainer(input.entryContainer, input.entryAction)
    if (input.targetContainer !== expected) issues.push(`targetContainer must be ${expected}`)
  }
  if (isOneOf(input.routeIntent, ROUTE_INTENTS)) validateRoutePayload(input.routeIntent, input.routePayload, issues)
  if (!isObject(input.audit) || !hasExactKeys(input.audit, ['createdAt', 'sourceContainer', 'schemaValidated', 'semanticValidationRequired'])) {
    issues.push('audit is invalid')
  } else {
    if (!isDateTime(input.audit.createdAt)) issues.push('audit.createdAt is invalid')
    if (input.audit.sourceContainer !== input.entryContainer) issues.push('audit source must equal entry container')
    if (input.audit.schemaValidated !== true || input.audit.semanticValidationRequired !== true) issues.push('audit flags must be true')
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: input as IntentRoute }
}

function validateCommandPayload(commandType: OperationCommand['commandType'], value: unknown, issues: string[]): void {
  if (!isObject(value)) {
    issues.push('payload must be an object')
    return
  }
  const specs = {
    query: { required: ['workspaceId', 'question', 'contextRefs'], optional: ['conversationId'] },
    refresh_index: { required: ['workspaceId'], optional: [] },
    ingest_source: { required: ['workspaceId', 'sourceRef', 'contentDigest'], optional: [] },
  } satisfies Record<OperationCommand['commandType'], { required: string[]; optional: string[] }>
  const spec = specs[commandType]
  if (!hasExactKeys(value, spec.required, spec.optional)) issues.push(`payload keys do not match ${commandType}`)
  if (!isWorkspaceId(value.workspaceId)) issues.push('workspaceId is invalid')
  if (commandType === 'query') {
    if (typeof value.question !== 'string' || value.question.trim().length === 0 || value.question.length > 1000) issues.push('question is invalid')
    if (!Array.isArray(value.contextRefs) || value.contextRefs.length > 20 || value.contextRefs.some((ref) => !isContextRef(ref))) issues.push('contextRefs are invalid')
    if ('conversationId' in value && !isConversationId(value.conversationId)) issues.push('conversationId is invalid')
  }
  if (commandType === 'ingest_source') {
    if (!isSourceRef(value.sourceRef)) issues.push('sourceRef is invalid')
    if (typeof value.contentDigest !== 'string' || !SHA_PATTERN.test(value.contentDigest)) issues.push('contentDigest is invalid')
  }
}

export function validateOperationCommand(input: unknown): ValidationResult<OperationCommand> {
  const issues = scanSecretLike(input)
  if (!isObject(input)) return { ok: false, issues: [...issues, 'operation command must be an object'] }
  const required = [
    'schemaVersion', 'productId', 'commandId', 'idempotencyKey', 'payloadDigest', 'routeId', 'correlationId',
    'commandType', 'sourceContainer', 'targetContainer', 'permissionType', 'payload', 'requestedAt',
  ]
  if (!hasExactKeys(input, required)) issues.push('operation command contains missing or additional fields')
  if (input.schemaVersion !== 'v2-px-operation-command/2') issues.push('schemaVersion must be operation-command/2')
  if (input.productId !== PRODUCT_ID) issues.push('productId is invalid')
  if (typeof input.commandId !== 'string' || !COMMAND_PATTERN.test(input.commandId)) issues.push('commandId is invalid')
  if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) issues.push('idempotencyKey is invalid')
  if (typeof input.payloadDigest !== 'string' || !SHA_PATTERN.test(input.payloadDigest)) issues.push('payloadDigest is invalid')
  if (typeof input.routeId !== 'string' || !ROUTE_ID_PATTERN.test(input.routeId)) issues.push('routeId is invalid')
  if (typeof input.correlationId !== 'string' || !CORRELATION_PATTERN.test(input.correlationId)) issues.push('correlationId is invalid')
  if (!isOneOf(input.commandType, ['query', 'refresh_index', 'ingest_source'] as const)) issues.push('commandType is invalid')
  if (!isOneOf(input.sourceContainer, ['sidepanel', 'workspace_page'] as const)) issues.push('Host cannot send operation commands')
  if (input.targetContainer !== 'background') issues.push('targetContainer must be background')
  const expectedPermission = input.commandType === 'query' ? 'compute_quick_run' : 'read_only_direct'
  if (input.permissionType !== expectedPermission) issues.push(`permissionType must be ${expectedPermission}`)
  if (!isDateTime(input.requestedAt)) issues.push('requestedAt is invalid')
  if (isOneOf(input.commandType, ['query', 'refresh_index', 'ingest_source'] as const)) validateCommandPayload(input.commandType, input.payload, issues)
  return issues.length ? { ok: false, issues } : { ok: true, value: input as OperationCommand }
}

export function validateRuntimeMessage(input: unknown, external = false): ValidationResult<RuntimeMessage> {
  const issues = scanSecretLike(input)
  if (!isObject(input)) return { ok: false, issues: [...issues, 'runtime message must be an object'] }
  const required = ['schemaVersion', 'messageType', 'routeId', 'correlationId', 'idempotencyKey', 'sourceContainer', 'targetContainer', 'sentAt', 'payload']
  if (!hasExactKeys(input, required)) issues.push('runtime message contains missing or additional fields')
  if (input.schemaVersion !== 'v2-px-runtime-message/1') issues.push('runtime schemaVersion is invalid')
  if (!isDateTime(input.sentAt)) issues.push('sentAt is invalid')
  if (input.messageType === 'operation_poll') {
    if (typeof input.routeId !== 'string' || !ROUTE_ID_PATTERN.test(input.routeId)) issues.push('routeId is invalid')
    if (typeof input.correlationId !== 'string' || !CORRELATION_PATTERN.test(input.correlationId)) issues.push('correlationId is invalid')
    if (typeof input.idempotencyKey !== 'string' || !IDEMPOTENCY_PATTERN.test(input.idempotencyKey)) issues.push('idempotencyKey is invalid')
    if (input.sourceContainer !== 'workspace_page' || input.targetContainer !== 'background') issues.push('operation_poll direction is invalid')
    if (!isObject(input.payload) || !hasExactKeys(input.payload, ['workspaceId', 'operationId', 'controlId'])) {
      issues.push('operation_poll payload keys are invalid')
    } else {
      if (!isWorkspaceId(input.payload.workspaceId)) issues.push('workspaceId is invalid')
      if (!isFamsEntityId(input.payload.operationId)) issues.push('operationId is invalid')
      if (typeof input.payload.controlId !== 'string' || !COMMAND_PATTERN.test(input.payload.controlId)) issues.push('controlId is invalid')
    }
    if (external) issues.push('external host messages may not start operation polling')
    return issues.length ? { ok: false, issues } : { ok: true, value: input as RuntimeMessage }
  }
  const payloadResult = input.messageType === 'intent_route'
    ? validateIntentRoute(input.payload)
    : input.messageType === 'operation_command'
      ? validateOperationCommand(input.payload)
      : { ok: false as const, issues: ['messageType is invalid'] }
  if (!payloadResult.ok) issues.push(...payloadResult.issues)
  if (payloadResult.ok) {
    if (input.routeId !== payloadResult.value.routeId) issues.push('envelope routeId mismatch')
    if (input.correlationId !== payloadResult.value.correlationId) issues.push('envelope correlationId mismatch')
    if (input.idempotencyKey !== payloadResult.value.idempotencyKey) issues.push('envelope idempotencyKey mismatch')
    if (input.sourceContainer !== ('entryContainer' in payloadResult.value ? payloadResult.value.entryContainer : payloadResult.value.sourceContainer)) issues.push('envelope sourceContainer mismatch')
    if (input.targetContainer !== payloadResult.value.targetContainer) issues.push('envelope targetContainer mismatch')
  }
  if (external && (input.messageType !== 'intent_route' || input.sourceContainer !== 'host_app' || input.targetContainer !== 'workspace_page')) {
    issues.push('external host messages may only navigate to workspace')
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: input as RuntimeMessage }
}

export function validateLifecyclePortMessage(input: unknown): ValidationResult<LifecyclePortMessage> {
  const issues = scanSecretLike(input)
  if (!isObject(input)) return { ok: false, issues: [...issues, 'lifecycle port message must be an object'] }
  const required = [
    'schemaVersion', 'messageId', 'kind', 'workspaceId', 'routeId', 'correlationId', 'containerInstanceId',
    'sourceContainer', 'targetContainer', 'sentAt', 'payload',
  ]
  if (!hasExactKeys(input, required)) issues.push('lifecycle port message contains missing or additional fields')
  if (input.schemaVersion !== 'v2-px-lifecycle-port-message/1') issues.push('lifecycle port schemaVersion is invalid')
  if (typeof input.messageId !== 'string' || !MESSAGE_PATTERN.test(input.messageId)) issues.push('messageId is invalid')
  if (!isWorkspaceId(input.workspaceId)) issues.push('workspaceId is invalid')
  if (typeof input.routeId !== 'string' || !ROUTE_ID_PATTERN.test(input.routeId)) issues.push('routeId is invalid')
  if (typeof input.correlationId !== 'string' || !CORRELATION_PATTERN.test(input.correlationId)) issues.push('correlationId is invalid')
  if (typeof input.containerInstanceId !== 'string' || !CONTAINER_INSTANCE_PATTERN.test(input.containerInstanceId)) issues.push('containerInstanceId is invalid')
  if (!isDateTime(input.sentAt)) issues.push('sentAt is invalid')
  if (!isObject(input.payload)) issues.push('payload must be an object')

  const clientKinds = ['state_subscribe', 'recover_request', 'container_close'] as const
  const serverKinds = ['state_snapshot', 'lifecycle_error'] as const
  if (!isOneOf(input.kind, [...clientKinds, ...serverKinds] as const)) issues.push('kind is invalid')
  if (isOneOf(input.kind, clientKinds)) {
    if (!isOneOf(input.sourceContainer, ['sidepanel', 'workspace_page'] as const) || input.targetContainer !== 'background') {
      issues.push('client lifecycle direction is invalid')
    }
  }
  if (isOneOf(input.kind, serverKinds)) {
    if (input.sourceContainer !== 'background' || !isOneOf(input.targetContainer, ['sidepanel', 'workspace_page'] as const)) {
      issues.push('server lifecycle direction is invalid')
    }
  }

  const payload = isObject(input.payload) ? input.payload : {}
  if (input.kind === 'state_subscribe') {
    if (!hasExactKeys(payload, ['currentView', 'navigationType'], ['selectedRef'])) issues.push('state_subscribe payload keys are invalid')
    if (!isOneOf(payload.currentView, ROUTE_INTENTS)) issues.push('currentView is invalid')
    if (!isOneOf(payload.navigationType, ['open', 'navigate', 'reload', 'back_forward', 'restore'] as const)) issues.push('navigationType is invalid')
    if ('selectedRef' in payload && (typeof payload.selectedRef !== 'string' || payload.selectedRef.length < 1 || payload.selectedRef.length > 768)) issues.push('selectedRef is invalid')
  } else if (input.kind === 'recover_request') {
    if (!hasExactKeys(payload, ['reason']) || !isOneOf(payload.reason, ['manual_retry', 'port_reconnect', 'session_missing'] as const)) issues.push('recover_request payload is invalid')
  } else if (input.kind === 'container_close') {
    if (!hasExactKeys(payload, ['reason']) || !isOneOf(payload.reason, ['user_close', 'page_unload'] as const)) issues.push('container_close payload is invalid')
  } else if (input.kind === 'state_snapshot') {
    if (!hasExactKeys(payload, ['workspaceState', 'recoveryOutcome', 'snapshotAt'])) issues.push('state_snapshot payload keys are invalid')
    const state = isObject(payload.workspaceState) ? payload.workspaceState : {}
    if (state.schemaVersion !== 'v2-px-workspace-state/1' || state.workspaceId !== input.workspaceId) issues.push('workspaceState identity is invalid')
    if (!isOneOf(payload.recoveryOutcome, ['not_needed', 'restored', 'blocked'] as const)) issues.push('recoveryOutcome is invalid')
    if (!isDateTime(payload.snapshotAt)) issues.push('snapshotAt is invalid')
  } else if (input.kind === 'lifecycle_error') {
    if (!hasExactKeys(payload, ['code', 'userMessage', 'recoverable'])) issues.push('lifecycle_error payload keys are invalid')
    if (!isOneOf(payload.code, ['PX_SCHEMA_INVALID', 'PX_POLICY_BLOCKED', 'PX_STORAGE_VERSION_UNSUPPORTED', 'PX_BACKEND_UNAVAILABLE'] as const)) issues.push('lifecycle error code is invalid')
    if (typeof payload.userMessage !== 'string' || payload.userMessage.length < 1 || payload.userMessage.length > 300) issues.push('lifecycle userMessage is invalid')
    if (typeof payload.recoverable !== 'boolean') issues.push('lifecycle recoverable is invalid')
  }
  return issues.length ? { ok: false, issues } : { ok: true, value: input as LifecyclePortMessage }
}

export function isLifecycleEventType(value: unknown): boolean {
  return typeof value === 'string' && LIFECYCLE_EVENT_TYPES.includes(value as (typeof LIFECYCLE_EVENT_TYPES)[number])
}

export function containsSecretLikeField(value: unknown): boolean {
  return scanSecretLike(value).length > 0
}
