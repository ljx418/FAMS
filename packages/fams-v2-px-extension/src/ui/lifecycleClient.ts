import { browser } from 'wxt/browser'
import { LIFECYCLE_PORT_NAME, type LifecyclePortMessage, type RouteIntent, type WorkspaceStateV1 } from '../contracts/types'
import { validateLifecyclePortMessage } from '../contracts/validation'

type ClientContainer = 'sidepanel' | 'workspace_page'
type Snapshot = Extract<LifecyclePortMessage, { kind: 'state_snapshot' }>

function token(prefix: 'message' | 'route' | 'corr' | 'container'): string {
  return `px-${prefix}-${crypto.randomUUID().replaceAll('-', '')}`
}

export function navigationType(): 'open' | 'navigate' | 'reload' | 'back_forward' | 'restore' {
  const entry = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
  if (entry?.type === 'reload') return 'reload'
  if (entry?.type === 'back_forward') return 'back_forward'
  return document.referrer.startsWith(location.origin) ? 'navigate' : 'open'
}

export function openLifecycleChannel(input: {
  workspaceId: string
  container: ClientContainer
  currentView: RouteIntent
  selectedRef?: string
  onSnapshot?: (state: WorkspaceStateV1, snapshot: Snapshot) => void
  onConnectionLost?: () => void
  onReconnectExhausted?: () => void
}): {
  firstSnapshot: Promise<Snapshot>
  requestRecovery(): void
  close(reason?: 'user_close' | 'page_unload'): void
  disconnect(): void
} {
  // Every actual Port channel owns a distinct lease. A reconnect within this
  // channel reuses the ID, while React StrictMode remounts cannot close a newer
  // channel's lease by racing with an older cleanup.
  const containerInstanceId = token('container')
  const routeId = token('route')
  const correlationId = token('corr')
  let settled = false
  let disposed = false
  let explicitlyClosing = false
  let reconnectAttempts = 0
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let port: ReturnType<typeof browser.runtime.connect> | null = null
  let resolveFirst: (snapshot: Snapshot) => void = () => {}
  let rejectFirst: (error: Error) => void = () => {}
  const firstSnapshot = new Promise<Snapshot>((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject })
  const timer = setTimeout(() => {
    if (!settled) { settled = true; rejectFirst(new Error('PX lifecycle snapshot timeout')) }
  }, 5_000)

  const post = (message: Extract<LifecyclePortMessage, { kind: 'state_subscribe' | 'recover_request' | 'container_close' }>) => {
    if (!port) throw new Error('PX lifecycle port unavailable')
    port.postMessage(message)
  }
  const common = () => ({
    schemaVersion: 'v2-px-lifecycle-port-message/1' as const,
    messageId: token('message'), workspaceId: input.workspaceId, routeId, correlationId, containerInstanceId,
    sourceContainer: input.container, targetContainer: 'background' as const, sentAt: new Date().toISOString(),
  })

  const connect = (requestedNavigationType: ReturnType<typeof navigationType>) => {
    const connectedPort = browser.runtime.connect({ name: LIFECYCLE_PORT_NAME })
    port = connectedPort
    connectedPort.onMessage.addListener((message) => {
      if (port !== connectedPort || disposed) return
      const validated = validateLifecyclePortMessage(message)
      if (!validated.ok || validated.value.kind !== 'state_snapshot') return
      const snapshot = validated.value
      if (snapshot.workspaceId !== input.workspaceId || snapshot.containerInstanceId !== containerInstanceId || snapshot.targetContainer !== input.container) return
      if (!settled) { settled = true; clearTimeout(timer); resolveFirst(snapshot) }
      input.onSnapshot?.(snapshot.payload.workspaceState, snapshot)
    })
    connectedPort.onDisconnect.addListener(() => {
      if (port !== connectedPort || disposed || explicitlyClosing) return
      input.onConnectionLost?.()
      if (reconnectAttempts < 1) {
        reconnectAttempts += 1
        reconnectTimer = setTimeout(() => { if (!disposed) connect('restore') }, 250)
        return
      }
      if (!settled) { settled = true; clearTimeout(timer); rejectFirst(new Error('PX lifecycle port disconnected before snapshot')) }
      input.onReconnectExhausted?.()
    })
    connectedPort.postMessage({
      ...common(), kind: 'state_subscribe',
      payload: { currentView: input.currentView, ...(input.selectedRef ? { selectedRef: input.selectedRef } : {}), navigationType: requestedNavigationType },
    })
  }
  connect(navigationType())

  const onPageHide = () => {
    explicitlyClosing = true
    disposed = true
    try { post({ ...common(), kind: 'container_close', payload: { reason: 'page_unload' } }) } catch { /* browser owns final disconnect */ }
  }
  window.addEventListener('pagehide', onPageHide, { once: true })

  return {
    firstSnapshot,
    requestRecovery() { post({ ...common(), kind: 'recover_request', payload: { reason: 'manual_retry' } }) },
    close(reason = 'user_close') {
      explicitlyClosing = true
      disposed = true
      post({ ...common(), kind: 'container_close', payload: { reason } })
    },
    disconnect() {
      clearTimeout(timer)
      if (reconnectTimer) clearTimeout(reconnectTimer)
      window.removeEventListener('pagehide', onPageHide)
      if (!disposed) {
        explicitlyClosing = true
        disposed = true
        try { post({ ...common(), kind: 'container_close', payload: { reason: 'page_unload' } }) } catch { /* already disconnected */ }
      }
      const closingPort = port
      setTimeout(() => closingPort?.disconnect(), 0)
    },
  }
}
