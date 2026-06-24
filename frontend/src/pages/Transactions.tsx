import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Form, Input, InputNumber, Modal, Select, Table, Tag, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import axios from 'axios'

const USER_ID = 'default'
const isBoardLotAsset = (type?: string) => type === 'stock' || type === 'etf'

interface PositionOption {
  id: string
  asset: {
    id: string
    symbol: string
    name: string
    type: string
  }
  currentPrice?: number
}

interface Transaction {
  id: string
  asset?: {
    symbol: string
    name: string
    type: string
  }
  type: 'buy' | 'sell' | 'dividend' | 'fee' | 'deposit' | 'withdraw'
  quantity: number
  price: number
  amount: number
  fee: number
  status: string
  notes?: string
  executedAt: string
}

const typeLabels: Record<Transaction['type'], string> = {
  buy: '买入',
  sell: '卖出',
  dividend: '分红',
  fee: '费用',
  deposit: '存入',
  withdraw: '取出',
}

const typeColors: Record<Transaction['type'], string> = {
  buy: 'green',
  sell: 'red',
  dividend: 'blue',
  fee: 'orange',
  deposit: 'cyan',
  withdraw: 'purple',
}

const formatCurrency = (value: number) => `¥${value.toFixed(3)}`

const Transactions: React.FC = () => {
  const [form] = Form.useForm()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [positions, setPositions] = useState<PositionOption[]>([])
  const selectedAssetId = Form.useWatch('assetId', form)
  const selectedType = Form.useWatch('type', form)
  const quantity = Form.useWatch('quantity', form) || 0
  const price = Form.useWatch('price', form) || 0
  const fee = Form.useWatch('fee', form) || 0

  const fetchTransactions = useCallback(async () => {
    setLoading(true)
    try {
      const response = await axios.get(`/api/v1/transactions?userId=${USER_ID}&limit=100`)
      setTransactions(response.data?.data || [])
    } catch (error) {
      console.error('Failed to fetch transactions:', error)
      message.error('获取交易记录失败')
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchPositions = useCallback(async () => {
    try {
      const response = await axios.get(`/api/v1/positions?userId=${USER_ID}&limit=200`)
      setPositions(response.data?.data || [])
    } catch (error) {
      console.error('Failed to fetch positions:', error)
      message.error('获取资产列表失败')
    }
  }, [])

  useEffect(() => {
    fetchTransactions()
    fetchPositions()
  }, [fetchTransactions, fetchPositions])

  const assetOptions = useMemo(() => positions.map((position) => ({
    label: `${position.asset.symbol} ${position.asset.name}`,
    value: position.asset.id,
    price: position.currentPrice || 0,
    type: position.asset.type,
  })), [positions])

  const selectedAsset = assetOptions.find((option) => option.value === selectedAssetId)
  const isBoardLotTrade = isBoardLotAsset(selectedAsset?.type) && (selectedType === 'buy' || selectedType === 'sell')
  const estimatedAmount = quantity * price
  const estimatedAmountWithFee = selectedType === 'buy' || selectedType === 'fee'
    ? estimatedAmount + fee
    : estimatedAmount - fee

  const handleAssetChange = (assetId: string) => {
    const selected = assetOptions.find((option) => option.value === assetId)
    if (selected) {
      form.setFieldValue('price', selected.price)
    }
  }

  const submitTransaction = async (values: any) => {
    try {
      setSaving(true)

      const response = await axios.post('/api/v1/transactions', {
        userId: USER_ID,
        assetId: values.assetId,
        type: values.type,
        quantity: values.quantity,
        price: values.price,
        fee: values.fee || 0,
        notes: values.notes,
        executedAt: new Date().toISOString(),
      })
      const alertedSymbols = response.data?.riskCheck?.alertedSymbols || []

      message.success(alertedSymbols.length > 0 ? `交易已保存，触发 ${alertedSymbols.length} 个风险告警` : '交易已保存')
      setModalOpen(false)
      form.resetFields()
      fetchTransactions()
      fetchPositions()
    } catch (error) {
      console.error('Failed to create transaction:', error)
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '保存交易失败'
      message.error(errorMessage)
    } finally {
      setSaving(false)
    }
  }

  const handleCreate = async () => {
    const values = await form.validateFields()

    const asset = assetOptions.find((option) => option.value === values.assetId)
    if (
      isBoardLotAsset(asset?.type) &&
      (values.type === 'buy' || values.type === 'sell') &&
      values.quantity % 100 !== 0
    ) {
      message.error('股票交易数量必须是100股的整数倍')
      return
    }

    const amount = values.quantity * values.price
    const feeValue = values.fee || 0
    const total = values.type === 'buy' || values.type === 'fee' ? amount + feeValue : amount - feeValue

    Modal.confirm({
      title: '确认记账',
      okText: '确认并记账',
      cancelText: '返回修改',
      content: (
        <div className="space-y-2 pt-2">
          <div className="flex justify-between"><span>资产</span><strong>{asset?.label || values.assetId}</strong></div>
          <div className="flex justify-between"><span>方向</span><strong>{typeLabels[values.type as Transaction['type']] || values.type}</strong></div>
          <div className="flex justify-between"><span>数量</span><strong>{values.quantity}</strong></div>
          <div className="flex justify-between"><span>价格</span><strong>{formatCurrency(values.price)}</strong></div>
          <div className="flex justify-between"><span>手续费</span><strong>{formatCurrency(feeValue)}</strong></div>
          <div className="flex justify-between border-t border-gray-200 pt-2"><span>入账金额</span><strong>{formatCurrency(total)}</strong></div>
        </div>
      ),
      onOk: () => submitTransaction(values),
    })
  }

  const columns: ColumnsType<Transaction> = [
    {
      title: '时间',
      dataIndex: 'executedAt',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    { title: '代码', dataIndex: ['asset', 'symbol'], width: 100 },
    { title: '名称', dataIndex: ['asset', 'name'], width: 140 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 90,
      render: (type: Transaction['type']) => <Tag color={typeColors[type]}>{typeLabels[type] || type}</Tag>,
    },
    { title: '数量', dataIndex: 'quantity', width: 100 },
    { title: '价格', dataIndex: 'price', width: 100, render: (value: number) => value.toFixed(3) },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 120,
      render: (value: number) => (
        <span className={value >= 0 ? 'text-[success]' : 'text-[danger]'}>
          {value.toFixed(2)}
        </span>
      ),
    },
    { title: '手续费', dataIndex: 'fee', width: 100, render: (value: number) => value.toFixed(2) },
    { title: '备注', dataIndex: 'notes' },
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white mb-6">交易记录</h1>
      <Card className="bg-[#1a1a2e] border-[surface-border]">
        <div className="flex justify-between mb-4">
          <Button type="primary" onClick={() => setModalOpen(true)}>添加交易</Button>
          <Button onClick={fetchTransactions}>刷新</Button>
        </div>
        <Table
          columns={columns}
          dataSource={transactions}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={{ x: 1000 }}
        />
      </Card>

      <Modal
        title="添加交易"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleCreate}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ type: 'buy', fee: 0 }}>
          <Form.Item name="assetId" label="资产" rules={[{ required: true, message: '请选择资产' }]}>
            <Select
              showSearch
              options={assetOptions}
              optionFilterProp="label"
              onChange={handleAssetChange}
            />
          </Form.Item>
          <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select
              options={[
                { label: '买入', value: 'buy' },
                { label: '卖出', value: 'sell' },
                { label: '分红', value: 'dividend' },
                { label: '费用', value: 'fee' },
                { label: '存入', value: 'deposit' },
                { label: '取出', value: 'withdraw' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="quantity"
            label={isBoardLotTrade ? '数量（股，100股整数倍）' : '数量'}
            rules={[
              { required: true, message: '请输入数量' },
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
            />
          </Form.Item>
          <Form.Item name="price" label="价格" rules={[{ required: true, message: '请输入价格' }]}>
            <InputNumber style={{ width: '100%' }} min={0} precision={3} />
          </Form.Item>
          <Form.Item name="fee" label="手续费">
            <InputNumber style={{ width: '100%' }} min={0} precision={2} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} />
          </Form.Item>
          <div className="bg-[#0f0f23] rounded p-3">
            <div className="flex justify-between text-sm">
              <span className="text-gray-300">预估金额</span>
              <span className="text-white font-medium">
                ¥{estimatedAmount > 0 ? estimatedAmount.toFixed(2) : '--'}
              </span>
            </div>
            {fee > 0 && (
              <div className="flex justify-between text-xs mt-2">
                <span className="text-gray-300">含手续费</span>
                <span className="text-gray-300">¥{estimatedAmountWithFee.toFixed(2)}</span>
              </div>
            )}
            {isBoardLotTrade && (
              <div className="text-xs text-gray-300 mt-2">
                股票交易按100股为一手，数量必须为100股整数倍。
              </div>
            )}
          </div>
        </Form>
      </Modal>
    </div>
  )
}

export default Transactions
