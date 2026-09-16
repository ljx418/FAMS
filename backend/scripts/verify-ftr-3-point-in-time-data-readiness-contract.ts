import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const dates = ['2025-12-12', '2026-01-20', '2026-03-03', '2026-04-08', '2026-05-15', '2026-06-22']

async function main() {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), '..', 'docs', 'contracts', 'ftr-3-point-in-time-data-readiness.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const hash = 'a'.repeat(64)
  const points = dates.map((decisionDate, index) => ({
    windowId: `wf-0${index + 1}`, decisionDate, referenceUniverseCount: 5000, minimumRequiredSymbols: 4000,
    marketBarSymbolCount: 4800, marketBarCoveragePercent: 96, tradeabilitySymbolCount: 4900, tradeabilityCoveragePercent: 98,
    candidateSnapshotSymbolCount: 4500, candidateSnapshotCoveragePercent: 90,
    historicalSecurityStatusSymbolCount: 4700, historicalSecurityStatusCoveragePercent: 94,
    failedStatusShardCount: 80, statusPriceConflictCount: 3,
    historicalStatusEvidenceMode: 'baostock_direct_daily', historicalStatusProxyAllowed: false,
    announcementAwareFundamentalSymbolCount: 4600, announcementAwareFundamentalCoveragePercent: 92,
    pointInTimeCandidateSnapshotPresent: true, announcementCutoffVerified: true, pointInTimeSelectionReady: true,
    snapshotPath: `/tmp/${decisionDate}.json`, snapshotSha256: hash, blockers: [],
  }))
  const fixture: any = {
    schemaVersion: 'fams.ftr_3r.point_in_time_data_readiness.v3', stageId: 'FTR-3R0', candidateId: 'dividend_low_vol_basket', generatedAt: '2026-09-14T16:00:00.000Z', dataRoute: 'qualified_free_source_point_in_time',
    sourceFtr3Artifact: { path: '/tmp/ftr3.json', sha256: hash }, sourcePointInTimeArtifact: { path: '/tmp/free.json', sha256: hash },
    referenceUniverse: { path: '/tmp/basic.json', provider: 'baostock_stock_basic_lifecycle', fetchedAt: '2026-09-14T15:00:00.000Z', symbolCount: 5556, sha256: hash, historicalMembershipClaimed: true },
    requirements: { decisionPointCount: 6, minimumCoveragePercent: 80, announcementCutoffRequired: true, historicalSecurityStatusRequired: true, historicalStatusEvidenceMode: 'baostock_direct_daily', historicalStatusProxyAllowed: false, qualifiedPointInTimeProviderRequired: true },
    decisionPoints: points,
    summary: { readyDecisionPointCount: 6, decisionPointCount: 6, allDecisionPointsReady: true, paidFormalProviderConfigured: false, qualifiedPointInTimeProviderReady: true, availableCandidateSnapshotDates: 6, candidateSnapshotFirstDate: dates[0], candidateSnapshotLastDate: dates.at(-1), ftr3CandidateRedesignAllowed: true, ftr4EntryAllowed: false },
    lookAheadGuard: { currentSnapshotHistoricalReuseDetected: false, futureAnnouncementReuseDetected: false, survivorshipBiasResolved: true, currentUniverseUsedAsHistoricalMembership: false, historicalSecurityStatusProxyUsed: false },
    accountFactsUnchanged: true, realDataUsed: true, status: 'passed', blockers: [], prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'], formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors))
  const negatives = [
    { name: 'low_coverage_passed', mutate: (value: any) => { value.decisionPoints[0].announcementAwareFundamentalCoveragePercent = 79.9 } },
    { name: 'ready_count_drift', mutate: (value: any) => { value.summary.readyDecisionPointCount = 5 } },
    { name: 'current_universe_reuse', mutate: (value: any) => { value.lookAheadGuard.currentUniverseUsedAsHistoricalMembership = true } },
    { name: 'survivorship_unresolved', mutate: (value: any) => { value.lookAheadGuard.survivorshipBiasResolved = false } },
    { name: 'historical_status_proxy', mutate: (value: any) => { value.lookAheadGuard.historicalSecurityStatusProxyUsed = true } },
    { name: 'trading_unlocked', mutate: (value: any) => { value.formalTradingUnlocked = true } },
    { name: 'paid_provider_required', mutate: (value: any) => { value.requirements.qualifiedPointInTimeProviderRequired = false } },
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
