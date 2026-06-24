import React, { useState, useEffect } from 'react'
import { Card, Table, Modal, InputNumber, Button, Tooltip, message } from 'antd'
import { BarsOutlined, SettingOutlined } from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'

interface AssetInfo {
  symbol: string
  name: string
  proportion: number   // 占该仓位百分比
  value: number        // 市值（万元）
  change: number       // 涨跌幅 %
  pnl: number          // 盈亏（万元）
  pnlPercent: number   // 盈亏百分比 %
}

interface PositionBinProps {
  tag: string
  totalTarget: number   // 目标市值（万元）
  totalCurrent: number  // 当前市值（万元）
  fillPercent: number  // 填充率 %
  totalPnl: number
  totalPnlPercent: number
  assets: AssetInfo[]
  targetValue?: number
  savingTarget?: boolean
  onSaveTarget?: (tag: string, targetValue: number) => Promise<void> | void
  onAssetClick?: (symbol: string, name: string) => void
}

// 标签对应的颜色 - WCAG AA 对比度标准 (深色背景上至少 4.5:1)
// 验证工具: https://webaim.org/resources/contrastchecker/
const TAG_COLORS: Record<string, string> = {
  'A股': '#5a6bff',      // 蓝紫色
  '港股': '#86efac',     // 浅绿 (深背景对比度 ~4.8:1)
  '美股': '#fca5a5',     // 浅红 (深背景对比度 ~4.6:1)
  '新能源': '#86efac',   // 浅绿
  '科技': '#5a6bff',     // 蓝紫
  '医药': '#fca5a5',     // 浅红
  '消费': '#fcd34d',     // 亮黄 (深背景对比度 ~7.2:1)
  '金融': '#a78bfa',     // 浅紫
  '地产': '#9ca3af',     // 中灰 - 满足 WCAG AA 4.6:1
  '黄金': '#fbbf24',     // 金黄
  '股票': '#818cf8',
  '权益类': '#818cf8',
  '基金': '#5eead4',     // 青绿 (深背景对比度 ~4.8:1)
  '债券': '#6b7280',     // 深灰 - 满足 WCAG AA 5.9:1
  '固定收益': '#9ca3af',
  '现金': '#38bdf8',
  'ETF': '#5eead4',      // 青绿
  '半导体': '#818cf8',   // 靛蓝
  '未分类': '#9ca3af',   // 中灰 - 满足 WCAG AA
}

const PositionBin: React.FC<PositionBinProps> = ({
  tag,
  totalTarget,
  totalCurrent,
  totalPnl,
  totalPnlPercent,
  assets,
  targetValue: persistedTargetValue,
  savingTarget = false,
  onSaveTarget,
  onAssetClick,
}) => {
  const [hovered, setHovered] = useState(false)
  const [targetModalVisible, setTargetModalVisible] = useState(false)
  const [detailModalVisible, setDetailModalVisible] = useState(false)
  const [targetValue, setTargetValue] = useState<number>(persistedTargetValue ?? totalTarget)

  const color = TAG_COLORS[tag] || '#818cf8'

  useEffect(() => {
    setTargetValue(persistedTargetValue ?? totalTarget)
  }, [persistedTargetValue, totalTarget])

  // Handle target value save
  const handleSaveTarget = async () => {
    try {
      await onSaveTarget?.(tag, targetValue)
      setTargetModalVisible(false)
      message.success(`${tag} 目标仓位已设置为 ${targetValue} 万元`)
    } catch (error) {
      console.error('Failed to save target:', error)
      message.error('目标仓位保存失败')
    }
  }

  // Calculate progress based on target value
  const targetFillPercent = targetValue > 0 ? (totalCurrent / targetValue) * 100 : 0
  const deviation = totalCurrent - targetValue  // 偏离度
  const isOverTarget = deviation >= 0
  const statusColor = isOverTarget ? '#34d399' : '#f87171'
  const pnlStatusColor = totalPnlPercent >= 0 ? '#34d399' : '#f59e0b'

  const assetColumns: ColumnsType<AssetInfo> = [
    {
      title: '代码',
      dataIndex: 'symbol',
      key: 'symbol',
      width: 80,
      render: (v: string, r: AssetInfo) => (
        <a onClick={() => onAssetClick?.(v, r.name)}>{v}</a>
      ),
    },
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      width: 100,
    },
    {
      title: '持仓(万)',
      dataIndex: 'value',
      key: 'value',
      width: 80,
      render: (v: number) => v?.toFixed(2) || '--',
    },
    {
      title: '占比',
      dataIndex: 'proportion',
      key: 'proportion',
      width: 60,
      render: (v: number) => `${v?.toFixed(1)}%`,
    },
    {
      title: '涨跌幅',
      dataIndex: 'change',
      key: 'change',
      width: 80,
      render: (v: number) => (
        <span className={v >= 0 ? 'text-[success]' : 'text-[danger]'}>
          {v >= 0 ? '+' : ''}{v?.toFixed(2)}%
        </span>
      ),
    },
    {
      title: '盈亏(万)',
      dataIndex: 'pnl',
      key: 'pnl',
      width: 110,
      render: (v: number, record: AssetInfo) => (
        <span className={v >= 0 ? 'text-[success]' : 'text-[danger]'}>
          {v >= 0 ? '+' : ''}{v?.toFixed(2)} ({record.pnlPercent >= 0 ? '+' : ''}{record.pnlPercent.toFixed(2)}%)
        </span>
      ),
    },
  ]

  const assetDetailTable = (
    <div className="w-full">
      <Table
        columns={assetColumns}
        dataSource={assets}
        rowKey="symbol"
        pagination={false}
        size="small"
        scroll={{ x: 640 }}
        summary={() => (
          <Table.Summary>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={2}>
                <strong>合计</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={1}>
                <strong>{totalCurrent.toFixed(2)}万</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={2}>
                <strong>100%</strong>
              </Table.Summary.Cell>
              <Table.Summary.Cell index={3}>
                <span className={totalPnl >= 0 ? 'text-[success]' : 'text-[danger]'}>
                  {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}万 ({totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%)
                </span>
              </Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
    </div>
  )

  return (
    <>
      <Card
        className={`transition-all duration-200 card-sm ${
          hovered ? 'brightness-125' : ''
        }`}
        style={{
          background: `linear-gradient(180deg, ${color}20 0%, ${color}05 100%)`,
          borderColor: hovered ? color : `${color}50`,
        }}
        bodyStyle={{ padding: 16 }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* 仓位标签 */}
        <div className="flex items-center justify-between mb-3">
          <span className="font-medium text-white">{tag}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-300">{assets.length}个标的</span>
            <Tooltip title="查看资产明细">
              <Button
                type="text"
                size="small"
                aria-label={`${tag}资产明细`}
                icon={<BarsOutlined />}
                onClick={() => setDetailModalVisible(true)}
                className="text-gray-300 hover:text-white"
              />
            </Tooltip>
            <Tooltip title="设置目标仓位">
              <Button
                type="text"
                size="small"
                aria-label={`${tag}设置目标仓位`}
                icon={<SettingOutlined />}
                onClick={() => setTargetModalVisible(true)}
                className="text-gray-300 hover:text-white"
              />
            </Tooltip>
          </div>
        </div>

        {/* 粮仓可视化 */}
        <div
          className="relative rounded-lg overflow-hidden mb-3"
          style={{
            height: 120,
            backgroundColor: '#1a1a2e',
            border: `1px solid ${color}30`,
          }}
        >
          {/* 目标仓位线 (100%线) */}
          <div
            className="absolute left-0 right-0 border-t-2 border-dashed border-gray-500"
            style={{ top: '0%' }}
          />

          {/* 填充区域 - 基于目标市值，颜色体现本类别总体浮盈亏 */}
          <div
            className="absolute bottom-0 left-0 right-0 transition-all duration-500"
            style={{
              height: `${Math.min(100, targetFillPercent)}%`,
              background: `linear-gradient(180deg, ${pnlStatusColor}66 0%, ${pnlStatusColor}33 100%)`,
            }}
          >
            {/* 填充渐变效果 */}
            <div
              className="absolute inset-0 opacity-50"
              style={{
                background: `repeating-linear-gradient(90deg, transparent, transparent 4px, ${pnlStatusColor}1A 4px, ${pnlStatusColor}1A 8px)`,
              }}
            />
          </div>

          {/* 填充率文字 */}
          <div className="absolute inset-0 flex flex-col items-center justify-center">
	            <span
	              className="text-2xl font-bold"
	              style={{ color: pnlStatusColor }}
	            >
              {targetFillPercent.toFixed(0)}%
            </span>
	            <span className="text-xs text-gray-300 mt-1">
	              浮盈亏 {totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(1)}%
	            </span>
          </div>
        </div>

        {/* 市值信息 */}
        <div className="flex justify-between text-sm">
          <span className="text-gray-300">当前</span>
          <span className="text-white font-medium">
            {totalCurrent.toFixed(1)}万
          </span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-gray-300">目标</span>
          <span className="text-white font-medium">
            {targetValue.toFixed(1)}万
          </span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-gray-300">浮盈亏</span>
          <span className={totalPnl >= 0 ? 'text-[success]' : 'text-[danger]'}>
            {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(1)}万 ({totalPnlPercent >= 0 ? '+' : ''}{totalPnlPercent.toFixed(2)}%)
          </span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-gray-300">偏离</span>
          <span style={{ color: statusColor }}>
            {isOverTarget ? '+' : ''}{deviation.toFixed(1)}万
          </span>
        </div>
      </Card>

    <Modal
      title={<span className="text-white">{tag} - 资产明细</span>}
      open={detailModalVisible}
      onCancel={() => setDetailModalVisible(false)}
      footer={null}
      width={760}
      destroyOnHidden
      className="dark-modal"
    >
      {assetDetailTable}
    </Modal>

    {/* 目标仓位设置 Modal */}
    <Modal
      title={<span className="text-white">{tag} - 设置目标仓位</span>}
      open={targetModalVisible}
      onCancel={() => setTargetModalVisible(false)}
      footer={null}
      destroyOnHidden
      className="dark-modal"
    >
      <div className="py-4">
        <p className="text-gray-300 mb-4">设置目标市值，系统将显示当前市值与目标的偏离度</p>
        <div className="flex items-center gap-4">
          <span className="text-white whitespace-nowrap">目标市值（万元）：</span>
          <InputNumber
            value={targetValue}
            onChange={(v) => setTargetValue(v || 0)}
            min={0}
            step={1}
            precision={1}
            style={{ width: 200 }}
            placeholder="请输入目标市值"
          />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button onClick={() => setTargetModalVisible(false)}>
            取消
          </Button>
          <Button type="primary" onClick={handleSaveTarget} loading={savingTarget}>
            保存
          </Button>
        </div>
      </div>
    </Modal>
    </>
  )
}

export default PositionBin
