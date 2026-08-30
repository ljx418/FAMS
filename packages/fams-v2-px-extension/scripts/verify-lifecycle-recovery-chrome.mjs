import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from '@playwright/test'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')
const backendRoot = resolve(repoRoot, 'backend')
const outputDir = resolve(packageRoot, '.output/chrome-mv3')
const sourceDatabasePath = resolve(backendRoot, 'prisma/dev.db')
const workspaceId = 'px-ws-00000000-0000-4000-8000-000000000001'
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const dirtyScope = execFileSync('git', ['status', '--short', '--',
  'packages/fams-v2-px-extension', 'backend/scripts/start-v2-px-acceptance-server.ts',
  'backend/scripts/verify-v2-px-semantic-contract.ts', 'docs/V2_PX_API_RUNTIME_CONTRACT.md',
  'docs/V2_PX_TARGET_ARCHITECTURE.md', 'docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md',
  'docs/V2_PX_PRD_TRACEABILITY_MATRIX.md', 'docs/current-stage-state.json', 'docs/audits/v2-px',
], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!process.env.V2_PX_ALLOW_DIRTY) assert.equal(dirtyScope, '', `PX5-01 evidence requires committed in-scope files:\n${dirtyScope}`)
assert.ok(existsSync(resolve(outputDir, 'manifest.json')), 'WXT build output is missing')
assert.ok(existsSync(sourceDatabasePath), 'real FAMS SQLite database is missing')

const devRun = (process.env.V2_PX_DEV_RUN ?? 'default').replace(/[^a-zA-Z0-9_-]/g, '_')
const evidenceDir = resolve(repoRoot, '.verification/private/v2-px', commitSha, process.env.V2_PX_ALLOW_DIRTY ? `PX5-01-dev-${devRun}` : 'PX5-01')
await mkdir(evidenceDir, { recursive: true })
const extensionLoadDir = resolve(evidenceDir, 'headless-pregranted-extension')
await cp(outputDir, extensionLoadDir, { recursive: true, force: true })
const manifestPath = resolve(extensionLoadDir, 'manifest.json')
const productionManifest = JSON.parse(readFileSync(resolve(outputDir, 'manifest.json'), 'utf8'))
assert.deepEqual(productionManifest.host_permissions ?? [], [])
assert.deepEqual((productionManifest.optional_host_permissions ?? []).sort(), ['http://127.0.0.1:4000/*', 'http://localhost:4000/*'].sort())
assert.equal(productionManifest.permissions.includes('alarms'), false)
assert.equal(productionManifest.permissions.includes('scripting'), false)
assert.equal(JSON.stringify(productionManifest).includes('<all_urls>'), false)
const acceptanceManifest = JSON.parse(await readFile(manifestPath, 'utf8'))
acceptanceManifest.host_permissions = [...acceptanceManifest.optional_host_permissions]
acceptanceManifest.optional_host_permissions = []
await writeFile(manifestPath, `${JSON.stringify(acceptanceManifest)}\n`)

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const sha256File = (path) => execFileSync('sha256sum', [path], { encoding: 'utf8' }).split(/\s+/)[0]
const wait = (delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs))
const sqlJson = (database, query) => JSON.parse(execFileSync('sqlite3', [database, '-json', query], { encoding: 'utf8' }) || '[]')
const tempRoot = await mkdtemp(resolve(tmpdir(), 'fams-v2-px-px5-01-'))
const databasePath = resolve(tempRoot, 'real-data-snapshot.db')
execFileSync('sqlite3', [sourceDatabasePath, `.backup '${databasePath.replaceAll("'", "''")}'`])
execFileSync('sqlite3', [databasePath, 'PRAGMA quick_check;'], { encoding: 'utf8' })
const dataEvidence = {
  sourcePath: relative(repoRoot, sourceDatabasePath).replaceAll('\\', '/'),
  sourceSizeBytes: statSync(sourceDatabasePath).size,
  sourceSha256: sha256File(sourceDatabasePath),
  snapshotSizeBytes: statSync(databasePath).size,
  snapshotSha256: sha256File(databasePath),
}
const countTransactions = () => Number(sqlJson(databasePath, 'SELECT COUNT(*) AS count FROM "Transaction" WHERE userId = \'default\'')[0]?.count ?? 0)

const linuxChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-linux64/chrome')
const windowsChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-win64/chrome.exe')
const chromePath = process.env.FAMS_CHROME_PATH || (existsSync(linuxChrome) ? linuxChrome : windowsChrome)
assert.ok(existsSync(chromePath), `official Chrome for Testing missing: ${chromePath}`)
const linuxRuntimeLib = resolve(repoRoot, '.verification/tools/chrome-for-testing/runtime-libs/root/usr/lib/x86_64-linux-gnu')
const isWindowsChrome = chromePath.endsWith('.exe')
const profilePath = resolve(evidenceDir, 'persistent-chrome-profile')
await mkdir(profilePath, { recursive: true })
const extensionArgPath = isWindowsChrome ? execFileSync('wslpath', ['-w', extensionLoadDir], { encoding: 'utf8' }).trim() : extensionLoadDir
const profileArgPath = isWindowsChrome ? execFileSync('wslpath', ['-w', profilePath], { encoding: 'utf8' }).trim() : profilePath

async function launchChrome() {
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--no-proxy-server', '--host-resolver-rules=MAP localhost [::1]', '--remote-allow-origins=*', '--remote-debugging-port=0',
    `--user-data-dir=${profileArgPath}`, `--disable-extensions-except=${extensionArgPath}`, `--load-extension=${extensionArgPath}`, 'about:blank',
  ]
  const child = spawn(chromePath, args, {
    stdio: ['ignore', 'ignore', 'pipe'],
    env: { ...process.env, ...(isWindowsChrome ? {} : { LD_LIBRARY_PATH: [linuxRuntimeLib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }) },
  })
  let diagnostics = ''
  const endpoint = await new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome CDP timeout: ${diagnostics.slice(-3000)}`)), 30_000)
    child.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString()
      const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) { clearTimeout(timer); resolveEndpoint(match[1]) }
    })
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}: ${diagnostics.slice(-3000)}`)) })
  })
  const browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 })
  const context = browser.contexts()[0]
  assert.ok(context)
  return { child, browser, context, diagnostics: () => diagnostics }
}

async function waitForWorker(context) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      if (!worker.url().startsWith('chrome-extension://')) continue
      try {
        const manifest = await worker.evaluate(() => chrome.runtime.getManifest())
        if (manifest?.name === 'FAMS External Brain') return worker
      } catch { /* worker restarted */ }
    }
    await Promise.race([context.waitForEvent('serviceworker', { timeout: 500 }).catch(() => undefined), wait(500)])
  }
  throw new Error('FAMS extension worker missing')
}

async function startServer(extensionId) {
  const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/start-v2-px-acceptance-server.ts'], {
    cwd: backendRoot,
    env: {
      ...process.env, DATABASE_URL: `file:${databasePath}`, FAMS_V2_PX_EXTENSION_IDS: extensionId,
      V2_PX_ACCEPTANCE_HOST: '::1', NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`acceptance server timeout: ${output.slice(-3000)}`)), 40_000)
    const inspect = (chunk) => {
      output += chunk.toString()
      if (output.includes('"status":"ready"')) { clearTimeout(timer); resolveReady() }
    }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`acceptance server exited ${code}: ${output.slice(-3000)}`)) })
  })
  return { child, output: () => output }
}

async function stopChrome(instance) {
  await instance.browser.close().catch(() => undefined)
  instance.child.kill('SIGTERM')
  await Promise.race([new Promise((resolveExit) => instance.child.once('exit', resolveExit)), wait(3_000)])
}

async function waitView(page, view, timeout = 30_000) {
  await page.getByTestId(`view-${view}`).waitFor({ timeout })
  await page.locator('[data-testid="workspace-app"][data-lifecycle-state="ready"], [data-testid="workspace-app"][data-lifecycle-state="empty"]').waitFor({ timeout })
}

async function capture(page, name, viewport) {
  await page.setViewportSize(viewport)
  const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  assert.equal(Math.max(0, layout.scrollWidth - layout.clientWidth), 0, `${name} overflow at ${viewport.width}`)
  const path = resolve(evidenceDir, `${name}-${viewport.width}.png`)
  const buffer = await page.screenshot({ path, fullPage: false, animations: 'disabled' })
  return { name, viewport, path: relative(repoRoot, path).replaceAll('\\', '/'), sha256: sha256(buffer), rootHorizontalOverflowPx: 0 }
}

let chromeOne
let chromeTwo
let server
let tracingStopped = false
const network = []
const consoleEntries = []
const lifecycleChecks = {}
const screenshots = []

function instrumentContext(context, run) {
  context.on('request', (request) => network.push({ run, phase: 'request', method: request.method(), url: request.url(), at: new Date().toISOString() }))
  context.on('response', (response) => network.push({ run, phase: 'response', status: response.status(), url: response.url(), at: new Date().toISOString() }))
  const instrumentPage = (page) => {
    page.on('console', (entry) => consoleEntries.push({ run, type: entry.type(), text: entry.text(), url: page.url() }))
    page.on('pageerror', (error) => consoleEntries.push({ run, type: 'pageerror', text: error.message, url: page.url() }))
  }
  context.pages().forEach(instrumentPage)
  context.on('page', instrumentPage)
}

try {
  chromeOne = await launchChrome()
  instrumentContext(chromeOne.context, 'before_restart')
  const workerOne = await waitForWorker(chromeOne.context)
  const extensionId = new URL(workerOne.url()).host
  assert.match(extensionId, /^[a-p]{32}$/)
  server = await startServer(extensionId)
  const transactionCountBefore = countTransactions()
  await chromeOne.context.tracing.start({ screenshots: true, snapshots: true, sources: false })

  const sidepanel = await chromeOne.context.newPage()
  await sidepanel.setViewportSize({ width: 360, height: 900 })
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
  await sidepanel.getByTestId('sidepanel-current-summary').waitFor({ timeout: 30_000 })
  screenshots.push(await capture(sidepanel, 'sidepanel-recovered', { width: 360, height: 900 }))
  screenshots.push(await capture(sidepanel, 'sidepanel-recovered', { width: 420, height: 900 }))

  const workspacePromise = chromeOne.context.waitForEvent('page', { timeout: 10_000 })
  await sidepanel.getByRole('button', { name: '在完整工作台打开' }).click()
  const workspace = await workspacePromise
  await workspace.waitForLoadState('domcontentloaded')
  await waitView(workspace, 'source_library')
  const operationCard = workspace.locator('[data-source-ref]').filter({ hasText: '任务产物' }).first()
  await operationCard.waitFor()
  const sourceRef = await operationCard.getAttribute('data-source-ref')
  assert.ok(sourceRef)
  const operationId = sourceRef.split(':')[1]
  assert.match(operationId, /^[0-9a-f-]{36}$/)
  await operationCard.getByRole('button', { name: '查看详情' }).click()
  await waitView(workspace, 'source_detail')
  await workspace.getByRole('button', { name: '来源库' }).click()
  await waitView(workspace, 'source_library')
  await workspace.locator(`[data-source-ref="${sourceRef}"]`).getByRole('button', { name: '任务追踪' }).click()
  await waitView(workspace, 'trace')
  const traceUrl = workspace.url()
  assert.equal(new URL(traceUrl).searchParams.get('ref'), operationId)

  await workspace.goBack({ waitUntil: 'domcontentloaded' })
  await waitView(workspace, 'source_library')
  lifecycleChecks.back = { status: 'restored', url: workspace.url() }
  await workspace.goForward({ waitUntil: 'domcontentloaded' })
  await waitView(workspace, 'trace')
  lifecycleChecks.forward = { status: 'restored', url: workspace.url() }
  const reloadStartedAt = Date.now()
  await workspace.reload({ waitUntil: 'domcontentloaded' })
  await waitView(workspace, 'trace')
  lifecycleChecks.refresh = { status: 'restored', visibleMs: Date.now() - reloadStartedAt, url: workspace.url() }
  assert.ok(lifecycleChecks.refresh.visibleMs <= 5_000)
  screenshots.push(await capture(workspace, 'workspace-refresh-trace', { width: 768, height: 900 }))

  await workspace.close()
  const reopenPromise = chromeOne.context.waitForEvent('page', { timeout: 10_000 }).catch(async (error) => {
    const diagnostics = {
      sidepanelText: await sidepanel.locator('main').innerText().catch(() => 'unavailable'),
      playwrightPages: chromeOne.context.pages().map((page) => ({ url: page.url(), closed: page.isClosed() })),
      chromeTabs: await workerOne.evaluate(async () => (await chrome.tabs.query({})).map((tab) => ({ id: tab.id, url: tab.url, status: tab.status }))),
      server: server?.output(),
    }
    throw new Error(`close/reopen did not create a visible Workspace page: ${JSON.stringify(diagnostics)}\n${error.stack}`)
  })
  await sidepanel.getByRole('button', { name: '在完整工作台打开' }).click()
  const reopened = await reopenPromise
  await reopened.waitForLoadState('domcontentloaded')
  await waitView(reopened, 'trace')
  assert.equal(new URL(reopened.url()).searchParams.get('ref'), operationId)
  lifecycleChecks.closeReopen = { status: 'restored', workspaceId: new URL(reopened.url()).searchParams.get('workspaceId'), ref: operationId }
  await reopened.close()

  const storageBeforeRestart = await workerOne.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }))
  assert.equal(storageBeforeRestart.local.recoveryIndex[0].schemaVersion, 'v2-px-recovery-index/2')
  const tracePath = resolve(evidenceDir, 'px5-01-navigation-trace.zip')
  await chromeOne.context.tracing.stop({ path: tracePath })
  tracingStopped = true
  await stopChrome(chromeOne)
  chromeOne = null

  chromeTwo = await launchChrome()
  instrumentContext(chromeTwo.context, 'after_restart')
  const workerTwo = await waitForWorker(chromeTwo.context)
  assert.equal(new URL(workerTwo.url()).host, extensionId, 'extension ID changed across same-profile restart')
  const sessionBeforeOpen = await workerTwo.evaluate(async () => chrome.storage.session.get(null))
  assert.equal(Object.keys(sessionBeforeOpen).length, 0, 'chrome.storage.session survived full Chrome restart')
  const restartStartedAt = Date.now()
  const restartedSidepanel = await chromeTwo.context.newPage()
  await restartedSidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
  await restartedSidepanel.getByTestId('sidepanel-current-summary').waitFor({ timeout: 5_000 })
  const restoredPromise = chromeTwo.context.waitForEvent('page', { timeout: 10_000 })
  await restartedSidepanel.getByRole('button', { name: '在完整工作台打开' }).click()
  const restored = await restoredPromise
  await restored.waitForLoadState('domcontentloaded')
  await waitView(restored, 'trace')
  assert.equal(new URL(restored.url()).searchParams.get('ref'), operationId)
  lifecycleChecks.chromeRestart = { status: 'restored', visibleMs: Date.now() - restartStartedAt, sessionWasEmpty: true }
  assert.ok(lifecycleChecks.chromeRestart.visibleMs <= 5_000)
  screenshots.push(await capture(restored, 'workspace-chrome-restart', { width: 1280, height: 900 }))

  await restored.close()
  await restartedSidepanel.close()
  await wait(250)
  const v2Record = (await workerTwo.evaluate(async () => chrome.storage.local.get('recoveryIndex'))).recoveryIndex[0]
  const v1Record = { ...v2Record, schemaVersion: 'v2-px-recovery-index/1' }
  delete v1Record.activeGraph
  await workerTwo.evaluate(async (record) => {
    await chrome.storage.local.set({ recoveryIndex: [record] })
    await chrome.storage.session.clear()
  }, v1Record)
  const migratedPage = await chromeTwo.context.newPage()
  await migratedPage.goto(traceUrl, { waitUntil: 'domcontentloaded' })
  await waitView(migratedPage, 'trace')
  const migrationStorage = await workerTwo.evaluate(async () => ({ local: await chrome.storage.local.get('recoveryIndex'), session: await chrome.storage.session.get(null) }))
  assert.equal(migrationStorage.local.recoveryIndex[0].schemaVersion, 'v2-px-recovery-index/2')
  assert.ok(migrationStorage.session.lifecycleEvents.some((event) => event.eventType === 'state_migrated'))
  lifecycleChecks.v1Migration = { status: 'restored', eventType: 'state_migrated', targetVersion: 2 }
  await migratedPage.close()
  await wait(250)

  const unknownRaw = [{ schemaVersion: 'v2-px-recovery-index/99', opaque: { preserve: 'byte-equivalent' } }]
  await workerTwo.evaluate(async (raw) => {
    await chrome.storage.local.set({ recoveryIndex: raw })
    await chrome.storage.session.clear()
  }, unknownRaw)
  const blockedStartedAt = Date.now()
  const blockedPage = await chromeTwo.context.newPage()
  await blockedPage.goto(traceUrl, { waitUntil: 'domcontentloaded' })
  await blockedPage.locator('[data-testid="workspace-app"][data-ui-state="blocked"]').waitFor({ timeout: 5_000 })
  const unknownAfter = await workerTwo.evaluate(async () => ({ local: await chrome.storage.local.get('recoveryIndex'), session: await chrome.storage.session.get(null) }))
  assert.deepEqual(unknownAfter.local.recoveryIndex, unknownRaw)
  assert.equal(unknownAfter.session.workspaceStates[workspaceId].recovery.reasonCode, 'PX_STORAGE_VERSION_UNSUPPORTED')
  lifecycleChecks.unknownMajor = { status: 'blocked', visibleMs: Date.now() - blockedStartedAt, rawPreserved: true }
  screenshots.push(await capture(blockedPage, 'workspace-unknown-major-blocked', { width: 768, height: 900 }))

  const storageText = JSON.stringify(unknownAfter)
  assert.equal(/authorization|cookie|password|rawScreenshot|accountImage/i.test(storageText), false)
  const forbiddenRequests = network.filter((item) => item.phase === 'request' && /broker|order-create|\/orders(?:\?|$)|auto-trade/i.test(item.url))
  assert.deepEqual(forbiddenRequests, [])
  assert.equal(countTransactions(), transactionCountBefore)
  assert.ok(network.filter((item) => item.phase === 'request' && item.method === 'GET' && item.url.includes('/api/v1/external-brain/')).length >= 6)
  assert.equal(network.filter((item) => item.phase === 'request' && item.method === 'POST').length, 0)
  const unexpectedConsole = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror')
  assert.deepEqual(unexpectedConsole, [])

  const report = {
    schemaVersion: 'fams.v2_px.lifecycle_recovery_chrome_evidence.v1', status: 'passed', realData: true,
    commitSha, automationMode: 'official_chrome_for_testing_headless_new_cdp', chromeVersion: await chromeTwo.browser.version(),
    extensionId, extensionVersion: productionManifest.version, database: dataEvidence, lifecycleChecks,
    recoveryIndexVersion: 2, unknownMajorRawPreserved: true, screenshots,
    network: { realExternalBrainGetCount: network.filter((item) => item.phase === 'request' && item.method === 'GET' && item.url.includes('/api/v1/external-brain/')).length, postCount: 0, forbiddenTradingRequestCount: 0 },
    storageContainsSecretLikeFields: false, transactionMutationCount: 0, consoleErrorCount: 0,
    executionBoundary: { researchOnly: true, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    trace: { path: relative(repoRoot, tracePath).replaceAll('\\', '/'), sha256: sha256(await readFile(tracePath)) },
  }
  await writeFile(resolve(evidenceDir, 'lifecycle-recovery-evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'network.json'), `${JSON.stringify(network, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'console.json'), `${JSON.stringify(consoleEntries, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'storage-audit.json'), `${JSON.stringify({ storageBeforeRestart, sessionBeforeOpen, migrationStorage, unknownAfter }, null, 2)}\n`)
  console.log(JSON.stringify({ status: 'passed', evidenceDir, ...report }, null, 2))
} finally {
  if (chromeOne) {
    if (!tracingStopped) await chromeOne.context.tracing.stop().catch(() => undefined)
    await stopChrome(chromeOne)
  }
  if (chromeTwo) await stopChrome(chromeTwo)
  if (server) { server.child.kill('SIGTERM'); await wait(500) }
}
