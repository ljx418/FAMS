import assert from 'node:assert/strict'
import { FORMAL_DATA_FIELD_IDS, FormalDataProviderService, type FormalFieldEvidence, type FormalProviderAuthorizationRecord, type FormalProviderAuthorizationStore } from '../src/services/formal-release/formalDataProviderService.js'

class MemoryAuthorizationStore implements FormalProviderAuthorizationStore {
  records: FormalProviderAuthorizationRecord[] = []

  async list(providerId: string) {
    return this.records.filter((record) => record.providerId === providerId).sort((left, right) => left.sequence - right.sequence)
  }

  async create(record: Omit<FormalProviderAuthorizationRecord, 'id'>) {
    const created = { ...record, id: `auth-${record.sequence}` }
    this.records.push(created)
    return created
  }
}

function evidence(asOfDate: string): FormalFieldEvidence[] {
  return FORMAL_DATA_FIELD_IDS.map((fieldId) => ({
    candidateStrategyId: 'dividend_low_vol_leader_v1',
    candidateStrategyVersion: '1.0.0',
    fieldId,
    critical: true,
    applicability: 'required',
    notApplicableReason: null,
    providerId: 'tushare_pro',
    providerClass: 'authorized_commercial',
    sourceEndpoint: `pro.${fieldId}`,
    asOfDate,
    fetchedAt: '2026-08-20T01:00:00.000Z',
    coveragePercent: 100,
    crossCheckStatus: 'official_verified',
    evidenceRefs: [`tushare:${fieldId}:20260820`],
    evidenceHash: 'a'.repeat(64),
    warnings: [],
    inputBlockers: [],
  }))
}

async function main() {
  const now = new Date('2026-08-20T02:00:00.000Z')
  const emptyStore = new MemoryAuthorizationStore()
  const blockedService = new FormalDataProviderService(emptyStore, () => false)
  const blockedAuthorization = await blockedService.authorizationAudit('tushare_pro', now)
  assert.equal(blockedAuthorization.status, 'blocked')
  assert.ok(blockedAuthorization.blockers.includes('provider_authorization_missing'))
  assert.ok(blockedAuthorization.blockers.includes('formal_provider_credential_missing'))
  assert.equal(blockedAuthorization.credentialPersisted, false)

  const store = new MemoryAuthorizationStore()
  const service = new FormalDataProviderService(store, () => true)
  const authorization = await service.appendAuthorization({
    providerId: 'tushare_pro',
    providerClass: 'authorized_commercial',
    decision: 'approved',
    authorizationRef: 'license-review:FTR-1:test-only',
    authorizationBasis: 'commercial_license',
    usageScope: 'licensed_scope',
    authorizedScopes: ['daily', 'financial', 'dividend', 'tradeability'],
    evidenceRefs: ['review:test-only'],
    sourceTerms: [{
      sourceId: 'tushare-license-test',
      title: 'Commercial license test evidence',
      url: 'https://example.invalid/tushare-license-test',
      fetchedAt: '2026-08-20T00:00:00.000Z',
      contentHash: 'b'.repeat(64),
      reviewStatus: 'reviewed_for_commercial_use',
    }],
    endpointAllowlist: ['daily', 'financial', 'dividend', 'tradeability'],
    sourceSnapshotHash: 'c'.repeat(64),
    credentialRequired: true,
    reviewerUserId: 'reviewer-1',
    reviewerEmail: 'data.reviewer@example.test',
    effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
    expiresAt: new Date('2027-08-01T00:00:00.000Z'),
    now,
  })
  assert.equal(JSON.stringify(authorization).includes('token'), false)
  const passedAuthorization = await service.authorizationAudit('tushare_pro', now)
  assert.equal(passedAuthorization.status, 'passed')
  assert.equal(passedAuthorization.chainValid, true)

  const freshSnapshot = await service.buildCandidateSnapshot({
    candidateStrategyId: 'dividend_low_vol_leader_v1',
    candidateStrategyVersion: '1.0.0',
    providerId: 'tushare_pro',
    fields: evidence('2026-08-20'),
    now,
  })
  assert.equal(freshSnapshot.status, 'passed')
  assert.equal(freshSnapshot.formalDataGovernancePassed, true)
  assert.equal(freshSnapshot.researchFallbackPromotedToFormal, false)
  assert.match(freshSnapshot.snapshotHash, /^[a-f0-9]{64}$/)

  const staleSnapshot = await service.buildCandidateSnapshot({
    candidateStrategyId: 'dividend_low_vol_leader_v1',
    candidateStrategyVersion: '1.0.0',
    providerId: 'tushare_pro',
    fields: evidence('2020-01-01'),
    now,
  })
  assert.equal(staleSnapshot.status, 'blocked')
  assert.equal(staleSnapshot.formalDataGovernancePassed, false)
  assert.ok(staleSnapshot.blockers.includes('required_field_stale'))

  store.records[0].recordHash = '0'.repeat(64)
  const tamperedAudit = await service.authorizationAudit('tushare_pro', now)
  assert.equal(tamperedAudit.status, 'blocked')
  assert.ok(tamperedAudit.blockers.includes('provider_authorization_chain_invalid'))

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_1.formal_data_service_verification.v1',
    status: 'passed',
    engineeringContractPassed: true,
    externalBusinessGateStatus: blockedAuthorization.status,
    negativeFixtures: ['missing_authorization_and_credential', 'stale_critical_fields', 'tampered_authorization_chain'],
    providerAuthorizationAudit: blockedAuthorization,
    fieldEvidenceValidationAudit: staleSnapshot.fieldEvidenceValidation,
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
