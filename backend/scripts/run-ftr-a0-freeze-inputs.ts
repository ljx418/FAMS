import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { formalDataProviderService } from '../src/services/formal-release/formalDataProviderService.js'
import { publicSourceEvidenceService } from '../src/services/formal-release/publicSourceEvidenceService.js'
import {
  FORMAL_RELEASE_CANDIDATES,
  FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2,
  releaseCandidateSetService,
} from '../src/services/formal-release/releaseCandidateSetService.js'
import {
  FORMAL_VALIDATION_PROFILE_SET_VERSION_POINT_IN_TIME_V2,
  formalValidationProfileService,
} from '../src/services/formal-release/formalValidationProfileService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'
import { pointInTimeCandidateEvidenceService } from '../src/services/formal-release/pointInTimeCandidateEvidenceService.js'
import { portfolioBacktestInputBuilder } from '../src/services/portfolio-backtest/portfolioBacktestInputBuilder.js'

const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const
const USER_ID = 'default'
const FREEZE_VERSION = '2026-09-15.point-in-time-candidate-v2'

function privateAuditDir(now: Date) {
  return resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'A0', now.toISOString().replace(/[:.]/g, '-'))
}

async function writeJson(dir: string, fileName: string, value: unknown) {
  const path = resolve(dir, fileName)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return path
}

function sha256Buffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function verifiedA0Replay() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'A0')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const previousDir = resolve(root, name)
    try {
      const [acceptance, snapshot, declaration, raw, factsheet, methodology] = await Promise.all([
        readFile(resolve(previousDir, 'a0_acceptance_audit.json'), 'utf8').then(JSON.parse),
        readFile(resolve(previousDir, 'benchmark_source_snapshot.json'), 'utf8').then(JSON.parse),
        readFile(resolve(previousDir, 'public_source_use_declaration.json'), 'utf8').then(JSON.parse),
        readFile(resolve(previousDir, 'raw-csindex-h00300.json')),
        readFile(resolve(previousDir, 'raw-csi300-factsheet.pdf')),
        readFile(resolve(previousDir, 'raw-csi300-methodology.pdf')),
      ])
      if (acceptance.status !== 'passed' || acceptance.benchmarkIdentityVerified !== true) continue
      if (sha256Buffer(raw) !== snapshot.responseSha256) continue
      const factsheetTerm = declaration.sourceTerms.find((item: any) => item.sourceId === 'csindex-csi300-factsheet')
      const methodologyTerm = declaration.sourceTerms.find((item: any) => item.sourceId === 'csindex-csi300-methodology')
      if (!factsheetTerm || !methodologyTerm
        || sha256Buffer(factsheet) !== factsheetTerm.contentHash
        || sha256Buffer(methodology) !== methodologyTerm.contentHash) continue
      const resource = (body: Buffer, term: any, contentType: string) => ({
        url: term.url,
        fetchedAt: term.fetchedAt,
        statusCode: 200,
        contentType,
        byteLength: body.length,
        sha256: sha256Buffer(body),
        body,
      })
      return {
        sourceAcquisitionMode: 'verified_a0_replay_after_live_timeout' as const,
        sourceReplayDir: previousDir,
        terms: {
          resources: {
            factsheet: resource(factsheet, factsheetTerm, 'application/pdf'),
            methodology: resource(methodology, methodologyTerm, 'application/pdf'),
          },
          sourceTerms: declaration.sourceTerms,
          endpointAllowlist: declaration.endpointAllowlist,
          usageScope: declaration.usageScope,
          commercialAuthorizationClaimed: false,
        },
        benchmark: {
          resource: {
            url: snapshot.request,
            fetchedAt: snapshot.fetchedAt,
            statusCode: 200,
            contentType: 'application/json',
            byteLength: raw.length,
            sha256: snapshot.responseSha256,
            body: raw,
          },
          points: snapshot.benchmark.points,
          benchmarkInput: snapshot.benchmark,
        },
      }
    } catch {
      continue
    }
  }
  throw new Error('verified_a0_replay_not_found')
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

async function main() {
  await initializePrisma()
  const startedAt = new Date()
  const dir = privateAuditDir(startedAt)
  await mkdir(dir, { recursive: true })
  const before = await protectedAccountDigest()
  const pointInTimeCandidate = await pointInTimeCandidateEvidenceService.latestQualified()
  const user = await prisma.user.findUnique({ where: { id: USER_ID }, select: { id: true, email: true } })
  assert.ok(user, 'real default user must exist')
  assert.ok(before.openPositionCount > 0, 'real default user must have open positions')

  let acquisition
  try {
    const [terms, benchmark] = await Promise.all([
      publicSourceEvidenceService.captureCsindexTermsEvidence(),
      publicSourceEvidenceService.fetchCsi300TotalReturn({ startDate: '2023-09-01', endDate: '2026-09-14' }),
    ])
    acquisition = { sourceAcquisitionMode: 'live_public_fetch' as const, sourceReplayDir: null, terms, benchmark }
  } catch (error) {
    if (!String((error as Error)?.message || error).toLowerCase().includes('timeout')) throw error
    acquisition = await verifiedA0Replay()
  }
  const { terms, benchmark } = acquisition
  await Promise.all([
    writeFile(resolve(dir, 'raw-csindex-h00300.json'), benchmark.resource.body, { flag: 'wx' }),
    writeFile(resolve(dir, 'raw-csi300-factsheet.pdf'), terms.resources.factsheet.body, { flag: 'wx' }),
    writeFile(resolve(dir, 'raw-csi300-methodology.pdf'), terms.resources.methodology.body, { flag: 'wx' }),
  ])

  const sourceSnapshotCore = {
    dataRequest: {
      url: benchmark.resource.url,
      statusCode: benchmark.resource.statusCode,
      contentType: benchmark.resource.contentType,
      byteLength: benchmark.resource.byteLength,
      sha256: benchmark.resource.sha256,
    },
    officialPublications: terms.sourceTerms.map((item) => ({
      sourceId: item.sourceId,
      url: item.url,
      contentHash: item.contentHash,
      reviewStatus: item.reviewStatus,
    })),
    endpointAllowlist: terms.endpointAllowlist,
    usageScope: terms.usageScope,
    commercialAuthorizationClaimed: terms.commercialAuthorizationClaimed,
  }
  const sourceSnapshotHash = sha256Canonical(sourceSnapshotCore)
  const existing = await formalDataProviderService.listAuthorizations('csindex_public')
  const latest = existing.at(-1)
  const authorization = latest?.decision === 'approved'
    && latest.sourceSnapshotHash === sourceSnapshotHash
    && latest.usageScope === 'local_personal_noncommercial'
    ? latest
    : await formalDataProviderService.appendAuthorization({
      providerId: 'csindex_public',
      providerClass: 'trusted_public_noncommercial',
      decision: 'approved',
      authorizationRef: 'project-owner-conversation:2026-09-14:public-open-trusted-reconstruction',
      authorizationBasis: 'public_terms_local_noncommercial',
      usageScope: 'local_personal_noncommercial',
      authorizedScopes: ['H00300:index-performance', 'H00300:factsheet', '000300:methodology'],
      evidenceRefs: [
        `sha256:${benchmark.resource.sha256}`,
        ...terms.sourceTerms.map((item) => `sha256:${item.contentHash}`),
      ],
      sourceTerms: terms.sourceTerms,
      endpointAllowlist: terms.endpointAllowlist,
      sourceSnapshotHash,
      credentialRequired: false,
      reviewerUserId: user.id,
      reviewerEmail: user.email,
      effectiveFrom: startedAt,
      expiresAt: null,
      now: startedAt,
    })
  const authorizationAudit = await formalDataProviderService.authorizationAudit('csindex_public', startedAt)

  const candidateSet = await releaseCandidateSetService.freeze({
    version: FREEZE_VERSION,
    userId: USER_ID,
    createdByUserId: user.id,
    createdByEmail: user.email,
    sourceRefs: [
      'backend/src/services/portfolio-backtest/portfolioStrategyRegistry.ts',
      'backend/src/services/portfolio-backtest/portfolioBacktestInputBuilder.ts',
      `csindex:H00300:sha256:${benchmark.resource.sha256}`,
      'docs/PRD_COMPLETION_TRACEABILITY_MATRIX.md',
      `point-in-time-candidate-v2:${pointInTimeCandidate.path}#sha256:${pointInTimeCandidate.sha256}`,
    ],
    candidateVersions: FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2,
    now: startedAt,
  })
  process.env.FAMS_PORTFOLIO_DLV_BASKET_MIN_PRICE_BARS = '60'
  const frozenInput = await portfolioBacktestInputBuilder.build({
    userId: USER_ID,
    portfolioStrategyIds: candidateSet.artifact.candidateIds,
    releaseCandidateStrategyIds: candidateSet.artifact.candidateIds,
    releaseCandidateStrategyVersions: candidateSet.artifact.candidateVersions,
    startDate: '2025-09-11',
    endDate: '2026-09-11',
    benchmarkIds: ['csi300_total_return_h00300'],
    gradeMode: 'formal_review',
    ruleMode: 'registry_fixed',
  })
  assert.equal(frozenInput.strategies.length, FORMAL_RELEASE_CANDIDATES.length)
  assert.deepEqual(frozenInput.strategies.map((item) => item.strategyId), candidateSet.artifact.candidateIds)
  assert.ok(frozenInput.strategies.every((item) => item.validation.status === 'valid'), JSON.stringify(frozenInput.dataQuality.blockedReasons))
  const definitionsForProfile = frozenInput.strategies.map((definition) => definition.strategyId === 'dividend_low_vol_basket'
    ? { ...definition, strategyVersion: FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2.dividend_low_vol_basket }
    : definition)
  const validationProfileSet = formalValidationProfileService.freeze({
    candidateSet: candidateSet.artifact,
    definitions: definitionsForProfile,
    setVersion: FORMAL_VALIDATION_PROFILE_SET_VERSION_POINT_IN_TIME_V2,
    assignmentOverrides: {
      dividend_low_vol_basket: {
        componentIds: pointInTimeCandidate.componentIds,
        definitionHash: pointInTimeCandidate.definitionHash,
        componentSelectionMode: 'point_in_time_dynamic',
        selectionArtifactRef: pointInTimeCandidate.path,
        selectionArtifactSha256: pointInTimeCandidate.sha256,
      },
    },
    generatedAt: startedAt,
  })

  const after = await protectedAccountDigest()
  assert.deepEqual(after, before, 'A0 must not mutate account, transaction, draft, or order-observation facts')
  assert.equal(authorizationAudit.status, 'passed')
  assert.equal(authorizationAudit.credentialRequired, false)
  assert.equal(authorizationAudit.credentialRedacted, 'not_required')
  assert.deepEqual(candidateSet.artifact.candidateIds, [...FORMAL_RELEASE_CANDIDATES])
  assert.equal(candidateSet.artifact.candidateIds.length, 7)
  assert.equal(candidateSet.artifact.userId, USER_ID)
  assert.equal(candidateSet.artifact.auditUserExcluded, true)
  assert.equal(candidateSet.artifact.candidateVersions.dividend_low_vol_basket, 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time')
  const productAssignment = validationProfileSet.candidateAssignments.find((item) => item.candidateId === 'dividend_low_vol_basket')
  assert.equal(productAssignment?.componentSelectionMode, 'point_in_time_dynamic')
  assert.equal(productAssignment?.selectionArtifactSha256, pointInTimeCandidate.sha256)
  assert.deepEqual(productAssignment?.componentIds, pointInTimeCandidate.componentIds)

  const useDeclaration = {
    schemaVersion: 'fams.public_source_use_declaration.v1',
    decidedAt: '2026-09-14T00:00:00+08:00',
    decisionRef: 'project-owner-conversation:public-open-trusted-reconstruction',
    usageScope: 'local_personal_noncommercial',
    publicAccessIsCommercialAuthorization: false,
    providerId: 'csindex_public',
    endpointAllowlist: terms.endpointAllowlist,
    sourceTerms: terms.sourceTerms,
    sourceSnapshotHash,
    sourceAcquisitionMode: acquisition.sourceAcquisitionMode,
    sourceReplayDir: acquisition.sourceReplayDir,
  }
  const benchmarkSnapshot = {
    schemaVersion: 'fams.ftr_a0.benchmark_source_snapshot.v1',
    fetchedAt: benchmark.resource.fetchedAt,
    request: benchmark.resource.url,
    responseSha256: benchmark.resource.sha256,
    responseByteLength: benchmark.resource.byteLength,
    benchmark: benchmark.benchmarkInput,
    pointCount: benchmark.points.length,
    firstDate: benchmark.points[0].date,
    lastDate: benchmark.points.at(-1)?.date,
    rawEvidencePrivate: true,
    rawEvidencePath: resolve(dir, 'raw-csindex-h00300.json'),
  }
  const outputPaths = await Promise.all([
    writeJson(dir, 'public_source_use_declaration.json', useDeclaration),
    writeJson(dir, 'provider_authorization_audit.json', { authorization, audit: authorizationAudit }),
    writeJson(dir, 'benchmark_source_snapshot.json', benchmarkSnapshot),
    writeJson(dir, 'release_candidate_set.json', candidateSet.artifact),
    writeJson(dir, 'validation_profile_set.json', validationProfileSet),
    writeJson(dir, 'point_in_time_candidate_policy.json', {
      schemaVersion: 'fams.ftr_a0.point_in_time_candidate_policy.v1',
      candidateVersion: pointInTimeCandidate.artifact.candidateVersion,
      selectionArtifactRef: pointInTimeCandidate.path,
      selectionArtifactSha256: pointInTimeCandidate.sha256,
      componentIds: pointInTimeCandidate.componentIds,
      policy: pointInTimeCandidate.policy,
      definitionHash: pointInTimeCandidate.definitionHash,
      realDataUsed: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    }),
  ])
  const acceptance = {
    schemaVersion: 'fams.ftr_a0.acceptance_audit.v1',
    stageId: 'A0',
    status: 'passed',
    checkedAt: new Date().toISOString(),
    realDataUsed: true,
    dataSource: 'csindex_public:H00300',
    benchmarkIdentityVerified: benchmark.benchmarkInput.benchmarkId === 'csi300_total_return_h00300',
    benchmarkType: benchmark.benchmarkInput.benchmarkType,
    candidateSetFrozen: true,
    candidateCount: candidateSet.artifact.candidateIds.length,
    releaseCandidateSetVersion: candidateSet.artifact.version,
    releaseCandidateSetHash: candidateSet.artifact.contentHash,
    validationProfileSetFrozen: true,
    validationProfileSetVersion: validationProfileSet.setVersion,
    validationProfileSetHash: validationProfileSet.profileSetHash,
    productReleaseCandidateIds: validationProfileSet.productReleaseCandidateIds,
    ownerDecisionRef: validationProfileSet.ownerDecisionRef,
    productCandidateVersion: FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2.dividend_low_vol_basket,
    productCandidateSelectionMode: productAssignment?.componentSelectionMode,
    productCandidateSelectionArtifactRef: pointInTimeCandidate.path,
    productCandidateSelectionArtifactSha256: pointInTimeCandidate.sha256,
    productCandidateComponentUnionCount: pointInTimeCandidate.componentIds.length,
    pointInTimeCandidateWindowCount: pointInTimeCandidate.artifact.walkForward.configuredWindowCount,
    pointInTimeCandidatePassedRatio: pointInTimeCandidate.artifact.walkForward.passedRatio,
    realUserId: USER_ID,
    auditUserExcluded: true,
    accountFactsUnchanged: true,
    protectedAccountDigestBefore: before,
    protectedAccountDigestAfter: after,
    sourceSnapshotHash,
    artifactRefs: outputPaths,
    prohibitedActions: [...PROHIBITED_ACTIONS],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const acceptancePath = await writeJson(dir, 'a0_acceptance_audit.json', acceptance)
  console.log(JSON.stringify({ ...acceptance, acceptancePath }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
