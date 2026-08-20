import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import { FormalReviewerAuthService, FORMAL_RELEASE_REVIEWER_ROLES } from '../src/services/formal-release/formalReviewerAuth.js'
import { ManualSignoffService, type FormalReleaseSignoffRecord, type FormalReleaseSignoffStore } from '../src/services/formal-release/manualSignoffService.js'

class MemorySignoffStore implements FormalReleaseSignoffStore {
  records: FormalReleaseSignoffRecord[] = []

  async list(operationId: string) {
    return this.records.filter((record) => record.operationId === operationId).sort((left, right) => left.sequence - right.sequence)
  }

  async create(record: Omit<FormalReleaseSignoffRecord, 'id'>) {
    const created = { ...record, id: `signoff-${record.sequence}` }
    this.records.push(created)
    return created
  }
}

async function main() {
  const secret = 'ftr-test-secret-at-least-local-only'
  const user = { id: 'reviewer-1', email: 'release.reviewer@example.test' }
  const token = jwt.sign({ userId: user.id }, secret, { expiresIn: '1h' })
  const auth = new FormalReviewerAuthService({
    JWT_SECRET: secret,
    FAMS_FTR_REVIEWER_ROSTER_JSON: JSON.stringify([{ email: user.email, roles: [...FORMAL_RELEASE_REVIEWER_ROLES] }]),
  }, async (userId) => userId === user.id ? user : null)
  const reviewer = await auth.authenticateAuthorizationHeader(`Bearer ${token}`, 'data')
  assert.equal(reviewer.userId, user.id)
  assert.deepEqual(reviewer.roles, FORMAL_RELEASE_REVIEWER_ROLES)

  await assert.rejects(
    new FormalReviewerAuthService({}, async () => user).authenticateAuthorizationHeader(`Bearer ${token}`),
    (error: any) => error.statusCode === 503,
  )
  await assert.rejects(
    auth.authenticateAuthorizationHeader('Bearer invalid'),
    (error: any) => error.statusCode === 401,
  )
  await assert.rejects(
    new FormalReviewerAuthService({ JWT_SECRET: secret, FAMS_FTR_REVIEWER_ROSTER_JSON: '[]' }, async () => user)
      .authenticateAuthorizationHeader(`Bearer ${token}`),
    (error: any) => error.statusCode === 403,
  )

  const manifestHash = 'a'.repeat(64)
  const operationId = 'operation-ftr-4-test'
  const earlyStore = new MemorySignoffStore()
  const earlyService = new ManualSignoffService(earlyStore)
  await assert.rejects(earlyService.appendSignoff({
    operationId,
    role: 'final_release',
    decision: 'approved',
    notes: 'too early',
    manifestHash,
    reviewer,
  }), /final_release_prerequisite_signoffs_missing/)

  const store = new MemorySignoffStore()
  const service = new ManualSignoffService(store)
  for (const [index, role] of FORMAL_RELEASE_REVIEWER_ROLES.entries()) {
    await service.appendSignoff({
      operationId,
      role,
      decision: 'approved',
      notes: `reviewed ${role} evidence`,
      manifestHash,
      reviewer,
      now: new Date(`2026-08-20T0${index + 1}:00:00.000Z`),
    })
  }
  const passed = await service.audit(operationId, manifestHash)
  assert.equal(passed.status, 'passed')
  assert.equal(passed.chainValid, true)
  assert.equal(passed.manualSignoffPassed, true)
  assert.equal(passed.recordCount, 5)
  assert.equal(passed.formalTradingUnlocked, false)

  const changedArtifact = await service.audit(operationId, 'b'.repeat(64))
  assert.equal(changedArtifact.manualSignoffPassed, false)
  assert.ok(changedArtifact.blockers.some((blocker) => blocker.includes('artifact_changed')))

  store.records[2].notes = 'tampered notes'
  const tampered = await service.audit(operationId, manifestHash)
  assert.equal(tampered.chainValid, false)
  assert.equal(tampered.manualSignoffPassed, false)
  assert.ok(tampered.blockers.includes('manual_signoff_chain_invalid'))

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_4.manual_signoff_service_verification.v1',
    status: 'passed',
    authSource: reviewer.authSource,
    requiredRoles: FORMAL_RELEASE_REVIEWER_ROLES,
    passingAudit: passed,
    negativeFixtures: ['jwt_secret_missing', 'invalid_bearer', 'reviewer_not_in_roster', 'final_release_before_prerequisites', 'artifact_changed', 'hash_chain_tampered'],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
