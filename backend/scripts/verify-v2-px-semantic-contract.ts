import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readFile, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { relative, resolve, sep } from 'node:path'

type FixtureKind =
  | 'intent_route'
  | 'real_chrome_evidence'
  | 'dual_container_lifecycle'
  | 'acceptance_manifest'
  | 'operation_command_batch'

interface Fixture {
  name: string
  kind: FixtureKind
  expected: 'pass' | 'fail'
  expectedErrorCode?: string
  context?: { px1SpikePassed?: boolean }
  document: unknown
}

interface ValidationIssue {
  code: string
  message: string
}

interface ValidationResult {
  valid: boolean
  issues: ValidationIssue[]
}

interface ArtifactRef {
  path: string
  sha256: string
}

interface LifecycleEvent {
  at: string
  container: 'sidepanel' | 'workspace_page' | 'background'
  eventType: 'start' | 'resume' | 'route_intent' | 'reconnect' | 'close' | 'blocked'
  routeId: string
  correlationId: string
}

const AUTHORITY = {
  productId: 'fams-v2-px',
  repository: 'https://github.com/ljx418/FAMS.git',
  hostApplication: 'FAMS',
  extensionPackage: 'packages/fams-v2-px-extension',
} as const

const requireModule = createRequire(import.meta.url)
const Ajv2020 = requireModule('@fastify/ajv-compiler/node_modules/ajv/dist/2020').default
const repoRoot = resolve(process.cwd(), '..')
const schemaRoot = resolve(repoRoot, 'docs/schemas')
const fixtureRoot = resolve(repoRoot, 'docs/prototypes/v2-px/fixtures')
const fixturesPath = resolve(fixtureRoot, 'semantic-contract-fixtures.json')

function issue(code: string, message: string): ValidationIssue {
  return { code, message }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function findSecretKeys(value: unknown, path = '$'): ValidationIssue[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findSecretKeys(item, `${path}[${index}]`))
  }
  if (!value || typeof value !== 'object') return []
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]) => {
    const found = /(secret|token|password|cookie|authorization|api[_-]?key)/i.test(key)
      ? [issue('secret_key', `Secret-like field is forbidden at ${path}.${key}`)]
      : []
    return [...found, ...findSecretKeys(nested, `${path}.${key}`)]
  })
}

function schemaIssues(validate: { errors?: unknown }, valid: boolean): ValidationIssue[] {
  return valid ? [] : [issue('schema_invalid', JSON.stringify(validate.errors ?? []))]
}

function assertAuthority(document: Record<string, unknown>): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if ('productId' in document && document.productId !== AUTHORITY.productId) {
    issues.push(issue('authority_mismatch', `productId must be ${AUTHORITY.productId}`))
  }
  if ('repository' in document && document.repository !== AUTHORITY.repository) {
    issues.push(issue('authority_mismatch', `repository must be ${AUTHORITY.repository}`))
  }
  return issues
}

async function verifyArtifact(ref: ArtifactRef): Promise<ValidationIssue[]> {
  const candidate = resolve(fixtureRoot, ref.path)
  const fixturePrefix = `${fixtureRoot}${sep}`
  if (candidate !== fixtureRoot && !candidate.startsWith(fixturePrefix)) {
    return [issue('artifact_path_escape', `Artifact path escapes fixture root: ${ref.path}`)]
  }

  try {
    await access(candidate)
  } catch {
    return [issue('artifact_missing', `Artifact does not exist: ${ref.path}`)]
  }

  const [fileStat, canonicalPath] = await Promise.all([stat(candidate), realpath(candidate)])
  if (!canonicalPath.startsWith(fixturePrefix)) {
    return [issue('artifact_path_escape', `Artifact resolves outside fixture root: ${ref.path}`)]
  }
  if (!fileStat.isFile() || fileStat.size === 0) {
    return [issue('artifact_empty', `Artifact must be a non-empty file: ${ref.path}`)]
  }
  const digest = createHash('sha256').update(await readFile(candidate)).digest('hex')
  return digest === ref.sha256
    ? []
    : [issue('hash_mismatch', `SHA-256 mismatch for ${ref.path}: expected ${ref.sha256}, got ${digest}`)]
}

async function verifyArtifactRefs(refs: ArtifactRef[]): Promise<ValidationIssue[]> {
  const results = await Promise.all(refs.map(verifyArtifact))
  return results.flat()
}

function semanticIntentRoute(document: Record<string, unknown>): ValidationIssue[] {
  const issues = [...assertAuthority(document), ...findSecretKeys(document)]
  const actionTargets: Record<string, string> = {
    view_source: 'sidepanel',
    open_workspace: 'workspace_page',
    open_in_workspace: 'workspace_page',
  }
  const expectedTarget = actionTargets[String(document.entryAction)]
  if (!expectedTarget) issues.push(issue('unknown_entry_action', `Unknown entryAction: ${String(document.entryAction)}`))
  if (expectedTarget && document.targetContainer !== expectedTarget) {
    issues.push(issue('target_mismatch', `${String(document.entryAction)} must target ${expectedTarget}`))
  }
  const audit = objectValue(document.audit)
  if (audit.sourceContainer !== document.entryContainer) {
    issues.push(issue('source_mismatch', 'entryContainer and audit.sourceContainer must match'))
  }
  return issues
}

async function semanticChromeEvidence(document: Record<string, unknown>): Promise<ValidationIssue[]> {
  const issues = findSecretKeys(document)
  const extensionId = String(document.extensionId ?? '')
  const routeId = String(document.routeId ?? '')
  for (const pageUrl of Array.isArray(document.pageUrls) ? document.pageUrls : []) {
    if (!String(pageUrl).startsWith(`chrome-extension://${extensionId}/`)) {
      issues.push(issue('fake_chrome_url', `URL does not belong to extensionId ${extensionId}: ${String(pageUrl)}`))
    }
  }

  const screenshots = Array.isArray(document.screenshots) ? document.screenshots.map(objectValue) : []
  for (const screenshot of screenshots) {
    if (screenshot.routeId !== routeId) {
      issues.push(issue('route_mismatch', 'Screenshot routeId differs from browser evidence routeId'))
    }
  }
  const refs = [
    ...screenshots.map((item) => ({ path: String(item.path ?? ''), sha256: String(item.sha256 ?? '') })),
    ...(Array.isArray(document.traceRefs) ? document.traceRefs.map(objectValue) : [])
      .map((item) => ({ path: String(item.path ?? ''), sha256: String(item.sha256 ?? '') })),
  ]
  issues.push(...await verifyArtifactRefs(refs))
  return issues
}

async function semanticLifecycle(document: Record<string, unknown>): Promise<ValidationIssue[]> {
  const issues = [...assertAuthority(document), ...findSecretKeys(document)]
  const routeId = String(document.routeId ?? '')
  const correlationId = String(document.correlationId ?? '')
  const events = (Array.isArray(document.events) ? document.events : []) as LifecycleEvent[]
  const timestamps = events.map((event) => Date.parse(event.at))
  if (timestamps.some((timestamp) => !Number.isFinite(timestamp))) {
    issues.push(issue('event_time_invalid', 'All lifecycle event timestamps must be valid'))
  }
  if (timestamps.some((timestamp, index) => index > 0 && timestamp < timestamps[index - 1])) {
    issues.push(issue('event_order', 'Lifecycle events must be globally chronological'))
  }

  for (const event of events) {
    if (event.routeId !== routeId || event.correlationId !== correlationId) {
      issues.push(issue('route_mismatch', 'Lifecycle event routeId/correlationId differs from audit root'))
    }
  }

  const expectedOrder = ['start', 'resume', 'reconnect', 'close']
  for (const container of ['sidepanel', 'workspace_page'] as const) {
    const relevant = events.filter((event) => event.container === container)
    let previousIndex = -1
    for (const eventType of expectedOrder) {
      const currentIndex = relevant.findIndex((event) => event.eventType === eventType)
      if (currentIndex === -1) {
        issues.push(issue('state_derivation_mismatch', `${container} is missing ${eventType}`))
      } else if (currentIndex <= previousIndex) {
        issues.push(issue('event_order', `${container} ${eventType} appears out of lifecycle order`))
      }
      previousIndex = currentIndex
    }
  }

  const browserEvidence = objectValue(document.browserEvidence)
  if (browserEvidence.routeId !== routeId || browserEvidence.commitSha !== document.commitSha) {
    issues.push(issue('route_mismatch', 'Browser evidence routeId/commitSha differs from lifecycle audit'))
  }
  issues.push(...await semanticChromeEvidence(browserEvidence))
  return issues
}

async function semanticAcceptanceManifest(
  document: Record<string, unknown>,
  context: Fixture['context'],
): Promise<ValidationIssue[]> {
  const issues = findSecretKeys(document)
  const product = objectValue(document.product)
  if (
    product.productId !== AUTHORITY.productId
    || product.hostApplication !== AUTHORITY.hostApplication
    || product.extensionPackage !== AUTHORITY.extensionPackage
    || document.repository !== AUTHORITY.repository
  ) {
    issues.push(issue('authority_mismatch', 'Acceptance manifest product authority differs from PX0 baseline'))
  }

  const pxStage = String(document.pxStage ?? '')
  const stageNumber = Number(pxStage.replace('PX-', ''))
  if (stageNumber >= 2 && context?.px1SpikePassed !== true) {
    issues.push(issue('px_stage_forbidden', `${pxStage} is forbidden until PX-1 spike has passed`))
  }

  const gates = Array.isArray(document.gates) ? document.gates.map(objectValue) : []
  const gateIds = gates.map((gate) => String(gate.gateId ?? ''))
  if (new Set(gateIds).size !== 7 || !['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'].every((id) => gateIds.includes(id))) {
    issues.push(issue('gate_set_invalid', 'Acceptance manifest must contain every gate exactly once'))
  }

  const artifacts = Array.isArray(document.artifacts) ? document.artifacts.map(objectValue) : []
  const refs = artifacts.map((item) => ({ path: String(item.path ?? ''), sha256: String(item.sha256 ?? '') }))
  issues.push(...await verifyArtifactRefs(refs))
  return issues
}

function semanticOperationBatch(documents: Record<string, unknown>[]): ValidationIssue[] {
  const issues = documents.flatMap((document) => [...assertAuthority(document), ...findSecretKeys(document)])
  const seen = new Map<string, string>()
  for (const document of documents) {
    const key = String(document.idempotencyKey ?? '')
    const semanticBody = stableJson({
      commandType: document.commandType,
      routeId: document.routeId,
      correlationId: document.correlationId,
      payload: document.payload,
    })
    const prior = seen.get(key)
    if (prior !== undefined && prior !== semanticBody) {
      issues.push(issue('idempotency_conflict', `idempotencyKey ${key} was reused with different semantics`))
    }
    seen.set(key, semanticBody)
  }
  return issues
}

async function main() {
  const schemaNames = [
    'v2-px-intent-route.schema.json',
    'v2-px-real-chrome-evidence.schema.json',
    'v2-px-dual-container-lifecycle.schema.json',
    'v2-px-acceptance-manifest.schema.json',
    'v2-px-operation-command.schema.json',
  ] as const
  const schemas = await Promise.all(schemaNames.map(async (name) => ({
    name,
    schema: JSON.parse(await readFile(resolve(schemaRoot, name), 'utf8')),
  })))
  // Existing PX schemas use valid JSON Schema applicators without repeating
  // `type: object` inside every if/then branch. Keep all other strict checks on.
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, validateFormats: false })
  for (const { schema } of schemas) ajv.addSchema(schema)
  const validators = {
    intent_route: ajv.getSchema('https://px.local/schemas/v2-px-intent-route.schema.json'),
    real_chrome_evidence: ajv.getSchema('https://px.local/schemas/v2-px-real-chrome-evidence.schema.json'),
    dual_container_lifecycle: ajv.getSchema('https://px.local/schemas/v2-px-dual-container-lifecycle.schema.json'),
    acceptance_manifest: ajv.getSchema('https://px.local/schemas/v2-px-acceptance-manifest.schema.json'),
    operation_command: ajv.getSchema('https://px.local/schemas/v2-px-operation-command.schema.json'),
  }
  for (const [name, validator] of Object.entries(validators)) {
    assert.ok(validator, `Schema validator was not compiled: ${name}`)
  }

  const fixtureCollection = JSON.parse(await readFile(fixturesPath, 'utf8')) as {
    schemaVersion: string
    fixtures: Fixture[]
  }
  assert.equal(fixtureCollection.schemaVersion, 'v2-px-semantic-fixtures/1')
  assert.ok(fixtureCollection.fixtures.length >= 10)

  const results: Array<{
    name: string
    kind: FixtureKind
    expected: Fixture['expected']
    actual: 'pass' | 'fail'
    issueCodes: string[]
  }> = []

  for (const fixture of fixtureCollection.fixtures) {
    const issues: ValidationIssue[] = []
    if (fixture.kind === 'operation_command_batch') {
      const commands = Array.isArray(fixture.document) ? fixture.document.map(objectValue) : []
      if (!Array.isArray(fixture.document)) issues.push(issue('schema_invalid', 'Operation batch must be an array'))
      for (const command of commands) {
        const validator = validators.operation_command!
        issues.push(...schemaIssues(validator, Boolean(validator(command))))
      }
      issues.push(...semanticOperationBatch(commands))
    } else {
      const document = objectValue(fixture.document)
      const validator = validators[fixture.kind]!
      issues.push(...schemaIssues(validator, Boolean(validator(document))))
      if (fixture.kind === 'intent_route') issues.push(...semanticIntentRoute(document))
      if (fixture.kind === 'real_chrome_evidence') issues.push(...await semanticChromeEvidence(document))
      if (fixture.kind === 'dual_container_lifecycle') issues.push(...await semanticLifecycle(document))
      if (fixture.kind === 'acceptance_manifest') {
        issues.push(...await semanticAcceptanceManifest(document, fixture.context))
      }
    }

    const actual = issues.length === 0 ? 'pass' : 'fail'
    assert.equal(actual, fixture.expected, `${fixture.name}: ${JSON.stringify(issues)}`)
    if (fixture.expectedErrorCode) {
      assert.ok(
        issues.some((validationIssue) => validationIssue.code === fixture.expectedErrorCode),
        `${fixture.name} did not produce ${fixture.expectedErrorCode}: ${JSON.stringify(issues)}`,
      )
    }
    results.push({
      name: fixture.name,
      kind: fixture.kind,
      expected: fixture.expected,
      actual,
      issueCodes: [...new Set(issues.map((validationIssue) => validationIssue.code))],
    })
  }

  const positiveFixtures = results.filter((result) => result.expected === 'pass')
  const negativeFixtures = results.filter((result) => result.expected === 'fail')
  assert.ok(positiveFixtures.length > 0)
  assert.ok(negativeFixtures.length >= 9)

  console.log(JSON.stringify({
    schemaVersion: 'fams.v2_px.semantic_contract_verification.v1',
    status: 'passed',
    authority: AUTHORITY,
    schemaCount: schemas.length,
    fixturePath: relative(repoRoot, fixturesPath),
    positiveFixturePassed: positiveFixtures.every((fixture) => fixture.actual === 'pass'),
    negativeFixtureFailed: negativeFixtures.every((fixture) => fixture.actual === 'fail'),
    fakeChromeEvidenceRejected: results.some((result) => result.name === 'fake_real_chrome_url' && result.actual === 'fail'),
    missingFileRejected: results.some((result) => result.issueCodes.includes('artifact_missing')),
    hashMismatchRejected: results.some((result) => result.issueCodes.includes('hash_mismatch')),
    eventOrderMismatchRejected: results.some((result) => result.issueCodes.includes('event_order')),
    arbitrarySecretRejected: results.some((result) => result.issueCodes.includes('secret_key')),
    prematurePx2Rejected: results.some((result) => result.issueCodes.includes('px_stage_forbidden')),
    idempotencyConflictRejected: results.some((result) => result.issueCodes.includes('idempotency_conflict')),
    semanticValidatorImplemented: true,
    antiFalseGreenAcceptanceContractPassed: true,
    realChromeAcceptanceClaimed: false,
    px1SpikePassed: false,
    px2PlusProductionImplementationAllowed: false,
    fixtures: results,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
