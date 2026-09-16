import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Col,
  DatePicker,
  Empty,
  Input,
  Popconfirm,
  Progress,
  Row,
  Segmented,
  Select,
  Slider,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'antd'
import {
  CaretRightOutlined,
  DeleteOutlined,
  PauseOutlined,
  PlusOutlined,
  ReloadOutlined,
  SaveOutlined,
  StarOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { RotationChart } from './RotationChart'
import { IndustryRotationHistoryPanel } from './IndustryRotationHistoryPanel'
import {
  industryRotationMarketForKey,
  industryRotationPresetChoices,
} from './industryRotationPresets'
import {
  createRotationResearchStudy,
  deleteRotationResearchStudy,
  getRotationResearchStudies,
  getRotationResearchTimeline,
  refreshRotationResearchTimeline,
  updateRotationResearchStudy,
  type RotationMarket,
  type RotationResearchAssociation,
  type RotationResearchPeriod,
  type RotationResearchStudy,
  type RotationResearchStudyInput,
  type RotationResearchTarget,
  type RotationResearchTimelineReport,
} from '../../services/relativeRotationService'

const { RangePicker } = DatePicker

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
} as const

const freshnessMeta = {
  fresh: { label: '最新', color: 'success' },
  delayed: { label: '延迟1日', color: 'warning' },
  stale: { label: '已老化', color: 'error' },
  unknown: { label: '待校验', color: 'default' },
} as const

interface ResearchDraft extends RotationResearchStudyInput {
  comparisonTargetKeys: string[]
}

interface StudyChoice {
  key: string
  label: string
  studyId: string | null
  draft: ResearchDraft
}

const cnResearchIndexAliases: Record<string, string> = {
  '930708': '930708.CSI', '930708.CSI': '930708.CSI', '930708.SH': '930708.CSI', 'SH930708': '930708.CSI',
  H30199: 'H30199.CSI', 'H30199.CSI': 'H30199.CSI',
  H30184: 'H30184.CSI', 'H30184.CSI': 'H30184.CSI',
  '930851': '930851.CSI', '930851.CSI': '930851.CSI', '930851.SH': '930851.CSI', 'SH930851': '930851.CSI',
  '930601': '930601.CSI', '930601.CSI': '930601.CSI', '930601.SH': '930601.CSI', 'SH930601': '930601.CSI',
  '930713': '930713.CSI', '930713.CSI': '930713.CSI', '930713.SH': '930713.CSI', 'SH930713': '930713.CSI',
}

const stageTagColors: Record<string, string> = {
  上游资源: 'gold',
  能源供给: 'green',
  核心器件: 'geekblue',
  算力与数据: 'blue',
  软件应用: 'purple',
  AI综合主题: 'magenta',
}

const canonicalCnResearchIndex = (value: string) => cnResearchIndexAliases[String(value || '').trim().toUpperCase()]

const targetKeyFor = (market: RotationMarket, target: RotationResearchTarget) => {
  const kind = target.kind === 'index' ? 'index' : 'equity'
  const raw = String(target.code || '').trim().toUpperCase()
  if (kind === 'index') {
    const symbol = market === 'CN'
      ? canonicalCnResearchIndex(raw) || (/^\d{6}$/.test(raw) ? `${raw}.${raw.startsWith('399') ? 'SZ' : 'SH'}` : raw)
      : raw
    return `${market}:index:${symbol}`
  }
  if (market === 'CN') return `${market}:equity:${raw.replace(/\.(SH|SS|SZ|BJ)$/, '')}`
  if (market === 'HK') return `${market}:equity:${raw.replace(/\.HK$/, '').padStart(5, '0')}.HK`
  return `${market}:equity:${raw}`
}

const medicalPreset: ResearchDraft = {
  name: '医疗持仓：恒瑞与中证医疗',
  market: 'CN',
  frequency: 'weekly',
  period: { mode: 'rolling', rollingWeeks: 52 },
  targets: [
    { code: '600276', name: '恒瑞医药', kind: 'equity', targetKey: 'CN:equity:600276' },
    { code: '399989.SZ', name: '中证医疗指数', kind: 'index', targetKey: 'CN:index:399989.SZ' },
  ],
  comparisonTargetKeys: ['CN:equity:600276', 'CN:index:399989.SZ'],
}

const autoPreset: ResearchDraft = {
  name: '智能电动车（港股）',
  market: 'HK',
  // 赛力斯 H 股于 2025 年末才开始交易，当前周频样本尚不足以同时
  // 完成公式热身并形成可解释轨迹。日频使用同一港股证券和恒指基准，
  // 能保留真实上市历史且不会用 A 股 601127 跨市场拼接。
  frequency: 'daily',
  period: { mode: 'rolling', rollingWeeks: 52 },
  targets: [
    { code: '09927.HK', name: '赛力斯', kind: 'equity', targetKey: 'HK:equity:09927.HK' },
    { code: '00175.HK', name: '吉利汽车', kind: 'equity', targetKey: 'HK:equity:00175.HK' },
    { code: '01211.HK', name: '比亚迪股份', kind: 'equity', targetKey: 'HK:equity:01211.HK' },
    { code: '09866.HK', name: '蔚来', kind: 'equity', targetKey: 'HK:equity:09866.HK' },
    { code: '01810.HK', name: '小米集团', kind: 'equity', targetKey: 'HK:equity:01810.HK' },
    { code: '02015.HK', name: '理想汽车', kind: 'equity', targetKey: 'HK:equity:02015.HK' },
    { code: '09868.HK', name: '小鹏汽车', kind: 'equity', targetKey: 'HK:equity:09868.HK' },
  ],
  comparisonTargetKeys: ['HK:equity:09927.HK', 'HK:equity:00175.HK'],
}

const macroTargetKeys = [
  'US:equity:SPY',
  'US:equity:TLT',
  'US:equity:IEF',
  'US:equity:GLD',
  'US:index:DX-Y.NYB',
]

const macroPreset: ResearchDraft = {
  name: '全球宏观资产（近十年）',
  market: 'US',
  frequency: 'weekly',
  historyYears: 10,
  benchmark: { mode: 'equal_weight_targets', targetKeys: macroTargetKeys },
  period: { mode: 'rolling', rollingWeeks: 520 },
  targets: [
    { code: 'SPY', name: '美股 · 标普500 ETF', kind: 'equity', targetKey: 'US:equity:SPY' },
    { code: 'TLT', name: '长期美债 · 20年以上', kind: 'equity', targetKey: 'US:equity:TLT' },
    { code: 'IEF', name: '中期美债 · 7–10年', kind: 'equity', targetKey: 'US:equity:IEF' },
    { code: 'GLD', name: '黄金 · GLD ETF', kind: 'equity', targetKey: 'US:equity:GLD' },
    { code: 'DX-Y.NYB', name: '美元指数 DXY', kind: 'index', targetKey: 'US:index:DX-Y.NYB' },
  ],
  comparisonTargetKeys: ['US:equity:SPY', 'US:equity:TLT'],
}

const aiSupplyChainIndexPreset: ResearchDraft = {
  name: 'A股 AI 产业链：中证行业价格指数',
  market: 'CN',
  frequency: 'weekly',
  historyYears: 8,
  benchmark: { mode: 'market_default', targetKeys: [] },
  period: { mode: 'rolling', rollingWeeks: 104 },
  targets: [
    { code: '930708.CSI', name: '上游资源 · 中证有色', kind: 'index', targetKey: 'CN:index:930708.CSI' },
    { code: 'H30199.CSI', name: '能源供给 · 全指电力公用事业', kind: 'index', targetKey: 'CN:index:H30199.CSI' },
    { code: 'H30184.CSI', name: '核心器件 · 中证全指半导体', kind: 'index', targetKey: 'CN:index:H30184.CSI' },
    { code: '930851.CSI', name: '算力与数据 · 中证云计算大数据', kind: 'index', targetKey: 'CN:index:930851.CSI' },
    { code: '930601.CSI', name: '软件应用 · 中证软件服务', kind: 'index', targetKey: 'CN:index:930601.CSI' },
    { code: '930713.CSI', name: 'AI综合主题 · 中证人工智能', kind: 'index', targetKey: 'CN:index:930713.CSI' },
  ],
  comparisonTargetKeys: ['CN:index:H30184.CSI', 'CN:index:930713.CSI'],
}

const cloneDraft = (draft: ResearchDraft): ResearchDraft => ({
  ...draft,
  historyYears: draft.historyYears || 8,
  benchmark: draft.benchmark
    ? { mode: draft.benchmark.mode, targetKeys: [...draft.benchmark.targetKeys] }
    : { mode: 'market_default', targetKeys: [] },
  period: { ...draft.period } as RotationResearchPeriod,
  targets: draft.targets.map((target) => ({ ...target })),
  comparisonTargetKeys: [...draft.comparisonTargetKeys],
})

const draftFromStudy = (study: RotationResearchStudy): ResearchDraft => ({
  name: study.name,
  market: study.market,
  frequency: study.frequency,
  historyYears: study.historyYears || 8,
  benchmark: study.benchmark
    ? { mode: study.benchmark.mode, targetKeys: [...study.benchmark.targetKeys] }
    : { mode: 'market_default', targetKeys: [] },
  period: study.period,
  targets: study.targets.map((target) => ({ ...target })),
  comparisonTargetKeys: study.comparisonTargetKeys,
})

const toStudyInput = (draft: ResearchDraft): RotationResearchStudyInput => ({
  name: draft.name,
  market: draft.market,
  frequency: draft.frequency,
  historyYears: draft.historyYears || 8,
  benchmark: draft.benchmark || { mode: 'market_default', targetKeys: [] },
  period: draft.period,
  targets: draft.targets.map(({ code, name, kind }) => ({ code, name, kind })),
  comparisonTargetKeys: draft.comparisonTargetKeys,
})

// Only fields that change a timeline belong in this key.  Research name and
// the pair selected for the side-panel association do not affect coordinates.
const timelineFingerprint = (draft: ResearchDraft) => JSON.stringify({
  market: draft.market,
  frequency: draft.frequency,
  historyYears: draft.historyYears || 8,
  benchmark: draft.benchmark || { mode: 'market_default', targetKeys: [] },
  period: draft.period,
  targets: draft.targets.map(({ code, name, kind }) => ({ code, name, kind })),
})

const pct = (value: number | null, digits = 1) => value === null ? '—' : `${(value * 100).toFixed(digits)}%`
const decimal = (value: number | null, digits = 3) => value === null ? '—' : value.toFixed(digits)

export function RelativeRotationResearchWorkbench({ reducedMotion }: { reducedMotion: boolean }) {
  const { message } = AntApp.useApp()
  const [studies, setStudies] = useState<RotationResearchStudy[]>([])
  const [activeKey, setActiveKey] = useState<string>('preset-medical')
  const [activeStudyId, setActiveStudyId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ResearchDraft>(() => cloneDraft(medicalPreset))
  const [timeline, setTimeline] = useState<RotationResearchTimelineReport | null>(null)
  const [loadedTimelineFingerprint, setLoadedTimelineFingerprint] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newKind, setNewKind] = useState<'equity' | 'index'>('equity')
  const [headIndex, setHeadIndex] = useState(0)
  const [tailLengths, setTailLengths] = useState({ weekly: 12, daily: 20 })
  const [playing, setPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState<0.5 | 1 | 2>(1)
  const timelineRequestRef = useRef(0)
  const draftTimelineFingerprint = useMemo(() => timelineFingerprint(draft), [draft])
  const activeTimeline = timeline && loadedTimelineFingerprint === draftTimelineFingerprint ? timeline : null
  const timelineNeedsReload = Boolean(timeline && !activeTimeline)

  const studyChoices = useMemo<StudyChoice[]>(() => [
    ...industryRotationPresetChoices.map((choice) => ({
      key: choice.key,
      label: choice.label,
      studyId: null,
      draft: choice.draft,
    })),
    { key: 'preset-medical', label: '预设 · 医疗持仓', studyId: null, draft: medicalPreset },
    { key: 'preset-auto', label: '预设 · 智能电动车（港股）', studyId: null, draft: autoPreset },
    { key: 'preset-macro', label: '预设 · 全球宏观资产（近十年）', studyId: null, draft: macroPreset },
    { key: 'preset-ai-supply-chain-index', label: '预设 · A股 AI 产业链（中证价格指数）', studyId: null, draft: aiSupplyChainIndexPreset },
    ...studies.map((study) => ({ key: `study-${study.id}`, label: study.name, studyId: study.id, draft: draftFromStudy(study) })),
  ], [studies])

  const targetOptions = useMemo(() => draft.targets.map((target) => ({
    value: target.targetKey || targetKeyFor(draft.market, target),
    label: `${target.name || target.code} · ${target.code}`,
  })), [draft.market, draft.targets])

  const selectedAssociation = useMemo<RotationResearchAssociation | null>(() => {
    if (!activeTimeline || draft.comparisonTargetKeys.length !== 2) return null
    const [left, right] = draft.comparisonTargetKeys
    return activeTimeline.associations.find((item) => (
      (item.leftTargetKey === left && item.rightTargetKey === right)
      || (item.leftTargetKey === right && item.rightTargetKey === left)
    )) || null
  }, [activeTimeline, draft.comparisonTargetKeys])

  const loadStudies = useCallback(async () => {
    try {
      const response = await getRotationResearchStudies()
      setStudies(response.studies)
    } catch (error) {
      console.error(error)
      message.error('已保存研究加载失败')
    }
  }, [message])

  const runTimeline = useCallback(async (nextDraft: ResearchDraft, refresh = false) => {
    const requestId = ++timelineRequestRef.current
    const requestFingerprint = timelineFingerprint(nextDraft)
    if (refresh) setRefreshing(true)
    else setLoading(true)
    try {
      const input = { study: toStudyInput(nextDraft) }
      if (refresh) {
        const response = await refreshRotationResearchTimeline(input)
        if (requestId !== timelineRequestRef.current) return
        setTimeline(response.timeline)
        setLoadedTimelineFingerprint(requestFingerprint)
        message.success(`研究行情已更新：${response.completedTargets}/${response.requestedTargets} 个标的可用`)
      } else {
        const response = await getRotationResearchTimeline(input)
        if (requestId !== timelineRequestRef.current) return
        setTimeline(response)
        setLoadedTimelineFingerprint(requestFingerprint)
      }
    } catch (error) {
      if (requestId !== timelineRequestRef.current) return
      console.error(error)
      message.error(error instanceof Error ? error.message : '专题研究数据加载失败')
      setTimeline(null)
      setLoadedTimelineFingerprint(null)
    } finally {
      if (requestId === timelineRequestRef.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [message])

  useEffect(() => {
    void loadStudies()
    void runTimeline(medicalPreset)
  }, [loadStudies, runTimeline])

  const chooseStudy = (key: string) => {
    const choice = studyChoices.find((item) => item.key === key)
    if (!choice) return
    const nextDraft = cloneDraft(choice.draft)
    setActiveKey(key)
    setActiveStudyId(choice.studyId)
    setDraft(nextDraft)
    setNewKind('equity')
    void runTimeline(nextDraft)
  }

  const updatePeriod = (period: RotationResearchPeriod) => setDraft((current) => ({ ...current, period }))

  const addTarget = () => {
    const code = newCode.trim()
    if (!code) {
      message.warning('请输入证券或指数代码')
      return
    }
    if (newKind === 'index' && !['CN', 'US'].includes(draft.market)) {
      message.warning('当前仅支持 A 股价格指数或美股专题中的美元指数 DXY')
      return
    }
    if (draft.targets.length >= 16) {
      message.warning('单项研究最多添加16个标的')
      return
    }
    const target: RotationResearchTarget = { code, name: newName.trim() || code, kind: newKind }
    const key = targetKeyFor(draft.market, target)
    if (draft.targets.some((item) => (item.targetKey || targetKeyFor(draft.market, item)) === key)) {
      message.warning('该标的已在当前研究中')
      return
    }
    setDraft((current) => {
      const targets = [...current.targets, { ...target, targetKey: key }]
      return {
        ...current,
        targets,
        comparisonTargetKeys: current.comparisonTargetKeys.length === 0 && targets.length >= 2
          ? targets.slice(0, 2).map((item) => item.targetKey || targetKeyFor(current.market, item))
          : current.comparisonTargetKeys,
      }
    })
    setNewCode('')
    setNewName('')
  }

  const removeTarget = (targetKey: string) => setDraft((current) => {
    const targets = current.targets.filter((target) => (target.targetKey || targetKeyFor(current.market, target)) !== targetKey)
    const retainedBenchmarkTargetKeys = (current.benchmark?.targetKeys || []).filter((key) => key !== targetKey)
    const benchmark = current.benchmark?.mode === 'equal_weight_targets' && retainedBenchmarkTargetKeys.length < 2
      ? { mode: 'market_default' as const, targetKeys: [] }
      : { mode: current.benchmark?.mode || 'market_default' as const, targetKeys: retainedBenchmarkTargetKeys }
    return {
      ...current,
      targets,
      benchmark,
      comparisonTargetKeys: current.comparisonTargetKeys.filter((key) => key !== targetKey),
    }
  })

  const runCurrentDraft = () => void runTimeline(draft)
  const refreshCurrentDraft = () => void runTimeline(draft, true)

  const saveStudy = async () => {
    setSaving(true)
    try {
      const input = toStudyInput(draft)
      const saved = activeStudyId
        ? await updateRotationResearchStudy(activeStudyId, input)
        : await createRotationResearchStudy(input)
      setDraft(draftFromStudy(saved))
      setActiveStudyId(saved.id)
      setActiveKey(`study-${saved.id}`)
      await loadStudies()
      message.success('专题研究已保存到当前账号')
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '保存专题研究失败')
    } finally {
      setSaving(false)
    }
  }

  const removeStudy = async () => {
    if (!activeStudyId) return
    try {
      await deleteRotationResearchStudy(activeStudyId)
      const nextDraft = cloneDraft(medicalPreset)
      setActiveStudyId(null)
      setActiveKey('preset-medical')
      setDraft(nextDraft)
      setTimeline(null)
      setLoadedTimelineFingerprint(null)
      await loadStudies()
      await runTimeline(nextDraft)
      message.success('已删除账号中的专题研究；共享行情数据已保留')
    } catch (error) {
      console.error(error)
      message.error(error instanceof Error ? error.message : '删除专题研究失败')
    }
  }

  const timelineItems = activeTimeline?.items || []
  const timelineDates = activeTimeline?.dates || []
  const presetIndustryMarket = industryRotationMarketForKey(activeKey)
  const activeIndustryMarket = presetIndustryMarket === draft.market ? presetIndustryMarket : null
  const autoSeresItem = timelineItems.find((item) => item.targetKey === 'HK:equity:09927.HK')
  const aiSupplyChainItems = useMemo(() => timelineItems
    .filter((item) => item.taxonomy?.key === 'cn_ai_supply_chain')
    .sort((left, right) => (left.taxonomy?.order || 0) - (right.taxonomy?.order || 0)), [timelineItems])
  const usesEtfPriceProxy = aiSupplyChainItems.some((item) => item.taxonomy?.representation === 'etf_price_proxy')
  const dxyFormulaFallback = timelineItems.some((item) => item.symbol === 'DX-Y.NYB' && item.sourceProviders.includes('ecb_dxy_formula'))
  const targetNameByKey = useMemo(() => new Map(timelineItems.map((item) => [item.targetKey, item.name])), [timelineItems])
  const associationRows = useMemo(() => (activeTimeline?.associations || []).map((association) => ({
    ...association,
    key: `${association.leftTargetKey}::${association.rightTargetKey}`,
    pair: `${targetNameByKey.get(association.leftTargetKey) || association.leftTargetKey} / ${targetNameByKey.get(association.rightTargetKey) || association.rightTargetKey}`,
  })), [activeTimeline?.associations, targetNameByKey])
  const headDate = timelineDates[headIndex] || ''
  const tailLength = tailLengths[draft.frequency]
  const canDraw = timelineItems.some((item) => item.points.length > 0)
  const endDate = headDate || activeTimeline?.visibleRange.endDate || ''
  const activeAtHead = useMemo(() => timelineItems.filter((item) => item.points.some((point) => point.date <= headDate)).length, [headDate, timelineItems])

  useEffect(() => {
    setPlaying(false)
    setHeadIndex(Math.max(0, timelineDates.length - 1))
  }, [activeTimeline?.generatedAt])

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

  const togglePlayback = () => {
    if (playing) {
      setPlaying(false)
      return
    }
    if (headIndex >= timelineDates.length - 1) setHeadIndex(0)
    setPlaying(true)
  }

  return (
    <section className="space-y-4" aria-label="RRG 专题研究工作台">
      <Card
        title={<Space><StarOutlined className="text-blue-600" /><span>专题研究工作台</span></Space>}
        extra={(
          <Space wrap>
            <Button icon={<ReloadOutlined />} loading={refreshing} onClick={refreshCurrentDraft}>刷新研究行情</Button>
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={saveStudy}>保存研究</Button>
            {activeStudyId && (
              <Popconfirm
                title="删除已保存的专题研究？"
                description="仅删除当前账号的研究配置，持仓、共享行情和自选不会删除。"
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
                onConfirm={() => void removeStudy()}
              >
                <Button danger icon={<DeleteOutlined />} aria-label="删除当前专题研究" />
              </Popconfirm>
            )}
          </Space>
        )}
      >
        <div className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_220px_180px_auto] lg:items-end">
          <label className="block text-xs font-medium text-slate-600">
            研究模板 / 已保存研究
            <Select className="mt-1 w-full" value={activeKey} options={studyChoices.map(({ key, label }) => ({ value: key, label }))} onChange={chooseStudy} aria-label="选择专题研究" />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            研究名称
            <Input className="mt-1" value={draft.name} maxLength={80} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} aria-label="专题研究名称" />
          </label>
          <label className="block text-xs font-medium text-slate-600">
            市场
            <Select
              className="mt-1 w-full"
              value={draft.market}
              options={marketOptions}
              onChange={(market) => {
                const nextMarket = market as RotationMarket
                setDraft((current) => ({
                  ...current,
                  market: nextMarket,
                  historyYears: 8,
                  benchmark: { mode: 'market_default', targetKeys: [] },
                  targets: [],
                  comparisonTargetKeys: [],
                }))
                setNewKind('equity')
              }}
              aria-label="专题研究市场"
            />
          </label>
          <Button onClick={runCurrentDraft} loading={loading && !refreshing}>载入区间</Button>
        </div>
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message="专题研究只比较同一市场、共同基准下的相对轮动。保存的是账号研究配置；刷新只更新共享行情缓存，不修改持仓或生成交易指令。"
        />
        {activeKey === 'preset-auto' && (
          <Alert
            className="mt-3"
            type={draft.frequency === 'daily' ? 'info' : 'warning'}
            showIcon
            message={draft.frequency === 'daily' ? '赛力斯 H 股已纳入日频研究' : '赛力斯 H 股的周频历史暂不足'}
            description={draft.frequency === 'daily'
              ? `09927.HK 使用自身港股上市历史和恒生指数共同基准${autoSeresItem ? `；当前 ${autoSeresItem.sampleDays} 个交易日、${autoSeresItem.points.length} 个可用坐标，按“有限历史”展示` : ''}。系统不会拼接 A 股 601127 的历史价格。`
              : '周频公式需要至少 53 个对齐节点才能形成可解释轨迹；在达到门槛前请使用日频观察。系统不会为了补足样本而拼接 A 股 601127。'}
          />
        )}
        {activeKey === 'preset-ai-supply-chain-index' && (
          <Alert
            className="mt-3"
            type="info"
            showIcon
            message="本研究使用中证官方发布的行业和主题价格指数，按资源 → 能源 → 芯片 → 算力数据 → 软件应用 → AI综合主题观察相对轮动。AI综合主题可能与芯片、云计算及软件指数存在成分重叠，不代表严格的投入产出关系。"
          />
        )}
        {activeIndustryMarket && (
          <Alert
            className="mt-3"
            type="info"
            showIcon
            message={`${activeIndustryMarket === 'CN' ? 'A股' : '港股'}行业轮动采用独立的同市场 ETF 样本池`}
            description={activeIndustryMarket === 'CN'
              ? '覆盖15个A股行业与主题ETF，以沪深300为共同市场基准；行情预载范围最多8年，面板默认统计当前选定的104周。'
              : '覆盖7个港股上市行业与主题ETF，以恒生指数为共同市场基准；行情预载范围最多8年，面板默认统计当前选定的104周。不会拼接A股ETF或个股历史。'}
          />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card title="研究设置" className="h-full">
            <div className="space-y-4">
              <div>
                <div className="mb-2 text-xs font-medium text-slate-600">计算频率</div>
                <Segmented
                  block
                  value={draft.frequency}
                  options={[{ label: '周频轨迹', value: 'weekly' }, { label: '日频观察', value: 'daily' }]}
                  onChange={(frequency) => {
                    setPlaying(false)
                    setDraft((current) => ({ ...current, frequency: frequency as 'weekly' | 'daily' }))
                  }}
                  aria-label="专题研究频率"
                />
              </div>
              <label className="block text-xs font-medium text-slate-600">
                行情历史
                <Select
                  className="mt-1 w-full"
                  value={draft.historyYears || 8}
                  options={[{ label: '近 8 年', value: 8 }, { label: '近 10 年', value: 10 }]}
                  onChange={(historyYears) => setDraft((current) => ({ ...current, historyYears: Number(historyYears) }))}
                  aria-label="专题研究行情历史"
                />
              </label>
              <div>
                <div className="mb-2 text-xs font-medium text-slate-600">观察区间</div>
                <Segmented
                  block
                  value={draft.period.mode === 'rolling' ? String(draft.period.rollingWeeks) : 'fixed'}
                  options={[
                    { label: '最近26周', value: '26' },
                    { label: '最近52周', value: '52' },
                    { label: '最近104周', value: '104' },
                    { label: '最近10年', value: '520' },
                    { label: '固定日期', value: 'fixed' },
                  ]}
                  onChange={(value) => {
                    if (value === 'fixed') {
                      const end = endDate || dayjs().format('YYYY-MM-DD')
                      setDraft((current) => ({ ...current, period: { mode: 'fixed', startDate: dayjs(end).subtract(52, 'week').format('YYYY-MM-DD'), endDate: end } }))
                      return
                    }
                    updatePeriod({ mode: 'rolling', rollingWeeks: Number(value) })
                  }}
                  aria-label="专题研究观察区间"
                />
                {draft.period.mode === 'fixed' && (
                  <RangePicker
                    className="mt-3 w-full"
                    value={[dayjs(draft.period.startDate), dayjs(draft.period.endDate)]}
                    onChange={(values) => {
                      const [start, end] = values || []
                      if (!start || !end) return
                      updatePeriod({ mode: 'fixed', startDate: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') })
                    }}
                    allowClear={false}
                    aria-label="固定研究日期范围"
                  />
                )}
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-slate-600">共同基准</div>
                <Segmented
                  block
                  value={draft.benchmark?.mode || 'market_default'}
                  options={[
                    { label: '市场默认基准', value: 'market_default' },
                    { label: '锁定标的等权', value: 'equal_weight_targets', disabled: draft.targets.length < 2 },
                  ]}
                  onChange={(mode) => setDraft((current) => ({
                    ...current,
                    benchmark: mode === 'equal_weight_targets'
                      ? {
                          mode: 'equal_weight_targets',
                          targetKeys: current.targets.map((target) => target.targetKey || targetKeyFor(current.market, target)),
                        }
                      : { mode: 'market_default', targetKeys: [] },
                  }))}
                  aria-label="专题研究共同基准"
                />
                {draft.benchmark?.mode === 'equal_weight_targets' && (
                  <div className="mt-2 text-xs leading-5 text-slate-500">
                    已锁定 {draft.benchmark.targetKeys.length} 个成分，每日等权再平衡。后续新增标的不会自动纳入；移除锁定成分会同步更新。
                  </div>
                )}
              </div>
              <div className="border-t border-slate-100 pt-4">
                <div className="mb-2 text-xs font-medium text-slate-600">新增研究标的</div>
                <div className="grid gap-2 sm:grid-cols-[112px_minmax(120px,1fr)_minmax(120px,1fr)_auto]">
                  <Select
                    value={newKind}
                    options={[{ value: 'equity', label: '股票 / ETF' }, { value: 'index', label: '价格指数', disabled: draft.market === 'HK' }]}
                    onChange={(kind) => setNewKind(kind as 'equity' | 'index')}
                    aria-label="研究标的类型"
                  />
                  <Input value={newCode} onChange={(event) => setNewCode(event.target.value)} placeholder={newKind === 'index' ? draft.market === 'US' ? '仅支持 DX-Y.NYB' : '如 399989.SZ' : draft.market === 'HK' ? '如 175 或 00175.HK' : '输入代码'} aria-label="研究标的代码" />
                  <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="可选名称" aria-label="研究标的名称" />
                  <Button icon={<PlusOutlined />} onClick={addTarget}>添加</Button>
                </div>
              </div>
              <div>
                <div className="mb-2 text-xs font-medium text-slate-600">研究标的（{draft.targets.length}/16）</div>
                <Space size={[6, 8]} wrap>
                  {draft.targets.map((target) => {
                    const targetKey = target.targetKey || targetKeyFor(draft.market, target)
                    return (
                      <Tag key={targetKey} closable onClose={(event) => { event.preventDefault(); removeTarget(targetKey) }} color={target.kind === 'index' ? 'purple' : undefined}>
                        {target.name || target.code} · {target.code}{target.kind === 'index' ? ' · 指数' : ''}
                      </Tag>
                    )
                  })}
                </Space>
              </div>
              <label className="block text-xs font-medium text-slate-600">
                关联对照（选两个标的）
                <Select
                  className="mt-1 w-full"
                  mode="multiple"
                  maxCount={2}
                  value={draft.comparisonTargetKeys}
                  options={targetOptions}
                  onChange={(keys) => setDraft((current) => ({ ...current, comparisonTargetKeys: keys }))}
                  placeholder="选择两个标的查看关联摘要"
                  aria-label="关联对照标的"
                />
              </label>
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={15}>
          <Card title="当前研究摘要" className="h-full">
            {loading && !activeTimeline ? <div className="flex h-56 items-center justify-center"><Spin size="large" /></div> : (
              <div className="space-y-4">
                {timelineNeedsReload && (
                  <Alert
                    type="warning"
                    showIcon
                    message="研究配置已变更，旧报告已被隔离，未用于摘要、关联或轮动图。请点击“载入区间”获取与当前标的一致的结果。"
                  />
                )}
                <Row gutter={[12, 12]}>
                  <Col xs={12} sm={6}><Statistic title="研究标的" value={activeTimeline?.eligibleCount || draft.targets.length} suffix="个" /></Col>
                  <Col xs={12} sm={6}><Statistic title="验证充分" value={activeTimeline?.readyCount || 0} suffix="个" valueStyle={{ color: '#047857' }} /></Col>
                  <Col xs={12} sm={6}><Statistic title="有限历史" value={activeTimeline?.limitedCount || 0} suffix="个" valueStyle={{ color: '#a16207' }} /></Col>
                  <Col xs={12} sm={6}><Statistic title="可播放节点" value={activeTimeline?.availableDateCount || 0} suffix="个" valueStyle={{ color: '#1d4ed8' }} /></Col>
                </Row>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                  <div><strong className="text-slate-900">共同基准：</strong>{activeTimeline?.benchmark.name || '等待载入'} · {activeTimeline?.benchmark.symbol || '—'}</div>
                  {activeTimeline?.benchmark.mode === 'equal_weight_targets' && (
                    <div className="mt-1">
                      <strong className="text-slate-900">组合口径：</strong>
                      日度等权价格回报组合（{activeTimeline.benchmark.components.map((component) => `${component.name} ${pct(component.weight)}`).join('、')}）；不做汇率换算或总收益替代。
                    </div>
                  )}
                  {dxyFormulaFallback && (
                    <div className="mt-1 text-amber-800">
                      <strong>美元口径：</strong>DXY 由 ICE 公开权重和 ECB 每日参考汇率复算，不是 ICE 官方收盘，也不是 ETF 代理。
                    </div>
                  )}
                  <div className="mt-1"><strong className="text-slate-900">所选区间：</strong>{activeTimeline ? `${activeTimeline.visibleRange.startDate} — ${activeTimeline.visibleRange.endDate}` : '—'}</div>
                  <div className="mt-1"><strong className="text-slate-900">公式：</strong>相对趋势与相对动量以 100 为分界；指数目标使用价格指数口径。</div>
                </div>
                {aiSupplyChainItems.length > 0 && (
                  <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 px-4 py-3">
                    <div className="mb-2 text-sm font-semibold text-slate-900">AI 产业链观察顺序</div>
                    <Space size={[6, 8]} wrap>
                      {aiSupplyChainItems.map((item) => (
                        <Tooltip key={item.targetKey} title={item.taxonomy?.isAggregate ? '综合主题可能与产业链其他环节存在成分重叠。' : item.taxonomy?.representation === 'etf_price_proxy' ? '使用场内 ETF 的前复权价格代理对应行业指数。' : '行业价格指数，不使用 ETF 代理。'}>
                          <Tag color={stageTagColors[item.taxonomy?.stage || '']}>
                            {item.taxonomy?.order}. {item.taxonomy?.stage} · {item.symbol}
                          </Tag>
                        </Tooltip>
                      ))}
                    </Space>
                    <div className="mt-2 text-xs leading-5 text-slate-600">顺序为资源 → 能源 → 芯片 → 算力数据 → 软件应用 → AI综合主题。下方“全量资产关联”描述共同基准下的同步性，不是因果或交易信号。</div>
                  </div>
                )}
                {usesEtfPriceProxy && (
                  <Alert
                    type="warning"
                    showIcon
                    message="当前图使用场内 ETF 的前复权价格代理相应行业指数：这是为了在行业指数历史源不可用时仍可绘制可验证轨迹，不会把 ETF 误标为行业价格指数。"
                  />
                )}
                {selectedAssociation ? (
                  <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4">
                    <div className="mb-3 text-sm font-semibold text-slate-900">关联对照摘要</div>
                    <Row gutter={[12, 12]}>
                      <Col xs={12} sm={8}><Statistic title="相对收益相关" value={decimal(selectedAssociation.relativeReturnCorrelation)} /></Col>
                      <Col xs={12} sm={8}><Statistic title="同象限比例" value={pct(selectedAssociation.sameQuadrantRatio)} /></Col>
                      <Col xs={12} sm={8}><Statistic title="最新坐标距离" value={decimal(selectedAssociation.latestCoordinateDistance, 2)} /></Col>
                    </Row>
                    <p className="mb-0 mt-3 text-xs leading-5 text-slate-600">基于所选区间、共同基准后的相对价格与 RRG 坐标；它描述同步程度，不是因果关系或交易信号。</p>
                  </div>
                ) : (
                  <Alert
                    type={draft.comparisonTargetKeys.length === 2 ? 'warning' : 'info'}
                    showIcon
                    message={draft.comparisonTargetKeys.length === 2
                      ? '所选对照暂不能计算关联摘要：至少一个标的尚未达到有效 RRG 样本门槛。'
                      : '选择两个研究标的后，这里将展示相对收益相关、同象限比例和最新坐标距离。'}
                  />
                )}
              </div>
            )}
          </Card>
        </Col>
      </Row>

      {activeIndustryMarket && activeTimeline && (
        <IndustryRotationHistoryPanel
          market={activeIndustryMarket}
          frequency={draft.frequency}
          endDate={endDate}
          items={activeTimeline.items}
        />
      )}

      {associationRows.length > 0 && (
        <Card title="全量资产关联" extra={<span className="text-xs text-slate-500">同一共同基准与当前观察区间</span>}>
          <Table
            size="small"
            rowKey="key"
            dataSource={associationRows}
            pagination={false}
            scroll={{ x: 760 }}
            columns={[
              { title: '对照组合', dataIndex: 'pair', key: 'pair', width: 230 },
              { title: '相对收益相关', dataIndex: 'relativeReturnCorrelation', key: 'correlation', align: 'right', render: (value: number | null) => decimal(value) },
              { title: '同象限比例', dataIndex: 'sameQuadrantRatio', key: 'quadrant', align: 'right', render: (value: number | null) => pct(value) },
              { title: '最新坐标距离', dataIndex: 'latestCoordinateDistance', key: 'distance', align: 'right', render: (value: number | null) => decimal(value, 2) },
              { title: '对齐节点', dataIndex: 'alignedPointCount', key: 'points', align: 'right' },
            ]}
          />
          <p className="mb-0 mt-3 text-xs leading-5 text-slate-500">相关与象限同步只描述相对轮动的共同变化，不代表资产之间存在因果关系或可直接交易的信号。</p>
        </Card>
      )}

      <Card
        title="研究标的数据状态"
        extra={timelineNeedsReload
          ? <Tag color="warning">配置已变更</Tag>
          : activeTimeline?.refreshRecommended ? <Tag color="warning">建议刷新行情</Tag> : <Tag color="success">数据状态已载入</Tag>}
      >
        {timelineItems.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={timelineNeedsReload ? '当前配置与已载入报告不一致；请点击“载入区间”。' : '载入或刷新研究后显示标的状态'} /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {timelineItems.map((item) => {
              const readiness = readinessMeta[item.readiness]
              const freshness = freshnessMeta[item.freshness]
              const latest = item.points[item.points.length - 1]
              return (
                <div key={item.targetKey} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium text-slate-950">{item.name}</div>
                      <div className="mt-0.5 font-mono text-xs text-slate-500">{item.symbol}</div>
                    </div>
                    {item.isCurrentHolding && <Tag color="blue">持仓</Tag>}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1"><Tag color={readiness.color}>{readiness.label}</Tag><Tag color={freshness.color}>{freshness.label}</Tag>{item.targetType === 'index' && <Tag color="purple">价格指数</Tag>}{item.taxonomy?.representation === 'etf_price_proxy' && <Tag color="blue">ETF价格代理</Tag>}{item.taxonomy && <Tag color={stageTagColors[item.taxonomy.stage]}>{item.taxonomy.stage}</Tag>}</div>
                  <div className="mt-2 text-xs leading-5 text-slate-600">
                    <div>{item.sampleDays} 个交易日 · 截止 {item.assetAsOfDate || '—'}</div>
                    <div>来源：{item.sourceProviders.join(' / ') || '未验证'}</div>
                    <div>当前：{latest ? `${latest.quadrant} · (${latest.relativeTrend.toFixed(2)}, ${latest.relativeMomentum.toFixed(2)})` : '无有效坐标'}</div>
                    {item.blockers[0] && <Tooltip title={item.blockers.join('；')}><span className="cursor-help text-amber-700">{item.blockers[0]}</span></Tooltip>}
                    {item.taxonomy && <a className="mt-1 inline-block text-blue-700 hover:text-blue-900" href={item.taxonomy.methodologyUrl} target="_blank" rel="noreferrer">查看指数编制口径</a>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      <Card
        title="指定区间相对轮动"
        extra={<span className="text-xs text-slate-500">横轴：相对趋势；纵轴：相对动量；100 为分界</span>}
        styles={{ body: { padding: 0 } }}
      >
        {loading && !activeTimeline ? <div className="flex h-[520px] items-center justify-center"><Spin size="large" /></div> : canDraw && activeTimeline ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 px-5 py-3 text-xs text-slate-600">
              <span>头部日期 <strong className="text-slate-900">{headDate}</strong></span>
              <span>{activeAtHead} / {activeTimeline.items.length} 个标的拥有有效轨迹</span>
              <span>{activeTimeline.benchmark.sourceProviders.join(' / ') || '基准来源待验证'}</span>
            </div>
            <div className="px-1 sm:px-3">
              <RotationChart items={activeTimeline.items} headDate={headDate} tailLength={tailLength} loading={loading} reducedMotion={reducedMotion} />
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
                        aria-label={playing ? '暂停专题轮动动画' : '播放专题轮动动画'}
                        icon={playing ? <PauseOutlined /> : <CaretRightOutlined />}
                        onClick={togglePlayback}
                      />
                      <Segmented
                        size="small"
                        aria-label="专题轮动播放速度"
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
                    aria-label="专题轮动图头部日期"
                  />
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-700">尾巴长度</span>
                    <span className="font-mono text-slate-500">{tailLength} {draft.frequency === 'weekly' ? '周' : '日'}</span>
                  </div>
                  <Slider
                    min={draft.frequency === 'weekly' ? 4 : 5}
                    max={draft.frequency === 'weekly' ? 52 : 120}
                    value={tailLength}
                    tooltip={{ formatter: (value) => `${value} ${draft.frequency === 'weekly' ? '周' : '日'}` }}
                    onChange={(value) => setTailLengths((current) => ({ ...current, [draft.frequency]: value }))}
                    aria-label="专题轨迹尾巴长度"
                  />
                  <div className="text-[11px] leading-4 text-slate-500">尾巴越长，越容易观察完整轮动方向；播放时只移动头部。</div>
                </div>
              </div>
              {reducedMotion && <div className="mt-3 text-xs text-slate-500">已遵循系统“减少动态效果”设置：时间仍会推进，图形过渡已关闭。</div>}
            </div>
          </>
        ) : (
          <Empty className="py-16" image={Empty.PRESENTED_IMAGE_SIMPLE} description={timelineNeedsReload ? '当前配置已变更；旧轮动图不会复用。请点击“载入区间”。' : '当前区间没有可绘制轨迹；请点击“刷新研究行情”补齐指定标的与共同基准。'} />
        )}
      </Card>
      {refreshing && <Progress percent={60} showInfo={false} strokeColor="#1d4ed8" />}
    </section>
  )
}
