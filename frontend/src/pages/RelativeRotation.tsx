import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Slider,
  Space,
  Spin,
  Statistic,
  Switch,
  Tag,
  Tooltip,
} from 'antd'
import {
  BarChartOutlined,
  CaretRightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  ExperimentOutlined,
  HistoryOutlined,
  PauseOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  PlusOutlined,
} from '@ant-design/icons'
import { RotationChart } from '../components/relative-rotation/RotationChart'
import { RelativeRotationResearchWorkbench } from '../components/relative-rotation/RelativeRotationResearchWorkbench'
import { IndustryCrowdingWorkbench } from '../components/relative-rotation/IndustryCrowdingWorkbench'
import { InvestmentWorkflowBar } from '../components/investment-workflow/InvestmentWorkflowBar'
import { RotationStrategyDecisionPanel } from '../components/investment-workflow/RotationStrategyDecisionPanel'
import {
  activateSleeve,
  addRotationWatchlistItem,
  confirmVolatilityDraft,
  deleteRotationWatchlistItem,
  dismissVolatilityDraft,
  getOperation,
  getRotationHoldings,
  getPortfolioRotation,
  getRotationTimeline,
  getRotationWatchlist,
  refreshRotationUniverse,
  refreshPortfolioRotation,
  runRotationBacktest,
  runVolatilityDailyAnalysis,
  transferSleeve,
  type OperationDto,
  type RotationHoldingItem,
  type RotationHoldingsReport,
  type RotationTimelineReport,
  type RotationMarket,
  type RotationWatchlistReport,
  type PortfolioRotationGroupKey,
  type PortfolioRotationReport,
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
const HIDDEN_TARGETS_STORAGE_KEY = 'fams.rrg.hidden-targets.default.v1'

const marketOptions = [
  { label: 'A股', value: 'CN' },
  { label: '港股', value: 'HK' },
  { label: '美股', value: 'US' },
]

const readinessMeta = {
  verified: { label: '验证充分', color: 'success' },
  limited: { label: '有限历史', color: 'warning' },
  insufficient: { label: '样本不足', color: 'default' },
  unavailable: { label: '行情不可用', color: 'error' },
  not_applicable: { label: '不适用', color: 'default' },
} as const

const freshnessMeta = {
  fresh: { label: '最新', color: 'success' },
  delayed: { label: '延迟1日', color: 'warning' },
  stale: { label: '已老化', color: 'error' },
  unknown: { label: '待校验', color: 'default' },
  not_applicable: { label: '不适用', color: 'default' },
} as const

const portfolioGroupOptions = [
  { label: '全部同图', value: 'all' },
  { label: 'A股权益', value: 'cn_equity' },
  { label: '港股权益', value: 'hk_equity' },
  { label: '黄金跟踪差', value: 'gold' },
  { label: '债券', value: 'bond' },
  { label: '现金', value: 'cash' },
]

const timelineFromPortfolio = (
  report: PortfolioRotationReport,
  groupKey: PortfolioRotationGroupKey,
): RotationTimelineReport => {
  const group = report.groups.find((item) => item.key === groupKey) || report.groups[0]
  const dates = group?.dates || []
  const endDate = dates[dates.length - 1] || report.generatedAt.slice(0, 10)
  const startDate = dates[0] || endDate
  const items = (group?.items || []) as unknown as RotationTimelineReport['items']
  return {
    schemaVersion: 'fams.relative_rotation.universe_timeline.v2',
    generatedAt: report.generatedAt,
    universe: 'holdings_and_watchlist',
    market: group?.key === 'hk_equity' ? 'HK' : 'CN',
    benchmark: {
      id: `portfolio_${group?.key || groupKey}_benchmark`,
      symbol: group?.benchmark.symbol || 'N/A',
      name: group?.benchmark.name || '不适用',
      status: group?.benchmark.sampleDays ? 'price_index' : 'unavailable',
      sourceProviders: group?.benchmark.sourceProviders || [],
    },
    formulaVersion: report.formulaVersion,
    frequency: report.frequency,
    requestedYears: report.requestedYears,
    requestedHistoryDays: Math.min(3000, Math.ceil((report.requestedYears + 1) * 260)),
    visibleRange: { startDate, endDate },
    items,
    dates,
    availableDateCount: dates.length,
    eligibleCount: items.length,
    readyCount: group?.readyCount || 0,
    limitedCount: group?.limitedCount || 0,
    refreshRecommended: items.some((item) => item.freshness === 'stale' || item.readiness === 'unavailable'),
    refreshReasons: items.filter((item) => item.freshness === 'stale').map((item) => `${item.targetKey}:stale`),
    notTradingAdvice: true,
  }
}

export default function RelativeRotation() {
  const { message } = AntApp.useApp()
  const [frequency, setFrequency] = useState<'weekly' | 'daily'>('weekly')
  const [market, setMarket] = useState<RotationMarket>('CN')
  const [universeMode, setUniverseMode] = useState<'portfolio' | 'watchlist' | 'research' | 'industry_crowding'>('portfolio')
  const [portfolioGroup, setPortfolioGroup] = useState<PortfolioRotationGroupKey>('all')
  const [portfolioReport, setPortfolioReport] = useState<PortfolioRotationReport | null>(null)
  const [report, setReport] = useState<RotationHoldingsReport | null>(null)
  const [timeline, setTimeline] = useState<RotationTimelineReport | null>(null)
  const [watchlist, setWatchlist] = useState<RotationWatchlistReport | null>(null)
  const [watchlistMarket, setWatchlistMarket] = useState<RotationMarket>('CN')
  const [watchlistCode, setWatchlistCode] = useState('')
  const [watchlistWorking, setWatchlistWorking] = useState('')
  const [hiddenTargetKeys, setHiddenTargetKeys] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(HIDDEN_TARGETS_STORAGE_KEY) || '[]')
      return new Set(Array.isArray(stored) ? stored.map(String) : [])
    } catch {
      return new Set()
    }
  })
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
  const portfolioGroupRef = useRef<PortfolioRotationGroupKey>('all')
  const automaticRefreshAttempted = useRef(new Set<string>())
  const [activationForm] = Form.useForm()
  const [transferForm] = Form.useForm()
  const [confirmForm] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [nextReport, nextTimeline, nextPortfolioReport] = await Promise.all([
        getRotationHoldings(frequency, frequency === 'weekly' ? 12 : 20),
        getRotationTimeline(frequency, 8, market),
        getPortfolioRotation(frequency, 8),
      ])
      const nextWatchlist = await getRotationWatchlist()
      const selectedTimeline = universeMode === 'portfolio' ? timelineFromPortfolio(nextPortfolioReport, portfolioGroupRef.current) : nextTimeline
      setReport(nextReport)
      setPortfolioReport(nextPortfolioReport)
      setTimeline(selectedTimeline)
      setWatchlist(nextWatchlist)
      const preservedDate = headDateRef.current
      const preservedIndex = preservedDate
        ? selectedTimeline.dates.reduce((best, date, index) => date <= preservedDate ? index : best, 0)
        : selectedTimeline.dates.length - 1
      setHeadIndex(Math.max(0, preservedIndex))
    } catch (error) {
      console.error(error)
      message.error('相对轮动数据加载失败')
    } finally {
      setLoading(false)
    }
  }, [frequency, market, universeMode])

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

  const runUniverseRefresh = async (label: string, targetKeys: string[]) => {
    if (targetKeys.length === 0) return
    setWorkingLabel(label)
    setOperationProgress(15)
    try {
      const result = universeMode === 'portfolio'
        ? await refreshPortfolioRotation()
        : await refreshRotationUniverse(market, targetKeys, 8)
      setOperationProgress(100)
      message.success(`${label}完成：${result.completedTargets}/${result.requestedTargets} 个数据标的就绪`)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : `${label}失败`)
    } finally {
      setWorkingLabel('')
      setOperationProgress(0)
    }
  }

  useEffect(() => {
    if (universeMode === 'research' || universeMode === 'industry_crowding' || !timeline?.refreshRecommended || workingLabel) return
    const refreshKey = `${universeMode}:${portfolioGroup}:${market}:${frequency}:${new Date().toISOString().slice(0, 10)}`
    if (automaticRefreshAttempted.current.has(refreshKey)) return
    const targetKeys = timeline.items
      .filter((item) => !hiddenTargetKeys.has(item.targetKey))
      .filter((item) => item.freshness !== 'fresh' || item.readiness === 'unavailable')
      .map((item) => item.targetKey)
    if (targetKeys.length === 0) return
    automaticRefreshAttempted.current.add(refreshKey)
    void runUniverseRefresh('刷新可见 RRG 数据', targetKeys)
    // The automatic gate runs once per market/frequency/day.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frequency, hiddenTargetKeys, market, portfolioGroup, timeline?.generatedAt, timeline?.refreshRecommended, universeMode, workingLabel])

  const timelineItems = timeline?.items || []
  const visibleTimelineItems = useMemo(
    () => timelineItems.filter((item) => !hiddenTargetKeys.has(item.targetKey)),
    [hiddenTargetKeys, timelineItems],
  )
  const activeAtHead = useMemo(
    () => visibleTimelineItems.filter((item) => item.points.some((point) => point.date <= headDate)).length,
    [headDate, visibleTimelineItems],
  )
  const readyCount = timeline?.items.filter((item) => item.readiness === 'verified').length || 0
  const activePortfolioGroup = portfolioReport?.groups.find((group) => group.key === portfolioGroup)
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

  const persistHiddenTargets = (next: Set<string>) => {
    setHiddenTargetKeys(next)
    window.localStorage.setItem(HIDDEN_TARGETS_STORAGE_KEY, JSON.stringify(Array.from(next)))
  }

  const toggleTargetVisibility = (targetKey: string, visible: boolean) => {
    const next = new Set(hiddenTargetKeys)
    if (visible) next.delete(targetKey)
    else next.add(targetKey)
    persistHiddenTargets(next)
    const item = timelineItems.find((candidate) => candidate.targetKey === targetKey)
    if (visible && item && item.freshness !== 'fresh' && !workingLabel) {
      void runUniverseRefresh(`刷新 ${item.name}`, [targetKey])
    }
  }

  const addWatchlistTarget = async () => {
    const code = watchlistCode.trim()
    if (!code) {
      message.warning('请输入证券代码')
      return
    }
    setWatchlistWorking('add')
    try {
      const result = await addRotationWatchlistItem({ market: watchlistMarket, code })
      const next = new Set(hiddenTargetKeys)
      next.delete(result.item.targetKey)
      persistHiddenTargets(next)
      setWatchlistCode('')
      setMarket(watchlistMarket)
      message.success(result.created ? `已添加 ${result.item.name}` : `${result.item.name} 已在自选列表`)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '添加自选失败')
    } finally {
      setWatchlistWorking('')
    }
  }

  const deleteWatchlistTarget = async (itemId: string, targetKey: string) => {
    setWatchlistWorking(itemId)
    try {
      const result = await deleteRotationWatchlistItem(itemId)
      const next = new Set(hiddenTargetKeys)
      next.delete(targetKey)
      persistHiddenTargets(next)
      message.success(`已删除自选及 ${result.deletedPoints} 个专属 RRG 节点；共享行情已保留`)
      await load()
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除自选失败')
    } finally {
      setWatchlistWorking('')
    }
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
      <InvestmentWorkflowBar currentStep="position_strategy" />
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
            <Segmented
              value={universeMode}
              options={[
                { label: '全部持仓', value: 'portfolio' },
                { label: '市场自选', value: 'watchlist' },
                { label: '专题研究', value: 'research' },
                { label: '板块拥挤度', value: 'industry_crowding' },
              ]}
              onChange={(value) => {
                setPlaying(false)
                setUniverseMode(value as 'portfolio' | 'watchlist' | 'research' | 'industry_crowding')
                setHeadIndex(0)
              }}
              aria-label="RRG资产集合"
            />
            {(universeMode === 'portfolio' || universeMode === 'watchlist') && (
              <>
                <Button icon={<ExperimentOutlined />} disabled={Boolean(workingLabel)} onClick={() => void runTrackedOperation('持仓回测', () => runRotationBacktest())}>
                  回测全部持仓
                </Button>
                <Button type="primary" icon={<BarChartOutlined />} disabled={Boolean(workingLabel)} onClick={() => void runTrackedOperation('每日波动仓分析', runVolatilityDailyAnalysis)}>
                  运行每日分析
                </Button>
                <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void load()} aria-label="刷新页面数据" />
              </>
            )}
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

      <RotationStrategyDecisionPanel />

      {universeMode === 'research' ? (
        <RelativeRotationResearchWorkbench reducedMotion={reducedMotion} />
      ) : universeMode === 'industry_crowding' ? (
        <IndustryCrowdingWorkbench reducedMotion={reducedMotion} />
      ) : (
        <>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card size="small"><Statistic title={universeMode === 'portfolio' ? '全部持仓覆盖' : '合格持仓'} value={universeMode === 'portfolio' ? portfolioReport?.coverage.representedCount || 0 : report?.eligibleCount || 0} suffix="个" /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="当前市场验证充分" value={readyCount} suffix="个" valueStyle={{ color: '#1d4ed8' }} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="已启用波动仓" value={activeSleeves} suffix="个" valueStyle={{ color: '#0f766e' }} /></Card></Col>
        <Col xs={12} lg={6}><Card size="small"><Statistic title="待确认草稿" value={pendingDrafts} suffix="个" valueStyle={{ color: pendingDrafts ? '#b45309' : '#334155' }} /></Card></Col>
      </Row>

      <Card
        title={<Space><SafetyCertificateOutlined className="text-blue-600" /><span>数据与计算口径</span></Space>}
        size="small"
      >
        <Descriptions size="small" column={{ xs: 1, sm: 2, lg: 5 }}>
          <Descriptions.Item label="资产集合">{universeMode === 'portfolio' ? `全部开放持仓 · ${portfolioReport?.coverage.positionCount || 0}项` : '持仓 + 自选 · A股 / 港股 / 美股'}</Descriptions.Item>
          <Descriptions.Item label="当前基准">{timeline?.benchmark.name || '沪深300'}</Descriptions.Item>
          <Descriptions.Item label="资产价格">{universeMode === 'portfolio' ? '交易所前复权价 / 场外基金累计净值' : market === 'CN' ? '前复权 qfq' : '复权收盘价 adjusted close'}</Descriptions.Item>
          {universeMode === 'portfolio' && (
            <Descriptions.Item label="新鲜度截止">
              {portfolioReport?.freshnessReferenceDate || '--'} · {portfolioReport?.freshnessTimezone || 'Asia/Shanghai'} {Math.floor((portfolioReport?.freshnessAfterCloseMinutes || 1020) / 60)}:00
            </Descriptions.Item>
          )}
          <Descriptions.Item label="公式">transparent v1</Descriptions.Item>
          <Descriptions.Item label="历史门槛">91日 / 53周可绘制 · 756日验证充分</Descriptions.Item>
        </Descriptions>
        {universeMode === 'portfolio' && activePortfolioGroup?.benchmark.components && (
          <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="统一RRG基准组成">
            <span className="text-xs font-medium text-slate-500">共同基准组成</span>
            {activePortfolioGroup.benchmark.components.map((component) => (
              <Tag key={component.key} color="blue">
                {component.name} {component.weight}%
              </Tag>
            ))}
          </div>
        )}
        <Alert
          className="mt-3"
          type="info"
          showIcon
          message={universeMode === 'portfolio'
            ? portfolioGroup === 'all'
              ? '14项非现金持仓使用同一个高防御10/15/50/25多资产价格代理基准；2项现金列示但不生成坐标。该图用于跨资产相对趋势和后续批次门控，不是精确总收益归因。'
              : portfolioGroup === 'gold'
                ? '该分组只观察002611相对同类黄金ETF的跟踪差，不代表黄金资产轮动，也不参与黄金配置门控。黄金配置门控请查看“全部同图”。'
                : '当前为分组诊断视图；正式配置门控统一读取“全部同图”，累计净值与价格代理的口径差异会明确披露。'
            : '三地市场按各自基准分图比较；隐藏仅暂停刷新，删除自选不会删除持仓或全项目共享行情。'}
        />
      </Card>

      <Card
        title={<Space><PlusOutlined className="text-blue-600" /><span>{universeMode === 'portfolio' ? '全持仓分组与显示管理' : 'RRG 自选与显示管理'}</span></Space>}
        extra={<Tag>{universeMode === 'portfolio' ? `${portfolioReport?.coverage.representedCount || 0} / ${portfolioReport?.coverage.positionCount || 0} 项覆盖` : `${watchlist?.count || 0} / ${watchlist?.limit || 30} 个自选`}</Tag>}
      >
        {universeMode === 'watchlist' && <div className="grid gap-3 lg:grid-cols-[220px_minmax(240px,1fr)_auto]">
          <Segmented
            block
            value={watchlistMarket}
            options={marketOptions}
            onChange={(value) => setWatchlistMarket(value as RotationMarket)}
            aria-label="新增自选市场"
          />
          <Input
            value={watchlistCode}
            onChange={(event) => setWatchlistCode(event.target.value)}
            onPressEnter={() => void addWatchlistTarget()}
            placeholder={watchlistMarket === 'CN' ? '输入6位代码，如 515070' : watchlistMarket === 'HK' ? '输入港股代码，如 700' : '输入美股代码，如 AAPL'}
            aria-label="证券代码"
          />
          <Button type="primary" icon={<PlusOutlined />} loading={watchlistWorking === 'add'} onClick={() => void addWatchlistTarget()}>
            添加并验证
          </Button>
        </div>}

        {universeMode === 'portfolio' && (
          <Segmented
            block
            value={portfolioGroup}
            options={portfolioGroupOptions}
            onChange={(value) => {
              setPlaying(false)
              const nextGroup = value as PortfolioRotationGroupKey
              portfolioGroupRef.current = nextGroup
              setPortfolioGroup(nextGroup)
              if (portfolioReport) {
                const selectedTimeline = timelineFromPortfolio(portfolioReport, nextGroup)
                setTimeline(selectedTimeline)
                setHeadIndex(Math.max(0, selectedTimeline.dates.length - 1))
              } else {
                setHeadIndex(0)
              }
            }}
            aria-label="持仓资产组"
          />
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <div>
            <div className="text-sm font-semibold text-slate-900">当前市场标的</div>
            <div className="mt-1 text-xs text-slate-500">{universeMode === 'portfolio' ? portfolioGroup === 'all' ? '全部当前持仓一次列示；现金不绘制，其余标的共享同一坐标基准。' : '当前为单资产组诊断视图；现金列示但不绘制。' : '持仓默认展示；关闭开关后仅停止绘图与主动刷新，数据会按交易日逐步老化。'}</div>
          </div>
          {universeMode === 'watchlist' && <Segmented
            value={market}
            options={marketOptions}
            onChange={(value) => {
              setPlaying(false)
              setMarket(value as RotationMarket)
              setHeadIndex(0)
            }}
            aria-label="RRG市场"
          />}
        </div>

        {timelineItems.length > 0 ? (
          <div className="mt-3 overflow-hidden rounded-xl border border-slate-200">
            {timelineItems.map((item, index) => {
              const readiness = readinessMeta[item.readiness]
              const freshness = freshnessMeta[item.freshness]
              const visible = !hiddenTargetKeys.has(item.targetKey)
              return (
                <div key={item.targetKey} className={`grid gap-3 px-4 py-3 md:grid-cols-[minmax(180px,1.3fr)_minmax(180px,1fr)_minmax(170px,1fr)_auto] md:items-center ${index ? 'border-t border-slate-100' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium text-slate-950">{item.name}</span>
                      <span className="font-mono text-xs text-slate-500">{item.symbol}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {item.sources.includes('holding') && <Tag color="blue">持仓</Tag>}
                      {item.sources.includes('watchlist') && <Tag color="purple">自选</Tag>}
                      {universeMode === 'portfolio' && (item as any).latestQuadrant && <Tag color={quadrantMeta[(item as any).latestQuadrant as keyof typeof quadrantMeta].color}>{quadrantMeta[(item as any).latestQuadrant as keyof typeof quadrantMeta].label}</Tag>}
                      <Tag>{item.market}</Tag>
                    </div>
                  </div>
                  <div className="text-xs text-slate-600">
                    <div><Tag color={readiness.color}>{readiness.label}</Tag><Tag color={freshness.color}>{freshness.label}</Tag></div>
                    <div className="mt-1">{item.sampleDays} 个交易日 · 截止 {item.assetAsOfDate || item.commonAsOfDate || '--'}</div>
                  </div>
                  <div className="text-xs leading-5 text-slate-500">
                    <div>基准：{timeline?.benchmark.name}</div>
                    <div>{item.sourceProviders.join(' / ') || '尚无可用数据源'}</div>
                    {item.blockers[0] && <Tooltip title={item.blockers.join('；')}><span className="cursor-help text-amber-700">{item.blockers[0]}</span></Tooltip>}
                  </div>
                  <Space size="small" wrap>
                    <Switch
                      size="small"
                      checked={visible}
                      checkedChildren="显示"
                      unCheckedChildren="隐藏"
                      onChange={(checked) => toggleTargetVisibility(item.targetKey, checked)}
                      aria-label={`${visible ? '隐藏' : '显示'} ${item.name}`}
                    />
                    {item.readiness !== ('not_applicable' as any) && <Button size="small" icon={<ReloadOutlined />} disabled={Boolean(workingLabel)} onClick={() => void runUniverseRefresh(`刷新 ${item.name}`, [item.targetKey])} aria-label={`刷新 ${item.name}`} />}
                    {item.watchlistItemId && (
                      <Popconfirm
                        title="删除该自选及其专属 RRG 数据？"
                        description={item.sources.includes('holding') ? '该标的仍是持仓，删除后会继续按持仓默认展示。' : '共享行情、其他用户数据和历史持仓不会被删除。'}
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => deleteWatchlistTarget(item.watchlistItemId!, item.targetKey)}
                      >
                        <Button danger size="small" type="text" icon={<DeleteOutlined />} loading={watchlistWorking === item.watchlistItemId} aria-label={`删除自选 ${item.name}`} />
                      </Popconfirm>
                    )}
                  </Space>
                </div>
              )
            })}
          </div>
        ) : (
          <Empty className="mt-5" image={Empty.PRESENTED_IMAGE_SIMPLE} description="当前市场还没有持仓或自选标的" />
        )}
      </Card>

      <Card
        title={(
          <div>
            <Space><SwapOutlined className="text-blue-600" /><span>{timeline?.benchmark.name || '市场基准'}相对轮动</span></Space>
            <div className="mt-1 text-xs font-normal text-slate-500">当前仅绘制已开启显示的持仓与自选；有限历史为虚线，老化缓存降低透明度。</div>
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
        ) : timelineDates.length > 0 && headDate && visibleTimelineItems.some((item) => item.points.length > 0) ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
                <span><strong className="text-slate-900">{headDate}</strong> 头部日期</span>
                <span><strong className="text-slate-900">{activeAtHead}</strong> / {visibleTimelineItems.length} 个可见标的有轨迹</span>
                <span><strong className="text-slate-900">{timeline?.availableDateCount || 0}</strong> 个可播放节点</span>
                <span>{timeline?.visibleRange.startDate} — {timeline?.visibleRange.endDate}</span>
              </div>
              <Button
                size="small"
                icon={<ReloadOutlined />}
                disabled={Boolean(workingLabel)}
                onClick={() => void runUniverseRefresh('刷新可见 RRG 数据', visibleTimelineItems.map((item) => item.targetKey))}
              >
                智能换源刷新
              </Button>
            </div>
            <div className="px-1 sm:px-3">
              <RotationChart
                items={visibleTimelineItems}
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
            <Empty description={timelineItems.length > 0 && visibleTimelineItems.length === 0 ? '当前市场标的均已隐藏；请先在自选管理中开启显示。' : '尚无可绘制轨迹；样本不足或数据源不可用的标的不会生成虚假坐标。'}>
              <Button type="primary" disabled={visibleTimelineItems.length === 0} loading={Boolean(workingLabel)} onClick={() => void runUniverseRefresh('补齐可见 RRG 历史', visibleTimelineItems.map((item) => item.targetKey))}>
                补齐可见历史
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
        </>
      )}

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
