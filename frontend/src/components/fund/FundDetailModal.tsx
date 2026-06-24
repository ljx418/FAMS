import React, { useEffect, useState, useRef } from 'react'
import { Modal, Spin, Row, Col, Statistic, Card, Table, Radio, Tag, Tooltip } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import * as echarts from 'echarts'

interface FundRealtimeData {
  fundCode: string
  name: string
  price: number
  priceChange: number
  priceChangePercent: number
  updateTime: string
  source: string
}

interface FundHistoryRecord {
  date: string
  nav: number
  navChangePercent: number
}

interface HoldingData {
  stockCode: string
  stockName: string
  proportion: number
  currentPrice: number
  priceChange: number
  priceChangePercent: number
}

interface HoldingsRealtimeData {
  fundCode: string
  holdings: HoldingData[]
  estimatedChange: number
  actualChange: number
}

interface FundDetailModalProps {
  visible: boolean
  fundCode: string
  fundName?: string
  onClose: () => void
}

const PERIOD_OPTIONS = [
  { label: '1月', value: '1M' },
  { label: '6月', value: '6M' },
  { label: '1年', value: '1Y' },
  { label: '3年', value: '3Y' },
]

const FundDetailModal: React.FC<FundDetailModalProps> = ({
  visible,
  fundCode,
  fundName,
  onClose,
}) => {
  const [loading, setLoading] = useState(false)
  const [realtimeData, setRealtimeData] = useState<FundRealtimeData | null>(null)
  const [historyData, setHistoryData] = useState<FundHistoryRecord[]>([])
  const [holdingsData, setHoldingsData] = useState<HoldingsRealtimeData | null>(null)
  const [period, setPeriod] = useState<'1M' | '6M' | '1Y' | '3Y'>('1M')
  const [historyLoading, setHistoryLoading] = useState(false)
  const chartRef = useRef<HTMLDivElement>(null)
  const chartInstance = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    if (visible && fundCode) {
      fetchRealtimeAndHoldings()
    }
    return () => {
      chartInstance.current?.dispose()
      chartInstance.current = null
    }
  }, [visible, fundCode])

  useEffect(() => {
    if (visible && fundCode) {
      fetchHistory(period)
    }
  }, [visible, fundCode, period])

  useEffect(() => {
    if (historyData.length > 0 && chartRef.current) {
      renderChart()
    }
  }, [historyData])

  const fetchRealtimeAndHoldings = async () => {
    setLoading(true)
    try {
      const [realtimeRes, holdingsRes] = await Promise.allSettled([
        axios.get(`/api/v1/fund/realtime/${fundCode}`),
        axios.get(`/api/v1/fund/holdings-realtime/${fundCode}`),
      ])

      if (realtimeRes.status === 'fulfilled') {
        setRealtimeData(realtimeRes.value.data)
      }
      if (holdingsRes.status === 'fulfilled' && !holdingsRes.value.data.error) {
        setHoldingsData(holdingsRes.value.data)
      }
    } catch (error) {
      console.error('Failed to fetch fund realtime data:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchHistory = async (p: string) => {
    setHistoryLoading(true)
    try {
      const res = await axios.get(`/api/v1/fund/history/${fundCode}?period=${p}`)
      setHistoryData(res.data.records || [])
    } catch (error) {
      console.error('Failed to fetch fund history:', error)
    } finally {
      setHistoryLoading(false)
    }
  }

  const renderChart = () => {
    if (!chartRef.current) return
    if (!chartInstance.current) {
      chartInstance.current = echarts.init(chartRef.current, 'dark')
    }
    const chart = chartInstance.current

    const dates = historyData.map((r) => r.date)
    const navs = historyData.map((r) => r.nav)
    const changes = historyData.map((r) => r.navChangePercent)

    const option: echarts.EChartsOption = {
      backgroundColor: 'transparent',
      grid: [
        { left: 60, right: 20, top: 30, bottom: '45%' },
        { left: 60, right: 20, top: '60%', bottom: 40 },
      ],
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter: (params: any) => {
          const p0 = params[0]
          const p1 = params[1]
          let html = `<div>${p0?.axisValue}</div>`
          if (p0) html += `<div>净值: <b>${p0.value?.toFixed(4)}</b></div>`
          if (p1) {
            const color = (p1.value ?? 0) >= 0 ? '#f56565' : '#48bb78'
            html += `<div>涨跌: <b style="color:${color}">${Number(p1.value ?? 0) >= 0 ? '+' : ''}${Number(p1.value ?? 0).toFixed(2)}%</b></div>`
          }
          return html
        },
      },
      xAxis: [
        { type: 'category', data: dates, gridIndex: 0, axisLabel: { show: false } },
        { type: 'category', data: dates, gridIndex: 1, axisLabel: { fontSize: 10 } },
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          axisLabel: { formatter: (v: number) => v.toFixed(3), fontSize: 11 },
          splitLine: { lineStyle: { color: '#333' } },
        },
        {
          type: 'value',
          gridIndex: 1,
          axisLabel: { formatter: (v: number) => `${v.toFixed(1)}%`, fontSize: 10 },
          splitLine: { lineStyle: { color: '#333' } },
        },
      ],
      series: [
        {
          name: '净值',
          type: 'line',
          data: navs,
          xAxisIndex: 0,
          yAxisIndex: 0,
          smooth: true,
          symbol: 'none',
          lineStyle: { color: '#4299e1', width: 2 },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: 'rgba(66,153,225,0.3)' },
              { offset: 1, color: 'rgba(66,153,225,0)' },
            ]),
          },
        },
        {
          name: '日涨跌%',
          type: 'bar',
          data: changes,
          xAxisIndex: 1,
          yAxisIndex: 1,
          itemStyle: {
            color: (params: any) => ((params.value ?? 0) >= 0 ? '#f56565' : '#48bb78'),
          },
        },
      ],
    }

    chart.setOption(option, true)
  }

  const holdingColumns: ColumnsType<HoldingData> = [
    { title: '代码', dataIndex: 'stockCode', key: 'code', width: 80 },
    { title: '名称', dataIndex: 'stockName', key: 'name', width: 100, ellipsis: true },
    {
      title: '占比',
      dataIndex: 'proportion',
      key: 'prop',
      width: 70,
      render: (v: number) => `${v.toFixed(2)}%`,
      sorter: (a, b) => b.proportion - a.proportion,
      defaultSortOrder: 'descend',
    },
    {
      title: '现价',
      dataIndex: 'currentPrice',
      key: 'price',
      width: 70,
      render: (v: number) => v > 0 ? v.toFixed(3) : '-',
    },
    {
      title: '涨跌%',
      dataIndex: 'priceChangePercent',
      key: 'change',
      width: 80,
      render: (v: number) => (
        <span style={{ color: v >= 0 ? '#f56565' : '#48bb78' }}>
          {v >= 0 ? '+' : ''}{v.toFixed(2)}%
        </span>
      ),
      sorter: (a, b) => a.priceChangePercent - b.priceChangePercent,
    },
  ]

  const displayName = fundName || realtimeData?.name || fundCode
  const isRising = (realtimeData?.priceChangePercent ?? 0) >= 0
  const priceColor = isRising ? '#f56565' : '#48bb78'

  // 计算30天累计涨跌
  const calcPeriodChange = () => {
    if (historyData.length < 2) return null
    const first = historyData[0].nav
    const last = historyData[historyData.length - 1].nav
    return ((last - first) / first) * 100
  }
  const periodChange = calcPeriodChange()

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <span className="text-white font-bold text-lg">{displayName}</span>
          <Tag color="blue">{fundCode}</Tag>
          <Tag color="purple">基金</Tag>
        </div>
      }
      open={visible}
      onCancel={onClose}
      footer={null}
      width={900}
      destroyOnHidden
      styles={{ body: { background: '#0f0f23', padding: '16px' } }}
      style={{ top: 20 }}
    >
      <Spin spinning={loading}>
        {/* 实时数据 */}
        <Row gutter={[12, 12]} className="mb-4">
          <Col span={6}>
            <Card size="small" style={{ background: '#1a1a2e', border: '1px solid surface-border' }}>
              <Statistic
                title={<span style={{ color: '#aaa', fontSize: 12 }}>最新净值</span>}
                value={realtimeData?.price ?? '-'}
                precision={4}
                valueStyle={{ color: priceColor, fontSize: 20 }}
              />
              <div style={{ color: '#aaa', fontSize: 11 }}>{realtimeData?.updateTime}</div>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ background: '#1a1a2e', border: '1px solid surface-border' }}>
              <Statistic
                title={<span style={{ color: '#aaa', fontSize: 12 }}>实时涨跌%</span>}
                value={realtimeData ? (realtimeData.priceChangePercent >= 0 ? '+' : '') + realtimeData.priceChangePercent.toFixed(2) + '%' : '-'}
                valueStyle={{ color: priceColor, fontSize: 20 }}
              />
              <div style={{ color: '#aaa', fontSize: 11 }}>天天基金估值</div>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ background: '#1a1a2e', border: '1px solid surface-border' }}>
              <Statistic
                title={<span style={{ color: '#aaa', fontSize: 12 }}>持仓估算涨跌%</span>}
                value={holdingsData ? (holdingsData.estimatedChange >= 0 ? '+' : '') + holdingsData.estimatedChange.toFixed(2) + '%' : '-'}
                valueStyle={{
                  color: holdingsData && holdingsData.estimatedChange >= 0 ? '#f56565' : '#48bb78',
                  fontSize: 20,
                }}
              />
              <div style={{ color: '#aaa', fontSize: 11 }}>基于持仓计算</div>
            </Card>
          </Col>
          <Col span={6}>
            <Card size="small" style={{ background: '#1a1a2e', border: '1px solid surface-border' }}>
              <Statistic
                title={
                  <Tooltip title={`${PERIOD_OPTIONS.find(p => p.value === period)?.label}区间累计涨跌`}>
                    <span style={{ color: '#aaa', fontSize: 12 }}>
                      {PERIOD_OPTIONS.find(p => p.value === period)?.label}涨跌%
                    </span>
                  </Tooltip>
                }
                value={periodChange !== null ? (periodChange >= 0 ? '+' : '') + periodChange.toFixed(2) + '%' : '-'}
                valueStyle={{
                  color: periodChange !== null && periodChange >= 0 ? '#f56565' : '#48bb78',
                  fontSize: 20,
                }}
              />
              <div style={{ color: '#aaa', fontSize: 11 }}>东方财富净值</div>
            </Card>
          </Col>
        </Row>

        {/* 趋势图 */}
        <Card
          size="small"
          style={{ background: '#1a1a2e', border: '1px solid surface-border', marginBottom: 12 }}
          title={
            <div className="flex items-center justify-between">
              <span style={{ color: '#ddd' }}>净值走势</span>
              <Radio.Group
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                size="small"
                buttonStyle="solid"
              >
                {PERIOD_OPTIONS.map((opt) => (
                  <Radio.Button key={opt.value} value={opt.value}>
                    {opt.label}
                  </Radio.Button>
                ))}
              </Radio.Group>
            </div>
          }
        >
          <Spin spinning={historyLoading}>
            <div ref={chartRef} style={{ height: 320, width: '100%' }} />
          </Spin>
        </Card>

        {/* 持仓明细 */}
        {holdingsData && holdingsData.holdings.length > 0 && (
          <Card
            size="small"
            style={{ background: '#1a1a2e', border: '1px solid surface-border' }}
            title={
              <span style={{ color: '#ddd' }}>
                持仓明细
                <span style={{ color: '#aaa', fontSize: 12, marginLeft: 8 }}>
                  (基于持仓估算实时涨跌：
                  <span style={{ color: holdingsData.estimatedChange >= 0 ? '#f56565' : '#48bb78' }}>
                    {holdingsData.estimatedChange >= 0 ? '+' : ''}{holdingsData.estimatedChange.toFixed(2)}%
                  </span>
                  )
                </span>
              </span>
            }
          >
            <Table
              columns={holdingColumns}
              dataSource={holdingsData.holdings}
              rowKey="stockCode"
              pagination={false}
              size="small"
              style={{ background: 'transparent' }}
            />
          </Card>
        )}
      </Spin>
    </Modal>
  )
}

export default FundDetailModal
