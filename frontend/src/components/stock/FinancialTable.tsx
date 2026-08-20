import React from 'react'
import { Card, Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'

interface FinancialQuarter {
  quarter: string
  revenue?: number
  netProfit?: number
  grossMargin?: number
  roe?: number
  debtRatio?: number
  operatingCashFlow?: number
  researchExpense?: number
}

interface FinancialTableProps {
  data?: FinancialQuarter[]
}

const FinancialTable: React.FC<FinancialTableProps> = ({ data }) => {
  const tableData = data || []

  const formatNumber = (value?: number, suffix?: string) => {
    if (value === undefined || value === null) return '--'
    return `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}${suffix || ''}`
  }

  const getMarginColor = (margin?: number) => {
    if (margin === undefined) return '#A0A0A0'
    if (margin >= 40) return 'success'
    if (margin >= 25) return '#FAC858'
    return 'danger'
  }

  const getROEColor = (roe?: number) => {
    if (roe === undefined) return '#A0A0A0'
    if (roe >= 15) return 'success'
    if (roe >= 8) return '#FAC858'
    return 'danger'
  }

  const columns: ColumnsType<FinancialQuarter> = [
    {
      title: '季度',
      dataIndex: 'quarter',
      key: 'quarter',
      width: 80,
      fixed: 'left',
      render: (text: string) => (
        <span className="text-white font-medium">{text}</span>
      ),
    },
    {
      title: '营业收入',
      dataIndex: 'revenue',
      key: 'revenue',
      width: 120,
      align: 'right',
      render: (value?: number) => (
        <span className="text-gray-300">{formatNumber(value, '亿')}</span>
      ),
    },
    {
      title: '净利润',
      dataIndex: 'netProfit',
      key: 'netProfit',
      width: 100,
      align: 'right',
      render: (value?: number) => (
        <span className="text-gray-300">{formatNumber(value, '亿')}</span>
      ),
    },
    {
      title: '毛利率',
      dataIndex: 'grossMargin',
      key: 'grossMargin',
      width: 90,
      align: 'right',
      render: (value?: number) => (
        <span style={{ color: getMarginColor(value) }}>
          {formatNumber(value, '%')}
        </span>
      ),
    },
    {
      title: 'ROE',
      dataIndex: 'roe',
      key: 'roe',
      width: 80,
      align: 'right',
      render: (value?: number) => (
        <span style={{ color: getROEColor(value) }}>
          {formatNumber(value, '%')}
        </span>
      ),
    },
    {
      title: '资产负债率',
      dataIndex: 'debtRatio',
      key: 'debtRatio',
      width: 100,
      align: 'right',
      render: (value?: number) => (
        <span className="text-gray-300">{formatNumber(value, '%')}</span>
      ),
    },
    {
      title: '经营现金流',
      dataIndex: 'operatingCashFlow',
      key: 'operatingCashFlow',
      width: 100,
      align: 'right',
      render: (value?: number) => (
        <span className={value && value > 0 ? 'text-[success]' : 'text-[danger]'}>
          {formatNumber(value, '亿')}
        </span>
      ),
    },
    {
      title: '研发费用',
      dataIndex: 'researchExpense',
      key: 'researchExpense',
      width: 90,
      align: 'right',
      render: (value?: number) => (
        <span className="text-gray-300">{formatNumber(value, '亿')}</span>
      ),
    },
  ]

  return (
    <Card
      title={<span className="text-white text-sm">财务数据（已披露报告期）</span>}
      className="bg-[#1a1a2e] border-[surface-border]"
      size="small"
    >
      <Table
        columns={columns}
        dataSource={tableData.map((item, index) => ({ ...item, key: index }))}
        pagination={false}
        size="small"
        scroll={{ x: 800 }}
        locale={{ emptyText: '暂无可核验财务数据' }}
        className="financial-table"
      />
      <style>{`
        .financial-table .ant-table {
          background: transparent !important;
        }
        .financial-table .ant-table-thead > tr > th {
          background: #0f0f23 !important;
          color: #A0A0A0 !important;
          border-bottom: 1px solid surface-border !important;
          font-size: 12px;
          padding: 8px !important;
        }
        .financial-table .ant-table-tbody > tr > td {
          background: transparent !important;
          border-bottom: 1px solid #1f1f3a !important;
          padding: 8px !important;
        }
        .financial-table .ant-table-tbody > tr:hover > td {
          background: #1f1f3a !important;
        }
      `}</style>
    </Card>
  )
}

export default FinancialTable
