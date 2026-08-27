import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const appBase = process.env.FAMS_FRONTEND_E2E_BASE || 'http://localhost:3000'
const backendBase = process.env.FAMS_BACKEND_E2E_BASE || 'http://localhost:4000'
const repoRoot = resolve(import.meta.dirname, '../..')
const evidenceRoot = resolve(repoRoot, '.verification/private/rrg-watchlist/runtime')
const localBrowserLibDir = resolve(repoRoot, '.verification/playwright-libs/lib')
process.env.LD_LIBRARY_PATH = [localBrowserLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
await mkdir(evidenceRoot, { recursive: true })

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]

async function verifyPage(page, viewport, mode) {
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  const brokerRequestUrls = []
  page.on('console', (entry) => { if (entry.type() === 'error') consoleErrors.push(entry.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || 'unknown'}`))
  page.on('request', (request) => {
    if (/\/(broker-orders?|orders?)\b|broker.*order/i.test(request.url())) brokerRequestUrls.push(request.url())
  })

  await page.addInitScript((storageKey) => window.localStorage.removeItem(storageKey), 'fams.rrg.hidden-targets.default.v1')
  await page.goto(`${appBase}/relative-rotation`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
  await page.getByText('RRG 自选与显示管理', { exact: true }).waitFor({ timeout: 30_000 })
  await page.getByText('长鑫科技', { exact: true }).waitFor({ timeout: 30_000 })
  await page.getByText('样本不足', { exact: true }).first().waitFor()
  await page.getByText(/24 个交易日/).waitFor()
  assert.ok(await page.locator('canvas').count() > 0, `${mode}/${viewport.name}: RRG chart canvas missing`)
  assert.ok(await page.getByRole('switch').count() >= 3, `${mode}/${viewport.name}: visibility switches missing`)

  const hideAi = page.getByRole('switch', { name: '隐藏 人工智能AI ETF' })
  await hideAi.click()
  await page.getByRole('switch', { name: '显示 人工智能AI ETF' }).waitFor()
  const hiddenAfterToggle = await page.evaluate(() => JSON.parse(window.localStorage.getItem('fams.rrg.hidden-targets.default.v1') || '[]'))
  assert.ok(hiddenAfterToggle.includes('CN:515070'), `${mode}/${viewport.name}: hidden target was not persisted`)
  await page.getByRole('switch', { name: '显示 人工智能AI ETF' }).click()
  await page.getByRole('switch', { name: '隐藏 人工智能AI ETF' }).waitFor()
  const hiddenAfterRestore = await page.evaluate(() => JSON.parse(window.localStorage.getItem('fams.rrg.hidden-targets.default.v1') || '[]'))
  assert.ok(!hiddenAfterRestore.includes('CN:515070'), `${mode}/${viewport.name}: restored target remained hidden`)

  const marketSelector = page.locator('[aria-label="RRG市场"]')
  await marketSelector.getByText('港股', { exact: true }).click()
  await page.getByText('当前市场还没有持仓或自选标的', { exact: true }).waitFor({ timeout: 30_000 })
  await page.getByText(/恒生指数/).first().waitFor()
  await marketSelector.getByText('A股', { exact: true }).click()
  await page.getByText('长鑫科技', { exact: true }).waitFor({ timeout: 30_000 })

  const pageWidth = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }))
  assert.ok(pageWidth.scroll <= pageWidth.client + 1, `${mode}/${viewport.name}: root overflow ${JSON.stringify(pageWidth)}`)
  assert.deepEqual(pageErrors, [], `${mode}/${viewport.name}: page errors`)
  assert.deepEqual(consoleErrors, [], `${mode}/${viewport.name}: console errors`)
  assert.deepEqual(failedRequests, [], `${mode}/${viewport.name}: failed requests`)
  assert.deepEqual(brokerRequestUrls, [], `${mode}/${viewport.name}: broker order requests`)

  const evidenceDir = resolve(evidenceRoot, mode)
  await mkdir(evidenceDir, { recursive: true })
  const screenshot = resolve(evidenceDir, `${viewport.name}.png`)
  await page.screenshot({ path: screenshot, fullPage: true, timeout: 30_000 })
  return {
    ...viewport,
    screenshot,
    pageWidth,
    insufficientSampleGateVisible: true,
    visibilityPersistencePassed: true,
    marketIsolationPassed: true,
    chartRendered: true,
    consoleErrors,
    pageErrors,
    failedRequests,
    brokerRequestUrls,
  }
}

async function runPlaywright() {
  const browser = await chromium.launch({ headless: true })
  const results = []
  try {
    for (const viewport of viewports) {
      const context = await browser.newContext({ viewport, locale: 'zh-CN', reducedMotion: 'reduce' })
      const page = await context.newPage()
      results.push(await verifyPage(page, viewport, 'playwright'))
      await context.close()
    }
  } finally {
    await browser.close()
  }
  return results
}

async function runChromeCdp() {
  const chromePath = process.env.FAMS_WINDOWS_CHROME_PATH || '/mnt/c/Program Files/Google/Chrome/Application/chrome.exe'
  const profilePath = await mkdtemp(resolve(evidenceRoot, 'chrome-profile-'))
  const windowsProfilePath = execFileSync('wslpath', ['-w', profilePath], { encoding: 'utf8' }).trim()
  const chromeProcess = spawn(chromePath, [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--remote-allow-origins=*',
    '--remote-debugging-port=0',
    `--user-data-dir=${windowsProfilePath}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })

  const endpoint = await new Promise((resolveEndpoint, reject) => {
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

  let browser
  const results = []
  try {
    browser = await chromium.connectOverCDP(endpoint, { timeout: 30_000 })
    const context = browser.contexts()[0]
    assert.ok(context, 'Chrome CDP default context missing')
    for (const viewport of viewports) {
      const page = await context.newPage()
      await page.setViewportSize({ width: viewport.width, height: viewport.height })
      results.push(await verifyPage(page, viewport, 'chrome-cdp'))
      await page.close()
    }
  } finally {
    await browser?.close().catch(() => undefined)
    chromeProcess.kill('SIGTERM')
  }
  return results
}

const healthResponse = await fetch(`${backendBase}/health`)
assert.equal(healthResponse.ok, true, `Backend health request failed: ${healthResponse.status}`)
const health = await healthResponse.json()
assert.equal(health.schedulers?.factsetRefresh?.config?.enabled, false, 'Factset scheduler must be disabled during browser acceptance')
assert.equal(health.schedulers?.dailyPortfolioReview?.config?.enabled, false, 'Daily review scheduler must be disabled during browser acceptance')

const watchlistUrl = `${backendBase}/api/v1/relative-rotation/watchlist?userId=default`
const beforeWatchlistResponse = await fetch(watchlistUrl)
assert.equal(beforeWatchlistResponse.ok, true, `Watchlist baseline request failed: ${beforeWatchlistResponse.status}`)
const beforeWatchlist = await beforeWatchlistResponse.json()

const [playwrightResults, chromeCdpResults] = await Promise.all([
  runPlaywright(),
  runChromeCdp(),
])

const afterWatchlistResponse = await fetch(watchlistUrl)
assert.equal(afterWatchlistResponse.ok, true, `Watchlist final request failed: ${afterWatchlistResponse.status}`)
const afterWatchlist = await afterWatchlistResponse.json()
assert.deepEqual(afterWatchlist.items, beforeWatchlist.items, 'Browser acceptance must not mutate watchlist records or series')

const audit = {
  schemaVersion: 'fams.relative_rotation.watchlist_runtime.v1',
  checkedAt: new Date().toISOString(),
  status: 'passed',
  appBase,
  backendBase,
  browsers: {
    playwrightChromium: playwrightResults,
    googleChromeCdp: chromeCdpResults,
  },
  dataBoundary: {
    browserMutatedWatchlist: false,
    watchlistCountBefore: beforeWatchlist.count,
    watchlistCountAfter: afterWatchlist.count,
    visibilityStoredLocallyOnly: true,
    backgroundSchedulersDisabled: health.schedulers.factsetRefresh.config.enabled === false
      && health.schedulers.dailyPortfolioReview.config.enabled === false,
  },
  tradingBoundary: {
    notTradingAdvice: true,
    brokerOrderRequestsObserved: 0,
  },
}
await writeFile(resolve(evidenceRoot, 'runtime.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(audit, null, 2))
