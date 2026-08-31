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
if (!process.env.V2_PX_ALLOW_DIRTY) assert.equal(dirtyScope, '', `PX4-A evidence requires committed in-scope files:\n${dirtyScope}`)
const stageName = process.env.V2_PX_ALLOW_DIRTY ? 'PX4A-dev' : 'PX4A'
const evidenceDir = resolve(repoRoot, '.verification/private/v2-px', commitSha, stageName)
await mkdir(evidenceDir, { recursive: true })

const extensionLoadDir = resolve(evidenceDir, 'headless-pregranted-extension')
await cp(outputDir, extensionLoadDir, { recursive: true, force: true })
const manifestPath = resolve(extensionLoadDir, 'manifest.json')
const acceptanceManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
acceptanceManifest.host_permissions = [...acceptanceManifest.optional_host_permissions]
acceptanceManifest.optional_host_permissions = []
await writeFile(manifestPath, `${JSON.stringify(acceptanceManifest)}\n`)

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const wait = (delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs))
const sqlJson = (query) => JSON.parse(execFileSync('sqlite3', [databasePath, '-json', query], { encoding: 'utf8' }) || '[]')
const countTransactions = () => Number(sqlJson('SELECT COUNT(*) AS count FROM "Transaction" WHERE userId = \'default\'')[0]?.count ?? 0)

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
  return child
}

async function apiJson(extensionId, path) {
  const response = await fetch(`${acceptanceApiOrigin}${path}`, { headers: { Origin: `chrome-extension://${extensionId}`, 'X-FAMS-Extension-Id': extensionId } })
  const body = await response.json()
  assert.equal(response.ok, true, `real API failed ${response.status}: ${JSON.stringify(body)}`)
  return body
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
const chromeProcess = spawn(chromePath, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  '--no-proxy-server', ...(acceptanceHost === '::1' ? ['--host-resolver-rules=MAP localhost [::1]'] : []),
  '--remote-debugging-port=0', `--user-data-dir=${profileArgPath}`,
  `--disable-extensions-except=${extensionArgPath}`, `--load-extension=${extensionArgPath}`, 'about:blank',
], {
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
  server = await startAcceptanceServer(extensionId)
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
  await sidepanel.setViewportSize({ width: 360, height: 900 })
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
  await sidepanel.getByTestId('sidepanel-current-summary').waitFor({ timeout: 30_000 })
  const sourceEnvelope = await apiJson(extensionId, '/api/v1/external-brain/sources?limit=1')
  const expectedSource = sourceEnvelope.data.items[0]
  assert.ok(expectedSource?.sourceRef && expectedSource?.operationId, 'real operation source is required')
  assert.equal(await sidepanel.getByTestId('sidepanel-current-summary').locator('h2').innerText(), expectedSource.title)
  assert.equal((await sidepanel.getByTestId('sidepanel-recent-task').all()).length <= 5, true)
  const operation = sqlJson(`SELECT id, status, artifactRefsJson FROM "Operation" WHERE id = '${expectedSource.operationId}'`)[0]
  assert.equal(operation.id, expectedSource.operationId)

  const screenshots = []
  for (const width of [360, 420]) {
    await sidepanel.setViewportSize({ width, height: 900 })
    await sidepanel.evaluate(() => window.scrollTo(0, 0))
    const layout = await sidepanel.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, bodyFont: Number.parseFloat(getComputedStyle(document.body).fontSize) }))
    assert.equal(Math.max(0, layout.scrollWidth - layout.clientWidth), 0, `Side Panel horizontal overflow at ${width}`)
    assert.ok(layout.bodyFont >= 14, `Side Panel body font ${layout.bodyFont}px below 14px at ${width}`)
    const path = resolve(evidenceDir, `sidepanel-summary-${width}.png`)
    const buffer = await sidepanel.screenshot({ path, fullPage: false, animations: 'disabled' })
    screenshots.push({ kind: 'summary', viewport: { width, height: 900 }, path: relative(repoRoot, path).replaceAll('\\', '/'), sha256: sha256(buffer) })
  }

  const question = '请读取当前组合摘要，用三句话总结，并给出一个只读核对步骤。'
  await sidepanel.getByLabel('你的问题').fill(question)
  const startedAt = Date.now()
  await sidepanel.getByRole('button', { name: '发送问题' }).click()
  await sidepanel.getByTestId('sidepanel-ask-ack').waitFor({ timeout: 1_000 })
  const ackVisibleMs = Date.now() - startedAt
  const terminal = sidepanel.locator('[data-testid="sidepanel-ask-result"], [data-testid="sidepanel-ask-error"]')
  try {
    await terminal.waitFor({ timeout: 35_000 })
  } catch (error) {
    const pageText = await sidepanel.locator('body').innerText().catch(() => '')
    throw new Error(`Side Panel final Ask missing; page=${JSON.stringify(pageText)}; network=${JSON.stringify(networkEntries.slice(-20))}; console=${JSON.stringify(consoleEntries)}`, { cause: error })
  }
  const finalVisibleMs = Date.now() - startedAt
  assert.ok(ackVisibleMs <= 1_000, `ack visible after ${ackVisibleMs}ms`)
  assert.ok(finalVisibleMs <= 35_000, `final visible after ${finalVisibleMs}ms`)
  const finalOutcome = await terminal.getAttribute('data-testid')
  const answerSummary = finalOutcome === 'sidepanel-ask-result' ? await terminal.locator('p').first().innerText() : ''
  if (finalOutcome === 'sidepanel-ask-result') assert.ok(answerSummary.trim().length > 0, 'real Ask summary is empty')
  else assert.match(await terminal.innerText(), /FAMS|下一步|复核/, 'blocked/failed terminal lacks a concrete next step')

  for (const width of [360, 420]) {
    await sidepanel.setViewportSize({ width, height: 900 })
    await terminal.scrollIntoViewIfNeeded()
    const layout = await sidepanel.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
    assert.equal(Math.max(0, layout.scrollWidth - layout.clientWidth), 0, `Side Panel answer overflow at ${width}`)
    const path = resolve(evidenceDir, `sidepanel-terminal-${width}.png`)
    const buffer = await sidepanel.screenshot({ path, fullPage: false, animations: 'disabled' })
    screenshots.push({ kind: 'terminal', viewport: { width, height: 900 }, path: relative(repoRoot, path).replaceAll('\\', '/'), sha256: sha256(buffer) })
  }

  const buttonHeights = await sidepanel.locator('button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height))
  assert.equal(buttonHeights.every((height) => height >= 44), true, `button below 44px: ${buttonHeights.join(',')}`)
  const evidenceDrawer = sidepanel.locator('.px-panel-evidence')
  assert.equal(await evidenceDrawer.evaluate((element) => element.hasAttribute('open')), false, 'Side Panel evidence must be collapsed by default')
  assert.equal(await sidepanel.locator('body').innerText().then((text) => /创建订单|立即买入|自动交易|解锁交易/.test(text)), false)

  const storage = await worker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }))
  const storageText = JSON.stringify(storage)
  assert.equal(storageText.includes(question), false, 'question leaked into extension storage')
  if (answerSummary) assert.equal(storageText.includes(answerSummary), false, 'answer leaked into extension storage')
  const askPosts = networkEntries.filter((entry) => entry.phase === 'request' && entry.method === 'POST' && entry.url.includes('/api/v1/external-brain/ask'))
  assert.equal(askPosts.length, 1, `Side Panel Ask POST count must be one, got ${askPosts.length}`)
  const externalBrainRequests = networkEntries.filter((entry) => entry.phase === 'request' && ['GET', 'POST'].includes(entry.method) && entry.url.includes('/api/v1/external-brain/'))
  assert.ok(externalBrainRequests.length >= 2, `expected Source and Ask API traffic, got ${externalBrainRequests.length}`)
  assert.equal(externalBrainRequests.every((entry) => entry.callerExtensionId === extensionId), true, 'Side Panel caller header drift')
  const forbiddenRequests = networkEntries.filter((entry) => /broker|order-create|\/orders(?:\?|$)|auto-trade/i.test(entry.url))
  assert.deepEqual(forbiddenRequests, [], `forbidden trading requests: ${JSON.stringify(forbiddenRequests)}`)
  assert.equal(countTransactions(), countsBefore.transactions, 'Side Panel must not mutate Transaction')
  const consoleErrors = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror')
  assert.deepEqual(consoleErrors, [], `unexpected console errors: ${JSON.stringify(consoleErrors)}`)

  const tracePath = resolve(evidenceDir, 'sidepanel-trace.zip')
  await context.tracing.stop({ path: tracePath })
  const report = {
    schemaVersion: 'fams.v2_px.sidepanel_chrome_evidence.v1', status: 'passed', realData: true,
    automationMode: 'headless_new_private_permission_pregrant', commitSha, chromeVersion: await browser.version(), extensionId,
    permissionEvidence: 'acceptance_copy_pregranted; production_click_requires_human_check',
    source: { sourceRef: expectedSource.sourceRef, operationId: expectedSource.operationId, title: expectedSource.title, databaseStatus: operation.status },
    ask: { ackVisibleMs, finalVisibleMs, postCount: askPosts.length, finalOutcome, summaryLength: answerSummary.length },
    viewports: [360, 420], screenshots,
    callerHeaderMatchesExtensionId: true, storageContainsQuestionOrAnswer: false, brokerOrderRequestCount: 0, transactionMutationCount: 0, consoleErrorCount: 0,
    trace: { path: relative(repoRoot, tracePath).replaceAll('\\', '/'), sha256: sha256(await readFile(tracePath)) },
    executionBoundary: { researchOnly: true, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
  }
  await writeFile(resolve(evidenceDir, 'sidepanel-chrome-evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: 'passed', evidenceDir, ...report }, null, 2))
} finally {
  if (browser) await browser.close().catch(() => undefined)
  if (server) { server.kill('SIGTERM'); await new Promise((resolveExit) => server.once('exit', resolveExit)).catch(() => undefined) }
  chromeProcess.kill('SIGTERM')
}
