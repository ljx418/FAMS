import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { benchmarkContentHash } from '../src/services/formal-release/formalBenchmarkService.js'
import { formalValidationProfileSetHash } from '../src/services/formal-release/formalValidationProfileService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const USER_ID = 'default'

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}

function sha256Bytes(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function latestValidAuditDir() {
  if (process.env.FTR3_AUDIT_DIR) return resolve(process.env.FTR3_AUDIT_DIR)
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3')
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
      const audit = await readJson(resolve(dir, '17_formal_validation_audit.json'))
      if (audit.status === 'passed' && audit.formalValidationPassed === true) return dir
    } catch {
      // Ignore incomplete or non-passing runs.
    }
  }
  throw new Error('ftr_3_v2_passed_audit_not_found')
}

async function validateSchema(schemaFile: string, artifact: unknown) {
  const schema = await readJson(resolve(repoRoot, 'docs', 'contracts', schemaFile))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  assert.equal(validate(artifact), true, `${schemaFile}: ${JSON.stringify(validate.errors)}`)
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

function round(value: number, digits = 6) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

async function main() {
  await initializePrisma()
  const dir = await latestValidAuditDir()
  const artifacts = {
    audit: await readJson(resolve(dir, '17_formal_validation_audit.json')),
    candidateSet: await readJson(resolve(dir, 'release_candidate_set.json')),
    profileSet: await readJson(resolve(dir, 'validation_profile_set.json')),
    walkForward: await readJson(resolve(dir, 'walk_forward_replay.json')),
    parameters: await readJson(resolve(dir, 'parameter_replay.json')),
    groups: await readJson(resolve(dir, 'group_stability.json')),
    tradeability: await readJson(resolve(dir, 'tradeability_reconciliation.json')),
    taxonomy: await readJson(resolve(dir, 'validation_failure_taxonomy.json')),
  }
  await Promise.all([
    validateSchema('ftr-3-formal-validation-audit.schema.json', artifacts.audit),
    validateSchema('ftr-3-release-candidate-set.schema.json', artifacts.candidateSet),
    validateSchema('ftr-a0-validation-profile-set.schema.json', artifacts.profileSet),
    validateSchema('ftr-3-point-in-time-walk-forward.schema.json', artifacts.walkForward),
    validateSchema('ftr-3-point-in-time-parameter-replay.schema.json', artifacts.parameters),
    validateSchema('ftr-3-point-in-time-group-stability.schema.json', artifacts.groups),
    validateSchema('ftr-3-point-in-time-tradeability.schema.json', artifacts.tradeability),
    validateSchema('ftr-3-validation-failure-taxonomy.schema.json', artifacts.taxonomy),
  ])

  assert.equal(artifacts.profileSet.profileSetHash, formalValidationProfileSetHash(artifacts.profileSet))
  assert.equal(artifacts.profileSet.candidateSet.version, '2026-09-15.point-in-time-candidate-v2')
  assert.equal(artifacts.candidateSet.releaseCandidateStrategyVersions.dividend_low_vol_basket, 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time')
  assert.deepEqual(artifacts.profileSet.productReleaseCandidateIds, ['dividend_low_vol_basket'])
  assert.equal(artifacts.profileSet.candidateAssignments.filter((item: any) => item.formalGateApplicable).length, 1)

  for (const [name, ref] of Object.entries(artifacts.audit.sourceChain) as Array<[string, { path: string; sha256: string }]>) {
    const raw = await readFile(ref.path)
    const actual = name === 'r1CandidateValidation' ? sha256Bytes(raw) : sha256Canonical(JSON.parse(raw.toString('utf8')))
    assert.equal(actual, ref.sha256, `source chain hash mismatch: ${name}`)
  }
  const [a0, ftr1, ftr2, r1] = await Promise.all([
    readJson(artifacts.audit.sourceChain.a0Acceptance.path),
    readJson(artifacts.audit.sourceChain.ftr1DataGovernance.path),
    readJson(artifacts.audit.sourceChain.ftr2BenchmarkQualification.path),
    readJson(artifacts.audit.sourceChain.r1CandidateValidation.path),
  ])
  await validateSchema('ftr-3-point-in-time-candidate-validation.schema.json', r1)
  assert.equal(a0.validationProfileSetHash, artifacts.profileSet.profileSetHash)
  assert.equal(ftr1.validationProfileSet.profileSetHash, artifacts.profileSet.profileSetHash)
  assert.equal(ftr2.validationProfileSetHash, artifacts.profileSet.profileSetHash)
  assert.equal(ftr2.candidateBenchmarkMappings[0].candidateVersion, r1.candidateVersion)
  assert.deepEqual(artifacts.walkForward.walkForward, r1.walkForward)
  assert.deepEqual(artifacts.parameters.parameterSensitivity, r1.parameterSensitivity)
  assert.deepEqual(artifacts.groups.groupStability, r1.groupStability)
  assert.equal(artifacts.walkForward.payloadSha256, sha256Canonical(r1.walkForward))
  assert.equal(artifacts.parameters.payloadSha256, sha256Canonical(r1.parameterSensitivity))
  assert.equal(artifacts.groups.payloadSha256, sha256Canonical(r1.groupStability))

  const benchmarkRaw = await readFile(artifacts.walkForward.benchmarkArtifact.path)
  assert.equal(sha256Bytes(benchmarkRaw), artifacts.walkForward.benchmarkArtifact.sha256)
  const benchmark = JSON.parse(benchmarkRaw.toString('utf8'))
  assert.equal(benchmarkContentHash(benchmark), benchmark.contentHash)
  const windows = artifacts.walkForward.walkForward.windows
  assert.deepEqual(windows.map((item: any) => item.windowId), ['wf-01', 'wf-02', 'wf-03', 'wf-04', 'wf-05', 'wf-06'])
  assert.deepEqual(windows.filter((item: any) => item.status === 'failed').map((item: any) => item.windowId), ['wf-04'])
  for (const window of windows) {
    const start = benchmark.points.find((point: any) => point.date === window.validationStartDate)
    const end = benchmark.points.find((point: any) => point.date === window.validationEndDate)
    assert.ok(start && end)
    assert.equal(window.benchmarkReturnPercent, round(((end.value / start.value) - 1) * 100, 4))
    const expectedPassed = window.validationSampleSize >= 60 && window.priceCoveragePercent >= 80
      && window.benchmarkCoveragePercent >= 80 && window.excessReturnPercent >= 0
      && window.maxDrawdownPercent >= -35 && window.annualizedTurnoverPercent <= 200
    assert.equal(window.status === 'passed', expectedPassed, `window status mismatch: ${window.windowId}`)
  }

  const variants = artifacts.parameters.parameterSensitivity.variants
  const returns = variants.map((item: any) => item.averageTotalReturnPercent)
  const drawdowns = variants.map((item: any) => item.worstMaxDrawdownPercent)
  assert.equal(artifacts.parameters.parameterSensitivity.bestWorstReturnSpreadPercentPoints, round(Math.max(...returns) - Math.min(...returns)))
  assert.equal(artifacts.parameters.parameterSensitivity.maxDrawdownSpreadPercentPoints, round(Math.max(...drawdowns) - Math.min(...drawdowns)))
  assert.equal(variants.filter((item: any) => item.status === 'completed' && item.passedRatio >= 0.6).length, 5)
  assert.equal(artifacts.groups.groupStability.industryGroupCount, artifacts.groups.groupStability.industryGroups.filter((item: any) => item.status === 'passed').length)
  assert.equal(artifacts.groups.groupStability.marketRegimeGroupCount, artifacts.groups.groupStability.marketRegimeGroups.filter((item: any) => item.status === 'passed').length)
  assert.equal(artifacts.groups.groupStability.liquidityGroupCount, artifacts.groups.groupStability.liquidityGroups.filter((item: any) => item.status === 'passed').length)

  const paths = artifacts.tradeability.paths
  assert.equal(paths.length, windows.reduce((sum: number, item: any) => sum + item.selectedComponentCount, 0))
  assert.equal(new Set(paths.map((item: any) => item.pathId)).size, paths.length)
  assert.equal(artifacts.tradeability.inputHash, sha256Canonical(paths))
  for (const path of paths) {
    const snapshotRaw = await readFile(path.snapshotPath)
    assert.equal(sha256Bytes(snapshotRaw), path.snapshotSha256)
    const snapshot = JSON.parse(snapshotRaw.toString('utf8'))
    const candidate = snapshot.candidates.find((item: any) => item.symbol === path.symbol)
    assert.ok(candidate)
    assert.equal(candidate.directTradeStatus, '1')
    assert.equal(candidate.directIsST, false)
    assert.equal(candidate.historicalStatusProxyUsed, false)
    assert.ok(candidate.evidenceRefs.includes(path.evidenceRef))
  }

  assert.equal(artifacts.audit.strategyCount, 7)
  assert.equal(artifacts.audit.productReleaseCandidateCount, 1)
  assert.equal(artifacts.audit.notApplicableStrategies, 6)
  assert.equal(artifacts.audit.passedStrategies, 1)
  assert.equal(artifacts.audit.formalValidationPassed, true)
  assert.equal(artifacts.audit.allReleaseCandidatesPassed, true)
  assert.deepEqual(artifacts.audit.blockers, [])
  assert.equal(artifacts.taxonomy.nonApplicableObjectsRemainVisible, true)
  assert.equal(artifacts.taxonomy.checks.filter((item: any) => item.formalGateStatus === 'not_applicable').length, 6)
  assert.deepEqual(artifacts.audit.protectedAccountDigestAfter, artifacts.audit.protectedAccountDigestBefore)
  assert.deepEqual(await protectedAccountDigest(), artifacts.audit.protectedAccountDigestAfter)
  for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(artifacts.audit[field], false)
  assert.deepEqual(artifacts.audit.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])

  for (const [name, ref] of Object.entries(artifacts.audit.evidenceArtifacts) as Array<[string, { path: string; sha256: string }]>) {
    assert.equal(resolve(ref.path).startsWith(resolve(dir)), true, `artifact outside audit dir: ${name}`)
    assert.equal(sha256Canonical(await readJson(ref.path)), ref.sha256, `artifact hash mismatch: ${name}`)
  }

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_3.point_in_time_formal_validation_verification.v2',
    status: 'passed', auditDir: dir, schemaValidationPassed: true, semanticValidationPassed: true,
    sourceChainVerified: true, validWindowCount: 6, passedWindowCount: 5, failedWindowIds: ['wf-04'],
    releaseEffectivePathCount: paths.length, directHistoricalStatusPathCount: paths.length,
    formalValidationPassed: true, humanAcceptanceStatus: 'pending_batch_review',
    accountFactsUnchanged: true, formalTradingUnlocked: false, autoTradeUnlocked: false,
    canCreateOrder: false, orderCreateAllowed: false,
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
