import type { FastifyRequest } from 'fastify'
import {
  EXTERNAL_BRAIN_ALLOWED_ACTIONS,
  EXTERNAL_BRAIN_PROHIBITED_ACTIONS,
  LOCKED_EXECUTION_BOUNDARY,
} from './externalBrainTypes.js'

const WEB_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000'])
const READ_PERMISSIONS = new Set(['read_only_direct', 'compute_quick_run'])
const EXTENSION_ID_PATTERN = /^[a-p]{32}$/

function configuredValues(name: string): string[] {
  return String(process.env[name] || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

function extensionIdFromOrigin(origin: string): string | null {
  const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin)
  return match?.[1] || null
}

export type ExternalBrainCallerDecision = {
  allowed: boolean
  disposition: 'allowed' | 'extension_caller_blocked' | 'origin_blocked'
  extensionId?: string
}

class ExternalBrainPolicyService {
  configuredExtensionIds(): string[] {
    return configuredValues('FAMS_V2_PX_EXTENSION_IDS').filter((value) => EXTENSION_ID_PATTERN.test(value))
  }

  isExternalBrainOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return false
    const extensionId = extensionIdFromOrigin(origin)
    return Boolean(extensionId && this.configuredExtensionIds().includes(extensionId))
  }

  isCorsOriginAllowed(origin: string | undefined): boolean {
    if (!origin) return true
    const extraWebOrigins = new Set(configuredValues('FAMS_CORS_ORIGINS'))
    return WEB_ORIGINS.has(origin)
      || extraWebOrigins.has(origin)
      || this.isExternalBrainOriginAllowed(origin)
  }

  inspectExternalBrainCaller(origin: string | undefined, extensionIdHeader: string | string[] | undefined): ExternalBrainCallerDecision {
    if (typeof extensionIdHeader !== 'string' || !EXTENSION_ID_PATTERN.test(extensionIdHeader)) {
      return { allowed: false, disposition: 'extension_caller_blocked' }
    }
    if (!this.configuredExtensionIds().includes(extensionIdHeader)) {
      return { allowed: false, disposition: 'extension_caller_blocked' }
    }
    if (origin === undefined) {
      return { allowed: true, disposition: 'allowed', extensionId: extensionIdHeader }
    }
    const originExtensionId = extensionIdFromOrigin(origin)
    if (!originExtensionId || originExtensionId !== extensionIdHeader) {
      return { allowed: false, disposition: 'origin_blocked' }
    }
    return { allowed: true, disposition: 'allowed', extensionId: extensionIdHeader }
  }

  requestContainsUserId(request: FastifyRequest): boolean {
    const query = request.query as Record<string, unknown> | undefined
    const body = request.body as Record<string, unknown> | undefined
    return Object.prototype.hasOwnProperty.call(query || {}, 'userId')
      || Object.prototype.hasOwnProperty.call(body || {}, 'userId')
  }

  inspectAskResult(response: {
    requiresConfirmation?: boolean
    toolAudit?: Record<string, unknown>
    prohibitedActions?: string[]
    allowedActions?: string[]
  }): { allowed: boolean; disposition: 'allowed' | 'blocked' | 'hard_fail'; reasons: string[] } {
    const reasons: string[] = []
    const permissionType = typeof response.toolAudit?.permissionType === 'string'
      ? response.toolAudit.permissionType
      : null
    if (!permissionType) reasons.push('permission_type_missing')
    else if (!READ_PERMISSIONS.has(permissionType)) reasons.push(`permission_not_allowed:${permissionType}`)
    if (response.requiresConfirmation === true) reasons.push('confirmation_required_but_external_brain_cannot_confirm')
    const allowedActions = Array.isArray(response.allowedActions) ? response.allowedActions : []
    const forbiddenAllowedActions = allowedActions.filter((action) => (
      EXTERNAL_BRAIN_PROHIBITED_ACTIONS.includes(action as typeof EXTERNAL_BRAIN_PROHIBITED_ACTIONS[number])
    ))
    if (forbiddenAllowedActions.length > 0) reasons.push('prohibited_action_exposed_as_allowed')
    const disposition = permissionType === 'permanently_blocked'
      ? 'hard_fail'
      : reasons.length > 0 ? 'blocked' : 'allowed'
    return { allowed: disposition === 'allowed', disposition, reasons }
  }

  boundary() {
    return LOCKED_EXECUTION_BOUNDARY
  }

  allowedActions() {
    return EXTERNAL_BRAIN_ALLOWED_ACTIONS
  }

  prohibitedActions() {
    return EXTERNAL_BRAIN_PROHIBITED_ACTIONS
  }
}

export const externalBrainPolicyService = new ExternalBrainPolicyService()
