import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(new URL('.', import.meta.url).pathname, '..')
const frontendUrl = process.env.FAMS_WF1_FRONTEND_URL || 'http://127.0.0.1:3011'
const evidenceDir = path.join(root, 'docs', 'automation-audits', 'investment-workflow', 'WF-1', 'evidence')
const playwrightLibPath = path.join(root, '.verification', 'playwright-libs', 'lib')

async function main() {
  await mkdir(evidenceDir, { recursive: true })
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}`
    : playwrightLibPath
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
  const consoleErrors = []
  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    desktop.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    desktop.on('pageerror', (error) => consoleErrors.push(error.message))
    await desktop.goto(`${frontendUrl}/assets`, { waitUntil: 'networkidle', timeout: 120_000 })
    await desktop.getByTestId('asset-screenshot-primary-entry').waitFor({ timeout: 60_000 })
    await desktop.getByTestId('position-strategy-assignment-panel').waitFor({ timeout: 60_000 })
    const bodyText = await desktop.locator('body').innerText()
    for (const required of ['从账户截图刷新资产事实', '同花顺资产', '支付宝资产', '确认每项资产采用哪类研究策略', '不会创建、修改或提交券商订单']) {
      assert.ok(bodyText.includes(required), `assets workflow is missing required copy: ${required}`)
    }
    await desktop.screenshot({ path: path.join(evidenceDir, 'wf1-assets-desktop.png'), fullPage: true })

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await mobile.goto(`${frontendUrl}/assets`, { waitUntil: 'networkidle', timeout: 120_000 })
    await mobile.getByTestId('asset-screenshot-primary-entry').waitFor({ timeout: 60_000 })
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 2, `mobile page has horizontal overflow: ${overflow}px`)
    await mobile.screenshot({ path: path.join(evidenceDir, 'wf1-assets-mobile.png'), fullPage: true })

    const relevantConsoleErrors = consoleErrors.filter((item) => !item.includes('favicon'))
    assert.deepEqual(relevantConsoleErrors, [], `browser console errors: ${relevantConsoleErrors.join(' | ')}`)
    const audit = {
      schemaVersion: 'fams.wf1-ui-e2e-audit.v1',
      generatedAt: new Date().toISOString(),
      status: 'passed',
      url: `${frontendUrl}/assets`,
      viewportResults: [
        { width: 1440, height: 1100, screenshot: 'evidence/wf1-assets-desktop.png', passed: true },
        { width: 390, height: 844, screenshot: 'evidence/wf1-assets-mobile.png', horizontalOverflowPx: overflow, passed: true },
      ],
      assertions: {
        screenshotPrimaryEntryVisible: true,
        accountSourceChoiceVisible: true,
        strategyAssignmentPanelVisible: true,
        humanConfirmationBoundaryVisible: true,
        orderCreationBoundaryVisible: true,
      },
      consoleErrors: relevantConsoleErrors,
    }
    await writeFile(path.join(evidenceDir, 'wf1_ui_e2e_audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(audit, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
