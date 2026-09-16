import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const dates = ['2025-12-12', '2026-01-20', '2026-03-03', '2026-04-08', '2026-05-15', '2026-06-22']

async function main() {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), '..', 'docs', 'contracts', 'ftr-3-free-source-full-backfill.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const hash = 'a'.repeat(64)
  const decisionPoints = dates.map((decisionDate, index) => ({
    windowId: `wf-0${index + 1}`, decisionDate, referenceUniverseCount: 5000, minimumRequiredSymbols: 4000,
    historicalUniverseResolved: true, marketBarSymbolCount: 4800, marketBarCoveragePercent: 96,
    tradeabilitySymbolCount: 4900, tradeabilityCoveragePercent: 98,
    historicalSecurityStatusSymbolCount: 4700, historicalSecurityStatusCoveragePercent: 94,
    announcementAwareFundamentalSymbolCount: 4600, announcementAwareFundamentalCoveragePercent: 92,
    candidateEvaluationSnapshotSymbolCount: 4500, candidateEvaluationSnapshotCoveragePercent: 90,
    eligibleResearchCandidateCount: 20, dataInsufficientCandidateCount: 1200, failedPriceShardCount: 100,
    failedStatusShardCount: 80, statusPriceConflictCount: 3,
    historicalStatusEvidenceMode: 'baostock_direct_daily', historicalStatusProxyAllowed: false,
    announcementCutoffVerified: true, currentUniverseUsedAsHistoricalMembership: false,
    futureAnnouncementReuseDetected: false, providerFailuresRemainInDenominator: true,
    pointInTimeSelectionReady: true, snapshotPath: `/tmp/${decisionDate}.json`, snapshotSha256: hash,
    selectedSymbols: ['600887', '600519'], blockers: [],
  }))
  const fixture: any = {
    schemaVersion: 'fams.ftr_3r.free_source_full_backfill.v2', stageId: 'FTR-3R0B-FREE', generatedAt: '2026-09-14T15:00:00.000Z',
    dataRoute: 'qualified_free_source_point_in_time',
    lake: { lakeId: 'ftr3-free-source-v1', path: '/tmp/lake', manifestPath: '/tmp/manifest.json', manifestSha256: hash, fileCount: 5200, allArtifactHashesVerified: true },
    providerPolicy: { paidCredentialRequired: false, historicalMembershipProvider: 'baostock_stock_basic_lifecycle', historicalSecurityStatusProvider: 'baostock_query_history_k_data_plus_isST_tradestatus', priceAndTradeabilityProvider: 'baostock_tradestatus_cross_checked_by_tencent_unadjusted_daily', fundamentalAndDividendProvider: 'akshare_eastmoney_bulk', providerFailuresRemainInDenominator: true, currentSnapshotFallbackAllowed: false, mockDataAllowed: false },
    sourceTermsEvidence: { path: '/tmp/source-terms.json', sha256: hash, usageScope: 'local_personal_noncommercial', sourceTermsPermitConfiguredUse: true, commercialRedistributionAllowed: false, sdkLicenseNotTreatedAsDataLicense: true },
    requirements: { decisionPointCount: 6, minimumCoveragePercent: 80, announcementCutoffRequired: true, historicalSecurityStatusRequired: true, historicalStatusEvidenceMode: 'baostock_direct_daily', historicalStatusProxyAllowed: false, qualifiedPointInTimeProviderRequired: true },
    decisionPoints,
    summary: { readyDecisionPointCount: 6, decisionPointCount: 6, allDecisionPointsReady: true, freeSourceFullMarketBackfillReady: true, qualifiedPointInTimeProviderReady: true, ftr3CandidateRedesignAllowed: true, ftr4EntryAllowed: false },
    antiFalseGreen: { currentUniverseUsedAsHistoricalMembership: false, futureAnnouncementReuseDetected: false, providerFailuresRemovedFromDenominator: false, rawShardOverwriteAllowed: false, mockOrCurrentSnapshotFallbackUsed: false, historicalSecurityStatusProxyUsed: false },
    accountFactsUnchanged: true, realDataUsed: true, status: 'passed', blockers: [], prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors))
  const negatives = [
    { name: 'paid_credential', mutate: (value: any) => { value.providerPolicy.paidCredentialRequired = true } },
    { name: 'commercial_redistribution', mutate: (value: any) => { value.sourceTermsEvidence.commercialRedistributionAllowed = true } },
    { name: 'mock_allowed', mutate: (value: any) => { value.providerPolicy.mockDataAllowed = true } },
    { name: 'failure_removed', mutate: (value: any) => { value.antiFalseGreen.providerFailuresRemovedFromDenominator = true } },
    { name: 'future_announcement', mutate: (value: any) => { value.decisionPoints[0].futureAnnouncementReuseDetected = true } },
    { name: 'current_universe', mutate: (value: any) => { value.decisionPoints[0].currentUniverseUsedAsHistoricalMembership = true } },
    { name: 'status_proxy', mutate: (value: any) => { value.decisionPoints[0].historicalStatusProxyAllowed = true } },
    { name: 'status_proxy_global', mutate: (value: any) => { value.antiFalseGreen.historicalSecurityStatusProxyUsed = true } },
    { name: 'missing_prohibited_action', mutate: (value: any) => { value.prohibitedActions = ['ADD', 'REDUCE', 'ORDER_CREATE'] } },
    { name: 'trading_unlock', mutate: (value: any) => { value.orderCreateAllowed = true } },
    { name: 'wrong_decision_count', mutate: (value: any) => { value.decisionPoints.pop() } },
    { name: 'false_green_ready_count', mutate: (value: any) => { value.summary.readyDecisionPointCount = 5 } },
    { name: 'false_green_low_coverage', mutate: (value: any) => { value.decisionPoints[0].marketBarCoveragePercent = 79.9 } },
  ]
  for (const negative of negatives) {
    const value = structuredClone(fixture)
    negative.mutate(value)
    assert.equal(validate(value), false, `negative_fixture_accepted:${negative.name}`)
  }
  console.log(JSON.stringify({ schemaMetaValidation: 'passed', positiveFixtureCount: 1, rejectedNegativeFixtureCount: negatives.length }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
