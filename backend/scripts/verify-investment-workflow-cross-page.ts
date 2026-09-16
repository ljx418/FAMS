import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { famsChatService } from '../src/services/chat/famsChatService.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const userId = 'default'
  const before = {
    positions: await prisma.position.count({ where: { userId } }),
    transactions: await prisma.transaction.count({ where: { userId } }),
  }
  const quick = await famsChatService.sendMessage({
    userId,
    message: '请比较永久组合和全天候组合最近三年的真实收益率与最大回撤并绘图',
  })
  assert(quick.intent === 'portfolio_backtest_compare', `unexpected quick intent: ${quick.intent}`)
  assert(quick.structuredResult?.resultType === 'strategy_comparison', 'quick run must return strategy comparison')
  assert(quick.structuredResult.charts.some((chart) => chart.type === 'line_chart'), 'line chart missing')
  assert(quick.structuredResult.charts.some((chart) => chart.type === 'drawdown_chart'), 'drawdown chart missing')
  assert(quick.actionCards.some((card) => card.href === '/backtest?mode=portfolio'), 'unified portfolio backtest route missing')
  assert(quick.structuredResult.evidenceRefs.length > 0, 'quick run evidence refs missing')

  const pending = await famsChatService.sendMessage({
    userId,
    message: '创建一个永久组合对比全天候组合最近三年的持久化回测任务',
  })
  assert(pending.intent === 'portfolio_backtest_operation', `unexpected operation intent: ${pending.intent}`)
  assert(pending.requiresConfirmation === true, 'persistent run must require confirmation')
  const confirmationId = pending.actionCards.find((card) => card.type === 'tool_confirmation')?.confirmationId
  assert(confirmationId, 'confirmation id missing')
  const confirmed = await famsChatService.confirmTool({
    userId,
    conversationId: pending.conversationId,
    confirmationId,
  })
  assert(confirmed.operationId, 'confirmed run operation id missing')
  assert(confirmed.artifactRefs.length > 0, 'confirmed run artifact refs missing')
  assert(confirmed.structuredResult?.resultType === 'strategy_comparison', 'confirmed run structured result missing')
  assert(
    JSON.stringify(quick.structuredResult.comparisonTable.rows) === JSON.stringify(confirmed.structuredResult.comparisonTable.rows),
    'page/chat quick and operation comparison conclusions diverged',
  )
  const operation = await prisma.operation.findUnique({ where: { id: confirmed.operationId } })
  assert(operation?.status === 'succeeded' && operation.createdBy === 'chatbox', 'chat operation persistence mismatch')
  const session = await famsChatService.getSessionSnapshot(pending.conversationId)
  assert(session.status === 'audited', 'chat session audit missing')

  const after = {
    positions: await prisma.position.count({ where: { userId } }),
    transactions: await prisma.transaction.count({ where: { userId } }),
  }
  assert(after.positions === before.positions, 'cross-page/chat workflow changed positions')
  assert(after.transactions === before.transactions, 'cross-page/chat workflow changed transactions')
  assert(confirmed.prohibitedActions.includes('ORDER_CREATE') && confirmed.prohibitedActions.includes('AUTO_TRADE'), 'trade prohibition missing')

  const audit = {
    schemaVersion: 'fams.investment-workflow.cross-page-chatbox-audit.v1',
    status: 'passed',
    generatedAt: new Date().toISOString(),
    realData: {
      userId,
      quickRunEvidenceRefCount: quick.structuredResult.evidenceRefs.length,
      comparisonRows: quick.structuredResult.comparisonTable.rows,
      chartTypes: quick.structuredResult.charts.map((chart) => chart.type),
      operationId: confirmed.operationId,
      artifactRefs: confirmed.artifactRefs,
      conversationId: pending.conversationId,
    },
    gates: {
      unifiedBacktestRoute: true,
      pageAndChatConclusionConsistent: true,
      operationPersistedAndAudited: true,
      positionsUnchanged: true,
      transactionsUnchanged: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }
  const evidenceDir = resolve(process.cwd(), '..', 'docs', 'automation-audits', 'investment-workflow', 'WF-6', 'evidence')
  await mkdir(evidenceDir, { recursive: true })
  await writeFile(resolve(evidenceDir, 'wf6-chatbox-linkage-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(audit, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
