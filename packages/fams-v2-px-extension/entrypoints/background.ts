import { browser } from 'wxt/browser'
import { handleRuntimeMessage } from '../src/background/runtimeHandler'
import { initializeLifecycleStorage } from '../src/background/lifecycleCoordinator'
import { registerLifecyclePortManager } from '../src/background/lifecyclePortManager'

export default defineBackground(() => {
  registerLifecyclePortManager()
  void initializeLifecycleStorage().catch(() => undefined)

  browser.runtime.onInstalled.addListener(() => {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    void initializeLifecycleStorage().catch(() => undefined)
  })
  browser.runtime.onStartup.addListener(() => { void initializeLifecycleStorage().catch(() => undefined) })

  browser.runtime.onMessage.addListener((message, sender) => handleRuntimeMessage(message, { senderUrl: sender.url, senderTabId: sender.tab?.id }))
  browser.runtime.onMessageExternal.addListener((message, sender) => (
    handleRuntimeMessage(message, { external: true, senderUrl: sender.url })
  ))
})
