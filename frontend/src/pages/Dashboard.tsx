import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Empty, Progress, Row, Statistic, Table, Tag, message } from 'antd'
import { BarChartOutlined, ReloadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import {
  AllocationPieChart,
  GaugeChart,
} from '../components/charts'
import type { AllocationItem } from '../components/charts'

const USER_ID = 'default'

interface PositionRecord {
  id: string
  asset: {
    symbol: string
    name: string
    type: string
    lastUpdated?: string
  }
  quantity: number
  currentPrice?: number
  marketValue?: number
  costBasis?: number
  unrealizedPnl?: number
  unrealizedPnlPercent?: number
  currentWeight?: number
  costWeight?: number
  tags?: string[]
}

interface PositionSummary {
  totalValue: number
  totalCost: number
  totalPnl: number
  totalPnlPercent: number
  positionsCount: number
  cashValue: number
  cashWeight: number
}

const assetTypeLabel: Record<string, string> = {
  stock: '股票',
  fund: '基金',
  bond: '债券',
  gold: '黄金',
  cash: '现金',
  etf: 'ETF',
  crypto: '数字资产',
  reit: 'REIT',
}

const assetTypeColor: Record<string, string> = {
  stock: '#5a6bff',
  fund: '#36cfc9',
  bond: '#94a3b8',
  gold: '#fbbf24',
  cash: '#38bdf8',
  etf: '#818cf8',
  crypto: '#f87171',
  reit: '#a78bfa',
}

const toFiniteNumber = (value?: number | null) => (Number.isFinite(value) ? Number(value) : 0)

const formatWan = (value?: number | null) => {
  const amount = toFiniteNumber(value)
  const absAmount = Math.abs(amount)
  if (absAmount >= 100000000) return `${(amount / 100000000).toFixed(2)} 亿`
  const wan = amount / 10000
  const absWan = Math.abs(wan)
  if (absWan >= 1000) return `${wan.toFixed(0)} 万`
  if (absWan >= 100) return `${wan.toFixed(1)} 万`
  return `${wan.toFixed(2)} 万`
}

const formatStatisticWan = (value?: number | string) => {
  const amount = Number(value || 0) * 10000
  return formatWan(amount).replace(/\s/g, '')
}

const formatPercent = (value?: number | null) => {
  const percent = toFiniteNumber(value)
  const absPercent = Math.abs(percent)
  const digits = absPercent >= 1000 ? 0 : absPercent >= 100 ? 1 : 2
  return `${percent.toFixed(digits)}%`
}

const calculateRiskScore = (summary: PositionSummary, positions: PositionRecord[]) => {
  const maxWeight = positions.reduce((max, item) => Math.max(max, item.currentWeight || 0), 0)
  const concentrationRisk = Math.min(35, maxWeight)
  const lowCashRisk = summary.cashWeight < 5 ? 25 : summary.cashWeight < 10 ? 12 : 0
  const lossRisk = summary.totalPnlPercent < -10 ? 25 : summary.totalPnlPercent < -5 ? 12 : 0
  return Math.min(100, Math.round(30 + concentrationRisk + lowCashRisk + lossRisk))
}

const Dashboard: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [positions, setPositions] = useState<PositionRecord[]>([])
  const [summary, setSummary] = useState<PositionSummary>({
    totalValue: 0,
    totalCost: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    positionsCount: 0,
    cashValue: 0,
    cashWeight: 0,
  })
  const [activeAlertCount, setActiveAlertCount] = useState(0)

  const fetchDashboard = useCallback(async () => {
    setLoading(true)
    try {
      const [positionsResponse, alertsResponse] = await Promise.all([
        axios.get(`/api/v1/positions?userId=${USER_ID}&limit=200`),
        axios.get(`/api/v1/alerts/stats/active-count?userId=${USER_ID}`),
      ])

      setPositions(positionsResponse.data?.data || [])
      setSummary(positionsResponse.data?.summary || {
        totalValue: 0,
        totalCost: 0,
        totalPnl: 0,
        totalPnlPercent: 0,
        positionsCount: 0,
        cashValue: 0,
        cashWeight: 0,
      })
      setActiveAlertCount(alertsResponse.data?.count || 0)
    } catch (error) {
      console.error('Failed to fetch dashboard:', error)
      message.error('获取总览数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDashboard()
  }, [fetchDashboard])

  const allocationData: AllocationItem[] = useMemo(() => {
    const grouped = new Map<string, number>()
    for (const position of positions) {
      const type = position.asset?.type || 'other'
      grouped.set(type, (grouped.get(type) || 0) + (position.marketValue || 0))
    }

    return Array.from(grouped.entries())
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([type, value]) => ({
        name: assetTypeLabel[type] || type,
        value,
        color: assetTypeColor[type] || '#64748b',
      }))
  }, [positions])

  const topPositions = useMemo(() => (
    [...positions]
      .sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0))
      .slice(0, 8)
  ), [positions])

  const riskScore = useMemo(() => calculateRiskScore(summary, positions), [summary, positions])

  const columns: ColumnsType<PositionRecord> = [
    {
      title: '标的',
      key: 'asset',
      render: (_, record) => (
        <div>
          <div className="text-white font-medium break-all">{record.asset.symbol}</div>
          <div className="text-xs text-gray-300 break-all">{record.asset.name}</div>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: ['asset', 'type'],
      width: 90,
      render: (type: string) => (
        <Tag color={assetTypeColor[type] || '#64748b'}>{assetTypeLabel[type] || type}</Tag>
      ),
    },
    {
      title: '市值',
      dataIndex: 'marketValue',
      align: 'right',
      render: (value: number) => <span className="text-white">{formatWan(value)}</span>,
    },
    {
      title: '实际仓位',
      dataIndex: 'currentWeight',
      align: 'right',
      render: (value: number) => formatPercent(value),
    },
    {
      title: '盈亏',
      dataIndex: 'unrealizedPnl',
      align: 'right',
      render: (value: number, record) => (
        <span className={`inline-flex max-w-[150px] flex-col items-end leading-5 ${(value || 0) >= 0 ? 'text-[#34d399]' : 'text-[#f87171]'}`}>
          <span>{formatWan(value)}</span>
          <span>{formatPercent(record.unrealizedPnlPercent)}</span>
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white mb-0">总览</h1>
        <Button icon={<ReloadOutlined />} onClick={fetchDashboard} loading={loading}>
          刷新总览
        </Button>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-[#1a1a2e] border-[surface-border]">
            <Statistic
              title={<span className="text-gray-300">总市值</span>}
              value={summary.totalValue / 10000}
              formatter={formatStatisticWan}
              valueStyle={{ color: '#38bdf8', fontSize: 24, lineHeight: 1.2, wordBreak: 'break-all' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-[#1a1a2e] border-[surface-border]">
            <Statistic
              title={<span className="text-gray-300">总成本</span>}
              value={summary.totalCost / 10000}
              formatter={formatStatisticWan}
              valueStyle={{ color: '#fbbf24', fontSize: 24, lineHeight: 1.2, wordBreak: 'break-all' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-[#1a1a2e] border-[surface-border]">
            <Statistic
              title={<span className="text-gray-300">浮动盈亏</span>}
              value={summary.totalPnl / 10000}
              formatter={formatStatisticWan}
              valueStyle={{ color: summary.totalPnl >= 0 ? '#34d399' : '#f87171', fontSize: 24, lineHeight: 1.2, wordBreak: 'break-all' }}
            />
            <div className="mt-2 text-sm text-gray-300">
              收益率 <span className={summary.totalPnlPercent >= 0 ? 'text-[#34d399]' : 'text-[#f87171]'}>
                {formatPercent(summary.totalPnlPercent)}
              </span>
            </div>
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="bg-[#1a1a2e] border-[surface-border]">
            <GaugeChart
              value={riskScore}
              max={100}
              label="风险评分"
              height={126}
              showValue={false}
              showAxisLabel={false}
              unit=""
            />
            <div className="mt-[-2px] text-center">
              <div className="text-2xl font-bold text-[#fbbf24] leading-none">{riskScore}</div>
              <div className="mt-2 text-xs text-gray-300">
                {activeAlertCount > 0 ? `${activeAlertCount} 条活跃告警` : '暂无活跃告警'}
              </div>
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title={<span className="text-primary">现金仓位</span>} className="bg-[#1a1a2e] border-[surface-border]">
            <Statistic
              title={<span className="text-gray-300">现金市值</span>}
              value={summary.cashValue / 10000}
              formatter={formatStatisticWan}
              valueStyle={{ color: '#38bdf8', fontSize: 22, lineHeight: 1.2, wordBreak: 'break-all' }}
            />
            <div className="mt-4">
              <div className="mb-2 flex justify-between text-sm text-gray-300">
                <span>现金占比</span>
                <span>{formatPercent(summary.cashWeight)}</span>
              </div>
              <Progress
                percent={Number(Math.min(100, Math.max(0, summary.cashWeight)).toFixed(2))}
                format={() => formatPercent(summary.cashWeight)}
                strokeColor="#38bdf8"
                trailColor="#2a2a4e"
              />
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span className="text-primary">持仓数量</span>} className="bg-[#1a1a2e] border-[surface-border]">
            <Statistic
              title={<span className="text-gray-300">开放仓位</span>}
              value={summary.positionsCount}
              suffix="个"
              valueStyle={{ color: '#5a6bff' }}
            />
            <div className="mt-4 text-sm text-gray-300">
              统计来自后端 `PositionService`，Dashboard 与资产/仓位页使用同一套口径。
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title={<span className="text-primary">告警状态</span>} className="bg-[#1a1a2e] border-[surface-border]">
            <Statistic
              title={<span className="text-gray-300">活跃告警</span>}
              value={activeAlertCount}
              suffix="条"
              valueStyle={{ color: activeAlertCount > 0 ? '#f87171' : '#34d399' }}
            />
            <div className="mt-4 text-sm text-gray-300">
              基础止盈止损和集中度检查会进入这里。
            </div>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card title={<span className="text-primary">资产类型配置</span>} className="bg-[#1a1a2e] border-[surface-border] card-lg">
            {allocationData.length > 0 ? (
              <AllocationPieChart
                data={allocationData}
                type="donut"
                showLegend
                showLabel
                showPercent
                height={350}
              />
            ) : (
              <Empty description={<span className="text-gray-300">暂无资产配置数据</span>} />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title={<span className="text-primary">主要持仓</span>} className="bg-[#1a1a2e] border-[surface-border] card-lg">
            <Table
              columns={columns}
              dataSource={topPositions}
              rowKey="id"
              loading={loading}
              pagination={false}
              size="small"
              scroll={{ x: 620 }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24}>
          <Card className="bg-[#1a1a2e] border-[surface-border]">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-primary text-base font-medium">AI标的研究与选股</div>
                <div className="mt-1 text-sm text-gray-300">
                  股票分析、板块研究和AI选股已合并到分析建议页，避免总览与分析页结论不一致。
                </div>
              </div>
              <Button type="primary" icon={<BarChartOutlined />} href="/analysis">
                打开分析建议
              </Button>
            </div>
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Dashboard
