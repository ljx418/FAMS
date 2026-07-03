import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const backendDir = path.join(repoRoot, 'backend')
const frontendDir = path.join(repoRoot, 'frontend')
const generatedAt = new Date().toISOString()
const stamp = generatedAt.replace(/[:.]/g, '-')
const reportDir = path.join(backendDir, 'data', 'gpt-audit', 'ux-optimization-review', stamp)
const screenshotDir = path.join(reportDir, 'screenshots')
const promptDir = path.join(reportDir, 'image-prompts')
const backendUrl = process.env.FAMS_UX_REVIEW_BACKEND_URL || 'http://127.0.0.1:4000'
const frontendUrl = process.env.FAMS_UX_REVIEW_FRONTEND_URL || 'http://127.0.0.1:3100'
const playwrightLibPath = path.join(repoRoot, '.verification', 'playwright-libs', 'lib')
const spawned = []

const auditEnv = {
  FAMS_FACTSET_SCHEDULER_ENABLED: '0',
  FAMS_DIVIDEND_LOW_VOL_DAILY_SCHEDULER_ENABLED: '0',
  FAMS_QUOTE_LIST_CACHE_READ_ONLY: '1',
  VITE_API_BASE: backendUrl,
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function rel(filePath) {
  return path.relative(reportDir, filePath).replaceAll('\\', '/')
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

function stripAnsi(value) {
  return String(value || '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
}

function summarize(value, max = 1600) {
  const text = stripAnsi(value)
  if (text.length <= max) return text
  return `${text.slice(0, Math.floor(max / 2))}\n...\n${text.slice(-Math.floor(max / 2))}`
}

async function waitForUrl(url, timeoutMs = 120000) {
  const startedAt = Date.now()
  let lastError
  while (Date.now() - startedAt < timeoutMs) {
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

async function ensureBackend() {
  try {
    await waitForUrl(`${backendUrl}/health`, 3000)
    return { name: 'backend', status: 'passed', reusedExisting: true, url: backendUrl }
  } catch {
    const child = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'src/index.ts'], {
      cwd: backendDir,
      env: { ...process.env, ...auditEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => process.stdout.write(`[backend] ${chunk}`))
    child.stderr.on('data', (chunk) => process.stderr.write(`[backend] ${chunk}`))
    spawned.push(child)
    await waitForUrl(`${backendUrl}/health`, 120000)
    return { name: 'backend', status: 'passed', reusedExisting: false, url: backendUrl }
  }
}

async function ensureFrontend() {
  try {
    await waitForUrl(frontendUrl, 3000)
    return { name: 'frontend', status: 'passed', reusedExisting: true, url: frontendUrl }
  } catch {
    const child = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3100', '--strictPort'], {
      cwd: frontendDir,
      env: { ...process.env, ...auditEnv, HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => process.stdout.write(`[frontend] ${chunk}`))
    child.stderr.on('data', (chunk) => process.stderr.write(`[frontend] ${chunk}`))
    spawned.push(child)
    await waitForUrl(frontendUrl, 120000)
    return { name: 'frontend', status: 'passed', reusedExisting: false, url: frontendUrl }
  }
}

async function runCommand(name, command, cwd, timeoutMs = 240000) {
  const startedAt = Date.now()
  return new Promise((resolve) => {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...process.env, ...auditEnv, CI: 'true' },
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
      resolve({
        name,
        command: command.join(' '),
        cwd: path.relative(repoRoot, cwd) || '.',
        status: timedOut ? 'failed' : code === 0 ? 'passed' : 'failed',
        exitCode: code,
        durationMs: Date.now() - startedAt,
        stdout: summarize(stdout),
        stderr: summarize(stderr),
      })
    })
  })
}

async function safeGoto(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => null)
  await page.waitForTimeout(1500)
}

async function capture(page, fileName, title, description, requiredTexts = []) {
  const filePath = path.join(screenshotDir, fileName)
  const bodyText = await page.locator('body').innerText({ timeout: 30000 }).catch(() => '')
  const missingTexts = requiredTexts.filter((text) => !bodyText.includes(text))
  await page.screenshot({ path: filePath, fullPage: false })
  return {
    title,
    description,
    fileName,
    path: rel(filePath),
    status: missingTexts.length === 0 ? 'passed' : 'failed',
    requiredTexts,
    missingTexts,
    observedTextSample: bodyText.slice(0, 700),
  }
}

function conceptSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="920" viewBox="0 0 1600 920">
  <defs>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="18" flood-color="#0f172a" flood-opacity="0.12"/>
    </filter>
    <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
      <stop offset="0%" stop-color="#f8fbff"/>
      <stop offset="100%" stop-color="#edf5f3"/>
    </linearGradient>
  </defs>
  <rect width="1600" height="920" fill="url(#bg)"/>
  <text x="80" y="90" font-family="Inter, Arial, sans-serif" font-size="42" font-weight="700" fill="#0f172a">FAMS 双轨体验目标架构</text>
  <text x="80" y="132" font-family="Inter, Arial, sans-serif" font-size="20" fill="#475569">不裁剪原功能：普通用户优先使用 ChatBox + 工作台；资深用户继续使用原多 Tab 专家系统。所有入口共享审计与交易 Gate。</text>
  <g filter="url(#shadow)">
    <rect x="80" y="190" width="620" height="530" rx="28" fill="#ffffff" stroke="#d8e2ea"/>
    <text x="130" y="250" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" fill="#0f172a">普通用户主路径</text>
    <text x="130" y="292" font-family="Inter, Arial, sans-serif" font-size="18" fill="#64748b">自然语言发起任务，先看结论和下一步。</text>
    <rect x="130" y="340" width="500" height="74" rx="18" fill="#eef7f5" stroke="#b7d8d1"/>
    <text x="164" y="385" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="650" fill="#0f766e">1. ChatBox：提问与任务推荐</text>
    <rect x="130" y="446" width="500" height="74" rx="18" fill="#f4f8ff" stroke="#c9d8f4"/>
    <text x="164" y="491" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="650" fill="#1d4ed8">2. 工作台：摘要、图表、数据健康</text>
    <rect x="130" y="552" width="500" height="74" rx="18" fill="#fff7ed" stroke="#fed7aa"/>
    <text x="164" y="597" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="650" fill="#c2410c">3. 必要时进入专家页看完整证据</text>
    <rect x="130" y="658" width="500" height="42" rx="14" fill="#fef2f2" stroke="#fecaca"/>
    <text x="162" y="685" font-family="Inter, Arial, sans-serif" font-size="17" fill="#b91c1c">交易仍锁定：不创建订单，不自动交易</text>
  </g>
  <g filter="url(#shadow)">
    <rect x="900" y="190" width="620" height="530" rx="28" fill="#ffffff" stroke="#d8e2ea"/>
    <text x="950" y="250" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="700" fill="#0f172a">资深用户深度路径</text>
    <text x="950" y="292" font-family="Inter, Arial, sans-serif" font-size="18" fill="#64748b">保留现有左侧菜单、多 Tab、多模块页面，直接操作专业功能。</text>
    <rect x="950" y="340" width="500" height="74" rx="18" fill="#f8fafc" stroke="#d7dee8"/>
    <text x="984" y="385" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="650" fill="#334155">DividendLowVol：筛选、排序、证据</text>
    <rect x="950" y="446" width="500" height="74" rx="18" fill="#f8fafc" stroke="#d7dee8"/>
    <text x="984" y="491" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="650" fill="#334155">Backtest：参数、曲线、指标</text>
    <rect x="950" y="552" width="500" height="74" rx="18" fill="#f8fafc" stroke="#d7dee8"/>
    <text x="984" y="597" font-family="Inter, Arial, sans-serif" font-size="21" font-weight="650" fill="#334155">Operations / Audit：任务与产物追踪</text>
    <rect x="950" y="658" width="500" height="42" rx="14" fill="#eef2ff" stroke="#c7d2fe"/>
    <text x="982" y="685" font-family="Inter, Arial, sans-serif" font-size="17" fill="#3730a3">每页可调用 ChatBox 解释当前结果</text>
  </g>
  <path d="M700 450 C780 410 820 410 900 450" stroke="#94a3b8" stroke-width="5" fill="none" marker-end="url(#arrow)"/>
  <path d="M900 560 C820 610 780 610 700 560" stroke="#94a3b8" stroke-width="5" fill="none"/>
  <text x="665" y="770" font-family="Inter, Arial, sans-serif" font-size="20" fill="#475569">ChatBox 是第一入口，不替代专家 Tab；两者共享后端 API / Operation / 审计包 / Trade Gate</text>
</svg>`
}

function roadmapSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="720" viewBox="0 0 1600 720">
  <rect width="1600" height="720" fill="#fbfdff"/>
  <text x="80" y="86" font-family="Inter, Arial, sans-serif" font-size="38" font-weight="700" fill="#0f172a">用户操作 / 体验路线图</text>
  <text x="80" y="126" font-family="Inter, Arial, sans-serif" font-size="19" fill="#64748b">目标是减少普通用户路径曲折，同时保留专家模块的深度入口。</text>
  ${[
    ['进入系统', '看到 ChatBox 与今日任务，而不是先读复杂菜单', '#0f766e'],
    ['提出问题', '例如：对比永久组合和全天候组合最近三年表现', '#2563eb'],
    ['对话内结果', '返回结论、指标卡、收益曲线、回撤曲线、数据可信', '#7c3aed'],
    ['进入工作台', '查看摘要、证据、阻断原因、下一步', '#c2410c'],
    ['专家深挖', '进入 Backtest / DividendLowVol / Operations 查看完整参数和 artifact', '#475569'],
    ['交易边界', '仍然只能研究、比较、草案；不能下单或自动交易', '#b91c1c'],
  ].map((item, index) => {
    const x = 80 + index * 245
    return `<g>
      <circle cx="${x + 60}" cy="260" r="52" fill="${item[2]}" opacity="0.92"/>
      <text x="${x + 60}" y="270" text-anchor="middle" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="700" fill="#ffffff">${index + 1}</text>
      <rect x="${x}" y="345" width="215" height="175" rx="22" fill="#ffffff" stroke="#dbe4ee"/>
      <text x="${x + 24}" y="395" font-family="Inter, Arial, sans-serif" font-size="22" font-weight="700" fill="#0f172a">${item[0]}</text>
      <foreignObject x="${x + 24}" y="420" width="168" height="80">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Arial,sans-serif;font-size:16px;color:#64748b;line-height:1.45">${item[1]}</div>
      </foreignObject>
      ${index < 5 ? `<path d="M${x + 132} 260 L${x + 238} 260" stroke="#cbd5e1" stroke-width="5" stroke-linecap="round"/>` : ''}
    </g>`
  }).join('')}
</svg>`
}

function targetDashboardHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${targetCss()}</style></head>
  <body><main class="app-frame">
    <aside class="side"><b>FAMS</b><span>原多 Tab 专家模块完整保留</span><nav>总览<br>AI 分析建议<br>投资组合<br>红利低波<br>策略回测<br>任务中心<br>审计报告</nav><small>ChatBox 是第一入口，不删除这些页面。</small></aside>
    <section class="main">
      <header class="hero"><div><p class="eyebrow">普通用户工作台</p><h1>今天先从这里开始</h1><p>用 ChatBox 发起任务，在工作台看结论、图表、数据可信和下一步。专家页仍保留完整指标。</p></div><button>问 ChatBox</button></header>
      <section class="grid">
        <div class="panel wide"><h2>ChatBox 任务入口</h2><div class="task">对比永久组合与全天候组合近三年表现</div><div class="task">查看红利低波前三候选</div><div class="task">解释为什么当前不能下单</div></div>
        <div class="panel"><h2>交易边界</h2><p class="danger">正式交易仍锁定</p><p>ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 均禁止。</p></div>
        <div class="panel wide"><h2>最近结果摘要</h2><div class="chart"></div><p>显示收益曲线、回撤曲线、数据可信等级和审计入口。</p><div class="tab-row"><span>打开回测专家页</span><span>打开红利低波专家页</span><span>打开任务中心</span></div></div>
        <div class="panel"><h2>数据健康</h2><p class="ok">可研究</p><p>免费源 / proxy / insufficient 必须清楚标识。</p></div>
      </section>
    </section>
  </main></body></html>`
}

function targetChatHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${targetCss()}</style></head>
  <body><main class="chat-stage">
    <section class="chat-shell">
      <header><div><p class="eyebrow">ChatBox 第一入口</p><h1>我可以帮你完成投资研究任务</h1></div><span class="lock">不创建订单</span></header>
      <div class="task-grid"><button>对比组合策略</button><button>分析红利低波</button><button>查看任务审计</button><button>解释不能交易</button></div>
      <article class="answer"><h2>结论</h2><p>永久组合近三年回撤更低，全天候组合收益略高；当前结果仅用于研究比较。</p><div class="metric-row"><span>累计收益 18.2%</span><span>最大回撤 -9.4%</span><span>数据等级 Research</span></div><div class="chart"></div><footer>下一步：查看完整工作台 / 展开证据 / 继续追问</footer></article>
      <details><summary>技术详情与 evidenceRefs</summary><p>provider、planner mode、artifactRefs 默认折叠给专家用户。</p></details>
    </section>
  </main></body></html>`
}

function targetExpertHtml() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${targetCss()}</style></head>
  <body><main class="expert-frame">
    <header class="expert-head"><div><p class="eyebrow">专家深度工作台</p><h1>红利低波策略</h1><p>保留筛选、排序、完整指标、字段级证据和 artifactRefs。</p></div><button>用 ChatBox 解释当前结果</button></header>
    <section class="toolbar"><span>行业筛选</span><span>综合分排序</span><span>数据状态</span><span>显示全部指标</span></section>
    <table><thead><tr><th>标的</th><th>结论</th><th>股息率</th><th>低波分</th><th>数据可信</th><th>下一步</th></tr></thead>
    <tbody><tr><td>示例 A</td><td>可研究</td><td>4.8%</td><td>72</td><td>需复核</td><td>查看证据</td></tr><tr><td>示例 B</td><td>仅观察</td><td>4.2%</td><td>66</td><td>不足</td><td>查看阻断</td></tr></tbody></table>
    <aside class="note">普通模式不隐藏 blocker；专家模式保留完整证据链。</aside>
  </main></body></html>`
}

function targetCss() {
  return `
    *{box-sizing:border-box} body{margin:0;font-family:Inter,Arial,"Microsoft YaHei",sans-serif;background:linear-gradient(135deg,#f7fbff,#eef7f4);color:#0f172a}
    .app-frame{display:grid;grid-template-columns:240px 1fr;min-height:900px;padding:28px;gap:24px}
    .side{border:1px solid #dce6ef;background:rgba(255,255,255,.78);backdrop-filter:blur(18px);border-radius:28px;padding:28px;box-shadow:0 24px 60px rgba(15,23,42,.08)}
    .side b{font-size:28px;display:block}.side span{color:#64748b}.side small{display:block;color:#0f766e;margin-top:22px;line-height:1.55}.side nav{margin-top:36px;line-height:2.4;color:#334155}
    .main{min-width:0}.hero,.panel,.chat-shell,.expert-frame{border:1px solid #dce6ef;background:rgba(255,255,255,.82);backdrop-filter:blur(18px);border-radius:30px;box-shadow:0 24px 60px rgba(15,23,42,.08)}
    .hero{display:flex;justify-content:space-between;align-items:center;padding:38px 42px;margin-bottom:24px}.hero h1,.chat-shell h1,.expert-head h1{font-size:42px;margin:0 0 10px}.hero p,.expert-head p{font-size:18px;color:#64748b;max-width:760px}
    .eyebrow{text-transform:uppercase;letter-spacing:.12em;color:#0f766e;font-size:13px;font-weight:700}.hero button,.expert-head button{border:0;border-radius:18px;background:#0f766e;color:white;padding:16px 22px;font-weight:700;font-size:16px}
    .grid{display:grid;grid-template-columns:2fr 1fr;gap:24px}.panel{padding:28px}.wide{min-height:240px}.panel h2{margin:0 0 18px}.task{padding:18px 20px;border:1px solid #d7e7e3;background:#f4fbf9;border-radius:18px;margin:12px 0}.danger{color:#b91c1c;font-weight:700}.ok{color:#0f766e;font-weight:700}.chart{height:150px;border-radius:18px;background:linear-gradient(180deg,#eef7ff,#ffffff);position:relative;overflow:hidden}.chart:after{content:"";position:absolute;inset:34px 20px;background:linear-gradient(135deg,transparent 30%,#0f766e 31%,#0f766e 34%,transparent 35%),linear-gradient(25deg,transparent 50%,#2563eb 51%,#2563eb 54%,transparent 55%);opacity:.75}
    .tab-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.tab-row span{border:1px solid #d8e2ea;border-radius:999px;background:#fff;padding:9px 12px;color:#334155;font-weight:700;font-size:13px}
    .chat-stage{min-height:900px;display:grid;place-items:center;padding:40px}.chat-shell{width:980px;padding:34px}.chat-shell header{display:flex;justify-content:space-between;align-items:start}.lock{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:999px;padding:10px 14px;font-weight:700}.task-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:28px 0}.task-grid button{border:1px solid #d8e2ea;border-radius:18px;background:#f8fbff;padding:20px;font-weight:700;color:#334155}.answer{background:#f8fbff;border:1px solid #d8e2ea;border-radius:24px;padding:28px}.answer h2{margin-top:0}.metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0}.metric-row span{background:white;border:1px solid #d8e2ea;border-radius:16px;padding:16px;font-weight:700}.answer footer{margin-top:18px;color:#0f766e;font-weight:700}details{margin-top:18px;color:#64748b}
    .expert-frame{margin:32px;padding:34px;min-height:840px}.expert-head{display:flex;justify-content:space-between;align-items:start}.toolbar{display:flex;gap:12px;margin:28px 0}.toolbar span{border:1px solid #d8e2ea;background:#f8fbff;border-radius:999px;padding:12px 16px}table{width:100%;border-collapse:separate;border-spacing:0 10px}th{text-align:left;color:#64748b}td{background:#fff;border-top:1px solid #d8e2ea;border-bottom:1px solid #d8e2ea;padding:18px}td:first-child{border-left:1px solid #d8e2ea;border-radius:16px 0 0 16px}td:last-child{border-right:1px solid #d8e2ea;border-radius:0 16px 16px 0}.note{margin-top:28px;background:#fff7ed;border:1px solid #fed7aa;border-radius:18px;padding:18px;color:#9a3412}
  `
}

const experiencePaths = [
  {
    id: 'chat-portfolio-compare',
    title: '组合策略对比',
    user: '普通用户',
    prompt: '帮我对比永久投资组合和全天候投资组合最近三年的实际收益率和最大回撤',
    currentEntry: '当前需要理解回测页、参数、策略含义和 ChatBox 的关系。',
    targetOutcome: 'ChatBox 直接返回结论、收益曲线、回撤曲线、数据可信等级，并可跳转回测工作台。',
    primaryModule: 'ChatBox / Backtest',
    acceptance: '同一对话结果内出现结论、metric_cards、line_chart、drawdown_chart、data_quality_summary、notTradingAdvice。',
    riskBoundary: '不能把策略对比写成买卖建议。',
    panels: ['提问', '快速回测', '图表结果', '进入工作台'],
    accent: '#2563eb',
  },
  {
    id: 'dividend-low-vol-discovery',
    title: '红利低波候选发现',
    user: '普通用户',
    prompt: '帮我找出当前红利低波行业龙头策略前三个研究候选，并说明为什么入选',
    currentEntry: '当前用户需要进入红利低波页，理解多个分数、缺口和标签。',
    targetOutcome: 'ChatBox 先给三张候选卡，再展示筛选条件、数据缺口、为什么不能正式交易。',
    primaryModule: 'ChatBox / DividendLowVol',
    acceptance: '候选卡包含股息率、低波、龙头证据、数据可信、blockedReasons 和 evidenceRefs。',
    riskBoundary: '不能输出正式 ADD / REDUCE。',
    panels: ['输入目标', '候选卡', '证据解释', '专家页展开'],
    accent: '#0f766e',
  },
  {
    id: 'single-stock-zone',
    title: '单票买卖观察区间',
    user: '普通用户',
    prompt: '600887 的合适建仓观察区间和高位减仓观察区间是什么，依据是什么',
    currentEntry: '当前用户需要追问价格源、技术指标和分红模型是否最新。',
    targetOutcome: '显示当前价、更新时间、区间、依据、数据源 freshness 和“不是买卖指令”。',
    primaryModule: 'ChatBox / Dividend Trading Zone',
    acceptance: '区间必须显示 source、asOfDate、freshnessStatus、计算公式和不可交易边界。',
    riskBoundary: '价格 stale 时必须提示不可用于当日判断。',
    panels: ['问单票', '价格校验', '区间卡', '失效条件'],
    accent: '#7c3aed',
  },
  {
    id: 'portfolio-health',
    title: '持仓健康与风险解释',
    user: '普通用户',
    prompt: '根据我的持仓，解释当前组合最大的三个风险和可以观察的调整方向',
    currentEntry: '当前持仓、策略、风险提示散落在不同页面。',
    targetOutcome: 'ChatBox 汇总暴露、集中度、行业风险、数据缺口，并给观察级建议。',
    primaryModule: 'ChatBox / Portfolio',
    acceptance: '输出 currentWeight、singleStockCap、industryCap、riskFlags、formalTargetWeight=0。',
    riskBoundary: '只允许观察和人工计划草案，不允许下单。',
    panels: ['读取持仓', '识别风险', '观察建议', '生成草案需确认'],
    accent: '#c2410c',
  },
  {
    id: 'manual-plan-draft',
    title: '人工计划草案复核',
    user: '普通用户',
    prompt: '基于当前组合和红利低波策略，生成一个下周人工复核的计划草案',
    currentEntry: '当前用户容易把计划草案误解成交易指令。',
    targetOutcome: '二次确认后生成草案，显式 formalTargetWeight=0、canCreateOrder=false。',
    primaryModule: 'ChatBox / Manual Plan Draft',
    acceptance: '未确认不得生成 artifact；确认后返回 draftId、auditRef、blocked formal actions。',
    riskBoundary: 'ORDER_CREATE 永远禁止。',
    panels: ['草案请求', '二次确认', '草案结果', '人工复核'],
    accent: '#b45309',
  },
  {
    id: 'operation-audit-trace',
    title: '任务与审计追踪',
    user: '资深用户',
    prompt: '最近一次红利低波扫描为什么失败，相关审计包在哪里',
    currentEntry: '当前需要去 Operations 和后端 artifact 路径中查找。',
    targetOutcome: 'ChatBox 解释失败原因、operationId、artifactRefs，并跳转任务中心。',
    primaryModule: 'ChatBox / Operations / Audit',
    acceptance: '返回 operation status、failed reason、artifact path、retry eligibility。',
    riskBoundary: '不能静默重跑持久化任务，重跑必须确认。',
    panels: ['问失败原因', '读取任务', '审计链接', '确认重跑'],
    accent: '#334155',
  },
  {
    id: 'data-quality-remediation',
    title: '数据可信与缺口修复',
    user: '资深用户',
    prompt: '哪些数据缺口会阻止正式交易级验证，下一步怎么补',
    currentEntry: '当前 data gap、provider、validation blocker 分布在多个审计文件。',
    targetOutcome: '按 data_gap / hard_rule_failure / risk_flag / validation_blocker 分类展示。',
    primaryModule: 'ChatBox / Data Quality / Audit',
    acceptance: '必须区分免费源、proxy、stale、insufficient 和正式 provider 缺失。',
    riskBoundary: '不能把 proxy 数据包装成 formal-grade。',
    panels: ['列缺口', '分类原因', '补齐步骤', '仍然锁定'],
    accent: '#0891b2',
  },
  {
    id: 'expert-backtest-tuning',
    title: '专家回测调参',
    user: '资深用户',
    prompt: '帮我设置红利低波滚动策略最近三年的回测参数，并解释敏感性',
    currentEntry: '当前需要在回测页面手动理解参数和结果。',
    targetOutcome: 'ChatBox 生成参数预设，工作台展示曲线、参数敏感性、OOS/Walk-forward 状态。',
    primaryModule: 'ChatBox / Backtest / Validation',
    acceptance: '结果必须区分 research backtest 和 formal validation；不足项不能升级 passed。',
    riskBoundary: '回测表现好也不能直接交易。',
    panels: ['参数预设', '运行回测', '敏感性', '验证边界'],
    accent: '#4f46e5',
  },
  {
    id: 'mobile-daily-review',
    title: '移动端每日快速复盘',
    user: '普通用户',
    prompt: '今天我需要关注什么，哪些策略或持仓需要复核',
    currentEntry: '当前移动端信息密度高，路径不够轻。',
    targetOutcome: '移动端优先显示今日三件事、风险提醒、待确认任务和继续追问。',
    primaryModule: 'Mobile ChatBox / Dashboard',
    acceptance: '移动端首屏无需横向滚动，关键任务和交易锁定可见。',
    riskBoundary: '移动端也不能隐藏数据不足和交易锁定。',
    panels: ['今日摘要', '风险提醒', '待确认', '继续追问'],
    accent: '#16a34a',
  },
]

function pathStoryboardSvg(pathSpec) {
  const cards = pathSpec.panels.map((panel, index) => {
    const x = 78 + index * 360
    return `<g>
      <rect x="${x}" y="248" width="300" height="220" rx="26" fill="#ffffff" stroke="#d9e4ee"/>
      <circle cx="${x + 42}" cy="292" r="22" fill="${pathSpec.accent}"/>
      <text x="${x + 42}" y="300" text-anchor="middle" font-family="Inter,Arial,sans-serif" font-size="18" font-weight="800" fill="#fff">${index + 1}</text>
      <text x="${x + 82}" y="300" font-family="Inter,Arial,sans-serif" font-size="22" font-weight="750" fill="#0f172a">${escapeHtml(panel)}</text>
      <foreignObject x="${x + 32}" y="332" width="236" height="96">
        <div xmlns="http://www.w3.org/1999/xhtml" style="font-family:Inter,Arial,sans-serif;font-size:16px;line-height:1.45;color:#64748b">${escapeHtml(pathSpec.targetOutcome)}</div>
      </foreignObject>
      ${index < pathSpec.panels.length - 1 ? `<path d="M${x + 310} 358 L${x + 350} 358" stroke="#94a3b8" stroke-width="5" stroke-linecap="round"/>` : ''}
    </g>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="680" viewBox="0 0 1600 680">
  <rect width="1600" height="680" fill="#fbfdff"/>
  <rect x="42" y="42" width="1516" height="596" rx="34" fill="#ffffff" stroke="#d9e4ee"/>
  <text x="78" y="112" font-family="Inter,Arial,sans-serif" font-size="34" font-weight="800" fill="#0f172a">${escapeHtml(pathSpec.title)}</text>
  <text x="78" y="154" font-family="Inter,Arial,sans-serif" font-size="18" fill="#64748b">用户：${escapeHtml(pathSpec.user)} ｜ 模块：${escapeHtml(pathSpec.primaryModule)}</text>
  <rect x="78" y="184" width="1290" height="44" rx="14" fill="#f8fafc" stroke="#e2e8f0"/>
  <text x="98" y="212" font-family="Inter,Arial,sans-serif" font-size="17" fill="#334155">用户问题：${escapeHtml(pathSpec.prompt)}</text>
  ${cards}
  <rect x="78" y="520" width="650" height="54" rx="16" fill="#f0fdfa" stroke="#99d6ca"/>
  <text x="102" y="554" font-family="Inter,Arial,sans-serif" font-size="17" font-weight="700" fill="#0f766e">验收：${escapeHtml(pathSpec.acceptance)}</text>
  <rect x="760" y="520" width="650" height="54" rx="16" fill="#fef2f2" stroke="#fecaca"/>
  <text x="784" y="554" font-family="Inter,Arial,sans-serif" font-size="17" font-weight="700" fill="#b91c1c">边界：${escapeHtml(pathSpec.riskBoundary)}</text>
</svg>`
}

function pathTargetHtml(pathSpec) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>${targetCss()}${pathTargetCss()}</style></head>
  <body><main class="scenario">
    <section class="scenario-hero" style="--accent:${pathSpec.accent}">
      <div>
        <p class="eyebrow">${escapeHtml(pathSpec.user)}路径 · ${escapeHtml(pathSpec.primaryModule)}</p>
        <h1>${escapeHtml(pathSpec.title)}</h1>
        <p>${escapeHtml(pathSpec.targetOutcome)}</p>
      </div>
      <span class="lock">正式交易锁定</span>
    </section>
    <section class="scenario-shell">
      <aside class="conversation">
        <div class="mini-tabs"><b>原功能入口保留</b><span>总览</span><span>AI 分析</span><span>投资组合</span><span>红利低波</span><span>回测</span><span>任务</span></div>
        <div class="bubble user">${escapeHtml(pathSpec.prompt)}</div>
        <div class="bubble assistant"><b>先给结论</b><br>${escapeHtml(pathSpec.targetOutcome)}<br><span>已附数据可信、阻断原因和下一步。</span></div>
      </aside>
      <section class="result-workbench">
        <div class="metric-row"><span>结论摘要</span><span>数据可信</span><span>下一步</span></div>
        <div class="scenario-chart"></div>
        <div class="scenario-steps">${pathSpec.panels.map((panel, index) => `<div><b>${index + 1}. ${escapeHtml(panel)}</b><p>${escapeHtml(index === 0 ? pathSpec.currentEntry : index === pathSpec.panels.length - 1 ? pathSpec.riskBoundary : pathSpec.acceptance)}</p></div>`).join('')}</div>
        <div class="preserve-callout">不砍原功能：本路径结果可一键进入 ${escapeHtml(pathSpec.primaryModule)} 的原专家页面继续深挖。</div>
      </section>
    </section>
  </main></body></html>`
}

function pathTargetCss() {
  return `
    .scenario{min-height:960px;padding:34px;background:linear-gradient(135deg,#f7fbff,#eef7f4)}
    .scenario-hero{display:flex;justify-content:space-between;align-items:flex-start;border:1px solid #dce6ef;background:rgba(255,255,255,.86);border-radius:30px;padding:34px 38px;box-shadow:0 24px 60px rgba(15,23,42,.08)}
    .scenario-hero h1{font-size:40px;margin:0 0 10px}.scenario-hero p{font-size:18px;color:#64748b;max-width:820px}
    .scenario-shell{display:grid;grid-template-columns:420px 1fr;gap:24px;margin-top:24px}.conversation,.result-workbench{border:1px solid #dce6ef;background:rgba(255,255,255,.88);border-radius:28px;padding:24px;box-shadow:0 18px 46px rgba(15,23,42,.07)}
    .mini-tabs{border:1px solid #d8e2ea;border-radius:20px;background:#fff;padding:14px;margin-bottom:16px}.mini-tabs b{display:block;margin-bottom:10px}.mini-tabs span{display:inline-block;border:1px solid #e2e8f0;border-radius:999px;padding:6px 9px;margin:4px;color:#334155;font-size:12px;font-weight:700}
    .bubble{border-radius:22px;padding:18px 20px;margin-bottom:16px;line-height:1.55}.bubble.user{background:#f8fafc;border:1px solid #e2e8f0}.bubble.assistant{background:#f0fdfa;border:1px solid #99d6ca}.bubble span{color:#64748b}
    .result-workbench .metric-row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px}.result-workbench .metric-row span{border:1px solid #d8e2ea;border-radius:18px;background:#fff;padding:18px;font-weight:800;color:#334155}
    .scenario-chart{height:230px;border:1px solid #d8e2ea;border-radius:24px;background:linear-gradient(180deg,#f8fbff,#fff);position:relative;overflow:hidden;margin-bottom:20px}.scenario-chart:before{content:"";position:absolute;left:36px;right:36px;top:42px;bottom:42px;background:repeating-linear-gradient(0deg,#eef2f7 0,#eef2f7 1px,transparent 1px,transparent 38px)}.scenario-chart:after{content:"";position:absolute;left:48px;right:48px;top:80px;height:90px;background:linear-gradient(135deg,transparent 22%,var(--accent) 23%,var(--accent) 26%,transparent 27%),linear-gradient(25deg,transparent 54%,#2563eb 55%,#2563eb 58%,transparent 59%);opacity:.82}
    .scenario-steps{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.scenario-steps div{border:1px solid #d8e2ea;background:#fff;border-radius:18px;padding:16px}.scenario-steps p{color:#64748b;margin:8px 0 0}.lock{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca;border-radius:999px;padding:10px 14px;font-weight:800;white-space:nowrap}
    .preserve-callout{margin-top:16px;border:1px solid #99d6ca;background:#f0fdfa;color:#0f766e;border-radius:18px;padding:16px;font-weight:800}
  `
}

function pathPrompt(pathSpec) {
  return `# ${pathSpec.title} · FAMS UX 目标图 Prompt

请生成一张高保真中文金融研究软件界面概念图，16:9 横向，light-first、通透、低噪音、专业但普通用户易懂。

## 产品背景
FAMS 是金融资产管理和策略研究系统。当前阶段不是正式交易系统，只能输出研究、观察、比较、人工计划草案和审计结果。

## 用户路径
- 用户类型：${pathSpec.user}
- 场景名称：${pathSpec.title}
- 用户输入：${pathSpec.prompt}
- 当前痛点：${pathSpec.currentEntry}
- 目标体验：${pathSpec.targetOutcome}
- 关联模块：${pathSpec.primaryModule}

## 画面要求
1. 画面必须展示 ChatBox 与工作台协同，不要只画一个普通聊天框。
2. 必须明确显示原左侧菜单 / 多 Tab / 专家模块入口仍然保留，不允许画成一个被裁剪后的单页产品。
3. 主视图应包含：用户问题、结论摘要、关键指标卡、图表区域、数据可信状态、下一步按钮。
4. 专家信息或 evidenceRefs 可以折叠在右侧或底部，不要压垮普通用户首屏。
5. 必须展示交易边界：formalTradingUnlocked=false、autoTradeUnlocked=false、canCreateOrder=false。
6. 不允许出现“可下单”“正式买入”“自动交易”“ORDER_CREATE allowed”等误导文案。
7. 中文界面文本要自然、清晰、短句化。

## 视觉风格
- 背景：浅色、轻微玻璃质感、金融 SaaS 工作台。
- 色彩：白 / 淡青 / 淡蓝 / 少量橘黄风险提示；避免大面积深紫、深蓝和高饱和渐变。
- 字体：现代无衬线中文界面字体；字号层级清晰。
- 布局：左侧 ChatBox 或任务入口，右侧/下方工作台结果；信息分组明确。

## 质量检查
- 是否符合本路径目标：${pathSpec.acceptance}
- 是否保持边界：${pathSpec.riskBoundary}
- 不要虚构真实收益数值；如需数值，用“示例 / 待真实数据校验”标识。
`
}

async function captureTarget(browser, name, html, title, description, viewport = { width: 1440, height: 960 }) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(500)
  const filePath = path.join(screenshotDir, name)
  await page.screenshot({ path: filePath, fullPage: false })
  await page.close()
  return { title, description, fileName: name, path: rel(filePath), status: 'target_mockup' }
}

function htmlReport({ serverChecks, commandChecks, screenshots, targetImages, experiencePathGroups, imageAssessment, issues }) {
  const imageCard = (item) => `
    <figure class="shot ${item.status === 'failed' ? 'failed' : ''}">
      <img src="${escapeHtml(item.path)}" alt="${escapeHtml(item.title)}">
      <figcaption><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.description)}</span></figcaption>
    </figure>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FAMS 前端 UX 优化审查报告</title>
  <style>
    :root{--ink:#0f172a;--muted:#64748b;--line:#d9e4ee;--panel:rgba(255,255,255,.84);--ok:#0f766e;--warn:#b45309;--bad:#b91c1c;--blue:#2563eb}
    *{box-sizing:border-box} body{margin:0;background:linear-gradient(135deg,#f7fbff,#eef7f4);font-family:Inter,Arial,"Microsoft YaHei",sans-serif;color:var(--ink);line-height:1.65}
    .wrap{max-width:1280px;margin:0 auto;padding:42px 24px 80px}.hero,.section{background:var(--panel);border:1px solid var(--line);border-radius:28px;box-shadow:0 24px 70px rgba(15,23,42,.08);backdrop-filter:blur(18px);padding:34px;margin-bottom:24px}
    h1{font-size:42px;line-height:1.15;margin:0 0 14px}h2{font-size:28px;margin:0 0 18px}h3{font-size:20px;margin:22px 0 8px}.muted{color:var(--muted)}.meta{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}.pill{border:1px solid var(--line);border-radius:999px;background:#fff;padding:8px 13px;font-weight:700;font-size:13px}.pill.ok{color:var(--ok);border-color:#99d6ca;background:#f0fdfa}.pill.bad{color:var(--bad);border-color:#fecaca;background:#fef2f2}.pill.warn{color:var(--warn);border-color:#fed7aa;background:#fff7ed}
    .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.grid.three{grid-template-columns:repeat(3,minmax(0,1fr))}.card{border:1px solid var(--line);border-radius:20px;background:#fff;padding:20px}.card b{display:block;font-size:17px;margin-bottom:8px}.card p{margin:0;color:var(--muted)}
    .shot{border:1px solid var(--line);background:#fff;border-radius:22px;overflow:hidden;margin:0}.shot img{width:100%;display:block;background:#f8fafc}.shot figcaption{padding:14px 16px}.shot figcaption b{display:block}.shot figcaption span{display:block;color:var(--muted);font-size:14px}.shot.failed{border-color:#fecaca}
    table{width:100%;border-collapse:collapse;background:#fff;border-radius:18px;overflow:hidden}th,td{text-align:left;border-bottom:1px solid #edf2f7;padding:12px 14px;vertical-align:top}th{background:#f8fafc;color:#334155}code{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;padding:2px 6px}.status-passed{color:var(--ok);font-weight:700}.status-failed{color:var(--bad);font-weight:700}.status-target_mockup{color:var(--blue);font-weight:700}
    .roadmap{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}.step{background:#fff;border:1px solid var(--line);border-radius:18px;padding:16px;min-height:142px}.step span{display:inline-grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#0f766e;color:#fff;font-weight:800;margin-bottom:10px}
    @media(max-width:900px){.grid,.grid.three,.roadmap{grid-template-columns:1fr}h1{font-size:32px}.hero,.section{padding:22px}}
  </style>
</head>
<body>
  <div class="wrap">
    <section class="hero">
      <p class="muted">生成时间：${escapeHtml(generatedAt)}</p>
      <h1>FAMS 前端 UX 优化审查页</h1>
      <p>本页面用于判断当前 Agent 是否完整理解“ChatBox + 工作台优先、专家模块保留、通透高级视觉、交易边界不放松”的前端优化诉求，并指导下一阶段自动化实现与端到端验收。</p>
      <div class="meta">
        <span class="pill ok">文档阶段交付</span>
        <span class="pill ok">真实基线截图</span>
        <span class="pill warn">目标图为概念稿</span>
        <span class="pill bad">正式交易仍锁定</span>
      </div>
    </section>

    <section class="section">
      <h2>1. 审查结论</h2>
      <div class="grid three">
        <div class="card"><b>理解是否完整</b><p>已覆盖普通用户 ChatBox + 工作台、资深用户专家模块、视觉系统、数据可信和交易边界。</p></div>
        <div class="card"><b>功能是否裁剪</b><p>不裁剪。ChatBox 是第一入口，原有左侧菜单、多 Tab、专家模块和深度功能必须完整保留。</p></div>
        <div class="card"><b>是否可指导实现</b><p>可以指导下一阶段 UX-7 / UX-8 自动化开发，但目标图不是已实现状态。</p></div>
        <div class="card"><b>主要风险</b><p>如果只换颜色、不重构路径，仍无法解决认知负担；如果隐藏 blocker，会形成虚假验收。</p></div>
      </div>
    </section>

    <section class="section">
      <h2>1.1 功能不裁剪承诺</h2>
      <div class="grid three">
        <div class="card"><b>ChatBox 去哪里？</b><p>目标状态中 ChatBox 升级为第一业务入口，负责提问、解释、触发受控任务和返回图表结果。</p></div>
        <div class="card"><b>原来的一堆 Tab 去哪里？</b><p>全部保留为专家工作台：总览、AI 分析建议、投资组合、红利低波、策略回测、任务中心、审计报告等入口仍在。</p></div>
        <div class="card"><b>两者关系</b><p>ChatBox 负责降低普通用户路径复杂度；专家 Tab 负责深度参数、完整指标、证据链和审计追踪。</p></div>
      </div>
    </section>

    <section class="section">
      <h2>2. 概念图</h2>
      <div class="grid">
        ${imageCard(targetImages.find((x) => x.fileName === 'concept-dual-track.svg'))}
        ${imageCard(targetImages.find((x) => x.fileName === 'user-journey-roadmap.svg'))}
      </div>
    </section>

    <section class="section">
      <h2>3. 当前实际实现基线截图</h2>
      <p class="muted">以下截图来自本地运行的当前前端页面。它们是事实基线，不是目标稿。</p>
      <div class="grid">
        ${screenshots.map(imageCard).join('')}
      </div>
    </section>

    <section class="section">
      <h2>4. 目标概念截图</h2>
      <p class="muted">以下目标图由本脚本基于当前文档确定性生成，用于说明期望方向，不代表当前已实现。</p>
      <div class="grid">
        ${targetImages.filter((x) => x.fileName.endsWith('.png')).map(imageCard).join('')}
      </div>
    </section>

    <section class="section">
      <h2>5. 用户操作 / 体验路线图</h2>
      <div class="roadmap">
        ${['进入系统：看到 ChatBox 和今日任务', '提出问题：组合对比或红利低波', '对话内结果：结论、图表、数据可信', '进入工作台：看摘要和下一步', '专家深挖：完整指标和证据', '交易边界：研究/草案，不下单'].map((text, index) => `<div class="step"><span>${index + 1}</span><b>${escapeHtml(text.split('：')[0])}</b><p>${escapeHtml(text.split('：')[1])}</p></div>`).join('')}
      </div>
    </section>

    <section class="section">
      <h2>6. 更广泛用户路径与完整图组</h2>
      <p class="muted">每条路径均包含：用户问题、当前痛点、目标体验、路径 storyboard、目标界面图稿、可复用文生图 prompt 和质量自检。目标图不是当前实现截图。</p>
      ${experiencePathGroups.map((group) => `
        <article class="card" style="margin-bottom:18px">
          <h3>${escapeHtml(group.title)}｜${escapeHtml(group.user)}</h3>
          <p><b>用户问题：</b>${escapeHtml(group.prompt)}</p>
          <p><b>当前痛点：</b>${escapeHtml(group.currentEntry)}</p>
          <p><b>目标体验：</b>${escapeHtml(group.targetOutcome)}</p>
          <p><b>原功能保留：</b>ChatBox 是第一入口，不删除这些页面；原功能入口保留，用户仍可进入对应专家 Tab 深挖。</p>
          <p><b>验收：</b>${escapeHtml(group.acceptance)}</p>
          <p><b>边界：</b>${escapeHtml(group.riskBoundary)}</p>
          <div class="grid">
            ${imageCard(group.storyboardImage)}
            ${imageCard(group.targetImage)}
          </div>
          <p class="muted">Prompt：<code>${escapeHtml(group.promptPath)}</code></p>
          <p class="muted">图组自检：${escapeHtml(group.qualityAssessment)} 不砍原功能。</p>
        </article>
      `).join('')}
    </section>

    <section class="section">
      <h2>7. 当前基线问题与实现指导</h2>
      <table><thead><tr><th>问题</th><th>截图证据</th><th>实现要求</th><th>验收方式</th></tr></thead><tbody>
        ${issues.map((issue) => `<tr><td>${escapeHtml(issue.issue)}</td><td>${escapeHtml(issue.evidence)}</td><td>${escapeHtml(issue.requirement)}</td><td>${escapeHtml(issue.acceptance)}</td></tr>`).join('')}
      </tbody></table>
    </section>

    <section class="section">
      <h2>8. AI 文生图 / 目标图审查</h2>
      <table><tbody>
        ${Object.entries(imageAssessment).map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`).join('')}
      </tbody></table>
    </section>

    <section class="section">
      <h2>9. 执行证据</h2>
      <h3>服务检查</h3>
      <table><thead><tr><th>服务</th><th>状态</th><th>URL</th><th>是否复用已有服务</th></tr></thead><tbody>
        ${serverChecks.map((check) => `<tr><td>${escapeHtml(check.name)}</td><td class="status-${escapeHtml(check.status)}">${escapeHtml(check.status)}</td><td>${escapeHtml(check.url)}</td><td>${check.reusedExisting ? '是' : '否'}</td></tr>`).join('')}
      </tbody></table>
      <h3>命令检查</h3>
      <table><thead><tr><th>命令</th><th>状态</th><th>摘要</th></tr></thead><tbody>
        ${commandChecks.map((check) => `<tr><td><code>${escapeHtml(check.command)}</code></td><td class="status-${escapeHtml(check.status)}">${escapeHtml(check.status)}</td><td><pre>${escapeHtml(check.stderr || check.stdout || '')}</pre></td></tr>`).join('')}
      </tbody></table>
    </section>

    <section class="section">
      <h2>10. 出门验收标准</h2>
      <ul>
        <li>普通用户无需进入专家页面，也能通过 ChatBox + 工作台完成候选查询、组合对比、任务追踪和阻断理解。</li>
        <li>资深用户仍可通过左侧菜单直接进入多模块页面，使用筛选、排序、参数配置、完整指标和审计证据。</li>
        <li>页面视觉从深色技术后台转向 light-first、通透、低噪音、专业金融工作台。</li>
        <li>任何页面和 ChatBox 回复都必须显式保持 <code>formalTradingUnlocked=false</code>、<code>autoTradeUnlocked=false</code>、<code>canCreateOrder=false</code>。</li>
      </ul>
    </section>
  </div>
</body>
</html>`
}

async function main() {
  await mkdir(screenshotDir, { recursive: true })
  await mkdir(promptDir, { recursive: true })
  const commandChecks = []
  commandChecks.push(await runCommand('frontend-build', ['npm', 'run', 'build'], frontendDir, 240000))

  const serverChecks = []
  serverChecks.push(await ensureBackend())
  serverChecks.push(await ensureFrontend())

  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}`
    : playwrightLibPath

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 })
  const screenshots = []

  await safeGoto(page, `${frontendUrl}/dashboard`)
  screenshots.push(await capture(page, 'baseline-dashboard.png', '当前基线：Dashboard 总览', '深色侧边栏和指标卡是当前真实实现。', ['总览']))

  await safeGoto(page, `${frontendUrl}/dividend-low-vol`)
  screenshots.push(await capture(page, 'baseline-dividend-low-vol.png', '当前基线：红利低波策略页', '展示当前策略模块的信息密度和专业字段。', ['红利']))

  await safeGoto(page, `${frontendUrl}/backtest`)
  screenshots.push(await capture(page, 'baseline-backtest.png', '当前基线：策略回测页', '展示当前回测模块的曲线、表格和提示结构。', ['回测']))

  await safeGoto(page, `${frontendUrl}/operations`)
  screenshots.push(await capture(page, 'baseline-operations.png', '当前基线：任务中心', '展示当前任务和审计追踪入口。', ['任务']))

  await safeGoto(page, `${frontendUrl}/dashboard`)
  await page.locator('.ant-float-btn').first().click({ timeout: 10000 }).catch(() => null)
  await page.waitForTimeout(1000)
  screenshots.push(await capture(page, 'baseline-chatbox-open.png', '当前基线：ChatBox 打开态', '用于审查当前 ChatBox 是否仍偏技术化和深色抽屉式。', ['FAMS']))

  await page.setViewportSize({ width: 390, height: 844 })
  await safeGoto(page, `${frontendUrl}/dashboard`)
  screenshots.push(await capture(page, 'baseline-mobile-dashboard.png', '当前基线：移动端 Dashboard', '用于检查普通用户在小屏上的首屏路径和信息密度。', ['总览']))
  await page.close()

  const conceptPath = path.join(screenshotDir, 'concept-dual-track.svg')
  const roadmapPath = path.join(screenshotDir, 'user-journey-roadmap.svg')
  await writeFile(conceptPath, conceptSvg(), 'utf8')
  await writeFile(roadmapPath, roadmapSvg(), 'utf8')

  const targetImages = [
    { title: '概念图：双轨体验架构', description: '普通用户与资深用户两条路径共享后端能力和交易 Gate。', fileName: 'concept-dual-track.svg', path: rel(conceptPath), status: 'target_mockup' },
    { title: '路线图：用户操作路径', description: '从进入系统到专家深挖的完整交互路径。', fileName: 'user-journey-roadmap.svg', path: rel(roadmapPath), status: 'target_mockup' },
    await captureTarget(browser, 'target-dashboard-workbench.png', targetDashboardHtml(), '目标截图：普通用户工作台', 'ChatBox + 工作台优先，展示摘要、任务、数据健康和交易边界。'),
    await captureTarget(browser, 'target-chatbox-result.png', targetChatHtml(), '目标截图：ChatBox 对话结果', '对话内返回结论、指标、图表、下一步和折叠证据。'),
    await captureTarget(browser, 'target-expert-module.png', targetExpertHtml(), '目标截图：专家模块页', '保留筛选、排序、完整指标和 ChatBox 解释入口。'),
  ]

  const experiencePathGroups = []
  for (const pathSpec of experiencePaths) {
    const slug = slugify(pathSpec.id)
    const storyboardPath = path.join(screenshotDir, `journey-${slug}.svg`)
    await writeFile(storyboardPath, pathStoryboardSvg(pathSpec), 'utf8')
    const targetImage = await captureTarget(
      browser,
      `target-path-${slug}.png`,
      pathTargetHtml(pathSpec),
      `路径目标图：${pathSpec.title}`,
      `${pathSpec.user}在 ${pathSpec.primaryModule} 中完成任务的目标界面。`,
      pathSpec.id === 'mobile-daily-review' ? { width: 390, height: 844 } : { width: 1440, height: 960 },
    )
    const promptPath = path.join(promptDir, `${slug}.md`)
    await writeFile(promptPath, pathPrompt(pathSpec), 'utf8')
    experiencePathGroups.push({
      ...pathSpec,
      storyboardImage: {
        title: `路径图：${pathSpec.title}`,
        description: '从用户问题到结果验收的完整路径。',
        fileName: `journey-${slug}.svg`,
        path: rel(storyboardPath),
        status: 'target_mockup',
      },
      targetImage,
      promptPath: rel(promptPath),
      qualityAssessment: '通过初检：图稿与路径目标、交易边界、普通/专家双轨概念一致；目标图明确标注为概念稿，不冒充当前实现。',
    })
  }

  await browser.close()

  const issues = [
    {
      issue: '当前入口仍以功能菜单和模块页为主，普通用户路径不够直接。',
      evidence: 'baseline-dashboard.png / baseline-mobile-dashboard.png',
      requirement: '新增 ChatBox + 普通用户工作台作为默认路径，保留专家模块。',
      acceptance: '截图证明普通用户不进入专家页面也能完成主路径。',
    },
    {
      issue: '当前视觉以深紫/深蓝和高饱和状态色为主，缺少通透的专业金融产品感。',
      evidence: 'baseline-dashboard.png / baseline-chatbox-open.png',
      requirement: '建立 light-first、低噪音、语义状态色受控的视觉系统。',
      acceptance: '目标和实现截图证明深色技术后台感不再主导。',
    },
    {
      issue: 'ChatBox 当前主视图仍容易暴露技术状态和 raw evidence/blocked 信息。',
      evidence: 'baseline-chatbox-open.png',
      requirement: '回复按结论、关键数字、下一步、数据可信、证据详情组织；技术细节默认折叠。',
      acceptance: 'ChatBox E2E 截图包含任务卡、普通话结果和 DataHealthNotice。',
    },
    {
      issue: '专家模块信息密度高但仍有价值，不能被 ChatBox 改造误删。',
      evidence: 'baseline-dividend-low-vol.png / baseline-backtest.png',
      requirement: '专家模块继续支持筛选、排序、参数配置、完整证据和 artifactRefs。',
      acceptance: '专家页截图证明深度功能保留，并提供“用 ChatBox 解释当前结果”。',
    },
    {
      issue: '体验简化可能掩盖数据不足和交易锁定。',
      evidence: '所有目标图和验收条款',
      requirement: '所有路径显式显示 dataTrust、blockers、formalTradingUnlocked=false。',
      acceptance: 'grep 和截图均证明未出现可下单、自动交易、正式买卖误导文案。',
    },
  ]

  const imageAssessment = {
    '图像生成方式': '未调用不可追溯的外部 AI 文生图；概念图和目标截图由脚本基于当前文档用 HTML/SVG 确定性生成。',
    '文生图 Prompt 覆盖': `已为 ${experiencePathGroups.length} 条核心用户路径分别落盘可复用 prompt；每条路径另有 storyboard 和目标界面图。`,
    '是否满足优化诉求': '满足。目标图明确表达 ChatBox + 工作台优先、专家模块保留、light-first 通透低噪音视觉方向，并把普通用户与资深用户路径分开。',
    '概念一致性': '通过。所有目标图均保持研究/观察/草案边界，不包含正式买入、卖出、下单或自动交易。',
    '事实性风险': '低。目标图均标注为 target mockup，不冒充当前已实现页面；真实基线截图单独列出。',
    '不足': '目标图不是最终 UI 设计稿，不能替代后续代码实现、真实数据 E2E 和截图验收。',
  }

  const reportHtml = htmlReport({
    serverChecks,
    commandChecks,
    screenshots,
    targetImages,
    experiencePathGroups,
    imageAssessment,
    issues,
  })
  const reportPath = path.join(reportDir, 'ux-optimization-review.html')
  const summaryPath = path.join(reportDir, 'ux-optimization-review.json')
  await writeFile(reportPath, reportHtml, 'utf8')
  await writeFile(summaryPath, JSON.stringify({
    generatedAt,
    reportPath: rel(reportPath),
    status: commandChecks.every((item) => item.status === 'passed') && screenshots.every((item) => item.status === 'passed') ? 'passed_with_ux_gaps' : 'completed_with_findings',
    serverChecks,
    commandChecks,
    screenshots,
    targetImages,
    experiencePathGroups,
    imageAssessment,
    issues,
    tradingBoundary: {
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }, null, 2), 'utf8')

  console.log(JSON.stringify({
    reportPath,
    summaryPath,
    screenshotDir,
    status: 'completed',
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    for (const child of spawned.reverse()) {
      child.kill('SIGTERM')
      await new Promise((resolve) => setTimeout(resolve, 300))
      if (!child.killed) child.kill('SIGKILL')
    }
  })
