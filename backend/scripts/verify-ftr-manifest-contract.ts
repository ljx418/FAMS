import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const stageOrder = ['FTR-0', 'FTR-1', 'FTR-2', 'FTR-3', 'FTR-4', 'FTR-5', 'FTR-6'] as const
const lockedTradeFields = [
  'formalTradingReleaseReady',
  'formalTradingUnlocked',
  'autoTradeUnlocked',
  'canCreateOrder',
  'orderCreateAllowed',
] as const

type JsonObject = Record<string, any>

async function readJson(relativePath: string): Promise<JsonObject> {
  return JSON.parse(await readFile(resolve(repoRoot, relativePath), 'utf8'))
}

function validateManifest(manifest: JsonObject) {
  assert.equal(manifest.schemaVersion, 'fams.formal_release_readiness.substage_manifest_set.v1')
  assert.equal(manifest.stageId, 'formal_release_readiness_closure')
  assert.equal(manifest.currentStateSource, 'docs/current-stage-state.json')
  assert.equal(manifest.supportsControlledAutomation, true)
  assert.equal(manifest.supportsUnattendedEndToEndAutomation, false)
  assert.equal(manifest.supportsFormalTradingUnlock, false)
  assert.deepEqual(manifest.stageOrder, stageOrder)
  assert.deepEqual(Object.keys(manifest.stages), stageOrder)

  for (const stageId of stageOrder) {
    const stage = manifest.stages[stageId]
    assert.equal(stage.stageId, stageId)
    for (const field of [
      'currentEntities',
      'targetEntities',
      'entryCriteria',
      'commands',
      'requiredArtifacts',
      'artifactSchemas',
      'automatedGates',
      'manualGates',
      'userAcceptanceScenarios',
      'exitClaims',
      'rollbackConditions',
    ]) {
      assert.ok(Array.isArray(stage[field]) && stage[field].length > 0, `${stageId}.${field} must be non-empty`)
    }
    for (const command of stage.commands) {
      assert.equal(command.requiredBeforeExit, true)
      assert.ok(['existing', 'existing_requires_ftr_extension', 'planned'].includes(command.availability))
    }
    for (const artifact of stage.artifactSchemas) {
      assert.match(artifact.schemaPath, /^docs\/.+\.schema\.json$/)
      assert.ok(['existing', 'planned_in_stage'].includes(artifact.availability))
    }
    assert.deepEqual(stage.exitCodePolicy, {
      allCommandsMustExitZero: true,
      blockedGateExitCode: 2,
      failedGateExitCode: 1,
    })
  }
}

function validateState(state: JsonObject) {
  assert.equal(state.schemaVersion, 'fams.current_stage_state.v1')
  assert.equal(state.nextStageManifestSource, 'docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json')
  assert.equal(state.documentationSupportsUnattendedEndToEndAutomation, false)
  assert.equal(state.documentationSupportsFormalTradingRelease, false)
  assert.equal(state.implementationApproved, true)
  assert.equal(state.implementationApprovalEvidence.decision, 'approved_for_controlled_implementation')
  assert.equal(state.implementationApprovalEvidence.scope, 'FTR-0_through_FTR-6_automated_scope_then_A6_batch_human_review')
  assert.ok(state.preAutomationExternalPrerequisites.includes('public_source_terms_and_local_noncommercial_use_scope_frozen'))
  assert.ok(state.preAutomationExternalPrerequisites.includes('trusted_total_return_benchmark_source_and_replay_contract_frozen'))
  assert.equal(state.nextStage.stageId, 'formal_release_readiness_closure')
  assert.equal(state.nextStage.unattendedReleaseAllowed, false)
  assert.equal(state.nextStage.targetExitDoesNotImplyTradingUnlock, true)
  assert.equal(state.nextStage.releaseApprovalStatus, 'pending_human_approval')
  for (const field of lockedTradeFields) assert.equal(state.statuses[field], false, `${field} must stay false`)
  assert.ok(state.prohibitedActions.includes('ORDER_CREATE'))
  assert.ok(state.prohibitedActions.includes('AUTO_TRADE'))
}

function expectRejected(label: string, validation: () => void) {
  assert.throws(validation, undefined, `negative fixture must be rejected: ${label}`)
}

async function main() {
  const manifest = await readJson('docs/FTR_0_FTR_6_SUBSTAGE_ACCEPTANCE_MANIFESTS.json')
  const state = await readJson('docs/current-stage-state.json')
  const manifestSchema = await readJson('docs/fams-ftr-substage-acceptance-manifest.schema.json')
  const stateSchema = await readJson('docs/contracts/fams-current-stage-state.schema.json')

  assert.equal(manifestSchema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  assert.equal(stateSchema.$schema, 'https://json-schema.org/draft/2020-12/schema')
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  const validateManifestSchema = ajv.compile(manifestSchema)
  const validateStateSchema = ajv.compile(stateSchema)
  assert.equal(validateManifestSchema(manifest), true, JSON.stringify(validateManifestSchema.errors))
  assert.equal(validateStateSchema(state), true, JSON.stringify(validateStateSchema.errors))
  await access(resolve(repoRoot, manifest.architectureDecision))
  validateManifest(manifest)
  validateState(state)
  const artifactSchemaPaths = Array.from(new Set(stageOrder.flatMap((stageId) => manifest.stages[stageId].artifactSchemas.map((artifact: JsonObject) => artifact.schemaPath))))
  await Promise.all(artifactSchemaPaths.map((schemaPath) => access(resolve(repoRoot, schemaPath))))
  assert.ok(stageOrder.every((stageId) => manifest.stages[stageId].commands.every((command: JsonObject) => command.availability === 'existing')))
  assert.ok(stageOrder.every((stageId) => manifest.stages[stageId].artifactSchemas.every((artifact: JsonObject) => artifact.availability === 'existing')))

  expectRejected('manifest permits trading unlock', () => validateManifest({ ...manifest, supportsFormalTradingUnlock: true }))
  expectRejected('stage order omits FTR-4', () => validateManifest({ ...manifest, stageOrder: stageOrder.filter((id) => id !== 'FTR-4') }))
  expectRejected('state permits order creation', () => validateState({
    ...state,
    statuses: { ...state.statuses, orderCreateAllowed: true },
  }))
  expectRejected('state permits unattended release', () => validateState({
    ...state,
    nextStage: { ...state.nextStage, unattendedReleaseAllowed: true },
  }))

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_manifest_contract_verification.v1',
    status: 'passed',
    stageOrder,
    stageCount: stageOrder.length,
    artifactSchemaCount: artifactSchemaPaths.length,
    allCommandsImplemented: true,
    allArtifactSchemasImplemented: true,
    manifestSchemaValidationPassed: true,
    currentStateSchemaValidationPassed: true,
    negativeFixturesPassed: 4,
    implementationApprovalEvidenceValid: true,
    implementationStatus: state.nextStage.implementationStatus,
    tradeBoundaryLocked: true,
    supportsFormalTradingUnlock: false,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
