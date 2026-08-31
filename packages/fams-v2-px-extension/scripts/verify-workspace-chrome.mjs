import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')
const backendRoot = resolve(repoRoot, 'backend')
const outputDir = resolve(packageRoot, '.output/chrome-mv3')
const databasePath = resolve(backendRoot, 'prisma/dev.db')
const workspaceId = 'px-ws-00000000-0000-4000-8000-000000000001'
const acceptanceHost = process.env.V2_PX_ACCEPTANCE_HOST || '0.0.0.0'
const acceptanceApiOrigin = acceptanceHost === '::1' ? 'http://[::1]:4000' : 'http://127.0.0.1:4000'
assert.ok(existsSync(resolve(outputDir, 'manifest.json')), 'WXT build output is missing')
assert.ok(existsSync(databasePath), 'real FAMS SQLite database is missing')
const productionManifest = JSON.parse(readFileSync(resolve(outputDir, 'manifest.json'), 'utf8'))
assert.deepEqual(productionManifest.host_permissions ?? [], [], 'production build must not pregrant backend origins')
assert.deepEqual((productionManifest.optional_host_permissions ?? []).sort(), ['http://127.0.0.1:4000/*', 'http://localhost:4000/*'].sort())

const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const dirtyScope = execFileSync('git', ['status', '--short', '--',
  'packages/fams-v2-px-extension',
  'backend/src/routes/externalBrain.ts',
  'backend/src/services/external-brain',
  'backend/scripts/start-v2-px-acceptance-server.ts',
], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!process.env.V2_PX_ALLOW_DIRTY) assert.equal(dirtyScope, '', `PX3 evidence requires committed in-scope files:\n${dirtyScope}`)
const stageName = process.env.V2_PX_ALLOW_DIRTY ? 'PX3-dev' : 'PX3'
const evidenceDir = resolve(repoRoot, '.verification/private/v2-px', commitSha, stageName)
await mkdir(evidenceDir, { recursive: true })
const headlessPregrant = process.env.V2_PX_HEADLESS_PREGRANT !== '0'
let extensionLoadDir = outputDir
if (headlessPregrant) {
  extensionLoadDir = resolve(evidenceDir, 'headless-pregranted-extension')
  await cp(outputDir, extensionLoadDir, { recursive: true, force: true })
  const manifestPath = resolve(extensionLoadDir, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.host_permissions = [...manifest.optional_host_permissions]
  manifest.optional_host_permissions = []
  await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`)
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const wait = (delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs))
const sqlJson = (query) => JSON.parse(execFileSync('sqlite3', [databasePath, '-json', query], { encoding: 'utf8' }) || '[]')
const countTransactions = () => Number(sqlJson('SELECT COUNT(*) AS count FROM "Transaction" WHERE userId = \'default\'')[0]?.count ?? 0)

function rawSourceRef(sourceRef) {
  const parts = sourceRef.split(':')
  assert.equal(parts.length, 3, 'sourceRef must have three parts')
  return Buffer.from(parts[2], 'base64url').toString('utf8')
}

function includesString(value, target) {
  if (Array.isArray(value)) return value.some((item) => includesString(item, target))
  if (value && typeof value === 'object') return Object.values(value).some((item) => includesString(item, target))
  return value === target
}

function runtimeRoute(routeIntent, routePayload) {
  const nonce = crypto.randomUUID().replaceAll('-', '')
  const routeId = `px-route-${nonce}`
  const correlationId = `px-corr-${nonce}`
  const idempotencyKey = `px-idem-${nonce}`
  const now = new Date().toISOString()
  const payload = {
    schemaVersion: 'v2-px-intent-route/3', productId: 'fams-v2-px', repository: 'https://github.com/ljx418/FAMS.git', commitSha,
    entryContainer: 'workspace_page', entryAction: 'view_source', routeIntent, targetContainer: 'workspace_page',
    routeId, correlationId, idempotencyKey, permissionType: 'read_only_direct', routePayload,
    audit: { createdAt: now, sourceContainer: 'workspace_page', schemaValidated: true, semanticValidationRequired: true },
  }
  return {
    schemaVersion: 'v2-px-runtime-message/1', messageType: 'intent_route', routeId, correlationId, idempotencyKey,
    sourceContainer: 'workspace_page', targetContainer: 'workspace_page', sentAt: now, payload,
  }
}

async function sendRuntimeRoute(page, routeIntent, routePayload) {
  const message = runtimeRoute(routeIntent, routePayload)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await page.evaluate((input) => chrome.runtime.sendMessage(input), message)
    } catch (error) {
      if (!String(error).includes('Execution context was destroyed') || attempt === 2) throw error
      await page.waitForLoadState('domcontentloaded').catch(() => undefined)
    }
  }
}

async function apiJson(extensionId, path) {
  const response = await fetch(`${acceptanceApiOrigin}${path}`, { headers: { Origin: `chrome-extension://${extensionId}`, 'X-FAMS-Extension-Id': extensionId } })
  const body = await response.json()
  assert.equal(response.ok, true, `real API failed ${response.status}: ${JSON.stringify(body)}`)
  return body
}

async function waitForFamsWorker(context) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().startsWith('chrome-extension://')) continue
      try {
        const manifest = await candidate.evaluate(() => chrome.runtime.getManifest())
        if (manifest?.name === 'FAMS External Brain') return candidate
      } catch { /* worker may restart while inspected */ }
    }
    await Promise.race([context.waitForEvent('serviceworker', { timeout: 500 }).catch(() => undefined), wait(500)])
  }
  throw new Error('Chrome did not load the FAMS External Brain worker')
}

async function startAcceptanceServer(extensionId) {
  const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/start-v2-px-acceptance-server.ts'], {
    cwd: backendRoot,
    env: { ...process.env, FAMS_V2_PX_EXTENSION_IDS: extensionId },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  const ready = new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`acceptance server timeout: ${output.slice(-2000)}`)), 30_000)
    const inspect = (chunk) => {
      output += chunk.toString()
      if (output.includes('"status":"ready"')) { clearTimeout(timer); resolveReady() }
    }
    child.stdout.on('data', inspect)
    child.stderr.on('data', inspect)
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`acceptance server exited ${code}: ${output.slice(-2000)}`)) })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
  })
  await ready
  return { child, output: () => output }
}

async function capture(page, view, viewport, suffix = '') {
  await page.setViewportSize(viewport)
  await page.locator(`[data-testid="view-${view}"]`).waitFor({ timeout: 40_000 })
  const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, text: document.body.innerText }))
  assert.equal(Math.max(0, layout.scrollWidth - layout.clientWidth), 0, `${view} has horizontal overflow at ${viewport.width}`)
  assert.match(layout.text, /数据时间|你的问题/, `${view} lacks time/question context`)
  assert.match(layout.text, /下一步|发送问题/, `${view} lacks an actionable next step`)
  const evidenceDrawer = page.getByTestId('evidence-drawer')
  if (await evidenceDrawer.count()) assert.equal(await evidenceDrawer.evaluate((element) => element.hasAttribute('open')), false, `${view} evidence must be collapsed`)
  const filename = `${view}${suffix}-${viewport.width}.png`
  const path = resolve(evidenceDir, filename)
  const buffer = await page.screenshot({ path, fullPage: false, animations: 'disabled' })
  return { view, suffix, viewport, path: relative(repoRoot, path).replaceAll('\\', '/'), sha256: sha256(buffer), bodyText: layout.text }
}

async function captureBoth(page, view, suffix = '') {
  return [
    await capture(page, view, { width: 768, height: 900 }, suffix),
    await capture(page, view, { width: 1280, height: 900 }, suffix),
  ]
}

const linuxChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-linux64/chrome')
const windowsChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-win64/chrome.exe')
const chromePath = process.env.FAMS_CHROME_PATH || process.env.FAMS_WINDOWS_CHROME_PATH || (existsSync(linuxChrome) ? linuxChrome : windowsChrome)
assert.ok(existsSync(chromePath), `official Chrome for Testing not found: ${chromePath}`)
const isWindowsChrome = chromePath.endsWith('.exe')
const linuxRuntimeLib = resolve(repoRoot, '.verification/tools/chrome-for-testing/runtime-libs/root/usr/lib/x86_64-linux-gnu')
const profilePath = await mkdtemp(resolve(evidenceDir, 'chrome-profile-'))
const profileArgPath = isWindowsChrome ? execFileSync('wslpath', ['-w', profilePath], { encoding: 'utf8' }).trim() : profilePath
const extensionArgPath = isWindowsChrome ? execFileSync('wslpath', ['-w', extensionLoadDir], { encoding: 'utf8' }).trim() : extensionLoadDir
const chromeArgs = [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  '--no-proxy-server', ...(acceptanceHost === '::1' ? ['--host-resolver-rules=MAP localhost [::1]'] : []),
  '--remote-debugging-port=0', `--user-data-dir=${profileArgPath}`,
  `--disable-extensions-except=${extensionArgPath}`, `--load-extension=${extensionArgPath}`, 'about:blank',
]
const chromeProcess = spawn(chromePath, chromeArgs, {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, ...(isWindowsChrome ? {} : { LD_LIBRARY_PATH: [linuxRuntimeLib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }) },
})
let diagnostics = ''
const endpoint = await new Promise((resolveEndpoint, reject) => {
  const timer = setTimeout(() => reject(new Error(`Chrome CDP timeout: ${diagnostics.slice(-2000)}`)), 30_000)
  chromeProcess.stderr.on('data', (chunk) => {
    diagnostics += chunk.toString()
    const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (match) { clearTimeout(timer); resolveEndpoint(match[1]) }
  })
  chromeProcess.once('error', (error) => { clearTimeout(timer); reject(error) })
  chromeProcess.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}: ${diagnostics.slice(-2000)}`)) })
})

let browser
let server
try {
  browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 })
  const context = browser.contexts()[0]
  assert.ok(context, 'Chrome default context is missing')
  const worker = await waitForFamsWorker(context)
  const extensionId = new URL(worker.url()).host
  assert.match(extensionId, /^[a-p]{32}$/)
  if (process.env.V2_PX_REUSE_BACKEND !== '1') server = await startAcceptanceServer(extensionId)

  const countsBefore = { transactions: countTransactions() }
  const networkEntries = []
  const consoleEntries = []
  worker.on('console', (entry) => consoleEntries.push({ type: entry.type(), text: entry.text(), url: worker.url() }))
  context.on('request', (request) => networkEntries.push({
    phase: 'request', method: request.method(), url: request.url(), callerExtensionId: request.headers()['x-fams-extension-id'] ?? null, at: new Date().toISOString(),
  }))
  context.on('response', (response) => networkEntries.push({ phase: 'response', status: response.status(), url: response.url(), at: new Date().toISOString() }))
  context.on('page', (page) => {
    page.on('console', (entry) => consoleEntries.push({ type: entry.type(), text: entry.text(), url: page.url() }))
    page.on('pageerror', (error) => consoleEntries.push({ type: 'pageerror', text: error.message, url: page.url() }))
  })

  await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
  const sidepanel = await context.newPage()
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
  await sidepanel.getByTestId('sidepanel-app').waitFor()
  if (!headlessPregrant) await sidepanel.getByRole('button', { name: '连接本地 FAMS' }).click()
  try {
    await sidepanel.getByText('本地 FAMS 已连接', { exact: true }).waitFor({ timeout: 15_000 })
  } catch (error) {
    const permissionGranted = await worker.evaluate(() => chrome.permissions.contains({ origins: ['http://localhost:4000/*', 'http://127.0.0.1:4000/*'] }))
    const pageText = await sidepanel.locator('body').innerText()
    throw new Error(`connection failed; headlessPregrant=${headlessPregrant}; permissionGranted=${permissionGranted}; page=${JSON.stringify(pageText)}`, { cause: error })
  }
  const workerProbe = await worker.evaluate(async () => {
    try {
      const headers = { 'X-FAMS-Extension-Id': chrome.runtime.id }
      const health = await fetch('http://localhost:4000/health', { headers, cache: 'no-store' })
      const sources = await fetch('http://localhost:4000/api/v1/external-brain/sources?limit=1', { headers, cache: 'no-store' })
      return { health: health.status, healthBody: await health.text(), sources: sources.status, body: await sources.text() }
    } catch (error) {
      return { error: error instanceof Error ? `${error.name}:${error.message}` : String(error) }
    }
  })
  assert.deepEqual('error' in workerProbe ? workerProbe : { health: workerProbe.health, sources: workerProbe.sources }, { health: 200, sources: 200 }, `worker fetch probe failed: ${JSON.stringify(workerProbe)}`)

  const workspacePromise = context.waitForEvent('page', { timeout: 10_000 })
  await sidepanel.getByRole('button', { name: '完整工作台' }).click()
  let workspace
  try {
    workspace = await workspacePromise
  } catch (error) {
    const pageText = await sidepanel.locator('body').innerText().catch(() => '')
    throw new Error(`workspace tab did not open; sidepanel=${JSON.stringify(pageText)}; console=${JSON.stringify(consoleEntries)}; network=${JSON.stringify(networkEntries.slice(-20))}`, { cause: error })
  }
  await workspace.waitForLoadState('domcontentloaded')
  try {
    const openedView = new URL(workspace.url()).searchParams.get('view')
    await workspace.getByTestId(openedView === 'source_detail' ? 'view-source_detail' : 'view-source_library').waitFor({ timeout: 20_000 })
    if (openedView === 'source_detail') {
      await workspace.getByRole('button', { name: '来源库' }).click()
      await workspace.getByTestId('view-source_library').waitFor({ timeout: 20_000 })
    }
  } catch (error) {
    const pageText = await workspace.locator('body').innerText().catch(() => '')
    const workerErrors = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror')
    throw new Error(`workspace library failed; url=${workspace.url()}; page=${JSON.stringify(pageText)}; errors=${JSON.stringify(workerErrors)}; network=${JSON.stringify(networkEntries.slice(-20))}`, { cause: error })
  }

  const screenshots = []
  screenshots.push(...await captureBoth(workspace, 'source_library'))
  const operationCard = workspace.locator('[data-source-ref]').filter({ hasText: '任务产物' }).first()
  await operationCard.waitFor()
  const operationSourceRef = await operationCard.getAttribute('data-source-ref')
  assert.ok(operationSourceRef)
  await operationCard.getByRole('button', { name: '查看详情' }).click()
  await workspace.getByTestId('view-source_detail').waitFor({ timeout: 20_000 })
  screenshots.push(...await captureBoth(workspace, 'source_detail', '-operation'))

  await workspace.getByRole('button', { name: '来源库' }).click()
  await workspace.getByTestId('view-source_library').waitFor({ timeout: 20_000 })
  const operationCardForTrace = workspace.locator(`[data-source-ref="${operationSourceRef}"]`)
  const operationId = (await apiJson(extensionId, `/api/v1/external-brain/sources/${encodeURIComponent(operationSourceRef)}`)).data.operationId
  await operationCardForTrace.getByRole('button', { name: '任务追踪' }).click()
  await workspace.getByTestId('view-trace').waitFor({ timeout: 20_000 })
  screenshots.push(...await captureBoth(workspace, 'trace'))

  await sendRuntimeRoute(workspace, 'graph', { workspaceId, graphScope: 'operation', graphId: operationId })
  await workspace.getByTestId('view-graph').waitFor({ timeout: 20_000 })
  screenshots.push(...await captureBoth(workspace, 'graph', '-operation'))

  const reviewPage = await apiJson(extensionId, '/api/v1/external-brain/sources?kind=daily_review_evidence&limit=1')
  const reviewSource = reviewPage.data.items[0]
  assert.ok(reviewSource?.sourceRef && reviewSource?.reviewId, 'real review evidence is required')
  await sendRuntimeRoute(workspace, 'source_detail', { workspaceId, sourceRef: reviewSource.sourceRef })
  await workspace.getByTestId('view-source_detail').waitFor({ timeout: 20_000 })
  await workspace.getByTestId('view-source_detail').locator('article').getByText(rawSourceRef(reviewSource.sourceRef), { exact: true }).waitFor()
  screenshots.push(...await captureBoth(workspace, 'source_detail', '-review'))

  await sendRuntimeRoute(workspace, 'graph', { workspaceId, graphScope: 'daily-review', graphId: reviewSource.reviewId })
  await workspace.getByTestId('view-graph').waitFor({ timeout: 20_000 })
  screenshots.push(...await captureBoth(workspace, 'graph', '-review'))

  await workspace.getByRole('button', { name: '快速问答' }).click()
  await workspace.getByTestId('view-ask').waitFor({ timeout: 20_000 })
  await workspace.getByLabel('你的问题').fill('请用三句话总结当前真实 FAMS 研究上下文，并给出一个只读核对步骤。')
  await workspace.getByRole('button', { name: '发送问题' }).click()
  await workspace.getByTestId('ask-result').waitFor({ timeout: 40_000 })
  screenshots.push(...await captureBoth(workspace, 'ask'))

  const operationRawRef = rawSourceRef(operationSourceRef)
  const operationDb = sqlJson(`SELECT id, status, artifactRefsJson, requestedAt, startedAt, completedAt FROM "Operation" WHERE id = '${operationId}'`)[0]
  assert.equal(operationDb.id, operationId)
  assert.ok(JSON.parse(operationDb.artifactRefsJson).includes(operationRawRef), 'operation source is not a DB member')
  const reviewDb = sqlJson(`SELECT id, status, reportJson, generatedAt, completedAt FROM "DailyReviewRun" WHERE id = '${reviewSource.reviewId}'`)[0]
  assert.equal(reviewDb.id, reviewSource.reviewId)
  assert.equal(includesString(JSON.parse(reviewDb.reportJson), rawSourceRef(reviewSource.sourceRef)), true, 'review source is not a DB member')

  const storage = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }))
  const storageText = JSON.stringify(storage)
  assert.equal(storageText.includes('请用三句话总结'), false, 'question leaked into extension storage')
  assert.equal(storageText.includes('结论摘要'), false, 'answer body leaked into extension storage')
  const askPosts = networkEntries.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/api/v1/external-brain/ask'))
  assert.equal(askPosts.length, 1, `Ask POST count must be one, got ${askPosts.length}`)
  const externalBrainRequests = networkEntries.filter((entry) => entry.phase === 'request' && ['GET', 'POST'].includes(entry.method) && entry.url.includes('/api/v1/external-brain/'))
  assert.ok(externalBrainRequests.length >= 7, `expected real API traffic for five views, got ${externalBrainRequests.length}`)
  assert.equal(externalBrainRequests.every((entry) => entry.callerExtensionId === extensionId), true, 'real API request caller header drift')
  const forbiddenRequests = networkEntries.filter((entry) => /broker|order-create|\/orders(?:\?|$)|auto-trade/i.test(entry.url))
  assert.deepEqual(forbiddenRequests, [], `forbidden trading requests: ${JSON.stringify(forbiddenRequests)}`)
  assert.equal(countTransactions(), countsBefore.transactions, 'External Brain must not mutate Transaction')
  const consoleErrors = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror')
  assert.deepEqual(consoleErrors, [], `extension console errors: ${JSON.stringify(consoleErrors)}`)

  const tracePath = resolve(evidenceDir, 'workspace-trace.zip')
  await context.tracing.stop({ path: tracePath })
  const report = {
    schemaVersion: 'fams.v2_px.workspace_chrome_evidence.v1', status: 'passed', realData: true, automationMode: 'headless_new',
    commitSha, chromeVersion: browser.version().replace(/^Chrome\//, ''), extensionId, workspaceId,
    permissionEvidence: headlessPregrant ? 'acceptance_copy_pregranted; production_click_requires_human_check' : 'production_user_gesture',
    views: ['source_library', 'source_detail', 'ask', 'trace', 'graph'], viewports: [{ width: 768, height: 900 }, { width: 1280, height: 900 }],
    operation: { sourceRef: operationSourceRef, operationId, rawRef: operationRawRef, databaseStatus: operationDb.status },
    review: { sourceRef: reviewSource.sourceRef, reviewId: reviewSource.reviewId, rawRef: rawSourceRef(reviewSource.sourceRef), databaseStatus: reviewDb.status },
    screenshots: screenshots.map(({ bodyText: _bodyText, ...item }) => item),
    postAskRequestCount: askPosts.length, brokerOrderRequestCount: forbiddenRequests.length, transactionMutationCount: 0,
    callerHeaderMatchesExtensionId: true,
    storageContainsQuestionOrAnswer: false, consoleErrorCount: consoleErrors.length,
    executionBoundary: { researchOnly: true, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    trace: { path: relative(repoRoot, tracePath).replaceAll('\\', '/'), sha256: sha256(await readFile(tracePath)) },
  }
  await writeFile(resolve(evidenceDir, 'network.json'), `${JSON.stringify(networkEntries, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'console.json'), `${JSON.stringify(consoleEntries, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'storage-metadata.json'), `${JSON.stringify(storage, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'workspace-chrome-evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: 'passed', evidenceDir, ...report }, null, 2))
} finally {
  if (browser?.contexts()[0]) await browser.contexts()[0].tracing.stop().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  if (server) { server.child.kill('SIGTERM'); await wait(500) }
  chromeProcess.kill('SIGTERM')
}
