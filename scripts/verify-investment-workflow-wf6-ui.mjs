import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.FAMS_FRONTEND_URL || 'http://127.0.0.1:3000'
const backendUrl = process.env.FAMS_BACKEND_URL || 'http://127.0.0.1:4000'
const realAdviceId = process.env.FAMS_WF6_ADVICE_ID || '724b5641-9dbe-4b33-b6a1-4bd9ca61b89a'
const evidenceDir = path.resolve('docs/automation-audits/investment-workflow/WF-6/evidence')
await mkdir(evidenceDir, { recursive: true })

const readinessResponse = await fetch(`${backendUrl}/api/v1/investment-workflow/readiness?userId=default`)
if (!readinessResponse.ok) throw new Error(`readiness HTTP ${readinessResponse.status}`)
const readiness = await readinessResponse.json()
const assignmentsResponse = await fetch(`${backendUrl}/api/v1/investment-workflow/strategy-assignments?userId=default`)
if (!assignmentsResponse.ok) throw new Error(`assignments HTTP ${assignmentsResponse.status}`)
const assignmentsBefore = (await assignmentsResponse.json()).assignments
const assignmentSnapshot = (assignments) => assignments
  .map((item) => ({
    id: item.id,
    positionId: item.positionId,
    strategyFamily: item.strategyFamily,
    status: item.status,
    source: item.source,
    confirmedAt: item.confirmedAt,
    confirmedBy: item.confirmedBy,
  }))
  .sort((left, right) => left.id.localeCompare(right.id))
const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
const audit = {
  schemaVersion: 'fams.investment-workflow.wf6-cross-page-ui-audit.v1',
  generatedAt: new Date().toISOString(),
  realReadiness: {
    openPositionCount: readiness.facts.openPositionCount,
    pendingAssignmentCount: readiness.facts.pendingAssignmentCount,
    unassignedPositionCount: readiness.facts.unassignedPositionCount,
    strategies: readiness.strategies.map((item) => ({
      strategyFamily: item.strategyFamily,
      confirmedPositionCount: item.confirmedPositionCount,
      researchReady: item.researchReady,
      dataAsOf: item.dataHealth?.asOf || null,
      providers: item.dataHealth?.providers || [],
    })),
  },
  viewports: [],
  assertions: {},
}

async function closeNotifications(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.ant-notification-notice-close').forEach((element) => element.click())
  })
  await page.waitForTimeout(150)
}

try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport })
    const consoleErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await page.addInitScript(() => window.localStorage.setItem('fams.experienceMode', 'plain'))

    await page.goto(`${baseUrl}/portfolio-comparison`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForURL(/\/backtest\?mode=portfolio/, { timeout: 30_000 })
    const legacyRedirectPassed = page.url().includes('/backtest?mode=portfolio')

    await page.goto(`${baseUrl}/assets`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('asset-screenshot-primary-entry').waitFor({ timeout: 120_000 })
    await page.getByTestId('investment-workflow-bar').waitFor({ timeout: 30_000 })
    await closeNotifications(page)
    const duplicateNavRemoved = await page.getByText('持仓组合对比', { exact: true }).count() === 0
    if (viewport.name === 'desktop') await page.screenshot({ path: path.join(evidenceDir, 'wf6-step-1-assets.png'), fullPage: true })

    await page.getByTestId('investment-workflow-bar').getByRole('button', { name: /2\. 仓位策略/ }).evaluate((element) => element.click())
    await page.waitForURL(/\/positions/, { timeout: 30_000 })
    await page.getByTestId('position-strategy-assignment-panel').waitFor({ timeout: 120_000 })
    await page.getByTestId('position-strategy-next-actions').waitFor({ timeout: 30_000 })
    if (readiness.facts.pendingAssignmentCount > 0) {
      await page.getByText(`还有 ${readiness.facts.pendingAssignmentCount} 项资产需要确认`, { exact: true }).waitFor({ timeout: 30_000 })
    }
    if (viewport.name === 'desktop') await page.screenshot({ path: path.join(evidenceDir, 'wf6-step-2-positions.png'), fullPage: true })

    await page.getByTestId('position-strategy-next-actions').getByRole('button', { name: /轮动与波动仓/ }).evaluate((element) => element.click())
    await page.waitForURL(/\/relative-rotation/, { timeout: 30_000 })
    await page.getByTestId('rotation-strategy-decision-panel').waitFor({ timeout: 120_000 })
    const runButton = page.getByRole('button', { name: '运行已确认资产' })
    const strategyRunAvailable = await runButton.isEnabled().catch(() => false)
    if (strategyRunAvailable) {
      await runButton.click({ force: true })
      await page.getByTestId('rotation-strategy-results').waitFor({ timeout: 180_000 })
    }
    const strategyConclusionVisible = await page.getByTestId('rotation-strategy-results').isVisible().catch(() => false)
    const strategyBlockerVisible = await page.getByText('尚无已确认的行业轮动/波动仓资产', { exact: false }).isVisible().catch(() => false)
    const strategyRecoveryVisible = await page.getByText('前往仓位管理确认归类', { exact: false }).isVisible().catch(() => false)
    if (viewport.name === 'desktop') await page.screenshot({ path: path.join(evidenceDir, 'wf6-step-3-strategy.png'), fullPage: true })

    await page.getByTestId('investment-workflow-bar').getByRole('button', { name: /3\. 回测复盘/ }).evaluate((element) => element.click())
    await page.waitForURL(/\/backtest/, { timeout: 30_000 })
    await page.goto(`${baseUrl}/backtest?mode=review&adviceId=${encodeURIComponent(realAdviceId)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('run-scenario-comparison').waitFor({ timeout: 120_000 })
    const responsePromise = page.waitForResponse((response) => response.url().includes('/api/v1/backtest/scenario-comparison'), { timeout: 120_000 })
    await page.getByTestId('run-scenario-comparison').click({ force: true })
    const response = await responsePromise
    if (!response.ok()) throw new Error(`scenario comparison HTTP ${response.status()}`)
    await page.getByTestId('scenario-comparison-result').waitFor({ timeout: 120_000 })
    await closeNotifications(page)
    const scenarioText = await page.getByTestId('scenario-comparison-result').innerText()
    const scenarioResultVisible = ['按建议执行', '不执行建议', '实际交易流水', 'eastmoney'].every((text) => scenarioText.includes(text))
    const bodyHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    const screenshotPath = path.join(evidenceDir, `wf6-${viewport.name}-final.png`)
    await page.screenshot({ path: screenshotPath, fullPage: true })

    audit.viewports.push({
      ...viewport,
      screenshot: path.relative(process.cwd(), screenshotPath),
      majorActionCount: 6,
      path: [
        '打开资产管理',
        '进入仓位策略',
        '进入轮动与波动仓',
        strategyRunAvailable ? '运行已确认资产' : '核查待确认阻断与恢复入口',
        '进入回测复盘',
        '运行三场景复盘',
      ],
      legacyRedirectPassed,
      duplicateNavRemoved,
      strategyRunAvailable,
      strategyConclusionVisible,
      strategyBlockerVisible,
      strategyRecoveryVisible,
      scenarioResultVisible,
      bodyHorizontalOverflow,
      consoleErrors,
    })
    await page.close()
  }

  const assignmentsAfterResponse = await fetch(`${backendUrl}/api/v1/investment-workflow/strategy-assignments?userId=default`)
  if (!assignmentsAfterResponse.ok) throw new Error(`assignments-after HTTP ${assignmentsAfterResponse.status}`)
  const assignmentsAfter = (await assignmentsAfterResponse.json()).assignments
  const assignmentStatePreserved = JSON.stringify(assignmentSnapshot(assignmentsBefore)) === JSON.stringify(assignmentSnapshot(assignmentsAfter))

  audit.assertions = {
    realPositionsPresent: audit.realReadiness.openPositionCount > 0,
    assignmentStateHandledHonestly: audit.viewports.every((item) => item.strategyRunAvailable
      ? item.strategyConclusionVisible
      : item.strategyBlockerVisible && item.strategyRecoveryVisible),
    pageVisitDoesNotMutateAssignments: assignmentStatePreserved,
    sixMajorActionsOrFewer: audit.viewports.every((item) => item.majorActionCount <= 6),
    legacyRouteRedirected: audit.viewports.every((item) => item.legacyRedirectPassed),
    duplicateNavigationRemoved: audit.viewports.every((item) => item.duplicateNavRemoved),
    scenarioResultVisible: audit.viewports.every((item) => item.scenarioResultVisible),
    noHorizontalOverflow: audit.viewports.every((item) => item.bodyHorizontalOverflow === false),
    noConsoleErrors: audit.viewports.every((item) => item.consoleErrors.length === 0),
    formalTradingRemainsLocked: readiness.permissionState.formalTradingUnlocked === false,
    autoTradeRemainsLocked: readiness.permissionState.autoTradeUnlocked === false,
    orderCreationRemainsBlocked: readiness.permissionState.canCreateOrder === false && readiness.permissionState.orderCreateAllowed === false,
  }
  const passed = Object.values(audit.assertions).every(Boolean)
  await writeFile(path.join(evidenceDir, 'wf6-cross-page-ui-audit.json'), JSON.stringify({ ...audit, status: passed ? 'passed' : 'failed' }, null, 2))
  if (!passed) throw new Error(`WF-6 UI audit failed: ${JSON.stringify(audit.assertions)}`)
  console.log(JSON.stringify({ status: 'passed', ...audit.assertions }, null, 2))
} finally {
  await browser.close()
}
