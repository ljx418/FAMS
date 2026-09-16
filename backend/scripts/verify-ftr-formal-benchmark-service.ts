import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { FormalBenchmarkService, benchmarkContentHash, type FormalBenchmarkImportInput } from '../src/services/formal-release/formalBenchmarkService.js'

function validInput(): FormalBenchmarkImportInput {
  return {
    schemaVersion: 'fams.formal_benchmark.import.v1',
    benchmarkId: 'csi300_total_return_authorized',
    version: '2026.08.20',
    benchmarkType: 'trusted_total_return',
    provider: 'authorized_fixture_provider',
    licenseRef: 'license-review:FTR-2:test-only',
    usageScope: 'licensed_commercial',
    authorizationEvidenceRefs: ['fixture:license', 'fixture:terms', 'fixture:review'],
    commercialAuthorizationClaimed: true,
    currency: 'CNY',
    points: [
      { date: '2026-08-18', value: 1000 },
      { date: '2026-08-19', value: 1005 },
      { date: '2026-08-20', value: 1010 },
    ],
    sourceRefs: ['fixture:trusted-total-return:test-only', 'fixture:factsheet', 'fixture:methodology'],
  }
}

async function main() {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'fams-ftr-benchmark-'))
  const service = new FormalBenchmarkService(tempDir)
  const input = validInput()
  input.contentHash = benchmarkContentHash(input)
  const imported = await service.importBenchmark(input, { userId: 'reviewer-1', email: 'data.reviewer@example.test' }, new Date('2026-08-20T02:00:00.000Z'))
  assert.equal(imported.idempotent, false)
  assert.equal(imported.artifact.importedByEmail, 'data.reviewer@example.test')
  assert.equal(imported.artifact.immutable, true)
  const idempotent = await service.importBenchmark(input, { userId: 'reviewer-2', email: 'other@example.test' })
  assert.equal(idempotent.idempotent, true)

  const audit = service.qualificationAudit(imported.artifact)
  assert.equal(audit.status, 'passed')
  assert.equal(audit.benchmarkQualificationPassed, true)
  assert.equal(audit.contentHashVerified, true)
  assert.equal(audit.benchmarkAuthorizationReviewed, true)
  const replay = await service.buildSeries(`${input.benchmarkId}@${input.version}`, input.points.map((point) => point.date))
  assert.equal(replay.series.size, 3)
  assert.equal(replay.series.get('2026-08-20')?.cumulativeReturnPercent, 1)

  const negativeTypes = ['free_source_total_return', 'price_index', 'research_proxy'] as const
  for (const benchmarkType of negativeTypes) {
    assert.throws(() => service.validateImport({ ...validInput(), benchmarkType }), /benchmark_type_not_eligible/)
    const loose = { ...validInput(), benchmarkType }
    const blocked = service.qualificationAudit({ ...loose, contentHash: benchmarkContentHash(loose) })
    assert.equal(blocked.status, 'blocked')
    assert.equal(blocked.benchmarkQualificationPassed, false)
  }
  assert.throws(() => service.validateImport({
    ...validInput(),
    points: [
      { date: '2026-08-20', value: 100 },
      { date: '2026-08-20', value: 101 },
    ],
  }), /not_strictly_ordered_or_duplicate/)
  assert.throws(() => service.validateImport({ ...validInput(), contentHash: '0'.repeat(64) }), /content_hash_mismatch/)
  assert.throws(() => service.validateImport({
    ...validInput(),
    benchmarkType: 'official_total_return',
    usageScope: 'local_personal_noncommercial',
    commercialAuthorizationClaimed: false,
  }), /official_benchmark_requires_commercial_authorization/)
  assert.throws(() => service.validateImport({
    ...validInput(),
    authorizationEvidenceRefs: ['fixture:only-one'],
  }), /authorization_evidence_insufficient/)
  await assert.rejects(
    service.importBenchmark({ ...validInput(), points: [...validInput().points, { date: '2026-08-21', value: 1020 }] }, { userId: 'reviewer-1', email: 'data.reviewer@example.test' }),
    /benchmark_version_conflict/,
  )

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_2.formal_benchmark_service_verification.v1',
    status: 'passed',
    importedBenchmark: `${imported.artifact.benchmarkId}@${imported.artifact.version}`,
    qualificationAudit: audit,
    negativeFixtures: ['free_source_total_return', 'price_index', 'research_proxy', 'duplicate_date', 'content_hash_mismatch', 'version_conflict'],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
