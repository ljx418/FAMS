import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { benchmarkContentHash } from '../src/services/formal-release/formalBenchmarkService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'
import { portfolioBacktestEngine } from '../src/services/portfolio-backtest/portfolioBacktestEngine.js'
import type { PortfolioStrategyDefinition } from '../src/services/portfolio-backtest/portfolioBacktestTypes.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const lakeDir = resolve(process.cwd(), 'data', 'formal-release', 'ftr3-candidate-v2-validation')
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const
const CANDIDATE_VERSION = 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time'
const MINIMUM_COMPONENTS = 3
const MINIMUM_COVERAGE = 80
type Json = Record<string, any>
type ValidationPricePoint = { date: string; close: number; amountHands: number }

function sha256Bytes(value: string | Buffer) {
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

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestArtifact(stageId: string, fileName: string, predicate: (value: Json) => boolean) {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', stageId)
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const path = resolve(root, name, fileName)
    try {
      const raw = await readFile(path)
      const artifact = JSON.parse(raw.toString('utf8')) as Json
      if (predicate(artifact)) return { path, raw, artifact }
    } catch {
      // Partial or invalidated attempts remain local evidence but cannot become an input.
    }
  }
  throw new Error(`${stageId}:${fileName}:qualified_artifact_not_found`)
}

async function protectedAccountDigest() {
  const [positions, transactions, drafts, externalOrders] = await Promise.all([
    prisma.position.findMany({ where: { userId: 'default' }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId: 'default' }, orderBy: { id: 'asc' } }),
    prisma.gridOrderDraft.findMany({ where: { gridPlan: { userId: 'default' } }, orderBy: { id: 'asc' } }),
    prisma.externalOrderObservation.findMany({ where: { userId: 'default' }, orderBy: { id: 'asc' } }),
  ])
  return sha256Canonical({ positions, transactions, drafts, externalOrders })
}

function runCollector(sourceArtifactPath: string) {
  return new Promise<void>((resolvePromise, reject) => {
    const child = spawn('python3', [
      resolve(process.cwd(), 'scripts', 'providers', 'ftr_3_point_in_time_candidate_validation_prices.py'),
      '--source-artifact', sourceArtifactPath,
      '--lake-dir', lakeDir,
      '--workers', '4',
    ], { stdio: 'inherit' })
    const timeout = setTimeout(() => {
      child.kill('SIGTERM')
      reject(new Error('candidate_validation_price_collection_exceeded_15m'))
    }, 15 * 60 * 1000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise()
      else reject(new Error(`candidate_validation_price_collector_exit_${code}`))
    })
  })
}

function buildDefinition(snapshot: Json, selected: Json[], variant: { frequency: 'quarterly' | 'monthly'; feeRate: number; slippageRate: number }): PortfolioStrategyDefinition {
  const weight = 100 / selected.length
  const components = selected.map((candidate, index) => ({
    assetClass: 'stock' as const,
    symbol: String(candidate.symbol),
    name: String(candidate.name),
    targetWeightPercent: round(index === selected.length - 1 ? 100 - round(weight, 4) * (selected.length - 1) : weight, 4),
    evidenceRefs: [
      `point-in-time-candidate:${snapshot.decisionDate}:${candidate.symbol}`,
      ...((candidate.evidenceRefs || []) as string[]),
    ],
  }))
  return {
    strategyId: 'dividend_low_vol_basket',
    strategyVersion: CANDIDATE_VERSION,
    displayName: '红利低波候选篮子 v2（历史时点）',
    source: 'dividend_low_vol',
    components,
    rebalancePolicy: { frequency: variant.frequency },
    dividendPolicy: 'reinvest',
    costModel: { feeRate: variant.feeRate, slippageRate: variant.slippageRate },
    benchmarkPolicy: { benchmarkIds: ['csi300_total_return_h00300'], proxyAllowed: false },
    snapshot: {
      capturedAt: String(snapshot.generatedAt),
      tradeDate: String(snapshot.decisionDate),
      strategyVersion: CANDIDATE_VERSION,
      source: `free-source-point-in-time:${snapshot.decisionDate}`,
      candidateCount: Number(snapshot.candidates?.length || 0),
      selectedCandidateCount: selected.length,
      weightPolicy: 'equal_weight',
      selectionRules: [
        'evaluationReady=true',
        'exclude disposition avoid/data_insufficient',
        'rank evidenceAdjustedScore desc then symbol asc',
        'maximum 10 components',
        'decision-date facts only',
      ],
      evidenceRefs: selected.flatMap((candidate) => candidate.evidenceRefs || []),
    },
    validation: { status: selected.length >= MINIMUM_COMPONENTS ? 'valid' : 'insufficient', blockedReasons: selected.length >= MINIMUM_COMPONENTS ? [] : ['point_in_time_component_count_below_3'], warnings: ['research_validation_only'] },
    evidenceRefs: [`free-source-point-in-time-snapshot:${snapshot.decisionDate}`],
  }
}

async function validateSchema(artifact: unknown) {
  const schema = await readJson(resolve(repoRoot, 'docs', 'contracts', 'ftr-3-point-in-time-candidate-validation.schema.json'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors))
}

async function main() {
  await initializePrisma()
  const before = await protectedAccountDigest()
  const generatedAt = new Date()
  const r0 = await latestArtifact('FTR-3R0', 'point_in_time_data_readiness.json', (value) => value.schemaVersion === 'fams.ftr_3r.point_in_time_data_readiness.v3' && value.status === 'passed' && value.summary?.readyDecisionPointCount === 6)
  const source = await readJson(r0.artifact.sourcePointInTimeArtifact.path)
  assert.equal(sha256Bytes(await readFile(r0.artifact.sourcePointInTimeArtifact.path)), r0.artifact.sourcePointInTimeArtifact.sha256)
  assert.equal(source.schemaVersion, 'fams.ftr_3r.free_source_full_backfill.v2')
  assert.equal(source.antiFalseGreen.historicalSecurityStatusProxyUsed, false)
  await runCollector(r0.artifact.sourcePointInTimeArtifact.path)

  const priceManifestPath = resolve(lakeDir, 'lake-manifest.json')
  const priceManifestRaw = await readFile(priceManifestPath)
  const priceManifest = JSON.parse(priceManifestRaw.toString('utf8')) as Json
  assert.equal(priceManifest.schemaVersion, 'fams.ftr_3r1.validation_price_lake.v1')
  assert.equal(priceManifest.completedShardCount, priceManifest.symbolCount)
  const priceHashes = new Map<string, string>()
  const priceSeries: Record<string, ValidationPricePoint[]> = {}
  for (const entry of priceManifest.files as Json[]) {
    const raw = await readFile(entry.path)
    assert.equal(sha256Bytes(raw), entry.sha256, `candidate_validation_price_hash_mismatch:${entry.path}`)
    if (!String(entry.path).includes('/raw/prices/')) continue
    const shard = JSON.parse(raw.toString('utf8')) as Json
    assert.equal(shard.adjustment, 'qfq')
    priceHashes.set(shard.symbol, entry.sha256)
    priceSeries[shard.symbol] = (shard.rows as Json[]).map((row) => ({ date: String(row.date), close: Number(row.close), amountHands: Number(row.amountHands) }))
  }

  const oldFtr3 = await latestArtifact('FTR-3', 'walk_forward_replay.json', (value) => value.schemaVersion === 'fams.ftr_3.walk_forward_replay.v1' && value.configuredWindowCount === 6)
  const ftr2 = await latestArtifact('FTR-2', 'benchmark_total_return_replay.json', (value) => value.schemaVersion === 'fams.ftr_2.benchmark_replay.v1' && value.status === 'passed' && value.benchmarkType === 'trusted_total_return')
  const benchmarkRaw = await readFile(ftr2.artifact.benchmarkArtifactPath)
  const benchmark = JSON.parse(benchmarkRaw.toString('utf8')) as Json
  assert.equal(benchmarkContentHash(benchmark as any), ftr2.artifact.contentHash)
  const benchmarkPoints = (benchmark.points as Json[]).map((point) => ({ date: String(point.date), value: Number(point.value) }))
  const windows = oldFtr3.artifact.windows as Json[]
  assert.deepEqual(windows.map((window) => window.validationStartDate), (source.decisionPoints as Json[]).map((point) => point.decisionDate))

  const variants = [
    { variantId: 'baseline_quarterly', frequency: 'quarterly' as const, feeRate: 0.0003, slippageRate: 0.0005 },
    { variantId: 'monthly_rebalance', frequency: 'monthly' as const, feeRate: 0.0003, slippageRate: 0.0005 },
    { variantId: 'fee_plus_20bp', frequency: 'quarterly' as const, feeRate: 0.0023, slippageRate: 0.0005 },
    { variantId: 'slippage_plus_20bp', frequency: 'quarterly' as const, feeRate: 0.0003, slippageRate: 0.0025 },
    { variantId: 'fee_slippage_plus_10bp', frequency: 'quarterly' as const, feeRate: 0.0013, slippageRate: 0.0015 },
  ]
  const variantResults: Json[] = []
  for (const variant of variants) {
    const replayedWindows: Json[] = []
    for (let index = 0; index < windows.length; index += 1) {
      const window = windows[index]
      const point = source.decisionPoints[index]
      const snapshotRaw = await readFile(point.snapshotPath)
      assert.equal(sha256Bytes(snapshotRaw), point.snapshotSha256)
      const snapshot = JSON.parse(snapshotRaw.toString('utf8')) as Json
      assert.equal(snapshot.decisionDate, window.validationStartDate)
      const selected = (snapshot.candidates as Json[])
        .filter((candidate) => snapshot.selectedSymbols.includes(candidate.symbol))
        .sort((left, right) => snapshot.selectedSymbols.indexOf(left.symbol) - snapshot.selectedSymbols.indexOf(right.symbol))
      assert.deepEqual(selected.map((candidate) => candidate.symbol), snapshot.selectedSymbols)
      assert.ok(selected.every((candidate) => candidate.evaluationReady && candidate.historicalStatusProxyUsed === false))
      const definition = buildDefinition(snapshot, selected, variant)
      const selectedPriceSeries = Object.fromEntries(selected.map((candidate) => [candidate.symbol, priceSeries[candidate.symbol] || []]))
      const benchmarkWindowDates = benchmarkPoints.filter((point) => point.date >= window.validationStartDate && point.date <= window.validationEndDate).map((point) => point.date)
      const benchmarkWindowDateSet = new Set(benchmarkWindowDates)
      const perSymbolPriceCoverage = selected.map((candidate) => {
        const availableDates = new Set((priceSeries[candidate.symbol] || []).filter((point) => benchmarkWindowDateSet.has(point.date)).map((point) => point.date))
        return {
          symbol: candidate.symbol,
          coveredTradingDays: availableDates.size,
          requiredTradingDays: benchmarkWindowDates.length,
          priceCoveragePercent: benchmarkWindowDates.length ? round((availableDates.size / benchmarkWindowDates.length) * 100, 3) : 0,
        }
      })
      const commonTradingDays = benchmarkWindowDates.filter((date) => selected.every((candidate) => (priceSeries[candidate.symbol] || []).some((point) => point.date === date)))
      const priceCoveragePercent = benchmarkWindowDates.length ? round((commonTradingDays.length / benchmarkWindowDates.length) * 100, 3) : 0
      const benchmarkCoveragePercent = round((benchmarkWindowDates.length / Number(window.configuredValidationSampleSize || 60)) * 100, 3)
      const result = portfolioBacktestEngine.runFormalValidationStrategyWithSeries({
        definition,
        priceSeries: selectedPriceSeries,
        benchmarkId: 'csi300_total_return_h00300',
        benchmarkPoints,
        startDate: window.validationStartDate,
        endDate: window.validationEndDate,
        sourceEvidenceRefs: [
          `point-in-time-snapshot:${point.snapshotSha256}`,
          ...selected.map((candidate) => `qfq-validation-series:${candidate.symbol}:${priceHashes.get(candidate.symbol)}`),
          `trusted-total-return-benchmark:${ftr2.artifact.contentHash}`,
        ],
      })
      const validationSampleSize = result.equityCurve.length
      const annualizedTurnoverPercent = result.metrics.turnoverRate === null ? null : round(result.metrics.turnoverRate * (252 / Math.max(1, validationSampleSize)), 4)
      assert.equal(validationSampleSize, commonTradingDays.length, `engine_common_date_count_mismatch:${window.windowId}`)
      const coveragePassed = priceCoveragePercent >= MINIMUM_COVERAGE
        && benchmarkCoveragePercent >= MINIMUM_COVERAGE
        && perSymbolPriceCoverage.every((item) => item.priceCoveragePercent >= MINIMUM_COVERAGE)
      const passed = result.status === 'completed'
        && validationSampleSize >= 60
        && coveragePassed
        && (result.metrics.excessReturnPercent ?? Number.NEGATIVE_INFINITY) >= 0
        && (result.metrics.maxDrawdownPercent ?? Number.NEGATIVE_INFINITY) >= -35
        && (annualizedTurnoverPercent ?? Number.POSITIVE_INFINITY) <= 200
      replayedWindows.push({
        windowId: window.windowId,
        decisionDate: snapshot.decisionDate,
        trainingStartDate: window.trainingStartDate,
        trainingEndDate: window.trainingEndDate,
        validationStartDate: window.validationStartDate,
        validationEndDate: window.validationEndDate,
        selectedSymbols: snapshot.selectedSymbols,
        selectedComponentCount: selected.length,
        selectedComponents: selected.map((candidate) => ({ symbol: candidate.symbol, industry: candidate.industry })),
        selectedIndustries: Array.from(new Set(selected.map((candidate) => candidate.industry).filter(Boolean))).sort(),
        liquidityValues: selected.map((candidate) => {
          const rows = (priceSeries[candidate.symbol] || []).filter((point) => benchmarkWindowDateSet.has(point.date))
          return {
            symbol: candidate.symbol,
            medianVolumeHands: median(rows.map((point) => point.amountHands)),
            coveredTradingDays: rows.length,
            requiredTradingDays: benchmarkWindowDates.length,
            priceCoveragePercent: benchmarkWindowDates.length ? round((rows.length / benchmarkWindowDates.length) * 100, 3) : 0,
          }
        }),
        sourceSnapshotPath: point.snapshotPath,
        sourceSnapshotSha256: point.snapshotSha256,
        definitionHash: sha256Canonical(definition),
        parameterSnapshotHash: sha256Canonical({
          profile: 'equity_selection_release_v1',
          candidateVersion: CANDIDATE_VERSION,
          variant,
          trainingStartDate: window.trainingStartDate,
          trainingEndDate: window.trainingEndDate,
          decisionDate: snapshot.decisionDate,
          selectedSymbols: snapshot.selectedSymbols,
        }),
        validationSampleSize,
        requiredTradingDays: benchmarkWindowDates.length,
        commonTradingDayCount: commonTradingDays.length,
        perSymbolPriceCoverage,
        priceCoveragePercent,
        benchmarkCoveragePercent,
        totalReturnPercent: result.metrics.totalReturnPercent,
        benchmarkReturnPercent: result.metrics.benchmarkReturnPercent,
        excessReturnPercent: result.metrics.excessReturnPercent,
        maxDrawdownPercent: result.metrics.maxDrawdownPercent,
        annualizedTurnoverPercent,
        resultHash: sha256Canonical({ metrics: result.metrics, equityCurve: result.equityCurve, dataCoverage: result.dataCoverage }),
        dataQualityStatus: coveragePassed ? 'passed' : 'insufficient',
        status: passed ? 'passed' : validationSampleSize >= 60 && coveragePassed ? 'failed' : 'insufficient',
        blockers: [
          ...(selected.length >= MINIMUM_COMPONENTS ? [] : ['selected_component_count_below_3']),
          ...(validationSampleSize >= 60 ? [] : ['validation_sample_below_60']),
          ...(coveragePassed ? [] : ['validation_coverage_below_80']),
          ...((result.metrics.excessReturnPercent ?? Number.NEGATIVE_INFINITY) >= 0 ? [] : ['excess_return_negative']),
          ...((result.metrics.maxDrawdownPercent ?? Number.NEGATIVE_INFINITY) >= -35 ? [] : ['max_drawdown_below_minus_35']),
          ...((annualizedTurnoverPercent ?? Number.POSITIVE_INFINITY) <= 200 ? [] : ['annualized_turnover_above_200']),
        ],
      })
    }
    const validWindows = replayedWindows.filter((window) => window.status !== 'insufficient')
    const passedWindows = replayedWindows.filter((window) => window.status === 'passed')
    variantResults.push({
      variantId: variant.variantId,
      frequency: variant.frequency,
      feeRate: variant.feeRate,
      slippageRate: variant.slippageRate,
      status: validWindows.length === 6 ? 'completed' : 'insufficient',
      validWindowCount: validWindows.length,
      passedWindowCount: passedWindows.length,
      passedRatio: validWindows.length ? round(passedWindows.length / validWindows.length) : null,
      averageTotalReturnPercent: validWindows.length ? round(validWindows.reduce((sum, window) => sum + Number(window.totalReturnPercent), 0) / validWindows.length) : null,
      worstMaxDrawdownPercent: validWindows.length ? Math.min(...validWindows.map((window) => Number(window.maxDrawdownPercent))) : null,
      inputHash: sha256Canonical({ variant, windows: replayedWindows.map((window) => ({ windowId: window.windowId, sourceSnapshotSha256: window.sourceSnapshotSha256, parameterSnapshotHash: window.parameterSnapshotHash })) }),
      resultHash: sha256Canonical(replayedWindows),
      windows: replayedWindows,
    })
  }
  const baseline = variantResults[0]
  const stableVariants = variantResults.filter((variant) => variant.status === 'completed'
    && Math.abs(Number(variant.averageTotalReturnPercent) - Number(baseline.averageTotalReturnPercent)) <= 15
    && Math.abs(Number(variant.worstMaxDrawdownPercent) - Number(baseline.worstMaxDrawdownPercent)) <= 10)
  const stableParameterSetRatio = round(stableVariants.length / variants.length)
  const validVariantReturns = variantResults.map((variant) => variant.averageTotalReturnPercent).filter((value): value is number => Number.isFinite(value))
  const validVariantDrawdowns = variantResults.map((variant) => variant.worstMaxDrawdownPercent).filter((value): value is number => Number.isFinite(value))
  const bestWorstReturnSpreadPercentPoints = validVariantReturns.length === variants.length ? round(Math.max(...validVariantReturns) - Math.min(...validVariantReturns)) : null
  const maxDrawdownSpreadPercentPoints = validVariantDrawdowns.length === variants.length ? round(Math.max(...validVariantDrawdowns) - Math.min(...validVariantDrawdowns)) : null
  const bestWorstReturnSpreadWithinPolicy = bestWorstReturnSpreadPercentPoints !== null && bestWorstReturnSpreadPercentPoints <= 15
  const maxDrawdownSpreadWithinPolicy = maxDrawdownSpreadPercentPoints !== null && maxDrawdownSpreadPercentPoints <= 10
  const baselineWindows = baseline.windows as Json[]
  const validWindowCount = baselineWindows.filter((window) => window.status !== 'insufficient').length
  const passedWindowCount = baselineWindows.filter((window) => window.status === 'passed').length
  const walkForwardPassedRatio = validWindowCount ? round(passedWindowCount / validWindowCount) : 0
  const releaseEffectivePathCount = baselineWindows.filter((window) => window.status !== 'insufficient').reduce((sum, window) => sum + Number(window.selectedComponentCount), 0)

  const industryPaths = new Map<string, Array<{ pathId: string; effective: boolean }>>()
  const liquidityRows: Array<{ pathId: string; symbol: string; windowId: string; value: number; effective: boolean }> = []
  for (const window of baselineWindows) {
    for (const component of window.selectedComponents as Json[]) {
      const pathId = `${window.windowId}:${component.symbol}`
      const coverage = (window.perSymbolPriceCoverage as Json[]).find((item) => item.symbol === component.symbol)?.priceCoveragePercent || 0
      const paths = industryPaths.get(component.industry) || []
      paths.push({ pathId, effective: window.status !== 'insufficient' && coverage >= MINIMUM_COVERAGE })
      industryPaths.set(component.industry, paths)
    }
    for (const row of window.liquidityValues as Json[]) if (Number.isFinite(Number(row.medianVolumeHands))) liquidityRows.push({ pathId: `${window.windowId}:${row.symbol}`, symbol: row.symbol, windowId: window.windowId, value: Number(row.medianVolumeHands), effective: window.status !== 'insufficient' && row.priceCoveragePercent >= MINIMUM_COVERAGE })
  }
  const industryGroups = Array.from(industryPaths.entries()).sort(([left], [right]) => left.localeCompare(right)).map(([groupId, paths]) => {
    const effectivePathCount = paths.filter((path) => path.effective).length
    const sampleCoveragePercent = round((effectivePathCount / paths.length) * 100, 3)
    const inputHash = sha256Canonical(paths)
    return { groupId, pathIds: paths.map((path) => path.pathId), effectivePathCount, sampleCoveragePercent, inputHash, resultHash: sha256Canonical({ groupId, effectivePathCount, sampleCoveragePercent, inputHash }), status: effectivePathCount >= 3 && sampleCoveragePercent >= 80 ? 'passed' : 'insufficient' }
  })
  const sortedByBenchmark = [...baselineWindows].sort((left, right) => Number(left.benchmarkReturnPercent) - Number(right.benchmarkReturnPercent))
  const marketRegimeGroups = ['down', 'neutral', 'up'].map((name, index) => {
    const groupedWindows = sortedByBenchmark.slice(index * 2, index * 2 + 2)
    const effectivePathCount = groupedWindows.filter((window) => window.status !== 'insufficient').reduce((sum, window) => sum + Number(window.selectedComponentCount), 0)
    const totalPathCount = groupedWindows.reduce((sum, window) => sum + Number(window.selectedComponentCount), 0)
    const sampleCoveragePercent = totalPathCount ? round((effectivePathCount / totalPathCount) * 100, 3) : 0
    const input = groupedWindows.map((window) => ({ windowId: window.windowId, benchmarkReturnPercent: window.benchmarkReturnPercent, resultHash: window.resultHash }))
    const inputHash = sha256Canonical(input)
    return { groupId: `market:${name}`, windowIds: groupedWindows.map((window) => window.windowId), effectivePathCount, sampleCoveragePercent, inputHash, resultHash: sha256Canonical({ groupId: `market:${name}`, effectivePathCount, sampleCoveragePercent, inputHash }), status: effectivePathCount > 0 && sampleCoveragePercent >= 80 ? 'passed' : 'insufficient' }
  })
  const sortedLiquidity = [...liquidityRows].sort((left, right) => left.value - right.value)
  const liquidityGroups = ['low', 'medium', 'high'].map((name, index) => {
    const paths = sortedLiquidity.filter((_, itemIndex) => Math.min(2, Math.floor((itemIndex * 3) / Math.max(1, sortedLiquidity.length))) === index)
    const effectivePathCount = paths.filter((path) => path.effective).length
    const sampleCoveragePercent = paths.length ? round((effectivePathCount / paths.length) * 100, 3) : 0
    const inputHash = sha256Canonical(paths)
    return { groupId: `liquidity:${name}`, pathIds: paths.map((path) => path.pathId), sampleCount: paths.length, effectivePathCount, sampleCoveragePercent, inputHash, resultHash: sha256Canonical({ groupId: `liquidity:${name}`, effectivePathCount, sampleCoveragePercent, inputHash }), status: effectivePathCount > 0 && sampleCoveragePercent >= 80 ? 'passed' : 'insufficient' }
  })
  const industryGroupCount = industryGroups.filter((group) => group.status === 'passed').length
  const marketRegimeGroupCount = marketRegimeGroups.filter((group) => group.status === 'passed').length
  const liquidityGroupCount = liquidityGroups.filter((group) => group.status === 'passed').length
  const groupStabilityPassed = industryGroupCount >= 3 && marketRegimeGroupCount >= 3 && liquidityGroupCount >= 3
  const parameterSensitivityPassed = variants.length >= 5
    && stableParameterSetRatio >= 0.6
    && bestWorstReturnSpreadWithinPolicy
    && maxDrawdownSpreadWithinPolicy
  const businessPassed = validWindowCount === 6
    && passedWindowCount >= 4
    && walkForwardPassedRatio >= 0.6
    && releaseEffectivePathCount >= 30
    && groupStabilityPassed
    && parameterSensitivityPassed
  const blockers = Array.from(new Set([
    ...(validWindowCount === 6 ? [] : ['valid_window_count_below_6']),
    ...(passedWindowCount >= 4 && walkForwardPassedRatio >= 0.6 ? [] : ['walk_forward_passed_ratio_below_0_6']),
    ...(releaseEffectivePathCount >= 30 ? [] : ['release_effective_path_count_below_30']),
    ...(groupStabilityPassed ? [] : ['group_stability_insufficient']),
    ...(parameterSensitivityPassed ? [] : ['parameter_sensitivity_insufficient']),
  ])).sort()
  const after = await protectedAccountDigest()
  const accountFactsUnchanged = before === after
  assert.equal(accountFactsUnchanged, true, 'protected_account_facts_changed')
  const artifact = {
    schemaVersion: 'fams.ftr_3r1.point_in_time_candidate_validation.v1',
    stageId: 'FTR-3R1',
    candidateId: 'dividend_low_vol_basket',
    candidateVersion: CANDIDATE_VERSION,
    generatedAt: generatedAt.toISOString(),
    sourcePointInTimeReadiness: { path: r0.path, sha256: sha256Bytes(r0.raw), readyDecisionPointCount: 6 },
    sourcePointInTimeBackfill: { path: r0.artifact.sourcePointInTimeArtifact.path, sha256: r0.artifact.sourcePointInTimeArtifact.sha256 },
    sourceOriginalFtr3: { path: oldFtr3.path, sha256: sha256Bytes(oldFtr3.raw), originalPassedWindowCount: oldFtr3.artifact.passedWindowCount, originalPassedRatio: oldFtr3.artifact.passedRatio },
    benchmark: { benchmarkId: ftr2.artifact.benchmarkId, benchmarkType: ftr2.artifact.benchmarkType, path: ftr2.artifact.benchmarkArtifactPath, sha256: ftr2.artifact.contentHash, hashMode: 'formal_benchmark_content_hash', changedForPassing: false },
    priceLake: { path: lakeDir, manifestPath: priceManifestPath, manifestSha256: sha256Bytes(priceManifestRaw), symbolCount: priceManifest.symbolCount, completedShardCount: priceManifest.completedShardCount, failedShardCount: priceManifest.symbolCount - priceManifest.completedShardCount, adjustment: 'qfq', allHashesVerified: true },
    algorithm: { selectionSource: 'same_day_immutable_point_in_time_snapshot', ranking: 'evidenceAdjustedScore_desc_symbol_asc', weightPolicy: 'equal_weight', maxComponents: 10, minimumComponents: MINIMUM_COMPONENTS, feeRate: 0.0003, slippageRate: 0.0005, benchmarkId: 'csi300_total_return_h00300', thresholdReduced: false },
    walkForward: { configuredWindowCount: 6, validWindowCount, passedWindowCount, passedRatio: walkForwardPassedRatio, minimumPassedRatio: 0.6, windows: baselineWindows },
    parameterSensitivity: { testedParameterSetCount: variants.length, stableParameterSetCount: stableVariants.length, stableParameterSetRatio, bestWorstReturnSpreadPercentPoints, maxDrawdownSpreadPercentPoints, bestWorstReturnSpreadWithinPolicy, maxDrawdownSpreadWithinPolicy, status: parameterSensitivityPassed ? 'passed' : 'failed', variants: variantResults, cashDividendVariant: { status: 'not_applicable', countedAsTestedParameterSet: false, reason: 'qfq_series_already_represents_reinvested_distribution_effect' } },
    groupStability: { releaseEffectivePathCount, industryGroupCount, marketRegimeGroupCount, liquidityGroupCount, status: groupStabilityPassed ? 'passed' : 'insufficient', industryGroups, marketRegimeGroups, liquidityGroups },
    antiFalseGreen: { latestCandidateSnapshotBackfillDetected: false, futureCandidateSelectionReuseDetected: false, failedWindowsRemoved: false, benchmarkChangedForPassing: false, thresholdReduced: false, historicalSecurityStatusProxyUsed: false },
    summary: { pointInTimeCandidateV2ValidationPassed: businessPassed, candidateV2RefreezeAllowed: businessPassed, ftr4EntryAllowed: false },
    accountFactsUnchanged,
    realDataUsed: true,
    status: businessPassed ? 'passed' : validWindowCount === 6 ? 'failed' : 'insufficient',
    blockers,
    prohibitedActions: [...PROHIBITED_ACTIONS],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  await validateSchema(artifact)
  const outputDir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R1', generatedAt.toISOString().replace(/[:.]/g, '-'))
  await mkdir(outputDir, { recursive: true })
  const artifactPath = resolve(outputDir, 'point_in_time_candidate_validation.json')
  await writeFile(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  console.log(JSON.stringify({ artifactPath, status: artifact.status, ...artifact.summary, walkForward: { validWindowCount, passedWindowCount, passedRatio: walkForwardPassedRatio }, groupStability: artifact.groupStability, parameterSensitivity: { testedParameterSetCount: variants.length, stableParameterSetRatio, status: artifact.parameterSensitivity.status }, blockers }, null, 2))
  if (artifact.status !== 'passed') process.exitCode = 2
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
