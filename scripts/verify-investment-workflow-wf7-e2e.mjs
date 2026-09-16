import { chromium } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.FAMS_FRONTEND_URL || 'http://127.0.0.1:3000'
const backendUrl = process.env.FAMS_BACKEND_URL || 'http://127.0.0.1:4000'
const adviceId = process.env.FAMS_WF7_ADVICE_ID || '724b5641-9dbe-4b33-b6a1-4bd9ca61b89a'
const evidenceDir = path.resolve('docs/automation-audits/investment-workflow/WF-7/evidence')
const screenshotDir = path.join(evidenceDir, 'screenshots')
await mkdir(screenshotDir, { recursive: true })

async function fetchJson(pathname) {
  const response = await fetch(`${backendUrl}${pathname}`)
  if (!response.ok) throw new Error(`${pathname} HTTP ${response.status}`)
  return response.json()
}

const normalizeAssignments = (rows) => rows.map((item) => ({
  id: item.id,
  positionId: item.positionId,
  strategyFamily: item.strategyFamily,
  status: item.status,
  source: item.source,
  suggestedAt: item.suggestedAt,
  confirmedAt: item.confirmedAt,
  confirmedBy: item.confirmedBy,
  updatedAt: item.updatedAt,
})).sort((left, right) => left.id.localeCompare(right.id))

const normalizePositions = (rows) => rows.map((item) => ({
  id: item.id,
  assetId: item.assetId,
  assetName: item.asset?.name || null,
  assetSymbol: item.asset?.symbol || null,
  quantity: item.quantity,
  avgCost: item.avgCost,
  positionType: item.positionType,
  status: item.status,
  source: item.source,
  valuationBasis: item.valuationBasis,
  openedAt: item.openedAt,
  closedAt: item.closedAt,
})).sort((left, right) => left.id.localeCompare(right.id))

const normalizeTransactions = (rows) => rows.map((item) => ({
  id: item.id,
  assetId: item.assetId,
  type: item.type,
  quantity: item.quantity,
  price: item.price,
  amount: item.amount,
  fee: item.fee,
  status: item.status,
  executedAt: item.executedAt,
  source: item.source,
})).sort((left, right) => left.id.localeCompare(right.id))

async function getProtectedSnapshot() {
  const [assignments, positions, transactions] = await Promise.all([
    fetchJson('/api/v1/investment-workflow/strategy-assignments?userId=default'),
    fetchJson('/api/v1/positions?userId=default&page=1&limit=100'),
    fetchJson('/api/v1/transactions?userId=default&page=1&limit=500'),
  ])
  return {
    assignments: normalizeAssignments(assignments.assignments || []),
    positions: normalizePositions(positions.positions || positions.data || []),
    transactions: normalizeTransactions(transactions.transactions || transactions.data || []),
  }
}

async function dismissNotifications(page) {
  await page.evaluate(() => document.querySelectorAll('.ant-notification-notice-close').forEach((element) => element.click()))
  await page.waitForTimeout(150)
}

const [health, readiness, protectedBefore] = await Promise.all([
  fetchJson('/health'),
  fetchJson('/api/v1/investment-workflow/readiness?userId=default'),
  getProtectedSnapshot(),
])

const audit = {
  schemaVersion: 'fams.investment-workflow.wf7-full-e2e-audit.v1',
  generatedAt: new Date().toISOString(),
  executionMode: 'headless_chromium_real_local_runtime',
  staticMockHtmlUsed: false,
  runtime: {
    backendStatus: health.status,
    databaseStatus: health.database,
    sqliteHealthy: health.runtimeHealth?.sqliteHealthy === true,
    databaseSizeBytes: health.runtimeHealth?.databaseFileStat?.sizeBytes || null,
    databaseSha256Prefix: health.runtimeHealth?.databaseFileStat?.sha256Prefix || null,
  },
  realAccount: {
    userId: 'default',
    openPositionCount: readiness.facts.openPositionCount,
    transactionCount: protectedBefore.transactions.length,
    pendingAssignmentCount: readiness.facts.pendingAssignmentCount,
    unassignedPositionCount: readiness.facts.unassignedPositionCount,
    confirmedCaptureByAccount: readiness.facts.confirmedCaptureByAccount,
    strategyReadiness: readiness.strategies,
  },
  knownControlledLimits: [
    'default_account_strategy_assignments_pending_human_confirmation',
    'point_in_time_dynamic_recompute_not_implemented_and_must_remain_blocked',
    'screenshot_row_correction_and_final_confirmation_remain_human_actions',
    'free_market_data_is_latest_available_not_exchange_authorized_realtime',
  ],
  viewports: [],
  protectedState: {},
  assertions: {},
}

const browser = await chromium.launch({ headless: true, args: ['--no-proxy-server'] })
try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const page = await browser.newPage({ viewport })
    const consoleErrors = []
    const failedResponses = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('response', (response) => {
      if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() })
    })
    await page.addInitScript(() => window.localStorage.setItem('fams.experienceMode', 'plain'))
    const screenshots = {}

    await page.goto(`${baseUrl}/assets`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('asset-screenshot-primary-entry').waitFor({ timeout: 120_000 })
    await page.getByTestId('investment-workflow-bar').waitFor({ timeout: 30_000 })
    const firstRealAssetName = protectedBefore.positions.find((item) => item.assetName)?.assetName
    if (!firstRealAssetName) throw new Error('real account asset name missing from position snapshot')
    await page.getByText(firstRealAssetName, { exact: true }).first().waitFor({ timeout: 120_000 })
    await page.getByText(`还有 ${readiness.facts.pendingAssignmentCount} 项资产需要确认`, { exact: true }).waitFor({ timeout: 30_000 })
    await dismissNotifications(page)
    screenshots.assets = path.join(screenshotDir, `wf7-${viewport.name}-assets.png`)
    await page.screenshot({ path: screenshots.assets, fullPage: true })
    const assetsVisible = await page.getByTestId('asset-screenshot-primary-entry').isVisible()

    await page.goto(`${baseUrl}/positions`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('position-strategy-assignment-panel').waitFor({ timeout: 120_000 })
    await page.getByText(`还有 ${readiness.facts.pendingAssignmentCount} 项资产需要确认`, { exact: true }).waitFor({ timeout: 30_000 })
    screenshots.positions = path.join(screenshotDir, `wf7-${viewport.name}-positions.png`)
    await page.screenshot({ path: screenshots.positions, fullPage: true })
    const positionsVisible = await page.getByTestId('position-strategy-next-actions').isVisible()

    await page.goto(`${baseUrl}/relative-rotation`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('rotation-strategy-decision-panel').waitFor({ timeout: 120_000 })
    await page.getByText('前往仓位管理确认归类', { exact: false }).waitFor({ timeout: 120_000 })
    const rotationPanelText = await page.getByTestId('rotation-strategy-decision-panel').innerText()
    const rotationReadiness = readiness.strategies.find((item) => item.strategyFamily === 'rotation_volatility')
    const rotationBlockedHonestly = rotationReadiness?.confirmedPositionCount === 0
      && rotationPanelText.includes('尚无已确认的行业轮动/波动仓资产')
    const rotationRecoveryVisible = await page.getByText('前往仓位管理确认归类', { exact: false }).isVisible().catch(() => false)
    const rotationErrorVisible = await page.getByText('策略运行未完成', { exact: true }).isVisible().catch(() => false)
    screenshots.rotation = path.join(screenshotDir, `wf7-${viewport.name}-rotation.png`)
    await page.screenshot({ path: screenshots.rotation, fullPage: true })

    await page.goto(`${baseUrl}/dividend-low-vol`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('dividend-plain-next-step').waitFor({ timeout: 120_000 })
    const dividendPlainVisible = await page.getByText('普通模式：先看结论和下一步').isVisible()
    const dividendExpertHidden = await page.getByTestId('dividend-expert-workbench').count() === 0
    screenshots.dividend = path.join(screenshotDir, `wf7-${viewport.name}-dividend.png`)
    await page.screenshot({ path: screenshots.dividend, fullPage: true })

    await page.goto(`${baseUrl}/backtest?mode=review&adviceId=${encodeURIComponent(adviceId)}`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.getByTestId('run-scenario-comparison').waitFor({ timeout: 120_000 })
    const comparisonResponse = page.waitForResponse((response) => response.url().includes('/api/v1/backtest/scenario-comparison'), { timeout: 150_000 })
    await page.getByTestId('run-scenario-comparison').click({ force: true })
    const response = await comparisonResponse
    if (!response.ok()) throw new Error(`scenario comparison HTTP ${response.status()}`)
    await page.getByTestId('scenario-comparison-result').waitFor({ timeout: 150_000 })
    await dismissNotifications(page)
    const comparisonText = await page.getByTestId('scenario-comparison-result').innerText()
    const scenarioComparisonVisible = ['按建议执行', '不执行建议', '实际交易流水', 'eastmoney'].every((value) => comparisonText.includes(value))
    screenshots.backtest = path.join(screenshotDir, `wf7-${viewport.name}-backtest.png`)
    await page.screenshot({ path: screenshots.backtest, fullPage: true })

    await page.getByTestId('fams-chatbox-trigger').click()
    await page.getByText('FAMS 业务助手', { exact: true }).waitFor({ timeout: 30_000 })
    const chatBoundaryVisible = await page.getByText('研究助手，不创建订单', { exact: true }).isVisible()
    const chatTasksVisible = await page.getByText('查看历史复盘', { exact: true }).isVisible()
    screenshots.chat = path.join(screenshotDir, `wf7-${viewport.name}-chatbox.png`)
    await page.screenshot({ path: screenshots.chat })
    await page.keyboard.press('Escape')

    const bodyHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    audit.viewports.push({
      ...viewport,
      screenshots: Object.fromEntries(Object.entries(screenshots).map(([key, value]) => [key, path.relative(process.cwd(), value)])),
      assetsVisible,
      positionsVisible,
      rotationBlockedHonestly,
      rotationRecoveryVisible,
      rotationErrorVisible,
      dividendPlainVisible,
      dividendExpertHidden,
      scenarioComparisonVisible,
      chatBoundaryVisible,
      chatTasksVisible,
      bodyHorizontalOverflow,
      consoleErrors,
      failedResponses,
    })
    await page.close()
  }

  const protectedAfter = await getProtectedSnapshot()
  const assignmentStateUnchanged = JSON.stringify(protectedBefore.assignments) === JSON.stringify(protectedAfter.assignments)
  const positionFactsUnchanged = JSON.stringify(protectedBefore.positions) === JSON.stringify(protectedAfter.positions)
  const transactionFactsUnchanged = JSON.stringify(protectedBefore.transactions) === JSON.stringify(protectedAfter.transactions)
  audit.protectedState = {
    before: {
      assignmentCount: protectedBefore.assignments.length,
      positionCount: protectedBefore.positions.length,
      transactionCount: protectedBefore.transactions.length,
    },
    after: {
      assignmentCount: protectedAfter.assignments.length,
      positionCount: protectedAfter.positions.length,
      transactionCount: protectedAfter.transactions.length,
    },
    assignmentStateUnchanged,
    positionFactsUnchanged,
    transactionFactsUnchanged,
  }
  audit.assertions = {
    backendAndDatabaseHealthy: audit.runtime.backendStatus === 'ok' && audit.runtime.databaseStatus === 'ok' && audit.runtime.sqliteHealthy,
    realAccountDataPresent: audit.realAccount.openPositionCount > 0 && audit.realAccount.transactionCount > 0,
    currentAssignmentBlockerShownHonestly: audit.realAccount.pendingAssignmentCount > 0
      && audit.viewports.every((item) => item.rotationBlockedHonestly && item.rotationRecoveryVisible && !item.rotationErrorVisible),
    informationAndPositionStepsVisible: audit.viewports.every((item) => item.assetsVisible && item.positionsVisible),
    dividendPlainModeUsable: audit.viewports.every((item) => item.dividendPlainVisible && item.dividendExpertHidden),
    realScenarioComparisonVisible: audit.viewports.every((item) => item.scenarioComparisonVisible),
    chatBoxEntryAndBoundaryVisible: audit.viewports.every((item) => item.chatBoundaryVisible && item.chatTasksVisible),
    threeViewportEvidenceComplete: audit.viewports.length === 3 && audit.viewports.every((item) => Object.keys(item.screenshots).length === 6),
    noHorizontalOverflow: audit.viewports.every((item) => item.bodyHorizontalOverflow === false),
    noConsoleErrors: audit.viewports.every((item) => item.consoleErrors.length === 0),
    noFailedHttpResponses: audit.viewports.every((item) => item.failedResponses.length === 0),
    acceptanceDidNotMutateAccountFacts: assignmentStateUnchanged && positionFactsUnchanged && transactionFactsUnchanged,
    formalTradingRemainsLocked: readiness.permissionState.formalTradingUnlocked === false,
    autoTradeRemainsLocked: readiness.permissionState.autoTradeUnlocked === false,
    orderCreationRemainsBlocked: readiness.permissionState.canCreateOrder === false && readiness.permissionState.orderCreateAllowed === false,
  }
  audit.status = Object.values(audit.assertions).every(Boolean) ? 'passed' : 'failed'
  await writeFile(path.join(evidenceDir, 'wf7-full-e2e-audit.json'), JSON.stringify(audit, null, 2))
  if (audit.status !== 'passed') throw new Error(`WF-7 E2E audit failed: ${JSON.stringify(audit.assertions)}`)
  console.log(JSON.stringify({ status: audit.status, ...audit.assertions }, null, 2))
} finally {
  await browser.close()
}
