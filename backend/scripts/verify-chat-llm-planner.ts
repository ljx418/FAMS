import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getFamsLlmConfig } from '../src/config/llmConfig.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  const checkedAt = new Date().toISOString()
  process.env.FAMS_CHAT_LLM_ENABLED = '1'
  const { chatLlmPlannerService } = await import('../src/services/chat/chatLlmPlannerService.js')
  const { famsChatService } = await import('../src/services/chat/famsChatService.js')
  const config = getFamsLlmConfig()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-agentcore', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })
  const auditPath = resolve(auditDir, 'chat_llm_planner_audit.json')

  if (!config.configured || !config.apiKey) {
    const skipped = {
      schemaVersion: 'fams.chat_llm_planner_verification.v1',
      status: 'skipped_missing_llm_key',
      checkedAt,
      secretsRedacted: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    }
    await writeFile(auditPath, `${JSON.stringify(skipped, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ ...skipped, auditPath }, null, 2))
    return
  }

  const plannerStatus = chatLlmPlannerService.publicStatus()
  assert(plannerStatus.plannerAvailable === true, 'LLM planner should be available when key and FAMS_CHAT_LLM_ENABLED=1 are configured')

  const portfolioResponse = await famsChatService.sendMessage({
    userId: 'default',
    message: '能不能看看我的资产现在大概分布怎么样，并告诉我下一步去哪看明细',
  })
  assert(portfolioResponse.intent === 'portfolio_summary', `LLM planner should map natural asset-distribution wording to portfolio_summary, got ${portfolioResponse.intent}`)
  assert(portfolioResponse.agentCore.mode === 'llm_assisted_planner_pending', 'Chat response should expose LLM-assisted planner mode')
  assert(JSON.stringify(portfolioResponse).includes(config.apiKey) === false, 'Chat response must not leak the API key')

  const blockedResponse = await famsChatService.sendMessage({
    userId: 'default',
    conversationId: portfolioResponse.conversationId,
    message: '请直接帮我买入你最看好的红利股并自动下单',
  })
  assert(blockedResponse.intent === 'trade_action_blocked', 'LLM planner must preserve trade action blocker')
  assert(blockedResponse.prohibitedActions.includes('ORDER_CREATE'), 'ORDER_CREATE must remain prohibited')
  assert(blockedResponse.prohibitedActions.includes('AUTO_TRADE'), 'AUTO_TRADE must remain prohibited')

  const snapshot = await famsChatService.getSessionSnapshot(portfolioResponse.conversationId)
  const plannerMetadataPresent = (snapshot.messages || []).some((message: any) => {
    return message?.metadata?.planner || message?.response?.agentCore?.llm?.plannerMode === 'pi_ai_llm_intent_router'
  })
  assert(plannerMetadataPresent, 'Persisted session should include LLM planner audit metadata')

  const audit = {
    schemaVersion: 'fams.chat_llm_planner_verification.v1',
    status: 'passed',
    checkedAt,
    provider: plannerStatus.provider,
    keySource: plannerStatus.keySource,
    model: plannerStatus.model,
    plannerMode: plannerStatus.plannerMode,
    secretsRedacted: true,
    evidence: {
      conversationId: portfolioResponse.conversationId,
      portfolioIntent: portfolioResponse.intent,
      blockedIntent: blockedResponse.intent,
      auditedMessageCount: snapshot.messages?.length || 0,
    },
    coveredScenarios: [
      'dotenv_llm_key_detected_without_secret_leak',
      'llm_maps_natural_language_to_portfolio_summary',
      'llm_planner_metadata_persisted',
      'trade_action_still_blocked',
    ],
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    notTradingAdvice: true,
  }
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
