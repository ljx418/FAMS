import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default

async function main() {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), '..', 'docs', 'contracts', 'ftr-3-open-source-provider-probe.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const hash = 'a'.repeat(64)
  const fixture: any = {
    schemaVersion: 'fams.ftr_3r.open_source_provider_probe.v1', stageId: 'FTR-3R0A', generatedAt: '2026-09-14T12:00:00.000Z', decisionDate: '2025-12-12',
    mode: 'full_market_single_decision_point_probe', sourcePolicy: 'baostock_primary_akshare_cross_check_official_disclosure_evidence',
    referenceUniverse: { path: '/tmp/reference.json', symbolCount: 5358, sha256: hash, minimumCoveragePercent: 80, minimumRequiredSymbols: 4287 },
    evidenceFiles: [
      { provider: 'baostock_universe', path: '/tmp/u.json', sha256: hash, exists: true },
      { provider: 'baostock_samples', path: '/tmp/s.json', sha256: hash, exists: true },
      { provider: 'akshare_dividend', path: '/tmp/a.json', sha256: hash, exists: true },
    ],
    providerProbes: {
      baostock: { version: '00.9.10', liveCall: true, universeStatus: 'passed', universeSymbolCount: 5200, universeCoveragePercent: 97, universeElapsedMs: 1000, historyTradeStateFieldsPresent: true, announcementAwareFundamentalFieldsPresent: true, dividendAnnouncementFieldsPresent: true, listingLifecycleFieldsPresent: true, historicalIndustryFieldsPresent: true, sampleSymbolCount: 3 },
      akshare: { version: '1.18.60', liveCall: true, status: 'passed', rowCount: 30, dividendAnnouncementFieldsPresent: true },
      tushare: { configured: false, tokenInArtifact: false, currentAdapterSingleSymbolOnly: false, currentAdapterAnnouncementFieldsMissing: false, currentAdapterIndustryMembershipMissing: false, currentAdapterHistoricalStatusEndpointsMissing: false },
    },
    sourceTerms: { usageScope: 'local_personal_noncommercial', sdkLicenseNotTreatedAsDataLicense: true, reviewStatus: 'reviewable', references: ['https://www.baostock.com/', 'https://akshare.akfamily.xyz/'] },
    adapterGapAssessment: { batchImplementationReady: true, historicalUniverseAdapterReady: true, announcementCutoffAdapterReady: true, historicalIndustryMembershipAdapterReady: true, historicalTradeStateAdapterReady: true, recommendedPrimaryMode: 'open_source_only' },
    summary: { historicalUniverseProbePassed: true, historicalTradeStateProbePassed: true, announcementAwareFundamentalProbePassed: true, dividendAnnouncementProbePassed: true, historicalIndustryProbePassed: true, akshareDividendCrossCheckPassed: true, fullMarketBackfillReady: true, ftr3r0bEntryAllowed: true },
    accountFactsUnchanged: true, realDataUsed: true, status: 'passed', blockers: [], prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'], formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors))
  const negatives = [
    { name: 'trading_unlock', mutate: (value: any) => { value.formalTradingUnlocked = true } },
    { name: 'passed_with_blocker', mutate: (value: any) => { value.blockers = ['hidden'] } },
    { name: 'passed_without_batch_adapter', mutate: (value: any) => { value.adapterGapAssessment.batchImplementationReady = false } },
    { name: 'missing_prohibited_action', mutate: (value: any) => { value.prohibitedActions = ['ADD', 'REDUCE', 'ORDER_CREATE'] } },
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
