import { strict as assert } from 'node:assert'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { famsChatService } from '../src/services/chat/famsChatService.js'
import { positionService } from '../src/services/position/positionService.js'

async function main() {
  const userId = process.env.FAMS_ACCEPTANCE_USER_ID || 'default'
  const summary = await positionService.getPositionSummary(userId)
  const before = await prisma.operation.count({ where: { userId } })
  const holdings = await famsChatService.sendMessage({ userId, message: '查看当前持仓摘要' })
  const afterRead = await prisma.operation.count({ where: { userId } })
  assert.equal(holdings.intent, 'portfolio_summary')
  assert.equal(holdings.requiresConfirmation, false)
  assert.equal(afterRead, before, 'read-only holdings query must not create an operation')
  assert.equal(holdings.structuredResult?.resultType, 'portfolio_summary')
  assert.ok(holdings.reply.includes(String(summary.positionsCount)))
  assert.ok(holdings.reply.includes(summary.totalValue.toFixed(2)))
  assert.ok(holdings.reply.includes('估值截止时间'))

  const reviewPreview = await famsChatService.sendMessage({
    userId,
    conversationId: holdings.conversationId,
    message: '现在生成一次当前持仓复盘',
  })
  const afterPreview = await prisma.operation.count({ where: { userId } })
  assert.equal(reviewPreview.intent, 'daily_review_run')
  assert.equal(reviewPreview.requiresConfirmation, true)
  assert.equal(afterPreview, before, 'unconfirmed review must not create an operation')

  const frontendSource = await readFile(resolve(process.cwd(), '..', 'frontend', 'src', 'components', 'chat', 'FamsChatBox.tsx'), 'utf8')
  assert.ok(frontendSource.includes("title: '查看当前持仓'"))
  assert.ok(frontendSource.includes('研究助手，不创建订单'))
  assert.ok(frontendSource.includes('sticky bottom-0'))
  assert.ok(frontendSource.includes('min-h-[320px] rounded-xl'))
  assert.ok(!frontendSource.includes('min-h-[320px] flex-1 overflow-y-auto'), 'main message area must not own a nested scrollbar')

  const audit = {
    schemaVersion: 'fams.a6.r2.chatbox_holdings_audit.v1',
    generatedAt: new Date().toISOString(),
    realData: true,
    userId,
    holdings: {
      positionsCount: summary.positionsCount,
      totalValue: summary.totalValue,
      priceFreshness: summary.priceFreshness,
      intent: holdings.intent,
      requiresConfirmation: holdings.requiresConfirmation,
      operationCreated: afterRead !== before,
    },
    reviewPreview: {
      intent: reviewPreview.intent,
      requiresConfirmation: reviewPreview.requiresConfirmation,
      operationCreated: afterPreview !== afterRead,
      confirmationIdPresent: reviewPreview.actionCards.some((card) => card.type === 'tool_confirmation' && Boolean(card.confirmationId)),
    },
    layout: {
      wholeDrawerScroll: true,
      nestedPrimaryMessageScroll: false,
      stickyComposer: true,
      compactTradeBoundary: true,
    },
    tradeBoundary: {
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
    overallStatus: 'passed',
  }
  assert.equal(audit.reviewPreview.confirmationIdPresent, true)
  const output = resolve(process.cwd(), '..', 'docs', 'automation-audits', 'a6-feedback-remediation', 'R2', 'chatbox-holdings-audit.json')
  await mkdir(resolve(output, '..'), { recursive: true })
  await writeFile(output, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ overallStatus: audit.overallStatus, totalValue: summary.totalValue, beforeOperations: before, afterOperations: afterPreview }))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => prisma.$disconnect())
