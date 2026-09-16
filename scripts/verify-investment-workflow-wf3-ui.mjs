import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.FAMS_FRONTEND_URL || 'http://127.0.0.1:3000'
const evidenceDir = path.resolve('docs/automation-audits/investment-workflow/WF-3/evidence')
await mkdir(evidenceDir, { recursive: true })

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
const audit = {
  schemaVersion: 'fams.investment-workflow.wf3-ui-audit.v1',
  generatedAt: new Date().toISOString(),
  baseUrl,
  viewports: [],
  realAccountState: {},
  assertions: {},
}

try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } })
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.goto(`${baseUrl}/relative-rotation`, { waitUntil: 'networkidle', timeout: 120_000 })
    await page.getByTestId('rotation-strategy-decision-panel').waitFor({ timeout: 30_000 })
    const panelText = await page.getByTestId('rotation-strategy-decision-panel').innerText()
    const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    const screenshotPath = path.join(evidenceDir, `wf3-${viewport.name}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })
    audit.viewports.push({
      ...viewport,
      screenshot: path.relative(process.cwd(), screenshotPath),
      consoleErrorCount: consoleErrors.length,
      bodyHorizontalOverflow: bodyOverflow,
      panelVisible: true,
    })
    if (viewport.name === 'desktop') {
      audit.realAccountState = {
        assignmentConfirmationRequired: panelText.includes('尚无已确认的行业轮动/波动仓资产'),
        recoveryActionVisible: panelText.includes('前往仓位管理确认归类'),
        manualPlanBoundaryVisible: panelText.includes('只生成人工计划'),
      }
    }
    await page.close()
  }
  audit.assertions = {
    allScreenshotsCreated: audit.viewports.length === 2,
    noConsoleErrors: audit.viewports.every((item) => item.consoleErrorCount === 0),
    noPageHorizontalOverflow: audit.viewports.every((item) => item.bodyHorizontalOverflow === false),
    honestUnconfirmedState: audit.realAccountState.assignmentConfirmationRequired === true,
    recoveryActionVisible: audit.realAccountState.recoveryActionVisible === true,
    manualPlanBoundaryVisible: audit.realAccountState.manualPlanBoundaryVisible === true,
  }
  const passed = Object.values(audit.assertions).every(Boolean)
  await writeFile(path.join(evidenceDir, 'wf3-ui-audit.json'), JSON.stringify({ ...audit, status: passed ? 'passed' : 'failed' }, null, 2))
  if (!passed) throw new Error(`WF-3 UI audit failed: ${JSON.stringify(audit.assertions)}`)
  console.log(JSON.stringify({ status: 'passed', ...audit.assertions }, null, 2))
} finally {
  await browser.close()
}
