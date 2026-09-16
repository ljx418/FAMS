import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { benchmarkContentHash } from '../src/services/formal-release/formalBenchmarkService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestPassedAuditDir() {
  if (process.env.FTR2_AUDIT_DIR) return resolve(process.env.FTR2_AUDIT_DIR)
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-2')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    try {
      await readFile(resolve(root, name, 'INVALIDATED.json'))
      continue
    } catch {
      // A missing invalidation marker means the run remains eligible.
    }
    try {
      const audit = await readJson(resolve(root, name, '16_benchmark_qualification_audit.json'))
      if (audit.status === 'passed') return resolve(root, name)
    } catch {
      // Ignore partial attempts.
    }
  }
  throw new Error('ftr_2_passed_audit_not_found')
}

async function validateSchema(schemaPath: string, artifact: unknown) {
  const schema = await readJson(resolve(repoRoot, schemaPath))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  assert.equal(validate(artifact), true, `${schemaPath}: ${JSON.stringify(validate.errors)}`)
}

function binarySha256(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function main() {
  const dir = await latestPassedAuditDir()
  const qualification = await readJson(resolve(dir, '16_benchmark_qualification_audit.json'))
  const license = await readJson(resolve(dir, 'benchmark_license_review.json'))
  const replay = await readJson(resolve(dir, 'benchmark_total_return_replay.json'))

  await validateSchema('docs/contracts/ftr-2-benchmark-qualification-audit.schema.json', qualification)
  await validateSchema('docs/contracts/ftr-2-benchmark-license-review.schema.json', license)
  await validateSchema('docs/contracts/ftr-2-benchmark-replay.schema.json', replay)

  assert.equal(sha256Canonical(license), qualification.artifactRefs.licenseReview.sha256)
  assert.equal(sha256Canonical(replay), qualification.artifactRefs.replay.sha256)
  assert.equal(resolve(qualification.artifactRefs.licenseReview.path), resolve(dir, 'benchmark_license_review.json'))
  assert.equal(resolve(qualification.artifactRefs.replay.path), resolve(dir, 'benchmark_total_return_replay.json'))

  for (const evidence of license.evidenceFiles) {
    const bytes = await readFile(evidence.path)
    const actual = evidence.kind.startsWith('official_') || evidence.kind === 'raw_index_response'
      ? binarySha256(bytes)
      : sha256Canonical(JSON.parse(bytes.toString('utf8')))
    assert.equal(actual, evidence.sha256, `${evidence.kind} evidence hash mismatch`)
  }

  const sourceSnapshot = await readJson(replay.sourceSnapshotPath)
  const imported = await readJson(replay.benchmarkArtifactPath)
  assert.equal(sha256Canonical(sourceSnapshot), replay.sourceSnapshotCanonicalSha256)
  assert.equal(imported.immutable, true)
  assert.equal(imported.contentHash, replay.contentHash)
  assert.equal(imported.contentHash, benchmarkContentHash(imported))
  assert.equal(imported.benchmarkId, qualification.benchmarkId)
  assert.equal(imported.version, qualification.benchmarkVersion)
  assert.ok(imported.points.length >= 734)
  assert.equal(imported.points.length, replay.pointCount)
  assert.equal(imported.points.at(-1)?.date, replay.lastDate)
  assert.deepEqual(imported.points, sourceSnapshot.benchmark.points)
  assert.deepEqual(qualification.protectedAccountDigestAfter, qualification.protectedAccountDigestBefore)
  const ftr1 = await readJson(qualification.ftr1DataGovernanceArtifact.path)
  assert.equal(sha256Canonical(ftr1), qualification.ftr1DataGovernanceArtifact.sha256)
  assert.equal(ftr1.status, 'passed')
  assert.equal(ftr1.formalDataGovernancePassed, true)
  assert.equal(ftr1.validationProfileSet.profileSetHash, qualification.validationProfileSetHash)
  assert.equal(ftr1.releaseCandidateSet.candidateVersions.dividend_low_vol_basket, qualification.candidateBenchmarkMappings[0].candidateVersion)

  const baseValue = imported.points[0].value
  for (let index = 0; index < replay.replayedPoints.length; index += 1) {
    const source = imported.points[index]
    const point = replay.replayedPoints[index]
    assert.equal(point.date, source.date)
    assert.equal(point.sourceValue, source.value)
    const expectedNetValue = Math.round((source.value / baseValue) * 1_000_000) / 1_000_000
    assert.equal(point.netValue, expectedNetValue)
    assert.equal(point.cumulativeReturnPercent, Math.round((expectedNetValue - 1) * 1_000_000) / 10_000)
  }

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_2.acceptance_artifact_verification.v1',
    status: 'passed',
    auditDir: dir,
    schemaValidationPassed: true,
    semanticValidationPassed: true,
    evidenceFileCount: license.evidenceFiles.length,
    benchmarkPointCount: imported.points.length,
    immutableReplayPassed: true,
    profileBoundFtr1DataGovernancePassed: true,
    accountFactsUnchanged: true,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
