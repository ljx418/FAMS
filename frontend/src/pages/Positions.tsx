import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo } from 'react'
import { Alert, Card, Row, Col, Button, message, Modal, Progress, Spin, Tag, Upload, Table, Form, Input, InputNumber, Select } from 'antd'
import { PlusOutlined, SyncOutlined, UploadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import PositionBin from '../components/position/PositionBin'
import AlipayAllocationDonut, { type AlipayAllocationSlice } from '../components/position/AlipayAllocationDonut'
import ProviderHealthSummary, { type ProviderHealthItem } from '../components/common/ProviderHealthSummary'
import RefreshFailureTable, { formatRefreshFailureSummary, type RefreshFailureItem } from '../components/common/RefreshFailureTable'
import ReliabilityWarnings from '../components/common/ReliabilityWarnings'

const StockDetailModal = lazy(() => import('../components/stock/StockDetailModal'))

const USER_ID = 'default'

const getOperationId = (data: any) => data?.operation_id || data?.operationId || data?.id
const TERMINAL_OPERATION_STATUSES = new Set(['completed', 'succeeded', 'partial', 'failed', 'cancelled'])
const SUCCESS_OPERATION_STATUSES = new Set(['completed', 'succeeded', 'partial'])

const LazyModalFallback = () => (
  <div className="flex items-center justify-center py-10">
    <Spin />
  </div>
)

interface AssetInfo {
  symbol: string
  name: string
  proportion: number
  value: number
  change: number
  pnl: number
  pnlPercent: number
}

interface PositionBin {
  tag: string
  totalTarget: number
  totalCurrent: number
  fillPercent: number
  totalPnl: number
  totalPnlPercent: number
  assets: AssetInfo[]
}

interface BinsResponse {
  bins: PositionBin[]
  totalValue: number
}

interface PositionTarget {
  targetValue: number
  setAt: string
}

interface AllocationPlanBucket {
  key: string
  tag: string
  label: string
  targetRatio: number
  targetValue: number
  currentValue: number
  currentRatio: number
  gapValue: number
  deviationPctPoint: number
  triggered: boolean
  triggerReason: string
}

interface AllocationPlanAccount {
  id: string
  name: string
  strategy: string
  currentValue: number
  description: string
  buckets: AllocationPlanBucket[]
}

interface ApprovedAllocationPlan {
  schemaVersion: string
  name: string
  status: 'approved'
  approvedAt: string
  capturedAt: string
  totalAssetValue: number
  currency: string
  accounts: AllocationPlanAccount[]
  rebalancePolicy?: {
    thresholdPctPoint: number
  }
  classification?: {
    status: 'complete' | 'blocked'
    unknownAlipaySymbols: string[]
  }
  sourceReconciliation?: {
    status: 'warning' | 'failed'
    accountHeadlineValue: number
    positionRowsValue: number
    variance: number
    tolerance: number
    note: string
  }
  executionBoundary: {
    createsBrokerOrder: boolean
    humanConfirmationRequired: boolean
    note: string
  }
}

interface AllocationGapRow extends AllocationPlanBucket {
  accountId: string
  accountName: string
  currentValue: number
  gapValue: number
  fillPercent: number
}

const formatCurrency = (value: number) => new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  maximumFractionDigits: 0,
}).format(value)

const ALIPAY_BUCKET_ORDER = ['cash', 'gold', 'bond', 'equity']
const ALIPAY_BUCKET_COLORS: Record<string, string> = {
  cash: '#2563eb',
  gold: '#b45309',
  bond: '#047857',
  equity: '#7c3aed',
}

// 解析后的资产数据结构
interface ParsedAsset {
  category: string
  attribute: string
  subCategory: string
  symbol: string | null
  netValue: number
  pnlOrPercent: number | null
  isPercent: boolean
  calculatedCost: number | null
}

const Positions: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [bins, setBins] = useState<PositionBin[]>([])
  const [totalValue, setTotalValue] = useState(0)
  const [positionTargets, setPositionTargets] = useState<Record<string, PositionTarget>>({})
  const [allocationPlan, setAllocationPlan] = useState<ApprovedAllocationPlan | null>(null)
  const [allocationPlanError, setAllocationPlanError] = useState<string | null>(null)
  const [savingTargetTag, setSavingTargetTag] = useState<string | null>(null)
  const [refreshFailureVisible, setRefreshFailureVisible] = useState(false)
  const [refreshFailures, setRefreshFailures] = useState<RefreshFailureItem[]>([])
  const [refreshProviderSummary, setRefreshProviderSummary] = useState<ProviderHealthItem[]>([])
  const [manualBuyVisible, setManualBuyVisible] = useState(false)
  const [manualBuySaving, setManualBuySaving] = useState(false)
  const [manualBuyForm] = Form.useForm()

  // 股票详情弹窗
  const [stockDetailVisible, setStockDetailVisible] = useState(false)
  const [stockDetailCode, setStockDetailCode] = useState<string>('')
  const [stockDetailName, setStockDetailName] = useState<string>('')

  // 导入相关状态
  const [importModalVisible, setImportModalVisible] = useState(false)
  const [parsedPreview, setParsedPreview] = useState<ParsedAsset[]>([])
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)

  const fetchPositionsByTag = useCallback(async () => {
    setLoading(true)
    try {
      const response = await axios.get(`/api/v1/positions/by-tag/${USER_ID}`)
      const data: BinsResponse = response.data
      setBins(data.bins || [])
      setTotalValue(data.totalValue || 0)
    } catch (error) {
      console.error('Failed to fetch positions by tag:', error)
      message.error('获取仓位数据失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPositionTargets = useCallback(async () => {
    try {
      const response = await axios.get(`/api/v1/positions/targets/${USER_ID}`)
      setPositionTargets(response.data || {})
    } catch (error) {
      console.error('Failed to fetch position targets:', error)
      message.error('获取目标仓位失败')
    }
  }, [])

  const fetchAllocationPlan = useCallback(async () => {
    try {
      setAllocationPlanError(null)
      const response = await axios.get(`/api/v1/positions/allocation-plan/${USER_ID}`)
      setAllocationPlan(response.data || null)
    } catch (error) {
      console.error('Failed to fetch approved allocation plan:', error)
      setAllocationPlanError('支付宝目标方案读取失败，当前比例和目标比例暂时不能可靠对照。')
    }
  }, [])

  useEffect(() => {
    fetchPositionsByTag()
    fetchPositionTargets()
    fetchAllocationPlan()
  }, [fetchAllocationPlan, fetchPositionsByTag, fetchPositionTargets])

  const allocationGapRows = useMemo<AllocationGapRow[]>(() => {
    if (!allocationPlan) return []
    return allocationPlan.accounts.flatMap((account) => account.buckets.map((bucket) => {
      const currentValue = bucket.currentValue
      return {
        ...bucket,
        accountId: account.id,
        accountName: account.name,
        currentValue,
        gapValue: bucket.targetValue - currentValue,
        fillPercent: bucket.targetValue > 0 ? currentValue / bucket.targetValue * 100 : 0,
      }
    }))
  }, [allocationPlan])

  const alipayAccount = useMemo(
    () => allocationPlan?.accounts.find((account) => account.id === 'alipay') || null,
    [allocationPlan],
  )
  const otherPlanAccounts = useMemo(
    () => allocationPlan?.accounts.filter((account) => account.id !== 'alipay') || [],
    [allocationPlan],
  )
  const otherPositionBins = useMemo(
    () => bins.filter((bin) => !bin.tag.startsWith('支付宝·')),
    [bins],
  )
  const alipayAllocationSlices = useMemo<AlipayAllocationSlice[]>(() => {
    if (!alipayAccount) return []
    const binByTag = new Map(bins.map((bin) => [bin.tag, bin]))
    return [...alipayAccount.buckets]
      .sort((left, right) => ALIPAY_BUCKET_ORDER.indexOf(left.key) - ALIPAY_BUCKET_ORDER.indexOf(right.key))
      .map((bucket) => {
        const bin = binByTag.get(bucket.tag)
        return {
          key: bucket.key,
          tag: bucket.tag,
          label: bucket.label,
          color: ALIPAY_BUCKET_COLORS[bucket.key] || '#475569',
          currentValue: bucket.currentValue,
          currentRatio: bucket.currentRatio,
          targetValue: bucket.targetValue,
          targetRatio: bucket.targetRatio,
          deviationPctPoint: bucket.deviationPctPoint,
          triggered: bucket.triggered,
          triggerReason: bucket.triggerReason,
          assets: (bin?.assets || []).map((asset) => ({
            symbol: asset.symbol,
            name: asset.name,
            value: asset.value * 10_000,
            proportion: asset.proportion,
            pnl: asset.pnl * 10_000,
            pnlPercent: asset.pnlPercent,
          })),
        }
      })
  }, [alipayAccount, bins])
  const alipayGroupedValue = useMemo(
    () => alipayAllocationSlices.reduce(
      (total, slice) => total + slice.assets.reduce((sum, asset) => sum + asset.value, 0),
      0,
    ),
    [alipayAllocationSlices],
  )
  const alipayDataVariance = alipayAccount ? alipayGroupedValue - alipayAccount.currentValue : 0
  const alipayDetailMissing = alipayAllocationSlices.some((slice) => slice.currentValue > 0 && slice.assets.length === 0)

  const gapColumns: ColumnsType<AllocationGapRow> = [
    { title: '仓位', dataIndex: 'label', key: 'label', width: 130 },
    {
      title: '目标', dataIndex: 'targetValue', key: 'targetValue', width: 110,
      render: (value: number, row) => <span>{formatCurrency(value)} <span className="text-xs text-gray-400">({row.targetRatio}%)</span></span>,
    },
    { title: '当前', dataIndex: 'currentValue', key: 'currentValue', width: 100, render: (value: number) => formatCurrency(value) },
    {
      title: '当前占比', dataIndex: 'currentRatio', key: 'currentRatio', width: 100,
      render: (value: number) => `${value.toFixed(2)}%`,
    },
    {
      title: '偏离 / 触发', dataIndex: 'deviationPctPoint', key: 'deviationPctPoint', width: 145,
      render: (value: number, row) => (
        <Tag color={row.triggered ? 'error' : row.accountId === 'alipay' ? 'success' : 'default'} title={row.triggerReason}>
          {value > 0 ? '+' : ''}{value.toFixed(2)}pp · {row.accountId === 'alipay' ? (row.triggered ? '需调整' : '未触发') : '仅监控'}
        </Tag>
      ),
    },
    {
      title: '完成度', dataIndex: 'fillPercent', key: 'fillPercent', width: 180,
      render: (value: number) => (
        <Progress
          percent={Math.min(100, Number(value.toFixed(1)))}
          size="small"
          status="normal"
          strokeColor={value > 101 ? '#f59e0b' : value < 99 ? '#38bdf8' : '#34d399'}
          format={() => `${value.toFixed(1)}%`}
        />
      ),
    },
    {
      title: '缺口 / 盈余', dataIndex: 'gapValue', key: 'gapValue', width: 140,
      render: (value: number) => Math.abs(value) < 1
        ? <Tag color="success">已对齐</Tag>
        : value > 0
          ? <Tag color="blue">缺口 {formatCurrency(value)}</Tag>
          : <Tag color="orange">盈余 {formatCurrency(Math.abs(value))}</Tag>,
    },
  ]

  const pollRefreshOperation = async (operationId: string) => {
    for (let attempt = 0; attempt < 12; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      const response = await axios.get(`/api/v1/operations/${operationId}`)
      const operation = response.data
      if (TERMINAL_OPERATION_STATUSES.has(operation.status)) {
        return operation
      }
    }
    return null
  }

  const handleRefreshPrices = async () => {
    setLoading(true)
    try {
      const response = await axios.post('/api/v1/operations/refresh-prices', { userId: USER_ID })
      const operationId = getOperationId(response.data)
      if (!operationId) {
        throw new Error('未获取到 operation_id')
      }
      message.loading({ content: '价格刷新任务已启动', key: 'price-refresh' })
      const operation = await pollRefreshOperation(operationId)
      const result = operation?.result || {}
      const refreshed = result.refreshed || 0
      const failed = result.failed || 0
      const failures = ((result.results || []) as RefreshFailureItem[]).filter((item) => !item.success)
      const failureSummary = formatRefreshFailureSummary(failures)
      const externalRefreshed = result.externalRefreshed ?? result.realtimeRefreshed ?? refreshed
      const retainedLocalPrices = result.retainedLocalPrices ?? failures.filter((item) => item.fallbackUsed && item.stale).length
      const abnormalPriceJumps = ((result.results || []) as any[]).filter((item) => item.abnormalPriceJump).length
      const jumpSummary = abnormalPriceJumps > 0 ? `，异常跳变 ${abnormalPriceJumps}` : ''
      setRefreshFailures(failures)
      setRefreshProviderSummary((result.summary?.providerSummary || []) as ProviderHealthItem[])
      if (operation && SUCCESS_OPERATION_STATUSES.has(operation.status)) {
        const hasPartialFailures = failed > 0 || operation.status === 'partial'
        message[hasPartialFailures ? 'warning' : 'success']({
          content: failed > 0
            ? `价格刷新完成：外部成功 ${externalRefreshed}，未刷新 ${failed}，保留旧价 ${retainedLocalPrices}${jumpSummary}。${failureSummary}`
            : `价格刷新完成：外部成功 ${externalRefreshed}，未刷新 0${jumpSummary}`,
          key: 'price-refresh',
          duration: hasPartialFailures ? 6 : 3,
        })
        if (hasPartialFailures) {
          setRefreshFailureVisible(true)
        }
      } else if (operation?.status === 'failed') {
        message.error({ content: operation?.error?.message || '价格刷新失败', key: 'price-refresh' })
      } else {
        message.warning({ content: '价格刷新仍在后台执行，可稍后查看结果', key: 'price-refresh' })
      }
      await Promise.all([fetchPositionsByTag(), fetchAllocationPlan()])
    } catch (error) {
      console.error('Refresh failed:', error)
      message.error('刷新失败')
    } finally {
      setLoading(false)
    }
  }

  const handleAssetClick = (symbol: string, name: string) => {
    setStockDetailCode(symbol)
    setStockDetailName(name)
    setStockDetailVisible(true)
  }

  const handleSaveTarget = async (tag: string, targetValue: number) => {
    setSavingTargetTag(tag)
    try {
      const response = await axios.put(`/api/v1/positions/targets/${USER_ID}/${encodeURIComponent(tag)}`, {
        targetValue,
      })
      setPositionTargets((previous) => ({
        ...previous,
        [tag]: response.data,
      }))
    } finally {
      setSavingTargetTag(null)
    }
  }

  const handleManualBuy = async () => {
    const values = await manualBuyForm.validateFields()
    if (!values.amount && !values.quantity) {
      message.warning('买入金额和持仓份额至少填写一个')
      return
    }
    setManualBuySaving(true)
    try {
      const response = await axios.post('/api/v1/positions/manual-buy', {
        userId: USER_ID,
        ...values,
      })
      const position = response.data?.position
      const asset = position?.asset
      message.success(asset ? `已新增 ${asset.name || asset.symbol} 持仓` : '已新增持仓')
      setManualBuyVisible(false)
      manualBuyForm.resetFields()
      await Promise.all([fetchPositionsByTag(), fetchAllocationPlan()])
    } catch (error: any) {
      console.error('Manual buy failed:', error)
      message.error(error?.response?.data?.message || '新增持仓失败')
    } finally {
      setManualBuySaving(false)
    }
  }

  // 解析Excel文件（预览）
  const handleParseExcel = async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    try {
      const response = await axios.post('/api/v1/assets/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setParsedPreview(response.data.data || [])
      setPendingFile(file)
      setImportModalVisible(true)
    } catch (error) {
      console.error('Parse failed:', error)
      message.error('解析Excel失败')
    }
    return false // 阻止默认上传行为
  }

  // 执行导入
  const handleImport = async () => {
    if (!pendingFile) return
    setImporting(true)
    const formData = new FormData()
    formData.append('file', pendingFile)
    formData.append('userId', USER_ID)
    try {
      const response = await axios.post('/api/v1/assets/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const result = response.data
      message.success(`导入成功: ${result.success}条，失败: ${result.failed}条`)
      setImportModalVisible(false)
      setPendingFile(null)
      setParsedPreview([])
      await Promise.all([fetchPositionsByTag(), fetchAllocationPlan()]) // 刷新仓位与批准目标数据
    } catch (error) {
      console.error('Import failed:', error)
      message.error('导入失败')
    } finally {
      setImporting(false)
    }
  }

  // 预览表格列定义
  const previewColumns: ColumnsType<ParsedAsset> = [
    { title: '大类', dataIndex: 'category', key: 'category' },
    { title: '属性', dataIndex: 'attribute', key: 'attribute' },
    { title: '小类', dataIndex: 'subCategory', key: 'subCategory' },
    { title: '代码', dataIndex: 'symbol', key: 'symbol' },
    { title: '持股数', dataIndex: 'userShares', key: 'userShares', render: (v) => v ?? '-' },
    {
      title: '成本(万元)',
      dataIndex: 'calculatedCost',
      key: 'calculatedCost',
      render: (v) => v ? (v / 10000).toFixed(4) : '-',
    },
    {
      title: '持仓净值(万元)',
      dataIndex: 'netValue',
      key: 'netValue',
      render: (v) => v?.toFixed(4) || '-',
    },
    {
      title: '元/股',
      dataIndex: 'userCostPerShare',
      key: 'userCostPerShare',
      render: (v) => v ?? '-',
    },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white mb-6">仓位管理</h1>

      {/* 总览 */}
      <Card className="bg-[#1a1a2e] border-[surface-border] card-md">
        <div className="mb-4 flex flex-col justify-between gap-4 md:flex-row md:items-center">
          <div>
            <span className="text-gray-300 mr-2">全部账户总仓位:</span>
            <span className="text-2xl font-bold text-white">
              {totalValue.toFixed(2)}万
            </span>
            <span className="text-gray-300 ml-4">
              共 {bins.length} 个仓位
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setManualBuyVisible(true)}
            >
              新增持仓
            </Button>
            <Button
              icon={<SyncOutlined />}
              onClick={handleRefreshPrices}
              loading={loading}
            >
              刷新价格
            </Button>
            <Upload
              beforeUpload={handleParseExcel}
              showUploadList={false}
              accept=".xlsx,.xls"
            >
              <Button icon={<UploadOutlined />}>导入Excel</Button>
            </Upload>
          </div>
        </div>

        {/* 图例 */}
        <div className="flex flex-wrap gap-4 text-sm text-gray-300">
          <span>• 支付宝使用饼图对照当前比例与批准目标</span>
          <span>• 其他账户继续使用仓位卡管理</span>
          <span>• 在资产明细中点击代码查看详情</span>
        </div>
      </Card>

      {allocationPlanError && (
        <Alert type="error" showIcon message="批准目标暂不可用" description={allocationPlanError} />
      )}

      {allocationPlan && (
        <Card
          title={<span className="text-white">账户配置与已批准目标</span>}
          extra={<Tag color="success">已生效 · 不自动下单</Tag>}
          className="bg-[#1a1a2e] border-[surface-border] card-md"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-sm text-gray-300">
            <span>
              {allocationPlan.name}。支付宝以账户总额为基准，绝对偏离严格大于 {allocationPlan.rebalancePolicy?.thresholdPctPoint ?? 3} 个百分点才触发。
            </span>
            <span>
              数据时点：{new Date(allocationPlan.capturedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}
            </span>
          </div>

          {allocationPlan.classification?.status === 'blocked' && (
            <Alert
              className="mb-4"
              type="error"
              showIcon
              message="支付宝持仓分类不完整"
              description={`以下标的尚未归入现金、黄金、债券或权益：${allocationPlan.classification.unknownAlipaySymbols.join('、') || '未知标的'}`}
            />
          )}
          {(Math.abs(alipayDataVariance) > 1 || alipayDetailMissing) && (
            <Alert
              className="mb-4"
              type="warning"
              showIcon
              message="支付宝汇总与内部明细需要核对"
              description={alipayDetailMissing
                ? '至少一个有余额的资产类别缺少内部持仓明细，图表保留当前比例，但不会虚构标的。'
                : `账户汇总与内部标的合计相差 ${formatCurrency(Math.abs(alipayDataVariance))}，请刷新价格或检查持仓标签。`}
            />
          )}

          {alipayAccount && alipayAllocationSlices.length > 0 ? (
            <AlipayAllocationDonut
              slices={alipayAllocationSlices}
              totalValue={alipayAccount.currentValue}
              onAssetClick={handleAssetClick}
            />
          ) : (
            <Alert type="warning" showIcon message="当前批准方案中没有支付宝资产配置" />
          )}

          {otherPlanAccounts.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-3 text-base font-bold text-white">其他账户目标</h3>
              <Row gutter={[16, 16]}>
                {otherPlanAccounts.map((account) => (
              <Col xs={24} key={account.id}>
                <Card
                  size="small"
                  title={<span className="text-white">{account.name} · {account.strategy}</span>}
                  extra={<span className="text-gray-400">{formatCurrency(account.currentValue)}</span>}
                  className="h-full"
                >
                  <p className="text-sm text-gray-400 mb-3">{account.description}</p>
                  <Table
                    columns={gapColumns}
                    dataSource={allocationGapRows.filter((row) => row.accountId === account.id)}
                    rowKey="tag"
                    pagination={false}
                    size="small"
                    scroll={{ x: 980 }}
                  />
                </Card>
              </Col>
                ))}
              </Row>
            </div>
          )}
          <Alert className="mt-4" type="info" showIcon message={allocationPlan.executionBoundary.note} />
          {allocationPlan.sourceReconciliation && (
            <Alert
              className="mt-3"
              type="warning"
              showIcon
              message="截图金额核对提示"
              description={allocationPlan.sourceReconciliation.note}
            />
          )}
        </Card>
      )}

      <Modal
        title="新增持仓"
        open={manualBuyVisible}
        onCancel={() => setManualBuyVisible(false)}
        onOk={handleManualBuy}
        confirmLoading={manualBuySaving}
        destroyOnHidden
      >
        <Form
          form={manualBuyForm}
          layout="vertical"
          initialValues={{ amount: 8000, fee: 0 }}
        >
          <Form.Item
            name="input"
            label="标的代码或名称"
            rules={[{ required: true, message: '请输入标的代码或名称' }]}
            tooltip="优先输入基金/ETF/股票代码；仅输入名称时必须能命中本地资产或手动选择类型。"
          >
            <Input placeholder="例如 510500、000300、009725" />
          </Form.Item>
          <Form.Item name="name" label="名称">
            <Input placeholder="可选，例如 中证指数" />
          </Form.Item>
          <Form.Item
            name="assetType"
            label="资产类型"
            tooltip="无法自动识别时需要手动选择，避免静默按股票处理。"
          >
            <Select
              allowClear
              placeholder="自动识别，必要时手动选择"
              options={[
                { value: 'stock', label: '股票' },
                { value: 'etf', label: 'ETF' },
                { value: 'fund', label: '基金' },
                { value: 'bond', label: '债券/债基' },
                { value: 'gold', label: '黄金' },
                { value: 'cash', label: '现金' },
              ]}
            />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="amount"
                label="买入金额(元)"
                tooltip="填写金额时，系统按外部现价/净值或手动成交价反推份额；股票/ETF按100股一手取整。"
              >
                <InputNumber style={{ width: '100%' }} min={0} precision={2} placeholder="例如 8000" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="quantity" label="持仓份额/股数">
                <InputNumber style={{ width: '100%' }} min={0} precision={4} placeholder="可选" />
              </Form.Item>
            </Col>
          </Row>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item
                name="price"
                label="成交价/净值"
                tooltip="留空时系统从外部行情获取；获取失败时需要手动填写。"
              >
                <InputNumber style={{ width: '100%' }} min={0} precision={4} placeholder="自动获取或手动填" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fee" label="手续费(元)">
                <InputNumber style={{ width: '100%' }} min={0} precision={2} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="tags" label="标签">
            <Select mode="tags" placeholder="例如 宽基、中证指数、定投" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="可选" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 支付宝已由配置饼图承载；这里仅保留其他账户的仓位卡。 */}
      {loading && bins.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spin size="large" aria-label="加载仓位数据" />
        </div>
      ) : bins.length === 0 ? (
        <Card className="bg-[#1a1a2e] border-[surface-border]">
          <div className="text-center text-gray-300 py-12">
            暂无仓位数据，请在"资产管理"页面导入或添加资产
          </div>
        </Card>
      ) : otherPositionBins.length > 0 ? (
        <section aria-labelledby="other-account-positions-title">
          <h2 id="other-account-positions-title" className="mb-3 text-lg font-bold text-white">其他账户仓位</h2>
          <Row gutter={[16, 16]}>
            {otherPositionBins.map((bin) => (
              <Col key={bin.tag} xs={24} sm={12} md={8} lg={6}>
                <PositionBin
                  tag={bin.tag}
                  totalTarget={bin.totalTarget}
                  totalCurrent={bin.totalCurrent}
                  fillPercent={bin.fillPercent}
                  totalPnl={bin.totalPnl}
                  totalPnlPercent={bin.totalPnlPercent}
                  assets={bin.assets}
                  targetValue={positionTargets[bin.tag]?.targetValue}
                  savingTarget={savingTargetTag === bin.tag}
                  onSaveTarget={handleSaveTarget}
                  onAssetClick={handleAssetClick}
                />
              </Col>
            ))}
          </Row>
        </section>
      ) : (
        <Alert type="info" showIcon message="支付宝仓位已在上方饼图中展示，当前没有其他账户仓位。" />
      )}

      {/* 提示 */}
      <Card className="bg-[#1a1a2e] border-[surface-border]">
        <h3 className="text-white font-medium mb-2">仓位说明</h3>
        <ul className="text-gray-300 text-sm space-y-1">
          <li>• 支付宝饼图的实色内环表示当前比例，虚线外环读取已批准目标方案</li>
          <li>• 悬停、键盘获焦或手机点击某个类别，可在图内查看该类的基金代码、金额和占比</li>
          <li>• 其他账户卡片继续显示当前市值、目标市值、资产明细和盈亏</li>
          <li>• 支付宝总额与页面顶部的全部账户总仓位是两个不同口径</li>
          <li>• 目标调整只修改管理计划，不会自动生成或发送券商订单</li>
        </ul>
      </Card>

      {/* 股票详情弹窗 */}
      <Suspense fallback={<LazyModalFallback />}>
        <StockDetailModal
          visible={stockDetailVisible}
          stockCode={stockDetailCode}
          stockName={stockDetailName}
          onClose={() => setStockDetailVisible(false)}
        />
      </Suspense>

      {/* 导入预览弹窗 */}
      <Modal
        title="导入资产预览"
        open={importModalVisible}
        onCancel={() => {
          setImportModalVisible(false)
          setPendingFile(null)
          setParsedPreview([])
        }}
        onOk={handleImport}
        confirmLoading={importing}
        width={1000}
        destroyOnHidden
      >
        <Table
          columns={previewColumns}
          dataSource={parsedPreview}
          rowKey={(r, i) => `${r.symbol || 'null'}-${i}`}
          pagination={false}
          size="small"
          scroll={{ x: 800 }}
        />
      </Modal>

      <Modal
        title="价格刷新失败明细"
        open={refreshFailureVisible}
        onCancel={() => setRefreshFailureVisible(false)}
        footer={[
          <Button key="close" onClick={() => setRefreshFailureVisible(false)}>
            关闭
          </Button>,
        ]}
        width={960}
      >
        <div className="text-sm text-gray-300 mb-4">
          共 {refreshFailures.length} 条失败记录。失败分类会直接反映为网络受限、无可用数据、代码不适配、价格无效或源失败。
        </div>
        {refreshProviderSummary.length > 0 && (
          <ProviderHealthSummary items={refreshProviderSummary} className="mb-4" />
        )}
        <ReliabilityWarnings warnings={refreshFailures.map((item) => item.error || '').filter(Boolean)} className="mb-4 flex flex-wrap gap-2" />
        <RefreshFailureTable items={refreshFailures} />
      </Modal>
    </div>
  )
}

export default Positions
