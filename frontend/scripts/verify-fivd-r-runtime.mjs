import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const appBase = process.env.FAMS_FRONTEND_E2E_BASE || 'http://localhost:3000'
const repoRoot = resolve(import.meta.dirname, '../..')
const localBrowserLibDir = resolve(repoRoot, '.verification/playwright-libs/lib')
process.env.LD_LIBRARY_PATH = [localBrowserLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
const evidenceDir = resolve(repoRoot, '.verification/private/fivd-r/runtime')
await mkdir(evidenceDir, { recursive: true })

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
]
const results = []
const browser = await chromium.launch({ headless: true })
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, locale: 'zh-CN', reducedMotion: 'reduce' })
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (entry) => { if (entry.type() === 'error') consoleErrors.push(entry.text()) })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(`${appBase}/analysis?section=fivdr`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByText('研究历史 / 观察池', { exact: true }).waitFor({ timeout: 30_000 })
    await page.getByText('Data Gap Remediation', { exact: true }).waitFor()
    await page.getByText('ADD/REDUCE 禁止', { exact: true }).first().waitFor()
    await page.getByText('AUTO_TRADE 禁止', { exact: true }).first().waitFor()

    const search = page.getByPlaceholder('按代码、名称、结论或运行编号筛选')
    await search.fill('__fivd_history_no_match__')
    await search.press('Enter')
    await page.getByText('快照 0', { exact: true }).waitFor()
    await page.getByText('观察 0', { exact: true }).waitFor()
    await search.fill('')
    await search.press('Enter')
    await page.getByText(/快照 [1-9]\d*/, { exact: true }).waitFor()
    await page.getByText(/观察 [1-9]\d*/, { exact: true }).waitFor()

    const nextButton = page.locator('button').filter({ hasText: '下一页' })
    assert.equal(await nextButton.count(), 1)
    if (await nextButton.isEnabled()) {
      await nextButton.click()
      await page.getByText(/第 2 \/ \d+ 页/, { exact: true }).waitFor()
      await page.locator('button').filter({ hasText: '上一页' }).click()
      await page.getByText(/第 1 \/ \d+ 页/, { exact: true }).waitFor()
    }

    const pageWidth = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }))
    assert.ok(pageWidth.scroll <= pageWidth.client + 1, `${viewport.name} root overflow: ${JSON.stringify(pageWidth)}`)
    assert.deepEqual(pageErrors, [], `${viewport.name} page errors`)
    assert.deepEqual(consoleErrors, [], `${viewport.name} console errors`)
    const screenshot = resolve(evidenceDir, `${viewport.name}.png`)
    await page.screenshot({ path: screenshot, fullPage: true, timeout: 30_000 })
    results.push({ ...viewport, pageWidth, screenshot, searchAndPagination: true, consoleErrors, pageErrors })
    await context.close()
  }
} finally {
  await browser.close()
}

const audit = {
  schemaVersion: 'fams.fivd-r.runtime.v1',
  checkedAt: new Date().toISOString(),
  status: 'passed',
  results,
  tradingBoundary: {
    formalTradeActionAllowed: false,
    autoTradeAllowed: false,
  },
}
await writeFile(resolve(evidenceDir, 'runtime.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
console.log(JSON.stringify(audit, null, 2))
