import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Progress,
  Row,
  Segmented,
  Select,
  Slider,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  message,
} from 'antd'
import {
  BarChartOutlined,
  CaretRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  PauseOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
} from '@ant-design/icons'
import { RotationChart } from '../components/relative-rotation/RotationChart'
import {
  activateSleeve,
  confirmVolatilityDraft,
  dismissVolatilityDraft,
  getOperation,
  getRotationHoldings,
  getRotationTimeline,
  refreshRotationTimeline,
  runRotationBacktest,
  runVolatilityDailyAnalysis,
  transferSleeve,
  type OperationDto,
  type RotationHoldingItem,
  type RotationHoldingsReport,
  type RotationTimelineReport,
} from '../services/relativeRotationService'

const quadrantMeta = {
  leading: { label: '领先', color: '#15803d' },
  weakening: { label: '弱化', color: '#b45309' },
  lagging: { label: '落后', color: '#b91c1c' },
  improving: { label: '改善', color: '#1d4ed8' },
}

const formatMoney = (value?: number | null) => `¥${Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`
const formatQuantity = (value?: number | null) => Number(value || 0).toLocaleString('zh-CN', { maximumFractionDigits: 4 })
const formatPercent = (value?: number | null) => `${Number(value || 0).toFixed(1)}%`

const operationIdOf = (operation: OperationDto) => operation.operationId || operation.id || ''
const terminalOperationStatuses = new Set(['completed', 'succeeded', 'partial', 'failed', 'cancelled'])

export default function RelativeRotation() {
  const [frequency, setFrequency] = useState<'weekly' | 'daily'>('weekly')
  const [report, setReport] = useState<RotationHoldingsReport | null>(null)
  const [timeline, setTimeline] = useState<RotationTimelineReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [workingLabel, setWorkingLabel] = useState('')
  const [operationProgress, setOperationProgress] = useState(0)
  const [selectedItem, setSelectedItem] = useState<RotationHoldingItem | null>(null)
  const [activationOpen, setActivationOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [headIndex, setHeadIndex] = useState(0)
  const [tailLengths, setTailLengths] = useState({ weekly: 12, daily: 20 })
  const [playing, setPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<0.5 | 1 | 2>(1)
  const [reducedMotion, setReducedMotion] = useState(false)
  const headDateRef = useRef('')
  const automaticRefreshAttempted = useRef(false)
  const [activationForm] = Form.useForm()
  const [transferForm] = Form.useForm()
  const [confirmForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextReport, nextTimeline] = await Promise.all([
        getRotationHoldings(frequency, frequency === 'weekly' ? 12 : 20),
        getRotationTimeline(frequency, 8),
      ])
      setReport(nextReport)
      setTimeline(nextTimeline)
      const preservedDate = headDateRef.current
      const preservedIndex = preservedDate
        ? nextTimeline.dates.reduce((best, date, index) => date <= preservedDate ? index : best, 0)
        : nextTimeline.dates.length - 1
      setHeadIndex(Math.max(0, preservedIndex))
    } catch (error) {
      console.error(error)
      message.error('相对轮动数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [frequency])

  useEffect(() => {
    void load()
  }, [load])

  const timelineDates = timeline?.dates || []
  const headDate = timelineDates[headIndex] || ''
  const tailLength = tailLengths[frequency]

  useEffect(() => {
    headDateRef.current = headDate
  }, [headDate])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReducedMotion(media.matches)
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) setPlaying(false)
    }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => document.removeEventListener('visibilitychange', pauseWhenHidden)
  }, [])

  useEffect(() => {
    if (!playing || timelineDates.length < 2) return
    const delay = playbackSpeed === 0.5 ? 800 : playbackSpeed === 2 ? 220 : 450
    const timer = window.setInterval(() => {
      setHeadIndex((current) => {
        if (current >= timelineDates.length - 1) {
          setPlaying(false)
          return current
        }
        return current + 1
      })
    }, delay)
    return () => window.clearInterval(timer)
  }, [playbackSpeed, playing, timelineDates.length])

  const waitForOperation = async (operation: OperationDto) => {
    const operationId = operationIdOf(operation)
    if (!operationId) throw new Error('任务未返回 operationId')
    const startedAt = Date.now()
    let current = operation
    while (!terminalOperationStatuses.has(current.status)) {
      if (Date.now() - startedAt > 12 * 60 * 1000) throw new Error('任务仍在运行，请前往任务中心查看')
      await new Promise((resolve) => setTimeout(resolve, 1500))
      current = await getOperation(operationId)
      setOperationProgress(current.progressPct || 0)
    }
    if (current.status === 'failed' || current.status === 'cancelled') {
      throw new Error(current.progressMessage || '任务执行失败')
    }
    return current
  }

  const runTrackedOperation = async (label: string, start: () => Promise<OperationDto>) => {
    setWorkingLabel(label)
    setOperationProgress(2)
    try {
      const operation = await start()
      await waitForOperation(operation)
      message.success(`${label}完成`)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : `${label}失败`)
    } finally {
      setWorkingLabel('')
      setOperationProgress(0)
    }
  }

  useEffect(() => {
    if (!timeline?.refreshRecommended || automaticRefreshAttempted.current || workingLabel) return
    automaticRefreshAttempted.current = true
    const key = `rrg-timeline-refresh:default:8:${new Date().toISOString().slice(0, 10)}`
    void runTrackedOperation('补齐 8 年轮动历史', () => refreshRotationTimeline(8, key))
    // runTrackedOperation is intentionally excluded: this gate runs once per page visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeline?.refreshRecommended, workingLabel])

  const timelineItems = timeline?.items || []
  const activeAtHead = useMemo(
    () => timelineItems.filter((item) => item.points.some((point) => point.date <= headDate)).length,
    [headDate, timelineItems],
  )
  const readyCount = report?.items.filter((item) => item.rotation?.dataStatus === 'ready').length || 0
  const activeSleeves = report?.items.filter((item) => item.allocation?.status === 'active').length || 0
  const pendingDrafts = report?.items.filter((item) => item.latestDraft?.status === 'pending').length || 0

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (headIndex >= timelineDates.length - 1) setHeadIndex(0)
    setPlaying(true)
  }

  const openActivation = (item: RotationHoldingItem) => {
    if (!item.latestBacktest) return
    setSelectedItem(item)
    activationForm.setFieldsValue({
      ratio: item.latestBacktest.recommendedRatio,
      profile: item.latestBacktest.recommendedProfile,
    })
    setActivationOpen(true)
  }

  const openTransfer = (item: RotationHoldingItem) => {
    setSelectedItem(item)
    transferForm.resetFields()
    transferForm.setFieldsValue({ direction: 'core_to_volatility' })
    setTransferOpen(true)
  }

  const openConfirm = (item: RotationHoldingItem) => {
    if (!item.latestDraft) return
    setSelectedItem(item)
    confirmForm.setFieldsValue({
      quantity: item.latestDraft.suggestedQuantity,
      price: item.latestDraft.timing.close || item.position.currentPrice,
      fee: 0,
    })
    setConfirmOpen(true)
  }

  const submitActivation = async () => {
    if (!selectedItem?.latestBacktest) return
    const values = await activationForm.validateFields()
    try {
      await activateSleeve(selectedItem.positionId, {
        backtestId: selectedItem.latestBacktest.id,
        confirmedRatio: values.ratio,
        strategyProfile: values.profile,
      })
      message.success('核心仓/波动仓拆分已确认')
      setActivationOpen(false)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '拆仓确认失败')
    }
  }

  const submitTransfer = async () => {
    if (!selectedItem?.allocation) return
    const values = await transferForm.validateFields()
    try {
      await transferSleeve(selectedItem.positionId, {
        direction: values.direction,
        amount: values.amount,
        expectedVersion: selectedItem.allocation.version,
        notes: values.notes,
      })
      message.success('分仓划转已记录')
      setTransferOpen(false)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '分仓划转失败')
    }
  }

  const submitDraftConfirmation = async () => {
    if (!selectedItem?.latestDraft) return
    const values = await confirmForm.validateFields()
    try {
      await confirmVolatilityDraft(selectedItem.latestDraft.id, values)
      message.success('实际成交已写入波动仓台账')
      setConfirmOpen(false)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '成交确认失败')
    }
  }

  return (
    <div className="relative-rotation-page min-w-0 space-y-5">
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:px-7">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Tag color="blue">研究模块</Tag>
              <Tag>当前持仓优先</Tag>
              <Tag color="gold">人工确认</Tag>
            </div>
            <h1 className="m-0 text-2xl font-semibold tracking-tight text-slate-950 md:text-3xl">相对轮动与波动仓</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              用共同基准识别持仓的相对趋势环境，再用价格波动条件管理同一标的内部的波动仓。核心仓不会被每日分析修改。
            </p>
          </div>
          <Space wrap>
            <Button icon={<ExperimentOutlined />} disabled={Boolean(workingLabel)} onClick={() => void runTrackedOperation('持仓回测', () => runRotationBacktest())}>
              回测全部持仓
            </Button>
            <Button type="primary" icon={<BarChartOutlined />} disabled={Boolean(workingLabel)} onClick={() => void runTrackedOperation('每日波动仓分析', runVolatilityDailyAnalysis)}>
              运行每日分析
            </Button>
            <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} aria-label="刷新页面数据" />
          </Space>
        </div>
        {workingLabel && (
          <div className="border-t border-slate-100 bg-slate-50 px-5 py-3 lg:px-7">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
              <span>{workingLabel}执行中；正在补齐真实行情或计算证据</span>
              <span>{operationProgress}%</span>
            </div>
            <Progress percent={operationProgress} size="small" showInfo={false} strokeColor="#2563eb" />
          </div>
        )}
      </section>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="合格持仓" value={report?.eligibleCount || 0} suffix="个" /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="轮动数据就绪" value={readyCount} suffix="个" valueStyle={{ color: '#1d4ed8' }} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="已启用波动仓" value={activeSleeves} suffix="个" valueStyle={{ color: '#0f766e' }} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="待确认草稿" value={pendingDrafts} suffix="个" valueStyle={{ color: pendingDrafts ? '#b45309' : '#334155' }} /></Card></Col>
      </Row>

      <Card
        title={<Space><SafetyCertificateOutlined className="text-blue-600" /><span>数据与计算口径</span></Space>}
        size="small"
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 5 }}>
          <Descriptions.Item label="资产集合">当前持仓 A股 / 场内ETF</Descriptions.Item>
          <Descriptions.Item label="共同基准">{report?.benchmark.name || '沪深300'} · 价格指数</Descriptions.Item>
          <Descriptions.Item label="资产价格">前复权 qfq</Descriptions.Item>
          <Descriptions.Item label="公式">transparent v1</Descriptions.Item>
          <Descriptions.Item label="历史范围">最长 8 年 · 含指标预热期</Descriptions.Item>
        </Descriptions>
        <Alert
          className="mt-3"
          type="info"
          showIcon
          message="图表比较相对表现，不代表绝对收益；沪深300为价格指数，所有草稿均需人工录入实际成交。"
        />
      </Card>

      <Card
        title={(
          <div>
            <Space><SwapOutlined className="text-blue-600" /><span>当前持仓相对轮动</span></Space>
            <div className="mt-1 text-xs font-normal text-slate-500">拖动头部日期，或播放完整时间序列，观察持仓如何穿越四个象限。</div>
          </div>
        )}
        extra={(
          <Segmented
            value={frequency}
            options={[{ label: '周频轨迹', value: 'weekly' }, { label: '日频观察', value: 'daily' }]}
            onChange={(value) => {
              setPlaying(false)
              setFrequency(value as 'weekly' | 'daily')
            }}
          />
        )}
        styles={{ body: { padding: 0 } }}
      >
        {loading && !timeline ? (
          <div className="flex h-[560px] items-center justify-center"><Spin size="large" /></div>
        ) : timelineDates.length > 0 && headDate ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
                <span><strong className="text-slate-900">{headDate}</strong> 头部日期</span>
                <span><strong className="text-slate-900">{activeAtHead}</strong> / {timeline?.eligibleCount || 0} 个标的已上市</span>
                <span><strong className="text-slate-900">{timeline?.availableDateCount || 0}</strong> 个可播放节点</span>
                <span>{timeline?.visibleRange.startDate} — {timeline?.visibleRange.endDate}</span>
              </div>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                disabled={Boolean(workingLabel)}
                onClick={() => void runTrackedOperation('刷新 8 年轮动历史', () => refreshRotationTimeline(8))}
              >
                智能换源刷新
              </Button>
            </div>
            <div className="px-1 sm:px-3">
              <RotationChart
                items={timelineItems}
                headDate={headDate}
                tailLength={tailLength}
                loading={loading}
                reducedMotion={reducedMotion}
              />
            </div>
            <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 sm:px-6">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_250px] xl:items-end">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">头部时间</div>
                      <time className="mt-1 block font-mono text-sm font-semibold text-slate-950" dateTime={headDate}>{headDate}</time>
                    </div>
                    <Space size="small">
                      <Button
                        shape="circle"
                        type="primary"
                        aria-label={playing ? '暂停轮动动画' : '播放轮动动画'}
                        icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
                        onClick={togglePlayback}
                      />
                      <Segmented
                        size="small"
                        aria-label="播放速度"
                        value={playbackSpeed}
                        options={[{ label: '0.5×', value: 0.5 }, { label: '1×', value: 1 }, { label: '2×', value: 2 }]}
                        onChange={(value) => setPlaybackSpeed(value as 0.5 | 1 | 2)}
                      />
                      <Button size="small" disabled={headIndex === timelineDates.length - 1} onClick={() => {
                        setPlaying(false)
                        setHeadIndex(timelineDates.length - 1)
                      }}>最新</Button>
                    </Space>
                  </div>
                  <Slider
                    min={0}
                    max={Math.max(0, timelineDates.length - 1)}
                    value={headIndex}
                    step={1}
                    marks={timelineDates.length > 1 ? {
                      0: timelineDates[0]?.slice(0, 7),
                      [timelineDates.length - 1]: timelineDates[timelineDates.length - 1]?.slice(0, 7),
                    } : undefined}
                    tooltip={{ formatter: (value) => timelineDates[Number(value || 0)] || '' }}
                    onChange={(value) => {
                      setPlaying(false)
                      setHeadIndex(value)
                    }}
                    aria-label="轮动图头部日期"
                  />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">尾巴长度</span>
                    <span className="font-mono text-slate-500">{tailLength} {frequency === 'weekly' ? '周' : '日'}</span>
                  </div>
                  <Slider
                    min={frequency === 'weekly' ? 4 : 5}
                    max={frequency === 'weekly' ? 52 : 120}
                    value={tailLength}
                    tooltip={{ formatter: (value) => `${value} ${frequency === 'weekly' ? '周' : '日'}` }}
                    onChange={(value) => setTailLengths((current) => ({ ...current, [frequency]: value }))}
                    aria-label="轨迹尾巴长度"
                  />
                  <div className="text-[11px] leading-4 text-slate-500">尾巴越长，越容易看清完整轮动方向；播放时只移动头部。</div>
                </div>
              </div>
              {reducedMotion && <div className="mt-3 text-xs text-slate-500">已遵循系统“减少动态效果”设置：时间仍会推进，图形过渡已关闭。</div>}
            </div>
          </>
        ) : (
          <div className="flex h-[420px] items-center justify-center px-6">
            <Empty description="尚无可绘制的前复权轮动轨迹；请使用智能换源刷新补齐历史行情。">
              <Button type="primary" loading={Boolean(workingLabel)} onClick={() => void runTrackedOperation('补齐 8 年轮动历史', () => refreshRotationTimeline(8))}>
                补齐 8 年历史
              </Button>
            </Empty>
          </div>
        )}
      </Card>

      <section className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <h2 className="m-0 text-lg font-semibold text-slate-950">持仓分仓与策略证据</h2>
            <p className="mb-0 mt-1 text-sm text-slate-500">每个标的单独管理核心证券、波动证券与波动现金。</p>
          </div>
          <Tag>{report?.items.length || 0} 个持仓</Tag>
        </div>

        {report?.items.map((item) => {
          const latestPoint = item.rotation?.points[item.rotation.points.length - 1]
          const quadrant = latestPoint ? quadrantMeta[latestPoint.quadrant] : null
          const backtest = item.latestBacktest
          const draft = item.latestDraft?.status === 'pending' ? item.latestDraft : null
          return (
            <Card key={item.positionId} className="overflow-hidden" styles={{ body: { padding: 0 } }}>
              <div className="grid min-w-0 gap-4 p-4 lg:grid-cols-[minmax(220px,1.2fr)_minmax(280px,1.4fr)_minmax(260px,1fr)] lg:p-5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base font-semibold text-slate-950">{item.name}</span>
                    <span className="font-mono text-xs text-slate-500">{item.symbol}</span>
                    {quadrant && <Tag color={quadrant.color}>{quadrant.label}</Tag>}
                    {!item.eligible && <Tag>暂不支持</Tag>}
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div><div className="text-xs text-slate-500">总数量</div><div className="mt-1 font-medium text-slate-900">{formatQuantity(item.position.quantity)}</div></div>
                    <div><div className="text-xs text-slate-500">总市值</div><div className="mt-1 font-medium text-slate-900">{formatMoney(item.position.marketValue)}</div></div>
                    <div><div className="text-xs text-slate-500">共同截止日</div><div className="mt-1 text-slate-700">{item.rotation?.commonAsOfDate || '--'}</div></div>
                    <div><div className="text-xs text-slate-500">历史样本</div><div className="mt-1 text-slate-700">{item.rotation?.sampleDays || 0} 日</div></div>
                  </div>
                </div>

                <div className="rounded-xl bg-slate-50 p-4">
                  {item.allocation ? (
                    <>
                      <div className="mb-3 flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-900">仓内分层</span>
                        <Tag color={Math.abs(item.allocation.invariantDelta) < 0.0001 ? 'success' : 'error'}>
                          {Math.abs(item.allocation.invariantDelta) < 0.0001 ? '数量守恒' : '需要对账'}
                        </Tag>
                      </div>
                      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                        <div><span className="text-slate-500">核心仓</span><div className="mt-1 font-semibold text-slate-900">{formatQuantity(item.allocation.coreQuantity)}</div></div>
                        <div><span className="text-slate-500">波动证券</span><div className="mt-1 font-semibold text-slate-900">{formatQuantity(item.allocation.volatilityQuantity)}</div></div>
                        <div><span className="text-slate-500">波动现金</span><div className="mt-1 font-semibold text-slate-900">{formatMoney(item.allocation.volatilityCash)}</div></div>
                        <div><span className="text-slate-500">波动仓净值</span><div className="mt-1 font-semibold text-slate-900">{formatMoney(item.allocation.volatilityNav)}</div></div>
                        <div><span className="text-slate-500">累计收益归因</span><div className={`mt-1 font-semibold ${item.allocation.volatilityTotalPnl >= 0 ? 'text-red-600' : 'text-emerald-700'}`}>{formatMoney(item.allocation.volatilityTotalPnl)}</div></div>
                        <div><span className="text-slate-500">确认比例</span><div className="mt-1 font-semibold text-slate-900">{formatPercent(item.allocation.confirmedRatio * 100)}</div></div>
                      </div>
                    </>
                  ) : (
                    <div className="flex h-full min-h-36 flex-col justify-center">
                      <div className="text-sm font-medium text-slate-900">尚未拆分核心仓与波动仓</div>
                      <div className="mt-2 text-xs leading-5 text-slate-500">先根据至少3年历史回测获得比例建议，再由你人工确认。</div>
                    </div>
                  )}
                </div>

                <div className="flex min-w-0 flex-col justify-between gap-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900">
                      <ExperimentOutlined /> 回测与每日草稿
                    </div>
                    {backtest ? (
                      <div className="space-y-2 text-xs text-slate-600">
                        <div className="flex justify-between"><span>状态</span><Tag color={backtest.status === 'passed' ? 'success' : backtest.status === 'failed' ? 'error' : 'warning'}>{backtest.status}</Tag></div>
                        <div className="flex justify-between"><span>推荐波动比例</span><strong className="text-slate-900">{formatPercent(backtest.recommendedRatio * 100)}</strong></div>
                        <div className="flex justify-between"><span>过滤强度</span><strong className="text-slate-900">{backtest.recommendedProfile === 'strict' ? '严格' : '保守'}</strong></div>
                        {backtest.metrics.recommended && (
                          <div className="flex justify-between"><span>样本外净超额</span><strong className="text-slate-900">{formatPercent(backtest.metrics.recommended.outOfSampleExcessReturnPercent)}</strong></div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs leading-5 text-slate-500">尚未生成回测建议。</div>
                    )}
                    {draft && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                        <div className="flex items-center gap-2 font-medium"><ClockCircleOutlined /> 待确认：{draft.side === 'buy' ? '买入' : '卖出'} {formatQuantity(draft.suggestedQuantity)}</div>
                        <div className="mt-1 text-amber-800">参考区间 {draft.referencePriceLow?.toFixed(3) || '--'} – {draft.referencePriceHigh?.toFixed(3) || '--'}</div>
                      </div>
                    )}
                    {!item.eligible && item.blockers.length > 0 && <div className="mt-2 text-xs text-slate-500">{item.blockers.join(' · ')}</div>}
                  </div>
                  <Space wrap>
                    {item.eligible && (
                      <Button size="small" loading={workingLabel === `${item.symbol} 回测`} disabled={Boolean(workingLabel)} onClick={() => void runTrackedOperation(`${item.symbol} 回测`, () => runRotationBacktest([item.positionId]))}>
                        重新回测
                      </Button>
                    )}
                    {!item.allocation && backtest && <Button size="small" type="primary" onClick={() => openActivation(item)}>确认拆仓</Button>}
                    {item.allocation && <Button size="small" icon={<SwapOutlined />} onClick={() => openTransfer(item)}>仓内划转</Button>}
                    {draft && <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={() => openConfirm(item)}>确认成交</Button>}
                    {draft && <Button size="small" type="text" onClick={() => void dismissVolatilityDraft(draft.id).then(load)}>忽略</Button>}
                    {item.allocation && (
                      <Tooltip title="在任务中心和分仓接口中保留完整审计记录">
                        <Button size="small" type="link" href={`/operations?positionId=${item.positionId}`} icon={<HistoryOutlined />}>审计</Button>
                      </Tooltip>
                    )}
                  </Space>
                </div>
              </div>
            </Card>
          )
        })}
      </section>

      <Modal title={`确认拆仓 · ${selectedItem?.name || ''}`} open={activationOpen} onCancel={() => setActivationOpen(false)} onOk={() => void submitActivation()} okText="确认并建立台账">
        <Alert className="mb-4" type="warning" showIcon message="确认后，所有买卖必须声明核心仓或波动仓；每日草稿永远不能动用核心仓。" />
        <Form form={activationForm} layout="vertical">
          <Form.Item name="ratio" label="波动仓比例" rules={[{ required: true }]}>
            <Select options={[0, 0.1, 0.2, 0.3, 0.4].map((value) => ({ value, label: `${value * 100}%${value === selectedItem?.latestBacktest?.recommendedRatio ? ' · 回测推荐' : ''}` }))} />
          </Form.Item>
          <Form.Item name="profile" label="RRG过滤强度" rules={[{ required: true }]}>
            <Select options={[{ value: 'conservative', label: '保守过滤' }, { value: 'strict', label: '严格过滤' }]} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title={`仓内划转 · ${selectedItem?.name || ''}`} open={transferOpen} onCancel={() => setTransferOpen(false)} onOk={() => void submitTransfer()} okText="记录划转">
        <Form form={transferForm} layout="vertical">
          <Form.Item name="direction" label="划转方向" rules={[{ required: true }]}>
            <Select options={[
              { value: 'core_to_volatility', label: '核心证券 → 波动证券' },
              { value: 'volatility_to_core', label: '波动证券 → 核心证券' },
              { value: 'cash_in', label: '转入波动现金' },
              { value: 'cash_out', label: '转出波动现金' },
            ]} />
          </Form.Item>
          <Form.Item name="amount" label="数量 / 金额" rules={[{ required: true, message: '请输入划转数量或金额' }]}>
            <InputNumber className="w-full" min={0.01} />
          </Form.Item>
          <Form.Item name="notes" label="说明"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>

      <Modal title={`录入实际成交 · ${selectedItem?.name || ''}`} open={confirmOpen} onCancel={() => setConfirmOpen(false)} onOk={() => void submitDraftConfirmation()} okText="确认入账">
        <Alert className="mb-4" type="info" showIcon message="这一步只记录你已人工完成的实际成交，不会向券商发送订单。" />
        <Form form={confirmForm} layout="vertical">
          <Form.Item name="quantity" label="实际成交数量" rules={[{ required: true }]}><InputNumber className="w-full" min={100} step={100} /></Form.Item>
          <Form.Item name="price" label="实际成交价" rules={[{ required: true }]}><InputNumber className="w-full" min={0.001} precision={3} /></Form.Item>
          <Form.Item name="fee" label="手续费"><InputNumber className="w-full" min={0} precision={2} /></Form.Item>
          <Form.Item name="notes" label="备注"><Input.TextArea rows={3} /></Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
