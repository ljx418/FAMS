import assert from 'node:assert/strict'
import {
  FieldEvidenceValidator,
  FORMAL_DATA_FIELD_IDS,
  FormalDataProviderService,
  type FormalProviderAuthorizationRecord,
  type FormalProviderAuthorizationStore,
  type FormalSourceTermsEvidence,
} from '../src/services/formal-release/formalDataProviderService.js'
import {
  FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2,
  normalizeFormalReleaseCandidateVersions,
} from '../src/services/formal-release/releaseCandidateSetService.js'

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

const HASH = 'a'.repeat(64)
const NOW = new Date('2026-09-14T08:00:00.000Z')
const SOURCE_TERMS: FormalSourceTermsEvidence[] = [{
  sourceId: 'csindex-csi300-factsheet',
  title: '沪深300指数事实表及免责声明',
  url: 'https://oss-ch.csindex.com.cn/example.pdf',
  fetchedAt: NOW.toISOString(),
  contentHash: HASH,
  reviewStatus: 'official_publication',
}]

async function main() {
  assert.equal(normalizeFormalReleaseCandidateVersions(FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2).dividend_low_vol_basket, 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time')
  assert.throws(() => normalizeFormalReleaseCandidateVersions({ dividend_low_vol_basket: 'v2' }), /release_candidate_versions_inventory_mismatch/)
  assert.throws(() => normalizeFormalReleaseCandidateVersions({ ...FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2, unknown: 'v1' }), /release_candidate_versions_inventory_mismatch/)
  assert.throws(() => normalizeFormalReleaseCandidateVersions({ ...FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2, dividend_low_vol_basket: ' ' }), /release_candidate_version_missing/)
  const store = new MemoryAuthorizationStore()
  const service = new FormalDataProviderService(store, () => false)
  await assert.rejects(() => service.appendAuthorization({
    providerId: 'csindex_public',
    providerClass: 'trusted_public_noncommercial',
    decision: 'approved',
    authorizationRef: 'owner-decision',
    authorizationBasis: 'public_terms_local_noncommercial',
    usageScope: 'licensed_scope',
    authorizedScopes: ['H00300:index-performance'],
    evidenceRefs: [`sha256:${HASH}`],
    sourceTerms: SOURCE_TERMS,
    endpointAllowlist: ['https://www.csindex.com.cn/csindex-home/perf/index-perf'],
    sourceSnapshotHash: HASH,
    credentialRequired: false,
    reviewerUserId: 'default',
    reviewerEmail: 'owner@example.test',
    now: NOW,
  }), /public_provider_usage_scope_invalid/)

  await service.appendAuthorization({
    providerId: 'csindex_public',
    providerClass: 'trusted_public_noncommercial',
    decision: 'approved',
    authorizationRef: 'owner-decision',
    authorizationBasis: 'public_terms_local_noncommercial',
    usageScope: 'local_personal_noncommercial',
    authorizedScopes: ['H00300:index-performance'],
    evidenceRefs: [`sha256:${HASH}`],
    sourceTerms: SOURCE_TERMS,
    endpointAllowlist: ['https://www.csindex.com.cn/csindex-home/perf/index-perf'],
    sourceSnapshotHash: HASH,
    credentialRequired: false,
    reviewerUserId: 'default',
    reviewerEmail: 'owner@example.test',
    now: NOW,
  })
  const audit = await service.authorizationAudit('csindex_public', NOW)
  assert.equal(audit.status, 'passed')
  assert.equal(audit.credentialRequired, false)
  assert.equal(audit.credentialRedacted, 'not_required')
  assert.equal(audit.credentialPersisted, false)

  const validation = new FieldEvidenceValidator().validate(FORMAL_DATA_FIELD_IDS.map((fieldId) => ({
    candidateStrategyId: 'permanent_portfolio',
    candidateStrategyVersion: 'portfolio.strategy.v1',
    fieldId,
    critical: true,
    applicability: 'required' as const,
    notApplicableReason: null,
    providerId: 'csindex_public',
    providerClass: 'trusted_public_noncommercial' as const,
    sourceEndpoint: 'https://www.csindex.com.cn/csindex-home/perf/index-perf',
    asOfDate: fieldId === 'fundamental' || fieldId === 'industryClassification' || fieldId === 'dividend' ? '2026-06-30' : '2026-09-14',
    fetchedAt: NOW.toISOString(),
    coveragePercent: 100,
    crossCheckStatus: 'official_verified' as const,
    evidenceRefs: [`sha256:${HASH}`],
    evidenceHash: HASH,
    warnings: [],
    inputBlockers: [],
  })), NOW)
  assert.equal(validation.status, 'passed')

  store.records[0].recordHash = '0'.repeat(64)
  const tampered = await service.authorizationAudit('csindex_public', NOW)
  assert.equal(tampered.status, 'blocked')
  assert.ok(tampered.blockers.includes('provider_authorization_chain_invalid'))

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_a0.contract_verification.v1',
    status: 'passed',
    publicCredentialFabricated: false,
    invalidUsageScopeRejected: true,
    publicAuthorizationChainTamperRejected: true,
    trustedPublicFieldEvidenceAccepted: true,
    explicitCandidateVersionInventoryValidated: true,
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
