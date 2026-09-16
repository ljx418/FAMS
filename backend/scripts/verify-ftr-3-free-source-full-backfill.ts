import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const dates = ['2025-12-12', '2026-01-20', '2026-03-03', '2026-04-08', '2026-05-15', '2026-06-22']
type Json = Record<string, any>

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function latestArtifact() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0B-FREE')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const path = resolve(root, name, 'free_source_full_backfill.json')
    try {
      return { path, artifact: JSON.parse(await readFile(path, 'utf8')) as Json }
    } catch {
      continue
    }
  }
  throw new Error('ftr_3r0b_free_full_backfill_artifact_not_found')
}

async function main() {
  const schema = JSON.parse(await readFile(resolve(repoRoot, 'docs', 'contracts', 'ftr-3-free-source-full-backfill.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const { path, artifact } = await latestArtifact()
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors))
  const sourceTermsRaw = await readFile(artifact.sourceTermsEvidence.path, 'utf8')
  assert.equal(sha256Canonical(JSON.parse(sourceTermsRaw)), artifact.sourceTermsEvidence.sha256)
  assert.equal(artifact.sourceTermsEvidence.usageScope, 'local_personal_noncommercial')
  assert.equal(artifact.sourceTermsEvidence.commercialRedistributionAllowed, false)
  assert.equal((await stat(artifact.lake.manifestPath)).isFile(), true)
  const manifestRaw = await readFile(artifact.lake.manifestPath)
  assert.equal(sha256(manifestRaw), artifact.lake.manifestSha256)
  const manifest = JSON.parse(manifestRaw.toString('utf8')) as Json
  assert.equal(manifest.schemaVersion, 'fams.ftr_3r.free_source_lake.v1')
  assert.deepEqual(manifest.decisionDates, dates)
  assert.equal(manifest.excludedCriticalDependencies[0].currentSnapshotFallbackAllowed, false)
  assert.equal(manifest.priceSummary.symbolCount, manifest.priceSummary.completedShardCount + manifest.priceSummary.failedThisRun.length)
  assert.equal(manifest.statusSummary.symbolCount, manifest.statusSummary.completedShardCount + manifest.statusSummary.failedThisRun.length)
  assert.equal(manifest.statusSummary.evidenceMode, 'baostock_direct_daily')
  assert.equal(manifest.statusSummary.historicalStatusProxyAllowed, false)
  assert.equal(manifest.files.length, manifest.fileCount)
  for (const entry of manifest.files as Json[]) {
    assert.equal((await stat(entry.path)).isFile(), true, `lake_file_missing:${entry.path}`)
    assert.equal(sha256(await readFile(entry.path)), entry.sha256, `lake_hash_mismatch:${entry.path}`)
  }
  assert.deepEqual(artifact.decisionPoints.map((point: Json) => point.decisionDate), dates)
  for (const point of artifact.decisionPoints as Json[]) {
    const snapshotRaw = await readFile(point.snapshotPath)
    assert.equal(sha256(snapshotRaw), point.snapshotSha256, `snapshot_hash_mismatch:${point.decisionDate}`)
    const snapshot = JSON.parse(snapshotRaw.toString('utf8')) as Json
    assert.equal(snapshot.decisionDate, point.decisionDate)
    assert.equal(snapshot.referenceUniverseCount, point.referenceUniverseCount)
    assert.equal(snapshot.policy.currentUniverseUsedAsHistoricalMembership, false)
    assert.equal(snapshot.policy.failedPriceShardsRemainInDenominator, true)
    assert.equal(snapshot.policy.failedStatusShardsRemainInDenominator, true)
    assert.equal(snapshot.policy.historicalStatusEvidenceMode, 'baostock_direct_daily')
    assert.equal(snapshot.policy.historicalStatusProxyAllowed, false)
    assert.deepEqual([...snapshot.policy.prohibitedActions].sort(), ['ADD', 'AUTO_TRADE', 'ORDER_CREATE', 'REDUCE'])
    assert.deepEqual(snapshot.selectedSymbols, point.selectedSymbols)
    const evaluated = (snapshot.candidates as Json[]).filter((candidate) => candidate.evaluationReady).length
    assert.equal(evaluated, point.candidateEvaluationSnapshotSymbolCount)
    for (const candidate of snapshot.candidates as Json[]) {
      assert.equal(candidate.historicalStatusProxyUsed, false)
      if (candidate.historicalStatusResolved) {
        assert.equal(candidate.historicalStatusEvidenceMode, 'baostock_direct_daily')
        assert.equal(typeof candidate.directIsST, 'boolean')
        assert.ok(['0', '1'].includes(candidate.directTradeStatus))
      }
      for (const announcement of candidate.sourceAnnouncementDates as string[]) {
        assert.ok(announcement <= point.decisionDate, `future_announcement:${candidate.symbol}:${announcement}:${point.decisionDate}`)
      }
      if (candidate.disposition === 'data_insufficient') assert.equal(point.selectedSymbols.includes(candidate.symbol), false)
    }
    const expectedReady = [
      point.marketBarCoveragePercent,
      point.tradeabilityCoveragePercent,
      point.historicalSecurityStatusCoveragePercent,
      point.announcementAwareFundamentalCoveragePercent,
      point.candidateEvaluationSnapshotCoveragePercent,
    ].every((value) => Number(value) >= 80)
    assert.equal(point.pointInTimeSelectionReady, expectedReady)
    assert.equal(point.blockers.length === 0, expectedReady)
  }
  const readyCount = artifact.decisionPoints.filter((point: Json) => point.pointInTimeSelectionReady).length
  assert.equal(artifact.summary.readyDecisionPointCount, readyCount)
  assert.equal(artifact.summary.allDecisionPointsReady, readyCount === 6)
  assert.equal(artifact.status, readyCount === 6 ? 'passed' : 'insufficient')
  assert.equal(artifact.accountFactsUnchanged, true)
  assert.equal(artifact.realDataUsed, true)
  assert.equal(artifact.antiFalseGreen.historicalSecurityStatusProxyUsed, false)
  for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(artifact[field], false)
  console.log(JSON.stringify({ artifactPath: path, schemaValidation: 'passed', semanticValidation: 'passed', businessStatus: artifact.status, decisionPoints: artifact.decisionPoints.map((point: Json) => ({ decisionDate: point.decisionDate, ready: point.pointInTimeSelectionReady, coverages: { marketBar: point.marketBarCoveragePercent, tradeability: point.tradeabilityCoveragePercent, securityStatus: point.historicalSecurityStatusCoveragePercent, fundamental: point.announcementAwareFundamentalCoveragePercent, candidateEvaluation: point.candidateEvaluationSnapshotCoveragePercent }, blockers: point.blockers })), blockers: artifact.blockers }, null, 2))
  if (artifact.status !== 'passed') process.exitCode = 2
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
