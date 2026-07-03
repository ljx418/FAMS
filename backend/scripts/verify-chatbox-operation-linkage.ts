import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { famsChatService } from '../src/services/chat/famsChatService.js'
import { seedPortfolioBacktestAuditHoldings } from './seed-portfolio-backtest-audit-holdings.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const checkedAt = new Date().toISOString()
  await seedPortfolioBacktestAuditHoldings()
  const pending = await famsChatService.sendMessage({
    userId: 'audit_portfolio_backtest_user',
    message: '创建一个永久组合对比全天候组合最近三年的持久化回测任务',
  })
  assert(pending.intent === 'portfolio_backtest_operation', `Expected portfolio_backtest_operation, got ${pending.intent}`)
  assert(pending.requiresConfirmation === true, 'Persistent backtest operation should require confirmation')
  const confirmationId = pending.actionCards.find((card) => card.type === 'tool_confirmation')?.confirmationId
  assert(confirmationId, 'Confirmation id missing')

  const confirmed = await famsChatService.confirmTool({
    userId: 'audit_portfolio_backtest_user',
    conversationId: pending.conversationId,
    confirmationId,
  })
  assert(confirmed.requiresConfirmation === false, 'Confirmed operation should not require another confirmation')
  assert(Boolean(confirmed.operationId), 'Confirmed operation should return operationId')
  assert((confirmed.artifactRefs || []).length > 0, 'Confirmed operation should return artifact refs')
  assert(confirmed.structuredResult?.resultType === 'strategy_comparison', 'Confirmed operation should include structured backtest result')

  const operation = await prisma.operation.findUnique({ where: { id: confirmed.operationId! } })
  assert(operation, 'Operation should be persisted')
  assert(operation?.createdBy === 'chatbox', 'Operation should be created by chatbox')
  assert(operation?.status === 'succeeded', `Operation should be succeeded, got ${operation?.status}`)

  const snapshot = await famsChatService.getSessionSnapshot(pending.conversationId)
  assert(snapshot.status === 'audited', 'Chat session should be audited')
  assert((snapshot.toolConfirmations || []).some((item: any) => item.status === 'confirmed'), 'Confirmed tool call should be audited')

  const audit = {
    schemaVersion: 'fams.chat_operation_linkage_audit.v1',
    status: 'passed',
    checkedAt,
    conversationId: pending.conversationId,
    operationId: confirmed.operationId,
    artifactRefs: confirmed.artifactRefs,
    persistedOperation: {
      id: operation?.id,
      type: operation?.type,
      status: operation?.status,
      createdBy: operation?.createdBy,
    },
    auditedConfirmationCount: snapshot.toolConfirmations?.length || 0,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
    prohibitedActions: confirmed.prohibitedActions,
    notTradingAdvice: true,
  }
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })
  const auditPath = resolve(auditDir, 'chat_operation_linkage_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
