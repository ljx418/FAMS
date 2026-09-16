import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { FORMAL_DATA_FIELD_IDS } from '../src/services/formal-release/formalDataProviderService.js'
import { FORMAL_RELEASE_CANDIDATES } from '../src/services/formal-release/releaseCandidateSetService.js'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')

async function latestPassedAuditDir() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-1')
  const entries = await readdir(root, { withFileTypes: true })
  const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()
  for (const directory of directories) {
    const path = resolve(root, directory, '15_data_governance_audit.json')
    try {
      const audit = JSON.parse(await readFile(path, 'utf8'))
      if (audit.status === 'passed') return resolve(root, directory)
    } catch {
      continue
    }
  }
  throw new Error('ftr_1_passed_audit_not_found')
}

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function validateSchema(schemaPath: string, artifact: unknown) {
  const schema = await readJson(resolve(repoRoot, schemaPath))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  assert.equal(validate(artifact), true, `${schemaPath}: ${JSON.stringify(validate.errors)}`)
}

async function main() {
  const dir = process.env.FTR1_AUDIT_DIR ? resolve(process.env.FTR1_AUDIT_DIR) : await latestPassedAuditDir()
  const governance = await readJson(resolve(dir, '15_data_governance_audit.json'))
  const provider = await readJson(resolve(dir, 'provider_authorization_audit.json'))
  const fields = await readJson(resolve(dir, 'field_evidence_validation_audit.json'))
  const source = await readJson(resolve(dir, 'public_market_bundle_source_evidence.json'))

  await validateSchema('docs/contracts/ftr-1-data-governance-audit.schema.json', governance)
  await validateSchema('docs/contracts/ftr-1-provider-authorization-audit.schema.json', provider)
  await validateSchema('docs/contracts/ftr-1-field-evidence-validation-audit.schema.json', fields)

  assert.deepEqual(governance.protectedAccountDigestAfter, governance.protectedAccountDigestBefore)
  assert.deepEqual(governance.releaseCandidateSet.candidateIds, [...FORMAL_RELEASE_CANDIDATES])
  assert.equal(new Set(governance.candidateSnapshots.map((item: any) => item.candidateStrategyId)).size, FORMAL_RELEASE_CANDIDATES.length)
  assert.equal(fields.items.length, FORMAL_RELEASE_CANDIDATES.length * FORMAL_DATA_FIELD_IDS.length)
  for (const candidateId of FORMAL_RELEASE_CANDIDATES) {
    const candidateFields = fields.items.filter((item: any) => item.candidateStrategyId === candidateId)
    assert.deepEqual(candidateFields.map((item: any) => item.fieldId).sort(), [...FORMAL_DATA_FIELD_IDS].sort())
  }

  for (const [key, ref] of Object.entries(governance.artifacts) as Array<[string, any]>) {
    const value = await readJson(ref.path)
    assert.equal(sha256Canonical(value), ref.sha256, `${key} canonical hash mismatch`)
  }
  let replays: any[] = []
  if (source.schemaVersion === 'fams.public_market_bundle.point_in_time_source_snapshot.v2') {
    const selectionRaw = await readFile(source.selectionArtifact.path)
    assert.equal(createHash('sha256').update(selectionRaw).digest('hex'), source.selectionArtifact.sha256)
    const selection = JSON.parse(selectionRaw.toString('utf8'))
    assert.equal(selection.status, 'passed')
    assert.equal(selection.summary.candidateV2RefreezeAllowed, true)
    assert.equal(source.decisionWindowCount, 6)
    const windows = selection.walkForward.windows
    const pointPaths = []
    for (const window of windows) {
      const snapshotRaw = await readFile(window.sourceSnapshotPath)
      assert.equal(createHash('sha256').update(snapshotRaw).digest('hex'), window.sourceSnapshotSha256)
      const snapshot = JSON.parse(snapshotRaw.toString('utf8'))
      for (const symbol of window.selectedSymbols) {
        const candidate = snapshot.candidates.find((item: any) => item.symbol === symbol)
        assert.ok(candidate, `point-in-time candidate missing:${window.windowId}:${symbol}`)
        assert.equal(candidate.historicalStatusEvidenceMode, 'baostock_direct_daily')
        assert.equal(candidate.historicalStatusProxyUsed, false)
        assert.ok(candidate.sourceAnnouncementDates.every((date: string) => date <= window.decisionDate))
        pointPaths.push(candidate)
      }
    }
    assert.equal(pointPaths.length, source.componentWindowPathCount)
    assert.equal(pointPaths.length, governance.pointInTimeEvidence.componentWindowPathCount)
    assert.deepEqual(source.fieldCoverage, governance.pointInTimeEvidence.fieldCoverage)
    const manifestRaw = await readFile(source.priceLake.manifestPath)
    assert.equal(createHash('sha256').update(manifestRaw).digest('hex'), source.priceLake.manifestSha256)
    const manifest = JSON.parse(manifestRaw.toString('utf8'))
    for (const entry of manifest.files.filter((item: any) => String(item.path).includes('/raw/prices/'))) {
      assert.equal(createHash('sha256').update(await readFile(entry.path)).digest('hex'), entry.sha256)
    }
    assert.equal(fields.items.filter((item: any) => item.candidateStrategyId === 'dividend_low_vol_basket').every((item: any) => item.candidateStrategyVersion === 'portfolio.strategy.dividend_low_vol_basket.v2_point_in_time'), true)
    const requiredFields = fields.items.filter((item: any) => item.applicability === 'required')
    const externalHistoricalFields = requiredFields.filter((item: any) => item.providerClass !== 'trusted_internal')
    const internalCurrentFields = requiredFields.filter((item: any) => item.providerClass === 'trusted_internal')
    assert.equal(requiredFields.length > 0, true)
    assert.equal(externalHistoricalFields.every((item: any) => item.temporalScope === 'frozen_historical_window'), true)
    assert.equal(externalHistoricalFields.every((item: any) => item.crossCheckStatus === 'immutable_replay_verified'), true)
    assert.equal(externalHistoricalFields.every((item: any) => item.freshnessStatus === 'frozen_historical'), true)
    assert.equal(internalCurrentFields.every((item: any) => (
      item.temporalScope === 'frozen_historical_window'
        ? item.crossCheckStatus === 'immutable_replay_verified' && item.freshnessStatus === 'frozen_historical'
        : item.crossCheckStatus === 'official_verified' && item.freshnessStatus === 'fresh'
    )), true)
    assert.equal(requiredFields.every((item: any) => /^[a-f0-9]{64}$/.test(item.evidenceHash)), true)
    const inherited = source.inheritedNonProductSourceEvidence
    assert.equal(sha256Canonical(await readJson(inherited.path)), inherited.sha256)
  } else {
    replays = source.seriesChecks.filter((item: any) => item.provenance?.mode === 'same_window_audit_replay')
    for (const replay of replays) {
      const original = await readJson(replay.provenance.artifactRef)
      assert.equal(original.window.startDate, source.window.startDate)
      assert.equal(original.window.endDate, source.window.endDate)
      const originalCheck = original.seriesChecks.find((item: any) => item.symbol === replay.symbol && item.status === 'passed')
      assert.ok(originalCheck, `replay source missing: ${replay.symbol}`)
      assert.equal(originalCheck.contentHash, replay.contentHash, `replay hash mismatch: ${replay.symbol}`)
    }
  }

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_1.acceptance_artifact_verification.v1',
    status: 'passed',
    auditDir: dir,
    schemaValidationPassed: true,
    semanticValidationPassed: true,
    candidateCount: governance.candidateCount,
    fieldEvidenceCount: fields.items.length,
    sourceSeriesCount: source.seriesChecks?.length ?? source.componentIds?.length ?? 0,
    sameWindowAuditReplayCount: replays.length,
    accountFactsUnchanged: true,
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
