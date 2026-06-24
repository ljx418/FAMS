import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Col, Input, InputNumber, Row, Select, Statistic, Switch, Table, Tag, message } from 'antd'
import { CheckCircleOutlined, PlusOutlined, ReloadOutlined, SafetyCertificateOutlined, SyncOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'

const USER_ID = 'default'

const getOperationId = (data: any) => data?.operation_id || data?.operationId || data?.id

type AlertType = 'price' | 'risk' | 'rebalance' | 'market'
type AlertSeverity = 'info' | 'warning' | 'danger'
type AlertStatus = 'active' | 'acknowledged' | 'resolved'

interface AlertRecord {
  id: string
  type: AlertType
  title: string
  message: string
  severity: AlertSeverity
  status: AlertStatus
  assetSymbol?: string
  triggeredAt?: string
  acknowledgedAt?: string
  createdAt: string
}

interface OperationRecord {
  id: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  result?: {
    alertedSymbols?: string[]
    alertCount?: number
  }
  error?: {
    message?: string
  }
}

interface MarketWatchRule {
  id: string
  symbol: string
  name: string
  thresholdPercent: number
  windowDays: number
  enabled: boolean
}

interface MarketWatchEvaluation {
  ruleId: string
  symbol: string
  name: string
  thresholdPercent: number
  windowDays: number
  enabled: boolean
  latestPrice: number | null
  latestDate: string | null
  peakPrice: number | null
  peakDate: string | null
  drawdownPercent: number | null
  triggered: boolean
  severity: AlertSeverity
  source: string
  dataStatus: 'ok' | 'error'
  message: string
}

const severityColor: Record<AlertSeverity, string> = {
  info: 'blue',
  warning: 'gold',
  danger: 'red',
}

const statusColor: Record<AlertStatus, string> = {
  active: 'red',
  acknowledged: 'blue',
  resolved: 'green',
}

const typeLabel: Record<AlertType, string> = {
  price: '价格',
  risk: '风险',
  rebalance: '再平衡',
  market: '市场',
}

const statusLabel: Record<AlertStatus, string> = {
  active: '活跃',
  acknowledged: '已确认',
  resolved: '已解决',
}

const severityLabel: Record<AlertSeverity, string> = {
  info: '提示',
  warning: '警告',
  danger: '危险',
}

const Alerts: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [marketWatchLoading, setMarketWatchLoading] = useState(false)
  const [marketWatchSaving, setMarketWatchSaving] = useState(false)
  const [alerts, setAlerts] = useState<AlertRecord[]>([])
  const [status, setStatus] = useState<AlertStatus | 'all'>('active')
  const [marketWatchRules, setMarketWatchRules] = useState<MarketWatchRule[]>([])
  const [marketWatchEvaluations, setMarketWatchEvaluations] = useState<MarketWatchEvaluation[]>([])

  const fetchAlerts = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ userId: USER_ID })
      if (status !== 'all') {
        params.set('status', status)
      }
      const response = await axios.get(`/api/v1/alerts?${params.toString()}`)
      setAlerts(response.data || [])
    } catch (error) {
      console.error('Failed to fetch alerts:', error)
      message.error('获取告警失败')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => {
    fetchAlerts()
  }, [fetchAlerts])

  const fetchMarketWatch = useCallback(async () => {
    setMarketWatchLoading(true)
    try {
      const params = new URLSearchParams({ userId: USER_ID })
      const [rulesResponse, evaluationsResponse] = await Promise.all([
        axios.get(`/api/v1/alerts/market-watch/rules?${params.toString()}`),
        axios.get(`/api/v1/alerts/market-watch/evaluations?${params.toString()}`),
      ])
      setMarketWatchRules(rulesResponse.data || [])
      setMarketWatchEvaluations(evaluationsResponse.data || [])
    } catch (error) {
      console.error('Failed to fetch market watch:', error)
      message.error('获取宽基监控失败')
    } finally {
      setMarketWatchLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMarketWatch()
  }, [fetchMarketWatch])

  const stats = useMemo(() => ({
    active: alerts.filter((item) => item.status === 'active').length,
    danger: alerts.filter((item) => item.status === 'active' && item.severity === 'danger').length,
    warning: alerts.filter((item) => item.status === 'active' && item.severity === 'warning').length,
  }), [alerts])

  const handleRiskCheck = async () => {
    setChecking(true)
    try {
      const response = await axios.post('/api/v1/operations/check-alerts', { userId: USER_ID })
      const operationId = getOperationId(response.data)
      if (!operationId) {
        throw new Error('未获取到 operation_id')
      }

      let operation: OperationRecord = response.data
      for (let index = 0; index < 30; index += 1) {
        if (operation.status === 'completed' || operation.status === 'failed' || operation.status === 'cancelled') {
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const operationResponse = await axios.get(`/api/v1/operations/${operationId}`)
        operation = operationResponse.data
      }

      if (operation.status === 'failed') {
        throw new Error(operation.error?.message || '风险检查任务失败')
      }

      const symbols = operation.result?.alertedSymbols || []
      message.success(symbols.length > 0 ? `风险检查完成，触发 ${symbols.length} 个标的` : '风险检查完成，暂无新触发')
      fetchAlerts()
      fetchMarketWatch()
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '风险检查失败'
      message.error(errorMessage)
    } finally {
      setChecking(false)
    }
  }

  const handleCheckMarketWatch = async () => {
    setMarketWatchLoading(true)
    try {
      const response = await axios.post('/api/v1/alerts/market-watch/check', { userId: USER_ID })
      const symbols = response.data?.alertedSymbols || []
      message.success(symbols.length > 0 ? `宽基监控完成，触发 ${symbols.length} 个提醒` : '宽基监控完成，暂无触发')
      await Promise.all([fetchMarketWatch(), fetchAlerts()])
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '宽基监控检查失败'
      message.error(errorMessage)
    } finally {
      setMarketWatchLoading(false)
    }
  }

  const handleSaveMarketWatchRules = async () => {
    setMarketWatchSaving(true)
    try {
      const rules = marketWatchRules.map((rule) => ({
        symbol: rule.symbol,
        name: rule.name,
        thresholdPercent: rule.thresholdPercent,
        windowDays: rule.windowDays,
        enabled: rule.enabled,
      }))
      await axios.put('/api/v1/alerts/market-watch/rules', { userId: USER_ID, rules })
      message.success('宽基监控配置已保存')
      fetchMarketWatch()
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '保存宽基监控配置失败'
      message.error(errorMessage)
    } finally {
      setMarketWatchSaving(false)
    }
  }

  const updateMarketWatchRule = (id: string, patch: Partial<MarketWatchRule>) => {
    setMarketWatchRules((rules) => rules.map((rule) => rule.id === id ? { ...rule, ...patch } : rule))
  }

  const addMarketWatchRule = () => {
    const id = `new-${Date.now()}`
    setMarketWatchRules((rules) => [
      ...rules,
      {
        id,
        symbol: '',
        name: '',
        thresholdPercent: 10,
        windowDays: 250,
        enabled: true,
      },
    ])
  }

  const removeMarketWatchRule = (id: string) => {
    setMarketWatchRules((rules) => rules.filter((rule) => rule.id !== id))
  }

  const handleAcknowledge = async (id: string) => {
    try {
      await axios.post(`/api/v1/alerts/${id}/acknowledge`)
      message.success('告警已确认')
      fetchAlerts()
    } catch (error) {
      console.error('Failed to acknowledge alert:', error)
      message.error('确认告警失败')
    }
  }

  const handleResolve = async (id: string) => {
    try {
      await axios.post(`/api/v1/alerts/${id}/resolve`)
      message.success('告警已解决')
      fetchAlerts()
    } catch (error) {
      console.error('Failed to resolve alert:', error)
      message.error('解决告警失败')
    }
  }

  const columns: ColumnsType<AlertRecord> = [
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (value: AlertStatus) => <Tag color={statusColor[value]}>{statusLabel[value] || value}</Tag>,
    },
    {
      title: '级别',
      dataIndex: 'severity',
      width: 90,
      render: (value: AlertSeverity) => <Tag color={severityColor[value]}>{severityLabel[value] || value}</Tag>,
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (value: AlertType) => typeLabel[value] || value,
    },
    {
      title: '标的',
      dataIndex: 'assetSymbol',
      width: 110,
      render: (value?: string) => value || '-',
    },
    {
      title: '告警',
      key: 'content',
      render: (_, record) => (
        <div>
          <div className="text-white font-medium">{record.title}</div>
          <div className="text-xs text-gray-300">{record.message}</div>
        </div>
      ),
    },
    {
      title: '触发时间',
      dataIndex: 'triggeredAt',
      width: 170,
      render: (value?: string) => value ? new Date(value).toLocaleString() : '-',
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      render: (_, record) => (
        <div className="flex gap-2">
          <Button size="small" icon={<CheckCircleOutlined />} disabled={record.status !== 'active'} onClick={() => handleAcknowledge(record.id)}>
            确认
          </Button>
          <Button size="small" type="primary" disabled={record.status === 'resolved'} onClick={() => handleResolve(record.id)}>
            解决
          </Button>
        </div>
      ),
    },
  ]

  const marketWatchColumns: ColumnsType<MarketWatchEvaluation> = [
    {
      title: '标的',
      dataIndex: 'name',
      width: 150,
      render: (_, record) => (
        <div>
          <div className="text-white font-medium">{record.name}</div>
          <div className="text-xs text-gray-400">{record.symbol}</div>
        </div>
      ),
    },
    {
      title: '当前点位',
      dataIndex: 'latestPrice',
      width: 120,
      render: (value: number | null) => value === null ? '-' : value.toFixed(3),
    },
    {
      title: '阶段高点',
      dataIndex: 'peakPrice',
      width: 150,
      render: (value: number | null, record) => value === null ? '-' : `${value.toFixed(3)} / ${record.peakDate || '-'}`,
    },
    {
      title: '当前回撤',
      dataIndex: 'drawdownPercent',
      width: 120,
      render: (value: number | null, record) => value === null ? '-' : (
        <Tag color={record.triggered ? severityColor[record.severity] : 'green'}>{value.toFixed(2)}%</Tag>
      ),
    },
    {
      title: '提醒阈值',
      dataIndex: 'thresholdPercent',
      width: 110,
      render: (value: number) => `${value.toFixed(2)}%`,
    },
    {
      title: '状态',
      dataIndex: 'triggered',
      width: 120,
      render: (value: boolean, record) => record.dataStatus === 'error'
        ? <Tag color="red">数据失败</Tag>
        : <Tag color={value ? 'gold' : 'green'}>{value ? '已触发' : '未触发'}</Tag>,
    },
    {
      title: '行情日期',
      dataIndex: 'latestDate',
      width: 120,
      render: (value: string | null) => value || '-',
    },
    {
      title: '说明',
      dataIndex: 'message',
      render: (value: string) => <span className="text-gray-300">{value}</span>,
    },
  ]

  const marketWatchRuleColumns: ColumnsType<MarketWatchRule> = [
    {
      title: '代码',
      dataIndex: 'symbol',
      width: 150,
      render: (value: string, record) => (
        <Input value={value} onChange={(event) => updateMarketWatchRule(record.id, { symbol: event.target.value })} placeholder="000001.SH" />
      ),
    },
    {
      title: '名称',
      dataIndex: 'name',
      width: 150,
      render: (value: string, record) => (
        <Input value={value} onChange={(event) => updateMarketWatchRule(record.id, { name: event.target.value })} placeholder="上证指数" />
      ),
    },
    {
      title: '回撤阈值',
      dataIndex: 'thresholdPercent',
      width: 130,
      render: (value: number, record) => (
        <div className="flex items-center gap-1">
          <InputNumber min={0.1} max={80} precision={2} value={value} onChange={(next) => updateMarketWatchRule(record.id, { thresholdPercent: Number(next || 10) })} />
          <span className="text-gray-300">%</span>
        </div>
      ),
    },
    {
      title: '窗口',
      dataIndex: 'windowDays',
      width: 120,
      render: (value: number, record) => (
        <div className="flex items-center gap-1">
          <InputNumber min={30} max={1000} precision={0} value={value} onChange={(next) => updateMarketWatchRule(record.id, { windowDays: Number(next || 250) })} />
          <span className="text-gray-300">日</span>
        </div>
      ),
    },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 90,
      render: (value: boolean, record) => (
        <Switch checked={value} onChange={(checked) => updateMarketWatchRule(record.id, { enabled: checked })} />
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      render: (_, record) => (
        <Button size="small" danger onClick={() => removeMarketWatchRule(record.id)}>
          删除
        </Button>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white mb-0">风险告警</h1>
        <div className="flex gap-2">
          <Select
            value={status}
            onChange={setStatus}
            style={{ width: 120 }}
            options={[
              { label: '活跃', value: 'active' },
              { label: '已确认', value: 'acknowledged' },
              { label: '已解决', value: 'resolved' },
              { label: '全部', value: 'all' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={fetchAlerts} loading={loading}>
            刷新
          </Button>
          <Button type="primary" icon={<SyncOutlined />} onClick={handleRiskCheck} loading={checking}>
            检查风险
          </Button>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}>
          <Card className="bg-[#1a1a2e] border-[surface-border]">
            <Statistic title={<span className="text-gray-300">活跃告警</span>} value={stats.active} suffix="条" valueStyle={{ color: stats.active > 0 ? '#f87171' : '#34d399' }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="bg-[#1a1a2e] border-[surface-border]">
            <Statistic title={<span className="text-gray-300">危险级别</span>} value={stats.danger} suffix="条" valueStyle={{ color: '#f87171' }} />
          </Card>
        </Col>
        <Col xs={24} md={8}>
          <Card className="bg-[#1a1a2e] border-[surface-border]">
            <Statistic title={<span className="text-gray-300">规则来源</span>} value="止盈/止损/集中度" prefix={<SafetyCertificateOutlined />} valueStyle={{ color: '#fbbf24', fontSize: 20 }} />
          </Card>
        </Col>
      </Row>

      <Card
        className="bg-[#1a1a2e] border-[surface-border]"
        title={<span className="text-white">宽基回撤监控</span>}
        extra={(
          <div className="flex gap-2">
            <Button icon={<ReloadOutlined />} onClick={fetchMarketWatch} loading={marketWatchLoading}>
              刷新
            </Button>
            <Button type="primary" icon={<SyncOutlined />} onClick={handleCheckMarketWatch} loading={marketWatchLoading}>
              检查宽基
            </Button>
          </div>
        )}
      >
        <Table
          columns={marketWatchColumns}
          dataSource={marketWatchEvaluations}
          rowKey="ruleId"
          loading={marketWatchLoading}
          size="small"
          pagination={false}
          scroll={{ x: 1150 }}
        />
      </Card>

      <Card
        className="bg-[#1a1a2e] border-[surface-border]"
        title={<span className="text-white">宽基监控配置</span>}
        extra={(
          <div className="flex gap-2">
            <Button icon={<PlusOutlined />} onClick={addMarketWatchRule}>
              添加标的
            </Button>
            <Button type="primary" onClick={handleSaveMarketWatchRules} loading={marketWatchSaving}>
              保存配置
            </Button>
          </div>
        )}
      >
        <Table
          columns={marketWatchRuleColumns}
          dataSource={marketWatchRules}
          rowKey="id"
          loading={marketWatchLoading}
          size="small"
          pagination={false}
          scroll={{ x: 760 }}
        />
      </Card>

      <Card className="bg-[#1a1a2e] border-[surface-border]">
        <Table
          columns={columns}
          dataSource={alerts}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={{ x: 1050 }}
        />
      </Card>
    </div>
  )
}

export default Alerts
