export type PxTab = { id?: number; windowId?: number; url?: string }

export type TabsApi = {
  query(queryInfo: Record<string, unknown>): Promise<PxTab[]>
  create(createProperties: { url: string; active: boolean }): Promise<PxTab>
  update(tabId: number, updateProperties: { url?: string; active?: boolean }): Promise<PxTab>
  remove(tabIds: number[]): Promise<void>
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

const workspaceQueues = new Map<string, Promise<void>>()

async function serializeWorkspace<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = workspaceQueues.get(key) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.catch(() => undefined).then(() => gate)
  workspaceQueues.set(key, tail)
  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    release()
    if (workspaceQueues.get(key) === tail) workspaceQueues.delete(key)
  }
}

async function updateWorkspaceTab(input: {
  tabs: TabsApi
  canonicalBaseUrl: string
  tabId: number
  currentUrl?: string
  desiredUrl: string
}): Promise<PxTab> {
  let currentUrl = input.currentUrl
  const delays = [0, 40, 160]
  let lastError: unknown
  for (const delay of delays) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    try {
      return await input.tabs.update(input.tabId, currentUrl === input.desiredUrl
        ? { active: true }
        : { url: input.desiredUrl, active: true })
    } catch (error) {
      lastError = error
      const tabs = await input.tabs.query({ url: `${input.canonicalBaseUrl}*` })
      currentUrl = tabs.find((tab) => tab.id === input.tabId)?.url
    }
  }
  throw lastError
}

export async function openOrFocusWorkspace(input: {
  tabs: TabsApi
  windows: WindowsApi
  canonicalBaseUrl: string
  desiredUrl: string
  workspaceId: string
  preferredTabId?: number
}): Promise<{ action: 'created' | 'focused'; tab: PxTab; matchingTabCount: number }> {
  return serializeWorkspace(`${input.canonicalBaseUrl}|${input.workspaceId}`, async () => {
    const tabs = await input.tabs.query({ url: `${input.canonicalBaseUrl}*` })
    const matching = tabs.filter((tab) => readWorkspaceId(tab.url) === input.workspaceId && typeof tab.id === 'number')
    const existing = matching.find((tab) => tab.id === input.preferredTabId) ?? matching[0]
    if (typeof existing?.id !== 'number') {
      const tab = await input.tabs.create({ url: input.desiredUrl, active: true })
      return { action: 'created' as const, tab, matchingTabCount: 1 }
    }
    const duplicateIds = matching.filter((tab) => tab.id !== existing.id).map((tab) => tab.id).filter((id): id is number => typeof id === 'number')
    if (duplicateIds.length > 0) await input.tabs.remove(duplicateIds)
    let tab: PxTab
    try {
      tab = await updateWorkspaceTab({
        tabs: input.tabs,
        canonicalBaseUrl: input.canonicalBaseUrl,
        tabId: existing.id,
        currentUrl: existing.url,
        desiredUrl: input.desiredUrl,
      })
    } catch (error) {
      // A user may close the tab between query() and update(). After the
      // bounded retries, create only when a fresh query proves it is gone.
      const remaining = await input.tabs.query({ url: `${input.canonicalBaseUrl}*` })
      const stillExists = remaining.some((candidate) => readWorkspaceId(candidate.url) === input.workspaceId && typeof candidate.id === 'number')
      if (stillExists) throw error
      tab = await input.tabs.create({ url: input.desiredUrl, active: true })
      return { action: 'created' as const, tab, matchingTabCount: 1 }
    }
    if (typeof existing.windowId === 'number') await input.windows.update(existing.windowId, { focused: true })
    return { action: 'focused' as const, tab, matchingTabCount: 1 }
  })
}
