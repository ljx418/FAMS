import React from 'react'
import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'

export interface RefreshFailureItem {
  success?: boolean
  symbol: string
  price?: number
  source?: string
  fallbackUsed?: boolean
  stale?: boolean
  error?: string
  errorCode?: string
  errorCategory?: 'network' | 'empty_data' | 'unsupported_symbol' | 'invalid_price' | 'validation_failed' | 'provider_failure'
}

const REFRESH_ERROR_CATEGORY_LABEL: Record<NonNullable<RefreshFailureItem['errorCategory']>, string> = {
  network: '网络受限',
  empty_data: '无可用数据',
  unsupported_symbol: '代码不适配',
  invalid_price: '价格无效',
  validation_failed: '刷新校验阻断',
  provider_failure: '源失败',
}

export const formatRefreshFailureSummary = (failures: RefreshFailureItem[]) => {
  if (failures.length === 0) return ''

  const retainedCount = failures.filter((item) => item.fallbackUsed && item.stale).length
  const categoryCounts = failures.reduce<Record<string, number>>((acc, item) => {
    const key = item.errorCategory || 'provider_failure'
    acc[key] = (acc[key] || 0) + 1
    return acc
  }, {})

  const categorySummary = Object.entries(categoryCounts)
    .map(([key, count]) => `${REFRESH_ERROR_CATEGORY_LABEL[key as NonNullable<RefreshFailureItem['errorCategory']>] || key} ${count}`)
    .join('，')

  const sampleSummary = failures
    .slice(0, 3)
    .map((item) => `${item.symbol}: ${item.error || '刷新失败'}`)
    .join('；')

  const retainedSummary = retainedCount > 0 ? `保留旧价 ${retainedCount}，` : ''
  return `${retainedSummary}${categorySummary}${sampleSummary ? `。示例：${sampleSummary}` : ''}`
}

const refreshFailureColumns: ColumnsType<RefreshFailureItem> = [
  { title: '代码', dataIndex: 'symbol', key: 'symbol', width: 120 },
  {
    title: '分类',
    dataIndex: 'errorCategory',
    key: 'errorCategory',
    width: 140,
    render: (value?: RefreshFailureItem['errorCategory']) => (
      REFRESH_ERROR_CATEGORY_LABEL[value || 'provider_failure'] || '源失败'
    ),
  },
  {
    title: '处理结果',
    key: 'result',
    width: 140,
    render: (_, record) => (
      record.errorCode === 'POST_REFRESH_VALIDATION_FAILED'
        ? '阻断写库'
        : record.fallbackUsed && record.stale ? '保留旧价' : '未更新'
    ),
  },
  {
    title: '保留价格',
    dataIndex: 'price',
    key: 'price',
    width: 120,
    render: (value?: number) => (typeof value === 'number' ? value.toFixed(3) : '--'),
  },
  { title: '错误码', dataIndex: 'errorCode', key: 'errorCode', width: 220 },
  { title: '原因', dataIndex: 'error', key: 'error' },
]

const RefreshFailureTable: React.FC<{
  items: RefreshFailureItem[]
}> = ({ items }) => {
  if (items.length === 0) return null

  return (
    <Table
      columns={refreshFailureColumns}
      dataSource={items}
      rowKey={(record, index) => `${record.symbol}-${record.errorCode || 'error'}-${index}`}
      pagination={{ pageSize: 8 }}
      size="small"
      scroll={{ x: 860 }}
    />
  )
}

export default RefreshFailureTable
