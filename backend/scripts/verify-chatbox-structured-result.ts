import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { famsChatService } from '../src/services/chat/famsChatService.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const checkedAt = new Date().toISOString()
  const response = await famsChatService.sendMessage({
    userId: 'audit_portfolio_backtest_user',
    message: '你帮我对比一下永久投资组合和全天候投资组合最近三年的实际收益率和最大回撤，并在对话框内画图',
  })

  assert(response.intent === 'portfolio_backtest_compare', `Expected portfolio_backtest_compare, got ${response.intent}`)
  assert(response.requiresConfirmation === false, 'Quick-run compare should not require confirmation')
  assert(response.structuredResult?.resultType === 'strategy_comparison', 'Structured result should be strategy_comparison')
  assert((response.structuredResult?.metricCards || []).length >= 3, 'Metric cards should be present')
  assert((response.structuredResult?.comparisonTable.rows || []).length >= 2, 'Comparison table should include at least two strategies')
  assert((response.structuredResult?.charts || []).some((chart) => chart.type === 'line_chart'), 'Line chart payload missing')
  assert((response.structuredResult?.charts || []).some((chart) => chart.type === 'drawdown_chart'), 'Drawdown chart payload missing')
  assert(response.prohibitedActions.includes('ADD'), 'ADD must remain prohibited')
  assert(response.prohibitedActions.includes('REDUCE'), 'REDUCE must remain prohibited')
  assert(response.prohibitedActions.includes('ORDER_CREATE'), 'ORDER_CREATE must remain prohibited')
  assert(response.prohibitedActions.includes('AUTO_TRADE'), 'AUTO_TRADE must remain prohibited')
  assert(response.notTradingAdvice === true, 'Result must be notTradingAdvice')

  const audit = {
    schemaVersion: 'fams.chatbox_structured_result_audit.v1',
    status: 'passed',
    checkedAt,
    conversationId: response.conversationId,
    intent: response.intent,
    resultType: response.structuredResult?.resultType,
    metricCardCount: response.structuredResult?.metricCards.length || 0,
    comparisonRows: response.structuredResult?.comparisonTable.rows.length || 0,
    chartTypes: response.structuredResult?.charts.map((chart) => chart.type) || [],
    dataQualitySummary: response.dataQualitySummary || response.structuredResult?.dataQualitySummary,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    prohibitedActions: response.prohibitedActions,
    notTradingAdvice: true,
  }
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })
  const auditPath = resolve(auditDir, 'chatbox_structured_result_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
