import { browser } from 'wxt/browser'
import { FamsDomainAdapter } from '../adapters/fams/FamsDomainAdapter'
import { FamsApiClient } from '../adapters/fams/FamsApiClient'
import { FamsApiError, type BackgroundCommandResponse, type WorkspaceViewData } from '../adapters/fams/types'
import type { CommandResult, IntentRoute, OperationCommand, RuntimeMessage, WorkspaceStateV1 } from '../contracts/types'
import { validateRuntimeMessage } from '../contracts/validation'
import { dispatchAtMostOnce } from '../state/idempotencyRegistry'
import { appendLifecycleEvent } from '../state/lifecycleAuditStore'
import { checkBackendHealth, hasBackendPermission } from './connection'
import {
  chromeLedgerStorage,
  PxStorageMigrationBlockedError,
  readLifecycleEvents,
  readWorkspaceStates,
  writeRecoveryIndexRecord,
  writeWorkspaceStateAndEvents,
} from './chromeStorage'
import { buildWorkspacePath } from './intentRouter'
import { openOrFocusWorkspace } from './workspaceTabManager'
import { LIFECYCLE_STATE_WRITER_KEY, serializeWorkspaceState } from './workspaceStateQueue'
import { beginLifecycleReconnect, markLifecycleConnectionLost } from './lifecycleCoordinator'
import { operationPoller } from './operationPoller'

const ALLOWED_HOST_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
const adapter = new FamsDomainAdapter(new FamsApiClient(browser.runtime.id))
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
  return serializeWorkspaceState(LIFECYCLE_STATE_WRITER_KEY, async () => {
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
    await writeRecoveryIndexRecord({
      workspaceId,
      currentView: next.currentView,
      ...(next.selectedRef ? { selectedRef: next.selectedRef } : {}),
      ...(next.conversationId ? { conversationId: next.conversationId } : {}),
      ...(next.activeOperationId ? { operationId: next.activeOperationId } : {}),
      ...(next.activeGraph ? { activeGraph: next.activeGraph } : {}),
      updatedAt: next.updatedAt,
    })
    await writeWorkspaceStateAndEvents({ ...states, [workspaceId]: next }, [...events, event])
  })
}

async function recordLoadResult(workspaceId: string, outcome: 'ready' | 'empty' | 'failed'): Promise<void> {
  return serializeWorkspaceState(LIFECYCLE_STATE_WRITER_KEY, async () => {
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
      recovery: current.recovery.status === 'recovering'
        ? outcome === 'failed'
          ? { status: 'blocked', reasonCode: 'PX_BACKEND_UNAVAILABLE' }
          : { status: 'restored' }
        : current.recovery,
      lastEventSeq: event.sequence,
      updatedAt: event.at,
    }
    await writeWorkspaceStateAndEvents({ ...states, [workspaceId]: next }, [...events, event])
  })
}

function emptyWorkspaceState(command: OperationCommand): WorkspaceStateV1 {
  return {
    schemaVersion: 'v2-px-workspace-state/1',
    workspaceId: command.payload.workspaceId,
    lifecycleStatus: 'uninitialized',
    currentView: 'ask',
    routeId: command.routeId,
    correlationId: command.correlationId,
    connection: { status: 'not_connected' },
    recovery: { status: 'not_needed' },
    containerLeases: [],
    lastEventSeq: 0,
    updatedAt: command.requestedAt,
  }
}

async function recordQueryEvents(command: OperationCommand, result: CommandResult): Promise<void> {
  const workspaceId = command.payload.workspaceId
  return serializeWorkspaceState(LIFECYCLE_STATE_WRITER_KEY, async () => {
    const states = await readWorkspaceStates()
    const current = states[workspaceId] ?? emptyWorkspaceState(command)
    let events = await readLifecycleEvents()
    let previousState = current.lifecycleStatus
    const eventTypes = result.status === 'unknown_result'
      ? [
          ...(result.error?.code === 'PX_RESULT_NOT_PERSISTED' ? ['storage_write_failed' as const] : []),
          'dispatch_result_unknown' as const,
        ]
      : result.status === 'failed' && result.error?.code === 'PX_STORAGE_WRITE_FAILED_BEFORE_EFFECT'
        ? ['storage_write_failed' as const]
        : result.status === 'blocked'
          ? ['blocked' as const]
          : result.status === 'empty'
            ? ['load_empty' as const]
            : ['load_succeeded' as const]
    let lastEvent = null as ReturnType<typeof appendLifecycleEvent> | null
    for (const eventType of eventTypes) {
      const event = appendLifecycleEvent({
        events,
        workspaceId,
        routeId: command.routeId,
        correlationId: command.correlationId,
        container: 'background',
        containerInstanceId: 'background-single-writer',
        eventType,
        previousState,
        ...(result.error?.code ? { reasonCode: result.error.code } : {}),
      })
      events = [...events, event]
      previousState = event.nextState
      lastEvent = event
    }
    if (!lastEvent) return
    const next: WorkspaceStateV1 = {
      ...current,
      lifecycleStatus: lastEvent.nextState,
      currentView: 'ask',
      routeId: command.routeId,
      correlationId: command.correlationId,
      ...(result.resultRef?.conversationId ? { conversationId: result.resultRef.conversationId } : {}),
      ...(result.resultRef?.operationId ? { activeOperationId: result.resultRef.operationId } : {}),
    connection: ['completed', 'empty', 'blocked'].includes(result.status) || result.error?.code === 'PX_RESULT_NOT_PERSISTED'
      ? { status: 'connected', lastHealthAt: lastEvent.at }
      : current.connection,
    recovery: result.status === 'unknown_result'
      ? { status: 'blocked', reasonCode: result.error?.code ?? 'PX_UNKNOWN_DISPATCH_RESULT' }
      : result.status === 'blocked'
        ? { status: 'blocked' }
        : result.status === 'completed' || result.status === 'empty'
          ? { status: current.recovery.status === 'not_needed' ? 'not_needed' : 'restored' }
          : current.recovery,
      lastEventSeq: lastEvent.sequence,
      updatedAt: lastEvent.at,
    }
    await writeWorkspaceStateAndEvents({ ...states, [workspaceId]: next }, events)
  })
}

async function finalizeQueryResult(command: OperationCommand, result: CommandResult): Promise<CommandResult> {
  if (!['completed', 'empty', 'blocked'].includes(result.status)) {
    await recordQueryEvents(command, result).catch(() => undefined)
    return result
  }
  try {
    await writeRecoveryIndexRecord({
      workspaceId: command.payload.workspaceId,
      currentView: 'ask',
      ...(result.resultRef?.conversationId ? { conversationId: result.resultRef.conversationId } : {}),
      ...(result.resultRef?.operationId ? { operationId: result.resultRef.operationId } : {}),
      updatedAt: result.completedAt,
    })
    await recordQueryEvents(command, result)
    return result
  } catch {
    const unknown: CommandResult = {
      ...result,
      status: 'unknown_result',
      error: {
        code: 'PX_RESULT_NOT_PERSISTED',
        userMessage: '结果已收到但工作区恢复状态未完整保存；刷新后请到 FAMS 手动复核，系统不会自动重试。',
        recoverable: false,
      },
    }
    await recordQueryEvents(command, unknown).catch(() => undefined)
    return unknown
  }
}

async function handleIntent(route: IntentRoute, preferredTabId?: number): Promise<CommandResult> {
  await recordRoute(route)
  if (route.targetContainer === 'workspace_page') {
    const workspaceId = String((route.routePayload as Record<string, unknown>).workspaceId)
    await openOrFocusWorkspace({
      tabs: {
        query: (queryInfo) => browser.tabs.query(queryInfo),
        create: (createProperties) => browser.tabs.create(createProperties),
        update: async (tabId, updateProperties) => await browser.tabs.update(tabId, updateProperties) ?? {},
        remove: (tabIds) => browser.tabs.remove(tabIds),
      },
      windows: { update: (windowId, updateInfo) => browser.windows.update(windowId, updateInfo) },
      canonicalBaseUrl: browser.runtime.getURL('/workspace.html'),
      desiredUrl: browser.runtime.getURL(buildWorkspacePath(route)),
      workspaceId,
      ...(route.entryContainer === 'workspace_page' && typeof preferredTabId === 'number' ? { preferredTabId } : {}),
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
  let states = await readWorkspaceStates()
  let state = states[workspaceId]
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
  if (state.lifecycleStatus === 'disconnected') {
    await beginLifecycleReconnect(workspaceId)
    states = await readWorkspaceStates()
    state = states[workspaceId] ?? state
  }
  try {
    const viewData = await adapter.loadWorkspaceView(command.sourceContainer === 'sidepanel' ? { ...state, currentView: 'source_library' } : state)
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
    const apiError = error instanceof FamsApiError ? error : null
    const connectionFailure = Boolean(apiError && (apiError.code === 'PX_BACKEND_UNAVAILABLE' || apiError.status === 503 || apiError.status === undefined))
    if (connectionFailure) await markLifecycleConnectionLost({ workspaceId })
    else await recordLoadResult(workspaceId, 'failed')
    return backgroundResponse(commandFailure(
      command,
      apiError?.code === 'PX_API_RESPONSE_INVALID' ? 'PX_SCHEMA_INVALID' : 'PX_BACKEND_UNAVAILABLE',
      apiError?.userMessage ?? '读取失败；当前工作区引用已保留，请重试或到 FAMS 复核。',
      apiError?.status === 400 || apiError?.status === 403 ? 'blocked' : 'failed',
    ))
  }
}

async function handleOperationPoll(message: Extract<RuntimeMessage, { messageType: 'operation_poll' }>): Promise<CommandResult> {
  const base = {
    schemaVersion: 'v2-px-command-result/1' as const,
    commandId: message.payload.controlId,
    routeId: message.routeId,
    correlationId: message.correlationId,
    completedAt: new Date().toISOString(),
  }
  if (!await hasBackendPermission(browser.permissions)) {
    return {
      ...base,
      status: 'blocked',
      error: { code: 'PX_PERMISSION_REQUIRED', userMessage: '尚未授权访问本地 FAMS，未启动任务轮询。', recoverable: true },
    }
  }
  const result = await operationPoller.run(message.payload.workspaceId, message.payload.operationId, {
    onConnectionLost: async (workspaceId) => markLifecycleConnectionLost({ workspaceId }),
  })
  if (result.status === 'failed') {
    return {
      ...base,
      completedAt: new Date().toISOString(),
      status: 'failed',
      error: { code: 'PX_BACKEND_UNAVAILABLE', userMessage: '任务轮询已因 FAMS 断连停止。', recoverable: true },
    }
  }
  if (result.status === 'stopped') {
    return {
      ...base,
      completedAt: new Date().toISOString(),
      status: 'blocked',
      error: { code: 'PX_POLICY_BLOCKED', userMessage: '任务已不满足有界轮询条件，轮询已停止。', recoverable: false },
    }
  }
  return { ...base, completedAt: new Date().toISOString(), status: 'completed' }
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
    finalize: (result) => finalizeQueryResult(command, result),
  })
  return backgroundResponse(commandResult, viewData)
}

export async function handleRuntimeMessage(input: unknown, options: { external?: boolean; senderUrl?: string; senderTabId?: number } = {}): Promise<RuntimeResponse> {
  if (options.external) {
    let origin = ''
    try { origin = new URL(options.senderUrl ?? '').origin } catch { origin = '' }
    if (!ALLOWED_HOST_ORIGINS.has(origin)) return blocked(null, 'Host 来源未获允许。')
  } else {
    let sender: URL | null = null
    try { sender = new URL(options.senderUrl ?? '') } catch { sender = null }
    const declaredSource = input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>).sourceContainer
      : undefined
    const expectedPath = declaredSource === 'sidepanel' ? '/sidepanel.html'
      : declaredSource === 'workspace_page' ? '/workspace.html'
        : null
    if (!sender || sender.protocol !== 'chrome-extension:' || sender.host !== browser.runtime.id || !expectedPath || sender.pathname !== expectedPath) {
      return blocked(null, '内部消息来源与声明容器不一致，已阻止执行。')
    }
  }
  const validated = validateRuntimeMessage(input, options.external)
  if (!validated.ok) return blocked(null, `消息合同无效：${validated.issues.join('；')}`)
  const message = validated.value
  if (message.messageType === 'operation_poll') return handleOperationPoll(message)
  if (message.messageType === 'intent_route') {
    try {
      return await handleIntent(message.payload as IntentRoute, options.senderTabId)
    } catch (error) {
      if (error instanceof PxStorageMigrationBlockedError) {
        return { ...blocked(message, '检测到未知或冲突的旧版工作区状态，已阻止自动迁移。请导出诊断后清理扩展状态。'), error: { code: 'PX_STORAGE_VERSION_UNSUPPORTED', userMessage: '检测到未知或冲突的旧版工作区状态，已阻止自动迁移。请导出诊断后清理扩展状态。', recoverable: false } }
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
