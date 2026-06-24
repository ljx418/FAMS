import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(new URL('.', import.meta.url).pathname, '..')
const backendUrl = 'http://127.0.0.1:4000'
const frontendUrl = 'http://127.0.0.1:3000'
const screenshotPath = path.join(root, '.verification', 'fivd-r-phase4-expected-return.png')
const auditPath = path.join(root, '.verification', 'fivd-r-phase4-expected-return-audit.json')
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

function assertExpectedReturn(positionResult) {
  const expectedReturn = positionResult.expectedReturn
  if (!expectedReturn) throw new Error('missing expectedReturn')
  if (expectedReturn.schemaVersion !== 'fivd.r.expected_return.distribution.v1') {
    throw new Error(`unexpected expectedReturn schema ${expectedReturn.schemaVersion}`)
  }
  if (expectedReturn.schemaVersion.includes('placeholder')) {
    throw new Error('expectedReturn is still placeholder')
  }
  if (expectedReturn.maxObservedTradeDate && expectedReturn.maxObservedTradeDate > expectedReturn.reviewDate) {
    throw new Error(`future leak: ${expectedReturn.maxObservedTradeDate} > ${expectedReturn.reviewDate}`)
  }

  const windows = expectedReturn.windows || {}
  for (const windowName of ['20d', '60d']) {
    const item = windows[windowName]
    if (!item) throw new Error(`missing expectedReturn window ${windowName}`)
    if (item.status === 'available') {
      if (!item.distribution) throw new Error(`${windowName} available without distribution`)
      for (const key of ['p05', 'p25', 'p50', 'p75', 'p95']) {
        if (typeof item.distribution[key] !== 'number') {
          throw new Error(`${windowName} missing ${key}`)
        }
      }
      if (typeof item.sampleSize !== 'number' || item.sampleSize <= 0) throw new Error(`${windowName} invalid sampleSize`)
      if (typeof item.probabilityUp !== 'number') throw new Error(`${windowName} missing probabilityUp`)
      if (typeof item.probabilityDown !== 'number') throw new Error(`${windowName} missing probabilityDown`)
      if (typeof item.maxDrawdown !== 'number') throw new Error(`${windowName} missing maxDrawdown`)
    } else if (!item.blockedReasons?.length) {
      throw new Error(`${windowName} insufficient without blockedReasons`)
    }
  }
  return expectedReturn
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
  const holdings = (portfolio.data?.portfolio?.holdings || []).filter((item) => item.type !== 'cash').slice(0, 3)
  if (holdings.length === 0) throw new Error('No real non-cash holdings found for Phase 4 acceptance')

  const checked = []
  for (const holding of holdings) {
    const result = await timedJson(
      `${backendUrl}/api/v1/analysis/fivd-r?userId=default&scope=position&positionId=${encodeURIComponent(holding.positionId)}`
    )
    const expectedReturn = assertExpectedReturn(result.data)
    checked.push({
      positionId: holding.positionId,
      symbol: holding.symbol,
      name: holding.name,
      type: holding.type,
      latencyMs: result.latencyMs,
      expectedReturn: {
        status: expectedReturn.status,
        reviewDate: expectedReturn.reviewDate,
        maxObservedTradeDate: expectedReturn.maxObservedTradeDate,
        confidence: expectedReturn.confidence,
        sampleSize: expectedReturn.sampleSize,
        blockedReasons: expectedReturn.blockedReasons,
        windows: Object.fromEntries(Object.entries(expectedReturn.windows || {}).map(([key, value]) => [key, {
          status: value.status,
          sampleSize: value.sampleSize,
          confidence: value.confidence,
          distributionPresent: Boolean(value.distribution),
          blockedReasons: value.blockedReasons,
        }])),
      },
    })
  }

  const availableCount = checked.filter((item) => item.expectedReturn.status === 'available').length
  const insufficientCount = checked.filter((item) => item.expectedReturn.status === 'insufficient').length
  if (availableCount === 0) throw new Error('No sample-sufficient real expectedReturn case found')
  if (insufficientCount === 0) {
    throw new Error('No sample-insufficient real expectedReturn case found; do not fake this acceptance')
  }

  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  await page.goto(`${frontendUrl}/analysis?section=holdings`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.locator(`[data-fivdr-position-id="${checked[0].positionId}"]`).waitFor({ timeout: 120000 })
  await page.locator(`[data-fivdr-position-id="${checked[0].positionId}"]`).click()
  await page.getByText('Position 级 FIVD-R 详情', { exact: true }).waitFor({ timeout: 120000 })
  await page.getByText('Expected Return 当前状态').waitFor({ timeout: 30000 })
  await page.getByText('Expected Return 20d').waitFor({ timeout: 30000 })
  await page.getByText('Expected Return 60d').waitFor({ timeout: 30000 })
  await page.screenshot({ path: screenshotPath, fullPage: true })
  await browser.close()
  browser = null

  const audit = {
    schemaVersion: 'fivd.r.phase4.expected_return_acceptance.v1',
    generatedAt: new Date().toISOString(),
    ok: true,
    portfolioLatencyMs: portfolio.latencyMs,
    checked,
    availableCount,
    insufficientCount,
    noFutureLeak: checked.every((item) => (
      !item.expectedReturn.maxObservedTradeDate || item.expectedReturn.maxObservedTradeDate <= item.expectedReturn.reviewDate
    )),
    screenshotPath,
  }
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    checked: checked.map((item) => ({
      symbol: item.symbol,
      status: item.expectedReturn.status,
      sampleSize: item.expectedReturn.sampleSize,
      latencyMs: item.latencyMs,
    })),
    availableCount,
    insufficientCount,
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
