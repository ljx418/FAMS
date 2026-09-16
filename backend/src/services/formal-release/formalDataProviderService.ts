import { prisma } from '../../db/prisma.js'
import { dividendLowVolFormalProviderIngestionService } from '../dividend-low-vol/formalProviderIngestionService.js'
import { sha256Canonical } from './formalReleaseHash.js'

export type FormalProviderId =
  | 'tushare_pro'
  | 'csindex_public'
  | 'tencent_public'
  | 'eastmoney_public'
  | 'public_market_bundle'
  | 'sse_szse_public_disclosure'
export type FormalProviderAuthorizationDecision = 'approved' | 'rejected' | 'revoked'
export type FormalProviderClass =
  | 'official'
  | 'authorized_commercial'
  | 'trusted_internal'
  | 'trusted_public_noncommercial'
  | 'free_source'
  | 'research_proxy'
  | 'unknown'
export type FormalAuthorizationBasis =
  | 'commercial_license'
  | 'official_publication'
  | 'public_terms_local_noncommercial'
  | 'legacy_unspecified'
export type FormalUsageScope = 'licensed_scope' | 'local_personal_noncommercial' | 'legacy_unspecified'
export type FormalFieldFreshnessStatus = 'fresh' | 'frozen_historical' | 'stale' | 'unknown'
export type FormalFieldApplicability = 'required' | 'not_applicable'
export type FormalFieldCrossCheckStatus = 'official_verified' | 'trusted_cross_checked' | 'immutable_replay_verified' | 'not_applicable' | 'failed'

export const FORMAL_DATA_FIELD_IDS = [
  'price',
  'benchmark',
  'dividend',
  'tradeability',
  'fundamental',
  'industryClassification',
  'costModel',
] as const

export type FormalDataFieldId = typeof FORMAL_DATA_FIELD_IDS[number]

export interface FormalSourceTermsEvidence {
  sourceId: string
  title: string
  url: string
  fetchedAt: string
  contentHash: string
  reviewStatus: 'reviewed_for_local_noncommercial_use' | 'reviewed_for_commercial_use' | 'official_publication' | 'blocked'
}

export interface FormalProviderAuthorizationRecord {
  id: string
  recordSchemaVersion: string
  providerId: string
  sequence: number
  providerClass: string
  decision: string
  authorizationRef: string
  authorizationBasis: string
  usageScope: string
  authorizedScopes: string[]
  evidenceRefs: string[]
  sourceTerms: FormalSourceTermsEvidence[]
  endpointAllowlist: string[]
  sourceSnapshotHash: string | null
  credentialRequired: boolean
  reviewerUserId: string
  reviewerEmail: string
  effectiveFrom: Date
  expiresAt: Date | null
  previousHash: string | null
  recordHash: string
  createdAt: Date
}

export interface FormalProviderAuthorizationStore {
  list(providerId: string): Promise<FormalProviderAuthorizationRecord[]>
  create(record: Omit<FormalProviderAuthorizationRecord, 'id'>): Promise<FormalProviderAuthorizationRecord>
}

export interface FormalFieldEvidence {
  candidateStrategyId: string
  candidateStrategyVersion: string
  fieldId: FormalDataFieldId
  critical: boolean
  applicability: FormalFieldApplicability
  notApplicableReason: string | null
  providerId: string
  providerClass: FormalProviderClass
  sourceEndpoint: string
  asOfDate: string | null
  fetchedAt: string | null
  coveragePercent: number
  crossCheckStatus: FormalFieldCrossCheckStatus
  evidenceRefs: string[]
  evidenceHash: string | null
  warnings: string[]
  inputBlockers: string[]
  temporalScope?: 'current_state' | 'frozen_historical_window'
}

export interface FormalDataSnapshotArtifact {
  schemaVersion: 'fams.formal_data.snapshot.v2'
  candidateStrategyId: string
  candidateStrategyVersion: string
  providerId: string
  generatedAt: string
  providerAuthorization: Awaited<ReturnType<FormalDataProviderService['authorizationAudit']>>
  providerAuthorizations: Array<Awaited<ReturnType<FormalDataProviderService['authorizationAudit']>>>
  fieldEvidenceValidation: ReturnType<FieldEvidenceValidator['validate']>
  snapshotHash: string
  status: 'passed' | 'blocked'
  blockers: string[]
  formalDataGovernancePassed: boolean
  researchFallbackPromotedToFormal: false
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  canCreateOrder: false
  orderCreateAllowed: false
}

function parseJsonArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

const prismaAuthorizationStore: FormalProviderAuthorizationStore = {
  async list(providerId) {
    const rows = await prisma.formalProviderAuthorization.findMany({
      where: { providerId },
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map((row) => ({
      ...row,
      authorizedScopes: parseJsonArray<string>(row.authorizedScopesJson),
      evidenceRefs: parseJsonArray<string>(row.evidenceRefsJson),
      sourceTerms: parseJsonArray<FormalSourceTermsEvidence>(row.sourceTermsJson),
      endpointAllowlist: parseJsonArray<string>(row.endpointAllowlistJson),
    }))
  },
  async create(record) {
    const row = await prisma.formalProviderAuthorization.create({
      data: {
        recordSchemaVersion: record.recordSchemaVersion,
        providerId: record.providerId,
        sequence: record.sequence,
        providerClass: record.providerClass,
        decision: record.decision,
        authorizationRef: record.authorizationRef,
        authorizationBasis: record.authorizationBasis,
        usageScope: record.usageScope,
        authorizedScopesJson: JSON.stringify(record.authorizedScopes),
        evidenceRefsJson: JSON.stringify(record.evidenceRefs),
        sourceTermsJson: JSON.stringify(record.sourceTerms),
        endpointAllowlistJson: JSON.stringify(record.endpointAllowlist),
        sourceSnapshotHash: record.sourceSnapshotHash,
        credentialRequired: record.credentialRequired,
        reviewerUserId: record.reviewerUserId,
        reviewerEmail: record.reviewerEmail,
        effectiveFrom: record.effectiveFrom,
        expiresAt: record.expiresAt,
        previousHash: record.previousHash,
        recordHash: record.recordHash,
        createdAt: record.createdAt,
      },
    })
    return {
      ...row,
      authorizedScopes: parseJsonArray<string>(row.authorizedScopesJson),
      evidenceRefs: parseJsonArray<string>(row.evidenceRefsJson),
      sourceTerms: parseJsonArray<FormalSourceTermsEvidence>(row.sourceTermsJson),
      endpointAllowlist: parseJsonArray<string>(row.endpointAllowlistJson),
    }
  },
}

export class FormalDataFreshnessPolicy {
  private readonly maxAgeDaysByField: Record<string, number> = {
    price: 5,
    benchmark: 5,
    tradeability: 5,
    dividend: 400,
    fundamental: 200,
    industryClassification: 400,
    costModel: 30,
  }

  evaluate(fieldId: string, asOfDate: string | null, now = new Date()): FormalFieldFreshnessStatus {
    if (!asOfDate || !/^\d{4}-\d{2}-\d{2}/.test(asOfDate)) return 'unknown'
    const asOf = new Date(asOfDate)
    if (Number.isNaN(asOf.getTime()) || asOf.getTime() > now.getTime() + 86400000) return 'unknown'
    const maxAgeDays = this.maxAgeDaysByField[fieldId] ?? 30
    return (now.getTime() - asOf.getTime()) / 86400000 <= maxAgeDays ? 'fresh' : 'stale'
  }
}

export class FieldEvidenceValidator {
  constructor(private readonly freshnessPolicy = new FormalDataFreshnessPolicy()) {}

  validate(items: FormalFieldEvidence[], now = new Date()) {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.fieldId, (counts.get(item.fieldId) || 0) + 1)
    const shapeBlockers = [
      ...FORMAL_DATA_FIELD_IDS.filter((fieldId) => !counts.has(fieldId)).map((fieldId) => `required_field_missing:${fieldId}`),
      ...Array.from(counts.entries()).filter(([, count]) => count > 1).map(([fieldId]) => `duplicate_field:${fieldId}`),
    ]
    const validatedItems = items.map((item) => {
      const blockers: string[] = [...item.inputBlockers]
      const freshnessStatus = item.applicability === 'not_applicable'
        ? 'fresh' as const
        : item.temporalScope === 'frozen_historical_window'
          ? item.crossCheckStatus === 'immutable_replay_verified' && Boolean(item.asOfDate) && Boolean(item.fetchedAt)
            ? 'frozen_historical' as const
            : 'unknown' as const
        : this.freshnessPolicy.evaluate(item.fieldId, item.asOfDate, now)
      if (item.applicability === 'not_applicable') {
        if (item.critical) blockers.push('critical_field_cannot_be_not_applicable')
        if (!item.notApplicableReason?.trim()) blockers.push('not_applicable_reason_missing')
        if (item.crossCheckStatus !== 'not_applicable') blockers.push('not_applicable_cross_check_status_invalid')
        if (item.evidenceRefs.length === 0) blockers.push('not_applicable_evidence_missing')
      } else if (![
        'official',
        'authorized_commercial',
        'trusted_internal',
        'trusted_public_noncommercial',
      ].includes(item.providerClass)) {
        blockers.push('required_field_provider_not_formally_qualified')
      }
      if (item.applicability === 'required' && item.evidenceRefs.length === 0) blockers.push('required_field_evidence_missing')
      if (item.applicability === 'required' && !['fresh', 'frozen_historical'].includes(freshnessStatus)) blockers.push(`required_field_${freshnessStatus}`)
      if (item.applicability === 'required' && item.coveragePercent < 80) blockers.push('required_field_coverage_below_80_percent')
      if (item.applicability === 'required' && !['official_verified', 'trusted_cross_checked', 'immutable_replay_verified'].includes(item.crossCheckStatus)) {
        blockers.push('required_field_cross_check_failed')
      }
      if (item.applicability === 'required' && !isSha256(item.evidenceHash)) blockers.push('required_field_evidence_hash_invalid')
      if (!item.sourceEndpoint.trim()) blockers.push('source_endpoint_missing')
      return { ...item, freshnessStatus, blockers, status: blockers.length === 0 ? 'passed' as const : 'blocked' as const }
    })
    const blockers = Array.from(new Set([...shapeBlockers, ...validatedItems.flatMap((item) => item.blockers)]))
    return {
      schemaVersion: 'fams.formal_data.field_evidence_validation.v2' as const,
      status: blockers.length === 0 ? 'passed' as const : 'blocked' as const,
      items: validatedItems,
      blockers,
      researchFallbackPromotedToFormal: false,
      formalTradingUnlocked: false as const,
      orderCreateAllowed: false as const,
    }
  }
}

function normalizeStrings(values: string[]) {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean))).sort()
}

function isSha256(value: string | null) {
  return Boolean(value && /^[a-f0-9]{64}$/.test(value))
}

export class FormalDataProviderService {
  constructor(
    private readonly store: FormalProviderAuthorizationStore = prismaAuthorizationStore,
    private readonly providerConfigured: (providerId: FormalProviderId) => boolean = (providerId) => (
      providerId === 'tushare_pro'
        ? dividendLowVolFormalProviderIngestionService.providerConfigured()
        : true
    ),
    private readonly fieldValidator = new FieldEvidenceValidator(),
  ) {}

  async appendAuthorization(input: {
    providerId: FormalProviderId
    providerClass: 'authorized_commercial' | 'official' | 'trusted_public_noncommercial'
    decision: FormalProviderAuthorizationDecision
    authorizationRef: string
    authorizationBasis?: FormalAuthorizationBasis
    usageScope?: FormalUsageScope
    authorizedScopes: string[]
    evidenceRefs: string[]
    sourceTerms?: FormalSourceTermsEvidence[]
    endpointAllowlist?: string[]
    sourceSnapshotHash?: string | null
    credentialRequired?: boolean
    reviewerUserId: string
    reviewerEmail: string
    effectiveFrom?: Date
    expiresAt?: Date | null
    now?: Date
  }) {
    if (!input.authorizationRef.trim()) throw new Error('authorization_ref_required')
    if (input.authorizedScopes.length === 0) throw new Error('authorized_scopes_required')
    if (input.evidenceRefs.length === 0) throw new Error('authorization_evidence_required')
    const publicRoute = input.providerClass === 'trusted_public_noncommercial'
    const commercialRoute = input.providerClass === 'authorized_commercial'
    const authorizationBasis = input.authorizationBasis ?? (publicRoute ? 'public_terms_local_noncommercial' : 'commercial_license')
    const usageScope = input.usageScope ?? (publicRoute ? 'local_personal_noncommercial' : 'licensed_scope')
    const credentialRequired = input.credentialRequired ?? !publicRoute
    const sourceTerms = input.sourceTerms ?? []
    const endpointAllowlist = normalizeStrings(input.endpointAllowlist ?? [])
    const sourceSnapshotHash = input.sourceSnapshotHash ?? null
    if (publicRoute) {
      if (authorizationBasis !== 'public_terms_local_noncommercial') throw new Error('public_provider_authorization_basis_invalid')
      if (usageScope !== 'local_personal_noncommercial') throw new Error('public_provider_usage_scope_invalid')
      if (credentialRequired) throw new Error('public_provider_must_not_require_credential')
      if (sourceTerms.length === 0 || sourceTerms.some((item) => item.reviewStatus === 'blocked')) throw new Error('public_provider_source_terms_not_reviewed')
      if (endpointAllowlist.length === 0) throw new Error('public_provider_endpoint_allowlist_required')
      if (!isSha256(sourceSnapshotHash)) throw new Error('public_provider_source_snapshot_hash_invalid')
    }
    if (commercialRoute) {
      if (authorizationBasis !== 'commercial_license') throw new Error('commercial_provider_authorization_basis_invalid')
      if (usageScope !== 'licensed_scope') throw new Error('commercial_provider_usage_scope_invalid')
      if (!credentialRequired) throw new Error('commercial_provider_credential_required')
      if (sourceTerms.length === 0 || sourceTerms.some((item) => item.reviewStatus !== 'reviewed_for_commercial_use')) {
        throw new Error('commercial_provider_source_terms_not_reviewed')
      }
      if (sourceTerms.some((item) => !item.sourceId.trim() || !item.title.trim() || !item.url.trim() || !item.fetchedAt.trim() || !isSha256(item.contentHash))) {
        throw new Error('commercial_provider_source_terms_invalid')
      }
      if (endpointAllowlist.length === 0) throw new Error('commercial_provider_endpoint_allowlist_required')
      if (!isSha256(sourceSnapshotHash)) throw new Error('commercial_provider_source_snapshot_hash_invalid')
    }
    const history = await this.store.list(input.providerId)
    this.assertChain(history)
    const previous = history.at(-1)
    const createdAt = input.now ?? new Date()
    const payload = {
      recordSchemaVersion: 'fams.formal_provider.authorization.v2',
      providerId: input.providerId,
      sequence: (previous?.sequence ?? 0) + 1,
      providerClass: input.providerClass,
      decision: input.decision,
      authorizationRef: input.authorizationRef.trim(),
      authorizationBasis,
      usageScope,
      authorizedScopes: normalizeStrings(input.authorizedScopes),
      evidenceRefs: normalizeStrings(input.evidenceRefs),
      sourceTerms: [...sourceTerms].sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
      endpointAllowlist,
      sourceSnapshotHash,
      credentialRequired,
      reviewerUserId: input.reviewerUserId,
      reviewerEmail: input.reviewerEmail.toLowerCase(),
      effectiveFrom: input.effectiveFrom ?? createdAt,
      expiresAt: input.expiresAt ?? null,
      previousHash: previous?.recordHash ?? null,
      createdAt,
    }
    const recordHash = sha256Canonical(this.hashPayload(payload))
    return this.store.create({ ...payload, recordHash })
  }

  async authorizationAudit(providerId: FormalProviderId, now = new Date()) {
    const history = await this.store.list(providerId)
    const chainValid = this.isChainValid(history)
    const latest = history.at(-1) ?? null
    const credentialConfigured = latest?.credentialRequired === false ? true : this.providerConfigured(providerId)
    const currentlyEffective = Boolean(latest
      && latest.decision === 'approved'
      && latest.effectiveFrom.getTime() <= now.getTime()
      && (!latest.expiresAt || latest.expiresAt.getTime() >= now.getTime()))
    const blockers: string[] = []
    if (!chainValid) blockers.push('provider_authorization_chain_invalid')
    if (!latest) blockers.push('provider_authorization_missing')
    else if (latest.decision !== 'approved') blockers.push(`provider_authorization_${latest.decision}`)
    else if (!currentlyEffective) blockers.push('provider_authorization_not_currently_effective')
    if (latest?.providerClass === 'trusted_public_noncommercial') {
      if (latest.authorizationBasis !== 'public_terms_local_noncommercial') blockers.push('public_provider_authorization_basis_invalid')
      if (latest.usageScope !== 'local_personal_noncommercial') blockers.push('public_provider_usage_scope_invalid')
      if (latest.sourceTerms.length === 0) blockers.push('public_provider_source_terms_missing')
      if (latest.endpointAllowlist.length === 0) blockers.push('public_provider_endpoint_allowlist_missing')
      if (!isSha256(latest.sourceSnapshotHash)) blockers.push('public_provider_source_snapshot_hash_invalid')
    }
    if (latest?.providerClass === 'authorized_commercial') {
      if (latest.authorizationBasis !== 'commercial_license') blockers.push('commercial_provider_authorization_basis_invalid')
      if (latest.usageScope !== 'licensed_scope') blockers.push('commercial_provider_usage_scope_invalid')
      if (!latest.credentialRequired) blockers.push('commercial_provider_credential_required')
      if (latest.sourceTerms.length === 0 || latest.sourceTerms.some((item) => item.reviewStatus !== 'reviewed_for_commercial_use')) {
        blockers.push('commercial_provider_source_terms_not_reviewed')
      }
      if (latest.sourceTerms.some((item) => !item.sourceId.trim() || !item.title.trim() || !item.url.trim() || !item.fetchedAt.trim() || !isSha256(item.contentHash))) {
        blockers.push('commercial_provider_source_terms_invalid')
      }
      if (latest.endpointAllowlist.length === 0) blockers.push('commercial_provider_endpoint_allowlist_missing')
      if (!isSha256(latest.sourceSnapshotHash)) blockers.push('commercial_provider_source_snapshot_hash_invalid')
    }
    if (latest?.credentialRequired !== false && !credentialConfigured) blockers.push('formal_provider_credential_missing')
    return {
      schemaVersion: 'fams.formal_provider.authorization_audit.v2' as const,
      providerId,
      status: blockers.length === 0 ? 'passed' as const : 'blocked' as const,
      chainValid,
      recordCount: history.length,
      latestRecord: latest ? this.publicRecord(latest) : null,
      credentialRequired: latest?.credentialRequired ?? providerId === 'tushare_pro',
      credentialConfigured,
      credentialRedacted: latest?.credentialRequired === false ? 'not_required' : credentialConfigured ? 'configured_redacted' : 'missing',
      credentialPersisted: false,
      blockers,
      formalTradingUnlocked: false as const,
      orderCreateAllowed: false as const,
    }
  }

  async listAuthorizations(providerId: FormalProviderId) {
    const records = await this.store.list(providerId)
    return records.map((record) => this.publicRecord(record))
  }

  async buildCandidateSnapshot(input: {
    candidateStrategyId: string
    candidateStrategyVersion: string
    providerId: FormalProviderId
    fields: FormalFieldEvidence[]
    now?: Date
  }): Promise<FormalDataSnapshotArtifact> {
    if (input.fields.some((item) => item.candidateStrategyId !== input.candidateStrategyId
      || item.candidateStrategyVersion !== input.candidateStrategyVersion)) {
      throw new Error('field_evidence_candidate_mismatch')
    }
    const generatedAt = input.now ?? new Date()
    const externalProviderIds = Array.from(new Set(input.fields
      .filter((item) => item.applicability === 'required' && item.providerClass !== 'trusted_internal')
      .map((item) => item.providerId))) as FormalProviderId[]
    const [providerAuthorizations, fieldEvidenceValidation] = await Promise.all([
      Promise.all(externalProviderIds.map((providerId) => this.authorizationAudit(providerId, generatedAt))),
      Promise.resolve(this.fieldValidator.validate(input.fields, generatedAt)),
    ])
    const providerAuthorization = providerAuthorizations.find((item) => item.providerId === input.providerId)
      ?? await this.authorizationAudit(input.providerId, generatedAt)
    const blockers = Array.from(new Set([
      ...providerAuthorizations.flatMap((item) => item.blockers),
      ...fieldEvidenceValidation.blockers,
    ]))
    const snapshotCore = {
      candidateStrategyId: input.candidateStrategyId,
      candidateStrategyVersion: input.candidateStrategyVersion,
      providerId: input.providerId,
      generatedAt: generatedAt.toISOString(),
      providerAuthorization,
      providerAuthorizations,
      fieldEvidenceValidation,
    }
    return {
      schemaVersion: 'fams.formal_data.snapshot.v2',
      ...snapshotCore,
      snapshotHash: sha256Canonical(snapshotCore),
      status: blockers.length === 0 ? 'passed' : 'blocked',
      blockers,
      formalDataGovernancePassed: blockers.length === 0,
      researchFallbackPromotedToFormal: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    }
  }

  async persistCandidateSnapshot(snapshot: FormalDataSnapshotArtifact) {
    const existing = await prisma.formalDataSnapshot.findUnique({ where: { snapshotHash: snapshot.snapshotHash } })
    const payloadJson = JSON.stringify(snapshot)
    if (existing) {
      if (existing.payloadJson !== payloadJson) throw new Error('formal_data_snapshot_hash_collision')
      return { record: existing, idempotent: true }
    }
    const record = await prisma.formalDataSnapshot.create({
      data: {
        schemaVersion: snapshot.schemaVersion,
        candidateStrategyId: snapshot.candidateStrategyId,
        candidateStrategyVersion: snapshot.candidateStrategyVersion,
        providerId: snapshot.providerId,
        status: snapshot.status,
        snapshotHash: snapshot.snapshotHash,
        payloadJson,
        blockersJson: JSON.stringify(snapshot.blockers),
        immutable: true,
        generatedAt: new Date(snapshot.generatedAt),
      },
    })
    return { record, idempotent: false }
  }

  private publicRecord(record: FormalProviderAuthorizationRecord) {
    return {
      id: record.id,
      recordSchemaVersion: record.recordSchemaVersion,
      providerId: record.providerId,
      sequence: record.sequence,
      providerClass: record.providerClass,
      decision: record.decision,
      authorizationRef: record.authorizationRef,
      authorizationBasis: record.authorizationBasis,
      usageScope: record.usageScope,
      authorizedScopes: record.authorizedScopes,
      evidenceRefs: record.evidenceRefs,
      sourceTerms: record.sourceTerms,
      endpointAllowlist: record.endpointAllowlist,
      sourceSnapshotHash: record.sourceSnapshotHash,
      credentialRequired: record.credentialRequired,
      reviewerUserId: record.reviewerUserId,
      reviewerEmail: record.reviewerEmail,
      effectiveFrom: record.effectiveFrom.toISOString(),
      expiresAt: record.expiresAt?.toISOString() ?? null,
      previousHash: record.previousHash,
      recordHash: record.recordHash,
      createdAt: record.createdAt.toISOString(),
      credentialPersisted: false,
    }
  }

  private hashPayload(record: Omit<FormalProviderAuthorizationRecord, 'id' | 'recordHash'>) {
    const legacy = {
      providerId: record.providerId,
      sequence: record.sequence,
      providerClass: record.providerClass,
      decision: record.decision,
      authorizationRef: record.authorizationRef,
      authorizedScopes: record.authorizedScopes,
      evidenceRefs: record.evidenceRefs,
      reviewerUserId: record.reviewerUserId,
      reviewerEmail: record.reviewerEmail,
      effectiveFrom: record.effectiveFrom.toISOString(),
      expiresAt: record.expiresAt?.toISOString() ?? null,
      previousHash: record.previousHash,
      createdAt: record.createdAt.toISOString(),
    }
    if (record.recordSchemaVersion === 'fams.formal_provider.authorization.v1') return legacy
    return {
      recordSchemaVersion: record.recordSchemaVersion,
      ...legacy,
      authorizationBasis: record.authorizationBasis,
      usageScope: record.usageScope,
      sourceTerms: record.sourceTerms,
      endpointAllowlist: record.endpointAllowlist,
      sourceSnapshotHash: record.sourceSnapshotHash,
      credentialRequired: record.credentialRequired,
    }
  }

  private isChainValid(records: FormalProviderAuthorizationRecord[]) {
    try {
      this.assertChain(records)
      return true
    } catch {
      return false
    }
  }

  private assertChain(records: FormalProviderAuthorizationRecord[]) {
    let previousHash: string | null = null
    records.forEach((record, index) => {
      if (record.sequence !== index + 1) throw new Error('provider_authorization_sequence_invalid')
      if (record.previousHash !== previousHash) throw new Error('provider_authorization_previous_hash_invalid')
      const expectedHash = sha256Canonical(this.hashPayload(record))
      if (record.recordHash !== expectedHash) throw new Error('provider_authorization_record_hash_invalid')
      previousHash = record.recordHash
    })
  }
}

export const formalDataProviderService = new FormalDataProviderService()
