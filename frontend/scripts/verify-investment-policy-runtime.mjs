import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const cdpUrl = process.env.FAMS_CDP_URL || 'http://127.0.0.1:9333'
const appUrl = process.env.FAMS_APP_URL || 'http://localhost:3000/investment-policy'
const apiUrl = process.env.FAMS_API_URL || 'http://localhost:4000/api/v1/investment-policy'
const evidenceDir = resolve(process.cwd(), '../docs/automation-audits/investment-policy/runtime')

async function request(path, init) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`)
  return payload
}

await mkdir(evidenceDir, { recursive: true })
const before = await request('/current?userId=default')
if (before.latestDraft) throw new Error('验收前 default 用户已存在草案，拒绝覆盖真实用户状态')
const draft = await request('/drafts', {
  method: 'POST',
  body: JSON.stringify({ userId: 'default', createdBy: 'investment_policy_runtime_acceptance' }),
})

let browser
try {
  const cdpVersion = await fetch(`${cdpUrl}/json/version`).then((response) => response.json())
  const websocketEndpoint = String(cdpVersion.webSocketDebuggerUrl || '').replace('localhost:', '127.0.0.1:')
  if (!websocketEndpoint.startsWith('ws://')) throw new Error('Chrome CDP WebSocket endpoint is unavailable')
  browser = await chromium.connectOverCDP(websocketEndpoint)
  const context = browser.contexts()[0] || await browser.newContext()
  const page = context.pages()[0] || await context.newPage()
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => consoleErrors.push(error.message))

  const viewports = [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]
  const results = []
  for (const viewport of viewports) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height })
    await page.goto(appUrl, { waitUntil: 'networkidle', timeout: 60_000 })
    await page.getByTestId('investment-policy-page').waitFor({ state: 'visible', timeout: 30_000 })
    await page.getByText('行业敞口', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
    const screenshot = resolve(evidenceDir, `investment-policy-${viewport.name}.png`)
    await page.screenshot({ path: screenshot, fullPage: true })
    const bodyMetrics = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
    }))
    const text = await page.locator('body').innerText()
    results.push({
      viewport,
      screenshot,
      width: bodyMetrics,
      gates: {
        legacyPolicyDisclosureVisible: text.includes('只有显式激活新政策后才会切换'),
        targetDefaultsVisible: ['50%', '30%', '20%'].every((item) => text.includes(item)),
        reserveCashRequiredVisible: text.includes('独立备用现金下限'),
        warningOnlyVisible: text.includes('不会自动再平衡'),
        industryExposureVisible: text.includes('行业敞口') && (text.includes('全局行业') || text.includes('当前没有可用的行业事实')),
        missingIndustryHonestDisclosure: text.includes('缺少行业分类'),
        tradeBoundaryLockedVisible: text.includes('交易边界保持锁定'),
        noDocumentOverflow: bodyMetrics.document <= bodyMetrics.viewport && bodyMetrics.body <= bodyMetrics.viewport,
      },
    })
  }
  const allGatesPassed = results.every((result) => Object.values(result.gates).every(Boolean))
  if (!allGatesPassed || consoleErrors.length > 0) {
    throw new Error(`UI gate failed: ${JSON.stringify({ results, consoleErrors })}`)
  }
  const report = {
    schemaVersion: 'fams.investment-policy-ui-e2e.v1',
    status: 'passed',
    generatedAt: new Date().toISOString(),
    browserMode: 'windows_chrome_headless_cdp',
    createdPolicyId: draft.id,
    results: results.map((result) => ({ ...result, consoleErrors: [] })),
    cleanupRequired: true,
  }
  await writeFile(resolve(evidenceDir, 'ui-e2e.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close().catch(() => undefined)
}
