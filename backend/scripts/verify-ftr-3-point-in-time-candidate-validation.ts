import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { benchmarkContentHash } from '../src/services/formal-release/formalBenchmarkService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const dates = ['2025-12-12', '2026-01-20', '2026-03-03', '2026-04-08', '2026-05-15', '2026-06-22']
const windowIds = ['wf-01', 'wf-02', 'wf-03', 'wf-04', 'wf-05', 'wf-06']
const variantIds = ['baseline_quarterly', 'monthly_rebalance', 'fee_plus_20bp', 'slippage_plus_20bp', 'fee_slippage_plus_10bp']
type Json = Record<string, any>

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function median(values: number[]) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

async function latestArtifact() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R1')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const path = resolve(root, name, 'point_in_time_candidate_validation.json')
    try {
      try {
        await readFile(resolve(root, name, 'INVALIDATED.json'))
        continue
      } catch {
        // No invalidation record: the artifact remains eligible for verification.
      }
      return { path, artifact: JSON.parse(await readFile(path, 'utf8')) as Json }
    } catch {
      // Partial runs are evidence, but never become the selected acceptance input.
    }
  }
  throw new Error('ftr_3r1_candidate_validation_artifact_not_found')
}

async function assertByteHash(path: string, expected: string) {
  assert.equal((await stat(path)).isFile(), true, `evidence_not_file:${path}`)
  assert.equal(sha256(await readFile(path)), expected, `evidence_hash_mismatch:${path}`)
}

async function main() {
  const schema = JSON.parse(await readFile(resolve(repoRoot, 'docs', 'contracts', 'ftr-3-point-in-time-candidate-validation.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const { path, artifact } = await latestArtifact()
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors))

  await assertByteHash(artifact.sourcePointInTimeReadiness.path, artifact.sourcePointInTimeReadiness.sha256)
  await assertByteHash(artifact.sourcePointInTimeBackfill.path, artifact.sourcePointInTimeBackfill.sha256)
  await assertByteHash(artifact.sourceOriginalFtr3.path, artifact.sourceOriginalFtr3.sha256)
  await assertByteHash(artifact.priceLake.manifestPath, artifact.priceLake.manifestSha256)
  const benchmark = JSON.parse(await readFile(artifact.benchmark.path, 'utf8'))
  assert.equal(artifact.benchmark.hashMode, 'formal_benchmark_content_hash')
  assert.equal(benchmarkContentHash(benchmark), artifact.benchmark.sha256, 'benchmark_content_hash_mismatch')

  const readiness = JSON.parse(await readFile(artifact.sourcePointInTimeReadiness.path, 'utf8')) as Json
  const source = JSON.parse(await readFile(artifact.sourcePointInTimeBackfill.path, 'utf8')) as Json
  const original = JSON.parse(await readFile(artifact.sourceOriginalFtr3.path, 'utf8')) as Json
  const priceManifest = JSON.parse(await readFile(artifact.priceLake.manifestPath, 'utf8')) as Json
  assert.equal(readiness.schemaVersion, 'fams.ftr_3r.point_in_time_data_readiness.v3')
  assert.equal(readiness.status, 'passed')
  assert.equal(readiness.summary.readyDecisionPointCount, 6)
  assert.equal(source.schemaVersion, 'fams.ftr_3r.free_source_full_backfill.v2')
  assert.equal(source.status, 'passed')
  assert.equal(source.antiFalseGreen.historicalSecurityStatusProxyUsed, false)
  assert.equal(original.schemaVersion, 'fams.ftr_3.walk_forward_replay.v1')
  assert.equal(original.passedWindowCount, 2)
  assert.equal(original.passedRatio, 0.333333)
  assert.equal(priceManifest.schemaVersion, 'fams.ftr_3r1.validation_price_lake.v1')
  assert.equal(priceManifest.sourcePointInTimeArtifact, artifact.sourcePointInTimeBackfill.path)
  assert.equal(priceManifest.sourcePointInTimeArtifactSha256, artifact.sourcePointInTimeBackfill.sha256)
  assert.equal(priceManifest.adjustment, 'qfq')
  assert.equal(priceManifest.completedShardCount, priceManifest.symbolCount)
  assert.equal(artifact.priceLake.failedShardCount, 0)
  assert.equal(priceManifest.files.length, priceManifest.fileCount)
  const priceRows = new Map<string, Json[]>()
  for (const entry of priceManifest.files as Json[]) {
    await assertByteHash(entry.path, entry.sha256)
    if (!String(entry.path).includes('/raw/prices/')) continue
    const shard = JSON.parse(await readFile(entry.path, 'utf8')) as Json
    assert.equal(shard.adjustment, 'qfq')
    priceRows.set(shard.symbol, shard.rows)
  }

  assert.deepEqual((source.decisionPoints as Json[]).map((point) => point.decisionDate), dates)
  assert.deepEqual((original.windows as Json[]).map((window) => window.windowId), windowIds)
  assert.deepEqual((original.windows as Json[]).map((window) => window.validationStartDate), dates)
  assert.deepEqual(artifact.walkForward.windows.map((window: Json) => window.windowId), windowIds)
  assert.deepEqual(artifact.walkForward.windows.map((window: Json) => window.decisionDate), dates)
  assert.deepEqual(artifact.parameterSensitivity.variants.map((variant: Json) => variant.variantId), variantIds)

  for (let index = 0; index < dates.length; index += 1) {
    const point = source.decisionPoints[index]
    const snapshotRaw = await readFile(point.snapshotPath)
    assert.equal(sha256(snapshotRaw), point.snapshotSha256, `snapshot_hash_mismatch:${point.decisionDate}`)
    const snapshot = JSON.parse(snapshotRaw.toString('utf8')) as Json
    assert.equal(snapshot.decisionDate, dates[index])
    assert.deepEqual(snapshot.selectedSymbols, point.selectedSymbols)
    const expectedSelected = (snapshot.candidates as Json[])
      .filter((candidate) => candidate.evaluationReady && !['avoid', 'data_insufficient'].includes(candidate.disposition))
      .sort((left, right) => Number(right.scores.evidenceAdjustedScore) - Number(left.scores.evidenceAdjustedScore) || String(left.symbol).localeCompare(String(right.symbol)))
      .slice(0, 10)
      .map((candidate) => candidate.symbol)
    assert.deepEqual(snapshot.selectedSymbols, expectedSelected, `selection_algorithm_drift:${point.decisionDate}`)
    for (const candidate of snapshot.candidates as Json[]) {
      assert.equal(candidate.historicalStatusProxyUsed, false)
      for (const announcementDate of candidate.sourceAnnouncementDates as string[]) {
        assert.ok(announcementDate <= point.decisionDate, `future_announcement:${candidate.symbol}:${announcementDate}`)
      }
    }
    const baselineWindow = artifact.walkForward.windows[index]
    assert.equal(baselineWindow.trainingStartDate, original.windows[index].trainingStartDate)
    assert.equal(baselineWindow.trainingEndDate, original.windows[index].trainingEndDate)
    assert.equal(baselineWindow.validationStartDate, original.windows[index].validationStartDate)
    assert.equal(baselineWindow.validationEndDate, original.windows[index].validationEndDate)
    assert.deepEqual(baselineWindow.selectedSymbols, snapshot.selectedSymbols)
    assert.deepEqual(baselineWindow.selectedComponents, expectedSelected.map((symbol) => {
      const candidate = snapshot.candidates.find((item: Json) => item.symbol === symbol)
      return { symbol, industry: candidate.industry }
    }))
    assert.equal(baselineWindow.selectedComponentCount, baselineWindow.selectedSymbols.length)
    assert.equal(baselineWindow.sourceSnapshotPath, point.snapshotPath)
    assert.equal(baselineWindow.sourceSnapshotSha256, point.snapshotSha256)
  }

  for (const variant of artifact.parameterSensitivity.variants as Json[]) {
    const variantInput = { variantId: variant.variantId, frequency: variant.frequency, feeRate: variant.feeRate, slippageRate: variant.slippageRate }
    assert.deepEqual(variant.windows.map((window: Json) => window.windowId), windowIds)
    const valid = variant.windows.filter((window: Json) => window.status !== 'insufficient')
    const passed = variant.windows.filter((window: Json) => window.status === 'passed')
    assert.equal(variant.validWindowCount, valid.length)
    assert.equal(variant.passedWindowCount, passed.length)
    assert.equal(variant.passedRatio, valid.length ? round(passed.length / valid.length) : null)
    for (const window of variant.windows as Json[]) {
      const originalWindow = original.windows.find((item: Json) => item.windowId === window.windowId)
      const expectedDates = (benchmark.points as Json[]).filter((point) => point.date >= window.validationStartDate && point.date <= window.validationEndDate).map((point) => point.date)
      const expectedDateSet = new Set(expectedDates)
      assert.equal(expectedDates.length, 60, `benchmark_window_not_60_days:${window.windowId}`)
      const recomputedCoverage = window.selectedSymbols.map((symbol: string) => {
        const rows = (priceRows.get(symbol) || []).filter((row) => expectedDateSet.has(row.date))
        return { symbol, coveredTradingDays: rows.length, requiredTradingDays: expectedDates.length, priceCoveragePercent: round((rows.length / expectedDates.length) * 100, 3) }
      })
      const commonDates = expectedDates.filter((date) => window.selectedSymbols.every((symbol: string) => (priceRows.get(symbol) || []).some((row) => row.date === date)))
      assert.deepEqual(window.perSymbolPriceCoverage, recomputedCoverage, `per_symbol_coverage_mismatch:${variant.variantId}:${window.windowId}`)
      assert.equal(window.requiredTradingDays, expectedDates.length)
      assert.equal(window.commonTradingDayCount, commonDates.length)
      assert.equal(window.validationSampleSize, commonDates.length)
      assert.equal(window.priceCoveragePercent, round((commonDates.length / expectedDates.length) * 100, 3))
      assert.equal(window.benchmarkCoveragePercent, round((expectedDates.length / originalWindow.configuredValidationSampleSize) * 100, 3))
      assert.deepEqual(window.liquidityValues, window.selectedSymbols.map((symbol: string) => {
        const rows = (priceRows.get(symbol) || []).filter((row) => expectedDateSet.has(row.date))
        return { symbol, medianVolumeHands: median(rows.map((row) => Number(row.amountHands))), coveredTradingDays: rows.length, requiredTradingDays: expectedDates.length, priceCoveragePercent: round((rows.length / expectedDates.length) * 100, 3) }
      }))
      assert.equal(window.parameterSnapshotHash, sha256Canonical({ profile: 'equity_selection_release_v1', candidateVersion: artifact.candidateVersion, variant: variantInput, trainingStartDate: window.trainingStartDate, trainingEndDate: window.trainingEndDate, decisionDate: window.decisionDate, selectedSymbols: window.selectedSymbols }))
      const coveragePassed = window.priceCoveragePercent >= 80 && window.benchmarkCoveragePercent >= 80 && recomputedCoverage.every((item) => item.priceCoveragePercent >= 80)
      const expectedPassed = window.validationSampleSize >= 60
        && coveragePassed
        && window.excessReturnPercent >= 0
        && window.maxDrawdownPercent >= -35
        && window.annualizedTurnoverPercent <= 200
      assert.equal(window.status === 'passed', expectedPassed, `window_status_mismatch:${variant.variantId}:${window.windowId}`)
      assert.equal(window.status === 'insufficient', window.validationSampleSize < 60 || !coveragePassed, `window_sufficiency_mismatch:${variant.variantId}:${window.windowId}`)
    }
    assert.equal(variant.inputHash, sha256Canonical({ variant: variantInput, windows: variant.windows.map((window: Json) => ({ windowId: window.windowId, sourceSnapshotSha256: window.sourceSnapshotSha256, parameterSnapshotHash: window.parameterSnapshotHash })) }))
    assert.equal(variant.resultHash, sha256Canonical(variant.windows))
  }

  const baseline = artifact.parameterSensitivity.variants[0]
  assert.deepEqual(artifact.walkForward.windows, baseline.windows)
  const validWindows = baseline.windows.filter((window: Json) => window.status !== 'insufficient')
  const passedWindows = baseline.windows.filter((window: Json) => window.status === 'passed')
  assert.equal(artifact.walkForward.validWindowCount, validWindows.length)
  assert.equal(artifact.walkForward.passedWindowCount, passedWindows.length)
  assert.equal(artifact.walkForward.passedRatio, round(passedWindows.length / validWindows.length))
  const effectivePathCount = validWindows.reduce((sum: number, window: Json) => sum + window.selectedComponentCount, 0)
  assert.equal(artifact.groupStability.releaseEffectivePathCount, effectivePathCount)
  const industryPaths = new Map<string, Array<{ pathId: string; effective: boolean }>>()
  const liquidityRows: Array<{ pathId: string; symbol: string; windowId: string; value: number; effective: boolean }> = []
  for (const window of baseline.windows as Json[]) {
    for (const component of window.selectedComponents as Json[]) {
      const pathId = `${window.windowId}:${component.symbol}`
      const coverage = window.perSymbolPriceCoverage.find((item: Json) => item.symbol === component.symbol)?.priceCoveragePercent || 0
      const paths = industryPaths.get(component.industry) || []
      paths.push({ pathId, effective: window.status !== 'insufficient' && coverage >= 80 })
      industryPaths.set(component.industry, paths)
    }
    for (const row of window.liquidityValues as Json[]) if (Number.isFinite(Number(row.medianVolumeHands))) liquidityRows.push({ pathId: `${window.windowId}:${row.symbol}`, symbol: row.symbol, windowId: window.windowId, value: Number(row.medianVolumeHands), effective: window.status !== 'insufficient' && row.priceCoveragePercent >= 80 })
  }
  const expectedIndustryGroups = Array.from(industryPaths.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([groupId, paths]) => {
    const groupEffectivePathCount = paths.filter((item) => item.effective).length
    const sampleCoveragePercent = round((groupEffectivePathCount / paths.length) * 100, 3)
    const inputHash = sha256Canonical(paths)
    return { groupId, pathIds: paths.map((item) => item.pathId), effectivePathCount: groupEffectivePathCount, sampleCoveragePercent, inputHash, resultHash: sha256Canonical({ groupId, effectivePathCount: groupEffectivePathCount, sampleCoveragePercent, inputHash }), status: groupEffectivePathCount >= 3 && sampleCoveragePercent >= 80 ? 'passed' : 'insufficient' }
  })
  assert.deepEqual(artifact.groupStability.industryGroups, expectedIndustryGroups)
  const sortedByBenchmark = [...baseline.windows].sort((left: Json, right: Json) => Number(left.benchmarkReturnPercent) - Number(right.benchmarkReturnPercent))
  const expectedMarketGroups = ['down', 'neutral', 'up'].map((name, index) => {
    const groupedWindows = sortedByBenchmark.slice(index * 2, index * 2 + 2)
    const groupEffectivePathCount = groupedWindows.filter((window: Json) => window.status !== 'insufficient').reduce((sum: number, window: Json) => sum + window.selectedComponentCount, 0)
    const totalPathCount = groupedWindows.reduce((sum: number, window: Json) => sum + window.selectedComponentCount, 0)
    const sampleCoveragePercent = round((groupEffectivePathCount / totalPathCount) * 100, 3)
    const input = groupedWindows.map((window: Json) => ({ windowId: window.windowId, benchmarkReturnPercent: window.benchmarkReturnPercent, resultHash: window.resultHash }))
    const inputHash = sha256Canonical(input)
    return { groupId: `market:${name}`, windowIds: groupedWindows.map((window: Json) => window.windowId), effectivePathCount: groupEffectivePathCount, sampleCoveragePercent, inputHash, resultHash: sha256Canonical({ groupId: `market:${name}`, effectivePathCount: groupEffectivePathCount, sampleCoveragePercent, inputHash }), status: groupEffectivePathCount > 0 && sampleCoveragePercent >= 80 ? 'passed' : 'insufficient' }
  })
  assert.deepEqual(artifact.groupStability.marketRegimeGroups, expectedMarketGroups)
  const sortedLiquidity = [...liquidityRows].sort((left, right) => left.value - right.value)
  const expectedLiquidityGroups = ['low', 'medium', 'high'].map((name, index) => {
    const paths = sortedLiquidity.filter((_, itemIndex) => Math.min(2, Math.floor((itemIndex * 3) / sortedLiquidity.length)) === index)
    const groupEffectivePathCount = paths.filter((item) => item.effective).length
    const sampleCoveragePercent = round((groupEffectivePathCount / paths.length) * 100, 3)
    const inputHash = sha256Canonical(paths)
    return { groupId: `liquidity:${name}`, pathIds: paths.map((item) => item.pathId), sampleCount: paths.length, effectivePathCount: groupEffectivePathCount, sampleCoveragePercent, inputHash, resultHash: sha256Canonical({ groupId: `liquidity:${name}`, effectivePathCount: groupEffectivePathCount, sampleCoveragePercent, inputHash }), status: groupEffectivePathCount > 0 && sampleCoveragePercent >= 80 ? 'passed' : 'insufficient' }
  })
  assert.deepEqual(artifact.groupStability.liquidityGroups, expectedLiquidityGroups)
  assert.equal(artifact.groupStability.industryGroupCount, expectedIndustryGroups.filter((group) => group.status === 'passed').length)
  assert.equal(artifact.groupStability.marketRegimeGroupCount, expectedMarketGroups.filter((group) => group.status === 'passed').length)
  assert.equal(artifact.groupStability.liquidityGroupCount, expectedLiquidityGroups.filter((group) => group.status === 'passed').length)
  assert.equal(new Set(artifact.groupStability.marketRegimeGroups.flatMap((group: Json) => group.windowIds)).size, 6)
  assert.equal(artifact.parameterSensitivity.stableParameterSetRatio, round(artifact.parameterSensitivity.stableParameterSetCount / 5))
  const variantReturns = artifact.parameterSensitivity.variants.map((variant: Json) => variant.averageTotalReturnPercent)
  const variantDrawdowns = artifact.parameterSensitivity.variants.map((variant: Json) => variant.worstMaxDrawdownPercent)
  assert.equal(artifact.parameterSensitivity.bestWorstReturnSpreadPercentPoints, round(Math.max(...variantReturns) - Math.min(...variantReturns)))
  assert.equal(artifact.parameterSensitivity.maxDrawdownSpreadPercentPoints, round(Math.max(...variantDrawdowns) - Math.min(...variantDrawdowns)))
  assert.equal(artifact.parameterSensitivity.bestWorstReturnSpreadWithinPolicy, artifact.parameterSensitivity.bestWorstReturnSpreadPercentPoints <= 15)
  assert.equal(artifact.parameterSensitivity.maxDrawdownSpreadWithinPolicy, artifact.parameterSensitivity.maxDrawdownSpreadPercentPoints <= 10)
  assert.equal(artifact.parameterSensitivity.cashDividendVariant.countedAsTestedParameterSet, false)

  const businessPassed = validWindows.length === 6
    && passedWindows.length >= 4
    && artifact.walkForward.passedRatio >= 0.6
    && effectivePathCount >= 30
    && artifact.groupStability.industryGroupCount >= 3
    && artifact.groupStability.marketRegimeGroupCount >= 3
    && artifact.groupStability.liquidityGroupCount >= 3
    && artifact.parameterSensitivity.stableParameterSetRatio >= 0.6
    && artifact.parameterSensitivity.bestWorstReturnSpreadWithinPolicy
    && artifact.parameterSensitivity.maxDrawdownSpreadWithinPolicy
  assert.equal(artifact.status === 'passed', businessPassed)
  assert.equal(artifact.summary.pointInTimeCandidateV2ValidationPassed, businessPassed)
  assert.equal(artifact.summary.candidateV2RefreezeAllowed, businessPassed)
  assert.equal(artifact.summary.ftr4EntryAllowed, false)
  assert.equal(artifact.accountFactsUnchanged, true)
  assert.equal(artifact.realDataUsed, true)
  assert.deepEqual(artifact.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(artifact[field], false)

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_3r1.point_in_time_candidate_validation_verification.v1',
    artifactPath: path,
    schemaValidation: 'passed',
    semanticValidation: 'passed',
    businessStatus: artifact.status,
    validWindowCount: validWindows.length,
    passedWindowCount: passedWindows.length,
    passedRatio: artifact.walkForward.passedRatio,
    parameterSensitivityStatus: artifact.parameterSensitivity.status,
    groupStabilityStatus: artifact.groupStability.status,
    blockers: artifact.blockers,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
  if (!businessPassed) process.exitCode = 2
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
