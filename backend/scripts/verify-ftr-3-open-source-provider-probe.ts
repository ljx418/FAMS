import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')

type Json = Record<string, any>

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

async function latestArtifact() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0A')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const path = resolve(root, name, 'open_source_provider_probe.json')
    try {
      return { path, artifact: JSON.parse(await readFile(path, 'utf8')) as Json }
    } catch {
      continue
    }
  }
  throw new Error('ftr_3r0a_artifact_not_found')
}

async function main() {
  const schema = JSON.parse(await readFile(resolve(repoRoot, 'docs', 'contracts', 'ftr-3-open-source-provider-probe.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const { path, artifact } = await latestArtifact()
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors))
  assert.equal(artifact.decisionDate, '2025-12-12')
  assert.equal(artifact.referenceUniverse.minimumCoveragePercent, 80)
  assert.equal(artifact.accountFactsUnchanged, true)
  assert.equal(artifact.realDataUsed, true)
  assert.deepEqual([...artifact.prohibitedActions].sort(), ['ADD', 'AUTO_TRADE', 'ORDER_CREATE', 'REDUCE'])
  assert.equal(artifact.formalTradingUnlocked, false)
  assert.equal(artifact.autoTradeUnlocked, false)
  assert.equal(artifact.canCreateOrder, false)
  assert.equal(artifact.orderCreateAllowed, false)
  for (const evidence of artifact.evidenceFiles as Json[]) {
    assert.equal((await stat(evidence.path)).isFile(), true, `evidence_missing:${evidence.path}`)
    assert.equal(sha256(await readFile(evidence.path, 'utf8')), evidence.sha256, `evidence_hash_mismatch:${evidence.path}`)
    const raw = JSON.parse(await readFile(evidence.path, 'utf8')) as Json
    assert.equal(raw.liveCall, true, `evidence_not_live:${evidence.path}`)
    assert.equal(raw.decisionDate ?? artifact.decisionDate, artifact.decisionDate, `decision_date_mismatch:${evidence.path}`)
  }
  const ready = artifact.summary.fullMarketBackfillReady === true
  assert.equal(artifact.summary.ftr3r0bEntryAllowed, ready)
  assert.equal(artifact.status, ready ? 'passed' : 'insufficient')
  assert.equal(artifact.blockers.length === 0, ready)
  if (ready) {
    assert.ok(artifact.providerProbes.baostock.universeCoveragePercent >= 80)
    assert.equal(artifact.adapterGapAssessment.batchImplementationReady, true)
  }
  console.log(JSON.stringify({
    artifactPath: path,
    schemaValidation: 'passed',
    semanticValidation: 'passed',
    businessStatus: artifact.status,
    universeStatus: artifact.providerProbes.baostock.universeStatus,
    universeCoveragePercent: artifact.providerProbes.baostock.universeCoveragePercent,
    batchImplementationReady: artifact.adapterGapAssessment.batchImplementationReady,
    blockers: artifact.blockers,
  }, null, 2))
  if (!ready) process.exitCode = 2
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
