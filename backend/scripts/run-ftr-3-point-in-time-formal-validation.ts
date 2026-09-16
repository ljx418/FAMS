import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { benchmarkContentHash } from '../src/services/formal-release/formalBenchmarkService.js'
import { formalValidationService, type ReleaseCandidateMetricEvidence } from '../src/services/formal-release/formalValidationService.js'
import { formalValidationProfileSetHash, type FormalValidationProfileSet } from '../src/services/formal-release/formalValidationProfileService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const USER_ID = 'default'
const CANDIDATE_VERSION = 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time'
const CANDIDATE_SET_VERSION = '2026-09-15.point-in-time-candidate-v2'
const PROFILE_VERSION = '2026-09-15.route-a-point-in-time-v2'
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const

type Json = Record<string, any>

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8'))
}

function sha256Bytes(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function fileRef(path: string) {
  return { path, sha256: sha256Bytes(await readFile(path)) }
}

async function writeJson(dir: string, fileName: string, value: unknown) {
  const path = resolve(dir, fileName)
  const persisted = JSON.parse(JSON.stringify(value))
  await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { path, sha256: sha256Canonical(persisted) }
}

async function latestValidDir(stageId: 'A0' | 'FTR-1' | 'FTR-2', fileName: string, predicate: (value: Json) => boolean) {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', stageId)
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      await readFile(resolve(dir, 'INVALIDATED.json'))
      continue
    } catch {
      // A missing invalidation marker means the run remains eligible.
    }
    try {
      const artifact = await readJson(resolve(dir, fileName))
      if (predicate(artifact)) return { dir, artifact }
    } catch {
      // Ignore partial or profile-mismatched runs.
    }
  }
  throw new Error(`${stageId.toLowerCase()}_v2_evidence_not_found`)
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

function roundedRatio(numerator: number, denominator: number) {
  return Math.round((numerator / denominator) * 1_000_000) / 1_000_000
}

async function main() {
  await initializePrisma()
  const generatedAt = new Date()
  const outputDir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3', generatedAt.toISOString().replace(/[:.]/g, '-'))
  await mkdir(outputDir, { recursive: true })
  const before = await protectedAccountDigest()
  assert.ok(before.openPositionCount > 0, 'real_default_account_has_no_open_positions')

  const a0 = await latestValidDir('A0', 'a0_acceptance_audit.json', (value) => value.status === 'passed'
    && value.releaseCandidateSetVersion === CANDIDATE_SET_VERSION
    && value.productCandidateVersion === CANDIDATE_VERSION)
  const candidateSetSource = await readJson(resolve(a0.dir, 'release_candidate_set.json'))
  const profileSet = await readJson(resolve(a0.dir, 'validation_profile_set.json')) as FormalValidationProfileSet
  assert.equal(profileSet.setVersion, PROFILE_VERSION)
  assert.equal(profileSet.profileSetHash, formalValidationProfileSetHash(profileSet))
  const productAssignment = profileSet.candidateAssignments.find((item) => item.candidateId === 'dividend_low_vol_basket')
  assert.ok(productAssignment)
  assert.equal(productAssignment.candidateVersion, CANDIDATE_VERSION)
  assert.equal(productAssignment.componentSelectionMode, 'point_in_time_dynamic')
  assert.ok(productAssignment.selectionArtifactRef && productAssignment.selectionArtifactSha256)

  const r1Path = productAssignment.selectionArtifactRef
  const r1Raw = await readFile(r1Path)
  const r1 = JSON.parse(r1Raw.toString('utf8')) as Json
  assert.equal(sha256Bytes(r1Raw), productAssignment.selectionArtifactSha256)
  assert.equal(r1.status, 'passed')
  assert.equal(r1.candidateVersion, CANDIDATE_VERSION)
  assert.equal(r1.antiFalseGreen.failedWindowsRemoved, false)
  assert.equal(r1.antiFalseGreen.benchmarkChangedForPassing, false)
  assert.equal(r1.antiFalseGreen.thresholdReduced, false)
  assert.equal(r1.antiFalseGreen.historicalSecurityStatusProxyUsed, false)

  const ftr1 = await latestValidDir('FTR-1', '15_data_governance_audit.json', (value) => value.status === 'passed'
    && value.validationProfileSet?.profileSetHash === profileSet.profileSetHash
    && value.releaseCandidateSet?.version === CANDIDATE_SET_VERSION)
  const ftr2 = await latestValidDir('FTR-2', '16_benchmark_qualification_audit.json', (value) => value.status === 'passed'
    && value.validationProfileSetHash === profileSet.profileSetHash
    && value.candidateBenchmarkMappings?.[0]?.candidateVersion === CANDIDATE_VERSION)
  assert.equal(ftr1.artifact.releaseCandidateSet.contentHash, candidateSetSource.contentHash)

  const benchmarkReplay = await readJson(resolve(ftr2.dir, 'benchmark_total_return_replay.json'))
  const benchmarkArtifact = await readJson(benchmarkReplay.benchmarkArtifactPath)
  assert.equal(benchmarkContentHash(benchmarkArtifact), benchmarkArtifact.contentHash)
  const r1BenchmarkArtifact = await readJson(r1.benchmark.path)
  assert.equal(benchmarkContentHash(r1BenchmarkArtifact), r1.benchmark.sha256)
  assert.equal(r1BenchmarkArtifact.benchmarkId, benchmarkArtifact.benchmarkId)
  assert.equal(r1BenchmarkArtifact.benchmarkType, benchmarkArtifact.benchmarkType)
  assert.deepEqual(benchmarkArtifact.points.slice(0, r1BenchmarkArtifact.points.length), r1BenchmarkArtifact.points)

  const windows = r1.walkForward.windows as Json[]
  assert.deepEqual(windows.map((item) => item.windowId), ['wf-01', 'wf-02', 'wf-03', 'wf-04', 'wf-05', 'wf-06'])
  assert.equal(windows.filter((item) => item.status !== 'insufficient').length, 6)
  assert.equal(windows.filter((item) => item.status === 'passed').length, 5)
  assert.deepEqual(windows.filter((item) => item.status === 'failed').map((item) => item.windowId), ['wf-04'])
  assert.equal(r1.walkForward.passedRatio, roundedRatio(5, 6))
  for (const window of windows) {
    const expectedPassed = window.validationSampleSize >= 60
      && window.priceCoveragePercent >= 80
      && window.benchmarkCoveragePercent >= 80
      && window.excessReturnPercent >= 0
      && window.maxDrawdownPercent >= -35
      && window.annualizedTurnoverPercent <= 200
    assert.equal(window.status === 'passed', expectedPassed, `window_status_mismatch:${window.windowId}`)
    const start = benchmarkArtifact.points.find((point: Json) => point.date === window.validationStartDate)
    const end = benchmarkArtifact.points.find((point: Json) => point.date === window.validationEndDate)
    assert.ok(start && end, `benchmark_window_missing:${window.windowId}`)
    const benchmarkReturn = Math.round(((end.value / start.value) - 1) * 1_000_000) / 10_000
    assert.equal(window.benchmarkReturnPercent, benchmarkReturn, `benchmark_return_mismatch:${window.windowId}`)
  }

  const variants = r1.parameterSensitivity.variants as Json[]
  assert.deepEqual(variants.map((item) => item.variantId), ['baseline_quarterly', 'monthly_rebalance', 'fee_plus_20bp', 'slippage_plus_20bp', 'fee_slippage_plus_10bp'])
  assert.equal(variants.filter((item) => item.status === 'completed').length, 5)
  assert.equal(r1.parameterSensitivity.stableParameterSetRatio, 1)
  assert.equal(r1.parameterSensitivity.bestWorstReturnSpreadPercentPoints <= 15, true)
  assert.equal(r1.parameterSensitivity.maxDrawdownSpreadPercentPoints <= 10, true)
  assert.equal(r1.parameterSensitivity.cashDividendVariant.countedAsTestedParameterSet, false)

  const r1Ref = { path: r1Path, sha256: sha256Bytes(r1Raw) }
  const ftr1Path = resolve(ftr1.dir, '15_data_governance_audit.json')
  const ftr1Ref = { path: ftr1Path, sha256: sha256Canonical(ftr1.artifact) }
  const a0Ref = { path: resolve(a0.dir, 'a0_acceptance_audit.json'), sha256: sha256Canonical(a0.artifact) }
  const ftr2Ref = { path: resolve(ftr2.dir, '16_benchmark_qualification_audit.json'), sha256: sha256Canonical(ftr2.artifact) }
  const benchmarkRef = await fileRef(benchmarkReplay.benchmarkArtifactPath)
  const paths: Json[] = []
  for (const window of windows) {
    const snapshotRaw = await readFile(window.sourceSnapshotPath)
    assert.equal(sha256Bytes(snapshotRaw), window.sourceSnapshotSha256)
    const snapshot = JSON.parse(snapshotRaw.toString('utf8')) as Json
    assert.equal(snapshot.decisionDate, window.decisionDate)
    assert.deepEqual(snapshot.selectedSymbols, window.selectedSymbols)
    const candidates = new Map((snapshot.candidates as Json[]).map((item) => [item.symbol, item]))
    for (const coverage of window.perSymbolPriceCoverage as Json[]) {
      const candidate = candidates.get(coverage.symbol)
      assert.ok(candidate, `selected_candidate_missing:${window.windowId}:${coverage.symbol}`)
      assert.equal(candidate.directTradeStatus, '1')
      assert.equal(candidate.directIsST, false)
      assert.equal(candidate.historicalStatusProxyUsed, false)
      assert.equal(candidate.tradeabilityResolved, true)
      const evidenceRef = (candidate.evidenceRefs as string[]).find((item) => item.startsWith(`free-source-historical-status:baostock:${coverage.symbol}:${window.decisionDate}:1:0:`))
      assert.ok(evidenceRef, `direct_status_evidence_missing:${window.windowId}:${coverage.symbol}`)
      paths.push({
        pathId: `${window.windowId}:${coverage.symbol}`,
        symbol: coverage.symbol,
        windowId: window.windowId,
        decisionDate: window.decisionDate,
        requiredPoints: 60,
        coveredPoints: coverage.coveredTradingDays,
        coveragePercent: coverage.priceCoveragePercent,
        directTradeStatus: candidate.directTradeStatus,
        directIsST: candidate.directIsST,
        historicalStatusProxyUsed: candidate.historicalStatusProxyUsed,
        status: coverage.priceCoveragePercent >= 80 ? 'passed' : 'insufficient',
        snapshotPath: window.sourceSnapshotPath,
        snapshotSha256: window.sourceSnapshotSha256,
        evidenceRef,
      })
    }
  }
  assert.equal(paths.length, 53)
  assert.equal(new Set(paths.map((item) => item.pathId)).size, 53)
  assert.equal(paths.every((item) => item.status === 'passed' && item.coveredPoints === 60), true)

  const candidateSet = formalValidationService.freezeCandidateSet({
    releaseCandidateStrategyIds: candidateSetSource.candidateIds,
    releaseCandidateStrategyVersions: candidateSetSource.candidateVersions,
    excludedStrategies: [],
  })
  const commonRefs = [
    `${a0Ref.path}#sha256:${a0Ref.sha256}`,
    `${ftr1Path}#sha256:${ftr1Ref.sha256}`,
    `${ftr2Ref.path}#sha256:${ftr2Ref.sha256}`,
    `${r1Path}#sha256:${r1Ref.sha256}`,
  ]
  const metrics: ReleaseCandidateMetricEvidence[] = profileSet.candidateAssignments.map((assignment) => assignment.formalGateApplicable
    ? {
        strategyId: assignment.candidateId,
        strategyVersion: assignment.candidateVersion,
        releaseEffectivePathCount: r1.groupStability.releaseEffectivePathCount,
        industryGroupCount: r1.groupStability.industryGroupCount,
        marketRegimeGroupCount: r1.groupStability.marketRegimeGroupCount,
        liquidityGroupCount: r1.groupStability.liquidityGroupCount,
        walkForwardWindows: r1.walkForward.validWindowCount,
        walkForwardPassedRatio: r1.walkForward.passedRatio,
        oosStatus: r1.walkForward.passedRatio >= 0.6 ? 'passed' : 'failed',
        parameterSensitivityStatus: r1.parameterSensitivity.status,
        groupStabilityStatus: r1.groupStability.status,
        tradeConstraintsComplete: paths.every((item) => item.status === 'passed'),
        benchmarkStatus: ftr2.artifact.benchmarkType,
        benchmarkQualificationPassed: ftr2.artifact.benchmarkQualificationPassed,
        evidenceRefs: commonRefs,
        failureTaxonomy: [],
      }
    : {
        strategyId: assignment.candidateId,
        strategyVersion: assignment.candidateVersion,
        releaseEffectivePathCount: 0,
        industryGroupCount: 0,
        marketRegimeGroupCount: 0,
        liquidityGroupCount: 0,
        walkForwardWindows: 0,
        walkForwardPassedRatio: null,
        oosStatus: 'insufficient',
        parameterSensitivityStatus: 'insufficient',
        groupStabilityStatus: 'not_applicable',
        tradeConstraintsComplete: false,
        benchmarkStatus: 'unavailable',
        benchmarkQualificationPassed: false,
        evidenceRefs: [`profile-exclusion:${assignment.exclusionReason}`],
        failureTaxonomy: [],
      })
  const evaluated = formalValidationService.evaluate({ candidateSet, metrics, validationProfileSet: profileSet })
  assert.equal(evaluated.status, 'passed')
  assert.equal(evaluated.formalValidationPassed, true)

  const locks = { formalTradingUnlocked: false as const, autoTradeUnlocked: false as const, canCreateOrder: false as const, orderCreateAllowed: false as const }
  const candidateRef = await writeJson(outputDir, 'release_candidate_set.json', candidateSet)
  const profileRef = await writeJson(outputDir, 'validation_profile_set.json', profileSet)
  const walkForward = {
    schemaVersion: 'fams.ftr_3.point_in_time_walk_forward.v2', stageId: 'FTR-3', status: 'passed',
    candidateId: 'dividend_low_vol_basket', candidateVersion: CANDIDATE_VERSION,
    validationProfileSetHash: profileSet.profileSetHash, sourceR1: r1Ref, benchmarkArtifact: benchmarkRef,
    payloadSha256: sha256Canonical(r1.walkForward), walkForward: r1.walkForward, realDataUsed: true,
    failedWindowsPreserved: true, ...locks,
  }
  const parameters = {
    schemaVersion: 'fams.ftr_3.point_in_time_parameter_replay.v2', stageId: 'FTR-3', status: 'passed',
    candidateId: 'dividend_low_vol_basket', candidateVersion: CANDIDATE_VERSION, sourceR1: r1Ref,
    payloadSha256: sha256Canonical(r1.parameterSensitivity), parameterSensitivity: r1.parameterSensitivity,
    cashDividendAttributionNotClaimed: true, realDataUsed: true, ...locks,
  }
  const groups = {
    schemaVersion: 'fams.ftr_3.point_in_time_group_stability.v2', stageId: 'FTR-3', status: 'passed',
    candidateId: 'dividend_low_vol_basket', candidateVersion: CANDIDATE_VERSION, sourceR1: r1Ref,
    payloadSha256: sha256Canonical(r1.groupStability), groupStability: r1.groupStability, realDataUsed: true, ...locks,
  }
  const componentUnionIds = Array.from(new Set(paths.map((item) => item.symbol))).sort()
  assert.equal(componentUnionIds.length, 20)
  const tradeability = {
    schemaVersion: 'fams.ftr_3.point_in_time_tradeability.v2', stageId: 'FTR-3', status: 'passed',
    candidateId: 'dividend_low_vol_basket', candidateVersion: CANDIDATE_VERSION, validationProfileId: 'equity_selection_release_v1',
    sourceR1: r1Ref, ftr1DataGovernanceArtifact: ftr1Ref, denominatorDefinition: 'dynamic_selected_component_per_window',
    windowIds: windows.map((item) => item.windowId), componentUnionIds, requiredPathCount: paths.length,
    coveredPathCount: paths.filter((item) => item.status === 'passed').length, coveragePercent: 100, paths,
    directHistoricalStatusOnly: true, historicalStatusProxyUsed: false, inputHash: sha256Canonical(paths), realDataUsed: true, ...locks,
  }
  const parameterRef = await writeJson(outputDir, 'parameter_replay.json', parameters)
  const walkForwardRef = await writeJson(outputDir, 'walk_forward_replay.json', walkForward)
  const groupRef = await writeJson(outputDir, 'group_stability.json', groups)
  const tradeabilityRef = await writeJson(outputDir, 'tradeability_reconciliation.json', tradeability)
  const taxonomy = {
    schemaVersion: 'fams.ftr_3.validation_failure_taxonomy.v1', stageId: 'FTR-3', status: evaluated.status,
    candidateInventoryCount: profileSet.inventoryCount, productReleaseCandidateCount: profileSet.productReleaseCandidateIds.length,
    checks: evaluated.checks.map((check: Json) => ({
      strategyId: check.strategyId, candidateRole: check.candidateRole, formalGateApplicable: check.formalGateApplicable,
      formalGateStatus: check.formalGateStatus, resultStatus: check.status, blockers: check.blockers, evidenceRefs: check.evidenceRefs,
    })),
    blockers: evaluated.blockers, nonApplicableObjectsRemainVisible: true, prohibitedActions: [...PROHIBITED_ACTIONS], notTradingAdvice: true,
  }
  const taxonomyRef = await writeJson(outputDir, 'validation_failure_taxonomy.json', taxonomy)
  const after = await protectedAccountDigest()
  assert.deepEqual(after, before, 'FTR-3 must not mutate real account facts')
  const audit = {
    ...evaluated,
    generatedAt: generatedAt.toISOString(),
    realDataUsed: true,
    accountFactsUnchanged: true,
    protectedAccountDigestBefore: before,
    protectedAccountDigestAfter: after,
    sourceChain: { a0Acceptance: a0Ref, ftr1DataGovernance: ftr1Ref, ftr2BenchmarkQualification: ftr2Ref, r1CandidateValidation: r1Ref },
    evidenceArtifacts: {
      candidateSet: candidateRef,
      validationProfileSet: profileRef,
      parameterReplay: parameterRef,
      walkForwardReplay: walkForwardRef,
      groupStability: groupRef,
      tradeabilityReconciliation: tradeabilityRef,
      failureTaxonomy: taxonomyRef,
    },
  }
  const auditRef = await writeJson(outputDir, '17_formal_validation_audit.json', audit)
  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_3.point_in_time_formal_validation_run.v2', status: audit.status,
    outputDir, auditRef, validationProfileSetHash: profileSet.profileSetHash,
    candidateVersion: CANDIDATE_VERSION, validWindowCount: r1.walkForward.validWindowCount,
    passedWindowCount: r1.walkForward.passedWindowCount, failedWindowIds: ['wf-04'],
    releaseEffectivePathCount: r1.groupStability.releaseEffectivePathCount,
    formalValidationPassed: audit.formalValidationPassed, humanAcceptanceStatus: audit.humanAcceptanceStatus,
    accountFactsUnchanged: true, ...locks,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
