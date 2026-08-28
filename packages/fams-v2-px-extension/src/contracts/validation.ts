import {
  LIFECYCLE_EVENT_TYPES,
  PRODUCT_ID,
  type EntryAction,
  type EntryContainer,
  type IntentRoute,
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

export function isLifecycleEventType(value: unknown): boolean {
  return typeof value === 'string' && LIFECYCLE_EVENT_TYPES.includes(value as (typeof LIFECYCLE_EVENT_TYPES)[number])
}

export function containsSecretLikeField(value: unknown): boolean {
  return scanSecretLike(value).length > 0
}
