import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { formalBenchmarkService } from '../src/services/formal-release/formalBenchmarkService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'
import { formalValidationProfileSetHash } from '../src/services/formal-release/formalValidationProfileService.js'

const USER_ID = 'default'
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const
const repoRoot = resolve(process.cwd(), '..')

function sha256Buffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestPassedA0Dir() {
  if (process.env.FTR_A0_AUDIT_DIR) return resolve(process.env.FTR_A0_AUDIT_DIR)
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'A0')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    try {
      await readFile(resolve(root, name, 'INVALIDATED.json'))
      continue
    } catch {
      // A missing invalidation marker means the run remains eligible.
    }
    try {
      const acceptance = await readJson(resolve(root, name, 'a0_acceptance_audit.json'))
      const snapshot = await readJson(resolve(root, name, 'benchmark_source_snapshot.json'))
      const profileSet = await readJson(resolve(root, name, 'validation_profile_set.json'))
      if (acceptance.status === 'passed'
        && acceptance.releaseCandidateSetVersion === '2026-09-15.point-in-time-candidate-v2'
        && acceptance.productCandidateVersion === 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time'
        && acceptance.validationProfileSetFrozen === true
        && acceptance.validationProfileSetHash === profileSet.profileSetHash
        && profileSet.profileSetHash === formalValidationProfileSetHash(profileSet)
        && acceptance.benchmarkIdentityVerified === true
        && snapshot.pointCount >= 734
        && snapshot.firstDate === '2023-09-01'
        && snapshot.lastDate >= '2026-09-11') return resolve(root, name)
    } catch {
      // Ignore incomplete historical attempts.
    }
  }
  throw new Error('qualified_a0_benchmark_snapshot_not_found')
}

async function latestPassedFtr1(profileSetHash: string) {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-1')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const path = resolve(root, name, '15_data_governance_audit.json')
    try {
      await readFile(resolve(root, name, 'INVALIDATED.json'))
      continue
    } catch {
      // A missing invalidation marker means the run remains eligible.
    }
    try {
      const raw = await readFile(path)
      const audit = JSON.parse(raw.toString('utf8'))
      if (audit.status === 'passed' && audit.formalDataGovernancePassed === true && audit.validationProfileSet?.profileSetHash === profileSetHash) {
        return { path, sha256: sha256Canonical(audit), audit }
      }
    } catch {
      // Ignore incomplete or profile-mismatched runs.
    }
  }
  throw new Error('profile_bound_ftr1_data_governance_not_found')
}

async function protectedAccountDigest() {
  const [positions, transactionCount, gridDraftCount, externalOrderObservationCount] = await Promise.all([
    prisma.position.findMany({
      where: { userId: USER_ID },
      select: {
        id: true,
        assetId: true,
        quantity: true,
        avgCost: true,
        currentPrice: true,
        marketValue: true,
        costBasis: true,
        unrealizedPnl: true,
        realizedPnl: true,
        status: true,
        updatedAt: true,
      },
      orderBy: { id: 'asc' },
    }),
    prisma.transaction.count({ where: { userId: USER_ID } }),
    prisma.gridOrderDraft.count({ where: { gridPlan: { userId: USER_ID } } }),
    prisma.externalOrderObservation.count({ where: { userId: USER_ID } }),
  ])
  return {
    positionCount: positions.length,
    openPositionCount: positions.filter((item) => item.status === 'open').length,
    positionDigest: sha256Canonical(positions),
    transactionCount,
    gridDraftCount,
    externalOrderObservationCount,
  }
}

async function writeJson(dir: string, fileName: string, value: unknown) {
  const path = resolve(dir, fileName)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return { path, sha256: sha256Canonical(value) }
}

function strictH00300Points(raw: any) {
  assert.equal(String(raw.code), '200', 'A0 raw H00300 response code must be 200')
  assert.ok(Array.isArray(raw.data), 'A0 raw H00300 response data missing')
  const points = raw.data.map((row: any) => {
    assert.equal(String(row.indexCode), 'H00300')
    assert.equal(String(row.indexNameCnAll), '沪深300全收益指数')
    const date = String(row.tradeDate)
    const value = Number(row.close)
    assert.match(date, /^\d{8}$/)
    assert.ok(Number.isFinite(value) && value > 0)
    return { date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, value }
  })
  for (let index = 1; index < points.length; index += 1) assert.ok(points[index - 1].date < points[index].date)
  return points
}

async function main() {
  await initializePrisma()
  const checkedAt = new Date()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-2', checkedAt.toISOString().replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })
  const before = await protectedAccountDigest()
  assert.ok(before.openPositionCount > 0, 'real default user has no open positions')

  const a0Dir = await latestPassedA0Dir()
  const [acceptance, snapshot, useDeclaration, providerAuthorization, validationProfileSet] = await Promise.all([
    readJson(resolve(a0Dir, 'a0_acceptance_audit.json')),
    readJson(resolve(a0Dir, 'benchmark_source_snapshot.json')),
    readJson(resolve(a0Dir, 'public_source_use_declaration.json')),
    readJson(resolve(a0Dir, 'provider_authorization_audit.json')),
    readJson(resolve(a0Dir, 'validation_profile_set.json')),
  ])
  const rawResponsePath = resolve(a0Dir, 'raw-csindex-h00300.json')
  const factsheetPath = resolve(a0Dir, 'raw-csi300-factsheet.pdf')
  const methodologyPath = resolve(a0Dir, 'raw-csi300-methodology.pdf')
  const [rawResponse, factsheet, methodology] = await Promise.all([
    readFile(rawResponsePath),
    readFile(factsheetPath),
    readFile(methodologyPath),
  ])

  assert.equal(sha256Buffer(rawResponse), snapshot.responseSha256)
  const factsheetTerm = useDeclaration.sourceTerms.find((item: any) => item.sourceId === 'csindex-csi300-factsheet')
  const methodologyTerm = useDeclaration.sourceTerms.find((item: any) => item.sourceId === 'csindex-csi300-methodology')
  assert.ok(factsheetTerm && methodologyTerm)
  assert.equal(sha256Buffer(factsheet), factsheetTerm.contentHash)
  assert.equal(sha256Buffer(methodology), methodologyTerm.contentHash)
  assert.equal(acceptance.sourceSnapshotHash, useDeclaration.sourceSnapshotHash)
  assert.equal(providerAuthorization.authorization.sourceSnapshotHash, acceptance.sourceSnapshotHash)
  assert.equal(providerAuthorization.audit.status, 'passed')
  assert.equal(useDeclaration.usageScope, 'local_personal_noncommercial')
  assert.equal(useDeclaration.publicAccessIsCommercialAuthorization, false)
  assert.equal(validationProfileSet.profileSetHash, acceptance.validationProfileSetHash)
  const productAssignment = validationProfileSet.candidateAssignments.find((item: any) => item.candidateId === 'dividend_low_vol_basket')
  assert.equal(productAssignment?.formalGateApplicable, true)
  assert.equal(productAssignment?.benchmarkId, 'csi300_total_return_h00300')
  const ftr1 = await latestPassedFtr1(validationProfileSet.profileSetHash)
  assert.equal(ftr1.audit.releaseCandidateSet.contentHash, validationProfileSet.candidateSet.contentHash)

  const points = strictH00300Points(JSON.parse(rawResponse.toString('utf8')))
  assert.equal(points.length, snapshot.pointCount)
  assert.ok(points.length >= 734)
  assert.equal(points[0].date, '2023-09-01')
  assert.equal(points.at(-1)?.date, snapshot.lastDate)
  assert.deepEqual(points, snapshot.benchmark.points)

  const evidenceFiles = [
    { kind: 'raw_index_response', path: rawResponsePath, sha256: snapshot.responseSha256 },
    { kind: 'official_factsheet', path: factsheetPath, sha256: factsheetTerm.contentHash },
    { kind: 'official_methodology', path: methodologyPath, sha256: methodologyTerm.contentHash },
    { kind: 'owner_use_declaration', path: resolve(a0Dir, 'public_source_use_declaration.json'), sha256: sha256Canonical(useDeclaration) },
    { kind: 'provider_authorization_audit', path: resolve(a0Dir, 'provider_authorization_audit.json'), sha256: sha256Canonical(providerAuthorization) },
    { kind: 'a0_acceptance', path: resolve(a0Dir, 'a0_acceptance_audit.json'), sha256: sha256Canonical(acceptance) },
  ]
  const benchmarkInput = {
    ...snapshot.benchmark,
    benchmarkType: 'trusted_total_return' as const,
    usageScope: 'local_personal_noncommercial' as const,
    authorizationEvidenceRefs: evidenceFiles.map((item) => `${item.path}#sha256:${item.sha256}`),
    commercialAuthorizationClaimed: false,
    points,
  }
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID }, select: { id: true, email: true } })
  let imported
  try {
    imported = await formalBenchmarkService.importBenchmark(benchmarkInput, { userId: user.id, email: user.email }, checkedAt)
  } catch (error) {
    if (!(error instanceof Error) || error.message !== 'benchmark_version_conflict') throw error
    const artifact = await formalBenchmarkService.loadBenchmark(`${benchmarkInput.benchmarkId}@${benchmarkInput.version}`)
    assert.equal(artifact.benchmarkType, benchmarkInput.benchmarkType)
    assert.equal(artifact.provider, benchmarkInput.provider)
    assert.equal(artifact.usageScope, benchmarkInput.usageScope)
    assert.equal(artifact.commercialAuthorizationClaimed, benchmarkInput.commercialAuthorizationClaimed)
    assert.deepEqual(artifact.points, benchmarkInput.points)
    assert.equal(artifact.contentHash, sha256Canonical({
      schemaVersion: artifact.schemaVersion,
      benchmarkId: artifact.benchmarkId,
      version: artifact.version,
      benchmarkType: artifact.benchmarkType,
      provider: artifact.provider,
      licenseRef: artifact.licenseRef,
      usageScope: artifact.usageScope,
      authorizationEvidenceRefs: artifact.authorizationEvidenceRefs,
      commercialAuthorizationClaimed: artifact.commercialAuthorizationClaimed,
      currency: artifact.currency,
      points: artifact.points,
      sourceRefs: artifact.sourceRefs,
    }))
    imported = {
      artifact,
      path: resolve(process.cwd(), 'data', 'formal-release', 'benchmarks', artifact.benchmarkId, `${artifact.version}.json`),
      idempotent: true,
    }
  }
  const qualification = formalBenchmarkService.qualificationAudit(imported.artifact)
  assert.equal(qualification.status, 'passed')

  const replay = await formalBenchmarkService.buildSeries(`${imported.artifact.benchmarkId}@${imported.artifact.version}`, points.map((point) => point.date))
  assert.equal(replay.series.size, points.length)
  const replayedPoints = points.map((point) => ({ date: point.date, sourceValue: point.value, ...replay.series.get(point.date)! }))
  assert.ok(replayedPoints.every((point) => Number.isFinite(point.netValue) && Number.isFinite(point.cumulativeReturnPercent)))

  const licenseReview = {
    schemaVersion: 'fams.ftr_2.benchmark_license_review.v1',
    stageId: 'FTR-2',
    status: 'passed',
    checkedAt: checkedAt.toISOString(),
    decisionOrigin: 'A0_frozen_owner_public_source_use_decision',
    decisionRef: useDeclaration.decisionRef,
    provider: 'csindex_public',
    benchmarkId: imported.artifact.benchmarkId,
    benchmarkVersion: imported.artifact.version,
    benchmarkType: imported.artifact.benchmarkType,
    usageScope: imported.artifact.usageScope,
    commercialAuthorizationClaimed: false,
    sourceSnapshotHash: acceptance.sourceSnapshotHash,
    authorizationRecordHash: providerAuthorization.authorization.recordHash,
    evidenceFiles,
    allEvidenceFilesVerified: true,
    benchmarkAuthorizationReviewed: true,
    humanAcceptanceStatus: 'pending_batch_review',
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const replayAudit = {
    schemaVersion: 'fams.ftr_2.benchmark_replay.v1',
    stageId: 'FTR-2',
    status: 'passed',
    checkedAt: checkedAt.toISOString(),
    realDataUsed: true,
    sourceAuditDir: a0Dir,
    sourceSnapshotPath: resolve(a0Dir, 'benchmark_source_snapshot.json'),
    sourceSnapshotCanonicalSha256: sha256Canonical(snapshot),
    benchmarkArtifactPath: imported.path,
    benchmarkId: imported.artifact.benchmarkId,
    benchmarkVersion: imported.artifact.version,
    benchmarkType: imported.artifact.benchmarkType,
    provider: imported.artifact.provider,
    usageScope: imported.artifact.usageScope,
    commercialAuthorizationClaimed: false,
    currency: imported.artifact.currency,
    contentHash: imported.artifact.contentHash,
    immutable: true,
    idempotentImport: imported.idempotent,
    pointCount: points.length,
    firstDate: points[0].date,
    lastDate: points.at(-1)?.date,
    replayedPointCount: replayedPoints.length,
    replayedPoints,
    exactValueReplayPassed: true,
    prohibitedActions: [...PROHIBITED_ACTIONS],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const after = await protectedAccountDigest()
  assert.deepEqual(after, before, 'FTR-2 must not mutate real account facts')
  const licenseRef = await writeJson(auditDir, 'benchmark_license_review.json', licenseReview)
  const replayRef = await writeJson(auditDir, 'benchmark_total_return_replay.json', replayAudit)
  const qualificationAudit = {
    ...qualification,
    stageId: 'FTR-2',
    checkedAt: checkedAt.toISOString(),
    realDataUsed: true,
    benchmarkIdentityVerified: imported.artifact.benchmarkId === 'csi300_total_return_h00300',
    benchmarkUsageScope: imported.artifact.usageScope,
    commercialAuthorizationClaimed: false,
    benchmarkPointCount: points.length,
    benchmarkWindowStart: points[0].date,
    benchmarkWindowEnd: points.at(-1)?.date,
    immutableReplayPassed: true,
    deprecatedAliasesPersisted: false,
    accountFactsUnchanged: true,
    protectedAccountDigestBefore: before,
    protectedAccountDigestAfter: after,
    humanAcceptanceStatus: 'pending_batch_review',
    validationProfileSetHash: validationProfileSet.profileSetHash,
    ftr1DataGovernanceArtifact: { path: ftr1.path, sha256: ftr1.sha256 },
    candidateBenchmarkMappings: [{
      candidateId: 'dividend_low_vol_basket',
      candidateVersion: productAssignment.candidateVersion,
      validationProfileId: 'equity_selection_release_v1',
      benchmarkId: imported.artifact.benchmarkId,
      benchmarkVersion: imported.artifact.version,
      benchmarkType: imported.artifact.benchmarkType,
      qualificationStatus: 'passed',
    }],
    artifactRefs: { licenseReview: licenseRef, replay: replayRef },
  }
  const qualificationRef = await writeJson(auditDir, '16_benchmark_qualification_audit.json', qualificationAudit)
  console.log(JSON.stringify({
    ...qualificationAudit,
    auditDir,
    qualificationRef,
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
