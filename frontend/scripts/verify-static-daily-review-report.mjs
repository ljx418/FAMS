import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { Script } from 'node:vm'
import { chromium } from 'playwright'

const repoRoot = resolve(import.meta.dirname, '../..')
const localBrowserLibDir = resolve(repoRoot, '.verification/playwright-libs/lib')
process.env.LD_LIBRARY_PATH = [localBrowserLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
const reportPath = resolve(repoRoot, process.env.FAMS_DAILY_REVIEW_REPORT || '.verification/private/daily-review/open-review.html')
const evidenceDir = resolve(repoRoot, '.verification/private/daily-review/static-report-runtime')
const staticOnly = process.argv.includes('--static-only')
const viewports = [
  { name: 'desktop', width: 1440, height: 960 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
]

await mkdir(evidenceDir, { recursive: true })
const html = await readFile(reportPath, 'utf8')
const applicationJson = html.match(/<script type="application\/json" id="order-data">([\s\S]*?)<\/script>/)?.[1]
const runtimeScript = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1]
assert.ok(applicationJson, 'order-data script missing')
assert.ok(runtimeScript, 'runtime script missing')
const orderData = JSON.parse(applicationJson)
new Script(runtimeScript, { filename: reportPath })
const staticPreflight = {
  schemaVersion: 'fams.daily-review-static-report-preflight.v1',
  generatedAt: new Date().toISOString(),
  status: 'pass',
  reportPath,
  orderRows: orderData.length,
  chartTabs: (html.match(/class="chart-tab"/g) || []).length,
  chartPanels: (html.match(/class="chart-panel"/g) || []).length,
  attentionCards: (html.match(/<article class="attention /g) || []).length,
  auditChecks: (html.match(/<div class="audit-item">/g) || []).length,
  runtimeScriptCompiles: true,
  workbenchPort: html.includes('http://localhost:3000/daily-reviews/') ? 3000 : null,
  fallbackStrategyDisclosure: html.includes('未绑定激活策略版本；本轮网格来自系统研究回退，必须人工确认'),
}
assert.equal(staticPreflight.orderRows, 15)
assert.equal(staticPreflight.chartTabs, 6)
assert.equal(staticPreflight.chartPanels, 6)
assert.equal(staticPreflight.attentionCards, 6)
assert.equal(staticPreflight.auditChecks, 32)
assert.equal(staticPreflight.workbenchPort, 3000)
assert.equal(staticPreflight.fallbackStrategyDisclosure, true)
assert.equal(html.includes('http://localhost:5173/'), false)
await writeFile(resolve(evidenceDir, 'preflight.json'), `${JSON.stringify(staticPreflight, null, 2)}\n`, 'utf8')

if (staticOnly) {
  console.log(JSON.stringify(staticPreflight, null, 2))
  process.exit(0)
}

const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, locale: 'zh-CN', reducedMotion: 'reduce' })
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (entry) => { if (entry.type() === 'error') consoleErrors.push(entry.text()) })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(pathToFileURL(reportPath).href, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByRole('heading', { name: '先降集中度，再做两只 ETF 的波动网格' }).waitFor()
    assert.equal(await page.locator('#orders tbody tr').count(), 15)
    assert.equal(await page.locator('.chart-tab').count(), 6)
    assert.equal(await page.locator('.attention').count(), 6)
    assert.equal(await page.locator('.audit-item').count(), 32)
    assert.equal(await page.locator('.chart-panel:not([hidden])').count(), 1)
    const secondTab = page.locator('.chart-tab').nth(1)
    const target = await secondTab.getAttribute('data-target')
    await secondTab.click()
    assert.equal(await page.locator('.chart-panel:not([hidden])').getAttribute('data-chart'), target)
    const pageWidth = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
    assert.ok(pageWidth.scroll <= pageWidth.client + 1, `page overflow: ${JSON.stringify(pageWidth)}`)
    assert.deepEqual(consoleErrors, [])
    assert.deepEqual(pageErrors, [])
    const screenshot = resolve(evidenceDir, `${viewport.name}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    results.push({ ...viewport, screenshot, pageWidth, orderRows: 15, chartTabs: 6, attentionCards: 6, auditChecks: 32, consoleErrors, pageErrors })
    await context.close()
  }
} finally {
  await browser.close()
}

const result = {
  schemaVersion: 'fams.daily-review-static-report-runtime.v1',
  generatedAt: new Date().toISOString(),
  status: 'pass',
  reportPath,
  results,
}
await writeFile(resolve(evidenceDir, 'runtime.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(result, null, 2))
