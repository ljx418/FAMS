import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile, readdir, stat } from 'node:fs/promises'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
type Json = Record<string, any>

function sha256(value: string | Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

async function latestArtifact() {
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3R0B-FREE')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const path = resolve(root, name, 'free_source_batch_probe.json')
    try {
      return { path, artifact: JSON.parse(await readFile(path, 'utf8')) as Json }
    } catch {
      continue
    }
  }
  throw new Error('ftr_3r0b_free_artifact_not_found')
}

async function main() {
  const schema = JSON.parse(await readFile(resolve(repoRoot, 'docs', 'contracts', 'ftr-3-free-source-batch-probe.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  const { path, artifact } = await latestArtifact()
  assert.equal(validate(artifact), true, JSON.stringify(validate.errors))
  assert.deepEqual(artifact.decisionDates, ['2025-12-12', '2026-01-20', '2026-03-03', '2026-04-08', '2026-05-15', '2026-06-22'])
  assert.equal(artifact.accountFactsUnchanged, true)
  assert.equal(artifact.realDataUsed, true)
  assert.deepEqual([...artifact.prohibitedActions].sort(), ['ADD', 'AUTO_TRADE', 'ORDER_CREATE', 'REDUCE'])
  for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(artifact[field], false)
  for (const evidence of artifact.evidenceFiles as Json[]) {
    assert.equal((await stat(evidence.path)).isFile(), true, `evidence_missing:${evidence.path}`)
    assert.equal(sha256(await readFile(evidence.path)), evidence.sha256, `evidence_hash_mismatch:${evidence.path}`)
    const raw = JSON.parse(await readFile(evidence.path, 'utf8')) as Json
    assert.equal(raw.liveCall, true, `evidence_not_live:${evidence.path}`)
    assert.equal(raw.decisionDate, artifact.decisionDate, `decision_date_mismatch:${evidence.path}`)
  }
  for (const statement of artifact.sourceTerms.statements as Json[]) {
    assert.equal(sha256(statement.reviewedStatement), statement.contentHash, `source_statement_hash_mismatch:${statement.sourceId}`)
  }
  const ready = artifact.summary.freeSourceBatchFeasibilityPassed === true
  assert.equal(artifact.status, ready ? 'passed' : 'insufficient')
  assert.equal(artifact.blockers.length === 0, ready)
  assert.equal(artifact.summary.freeSourceFullMarketBackfillReady, false)
  assert.equal(artifact.summary.ftr3CandidateRedesignAllowed, false)
  assert.equal(artifact.dividendEvidence.missingRowTreatedAsConfirmedNoDividend, false)
  assert.equal(artifact.priceThroughput.fullMarketCoverageClaimed, false)
  if (ready) {
    for (const [name, value] of Object.entries(artifact.coverage)) {
      if (name !== 'dividendPositiveEventPercent') assert.ok(Number(value) >= 80, `${name}_below_80`)
    }
    assert.equal(artifact.priceThroughput.passedSymbolCount, 30)
    assert.ok(artifact.priceThroughput.projectedSequentialHours <= 4)
  }
  console.log(JSON.stringify({
    artifactPath: path,
    schemaValidation: 'passed',
    semanticValidation: 'passed',
    businessStatus: artifact.status,
    coverage: artifact.coverage,
    priceThroughput: artifact.priceThroughput,
    blockers: artifact.blockers,
  }, null, 2))
  if (!ready) process.exitCode = 2
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
