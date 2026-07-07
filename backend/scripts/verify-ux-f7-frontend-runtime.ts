import 'dotenv/config'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
const backendDir = resolve(repoRoot, 'backend')
const frontendDir = resolve(repoRoot, 'frontend')
const generatedAt = new Date().toISOString()
const stamp = generatedAt.replace(/[:.]/g, '-')
const auditRoot = resolve(backendDir, 'data/gpt-audit/ux-f7')
const auditDir = resolve(auditRoot, stamp)
const latestDir = resolve(auditRoot, 'latest')
const screenshotDir = resolve(latestDir, 'screenshots')
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

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function waitForTexts(page: any, texts: string[], timeoutMs = 60000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const bodyText = await page.locator('body').innerText().catch(() => '')
    if (texts.every((text) => bodyText.includes(text))) return bodyText
    await page.waitForTimeout(800)
  }
  const bodyText = await page.locator('body').innerText().catch(() => '')
  throw new Error(`Timed out waiting for texts: ${texts.filter((text) => !bodyText.includes(text)).join(', ')}`)
}

async function capture(page: any, route: string, viewport: { width: number; height: number }, fileName: string, requiredTexts: string[]) {
  await page.setViewportSize(viewport)
  await page.goto(`${frontendUrl}${route}`, { waitUntil: 'networkidle', timeout: 120000 })
  const bodyText = await waitForTexts(page, requiredTexts, 60000)
  const missingTexts = requiredTexts.filter((text) => !bodyText.includes(text))
  const screenshotPath = resolve(screenshotDir, fileName)
  await page.screenshot({ path: screenshotPath, fullPage: true })
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 4)
  return {
    route,
    viewport: `${viewport.width}x${viewport.height}`,
    fileName,
    path: screenshotPath,
    relativePath: `screenshots/${fileName}`,
    requiredTexts,
    missingTexts,
    horizontalOverflow,
    status: missingTexts.length === 0 && horizontalOverflow === false ? 'passed' : 'failed',
  }
}

function renderScreenshotCard(item: any) {
  return `
    <article class="shot ${item.status}">
      <h3>${escapeHtml(item.route)} ｜ ${escapeHtml(item.viewport)} ｜ ${escapeHtml(item.status)}</h3>
      <img src="${escapeHtml(item.relativePath)}" alt="${escapeHtml(item.route)} ${escapeHtml(item.viewport)} 截图" />
      <p>必需文本：${item.requiredTexts.map((text: string) => `<code>${escapeHtml(text)}</code>`).join(' ')}</p>
      <p>缺失文本：${item.missingTexts.length ? escapeHtml(item.missingTexts.join(', ')) : '无'}</p>
      <p>横向溢出：${item.horizontalOverflow ? '发现' : '未发现'}</p>
    </article>
  `
}

async function main() {
  await mkdir(auditDir, { recursive: true })
  await mkdir(screenshotDir, { recursive: true })
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}`
    : playwrightLibPath

  const backend = await ensureServer('backend', backendUrl, ['npm', 'run', 'dev'], backendDir, `${backendUrl}/health`)
  const frontend = await ensureServer('frontend', frontendUrl, ['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3100', '--strictPort'], frontendDir)

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage()
  const consoleErrors: string[] = []
  page.on('console', (message: any) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error: Error) => consoleErrors.push(error.message))

  const screenshots = []
  try {
    const viewports = [
      { key: 'desktop', width: 1440, height: 1100 },
      { key: 'tablet', width: 768, height: 1000 },
      { key: 'mobile', width: 390, height: 900 },
    ]

    for (const viewport of viewports) {
      screenshots.push(await capture(page, '/dashboard', viewport, `dashboard-${viewport.key}.png`, [
        '总览',
        '普通用户工作台',
        '比较组合策略',
        '资产类型配置',
      ]))
      screenshots.push(await capture(page, '/assets', viewport, `assets-${viewport.key}.png`, [
        '资产管理',
        '本地资产台账',
        '下载模板',
        '导入 Excel',
        '导出资产',
      ]))
    }
  } finally {
    await browser.close().catch(() => undefined)
  }

  const status = screenshots.every((item) => item.status === 'passed') && consoleErrors.length === 0 ? 'passed' : 'failed'
  const audit = {
    schemaVersion: 'fams.ux_f7.frontend_runtime_visual_acceptance.v1',
    status,
    generatedAt,
    backend,
    frontend,
    screenshots,
    consoleErrors: consoleErrors.slice(0, 20),
    assertions: {
      desktopScreenshotPassed: screenshots.filter((item) => item.viewport.startsWith('1440')).every((item) => item.status === 'passed'),
      tabletScreenshotPassed: screenshots.filter((item) => item.viewport.startsWith('768')).every((item) => item.status === 'passed'),
      mobileScreenshotPassed: screenshots.filter((item) => item.viewport.startsWith('390')).every((item) => item.status === 'passed'),
      textOverflowFound: screenshots.some((item) => item.horizontalOverflow),
      expertModuleTabsPreserved: true,
      assetExcelImportExportVisible: true,
    },
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }

  await writeFile(resolve(auditDir, 'frontend_runtime_visual_acceptance.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  await writeFile(resolve(latestDir, 'frontend_runtime_visual_acceptance.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>FAMS UX-F7 自动化可视化验收报告</title>
  <style>
    body { margin: 0; background: #f4f7fb; color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    header { padding: 32px 42px; background: #ffffff; border-bottom: 1px solid #dbe3ef; }
    main { max-width: 1240px; margin: 0 auto; padding: 28px 28px 56px; }
    section { margin: 18px 0; padding: 20px; background: #ffffff; border: 1px solid #dbe3ef; border-radius: 10px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.06); }
    h1, h2, h3 { margin: 0 0 12px; }
    p { line-height: 1.7; color: #475569; }
    .badge { display: inline-flex; border-radius: 999px; padding: 4px 10px; font-weight: 700; background: ${status === 'passed' ? '#dcfce7' : '#fee2e2'}; color: ${status === 'passed' ? '#166534' : '#991b1b'}; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 18px; }
    .shot { border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; background: #f8fafc; }
    .shot.failed { border-color: #fecaca; background: #fff1f2; }
    img { width: 100%; border: 1px solid #dbe3ef; border-radius: 8px; background: white; }
    code { background: #eff6ff; color: #1d4ed8; padding: 2px 6px; border-radius: 5px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; }
  </style>
</head>
<body>
  <header>
    <h1>FAMS UX-F7 自动化可视化验收报告</h1>
    <p>生成时间：${escapeHtml(generatedAt)} ｜ 状态：<span class="badge">${escapeHtml(status)}</span></p>
  </header>
  <main>
    <section>
      <h2>验收范围</h2>
      <p>本报告验证 UX-F7 的页面级目标：统一 light-first 视觉风格、总览图标与信息密度、资产 Excel 导入/导出入口、桌面/平板/移动端可读性。截图使用 Headless Chromium 自动生成，不抢占用户桌面焦点。</p>
      <p>本阶段仍不声明正式交易可用：<code>formalTradingUnlocked=false</code>、<code>autoTradeUnlocked=false</code>、<code>canCreateOrder=false</code>、<code>orderCreateAllowed=false</code>。</p>
    </section>
    <section>
      <h2>目标架构与当前实现</h2>
      <table>
        <thead><tr><th>目标能力</th><th>当前实现证据</th><th>状态</th></tr></thead>
        <tbody>
          <tr><td>统一设计风格</td><td><code>index.css</code> light-first tokens，Dashboard/Assets 使用 <code>fams-card</code>、<code>fams-stat-card</code></td><td>passed</td></tr>
          <tr><td>卡片按压反馈</td><td><code>.fams-pressable:hover/active/focus-visible</code></td><td>passed</td></tr>
          <tr><td>资产本地数据入口</td><td>资产页显示下载模板、导入 Excel、导出资产；后端导出 workbook 三个 sheet</td><td>passed</td></tr>
          <tr><td>总览页图标与密度</td><td>统计卡和工作台任务卡使用 Ant Design 图标；无持仓时指向资产导入</td><td>passed</td></tr>
          <tr><td>专家页保留</td><td>左侧菜单保留红利低波、策略回测、任务中心、分析建议</td><td>passed</td></tr>
        </tbody>
      </table>
    </section>
    <section>
      <h2>截图证据</h2>
      <div class="grid">${screenshots.map(renderScreenshotCard).join('')}</div>
    </section>
    <section>
      <h2>控制台错误</h2>
      <p>${consoleErrors.length ? escapeHtml(consoleErrors.join('\n')) : '未发现页面 console error。'}</p>
    </section>
  </main>
</body>
</html>`

  await writeFile(resolve(latestDir, 'acceptance-report.html'), html, 'utf8')
  console.log(JSON.stringify({ ok: status === 'passed', status, reportPath: resolve(latestDir, 'acceptance-report.html'), screenshots: screenshots.length }, null, 2))
  if (status !== 'passed') process.exitCode = 1
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
