import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FORMAL_RELEASE_CANDIDATES, FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2 } from '../src/services/formal-release/releaseCandidateSetService.js'
import { formalValidationProfileSetHash } from '../src/services/formal-release/formalValidationProfileService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestV2A0Dir() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'A0')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      const acceptance = await readJson(resolve(dir, 'a0_acceptance_audit.json'))
      if (acceptance.status === 'passed' && acceptance.releaseCandidateSetVersion === '2026-09-15.point-in-time-candidate-v2') return dir
    } catch {
      // Ignore partial historical attempts.
    }
  }
  throw new Error('a0_v2_passed_artifact_not_found')
}

async function validateSchema(schemaFile: string, value: unknown) {
  const schema = await readJson(resolve(repoRoot, 'docs', 'contracts', schemaFile))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  assert.equal(validate(value), true, `${schemaFile}:${JSON.stringify(validate.errors)}`)
}

function sha256Bytes(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function main() {
  const dir = await latestV2A0Dir()
  const [acceptance, candidateSet, profileSet, policy] = await Promise.all([
    readJson(resolve(dir, 'a0_acceptance_audit.json')),
    readJson(resolve(dir, 'release_candidate_set.json')),
    readJson(resolve(dir, 'validation_profile_set.json')),
    readJson(resolve(dir, 'point_in_time_candidate_policy.json')),
  ])
  await validateSchema('ftr-a0-validation-profile-set.schema.json', profileSet)
  await validateSchema('ftr-a0-point-in-time-candidate-policy.schema.json', policy)

  assert.deepEqual(candidateSet.candidateIds, [...FORMAL_RELEASE_CANDIDATES])
  assert.deepEqual(candidateSet.candidateVersions, FORMAL_RELEASE_CANDIDATE_VERSIONS_POINT_IN_TIME_V2)
  assert.equal(profileSet.profileSetHash, formalValidationProfileSetHash(profileSet))
  assert.equal(profileSet.candidateSet.contentHash, candidateSet.contentHash)
  const assignment = profileSet.candidateAssignments.find((item: any) => item.candidateId === 'dividend_low_vol_basket')
  assert.equal(assignment.componentSelectionMode, 'point_in_time_dynamic')
  assert.equal(assignment.selectionArtifactRef, policy.selectionArtifactRef)
  assert.equal(assignment.selectionArtifactSha256, policy.selectionArtifactSha256)
  assert.equal(assignment.definitionHash, sha256Canonical(policy.policy))
  assert.deepEqual(assignment.componentIds, policy.componentIds)

  const sourceRaw = await readFile(policy.selectionArtifactRef)
  assert.equal(sha256Bytes(sourceRaw), policy.selectionArtifactSha256)
  const source = JSON.parse(sourceRaw.toString('utf8'))
  assert.equal(source.status, 'passed')
  assert.equal(source.summary.candidateV2RefreezeAllowed, true)
  assert.equal(source.summary.ftr4EntryAllowed, false)
  assert.equal(source.walkForward.validWindowCount, 6)
  assert.ok(source.walkForward.passedRatio >= 0.6)
  assert.equal(source.antiFalseGreen.historicalSecurityStatusProxyUsed, false)
  assert.deepEqual(acceptance.protectedAccountDigestAfter, acceptance.protectedAccountDigestBefore)
  for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(acceptance[field], false)

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_a0.point_in_time_acceptance_verification.v1',
    status: 'passed',
    auditDir: dir,
    candidateCount: candidateSet.candidateIds.length,
    componentUnionCount: policy.componentIds.length,
    selectionArtifactSha256Verified: true,
    profileSetHashVerified: true,
    accountFactsUnchanged: true,
    formalDataGovernancePassed: false,
    benchmarkQualificationPassed: false,
    formalValidationPassed: false,
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
