import { browser } from 'wxt/browser'
import { checkBackendHealth, hasBackendPermission } from './connection'
import { buildWorkspacePath } from './intentRouter'
import { openOrFocusWorkspace } from './workspaceTabManager'
import { validateRuntimeMessage } from '../contracts/validation'
import type { CommandResult, IntentRoute, RuntimeMessage, WorkspaceStateV1 } from '../contracts/types'
import { appendLifecycleEvent } from '../state/lifecycleAuditStore'
import { readLifecycleEvents, readWorkspaceStates, writeLifecycleEvents, writeWorkspaceStates } from './chromeStorage'

const ALLOWED_HOST_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])

function blocked(message: RuntimeMessage | null, userMessage: string): CommandResult {
  const payload = message?.payload
  return {
    schemaVersion: 'v2-px-command-result/1',
    commandId: payload && 'commandId' in payload ? payload.commandId : 'px-command-blocked00000000',
    routeId: message?.routeId ?? 'px-route-blocked00000000',
    correlationId: message?.correlationId ?? 'px-corr-blocked00000000',
    status: 'blocked',
    error: { code: 'PX_SCHEMA_INVALID', userMessage, recoverable: true },
    completedAt: new Date().toISOString(),
  }
}

async function recordRoute(route: IntentRoute): Promise<void> {
  const workspaceId = String((route.routePayload as Record<string, unknown>).workspaceId)
  const states = await readWorkspaceStates()
  const current = states[workspaceId]
  const previousState = current?.lifecycleStatus ?? 'uninitialized'
  const events = await readLifecycleEvents()
  const event = appendLifecycleEvent({
    events,
    workspaceId,
    routeId: route.routeId,
    correlationId: route.correlationId,
    container: 'background',
    containerInstanceId: 'background-single-writer',
    eventType: 'route_intent',
    previousState,
    reasonCode: 'USER_ACTION',
  })
  const payload = route.routePayload as Record<string, unknown>
  const next: WorkspaceStateV1 = {
    schemaVersion: 'v2-px-workspace-state/1',
    workspaceId,
    lifecycleStatus: event.nextState,
    currentView: route.routeIntent,
    routeId: route.routeId,
    correlationId: route.correlationId,
    ...(typeof payload.sourceRef === 'string' ? { selectedRef: payload.sourceRef } : {}),
    ...(typeof payload.conversationId === 'string' ? { conversationId: payload.conversationId } : {}),
    ...(typeof payload.operationId === 'string' ? { activeOperationId: payload.operationId } : {}),
    connection: current?.connection ?? { status: 'not_connected' },
    recovery: current?.recovery ?? { status: 'not_needed' },
    containerLeases: current?.containerLeases ?? [],
    lastEventSeq: event.sequence,
    updatedAt: event.at,
  }
  await writeLifecycleEvents([...events, event])
  await writeWorkspaceStates({ ...states, [workspaceId]: next })
}

async function handleIntent(route: IntentRoute): Promise<CommandResult> {
  await recordRoute(route)
  if (route.targetContainer === 'workspace_page') {
    const workspaceId = String((route.routePayload as Record<string, unknown>).workspaceId)
    const canonicalBaseUrl = browser.runtime.getURL('/workspace.html')
    await openOrFocusWorkspace({
      tabs: browser.tabs,
      windows: browser.windows,
      canonicalBaseUrl,
      desiredUrl: browser.runtime.getURL(buildWorkspacePath(route)),
      workspaceId,
    })
  }
  return {
    schemaVersion: 'v2-px-command-result/1',
    commandId: 'px-command-routeaccepted00000000',
    routeId: route.routeId,
    correlationId: route.correlationId,
    status: 'accepted',
    completedAt: new Date().toISOString(),
  }
}

async function handleRefresh(message: RuntimeMessage): Promise<CommandResult> {
  const command = message.payload
  if (!('commandId' in command)) return blocked(message, '请求类型不正确。')
  const granted = await hasBackendPermission(browser.permissions)
  if (!granted) {
    return {
      ...blocked(message, '尚未授权访问本地 FAMS，请先点击“连接本地 FAMS”。'),
      commandId: command.commandId,
      error: { code: 'PX_PERMISSION_REQUIRED', userMessage: '尚未授权访问本地 FAMS，请先点击“连接本地 FAMS”。', recoverable: true },
    }
  }
  const health = await checkBackendHealth()
  return {
    schemaVersion: 'v2-px-command-result/1',
    commandId: command.commandId,
    routeId: command.routeId,
    correlationId: command.correlationId,
    status: health.ok ? 'completed' : 'failed',
    ...(health.ok
      ? {}
      : { error: { code: 'PX_BACKEND_UNAVAILABLE' as const, userMessage: '本地 FAMS 暂时不可用，请启动后端后重试。', recoverable: true } }),
    completedAt: new Date().toISOString(),
  }
}

export async function handleRuntimeMessage(input: unknown, options: { external?: boolean; senderUrl?: string } = {}): Promise<CommandResult> {
  if (options.external) {
    let origin = ''
    try { origin = new URL(options.senderUrl ?? '').origin } catch { origin = '' }
    if (!ALLOWED_HOST_ORIGINS.has(origin)) return blocked(null, 'Host 来源未获允许。')
  }
  const validated = validateRuntimeMessage(input, options.external)
  if (!validated.ok) return blocked(null, `消息合同无效：${validated.issues.join('；')}`)
  const message = validated.value
  if (message.messageType === 'intent_route') return handleIntent(message.payload as IntentRoute)
  const command = message.payload
  if ('commandType' in command && command.commandType === 'refresh_index') return handleRefresh(message)
  return {
    ...blocked(message, '该动作将在 External Brain API 阶段启用。'),
    commandId: 'commandId' in command ? command.commandId : 'px-command-blocked00000000',
    error: { code: 'PX_NOT_IMPLEMENTED', userMessage: '该动作将在 External Brain API 阶段启用。', recoverable: false },
  }
}
