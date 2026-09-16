import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  POINT_IN_TIME_ENDPOINT_ALLOWLIST,
  PointInTimeDataProviderService,
  PointInTimeProviderError,
  dividendPeriodsForDecisionDate,
  evaluatePointInTimeProviderAuthorization,
  reconstructHistoricalUniverse,
  reportingPeriodsForDecisionDate,
  selectEffectiveIndustryMemberships,
  selectLatestAnnouncedRows,
  type PointInTimeTushareClient,
} from '../src/services/formal-release/pointInTimeDataProviderService.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default

async function main() {
  const decisionDate = '20251212'
  const universe = reconstructHistoricalUniverse([
    { ts_code: '000001.SZ', list_date: '19910403', delist_date: null },
    { ts_code: '600001.SH', list_date: '20260101', delist_date: null },
    { ts_code: '600002.SH', list_date: '20000101', delist_date: '20250101' },
    { ts_code: '600003.SH', list_date: '20000101', delist_date: '20260101' },
  ], decisionDate)
  assert.deepEqual(universe.map((row) => row.ts_code), ['000001.SZ', '600003.SH'])

  const financials = selectLatestAnnouncedRows([
    { ts_code: '000001.SZ', end_date: '20250930', report_type: '1', ann_date: '20251020', f_ann_date: '20251021', update_flag: '0', revenue: 1 },
    { ts_code: '000001.SZ', end_date: '20250930', report_type: '1', ann_date: '20251020', f_ann_date: '20251021', update_flag: '1', revenue: 2 },
    { ts_code: '600003.SH', end_date: '20250930', report_type: '1', ann_date: '20260101', revenue: 3 },
  ], decisionDate)
  assert.equal(financials.length, 1)
  assert.equal(financials[0]?.revenue, 2)

  const memberships = selectEffectiveIndustryMemberships([
    { con_code: '000001.SZ', in_date: '20200101', out_date: '', l1_code: '801780' },
    { con_code: '600001.SH', in_date: '20260101', out_date: '', l1_code: '801120' },
    { con_code: '600002.SH', in_date: '20200101', out_date: '20250101', l1_code: '801120' },
  ], decisionDate)
  assert.deepEqual(memberships.map((row) => row.ts_code), ['000001.SZ'])
  assert.deepEqual(reportingPeriodsForDecisionDate(decisionDate), ['20250930', '20250630', '20250331', '20241231', '20240930', '20240630', '20240331'])
  assert.deepEqual(dividendPeriodsForDecisionDate(decisionDate), ['20241231', '20231231', '20221231', '20211231', '20201231'])

  const authorizationFixture = {
    status: 'passed', blockers: [], latestRecord: {
      providerClass: 'authorized_commercial', authorizationBasis: 'commercial_license', usageScope: 'licensed_scope',
      authorizationRef: 'license-review:test', authorizedScopes: ['historical_point_in_time_research_validation'],
      evidenceRefs: ['license:test'],
      sourceTerms: [{ sourceId: 'tushare-license', title: 'Commercial license', url: 'https://example.invalid/license', fetchedAt: '2026-09-14T00:00:00.000Z', contentHash: 'b'.repeat(64), reviewStatus: 'reviewed_for_commercial_use' }],
      endpointAllowlist: [...POINT_IN_TIME_ENDPOINT_ALLOWLIST], sourceSnapshotHash: 'a'.repeat(64),
    },
  }
  assert.equal(evaluatePointInTimeProviderAuthorization(authorizationFixture).passed, true)
  const missingEndpointAuthorization = structuredClone(authorizationFixture)
  missingEndpointAuthorization.latestRecord.endpointAllowlist = ['daily']
  const missingEndpointResult = evaluatePointInTimeProviderAuthorization(missingEndpointAuthorization)
  assert.equal(missingEndpointResult.passed, false)
  assert.equal(missingEndpointResult.missingEndpoints.length, POINT_IN_TIME_ENDPOINT_ALLOWLIST.length - 1)
  const misclassifiedAuthorization = structuredClone(authorizationFixture)
  misclassifiedAuthorization.latestRecord.providerClass = 'official'
  assert.equal(evaluatePointInTimeProviderAuthorization(misclassifiedAuthorization).passed, false)
  const badHashAuthorization = structuredClone(authorizationFixture)
  badHashAuthorization.latestRecord.sourceSnapshotHash = 'not-a-hash'
  assert.equal(evaluatePointInTimeProviderAuthorization(badHashAuthorization).passed, false)
  const nonCommercialTermsAuthorization = structuredClone(authorizationFixture)
  nonCommercialTermsAuthorization.latestRecord.sourceTerms[0].reviewStatus = 'reviewed_for_local_noncommercial_use'
  assert.equal(evaluatePointInTimeProviderAuthorization(nonCommercialTermsAuthorization).passed, false)

  const authorizationRouteSource = await readFile(resolve(process.cwd(), 'src', 'routes', 'formalRelease.ts'), 'utf8')
  assert.match(authorizationRouteSource, /authenticateRequest\(request, 'data'\)/)
  for (const field of [
    'authorizationBasis',
    'usageScope',
    'endpointAllowlist',
    'sourceSnapshotHash',
    'credentialRequired',
  ]) {
    assert.match(authorizationRouteSource, new RegExp(`\\b${field}\\b`), `authorization_route_field_missing:${field}`)
  }
  assert.doesNotMatch(authorizationRouteSource, /FAMS_TUSHARE_TOKEN|TUSHARE_TOKEN/)
  const batchProbeSource = await readFile(resolve(process.cwd(), 'scripts', 'run-ftr-3-point-in-time-batch-probe.ts'), 'utf8')
  assert.doesNotMatch(batchProbeSource, /appendAuthorization|\/providers\/authorizations/)

  const plan = new PointInTimeDataProviderService({ client: { query: async () => [] }, delayMs: 0 }).plan(decisionDate)
  const plannedEndpoints = new Set(plan.map((item) => item.endpoint))
  assert.deepEqual([...plannedEndpoints].sort(), [...POINT_IN_TIME_ENDPOINT_ALLOWLIST].sort())
  assert.equal(plan.filter((item) => item.endpoint === 'stock_basic').length, 3)
  assert.equal(plan.filter((item) => item.endpoint.endsWith('_vip')).every((item) => item.fields.includes('ann_date')), true)
  assert.equal(plan.find((item) => item.endpoint === 'index_member_all')?.fields.includes('in_date'), true)

  const permissionClient: PointInTimeTushareClient = {
    async query() {
      throw new PointInTimeProviderError('permission_denied_fixture', 'provider_permission')
    },
  }
  const blocked = await new PointInTimeDataProviderService({ client: permissionClient, delayMs: 0 }).buildSingleDecisionPoint(decisionDate)
  assert.equal(blocked.liveProviderAttempted, true)
  assert.equal(blocked.providerAuthorizationUsable, false)
  assert.equal(blocked.endpointResults.length, plan.length)
  assert.equal(blocked.endpointResults.every((item) => item.status === 'blocked_permission'), true)
  assert.equal(blocked.blockers.filter((item) => item.startsWith('provider_permission:')).length, plan.length)
  assert.equal(blocked.blockers.includes('historical_universe_empty'), true)

  const schema = JSON.parse(await readFile(resolve(process.cwd(), '..', 'docs', 'contracts', 'ftr-3-point-in-time-batch-probe.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const hash = 'a'.repeat(64)
  const coverage = { coveredCount: 5000, coveragePercent: 95, status: 'passed' }
  const fixture: any = {
    schemaVersion: 'fams.ftr_3r.point_in_time_batch_probe.v1',
    stageId: 'FTR-3R0B', generatedAt: '2026-09-14T13:00:00.000Z', decisionDate: '2025-12-12',
    sourcePolicy: 'tushare_bulk_primary_baostock_akshare_cross_check',
    provider: { providerId: 'tushare_pro', configured: true, apiAuthorizationUsable: true, usageAuthorizationVerified: true, authorizationUsable: true, authorizationBlockers: [], liveProviderAttempted: true, tokenInArtifact: false },
    implementation: {
      pointInTimeBatchAdapterImplemented: true, endpointAllowlistComplete: true, historicalUniverseRulePassed: true,
      announcementCutoffRulePassed: true, financialRevisionDeduplicationPassed: true,
      industryMembershipEffectiveDateRulePassed: true, currentUniverseUsedAsHistoricalMembership: false,
    },
    endpointResults: [{ requestId: 'daily', endpoint: 'daily', domain: 'price', status: 'succeeded', rowCount: 5000, pageCount: 2, dataHash: hash, evidenceRef: '/tmp/raw.json', errorCategory: null }],
    coverage: {
      referenceUniverseCount: 5358, historicalUniverseCount: 5300, minimumCoveragePercent: 80,
      domains: { universe: coverage, price: coverage, dailyBasic: coverage, tradeState: coverage, dividend: coverage, fundamental: coverage, industry: coverage },
    },
    crossCheck: { passed: true, decisionDateMatched: true, realOpenSourceEvidence: true, evidenceRef: '/tmp/cross.json', evidenceSha256: hash },
    evidenceFiles: [{ requestId: 'daily', path: '/tmp/raw.json', sha256: hash, dataHash: hash, exists: true }],
    rawResponseHashesVerified: true, accountFactsUnchanged: true, realDataUsed: true, mockDataUsed: false,
    status: 'passed', blockers: [], prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors))
  const negatives = [
    { name: 'passed_with_low_coverage', mutate: (value: any) => { value.coverage.domains.price = { coveredCount: 10, coveragePercent: 1, status: 'insufficient' } } },
    { name: 'passed_without_real_data', mutate: (value: any) => { value.realDataUsed = false } },
    { name: 'passed_without_usage_authorization', mutate: (value: any) => { value.provider.usageAuthorizationVerified = false; value.provider.authorizationUsable = false } },
    { name: 'passed_without_evidence', mutate: (value: any) => { value.evidenceFiles = [] } },
    { name: 'passed_with_blocker', mutate: (value: any) => { value.blockers = ['hidden_failure'] } },
    { name: 'trading_unlock', mutate: (value: any) => { value.orderCreateAllowed = true } },
    { name: 'missing_prohibited_action', mutate: (value: any) => { value.prohibitedActions = ['ADD', 'REDUCE', 'ORDER_CREATE'] } },
    { name: 'unknown_endpoint', mutate: (value: any) => { value.endpointResults[0].endpoint = 'arbitrary_network' } },
  ]
  for (const negative of negatives) {
    const value = structuredClone(fixture)
    negative.mutate(value)
    assert.equal(validate(value), false, `negative_fixture_accepted:${negative.name}`)
  }
  console.log(JSON.stringify({
    schemaMetaValidation: 'passed',
    deterministicRuleTestsPassed: true,
    endpointAllowlistComplete: true,
    permissionFailurePreserved: true,
    pointInTimeAuthorizationContractPassed: true,
    commercialSourceTermsRequired: true,
    nonCommercialSourceTermsRejected: true,
    authorizationRouteContractPassed: true,
    tokenPersisted: false,
    automationCreatesApprovedAuthorization: false,
    positiveFixtureCount: 1,
    rejectedNegativeFixtureCount: negatives.length,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
