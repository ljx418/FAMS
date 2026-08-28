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
  tradingBoundaryLocked: true,
}, null, 2))
