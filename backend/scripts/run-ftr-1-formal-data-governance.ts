import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import { formalDataEvidenceBuilderService } from '../src/services/formal-release/formalDataEvidenceBuilderService.js'
import { formalDataProviderService } from '../src/services/formal-release/formalDataProviderService.js'
import { FORMAL_RELEASE_CANDIDATES } from '../src/services/formal-release/releaseCandidateSetService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'
import { formalValidationProfileSetHash } from '../src/services/formal-release/formalValidationProfileService.js'

const USER_ID = 'default'
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const

function auditDir(now: Date) {
  return resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-1', now.toISOString().replace(/[:.]/g, '-'))
}

async function writeJson(dir: string, fileName: string, value: unknown) {
  const path = resolve(dir, fileName)
  const persistedValue = JSON.parse(JSON.stringify(value))
  await writeFile(path, `${JSON.stringify(persistedValue, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { path, sha256: sha256Canonical(persistedValue) }
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestPassedProfileBoundA0() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'A0')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      const acceptance = await readJson(resolve(dir, 'a0_acceptance_audit.json'))
      const candidateSet = await readJson(resolve(dir, 'release_candidate_set.json'))
      const validationProfileSet = await readJson(resolve(dir, 'validation_profile_set.json'))
      if (acceptance.status !== 'passed'
        || acceptance.validationProfileSetFrozen !== true
        || validationProfileSet.profileSetHash !== formalValidationProfileSetHash(validationProfileSet)
        || acceptance.validationProfileSetHash !== validationProfileSet.profileSetHash
        || acceptance.releaseCandidateSetHash !== candidateSet.contentHash
        || validationProfileSet.candidateSet.contentHash !== candidateSet.contentHash) continue
      return { dir, acceptance, candidateSet, validationProfileSet }
    } catch {
      continue
    }
  }
  throw new Error('profile_bound_a0_acceptance_not_found')
}

async function protectedAccountDigest() {
  const [positions, transactions, drafts, externalOrders] = await Promise.all([
    prisma.position.findMany({
      where: { userId: USER_ID },
      select: { id: true, assetId: true, quantity: true, avgCost: true, currentPrice: true, marketValue: true, costBasis: true, unrealizedPnl: true, realizedPnl: true, status: true, updatedAt: true },
      orderBy: { id: 'asc' },
    }),
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

async function main() {
  await initializePrisma()
  const startedAt = new Date()
  const dir = auditDir(startedAt)
  await mkdir(dir, { recursive: true })
  const before = await protectedAccountDigest()
  const a0 = await latestPassedProfileBoundA0()
  const result = await formalDataEvidenceBuilderService.build(USER_ID, startedAt)
  assert.equal(result.releaseCandidateSet.version, a0.candidateSet.version)
  assert.equal(result.releaseCandidateSet.contentHash, a0.candidateSet.contentHash)
  const after = await protectedAccountDigest()
  assert.deepEqual(after, before, 'FTR-1 must not mutate account, transaction, draft, or order facts')

  const sourceEvidence = await writeJson(dir, 'public_market_bundle_source_evidence.json', result.sourceEvidence)
  const providerAudits = await Promise.all([
    formalDataProviderService.authorizationAudit('public_market_bundle', startedAt),
    formalDataProviderService.authorizationAudit('csindex_public', startedAt),
  ])
  const providerAuthorizationAudit = {
    schemaVersion: 'fams.formal_provider.authorization_audit_collection.v2',
    status: providerAudits.every((item) => item.status === 'passed') ? 'passed' : 'blocked',
    providers: providerAudits,
    sourceEvidenceRef: sourceEvidence,
    credentialPersisted: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const providerArtifact = await writeJson(dir, 'provider_authorization_audit.json', providerAuthorizationAudit)

  const validations = result.snapshots.map((item) => item.snapshot.fieldEvidenceValidation)
  const fieldEvidenceValidation = {
    schemaVersion: 'fams.formal_data.field_evidence_validation_collection.v2',
    status: validations.every((item) => item.status === 'passed') ? 'passed' : 'blocked',
    candidateCount: validations.length,
    items: validations.flatMap((item) => item.items),
    candidateResults: result.snapshots.map((item) => ({
      candidateStrategyId: item.snapshot.candidateStrategyId,
      candidateStrategyVersion: item.snapshot.candidateStrategyVersion,
      status: item.snapshot.status,
      snapshotHash: item.snapshot.snapshotHash,
      persistedSnapshotId: item.persistence.id,
      blockers: item.snapshot.blockers,
    })),
    blockers: Array.from(new Set(validations.flatMap((item) => item.blockers))),
    criticalFieldsHaveEvidenceRefs: validations.every((item) => item.items.filter((field) => field.critical).every((field) => field.evidenceRefs.length > 0)),
    noCriticalProviderUnknown: validations.every((item) => item.items.filter((field) => field.critical).every((field) => field.providerClass !== 'unknown')),
    noCriticalFreshnessUnknownOrStale: validations.every((item) => item.items.filter((field) => field.critical).every((field) => field.freshnessStatus === 'fresh')),
    noCriticalCoverageBlocked: validations.every((item) => item.items.filter((field) => field.critical).every((field) => field.coveragePercent >= 80)),
    researchFallbackPromotedToFormal: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const fieldArtifact = await writeJson(dir, 'field_evidence_validation_audit.json', fieldEvidenceValidation)

  const allCandidateSnapshotsPassed = result.snapshots.length === FORMAL_RELEASE_CANDIDATES.length
    && result.snapshots.every((item) => item.snapshot.status === 'passed')
  const dataGovernanceAudit = {
    schemaVersion: 'fams.next_stage.data_governance_acceptance.v2',
    stageId: 'FTR-1',
    status: allCandidateSnapshotsPassed && providerAuthorizationAudit.status === 'passed' && fieldEvidenceValidation.status === 'passed' ? 'passed' : 'blocked',
    checkedAt: new Date().toISOString(),
    realDataUsed: true,
    userId: USER_ID,
    auditUserExcluded: true,
    releaseCandidateSet: result.releaseCandidateSet,
    validationProfileSet: {
      setVersion: a0.validationProfileSet.setVersion,
      profileSetHash: a0.validationProfileSet.profileSetHash,
      sourcePath: resolve(a0.dir, 'validation_profile_set.json'),
    },
    candidateCount: result.snapshots.length,
    formalDataSnapshotCount: result.snapshots.length,
    allCandidateSnapshotsPassed,
    providerAuthorizationStatus: providerAuthorizationAudit.status,
    fieldEvidenceValidationStatus: fieldEvidenceValidation.status,
    formalDataGovernancePassed: allCandidateSnapshotsPassed && providerAuthorizationAudit.status === 'passed' && fieldEvidenceValidation.status === 'passed',
    criticalFieldsHaveEvidenceRefs: fieldEvidenceValidation.criticalFieldsHaveEvidenceRefs,
    noCriticalProviderUnknown: fieldEvidenceValidation.noCriticalProviderUnknown,
    noCriticalFreshnessUnknownOrStale: fieldEvidenceValidation.noCriticalFreshnessUnknownOrStale,
    noCriticalCoverageBlocked: fieldEvidenceValidation.noCriticalCoverageBlocked,
    researchFallbackPromotedToFormal: false,
    accountFactsUnchanged: true,
    protectedAccountDigestBefore: before,
    protectedAccountDigestAfter: after,
    candidateSnapshots: fieldEvidenceValidation.candidateResults,
    artifacts: { sourceEvidence, providerAuthorizationAudit: providerArtifact, fieldEvidenceValidation: fieldArtifact },
    blockers: Array.from(new Set([
      ...result.blockers,
      ...providerAudits.flatMap((item) => item.blockers),
      ...fieldEvidenceValidation.blockers,
    ])),
    conclusion: {
      formalDataGovernancePassed: allCandidateSnapshotsPassed && providerAuthorizationAudit.status === 'passed' && fieldEvidenceValidation.status === 'passed',
      benchmarkQualificationPassed: false,
      formalValidationPassed: false,
      humanAcceptanceStatus: 'not_started',
      formalTradingReleaseReady: false,
    },
    prohibitedActions: [...PROHIBITED_ACTIONS],
    notTradingAdvice: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  const acceptanceArtifact = await writeJson(dir, '15_data_governance_audit.json', dataGovernanceAudit)
  console.log(JSON.stringify({ ...dataGovernanceAudit, acceptanceArtifact }, null, 2))
  if (dataGovernanceAudit.status !== 'passed') process.exitCode = 2
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
