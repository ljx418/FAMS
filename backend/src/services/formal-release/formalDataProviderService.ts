import { prisma } from '../../db/prisma.js'
import { dividendLowVolFormalProviderIngestionService } from '../dividend-low-vol/formalProviderIngestionService.js'
import { sha256Canonical } from './formalReleaseHash.js'

export type FormalProviderId = 'tushare_pro'
export type FormalProviderAuthorizationDecision = 'approved' | 'rejected' | 'revoked'
export type FormalFieldFreshnessStatus = 'fresh' | 'stale' | 'unknown'

export interface FormalProviderAuthorizationRecord {
  id: string
  providerId: string
  sequence: number
  providerClass: string
  decision: string
  authorizationRef: string
  authorizedScopes: string[]
  evidenceRefs: string[]
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
  fieldId: string
  critical: boolean
  providerId: string
  providerClass: 'official' | 'authorized_commercial' | 'trusted_internal' | 'free_source' | 'research_proxy' | 'unknown'
  sourceEndpoint: string
  asOfDate: string | null
  fetchedAt: string | null
  coveragePercent: number
  evidenceRefs: string[]
}

const prismaAuthorizationStore: FormalProviderAuthorizationStore = {
  async list(providerId) {
    const rows = await prisma.formalProviderAuthorization.findMany({
      where: { providerId },
      orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
    })
    return rows.map((row) => ({
      ...row,
      authorizedScopes: JSON.parse(row.authorizedScopesJson) as string[],
      evidenceRefs: JSON.parse(row.evidenceRefsJson) as string[],
    }))
  },
  async create(record) {
    const row = await prisma.formalProviderAuthorization.create({
      data: {
        providerId: record.providerId,
        sequence: record.sequence,
        providerClass: record.providerClass,
        decision: record.decision,
        authorizationRef: record.authorizationRef,
        authorizedScopesJson: JSON.stringify(record.authorizedScopes),
        evidenceRefsJson: JSON.stringify(record.evidenceRefs),
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
      authorizedScopes: JSON.parse(row.authorizedScopesJson) as string[],
      evidenceRefs: JSON.parse(row.evidenceRefsJson) as string[],
    }
  },
}

export class FormalDataFreshnessPolicy {
  private readonly maxAgeDaysByField: Record<string, number> = {
    price_history: 5,
    tradeability: 5,
    valuation: 10,
    dividend_history: 400,
    financial_statements: 200,
    industry_classification: 400,
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
    const validatedItems = items.map((item) => {
      const blockers: string[] = []
      const freshnessStatus = this.freshnessPolicy.evaluate(item.fieldId, item.asOfDate, now)
      if (item.critical && !['official', 'authorized_commercial', 'trusted_internal'].includes(item.providerClass)) {
        blockers.push('critical_field_provider_not_formally_qualified')
      }
      if (item.critical && item.evidenceRefs.length === 0) blockers.push('critical_field_evidence_missing')
      if (item.critical && freshnessStatus !== 'fresh') blockers.push(`critical_field_${freshnessStatus}`)
      if (item.critical && item.coveragePercent < 100) blockers.push('critical_field_coverage_incomplete')
      if (!item.sourceEndpoint.trim()) blockers.push('source_endpoint_missing')
      return { ...item, freshnessStatus, blockers, status: blockers.length === 0 ? 'passed' as const : 'blocked' as const }
    })
    const blockers = Array.from(new Set(validatedItems.flatMap((item) => item.blockers)))
    return {
      schemaVersion: 'fams.formal_data.field_evidence_validation.v1' as const,
      status: blockers.length === 0 ? 'passed' as const : 'blocked' as const,
      items: validatedItems,
      blockers,
      researchFallbackPromotedToFormal: false,
      formalTradingUnlocked: false as const,
      orderCreateAllowed: false as const,
    }
  }
}

export class FormalDataProviderService {
  constructor(
    private readonly store: FormalProviderAuthorizationStore = prismaAuthorizationStore,
    private readonly providerConfigured: (providerId: FormalProviderId) => boolean = () => dividendLowVolFormalProviderIngestionService.providerConfigured(),
    private readonly fieldValidator = new FieldEvidenceValidator(),
  ) {}

  async appendAuthorization(input: {
    providerId: FormalProviderId
    providerClass: 'authorized_commercial' | 'official'
    decision: FormalProviderAuthorizationDecision
    authorizationRef: string
    authorizedScopes: string[]
    evidenceRefs: string[]
    reviewerUserId: string
    reviewerEmail: string
    effectiveFrom?: Date
    expiresAt?: Date | null
    now?: Date
  }) {
    if (!input.authorizationRef.trim()) throw new Error('authorization_ref_required')
    if (input.authorizedScopes.length === 0) throw new Error('authorized_scopes_required')
    if (input.evidenceRefs.length === 0) throw new Error('authorization_evidence_required')
    const history = await this.store.list(input.providerId)
    this.assertChain(history)
    const previous = history.at(-1)
    const createdAt = input.now ?? new Date()
    const payload = {
      providerId: input.providerId,
      sequence: (previous?.sequence ?? 0) + 1,
      providerClass: input.providerClass,
      decision: input.decision,
      authorizationRef: input.authorizationRef.trim(),
      authorizedScopes: Array.from(new Set(input.authorizedScopes.map((item) => item.trim()).filter(Boolean))).sort(),
      evidenceRefs: Array.from(new Set(input.evidenceRefs.map((item) => item.trim()).filter(Boolean))).sort(),
      reviewerUserId: input.reviewerUserId,
      reviewerEmail: input.reviewerEmail.toLowerCase(),
      effectiveFrom: input.effectiveFrom ?? createdAt,
      expiresAt: input.expiresAt ?? null,
      previousHash: previous?.recordHash ?? null,
      createdAt,
    }
    const recordHash = sha256Canonical({
      ...payload,
      effectiveFrom: payload.effectiveFrom.toISOString(),
      expiresAt: payload.expiresAt?.toISOString() ?? null,
      createdAt: payload.createdAt.toISOString(),
    })
    return this.store.create({ ...payload, recordHash })
  }

  async authorizationAudit(providerId: FormalProviderId, now = new Date()) {
    const history = await this.store.list(providerId)
    const chainValid = this.isChainValid(history)
    const latest = history.at(-1) ?? null
    const tokenConfigured = this.providerConfigured(providerId)
    const currentlyEffective = Boolean(latest
      && latest.decision === 'approved'
      && latest.effectiveFrom.getTime() <= now.getTime()
      && (!latest.expiresAt || latest.expiresAt.getTime() >= now.getTime()))
    const blockers: string[] = []
    if (!chainValid) blockers.push('provider_authorization_chain_invalid')
    if (!latest) blockers.push('provider_authorization_missing')
    else if (latest.decision !== 'approved') blockers.push(`provider_authorization_${latest.decision}`)
    else if (!currentlyEffective) blockers.push('provider_authorization_not_currently_effective')
    if (!tokenConfigured) blockers.push('formal_provider_credential_missing')
    return {
      schemaVersion: 'fams.formal_provider.authorization_audit.v1' as const,
      providerId,
      status: blockers.length === 0 ? 'passed' as const : 'blocked' as const,
      chainValid,
      recordCount: history.length,
      latestRecord: latest ? this.publicRecord(latest) : null,
      credentialConfigured: tokenConfigured,
      credentialRedacted: tokenConfigured ? 'configured_redacted' : 'missing',
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
  }) {
    if (input.fields.some((item) => item.candidateStrategyId !== input.candidateStrategyId
      || item.candidateStrategyVersion !== input.candidateStrategyVersion)) {
      throw new Error('field_evidence_candidate_mismatch')
    }
    const generatedAt = input.now ?? new Date()
    const [providerAuthorization, fieldEvidenceValidation] = await Promise.all([
      this.authorizationAudit(input.providerId, generatedAt),
      Promise.resolve(this.fieldValidator.validate(input.fields, generatedAt)),
    ])
    const blockers = Array.from(new Set([
      ...providerAuthorization.blockers,
      ...fieldEvidenceValidation.blockers,
    ]))
    const snapshotCore = {
      candidateStrategyId: input.candidateStrategyId,
      candidateStrategyVersion: input.candidateStrategyVersion,
      providerId: input.providerId,
      generatedAt: generatedAt.toISOString(),
      providerAuthorization,
      fieldEvidenceValidation,
    }
    return {
      schemaVersion: 'fams.formal_data.snapshot.v1' as const,
      ...snapshotCore,
      snapshotHash: sha256Canonical(snapshotCore),
      status: blockers.length === 0 ? 'passed' as const : 'blocked' as const,
      blockers,
      formalDataGovernancePassed: blockers.length === 0,
      researchFallbackPromotedToFormal: false,
      formalTradingUnlocked: false as const,
      autoTradeUnlocked: false as const,
      canCreateOrder: false as const,
      orderCreateAllowed: false as const,
    }
  }

  private publicRecord(record: FormalProviderAuthorizationRecord) {
    return {
      id: record.id,
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
      recordHash: record.recordHash,
      createdAt: record.createdAt.toISOString(),
      credentialPersisted: false,
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
      const expectedHash = sha256Canonical({
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
      })
      if (record.recordHash !== expectedHash) throw new Error('provider_authorization_record_hash_invalid')
      previousHash = record.recordHash
    })
  }
}

export const formalDataProviderService = new FormalDataProviderService()
