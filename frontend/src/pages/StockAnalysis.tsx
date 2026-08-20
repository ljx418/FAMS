import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Alert, Card, Row, Col, Button, Statistic, Spin, message, Tag } from 'antd'
import { ArrowLeftOutlined, ReloadOutlined, RobotOutlined, AlertOutlined } from '@ant-design/icons'
import KLinedChart from '../components/charts/KLinedChart'
import MACDChart from '../components/stock/MACDChart'
import ValuationCards from '../components/stock/ValuationCards'
import TechnicalIndicators from '../components/stock/TechnicalIndicators'
import FinancialTable from '../components/stock/FinancialTable'
import InvestmentAdvice from '../components/stock/InvestmentAdvice'
import type { KLineData } from '../components/charts'
import {
  generateMACDDataFromAnalysis,
  getLLMStockAdvice,
  getStockAnalysis,
  getStockMarketTrend,
  mapStockTrendToKLineData,
  type LLMStockAdvice,
  type StockAnalysisResponse,
  type StockMarketTrendResponse,
} from '../services/stockService'

const StockAnalysis: React.FC = () => {
  const { code } = useParams<{ code: string }>()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [analysis, setAnalysis] = useState<StockAnalysisResponse | null>(null)
  const [marketTrend, setMarketTrend] = useState<StockMarketTrendResponse | null>(null)
  const [marketTrendError, setMarketTrendError] = useState<string | null>(null)
  const [klineData, setKlineData] = useState<KLineData[]>([])
  const [macdData, setMacdData] = useState<ReturnType<typeof generateMACDDataFromAnalysis>>([])
  const [llmAdvice, setLlmAdvice] = useState<LLMStockAdvice | null>(null)
  const [llmLoading, setLlmLoading] = useState(false)

  const stockCode = code || '600519'

  const fetchData = async () => {
    setLoading(true)
    try {
      const [data, trendResult] = await Promise.all([
        getStockAnalysis(stockCode),
        getStockMarketTrend(stockCode, 30)
          .then((trend) => ({ trend, error: null }))
          .catch((error: unknown) => ({
            trend: null,
            error: error instanceof Error ? error.message : '真实行情走势获取失败',
          })),
      ])
      setAnalysis(data)
      setMarketTrend(trendResult.trend)
      setMarketTrendError(trendResult.error)

      // Only provider-returned bars are allowed on the chart. Never synthesize price paths.
      const kData = trendResult.trend ? mapStockTrendToKLineData(trendResult.trend) : []
      setKlineData(kData)

      // Generate MACD data
      const mData = generateMACDDataFromAnalysis(kData)
      setMacdData(mData)
    } catch (error) {
      console.error('Failed to fetch stock analysis:', error)
      message.error('获取股票数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [stockCode])

  const handleRefresh = () => {
    fetchData()
  }

  const handleLLMAnalysis = async () => {
    setLlmLoading(true)
    try {
      const advice = await getLLMStockAdvice(stockCode, market)
      setLlmAdvice(advice)
      message.success('AI 分析完成')
    } catch (error: any) {
      console.error('LLM analysis failed:', error)
      message.error(error.message || 'AI 分析失败，请稍后重试')
    } finally {
      setLlmLoading(false)
    }
  }

  // 获取置信度颜色
  const getConfidenceColor = (confidence: string) => {
    switch (confidence) {
      case '高': return 'success'
      case '中': return '#fbbf24'
      case '低': return '#f87171'
      default: return '#9ca3af'
    }
  }

  const getStatusColor = (status: LLMStockAdvice['status']) => (
    status === 'available' ? '#38bdf8' : '#fbbf24'
  )

  const getReferencedEvidence = (advice: LLMStockAdvice) => {
    const refs = new Set([
      ...advice.evidenceRefs,
      ...advice.reasoning.flatMap((item) => item.evidenceRefs),
    ])
    return advice.evidence.filter((item) => refs.has(item.id))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spin size="large" tip="加载中..." />
      </div>
    )
  }

  if (!analysis) {
    return (
      <div className="flex items-center justify-center h-64">
        <span className="text-gray-300">暂无数据</span>
      </div>
    )
  }

  const latestPrice = marketTrend?.quote.price ?? analysis.current_price
  const priceChange = marketTrend?.quote.change ?? analysis.price_change
  const priceChangePercent = marketTrend?.quote.changePercent ?? analysis.price_change_percent
  const isRising = priceChange >= 0
  const pricePrecision = latestPrice < 1 ? 3 : 2
  const sessionLabel = marketTrend?.quote.sessionStatus === 'intraday'
    ? '盘中'
    : marketTrend?.quote.sessionStatus === 'pre_open'
      ? '盘前'
      : '已收盘'

  // Determine market from stock code
  const market = stockCode.startsWith('6') ? '上证' : stockCode.startsWith('0') ? '深证' : '创业板'

  const financialData = (analysis.fundamental_snapshot?.financialReports || []).map((report) => ({
    quarter: report.reportName || report.reportDate.slice(0, 10),
    revenue: report.operatingRevenue === undefined ? undefined : report.operatingRevenue / 100_000_000,
    netProfit: report.parentNetProfit === undefined ? undefined : report.parentNetProfit / 100_000_000,
    grossMargin: report.grossMargin,
    roe: report.roeWeighted,
    debtRatio: report.debtAssetRatio,
    operatingCashFlow: report.operatingCashFlow === undefined ? undefined : report.operatingCashFlow / 100_000_000,
  }))

  // Build technical observation from analysis. This page must not convert indicators into trade actions.
  const advice = {
    overall: (analysis.trend === '上涨' ? '偏强' : analysis.trend === '下跌' ? '偏弱' : '中性') as '偏强' | '偏弱' | '中性',
    score: Math.round(analysis.rsi || 50),
    riskLevel: (analysis.volatility && analysis.volatility > 0.03 ? '高' : analysis.volatility && analysis.volatility < 0.02 ? '低' : '中') as '低' | '中' | '高',
    summary: analysis.recommendation || '当前仅展示技术事实观察，不构成买卖、加仓、减仓或仓位建议。',
    resistance: analysis.resistance || undefined,
    support: analysis.support || undefined,
    signals: [
      { type: 'neutral' as const, indicator: 'RSI', description: `RSI指标 ${analysis.rsi?.toFixed(1)}`, strength: Math.round(analysis.rsi || 50) },
      { type: 'neutral' as const, indicator: 'MA', description: `MA5: ${analysis.ma5?.toFixed(2)} MA10: ${analysis.ma10?.toFixed(2)}`, strength: 60 },
      analysis.macd_dif && analysis.macd_dea ? {
        type: (analysis.macd_histogram && analysis.macd_histogram > 0 ? 'positive' : 'negative') as 'positive' | 'negative' | 'neutral',
        indicator: 'MACD',
        description: `DIF: ${analysis.macd_dif.toFixed(2)} DEA: ${analysis.macd_dea.toFixed(2)}`,
        strength: Math.round(Math.abs(analysis.macd_histogram || 0) * 100)
      } : null,
    ].filter(Boolean) as Array<{ type: 'positive' | 'negative' | 'neutral'; indicator: string; description: string; strength: number }>,
  }

  return (
    <div className="space-y-4">
      {/* 头部 */}
      <Card className="bg-[#1a1a2e] border-[surface-border]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              type="text"
              icon={<ArrowLeftOutlined />}
              onClick={() => navigate(-1)}
              className="text-white"
            />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-white text-xl font-bold">{analysis.stock_name}</span>
                <span className="text-gray-300">{analysis.stock_code}</span>
                <span className="px-2 py-0.5 bg-[#5a6bff] text-white text-xs rounded">{market}</span>
              </div>
              <div className="text-gray-500 text-sm mt-1">
                {new Date(analysis.analysis_time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}
              </div>
            </div>
          </div>
          <Button icon={<ReloadOutlined />} onClick={handleRefresh}>
            刷新
          </Button>
          <Button
            type="primary"
            icon={<RobotOutlined />}
            onClick={handleLLMAnalysis}
            loading={llmLoading}
            style={{ backgroundColor: '#818cf8' }}
          >
            AI 分析
          </Button>
        </div>
      </Card>

      {/* 价格和估值 */}
      <Card className="bg-[#1a1a2e] border-[surface-border]">
        <Row gutter={[16, 16]} align="middle">
          <Col xs={24} sm={12} md={8}>
            <Statistic
              title={<span className="text-gray-300">当前价格</span>}
              value={latestPrice.toFixed(pricePrecision)}
              prefix="¥"
              valueStyle={{
                color: isRising ? 'danger' : 'success',
                fontSize: '32px',
              }}
            />
            <div className={`text-lg mt-1 ${isRising ? 'text-[danger]' : 'text-[success]'}`}>
              {isRising ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent.toFixed(2)}%)
            </div>
            {marketTrend && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-400">
                <Tag color={marketTrend.quote.sessionStatus === 'intraday' ? 'processing' : 'default'}>{sessionLabel}</Tag>
                <span>来源 {marketTrend.quote.source}</span>
                <span>截至 {new Date(marketTrend.quote.asOf).toLocaleString('zh-CN', { hour12: false })}</span>
              </div>
            )}
          </Col>
          <Col xs={12} sm={6} md={4}>
            <Statistic
              title={<span className="text-gray-300">成交量</span>}
              value={(analysis.volume / 10000).toFixed(2)}
              suffix="万"
              valueStyle={{ color: '#5a6bff', fontSize: '20px' }}
            />
          </Col>
          <Col xs={12} sm={6} md={4}>
            <Statistic
              title={<span className="text-gray-300">成交额</span>}
              value={(analysis.turnover / 100000000).toFixed(2)}
              suffix="亿"
              valueStyle={{ color: '#FAC858', fontSize: '20px' }}
            />
          </Col>
          <Col xs={24} sm={12} md={8}>
            <ValuationCards
              pe={analysis.pe_ratio}
              pb={analysis.pb_ratio}
              roe={analysis.roe}
            />
          </Col>
        </Row>
        {marketTrend && (
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-[#2a2a40] pt-4 md:grid-cols-4">
            {[
              ['MA5', marketTrend.indicators.ma5, '#fbbf24'],
              ['MA10', marketTrend.indicators.ma10, '#38bdf8'],
              ['MA30', marketTrend.indicators.ma30, '#fb7185'],
              ['最近完整收盘', marketTrend.latestClose.price, '#d1d5db'],
            ].map(([label, value, color]) => (
              <div key={String(label)} className="rounded-lg bg-[#0f0f23] px-3 py-2">
                <div className="text-xs text-gray-400">{label}</div>
                <div className="mt-1 font-mono text-base" style={{ color: String(color) }}>
                  {Number(value).toFixed(Number(value) < 1 ? 3 : 2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {marketTrendError && (
        <Alert
          type="warning"
          showIcon
          message="真实行情走势暂不可用"
          description={`${marketTrendError}。为避免误导，系统没有生成模拟走势图。`}
        />
      )}

      {marketTrend?.warnings.map((warning) => (
        <Alert key={warning} type="info" showIcon message={warning} />
      ))}

      {/* 技术指标面板 */}
      <TechnicalIndicators
        kdj={analysis.kdj_k && analysis.kdj_d && analysis.kdj_j ? {
          k: analysis.kdj_k,
          d: analysis.kdj_d,
          j: analysis.kdj_j
        } : undefined}
        macd={analysis.macd_dif !== undefined && analysis.macd_dea !== undefined ? {
          dif: analysis.macd_dif,
          dea: analysis.macd_dea,
          histogram: analysis.macd_histogram || 0
        } : undefined}
        boll={analysis.boll_upper !== undefined && analysis.boll_middle !== undefined && analysis.boll_lower !== undefined ? {
          upper: analysis.boll_upper,
          middle: analysis.boll_middle,
          lower: analysis.boll_lower
        } : undefined}
        atr={analysis.atr}
        rsi={analysis.rsi}
        support={analysis.support}
        resistance={analysis.resistance}
        ma={marketTrend ? {
          ma5: marketTrend.indicators.ma5,
          ma10: marketTrend.indicators.ma10,
          ma20: analysis.ma20,
          ma30: marketTrend.indicators.ma30,
        } : undefined}
        externalTechnical={analysis.external_technical}
        technicalAdvice={analysis.technical_advice}
        factSet={analysis.fact_set}
        analysisSummary={analysis.analysis_summary}
        cache={analysis.cache}
      />

      {/* 真实K线图；history 含 MA30 预热窗口，默认只显示最近30个完整交易日。 */}
      {marketTrend && klineData.length > 0 && (
        <Card
          title={<span className="text-white">真实走势 · MA5 / MA10 / MA30</span>}
          extra={<span className="text-xs text-gray-400">收盘截止 {marketTrend.latestClose.date} · {marketTrend.historySource}</span>}
          className="bg-[#1a1a2e] border-[surface-border]"
        >
          <KLinedChart
            data={klineData}
            symbol={`${stockCode}`}
            period="日线"
            showVolume
            showMA
            maPeriods={[5, 10, 30]}
            visibleTradingDays={30}
            height={450}
          />
        </Card>
      )}

      {marketTrend && (
        <Card
          title={<span className="text-white">最近30个完整交易日收盘价</span>}
          extra={<span className="text-xs text-gray-400">均线计算不含盘中未完成K线</span>}
          className="bg-[#1a1a2e] border-[surface-border]"
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[...marketTrend.recentCloses].reverse().map((row) => (
              <div key={row.date} className="flex items-center justify-between rounded border border-[#2a2a40] bg-[#0f0f23] px-3 py-2">
                <span className="text-xs text-gray-400">{row.date.slice(5)}</span>
                <span className="font-mono text-sm text-white">{row.close.toFixed(row.close < 1 ? 3 : 2)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* MACD图 */}
      {macdData.length > 0 && (
        <Card
          title={<span className="text-white">MACD指标</span>}
          className="bg-[#1a1a2e] border-[surface-border]"
        >
          <MACDChart data={macdData} height={200} />
        </Card>
      )}

      {/* AI 事实观察 */}
      {llmAdvice && (
        <Card className="bg-[#1a1a2e] border-[surface-border]">
          <div className="flex items-center gap-2 mb-4">
            <RobotOutlined className="text-xl" style={{ color: '#818cf8' }} />
            <span className="text-white text-lg font-bold">AI 事实观察</span>
            <Tag color={getStatusColor(llmAdvice.status)}>
              {llmAdvice.status === 'available' ? '有证据引用' : '数据不足'}
            </Tag>
            <Tag color={getConfidenceColor(llmAdvice.confidence)}>
              证据强度: {llmAdvice.confidence}
            </Tag>
          </div>

          {/* 观察 */}
          <div className="mb-4 p-4 rounded-lg" style={{ backgroundColor: 'rgba(129, 140, 248, 0.1)' }}>
            <div className="text-gray-300 text-sm mb-1">观察</div>
            <div className="text-white text-lg font-semibold">
              {llmAdvice.status === 'available' ? llmAdvice.observation : '数据不足，仅能作为观察'}
            </div>
            <div className="text-gray-300 text-sm mt-2">
              {llmAdvice.summary || '缺少可追溯证据引用，暂不展示结论性解释。'}
            </div>
          </div>

          {/* 证据 */}
          <div className="mb-4">
            <div className="text-gray-300 text-sm mb-2">引用证据：</div>
            {getReferencedEvidence(llmAdvice).length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {getReferencedEvidence(llmAdvice).map((item) => (
                  <div key={item.id} className="p-3 rounded border border-[surface-border] bg-[#0f0f23]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white text-sm font-medium">{item.label}</span>
                      <Tag color="#475569" style={{ marginRight: 0 }}>{item.id}</Tag>
                    </div>
                    <div className="text-gray-300 text-sm mt-1">{item.value}</div>
                    <div className="text-gray-500 text-xs mt-1">{item.source}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-yellow-300 text-sm">缺少 evidenceRefs，当前结果仅能作为观察，不能形成可追溯解释。</div>
            )}
          </div>

          {/* 解释 */}
          <div className="mb-4">
            <div className="text-gray-300 text-sm mb-2">AI 解释：</div>
            <div className="space-y-2">
              {llmAdvice.reasoning.map((reason, index) => (
                <div key={`${reason.title}-${index}`} className="flex items-start gap-2">
                  <span className="text-[#818cf8]">•</span>
                  <span className="text-gray-300 text-sm">
                    <span className="text-white">{reason.title}：</span>{reason.detail}
                  </span>
                </div>
              ))}
              {llmAdvice.reasoning.length === 0 && (
                <div className="text-gray-400 text-sm">暂无可追溯解释。</div>
              )}
            </div>
          </div>

          {llmAdvice.dataGaps.length > 0 && (
            <div className="mb-4">
              <div className="text-gray-300 text-sm mb-2">数据缺口：</div>
              <div className="flex flex-wrap gap-2">
                {llmAdvice.dataGaps.map((gap) => (
                  <Tag key={gap} color="#475569">{gap}</Tag>
                ))}
              </div>
            </div>
          )}

          {/* 风险提示 */}
          {llmAdvice.riskWarning && (
            <div className="flex items-start gap-2 p-3 rounded" style={{ backgroundColor: 'rgba(251, 191, 36, 0.1)' }}>
              <AlertOutlined style={{ color: '#fbbf24' }} />
              <div>
                <div className="text-yellow-400 text-sm font-medium">风险提示</div>
                <div className="text-gray-300 text-xs mt-1">{llmAdvice.riskWarning}</div>
              </div>
            </div>
          )}

          {/* 免责声明 */}
          <div className="text-gray-500 text-xs mt-4 pt-3 border-t border-gray-700">
            {llmAdvice.disclaimer}
          </div>
        </Card>
      )}

      {/* 技术事实观察 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <InvestmentAdvice symbol={stockCode} advice={advice} />
        </Col>
        <Col xs={24} lg={12}>
          <FinancialTable data={financialData} />
        </Col>
      </Row>
    </div>
  )
}

export default StockAnalysis
