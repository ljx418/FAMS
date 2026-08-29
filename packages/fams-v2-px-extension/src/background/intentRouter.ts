import type { IntentRoute, RouteIntent } from '../contracts/types'
import { sha256Hex } from '../contracts/stableJson'

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
  })
  const selectedRef = selectedReference(route.routeIntent, payload)
  if (selectedRef) params.set('ref', selectedRef)
  return `/workspace.html?${params.toString()}`
}

function canonicalRouteIdentity(route: IntentRoute): Record<string, string> {
  const payload = route.routePayload as Record<string, unknown>
  const identity: Record<string, string> = {
    workspaceId: String(payload.workspaceId),
    routeIntent: route.routeIntent,
    targetContainer: route.targetContainer,
  }
  if (typeof payload.sourceRef === 'string') identity.sourceRef = payload.sourceRef
  if (route.routeIntent === 'trace' && typeof payload.operationId === 'string') identity.operationId = payload.operationId
  if (route.routeIntent === 'graph' && typeof payload.graphId === 'string') {
    identity.graphScope = String(payload.graphScope)
    if (payload.graphScope === 'daily-review') identity.reviewId = payload.graphId
    else identity.operationId = payload.graphId
  }
  return identity
}

export function canonicalRouteKey(route: IntentRoute): Promise<string> {
  return sha256Hex(canonicalRouteIdentity(route))
}

function selectedReference(intent: RouteIntent, payload: Record<string, unknown>): string | undefined {
  if (intent === 'source_detail') return typeof payload.sourceRef === 'string' ? payload.sourceRef : undefined
  if (intent === 'trace') return typeof payload.operationId === 'string' ? payload.operationId : undefined
  if (intent === 'graph') return typeof payload.graphId === 'string' ? payload.graphId : undefined
  if (intent === 'ask') return typeof payload.conversationId === 'string' ? payload.conversationId : undefined
  return undefined
}

export async function resolveIntentRoute(route: IntentRoute): Promise<RouteResolution> {
  const workspaceId = String((route.routePayload as Record<string, unknown>).workspaceId)
  return {
    targetContainer: route.targetContainer,
    canonicalKey: await canonicalRouteKey(route),
    workspaceUrlPath: buildWorkspacePath(route),
  }
}
