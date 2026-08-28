export const BACKEND_ORIGINS = ['http://localhost:4000', 'http://127.0.0.1:4000'] as const
export const OPTIONAL_BACKEND_PERMISSIONS = BACKEND_ORIGINS.map((origin) => `${origin}/*`)

export type PermissionApi = {
  contains(permissions: { origins: string[] }): Promise<boolean>
  request(permissions: { origins: string[] }): Promise<boolean>
}

export async function hasBackendPermission(permissions: PermissionApi): Promise<boolean> {
  return permissions.contains({ origins: [...OPTIONAL_BACKEND_PERMISSIONS] })
}

export async function requestBackendPermission(permissions: PermissionApi): Promise<boolean> {
  return permissions.request({ origins: [...OPTIONAL_BACKEND_PERMISSIONS] })
}

export async function checkBackendHealth(fetcher: typeof fetch = fetch): Promise<{ ok: boolean; origin?: string; error?: string }> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    for (const origin of BACKEND_ORIGINS) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3000)
      try {
        const response = await fetcher(`${origin}/health`, { signal: controller.signal })
        if (response.ok) return { ok: true, origin }
      } catch (error) {
        if (attempt === 1 && origin === BACKEND_ORIGINS.at(-1)) {
          return { ok: false, error: error instanceof Error ? error.message : 'FAMS 后端不可用' }
        }
      } finally {
        clearTimeout(timeout)
      }
    }
  }
  return { ok: false, error: 'FAMS 后端健康检查失败' }
}
