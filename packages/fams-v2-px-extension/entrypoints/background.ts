import { browser } from 'wxt/browser'
import { handleRuntimeMessage } from '../src/background/runtimeHandler'
import { initializeLifecycleStorage } from '../src/background/lifecycleCoordinator'
import { registerLifecyclePortManager } from '../src/background/lifecyclePortManager'

export default defineBackground(() => {
  const lifecycleReady = initializeLifecycleStorage().catch(() => undefined)
  registerLifecyclePortManager(lifecycleReady)

  browser.runtime.onInstalled.addListener(() => {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  })

  browser.runtime.onMessage.addListener((message, sender) => lifecycleReady.then(() => handleRuntimeMessage(message, { senderUrl: sender.url, senderTabId: sender.tab?.id })))
  browser.runtime.onMessageExternal.addListener((message, sender) => (
    lifecycleReady.then(() => handleRuntimeMessage(message, { external: true, senderUrl: sender.url }))
  ))
})
