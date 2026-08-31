const workspaceStateQueues = new Map<string, Promise<void>>()
export const LIFECYCLE_STATE_WRITER_KEY = 'px-lifecycle-background-single-writer'

export async function serializeWorkspaceState<T>(workspaceId: string, task: () => Promise<T>): Promise<T> {
  const previous = workspaceStateQueues.get(workspaceId) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.catch(() => undefined).then(() => gate)
  workspaceStateQueues.set(workspaceId, tail)
  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    release()
    if (workspaceStateQueues.get(workspaceId) === tail) workspaceStateQueues.delete(workspaceId)
  }
}
