import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.FAMS_FRONTEND_URL || 'http://127.0.0.1:3000'
const realAdviceId = process.env.FAMS_WF5_ADVICE_ID || '724b5641-9dbe-4b33-b6a1-4bd9ca61b89a'
const evidenceDir = path.resolve('docs/automation-audits/investment-workflow/WF-5/evidence')
await mkdir(evidenceDir, { recursive: true })

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
const audit = {
  schemaVersion: 'fams.investment-workflow.wf5-ui-audit.v1',
  generatedAt: new Date().toISOString(),
  baseUrl,
  viewports: [],
  assertions: {},
}

try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport })
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.addInitScript(() => window.localStorage.setItem('fams.experienceMode', 'plain'))
    await page.goto(`${baseUrl}/backtest?mode=review&adviceId=${encodeURIComponent(realAdviceId)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('scenario-review-workspace').waitFor({ timeout: 120_000 })
    await page.getByTestId('run-scenario-comparison').waitFor({ timeout: 120_000 })
    const scenarioResponsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/backtest/scenario-comparison'), { timeout: 120_000 })
    await page.getByTestId('run-scenario-comparison').click()
    const scenarioResponse = await scenarioResponsePromise
    if (!scenarioResponse.ok()) throw new Error(`scenario comparison HTTP ${scenarioResponse.status()}: ${await scenarioResponse.text()}`)
    await page.getByTestId('scenario-comparison-result').waitFor({ timeout: 120_000 })

    const resultText = await page.getByTestId('scenario-comparison-result').innerText()
    const scenarioLabels = ['按建议执行', '不执行建议', '实际交易流水']
    const threeScenariosVisible = scenarioLabels.every((label) => resultText.includes(label))
    const realEvidenceVisible = resultText.includes('eastmoney') && resultText.includes('真实成交核对：exact')
    const tradeBoundaryVisible = resultText.includes('ORDER_CREATE') && resultText.includes('AUTO_TRADE')
    const expertDetailsHidden = await page.getByText('建议模拟 vs 实际执行', { exact: true }).count() === 0
    const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    await page.evaluate(() => {
      document.querySelectorAll('.ant-notification-notice-close').forEach((element) => element.click())
    })
    await page.waitForTimeout(250)
    const screenshotPath = path.join(evidenceDir, `wf5-${viewport.name}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })

    await page.getByTestId('backtest-workspace-switcher').getByText('投资组合回测', { exact: true }).click({ force: true })
    await page.getByTestId('portfolio-backtest-workspace').waitFor({ timeout: 30_000 })
    const portfolioWorkspaceVisible = await page.getByTestId('portfolio-backtest-workspace').isVisible()
    await page.getByTestId('backtest-workspace-switcher').getByText('历史运行', { exact: true }).click({ force: true })
    await page.getByTestId('backtest-history-workspace').waitFor({ timeout: 30_000 })
    const historyWorkspaceVisible = await page.getByTestId('backtest-history-workspace').isVisible()

    audit.viewports.push({
      ...viewport,
      screenshot: path.relative(process.cwd(), screenshotPath),
      consoleErrors,
      bodyHorizontalOverflow: bodyOverflow,
      threeScenariosVisible,
      realEvidenceVisible,
      tradeBoundaryVisible,
      expertDetailsHidden,
      portfolioWorkspaceVisible,
      historyWorkspaceVisible,
    })
    await page.close()
  }

  audit.assertions = {
    threeScenarioResultVisible: audit.viewports.every((item) => item.threeScenariosVisible),
    realDataEvidenceVisible: audit.viewports.every((item) => item.realEvidenceVisible),
    tradeBoundaryVisible: audit.viewports.every((item) => item.tradeBoundaryVisible),
    plainModeHidesExpertDetails: audit.viewports.every((item) => item.expertDetailsHidden),
    portfolioModePreserved: audit.viewports.every((item) => item.portfolioWorkspaceVisible),
    historyModeAvailable: audit.viewports.every((item) => item.historyWorkspaceVisible),
    noConsoleErrors: audit.viewports.every((item) => item.consoleErrors.length === 0),
    noPageHorizontalOverflow: audit.viewports.every((item) => item.bodyHorizontalOverflow === false),
  }
  const passed = Object.values(audit.assertions).every(Boolean)
  await writeFile(path.join(evidenceDir, 'wf5-ui-audit.json'), JSON.stringify({ ...audit, status: passed ? 'passed' : 'failed' }, null, 2))
  if (!passed) throw new Error(`WF-5 UI audit failed: ${JSON.stringify(audit.assertions)}`)
  console.log(JSON.stringify({ status: 'passed', ...audit.assertions }, null, 2))
} finally {
  await browser.close()
}
