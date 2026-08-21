import { complete, type Context, type Model } from '@earendil-works/pi-ai'
import { z } from 'zod'
import { getFamsLlmConfig } from '../../config/llmConfig.js'
import { postJson } from '../../utils/httpJson.js'

const SUPPORTED_PROVIDERS = new Set(['openai', 'openai_compatible', 'deepseek', 'minimax'])

const llmPayloadSchema = z.object({
  headline: z.string().min(1).max(180),
  overview: z.string().min(1).max(420),
  attentionSummaries: z.array(z.object({
    symbol: z.string().min(1).max(24),
    summary: z.string().min(1).max(260),
    reasons: z.array(z.string().min(1).max(180)).max(4),
    watchItems: z.array(z.string().min(1).max(180)).max(4),
    risk: z.string().max(220),
    evidenceRefs: z.array(z.string().min(1).max(260)).max(8),
  }).strict()).max(12),
  orderExplanations: z.array(z.object({
    symbol: z.string().min(1).max(24),
    summary: z.string().min(1).max(240),
    anchorLogic: z.string().min(1).max(220),
    spacingLogic: z.string().min(1).max(220),
    sizingLogic: z.string().min(1).max(220),
    risks: z.array(z.string().min(1).max(180)).max(4),
  }).strict()).max(12),
}).strict()

function extractText(message: any) {
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter((block: any) => block?.type === 'text' && typeof block.text === 'string')
    .map((block: any) => block.text)
    .join('\n')
}

function parseJsonObject(text: string) {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text
  try {
    const parsed = JSON.parse(jsonText)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function clean(value: unknown, max = 260) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function modelFor(config: ReturnType<typeof getFamsLlmConfig>): Model<'openai-completions'> {
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
    maxTokens: 1_600,
  }
}

async function completeMinimax(config: ReturnType<typeof getFamsLlmConfig>, context: Context) {
  const systemPrompt = typeof context.systemPrompt === 'string' ? context.systemPrompt : ''
  const userPrompt = context.messages
    .flatMap((message: any) => Array.isArray(message.content)
      ? message.content.filter((block: any) => block?.type === 'text').map((block: any) => block.text)
      : typeof message.content === 'string' ? [message.content] : [])
    .join('\n')
  const response = await postJson<any>(
    'https://api.minimax.chat/v1/text/chatcompletion_pro',
    {
      model: config.model,
      messages: [{ role: 'user', content: userPrompt, sender_name: 'user', sender_type: 'USER' }],
      bot_setting: [{ bot_name: 'assistant', content: systemPrompt, }],
      reply_constraints: { role: 'assistant', content_type: 'text', sender_type: 'BOT', sender_name: 'assistant' },
      temperature: 0.1,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: config.timeoutMs,
    },
  )
  if (typeof response?.reply === 'string' && response.reply.trim()) return response.reply
  throw new Error(response?.base_resp?.status_msg || 'MiniMax synthesis response is invalid')
}

function isDailyReviewLlmEnabled() {
  const explicit = process.env.FAMS_DAILY_REVIEW_LLM_ENABLED
  if (explicit && /^(0|false|no|off)$/i.test(explicit)) return false
  const config = getFamsLlmConfig()
  return Boolean(config.configured && config.chatAgentEnabled && SUPPORTED_PROVIDERS.has(config.provider))
}

export function buildDailyReviewSynthesisFallback(input: any, failureCode: string, attempted: boolean) {
  const decisionAssets = Array.isArray(input?.decisionSummary?.assets) ? input.decisionSummary.assets : []
  const candidates = Array.isArray(input?.attentionCandidates) ? input.attentionCandidates : []
  return {
    schemaVersion: 'fams.daily-review-llm-synthesis.v1',
    status: 'fallback',
    source: 'deterministic',
    model: null,
    generatedAt: new Date().toISOString(),
    attempted,
    attemptCount: attempted ? 1 : 0,
    failureCode,
    headline: clean(input?.decisionSummary?.headline, 180) || '本轮复盘已生成规则摘要。',
    overview: `本轮共有 ${decisionAssets.length} 个资产进入复盘；所有买卖内容均为人工计划草案。`,
    attentionSummaries: candidates.map((candidate: any) => {
      const matched = decisionAssets.find((asset: any) => asset.symbol === candidate.symbol)
      return {
        symbol: candidate.symbol,
        summary: clean(candidate.reason, 260) || '当前持仓例行关注。',
        reasons: [clean(candidate.reason, 180) || '当前持仓例行关注。'],
        watchItems: matched?.blockers?.length ? matched.blockers.map((item: string) => `复核门禁：${item}`).slice(0, 4) : ['关注价格、事实变化和网格有效期。'],
        risk: candidate.evidenceStatus === 'available' ? '证据可用，但仍需人工复核。' : '证据不完整，不据此提高仓位。',
        evidenceRefs: (candidate.evidenceRefs || []).slice(0, 8),
      }
    }),
    orderExplanations: decisionAssets.map((asset: any) => ({
      symbol: asset.symbol,
      summary: clean(asset.conclusion, 240) || '本轮仅观察。',
      anchorLogic: `价格档位使用 ${asset.gridDerivation?.anchor?.source || '技术价格'} 作为网格锚。`,
      spacingLogic: '档位间距按波动率策略计算，并受策略最小和最大百分比约束。',
      sizingLogic: '数量受现金底线、最大仓位、最大调整比例、分档权重和最小交易单位约束。',
      risks: (asset.blockers || []).slice(0, 4),
    })),
  }
}

export function validateDailyReviewSynthesisPayload(parsed: unknown, input: any) {
  const checked = llmPayloadSchema.safeParse(parsed)
  if (!checked.success) return { ok: false as const, code: 'llm_schema_invalid' }
  const decisionAssets = Array.isArray(input?.decisionSummary?.assets) ? input.decisionSummary.assets : []
  const candidates = Array.isArray(input?.attentionCandidates) ? input.attentionCandidates : []
  const allowedSymbols = new Set([
    ...decisionAssets.map((asset: any) => asset.symbol),
    ...candidates.map((candidate: any) => candidate.symbol),
  ])
  const evidenceBySymbol = new Map<string, Set<string>>()
  for (const asset of decisionAssets) evidenceBySymbol.set(asset.symbol, new Set(asset.evidenceRefs || []))
  for (const candidate of candidates) {
    const refs = evidenceBySymbol.get(candidate.symbol) || new Set<string>()
    for (const ref of candidate.evidenceRefs || []) refs.add(ref)
    evidenceBySymbol.set(candidate.symbol, refs)
  }
  const allNarrative = [
    checked.data.headline,
    checked.data.overview,
    ...checked.data.attentionSummaries.flatMap((item) => [item.summary, ...item.reasons, ...item.watchItems, item.risk]),
    ...checked.data.orderExplanations.flatMap((item) => [item.summary, item.anchorLogic, item.spacingLogic, item.sizingLogic, ...item.risks]),
  ]
  const narrativeWithoutAllowlistedSymbols = allNarrative.map((item) => {
    let safeText = item
    for (const symbol of allowedSymbols) safeText = safeText.replaceAll(symbol, '')
    return safeText
  })
  if (narrativeWithoutAllowlistedSymbols.some((item) => /\d/.test(item))) return { ok: false as const, code: 'llm_numeric_narrative_rejected' }
  for (const item of [...checked.data.attentionSummaries, ...checked.data.orderExplanations]) {
    if (!allowedSymbols.has(item.symbol)) return { ok: false as const, code: 'llm_symbol_outside_allowlist' }
  }
  for (const item of checked.data.attentionSummaries) {
    const allowedRefs = evidenceBySymbol.get(item.symbol) || new Set<string>()
    if (item.evidenceRefs.some((ref) => !allowedRefs.has(ref))) return { ok: false as const, code: 'llm_evidence_ref_outside_allowlist' }
  }
  return { ok: true as const, data: checked.data }
}

class DailyReviewSynthesisService {
  async synthesize(input: any) {
    if (!isDailyReviewLlmEnabled()) return buildDailyReviewSynthesisFallback(input, 'llm_not_configured_or_disabled', false)
    const config = getFamsLlmConfig()
    const compactInput = {
      strategyAssessment: input.strategyAssessment,
      decisionSummary: input.decisionSummary,
      attentionCandidates: (input.attentionCandidates || []).slice(0, 12),
      assets: (input.assets || []).slice(0, 12).map((asset: any) => ({
        symbol: asset.symbol,
        name: asset.name,
        weightPct: asset.position?.weightPct,
        materialChange: asset.fundamentalAndNews,
        valuationContext: asset.valuationContext,
        recommendation: asset.recommendation,
        grid: {
          summary: asset.grid?.summary,
          blockers: asset.grid?.blockers,
          derivation: asset.grid?.derivation,
          orders: (asset.grid?.orders || []).map((order: any) => ({
            side: order.side,
            level: order.level,
            price: order.price,
            quantity: order.quantity,
          })),
        },
      })),
    }
    const context: Context = {
      systemPrompt: [
        '你是 FAMS 每日复盘的证据摘要器。所有业务计算已由确定性引擎完成。',
        '只能解释输入中的标的、事实、风险、关注原因和人工计划草案，不得新增事实、标的、动作、价格、数量或目标价。',
        '所有价格和数量由页面的确定性区域展示；你的叙述字段中禁止出现任何阿拉伯数字。',
        'evidenceRefs 只能逐字复制对应标的输入中已有的引用。',
        '不得把人工计划草案升级为投资建议或自动下单指令。',
        '只输出 JSON，不要 Markdown。',
        'JSON 字段：headline, overview, attentionSummaries, orderExplanations。',
        'attentionSummaries 每项字段：symbol, summary, reasons, watchItems, risk, evidenceRefs。',
        'orderExplanations 每项字段：symbol, summary, anchorLogic, spacingLogic, sizingLogic, risks。',
      ].join('\n'),
      messages: [{
        role: 'user',
        timestamp: Date.now(),
        content: `请基于以下白名单证据生成简体中文汇总：\n${JSON.stringify(compactInput)}`,
      }],
    }
    try {
      const responseText = config.provider === 'minimax'
        ? await completeMinimax(config, context)
        : extractText(await complete(modelFor(config), context, {
          apiKey: config.apiKey!,
          maxTokens: 1_400,
          temperature: 0.1,
          signal: AbortSignal.timeout(config.timeoutMs),
        }))
      const parsed = parseJsonObject(responseText)
      const validated = validateDailyReviewSynthesisPayload(parsed, input)
      if (!validated.ok) return buildDailyReviewSynthesisFallback(input, validated.code, true)
      return {
        schemaVersion: 'fams.daily-review-llm-synthesis.v1',
        status: 'available',
        source: 'llm',
        model: config.model,
        generatedAt: new Date().toISOString(),
        attempted: true,
        attemptCount: 1,
        failureCode: null,
        ...validated.data,
      }
    } catch (error) {
      const code = error instanceof DOMException && error.name === 'TimeoutError'
        ? 'llm_timeout'
        : 'llm_request_failed'
      return buildDailyReviewSynthesisFallback(input, code, true)
    }
  }
}

export const dailyReviewSynthesisService = new DailyReviewSynthesisService()
