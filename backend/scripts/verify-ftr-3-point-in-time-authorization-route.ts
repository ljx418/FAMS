import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { formalReleaseRoutes } from '../src/routes/formalRelease.js'
import { formalDataProviderService } from '../src/services/formal-release/formalDataProviderService.js'
import { formalReviewerAuthService } from '../src/services/formal-release/formalReviewerAuth.js'
import { POINT_IN_TIME_ENDPOINT_ALLOWLIST } from '../src/services/formal-release/pointInTimeDataProviderService.js'

async function main() {
  const app = Fastify({ logger: false })
  const authService = formalReviewerAuthService as any
  const dataService = formalDataProviderService as any
  const originalAuthenticate = authService.authenticateRequest
  const originalAppend = dataService.appendAuthorization
  const sourceSnapshotHash = 'a'.repeat(64)
  const payload = {
    providerId: 'tushare_pro',
    providerClass: 'authorized_commercial',
    decision: 'approved',
    authorizationRef: 'contract-test-only',
    authorizationBasis: 'commercial_license',
    usageScope: 'licensed_scope',
    authorizedScopes: ['historical_point_in_time_research_validation'],
    evidenceRefs: ['contract-test-evidence'],
    sourceTerms: [{
      sourceId: 'tushare-license',
      title: 'Contract test evidence',
      url: 'https://example.invalid/contract-test',
      fetchedAt: '2026-09-14T00:00:00.000Z',
      contentHash: sourceSnapshotHash,
      reviewStatus: 'reviewed_for_commercial_use',
    }],
    endpointAllowlist: [...POINT_IN_TIME_ENDPOINT_ALLOWLIST],
    sourceSnapshotHash,
    credentialRequired: true,
  }

  let requiredRole: string | undefined
  let appendedInput: Record<string, unknown> | null = null

  try {
    authService.authenticateRequest = async (_request: unknown, role?: string) => {
      requiredRole = role
      return { userId: 'contract-reviewer', email: 'data-reviewer@example.invalid', roles: ['data'], authSource: 'jwt_reviewer_roster' }
    }
    dataService.appendAuthorization = async (input: Record<string, unknown>) => {
      appendedInput = input
      return { id: 'contract-test-record', ...input }
    }

    await app.register(formalReleaseRoutes, { prefix: '/api/v1/formal-release' })
    await app.ready()

    const accepted = await app.inject({
      method: 'POST',
      url: '/api/v1/formal-release/providers/authorizations',
      payload,
    })
    assert.equal(accepted.statusCode, 201, accepted.body)
    assert.equal(requiredRole, 'data')
    assert.ok(appendedInput)
    const captured = appendedInput as Record<string, unknown>
    assert.equal(captured.authorizationBasis, payload.authorizationBasis)
    assert.equal(captured.usageScope, payload.usageScope)
    assert.deepEqual(captured.endpointAllowlist, payload.endpointAllowlist)
    assert.equal(captured.sourceSnapshotHash, payload.sourceSnapshotHash)
    assert.equal(captured.credentialRequired, true)
    assert.equal(captured.reviewerUserId, 'contract-reviewer')
    assert.equal(captured.reviewerEmail, 'data-reviewer@example.invalid')
    const acceptedBody = accepted.json()
    assert.equal(acceptedBody.credentialPersisted, false)
    assert.equal(acceptedBody.formalTradingUnlocked, false)
    assert.equal(acceptedBody.orderCreateAllowed, false)
    assert.equal(JSON.stringify(acceptedBody).includes('TUSHARE_TOKEN'), false)

    appendedInput = null
    authService.authenticateRequest = async () => {
      throw Object.assign(new Error('formal_release_reviewer_role_required:data'), { statusCode: 403 })
    }
    const rejected = await app.inject({
      method: 'POST',
      url: '/api/v1/formal-release/providers/authorizations',
      payload,
    })
    assert.equal(rejected.statusCode, 403, rejected.body)
    assert.equal(appendedInput, null)

    console.log(JSON.stringify({
      schemaVersion: 'fams.ftr_3.point_in_time_authorization_route_verification.v1',
      status: 'passed',
      authorizationHttpPayloadToServicePassed: true,
      authorizationRouteRequiresDataReviewer: true,
      unauthorizedHttpRequestRejected: true,
      databaseWritePerformed: false,
      credentialPersisted: false,
      formalTradingUnlocked: false,
      orderCreateAllowed: false,
    }, null, 2))
  } finally {
    authService.authenticateRequest = originalAuthenticate
    dataService.appendAuthorization = originalAppend
    await app.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
