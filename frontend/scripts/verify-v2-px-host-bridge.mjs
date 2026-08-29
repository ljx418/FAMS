import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const frontendRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(frontendRoot, '..')
const backendRoot = resolve(repoRoot, 'backend')
const extensionRoot = resolve(repoRoot, 'packages/fams-v2-px-extension')
const outputDir = resolve(extensionRoot, '.output/chrome-mv3')
const databasePath = resolve(backendRoot, 'prisma/dev.db')
const requireFromExtension = createRequire(resolve(extensionRoot, 'package.json'))
const { chromium } = requireFromExtension('@playwright/test')
const workspaceId = 'px-ws-00000000-0000-4000-8000-000000000001'

assert.ok(existsSync(resolve(outputDir, 'manifest.json')), 'WXT build output is missing')
assert.ok(existsSync(databasePath), 'real FAMS SQLite database is missing')
const productionManifest = JSON.parse(readFileSync(resolve(outputDir, 'manifest.json'), 'utf8'))
assert.deepEqual(productionManifest.host_permissions ?? [], [], 'production extension must not pregrant backend origins')
assert.deepEqual((productionManifest.externally_connectable?.matches ?? []).sort(), ['http://127.0.0.1:3000/*', 'http://localhost:3000/*'].sort())

const bridgeSource = readFileSync(resolve(frontendRoot, 'src/services/pxExternalBrainBridge.ts'), 'utf8')
assert.match(bridgeSource, /VITE_FAMS_PX_EXTENSION_ID/, 'Host bridge must read the frozen extension ID setting')
assert.doesNotMatch(bridgeSource, /messageType:\s*['"]operation_command/, 'Host bridge must not construct operation commands')
assert.doesNotMatch(bridgeSource, /routePayload:[^\n]*question/, 'Host route payload must not contain question')

const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const inScopePaths = [
  'frontend/src/services/pxExternalBrainBridge.ts',
  'frontend/src/components/external-brain/OpenInExternalBrainButton.tsx',
  'frontend/src/components/chat/FamsChatBox.tsx',
  'frontend/src/pages/DailyReviews.tsx',
  'frontend/src/pages/Operations.tsx',
  'frontend/scripts/verify-v2-px-host-bridge.mjs',
  'packages/fams-v2-px-extension/tests/host-bridge.test.ts',
  'backend/scripts/start-v2-px-acceptance-server.ts',
]
const dirtyScope = execFileSync('git', ['status', '--short', '--', ...inScopePaths], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!process.env.V2_PX_ALLOW_DIRTY) assert.equal(dirtyScope, '', `PX4-B final evidence requires committed in-scope files:\n${dirtyScope}`)
const stageName = process.env.V2_PX_ALLOW_DIRTY ? 'PX4B-dev' : 'PX4B'
const evidenceDir = resolve(repoRoot, '.verification/private/v2-px', commitSha, stageName)
await mkdir(evidenceDir, { recursive: true })

const extensionLoadDir = resolve(evidenceDir, 'headless-pregranted-extension')
await cp(outputDir, extensionLoadDir, { recursive: true, force: true })
const acceptanceManifestPath = resolve(extensionLoadDir, 'manifest.json')
const acceptanceManifest = JSON.parse(await readFile(acceptanceManifestPath, 'utf8'))
acceptanceManifest.host_permissions = [...(acceptanceManifest.optional_host_permissions ?? [])]
acceptanceManifest.optional_host_permissions = []
await writeFile(acceptanceManifestPath, `${JSON.stringify(acceptanceManifest)}\n`)

const wait = (delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const sqlJson = (query) => JSON.parse(execFileSync('sqlite3', [databasePath, '-json', query], { encoding: 'utf8' }) || '[]')
const tableCount = (table) => Number(sqlJson(`SELECT COUNT(*) AS count FROM "${table}"`)[0]?.count ?? 0)
const mutableCounts = () => ({
  transactions: tableCount('Transaction'),
  gridOrderDrafts: tableCount('GridOrderDraft'),
  externalOrderObservations: tableCount('ExternalOrderObservation'),
})

async function waitForHttp(url, label, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      last = `${response.status} ${await response.text()}`
      if (response.ok) return
    } catch (error) {
      last = String(error)
    }
    await wait(250)
  }
  throw new Error(`${label} did not become ready: ${last.slice(-1000)}`)
}

async function portIsFree(port) {
  return new Promise((resolveFree) => {
    const server = createServer()
    server.once('error', () => resolveFree(false))
    server.listen(port, '0.0.0.0', () => server.close(() => resolveFree(true)))
  })
}

async function requireFreePort(port, label) {
  assert.equal(await portIsFree(port), true, `${label} requires exclusive port ${port}; stop the existing project process and retry`)
}

async function waitForFreePort(port, label) {
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return
    await wait(100)
  }
  throw new Error(`${label} did not release port ${port}`)
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return
  const exited = new Promise((resolveExit) => child.once('exit', resolveExit))
  child.kill('SIGTERM')
  await Promise.race([
    exited,
    wait(5_000),
  ])
  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await Promise.race([exited, wait(2_000)])
  }
  child.stdout?.destroy()
  child.stderr?.destroy()
}

async function startBackend(extensionId) {
  await requireFreePort(4000, 'PX4-B acceptance backend')
  const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/start-v2-px-acceptance-server.ts'], {
    cwd: backendRoot,
    env: { ...process.env, FAMS_V2_PX_EXTENSION_IDS: extensionId },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  child.once('exit', (code) => { if (code && code !== 0) process.stderr.write(output.slice(-3000)) })
  await Promise.race([
    waitForHttp('http://127.0.0.1:4000/health', 'PX4-B acceptance backend'),
    new Promise((_, reject) => child.once('exit', (code) => reject(new Error(`PX4-B acceptance backend exited ${code}: ${output.slice(-3000)}`)))),
  ])
  return { child, output: () => output }
}

async function startFrontend(extensionId) {
  await requireFreePort(3000, 'PX4-B Host frontend')
  const child = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '0.0.0.0', '--port', '3000', '--strictPort'], {
    cwd: frontendRoot,
    env: {
      ...process.env,
      VITE_V2_PX_COMMIT_SHA: commitSha,
      VITE_FAMS_PX_EXTENSION_ID: extensionId ?? '',
      VITE_API_PROXY_TARGET: 'http://127.0.0.1:4000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  child.stderr.on('data', (chunk) => { output += chunk.toString() })
  child.once('exit', (code) => { if (code && code !== 0) process.stderr.write(output.slice(-3000)) })
  await Promise.race([
    waitForHttp('http://127.0.0.1:3000/daily-reviews', extensionId ? 'configured FAMS frontend' : 'unconfigured FAMS frontend'),
    new Promise((_, reject) => child.once('exit', (code) => reject(new Error(`PX4-B Host frontend exited ${code}: ${output.slice(-3000)}`)))),
  ])
  return { child, output: () => output }
}

async function waitForFamsWorker(context) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().startsWith('chrome-extension://')) continue
      try {
        const manifest = await candidate.evaluate(() => chrome.runtime.getManifest())
        if (manifest?.name === 'FAMS External Brain') return candidate
      } catch { /* service worker may restart while inspected */ }
    }
    await Promise.race([context.waitForEvent('serviceworker', { timeout: 500 }).catch(() => undefined), wait(500)])
  }
  throw new Error('Chrome did not load the FAMS External Brain worker')
}

async function instrumentHostRuntime(page) {
  const installed = await page.evaluate(() => {
    const runtime = globalThis.chrome?.runtime
    if (!runtime?.sendMessage) return false
    const original = runtime.sendMessage.bind(runtime)
    globalThis.__famsPxCapturedMessages = []
    runtime.sendMessage = (...args) => {
      globalThis.__famsPxCapturedMessages.push(args[1])
      return original(...args)
    }
    return true
  })
  assert.equal(installed, true, 'Chrome did not expose externally-connectable messaging to the allowed Host origin')
}

async function capturedMessages(page) {
  return page.evaluate(() => globalThis.__famsPxCapturedMessages ?? [])
}

function assertSafeRoute(message, expectedIntent, expectedContextId) {
  assert.equal(message.schemaVersion, 'v2-px-runtime-message/1')
  assert.equal(message.messageType, 'intent_route')
  assert.equal(message.sourceContainer, 'host_app')
  assert.equal(message.targetContainer, 'workspace_page')
  assert.equal(message.payload.schemaVersion, 'v2-px-intent-route/3')
  assert.equal(message.payload.routeIntent, expectedIntent)
  assert.equal(message.routeId, message.payload.routeId)
  assert.equal(message.correlationId, message.payload.correlationId)
  assert.equal(message.idempotencyKey, message.payload.idempotencyKey)
  assert.deepEqual(Object.keys(message.payload.routePayload).sort(), expectedIntent === 'ask'
    ? ['workspaceId']
    : expectedIntent === 'graph'
      ? ['graphId', 'graphScope', 'workspaceId']
      : ['operationId', 'workspaceId'])
  assert.equal(message.payload.routePayload.workspaceId, workspaceId)
  if (expectedIntent === 'graph') assert.equal(message.payload.routePayload.graphId, expectedContextId)
  if (expectedIntent === 'trace') assert.equal(message.payload.routePayload.operationId, expectedContextId)
  assert.doesNotMatch(JSON.stringify(message), /question|answer|cookie|token|rawscreenshot|accountimage/i)
}

async function bridgeResult(page, entryId) {
  const entry = page.getByTestId(`external-brain-${entryId}-entry`)
  await entry.waitFor()
  await page.getByTestId(`external-brain-${entryId}-button`).click()
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline && await entry.getAttribute('data-bridge-status') !== 'accepted') await wait(25)
  assert.equal(await entry.getAttribute('data-bridge-status'), 'accepted')
  const result = await entry.evaluate((element) => ({
    status: element.getAttribute('data-bridge-status'),
    routeId: element.getAttribute('data-route-id'),
    correlationId: element.getAttribute('data-correlation-id'),
    contextId: element.getAttribute('data-context-id'),
    ackMs: Number(element.getAttribute('data-ack-ms')),
  }))
  assert.match(result.routeId, /^px-route-/)
  assert.match(result.correlationId, /^px-corr-/)
  assert.ok(result.ackMs >= 0 && result.ackMs <= 1_000, `Host ack ${result.ackMs}ms exceeded 1 second`)
  return result
}

async function waitForWorkspace(context, extensionId, view, contextId) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const page = context.pages().find((candidate) => candidate.url().startsWith(`chrome-extension://${extensionId}/workspace.html`))
    if (page) {
      try {
        const url = new URL(page.url())
        if (url.searchParams.get('view') === view && (!contextId || url.searchParams.get('ref') === contextId)) {
          await page.getByTestId(`view-${view}`).waitFor({ timeout: 20_000 })
          return page
        }
      } catch { /* tab may be navigating between Host routes */ }
    }
    await wait(200)
  }
  throw new Error(`Workspace did not reach ${view}/${contextId ?? ''}`)
}

async function workspaceTabs(worker) {
  return worker.evaluate(async () => chrome.tabs.query({ url: `${chrome.runtime.getURL('/workspace.html')}*` }))
}

async function capture(page, filename) {
  const layout = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }))
  assert.equal(Math.max(0, layout.scrollWidth - layout.clientWidth), 0, `${filename} has root horizontal overflow`)
  const path = resolve(evidenceDir, filename)
  const buffer = await page.screenshot({ path, fullPage: false, animations: 'disabled' })
  return { path: relative(repoRoot, path).replace(/\\/g, '/'), sha256: sha256(buffer) }
}

const chromeForTestingPath = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-win64/chrome.exe')
const chromePath = process.env.FAMS_WINDOWS_CHROME_PATH || (existsSync(chromeForTestingPath) ? chromeForTestingPath : '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe')
assert.ok(existsSync(chromePath), `Windows Chrome executable not found: ${chromePath}`)
const profilePath = await mkdtemp(resolve(evidenceDir, 'chrome-profile-'))
const windowsProfilePath = execFileSync('wslpath', ['-w', profilePath], { encoding: 'utf8' }).trim()
const windowsExtensionPath = execFileSync('wslpath', ['-w', extensionLoadDir], { encoding: 'utf8' }).trim()
const chromeProcess = spawn(chromePath, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  '--remote-debugging-port=0', `--user-data-dir=${windowsProfilePath}`,
  `--disable-extensions-except=${windowsExtensionPath}`, `--load-extension=${windowsExtensionPath}`, 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] })

let chromeDiagnostics = ''
const endpoint = await new Promise((resolveEndpoint, reject) => {
  const timer = setTimeout(() => reject(new Error(`Chrome CDP timeout: ${chromeDiagnostics.slice(-2000)}`)), 30_000)
  chromeProcess.stderr.on('data', (chunk) => {
    chromeDiagnostics += chunk.toString()
    const match = chromeDiagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (match) { clearTimeout(timer); resolveEndpoint(match[1]) }
  })
  chromeProcess.once('error', (error) => { clearTimeout(timer); reject(error) })
  chromeProcess.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}: ${chromeDiagnostics.slice(-2000)}`)) })
})

let browser
let backend
let frontend
let tracingActive = false
try {
  browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 })
  const context = browser.contexts()[0]
  assert.ok(context, 'Chrome default context is missing')
  const worker = await waitForFamsWorker(context)
  const extensionId = new URL(worker.url()).host
  assert.match(extensionId, /^[a-p]{32}$/)
  backend = await startBackend(extensionId)

  const realReviews = await fetch('http://127.0.0.1:4000/api/v1/daily-reviews?userId=default&limit=5').then((response) => response.json())
  const realOperations = await fetch('http://127.0.0.1:4000/api/v1/operations?userId=default&limit=5').then((response) => response.json())
  const reviewId = realReviews.items?.[0]?.id
  const operationId = realOperations?.[0]?.id
  assert.match(reviewId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'real DailyReview UUID v4 is required')
  assert.match(operationId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'real Operation UUID v4 is required')
  assert.equal(sqlJson(`SELECT id FROM "DailyReviewRun" WHERE id='${reviewId}'`)[0]?.id, reviewId)
  assert.equal(sqlJson(`SELECT id FROM "Operation" WHERE id='${operationId}'`)[0]?.id, operationId)

  const countsBefore = mutableCounts()
  const networkEntries = []
  const consoleEntries = []
  context.on('request', (request) => networkEntries.push({ phase: 'request', method: request.method(), url: request.url(), headers: request.headers(), at: new Date().toISOString() }))
  context.on('response', (response) => networkEntries.push({ phase: 'response', status: response.status(), url: response.url(), at: new Date().toISOString() }))
  context.on('page', (page) => {
    page.on('console', (entry) => { if (entry.type() === 'error') consoleEntries.push({ type: 'console', text: entry.text(), url: page.url() }) })
    page.on('pageerror', (error) => consoleEntries.push({ type: 'pageerror', text: error.message, url: page.url() }))
  })
  worker.on('console', (entry) => { if (entry.type() === 'error') consoleEntries.push({ type: 'worker', text: entry.text(), url: worker.url() }) })
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
  tracingActive = true

  frontend = await startFrontend(undefined)
  const missingPage = await context.newPage()
  await missingPage.setViewportSize({ width: 1280, height: 900 })
  await missingPage.goto(`http://localhost:3000/daily-reviews/${reviewId}`, { waitUntil: 'domcontentloaded' })
  await missingPage.getByTestId('daily-review-workbench').waitFor({ timeout: 30_000 })
  await missingPage.getByTestId('fams-chatbox-trigger').click()
  await missingPage.getByTestId('external-brain-chatbox-button').waitFor()
  await missingPage.getByTestId('external-brain-chatbox-button').click()
  const missingStatus = missingPage.getByTestId('external-brain-chatbox-status')
  await missingStatus.waitFor()
  const missingText = await missingStatus.innerText()
  assert.match(missingText, /VITE_FAMS_PX_EXTENSION_ID|配置|扩展 ID/)
  assert.doesNotMatch(missingText, /runtime\.lastError|Could not establish|Receiving end|chrome-extension:\/\//i)
  assert.equal((await workspaceTabs(worker)).length, 0, 'missing configuration must not open a Workspace tab')
  const screenshots = [await capture(missingPage, 'host-missing-configuration.png')]
  await missingPage.close()
  await stopChild(frontend.child)
  await waitForFreePort(3000, 'unconfigured FAMS frontend')
  frontend = undefined

  frontend = await startFrontend(extensionId)
  const host = await context.newPage()
  await host.setViewportSize({ width: 1440, height: 900 })
  await host.goto(`http://localhost:3000/daily-reviews/${reviewId}`, { waitUntil: 'domcontentloaded' })
  await host.getByTestId('daily-review-workbench').waitFor({ timeout: 30_000 })
  await instrumentHostRuntime(host)

  const secretMarker = `HOST-QUESTION-MUST-NOT-LEAVE-${Date.now()}`
  await host.getByTestId('fams-chatbox-trigger').click()
  await host.getByPlaceholder('例如：帮我对比永久组合和全天候组合最近三年').fill(secretMarker)
  const chatResult = await bridgeResult(host, 'chatbox')
  const chatMessage = (await capturedMessages(host))[0]
  assertSafeRoute(chatMessage, 'ask')
  assert.equal(JSON.stringify(chatMessage).includes(secretMarker), false, 'ChatBox text leaked into Host route')
  let workspace = await waitForWorkspace(context, extensionId, 'ask')
  assert.equal((await workspaceTabs(worker)).length, 1)
  screenshots.push(await capture(host, 'host-chatbox-accepted.png'))

  await host.goto(`http://localhost:3000/daily-reviews/${reviewId}`, { waitUntil: 'domcontentloaded' })
  await host.getByTestId('daily-review-workbench').waitFor({ timeout: 30_000 })
  await instrumentHostRuntime(host)
  const reviewContextId = await host.getByTestId('external-brain-daily-review-entry').getAttribute('data-context-id')
  assert.equal(reviewContextId, reviewId)
  const reviewResult = await bridgeResult(host, 'daily-review')
  const reviewMessage = (await capturedMessages(host))[0]
  assertSafeRoute(reviewMessage, 'graph', reviewId)
  workspace = await waitForWorkspace(context, extensionId, 'graph', reviewId)
  assert.equal((await workspaceTabs(worker)).length, 1)
  screenshots.push(await capture(host, 'host-daily-review-accepted.png'))

  await host.goto('http://localhost:3000/operations', { waitUntil: 'domcontentloaded' })
  await host.getByTestId('external-brain-operations-entry').waitFor({ timeout: 30_000 })
  const operationContextDeadline = Date.now() + 30_000
  while (Date.now() < operationContextDeadline && !/^[0-9a-f-]{36}$/.test(await host.getByTestId('external-brain-operations-entry').getAttribute('data-context-id') ?? '')) await wait(100)
  assert.match(await host.getByTestId('external-brain-operations-entry').getAttribute('data-context-id'), /^[0-9a-f-]{36}$/)
  await instrumentHostRuntime(host)
  const operationContextId = await host.getByTestId('external-brain-operations-entry').getAttribute('data-context-id')
  assert.equal(operationContextId, operationId)
  const operationResult = await bridgeResult(host, 'operations')
  const operationMessages = await capturedMessages(host)
  assertSafeRoute(operationMessages[0], 'trace', operationId)
  workspace = await waitForWorkspace(context, extensionId, 'trace', operationId)
  assert.equal((await workspaceTabs(worker)).length, 1)
  screenshots.push(await capture(host, 'host-operations-accepted.png'))

  const repeatedResult = await bridgeResult(host, 'operations')
  const repeatedMessages = await capturedMessages(host)
  assert.equal(repeatedMessages.length, 2)
  assertSafeRoute(repeatedMessages[1], 'trace', operationId)
  assert.notEqual(repeatedMessages[0].routeId, repeatedMessages[1].routeId)
  assert.notEqual(repeatedMessages[0].correlationId, repeatedMessages[1].correlationId)
  await waitForWorkspace(context, extensionId, 'trace', operationId)
  assert.equal((await workspaceTabs(worker)).length, 1, 'repeated Host route must reuse the canonical Workspace tab')

  const storage = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }))
  const state = storage.session.workspaceStates?.[workspaceId]
  const lifecycleEvents = storage.session.lifecycleEvents ?? []
  assert.equal(state.workspaceId, workspaceId)
  assert.equal(state.currentView, 'trace')
  assert.equal(state.activeOperationId, operationId)
  assert.equal(state.routeId, repeatedResult.routeId)
  assert.equal(state.correlationId, repeatedResult.correlationId)
  const hostRouteEvents = lifecycleEvents.filter((event) => event.eventType === 'route_intent' && [chatResult.routeId, reviewResult.routeId, operationResult.routeId, repeatedResult.routeId].includes(event.routeId))
  assert.equal(hostRouteEvents.length, 4, 'every Host action must have one traceable lifecycle route event')
  const storageText = JSON.stringify(storage)
  assert.equal(storageText.includes(secretMarker), false, 'Host question leaked into extension storage')
  assert.doesNotMatch(storageText, /authorization|rawscreenshot|accountimage/i)

  const countsAfter = mutableCounts()
  assert.deepEqual(countsAfter, countsBefore, 'Host bridge must not mutate transactions or order drafts')
  const mutationRequests = networkEntries.filter((entry) => entry.phase === 'request' && !['GET', 'OPTIONS'].includes(entry.method) && /^http:\/\/(localhost|127\.0\.0\.1):4000\//.test(entry.url))
  assert.deepEqual(mutationRequests, [], `Host navigation made backend mutations: ${JSON.stringify(mutationRequests)}`)
  const forbiddenRequests = networkEntries.filter((entry) => entry.phase === 'request' && /broker|order-create|\/orders(?:\?|$)|auto-trade/i.test(entry.url))
  assert.deepEqual(forbiddenRequests, [], `Host navigation made trading requests: ${JSON.stringify(forbiddenRequests)}`)
  const externalBrainRequests = networkEntries.filter((entry) => entry.phase === 'request' && entry.url.includes('/api/v1/external-brain/'))
  assert.ok(externalBrainRequests.length >= 2, 'graph and trace must load through the real External Brain API')
  assert.equal(externalBrainRequests.every((entry) => entry.headers['x-fams-extension-id'] === extensionId), true, 'External Brain caller header drift')
  if (consoleEntries.length > 0) {
    const failedResponses = networkEntries.filter((entry) => entry.phase === 'response' && entry.status >= 400)
    process.stderr.write(`${JSON.stringify({ consoleEntries, failedResponses, backendOutput: backend.output(), frontendOutput: frontend.output() }, null, 2)}\n`)
  }
  assert.deepEqual(consoleEntries, [], `unexpected browser errors: ${JSON.stringify(consoleEntries)}`)

  const tracePath = resolve(evidenceDir, 'host-bridge-trace.zip')
  await context.tracing.stop({ path: tracePath })
  tracingActive = false
  const report = {
    schemaVersion: 'fams.v2_px.host_bridge_chrome_evidence.v1',
    status: 'passed',
    realData: true,
    automationMode: 'headless_new_private_permission_pregrant',
    commitSha,
    chromeVersion: await browser.version(),
    extensionId,
    workspaceId,
    configurationFallback: { visible: true, rawRuntimeErrorCount: 0, workspaceTabCount: 0 },
    chat: { ...chatResult, routeIntent: 'ask', questionTransferred: false },
    dailyReview: { ...reviewResult, reviewId, routeIntent: 'graph', databaseMatched: true },
    operation: { ...operationResult, operationId, routeIntent: 'trace', databaseMatched: true },
    repeatedRoute: { routeId: repeatedResult.routeId, correlationId: repeatedResult.correlationId, workspaceTabCount: 1 },
    lifecycleRouteEventCount: hostRouteEvents.length,
    screenshots,
    storageContainsQuestionOrSecret: false,
    backendMutationRequestCount: 0,
    brokerOrderRequestCount: 0,
    databaseMutationCount: 0,
    consoleErrorCount: 0,
    executionBoundary: { researchOnly: true, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    trace: { path: relative(repoRoot, tracePath).replace(/\\/g, '/'), sha256: sha256(await readFile(tracePath)) },
  }
  await writeFile(resolve(evidenceDir, 'host-bridge-network.json'), `${JSON.stringify(networkEntries, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'host-bridge-console.json'), `${JSON.stringify(consoleEntries, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'host-bridge-storage-metadata.json'), `${JSON.stringify(storage, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'host-bridge-chrome-evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ evidenceDir, ...report }, null, 2))
} finally {
  if (tracingActive && browser?.contexts()[0]) await browser.contexts()[0].tracing.stop().catch(() => undefined)
  if (browser?.contexts()[0]) await Promise.all(browser.contexts()[0].pages().map((page) => page.close().catch(() => undefined)))
  await stopChild(frontend?.child)
  await stopChild(backend?.child)
  await browser?.close().catch(() => undefined)
  await stopChild(chromeProcess)
}
