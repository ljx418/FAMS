import { useCallback, useEffect, useMemo, useState } from 'react'
import ReactECharts from 'echarts-for-react'
import type { EChartsOption } from 'echarts'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Drawer,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
} from 'antd'
import { FundOutlined, ReloadOutlined, RiseOutlined } from '@ant-design/icons'
import {
  getIndustryCrowdingReport,
  refreshIndustryCrowdingMarketFlow,
  refreshIndustryCrowdingReport,
  type IndustryCrowdingBoard,
  type IndustryCrowdingReport,
} from '../../services/relativeRotationService'

const formatScore = (value: number | null | undefined) => value === null || value === undefined ? '—' : value.toFixed(1)
const formatRatio = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${(value * 100).toFixed(2)}%`
const formatBps = (value: number | null | undefined) => value === null || value === undefined ? '—' : `${(value * 10_000).toFixed(1)} bp`
const formatAmount = (value: number | null | undefined) => value === null || value === undefined
  ? '—'
  : `${value >= 0 ? '+' : ''}${(value / 100_000_000).toFixed(2)}亿`
const latestMetricPoint = (board: IndustryCrowdingBoard, metric: 'behaviorScore' | 'flowCrowdingScore20') =>
  [...board.points].reverse().find((point) => point[metric] !== null) || null

const statusColor: Record<IndustryCrowdingBoard['dataStatus'], string> = {
  ready: 'success',
  partial: 'warning',
  unavailable: 'default',
}

function CrowdingHeatmap({
  title,
  metric,
  boards,
  dates,
  onSelect,
  reducedMotion,
}: {
  title: string
  metric: 'behaviorScore' | 'flowCrowdingScore20'
  boards: IndustryCrowdingBoard[]
  dates: string[]
  onSelect: (code: string) => void
  reducedMotion: boolean
}) {
  const option = useMemo<EChartsOption>(() => {
    const dateIndexByDate = new Map(dates.map((date, index) => [date, index]))
    const isBehavior = metric === 'behaviorScore'
    const values = boards.flatMap((board, boardIndex) => board.points.flatMap((point) => {
      const score = point[metric]
      const actualDateIndex = dateIndexByDate.get(point.date)
      if (score === null || score === undefined || actualDateIndex === undefined) return []
      return [[
        actualDateIndex,
        boardIndex,
        score,
        point.relativeReturn20,
        point.amountExpansion,
        point.volatilityExpansion,
        point.flowIntensity20,
        point.mainNetInflow20,
        point.dailyMainNetInflow,
        point.dailyFlowIntensity,
        point.behaviorEligibleCount,
        point.flowEligibleCount,
      ]]
    }))
    return {
      animation: !reducedMotion,
      animationDuration: 0,
      animationDurationUpdate: reducedMotion ? 0 : 220,
      aria: { enabled: true, label: { description: `${title}热力图，横轴为今年的交易周或交易日，纵轴为东方财富行业板块。` } },
      grid: { left: 112, right: 52, top: 24, bottom: 104 },
      tooltip: {
        position: 'top',
        confine: true,
        backgroundColor: 'rgba(15,23,42,.96)',
        borderWidth: 0,
        textStyle: { color: '#f8fafc', fontSize: 12, lineHeight: 20 },
        formatter: (params: any) => {
          const value = params.value as Array<number | null>
          const board = boards[Number(value?.[1])]
          if (!board || !value) return ''
          const shared = [
            `<b>${board.name}</b> · ${dates[Number(value[0])] || ''}`,
            `${title}&nbsp;&nbsp;<b>${Number(value[2]).toFixed(1)}</b> / 100`,
            `当日可比样本&nbsp;&nbsp;${isBehavior ? Number(value[11] || 0) : Number(value[12] || 0)} 个行业`,
          ]
          const factors = isBehavior ? [
            `20日相对收益&nbsp;&nbsp;${formatRatio(value[3])}`,
            `成交额放大&nbsp;&nbsp;${value[4] == null ? '—' : `${Number(value[4]).toFixed(2)}×`}`,
            `波动放大&nbsp;&nbsp;${value[5] == null ? '—' : `${Number(value[5]).toFixed(2)}×`}`,
          ] : [
            `20日归一化资金流强度&nbsp;&nbsp;${formatRatio(value[6])}`,
            `20日主力净流入（原始金额，非评分）&nbsp;&nbsp;${formatAmount(value[7])}`,
            `当日主力净流入（原始金额）&nbsp;&nbsp;${formatAmount(value[8])}`,
            `当日归一化资金流强度&nbsp;&nbsp;${formatRatio(value[9])}`,
          ]
          return [
            ...shared,
            ...factors,
            '<span style="color:#cbd5e1">点击查看板块明细</span>',
          ].join('<br/>')
        },
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLabel: { color: '#64748b', fontSize: 10, formatter: (value: string) => value.slice(0, 7), hideOverlap: true },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'category',
        data: boards.map((board) => board.name),
        inverse: true,
        axisLabel: { color: '#334155', fontSize: 11, width: 92, overflow: 'truncate' },
        axisLine: { lineStyle: { color: '#cbd5e1' } },
        axisTick: { show: false },
      },
      visualMap: {
        dimension: 2,
        min: 0,
        max: 100,
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 18,
        itemWidth: 14,
        itemHeight: 150,
        text: ['拥挤', '疏散'],
        textStyle: { color: '#64748b', fontSize: 11 },
        inRange: { color: ['#1d4ed8', '#67e8f9', '#fef3c7', '#fb923c', '#b91c1c'] },
      },
      dataZoom: boards.length > 30 ? [
        { type: 'inside', yAxisIndex: 0, startValue: 0, endValue: 29 },
        { type: 'slider', yAxisIndex: 0, right: 8, top: 28, bottom: 102, width: 14, filterMode: 'none' },
      ] : [],
      series: [{
        name: title,
        type: 'heatmap',
        data: values,
        encode: { x: 0, y: 1, value: 2 },
        emphasis: { itemStyle: { borderColor: '#0f172a', borderWidth: 1.2, shadowBlur: 8, shadowColor: 'rgba(15,23,42,.3)' } },
        itemStyle: { borderColor: '#ffffff', borderWidth: 0.7 },
      }],
    }
  }, [boards, dates, metric, reducedMotion, title])

  return (
    <ReactECharts
      option={option}
      notMerge
      lazyUpdate
      style={{ height: 500, width: '100%' }}
      onEvents={{ click: (params: any) => {
        const board = boards[Number(params?.value?.[1])]
        if (board) onSelect(board.code)
      } }}
    />
  )
}

function MarketFlowChart({
  points,
  reducedMotion,
}: {
  points: NonNullable<IndustryCrowdingReport['marketFlow']>['points']
  reducedMotion: boolean
}) {
  const option = useMemo<EChartsOption>(() => ({
    animation: !reducedMotion,
    animationDuration: 0,
    animationDurationUpdate: reducedMotion ? 0 : 220,
    aria: { enabled: true, label: { description: '沪深两市整体主力资金流：柱为每日净流入金额，线为归一化资金流强度。' } },
    grid: { left: 58, right: 62, top: 36, bottom: points.length > 60 ? 78 : 42 },
    legend: { top: 4, data: ['当日主力净流入', '当日归一化强度', '5日均值'] },
    tooltip: {
      trigger: 'axis',
      confine: true,
      formatter: (params: any) => {
        const entries = Array.isArray(params) ? params : [params]
        const index = Number(entries?.[0]?.dataIndex || 0)
        const point = points[index]
        if (!point) return ''
        return [
          `<b>${point.date}</b>`,
          `当日主力净流入&nbsp;&nbsp;${formatAmount(point.mainNetInflow)}`,
          `当日归一化强度&nbsp;&nbsp;${formatBps(point.dailyFlowIntensity)}`,
          `5日平均强度&nbsp;&nbsp;${formatBps(point.fiveDayFlowIntensity)}`,
        ].join('<br/>')
      },
    },
    xAxis: {
      type: 'category',
      data: points.map((point) => point.date),
      axisLabel: { color: '#64748b', fontSize: 10, formatter: (value: string) => value.slice(5), hideOverlap: true },
      axisTick: { show: false },
    },
    yAxis: [
      { type: 'value', name: '亿元', axisLabel: { formatter: (value: number) => `${(value / 100_000_000).toFixed(0)}` }, splitLine: { lineStyle: { type: 'dashed' } } },
      { type: 'value', name: 'bp', axisLabel: { formatter: (value: number) => `${(value * 10_000).toFixed(0)}` }, splitLine: { show: false } },
    ],
    dataZoom: points.length > 60 ? [
      { type: 'inside', start: Math.max(0, 100 - (120 / points.length) * 100), end: 100 },
      { type: 'slider', bottom: 8, height: 18, start: Math.max(0, 100 - (120 / points.length) * 100), end: 100 },
    ] : [],
    series: [
      {
        name: '当日主力净流入', type: 'bar', yAxisIndex: 0,
        data: points.map((point) => ({ value: point.mainNetInflow, itemStyle: { color: (point.mainNetInflow || 0) >= 0 ? '#dc2626' : '#16a34a' } })),
      },
      { name: '当日归一化强度', type: 'line', yAxisIndex: 1, data: points.map((point) => point.dailyFlowIntensity), showSymbol: false, lineStyle: { color: '#2563eb', width: 1.5, type: 'dashed' } },
      { name: '5日均值', type: 'line', yAxisIndex: 1, data: points.map((point) => point.fiveDayFlowIntensity), showSymbol: false, smooth: 0.25, lineStyle: { color: '#7c3aed', width: 2.4 } },
    ],
  }), [points, reducedMotion])
  return <ReactECharts option={option} notMerge lazyUpdate style={{ height: 390, width: '100%' }} />
}

function DetailChart({ board, reducedMotion }: { board: IndustryCrowdingBoard; reducedMotion: boolean }) {
  const option = useMemo<EChartsOption>(() => ({
    animation: !reducedMotion,
    animationDuration: 0,
    grid: { left: 44, right: 20, top: 32, bottom: 46 },
    tooltip: {
      trigger: 'axis',
      confine: true,
      valueFormatter: (value: unknown) => `${Number(value).toFixed(1)} 分`,
    },
    legend: { top: 2, data: ['交易行为拥挤度', '20日资金流拥挤度'] },
    xAxis: { type: 'category', data: board.points.map((point) => point.date), axisLabel: { formatter: (value: string) => value.slice(5), fontSize: 10 } },
    yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value}' }, splitLine: { lineStyle: { type: 'dashed' } } },
    series: [
      { name: '交易行为拥挤度', type: 'line', data: board.points.map((point) => point.behaviorScore), smooth: 0.2, showSymbol: false, lineStyle: { width: 2.5, color: '#dc2626' }, itemStyle: { color: '#dc2626' }, markLine: { silent: true, label: { formatter: '50 分' }, lineStyle: { type: 'dashed', color: '#94a3b8' }, data: [{ yAxis: 50 }] } },
      { name: '20日资金流拥挤度', type: 'line', data: board.points.map((point) => point.flowCrowdingScore20), smooth: 0.2, showSymbol: false, lineStyle: { width: 2.5, color: '#2563eb' }, itemStyle: { color: '#2563eb' } },
    ],
  }), [board, reducedMotion])
  return <ReactECharts option={option} notMerge style={{ height: 330, width: '100%' }} />
}

export function IndustryCrowdingWorkbench({ reducedMotion }: { reducedMotion: boolean }) {
  const { message } = AntApp.useApp()
  const [frequency, setFrequency] = useState<'weekly' | 'daily'>('weekly')
  const [timeWindow, setTimeWindow] = useState<'20' | '60' | '120' | 'ytd'>('120')
  const [report, setReport] = useState<IndustryCrowdingReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [marketRefreshing, setMarketRefreshing] = useState(false)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<'behavior' | 'flow' | 'name'>('behavior')
  const [selectedCode, setSelectedCode] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setReport(await getIndustryCrowdingReport({ frequency }))
    } catch (error) {
      message.error(error instanceof Error ? error.message : '板块拥挤度加载失败')
    } finally {
      setLoading(false)
    }
  }, [frequency, message])

  useEffect(() => { void load() }, [load])

  const refresh = async () => {
    setRefreshing(true)
    try {
      const result = await refreshIndustryCrowdingReport(report?.year)
      message.success(`已更新价格 ${result.refreshedBoards}/${result.requestedBoards} 个；双口径可绘制 ${result.readyBoards} 个；沪深两市背景 ${result.marketFlow.pointCount} 日`)
      if (result.incompleteBoards.length) message.warning(`${result.incompleteBoards.length} 个板块仍缺价格或资金流，页面已保留具体状态而不会把它们计作成功`)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '行业数据刷新失败')
    } finally {
      setRefreshing(false)
    }
  }

  const refreshMarketFlow = async () => {
    setMarketRefreshing(true)
    try {
      const result = await refreshIndustryCrowdingMarketFlow()
      if (!result.refreshed) throw new Error(result.warning || '沪深两市资金流未返回有效数据')
      message.success(`沪深两市资金流已更新：${result.pointCount} 个交易日`)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '沪深两市资金流刷新失败')
    } finally {
      setMarketRefreshing(false)
    }
  }

  const visibleBoards = useMemo(() => {
      const keyword = search.trim().toLowerCase()
    return [...(report?.boards || [])]
      .filter((board) => !keyword || board.name.toLowerCase().includes(keyword) || board.code.toLowerCase().includes(keyword))
      .sort((left, right) => {
        if (sortBy === 'name') return left.name.localeCompare(right.name, 'zh-CN')
        const metric = sortBy === 'behavior' ? 'behaviorScore' : 'flowCrowdingScore20'
        return (latestMetricPoint(right, metric)?.[metric] ?? -Infinity) - (latestMetricPoint(left, metric)?.[metric] ?? -Infinity)
      })
  }, [report?.boards, search, sortBy])

  const allDates = useMemo(() => Array.from(new Set(visibleBoards.flatMap((board) => board.points.map((point) => point.date)))).sort(), [visibleBoards])
  const dates = useMemo(() => {
    if (timeWindow === 'ytd') return allDates
    return allDates.slice(-Number(timeWindow))
  }, [allDates, timeWindow])
  const behaviorBoards = useMemo(() => visibleBoards.filter((board) => board.points.some((point) => dates.includes(point.date) && point.behaviorScore !== null)), [dates, visibleBoards])
  const flowBoards = useMemo(() => visibleBoards.filter((board) => board.points.some((point) => dates.includes(point.date) && point.flowCrowdingScore20 !== null)), [dates, visibleBoards])
  const marketFlowPoints = useMemo(() => {
    const startDate = dates[0]
    const endDate = dates[dates.length - 1]
    if (!startDate || !endDate) return []
    return (report?.marketFlow.points || []).filter((point) => point.date >= startDate && point.date <= endDate)
  }, [dates, report?.marketFlow.points])
  const selectedBoard = useMemo(() => report?.boards.find((board) => board.code === selectedCode) || null, [report?.boards, selectedCode])
  const selectedBehaviorPoint = selectedBoard ? latestMetricPoint(selectedBoard, 'behaviorScore') : null
  const selectedFlowPoint = selectedBoard ? latestMetricPoint(selectedBoard, 'flowCrowdingScore20') : null

  const summaryItem = (kind: 'highestBehavior' | 'highestFlow' | 'largestDivergence') => report?.summaries[kind]

  return (
    <section className="space-y-4" aria-label="A股行业资金拥挤度研究">
      <Card
        title={<Space><FundOutlined className="text-blue-600" /><span>A股行业资金拥挤度</span><Tag color="blue">东方财富行业板块</Tag></Space>}
        extra={<Button icon={<ReloadOutlined />} loading={refreshing} onClick={() => void refresh()}>刷新行业数据</Button>}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm leading-6 text-slate-600">
            以公开行业行情、成交额和主力资金流观察今年的拥挤迁移。评分、原始净流入和当日归一化强度分层展示；它们不代表基金申赎或机构真实持仓。
          </div>
          <Space wrap>
            <Segmented
              value={frequency}
              options={[{ label: '周频热力图', value: 'weekly' }, { label: '日频热力图', value: 'daily' }]}
              onChange={(value) => setFrequency(value as 'weekly' | 'daily')}
              aria-label="行业拥挤度频率"
            />
            <Segmented
              value={timeWindow}
              options={[{ label: '20期', value: '20' }, { label: '60期', value: '60' }, { label: '120期', value: '120' }, { label: '年初至今', value: 'ytd' }]}
              onChange={(value) => setTimeWindow(value as '20' | '60' | '120' | 'ytd')}
              aria-label="板块拥挤度时间窗口"
            />
          </Space>
        </div>
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message="口径说明"
          description={report?.methodology.provider || '当前尚无缓存；刷新后将使用东方财富行业板块的价格、成交额与主力资金流计算。'}
        />
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="行业覆盖" value={report?.boardCount || 0} suffix="个" /><div className="mt-1 text-xs text-slate-500">双口径可绘制 {report?.readyCount || 0} · 单口径 {report?.partialCount || 0} · 待补齐 {report?.unavailableCount || 0}</div></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="交易热度最高" value={summaryItem('highestBehavior')?.name || '—'} valueStyle={{ fontSize: 18, color: '#dc2626' }} /><div className="mt-1 text-xs text-slate-500">{formatScore(summaryItem('highestBehavior')?.score)} / 100</div></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="20日资金流最拥挤" value={summaryItem('highestFlow')?.name || '—'} valueStyle={{ fontSize: 18, color: '#2563eb' }} /><div className="mt-1 text-xs text-slate-500">{formatScore(summaryItem('highestFlow')?.score)} / 100</div></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="信号背离最大" value={summaryItem('largestDivergence')?.name || '—'} valueStyle={{ fontSize: 18, color: '#a16207' }} /><div className="mt-1 text-xs text-slate-500">分歧 {formatScore(summaryItem('largestDivergence')?.score)} 分</div></Card></Col>
      </Row>

      <Card
        title={<Space><RiseOutlined className="text-red-600" /><span>交易行为拥挤度</span><Tooltip title="20日相对沪深300收益40% + 20/60日成交额放大40% + 20/60日波动放大20%。仅在三项因子同时可用的行业中每天横截面排名。"><Tag>透明公式</Tag></Tooltip></Space>}
        extra={<span className="text-xs text-slate-500">截止 {report?.asOfDates?.behavior || report?.asOfDate || '—'} · 可比 {report?.coverageByDate.find((item) => item.date === report?.asOfDates?.behavior)?.behaviorEligibleCount || 0} 个 · 点击热力格查看明细</span>}
        styles={{ body: { padding: '8px 0 0' } }}
      >
        {loading ? <div className="flex h-[500px] items-center justify-center"><Spin size="large" /></div> : behaviorBoards.length
          ? <CrowdingHeatmap title="交易行为拥挤度" metric="behaviorScore" boards={behaviorBoards} dates={dates} onSelect={setSelectedCode} reducedMotion={reducedMotion} />
          : <Empty className="py-24" description="尚无可绘制的交易行为数据，请先刷新行业数据" />}
      </Card>

      <Card
        title={<Space><FundOutlined className="text-blue-600" /><span>20日资金流拥挤度</span><Tooltip title="近20日主力净流入占近20日成交额的比例，每天按行业横截面排名。颜色只映射0–100分位，原始净流入金额不会参与评分。"><Tag color="blue">归一化分位</Tag></Tooltip></Space>}
        extra={<span className="text-xs text-slate-500">截止 {report?.asOfDates?.capitalFlow || report?.asOfDate || '—'} · 可比 {report?.coverageByDate.find((item) => item.date === report?.asOfDates?.capitalFlow)?.flowEligibleCount || 0} 个 · 高分不代表基金申赎</span>}
        styles={{ body: { padding: '8px 0 0' } }}
      >
        {loading ? <div className="flex h-[500px] items-center justify-center"><Spin size="large" /></div> : flowBoards.length
          ? <CrowdingHeatmap title="20日资金流拥挤度" metric="flowCrowdingScore20" boards={flowBoards} dates={dates} onSelect={setSelectedCode} reducedMotion={reducedMotion} />
          : <Empty className="py-24" description="资金流历史尚不可用；交易行为图仍可作为独立研究参考" />}
      </Card>

      <Card
        title={<Space><FundOutlined className="text-violet-600" /><span>沪深两市整体资金流</span><Tag color="purple">独立市场口径</Tag></Space>}
        extra={<Space><span className="text-xs text-slate-500">日频 · 截止 {report?.asOfDates?.marketFlow || '—'} · 不含北交所</span><Button size="small" icon={<ReloadOutlined />} loading={marketRefreshing} onClick={() => void refreshMarketFlow()}>刷新大盘资金流</Button></Space>}
        styles={{ body: { padding: '8px 0 0' } }}
      >
        <Alert
          className="mx-4 mt-2"
          type="info"
          showIcon
          message="柱状图为原始当日主力净流入金额；两条线为按成交额归一化后的强度（右轴，bp）。"
        />
        {!loading && marketFlowPoints.length > 0 && marketFlowPoints.length < 20 ? <Alert className="mx-4 mt-2" type="warning" showIcon message="当前上游历史接口受限，仅显示已验证的最新市场快照；后续刷新会自动累积，不会用行业板块相加伪造历史。" /> : null}
        {loading ? <div className="flex h-[390px] items-center justify-center"><Spin size="large" /></div> : marketFlowPoints.length
          ? <MarketFlowChart points={marketFlowPoints} reducedMotion={reducedMotion} />
          : <Empty className="py-20" description="沪深两市资金流缓存尚不可用；请刷新行业数据" />}
      </Card>

      <Card size="small">
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <Input value={search} onChange={(event) => setSearch(event.target.value)} allowClear placeholder="筛选行业名称或 BK 代码" aria-label="筛选行业" />
          <Select
            value={sortBy}
            onChange={(value) => setSortBy(value)}
            options={[{ value: 'behavior', label: '按交易热度排序' }, { value: 'flow', label: '按资金流排序' }, { value: 'name', label: '按行业名称排序' }]}
            aria-label="行业排序"
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {visibleBoards.map((board) => <Button key={board.code} size="small" onClick={() => setSelectedCode(board.code)}>
            {board.name}
            <Tag color={statusColor[board.dataStatus]}>交 {formatScore(latestMetricPoint(board, 'behaviorScore')?.behaviorScore)}</Tag>
            <Tag color="blue">流 {formatScore(latestMetricPoint(board, 'flowCrowdingScore20')?.flowCrowdingScore20)}</Tag>
          </Button>)}
        </div>
      </Card>

      {report?.warnings.map((warning) => <Alert key={warning} type="warning" showIcon message={warning} />)}

      <Drawer
        title={selectedBoard ? `${selectedBoard.name} · 拥挤度明细` : '行业拥挤度明细'}
        width={Math.min(760, typeof window === 'undefined' ? 760 : window.innerWidth - 24)}
        open={Boolean(selectedBoard)}
        onClose={() => setSelectedCode(null)}
      >
        {selectedBoard && (
          <Space direction="vertical" className="w-full" size="large">
            <div className="flex flex-wrap items-center gap-2">
              <Tag>{selectedBoard.code}</Tag>
              <Tag color={statusColor[selectedBoard.dataStatus]}>{selectedBoard.dataStatus === 'ready' ? '双口径可用' : selectedBoard.dataStatus === 'partial' ? '部分数据可用' : '数据待补齐'}</Tag>
              <Tag>价格：{selectedBoard.priceStatus}</Tag><Tag color="blue">资金流：{selectedBoard.flowStatus}</Tag>
              {selectedBoard.sourceProviders.map((provider) => <Tag key={provider}>{provider}</Tag>)}
            </div>
            <DetailChart board={selectedBoard} reducedMotion={reducedMotion} />
            <Card size="small" title="最新计算因子">
              <Row gutter={[12, 12]}>
                <Col span={12}><Statistic title={`交易行为（${selectedBehaviorPoint?.date || '—'}）`} value={formatScore(selectedBehaviorPoint?.behaviorScore)} suffix="/ 100" /></Col>
                <Col span={12}><Statistic title={`20日资金流（${selectedFlowPoint?.date || '—'}）`} value={formatScore(selectedFlowPoint?.flowCrowdingScore20)} suffix="/ 100" /></Col>
                <Col span={12}><Statistic title="20日相对收益" value={formatRatio(selectedBehaviorPoint?.relativeReturn20)} /></Col>
                <Col span={12}><Statistic title="成交额放大" value={selectedBehaviorPoint?.amountExpansion === null || selectedBehaviorPoint?.amountExpansion === undefined ? '—' : `${selectedBehaviorPoint.amountExpansion.toFixed(2)}×`} /></Col>
                <Col span={12}><Statistic title="波动放大" value={selectedBehaviorPoint?.volatilityExpansion === null || selectedBehaviorPoint?.volatilityExpansion === undefined ? '—' : `${selectedBehaviorPoint.volatilityExpansion.toFixed(2)}×`} /></Col>
                <Col span={12}><Statistic title="20日资金流强度" value={formatRatio(selectedFlowPoint?.flowIntensity20)} /></Col>
                <Col span={12}><Statistic title="20日主力净流入（原始金额，非评分）" value={formatAmount(selectedFlowPoint?.mainNetInflow20)} /></Col>
                <Col span={12}><Statistic title="当日主力净流入（原始金额）" value={formatAmount(selectedFlowPoint?.dailyMainNetInflow)} /></Col>
                <Col span={12}><Statistic title="当日归一化资金流强度" value={formatRatio(selectedFlowPoint?.dailyFlowIntensity)} /></Col>
              </Row>
            </Card>
            {selectedBoard.lastError ? <Alert type="warning" showIcon message="数据补全状态" description={selectedBoard.lastError} /> : null}
            <Alert type="info" showIcon message="研究边界" description="分数比较的是同一日期各东方财富行业板块的相对热度。20日原始净流入和当日净流入仅用于解释，不是评分。它不是申万行业分类、基金申赎数据、机构持仓披露，也不生成买卖建议。" />
          </Space>
        )}
      </Drawer>
    </section>
  )
}
