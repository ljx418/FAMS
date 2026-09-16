import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256Canonical } from './formalReleaseHash.js'

export type FormalBenchmarkType = 'official_total_return' | 'trusted_total_return'
export type AnyBenchmarkType = FormalBenchmarkType | 'free_source_total_return' | 'price_index' | 'research_proxy'
export type FormalBenchmarkUsageScope = 'licensed_commercial' | 'local_personal_noncommercial'

export interface FormalBenchmarkPoint {
  date: string
  value: number
}

export interface FormalBenchmarkImportInput {
  schemaVersion: 'fams.formal_benchmark.import.v1'
  benchmarkId: string
  version: string
  benchmarkType: AnyBenchmarkType
  provider: string
  licenseRef: string
  usageScope: FormalBenchmarkUsageScope
  authorizationEvidenceRefs: string[]
  commercialAuthorizationClaimed: boolean
  currency: string
  points: FormalBenchmarkPoint[]
  sourceRefs: string[]
  contentHash?: string
}

export interface FormalBenchmarkArtifact extends Omit<FormalBenchmarkImportInput, 'contentHash'> {
  contentHash: string
  importedAt: string
  importedByUserId: string
  importedByEmail: string
  immutable: true
}

function artifactCore(input: Omit<FormalBenchmarkImportInput, 'contentHash'>) {
  return {
    schemaVersion: input.schemaVersion,
    benchmarkId: input.benchmarkId,
    version: input.version,
    benchmarkType: input.benchmarkType,
    provider: input.provider,
    licenseRef: input.licenseRef,
    usageScope: input.usageScope,
    authorizationEvidenceRefs: input.authorizationEvidenceRefs,
    commercialAuthorizationClaimed: input.commercialAuthorizationClaimed,
    currency: input.currency,
    points: input.points,
    sourceRefs: input.sourceRefs,
  }
}

export function benchmarkContentHash(input: Omit<FormalBenchmarkImportInput, 'contentHash'>) {
  return sha256Canonical(artifactCore(input))
}

function safeSegment(value: string, field: string) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value)) throw new Error(`${field}_invalid`)
  return value
}

export class FormalBenchmarkService {
  constructor(private readonly rootDir = resolve(process.cwd(), 'data', 'formal-release', 'benchmarks')) {}

  validateImport(input: FormalBenchmarkImportInput) {
    if (input.schemaVersion !== 'fams.formal_benchmark.import.v1') throw new Error('benchmark_schema_version_invalid')
    safeSegment(input.benchmarkId, 'benchmark_id')
    safeSegment(input.version, 'benchmark_version')
    if (!['official_total_return', 'trusted_total_return'].includes(input.benchmarkType)) {
      throw new Error('benchmark_type_not_eligible_for_controlled_import')
    }
    if (!input.provider.trim()) throw new Error('benchmark_provider_required')
    if (!input.licenseRef.trim()) throw new Error('benchmark_license_ref_required')
    if (!['licensed_commercial', 'local_personal_noncommercial'].includes(input.usageScope)) {
      throw new Error('benchmark_usage_scope_invalid')
    }
    if (!Array.isArray(input.authorizationEvidenceRefs)
      || input.authorizationEvidenceRefs.length < 3
      || input.authorizationEvidenceRefs.some((ref) => !ref.trim())) {
      throw new Error('benchmark_authorization_evidence_insufficient')
    }
    if (input.benchmarkType === 'official_total_return'
      && (input.usageScope !== 'licensed_commercial' || input.commercialAuthorizationClaimed !== true)) {
      throw new Error('official_benchmark_requires_commercial_authorization')
    }
    if (input.usageScope === 'local_personal_noncommercial' && input.commercialAuthorizationClaimed) {
      throw new Error('noncommercial_scope_cannot_claim_commercial_authorization')
    }
    if (!/^[A-Z]{3}$/.test(input.currency)) throw new Error('benchmark_currency_invalid')
    if (!Array.isArray(input.sourceRefs) || input.sourceRefs.length < 3 || input.sourceRefs.some((ref) => !ref.trim())) {
      throw new Error('benchmark_source_refs_required')
    }
    if (!Array.isArray(input.points) || input.points.length < 2) throw new Error('benchmark_points_insufficient')
    let previousDate = ''
    for (const point of input.points) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(point.date)) throw new Error('benchmark_point_date_invalid')
      if (point.date <= previousDate) throw new Error('benchmark_points_not_strictly_ordered_or_duplicate')
      if (!Number.isFinite(point.value) || point.value <= 0) throw new Error('benchmark_point_value_invalid')
      previousDate = point.date
    }
    const expectedHash = benchmarkContentHash(input)
    if (input.contentHash && input.contentHash !== expectedHash) throw new Error('benchmark_content_hash_mismatch')
    return expectedHash
  }

  async importBenchmark(input: FormalBenchmarkImportInput, actor: { userId: string; email: string }, now = new Date()) {
    const contentHash = this.validateImport(input)
    const benchmarkId = safeSegment(input.benchmarkId, 'benchmark_id')
    const version = safeSegment(input.version, 'benchmark_version')
    const dir = resolve(this.rootDir, benchmarkId)
    const path = resolve(dir, `${version}.json`)
    await mkdir(dir, { recursive: true })
    try {
      const existing = JSON.parse(await readFile(path, 'utf8')) as FormalBenchmarkArtifact
      if (existing.contentHash === contentHash) return { artifact: existing, path, idempotent: true }
      throw new Error('benchmark_version_conflict')
    } catch (error) {
      if (error instanceof Error && error.message === 'benchmark_version_conflict') throw error
      const code = (error as NodeJS.ErrnoException).code
      if (code && code !== 'ENOENT') throw error
    }
    const artifact: FormalBenchmarkArtifact = {
      ...artifactCore(input),
      contentHash,
      importedAt: now.toISOString(),
      importedByUserId: actor.userId,
      importedByEmail: actor.email.toLowerCase(),
      immutable: true,
    }
    await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
    return { artifact, path, idempotent: false }
  }

  async listBenchmarks() {
    try {
      const benchmarkIds = await readdir(this.rootDir, { withFileTypes: true })
      const artifacts: FormalBenchmarkArtifact[] = []
      for (const entry of benchmarkIds.filter((item) => item.isDirectory())) {
        const files = await readdir(resolve(this.rootDir, entry.name))
        for (const file of files.filter((item) => item.endsWith('.json'))) {
          artifacts.push(JSON.parse(await readFile(resolve(this.rootDir, entry.name, file), 'utf8')) as FormalBenchmarkArtifact)
        }
      }
      return artifacts.sort((left, right) => left.benchmarkId.localeCompare(right.benchmarkId) || left.version.localeCompare(right.version))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async loadBenchmark(reference: string) {
    const [benchmarkIdRaw, versionRaw] = reference.split('@')
    const benchmarkId = safeSegment(benchmarkIdRaw, 'benchmark_id')
    if (versionRaw) {
      const version = safeSegment(versionRaw, 'benchmark_version')
      return JSON.parse(await readFile(resolve(this.rootDir, benchmarkId, `${version}.json`), 'utf8')) as FormalBenchmarkArtifact
    }
    const candidates = (await this.listBenchmarks()).filter((item) => item.benchmarkId === benchmarkId)
    const latest = candidates.at(-1)
    if (!latest) throw new Error('formal_benchmark_not_found')
    return latest
  }

  qualificationAudit(artifact: Pick<FormalBenchmarkImportInput, 'benchmarkId' | 'version' | 'benchmarkType' | 'provider' | 'licenseRef' | 'usageScope' | 'authorizationEvidenceRefs' | 'commercialAuthorizationClaimed' | 'currency' | 'sourceRefs' | 'points'> & { contentHash: string }) {
    const blockers: string[] = []
    if (!['official_total_return', 'trusted_total_return'].includes(artifact.benchmarkType)) blockers.push('benchmark_not_official_or_trusted_total_return')
    if (!artifact.licenseRef.trim()) blockers.push('benchmark_license_review_missing')
    if (artifact.sourceRefs.length < 3) blockers.push('benchmark_source_refs_insufficient')
    if (artifact.authorizationEvidenceRefs.length < 3) blockers.push('benchmark_authorization_evidence_insufficient')
    if (artifact.benchmarkType === 'official_total_return'
      && (artifact.usageScope !== 'licensed_commercial' || !artifact.commercialAuthorizationClaimed)) {
      blockers.push('official_benchmark_commercial_authorization_missing')
    }
    if (artifact.usageScope === 'local_personal_noncommercial' && artifact.commercialAuthorizationClaimed) {
      blockers.push('noncommercial_scope_commercial_claim_conflict')
    }
    if (artifact.points.length < 2) blockers.push('benchmark_replay_points_insufficient')
    const contentHashVerified = artifact.contentHash === benchmarkContentHash({
      schemaVersion: 'fams.formal_benchmark.import.v1',
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
    })
    if (!contentHashVerified) blockers.push('benchmark_content_hash_invalid')
    return {
      schemaVersion: 'fams.formal_benchmark.qualification_audit.v1' as const,
      benchmarkId: artifact.benchmarkId,
      benchmarkVersion: artifact.version,
      benchmarkType: artifact.benchmarkType,
      provider: artifact.provider,
      usageScope: artifact.usageScope,
      commercialAuthorizationClaimed: artifact.commercialAuthorizationClaimed,
      status: blockers.length === 0 ? 'passed' as const : 'blocked' as const,
      benchmarkQualificationPassed: blockers.length === 0,
      benchmarkAuthorizationReviewed: blockers.length === 0,
      benchmarkSourceRefsPresent: artifact.sourceRefs.length >= 3,
      authorizationEvidenceRefsPresent: artifact.authorizationEvidenceRefs.length >= 3,
      contentHashVerified,
      replayPointCount: artifact.points.length,
      firstDate: artifact.points[0]?.date ?? null,
      lastDate: artifact.points.at(-1)?.date ?? null,
      sourceRefs: artifact.sourceRefs,
      authorizationEvidenceRefs: artifact.authorizationEvidenceRefs,
      blockers,
      researchProxyCannotPass: true,
      freeSourceCannotPass: true,
      priceIndexCannotPass: true,
      formalTradingUnlocked: false as const,
      autoTradeUnlocked: false as const,
      canCreateOrder: false as const,
      orderCreateAllowed: false as const,
    }
  }

  async buildSeries(reference: string, dates: string[]) {
    const artifact = await this.loadBenchmark(reference)
    const qualification = this.qualificationAudit(artifact)
    if (qualification.status !== 'passed') return { artifact, qualification, series: new Map<string, { netValue: number; cumulativeReturnPercent: number }>() }
    const pointsByDate = new Map(artifact.points.map((point) => [point.date, point.value]))
    const baseDate = dates.find((date) => pointsByDate.has(date))
    const baseValue = baseDate ? pointsByDate.get(baseDate) : undefined
    const series = new Map<string, { netValue: number; cumulativeReturnPercent: number }>()
    if (baseValue) {
      for (const date of dates) {
        const value = pointsByDate.get(date)
        if (!value) continue
        const netValue = value / baseValue
        series.set(date, {
          netValue: Math.round(netValue * 1_000_000) / 1_000_000,
          cumulativeReturnPercent: Math.round((netValue - 1) * 1_000_000) / 10_000,
        })
      }
    }
    return { artifact, qualification, series }
  }
}

export const formalBenchmarkService = new FormalBenchmarkService()
