import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(import.meta.dirname, '..')
const repoRoot = resolve(packageRoot, '../..')
export const outputPath = resolve(repoRoot, 'docs/generated/v2-px-human-acceptance.html')

export const scenarios = [
  {
    id: 'AC-PX-01', title: '首次连接',
    prerequisites: ['Chrome 已加载 FAMS External Brain 扩展', '本地 FAMS 3000/4000 已启动', '尚未授予本地后端权限'],
    steps: ['打开 Side Panel。', '点击“连接本地 FAMS”。', '只确认 localhost/127.0.0.1:4000 权限并观察连接结果。', '记录权限弹窗与连接后摘要。'],
    threshold: '安装默认 host 权限为空；只申请 4000；授权后健康检查成功；无 <all_urls>；页面明确说明本地访问范围。',
    evidence: ['PX1 real-chrome-evidence.json', 'PX3 caller-policy-audit.json', 'production manifest.json'],
  },
  {
    id: 'AC-PX-02', title: '快速提问',
    prerequisites: ['Side Panel 已连接', 'FAMS 中存在真实本地研究数据'],
    steps: ['输入一个与当前真实研究上下文有关的问题。', '点击“发送问题”并观察接收提示。', '等待最终摘要或明确阻断。', '核对结论、依据、数据时间和下一步。'],
    threshold: '1 秒内出现 ack；35 秒内出现最终摘要或 failed/blocked/unknown_result；不显示原始异常；不会自动发送第二次 POST。',
    evidence: ['PX3 workspace/sidepanel Chrome evidence', 'PX5 idempotency audit', 'PX5-02 polling evidence'],
  },
  {
    id: 'AC-PX-03', title: '打开与复用工作台',
    prerequisites: ['Side Panel 已有当前工作区和真实摘要'],
    steps: ['连续点击“在完整工作台打开”20 次。', '观察 Chrome 标签页数量。', '切换到另一个窗口后再点击一次。'],
    threshold: '同 workspace 只保留一个匹配标签；重复 operation 为 0；已有标签在 1 秒内被聚焦。',
    evidence: ['PX5 router-idempotency-evidence.json', 'multi-window-tab-audit.json'],
  },
  {
    id: 'AC-PX-04', title: '从 FAMS 三处跳转',
    prerequisites: ['FAMS ChatBox、Daily Review、Operations 页面可访问', '扩展 ID 已配置'],
    steps: ['分别从 ChatBox、Daily Review、Operations 点击“在外部大脑打开”。', '核对目标 Workspace 与来源对象。', '临时移除扩展 ID 后再次操作并观察降级说明。'],
    threshold: '三入口业务对象、canonical key/correlation 一致且 routeId 可追溯；查看来源进入 Workspace；缺扩展时给配置说明而非原始异常。',
    evidence: ['PX4B host-bridge-evidence.json', 'entry-matrix-audit.json', '三处 Host 截图'],
  },
  {
    id: 'AC-PX-05', title: '五类研究视图',
    prerequisites: ['FAMS 中存在 review、operation 和 artifact'],
    steps: ['依次进入来源库、来源详情、快速问答、任务追踪、关系图谱。', '每个视图核对数据时间、可信状态和下一步。', '对无数据条件确认显示 empty。'],
    threshold: '5/5 视图使用真实 read model；无数据时明确 empty；没有 mock 内容或复制投资计算。',
    evidence: ['PX3 workspace-chrome-evidence.json', 'PX5 route matrix', 'PX2 API contract report'],
  },
  {
    id: 'AC-PX-06', title: '四个视口与可访问性',
    prerequisites: ['Side Panel 与 Workspace 已加载真实数据'],
    steps: ['分别在 360/420 宽度检查 Side Panel。', '分别在 768/1280 宽度检查 Workspace。', '只用 Tab/Shift+Tab 走过核心控件并观察焦点。'],
    threshold: '无根级横向溢出；关键动作可见；控件至少 44×44；正文对比度至少 4.5:1；焦点可见；console error 为 0。',
    evidence: ['PX6-01 accessibility-audit.json', '四视口截图', 'accessibility trace/network/console'],
  },
  {
    id: 'AC-PX-07', title: '生命周期与恢复',
    prerequisites: ['工作区已打开并定位到真实来源或任务'],
    steps: ['执行 Back、Forward、Refresh。', '关闭并重新打开工作台。', '观察 FAMS 断连重连。', '核对扩展 reload/update 后的恢复或阻断。'],
    threshold: '每个场景都在 5 秒内显示 restored 或明确 blocked；原索引不被静默清空；未知版本不伪装成功。',
    evidence: ['PX5-01 lifecycle recovery evidence', 'PX5-02 interruption/update evidence', 'storage audit'],
  },
  {
    id: 'AC-PX-08', title: '状态降级是否易懂',
    prerequisites: ['可以观察未连接、加载、空、失败、恢复和阻断状态'],
    steps: ['逐一观察六类状态的标题与说明。', '确认每个状态都有下一步。', '确认异常时没有旧结果被展示为新成功。'],
    threshold: '6/6 状态都有可读原因和具体下一步；伪 success 为 0；closed 不渲染成活动成功态。',
    evidence: ['PX3/PX4A state screenshots', 'PX5 lifecycle state audit'],
  },
  {
    id: 'AC-PX-09', title: '隐私与交易硬边界',
    prerequisites: ['使用脱敏本地账户完成以上路径'],
    steps: ['查看页面和导出的验收证据。', '确认没有 cookie、token、账户原图或完整问题正文。', '确认页面没有订单入口或交易解锁提示。'],
    threshold: '敏感字段/账户原图为 0；broker/order 请求为 0；Transaction 变更为 0；四个交易锁全部 false。',
    evidence: ['PX6-01 acceptance manifest/report', 'network/storage scans', 'trade-boundary audit'],
  },
  {
    id: 'AC-PX-10', title: '证据与防假绿',
    prerequisites: ['PX6-01 自动证据包已生成'],
    steps: ['从报告定位任一 gate、requirement、stage 和原始 artifact。', '核对 commit 与 SHA-256。', '查看删除文件、改 hash/commit、重复 gate、缺 requirement 等负例的失败记录。'],
    threshold: 'G1～G7 恰好七项且全绿；PX-REQ-001～020 恰好 20 项；所有负例必须失败；自动化不得冒充本次人工通过。',
    evidence: ['PX6-01 g1_g7_gate_audit.json', 'requirement_coverage.json', 'anti-false-green audit'],
  },
]

const escapeHtml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const list = (items, ordered = false) => `<${ordered ? 'ol' : 'ul'}>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`

export function renderHumanAcceptanceHtml() {
  const cards = scenarios.map((scenario) => `
    <article class="scenario" data-scenario-id="${scenario.id}">
      <div class="scenario-heading"><div><span class="scenario-id">${scenario.id}</span><h2>${escapeHtml(scenario.title)}</h2></div><span class="auto-pass">自动证据：已通过</span></div>
      <div class="grid"><section><h3>开始前</h3>${list(scenario.prerequisites)}</section><section><h3>你要做的操作</h3>${list(scenario.steps, true)}</section></div>
      <section class="threshold"><h3>人工出门门槛</h3><p>${escapeHtml(scenario.threshold)}</p></section>
      <details><summary>自动证据位置（用于复核，不代替你的判断）</summary>${list(scenario.evidence)}</details>
      <div class="review-grid">
        <label>你的结论<select data-field="status"><option value="not_run">尚未检查</option><option value="passed">通过</option><option value="failed">失败</option></select></label>
        <label>附上截图<input data-field="screenshots" type="file" accept="image/png,image/jpeg,image/webp" multiple><small>截图只在当前浏览器预览；导出 JSON 仅记录文件名，不上传文件。</small></label>
      </div>
      <div class="preview" data-preview aria-live="polite"></div>
      <label>备注<textarea data-field="notes" placeholder="记录看到的结果、失败位置或修复建议"></textarea></label>
    </article>`).join('')
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>V2-PX 人类验收清单</title>
<style>
:root{font-family:Inter,"Microsoft YaHei",system-ui,sans-serif;color:#172033;background:#eef3f9}*{box-sizing:border-box}body{margin:0}button,select,input,textarea,summary{font:inherit}button,select,input[type=file],summary{min-height:44px}:focus-visible{outline:3px solid #174ea6;outline-offset:3px}.shell{width:min(1120px,calc(100% - 28px));margin:0 auto;padding:28px 0 64px}.hero,.scenario,.summary-panel{background:#fff;border:1px solid #b9c7d9;border-radius:16px;box-shadow:0 8px 28px rgba(26,49,82,.08)}.hero{padding:26px;margin-bottom:18px}.eyebrow,.scenario-id{color:#174ea6;font-size:12px;font-weight:800;letter-spacing:.08em}.hero h1{margin:6px 0 10px;font-size:clamp(26px,4vw,40px)}.lead{font-size:17px;line-height:1.65}.warning{padding:14px;border-left:5px solid #b54708;background:#fff7ed;color:#6e2f05}.locks{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.lock,.auto-pass{padding:7px 10px;border-radius:999px;font-size:13px;font-weight:700}.lock{color:#7a271a;background:#fee4e2}.auto-pass{color:#14532d;background:#dcfce7}.summary-panel{position:sticky;top:8px;z-index:2;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px;padding:14px 18px;margin-bottom:18px}.summary-panel strong{font-size:16px}.actions{display:flex;flex-wrap:wrap;gap:8px}button{border:1px solid #174ea6;border-radius:10px;padding:9px 14px;color:#fff;background:#174ea6;font-weight:700;cursor:pointer}button.secondary{color:#174ea6;background:#fff}.scenario{padding:22px;margin:14px 0}.scenario-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.scenario h2{margin:4px 0 10px}.scenario h3{font-size:15px;margin:0 0 8px}.scenario li,.scenario p{line-height:1.6}.grid,.review-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.threshold{margin:12px 0;padding:14px;border:1px solid #9cb8df;border-radius:12px;background:#f1f6ff}details{margin:12px 0;border-top:1px solid #d5dfeb;border-bottom:1px solid #d5dfeb}summary{padding:11px 2px;color:#174ea6;font-weight:750;cursor:pointer}label{display:grid;gap:7px;color:#344054;font-weight:700}select,input[type=file],textarea{width:100%;border:1px solid #7d8da3;border-radius:9px;padding:10px;color:#172033;background:#fff}textarea{min-height:110px;resize:vertical}small{font-weight:400;line-height:1.45;color:#475467}.preview{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.preview figure{width:140px;margin:0}.preview img{display:block;width:140px;height:90px;object-fit:cover;border:1px solid #b9c7d9;border-radius:8px}.preview figcaption{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;color:#475467}.scenario[data-status=passed]{border-left:7px solid #16803d}.scenario[data-status=failed]{border-left:7px solid #b42318}.footer{margin-top:22px;color:#475467;line-height:1.6}@media(max-width:720px){.grid,.review-grid{grid-template-columns:1fr}.scenario-heading{display:block}.auto-pass{display:inline-block}.summary-panel{position:static}.shell{width:min(100% - 20px,1120px);padding-top:10px}}
</style></head><body><main class="shell">
<section class="hero"><p class="eyebrow">FAMS · V2-PX · PX6-02</p><h1>人类体验验收清单</h1><p class="lead">自动检查已完成；你的 10 项体验验收尚未开始；不会自动提交或解锁交易。</p><p class="warning"><strong>请不要把绿色“自动证据”当成人工通过。</strong>只有你亲自完成操作、选择结论并附上截图后，项目才可以评估是否成为产品化候选。</p><div class="locks"><span class="lock">正式交易：关闭</span><span class="lock">自动交易：关闭</span><span class="lock">创建订单：关闭</span><span class="lock">订单写入：关闭</span></div></section>
<section class="summary-panel" aria-live="polite"><strong id="summary">0/10 已检查 · 0 通过 · 0 失败</strong><div class="actions"><button id="export" type="button">导出验收 JSON</button><button id="reset" class="secondary" type="button">清空本地记录</button></div></section>
${cards}
<p class="footer">本页面不发送网络请求，不上传截图，不生成 reviewer 名称，也不会把未检查场景改成通过。页面状态只保存在当前浏览器 localStorage；请把导出的 JSON 与原始截图一并交回 Codex 复核。</p>
</main><script>
(()=>{const KEY='fams.v2-px.human-acceptance.v1';const cards=[...document.querySelectorAll('[data-scenario-id]')];let state={};try{state=JSON.parse(localStorage.getItem(KEY)||'{}')}catch{state={}};
const update=()=>{let checked=0,passed=0,failed=0;for(const card of cards){const id=card.dataset.scenarioId;const status=card.querySelector('[data-field=status]').value;card.dataset.status=status;if(status!=='not_run')checked++;if(status==='passed')passed++;if(status==='failed')failed++;state[id]={status,notes:card.querySelector('[data-field=notes]').value,screenshotNames:state[id]?.screenshotNames||[]}}document.querySelector('#summary').textContent=checked+'/10 已检查 · '+passed+' 通过 · '+failed+' 失败';localStorage.setItem(KEY,JSON.stringify(state))};
for(const card of cards){const id=card.dataset.scenarioId;const saved=state[id]||{};card.querySelector('[data-field=status]').value=saved.status||'not_run';card.querySelector('[data-field=notes]').value=saved.notes||'';card.querySelector('[data-field=status]').addEventListener('change',update);card.querySelector('[data-field=notes]').addEventListener('input',update);card.querySelector('[data-field=screenshots]').addEventListener('change',event=>{const files=[...event.target.files];state[id]={...(state[id]||{}),screenshotNames:files.map(file=>file.name)};const preview=card.querySelector('[data-preview]');preview.replaceChildren(...files.map(file=>{const figure=document.createElement('figure');const image=document.createElement('img');image.alt='待提交截图：'+file.name;image.src=URL.createObjectURL(file);const caption=document.createElement('figcaption');caption.textContent=file.name;figure.append(image,caption);return figure}));update()})}
document.querySelector('#export').addEventListener('click',()=>{update();const payload={schemaVersion:'fams.v2_px.human_acceptance_submission.v1',exportedAt:new Date().toISOString(),humanAcceptanceStatus:Object.values(state).every(item=>item.status==='passed')&&Object.keys(state).length===10?'passed':'in_progress',v2PxProductizationCandidate:false,tradeBoundary:{formalTradingUnlocked:false,autoTradeUnlocked:false,canCreateOrder:false,orderCreateAllowed:false},scenarios:cards.map(card=>({scenarioId:card.dataset.scenarioId,...state[card.dataset.scenarioId]}))};const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)+'\\n'],{type:'application/json'}));link.download='v2-px-human-acceptance.json';link.click();URL.revokeObjectURL(link.href)});
document.querySelector('#reset').addEventListener('click',()=>{if(!confirm('确认清空本页面的状态、备注和截图文件名？'))return;localStorage.removeItem(KEY);location.reload()});update()})();
</script></body></html>`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await mkdir(resolve(repoRoot, 'docs/generated'), { recursive: true })
  await writeFile(outputPath, renderHumanAcceptanceHtml(), 'utf8')
  console.log(outputPath)
}
