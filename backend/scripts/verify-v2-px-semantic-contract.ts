import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { relative, resolve, sep } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { createSourceRef, parseSourceRef } from '../src/services/external-brain/sourceRef.js'

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
const privateEvidenceRoot = resolve(repoRoot, '.verification/private/v2-px')
const stageStatePath = resolve(repoRoot, 'docs/current-stage-state.json')

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

function collectEvidenceRefs(value: unknown, refs: string[] = []): string[] {
  if (Array.isArray(value)) {
    value.forEach((item) => collectEvidenceRefs(item, refs))
    return refs
  }
  if (!value || typeof value !== 'object') return refs
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (/evidenceRefs$/i.test(key) && Array.isArray(nested)) {
      refs.push(...nested.filter((item): item is string => typeof item === 'string'))
    }
    collectEvidenceRefs(nested, refs)
  }
  return refs
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

async function verifyPrivateEvidenceArtifact(ref: ArtifactRef): Promise<ValidationIssue[]> {
  const candidate = resolve(repoRoot, ref.path)
  const allowedPrefix = `${privateEvidenceRoot}${sep}`
  if (!candidate.startsWith(allowedPrefix)) {
    return [issue('artifact_path_escape', `Real Chrome artifact is outside private evidence root: ${ref.path}`)]
  }
  try {
    const file = await readFile(candidate)
    if (file.length === 0) return [issue('artifact_empty', `Artifact is empty: ${ref.path}`)]
    const digest = createHash('sha256').update(file).digest('hex')
    return digest === ref.sha256 ? [] : [issue('hash_mismatch', `SHA-256 mismatch for ${ref.path}`)]
  } catch {
    return [issue('artifact_missing', `Artifact does not exist: ${ref.path}`)]
  }
}

async function latestPx1Evidence(): Promise<{ evidence: Record<string, unknown>; manifest: Record<string, unknown>; path: string } | null> {
  try {
    const commits = await readdir(privateEvidenceRoot, { withFileTypes: true })
    const candidates: Array<{ evidence: Record<string, unknown>; manifest: Record<string, unknown>; path: string; endedAt: number }> = []
    for (const commit of commits) {
      if (!commit.isDirectory() || !/^[a-f0-9]{40}$/.test(commit.name)) continue
      const stageDir = resolve(privateEvidenceRoot, commit.name, 'PX1')
      try {
        const [manifest, evidence] = await Promise.all([
          readFile(resolve(stageDir, 'stage-manifest.json'), 'utf8').then(JSON.parse) as Promise<Record<string, unknown>>,
          readFile(resolve(stageDir, 'real-chrome-evidence.json'), 'utf8').then(JSON.parse) as Promise<Record<string, unknown>>,
        ])
        if (manifest.status === 'passed' && manifest.commitSha === commit.name && evidence.commitSha === commit.name) {
          candidates.push({ evidence, manifest, path: relative(repoRoot, stageDir), endedAt: Date.parse(String(manifest.endedAt ?? '')) || 0 })
        }
      } catch {
        // Failed/partial evidence directories are intentionally ignored.
      }
    }
    return candidates.sort((left, right) => right.endedAt - left.endedAt)[0] ?? null
  } catch {
    return null
  }
}

async function verifyTargetChromeEvidence(document: Record<string, unknown>): Promise<ValidationIssue[]> {
  const issues = findSecretKeys(document)
  const extensionId = String(document.extensionId ?? '')
  const pageUrls = Array.isArray(document.pageUrls) ? document.pageUrls.map(String) : []
  if (!pageUrls.every((url) => url.startsWith(`chrome-extension://${extensionId}/`))) {
    issues.push(issue('fake_chrome_url', 'Target Chrome page URL is not owned by the recorded extension'))
  }
  const viewports = Array.isArray(document.viewports) ? document.viewports.map(objectValue) : []
  const widths = viewports.map((item) => Number(item.width)).sort((left, right) => left - right)
  if (stableJson(widths) !== stableJson([360, 420, 768, 1280])) issues.push(issue('viewport_set_invalid', 'Target evidence must contain exactly 360/420/768/1280'))

  const screenshots = Array.isArray(document.screenshots) ? document.screenshots.map(objectValue) : []
  for (const screenshot of screenshots) {
    if (stableJson(screenshot.viewport) !== stableJson(screenshot.imageContentSizePixels)) {
      issues.push(issue('image_size_mismatch', `Declared screenshot pixels differ from viewport: ${String(screenshot.path)}`))
    }
    if (screenshot.rootHorizontalOverflowPx !== 0) issues.push(issue('root_overflow', `Root overflow is non-zero: ${String(screenshot.path)}`))
    const path = resolve(repoRoot, String(screenshot.path ?? ''))
    try {
      const png = await readFile(path)
      if (png.toString('ascii', 1, 4) !== 'PNG') throw new Error('not PNG')
      const actual = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
      if (stableJson(actual) !== stableJson(screenshot.imageContentSizePixels)) {
        issues.push(issue('image_size_mismatch', `PNG header size differs from evidence: ${String(screenshot.path)}`))
      }
    } catch {
      issues.push(issue('artifact_missing', `Screenshot is missing or invalid: ${String(screenshot.path)}`))
    }
  }
  const refs = [
    ...screenshots.map((item) => ({ path: String(item.path ?? ''), sha256: String(item.sha256 ?? '') })),
    ...(Array.isArray(document.traceRefs) ? document.traceRefs.map(objectValue) : []).map((item) => ({ path: String(item.path ?? ''), sha256: String(item.sha256 ?? '') })),
    ...['networkRef', 'consoleRef'].map((key) => objectValue(document[key])).map((item) => ({ path: String(item.path ?? ''), sha256: String(item.sha256 ?? '') })),
  ]
  issues.push(...(await Promise.all(refs.map(verifyPrivateEvidenceArtifact))).flat())
  return issues
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
  const stageState = JSON.parse(await readFile(stageStatePath, 'utf8')) as {
    featureTracks?: { v2PxExternalBrain?: Record<string, unknown> }
  }
  const v2State = stageState.featureTracks?.v2PxExternalBrain ?? {}
  const contractReentryInProgress = v2State.currentPhase === 'px1_contract_reentry'
  if (contractReentryInProgress) {
    assert.equal(v2State.px1TargetContractsImplemented, false, 'PX1 target contract cannot be complete during contract reentry')
    assert.equal(v2State.px2PlusAllowed, false, 'PX2+ promotion must be blocked during PX1 contract reentry')
    assert.ok(Number(v2State.knownBlockingCrossDocumentConflicts) >= 1, 'Contract reentry must disclose the blocking conflict')
  }
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

  const targetContracts = [
    ['v2-px-intent-route-v3.schema.json', 'intent-route-v3.positive.json', 'intent-route-v3.negative.json'],
    ['v2-px-operation-command-v2.schema.json', 'operation-command-v2.positive.json', 'operation-command-v2.negative.json'],
    ['v2-px-dual-container-lifecycle-v3.schema.json', 'dual-container-lifecycle-v3.positive.json', 'dual-container-lifecycle-v3.negative.json'],
    ['v2-px-real-chrome-evidence-v2.schema.json', 'real-chrome-evidence-v2.positive.json', 'real-chrome-evidence-v2.negative.json'],
  ] as const
  const targetAjv = new Ajv2020({ allErrors: true, strict: true, validateFormats: false })
  const targetResults: Array<{ schema: string; positivePassed: boolean; negativeRejected: boolean }> = []
  let validateTargetChrome: { (document: unknown): boolean; errors?: unknown } | undefined
  let validateTargetIntent: { (document: unknown): boolean; errors?: unknown } | undefined
  let validateTargetCommand: { (document: unknown): boolean; errors?: unknown } | undefined
  for (const [schemaName, positiveName, negativeName] of targetContracts) {
    const targetSchema = JSON.parse(await readFile(resolve(schemaRoot, schemaName), 'utf8'))
    const validate = targetAjv.compile(targetSchema)
    const positivePassed = Boolean(validate(JSON.parse(await readFile(resolve(fixtureRoot, positiveName), 'utf8'))))
    const negativeRejected = !validate(JSON.parse(await readFile(resolve(fixtureRoot, negativeName), 'utf8')))
    assert.equal(positivePassed, true, `${schemaName} target positive fixture failed`)
    assert.equal(negativeRejected, true, `${schemaName} target negative fixture was accepted`)
    if (schemaName === 'v2-px-real-chrome-evidence-v2.schema.json') validateTargetChrome = validate
    if (schemaName === 'v2-px-intent-route-v3.schema.json') validateTargetIntent = validate
    if (schemaName === 'v2-px-operation-command-v2.schema.json') validateTargetCommand = validate
    targetResults.push({ schema: schemaName, positivePassed, negativeRejected })
  }

  const realOperation = await prisma.operation.findFirst({
    where: { NOT: { artifactRefsJson: '[]' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, artifactRefsJson: true },
  })
  assert.ok(realOperation, 'A real Operation with artifactRefsJson is required')
  const operationRefs = JSON.parse(realOperation.artifactRefsJson) as unknown
  assert.ok(Array.isArray(operationRefs) && typeof operationRefs[0] === 'string', 'Real Operation artifactRefsJson is invalid')
  const operationRawRef = operationRefs[0]
  const operationSourceRef = createSourceRef('op-artifact', realOperation.id, operationRawRef)
  assert.deepEqual(parseSourceRef(operationSourceRef), { kind: 'op-artifact', entityId: realOperation.id, rawRef: operationRawRef })

  const realReview = await prisma.dailyReviewRun.findFirst({ orderBy: { createdAt: 'desc' }, select: { id: true, reportJson: true } })
  assert.ok(realReview, 'A real DailyReviewRun is required')
  const reviewEvidenceRefs = [...new Set(collectEvidenceRefs(JSON.parse(realReview.reportJson)))]
  assert.ok(reviewEvidenceRefs.length > 0, 'A real DailyReviewRun evidenceRef is required')
  const reviewRawRef = reviewEvidenceRefs[0]!
  const reviewSourceRef = createSourceRef('review-evidence', realReview.id, reviewRawRef)
  assert.deepEqual(parseSourceRef(reviewSourceRef), { kind: 'review-evidence', entityId: realReview.id, rawRef: reviewRawRef })
  const invalidSourceRefs = [
    `unknown:${realOperation.id}:YQ`,
    `op-artifact:${realOperation.id}:YQ=`,
    `op-artifact:${realOperation.id}:YR`,
    `op-artifact:${realOperation.id.toUpperCase()}:YQ`,
    `op-artifact:${realOperation.id.replace('-4', '-1')}:YQ`,
    `op-artifact:${realOperation.id}:${Buffer.from('x'.repeat(513)).toString('base64url')}`,
  ]
  assert.ok(invalidSourceRefs.every((sourceRef) => parseSourceRef(sourceRef) === null), 'Malformed sourceRef was accepted')
  assert.throws(() => createSourceRef('op-artifact', realOperation.id, ''), /LENGTH_INVALID/)

  const intentFixture = JSON.parse(await readFile(resolve(fixtureRoot, 'intent-route-v3.positive.json'), 'utf8')) as Record<string, unknown>
  intentFixture.routePayload = { workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', sourceRef: operationSourceRef }
  assert.equal(Boolean(validateTargetIntent?.(intentFixture)), true, `Real Operation sourceRef rejected: ${JSON.stringify(validateTargetIntent?.errors)}`)
  const commandFixture = JSON.parse(await readFile(resolve(fixtureRoot, 'operation-command-v2.positive.json'), 'utf8')) as Record<string, unknown>
  commandFixture.payload = {
    workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001',
    question: '验证真实来源引用',
    contextRefs: [realOperation.id, realReview.id, operationSourceRef, reviewSourceRef],
  }
  assert.equal(Boolean(validateTargetCommand?.(commandFixture)), true, `Real contextRefs rejected: ${JSON.stringify(validateTargetCommand?.errors)}`)
  const realDataContractEvidence = {
    operationId: realOperation.id,
    reviewId: realReview.id,
    operationRawRef,
    reviewRawRef,
    operationSourceRef,
    reviewSourceRef,
  }

  const realChrome = await latestPx1Evidence()
  assert.ok(realChrome, 'PX1 real Chrome evidence is missing')
  assert.ok(validateTargetChrome, 'Target Chrome validator was not compiled')
  assert.equal(Boolean(validateTargetChrome(realChrome.evidence)), true, `PX1 Chrome evidence schema invalid: ${JSON.stringify(validateTargetChrome.errors)}`)
  const realChromeIssues = await verifyTargetChromeEvidence(realChrome.evidence)
  assert.deepEqual(realChromeIssues, [], `PX1 Chrome evidence semantic validation failed: ${JSON.stringify(realChromeIssues)}`)

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
    targetSchemaCount: targetContracts.length,
    targetContractResults: targetResults,
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
    realChromeAcceptanceClaimed: true,
    realChromeEvidencePath: realChrome.path,
    px1SpikePassed: v2State.px1TargetContractsImplemented === true,
    px2PlusProductionImplementationAllowed: v2State.px2PlusAllowed === true,
    contractReentryInProgress,
    promotionBlockedDuringReentry: contractReentryInProgress && v2State.px2PlusAllowed === false,
    realDataSourceRefRoundTripPassed: true,
    realDataSourceRefEvidenceSha256: createHash('sha256').update(stableJson(realDataContractEvidence)).digest('hex'),
    realDataSourceRefEvidence: realDataContractEvidence,
    fixtures: results,
  }, null, 2))
  await prisma.$disconnect()
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
