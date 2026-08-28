import { browser } from 'wxt/browser'
import { FamsDomainAdapter } from '../adapters/fams/FamsDomainAdapter'
import { FamsApiError, type BackgroundCommandResponse, type WorkspaceViewData } from '../adapters/fams/types'
import type { CommandResult, IntentRoute, OperationCommand, RuntimeMessage, WorkspaceStateV1 } from '../contracts/types'
import { validateRuntimeMessage } from '../contracts/validation'
import { dispatchAtMostOnce } from '../state/idempotencyRegistry'
import { appendLifecycleEvent } from '../state/lifecycleAuditStore'
import { checkBackendHealth, hasBackendPermission } from './connection'
import { chromeLedgerStorage, PxStorageMigrationBlockedError, readLifecycleEvents, readWorkspaceStates, writeLifecycleEvents, writeWorkspaceStates } from './chromeStorage'
import { buildWorkspacePath } from './intentRouter'
import { openOrFocusWorkspace } from './workspaceTabManager'

const ALLOWED_HOST_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
const adapter = new FamsDomainAdapter()

type RuntimeResponse = CommandResult | BackgroundCommandResponse

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

function backgroundResponse(commandResult: CommandResult, viewData?: WorkspaceViewData): BackgroundCommandResponse {
  return { schemaVersion: 'v2-px-background-response/1', commandResult, ...(viewData ? { viewData } : {}) }
}

async function recordRoute(route: IntentRoute): Promise<void> {
  const workspaceId = String((route.routePayload as Record<string, unknown>).workspaceId)
  const states = await readWorkspaceStates()
  const current = states[workspaceId]
  const events = await readLifecycleEvents()
  const event = appendLifecycleEvent({
    events,
    workspaceId,
    routeId: route.routeId,
    correlationId: route.correlationId,
    container: 'background',
    containerInstanceId: 'background-single-writer',
    eventType: 'route_intent',
    previousState: current?.lifecycleStatus ?? 'uninitialized',
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
    ...(route.routeIntent === 'graph' && (payload.graphScope === 'daily-review' || payload.graphScope === 'operation') && typeof payload.graphId === 'string'
      ? { activeGraph: { scope: payload.graphScope, id: payload.graphId, ...(typeof payload.focusNodeId === 'string' ? { focusNodeId: payload.focusNodeId } : {}) } }
      : {}),
    connection: current?.connection ?? { status: 'not_connected' },
    recovery: current?.recovery ?? { status: 'not_needed' },
    containerLeases: current?.containerLeases ?? [],
    lastEventSeq: event.sequence,
    updatedAt: event.at,
  }
  await writeLifecycleEvents([...events, event])
  await writeWorkspaceStates({ ...states, [workspaceId]: next })
}

async function recordLoadResult(workspaceId: string, outcome: 'ready' | 'empty' | 'failed'): Promise<void> {
  const states = await readWorkspaceStates()
  const current = states[workspaceId]
  if (!current) return
  const events = await readLifecycleEvents()
  const event = appendLifecycleEvent({
    events,
    workspaceId,
    routeId: current.routeId,
    correlationId: current.correlationId,
    container: 'background',
    containerInstanceId: 'background-single-writer',
    eventType: outcome === 'ready' ? 'load_succeeded' : outcome === 'empty' ? 'load_empty' : 'load_failed',
    previousState: current.lifecycleStatus,
    ...(outcome === 'empty' ? { reasonCode: 'EMPTY_RESULT' as const } : {}),
  })
  const next: WorkspaceStateV1 = {
    ...current,
    lifecycleStatus: event.nextState,
    connection: outcome === 'failed' ? { status: 'disconnected' } : { status: 'connected', lastHealthAt: event.at },
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
    await openOrFocusWorkspace({
      tabs: {
        query: (queryInfo) => browser.tabs.query(queryInfo),
        create: (createProperties) => browser.tabs.create(createProperties),
        update: async (tabId, updateProperties) => await browser.tabs.update(tabId, updateProperties) ?? {},
      },
      windows: { update: (windowId, updateInfo) => browser.windows.update(windowId, updateInfo) },
      canonicalBaseUrl: browser.runtime.getURL('/workspace.html'),
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

function commandFailure(command: OperationCommand, code: 'PX_BACKEND_UNAVAILABLE' | 'PX_SCHEMA_INVALID', userMessage: string, status: 'failed' | 'blocked'): CommandResult {
  return {
    schemaVersion: 'v2-px-command-result/1',
    commandId: command.commandId,
    routeId: command.routeId,
    correlationId: command.correlationId,
    status,
    error: { code, userMessage, recoverable: code === 'PX_BACKEND_UNAVAILABLE' },
    completedAt: new Date().toISOString(),
  }
}

async function handleRefresh(message: RuntimeMessage, command: OperationCommand): Promise<BackgroundCommandResponse> {
  const workspaceId = command.payload.workspaceId
  const states = await readWorkspaceStates()
  const state = states[workspaceId]
  if (!state) {
    if (command.sourceContainer === 'workspace_page') {
      return backgroundResponse(commandFailure(
        command,
        'PX_SCHEMA_INVALID',
        '当前页面没有经过受控路由，无法判断要读取的真实实体。请从侧边栏重新打开工作区。',
        'blocked',
      ))
    }
    const health = await checkBackendHealth()
    return backgroundResponse(health.ok
      ? { schemaVersion: 'v2-px-command-result/1', commandId: command.commandId, routeId: command.routeId, correlationId: command.correlationId, status: 'completed', completedAt: new Date().toISOString() }
      : commandFailure(command, 'PX_BACKEND_UNAVAILABLE', '本地 FAMS 暂时不可用，请启动后端后重试。', 'failed'))
  }
  try {
    const viewData = await adapter.loadWorkspaceView(state)
    const empty = viewData?.status === 'empty'
    await recordLoadResult(workspaceId, empty ? 'empty' : 'ready')
    return backgroundResponse({
      schemaVersion: 'v2-px-command-result/1',
      commandId: command.commandId,
      routeId: command.routeId,
      correlationId: command.correlationId,
      status: empty ? 'empty' : 'completed',
      completedAt: new Date().toISOString(),
    }, viewData ?? undefined)
  } catch (error) {
    await recordLoadResult(workspaceId, 'failed')
    const apiError = error instanceof FamsApiError ? error : null
    return backgroundResponse(commandFailure(
      command,
      apiError?.code === 'PX_API_RESPONSE_INVALID' ? 'PX_SCHEMA_INVALID' : 'PX_BACKEND_UNAVAILABLE',
      apiError?.userMessage ?? '读取失败；当前工作区引用已保留，请重试或到 FAMS 复核。',
      apiError?.status === 400 || apiError?.status === 403 ? 'blocked' : 'failed',
    ))
  }
}

async function handleQuery(command: OperationCommand): Promise<BackgroundCommandResponse> {
  let viewData: Extract<WorkspaceViewData, { view: 'ask' }> | undefined
  const commandResult = await dispatchAtMostOnce({
    command,
    storage: chromeLedgerStorage,
    dispatch: async () => {
      viewData = await adapter.ask(command)
      return {
        status: viewData.status === 'blocked' ? 'blocked' : viewData.status === 'empty' ? 'empty' : 'completed',
        resultRef: {
          conversationId: viewData.value.conversationId,
          messageId: viewData.value.messageId,
          ...(viewData.value.operationId ? { operationId: viewData.value.operationId } : {}),
        },
      }
    },
  })
  return backgroundResponse(commandResult, viewData)
}

export async function handleRuntimeMessage(input: unknown, options: { external?: boolean; senderUrl?: string } = {}): Promise<RuntimeResponse> {
  if (options.external) {
    let origin = ''
    try { origin = new URL(options.senderUrl ?? '').origin } catch { origin = '' }
    if (!ALLOWED_HOST_ORIGINS.has(origin)) return blocked(null, 'Host 来源未获允许。')
  }
  const validated = validateRuntimeMessage(input, options.external)
  if (!validated.ok) return blocked(null, `消息合同无效：${validated.issues.join('；')}`)
  const message = validated.value
  if (message.messageType === 'intent_route') {
    try {
      return await handleIntent(message.payload as IntentRoute)
    } catch (error) {
      if (error instanceof PxStorageMigrationBlockedError) {
        return { ...blocked(message, '检测到未知或冲突的旧版工作区状态，已阻止自动迁移。请导出诊断后清理扩展状态。'), error: { code: 'PX_STORAGE_VERSION_BLOCKED', userMessage: '检测到未知或冲突的旧版工作区状态，已阻止自动迁移。请导出诊断后清理扩展状态。', recoverable: false } }
      }
      throw error
    }
  }

  const command = message.payload as OperationCommand
  const granted = await hasBackendPermission(browser.permissions)
  if (!granted) return backgroundResponse({ ...blocked(message, '尚未授权访问本地 FAMS，请先点击“连接本地 FAMS”。'), commandId: command.commandId, error: { code: 'PX_PERMISSION_REQUIRED', userMessage: '尚未授权访问本地 FAMS，请先点击“连接本地 FAMS”。', recoverable: true } })
  if (command.commandType === 'refresh_index') return handleRefresh(message, command)
  if (command.commandType === 'query') return handleQuery(command)
  return backgroundResponse({ ...blocked(message, '当前来源已存在于 FAMS；本阶段不复制正文或建立第二索引。'), commandId: command.commandId, error: { code: 'PX_NOT_IMPLEMENTED', userMessage: '当前来源已存在于 FAMS；本阶段不复制正文或建立第二索引。', recoverable: false } })
}
