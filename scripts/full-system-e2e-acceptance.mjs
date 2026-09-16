import { spawn, spawnSync } from 'node:child_process'
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
const auditEnv = {
  FAMS_FACTSET_SCHEDULER_ENABLED: '0',
  FAMS_DIVIDEND_LOW_VOL_DAILY_SCHEDULER_ENABLED: '0',
  FAMS_QUOTE_LIST_CACHE_READ_ONLY: '1',
}

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
      env: { ...process.env, ...auditEnv, HOST: '127.0.0.1' },
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
    const workspaceModuleUrl = new URL(`/@fs/${frontendDir}/src/App.tsx`, frontendUrl)
    const workspaceResponse = await fetch(workspaceModuleUrl)
    if ((text.includes('/src/') || text.includes('id="root"')) && workspaceResponse.ok) {
      return { name: 'frontend', status: 'passed', reusedExisting: true, readyUrl: frontendUrl }
    }
    throw new Error(`${frontendUrl} is served by a different workspace`)
  } catch {
    // Start a dedicated strict-port Vite instance below.
  }
  const child = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3100', '--strictPort'], {
    cwd: frontendDir,
    env: { ...process.env, ...auditEnv, HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => process.stdout.write(`[frontend] ${chunk}`))
  child.stderr.on('data', (chunk) => process.stderr.write(`[frontend] ${chunk}`))
  spawned.push(child)
  await waitForUrl(frontendUrl, 120000)
  const workspaceModuleUrl = new URL(`/@fs/${frontendDir}/src/App.tsx`, frontendUrl)
  const workspaceResponse = await fetch(workspaceModuleUrl)
  if (!workspaceResponse.ok) {
    throw new Error(`${frontendUrl} did not start from the current frontend workspace`)
  }
  return { name: 'frontend', status: 'passed', reusedExisting: false, readyUrl: frontendUrl }
}

async function runCommand(name, command, cwd, timeoutMs = 240000) {
  const startedAt = nowMs()
  return new Promise((resolve) => {
    const usesProcessGroup = process.platform !== 'win32'
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...process.env, ...auditEnv, CI: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: usesProcessGroup,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const terminate = (signal) => {
      if (usesProcessGroup && child.pid) {
        try {
          process.kill(-child.pid, signal)
          return
        } catch {
          // Fall through when the process group has already exited.
        }
      }
      child.kill(signal)
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminate('SIGTERM')
      setTimeout(() => terminate('SIGKILL'), 3000).unref()
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

async function runCommandsWithConcurrency(commandDefinitions, concurrency = 4) {
  const results = new Array(commandDefinitions.length)
  let nextIndex = 0
  async function worker() {
    while (nextIndex < commandDefinitions.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      const [name, command, cwd, timeoutMs] = commandDefinitions[currentIndex]
      // eslint-disable-next-line no-await-in-loop
      results[currentIndex] = await runCommand(name, command, cwd, timeoutMs)
    }
  }
  const workerCount = Math.max(1, Math.min(concurrency, commandDefinitions.length))
  await Promise.all(Array.from({ length: workerCount }, () => worker()))
  return results
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

function git(args) {
  const result = spawnSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return {
    ok: result.status === 0,
    stdout: stripAnsi(result.stdout || '').trim(),
    stderr: stripAnsi(result.stderr || '').trim(),
  }
}

function buildGitSnapshot() {
  const head = git(['rev-parse', 'HEAD'])
  const branch = git(['branch', '--show-current'])
  const status = git(['status', '--short'])
  const origin = git(['rev-parse', 'origin/main'])
  const diffStat = git(['diff', '--stat'])
  return {
    branch: branch.stdout || 'unknown',
    headCommit: head.stdout || 'unknown',
    originMainCommit: origin.stdout || 'unknown',
    headMatchesOriginMain: Boolean(head.stdout && origin.stdout && head.stdout === origin.stdout),
    workingTreeClean: status.stdout.length === 0,
    statusShort: status.stdout,
    diffStat: diffStat.stdout,
  }
}

function parseJsonFromOutput(output) {
  const text = stripAnsi(output || '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

function buildRuntimeDisclosure(commandResults, apiResults) {
  const sqliteCommand = commandResults.find((item) => item.name === 'sqlite health')
  const sqlitePayload = parseJsonFromOutput(sqliteCommand?.stdout)
  const dividendAuditCommand = commandResults.find((item) => item.name === 'dividend low vol audit package')
  const dividendAuditPayload = parseJsonFromOutput(dividendAuditCommand?.stdout)
  const dividendApi = apiResults.find((item) => item.name === '红利低波候选池')
  const topMissingFields = dividendApi?.summary?.completeness?.topMissingFields || []
  const persistedCandidateCount = Number(dividendApi?.summary?.candidates || 0)
  const sqliteCommandFailed = sqliteCommand?.status !== 'passed'
  const dividendAuditCommandFailed = dividendAuditCommand?.status !== 'passed'
  const sqliteCritical = sqlitePayload?.status === 'critical' || sqlitePayload?.sqliteHealthy === false
  const fixtureFallback = dividendAuditPayload?.package?.candidateSource === 'fixture_fallback_due_to_database_unavailable'
  const persistedDividendDataBlocked = sqliteCommandFailed
    || dividendAuditCommandFailed
    || sqliteCritical
    || fixtureFallback
    || topMissingFields.some((item) => item.field === 'runtime.sqliteHealth')

  return {
    status: persistedDividendDataBlocked ? 'disclosed_runtime_data_risk' : 'ok',
    humanConclusion: persistedDividendDataBlocked
      ? 'SQLite 健康检查、红利低波审计包或持久化候选池存在失败/未知状态；不能声明真实持久化数据链路完整可用。'
      : '运行时健康未发现阻断本阶段审计的持久化数据风险。',
    sqliteHealthCommand: {
      commandStatus: sqliteCommand?.status || 'not_run',
      healthStatus: sqlitePayload?.status || 'unknown',
      sqliteHealthy: sqlitePayload?.sqliteHealthy,
      strict: sqlitePayload?.strict,
      auditPath: sqlitePayload?.path,
    },
    dividendLowVolPersistedCandidates: {
      apiStatus: dividendApi?.status || 'not_run',
      persistedCandidateCount,
      topMissingFields,
    },
    dividendLowVolAuditPackage: {
      commandStatus: dividendAuditCommand?.status || 'not_run',
      healthStatus: dividendAuditPayload?.health?.status || 'unknown',
      candidateSource: dividendAuditPayload?.package?.candidateSource || 'unknown',
      packagePath: dividendAuditPayload?.package?.path,
      fileCount: dividendAuditPayload?.package?.fileCount,
    },
    requiredHumanChecks: [
      '确认 SQLite health command 可以执行，但输出 healthStatus=critical 时不能把持久化候选池当成完整真实数据证明。',
      '确认红利低波候选池 API 若返回 candidates=0 且缺 runtime.sqliteHealth，报告不能声明“当前真实候选池已完整生成”。',
      '确认 fixture_fallback_due_to_database_unavailable 只证明降级审计包可生成，不证明正式持久化 scan/backtest 健康。',
      '确认正式交易仍需 total-return benchmark、字段级 freshness/cross-check、人工签核和生产下单适配器闭环。',
    ],
  }
}

function buildHumanAuditReadiness(model) {
  const requiredEvidence = [
    ['审计对象与版本', Boolean(model.git?.headCommit) && model.git?.workingTreeClean === true, 'Git commit / branch / origin/main 对齐状态，且工作树干净'],
    ['审计导航与证据地图', model.humanReviewGuide?.status === 'passed', '报告首页“先读这里”和“证据地图”'],
    ['原始 PRD 与架构文档', model.documentAudit?.status === 'passed', '文档一致性审计矩阵'],
    ['代码实现映射', model.codeInspection?.status === 'passed', '代码检视矩阵中的页面、路由、服务入口'],
    ['功能覆盖矩阵', Array.isArray(model.prdCoverage?.rows) && model.prdCoverage.rows.length >= 12 && model.prdCoverage?.knownGapCount >= 2, 'PRD 功能覆盖矩阵必须同时列出自动通过项、人工待验项和受控开发缺口'],
    ['自动化测试证据', model.testCoverage?.status === 'passed', '命令、耗时、stdout/stderr 摘要'],
    ['真实 API 交叉验证', assessOverall(model.api || []) === 'passed', 'API 请求、HTTP 状态、响应摘要'],
    ['可视化截图证据', model.browser?.status === 'passed' && (model.browser?.screenshots?.length || 0) >= 18, 'Headless 浏览器截图路径，覆盖三视口与完整投资工作流'],
    ['视觉证据边界与缺陷披露', model.visualEvidenceAudit?.reviewStatus === 'passed', 'visual-evidence-self-audit.json；区分布局证据、真实数据证据和截图中可见的 UX 缺陷'],
    ['运行时/真实数据降级披露', Boolean(model.runtimeDisclosure?.status), '运行时与真实数据降级披露章节；SQLite critical 和 fixture fallback 不得隐藏在 stdout 中'],
    ['交易边界', model.summary?.formalTradingUnlocked === 'false' && model.summary?.autoTradeUnlocked === 'false', '正式交易与自动交易锁定说明'],
    ['限制与阻断项', Array.isArray(model.limitations) && model.limitations.length > 0, '限制章节和正式交易阻断章节'],
  ].map(([label, passed, evidence]) => ({
    label,
    status: passed ? 'passed' : 'failed',
    evidence,
  }))
  return {
    status: assessOverall(requiredEvidence),
    rows: requiredEvidence,
    conclusion: assessOverall(requiredEvidence) === 'passed'
      ? 'human_audit_ready_for_current_stage'
      : 'needs_more_evidence_before_human_audit',
  }
}

function buildVisualEvidenceAudit(model) {
  const screenshots = model.browser?.screenshots || []
  const paths = screenshots.map((item) => item.path).filter(Boolean)
  const baselineShots = screenshots.filter((item) => item.fileName?.startsWith('uxf0-'))
  const scenarioShots = screenshots.filter((item) => !item.fileName?.startsWith('uxf0-'))
  return {
    schemaVersion: 'fams.visual_evidence_self_audit.v1',
    reviewStatus: paths.length >= 18 ? 'passed' : 'failed',
    productVisualStatus: 'needs_work',
    screenshotCount: paths.length,
    baselineScreenshotCount: baselineShots.length,
    scenarioScreenshotCount: scenarioShots.length,
    evidenceBoundary: {
      responsiveBaseline: 'layout_and_readability_only',
      realDataProof: 'api_and_contract_evidence_required',
      scenarioScreenshots: 'interaction_and_visible_result_evidence',
    },
    findings: [
      {
        id: 'VIS-01',
        severity: 'info',
        status: 'passed',
        finding: 'HTML 中引用的截图均由 Headless Chrome 本轮生成；路径完整性由报告自检确认。',
        evidence: `${paths.length} screenshot references`,
      },
      {
        id: 'VIS-02',
        severity: 'major_disclosure',
        status: 'blocked',
        finding: 'UX-F0 三视口基线图只证明布局可读，不证明真实账户数据已经在该视图完成渲染；Assets、Positions、RelativeRotation 的基线图可见空态或加载态。真实数据结论必须交叉查看 readiness/assignments API 与真实数据合同，禁止仅凭截图判绿。',
        evidence: 'screenshots/uxf0-*.png + readiness/assignments API',
      },
      {
        id: 'VIS-03',
        severity: 'minor_product_issue',
        status: 'failed',
        finding: '建议复盘和组合回测截图中出现重复的“券商波动交易复盘提醒”，遮挡右侧局部内容。该问题不改变本轮计算结果，但前端视觉体验仍需修复，不能声明视觉体验已完整出门。',
        evidence: 'screenshots/09-backtest-result.png / screenshots/09b-portfolio-backtest-result.png',
      },
      {
        id: 'VIS-04',
        severity: 'controlled_gap',
        status: 'blocked',
        finding: '当前截图能够证明三场景结果、组合回测参数与交易锁可见，但不构成人工策略归属签核或 advice-level point-in-time 动态重算证据。',
        evidence: 'screenshots/09-backtest-result.png + screenshots/09b-portfolio-backtest-result.png',
      },
    ],
    conclusion: 'report_is_human_auditable_but_product_visual_and_full_prd_exit_remain_blocked',
  }
}

function buildHumanReviewGuide(model) {
  const evidenceMap = [
    {
      claim: '三类资产投资工作流和专家入口均可访问',
      howToVerify: '查看三视口截图；重点核对资产录入、仓位归属、行业轮动、红利低波、统一策略回测、每日复盘和任务中心。',
      evidence: 'screenshots/uxf0-*.png + 用户场景截图证据章节',
      status: model.browser?.status,
    },
    {
      claim: 'ChatBox 已接入受控 LLM planner，但不创建订单',
      howToVerify: '查看 ChatBox 截图、LLM 公共状态 API、ChatBox 消息意图路由 API 和 chat-agent-core 测试。',
      evidence: '01b-chatbox-agentcore.png + /api/v1/llm/status + /api/v1/chat/messages + test:chat-agent-core',
      status: model.prdCoverage?.rows?.find((item) => item.capability.includes('ChatBox'))?.status || 'failed',
    },
    {
      claim: '红利低波研究页覆盖候选、筛选、买卖区间和人工计划 gate',
      howToVerify: '查看红利低波截图 03-07、红利低波 API、红利低波 validation retest 和 frontend runtime 测试。',
      evidence: '03-07 screenshots + /api/v1/strategy/dividend-low-vol/* + dividend-low-vol tests',
      status: model.prdCoverage?.rows?.find((item) => item.capability.includes('红利低波独立菜单'))?.status || 'failed',
    },
    {
      claim: '组合策略回测可以生成曲线、指标和 Operation artifact',
      howToVerify: '查看组合回测截图 08-10、组合回测 API 响应和任务中心 artifact 截图。',
      evidence: '08-11 screenshots + /api/v1/portfolio-backtest/run + Operations artifact',
      status: model.prdCoverage?.rows?.find((item) => item.capability.includes('组合策略多曲线'))?.status || 'failed',
    },
    {
      claim: '投资工作流自动化范围完成，但 PRD 并未全部完成',
      howToVerify: '核对投资工作流 readiness API、WF-1..WF-7 命令、18/20 覆盖，以及人工待确认和 point_in_time_simulation 受控阻断两项。',
      evidence: '/api/v1/investment-workflow/readiness + investment workflow commands + PRD 功能覆盖矩阵',
      status: model.prdCoverage?.automatedStatus === 'passed' && model.prdCoverage?.status === 'blocked' ? 'passed' : 'failed',
    },
    {
      claim: '运行时与真实数据降级状态已显式披露',
      howToVerify: '查看“运行时与真实数据降级披露”：SQLite critical、持久化候选池为 0、fixture fallback 若存在必须直接展示。',
      evidence: 'runtime-disclosure.json + 自动化命令证据 + 红利低波候选池 API',
      status: model.runtimeDisclosure?.status ? 'passed' : 'failed',
    },
    {
      claim: '正式交易与自动交易仍被阻断',
      howToVerify: '查看正式交易阻断章节、trade-action-readiness 输出、ChatBox 被阻断 API 摘要。',
      evidence: 'formalTradingBoundary + test:trade-action-readiness + ChatBox trade_action_blocked',
      status: model.formalTradingBoundary?.formalTradingUnlocked === false
        && model.formalTradingBoundary?.autoTradeUnlocked === false
        && model.formalTradingBoundary?.orderCreateAllowed === false ? 'passed' : 'failed',
    },
    {
      claim: '报告不是正式交易 release 证明',
      howToVerify: '查看限制与不通过项；确认 total-return benchmark、数据 freshness、人工签核、生产下单适配器仍列为 blocker。',
      evidence: '限制与不通过项 + 正式交易仍然阻断',
      status: Array.isArray(model.formalTradingBoundary?.remainingBlockers) && model.formalTradingBoundary.remainingBlockers.length > 0 ? 'passed' : 'failed',
    },
  ]

  const auditSteps = [
    '先读顶部结论：确认总体结论、人类审计完备性、Git commit 与 origin/main 一致。',
    '读“本阶段能声明 / 不能声明”：确认没有把研究级验收误写成正式交易放行。',
    '按“证据地图”逐条抽查 claim、截图、API、测试命令和代码映射是否一致。',
    '打开截图 01b 检查 ChatBox：它应显示研究模式、订单阻断和 LLM/AgentCore 状态。',
    '按三视口截图检查 Assets -> Positions -> RelativeRotation/DividendLowVol -> Backtest -> DailyReviews -> Operations 连续路径。',
    '打开组合回测和任务中心截图：场景结果、回测结果和 artifact 追溯应可见。',
    '读 API 交叉验证：确认 LLM 状态脱敏、ChatBox 返回 trade_action_blocked、组合回测有 artifact。',
    '读“运行时与真实数据降级披露”：确认 SQLite critical、候选池为空或 fixture fallback 没有被包装成完整真实数据通过。',
    '读限制与阻断项：确认正式交易、自动交易、生产下单仍未释放。',
  ]

  return {
    status: assessOverall(evidenceMap),
    audience: '产品负责人、外部审计者、开发负责人、非本轮开发人员',
    stageScope: '本报告审计 FAMS 当前集成阶段：三类资产投资工作流、红利低波、RRG、统一策略回测、每日复盘、ChatBox、FTR provisional 链、Operation 追溯和交易 gate。它不替代集中人工验收，也不是正式交易 release 证明。',
    canClaim: [
      '可以声明本阶段核心研究路径、人工计划草案路径、组合回测路径和 ChatBox 受控业务助手路径完成自动化验收。',
      '可以声明报告具备截图、API、命令、代码映射、PRD 覆盖、Git 版本和限制项证据。',
      '可以声明 LLM 密钥状态只展示 keySource，真实密钥未进入报告。',
      '可以声明投资工作流 WF-0..WF-7 文档支撑的自动化范围通过；必须同时披露 PRD 仅 18/20。',
    ],
    cannotClaim: [
      '不能声明正式 ADD / REDUCE 已释放。',
      '不能声明 ORDER_CREATE 或 AUTO_TRADE 可用。',
      '不能声明免费数据源等同于正式授权 total-return benchmark。',
      '不能声明每日实时数据最新性已经被本报告完全证明。',
      '若 runtime disclosure 显示 SQLite critical、持久化候选池为空或 fixture fallback，不能声明红利低波真实持久化候选池完整可用。',
      '不能声明投资工作流 PRD 全部完成：截图/归属/UX 人工确认仍 pending，建议级 point_in_time_simulation 仍未实现。',
    ],
    auditSteps,
    evidenceMap,
  }
}

async function buildDocumentAudit() {
  const [prd, backtestPlan, investmentPrd, investmentPlan, traceability, stateText, targetGap, architecture, drawio, drawioReadout] = await Promise.all([
    readText('docs/DIVIDEND_LOW_VOL_PRD.md'),
    readText('docs/PORTFOLIO_STRATEGY_BACKTEST_PLAN.md'),
    readText('docs/INVESTMENT_WORKFLOW_UX_PRD.md'),
    readText('docs/INVESTMENT_WORKFLOW_DEVELOPMENT_ACCEPTANCE_PLAN.md'),
    readText('docs/PRD_COMPLETION_TRACEABILITY_MATRIX.md'),
    readText('docs/current-stage-state.json'),
    readText('docs/TARGET_ARCHITECTURE_GAP.md'),
    readText('docs/ARCHITECTURE_CURRENT_TARGET.md'),
    readText('docs/target-architecture-gap.drawio'),
    readText('docs/read-drawio-output.txt'),
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
    {
      id: 'investment_workflow_prd_and_plan',
      label: '投资工作流 PRD 与 WF-0..WF-7 验收计划完整存在',
      status: investmentPrd.includes('行业轮动') && investmentPrd.includes('红利低波') && investmentPrd.includes('投资组合')
        && investmentPlan.includes('WF-7') && investmentPlan.includes('18/20') ? 'passed' : 'failed',
      evidence: 'INVESTMENT_WORKFLOW_UX_PRD.md / INVESTMENT_WORKFLOW_DEVELOPMENT_ACCEPTANCE_PLAN.md',
    },
    {
      id: 'investment_gap_honestly_disclosed',
      label: '权威状态与架构文档一致披露 18/20、人工待验和动态时点缺口',
      status: stateText.includes('"prdFullyComplete": false')
        && `${targetGap}\n${architecture}\n${traceability}`.includes('point_in_time_simulation')
        && `${targetGap}\n${architecture}`.includes('18/20') ? 'passed' : 'failed',
      evidence: 'current-stage-state.json / TARGET_ARCHITECTURE_GAP.md / ARCHITECTURE_CURRENT_TARGET.md / PRD_COMPLETION_TRACEABILITY_MATRIX.md',
    },
    {
      id: 'drawio_r6_current_implementation',
      label: 'Drawio 第 2 页包含第六条投资工作流实体链且无伪全绿',
      status: drawioReadout.includes('R6 投资工作流') && drawioReadout.includes('动态逐日重算明确 blocked')
        && drawioReadout.includes('PRD 全量仍未出门') ? 'passed' : 'failed',
      evidence: 'target-architecture-gap.drawio / read-drawio-output.txt',
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
      investmentPrdLength: investmentPrd.length,
      investmentPlanLength: investmentPlan.length,
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
    chatBox: 'frontend/src/components/chat/FamsChatBox.tsx',
    analysisService: 'frontend/src/services/analysisService.ts',
    backendIndex: 'backend/src/index.ts',
    strategyRoutes: 'backend/src/routes/strategy.ts',
    analysisRoutes: 'backend/src/routes/analysis.ts',
    portfolioBacktestRoutes: 'backend/src/routes/portfolioBacktest.ts',
    operationRoutes: 'backend/src/routes/operation.ts',
    llmRoutes: 'backend/src/routes/llm.ts',
    famsChatService: 'backend/src/services/chat/famsChatService.ts',
    chatLlmPlannerService: 'backend/src/services/chat/chatLlmPlannerService.ts',
    llmConfig: 'backend/src/config/llmConfig.ts',
    llmService: 'backend/src/services/llm/llmService.ts',
    chatPlanDoc: 'docs/CHATBOX_AGENTCORE_INTEGRATION_PLAN.md',
    llmDotenvDoc: 'docs/LLM_DOTENV_SETUP.md',
    assetsPage: 'frontend/src/pages/Assets.tsx',
    positionsPage: 'frontend/src/pages/Positions.tsx',
    relativeRotationPage: 'frontend/src/pages/RelativeRotation.tsx',
    dailyReviewsPage: 'frontend/src/pages/DailyReviews.tsx',
    workflowBar: 'frontend/src/components/investment-workflow/InvestmentWorkflowBar.tsx',
    assignmentPanel: 'frontend/src/components/investment-workflow/PositionStrategyAssignmentPanel.tsx',
    rotationPanel: 'frontend/src/components/investment-workflow/RotationStrategyDecisionPanel.tsx',
    investmentRoutes: 'backend/src/routes/investmentWorkflow.ts',
    investmentService: 'backend/src/services/investment-workflow/investmentWorkflowService.ts',
    rotationService: 'backend/src/services/investment-workflow/rotationVolatilityStrategyService.ts',
    allocationStrategy: 'backend/src/services/allocation/alipayAllocationStrategy.ts',
    scenarioComparison: 'backend/src/services/backtest/scenarioComparisonService.ts',
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
    {
      id: 'frontend_chatbox_research_gate',
      label: 'ChatBox 前端入口明确研究模式和订单阻断',
      status: source.chatBox.includes('FAMS 业务助手') && source.chatBox.includes('研究助手，不创建订单') && source.chatBox.includes('ORDER_CREATE') ? 'passed' : 'failed',
      evidence: paths.chatBox,
    },
    {
      id: 'frontend_chatbox_llm_status',
      label: 'ChatBox 前端展示 LLM planner 状态且密钥脱敏',
      status: source.chatBox.includes('latestAgentCore.llm') && source.chatBox.includes('Planner') && source.chatBox.includes('已脱敏') ? 'passed' : 'failed',
      evidence: paths.chatBox,
    },
    {
      id: 'backend_llm_public_status',
      label: '后端提供 LLM 公共状态接口且不暴露密钥',
      status: source.llmRoutes.includes('/status') && source.llmRoutes.includes('getFamsLlmPublicStatus') && source.llmConfig.includes('secretsRedacted: true') ? 'passed' : 'failed',
      evidence: `${paths.llmRoutes} / ${paths.llmConfig}`,
    },
    {
      id: 'backend_chat_llm_planner_controlled',
      label: 'ChatBox LLM 只做意图路由，不直接执行交易或工具',
      status: source.chatLlmPlannerService.includes('受控意图路由器')
        && source.chatLlmPlannerService.includes('trade_action_blocked')
        && source.chatLlmPlannerService.includes('toolExecutionBoundary')
        && source.chatLlmPlannerService.includes('formalTradingUnlocked: false')
        && source.chatLlmPlannerService.includes('autoTradeUnlocked: false')
        && source.famsChatService.includes('planIntent') ? 'passed' : 'failed',
      evidence: `${paths.chatLlmPlannerService} / ${paths.famsChatService}`,
    },
    {
      id: 'llm_dotenv_documented',
      label: 'LLM dotenv 配置文档说明兼容 Key、脱敏和交易边界',
      status: source.llmDotenvDoc.includes('DEEPSEEK_API_KEY')
        && (source.llmDotenvDoc.includes('不要提交') || source.llmDotenvDoc.includes('不得提交') || source.llmDotenvDoc.includes('不提交'))
        && source.llmDotenvDoc.includes('不会自动下单') ? 'passed' : 'failed',
      evidence: paths.llmDotenvDoc,
    },
    {
      id: 'investment_workflow_frontend_chain',
      label: '前端保留资产、仓位、轮动、红利、回测和复盘的连续三步工作流',
      status: source.assetsPage.includes('基本信息确认')
        && source.positionsPage.includes('PositionStrategyAssignmentPanel')
        && source.relativeRotationPage.includes('RotationStrategyDecisionPanel')
        && source.backtestPage.includes('按建议、不执行与实际持仓')
        && source.dailyReviewsPage.includes('每日持仓复盘')
        && source.workflowBar.includes('basic_information_confirmation')
        && source.workflowBar.includes('position_strategy')
        && source.workflowBar.includes('backtest_review') ? 'passed' : 'failed',
      evidence: 'Assets.tsx / Positions.tsx / RelativeRotation.tsx / Backtest.tsx / DailyReviews.tsx / InvestmentWorkflowBar.tsx',
    },
    {
      id: 'investment_workflow_backend_chain',
      label: '后端投资工作流 API 与三类策略/场景服务实体存在并保持交易阻断',
      status: source.backendIndex.includes('investmentWorkflowRoutes')
        && source.investmentRoutes.includes('/readiness')
        && source.investmentRoutes.includes('/assignments')
        && source.investmentRoutes.includes('/strategy-runs')
        && source.investmentService.includes('getReadiness')
        && source.rotationService.includes('RotationVolatilityStrategyService')
        && source.allocationStrategy.includes('AlipayAllocationStrategy')
        && source.scenarioComparison.includes('point_in_time_dynamic_recompute_not_implemented') ? 'passed' : 'failed',
      evidence: 'investmentWorkflow.ts / investment-workflow services / alipayAllocationStrategy.ts / scenarioComparisonService.ts',
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

function commandMeetsStageExpectation(result) {
  if (!result) return false
  if (result.name !== 'trade action readiness') return result.status === 'passed'
  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  return result.status === 'failed'
    && output.includes('"strictTrade": true')
    && output.includes('"formalTradingUnlocked": false')
    && output.includes('"autoTradeUnlocked": false')
    && output.includes('"orderCreateAllowed": false')
    && (output.includes('"blockerGateIds"') || output.includes('"status": "no_evidence"'))
}

function buildPrdCoverage(commandResults, apiResults, screenshots) {
  const hasPassedCommand = (name) => commandResults.some((item) => commandMeetsStageExpectation(item) && item.name === name)
  const hasPassedApi = (name) => apiResults.some((item) => item.name === name && item.status === 'passed')
  const hasPassedShot = (title) => screenshots.some((item) => item.title === title && item.status === 'passed')
  const hasPassedUxMatrix = () => {
    const viewports = ['桌面 1440px', '平板 768px', '移动端 390px']
    const pages = ['Dashboard 总览', '资产管理', '仓位管理', '相对轮动与波动仓', '红利低波策略', '策略回测', '每日复盘', '任务中心']
    const requiredTitles = viewports.flatMap((viewport) => pages.map((page) => `UX-F0 ${viewport} ${page}`))
    return requiredTitles.every((title) => hasPassedShot(title))
  }
  const rows = [
    {
      capability: '基本信息确认：截图/Excel 资产录入、账户来源和数据日期',
      status: hasPassedShot('UX-F0 桌面 1440px 资产管理') && hasPassedApi('投资工作流 readiness') && hasPassedCommand('investment workflow foundation') ? 'passed' : 'failed',
      evidence: 'Assets 三视口截图 + /api/v1/investment-workflow/readiness + foundation contract',
      disposition: 'automated',
    },
    {
      capability: '仓位策略：三类资产归属建议与人工确认入口',
      status: hasPassedShot('UX-F0 桌面 1440px 仓位管理') && hasPassedApi('投资工作流 assignments') && hasPassedCommand('investment workflow readiness') ? 'passed' : 'failed',
      evidence: 'Positions 三视口截图 + assignments API + readiness contract',
      disposition: 'automated',
    },
    {
      capability: '行业轮动与波动仓：RRG + MACD + 均线 + 成交量研究网格',
      status: hasPassedShot('UX-F0 桌面 1440px 相对轮动与波动仓') && hasPassedCommand('investment workflow rotation') ? 'passed' : 'failed',
      evidence: 'RelativeRotation 三视口截图 + rotation strategy contract',
      disposition: 'automated',
    },
    {
      capability: '红利低波独立菜单和研究模式说明',
      status: hasPassedShot('红利低波普通用户路径') ? 'passed' : 'failed',
      evidence: '前端截图 /dividend-low-vol',
      disposition: 'automated',
    },
    {
      capability: '候选池指标、筛选、排序和数据完整性展示',
      status: hasPassedShot('红利低波筛选与指标') && hasPassedApi('红利低波候选池') ? 'passed' : 'failed',
      evidence: '截图 + /api/v1/strategy/dividend-low-vol/candidates',
      disposition: 'automated',
    },
    {
      capability: '买入/卖出观察区间和滚动策略展示',
      status: hasPassedShot('红利低波买卖区间') ? 'passed' : 'blocked',
      evidence: '前端截图；若未先运行区间生成，报告为 blocked',
      disposition: 'automated',
    },
    {
      capability: '人工计划草案与交易 gate',
      status: hasPassedShot('人工计划草案 Gate') && hasPassedCommand('trade action readiness') ? 'passed' : 'failed',
      evidence: '前端截图 + test:trade-action-readiness',
      disposition: 'automated',
    },
    {
      capability: '组合策略多曲线回测',
      status: hasPassedShot('组合回测结果') && hasPassedCommand('portfolio backtest API contract') ? 'passed' : 'failed',
      evidence: '前端截图 + test:portfolio-backtest-api-contract',
      disposition: 'automated',
    },
    {
      capability: '统一策略回测：按建议、不执行建议、实际持仓与组合回测',
      status: hasPassedShot('UX-F0 桌面 1440px 策略回测') && hasPassedCommand('investment workflow scenario comparison') ? 'passed' : 'failed',
      evidence: 'Backtest 三视口截图 + scenario comparison contract',
      disposition: 'automated',
    },
    {
      capability: '复盘调整：每日复盘与跨页工作流入口',
      status: hasPassedShot('UX-F0 桌面 1440px 每日复盘') && hasPassedCommand('daily review real data') && hasPassedCommand('investment workflow cross page') ? 'passed' : 'failed',
      evidence: 'DailyReviews 三视口截图 + real-data E2E + cross-page contract',
      disposition: 'automated',
    },
    {
      capability: '任务中心产物追溯',
      status: hasPassedShot('任务中心产物') ? 'passed' : 'blocked',
      evidence: '前端截图 /operations',
      disposition: 'automated',
    },
    {
      capability: '正式交易和自动交易禁止',
      status: hasPassedCommand('trade action readiness') && hasPassedApi('组合回测 API') ? 'passed' : 'failed',
      evidence: '命令 + API prohibitedActions',
      disposition: 'automated',
    },
    {
      capability: 'FIVD-R 统一分析入口和交易阻断可见',
      status: hasPassedShot('FIVD-R 分析建议') && hasPassedCommand('fivd-r core') ? 'passed' : 'failed',
      evidence: '截图 /analysis?section=fivdr + test:fivd-r-core',
      disposition: 'automated',
    },
    {
      capability: '跨设备基础可读性截图',
      status: hasPassedUxMatrix() ? 'passed' : 'failed',
      evidence: 'Playwright UX-F0 1440px/768px/390px screenshots for Dashboard/DividendLowVol/Backtest/Operations',
      disposition: 'automated',
    },
    {
      capability: 'ChatBox 业务助手与受控 LLM planner',
      status: hasPassedShot('ChatBox 业务助手') && hasPassedCommand('chat agent core') && hasPassedCommand('chat llm planner') && hasPassedApi('LLM 公共状态') ? 'passed' : 'failed',
      evidence: '截图 + test:chat-agent-core + test:chat-llm-planner + /api/v1/llm/status',
      disposition: 'automated',
    },
    {
      capability: '真实账户策略归属、截图行纠正与最终 UX 语义确认',
      status: 'blocked',
      evidence: '16 个真实持仓策略归属仍 pending；属于集中人工核查，不得由自动化代签',
      disposition: 'human_pending',
    },
    {
      capability: '建议级 point_in_time_simulation：冻结策略逐日动态重算',
      status: 'blocked',
      evidence: 'ScenarioComparisonService 明确返回 point_in_time_dynamic_recompute_not_implemented；需独立后续开发与防前视验收',
      disposition: 'controlled_product_gap',
    },
  ]
  const automatedRows = rows.filter((item) => item.disposition === 'automated')
  return {
    status: assessOverall(rows),
    automatedStatus: assessOverall(automatedRows),
    automatedPassedCount: automatedRows.filter((item) => item.status === 'passed').length,
    automatedRequirementCount: automatedRows.length,
    knownGapCount: rows.filter((item) => item.status === 'blocked').length,
    rows,
  }
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
    ['llm dotenv config', 'LLM dotenv 配置与密钥脱敏'],
    ['chat llm planner', 'ChatBox LLM 意图路由'],
    ['chat agent core', 'ChatBox AgentCore 合同'],
    ['frontend build', '前端构建'],
    ['current stage consistency', '唯一状态源与文档一致性'],
    ['next stage documentation baseline', 'Drawio/架构/门禁文档基线'],
    ['daily review real data', '每日复盘真实数据 E2E'],
    ['investment workflow foundation', '投资工作流基础合同'],
    ['investment workflow readiness', '三类资产归属与 readiness'],
    ['investment workflow rotation', '行业轮动波动策略合同'],
    ['investment workflow portfolio policy', '支付宝组合策略合同'],
    ['investment workflow scenario comparison', '三场景统一回测合同'],
    ['investment workflow cross page', '跨页用户路径合同'],
    ['v2 px semantic contract', 'V2-PX 语义合同'],
    ['v2 px policy', 'V2-PX 策略与容器边界'],
    ['v2 px api contract', 'V2-PX API 合同'],
    ['ftr data artifacts', 'FTR-1 数据证据合同'],
    ['ftr benchmark artifacts', 'FTR-2 benchmark 证据合同'],
    ['ftr validation artifacts', 'FTR-3 正式验证证据合同'],
    ['ftr deferred queue', 'FTR-4 集中人工队列合同'],
    ['ftr execution isolation', 'FTR-5 执行隔离合同'],
    ['ftr provisional package', 'FTR-6 provisional 包合同'],
    ['a6 human draft', 'A6 人工反馈草稿合同'],
    ['strict trade remains blocked', 'FTR 严格交易锁合同'],
  ]
  const rows = required.map(([name, label]) => {
    const result = commandResults.find((item) => item.name === name)
    return {
      name,
      label,
      status: result ? (commandMeetsStageExpectation(result) ? 'passed' : result.status) : 'blocked',
      actualCommandStatus: result?.status || 'not_run',
      expectation: name === 'trade action readiness'
        ? 'strict command must reject while formalTradingUnlocked/autoTradeUnlocked/orderCreateAllowed remain false'
        : 'exit code 0',
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
      if (message.type() === 'error' && !/^Warning:\s/.test(message.text())) consoleErrors.push(message.text())
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

  const uxBaselineViewports = [
    { name: 'desktop-1440', width: 1440, height: 1100, label: '桌面 1440px' },
    { name: 'tablet-768', width: 768, height: 1024, label: '平板 768px' },
    { name: 'mobile-390', width: 390, height: 844, label: '移动端 390px' },
  ]
  const uxBaselineTargets = [
    { key: 'dashboard', path: '/dashboard', title: 'Dashboard 总览', requiredTexts: ['FAMS'] },
    { key: 'assets', path: '/assets', title: '资产管理', requiredTexts: ['基本信息确认'] },
    { key: 'positions', path: '/positions', title: '仓位管理', requiredTexts: ['仓位策略入口'] },
    { key: 'relative-rotation', path: '/relative-rotation', title: '相对轮动与波动仓', requiredTexts: ['行业轮动策略结论'] },
    { key: 'dividend-low-vol', path: '/dividend-low-vol', title: '红利低波策略', requiredTexts: ['红利低波策略'] },
    { key: 'backtest', path: '/backtest', title: '策略回测', requiredTexts: ['策略回测'] },
    { key: 'daily-reviews', path: '/daily-reviews', title: '每日复盘', requiredTexts: ['每日持仓复盘'] },
    { key: 'operations', path: '/operations', title: '任务中心', requiredTexts: ['任务中心'] },
  ]

  async function captureUxBaselineMatrix() {
    for (const viewport of uxBaselineViewports) {
      // eslint-disable-next-line no-await-in-loop
      await withPage({ width: viewport.width, height: viewport.height }, async (page) => {
        for (const target of uxBaselineTargets) {
          // eslint-disable-next-line no-await-in-loop
          await page.goto(`${frontendUrl}${target.path}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
          // eslint-disable-next-line no-await-in-loop
          await waitForBodyText(page, target.requiredTexts, 120000)
          // eslint-disable-next-line no-await-in-loop
          screenshots.push(await screenshot(
            page,
            `uxf0-${viewport.name}-${target.key}.png`,
            `UX-F0 ${viewport.label} ${target.title}`,
            `${viewport.label} 视口下验证 ${target.title} 主路径可读、主内容不被侧栏挤压。`,
            target.requiredTexts,
          ))
        }
      })
    }
  }

  try {
    await withPage({ width: 1440, height: 1100 }, async (page) => {
      await page.goto(`${frontendUrl}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await waitForBodyText(page, ['FAMS'])
      screenshots.push(await screenshot(page, '01-dashboard.png', '总览与侧边栏', '证明左侧菜单和系统入口可见。', ['FAMS', '红利低波策略', '策略回测']))
      await page.locator('.ant-float-btn').first().click({ timeout: 30000 })
      await waitForBodyText(page, ['FAMS 业务助手', '研究助手，不创建订单'], 30000)
      const tradeBlockerTask = page.getByText('解释为什么不能交易').first()
      if (await tradeBlockerTask.isVisible({ timeout: 5000 }).catch(() => false)) {
        await tradeBlockerTask.click({ timeout: 30000 })
      } else {
        await page.getByPlaceholder(/例如：/).fill('为什么不能下单')
        await page.getByRole('button', { name: '发送' }).click()
      }
      await waitForBodyText(page, ['ORDER_CREATE', 'AUTO_TRADE'], 60000)
      screenshots.push(await screenshot(page, '01b-chatbox-agentcore.png', 'ChatBox 业务助手', '证明 ChatBox 可打开、可发起业务问题、显示订单阻断和 LLM/AgentCore 状态。', ['FAMS 业务助手', '研究助手，不创建订单', 'ORDER_CREATE', 'AUTO_TRADE']))
    })
  } catch (error) {
    await captureFailure('总览与侧边栏异常', error)
  }

  try {
    await withPage({ width: 1440, height: 1100 }, async (page) => {
      await page.goto(`${frontendUrl}/analysis?section=fivdr`, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await waitForBodyText(page, ['分析建议', 'FIVD-R'], 120000)
      screenshots.push(await screenshot(page, '02-analysis-fivd-r.png', 'FIVD-R 分析建议', '证明 FIVD-R 统一分析入口、研究/交易阻断语义可见。', ['FIVD-R', '交易', '建议']))
    })
  } catch (error) {
    await captureFailure('FIVD-R 分析建议异常', error)
  }

  try {
    await withPage({ width: 1440, height: 1100 }, async (page) => {
      await page.goto(`${frontendUrl}/dividend-low-vol`, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.getByTestId('dividend-plain-next-step').waitFor({ timeout: 120000 })
      await waitForBodyText(page, ['红利低波策略', '普通模式：先看结论和下一步', 'AUTO_TRADE'])
      screenshots.push(await screenshot(page, '03-dividend-low-vol-overview.png', '红利低波普通用户路径', '普通模式优先展示结论、下一步、数据可信和交易边界，专家工作台仍保留。', ['红利低波策略', '普通模式：先看结论和下一步', 'AUTO_TRADE']))
      await page.getByText('专业模式', { exact: true }).click()
      await page.getByTestId('dividend-expert-workbench').waitFor({ timeout: 30000 })
      await page.getByText('筛选与排序').scrollIntoViewIfNeeded()
      screenshots.push(await screenshot(page, '04-dividend-low-vol-filters.png', '红利低波筛选与指标', '专业模式展示候选筛选、排序指标和完整证据，普通模式入口仍保留。', ['筛选与排序', '排序指标', '综合分']))
      await page.getByText('买入/卖出观察区间与滚动策略').scrollIntoViewIfNeeded()
      screenshots.push(await screenshot(page, '05-dividend-low-vol-zones.png', '红利低波买卖区间', '买入/卖出观察区间与滚动策略明确保持正式 ADD / REDUCE 锁定。', ['买入/卖出观察区间', '正式 ADD', '正式 REDUCE']))
      await page.getByText('5. 生成观察草案').scrollIntoViewIfNeeded()
      screenshots.push(await screenshot(page, '06-dividend-low-vol-manual-gate.png', '人工计划草案 Gate', '观察草案进入人工复核，不创建正式买卖或自动交易动作。', ['5. 生成观察草案', '正式交易锁定']))
    })
  } catch (error) {
    await captureFailure('红利低波主路径异常', error)
  }

  try {
    await withPage({ width: 768, height: 1024 }, async (page) => {
      await page.goto(`${frontendUrl}/dividend-low-vol`, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await waitForBodyText(page, ['红利低波策略'], 120000)
      screenshots.push(await screenshot(page, '07-tablet-dividend-low-vol.png', '平板端红利低波', '平板视口下验证红利低波页面可读性。', ['红利低波策略']))
    })
  } catch (error) {
    await captureFailure('平板端红利低波异常', error)
  }

  try {
    await withPage({ width: 1440, height: 1100 }, async (page) => {
      const adviceId = process.env.FAMS_E2E_ADVICE_ID || '724b5641-9dbe-4b33-b6a1-4bd9ca61b89a'
      await page.goto(`${frontendUrl}/backtest?mode=review&adviceId=${encodeURIComponent(adviceId)}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.getByTestId('run-scenario-comparison').waitFor({ timeout: 120000 })
      screenshots.push(await screenshot(page, '08-backtest-before-run.png', '统一策略回测入口', '同一页面保留建议复盘与组合回测，当前展示建议复盘入口。', ['策略回测', '建议复盘', '运行三场景复盘']))
      await page.getByTestId('run-scenario-comparison').click({ force: true })
      await page.getByTestId('scenario-comparison-result').waitFor({ timeout: 180000 })
      await waitForBodyText(page, ['按建议执行', '不执行建议', '实际交易流水'], 30000)
      screenshots.push(await screenshot(page, '09-backtest-result.png', '三场景真实数据复盘结果', '按建议、不执行建议和实际交易流水使用同一时间轴展示；动态时点重算仍单独阻断。', ['按建议执行', '不执行建议', '实际交易流水']))
      await page.getByText('组合回测', { exact: true }).first().click()
      await page.getByTestId('portfolio-backtest-workspace').waitFor({ timeout: 30000 })
      await waitForBodyText(page, ['投资组合回测', '运行并保存固定规则回测'], 30000)
      screenshots.push(await screenshot(page, '09a-portfolio-backtest-entry.png', '组合回测入口', '统一策略回测页面内保留组合策略选择、固定规则和正式交易边界。', ['投资组合回测', '运行并保存固定规则回测', 'AUTO_TRADE']))
      await page.getByRole('button', { name: '运行并保存固定规则回测' }).click()
      await waitForBodyText(page, ['正式交易未解锁', 'Benchmark', '总收益'], 300000)
      screenshots.push(await screenshot(page, '09b-portfolio-backtest-result.png', '组合回测结果', '真实样本组合曲线、收益指标、benchmark 和交易锁同时可审计。', ['Benchmark', '总收益', '正式交易未解锁']))
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
      await page.goto(operationsUrl, { waitUntil: 'domcontentloaded', timeout: 120000 })
      await waitForBodyText(page, ['任务中心'], 120000)
      await page.waitForTimeout(2000)
      screenshots.push(await screenshot(page, '11-operations-artifact.png', '任务中心产物', '任务中心 operation 与 artifact 可追溯。', ['任务中心', firstArtifactRef ? '任务产物' : '组合回测']))
    })
  } catch (error) {
    await captureFailure('任务中心产物异常', error)
  }

  try {
    await captureUxBaselineMatrix()
  } catch (error) {
    await captureFailure('UX-F0 响应式基线矩阵异常', error)
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
    await page.goto(`${frontendUrl}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForBodyText(page, ['FAMS'])
    screenshots.push(await screenshot(page, '01-dashboard.png', '总览与侧边栏', '证明左侧菜单和系统入口可见。', ['FAMS', '红利低波策略', '策略回测']))

    await page.goto(`${frontendUrl}/analysis?section=fivdr`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForBodyText(page, ['分析建议', 'FIVD-R'], 120000)
    screenshots.push(await screenshot(page, '02-analysis-fivd-r.png', 'FIVD-R 分析建议', '证明 FIVD-R 统一分析入口、研究/交易阻断语义可见。', ['FIVD-R', '交易', '建议']))

    await page.goto(`${frontendUrl}/dividend-low-vol`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForBodyText(page, ['红利低波策略', '不构成交易指令'])
    screenshots.push(await screenshot(page, '03-dividend-low-vol-overview.png', '红利低波策略页', '独立菜单页、研究模式 banner、禁止交易动作。', ['红利低波策略', '不构成交易指令', 'AUTO_TRADE']))
    await page.getByText('筛选与排序').scrollIntoViewIfNeeded().catch(() => {})
    screenshots.push(await screenshot(page, '04-dividend-low-vol-filters.png', '红利低波筛选与指标', '候选池筛选、排序和指标说明区域。', ['筛选与排序', '排序指标', '综合分']))
    await page.getByText('买入/卖出观察区间与滚动策略').scrollIntoViewIfNeeded().catch(() => {})
    screenshots.push(await screenshot(page, '05-dividend-low-vol-zones.png', '红利低波买卖区间', '买入/卖出观察区间、滚动回测和区间免责声明。', ['买入/卖出观察区间', '正式 ADD', '正式 REDUCE']))
    await waitForBodyText(page, ['生成观察草案', '不会生成正式买入、卖出或自动交易动作'], 30000)
    await page.getByText('5. 生成观察草案').scrollIntoViewIfNeeded().catch(() => {})
    screenshots.push(await screenshot(page, '06-dividend-low-vol-manual-gate.png', '人工计划草案 Gate', '证明观察草案入口存在，且页面明确禁止正式交易动作；若 readiness 数据可用，同一页面继续展示草案 Gate。', ['生成观察草案', '不会生成正式买入、卖出或自动交易动作']))
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.goto(`${frontendUrl}/dividend-low-vol`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForBodyText(page, ['红利低波策略'], 120000)
    screenshots.push(await screenshot(page, '07-tablet-dividend-low-vol.png', '平板端红利低波', '平板视口下验证红利低波页面可读性。', ['红利低波策略']))
    await page.setViewportSize({ width: 1440, height: 1100 })

    await page.goto(`${frontendUrl}/backtest`, { waitUntil: 'domcontentloaded', timeout: 120000 })
    await waitForBodyText(page, ['组合策略对比回测', '运行并保存固定规则回测'])
    screenshots.push(await screenshot(page, '08-backtest-before-run.png', '组合回测入口', '组合回测参数和非交易建议 banner。', ['组合策略对比回测', '不构成交易指令', '运行并保存固定规则回测']))
    await page.getByRole('button', { name: '运行并保存固定规则回测' }).click()
    await waitForBodyText(page, ['正式交易未解锁', 'Benchmark', '非交易建议'], 300000)
    await waitForBodyText(page, ['超额收益', '总收益'], 30000)
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
    await page.goto(operationsUrl, { waitUntil: 'domcontentloaded', timeout: 120000 })
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
  const visualFindingRows = model.visualEvidenceAudit.findings.map((item) => `
    <tr>
      <td>${escapeHtml(item.id)}</td>
      <td>${escapeHtml(item.severity)}</td>
      <td>${renderStatus(item.status)}</td>
      <td>${escapeHtml(item.finding)}</td>
      <td>${escapeHtml(item.evidence)}</td>
    </tr>
  `).join('\n')
  const reviewClaimRows = model.humanReviewGuide.evidenceMap.map((item) => `
    <tr>
      <td>${escapeHtml(item.claim)}</td>
      <td>${renderStatus(item.status)}</td>
      <td>${escapeHtml(item.howToVerify)}</td>
      <td>${escapeHtml(item.evidence)}</td>
    </tr>
  `).join('\n')
  const auditStepRows = model.humanReviewGuide.auditSteps.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item)}</td>
    </tr>
  `).join('\n')
  const canClaimList = model.humanReviewGuide.canClaim.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')
  const cannotClaimList = model.humanReviewGuide.cannotClaim.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')
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
      <td>${renderStatus(commandMeetsStageExpectation(item) ? 'passed' : item.status)}</td>
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

  const humanAuditRows = model.humanAuditReadiness.rows.map((item) => `
    <tr>
      <td>${escapeHtml(item.label)}</td>
      <td>${renderStatus(item.status)}</td>
      <td>${escapeHtml(item.evidence)}</td>
    </tr>
  `).join('\n')

  const runtimeDisclosureRows = [
    ['披露结论', model.runtimeDisclosure.humanConclusion],
    ['SQLite health status', model.runtimeDisclosure.sqliteHealthCommand.healthStatus],
    ['sqliteHealthy', String(model.runtimeDisclosure.sqliteHealthCommand.sqliteHealthy)],
    ['SQLite 审计文件', model.runtimeDisclosure.sqliteHealthCommand.auditPath || '--'],
    ['红利低波 persisted candidates', String(model.runtimeDisclosure.dividendLowVolPersistedCandidates.persistedCandidateCount)],
    ['候选池 topMissingFields', JSON.stringify(model.runtimeDisclosure.dividendLowVolPersistedCandidates.topMissingFields || [])],
    ['红利低波审计包 health', model.runtimeDisclosure.dividendLowVolAuditPackage.healthStatus],
    ['红利低波候选来源', model.runtimeDisclosure.dividendLowVolAuditPackage.candidateSource],
    ['红利低波审计包路径', model.runtimeDisclosure.dividendLowVolAuditPackage.packagePath || '--'],
  ].map(([label, value]) => `
    <tr>
      <td>${escapeHtml(label)}</td>
      <td>${escapeHtml(value)}</td>
    </tr>
  `).join('\n')
  const runtimeHumanChecks = model.runtimeDisclosure.requiredHumanChecks.map((item) => `<li>${escapeHtml(item)}</li>`).join('\n')

  const blockerRows = model.formalTradingBoundary.remainingBlockers.map((item) => `
    <tr>
      <td>${escapeHtml(item)}</td>
      <td>${renderStatus('blocked')}</td>
      <td>该项未闭环前不得声明正式交易释放。</td>
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
    <p>生成时间：${escapeHtml(model.generatedAt)}。本报告基于原始 PRD、目标架构文档、代码实现、自动化命令、API 交叉验证和无头浏览器截图生成。自动化范围与完整 PRD 出门分开判定；报告不构成投资建议，不将研究验证包装为正式交易验证。</p>
    <p class="small">审计对象：分支 <code>${escapeHtml(model.git.branch)}</code>，提交 <code>${escapeHtml(model.git.headCommit)}</code>，origin/main <code>${escapeHtml(model.git.originMainCommit)}</code>，工作树干净：${escapeHtml(String(model.git.workingTreeClean))}。</p>
    <div class="grid">
      <div class="metric"><div class="label">总体结论</div><div class="value">${renderStatus(overall)}</div></div>
      <div class="metric"><div class="label">人类审计完备性</div><div class="value">${renderStatus(model.humanAuditReadiness.status)}</div></div>
      <div class="metric"><div class="label">Research Ready</div><div class="value">${escapeHtml(model.summary.researchReady)}</div></div>
      <div class="metric"><div class="label">Manual Draft Ready</div><div class="value">${escapeHtml(model.summary.manualDraftReady)}</div></div>
      <div class="metric"><div class="label">Formal Trading</div><div class="value">${escapeHtml(model.summary.formalTradingUnlocked)}</div></div>
      <div class="metric"><div class="label">Auto Trade</div><div class="value">${escapeHtml(model.summary.autoTradeUnlocked)}</div></div>
      <div class="metric"><div class="label">Runtime/Data Disclosure</div><div class="value">${escapeHtml(model.runtimeDisclosure.status)}</div></div>
      <div class="metric"><div class="label">文档支撑自动化范围</div><div class="value">${renderStatus(model.summary.documentedAutomatedScopeStatus)}</div></div>
      <div class="metric"><div class="label">完整 PRD 出门</div><div class="value">${renderStatus(model.summary.fullPrdExitStatus)}</div></div>
    </div>
  </section>

  <h2>先读这里：审计者导航</h2>
  <div class="card">
    <p><strong>审计范围：</strong>${escapeHtml(model.humanReviewGuide.stageScope)}</p>
    <p><strong>目标读者：</strong>${escapeHtml(model.humanReviewGuide.audience)}</p>
    <p>如果你只有 10 分钟，请先按下表顺序复核。每一步都能在本报告中找到截图、API、命令或代码映射证据。</p>
  </div>
  <table><thead><tr><th>顺序</th><th>怎么审</th></tr></thead><tbody>${auditStepRows}</tbody></table>

  <h2>本阶段能声明 / 不能声明</h2>
  <div class="grid">
    <div class="card">
      <h3>可以声明</h3>
      <ul>${canClaimList}</ul>
    </div>
    <div class="card">
      <h3>不能声明</h3>
      <ul>${cannotClaimList}</ul>
    </div>
  </div>

  <h2>证据地图</h2>
  <div class="card">
    <p>证据地图把“报告结论”映射到“人类应查看的证据”。任何一行失败，都应打回重新取证或修复实现。</p>
  </div>
  <table><thead><tr><th>结论</th><th>状态</th><th>复核方式</th><th>证据位置</th></tr></thead><tbody>${reviewClaimRows}</tbody></table>

  <h2>人类审计完备性检查</h2>
  <div class="card">
    <p>本节用于判断报告本身是否足以支持人类复核本阶段自动化开发。只有下列证据齐全，才可把本报告视为“当前阶段可审计”；这不等于正式交易可用。</p>
  </div>
  <table><thead><tr><th>审计材料</th><th>状态</th><th>证据位置</th></tr></thead><tbody>${humanAuditRows}</tbody></table>

  <h2>运行时与真实数据降级披露</h2>
  <div class="card">
    <p>本节专门防止“命令执行通过”被误读为“运行时健康和真实持久化数据完整通过”。如果这里出现 <code>critical</code>、<code>sqliteHealthy=false</code>、<code>fixture_fallback_due_to_database_unavailable</code> 或持久化候选为 0，人类审计者必须把它视为当前阶段限制，而不是正式数据闭环证明。</p>
    <ul>${runtimeHumanChecks}</ul>
  </div>
  <table><thead><tr><th>项目</th><th>证据值</th></tr></thead><tbody>${runtimeDisclosureRows}</tbody></table>

  <h2>版本与工作树</h2>
  <div class="card">
    ${renderJson(model.git)}
  </div>

  <h2>目标架构与当前实现</h2>
  <div class="card">
    <p>目标架构是“数据源与证据层 → 三类资产与策略归属 → 策略/回测/验证层 → Operation 审计层 → ChatBox/专家页双轨体验 → 交易 Gate”。当前实现已覆盖 WF-0..WF-7 自动范围与 FTR provisional 链；完整出门仍受集中人工核查和建议级动态逐日时点模拟阻断。</p>
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
  <div class="card">
    <p><strong>视觉证据自审：</strong>报告可用于人工复核，但产品视觉状态仍为 <code>${escapeHtml(model.visualEvidenceAudit.productVisualStatus)}</code>。响应式基线图只证明布局与可读性；真实数据必须同时核对 API 和合同证据。截图中可见的问题不会被裁掉或包装为全绿。</p>
  </div>
  <table><thead><tr><th>ID</th><th>级别</th><th>状态</th><th>观察结论</th><th>证据</th></tr></thead><tbody>${visualFindingRows}</tbody></table>
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

  <h2>正式交易仍然阻断</h2>
  <div class="card">
    <p>本阶段通过的是研究级回测、人工计划草案和审计追溯；下列阻断项闭环前，不得声明正式 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE。</p>
  </div>
  <table><thead><tr><th>阻断项</th><th>状态</th><th>说明</th></tr></thead><tbody>${blockerRows}</tbody></table>
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
    ['sqlite health', ['npm', 'run', 'check:sqlite-health'], backendDir, 360000],
    ['dividend low vol api', ['npm', 'run', 'test:dividend-low-vol-api'], backendDir, 240000],
    ['dividend low vol audit package', ['npm', 'run', 'test:dividend-low-vol-audit-package'], backendDir, 480000],
    ['dividend low vol rolling backtest', ['npm', 'run', 'test:dividend-low-vol-rolling-backtest'], backendDir, 240000],
    ['dividend low vol validation retest', ['npm', 'run', 'test:dividend-low-vol-validation-retest'], backendDir, 240000],
    ['dividend low vol frontend runtime', ['npm', 'run', 'test:dividend-low-vol-frontend-runtime'], backendDir, 180000],
    ['fivd-r core', ['npm', 'run', 'test:fivd-r-core'], backendDir, 240000],
    ['fivd-r trade gate contract', ['npm', 'run', 'test:fivd-r-trade-gate-contract'], backendDir, 240000],
    ['portfolio strategy backtest', ['npm', 'run', 'test:portfolio-strategy-backtest'], backendDir, 240000],
    ['portfolio backtest API contract', ['npm', 'run', 'test:portfolio-backtest-api-contract'], backendDir, 240000],
    ['production readiness', ['npm', 'run', 'test:production-readiness'], backendDir, 240000],
    ['trade action readiness', ['npm', 'run', 'test:trade-action-readiness'], backendDir, 240000],
    ['llm dotenv config', ['npm', 'run', 'test:llm-dotenv-config'], backendDir, 180000],
    ['chat llm planner', ['npm', 'run', 'test:chat-llm-planner'], backendDir, 240000],
    ['chat agent core', ['npm', 'run', 'test:chat-agent-core'], backendDir, 180000],
    ['frontend build', ['npm', 'run', 'build'], frontendDir, 240000],
    ['current stage consistency', ['npm', 'run', 'test:current-stage-consistency'], backendDir, 240000],
    ['next stage documentation baseline', ['npm', 'run', 'test:next-stage-documentation-baseline'], backendDir, 240000],
    ['daily review real data', ['npm', 'run', 'test:daily-review-real-data-e2e'], backendDir, 600000],
    ['investment workflow foundation', ['npm', 'run', 'test:investment-workflow-foundation'], backendDir, 600000],
    ['investment workflow readiness', ['npm', 'run', 'test:investment-workflow-readiness'], backendDir, 240000],
    ['investment workflow rotation', ['npm', 'run', 'test:investment-workflow-rotation-strategy'], backendDir, 360000],
    ['investment workflow portfolio policy', ['npm', 'run', 'test:investment-workflow-portfolio-policy'], backendDir, 240000],
    ['investment workflow scenario comparison', ['npm', 'run', 'test:investment-workflow-scenario-comparison'], backendDir, 360000],
    ['investment workflow cross page', ['npm', 'run', 'test:investment-workflow-cross-page'], backendDir, 240000],
    ['v2 px semantic contract', ['npm', 'run', 'test:v2-px-semantic-contract'], backendDir, 240000],
    ['v2 px policy', ['npm', 'run', 'test:v2-px-policy'], backendDir, 240000],
    ['v2 px api contract', ['npm', 'run', 'test:v2-px-api-contract'], backendDir, 240000],
    ['ftr refreeze a0', ['npm', 'run', 'run:ftr-a0-freeze-inputs'], backendDir, 360000],
    ['ftr refreeze data', ['npm', 'run', 'run:ftr-1-point-in-time-data-governance'], backendDir, 360000],
    ['ftr refreeze benchmark', ['npm', 'run', 'run:ftr-2-benchmark-qualification'], backendDir, 360000],
    ['ftr refreeze validation', ['npm', 'run', 'run:ftr-3-formal-validation'], backendDir, 600000],
    ['ftr refreeze isolation', ['npm', 'run', 'run:ftr-5-execution-isolation'], backendDir, 360000],
    ['ftr refreeze human queue', ['npm', 'run', 'run:ftr-4-deferred-human-review-queue'], backendDir, 360000],
    ['ftr refreeze provisional package', ['npm', 'run', 'run:ftr-6-provisional-review-package'], backendDir, 360000],
    ['ftr data artifacts', ['npm', 'run', 'test:ftr-1-acceptance-artifacts'], backendDir, 240000],
    ['ftr benchmark artifacts', ['npm', 'run', 'test:ftr-2-acceptance-artifacts'], backendDir, 240000],
    ['ftr validation artifacts', ['npm', 'run', 'test:ftr-3-acceptance-artifacts'], backendDir, 360000],
    ['ftr deferred queue', ['npm', 'run', 'test:ftr-4-deferred-human-review-queue'], backendDir, 240000],
    ['ftr execution isolation', ['npm', 'run', 'test:ftr-5-execution-isolation'], backendDir, 240000],
    ['ftr provisional package', ['npm', 'run', 'test:ftr-6-provisional-review-package'], backendDir, 240000],
    ['a6 human draft', ['npm', 'run', 'test:ftr-a6-human-acceptance-draft'], backendDir, 240000],
    ['strict trade remains blocked', ['npm', 'run', 'test:ftr-6-strict-trade-remains-blocked'], backendDir, 240000],
  ]

  const commandResults = await runCommandsWithConcurrency(commands, Number(process.env.FAMS_E2E_COMMAND_CONCURRENCY || 2))

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
  apiResults.push(await apiCheck('LLM 公共状态', `${backendUrl}/api/v1/llm/status`, {}, (body) => body?.secretsRedacted === true && !body?.apiKey, (body) => ({
    provider: body?.provider,
    configured: body?.configured,
    keySource: body?.keySource,
    model: body?.model,
    chatAgentEnabled: body?.chatAgentEnabled,
    secretsRedacted: body?.secretsRedacted,
  })))
  apiResults.push(await apiCheck('ChatBox 消息意图路由', `${backendUrl}/api/v1/chat/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      userId: 'default',
      message: '为什么不能下单',
    }),
  }, (body) => body?.notTradingAdvice === true && Array.isArray(body?.prohibitedActions) && body.prohibitedActions.includes('AUTO_TRADE'), (body) => ({
    intent: body?.intent,
    confidence: body?.confidence,
    prohibitedActions: body?.prohibitedActions,
    blockedReasons: body?.blockedReasons,
    llm: body?.agentCore?.llm,
    notTradingAdvice: body?.notTradingAdvice,
  })))
  apiResults.push(await apiCheck('投资工作流 readiness', `${backendUrl}/api/v1/investment-workflow/readiness?userId=default`, {}, (body) => (
    body?.facts?.openPositionCount > 0
      && body?.facts?.pendingAssignmentCount >= 0
      && Array.isArray(body?.strategies)
      && body?.permissionState?.formalTradingUnlocked === false
  ), (body) => ({
    status: body?.status,
    facts: body?.facts,
    strategies: body?.strategies,
    permissionState: body?.permissionState,
  })))
  apiResults.push(await apiCheck('投资工作流 assignments', `${backendUrl}/api/v1/investment-workflow/assignments?userId=default`, {}, (body) => (
    Array.isArray(body?.assignments) && body.assignments.length > 0
  ), (body) => ({
    assignmentCount: body?.assignments?.length || 0,
    pendingCount: body?.assignments?.filter((item) => item.status !== 'confirmed').length || 0,
    strategyFamilies: [...new Set((body?.assignments || []).map((item) => item.strategyFamily))],
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
  const automatedCriticalSections = [
    documentAudit,
    codeInspection,
    { status: prdCoverage.automatedStatus },
    coverage,
    browser,
    { status: assessOverall(apiResults) },
    { status: assessOverall(serverResults) },
  ]
  const automatedScopeStatus = assessOverall(automatedCriticalSections)
  const overallStatus = automatedScopeStatus === 'passed' ? prdCoverage.status : 'failed'

  const summary = {
    researchReady: prdCoverage.rows.some((item) => item.capability.includes('红利低波') && item.status === 'passed') ? 'yes' : 'partial_or_blocked',
    manualDraftReady: commandResults.find((item) => item.name === 'production readiness')?.status === 'passed' ? 'yes_if_gate_evidence_ready' : 'blocked',
    formalTradingUnlocked: 'false',
    autoTradeUnlocked: 'false',
    documentedAutomatedScopeStatus: prdCoverage.automatedStatus,
    fullPrdExitStatus: prdCoverage.status,
    prdFullyComplete: false,
  }
  const runtimeDisclosure = buildRuntimeDisclosure(commandResults, apiResults)
  const limitations = [
    '报告仅使用无头浏览器截图，不抢占桌面焦点。',
    '若免费数据源或本地缓存不是最新交易日，报告会保留数据新鲜度风险，不会声明每日实时保证。',
    'tradeActionReadiness 验收通过只代表严格命令按预期拒绝且交易锁保持关闭，不代表策略可以交易。',
    '投资工作流真实数据基线来自本地 default 账户；报告只展示数量和状态，不公开账户金额及个人资产明细。',
    '16 个持仓策略归属、截图行纠正和最终 UX 语义确认仍需集中人工核查，自动化不得代签。',
    '建议级 point_in_time_simulation 冻结策略逐日动态重算未实现，完整 PRD 出门必须保持 blocked。',
    'FTR provisional 链通过不等于 final review package 或正式交易 release。',
  ]
  if (runtimeDisclosure.status !== 'ok') {
    limitations.push(runtimeDisclosure.humanConclusion)
  }

  const model = {
    schemaVersion: 'fams.full_system_e2e_acceptance.v2',
    generatedAt,
    reportDir,
    overallStatus,
    exitDecision: automatedScopeStatus !== 'passed'
      ? 'automated_scope_rejected_and_return_to_development'
      : prdCoverage.status === 'passed'
        ? 'full_prd_stage_exit_allowed'
        : 'automated_scope_passed_full_prd_exit_blocked',
    summary,
    architecture: {
      target: [
        '数据源与证据层：截图/Excel、账户来源、公开行情、分红、行业、交易约束、evidenceRefs。',
        '投资工作流层：三类资产归属、行业轮动网格、红利低波建议、组合配置、统一场景比较。',
        '策略与验证层：红利低波、组合回测、冻结策略逐日 point-in-time 重算、formal validation。',
        'Operation 审计层：所有重任务落 Operation 与 artifact，支持任务中心追溯。',
        '前端体验层：Assets -> Positions -> 三类策略 -> Backtest -> DailyReviews -> Operations，ChatBox 与专家页双轨。',
        '交易 Gate：研究/观察/计划草案与正式交易动作隔离，AUTO_TRADE 禁止。',
      ],
      current: [
        '已实现三类资产归属、行业轮动/波动网格、红利低波、支付宝组合策略和统一回测入口。',
        '已实现组合策略多曲线与 advice 三场景回放、Daily Review、Operation artifact。',
        '已实现 FTR-1..6 provisional 自动链和交易 gate；人工签核与正式自动交易仍未开放。',
        '已知缺口：人工集中确认 pending；advice-level point_in_time_simulation 未实现；PRD 18/20。',
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
    runtimeDisclosure,
    limitations,
    git: buildGitSnapshot(),
    formalTradingBoundary: {
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      orderCreateAllowed: false,
      remainingBlockers: [
        'A6/V2-PX/投资工作流集中人工验收尚未完成',
        'advice-level point_in_time_simulation 冻结策略逐日动态重算尚未实现',
        '人工签核链路未完成 final release signoff',
        '生产下单适配器未启用',
        'AUTO_TRADE 按策略继续锁定',
      ],
    },
  }
  model.visualEvidenceAudit = buildVisualEvidenceAudit(model)
  model.humanReviewGuide = buildHumanReviewGuide(model)
  model.humanAuditReadiness = buildHumanAuditReadiness(model)

  await writeFile(path.join(reportDir, 'summary.json'), JSON.stringify(model, null, 2))
  await writeFile(path.join(reportDir, 'prd-coverage-matrix.json'), JSON.stringify(prdCoverage, null, 2))
  await writeFile(path.join(reportDir, 'test-coverage-matrix.json'), JSON.stringify(coverage, null, 2))
  await writeFile(path.join(reportDir, 'document-consistency-audit.json'), JSON.stringify(documentAudit, null, 2))
  await writeFile(path.join(reportDir, 'code-inspection-audit.json'), JSON.stringify(codeInspection, null, 2))
  await writeFile(path.join(reportDir, 'architecture-current-vs-target.json'), JSON.stringify(model.architecture, null, 2))
  await writeFile(path.join(reportDir, 'runtime-disclosure.json'), JSON.stringify(model.runtimeDisclosure, null, 2))
  await writeFile(path.join(reportDir, 'human-review-guide.json'), JSON.stringify(model.humanReviewGuide, null, 2))
  await writeFile(path.join(reportDir, 'visual-evidence-self-audit.json'), JSON.stringify(model.visualEvidenceAudit, null, 2))
  await writeFile(path.join(reportDir, 'human-audit-readiness.json'), JSON.stringify(model.humanAuditReadiness, null, 2))
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
