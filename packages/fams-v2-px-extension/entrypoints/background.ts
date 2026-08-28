import { browser } from 'wxt/browser'
import { handleRuntimeMessage } from '../src/background/runtimeHandler'

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  })

  browser.runtime.onMessage.addListener((message) => handleRuntimeMessage(message))
  browser.runtime.onMessageExternal.addListener((message, sender) => (
    handleRuntimeMessage(message, { external: true, senderUrl: sender.url })
  ))
})
