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
}): {
  firstSnapshot: Promise<Snapshot>
  requestRecovery(): void
  close(reason?: 'user_close' | 'page_unload'): void
  disconnect(): void
} {
  const port = browser.runtime.connect({ name: LIFECYCLE_PORT_NAME })
  const instanceStorageKey = `v2-px-container-instance:${input.container}`
  const storedInstance = sessionStorage.getItem(instanceStorageKey)
  const containerInstanceId = storedInstance && /^px-container-[a-z0-9][a-z0-9-]{7,100}$/.test(storedInstance) ? storedInstance : token('container')
  sessionStorage.setItem(instanceStorageKey, containerInstanceId)
  const routeId = token('route')
  const correlationId = token('corr')
  let settled = false
  let resolveFirst: (snapshot: Snapshot) => void = () => {}
  let rejectFirst: (error: Error) => void = () => {}
  const firstSnapshot = new Promise<Snapshot>((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject })
  const timer = setTimeout(() => {
    if (!settled) { settled = true; rejectFirst(new Error('PX lifecycle snapshot timeout')) }
  }, 5_000)

  const post = (message: Extract<LifecyclePortMessage, { kind: 'state_subscribe' | 'recover_request' | 'container_close' }>) => port.postMessage(message)
  const common = () => ({
    schemaVersion: 'v2-px-lifecycle-port-message/1' as const,
    messageId: token('message'), workspaceId: input.workspaceId, routeId, correlationId, containerInstanceId,
    sourceContainer: input.container, targetContainer: 'background' as const, sentAt: new Date().toISOString(),
  })

  port.onMessage.addListener((message) => {
    const validated = validateLifecyclePortMessage(message)
    if (!validated.ok || validated.value.kind !== 'state_snapshot') return
    const snapshot = validated.value
    if (snapshot.workspaceId !== input.workspaceId || snapshot.containerInstanceId !== containerInstanceId || snapshot.targetContainer !== input.container) return
    if (!settled) { settled = true; clearTimeout(timer); resolveFirst(snapshot) }
    input.onSnapshot?.(snapshot.payload.workspaceState, snapshot)
  })
  port.onDisconnect.addListener(() => {
    if (!settled) { settled = true; clearTimeout(timer); rejectFirst(new Error('PX lifecycle port disconnected before snapshot')) }
  })
  post({
    ...common(), kind: 'state_subscribe',
    payload: { currentView: input.currentView, ...(input.selectedRef ? { selectedRef: input.selectedRef } : {}), navigationType: navigationType() },
  })

  const onPageHide = () => {
    try { post({ ...common(), kind: 'container_close', payload: { reason: 'page_unload' } }) } catch { /* browser owns final disconnect */ }
  }
  window.addEventListener('pagehide', onPageHide, { once: true })

  return {
    firstSnapshot,
    requestRecovery() { post({ ...common(), kind: 'recover_request', payload: { reason: 'manual_retry' } }) },
    close(reason = 'user_close') { post({ ...common(), kind: 'container_close', payload: { reason } }) },
    disconnect() { clearTimeout(timer); window.removeEventListener('pagehide', onPageHide); port.disconnect() },
  }
}
