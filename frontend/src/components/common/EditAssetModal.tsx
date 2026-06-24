import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Form, InputNumber, Input, message, Spin, Tag } from 'antd'
import axios from 'axios'

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
  stopLoss?: number | null
  takeProfit?: number | null
  asset?: {
    symbol: string
    name: string
    type: string
  }
}

interface EditAssetModalProps {
  visible: boolean
  asset: Asset | null
  onClose: () => void
  onSuccess: () => void
}

const typeNames: Record<string, string> = {
  stock: '股票',
  etf: 'ETF',
  fund: '基金',
  bond: '债基',
  gold: '黄金',
  cash: '现金',
}

const quantityLabels: Record<string, string> = {
  stock: '持股数',
  etf: '持有份额',
  fund: '持有份额',
  bond: '持有份额',
  gold: '克重(克)',
}

const priceLabels: Record<string, string> = {
  stock: '现价',
  etf: '现价',
  fund: '最新净值',
  bond: '最新净值',
  gold: '当前金价',
}

const getReturnPercent = (marketValue = 0, costBasis = 0) => (
  costBasis > 0 ? ((marketValue - costBasis) / costBasis) * 100 : 0
)

const EditAssetModal: React.FC<EditAssetModalProps> = ({
  visible,
  asset,
  onClose,
  onSuccess,
}) => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [priceLoading, setPriceLoading] = useState(false)
  const [queriedPrice, setQueriedPrice] = useState<number | null>(null)
  const [priceSource, setPriceSource] = useState<string | null>(null)

  const assetType = asset?.asset?.type || asset?.type || ''
  const symbol = asset?.asset?.symbol || asset?.symbol || ''
  const isCash = assetType === 'cash'
  const shouldDeriveQuantity = assetType === 'fund' || assetType === 'bond' || assetType === 'gold'
  const currentPrice = asset?.currentPrice || 0
  const effectivePrice = queriedPrice || currentPrice || 0
  const watchedQuantity = Form.useWatch('quantity', form) || 0
  const watchedReturnPercent = Form.useWatch('returnPercent', form)
  const watchedMarketValue = Form.useWatch('marketValue', form) || 0

  useEffect(() => {
    if (!visible || !asset) return

    const marketValue = asset.marketValue || 0
    const costBasis = asset.costBasis || 0
    setQueriedPrice(null)
    setPriceSource(null)
    form.setFieldsValue({
      quantity: isCash ? undefined : asset.quantity || 0,
      marketValue: isCash ? marketValue || costBasis || asset.quantity || 0 : marketValue,
      returnPercent: isCash ? undefined : Number(getReturnPercent(marketValue, costBasis).toFixed(4)),
      stopLoss: isCash ? undefined : asset.stopLoss ?? undefined,
      takeProfit: isCash ? undefined : asset.takeProfit ?? undefined,
      source: undefined,
    })
  }, [visible, asset, form, isCash])

  useEffect(() => {
    if (!visible || !asset || isCash || !symbol) return

    let cancelled = false
    setPriceLoading(true)
    axios.get('/api/v1/prices/realtime', {
      params: {
        symbol,
        assetType,
      },
    })
      .then((res) => {
        if (cancelled) return
        const price = res.data?.price
        if (typeof price === 'number' && price > 0 && !res.data?.fallbackUsed) {
          setQueriedPrice(price)
          setPriceSource(res.data?.source || null)
        } else if (currentPrice > 0) {
          setQueriedPrice(currentPrice)
          setPriceSource('current_position_price')
        } else {
          setQueriedPrice(null)
          setPriceSource(null)
        }
      })
      .catch(() => {
        if (cancelled) return
        setQueriedPrice(currentPrice > 0 ? currentPrice : null)
        setPriceSource(currentPrice > 0 ? 'current_position_price' : null)
      })
      .finally(() => {
        if (!cancelled) setPriceLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [visible, asset, isCash, symbol, assetType, currentPrice])

  const calculatedValues = useMemo(() => {
    if (isCash) {
      return {
        marketValue: watchedMarketValue,
        costBasis: watchedMarketValue,
        avgCost: 1,
        unrealizedPnl: 0,
        returnPercent: 0,
      }
    }

    const marketValue = watchedMarketValue
    const quantity = shouldDeriveQuantity && effectivePrice > 0
      ? marketValue / effectivePrice
      : watchedQuantity
    const returnPercent = Number(watchedReturnPercent || 0)
    const denominator = 1 + returnPercent / 100
    const costBasis = marketValue > 0 && denominator > 0 ? marketValue / denominator : 0
    const avgCost = quantity > 0 ? costBasis / quantity : 0
    const unrealizedPnl = marketValue - costBasis

    return {
      quantity,
      marketValue,
      costBasis,
      avgCost,
      unrealizedPnl,
      returnPercent,
    }
  }, [isCash, shouldDeriveQuantity, watchedMarketValue, watchedQuantity, effectivePrice, watchedReturnPercent])

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const updateData: any = {}

      if (isCash) {
        updateData.quantity = values.marketValue
        updateData.avgCost = 1
        updateData.currentPrice = 1
        updateData.marketValue = values.marketValue
        updateData.costBasis = values.marketValue
        updateData.unrealizedPnl = 0
      } else {
        if (!effectivePrice || effectivePrice <= 0) {
          message.error('未获取到有效现价/净值，不能保存')
          return
        }
        if (values.returnPercent <= -100) {
          message.error('收益率不能小于或等于 -100%')
          return
        }

        updateData.quantity = Number(calculatedValues.quantity.toFixed(4))
        updateData.currentPrice = effectivePrice
        updateData.marketValue = Number(calculatedValues.marketValue.toFixed(2))
        updateData.costBasis = Number(calculatedValues.costBasis.toFixed(2))
        updateData.avgCost = Number(calculatedValues.avgCost.toFixed(6))
        updateData.unrealizedPnl = Number(calculatedValues.unrealizedPnl.toFixed(2))
        updateData.stopLoss = values.stopLoss ?? null
        updateData.takeProfit = values.takeProfit ?? null
      }

      setLoading(true)
      await axios.put(`/api/v1/positions/${asset?.id}`, updateData)
      if (!isCash) {
        try {
          const alertResponse = await axios.post('/api/v1/alerts/risk-check', {
            userId: 'default',
            refreshPrices: false,
          })
          const symbols = Array.isArray(alertResponse.data) ? alertResponse.data : []
          if (symbols.length > 0) {
            message.warning(`已触发 ${symbols.length} 个止盈/止损或风险提醒，请到风险告警查看`)
          }
        } catch {
          message.warning('持仓已保存，但自动告警检查失败，请稍后在风险告警页手动检查')
        }
      }
      onSuccess()
      onClose()
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '更新失败，请重试'
      message.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const renderCalculatedSummary = () => (
    <div className="bg-[#0f0f23] rounded p-3 space-y-2">
      {!isCash && (
        <div className="flex justify-between text-sm">
          <span className="text-gray-300">{priceLabels[assetType] || '现价'}</span>
          <span className="text-white">
            {priceLoading ? <Spin size="small" /> : effectivePrice > 0 ? `${effectivePrice.toFixed(3)} 元` : '--'}
            {priceSource ? <Tag color="#38bdf8" className="ml-2">{priceSource}</Tag> : null}
          </span>
        </div>
      )}
      {!isCash && shouldDeriveQuantity && (
        <div className="flex justify-between text-sm">
          <span className="text-gray-300">{quantityLabels[assetType] || '持仓数量'}</span>
          <span className="text-white">{calculatedValues.quantity.toFixed(4)}</span>
        </div>
      )}
      <div className="flex justify-between text-sm">
        <span className="text-gray-300">市值</span>
        <span className="text-white">{calculatedValues.marketValue.toFixed(2)} 元</span>
      </div>
      <div className="flex justify-between text-sm">
        <span className="text-gray-300">成本合计</span>
        <span className="text-white">{calculatedValues.costBasis.toFixed(2)} 元</span>
      </div>
      {!isCash && (
        <div className="flex justify-between text-sm">
          <span className="text-gray-300">{assetType === 'gold' ? '每克成本' : '每份成本'}</span>
          <span className="text-white">{calculatedValues.avgCost.toFixed(6)} 元</span>
        </div>
      )}
      <div className="flex justify-between text-sm">
        <span className="text-gray-300">盈亏</span>
        <span className={calculatedValues.unrealizedPnl >= 0 ? 'text-[success]' : 'text-[danger]'}>
          {calculatedValues.unrealizedPnl >= 0 ? '+' : ''}{calculatedValues.unrealizedPnl.toFixed(2)} 元
        </span>
      </div>
    </div>
  )

  const renderNonCashForm = () => (
    <>
      {!shouldDeriveQuantity && (
        <Form.Item
          name="quantity"
          label={quantityLabels[assetType] || '持仓数量'}
          rules={[{ required: true, message: '请输入持仓数量' }]}
        >
          <InputNumber
            style={{ width: '100%' }}
            min={0}
            precision={assetType === 'stock' ? 0 : 4}
            placeholder="请输入持仓数量/份额"
          />
        </Form.Item>
      )}

      <Form.Item
        name="marketValue"
        label="当前总市值(元)"
        rules={[{ required: true, message: '请输入当前总市值' }]}
      >
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          precision={2}
          placeholder="按基金 App / 券商 App 当前总金额录入"
        />
      </Form.Item>

      <Form.Item
        name="returnPercent"
        label="当前收益率(%，保存时自动反推成本)"
        rules={[{ required: true, message: '请输入当前收益率' }]}
      >
        <InputNumber
          style={{ width: '100%' }}
          precision={4}
          placeholder="例如 -2.27"
        />
      </Form.Item>

      <div className="grid grid-cols-2 gap-3">
        <Form.Item
          name="stopLoss"
          label="止损收益率(%)"
          tooltip="当前收益率小于或等于该阈值时触发风险告警，例如 -5 表示亏损 5%"
        >
          <InputNumber
            style={{ width: '100%' }}
            precision={2}
            placeholder="例如 -5"
          />
        </Form.Item>

        <Form.Item
          name="takeProfit"
          label="止盈收益率(%)"
          tooltip="当前收益率大于或等于该阈值时触发风险告警，例如 5 表示盈利 5%"
        >
          <InputNumber
            style={{ width: '100%' }}
            precision={2}
            placeholder="例如 5"
          />
        </Form.Item>
      </div>

      {renderCalculatedSummary()}
    </>
  )

  const renderCashForm = () => (
    <>
      <Form.Item
        name="marketValue"
        label="现金金额(元)"
        rules={[{ required: true, message: '请输入现金金额' }]}
      >
        <InputNumber
          style={{ width: '100%' }}
          min={0}
          precision={2}
          placeholder="请输入现金金额"
        />
      </Form.Item>

      <Form.Item name="source" label="来源">
        <Input placeholder="请输入现金来源(可选)" />
      </Form.Item>

      {renderCalculatedSummary()}
    </>
  )

  return (
    <Modal
      title={`编辑${typeNames[assetType] || '资产'} - ${asset?.name || asset?.asset?.name || ''}`}
      open={visible}
      onCancel={onClose}
      onOk={handleSubmit}
      okText="保存"
      okButtonProps={{ loading }}
      width={440}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" className="mt-4">
        {isCash ? renderCashForm() : renderNonCashForm()}
      </Form>
    </Modal>
  )
}

export default EditAssetModal
