export const PX_DEFAULT_WORKSPACE_ID = 'px-ws-00000000-0000-4000-8000-000000000001' as const

const EXTENSION_ID_PATTERN = /^[a-p]{32}$/
const FAMS_ENTITY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const WORKSPACE_ID_PATTERN = /^px-ws-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const CONVERSATION_ID_PATTERN = /^chat-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const SOURCE_REF_PATTERN = /^(op-artifact|review-evidence):([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}):([A-Za-z0-9_-]{2,686})$/

type PxHostRouteRequest =
  | { entryAction: 'open_workspace'; routeIntent: 'source_library'; routePayload: { workspaceId: string; filter?: string } }
  | { entryAction: 'view_source' | 'open_in_workspace'; routeIntent: 'source_detail'; routePayload: { workspaceId: string; sourceRef: string } }
  | { entryAction: 'open_workspace'; routeIntent: 'ask'; routePayload: { workspaceId: string; conversationId?: string } }
  | { entryAction: 'open_in_workspace'; routeIntent: 'trace'; routePayload: { workspaceId: string; operationId: string; sourceRef?: string } }
  | { entryAction: 'open_in_workspace'; routeIntent: 'graph'; routePayload: { workspaceId: string; graphScope: 'daily-review' | 'operation'; graphId: string; focusNodeId?: string } }

export type { PxHostRouteRequest }

export type PxHostRuntimeMessage = {
  schemaVersion: 'v2-px-runtime-message/1'
  messageType: 'intent_route'
  routeId: string
  correlationId: string
  idempotencyKey: string
  sourceContainer: 'host_app'
  targetContainer: 'workspace_page'
  sentAt: string
  payload: {
    schemaVersion: 'v2-px-intent-route/3'
    productId: 'fams-v2-px'
    repository: 'https://github.com/ljx418/FAMS.git'
    commitSha: string
    entryContainer: 'host_app'
    entryAction: PxHostRouteRequest['entryAction']
    routeIntent: PxHostRouteRequest['routeIntent']
    targetContainer: 'workspace_page'
    routeId: string
    correlationId: string
    idempotencyKey: string
    permissionType: 'read_only_direct'
    routePayload: PxHostRouteRequest['routePayload']
    audit: {
      createdAt: string
      sourceContainer: 'host_app'
      schemaValidated: true
      semanticValidationRequired: true
    }
  }
}

type PxChromeRuntime = {
  lastError?: unknown
  sendMessage(extensionId: string, message: PxHostRuntimeMessage, callback: (response: unknown) => void): void
}

export type PxHostBridgeResult = {
  ok: boolean
  status: 'accepted' | 'blocked' | 'configuration_required' | 'unavailable' | 'timed_out' | 'invalid_context'
  userMessage: string
  routeId?: string
  correlationId?: string
  ackMs?: number
}

export type PxHostBridgeDependencies = {
  extensionId: string | undefined
  runtime: PxChromeRuntime | undefined
  timeoutMs?: number
  commitSha?: string
  now?: () => number
}

class PxHostInputError extends Error {}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): boolean {
  const allowed = new Set([...required, ...optional])
  return required.every((key) => key in value) && Object.keys(value).every((key) => allowed.has(key))
}

function canonicalBase64Url(value: string): boolean {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) return false
  try {
    const standard = value.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(`${standard}${'='.repeat((4 - standard.length % 4) % 4)}`)
    if (binary.length < 1 || binary.length > 512) return false
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') === value
  } catch {
    return false
  }
}

function isSourceRef(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 768) return false
  const match = SOURCE_REF_PATTERN.exec(value)
  return Boolean(match && canonicalBase64Url(match[3]!))
}

function validateRequest(request: PxHostRouteRequest): void {
  if (!request || typeof request !== 'object' || !('routePayload' in request) || !request.routePayload || typeof request.routePayload !== 'object') {
    throw new PxHostInputError('缺少可定位的外部大脑上下文。')
  }
  const payload = request.routePayload as Record<string, unknown>
  if (!WORKSPACE_ID_PATTERN.test(String(payload.workspaceId ?? ''))) throw new PxHostInputError('工作区编号无效，未向扩展发送。')

  switch (request.routeIntent) {
    case 'source_library':
      if (request.entryAction !== 'open_workspace' || !exactKeys(payload, ['workspaceId'], ['filter']) || ('filter' in payload && (typeof payload.filter !== 'string' || payload.filter.length > 120))) {
        throw new PxHostInputError('来源库导航参数无效，未向扩展发送。')
      }
      break
    case 'source_detail':
      if (!['view_source', 'open_in_workspace'].includes(request.entryAction) || !exactKeys(payload, ['workspaceId', 'sourceRef']) || !isSourceRef(payload.sourceRef)) {
        throw new PxHostInputError('来源引用无效，未向扩展发送。')
      }
      break
    case 'ask':
      if (request.entryAction !== 'open_workspace' || !exactKeys(payload, ['workspaceId'], ['conversationId']) || ('conversationId' in payload && !CONVERSATION_ID_PATTERN.test(String(payload.conversationId)))) {
        throw new PxHostInputError('提问视图导航参数无效，未向扩展发送。')
      }
      break
    case 'trace':
      if (request.entryAction !== 'open_in_workspace' || !exactKeys(payload, ['workspaceId', 'operationId'], ['sourceRef']) || !FAMS_ENTITY_ID_PATTERN.test(String(payload.operationId)) || ('sourceRef' in payload && !isSourceRef(payload.sourceRef))) {
        throw new PxHostInputError('任务编号无效，请先选择一个有效任务。')
      }
      break
    case 'graph':
      if (request.entryAction !== 'open_in_workspace' || !exactKeys(payload, ['workspaceId', 'graphScope', 'graphId'], ['focusNodeId']) || !['daily-review', 'operation'].includes(String(payload.graphScope)) || !FAMS_ENTITY_ID_PATTERN.test(String(payload.graphId)) || ('focusNodeId' in payload && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(String(payload.focusNodeId)))) {
        throw new PxHostInputError('复盘或图谱编号无效，请先打开一份有效复盘。')
      }
      break
    default:
      throw new PxHostInputError('该外部大脑导航类型未获允许。')
  }
}

function token(prefix: 'route' | 'corr' | 'idem'): string {
  return `px-${prefix}-${crypto.randomUUID().replace(/-/g, '')}`
}

export function buildPxHostRuntimeMessage(request: PxHostRouteRequest, configuredCommitSha?: string): PxHostRuntimeMessage {
  validateRequest(request)
  const routeId = token('route')
  const correlationId = token('corr')
  const idempotencyKey = token('idem')
  const createdAt = new Date().toISOString()
  const commitSha = /^[a-f0-9]{40}$/.test(configuredCommitSha ?? '') ? configuredCommitSha! : '0'.repeat(40)
  const payload: PxHostRuntimeMessage['payload'] = {
    schemaVersion: 'v2-px-intent-route/3',
    productId: 'fams-v2-px',
    repository: 'https://github.com/ljx418/FAMS.git',
    commitSha,
    entryContainer: 'host_app',
    entryAction: request.entryAction,
    routeIntent: request.routeIntent,
    targetContainer: 'workspace_page',
    routeId,
    correlationId,
    idempotencyKey,
    permissionType: 'read_only_direct',
    routePayload: request.routePayload,
    audit: { createdAt, sourceContainer: 'host_app', schemaValidated: true, semanticValidationRequired: true },
  }
  return {
    schemaVersion: 'v2-px-runtime-message/1',
    messageType: 'intent_route',
    routeId,
    correlationId,
    idempotencyKey,
    sourceContainer: 'host_app',
    targetContainer: 'workspace_page',
    sentAt: createdAt,
    payload,
  }
}

function safeBackgroundMessage(response: unknown): string | undefined {
  if (!response || typeof response !== 'object') return undefined
  const error = (response as { error?: unknown }).error
  if (!error || typeof error !== 'object') return undefined
  const message = (error as { userMessage?: unknown }).userMessage
  if (typeof message !== 'string') return undefined
  const clean = message.replace(/[\r\n]+/g, ' ').trim().slice(0, 240)
  return clean && !/runtime\.lastError|chrome-extension:\/\/|\bat\s+\S+\s*\(/i.test(clean) ? clean : undefined
}

function commandStatus(response: unknown): string | undefined {
  return response && typeof response === 'object' && typeof (response as { status?: unknown }).status === 'string'
    ? (response as { status: string }).status
    : undefined
}

export async function sendPxHostRouteWithDependencies(request: PxHostRouteRequest, dependencies: PxHostBridgeDependencies): Promise<PxHostBridgeResult> {
  if (!dependencies.extensionId) {
    return { ok: false, status: 'configuration_required', userMessage: '尚未配置外部大脑扩展 ID。请在前端环境中设置 VITE_FAMS_PX_EXTENSION_ID，然后重新启动页面。' }
  }
  if (!EXTENSION_ID_PATTERN.test(dependencies.extensionId)) {
    return { ok: false, status: 'configuration_required', userMessage: '外部大脑扩展 ID 格式无效。请复制扩展管理页中的 32 位 ID 并重新启动前端。' }
  }
  if (!dependencies.runtime?.sendMessage) {
    return { ok: false, status: 'unavailable', userMessage: '当前浏览器未检测到外部大脑消息能力。请确认扩展已安装并启用，然后刷新本页。' }
  }

  let message: PxHostRuntimeMessage
  try {
    message = buildPxHostRuntimeMessage(request, dependencies.commitSha)
  } catch (error) {
    return { ok: false, status: 'invalid_context', userMessage: error instanceof PxHostInputError ? error.message : '当前上下文无法安全交给外部大脑。' }
  }

  const startedAt = (dependencies.now ?? Date.now)()
  const timeoutMs = Math.min(1_000, Math.max(1, dependencies.timeoutMs ?? 1_000))
  return new Promise((resolve) => {
    let settled = false
    const finish = (result: PxHostBridgeResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const timer = globalThis.setTimeout(() => finish({
      ok: false,
      status: 'timed_out',
      userMessage: '外部大脑 1 秒内没有确认接收。请检查扩展是否启用、扩展 ID 是否匹配，然后重试。',
      routeId: message.routeId,
      correlationId: message.correlationId,
      ackMs: (dependencies.now ?? Date.now)() - startedAt,
    }), timeoutMs)

    try {
      dependencies.runtime!.sendMessage(dependencies.extensionId!, message, (response) => {
        const runtimeFailed = Boolean(dependencies.runtime?.lastError)
        const ackMs = (dependencies.now ?? Date.now)() - startedAt
        if (runtimeFailed) {
          finish({
            ok: false,
            status: 'unavailable',
            userMessage: '未能联系外部大脑扩展。请确认扩展已安装并启用，且配置的扩展 ID 与扩展管理页一致。',
            routeId: message.routeId,
            correlationId: message.correlationId,
            ackMs,
          })
          return
        }
        const status = commandStatus(response)
        if (status === 'accepted' || status === 'completed') {
          finish({ ok: true, status: 'accepted', userMessage: '外部大脑已接收，正在打开或聚焦完整工作台。', routeId: message.routeId, correlationId: message.correlationId, ackMs })
          return
        }
        if (status === 'blocked' || status === 'failed' || status === 'unknown_result') {
          finish({ ok: false, status: 'blocked', userMessage: safeBackgroundMessage(response) ?? '外部大脑已阻止本次跳转。请检查当前对象和扩展配置后重试。', routeId: message.routeId, correlationId: message.correlationId, ackMs })
          return
        }
        finish({ ok: false, status: 'unavailable', userMessage: '外部大脑没有返回可确认的接收结果。请检查扩展状态后重试。', routeId: message.routeId, correlationId: message.correlationId, ackMs })
      })
    } catch {
      finish({
        ok: false,
        status: 'unavailable',
        userMessage: '外部大脑扩展当前不可用。请确认扩展已安装并启用，然后刷新本页。',
        routeId: message.routeId,
        correlationId: message.correlationId,
        ackMs: (dependencies.now ?? Date.now)() - startedAt,
      })
    }
  })
}

function browserRuntime(): PxChromeRuntime | undefined {
  return (globalThis as typeof globalThis & { chrome?: { runtime?: PxChromeRuntime } }).chrome?.runtime
}

export function openInExternalBrain(request: PxHostRouteRequest): Promise<PxHostBridgeResult> {
  return sendPxHostRouteWithDependencies(request, {
    extensionId: import.meta.env.VITE_FAMS_PX_EXTENSION_ID,
    commitSha: import.meta.env.VITE_V2_PX_COMMIT_SHA,
    runtime: browserRuntime(),
  })
}
