import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outputDir = path.join(root, 'docs', 'automation-audits', 'investment-workflow', 'WF-8', 'evidence')
const libDir = path.join(root, '.verification', 'playwright-libs', 'lib')
process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH ? `${libDir}:${process.env.LD_LIBRARY_PATH}` : libDir
await mkdir(outputDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const consoleErrors = []
const failedResponses = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Warning:')) consoleErrors.push(message.text())
  })
  page.on('response', (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() })
  })
  await page.goto('http://localhost:3100/backtest?mode=review', { waitUntil: 'networkidle', timeout: 120000 })
  await page.getByText('选择证据口径并复盘', { exact: true }).waitFor({ state: 'visible', timeout: 60000 })
  await page.getByText('冻结网格策略', { exact: true }).click()
  await page.getByTestId('point-in-time-source').waitFor({ state: 'visible' })
  await page.getByTestId('run-scenario-comparison').click()
  await page.getByTestId('scenario-comparison-result').waitFor({ state: 'visible', timeout: 120000 })
  await page.getByText('按冻结策略逐日执行', { exact: true }).waitFor({ state: 'visible', timeout: 120000 })
  await page.getByText('当前策略回套历史', { exact: true }).waitFor({ state: 'visible' })
  const resultText = await page.getByTestId('scenario-comparison-result').innerText()
  assert.match(resultText, /冻结版本：fams\.grid-strategy\.v2/)
  assert.match(resultText, /日决策 \d+ 个/)
  assert.match(resultText, /正式交易未解锁|研究结果不会创建订单/)
  const notificationClose = page.locator('.ant-notification-notice-close')
  while (await notificationClose.count()) {
    await notificationClose.first().evaluate((element) => element.click())
    await page.waitForTimeout(250)
  }
  assert.equal(await page.locator('.ant-notification-notice').count(), 0, 'screenshots must not be obscured by reminders')
  await page.screenshot({ path: path.join(outputDir, 'point-in-time-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(1200)
  const siderBox = await page.locator('.ant-layout-sider').first().boundingBox()
  assert.ok(!siderBox || siderBox.width <= 1, `mobile desktop sider must collapse, observed width=${siderBox?.width}`)
  await page.screenshot({ path: path.join(outputDir, 'point-in-time-mobile.png'), fullPage: true })
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
  assert.equal(overflow, false, 'mobile page must not overflow horizontally')
  assert.equal(consoleErrors.length, 0, `console errors: ${consoleErrors.join(' | ')}`)
  assert.equal(failedResponses.length, 0, `failed HTTP responses: ${JSON.stringify(failedResponses)}`)

  const audit = {
    schemaVersion: 'fams.investment-workflow.point-in-time-ui-audit.v1',
    status: 'passed',
    generatedAt: new Date().toISOString(),
    gates: {
      frozenStrategyEntryVisible: true,
      dynamicReplayResultVisible: true,
      retrospectiveDisclosureVisible: true,
      desktopScreenshotPassed: true,
      mobileScreenshotPassed: true,
      desktopSiderCollapsedOnMobile: true,
      mobileHorizontalOverflow: false,
      consoleErrorCount: 0,
      failedHttpResponseCount: 0,
    },
    screenshots: ['point-in-time-desktop.png', 'point-in-time-mobile.png'],
  }
  await writeFile(path.join(outputDir, 'point-in-time-ui-audit.json'), JSON.stringify(audit, null, 2))
  console.log(JSON.stringify(audit, null, 2))
} finally {
  await browser.close()
}
