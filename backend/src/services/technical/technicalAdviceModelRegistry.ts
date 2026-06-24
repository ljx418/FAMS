import type { ExternalTechnicalSnapshot } from './externalTechnicalDataProvider.js'

export type TechnicalAdviceStatus = 'available' | 'blocked'
export type TechnicalAdviceStance = 'constructive' | 'neutral' | 'defensive' | 'avoid_chase' | 'insufficient_data'

export interface TechnicalAdviceEvidence {
  id: string
  label: string
  value: string
  source: string
}

export interface TechnicalAdviceModelOutput {
  status: TechnicalAdviceStatus
  stance: TechnicalAdviceStance
  summary: string
  observation: string
  risk: string
  actionBoundary: string
  model: {
    id: 'tradingview_ratings_interpretation_v1'
    name: string
    version: string
    source: string
    confidenceGate: number
  }
  evidence: TechnicalAdviceEvidence[]
  evidenceRefs: string[]
  blockedReasons: string[]
}

function formatScore(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(3) : '--'
}

function formatNumber(value?: number, precision = 2) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(precision) : '--'
}

class TechnicalAdviceModelRegistry {
  private readonly confidenceGate = 80

  evaluateTradingViewRatings(snapshot: ExternalTechnicalSnapshot): TechnicalAdviceModelOutput {
    const model = {
      id: 'tradingview_ratings_interpretation_v1' as const,
      name: 'TradingView Technical Ratings Interpretation',
      version: '2026-05-18',
      source: 'TradingView Technical Ratings + FAMS cross-source validation',
      confidenceGate: this.confidenceGate,
    }
    const evidence = this.buildEvidence(snapshot)
    const blockedReasons: string[] = []

    if (snapshot.quality !== 'ok') blockedReasons.push(`外部技术指标质量为 ${snapshot.quality}`)
    if (!snapshot.rating) blockedReasons.push('缺少 TradingView Technical Ratings')
    if (snapshot.confidence.score < this.confidenceGate) {
      blockedReasons.push(`多源可信度 ${snapshot.confidence.score} 低于门槛 ${this.confidenceGate}`)
    }
    const failedChecks = snapshot.confidence.checks.filter((check) => check.status === 'fail')
    if (failedChecks.length > 0) {
      blockedReasons.push(`存在 ${failedChecks.length} 项跨源校验失败`)
    }

    if (blockedReasons.length > 0 || !snapshot.rating) {
      return {
        status: 'blocked',
        stance: 'insufficient_data',
        summary: '技术面建议已阻断',
        observation: '外部技术指标或多源校验未达到可信门槛，只展示事实，不生成建议。',
        risk: '禁止将低可信技术指标解释为买卖依据。',
        actionBoundary: '等待外部源恢复、跨源校验通过，或切换到人工审核模型。',
        model,
        evidence,
        evidenceRefs: evidence.map((item) => item.id),
        blockedReasons,
      }
    }

    const allScore = snapshot.rating.allScore ?? 0
    const maScore = snapshot.rating.maScore ?? 0
    const oscillatorScore = snapshot.rating.oscillatorScore ?? 0
    const rsi = snapshot.indicators.rsi14
    const macdHistogram = snapshot.indicators.macdHistogram

    let stance: TechnicalAdviceStance = 'neutral'
    if (allScore <= -0.5 && maScore <= -0.5) stance = 'defensive'
    else if (allScore >= 0.5 && maScore >= 0.5) stance = 'constructive'
    else if (allScore > 0.1 && maScore > 0.1) stance = 'constructive'
    else if (allScore < -0.1 && maScore < -0.1) stance = 'defensive'

    if (stance === 'constructive' && typeof rsi === 'number' && rsi >= 70) stance = 'avoid_chase'
    if (stance === 'constructive' && typeof macdHistogram === 'number' && macdHistogram < 0) stance = 'neutral'
    if (stance === 'defensive' && oscillatorScore > 0.1 && typeof rsi === 'number' && rsi < 35) stance = 'neutral'

    const summaryMap: Record<TechnicalAdviceStance, string> = {
      constructive: '技术面偏建设性',
      neutral: '技术面中性观察',
      defensive: '技术面偏防守',
      avoid_chase: '技术面偏强但不宜追高',
      insufficient_data: '技术面数据不足',
    }

    const observationMap: Record<TechnicalAdviceStance, string> = {
      constructive: '综合评级和均线评级同步偏正，趋势侧有支撑；仍需结合基本面、消息面和持仓约束。',
      neutral: '综合评级未形成明确方向，均线和振荡器信号存在分歧或动能不足。',
      defensive: '综合评级和均线评级偏负，趋势侧仍处于压力区，优先控制仓位和等待企稳信号。',
      avoid_chase: '趋势评分偏正但 RSI 已进入高位区，继续上行的风险收益比下降。',
      insufficient_data: '缺少足够可靠的外部指标和跨源校验。',
    }

    const riskMap: Record<TechnicalAdviceStance, string> = {
      constructive: '若后续跌破关键均线或 MACD 转负，应降低技术面权重。',
      neutral: '震荡区间内信号容易反复，单一指标不适合触发交易。',
      defensive: '弱趋势中抢反弹容易承受继续下探风险。',
      avoid_chase: '短线过热时追高容易遇到回撤，需等待回落或放量确认。',
      insufficient_data: '数据不足时不允许输出建议。',
    }

    const boundaryMap: Record<TechnicalAdviceStance, string> = {
      constructive: '可进入观察或候选池；是否建仓必须等待基本面、消息面和策略回测共同确认。',
      neutral: '维持观察，等待评级、量能或均线结构进一步收敛。',
      defensive: '不建议因技术面主动加仓；已有持仓优先检查止损和仓位上限。',
      avoid_chase: '不追高，等待回踩支撑或重新评估风险收益比。',
      insufficient_data: '仅展示事实，不生成操作建议。',
    }

    return {
      status: 'available',
      stance,
      summary: summaryMap[stance],
      observation: observationMap[stance],
      risk: riskMap[stance],
      actionBoundary: boundaryMap[stance],
      model,
      evidence,
      evidenceRefs: evidence.map((item) => item.id),
      blockedReasons: [],
    }
  }

  private buildEvidence(snapshot: ExternalTechnicalSnapshot): TechnicalAdviceEvidence[] {
    return [
      {
        id: 'tv_rating_all',
        label: 'TradingView 综合评级',
        value: `${snapshot.rating?.all || '--'} (${formatScore(snapshot.rating?.allScore)})`,
        source: snapshot.providerLabel,
      },
      {
        id: 'tv_rating_ma',
        label: 'TradingView 均线评级',
        value: `${snapshot.rating?.ma || '--'} (${formatScore(snapshot.rating?.maScore)})`,
        source: snapshot.providerLabel,
      },
      {
        id: 'tv_rating_oscillator',
        label: 'TradingView 振荡器评级',
        value: `${snapshot.rating?.oscillator || '--'} (${formatScore(snapshot.rating?.oscillatorScore)})`,
        source: snapshot.providerLabel,
      },
      {
        id: 'tv_rsi14',
        label: 'RSI14',
        value: formatNumber(snapshot.indicators.rsi14, 2),
        source: snapshot.providerLabel,
      },
      {
        id: 'cross_source_confidence',
        label: '多源可信度',
        value: `${snapshot.confidence.score}/${snapshot.confidence.level}`,
        source: 'FAMS cross-source validation',
      },
    ]
  }
}

export const technicalAdviceModelRegistry = new TechnicalAdviceModelRegistry()
