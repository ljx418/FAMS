import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default

async function main() {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), '..', 'docs', 'contracts', 'ftr-3-free-source-batch-probe.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const hash = 'a'.repeat(64)
  const fixture: any = {
    schemaVersion: 'fams.ftr_3r.free_source_batch_probe.v1', stageId: 'FTR-3R0B-FREE', generatedAt: '2026-09-14T14:00:00.000Z', decisionDate: '2025-12-12',
    decisionDates: ['2025-12-12', '2026-01-20', '2026-03-03', '2026-04-08', '2026-05-15', '2026-06-22'],
    mode: 'single_point_bulk_feasibility_with_price_throughput_sample', sourcePolicy: 'baostock_metadata_akshare_bulk_reports_akshare_tencent_prices',
    referenceUniverse: { path: '/tmp/reference.json', symbolCount: 5358, sha256: hash, minimumCoveragePercent: 80 },
    evidenceFiles: ['baostock_bulk', 'akshare_bulk', 'akshare_tencent_price_sample'].map((provider) => ({ provider, path: `/tmp/${provider}.json`, sha256: hash, exists: true })),
    providerSummary: {
      baostockVersion: '0.9.1', akshareVersion: '1.18.60', baostockBulkStatus: 'passed', akshareBulkStatus: 'passed', akshareTencentPriceStatus: 'passed',
      historicalUniverseCount: 5300, tradeStatusSymbolCount: 5200, industrySymbolCount: 5100, performanceSymbolCount: 5100, incomeSymbolCount: 5100,
      cashflowSymbolCount: 5100, balanceSymbolCount: 5100, derivedCapitalSymbolCount: 5000, dividendPositiveEventSymbolCount: 4000, threeYearDividendEventSymbolCount: 2500,
    },
    coverage: { historicalUniversePercent: 98, historicalTradeStatusPercent: 98, historicalIndustryPercent: 96, performancePercent: 96, incomePercent: 96, cashflowPercent: 96, balancePercent: 96, derivedCapitalPercent: 94, dividendPositiveEventPercent: 75 },
    dividendEvidence: { reportPeriods: ['20241231', '20231231', '20221231'], reportPeriodSnapshotsComplete: true, positiveEventCoveragePercent: 75, missingRowTreatedAsConfirmedNoDividend: false, negativeFactContractRequiredBeforeFullBackfill: true },
    priceThroughput: { provider: 'akshare_stock_zh_a_hist_tx', adjustment: 'none', sampleSymbolCount: 30, passedSymbolCount: 30, minimumRowsPerSymbol: 250, priceRowsHaveRequiredFields: true, elapsedMs: 45000, averageRequestMs: 1500, projectedSequentialHours: 2.2, maximumProjectedSequentialHours: 4, fullMarketCoverageClaimed: false, resumableShardingRequired: true },
    derivationPolicy: { historicalUniverseFromListingLifecycle: true, futureAnnouncementReuseDetected: false, currentUniverseUsedAsHistoricalMembership: false, turnoverAmountFormula: 'close*amount_hands*100', totalSharesFormula: 'shareholder_equity/book_value_per_share', marketCapFormula: 'decision_close*derived_total_shares', derivedFieldsMustCarryEvidenceRefs: true },
    sourceTerms: { usageScope: 'local_personal_noncommercial', sdkLicenseNotTreatedAsDataLicense: true, commercialRedistributionAllowed: false, sourceTermsSnapshotPresent: true, sourceTermsPermitConfiguredUse: true, statements: [{ sourceId: 'akshare', url: 'https://example.test/a', reviewedStatement: 'academic only', reviewStatus: 'reviewed_for_local_personal_noncommercial_use', contentHash: hash }, { sourceId: 'baostock', url: 'https://example.test/b', reviewedStatement: 'free platform', reviewStatus: 'reviewed_for_local_personal_noncommercial_use', contentHash: hash }] },
    summary: { bulkDatasetsPassed: true, coreCoveragePassed: true, dividendSnapshotsComplete: true, announcementCutoffVerified: true, priceThroughputPassed: true, sourceTermsPassed: true, freeSourceBatchFeasibilityPassed: true, freeSourceFullMarketBackfillReady: false, ftr3CandidateRedesignAllowed: false },
    accountFactsUnchanged: true, realDataUsed: true, status: 'passed', blockers: [], prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'], formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  assert.equal(validate(fixture), true, JSON.stringify(validate.errors))
  const negatives = [
    { name: 'trading_unlock', mutate: (value: any) => { value.formalTradingUnlocked = true } },
    { name: 'passed_with_blocker', mutate: (value: any) => { value.blockers = ['hidden'] } },
    { name: 'core_coverage_below_80', mutate: (value: any) => { value.coverage.cashflowPercent = 79.9 } },
    { name: 'price_sample_claims_full_market', mutate: (value: any) => { value.priceThroughput.fullMarketCoverageClaimed = true } },
    { name: 'missing_dividend_row_claimed_negative', mutate: (value: any) => { value.dividendEvidence.missingRowTreatedAsConfirmedNoDividend = true } },
    { name: 'paid_or_commercial_scope', mutate: (value: any) => { value.sourceTerms.usageScope = 'commercial' } },
    { name: 'future_date_drift', mutate: (value: any) => { value.decisionDates[0] = '2025-12-15' } },
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
