import assert from 'node:assert/strict'
import { externalBrainPolicyService } from '../src/services/external-brain/externalBrainPolicyService.js'

const priorIds = process.env.FAMS_V2_PX_EXTENSION_IDS
const allowedId = 'abcdefghijklmnopabcdefghijklmnop'

delete process.env.FAMS_V2_PX_EXTENSION_IDS
assert.deepEqual(externalBrainPolicyService.configuredExtensionIds(), [])
assert.equal(externalBrainPolicyService.isExternalBrainOriginAllowed(`chrome-extension://${allowedId}`), false)

process.env.FAMS_V2_PX_EXTENSION_IDS = allowedId
assert.equal(externalBrainPolicyService.isExternalBrainOriginAllowed(`chrome-extension://${allowedId}`), true)
assert.equal(externalBrainPolicyService.isExternalBrainOriginAllowed('http://localhost:3000'), false)
assert.equal(externalBrainPolicyService.isExternalBrainOriginAllowed('chrome-extension://pppppppppppppppppppppppppppppppp'), false)

const callerMatrix = [
  { name: 'missing-origin-valid-header', origin: undefined, header: allowedId, allowed: true, disposition: 'allowed' },
  { name: 'matching-extension-origin', origin: `chrome-extension://${allowedId}`, header: allowedId, allowed: true, disposition: 'allowed' },
  { name: 'missing-header', origin: undefined, header: undefined, allowed: false, disposition: 'extension_caller_blocked' },
  { name: 'malformed-header', origin: undefined, header: 'not-an-extension', allowed: false, disposition: 'extension_caller_blocked' },
  { name: 'unconfigured-header', origin: undefined, header: 'pppppppppppppppppppppppppppppppp', allowed: false, disposition: 'extension_caller_blocked' },
  { name: 'web-origin-spoof', origin: 'http://localhost:3000', header: allowedId, allowed: false, disposition: 'origin_blocked' },
  { name: 'wrong-extension-origin', origin: 'chrome-extension://pppppppppppppppppppppppppppppppp', header: allowedId, allowed: false, disposition: 'origin_blocked' },
  { name: 'origin-header-mismatch', origin: `chrome-extension://${allowedId}`, header: 'pppppppppppppppppppppppppppppppp', allowed: false, disposition: 'extension_caller_blocked' },
] as const
for (const item of callerMatrix) {
  const decision = externalBrainPolicyService.inspectExternalBrainCaller(item.origin, item.header)
  assert.equal(decision.allowed, item.allowed, item.name)
  assert.equal(decision.disposition, item.disposition, item.name)
}

const missingPermission = externalBrainPolicyService.inspectAskResult({})
assert.equal(missingPermission.disposition, 'blocked')
assert.ok(missingPermission.reasons.includes('permission_type_missing'))

const directRead = externalBrainPolicyService.inspectAskResult({ toolAudit: { permissionType: 'read_only_direct' } })
assert.equal(directRead.disposition, 'allowed')

const confirmation = externalBrainPolicyService.inspectAskResult({
  requiresConfirmation: true,
  toolAudit: { permissionType: 'confirm_before_operation' },
})
assert.equal(confirmation.disposition, 'blocked')
assert.ok(confirmation.reasons.includes('confirmation_required_but_external_brain_cannot_confirm'))

const permanent = externalBrainPolicyService.inspectAskResult({ toolAudit: { permissionType: 'permanently_blocked' } })
assert.equal(permanent.disposition, 'hard_fail')

const actionLeak = externalBrainPolicyService.inspectAskResult({
  toolAudit: { permissionType: 'compute_quick_run' },
  allowedActions: ['ORDER_CREATE'],
})
assert.equal(actionLeak.disposition, 'blocked')
assert.deepEqual(externalBrainPolicyService.boundary(), {
  researchOnly: true,
  formalTradingUnlocked: false,
  autoTradeUnlocked: false,
  canCreateOrder: false,
  orderCreateAllowed: false,
})

if (priorIds === undefined) delete process.env.FAMS_V2_PX_EXTENSION_IDS
else process.env.FAMS_V2_PX_EXTENSION_IDS = priorIds

console.log(JSON.stringify({
  status: 'passed',
  missingPermissionFailClosed: true,
  confirmationBlocked: true,
  permanentHardFail: true,
  prohibitedActionLeakBlocked: true,
  callerIdentityMatrixPassed: true,
  tradingBoundaryLocked: true,
}, null, 2))
