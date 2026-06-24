import React, { Suspense, lazy, useState, useEffect, useCallback } from 'react'
import { Card, Row, Col, Button, message, Modal, Spin, Upload, Table, Form, Input, InputNumber, Select } from 'antd'
import { PlusOutlined, SyncOutlined, UploadOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'
import PositionBin from '../components/position/PositionBin'
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

  useEffect(() => {
    fetchPositionsByTag()
    fetchPositionTargets()
  }, [fetchPositionsByTag, fetchPositionTargets])

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
      await fetchPositionsByTag()
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
      await fetchPositionsByTag()
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
      fetchPositionsByTag() // 刷新仓位数据
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
        <div className="flex justify-between items-center mb-4">
          <div>
            <span className="text-gray-300 mr-2">总仓位价值:</span>
            <span className="text-2xl font-bold text-white">
              {totalValue.toFixed(2)}万
            </span>
            <span className="text-gray-300 ml-4">
              共 {bins.length} 个仓位
            </span>
          </div>
          <div className="flex gap-2">
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
          <span>• 点击列表图标查看详细资产占比</span>
          <span>• 点击齿轮图标修改目标仓位</span>
          <span>• 在资产明细中点击代码查看详情</span>
        </div>
      </Card>

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

      {/* 粮仓可视化 */}
      {loading && bins.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spin size="large" tip="加载中..." />
        </div>
      ) : bins.length === 0 ? (
        <Card className="bg-[#1a1a2e] border-[surface-border]">
          <div className="text-center text-gray-300 py-12">
            暂无仓位数据，请在"资产管理"页面导入或添加资产
          </div>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {bins.map((bin) => (
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
      )}

      {/* 提示 */}
      <Card className="bg-[#1a1a2e] border-[surface-border]">
        <h3 className="text-white font-medium mb-2">仓位说明</h3>
        <ul className="text-gray-300 text-sm space-y-1">
          <li>• 每个仓位卡片代表一个标签类别（如新能源、港股、科技等）</li>
          <li>• 卡片中的进度条表示当前市值占目标的比例</li>
          <li>• 点击卡片右上角列表图标可查看该仓位内各资产的详细占比和盈亏</li>
          <li>• 点击卡片右上角齿轮图标可修改目标仓位</li>
          <li>• 在资产明细中点击代码可查看该股票的详细分析</li>
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
