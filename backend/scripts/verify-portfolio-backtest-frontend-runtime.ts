import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const backendDir = resolve(repoRoot, 'backend')
const frontendDir = resolve(repoRoot, 'frontend')
const generatedAt = new Date().toISOString()
const stamp = generatedAt.replace(/[:.]/g, '-')
const auditDir = resolve(backendDir, 'data/gpt-audit/interactive-strategy-backtest', stamp)
const screenshotDir = resolve(auditDir, 'screenshots')
const backendUrl = process.env.FAMS_E2E_BACKEND_URL || 'http://127.0.0.1:4000'
const frontendUrl = process.env.FAMS_E2E_FRONTEND_URL || 'http://127.0.0.1:3100'
const playwrightLibPath = resolve(repoRoot, '.verification/playwright-libs/lib')
const spawned: ChildProcess[] = []

async function waitForUrl(url: string, timeoutMs = 120000) {
  const startedAt = Date.now()
  let lastError: unknown = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return response
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000))
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

async function ensureServer(name: string, url: string, command: string[], cwd: string, readyUrl = url) {
  try {
    await waitForUrl(readyUrl, 3000)
    return { name, reusedExisting: true, readyUrl }
  } catch {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...process.env, HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout?.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
    child.stderr?.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`))
    spawned.push(child)
    await waitForUrl(readyUrl, 120000)
    return { name, reusedExisting: false, readyUrl }
  }
}

async function screenshot(page: any, fileName: string, title: string, requiredTexts: string[]) {
  const path = resolve(screenshotDir, fileName)
  const bodyText = await page.locator('body').innerText({ timeout: 30000 }).catch(() => '')
  const missingTexts = requiredTexts.filter((text) => !bodyText.includes(text))
  await page.screenshot({ path, fullPage: true })
  return {
    title,
    path,
    status: missingTexts.length === 0 ? 'passed' : 'failed',
    requiredTexts,
    missingTexts,
  }
}

async function waitForText(page: any, texts: string[], timeoutMs = 120000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (texts.every((text) => bodyText.includes(text))) return bodyText
    await page.waitForTimeout(1000)
  }
  const bodyText = await page.locator('body').innerText().catch(() => '')
  throw new Error(`Timed out waiting for texts: ${texts.filter((text) => !bodyText.includes(text)).join(', ')}`)
}

async function main() {
  await mkdir(screenshotDir, { recursive: true })
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}`
    : playwrightLibPath
  const backend = await ensureServer('backend', backendUrl, ['npm', 'run', 'dev'], backendDir, `${backendUrl}/health`)
  const frontend = await ensureServer('frontend', frontendUrl, ['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3100', '--strictPort'], frontendDir)

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const consoleErrors: string[] = []
  const portfolioRunRequests: any[] = []
  const fixedRuleDetailRequests: any[] = []
  const savedRunDetailRequests: string[] = []
  page.on('console', (message: any) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => consoleErrors.push(error.message))
  page.on('request', (request: any) => {
    const url = request.url()
    if (request.method() === 'GET' && /\/api\/v1\/portfolio-backtest\/runs\/[^?]+/.test(url)) savedRunDetailRequests.push(url)
  })
  await page.route('**/api/v1/portfolio-backtest/run', async (route: any) => {
    const request = route.request()
    try {
      portfolioRunRequests.push(request.postDataJSON())
    } catch {
      portfolioRunRequests.push({ raw: request.postData() })
    }
    await route.continue()
  })
  await page.route('**/api/v1/portfolio-backtest/fixed-rule-detail', async (route: any) => {
    const request = route.request()
    try {
      fixedRuleDetailRequests.push(request.postDataJSON())
    } catch {
      fixedRuleDetailRequests.push({ raw: request.postData() })
    }
    await route.continue()
  })

  const screenshots = []
  try {
    await page.goto(`${frontendUrl}/backtest`, { waitUntil: 'networkidle', timeout: 120000 })
    await waitForText(page, ['组合策略对比回测', '选择要比较的组合策略', '回测区间', '运行并保存固定规则回测', 'Runtime', '数据可用截止日', '经典 5 组'])
    screenshots.push(await screenshot(page, '01-backtest-entry.png', '组合回测入口与 runtime gate', [
      '组合策略对比回测',
      '选择要比较的组合策略',
      '已选',
      '回测区间',
      '数据可用截止日',
      '经典 5 组',
      '季度再平衡',
      'Runtime',
      'Operation 持久化',
    ]))

    const checkedCountBefore = await page.locator('.ant-checkbox-checked').count()
    const firstChecked = await page.locator('.ant-checkbox-checked input').first().elementHandle()
    if (checkedCountBefore > 1) {
      if (!firstChecked) throw new Error('没有找到已选策略复选框')
      await firstChecked.click()
      const checkedCountAfter = await page.locator('.ant-checkbox-checked').count()
      if (checkedCountAfter >= checkedCountBefore) {
        throw new Error('策略多选控件没有响应取消勾选')
      }
      await firstChecked.click()
      if (await page.locator('.ant-checkbox-checked').count() !== checkedCountBefore) {
        throw new Error('策略多选控件没有响应重新勾选')
      }
    }
    const checkedCountBeforeRun = await page.locator('.ant-checkbox-checked').count()

    await page.getByRole('button', { name: '运行并保存固定规则回测' }).click()
    await waitForText(page, ['正式交易未解锁', '非交易建议', '固定规则组合回测 · 起投日期敏感性', '数据真实性 passed', '图一：指定起投日的资金与仓位曲线', '图二：每周起投到现在的敏感性曲线'], 180000)
    screenshots.push(await screenshot(page, '02-backtest-result.png', '组合回测结果', [
      '正式交易未解锁',
      '允许 RESEARCH / OBSERVE / COMPARE / PLAN_DRAFT',
      '非交易建议',
      'Benchmark',
      '超额收益',
      '成本拖累',
      '固定规则组合回测 · 起投日期敏感性',
      '数据真实性 passed',
      '规则预先冻结',
      '无历史择优',
      '图形选择',
      '图一：指定起投日的资金与仓位曲线',
      '图二：每周起投到现在的敏感性曲线',
      '横截面汇总',
      '交易记录',
      '数据等级',
      '数据治理',
      'local_cache',
      '模型有效性',
      '草案',
      '正式交易',
    ]))
    const latestRequest = portfolioRunRequests[portfolioRunRequests.length - 1]
    if (!latestRequest?.portfolioStrategyIds || latestRequest.portfolioStrategyIds.length !== checkedCountBeforeRun) {
      throw new Error(`组合回测请求体策略数量与 UI 已选数量不一致: request=${latestRequest?.portfolioStrategyIds?.length}, ui=${checkedCountBeforeRun}`)
    }
    if (latestRequest.portfolioStrategyIds.includes('custom_weight_portfolio')) {
      throw new Error('禁用的 custom_weight_portfolio 被提交到组合回测请求体')
    }
    if (!latestRequest.startDate || !latestRequest.endDate) {
      throw new Error('组合回测请求体缺少日期区间')
    }
    if (latestRequest.startDate !== '2023-08-29' || latestRequest.endDate !== '2026-08-28') {
      throw new Error(`三年回测日期不符合冻结口径: ${latestRequest.startDate} ~ ${latestRequest.endDate}`)
    }
    if (latestRequest.ruleMode !== 'registry_fixed') {
      throw new Error('组合回测请求体未冻结为 registry_fixed')
    }
    if (latestRequest.scenarioAnalysis?.enabled !== false || latestRequest.scenarioAnalysis.policyIds?.length !== 1 || latestRequest.scenarioAnalysis.policyIds[0] !== 'quarterly') {
      throw new Error('固定规则回测不应启用历史规则择优')
    }
    if (!latestRequest.startDateSensitivity?.enabled || latestRequest.startDateSensitivity?.sampling !== 'weekly_first_trading_day') {
      throw new Error('组合回测请求体缺少每周起投敏感性')
    }
    const chartCanvases = page.locator('[data-testid="fixed-rule-study"] canvas')
    if (await chartCanvases.count() < 2) throw new Error('固定规则双图未完整渲染')
    for (let index = 0; index < 2; index += 1) {
      const chartBox = await chartCanvases.nth(index).boundingBox()
      if (!chartBox || chartBox.width <= 0 || chartBox.height <= 0) throw new Error(`固定规则图表 ${index + 1} canvas 未正确渲染`)
    }
    await page.getByRole('button', { name: '累计盈亏', exact: true }).click()
    await page.getByRole('button', { name: '实际权重', exact: true }).click()
    await page.getByRole('button', { name: '横截面汇总', exact: true }).click()
    const shortcuts = page.locator('[data-testid="sensitivity-start-shortcuts"] button')
    if (await shortcuts.count() < 2) throw new Error('起投日下钻快捷入口不足')
    const shortcutText = await shortcuts.nth(1).innerText()
    const selectedDate = shortcutText.replace('起点', '').trim()
    await shortcuts.nth(1).click()
    await waitForText(page, [`当前起点 ${selectedDate}`], 120000)
    if (fixedRuleDetailRequests.length === 0) throw new Error('起投日点选未触发固定规则明细请求')
    const historySelect = page.locator('.ant-select').filter({ hasText: '打开已保存回测' }).first()
    if (await historySelect.count() !== 1) throw new Error('未找到已保存回测选择器')
    await historySelect.click()
    const historyOption = page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option').first()
    await historyOption.waitFor({ state: 'visible', timeout: 30000 })
    await historyOption.click()
    await waitForText(page, ['固定规则组合回测 · 起投日期敏感性', '图一：指定起投日的资金与仓位曲线'], 60000)
    if (savedRunDetailRequests.length === 0) throw new Error('已保存回测选择器未触发历史运行详情请求')
  } finally {
    await browser.close().catch(() => undefined)
  }

  const audit = {
    schemaVersion: 'interactive_strategy_backtest.frontend_runtime_evidence.v1',
    generatedAt,
    status: screenshots.every((item) => item.status === 'passed') && consoleErrors.length === 0 ? 'passed' : 'failed',
    backend,
    frontend,
    screenshots,
    assertions: {
      portfolioRunRequestCaptured: portfolioRunRequests.length > 0,
      latestPortfolioRunRequest: portfolioRunRequests[portfolioRunRequests.length - 1] || null,
      fixedRuleDetailRequestCaptured: fixedRuleDetailRequests.length > 0,
      latestFixedRuleDetailRequest: fixedRuleDetailRequests[fixedRuleDetailRequests.length - 1] || null,
      savedRunDetailRequestCaptured: savedRunDetailRequests.length > 0,
      latestSavedRunDetailRequest: savedRunDetailRequests[savedRunDetailRequests.length - 1] || null,
    },
    consoleErrors: consoleErrors.slice(0, 20),
    notTradingAdvice: true,
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'PLAN_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
  }
  const auditPath = resolve(auditDir, '03_frontend_runtime_and_operation_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ok: audit.status === 'passed', status: audit.status, auditPath, screenshots: screenshots.length }, null, 2))
  if (audit.status !== 'passed') process.exitCode = 1
}

function cleanupSpawned() {
  for (const child of spawned) {
    if (child.killed) continue
    child.kill('SIGTERM')
    setTimeout(() => {
      if (!child.killed) child.kill('SIGKILL')
    }, 1000).unref()
  }
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    cleanupSpawned()
    setTimeout(() => process.exit(process.exitCode || 0), 1500).unref()
  })
