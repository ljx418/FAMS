import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { formalValidationService, type ReleaseCandidateMetricEvidence } from '../src/services/formal-release/formalValidationService.js'
import { formalValidationDefinitionHash, formalValidationProfileSetHash, type FormalValidationProfileSet } from '../src/services/formal-release/formalValidationProfileService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'
import { FORMAL_RELEASE_CANDIDATES, FORMAL_RELEASE_CANDIDATE_VERSIONS } from '../src/services/formal-release/releaseCandidateSetService.js'
import { portfolioBacktestEngine } from '../src/services/portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../src/services/portfolio-backtest/portfolioBacktestInputBuilder.js'
import type { PortfolioBacktestStrategyResult, PortfolioDividendPolicy, PortfolioRebalanceFrequency } from '../src/services/portfolio-backtest/portfolioBacktestTypes.js'

const USER_ID = 'default'
const START_DATE = '2025-09-11'
const END_DATE = '2026-09-11'
const WINDOW_COUNT = 6
const TRAINING_DAYS = 60
const VALIDATION_DAYS = 60
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const

type Json = Record<string, any>
type SourcePoint = { date: string; close: number; volume?: number }
type SourceSeriesCheck = { symbol: string; status: string; primary: SourcePoint[]; contentHash: string }
type DividendEvent = { date: string; cashPerShare: number; evidenceRef: string }

function auditDir(now: Date) {
  return resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3', now.toISOString().replace(/[:.]/g, '-'))
}

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function writeJson(dir: string, fileName: string, value: unknown) {
  const path = resolve(dir, fileName)
  const persisted = JSON.parse(JSON.stringify(value))
  await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { path, sha256: sha256Canonical(persisted) }
}

async function latestPassedDir(stageId: 'A0' | 'FTR-1' | 'FTR-2', acceptanceFile: string, predicate: (value: Json) => boolean) {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', stageId)
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      const acceptance = await readJson(resolve(dir, acceptanceFile))
      if (predicate(acceptance)) return { dir, acceptance }
    } catch {
      continue
    }
  }
  throw new Error(`${stageId.toLowerCase()}_profile_bound_passed_artifact_not_found`)
}

async function protectedAccountDigest() {
  const [positions, transactions, drafts, externalOrders] = await Promise.all([
    prisma.position.findMany({ where: { userId: USER_ID }, select: { id: true, assetId: true, quantity: true, avgCost: true, currentPrice: true, marketValue: true, costBasis: true, unrealizedPnl: true, realizedPnl: true, status: true, updatedAt: true }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId: USER_ID }, select: { id: true, type: true, quantity: true, price: true, executedAt: true }, orderBy: { id: 'asc' } }),
    prisma.gridOrderDraft.findMany({ where: { gridPlan: { userId: USER_ID } }, select: { id: true, side: true, price: true, quantity: true, status: true }, orderBy: { id: 'asc' } }),
    prisma.externalOrderObservation.findMany({ where: { userId: USER_ID }, select: { id: true, externalOrderId: true, status: true }, orderBy: { id: 'asc' } }),
  ])
  return {
    positionCount: positions.length,
    openPositionCount: positions.filter((item) => item.status === 'open').length,
    positionHash: sha256Canonical(positions),
    transactionCount: transactions.length,
    transactionHash: sha256Canonical(transactions),
    draftCount: drafts.length,
    draftHash: sha256Canonical(drafts),
    externalOrderCount: externalOrders.length,
    externalOrderHash: sha256Canonical(externalOrders),
  }
}

async function buildInput(options: {
  strategyIds: string[]
  startDate: string
  endDate: string
  rebalanceFrequency?: PortfolioRebalanceFrequency
  dividendMode?: PortfolioDividendPolicy
  feeRate?: number
  slippageRate?: number
}) {
  process.env.FAMS_PORTFOLIO_DLV_BASKET_MIN_PRICE_BARS = String(VALIDATION_DAYS)
  return portfolioBacktestInputBuilder.build({
    userId: USER_ID,
    portfolioStrategyIds: options.strategyIds,
    releaseCandidateStrategyIds: options.strategyIds,
    releaseCandidateStrategyVersions: Object.fromEntries(options.strategyIds.map((id) => [id, FORMAL_RELEASE_CANDIDATE_VERSIONS[id as keyof typeof FORMAL_RELEASE_CANDIDATE_VERSIONS]])),
    startDate: options.startDate,
    endDate: options.endDate,
    initialCapital: 100000,
    rebalanceFrequency: options.rebalanceFrequency || 'quarterly',
    dividendMode: options.dividendMode || 'reinvest',
    feeRate: options.feeRate ?? 0.0003,
    slippageRate: options.slippageRate ?? 0.0005,
    benchmarkIds: ['csi300_total_return_h00300'],
    gradeMode: 'formal_review',
    ruleMode: 'registry_fixed',
  })
}

function commonDates(seriesChecks: SourceSeriesCheck[], benchmarkPoints: Array<{ date: string }>) {
  const sets = seriesChecks.map((check) => new Set(check.primary.map((point) => point.date)))
  const benchmarkDates = new Set(benchmarkPoints.map((point) => point.date))
  return [...sets[0]].filter((date) => benchmarkDates.has(date) && sets.every((set) => set.has(date))).sort()
}

function freezeWindows(dates: string[]) {
  const firstEndIndex = TRAINING_DAYS + VALIDATION_DAYS - 1
  assert.ok(dates.length > firstEndIndex, `common_date_count_below_${firstEndIndex + 1}`)
  return Array.from({ length: WINDOW_COUNT }, (_, index) => {
    const endIndex = Math.round(firstEndIndex + ((dates.length - 1 - firstEndIndex) * index) / (WINDOW_COUNT - 1))
    return {
      windowId: `wf-${String(index + 1).padStart(2, '0')}`,
      trainingStartDate: dates[endIndex - (TRAINING_DAYS + VALIDATION_DAYS) + 1],
      trainingEndDate: dates[endIndex - VALIDATION_DAYS],
      validationStartDate: dates[endIndex - VALIDATION_DAYS + 1],
      validationEndDate: dates[endIndex],
      trainingSampleSize: TRAINING_DAYS,
      configuredValidationSampleSize: VALIDATION_DAYS,
      parameterSnapshotHash: '',
    }
  }).map((window) => ({
    ...window,
    parameterSnapshotHash: sha256Canonical({
      profile: 'equity_selection_release_v1',
      candidateId: 'dividend_low_vol_basket',
      rebalanceFrequency: 'quarterly',
      dividendMode: 'reinvest',
      feeRate: 0.0003,
      slippageRate: 0.0005,
      trainingStartDate: window.trainingStartDate,
      trainingEndDate: window.trainingEndDate,
    }),
  }))
}

function resultEvidence(result: {
  status: string
  definition: PortfolioBacktestStrategyResult['definition']
  metrics: PortfolioBacktestStrategyResult['metrics']
  dataCoverage: PortfolioBacktestStrategyResult['dataCoverage']
  blockedReasons: string[]
  equityCurve: PortfolioBacktestStrategyResult['equityCurve']
}) {
  return {
    status: result.status,
    strategyId: result.definition.strategyId,
    strategyVersion: result.definition.strategyVersion,
    metrics: result.metrics,
    dataCoverage: result.dataCoverage,
    blockedReasons: result.blockedReasons,
    curve: result.equityCurve,
  }
}

function round(value: number, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function parseIndustryRefs(refs: string[]) {
  const result = new Map<string, string>()
  for (const ref of refs) {
    const match = ref.match(/^formal-industry:[01]\.(\d{6}):(.+):[a-f0-9]{64}$/)
    if (match) result.set(match[1], match[2])
  }
  return result
}

function median(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
}

function quantileBuckets<T>(values: T[], score: (item: T) => number, ids: [string, string, string]) {
  const sorted = [...values].sort((left, right) => score(left) - score(right))
  return sorted.map((item, index) => ({
    item,
    groupId: ids[Math.min(2, Math.floor((index * 3) / Math.max(1, sorted.length)))],
  }))
}

async function main() {
  await initializePrisma()
  const checkedAt = new Date()
  const dir = auditDir(checkedAt)
  await mkdir(dir, { recursive: true })
  const before = await protectedAccountDigest()

  const a0 = await latestPassedDir('A0', 'a0_acceptance_audit.json', (value) => value.status === 'passed' && value.validationProfileSetFrozen === true)
  const profileSet = await readJson(resolve(a0.dir, 'validation_profile_set.json')) as FormalValidationProfileSet
  const candidateSetArtifact = await readJson(resolve(a0.dir, 'release_candidate_set.json'))
  const { profileSetHash } = profileSet
  assert.equal(profileSetHash, formalValidationProfileSetHash(profileSet))
  assert.equal(a0.acceptance.validationProfileSetHash, profileSetHash)

  const ftr1 = await latestPassedDir('FTR-1', '15_data_governance_audit.json', (value) => value.status === 'passed' && value.validationProfileSet?.profileSetHash === profileSetHash)
  const ftr2 = await latestPassedDir('FTR-2', '16_benchmark_qualification_audit.json', (value) => value.status === 'passed' && value.validationProfileSetHash === profileSetHash)
  const sourceEvidence = await readJson(resolve(ftr1.dir, 'public_market_bundle_source_evidence.json'))
  const fieldEvidence = await readJson(resolve(ftr1.dir, 'field_evidence_validation_audit.json'))
  const benchmarkReplay = await readJson(resolve(ftr2.dir, 'benchmark_total_return_replay.json'))
  const benchmarkArtifact = await readJson(benchmarkReplay.benchmarkArtifactPath)
  assert.equal(ftr2.acceptance.candidateBenchmarkMappings.length, 1)
  assert.equal(ftr2.acceptance.candidateBenchmarkMappings[0].candidateId, 'dividend_low_vol_basket')

  const inventoryInput = await buildInput({ strategyIds: [...FORMAL_RELEASE_CANDIDATES], startDate: START_DATE, endDate: END_DATE })
  assert.deepEqual(inventoryInput.strategies.map((definition) => definition.strategyId), [...FORMAL_RELEASE_CANDIDATES])
  for (const assignment of profileSet.candidateAssignments) {
    const definition = inventoryInput.strategies.find((item) => item.strategyId === assignment.candidateId)
    assert.ok(definition, `candidate_definition_missing:${assignment.candidateId}`)
    assert.equal(formalValidationDefinitionHash(definition), assignment.definitionHash, `candidate_definition_hash_mismatch:${assignment.candidateId}`)
  }
  const inventoryResults = await portfolioBacktestEngine.runFormalValidationStrategies(inventoryInput)

  const productAssignment = profileSet.candidateAssignments.find((item) => item.candidateId === 'dividend_low_vol_basket')!
  const productSeries = (sourceEvidence.seriesChecks as SourceSeriesCheck[])
    .filter((check) => productAssignment.componentIds.includes(check.symbol))
  assert.equal(productSeries.length, productAssignment.componentIds.length)
  assert.ok(productSeries.every((check) => check.status === 'passed'))
  const frozenProductDefinition = inventoryInput.strategies.find((item) => item.strategyId === 'dividend_low_vol_basket')!
  assert.equal(formalValidationDefinitionHash(frozenProductDefinition), productAssignment.definitionHash)
  const formalPriceSeries = Object.fromEntries(productSeries.map((check) => [check.symbol, check.primary]))
  const formalSourceEvidenceRefs = productSeries.map((check) => `formal-source-series:${check.symbol}:${check.contentHash}`)
  const dividendRows = await prisma.dividendLowVolDaily.findMany({
    where: { userId: USER_ID, symbol: { in: productAssignment.componentIds } },
    orderBy: [{ symbol: 'asc' }, { tradeDate: 'desc' }],
    select: { symbol: true, factsetJson: true },
  })
  const latestDividendRowBySymbol = new Map<string, typeof dividendRows[number]>()
  for (const row of dividendRows) if (!latestDividendRowBySymbol.has(row.symbol)) latestDividendRowBySymbol.set(row.symbol, row)
  const frozenDividendHashes = new Map((sourceEvidence.dividendFactHashes as Array<{ symbol: string; hash: string }>).map((item) => [item.symbol, item.hash]))
  const dividendEvents: Record<string, DividendEvent[]> = {}
  for (const symbol of productAssignment.componentIds) {
    const row = latestDividendRowBySymbol.get(symbol)
    assert.ok(row, `dividend_factset_missing:${symbol}`)
    assert.equal(sha256Canonical(row.factsetJson), frozenDividendHashes.get(symbol), `dividend_factset_hash_mismatch:${symbol}`)
    const factset = parseJson<Json>(row.factsetJson, {})
    const history = Array.isArray(factset.dividend?.cashDividendPerShareHistory)
      ? factset.dividend.cashDividendPerShareHistory
      : []
    dividendEvents[symbol] = history
      .map((event: Json) => ({
        date: String(event.exDividendDate || '').slice(0, 10),
        cashPerShare: Number(event.dividendPerShare),
        evidenceRef: String(event.evidenceRef || ''),
      }))
      .filter((event: DividendEvent) => /^\d{4}-\d{2}-\d{2}$/.test(event.date)
        && event.date >= START_DATE
        && event.date <= END_DATE
        && Number.isFinite(event.cashPerShare)
        && event.cashPerShare > 0
        && event.evidenceRef.startsWith('dividend:eastmoney:'))
    assert.ok(dividendEvents[symbol].length > 0, `formal_window_dividend_event_missing:${symbol}`)
  }
  const dividendEvidenceRefs = Object.values(dividendEvents).flat().map((event) => event.evidenceRef).sort()
  const dates = commonDates(productSeries, benchmarkArtifact.points)
  const windows = freezeWindows(dates)
  const windowResults = []
  for (const window of windows) {
    const result = portfolioBacktestEngine.runFormalValidationStrategyWithSeries({
      definition: frozenProductDefinition,
      priceSeries: formalPriceSeries,
      benchmarkId: 'csi300_total_return_h00300',
      benchmarkPoints: benchmarkArtifact.points,
      startDate: window.validationStartDate,
      endDate: window.validationEndDate,
      sourceEvidenceRefs: formalSourceEvidenceRefs,
      dividendEvents,
    })
    const validationSampleSize = result.equityCurve.length
    const annualizedTurnoverPercent = result.metrics.turnoverRate === null
      ? null
      : round(result.metrics.turnoverRate * (252 / Math.max(1, validationSampleSize)), 4)
    const passed = result.status === 'completed'
      && validationSampleSize >= VALIDATION_DAYS
      && (result.metrics.excessReturnPercent ?? Number.NEGATIVE_INFINITY) >= 0
      && (result.metrics.maxDrawdownPercent ?? Number.NEGATIVE_INFINITY) >= -35
      && (annualizedTurnoverPercent ?? Number.POSITIVE_INFINITY) <= 200
      && result.dataCoverage.priceCoveragePercent >= 80
      && (result.dataCoverage.benchmarkCoveragePercent ?? 0) >= 80
    windowResults.push({
      ...window,
      validationSampleSize,
      totalReturnPercent: result.metrics.totalReturnPercent,
      benchmarkReturnPercent: result.metrics.benchmarkReturnPercent,
      excessReturnPercent: result.metrics.excessReturnPercent,
      maxDrawdownPercent: result.metrics.maxDrawdownPercent,
      annualizedTurnoverPercent,
      dataQualityStatus: result.dataCoverage.priceCoveragePercent >= 80 && (result.dataCoverage.benchmarkCoveragePercent ?? 0) >= 80 ? 'passed' : 'insufficient',
      status: passed ? 'passed' : 'failed',
      requestHash: sha256Canonical({ definitionHash: productAssignment.definitionHash, window }),
      resultHash: sha256Canonical(resultEvidence(result)),
      blockers: [
        ...(validationSampleSize >= VALIDATION_DAYS ? [] : ['validation_sample_below_60']),
        ...((result.metrics.excessReturnPercent ?? Number.NEGATIVE_INFINITY) >= 0 ? [] : ['excess_return_negative']),
        ...((result.metrics.maxDrawdownPercent ?? Number.NEGATIVE_INFINITY) >= -35 ? [] : ['max_drawdown_below_minus_35']),
        ...((annualizedTurnoverPercent ?? Number.POSITIVE_INFINITY) <= 200 ? [] : ['annualized_turnover_above_200']),
      ],
    })
  }
  const passedWindows = windowResults.filter((window) => window.status === 'passed').length
  const validWindowCount = windowResults.filter((window) => window.validationSampleSize >= VALIDATION_DAYS).length
  const walkForwardPassedRatio = round(passedWindows / windowResults.length, 6)

  const variants = [
    { variantId: 'baseline_quarterly_reinvest', rebalanceFrequency: 'quarterly' as const, dividendMode: 'reinvest' as const, feeRate: 0.0003, slippageRate: 0.0005 },
    { variantId: 'monthly_rebalance', rebalanceFrequency: 'monthly' as const, dividendMode: 'reinvest' as const, feeRate: 0.0003, slippageRate: 0.0005 },
    { variantId: 'fee_plus_20bp', rebalanceFrequency: 'quarterly' as const, dividendMode: 'reinvest' as const, feeRate: 0.0023, slippageRate: 0.0005 },
    { variantId: 'slippage_plus_20bp', rebalanceFrequency: 'quarterly' as const, dividendMode: 'reinvest' as const, feeRate: 0.0003, slippageRate: 0.0025 },
    { variantId: 'cash_dividend', rebalanceFrequency: 'quarterly' as const, dividendMode: 'cash' as const, feeRate: 0.0003, slippageRate: 0.0005 },
  ]
  const replayVariants = []
  for (const variant of variants) {
    const definition = {
      ...frozenProductDefinition,
      rebalancePolicy: { ...frozenProductDefinition.rebalancePolicy, frequency: variant.rebalanceFrequency },
      dividendPolicy: variant.dividendMode,
      costModel: { ...frozenProductDefinition.costModel, feeRate: variant.feeRate, slippageRate: variant.slippageRate },
    }
    const result = portfolioBacktestEngine.runFormalValidationStrategyWithSeries({
      definition,
      priceSeries: formalPriceSeries,
      benchmarkId: 'csi300_total_return_h00300',
      benchmarkPoints: benchmarkArtifact.points,
      startDate: START_DATE,
      endDate: END_DATE,
      sourceEvidenceRefs: formalSourceEvidenceRefs,
      dividendEvents,
    })
    assert.equal(result.status, 'completed')
    replayVariants.push({
      variantId: variant.variantId,
      requestHash: sha256Canonical({ definition, startDate: START_DATE, endDate: END_DATE }),
      resultHash: sha256Canonical(resultEvidence(result)),
      totalReturnPercent: result.metrics.totalReturnPercent!,
      maxDrawdownPercent: result.metrics.maxDrawdownPercent!,
      annualizedTurnoverPercent: round((result.metrics.turnoverRate || 0) * (252 / result.equityCurve.length), 4),
      costDragPercent: result.metrics.costDragPercent ?? 0,
      dividendContributionPercent: result.metrics.dividendContributionPercent,
      evidenceRefs: [
        `portfolio-backtest-engine:${variant.variantId}:${START_DATE}:${END_DATE}`,
        ...(variant.dividendMode === 'cash' ? dividendEvidenceRefs : []),
      ],
    })
  }
  const returns = replayVariants.map((item) => item.totalReturnPercent)
  const drawdowns = replayVariants.map((item) => item.maxDrawdownPercent)
  const bestWorstReturnSpreadPercentPoints = round(Math.max(...returns) - Math.min(...returns), 6)
  const maxDrawdownSpreadPercentPoints = round(Math.max(...drawdowns) - Math.min(...drawdowns), 6)
  const baseline = replayVariants[0]
  const stableVariants = replayVariants.filter((item) => Math.abs(item.totalReturnPercent - baseline.totalReturnPercent) <= 15
    && Math.abs(item.maxDrawdownPercent - baseline.maxDrawdownPercent) <= 10)
  const stableParameterSetRatio = round(stableVariants.length / replayVariants.length, 6)
  const parameterReplay = {
    schemaVersion: 'fams.ftr_3.parameter_replay.v1',
    stageId: 'FTR-3',
    status: stableParameterSetRatio >= 0.6 && bestWorstReturnSpreadPercentPoints <= 15 && maxDrawdownSpreadPercentPoints <= 10 ? 'passed' : 'failed',
    candidateId: 'dividend_low_vol_basket',
    validationProfileId: 'equity_selection_release_v1',
    baselineVariantId: baseline.variantId,
    variants: replayVariants,
    testedParameterSets: replayVariants.length,
    stableParameterSetRatio,
    bestWorstReturnSpreadPercentPoints,
    maxDrawdownSpreadPercentPoints,
    dividendReplayMethod: 'qfq_total_return_to_reserved_cash_on_real_ex_dividend_date',
    dividendEventCount: dividendEvidenceRefs.length,
    dividendEvidenceRefs,
    realDataUsed: true,
    inputHash: sha256Canonical({ profileSetHash, variants, startDate: START_DATE, endDate: END_DATE, dividendEvents }),
    notTradingAdvice: true,
  }

  const walkForwardReplay = {
    schemaVersion: 'fams.ftr_3.walk_forward_replay.v1',
    stageId: 'FTR-3',
    candidateId: 'dividend_low_vol_basket',
    validationProfileId: 'equity_selection_release_v1',
    windowSelectionAlgorithm: 'six_equal_distance_endpoints_after_60_training_plus_60_validation_common_trading_days',
    configuredWindowCount: WINDOW_COUNT,
    configuredTrainingDays: TRAINING_DAYS,
    configuredValidationDays: VALIDATION_DAYS,
    windows: windowResults,
    validWindowCount,
    passedWindowCount: passedWindows,
    passedRatio: walkForwardPassedRatio,
    status: walkForwardPassedRatio >= 0.6 ? 'passed' : 'failed',
    inputHash: sha256Canonical({ profileSetHash, dates, windows, sourceHashes: productSeries.map((item) => item.contentHash), benchmarkPointsHash: sha256Canonical(benchmarkArtifact.points) }),
    realDataUsed: true,
    notTradingAdvice: true,
  }

  const industryRefs = fieldEvidence.items.find((item: Json) => item.candidateStrategyId === 'dividend_low_vol_basket' && item.fieldId === 'industryClassification')?.evidenceRefs || []
  const industryBySymbol = parseIndustryRefs(industryRefs)
  assert.equal(industryBySymbol.size, productAssignment.componentIds.length)
  const validWindowCountForGroups = windowResults.filter((window) => window.validationSampleSize >= VALIDATION_DAYS).length
  const industryGroups = [...new Set(industryBySymbol.values())].sort().map((industry) => {
    const symbols = [...industryBySymbol.entries()].filter(([, value]) => value === industry).map(([symbol]) => symbol)
    return {
      groupId: `industry:${industry}`,
      effectivePathCount: symbols.length * validWindowCountForGroups,
      sampleCoveragePercent: 100,
      status: symbols.length * validWindowCountForGroups >= 3 ? 'passed' : 'insufficient',
      evidenceRefs: symbols.map((symbol) => `ftr-1:industry:${symbol}:${industry}`),
    }
  })
  const regimeAssignments = quantileBuckets(windowResults, (window) => window.benchmarkReturnPercent || 0, ['market:down', 'market:neutral', 'market:up'])
  const marketRegimeGroups = ['market:down', 'market:neutral', 'market:up'].map((groupId) => {
    const members = regimeAssignments.filter((item) => item.groupId === groupId)
    return {
      groupId,
      effectivePathCount: members.length * productAssignment.componentIds.length,
      sampleCoveragePercent: 100,
      status: members.length > 0 ? 'passed' : 'insufficient',
      evidenceRefs: members.map((item) => `walk-forward:${item.item.windowId}:${item.item.resultHash}`),
    }
  })
  const liquidityScores = productSeries.map((check) => ({
    symbol: check.symbol,
    medianVolume: median(check.primary.map((point) => point.volume || 0).filter((value) => value > 0)),
    contentHash: check.contentHash,
  }))
  assert.ok(liquidityScores.every((item) => item.medianVolume > 0), 'liquidity_volume_evidence_missing')
  const liquidityAssignments = quantileBuckets(liquidityScores, (item) => item.medianVolume, ['liquidity:low', 'liquidity:medium', 'liquidity:high'])
  const liquidityGroups = ['liquidity:low', 'liquidity:medium', 'liquidity:high'].map((groupId) => {
    const members = liquidityAssignments.filter((item) => item.groupId === groupId)
    return {
      groupId,
      effectivePathCount: members.length * validWindowCountForGroups,
      sampleCoveragePercent: 100,
      status: members.length > 0 ? 'passed' : 'insufficient',
      evidenceRefs: members.map((item) => `ftr-1:liquidity:${item.item.symbol}:${item.item.contentHash}`),
    }
  })
  const industryGroupCount = industryGroups.filter((group) => group.status === 'passed').length
  const marketRegimeGroupCount = marketRegimeGroups.filter((group) => group.status === 'passed').length
  const liquidityGroupCount = liquidityGroups.filter((group) => group.status === 'passed').length
  const groupStability = {
    schemaVersion: 'fams.ftr_3.group_stability.v1',
    stageId: 'FTR-3',
    status: industryGroupCount >= 3 && marketRegimeGroupCount >= 3 && liquidityGroupCount >= 3 ? 'passed' : 'insufficient',
    candidateId: 'dividend_low_vol_basket',
    validationProfileId: 'equity_selection_release_v1',
    industryGroups,
    marketRegimeGroups,
    liquidityGroups,
    industryGroupCount,
    marketRegimeGroupCount,
    liquidityGroupCount,
    algorithm: {
      industry: 'FTR-1 frozen public classification; group path count = symbols x valid windows',
      marketRegime: 'six frozen benchmark-window returns sorted into deterministic terciles',
      liquidity: 'FTR-1 primary-series positive median volume sorted into deterministic terciles',
    },
    inputHash: sha256Canonical({ profileSetHash, industryRefs, windowResults, liquidityScores }),
    realDataUsed: true,
    notTradingAdvice: true,
  }

  const tradeabilityPaths = productSeries.flatMap((check) => windows.map((window) => {
    const points = check.primary.filter((point) => point.date >= window.validationStartDate && point.date <= window.validationEndDate)
    const coveredPoints = points.filter((point) => Number.isFinite(point.close) && point.close > 0 && Number.isFinite(point.volume) && Number(point.volume) > 0).length
    return {
      symbol: check.symbol,
      windowId: window.windowId,
      requiredPoints: VALIDATION_DAYS,
      coveredPoints,
      coveragePercent: round((coveredPoints / VALIDATION_DAYS) * 100, 2),
      status: coveredPoints / VALIDATION_DAYS >= 0.8 ? 'passed' : 'blocked',
      evidenceRef: `formal-tradeability-reconstruction:${check.symbol}:${check.contentHash}`,
    }
  }))
  const tradeabilityCoveragePercent = round((tradeabilityPaths.filter((path) => path.status === 'passed').length / tradeabilityPaths.length) * 100, 2)
  const tradeabilityReconciliation = {
    schemaVersion: 'fams.ftr_3.tradeability_reconciliation.v1',
    stageId: 'FTR-3',
    status: tradeabilityCoveragePercent >= 80 ? 'passed' : 'blocked',
    candidateId: 'dividend_low_vol_basket',
    validationProfileId: 'equity_selection_release_v1',
    ftr1SourceEvidencePath: resolve(ftr1.dir, 'public_market_bundle_source_evidence.json'),
    componentIds: productAssignment.componentIds,
    windowIds: windows.map((window) => window.windowId),
    denominatorDefinition: 'frozen_candidate_component_x_frozen_validation_window',
    requiredPathCount: productAssignment.componentIds.length * windows.length,
    coveredPathCount: tradeabilityPaths.filter((path) => path.status === 'passed').length,
    coveragePercent: tradeabilityCoveragePercent,
    paths: tradeabilityPaths,
    barPresenceVolumeReconstructionOnly: true,
    exchangeOrderBookStatusClaimed: false,
    inputHash: sha256Canonical({ profileSetHash, components: productAssignment.componentIds, windows, sourceHashes: productSeries.map((item) => item.contentHash) }),
    realDataUsed: true,
    notTradingAdvice: true,
  }

  const parameterRef = await writeJson(dir, 'parameter_replay.json', parameterReplay)
  const walkForwardRef = await writeJson(dir, 'walk_forward_replay.json', walkForwardReplay)
  const groupRef = await writeJson(dir, 'group_stability.json', groupStability)
  const tradeabilityRef = await writeJson(dir, 'tradeability_reconciliation.json', tradeabilityReconciliation)
  const profileRef = await writeJson(dir, 'validation_profile_set.json', profileSet)

  const candidateSet = formalValidationService.freezeCandidateSet({
    releaseCandidateStrategyIds: [...FORMAL_RELEASE_CANDIDATES],
    releaseCandidateStrategyVersions: { ...FORMAL_RELEASE_CANDIDATE_VERSIONS },
    excludedStrategies: [],
  })
  const metrics: ReleaseCandidateMetricEvidence[] = inventoryResults.map((result) => {
    if (result.definition.strategyId === 'dividend_low_vol_basket') {
      return {
        strategyId: result.definition.strategyId,
        strategyVersion: result.definition.strategyVersion,
        releaseEffectivePathCount: productAssignment.componentIds.length * validWindowCountForGroups,
        industryGroupCount,
        marketRegimeGroupCount,
        liquidityGroupCount,
        walkForwardWindows: windowResults.length,
        walkForwardPassedRatio,
        oosStatus: walkForwardPassedRatio >= 0.6 ? 'passed' : 'failed',
        parameterSensitivityStatus: parameterReplay.status === 'passed' ? 'passed' : 'failed',
        groupStabilityStatus: groupStability.status === 'passed' ? 'passed' : 'insufficient',
        tradeConstraintsComplete: tradeabilityReconciliation.status === 'passed',
        benchmarkStatus: ftr2.acceptance.benchmarkType,
        benchmarkQualificationPassed: ftr2.acceptance.benchmarkQualificationPassed,
        evidenceRefs: [parameterRef.path, walkForwardRef.path, groupRef.path, tradeabilityRef.path, ...windowResults.map((window) => `walk-forward:${window.windowId}:${window.resultHash}`)],
        failureTaxonomy: windowResults.flatMap((window) => window.blockers),
      }
    }
    return {
      strategyId: result.definition.strategyId,
      strategyVersion: result.definition.strategyVersion,
      releaseEffectivePathCount: 0,
      industryGroupCount: 0,
      marketRegimeGroupCount: 0,
      liquidityGroupCount: 0,
      walkForwardWindows: result.modelEffectiveness?.walkForward.windows || 0,
      walkForwardPassedRatio: result.modelEffectiveness?.walkForward.passRatioPercent === null || result.modelEffectiveness?.walkForward.passRatioPercent === undefined ? null : result.modelEffectiveness.walkForward.passRatioPercent / 100,
      oosStatus: result.modelEffectiveness?.oos.status || (result.status === 'completed' ? 'warning' : 'insufficient'),
      parameterSensitivityStatus: result.modelEffectiveness?.parameterSensitivityStatus || 'insufficient',
      groupStabilityStatus: 'not_applicable',
      tradeConstraintsComplete: false,
      benchmarkStatus: 'unavailable',
      benchmarkQualificationPassed: false,
      evidenceRefs: result.evidenceRefs,
      failureTaxonomy: [...result.blockedReasons, ...(result.modelEffectiveness?.failureTaxonomy || [])],
    }
  })
  const formalValidationAudit = formalValidationService.evaluate({ candidateSet, metrics, validationProfileSet: profileSet })
  const after = await protectedAccountDigest()
  assert.deepEqual(after, before, 'FTR-3 must not mutate account, transaction, draft, or order facts')

  const candidateSetRef = await writeJson(dir, 'release_candidate_set.json', candidateSet)
  const failureTaxonomy = {
    schemaVersion: 'fams.ftr_3.validation_failure_taxonomy.v1',
    stageId: 'FTR-3',
    status: formalValidationAudit.status,
    candidateInventoryCount: formalValidationAudit.checks.length,
    productReleaseCandidateCount: formalValidationAudit.productReleaseCandidateCount,
    checks: formalValidationAudit.checks.map((check) => ({
      strategyId: check.strategyId,
      candidateRole: check.candidateRole,
      formalGateApplicable: check.formalGateApplicable,
      formalGateStatus: check.formalGateStatus,
      resultStatus: check.status,
      blockers: check.blockers,
      evidenceRefs: check.evidenceRefs,
    })),
    blockers: formalValidationAudit.blockers,
    nonApplicableObjectsRemainVisible: formalValidationAudit.notApplicableStrategies === 6,
    prohibitedActions: [...PROHIBITED_ACTIONS],
    notTradingAdvice: true,
  }
  const taxonomyRef = await writeJson(dir, 'validation_failure_taxonomy.json', failureTaxonomy)
  const auditWithEvidence = {
    ...formalValidationAudit,
    accountFactsUnchanged: true,
    evidenceArtifacts: {
      candidateSet: candidateSetRef,
      validationProfileSet: profileRef,
      parameterReplay: parameterRef,
      walkForwardReplay: walkForwardRef,
      groupStability: groupRef,
      tradeabilityReconciliation: tradeabilityRef,
      failureTaxonomy: taxonomyRef,
    },
  }
  const auditRef = await writeJson(dir, '17_formal_validation_audit.json', auditWithEvidence)
  console.log(JSON.stringify({
    ...auditWithEvidence,
    windowResults,
    auditDir: dir,
    auditRef,
  }, null, 2))
  if (formalValidationAudit.formalValidationPassed !== true) process.exitCode = 2
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
