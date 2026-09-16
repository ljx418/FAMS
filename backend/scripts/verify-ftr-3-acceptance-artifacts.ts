import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { access, readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { sha256Canonical } from '../src/services/formal-release/formalReleaseHash.js'
import { formalValidationProfileSetHash } from '../src/services/formal-release/formalValidationProfileService.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const expectedCandidateIds = [
  'local_real_data_sample_60_40',
  'local_real_data_equal_weight_5',
  'local_real_data_concentrated_3',
  'dividend_low_vol_basket',
  'permanent_portfolio',
  'all_weather',
  'current_holdings_buy_and_hold',
]

async function readJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestAuditDir() {
  if (process.env.FTR3_AUDIT_DIR) return resolve(process.env.FTR3_AUDIT_DIR)
  const root = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', 'FTR-3')
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    try {
      await access(resolve(root, name, '17_formal_validation_audit.json'))
      return resolve(root, name)
    } catch {
      // Ignore partial attempts while retaining them as evidence.
    }
  }
  throw new Error('ftr_3_audit_not_found')
}

async function validateSchema(schemaFile: string, artifact: unknown) {
  const schema = await readJson(resolve(repoRoot, 'docs', 'contracts', schemaFile))
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validate = ajv.compile(schema)
  assert.equal(validate(artifact), true, `${schemaFile}: ${JSON.stringify(validate.errors)}`)
}

function roundedRatio(numerator: number, denominator: number) {
  return Math.round((numerator / denominator) * 1_000_000) / 1_000_000
}

async function main() {
  const dir = await latestAuditDir()
  const files = {
    audit: '17_formal_validation_audit.json',
    candidates: 'release_candidate_set.json',
    profiles: 'validation_profile_set.json',
    parameters: 'parameter_replay.json',
    walkForward: 'walk_forward_replay.json',
    groups: 'group_stability.json',
    tradeability: 'tradeability_reconciliation.json',
    taxonomy: 'validation_failure_taxonomy.json',
  }
  const artifacts = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await readJson(resolve(dir, file))]))) as Record<string, any>

  await validateSchema('ftr-3-formal-validation-audit.schema.json', artifacts.audit)
  await validateSchema('ftr-3-release-candidate-set.schema.json', artifacts.candidates)
  await validateSchema('ftr-a0-validation-profile-set.schema.json', artifacts.profiles)
  await validateSchema('ftr-3-parameter-replay.schema.json', artifacts.parameters)
  await validateSchema('ftr-3-walk-forward-replay.schema.json', artifacts.walkForward)
  await validateSchema('ftr-3-group-stability.schema.json', artifacts.groups)
  await validateSchema('ftr-3-tradeability-reconciliation.schema.json', artifacts.tradeability)
  await validateSchema('ftr-3-validation-failure-taxonomy.schema.json', artifacts.taxonomy)

  assert.deepEqual(artifacts.candidates.releaseCandidateStrategyIds, expectedCandidateIds)
  assert.equal(artifacts.profiles.profileSetHash, formalValidationProfileSetHash(artifacts.profiles))
  assert.deepEqual(artifacts.profiles.candidateAssignments.map((item: any) => item.candidateId), expectedCandidateIds)
  assert.deepEqual(artifacts.profiles.productReleaseCandidateIds, ['dividend_low_vol_basket'])
  assert.equal(artifacts.profiles.candidateAssignments.filter((item: any) => item.formalGateApplicable).length, 1)

  const windows = artifacts.walkForward.windows
  assert.deepEqual(windows.map((item: any) => item.windowId), ['wf-01', 'wf-02', 'wf-03', 'wf-04', 'wf-05', 'wf-06'])
  assert.equal(artifacts.walkForward.validWindowCount, windows.filter((item: any) => item.validationSampleSize >= 60).length)
  assert.equal(artifacts.walkForward.passedWindowCount, windows.filter((item: any) => item.status === 'passed').length)
  assert.equal(artifacts.walkForward.passedRatio, roundedRatio(artifacts.walkForward.passedWindowCount, windows.length))
  for (const window of windows) {
    assert.ok(window.trainingStartDate <= window.trainingEndDate)
    assert.ok(window.trainingEndDate < window.validationStartDate)
    assert.ok(window.validationStartDate <= window.validationEndDate)
    const expectedPassed = window.validationSampleSize >= 60
      && window.excessReturnPercent >= 0
      && window.maxDrawdownPercent >= -35
      && window.annualizedTurnoverPercent <= 200
      && window.dataQualityStatus === 'passed'
    assert.equal(window.status === 'passed', expectedPassed, `window status mismatch: ${window.windowId}`)
  }

  const expectedVariants = ['baseline_quarterly_reinvest', 'monthly_rebalance', 'fee_plus_20bp', 'slippage_plus_20bp', 'cash_dividend']
  assert.deepEqual(artifacts.parameters.variants.map((item: any) => item.variantId), expectedVariants)
  assert.equal(new Set(artifacts.parameters.variants.map((item: any) => item.requestHash)).size, 5)
  const baseline = artifacts.parameters.variants[0]
  const fee = artifacts.parameters.variants.find((item: any) => item.variantId === 'fee_plus_20bp')
  const slippage = artifacts.parameters.variants.find((item: any) => item.variantId === 'slippage_plus_20bp')
  const cash = artifacts.parameters.variants.find((item: any) => item.variantId === 'cash_dividend')
  assert.ok(fee.totalReturnPercent < baseline.totalReturnPercent)
  assert.ok(slippage.totalReturnPercent < baseline.totalReturnPercent)
  assert.notEqual(cash.resultHash, baseline.resultHash)
  assert.ok(cash.dividendContributionPercent > 0)
  assert.equal(artifacts.parameters.dividendEvidenceRefs.length, 8)

  assert.equal(artifacts.groups.industryGroupCount, artifacts.groups.industryGroups.filter((item: any) => item.status === 'passed').length)
  assert.equal(artifacts.groups.marketRegimeGroupCount, 3)
  assert.equal(artifacts.groups.liquidityGroupCount, 3)
  assert.equal(artifacts.tradeability.requiredPathCount, artifacts.tradeability.componentIds.length * artifacts.tradeability.windowIds.length)
  assert.equal(artifacts.tradeability.paths.length, artifacts.tradeability.requiredPathCount)
  assert.equal(new Set(artifacts.tradeability.paths.map((item: any) => `${item.symbol}:${item.windowId}`)).size, artifacts.tradeability.paths.length)

  assert.equal(artifacts.audit.strategyCount, 7)
  assert.equal(artifacts.audit.productReleaseCandidateCount, 1)
  assert.equal(artifacts.audit.notApplicableStrategies, 6)
  assert.equal(artifacts.audit.checks.filter((item: any) => item.formalGateStatus === 'not_applicable').length, 6)
  assert.equal(artifacts.taxonomy.nonApplicableObjectsRemainVisible, true)
  assert.deepEqual(artifacts.taxonomy.checks.map((item: any) => item.strategyId), expectedCandidateIds)
  assert.deepEqual(artifacts.audit.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  for (const field of ['formalTradingUnlocked', 'autoTradeUnlocked', 'canCreateOrder', 'orderCreateAllowed']) assert.equal(artifacts.audit[field], false)

  for (const [key, ref] of Object.entries(artifacts.audit.evidenceArtifacts) as Array<[string, { path: string; sha256: string }]>) {
    const artifact = await readJson(ref.path)
    assert.equal(sha256Canonical(artifact), ref.sha256, `artifact hash mismatch: ${key}`)
    assert.equal(resolve(ref.path).startsWith(resolve(dir)), true, `artifact outside FTR-3 dir: ${key}`)
  }

  const businessGatePassed = artifacts.walkForward.passedRatio >= 0.6
    && artifacts.parameters.status === 'passed'
    && artifacts.groups.status === 'passed'
    && artifacts.tradeability.status === 'passed'
  assert.equal(artifacts.audit.formalValidationPassed, businessGatePassed)
  assert.equal(artifacts.audit.allReleaseCandidatesPassed, businessGatePassed)

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_3.acceptance_artifact_verification.v1',
    artifactValidationStatus: 'passed',
    semanticValidationStatus: 'passed',
    businessGateStatus: businessGatePassed ? 'passed' : 'failed',
    auditDir: dir,
    windowPassedRatio: artifacts.walkForward.passedRatio,
    businessBlockers: artifacts.audit.blockers,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
  if (!businessGatePassed) process.exitCode = 2
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
