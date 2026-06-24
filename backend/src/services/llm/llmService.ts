/**
 * LLM Service - 基于大语言模型的股票分析服务
 *
 * 职责：
 * 1. 接收股票技术面数据
 * 2. 构建 Prompt 并调用 LLM
 * 3. 解析 LLM 响应生成结构化事实解释
 */

import { stockAnalysisService } from '../technical/stockAnalysisService.js'
import { postJson } from '../../utils/httpJson.js'

// LLM 请求接口
export interface LLMStockAnalysisRequest {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number
  turnover: number
  ma5: number
  ma10: number
  ma20: number
  rsi: number
  macd: { dif: number; dea: number; hist: number }
  boll: { upper: number; middle: number; lower: number }
  kdj: { k: number; d: number; j: number }
  atr: number
  volatility: number
  support: number
  resistance: number
  trend: string
}

// LLM 响应接口
export interface LLMEvidencePoint {
  id: string
  label: string
  value: string
  source: string
}

export interface LLMReasoningPoint {
  title: string
  detail: string
  evidenceRefs: string[]
}

export interface LLMStockAdvice {
  symbol: string
  name: string
  provider: 'minimax' | 'deepseek' | 'fallback'
  isAiGenerated: boolean
  status: 'available' | 'insufficient_data'
  observation: string
  confidence: string
  summary: string
  evidence: LLMEvidencePoint[]
  evidenceRefs: string[]
  reasoning: LLMReasoningPoint[]
  dataGaps: string[]
  riskWarning: string
  disclaimer: string
}

function buildEvidenceFacts(data: LLMStockAnalysisRequest): LLMEvidencePoint[] {
  return [
    { id: 'quote.price', label: '当前价格', value: `${data.price.toFixed(2)}元`, source: '行情快照' },
    { id: 'quote.changePercent', label: '涨跌幅', value: `${data.changePercent > 0 ? '+' : ''}${data.changePercent.toFixed(2)}%`, source: '行情快照' },
    { id: 'quote.volume', label: '成交量', value: `${(data.volume / 10000).toFixed(2)}万手`, source: '行情快照' },
    { id: 'technical.ma', label: '均线', value: `MA5=${data.ma5.toFixed(2)}, MA10=${data.ma10.toFixed(2)}, MA20=${data.ma20.toFixed(2)}`, source: '技术指标' },
    { id: 'technical.rsi', label: 'RSI', value: data.rsi.toFixed(1), source: '技术指标' },
    { id: 'technical.macd', label: 'MACD', value: `DIF=${data.macd.dif.toFixed(3)}, DEA=${data.macd.dea.toFixed(3)}, 柱=${data.macd.hist.toFixed(3)}`, source: '技术指标' },
    { id: 'technical.boll', label: 'BOLL', value: `上轨=${data.boll.upper.toFixed(2)}, 中轨=${data.boll.middle.toFixed(2)}, 下轨=${data.boll.lower.toFixed(2)}`, source: '技术指标' },
    { id: 'technical.kdj', label: 'KDJ', value: `K=${data.kdj.k.toFixed(1)}, D=${data.kdj.d.toFixed(1)}, J=${data.kdj.j.toFixed(1)}`, source: '技术指标' },
    { id: 'technical.atr', label: 'ATR', value: `${data.atr.toFixed(2)}元`, source: '技术指标' },
    { id: 'technical.volatility', label: '波动率', value: `${(data.volatility * 100).toFixed(1)}%`, source: '技术指标' },
    { id: 'technical.range', label: '支撑/阻力观测', value: `支撑=${data.support.toFixed(2)}, 阻力=${data.resistance.toFixed(2)}`, source: '技术指标' },
    { id: 'technical.trend', label: '趋势判断', value: data.trend, source: '技术指标' },
  ]
}

function containsTradeDecision(text: string): boolean {
  return /(BUY|SELL|HOLD|买入|卖出|增持|减持|加仓|减仓|持有|建议买入|建议加仓|建议减仓|立即买入|可以下单|执行交易|entryPrice|stopLoss|takeProfit|positionSize|买入区间|止损|止盈|仓位)/i.test(text)
}

// 构建 Prompt
function buildPrompt(data: LLMStockAnalysisRequest): string {
  const facts = buildEvidenceFacts(data)
    .map((fact) => `- ${fact.id}｜${fact.label}｜${fact.value}｜来源：${fact.source}`)
    .join('\n')

  return `# 角色
你是一位证券数据分析助手。你的任务是解释结构化事实集中的可观察现象和证据强弱，不给出交易决策。

# 标的
股票代码：${data.symbol}
股票名称：${data.name}

# 结构化事实集
${facts}

# 输出要求
仅输出 JSON，不要 Markdown。字段：
{
  "status": "available 或 insufficient_data",
  "observation": "一句话观察，只描述事实含义，不包含买入/卖出/加仓/减仓/仓位等决策",
  "confidence": "高/中/低",
  "summary": "2-3句话说明证据链",
  "evidenceRefs": ["必须只引用上方事实 id"],
  "reasoning": [
    { "title": "观察点", "detail": "解释该事实组合说明了什么", "evidenceRefs": ["事实 id"] }
  ],
  "dataGaps": ["缺少的基本面/新闻/更长周期数据"],
  "riskWarning": "只说明不确定性和数据风险",
  "disclaimer": "仅作数据观察，不构成投资建议或交易依据。"
}

# 严格禁止
- 禁止输出 BUY/SELL/HOLD 或 买入/卖出/增持/减持/加仓/减仓/持有 等交易动作。
- 禁止输出 entryPrice、stopLoss、takeProfit、positionSize、买入区间、止损、止盈、仓位。
- 禁止给出任何可执行交易价格、目标价、仓位比例或下单时点。
- 若无法为结论提供 evidenceRefs，status 必须为 "insufficient_data"，observation 必须写“数据不足，仅能作为观察”。
`
}

// 解析 LLM 响应
function parseResponse(text: string): Partial<LLMStockAdvice> {
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] || text
  try {
    const parsed = JSON.parse(jsonText)
    const evidenceRefs = Array.isArray(parsed.evidenceRefs) ? parsed.evidenceRefs.filter((item: unknown) => typeof item === 'string') : []
    const reasoning = Array.isArray(parsed.reasoning)
      ? parsed.reasoning.map((item: any) => ({
        title: typeof item?.title === 'string' ? item.title : '观察',
        detail: typeof item?.detail === 'string' ? item.detail : '',
        evidenceRefs: Array.isArray(item?.evidenceRefs) ? item.evidenceRefs.filter((ref: unknown) => typeof ref === 'string') : [],
      })).filter((item: LLMReasoningPoint) => item.detail)
      : []
    const returnedTradeDecision = containsTradeDecision(text)
    if (returnedTradeDecision) {
      return {
        status: 'insufficient_data',
        observation: '数据不足，仅能作为观察',
        confidence: '低',
        summary: 'LLM 返回了交易决策或交易参数表述，系统已屏蔽该内容。',
        evidenceRefs: [],
        reasoning: [],
        dataGaps: ['LLM 输出缺少合规的事实解释结构', 'LLM 返回内容包含交易决策表述'],
        riskWarning: '当前结果不可作为可追溯事实解释展示。',
        disclaimer: '仅作数据观察，不构成投资建议或交易依据。',
      }
    }

    return {
      status: parsed.status === 'available' && evidenceRefs.length > 0 ? 'available' : 'insufficient_data',
      observation: typeof parsed.observation === 'string' ? parsed.observation : '',
      confidence: typeof parsed.confidence === 'string' ? parsed.confidence : '低',
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      evidenceRefs,
      reasoning,
      dataGaps: Array.isArray(parsed.dataGaps) ? parsed.dataGaps.filter((item: unknown) => typeof item === 'string') : [],
      riskWarning: typeof parsed.riskWarning === 'string' ? parsed.riskWarning : '',
      disclaimer: typeof parsed.disclaimer === 'string' ? parsed.disclaimer : '仅作数据观察，不构成投资建议或交易依据。',
    }
  } catch {
    return {
      status: 'insufficient_data',
      observation: '数据不足，仅能作为观察',
      confidence: '低',
      summary: text.replace(/\s+/g, ' ').slice(0, 240),
      evidenceRefs: [],
      reasoning: [],
      dataGaps: ['LLM 未返回可校验的结构化证据引用'],
      riskWarning: '缺少 evidenceRefs，无法形成可追溯解释。',
      disclaimer: '仅作数据观察，不构成投资建议或交易依据。',
    }
  }
}

// 调用 LLM（优先 MiniMax，失败后降级到 DeepSeek）
async function callLLM(prompt: string): Promise<{ provider: 'minimax' | 'deepseek'; text: string }> {
  // 优先使用 MiniMax
  const minimaxKey = process.env.MINIMAX_API_KEY
  if (minimaxKey) {
    try {
      const response = await postJson<any>(
        'https://api.minimax.chat/v1/text/chatcompletion_pro',
        {
          model: 'abab6.5s-chat',
          messages: [{ role: 'user', content: prompt, sender_name: 'user', sender_type: 'USER' }],
          bot_setting: [{ bot_name: 'assistant', content: '你是一位证券数据分析助手，只解释事实和证据，不给出交易决策。' }],
          reply_constraints: { role: 'assistant', content_type: 'text', sender_type: 'BOT', sender_name: 'assistant' }
        },
        {
          headers: {
            'Authorization': `Bearer ${minimaxKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      )

      const reply = response?.reply
      if (reply) return { provider: 'minimax', text: reply }

      // 检查余额不足
      const baseResp = response?.base_resp
      if (baseResp?.status_code === 1008 || baseResp?.status_msg?.includes('balance')) {
        throw new Error('MiniMax 余额不足')
      }
    } catch (error: any) {
      const isBalanceIssue = error.message?.includes('余额不足') ||
        error.response?.data?.base_resp?.status_code === 1008
      if (!isBalanceIssue) throw error
      console.warn('MiniMax 不可用，尝试 DeepSeek...')
    }
  }

  // 降级到 DeepSeek
  const deepseekKey = process.env.DEEPSEEK_API_KEY
  if (!deepseekKey) {
    throw new Error('DEEPSEEK_API_KEY 环境变量未设置')
  }

  const response = await postJson<any>(
    'https://api.deepseek.com/chat/completions',
    {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }]
    },
    {
      headers: {
        'Authorization': `Bearer ${deepseekKey}`,
        'Content-Type': 'application/json'
      },
      timeout: 30000
    }
  )

  const choices = response?.choices
  if (choices && choices.length > 0) {
    return { provider: 'deepseek', text: choices[0].message?.content || '' }
  }

  throw new Error('LLM 响应格式错误')
}

class LLMService {
  /**
   * 生成股票事实观察
   * @param symbol 股票代码
   * @param market 市场类型
   */
  async generateStockAdvice(symbol: string, market: string = 'A股'): Promise<LLMStockAdvice> {
    // 1. 获取股票技术面数据。真实数据不可用时直接失败，避免用错误标的生成“看起来正确”的 AI 结论。
    let analysis: any
    try {
      analysis = await stockAnalysisService.getFullAnalysis(symbol, market, 30)
      if (!analysis || analysis.currentPrice == null || !analysis.macd) {
        throw new Error(`股票 ${symbol} 的行情或技术指标不完整`)
      }
    } catch (error: any) {
      throw new Error(`股票 ${symbol} 真实行情不可用，已停止 AI 分析：${error.message}`)
    }

    // 2. 构建请求数据
    const requestData: LLMStockAnalysisRequest = {
      symbol: analysis.code,
      name: analysis.name || `股票-${analysis.code}`,
      price: analysis.currentPrice ?? 100,
      change: analysis.priceChange ?? 0,
      changePercent: analysis.priceChangePercent ?? 0,
      volume: analysis.volume ?? 0,
      turnover: analysis.turnover ?? 0,
      ma5: analysis.ma5 ?? 100,
      ma10: analysis.ma10 ?? 100,
      ma20: analysis.ma20 ?? 100,
      rsi: analysis.rsi ?? 50,
      macd: analysis.macd ? { dif: analysis.macd.dif, dea: analysis.macd.dea, hist: analysis.macd.macdHist ?? 0 } : { dif: 0, dea: 0, hist: 0 },
      boll: analysis.boll ?? { upper: 110, middle: 100, lower: 90 },
      kdj: analysis.kdj ?? { k: 50, d: 50, j: 50 },
      atr: analysis.atr ?? 0,
      volatility: analysis.volatility ?? 0.02,
      support: analysis.supportResistance?.support ?? ((analysis.currentPrice ?? 100) * 0.95),
      resistance: analysis.supportResistance?.resistance ?? ((analysis.currentPrice ?? 100) * 1.05),
      trend: analysis.trend ?? '震荡'
    }

    // 3. 构建 Prompt
    const prompt = buildPrompt(requestData)

    // 4. 调用 LLM
    let llmResponse: string
    try {
      const llmResult = await callLLM(prompt)
      llmResponse = llmResult.text
      const evidence = buildEvidenceFacts(requestData)
      const validEvidenceIds = new Set(evidence.map((item) => item.id))
      const parsed = parseResponse(llmResponse)
      const evidenceRefs = (parsed.evidenceRefs || []).filter((ref) => validEvidenceIds.has(ref))
      const reasoning = (parsed.reasoning || []).map((item) => ({
        ...item,
        evidenceRefs: item.evidenceRefs.filter((ref) => validEvidenceIds.has(ref)),
      }))
      const hasEvidence = evidenceRefs.length > 0 || reasoning.some((item) => item.evidenceRefs.length > 0)

      return {
        symbol: requestData.symbol,
        name: requestData.name,
        provider: llmResult.provider,
        isAiGenerated: true,
        status: hasEvidence && parsed.status === 'available' ? 'available' : 'insufficient_data',
        observation: hasEvidence ? (parsed.observation || '已生成基于结构化事实的观察。') : '数据不足，仅能作为观察',
        confidence: parsed.confidence || (hasEvidence ? '中' : '低'),
        summary: parsed.summary || (hasEvidence ? 'LLM 已基于行情和技术指标形成事实解释。' : 'LLM 未返回可校验的 evidenceRefs，当前不展示结论性解释。'),
        evidence,
        evidenceRefs,
        reasoning,
        dataGaps: parsed.dataGaps || [],
        riskWarning: parsed.riskWarning || '仅基于当前结构化数据，缺少完整基本面、新闻和更长周期验证。',
        disclaimer: parsed.disclaimer || '仅作数据观察，不构成投资建议或交易依据。'
      }
    } catch (error: any) {
      console.error('LLM 调用失败:', error.message)
      return this.generateFallbackAdvice(requestData)
    }
  }

  /**
   * 生成兜底观察（LLM 不可用时）
   */
  private generateFallbackAdvice(data: LLMStockAnalysisRequest): LLMStockAdvice {
    const { rsi, trend, volatility } = data
    const evidence = buildEvidenceFacts(data)
    const evidenceRefs = ['technical.rsi', 'technical.trend', 'technical.volatility', 'technical.macd']
    const rsiState = rsi > 70 ? '偏高' : rsi < 30 ? '偏低' : '处于中性区间'
    const riskWarning = '本地兜底仅解释行情和技术指标，缺少基本面、新闻和多源校验。'

    return {
      symbol: data.symbol,
      name: data.name,
      provider: 'fallback',
      isAiGenerated: false,
      status: evidenceRefs.length > 0 ? 'available' : 'insufficient_data',
      observation: `当前仅能观察到技术面：RSI ${rsiState}，趋势为${trend || '未知'}。`,
      confidence: '低',
      summary: `本地规则兜底基于 RSI、趋势、MACD 和波动率生成事实观察；未使用 LLM，也未形成交易决策。`,
      evidence,
      evidenceRefs,
      reasoning: [
        {
          title: '动量状态',
          detail: `RSI=${rsi != null ? rsi.toFixed(1) : 'N/A'}，${rsiState}。`,
          evidenceRefs: ['technical.rsi'],
        },
        {
          title: '趋势与波动',
          detail: `趋势判断为${trend || '未知'}，波动率约为${volatility != null ? (volatility * 100).toFixed(1) : 'N/A'}%。`,
          evidenceRefs: ['technical.trend', 'technical.volatility'],
        },
        {
          title: '指标交叉观察',
          detail: `MACD 当前为 DIF=${data.macd.dif.toFixed(3)}、DEA=${data.macd.dea.toFixed(3)}、柱=${data.macd.hist.toFixed(3)}。`,
          evidenceRefs: ['technical.macd'],
        },
      ],
      dataGaps: ['缺少完整基本面数据', '缺少新闻事件和公告校验', '缺少更长周期行情对照'],
      riskWarning,
      disclaimer: '仅作数据观察，不构成投资建议或交易依据。'
    }
  }
}

export const llmService = new LLMService()
