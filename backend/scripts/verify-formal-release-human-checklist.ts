import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { extname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { humanAcceptanceDraftService } from '../src/services/formal-release/humanAcceptanceDraftService.js'

const repoRoot = resolve(process.cwd(), '..')
const publicRoot = resolve(repoRoot, 'frontend/public')
const htmlPath = resolve(publicRoot, 'formal-release-human-checklist.html')
const guideDir = resolve(publicRoot, 'human-acceptance-guide')
const screenshotDir = resolve(repoRoot, 'docs/screenshots')
const ftr6PackageRoot = resolve(repoRoot, 'backend/data/gpt-audit/formal-release-readiness/FTR-6')
const playwrightLibPath = resolve(repoRoot, '.verification/playwright-libs/lib')

const mimeType = (path: string) => ({ '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.json': 'application/json' }[extname(path)] || 'application/octet-stream')

async function currentFtr6Report() {
  const entries = await readdir(ftr6PackageRoot, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const report = resolve(ftr6PackageRoot, name, 'acceptance-report.html')
    try {
      await readFile(report)
      return report
    } catch {
      // Ignore incomplete package directories.
    }
  }
  throw new Error('ftr6_acceptance_report_not_found')
}

async function generateEvidenceReadingImages(browser: any, ftr6Report: string) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 })
  await page.goto(pathToFileURL(ftr6Report).href, { waitUntil: 'load' })
  await page.locator('header').screenshot({ path: resolve(guideDir, 'ftr6-overview.png') })
  const artifacts = page.locator('section.band').filter({ has: page.getByRole('heading', { name: '原始证据清单' }) })
  await artifacts.scrollIntoViewIfNeeded()
  await page.screenshot({ path: resolve(guideDir, 'ftr6-artifacts-top.png') })
  await page.evaluate(() => window.scrollBy(0, 560))
  await page.screenshot({ path: resolve(guideDir, 'ftr6-artifacts-middle.png') })
  await page.locator('section.band').filter({ has: page.getByRole('heading', { name: '硬边界' }) }).screenshot({ path: resolve(guideDir, 'ftr6-boundary.png') })
  await page.close()
}

const v2InstructionGuides = [
  {
    file: 'v2-step-1-sidepanel-guide.png',
    title: '打开原生 Side Panel',
    lead: '在真实 Chrome 中加载当前扩展构建，打开侧栏并确认连接状态。',
    panes: ['Chrome 当前标签页', '扩展图标 -> 打开侧栏', 'Side Panel 显示已连接'],
    proof: '现场证据：原生侧栏、扩展 ID、当前页面和连接状态同屏。',
  },
  {
    file: 'v2-step-2-three-entry-guide.png',
    title: '逐一验证三入口',
    lead: '使用同一个 scenarioId，分别从 Side Panel、Workspace Page 和 Host App 发起。',
    panes: ['Side Panel 发起', 'Workspace Page 发起', 'Host App 发起'],
    proof: '现场证据：三次 dispatch 独立可辨，canonical route 一致。',
  },
  {
    file: 'v2-step-3-route-intents-guide.png',
    title: '核对五类研究路由',
    lead: '在 Workspace 逐项打开来源库、来源详情、问答、追溯和关系图。',
    panes: ['source_library / source_detail', 'ask / trace', 'graph + evidence'],
    proof: '现场证据：每类路由有真实结果、空态或可解释失败，不是静态 mock。',
  },
  {
    file: 'v2-step-4-lifecycle-guide.png',
    title: '验证刷新、关闭与恢复',
    lead: '按顺序执行刷新、关闭重开、断连和重连，观察同一任务状态。',
    panes: ['Refresh', 'Close -> Reopen', 'Offline -> Reconnect'],
    proof: '现场证据：trace 含 start/resume/reconnect/close，状态不丢失且无重复 ingest。',
  },
]

async function generateV2InstructionImages(browser: any) {
  const page = await browser.newPage({ viewport: { width: 960, height: 560 }, deviceScaleFactor: 1 })
  for (const [index, guide] of v2InstructionGuides.entries()) {
    await page.setContent(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
      *{box-sizing:border-box}body{margin:0;padding:24px;background:#eef2f5;color:#172033;font-family:"Microsoft YaHei",sans-serif}.frame{position:relative;width:912px;height:500px;overflow:hidden;border:1px solid #bfcbd5;border-radius:10px;background:#fff;box-shadow:0 18px 45px rgba(23,32,51,.16)}.browser{display:flex;align-items:center;gap:8px;height:46px;padding:0 14px;border-bottom:1px solid #d7e0e7;background:#f7f9fa}.dot{width:10px;height:10px;border-radius:50%;background:#c7d0d8}.address{flex:1;margin-left:8px;padding:7px 12px;border:1px solid #d7e0e7;border-radius:6px;color:#68768a;background:#fff;font-size:12px}.tag{padding:5px 8px;border-radius:4px;color:#794500;background:#fff1c7;font-size:11px;font-weight:800}.content{padding:24px}.step{color:#136b65;font-size:12px;font-weight:850}.content h1{margin:4px 0 6px;font-size:25px;letter-spacing:0}.lead{margin:0;color:#526176;font-size:14px}.panes{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:20px}.pane{position:relative;min-height:185px;padding:45px 16px 16px;border:2px solid #d5dfe7;border-radius:8px;background:#f8fafb}.pane:before{content:attr(data-n);position:absolute;top:12px;left:14px;display:grid;place-items:center;width:25px;height:25px;border-radius:5px;color:#fff;background:#245fa5;font-size:12px;font-weight:800}.pane strong{display:block;font-size:15px}.pane span{display:block;margin-top:12px;padding:13px;border:1px dashed #9aabb9;border-radius:5px;color:#526176;background:#fff;font-size:12px}.arrow{position:absolute;right:-11px;top:88px;z-index:2;color:#955708;font-size:24px;font-weight:900}.proof{margin-top:18px;padding:11px 13px;border-left:4px solid #955708;color:#744300;background:#fff4dc;font-size:13px;font-weight:750}.watermark{position:absolute;right:14px;bottom:9px;color:#9b5c08;font-size:10px;font-weight:800}
    </style><body><section class="frame"><div class="browser"><i class="dot"></i><i class="dot"></i><i class="dot"></i><div class="address">chrome-extension://&lt;当前扩展ID&gt;/...</div><span class="tag">操作示意 · 非验收证据</span></div><div class="content"><div class="step">V2-PX 人工步骤 ${index + 1}/4</div><h1>${guide.title}</h1><p class="lead">${guide.lead}</p><div class="panes">${guide.panes.map((pane, paneIndex) => `<div class="pane" data-n="${paneIndex + 1}"><strong>${pane}</strong><span>在真实浏览器中完成此操作，并让关键状态进入截图。</span>${paneIndex < 2 ? '<b class="arrow">›</b>' : ''}</div>`).join('')}</div><div class="proof">${guide.proof}</div></div><div class="watermark">指导图不能替代真实 Chrome 截图与 trace</div></section></body></html>`)
    await page.locator('.frame').screenshot({ path: resolve(guideDir, guide.file) })
  }
  await page.close()
}

async function main() {
  await Promise.all([mkdir(guideDir, { recursive: true }), mkdir(screenshotDir, { recursive: true })])
  process.env.LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH ? `${playwrightLibPath}:${process.env.LD_LIBRARY_PATH}` : playwrightLibPath
  const { chromium } = await import('playwright')
  const browser = await chromium.launch({ headless: true })
  const ftr6Report = await currentFtr6Report()
  await generateEvidenceReadingImages(browser, ftr6Report)
  await generateV2InstructionImages(browser)

  const realContext = await humanAcceptanceDraftService.context()
  let serverDraft = structuredClone(realContext.draft)
  let saveCount = 0
  const receivedBodies: any[] = []
  const waitForSaveCount = async (expected: number) => {
    const deadline = Date.now() + 5000
    while (saveCount < expected && Date.now() < deadline) await new Promise((done) => setTimeout(done, 50))
    assert.ok(saveCount >= expected, `expected at least ${expected} private draft API saves, got ${saveCount}`)
  }
  const server = createServer(async (request, response) => {
    try {
      if (request.url === '/api/v1/formal-release/human-review-drafts/current' && request.method === 'GET') {
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ ...realContext, draft: serverDraft }))
        return
      }
      if (request.url === '/api/v1/formal-release/human-review-drafts/current' && request.method === 'PUT') {
        let body = ''
        for await (const chunk of request) body += chunk
        const parsed = JSON.parse(body)
        receivedBodies.push(parsed)
        assert.equal(parsed.expectedRevision, serverDraft.revision)
        assert.equal(parsed.packageId, realContext.package.packageId)
        assert.equal(parsed.sourceManifestSha256, realContext.package.sourceManifestSha256)
        assert.equal(parsed.items.length, 8)
        assert.equal('formalTradingUnlocked' in parsed, false)
        saveCount += 1
        serverDraft = {
          ...serverDraft,
          revision: serverDraft.revision + 1,
          updatedAt: new Date().toISOString(),
          items: parsed.items,
          overallStatus: parsed.items.every((item: any) => item.status === 'passed') ? 'ready_for_authorized_signoff' : parsed.items.some((item: any) => ['failed', 'needs_remediation'].includes(item.status)) ? 'needs_remediation' : 'in_progress',
        }
        response.writeHead(200, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ schemaVersion: 'fams.formal_release.human_acceptance_draft_save.v1', draft: serverDraft, draftPath: realContext.draftPath, officialSignoffCreated: false, humanAcceptanceStatus: 'pending_batch_review', tradeBoundary: realContext.tradeBoundary }))
        return
      }
      const rawPath = request.url === '/' ? '/formal-release-human-checklist.html' : String(request.url).split('?')[0]
      const relativePath = decodeURIComponent(rawPath).replace(/^\/+/, '')
      const target = resolve(publicRoot, relativePath)
      if (!target.startsWith(publicRoot)) throw new Error('unsafe_path')
      const content = await readFile(target)
      response.writeHead(200, { 'Content-Type': mimeType(target), 'Cache-Control': 'no-store' })
      response.end(content)
    } catch {
      response.writeHead(404)
      response.end('not found')
    }
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const pageUrl = `http://127.0.0.1:${address.port}/formal-release-human-checklist.html`
  const browserMessages: string[] = []

  try {
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
    desktop.on('console', (message: any) => { if (['error', 'warning'].includes(message.type())) browserMessages.push(`${message.type()}:${message.text()}`) })
    desktop.on('pageerror', (error: Error) => browserMessages.push(`pageerror:${error.message}`))
    await desktop.goto(pageUrl, { waitUntil: 'networkidle' })
    await desktop.getByRole('heading', { name: '照图逐步操作，再记录真实结果' }).waitFor()
    assert.equal(await desktop.locator('[data-review-type]').count(), 8)
    assert.equal(await desktop.locator('.step').count(), 32)
    assert.equal(await desktop.locator('.step-visual').count(), 32)
    assert.equal(await desktop.locator('.step-visual.manual').count(), 4)
    assert.equal(await desktop.locator('.step-visual img').count(), 32)
    assert.equal(await desktop.locator('.step-visual.manual img').count(), 4)
    assert.equal(await desktop.locator('.manual-proof').count(), 4)
    assert.equal(await desktop.locator('.image-zoom-trigger').count(), 32)
    assert.equal(await desktop.locator('.step-action-guide').count(), 32)
    assert.equal(await desktop.locator('.step-action-guide .guide-row').count(), 64)
    assert.equal(await desktop.locator('.image-viewport .image-hotspot').count(), 64)
    assert.equal(await desktop.locator('.image-zoom-trigger[data-action][data-observe]').count(), 32)
    assert.equal(await desktop.locator('.part h3', { hasText: '功能介绍' }).count(), 8)
    assert.equal(await desktop.locator('.part h3', { hasText: '相关架构' }).count(), 8)
    assert.equal(await desktop.locator('.part h3', { hasText: '预期交互与逐步配图' }).count(), 8)
    assert.equal(await desktop.locator('.part h3', { hasText: '人类反馈实际结果回填' }).count(), 8)
    const brokenImages = await desktop.locator('.step-visual img').evaluateAll((images: HTMLImageElement[]) => images.filter((image) => !image.complete || image.naturalWidth === 0).map((image) => image.src))
    assert.deepEqual(brokenImages, [])
    assert.match(await desktop.locator('#packageId').textContent() || '', /^ftr6-provisional-/)
    assert.match(await desktop.locator('#manifestHash').textContent() || '', /^[a-f0-9]{64}$/)
    const finalPass = desktop.locator('[data-review-type="final_release"] [data-field="status"] option[value="passed"]')
    assert.equal(await finalPass.isDisabled(), true)
    await desktop.screenshot({ path: resolve(screenshotDir, 'formal-release-human-checklist-a6-desktop.png'), fullPage: false })

    const firstImageTrigger = desktop.locator('.image-zoom-trigger').first()
    await firstImageTrigger.scrollIntoViewIfNeeded()
    await desktop.screenshot({ path: resolve(screenshotDir, 'formal-release-human-checklist-a6-visual-guidance.png'), fullPage: false })
    const firstImageSource = await firstImageTrigger.getAttribute('data-src')
    await firstImageTrigger.focus()
    await firstImageTrigger.press('Enter')
    assert.equal(await desktop.locator('#imageDialog').evaluate((dialog: HTMLDialogElement) => dialog.open), true)
    assert.equal(await desktop.locator('#imageDialogImage').getAttribute('src'), firstImageSource)
    assert.match(await desktop.locator('#imageDialogTitle').textContent() || '', /导入或打开真实资产/)
    assert.match(await desktop.locator('#dialogAction').textContent() || '', /导入 Excel/)
    assert.match(await desktop.locator('#dialogObserve').textContent() || '', /总市值/)
    assert.equal(await desktop.locator('.image-dialog-canvas .image-hotspot').count(), 2)
    await desktop.screenshot({ path: resolve(screenshotDir, 'formal-release-human-checklist-a6-image-zoom.png'), fullPage: false })
    await desktop.getByRole('button', { name: '查看原始尺寸' }).click()
    assert.equal(await desktop.locator('#imageDialogCanvas').evaluate((canvas) => canvas.classList.contains('is-actual-size')), true)
    assert.equal(await desktop.getByRole('button', { name: '适应窗口' }).getAttribute('aria-pressed'), 'true')
    await desktop.locator('#imageDialogImage').click({ position: { x: 6, y: 6 } })
    assert.equal(await desktop.locator('#imageDialogCanvas').evaluate((canvas) => canvas.classList.contains('is-actual-size')), false)
    await desktop.keyboard.press('Escape')
    assert.equal(await desktop.locator('#imageDialog').evaluate((dialog: HTMLDialogElement) => dialog.open), false)
    assert.equal(await firstImageTrigger.evaluate((trigger) => document.activeElement === trigger), true)

    const manualImageTrigger = desktop.locator('[data-review-type="v2_px_experience"] .image-zoom-trigger').first()
    await manualImageTrigger.click()
    assert.match(await desktop.locator('#dialogEvidenceClass').textContent() || '', /操作示意，不是通过证据/)
    await desktop.getByRole('button', { name: '关闭大图' }).click()

    const first = desktop.locator('[data-review-type="daily_user_experience"]')
    await first.locator('[data-field="status"]').selectOption('passed')
    await first.locator('[data-field="actualResult"]').fill('浏览器自动化只验证反馈流程；该文字不是人类业务通过结论。')
    await waitForSaveCount(1)
    const second = desktop.locator('[data-review-type="v2_px_experience"]')
    await second.locator('[data-field="status"]').selectOption('needs_remediation')
    await second.locator('[data-field="actualResult"]').fill('自动化演示：真实 Chrome 人工截图仍待采集。')
    await second.locator('[data-field="evidenceRefs"]').fill('.verification/private/a6/v2-px-step.png')
    await waitForSaveCount(2)
    assert.equal(receivedBodies.at(-1).items[1].severity, 'major')
    assert.match(await desktop.locator('#summaryText').textContent() || '', /需修复复验/)
    assert.match(await desktop.locator('#summaryText').textContent() || '', /formalTradingUnlocked=false/)
    await desktop.screenshot({ path: resolve(screenshotDir, 'formal-release-human-checklist-a6-feedback.png'), fullPage: false })
    const downloadPromise = desktop.waitForEvent('download')
    await desktop.getByRole('button', { name: '下载 JSON' }).click()
    assert.match((await downloadPromise).suggestedFilename(), /^fams-a6-human-feedback-\d{4}-\d{2}-\d{2}\.json$/)
    await desktop.close()

    serverDraft = structuredClone(realContext.draft)
    for (const [name, width, height] of [['tablet', 768, 900], ['mobile', 390, 844]] as const) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
      await page.goto(pageUrl, { waitUntil: 'networkidle' })
      await page.getByRole('heading', { name: '照图逐步操作，再记录真实结果' }).waitFor()
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      assert.ok(overflow <= 0, `${name} horizontal overflow: ${overflow}px`)
      await page.screenshot({ path: resolve(screenshotDir, `formal-release-human-checklist-a6-${name}.png`), fullPage: false })
      if (name === 'mobile') {
        const mobileTrigger = page.locator('.image-zoom-trigger').first()
        await mobileTrigger.scrollIntoViewIfNeeded()
        await mobileTrigger.click()
        assert.equal(await page.locator('#imageDialog').evaluate((dialog: HTMLDialogElement) => dialog.open), true)
        const dialogOverflow = await page.locator('#imageDialog').evaluate((dialog) => dialog.scrollWidth - dialog.clientWidth)
        assert.ok(dialogOverflow <= 0, `mobile image dialog horizontal overflow: ${dialogOverflow}px`)
        await page.getByRole('button', { name: '查看原始尺寸' }).click()
        assert.equal(await page.locator('#imageDialogCanvas').evaluate((canvas) => canvas.classList.contains('is-actual-size')), true)
        await page.screenshot({ path: resolve(screenshotDir, 'formal-release-human-checklist-a6-mobile-image-zoom.png'), fullPage: false })
        await page.keyboard.press('Escape')
      }
      await page.close()
    }
  } finally {
    await new Promise<void>((done) => server.close(() => done()))
    await browser.close()
  }

  assert.deepEqual(browserMessages, [], `browser console must stay clean: ${browserMessages.join('; ')}`)
  console.log(JSON.stringify({
    schemaVersion: 'fams.formal_release.human_acceptance_workbench_runtime_verification.v1',
    status: 'passed',
    currentPackageId: realContext.package.packageId,
    reviewTypeCount: 8,
    illustratedHumanStepCount: 32,
    illustratedHumanStepCoveragePercent: 100,
    guidedHumanStepCount: 32,
    guidedHumanStepCoveragePercent: 100,
    screenshotZoomTriggerCount: 32,
    numberedHotspotCount: 64,
    originalSizeZoomTogglePassed: true,
    keyboardZoomOpenPassed: true,
    escapeCloseAndFocusRestorePassed: true,
    realOrFrozenEvidenceImageStepCount: 28,
    instructionalDiagramStepCount: 4,
    manualChromeCaptureRequiredStepCount: 4,
    privateDraftApiRoundTrips: saveCount,
    visualViewportsPassed: ['1440x1000', '768x900', '390x844'],
    officialSignoffCreated: false,
    humanAcceptanceStatus: 'pending_batch_review',
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
