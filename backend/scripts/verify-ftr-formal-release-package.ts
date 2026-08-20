import assert from 'node:assert/strict'
import { access, mkdtemp, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { FormalReleasePackageService } from '../src/services/formal-release/formalReleasePackageService.js'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default

function operationArtifacts() {
  return {
    '13_execution_isolation_audit.json': { executionIsolationAudit: { mode: 'paper_sandbox_only', productionAdapterEnabled: false, realPositionMutationAllowed: false, orderCreateAllowed: false } },
    '14_release_gate_audit.json': { releaseGateAudit: { status: 'blocked', formalTradingUnlocked: false, orderCreateAllowed: false } },
    '15_data_governance_audit.json': { dataGovernanceAudit: { status: 'blocked', blockers: ['formal_provider_authorization_missing'] } },
    '16_benchmark_qualification_audit.json': { benchmarkQualificationAudit: { canSupportFormalTrading: false, blockers: ['official_authorized_total_return_benchmark_not_reviewed'] } },
    '17_formal_validation_audit.json': {
      formalValidationAudit: {
        status: 'insufficient',
        formalValidationPassed: false,
        allReleaseCandidatesPassed: false,
        releaseCandidateSet: { releaseCandidateStrategyIds: ['candidate-a', 'candidate-b'] },
        checks: [
          { strategyId: 'candidate-a', status: 'insufficient' },
          { strategyId: 'candidate-b', status: 'failed' },
        ],
      },
    },
    '18_manual_signoff_audit.json': { manualSignoffAudit: { status: 'missing', allRequiredSignedOff: false } },
  }
}

function operation(artifacts = operationArtifacts()) {
  return {
    id: 'operation-ftr-6-test',
    type: 'portfolio_backtest_run',
    status: 'completed',
    inputJson: JSON.stringify({ releaseCandidateStrategyIds: ['candidate-a', 'candidate-b'] }),
    resultJson: JSON.stringify({ schemaVersion: 'portfolio.backtest.operation_result.v1', artifacts }),
    artifactRefsJson: JSON.stringify(Object.keys(artifacts).map((name) => `operation_artifact:operation-ftr-6-test:${name}`)),
    completedAt: new Date('2026-08-20T02:00:00.000Z'),
  }
}

async function main() {
  const tempDir = await mkdtemp(resolve(tmpdir(), 'fams-ftr-package-'))
  const service = new FormalReleasePackageService(tempDir)
  const packageResult = await service.build({
    operation: operation(),
    operationManifestHash: 'a'.repeat(64),
    providerAuthorizationAudit: { status: 'blocked', blockers: ['provider_authorization_missing'] },
    formalBenchmarkAudits: [],
    manualSignoffAudit: { manualSignoffPassed: false, status: 'missing', blockers: ['data_signoff_missing'] },
    productionAdapterApprovalRecord: { productionAdapterEnabled: false, status: 'missing' },
    now: new Date('2026-08-20T03:00:00.000Z'),
  })
  assert.equal(packageResult.manifest.status, 'ready_for_human_review')
  assert.equal(packageResult.manifest.formalTradingReleaseReviewReady, true)
  assert.equal(packageResult.releaseGateAudit.status, 'blocked')
  assert.equal(packageResult.releaseGateAudit.businessGates.executionIsolationPassed, true)
  assert.equal(packageResult.releaseGateAudit.businessGates.formalDataGovernancePassed, false)
  assert.equal(packageResult.releaseGateAudit.formalTradingUnlocked, false)
  assert.equal(packageResult.releaseGateAudit.orderCreateAllowed, false)
  for (const path of Object.values(packageResult.paths)) await access(path)
  const persistedManifest = JSON.parse(await readFile(packageResult.paths.manifest, 'utf8'))
  assert.equal(persistedManifest.formalTradingReleaseReviewReady, true)
  assert.doesNotMatch(JSON.stringify(packageResult), /"(formalTradingReleaseReady|productionAdapterEnabled|formalTradingUnlocked|autoTradeUnlocked|canCreateOrder|orderCreateAllowed)":true/)

  const repoRoot = resolve(process.cwd(), '..')
  const [releaseGateSchema, manifestSchema] = await Promise.all([
    readFile(resolve(repoRoot, 'docs/contracts/ftr-6-release-gate-audit.schema.json'), 'utf8').then(JSON.parse),
    readFile(resolve(repoRoot, 'docs/contracts/ftr-6-formal-release-review-manifest.schema.json'), 'utf8').then(JSON.parse),
  ])
  const ajv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false })
  const validateReleaseGate = ajv.compile(releaseGateSchema)
  const validateManifest = ajv.compile(manifestSchema)
  assert.equal(validateReleaseGate(packageResult.releaseGateAudit), true, JSON.stringify(validateReleaseGate.errors))
  assert.equal(validateManifest(packageResult.manifest), true, JSON.stringify(validateManifest.errors))
  assert.equal(validateReleaseGate({ ...packageResult.releaseGateAudit, orderCreateAllowed: true }), false)
  assert.equal(validateManifest({ ...packageResult.manifest, unexpectedTradeFlag: true }), false)

  const missing = operationArtifacts()
  delete (missing as Partial<Record<keyof ReturnType<typeof operationArtifacts>, unknown>>)['17_formal_validation_audit.json']
  const incomplete = await service.build({
    operation: operation(missing),
    operationManifestHash: 'b'.repeat(64),
    providerAuthorizationAudit: { status: 'blocked' },
    formalBenchmarkAudits: [],
    manualSignoffAudit: { manualSignoffPassed: false },
    productionAdapterApprovalRecord: { productionAdapterEnabled: false },
    now: new Date('2026-08-20T04:00:00.000Z'),
  })
  assert.equal(incomplete.manifest.status, 'incomplete')
  assert.equal(incomplete.manifest.formalTradingReleaseReviewReady, false)
  assert.ok(incomplete.manifest.missingArtifacts.includes('17_formal_validation_audit.json'))

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_6.formal_release_package_verification.v1',
    status: 'passed',
    packageHash: packageResult.packageHash,
    packageChecks: packageResult.manifest.packageChecks,
    businessGates: packageResult.manifest.businessGates,
    releaseGateStatus: packageResult.releaseGateAudit.status,
    negativeFixtures: ['missing_required_formal_validation_artifact', 'business_gates_blocked_but_not_false_green', 'trading_permission_true_rejected_by_schema', 'unexpected_manifest_property_rejected_by_schema'],
    formalTradingReleaseReviewReady: true,
    releaseApprovalStatus: 'pending_human_approval',
    productionAdapterEnabled: false,
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
