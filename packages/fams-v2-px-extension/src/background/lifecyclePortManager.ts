import { browser } from 'wxt/browser'
import { LIFECYCLE_PORT_NAME, type LifecyclePortMessage, type WorkspaceStateV1 } from '../contracts/types'
import { validateLifecyclePortMessage } from '../contracts/validation'
import { closeLifecycle, currentLifecycleSnapshot, recoverLifecycle, subscribeLifecycle } from './lifecycleCoordinator'

type PortLike = {
  name: string
  sender?: { url?: string }
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: { addListener(listener: (message: unknown) => void): void }
  onDisconnect: { addListener(listener: () => void): void }
}

type Subscription = { port: PortLike; workspaceId: string; container: 'sidepanel' | 'workspace_page'; instanceId: string; currentView: WorkspaceStateV1['currentView'] }
const subscriptions = new Set<Subscription>()

function senderContainer(port: PortLike): 'sidepanel' | 'workspace_page' | null {
  try {
    const url = new URL(port.sender?.url ?? '')
    if (url.protocol !== 'chrome-extension:' || url.host !== browser.runtime.id) return null
    if (url.pathname === '/sidepanel.html') return 'sidepanel'
    if (url.pathname === '/workspace.html') return 'workspace_page'
  } catch { /* invalid URL */ }
  return null
}

function safePost(port: PortLike, message: LifecyclePortMessage | null): void {
  if (!message) return
  try { port.postMessage(message) } catch { /* page already closed */ }
}

export function handleLifecyclePort(port: PortLike): void {
  if (port.name !== LIFECYCLE_PORT_NAME) { port.disconnect(); return }
  const actualContainer = senderContainer(port)
  if (!actualContainer) { port.disconnect(); return }
  let subscription: Subscription | null = null
  let chain = Promise.resolve()
  port.onMessage.addListener((input) => {
    chain = chain.then(async () => {
      const validated = validateLifecyclePortMessage(input)
      if (!validated.ok) { port.disconnect(); return }
      const message = validated.value
      if (message.sourceContainer !== actualContainer || message.targetContainer !== 'background') { port.disconnect(); return }
      if (!subscription && message.kind !== 'state_subscribe') { port.disconnect(); return }
      if (message.kind === 'state_subscribe') {
        if (subscription) { port.disconnect(); return }
        subscription = { port, workspaceId: message.workspaceId, container: actualContainer, instanceId: message.containerInstanceId, currentView: message.payload.currentView }
        subscriptions.add(subscription)
        safePost(port, await subscribeLifecycle(message))
      } else if (message.kind === 'recover_request' && subscription) {
        safePost(port, await recoverLifecycle(message, subscription.currentView))
      } else if (message.kind === 'container_close' && subscription) {
        safePost(port, await closeLifecycle(message))
        subscriptions.delete(subscription)
        subscription = null
      } else {
        port.disconnect()
      }
    }).catch(() => port.disconnect())
  })
  port.onDisconnect.addListener(() => { if (subscription) subscriptions.delete(subscription) })
}

export async function broadcastLifecycleSnapshots(): Promise<void> {
  await Promise.all([...subscriptions].map(async (subscription) => {
    const snapshot = await currentLifecycleSnapshot(subscription.workspaceId, subscription.container, subscription.instanceId)
    safePost(subscription.port, snapshot)
  }))
}

export function registerLifecyclePortManager(): void {
  browser.runtime.onConnect.addListener((port) => handleLifecyclePort(port))
  browser.storage.onChanged.addListener((_changes, areaName) => {
    if (areaName === 'session') void broadcastLifecycleSnapshots()
  })
}
