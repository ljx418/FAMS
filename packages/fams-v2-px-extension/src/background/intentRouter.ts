import type { IntentRoute, RouteIntent } from '../contracts/types'

export type RouteResolution = {
  targetContainer: 'sidepanel' | 'workspace_page'
  canonicalKey: string
  workspaceUrlPath: string
}

export function canonicalWorkspaceKey(workspaceId: string): string {
  return `workspace:${encodeURIComponent(workspaceId)}`
}

export function buildWorkspacePath(route: IntentRoute): `/workspace.html?${string}` {
  const payload = route.routePayload as Record<string, unknown>
  const params = new URLSearchParams({
    workspaceId: String(payload.workspaceId),
    view: route.routeIntent,
    routeId: route.routeId,
    correlationId: route.correlationId,
  })
  const selectedRef = selectedReference(route.routeIntent, payload)
  if (selectedRef) params.set('ref', selectedRef)
  return `/workspace.html?${params.toString()}`
}

function selectedReference(intent: RouteIntent, payload: Record<string, unknown>): string | undefined {
  if (intent === 'source_detail') return typeof payload.sourceRef === 'string' ? payload.sourceRef : undefined
  if (intent === 'trace') return typeof payload.operationId === 'string' ? payload.operationId : undefined
  if (intent === 'graph') return typeof payload.graphId === 'string' ? payload.graphId : undefined
  if (intent === 'ask') return typeof payload.conversationId === 'string' ? payload.conversationId : undefined
  return undefined
}

export function resolveIntentRoute(route: IntentRoute): RouteResolution {
  const workspaceId = String((route.routePayload as Record<string, unknown>).workspaceId)
  return {
    targetContainer: route.targetContainer,
    canonicalKey: canonicalWorkspaceKey(workspaceId),
    workspaceUrlPath: buildWorkspacePath(route),
  }
}
