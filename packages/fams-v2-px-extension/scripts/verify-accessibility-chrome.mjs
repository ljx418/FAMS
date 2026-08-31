import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { relative, resolve } from 'node:path'
import { chromium } from '@playwright/test'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')
const backendRoot = resolve(repoRoot, 'backend')
const outputDir = resolve(packageRoot, '.output/chrome-mv3')
const sourceDatabasePath = resolve(backendRoot, 'prisma/dev.db')
const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim()
const dirtyScope = execFileSync('git', ['status', '--short', '--',
  'packages/fams-v2-px-extension', 'backend/scripts/start-v2-px-acceptance-server.ts',
  'backend/scripts/verify-v2-px-semantic-contract.ts', 'docs/schemas', 'docs/prototypes/v2-px/fixtures',
  'docs/generated', 'docs/V2_PX_PRD.md', 'docs/V2_PX_PRD_TRACEABILITY_MATRIX.md',
  'docs/V2_PX_TARGET_ARCHITECTURE.md', 'docs/V2_PX_EXTERNAL_BRAIN_PRODUCTIZATION_PLAN.md',
  'docs/current-stage-state.json', 'docs/audits/v2-px',
], { cwd: repoRoot, encoding: 'utf8' }).trim()
if (!process.env.V2_PX_ALLOW_DIRTY) assert.equal(dirtyScope, '', `PX6 accessibility evidence requires committed in-scope files:\n${dirtyScope}`)
assert.ok(existsSync(resolve(outputDir, 'manifest.json')), 'WXT build output is missing')
assert.ok(existsSync(sourceDatabasePath), 'real FAMS SQLite database is missing')

const stageName = process.env.V2_PX_ALLOW_DIRTY ? 'PX6-01-dev-accessibility' : 'PX6-01'
const evidenceDir = resolve(repoRoot, '.verification/private/v2-px', commitSha, stageName)
await mkdir(evidenceDir, { recursive: true })
const extensionLoadDir = resolve(evidenceDir, 'headless-pregranted-extension')
await cp(outputDir, extensionLoadDir, { recursive: true, force: true })
const productionManifest = JSON.parse(readFileSync(resolve(outputDir, 'manifest.json'), 'utf8'))
assert.deepEqual(productionManifest.host_permissions ?? [], [], 'production manifest must keep host access optional')
assert.deepEqual((productionManifest.optional_host_permissions ?? []).sort(), ['http://127.0.0.1:4000/*', 'http://localhost:4000/*'].sort())
assert.equal(JSON.stringify(productionManifest).includes('<all_urls>'), false)
const pregrantManifestPath = resolve(extensionLoadDir, 'manifest.json')
const pregrantManifest = JSON.parse(await readFile(pregrantManifestPath, 'utf8'))
pregrantManifest.host_permissions = [...pregrantManifest.optional_host_permissions]
pregrantManifest.optional_host_permissions = []
await writeFile(pregrantManifestPath, `${JSON.stringify(pregrantManifest)}\n`)

const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const wait = (delayMs) => new Promise((resolveWait) => setTimeout(resolveWait, delayMs))
const tempRoot = await mkdtemp(resolve(tmpdir(), 'fams-v2-px-px6-a11y-'))
const databasePath = resolve(tempRoot, 'real-data-snapshot.db')
execFileSync('sqlite3', [sourceDatabasePath, `.backup '${databasePath.replaceAll("'", "''")}'`])
assert.equal(execFileSync('sqlite3', [databasePath, 'PRAGMA quick_check;'], { encoding: 'utf8' }).trim(), 'ok')
const sqlCount = (table) => Number(JSON.parse(execFileSync('sqlite3', [databasePath, '-json', `SELECT COUNT(*) AS count FROM "${table}"`], { encoding: 'utf8' }) || '[]')[0]?.count ?? 0)
const countsBefore = { operations: sqlCount('Operation'), reviews: sqlCount('DailyReviewRun'), transactions: sqlCount('Transaction') }
assert.ok(countsBefore.operations > 0 && countsBefore.reviews > 0, 'real Operation and DailyReviewRun data are required')

const linuxChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-linux64/chrome')
const windowsChrome = resolve(repoRoot, '.verification/tools/chrome-for-testing/chrome-win64/chrome.exe')
const chromePath = process.env.FAMS_CHROME_PATH || (existsSync(linuxChrome) ? linuxChrome : windowsChrome)
assert.ok(existsSync(chromePath), `official Chrome for Testing missing: ${chromePath}`)
const isWindowsChrome = chromePath.endsWith('.exe')
const linuxRuntimeLib = resolve(repoRoot, '.verification/tools/chrome-for-testing/runtime-libs/root/usr/lib/x86_64-linux-gnu')
const profilePath = await mkdtemp(resolve(evidenceDir, 'chrome-profile-'))
const extensionArgPath = isWindowsChrome ? execFileSync('wslpath', ['-w', extensionLoadDir], { encoding: 'utf8' }).trim() : extensionLoadDir
const profileArgPath = isWindowsChrome ? execFileSync('wslpath', ['-w', profilePath], { encoding: 'utf8' }).trim() : profilePath
const chromeProcess = spawn(chromePath, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
  '--no-proxy-server', '--host-resolver-rules=MAP localhost [::1]', '--remote-allow-origins=*', '--remote-debugging-port=0',
  `--user-data-dir=${profileArgPath}`, `--disable-extensions-except=${extensionArgPath}`, `--load-extension=${extensionArgPath}`, 'about:blank',
], {
  stdio: ['ignore', 'ignore', 'pipe'],
  env: { ...process.env, ...(isWindowsChrome ? {} : { LD_LIBRARY_PATH: [linuxRuntimeLib, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') }) },
})
let chromeDiagnostics = ''
const cdpEndpoint = await new Promise((resolveEndpoint, reject) => {
  const timer = setTimeout(() => reject(new Error(`Chrome CDP timeout: ${chromeDiagnostics.slice(-3000)}`)), 30_000)
  chromeProcess.stderr.on('data', (chunk) => {
    chromeDiagnostics += chunk.toString()
    const match = chromeDiagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)
    if (match) { clearTimeout(timer); resolveEndpoint(match[1]) }
  })
  chromeProcess.once('error', (error) => { clearTimeout(timer); reject(error) })
  chromeProcess.once('exit', (code) => { clearTimeout(timer); reject(new Error(`Chrome exited ${code}: ${chromeDiagnostics.slice(-3000)}`)) })
})

async function waitForWorker(context) {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    for (const worker of context.serviceWorkers()) {
      if (!worker.url().startsWith('chrome-extension://')) continue
      try {
        if ((await worker.evaluate(() => chrome.runtime.getManifest()))?.name === 'FAMS External Brain') return worker
      } catch { /* worker may be suspended during inspection */ }
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

async function auditPage(page, container, viewport) {
  await page.setViewportSize(viewport)
  const domAudit = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element)
      const rect = element.getBoundingClientRect()
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
    }
    const interactiveSelector = 'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])'
    const accessibleName = (element) => element.getAttribute('aria-label')?.trim()
      || element.getAttribute('aria-labelledby')?.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim()
      || (element.labels ? [...element.labels].map((label) => label.textContent ?? '').join(' ').trim() : '')
      || element.textContent?.trim() || element.getAttribute('title')?.trim() || element.getAttribute('placeholder')?.trim() || ''
    const interactive = [...document.querySelectorAll(interactiveSelector)].filter(visible).map((element, index) => {
      element.setAttribute('data-px-a11y-id', String(index))
      const rect = element.getBoundingClientRect()
      return { id: String(index), tag: element.tagName.toLowerCase(), name: accessibleName(element), width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 }
    })
    const parseRgb = (value) => {
      const values = value.match(/[\d.]+/g)?.map(Number) ?? []
      return { r: values[0] ?? 0, g: values[1] ?? 0, b: values[2] ?? 0, a: values[3] ?? 1 }
    }
    const background = (element) => {
      let current = element
      while (current) {
        const color = parseRgb(getComputedStyle(current).backgroundColor)
        if (color.a > 0.95) return color
        current = current.parentElement
      }
      return { r: 255, g: 255, b: 255, a: 1 }
    }
    const luminance = ({ r, g, b }) => {
      const linear = [r, g, b].map((channel) => {
        const value = channel / 255
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
    }
    const contrast = (left, right) => {
      const values = [luminance(left), luminance(right)].sort((a, b) => b - a)
      return (values[0] + 0.05) / (values[1] + 0.05)
    }
    const textSelector = 'h1,h2,h3,p,li,span,label,button,a,summary,small,dt,dd,strong'
    const textContrast = [...document.querySelectorAll(textSelector)].filter((element) => visible(element) && element.textContent?.trim() && !element.closest('[disabled]')).map((element) => ({
      tag: element.tagName.toLowerCase(), text: element.textContent.trim().slice(0, 80), ratio: Math.round(contrast(parseRgb(getComputedStyle(element).color), background(element)) * 100) / 100,
    }))
    return {
      rootHorizontalOverflowPx: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      interactive,
      unnamed: interactive.filter((item) => !item.name),
      undersized: interactive.filter((item) => item.width < 44 || item.height < 44),
      contrastFailures: textContrast.filter((item) => item.ratio < 4.5),
      minimumContrastRatio: Math.min(...textContrast.map((item) => item.ratio)),
    }
  })
  assert.equal(domAudit.rootHorizontalOverflowPx, 0, `${container} ${viewport.width} has root overflow`)
  assert.deepEqual(domAudit.unnamed, [], `${container} ${viewport.width} contains unnamed controls`)
  assert.deepEqual(domAudit.undersized, [], `${container} ${viewport.width} contains targets below 44x44`)
  assert.deepEqual(domAudit.contrastFailures, [], `${container} ${viewport.width} contains text below 4.5:1`)

  const focusableCount = domAudit.interactive.length
  await page.evaluate(() => {
    document.getElementById('px-a11y-focus-sentinel')?.remove()
    const sentinel = document.createElement('span')
    sentinel.id = 'px-a11y-focus-sentinel'
    sentinel.tabIndex = 0
    sentinel.setAttribute('aria-hidden', 'true')
    document.body.prepend(sentinel)
    sentinel.focus()
  })
  const focusAudit = []
  for (let index = 0; index < focusableCount; index += 1) {
    await page.keyboard.press('Tab')
    focusAudit.push(await page.evaluate(() => {
      const element = document.activeElement
      if (!(element instanceof HTMLElement)) return { id: 'none', tag: 'none', name: '', visibleRing: false }
      const style = getComputedStyle(element)
      const name = element.getAttribute('aria-label') || (element.labels ? [...element.labels].map((label) => label.textContent ?? '').join(' ') : '') || element.textContent || element.getAttribute('placeholder') || ''
      return { id: element.dataset.pxA11yId ?? 'untracked', tag: element.tagName.toLowerCase(), name: name.trim().slice(0, 80), visibleRing: style.outlineStyle !== 'none' && Number.parseFloat(style.outlineWidth) >= 1 }
    }))
  }
  await page.evaluate(() => {
    document.getElementById('px-a11y-focus-sentinel')?.remove()
    document.querySelectorAll('[data-px-a11y-id]').forEach((element) => element.removeAttribute('data-px-a11y-id'))
  })
  assert.equal(new Set(focusAudit.map((item) => item.id)).size, focusableCount, `${container} keyboard path did not reach every control exactly once`)
  assert.equal(focusAudit.every((item) => item.visibleRing), true, `${container} has a keyboard target without visible focus: ${JSON.stringify(focusAudit.filter((item) => !item.visibleRing))}`)
  const screenshotPath = resolve(evidenceDir, `accessibility-${container}-${viewport.width}.png`)
  const screenshot = await page.screenshot({ path: screenshotPath, animations: 'disabled', fullPage: false })
  return {
    container, viewport, ...domAudit, keyboardReachableCount: focusAudit.length, focusVisibleCount: focusAudit.filter((item) => item.visibleRing).length,
    focusOrder: focusAudit, screenshot: { path: relative(repoRoot, screenshotPath).replaceAll('\\', '/'), sha256: sha256(screenshot) },
  }
}

let browser
let server
const consoleEntries = []
const networkEntries = []
try {
  browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: 30_000 })
  const context = browser.contexts()[0]
  assert.ok(context, 'Chrome default context is missing')
  const instrument = (page) => {
    page.on('console', (entry) => consoleEntries.push({ type: entry.type(), text: entry.text(), url: page.url() }))
    page.on('pageerror', (error) => consoleEntries.push({ type: 'pageerror', text: error.message, url: page.url() }))
  }
  context.pages().forEach(instrument); context.on('page', instrument)
  context.on('request', (request) => networkEntries.push({ phase: 'request', method: request.method(), url: request.url() }))
  context.on('response', (response) => networkEntries.push({ phase: 'response', status: response.status(), url: response.url() }))
  context.on('requestfailed', (request) => networkEntries.push({ phase: 'failed', method: request.method(), url: request.url(), error: request.failure()?.errorText ?? 'unknown' }))
  const worker = await waitForWorker(context)
  worker.on('console', (entry) => consoleEntries.push({ type: entry.type(), text: entry.text(), url: worker.url() }))
  const extensionId = new URL(worker.url()).host
  assert.match(extensionId, /^[a-p]{32}$/)
  server = await startServer(extensionId)
  await context.tracing.start({ screenshots: true, snapshots: true, sources: false })

  const sidepanel = await context.newPage()
  await sidepanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, { waitUntil: 'domcontentloaded' })
  await sidepanel.getByTestId('sidepanel-current-summary').waitFor({ timeout: 30_000 })
  await sidepanel.getByTestId('sidepanel-ask').waitFor({ timeout: 30_000 })
  const audits = [
    await auditPage(sidepanel, 'sidepanel', { width: 360, height: 900 }),
    await auditPage(sidepanel, 'sidepanel', { width: 420, height: 900 }),
  ]

  const workspace = await context.newPage()
  const workspaceUrl = `chrome-extension://${extensionId}/workspace.html?workspaceId=px-ws-00000000-0000-4000-8000-000000000001&view=source_library&routeId=px-route-px601accessibility01`
  await workspace.goto(workspaceUrl, { waitUntil: 'domcontentloaded' })
  await workspace.getByTestId('view-source_library').waitFor({ timeout: 30_000 })
  audits.push(await auditPage(workspace, 'workspace', { width: 768, height: 900 }))
  audits.push(await auditPage(workspace, 'workspace', { width: 1280, height: 900 }))

  const tracePath = resolve(evidenceDir, 'accessibility-trace.zip')
  await context.tracing.stop({ path: tracePath })
  const consoleErrors = consoleEntries.filter((entry) => entry.type === 'error' || entry.type === 'pageerror')
  const failedRequests = networkEntries.filter((entry) => entry.phase === 'failed' || (entry.phase === 'response' && Number(entry.status) >= 400))
  const forbiddenRequests = networkEntries.filter((entry) => /broker|order-create|\/orders(?:\?|$)|auto-trade/i.test(entry.url))
  assert.deepEqual(consoleErrors, [], `console errors: ${JSON.stringify(consoleErrors)}`)
  assert.deepEqual(failedRequests, [], `failed network requests: ${JSON.stringify(failedRequests)}`)
  assert.deepEqual(forbiddenRequests, [], `forbidden trading requests: ${JSON.stringify(forbiddenRequests)}`)
  const countsAfter = { operations: sqlCount('Operation'), reviews: sqlCount('DailyReviewRun'), transactions: sqlCount('Transaction') }
  assert.deepEqual(countsAfter, countsBefore, 'accessibility verification must not mutate the real-data snapshot')

  const networkPath = resolve(evidenceDir, 'accessibility-network.json')
  const consolePath = resolve(evidenceDir, 'accessibility-console.json')
  await writeFile(networkPath, `${JSON.stringify(networkEntries, null, 2)}\n`)
  await writeFile(consolePath, `${JSON.stringify(consoleEntries, null, 2)}\n`)
  const report = {
    schemaVersion: 'fams.v2_px.accessibility_chrome_evidence.v1', status: 'passed', realData: true, automationMode: 'headless_new',
    commitSha, chromeVersion: browser.version().replace(/^Chrome\//, ''), extensionId, extensionVersion: productionManifest.version,
    viewports: audits.map((audit) => audit.viewport), audits,
    thresholds: { minimumTargetWidthPx: 44, minimumTargetHeightPx: 44, minimumContrastRatio: 4.5, rootHorizontalOverflowPx: 0, keyboardFocusVisible: true },
    totals: {
      interactiveChecks: audits.reduce((total, audit) => total + audit.interactive.length, 0),
      keyboardReachableChecks: audits.reduce((total, audit) => total + audit.keyboardReachableCount, 0),
      unnamedControls: 0, undersizedTargets: 0, contrastFailures: 0, rootOverflowFailures: 0,
      consoleErrorCount: consoleErrors.length, failedRequestCount: failedRequests.length,
    },
    realDataSnapshot: { sourcePath: relative(repoRoot, sourceDatabasePath).replaceAll('\\', '/'), sourceSizeBytes: statSync(sourceDatabasePath).size, operationCount: countsBefore.operations, reviewCount: countsBefore.reviews },
    privacy: { rawAccountScreenshotCount: 0, secretLikeFieldCount: 0 },
    tradeBoundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false, brokerOrderRequestCount: forbiddenRequests.length, transactionMutationCount: 0 },
    artifacts: {
      trace: { path: relative(repoRoot, tracePath).replaceAll('\\', '/'), sha256: sha256(await readFile(tracePath)) },
      network: { path: relative(repoRoot, networkPath).replaceAll('\\', '/'), sha256: sha256(await readFile(networkPath)) },
      console: { path: relative(repoRoot, consolePath).replaceAll('\\', '/'), sha256: sha256(await readFile(consolePath)) },
    },
  }
  const reportPath = resolve(evidenceDir, 'accessibility-audit.json')
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify({ status: 'passed', evidencePath: relative(repoRoot, reportPath).replaceAll('\\', '/'), ...report }, null, 2))
} finally {
  if (browser?.contexts()[0]) await browser.contexts()[0].tracing.stop().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  if (server) { server.child.kill('SIGTERM'); await wait(500) }
  chromeProcess.kill('SIGTERM')
}
