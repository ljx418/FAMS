import React, { useState, useEffect } from 'react'
import { InputNumber } from 'antd'
import axios from 'axios'

interface EditableCellProps {
  value: number
  record: any
  field: string
  isGold?: boolean
  currentPrice?: number
  costBasis?: number
  goldPriceLoading?: boolean
  goldPriceError?: boolean
  precision?: number
  suffix?: string
  onUpdate: () => void
}

const EditableCell: React.FC<EditableCellProps> = ({
  value,
  record,
  field,
  isGold = false,
  currentPrice = 0,
  costBasis = 0,
  goldPriceError = false,
  precision = 0,
  suffix = '股',
  onUpdate,
}) => {
  const [inputValue, setInputValue] = useState(value || 0)

  useEffect(() => {
    setInputValue(value || 0)
  }, [value])

  const handleBlur = async () => {
    if (inputValue !== value) {
      const updateData: any = { [field]: inputValue }

      // 对于黄金：marketValue = 克重 * 金价
      if (isGold && field === 'quantity') {
        if (!currentPrice || goldPriceError) {
          console.error('金价不可用，无法计算市值')
          return
        }
        updateData.marketValue = inputValue * currentPrice
        updateData.unrealizedPnl = updateData.marketValue - (costBasis || 0)
      }

      // 对于股票/ETF：同时更新 costBasis（总成本 = 每股成本 × 持股数）
      if (field === 'avgCost' && record.quantity) {
        updateData.costBasis = inputValue * record.quantity
      }

      try {
        await axios.patch(`/api/v1/positions/${record.id}`, updateData)
        onUpdate()
      } catch (error) {
        console.error('Failed to update:', error)
        setInputValue(value || 0)
      }
    }
  }

  if (isGold) {
    return (
      <InputNumber
        size="small"
        value={inputValue}
        min={0}
        precision={2}
        suffix="克"
        style={{ width: 80 }}
        onChange={(val) => setInputValue(val || 0)}
        onBlur={handleBlur}
        onPressEnter={handleBlur}
      />
    )
  }

  return (
    <InputNumber
      size="small"
      value={inputValue}
      min={0}
      precision={precision}
      suffix={suffix}
      style={{ width: 80 }}
      onChange={(val) => setInputValue(val || 0)}
      onBlur={handleBlur}
      onPressEnter={handleBlur}
    />
  )
}

export default EditableCell
