import assert from 'node:assert/strict'
import {
  assertTradeBoundaryLocked,
  checkedAtIso,
  createNextStageAuditDir,
  runNextStagePortfolioBacktest,
  writeAuditText,
} from './lib/nextStagePortfolioBacktestScenario.js'

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function statusClass(status: string) {
  if (status === 'passed' || status === 'ready_for_paper_review') return 'ok'
  if (status === 'blocked' || status === 'missing' || status === 'insufficient') return 'warn'
  return 'neutral'
}

async function main() {
  const checkedAt = checkedAtIso()
  const auditDir = await createNextStageAuditDir(checkedAt)
  const result = await runNextStagePortfolioBacktest()
  assertTradeBoundaryLocked(result)

  const releaseGate = result.releaseGateAudit
  assert.ok(releaseGate, 'releaseGateAudit missing')

  const rows = [
    ['S2 数据治理', result.dataGovernanceAudit?.status || 'missing', (result.dataGovernanceAudit?.blockers || []).join(', ')],
    ['S3 Benchmark', result.benchmarkQualificationAudit?.status || 'missing', (result.benchmarkQualificationAudit?.blockers || []).join(', ')],
    ['S4 Formal validation', result.formalValidationAudit?.status || 'missing', (result.formalValidationAudit?.blockers || []).slice(0, 8).join(', ')],
    ['S5 人工签核', result.manualSignoffAudit?.status || 'missing', (result.manualSignoffAudit?.blockers || []).slice(0, 8).join(', ')],
    ['S6 执行隔离', result.executionIsolationAudit?.status || 'missing', (result.executionIsolationAudit?.blockers || []).join(', ')],
    ['S7 Release gate', releaseGate.status, (releaseGate.blockers || []).slice(0, 10).join(', ')],
  ]

  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>FAMS 下一阶段受控自动化验收报告</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f7f9; color: #18202a; }
    main { max-width: 1180px; margin: 0 auto; padding: 32px; }
    h1 { font-size: 30px; margin: 0 0 8px; }
    h2 { font-size: 20px; margin-top: 28px; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 24px 0; }
    .card { background: #fff; border: 1px solid #dfe4ea; border-radius: 10px; padding: 16px; box-shadow: 0 8px 24px rgba(25, 33, 43, 0.06); }
    .label { color: #617083; font-size: 13px; }
    .value { font-size: 20px; font-weight: 700; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #dfe4ea; border-radius: 10px; overflow: hidden; }
    th, td { text-align: left; padding: 12px 14px; border-bottom: 1px solid #edf0f3; vertical-align: top; }
    th { background: #eef3f8; color: #324254; font-size: 13px; }
    .ok { color: #0f7a46; font-weight: 700; }
    .warn { color: #9a5a00; font-weight: 700; }
    .neutral { color: #465566; font-weight: 700; }
    code { background: #eef3f8; padding: 2px 6px; border-radius: 6px; }
    .note { line-height: 1.65; color: #3c4856; }
  </style>
</head>
<body>
<main>
  <h1>FAMS 下一阶段受控自动化验收报告</h1>
  <p class="note">生成时间：${escapeHtml(checkedAt)}。本报告验证 S2-S7 受控开发证据链存在且交易边界保持锁定；不声明正式交易 release 通过。</p>
  <section class="summary">
    <div class="card"><div class="label">Release gate</div><div class="value ${statusClass(releaseGate.status)}">${escapeHtml(releaseGate.status)}</div></div>
    <div class="card"><div class="label">Formal trading</div><div class="value">locked</div></div>
    <div class="card"><div class="label">Order create</div><div class="value">blocked</div></div>
    <div class="card"><div class="label">Advice mode</div><div class="value">research</div></div>
  </section>
  <h2>子阶段状态</h2>
  <table>
    <thead><tr><th>阶段</th><th>状态</th><th>阻断/说明</th></tr></thead>
    <tbody>
      ${rows.map(([stage, status, blockers]) => `<tr><td>${escapeHtml(stage)}</td><td class="${statusClass(status)}">${escapeHtml(status)}</td><td>${escapeHtml(blockers || 'none')}</td></tr>`).join('\n')}
    </tbody>
  </table>
  <h2>交易边界</h2>
  <div class="card note">
    <p><code>formalTradingUnlocked=false</code>，<code>autoTradeUnlocked=false</code>，<code>canCreateOrder=false</code>，<code>orderCreateAllowed=false</code>。</p>
    <p>禁止动作保持：${escapeHtml((result.prohibitedActions || []).join(' / '))}。</p>
  </div>
  <h2>验收评价</h2>
  <div class="card note">
    <p>受控自动化开发证据链可运行；当前真实数据仍暴露数据治理、正式 benchmark、formal validation 和人工签核 blocker。该结果符合“不得虚假验收”和“正式交易仍 locked”的阶段边界。</p>
  </div>
</main>
</body>
</html>`

  const summary = `# SUMMARY_FOR_GPT

GeneratedAt: ${checkedAt}

Status: controlled_acceptance_report_generated

ReleaseGateStatus: ${releaseGate.status}

FormalTradingUnlocked: false

AutoTradeUnlocked: false

CanCreateOrder: false

OrderCreateAllowed: false

SubstageStatuses:
${rows.map(([stage, status, blockers]) => `- ${stage}: ${status}${blockers ? `; blockers=${blockers}` : ''}`).join('\n')}

Conclusion: S2-S7 controlled automation evidence exists and blockers remain explicit. This is not a formal trading release.
`

  const reportPath = await writeAuditText(auditDir, 'acceptance-report.html', html)
  const summaryPath = await writeAuditText(auditDir, 'SUMMARY_FOR_GPT.md', summary)
  console.log(JSON.stringify({
    schemaVersion: 'fams.next_stage.acceptance_report_generation.v1',
    status: 'passed',
    checkedAt,
    reportPath,
    summaryPath,
    releaseGateStatus: releaseGate.status,
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
