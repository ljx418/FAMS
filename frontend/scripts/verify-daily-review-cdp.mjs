import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const reviewId = process.env.FAMS_REAL_E2E_REVIEW_ID?.trim()
assert.ok(reviewId, 'FAMS_REAL_E2E_REVIEW_ID is required')
const appBase = process.env.FAMS_FRONTEND_E2E_BASE || 'http://localhost:3000'
const repoRoot = resolve(import.meta.dirname, '../..')
const evidenceDir = resolve(repoRoot, '.verification/private/daily-review/DRV1-13/chrome-cdp-runtime')
await mkdir(evidenceDir, { recursive: true })

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

let chromeProcess
let endpoint = process.env.FAMS_CDP_ENDPOINT?.trim()
if (!endpoint) {
  const chromePath = process.env.FAMS_WINDOWS_CHROME_PATH || '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
  const profilePath = await mkdtemp(resolve(evidenceDir, 'profile-'))
  const windowsProfilePath = execFileSync('wslpath', ['-w', profilePath], { encoding: 'utf8' }).trim()
  chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    '--remote-debugging-port=0',
    `--user-data-dir=${windowsProfilePath}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  endpoint = await new Promise((resolveEndpoint, reject) => {
    let diagnostics = ''
    const timeout = setTimeout(() => reject(new Error(`Chrome CDP endpoint timeout: ${diagnostics.slice(-2000)}`)), 30_000)
    chromeProcess.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    chromeProcess.stderr.on('data', (chunk) => {
      diagnostics += chunk.toString()
      const match = diagnostics.match(/DevTools listening on (ws:\/\/[^\s]+)/)
      if (match) {
        clearTimeout(timeout)
        resolveEndpoint(match[1])
      }
    })
    chromeProcess.once('exit', (code) => {
      clearTimeout(timeout)
      reject(new Error(`Chrome exited before CDP became ready (code=${code}): ${diagnostics.slice(-2000)}`))
    })
  })
}

const results = []
let browser
try {
  browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 })
  const context = browser.contexts()[0]
  assert.ok(context, 'Chrome CDP default context missing')
  for (const viewport of viewports) {
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (entry) => { if (entry.type() === 'error') consoleErrors.push(entry.text()) })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(`${appBase}/daily-reviews/${encodeURIComponent(reviewId)}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByTestId('daily-review-workbench').waitFor({ timeout: 30_000 })
    assert.equal(await page.getByRole('button', { name: /NODE \d{2}/ }).count(), 10)
    assert.equal(await page.getByTestId('focus-buyback-points').count(), 1)
    assert.equal(await page.getByTestId('manual-order-plan').count(), 1)
    assert.equal(await page.getByTestId('conditional-buyback-plan').count(), 1)
    for (const text of ['formalTradingUnlocked=false', 'autoTradeUnlocked=false', 'canCreateOrder=false', 'orderCreateAllowed=false']) {
      await page.getByText(text, { exact: true }).waitFor()
    }
    await page.getByRole('button', { name: /NODE 01/ }).dblclick()
    await page.locator('.ant-modal-wrap:visible').waitFor()
    await page.locator('.ant-modal-wrap:visible .ant-modal-footer button').click()
    await page.locator('.ant-modal-wrap:visible').waitFor({ state: 'hidden' })
    const pageWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    assert.ok(pageWidth.scroll <= pageWidth.client + 1, `${viewport.name} root overflow: ${JSON.stringify(pageWidth)}`)
    assert.deepEqual(consoleErrors, [], `${viewport.name} console errors`)
    assert.deepEqual(pageErrors, [], `${viewport.name} page errors`)
    const screenshot = resolve(evidenceDir, `${viewport.name}.png`)
    await page.screenshot({ path: screenshot, fullPage: true, timeout: 30_000 })
    results.push({ ...viewport, screenshot, pageWidth, nodeCount: 10, consoleErrors, pageErrors })
    await page.close()
  }
} finally {
  await browser?.close().catch(() => undefined)
  chromeProcess?.kill('SIGTERM')
}

const audit = {
  schemaVersion: 'fams.daily-review-chrome-cdp.v1',
  checkedAt: new Date().toISOString(),
  status: 'passed',
  browser: 'Google Chrome for Windows via CDP',
  reviewId,
  endpointSource: process.env.FAMS_CDP_ENDPOINT ? 'external' : 'spawned_headless_chrome',
  results,
}
await writeFile(resolve(evidenceDir, 'chrome-cdp-runtime.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(audit, null, 2))
