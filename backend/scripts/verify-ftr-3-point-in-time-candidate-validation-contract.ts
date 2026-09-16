import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const dates = ['2025-12-12', '2026-01-20', '2026-03-03', '2026-04-08', '2026-05-15', '2026-06-22']
const ends = ['2026-03-17', '2026-04-22', '2026-05-29', '2026-07-06', '2026-08-07', '2026-09-11']
const variants = [
  ['baseline_quarterly', 'quarterly', 0.0003, 0.0005],
  ['monthly_rebalance', 'monthly', 0.0003, 0.0005],
  ['fee_plus_20bp', 'quarterly', 0.0023, 0.0005],
  ['slippage_plus_20bp', 'quarterly', 0.0003, 0.0025],
  ['fee_slippage_plus_10bp', 'quarterly', 0.0013, 0.0015],
] as const

function windowFixture(index: number) {
  const symbol = `60000${index + 1}`
  return {
    windowId: `wf-0${index + 1}`,
    decisionDate: dates[index],
    trainingStartDate: '2025-09-01',
    trainingEndDate: '2025-12-11',
    validationStartDate: dates[index],
    validationEndDate: ends[index],
    selectedSymbols: [symbol, `00000${index + 1}`, `30000${index + 1}`],
    selectedComponentCount: 3,
    selectedComponents: [{ symbol, industry: 'industry-a' }, { symbol: `00000${index + 1}`, industry: 'industry-b' }, { symbol: `30000${index + 1}`, industry: 'industry-c' }],
    selectedIndustries: ['industry-a', 'industry-b', 'industry-c'],
    liquidityValues: [{ symbol, medianVolumeHands: 100000, coveredTradingDays: 60, requiredTradingDays: 60, priceCoveragePercent: 100 }],
    sourceSnapshotPath: `/tmp/snapshot-${index}.json`,
    sourceSnapshotSha256: 'a'.repeat(64),
    definitionHash: 'b'.repeat(64),
    parameterSnapshotHash: '9'.repeat(64),
    validationSampleSize: 60,
    requiredTradingDays: 60,
    commonTradingDayCount: 60,
    perSymbolPriceCoverage: [symbol, `00000${index + 1}`, `30000${index + 1}`].map((item) => ({ symbol: item, coveredTradingDays: 60, requiredTradingDays: 60, priceCoveragePercent: 100 })),
    priceCoveragePercent: 100,
    benchmarkCoveragePercent: 100,
    totalReturnPercent: 5,
    benchmarkReturnPercent: 2,
    excessReturnPercent: 3,
    maxDrawdownPercent: -8,
    annualizedTurnoverPercent: 20,
    resultHash: 'c'.repeat(64),
    dataQualityStatus: 'passed',
    status: index < 4 ? 'passed' : 'failed',
    blockers: index < 4 ? [] : ['excess_return_negative'],
  }
}

function fixture() {
  const windows = dates.map((_, index) => windowFixture(index))
  return {
    schemaVersion: 'fams.ftr_3r1.point_in_time_candidate_validation.v1',
    stageId: 'FTR-3R1',
    candidateId: 'dividend_low_vol_basket',
    candidateVersion: 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time',
    generatedAt: '2026-09-15T00:00:00.000Z',
    sourcePointInTimeReadiness: { path: '/tmp/r0.json', sha256: 'd'.repeat(64), readyDecisionPointCount: 6 },
    sourcePointInTimeBackfill: { path: '/tmp/backfill.json', sha256: 'e'.repeat(64) },
    sourceOriginalFtr3: { path: '/tmp/ftr3.json', sha256: 'f'.repeat(64), originalPassedWindowCount: 2, originalPassedRatio: 0.333333 },
    benchmark: { benchmarkId: 'csi300_total_return_h00300', benchmarkType: 'trusted_total_return', path: '/tmp/h00300.json', sha256: '1'.repeat(64), hashMode: 'formal_benchmark_content_hash', changedForPassing: false },
    priceLake: { path: '/tmp/lake', manifestPath: '/tmp/manifest.json', manifestSha256: '2'.repeat(64), symbolCount: 18, completedShardCount: 18, failedShardCount: 0, adjustment: 'qfq', allHashesVerified: true },
    algorithm: { selectionSource: 'same_day_immutable_point_in_time_snapshot', ranking: 'evidenceAdjustedScore_desc_symbol_asc', weightPolicy: 'equal_weight', maxComponents: 10, minimumComponents: 3, feeRate: 0.0003, slippageRate: 0.0005, benchmarkId: 'csi300_total_return_h00300', thresholdReduced: false },
    walkForward: { configuredWindowCount: 6, validWindowCount: 6, passedWindowCount: 4, passedRatio: 0.666667, minimumPassedRatio: 0.6, windows },
    parameterSensitivity: {
      testedParameterSetCount: 5,
      stableParameterSetCount: 5,
      stableParameterSetRatio: 1,
      bestWorstReturnSpreadPercentPoints: 1,
      maxDrawdownSpreadPercentPoints: 1,
      bestWorstReturnSpreadWithinPolicy: true,
      maxDrawdownSpreadWithinPolicy: true,
      status: 'passed',
      variants: variants.map(([variantId, frequency, feeRate, slippageRate]) => ({
        variantId, frequency, feeRate, slippageRate, status: 'completed', validWindowCount: 6,
        passedWindowCount: 4, passedRatio: 0.666667, averageTotalReturnPercent: 4,
        worstMaxDrawdownPercent: -8, inputHash: '3'.repeat(64), resultHash: '4'.repeat(64), windows,
      })),
      cashDividendVariant: { status: 'not_applicable', countedAsTestedParameterSet: false, reason: 'qfq_series_already_represents_reinvested_distribution_effect' },
    },
    groupStability: {
      releaseEffectivePathCount: 30,
      industryGroupCount: 3,
      marketRegimeGroupCount: 3,
      liquidityGroupCount: 3,
      status: 'passed',
      industryGroups: ['industry-a', 'industry-b', 'industry-c'].map((groupId) => ({ groupId, pathIds: ['wf-01:600001'], effectivePathCount: 6, sampleCoveragePercent: 100, inputHash: '5'.repeat(64), resultHash: '6'.repeat(64), status: 'passed' })),
      marketRegimeGroups: ['down', 'neutral', 'up'].map((name, index) => ({ groupId: `market:${name}`, windowIds: [`wf-0${index * 2 + 1}`, `wf-0${index * 2 + 2}`], effectivePathCount: 6, sampleCoveragePercent: 100, inputHash: '5'.repeat(64), resultHash: '6'.repeat(64), status: 'passed' })),
      liquidityGroups: ['low', 'medium', 'high'].map((name) => ({ groupId: `liquidity:${name}`, pathIds: ['wf-01:600001'], sampleCount: 6, effectivePathCount: 6, sampleCoveragePercent: 100, inputHash: '5'.repeat(64), resultHash: '6'.repeat(64), status: 'passed' })),
    },
    antiFalseGreen: { latestCandidateSnapshotBackfillDetected: false, futureCandidateSelectionReuseDetected: false, failedWindowsRemoved: false, benchmarkChangedForPassing: false, thresholdReduced: false, historicalSecurityStatusProxyUsed: false },
    summary: { pointInTimeCandidateV2ValidationPassed: true, candidateV2RefreezeAllowed: true, ftr4EntryAllowed: false },
    accountFactsUnchanged: true,
    realDataUsed: true,
    status: 'passed',
    blockers: [],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
}

async function main() {
  const schema = JSON.parse(await readFile(resolve(process.cwd(), '..', 'docs', 'contracts', 'ftr-3-point-in-time-candidate-validation.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const positive = fixture()
  assert.equal(validate(positive), true, JSON.stringify(validate.errors))
  const negatives = [
    { name: 'candidate_v1_reused', mutate: (value: any) => { value.candidateVersion = 'portfolio.strategy.dividend_low_vol_basket.v1' } },
    { name: 'benchmark_changed', mutate: (value: any) => { value.benchmark.benchmarkId = '000300.SH' } },
    { name: 'benchmark_hash_mode_changed', mutate: (value: any) => { value.benchmark.hashMode = 'file_bytes' } },
    { name: 'threshold_reduced', mutate: (value: any) => { value.algorithm.thresholdReduced = true } },
    { name: 'only_three_windows_passed', mutate: (value: any) => { value.walkForward.passedWindowCount = 3; value.walkForward.passedRatio = 0.5 } },
    { name: 'window_removed', mutate: (value: any) => { value.walkForward.windows.pop() } },
    { name: 'future_candidate_reuse', mutate: (value: any) => { value.antiFalseGreen.futureCandidateSelectionReuseDetected = true } },
    { name: 'historical_status_proxy', mutate: (value: any) => { value.antiFalseGreen.historicalSecurityStatusProxyUsed = true } },
    { name: 'missing_prohibited_action', mutate: (value: any) => { value.prohibitedActions = ['ADD', 'REDUCE', 'ORDER_CREATE'] } },
    { name: 'formal_trading_unlocked', mutate: (value: any) => { value.formalTradingUnlocked = true } },
    { name: 'auto_trade_unlocked', mutate: (value: any) => { value.autoTradeUnlocked = true } },
    { name: 'order_creation_allowed', mutate: (value: any) => { value.orderCreateAllowed = true } },
  ]
  for (const negative of negatives) {
    const value = structuredClone(positive)
    negative.mutate(value)
    assert.equal(validate(value), false, `negative_fixture_accepted:${negative.name}`)
  }
  console.log(JSON.stringify({ schemaMetaValidation: 'passed', positiveFixtureCount: 1, rejectedNegativeFixtureCount: negatives.length }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
