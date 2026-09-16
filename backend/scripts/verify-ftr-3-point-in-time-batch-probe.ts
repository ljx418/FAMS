import 'dotenv/config'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')

type Json = Record<string, any>

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

async function latestArtifact() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0B')
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries.filter((item) => item.isDirectory()).sort((left, right) => right.name.localeCompare(left.name))) {
    const path = resolve(root, entry.name, 'point_in_time_batch_probe.json')
    try {
      return { path, raw: await readFile(path, 'utf8') }
    } catch {
      continue
    }
  }
  throw new Error('ftr_3r0b_artifact_not_found')
}

async function main() {
  const schema = JSON.parse(await readFile(resolve(repoRoot, 'docs', 'contracts', 'ftr-3-point-in-time-batch-probe.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const { path, raw } = await latestArtifact()
  const artifact = JSON.parse(raw) as Json
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors))
  assert.equal(artifact.decisionDate, '2025-12-12')
  assert.equal(artifact.implementation.pointInTimeBatchAdapterImplemented, true)
  assert.equal(artifact.implementation.endpointAllowlistComplete, true)
  assert.equal(artifact.implementation.historicalUniverseRulePassed, true)
  assert.equal(artifact.implementation.announcementCutoffRulePassed, true)
  assert.equal(artifact.implementation.financialRevisionDeduplicationPassed, true)
  assert.equal(artifact.implementation.industryMembershipEffectiveDateRulePassed, true)
  assert.equal(artifact.implementation.currentUniverseUsedAsHistoricalMembership, false)
  assert.equal(artifact.accountFactsUnchanged, true)
  assert.equal(artifact.mockDataUsed, false)
  assert.equal(artifact.provider.tokenInArtifact, false)
  assert.deepEqual([...artifact.prohibitedActions].sort(), ['ADD', 'AUTO_TRADE', 'ORDER_CREATE', 'REDUCE'])
  assert.equal(artifact.formalTradingUnlocked, false)
  assert.equal(artifact.autoTradeUnlocked, false)
  assert.equal(artifact.canCreateOrder, false)
  assert.equal(artifact.orderCreateAllowed, false)
  const configuredToken = process.env.FAMS_TUSHARE_TOKEN || process.env.TUSHARE_TOKEN || ''
  if (configuredToken) assert.equal(raw.includes(configuredToken), false, 'provider_token_leaked_into_artifact')

  for (const evidence of artifact.evidenceFiles as Json[]) {
    assert.equal((await stat(evidence.path)).isFile(), true, `evidence_missing:${evidence.path}`)
    const evidenceRaw = await readFile(evidence.path, 'utf8')
    assert.equal(sha256(evidenceRaw), evidence.sha256, `evidence_file_hash_mismatch:${evidence.requestId}`)
    const parsed = JSON.parse(evidenceRaw) as Json
    assert.equal(parsed.decisionDate, artifact.decisionDate, `decision_date_mismatch:${evidence.requestId}`)
    assert.equal(parsed.requestId, evidence.requestId, `request_id_mismatch:${evidence.requestId}`)
    assert.equal(sha256Canonical(parsed.rows), evidence.dataHash, `provider_data_hash_mismatch:${evidence.requestId}`)
    const result = (artifact.endpointResults as Json[]).find((item) => item.requestId === evidence.requestId)
    assert.equal(result?.dataHash, evidence.dataHash, `endpoint_data_hash_mismatch:${evidence.requestId}`)
    assert.equal(result?.evidenceRef, evidence.path, `endpoint_evidence_ref_mismatch:${evidence.requestId}`)
  }
  if (artifact.crossCheck.evidenceRef) {
    const crossCheckRaw = await readFile(artifact.crossCheck.evidenceRef, 'utf8')
    assert.equal(sha256(crossCheckRaw), artifact.crossCheck.evidenceSha256, 'cross_check_hash_mismatch')
  }

  const coverageValues = Object.values(artifact.coverage.domains) as Json[]
  const passed = artifact.status === 'passed'
  assert.equal(artifact.blockers.length === 0, passed)
  if (passed) {
    assert.equal(artifact.provider.configured, true)
    assert.equal(artifact.provider.apiAuthorizationUsable, true)
    assert.equal(artifact.provider.usageAuthorizationVerified, true)
    assert.equal(artifact.provider.authorizationUsable, true)
    assert.equal(artifact.provider.liveProviderAttempted, true)
    assert.equal(artifact.realDataUsed, true)
    assert.equal(artifact.rawResponseHashesVerified, true)
    assert.equal(artifact.crossCheck.passed, true)
    assert.equal(coverageValues.every((item) => item.status === 'passed' && item.coveragePercent >= 80), true)
  } else if (artifact.status === 'blocked_provider_not_configured') {
    assert.equal(artifact.provider.configured, false)
    assert.equal(artifact.provider.apiAuthorizationUsable, false)
    assert.equal(artifact.provider.liveProviderAttempted, false)
    assert.equal(artifact.realDataUsed, false)
    assert.equal(artifact.blockers.includes('provider_not_configured'), true)
  } else if (artifact.status === 'blocked_provider_permission') {
    assert.equal(artifact.provider.authorizationUsable, false)
    assert.equal((artifact.endpointResults as Json[]).some((item) => item.status === 'blocked_permission'), true)
  }
  console.log(JSON.stringify({
    artifactPath: path,
    schemaValidation: 'passed',
    semanticValidation: 'passed',
    businessStatus: artifact.status,
    providerConfigured: artifact.provider.configured,
    apiAuthorizationUsable: artifact.provider.apiAuthorizationUsable,
    usageAuthorizationVerified: artifact.provider.usageAuthorizationVerified,
    authorizationUsable: artifact.provider.authorizationUsable,
    evidenceFileCount: artifact.evidenceFiles.length,
    coverage: artifact.coverage.domains,
    blockers: artifact.blockers,
  }, null, 2))
  if (!passed) process.exitCode = 2
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
