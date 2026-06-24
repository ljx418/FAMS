import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'

const root = path.resolve(new URL('.', import.meta.url).pathname, '..')
const backendUrl = 'http://127.0.0.1:4000'
const frontendUrl = 'http://127.0.0.1:3000'
const screenshotPath = path.join(root, '.verification', 'fivd-r-phase3-panel.png')
const playwrightLibPath = path.join(root, '.verification', 'playwright-libs', 'lib')

const spawned = []

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

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  await page.goto(`${frontendUrl}/analysis?section=fivdr`, { waitUntil: 'networkidle', timeout: 120000 })
  await page.getByText('FIVD-R 统一分析', { exact: true }).waitFor({ timeout: 120000 })
  await page.getByText('validation_tournament_agent').waitFor({ timeout: 120000 })
  await page.getByText('ADD').first().waitFor({ timeout: 30000 })
  await page.getByText('REDUCE').first().waitFor({ timeout: 30000 })
  await page.getByText('AUTO_TRADE').first().waitFor({ timeout: 30000 })

  const bodyText = await page.locator('body').innerText()
  const requiredTexts = [
    '内部验证锦标赛',
    '禁止动作',
    'Agent Trace',
  ]
  const missingTexts = requiredTexts.filter((text) => !bodyText.includes(text))
  if (missingTexts.length > 0) {
    throw new Error(`FIVD-R panel missing required text: ${missingTexts.join(', ')}`)
  }
  if (consoleErrors.length > 0) {
    throw new Error(`Browser console errors: ${consoleErrors.slice(0, 5).join(' | ')}`)
  }

  await page.screenshot({ path: screenshotPath, fullPage: true })
  await browser.close()

  console.log(JSON.stringify({
    ok: true,
    url: `${frontendUrl}/analysis?section=fivdr`,
    screenshotPath,
    verifiedTexts: requiredTexts,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    for (const child of spawned) {
      child.kill('SIGTERM')
    }
  })
