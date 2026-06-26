import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendDir = path.join(repoRoot, 'backend')
const frontendDir = path.join(repoRoot, 'frontend')
const generatedAt = new Date().toISOString()
const stamp = generatedAt.replace(/[:.]/g, '-')
const reportDir = path.join(backendDir, 'data', 'gpt-audit', 'full-system-e2e', stamp)
const screenshotDir = path.join(reportDir, 'screenshots')
const backendUrl = process.env.FAMS_E2E_BACKEND_URL || 'http://127.0.0.1:4000'
const frontendUrl = process.env.FAMS_E2E_FRONTEND_URL || 'http://127.0.0.1:3100'
const playwrightLibPath = path.join(repoRoot, '.verification', 'playwright-libs', 'lib')
const spawned = []

const statusRank = { passed: 0, not_applicable: 1, blocked: 2, failed: 3 }

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function summarizeOutput(value, max = 1800) {
  const text = stripAnsi(value)
  if (text.length <= max) return text
  return `${text.slice(0, Math.floor(max / 2))}\n...\n${text.slice(-Math.floor(max / 2))}`
}

function nowMs() {
  return Date.now()
}

async function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath)
  return readFile(absolutePath, 'utf8').catch(() => '')
}

async function waitForUrl(url, timeoutMs = 120000) {
  const startedAt = nowMs()
  let lastError = null
  while (nowMs() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

async function ensureServer(name, url, command, cwd, readyUrl = url) {
  try {
    await waitForUrl(readyUrl, 3000)
    return { name, status: 'passed', reusedExisting: true, readyUrl }
  } catch {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...process.env, HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
    child.stderr.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`))
    spawned.push(child)
    await waitForUrl(readyUrl, 120000)
    return { name, status: 'passed', reusedExisting: false, readyUrl }
  }
}

async function ensureFrontendServer() {
  try {
    const response = await waitForUrl(frontendUrl, 3000)
    const text = await response.text()
    if (text.includes('/src/') || text.includes('id="root"')) {
      return { name: 'frontend', status: 'passed', reusedExisting: true, readyUrl: frontendUrl }
    }
  } catch {
    // Start a dedicated strict-port Vite instance below.
  }
  const child = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3100', '--strictPort'], {
    cwd: frontendDir,
    env: { ...process.env, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => process.stdout.write(`[frontend] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[frontend] ${chunk}`))
  spawned.push(child)
  await waitForUrl(frontendUrl, 120000)
  return { name: 'frontend', status: 'passed', reusedExisting: false, readyUrl: frontendUrl }
}

async function runCommand(name, command, cwd, timeoutMs = 240000) {
  const startedAt = nowMs()
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...process.env, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 3000).unref()
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('close', (code) => {
      clearTimeout(timer)
      const durationMs = nowMs() - startedAt
      resolve({
        name,
        command: command.join(' '),
        cwd: path.relative(repoRoot, cwd) || '.',
        status: timedOut ? 'failed' : code === 0 ? 'passed' : 'failed',
        exitCode: code,
        durationMs,
        stdout: summarizeOutput(stdout),
        stderr: summarizeOutput(stderr),
        timedOut,
      })
    })
  })
}

async function apiCheck(name, url, options, predicate, summary) {
  const startedAt = nowMs()
  try {
    const response = await fetch(url, options)
    const text = await response.text()
    let body = null
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text
    }
    const passed = response.ok && (!predicate || predicate(body, response))
    return {
      name,
      url,
      method: options?.method || 'GET',
      status: passed ? 'passed' : 'failed',
      httpStatus: response.status,
      durationMs: nowMs() - startedAt,
      summary: summary ? summary(body, response) : body,
    }
  } catch (error) {
    return {
      name,
      url,
      method: options?.method || 'GET',
      status: 'failed',
      durationMs: nowMs() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function screenshot(page, fileName, title, description, requiredTexts = []) {
  const filePath = path.join(screenshotDir, fileName)
  const bodyText = await page.locator('body').innerText({ timeout: 30000 }).catch(() => '')
  const missingTexts = requiredTexts.filter((text) => !bodyText.includes(text))
  // Keep screenshots viewport-scoped for stability. Some strategy pages are very
  // tall after data loads, and full-page screenshots can close Chromium on WSL.
  await page.screenshot({ path: filePath, fullPage: false })
  return {
    title,
    description,
    fileName,
    path: path.relative(reportDir, filePath).replaceAll('\\', '/'),
    status: missingTexts.length === 0 ? 'passed' : 'failed',
    requiredTexts,
    missingTexts,
  }
}

async function waitForBodyText(page, texts, timeoutMs = 120000) {
  const startedAt = nowMs()
  while (nowMs() - startedAt < timeoutMs) {
    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (texts.every((text) => bodyText.includes(text))) return bodyText
    await page.waitForTimeout(1000)
  }
  const bodyText = await page.locator('body').innerText().catch(() => '')
  throw new Error(`Timed out waiting for text: ${texts.filter((text) => !bodyText.includes(text)).join(', ')}`)
}

function assessOverall(sections) {
  return sections.reduce((worst, item) => (
    statusRank[item.status] > statusRank[worst] ? item.status : worst
  ), 'passed')
}

async function buildDocumentAudit() {
  const [prd, backtestPlan, targetGap, architecture, drawio] = await Promise.all([
    readText('docs/DIVIDEND_LOW_VOL_PRD.md'),
    readText('docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md'),
    readText('docs/TARGET_ARCHITECTURE_GAP.md'),
    readText('docs/ARCHITECTURE_CURRENT_TARGET.md'),
    readText('docs/target-architecture-gap.drawio'),
  ])

  const checks = [
    {
      id: 'prd_research_boundary',
      label: 'PRD 明确研究/观察边界',
      status: prd.includes('formalTradingUnlocked=false') && prd.includes('AUTO_TRADE') ? 'passed' : 'failed',
      evidence: 'DIVIDEND_LOW_VOL_PRD.md',
    },
    {
      id: 'prd_manual_draft_path',
      label: 'PRD 覆盖人工交易计划草案路径',
      status: prd.includes('MANUAL_TRADE_DRAFT') && prd.includes('manualTradeDraftReady') ? 'passed' : 'failed',
      evidence: 'DIVIDEND_LOW_VOL_PRD.md',
    },
    {
      id: 'portfolio_backtest_goal',
      label: '组合回测文档覆盖多组合曲线目标',
      status: backtestPlan.includes('收益') && backtestPlan.includes('曲线') && backtestPlan.includes('portfolio-backtest') ? 'passed' : 'failed',
      evidence: 'PORTFOLIO_STRATEGY_BACKTEST_PLAN.md',
    },
    {
      id: 'drawio_current_target',
      label: 'Drawio 覆盖当前架构与目标架构差异',
      status: drawio.includes('当前') && drawio.includes('目标') && drawio.includes('验收') ? 'passed' : 'failed',
      evidence: 'target-architecture-gap.drawio',
    },
    {
      id: 'doc_drift_proxy_etf',
      label: '组合回测文档仍可能保留 ETF proxy 阻塞旧描述',
      status: backtestPlan.includes('blocked_by_proxy_etf_market_data') ? 'blocked' : 'passed',
      evidence: 'PORTFOLIO_STRATEGY_BACKTEST_PLAN.md',
      note: '若自动化测试证明 permanent/all_weather 已完成，此项应作为文档漂移修复，而不是功能失败。',
    },
    {
      id: 'architecture_trade_gate',
      label: '架构文档覆盖交易 gate 与审计边界',
      status: `${targetGap}\n${architecture}`.includes('trade') || `${targetGap}\n${architecture}`.includes('交易') ? 'passed' : 'blocked',
      evidence: 'TARGET_ARCHITECTURE_GAP.md / ARCHITECTURE_CURRENT_TARGET.md',
    },
  ]

  return {
    status: assessOverall(checks),
    checks,
    summary: {
      prdLength: prd.length,
      backtestPlanLength: backtestPlan.length,
      targetGapLength: targetGap.length,
      drawioLength: drawio.length,
    },
  }
}

async function buildCodeInspectionAudit() {
  const paths = {
    appRoutes: 'frontend/src/App.tsx',
    appLayout: 'frontend/src/components/layout/AppLayout.tsx',
    dividendPage: 'frontend/src/pages/DividendLowVol.tsx',
    backtestPage: 'frontend/src/pages/Backtest.tsx',
    operationsPage: 'frontend/src/pages/Operations.tsx',
    analysisPage: 'frontend/src/pages/Analysis.tsx',
    analysisService: 'frontend/src/services/analysisService.ts',
    backendIndex: 'backend/src/index.ts',
    strategyRoutes: 'backend/src/routes/strategy.ts',
    analysisRoutes: 'backend/src/routes/analysis.ts',
    portfolioBacktestRoutes: 'backend/src/routes/portfolioBacktest.ts',
    operationRoutes: 'backend/src/routes/operation.ts',
  }
  const source = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, relativePath]) => [
    key,
    await readText(relativePath),
  ])))
  const checks = [
    {
      id: 'frontend_route_dividend_low_vol',
      label: '前端存在红利低波独立路由',
      status: source.appRoutes.includes('path="dividend-low-vol"') && source.appLayout.includes("key: 'dividend-low-vol'") ? 'passed' : 'failed',
      evidence: `${paths.appRoutes} / ${paths.appLayout}`,
    },
    {
      id: 'frontend_route_backtest',
      label: '前端存在组合策略回测入口',
      status: source.appRoutes.includes('path="backtest"') && source.appLayout.includes("key: 'backtest'") ? 'passed' : 'failed',
      evidence: `${paths.appRoutes} / ${paths.appLayout}`,
    },
    {
      id: 'frontend_route_operations',
      label: '前端存在任务中心追溯入口',
      status: source.appRoutes.includes('path="operations"') && source.appLayout.includes("key: 'operations'") ? 'passed' : 'failed',
      evidence: `${paths.appRoutes} / ${paths.appLayout}`,
    },
    {
      id: 'frontend_dividend_research_boundary',
      label: '红利低波页面明确非交易指令和 AUTO_TRADE 禁止',
      status: source.dividendPage.includes('不构成交易指令') && source.dividendPage.includes('AUTO_TRADE') ? 'passed' : 'failed',
      evidence: paths.dividendPage,
    },
    {
      id: 'frontend_dividend_filters_and_zones',
      label: '红利低波页面包含筛选排序、买卖观察区间和滚动回测',
      status: source.dividendPage.includes('筛选与排序') && source.dividendPage.includes('买入/卖出观察区间') && source.dividendPage.includes('滚动回测') ? 'passed' : 'failed',
      evidence: paths.dividendPage,
    },
    {
      id: 'frontend_backtest_formal_review_fields',
      label: '组合回测页面展示数据等级、模型有效性、草案和正式交易锁',
      status: source.backtestPage.includes('数据等级') && source.backtestPage.includes('模型有效性') && source.backtestPage.includes('草案') && source.backtestPage.includes('正式交易') ? 'passed' : 'failed',
      evidence: paths.backtestPage,
    },
    {
      id: 'frontend_analysis_fivd_r',
      label: '分析建议页包含 FIVD-R 统一分析与交易阻断说明',
      status: source.analysisPage.includes('FIVD-R 统一分析') && source.analysisPage.includes('交易阻断') ? 'passed' : 'failed',
      evidence: paths.analysisPage,
    },
    {
      id: 'backend_dividend_routes',
      label: '后端暴露红利低波候选、交易区间、回测和 FIVD-R adapter',
      status: source.strategyRoutes.includes('/dividend-low-vol/candidates') && source.strategyRoutes.includes('/dividend-low-vol/trading-zones') && source.strategyRoutes.includes('/dividend-low-vol/rolling-backtest') && source.strategyRoutes.includes('/dividend-low-vol/fivd-r/candidates') ? 'passed' : 'failed',
      evidence: paths.strategyRoutes,
    },
    {
      id: 'backend_portfolio_backtest_routes',
      label: '后端暴露组合回测 templates/run 与正式交易解锁审计产物',
      status: source.backendIndex.includes('portfolioBacktestRoutes') && source.portfolioBacktestRoutes.includes('/templates') && source.portfolioBacktestRoutes.includes('/run') && source.portfolioBacktestRoutes.includes('formal_trading_unlock_checklist') ? 'passed' : 'failed',
      evidence: `${paths.backendIndex} / ${paths.portfolioBacktestRoutes}`,
    },
    {
      id: 'backend_operation_artifacts',
      label: '后端 Operation 支持 artifact 读取',
      status: source.operationRoutes.includes('/artifacts/:ref') && source.operationRoutes.includes('getArtifact') ? 'passed' : 'failed',
      evidence: paths.operationRoutes,
    },
    {
      id: 'frontend_service_fivd_and_dividend_api',
      label: '前端服务封装 FIVD-R 与红利低波接口',
      status: source.analysisService.includes('/api/v1/analysis/fivd-r') && source.analysisService.includes('/api/v1/strategy/dividend-low-vol') ? 'passed' : 'failed',
      evidence: paths.analysisService,
    },
  ]
  return {
    status: assessOverall(checks),
    checks,
    summary: {
      inspectedFiles: Object.keys(paths).length,
      passedChecks: checks.filter((item) => item.status === 'passed').length,
      failedChecks: checks.filter((item) => item.status === 'failed').length,
      blockedChecks: checks.filter((item) => item.status === 'blocked').length,
    },
  }
}

function buildPrdCoverage(commandResults, apiResults, screenshots) {
  const hasPassedCommand = (name) => commandResults.some((item) => item.name === name && item.status === 'passed')
  const hasPassedApi = (name) => apiResults.some((item) => item.name === name && item.status === 'passed')
  const hasPassedShot = (title) => screenshots.some((item) => item.title === title && item.status === 'passed')
  const rows = [
    {
      capability: '红利低波独立菜单和研究模式说明',
      status: hasPassedShot('红利低波策略页') ? 'passed' : 'failed',
      evidence: '前端截图 /dividend-low-vol',
    },
    {
      capability: '候选池指标、筛选、排序和数据完整性展示',
      status: hasPassedShot('红利低波筛选与指标') && hasPassedApi('红利低波候选池') ? 'passed' : 'failed',
      evidence: '截图 + /api/v1/strategy/dividend-low-vol/candidates',
    },
    {
      capability: '买入/卖出观察区间和滚动策略展示',
      status: hasPassedShot('红利低波买卖区间') ? 'passed' : 'blocked',
      evidence: '前端截图；若未先运行区间生成，报告为 blocked',
    },
    {
      capability: '人工计划草案与交易 gate',
      status: hasPassedShot('人工计划草案 Gate') && hasPassedCommand('trade action readiness') ? 'passed' : 'failed',
      evidence: '前端截图 + test:trade-action-readiness',
    },
    {
      capability: '组合策略多曲线回测',
      status: hasPassedShot('组合回测结果') && hasPassedCommand('portfolio backtest API contract') ? 'passed' : 'failed',
      evidence: '前端截图 + test:portfolio-backtest-api-contract',
    },
    {
      capability: '任务中心产物追溯',
      status: hasPassedShot('任务中心产物') ? 'passed' : 'blocked',
      evidence: '前端截图 /operations',
    },
    {
      capability: '正式交易和自动交易禁止',
      status: hasPassedCommand('trade action readiness') && hasPassedApi('组合回测 API') ? 'passed' : 'failed',
      evidence: '命令 + API prohibitedActions',
    },
    {
      capability: 'FIVD-R 统一分析入口和交易阻断可见',
      status: hasPassedShot('FIVD-R 分析建议') && hasPassedCommand('fivd-r core') ? 'passed' : 'failed',
      evidence: '截图 /analysis?section=fivdr + test:fivd-r-core',
    },
    {
      capability: '跨设备基础可读性截图',
      status: screenshots.some((item) => item.title === '移动端组合回测') && screenshots.some((item) => item.title === '平板端红利低波') ? 'passed' : 'failed',
      evidence: 'Playwright desktop/tablet/mobile screenshots',
    },
  ]
  return { status: assessOverall(rows), rows }
}

function testCoverage(commandResults) {
  const required = [
    ['typescript', 'TypeScript 编译'],
    ['sqlite health', 'SQLite 运行时健康'],
    ['dividend low vol api', '红利低波 API 合同'],
    ['dividend low vol audit package', '红利低波审计包'],
    ['dividend low vol rolling backtest', '红利低波滚动回测'],
    ['dividend low vol validation retest', '红利低波验证 retest'],
    ['dividend low vol frontend runtime', '红利低波前端静态合同'],
    ['fivd-r core', 'FIVD-R 核心合同'],
    ['fivd-r trade gate contract', 'FIVD-R 交易 gate 合同'],
    ['portfolio strategy backtest', '组合策略回测服务'],
    ['portfolio backtest API contract', '组合回测 API 与 artifact 合同'],
    ['production readiness', '生产就绪 gate'],
    ['trade action readiness', '交易动作 gate'],
    ['frontend build', '前端构建'],
  ]
  const rows = required.map(([name, label]) => {
    const result = commandResults.find((item) => item.name === name)
    return {
      name,
      label,
      status: result?.status || 'blocked',
      evidence: result ? `${result.command} (${result.durationMs}ms)` : '命令未执行',
    }
  })
  return { status: assessOverall(rows), rows }
}

async function runBrowserEvidence(apiResults) {
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}`
    : playwrightLibPath

  const screenshots = []
  const consoleErrors = []

  async function withPage(viewport, task) {
    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport })
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(error.message))
    try {
      await task(page)
    } finally {
      await browser.close().catch(() => {})
    }
  }

  async function captureFailure(title, error) {
    screenshots.push({
      title,
      description: '自动化浏览器路径未完整走通。',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  try {
    await withPage({ width: 1440, height: 1100 }, async (page) => {
      await page.goto(`${frontendUrl}/dashboard`, { waitUntil: 'networkidle', timeout: 120000 })
      await waitForBodyText(page, ['FAMS'])
      screenshots.push(await screenshot(page, '01-dashboard.png', '总览与侧边栏', '证明左侧菜单和系统入口可见。', ['FAMS', '红利低波策略', '策略回测']))
    })
  } catch (error) {
    await captureFailure('总览与侧边栏异常', error)
  }

  try {
    await withPage({ width: 1440, height: 1100 }, async (page) => {
      await page.goto(`${frontendUrl}/analysis?section=fivdr`, { waitUntil: 'networkidle', timeout: 120000 })
      await waitForBodyText(page, ['分析建议', 'FIVD-R'], 120000)
      screenshots.push(await screenshot(page, '02-analysis-fivd-r.png', 'FIVD-R 分析建议', '证明 FIVD-R 统一分析入口、研究/交易阻断语义可见。', ['FIVD-R', '交易', '建议']))
    })
  } catch (error) {
    await captureFailure('FIVD-R 分析建议异常', error)
  }

  try {
    await withPage({ width: 1440, height: 1100 }, async (page) => {
      await page.goto(`${frontendUrl}/dividend-low-vol`, { waitUntil: 'networkidle', timeout: 120000 })
      await waitForBodyText(page, ['红利低波策略', '不构成交易指令'])
      screenshots.push(await screenshot(page, '03-dividend-low-vol-overview.png', '红利低波策略页', '独立菜单页、研究模式 banner、禁止交易动作。', ['红利低波策略', '不构成交易指令', 'AUTO_TRADE']))
      await page.getByText('筛选与排序').scrollIntoViewIfNeeded().catch(() => {})
      screenshots.push(await screenshot(page, '04-dividend-low-vol-filters.png', '红利低波筛选与指标', '候选池筛选、排序和指标说明区域。', ['筛选与排序', '排序指标', '综合分']))
      await page.getByText('买入/卖出观察区间与滚动策略').scrollIntoViewIfNeeded().catch(() => {})
      screenshots.push(await screenshot(page, '05-dividend-low-vol-zones.png', '红利低波买卖区间', '买入/卖出观察区间、滚动回测和区间免责声明。', ['买入/卖出观察区间', '正式 ADD', '正式 REDUCE']))
      await page.getByText('人工交易计划草案 Gate').scrollIntoViewIfNeeded().catch(() => {})
      screenshots.push(await screenshot(page, '06-dividend-low-vol-manual-gate.png', '人工计划草案 Gate', '人工计划草案 readiness、Top3 草案和交易 gate。', ['人工交易计划草案 Gate', '正式买入/卖出']))
    })
  } catch (error) {
    await captureFailure('红利低波主路径异常', error)
  }

  try {
    await withPage({ width: 768, height: 1024 }, async (page) => {
      await page.goto(`${frontendUrl}/dividend-low-vol`, { waitUntil: 'networkidle', timeout: 120000 })
      await waitForBodyText(page, ['红利低波策略'], 120000)
      screenshots.push(await screenshot(page, '07-tablet-dividend-low-vol.png', '平板端红利低波', '平板视口下验证红利低波页面可读性。', ['红利低波策略']))
    })
  } catch (error) {
    await captureFailure('平板端红利低波异常', error)
  }

  try {
    await withPage({ width: 1440, height: 1100 }, async (page) => {
      await page.goto(`${frontendUrl}/backtest`, { waitUntil: 'networkidle', timeout: 120000 })
      await waitForBodyText(page, ['组合策略对比回测', '运行组合回测'])
      screenshots.push(await screenshot(page, '08-backtest-before-run.png', '组合回测入口', '组合回测参数和非交易建议 banner。', ['组合策略对比回测', '不构成交易指令', '运行组合回测']))
      await page.getByRole('button', { name: '运行组合回测' }).click()
      await waitForBodyText(page, ['超额收益', 'Benchmark', '非交易建议'], 120000)
      screenshots.push(await screenshot(page, '09-backtest-result.png', '组合回测结果', '组合净值曲线、收益指标、benchmark 和分红贡献。', ['Benchmark', '超额收益', '总收益']))
      await page.setViewportSize({ width: 390, height: 844 })
      screenshots.push(await screenshot(page, '10-mobile-backtest-result.png', '移动端组合回测', '移动视口下验证组合回测结果仍可访问和阅读。', ['策略回测']))
    })
  } catch (error) {
    await captureFailure('组合回测路径异常', error)
  }

  try {
    await withPage({ width: 1440, height: 1100 }, async (page) => {
      const portfolioApi = apiResults.find((item) => item.name === '组合回测 API')
      const firstArtifactRef = portfolioApi?.summary?.firstArtifactRef
      const operationId = portfolioApi?.summary?.operationId
      const operationsUrl = firstArtifactRef
        ? `${frontendUrl}/operations?operationId=${encodeURIComponent(operationId || '')}&artifactRef=${encodeURIComponent(firstArtifactRef)}`
        : `${frontendUrl}/operations${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`
      await page.goto(operationsUrl, { waitUntil: 'networkidle', timeout: 120000 })
      await waitForBodyText(page, ['任务中心'], 120000)
      await page.waitForTimeout(2000)
      screenshots.push(await screenshot(page, '11-operations-artifact.png', '任务中心产物', '任务中心 operation 与 artifact 可追溯。', ['任务中心', firstArtifactRef ? '任务产物' : '组合回测']))
    })
  } catch (error) {
    await captureFailure('任务中心产物异常', error)
  }

  return {
    status: consoleErrors.length === 0 ? assessOverall(screenshots) : 'failed',
    screenshots,
    consoleErrors: consoleErrors.slice(0, 20),
  }
}

async function runBrowserEvidenceLegacy(apiResults) {
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}`
    : playwrightLibPath

  const screenshots = []
  const consoleErrors = []
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  try {
    await page.goto(`${frontendUrl}/dashboard`, { waitUntil: 'networkidle', timeout: 120000 })
    await waitForBodyText(page, ['FAMS'])
    screenshots.push(await screenshot(page, '01-dashboard.png', '总览与侧边栏', '证明左侧菜单和系统入口可见。', ['FAMS', '红利低波策略', '策略回测']))

    await page.goto(`${frontendUrl}/analysis?section=fivdr`, { waitUntil: 'networkidle', timeout: 120000 })
    await waitForBodyText(page, ['分析建议', 'FIVD-R'], 120000)
    screenshots.push(await screenshot(page, '02-analysis-fivd-r.png', 'FIVD-R 分析建议', '证明 FIVD-R 统一分析入口、研究/交易阻断语义可见。', ['FIVD-R', '交易', '建议']))

    await page.goto(`${frontendUrl}/dividend-low-vol`, { waitUntil: 'networkidle', timeout: 120000 })
    await waitForBodyText(page, ['红利低波策略', '不构成交易指令'])
    screenshots.push(await screenshot(page, '03-dividend-low-vol-overview.png', '红利低波策略页', '独立菜单页、研究模式 banner、禁止交易动作。', ['红利低波策略', '不构成交易指令', 'AUTO_TRADE']))
    await page.getByText('筛选与排序').scrollIntoViewIfNeeded().catch(() => {})
    screenshots.push(await screenshot(page, '04-dividend-low-vol-filters.png', '红利低波筛选与指标', '候选池筛选、排序和指标说明区域。', ['筛选与排序', '排序指标', '综合分']))
    await page.getByText('买入/卖出观察区间与滚动策略').scrollIntoViewIfNeeded().catch(() => {})
    screenshots.push(await screenshot(page, '05-dividend-low-vol-zones.png', '红利低波买卖区间', '买入/卖出观察区间、滚动回测和区间免责声明。', ['买入/卖出观察区间', '正式 ADD', '正式 REDUCE']))
    await page.getByText('人工交易计划草案 Gate').scrollIntoViewIfNeeded().catch(() => {})
    screenshots.push(await screenshot(page, '06-dividend-low-vol-manual-gate.png', '人工计划草案 Gate', '人工计划草案 readiness、Top3 草案和交易 gate。', ['人工交易计划草案 Gate', '正式买入/卖出']))
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto(`${frontendUrl}/dividend-low-vol`, { waitUntil: 'networkidle', timeout: 120000 })
    await waitForBodyText(page, ['红利低波策略'], 120000)
    screenshots.push(await screenshot(page, '07-tablet-dividend-low-vol.png', '平板端红利低波', '平板视口下验证红利低波页面可读性。', ['红利低波策略']))
    await page.setViewportSize({ width: 1440, height: 1100 })

    await page.goto(`${frontendUrl}/backtest`, { waitUntil: 'networkidle', timeout: 120000 })
    await waitForBodyText(page, ['组合策略对比回测', '运行组合回测'])
    screenshots.push(await screenshot(page, '08-backtest-before-run.png', '组合回测入口', '组合回测参数和非交易建议 banner。', ['组合策略对比回测', '不构成交易指令', '运行组合回测']))
    await page.getByRole('button', { name: '运行组合回测' }).click()
    await waitForBodyText(page, ['超额收益', 'Benchmark', '非交易建议'], 120000)
    screenshots.push(await screenshot(page, '09-backtest-result.png', '组合回测结果', '组合净值曲线、收益指标、benchmark 和分红贡献。', ['Benchmark', '超额收益', '总收益']))
    await page.setViewportSize({ width: 390, height: 844 })
    screenshots.push(await screenshot(page, '10-mobile-backtest-result.png', '移动端组合回测', '移动视口下验证组合回测结果仍可访问和阅读。', ['策略回测']))
    await page.setViewportSize({ width: 1440, height: 1100 })

    const portfolioApi = apiResults.find((item) => item.name === '组合回测 API')
    const firstArtifactRef = portfolioApi?.summary?.firstArtifactRef
    const operationId = portfolioApi?.summary?.operationId
    const operationsUrl = firstArtifactRef
      ? `${frontendUrl}/operations?operationId=${encodeURIComponent(operationId || '')}&artifactRef=${encodeURIComponent(firstArtifactRef)}`
      : `${frontendUrl}/operations${operationId ? `?operationId=${encodeURIComponent(operationId)}` : ''}`
    await page.goto(operationsUrl, { waitUntil: 'networkidle', timeout: 120000 })
    await waitForBodyText(page, ['任务中心'], 120000)
    await page.waitForTimeout(2000)
    screenshots.push(await screenshot(page, '11-operations-artifact.png', '任务中心产物', '任务中心 operation 与 artifact 可追溯。', ['任务中心', firstArtifactRef ? '任务产物' : '组合回测']))
  } catch (error) {
    screenshots.push({
      title: '浏览器验收异常',
      description: '自动化浏览器路径未完整走通。',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    await browser.close().catch(() => {})
  }

  return {
    status: consoleErrors.length === 0 ? assessOverall(screenshots) : 'failed',
    screenshots,
    consoleErrors: consoleErrors.slice(0, 20),
  }
}

function renderStatus(status) {
  const label = {
    passed: '通过',
    failed: '失败',
    blocked: '阻塞',
    not_applicable: '不适用',
  }[status] || status
  return `<span class="status ${escapeHtml(status)}">${escapeHtml(label)}</span>`
}

function renderJson(value) {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`
}

function renderReport(model) {
  const overall = model.overallStatus
  const screenshotHtml = model.browser.screenshots.map((shot) => `
    <section class="shot">
      <div class="shot-head"><h3>${escapeHtml(shot.title)}</h3>${renderStatus(shot.status)}</div>
      <p>${escapeHtml(shot.description || shot.error || '')}</p>
      ${shot.path ? `<a href="${escapeHtml(shot.path)}"><img src="${escapeHtml(shot.path)}" alt="${escapeHtml(shot.title)}" /></a>` : ''}
      ${shot.missingTexts?.length ? `<p class="warn">缺少文本：${escapeHtml(shot.missingTexts.join(' / '))}</p>` : ''}
    </section>
  `).join('\n')

  const commandRows = model.commands.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${renderStatus(item.status)}</td>
      <td><code>${escapeHtml(item.cwd)}$ ${escapeHtml(item.command)}</code></td>
      <td>${escapeHtml(item.durationMs)}ms</td>
      <td>${item.stderr ? `<details><summary>stderr</summary><pre>${escapeHtml(item.stderr)}</pre></details>` : ''}${item.stdout ? `<details><summary>stdout</summary><pre>${escapeHtml(item.stdout)}</pre></details>` : ''}</td>
    </tr>
  `).join('\n')

  const apiRows = model.api.map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${renderStatus(item.status)}</td>
      <td><code>${escapeHtml(item.method)} ${escapeHtml(item.url)}</code></td>
      <td>${escapeHtml(item.httpStatus || '--')}</td>
      <td>${renderJson(item.summary || item.error || {})}</td>
    </tr>
  `).join('\n')

  const prdRows = model.prdCoverage.rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.capability)}</td>
      <td>${renderStatus(item.status)}</td>
      <td>${escapeHtml(item.evidence)}</td>
    </tr>
  `).join('\n')

  const testRows = model.testCoverage.rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.label)}</td>
      <td>${renderStatus(item.status)}</td>
      <td>${escapeHtml(item.evidence)}</td>
    </tr>
  `).join('\n')

  const docRows = model.documentAudit.checks.map((item) => `
    <tr>
      <td>${escapeHtml(item.label)}</td>
      <td>${renderStatus(item.status)}</td>
      <td>${escapeHtml(item.evidence)}</td>
      <td>${escapeHtml(item.note || '')}</td>
    </tr>
  `).join('\n')

  const codeRows = model.codeInspection.checks.map((item) => `
    <tr>
      <td>${escapeHtml(item.label)}</td>
      <td>${renderStatus(item.status)}</td>
      <td>${escapeHtml(item.evidence)}</td>
    </tr>
  `).join('\n')

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FAMS 全系统端到端自动化验收报告</title>
  <style>
    :root { color-scheme: dark; --bg:#0f172a; --panel:#111827; --muted:#94a3b8; --line:#334155; --ok:#22c55e; --bad:#ef4444; --warn:#f59e0b; --info:#38bdf8; }
    body { margin:0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:var(--bg); color:#e5e7eb; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px 20px 64px; }
    h1, h2, h3 { margin: 0 0 12px; }
    h2 { margin-top: 28px; border-bottom:1px solid var(--line); padding-bottom: 8px; }
    p { color:#cbd5e1; line-height:1.65; }
    .hero, .card, .shot { background:rgba(17,24,39,.92); border:1px solid var(--line); border-radius:8px; padding:18px; margin:16px 0; }
    .grid { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:12px; }
    .metric { border:1px solid var(--line); border-radius:8px; padding:14px; background:#0b1220; }
    .metric .label { color:var(--muted); font-size:12px; }
    .metric .value { font-size:22px; margin-top:8px; }
    .status { display:inline-flex; align-items:center; border-radius:999px; padding:3px 10px; font-size:12px; font-weight:700; }
    .passed { color:#052e16; background:var(--ok); }
    .failed { color:#450a0a; background:var(--bad); }
    .blocked { color:#422006; background:var(--warn); }
    .not_applicable { color:#082f49; background:var(--info); }
    table { width:100%; border-collapse: collapse; margin:12px 0 20px; }
    th, td { border:1px solid var(--line); padding:10px; vertical-align:top; text-align:left; }
    th { background:#0b1220; color:#dbeafe; }
    code { color:#bfdbfe; }
    pre { max-height:260px; overflow:auto; white-space:pre-wrap; background:#020617; border:1px solid #1e293b; border-radius:6px; padding:10px; color:#cbd5e1; }
    img { max-width:100%; border:1px solid var(--line); border-radius:8px; margin-top:10px; background:#020617; }
    .shot-head { display:flex; justify-content:space-between; gap:12px; align-items:center; }
    .warn { color:#fbbf24; }
    .small { font-size:13px; color:var(--muted); }
  </style>
</head>
<body>
<main>
  <section class="hero">
    <h1>FAMS 全系统端到端自动化验收报告</h1>
    <p>生成时间：${escapeHtml(model.generatedAt)}。本报告基于原始 PRD、目标架构文档、代码实现、自动化命令、API 交叉验证和无头浏览器截图生成。报告不构成投资建议，不将研究验证包装为正式交易验证。</p>
    <div class="grid">
      <div class="metric"><div class="label">总体结论</div><div class="value">${renderStatus(overall)}</div></div>
      <div class="metric"><div class="label">Research Ready</div><div class="value">${escapeHtml(model.summary.researchReady)}</div></div>
      <div class="metric"><div class="label">Manual Draft Ready</div><div class="value">${escapeHtml(model.summary.manualDraftReady)}</div></div>
      <div class="metric"><div class="label">Formal Trading</div><div class="value">${escapeHtml(model.summary.formalTradingUnlocked)}</div></div>
      <div class="metric"><div class="label">Auto Trade</div><div class="value">${escapeHtml(model.summary.autoTradeUnlocked)}</div></div>
    </div>
  </section>

  <h2>目标架构与当前实现</h2>
  <div class="card">
    <p>目标架构是“数据源与证据层 → 策略/回测/验证层 → Operation 审计层 → 前端研究体验层 → 交易 Gate”。当前实现已经覆盖红利低波研究页、组合回测页、任务中心 artifact、人工计划草案和交易 gate；仍需对正式 total-return benchmark、免费数据最新性、正式交易验证做持续审计。</p>
    ${renderJson(model.architecture)}
  </div>

  <h2>PRD 功能覆盖矩阵</h2>
  <table><thead><tr><th>功能点</th><th>状态</th><th>证据</th></tr></thead><tbody>${prdRows}</tbody></table>

  <h2>测试覆盖矩阵</h2>
  <table><thead><tr><th>测试项</th><th>状态</th><th>证据</th></tr></thead><tbody>${testRows}</tbody></table>

  <h2>文档一致性审计</h2>
  <table><thead><tr><th>检查项</th><th>状态</th><th>文档</th><th>备注</th></tr></thead><tbody>${docRows}</tbody></table>

  <h2>代码检视矩阵</h2>
  <div class="card">
    <p>该矩阵只检查代码中是否存在与 PRD 功能对应的入口、页面、接口和交易边界；它不是视觉验收，视觉结果以下方截图为准。</p>
  </div>
  <table><thead><tr><th>检查项</th><th>状态</th><th>证据文件</th></tr></thead><tbody>${codeRows}</tbody></table>

  <h2>用户场景截图证据</h2>
  ${screenshotHtml}

  <h2>API 交叉验证</h2>
  <table><thead><tr><th>检查</th><th>状态</th><th>请求</th><th>HTTP</th><th>摘要</th></tr></thead><tbody>${apiRows}</tbody></table>

  <h2>自动化命令证据</h2>
  <table><thead><tr><th>命令</th><th>状态</th><th>执行</th><th>耗时</th><th>输出</th></tr></thead><tbody>${commandRows}</tbody></table>

  <h2>限制与不通过项</h2>
  <div class="card">
    <ul>
      ${model.limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')}
    </ul>
  </div>
</main>
</body>
</html>`
}

async function main() {
  await mkdir(screenshotDir, { recursive: true })

  const documentAudit = await buildDocumentAudit()
  const codeInspection = await buildCodeInspectionAudit()
  const commands = [
    ['typescript', ['node', 'node_modules/typescript/bin/tsc'], backendDir, 240000],
    ['sqlite health', ['npm', 'run', 'check:sqlite-health'], backendDir, 180000],
    ['dividend low vol api', ['npm', 'run', 'test:dividend-low-vol-api'], backendDir, 240000],
    ['dividend low vol audit package', ['npm', 'run', 'test:dividend-low-vol-audit-package'], backendDir, 240000],
    ['dividend low vol rolling backtest', ['npm', 'run', 'test:dividend-low-vol-rolling-backtest'], backendDir, 240000],
    ['dividend low vol validation retest', ['npm', 'run', 'test:dividend-low-vol-validation-retest'], backendDir, 240000],
    ['dividend low vol frontend runtime', ['npm', 'run', 'test:dividend-low-vol-frontend-runtime'], backendDir, 180000],
    ['fivd-r core', ['npm', 'run', 'test:fivd-r-core'], backendDir, 240000],
    ['fivd-r trade gate contract', ['npm', 'run', 'test:fivd-r-trade-gate-contract'], backendDir, 240000],
    ['portfolio strategy backtest', ['npm', 'run', 'test:portfolio-strategy-backtest'], backendDir, 240000],
    ['portfolio backtest API contract', ['npm', 'run', 'test:portfolio-backtest-api-contract'], backendDir, 240000],
    ['production readiness', ['npm', 'run', 'test:production-readiness'], backendDir, 240000],
    ['trade action readiness', ['npm', 'run', 'test:trade-action-readiness'], backendDir, 240000],
    ['frontend build', ['npm', 'run', 'build'], frontendDir, 240000],
  ]

  const commandResults = []
  for (const [name, command, cwd, timeoutMs] of commands) {
    // eslint-disable-next-line no-await-in-loop
    commandResults.push(await runCommand(name, command, cwd, timeoutMs))
  }

  const serverResults = []
  try {
    serverResults.push(await ensureServer(
      'backend',
      backendUrl,
      ['node', 'node_modules/tsx/dist/cli.mjs', 'src/index.ts'],
      backendDir,
      `${backendUrl}/health`,
    ))
    serverResults.push(await ensureFrontendServer())
  } catch (error) {
    serverResults.push({
      name: 'server startup',
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const apiResults = []
  apiResults.push(await apiCheck('后端健康', `${backendUrl}/health`, {}, (body) => body?.status === 'ok', (body) => ({
    status: body?.status,
    database: body?.database,
    operations: body?.operations,
  })))
  apiResults.push(await apiCheck('红利低波候选池', `${backendUrl}/api/v1/strategy/dividend-low-vol/candidates?limit=50&scope=all&persistedOnly=true`, {}, (body) => Array.isArray(body?.candidates), (body) => ({
    schemaVersion: body?.schemaVersion,
    candidates: body?.candidates?.length || 0,
    candidateCount: body?.candidateCount,
    allowedActions: body?.allowedActions,
    prohibitedActions: body?.prohibitedActions,
    completeness: body?.metricCompletenessSummary,
  })))
  apiResults.push(await apiCheck('红利低波 V2 研究验证', `${backendUrl}/api/v1/strategy/dividend-low-vol/v2/research-validation`, {}, (body) => body?.validationDecision?.usableForTradingAdvice === false || body?.status, (body) => ({
    status: body?.status,
    usableForTradingAdvice: body?.validationDecision?.usableForTradingAdvice,
    prohibitedActions: body?.validationDecision?.prohibitedActions,
    artifactRef: body?.artifactRef,
  })))
  apiResults.push(await apiCheck('组合回测模板', `${backendUrl}/api/v1/portfolio-backtest/templates`, {}, (body) => Array.isArray(body?.templates), (body) => ({
    templates: body?.templates?.map((item) => item.strategyId),
    prohibitedActions: body?.prohibitedActions,
    notTradingAdvice: body?.notTradingAdvice,
  })))
  apiResults.push(await apiCheck('组合回测 API', `${backendUrl}/api/v1/portfolio-backtest/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: 'default',
      portfolioStrategyIds: ['local_real_data_sample_60_40', 'permanent_portfolio', 'all_weather'],
      startDate: '2025-12-04',
      endDate: '2026-06-05',
      initialCapital: 100000,
      rebalanceFrequency: 'quarterly',
      dividendMode: 'reinvest',
      feeRate: 0.0003,
      slippageRate: 0.0005,
      benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20'],
      executionMode: 'operation',
    }),
  }, (body) => body?.status === 'completed' && Array.isArray(body?.artifactRefs), (body) => ({
    operationId: body?.operationId,
    status: body?.status,
    artifactCount: body?.artifactRefs?.length || 0,
    firstArtifactRef: body?.artifactRefs?.[0],
    prohibitedActions: body?.prohibitedActions,
    strategyStatuses: body?.result?.strategies?.map((item) => ({
      strategyId: item.definition?.strategyId,
      status: item.status,
      curvePoints: item.equityCurve?.length || 0,
      totalReturnPercent: item.metrics?.totalReturnPercent,
      dividendContributionPercent: item.metrics?.dividendContributionPercent,
    })),
  })))

  const browser = serverResults.every((item) => item.status === 'passed')
    ? await runBrowserEvidence(apiResults)
    : { status: 'blocked', screenshots: [], consoleErrors: ['Server startup failed; browser validation skipped.'] }

  const prdCoverage = buildPrdCoverage(commandResults, apiResults, browser.screenshots)
  const coverage = testCoverage(commandResults)
  const criticalSections = [
    documentAudit,
    codeInspection,
    prdCoverage,
    coverage,
    browser,
    { status: assessOverall(commandResults) },
    { status: assessOverall(apiResults) },
    { status: assessOverall(serverResults) },
  ]
  const overallStatus = assessOverall(criticalSections)

  const summary = {
    researchReady: prdCoverage.rows.some((item) => item.capability.includes('红利低波') && item.status === 'passed') ? 'yes' : 'partial_or_blocked',
    manualDraftReady: commandResults.find((item) => item.name === 'production readiness')?.status === 'passed' ? 'yes_if_gate_evidence_ready' : 'blocked',
    formalTradingUnlocked: 'false',
    autoTradeUnlocked: 'false',
  }

  const model = {
    schemaVersion: 'fams.full_system_e2e_acceptance.v1',
    generatedAt,
    reportDir,
    overallStatus,
    summary,
    architecture: {
      target: [
        '数据源与证据层：免费数据源/Tushare 升级源、行情、分红、行业龙头、交易约束、evidenceRefs。',
        '策略与验证层：红利低波、组合回测、滚动策略、validation retest、failure taxonomy。',
        'Operation 审计层：所有重任务落 Operation 与 artifact，支持任务中心追溯。',
        '前端体验层：独立红利低波、组合回测、任务中心、持仓和告警路径。',
        '交易 Gate：研究/观察/计划草案与正式交易动作隔离，AUTO_TRADE 禁止。',
      ],
      current: [
        '已实现红利低波独立菜单、候选池、筛选排序、买卖区间、滚动回测和人工草案 gate。',
        '已实现组合策略多曲线回测、永久组合/全天候代理 ETF 路径、Operation artifact。',
        '已实现生产/交易 gate 合同测试；正式自动交易仍未开放。',
        '仍需持续审计正式 total-return benchmark、免费数据最新性与文档漂移。',
      ],
    },
    documentAudit,
    codeInspection,
    prdCoverage,
    testCoverage: coverage,
    commands: commandResults,
    servers: serverResults,
    api: apiResults,
    browser,
    limitations: [
      '报告仅使用无头浏览器截图，不抢占桌面焦点。',
      '若免费数据源或本地缓存不是最新交易日，报告会保留数据新鲜度风险，不会声明每日实时保证。',
      'tradeActionReadiness 通过只代表 gate 行为正确，不代表策略可以自动交易。',
      '若组合回测文档仍保留旧的 ETF proxy 阻塞描述，而 API 已通过，将作为文档漂移处理。',
      '正式 total-return benchmark 与完整外部数据源仍需单独审计，不能因此报告直接解锁正式交易。',
    ],
  }

  await writeFile(path.join(reportDir, 'summary.json'), JSON.stringify(model, null, 2))
  await writeFile(path.join(reportDir, 'prd-coverage-matrix.json'), JSON.stringify(prdCoverage, null, 2))
  await writeFile(path.join(reportDir, 'test-coverage-matrix.json'), JSON.stringify(coverage, null, 2))
  await writeFile(path.join(reportDir, 'document-consistency-audit.json'), JSON.stringify(documentAudit, null, 2))
  await writeFile(path.join(reportDir, 'code-inspection-audit.json'), JSON.stringify(codeInspection, null, 2))
  await writeFile(path.join(reportDir, 'architecture-current-vs-target.json'), JSON.stringify(model.architecture, null, 2))
  await writeFile(path.join(reportDir, 'acceptance-report.html'), renderReport(model).replace(/[ \t]+$/gm, ''))

  console.log(JSON.stringify({
    ok: overallStatus === 'passed',
    status: overallStatus,
    reportPath: path.join(reportDir, 'acceptance-report.html'),
    summaryPath: path.join(reportDir, 'summary.json'),
    screenshots: browser.screenshots.map((item) => item.path).filter(Boolean),
  }, null, 2))

  if (overallStatus !== 'passed') {
    process.exitCode = 1
  }
}

main()
  .catch(async (error) => {
    await mkdir(reportDir, { recursive: true }).catch(() => {})
    const failure = {
      schemaVersion: 'fams.full_system_e2e_acceptance.failure.v1',
      generatedAt,
      status: 'failed',
      error: error instanceof Error ? error.stack || error.message : String(error),
    }
    await writeFile(path.join(reportDir, 'summary.json'), JSON.stringify(failure, null, 2)).catch(() => {})
    await writeFile(path.join(reportDir, 'acceptance-report.html'), `<html><body><h1>FAMS 全系统验收失败</h1><pre>${escapeHtml(failure.error)}</pre></body></html>`).catch(() => {})
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    for (const child of spawned) {
      child.kill('SIGTERM')
    }
  })
