import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App as AntApp, Button, Card, DatePicker, Empty, Segmented, Select, Space, Spin, Statistic, Tag } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import axios from 'axios'
import dayjs, { type Dayjs } from 'dayjs'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import { PlainLanguageHelp } from '../common/PlainLanguageHelp'

const { RangePicker } = DatePicker

type GridReplaySource = {
  assetId: string
  symbol: string
  name: string
  strategyFamily: string
  assignmentStatus: string
  quantity: number
  marketValue: number | null
  planCount: number
  orderCount: number
  latestPlanAt: string | null
  observedThrough: string | null
  replayReady: boolean
  blockers: string[]
}

type GridReplayResult = {
  status: 'available' | 'insufficient'
  asset: { assetId: string; symbol: string; name: string; strategyFamily: string; assignmentStatus: string }
  requestedPeriod: { startDate: string; endDate: string }
  actualPeriod: { startDate: string | null; endDate: string | null; tradingDays: number }
  inputSnapshot: { snapshotHash: string; initialQuantity: number; initialCash: number; initialCapital: number; initialCashSource: string; planCount: number; uniqueOrderCount: number; strategyVersionIds: string[] }
  executionRules: { timeZone: string; lotSize: number; settlement: string; priceAdjustment: string; planSupersession: string; parentChildActivation: string; costModel: { commissionRate: number; minimumCommission: number; stampDutyRate: number; transferFeeRate: number; slippageRate: number } }
  dataHealth: { status: string; providers: string[]; observedThrough: string | null; dailyBarCount: number; intradayBarCount: number; actualTransactionCount: number; duplicatePlanOrdersRemoved: number; evidenceConfidence: number; markerStatusCounts: Record<string, number> }
  qualityAssessment: { verdict: string; incrementalReturnVsHoldPercent: number | null; maxDrawdownDeltaVsHoldPercent: number | null; evidenceConfidence: number; executedAdviceCount: number; completedCycles: number; profitFactor: number | null; turnoverPercent: number | null; totalFees: number | null; interpretation: string }
  candles: Array<{ date: string; open: number; high: number; low: number; close: number; volume: number | null; provider: string }>
  markers: Array<{
    id: string
    planId: string
    decisionDate: string
    validUntil: string
    side: 'buy' | 'sell'
    level: number
    price: number
    quantity: number
    status: 'hit' | 'missed' | 'ambiguous' | 'pending_data' | 'insufficient_intraday_evidence' | 'blocked_parent_not_filled' | 'blocked_sellability' | 'blocked_non_actionable' | 'superseded'
    statusReason: string
    hitDate: string | null
  }>
  scenarios: Array<{
    id: 'follow_grid' | 'hold_without_grid' | 'actual_transactions'
    label: string
    curve: Array<{ date: string; equity: number; cumulativeReturnPercent: number; drawdownPercent: number }>
    metrics: { totalReturnPercent: number | null; annualizedReturnPercent: number | null; maxDrawdownPercent: number | null; sharpeRatio: number | null; sortinoRatio: number | null; executedEventCount: number; blockedEventCount: number; completedCycles: number; profitFactor: number | null; turnoverPercent: number | null; totalFees: number; averageExposurePercent: number | null }
  }>
  blockedReasons: string[]
  warnings: string[]
  permissionState: { formalTradingUnlocked: false; autoTradeUnlocked: false; canCreateOrder: false; orderCreateAllowed: false }
}

const strategyLabel: Record<string, string> = {
  rotation_volatility: '相对轮动与波动仓',
  dividend_low_vol: '红利低波',
  portfolio_allocation: '投资组合',
  unclassified: '尚未归类',
}

function GridCandlestickChart({ result }: { result: GridReplayResult }) {
  const dates = result.candles.map((candle) => candle.date)
  if (dates.length === 0) return <Empty description="没有真实 OHLC，未绘制示意 K 线" />
  const nearestChartDate = (date: string) => dates.find((item) => item >= date) || dates[dates.length - 1]
  const markerStatusLabel: Record<string, string> = {
    hit: '命中', missed: '未命中', ambiguous: '时序不确定，未计收益', pending_data: '等待后续行情',
    insufficient_intraday_evidence: '缺少生成后的分钟线', blocked_parent_not_filled: '父单未成交',
    blocked_sellability: '当时不可卖', blocked_non_actionable: '当时不可执行', superseded: '已被新计划替代',
  }
  const markData = result.markers.filter((marker) => marker.status !== 'pending_data').map((marker) => ({
    name: `${marker.side === 'buy' ? '买' : '卖'} L${marker.level} · ${markerStatusLabel[marker.status] || marker.status}`,
    coord: [nearestChartDate(marker.hitDate || marker.decisionDate), marker.price],
    value: marker.price,
    symbol: marker.side === 'buy' ? 'pin' : 'arrow',
    symbolRotate: marker.side === 'sell' ? 180 : 0,
    itemStyle: {
      color: marker.status === 'ambiguous' ? '#d97706' : marker.status === 'hit' ? (marker.side === 'buy' ? '#dc2626' : '#059669') : marker.status === 'insufficient_intraday_evidence' ? '#ea580c' : '#94a3b8',
      opacity: ['missed', 'superseded', 'blocked_non_actionable'].includes(marker.status) ? 0.6 : 1,
    },
    label: { formatter: `${marker.side === 'buy' ? '买' : '卖'}${marker.level}\n${marker.price.toFixed(3)}`, fontSize: 10 },
  }))
  const pendingLines = result.markers.filter((marker) => marker.status === 'pending_data').map((marker) => ({
    name: `待行情 ${marker.side === 'buy' ? '买' : '卖'}${marker.level}`,
    yAxis: marker.price,
    lineStyle: { color: '#7c3aed', type: 'dashed' as const, opacity: 0.65 },
    label: { formatter: `待行情 ${marker.side === 'buy' ? '买' : '卖'}${marker.level} ${marker.price.toFixed(3)}`, color: '#6d28d9' },
  }))
  const option: EChartsOption = {
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 62, right: 28, top: 38, height: 330 },
      { left: 62, right: 28, top: 404, height: 90 },
    ],
    dataZoom: [{ type: 'inside', xAxisIndex: [0, 1] }, { type: 'slider', xAxisIndex: [0, 1], bottom: 8, height: 22 }],
    xAxis: [
      { type: 'category', data: dates, boundaryGap: true, axisLabel: { color: '#64748b' } },
      { type: 'category', data: dates, gridIndex: 1, boundaryGap: true, axisLabel: { show: false } },
    ],
    yAxis: [
      { type: 'value', scale: true, name: '价格', axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
      { type: 'value', gridIndex: 1, name: '成交量', axisLabel: { color: '#64748b' }, splitLine: { show: false } },
    ],
    series: [
      {
        name: '真实日 K',
        type: 'candlestick',
        data: result.candles.map((candle) => [candle.open, candle.close, candle.low, candle.high]),
        itemStyle: { color: '#dc2626', color0: '#059669', borderColor: '#dc2626', borderColor0: '#059669' },
        markPoint: { data: markData, symbolSize: 42 },
        markLine: { silent: true, symbol: ['none', 'none'], data: pendingLines },
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: result.candles.map((candle) => candle.volume),
        itemStyle: { color: '#93c5fd' },
      },
    ],
  }
  return <ReactECharts option={option} style={{ height: 540, width: '100%' }} notMerge lazyUpdate />
}

function GridReturnChart({ result }: { result: GridReplayResult }) {
  const dates = result.scenarios[0]?.curve.map((point) => point.date) || []
  if (dates.length === 0) return <Empty description="没有满足严谨回放条件的收益曲线" />
  const colors: Record<string, string> = { follow_grid: '#2563eb', hold_without_grid: '#64748b', actual_transactions: '#0f9f6e' }
  const option: EChartsOption = {
    animation: false,
    color: result.scenarios.map((scenario) => colors[scenario.id]),
    tooltip: { trigger: 'axis', valueFormatter: (value) => `${Number(value).toFixed(2)}%` },
    legend: { top: 0, data: result.scenarios.map((scenario) => scenario.label), textStyle: { color: '#334155' } },
    grid: { left: 58, right: 28, top: 48, bottom: 44 },
    dataZoom: [{ type: 'inside' }],
    xAxis: { type: 'category', boundaryGap: false, data: dates, axisLabel: { color: '#64748b' } },
    yAxis: { type: 'value', name: '累计收益', axisLabel: { formatter: '{value}%', color: '#64748b' }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
    series: result.scenarios.map((scenario) => ({
      name: scenario.label,
      type: 'line' as const,
      showSymbol: false,
      data: scenario.curve.map((point) => point.cumulativeReturnPercent),
      lineStyle: { width: scenario.id === 'follow_grid' ? 3 : 2 },
    })),
  }
  return <ReactECharts option={option} style={{ height: 330, width: '100%' }} notMerge lazyUpdate />
}

export function GridReplayPanel() {
  const { message } = AntApp.useApp()
  const [sources, setSources] = useState<GridReplaySource[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState('')
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs().subtract(1, 'year'), dayjs()])
  const [result, setResult] = useState<GridReplayResult | null>(null)
  const [loadingSources, setLoadingSources] = useState(true)
  const [running, setRunning] = useState(false)
  const [view, setView] = useState<'kline' | 'return'>('kline')
  const autoRunKey = useRef('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoadingSources(true)
      try {
        const response = await axios.get('/api/v1/backtest/grid-replay/sources', { params: { userId: 'default' } })
        if (cancelled) return
        const items = (response.data?.sources || []) as GridReplaySource[]
        setSources(items)
        const preferred = items.filter((item) => item.replayReady).sort((left, right) => right.orderCount - left.orderCount)[0] || items[0]
        if (preferred) {
          setSelectedAssetId(preferred.assetId)
          const end = dayjs(preferred.observedThrough || undefined)
          setRange([end.subtract(1, 'year'), end])
        }
      } catch (error) {
        console.error('Failed to load grid replay sources:', error)
        if (!cancelled) message.error('读取当前持仓网格来源失败')
      } finally {
        if (!cancelled) setLoadingSources(false)
      }
    }
    void load()
    return () => { cancelled = true }
  }, [message])

  const selectedSource = sources.find((source) => source.assetId === selectedAssetId) || null

  const runReplay = async (assetId = selectedAssetId, selectedRange = range) => {
    if (!assetId) return
    setRunning(true)
    try {
      const response = await axios.post<GridReplayResult>('/api/v1/backtest/grid-replay', {
        userId: 'default',
        assetId,
        startDate: selectedRange[0].format('YYYY-MM-DD'),
        endDate: selectedRange[1].format('YYYY-MM-DD'),
        commissionRate: 0.0003,
        slippageRate: 0.0005,
      })
      setResult(response.data)
      if (response.data.status === 'available') message.success('已用真实 K 线、保存网格和确认成交生成复盘')
      else message.warning('证据不足，页面已保留真实 K 线并明确阻断原因')
    } catch (error) {
      console.error('Failed to run grid replay:', error)
      message.error((error as any)?.response?.data?.message || '网格复盘失败')
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    if (!selectedAssetId || loadingSources) return
    const key = `${selectedAssetId}:${range[0].format('YYYY-MM-DD')}:${range[1].format('YYYY-MM-DD')}`
    if (autoRunKey.current === key) return
    autoRunKey.current = key
    void runReplay(selectedAssetId, range)
    // Run once for the default real source. Later range changes remain explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSources, selectedAssetId])

  const markerSummary = useMemo(() => ({
    hit: result?.markers.filter((marker) => marker.status === 'hit').length || 0,
    missed: result?.markers.filter((marker) => marker.status === 'missed').length || 0,
    ambiguous: result?.markers.filter((marker) => marker.status === 'ambiguous').length || 0,
    pending: result?.markers.filter((marker) => marker.status === 'pending_data').length || 0,
    insufficient: result?.markers.filter((marker) => marker.status === 'insufficient_intraday_evidence').length || 0,
    blocked: result?.markers.filter((marker) => marker.status.startsWith('blocked_')).length || 0,
    superseded: result?.markers.filter((marker) => marker.status === 'superseded').length || 0,
  }), [result])

  return (
    <Card
      title={<span className="inline-flex items-center gap-2 text-slate-950"><PlainLanguageHelp termId="grid_plan" />历史命中复盘</span>}
      className="border-slate-200 bg-white"
      data-testid="grid-replay-panel"
    >
      <Spin spinning={loadingSources || running}>
        <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3 lg:grid-cols-[minmax(260px,1.4fr)_minmax(260px,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <div className="mb-1 text-xs font-medium text-slate-600">当前持仓</div>
            <Select
              className="fams-grid-replay-source w-full min-w-0 max-w-full"
              value={selectedAssetId || undefined}
              showSearch
              optionFilterProp="label"
              onChange={(value) => {
                setSelectedAssetId(value)
                setResult(null)
                const source = sources.find((item) => item.assetId === value)
                const end = dayjs(source?.observedThrough || undefined)
                setRange([end.subtract(1, 'year'), end])
              }}
              options={sources.map((source) => ({
                value: source.assetId,
                label: `${source.name} ${source.symbol} · ${strategyLabel[source.strategyFamily] || source.strategyFamily} · 网格 ${source.orderCount}`,
              }))}
            />
          </div>
          <div className="min-w-0">
            <div className="mb-1 text-xs font-medium text-slate-600">复盘区间</div>
            <RangePicker className="w-full min-w-0 max-w-full" value={range} onChange={(value) => value?.[0] && value?.[1] && setRange([value[0], value[1]])} />
          </div>
          <Button className="w-full lg:w-auto" type="primary" icon={<ReloadOutlined />} onClick={() => void runReplay()} loading={running}>重新计算</Button>
        </div>

        {selectedSource ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Tag color="blue">{strategyLabel[selectedSource.strategyFamily] || selectedSource.strategyFamily}</Tag>
            <Tag>保存计划 {selectedSource.planCount}</Tag>
            <Tag>网格档位 {selectedSource.orderCount}</Tag>
            <Tag color={selectedSource.replayReady ? 'success' : 'warning'}>{selectedSource.replayReady ? '可复盘' : '证据待补'}</Tag>
            <Tag>行情截至 {selectedSource.observedThrough || '--'}</Tag>
          </div>
        ) : null}

        {result ? (
          <>
            <Alert
              className="mt-4"
              type={result.status === 'available' ? 'success' : 'warning'}
              showIcon
              message={result.status === 'available' ? '真实网格命中复盘可用' : '当前只能展示已有真实证据'}
              description={result.status === 'available'
                ? `实际区间 ${result.actualPeriod.startDate} 至 ${result.actualPeriod.endDate}，未创建任何订单。`
                : `阻断：${result.blockedReasons.join('、') || '历史网格或 OHLC 不足'}。不会用模拟点补齐。`}
            />
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <Card size="small"><Statistic title="网格档位" value={result.markers.length} /></Card>
              <Card size="small"><Statistic title="已命中" value={markerSummary.hit} valueStyle={{ color: '#2563eb' }} /></Card>
              <Card size="small"><Statistic title="未命中" value={markerSummary.missed} /></Card>
              <Card size="small"><Statistic title="时序不确定未计入" value={markerSummary.ambiguous} valueStyle={{ color: '#b45309' }} /></Card>
              <Card size="small"><Statistic title="等待后续行情" value={markerSummary.pending} valueStyle={{ color: '#7c3aed' }} /></Card>
              <Card size="small"><Statistic title="日内证据不足" value={markerSummary.insufficient} valueStyle={{ color: '#ea580c' }} /></Card>
              <Card size="small"><Statistic title="规则阻断" value={markerSummary.blocked} /></Card>
              <Card size="small"><Statistic title="实际成交记录" value={result.dataHealth.actualTransactionCount} /></Card>
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                <div className="font-medium text-slate-950">质量判断：{result.qualityAssessment.verdict}</div>
                <div>相对持有增量收益：{result.qualityAssessment.incrementalReturnVsHoldPercent?.toFixed(2) ?? '--'}%</div>
                <div>最大回撤差：{result.qualityAssessment.maxDrawdownDeltaVsHoldPercent?.toFixed(2) ?? '--'}%</div>
                <div>证据置信度：{(result.qualityAssessment.evidenceConfidence * 100).toFixed(1)}% · 完成周期：{result.qualityAssessment.completedCycles}</div>
                <div className="mt-1 text-xs text-slate-500">{result.qualityAssessment.interpretation}</div>
              </div>
              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-sm leading-6 text-slate-700">
                <div className="font-medium text-slate-950">本次执行口径</div>
                <div>{result.executionRules.settlement} · 整手 {result.executionRules.lotSize} · 价格口径：不复权优先</div>
                <div>佣金 {(result.executionRules.costModel.commissionRate * 100).toFixed(3)}%，最低 {result.executionRules.costModel.minimumCommission.toFixed(2)} 元；滑点 {(result.executionRules.costModel.slippageRate * 100).toFixed(3)}%</div>
                <div>起始现金 {result.inputSnapshot.initialCash.toFixed(2)} 元（{result.inputSnapshot.initialCashSource}）</div>
                <div className="mt-1 text-xs text-slate-500">新计划会终止同一作用域的旧计划；子单只在父单成交后激活。</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Segmented
                value={view}
                onChange={(value) => setView(value as 'kline' | 'return')}
                options={[{ label: 'K 线与网格点', value: 'kline' }, { label: '命中收益曲线', value: 'return' }]}
              />
              <Space wrap size="small">
                <Tag>真实数据：{result.dataHealth.providers.join(' / ') || '无'}</Tag>
                <Tag>去重网格 {result.dataHealth.duplicatePlanOrdersRemoved}</Tag>
                <Tag color="red">正式交易未解锁</Tag>
              </Space>
            </div>
            <div className="mt-3 overflow-hidden rounded border border-slate-200 bg-white p-2">
              {view === 'kline' ? <GridCandlestickChart result={result} /> : <GridReturnChart result={result} />}
            </div>
            {view === 'return' && result.scenarios.length > 0 ? (
              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {result.scenarios.map((scenario) => (
                  <div key={scenario.id} className="rounded border border-slate-200 bg-slate-50 p-3 text-sm">
                    <div className="font-medium text-slate-900">{scenario.label}</div>
                    <div className="mt-2 text-slate-600">累计收益 {scenario.metrics.totalReturnPercent?.toFixed(2) ?? '--'}%</div>
                    <div className="text-slate-600">最大回撤 {scenario.metrics.maxDrawdownPercent?.toFixed(2) ?? '--'}%</div>
                    <div className="text-slate-600">执行事件 {scenario.metrics.executedEventCount}</div>
                    <div className="text-slate-600">完成周期 {scenario.metrics.completedCycles} · 换手 {scenario.metrics.turnoverPercent?.toFixed(2) ?? '--'}%</div>
                    <div className="text-slate-600">费用 {scenario.metrics.totalFees.toFixed(2)} · 平均敞口 {scenario.metrics.averageExposurePercent?.toFixed(2) ?? '--'}%</div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="mt-3 text-xs leading-5 text-slate-500">
              命中规则：开盘前保存的计划可使用当日日 K；盘中计划必须使用生成时刻之后的分钟线，若只有日 K 就标记“日内证据不足”，绝不倒推为命中或未命中；收盘后计划从下一交易时段开始。同日双向触发或父子单先后无法由日 K 证明时，标记为时序不确定且不计入收益。被新计划替代的旧档位不继续生效。
            </div>
          </>
        ) : sources.length === 0 && !loadingSources ? <Empty description="当前没有开放持仓" /> : null}
      </Spin>
    </Card>
  )
}
