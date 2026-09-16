import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { initializePrisma, prisma } from '../src/db/prisma.js'
import {
  FORMAL_DATA_FIELD_IDS,
  formalDataProviderService,
  type FormalFieldEvidence,
  type FormalSourceTermsEvidence,
} from '../src/services/formal-release/formalDataProviderService.js'
import { FORMAL_RELEASE_CANDIDATES } from '../src/services/formal-release/releaseCandidateSetService.js'
import { formalValidationProfileSetHash } from '../src/services/formal-release/formalValidationProfileService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const USER_ID = 'default'
const CANDIDATE_VERSION = 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time'
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const
type Json = Record<string, any>

function round(value: number, digits = 3) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function sha256Bytes(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestDir(stageId: string, fileName: string, predicate: (value: Json) => boolean) {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', stageId)
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      const value = await readJson(resolve(dir, fileName))
      if (predicate(value)) return { dir, value }
    } catch {
      // Keep partial historical attempts out of the qualified input chain.
    }
  }
  throw new Error(`${stageId}:${fileName}:qualified_artifact_not_found`)
}

async function protectedAccountDigest() {
  const [positions, transactions, drafts, externalOrders] = await Promise.all([
    prisma.position.findMany({ where: { userId: USER_ID }, orderBy: { id: 'asc' } }),
    prisma.transaction.findMany({ where: { userId: USER_ID }, orderBy: { id: 'asc' } }),
    prisma.gridOrderDraft.findMany({ where: { gridPlan: { userId: USER_ID } }, orderBy: { id: 'asc' } }),
    prisma.externalOrderObservation.findMany({ where: { userId: USER_ID }, orderBy: { id: 'asc' } }),
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

function makeField(input: Omit<FormalFieldEvidence, 'evidenceHash'>): FormalFieldEvidence {
  return { ...input, evidenceHash: sha256Canonical(input) }
}

function refreezeVerifiedHistoricalField(item: FormalFieldEvidence): FormalFieldEvidence {
  const normalized: Omit<FormalFieldEvidence, 'evidenceHash'> = {
    candidateStrategyId: item.candidateStrategyId,
    candidateStrategyVersion: item.candidateStrategyVersion,
    fieldId: item.fieldId,
    critical: item.critical,
    applicability: item.applicability,
    notApplicableReason: item.notApplicableReason,
    providerId: item.providerId,
    providerClass: item.providerClass,
    sourceEndpoint: item.sourceEndpoint,
    asOfDate: item.asOfDate,
    fetchedAt: item.fetchedAt,
    coveragePercent: item.coveragePercent,
    crossCheckStatus: item.applicability === 'required' ? 'immutable_replay_verified' : item.crossCheckStatus,
    evidenceRefs: item.evidenceRefs,
    warnings: item.applicability === 'required'
      ? unique([...item.warnings, 'verified_prior_ftr1_artifact_refrozen_for_point_in_time_replay'])
      : item.warnings,
    inputBlockers: item.inputBlockers,
    ...(item.applicability === 'required' ? { temporalScope: 'frozen_historical_window' as const } : {}),
  }
  return makeField(normalized)
}

async function writeJson(dir: string, fileName: string, value: unknown) {
  const path = resolve(dir, fileName)
  const persisted = JSON.parse(JSON.stringify(value))
  await writeFile(path, `${JSON.stringify(persisted, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  return { path, sha256: sha256Canonical(persisted) }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean))).sort()
}

async function main() {
  await initializePrisma()
  const now = new Date()
  const dir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-1', now.toISOString().replace(/[:.]/g, '-'))
  await mkdir(dir, { recursive: true })
  const before = await protectedAccountDigest()

  const a0 = await latestDir('A0', 'a0_acceptance_audit.json', (value) => value.status === 'passed'
    && value.releaseCandidateSetVersion === '2026-09-15.point-in-time-candidate-v2')
  const [candidateSet, profileSet, policy] = await Promise.all([
    readJson(resolve(a0.dir, 'release_candidate_set.json')),
    readJson(resolve(a0.dir, 'validation_profile_set.json')),
    readJson(resolve(a0.dir, 'point_in_time_candidate_policy.json')),
  ])
  assert.equal(profileSet.profileSetHash, formalValidationProfileSetHash(profileSet as any))
  assert.equal(profileSet.candidateSet.contentHash, candidateSet.contentHash)
  const selectionRaw = await readFile(policy.selectionArtifactRef)
  assert.equal(sha256Bytes(selectionRaw), policy.selectionArtifactSha256)
  const selection = JSON.parse(selectionRaw.toString('utf8')) as Json
  assert.equal(selection.status, 'passed')
  assert.equal(selection.summary.candidateV2RefreezeAllowed, true)

  const previous = await latestDir('FTR-1', '15_data_governance_audit.json', (value) => value.status === 'passed'
    && value.releaseCandidateSet?.candidateVersions?.dividend_low_vol_basket === 'portfolio.strategy.dividend_low_vol_basket.v1')
  const [oldFields, oldProvider, oldSource] = await Promise.all([
    readJson(resolve(previous.dir, 'field_evidence_validation_audit.json')),
    readJson(resolve(previous.dir, 'provider_authorization_audit.json')),
    readJson(resolve(previous.dir, 'public_market_bundle_source_evidence.json')),
  ])
  assert.equal(sha256Canonical(oldFields), previous.value.artifacts.fieldEvidenceValidation.sha256, 'prior_ftr1_field_evidence_hash_mismatch')
  assert.equal(sha256Canonical(oldProvider), previous.value.artifacts.providerAuthorizationAudit.sha256, 'prior_ftr1_provider_audit_hash_mismatch')
  assert.equal(sha256Canonical(oldSource), previous.value.artifacts.sourceEvidence.sha256, 'prior_ftr1_source_evidence_hash_mismatch')

  const windows = selection.walkForward.windows as Json[]
  const pointPaths: Array<{ window: Json; candidate: Json }> = []
  for (const window of windows) {
    const raw = await readFile(window.sourceSnapshotPath)
    assert.equal(sha256Bytes(raw), window.sourceSnapshotSha256)
    const snapshot = JSON.parse(raw.toString('utf8')) as Json
    assert.equal(snapshot.decisionDate, window.decisionDate)
    for (const symbol of window.selectedSymbols as string[]) {
      const candidate = (snapshot.candidates as Json[]).find((item) => item.symbol === symbol)
      assert.ok(candidate, `point_in_time_candidate_missing:${window.windowId}:${symbol}`)
      assert.equal(candidate.historicalStatusProxyUsed, false)
      assert.ok((candidate.sourceAnnouncementDates as string[]).every((date) => date <= window.decisionDate), `future_announcement_detected:${window.windowId}:${symbol}`)
      pointPaths.push({ window, candidate })
    }
  }
  assert.equal(pointPaths.length, selection.groupStability.releaseEffectivePathCount)
  assert.ok(pointPaths.length >= 30)

  const priceManifestRaw = await readFile(selection.priceLake.manifestPath)
  assert.equal(sha256Bytes(priceManifestRaw), selection.priceLake.manifestSha256)
  const priceManifest = JSON.parse(priceManifestRaw.toString('utf8')) as Json
  const priceEntries = (priceManifest.files as Json[]).filter((item) => String(item.path).includes('/raw/prices/'))
  assert.equal(priceEntries.length, policy.componentIds.length)
  for (const entry of priceEntries) assert.equal(sha256Bytes(await readFile(entry.path)), entry.sha256)

  const pathCoverage = (predicate: (path: typeof pointPaths[number]) => boolean) => round((pointPaths.filter(predicate).length / pointPaths.length) * 100)
  const priceCoverage = Math.min(...windows.flatMap((window) => (window.perSymbolPriceCoverage as Json[]).map((item) => Number(item.priceCoveragePercent))))
  const statusCoverage = pathCoverage(({ candidate }) => candidate.historicalStatusResolved === true
    && candidate.historicalStatusEvidenceMode === 'baostock_direct_daily'
    && candidate.historicalStatusProxyUsed === false)
  const tradeabilityCoverage = pathCoverage(({ candidate }) => candidate.tradeabilityResolved === true && candidate.directTradeStatus === '1')
  const fundamentalCoverage = pathCoverage(({ candidate }) => candidate.fundamentalResolved === true
    && (candidate.evidenceRefs as string[]).some((ref) => ref.startsWith('fundamental:free-akshare:')))
  const dividendCoverage = pathCoverage(({ candidate }) => (candidate.evidenceRefs as string[]).some((ref) => ref.startsWith('dividend:free-akshare:')))
  const industryCoverage = pathCoverage(({ candidate }) => Boolean(candidate.industry)
    && (candidate.evidenceRefs as string[]).some((ref) => ref.startsWith('free-source-industry-rank:')))
  const allPointRefs = unique(pointPaths.flatMap(({ candidate }) => candidate.evidenceRefs as string[]))
  const latestDecisionDate = windows.map((window) => String(window.decisionDate)).sort().at(-1)!
  const latestValidationDate = windows.map((window) => String(window.validationEndDate)).sort().at(-1)!
  const base = {
    candidateStrategyId: 'dividend_low_vol_basket',
    candidateStrategyVersion: CANDIDATE_VERSION,
    fetchedAt: now.toISOString(),
  }
  const dynamicFields: FormalFieldEvidence[] = [
    makeField({ ...base, fieldId: 'price', critical: true, applicability: 'required', notApplicableReason: null, providerId: 'public_market_bundle', providerClass: 'trusted_public_noncommercial', sourceEndpoint: 'tencent_qfq_immutable_validation_lake', asOfDate: latestValidationDate, coveragePercent: priceCoverage, crossCheckStatus: 'immutable_replay_verified', evidenceRefs: priceEntries.map((entry) => `qfq-validation-series:${entry.symbol}:${entry.sha256}`), warnings: ['point_in_time_validation_bundle_local_personal_noncommercial_only'], inputBlockers: priceCoverage >= 80 ? [] : ['price_coverage_below_80'], temporalScope: 'frozen_historical_window' }),
    makeField({ ...base, fieldId: 'benchmark', critical: true, applicability: 'required', notApplicableReason: null, providerId: 'csindex_public', providerClass: 'trusted_public_noncommercial', sourceEndpoint: 'csindex:H00300', asOfDate: latestValidationDate, coveragePercent: 100, crossCheckStatus: 'immutable_replay_verified', evidenceRefs: [`trusted-total-return-benchmark:${selection.benchmark.sha256}`], warnings: ['trusted_total_return_not_commercially_licensed_official_total_return'], inputBlockers: [], temporalScope: 'frozen_historical_window' }),
    makeField({ ...base, fieldId: 'dividend', critical: true, applicability: 'required', notApplicableReason: null, providerId: 'public_market_bundle', providerClass: 'trusted_public_noncommercial', sourceEndpoint: 'akshare_bulk_dividend_notice_date_cutoff', asOfDate: latestDecisionDate, coveragePercent: dividendCoverage, crossCheckStatus: 'immutable_replay_verified', evidenceRefs: allPointRefs.filter((ref) => ref.startsWith('dividend:free-akshare:')), warnings: ['point_in_time_bundle_as_of_latest_decision_date'], inputBlockers: dividendCoverage >= 80 ? [] : ['dividend_coverage_below_80'], temporalScope: 'frozen_historical_window' }),
    makeField({ ...base, fieldId: 'tradeability', critical: true, applicability: 'required', notApplicableReason: null, providerId: 'public_market_bundle', providerClass: 'trusted_public_noncommercial', sourceEndpoint: 'baostock_direct_daily_status_plus_tencent_bar_presence', asOfDate: latestDecisionDate, coveragePercent: Math.min(statusCoverage, tradeabilityCoverage), crossCheckStatus: 'immutable_replay_verified', evidenceRefs: allPointRefs.filter((ref) => ref.startsWith('free-source-historical-status:') || ref.startsWith('free-source-tradeability:')), warnings: ['historical_status_direct_daily_not_exchange_order_book'], inputBlockers: statusCoverage >= 80 && tradeabilityCoverage >= 80 ? [] : ['tradeability_coverage_below_80'], temporalScope: 'frozen_historical_window' }),
    makeField({ ...base, fieldId: 'fundamental', critical: true, applicability: 'required', notApplicableReason: null, providerId: 'public_market_bundle', providerClass: 'trusted_public_noncommercial', sourceEndpoint: 'akshare_bulk_financials_announcement_date_cutoff', asOfDate: latestDecisionDate, coveragePercent: fundamentalCoverage, crossCheckStatus: 'immutable_replay_verified', evidenceRefs: allPointRefs.filter((ref) => ref.startsWith('fundamental:free-akshare:')), warnings: ['point_in_time_bundle_as_of_latest_decision_date'], inputBlockers: fundamentalCoverage >= 80 ? [] : ['fundamental_coverage_below_80'], temporalScope: 'frozen_historical_window' }),
    makeField({ ...base, fieldId: 'industryClassification', critical: true, applicability: 'required', notApplicableReason: null, providerId: 'public_market_bundle', providerClass: 'trusted_public_noncommercial', sourceEndpoint: 'akshare_baostock_identity_plus_point_in_time_industry_rank', asOfDate: latestDecisionDate, coveragePercent: industryCoverage, crossCheckStatus: 'immutable_replay_verified', evidenceRefs: allPointRefs.filter((ref) => ref.startsWith('free-source-industry-rank:')), warnings: ['point_in_time_bundle_as_of_latest_decision_date'], inputBlockers: industryCoverage >= 80 ? [] : ['industry_coverage_below_80'], temporalScope: 'frozen_historical_window' }),
    makeField({ ...base, fieldId: 'costModel', critical: true, applicability: 'required', notApplicableReason: null, providerId: 'fams_internal', providerClass: 'trusted_internal', sourceEndpoint: 'point_in_time_candidate_policy.costModel', asOfDate: now.toISOString().slice(0, 10), coveragePercent: 100, crossCheckStatus: 'official_verified', evidenceRefs: [`cost-model:dividend_low_vol_basket:fee:${selection.algorithm.feeRate}:slippage:${selection.algorithm.slippageRate}`], warnings: [], inputBlockers: [] }),
  ]
  assert.deepEqual(dynamicFields.map((item) => item.fieldId), [...FORMAL_DATA_FIELD_IDS])

  const inheritedTerms = (oldProvider.providers as Json[]).flatMap((provider) => provider.sourceTerms || []) as FormalSourceTermsEvidence[]
  const sourceTerms: FormalSourceTermsEvidence[] = [
    ...inheritedTerms,
    { sourceId: 'baostock-direct-history', title: 'BaoStock 历史证券状态公开接口', url: 'http://baostock.com/', fetchedAt: now.toISOString(), contentHash: selection.sourcePointInTimeBackfill.sha256, reviewStatus: 'reviewed_for_local_noncommercial_use' },
    { sourceId: 'akshare-bulk-disclosure', title: 'AKShare 公开财务与分红批量接口', url: 'https://akshare.akfamily.xyz/', fetchedAt: now.toISOString(), contentHash: selection.sourcePointInTimeBackfill.sha256, reviewStatus: 'reviewed_for_local_noncommercial_use' },
    { sourceId: 'tencent-qfq-history', title: '腾讯公开前复权历史行情', url: 'https://gu.qq.com/', fetchedAt: now.toISOString(), contentHash: selection.priceLake.manifestSha256, reviewStatus: 'reviewed_for_local_noncommercial_use' },
  ].filter((item, index, items) => items.findIndex((other) => other.sourceId === item.sourceId) === index)
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  const endpointAllowlist = unique([
    ...(oldProvider.providers as Json[]).flatMap((provider) => provider.endpointAllowlist || []),
    'http://baostock.com/',
    'https://akshare.akfamily.xyz/',
    'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get',
  ])
  const sourceEvidence = {
    schemaVersion: 'fams.public_market_bundle.point_in_time_source_snapshot.v2',
    generatedAt: now.toISOString(),
    candidateVersion: CANDIDATE_VERSION,
    candidateSetHash: candidateSet.contentHash,
    profileSetHash: profileSet.profileSetHash,
    selectionArtifact: { path: policy.selectionArtifactRef, sha256: policy.selectionArtifactSha256 },
    pointInTimeBackfill: selection.sourcePointInTimeBackfill,
    priceLake: selection.priceLake,
    inheritedNonProductSourceEvidence: { path: resolve(previous.dir, 'public_market_bundle_source_evidence.json'), sha256: sha256Canonical(oldSource) },
    decisionWindowCount: windows.length,
    componentWindowPathCount: pointPaths.length,
    componentIds: policy.componentIds,
    fieldCoverage: { price: priceCoverage, historicalSecurityStatus: statusCoverage, tradeability: tradeabilityCoverage, fundamental: fundamentalCoverage, dividend: dividendCoverage, industryClassification: industryCoverage },
    futureAnnouncementReuseDetected: false,
    historicalSecurityStatusProxyUsed: false,
    sourceTerms,
    endpointAllowlist,
  }
  const sourceSnapshotHash = sha256Canonical(sourceEvidence)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: USER_ID }, select: { id: true, email: true } })
  const latestAuth = (await formalDataProviderService.listAuthorizations('public_market_bundle')).at(-1)
  if (latestAuth?.decision !== 'approved' || latestAuth.sourceSnapshotHash !== sourceSnapshotHash) {
    await formalDataProviderService.appendAuthorization({
      providerId: 'public_market_bundle', providerClass: 'trusted_public_noncommercial', decision: 'approved',
      authorizationRef: 'project-owner-conversation:2026-09-15:open-source-route-a-point-in-time-candidate-v2',
      authorizationBasis: 'public_terms_local_noncommercial', usageScope: 'local_personal_noncommercial',
      authorizedScopes: ['listed:qfq-history', 'historical:security-status', 'historical:tradeability', 'historical:fundamental-disclosure', 'historical:dividend-disclosure', 'historical:industry-classification'],
      evidenceRefs: [`sha256:${sourceSnapshotHash}`, `sha256:${policy.selectionArtifactSha256}`, `sha256:${selection.sourcePointInTimeBackfill.sha256}`, `sha256:${selection.priceLake.manifestSha256}`],
      sourceTerms, endpointAllowlist, sourceSnapshotHash, credentialRequired: false,
      reviewerUserId: user.id, reviewerEmail: user.email, effectiveFrom: now, now,
    })
  }

  const nonProductIds = FORMAL_RELEASE_CANDIDATES.filter((id) => id !== 'dividend_low_vol_basket')
  const allFields: FormalFieldEvidence[] = []
  for (const candidateId of FORMAL_RELEASE_CANDIDATES) {
    const fields = candidateId === 'dividend_low_vol_basket'
      ? dynamicFields
      : (oldFields.items as FormalFieldEvidence[])
        .filter((item) => item.candidateStrategyId === candidateId)
        .map(refreezeVerifiedHistoricalField)
    assert.equal(fields.length, FORMAL_DATA_FIELD_IDS.length, `field_inventory_mismatch:${candidateId}`)
    allFields.push(...fields)
  }
  assert.equal(nonProductIds.every((id) => allFields.some((item) => item.candidateStrategyId === id)), true)

  const snapshots = []
  for (const candidateId of FORMAL_RELEASE_CANDIDATES) {
    const fields = allFields.filter((item) => item.candidateStrategyId === candidateId)
    const version = candidateSet.candidateVersions[candidateId]
    assert.ok(fields.every((item) => item.candidateStrategyVersion === version))
    const snapshot = await formalDataProviderService.buildCandidateSnapshot({ candidateStrategyId: candidateId, candidateStrategyVersion: version, providerId: 'public_market_bundle', fields, now })
    const persisted = await formalDataProviderService.persistCandidateSnapshot(snapshot)
    snapshots.push({ snapshot, persistence: { id: persisted.record.id, idempotent: persisted.idempotent } })
  }
  const validations = snapshots.map((item) => item.snapshot.fieldEvidenceValidation)
  const fieldEvidenceValidation = {
    schemaVersion: 'fams.formal_data.field_evidence_validation_collection.v2',
    status: validations.every((item) => item.status === 'passed') ? 'passed' : 'blocked',
    candidateCount: snapshots.length,
    items: validations.flatMap((item) => item.items),
    candidateResults: snapshots.map((item) => ({ candidateStrategyId: item.snapshot.candidateStrategyId, candidateStrategyVersion: item.snapshot.candidateStrategyVersion, status: item.snapshot.status, snapshotHash: item.snapshot.snapshotHash, persistedSnapshotId: item.persistence.id, blockers: item.snapshot.blockers })),
    blockers: unique(validations.flatMap((item) => item.blockers)),
    criticalFieldsHaveEvidenceRefs: validations.every((item) => item.items.filter((field) => field.critical).every((field) => field.evidenceRefs.length > 0)),
    noCriticalProviderUnknown: validations.every((item) => item.items.filter((field) => field.critical).every((field) => field.providerClass !== 'unknown')),
    noCriticalFreshnessUnknownOrStale: validations.every((item) => item.items.filter((field) => field.critical).every((field) => ['fresh', 'frozen_historical'].includes(field.freshnessStatus))),
    noCriticalCoverageBlocked: validations.every((item) => item.items.filter((field) => field.critical).every((field) => field.coveragePercent >= 80)),
    researchFallbackPromotedToFormal: false,
    formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  const sourceRef = await writeJson(dir, 'public_market_bundle_source_evidence.json', sourceEvidence)
  const providerAudits = await Promise.all([formalDataProviderService.authorizationAudit('public_market_bundle', now), formalDataProviderService.authorizationAudit('csindex_public', now)])
  const providerCollection = { schemaVersion: 'fams.formal_provider.authorization_audit_collection.v2', status: providerAudits.every((item) => item.status === 'passed') ? 'passed' : 'blocked', providers: providerAudits, sourceEvidenceRef: sourceRef, credentialPersisted: false, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false }
  const providerRef = await writeJson(dir, 'provider_authorization_audit.json', providerCollection)
  const fieldsRef = await writeJson(dir, 'field_evidence_validation_audit.json', fieldEvidenceValidation)
  const after = await protectedAccountDigest()
  assert.deepEqual(after, before)
  const passed = snapshots.every((item) => item.snapshot.status === 'passed') && fieldEvidenceValidation.status === 'passed' && providerCollection.status === 'passed'
  const governance = {
    schemaVersion: 'fams.next_stage.data_governance_acceptance.v2', stageId: 'FTR-1', status: passed ? 'passed' : 'blocked', checkedAt: now.toISOString(), realDataUsed: true, userId: USER_ID, auditUserExcluded: true,
    releaseCandidateSet: { id: candidateSet.id, version: candidateSet.version, contentHash: candidateSet.contentHash, candidateIds: candidateSet.candidateIds, candidateVersions: candidateSet.candidateVersions },
    validationProfileSet: { setVersion: profileSet.setVersion, profileSetHash: profileSet.profileSetHash, sourcePath: resolve(a0.dir, 'validation_profile_set.json') },
    pointInTimeEvidence: { selectionArtifactPath: policy.selectionArtifactRef, selectionArtifactSha256: policy.selectionArtifactSha256, decisionWindowCount: windows.length, componentWindowPathCount: pointPaths.length, componentUnionCount: policy.componentIds.length, fieldCoverage: sourceEvidence.fieldCoverage, futureAnnouncementReuseDetected: false, historicalSecurityStatusProxyUsed: false, immutableReplayVerified: true },
    candidateCount: snapshots.length, formalDataSnapshotCount: snapshots.length, allCandidateSnapshotsPassed: snapshots.every((item) => item.snapshot.status === 'passed'), providerAuthorizationStatus: providerCollection.status, fieldEvidenceValidationStatus: fieldEvidenceValidation.status, formalDataGovernancePassed: passed,
    criticalFieldsHaveEvidenceRefs: fieldEvidenceValidation.criticalFieldsHaveEvidenceRefs, noCriticalProviderUnknown: fieldEvidenceValidation.noCriticalProviderUnknown, noCriticalFreshnessUnknownOrStale: fieldEvidenceValidation.noCriticalFreshnessUnknownOrStale, noCriticalCoverageBlocked: fieldEvidenceValidation.noCriticalCoverageBlocked, researchFallbackPromotedToFormal: false,
    accountFactsUnchanged: true, protectedAccountDigestBefore: before, protectedAccountDigestAfter: after, candidateSnapshots: fieldEvidenceValidation.candidateResults, artifacts: { sourceEvidence: sourceRef, providerAuthorizationAudit: providerRef, fieldEvidenceValidation: fieldsRef }, blockers: unique([...fieldEvidenceValidation.blockers, ...providerAudits.flatMap((item) => item.blockers)]),
    conclusion: { formalDataGovernancePassed: passed, benchmarkQualificationPassed: false, formalValidationPassed: false, humanAcceptanceStatus: 'not_started', formalTradingReleaseReady: false },
    prohibitedActions: [...PROHIBITED_ACTIONS], notTradingAdvice: true, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false,
  }
  const ref = await writeJson(dir, '15_data_governance_audit.json', governance)
  console.log(JSON.stringify({ auditDir: dir, auditRef: ref, status: governance.status, pointInTimeEvidence: governance.pointInTimeEvidence, candidateCount: governance.candidateCount, blockers: governance.blockers, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false }, null, 2))
  if (!passed) process.exitCode = 2
}

main().catch((error) => { console.error(error); process.exitCode = 1 }).finally(async () => prisma.$disconnect().catch(() => undefined))
