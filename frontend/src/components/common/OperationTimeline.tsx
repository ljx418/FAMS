import React, { useEffect, useMemo, useState } from 'react'
import { Button, Card, Progress, Segmented, Tag } from 'antd'
import { useNavigate } from 'react-router-dom'
import { API_BASE } from '../../config/api'

export type OperationTimelineStatus = 'queued' | 'running' | 'completed' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'partial'
export type OperationTimelineType = 'refresh_prices' | 'check_alerts' | 'generate_daily_advice' | 'run_backtest' | 'generate_backtest_report' | 'stock_screener_full_scan' | 'batch_factset_refresh' | 'fivd_r_portfolio_refresh'

export interface OperationTimelineItem {
  id: string
  parentOperationId?: string
  type: OperationTimelineType
  status: OperationTimelineStatus
  requestedAt: string
  completedAt?: string
  progressPct?: number
  result?: Record<string, any>
}

const TYPE_META: Record<OperationTimelineType, { label: string; color: string }> = {
  refresh_prices: { label: '刷新价格', color: '#38bdf8' },
  generate_daily_advice: { label: '生成每日建议', color: '#818cf8' },
  check_alerts: { label: '检查告警', color: '#fbbf24' },
  run_backtest: { label: '运行回测', color: '#34d399' },
  generate_backtest_report: { label: '回测报告', color: '#f97316' },
  stock_screener_full_scan: { label: '全A选股扫描', color: '#22c55e' },
  batch_factset_refresh: { label: '刷新事实集', color: '#a78bfa' },
  fivd_r_portfolio_refresh: { label: 'FIVD-R刷新', color: '#38bdf8' },
}

const STATUS_META: Record<OperationTimelineStatus, { color: string; label: string }> = {
  queued: { color: 'processing', label: '排队中' },
  running: { color: 'processing', label: '执行中' },
  completed: { color: 'success', label: '已完成' },
  succeeded: { color: 'success', label: '已完成' },
  partial: { color: 'warning', label: '部分成功' },
  failed: { color: 'error', label: '失败' },
  cancelling: { color: 'warning', label: '取消中' },
  cancelled: { color: 'default', label: '已取消' },
}

const formatDateTime = (value?: string) => {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

const formatPercent = (value?: number | null) => `${(value || 0) >= 0 ? '+' : ''}${(value || 0).toFixed(2)}%`
interface TimelineAction {
  key: string
  label: string
  kind: 'primary' | 'secondary'
  onClick: () => void
  loading?: boolean
}

const truncateText = (value?: string | null, maxLength = 72) => {
  if (!value) return null
  if (value.length <= maxLength) return value
  return `${value.slice(0, maxLength).trimEnd()}...`
}

const isSuccessfulStatus = (status: OperationTimelineStatus) => status === 'completed' || status === 'succeeded' || status === 'partial'

const renderSummary = (
  item: OperationTimelineItem,
  backtestSummaries: Record<string, {
    totalReturn?: number | null
    executionRate?: number | null
    tradesCount?: number | null
    reviewNotes?: string[]
  }>
) => {
  if (item.type === 'generate_daily_advice') {
    const suggestionCount = Array.isArray(item.result?.suggestions) ? item.result.suggestions.length : 0
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        <Tag color="#34d399">建议 {suggestionCount}</Tag>
        {item.result?.adviceId && <Tag color="#a78bfa">Advice {String(item.result.adviceId).slice(0, 8)}</Tag>}
        {item.result?.snapshotIds?.positionSnapshotIds && (
          <Tag color="#38bdf8">持仓快照 {item.result.snapshotIds.positionSnapshotIds.length}</Tag>
        )}
      </div>
    )
  }

  if (item.type === 'run_backtest') {
    const backtestId = typeof item.result?.backtestId === 'string' ? item.result.backtestId : null
    const backtestSummary = backtestId ? backtestSummaries[backtestId] : null
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        {item.result?.backtestId && <Tag color="#34d399">Backtest {String(item.result.backtestId).slice(0, 8)}</Tag>}
        {typeof backtestSummary?.totalReturn === 'number' && (
          <Tag color={backtestSummary.totalReturn >= 0 ? '#34d399' : '#f87171'}>
            收益 {formatPercent(backtestSummary.totalReturn)}
          </Tag>
        )}
        {typeof backtestSummary?.tradesCount === 'number' && (
          <Tag color="#38bdf8">交易 {backtestSummary.tradesCount}</Tag>
        )}
        {typeof backtestSummary?.executionRate === 'number' && (
          <Tag color="#a78bfa">执行率 {(backtestSummary.executionRate * 100).toFixed(0)}%</Tag>
        )}
      </div>
    )
  }

  if (item.type === 'refresh_prices') {
    const refreshed = typeof item.result?.refreshed === 'number' ? item.result.refreshed : null
    const failed = typeof item.result?.failed === 'number' ? item.result.failed : null
    if (refreshed !== null || failed !== null) {
      return (
        <div className="flex flex-wrap gap-2 mt-2">
          {refreshed !== null && <Tag color="#34d399">成功 {refreshed}</Tag>}
          {failed !== null && <Tag color={failed > 0 ? '#f87171' : '#38bdf8'}>失败 {failed}</Tag>}
        </div>
      )
    }
  }

  if (item.type === 'fivd_r_portfolio_refresh') {
    const status = item.result?.fivdRAnalysis?.summary?.status
    const durationMs = typeof item.result?.durationMs === 'number' ? item.result.durationMs : null
    return (
      <div className="flex flex-wrap gap-2 mt-2">
        {status && <Tag color={status === 'available' ? '#34d399' : '#fbbf24'}>FIVD-R {String(status)}</Tag>}
        {durationMs !== null && <Tag color="#38bdf8">耗时 {(durationMs / 1000).toFixed(1)}s</Tag>}
      </div>
    )
  }

  return null
}

const OperationTimeline: React.FC<{
  items: OperationTimelineItem[]
  currentOperationId?: string
  title?: string
  onOpenOperation?: (id: string) => void
  onOpenAdviceSnapshot?: (operationId: string) => void
  onOpenRefreshDiagnostics?: (operationId: string, focus: 'provider' | 'failures') => void
  onRunBacktest?: (adviceId: string, parentOperationId?: string) => void
  runningBacktestOperationId?: string | null
  className?: string
}> = ({
  items,
  currentOperationId,
  title = '关联任务链',
  onOpenOperation,
  onOpenAdviceSnapshot,
  onOpenRefreshDiagnostics,
  onRunBacktest,
  runningBacktestOperationId,
  className,
}) => {
  const navigate = useNavigate()
  const [backtestSummaries, setBacktestSummaries] = useState<Record<string, {
    totalReturn?: number | null
    executionRate?: number | null
    tradesCount?: number | null
    reviewNotes?: string[]
  }>>({})
  const [expandedIds, setExpandedIds] = useState<string[]>([])
  const [filterMode, setFilterMode] = useState<'all' | 'advice' | 'backtest' | 'failed'>('all')

  const backtestIds = useMemo(() => (
    items
      .map((item) => (typeof item.result?.backtestId === 'string' ? item.result.backtestId : null))
      .filter((value): value is string => Boolean(value))
  ), [items])

  const visibleItems = useMemo(() => {
    if (filterMode === 'advice') {
      return items.filter((item) => item.type === 'generate_daily_advice')
    }
    if (filterMode === 'backtest') {
      return items.filter((item) => item.type === 'run_backtest' || item.type === 'generate_backtest_report')
    }
    if (filterMode === 'failed') {
      return items.filter((item) => item.status === 'failed')
    }
    return items
  }, [filterMode, items])

  const adviceCount = items.filter((item) => item.type === 'generate_daily_advice').length
  const backtestCount = items.filter((item) => item.type === 'run_backtest' || item.type === 'generate_backtest_report').length
  const failedCount = items.filter((item) => item.status === 'failed').length

  useEffect(() => {
    if (backtestIds.length === 0) {
      setBacktestSummaries({})
      return
    }

    let cancelled = false
    const fetchBacktestSummaries = async () => {
      const entries = await Promise.all(backtestIds.map(async (backtestId) => {
        try {
          const response = await fetch(`${API_BASE}/api/v1/backtest/results/${backtestId}`)
          if (!response.ok) {
            return [backtestId, {}] as const
          }
          const data = await response.json()
          return [backtestId, {
            totalReturn: data?.metrics?.totalReturn,
            executionRate: data?.reviewReport?.windowReview?.executionRate,
            tradesCount: data?.metrics?.tradesCount,
            reviewNotes: Array.isArray(data?.reviewReport?.windowReview?.notes) ? data.reviewReport.windowReview.notes : [],
          }] as const
        } catch {
          return [backtestId, {}] as const
        }
      }))

      if (!cancelled) {
        setBacktestSummaries(Object.fromEntries(entries))
      }
    }

    void fetchBacktestSummaries()
    return () => {
      cancelled = true
    }
  }, [backtestIds])

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => (
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id]
    ))
  }

  if (items.length <= 1) return null

  return (
    <Card size="small" title={title} className={className}>
      <div className="space-y-3">
        <Segmented
          size="small"
          value={filterMode}
          onChange={(value) => setFilterMode(value as typeof filterMode)}
          options={[
            { label: `全部 ${items.length}`, value: 'all' },
            { label: `建议链 ${adviceCount}`, value: 'advice' },
            { label: `回测链 ${backtestCount}`, value: 'backtest' },
            { label: `失败 ${failedCount}`, value: 'failed' },
          ]}
        />
        {visibleItems.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/10 bg-[#0f172a66] px-3 py-4 text-sm text-gray-400">
            当前筛选下暂无任务节点
          </div>
        ) : visibleItems.map((item, index) => {
          const isCurrent = item.id === currentOperationId
          const isExpanded = expandedIds.includes(item.id)
          const backtestId = typeof item.result?.backtestId === 'string' ? item.result.backtestId : null
          const backtestSummary = backtestId ? backtestSummaries[backtestId] : null
          const adviceSummary = typeof item.result?.structuredAdvice?.summary === 'string'
            ? item.result.structuredAdvice.summary
            : typeof item.result?.marketOutlook === 'string'
            ? item.result.marketOutlook
            : null
          const compactSummary = item.type === 'generate_daily_advice'
            ? truncateText(adviceSummary)
            : item.type === 'run_backtest'
            ? truncateText(backtestSummary?.reviewNotes?.[0] || null)
            : null
          const actions: TimelineAction[] = []

          if (item.type === 'generate_daily_advice' && onRunBacktest && typeof item.result?.adviceId === 'string') {
            actions.push({
              key: 'run-backtest',
              label: '提交回测',
              kind: 'primary',
              loading: runningBacktestOperationId === item.id,
              onClick: () => onRunBacktest(item.result?.adviceId as string, item.id),
            })
          }

          if (item.type === 'run_backtest' && item.result?.backtestId) {
            actions.push({
              key: 'open-report',
              label: '打开复盘报告',
              kind: 'primary',
              onClick: () => navigate(`/backtest?backtestId=${item.result?.backtestId}&view=report`),
            })
          }

          if (item.type === 'refresh_prices' && onOpenRefreshDiagnostics && Array.isArray(item.result?.summary?.providerSummary) && item.result.summary.providerSummary.length > 0) {
            actions.push({
              key: 'open-provider',
              label: '打开数据源健康度',
              kind: 'primary',
              onClick: () => onOpenRefreshDiagnostics(item.id, 'provider'),
            })
          }

          if (onOpenAdviceSnapshot && item.type === 'generate_daily_advice') {
            actions.push({
              key: 'open-advice',
              label: '打开建议快照',
              kind: 'secondary',
              onClick: () => onOpenAdviceSnapshot(item.id),
            })
          }

          if (onOpenRefreshDiagnostics && item.type === 'refresh_prices' && typeof item.result?.failed === 'number' && item.result.failed > 0) {
            actions.push({
              key: 'open-failures',
              label: '打开失败明细',
              kind: 'secondary',
              onClick: () => onOpenRefreshDiagnostics(item.id, 'failures'),
            })
          }

          if (item.type === 'run_backtest' && item.result?.backtestId) {
            actions.push({
              key: 'open-backtest',
              label: '打开回测页',
              kind: 'secondary',
              onClick: () => navigate(`/backtest?backtestId=${item.result?.backtestId}`),
            })
          }

          if (onOpenOperation) {
            actions.push({
              key: 'open-operation',
              label: '查看详情',
              kind: 'secondary',
              onClick: () => onOpenOperation(item.id),
            })
          }

          const primaryAction = actions.find((action) => action.kind === 'primary') || null
          const secondaryActions = actions.filter((action) => action !== primaryAction)

          return (
            <div key={item.id} className="flex items-start gap-3">
              <div className="flex flex-col items-center">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ background: isCurrent ? '#34d399' : '#818cf8', marginTop: 6 }}
                />
                {index < visibleItems.length - 1 && <div className="mt-1 h-10 w-px bg-white/10" />}
              </div>
              <div className="flex-1 rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <Tag color={TYPE_META[item.type]?.color}>{TYPE_META[item.type]?.label || item.type}</Tag>
                  <Tag color={STATUS_META[item.status].color as any}>{STATUS_META[item.status].label}</Tag>
                  <Tag color={isCurrent ? '#34d399' : '#38bdf8'}>
                    {isCurrent ? '当前任务' : index === 0 ? '上游任务' : '下游任务'}
                  </Tag>
                  <Tag color="#64748b">{item.id.slice(0, 8)}</Tag>
                </div>
                <div className="text-sm text-gray-300">
                  请求时间 {formatDateTime(item.requestedAt)}
                  {item.completedAt ? `，完成时间 ${formatDateTime(item.completedAt)}` : ''}
                </div>
                {renderSummary(item, backtestSummaries)}
                {compactSummary && !isExpanded && (
                  <div className="mt-2 text-sm text-gray-300 leading-6">
                    {compactSummary}
                  </div>
                )}
                {(adviceSummary || backtestSummary?.reviewNotes?.length) && (
                  <div className="mt-3">
                    <Button
                      size="small"
                      type="text"
                      onClick={() => toggleExpanded(item.id)}
                      style={{ color: '#94a3b8', paddingInline: 0 }}
                    >
                      {isExpanded ? '收起摘要' : '展开摘要'}
                    </Button>
                    {isExpanded && (
                      <div className="mt-2 rounded-lg border border-white/10 bg-[#111827] p-3 text-sm text-gray-200 leading-6">
                        {item.type === 'generate_daily_advice' && adviceSummary && (
                          <>
                            <div className="text-xs text-gray-400 mb-1">建议摘要</div>
                            <div className="whitespace-pre-wrap">{adviceSummary}</div>
                          </>
                        )}
                        {item.type === 'run_backtest' && (
                          <>
                            <div className="text-xs text-gray-400 mb-1">复盘摘要</div>
                            <div className="flex flex-wrap gap-2 mb-2">
                              {typeof backtestSummary?.totalReturn === 'number' && (
                                <Tag color={backtestSummary.totalReturn >= 0 ? '#34d399' : '#f87171'}>
                                  总收益 {formatPercent(backtestSummary.totalReturn)}
                                </Tag>
                              )}
                              {typeof backtestSummary?.executionRate === 'number' && (
                                <Tag color="#a78bfa">执行率 {(backtestSummary.executionRate * 100).toFixed(0)}%</Tag>
                              )}
                            </div>
                            {backtestSummary?.reviewNotes?.length ? (
                              <div className="flex flex-wrap gap-2">
                                {backtestSummary.reviewNotes.map((note) => (
                                  <Tag key={note} color="#475569">{note}</Tag>
                                ))}
                              </div>
                            ) : (
                              <div className="text-gray-400">暂无复盘说明</div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {typeof item.progressPct === 'number' && (
                  <Progress
                    percent={item.progressPct}
                    size="small"
                    className="mt-3"
                    status={item.status === 'failed' ? 'exception' : isSuccessfulStatus(item.status) ? 'success' : 'active'}
                  />
                )}
                {(primaryAction || secondaryActions.length > 0) && (
                  <div className="mt-3">
                    {primaryAction && (
                      <Button
                        size="small"
                        type="primary"
                        loading={primaryAction.loading}
                        onClick={primaryAction.onClick}
                      >
                        {primaryAction.label}
                      </Button>
                    )}
                    {secondaryActions.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                        {secondaryActions.map((action) => (
                          <Button
                            key={action.key}
                            size="small"
                            type="link"
                            loading={action.loading}
                            onClick={action.onClick}
                            style={{ paddingInline: 0 }}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

export default OperationTimeline
