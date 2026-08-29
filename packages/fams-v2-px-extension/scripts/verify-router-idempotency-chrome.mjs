import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { connect } from 'node:net'
import { relative, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')
const backendRoot = resolve(repoRoot, 'backend')
const outputDir = resolve(packageRoot, '.output/chrome-mv3')
const databasePath = resolve(backendRoot, 'prisma/dev.db')
const workspaceId = 'px-ws-00000000-0000-4000-8000-000000000001'
const controlWorkspaceId = 'px-ws-00000000-0000-4000-8000-000000000002'
assert.ok(existsSync(resolve(outputDir, 'manifest.json')), 'WXT production build is missing')
assert.ok(existsSync(databasePath), 'real FAMS SQLite database is missing')

const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const dirtyScope = execFileSync('git', ['status', '--short', '--',
  'packages/fams-v2-px-extension',
  'backend/src/routes/externalBrain.ts',
  'backend/src/services/external-brain',
  'backend/scripts/start-v2-px-acceptance-server.ts',
], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!process.env.V2_PX_ALLOW_DIRTY) assert.equal(dirtyScope, '', `PX5 evidence requires committed in-scope files:\n${dirtyScope}`)
const stageName = process.env.V2_PX_ALLOW_DIRTY ? 'PX5-dev' : 'PX5'
const evidenceDir = resolve(repoRoot, '.verification/private/v2-px', commitSha, stageName)
await mkdir(evidenceDir, { recursive: true })

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const wait = (delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs))
const sqlJson = (query) => JSON.parse(execFileSync('sqlite3', [databasePath, '-json', query], { encoding: 'utf8' }) || '[]')
const countTable = (table) => Number(sqlJson(`SELECT COUNT(*) AS count FROM "${table}"`)[0]?.count ?? 0)
const stable = (value) => {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, stable(nested)]))
  return value
}
const digestPayload = (value) => sha256(JSON.stringify(stable(value)))

async function assertPortFree(port) {
  const occupied = await new Promise((resolveResult) => {
    const socket = connect({ host: '127.0.0.1', port })
    socket.once('connect', () => { socket.destroy(); resolveResult(true) })
    socket.once('error', () => resolveResult(false))
    socket.setTimeout(500, () => { socket.destroy(); resolveResult(false) })
  })
  assert.equal(occupied, false, `port ${port} is already occupied; refusing false-green service reuse`)
}

function token(prefix) { return `px-${prefix}-${randomUUID().replaceAll('-', '')}` }
function routeMessage(entryContainer, entryAction, routeIntent, routePayload) {
  const routeId = token('route')
  const correlationId = token('corr')
  const idempotencyKey = token('idem')
  const targetContainer = entryAction === 'view_source' && entryContainer === 'sidepanel' ? 'sidepanel' : 'workspace_page'
  const now = new Date().toISOString()
  const payload = {
    schemaVersion: 'v2-px-intent-route/3', productId: 'fams-v2-px', repository: 'https://github.com/ljx418/FAMS.git', commitSha,
    entryContainer, entryAction, routeIntent, targetContainer, routeId, correlationId, idempotencyKey,
    permissionType: 'read_only_direct', routePayload,
    audit: { createdAt: now, sourceContainer: entryContainer, schemaValidated: true, semanticValidationRequired: true },
  }
  return {
    schemaVersion: 'v2-px-runtime-message/1', messageType: 'intent_route', routeId, correlationId, idempotencyKey,
    sourceContainer: entryContainer, targetContainer, sentAt: now, payload,
  }
}

function queryMessage(question, idempotencyKey = token('idem')) {
  const routeId = token('route')
  const correlationId = token('corr')
  const payloadBody = { workspaceId, question, contextRefs: [] }
  const command = {
    schemaVersion: 'v2-px-operation-command/2', productId: 'fams-v2-px', commandId: token('command'), idempotencyKey,
    payloadDigest: digestPayload(payloadBody), routeId, correlationId, commandType: 'query', sourceContainer: 'workspace_page',
    targetContainer: 'background', permissionType: 'compute_quick_run', payload: payloadBody, requestedAt: new Date().toISOString(),
  }
  return {
    schemaVersion: 'v2-px-runtime-message/1', messageType: 'operation_command', routeId, correlationId, idempotencyKey,
    sourceContainer: 'workspace_page', targetContainer: 'background', sentAt: command.requestedAt, payload: command,
  }
}

async function waitForFamsWorker(context, excludedWorker) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    for (const candidate of context.serviceWorkers()) {
      if (candidate === excludedWorker || !candidate.url().startsWith('chrome-extension://')) continue
      try {
        const manifest = await candidate.evaluate(() => chrome.runtime.getManifest())
        if (manifest?.name === 'FAMS External Brain') return candidate
      } catch { /* worker can terminate during reload */ }
    }
    await Promise.race([context.waitForEvent('serviceworker', { timeout: 500 }).catch(() => undefined), wait(500)])
  }
  throw new Error('Chrome did not expose the FAMS External Brain worker')
}

async function startAcceptanceServer(extensionId) {
  const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/start-v2-px-acceptance-server.ts'], {
    cwd: backendRoot,
    env: { ...process.env, FAMS_V2_PX_EXTENSION_IDS: extensionId },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`acceptance server timeout: ${output.slice(-2500)}`)), 30_000)
    const inspect = (chunk) => {
      output += chunk.toString()
      if (output.includes('"status":"ready"')) { clearTimeout(timer); resolveReady() }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`acceptance server exited ${code}: ${output.slice(-2500)}`)) })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
  return { child, output: () => output }
}

async function sendInternal(page, message) {
  return page.evaluate((input) => new Promise((resolveResponse, reject) => {
    chrome.runtime.sendMessage(input, (response) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolveResponse(response)
    })
  }), message)
}

async function sendExternal(page, extensionId, message) {
  return page.evaluate(({ id, input }) => new Promise((resolveResponse, reject) => {
    if (!globalThis.chrome?.runtime?.sendMessage) { reject(new Error('external chrome.runtime messaging is unavailable')); return }
    chrome.runtime.sendMessage(id, input, (response) => {
      const error = chrome.runtime.lastError
      if (error) reject(new Error(error.message))
      else resolveResponse(response)
    })
  }), { id: extensionId, input: message })
}

async function workspaceTabs(worker, targetWorkspaceId = workspaceId) {
  return worker.evaluate(async (id) => {
    const tabs = await chrome.tabs.query({ url: `${chrome.runtime.getURL('/workspace.html')}*` })
    return tabs.filter((tab) => {
      try { return new URL(tab.url).searchParams.get('workspaceId') === id } catch { return false }
    }).map((tab) => ({ id: tab.id, windowId: tab.windowId, url: tab.url }))
  }, targetWorkspaceId)
}

await assertPortFree(3000)
await assertPortFree(4000)
const hostServer = createServer((_request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
  response.end('<!doctype html><html><body><main>PX5 Host transport acceptance</main></body></html>')
})
await new Promise((resolveReady, reject) => {
  hostServer.once('error', reject)
  hostServer.listen(3000, '127.0.0.1', resolveReady)
})

const productionManifest = JSON.parse(readFileSync(resolve(outputDir, 'manifest.json'), 'utf8'))
assert.deepEqual(productionManifest.host_permissions ?? [], [])
const extensionLoadDir = resolve(evidenceDir, 'headless-pregranted-extension')
await cp(outputDir, extensionLoadDir, { recursive: true, force: true })
const acceptanceManifestPath = resolve(extensionLoadDir, 'manifest.json')
const acceptanceManifest = JSON.parse(await readFile(acceptanceManifestPath, 'utf8'))
acceptanceManifest.host_permissions = [...acceptanceManifest.optional_host_permissions]
acceptanceManifest.optional_host_permissions = []
await writeFile(acceptanceManifestPath, `${JSON.stringify(acceptanceManifest)}\n`)

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
let diagnostics = ''
const endpoint = await new Promise((resolveEndpoint, reject) => {
  const timer = setTimeout(() => reject(new Error(`Chrome CDP timeout: ${diagnostics.slice(-2500)}`)), 30_000)
  chromeProcess.stderr.on('data', (chunk) => {
    diagnostics += chunk.toString()
    const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (match) { clearTimeout(timer); resolveEndpoint(match[1]) }
  })
  chromeProcess.once('error', (error) => { clearTimeout(timer); reject(error) })
  chromeProcess.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}: ${diagnostics.slice(-2500)}`)) })
})

let browser
let backend
let traceStopped = false
try {
  browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 })
  const context = browser.contexts()[0]
  assert.ok(context, 'Chrome default context is missing')
  const rootSession = await browser.newBrowserCDPSession()
  let worker = await waitForFamsWorker(context)
  const extensionId = new URL(worker.url()).host
  assert.match(extensionId, /^[a-p]{32}$/)
  backend = await startAcceptanceServer(extensionId)

  const network = []
  const consoleEntries = []
  const attachPage = (page) => {
    page.on('console', (entry) => consoleEntries.push({ type: entry.type(), text: entry.text(), url: page.url() }))
    page.on('pageerror', (error) => consoleEntries.push({ type: 'pageerror', text: error.message, url: page.url() }))
  }
  context.pages().forEach(attachPage)
  context.on('page', attachPage)
  context.on('request', (request) => network.push({ phase: 'request', method: request.method(), url: request.url(), at: new Date().toISOString() }))
  context.on('response', (response) => network.push({ phase: 'response', status: response.status(), url: response.url(), at: new Date().toISOString() }))
  const attachWorker = (candidate) => candidate.on('console', (entry) => consoleEntries.push({ type: entry.type(), text: entry.text(), url: candidate.url() }))
  attachWorker(worker)
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false })

  const countsBefore = {
    Transaction: countTable('Transaction'),
    GridOrderDraft: countTable('GridOrderDraft'),
    ExternalOrderObservation: countTable('ExternalOrderObservation'),
  }
  const sourceResponse = await worker.evaluate(async () => {
    const response = await fetch('http://localhost:4000/api/v1/external-brain/sources?limit=20', { headers: { 'X-FAMS-Extension-Id': chrome.runtime.id }, cache: 'no-store' })
    return { status: response.status, body: await response.json() }
  })
  assert.equal(sourceResponse.status, 200)
  const operationSource = sourceResponse.body.data.items.find((item) => item.kind === 'operation_artifact' && item.operationId)
  const reviewResponse = await worker.evaluate(async () => {
    const response = await fetch('http://localhost:4000/api/v1/external-brain/sources?kind=daily_review_evidence&limit=1', { headers: { 'X-FAMS-Extension-Id': chrome.runtime.id }, cache: 'no-store' })
    return { status: response.status, body: await response.json() }
  })
  assert.equal(reviewResponse.status, 200)
  const reviewSource = reviewResponse.body.data.items[0]
  assert.ok(operationSource?.sourceRef && operationSource?.operationId, 'real operation source is required')
  assert.ok(reviewSource?.sourceRef && reviewSource?.reviewId, 'real review source is required')

  const sidepanel = await context.newPage()
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
  await sidepanel.getByTestId('sidepanel-app').waitFor({ timeout: 15_000 })
  const control = await context.newPage()
  await control.goto(`chrome-extension://${extensionId}/workspace.html?workspaceId=${controlWorkspaceId}&view=source_library`, { waitUntil: 'domcontentloaded' })
  await control.getByTestId('workspace-app').waitFor({ timeout: 15_000 })
  const host = await context.newPage()
  await host.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' })

  const matrix = [
    ['sidepanel', 'view_source', 'source_detail', { workspaceId, sourceRef: operationSource.sourceRef }],
    ['sidepanel', 'open_workspace', 'source_library', { workspaceId }],
    ['sidepanel', 'open_in_workspace', 'trace', { workspaceId, operationId: operationSource.operationId }],
    ['workspace_page', 'view_source', 'source_detail', { workspaceId, sourceRef: reviewSource.sourceRef }],
    ['workspace_page', 'open_workspace', 'ask', { workspaceId }],
    ['workspace_page', 'open_in_workspace', 'graph', { workspaceId, graphScope: 'daily-review', graphId: reviewSource.reviewId }],
    ['host_app', 'view_source', 'source_detail', { workspaceId, sourceRef: reviewSource.sourceRef }],
    ['host_app', 'open_workspace', 'ask', { workspaceId }],
    ['host_app', 'open_in_workspace', 'trace', { workspaceId, operationId: operationSource.operationId }],
  ]
  const matrixResults = []
  for (const [entry, action, intent, routePayload] of matrix) {
    const message = routeMessage(entry, action, intent, routePayload)
    const response = entry === 'host_app' ? await sendExternal(host, extensionId, message) : await sendInternal(entry === 'sidepanel' ? sidepanel : control, message)
    assert.equal(response.status, 'accepted', `${entry}/${action}/${intent} was not accepted: ${JSON.stringify(response)}`)
    matrixResults.push({ entry, action, intent, target: message.targetContainer, routeId: message.routeId, correlationId: message.correlationId })
  }
  assert.equal(matrixResults.length, 9)
  assert.deepEqual([...new Set(matrixResults.map((item) => item.intent))].sort(), ['ask', 'graph', 'source_detail', 'source_library', 'trace'])

  for (let index = 0; index < 20; index += 1) {
    const response = await sendInternal(sidepanel, routeMessage('sidepanel', 'open_workspace', 'source_library', { workspaceId, filter: `sequential-${index}` }))
    assert.equal(response.status, 'accepted')
  }
  assert.equal((await workspaceTabs(worker)).length, 1, '20 sequential opens did not converge to one tab')
  const concurrentRoutes = Array.from({ length: 20 }, () => routeMessage('sidepanel', 'open_in_workspace', 'trace', { workspaceId, operationId: operationSource.operationId, sourceRef: operationSource.sourceRef }))
  const concurrentRouteResults = await Promise.all(concurrentRoutes.map((message) => sendInternal(sidepanel, message)))
  assert.equal(concurrentRouteResults.every((response) => response.status === 'accepted'), true)
  assert.equal((await workspaceTabs(worker)).length, 1, '20 concurrent opens did not converge to one tab')

  const duplicateWindow = await worker.evaluate(async (url) => chrome.windows.create({ url, focused: false }), `chrome-extension://${extensionId}/workspace.html?workspaceId=${workspaceId}&view=graph&ref=${reviewSource.reviewId}`)
  assert.ok(duplicateWindow?.id, 'real second Chrome window was not created')
  const duplicateDeadline = Date.now() + 10_000
  while ((await workspaceTabs(worker)).length < 2 && Date.now() < duplicateDeadline) await wait(100)
  assert.equal((await workspaceTabs(worker)).length, 2, 'multi-window duplicate setup failed')
  await sendInternal(sidepanel, routeMessage('sidepanel', 'open_workspace', 'source_library', { workspaceId }))
  const convergedTabs = await workspaceTabs(worker)
  assert.equal(convergedTabs.length, 1, 'multi-window duplicates were not consolidated')
  const focusedWindow = await worker.evaluate(async (windowId) => chrome.windows.get(windowId), convergedTabs[0].windowId)
  assert.equal(focusedWindow.focused, true, 'retained Workspace window was not focused')

  const activeUrl = new URL(convergedTabs[0].url)
  assert.deepEqual([...activeUrl.searchParams.keys()].sort(), ['view', 'workspaceId'])
  assert.equal(activeUrl.searchParams.has('routeId'), false)
  assert.equal(activeUrl.searchParams.has('correlationId'), false)

  const ask = queryMessage(`PX5 真实并发幂等核对 ${randomUUID()}`)
  const postsBeforeAsk = network.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/external-brain/ask')).length
  const concurrentAskResults = await Promise.all(Array.from({ length: 20 }, () => sendInternal(control, ask)))
  assert.equal(concurrentAskResults.every((response) => response.commandResult.status === 'completed'), true, JSON.stringify(concurrentAskResults))
  const postsAfterAsk = network.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/external-brain/ask')).length
  assert.equal(postsAfterAsk - postsBeforeAsk, 1, '20 concurrent same-key Ask messages must send exactly one POST')
  const replay = await sendInternal(control, ask)
  assert.equal(replay.commandResult.status, 'completed')
  assert.equal(network.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/external-brain/ask')).length, postsAfterAsk)

  const unknown = queryMessage(`PX5 dispatched reload unknown ${randomUUID()}`)
  await worker.evaluate(async (record) => {
    const current = await chrome.storage.local.get('dispatchLedger')
    await chrome.storage.local.set({ dispatchLedger: [...(current.dispatchLedger ?? []), record] })
  }, {
    idempotencyKey: unknown.idempotencyKey, payloadDigest: unknown.payload.payloadDigest, dispatchState: 'dispatched',
    createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString(), lastAccessedAt: new Date().toISOString(),
  })
  const postsBeforeUnknown = network.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/external-brain/ask')).length
  const unknownResponse = await sendInternal(control, unknown)
  assert.equal(unknownResponse.commandResult.status, 'unknown_result')
  assert.equal(network.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/external-brain/ask')).length, postsBeforeUnknown)

  const storageFaultAsk = queryMessage(`PX5 真实 storage 版本故障 ${randomUUID()}`)
  await worker.evaluate(async () => chrome.storage.local.set({ recoveryIndex: [{ schemaVersion: 'v2-px-recovery-index/99' }] }))
  const postsBeforeFault = network.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/external-brain/ask')).length
  const faultResponse = await sendInternal(control, storageFaultAsk)
  assert.equal(faultResponse.commandResult.status, 'unknown_result')
  assert.equal(faultResponse.commandResult.error.code, 'PX_RESULT_NOT_PERSISTED')
  const postsAfterFault = network.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/external-brain/ask')).length
  assert.equal(postsAfterFault - postsBeforeFault, 1)
  await worker.evaluate(async () => chrome.storage.local.set({ recoveryIndex: [] }))
  const faultReplay = await sendInternal(control, storageFaultAsk)
  assert.equal(faultReplay.commandResult.status, 'completed')
  assert.equal(network.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/external-brain/ask')).length, postsAfterFault)

  const beforeReloadPosts = postsAfterFault
  const previousWorker = worker
  const { targetInfos } = await rootSession.send('Target.getTargets')
  const workerTarget = targetInfos.find((target) => target.type === 'service_worker' && target.url === previousWorker.url())
  assert.ok(workerTarget, 'CDP could not resolve the live extension service worker target')
  const closedWorker = await rootSession.send('Target.closeTarget', { targetId: workerTarget.targetId })
  assert.equal(closedWorker.success, true, 'CDP did not stop the extension service worker')
  await wait(750)
  const reloadTrigger = await context.newPage()
  await reloadTrigger.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => undefined)
  worker = await waitForFamsWorker(context)
  attachWorker(worker)
  const controlAfterReload = await context.newPage()
  await controlAfterReload.goto(`chrome-extension://${extensionId}/workspace.html?workspaceId=${controlWorkspaceId}&view=source_library`, { waitUntil: 'domcontentloaded' })
  await controlAfterReload.getByTestId('workspace-app').waitFor({ timeout: 15_000 })
  const reloadReplay = await sendInternal(controlAfterReload, ask)
  assert.equal(reloadReplay.commandResult.status, 'completed')
  assert.equal(network.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/external-brain/ask')).length, beforeReloadPosts)

  const storage = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }))
  const storageText = JSON.stringify(storage)
  assert.equal(storageText.includes(ask.payload.payload.question), false, 'question leaked into extension storage')
  assert.equal(storageText.includes('真实摘要'), false, 'answer body leaked into extension storage')
  assert.ok(Array.isArray(storage.local.dispatchLedger) && storage.local.dispatchLedger.length <= 500)
  assert.ok(Array.isArray(storage.local.recoveryIndex) && storage.local.recoveryIndex.length <= 20)
  const askLedger = storage.local.dispatchLedger.find((record) => record.idempotencyKey === ask.idempotencyKey)
  assert.equal(askLedger?.dispatchState, 'completed')
  assert.ok(askLedger?.resultRef?.conversationId)
  assert.ok(storage.session.lifecycleEvents.some((event) => event.eventType === 'dispatch_result_unknown'))
  assert.ok(storage.session.lifecycleEvents.some((event) => event.eventType === 'storage_write_failed'))

  const target = context.pages().find((page) => {
    try { return page.url().startsWith(`chrome-extension://${extensionId}/workspace.html`) && new URL(page.url()).searchParams.get('workspaceId') === workspaceId } catch { return false }
  })
  assert.ok(target, 'real Workspace target is missing for screenshot')
  await target.setViewportSize({ width: 1280, height: 900 })
  await target.getByTestId('workspace-app').waitFor({ timeout: 15_000 })
  const screenshotPath = resolve(evidenceDir, 'router-idempotency-workspace-1280.png')
  await target.screenshot({ path: screenshotPath, fullPage: false, animations: 'disabled' })

  const countsAfter = {
    Transaction: countTable('Transaction'),
    GridOrderDraft: countTable('GridOrderDraft'),
    ExternalOrderObservation: countTable('ExternalOrderObservation'),
  }
  assert.deepEqual(countsAfter, countsBefore, 'PX5 changed trading-related database tables')
  const forbiddenRequests = network.filter((entry) => entry.phase === 'request' && /broker|order-create|\/orders(?:\?|$)|auto-trade/i.test(entry.url))
  const backendMutations = network.filter((entry) => entry.phase === 'request' && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(entry.method) && entry.url.includes(':4000/') && !entry.url.includes('/external-brain/ask'))
  assert.deepEqual(forbiddenRequests, [])
  assert.deepEqual(backendMutations, [])
  const consoleErrors = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror')
  assert.deepEqual(consoleErrors, [], `Chrome console errors: ${JSON.stringify(consoleErrors)}`)

  const tracePath = resolve(evidenceDir, 'router-idempotency-trace.zip')
  await context.tracing.stop({ path: tracePath })
  traceStopped = true
  const report = {
    schemaVersion: 'fams.v2_px.router_idempotency_chrome_evidence.v1', status: 'passed', realData: true,
    automationMode: 'headless_new', commitSha, chromeVersion: browser.version().replace(/^Chrome\//, ''), extensionId, workspaceId,
    matrix: { passed: matrixResults.length, expected: 9, intents: [...new Set(matrixResults.map((item) => item.intent))].sort(), results: matrixResults },
    tabs: { sequentialOpenCount: 20, concurrentOpenCount: 20, finalWorkspaceTabCount: 1, multiWindowDuplicateConverged: true, retainedWindowFocused: true },
    idempotency: { concurrentMessageCount: 20, concurrentAskPostCount: 1, replayPostCount: 0, reloadReplayPostCount: 0, dispatchedUnknownPostCount: 0, resultAfterStorageFaultPostCount: 1, faultReplayPostCount: 0 },
    storage: { ledgerCount: storage.local.dispatchLedger.length, recoveryIndexCount: storage.local.recoveryIndex.length, containsQuestionOrAnswer: false, lifecycleUnknownEventPresent: true, lifecycleStorageFailureEventPresent: true },
    realEntities: { operationId: operationSource.operationId, operationSourceRef: operationSource.sourceRef, reviewId: reviewSource.reviewId, reviewSourceRef: reviewSource.sourceRef, conversationId: askLedger.resultRef.conversationId },
    tradeBoundary: { brokerOrderRequestCount: forbiddenRequests.length, backendNonAskMutationCount: backendMutations.length, databaseCountsBefore: countsBefore, databaseCountsAfter: countsAfter, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    consoleErrorCount: consoleErrors.length,
    artifacts: {
      screenshot: { path: relative(repoRoot, screenshotPath).replaceAll('\\', '/'), sha256: sha256(await readFile(screenshotPath)) },
      trace: { path: relative(repoRoot, tracePath).replaceAll('\\', '/'), sha256: sha256(await readFile(tracePath)) },
    },
  }
  await writeFile(resolve(evidenceDir, 'network.json'), `${JSON.stringify(network, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'console.json'), `${JSON.stringify(consoleEntries, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'storage-metadata.json'), `${JSON.stringify(storage, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'router-idempotency-evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'stage-manifest.json'), `${JSON.stringify({
    schemaVersion: 'v2-px-stage-manifest/1', stage: stageName, status: 'passed', commitSha,
    command: 'npm run verify:router-idempotency-chrome', exitCode: 0, report,
    humanAcceptanceStatus: 'not_performed',
  }, null, 2)}\n`)
  console.log(JSON.stringify({ status: 'passed', evidenceDir, ...report }, null, 2))
} finally {
  if (browser?.contexts()[0] && !traceStopped) await browser.contexts()[0].tracing.stop().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  if (backend) { backend.child.kill('SIGTERM'); await wait(500) }
  await new Promise((resolveClose) => hostServer.close(resolveClose))
  chromeProcess.kill('SIGTERM')
}
