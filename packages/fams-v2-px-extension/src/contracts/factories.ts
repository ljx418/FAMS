import type { EntryAction, EntryContainer, IntentRoute, OperationCommand, RouteIntent, RuntimeMessage } from './types'
import { expectedTargetContainer } from './validation'
import { sha256Hex } from './stableJson'

function token(prefix: 'route' | 'corr' | 'idem' | 'command'): string {
  return `px-${prefix}-${crypto.randomUUID().replaceAll('-', '')}`
}

function commitSha(): string {
  const configured = import.meta.env.VITE_V2_PX_COMMIT_SHA
  return /^[a-f0-9]{40}$/.test(configured ?? '') ? configured : '0'.repeat(40)
}

export function createIntentRoute(input: {
  entryContainer: EntryContainer
  entryAction: EntryAction
  routeIntent: RouteIntent
  routePayload: IntentRoute['routePayload']
  permissionType?: IntentRoute['permissionType']
}): IntentRoute {
  const routeId = token('route')
  const correlationId = token('corr')
  const idempotencyKey = token('idem')
  return {
    schemaVersion: 'v2-px-intent-route/3',
    productId: 'fams-v2-px',
    repository: 'https://github.com/ljx418/FAMS.git',
    commitSha: commitSha(),
    entryContainer: input.entryContainer,
    entryAction: input.entryAction,
    routeIntent: input.routeIntent,
    targetContainer: expectedTargetContainer(input.entryContainer, input.entryAction),
    routeId,
    correlationId,
    idempotencyKey,
    permissionType: input.permissionType ?? 'read_only_direct',
    routePayload: input.routePayload,
    audit: {
      createdAt: new Date().toISOString(),
      sourceContainer: input.entryContainer,
      schemaValidated: true,
      semanticValidationRequired: true,
    },
  }
}

export async function createOperationCommand(input: {
  sourceContainer: 'sidepanel' | 'workspace_page'
  commandType: OperationCommand['commandType']
  payload: OperationCommand['payload']
  routeId?: string
  correlationId?: string
  idempotencyKey?: string
}): Promise<OperationCommand> {
  const payloadDigest = await sha256Hex(input.payload)
  return {
    schemaVersion: 'v2-px-operation-command/2',
    productId: 'fams-v2-px',
    commandId: token('command'),
    idempotencyKey: input.idempotencyKey ?? token('idem'),
    payloadDigest,
    routeId: input.routeId ?? token('route'),
    correlationId: input.correlationId ?? token('corr'),
    commandType: input.commandType,
    sourceContainer: input.sourceContainer,
    targetContainer: 'background',
    permissionType: input.commandType === 'query' ? 'compute_quick_run' : 'read_only_direct',
    payload: input.payload,
    requestedAt: new Date().toISOString(),
  }
}

export function wrapRuntimeMessage(payload: IntentRoute | OperationCommand): RuntimeMessage {
  const isRoute = payload.schemaVersion === 'v2-px-intent-route/3'
  const common = {
    schemaVersion: 'v2-px-runtime-message/1',
    routeId: payload.routeId,
    correlationId: payload.correlationId,
    idempotencyKey: payload.idempotencyKey,
    targetContainer: payload.targetContainer,
    sentAt: new Date().toISOString(),
  } as const
  return isRoute
    ? { ...common, messageType: 'intent_route', sourceContainer: payload.entryContainer, payload }
    : { ...common, messageType: 'operation_command', sourceContainer: payload.sourceContainer, payload }
}

export function createOperationPollMessage(workspaceId: string, operationId: string): Extract<RuntimeMessage, { messageType: 'operation_poll' }> {
  return {
    schemaVersion: 'v2-px-runtime-message/1',
    messageType: 'operation_poll',
    routeId: token('route'),
    correlationId: token('corr'),
    idempotencyKey: token('idem'),
    sourceContainer: 'workspace_page',
    targetContainer: 'background',
    sentAt: new Date().toISOString(),
    payload: { workspaceId, operationId, controlId: token('command') },
  }
}
