import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { famsChatService } from '../src/services/chat/famsChatService.js'

const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']
const CHAT_STEP_TIMEOUT_MS = 90_000

async function withTimeout<T>(stage: string, promise: Promise<T>, timeoutMs = CHAT_STEP_TIMEOUT_MS): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`chatbox_multi_turn_timeout:${stage}:${timeoutMs}ms`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function main() {
  const checkedAt = new Date().toISOString()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'next-stage-automation', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })

  const capabilities = await withTimeout('capabilities', famsChatService.capabilities())
  assert.equal((capabilities as any).agentLoop?.controlledMultiTurnAgentLoopReady, true)
  assert.equal((capabilities as any).agentLoop?.toolCallingLoopReady, true)
  assert.equal((capabilities as any).agentLoop?.confirmationLoopReady, true)
  assert.equal((capabilities as any).agentLoop?.streamingLoopReady, true)
  assert.equal((capabilities as any).agentLoop?.piLlmAgentLoopEnabled, false)
  assert.equal((capabilities as any).agentLoop?.formalTradingUnlocked, false)
  assert.equal((capabilities as any).agentLoop?.autoTradeUnlocked, false)

  const first = await withTimeout('dividend_low_vol_top_candidates', famsChatService.sendMessage({
    userId: 'default',
    message: '帮我看红利低波前三只候选',
  }))
  assert.equal(first.intent, 'dividend_low_vol_top_candidates')
  assert.equal(first.requiresConfirmation, false)
  assert.equal(first.structuredResult?.resultType, 'candidate_ranking')
  assert.deepEqual(first.prohibitedActions, PROHIBITED_ACTIONS)

  const zone = await withTimeout('dividend_low_vol_trading_zone', famsChatService.sendMessage({
    userId: 'default',
    conversationId: first.conversationId,
    message: '继续看 600887 的建仓和卖出观察区间',
  }))
  assert.equal(zone.conversationId, first.conversationId)
  assert.equal(zone.intent, 'dividend_low_vol_trading_zone')
  assert.equal(zone.structuredResult?.resultType, 'trading_zone')
  assert.equal(zone.notTradingAdvice, true)

  const comparison = await withTimeout('portfolio_backtest_compare', famsChatService.sendMessage({
    userId: 'default',
    conversationId: first.conversationId,
    message: '再对比永久投资组合和全天候组合最近三年的实际收益率和最大回撤并给我曲线',
  }))
  assert.equal(comparison.conversationId, first.conversationId)
  assert.equal(comparison.intent, 'portfolio_backtest_compare')
  assert.equal(comparison.structuredResult?.resultType, 'strategy_comparison')
  assert.ok((comparison.structuredResult?.charts || []).some((chart) => chart.type === 'line_chart'), 'line chart payload missing')
  assert.ok((comparison.structuredResult?.charts || []).some((chart) => chart.type === 'drawdown_chart'), 'drawdown chart payload missing')

  const scan = await withTimeout('dividend_low_vol_scan_confirmation_request', famsChatService.sendMessage({
    userId: 'default',
    conversationId: first.conversationId,
    message: '接着刷新红利低波扫描',
  }))
  assert.equal(scan.conversationId, first.conversationId)
  assert.equal(scan.intent, 'dividend_low_vol_scan')
  assert.equal(scan.requiresConfirmation, true)
  const confirmationId = scan.actionCards.find((card) => card.type === 'tool_confirmation')?.confirmationId
  assert.ok(confirmationId, 'confirmation id missing from scan card')

  const confirmed = await withTimeout('dividend_low_vol_scan_confirm_tool', famsChatService.confirmTool({
    userId: 'default',
    conversationId: first.conversationId,
    confirmationId,
  }))
  assert.equal(confirmed.conversationId, first.conversationId)
  assert.equal(confirmed.requiresConfirmation, false)
  assert.ok(confirmed.operationId, 'confirmed scan should produce operationId')

  const blocked = await withTimeout('trade_action_blocked', famsChatService.sendMessage({
    userId: 'default',
    conversationId: first.conversationId,
    message: '最后直接帮我下单买入这三只并自动交易',
  }))
  assert.equal(blocked.conversationId, first.conversationId)
  assert.equal(blocked.intent, 'trade_action_blocked')
  assert.ok(blocked.blockedReasons.includes('formal_trading_locked'))
  assert.deepEqual(blocked.prohibitedActions, PROHIBITED_ACTIONS)

  const snapshot = await withTimeout('get_session_snapshot', famsChatService.getSessionSnapshot(first.conversationId))
  assert.equal(snapshot.status, 'audited')
  assert.ok((snapshot.messages || []).length >= 10, 'multi-turn session should persist user and assistant messages')
  assert.ok((snapshot.toolConfirmations || []).some((item: any) => item.status === 'confirmed'), 'confirmed tool call should be audited')

  const streamEvents = await withTimeout('stream_strategy_backtest_explanation', famsChatService.streamMessage({
    userId: 'default',
    conversationId: first.conversationId,
    message: '用流式方式再解释一下策略回测结果',
  }))
  assert.ok(streamEvents.some((event) => event.type === 'start'))
  assert.ok(streamEvents.some((event) => event.type === 'tool_result'))
  assert.ok(streamEvents.some((event) => event.type === 'final'))
  for (const event of streamEvents) {
    assert.equal(event.formalTradingUnlocked, false)
    assert.equal(event.autoTradeUnlocked, false)
    assert.equal(event.canCreateOrder, false)
    assert.equal(event.orderCreateAllowed, false)
    assert.deepEqual(event.prohibitedActions, PROHIBITED_ACTIONS)
  }

  const audit = {
    schemaVersion: 'fams.next_stage.chatbox_multi_turn_agent_loop_audit.v1',
    status: 'passed',
    checkedAt,
    conversationId: first.conversationId,
    capabilities: (capabilities as any).agentLoop,
    coveredTurns: [
      { intent: first.intent, resultType: first.structuredResult?.resultType },
      { intent: zone.intent, resultType: zone.structuredResult?.resultType },
      { intent: comparison.intent, resultType: comparison.structuredResult?.resultType },
      { intent: scan.intent, requiresConfirmation: scan.requiresConfirmation },
      { intent: confirmed.intent, operationId: confirmed.operationId },
      { intent: blocked.intent, blockedReasons: blocked.blockedReasons },
      { streamEventTypes: streamEvents.map((event) => event.type) },
    ],
    sessionAudit: {
      status: snapshot.status,
      messageCount: snapshot.messages?.length || 0,
      confirmationCount: snapshot.toolConfirmations?.length || 0,
      confirmedToolCalls: (snapshot.toolConfirmations || []).filter((item: any) => item.status === 'confirmed').length,
    },
    checks: {
      multiTurnContextReady: true,
      readOnlyToolLoopReady: true,
      computeToolLoopReady: true,
      confirmationLoopReady: true,
      streamingLoopReady: true,
      tradeActionBlocked: true,
      piLlmAgentLoopEnabled: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
    prohibitedActions: PROHIBITED_ACTIONS,
    notTradingAdvice: true,
  }
  const auditPath = resolve(auditDir, '10_chatbox_multi_turn_agent_loop_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
