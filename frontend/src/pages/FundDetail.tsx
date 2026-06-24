import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Card, Segmented, Table, Spin, message, Button } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { LineChartOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import * as echarts from 'echarts'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import StockDetailModal from '../components/stock/StockDetailModal'

interface FundHistoryRecord {
  date: string
  nav: number
  navChange: number
  navChangePercent: number
}

interface FundStats {
  startNav: number
  endNav: number
  changePercent: number
  maxNav: number
  minNav: number
}

interface FundHistoryResponse {
  fundCode: string
  fundName: string
  period: string
  records: FundHistoryRecord[]
  stats: FundStats
}

interface FundHoldings {
  stockCode: string
  stockName: string
  shares: number
  marketValue: number
  proportion: number
}

interface FundHoldingsResponse {
  fundCode: string
  fundName: string
  reportDate: string
  holdings: FundHoldings[]
}

interface FundRealtime {
  fundCode: string
  name: string
  price: number
  priceChange: number
  priceChangePercent: number
  updateTime: string
}

interface FundHoldingWithPrice extends FundHoldings {
  currentPrice: number
  priceChange: number
  priceChangePercent: number
}

interface HoldingsRealtimeResponse {
  fundCode: string
  holdings: FundHoldingWithPrice[]
  estimatedChange: number
  actualChange: number
}

interface FundDetailProps {
  fundCode?: string
}

const FundDetailContent: React.FC<FundDetailProps> = ({ fundCode: propFundCode }) => {
  const navigate = useNavigate()
  const params = useParams<{ code: string }>()
  const fundCode = propFundCode || params.code || '513770'
  const [period, setPeriod] = useState<string>('1M')
  const [loading, setLoading] = useState(false)
  const [realtime, setRealtime] = useState<FundRealtime | null>(null)
  const [history, setHistory] = useState<FundHistoryResponse | null>(null)
  const [holdings, setHoldings] = useState<FundHoldingsResponse | null>(null)
  const [holdingsRealtime, setHoldingsRealtime] = useState<HoldingsRealtimeResponse | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  // 股票详情弹窗
  const [stockDetailVisible, setStockDetailVisible] = useState(false)
  const [stockDetailCode, setStockDetailCode] = useState<string>('')
  const [stockDetailName, setStockDetailName] = useState<string>('')

  const periods = [
    { label: '30天', value: '1M' },
    { label: '6个月', value: '6M' },
    { label: '1年', value: '1Y' },
    { label: '3年', value: '3Y' },
  ]

  // 获取实时估值
  const fetchRealtime = useCallback(async () => {
    try {
      const response = await axios.get(`/api/v1/fund/realtime/${fundCode}`)
      setRealtime(response.data)
    } catch (error) {
      console.error('Failed to fetch realtime:', error)
    }
  }, [fundCode])

  // 获取历史净值
  const fetchHistory = useCallback(async () => {
    setLoading(true)
    try {
      const response = await axios.get(`/api/v1/fund/history/${fundCode}`, {
        params: { period },
      })
      setHistory(response.data)
    } catch (error) {
      console.error('Failed to fetch history:', error)
      message.error('获取历史净值失败')
    } finally {
      setLoading(false)
    }
  }, [fundCode, period])

  // 获取持仓明细
  const fetchHoldings = useCallback(async () => {
    try {
      const response = await axios.get(`/api/v1/fund/holdings/${fundCode}`)
      setHoldings(response.data)
    } catch (error) {
      console.error('Failed to fetch holdings:', error)
    }
  }, [fundCode])

  // 获取持仓实时涨跌
  const fetchHoldingsRealtime = useCallback(async () => {
    try {
      const response = await axios.get(`/api/v1/fund/holdings-realtime/${fundCode}`)
      setHoldingsRealtime(response.data)
    } catch (error) {
      console.error('Failed to fetch holdings realtime:', error)
    }
  }, [fundCode])

  useEffect(() => {
    fetchRealtime()
    fetchHoldings()
    fetchHoldingsRealtime()
  }, [fundCode, fetchRealtime, fetchHoldings, fetchHoldingsRealtime])

  useEffect(() => {
    fetchHistory()
  }, [fundCode, period, fetchHistory])

  // 渲染图表
  useEffect(() => {
    if (!chartRef.current || !history?.records?.length) return

    try {
      // 销毁旧实例
      if (chartInstance.current) {
        chartInstance.current.dispose()
        chartInstance.current = null
      }

      // 创建新实例
      const chart = echarts.init(chartRef.current)
      chartInstance.current = chart

      const dates = history.records.map((r) => r.date)
      const navs = history.records.map((r) => r.nav)

      const option = {
        tooltip: {
          trigger: 'axis' as const,
          formatter: (params: any) => {
            const p = params[0]
            return `${p.name}<br/>净值: ¥${p.value.toFixed(4)}`
          },
        },
        grid: {
          left: '3%',
          right: '4%',
          bottom: '3%',
          containLabel: true,
        },
        xAxis: {
          type: 'category',
          data: dates,
          boundaryGap: false,
          axisLabel: {
            formatter: (value: string) => value.slice(5),
          },
        },
        yAxis: {
          type: 'value',
          scale: true,
          axisLabel: {
            formatter: (value: number) => value.toFixed(3),
          },
        },
        series: [
          {
            name: '净值',
            type: 'line',
            data: navs,
            smooth: true,
            symbol: 'circle',
            symbolSize: 4,
            lineStyle: {
              width: 2,
              color: '#5470C6',
            },
            areaStyle: {
              color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                { offset: 0, color: 'rgba(84, 112, 198, 0.3)' },
                { offset: 1, color: 'rgba(84, 112, 198, 0.05)' },
              ]),
            },
          },
        ],
      }

      chart.setOption(option)
    } catch (error) {
      console.error('Chart error:', error)
    }

    return () => {
      if (chartInstance.current) {
        chartInstance.current.dispose()
        chartInstance.current = null
      }
    }
  }, [history])

  const holdingsColumns: ColumnsType<FundHoldingWithPrice> = [
    {
      title: '股票代码',
      dataIndex: 'stockCode',
      key: 'stockCode',
      width: 100,
      render: (v: string, record: FundHoldingWithPrice) => (
        <a onClick={() => {
          setStockDetailCode(v)
          setStockDetailName(record.stockName)
          setStockDetailVisible(true)
        }}>{v}</a>
      ),
    },
    {
      title: '股票名称',
      dataIndex: 'stockName',
      key: 'stockName',
      width: 120,
    },
    {
      title: '占净值比例',
      dataIndex: 'proportion',
      key: 'proportion',
      width: 100,
      render: (v: number) => v != null ? `${v.toFixed(2)}%` : '--',
    },
    {
      title: '现价',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      width: 80,
      render: (v: number) => v != null ? `¥${v.toFixed(3)}` : '--',
    },
    {
      title: '涨跌幅',
      dataIndex: 'priceChangePercent',
      key: 'priceChangePercent',
      width: 80,
      render: (v: number) => v != null ? (
        <span className={v >= 0 ? 'text-[success]' : 'text-[danger]'}>
          {v >= 0 ? '+' : ''}{v.toFixed(2)}%
        </span>
      ) : '--',
    },
    {
      title: '持股数（万股）',
      dataIndex: 'shares',
      key: 'shares',
      width: 120,
      render: (v: number) => v != null ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '--',
    },
    {
      title: '持仓市值（万元）',
      dataIndex: 'marketValue',
      key: 'marketValue',
      width: 140,
      render: (v: number) => v != null ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '--',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>
          返回
        </Button>
        <h1 className="text-2xl font-bold text-white">基金详情 - {fundCode}</h1>
      </div>

      {/* 实时估值 */}
      <Card className="bg-[#1a1a2e] border-[surface-border]">
        <div className="flex justify-between items-center">
          <div>
            <span className="text-gray-300">基金名称：</span>
            <span className="text-white text-lg ml-2">{realtime?.name || history?.fundName}</span>
          </div>
          <div className="text-right">
            {realtime && (
              <>
                <div className="text-2xl font-bold text-white">
                  ¥{realtime.price.toFixed(4)}
                </div>
                <div className="flex items-center gap-4">
                  <div
                    className={`text-sm ${
                      (holdingsRealtime?.estimatedChange || 0) >= 0 ? 'text-[success]' : 'text-[danger]'
                    }`}
                  >
                    估算 {(holdingsRealtime?.estimatedChange || 0) >= 0 ? '+' : ''}
                    {(holdingsRealtime?.estimatedChange || 0).toFixed(2)}%
                  </div>
                  <div
                    className={`text-sm ${
                      realtime.priceChange >= 0 ? 'text-[success]' : 'text-[danger]'
                    }`}
                  >
                    实际 {realtime.priceChange >= 0 ? '+' : ''}
                    {realtime.priceChangePercent.toFixed(2)}%
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* 统计卡片 */}
      {history && (
        <Card className="bg-[#1a1a2e] border-[surface-border]">
          <div className="grid grid-cols-4 gap-4">
            <div className="text-center p-3 bg-[surface-border] rounded">
              <div className="text-gray-300 text-sm">期初净值</div>
              <div className="text-white text-lg font-bold">{history.stats.startNav.toFixed(4)}</div>
            </div>
            <div className="text-center p-3 bg-[surface-border] rounded">
              <div className="text-gray-300 text-sm">期末净值</div>
              <div className="text-white text-lg font-bold">{history.stats.endNav.toFixed(4)}</div>
            </div>
            <div className="text-center p-3 bg-[surface-border] rounded">
              <div className="text-gray-300 text-sm">期间涨跌</div>
              <div
                className={`text-lg font-bold ${
                  history.stats.changePercent >= 0 ? 'text-[success]' : 'text-[danger]'
                }`}
              >
                {history.stats.changePercent >= 0 ? '+' : ''}
                {history.stats.changePercent.toFixed(2)}%
              </div>
            </div>
            <div className="text-center p-3 bg-[surface-border] rounded">
              <div className="text-gray-300 text-sm">最高/最低</div>
              <div className="text-white text-lg font-bold">
                {history.stats.maxNav.toFixed(4)} / {history.stats.minNav.toFixed(4)}
              </div>
            </div>
          </div>
        </Card>
      )}

      {/* 时间范围切换和图表 */}
      <Card className="bg-[#1a1a2e] border-[surface-border]">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <LineChartOutlined className="text-white" />
            <span className="text-white">净值走势图</span>
          </div>
          <Segmented
            value={period}
            onChange={(v) => setPeriod(v as string)}
            options={periods}
          />
        </div>

        <Spin spinning={loading}>
          <div
            ref={chartRef}
            style={{ width: '100%', height: 300 }}
          />
        </Spin>
      </Card>

      {/* 持仓明细 */}
      <Card className="bg-[#1a1a2e] border-[surface-border]">
        <div className="flex justify-between items-center mb-4">
          <span className="text-white">持仓明细（季度报告）</span>
          {holdings?.reportDate && (
            <span className="text-gray-300 text-sm">报告日期：{holdings.reportDate}</span>
          )}
        </div>

        <Table
          columns={holdingsColumns}
          dataSource={holdingsRealtime?.holdings || holdings?.holdings?.map(h => ({ ...h, currentPrice: 0, priceChange: 0, priceChangePercent: 0 })) || []}
          rowKey="stockCode"
          pagination={false}
          size="small"
          scroll={{ x: 700 }}
        />
      </Card>

      {/* 股票详情弹窗 */}
      <StockDetailModal
        visible={stockDetailVisible}
        stockCode={stockDetailCode}
        stockName={stockDetailName}
        onClose={() => setStockDetailVisible(false)}
      />
    </div>
  )
}

// Error boundary component
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('FundDetail Error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, background: '#0f0f23', color: 'white' }}>
          <h1>页面渲染出错</h1>
          <p>{this.state.error?.message}</p>
          <button onClick={() => window.location.reload()}>重新加载</button>
        </div>
      )
    }
    return this.props.children
  }
}

const FundDetail: React.FC = () => {
  return (
    <ErrorBoundary>
      <FundDetailContent />
    </ErrorBoundary>
  )
}

export default FundDetail
