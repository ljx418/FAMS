import React, { useEffect, useState, useMemo } from 'react'
import { Modal, Spin, Row, Col, Statistic, Card, Select, Empty } from 'antd'
import ValuationCards from './ValuationCards'
import TechnicalIndicators from './TechnicalIndicators'
import TechnicalEvaluationCard from './TechnicalEvaluationCard'
import InvestmentAdvice from './InvestmentAdvice'
import { KLinedChart } from '../charts'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { getStockAnalysis, generateKLineDataFromAnalysis, type StockAnalysisResponse } from '../../services/stockService'
import type { KLineData } from '../charts'
import { colors, fonts, darkTheme } from '../../styles/chartTheme'
import axios from 'axios'

interface StockDetailModalProps {
  visible: boolean
  stockCode: string
  stockName?: string
  market?: string
  onClose: () => void
}

const StockDetailModal: React.FC<StockDetailModalProps> = ({
  visible,
  stockCode,
  stockName,
  market,
  onClose,
}) => {
  const [loading, setLoading] = useState(false)
  const [analysis, setAnalysis] = useState<StockAnalysisResponse | null>(null)
  const [klineData, setKlineData] = useState<KLineData[]>([])
  const [fundTrends, setFundTrends] = useState<Record<string, Array<{ date: string; nav: number; navChange: number }>>>({})
  const [matchedFunds, setMatchedFunds] = useState<Array<{ fundCode: string; fundName: string; proportion: number }>>([])
  const [selectedFund, setSelectedFund] = useState<string>('all')
  const [fundTrendPeriod, setFundTrendPeriod] = useState<'1M' | '6M' | '1Y' | '3Y'>('1M')

  useEffect(() => {
    if (visible && stockCode) {
      fetchStockData()
    }
  }, [visible, stockCode])

  const fetchStockData = async () => {
    setLoading(true)
    try {
      const marketParam = market || (stockCode.startsWith('6') ? 'A股' : stockCode.startsWith('0') ? 'A股' : 'A股')
      const data = await getStockAnalysis(stockCode, marketParam)
      setAnalysis(data)
      // 生成K线数据
      if (data) {
        const kData = generateKLineDataFromAnalysis(data, 60)
        setKlineData(kData)
      }
      // 获取持有该股票的基金趋势
      fetchFundTrends()
    } catch (error) {
      console.error('Failed to fetch stock analysis:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchFundTrends = async () => {
    try {
      const resp = await axios.get(`/api/v1/fund/by-stock/${stockCode}`, {
        params: { period: fundTrendPeriod, userId: 'default' },
      })
      if (resp.data?.funds?.length > 0) {
        setMatchedFunds(resp.data.funds)
        setFundTrends(resp.data.trends || {})
        if (resp.data.funds.length > 0) {
          setSelectedFund(resp.data.funds[0].fundCode)
        }
      } else {
        setMatchedFunds([])
        setFundTrends({})
      }
    } catch (error) {
      console.error('Failed to fetch fund trends:', error)
      setMatchedFunds([])
      setFundTrends({})
    }
  }

  const handleClose = () => {
    setAnalysis(null)
    setFundTrends({})
    setMatchedFunds([])
    onClose()
  }

  // 基金趋势图组件
  const FundTrendChart: React.FC<{
    trends: Record<string, Array<{ date: string; nav: number; navChange: number }>>
    funds: Array<{ fundCode: string; fundName: string; proportion: number }>
    selectedFund: string
  }> = ({ trends, funds, selectedFund }) => {
    const chartData = useMemo(() => {
      const fundCodes = selectedFund === 'all'
        ? funds.slice(0, 5).map((f) => f.fundCode)
        : [selectedFund]

      const series = fundCodes
        .filter((code) => trends[code]?.length > 0)
        .map((code) => {
          const fund = funds.find((f) => f.fundCode === code)
          const records = trends[code]
          const baseNav = records[0]?.nav || 1

          return {
            name: fund?.fundName || code,
            fundCode: code,
            data: records.map((r) => ({
              date: r.date,
              nav: r.nav,
              changePercent: baseNav > 0 ? ((r.nav - baseNav) / baseNav) * 100 : 0,
            })),
            color: colors.fundColors[fundCodes.indexOf(code) % colors.fundColors.length],
          }
        })

      return series
    }, [trends, funds, selectedFund])

    const option: EChartsOption = useMemo(() => {
      if (chartData.length === 0) return {}

      const dates = chartData[0].data.map((d) => d.date)

      return {
        ...darkTheme,
        animation: true,
        tooltip: {
          trigger: 'axis',
          backgroundColor: colors.card,
          borderColor: colors.border,
          textStyle: { color: colors.text, fontFamily: fonts.family },
          formatter: (params: any) => {
            const date = params[0]?.axisValue
            let html = `<div style="font-family: ${fonts.family}; padding: 4px;">`
            html += `<div style="color: ${colors.textSecondary}; margin-bottom: 8px;">${date}</div>`
            params.forEach((p: any) => {
              if (p.value === undefined || p.value === null) return
              const marker = `<span style="display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: ${p.color}; margin-right: 8px;"></span>`
              html += `<div style="margin-bottom: 4px;">${marker} ${p.seriesName}: <strong>${p.value.toFixed(2)}%</strong></div>`
            })
            html += '</div>'
            return html
          },
        },
        legend: {
          show: true,
          top: 0,
          right: '5%',
          textStyle: { color: colors.textSecondary, fontFamily: fonts.family },
          itemWidth: 16,
          itemHeight: 10,
          itemGap: 16,
        },
        grid: {
          left: '8%',
          right: '5%',
          top: '18%',
          bottom: '15%',
        },
        xAxis: {
          type: 'category',
          data: dates,
          axisLine: { lineStyle: { color: colors.grid } },
          axisTick: { show: false },
          axisLabel: {
            color: colors.textSecondary,
            fontSize: fonts.size.xs,
            fontFamily: fonts.family,
          },
        },
        yAxis: {
          type: 'value',
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: colors.gridLight } },
          axisLabel: {
            color: colors.textSecondary,
            fontSize: fonts.size.xs,
            fontFamily: fonts.family,
            formatter: (value: number) => `${value.toFixed(2)}%`,
          },
        },
        dataZoom: [
          { type: 'inside', start: 0, end: 100 },
          {
            type: 'slider',
            bottom: '2%',
            height: 20,
            borderColor: colors.grid,
            backgroundColor: colors.card,
            fillerColor: 'rgba(90, 107, 255, 0.2)',
            handleStyle: { color: colors.primary },
            textStyle: { color: colors.textSecondary },
          },
        ],
        series: chartData.map((s) => ({
          name: s.name,
          type: 'line' as const,
          data: s.data.map((d) => d.changePercent),
          smooth: true,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { color: s.color, width: 2 },
          itemStyle: { color: s.color, borderWidth: 1, borderColor: colors.card },
          emphasis: { scale: true, scaleSize: 8 },
        })),
      } as EChartsOption
    }, [chartData])

    if (chartData.length === 0) {
      return <Empty description="暂无基金趋势数据" />
    }

    return (
      <ReactECharts
        option={option}
        style={{ height: '260px', width: '100%' }}
        opts={{ renderer: 'canvas' }}
      />
    )
  }

  if (!visible) return null

  const latestPrice = analysis?.current_price || 0
  const priceChange = analysis?.price_change || 0
  const priceChangePercent = analysis?.price_change_percent || 0
  const isRising = priceChange >= 0
  const displayName = stockName || analysis?.stock_name || stockCode
  const displayMarket = market || analysis?.market || 'A股'

  // Build technical observation from analysis. This modal must not convert indicators into trade actions.
  const advice = analysis ? {
    overall: (analysis.trend === '上涨' ? '偏强' : analysis.trend === '下跌' ? '偏弱' : '中性') as '偏强' | '偏弱' | '中性',
    score: Math.round(analysis.rsi || 50),
    riskLevel: (analysis.volatility && analysis.volatility > 0.03 ? '高' : analysis.volatility && analysis.volatility < 0.02 ? '低' : '中') as '低' | '中' | '高',
    summary: analysis.recommendation || '当前仅展示技术事实观察，不构成买卖、加仓、减仓或仓位建议。',
    resistance: analysis.resistance || undefined,
    support: analysis.support || undefined,
    signals: [
      analysis.rsi ? { type: 'neutral' as const, indicator: 'RSI', description: `RSI指标 ${analysis.rsi.toFixed(1)}`, strength: Math.round(analysis.rsi) } : null,
      analysis.ma5 && analysis.ma10 ? { type: 'neutral' as const, indicator: 'MA', description: `MA5: ${analysis.ma5.toFixed(2)} MA10: ${analysis.ma10.toFixed(2)}`, strength: 60 } : null,
      analysis.macd_dif && analysis.macd_dea ? {
        type: (analysis.macd_histogram && analysis.macd_histogram > 0 ? 'positive' : 'negative') as 'positive' | 'negative' | 'neutral',
        indicator: 'MACD',
        description: `DIF: ${analysis.macd_dif.toFixed(2)} DEA: ${analysis.macd_dea.toFixed(2)}`,
        strength: Math.round(Math.abs(analysis.macd_histogram || 0) * 100)
      } : null,
    ].filter(Boolean) as Array<{ type: 'positive' | 'negative' | 'neutral'; indicator: string; description: string; strength: number }>,
  } : null

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <span className="text-white text-lg font-bold">{displayName}</span>
          <span className="text-gray-300 text-sm">{stockCode}</span>
          <span className="px-2 py-0.5 bg-[#5a6bff] text-white text-xs rounded">{displayMarket}</span>
        </div>
      }
      open={visible}
      onCancel={handleClose}
      footer={null}
      width={900}
      destroyOnHidden
    >
      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Spin size="large" tip="加载中..." />
        </div>
      ) : analysis ? (
        <div className="space-y-4">
          {/* 价格信息 */}
          <Card className="bg-[#0f0f23] border-[surface-border] card-md">
            <Row gutter={[16, 16]} align="middle">
              <Col xs={12} sm={8}>
                <Statistic
                  title={<span className="text-gray-300 text-xs">当前价格</span>}
                  value={latestPrice.toFixed(2)}
                  prefix="¥"
                  valueStyle={{
                    color: isRising ? 'danger' : 'success',
                    fontSize: '28px',
                  }}
                />
                <div className={`text-sm mt-1 ${isRising ? 'text-[danger]' : 'text-[success]'}`}>
                  {isRising ? '+' : ''}{priceChange.toFixed(2)} ({priceChangePercent.toFixed(2)}%)
                </div>
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title={<span className="text-gray-300 text-xs">成交量</span>}
                  value={(analysis.volume / 10000).toFixed(2)}
                  suffix="万"
                  valueStyle={{ color: '#5a6bff', fontSize: '20px' }}
                />
              </Col>
              <Col xs={12} sm={8}>
                <Statistic
                  title={<span className="text-gray-300 text-xs">成交额</span>}
                  value={(analysis.turnover / 100000000).toFixed(2)}
                  suffix="亿"
                  valueStyle={{ color: '#FAC858', fontSize: '20px' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title={<span className="text-gray-300 text-xs">最高</span>}
                  value={analysis.highest_price?.toFixed(2) || '--'}
                  valueStyle={{ color: '#f87171', fontSize: '18px' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title={<span className="text-gray-300 text-xs">最低</span>}
                  value={analysis.lowest_price?.toFixed(2) || '--'}
                  valueStyle={{ color: '#34d399', fontSize: '18px' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title={<span className="text-gray-300 text-xs">平均</span>}
                  value={analysis.average_price?.toFixed(2) || '--'}
                  valueStyle={{ color: '#FAC858', fontSize: '18px' }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic
                  title={<span className="text-gray-300 text-xs">波动率</span>}
                  value={analysis.volatility ? `${(analysis.volatility * 100).toFixed(2)}%` : '--'}
                  valueStyle={{ color: '#A0A0A0', fontSize: '18px' }}
                />
              </Col>
            </Row>
          </Card>

          {/* 估值指标 */}
          <ValuationCards
            pe={analysis.pe_ratio}
            pb={analysis.pb_ratio}
            roe={analysis.roe}
          />

          {/* K线图 */}
          {klineData.length > 0 && (
            <Card className="bg-[#1a1a2e] border-[surface-border] card-lg">
              <KLinedChart
                data={klineData}
                symbol={stockCode}
                period="日线"
                showVolume
                showMA
                height={280}
              />
            </Card>
          )}

          {/* 同基金价格趋势图 */}
          {matchedFunds.length > 0 && (
            <Card className="bg-[#1a1a2e] border-[surface-border] card-lg">
              <div className="flex items-center justify-between mb-4">
                <div className="text-white font-medium">持有该股票的基金趋势</div>
                <div className="flex items-center gap-3">
                  <Select
                    value={selectedFund}
                    onChange={setSelectedFund}
                    style={{ width: 160 }}
                    size="small"
                    options={[
                      { value: 'all', label: '全部基金' },
                      ...matchedFunds.map((f) => ({ value: f.fundCode, label: f.fundName })),
                    ]}
                  />
                  <Select
                    value={fundTrendPeriod}
                    onChange={(v) => {
                      setFundTrendPeriod(v)
                      fetchFundTrends()
                    }}
                    style={{ width: 80 }}
                    size="small"
                    options={[
                      { value: '1M', label: '1月' },
                      { value: '6M', label: '6月' },
                      { value: '1Y', label: '1年' },
                      { value: '3Y', label: '3年' },
                    ]}
                  />
                </div>
              </div>
              <FundTrendChart
                trends={fundTrends}
                funds={matchedFunds}
                selectedFund={selectedFund}
              />
            </Card>
          )}

          {/* 技术面评价 */}
          <TechnicalEvaluationCard analysis={analysis} />

          {/* 技术指标 */}
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
            ma={analysis.ma5 !== undefined && analysis.ma10 !== undefined && analysis.ma20 !== undefined ? {
              ma5: analysis.ma5,
              ma10: analysis.ma10,
              ma20: analysis.ma20
            } : undefined}
            externalTechnical={analysis.external_technical}
            technicalAdvice={analysis.technical_advice}
            factSet={analysis.fact_set}
            analysisSummary={analysis.analysis_summary}
            cache={analysis.cache}
          />

          {/* 技术事实观察 */}
          {advice && (
            <InvestmentAdvice symbol={stockCode} advice={advice} />
          )}
        </div>
      ) : (
        <div className="flex items-center justify-center h-64 text-gray-300">
          暂无数据
        </div>
      )}
    </Modal>
  )
}

export default StockDetailModal
