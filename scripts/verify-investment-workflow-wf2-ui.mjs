import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(new URL('.', import.meta.url).pathname, '..')
const frontendUrl = process.env.FAMS_WF2_FRONTEND_URL || 'http://127.0.0.1:3000'
const evidenceDir = path.join(root, 'docs', 'automation-audits', 'investment-workflow', 'WF-2', 'evidence')
const playwrightLibPath = path.join(root, '.verification', 'playwright-libs', 'lib')

async function main() {
  await mkdir(evidenceDir, { recursive: true })
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}` : playwrightLibPath
  const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
  const errors = []
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${frontendUrl}/positions`, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.getByTestId('investment-workflow-bar').waitFor({ timeout: 60_000 })
    await page.getByTestId('position-strategy-assignment-panel').waitFor({ timeout: 60_000 })
    const text = await page.locator('body').innerText()
    for (const expected of ['基本信息确认', '仓位策略', '回测复盘', '确认每项资产采用哪类研究策略', '不限制你直接打开任何专家页面']) {
      assert.ok(text.includes(expected), `positions workflow missing: ${expected}`)
    }
    const readinessResponse = await page.request.get('http://127.0.0.1:4000/api/v1/investment-workflow/readiness?userId=default')
    assert.equal(readinessResponse.ok(), true)
    const readiness = await readinessResponse.json()
    assert.equal(readiness.permissionState.formalTradingUnlocked, false)
    assert.equal(readiness.permissionState.autoTradeUnlocked, false)
    assert.equal(readiness.permissionState.canCreateOrder, false)
    assert.equal(readiness.permissionState.orderCreateAllowed, false)
    assert.equal(readiness.strategies.every((item) => typeof item.researchReady === 'boolean' && Array.isArray(item.blockers)), true)
    await page.screenshot({ path: path.join(evidenceDir, 'wf2-positions-desktop.png'), fullPage: true })

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await mobile.goto(`${frontendUrl}/positions`, { waitUntil: 'networkidle', timeout: 120_000 })
    await mobile.getByTestId('investment-workflow-bar').waitFor({ timeout: 60_000 })
    const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 2, `mobile page overflow ${overflow}px`)
    await mobile.screenshot({ path: path.join(evidenceDir, 'wf2-positions-mobile.png'), fullPage: true })
    assert.deepEqual(errors.filter((item) => !item.includes('favicon')), [])

    const audit = {
      schemaVersion: 'fams.wf2-ui-e2e-audit.v1', generatedAt: new Date().toISOString(), status: 'passed',
      readiness: {
        openPositionCount: readiness.facts.openPositionCount,
        pendingAssignmentCount: readiness.facts.pendingAssignmentCount,
        perStrategyGateCount: readiness.strategies.length,
      },
      viewportResults: [
        { width: 1440, screenshot: 'evidence/wf2-positions-desktop.png', passed: true },
        { width: 390, screenshot: 'evidence/wf2-positions-mobile.png', horizontalOverflowPx: overflow, passed: true },
      ],
      tradeBoundary: readiness.permissionState,
      consoleErrors: errors,
    }
    await writeFile(path.join(evidenceDir, 'wf2_ui_e2e_audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify(audit, null, 2))
  } finally {
    await browser.close()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
