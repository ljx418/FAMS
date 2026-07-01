import { complete, type Context, type Model } from '@earendil-works/pi-ai'
import { getFamsLlmConfig, getFamsLlmPublicStatus } from '../../config/llmConfig.js'
import type { FamsChatIntent } from './famsChatTypes.js'

const SUPPORTED_CHAT_LLM_PROVIDERS = new Set(['openai', 'openai_compatible', 'deepseek'])

type PlannerDecision = {
  intent: FamsChatIntent
  confidence: number
  context: Record<string, unknown>
  reason: string
}

const VALID_INTENTS: FamsChatIntent[] = [
  'dividend_low_vol_candidates',
  'dividend_low_vol_scan',
  'portfolio_summary',
  'portfolio_backtest',
  'manual_trade_draft',
  'operation_status',
  'trade_action_blocked',
  'capability_help',
]

function extractText(message: any) {
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text)
    .join('\n')
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text
  try {
    const parsed = JSON.parse(jsonText)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function sanitizeDecision(parsed: Record<string, unknown>): PlannerDecision | null {
  const intent = typeof parsed.intent === 'string' && VALID_INTENTS.includes(parsed.intent as FamsChatIntent)
    ? parsed.intent as FamsChatIntent
    : null
  if (!intent) return null
  const rawConfidence = Number(parsed.confidence)
  const confidence = Number.isFinite(rawConfidence) ? Math.max(0, Math.min(1, rawConfidence)) : 0.65
  const rawContext = parsed.context && typeof parsed.context === 'object' && !Array.isArray(parsed.context)
    ? parsed.context as Record<string, unknown>
    : {}
  const context: Record<string, unknown> = {}
  if (rawContext.topN != null) context.topN = Math.max(1, Math.min(10, Number(rawContext.topN) || 3))
  if (rawContext.limit != null) context.limit = Math.max(10, Math.min(6000, Number(rawContext.limit) || 120))
  if (rawContext.universe === 'all_a' || rawContext.universe === 'provided_symbols') context.universe = rawContext.universe
  return {
    intent,
    confidence,
    context,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : 'llm_planner_decision',
  }
}

function buildModel(config: ReturnType<typeof getFamsLlmConfig>): Model<'openai-completions'> {
  return {
    id: config.model,
    name: config.model,
    api: 'openai-completions',
    provider: config.provider === 'openai_compatible' ? 'custom-openai-compatible' : config.provider,
    baseUrl: config.baseUrl || (config.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1'),
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_000,
    maxTokens: 1_024,
  }
}

class ChatLlmPlannerService {
  isAvailable() {
    const config = getFamsLlmConfig()
    return Boolean(config.configured && config.chatAgentEnabled && SUPPORTED_CHAT_LLM_PROVIDERS.has(config.provider))
  }

  async plan(message: string, currentContext: Record<string, unknown> = {}): Promise<PlannerDecision | null> {
    const config = getFamsLlmConfig()
    if (!config.configured || !config.chatAgentEnabled || !config.apiKey || !SUPPORTED_CHAT_LLM_PROVIDERS.has(config.provider)) {
      return null
    }

    const context: Context = {
      systemPrompt: [
        '你是 FAMS ChatBox 的受控意图路由器，只能把用户消息分类为 FAMS 已允许的 intent。',
        '你不能输出投资建议、买入、卖出、加仓、减仓、下单或自动交易动作。',
        '如果用户要求交易、下单、买入、卖出、加仓、减仓或自动交易，必须返回 trade_action_blocked。',
        '如果用户要求刷新、扫描、生成草案等副作用，只返回对应 intent；实际执行由 FAMS 二次确认 gate 处理。',
        '只输出 JSON，不要 Markdown。',
        'JSON 字段：intent, confidence, context, reason。',
        `可选 intent：${VALID_INTENTS.join(', ')}`,
        'context 只允许 topN、limit、universe。不要返回其他字段。',
      ].join('\n'),
      messages: [
        {
          role: 'user',
          timestamp: Date.now(),
          content: [
            '用户消息：',
            message,
            '',
            '当前上下文摘要：',
            JSON.stringify({
              userId: currentContext.userId || 'default',
              hasConversationId: Boolean(currentContext.conversationId),
              page: currentContext.page || null,
            }),
          ].join('\n'),
        },
      ],
    }
    const response = await complete(buildModel(config), context, {
      apiKey: config.apiKey,
      maxTokens: 300,
      temperature: 0,
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    const text = extractText(response)
    const parsed = parseJsonObject(text)
    return parsed ? sanitizeDecision(parsed) : null
  }

  publicStatus() {
    return {
      ...getFamsLlmPublicStatus(),
      plannerAvailable: this.isAvailable(),
      plannerMode: this.isAvailable() ? 'pi_ai_llm_intent_router' : 'deterministic_planner_fallback',
      toolExecutionBoundary: 'fams_allowlisted_tools_only',
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    }
  }
}

export const chatLlmPlannerService = new ChatLlmPlannerService()
