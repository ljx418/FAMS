import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(new URL('.', import.meta.url).pathname, '..')
const backendUrl = 'http://127.0.0.1:4000'
const frontendUrl = 'http://127.0.0.1:3000'
const screenshotPath = path.join(root, '.verification', 'fivd-r-phase3-5-position.png')
const auditPath = path.join(root, '.verification', 'fivd-r-phase3-5-performance-audit.json')
const playwrightLibPath = path.join(root, '.verification', 'playwright-libs', 'lib')

const spawned = []
let browser = null

async function waitForUrl(url, timeoutMs = 120000) {
  const startedAt = Date.now()
  let lastError = null
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
      lastError = new Error(`${url} returned ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
  throw lastError || new Error(`Timed out waiting for ${url}`)
}

async function ensureServer(url, command, cwd, readyUrl = url) {
  try {
    await waitForUrl(readyUrl, 3000)
    return false
  } catch {
    const child = spawn(command[0], command.slice(1), {
      cwd,
      env: { ...process.env, HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    child.stdout.on('data', (chunk) => process.stdout.write(chunk))
    child.stderr.on('data', (chunk) => process.stderr.write(chunk))
    spawned.push(child)
    await waitForUrl(readyUrl, 120000)
    return true
  }
}

async function timedJson(url) {
  const startedAt = Date.now()
  const response = await fetch(url)
  const latencyMs = Date.now() - startedAt
  if (!response.ok) {
    throw new Error(`${url} returned ${response.status}: ${await response.text()}`)
  }
  return { latencyMs, data: await response.json() }
}

function assertIncludes(source, text, label = text) {
  if (!source.includes(text)) {
    throw new Error(`Missing ${label}`)
  }
}

async function main() {
  await mkdir(path.dirname(screenshotPath), { recursive: true })
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}`
    : playwrightLibPath

  await ensureServer(
    backendUrl,
    ['node', 'node_modules/tsx/dist/cli.mjs', 'src/index.ts'],
    path.join(root, 'backend'),
    `${backendUrl}/api/v1/analysis/fivd-r?userId=default&scope=portfolio`
  )
  await ensureServer(
    frontendUrl,
    ['node', 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1'],
    path.join(root, 'frontend'),
    frontendUrl
  )

  const portfolio = await timedJson(`${backendUrl}/api/v1/analysis/fivd-r?userId=default&scope=portfolio`)
  const holding = portfolio.data?.portfolio?.holdings?.find((item) => item.type !== 'cash')
  if (!holding?.positionId || !holding?.symbol) {
    throw new Error('No real non-cash holding found for FIVD-R Phase 3.5 acceptance')
  }

  const position = await timedJson(
    `${backendUrl}/api/v1/analysis/fivd-r?userId=default&scope=position&positionId=${encodeURIComponent(holding.positionId)}`
  )

  if (position.data.scope !== 'position') throw new Error(`Expected position scope, got ${position.data.scope}`)
  if (position.data.asset?.positionId !== holding.positionId) {
    throw new Error(`Position API returned ${position.data.asset?.positionId}, expected ${holding.positionId}`)
  }
  if (position.data.asset?.symbol !== holding.symbol) {
    throw new Error(`Position API returned ${position.data.asset?.symbol}, expected ${holding.symbol}`)
  }
  if (!position.data.valuation?.valuation) throw new Error('Position FIVD-R missing valuation')
  if (!position.data.tradingDiscipline) throw new Error('Position FIVD-R missing tradingDiscipline')
  if (!position.data.positionAdviceImpact) throw new Error('Position FIVD-R missing positionAdviceImpact')
  if (!position.data.agentTrace?.agents?.some((agent) => agent.id === 'validation_tournament_agent')) {
    throw new Error('Position FIVD-R missing validation_tournament_agent trace')
  }
  for (const action of ['ADD', 'REDUCE', 'AUTO_TRADE']) {
    if (!position.data.summary?.prohibitedActions?.includes(action)) {
      throw new Error(`Position FIVD-R does not prohibit ${action}`)
    }
  }
  if (!position.data.summary?.blockedReasons?.includes('validation_evidence')) {
    throw new Error('Position FIVD-R missing validation_evidence blocker')
  }

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.goto(`${frontendUrl}/analysis?section=holdings`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.locator(`[data-fivdr-position-id="${holding.positionId}"]`).waitFor({ timeout: 120000 })
  await page.locator(`[data-fivdr-position-id="${holding.positionId}"]`).click()
  await page.getByText('Position 级 FIVD-R 详情', { exact: true }).waitFor({ timeout: 120000 })
  await page.getByText(holding.positionId).first().waitFor({ timeout: 30000 })
  await page.getByText(holding.symbol).first().waitFor({ timeout: 30000 })
  await page.getByText('validation_tournament_agent').waitFor({ timeout: 30000 })
  await page.getByText('formalTradeActionAllowed=false').waitFor({ timeout: 30000 })

  const bodyText = await page.locator('body').innerText()
  for (const text of [
    'Position 级 FIVD-R 详情',
    '价值评估',
    'Expected Return 当前状态',
    '交易纪律',
    'PositionAdvice Impact',
    'validation_evidence',
    'ADD',
    'REDUCE',
    'AUTO_TRADE',
  ]) {
    assertIncludes(bodyText, text)
  }
  if (consoleErrors.length > 0) {
    throw new Error(`Browser console errors: ${consoleErrors.slice(0, 5).join(' | ')}`)
  }

  await page.screenshot({ path: screenshotPath, fullPage: true })
  await browser.close()
  browser = null

  const audit = {
    schemaVersion: 'fivd.r.phase3_5.performance_audit.v1',
    generatedAt: new Date().toISOString(),
    ok: true,
    realData: {
      positionId: holding.positionId,
      symbol: holding.symbol,
      name: holding.name,
      type: holding.type,
    },
    latencies: {
      portfolioLatencyMs: portfolio.latencyMs,
      positionLatencyMs: position.latencyMs,
    },
    slowPathCandidates: [
      ...(portfolio.latencyMs >= 30000 ? ['portfolio_fivd_r_full_holdings_research'] : []),
      ...(position.latencyMs >= 10000 ? ['position_fivd_r_value_advice_validation_join'] : []),
    ],
    cacheOrOperationRecommendation: portfolio.latencyMs >= 30000 || position.latencyMs >= 10000
      ? 'Add cached latest FIVD-R run or Operation-backed refresh before using this as a high-frequency UI path.'
      : 'Current latency is acceptable for manual review; continue monitoring before Operation-izing.',
    assertions: {
      positionScope: position.data.scope,
      valuationPresent: Boolean(position.data.valuation?.valuation),
      tradingDisciplinePresent: Boolean(position.data.tradingDiscipline),
      positionAdviceImpactPresent: Boolean(position.data.positionAdviceImpact),
      validationTournamentAgentPresent: true,
      prohibitedActions: position.data.summary.prohibitedActions,
      blockedReasons: position.data.summary.blockedReasons,
    },
    screenshotPath,
  }
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    url: `${frontendUrl}/analysis?section=holdings`,
    positionId: holding.positionId,
    symbol: holding.symbol,
    screenshotPath,
    auditPath,
    latencies: audit.latencies,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    if (browser) {
      browser.close().catch(() => {})
    }
    for (const child of spawned) {
      child.kill('SIGTERM')
    }
  })
