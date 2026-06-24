import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(new URL('.', import.meta.url).pathname, '..')
const backendUrl = 'http://127.0.0.1:4000'
const frontendUrl = 'http://127.0.0.1:3000'
const screenshotPath = path.join(root, '.verification', 'fivd-r-phase5-trading-discipline.png')
const auditPath = path.join(root, '.verification', 'fivd-r-phase5-trading-discipline-audit.json')
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
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${await response.text()}`)
  return { latencyMs, data: await response.json() }
}

function assertDiscipline(result, expectedType) {
  const discipline = result.tradingDiscipline
  if (!discipline) throw new Error('missing tradingDiscipline')
  if (discipline.schemaVersion !== 'fivd.r.trading_discipline.v2') {
    throw new Error(`unexpected discipline schema ${discipline.schemaVersion}`)
  }
  for (const field of ['bucket', 'disciplineType', 'validFrom', 'validUntil', 'reviewCadence', 'formalTradeActionAllowed', 'blockedReasons']) {
    if (!(field in discipline)) throw new Error(`discipline missing ${field}`)
  }
  if (discipline.formalTradeActionAllowed !== false) throw new Error('validation gate was bypassed')
  if (!result.summary?.prohibitedActions?.includes('ADD') || !result.summary?.prohibitedActions?.includes('REDUCE') || !result.summary?.prohibitedActions?.includes('AUTO_TRADE')) {
    throw new Error('prohibited trade actions missing')
  }
  if (expectedType === 'cash') {
    if (discipline.bucket !== 'cash') throw new Error(`cash bucket expected, got ${discipline.bucket}`)
    if (discipline.disciplineType !== 'no_action') throw new Error(`cash no_action expected, got ${discipline.disciplineType}`)
    for (const field of ['addConditions', 'reduceConditions', 'stopConditions', 'takeProfitConditions']) {
      if (Array.isArray(discipline[field]) && discipline[field].length > 0) {
        throw new Error(`cash discipline generated ${field}`)
      }
    }
  } else {
    for (const field of ['reduceConditions', 'stopConditions', 'takeProfitConditions', 'invalidationConditions']) {
      if (!Array.isArray(discipline[field]) || discipline[field].length === 0) {
        throw new Error(`non-cash discipline missing ${field}`)
      }
    }
    if (!['core', 'satellite', 'watchlist', 'unknown'].includes(discipline.bucket)) {
      throw new Error(`invalid non-cash bucket ${discipline.bucket}`)
    }
  }
  return discipline
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
  const holdings = portfolio.data?.portfolio?.holdings || []
  const nonCash = holdings.find((item) => item.type !== 'cash')
  const cash = holdings.find((item) => item.type === 'cash')
  if (!nonCash?.positionId) throw new Error('No real non-cash holding found')

  const checked = []
  for (const item of [nonCash, cash].filter(Boolean)) {
    const response = await timedJson(`${backendUrl}/api/v1/analysis/fivd-r?userId=default&scope=position&positionId=${encodeURIComponent(item.positionId)}`)
    const discipline = assertDiscipline(response.data, item.type === 'cash' ? 'cash' : 'non_cash')
    checked.push({
      positionId: item.positionId,
      symbol: item.symbol,
      name: item.name,
      type: item.type,
      latencyMs: response.latencyMs,
      discipline: {
        schemaVersion: discipline.schemaVersion,
        action: discipline.action,
        bucket: discipline.bucket,
        disciplineType: discipline.disciplineType,
        validFrom: discipline.validFrom,
        validUntil: discipline.validUntil,
        reviewCadence: discipline.reviewCadence,
        formalTradeActionAllowed: discipline.formalTradeActionAllowed,
        addConditions: discipline.addConditions?.length || 0,
        reduceConditions: discipline.reduceConditions?.length || 0,
        stopConditions: discipline.stopConditions?.length || 0,
        takeProfitConditions: discipline.takeProfitConditions?.length || 0,
        invalidationConditions: discipline.invalidationConditions?.length || 0,
        blockedReasons: discipline.blockedReasons,
      },
    })
  }

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await page.goto(`${frontendUrl}/analysis?section=holdings`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.locator(`[data-fivdr-position-id="${nonCash.positionId}"]`).waitFor({ timeout: 120000 })
  await page.locator(`[data-fivdr-position-id="${nonCash.positionId}"]`).click()
  await page.getByText('Trading Discipline Engine').waitFor({ timeout: 120000 })
  await page.getByText('加仓条件').waitFor({ timeout: 30000 })
  await page.getByText('减仓复核').waitFor({ timeout: 30000 })
  await page.getByText('失效条件').waitFor({ timeout: 30000 })
  await page.getByText('formalTradeActionAllowed=false').waitFor({ timeout: 30000 })
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await browser.close()
  browser = null

  const audit = {
    schemaVersion: 'fivd.r.phase5.trading_discipline_acceptance.v1',
    generatedAt: new Date().toISOString(),
    ok: true,
    portfolioLatencyMs: portfolio.latencyMs,
    checked,
    cashCovered: Boolean(cash),
    validationGatePreserved: checked.every((item) => item.discipline.formalTradeActionAllowed === false),
    screenshotPath,
  }
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    checked: checked.map((item) => ({
      symbol: item.symbol,
      type: item.type,
      bucket: item.discipline.bucket,
      disciplineType: item.discipline.disciplineType,
      formalTradeActionAllowed: item.discipline.formalTradeActionAllowed,
    })),
    screenshotPath,
    auditPath,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    if (browser) browser.close().catch(() => {})
    for (const child of spawned) child.kill('SIGTERM')
  })
