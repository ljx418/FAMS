import { prisma } from '../../db/prisma.js'
import { sha256Canonical } from './formalReleaseHash.js'

export const FORMAL_RELEASE_CANDIDATES = [
  'local_real_data_sample_60_40',
  'local_real_data_equal_weight_5',
  'local_real_data_concentrated_3',
  'dividend_low_vol_basket',
  'permanent_portfolio',
  'all_weather',
  'current_holdings_buy_and_hold',
] as const

export type FormalReleaseCandidateId = typeof FORMAL_RELEASE_CANDIDATES[number]

export const FORMAL_RELEASE_CANDIDATE_VERSIONS: Record<FormalReleaseCandidateId, string> = {
  local_real_data_sample_60_40: 'portfolio.strategy.local_real_data_sample_60_40.v1',
  local_real_data_equal_weight_5: 'portfolio.strategy.local_real_data_equal_weight_5.v1',
  local_real_data_concentrated_3: 'portfolio.strategy.local_real_data_concentrated_3.v1',
  dividend_low_vol_basket: 'portfolio.strategy.dividend_low_vol_basket.v1',
  permanent_portfolio: 'portfolio.strategy.v1',
  all_weather: 'portfolio.strategy.v1',
  current_holdings_buy_and_hold: 'portfolio.strategy.current_holdings_buy_and_hold.v1',
}

export const FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2: Record<FormalReleaseCandidateId, string> = {
  ...FORMAL_RELEASE_CANDIDATE_VERSIONS,
  dividend_low_vol_basket: 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time',
}

export function normalizeFormalReleaseCandidateVersions(input?: Record<string, string>) {
  const source = input ?? FORMAL_RELEASE_CANDIDATE_VERSIONS
  const keys = Object.keys(source).sort()
  const expectedKeys = [...FORMAL_RELEASE_CANDIDATES].sort()
  if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) throw new Error('release_candidate_versions_inventory_mismatch')
  return Object.fromEntries(FORMAL_RELEASE_CANDIDATES.map((candidateId) => {
    const version = source[candidateId]?.trim()
    if (!version) throw new Error(`release_candidate_version_missing:${candidateId}`)
    return [candidateId, version]
  })) as Record<FormalReleaseCandidateId, string>
}

interface FreezeCandidateSetInput {
  setId?: string
  version: string
  userId: string
  createdByUserId: string
  createdByEmail: string
  sourceRefs: string[]
  candidateVersions?: Record<string, string>
  now?: Date
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export class ReleaseCandidateSetService {
  async freeze(input: FreezeCandidateSetInput) {
    if (!/^\d{4}-\d{2}-\d{2}(?:[.-][a-z0-9._-]+)?$/i.test(input.version)) throw new Error('release_candidate_set_version_invalid')
    if (!input.sourceRefs.length) throw new Error('release_candidate_set_source_refs_required')
    if (input.userId.startsWith('audit_')) throw new Error('release_candidate_set_audit_user_forbidden')
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        email: true,
        positions: { where: { status: 'open' }, select: { id: true, updatedAt: true } },
      },
    })
    if (!user) throw new Error('release_candidate_set_user_not_found')
    if (user.positions.length === 0) throw new Error('release_candidate_set_real_positions_required')

    const setId = input.setId ?? 'fams_formal_release_candidates'
    const existing = await prisma.releaseCandidateSet.findUnique({
      where: { setId_version: { setId, version: input.version } },
    })
    const candidateIds = [...FORMAL_RELEASE_CANDIDATES]
    const candidateVersions = normalizeFormalReleaseCandidateVersions(input.candidateVersions)
    const sourceRefs = Array.from(new Set(input.sourceRefs.map((item) => item.trim()).filter(Boolean))).sort()
    if (existing) {
      const same = JSON.stringify(parseStringArray(existing.candidateIdsJson)) === JSON.stringify(candidateIds)
        && existing.candidateVersionsJson === JSON.stringify(candidateVersions)
        && existing.userId === input.userId
        && existing.sourceRefsJson === JSON.stringify(sourceRefs)
      if (!same) throw new Error('release_candidate_set_immutable_version_conflict')
      return { artifact: this.toArtifact(existing, user.positions.length), idempotent: true }
    }

    const snapshotAsOf = input.now ?? new Date()
    const core = {
      schemaVersion: 'fams.release_candidate_set.v1',
      setId,
      version: input.version,
      userId: input.userId,
      status: 'frozen',
      candidateIds,
      candidateVersions,
      sourceRefs,
      snapshotAsOf: snapshotAsOf.toISOString(),
      createdByUserId: input.createdByUserId,
      createdByEmail: input.createdByEmail.toLowerCase(),
      immutable: true,
    }
    const contentHash = sha256Canonical(core)
    const record = await prisma.releaseCandidateSet.create({
      data: {
        schemaVersion: core.schemaVersion,
        setId,
        version: input.version,
        userId: input.userId,
        status: core.status,
        candidateIdsJson: JSON.stringify(candidateIds),
        candidateVersionsJson: JSON.stringify(candidateVersions),
        sourceRefsJson: JSON.stringify(sourceRefs),
        contentHash,
        snapshotAsOf,
        createdByUserId: input.createdByUserId,
        createdByEmail: input.createdByEmail.toLowerCase(),
        immutable: true,
      },
    })
    return { artifact: this.toArtifact(record, user.positions.length), idempotent: false }
  }

  private toArtifact(record: {
    id: string
    schemaVersion: string
    setId: string
    version: string
    userId: string
    status: string
    candidateIdsJson: string
    candidateVersionsJson: string
    sourceRefsJson: string
    contentHash: string
    snapshotAsOf: Date
    createdByUserId: string
    createdByEmail: string
    immutable: boolean
    createdAt: Date
  }, realOpenPositionCount: number) {
    return {
      schemaVersion: record.schemaVersion,
      id: record.id,
      setId: record.setId,
      version: record.version,
      userId: record.userId,
      auditUserExcluded: !record.userId.startsWith('audit_'),
      realOpenPositionCount,
      status: record.status,
      candidateIds: parseStringArray(record.candidateIdsJson),
      candidateVersions: JSON.parse(record.candidateVersionsJson) as Record<string, string>,
      sourceRefs: parseStringArray(record.sourceRefsJson),
      contentHash: record.contentHash,
      snapshotAsOf: record.snapshotAsOf.toISOString(),
      createdByUserId: record.createdByUserId,
      createdByEmail: record.createdByEmail,
      immutable: record.immutable,
      createdAt: record.createdAt.toISOString(),
      formalTradingUnlocked: false as const,
      autoTradeUnlocked: false as const,
      canCreateOrder: false as const,
      orderCreateAllowed: false as const,
    }
  }
}

export const releaseCandidateSetService = new ReleaseCandidateSetService()
