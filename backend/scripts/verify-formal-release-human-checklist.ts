import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const repoRoot = resolve(process.cwd(), '..')
const htmlPath = resolve(repoRoot, 'frontend', 'public', 'formal-release-human-checklist.html')
const screenshotDir = resolve(repoRoot, 'docs', 'screenshots')
const playwrightLibPath = resolve(repoRoot, '.verification', 'playwright-libs', 'lib')

async function main() {
  await mkdir(screenshotDir, { recursive: true })
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH
    ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}`
    : playwrightLibPath

  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 })
  const browserMessages: string[] = []
  desktop.on('console', (message: any) => {
    if (message.type() === 'error' || message.type() === 'warning') browserMessages.push(`${message.type()}:${message.text()}`)
  })
  desktop.on('pageerror', (error: Error) => browserMessages.push(`pageerror:${error.message}`))

  try {
    await desktop.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
    await desktop.evaluate(() => localStorage.clear())
    await desktop.reload({ waitUntil: 'load' })
    await desktop.getByRole('heading', { name: /你只需要回答/ }).waitFor()
    await desktop.locator('#answeredCount').getByText('0', { exact: true }).waitFor()
    await desktop.waitForTimeout(350)
    await desktop.screenshot({
      path: resolve(screenshotDir, 'formal-release-human-checklist.png'),
      fullPage: true,
    })

    await desktop.locator('[data-item-id="review_team"]').getByRole('button', { name: '已完成' }).click()
    await desktop.getByRole('button', { name: '全部查看' }).click()
    await desktop.locator('[data-item-id="formal_data"]').getByRole('button', { name: '卡住了' }).click()
    await desktop.locator('[data-item-id="formal_data"] [data-note]').fill('自动化交互演示：缺少正式授权材料，不是真实业务结论')
    await desktop.locator('[data-item-id="total_return_benchmark"]').getByRole('button', { name: '不确定' }).click()
    await desktop.locator('[data-item-id="candidate_set"]').getByRole('button', { name: '已完成' }).click()
    await desktop.locator('[data-item-id="four_reviews"]').getByRole('button', { name: '不确定' }).click()
    await desktop.locator('[data-item-id="final_review"]').getByRole('button', { name: '不确定' }).click()
    await desktop.locator('[data-item-id="release_meeting"]').getByRole('button', { name: '卡住了' }).click()
    await desktop.locator('[data-meeting-decision]').selectOption('request_changes')

    const resultText = await desktop.locator('#resultText').inputValue()
    assert.match(resultText, /完成度：2\/7 已完成；2 卡住；3 不确定；0 未回答/)
    assert.match(resultText, /请 Codex 接下来/)
    assert.match(resultText, /formalTradingUnlocked=false/)

    const downloadPromise = desktop.waitForEvent('download')
    await desktop.getByRole('button', { name: '下载结果 JSON' }).click()
    const download = await downloadPromise
    assert.match(download.suggestedFilename(), /^fams-human-checklist-\d{4}-\d{2}-\d{2}\.json$/)

    await desktop.screenshot({
      path: resolve(screenshotDir, 'formal-release-human-checklist-interaction-demo.png'),
      fullPage: true,
    })
    await desktop.getByRole('button', { name: '打印交接' }).click()
    assert.equal(await desktop.locator('#dashboard').getAttribute('class'), 'dashboard mode-print')

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 })
    await mobile.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' })
    await mobile.evaluate(() => localStorage.clear())
    await mobile.reload({ waitUntil: 'load' })
    await mobile.waitForTimeout(350)
    const mobileOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(mobileOverflow <= 0, `mobile horizontal overflow: ${mobileOverflow}px`)
    await mobile.getByRole('heading', { name: /你只需要回答/ }).waitFor()
    await mobile.screenshot({
      path: resolve(screenshotDir, 'formal-release-human-checklist-mobile.png'),
      fullPage: true,
    })
    await mobile.close()
  } finally {
    await browser.close()
  }

  assert.deepEqual(browserMessages, [], `browser console must stay clean: ${browserMessages.join('; ')}`)
  console.log(JSON.stringify({
    schemaVersion: 'fams.formal_release.human_checklist_runtime_verification.v1',
    status: 'passed',
    checkedScenarios: [
      'clean_initial_state',
      'guided_and_overview_modes',
      'done_blocked_unsure_states',
      'plain_chinese_codex_handoff',
      'json_download',
      'print_mode',
      'mobile_no_horizontal_overflow',
      'browser_console_clean',
    ],
    screenshots: [
      resolve(screenshotDir, 'formal-release-human-checklist.png'),
      resolve(screenshotDir, 'formal-release-human-checklist-interaction-demo.png'),
      resolve(screenshotDir, 'formal-release-human-checklist-mobile.png'),
    ],
    productionAdapterEnabled: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
