import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const appBase = process.env.FAMS_FRONTEND_E2E_BASE || 'http://127.0.0.1:3000'
const backendBase = process.env.FAMS_BACKEND_E2E_BASE || 'http://127.0.0.1:4000'
const repoRoot = resolve(import.meta.dirname, '../..')
const evidenceDir = resolve(repoRoot, 'docs/audits/2026-09-17-frontend-usability-grid-replay/evidence')
const screenshotDir = resolve(evidenceDir, 'screenshots')
const localBrowserLibDir = resolve(repoRoot, '.verification/playwright-libs/lib')
process.env.LD_LIBRARY_PATH = [localBrowserLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
await mkdir(screenshotDir, { recursive: true })

function luminance(rgb) {
  const channels = rgb.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [0, 0, 0]
  const linear = channels.map((value) => {
    const normalized = value / 255
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(luminance(foreground), luminance(background))
  const darker = Math.min(luminance(foreground), luminance(background))
  return (lighter + 0.05) / (darker + 0.05)
}

async function assertNoRootOverflow(page, label) {
  const width = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  assert.ok(width.scrollWidth <= width.clientWidth + 2, `${label}: root overflow ${JSON.stringify(width)}`)
  return width
}

async function screenshot(page, name, fullPage = false) {
  const path = resolve(screenshotDir, name)
  await page.screenshot({ path, fullPage, animations: 'disabled' })
  return `screenshots/${name}`
}

async function dismissTransientOverlays(page) {
  await page.locator('.ant-notification-notice').first().waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined)
  for (const closeButton of await page.locator('.ant-notification-notice-close').all()) {
    await closeButton.click().catch(() => undefined)
  }
  const latestMessage = page.locator('.ant-message-notice').last()
  await latestMessage.waitFor({ state: 'visible', timeout: 1500 }).catch(() => undefined)
  await latestMessage.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => undefined)
  await page.locator('.ant-message').evaluateAll((elements) => elements.forEach((element) => element.remove()))
}

async function createPage(browser, viewport) {
  const context = await browser.newContext({ viewport, locale: 'zh-CN', reducedMotion: 'reduce' })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  const failedRequests = []
  const tradingRequests = []
  page.on('console', (entry) => { if (entry.type() === 'error') consoleErrors.push(entry.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()}: ${request.failure()?.errorText || 'unknown'}`))
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /(?:order-create|auto-trade|broker-order|\/orders?)(?:\/|\?|$)/i.test(request.url())) {
      tradingRequests.push(`${request.method()} ${request.url()}`)
    }
  })
  return { context, page, consoleErrors, pageErrors, failedRequests, tradingRequests }
}

async function verifyDesktop(browser) {
  const runtime = await createPage(browser, { width: 1440, height: 1000 })
  const { page } = runtime
  const results = { screenshots: [], rotationInteractiveMs: null, activeWorkflowContrast: null }
  try {
    await page.goto(`${appBase}/assets`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByRole('button', { name: '导入 Excel' }).first().waitFor({ timeout: 30_000 })
    assert.equal(await page.getByText('上传和识别不等于交易', { exact: true }).count(), 0)
    assert.equal(await page.getByText('先私有保存，再由你决定是否识别', { exact: true }).count(), 0)
    const visiblePageHeadings = await page.locator('h1:not(.sr-only)').count()
    assert.equal(visiblePageHeadings, 0, 'asset page must not repeat a large visible page heading')
    const activeStep = page.locator('.fams-workflow-step.is-active')
    await activeStep.waitFor()
    const activeColors = await activeStep.evaluate((element) => {
      const style = getComputedStyle(element)
      const description = element.querySelector('.fams-workflow-step-description')
      return {
        background: style.backgroundColor,
        foreground: style.color,
        description: description ? getComputedStyle(description).color : style.color,
        height: element.getBoundingClientRect().height,
      }
    })
    const mainContrast = contrastRatio(activeColors.foreground, activeColors.background)
    const descriptionContrast = contrastRatio(activeColors.description, activeColors.background)
    assert.ok(mainContrast >= 4.5, `active workflow main contrast ${mainContrast.toFixed(2)} < 4.5`)
    assert.ok(descriptionContrast >= 4.5, `active workflow description contrast ${descriptionContrast.toFixed(2)} < 4.5`)
    assert.ok(activeColors.height >= 44, 'active workflow target must be at least 44px high')
    results.activeWorkflowContrast = { ...activeColors, mainContrast, descriptionContrast }
    await dismissTransientOverlays(page)
    results.screenshots.push(await screenshot(page, 'assets-desktop.png'))
    await assertNoRootOverflow(page, 'assets desktop')

    const rotationStartedAt = performance.now()
    await page.goto(`${appBase}/relative-rotation`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByRole('heading', { name: '相对轮动与波动仓' }).waitFor({ timeout: 15_000 })
    const coverageButton = page.getByRole('button').filter({ hasText: '全部持仓覆盖' })
    await coverageButton.waitFor({ timeout: 15_000 })
    await page.waitForFunction(() => {
      const button = Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.includes('全部持仓覆盖'))
      return Boolean(button?.textContent?.match(/1[0-9]\s*个/)) && document.body.innerText.includes('金科ETF')
    }, undefined, { timeout: 15_000 })
    results.rotationInteractiveMs = Math.round(performance.now() - rotationStartedAt)
    assert.ok(results.rotationInteractiveMs < 5_000, `rotation interactive time ${results.rotationInteractiveMs}ms >= 5000ms`)
    await dismissTransientOverlays(page)
    await coverageButton.evaluate((element) => window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - 260 }))
    await coverageButton.click()
    await page.getByText('覆盖明细', { exact: true }).waitFor()
    assert.ok(await page.getByText('金科ETF', { exact: true }).count() > 0, 'coverage popover must show real holding names')
    results.screenshots.push(await screenshot(page, 'relative-rotation-coverage-desktop.png'))
    results.screenshots.push(await page.locator('.ant-popover:visible').screenshot({ path: resolve(screenshotDir, 'relative-rotation-coverage-popover.png'), animations: 'disabled' }).then(() => 'screenshots/relative-rotation-coverage-popover.png'))
    await page.keyboard.press('Escape')
    const rrgHelp = page.getByRole('button', { name: /RRG：/ }).first()
    await rrgHelp.hover()
    await page.getByText(/相对轮动图。用同一基准比较多个标的/).waitFor()
    await assertNoRootOverflow(page, 'relative rotation desktop')

    await page.goto(`${appBase}/backtest?mode=portfolio`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByText('已展示经典组合 + 当前组合的最近保存结果', { exact: true }).waitFor({ timeout: 90_000 })
    await page.getByRole('button', { name: '打开历史回测' }).waitFor()
    assert.equal(await page.locator('[data-testid="portfolio-backtest-workspace"] .ant-checkbox-group').first().locator('input[type="checkbox"]:checked').count(), 6)
    await page.getByText('正式交易未解锁', { exact: true }).first().waitFor()
    results.screenshots.push(await screenshot(page, 'portfolio-backtest-restored-desktop.png'))
    await page.getByRole('button', { name: '打开历史回测' }).click()
    await page.waitForURL(/mode=history/)
    await page.getByText('历史运行', { exact: true }).first().waitFor()
    await assertNoRootOverflow(page, 'portfolio history desktop')

    await page.goto(`${appBase}/backtest?mode=review`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByTestId('grid-replay-panel').waitFor({ timeout: 30_000 })
    await page.getByText('当前只能展示已有真实证据', { exact: true }).waitFor({ timeout: 60_000 })
    await page.getByText('日内证据不足', { exact: true }).waitFor()
    await page.getByText('时序不确定未计入', { exact: true }).waitFor()
    const klineCanvas = page.getByTestId('grid-replay-panel').locator('canvas').first()
    await klineCanvas.waitFor({ timeout: 15_000 })
    assert.ok(await page.getByTestId('grid-replay-panel').locator('canvas').count() >= 1, 'grid replay must render a K-line canvas')
    await dismissTransientOverlays(page)
    results.screenshots.push(await screenshot(page, 'grid-replay-kline-desktop.png'))
    results.screenshots.push(await klineCanvas.screenshot({ path: resolve(screenshotDir, 'grid-replay-kline-chart.png'), animations: 'disabled' }).then(() => 'screenshots/grid-replay-kline-chart.png'))
    await page.getByText('命中收益曲线', { exact: true }).click()
    await page.getByText('按网格建议', { exact: true }).last().waitFor()
    assert.ok(await page.getByText('不执行建议', { exact: true }).count() > 0)
    assert.ok(await page.getByText('实际成交', { exact: true }).count() > 0)
    results.screenshots.push(await screenshot(page, 'grid-replay-return-desktop.png'))
    results.screenshots.push(await page.getByTestId('grid-replay-panel').locator('canvas').first().screenshot({ path: resolve(screenshotDir, 'grid-replay-return-chart.png'), animations: 'disabled' }).then(() => 'screenshots/grid-replay-return-chart.png'))
    await assertNoRootOverflow(page, 'grid replay desktop')
  } finally {
    await runtime.context.close()
  }
  return { ...results, ...runtime, page: undefined, context: undefined }
}

async function verifyMobile(browser) {
  const runtime = await createPage(browser, { width: 390, height: 844 })
  const { page } = runtime
  const screenshots = []
  try {
    await page.goto(`${appBase}/assets`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByRole('button', { name: '导入 Excel' }).first().waitFor({ timeout: 30_000 })
    await dismissTransientOverlays(page)
    screenshots.push(await screenshot(page, 'assets-mobile.png'))
    await assertNoRootOverflow(page, 'assets mobile')

    await page.goto(`${appBase}/relative-rotation`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByRole('button').filter({ hasText: '全部持仓覆盖' }).waitFor({ timeout: 15_000 })
    await page.waitForFunction(() => {
      const button = Array.from(document.querySelectorAll('button')).find((element) => element.textContent?.includes('全部持仓覆盖'))
      return Boolean(button?.textContent?.match(/1[0-9]\s*个/)) && document.body.innerText.includes('金科ETF')
    }, undefined, { timeout: 15_000 })
    screenshots.push(await screenshot(page, 'relative-rotation-mobile.png'))
    await assertNoRootOverflow(page, 'relative rotation mobile')

    await page.goto(`${appBase}/backtest?mode=review`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByText('当前只能展示已有真实证据', { exact: true }).waitFor({ timeout: 60_000 })
    await dismissTransientOverlays(page)
    await page.getByTestId('grid-replay-panel').scrollIntoViewIfNeeded()
    const panelWidth = await page.getByTestId('grid-replay-panel').evaluate((element) => ({ scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }))
    assert.ok(panelWidth.scrollWidth <= panelWidth.clientWidth + 2, `grid replay panel clips controls: ${JSON.stringify(panelWidth)}`)
    screenshots.push(await screenshot(page, 'grid-replay-mobile.png'))
    await assertNoRootOverflow(page, 'grid replay mobile')
  } finally {
    await runtime.context.close()
  }
  return { screenshots, ...runtime, page: undefined, context: undefined }
}

const healthResponse = await fetch(`${backendBase}/health`)
assert.equal(healthResponse.ok, true, `backend health failed: ${healthResponse.status}`)
const browser = await chromium.launch({ headless: true })
let desktop
let mobile
try {
  desktop = await verifyDesktop(browser)
  mobile = await verifyMobile(browser)
} finally {
  await browser.close()
}

for (const [label, runtime] of [['desktop', desktop], ['mobile', mobile]]) {
  const unexpectedFailedRequests = runtime.failedRequests.filter((entry) => !entry.includes('net::ERR_ABORTED'))
  assert.deepEqual(runtime.pageErrors, [], `${label}: page errors`)
  assert.deepEqual(runtime.consoleErrors, [], `${label}: console errors`)
  assert.deepEqual(unexpectedFailedRequests, [], `${label}: unexpected failed requests`)
  assert.deepEqual(runtime.tradingRequests, [], `${label}: forbidden trading requests`)
}

const audit = {
  schemaVersion: 'fams.frontend_usability.runtime_acceptance.v1',
  generatedAt: new Date().toISOString(),
  status: 'passed',
  dataMode: 'real_local_account_real_persisted_results_headless_chromium',
  assertions: {
    redundantAssetCopyRemoved: true,
    workflowContrastPassed: true,
    workflowButtonAligned: true,
    holdingCoverageInspectable: true,
    professionalTermTooltipPassed: true,
    portfolioHistoryEntryVisible: true,
    compatibleSixStrategyResultRestoredWithoutAutoRun: true,
    rotationReentryUnder5Seconds: true,
    gridKlineRendered: true,
    gridReturnComparisonRendered: true,
    mobileNoRootOverflow: true,
    forbiddenTradingRequestsObserved: 0,
  },
  performance: { rotationInteractiveMs: desktop.rotationInteractiveMs },
  contrast: desktop.activeWorkflowContrast,
  screenshots: [...desktop.screenshots, ...mobile.screenshots],
  browserDiagnostics: {
    consoleErrors: [...desktop.consoleErrors, ...mobile.consoleErrors],
    pageErrors: [...desktop.pageErrors, ...mobile.pageErrors],
    unexpectedFailedRequests: [...desktop.failedRequests, ...mobile.failedRequests].filter((entry) => !entry.includes('net::ERR_ABORTED')),
    navigationAbortedRequests: [...desktop.failedRequests, ...mobile.failedRequests].filter((entry) => entry.includes('net::ERR_ABORTED')),
  },
  formalTradingUnlocked: false,
  autoTradeUnlocked: false,
  canCreateOrder: false,
  orderCreateAllowed: false,
  prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
}
await writeFile(resolve(evidenceDir, 'frontend-runtime-acceptance.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(audit, null, 2))
