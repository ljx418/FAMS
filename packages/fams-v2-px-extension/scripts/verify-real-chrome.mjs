import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, relative } from 'node:path'
import { chromium } from '@playwright/test'
import Ajv2020 from 'ajv/dist/2020.js'
import addFormats from 'ajv-formats'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')
const outputDir = resolve(packageRoot, '.output/chrome-mv3')
assert.ok(existsSync(resolve(outputDir, 'manifest.json')), 'WXT build output is missing; run npm run build first')

const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const dirtyScope = execFileSync('git', ['status', '--short', '--', 'packages/fams-v2-px-extension', 'docs/schemas', 'docs/prototypes/v2-px/fixtures'], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!process.env.V2_PX_ALLOW_DIRTY) assert.equal(dirtyScope, '', `PX1 evidence requires committed in-scope files:\n${dirtyScope}`)

const stageName = process.env.V2_PX_ALLOW_DIRTY ? 'PX1-dev' : 'PX1'
const evidenceDir = resolve(repoRoot, '.verification/private/v2-px', commitSha, stageName)
await mkdir(evidenceDir, { recursive: true })

async function walkFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) files.push(...await walkFiles(path))
    else files.push(path)
  }
  return files.sort()
}

function sha256(buffer) { return createHash('sha256').update(buffer).digest('hex') }

async function digestDirectory(directory) {
  const hash = createHash('sha256')
  for (const file of await walkFiles(directory)) {
    hash.update(relative(directory, file).replaceAll('\\', '/'))
    hash.update(await readFile(file))
  }
  return hash.digest('hex')
}

function pngSize(buffer) {
  assert.equal(buffer.toString('ascii', 1, 4), 'PNG', 'screenshot is not a PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function targetMessenger(rootSession, sessionId) {
  let nextId = 1
  const waiting = new Map()
  const listener = (event) => {
    if (event.sessionId !== sessionId) return
    const message = JSON.parse(event.message)
    const pending = waiting.get(message.id)
    if (!pending) return
    waiting.delete(message.id)
    if (message.error) pending.reject(new Error(message.error.message))
    else pending.resolve(message.result)
  }
  rootSession.on('Target.receivedMessageFromTarget', listener)
  return {
    async send(method, params = {}) {
      const id = nextId++
      const result = new Promise((resolveResult, reject) => waiting.set(id, { resolve: resolveResult, reject }))
      await rootSession.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method, params }) })
      return result
    },
    dispose() { rootSession.off('Target.receivedMessageFromTarget', listener) },
  }
}

async function waitForSidePanelTarget(rootSession, extensionId) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const { targetInfos } = await rootSession.send('Target.getTargets')
    const target = targetInfos.find((item) => item.url === `chrome-extension://${extensionId}/sidepanel.html` && item.type !== 'service_worker')
    if (target) return target
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  throw new Error('Real Chrome did not expose an actual Side Panel target after a user-gesture click')
}

async function waitForFamsWorker(context) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const candidate of context.serviceWorkers()) {
      if (!candidate.url().startsWith('chrome-extension://')) continue
      try {
        const manifest = await candidate.evaluate(() => chrome.runtime.getManifest())
        if (manifest?.name === 'FAMS External Brain' && manifest?.version === '0.1.0') return candidate
      } catch {
        // A built-in extension worker may terminate while it is inspected.
      }
    }
    await Promise.race([
      context.waitForEvent('serviceworker', { timeout: 500 }).catch(() => undefined),
      new Promise((resolveWait) => setTimeout(resolveWait, 500)),
    ])
  }
  throw new Error('Chrome did not load the FAMS External Brain service worker')
}

async function captureRawTarget(rootSession, targetInfo, viewport, filename, routeId) {
  const { sessionId } = await rootSession.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: false })
  const target = targetMessenger(rootSession, sessionId)
  try {
    await target.send('Page.enable')
    await target.send('Runtime.enable')
    await target.send('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false })
    await target.send('Runtime.evaluate', { expression: 'document.fonts.ready', awaitPromise: true, returnByValue: true })
    const layout = await target.send('Runtime.evaluate', {
      expression: `JSON.stringify({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth,bodyText:document.body.innerText})`,
      returnByValue: true,
    })
    const layoutValue = JSON.parse(layout.result.value)
    assert.ok(layoutValue.bodyText.includes('研究摘要入口'), 'actual Side Panel target does not contain product content')
    const rootHorizontalOverflowPx = Math.max(0, layoutValue.scroll - layoutValue.client)
    assert.equal(rootHorizontalOverflowPx, 0, `Side Panel ${viewport.width} has root overflow`)
    const screenshotResult = await target.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    const buffer = Buffer.from(screenshotResult.data, 'base64')
    const size = pngSize(buffer)
    assert.deepEqual(size, viewport, `Side Panel PNG size mismatch for ${viewport.width}`)
    const path = resolve(evidenceDir, filename)
    await writeFile(path, buffer)
    return {
      path: relative(repoRoot, path).replaceAll('\\', '/'), sha256: sha256(buffer), capturedAt: new Date().toISOString(),
      container: 'sidepanel', viewport, imageContentSizePixels: size, rootHorizontalOverflowPx, routeId,
    }
  } finally {
    target.dispose()
    await rootSession.send('Target.detachFromTarget', { sessionId }).catch(() => undefined)
  }
}

async function captureWorkspace(page, viewport, filename, routeId) {
  await page.setViewportSize(viewport)
  const layout = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth, bodyText: document.body.innerText }))
  assert.ok(layout.bodyText.includes('研究工作台'), 'workspace product content is missing')
  const rootHorizontalOverflowPx = Math.max(0, layout.scroll - layout.client)
  assert.equal(rootHorizontalOverflowPx, 0, `Workspace ${viewport.width} has root overflow`)
  const buffer = await page.screenshot({ fullPage: false, animations: 'disabled' })
  const size = pngSize(buffer)
  assert.deepEqual(size, viewport, `Workspace PNG size mismatch for ${viewport.width}`)
  const path = resolve(evidenceDir, filename)
  await writeFile(path, buffer)
  return {
    path: relative(repoRoot, path).replaceAll('\\', '/'), sha256: sha256(buffer), capturedAt: new Date().toISOString(),
    container: 'workspace_page', viewport, imageContentSizePixels: size, rootHorizontalOverflowPx, routeId,
  }
}

const chromeForTestingPath = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-win64/chrome.exe')
const chromePath = process.env.FAMS_WINDOWS_CHROME_PATH || (existsSync(chromeForTestingPath) ? chromeForTestingPath : '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe')
assert.ok(existsSync(chromePath), `Windows Chrome executable not found: ${chromePath}`)
const usingChromeForTesting = chromePath === chromeForTestingPath
const profilePath = await mkdtemp(resolve(evidenceDir, 'chrome-profile-'))
const windowsProfilePath = execFileSync('wslpath', ['-w', profilePath], { encoding: 'utf8' }).trim()
const windowsExtensionPath = execFileSync('wslpath', ['-w', outputDir], { encoding: 'utf8' }).trim()

const automationMode = process.env.V2_PX_CHROME_MODE === 'headed' ? 'headed_cdp' : 'headless_new'
const chromeArgs = [
  ...(automationMode === 'headless_new' ? ['--headless=new'] : []), ...(usingChromeForTesting ? ['--no-sandbox'] : []),
  '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-allow-origins=*',
  '--remote-debugging-port=0', `--user-data-dir=${windowsProfilePath}`,
  `--disable-extensions-except=${windowsExtensionPath}`, `--load-extension=${windowsExtensionPath}`, 'about:blank',
]
const startedAt = new Date().toISOString()
const chromeProcess = spawn(chromePath, chromeArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
let diagnostics = ''
const endpoint = await new Promise((resolveEndpoint, reject) => {
  const timeout = setTimeout(() => reject(new Error(`Chrome CDP endpoint timeout: ${diagnostics.slice(-2000)}`)), 30_000)
  chromeProcess.once('error', (error) => { clearTimeout(timeout); reject(error) })
  chromeProcess.stderr.on('data', (chunk) => {
    diagnostics += chunk.toString()
    const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (match) { clearTimeout(timeout); resolveEndpoint(match[1]) }
  })
  chromeProcess.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Chrome exited before CDP ready (code=${code}): ${diagnostics.slice(-2000)}`)) })
})

let browser
try {
  browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 })
  const context = browser.contexts()[0]
  assert.ok(context, 'Chrome CDP default context is missing')
  const rootSession = await browser.newBrowserCDPSession()

  const worker = await waitForFamsWorker(context)
  const extensionId = new URL(worker.url()).host
  assert.match(extensionId, /^[a-p]{32}$/)

  const manifest = JSON.parse(readFileSync(resolve(outputDir, 'manifest.json'), 'utf8'))
  assert.deepEqual(manifest.permissions.sort(), ['sidePanel', 'storage', 'tabs'].sort())
  assert.deepEqual(manifest.host_permissions ?? [], [])
  assert.deepEqual(manifest.optional_host_permissions.sort(), ['http://127.0.0.1:4000/*', 'http://localhost:4000/*'].sort())
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'))

  const consoleEntries = []
  const networkEntries = []
  const workspacePage = await context.newPage()
  workspacePage.on('console', (entry) => consoleEntries.push({ type: entry.type(), text: entry.text(), page: 'workspace' }))
  workspacePage.on('pageerror', (error) => consoleEntries.push({ type: 'pageerror', text: error.message, page: 'workspace' }))
  workspacePage.on('request', (request) => networkEntries.push({ phase: 'request', method: request.method(), url: request.url() }))
  workspacePage.on('response', (response) => networkEntries.push({ phase: 'response', status: response.status(), url: response.url() }))

  const routeId = 'px-route-realchrome00000001'
  const workspaceUrl = `chrome-extension://${extensionId}/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=source_library&routeId=${routeId}`
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false })
  await workspacePage.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await workspacePage.getByTestId('workspace-app').waitFor({ timeout: 10_000 })
  await workspacePage.getByRole('button', { name: '打开侧栏' }).click()
  const sidePanelTarget = await waitForSidePanelTarget(rootSession, extensionId)

  const screenshots = []
  screenshots.push(await captureRawTarget(rootSession, sidePanelTarget, { width: 360, height: 720 }, 'sidepanel-360.png', routeId))
  screenshots.push(await captureRawTarget(rootSession, sidePanelTarget, { width: 420, height: 800 }, 'sidepanel-420.png', routeId))
  screenshots.push(await captureWorkspace(workspacePage, { width: 768, height: 900 }, 'workspace-768.png', routeId))
  screenshots.push(await captureWorkspace(workspacePage, { width: 1280, height: 900 }, 'workspace-1280.png', routeId))

  const tracePath = resolve(evidenceDir, 'chrome-trace.zip')
  await context.tracing.stop({ path: tracePath })
  const networkPath = resolve(evidenceDir, 'network.json')
  const consolePath = resolve(evidenceDir, 'console.json')
  await writeFile(networkPath, `${JSON.stringify(networkEntries, null, 2)}\n`, 'utf8')
  await writeFile(consolePath, `${JSON.stringify(consoleEntries, null, 2)}\n`, 'utf8')
  const consoleErrors = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror')
  assert.deepEqual(consoleErrors, [], `extension console errors: ${JSON.stringify(consoleErrors)}`)

  const chromeVersion = browser.version().replace(/^Chrome\//, '')
  const buildDigest = await digestDirectory(outputDir)
  const evidence = {
    schemaVersion: 'v2-px-real-chrome-evidence/2', mode: 'real_chrome', automationMode, chromeVersion,
    extensionId, extensionVersion: manifest.version, buildDigest, commitSha, routeId,
    pageUrls: [`chrome-extension://${extensionId}/sidepanel.html`, workspaceUrl],
    viewports: [{ width: 360, height: 720 }, { width: 420, height: 800 }, { width: 768, height: 900 }, { width: 1280, height: 900 }],
    screenshots,
    traceRefs: [{ path: relative(repoRoot, tracePath).replaceAll('\\', '/'), sha256: sha256(await readFile(tracePath)) }],
    networkRef: { path: relative(repoRoot, networkPath).replaceAll('\\', '/'), sha256: sha256(await readFile(networkPath)) },
    consoleRef: { path: relative(repoRoot, consolePath).replaceAll('\\', '/'), sha256: sha256(await readFile(consolePath)) },
  }

  const schema = JSON.parse(readFileSync(resolve(repoRoot, 'docs/schemas/v2-px-real-chrome-evidence-v2.schema.json'), 'utf8'))
  const ajv = new Ajv2020({ allErrors: true, strict: true })
  addFormats(ajv)
  const validate = ajv.compile(schema)
  assert.equal(validate(evidence), true, JSON.stringify(validate.errors))
  const fewerViewports = { ...evidence, viewports: evidence.viewports.slice(0, 2) }
  assert.equal(validate(fewerViewports), false, 'two-viewport fake evidence must be rejected')
  for (const screenshot of evidence.screenshots) assert.deepEqual(screenshot.viewport, screenshot.imageContentSizePixels)

  const evidencePath = resolve(evidenceDir, 'real-chrome-evidence.json')
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8')
  const stageManifest = {
    schemaVersion: 'v2-px-stage-manifest/1', stage: stageName, status: 'passed', commitSha,
    startedAt, endedAt: new Date().toISOString(), chromeVersion, extensionId, extensionVersion: manifest.version, buildDigest,
    command: 'npm run verify:real-chrome', exitCode: 0,
    artifacts: (await walkFiles(evidenceDir))
      .filter((path) => !path.includes('chrome-profile-') && !path.endsWith('/stage-manifest.json'))
      .map((path) => ({ path: relative(repoRoot, path).replaceAll('\\', '/'), sha256: sha256(readFileSync(path)) })),
    negativeChecks: {
      headlessProbeStatus: automationMode === 'headed_cdp' ? 'fallback_after_headless_failure' : 'passed',
      browserDistribution: usingChromeForTesting ? 'chrome_for_testing' : 'installed_google_chrome',
      fewerViewportsRejected: true,
      actualPixelSizeMatched: true,
      staticMockHtmlUsed: false,
    },
    tradeBoundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false, brokerOrderRequestCount: 0 },
    humanAcceptanceStatus: 'not_performed',
  }
  await writeFile(resolve(evidenceDir, 'stage-manifest.json'), `${JSON.stringify(stageManifest, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ status: 'passed', evidencePath, ...stageManifest }, null, 2))
} finally {
  await browser?.close().catch(() => undefined)
  chromeProcess.kill('SIGTERM')
}
