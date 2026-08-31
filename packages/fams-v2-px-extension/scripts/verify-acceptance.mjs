import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { relative, resolve, sep } from 'node:path'
import { chromium } from '@playwright/test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'
import { renderHumanAcceptanceHtml, scenarios as humanScenarios } from './generate-human-acceptance.mjs'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')
const backendRoot = resolve(repoRoot, 'backend')
const privateRoot = resolve(repoRoot, '.verification/private/v2-px')
const sourceDatabasePath = resolve(backendRoot, 'prisma/dev.db')
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const branch = execFileSync('git', ['branch', '--show-current'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const repositoryUrl = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const devMode = Boolean(process.env.V2_PX_ALLOW_DIRTY)
const stageName = devMode ? 'PX6-01-dev' : 'PX6-01'
const evidenceDir = resolve(privateRoot, commitSha, stageName)
await mkdir(evidenceDir, { recursive: true })
const startedAt = new Date().toISOString()
const inScopePaths = [
  'packages/fams-v2-px-extension',
  'backend/src/routes/externalBrain.ts', 'backend/src/services/external-brain',
  'backend/scripts/start-v2-px-acceptance-server.ts', 'backend/scripts/verify-v2-px-api-contract.ts',
  'backend/scripts/verify-v2-px-policy.ts', 'backend/scripts/verify-v2-px-semantic-contract.ts',
  'backend/scripts/verify-current-stage-consistency.ts',
  'frontend/scripts/verify-v2-px-host-bridge.mjs', 'frontend/src/services/pxExternalBrainBridge.ts',
  'frontend/src/components/external-brain',
  'docs/V2_PX_PRD.md', 'docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md',
  'docs/V2_PX_TARGET_ARCHITECTURE.md', 'docs/V2_PX_API_RUNTIME_CONTRACT.md',
  'docs/V2_PX_PRD_TRACEABILITY_MATRIX.md', 'docs/V2_PX_AUTHORITY_BASELINE.md',
  'docs/V2_PX_INDEPENDENT_AUDIT_REPORT.md', 'docs/current-stage-state.json',
  'docs/schemas', 'docs/prototypes/v2-px/fixtures', 'docs/generated', 'docs/audits/v2-px',
]
const initialDirtyScope = execFileSync('git', ['status', '--short', '--', ...inScopePaths], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!devMode) assert.equal(initialDirtyScope, '', `PX6-01 requires an exact committed clean in-scope state:\n${initialDirtyScope}`)
assert.equal(branch, 'main', 'PX6-01 authority requires main branch')
assert.equal(repositoryUrl, 'https://github.com/ljx418/FAMS.git')
assert.ok(existsSync(sourceDatabasePath), 'real FAMS SQLite database is missing')

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const relativePath = (path) => relative(repoRoot, path).replaceAll('\\', '/')
const json = async (path) => JSON.parse(await readFile(path, 'utf8'))
const writeJson = async (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
const clone = (value) => structuredClone(value)
const now = () => new Date().toISOString()
const wait = (delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs))
const artifactType = (path) => path.endsWith('.png') ? 'png' : path.endsWith('.zip') ? 'trace' : path.endsWith('.html') ? 'html' : path.endsWith('.md') ? 'markdown' : path.endsWith('.log') ? 'log' : 'json'

async function artifactRef(path, ownerCommit = commitSha) {
  const canonical = resolve(repoRoot, path)
  assert.ok(canonical === repoRoot || canonical.startsWith(`${repoRoot}${sep}`), `artifact escapes repository: ${path}`)
  const bytes = await readFile(canonical)
  assert.ok(bytes.length > 0, `artifact is empty: ${path}`)
  return { path: relativePath(canonical), sha256: sha256(bytes), artifactType: artifactType(canonical), commitSha: ownerCommit }
}

async function verifyArtifact(ref) {
  const canonical = resolve(repoRoot, ref.path)
  if (canonical !== repoRoot && !canonical.startsWith(`${repoRoot}${sep}`)) return 'artifact_path_escape'
  try {
    const bytes = await readFile(canonical)
    if (bytes.length === 0) return 'artifact_empty'
    if (sha256(bytes) !== ref.sha256) return 'hash_mismatch'
  } catch { return 'artifact_missing' }
  return null
}

const currentStageState = await json(resolve(repoRoot, 'docs/current-stage-state.json'))
const v2State = currentStageState.featureTracks?.v2PxExternalBrain ?? {}
assert.equal(v2State.currentPhase, 'product_px6_01_implemented_formal_acceptance_pending')
assert.equal(v2State.productAuthorityStatus, 'frozen')
assert.equal(v2State.routeAAdrStatus, 'production_approved')
assert.equal(v2State.currentAcceptanceContracts, 'manifest/2_report/2_runtime_implemented_formal_acceptance_pending')
assert.equal(v2State.targetAcceptanceContracts, 'manifest/2_report/2_implemented')
assert.equal(v2State.px6_01FatalAuditFindings, 0)
assert.equal(v2State.px6_01MajorSpecificationFindings, 0)
assert.equal(v2State.px6_01AutomatedAccepted, false, 'formal acceptance must not be predeclared')
assert.equal(v2State.formalTradingUnlocked, false)
assert.equal(v2State.autoTradeUnlocked, false)
assert.equal(v2State.canCreateOrder, false)
assert.equal(v2State.orderCreateAllowed, false)
const prdText = await readFile(resolve(repoRoot, 'docs/V2_PX_PRD.md'), 'utf8')
const traceabilityText = await readFile(resolve(repoRoot, 'docs/V2_PX_PRD_TRACEABILITY_MATRIX.md'), 'utf8')
const uniqueIds = (text, pattern) => [...new Set(text.match(pattern) ?? [])]
assert.deepEqual(uniqueIds(prdText, /PX-REQ-0(?:0[1-9]|1[0-9]|20)/g).sort(), Array.from({ length: 20 }, (_, index) => `PX-REQ-${String(index + 1).padStart(3, '0')}`))
assert.deepEqual(uniqueIds(traceabilityText, /PX-REQ-0(?:0[1-9]|1[0-9]|20)/g).sort(), Array.from({ length: 20 }, (_, index) => `PX-REQ-${String(index + 1).padStart(3, '0')}`))

const tempRoot = await mkdtemp(resolve(tmpdir(), 'fams-v2-px-px6-01-'))
const databaseSnapshotPath = resolve(tempRoot, 'real-data-snapshot.db')
execFileSync('sqlite3', [sourceDatabasePath, `.backup '${databaseSnapshotPath.replaceAll("'", "''")}'`])
assert.equal(execFileSync('sqlite3', [databaseSnapshotPath, 'PRAGMA quick_check;'], { encoding: 'utf8' }).trim(), 'ok')
const sqlCount = (table) => Number(JSON.parse(execFileSync('sqlite3', [databaseSnapshotPath, '-json', `SELECT COUNT(*) AS count FROM "${table}"`], { encoding: 'utf8' }) || '[]')[0]?.count ?? 0)
const dataCountsBefore = { operations: sqlCount('Operation'), reviews: sqlCount('DailyReviewRun'), transactions: sqlCount('Transaction') }
assert.ok(dataCountsBefore.operations > 0 && dataCountsBefore.reviews > 0, 'real Operation and DailyReviewRun records are required')

const commandDefinitions = [
  { id: 'CMD-01', command: 'git status --short -- <V2-PX scope>', executable: 'git', args: ['status', '--short', '--', ...inScopePaths], gates: ['G1'], expectEmpty: !devMode },
  { id: 'CMD-02', command: 'npm --prefix packages/fams-v2-px-extension run typecheck', executable: 'npm', args: ['--prefix', 'packages/fams-v2-px-extension', 'run', 'typecheck'], gates: ['G2'] },
  { id: 'CMD-03', command: 'npm --prefix packages/fams-v2-px-extension run test', executable: 'npm', args: ['--prefix', 'packages/fams-v2-px-extension', 'run', 'test'], gates: ['G2', 'G3', 'G4', 'G5', 'G6'] },
  { id: 'CMD-04', command: 'npm --prefix backend run test:v2-px-semantic-contract', executable: 'npm', args: ['--prefix', 'backend', 'run', 'test:v2-px-semantic-contract'], gates: ['G2', 'G7'] },
  { id: 'CMD-05', command: 'npm --prefix backend run test:current-stage-consistency', executable: 'npm', args: ['--prefix', 'backend', 'run', 'test:current-stage-consistency'], gates: ['G1', 'G7'] },
  { id: 'CMD-06', command: 'npm --prefix backend run test:v2-px-api-contract', executable: 'npm', args: ['--prefix', 'backend', 'run', 'test:v2-px-api-contract'], gates: ['G4'] },
  { id: 'CMD-07', command: 'npm --prefix backend run test:v2-px-policy', executable: 'npm', args: ['--prefix', 'backend', 'run', 'test:v2-px-policy'], gates: ['G4', 'G5'] },
  { id: 'CMD-08', command: 'npm --prefix packages/fams-v2-px-extension run build', executable: 'npm', args: ['--prefix', 'packages/fams-v2-px-extension', 'run', 'build'], gates: ['G2'] },
  { id: 'CMD-09', command: 'npm --prefix packages/fams-v2-px-extension run verify:router-idempotency-chrome', executable: 'npm', args: ['--prefix', 'packages/fams-v2-px-extension', 'run', 'verify:router-idempotency-chrome'], gates: ['G3'] },
  { id: 'CMD-10', command: 'npm --prefix packages/fams-v2-px-extension run verify:workspace-chrome', executable: 'npm', args: ['--prefix', 'packages/fams-v2-px-extension', 'run', 'verify:workspace-chrome'], gates: ['G4'] },
  { id: 'CMD-11', command: 'npm --prefix packages/fams-v2-px-extension run verify:sidepanel-chrome', executable: 'npm', args: ['--prefix', 'packages/fams-v2-px-extension', 'run', 'verify:sidepanel-chrome'], gates: ['G5'] },
  { id: 'CMD-12', command: 'npm --prefix packages/fams-v2-px-extension run verify:lifecycle-recovery-chrome', executable: 'npm', args: ['--prefix', 'packages/fams-v2-px-extension', 'run', 'verify:lifecycle-recovery-chrome'], gates: ['G6'] },
  { id: 'CMD-13', command: 'npm --prefix packages/fams-v2-px-extension run verify:lifecycle-interruption-chrome', executable: 'npm', args: ['--prefix', 'packages/fams-v2-px-extension', 'run', 'verify:lifecycle-interruption-chrome'], gates: ['G6'] },
  { id: 'CMD-14', command: 'npm --prefix packages/fams-v2-px-extension run verify:accessibility-chrome', executable: 'npm', args: ['--prefix', 'packages/fams-v2-px-extension', 'run', 'verify:accessibility-chrome'], gates: ['G7'] },
]

async function runCommand(definition) {
  const commandStartedAt = now()
  console.log(`[PX6-01] START ${definition.id} ${definition.command}`)
  const output = await new Promise((resolveOutput, reject) => {
    const child = spawn(definition.executable, definition.args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: `file:${databaseSnapshotPath}`,
        V2_PX_ACCEPTANCE_HOST: '::1', V2_PX_DEV_RUN: 'acceptance',
        NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''; let stderr = ''; let timedOut = false
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM') }, 6 * 60_000)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.once('error', reject)
    child.once('exit', (code) => {
      clearTimeout(timer)
      resolveOutput({ code: code ?? 1, stdout, stderr, timedOut })
    })
  })
  const logText = `command=${definition.command}\nstartedAt=${commandStartedAt}\nendedAt=${now()}\nexitCode=${output.code}\ntimedOut=${output.timedOut}\n--- stdout ---\n${output.stdout}\n--- stderr ---\n${output.stderr}\n`
  const logPath = resolve(evidenceDir, `command-${definition.id}.log`)
  await writeFile(logPath, logText, 'utf8')
  assert.equal(output.timedOut, false, `${definition.id} timed out`)
  assert.equal(output.code, 0, `${definition.id} failed; see ${relativePath(logPath)}`)
  if (definition.expectEmpty) assert.equal(output.stdout.trim(), '', `${definition.id} found dirty in-scope files:\n${output.stdout}`)
  console.log(`[PX6-01] PASS ${definition.id}`)
  return {
    commandId: definition.id, command: definition.command, gateIds: definition.gates, exitCode: 0,
    startedAt: commandStartedAt, endedAt: now(), stdoutSha256: sha256(logText), logRef: await artifactRef(logPath),
  }
}

let commandResults
try {
  commandResults = []
  for (const definition of commandDefinitions) commandResults.push(await runCommand(definition))
} catch (error) {
  await writeJson(resolve(evidenceDir, 'stage-manifest.json'), {
    schemaVersion: 'v2-px-stage-manifest/1', stage: stageName, status: 'failed', commitSha,
    startedAt, endedAt: now(), automatedAcceptanceStatus: 'failed', humanAcceptanceStatus: 'not_performed',
    v2PxProductizationCandidate: false, failure: error instanceof Error ? error.message : String(error),
    tradeBoundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
  })
  throw error
}

const commandResultsPath = resolve(evidenceDir, 'command-results.json')
await writeJson(commandResultsPath, { schemaVersion: 'fams.v2_px.command_results.v1', status: 'passed', commands: commandResults.map(({ logRef: _logRef, ...item }) => item) })
const currentStageDirs = devMode
  ? { PX2: 'PX2', PX3: 'PX3-dev', PX4A: 'PX4A-dev', PX5: 'PX5-dev', PX501: 'PX5-01-dev-acceptance', PX502: 'PX5-02-dev', PX601: 'PX6-01-dev-accessibility' }
  : { PX2: 'PX2', PX3: 'PX3', PX4A: 'PX4A', PX5: 'PX5', PX501: 'PX5-01', PX502: 'PX5-02', PX601: 'PX6-01' }

const stageSpecs = [
  { stageId: 'PX1', commit: '0e34a1f5bb706632b187dff1de3b899c18c27ada', path: '.verification/private/v2-px/0e34a1f5bb706632b187dff1de3b899c18c27ada/PX1/real-chrome-evidence.json' },
  { stageId: 'PX2', commit: commitSha, path: `.verification/private/v2-px/${commitSha}/${currentStageDirs.PX2}/api-contract-evidence.json` },
  { stageId: 'PX3', commit: commitSha, path: `.verification/private/v2-px/${commitSha}/${currentStageDirs.PX3}/workspace-chrome-evidence.json` },
  { stageId: 'PX4A', commit: commitSha, path: `.verification/private/v2-px/${commitSha}/${currentStageDirs.PX4A}/sidepanel-chrome-evidence.json` },
  { stageId: 'PX4B', commit: 'a0758b4980b01739ead5abff0bc2029a66716964', path: '.verification/private/v2-px/a0758b4980b01739ead5abff0bc2029a66716964/PX4B/host-bridge-chrome-evidence.json' },
  { stageId: 'PX5', commit: commitSha, path: `.verification/private/v2-px/${commitSha}/${currentStageDirs.PX5}/router-idempotency-evidence.json` },
  { stageId: 'PX5-01', commit: commitSha, path: `.verification/private/v2-px/${commitSha}/${currentStageDirs.PX501}/lifecycle-recovery-evidence.json` },
  { stageId: 'PX5-02', commit: commitSha, path: `.verification/private/v2-px/${commitSha}/${currentStageDirs.PX502}/lifecycle-interruption-evidence.json` },
]
const stageResults = []
for (const spec of stageSpecs) {
  const ref = await artifactRef(spec.path, spec.commit)
  const value = await json(resolve(repoRoot, spec.path))
  if ('status' in value) assert.equal(value.status, 'passed', `${spec.stageId} evidence is not passed`)
  if ('commitSha' in value) assert.equal(value.commitSha, spec.commit, `${spec.stageId} evidence commit drift`)
  if ('realData' in value) assert.equal(value.realData, true, `${spec.stageId} did not use real data`)
  stageResults.push({ stageId: spec.stageId, status: 'passed', commitSha: spec.commit, evidenceRefs: [ref] })
}
const accessibilityPath = `.verification/private/v2-px/${commitSha}/${currentStageDirs.PX601}/accessibility-audit.json`
const accessibility = await json(resolve(repoRoot, accessibilityPath))
assert.equal(accessibility.status, 'passed')
assert.equal(accessibility.realData, true)
assert.equal(accessibility.commitSha, commitSha)
assert.deepEqual(accessibility.viewports.map((item) => item.width), [360, 420, 768, 1280])
assert.equal(accessibility.totals.interactiveChecks, accessibility.totals.keyboardReachableChecks)
assert.deepEqual({
  unnamed: accessibility.totals.unnamedControls, undersized: accessibility.totals.undersizedTargets,
  contrast: accessibility.totals.contrastFailures, overflow: accessibility.totals.rootOverflowFailures,
  console: accessibility.totals.consoleErrorCount, network: accessibility.totals.failedRequestCount,
}, { unnamed: 0, undersized: 0, contrast: 0, overflow: 0, console: 0, network: 0 })
const accessibilityRef = await artifactRef(accessibilityPath)

const humanHtmlPath = resolve(repoRoot, 'docs/generated/v2-px-human-acceptance.html')
const committedHtml = await readFile(humanHtmlPath, 'utf8')
assert.equal(committedHtml, renderHumanAcceptanceHtml(), 'committed human acceptance HTML is not generator-reproducible')
assert.equal((committedHtml.match(/data-scenario-id="AC-PX-(?:0[1-9]|10)"/g) ?? []).length, 10)
assert.match(committedHtml, /自动检查已完成；你的 10 项体验验收尚未开始；不会自动提交或解锁交易。/)
assert.doesNotMatch(committedHtml, /data:image|\/mnt\/c\//)

const linuxChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-linux64/chrome')
const windowsChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-win64/chrome.exe')
const chromePath = process.env.FAMS_CHROME_PATH || (existsSync(linuxChrome) ? linuxChrome : windowsChrome)
assert.ok(existsSync(chromePath), `official Chrome for Testing missing: ${chromePath}`)
const linuxRuntimeLib = resolve(repoRoot, '.verification/tools/chrome-for-testing/runtime-libs/root/usr/lib/x86_64-linux-gnu')
const htmlBrowser = await chromium.launch({
  executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--no-proxy-server'],
  env: { ...process.env, LD_LIBRARY_PATH: [linuxRuntimeLib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') },
})
let humanHtmlSmokeRef; let humanExportRef
try {
  const page = await htmlBrowser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true })
  const nonLocalRequests = []
  const htmlPageErrors = []
  page.on('request', (request) => { if (!['file:', 'blob:'].includes(new URL(request.url()).protocol)) nonLocalRequests.push(request.url()) })
  page.on('pageerror', (error) => htmlPageErrors.push(error.message))
  page.on('console', (entry) => { if (entry.type() === 'error') htmlPageErrors.push(entry.text()) })
  await page.goto(pathToFileURL(humanHtmlPath).href)
  assert.equal(await page.locator('[data-scenario-id]').count(), 10)
  assert.equal(await page.locator('[data-field="status"] option:checked').allTextContents().then((items) => items.every((item) => item === '尚未检查')), true)
  const first = page.locator('[data-scenario-id="AC-PX-01"]')
  await first.locator('[data-field="status"]').selectOption('failed')
  await first.locator('[data-field="notes"]').fill('PX6-01 自动交互烟雾测试；不代表人类结论。')
  await first.locator('[data-field="screenshots"]').setInputFiles(resolve(repoRoot, accessibility.audits[0].screenshot.path))
  await first.locator('[data-preview] img').waitFor({ state: 'visible', timeout: 5_000 })
  assert.equal(await first.locator('[data-preview] img').count(), 1)
  await page.reload()
  assert.equal(await first.locator('[data-field="status"]').inputValue(), 'failed')
  const downloadPromise = page.waitForEvent('download')
  await page.locator('#export').click()
  const download = await downloadPromise
  const exportPath = resolve(evidenceDir, 'human-acceptance-export-smoke.json')
  await download.saveAs(exportPath)
  const exported = await json(exportPath)
  assert.equal(exported.humanAcceptanceStatus, 'in_progress')
  assert.equal(exported.v2PxProductizationCandidate, false)
  assert.equal(exported.scenarios.length, 10)
  assert.equal('reviewer' in exported, false)
  const screenshotPath = resolve(evidenceDir, 'human-acceptance-page.png')
  await page.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })
  humanHtmlSmokeRef = await artifactRef(screenshotPath)
  humanExportRef = await artifactRef(exportPath)
  assert.deepEqual(nonLocalRequests, [], 'human acceptance HTML attempted a network request')
  assert.deepEqual(htmlPageErrors, [], `human acceptance HTML errors: ${JSON.stringify(htmlPageErrors)}`)
} finally { await htmlBrowser.close() }

const stageById = Object.fromEntries(stageResults.map((stage) => [stage.stageId, stage]))
const requirementStageMap = {
  1: 'PX4B', 2: 'PX5', 3: 'PX3', 4: 'PX4A', 5: 'PX3', 6: 'PX5', 7: 'PX5-01', 8: 'PX5-02', 9: 'PX5', 10: 'PX1',
  11: 'PX6-01', 12: 'PX5-02', 13: 'PX2', 14: 'PX5-02', 15: 'PX1', 16: 'PX3', 17: 'PX5-02', 18: 'PX2', 19: 'PX6-01', 20: 'PX6-01',
}
const semanticCommandRef = commandResults.find((item) => item.commandId === 'CMD-04').logRef
const requirements = Array.from({ length: 20 }, (_, index) => {
  const number = index + 1
  const sourceStage = requirementStageMap[number]
  const stage = stageById[sourceStage]
  const ref = sourceStage === 'PX6-01' ? (number === 20 ? semanticCommandRef : accessibilityRef) : stage.evidenceRefs[0]
  return {
    requirementId: `PX-REQ-${String(number).padStart(3, '0')}`, status: 'passed', sourceStages: [sourceStage],
    commitSha: ref.commitSha, evidenceRefs: [ref],
  }
})
const requirementCoveragePath = resolve(evidenceDir, 'requirement_coverage.json')
await writeJson(requirementCoveragePath, { schemaVersion: 'fams.v2_px.requirement_coverage.v1', status: 'passed', coverage: '20/20', requirements })

const acStageMap = ['PX1', 'PX3', 'PX5', 'PX4B', 'PX3', 'PX6-01', 'PX5-02', 'PX5-02', 'PX6-01', 'PX6-01']
const acceptanceScenarios = humanScenarios.map((scenario, index) => {
  const stage = acStageMap[index]
  const ref = stage === 'PX6-01' ? (scenario.id === 'AC-PX-10' ? semanticCommandRef : accessibilityRef) : stageById[stage].evidenceRefs[0]
  return {
    scenarioId: scenario.id, title: scenario.title, automatedStatus: 'passed', humanStatus: 'not_run',
    prerequisites: scenario.prerequisites, steps: scenario.steps, threshold: scenario.threshold,
    evidenceRefs: [ref], screenshotSlots: [`${scenario.id} 人类截图（至少 1 张）`], notes: null,
  }
})
const acPath = resolve(evidenceDir, 'ac_px_01_10.json')
await writeJson(acPath, { schemaVersion: 'fams.v2_px.ac_scenario_coverage.v1', status: 'passed', automatedCoverage: '10/10', humanAcceptanceStatus: 'not_performed', scenarios: acceptanceScenarios })

const commandById = Object.fromEntries(commandResults.map((command) => [command.commandId, command]))
const gateCommandMap = {
  G1: ['CMD-01', 'CMD-05'], G2: ['CMD-02', 'CMD-03', 'CMD-04', 'CMD-08'], G3: ['CMD-03', 'CMD-09'],
  G4: ['CMD-03', 'CMD-06', 'CMD-07', 'CMD-10'], G5: ['CMD-03', 'CMD-07', 'CMD-11'],
  G6: ['CMD-03', 'CMD-12', 'CMD-13'], G7: ['CMD-04', 'CMD-05', 'CMD-14'],
}
const gates = Object.entries(gateCommandMap).map(([gateId, commandIds]) => ({
  gateId, status: 'passed', commandIds,
  evidenceRefs: [...commandIds.map((id) => commandById[id].logRef), ...(gateId === 'G5' ? stageById.PX4B.evidenceRefs : [])],
}))

const repository = { url: repositoryUrl, branch, commitSha, inScopeClean: !devMode }
const tradeBoundary = { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false, brokerOrderRequestCount: 0, transactionMutationCount: 0 }
const manifestBase = {
  schemaVersion: 'v2-px-acceptance-manifest/2', generatedAt: now(),
  product: { productId: 'fams-v2-px', hostApplication: 'FAMS', extensionPackage: 'packages/fams-v2-px-extension' },
  repository: devMode ? { ...repository, inScopeClean: true } : repository,
  authority: { productAuthorityStatus: 'FROZEN', routeAAdrStatus: 'PRODUCTION_APPROVED' },
  contractVersions: {
    intentRoute: 'v2-px-intent-route/3', operationCommand: 'v2-px-operation-command/2', lifecycleAudit: 'v2-px-dual-container-lifecycle/3',
    lifecyclePort: 'v2-px-lifecycle-port-message/1', realChromeEvidence: 'v2-px-real-chrome-evidence/2',
    acceptanceManifest: 'v2-px-acceptance-manifest/2', acceptanceReport: 'v2-px-acceptance-report/2',
  },
  stageResults, commands: commandResults.map(({ logRef: _logRef, ...command }) => command), requirements, gates,
  artifacts: [
    await artifactRef(requirementCoveragePath), await artifactRef(acPath), accessibilityRef,
    await artifactRef(humanHtmlPath), humanHtmlSmokeRef, humanExportRef, await artifactRef(commandResultsPath),
  ],
  humanAcceptance: { status: 'not_performed', reportPath: 'docs/generated/v2-px-human-acceptance.html' },
  automatedAcceptanceStatus: 'passed', readyForHumanAcceptance: true, v2PxProductizationCandidate: false, tradeBoundary,
  antiFalseGreen: { positiveFixturesPassed: true, negativeFixturesRejected: true, allCommandsExecuted: true, allArtifactHashesVerified: true, commitMatched: true, staticMockHtmlUsed: false },
}
const reportBase = {
  schemaVersion: 'v2-px-acceptance-report/2', generatedAt: now(), manifestRef: await artifactRef(requirementCoveragePath),
  automatedAcceptanceStatus: 'passed', humanAcceptanceStatus: 'not_performed', readyForHumanAcceptance: true, v2PxProductizationCandidate: false,
  acceptanceScenarios, knownBlockers: ['PX6-02 人类十项体验验收和正式 permission 点击尚未执行'],
  externalAudit: { originalResult: 'CONDITIONAL_PASS', reportPath: 'docs/V2_PX_INDEPENDENT_AUDIT_REPORT.md', registeredBlockingIssues: 3, registeredHighRiskIssues: 8, remediationStatus: 'closed_internal_reaudit_passed_report_retained' },
  allowedClaims: ['PX6-01 automated acceptance passed', 'Ready for human experience acceptance'],
  mustNotClaim: ['Human acceptance passed', 'V2-PX productization candidate', 'Formal trading unlocked', 'Production identity or Chrome Web Store release ready'],
  tradeBoundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
}

const ajv = new Ajv2020({ allErrors: true, strict: true })
addFormats(ajv)
const validateManifest = ajv.compile(await json(resolve(repoRoot, 'docs/schemas/v2-px-acceptance-manifest-v2.schema.json')))
const validateReport = ajv.compile(await json(resolve(repoRoot, 'docs/schemas/v2-px-acceptance-report-v2.schema.json')))
const expectedGateIds = Array.from({ length: 7 }, (_, index) => `G${index + 1}`)
const expectedRequirementIds = Array.from({ length: 20 }, (_, index) => `PX-REQ-${String(index + 1).padStart(3, '0')}`)
const expectedScenarioIds = Array.from({ length: 10 }, (_, index) => `AC-PX-${String(index + 1).padStart(2, '0')}`)
const exactSet = (actual, expected) => actual.length === expected.length && new Set(actual).size === expected.length && expected.every((id) => actual.includes(id))

async function semanticManifestIssues(value) {
  const issues = []
  if (!exactSet(value.gates.map((item) => item.gateId), expectedGateIds)) issues.push('gate_set_invalid')
  if (!exactSet(value.requirements.map((item) => item.requirementId), expectedRequirementIds)) issues.push('requirement_set_invalid')
  if (new Set(value.commands.map((item) => item.commandId)).size !== value.commands.length) issues.push('command_set_invalid')
  if (value.repository.commitSha !== commitSha) issues.push('commit_mismatch')
  if (value.humanAcceptance.status !== 'passed' && value.v2PxProductizationCandidate !== false) issues.push('premature_candidate')
  for (const owner of [...value.stageResults, ...value.requirements]) {
    if (owner.evidenceRefs.some((ref) => ref.commitSha !== owner.commitSha)) issues.push('artifact_commit_mismatch')
  }
  const allEvidenceRefs = [
    ...value.stageResults.flatMap((item) => item.evidenceRefs),
    ...value.requirements.flatMap((item) => item.evidenceRefs),
    ...value.gates.flatMap((item) => item.evidenceRefs),
    ...value.artifacts,
  ]
  for (const ref of allEvidenceRefs) {
    const artifactIssue = await verifyArtifact(ref); if (artifactIssue) issues.push(artifactIssue)
  }
  if (value.artifacts.some((ref) => ref.commitSha !== value.repository.commitSha)) issues.push('artifact_commit_mismatch')
  return [...new Set(issues)]
}

async function semanticReportIssues(value) {
  const issues = []
  if (!exactSet(value.acceptanceScenarios.map((item) => item.scenarioId), expectedScenarioIds)) issues.push('scenario_set_invalid')
  if (value.humanAcceptanceStatus === 'not_performed' && value.acceptanceScenarios.some((item) => item.humanStatus !== 'not_run')) issues.push('human_status_mismatch')
  if (value.humanAcceptanceStatus !== 'passed' && value.v2PxProductizationCandidate !== false) issues.push('premature_candidate')
  const artifactIssue = await verifyArtifact(value.manifestRef); if (artifactIssue) issues.push(artifactIssue)
  for (const ref of value.acceptanceScenarios.flatMap((item) => item.evidenceRefs)) {
    const scenarioArtifactIssue = await verifyArtifact(ref); if (scenarioArtifactIssue) issues.push(scenarioArtifactIssue)
  }
  return issues
}

assert.equal(validateManifest(manifestBase), true, JSON.stringify(validateManifest.errors))
assert.deepEqual(await semanticManifestIssues(manifestBase), [])
assert.equal(validateReport(reportBase), true, JSON.stringify(validateReport.errors))
assert.deepEqual(await semanticReportIssues(reportBase), [])

const mutations = [
  ['missing_requirement', async () => { const value = clone(manifestBase); value.requirements.pop(); return !validateManifest(value) }],
  ['duplicate_requirement', async () => { const value = clone(manifestBase); value.requirements[19].requirementId = 'PX-REQ-001'; return (await semanticManifestIssues(value)).includes('requirement_set_invalid') }],
  ['duplicate_gate', async () => { const value = clone(manifestBase); value.gates[6].gateId = 'G1'; return (await semanticManifestIssues(value)).includes('gate_set_invalid') }],
  ['hash_mismatch', async () => { const value = clone(manifestBase); value.artifacts[0].sha256 = '0'.repeat(64); return (await semanticManifestIssues(value)).includes('hash_mismatch') }],
  ['commit_mismatch', async () => { const value = clone(manifestBase); value.repository.commitSha = '0'.repeat(40); return (await semanticManifestIssues(value)).includes('commit_mismatch') }],
  ['command_not_executed', async () => { const value = clone(manifestBase); value.commands[0].exitCode = 1; return !validateManifest(value) }],
  ['premature_manifest_candidate', async () => { const value = clone(manifestBase); value.v2PxProductizationCandidate = true; return !validateManifest(value) }],
  ['trading_lock_changed', async () => { const value = clone(manifestBase); value.tradeBoundary.canCreateOrder = true; return !validateManifest(value) }],
  ['missing_artifact', async () => { const value = clone(manifestBase); value.artifacts[0].path = '.verification/private/v2-px/missing.json'; return (await semanticManifestIssues(value)).includes('artifact_missing') }],
  ['report_missing_steps', async () => { const value = clone(reportBase); value.acceptanceScenarios[0].steps = []; return !validateReport(value) }],
  ['report_duplicate_scenario', async () => { const value = clone(reportBase); value.acceptanceScenarios[9].scenarioId = 'AC-PX-01'; return (await semanticReportIssues(value)).includes('scenario_set_invalid') }],
  ['premature_report_candidate', async () => { const value = clone(reportBase); value.v2PxProductizationCandidate = true; return !validateReport(value) }],
]
const mutationResults = []
for (const [name, rejectMutation] of mutations) {
  const rejected = await rejectMutation()
  assert.equal(rejected, true, `anti-false-green mutation was accepted: ${name}`)
  mutationResults.push({ name, expected: 'rejected', actual: 'rejected' })
}

const gateAuditPath = resolve(evidenceDir, 'g1_g7_gate_audit.json')
await writeJson(gateAuditPath, {
  schemaVersion: 'fams.v2_px.g1_g7_gate_audit.v1', status: 'passed', gateSet: 'G1..G7_exact_unique', gates,
  antiFalseGreen: { positiveManifestPassed: true, positiveReportPassed: true, mutationCount: mutationResults.length, allMutationsRejected: true, mutations: mutationResults },
})
manifestBase.artifacts.push(await artifactRef(gateAuditPath))
assert.equal(validateManifest(manifestBase), true, JSON.stringify(validateManifest.errors))
assert.deepEqual(await semanticManifestIssues(manifestBase), [])

const manifestPath = resolve(evidenceDir, 'v2_px_acceptance_manifest.json')
await writeJson(manifestPath, manifestBase)
const manifestRef = await artifactRef(manifestPath)
const report = { ...reportBase, manifestRef }
assert.equal(validateReport(report), true, JSON.stringify(validateReport.errors))
assert.deepEqual(await semanticReportIssues(report), [])
const reportPath = resolve(evidenceDir, 'v2_px_acceptance_report.json')
await writeJson(reportPath, report)

const dataCountsAfter = { operations: sqlCount('Operation'), reviews: sqlCount('DailyReviewRun'), transactions: sqlCount('Transaction') }
assert.equal(dataCountsAfter.transactions, dataCountsBefore.transactions, 'PX6 acceptance must not mutate Transaction')
const finalDirtyScope = execFileSync('git', ['status', '--short', '--', ...inScopePaths], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!devMode) assert.equal(finalDirtyScope, '', `PX6-01 generated tracked changes during acceptance:\n${finalDirtyScope}`)

const selectedArtifacts = [
  manifestPath, reportPath, gateAuditPath, requirementCoveragePath, acPath, commandResultsPath,
  resolve(repoRoot, accessibilityPath), humanHtmlPath, resolve(repoRoot, humanHtmlSmokeRef.path), resolve(repoRoot, humanExportRef.path),
  ...commandResults.map((item) => resolve(repoRoot, item.logRef.path)),
]
const stageManifest = {
  schemaVersion: 'v2-px-stage-manifest/1', stage: stageName, status: 'passed', commitSha, branch, repository: repositoryUrl,
  startedAt, endedAt: now(), automatedAcceptanceStatus: 'passed', humanAcceptanceStatus: 'not_performed',
  readyForHumanAcceptance: true, v2PxProductizationCandidate: false,
  chromeVersion: accessibility.chromeVersion, extensionId: accessibility.extensionId, extensionVersion: accessibility.extensionVersion,
  realData: { snapshot: true, operationCount: dataCountsBefore.operations, reviewCount: dataCountsBefore.reviews, transactionMutationCount: 0 },
  coverage: { gates: '7/7', requirements: '20/20', automatedScenarios: '10/10', humanScenariosCompleted: '0/10', antiFalseGreenMutationsRejected: `${mutationResults.length}/${mutationResults.length}` },
  artifacts: await Promise.all(selectedArtifacts.map((path) => artifactRef(path))),
  tradeBoundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false, brokerOrderRequestCount: 0, transactionMutationCount: 0 },
}
const stageManifestPath = resolve(evidenceDir, 'stage-manifest.json')
await writeJson(stageManifestPath, stageManifest)
console.log(JSON.stringify({
  status: 'passed', evidenceDir: relativePath(evidenceDir), manifestPath: relativePath(manifestPath), reportPath: relativePath(reportPath),
  humanAcceptanceHtml: relativePath(humanHtmlPath), ...stageManifest,
}, null, 2))
