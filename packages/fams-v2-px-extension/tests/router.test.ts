import { describe, expect, it } from 'vitest'
import type { PxTab, TabsApi, WindowsApi } from '../src/background/workspaceTabManager'
import { openOrFocusWorkspace } from '../src/background/workspaceTabManager'
import { canonicalWorkspaceKey } from '../src/background/intentRouter'

class FakeBrowser implements TabsApi {
  tabs: PxTab[] = []
  nextId = 1
  focusedWindows: number[] = []

  async query(): Promise<PxTab[]> { return [...this.tabs] }
  async create(input: { url: string }): Promise<PxTab> {
    const tab = { id: this.nextId++, windowId: 10, url: input.url }
    this.tabs.push(tab)
    return tab
  }
  async update(tabId: number, input: { url?: string }): Promise<PxTab> {
    const tab = this.tabs.find((item) => item.id === tabId)
    if (!tab) throw new Error('missing tab')
    if (input.url) tab.url = input.url
    return tab
  }
}

describe('canonical workspace tab management', () => {
  it('ignores view/ref in the canonical key', () => {
    expect(canonicalWorkspaceKey('px-ws-00000000-0000-4000-8000-000000000001')).toBe('workspace:px-ws-00000000-0000-4000-8000-000000000001')
  })

  it('keeps one tab after 20 repeated opens and focuses its window', async () => {
    const fake = new FakeBrowser()
    const windows: WindowsApi = { update: async (windowId) => { fake.focusedWindows.push(windowId); return {} } }
    for (let index = 0; index < 20; index += 1) {
      await openOrFocusWorkspace({
        tabs: fake,
        windows,
        canonicalBaseUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html',
        desiredUrl: `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=source_library&ref=${index}`,
        workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001',
      })
    }
    expect(fake.tabs).toHaveLength(1)
    expect(fake.focusedWindows).toHaveLength(19)
    expect(fake.tabs[0]?.url).toContain('ref=19')
  })
})
