import { Tag } from 'antd'

type StrategyComparisonExplainerProps = {
  strategy: any
}

const formatPercent = (value?: number | null) => `${(value || 0) >= 0 ? '+' : ''}${(value || 0).toFixed(2)}%`

export function StrategyComparisonExplainer({ strategy }: StrategyComparisonExplainerProps) {
  const totalReturn = strategy.metrics?.totalReturnPercent
  const maxDrawdown = strategy.metrics?.maxDrawdownPercent
  const excessReturn = strategy.metrics?.excessReturnPercent
  const status = strategy.formalReviewReadiness?.status || strategy.status
  const resultText = totalReturn == null
    ? '该策略缺少完整收益结果，需要先补数据或重新运行。'
    : `区间总收益 ${formatPercent(totalReturn)}，最大回撤 ${formatPercent(maxDrawdown)}。`
  const excessText = excessReturn == null
    ? '暂未形成可比较的基准超额收益。'
    : excessReturn >= 0
      ? `相对基准超额收益为 ${formatPercent(excessReturn)}。`
      : `相对基准落后 ${formatPercent(excessReturn)}，不应单独作为草案依据。`

  return (
    <div className="mt-3 rounded border border-white/10 bg-black/20 p-2 text-xs leading-5 text-gray-300">
      <div>{resultText}</div>
      <div>{excessText}</div>
      <div className="mt-1 flex flex-wrap gap-1">
        <Tag color={status === 'passed' || status === 'completed' ? '#34d399' : '#fbbf24'}>评审 {status}</Tag>
        <Tag color="#ef4444">不创建订单</Tag>
      </div>
    </div>
  )
}
