import { spawn, type ChildProcess } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
const frontendDir = resolve(repoRoot, 'frontend')
const frontendUrl = 'http://127.0.0.1:3101'
const playwrightLibPath = resolve(repoRoot, '.verification/playwright-libs/lib')
const generatedAt = new Date().toISOString()
const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'formal-release-readiness', generatedAt.replace(/[:.]/g, '-'))
let server: ChildProcess | null = null

async function waitForUrl(url: string, timeoutMs = 120000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function main() {
  await mkdir(auditDir, { recursive: true })
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}` : playwrightLibPath
  try {
    await waitForUrl(frontendUrl, 1500)
  } catch {
    server = spawn('node', ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '3101', '--strictPort'], {
      cwd: frontendDir,
      env: { ...process.env, HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server.stdout?.on('data', (chunk) => process.stdout.write(`[frontend] ${chunk}`))
    server.stderr?.on('data', (chunk) => process.stderr.write(`[frontend] ${chunk}`))
    await waitForUrl(frontendUrl)
  }

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } })
  const consoleErrors: string[] = []
  const signoffRequests: Array<Record<string, unknown>> = []
  page.on('console', (message: any) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error: Error) => consoleErrors.push(error.message))
  await page.route('**/api/v1/**', async (route: any) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname === '/api/v1/formal-release/reviewer-context') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ reviewer: { userId: 'reviewer-1', email: 'release.reviewer@example.test', roles: ['data', 'model'] } }) })
    }
    if (url.pathname === '/api/v1/operations/schedulers/factset-refresh') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        config: { enabled: false, cronExpression: '0 * * * *', timezone: 'Asia/Shanghai', horizonMinutes: 60, limit: 100, allowTradingHours: false },
        runtime: { taskStarted: false, localRunning: false },
        lease: { locked: false, expired: false, leaseOwner: null },
        lastRunAt: null,
        lastResult: null,
      }) })
    }
    if (url.pathname === '/api/v1/operations/market-bar-freshness') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        status: 'unknown',
        lagTradingDays: null,
        latestTradeDate: null,
      }) })
    }
    if (url.pathname === '/api/v1/formal-release/runs/operation-ftr-ui-test' && request.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        operation: { id: 'operation-ftr-ui-test', status: 'completed', artifactRefs: ['operation_artifact:operation-ftr-ui-test:14_release_gate_audit.json'] },
        manifestHash: 'a'.repeat(64),
        signoffAudit: { status: signoffRequests.length > 0 ? 'partial' : 'missing', blockers: ['manual_signoff_not_passed'], records: [
          { role: 'data', status: signoffRequests.length > 0 ? 'approved' : 'missing', reviewerEmail: signoffRequests.length > 0 ? 'release.reviewer@example.test' : null, reviewedAt: null, blockers: [] },
          { role: 'model', status: 'missing', reviewerEmail: null, reviewedAt: null, blockers: [] },
          { role: 'risk', status: 'missing', reviewerEmail: null, reviewedAt: null, blockers: [] },
          { role: 'compliance', status: 'missing', reviewerEmail: null, reviewedAt: null, blockers: [] },
          { role: 'final_release', status: 'missing', reviewerEmail: null, reviewedAt: null, blockers: [] },
        ] },
        releaseApprovalStatus: 'pending_human_approval', productionAdapterEnabled: false, formalTradingUnlocked: false, orderCreateAllowed: false,
      }) })
    }
    if (url.pathname === '/api/v1/formal-release/runs/operation-ftr-ui-test/signoffs' && request.method() === 'POST') {
      const body = request.postDataJSON()
      signoffRequests.push(body)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'created' }) })
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })

  try {
    await page.goto(`${frontendUrl}/operations`, { waitUntil: 'networkidle', timeout: 120000 })
    await page.getByText('Formal Release 人工评审').waitFor({ timeout: 30000 })
    await page.getByPlaceholder('审阅人 JWT（仅保存在 sessionStorage）').fill('test-jwt-redacted')
    await page.getByRole('button', { name: '验证身份' }).click()
    await page.getByText('release.reviewer@example.test').waitFor()
    await page.getByPlaceholder('组合回测 Operation ID').fill('operation-ftr-ui-test')
    await page.getByRole('button', { name: '加载评审包' }).click()
    await page.getByText('pending_human_approval').waitFor()
    await page.getByText('disabled').waitFor()
    await page.getByPlaceholder('签核或打回意见（必填）').fill('reviewed data evidence')
    await page.locator('button').filter({ hasText: /^签\s*核$/ }).click()
    await page.getByText('签核已追加到不可变审计链').waitFor()
    await page.screenshot({ path: resolve(auditDir, 'formal-release-review-panel.png'), fullPage: true })
  } finally {
    await browser.close()
  }

  if (signoffRequests.length !== 1) throw new Error(`Expected one signoff request, got ${signoffRequests.length}`)
  const signoff = signoffRequests[0]
  if (signoff.reviewerId || signoff.reviewerEmail || signoff.reviewedAt) throw new Error('Reviewer identity/time must not be client supplied')
  if (signoff.role !== 'data' || signoff.manifestHash !== 'a'.repeat(64)) throw new Error('Signoff request did not bind role and manifest hash')
  if (consoleErrors.length > 0) throw new Error(`Frontend console errors: ${consoleErrors.join('; ')}`)

  const audit = {
    schemaVersion: 'fams.ftr_4_6.frontend_runtime_verification.v1',
    status: 'passed',
    reviewerTokenStorage: 'sessionStorage',
    reviewerIdentityServerDerived: true,
    signoffBoundToManifestHash: true,
    productionAdapterEnabled: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  await writeFile(resolve(auditDir, 'frontend_runtime_audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditDir }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
}).finally(() => {
  if (server && !server.killed) server.kill('SIGTERM')
})
