import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from '@playwright/test'

const OLD_ACCEPTED_COMMIT = '05221ecca4c761a31370ed541d6c4db7f012cc2a'
const workspaceId = 'px-ws-00000000-0000-4000-8000-000000000001'
const staleWorkspaceId = 'px-ws-00000000-0000-4000-8000-000000000002'
const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')
const backendRoot = resolve(repoRoot, 'backend')
const currentOutput = resolve(packageRoot, '.output/chrome-mv3')
const sourceDatabasePath = resolve(backendRoot, 'prisma/dev.db')
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const dirtyScope = execFileSync('git', ['status', '--short', '--',
  'packages/fams-v2-px-extension', 'backend/scripts/start-v2-px-acceptance-server.ts',
  'backend/scripts/verify-v2-px-semantic-contract.ts', 'docs/V2_PX_API_RUNTIME_CONTRACT.md',
  'docs/V2_PX_TARGET_ARCHITECTURE.md', 'docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md',
  'docs/V2_PX_PRD_TRACEABILITY_MATRIX.md', 'docs/current-stage-state.json', 'docs/audits/v2-px',
], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!process.env.V2_PX_ALLOW_DIRTY) assert.equal(dirtyScope, '', `PX5-02 evidence requires committed in-scope files:\n${dirtyScope}`)
assert.ok(existsSync(currentOutput), 'current WXT build output is missing')
assert.ok(existsSync(sourceDatabasePath), 'real FAMS SQLite database is missing')

const wait = (delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs))
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const sha256File = (path) => execFileSync('sha256sum', [path], { encoding: 'utf8' }).split(/\s+/)[0]
const sqlJson = (database, query) => JSON.parse(execFileSync('sqlite3', [database, '-json', query], { encoding: 'utf8' }) || '[]')
const tempRoot = await mkdtemp(resolve(tmpdir(), 'fams-v2-px-px5-02-'))
const evidenceDir = resolve(repoRoot, '.verification/private/v2-px', commitSha, process.env.V2_PX_ALLOW_DIRTY ? 'PX5-02-dev' : 'PX5-02')
await mkdir(evidenceDir, { recursive: true })

const databasePath = resolve(tempRoot, 'real-data-snapshot.db')
execFileSync('sqlite3', [sourceDatabasePath, `.backup '${databasePath.replaceAll("'", "''")}'`])
assert.equal(execFileSync('sqlite3', [databasePath, 'PRAGMA quick_check;'], { encoding: 'utf8' }).trim(), 'ok')
const activeOperation = sqlJson(databasePath, `SELECT id,status,type,progressPct FROM "Operation" WHERE userId='default' AND status IN ('queued','running','cancelling') ORDER BY requestedAt DESC LIMIT 1`)[0]
assert.ok(activeOperation?.id, 'real SQLite snapshot has no active Operation; high-risk creation is not authorized')
const operationId = activeOperation.id
const transactionCount = () => Number(sqlJson(databasePath, `SELECT COUNT(*) count FROM "Transaction" WHERE userId='default'`)[0]?.count ?? 0)
const transactionCountBefore = transactionCount()
const dataEvidence = {
  sourcePath: relative(repoRoot, sourceDatabasePath).replaceAll('\\', '/'), sourceSizeBytes: statSync(sourceDatabasePath).size,
  sourceSha256: sha256File(sourceDatabasePath), snapshotSizeBytes: statSync(databasePath).size, snapshotSha256: sha256File(databasePath),
  activeOperation,
}

async function buildOldAcceptedExtension() {
  const archivePath = resolve(tempRoot, 'old-extension.tar')
  const checkoutRoot = resolve(tempRoot, 'old-checkout')
  await mkdir(checkoutRoot, { recursive: true })
  execFileSync('git', ['archive', '--format=tar', `--output=${archivePath}`, OLD_ACCEPTED_COMMIT, 'packages/fams-v2-px-extension'], { cwd: repoRoot })
  execFileSync('tar', ['-xf', archivePath, '-C', checkoutRoot])
  const oldPackage = resolve(checkoutRoot, 'packages/fams-v2-px-extension')
  await symlink(resolve(packageRoot, 'node_modules'), resolve(oldPackage, 'node_modules'), 'dir')
  execFileSync('npm', ['run', 'build'], {
    cwd: oldPackage, env: { ...process.env, VITE_V2_PX_COMMIT_SHA: OLD_ACCEPTED_COMMIT }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = resolve(oldPackage, '.output/chrome-mv3')
  assert.ok(existsSync(output))
  return output
}

const extensionLoadDir = resolve(tempRoot, 'acceptance-extension')
async function installAcceptanceBuild(output, expectedVersion) {
  await rm(extensionLoadDir, { recursive: true, force: true })
  await cp(output, extensionLoadDir, { recursive: true })
  const manifestPath = resolve(extensionLoadDir, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.version, expectedVersion)
  assert.deepEqual(manifest.host_permissions ?? [], [])
  assert.deepEqual((manifest.optional_host_permissions ?? []).sort(), ['http://127.0.0.1:4000/*', 'http://localhost:4000/*'].sort())
  assert.equal(manifest.permissions.includes('alarms'), false)
  assert.equal(manifest.permissions.includes('scripting'), false)
  assert.equal(JSON.stringify(manifest).includes('<all_urls>'), false)
  const acceptance = { ...manifest, host_permissions: [...manifest.optional_host_permissions], optional_host_permissions: [] }
  await writeFile(manifestPath, `${JSON.stringify(acceptance)}\n`)
  return { production: manifest, acceptance }
}

const oldOutput = await buildOldAcceptedExtension()
const oldManifest = await installAcceptanceBuild(oldOutput, '0.1.0')
const linuxChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-linux64/chrome')
const windowsChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-win64/chrome.exe')
const chromePath = process.env.FAMS_CHROME_PATH || (existsSync(linuxChrome) ? linuxChrome : windowsChrome)
assert.ok(existsSync(chromePath), `official Chrome for Testing missing: ${chromePath}`)
const linuxRuntimeLib = resolve(repoRoot, '.verification/tools/chrome-for-testing/runtime-libs/root/usr/lib/x86_64-linux-gnu')
const isWindowsChrome = chromePath.endsWith('.exe')
const profilePath = resolve(tempRoot, 'persistent-profile')
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
  await context.addInitScript(() => {
    globalThis.__pxOperationPollMessages = []
    if (!globalThis.chrome?.runtime?.sendMessage) return
    const originalSendMessage = chrome.runtime.sendMessage.bind(chrome.runtime)
    chrome.runtime.sendMessage = (...args) => {
      const message = args[0]
      if (message?.messageType === 'operation_poll') {
        const record = { message: structuredClone(message), sentAt: new Date().toISOString(), result: null }
        globalThis.__pxOperationPollMessages.push(record)
        const pending = originalSendMessage(...args)
        Promise.resolve(pending).then(
          (result) => { record.result = structuredClone(result) },
          (error) => { record.result = { rejected: String(error) } },
        )
        return pending
      }
      return originalSendMessage(...args)
    }
  })
  return { child, browser, context }
}

async function stopChrome(instance) {
  await instance.browser.close().catch(() => undefined)
  instance.child.kill('SIGTERM')
  await Promise.race([new Promise((resolveExit) => instance.child.once('exit', resolveExit)), wait(3_000)])
}

async function waitForWorker(context, expectedVersion, expectedUrl = null, excludedWorker = null) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      if (worker === excludedWorker || !worker.url().startsWith('chrome-extension://') || (expectedUrl && worker.url() !== expectedUrl)) continue
      try {
        const manifest = await Promise.race([
          worker.evaluate(() => chrome.runtime.getManifest()),
          wait(500).then(() => { throw new Error('worker evaluate timeout') }),
        ])
        if (manifest?.name === 'FAMS External Brain' && manifest.version === expectedVersion) return worker
      } catch { /* terminated target */ }
    }
    await Promise.race([context.waitForEvent('serviceworker', { timeout: 300 }).catch(() => undefined), wait(300)])
  }
  throw new Error(`FAMS extension worker ${expectedVersion} missing`)
}

async function startServer(extensionId) {
  const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'scripts/start-v2-px-acceptance-server.ts'], {
    cwd: backendRoot,
    env: { ...process.env, DATABASE_URL: `file:${databasePath}`, FAMS_V2_PX_EXTENSION_IDS: extensionId, V2_PX_ACCEPTANCE_HOST: '::1', NO_PROXY: 'localhost,127.0.0.1,::1', no_proxy: 'localhost,127.0.0.1,::1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let output = ''
  await new Promise((resolveReady, reject) => {
    const timer = setTimeout(() => reject(new Error(`acceptance server timeout: ${output.slice(-3000)}`)), 40_000)
    const inspect = (chunk) => { output += chunk.toString(); if (output.includes('"status":"ready"')) { clearTimeout(timer); resolveReady() } }
    child.stdout.on('data', inspect); child.stderr.on('data', inspect)
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`acceptance server exited ${code}: ${output.slice(-3000)}`)) })
  })
  return { child, output: () => output }
}

async function stopServer(server) {
  if (!server) return
  server.child.kill('SIGTERM')
  await Promise.race([new Promise((resolveExit) => server.child.once('exit', resolveExit)), wait(3_000)])
}

async function waitUntil(check, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  let last
  while (Date.now() < deadline) {
    try { last = await check(); if (last) return last } catch (error) { last = error }
    await wait(100)
  }
  throw new Error(`${label} timeout: ${String(last)}`)
}

const network = []
const consoleEntries = []
function instrument(context, run) {
  context.on('request', (request) => network.push({ run, method: request.method(), url: request.url(), epochMs: Date.now(), at: new Date().toISOString() }))
  const attach = (page) => {
    page.on('console', (entry) => consoleEntries.push({ run, type: entry.type(), text: entry.text(), url: page.url() }))
    page.on('pageerror', (error) => consoleEntries.push({ run, type: 'pageerror', text: error.message, url: page.url() }))
  }
  const attachWorker = (worker) => {
    worker.on('console', (entry) => consoleEntries.push({ run, type: entry.type(), text: entry.text(), url: worker.url() }))
  }
  context.pages().forEach(attach); context.on('page', attach)
  context.serviceWorkers().forEach(attachWorker); context.on('serviceworker', attachWorker)
}

async function seedRecovery(worker) {
  const now = new Date()
  await worker.evaluate(async ({ workspaceId: id, operationId: op, nowIso, expiresAt }) => {
    await chrome.storage.local.set({ recoveryIndex: [{ schemaVersion: 'v2-px-recovery-index/2', workspaceId: id, currentView: 'trace', operationId: op, updatedAt: nowIso, expiresAt }] })
    await chrome.storage.session.clear()
  }, { workspaceId, operationId, nowIso: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString() })
}

async function openContainers(context, extensionId) {
  const sidepanel = await context.newPage()
  await waitUntil(async () => {
    try {
      await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded', timeout: 2_000 })
      return true
    } catch { return false }
  }, 10_000, 'extension page available after update')
  await sidepanel.getByTestId('sidepanel-current-summary').waitFor({ timeout: 5_000 })
  const workspacePromise = context.waitForEvent('page', { timeout: 10_000 })
  await sidepanel.getByRole('button', { name: '在完整工作台打开' }).click()
  const workspace = await workspacePromise
  await workspace.waitForLoadState('domcontentloaded')
  await workspace.getByTestId('view-trace').waitFor({ timeout: 5_000 })
  await workspace.locator('[data-testid="workspace-app"][data-lifecycle-state="ready"]').waitFor({ timeout: 5_000 })
  assert.equal(new URL(workspace.url()).searchParams.get('ref'), operationId)
  return { sidepanel, workspace }
}

async function capture(page, name, viewport) {
  await page.setViewportSize(viewport)
  const layout = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))
  assert.equal(Math.max(0, layout.scrollWidth - layout.clientWidth), 0, `${name} horizontal overflow`)
  const path = resolve(evidenceDir, `${name}.png`)
  const buffer = await page.screenshot({ path, animations: 'disabled' })
  return { path: relative(repoRoot, path).replaceAll('\\', '/'), viewport, sha256: sha256(buffer), horizontalOverflowPx: 0 }
}

async function terminateServiceWorker(instance, extensionId) {
  const session = await instance.browser.newBrowserCDPSession()
  const targets = await session.send('Target.getTargets')
  const target = targets.targetInfos.find((item) => item.type === 'service_worker' && item.url.startsWith(`chrome-extension://${extensionId}/`))
  assert.ok(target?.targetId, 'service worker CDP target missing')
  await session.send('Target.closeTarget', { targetId: target.targetId })
  await session.detach()
  return target.targetId
}

let chromeOld
let chromeCurrent
let server
let tracing = false
const checks = {}
const screenshots = []
try {
  chromeOld = await launchChrome()
  instrument(chromeOld.context, 'version_0_1_0')
  const oldWorker = await waitForWorker(chromeOld.context, '0.1.0')
  const extensionId = new URL(oldWorker.url()).host
  assert.match(extensionId, /^[a-p]{32}$/)
  server = await startServer(extensionId)
  await seedRecovery(oldWorker)
  const oldContainers = await openContainers(chromeOld.context, extensionId)
  screenshots.push(await capture(oldContainers.workspace, 'before-update-0.1.0', { width: 768, height: 900 }))
  const oldStorage = await oldWorker.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) }))
  assert.equal(oldStorage.local.recoveryIndex[0].operationId, operationId)
  await stopChrome(chromeOld); chromeOld = null
  for (const cachePath of [
    resolve(profilePath, 'Default/Service Worker'),
    resolve(profilePath, 'Default/Code Cache/js'),
  ]) await rm(cachePath, { recursive: true, force: true })

  const currentManifest = await installAcceptanceBuild(currentOutput, '0.2.0')
  assert.deepEqual(currentManifest.production.permissions, oldManifest.production.permissions)
  assert.deepEqual(currentManifest.production.optional_host_permissions, oldManifest.production.optional_host_permissions)
  chromeCurrent = await launchChrome()
  instrument(chromeCurrent.context, 'version_0_2_0')
  const workerUrl = `chrome-extension://${extensionId}/background.js`
  let worker = await waitForWorker(chromeCurrent.context, '0.2.0', workerUrl)
  assert.equal(new URL(worker.url()).host, extensionId, 'extension ID changed during unpacked update')
  const sessionAfterUpdate = await worker.evaluate(async () => chrome.storage.session.get(null))
  assert.equal(Object.keys(sessionAfterUpdate).length, 0, 'session storage survived full Chrome update restart')
  const updateStartedAt = Date.now()
  const pollingStartedAt = Date.now()
  const containers = await openContainers(chromeCurrent.context, extensionId)
  checks.update = { from: '0.1.0', to: '0.2.0', extensionIdStable: true, unpackedWorkerCacheInvalidated: true, restoredMs: Date.now() - updateStartedAt, sessionWasEmpty: true }
  assert.ok(checks.update.restoredMs <= 5_000)
  screenshots.push(await capture(containers.workspace, 'after-update-0.2.0', { width: 1280, height: 900 }))
  await chromeCurrent.context.tracing.start({ screenshots: true, snapshots: true, sources: false }); tracing = true

  const traceUrlPart = `/api/v1/external-brain/traces/${operationId}`
  await waitUntil(() => network.filter((item) => item.run === 'version_0_2_0' && item.method === 'GET' && item.url.includes(traceUrlPart) && item.epochMs >= pollingStartedAt).length >= 5, 30_000, 'four bounded Operation polls').catch(async (error) => {
    const diagnostics = {
      traceRequests: network.filter((item) => item.url.includes(traceUrlPart)),
      storage: await worker.evaluate(async () => chrome.storage.session.get(null)).catch(() => null),
      server: server?.output(),
      workspaceText: await containers.workspace.locator('main').innerText().catch(() => 'unavailable'),
      operationPollMessages: await containers.workspace.evaluate(() => globalThis.__pxOperationPollMessages ?? null).catch(() => null),
      consoleEntries,
    }
    throw new Error(`${error.message}\n${JSON.stringify(diagnostics)}`)
  })
  const traceRequests = network.filter((item) => item.run === 'version_0_2_0' && item.method === 'GET' && item.url.includes(traceUrlPart) && item.epochMs >= pollingStartedAt).slice(0, 5)
  const observedIntervalsMs = traceRequests.slice(1).map((item, index) => item.epochMs - traceRequests[index].epochMs)
  for (const [index, expected] of [2_000, 4_000, 8_000, 10_000].entries()) assert.ok(Math.abs(observedIntervalsMs[index] - expected) <= 1_200, `poll interval ${index} drifted: ${observedIntervalsMs[index]}`)
  const boundedCount = traceRequests.length
  await wait(2_500)
  assert.equal(network.filter((item) => item.run === 'version_0_2_0' && item.method === 'GET' && item.url.includes(traceUrlPart) && item.epochMs >= pollingStartedAt).length, boundedCount)
  const operationPollMessages = await waitUntil(async () => {
    const records = await containers.workspace.evaluate(() => globalThis.__pxOperationPollMessages ?? [])
    return records.length === 1 && records[0]?.result ? records : null
  }, 2_000, 'single operation_poll response')
  assert.equal(operationPollMessages[0].result.status, 'completed')
  checks.operationPolling = { operationId, realStatus: activeOperation.status, controlMessageCount: 1, observedIntervalsMs, boundedGetCount: 4, stoppedAfterFourth: true }

  await containers.workspace.reload({ waitUntil: 'domcontentloaded' })
  await containers.workspace.getByTestId('view-trace').waitFor({ timeout: 5_000 })
  const disconnectedStartedAt = Date.now()
  await stopServer(server); server = null
  await containers.workspace.locator('[data-testid="workspace-app"][data-lifecycle-state="disconnected"]').waitFor({ timeout: 5_000 })
  checks.famsDisconnect = { visibleMs: Date.now() - disconnectedStartedAt, state: 'disconnected' }
  assert.ok(checks.famsDisconnect.visibleMs <= 5_000)
  server = await startServer(extensionId)
  const reconnectStartedAt = Date.now()
  await containers.sidepanel.getByRole('button', { name: '重新读取' }).click()
  await containers.workspace.locator('[data-testid="workspace-app"][data-lifecycle-state="ready"]').waitFor({ timeout: 5_000 })
  checks.famsReconnect = { visibleMs: Date.now() - reconnectStartedAt, state: 'ready' }
  assert.ok(checks.famsReconnect.visibleMs <= 5_000)

  const beforeStale = await worker.evaluate(async () => chrome.storage.session.get(null))
  const beforeWorkerEventCount = beforeStale.lifecycleEvents.filter((event) => event.workspaceId === workspaceId).length
  const staleAt = new Date(Date.now() - 6 * 60 * 1000).toISOString()
  const eventBase = {
    schemaVersion: 'v2-px-lifecycle-event/3', workspaceId: staleWorkspaceId,
    routeId: 'px-route-stalelease00000001', correlationId: 'px-corr-stalelease00000001',
    containerInstanceId: 'px-container-stalelease000001', storageVersion: 1,
  }
  await worker.evaluate(async ({ staleWorkspaceId: id, state, events, eventBase: base, staleAt: at }) => {
    const start = { ...base, eventId: 'px-event-stalelease00000001', sequence: 1, container: 'workspace_page', eventType: 'start', previousState: 'uninitialized', nextState: 'connecting', at }
    const ready = { ...base, eventId: 'px-event-stalelease00000002', sequence: 2, container: 'background', eventType: 'load_succeeded', previousState: 'connecting', nextState: 'ready', at }
    await chrome.storage.session.set({
      workspaceStates: { ...state, [id]: { schemaVersion: 'v2-px-workspace-state/1', workspaceId: id, lifecycleStatus: 'ready', currentView: 'source_library', routeId: base.routeId, correlationId: base.correlationId, connection: { status: 'connected' }, recovery: { status: 'not_needed' }, containerLeases: [{ container: 'workspace_page', instanceId: base.containerInstanceId, lastSeenAt: at }], lastEventSeq: 2, updatedAt: at } },
      lifecycleEvents: [...events, start, ready],
    })
  }, { staleWorkspaceId, state: beforeStale.workspaceStates, events: beforeStale.lifecycleEvents, eventBase, staleAt })

  const workerSuspendStartedAt = Date.now()
  const terminatedTargetId = await terminateServiceWorker(chromeCurrent, extensionId)
  worker = await waitForWorker(chromeCurrent.context, '0.2.0', workerUrl)
  const recoveredAfterWorker = await waitUntil(async () => {
    const value = await worker.evaluate(async () => chrome.storage.session.get(null))
    const workspaceEvents = value.lifecycleEvents?.filter((event) => event.workspaceId === workspaceId) ?? []
    const workerReconnected = workspaceEvents.length > beforeWorkerEventCount && workspaceEvents.slice(beforeWorkerEventCount).some((event) => event.eventType === 'reconnect')
    return value.workspaceStates?.[workspaceId]?.lifecycleStatus === 'ready'
      && value.workspaceStates?.[staleWorkspaceId]?.lifecycleStatus === 'closed'
      && workerReconnected ? value : null
  }, 5_000, 'worker recovery and stale lease close').catch(async (error) => {
    const diagnostics = {
      storage: await worker.evaluate(async () => chrome.storage.session.get(null)).catch(() => null),
      workspaceLifecycleState: await containers.workspace.getAttribute('[data-testid="workspace-app"]', 'data-lifecycle-state').catch(() => null),
      sidepanelText: await containers.sidepanel.locator('main').innerText().catch(() => null),
      workspacePollMessages: await containers.workspace.evaluate(() => globalThis.__pxOperationPollMessages ?? null).catch(() => null),
      workers: chromeCurrent.context.serviceWorkers().map((candidate) => candidate.url()),
    }
    throw new Error(`${error.message}\n${JSON.stringify(diagnostics)}`)
  })
  checks.workerSuspend = { terminatedTargetId, restoredMs: Date.now() - workerSuspendStartedAt, state: 'ready', reconnectEventObserved: true }
  assert.ok(checks.workerSuspend.restoredMs <= 5_000)
  assert.ok(recoveredAfterWorker.lifecycleEvents.some((event) => event.workspaceId === staleWorkspaceId && event.eventType === 'lease_expired' && event.nextState === 'closed'))
  checks.staleLease = { thresholdMinutes: 5, seededAgeMinutes: 6, state: 'closed', eventType: 'lease_expired' }

  const leasesBeforeClose = (await worker.evaluate(async () => chrome.storage.session.get('workspaceStates'))).workspaceStates[workspaceId].containerLeases
  assert.equal(leasesBeforeClose.length, 2)
  await containers.workspace.close()
  const afterOneClose = await waitUntil(async () => {
    const value = (await worker.evaluate(async () => chrome.storage.session.get('workspaceStates'))).workspaceStates[workspaceId]
    return value?.containerLeases?.length === 1 ? value : null
  }, 5_000, 'one live container lease')
  assert.notEqual(afterOneClose.lifecycleStatus, 'closed')
  await containers.sidepanel.close()
  const afterLastClose = await waitUntil(async () => {
    const value = await worker.evaluate(async () => chrome.storage.session.get(null))
    return value.workspaceStates?.[workspaceId]?.lifecycleStatus === 'closed' ? value : null
  }, 5_000, 'last container close')
  const getCountAtClose = network.filter((item) => item.method === 'GET' && item.url.includes(traceUrlPart)).length
  await wait(3_000)
  assert.equal(network.filter((item) => item.method === 'GET' && item.url.includes(traceUrlPart)).length, getCountAtClose)
  assert.ok(afterLastClose.lifecycleEvents.some((event) => event.workspaceId === workspaceId && event.eventType === 'close' && event.nextState === 'closed'))
  checks.containerLease = { beforeClose: 2, afterOneClose: 1, afterLastClose: 0, finalState: 'closed', newGetsAfterLastClose: 0 }

  const lifecycleEvents = afterLastClose.lifecycleEvents.filter((event) => event.workspaceId === workspaceId)
  for (let index = 0; index < lifecycleEvents.length; index += 1) {
    assert.equal(lifecycleEvents[index].sequence, index + 1)
    if (index > 0) assert.equal(lifecycleEvents[index].previousState, lifecycleEvents[index - 1].nextState)
  }
  assert.ok(lifecycleEvents.some((event) => event.eventType === 'connection_lost' && event.nextState === 'disconnected'))
  assert.ok(lifecycleEvents.some((event) => event.eventType === 'reconnect' && event.nextState === 'recovering'))
  const forbidden = network.filter((item) => /broker|order-create|\/orders(?:\?|$)|auto-trade/i.test(item.url))
  assert.deepEqual(forbidden, [])
  assert.equal(network.filter((item) => item.method === 'POST').length, 0)
  assert.equal(transactionCount(), transactionCountBefore)
  const unexpectedConsole = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror')
  assert.deepEqual(unexpectedConsole, [])
  assert.equal(JSON.stringify(afterLastClose).match(/authorization|cookie|password|rawScreenshot|accountImage/gi), null)

  const tracePath = resolve(evidenceDir, 'px5-02-interruption-trace.zip')
  await chromeCurrent.context.tracing.stop({ path: tracePath }); tracing = false
  const report = {
    schemaVersion: 'fams.v2_px.lifecycle_interruption_chrome_evidence.v1', status: 'passed', realData: true,
    commitSha, chromeVersion: await chromeCurrent.browser.version(), extensionId, versions: { from: '0.1.0', to: '0.2.0' },
    database: dataEvidence, checks, screenshots,
    network: { getCount: network.filter((item) => item.method === 'GET').length, postCount: 0, forbiddenTradingRequestCount: 0 },
    lifecycleEventCount: lifecycleEvents.length, consoleErrorCount: 0, transactionMutationCount: 0, secretLikeStorageFields: 0,
    manifest: { permissionsStable: true, alarms: false, scripting: false, allUrls: false },
    executionBoundary: { researchOnly: true, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
    trace: { path: relative(repoRoot, tracePath).replaceAll('\\', '/'), sha256: sha256(await readFile(tracePath)) },
  }
  await writeFile(resolve(evidenceDir, 'lifecycle-interruption-evidence.json'), `${JSON.stringify(report, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'network.json'), `${JSON.stringify(network, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'console.json'), `${JSON.stringify(consoleEntries, null, 2)}\n`)
  await writeFile(resolve(evidenceDir, 'lifecycle-storage.json'), `${JSON.stringify(afterLastClose, null, 2)}\n`)
  console.log(JSON.stringify({ status: 'passed', evidenceDir, ...report }, null, 2))
} finally {
  if (chromeOld) await stopChrome(chromeOld)
  if (chromeCurrent) {
    if (tracing) await chromeCurrent.context.tracing.stop().catch(() => undefined)
    await stopChrome(chromeCurrent)
  }
  await stopServer(server)
}
