import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.FAMS_FRONTEND_URL || 'http://127.0.0.1:3000'
const backendUrl = process.env.FAMS_BACKEND_URL || 'http://127.0.0.1:4000'
const evidenceDir = path.resolve('docs/automation-audits/investment-workflow/WF-4/evidence')
await mkdir(evidenceDir, { recursive: true })

const allocationResponse = await fetch(`${backendUrl}/api/v1/positions/allocation-plan/default`)
if (!allocationResponse.ok) throw new Error(`allocation plan HTTP ${allocationResponse.status}`)
const allocationPlan = await allocationResponse.json()
const earlyConfirmationResponse = await fetch(`${backendUrl}/api/v1/positions/allocation-policy/default/confirm-permanent`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ confirmed: true, confirmedBy: 'wf4-headless-contract' }),
})
const earlyConfirmationBody = await earlyConfirmationResponse.json()

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
const audit = {
  schemaVersion: 'fams.investment-workflow.wf4-ui-audit.v1',
  generatedAt: new Date().toISOString(),
  baseUrl,
  realAccountState: {
    planStatus: allocationPlan.status,
    strategyId: allocationPlan.strategyContract?.id,
    strategyStatus: allocationPlan.strategyContract?.status,
    capturedAt: allocationPlan.capturedAt,
    totalAssetValue: allocationPlan.totalAssetValue,
    transitionConfirmationRequired: allocationPlan.strategyTransition?.confirmationRequired,
    manualDraftAllowed: allocationPlan.strategyTransition?.manualDraftAllowed,
    earlyConfirmationHttpStatus: earlyConfirmationResponse.status,
    earlyConfirmationCode: earlyConfirmationBody.code,
  },
  viewports: [],
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
    await page.goto(`${baseUrl}/dividend-low-vol`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByText('普通模式：先看结论和下一步').waitFor({ timeout: 120_000 })
    await page.getByTestId('dividend-plain-next-step').waitFor({ timeout: 30_000 })
    const workflowVisible = await page.getByTestId('investment-workflow-bar').isVisible()
    const expertWorkbenchHidden = await page.getByTestId('dividend-expert-workbench').count() === 0
    const expertTitleHidden = await page.getByText('红利低波 5 步工作台').count() === 0
    const bodyOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    const screenshotPath = path.join(evidenceDir, `wf4-${viewport.name}.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })

    await page.getByText('专业模式', { exact: true }).click()
    await page.getByTestId('dividend-expert-workbench').waitFor({ timeout: 30_000 })
    const expertWorkbenchVisible = await page.getByTestId('dividend-expert-workbench').isVisible()
    const expertTitleVisible = await page.getByText('红利低波 5 步工作台').isVisible()

    audit.viewports.push({
      ...viewport,
      screenshot: path.relative(process.cwd(), screenshotPath),
      consoleErrorCount: consoleErrors.length,
      consoleErrors,
      bodyHorizontalOverflow: bodyOverflow,
      workflowVisible,
      plainNextStepVisible: true,
      expertWorkbenchHidden,
      expertTitleHidden,
      expertWorkbenchVisibleAfterToggle: expertWorkbenchVisible,
      expertTitleVisibleAfterToggle: expertTitleVisible,
    })
    await page.close()
  }

  audit.assertions = {
    realCurrentStrategyActive: audit.realAccountState.strategyStatus === 'active',
    realCurrentDateDoesNotRequireTransition: audit.realAccountState.transitionConfirmationRequired === false,
    realPlanAllowsManualDraftOnly: audit.realAccountState.manualDraftAllowed === true,
    earlyPermanentTransitionBlocked: audit.realAccountState.earlyConfirmationHttpStatus === 409
      && audit.realAccountState.earlyConfirmationCode === 'ALIPAY_STRATEGY_TRANSITION_NOT_AVAILABLE',
    plainModeIsDefault: audit.viewports.every((item) => item.plainNextStepVisible),
    plainModeHidesExpertWorkbench: audit.viewports.every((item) => item.expertWorkbenchHidden && item.expertTitleHidden),
    expertModePreservesWorkbench: audit.viewports.every((item) => item.expertWorkbenchVisibleAfterToggle && item.expertTitleVisibleAfterToggle),
    workflowRelationshipVisible: audit.viewports.every((item) => item.workflowVisible),
    noConsoleErrors: audit.viewports.every((item) => item.consoleErrorCount === 0),
    noPageHorizontalOverflow: audit.viewports.every((item) => item.bodyHorizontalOverflow === false),
    formalTradingRemainsLocked: allocationPlan.executionBoundary?.formalTradingUnlocked === false,
    autoTradeRemainsLocked: allocationPlan.executionBoundary?.autoTradeUnlocked === false,
    orderCreationRemainsBlocked: allocationPlan.executionBoundary?.canCreateOrder === false
      && allocationPlan.executionBoundary?.orderCreateAllowed === false,
  }
  const passed = Object.values(audit.assertions).every(Boolean)
  await writeFile(path.join(evidenceDir, 'wf4-ui-audit.json'), JSON.stringify({ ...audit, status: passed ? 'passed' : 'failed' }, null, 2))
  if (!passed) throw new Error(`WF-4 UI audit failed: ${JSON.stringify(audit.assertions)}`)
  console.log(JSON.stringify({ status: 'passed', ...audit.assertions }, null, 2))
} finally {
  await browser.close()
}
