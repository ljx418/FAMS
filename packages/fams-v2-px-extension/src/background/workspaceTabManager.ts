export type PxTab = { id?: number; windowId?: number; url?: string }

export type TabsApi = {
  query(queryInfo: Record<string, unknown>): Promise<PxTab[]>
  create(createProperties: { url: string; active: boolean }): Promise<PxTab>
  update(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<PxTab>
}

export type WindowsApi = {
  update(windowId: number, updateInfo: { focused: boolean }): Promise<unknown>
}

function readWorkspaceId(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).searchParams.get('workspaceId')
  } catch {
    return null
  }
}

export async function openOrFocusWorkspace(input: {
  tabs: TabsApi
  windows: WindowsApi
  canonicalBaseUrl: string
  desiredUrl: string
  workspaceId: string
}): Promise<{ action: 'created' | 'focused'; tab: PxTab; matchingTabCount: number }> {
  const tabs = await input.tabs.query({ url: `${input.canonicalBaseUrl}*` })
  const matching = tabs.filter((tab) => readWorkspaceId(tab.url) === input.workspaceId)
  const existing = matching.find((tab) => typeof tab.id === 'number')
  if (!existing?.id) {
    const tab = await input.tabs.create({ url: input.desiredUrl, active: true })
    return { action: 'created', tab, matchingTabCount: 1 }
  }
  const tab = await input.tabs.update(existing.id, { url: input.desiredUrl, active: true })
  if (typeof existing.windowId === 'number') await input.windows.update(existing.windowId, { focused: true })
  return { action: 'focused', tab, matchingTabCount: matching.length }
}
