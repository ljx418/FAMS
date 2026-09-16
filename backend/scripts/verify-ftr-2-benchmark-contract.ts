import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { FormalBenchmarkService, type FormalBenchmarkImportInput } from '../src/services/formal-release/formalBenchmarkService.js'

function trustedInput(): FormalBenchmarkImportInput {
  return {
    schemaVersion: 'fams.formal_benchmark.import.v1',
    benchmarkId: 'h00300_contract_fixture',
    version: 'v1',
    benchmarkType: 'trusted_total_return',
    provider: 'csindex_public',
    licenseRef: 'public-source-local-personal-noncommercial-owner-decision:test',
    usageScope: 'local_personal_noncommercial',
    authorizationEvidenceRefs: ['fixture:raw', 'fixture:factsheet', 'fixture:owner-decision'],
    commercialAuthorizationClaimed: false,
    currency: 'CNY',
    points: [{ date: '2026-09-10', value: 100 }, { date: '2026-09-11', value: 101 }],
    sourceRefs: ['fixture:endpoint', 'fixture:factsheet', 'fixture:methodology'],
  }
}

async function main() {
  const service = new FormalBenchmarkService(await mkdtemp(resolve(tmpdir(), 'ftr-2-contract-')))
  const input = trustedInput()
  const imported = await service.importBenchmark(input, { userId: 'contract-reviewer', email: 'reviewer@example.test' })
  assert.equal(service.qualificationAudit(imported.artifact).benchmarkQualificationPassed, true)
  assert.throws(() => service.validateImport({ ...input, benchmarkType: 'research_proxy' }), /not_eligible/)
  assert.throws(() => service.validateImport({ ...input, benchmarkType: 'free_source_total_return' }), /not_eligible/)
  assert.throws(() => service.validateImport({ ...input, benchmarkType: 'price_index' }), /not_eligible/)
  assert.throws(() => service.validateImport({ ...input, authorizationEvidenceRefs: ['fixture:one'] }), /authorization_evidence_insufficient/)
  assert.throws(() => service.validateImport({ ...input, sourceRefs: ['fixture:one'] }), /source_refs_required/)
  assert.throws(() => service.validateImport({ ...input, commercialAuthorizationClaimed: true }), /cannot_claim_commercial/)
  assert.throws(() => service.validateImport({
    ...input,
    benchmarkType: 'official_total_return',
    commercialAuthorizationClaimed: false,
  }), /requires_commercial_authorization/)
  await assert.rejects(service.importBenchmark({ ...input, points: [...input.points, { date: '2026-09-12', value: 102 }] }, { userId: 'x', email: 'x@example.test' }), /version_conflict/)

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_2.benchmark_contract_test.v1',
    status: 'passed',
    negativeFixtures: 7,
    trustedPublicNoncommercialAccepted: true,
    publicAccessPromotedToOfficial: false,
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
