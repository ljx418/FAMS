import type { Context } from '@earendil-works/pi-ai'
import axios from 'axios'
import { z } from 'zod'
import { getFamsLlmConfig } from '../../config/llmConfig.js'

const SUPPORTED_PROVIDERS = new Set(['openai', 'openai_compatible', 'deepseek', 'minimax'])
const SYNTHESIS_FOCUS_SYMBOLS = new Set(['601127', '600276', '159851', '513770'])

const narrativeString = (max: number) => z.union([
  z.string(),
  z.array(z.string()).max(4),
]).transform((value) => Array.isArray(value) ? value.join('；') : value).pipe(z.string().min(1).max(max))

const llmPayloadSchema = z.object({
  headline: z.string().min(1).max(180),
  overview: z.string().min(1).max(420),
  attentionSummaries: z.array(z.object({
    symbol: z.string().min(1).max(24),
    summary: z.string().min(1).max(260),
    reasons: z.array(z.string().min(1).max(180)).max(8),
    watchItems: z.array(z.string().min(1).max(180)).max(8),
    risk: narrativeString(220),
    evidenceRefs: z.array(z.string().min(1).max(260)).max(8),
  }).strict()).max(12),
  orderExplanations: z.array(z.object({
    symbol: z.string().min(1).max(24),
    summary: z.string().min(1).max(240),
    anchorLogic: narrativeString(220),
    spacingLogic: narrativeString(220),
    sizingLogic: narrativeString(220),
    risks: z.array(z.string().min(1).max(180)).max(8),
  }).strict()).max(12),
}).strict()

function parseJsonObject(text: string) {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text
  const attempts = [
    { text: jsonText, normalization: null as string | null },
    { text: jsonText.replace(/,\s*([}\]])/g, '$1'), normalization: 'trailing_commas_removed' },
  ]
  let lastError = ''
  for (const attempt of attempts) {
    try {
      let parsed = JSON.parse(attempt.text)
      let normalization = attempt.normalization
      if (typeof parsed === 'string') {
        parsed = JSON.parse(parsed)
        normalization = [normalization, 'double_encoded_json_unwrapped'].filter(Boolean).join('+')
      }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { parsed, normalization, diagnostics: null }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  return {
    parsed: null,
    normalization: null,
    diagnostics: {
      responseCharacters: text.length,
      startsWithObject: jsonText.trimStart().startsWith('{'),
      endsWithObject: jsonText.trimEnd().endsWith('}'),
      openingBraces: (jsonText.match(/\{/g) || []).length,
      closingBraces: (jsonText.match(/\}/g) || []).length,
      openingBrackets: (jsonText.match(/\[/g) || []).length,
      closingBrackets: (jsonText.match(/\]/g) || []).length,
      containsTrailingComma: /,\s*[}\]]/.test(jsonText),
      parseError: clean(lastError, 180),
    },
  }
}

function clean(value: unknown, max = 260) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

function normalizeKnownNarrativeTypos(parsed: Record<string, any>) {
  const changes = new Set<string>()
  const normalize = (value: unknown) => {
    if (typeof value !== 'string') return value
    const next = value.replace(/基本面料有变化/g, '基本面变化')
    if (next !== value) changes.add('zh_typo_基本面料有变化_to_基本面变化')
    return next
  }
  const value = {
    ...parsed,
    headline: normalize(parsed.headline),
    overview: normalize(parsed.overview),
    attentionSummaries: Array.isArray(parsed.attentionSummaries) ? parsed.attentionSummaries.map((item: any) => ({
      ...item,
      summary: normalize(item.summary),
      reasons: Array.isArray(item.reasons) ? item.reasons.map(normalize) : item.reasons,
      watchItems: Array.isArray(item.watchItems) ? item.watchItems.map(normalize) : item.watchItems,
      risk: Array.isArray(item.risk) ? item.risk.map(normalize) : normalize(item.risk),
    })) : parsed.attentionSummaries,
    orderExplanations: Array.isArray(parsed.orderExplanations) ? parsed.orderExplanations.map((item: any) => ({
      ...item,
      summary: normalize(item.summary),
      anchorLogic: Array.isArray(item.anchorLogic) ? item.anchorLogic.map(normalize) : normalize(item.anchorLogic),
      spacingLogic: Array.isArray(item.spacingLogic) ? item.spacingLogic.map(normalize) : normalize(item.spacingLogic),
      sizingLogic: Array.isArray(item.sizingLogic) ? item.sizingLogic.map(normalize) : normalize(item.sizingLogic),
      risks: Array.isArray(item.risks) ? item.risks.map(normalize) : item.risks,
    })) : parsed.orderExplanations,
  }
  return { value, changes: [...changes] }
}

async function completeMinimax(config: ReturnType<typeof getFamsLlmConfig>, context: Context) {
  const systemPrompt = typeof context.systemPrompt === 'string' ? context.systemPrompt : ''
  const userPrompt = context.messages
    .flatMap((message: any) => Array.isArray(message.content)
      ? message.content.filter((block: any) => block?.type === 'text').map((block: any) => block.text)
      : typeof message.content === 'string' ? [message.content] : [])
    .join('\n')
  const response = await axios.post<any>(
    'https://api.minimaxi.com/v1/chat/completions',
    {
      model: config.model,
      messages: [
        { role: 'system', name: 'FAMS', content: systemPrompt },
        { role: 'user', name: 'user', content: userPrompt },
      ],
      temperature: 0.1,
      max_completion_tokens: 2_048,
      stream: false,
      reasoning_split: true,
    },
    {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: config.timeoutMs,
      signal: AbortSignal.timeout(config.timeoutMs),
      proxy: false,
    },
  )
  const content = response.data?.choices?.[0]?.message?.content
  if (response.data?.choices?.[0]?.finish_reason === 'length') throw new Error('MiniMax synthesis response reached the token limit')
  if (typeof content === 'string' && content.trim()) return content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  throw new Error(response.data?.base_resp?.status_msg || 'MiniMax synthesis response is invalid')
}

async function completeOpenAiCompatible(config: ReturnType<typeof getFamsLlmConfig>, context: Context) {
  const configuredBaseUrl = config.baseUrl || (config.provider === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1')
  const normalizedUrl = new URL(configuredBaseUrl)
  if (normalizedUrl.protocol === 'http:' && normalizedUrl.port === '443') normalizedUrl.protocol = 'https:'
  const baseUrl = normalizedUrl.toString().replace(/\/$/, '')
  const userPrompt = context.messages
    .flatMap((message: any) => Array.isArray(message.content)
      ? message.content.filter((block: any) => block?.type === 'text').map((block: any) => block.text)
      : typeof message.content === 'string' ? [message.content] : [])
    .join('\n')
  const response = await axios.post<any>(
    `${baseUrl}/chat/completions`,
    {
      model: config.model,
      messages: [
        { role: 'system', content: typeof context.systemPrompt === 'string' ? context.systemPrompt : '' },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0,
      max_tokens: 4_000,
      response_format: { type: 'json_object' },
      stream: false,
    },
    {
      headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
      timeout: config.timeoutMs,
      signal: AbortSignal.timeout(config.timeoutMs),
      proxy: false,
    },
  )
  const content = response.data?.choices?.[0]?.message?.content
  if (typeof content === 'string' && content.trim()) return content
  throw new Error('OpenAI-compatible synthesis response is empty')
}

function isDailyReviewLlmEnabled() {
  const explicit = process.env.FAMS_DAILY_REVIEW_LLM_ENABLED
  if (explicit && /^(0|false|no|off)$/i.test(explicit)) return false
  const config = getFamsLlmConfig()
  return Boolean(config.configured && config.chatAgentEnabled && SUPPORTED_PROVIDERS.has(config.provider))
}

export function getDailyReviewLlmReadiness() {
  const config = getFamsLlmConfig()
  const enabled = isDailyReviewLlmEnabled()
  return {
    configured: Boolean(config.configured),
    chatAgentEnabled: Boolean(config.chatAgentEnabled),
    enabled,
    supportedProvider: SUPPORTED_PROVIDERS.has(config.provider),
    provider: config.provider || null,
    model: config.model || null,
    failureCode: enabled ? null : 'llm_not_configured_or_disabled',
  }
}

export function buildDailyReviewSynthesisFallback(input: any, failureCode: string, attempted: boolean, validationDiagnostics?: unknown) {
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
    validationDiagnostics: validationDiagnostics || null,
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
  if (!checked.success) return {
    ok: false as const,
    code: 'llm_schema_invalid',
    diagnostics: checked.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
      message: issue.message,
    })),
  }
  const decisionAssets = Array.isArray(input?.decisionSummary?.assets) ? input.decisionSummary.assets : []
  const candidates = Array.isArray(input?.attentionCandidates) ? input.attentionCandidates : []
  const allowedSymbols = new Set([
    ...decisionAssets.map((asset: any) => asset.symbol),
    ...candidates.map((candidate: any) => candidate.symbol),
  ])
  const attentionSymbols = candidates.map((candidate: any) => String(candidate.symbol))
  const orderSymbols = decisionAssets.map((asset: any) => String(asset.symbol))
  const actualAttentionSymbols = checked.data.attentionSummaries.map((item) => item.symbol)
  const actualOrderSymbols = checked.data.orderExplanations.map((item) => item.symbol)
  const sameSymbolCoverage = (expected: string[], actual: string[]) => (
    expected.length === actual.length
    && new Set(actual).size === actual.length
    && [...expected].sort().every((symbol, index) => symbol === [...actual].sort()[index])
  )
  if (!sameSymbolCoverage(attentionSymbols, actualAttentionSymbols)) return {
    ok: false as const,
    code: 'llm_attention_coverage_invalid',
    diagnostics: { expectedSymbols: attentionSymbols, actualSymbols: actualAttentionSymbols },
  }
  if (!sameSymbolCoverage(orderSymbols, actualOrderSymbols)) return {
    ok: false as const,
    code: 'llm_order_coverage_invalid',
    diagnostics: { expectedSymbols: orderSymbols, actualSymbols: actualOrderSymbols },
  }
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
  if (allNarrative.some((item) => /待填写|请填写/.test(item))) return {
    ok: false as const,
    code: 'llm_placeholder_narrative_rejected',
  }
  const narrativeWithoutAllowlistedSymbols = allNarrative.map((item) => {
    let safeText = item
    for (const symbol of allowedSymbols) safeText = safeText.replaceAll(symbol, '')
    safeText = safeText.replaceAll('A500', '')
    return safeText
  })
  const numericNarrativeIndexes = narrativeWithoutAllowlistedSymbols
    .map((item, index) => (/\d/.test(item) ? index : -1))
    .filter((index) => index >= 0)
  if (numericNarrativeIndexes.length > 0) return {
    ok: false as const,
    code: 'llm_numeric_narrative_rejected',
    diagnostics: { narrativeIndexes: numericNarrativeIndexes, count: numericNarrativeIndexes.length },
  }
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
    const allCandidates = Array.isArray(input?.attentionCandidates) ? input.attentionCandidates : []
    const portfolioActionSummary = input?.decisionSummary?.portfolioActionSummary
    const actionDrafts = Array.isArray(portfolioActionSummary?.tradeDrafts) ? portfolioActionSummary.tradeDrafts : []
    const sourceCaptureRef = portfolioActionSummary?.sourceSnapshot?.captureId
      ? `screenshot_capture:${portfolioActionSummary.sourceSnapshot.captureId}`
      : null
    const actionCandidates = actionDrafts.map((draft: any) => ({
      symbol: String(draft.symbol),
      name: draft.title || draft.symbol,
      source: 'alipay_allocation_draft',
      reason: `${draft.title || draft.symbol}；当前状态 ${draft.currentState || 'manual_review'}；后续状态 ${draft.laterTrancheState || 'pending'}`,
      evidenceStatus: sourceCaptureRef ? 'available' : 'partial',
      evidenceRefs: sourceCaptureRef ? [sourceCaptureRef] : [],
    }))
    const contextualSymbols = new Set(actionDrafts.map((draft: any) => String(draft.symbol)))
    const focusedCandidates = contextualSymbols.size > 0
      ? actionCandidates
      : allCandidates.filter((candidate: any) => SYNTHESIS_FOCUS_SYMBOLS.has(String(candidate.symbol)))
    const synthesisInput = {
      ...input,
      decisionSummary: { ...input.decisionSummary, assets: [] },
      attentionCandidates: focusedCandidates.length > 0 ? focusedCandidates : allCandidates.slice(0, 6),
      assets: (input.assets || []).filter((asset: any) => (
        contextualSymbols.size > 0 ? contextualSymbols.has(String(asset.symbol)) : SYNTHESIS_FOCUS_SYMBOLS.has(String(asset.symbol))
      )).slice(0, 6),
    }
    const compactInput = {
      strategyAssessment: {
        status: input.strategyAssessment?.status,
      },
      portfolioActionSummary: input.decisionSummary?.portfolioActionSummary || null,
      portfolioComparison: input.portfolioComparison ? {
        status: input.portfolioComparison.status,
        actualAllocationContract: input.portfolioComparison.actualAllocationContract,
        researchComparisonContract: input.portfolioComparison.researchComparisonContract,
        headline: input.portfolioComparison.summary?.headline || null,
        confidence: input.portfolioComparison.summary?.confidence || null,
      } : null,
      decisionAssets: [],
      attentionCandidates: (synthesisInput.attentionCandidates || []).slice(0, 6).map((candidate: any) => ({
        symbol: candidate.symbol,
        name: candidate.name,
        source: candidate.source,
        reason: candidate.reason,
        evidenceStatus: candidate.evidenceStatus,
        evidenceRefs: (candidate.evidenceRefs || []).slice(0, 1),
      })),
      assets: (synthesisInput.assets || []).slice(0, 4).map((asset: any) => ({
        symbol: asset.symbol,
        name: asset.name,
        materialChange: {
          level: asset.fundamentalAndNews?.level,
          reasons: (asset.fundamentalAndNews?.reasons || []).slice(0, 1),
        },
        valuation: {
          applicability: asset.valuationContext?.applicability,
          status: asset.valuationContext?.status,
          conclusion: asset.valuationContext?.conclusion,
        },
        recommendation: {
          action: asset.recommendation?.action,
        },
        gridBlockers: (asset.grid?.blockers || []).slice(0, 6),
        conditionalBuybackBlockers: (asset.buybackGrid?.blockers || []).slice(0, 6),
      })),
    }
    const context: Context = {
      systemPrompt: [
        '你是 FAMS 证据摘要器。直接输出结果，不展示分析过程。',
        '只能解释输入事实，不得新增标的、事实、动作、价格、数量或目标价。',
        '所有价格和数量由页面的确定性区域展示；你的叙述字段中禁止出现任何阿拉伯数字。',
        '产品名中的 A500 必须改写为“宽基”，不得在叙述里输出 A500。',
        'evidenceRefs 只能逐字复制对应标的输入中已有的引用。',
        '不得把人工计划草案升级为投资建议或自动下单指令。',
        'headline 和 overview 必须优先概括 portfolioActionSummary 中的配置偏离、当前批次、历史流水约束与轮动门禁；不得改写其中金额。',
        'portfolioComparison 是独立研究比较：actualAllocationContract 是人工计划合同，researchComparisonContract 只是研究候选；禁止把两者合并或把研究比例写成调仓指令。',
        '为控制长度，每个叙述字段不超过八个汉字，每个数组最多一项。',
        '只输出 JSON，不要 Markdown。',
        '根对象必须且只能包含 headline, overview, attentionSummaries, orderExplanations。',
        'attentionSummaries 必须为数组，输入每个 attentionCandidates 恰好对应一项；每项必须且只能包含 symbol, summary, reasons, watchItems, risk, evidenceRefs。reasons、watchItems、evidenceRefs 必须是字符串数组，risk 必须是字符串。',
        'orderExplanations 必须为数组；本轮 decisionAssets 为空，所以必须原样输出空数组。订单推导由确定性引擎展示，不由你重复生成。',
        '输入列表为空时对应输出必须是空数组；绝对不得自行创建数组项或标的。',
        '不要省略字段；没有内容时使用空数组或简短的审慎说明，不要使用 null。',
      ].join('\n'),
      messages: [{
        role: 'user',
        timestamp: Date.now(),
        content: [
          `请基于以下白名单证据生成简体中文汇总：\n${JSON.stringify(compactInput)}`,
          `复制以下完整 JSON 骨架，只替换所有“待填写”叙述，不得改 symbol、evidenceRefs、数组顺序或 JSON 标点：${JSON.stringify({
            headline: '待填写',
            overview: '待填写',
            attentionSummaries: (compactInput.attentionCandidates || []).map((item: any) => ({
              symbol: item.symbol,
              summary: '待填写',
              reasons: ['待填写'],
              watchItems: ['待填写'],
              risk: '待填写',
              evidenceRefs: item.evidenceRefs,
            })),
            orderExplanations: [],
          })}`,
        ].join('\n'),
      }],
    }
    try {
      const responseText = config.provider === 'minimax'
        ? await completeMinimax(config, context)
        : await completeOpenAiCompatible(config, context)
      const parsedResult = parseJsonObject(responseText)
      if (!parsedResult.parsed) {
        return buildDailyReviewSynthesisFallback(input, 'llm_json_invalid', true, {
          ...parsedResult.diagnostics,
          containsJsonFence: /```json/i.test(responseText),
        })
      }
      const contentNormalization = normalizeKnownNarrativeTypos(parsedResult.parsed as Record<string, any>)
      const validated = validateDailyReviewSynthesisPayload(contentNormalization.value, synthesisInput)
      if (!validated.ok) return buildDailyReviewSynthesisFallback(input, validated.code, true, validated.diagnostics || null)
      return {
        schemaVersion: 'fams.daily-review-llm-synthesis.v1',
        status: 'available',
        source: 'llm',
        model: config.model,
        generatedAt: new Date().toISOString(),
        attempted: true,
        attemptCount: 1,
        failureCode: null,
        transportNormalization: parsedResult.normalization,
        contentNormalizations: contentNormalization.changes,
        ...validated.data,
      }
    } catch (error) {
      const anyError = error as any
      const timedOut = (error instanceof DOMException && error.name === 'TimeoutError')
        || anyError?.code === 'ECONNABORTED'
        || anyError?.code === 'ERR_CANCELED'
        || /timeout|aborted/i.test(String(anyError?.message || ''))
      const code = timedOut
        ? 'llm_timeout'
        : 'llm_request_failed'
      return buildDailyReviewSynthesisFallback(input, code, true, {
        name: anyError?.name || 'Error',
        code: anyError?.code || null,
        httpStatus: anyError?.response?.status || null,
        providerErrorType: anyError?.response?.data?.error?.type || null,
        providerErrorCode: anyError?.response?.data?.error?.code || null,
        message: clean(
          anyError?.response?.data?.error?.message
            || anyError?.response?.data?.message
            || anyError?.response?.data?.detail
            || (typeof anyError?.response?.data === 'string' ? anyError.response.data : '')
            || anyError?.message,
          240,
        ),
      })
    }
  }
}

export const dailyReviewSynthesisService = new DailyReviewSynthesisService()
