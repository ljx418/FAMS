import React from 'react'
import { Card, Row, Col, Tag } from 'antd'

interface TechnicalIndicatorsData {
  kdj?: { k: number; d: number; j: number }
  macd?: { dif: number; dea: number; histogram: number }
  boll?: { upper: number; middle: number; lower: number }
  atr?: number
  rsi?: number
  ma?: { ma5: number; ma10: number; ma20: number }
  support?: number
  resistance?: number
  externalTechnical?: ExternalTechnical
  technicalAdvice?: TechnicalAdvice
  factSet?: StockAnalysisFactSet
  analysisSummary?: StockAnalysisSummary
  cache?: StockAnalysisCache
}

interface StockAnalysisCache {
  status: 'fresh' | 'stale' | 'generating' | 'failed' | 'partial'
  refreshed: boolean
  generatedAt: string
  staleAt: string
  nextRefreshAfter: string
  warnings: string[]
}

interface StockAnalysisSummary {
  overallStatus: 'partial' | 'blocked'
  technical: StockAnalysisSummarySection
  fundamental: StockAnalysisSummarySection
  news: StockAnalysisSummarySection
  blockedReasons: string[]
}

interface StockAnalysisSummarySection {
  status: 'available' | 'partial' | 'blocked'
  summary: string
  evidenceRefs: string[]
  blockedReasons: string[]
}

interface StockAnalysisFactSet {
  schemaVersion: string
  technical: StockAnalysisFactSection
  fundamental: StockAnalysisFactSection
  news: StockAnalysisFactSection
}

interface StockAnalysisFactSection {
  quality: 'ok' | 'insufficient_data' | 'provider_failed'
  facts: Array<{
    id: string
    label: string
    value: string | number | null
    source: string
    quality: 'ok' | 'insufficient_data' | 'provider_failed'
  }>
  warnings: string[]
}

interface TechnicalAdvice {
  status: 'available' | 'blocked'
  stance: 'constructive' | 'neutral' | 'defensive' | 'avoid_chase' | 'insufficient_data'
  summary: string
  observation: string
  risk: string
  actionBoundary: string
  model: {
    id: string
    name: string
    version: string
    source: string
    confidenceGate: number
  }
  evidence: Array<{
    id: string
    label: string
    value: string
    source: string
  }>
  blockedReasons: string[]
}

interface ExternalTechnical {
  providerLabel: string
  providerSymbol: string | null
  asOf: string
  quality: string
  model: {
    name: string
    version: string
    description: string
  }
  rating: null | {
    allScore?: number
    maScore?: number
    oscillatorScore?: number
    all: string
    ma: string
    oscillator: string
  }
  confidence: {
    score: number
    level: 'high' | 'medium' | 'low'
    sourceCount: number
    checks: Array<{
      name: string
      status: 'pass' | 'warn' | 'fail'
      detail: string
      deltaPercent?: number
    }>
  }
  indicators: {
    close?: number
    changePercent?: number
    volume?: number
    rsi14?: number
    macd?: number
    macdSignal?: number
    macdHistogram?: number
    stochK?: number
    stochD?: number
    bollUpper?: number
    bollLower?: number
    atr14?: number
    sma5?: number
    sma10?: number
    sma20?: number
  }
  warnings: string[]
}

interface TechnicalIndicatorsProps {
  kdj?: { k: number; d: number; j: number }
  macd?: { dif: number; dea: number; histogram: number }
  boll?: { upper: number; middle: number; lower: number }
  atr?: number
  rsi?: number
  ma?: { ma5: number; ma10: number; ma20: number }
  support?: number
  resistance?: number
  externalTechnical?: ExternalTechnical
  technicalAdvice?: TechnicalAdvice
  factSet?: StockAnalysisFactSet
  analysisSummary?: StockAnalysisSummary
  cache?: StockAnalysisCache
}

const TechnicalIndicators: React.FC<TechnicalIndicatorsProps> = (props) => {
  const indicators: TechnicalIndicatorsData = props
  const external = indicators.externalTechnical
  const technicalAdvice = indicators.technicalAdvice
  const factSet = indicators.factSet
  const analysisSummary = indicators.analysisSummary
  const cache = indicators.cache
  const externalIndicators = external?.indicators || {}

  const ratingColor = (label?: string) => {
    if (!label) return 'default'
    if (label.includes('买入')) return 'green'
    if (label.includes('卖出')) return 'red'
    return 'gold'
  }

  const confidenceColor = (level?: string) => {
    if (level === 'high') return 'green'
    if (level === 'medium') return 'gold'
    return 'red'
  }

  const stanceColor = (stance?: string) => {
    if (stance === 'constructive') return 'green'
    if (stance === 'defensive' || stance === 'avoid_chase') return 'red'
    if (stance === 'neutral') return 'gold'
    return 'default'
  }

  const renderKDJStatus = (k?: number, d?: number, j?: number) => {
    if (k === undefined || d === undefined || j === undefined) return 'neutral'
    if (k > 80 && d > 80) return 'overbought'
    if (k < 20 && d < 20) return 'oversold'
    if (k > d) return 'golden'
    return 'death'
  }

  const kdjStatus = renderKDJStatus(
    indicators.kdj?.k,
    indicators.kdj?.d,
    indicators.kdj?.j
  )

  const getKDJColor = (status: string) => {
    switch (status) {
      case 'overbought':
        return 'danger'
      case 'oversold':
        return 'success'
      case 'golden':
        return '#5a6bff'
      default:
        return '#FAC858'
    }
  }

  const getRSIColor = (rsi?: number) => {
    if (rsi === undefined) return '#A0A0A0'
    if (rsi >= 70) return 'danger'
    if (rsi <= 30) return 'success'
    return '#FAC858'
  }

  const getRSILabel = (rsi?: number) => {
    if (rsi === undefined) return '--'
    if (rsi >= 70) return '超买'
    if (rsi <= 30) return '超卖'
    return '中性'
  }

  return (
    <Card
      title={<span className="text-white text-sm">技术指标</span>}
      className="bg-[#1a1a2e] border-[surface-border]"
      size="small"
    >
      <Row gutter={[8, 8]}>
        <Col xs={24}>
          <div className="p-3 bg-[#0f0f23] rounded border border-[#2a2a40]">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="text-white text-sm font-medium">外部技术指标</span>
              <Tag color={external?.quality === 'ok' ? 'green' : 'red'}>{external?.providerLabel || '未接入'}</Tag>
              {external?.providerSymbol && <Tag color="blue">{external.providerSymbol}</Tag>}
              {external?.confidence && <Tag color={confidenceColor(external.confidence.level)}>可信度 {external.confidence.score}</Tag>}
              {external?.rating && <Tag color={ratingColor(external.rating.all)}>综合 {external.rating.all}</Tag>}
              {external?.rating && <Tag color={ratingColor(external.rating.ma)}>均线 {external.rating.ma}</Tag>}
              {external?.rating && <Tag color={ratingColor(external.rating.oscillator)}>振荡器 {external.rating.oscillator}</Tag>}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs text-gray-300">
              <div>RSI14: <span className="text-white">{externalIndicators.rsi14?.toFixed(2) || '--'}</span></div>
              <div>MACD: <span className="text-white">{externalIndicators.macd?.toFixed(4) || '--'}</span></div>
              <div>ATR14: <span className="text-white">{externalIndicators.atr14?.toFixed(4) || '--'}</span></div>
              <div>涨跌幅: <span className="text-white">{externalIndicators.changePercent?.toFixed(2) || '--'}%</span></div>
              <div>SMA5: <span className="text-white">{externalIndicators.sma5?.toFixed(2) || '--'}</span></div>
              <div>SMA10: <span className="text-white">{externalIndicators.sma10?.toFixed(2) || '--'}</span></div>
              <div>SMA20: <span className="text-white">{externalIndicators.sma20?.toFixed(2) || '--'}</span></div>
              <div>更新时间: <span className="text-white">{external?.asOf ? new Date(external.asOf).toLocaleString() : '--'}</span></div>
            </div>
            <div className="text-xs text-gray-500 mt-2">
              模型：{external?.model?.name || '--'}；来源数：{external?.confidence?.sourceCount || 0}；本地指标仅作复核，不生成交易建议。
              {external?.warnings?.length ? ` ${external.warnings[0]}` : ''}
            </div>
            {external?.confidence?.checks?.length ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-1 mt-2 text-xs">
                {external.confidence.checks.slice(0, 5).map((check) => (
                  <div key={check.name} className="text-gray-400">
                    <Tag className="mr-1" color={check.status === 'pass' ? 'green' : check.status === 'warn' ? 'gold' : 'red'}>
                      {check.status === 'pass' ? '通过' : check.status === 'warn' ? '关注' : '失败'}
                    </Tag>
                    {check.detail}
                  </div>
                ))}
              </div>
            ) : null}
            {technicalAdvice ? (
              <div className="mt-3 p-2 rounded bg-[#15152a] border border-[#30304a]">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-white text-sm">技术建议模型</span>
                  <Tag color={technicalAdvice.status === 'available' ? 'green' : 'red'}>
                    {technicalAdvice.status === 'available' ? '可用' : '阻断'}
                  </Tag>
                  <Tag color={stanceColor(technicalAdvice.stance)}>{technicalAdvice.summary}</Tag>
                  <Tag color="blue">{technicalAdvice.model.version}</Tag>
                </div>
                <div className="text-xs text-gray-300">{technicalAdvice.observation}</div>
                <div className="text-xs text-gray-400 mt-1">边界：{technicalAdvice.actionBoundary}</div>
                <div className="text-xs text-gray-500 mt-1">风险：{technicalAdvice.risk}</div>
                {technicalAdvice.blockedReasons.length > 0 ? (
                  <div className="text-xs text-red-300 mt-1">{technicalAdvice.blockedReasons.join('；')}</div>
                ) : null}
              </div>
            ) : null}
            {factSet ? (
              <div className="mt-3 p-2 rounded bg-[#111126] border border-[#30304a]">
                {analysisSummary ? (
                  <div className="mb-3 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-white text-sm">三面汇总</span>
                      <Tag color="gold">{analysisSummary.overallStatus}</Tag>
                      <Tag color={analysisSummary.technical.status === 'available' ? 'green' : 'red'}>技术 {analysisSummary.technical.status}</Tag>
                      <Tag color={analysisSummary.fundamental.status === 'blocked' ? 'red' : 'gold'}>基本面 {analysisSummary.fundamental.status}</Tag>
                      <Tag color={analysisSummary.news.status === 'blocked' ? 'red' : 'gold'}>消息面 {analysisSummary.news.status}</Tag>
                    </div>
                    <div className="text-xs text-gray-300">{analysisSummary.technical.summary}</div>
                    <div className="text-xs text-gray-400">{analysisSummary.fundamental.summary}</div>
                    <div className="text-xs text-gray-400">{analysisSummary.news.summary}</div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-white text-sm">事实集</span>
                  {cache ? (
                    <Tag color={cache.status === 'fresh' ? 'green' : cache.status === 'failed' ? 'red' : 'gold'}>
                      {cache.refreshed ? '刚刷新' : cache.status === 'fresh' ? '缓存新鲜' : cache.status}
                    </Tag>
                  ) : null}
                  <Tag color={factSet.technical.quality === 'ok' ? 'green' : 'red'}>技术面 {factSet.technical.quality}</Tag>
                  <Tag color={factSet.fundamental.quality === 'ok' ? 'green' : 'red'}>基本面 {factSet.fundamental.quality}</Tag>
                  <Tag color={factSet.news.quality === 'ok' ? 'green' : 'red'}>消息面 {factSet.news.quality}</Tag>
                </div>
                {cache ? (
                  <div className="mb-2 text-[11px] text-gray-500">
                    生成 {new Date(cache.generatedAt).toLocaleString()} · 下次刷新 {new Date(cache.nextRefreshAfter).toLocaleString()}
                  </div>
                ) : null}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs text-gray-400">
                  {factSet.technical.facts.slice(0, 6).map((fact) => (
                    <div key={fact.id}>
                      <span className="text-gray-500">{fact.label}：</span>
                      <span className="text-gray-200">{fact.value ?? '--'}</span>
                      <span className="text-gray-600"> · {fact.source}</span>
                    </div>
                  ))}
                </div>
                {factSet.fundamental.facts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-1 text-xs text-gray-400 mt-2">
                    {factSet.fundamental.facts.slice(0, 12).map((fact) => (
                      <div key={fact.id}>
                        <span className="text-gray-500">{fact.label}：</span>
                        <span className="text-gray-200">{fact.value ?? '--'}</span>
                        <span className="text-gray-600"> · {fact.source}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {factSet.news.facts.length > 0 ? (
                  <div className="space-y-1 mt-2 text-xs text-gray-400">
                    {factSet.news.facts.slice(0, 4).map((fact) => (
                      <div key={fact.id}>
                        <span className="text-gray-500">{fact.label}：</span>
                        <span className="text-gray-200">{fact.value ?? '--'}</span>
                        <span className="text-gray-600"> · {fact.source}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                {[...factSet.fundamental.warnings, ...factSet.news.warnings].slice(0, 2).map((warning) => (
                  <div key={warning} className="text-xs text-yellow-300 mt-1">{warning}</div>
                ))}
              </div>
            ) : null}
          </div>
        </Col>

        {/* KDJ */}
        <Col xs={12} sm={8} md={6}>
          <div className="p-2 bg-[#0f0f23] rounded">
            <div className="text-gray-300 text-xs mb-1">KDJ</div>
            <div className="flex gap-2 text-xs">
              <span style={{ color: getKDJColor(kdjStatus) }}>
                K: {indicators.kdj?.k?.toFixed(1) || '--'}
              </span>
              <span style={{ color: getKDJColor(kdjStatus) }}>
                D: {indicators.kdj?.d?.toFixed(1) || '--'}
              </span>
              <span style={{ color: getKDJColor(kdjStatus) }}>
                J: {indicators.kdj?.j?.toFixed(1) || '--'}
              </span>
            </div>
            <Tag
              className="mt-1 text-xs"
              color={kdjStatus === 'overbought' ? 'red' : kdjStatus === 'oversold' ? 'green' : 'blue'}
            >
              {kdjStatus === 'overbought' ? '超买' : kdjStatus === 'oversold' ? '超卖' : kdjStatus === 'golden' ? '金叉' : '死叉'}
            </Tag>
          </div>
        </Col>

        {/* MACD */}
        <Col xs={12} sm={8} md={6}>
          <div className="p-2 bg-[#0f0f23] rounded">
            <div className="text-gray-300 text-xs mb-1">MACD</div>
            <div className="flex flex-col gap-0.5 text-xs">
              <span className="text-[#00BFFF]">
                DIF: {indicators.macd?.dif?.toFixed(3) || '--'}
              </span>
              <span className="text-[#FAC858]">
                DEA: {indicators.macd?.dea?.toFixed(3) || '--'}
              </span>
              <span className={indicators.macd && indicators.macd.histogram > 0 ? 'text-[danger]' : 'text-[success]'}>
                柱: {indicators.macd?.histogram?.toFixed(3) || '--'}
              </span>
            </div>
          </div>
        </Col>

        {/* BOLL */}
        <Col xs={12} sm={8} md={6}>
          <div className="p-2 bg-[#0f0f23] rounded">
            <div className="text-gray-300 text-xs mb-1">BOLL布林带</div>
            <div className="flex flex-col gap-0.5 text-xs">
              <span className="text-[danger]">
                上轨: {indicators.boll?.upper?.toFixed(2) || '--'}
              </span>
              <span className="text-[#FAC858]">
                中轨: {indicators.boll?.middle?.toFixed(2) || '--'}
              </span>
              <span className="text-[success]">
                下轨: {indicators.boll?.lower?.toFixed(2) || '--'}
              </span>
            </div>
          </div>
        </Col>

        {/* ATR */}
        <Col xs={12} sm={8} md={6}>
          <div className="p-2 bg-[#0f0f23] rounded">
            <div className="text-gray-300 text-xs mb-1">ATR波动率</div>
            <div className="text-[#5a6bff] text-lg font-medium">
              {indicators.atr?.toFixed(2) || '--'}
            </div>
            <div className="text-gray-500 text-xs">真实波动幅度</div>
          </div>
        </Col>

        {/* RSI */}
        <Col xs={12} sm={8} md={6}>
          <div className="p-2 bg-[#0f0f23] rounded">
            <div className="text-gray-300 text-xs mb-1">RSI强弱</div>
            <div
              className="text-lg font-medium"
              style={{ color: getRSIColor(indicators.rsi) }}
            >
              {indicators.rsi?.toFixed(1) || '--'}
            </div>
            <Tag
              className="text-xs"
              color={indicators.rsi && indicators.rsi >= 70 ? 'red' : indicators.rsi && indicators.rsi <= 30 ? 'green' : 'gold'}
            >
              {getRSILabel(indicators.rsi)}
            </Tag>
          </div>
        </Col>

        {/* MA均线 */}
        <Col xs={12} sm={8} md={6}>
          <div className="p-2 bg-[#0f0f23] rounded">
            <div className="text-gray-300 text-xs mb-1">均线 MA</div>
            <div className="flex flex-wrap gap-1 text-xs">
              <span className="text-[#FAC858]">5:{indicators.ma?.ma5?.toFixed(1) || '--'}</span>
              <span className="text-[#00BFFF]">10:{indicators.ma?.ma10?.toFixed(1) || '--'}</span>
              <span className="text-[#FF69B4]">20:{indicators.ma?.ma20?.toFixed(1) || '--'}</span>
            </div>
          </div>
        </Col>

        {/* 支撑压力位 */}
        <Col xs={12} sm={8} md={6}>
          <div className="p-2 bg-[#0f0f23] rounded">
            <div className="text-gray-300 text-xs mb-1">支撑/压力位</div>
            <div className="flex gap-2 text-xs">
              <span className="text-[success]">
                支撑: {indicators.support?.toFixed(2) || '--'}
              </span>
              <span className="text-[danger]">
                压力: {indicators.resistance?.toFixed(2) || '--'}
              </span>
            </div>
          </div>
        </Col>
      </Row>
    </Card>
  )
}

export default TechnicalIndicators
