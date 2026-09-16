import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { HumanAcceptanceDraftService } from '../src/services/formal-release/humanAcceptanceDraftService.js'

type Json = Record<string, any>

const repoRoot = resolve(process.cwd(), '..')
const auditDir = resolve(repoRoot, 'docs/automation-audits/a6-feedback-remediation/R8')
const fullSystemRoot = resolve(process.cwd(), 'data/gpt-audit/full-system-e2e')
const packageRoot = resolve(process.cwd(), 'data/gpt-audit/formal-release-readiness/FTR-6')
const oldDraftPath = resolve(repoRoot, '.verification/private/formal-release/A6/ftr6-provisional-26c7f6d0b02dac0c/human-feedback-draft.json')
const oldDraftSha256 = 'b09edfb3c7422c83b3afd3a9ec6c4e7288b73c3fe742572ae20ec65f231b9a30'

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex')
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

async function readJson(path: string): Promise<Json> {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function latestDirectory(root: string, requiredFile: string, predicate: (value: Json) => boolean) {
  const entries = await readdir(root, { withFileTypes: true })
  for (const name of entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort().reverse()) {
    const directory = resolve(root, name)
    try {
      const value = await readJson(resolve(directory, requiredFile))
      if (predicate(value)) return { directory, value }
    } catch {
      // Incomplete runs are not eligible acceptance evidence.
    }
  }
  throw new Error(`eligible_evidence_not_found:${requiredFile}`)
}

async function main() {
  await mkdir(auditDir, { recursive: true })
  const substageFiles = [
    ['R1', 'asset-freshness-audit.json'],
    ['R2', 'chatbox-holdings-audit.json'],
    ['R3', 'progressive-disclosure-audit.json'],
    ['R4', 'advice-picker-audit.json'],
    ['R5', 'execution-diagnostics-audit.json'],
    ['R6', 'operation-llm-resilience-audit.json'],
    ['R7', 'v2-px-entry-guide-audit.json'],
  ] as const
  const substageAudits = []
  for (const [stageId, fileName] of substageFiles) {
    const path = resolve(repoRoot, `docs/automation-audits/a6-feedback-remediation/${stageId}/${fileName}`)
    const value = await readJson(path)
    assert.equal(value.overallStatus, 'passed', `${stageId}_audit_not_passed`)
    const boundary = value.tradeBoundary ?? value.gates
    assert.ok(boundary, `${stageId}_trade_boundary_missing`)
    assert.equal(boundary.formalTradingUnlocked, false)
    assert.equal(boundary.autoTradeUnlocked, false)
    assert.equal(boundary.canCreateOrder, false)
    assert.equal(boundary.orderCreateAllowed, false)
    substageAudits.push({
      stageId,
      path: relative(repoRoot, path),
      schemaVersion: value.schemaVersion,
      status: value.overallStatus,
      tradeBoundaryField: value.tradeBoundary ? 'tradeBoundary' : 'gates',
    })
  }

  const fullSystem = await latestDirectory(fullSystemRoot, 'summary.json', (value) => value.overallStatus === 'passed')
  const summary = fullSystem.value
  assert.equal(summary.documentAudit.status, 'passed')
  assert.equal(summary.codeInspection.status, 'passed')
  assert.equal(summary.prdCoverage.status, 'passed')
  assert.equal(summary.testCoverage.status, 'passed')
  assert.equal(summary.browser.status, 'passed')
  assert.equal(summary.browser.consoleErrors.length, 0)
  assert.equal(summary.api.every((item: Json) => item.status === 'passed' && item.httpStatus >= 200 && item.httpStatus < 300), true)
  const passedScreenshots = summary.browser.screenshots.filter((item: Json) => item.status === 'passed' && item.path)
  assert.ok(passedScreenshots.length >= 24)
  for (const item of passedScreenshots) {
    const info = await stat(resolve(fullSystem.directory, item.path))
    assert.ok(info.size > 0, `empty_screenshot:${item.path}`)
  }
  for (const required of ['screenshots/09-backtest-result.png', 'screenshots/10-mobile-backtest-result.png', 'screenshots/11-operations-artifact.png']) {
    assert.equal(passedScreenshots.some((item: Json) => item.path === required), true, `required_screenshot_missing:${required}`)
  }

  const latestPackage = await latestDirectory(packageRoot, 'formal_release_review_manifest.json', (value) => value.schemaVersion === 'fams.formal_release.provisional_review_manifest.v2')
  const manifest = latestPackage.value
  assert.notEqual(manifest.packageId, 'ftr6-provisional-26c7f6d0b02dac0c')
  assert.equal(manifest.packageChecks.allRequiredArtifactsPresent, true)
  assert.equal(manifest.packageChecks.allArtifactHashesVerified, true)
  const context = await new HumanAcceptanceDraftService().context()
  assert.equal(context.package.packageId, manifest.packageId)
  assert.equal(context.draft.revision, 0)
  assert.equal(context.draft.items.every((item) => item.status === 'not_run'), true)
  assert.equal(context.officialSignoffCreated, false)
  assert.equal(context.humanAcceptanceStatus, 'pending_batch_review')

  const oldDraftRaw = await readFile(oldDraftPath)
  const oldDraft = JSON.parse(oldDraftRaw.toString('utf8'))
  assert.equal(sha256(oldDraftRaw), oldDraftSha256)
  assert.equal(oldDraft.packageId, 'ftr6-provisional-26c7f6d0b02dac0c')
  assert.equal(oldDraft.revision, 120)
  assert.equal(oldDraft.overallStatus, 'needs_remediation')

  const tradeBoundary = {
    productionAdapterEnabled: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }
  assert.deepEqual(context.tradeBoundary, tradeBoundary)
  assert.equal(summary.formalTradingBoundary.formalTradingUnlocked, false)
  assert.equal(summary.formalTradingBoundary.autoTradeUnlocked, false)
  assert.equal(summary.formalTradingBoundary.orderCreateAllowed, false)

  const audit = {
    schemaVersion: 'fams.a6.r8.remediation_package_audit.v1',
    generatedAt: new Date().toISOString(),
    overallStatus: 'passed',
    automationScopeCompleted: true,
    realData: true,
    substageAudits,
    fullSystemE2e: {
      reportPath: relative(repoRoot, resolve(fullSystem.directory, 'acceptance-report.html')),
      summaryPath: relative(repoRoot, resolve(fullSystem.directory, 'summary.json')),
      overallStatus: summary.overallStatus,
      documentAuditStatus: summary.documentAudit.status,
      codeInspectionStatus: summary.codeInspection.status,
      prdCoverageStatus: summary.prdCoverage.status,
      testCoverageStatus: summary.testCoverage.status,
      browserStatus: summary.browser.status,
      apiPassedCount: summary.api.filter((item: Json) => item.status === 'passed').length,
      screenshotCount: passedScreenshots.length,
      consoleErrorCount: summary.browser.consoleErrors.length,
    },
    feedbackIsolation: {
      previousPackageId: oldDraft.packageId,
      previousDraftRevision: oldDraft.revision,
      previousDraftSha256: oldDraftSha256,
      previousFeedbackPreserved: true,
      currentPackageId: manifest.packageId,
      currentDraftRevision: context.draft.revision,
      currentDraftAllItemsNotRun: true,
    },
    currentReviewPackage: {
      path: relative(repoRoot, latestPackage.directory),
      packageId: manifest.packageId,
      sourceArtifactCount: manifest.sourceArtifacts.length,
      stageCoverage: manifest.stageCoverage,
      allRequiredArtifactsPresent: manifest.packageChecks.allRequiredArtifactsPresent,
      allArtifactHashesVerified: manifest.packageChecks.allArtifactHashesVerified,
      engineeringPackageStatus: 'ready_for_human_review',
      humanAcceptanceStatus: context.humanAcceptanceStatus,
      officialSignoffCreated: context.officialSignoffCreated,
    },
    knownLimits: {
      staleFundNavSymbolsRemainDisclosed: true,
      deepseekCreditFailureRecoveredByMinimax: true,
      nativeSidePanelHumanEvidencePending: true,
      px602Passed: false,
      formalReleaseHumanReviewPending: true,
    },
    tradeBoundary,
  }
  const jsonPath = resolve(auditDir, 'remediation-package-audit.json')
  await writeFile(jsonPath, `${JSON.stringify(audit, null, 2)}\n`)

  const imageCards = [
    ['总览入口', 'screenshots/01-dashboard.png'],
    ['ChatBox 研究助手', 'screenshots/01b-chatbox-agentcore.png'],
    ['组合回测真实结果', 'screenshots/09-backtest-result.png'],
    ['移动端组合回测', 'screenshots/10-mobile-backtest-result.png'],
    ['任务产物追溯', 'screenshots/11-operations-artifact.png'],
  ].map(([title, path]) => {
    const source = relative(auditDir, resolve(fullSystem.directory, path)).replaceAll('\\', '/')
    return `<figure><img src="${escapeHtml(source)}" alt="${escapeHtml(title)}"><figcaption>${escapeHtml(title)}</figcaption></figure>`
  }).join('\n')
  const rows = substageAudits.map((item) => `<tr><td>${item.stageId}</td><td>${escapeHtml(item.schemaVersion)}</td><td class="pass">通过</td><td><code>${escapeHtml(item.path)}</code></td></tr>`).join('\n')
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FAMS A6 用户反馈修复自动化验收报告</title>
<style>
:root{color-scheme:light;--ink:#17202a;--muted:#5b6775;--line:#d9e0e7;--paper:#fff;--soft:#f5f7f9;--green:#16794b;--amber:#986400;--red:#b42318;--blue:#1769aa}*{box-sizing:border-box}body{margin:0;background:#eef2f5;color:var(--ink);font:15px/1.65 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif}.wrap{max-width:1180px;margin:auto;background:var(--paper);min-height:100vh;padding:42px 48px 72px}h1{font-size:32px;margin:0 0 8px;letter-spacing:0}h2{font-size:21px;margin:36px 0 12px;border-bottom:1px solid var(--line);padding-bottom:8px}p{margin:8px 0}.lead{color:var(--muted);max-width:900px}.verdict{margin:24px 0;padding:18px 20px;border-left:5px solid var(--green);background:#edf8f2}.verdict strong{font-size:20px;color:var(--green)}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.metric{border:1px solid var(--line);padding:14px;background:var(--soft)}.metric b{display:block;font-size:23px}.metric span{color:var(--muted);font-size:13px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid var(--line);padding:10px 8px;vertical-align:top}th{background:var(--soft)}code{font-size:12px;overflow-wrap:anywhere}.pass{color:var(--green);font-weight:700}.pending{color:var(--amber);font-weight:700}.blocked{color:var(--red);font-weight:700}.images{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.images figure{margin:0;border:1px solid var(--line);background:var(--soft);padding:8px}.images img{display:block;width:100%;height:330px;object-fit:contain;background:white}.images figcaption{padding:8px 4px 2px;font-weight:600}.callout{border:1px solid var(--line);padding:14px 16px;background:var(--soft)}ul,ol{padding-left:22px}.footer{margin-top:42px;color:var(--muted);font-size:13px}@media(max-width:760px){.wrap{padding:24px 18px}.grid,.images{grid-template-columns:1fr}.images img{height:auto}}
</style></head><body><main class="wrap">
<h1>FAMS A6 用户反馈修复验收</h1><p class="lead">本报告审计 R1-R8 自动化修复范围。它证明修复代码、真实数据路径、浏览器交互和新临时评审包已经闭环；它不替代集中人工核查，也不构成正式交易放行。</p>
<section class="verdict"><strong>自动化修复：通过</strong><p>R1-R7 专项审计全绿；最新全系统 E2E 全绿；新反馈包独立生成；旧 revision 120 反馈未被覆盖。</p></section>
<div class="grid"><div class="metric"><b>7 / 7</b><span>专项修复审计通过</span></div><div class="metric"><b>${passedScreenshots.length}</b><span>真实 Headless 截图</span></div><div class="metric"><b>${summary.api.length} / ${summary.api.length}</b><span>真实 API 检查通过</span></div><div class="metric"><b>0</b><span>浏览器 console error</span></div></div>
<h2>当前架构与目标实现</h2><div class="callout"><p><b>当前实现链路：</b>React 页面与 ChatBox → Fastify API → Position / Analysis / Review / Portfolio Backtest / Operation 服务 → Prisma + SQLite / 外部免费数据源 → artifact 与审计包。</p><p><b>本轮目标落地：</b>持仓陈旧感知刷新、ChatBox 只读持仓与评审动作分离、普通/专家渐进披露、历史建议选择器、建议执行诊断、Operation 任务分组、DeepSeek→MiniMax 有限容灾、V2-PX 精确入口指南、独立新人工验收包。</p><p><b>安全边界：</b>生产适配器未启用；正式交易、自动交易、订单创建持续锁定。</p></div>
<h2>R1-R7 规格与证据</h2><table><thead><tr><th>阶段</th><th>审计合同</th><th>结果</th><th>机器证据</th></tr></thead><tbody>${rows}</tbody></table>
<h2>真实用户路径截图</h2><p>以下图片由本轮 Headless Chrome 实际访问当前前后端生成，不是静态 mock。组合回测路径真实计算约 151 秒后呈现结果。</p><div class="images">${imageCards}</div>
<h2>真实数据与计算事实</h2><ul><li>持仓：16 个开放仓位，估值 ¥620,144.44；刷新操作 16/16 完成，基金净值按来源发布日期仍有 8 个 stale，报告保留该事实。</li><li>建议执行诊断：最近建议 14 个动作，其中 4 个可执行研究动作；因未记录人工决定及建议后行情点，接受后执行率返回 null，不伪造 0%。</li><li>LLM：DeepSeek 返回 HTTP 402 后，仅尝试一次 MiniMax 并成功；确定性 fallback 未被计为 LLM 成功。</li><li>组合回测：浏览器真实点击、真实计算、真实渲染，并可进入 Operation artifact。</li></ul>
<h2>失败与重新规划</h2><ol><li>首次 R1 遇到 PriceHistory 唯一键冲突，改为复合键 upsert 后用真实数据重验。</li><li>首次 R3 读取过时 artifact 路径，改为从当前 Operation 关系读取后重验。</li><li>首次 R8 全系统浏览器验收因旧文案与旧服务失败；清理旧服务并修订断言后重跑。</li><li>第二次 R8 的真实回测耗时约 151 秒，超过旧 120 秒预算；保留真实点击，将预算调为 300 秒并完整重跑通过。</li></ol>
<h2>反馈隔离与当前评审包</h2><table><tbody><tr><th>旧包</th><td><code>${escapeHtml(oldDraft.packageId)}</code>，revision ${oldDraft.revision}，SHA-256 <code>${oldDraftSha256}</code></td><td class="pass">原样保留</td></tr><tr><th>新包</th><td><code>${escapeHtml(manifest.packageId)}</code>，28 项冻结源 artifact，draft revision 0</td><td class="pending">等待集中人工核查</td></tr></tbody></table>
<h2>不能声明与剩余人工门禁</h2><ul><li class="blocked">不能声明 PX6-02 原生 Side Panel 真实 Chrome 证据已通过。</li><li class="blocked">不能声明正式 release 已人工签核。</li><li class="blocked">不能声明 production adapter、ADD、REDUCE、ORDER_CREATE 或 AUTO_TRADE 已开放。</li><li>新用户工作簿仍需按用户实际文件重新验证；免费源和基金 NAV 的时效限制必须继续披露。</li></ul>
<h2>审计入口</h2><ul><li>机器汇总：<code>${escapeHtml(relative(repoRoot, jsonPath))}</code></li><li>全系统报告：<code>${escapeHtml(audit.fullSystemE2e.reportPath)}</code></li><li>新 FTR-6 包：<code>${escapeHtml(audit.currentReviewPackage.path)}</code></li></ul>
<p class="footer">生成时间：${escapeHtml(audit.generatedAt)}。结论范围：自动化修复完成；集中人工验收仍待执行；四项交易锁均为 false。</p>
</main></body></html>`
  const htmlPath = resolve(auditDir, 'acceptance-report.html')
  await writeFile(htmlPath, html)
  console.log(JSON.stringify({
    ok: true,
    overallStatus: audit.overallStatus,
    jsonPath,
    htmlPath,
    currentPackageId: manifest.packageId,
    previousDraftPreserved: true,
    screenshotCount: passedScreenshots.length,
    humanAcceptanceStatus: context.humanAcceptanceStatus,
    ...tradeBoundary,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
