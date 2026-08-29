import { browser } from 'wxt/browser'
import { handleRuntimeMessage } from '../src/background/runtimeHandler'

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  })

  browser.runtime.onMessage.addListener((message, sender) => handleRuntimeMessage(message, { senderUrl: sender.url, senderTabId: sender.tab?.id }))
  browser.runtime.onMessageExternal.addListener((message, sender) => (
    handleRuntimeMessage(message, { external: true, senderUrl: sender.url })
  ))
})
