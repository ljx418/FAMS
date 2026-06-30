import { famsChatService } from '../src/services/chat/famsChatService.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function main() {
  const checkedAt = new Date().toISOString()
  const capabilities = await famsChatService.capabilities()
  assert(capabilities.agentCore.provider === 'pi-agent-core', 'AgentCore provider should be pi-agent-core')
  assert(capabilities.agentCore.runtimeAvailable === true, 'PI AgentCore runtime should be importable')
  assert(capabilities.piToolManifest.toolCount === capabilities.tools.length, 'All FAMS chat tools should have PI-compatible manifest entries')
  assert(capabilities.agentCore.securityBoundary.unrestrictedLocalToolsExposed === false, 'Unrestricted local tools must not be exposed')
  assert(capabilities.tools.some((tool) => tool.name === 'dividendLowVol.candidates.read'), 'Dividend low vol read tool missing')
  assert(capabilities.tools.some((tool) => tool.name === 'dividendLowVol.scan.start' && tool.risk === 'confirm_required'), 'Dividend scan tool should require confirmation')

  const candidateResponse = await famsChatService.sendMessage({
    userId: 'default',
    message: '帮我看红利低波前三只候选',
  })
  assert(candidateResponse.intent === 'dividend_low_vol_candidates', 'Dividend query intent mismatch')
  assert(candidateResponse.requiresConfirmation === false, 'Read-only dividend query should not require confirmation')
  assert(candidateResponse.prohibitedActions.includes('ORDER_CREATE'), 'ORDER_CREATE must remain prohibited')
  assert(candidateResponse.notTradingAdvice === true, 'Chat response must be marked notTradingAdvice')

  const scanResponse = await famsChatService.sendMessage({
    userId: 'default',
    conversationId: candidateResponse.conversationId,
    message: '刷新红利低波扫描',
  })
  assert(scanResponse.intent === 'dividend_low_vol_scan', 'Scan intent mismatch')
  assert(scanResponse.requiresConfirmation === true, 'Scan should require confirmation')
  assert(scanResponse.actionCards.some((card) => card.type === 'tool_confirmation'), 'Scan should return confirmation card')
  const scanConfirmationId = scanResponse.actionCards.find((card) => card.type === 'tool_confirmation')?.confirmationId
  assert(scanConfirmationId, 'Scan confirmation id missing')

  const confirmedScan = await famsChatService.confirmTool({
    userId: 'default',
    conversationId: scanResponse.conversationId,
    confirmationId: scanConfirmationId,
  })
  assert(confirmedScan.requiresConfirmation === false, 'Confirmed scan should not require another confirmation')
  assert(Boolean(confirmedScan.operationId), 'Confirmed scan should return operationId')
  assert(confirmedScan.actionCards.some((card) => card.href === '/operations'), 'Confirmed scan should link to operations center')

  const restoredSession = await famsChatService.getSessionSnapshot(candidateResponse.conversationId)
  assert(restoredSession.status === 'audited', 'Chat session should be persisted and auditable')
  assert((restoredSession.messages || []).length >= 4, 'Persisted chat session should contain user and assistant messages')
  assert((restoredSession.toolConfirmations || []).some((item: any) => item.status === 'confirmed'), 'Confirmed tool call should be audited')

  const blockedResponse = await famsChatService.sendMessage({
    userId: 'default',
    conversationId: candidateResponse.conversationId,
    message: '帮我直接下单买入红利低波前三只',
  })
  assert(blockedResponse.intent === 'trade_action_blocked', 'Trade action should be blocked')
  assert(blockedResponse.blockedReasons.includes('formal_trading_locked'), 'formal_trading_locked blocker missing')
  assert(blockedResponse.prohibitedActions.includes('AUTO_TRADE'), 'AUTO_TRADE must remain prohibited')

  const audit = {
    schemaVersion: 'fams.chat_agent_core_verification.v1',
    status: 'passed',
    checkedAt,
    agentCore: capabilities.agentCore,
    readiness: {
      chatBoxV1Integrated: true,
      piAgentCoreRuntimeIntegrated: capabilities.agentCore.runtimeAvailable,
      chatSessionAuditReady: restoredSession.status === 'audited',
      chatOperationLinkageReady: Boolean(confirmedScan.operationId),
      piLlmAgentLoopEnabled: false,
      chatStreamingReady: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    },
    evidence: {
      conversationId: candidateResponse.conversationId,
      operationId: confirmedScan.operationId,
      auditedMessageCount: restoredSession.messages?.length || 0,
      auditedConfirmationCount: restoredSession.toolConfirmations?.length || 0,
    },
    coveredScenarios: [
      'pi_agent_core_importable',
      'read_only_dividend_candidates',
      'scan_requires_confirmation',
      'scan_confirmation_returns_operation_id',
      'chat_session_restore',
      'trade_action_blocked',
    ],
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    notTradingAdvice: true,
  }
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })
  const auditPath = resolve(auditDir, 'chatbox_agentcore_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
