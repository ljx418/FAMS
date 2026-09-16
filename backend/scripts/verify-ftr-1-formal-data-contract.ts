import assert from 'node:assert/strict'
import {
  FieldEvidenceValidator,
  FORMAL_DATA_FIELD_IDS,
  type FormalFieldEvidence,
} from '../src/services/formal-release/formalDataProviderService.js'

const NOW = new Date('2026-09-14T08:00:00.000Z')
const HASH = 'a'.repeat(64)

function validFields(): FormalFieldEvidence[] {
  return FORMAL_DATA_FIELD_IDS.map((fieldId) => ({
    candidateStrategyId: 'candidate',
    candidateStrategyVersion: 'candidate.v1',
    fieldId,
    critical: true,
    applicability: 'required',
    notApplicableReason: null,
    providerId: fieldId === 'costModel' ? 'fams_internal' : 'public_market_bundle',
    providerClass: fieldId === 'costModel' ? 'trusted_internal' : 'trusted_public_noncommercial',
    sourceEndpoint: `source:${fieldId}`,
    asOfDate: fieldId === 'dividend' || fieldId === 'fundamental' || fieldId === 'industryClassification' ? '2026-06-30' : '2026-09-11',
    fetchedAt: NOW.toISOString(),
    coveragePercent: 80,
    crossCheckStatus: 'trusted_cross_checked',
    evidenceRefs: [`evidence:${fieldId}`],
    evidenceHash: HASH,
    warnings: [],
    inputBlockers: [],
  }))
}

function main() {
  const validator = new FieldEvidenceValidator()
  assert.equal(validator.validate(validFields(), NOW).status, 'passed')

  const missing = validFields().filter((item) => item.fieldId !== 'tradeability')
  assert.ok(validator.validate(missing, NOW).blockers.includes('required_field_missing:tradeability'))

  const belowCoverage = validFields()
  belowCoverage[0].coveragePercent = 79.99
  assert.ok(validator.validate(belowCoverage, NOW).blockers.includes('required_field_coverage_below_80_percent'))

  const fallback = validFields()
  fallback[1].providerClass = 'research_proxy'
  fallback[1].crossCheckStatus = 'failed'
  const fallbackAudit = validator.validate(fallback, NOW)
  assert.ok(fallbackAudit.blockers.includes('required_field_provider_not_formally_qualified'))
  assert.ok(fallbackAudit.blockers.includes('required_field_cross_check_failed'))

  const stale = validFields()
  stale.find((item) => item.fieldId === 'price')!.asOfDate = '2026-08-01'
  assert.ok(validator.validate(stale, NOW).blockers.includes('required_field_stale'))

  const historical = validFields()
  const historicalTradeability = historical.find((item) => item.fieldId === 'tradeability')!
  historicalTradeability.asOfDate = '2025-12-12'
  historicalTradeability.temporalScope = 'frozen_historical_window'
  historicalTradeability.crossCheckStatus = 'immutable_replay_verified'
  assert.equal(validator.validate(historical, NOW).status, 'passed')

  const unverifiedHistorical = validFields()
  const unverifiedTradeability = unverifiedHistorical.find((item) => item.fieldId === 'tradeability')!
  unverifiedTradeability.asOfDate = '2025-12-12'
  unverifiedTradeability.temporalScope = 'frozen_historical_window'
  assert.ok(validator.validate(unverifiedHistorical, NOW).blockers.includes('required_field_unknown'))

  const explicitNotApplicable = validFields()
  const fundamental = explicitNotApplicable.find((item) => item.fieldId === 'fundamental')!
  fundamental.critical = false
  fundamental.applicability = 'not_applicable'
  fundamental.notApplicableReason = 'fixed component strategy'
  fundamental.crossCheckStatus = 'not_applicable'
  assert.equal(validator.validate(explicitNotApplicable, NOW).status, 'passed')

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_1.formal_data_contract_verification.v1',
    status: 'passed',
    exactFieldSetRequired: true,
    minimumCoveragePercent: 80,
    staleCriticalFieldRejected: true,
    immutableHistoricalReplayAccepted: true,
    unverifiedHistoricalReplayRejected: true,
    researchFallbackRejected: true,
    explicitNotApplicableSupported: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
}

main()
