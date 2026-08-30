import { describe, expect, it } from 'vitest'
import { createIntentRoute } from '../src/contracts/factories'
import type { PxTab, TabsApi, WindowsApi } from '../src/background/workspaceTabManager'
import { openOrFocusWorkspace } from '../src/background/workspaceTabManager'
import { buildWorkspacePath, canonicalRouteKey, canonicalWorkspaceKey } from '../src/background/intentRouter'
import { expectedTargetContainer } from '../src/contracts/validation'

class FakeBrowser implements TabsApi {
  tabs: PxTab[] = []
  nextId = 1
  focusedWindows: number[] = []
  navigationRejectsRemaining = 0
  removeOnNextUpdate = false

  async query(): Promise<PxTab[]> { return [...this.tabs] }
  async create(input: { url: string }): Promise<PxTab> {
    const tab = { id: this.nextId++, windowId: 10, url: input.url }
    this.tabs.push(tab)
    return tab
  }
  async update(tabId: number, input: { url?: string }): Promise<PxTab> {
    if (this.removeOnNextUpdate) {
      this.removeOnNextUpdate = false
      this.tabs = this.tabs.filter((item) => item.id !== tabId)
      throw new Error('tab closed during navigation')
    }
    if (input.url && this.navigationRejectsRemaining > 0) {
      this.navigationRejectsRemaining -= 1
      throw new Error('Navigation rejected.')
    }
    const tab = this.tabs.find((item) => item.id === tabId)
    if (!tab) throw new Error('missing tab')
    if (input.url) tab.url = input.url
    return tab
  }
  async remove(tabIds: number[]): Promise<void> {
    this.tabs = this.tabs.filter((tab) => typeof tab.id !== 'number' || !tabIds.includes(tab.id))
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

  it('keeps one tab after 20 concurrent opens', async () => {
    const fake = new FakeBrowser()
    const windows: WindowsApi = { update: async (windowId) => { fake.focusedWindows.push(windowId); return {} } }
    await Promise.all(Array.from({ length: 20 }, (_, index) => openOrFocusWorkspace({
      tabs: fake,
      windows,
      canonicalBaseUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html',
      desiredUrl: `chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=source_library&ref=${index}`,
      workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001',
    })))
    expect(fake.tabs).toHaveLength(1)
  })

  it('uses bounded navigation retry without creating another tab', async () => {
    const fake = new FakeBrowser()
    fake.tabs = [{ id: 7, windowId: 8, url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=source_library' }]
    fake.navigationRejectsRemaining = 2
    const result = await openOrFocusWorkspace({
      tabs: fake,
      windows: { update: async () => ({}) },
      canonicalBaseUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html',
      desiredUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=trace&ref=real-operation',
      workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001',
    })
    expect(result.action).toBe('focused')
    expect(fake.tabs).toHaveLength(1)
    expect(fake.tabs[0]?.url).toContain('view=trace')
  })

  it('creates one replacement when the user closes the queried tab before update', async () => {
    const fake = new FakeBrowser()
    fake.tabs = [{ id: 7, windowId: 8, url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=trace' }]
    fake.nextId = 8
    fake.removeOnNextUpdate = true
    const result = await openOrFocusWorkspace({
      tabs: fake,
      windows: { update: async () => ({}) },
      canonicalBaseUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html',
      desiredUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=trace',
      workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001',
    })
    expect(result.action).toBe('created')
    expect(fake.tabs).toEqual([expect.objectContaining({ id: 8 })])
  })

  it('converges duplicate tabs across windows and focuses the retained window', async () => {
    const fake = new FakeBrowser()
    fake.tabs = [
      { id: 11, windowId: 20, url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=trace' },
      { id: 12, windowId: 21, url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=graph' },
      { id: 13, windowId: 22, url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000002&view=ask' },
    ]
    const windows: WindowsApi = { update: async (windowId) => { fake.focusedWindows.push(windowId); return {} } }
    const result = await openOrFocusWorkspace({
      tabs: fake,
      windows,
      canonicalBaseUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html',
      desiredUrl: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=source_detail&ref=opaque',
      workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001',
      preferredTabId: 12,
    })
    expect(result.matchingTabCount).toBe(1)
    expect(fake.tabs.map((tab) => tab.id)).toEqual([12, 13])
    expect(fake.focusedWindows).toEqual([21])
  })

  it('implements all nine entry/action target mappings through the production factory', () => {
    const entries = ['sidepanel', 'workspace_page', 'host_app'] as const
    const actions = ['view_source', 'open_workspace', 'open_in_workspace'] as const
    for (const entryContainer of entries) {
      for (const entryAction of actions) {
        const route = createIntentRoute({
          entryContainer,
          entryAction,
          routeIntent: 'source_library',
          routePayload: { workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001' },
        })
        expect(route.targetContainer).toBe(expectedTargetContainer(entryContainer, entryAction))
      }
    }
  })

  it('derives a stable SHA canonical route key and an exact minimal Workspace URL', async () => {
    const base = createIntentRoute({
      entryContainer: 'host_app',
      entryAction: 'open_in_workspace',
      routeIntent: 'graph',
      routePayload: { workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', graphScope: 'daily-review', graphId: 'a39d4ba3-e272-46a7-ba5f-e3a495d499be' },
    })
    const replay = { ...base, routeId: 'px-route-replayed00000001', correlationId: 'px-corr-replayed00000001', idempotencyKey: 'px-idem-replayed00000001', audit: { ...base.audit, createdAt: '2026-08-29T00:00:00.000Z' } }
    const key = await canonicalRouteKey(base)
    expect(key).toMatch(/^[a-f0-9]{64}$/)
    expect(await canonicalRouteKey(replay)).toBe(key)
    const path = buildWorkspacePath(base)
    const params = new URL(`chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa${path}`).searchParams
    expect([...params.keys()].sort()).toEqual(['ref', 'view', 'workspaceId'])
    expect(params.get('ref')).toBe('a39d4ba3-e272-46a7-ba5f-e3a495d499be')
    expect(path).not.toContain('routeId')
    expect(path).not.toContain('correlationId')
  })
})
