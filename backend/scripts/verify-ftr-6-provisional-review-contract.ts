import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')

async function readJson(path: string) { return JSON.parse(await readFile(path, 'utf8')) }
async function latestDir() {
  const root = resolve(process.cwd(), 'data/gpt-audit/formal-release-readiness/FTR-6')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const dir = resolve(root, name)
    try {
      if ((await readJson(resolve(dir, 'formal_release_review_manifest.json'))).schemaVersion === 'fams.formal_release.provisional_review_manifest.v2') return dir
    } catch {
      // Ignore incomplete runs.
    }
  }
  throw new Error('ftr6_contract_fixture_not_found')
}

async function main() {
  const dir = await latestDir()
  const [source, gate, manifest] = await Promise.all([
    readJson(resolve(dir, 'ftr6_source_manifest.json')),
    readJson(resolve(dir, '14_release_gate_audit.json')),
    readJson(resolve(dir, 'formal_release_review_manifest.json')),
  ])
  const schemas = await Promise.all([
    'ftr-6-source-manifest.schema.json',
    'ftr-6-provisional-release-gate-audit.schema.json',
    'ftr-6-provisional-review-manifest.schema.json',
  ].map((name) => readJson(resolve(repoRoot, 'docs/contracts', name))))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const [validateSource, validateGate, validateManifest] = schemas.map((schema) => ajv.compile(schema))
  assert.equal(validateSource(source), true, JSON.stringify(validateSource.errors))
  assert.equal(validateGate(gate), true, JSON.stringify(validateGate.errors))
  assert.equal(validateManifest(manifest), true, JSON.stringify(validateManifest.errors))
  const rejected: string[] = []
  const expectRejected = (name: string, validate: (value: any) => boolean, value: any) => {
    assert.equal(validate(value), false, `negative fixture accepted: ${name}`)
    rejected.push(name)
  }
  expectRejected('source_stage_missing', validateSource, { ...source, sourceStageCoverage: source.sourceStageCoverage.slice(0, 5) })
  expectRejected('source_invalidated_artifact_included', validateSource, { ...source, invalidatedArtifactIncluded: true })
  expectRejected('source_risk_not_rebound', validateSource, { ...source, ftr4RiskEvidenceReboundToCurrentFtr5: false })
  expectRejected('release_gate_manual_signoff_forged', validateGate, { ...gate, businessGates: { ...gate.businessGates, manualSignoffPassed: true } })
  expectRejected('release_gate_unlocked', validateGate, { ...gate, formalTradingUnlocked: true })
  expectRejected('release_gate_failed_window_hidden', validateGate, { ...gate, packageChecks: { ...gate.packageChecks, blockedAndInsufficientResultsPreserved: false } })
  expectRejected('manifest_human_review_omitted', validateManifest, { ...manifest, humanReviewRequired: false })
  expectRejected('manifest_approved_item_injected', validateManifest, { ...manifest, reviewQueue: { ...manifest.reviewQueue, approvedCount: 1 } })
  expectRejected('manifest_final_package_forged', validateManifest, { ...manifest, finalFormalReleaseReviewPackageReady: true })
  expectRejected('manifest_order_creation_unlocked', validateManifest, { ...manifest, orderCreateAllowed: true })
  console.log(JSON.stringify({
    schemaVersion: 'fams.formal_release.ftr6_provisional_contract_verification.v1',
    status: 'passed',
    positiveSchemasPassed: 3,
    negativeFixturesPassed: rejected.length,
    rejected,
    humanAcceptanceStatus: 'pending_batch_review',
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
