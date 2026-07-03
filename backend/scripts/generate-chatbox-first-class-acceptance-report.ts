import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { famsChatService } from '../src/services/chat/famsChatService.js'
import { seedPortfolioBacktestAuditHoldings } from './seed-portfolio-backtest-audit-holdings.js'

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function renderRows(rows: Array<Record<string, any>>) {
  if (!rows.length) return '<p class="muted">无表格行。</p>'
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))))
  return [
    '<table>',
    '<thead><tr>',
    ...columns.map((column) => `<th>${escapeHtml(column)}</th>`),
    '</tr></thead>',
    '<tbody>',
    ...rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column])}</td>`).join('')}</tr>`),
    '</tbody></table>',
  ].join('')
}

function responseSection(title: string, response: Awaited<ReturnType<typeof famsChatService.sendMessage>>) {
  const structured = response.structuredResult
  const metricRows = structured?.metricCards?.map((card) => ({
    label: card.label,
    value: card.value,
    status: card.status || 'neutral',
  })) || []
  const tableRows = structured?.comparisonTable?.rows || []
  const chartRows = structured?.charts?.map((chart) => ({
    type: chart.type,
    title: chart.title,
    series: chart.series.length,
    points: chart.series.reduce((sum, series) => sum + series.data.length, 0),
  })) || []
  return `
    <section>
      <h2>${escapeHtml(title)}</h2>
      <div class="meta">
        <span>Intent: ${escapeHtml(response.intent)}</span>
        <span>Confirmation: ${response.requiresConfirmation ? 'required' : 'not required'}</span>
        <span>NotTradingAdvice: ${response.notTradingAdvice}</span>
      </div>
      <p class="reply">${escapeHtml(response.reply).replaceAll('\n', '<br/>')}</p>
      <h3>指标卡</h3>
      ${renderRows(metricRows)}
      <h3>对比表</h3>
      ${renderRows(tableRows)}
      <h3>图表 Payload 证据</h3>
      ${renderRows(chartRows)}
      <h3>阻断与禁止动作</h3>
      ${renderRows([{ blockedReasons: response.blockedReasons.join(', '), prohibitedActions: response.prohibitedActions.join(', ') }])}
    </section>
  `
}

function hasDataHealthBlocker(response: Awaited<ReturnType<typeof famsChatService.sendMessage>>) {
  const serialized = JSON.stringify({
    blockedReasons: response.blockedReasons,
    dataQualitySummary: response.dataQualitySummary || response.structuredResult?.dataQualitySummary,
    toolAudit: response.toolAudit,
  }).toLowerCase()
  return /chatbox_tool_execution_failed|data_health_attention_required|database disk image is malformed|sqlite|blocked/.test(serialized)
}

async function main() {
  const generatedAt = new Date().toISOString()
  await seedPortfolioBacktestAuditHoldings()
  const outDir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore', generatedAt.replace(/[:.]/g, '-'))
  await mkdir(outDir, { recursive: true })

  const candidate = await famsChatService.sendMessage({
    userId: 'default',
    message: '帮我看红利低波前三只候选',
  })
  const zone = await famsChatService.sendMessage({
    userId: 'default',
    message: '600887 现在处于什么买卖观察区间',
  })
  const backtest = await famsChatService.sendMessage({
    userId: 'audit_portfolio_backtest_user',
    message: '对比永久组合和全天候组合最近三年的收益和最大回撤并画图',
  })
  const operations = await famsChatService.sendMessage({
    userId: 'default',
    message: '查看最近任务状态',
  })
  const scan = await famsChatService.sendMessage({
    userId: 'default',
    message: '刷新红利低波扫描',
  })
  const blocked = await famsChatService.sendMessage({
    userId: 'default',
    message: '帮我直接正式买入红利低波前三只并自动下单',
  })

  const checks = [
    { id: 'red_low_vol_candidates', status: candidate.intent === 'dividend_low_vol_top_candidates' ? (hasDataHealthBlocker(candidate) ? 'blocked' : 'passed') : 'failed' },
    { id: 'single_symbol_zone', status: zone.intent === 'dividend_low_vol_trading_zone' ? (hasDataHealthBlocker(zone) ? 'blocked' : 'passed') : 'failed' },
    { id: 'portfolio_compare_chart_payload', status: backtest.structuredResult?.charts?.some((chart) => chart.type === 'line_chart') && backtest.structuredResult?.charts?.some((chart) => chart.type === 'drawdown_chart') ? 'passed' : 'failed' },
    { id: 'operation_status_query', status: operations.intent === 'operation_status' ? 'passed' : 'failed' },
    { id: 'scan_requires_confirmation', status: scan.requiresConfirmation ? 'passed' : 'failed' },
    { id: 'formal_trade_blocked', status: blocked.intent === 'trade_action_blocked' ? 'passed' : 'failed' },
    { id: 'order_create_still_prohibited', status: blocked.prohibitedActions.includes('ORDER_CREATE') ? 'passed' : 'failed' },
    { id: 'auto_trade_still_prohibited', status: blocked.prohibitedActions.includes('AUTO_TRADE') ? 'passed' : 'failed' },
  ]
  const status = checks.every((check) => check.status === 'passed') ? 'passed' : checks.some((check) => check.status === 'failed') ? 'failed' : 'blocked'
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>FAMS ChatBox 第一业务入口自动化验收报告</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; background: #f6f8fb; }
    header { background: #102033; color: white; padding: 28px 40px; }
    main { padding: 28px 40px 60px; max-width: 1180px; margin: 0 auto; }
    section { background: white; border: 1px solid #d9e2ef; border-radius: 8px; padding: 20px; margin: 18px 0; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.06); }
    h1, h2, h3 { margin: 0 0 12px; }
    h2 { color: #102033; }
    h3 { color: #475569; margin-top: 18px; font-size: 15px; }
    .status { display: inline-block; padding: 4px 10px; border-radius: 999px; background: ${status === 'passed' ? '#dcfce7' : '#fee2e2'}; color: ${status === 'passed' ? '#166534' : '#991b1b'}; font-weight: 700; }
    .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .meta span { padding: 4px 8px; border-radius: 6px; background: #eef2ff; color: #334155; font-size: 12px; }
    .reply { background: #f8fafc; border-left: 4px solid #3b82f6; padding: 12px; color: #334155; }
    table { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 13px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f1f5f9; color: #334155; }
    .muted { color: #64748b; }
    .warning { background: #fff7ed; border-color: #fdba74; }
    code { background: #eef2ff; padding: 2px 5px; border-radius: 4px; }
  </style>
</head>
<body>
  <header>
    <h1>FAMS ChatBox 第一业务入口自动化验收报告</h1>
    <p>生成时间：${escapeHtml(generatedAt)} ｜ 状态：<span class="status">${escapeHtml(status)}</span></p>
  </header>
  <main>
    <section>
      <h2>验收结论</h2>
      <p>本报告使用后端 ChatBox 服务真实执行用户路径，验证红利低波查询、单票观察区间、组合策略三年对比图表、任务查询、扫描确认和交易阻断。若真实数据或数据库健康阻断某条路径，报告会标记 blocked，不伪称通过。报告不声明正式交易可用。</p>
      ${renderRows(checks)}
    </section>
    <section class="warning">
      <h2>交易边界</h2>
      <p><code>formalTradingUnlocked=false</code>，<code>autoTradeUnlocked=false</code>，<code>canCreateOrder=false</code>，<code>orderCreateAllowed=false</code>。ChatBox 只能用于研究、比较、观察、提醒和人工计划草案。</p>
    </section>
    ${responseSection('路径 1：红利低波前三候选', candidate)}
    ${responseSection('路径 2：600887 买卖观察区间', zone)}
    ${responseSection('路径 3：永久组合 vs 全天候组合三年回测并画图', backtest)}
    ${responseSection('路径 4：任务状态查询', operations)}
    ${responseSection('路径 5：红利低波扫描需要确认', scan)}
    ${responseSection('路径 6：正式交易动作阻断', blocked)}
  </main>
</body>
</html>`
  const reportPath = resolve(outDir, 'acceptance-report.html')
  await writeFile(reportPath, html, 'utf8')
  const audit = {
    schemaVersion: 'fams.chatbox_acceptance_report_audit.v1',
    status,
    generatedAt,
    reportPath,
    checks,
    conversations: {
      candidate: candidate.conversationId,
      zone: zone.conversationId,
      backtest: backtest.conversationId,
      operations: operations.conversationId,
      scan: scan.conversationId,
      blocked: blocked.conversationId,
    },
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    notTradingAdvice: true,
  }
  const auditPath = resolve(outDir, 'acceptance_report_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
