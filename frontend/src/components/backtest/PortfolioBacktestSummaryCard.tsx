import { Alert, Card, Tag } from 'antd'

type PortfolioBacktestSummaryCardProps = {
  result: any | null
  selectedStrategyCount: number
  selectedStrategyNames: string[]
  gateStatus: string
  gateDescription: string
}

const formatPercent = (value?: number | null) => `${(value || 0) >= 0 ? '+' : ''}${(value || 0).toFixed(2)}%`

const getStrategyName = (strategy: any) => strategy?.definition?.displayName || strategy?.definition?.strategyId || '未命名策略'

export function PortfolioBacktestSummaryCard({
  result,
  selectedStrategyCount,
  selectedStrategyNames,
  gateStatus,
  gateDescription,
}: PortfolioBacktestSummaryCardProps) {
  const strategies = (result?.strategies || []).filter((strategy: any) => strategy?.status === 'completed')
  const bestReturn = [...strategies].sort((a, b) => (b.metrics?.totalReturnPercent || 0) - (a.metrics?.totalReturnPercent || 0))[0]
  const lowestDrawdown = [...strategies].sort((a, b) => Math.abs(a.metrics?.maxDrawdownPercent || 0) - Math.abs(b.metrics?.maxDrawdownPercent || 0))[0]
  const trusted = [...strategies].sort((a, b) => (b.dataCoverage?.priceCoveragePercent || 0) - (a.dataCoverage?.priceCoveragePercent || 0))[0]
  const governanceItem = result?.dataGovernanceAudit?.items?.[0]
  const governanceProvider = governanceItem?.providerClass || governanceItem?.sourceProvider || 'local_cache'
  const governanceStatus = result?.dataGovernanceAudit?.status || '待运行'

  return (
    <Card
      title={<span className="text-primary">普通模式：先看策略结论</span>}
      className="bg-[#1a1a2e] border-surface-border"
      styles={{ header: { color: '#fff', borderBottomColor: '#374151' }, body: { padding: 14 } }}
    >
      <Alert
        className="mb-4"
        type="info"
        showIcon
        message="本页用于比较策略，不创建订单"
        description="回测结果可以进入人工计划草案复核；正式 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 仍被交易 gate 阻断。"
      />
      <div className="grid gap-3 lg:grid-cols-4">
        <div className="rounded-lg border border-white/10 bg-black/10 p-3">
          <div className="text-sm font-medium text-white">当前准备比较</div>
          <div className="mt-2 text-2xl font-semibold text-white">{selectedStrategyCount}</div>
          <div className="mt-2 line-clamp-3 text-xs leading-5 text-gray-400">
            {selectedStrategyNames.join('、') || '尚未选择策略'}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/10 p-3">
          <div className="text-sm font-medium text-white">收益最高</div>
          <div className="mt-2 text-sm text-gray-300">{bestReturn ? getStrategyName(bestReturn) : '运行后显示'}</div>
          <Tag className="mt-2" color="#34d399">{bestReturn ? formatPercent(bestReturn.metrics?.totalReturnPercent) : '--'}</Tag>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/10 p-3">
          <div className="text-sm font-medium text-white">回撤最低</div>
          <div className="mt-2 text-sm text-gray-300">{lowestDrawdown ? getStrategyName(lowestDrawdown) : '运行后显示'}</div>
          <Tag className="mt-2" color="#38bdf8">{lowestDrawdown ? formatPercent(lowestDrawdown.metrics?.maxDrawdownPercent) : '--'}</Tag>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/10 p-3">
          <div className="text-sm font-medium text-white">交易状态</div>
          <div className="mt-2 text-sm text-gray-300">{gateStatus}</div>
          <div className="mt-2 text-xs leading-5 text-gray-400">{gateDescription}</div>
          {trusted && <Tag className="mt-2" color="#fbbf24">数据覆盖 {formatPercent(trusted.dataCoverage?.priceCoveragePercent)}</Tag>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs">
        <Tag color={result?.dataGovernanceAudit?.status === 'passed' ? '#34d399' : '#fbbf24'}>
          数据治理 {governanceStatus}
        </Tag>
        <Tag color="#64748b">来源 {governanceProvider}</Tag>
        <Tag color={result?.modelEffectiveness?.status === 'passed' ? '#34d399' : '#fbbf24'}>
          模型有效性 {result?.modelEffectiveness?.status || '待运行'}
        </Tag>
      </div>
    </Card>
  )
}
