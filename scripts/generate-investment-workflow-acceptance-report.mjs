import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const stageDir = path.resolve(root, 'docs/automation-audits/investment-workflow/WF-7')
const evidenceDir = path.join(stageDir, 'evidence')

async function readJson(file) {
  return JSON.parse(await readFile(path.resolve(root, file), 'utf8'))
}
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
const statusLabel = {
  PASS: '自动通过',
  CONTROLLED_BLOCK: '受控阻断',
  HUMAN_PENDING: '人工待验',
  FAIL: '未通过',
}

const commandAudit = await readJson('docs/automation-audits/investment-workflow/WF-7/evidence/wf7-command-results.json')
const e2e = await readJson('docs/automation-audits/investment-workflow/WF-7/evidence/wf7-full-e2e-audit.json')
const wf1 = await readJson('docs/automation-audits/investment-workflow/WF-1/evidence/wf1_ui_e2e_audit.json')
const wf2 = await readJson('docs/automation-audits/investment-workflow/WF-2/evidence/wf2_ui_e2e_audit.json')
const wf3 = await readJson('docs/automation-audits/investment-workflow/WF-3/evidence/rotation-volatility-contract-audit.json')
const wf4 = await readJson('docs/automation-audits/investment-workflow/WF-4/evidence/portfolio-policy-transition-audit.json')
const wf5 = await readJson('docs/automation-audits/investment-workflow/WF-5/evidence/scenario-comparison-contract-audit.json')
const wf6 = await readJson('docs/automation-audits/investment-workflow/WF-6/evidence/wf6-cross-page-ui-audit.json')

const traceability = [
  ['IW-01', '保留专家导航，以三段工作流解释模块关系', 'InvestmentWorkflowBar.tsx / AppLayout.tsx', 'test:investment-workflow-cross-page', 'WF-6/evidence/wf6-cross-page-ui-audit.json', 'PASS'],
  ['IW-02', '同花顺、支付宝截图为资产录入主入口', 'Assets.tsx / ScreenshotCapturePanel.tsx', 'WF-1 Headless E2E', 'WF-1/evidence/wf1_ui_e2e_audit.json', 'PASS'],
  ['IW-03', '截图识别须逐行纠错并由用户最终确认', 'ScreenshotCapturePanel.tsx / capture routes', '人工确认不可自批', 'WF-7/evidence/wf7-full-e2e-audit.json', 'HUMAN_PENDING'],
  ['IW-04', '行情与指标携带 provider、as-of 和数据健康', 'investmentWorkflowService / priceService', 'test:investment-workflow-foundation', 'WF-1/2026-09-15-acceptance-audit.md', 'PASS'],
  ['IW-05', 'MA5/MA10/MA30、MACD、量比与透明 RRG 口径', 'rotationVolatilityStrategyService.ts', 'test:investment-workflow-rotation-strategy', 'WF-3/evidence/rotation-volatility-contract-audit.json', 'PASS'],
  ['IW-06', '三类策略归类先建议、后由用户确认', 'positionStrategyAssignmentService / PositionStrategyAssignmentPanel', 'test:investment-workflow-readiness', 'WF-2/evidence/wf2_ui_e2e_audit.json', 'PASS'],
  ['IW-07', '进入页面不得隐式改写策略归类', 'PositionStrategyAssignmentPanel.load(false)', 'WF-7 protected snapshot comparison', 'WF-7/evidence/wf7-full-e2e-audit.json', 'PASS'],
  ['IW-08', '未确认策略时阻断运行并提供恢复入口', 'RotationStrategyDecisionPanel', 'WF-6/WF-7 Headless E2E', 'WF-7/evidence/wf7-full-e2e-audit.json', 'PASS'],
  ['IW-09', '轮动策略四层门禁和网格复核', 'rotationVolatilityStrategyService.ts', 'test:investment-workflow-rotation-strategy', 'WF-3/evidence/rotation-volatility-contract-audit.json', 'PASS'],
  ['IW-10', '红利低波默认先显示结论、清单和下一步', 'DividendLowVol.tsx', 'WF-4/WF-7 Headless E2E', 'WF-7/evidence/wf7-full-e2e-audit.json', 'PASS'],
  ['IW-11', '支付宝高防御到永久组合日期政策', 'alipayAllocationStrategy.ts', 'test:investment-workflow-portfolio-policy', 'WF-4/evidence/portfolio-policy-transition-audit.json', 'PASS'],
  ['IW-12', '策略回测与持仓组合对比合并为唯一入口', 'Backtest.tsx / App.tsx', 'test:investment-workflow-cross-page', 'WF-6/evidence/wf6-cross-page-ui-audit.json', 'PASS'],
  ['IW-13', '按建议、不执行、实际流水使用同一冻结时间轴', 'scenarioComparisonService.ts', 'test:investment-workflow-scenario-comparison', 'WF-5/evidence/scenario-comparison-contract-audit.json', 'PASS'],
  ['IW-14', '实际流水逐笔校验且使用真实成交价', 'validateActualTransactionRows / replay', 'test:investment-workflow-scenario-comparison', 'WF-5/evidence/scenario-comparison-contract-audit.json', 'PASS'],
  ['IW-15', 'saved advice replay 禁止未来信息', 'scenarioComparisonService.ts', 'next-tradable execution contract', 'WF-5/evidence/scenario-comparison-contract-audit.json', 'PASS'],
  ['IW-16', 'point-in-time simulation 使用冻结策略逐日重算', 'scenarioComparisonService.ts', '未实现时必须返回 insufficient', 'WF-7/2026-09-16-prd-spec-review.md', 'CONTROLLED_BLOCK'],
  ['IW-17', '三视口无正文横向溢出，主要操作可见', 'responsive pages', 'WF-7 Headless Chromium', 'WF-7/evidence/screenshots', 'PASS'],
  ['IW-18', 'ChatBox 与页面共享业务入口和交易边界', 'FamsChatBox.tsx / famsChatService.ts', 'test:chat-agent-core + WF-7 UI', 'WF-6/evidence/wf6-chatbox-linkage-audit.json', 'PASS'],
  ['IW-19', '真实账户浏览验收不得改写持仓、流水和归类', 'WF-7 protected snapshot comparator', 'WF-7 Headless E2E', 'WF-7/evidence/wf7-full-e2e-audit.json', 'PASS'],
  ['IW-20', '正式交易、下单和自动交易持续锁定', 'trade gate / permissionState', 'trade contracts + strict readiness', 'WF-7/evidence/wf7-command-results.json', 'PASS'],
]

const counts = traceability.reduce((result, row) => ({ ...result, [row[5]]: (result[row[5]] || 0) + 1 }), {})
const failed = counts.FAIL || 0
const automatedStagePassed = commandAudit.status === 'passed' && e2e.status === 'passed' && failed === 0
const matrix = {
  schemaVersion: 'fams.investment-workflow.prd-traceability.v1',
  generatedAt: new Date().toISOString(),
  prd: 'docs/INVESTMENT_WORKFLOW_UX_PRD.md',
  automatedStageStatus: automatedStagePassed ? 'passed_with_disclosed_human_and_controlled_gaps' : 'failed',
  prdFullyComplete: false,
  counts,
  requirements: traceability.map(([requirementId, requirement, implementation, acceptance, evidence, status]) => ({
    requirementId, requirement, implementation, acceptance, evidence: `docs/automation-audits/investment-workflow/${evidence}`, status,
  })),
  unresolved: {
    human: ['截图逐行纠错与最终确认', `默认账户 ${e2e.realAccount.pendingAssignmentCount} 项策略归类确认`, '最终批量人工体验验收'],
    implementation: ['point_in_time_simulation 动态逐日策略重算'],
  },
  permissionState: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
}
await writeFile(path.join(evidenceDir, 'wf7-prd-traceability.json'), JSON.stringify(matrix, null, 2))

const evidenceFiles = [
  'docs/INVESTMENT_WORKFLOW_UX_PRD.md',
  'docs/INVESTMENT_WORKFLOW_DEVELOPMENT_ACCEPTANCE_PLAN.md',
  'docs/automation-audits/investment-workflow/WF-7/evidence/wf7-command-results.json',
  'docs/automation-audits/investment-workflow/WF-7/evidence/wf7-full-e2e-audit.json',
  'docs/automation-audits/investment-workflow/WF-7/evidence/wf7-prd-traceability.json',
]
const evidenceManifest = []
for (const file of evidenceFiles) {
  const bytes = await readFile(path.resolve(root, file))
  const info = await stat(path.resolve(root, file))
  evidenceManifest.push({ file, bytes: info.size, sha256: createHash('sha256').update(bytes).digest('hex') })
}

const screenshotCards = e2e.viewports.flatMap((viewport) => Object.entries(viewport.screenshots).map(([step, screenshot]) => ({ viewport: viewport.name, step, screenshot })))
const architectureRows = [
  ['真实账户事实层', 'Position / Transaction / ScreenshotCapture / canonical market bars', '已实现；WF-7 前后快照一致'],
  ['基本信息确认层', 'Assets.tsx / ScreenshotCapturePanel / InvestmentWorkflowBar', '自动路径已实现；逐行纠错与最终确认待人工'],
  ['策略归类层', 'positionStrategyAssignmentService / PositionStrategyAssignmentPanel', `已实现；默认账户 ${e2e.realAccount.pendingAssignmentCount} 项待用户确认`],
  ['行业轮动与波动仓', 'rotationVolatilityStrategyService / RelativeRotation.tsx', '合同已实现；当前真实账户因未确认归类而受控阻断'],
  ['红利低波', 'dividendLowVolStrategyService / DividendLowVol.tsx', '普通/专家双轨已实现'],
  ['投资组合政策', 'alipayAllocationStrategy / Backtest portfolio workspace', '日期策略与确认门禁已实现'],
  ['统一复盘', 'scenarioComparisonService / Backtest.tsx', 'saved advice 三场景已实现；动态 point-in-time 待开发'],
  ['业务助手与审计', 'FamsChatBox / famsChatService / Operation / evidenceRefs', '入口与结果联动已实现；LLM 失败时只允许确定性事实回退'],
  ['交易边界', 'permissionState / trade gate / strict readiness', '四锁 false；不创建订单、不自动交易'],
]

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FAMS 三类资产策略与统一复盘自动化验收报告</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#5d687a;--line:#dfe4ec;--panel:#fff;--bg:#f4f7fa;--navy:#16324f;--blue:#2563eb;--green:#16794c;--amber:#a45b00;--red:#b42318}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.65 Inter,"PingFang SC","Microsoft YaHei",sans-serif;letter-spacing:0}.wrap{width:min(1240px,calc(100% - 32px));margin:auto}.hero{background:#fff;border-bottom:1px solid var(--line);padding:38px 0 30px}.eyebrow{color:var(--blue);font-weight:700}.hero h1{margin:8px 0;font-size:clamp(26px,4vw,42px);line-height:1.2}.hero p{max-width:900px;color:var(--muted);font-size:16px}.badges{display:flex;flex-wrap:wrap;gap:8px}.badge{border-radius:6px;padding:5px 9px;font-weight:700}.pass{background:#e8f7ef;color:var(--green)}.block{background:#fff2df;color:var(--amber)}.pending{background:#edf2ff;color:#3547a8}.fail{background:#feeceb;color:var(--red)}main{padding:24px 0 56px}.section{margin:18px 0;padding:22px;background:var(--panel);border:1px solid var(--line);border-radius:8px}.section h2{margin:0 0 14px;font-size:21px}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.metric{padding:16px;border-left:3px solid var(--blue);background:#f8fafc}.metric strong{display:block;font-size:24px}.notice{padding:14px 16px;border:1px solid #f1c27d;background:#fff8ea;border-radius:6px}.danger{border-color:#f0aaa4;background:#fff4f3}.table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;min-width:900px}th,td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:#f7f9fc;color:#3f4b5e}.journey{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.journey article{padding:16px;border:1px solid var(--line);border-radius:6px}.screens{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.shot{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#fff}.shot img{display:block;width:100%;max-height:620px;object-fit:contain;background:#edf1f5}.shot figcaption{padding:10px}.mono{font-family:ui-monospace,SFMono-Regular,Consolas,monospace;word-break:break-all}.small{font-size:12px;color:var(--muted)}details{margin-top:10px}summary{cursor:pointer;font-weight:700}@media(max-width:900px){.grid,.journey,.screens{grid-template-columns:1fr 1fr}}@media(max-width:620px){.wrap{width:min(100% - 20px,1240px)}.grid,.journey,.screens{grid-template-columns:1fr}.section{padding:16px}.hero{padding:28px 0}table{min-width:760px}}
</style></head><body>
<header class="hero"><div class="wrap"><div class="eyebrow">WF-7 · 真实数据 / Headless Chromium / PRD 逐项追踪</div><h1>三类资产策略与统一复盘自动化验收报告</h1><p>本报告只声明已由代码、真实本地数据、接口合同和本轮浏览器证据证明的内容。人工策略归类、截图逐行确认和动态 point-in-time 重算没有被伪装成已完成；正式交易始终锁定。</p><div class="badges"><span class="badge ${automatedStagePassed ? 'pass' : 'fail'}">自动化阶段：${automatedStagePassed ? '通过' : '未通过'}</span><span class="badge pending">人工验收：待集中执行</span><span class="badge block">PRD 全量：尚未完成</span><span class="badge pass">交易权限：四锁为 false</span></div></div></header>
<main class="wrap">
<section class="section"><h2>1. 管理层结论</h2><div class="grid"><div class="metric"><span>命令验收</span><strong>${commandAudit.results.length}/${commandAudit.expectedCommandCount}</strong><small>${escapeHtml(commandAudit.status)}</small></div><div class="metric"><span>浏览器视口</span><strong>${e2e.viewports.length}/3</strong><small>1440 / 768 / 390</small></div><div class="metric"><span>PRD 条目</span><strong>${traceability.length}</strong><small>${counts.PASS || 0} 自动通过</small></div><div class="metric"><span>真实账户</span><strong>${e2e.realAccount.openPositionCount}</strong><small>${e2e.realAccount.transactionCount} 条真实流水</small></div></div><p class="notice"><strong>诚实边界：</strong>默认账户仍有 ${e2e.realAccount.pendingAssignmentCount} 项策略归类等待用户确认，因此轮动策略页面显示受控阻断；动态 <code>point_in_time_simulation</code> 尚未实现并被服务明确拒绝。WF-7 通过仅代表文档已支撑的自动化范围通过，不代表 PRD 全量或正式交易完成。</p></section>
<section class="section"><h2>2. 当前架构与目标架构</h2><div class="table-wrap"><table><thead><tr><th>分层</th><th>强关联代码实体</th><th>当前真实状态</th></tr></thead><tbody>${architectureRows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></section>
<section class="section"><h2>3. 用户体验路径</h2><div class="journey"><article><strong>路径 A：基本信息确认</strong><p>资产管理 → 选择账户来源 → 上传截图 → 识别与逐行纠错 → 用户确认 → 查看行情和研究输入。</p><span class="badge pending">最终确认待人工</span></article><article><strong>路径 B：仓位策略</strong><p>仓位管理 → 查看系统归类理由 → 用户确认策略 → 进入轮动 / 红利 / 组合研究 → 查看人工计划和失效条件。</p><span class="badge pending">${e2e.realAccount.pendingAssignmentCount} 项待确认</span></article><article><strong>路径 C：回测复盘</strong><p>策略回测 → 选择真实历史建议 → 运行三场景 → 对比收益、回撤、事件和数据证据 → 返回 ChatBox 解释。</p><span class="badge pass">saved advice 已自动验证</span></article></div></section>
<section class="section"><h2>4. PRD 逐项追踪</h2><div class="table-wrap"><table><thead><tr><th>ID</th><th>规格</th><th>实现实体</th><th>验收</th><th>证据</th><th>状态</th></tr></thead><tbody>${traceability.map((row) => `<tr>${row.slice(0,5).map((value) => `<td>${escapeHtml(value)}</td>`).join('')}<td><span class="badge ${row[5] === 'PASS' ? 'pass' : row[5] === 'HUMAN_PENDING' ? 'pending' : row[5] === 'CONTROLLED_BLOCK' ? 'block' : 'fail'}">${statusLabel[row[5]]}</span></td></tr>`).join('')}</tbody></table></div></section>
<section class="section"><h2>5. 自动命令与交易边界</h2><div class="table-wrap"><table><thead><tr><th>命令</th><th>预期</th><th>退出码</th><th>结果</th><th>耗时</th></tr></thead><tbody>${commandAudit.results.map((item) => `<tr><td class="mono">${escapeHtml(item.command)}</td><td>${escapeHtml(item.expectedOutcome)}</td><td>${escapeHtml(item.exitCode)}</td><td><span class="badge ${item.status === 'failed' ? 'fail' : item.status === 'expected_blocked' ? 'block' : 'pass'}">${escapeHtml(item.status)}</span></td><td>${Math.round(item.durationMs / 1000)}s</td></tr>`).join('')}</tbody></table></div><p class="notice danger"><strong>交易边界解释：</strong><code>test:trade-action-readiness</code> 预期以退出码 1 阻断。该结果只证明严格 gate 没有被绕过，绝不表示正式交易准备就绪。formalTradingUnlocked=false，autoTradeUnlocked=false，canCreateOrder=false，orderCreateAllowed=false。</p></section>
<section class="section"><h2>6. 本轮真实浏览器截图</h2><p>以下 ${screenshotCards.length} 张图片由本轮 Headless Chromium 直接访问运行中前端生成，不是静态 mock。可打开原图核对页面文案、数据状态和交互结果。</p><div class="screens">${screenshotCards.map((item) => { const rel = path.relative(stageDir, path.resolve(root, item.screenshot)).replaceAll(path.sep, '/'); return `<figure class="shot"><a href="${escapeHtml(rel)}" target="_blank"><img src="${escapeHtml(rel)}" alt="${escapeHtml(item.viewport)} ${escapeHtml(item.step)}"></a><figcaption><strong>${escapeHtml(item.viewport)} · ${escapeHtml(item.step)}</strong><div class="small mono">${escapeHtml(item.screenshot)}</div></figcaption></figure>` }).join('')}</div></section>
<section class="section"><h2>7. 已知限制与待人工核验</h2><ul><li>截图识别的逐行纠错与最终确认必须由用户完成，自动化不能代签。</li><li>默认账户 ${e2e.realAccount.pendingAssignmentCount} 项策略归类尚未确认；当前阻断是正确行为。</li><li>动态 point-in-time 策略逐日重算尚未实现；服务已改为明确 insufficient，不允许借用 saved replay 冒充。</li><li>免费行情只声明“最新可得”；当前真实回放 provider 为 ${escapeHtml(wf5.realData.providers.join(', '))}，观察截止 ${escapeHtml(wf5.realData.observedThrough)}。</li><li>LLM provider 不可用时，只允许确定性摘要回退；不得把 DeepSeek 402 写成 LLM 成功。</li></ul></section>
<section class="section"><h2>8. 证据完整性</h2><details open><summary>核心文件 SHA-256</summary><div class="table-wrap"><table><thead><tr><th>文件</th><th>大小</th><th>SHA-256</th></tr></thead><tbody>${evidenceManifest.map((item) => `<tr><td class="mono">${escapeHtml(item.file)}</td><td>${item.bytes}</td><td class="mono">${item.sha256}</td></tr>`).join('')}</tbody></table></div></details><details><summary>历史阶段事实摘要</summary><pre>${escapeHtml(JSON.stringify({ wf1Status: wf1.status, wf2Status: wf2.status, wf3Status: wf3.status, wf4Status: wf4.status, wf5Status: wf5.status, wf6Status: wf6.status }, null, 2))}</pre></details></section>
</main></body></html>`

await writeFile(path.join(stageDir, 'investment-workflow-acceptance-report.html'), html)
console.log(JSON.stringify({
  status: automatedStagePassed ? 'passed_with_disclosures' : 'failed',
  report: path.relative(root, path.join(stageDir, 'investment-workflow-acceptance-report.html')),
  traceability: path.relative(root, path.join(evidenceDir, 'wf7-prd-traceability.json')),
  screenshotCount: screenshotCards.length,
  counts,
}, null, 2))
if (!automatedStagePassed) process.exitCode = 1
