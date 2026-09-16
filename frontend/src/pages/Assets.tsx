import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react'
import { Alert, App as AntApp, Card, Table, Button, Upload, Modal, Form, Input, InputNumber, Select, Tabs, Popconfirm, Row, Col, Statistic, Segmented, Tag, Spin } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  UploadOutlined,
  DeleteOutlined,
  SwapOutlined,
  DownloadOutlined,
  EditOutlined,
  FileExcelOutlined,
  InboxOutlined,
  WalletOutlined,
  RiseOutlined,
  PercentageOutlined,
  FundOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import AllocationPieChart from '../components/charts/AllocationPieChart'
import EditAssetModal from '../components/common/EditAssetModal'
import EditableCell from '../components/common/EditableCell'
import ProviderHealthSummary, { type ProviderHealthItem } from '../components/common/ProviderHealthSummary'
import RefreshFailureTable, { formatRefreshFailureSummary, type RefreshFailureItem } from '../components/common/RefreshFailureTable'
import ReliabilityWarnings from '../components/common/ReliabilityWarnings'
import TagSelector from '../components/common/TagSelector'
import { ScreenshotCapturePanel } from '../components/capture/ScreenshotCapturePanel'
import { PositionStrategyAssignmentPanel } from '../components/investment-workflow/PositionStrategyAssignmentPanel'
import { InvestmentWorkflowBar } from '../components/investment-workflow/InvestmentWorkflowBar'

const StockDetailModal = lazy(() => import('../components/stock/StockDetailModal'))
const FundDetailModal = lazy(() => import('../components/fund/FundDetailModal'))
const GoldWeightConfirmModal = lazy(() => import('../components/gold/GoldWeightConfirmModal'))

const USER_ID = 'default'
const getOperationId = (data: any) => data?.operation_id || data?.operationId || data?.id
const TERMINAL_OPERATION_STATUSES = new Set(['completed', 'succeeded', 'partial', 'failed', 'cancelled'])
const SUCCESS_OPERATION_STATUSES = new Set(['completed', 'succeeded', 'partial'])
const SUCCESS_COLOR = '#34d399'
const DANGER_COLOR = '#f87171'
const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  buy: '买入',
  sell: '卖出',
  dividend: '分红',
  fee: '费用',
  deposit: '存入',
  withdraw: '取出',
}

const LazyModalFallback = () => (
  <div className="flex items-center justify-center py-10">
    <Spin />
  </div>
)

const isBoardLotAsset = (type?: string) => type === 'stock' || type === 'etf'
const roundToBoardLot = (quantity: number) => Math.floor(quantity / 100) * 100
const formatCurrency = (value: number) => `¥${value.toFixed(3)}`
const TAG_COLORS: Record<string, string> = {
  A股: '#5a6bff',
  港股: '#34d399',
  美股: '#38bdf8',
  科技: '#818cf8',
  医药: '#f87171',
  消费: '#fbbf24',
  金融: '#a78bfa',
  黄金: '#fbbf24',
  基金: '#36cfc9',
  ETF: '#36cfc9',
  债券: '#9ca3af',
  现金: '#6b7280',
  新能源: '#22c55e',
  股票: '#5a6bff',
  权益类: '#818cf8',
  固定收益: '#9ca3af',
  债基: '#9ca3af',
  中期债: '#94a3b8',
}

const TAG_CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  assetType: { label: '类型', color: '#38bdf8' },
  market: { label: '市场', color: '#5a6bff' },
  industry: { label: '行业', color: '#f59e0b' },
  strategy: { label: '策略', color: '#22c55e' },
  risk: { label: '风险', color: '#f87171' },
  custom: { label: '自定义', color: '#64748b' },
}

const getTagCategory = (tag: string) => {
  if (['股票', '基金', '债券', '黄金', '现金', 'ETF', '债基', '权益类', '固定收益'].includes(tag)) return 'assetType'
  if (['A股', '港股', '美股'].includes(tag)) return 'market'
  if (tag.includes('科技') || tag.includes('医') || tag.includes('消费') || tag.includes('金融') || tag.includes('互联') || tag.includes('新能源')) return 'industry'
  if (tag.includes('定投') || tag.includes('网格') || tag.includes('红利') || tag.includes('低波')) return 'strategy'
  if (tag.includes('高风险') || tag.includes('低风险') || tag.includes('观察')) return 'risk'
  return 'custom'
}

const getTagColor = (tag: string) => {
  if (TAG_COLORS[tag]) return TAG_COLORS[tag]
  const category = TAG_CATEGORY_CONFIG[getTagCategory(tag)]
  if (category) return category.color
  if (tag.includes('股')) return '#5a6bff'
  if (tag.includes('基金') || tag.toLowerCase().includes('etf')) return '#36cfc9'
  if (tag.includes('债')) return '#9ca3af'
  if (tag.includes('医')) return '#f87171'
  if (tag.includes('科技') || tag.includes('互联')) return '#818cf8'
  if (tag.includes('黄金') || tag.includes('贵金属')) return '#fbbf24'
  return '#64748b'
}

const renderCategorizedTag = (tag: string) => {
  const category = TAG_CATEGORY_CONFIG[getTagCategory(tag)]
  return (
    <Tag key={tag} color={getTagColor(tag)} style={{ marginInlineEnd: 0 }}>
      <span className="opacity-80">{category.label}</span>
      <span className="mx-1">|</span>
      <span>{tag}</span>
    </Tag>
  )
}

interface Asset {
  id: string
  symbol: string
  name: string
  type: string
  quantity?: number
  avgCost?: number
  currentPrice?: number
  marketValue?: number
  costBasis?: number
  unrealizedPnl?: number
  unrealizedPnlPercent?: number
  stopLoss?: number | null
  takeProfit?: number | null
  tags?: string[]
  createdAt?: string
  asset?: {
    id: string
    symbol: string
    name: string
    type: string
    lastPrice?: number
    lastUpdated?: string
    lastPriceSource?: string | null
  }
}

interface Transaction {
  id: string
  assetId: string
  asset?: { symbol: string; name: string }
  type: 'buy' | 'sell' | 'dividend' | 'fee' | 'deposit' | 'withdraw'
  quantity: number
  price: number
  amount: number
  fee: number
  executedAt: string
  status: string
}

interface ParsedRow {
  category: string
  subCategory: string
  symbol: string | null
  netValue: number
  userShares: number | null
  userCostPerShare: number | null
  userMarketValue: number | null
}

interface PriceFreshness {
  thresholdHours: number
  checkedAt: string
  valuationAsOf: string | null
  oldestPriceAt: string | null
  status: 'fresh' | 'stale' | 'missing' | 'refreshing'
  missingSymbols: string[]
  staleSymbols: string[]
  activeRefreshOperationId: string | null
  shouldAutoRefresh: boolean
}

const Assets: React.FC = () => {
  const { message } = AntApp.useApp()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [positions, setPositions] = useState<Asset[]>([])
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [importModalVisible, setImportModalVisible] = useState(false)
  const [tradeModalVisible, setTradeModalVisible] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [parsedPreview, setParsedPreview] = useState<ParsedRow[]>([])
  const [tradingAsset, setTradingAsset] = useState<Asset | null>(null)
  const [importing, setImporting] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [tradeSaving, setTradeSaving] = useState(false)
  const [tradeForm] = Form.useForm()
  const tradeType = Form.useWatch('type', tradeForm)
  const tradeQuantity = Form.useWatch('quantity', tradeForm) || 0
  const tradePrice = Form.useWatch('price', tradeForm) || 0
  const tradeFee = Form.useWatch('fee', tradeForm) || 0
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [tagModalVisible, setTagModalVisible] = useState(false)
  const [tagEditingAsset, setTagEditingAsset] = useState<Asset | null>(null)
  const [tagDraft, setTagDraft] = useState<string[]>([])

  // 股票详情弹窗
  const [stockDetailVisible, setStockDetailVisible] = useState(false)
  const [stockDetailCode, setStockDetailCode] = useState<string>('')
  const [stockDetailName, setStockDetailName] = useState<string>('')

  // 基金详情弹窗
  const [fundDetailVisible, setFundDetailVisible] = useState(false)
  const [fundDetailCode, setFundDetailCode] = useState<string>('')
  const [fundDetailName, setFundDetailName] = useState<string>('')

  // 编辑资产弹窗
  const [editAssetVisible, setEditAssetVisible] = useState(false)
  const [editingAsset, setEditingAsset] = useState<Asset | null>(null)

  // 黄金克重确认弹窗
  const [goldWeightModalVisible, setGoldWeightModalVisible] = useState(false)
  const [goldWeightData, setGoldWeightData] = useState<{
    positionId: string
    marketValue: number
    goldPrice: number
    estimatedWeight: number
  } | null>(null)

  // 导入成功弹窗
  const [importSuccessVisible, setImportSuccessVisible] = useState(false)
  const [importSuccessData, setImportSuccessData] = useState<{
    successCount: number
    totalValue: number
    marketDistribution: { name: string; value: number }[]
  } | null>(null)
  const [refreshFailureVisible, setRefreshFailureVisible] = useState(false)
  const [refreshFailures, setRefreshFailures] = useState<RefreshFailureItem[]>([])
  const [refreshProviderSummary, setRefreshProviderSummary] = useState<ProviderHealthItem[]>([])
  const [priceFreshness, setPriceFreshness] = useState<PriceFreshness | null>(null)
  const [captureAccountSource, setCaptureAccountSource] = useState<'tonghuashun' | 'alipay'>('tonghuashun')
  const autoRefreshAttempted = useRef(false)

  // 清空数据库确认
  const [clearModalVisible, setClearModalVisible] = useState(false)
  const [clearConfirmText, setClearConfirmText] = useState('')

  // 统计
  const [stats, setStats] = useState({
    totalValue: 0,
    totalCost: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
  })

  // 按类型过滤的资产列表
  const filteredPositions = positions.filter(p => {
    if (typeFilter === 'all') return true
    const assetType = p.asset?.type || p.type || ''
    return assetType === typeFilter
  })

  // 获取所有资产类型用于过滤
  const assetTypes = React.useMemo(() => {
    const types = new Set<string>()
    positions.forEach(p => {
      const t = p.asset?.type || p.type
      if (t) types.add(t)
    })
    return Array.from(types)
  }, [positions])

  // 类型选项
  const typeOptions = [
    { label: '全部', value: 'all' },
    ...assetTypes.map(t => ({
      label: t === 'stock' ? '股票' : t === 'fund' ? '基金' : t === 'gold' ? '黄金' : t === 'bond' ? '债券' : t === 'etf' ? 'ETF' : t === 'cash' ? '现金' : t,
      value: t,
    })),
  ]

  const fetchPositions = useCallback(async (allowAutoRefresh = true) => {
    setLoading(true)
    try {
      const response = await axios.get(`/api/v1/positions?userId=${USER_ID}&limit=100`)
      const data = response.data?.data || response.data || []
      setPositions(data)
      const summary = response.data?.summary
      const freshness = summary?.priceFreshness as PriceFreshness | undefined
      setPriceFreshness(freshness || null)
      setStats({
        totalValue: summary?.totalValue || 0,
        totalCost: summary?.totalCost || 0,
        totalPnl: summary?.totalPnl || 0,
        totalPnlPercent: summary?.totalPnlPercent || 0,
      })
      if (allowAutoRefresh && freshness?.shouldAutoRefresh && !autoRefreshAttempted.current) {
        autoRefreshAttempted.current = true
        const reason = freshness.missingSymbols.length > 0 ? 'missing_price_on_entry' : 'stale_on_entry'
        const bucketMs = Math.max(1, freshness.thresholdHours) * 60 * 60 * 1000
        const idempotencyKey = `asset-entry-refresh:${USER_ID}:${Math.floor(Date.now() / bucketMs)}`
        void (async () => {
          try {
            message.loading({ content: '检测到估值已过期，正在后台更新价格', key: 'asset-price-refresh' })
            const operationResponse = await axios.post('/api/v1/operations/refresh-prices', {
              userId: USER_ID,
              reason,
              idempotencyKey,
            })
            const operationId = getOperationId(operationResponse.data)
            if (!operationId) throw new Error('未获取到 operation_id')
            const operation = await pollRefreshOperation(operationId)
            if (operation && SUCCESS_OPERATION_STATUSES.has(operation.status)) {
              message.success({ content: '资产价格已按新鲜度规则更新', key: 'asset-price-refresh' })
            } else if (operation?.status === 'failed') {
              message.warning({ content: '自动刷新失败，当前继续显示旧估值并标注截止时间', key: 'asset-price-refresh' })
            }
            await fetchPositions(false)
          } catch (error) {
            console.error('Automatic price refresh failed:', error)
            message.warning({ content: '自动刷新未完成，当前估值仍按页面标注的时间为准', key: 'asset-price-refresh' })
          }
        })()
      }
    } catch (error) {
      console.error('Failed to fetch positions:', error)
      message.error('获取资产列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchTransactions = useCallback(async () => {
    try {
      const response = await axios.get(`/api/v1/transactions?userId=${USER_ID}`)
      setTransactions(response.data?.data || response.data || [])
    } catch (error) {
      console.error('Failed to fetch transactions:', error)
    }
  }, [])

  useEffect(() => {
    fetchPositions()
    fetchTransactions()
  }, [fetchPositions, fetchTransactions])

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

  // 解析Excel
  const handleParseExcel = async (file: File) => {
    setSelectedFile(file)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const response = await axios.post('/api/v1/assets/parse', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      setParsedPreview(response.data?.data || [])
      setImportModalVisible(true)
    } catch (error) {
      console.error('Parse failed:', error)
      message.error('解析Excel失败')
    }
    return false
  }

  // 下载导入模板
  const handleDownloadTemplate = async () => {
    try {
      const response = await axios.get('/api/v1/assets/template', {
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      link.href = url
      link.setAttribute('download', 'asset_import_template.xlsx')
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      message.success('模板下载成功')
    } catch (error) {
      console.error('Template download failed:', error)
      message.error('模板下载失败')
    }
  }

  // 导出当前资产与交易记录
  const handleExportAssets = async () => {
    setExporting(true)
    try {
      const response = await axios.get(`/api/v1/assets/export?userId=${USER_ID}`, {
        responseType: 'blob',
      })
      const url = window.URL.createObjectURL(new Blob([response.data]))
      const link = document.createElement('a')
      const disposition = response.headers?.['content-disposition'] || ''
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/)
      link.href = url
      link.setAttribute('download', filenameMatch?.[1] || `asset_export_${USER_ID}.xlsx`)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(url)
      message.success('资产与交易记录已导出')
    } catch (error) {
      console.error('Asset export failed:', error)
      message.error('导出失败')
    } finally {
      setExporting(false)
    }
  }

  // 导入
  const handleImport = async () => {
    if (!selectedFile) {
      message.error('请先选择文件')
      return
    }

    setImporting(true)
    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('userId', USER_ID)
    try {
      const response = await axios.post('/api/v1/assets/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const result = response.data
      message.success(`导入成功: ${result.success}条，失败: ${result.failed}条`)
      setImportModalVisible(false)
      setSelectedFile(null)
      setParsedPreview([])
      fetchPositions()

      // 获取最新仓位数据用于展示市值分布
      const positionsResponse = await axios.get(`/api/v1/positions?userId=${USER_ID}`)
      const positionsData = positionsResponse.data?.data || positionsResponse.data || []

      // 计算总市值
      const totalValue = positionsData.reduce((sum: number, p: any) => sum + (p.marketValue || 0), 0)

      // 按类型分组计算市值分布
      const typeDistribution: Record<string, number> = {}
      positionsData.forEach((p: any) => {
        const assetType = p.asset?.type || p.type || 'other'
        if (!typeDistribution[assetType]) {
          typeDistribution[assetType] = 0
        }
        typeDistribution[assetType] += p.marketValue || 0
      })

      // 转换为饼图数据格式
      const marketDistribution = Object.entries(typeDistribution).map(([name, value]) => ({
        name: name === 'stock' ? '股票' : name === 'fund' ? '基金' : name === 'gold' ? '黄金' : name === 'bond' ? '债券' : '其他',
        value: Math.round(value / 10000 * 100) / 100, // 转换为万元，保留2位小数
      })).filter(item => item.value > 0)

      // 显示导入成功弹窗
      setImportSuccessData({
        successCount: result.success,
        totalValue: Math.round(totalValue / 10000 * 100) / 100, // 万元
        marketDistribution,
      })
      setImportSuccessVisible(true)
    } catch (error) {
      console.error('Import failed:', error)
      message.error('导入失败')
    } finally {
      setImporting(false)
    }
  }

  // 删除资产
  const handleDelete = async (id: string) => {
    console.log('[Delete] Attempting to delete position:', id)
    try {
      const response = await axios.delete(`/api/v1/positions/${id}`)
      console.log('[Delete] Success:', response.data)
      message.success('删除成功')
      fetchPositions()
    } catch (error: any) {
      console.error('[Delete] Failed:', error?.response?.data || error.message || error)
      message.error('删除失败')
    }
  }

  // 点击资产代码 - 股票打开详情弹窗，基金打开基金详情弹窗
  const handleAssetClick = (record: Asset) => {
    const assetType = record.asset?.type || record.type
    const symbol = record.asset?.symbol || record.symbol
    const name = record.asset?.name || record.name

    if (assetType === 'fund') {
      setFundDetailCode(symbol)
      setFundDetailName(name)
      setFundDetailVisible(true)
    } else {
      // 股票/ETF打开详情弹窗
      setStockDetailCode(symbol)
      setStockDetailName(name)
      setStockDetailVisible(true)
    }
  }

  // 打开交易弹窗
  const handleTrade = (record: Asset) => {
    setTradingAsset(record)
    tradeForm.resetFields()
    tradeForm.setFieldsValue({
      symbol: record.asset?.symbol || record.symbol,
      stockName: record.asset?.name || record.name,
      type: 'buy',
      price: record.currentPrice || 0,
      fee: 0,
    })
    setTradeModalVisible(true)
  }

  // 双击编辑资产
  const handleEditAsset = (record: Asset) => {
    setEditingAsset(record)
    setEditAssetVisible(true)
  }

  const handleEditTags = (record: Asset) => {
    setTagEditingAsset(record)
    setTagDraft(record.tags || [])
    setTagModalVisible(true)
  }

  const handleSaveTags = async () => {
    if (!tagEditingAsset) return
    try {
      await axios.patch(`/api/v1/positions/${tagEditingAsset.id}`, { tags: tagDraft })
      message.success('标签已更新')
      setTagModalVisible(false)
      setTagEditingAsset(null)
      fetchPositions()
    } catch (error) {
      console.error('Failed to update tags:', error)
      message.error('更新标签失败')
    }
  }

  const submitTrade = async (values: any, assetId: string) => {
    try {
      setTradeSaving(true)
      // 交易服务负责同步更新持仓，前端不再重复改仓位。
      const response = await axios.post('/api/v1/transactions', {
        userId: USER_ID,
        assetId,
        type: values.type,
        quantity: values.quantity,
        price: values.price,
        fee: values.fee || 0,
        executedAt: new Date().toISOString(),
      })
      const alertedSymbols = response.data?.riskCheck?.alertedSymbols || []

      message.success(alertedSymbols.length > 0 ? `交易记录已保存，触发 ${alertedSymbols.length} 个风险告警` : '交易记录已保存')
      setTradeModalVisible(false)
      fetchPositions()
      fetchTransactions()
    } catch (error) {
      console.error('Trade failed:', error)
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '交易失败'
      message.error(errorMessage)
    } finally {
      setTradeSaving(false)
    }
  }

  // 确认交易
  const handleTradeConfirm = async () => {
    const values = await tradeForm.validateFields()
    const position = tradingAsset
    const asset = position?.asset

    if (!position || !asset?.id) {
      message.error('找不到对应资产')
      return
    }

    if (
      isBoardLotAsset(asset.type) &&
      (values.type === 'buy' || values.type === 'sell') &&
      values.quantity % 100 !== 0
    ) {
      message.error('股票交易数量必须是100股的整数倍')
      return
    }

    const amount = values.quantity * values.price
    const fee = values.fee || 0
    const total = values.type === 'buy' || values.type === 'fee' ? amount + fee : amount - fee
    const symbol = asset.symbol || position.symbol
    const name = asset.name || position.name

    Modal.confirm({
      title: '确认记账',
      okText: '确认并记账',
      cancelText: '返回修改',
      content: (
        <div className="space-y-2 pt-2">
          <div className="flex justify-between"><span>资产</span><strong>{symbol} {name}</strong></div>
          <div className="flex justify-between"><span>方向</span><strong>{TRANSACTION_TYPE_LABELS[values.type] || values.type}</strong></div>
          <div className="flex justify-between"><span>数量</span><strong>{values.quantity}</strong></div>
          <div className="flex justify-between"><span>价格</span><strong>{formatCurrency(values.price)}</strong></div>
          <div className="flex justify-between"><span>手续费</span><strong>{formatCurrency(fee)}</strong></div>
          <div className="flex justify-between border-t border-gray-200 pt-2"><span>入账金额</span><strong>{formatCurrency(total)}</strong></div>
        </div>
      ),
      onOk: () => submitTrade(values, asset.id),
    })
  }

  // 刷新价格
  const handleRefreshPrices = async () => {
    setLoading(true)
    try {
      const operationResponse = await axios.post('/api/v1/operations/refresh-prices', {
        userId: USER_ID,
        reason: 'manual',
        idempotencyKey: `asset-manual-refresh:${USER_ID}:${Date.now()}`,
      })
      const operationId = getOperationId(operationResponse.data)
      if (!operationId) {
        throw new Error('未获取到 operation_id')
      }
      message.loading({ content: '价格刷新任务已启动', key: 'asset-price-refresh' })
      const operation = await pollRefreshOperation(operationId)
      const refreshResult = operation?.result || {}
      const failures = ((refreshResult.results || []) as RefreshFailureItem[]).filter((item) => item.success === false)
      const failureSummary = formatRefreshFailureSummary(failures)
      const externalRefreshed = refreshResult.externalRefreshed ?? refreshResult.realtimeRefreshed ?? refreshResult.refreshed ?? 0
      const retainedLocalPrices = refreshResult.retainedLocalPrices ?? failures.filter((item) => item.fallbackUsed && item.stale).length
      const abnormalPriceJumps = ((refreshResult.results || []) as any[]).filter((item) => item.abnormalPriceJump).length
      const jumpSummary = abnormalPriceJumps > 0 ? `，异常跳变 ${abnormalPriceJumps}` : ''
      setRefreshFailures(failures)
      setRefreshProviderSummary((refreshResult.summary?.providerSummary || []) as ProviderHealthItem[])

      // 检查是否有黄金资产克重为空
      const response = await axios.get(`/api/v1/positions?userId=${USER_ID}&limit=100`)
      const positionsData = response.data?.data || response.data || []

      const goldAsset = positionsData.find((p: any) => {
        const assetType = p.asset?.type || p.type
        return assetType === 'gold' && (!p.quantity || p.quantity === 0)
      })

	      if (goldAsset) {
        // 获取金价
        const goldPriceResponse = await axios.get('/api/v1/prices/gold')
        const goldPrice = goldPriceResponse.data?.price || goldPriceResponse.data?.data?.price || 650

        const marketValue = goldAsset.marketValue || 0
        const estimatedWeight = marketValue / goldPrice

        setGoldWeightData({
          positionId: goldAsset.id,
          marketValue,
          goldPrice,
          estimatedWeight,
        })
        setGoldWeightModalVisible(true)
	      } else {
	        if (operation && SUCCESS_OPERATION_STATUSES.has(operation.status)) {
            const hasPartialFailures = (refreshResult.failed || 0) > 0 || operation.status === 'partial'
	          message[hasPartialFailures ? 'warning' : 'success']({
	            content: (refreshResult.failed || 0) > 0
                ? `价格刷新完成：外部成功 ${externalRefreshed}，未刷新 ${refreshResult.failed || 0}，保留旧价 ${retainedLocalPrices}${jumpSummary}。${failureSummary}`
                : `价格刷新完成：外部成功 ${externalRefreshed}，未刷新 0${jumpSummary}`,
	            key: 'asset-price-refresh',
              duration: hasPartialFailures ? 6 : 3,
	          })
            if (hasPartialFailures) {
              setRefreshFailureVisible(true)
            }
	        } else if (operation?.status === 'failed') {
          message.error({
            content: operation?.error?.message || '价格刷新失败',
            key: 'asset-price-refresh',
          })
        } else {
          message.warning({
            content: '价格刷新仍在后台执行，可稍后重试查看结果',
            key: 'asset-price-refresh',
          })
        }
      }

      fetchPositions()
    } catch (error) {
      console.error('Refresh failed:', error)
      message.error('刷新失败')
    } finally {
      setLoading(false)
    }
  }

  // 确认黄金克重
  const handleGoldWeightConfirm = async (weight: number) => {
    if (!goldWeightData) return
    try {
      await axios.patch(`/api/v1/positions/${goldWeightData.positionId}`, {
        quantity: weight,
      })
      message.success('克重设置成功')
      setGoldWeightModalVisible(false)
      fetchPositions()
    } catch (error) {
      console.error('Failed to update gold weight:', error)
      message.error('克重设置失败')
    }
  }

  // 清空数据库
  const handleClearDatabase = async () => {
    if (clearConfirmText !== 'Delete') {
      message.error('输入错误，请输入 Delete 确认')
      return
    }
    try {
      await axios.delete(`/api/v1/positions?userId=${USER_ID}`)
      message.success('数据库已清空')
      setClearModalVisible(false)
      setClearConfirmText('')
      fetchPositions()
    } catch (error) {
      console.error('Clear failed:', error)
      message.error('清空失败')
    }
  }

  // 判断资产是否新增（3天内）
  const isNewAsset = (record: Asset): boolean => {
    if (!record.createdAt) return false
    const createdDate = new Date(record.createdAt)
    const now = new Date()
    const diffDays = (now.getTime() - createdDate.getTime()) / (1000 * 60 * 60 * 24)
    return diffDays <= 3
  }

  // 资产列表列定义
  const assetColumns: ColumnsType<Asset> = [
    {
      title: '代码',
      dataIndex: ['asset', 'symbol'],
      key: 'symbol',
      width: 80,
      render: (v: string, record: Asset) => (
        <a onClick={() => handleAssetClick(record)}>{v}</a>
      ),
    },
    {
      title: '名称',
      dataIndex: ['asset', 'name'],
      key: 'name',
      width: 100,
      render: (v: string, record: Asset) => (
        <div className="flex items-center gap-2">
          <span>{v}</span>
          {isNewAsset(record) && (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-700">
              NEW
            </span>
          )}
        </div>
      ),
    },
    { title: '类型', dataIndex: ['asset', 'type'], key: 'type', width: 60 },
    {
      title: '现价',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      width: 80,
      render: (v: number) => v ? v.toFixed(3) : '--',
    },
    {
      title: '价格时间',
      dataIndex: ['asset', 'lastUpdated'],
      key: 'lastUpdated',
      width: 130,
      render: (v?: string) => v ? new Date(v).toLocaleString() : '--',
    },
    {
      title: '来源',
      dataIndex: ['asset', 'lastPriceSource'],
      key: 'lastPriceSource',
      width: 110,
      render: (v?: string | null) => v ? <Tag color="#38bdf8">{v}</Tag> : <span className="text-gray-400">--</span>,
    },
    {
      title: '持股数',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 100,
      render: (v: number, record: Asset) => {
        const isGold = record.asset?.type === 'gold'
        return (
          <EditableCell
            value={v || 0}
            record={record}
            field="quantity"
            isGold={isGold}
            currentPrice={record.currentPrice}
            costBasis={record.costBasis}
            onUpdate={fetchPositions}
          />
        )
      },
    },
    {
      title: '每股成本',
      dataIndex: 'avgCost',
      key: 'avgCost',
      width: 100,
      render: (v: number, record: Asset) => {
        const isStock = record.asset?.type === 'stock' || record.asset?.type === 'etf'
        if (!isStock) {
          return <span className="text-gray-300">--</span>
        }
        return (
          <EditableCell
            value={v || 0}
            record={record}
            field="avgCost"
            precision={3}
            suffix="元"
            onUpdate={fetchPositions}
          />
        )
      },
    },
    {
      title: '成本(万)',
      dataIndex: 'costBasis',
      key: 'costBasis',
      width: 80,
      render: (v: number) => v ? (v / 10000)?.toFixed(2) : '--',
    },
    {
      title: '市值(万)',
      dataIndex: 'marketValue',
      key: 'marketValue',
      width: 90,
      render: (v: number) => v ? (v / 10000)?.toFixed(2) : '--',
    },
    {
      title: '盈亏(万)',
      dataIndex: 'unrealizedPnl',
      key: 'unrealizedPnl',
      width: 120,
      render: (v: number, record: Asset) => (
        <span className={v >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
          {v >= 0 ? '+' : ''}{v ? (v / 10000)?.toFixed(2) : '0.00'} ({(record.unrealizedPnlPercent || 0) >= 0 ? '+' : ''}{(record.unrealizedPnlPercent || 0).toFixed(2)}%)
        </span>
      ),
    },
    {
      title: '收益率止盈/止损',
      key: 'riskLines',
      width: 110,
      render: (_: unknown, record: Asset) => (
        <div className="space-y-1 text-xs">
          <div className={record.takeProfit ? 'text-emerald-600' : 'text-slate-400'}>
            止盈 {record.takeProfit ? `${record.takeProfit.toFixed(2)}%` : '--'}
          </div>
          <div className={record.stopLoss ? 'text-rose-600' : 'text-slate-400'}>
            止损 {record.stopLoss ? `${record.stopLoss.toFixed(2)}%` : '--'}
          </div>
        </div>
      ),
    },
    {
      title: '标签',
      dataIndex: 'tags',
      key: 'tags',
      width: 150,
          render: (tags: string[] = [], record: Asset) => (
            <div className="flex flex-wrap gap-1 cursor-pointer" onClick={() => handleEditTags(record)}>
          {tags.length > 0 ? tags.map((tag) => renderCategorizedTag(tag)) : (
            <Button size="small" type="link">添加标签</Button>
          )}
        </div>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      render: (_: unknown, record: Asset) => (
        <div className="flex flex-wrap gap-2">
          <Button size="small" icon={<EditOutlined />} onClick={() => handleEditAsset(record)}>
            编辑
          </Button>
          <Button size="small" icon={<SwapOutlined />} onClick={() => handleTrade(record)}>
            记账
          </Button>
          <Popconfirm
            title="确认删除"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </div>
      ),
    },
  ]

  const tradingAssetType = tradingAsset?.asset?.type || tradingAsset?.type
  const isBoardLotTrade = isBoardLotAsset(tradingAssetType) && (tradeType === 'buy' || tradeType === 'sell')
  const estimatedTradeAmount = tradeQuantity * tradePrice
  const estimatedTradeAmountWithFee = tradeType === 'buy' || tradeType === 'fee'
    ? estimatedTradeAmount + tradeFee
    : estimatedTradeAmount - tradeFee

  // 交易记录列定义
  const transactionColumns: ColumnsType<Transaction> = [
    { title: '时间', dataIndex: 'executedAt', key: 'executedAt', width: 100 },
    { title: '代码', dataIndex: ['asset', 'symbol'], key: 'symbol', width: 80 },
    { title: '名称', dataIndex: ['asset', 'name'], key: 'name', width: 100 },
    {
      title: '类型',
      dataIndex: 'type',
      key: 'type',
      width: 60,
      render: (v: string) => (
        <span className={v === 'buy' ? 'text-emerald-600' : v === 'sell' ? 'text-rose-600' : ''}>
          {v === 'buy' ? '买入' : v === 'sell' ? '卖出' : v === 'dividend' ? '分红' : v === 'fee' ? '费用' : v === 'deposit' ? '存入' : v === 'withdraw' ? '取出' : v}
        </span>
      ),
    },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80 },
    {
      title: '价格',
      dataIndex: 'price',
      key: 'price',
      width: 80,
      render: (v?: number) => v != null ? v.toFixed(3) : '--',
    },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 100 },
    { title: '手续费', dataIndex: 'fee', key: 'fee', width: 80 },
  ]

  // 预览列定义
  const previewColumns: ColumnsType<ParsedRow> = [
    { title: '大类', dataIndex: 'category', key: 'category', width: 80 },
    { title: '名称', dataIndex: 'subCategory', key: 'subCategory', width: 120 },
    { title: '代码', dataIndex: 'symbol', key: 'symbol', width: 80 },
    { title: '持股数', dataIndex: 'userShares', key: 'userShares', width: 80 },
    { title: '成本(元)', dataIndex: 'userCostPerShare', key: 'userCostPerShare', width: 100 },
    { title: '市值(万)', dataIndex: 'userMarketValue', key: 'userMarketValue', width: 90 },
  ]

  const tabItems = [
    {
      key: 'list',
      label: '资产列表',
      children: (
        <div>
          {assetTypes.length > 1 && (
            <div className="mb-4">
              <Segmented
                options={typeOptions}
                value={typeFilter}
                onChange={(v) => setTypeFilter(v as string)}
              />
            </div>
          )}
          <Table
            columns={assetColumns}
            dataSource={filteredPositions}
            rowKey="id"
            loading={loading}
            pagination={false}
            size="small"
            scroll={{ x: 900 }}
            rowClassName={(record: Asset) => isNewAsset(record) ? 'new-asset-row' : ''}
            onRow={(record) => ({
              onDoubleClick: () => handleEditAsset(record),
            })}
          />
        </div>
      ),
    },
    {
      key: 'transactions',
      label: `交易记录 (${transactions.length})`,
      children: (
        <Table
          columns={transactionColumns}
          dataSource={transactions}
          rowKey="id"
          pagination={false}
          size="small"
          scroll={{ x: 700 }}
        />
      ),
    },
    {
      key: 'import',
      label: '导入',
      children: (
        <div className="p-4 text-center">
          <Upload beforeUpload={handleParseExcel} showUploadList={false}>
            <Button type="primary" icon={<UploadOutlined />} size="large">
              选择Excel文件导入
            </Button>
          </Upload>
          <p className="fams-muted mt-4 text-sm">
            支持格式：大类、属性、小类(名称)、代码、持股数、成本(元/股)、市值(万)
          </p>
        </div>
      ),
    },
  ]

  return (
    <div className="fams-page space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="fams-eyebrow">本地资产台账</div>
          <h1 className="fams-page-title mb-0">资产管理</h1>
          <p className="fams-muted mb-0 mt-2 max-w-3xl">
            用 Excel 导入维护本地持仓，系统会保留解析预览和人工确认步骤；导出文件仅用于离线核对，不构成交易建议。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
            下载模板
          </Button>
          <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleParseExcel}>
            <Button type="primary" icon={<UploadOutlined />}>导入 Excel</Button>
          </Upload>
          <Button icon={<FileExcelOutlined />} onClick={handleExportAssets} loading={exporting}>
            导出资产
          </Button>
        </div>
      </div>

      <InvestmentWorkflowBar currentStep="basic_information_confirmation" userId={USER_ID} />

      {priceFreshness ? (
        <Alert
          showIcon
          type={priceFreshness.status === 'fresh' ? 'success' : priceFreshness.status === 'refreshing' ? 'info' : 'warning'}
          message={priceFreshness.status === 'fresh'
            ? '当前估值处于 12 小时新鲜度范围内'
            : priceFreshness.status === 'refreshing'
              ? '正在后台更新陈旧估值'
              : '当前显示的是最近一次可用估值'}
          description={(
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>估值截止：{priceFreshness.valuationAsOf ? new Date(priceFreshness.valuationAsOf).toLocaleString() : '缺少行情时间'}</span>
              {priceFreshness.staleSymbols.length > 0 ? <span>陈旧标的：{priceFreshness.staleSymbols.join('、')}</span> : null}
              {priceFreshness.missingSymbols.length > 0 ? <span>缺价标的：{priceFreshness.missingSymbols.join('、')}</span> : null}
              <span>系统仅在缺价或超过 {priceFreshness.thresholdHours} 小时时自动刷新。</span>
            </div>
          )}
        />
      ) : null}

      <Card className="fams-card" data-testid="asset-screenshot-primary-entry">
        <div className="grid gap-5 xl:grid-cols-[minmax(240px,0.7fr)_minmax(0,1.3fr)]">
          <div>
            <div className="fams-eyebrow">基本信息确认</div>
            <h2 className="mb-0 mt-1 text-xl font-semibold text-slate-950">从账户截图刷新资产事实</h2>
            <p className="fams-muted mb-4 mt-2 text-sm leading-6">
              同花顺用于行业轮动、波动个股与红利低波资产；支付宝用于投资组合资产。系统先识别并展示逐行差异，只有你确认的行才会写入台账。
            </p>
            <Segmented
              block
              aria-label="选择资产截图账户"
              value={captureAccountSource}
              onChange={(value) => setCaptureAccountSource(value as 'tonghuashun' | 'alipay')}
              options={[
                { label: '同花顺资产', value: 'tonghuashun' },
                { label: '支付宝资产', value: 'alipay' },
              ]}
            />
            <Alert
              className="mt-3"
              type="info"
              showIcon
              message="上传和识别不等于交易"
              description="本入口只更新本地资产、成交与外部委托观察；不会创建、修改或提交券商订单。"
            />
          </div>
          <ScreenshotCapturePanel
            key={captureAccountSource}
            userId={USER_ID}
            defaultAccountSource={captureAccountSource}
            lockAccountSource
            tradePositionEffectPolicy="included_in_latest_snapshot"
            onConfirmed={() => {
              void fetchPositions(false)
              void fetchTransactions()
            }}
          />
        </div>
      </Card>

      <Card className="fams-card">
        <PositionStrategyAssignmentPanel userId={USER_ID} />
      </Card>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card className="fams-stat-card fams-pressable card-sm">
            <div className="fams-stat-icon text-blue-600"><WalletOutlined /></div>
            <Statistic
              title={<span className="fams-muted">总市值</span>}
              value={(stats.totalValue / 10000).toFixed(2)}
              suffix="万"
              valueStyle={{ color: '#2563eb', fontSize: '24px' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="fams-stat-card fams-pressable card-sm">
            <div className="fams-stat-icon text-amber-600"><FundOutlined /></div>
            <Statistic
              title={<span className="fams-muted">总成本</span>}
              value={(stats.totalCost / 10000).toFixed(2)}
              suffix="万"
              valueStyle={{ color: '#b45309', fontSize: '24px' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="fams-stat-card fams-pressable card-sm">
            <div className="fams-stat-icon text-emerald-600"><RiseOutlined /></div>
            <Statistic
              title={<span className="fams-muted">盈亏</span>}
              value={(stats.totalPnl / 10000).toFixed(2)}
              suffix="万"
              valueStyle={{ color: stats.totalPnl >= 0 ? SUCCESS_COLOR : DANGER_COLOR, fontSize: '24px' }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card className="fams-stat-card fams-pressable card-sm">
            <div className="fams-stat-icon text-cyan-600"><PercentageOutlined /></div>
            <Statistic
              title={<span className="fams-muted">收益率</span>}
              value={stats.totalPnlPercent.toFixed(2)}
              suffix="%"
              valueStyle={{ color: stats.totalPnlPercent >= 0 ? SUCCESS_COLOR : DANGER_COLOR, fontSize: '24px' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 主内容 */}
      <Card className="fams-card card-md">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <div className="text-base font-semibold text-slate-950">持仓台账</div>
            <div className="fams-muted mt-1 text-sm">导入前会先展示解析预览，导出会包含当前持仓、交易流水和字段说明。</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Upload
              accept=".xlsx,.xls"
              showUploadList={false}
              beforeUpload={handleParseExcel}
            >
              <Button icon={<UploadOutlined />}>导入资产</Button>
            </Upload>
            <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>
              下载模板
            </Button>
            <Button icon={<FileExcelOutlined />} onClick={handleExportAssets} loading={exporting}>
              导出资产
            </Button>
            <Button danger icon={<DeleteOutlined />} onClick={() => setClearModalVisible(true)}>
              清空数据库
            </Button>
            <Button icon={<ReloadOutlined />} onClick={handleRefreshPrices} loading={loading}>
            刷新价格
          </Button>
          </div>
        </div>

        {positions.length === 0 && (
          <div className="fams-empty-state mb-4">
            <InboxOutlined className="text-3xl text-blue-600" />
            <div>
              <div className="font-semibold text-slate-950">还没有本地资产数据</div>
              <div className="fams-muted mt-1 text-sm">先下载模板填写持仓，再导入 Excel。系统会在导入前给出预览，避免误写入。</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button icon={<DownloadOutlined />} onClick={handleDownloadTemplate}>下载模板</Button>
              <Upload accept=".xlsx,.xls" showUploadList={false} beforeUpload={handleParseExcel}>
                <Button type="primary" icon={<UploadOutlined />}>导入 Excel</Button>
              </Upload>
            </div>
          </div>
        )}

        <Tabs items={tabItems} />
      </Card>

      {/* 导入预览Modal */}
      <Modal
        title="导入预览"
        open={importModalVisible}
        onCancel={() => {
          setImportModalVisible(false)
          setSelectedFile(null)
          setParsedPreview([])
        }}
        onOk={handleImport}
        okText="确认导入"
        confirmLoading={importing}
        width={700}
      >
        <Table
          columns={previewColumns}
          dataSource={parsedPreview}
          rowKey={(_, i) => String(i)}
          pagination={false}
          size="small"
          scroll={{ x: 600 }}
        />
      </Modal>

      {/* 记账Modal - 简化版。它只记录本地流水，不创建外部订单。 */}
      <Modal
        title={`快捷记账 - ${tradingAsset?.asset?.name || tradingAsset?.name || ''}`}
        open={tradeModalVisible}
        onCancel={() => setTradeModalVisible(false)}
        onOk={handleTradeConfirm}
        okText="确认并记账"
        confirmLoading={tradeSaving}
        width={380}
        destroyOnHidden
      >
        <div className="py-2">
          <div className="text-center mb-4">
            <div className="fams-muted text-sm">当前市价</div>
            <div className="text-2xl font-bold text-slate-950">
              ¥{tradingAsset?.currentPrice?.toFixed(3) || '--'}
            </div>
          </div>

          <Form form={tradeForm} layout="vertical" className="mt-4">
            <Form.Item name="type" label="交易方向" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: '买入 🟢', value: 'buy' },
                  { label: '卖出 🔴', value: 'sell' },
                  { label: '分红', value: 'dividend' },
                  { label: '费用', value: 'fee' },
                ]}
              />
            </Form.Item>

            <Form.Item
              name="quantity"
              label={isBoardLotTrade ? '数量（股，100股整数倍）' : '数量'}
              rules={[
                { required: true },
                {
                  validator: (_, value) => {
                    if (!value) return Promise.resolve()
                    if (isBoardLotTrade && value % 100 !== 0) {
                      return Promise.reject(new Error('股票交易数量必须是100股的整数倍'))
                    }
                    return Promise.resolve()
                  },
                },
              ]}
            >
              <InputNumber
                style={{ width: '100%' }}
                min={isBoardLotTrade ? 100 : 0}
                step={isBoardLotTrade ? 100 : 1}
                precision={isBoardLotTrade ? 0 : 4}
                placeholder="输入交易数量"
              />
            </Form.Item>

            {/* 快捷金额选择 */}
            <div className="mb-4">
              <div className="fams-muted mb-2 text-xs">快捷选择（按持仓比例）</div>
              <div className="flex gap-2">
                {[25, 50, 75, 100].map((pct) => (
                  <Button
                    key={pct}
                    size="small"
                    variant="outlined"
                    className="flex-1"
                    onClick={() => {
                      if (tradingAsset?.marketValue && tradingAsset.currentPrice) {
                        const totalValue = tradingAsset.marketValue
                        const rawQuantity = Math.floor((totalValue * pct / 100) / tradingAsset.currentPrice)
                        const quantity = isBoardLotTrade ? roundToBoardLot(rawQuantity) : rawQuantity
                        tradeForm.setFieldValue('quantity', quantity)
                      }
                    }}
                  >
                    {pct}%
                  </Button>
                ))}
              </div>
            </div>

            <Form.Item name="price" label="价格(元)" rules={[{ required: true }]}>
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                precision={3}
                placeholder="输入价格"
              />
            </Form.Item>

            <Form.Item name="fee" label="手续费(元)">
              <InputNumber
                style={{ width: '100%' }}
                min={0}
                precision={2}
                placeholder="输入手续费"
              />
            </Form.Item>

            {/* 预估金额 */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 mt-2">
              <div className="flex justify-between text-sm">
                <span className="fams-muted">预估金额</span>
                <span className="font-medium text-slate-950">
                  ¥{estimatedTradeAmount > 0
                    ? estimatedTradeAmount.toFixed(2)
                    : '--'}
                </span>
              </div>
              {tradeFee > 0 && (
                <div className="flex justify-between text-xs mt-2">
                  <span className="fams-muted">含手续费</span>
                  <span className="fams-muted">¥{estimatedTradeAmountWithFee.toFixed(2)}</span>
                </div>
              )}
              {isBoardLotTrade && (
                <div className="fams-muted mt-2 text-xs">
                  股票交易按100股为一手，数量必须为100股整数倍。
                </div>
              )}
            </div>
          </Form>
        </div>
      </Modal>

      {/* 导入成功Modal */}
      <Modal
        title="导入成功"
        open={importSuccessVisible}
        onCancel={() => setImportSuccessVisible(false)}
        footer={[
          <Button key="back" onClick={() => {
            setImportSuccessVisible(false)
            navigate('/positions')
          }}>
            去查看仓位
          </Button>,
          <Button key="continue" type="primary" onClick={() => setImportSuccessVisible(false)}>
            继续添加
          </Button>,
        ]}
        width={600}
      >
        {importSuccessData && (
          <div className="py-4">
            <div className="text-center mb-6">
              <div className="mb-2 text-3xl font-bold text-emerald-600">
                导入成功 {importSuccessData.successCount} 项
              </div>
              <div className="fams-muted">
                总资产: <span className="font-medium text-slate-950">{importSuccessData.totalValue.toFixed(2)}</span> 万元
              </div>
            </div>

            {importSuccessData.marketDistribution.length > 0 && (
              <div className="mt-6">
                <div className="fams-muted mb-4 text-center">市值分布</div>
                <AllocationPieChart
                  data={importSuccessData.marketDistribution}
                  type="donut"
                  showLegend={true}
                  showLabel={true}
                  showPercent={true}
                  height={280}
                  radius="35% 65%"
                />
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 清空数据库确认 */}
      <Modal
        title={<span className="text-red-500">危险操作：清空数据库</span>}
        open={clearModalVisible}
        onCancel={() => {
          setClearModalVisible(false)
          setClearConfirmText('')
        }}
        onOk={handleClearDatabase}
        okText="确认清空"
        okButtonProps={{ danger: true, disabled: clearConfirmText !== 'Delete' }}
      >
        <div className="space-y-4">
          <div className="text-red-500 font-medium">
            此操作将删除所有资产数据和交易记录，且无法恢复！
          </div>
          <div>
            请在下方输入 <strong>Delete</strong> 确认：
          </div>
          <Input
            placeholder="请输入 Delete"
            value={clearConfirmText}
            onChange={(e) => setClearConfirmText(e.target.value)}
            className="border-red-500"
          />
        </div>
      </Modal>

      <Modal
        title={<span className="text-slate-950">编辑标签 - {tagEditingAsset?.asset?.name || tagEditingAsset?.name}</span>}
        open={tagModalVisible}
        onCancel={() => setTagModalVisible(false)}
        onOk={handleSaveTags}
        okText="保存"
        cancelText="取消"
      >
        <div className="space-y-3">
          <div className="fams-muted text-sm">
            可用不同色块区分市场、行业、资产类型和策略标签。
          </div>
          <TagSelector
            value={tagDraft}
            onChange={setTagDraft}
            placeholder="选择或新建标签"
            maxTags={8}
          />
          <div className="flex flex-wrap gap-1">
            {tagDraft.map((tag) => (
              renderCategorizedTag(tag)
            ))}
          </div>
        </div>
      </Modal>

      {/* 股票详情弹窗 */}
      <Suspense fallback={<LazyModalFallback />}>
        <StockDetailModal
          visible={stockDetailVisible}
          stockCode={stockDetailCode}
          stockName={stockDetailName}
          onClose={() => setStockDetailVisible(false)}
        />
      </Suspense>

      {/* 基金详情弹窗 */}
      <Suspense fallback={<LazyModalFallback />}>
        <FundDetailModal
          visible={fundDetailVisible}
          fundCode={fundDetailCode}
          fundName={fundDetailName}
          onClose={() => setFundDetailVisible(false)}
        />
      </Suspense>

      {/* 黄金克重确认弹窗 */}
      {goldWeightData && (
        <Suspense fallback={<LazyModalFallback />}>
          <GoldWeightConfirmModal
            visible={goldWeightModalVisible}
            marketValue={goldWeightData.marketValue}
            goldPrice={goldWeightData.goldPrice}
            estimatedWeight={goldWeightData.estimatedWeight}
            onConfirm={handleGoldWeightConfirm}
            onCancel={() => setGoldWeightModalVisible(false)}
          />
        </Suspense>
      )}

      {/* 编辑资产弹窗 */}
      <EditAssetModal
        visible={editAssetVisible}
        asset={editingAsset}
        onClose={() => setEditAssetVisible(false)}
        onSuccess={fetchPositions}
      />

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

export default Assets
