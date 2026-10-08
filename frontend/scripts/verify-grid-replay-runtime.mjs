import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const appBase = process.env.FAMS_FRONTEND_E2E_BASE || 'http://127.0.0.1:3000'
const backendBase = process.env.FAMS_BACKEND_E2E_BASE || 'http://127.0.0.1:4000'

const health = await fetch(`${backendBase}/health`)
assert.equal(health.ok, true, `backend health failed: ${health.status}`)

const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport, locale: 'zh-CN', reducedMotion: 'reduce' })
    const page = await context.newPage()
    const pageErrors = []
    const networkErrors = []
    const tradingRequests = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (entry) => {
      const message = entry.text()
      if (entry.type() === 'error' && !message.includes('There may be circular references')) networkErrors.push(message)
    })
    page.on('request', (request) => {
      if (request.method() !== 'GET' && /(?:order-create|auto-trade|broker-order|\/orders?)(?:\/|\?|$)/i.test(request.url())) {
        tradingRequests.push(`${request.method()} ${request.url()}`)
      }
    })

    await page.goto(`${appBase}/backtest?mode=review`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const panel = page.getByTestId('grid-replay-panel')
    await panel.waitFor({ timeout: 30_000 })
    await page.getByText('当前只能展示已有真实证据', { exact: true }).waitFor({ timeout: 60_000 })
    await page.getByText('日内证据不足', { exact: true }).waitFor({ timeout: 30_000 })
    await page.getByText('时序不确定未计入', { exact: true }).waitFor({ timeout: 30_000 })
    const canvasCount = await panel.locator('canvas').count()
    assert.ok(canvasCount >= 1, `${viewport.name}: grid replay chart is missing`)
    const dimensions = await panel.evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }))
    assert.ok(dimensions.scrollWidth <= dimensions.clientWidth + 2, `${viewport.name}: panel overflow ${JSON.stringify(dimensions)}`)
    assert.deepEqual(pageErrors, [], `${viewport.name}: page errors`)
    assert.deepEqual(networkErrors, [], `${viewport.name}: console errors`)
    assert.deepEqual(tradingRequests, [], `${viewport.name}: forbidden trading requests`)
    results.push({ viewport: viewport.name, canvasCount, dimensions })
    await page.close()
    await context.close()
  }
} finally {
  await browser.close()
}

console.log(JSON.stringify({
  ok: true,
  schemaVersion: 'fams.backtest.grid_replay.runtime_acceptance.v1',
  results,
  permissions: {
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
  },
}, null, 2))
