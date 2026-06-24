import React from 'react'
import { Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'

export interface ProviderHealthItem {
  provider: string
  label: string
  successes: number
  failures: number
  fallbackHits: number
  healthScore: number
  status: 'healthy' | 'degraded' | 'failing' | 'unknown'
}

const PROVIDER_STATUS_COLOR: Record<ProviderHealthItem['status'], string> = {
  healthy: '#34d399',
  degraded: '#fbbf24',
  failing: '#f87171',
  unknown: '#818cf8',
}

const providerSummaryColumns: ColumnsType<ProviderHealthItem> = [
  { title: '数据源', dataIndex: 'label', key: 'label', width: 160 },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 120,
    render: (value: ProviderHealthItem['status']) => (
      <span style={{ color: PROVIDER_STATUS_COLOR[value] }}>{value}</span>
    ),
  },
  { title: '成功', dataIndex: 'successes', key: 'successes', width: 80 },
  { title: '失败', dataIndex: 'failures', key: 'failures', width: 80 },
  { title: '回退', dataIndex: 'fallbackHits', key: 'fallbackHits', width: 80 },
  {
    title: '健康度',
    dataIndex: 'healthScore',
    key: 'healthScore',
    width: 100,
    render: (value: number) => `${(value * 100).toFixed(0)}%`,
  },
]

export const ProviderHealthTags: React.FC<{
  items: ProviderHealthItem[]
}> = ({ items }) => (
  <div className="flex flex-wrap gap-2">
    {items
      .filter((item) => item.status !== 'unknown')
      .map((item) => (
        <Tag key={item.provider} color={PROVIDER_STATUS_COLOR[item.status]}>
          {item.label} {item.status}
        </Tag>
      ))}
  </div>
)

const ProviderHealthSummary: React.FC<{
  items: ProviderHealthItem[]
  className?: string
}> = ({ items, className }) => {
  if (items.length === 0) return null

  return (
    <div className={`max-w-full overflow-x-auto ${className || ''}`}>
      <Table
        columns={providerSummaryColumns}
        dataSource={items}
        rowKey="provider"
        pagination={false}
        size="small"
        scroll={{ x: 620 }}
      />
    </div>
  )
}

export default ProviderHealthSummary
