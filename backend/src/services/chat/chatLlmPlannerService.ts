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

export type SummarySynthesis = {
  reply: string
  source: 'llm'
  model: string
}

type SummaryInput = {
  intent: FamsChatIntent
  userMessage: string
  deterministicReply: string
  structuredResult: Record<string, any>
}

const VALID_INTENTS: FamsChatIntent[] = [
  'dividend_low_vol_top_candidates',
  'dividend_low_vol_trading_zone',
  'dividend_low_vol_scan',
  'dividend_low_vol_plan_draft',
  'refresh_data',
  'portfolio_summary',
  'daily_review_latest',
  'daily_review_run',
  'portfolio_risk_explain',
  'portfolio_backtest_compare',
  'portfolio_backtest_operation',
  'portfolio_backtest_explain',
  'manual_trade_draft',
  'operation_status',
  'audit_report_explain',
  'data_trust_explain',
  'navigate_to_page',
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
  if (typeof rawContext.symbol === 'string') context.symbol = rawContext.symbol.slice(0, 16)
  if (Array.isArray(rawContext.strategies)) context.portfolioStrategyIds = rawContext.strategies.filter((item) => typeof item === 'string').slice(0, 6)
  if (Array.isArray(rawContext.portfolioStrategyIds)) context.portfolioStrategyIds = rawContext.portfolioStrategyIds.filter((item) => typeof item === 'string').slice(0, 6)
  return {
    intent,
    confidence,
    context,
    reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 240) : 'llm_planner_decision',
  }
}

function cleanSummaryText(value: unknown, maxLength = 260) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : ''
}

function cleanSummaryList(value: unknown, limit = 4) {
  return Array.isArray(value)
    ? value.map((item) => cleanSummaryText(item, 180)).filter(Boolean).slice(0, limit)
    : []
}

function buildSummaryEvidence(result: Record<string, any>) {
  const dailyReview = result.dailyReview
  return {
    resultType: result.resultType,
    existingSummary: result.summary,
    keyNumbers: (result.keyNumbers || result.metricCards || []).slice(0, 10),
    nextActions: (result.nextActions || []).slice(0, 6),
    blockedReasons: (result.blockedReasons || []).slice(0, 12),
    dataHealth: result.dataHealth || result.dataQualitySummary || null,
    comparison: result.comparisonTable ? {
      columns: (result.comparisonTable.columns || []).slice(0, 12),
      rows: (result.comparisonTable.rows || []).slice(0, 15),
      insufficientReason: result.comparisonTable.insufficientReason,
    } : null,
    chartTitles: (result.charts || []).slice(0, 8).map((chart: any) => chart?.title).filter(Boolean),
    dailyReview: dailyReview ? {
      reviewId: dailyReview.reviewId,
      sessionType: dailyReview.sessionType,
      strategyAssessment: dailyReview.strategyAssessment,
      assets: (dailyReview.assets || []).slice(0, 12).map((asset: any) => ({
        symbol: asset.symbol,
        name: asset.name,
        quote: asset.quote,
        materialChange: asset.materialChange,
        recommendation: asset.recommendation,
        grid: {
          status: asset.grid?.status,
          summary: asset.grid?.summary,
          blockers: asset.grid?.blockers,
          adjustment: asset.grid?.adjustment,
          orders: (asset.grid?.orders || []).slice(0, 6),
        },
      })),
      attentionCandidates: (dailyReview.attentionCandidates || []).slice(0, 12),
      executionBoundary: dailyReview.executionBoundary,
    } : null,
  }
}

function sanitizeSummary(parsed: Record<string, unknown>, model: string): SummarySynthesis | null {
  const headline = cleanSummaryText(parsed.headline, 180)
  const overview = cleanSummaryText(parsed.overview, 320)
  const keyPoints = cleanSummaryList(parsed.keyPoints, 4)
  const nextSteps = cleanSummaryList(parsed.nextSteps, 3)
  const risks = cleanSummaryList(parsed.risks, 3)
  if (!headline && !overview) return null
  const lines = [headline || overview]
  if (headline && overview && overview !== headline) lines.push(`重点：${overview}`)
  if (keyPoints.length) lines.push(...keyPoints.map((item) => `重点：${item}`))
  if (nextSteps.length) lines.push(`建议关注：${nextSteps.join('；')}`)
  if (risks.length) lines.push(`风险边界：${risks.join('；')}`)
  return { reply: lines.slice(0, 7).join('\n'), source: 'llm', model }
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
        'context 只允许 topN、limit、universe、symbol、portfolioStrategyIds。不要返回其他字段。',
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

  async summarizeResult(input: SummaryInput): Promise<SummarySynthesis | null> {
    const config = getFamsLlmConfig()
    if (!config.configured || !config.chatAgentEnabled || !config.apiKey || !SUPPORTED_CHAT_LLM_PROVIDERS.has(config.provider)) {
      return null
    }
    const context: Context = {
      systemPrompt: [
        '你是 FAMS ChatBox 的结果摘要器。白名单工具已经完成计算，你只能压缩和解释给定证据。',
        '不得编造价格、均线、基本面、消息、标的、数量或风险；不得引入证据外的新结论。',
        '可以复述原结果中的观察建议和人工计划网格，但不得把研究草案升级为买卖、下单或自动交易指令。',
        '优先回答：总体结论、发生了什么、用户现在应关注什么、有哪些数据或交易边界。',
        '使用简体中文，短句，不使用 Markdown 表格。只输出 JSON。',
        'JSON 字段：headline, overview, keyPoints, nextSteps, risks。数组最多 4 项；全文尽量控制在 450 个汉字内。',
      ].join('\n'),
      messages: [{
        role: 'user',
        timestamp: Date.now(),
        content: [
          `用户原问题：${input.userMessage.slice(0, 800)}`,
          `业务意图：${input.intent}`,
          `原规则摘要：${input.deterministicReply.slice(0, 1400)}`,
          '结构化证据：',
          JSON.stringify(buildSummaryEvidence(input.structuredResult)),
        ].join('\n'),
      }],
    }
    const response = await complete(buildModel(config), context, {
      apiKey: config.apiKey,
      maxTokens: 700,
      temperature: 0.1,
      signal: AbortSignal.timeout(config.timeoutMs),
    })
    if ((response as any)?.stopReason === 'error') {
      throw new Error(cleanSummaryText((response as any)?.errorMessage, 240) || 'llm_summary_provider_error')
    }
    const rawText = extractText(response)
    const parsed = parseJsonObject(rawText)
    if (parsed) {
      const summary = sanitizeSummary(parsed, config.model)
      if (summary) return summary
    }
    const plainText = cleanSummaryText(rawText.replace(/```(?:json)?|```/gi, ''), 700)
    if (plainText && !plainText.startsWith('{')) return { reply: plainText, source: 'llm', model: config.model }
    console.warn('ChatBox LLM returned an unusable summary payload', {
      textLength: rawText.length,
      parsedKeys: parsed ? Object.keys(parsed).slice(0, 12) : [],
    })
    return null
  }

  publicStatus() {
    return {
      ...getFamsLlmPublicStatus(),
      plannerAvailable: this.isAvailable(),
      plannerMode: this.isAvailable() ? 'pi_ai_llm_intent_router' : 'deterministic_planner_fallback',
      summaryAvailable: this.isAvailable(),
      summaryMode: this.isAvailable() ? 'llm_structured_result_synthesis' : 'deterministic_summary_fallback',
      toolExecutionBoundary: 'fams_allowlisted_tools_only',
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    }
  }
}

export const chatLlmPlannerService = new ChatLlmPlannerService()
