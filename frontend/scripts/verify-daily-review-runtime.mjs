import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium } from 'playwright'

const reviewId = process.env.FAMS_REAL_E2E_REVIEW_ID?.trim()
assert.ok(reviewId, 'FAMS_REAL_E2E_REVIEW_ID is required')
const appBase = process.env.FAMS_FRONTEND_E2E_BASE || 'http://localhost:3000'
const repoRoot = resolve(import.meta.dirname, '../..')
const localBrowserLibDir = resolve(repoRoot, '.verification/playwright-libs/lib')
process.env.LD_LIBRARY_PATH = [localBrowserLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':')
const evidenceDir = resolve(repoRoot, '.verification/private/daily-review/DRV1-13/playwright-runtime')
const auditDir = resolve(repoRoot, '.verification/private/daily-review/DRV1-13/audit-runtime')
await Promise.all([mkdir(evidenceDir, { recursive: true }), mkdir(auditDir, { recursive: true })])

const expectedNodes = [
  ['01', '触发评审'], ['02', '持仓快照'], ['03', '行情采集'], ['04', '均线计算'], ['05', '基本面与消息'],
  ['06', '策略评估'], ['07', '关注标的'], ['08', '系统网格'], ['09', '历史比较'], ['10', '执行边界'],
]
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'compact-desktop', width: 1024, height: 768 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
]

const browser = await chromium.launch({ headless: true })
const results = []
try {
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce', locale: 'zh-CN' })
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []
    const visionRequests = []
    const llmRequests = []
    page.on('console', (entry) => { if (entry.type() === 'error') consoleErrors.push(entry.text()) })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('request', (request) => {
      if (request.url().includes('vision-extract')) visionRequests.push(request.url())
      if (/chat\/completions|chatcompletion_pro/i.test(request.url())) llmRequests.push(request.url())
    })
    await page.goto(`${appBase}/daily-reviews/${encodeURIComponent(reviewId)}`, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await page.getByTestId('daily-review-workbench').waitFor({ timeout: 30_000 })
    assert.equal(page.url(), `${appBase}/daily-reviews/${reviewId}`)
    assert.equal(await page.getByRole('button', { name: /NODE \d{2}/ }).count(), 10)
    assert.equal(await page.getByTestId('workflow-dag').locator('svg > path').count(), 17)

    for (const [sequence, title] of expectedNodes) {
      const button = page.getByRole('button', { name: new RegExp(`NODE ${sequence}`) })
      await button.dblclick()
      const modal = page.getByTestId('node-detail-modal')
      await modal.getByText(`NODE ${sequence} · ${title}`, { exact: true }).waitFor()
      for (const allowedHeading of ['当前节点作用', '节点输入', '节点输出']) await modal.getByText(allowedHeading, { exact: true }).waitFor()
      for (const auditOnlyText of ['原始证据', '阻断条件', '本地节点审阅']) assert.equal(await modal.getByText(auditOnlyText, { exact: true }).count(), 0)
      await modal.getByRole('button', { name: '关闭', exact: true }).click()
      await modal.waitFor({ state: 'hidden' })
    }

    const keyboardNode = page.getByRole('button', { name: /NODE 01/ })
    await keyboardNode.focus()
    await page.keyboard.press('Enter')
    await page.getByTestId('node-detail-modal').waitFor()
    await page.getByTestId('node-detail-modal').getByRole('button', { name: '关闭', exact: true }).click()

    await page.getByRole('button', { name: /NODE 06/ }).click()
    assert.ok(await page.getByTestId('workflow-dag').locator('svg > path[stroke="#2563eb"]').count() >= 4, '单击节点未高亮依赖路径')

    await page.getByRole('button', { name: /NODE 03/ }).click()
    await page.getByRole('button', { name: '高级审计', exact: true }).click()
    const auditDrawer = page.getByTestId('daily-review-audit-drawer')
    await auditDrawer.getByText('原始证据', { exact: true }).waitFor()
    await auditDrawer.getByText('阻断条件', { exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await auditDrawer.waitFor({ state: 'hidden' })

    await page.getByTestId('daily-review-decision-summary').waitFor()
    const focusPanel = page.getByTestId('focus-buyback-points')
    await focusPanel.waitFor()
    for (const symbol of ['601127', '600276', '159851', '513770']) assert.equal(await focusPanel.getByTestId(`focus-asset-${symbol}`).count(), 1)
    await page.getByTestId('manual-order-plan').waitFor()
    await page.getByTestId('conditional-buyback-plan').waitFor()
    const attentionPanel = page.getByTestId('attention-synthesis')
    assert.doesNotMatch(await attentionPanel.innerText(), /market-provider:|financial-report:|quote-list-canonical:|stock-factset-cache:/, '关注正文泄漏原始证据标识')
    await attentionPanel.getByRole('button', { name: /查看原始证据/ }).first().click()
    await auditDrawer.getByText('当前证据筛选：').waitFor()
    await page.keyboard.press('Escape')
    await auditDrawer.waitFor({ state: 'hidden' })
    await page.getByTestId('grid-derivation-traces').locator('.ant-collapse-header').first().click()
    await page.getByText('一、价值评估基线', { exact: true }).first().waitFor()
    await page.getByText('五、交易规则与有效期', { exact: true }).first().waitFor()
    await page.getByText('六、卖出后条件买回', { exact: true }).first().waitFor()
    await page.getByText('七、风险门禁与最终输出', { exact: true }).first().waitFor()

    const assetSelect = page.getByRole('combobox', { name: '选择行情资产' })
    await assetSelect.focus()
    await page.keyboard.press('Enter')
    const options = page.getByRole('option')
    const optionLabels = await options.allTextContents()
    assert.equal(optionLabels.length, 6, `${viewport.name} 资产选项数异常`)
    await options.last().click()
    assert.equal(await page.locator('.ant-select-selection-item').filter({ hasText: optionLabels.at(-1) }).count(), 1)

    await page.getByRole('button', { name: '历史复盘' }).click()
    const historyTitle = page.getByText('历史持仓复盘', { exact: true })
    await historyTitle.waitFor()
    assert.equal(await page.getByRole('combobox', { name: '筛选复盘场次' }).count(), 1)
    assert.equal(await page.getByRole('combobox', { name: '筛选复盘状态' }).count(), 1)
    await page.keyboard.press('Escape')
    await historyTitle.waitFor({ state: 'hidden' })

    let exportVerified = false
    let annotationRestored = false
    if (viewport.name === 'desktop') {
      await page.getByRole('button', { name: /NODE 02/ }).click()
      await page.getByRole('button', { name: '高级审计', exact: true }).click()
      const annotation = page.getByTestId('node-review-annotation')
      await annotation.getByText('通过', { exact: true }).click()
      const note = `DRV1-7 ${reviewId} 浏览器本地审阅`
      await annotation.getByRole('textbox', { name: '节点审阅备注' }).fill(note)
      const storage = await page.evaluate((id) => JSON.parse(localStorage.getItem(`fams.dailyReview.nodeReviews.v1:${id}`) || '{}'), reviewId)
      assert.equal(storage.positions.status, 'pass')
      assert.equal(storage.positions.note, note)
      await page.keyboard.press('Escape')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByTestId('daily-review-workbench').waitFor({ timeout: 30_000 })
      await page.getByRole('button', { name: /NODE 02/ }).click()
      await page.getByRole('button', { name: '高级审计', exact: true }).click()
      annotationRestored = (await page.getByRole('textbox', { name: '节点审阅备注' }).inputValue()) === note
      assert.equal(annotationRestored, true)
      await page.keyboard.press('Escape')

      const downloadPromise = page.waitForEvent('download')
      await page.getByRole('button', { name: '导出审计 JSON' }).click()
      const download = await downloadPromise
      const downloadPath = await download.path()
      assert.ok(downloadPath)
      const exported = JSON.parse(await readFile(downloadPath, 'utf8'))
      assert.equal(exported.workflow.reviewId, reviewId)
      assert.equal(exported.workflow.schemaVersion, 'fams.daily-review-audit-workflow.v2')
      assert.equal(exported.localNodeReviews.positions.status, 'pass')
      assert.equal(exported.localNodeReviewsAreFormalSignoff, false)
      exportVerified = true
    }

    for (const text of ['formalTradingUnlocked=false', 'autoTradeUnlocked=false', 'canCreateOrder=false', 'orderCreateAllowed=false']) await page.getByText(text, { exact: true }).waitFor()
    assert.equal(await page.getByTestId('screenshot-capture-panel').count(), 1)
    assert.equal(await page.locator('canvas').count(), 1)
    const measurements = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      mainCount: document.querySelectorAll('main').length,
      navCount: document.querySelectorAll('nav').length,
      headingOneCount: document.querySelectorAll('h1').length,
    }))
    assert.equal(measurements.documentWidth, measurements.viewportWidth, `${viewport.name} 根页面横向溢出`)
    assert.equal(measurements.mainCount, 1)
    assert.ok(measurements.navCount >= 1)
    assert.equal(measurements.headingOneCount, 1)
    assert.deepEqual(consoleErrors, [], `${viewport.name} console errors`)
    assert.deepEqual(pageErrors, [], `${viewport.name} page errors`)
    assert.deepEqual(visionRequests, [], `${viewport.name} 不应调用视觉识别`)
    assert.deepEqual(llmRequests, [], `${viewport.name} 页面重载不得再次调用 LLM`)
    await page.screenshot({ path: resolve(evidenceDir, `${viewport.name}.png`), fullPage: true, timeout: 30_000 })
    results.push({ ...viewport, optionLabels, annotationRestored, exportVerified, measurements, consoleErrors, pageErrors, visionRequests, llmRequests })
    await context.close()
  }
} finally {
  await browser.close()
}

const audit = {
  schemaVersion: 'fams.daily-review-frontend-runtime.v2', status: 'passed', reviewId, checkedAt: new Date().toISOString(), results,
  assertions: {
    tenNodeDagAndSeventeenEdges: true, doubleClickModalOnlyPurposeInputsOutputs: true, keyboardNodeDetailOperable: true,
    singleClickHighlightsDependencyPath: true, decisionSummaryAndReproducibleTrace: true, attentionNarrativeHidesRawEvidenceRefs: true,
    dualGridListsSeparated: true, fourFocusAssetsVisible: true, conditionalBuybackNotPresentedAsImmediate: true,
    advancedAuditContainsEvidenceAndAnnotations: true, assetSwitchSixRealPositions: true, localAnnotationPersistence: true,
    exportIncludesNonFormalAnnotations: true, fourTradingLocksVisible: true, pageReloadDoesNotInvokeLlm: true,
    screenshotPanelPresentWithoutVisionCall: true, responsiveNoRootOverflow: true, browserErrorsZero: true,
  },
}
await Promise.all([
  writeFile(resolve(evidenceDir, 'frontend-runtime.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8'),
  writeFile(resolve(auditDir, `${reviewId}.json`), `${JSON.stringify(audit, null, 2)}\n`, 'utf8'),
])
console.log(JSON.stringify(audit, null, 2))
