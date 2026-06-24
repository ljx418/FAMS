import React, { useState, useEffect } from 'react'
import { Card, Row, Col, Tag, Button, Empty, Spin, Modal, message, Input } from 'antd'
import { ThunderboltOutlined, BulbOutlined, AlertOutlined, SwapOutlined, HistoryOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  getDailySuggestions,
  analyzeTarget,
  screenStocks,
  getHoldingsResearch,
  getFivdRAnalysis,
  getFivdRPortfolioSummary,
  startFivdRPortfolioRefreshOperation,
  getOperationById,
  scoreFivdRCandidates,
  saveFivdRResearchSnapshot,
  listFivdRResearchSnapshots,
  addFivdRWatch,
  listFivdRWatch,
  createFivdRRiskAlert,
  runFivdRValidationRetestAudit,
  getLatestFivdRValidationReport,
  createFivdRDataGapRemediationPlan,
  startFivdRDataGapRemediation,
  runFivdRInfrastructureAudit,
  createFivdRManualTradeDraft,
  generateTradingPlan,
  executeAdviceAction,
  type AnalysisScope,
  type HoldingResearchItem,
  type FivdRAnalysisResult,
  type FivdRCandidateBatchResult,
  type FivdRValidationFailureTaxonomy,
  type FivdRDataGapRemediationPlan,
  type FivdRResearchSnapshotList,
  type FivdRWatchList,
  type DataReliabilitySummary,
  type Suggestion,
  type StructuredAdvice,
  type SuggestionType,
  type TargetResearchResult,
  type StockScreenerResult,
  type MarketDataTraceItem,
} from '../services/analysisService'
import ProviderHealthSummary, { ProviderHealthTags, type ProviderHealthItem } from '../components/common/ProviderHealthSummary'
import ReliabilityWarnings from '../components/common/ReliabilityWarnings'
import DataGapPanel from '../components/analysis/DataGapPanel'
import FivdRStatusBanner from '../components/analysis/FivdRStatusBanner'
import CandidateScoreBreakdown from '../components/analysis/CandidateScoreBreakdown'

// 建议类型配置
const SUGGESTION_CONFIG: Record<SuggestionType, {
  icon: React.ReactNode
  color: string
  bgColor: string
  label: string
}> = {
  grid_order: {
    icon: <SwapOutlined />,
    color: '#818cf8',
    bgColor: 'rgba(129, 140, 248, 0.1)',
    label: '网格挂单',
  },
  dca_plan: {
    icon: <HistoryOutlined />,
    color: '#34d399',
    bgColor: 'rgba(52, 211, 153, 0.1)',
    label: '定投计划',
  },
  stop_loss: {
    icon: <AlertOutlined />,
    color: '#f87171',
    bgColor: 'rgba(248, 113, 113, 0.1)',
    label: '止损提醒',
  },
  take_profit: {
    icon: <ThunderboltOutlined />,
    color: '#fbbf24',
    bgColor: 'rgba(251, 191, 36, 0.1)',
    label: '止盈提醒',
  },
  rebalance: {
    icon: <SwapOutlined />,
    color: '#a78bfa',
    bgColor: 'rgba(167, 139, 250, 0.1)',
    label: '再平衡',
  },
  buy_candidate: {
    icon: <ThunderboltOutlined />,
    color: '#34d399',
    bgColor: 'rgba(52, 211, 153, 0.1)',
    label: '候选买入',
  },
  reduce_position: {
    icon: <AlertOutlined />,
    color: '#f87171',
    bgColor: 'rgba(248, 113, 113, 0.1)',
    label: '减仓观察',
  },
  hold_review: {
    icon: <BulbOutlined />,
    color: '#38bdf8',
    bgColor: 'rgba(56, 189, 248, 0.1)',
    label: '持有观察',
  },
}

// 优先级配置
const PRIORITY_CONFIG = {
  low: { color: '#34d399', label: '低' },
  medium: { color: '#fbbf24', label: '中' },
  high: { color: '#f87171', label: '高' },
}

const ACTION_LABEL: Record<string, string> = {
  buy: '买入',
  sell: '卖出',
  hold: '持有',
  rebalance: '再平衡',
  grid_order: '网格',
  dca: '定投',
}

const POSITION_ADVICE_ACTION: Record<string, { label: string; color: string }> = {
  ADD: { label: '加仓', color: '#34d399' },
  REDUCE: { label: '减仓', color: '#f87171' },
  HOLD: { label: '持有', color: '#38bdf8' },
  OBSERVE: { label: '观察', color: '#fbbf24' },
  NO_ACTION: { label: '无动作', color: '#94a3b8' },
}

const POSITION_ADVICE_CONFIDENCE: Record<string, { label: string; color: string }> = {
  high: { label: '高可信', color: '#34d399' },
  medium: { label: '中可信', color: '#38bdf8' },
  low: { label: '低可信', color: '#fbbf24' },
  insufficient: { label: '证据不足', color: '#f87171' },
}

const POSITION_ADVICE_CACHE: Record<string, { label: string; color: string }> = {
  fresh: { label: '缓存新鲜', color: '#34d399' },
  stale: { label: '缓存过期', color: '#fbbf24' },
  generating: { label: '生成中', color: '#38bdf8' },
  failed: { label: '缓存失败', color: '#f87171' },
  partial: { label: '部分结果', color: '#fbbf24' },
}

const VALUE_ASSESSMENT_STATUS: Record<string, { label: string; color: string }> = {
  available: { label: '可用', color: '#34d399' },
  partial: { label: '部分证据', color: '#fbbf24' },
  insufficient: { label: '证据不足', color: '#f87171' },
  not_applicable: { label: '不适用', color: '#94a3b8' },
}

const VALUE_CONCLUSION_LABEL: Record<string, string> = {
  undervalued_watch: '低估观察',
  reasonable: '合理区间',
  overvalued_watch: '高估观察',
  risk_review: '风险复核',
  insufficient: '证据不足',
  not_applicable: '不适用',
}

const RESEARCH_FACT_STATUS: Record<string, { label: string; color: string }> = {
  available: { label: '可用', color: '#34d399' },
  partial: { label: '部分', color: '#fbbf24' },
  missing: { label: '缺失', color: '#f87171' },
  insufficient: { label: '不足', color: '#f87171' },
  not_applicable: { label: '不适用', color: '#94a3b8' },
}

const FIVDR_CANDIDATE_DISPOSITION: Record<string, { label: string; color: string }> = {
  manual_review_eligible: { label: '可人工复核', color: '#34d399' },
  watch_candidate: { label: '观察候选', color: '#fbbf24' },
  observe_only: { label: '观察', color: '#fbbf24' },
  needs_more_evidence: { label: '补证据', color: '#f59e0b' },
  avoid: { label: '回避', color: '#f87171' },
  retire_candidate: { label: '淘汰', color: '#f87171' },
  trade_blocked: { label: '交易阻断', color: '#f87171' },
  blocked: { label: '阻断', color: '#f87171' },
}

const RELIABILITY_STATUS: Record<DataReliabilitySummary['overallStatus'], { color: string; label: string }> = {
  healthy: { color: '#34d399', label: '可靠' },
  degraded: { color: '#fbbf24', label: '降级' },
  failing: { color: '#f87171', label: '异常' },
  unknown: { color: '#818cf8', label: '未知' },
}

const ANALYSIS_PREFERENCES_KEY = 'fams.analysis.preferences'
type AnalysisSection = 'overview' | 'fivdr' | 'actions' | 'holdings' | 'risk'
type CandidateSortMode = 'evidenceAdjustedScore' | 'signalScore' | 'researchScore' | 'gapCount'
type CandidateFilterMode = 'all' | 'observable' | 'needs_more_evidence' | 'trade_blocked'
type FivdRActionReceipt = {
  id: string
  type: 'snapshot' | 'watch' | 'risk' | 'validation' | 'infra' | 'remediation' | 'draft'
  title: string
  status: 'created' | 'blocked' | 'started' | 'failed'
  detail: string
  operationId?: string
  artifactRefs?: string[]
  createdAt: string
}

const formatMoney = (value?: number) => `¥${(value || 0).toFixed(2)}`
const formatPercent = (value?: number) => `${(value || 0) >= 0 ? '+' : ''}${(value || 0).toFixed(2)}%`
const formatScore = (value?: number) => Number.isFinite(value) ? Number(value).toFixed(1) : '--'
const formatEvidenceValue = (value: number | string | null | undefined, unit?: string) => {
  if (value === null || value === undefined || value === '') return '--'
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '--'
    if (unit === 'percent') return `${(value * 100).toFixed(2)}%`
    if (unit === 'price') return formatMoney(value)
    if (unit === 'score') return value.toFixed(0)
    return Number.isInteger(value) ? String(value) : value.toFixed(3)
  }
  return String(value)
}

const MiniBacktestCurve: React.FC<{
  points?: Array<{ index: number; value: number; drawdownPercent: number }>
}> = ({ points }) => {
  if (!points || points.length === 0) {
    return (
      <div className="mt-2 flex h-24 items-center justify-center rounded border border-white/10 bg-black/10 text-xs text-gray-500">
        暂无曲线
      </div>
    )
  }

  const width = 240
  const height = 76
  const padding = 8
  const values = points.map((point) => point.value)
  const minValue = Math.min(...values)
  const maxValue = Math.max(...values)
  const valueRange = Math.max(maxValue - minValue, 1)
  const equityPath = points.map((point, index) => {
    const x = padding + (points.length === 1 ? 0 : (index / (points.length - 1)) * (width - padding * 2))
    const y = padding + ((maxValue - point.value) / valueRange) * (height - padding * 2)
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
  const drawdowns = points.map((point) => point.drawdownPercent)
  const minDrawdown = Math.min(...drawdowns, -1)
  const drawdownPath = points.map((point, index) => {
    const x = padding + (points.length === 1 ? 0 : (index / (points.length - 1)) * (width - padding * 2))
    const y = height - padding - (Math.abs(point.drawdownPercent) / Math.abs(minDrawdown)) * 18
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
  }).join(' ')
  const last = points[points.length - 1]

  return (
    <div className="mt-2 rounded border border-white/10 bg-black/10 p-2">
      <div className="mb-1 flex items-center justify-between text-xs text-gray-400">
        <span>权益 / 回撤</span>
        <span>{last.value.toFixed(0)} / {last.drawdownPercent.toFixed(2)}%</span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-24 w-full overflow-visible" role="img" aria-label="回测权益曲线">
        <path d={equityPath} fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d={drawdownPath} fill="none" stroke="#f87171" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.85" />
      </svg>
    </div>
  )
}

const formatRatioPercent = (value?: number) => `${((value || 0) * 100).toFixed(2)}%`
const formatTraceTime = (value?: string | null) => {
  if (!value) return '--'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
const formatUnknownValue = (value: unknown) => {
  if (value === null || value === undefined) return '--'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '--'
  if (Array.isArray(value)) return value.length > 0 ? value.join(' / ') : '--'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
const formatQuantity = (value?: number) => {
  if (typeof value !== 'number') return '--'
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
}
const compactId = (value?: string | null) => value ? value.slice(0, 8) : '--'
const clampScore = (value: number) => Math.max(0, Math.min(100, Math.round(value)))
const isExecutableSuggestion = (suggestion: Suggestion) => Boolean(
  suggestion.actionId &&
  suggestion.assetId &&
  (suggestion.actionType === 'buy' || suggestion.actionType === 'sell') &&
  suggestion.status !== 'executed'
)

// 建议卡片组件
const SuggestionCard: React.FC<{
  suggestion: Suggestion
  onGeneratePlan: (s: Suggestion) => void
  onExecute: (s: Suggestion) => void
  executing: boolean
  density: 'comfortable' | 'compact'
  featured?: boolean
}> = ({ suggestion, onGeneratePlan, onExecute, executing, density, featured = false }) => {
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const config = SUGGESTION_CONFIG[suggestion.type] || SUGGESTION_CONFIG.grid_order
  const priority = PRIORITY_CONFIG[suggestion.priority]
  const analysis = suggestion.parameters?.analysis
  const executable = isExecutableSuggestion(suggestion)
  const compact = density === 'compact'

  return (
    <Card
      size="small"
      className="border-l-4"
      style={{
        background: config.bgColor,
        borderColor: config.color,
        borderLeftColor: config.color,
      }}
      styles={{ body: { padding: compact ? 8 : 10, height: '100%' } }}
    >
      <div className={`flex h-full flex-col ${featured ? 'min-h-[200px]' : 'min-h-[220px]'}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className={`flex items-center gap-2 ${compact ? 'mb-1' : 'mb-1.5'}`}>
            <span style={{ color: config.color }}>{config.icon}</span>
            <span className="font-medium text-white leading-6">{suggestion.title}</span>
          </div>
          <div className={`flex flex-wrap gap-2 ${compact ? 'mb-1' : 'mb-1.5'}`}>
            <Tag color="#818cf8" style={{ marginRight: 0 }}>
              {ACTION_LABEL[suggestion.actionType || 'hold'] || '观察'}
            </Tag>
            <Tag color={suggestion.status === 'executed' ? '#34d399' : '#fbbf24'} style={{ marginRight: 0 }}>
              {suggestion.status === 'executed' ? '已记录' : '待确认'}
            </Tag>
            {suggestion.targetSymbol && (
              <Tag color="#38bdf8" style={{ marginRight: 0 }}>{suggestion.targetSymbol}</Tag>
            )}
          </div>
        </div>
        <Tag
          color={priority.color}
          style={{ marginRight: 0 }}
        >
          {priority.label}
        </Tag>
      </div>

      <p
        className={`text-sm text-gray-300 leading-6 ${compact ? 'mb-2' : 'mb-2.5'}`}
        style={featured ? {
          display: '-webkit-box',
          WebkitLineClamp: 3,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        } : undefined}
      >
        {suggestion.description}
      </p>

      <div className={`flex flex-wrap gap-2 text-xs text-gray-300 ${compact ? 'mb-2' : 'mb-2.5'}`}>
        {typeof suggestion.suggestedQuantity === 'number' && suggestion.suggestedQuantity > 0 && (
          <Tag color="#475569" style={{ marginRight: 0 }}>数量 {formatQuantity(suggestion.suggestedQuantity)}</Tag>
        )}
        {typeof suggestion.suggestedPrice === 'number' && suggestion.suggestedPrice > 0 && (
          <Tag color="#475569" style={{ marginRight: 0 }}>单价 {formatMoney(suggestion.suggestedPrice)}</Tag>
        )}
        {typeof suggestion.suggestedAmount === 'number' && suggestion.suggestedAmount > 0 && (
          <Tag color="#475569" style={{ marginRight: 0 }}>金额 {formatMoney(suggestion.suggestedAmount)}</Tag>
        )}
      </div>

      {analysis && !featured && (
        <div className={compact ? 'mb-2' : 'mb-2.5'}>
          <Button
            size="small"
            type="text"
            onClick={() => setDetailsExpanded((value) => !value)}
            style={{ color: '#94a3b8', paddingInline: 0 }}
          >
            {detailsExpanded ? '收起详细分析' : '展开详细分析'}
          </Button>
          {detailsExpanded && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-2">
              <div className="rounded bg-[#0f172a99] border border-white/10 p-2">
                <div className="text-xs text-gray-400 mb-1">基本面</div>
                <div className="text-xs text-gray-200 leading-5">{analysis.fundamental?.risk}</div>
              </div>
              <div className="rounded bg-[#0f172a99] border border-white/10 p-2">
                <div className="text-xs text-gray-400 mb-1">技术面</div>
                <div className="text-xs text-gray-200 leading-5">
                  <div>{analysis.technical?.trend}</div>
                  <div>支撑 {formatMoney(analysis.technical?.support)} / 压力 {formatMoney(analysis.technical?.resistance)}</div>
                  <div>浮盈亏 {formatPercent(analysis.technical?.pnlPercent)}</div>
                </div>
              </div>
              <div className="rounded bg-[#0f172a99] border border-white/10 p-2">
                <div className="text-xs text-gray-400 mb-1">消息面</div>
                <div className="text-xs text-gray-200 leading-5">{analysis.news?.sentiment}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {suggestion.parameters && (
        <div className={`text-xs text-gray-300 ${compact ? 'mb-2' : 'mb-2.5'}`}>
          {suggestion.type === 'grid_order' && suggestion.parameters.basePrice && (
            <span>基准价: ¥{suggestion.parameters.basePrice} | 网格数: {suggestion.parameters.gridCount}</span>
          )}
          {suggestion.type === 'dca_plan' && suggestion.parameters.amount && (
            <span>金额: {formatMoney(Number(suggestion.parameters.amount))}/{suggestion.parameters.frequency}</span>
          )}
          {suggestion.type === 'stop_loss' && suggestion.parameters.price && (
            <span>触发价: {formatMoney(Number(suggestion.parameters.price))}</span>
          )}
        </div>
      )}

      <div className={`mt-auto flex flex-wrap items-center gap-1.5 ${compact ? 'pt-0' : 'pt-0.5'}`}>
        <Button
          size="small"
          icon={<BulbOutlined />}
          onClick={() => onGeneratePlan(suggestion)}
          type="primary"
          style={{ background: config.color, borderColor: config.color }}
        >
          生成计划
        </Button>
        {executable && (
          <Button
            size="small"
            loading={executing}
            onClick={() => onExecute(suggestion)}
          >
            记录交易
          </Button>
        )}
        {!suggestion.assetId && suggestion.actionType === 'buy' && (
          <Tag color="#fbbf24" style={{ marginRight: 0 }}>需先加入资产</Tag>
        )}
      </div>
      </div>
    </Card>
  )
}

// 风险指示器组件
const RiskIndicator: React.FC<{ level: 'low' | 'medium' | 'high' }> = ({ level }) => {
  const config = {
    low: { color: '#34d399', label: '低风险', width: '33%' },
    medium: { color: '#fbbf24', label: '中等风险', width: '66%' },
    high: { color: '#f87171', label: '高风险', width: '100%' },
  }[level]

  return (
    <div className="mb-4">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-gray-300">风险等级</span>
        <span style={{ color: config.color }}>{config.label}</span>
      </div>
      <div className="h-2 bg-[#1a1a2e] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: config.width, background: config.color }}
        />
      </div>
    </div>
  )
}

const ChoicePills = <T extends string>({
  value,
  onChange,
  options,
  compact = false,
  noWrap = false,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ label: string; value: T }>
  compact?: boolean
  noWrap?: boolean
}) => (
  <div className={`inline-flex rounded-xl border border-white/10 bg-[#161629] p-1 ${noWrap ? 'flex-nowrap overflow-x-auto whitespace-nowrap' : 'flex-wrap'} ${compact ? 'gap-1' : 'gap-1.5'}`}>
    {options.map((option) => {
      const active = option.value === value
      return (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={`rounded-lg px-3 py-1.5 text-sm transition ${
            active
              ? 'bg-[#2563eb] text-white shadow-[0_0_0_1px_rgba(96,165,250,0.35)]'
              : 'text-gray-300 hover:bg-white/5 hover:text-white'
          }`}
          style={{ fontWeight: active ? 600 : 400 }}
        >
          {option.label}
        </button>
      )
    })}
  </div>
)

const AnalysisQuickPanel: React.FC<{
  summary: string
  riskLevel: 'low' | 'medium' | 'high'
  suggestionsCount: number
  highPriorityCount: number
  pendingCount: number
  executedCount: number
  dataReliability: DataReliabilitySummary | null
  activeQuery: string
  overallScore: number
  holdingsCount: number
  scope?: string
  requiresConfirmation?: boolean
  onJumpToSuggestions: (filter: 'all' | 'high' | 'executable' | 'buy' | 'sell') => void
  topPending: Suggestion[]
  topExecuted: Suggestion[]
}> = ({
  summary,
  riskLevel,
  suggestionsCount,
  highPriorityCount,
  pendingCount,
  executedCount,
  dataReliability,
  activeQuery,
  overallScore,
  holdingsCount,
  scope,
  requiresConfirmation,
  onJumpToSuggestions,
  topPending,
  topExecuted,
}) => (
  <div className="space-y-3">
    <Card
      size="small"
      className="bg-[#1a1a2e] border-[surface-border]"
      styles={{ body: { padding: 14 } }}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-xs text-gray-400 mb-1">执行驾驶舱</div>
          <div className="text-sm text-white leading-6">
            {summary || '暂无摘要'}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Tag color={riskLevel === 'high' ? '#f87171' : riskLevel === 'medium' ? '#fbbf24' : '#34d399'}>
            风险 {riskLevel}
          </Tag>
          {dataReliability && (
            <Tag color={RELIABILITY_STATUS[dataReliability.overallStatus].color}>
              数据 {RELIABILITY_STATUS[dataReliability.overallStatus].label}
            </Tag>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="rounded-lg border border-white/10 bg-[#161629] p-3">
          <div className="text-xs text-gray-400 mb-1">建议总数</div>
          <div className="text-2xl font-bold text-white">{suggestionsCount}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#161629] p-3">
          <div className="text-xs text-gray-400 mb-1">高优先级</div>
          <div className="text-2xl font-bold text-white">{highPriorityCount}</div>
        </div>
      </div>
      <div className="text-xs text-gray-400 mb-2">建议执行状态</div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        <button
          type="button"
          className="rounded-lg border border-white/10 bg-[#161629] p-3 text-left transition hover:border-[#fbbf24]"
          onClick={() => onJumpToSuggestions('executable')}
        >
          <div className="text-xs text-gray-400 mb-1">待执行</div>
          <div className="text-2xl font-bold text-white">{pendingCount}</div>
        </button>
        <button
          type="button"
          className="rounded-lg border border-white/10 bg-[#161629] p-3 text-left transition hover:border-[#34d399]"
          onClick={() => onJumpToSuggestions('all')}
        >
          <div className="text-xs text-gray-400 mb-1">已记录</div>
          <div className="text-2xl font-bold text-white">{executedCount}</div>
        </button>
      </div>

      {topPending.length > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-400 mb-2">待执行重点</div>
          <div className="space-y-2">
            {topPending.slice(0, 2).map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full rounded-lg border border-white/10 bg-[#161629] p-2.5 text-left transition hover:border-[#fbbf24]"
                onClick={() => onJumpToSuggestions(item.actionType === 'buy' ? 'buy' : item.actionType === 'sell' ? 'sell' : 'executable')}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-white">{item.title}</div>
                  <Tag color={PRIORITY_CONFIG[item.priority].color}>{PRIORITY_CONFIG[item.priority].label}</Tag>
                </div>
                <div className="text-xs text-gray-300 mt-1">
                  {ACTION_LABEL[item.actionType || 'hold'] || '观察'}
                  {item.targetSymbol ? ` · ${item.targetSymbol}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {topExecuted.length > 0 && (
        <div>
          <div className="text-xs text-gray-400 mb-2">最近已记录</div>
          <div className="space-y-2">
            {topExecuted.slice(0, 2).map((item) => (
              <button
                key={item.id}
                type="button"
                className="w-full rounded-lg border border-white/10 bg-[#161629] p-2.5 text-left transition hover:border-[#34d399]"
                onClick={() => onJumpToSuggestions('all')}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-medium text-white">{item.title}</div>
                  <Tag color="#34d399">已记录</Tag>
                </div>
                <div className="text-xs text-gray-300 mt-1">
                  {ACTION_LABEL[item.actionType || 'hold'] || '观察'}
                  {item.targetSymbol ? ` · ${item.targetSymbol}` : ''}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {activeQuery && (
        <div className="mt-3 rounded-lg border border-white/10 bg-[#161629] p-3">
          <div className="text-xs text-gray-400 mb-1">当前研究</div>
          <div className="text-sm text-white">{activeQuery}</div>
        </div>
      )}
    </Card>

    <Card
      size="small"
      className="bg-[#1a1a2e] border-[surface-border]"
      styles={{ body: { padding: 14 } }}
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-white/10 bg-[#161629] p-3">
          <div className="text-xs text-gray-400 mb-1">综合评分</div>
          <div className="text-3xl font-bold text-white">{overallScore.toFixed(1)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#161629] p-3">
          <div className="text-xs text-gray-400 mb-1">持仓研究</div>
          <div className="text-3xl font-bold text-white">{holdingsCount}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#161629] p-3">
          <div className="text-xs text-gray-400 mb-1">建议范围</div>
          <div className="text-lg font-semibold text-white">{scope || 'portfolio'}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-[#161629] p-3">
          <div className="text-xs text-gray-400 mb-1">人工确认</div>
          <div className="text-lg font-semibold text-white">{requiresConfirmation ? '需要' : '可直接采纳'}</div>
        </div>
      </div>
      {dataReliability && (
        <div className="border-t border-white/10 mt-3 pt-3">
          <div className="text-xs text-gray-400 mb-2">数据源状态</div>
          <ProviderHealthTags items={dataReliability.providerSummary as ProviderHealthItem[]} />
        </div>
      )}
    </Card>
  </div>
)

const MarketDataTracePanel: React.FC<{
  items: MarketDataTraceItem[]
  compact?: boolean
}> = ({ items, compact = false }) => {
  const visibleItems = compact ? items.slice(0, 6) : items.slice(0, 12)
  const fallbackCount = items.filter((item) => item.fallbackUsed).length
  const warningCount = items.reduce((sum, item) => sum + (item.warnings?.length || 0), 0)

  if (items.length === 0) return null

  return (
    <div className="rounded-lg border border-white/10 bg-[#161629] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div>
          <div className="text-xs text-gray-400">行情取数快照</div>
          <div className="text-sm text-white">覆盖 {items.length} 个标的</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tag color={fallbackCount > 0 ? '#fbbf24' : '#34d399'}>回退 {fallbackCount}</Tag>
          <Tag color={warningCount > 0 ? '#fbbf24' : '#38bdf8'}>警告 {warningCount}</Tag>
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
        {visibleItems.map((item) => (
          <div key={`${item.symbol}-${item.sourceTime || item.timestamp || item.source || 'trace'}`} className="rounded-md border border-white/10 bg-black/10 p-2">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-white">{item.symbol} {item.name || ''}</div>
                <div className="truncate text-xs text-gray-400">{item.sourceLabel || item.source || '未知来源'}</div>
              </div>
              <Tag color={item.fallbackUsed ? '#fbbf24' : '#34d399'} style={{ marginRight: 0 }}>
                {item.fallbackUsed ? '回退' : '命中'}
              </Tag>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-gray-300">
              <div>价格 {typeof item.price === 'number' ? formatMoney(item.price) : '--'}</div>
              <div>置信 {typeof item.confidenceScore === 'number' ? `${(item.confidenceScore * 100).toFixed(0)}%` : '--'}</div>
              <div className="col-span-2">时间 {formatTraceTime(item.sourceTime || item.timestamp)}</div>
            </div>
          </div>
        ))}
      </div>
      {items.length > visibleItems.length && (
        <div className="mt-2 text-xs text-gray-400">另有 {items.length - visibleItems.length} 个标的已纳入快照。</div>
      )}
    </div>
  )
}

// 交易计划弹窗
const TradingPlanModal: React.FC<{
  visible: boolean
  onClose: () => void
  plan: any
}> = ({ visible, onClose, plan }) => {
  if (!plan) return null

  return (
    <Modal
      title={<span className="text-white">交易计划</span>}
      open={visible}
      onCancel={onClose}
      footer={[
        <Button key="close" onClick={onClose}>
          关闭
        </Button>,
        <Button key="execute" type="primary" disabled>
          执行计划
        </Button>,
      ]}
      width={600}
    >
      {plan.actions?.map((action: any, index: number) => (
        <div
          key={index}
          className="flex items-center justify-between p-3 mb-2 rounded-lg"
          style={{ background: '#1a1a2e' }}
        >
          <div>
            <span className="text-white font-medium">{action.symbol}</span>
            <Tag
              color={action.action === 'buy' ? '#34d399' : action.action === 'sell' ? '#f87171' : '#818cf8'}
              className="ml-2"
            >
              {action.action === 'buy' ? '买入' : action.action === 'sell' ? '卖出' : '持有'}
            </Tag>
          </div>
          <div className="text-right">
            <div className="text-white">
              {action.quantity > 0 ? `${action.quantity}股 @ ¥${action.price}` : '--'}
            </div>
            <div className="text-xs text-gray-300">{action.reason}</div>
          </div>
        </div>
      ))}
    </Modal>
  )
}

const FIVDR_STATUS: Record<string, { color: string; label: string }> = {
  available: { color: '#34d399', label: '可用' },
  partial: { color: '#fbbf24', label: '部分可用' },
  blocked: { color: '#f87171', label: '阻断' },
  pass: { color: '#34d399', label: '通过' },
  completed: { color: '#34d399', label: '完成' },
  insufficient: { color: '#fbbf24', label: '证据不足' },
  skipped: { color: '#94a3b8', label: '跳过' },
}

const FIVDR_CAPABILITY: Record<string, { color: string; label: string }> = {
  RESEARCH_READY: { color: '#34d399', label: '研究可用' },
  OBSERVE_ONLY: { color: '#fbbf24', label: '仅可观察' },
  DATA_INSUFFICIENT: { color: '#f59e0b', label: '数据不足' },
  TRADE_BLOCKED: { color: '#f87171', label: '交易阻断' },
  SYSTEM_UNAVAILABLE: { color: '#94a3b8', label: '系统不可用' },
}

const FivdRActionReceiptPanel: React.FC<{
  receipts: FivdRActionReceipt[]
  onOpenOperations?: () => void
}> = ({ receipts, onOpenOperations }) => {
  if (receipts.length === 0) return null

  const colorByStatus: Record<FivdRActionReceipt['status'], string> = {
    created: '#34d399',
    started: '#38bdf8',
    blocked: '#f87171',
    failed: '#f87171',
  }

  return (
    <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs text-sky-100">最近 FIVD-R 动作产物</div>
          <div className="text-[11px] text-gray-400">快照、观察、风险提醒和审计只产生研究/观察产物，不产生交易动作。</div>
        </div>
        <Button size="small" onClick={onOpenOperations}>查看任务中心</Button>
      </div>
      <div className="grid gap-2 lg:grid-cols-2">
        {receipts.slice(0, 6).map((receipt) => (
          <div key={receipt.id} className="rounded-lg border border-white/10 bg-black/10 p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm text-white">{receipt.title}</div>
              <Tag color={colorByStatus[receipt.status]} style={{ marginRight: 0 }}>{receipt.status}</Tag>
            </div>
            <div className="text-xs leading-5 text-gray-300">{receipt.detail}</div>
            <div className="mt-2 flex flex-wrap gap-1">
              <Tag color="#64748b" style={{ marginRight: 0 }}>{formatTraceTime(receipt.createdAt)}</Tag>
              {receipt.operationId && <Tag color="#38bdf8" style={{ marginRight: 0 }}>operation {compactId(receipt.operationId)}</Tag>}
              {(receipt.artifactRefs || []).slice(0, 2).map((ref) => (
                <Tag key={ref} color="#818cf8" style={{ marginRight: 0 }}>{ref}</Tag>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

const FivdRPanel: React.FC<{
  result: FivdRAnalysisResult | null
  onRefresh: () => void
  onSaveSnapshot?: (result: FivdRAnalysisResult) => void
  onAddWatch?: (result: FivdRAnalysisResult) => void
  onCreateRiskAlert?: (result: FivdRAnalysisResult) => void
  onRunValidationAudit?: (result: FivdRAnalysisResult) => void
  onRunInfrastructureAudit?: (result: FivdRAnalysisResult) => void
  onCreateTradeDraft?: (result: FivdRAnalysisResult) => void
  loading: boolean
  actionLoading?: string | null
}> = ({
  result,
  onRefresh,
  onSaveSnapshot,
  onAddWatch,
  onCreateRiskAlert,
  onRunValidationAudit,
  onRunInfrastructureAudit,
  onCreateTradeDraft,
  loading,
  actionLoading,
}) => {
  if (!result) {
    return (
      <Card
        title={<span className="text-white">FIVD-R 统一分析</span>}
        className="bg-[#1a1a2e] border-[surface-border]"
        extra={<Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>刷新</Button>}
      >
        {loading ? (
          <div className="flex min-h-[220px] items-center justify-center">
            <Spin tip="加载 FIVD-R 详情..." />
          </div>
        ) : (
          <Empty description={<span className="text-gray-300">暂无 FIVD-R 结果</span>} />
        )}
      </Card>
    )
  }

  const strategyValidation = result.strategyValidation as any
  const candidateDisposition = result.candidateDisposition
  const statusConfig = FIVDR_STATUS[result.summary.status] || { color: '#94a3b8', label: result.summary.status }
  const gateConfig = FIVDR_STATUS[result.evidenceGate.status] || { color: '#94a3b8', label: result.evidenceGate.status }
  const traceConfig = FIVDR_STATUS[result.agentTrace.status] || { color: '#94a3b8', label: result.agentTrace.status }
  const validationDecision = strategyValidation?.validationEvidenceMatrix?.decision
    || strategyValidation?.p4ClosureReview?.decision
    || strategyValidation?.oosMultiWindowRegimeRetest?.status
    || '--'
  const valuation = result.valuation as any
  const expectedReturn = result.expectedReturn as any
  const tradingDiscipline = result.tradingDiscipline as any
  const positionAdviceImpact = result.positionAdviceImpact as any
  const expectedReturnWindows = expectedReturn?.windows || {}
  const missingData = Array.from(new Set(result.evidenceGate.missingData || []))
  const conflictFlags = Array.from(new Set(result.evidenceGate.conflictFlags || []))
  const gateBlockedReasons = Array.from(new Set([
    ...(result.summary.blockedReasons || []),
    ...(result.evidenceGate.blockedReasons || []),
    ...(result.agentTrace.blockedReasons || []),
  ]))
  const validationMatrix = strategyValidation?.validationEvidenceMatrix as any
  const validationSummary = validationMatrix?.summary || {}
  const oosRetest = strategyValidation?.oosMultiWindowRegimeRetest as any
  const retestSummary = oosRetest?.summary || {}
  const tradeGateBlocked = result.summary.prohibitedActions.includes('ADD')
    || result.summary.prohibitedActions.includes('REDUCE')
    || gateBlockedReasons.includes('validation_evidence')
  const manualDraftBlocked = !result.manualTradeDraftAllowed || tradeGateBlocked
  const capabilityConfig = FIVDR_CAPABILITY[result.capabilityState || 'TRADE_BLOCKED']
    || { color: '#94a3b8', label: result.capabilityState || 'unknown' }
  const dataGapMeta = result.dataGapSummaryMeta || {
    total: result.dataGapSummary?.length || 0,
    blocking: result.dataGapSummary?.filter((gap) => gap.severity === 'blocking').length || 0,
    degrading: result.dataGapSummary?.filter((gap) => gap.severity === 'degrading').length || 0,
    optional: result.dataGapSummary?.filter((gap) => gap.severity === 'optional').length || 0,
    byCategory: {},
    requiredFor: {},
  }
  const valuationScore = typeof valuation?.valuation?.compositeScore === 'number'
    ? valuation.valuation.compositeScore
    : null
  const expectedReturnScore = typeof expectedReturn?.researchScore === 'number'
    ? expectedReturn.researchScore
    : Object.keys(expectedReturnWindows).length > 0
    ? clampScore(50 + Object.values(expectedReturnWindows).filter((item: any) => item?.status === 'available').length * 10)
    : null
  const disciplineScore = tradingDiscipline?.formalTradeActionAllowed
    ? 85
    : tradingDiscipline?.action || tradingDiscipline?.bucket
    ? 55
    : null
  const gapPenalty = dataGapMeta.blocking * 18 + dataGapMeta.degrading * 8
  const researchScore = clampScore(
    (result.evidenceGate.evidenceQualityScore || 0)
    + (valuationScore !== null ? (valuationScore - 50) * 0.25 : 0)
    + (expectedReturnScore !== null ? (expectedReturnScore - 50) * 0.15 : 0)
    - gapPenalty
  )
  const researchScoreLabel = researchScore >= 75
    ? '研究证据较充分'
    : researchScore >= 50
    ? '可研究但需补证据'
    : '证据不足，优先补数'
  const scoreCards = [
    {
      label: '研究评分',
      value: researchScore,
      detail: researchScoreLabel,
      color: researchScore >= 75 ? '#34d399' : researchScore >= 50 ? '#fbbf24' : '#f87171',
    },
    {
      label: '证据质量',
      value: result.evidenceGate.evidenceQualityScore,
      detail: `${dataGapMeta.blocking} blocking / ${dataGapMeta.degrading} degrading gaps`,
      color: result.evidenceGate.evidenceQualityScore >= 70 ? '#34d399' : result.evidenceGate.evidenceQualityScore >= 45 ? '#fbbf24' : '#f87171',
    },
    {
      label: '价值评分',
      value: valuationScore,
      detail: valuation?.valuation?.conclusion || (result.asset ? '估值事实不足' : '组合级不适用'),
      color: valuationScore === null ? '#94a3b8' : valuationScore >= 70 ? '#34d399' : valuationScore >= 45 ? '#fbbf24' : '#f87171',
    },
    {
      label: '预计收益',
      value: expectedReturnScore,
      detail: expectedReturn?.status || `${Object.keys(expectedReturnWindows).length} windows`,
      color: expectedReturnScore === null ? '#94a3b8' : expectedReturnScore >= 70 ? '#34d399' : expectedReturnScore >= 45 ? '#fbbf24' : '#f87171',
    },
    {
      label: '交易纪律',
      value: disciplineScore,
      detail: tradingDiscipline?.action || tradingDiscipline?.bucket || '组合级只看 gate',
      color: disciplineScore === null ? '#94a3b8' : tradeGateBlocked ? '#f87171' : '#34d399',
    },
  ]

  return (
    <Card
      title={<span className="text-white">FIVD-R 统一分析</span>}
      className="bg-[#1a1a2e] border-[surface-border]"
      extra={
        <div className="flex flex-wrap gap-2">
          <Button size="small" onClick={() => onSaveSnapshot?.(result)} loading={actionLoading === 'snapshot'}>保存快照</Button>
          <Button size="small" onClick={() => onAddWatch?.(result)} loading={actionLoading === 'watch'}>加入观察</Button>
          <Button size="small" danger onClick={() => onCreateRiskAlert?.(result)} loading={actionLoading === 'risk'}>风险提醒</Button>
          <Button size="small" onClick={() => onRunValidationAudit?.(result)} loading={actionLoading === 'validation'}>检查交易阻断</Button>
          <Button size="small" onClick={() => onRunInfrastructureAudit?.(result)} loading={actionLoading === 'infra'}>检查数据源</Button>
          <Button
            size="small"
            danger
            disabled={manualDraftBlocked}
            title={manualDraftBlocked ? 'validation_evidence 未通过，人工交易草案不可用' : '进入人工交易草案复核'}
            onClick={() => onCreateTradeDraft?.(result)}
            loading={actionLoading === 'draft'}
          >
            交易草案{manualDraftBlocked ? '已阻断' : ''}
          </Button>
          <Button size="small" icon={<ReloadOutlined />} loading={loading} onClick={onRefresh}>刷新</Button>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-4">
          <div className="grid gap-3 md:grid-cols-[1.2fr_1fr_1fr]">
            <div>
              <div className="text-xs text-red-100/75">当前可用边界</div>
              <div className="mt-1 text-base font-semibold text-white">
                {result.researchAvailable ? '可用于研究/观察' : '研究结果不完整'}，正式交易未放行
              </div>
              <div className="mt-1 text-xs leading-5 text-red-100">
                本页面不输出买入、加仓、减仓或自动交易指令。
              </div>
            </div>
            <div>
              <div className="text-xs text-red-100/75">主要阻断</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {(gateBlockedReasons.length ? gateBlockedReasons : ['validation_evidence']).slice(0, 4).map((reason) => (
                  <Tag key={reason} color="#f87171" style={{ marginRight: 0 }}>{reason}</Tag>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs text-red-100/75">下一步</div>
              <div className="mt-1 text-xs leading-5 text-red-100">
                {result.dataGapSummary?.[0]?.suggestedAction || '先检查 validation evidence 和数据源健康，再决定是否继续观察。'}
              </div>
            </div>
          </div>
        </div>
        <FivdRStatusBanner
          capabilityState={result.capabilityState}
          blockedReasons={gateBlockedReasons}
          dataGapSummary={result.dataGapSummary}
          formalTradeActionAllowed={result.formalTradeActionAllowed}
          autoTradeAllowed={result.autoTradeAllowed}
        />
        <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-xs text-sky-100/75">FIVD-R 研究评分总览</div>
              <div className="mt-1 text-sm font-medium text-white">
                {result.asset ? `${result.asset.name} 当前研究评分` : '组合当前研究评分'}
              </div>
              <div className="mt-1 text-xs leading-5 text-gray-300">
                评分只用于研究排序和证据审查；交易动作仍由 validation evidence gate 控制。
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Tag color={result.researchAvailable ? '#34d399' : '#f87171'}>research {result.researchAvailable ? 'available' : 'blocked'}</Tag>
              <Tag color={result.observeAllowed ? '#38bdf8' : '#f87171'}>observe {result.observeAllowed ? 'allowed' : 'blocked'}</Tag>
              <Tag color="#f87171">trade blocked</Tag>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-5">
            {scoreCards.map((card) => (
              <div key={card.label} className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="mb-1 text-xs text-gray-400">{card.label}</div>
                <div className="text-2xl font-semibold" style={{ color: card.color }}>
                  {card.value === null || card.value === undefined ? '--' : card.value}
                </div>
                <div className="mt-1 text-xs leading-5 text-gray-300">{card.detail}</div>
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-2 text-xs text-gray-300 md:grid-cols-3">
            <div className="rounded border border-white/10 bg-black/10 p-2">
              缺口总数 {dataGapMeta.total}，blocking {dataGapMeta.blocking}，degrading {dataGapMeta.degrading}
            </div>
            <div className="rounded border border-white/10 bg-black/10 p-2">
              validation：{gateBlockedReasons.includes('validation_evidence') ? '未通过，交易阻断' : '未发现 validation blocker'}
            </div>
            <div className="rounded border border-white/10 bg-black/10 p-2">
              下一步：{result.dataGapSummary?.[0]?.category || '继续观察'} / {result.dataGapSummary?.[0]?.severity || 'no critical gap'}
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-white/10 bg-[#161629] p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 text-xs text-gray-400">统一结论</div>
              <div className="text-base leading-6 text-white">{result.summary.conclusion}</div>
              <div className="mt-2 text-xs text-gray-500">
                {result.modelVersion} · {formatTraceTime(result.generatedAt)} · {result.runId}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Tag color={statusConfig.color}>{statusConfig.label}</Tag>
              <Tag color={capabilityConfig.color}>{capabilityConfig.label}</Tag>
              <Tag color={gateConfig.color}>Evidence {gateConfig.label}</Tag>
              <Tag color={traceConfig.color}>Trace {traceConfig.label}</Tag>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="mb-1 text-xs text-gray-400">允许动作</div>
              <div className="flex flex-wrap gap-1">
                {result.summary.allowedActions.map((action) => (
                  <Tag key={action} color="#38bdf8" style={{ marginRight: 0 }}>{action}</Tag>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="mb-1 text-xs text-gray-400">禁止动作</div>
              <div className="flex flex-wrap gap-1">
                {result.summary.prohibitedActions.map((action) => (
                  <Tag key={action} color="#f87171" style={{ marginRight: 0 }}>{action}</Tag>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="mb-1 text-xs text-gray-400">证据质量</div>
              <div className="text-2xl font-semibold text-white">{result.evidenceGate.evidenceQualityScore}</div>
            </div>
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-5">
            <div className="rounded-lg border border-white/10 bg-black/10 p-3 text-xs text-gray-300">
              <div className="mb-1 text-gray-400">研究</div>
              <Tag color={result.researchAvailable ? '#34d399' : '#f87171'}>{result.researchAvailable ? 'available' : 'blocked'}</Tag>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/10 p-3 text-xs text-gray-300">
              <div className="mb-1 text-gray-400">观察</div>
              <Tag color={result.observeAllowed ? '#34d399' : '#f87171'}>{result.observeAllowed ? 'allowed' : 'blocked'}</Tag>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/10 p-3 text-xs text-gray-300">
              <div className="mb-1 text-gray-400">正式 ADD/REDUCE</div>
              <Tag color={result.formalTradeActionAllowed ? '#34d399' : '#f87171'}>{result.formalTradeActionAllowed ? 'allowed' : 'blocked'}</Tag>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/10 p-3 text-xs text-gray-300">
              <div className="mb-1 text-gray-400">人工草案</div>
              <Tag color={result.manualTradeDraftAllowed ? '#34d399' : '#f87171'}>{result.manualTradeDraftAllowed ? 'allowed' : 'blocked'}</Tag>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/10 p-3 text-xs text-gray-300">
              <div className="mb-1 text-gray-400">自动交易</div>
              <Tag color="#f87171">{result.autoTradeAllowed ? 'allowed' : 'out of scope'}</Tag>
            </div>
          </div>
          {result.summary.blockedReasons.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {result.summary.blockedReasons.map((reason) => (
                <Tag key={reason} color="#f87171" style={{ marginRight: 0 }}>{reason}</Tag>
              ))}
            </div>
          )}
        </div>

        <DataGapPanel gaps={result.dataGapSummary} title="FIVD-R 结构化数据缺口" />

        <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs text-amber-100/70">可用性门禁</div>
              <div className="text-sm font-medium text-white">
                {tradeGateBlocked ? '当前只能研究和观察，不能生成真实交易动作' : '当前可进入人工复核草案'}
              </div>
            </div>
            <Tag color={tradeGateBlocked ? '#f87171' : '#34d399'}>
              {tradeGateBlocked ? 'Trade Gate Blocked' : 'Manual Review Ready'}
            </Tag>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="mb-1 text-xs text-gray-400">阻断原因</div>
              <div className="flex flex-wrap gap-1">
                {gateBlockedReasons.length === 0 ? (
                  <Tag color="#34d399" style={{ marginRight: 0 }}>无</Tag>
                ) : gateBlockedReasons.slice(0, 6).map((reason) => (
                  <Tag key={reason} color="#f87171" style={{ marginRight: 0 }}>{reason}</Tag>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="mb-1 text-xs text-gray-400">缺失数据</div>
              <div className="flex flex-wrap gap-1">
                {missingData.length === 0 ? (
                  <Tag color="#34d399" style={{ marginRight: 0 }}>无</Tag>
                ) : missingData.slice(0, 5).map((item) => (
                  <Tag key={item} color="#fbbf24" style={{ marginRight: 0 }}>{item}</Tag>
                ))}
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="mb-1 text-xs text-gray-400">验证样本</div>
              <div className="grid gap-1 text-xs text-gray-300">
                <div>ranked {validationSummary.rankedCandidates ?? '--'}</div>
                <div>passed {validationSummary.passedCandidates ?? '--'}</div>
                <div>failed {validationSummary.failedCandidates ?? '--'}</div>
              </div>
            </div>
            <div className="rounded-lg border border-white/10 bg-black/10 p-3">
              <div className="mb-1 text-xs text-gray-400">复验状态</div>
              <div className="grid gap-1 text-xs text-gray-300">
                <div>windows {retestSummary.windows ?? '--'} / insufficient {retestSummary.insufficientWindows ?? '--'}</div>
                <div>regime {retestSummary.regimeBuckets ?? '--'} / insufficient {retestSummary.insufficientRegimeBuckets ?? '--'}</div>
                <div>conflict {conflictFlags.length}</div>
              </div>
            </div>
          </div>
        </div>

        {result.asset && (
          <div className="rounded-xl border border-white/10 bg-[#161629] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs text-gray-400">Position 级 FIVD-R 详情</div>
                <div className="text-base font-semibold text-white">{result.asset.name}</div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Tag color="#38bdf8">{result.asset.symbol}</Tag>
                <Tag color="#818cf8">{result.asset.assetType}</Tag>
                <Tag color="#64748b">{result.asset.positionId}</Tag>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="mb-1 text-xs text-gray-400">价值评估</div>
                <div className="text-sm text-white">
                  {valuation?.valuation?.status || '--'} · {valuation?.valuation?.conclusion || '--'}
                </div>
                <div className="mt-1 text-xs leading-5 text-gray-400">
                  composite={valuation?.valuation?.compositeScore ?? '--'} · confidence={valuation?.valuation?.confidence || '--'}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="mb-1 text-xs text-gray-400">Expected Return 当前状态</div>
                <div className="text-sm text-white">{expectedReturn?.status || '--'}</div>
                <div className="mt-1 text-xs leading-5 text-gray-400">
                  {expectedReturn?.schemaVersion || 'not_available'} · sampleSize={expectedReturn?.sampleSize ?? '--'}
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="mb-1 text-xs text-gray-400">交易纪律</div>
                <div className="text-sm text-white">{tradingDiscipline?.bucket || '--'} · {tradingDiscipline?.disciplineType || tradingDiscipline?.action || '--'}</div>
                <div className="mt-1 text-xs leading-5 text-gray-400">
                  formalTradeActionAllowed={formatUnknownValue(tradingDiscipline?.formalTradeActionAllowed)}
                </div>
              </div>
            </div>
            {tradingDiscipline?.schemaVersion === 'fivd.r.trading_discipline.v2' && (
              <div className="mt-3 rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs text-gray-400">Trading Discipline Engine</div>
                    <div className="text-sm text-white">
                      {tradingDiscipline.schemaVersion} · {tradingDiscipline.reviewCadence || '--'}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Tag color="#38bdf8">{tradingDiscipline.action || '--'}</Tag>
                    <Tag color="#818cf8">{tradingDiscipline.confidence || '--'}</Tag>
                  </div>
                </div>
                <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-4">
                  <div>validFrom {formatTraceTime(tradingDiscipline.validFrom)}</div>
                  <div>validUntil {formatTraceTime(tradingDiscipline.validUntil)}</div>
                  <div>maxWeight {typeof tradingDiscipline.maxAllowedWeight === 'number' ? formatRatioPercent(tradingDiscipline.maxAllowedWeight) : '--'}</div>
                  <div>target ×{formatUnknownValue(tradingDiscipline.targetWeightMultiplier)}</div>
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                  {[
                    ['addConditions', '加仓条件'],
                    ['reduceConditions', '减仓复核'],
                    ['stopConditions', '止损/风险'],
                    ['takeProfitConditions', '止盈/再平衡'],
                    ['invalidationConditions', '失效条件'],
                  ].map(([field, label]) => {
                    const values = Array.isArray(tradingDiscipline[field]) ? tradingDiscipline[field] : []
                    return (
                      <div key={field} className="rounded border border-white/10 bg-[#161629] p-2">
                        <div className="mb-2 text-xs text-gray-400">{label}</div>
                        {values.length === 0 ? (
                          <div className="text-xs text-gray-500">无</div>
                        ) : values.slice(0, 4).map((value: string) => (
                          <div key={value} className="mb-1 text-xs leading-5 text-gray-300">{value}</div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {Object.entries(expectedReturnWindows).map(([windowName, windowValue]) => {
                const windowResult = windowValue as any
                return (
                  <div key={windowName} className="rounded-lg border border-white/10 bg-black/10 p-3">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs text-gray-400">Expected Return {windowName}</div>
                      <Tag color={windowResult.status === 'available' ? '#34d399' : '#fbbf24'} style={{ marginRight: 0 }}>
                        {windowResult.status}
                      </Tag>
                    </div>
                    {windowResult.distribution ? (
                      <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-5">
                        <div>p05 {formatRatioPercent(windowResult.distribution.p05)}</div>
                        <div>p25 {formatRatioPercent(windowResult.distribution.p25)}</div>
                        <div>p50 {formatRatioPercent(windowResult.distribution.p50)}</div>
                        <div>p75 {formatRatioPercent(windowResult.distribution.p75)}</div>
                        <div>p95 {formatRatioPercent(windowResult.distribution.p95)}</div>
                      </div>
                    ) : (
                      <div className="text-xs text-amber-100">
                        {(windowResult.blockedReasons || []).join(' / ') || 'insufficient'}
                      </div>
                    )}
                    <div className="mt-2 grid gap-2 text-xs text-gray-400 md:grid-cols-3">
                      <div>sample {windowResult.sampleSize ?? '--'}</div>
                      <div>up {typeof windowResult.probabilityUp === 'number' ? formatRatioPercent(windowResult.probabilityUp) : '--'}</div>
                      <div>maxDD {typeof windowResult.maxDrawdown === 'number' ? formatRatioPercent(windowResult.maxDrawdown) : '--'}</div>
                    </div>
                  </div>
                )
              })}
              <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="mb-2 text-xs text-gray-400">PositionAdvice Impact</div>
                <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-3">
                  <div>target ×{formatUnknownValue(positionAdviceImpact?.targetWeightMultiplier)}</div>
                  <div>validation ×{formatUnknownValue(positionAdviceImpact?.validationGateMultiplier)}</div>
                  <div>formal {formatUnknownValue(positionAdviceImpact?.formalTradeActionAllowed)}</div>
                </div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="mb-2 text-xs text-gray-400">Position 阻断原因</div>
                <div className="flex flex-wrap gap-1">
                  {(tradingDiscipline?.blockedReasons || result.summary.blockedReasons).map((reason: string) => (
                    <Tag key={reason} color="#f87171" style={{ marginRight: 0 }}>{reason}</Tag>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-white/10 bg-[#161629] p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs text-gray-400">内部验证锦标赛</div>
                <div className="text-sm text-white">{strategyValidation?.source || '暂无验证来源'}</div>
              </div>
              <Tag color={strategyValidation?.operationId ? '#38bdf8' : '#fbbf24'}>
                {strategyValidation?.operationId ? `operation:${strategyValidation.operationId}` : 'missing'}
              </Tag>
            </div>
            <div className="grid gap-2 text-sm text-gray-300 md:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="text-xs text-gray-500">验证决策</div>
                <div className="text-white">{validationDecision}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="text-xs text-gray-500">候选处置</div>
                <div className="text-white">{candidateDisposition?.status || '--'}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="text-xs text-gray-500">人工复核候选</div>
                <div className="text-white">{candidateDisposition?.summary?.eligibleManualReview ?? '--'}</div>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="text-xs text-gray-500">观察/退役</div>
                <div className="text-white">
                  {(candidateDisposition?.summary?.observeOnly ?? 0)} / {(candidateDisposition?.summary?.retiredCandidates ?? 0)}
                </div>
              </div>
            </div>
            {candidateDisposition?.candidates?.length ? (
              <div className="mt-3 space-y-2">
                {candidateDisposition.candidates.slice(0, 4).map((candidate) => (
                  <div key={candidate.candidateId} className="rounded-lg border border-white/10 bg-black/10 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-medium text-white">{candidate.name}</div>
                      <Tag color={candidate.finalDisposition === 'eligible_manual_review' ? '#34d399' : candidate.finalDisposition === 'retire_candidate' ? '#f87171' : '#fbbf24'}>
                        {candidate.finalDisposition}
                      </Tag>
                    </div>
                    <div className="mt-1 text-xs leading-5 text-gray-400">{candidate.rationale}</div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-xl border border-white/10 bg-[#161629] p-4">
            <div className="mb-3 text-xs text-gray-400">Evidence refs</div>
            <div className="max-h-[310px] space-y-2 overflow-auto pr-1">
              {result.evidenceGate.evidenceRefs.length === 0 ? (
                <div className="text-sm text-gray-400">暂无 evidenceRefs</div>
              ) : result.evidenceGate.evidenceRefs.slice(0, 12).map((ref) => (
                <div key={ref} className="rounded border border-white/10 bg-black/10 px-3 py-2 text-xs text-gray-300">
                  {ref}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-[#161629] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs text-gray-400">内部 Agent Trace</div>
              <div className="text-sm text-white">确定性编排 · {result.agentTrace.agents.length} 个 Agent</div>
            </div>
            <Tag color={traceConfig.color}>{result.agentTrace.status}</Tag>
          </div>
          <div className="grid gap-3 xl:grid-cols-5">
            {result.agentTrace.agents.map((agent) => {
              const agentConfig = FIVDR_STATUS[agent.status] || { color: '#94a3b8', label: agent.status }
              return (
                <div key={agent.id} className="rounded-lg border border-white/10 bg-black/10 p-3">
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-gray-500">#{agent.sequence}</div>
                      <div className="break-words text-sm font-medium text-white">{agent.id}</div>
                    </div>
                    <Tag color={agentConfig.color} style={{ marginRight: 0 }}>{agentConfig.label}</Tag>
                  </div>
                  <div className="text-xs leading-5 text-gray-300">{agent.output}</div>
                  {agent.blockedReasons.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {agent.blockedReasons.map((reason) => (
                        <Tag key={reason} color="#f87171" style={{ marginRight: 0 }}>{reason}</Tag>
                      ))}
                    </div>
                  )}
                  {agent.producedArtifacts.length > 0 && (
                    <div className="mt-2 text-[11px] leading-5 text-gray-500">
                      {agent.producedArtifacts.slice(0, 3).join(' / ')}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Card>
  )
}

const ValidationFailureTaxonomyPanel: React.FC<{
  report: FivdRValidationFailureTaxonomy | null
}> = ({ report }) => {
  if (!report) return null
  const summary = report.summary || {}
  const statusColor = report.status === 'ready_for_manual_review' ? '#34d399' : report.status === 'needs_more_samples' ? '#fbbf24' : '#f87171'
  return (
    <div className="rounded-xl border border-red-400/20 bg-red-400/10 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-red-100/80">Validation Evidence 失败归因</div>
          <div className="text-sm font-medium text-white">
            当前交易动作未放行，失败归因用于解释 blocker，不代表交易建议。
          </div>
          <div className="mt-1 text-[11px] text-gray-400">
            {report.sourceOperationId ? `source ${report.sourceOperationId}` : 'latest local evidence'} · {formatTraceTime(report.generatedAt)}
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Tag color={statusColor}>{report.status}</Tag>
          <Tag color="#f87171">ADD/REDUCE 禁止</Tag>
          <Tag color="#f87171">AUTO_TRADE out of scope</Tag>
        </div>
      </div>
      <div className="mb-3 grid gap-2 text-xs text-gray-300 md:grid-cols-5">
        <div className="rounded border border-white/10 bg-black/10 p-2">诊断 {summary.diagnosedCandidates ?? '--'}</div>
        <div className="rounded border border-white/10 bg-black/10 p-2">通过 {summary.passedCandidates ?? '--'}</div>
        <div className="rounded border border-white/10 bg-black/10 p-2">失败 {summary.failedCandidates ?? '--'}</div>
        <div className="rounded border border-white/10 bg-black/10 p-2">不足 {summary.insufficientCandidates ?? '--'}</div>
        <div className="rounded border border-white/10 bg-black/10 p-2">OOS窗 {summary.oosWindows ?? '--'} / 不足 {summary.insufficientWindows ?? '--'}</div>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        {report.failureCategories.slice(0, 4).map((item, index) => (
          <div key={`${item.category}-${index}`} className="rounded-lg border border-white/10 bg-black/10 p-3">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-white">{item.category}</span>
              <Tag color={item.severity === 'critical' ? '#f87171' : item.severity === 'major' ? '#fbbf24' : '#94a3b8'}>{item.severity}</Tag>
            </div>
            <div className="text-xs leading-5 text-gray-300">{item.explanation}</div>
            <div className="mt-2 text-xs leading-5 text-amber-100">下一步：{item.nextAction}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

const DataGapRemediationPanel: React.FC<{
  plan: FivdRDataGapRemediationPlan | null
  loading: boolean
  onBuildPlan: () => void
  onExecute: () => void
}> = ({ plan, loading, onBuildPlan, onExecute }) => {
  const executable = plan?.actions.filter((action) => action.status === 'executable') || []
  return (
    <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-sky-100/80">Data Gap Remediation</div>
          <div className="text-sm font-medium text-white">把结构化缺口转成补数/复验动作</div>
          <div className="mt-1 text-[11px] text-gray-400">
            只执行已有执行器支持的动作；unsupported 项不会被包装成已补齐。
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="small" loading={loading} onClick={onBuildPlan}>生成补数计划</Button>
          <Button size="small" type="primary" disabled={!executable.length} loading={loading} onClick={onExecute}>
            执行可用动作
          </Button>
        </div>
      </div>
      {!plan ? (
        <div className="text-xs text-gray-300">尚未生成补数计划。</div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1">
            <Tag color="#38bdf8">缺口 {plan.summary.totalGaps}</Tag>
            <Tag color="#34d399">可执行 {plan.summary.executableActions}</Tag>
            <Tag color="#fbbf24">计划中 {plan.summary.plannedActions}</Tag>
            <Tag color="#f87171">暂不支持 {plan.summary.unsupportedActions}</Tag>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            {plan.actions.map((action) => (
              <div key={action.actionId} className="rounded-lg border border-white/10 bg-black/10 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-white">{action.actionId}</span>
                  <Tag color={action.status === 'executable' ? '#34d399' : action.status === 'unsupported' ? '#f87171' : '#fbbf24'}>
                    {action.status}
                  </Tag>
                  {action.operationType && <Tag color="#38bdf8">{action.operationType}</Tag>}
                </div>
                <div className="text-xs leading-5 text-gray-300">{action.userMessage}</div>
                {action.symbols.length > 0 && (
                  <div className="mt-2 text-[11px] text-gray-400">symbols: {action.symbols.slice(0, 8).join(', ')}</div>
                )}
                {action.limitations.length > 0 && (
                  <div className="mt-2 text-[11px] leading-5 text-amber-100">
                    限制：{action.limitations.slice(0, 2).join('；')}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 rounded border border-white/10 bg-black/10 px-3 py-2 text-xs leading-5 text-gray-300">
            审计意见：{plan.auditOpinion.conclusion}
          </div>
        </>
      )}
    </div>
  )
}

const FivdRResearchHistoryPanel: React.FC<{
  snapshots: FivdRResearchSnapshotList | null
  watchList: FivdRWatchList | null
  loading: boolean
  onRefresh: () => void
}> = ({ snapshots, watchList, loading, onRefresh }) => {
  const snapshotItems = snapshots?.snapshots || []
  const watchItems = watchList?.reviews || []
  return (
    <div className="rounded-xl border border-indigo-400/20 bg-indigo-400/10 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-indigo-100/80">研究历史 / 观察池</div>
          <div className="text-sm font-medium text-white">保存过的 FIVD-R 快照和手动观察记录</div>
          <div className="mt-1 text-[11px] text-gray-400">
            这些记录只用于研究复盘和观察，不会创建交易草案或交易记录。
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Tag color="#38bdf8">快照 {snapshotItems.length}</Tag>
          <Tag color="#fbbf24">观察 {watchItems.length}</Tag>
          <Button size="small" loading={loading} onClick={onRefresh}>刷新</Button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-white/10 bg-black/10 p-3">
          <div className="mb-2 text-xs text-gray-300">最近快照</div>
          {snapshotItems.length === 0 ? (
            <div className="text-xs text-gray-500">暂无研究快照。</div>
          ) : (
            <div className="space-y-2">
              {snapshotItems.slice(0, 5).map((item) => (
                <div key={item.operationId} className="rounded border border-white/10 bg-[#161629] p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-white">
                      {item.asset?.name || item.asset?.symbol || item.scope || '组合快照'}
                    </div>
                    <Tag color="#64748b">{item.scope || 'unknown'}</Tag>
                  </div>
                  <div className="mt-1 text-xs leading-5 text-gray-400">
                    {item.summary?.conclusion || item.summary?.status || '研究快照'}
                  </div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    {formatTraceTime(item.createdAt)} · artifact {item.artifactRefs.length}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-white/10 bg-black/10 p-3">
          <div className="mb-2 text-xs text-gray-300">观察池</div>
          {watchItems.length === 0 ? (
            <div className="text-xs text-gray-500">暂无观察记录。</div>
          ) : (
            <div className="space-y-2">
              {watchItems.slice(0, 5).map((item) => (
                <div key={item.id} className="rounded border border-white/10 bg-[#161629] p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-white">{item.symbol || item.positionId || item.runId}</div>
                    <Tag color="#fbbf24">{item.decision}</Tag>
                  </div>
                  <div className="mt-1 text-xs leading-5 text-gray-400">{item.reason}</div>
                  <div className="mt-1 text-[11px] text-gray-500">
                    {formatTraceTime(item.createdAt)} · hash {item.recordHash.slice(0, 10)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1">
        <Tag color="#34d399">RESEARCH</Tag>
        <Tag color="#34d399">OBSERVE</Tag>
        <Tag color="#f87171">ADD/REDUCE 禁止</Tag>
        <Tag color="#f87171">AUTO_TRADE 禁止</Tag>
      </div>
    </div>
  )
}

const Analysis: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [structuredAdvice, setStructuredAdvice] = useState<StructuredAdvice | null>(null)
  const [riskLevel, setRiskLevel] = useState<'low' | 'medium' | 'high'>('medium')
  const [overallScore, setOverallScore] = useState(0)
  const [marketOutlook, setMarketOutlook] = useState('')
  const [marketDataTrace, setMarketDataTrace] = useState<MarketDataTraceItem[]>([])
  const [dataReliability, setDataReliability] = useState<DataReliabilitySummary | null>(null)
  const [disclaimer, setDisclaimer] = useState('AI/系统建议仅用于辅助决策，不自动下单，不构成投资建议；用户确认后只会写入本地交易记录，便于后续复盘。')
  const [tradingPlan, setTradingPlan] = useState<any>(null)
  const [planModalVisible, setPlanModalVisible] = useState(false)
  const [executingActionId, setExecutingActionId] = useState<string | null>(null)
  const [queryText, setQueryText] = useState('')
  const [queryScope, setQueryScope] = useState<AnalysisScope>('all')
  const [activeQuery, setActiveQuery] = useState('')
  const [matchedPositions, setMatchedPositions] = useState<number | undefined>(undefined)
  const [researchResult, setResearchResult] = useState<TargetResearchResult | null>(null)
  const [screenerQuery, setScreenerQuery] = useState('A杀后近20个交易日横盘，最近两个交易日成交量明显放大')
  const [screenerResult, setScreenerResult] = useState<StockScreenerResult | null>(null)
  const [holdingsResearch, setHoldingsResearch] = useState<HoldingResearchItem[]>([])
  const [fivdRAnalysis, setFivdRAnalysis] = useState<FivdRAnalysisResult | null>(null)
  const [selectedFivdRPosition, setSelectedFivdRPosition] = useState<FivdRAnalysisResult | null>(null)
  const [selectedFivdRSource, setSelectedFivdRSource] = useState<Partial<HoldingResearchItem> | null>(null)
  const [selectedFivdRVisible, setSelectedFivdRVisible] = useState(false)
  const [selectedFivdRLoading, setSelectedFivdRLoading] = useState(false)
  const [selectedFivdRError, setSelectedFivdRError] = useState<string | null>(null)
  const [loadingFivdRPositionId, setLoadingFivdRPositionId] = useState<string | null>(null)
  const [selectedHoldingResearch, setSelectedHoldingResearch] = useState<HoldingResearchItem | null>(null)
  const [fivdRCandidateBatch, setFivdRCandidateBatch] = useState<FivdRCandidateBatchResult | null>(null)
  const [fivdRCandidateLoading, setFivdRCandidateLoading] = useState(false)
  const [candidateSort, setCandidateSort] = useState<CandidateSortMode>('evidenceAdjustedScore')
  const [candidateFilter, setCandidateFilter] = useState<CandidateFilterMode>('all')
  const [fivdRActionLoading, setFivdRActionLoading] = useState<string | null>(null)
  const [fivdRActionReceipts, setFivdRActionReceipts] = useState<FivdRActionReceipt[]>([])
  const [fivdRRefreshOperation, setFivdRRefreshOperation] = useState<any>(null)
  const [fivdRValidationReport, setFivdRValidationReport] = useState<FivdRValidationFailureTaxonomy | null>(null)
  const [fivdRGapRemediationPlan, setFivdRGapRemediationPlan] = useState<FivdRDataGapRemediationPlan | null>(null)
  const [fivdRGapRemediationLoading, setFivdRGapRemediationLoading] = useState(false)
  const [fivdRResearchSnapshots, setFivdRResearchSnapshots] = useState<FivdRResearchSnapshotList | null>(null)
  const [fivdRWatchList, setFivdRWatchList] = useState<FivdRWatchList | null>(null)
  const [fivdRResearchHistoryLoading, setFivdRResearchHistoryLoading] = useState(false)
  const [activeSection, setActiveSection] = useState<AnalysisSection>('overview')
  const [adviceFilter, setAdviceFilter] = useState<'all' | 'high' | 'executable' | 'buy' | 'sell'>('all')
  const [adviceSort, setAdviceSort] = useState<'priority' | 'action' | 'latest'>('priority')
  const [cardDensity, setCardDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [overviewListMode, setOverviewListMode] = useState<'remaining' | 'all'>('remaining')
  const [visibleSuggestionCount, setVisibleSuggestionCount] = useState(6)
  const [reliabilityExpanded, setReliabilityExpanded] = useState(false)
  const [overviewExpanded, setOverviewExpanded] = useState(false)

  const pushFivdRActionReceipt = (receipt: Omit<FivdRActionReceipt, 'id' | 'createdAt'>) => {
    const createdAt = new Date().toISOString()
    setFivdRActionReceipts((items) => [{
      ...receipt,
      id: `${receipt.type}-${receipt.operationId || createdAt}-${items.length}`,
      createdAt,
    }, ...items].slice(0, 10))
  }

  const loadFivdRResearchHistory = async () => {
    setFivdRResearchHistoryLoading(true)
    try {
      const [snapshots, watchList] = await Promise.all([
        listFivdRResearchSnapshots(20),
        listFivdRWatch(20),
      ])
      setFivdRResearchSnapshots(snapshots)
      setFivdRWatchList(watchList)
    } catch (error) {
      console.error('Failed to load FIVD-R research history:', error)
      message.warning('FIVD-R 研究历史加载失败')
    } finally {
      setFivdRResearchHistoryLoading(false)
    }
  }

  const highPriorityCount = suggestions.filter((s) => s.priority === 'high').length
  const executableCount = suggestions.filter((s) => isExecutableSuggestion(s)).length
  const buyCount = suggestions.filter((s) => s.actionType === 'buy').length
  const sellCount = suggestions.filter((s) => s.actionType === 'sell').length
  const pendingSuggestions = suggestions.filter((s) => s.status !== 'executed')
  const executedSuggestions = suggestions.filter((s) => s.status === 'executed')
  const topPending = [...pendingSuggestions]
    .sort((left, right) => {
      const priorityRank: Record<Suggestion['priority'], number> = { high: 0, medium: 1, low: 2 }
      return priorityRank[left.priority] - priorityRank[right.priority]
    })
    .slice(0, 3)
  const topExecuted = [...executedSuggestions]
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .slice(0, 3)
  const filteredSuggestions = suggestions.filter((suggestion) => {
    if (adviceFilter === 'high') return suggestion.priority === 'high'
    if (adviceFilter === 'executable') return isExecutableSuggestion(suggestion)
    if (adviceFilter === 'buy') return suggestion.actionType === 'buy'
    if (adviceFilter === 'sell') return suggestion.actionType === 'sell'
    return true
  }).sort((left, right) => {
    const priorityRank: Record<Suggestion['priority'], number> = { high: 0, medium: 1, low: 2 }
    const actionRank: Record<string, number> = { buy: 0, sell: 1, rebalance: 2, hold: 3, grid_order: 4, dca: 5 }
    const latestDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()

    if (adviceSort === 'latest') {
      return latestDelta
    }

    if (adviceSort === 'action') {
      const actionDelta = (actionRank[left.actionType || 'hold'] ?? 99) - (actionRank[right.actionType || 'hold'] ?? 99)
      if (actionDelta !== 0) return actionDelta
      return priorityRank[left.priority] - priorityRank[right.priority]
    }

    const priorityDelta = priorityRank[left.priority] - priorityRank[right.priority]
    if (priorityDelta !== 0) return priorityDelta
    if (isExecutableSuggestion(left) !== isExecutableSuggestion(right)) {
      return isExecutableSuggestion(left) ? -1 : 1
    }
    return latestDelta
  })
  const keySuggestionCount = Math.min(filteredSuggestions.length, 3)
  const keySuggestions = filteredSuggestions.slice(0, keySuggestionCount)
  const visibleSuggestionSource = activeSection === 'overview' && overviewListMode === 'remaining'
    ? filteredSuggestions.slice(keySuggestionCount)
    : filteredSuggestions
  const visibleSuggestions = visibleSuggestionSource.slice(0, visibleSuggestionCount)
  const hasMoreSuggestions = visibleSuggestionSource.length > visibleSuggestionCount

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const sectionParam = new URLSearchParams(window.location.search).get('section')
      if (sectionParam && ['overview', 'fivdr', 'actions', 'holdings', 'risk'].includes(sectionParam)) {
        setActiveSection(sectionParam as AnalysisSection)
        return
      }
      const raw = window.localStorage.getItem(ANALYSIS_PREFERENCES_KEY)
      if (!raw) return
      const stored = JSON.parse(raw) as Partial<{
        activeSection: AnalysisSection
        adviceFilter: 'all' | 'high' | 'executable' | 'buy' | 'sell'
        adviceSort: 'priority' | 'action' | 'latest'
        cardDensity: 'comfortable' | 'compact'
      }>

      if (stored.activeSection && ['overview', 'fivdr', 'actions', 'holdings', 'risk'].includes(stored.activeSection)) {
        setActiveSection(stored.activeSection)
      }
      if (stored.adviceFilter && ['all', 'high', 'executable', 'buy', 'sell'].includes(stored.adviceFilter)) {
        setAdviceFilter(stored.adviceFilter)
      }
      if (stored.adviceSort && ['priority', 'action', 'latest'].includes(stored.adviceSort)) {
        setAdviceSort(stored.adviceSort)
      }
      if (stored.cardDensity && ['comfortable', 'compact'].includes(stored.cardDensity)) {
        setCardDensity(stored.cardDensity)
      }
    } catch (error) {
      console.warn('Failed to restore analysis preferences:', error)
    }
  }, [])

  useEffect(() => {
    loadSuggestions()
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(ANALYSIS_PREFERENCES_KEY, JSON.stringify({
        activeSection,
        adviceFilter,
        adviceSort,
        cardDensity,
      }))
    } catch (error) {
      console.warn('Failed to persist analysis preferences:', error)
    }
  }, [activeSection, adviceFilter, adviceSort, cardDensity])

  useEffect(() => {
    setVisibleSuggestionCount(activeSection === 'overview' ? 4 : 6)
  }, [activeSection, adviceFilter, adviceSort, activeQuery, suggestions.length, overviewListMode])

  useEffect(() => {
    setReliabilityExpanded(false)
  }, [activeSection, activeQuery, dataReliability?.overallStatus, dataReliability?.warningCount])

  useEffect(() => {
    setOverviewExpanded(false)
  }, [activeSection, activeQuery, structuredAdvice?.summary])

  useEffect(() => {
    setOverviewListMode('remaining')
  }, [activeSection, activeQuery, adviceFilter, adviceSort])

  useEffect(() => {
    const operationId = fivdRRefreshOperation?.operationId || fivdRRefreshOperation?.id
    const status = fivdRRefreshOperation?.status
    if (!operationId || !['queued', 'running'].includes(status)) return

    let cancelled = false
    const timer = window.setInterval(async () => {
      try {
        const operation = await getOperationById(operationId)
        if (cancelled) return
        setFivdRRefreshOperation(operation)
        if (['completed', 'succeeded', 'partial'].includes(operation.status)) {
          const nextResult = operation.result?.fivdRAnalysis
          if (nextResult) {
            setFivdRAnalysis(nextResult)
          }
          message.success('FIVD-R 完整刷新完成')
        }
        if (operation.status === 'failed') {
          message.error(operation.errorSummary || 'FIVD-R 完整刷新失败')
        }
      } catch (error) {
        console.error('Failed to poll FIVD-R refresh operation:', error)
      }
    }, 2000)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [fivdRRefreshOperation?.operationId, fivdRRefreshOperation?.id, fivdRRefreshOperation?.status])

  const loadHoldingsResearchInBackground = async () => {
    try {
      const research = await getHoldingsResearch()
      setHoldingsResearch(research)
    } catch (error) {
      console.error('Failed to load holdings research:', error)
      message.warning('持仓研究后台加载失败')
    }
  }

  const loadSuggestions = async () => {
    setLoading(true)
    try {
      const [data, fivdR, validationReport] = await Promise.all([
        getDailySuggestions(),
        getFivdRPortfolioSummary(),
        getLatestFivdRValidationReport().catch((error) => {
          console.warn('Failed to load FIVD-R validation report:', error)
          return null
        }),
      ])
      setSuggestions(data.suggestions || [])
      setStructuredAdvice(data.structuredAdvice || null)
      setFivdRAnalysis(fivdR)
      setFivdRValidationReport(validationReport)
      setFivdRGapRemediationPlan(null)
      setRiskLevel(data.riskLevel || 'medium')
      setOverallScore(data.overallScore || 0)
      setMarketOutlook(data.marketOutlook || '')
      setMarketDataTrace(data.marketDataTrace || [])
      setDataReliability(data.dataReliability || null)
      setDisclaimer(data.disclaimer || data.structuredAdvice?.disclaimer || disclaimer)
      setActiveQuery('')
      setMatchedPositions(undefined)
      setResearchResult(null)
      loadFivdRResearchHistory()
      const sectionParam = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('section')
        : null
      setActiveSection(sectionParam && ['overview', 'fivdr', 'actions', 'holdings', 'risk'].includes(sectionParam)
        ? sectionParam as AnalysisSection
        : 'overview')
      setAdviceFilter('all')
      setAdviceSort('priority')
      void loadHoldingsResearchInBackground()
    } catch (error) {
      console.error('Failed to load suggestions:', error)
      message.error('加载分析建议失败，请检查后端服务')
    } finally {
      setLoading(false)
    }
  }

  const handleAnalyzeTarget = async (value?: string) => {
    const keyword = (value ?? queryText).trim()
    if (!keyword) {
      message.warning('请输入新的标的代码、名称或板块')
      return
    }

    setLoading(true)
    try {
      const [data, research] = await Promise.all([analyzeTarget(keyword, queryScope), getHoldingsResearch()])
      setSuggestions(data.suggestions || [])
      setStructuredAdvice(data.structuredAdvice || null)
      setHoldingsResearch(research)
      setRiskLevel(data.riskLevel || 'medium')
      setOverallScore(data.overallScore || 0)
      setMarketOutlook(data.marketOutlook || '')
      setMarketDataTrace(data.quote ? [{
        symbol: data.quote.symbol,
        name: data.quote.name,
        assetType: data.quote.assetType,
        source: data.quote.source,
        sourceLabel: data.quote.sourceLabel,
        price: data.quote.price,
        priceChangePercent: data.quote.priceChangePercent,
        confidenceScore: data.quote.confidenceScore,
        sourceTime: data.quote.sourceTime || data.quote.timestamp,
        isValid: data.quote.isValid,
        fallbackUsed: data.quote.fallbackUsed || false,
        warnings: data.quote.warnings || [],
      }] : data.marketDataTrace || [])
      setDataReliability(data.dataReliability || null)
      setDisclaimer(data.disclaimer || data.structuredAdvice?.disclaimer || disclaimer)
      setActiveQuery(keyword)
      setMatchedPositions(data.matchedPositions)
      setResearchResult(data)
      setActiveSection('overview')
      setAdviceFilter('all')
      setAdviceSort('priority')
    } catch (error) {
      console.error('Failed to analyze target:', error)
      message.error('研究标的/板块失败')
    } finally {
      setLoading(false)
    }
  }

  const handleScreenStocks = async (value?: string) => {
    const keyword = (value ?? screenerQuery).trim()
    if (!keyword) {
      message.warning('请输入选股条件')
      return
    }

    setLoading(true)
    setFivdRCandidateBatch(null)
    try {
      const data = await screenStocks(keyword)
      setScreenerResult(data)
      setActiveSection('overview')
      message.success(`选股完成：匹配 ${data.matchedCount} 个候选`)
    } catch (error) {
      console.error('Failed to screen stocks:', error)
      message.error('AI选股失败')
    } finally {
      setLoading(false)
    }
  }

  const refreshFivdRAnalysis = async () => {
    setFivdRActionLoading('refresh')
    try {
      const operation = await startFivdRPortfolioRefreshOperation({ forceRefresh: true })
      setFivdRRefreshOperation(operation)
      message.success(`FIVD-R 完整刷新已提交：${(operation.operationId || operation.id || '').slice(0, 8)}`)
    } catch (error) {
      console.error('Failed to refresh FIVD-R analysis:', error)
      message.error('刷新 FIVD-R 失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const openPositionFivdR = async (holding: HoldingResearchItem) => {
    setSelectedFivdRSource(holding)
    setSelectedFivdRVisible(true)
    setSelectedFivdRPosition(null)
    setSelectedFivdRError(null)
    setSelectedFivdRLoading(true)
    setLoadingFivdRPositionId(holding.positionId)
    try {
      const data = await getFivdRAnalysis({ scope: 'position', positionId: holding.positionId })
      setSelectedFivdRPosition(data)
      setActiveSection('holdings')
    } catch (error) {
      console.error('Failed to load position FIVD-R analysis:', error)
      setSelectedFivdRError(error instanceof Error ? error.message : '加载持仓 FIVD-R 详情失败')
      message.error('加载持仓 FIVD-R 详情失败')
    } finally {
      setSelectedFivdRLoading(false)
      setLoadingFivdRPositionId(null)
    }
  }

  const handleScoreFivdRCandidates = async () => {
    if (!screenerResult?.candidates?.length) {
      message.warning('请先完成策略选股')
      return
    }
    setFivdRCandidateLoading(true)
    try {
      const data = await scoreFivdRCandidates({
        source: 'stock_screener',
        strategyQuery: screenerResult.query || screenerQuery,
        candidates: screenerResult.candidates.slice(0, 20).map((candidate) => ({
          symbol: candidate.symbol,
          name: candidate.name,
          strategyScore: candidate.score,
          strategyId: candidate.strategyId,
          evidenceRefs: [
            ...(screenerResult.asyncStrategyEvidence?.artifactRefs || []),
            ...(screenerResult.strategyTournament?.batchId ? [`strategy-tournament:${screenerResult.strategyTournament.batchId}`] : []),
          ],
        })),
      })
      setFivdRCandidateBatch(data)
      message.success(`FIVD-R 已评分 ${data.summary.analyzed} 个候选`)
    } catch (error) {
      console.error('Failed to score FIVD-R candidates:', error)
      message.error(error instanceof Error ? error.message : 'FIVD-R 候选评分失败')
    } finally {
      setFivdRCandidateLoading(false)
    }
  }

  const handleAddFivdRCandidateWatch = async (candidate: FivdRCandidateBatchResult['candidates'][number]) => {
    const loadingKey = `candidate-watch-${candidate.symbol}`
    setFivdRActionLoading(loadingKey)
    try {
      const watch = await addFivdRWatch({
        runId: fivdRCandidateBatch?.runId || 'candidate-scoring',
        symbol: candidate.symbol,
        modelResultRef: fivdRCandidateBatch?.runId,
        evidenceRefs: candidate.evidenceRefs,
        reason: `${candidate.name || candidate.symbol} 加入候选观察；evidenceAdjustedScore=${candidate.evidenceAdjustedScore ?? candidate.totalScore}；disposition=${candidate.disposition}`,
      })
      pushFivdRActionReceipt({
        type: 'watch',
        status: 'created',
        title: `候选观察：${candidate.name || candidate.symbol}`,
        detail: '已保存为候选观察线索；validation evidence 未通过时不能转换为 ADD/REDUCE。',
        operationId: watch?.operationId,
        artifactRefs: watch?.artifactRefs,
      })
      message.success(`${candidate.name || candidate.symbol} 已加入观察`)
      loadFivdRResearchHistory()
    } catch (error) {
      console.error('Failed to add candidate watch:', error)
      message.error(error instanceof Error ? error.message : '候选加入观察失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const handleSaveFivdRCandidateSnapshot = async (candidate: FivdRCandidateBatchResult['candidates'][number]) => {
    const loadingKey = `candidate-snapshot-${candidate.symbol}`
    setFivdRActionLoading(loadingKey)
    try {
      const saved = await saveFivdRResearchSnapshot({
        source: 'candidate_fivd_r_scoring',
        note: '候选级 FIVD-R 研究快照；不产生交易动作。',
        result: {
          schemaVersion: 'fivd.r.candidate_snapshot.v1',
          runId: fivdRCandidateBatch?.runId || 'candidate-scoring',
          scope: 'candidate',
          generatedAt: fivdRCandidateBatch?.generatedAt || new Date().toISOString(),
          source: fivdRCandidateBatch?.source || 'stock_screener',
          strategyQuery: fivdRCandidateBatch?.strategyQuery || screenerQuery,
          candidate,
          summary: {
            status: candidate.blockers.length > 0 ? 'partial' : 'available',
            conclusion: '候选快照仅用于研究/观察；validation_evidence 未通过时不得转换为 ADD/REDUCE。',
            allowedActions: candidate.allowedActions,
            prohibitedActions: candidate.prohibitedActions,
            blockedReasons: candidate.blockers,
          },
          evidenceGate: {
            status: candidate.blockers.includes('validation_evidence') ? 'blocked' : candidate.blockers.length > 0 ? 'partial' : 'pass',
            evidenceQualityScore: candidate.dimensions.evidenceQuality,
            missingData: candidate.dataGapSummary?.flatMap((gap) => gap.missingFields) || [],
            conflictFlags: [],
            blockedReasons: candidate.blockers,
            evidenceRefs: candidate.evidenceRefs,
          },
        },
      })
      pushFivdRActionReceipt({
        type: 'snapshot',
        status: 'created',
        title: `候选快照：${candidate.name || candidate.symbol}`,
        detail: '已保存候选研究快照；不产生交易动作，不绕过 validation evidence。',
        operationId: saved.operationId,
        artifactRefs: saved.artifactRefs,
      })
      message.success(`${candidate.name || candidate.symbol} 研究快照已保存`)
      loadFivdRResearchHistory()
    } catch (error) {
      console.error('Failed to save candidate snapshot:', error)
      message.error(error instanceof Error ? error.message : '候选快照保存失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const handleCreateFivdRCandidateRiskAlert = async (candidate: FivdRCandidateBatchResult['candidates'][number]) => {
    const loadingKey = `candidate-risk-${candidate.symbol}`
    setFivdRActionLoading(loadingKey)
    try {
      const blockers = candidate.blockers.join(' / ') || '候选需要人工复核'
      const alert = await createFivdRRiskAlert({
        symbol: candidate.symbol,
        title: `FIVD-R 候选风险复核 - ${candidate.name || candidate.symbol}`,
        message: `候选 ${candidate.name || candidate.symbol} 证据调整分 ${candidate.evidenceAdjustedScore ?? candidate.totalScore}；阻断原因：${blockers}`,
        severity: candidate.blockers.includes('validation_evidence') || candidate.blockers.includes('asset_identity_missing') ? 'warning' : 'info',
      })
      pushFivdRActionReceipt({
        type: 'risk',
        status: 'created',
        title: `候选风险提醒：${candidate.name || candidate.symbol}`,
        detail: `已创建候选风险复核提醒；阻断原因：${blockers}`,
        operationId: alert?.operationId,
        artifactRefs: alert?.artifactRefs,
      })
      message.success(`${candidate.name || candidate.symbol} 风险提醒已创建`)
    } catch (error) {
      console.error('Failed to create candidate risk alert:', error)
      message.error(error instanceof Error ? error.message : '候选风险提醒失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const handleSaveFivdRSnapshot = async (result: FivdRAnalysisResult) => {
    setFivdRActionLoading('snapshot')
    try {
      const saved = await saveFivdRResearchSnapshot({
        result,
        source: result.scope === 'position' ? 'position_fivd_r_modal' : 'portfolio_fivd_r_panel',
      })
      pushFivdRActionReceipt({
        type: 'snapshot',
        status: 'created',
        title: result.asset ? `快照：${result.asset.name}` : '组合 FIVD-R 快照',
        detail: '已保存为研究快照，可用于后续复盘；不产生交易动作。',
        operationId: saved.operationId,
        artifactRefs: saved.artifactRefs,
      })
      message.success(`FIVD-R 快照已保存：${saved.operationId.slice(0, 8)}`)
      loadFivdRResearchHistory()
    } catch (error) {
      console.error('Failed to save FIVD-R snapshot:', error)
      message.error(error instanceof Error ? error.message : '保存 FIVD-R 快照失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const handleAddFivdRWatch = async (result: FivdRAnalysisResult) => {
    setFivdRActionLoading('watch')
    try {
      const watch = await addFivdRWatch({
        runId: result.runId,
        positionId: result.asset?.positionId || null,
        symbol: result.asset?.symbol || null,
        modelResultRef: result.runId,
        evidenceRefs: result.evidenceGate.evidenceRefs,
        reason: result.asset
          ? `${result.asset.name} 加入 FIVD-R 观察，当前结论：${result.summary.conclusion}`
          : `组合加入 FIVD-R 观察，当前结论：${result.summary.conclusion}`,
      })
      pushFivdRActionReceipt({
        type: 'watch',
        status: 'created',
        title: result.asset ? `观察：${result.asset.name}` : '组合观察',
        detail: '已写入研究观察记录；观察不代表可交易。',
        operationId: watch?.operationId,
        artifactRefs: watch?.artifactRefs,
      })
      message.success('已加入 FIVD-R 观察')
      loadFivdRResearchHistory()
    } catch (error) {
      console.error('Failed to add FIVD-R watch:', error)
      message.error(error instanceof Error ? error.message : '加入观察失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const handleCreateFivdRRiskAlert = async (result: FivdRAnalysisResult) => {
    setFivdRActionLoading('risk')
    try {
      const blockedReasons = result.summary.blockedReasons.join(' / ') || '需要人工复核'
      const alert = await createFivdRRiskAlert({
        symbol: result.asset?.symbol || null,
        title: result.asset ? `FIVD-R 风险复核 - ${result.asset.name}` : 'FIVD-R 组合风险复核',
        message: `${result.summary.conclusion}；阻断原因：${blockedReasons}`,
        severity: result.summary.status === 'blocked' ? 'danger' : 'warning',
      })
      pushFivdRActionReceipt({
        type: 'risk',
        status: 'created',
        title: result.asset ? `风险提醒：${result.asset.name}` : '组合风险提醒',
        detail: `已创建风险复核提醒；触发依据：${blockedReasons}`,
        operationId: alert?.operationId,
        artifactRefs: alert?.artifactRefs,
      })
      message.success('已创建风险提醒')
    } catch (error) {
      console.error('Failed to create FIVD-R risk alert:', error)
      message.error(error instanceof Error ? error.message : '创建风险提醒失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const handleRunFivdRValidationAudit = async () => {
    setFivdRActionLoading('validation')
    try {
      const audit = await runFivdRValidationRetestAudit({ candidateLimit: 20 })
      if (audit.validationFailureTaxonomy) {
        setFivdRValidationReport(audit.validationFailureTaxonomy)
      } else {
        const latest = await getLatestFivdRValidationReport().catch(() => null)
        setFivdRValidationReport(latest)
      }
      if (audit.status === 'passed') {
        pushFivdRActionReceipt({
          type: 'validation',
          status: 'created',
          title: '交易阻断检查完成',
          detail: 'validation evidence 复验审计通过；是否放行交易仍以后端 gate 为准。',
          operationId: audit.operationId,
          artifactRefs: audit.artifactRefs,
        })
        message.success(`复验审计通过：${audit.operationId.slice(0, 8)}`)
      } else {
        pushFivdRActionReceipt({
          type: 'validation',
          status: 'blocked',
          title: '交易阻断检查未通过',
          detail: `交易动作仍被阻断：${audit.summary?.blocker || audit.status}`,
          operationId: audit.operationId,
          artifactRefs: audit.artifactRefs,
        })
        message.warning(`复验审计阻断：${audit.summary?.blocker || audit.status}`)
      }
    } catch (error) {
      console.error('Failed to run FIVD-R validation audit:', error)
      message.error(error instanceof Error ? error.message : '复验审计失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const handleRunFivdRInfrastructureAudit = async () => {
    setFivdRActionLoading('infra')
    try {
      const audit = await runFivdRInfrastructureAudit()
      if (audit.status === 'passed') {
        pushFivdRActionReceipt({
          type: 'infra',
          status: 'created',
          title: '数据源检查通过',
          detail: '基础设施审计通过；交易动作仍受 validation evidence gate 控制。',
          operationId: audit.operationId,
          artifactRefs: audit.artifactRefs,
        })
        message.success(`设施审计通过：${audit.operationId.slice(0, 8)}`)
      } else {
        const blocker = Array.isArray(audit.gates) ? audit.gates.find((gate: any) => gate.status === 'blocked') : null
        pushFivdRActionReceipt({
          type: 'infra',
          status: 'blocked',
          title: '数据源检查存在阻断',
          detail: `基础设施或数据源仍有阻断：${blocker?.id || audit.status}`,
          operationId: audit.operationId,
          artifactRefs: audit.artifactRefs,
        })
        message.warning(`设施审计阻断：${blocker?.id || audit.status}`)
      }
    } catch (error) {
      console.error('Failed to run FIVD-R infrastructure audit:', error)
      message.error(error instanceof Error ? error.message : '设施审计失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const handleBuildDataGapRemediationPlan = async () => {
    setFivdRGapRemediationLoading(true)
    try {
      const plan = await createFivdRDataGapRemediationPlan({
        source: fivdRAnalysis?.dataGapSummary?.length ? 'provided_gaps' : 'latest_summary',
        gaps: fivdRAnalysis?.dataGapSummary || undefined,
        sourceRunId: fivdRAnalysis?.runId || null,
      })
      setFivdRGapRemediationPlan(plan)
      pushFivdRActionReceipt({
        type: 'remediation',
        status: plan.summary.executableActions > 0 ? 'created' : 'blocked',
        title: '补数计划已生成',
        detail: `缺口 ${plan.summary.totalGaps} 项，可执行 ${plan.summary.executableActions} 项，暂不支持 ${plan.summary.unsupportedActions} 项。`,
      })
      message.success(`补数计划已生成：可执行 ${plan.summary.executableActions} 项`)
    } catch (error) {
      console.error('Failed to build FIVD-R data gap remediation plan:', error)
      message.error(error instanceof Error ? error.message : '生成补数计划失败')
    } finally {
      setFivdRGapRemediationLoading(false)
    }
  }

  const handleExecuteDataGapRemediation = async () => {
    const executableActionIds = fivdRGapRemediationPlan?.actions
      .filter((action) => action.status === 'executable')
      .map((action) => action.actionId) || []
    if (executableActionIds.length === 0) {
      message.warning('当前没有可执行补数动作')
      return
    }
    setFivdRGapRemediationLoading(true)
    try {
      const execution = await startFivdRDataGapRemediation({
        source: fivdRAnalysis?.dataGapSummary?.length ? 'provided_gaps' : 'latest_summary',
        gaps: fivdRAnalysis?.dataGapSummary || undefined,
        sourceRunId: fivdRAnalysis?.runId || null,
        actionIds: executableActionIds,
      })
      setFivdRGapRemediationPlan(execution.plan)
      const operationIds = execution.startedOperations.map((operation) => operation.operationId.slice(0, 8)).join(', ')
      if (execution.startedOperations.length > 0) {
        pushFivdRActionReceipt({
          type: 'remediation',
          status: 'started',
          title: '补数/复验操作已启动',
          detail: `已启动 ${execution.startedOperations.length} 个 Operation：${operationIds}`,
          operationId: execution.startedOperations[0]?.operationId,
        })
        message.success(`已启动补数/复验操作：${operationIds}`)
      } else {
        pushFivdRActionReceipt({
          type: 'remediation',
          status: 'blocked',
          title: '补数/复验未启动',
          detail: '没有启动操作；当前可能只有 planned/unsupported 动作。',
        })
        message.warning('没有启动操作；请检查是否只有 planned/unsupported 动作')
      }
    } catch (error) {
      console.error('Failed to execute FIVD-R data gap remediation:', error)
      message.error(error instanceof Error ? error.message : '执行补数计划失败')
    } finally {
      setFivdRGapRemediationLoading(false)
    }
  }

  const handleCreateFivdRTradeDraft = async (result: FivdRAnalysisResult) => {
    setFivdRActionLoading('draft')
    try {
      const draft = await createFivdRManualTradeDraft({ result })
      if (draft.ready) {
        pushFivdRActionReceipt({
          type: 'draft',
          status: 'created',
          title: '交易草案已创建',
          detail: '人工交易草案已创建；仍需人工确认。',
          operationId: draft.operationId,
          artifactRefs: draft.artifactRefs,
        })
        message.success(`交易草案已创建：${draft.operationId.slice(0, 8)}`)
      } else {
        pushFivdRActionReceipt({
          type: 'draft',
          status: 'blocked',
          title: '交易草案被门禁阻断',
          detail: `阻断原因：${(draft.blockedReasons || []).join(' / ') || draft.status}`,
          operationId: draft.operationId,
          artifactRefs: draft.artifactRefs,
        })
        message.warning(`交易草案被门禁阻断：${(draft.blockedReasons || []).join(' / ') || draft.status}`)
      }
    } catch (error) {
      console.error('Failed to create FIVD-R trade draft:', error)
      message.error(error instanceof Error ? error.message : '交易草案创建失败')
    } finally {
      setFivdRActionLoading(null)
    }
  }

  const handleGeneratePlan = async (suggestion: Suggestion) => {
    try {
      const symbols = suggestion.targetSymbol ? [suggestion.targetSymbol] : []
      const plan = await generateTradingPlan(symbols)
      setTradingPlan(plan)
      setPlanModalVisible(true)
    } catch (error) {
      message.error('生成交易计划失败')
    }
  }

  const handleExecuteAdvice = async (suggestion: Suggestion) => {
    if (!suggestion.actionId) return

    Modal.confirm({
      title: '确认记录交易',
      content: `将按建议记录${ACTION_LABEL[suggestion.actionType || 'hold'] || '交易'}：${suggestion.targetSymbol || suggestion.title}，数量 ${formatQuantity(suggestion.suggestedQuantity)}，单价 ${formatMoney(suggestion.suggestedPrice)}。此操作只写入本地交易记录，不会自动下单。`,
      okText: '确认记录',
      cancelText: '取消',
      onOk: async () => {
        setExecutingActionId(suggestion.actionId || null)
        try {
          await executeAdviceAction(suggestion.actionId!)
          message.success('已根据建议记录交易')
          await loadSuggestions()
        } catch (error) {
          console.error('Failed to execute advice action:', error)
          message.error(error instanceof Error ? error.message : '记录交易失败')
        } finally {
          setExecutingActionId(null)
        }
      },
    })
  }

  const jumpToSuggestions = (filter: 'all' | 'high' | 'executable' | 'buy' | 'sell') => {
    setActiveSection('actions')
    setAdviceFilter(filter)
  }

  const sortedFivdRCandidates = (fivdRCandidateBatch?.candidates || [])
    .filter((candidate) => {
      if (candidateFilter === 'observable') return candidate.observeAllowed || candidate.allowedActions.includes('OBSERVE')
      if (candidateFilter === 'needs_more_evidence') return candidate.disposition === 'needs_more_evidence' || candidate.blockers.includes('asset_identity_missing')
      if (candidateFilter === 'trade_blocked') return candidate.prohibitedActions.some((action) => ['ADD', 'REDUCE', 'AUTO_TRADE'].includes(action))
      return true
    })
    .slice()
    .sort((a, b) => {
      if (candidateSort === 'gapCount') return (b.dataGapSummary?.length || 0) - (a.dataGapSummary?.length || 0)
      const valueOf = (candidate: FivdRCandidateBatchResult['candidates'][number]) => {
        if (candidateSort === 'signalScore') return candidate.signalScore ?? candidate.dimensions.strategy ?? candidate.dimensions.strategyValidation ?? candidate.totalScore
        if (candidateSort === 'researchScore') return candidate.researchScore ?? candidate.totalScore
        return candidate.evidenceAdjustedScore ?? candidate.totalScore
      }
      return valueOf(b) - valueOf(a)
    })
  const holdingsCoverageSummary = (() => {
    const coverages = holdingsResearch.map((item) => item.researchCoverage).filter(Boolean) as NonNullable<HoldingResearchItem['researchCoverage']>[]
    const averageScore = coverages.length > 0
      ? Math.round(coverages.reduce((sum, item) => sum + item.score, 0) / coverages.length)
      : 0
    return {
      total: coverages.length,
      averageScore,
      ready: coverages.filter((item) => item.label === 'research_ready').length,
      partial: coverages.filter((item) => item.label === 'partial').length,
      insufficient: coverages.filter((item) => item.label === 'data_insufficient').length,
      topGaps: Array.from(new Set(coverages.map((item) => item.primaryGap).filter(Boolean) as string[])).slice(0, 5),
    }
  })()

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white mb-6">分析建议</h1>

      <Card
        size="small"
        className="bg-[#1a1a2e] border-[surface-border]"
        styles={{ body: { padding: 14 } }}
      >
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0 flex-1">
            <div className="text-xs text-gray-400 mb-2">当前结论</div>
            <div className="text-white text-base leading-6">
              {structuredAdvice?.summary || marketOutlook || '暂无分析摘要'}
            </div>
            <div className="flex flex-wrap gap-2 mt-3">
              <Tag color={riskLevel === 'high' ? '#f87171' : riskLevel === 'medium' ? '#fbbf24' : '#34d399'}>
                风险 {riskLevel}
              </Tag>
              <Tag color="#38bdf8">建议 {suggestions.length}</Tag>
              <Tag color={highPriorityCount > 0 ? '#f87171' : '#34d399'}>高优先级 {highPriorityCount}</Tag>
              <Tag color={pendingSuggestions.length > 0 ? '#fbbf24' : '#34d399'}>待执行 {pendingSuggestions.length}</Tag>
              {dataReliability && (
                <Tag color={RELIABILITY_STATUS[dataReliability.overallStatus].color}>
                  数据 {RELIABILITY_STATUS[dataReliability.overallStatus].label}
                </Tag>
              )}
            </div>
          </div>
          <div className="min-w-0 xl:w-[560px]">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
              <div className="text-sm font-medium text-white">研究新标的或板块</div>
              {activeQuery && (
                <div className="text-xs text-gray-300">
                  当前研究：{activeQuery}{typeof matchedPositions === 'number' ? ` · 匹配持仓 ${matchedPositions} 个` : ''}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-[#161629] p-3">
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <div className="text-xs text-gray-400">研究范围</div>
                <ChoicePills
                  value={queryScope}
                  onChange={setQueryScope}
                  compact
                  options={[
                    { label: '自动', value: 'all' },
                    { label: '标的', value: 'asset' },
                    { label: '板块', value: 'sector' },
                  ]}
                />
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <Input.Search
                  allowClear
                  value={queryText}
                  enterButton={<SearchOutlined />}
                  placeholder="输入新标的或板块，例如 00700.HK、恒瑞医药、AI算力、创新药、黄金"
                  onChange={(event) => setQueryText(event.target.value)}
                  onSearch={handleAnalyzeTarget}
                  style={{ maxWidth: 640, flex: 1 }}
                />
                <Button size="small" icon={<ReloadOutlined />} onClick={loadSuggestions}>
                  全部建议
                </Button>
              </div>
            </div>
            <div className="mt-3 rounded-xl border border-white/10 bg-[#161629] p-3">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-3">
                <div className="text-sm font-medium text-white">AI选股</div>
                {screenerResult && (
                  <div className="text-xs text-gray-300">
                    {screenerResult.strategy} · 候选 {screenerResult.matchedCount} / 样本 {screenerResult.universeSize}
                    {screenerResult.excludedUniverse?.length ? ` · 排除 ${screenerResult.excludedUniverse.length}` : ''}
                  </div>
                )}
              </div>
              <Input.Search
                allowClear
                value={screenerQuery}
                enterButton={<SearchOutlined />}
                placeholder="输入选股条件，例如 A杀、20日横盘、近2日放量"
                onChange={(event) => setScreenerQuery(event.target.value)}
                onSearch={handleScreenStocks}
              />
            </div>
          </div>
        </div>
      </Card>

      {loading ? (
        <div className="flex items-center justify-center h-64">
          <Spin size="large" />
        </div>
      ) : (
        <>
          <div className="lg:hidden">
            <AnalysisQuickPanel
              summary={structuredAdvice?.summary || marketOutlook || '暂无摘要'}
              riskLevel={riskLevel}
              suggestionsCount={suggestions.length}
              highPriorityCount={highPriorityCount}
              pendingCount={pendingSuggestions.length}
              executedCount={executedSuggestions.length}
              dataReliability={dataReliability}
              activeQuery={activeQuery}
              overallScore={overallScore}
              holdingsCount={holdingsResearch.length}
              scope={structuredAdvice?.scope}
              requiresConfirmation={structuredAdvice?.required_user_confirmation}
              onJumpToSuggestions={jumpToSuggestions}
              topPending={topPending}
              topExecuted={topExecuted}
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-6 min-w-0">
              <div className="hidden lg:flex items-center justify-between gap-4 rounded-2xl border border-[rgba(37,99,235,0.28)] bg-[linear-gradient(135deg,rgba(37,99,235,0.16),rgba(15,23,42,0.92))] px-4 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.28)]">
                <div className="min-w-0">
                  <div className="text-xs uppercase tracking-[0.18em] text-blue-200/70 mb-2">分区视图</div>
                  <ChoicePills
                    value={activeSection}
                    onChange={setActiveSection}
                    options={[
                      { label: `概览${researchResult ? ' / 研究' : ''}`, value: 'overview' },
                      { label: 'FIVD-R', value: 'fivdr' },
                      { label: `操作建议 ${suggestions.length}`, value: 'actions' },
                      { label: `持仓研究 ${holdingsResearch.length}`, value: 'holdings' },
                      { label: '风险与计划', value: 'risk' },
                    ]}
                  />
                </div>
                <div className="flex flex-col items-end gap-2 text-right">
                  <Tag color="#2563eb" style={{ marginRight: 0 }}>
                    当前分区 {activeSection === 'overview' ? '概览' : activeSection === 'fivdr' ? 'FIVD-R' : activeSection === 'actions' ? '建议' : activeSection === 'holdings' ? '持仓' : '风险'}
                  </Tag>
                  <div className="text-xs text-blue-100/75 whitespace-nowrap">
                    分区切换后只保留当前主视图，避免长滚动
                  </div>
                </div>
              </div>

              {activeSection === 'fivdr' && (
                <div className="space-y-3">
                  {fivdRRefreshOperation && ['queued', 'running'].includes(fivdRRefreshOperation.status) && (
                    <div className="rounded-lg border border-blue-400/20 bg-blue-400/10 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-sm text-blue-100">FIVD-R 完整刷新执行中</div>
                          <div className="mt-1 text-xs text-blue-100/70">
                            operation:{(fivdRRefreshOperation.operationId || fivdRRefreshOperation.id || '').slice(0, 8)}
                            {' · '}
                            {fivdRRefreshOperation.progressMessage || fivdRRefreshOperation.status}
                          </div>
                        </div>
                        <Tag color="#38bdf8">{fivdRRefreshOperation.progressPct ?? 0}%</Tag>
                      </div>
                    </div>
                  )}
                  <FivdRPanel
                    result={fivdRAnalysis}
                    onRefresh={refreshFivdRAnalysis}
                    onSaveSnapshot={handleSaveFivdRSnapshot}
                    onAddWatch={handleAddFivdRWatch}
                    onCreateRiskAlert={handleCreateFivdRRiskAlert}
                    onRunValidationAudit={handleRunFivdRValidationAudit}
                    onRunInfrastructureAudit={handleRunFivdRInfrastructureAudit}
                    onCreateTradeDraft={handleCreateFivdRTradeDraft}
                    loading={loading || ['queued', 'running'].includes(fivdRRefreshOperation?.status)}
                    actionLoading={fivdRActionLoading}
                  />
                  <FivdRActionReceiptPanel
                    receipts={fivdRActionReceipts}
                    onOpenOperations={() => {
                      window.location.href = '/operations'
                    }}
                  />
                  <DataGapRemediationPanel
                    plan={fivdRGapRemediationPlan}
                    loading={fivdRGapRemediationLoading}
                    onBuildPlan={handleBuildDataGapRemediationPlan}
                    onExecute={handleExecuteDataGapRemediation}
                  />
                  <FivdRResearchHistoryPanel
                    snapshots={fivdRResearchSnapshots}
                    watchList={fivdRWatchList}
                    loading={fivdRResearchHistoryLoading}
                    onRefresh={loadFivdRResearchHistory}
                  />
                  <ValidationFailureTaxonomyPanel report={fivdRValidationReport} />
                </div>
              )}

              {activeSection === 'overview' && researchResult && (
            <Card
              title={<span className="text-white">研究结论 - {researchResult.targetName || researchResult.input}</span>}
              className="bg-[#1a1a2e] border-[surface-border]"
            >
              <div className="grid gap-4 md:grid-cols-4">
                <div>
                  <div className="text-xs text-gray-300 mb-1">结论</div>
                  <div
                    className="text-2xl font-bold"
                    style={{
                      color: researchResult.recommendation === 'buy'
                        ? '#34d399'
                        : researchResult.recommendation === 'watch'
                        ? '#fbbf24'
                        : '#f87171',
                    }}
                  >
                    {researchResult.recommendationText}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-gray-300 mb-1">评分</div>
                  <div className="text-2xl font-bold text-white">{researchResult.score.toFixed(1)}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-300 mb-1">类型</div>
                  <div className="text-lg font-medium text-white">{researchResult.targetType === 'asset' ? '标的' : '板块'}</div>
                </div>
                <div>
                  <div className="text-xs text-gray-300 mb-1">行情</div>
                  <div className="text-lg font-medium text-white">
                    {researchResult.quote?.price ? `${formatMoney(researchResult.quote.price)} / ${researchResult.quote.priceChangePercent.toFixed(2)}%` : '暂无'}
                  </div>
                </div>
              </div>
              {researchResult.quote && (
                <div className="mt-4 grid gap-3 md:grid-cols-4 text-sm">
                  <div className="rounded-lg bg-[#161629] border border-white/10 p-3">
                    <div className="text-xs text-gray-400 mb-1">数据源</div>
                    <div className="text-white">{researchResult.quote.sourceLabel || researchResult.quote.source}</div>
                  </div>
                  <div className="rounded-lg bg-[#161629] border border-white/10 p-3">
                    <div className="text-xs text-gray-400 mb-1">置信度</div>
                    <div className="text-white">
                      {typeof researchResult.quote.confidenceScore === 'number'
                        ? `${(researchResult.quote.confidenceScore * 100).toFixed(0)}%`
                        : '--'}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#161629] border border-white/10 p-3">
                    <div className="text-xs text-gray-400 mb-1">取数策略</div>
                    <div className="text-white">{researchResult.quote.fallbackUsed ? '已回退' : '主源命中'}</div>
                  </div>
                  <div className="rounded-lg bg-[#161629] border border-white/10 p-3">
                    <div className="text-xs text-gray-400 mb-1">行情时间</div>
                    <div className="text-white">{formatTraceTime(researchResult.quote.sourceTime || researchResult.quote.timestamp)}</div>
                  </div>
                </div>
              )}
              <div className="mt-4 text-sm text-gray-300">{researchResult.marketOutlook}</div>
              {researchResult.dataReliability && (
                <div className="mt-4 rounded-lg border border-white/10 bg-[#161629] p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="text-xs text-gray-400">数据可靠性</div>
                    <Tag color={RELIABILITY_STATUS[researchResult.dataReliability.overallStatus].color}>
                      {RELIABILITY_STATUS[researchResult.dataReliability.overallStatus].label}
                    </Tag>
                    <Tag color="#38bdf8">
                      置信度 {typeof researchResult.dataReliability.averageConfidence === 'number'
                        ? `${(researchResult.dataReliability.averageConfidence * 100).toFixed(0)}%`
                        : '--'}
                    </Tag>
                  </div>
                  <ProviderHealthTags items={researchResult.dataReliability.providerSummary as ProviderHealthItem[]} />
                </div>
              )}
              {researchResult.warnings && researchResult.warnings.length > 0 && (
                <ReliabilityWarnings warnings={researchResult.warnings} className="mt-3 flex flex-wrap gap-2" />
              )}
              {researchResult.matchedAssets && researchResult.matchedAssets.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {researchResult.matchedAssets.slice(0, 8).map((asset) => (
                    <Tag key={asset.symbol} color="#818cf8">{asset.name} {asset.symbol}</Tag>
                  ))}
                </div>
              )}
              {researchResult.researchDetail && (
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg bg-[#161629] border border-white/10 p-3">
                    <div className="text-xs text-gray-400 mb-1">消息面</div>
                    <div className="text-sm text-white">{researchResult.researchDetail.news.summary}</div>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {researchResult.researchDetail.news.watchItems.slice(0, 3).map((item) => (
                        <Tag key={item} color="#38bdf8">{item}</Tag>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#161629] border border-white/10 p-3">
                    <div className="text-xs text-gray-400 mb-1">基本面</div>
                    <div className="text-sm text-white">{researchResult.researchDetail.fundamental.summary}</div>
                    <div className="mt-2 text-xs text-gray-300">
                      质量 {researchResult.researchDetail.fundamental.quality} · 估值 {researchResult.researchDetail.fundamental.valuation}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#161629] border border-white/10 p-3">
                    <div className="text-xs text-gray-400 mb-1">技术面 / 支撑压力</div>
                    <div className="text-sm text-white">{researchResult.researchDetail.technical.summary}</div>
                    <div className="mt-2 text-xs text-gray-300">
                      支撑 {formatMoney(researchResult.researchDetail.technical.support)} · 压力 {formatMoney(researchResult.researchDetail.technical.resistance)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-[#161629] border border-white/10 p-3">
                    <div className="text-xs text-gray-400 mb-1">结合持仓策略</div>
                    <div className="text-sm text-white">{researchResult.researchDetail.positionStrategy.strategy}</div>
                    <div className="mt-2 text-xs text-gray-300">
                      买入区间 {researchResult.researchDetail.positionStrategy.buyRange
                        ? `${formatMoney(researchResult.researchDetail.positionStrategy.buyRange.min)} - ${formatMoney(researchResult.researchDetail.positionStrategy.buyRange.max)}`
                        : '--'}
                    </div>
                  </div>
                </div>
              )}
              {researchResult.aiAdvice && (
                <div className="mt-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <Tag color={researchResult.aiAdvice.isAiGenerated ? '#34d399' : '#fbbf24'}>
                      {researchResult.aiAdvice.provider} {researchResult.aiAdvice.isAiGenerated ? 'AI' : '备用'}
                    </Tag>
                    <Tag color={researchResult.aiAdvice.status === 'available' ? '#38bdf8' : '#fbbf24'}>
                      {researchResult.aiAdvice.status === 'available' ? '有证据引用' : '数据不足'}
                    </Tag>
                    <Tag color="#818cf8">证据强度 {researchResult.aiAdvice.confidence}</Tag>
                  </div>
                  <div className="text-sm text-white">
                    {researchResult.aiAdvice.status === 'available' ? researchResult.aiAdvice.observation : '数据不足，仅能作为观察'}
                  </div>
                  <div className="mt-2 text-sm text-gray-300">
                    {researchResult.aiAdvice.summary || (researchResult.aiAdvice.reasoning || []).slice(0, 2).map((item) => item.detail).join('；')}
                  </div>
                </div>
              )}
            </Card>
	          )}

              {activeSection === 'overview' && screenerResult && (
                <Card
                  title={<span className="text-white">AI选股结果 - {screenerResult.strategy}</span>}
                  className="bg-[#1a1a2e] border-[surface-border]"
                >
                  <div className="flex flex-wrap gap-2 mb-4">
                    <Button
                      size="small"
                      type="primary"
                      loading={fivdRCandidateLoading}
                      onClick={handleScoreFivdRCandidates}
                    >
                      FIVD-R 综合评分
                    </Button>
                    <Tag color="#38bdf8">样本 {screenerResult.universeSize}</Tag>
                    <Tag color="#22d3ee">
                      {screenerResult.universeSource === 'sina_hs_a_all_a_share'
                        ? '全A股样本池'
                        : screenerResult.universeSource === 'asset_identity_resolver'
                        ? '身份解析样本池'
                        : '本地样本池'}
                    </Tag>
                    {screenerResult.scannedCount !== undefined && (
                      <Tag color="#818cf8">
                        已扫描 {screenerResult.scannedCount}
                        {screenerResult.dataQuality?.scanCoveragePercent !== undefined ? ` / 覆盖 ${screenerResult.dataQuality.scanCoveragePercent}%` : ''}
                      </Tag>
                    )}
                    <Tag color={screenerResult.matchedCount > 0 ? '#34d399' : '#fbbf24'}>匹配 {screenerResult.matchedCount}</Tag>
                    <Tag color="#22d3ee">当前显示 {screenerResult.candidates.length}</Tag>
                    {screenerResult.dataQuality && (
                      <Tag color={screenerResult.dataQuality.insufficientHistory > 0 ? '#f59e0b' : '#34d399'}>
                        K线有效 {screenerResult.dataQuality.screened} / 不足 {screenerResult.dataQuality.insufficientHistory}
                      </Tag>
                    )}
                    {Boolean(screenerResult.excludedUniverse?.length) && (
                      <Tag color="#f59e0b">已排除 {screenerResult.excludedUniverse?.length} 个非A股股票</Tag>
                    )}
                    {screenerResult.observability && (
                      <Tag color="#a78bfa">
                        provider成功率 {screenerResult.observability.providerSuccessRate}% / {screenerResult.observability.elapsedMs}ms
                      </Tag>
                    )}
                    {Object.values(screenerResult.rules).map((rule) => (
                      <Tag key={rule} color="#818cf8">{rule}</Tag>
                    ))}
                  </div>
                  {fivdRCandidateBatch && (
                    <div className="mb-4 rounded-lg border border-indigo-400/20 bg-indigo-400/10 p-3">
                      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-xs text-indigo-100">FIVD-R 候选综合评分</div>
                          <div className="text-[11px] text-gray-400">
                            {fivdRCandidateBatch.runId} · 分析 {fivdRCandidateBatch.summary.analyzed} / {fivdRCandidateBatch.summary.total}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          <Tag color="#34d399">人工复核 {fivdRCandidateBatch.summary.manualReviewEligible}</Tag>
                          <Tag color="#fbbf24">观察 {fivdRCandidateBatch.summary.observable}</Tag>
                          <Tag color="#f87171">淘汰 {fivdRCandidateBatch.summary.retired}</Tag>
                          {fivdRCandidateBatch.summary.dataGaps && (
                            <Tag color="#f59e0b">数据缺口 {fivdRCandidateBatch.summary.dataGaps.total}</Tag>
                          )}
                        </div>
                      </div>
                      <div className="mb-3 rounded border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs leading-5 text-red-100">
                        当前候选默认按 evidenceAdjustedScore 排名。高策略信号仅代表研究线索，validation_evidence 未通过时不允许 ADD / REDUCE / AUTO_TRADE。
                      </div>
                      <div className="mb-3 flex flex-col gap-2 rounded border border-white/10 bg-black/10 p-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-400">排序</span>
                          <ChoicePills
                            compact
                            value={candidateSort}
                            onChange={setCandidateSort}
                            options={[
                              { label: '证据调整分', value: 'evidenceAdjustedScore' },
                              { label: '策略信号', value: 'signalScore' },
                              { label: '研究分', value: 'researchScore' },
                              { label: '缺口数', value: 'gapCount' },
                            ]}
                          />
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs text-gray-400">筛选</span>
                          <ChoicePills
                            compact
                            value={candidateFilter}
                            onChange={setCandidateFilter}
                            options={[
                              { label: '全部', value: 'all' },
                              { label: '可观察', value: 'observable' },
                              { label: '证据不足', value: 'needs_more_evidence' },
                              { label: '交易阻断', value: 'trade_blocked' },
                            ]}
                          />
                        </div>
                      </div>
                      <div className="mb-3 overflow-x-auto rounded border border-white/10 bg-black/10">
                        <table className="w-full min-w-[820px] text-left text-xs text-gray-300">
                          <thead className="border-b border-white/10 text-gray-400">
                            <tr>
                              <th className="px-3 py-2 font-medium">排名</th>
                              <th className="px-3 py-2 font-medium">候选</th>
                              <th className="px-3 py-2 font-medium">策略/研究/调整</th>
                              <th className="px-3 py-2 font-medium">处置</th>
                              <th className="px-3 py-2 font-medium">主要阻断</th>
                              <th className="px-3 py-2 font-medium">动作边界</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedFivdRCandidates.slice(0, 20).map((candidate, index) => {
                              const disposition = FIVDR_CANDIDATE_DISPOSITION[candidate.disposition] || { label: candidate.disposition, color: '#94a3b8' }
                              return (
                                <tr key={`${candidate.symbol}-${candidate.rank}-row`} className="border-b border-white/5 last:border-b-0">
                                  <td className="px-3 py-2">#{index + 1}</td>
                                  <td className="px-3 py-2">
                                    <div className="text-white">{candidate.name}</div>
                                    <div className="text-gray-500">{candidate.symbol}</div>
                                  </td>
                                  <td className="px-3 py-2">
                                    {(candidate.signalScore ?? candidate.dimensions.strategy ?? candidate.totalScore)}
                                    {' / '}
                                    {(candidate.researchScore ?? candidate.totalScore)}
                                    {' / '}
                                    <span className="text-sky-100">{candidate.evidenceAdjustedScore ?? candidate.totalScore}</span>
                                  </td>
                                  <td className="px-3 py-2">
                                    <Tag color={disposition.color} style={{ marginRight: 0 }}>{disposition.label}</Tag>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex flex-wrap gap-1">
                                      {(candidate.blockers.length ? candidate.blockers : ['无']).slice(0, 3).map((blocker) => (
                                        <Tag key={blocker} color={blocker === '无' ? '#34d399' : '#f87171'} style={{ marginRight: 0 }}>{blocker}</Tag>
                                      ))}
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex flex-wrap gap-1">
                                      {candidate.allowedActions.slice(0, 2).map((action) => (
                                        <Tag key={action} color="#34d399" style={{ marginRight: 0 }}>{action}</Tag>
                                      ))}
                                      <Tag color="#f87171" style={{ marginRight: 0 }}>ADD/REDUCE 禁止</Tag>
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="grid gap-2 lg:grid-cols-2">
                        {sortedFivdRCandidates.map((candidate) => {
                          const disposition = FIVDR_CANDIDATE_DISPOSITION[candidate.disposition] || { label: candidate.disposition, color: '#94a3b8' }
                          return (
                            <CandidateScoreBreakdown
                              key={`${candidate.symbol}-${candidate.rank}`}
                              candidate={candidate}
                              dispositionLabel={disposition.label}
                              dispositionColor={disposition.color}
                              onSaveSnapshot={handleSaveFivdRCandidateSnapshot}
                              onAddWatch={handleAddFivdRCandidateWatch}
                              onCreateRiskAlert={handleCreateFivdRCandidateRiskAlert}
                              actionLoading={fivdRActionLoading}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {screenerResult.strategyDefinition && (
                    <div className="mb-4 rounded-lg border border-sky-400/20 bg-sky-400/10 p-3">
                      <div className="mb-1 text-xs text-sky-100">策略定义</div>
                      <div className="text-sm text-gray-200">{screenerResult.strategyDefinition.description}</div>
                      <div className="mt-2 text-xs text-gray-400">
                        最少K线 {screenerResult.strategyDefinition.requiredHistoryDays} 条 · 阈值由后端结构化返回，可用于回归验证
                      </div>
                    </div>
                  )}
                  {screenerResult.asyncStrategyEvidence && (
                    <div className="mb-4 rounded-lg border border-cyan-400/20 bg-cyan-400/10 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <div className="text-xs text-cyan-100">异步策略证据引用</div>
                        <Tag color={screenerResult.asyncStrategyEvidence.status === 'referenced' ? '#22d3ee' : '#f59e0b'}>
                          {screenerResult.asyncStrategyEvidence.status === 'referenced' ? '已引用' : '未生成'}
                        </Tag>
                        {screenerResult.asyncStrategyEvidence.backtestDays && (
                          <Tag color="#94a3b8">{screenerResult.asyncStrategyEvidence.backtestDays} 日长窗</Tag>
                        )}
                        {screenerResult.asyncStrategyEvidence.batchId && (
                          <Tag color="#64748b">批次 {screenerResult.asyncStrategyEvidence.batchId.slice(0, 8)}</Tag>
                        )}
                        <Tag color={screenerResult.asyncStrategyEvidence.usableForTradingAdvice ? '#34d399' : '#fbbf24'}>
                          {screenerResult.asyncStrategyEvidence.usableForTradingAdvice ? '可进入交易建议' : '仅可观察引用'}
                        </Tag>
                      </div>
                      <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-3">
                        <div>验收 {screenerResult.asyncStrategyEvidence.acceptanceStatus || '--'}</div>
                        <div>最佳可信 {screenerResult.asyncStrategyEvidence.bestCredibility || '--'}</div>
                        <div>最佳样本 {screenerResult.asyncStrategyEvidence.bestSampleSize ?? '--'}</div>
                        <div>扫描 {screenerResult.asyncStrategyEvidence.scannedCount ?? '--'}</div>
                        <div>有效 {screenerResult.asyncStrategyEvidence.evaluatedCount ?? '--'}</div>
                        <div>覆盖 {screenerResult.asyncStrategyEvidence.scanCoveragePercent === undefined ? '--' : `${screenerResult.asyncStrategyEvidence.scanCoveragePercent.toFixed(2)}%`}</div>
                        <div>产物 {screenerResult.asyncStrategyEvidence.artifactRefs.length}</div>
                      </div>
                      {screenerResult.asyncStrategyEvidence.validationDecision && (
                        <div className="mt-2 rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-300">
                          <div className="mb-1 flex flex-wrap gap-1">
                            <Tag color={screenerResult.asyncStrategyEvidence.validationDecision.usableForTradingAdvice ? '#34d399' : '#fbbf24'}>
                              {screenerResult.asyncStrategyEvidence.validationDecision.decision}
                            </Tag>
                            {screenerResult.asyncStrategyEvidence.validationDecision.primaryBlocker && (
                              <Tag color="#f87171">阻断 {screenerResult.asyncStrategyEvidence.validationDecision.primaryBlocker}</Tag>
                            )}
                          </div>
                          <div className="line-clamp-2">
                            {screenerResult.asyncStrategyEvidence.validationDecision.reasons.slice(0, 2).join('；')}
                          </div>
                        </div>
                      )}
                      {screenerResult.asyncStrategyEvidence.blockedReasons.length > 0 && (
                        <div className="mt-2 text-xs text-amber-200">
                          {screenerResult.asyncStrategyEvidence.blockedReasons.slice(0, 2).join('；')}
                        </div>
                      )}
                    </div>
                  )}
                  {screenerResult.validationEvidenceMatrix && (
                    <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <div className="text-xs text-amber-100">Validation Evidence 矩阵</div>
                        <Tag color={screenerResult.validationEvidenceMatrix.status === 'passed' ? '#34d399' : '#f59e0b'}>
                          {screenerResult.validationEvidenceMatrix.decision}
                        </Tag>
                        <Tag color="#94a3b8">主阻断 {screenerResult.validationEvidenceMatrix.summary.primaryBlocker}</Tag>
                        <Tag color="#38bdf8">候选 {screenerResult.validationEvidenceMatrix.summary.diagnosedCandidates}</Tag>
                        <Tag color="#34d399">通过 {screenerResult.validationEvidenceMatrix.summary.passedCandidates}</Tag>
                      </div>
                      <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-2">
                        {screenerResult.validationEvidenceMatrix.candidates.slice(0, 4).map((candidate) => (
                          <div key={candidate.candidateId} className="rounded border border-white/10 bg-black/10 p-2">
                            <div className="mb-1 flex flex-wrap items-center gap-1">
                              <span className="text-gray-100">{candidate.name}</span>
                              <Tag color={candidate.validation.allPassed ? '#34d399' : '#f87171'}>
                                {candidate.validation.allPassed ? '四项通过' : '未通过'}
                              </Tag>
                              <Tag color="#64748b">{candidate.actionClass}</Tag>
                            </div>
                            <div>
                              OOS {candidate.validation.outOfSample} / WF {candidate.validation.walkForward} / 参数 {candidate.validation.parameterSensitivity} / 分组 {candidate.validation.groupStability}
                            </div>
                            <div className="mt-1 text-amber-100">{candidate.nextAction}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {screenerResult.validationCandidateDisposition && (
                    <div className="mb-4 rounded-lg border border-sky-400/20 bg-sky-400/10 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <div className="text-xs text-sky-100">候选处置</div>
                        <Tag color={screenerResult.validationCandidateDisposition.decision === 'READY_FOR_MANUAL_REVIEW' ? '#34d399' : '#f59e0b'}>
                          {screenerResult.validationCandidateDisposition.decision}
                        </Tag>
                        <Tag color="#38bdf8">候选 {screenerResult.validationCandidateDisposition.summary.totalCandidates}</Tag>
                        <Tag color="#34d399">人工复核 {screenerResult.validationCandidateDisposition.summary.eligibleManualReview}</Tag>
                        <Tag color="#f87171">淘汰 {screenerResult.validationCandidateDisposition.summary.retiredCandidates}</Tag>
                      </div>
                      <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-2">
                        {screenerResult.validationCandidateDisposition.candidates.slice(0, 4).map((candidate) => (
                          <div key={candidate.candidateId} className="rounded border border-white/10 bg-black/10 p-2">
                            <div className="mb-1 flex flex-wrap items-center gap-1">
                              <span className="text-gray-100">{candidate.name}</span>
                              <Tag color={candidate.finalDisposition === 'eligible_manual_review' ? '#34d399' : candidate.finalDisposition === 'retire_candidate' ? '#f87171' : '#f59e0b'}>
                                {candidate.finalDisposition}
                              </Tag>
                            </div>
                            <div>{candidate.rationale}</div>
                            <div className="mt-1 text-amber-100">{candidate.nextAction}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {screenerResult.strategyTournament && (
                    <div className="mb-4 rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <div className="text-xs text-emerald-100">多策略短窗胜率</div>
                        <Tag color="#34d399">
                          最近 {screenerResult.strategyTournament.evaluationDays} 个可验证交易日 · 持有 {screenerResult.strategyTournament.holdingDays} 日
                        </Tag>
                        {screenerResult.strategyTournament.batchId && (
                          <Tag color={screenerResult.strategyTournament.persistenceStatus === 'persisted' ? '#22d3ee' : '#f59e0b'}>
                            回测批次 {screenerResult.strategyTournament.batchId.slice(0, 8)}
                          </Tag>
                        )}
                        {screenerResult.strategyTournament.benchmark && (
                          <Tag color="#94a3b8">
                            基准 {screenerResult.strategyTournament.benchmark.averageReturnPercent === null ? '--' : `${screenerResult.strategyTournament.benchmark.averageReturnPercent.toFixed(2)}%`}
                            {' / '}
                            样本 {screenerResult.strategyTournament.benchmark.samples}
                          </Tag>
                        )}
                      </div>
                      <div className="grid gap-3 lg:grid-cols-3">
                        {screenerResult.strategyTournament.ranked.map((strategy, index) => (
                          <div key={strategy.strategyId} className="rounded-md border border-white/10 bg-[#161629] p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                              <div className="text-sm font-medium text-white">#{index + 1} {strategy.name}</div>
                                <div className="mt-1 line-clamp-2 text-xs text-gray-400">{strategy.description}</div>
                              </div>
                              <Tag color={strategy.credibility?.rating === 'high' ? '#34d399' : strategy.credibility?.rating === 'medium' ? '#38bdf8' : '#fbbf24'}>
                                {strategy.winRatePercent === null ? '样本不足' : `${strategy.winRatePercent.toFixed(1)}%`}
                              </Tag>
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-300">
                              <div>样本 {strategy.sampleSize ?? strategy.signals}</div>
                              <div>成交 {strategy.tradeCount ?? strategy.signals}</div>
                              <div>胜/负 {strategy.wins}/{strategy.losses}</div>
                              <div>均值 {strategy.averageReturnPercent === null ? '--' : `${strategy.averageReturnPercent.toFixed(2)}%`}</div>
                              <div>中位 {strategy.medianReturnPercent === null || strategy.medianReturnPercent === undefined ? '--' : `${strategy.medianReturnPercent.toFixed(2)}%`}</div>
                              <div>当前命中 {strategy.latestMatchedCount}</div>
                              <div>超额 {strategy.excessReturnPercent === null || strategy.excessReturnPercent === undefined ? '--' : `${strategy.excessReturnPercent.toFixed(2)}%`}</div>
                              <div>回撤 {strategy.maxDrawdownPercent === null || strategy.maxDrawdownPercent === undefined ? '--' : `${strategy.maxDrawdownPercent.toFixed(2)}%`}</div>
                              <div>夏普 {strategy.sharpe === null || strategy.sharpe === undefined ? '--' : strategy.sharpe.toFixed(2)}</div>
                              <div>盈亏比 {strategy.profitFactor === null || strategy.profitFactor === undefined ? '--' : strategy.profitFactor.toFixed(2)}</div>
                              <div>尾损P95 {strategy.tailLossP95Percent === null || strategy.tailLossP95Percent === undefined ? '--' : `${strategy.tailLossP95Percent.toFixed(2)}%`}</div>
                              <div>可信 {strategy.credibility ? `${strategy.credibility.score}/100` : '--'}</div>
                            </div>
                            <MiniBacktestCurve points={strategy.equityCurve} />
                            {strategy.credibility && (
                              <div className="mt-2 rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-400">
                                <div className="mb-1 flex flex-wrap gap-1">
                                  <Tag color={strategy.credibility.rating === 'high' ? '#34d399' : strategy.credibility.rating === 'medium' ? '#38bdf8' : strategy.credibility.rating === 'insufficient' ? '#f87171' : '#fbbf24'}>
                                    {strategy.credibility.rating === 'high' ? '高可信' : strategy.credibility.rating === 'medium' ? '中可信' : strategy.credibility.rating === 'low' ? '低可信' : '样本不足'}
                                  </Tag>
                                  <Tag color="#64748b">样本充分度 {strategy.credibility.sampleAdequacyPercent.toFixed(0)}%</Tag>
                                </div>
                                <div className="line-clamp-2">{strategy.credibility.reasons.slice(0, 2).join('；')}</div>
                                {(strategy.credibility.rating === 'low' || strategy.credibility.rating === 'insufficient') && (
                                  <div className="mt-1 text-amber-200">低可信策略仅进入观察池，不进入加仓建议。</div>
                                )}
                              </div>
                            )}
                            {Boolean(strategy.blockedSamples?.length) && (
                              <div className="mt-2 text-xs text-amber-200">
                                市场约束阻断 {strategy.blockedSamples?.length} 笔样本
                              </div>
                            )}
                            {strategy.outOfSampleValidation && (
                              <div className="mt-2 rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-400">
                                <div className="mb-1 flex flex-wrap gap-1">
                                  <Tag color={strategy.outOfSampleValidation.status === 'passed' ? '#34d399' : strategy.outOfSampleValidation.status === 'failed' ? '#f87171' : '#fbbf24'}>
                                    {strategy.outOfSampleValidation.status === 'passed' ? '样本外通过' : strategy.outOfSampleValidation.status === 'failed' ? '样本外未通过' : '样本外不足'}
                                  </Tag>
                                  <Tag color="#64748b">OOS {strategy.outOfSampleValidation.outOfSample.sampleSize} 笔</Tag>
                                </div>
                                <div>
                                  样本外超额 {strategy.outOfSampleValidation.outOfSample.excessReturnPercent === null ? '--' : `${strategy.outOfSampleValidation.outOfSample.excessReturnPercent.toFixed(2)}%`}
                                </div>
                                {strategy.outOfSampleValidation.warnings.length > 0 && (
                                  <div className="mt-1 line-clamp-2 text-amber-200">{strategy.outOfSampleValidation.warnings.slice(0, 2).join('；')}</div>
                                )}
                              </div>
                            )}
                            {strategy.walkForwardValidation && (
                              <div className="mt-2 rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-400">
                                <div className="mb-1 flex flex-wrap gap-1">
                                  <Tag color={strategy.walkForwardValidation.status === 'passed' ? '#34d399' : strategy.walkForwardValidation.status === 'failed' ? '#f87171' : '#fbbf24'}>
                                    {strategy.walkForwardValidation.status === 'passed' ? '滚动通过' : strategy.walkForwardValidation.status === 'failed' ? '滚动未通过' : '滚动不足'}
                                  </Tag>
                                  <Tag color="#64748b">{strategy.walkForwardValidation.passedWindows}/{strategy.walkForwardValidation.totalWindows} 窗口</Tag>
                                </div>
                                {strategy.walkForwardValidation.windows.length > 0 && (
                                  <div>
                                    最近窗口超额 {
                                      strategy.walkForwardValidation.windows[strategy.walkForwardValidation.windows.length - 1].summary.excessReturnPercent === null
                                        ? '--'
                                        : `${strategy.walkForwardValidation.windows[strategy.walkForwardValidation.windows.length - 1].summary.excessReturnPercent?.toFixed(2)}%`
                                    }
                                  </div>
                                )}
                                {strategy.walkForwardValidation.warnings.length > 0 && (
                                  <div className="mt-1 line-clamp-2 text-amber-200">{strategy.walkForwardValidation.warnings.slice(0, 2).join('；')}</div>
                                )}
                              </div>
                            )}
                            {strategy.parameterSensitivity && (
                              <div className="mt-2 rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-400">
                                <div className="mb-1 flex flex-wrap gap-1">
                                  <Tag color={strategy.parameterSensitivity.status === 'passed' ? '#34d399' : strategy.parameterSensitivity.status === 'failed' ? '#f87171' : '#fbbf24'}>
                                    {strategy.parameterSensitivity.status === 'passed' ? '参数稳健' : strategy.parameterSensitivity.status === 'failed' ? '参数敏感' : '参数样本不足'}
                                  </Tag>
                                  <Tag color="#64748b">{strategy.parameterSensitivity.stableVariantCount}/{strategy.parameterSensitivity.totalVariants} 变体</Tag>
                                </div>
                                {strategy.parameterSensitivity.variants.length > 0 && (
                                  <div>
                                    Base 超额 {
                                      strategy.parameterSensitivity.variants[0].excessReturnPercent === null
                                        ? '--'
                                        : `${strategy.parameterSensitivity.variants[0].excessReturnPercent.toFixed(2)}%`
                                    }
                                  </div>
                                )}
                                {strategy.parameterSensitivity.variants.length > 1 && (
                                  <div className="mt-2 space-y-1">
                                    {strategy.parameterSensitivity.variants.slice(0, 3).map((variant) => (
                                      <div key={variant.variantId} className="grid grid-cols-[1fr_auto_auto] gap-2 text-[11px] text-gray-500">
                                        <span className="truncate">{variant.variantId}</span>
                                        <span>{variant.tradeCount} 笔</span>
                                        <span>{variant.excessReturnPercent === null ? '--' : `${variant.excessReturnPercent.toFixed(2)}%`}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                                {strategy.parameterSensitivity.warnings.length > 0 && (
                                  <div className="mt-1 line-clamp-2 text-amber-200">{strategy.parameterSensitivity.warnings.slice(0, 2).join('；')}</div>
                                )}
                              </div>
                            )}
                            {strategy.persistedBacktestId && (
                              <div className="mt-2 text-xs text-gray-500">
                                Backtest {strategy.persistedBacktestId.slice(0, 8)}
                              </div>
                            )}
                            {(strategy.versionBundle || strategy.auditHash) && (
                              <div className="mt-2 grid grid-cols-1 gap-1 rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-500">
                                {strategy.versionBundle?.signalStrategy && (
                                  <div>策略版本 {strategy.versionBundle.signalStrategy.version}</div>
                                )}
                                {strategy.versionBundle?.entryPolicy && strategy.versionBundle?.exitPolicy && (
                                  <div>执行版本 {strategy.versionBundle.entryPolicy.version} / {strategy.versionBundle.exitPolicy.version}</div>
                                )}
                                {strategy.auditHash && <div>审计哈希 {strategy.auditHash.slice(0, 12)}</div>}
                              </div>
                            )}
                            {strategy.latestCandidates.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {strategy.latestCandidates.slice(0, 2).map((item) => (
                                  <Tag key={`${strategy.strategyId}-${item.symbol}`} color="#38bdf8">
                                    {item.name} {item.score}
                                  </Tag>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 text-xs text-gray-400">
                        {screenerResult.strategyTournament.notes.slice(0, 1).join('')}
                      </div>
                    </div>
                  )}
                  {Boolean(screenerResult.excludedUniverse?.length) && (
                    <div className="mb-4 rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
                      <div className="mb-2 text-xs text-amber-100">样本池排除说明</div>
                      <div className="flex flex-wrap gap-2">
                        {screenerResult.excludedUniverse?.slice(0, 8).map((item) => (
                          <Tag key={`${item.symbol}-${item.resolvedType}`} color="#f59e0b">
                            {item.name} {item.symbol} · {item.resolvedType}
                          </Tag>
                        ))}
                      </div>
                    </div>
                  )}
                  <Row gutter={[16, 16]}>
                    {screenerResult.candidates.map((item) => (
                      <Col key={item.symbol} xs={24} md={12}>
                        <div className="rounded-lg border border-white/10 bg-[#161629] p-4">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <div className="text-white font-medium">{item.name} {item.symbol}</div>
                              <div className="text-xs text-gray-400 mt-1">{item.reason}</div>
                            </div>
                            <Tag color={item.matched ? '#34d399' : '#fbbf24'}>{item.score}</Tag>
                          </div>
                          <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-gray-300">
                            <div>回撤 {item.drawdownPercent.toFixed(1)}%</div>
                            <div>横盘 {item.sidewaysRangePercent.toFixed(1)}%</div>
                            <div>量比 {item.lastTwoVolumeRatio.toFixed(2)}</div>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-400">
                            <span>数据源 {item.historySource || '--'}</span>
                            <span>K线 {item.historyDays || 0} 条</span>
                            {typeof item.peDynamic === 'number' && <span>PE {item.peDynamic.toFixed(2)}</span>}
                            {typeof item.pb === 'number' && <span>PB {item.pb.toFixed(2)}</span>}
                            {typeof item.totalMarketCap === 'number' && <span>市值 {(item.totalMarketCap / 100000000).toFixed(1)}亿</span>}
                          </div>
                          <div className="mt-3 text-sm text-gray-200">{item.advice}</div>
                          {Boolean(item.matchedRules?.length || item.unmatchedReasons?.length) && (
                            <div className="mt-3 space-y-1 text-xs">
                              {item.matchedRules?.slice(0, 3).map((rule) => (
                                <div key={rule} className="text-emerald-300">命中：{rule}</div>
                              ))}
                              {item.hardFilterRules?.slice(0, 3).map((rule) => (
                                <div key={rule} className="text-cyan-300">过滤：{rule}</div>
                              ))}
                              {item.unmatchedReasons?.slice(0, 3).map((reason) => (
                                <div key={reason} className="text-amber-300">未命中：{reason}</div>
                              ))}
                              {item.hardFilterFailures?.slice(0, 3).map((reason) => (
                                <div key={reason} className="text-red-300">过滤未通过：{reason}</div>
                              ))}
                            </div>
                          )}
                          {item.aiAdvice && (
                            <div className="mt-3 rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-300">
                              AI观察 {item.aiAdvice.status === 'available' ? item.aiAdvice.observation : '数据不足'}
                            </div>
                          )}
                        </div>
                      </Col>
                    ))}
                  </Row>
                </Card>
              )}

              {activeSection === 'overview' && marketDataTrace.length > 0 && (
                <MarketDataTracePanel items={marketDataTrace} compact={Boolean(researchResult)} />
              )}

              {keySuggestions.length > 0 && (
            <Card
              title={<span className="text-white">重点建议</span>}
              className="bg-[#1a1a2e] border-[surface-border]"
            >
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="text-sm text-gray-300">
                  首屏只保留最值得先处理的 {keySuggestions.length} 条。
                </div>
                {activeSection === 'overview' && (
                  <Button size="small" type="text" onClick={() => setActiveSection('actions')} style={{ color: '#93c5fd', paddingInline: 0 }}>
                    查看完整建议
                  </Button>
                )}
              </div>
              <Row gutter={[16, 16]}>
                {keySuggestions.map((suggestion) => (
                  <Col key={`key-${suggestion.id}`} xs={24} md={12} lg={8}>
                    <SuggestionCard
                      suggestion={suggestion}
                      onGeneratePlan={handleGeneratePlan}
                      onExecute={handleExecuteAdvice}
                      executing={executingActionId === suggestion.actionId}
                      density="compact"
                      featured
                    />
                  </Col>
                ))}
              </Row>
            </Card>
              )}

              {activeSection === 'actions' && (
            <Card
              title={<span className="text-white">{activeQuery ? `操作建议 - ${activeQuery}` : '操作建议'}</span>}
              className="bg-[#1a1a2e] border-[surface-border]"
            >
              <div className="mb-4 rounded-xl border border-white/10 bg-[#161629] p-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="min-w-0 flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs text-gray-400 shrink-0">筛选</div>
                      <ChoicePills
                        value={adviceFilter}
                        onChange={setAdviceFilter}
                        compact
                        noWrap
                        options={[
                          { label: `全部 ${suggestions.length}`, value: 'all' },
                          { label: `高优 ${highPriorityCount}`, value: 'high' },
                          { label: `可执 ${executableCount}`, value: 'executable' },
                          { label: `买入 ${buyCount}`, value: 'buy' },
                          { label: `卖出 ${sellCount}`, value: 'sell' },
                        ]}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs text-gray-400 shrink-0">排序</div>
                      <ChoicePills
                        value={adviceSort}
                        onChange={setAdviceSort}
                        compact
                        options={[
                          { label: '优先级', value: 'priority' },
                          { label: '动作', value: 'action' },
                          { label: '最新', value: 'latest' },
                        ]}
                      />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 xl:justify-end">
                    <Tag color="#38bdf8" style={{ marginRight: 0 }}>显示 {visibleSuggestions.length} / {filteredSuggestions.length}</Tag>
                    {adviceFilter !== 'all' && <Tag color="#818cf8" style={{ marginRight: 0 }}>已筛选</Tag>}
                    <Tag color="#34d399" style={{ marginRight: 0 }}>
                      排序 {adviceSort === 'priority' ? '优先级' : adviceSort === 'action' ? '动作' : '最新'}
                    </Tag>
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-xs text-gray-400 shrink-0">密度</div>
                      <ChoicePills
                        value={cardDensity}
                        onChange={setCardDensity}
                        compact
                        options={[
                          { label: '舒适', value: 'comfortable' },
                          { label: '紧凑', value: 'compact' },
                        ]}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {structuredAdvice && (
                <div className="mb-3 space-y-2.5">
                  <div className="rounded-xl border border-white/10 bg-[#161629] px-3 py-2.5">
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs text-gray-400 mb-1">结构化摘要</div>
                        <div
                          className="text-white text-sm leading-6"
                          style={!overviewExpanded ? {
                            display: '-webkit-box',
                            WebkitLineClamp: 1,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          } : undefined}
                        >
                          {structuredAdvice.summary}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <Tag color={riskLevel === 'high' ? '#f87171' : riskLevel === 'medium' ? '#fbbf24' : '#34d399'} style={{ marginRight: 0 }}>
                          风险 {structuredAdvice.risk_level}
                        </Tag>
                        <Tag color={structuredAdvice.required_user_confirmation ? '#818cf8' : '#34d399'} style={{ marginRight: 0 }}>
                          {structuredAdvice.required_user_confirmation ? '需人工确认' : '可直接采纳'}
                        </Tag>
                        <Tag color="#38bdf8" style={{ marginRight: 0 }}>{structuredAdvice.scope}</Tag>
                        <Button
                          size="small"
                          type="text"
                          onClick={() => setOverviewExpanded((value) => !value)}
                          style={{ color: '#94a3b8', paddingInline: 0 }}
                        >
                          {overviewExpanded ? '收起概览' : '展开概览'}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {overviewExpanded && (structuredAdvice.portfolio_view || (structuredAdvice.portfolio_targets && structuredAdvice.portfolio_targets.length > 0)) && (
                    <div className="grid gap-2.5 lg:grid-cols-2">
                      {structuredAdvice.portfolio_view && (
                        <div className="rounded-lg border border-white/10 bg-[#161629] p-2.5">
                          <div className="text-xs text-gray-400 mb-1.5">组合视角</div>
                          <div className="grid grid-cols-2 gap-2 text-sm">
                            <div>
                              <div className="text-gray-400">组合总值</div>
                              <div className="text-white font-medium">{formatMoney(structuredAdvice.portfolio_view.total_value)}</div>
                            </div>
                            <div>
                              <div className="text-gray-400">现金占比</div>
                              <div className="text-white font-medium">{formatPercent(structuredAdvice.portfolio_view.cash_pct * 100)}</div>
                            </div>
                            <div className="col-span-2">
                              <div className="text-gray-400">集中度风险</div>
                              <div className="text-white font-medium">{structuredAdvice.portfolio_view.concentration_risk}</div>
                            </div>
                          </div>
                          {structuredAdvice.portfolio_view.primary_observations.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-2">
                              {structuredAdvice.portfolio_view.primary_observations.map((item) => (
                                <Tag key={item} color="#818cf8">{item}</Tag>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {structuredAdvice.portfolio_targets && structuredAdvice.portfolio_targets.length > 0 && (
                        <div className="rounded-lg border border-white/10 bg-[#161629] p-2.5">
                          <div className="text-xs text-gray-400 mb-1.5">目标建议</div>
                          <div className="space-y-1">
                            {structuredAdvice.portfolio_targets.map((target) => (
                              <div key={`${target.bucket}-${target.target_pct}`} className="flex items-center justify-between text-sm">
                                <div className="text-white">{target.bucket}</div>
                                <div className="text-gray-300">
                                  当前 {(target.current_pct * 100).toFixed(1)}% / 目标 {(target.target_pct * 100).toFixed(1)}%
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {overviewExpanded && structuredAdvice.risks.length > 0 && (
                    <div className="rounded-lg border border-[rgba(248,113,113,0.25)] bg-[rgba(248,113,113,0.08)] p-2.5">
                      <div className="text-xs text-gray-300 mb-1.5">关键风险</div>
                      <div className="flex flex-wrap gap-2">
                        {structuredAdvice.risks.map((risk) => (
                          <Tag key={risk} color="#f87171">{risk}</Tag>
                        ))}
                      </div>
                    </div>
                  )}

                  {overviewExpanded && dataReliability && (
                    <div className="rounded-lg border border-white/10 bg-[#161629] p-2.5">
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="text-xs text-gray-400 mb-1">数据可靠性</div>
                          <div className="flex flex-wrap gap-2">
                            <Tag color={RELIABILITY_STATUS[dataReliability.overallStatus].color}>
                              {RELIABILITY_STATUS[dataReliability.overallStatus].label}
                            </Tag>
                            <Tag color="#38bdf8">
                              平均置信度 {typeof dataReliability.averageConfidence === 'number'
                                ? `${(dataReliability.averageConfidence * 100).toFixed(0)}%`
                                : '--'}
                            </Tag>
                            <Tag color={dataReliability.warningCount > 0 ? '#fbbf24' : '#34d399'}>
                              警告 {dataReliability.warningCount}
                            </Tag>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <ProviderHealthTags
                            items={
                              reliabilityExpanded
                                ? dataReliability.providerSummary as ProviderHealthItem[]
                                : (dataReliability.providerSummary as ProviderHealthItem[]).slice(0, 2)
                            }
                          />
                          {!reliabilityExpanded && dataReliability.providerSummary.length > 2 && (
                            <Tag color="#475569">+{dataReliability.providerSummary.length - 2} 个源</Tag>
                          )}
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="text-xs text-gray-400">
                          默认摘要模式
                        </div>
                        <Button
                          size="small"
                          type="text"
                          onClick={() => setReliabilityExpanded((value) => !value)}
                          style={{ color: '#94a3b8', paddingInline: 0 }}
                        >
                          {reliabilityExpanded ? '收起明细' : '展开明细'}
                        </Button>
                      </div>
                      {reliabilityExpanded && dataReliability.warnings.length > 0 && (
                        <ReliabilityWarnings warnings={dataReliability.warnings} className="mt-2 flex flex-wrap gap-2" />
                      )}
                      {reliabilityExpanded && (
                        <ProviderHealthSummary
                          items={dataReliability.providerSummary as ProviderHealthItem[]}
                          className="mt-3"
                        />
                      )}
                    </div>
                  )}
                </div>
              )}

              {filteredSuggestions.length === 0 ? (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={<span className="text-gray-300">{suggestions.length === 0 ? '暂无建议' : '当前筛选条件下暂无结果'}</span>}
                />
              ) : (
                <div className={cardDensity === 'compact' ? 'space-y-3' : 'space-y-4'}>
                  <Row gutter={cardDensity === 'compact' ? [12, 12] : [16, 16]}>
                    {visibleSuggestions.map((suggestion) => (
                      <Col
                        key={suggestion.id}
                        xs={24}
                        md={12}
                        lg={8}
                      >
                        <SuggestionCard
                          suggestion={suggestion}
                          onGeneratePlan={handleGeneratePlan}
                          onExecute={handleExecuteAdvice}
                          executing={executingActionId === suggestion.actionId}
                          density={cardDensity}
                        />
                      </Col>
                    ))}
                  </Row>
                  {(hasMoreSuggestions || visibleSuggestionCount > 6) && (
                    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-[#161629] px-4 py-3">
                      <div className="text-sm text-gray-300">
                        已展示 {visibleSuggestions.length} 条，剩余 {Math.max(visibleSuggestionSource.length - visibleSuggestions.length, 0)} 条
                      </div>
                      <div className="flex gap-2">
                        {visibleSuggestionCount > 6 && (
                          <Button size="small" onClick={() => setVisibleSuggestionCount(6)}>
                            收起
                          </Button>
                        )}
                        {hasMoreSuggestions && (
                          <Button size="small" type="primary" onClick={() => setVisibleSuggestionCount((count) => count + 6)}>
                            再看 6 条
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </Card>
              )}

              {activeSection === 'overview' && (
                <Card
                  title={<span className="text-white">概览说明</span>}
                  className="bg-[#1a1a2e] border-[surface-border]"
                >
                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-[#161629] p-4">
                      <div className="text-xs text-gray-400 mb-2">这一页看什么</div>
                      <div className="text-white text-sm leading-6">
                        这里只保留当前结论、重点建议、执行状态和风险概览，帮助你快速判断现在最该处理什么。
                      </div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-[#161629] p-4">
                      <div className="text-xs text-gray-400 mb-2">什么时候去操作建议</div>
                      <div className="text-white text-sm leading-6">
                        当你要逐条查看、筛选、排序、展开详细分析或批量浏览全部建议时，再切到“操作建议”分区。
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[rgba(37,99,235,0.25)] bg-[rgba(37,99,235,0.08)] px-4 py-3">
                    <div className="text-sm text-blue-100">
                      概览页不再重复展示完整建议列表。
                    </div>
                    <Button type="primary" onClick={() => setActiveSection('actions')}>
                      打开操作建议
                    </Button>
                  </div>
                </Card>
              )}

              {activeSection === 'risk' && (
            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card
                  title={<span className="text-white">风险分析</span>}
                  className="bg-[#1a1a2e] border-[surface-border]"
                >
                  <RiskIndicator level={riskLevel} />
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center">
                      <div className="text-2xl font-bold text-white">{overallScore.toFixed(1)}</div>
                      <div className="text-xs text-gray-300">综合评分</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold text-white">{suggestions.length}</div>
                      <div className="text-xs text-gray-300">活跃建议</div>
                    </div>
                    <div className="text-center">
                      <div className="text-2xl font-bold" style={{
                        color: suggestions.filter(s => s.priority === 'high').length > 0 ? '#f87171' : '#34d399'
                      }}>
                        {suggestions.filter(s => s.priority === 'high').length}
                      </div>
                      <div className="text-xs text-gray-300">高优先级</div>
                    </div>
                  </div>
                  {marketOutlook && (
                    <div className="mt-4 p-3 rounded-lg" style={{ background: 'rgba(129, 140, 248, 0.1)' }}>
                      <div className="text-xs text-gray-300 mb-1">市场展望</div>
                      <div className="text-sm text-white">{marketOutlook}</div>
                    </div>
                  )}
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card
                  title={<span className="text-white">一键生成交易计划</span>}
                  className="bg-[#1a1a2e] border-[surface-border]"
                >
                  <div className="text-center py-4">
                    <BulbOutlined className="text-4xl text-[#818cf8] mb-4" />
                    <p className="text-gray-300 mb-4">
                      基于当前建议一键生成交易计划，支持以下类型：
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center">
                      {Object.entries(SUGGESTION_CONFIG).map(([key, config]) => (
                        <Tag
                          key={key}
                          style={{
                            background: config.bgColor,
                            color: config.color,
                            border: `1px solid ${config.color}`,
                          }}
                        >
                          {config.icon} {config.label}
                        </Tag>
                      ))}
                    </div>
                    <Button
                      type="primary"
                      size="large"
                      icon={<ThunderboltOutlined />}
                      className="mt-4"
                      onClick={() => handleGeneratePlan(suggestions[0] || {
                        id: 'default',
                        type: 'rebalance',
                        title: '默认计划',
                        description: '生成整体交易计划',
                        priority: 'medium',
                        parameters: {},
                        createdAt: new Date().toISOString(),
                      })}
                      disabled={suggestions.length === 0}
                    >
                      生成综合交易计划
                    </Button>
                  </div>
                </Card>
              </Col>
            </Row>
              )}

              {activeSection === 'holdings' && (
            <Card
              title={<span className="text-white">当前持仓研究面板</span>}
              className="bg-[#1a1a2e] border-[surface-border]"
            >
              {holdingsResearch.length === 0 ? (
                <Empty description={<span className="text-gray-300">暂无持仓研究数据</span>} />
              ) : (
                <div className="space-y-4">
                  <div className="rounded-xl border border-sky-400/20 bg-sky-400/10 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <div className="text-xs text-sky-100/75">持仓研究覆盖率</div>
                        <div className="mt-1 text-sm font-medium text-white">
                          非现金持仓 {holdingsCoverageSummary.total} 个，平均研究覆盖分 {holdingsCoverageSummary.averageScore}
                        </div>
                        <div className="mt-1 text-xs leading-5 text-gray-300">
                          覆盖分用于判断研究资料是否足够，不代表买卖信号。
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        <Tag color="#34d399">ready {holdingsCoverageSummary.ready}</Tag>
                        <Tag color="#fbbf24">partial {holdingsCoverageSummary.partial}</Tag>
                        <Tag color="#f87171">insufficient {holdingsCoverageSummary.insufficient}</Tag>
                      </div>
                    </div>
                    {holdingsCoverageSummary.topGaps.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        <span className="mr-1 text-xs text-gray-400">主要缺口</span>
                        {holdingsCoverageSummary.topGaps.map((gap) => (
                          <Tag key={gap} color="#f59e0b" style={{ marginRight: 0 }}>{gap}</Tag>
                        ))}
                      </div>
                    )}
                  </div>
                <Row gutter={[16, 16]}>
                  {holdingsResearch.map((item) => {
                    const coverage = item.researchCoverage
                    const coverageColor = !coverage
                      ? '#94a3b8'
                      : coverage.score >= 75
                      ? '#34d399'
                      : coverage.score >= 45
                      ? '#fbbf24'
                      : '#f87171'
                    return (
                    <Col key={item.positionId} xs={24} lg={12}>
                      <Card size="small" style={{ background: '#20203a', borderColor: '#374151' }}>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="text-white font-semibold">{item.name}</div>
                            <div className="text-xs text-gray-300">{item.symbol} · {item.type} · {item.weightHint}</div>
                          </div>
                          <Tag color={item.technical.pnlPercent >= 0 ? '#34d399' : '#f87171'}>
                            {item.technical.pnlPercent.toFixed(2)}%
                          </Tag>
                        </div>
                        {coverage && (
                          <div className="mb-3 rounded-md border border-white/10 bg-[#161629] p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-xs text-gray-400">研究覆盖分</div>
                                <div className="text-xl font-semibold" style={{ color: coverageColor }}>{coverage.score}</div>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <Tag color={coverageColor} style={{ marginRight: 0 }}>{coverage.label}</Tag>
                                <Tag color="#38bdf8" style={{ marginRight: 0 }}>
                                  {coverage.availableDimensions}/{coverage.totalDimensions} 维度可用
                                </Tag>
                              </div>
                            </div>
                            <div className="grid gap-1 text-xs text-gray-300 md:grid-cols-4">
                              {coverage.dimensions.map((dimension) => {
                                const config = RESEARCH_FACT_STATUS[dimension.status] || { label: dimension.status, color: '#94a3b8' }
                                return (
                                  <div key={dimension.key} className="rounded border border-white/10 bg-black/10 p-2">
                                    <div className="mb-1 text-gray-400">{dimension.label}</div>
                                    <Tag color={config.color} style={{ marginRight: 0 }}>{config.label}</Tag>
                                    <div className="mt-1 text-[11px] text-gray-500">
                                      证据 {dimension.evidenceCount} / 缺口 {dimension.blockerCount}
                                    </div>
                                  </div>
                                )
                              })}
                            </div>
                            {coverage.nextAction && (
                              <div className="mt-2 text-xs leading-5 text-amber-100">
                                优先补齐：{coverage.primaryGap}；{coverage.nextAction}
                              </div>
                            )}
                          </div>
                        )}
                        {item.researchEvidenceDetails && (
                          <div className="mb-3 rounded-md border border-emerald-400/20 bg-emerald-400/10 p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-xs text-emerald-100">事实集明细</div>
                                <div className="text-[11px] text-gray-400">
                                  技术 {item.researchEvidenceDetails.technical.availableFieldCount} 项可用 / {item.researchEvidenceDetails.technical.missingFieldCount} 项缺失
                                  {' · '}
                                  基本面 {item.researchEvidenceDetails.fundamental.availableFactCount} 项可用 / {item.researchEvidenceDetails.fundamental.missingFactCount} 项缺失
                                </div>
                              </div>
                              <Tag color="#38bdf8" style={{ marginRight: 0 }}>
                                {item.researchEvidenceDetails.technical.source}
                              </Tag>
                            </div>
                            <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-5">
                              {item.researchEvidenceDetails.technical.fields.slice(0, 5).map((field) => (
                                <div key={field.key} className="rounded border border-white/10 bg-black/10 p-2">
                                  <div className="text-gray-500">{field.label}</div>
                                  <div className={field.value === null ? 'text-amber-200' : 'text-white'}>
                                    {formatEvidenceValue(field.value, field.unit)}
                                  </div>
                                </div>
                              ))}
                            </div>
                            {item.researchEvidenceDetails.fundamental.warnings.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {item.researchEvidenceDetails.fundamental.warnings.slice(0, 3).map((warning) => (
                                  <Tag key={warning} color="#f59e0b" style={{ marginRight: 0 }}>{warning}</Tag>
                                ))}
                              </div>
                            )}
                            {item.researchEvidenceDetails.fundLike && (
                              <div className="mt-3 rounded border border-white/10 bg-black/10 p-2 text-xs text-gray-300">
                                <div className="mb-2 text-emerald-100">基金/债基研究代理</div>
                                <div className="grid gap-2 md:grid-cols-4">
                                  <div>
                                    <div className="text-gray-500">风险等级代理</div>
                                    <div className="text-white">
                                      {item.researchEvidenceDetails.fundLike.riskLevelProxy?.riskLevel || '--'}
                                      {typeof item.researchEvidenceDetails.fundLike.riskLevelProxy?.score === 'number'
                                        ? ` / ${item.researchEvidenceDetails.fundLike.riskLevelProxy.score}`
                                        : ''}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-gray-500">净值样本</div>
                                    <div className="text-white">{item.researchEvidenceDetails.fundLike.navHistory?.sampleSize ?? '--'}</div>
                                  </div>
                                  <div>
                                    <div className="text-gray-500">久期代理</div>
                                    <div className="text-white">
                                      {item.researchEvidenceDetails.fundLike.durationProxy?.status === 'available'
                                        ? `${item.researchEvidenceDetails.fundLike.durationProxy.durationBucket} / ${item.researchEvidenceDetails.fundLike.durationProxy.estimatedDurationYears ?? '--'} 年`
                                        : '--'}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-gray-500">债券配置</div>
                                    <div className="text-white">
                                      {typeof item.researchEvidenceDetails.fundLike.bondRiskProxy?.bondPct === 'number'
                                        ? `${item.researchEvidenceDetails.fundLike.bondRiskProxy.bondPct.toFixed(2)}%`
                                        : '--'}
                                    </div>
                                  </div>
                                </div>
                                <div className="mt-2 text-[11px] leading-5 text-amber-100">
                                  风险等级和久期为研究级代理，不是官方评级、真实组合久期或交易依据。
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                        <div className="mb-3 grid grid-cols-2 gap-2 text-xs text-gray-300 md:grid-cols-4">
                          <div className="rounded-md border border-white/10 bg-[#161629] p-2">
                            <div className="text-gray-500">市值</div>
                            <div className="text-white">{formatMoney(item.marketValue)}</div>
                          </div>
                          <div className="rounded-md border border-white/10 bg-[#161629] p-2">
                            <div className="text-gray-500">现价 / 成本</div>
                            <div className="text-white">{formatMoney(item.technical.currentPrice)} / {formatMoney(item.technical.avgCost)}</div>
                          </div>
                          <div className="rounded-md border border-white/10 bg-[#161629] p-2">
                            <div className="text-gray-500">支撑 / 压力</div>
                            <div className="text-white">{formatMoney(item.technical.support)} / {formatMoney(item.technical.resistance)}</div>
                          </div>
                          <div className="rounded-md border border-white/10 bg-[#161629] p-2">
                            <div className="text-gray-500">止盈止损</div>
                            <div className="text-white">
                              {typeof item.technical.stopReturnPercent === 'number' ? `${item.technical.stopReturnPercent}%` : '--'} / {typeof item.technical.takeProfitReturnPercent === 'number' ? `${item.technical.takeProfitReturnPercent}%` : '--'}
                            </div>
                          </div>
                        </div>
                        <div className="mb-3 grid gap-2 text-xs text-gray-300 md:grid-cols-3">
                          <div className="rounded-md border border-cyan-400/20 bg-cyan-400/10 p-2">
                            <div className="mb-1 text-cyan-100">价值状态</div>
                            <div className="flex flex-wrap gap-1">
                              <Tag color={VALUE_ASSESSMENT_STATUS[item.valueAssessment?.valuation.status || 'not_applicable']?.color || '#94a3b8'} style={{ marginRight: 0 }}>
                                {VALUE_ASSESSMENT_STATUS[item.valueAssessment?.valuation.status || 'not_applicable']?.label || item.valueAssessment?.valuation.status || '不适用'}
                              </Tag>
                              <Tag color="#38bdf8" style={{ marginRight: 0 }}>
                                {VALUE_CONCLUSION_LABEL[item.valueAssessment?.valuation.conclusion || 'not_applicable'] || item.valueAssessment?.valuation.conclusion || '不适用'}
                              </Tag>
                            </div>
                          </div>
                          <div className="rounded-md border border-indigo-400/20 bg-indigo-400/10 p-2">
                            <div className="mb-1 text-indigo-100">仓位建议</div>
                            <div className="flex flex-wrap gap-1">
                              {item.positionAdvice ? (
                                <>
                                  <Tag color={POSITION_ADVICE_ACTION[item.positionAdvice.action]?.color || '#94a3b8'} style={{ marginRight: 0 }}>
                                    {POSITION_ADVICE_ACTION[item.positionAdvice.action]?.label || item.positionAdvice.action}
                                  </Tag>
                                  <Tag color={POSITION_ADVICE_CONFIDENCE[item.positionAdvice.confidence]?.color || '#94a3b8'} style={{ marginRight: 0 }}>
                                    {POSITION_ADVICE_CONFIDENCE[item.positionAdvice.confidence]?.label || item.positionAdvice.confidence}
                                  </Tag>
                                </>
                              ) : (
                                <Tag color="#94a3b8" style={{ marginRight: 0 }}>无建议</Tag>
                              )}
                            </div>
                          </div>
                          <div className="rounded-md border border-red-400/20 bg-red-400/10 p-2">
                            <div className="mb-1 text-red-100">交易边界</div>
                            <div className="flex flex-wrap gap-1">
                              <Tag color="#38bdf8" style={{ marginRight: 0 }}>研究/观察</Tag>
                              <Tag color="#f87171" style={{ marginRight: 0 }}>ADD/REDUCE 阻断</Tag>
                            </div>
                          </div>
                        </div>
                        <div className="mb-3 rounded-md border border-white/10 bg-[#161629] p-3">
                          <div className="mb-2 text-xs text-gray-400">摘要</div>
                          <div className="text-sm leading-6 text-white">{item.summary || `${item.technical.trend}，${item.fundamental.risk}`}</div>
                          {Boolean(item.keyEvidence?.length) && (
                            <div className="mt-2 flex flex-wrap gap-1">
                              {item.keyEvidence?.slice(0, 4).map((evidence) => (
                                <Tag key={evidence} color="#64748b" style={{ marginRight: 0 }}>{evidence}</Tag>
                              ))}
                            </div>
                          )}
                          {item.researchFactStatus && (
                            <div className="mt-3 flex flex-wrap gap-1">
                              {[
                                ['技术', item.researchFactStatus.technical],
                                ['基本面', item.researchFactStatus.fundamental],
                                ['消息', item.researchFactStatus.news],
                                ['估值', item.researchFactStatus.valuation],
                              ].map(([label, status]) => {
                                const config = RESEARCH_FACT_STATUS[status] || { label: status, color: '#94a3b8' }
                                return (
                                  <Tag key={`${label}-${status}`} color={config.color} style={{ marginRight: 0 }}>
                                    {label} {config.label}
                                  </Tag>
                                )
                              })}
                            </div>
                          )}
                          <div className="mt-3">
                            <DataGapPanel gaps={item.dataGapSummary} compact limit={2} title="主要数据缺口" />
                          </div>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <div className="text-xs text-gray-500">
                              {item.type === 'cash' ? '现金类不生成仓位建议' : item.positionAdvice ? `证据 ${item.positionAdvice.evidenceRefs.length} 条` : '当前仅展示持仓事实'}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button size="small" onClick={() => setSelectedHoldingResearch(item)}>
                                查看详情
                              </Button>
                              {item.type !== 'cash' && (
                                <Button
                                  size="small"
                                  data-fivdr-position-id={item.positionId}
                                  loading={loadingFivdRPositionId === item.positionId}
                                  onClick={() => openPositionFivdR(item)}
                                >
                                  查看 FIVD-R
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="hidden">
                        {item.positionAdvice && (
                          <div className="mb-3 rounded-md border border-indigo-300/20 bg-indigo-400/10 p-3">
                            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                              <div>
                                <div className="text-xs text-indigo-100">仓位建议引擎</div>
                                <div className="text-[11px] text-gray-400">
                                  {item.positionAdvice.schemaVersion} · {formatTraceTime(item.positionAdvice.generatedAt)}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-1">
                                <Tag color={POSITION_ADVICE_ACTION[item.positionAdvice.action]?.color || '#94a3b8'} style={{ marginRight: 0 }}>
                                  {POSITION_ADVICE_ACTION[item.positionAdvice.action]?.label || item.positionAdvice.action}
                                </Tag>
                                <Tag color={POSITION_ADVICE_CONFIDENCE[item.positionAdvice.confidence]?.color || '#94a3b8'} style={{ marginRight: 0 }}>
                                  {POSITION_ADVICE_CONFIDENCE[item.positionAdvice.confidence]?.label || item.positionAdvice.confidence}
                                </Tag>
                                {item.positionAdvice.cache && (
                                  <Tag color={POSITION_ADVICE_CACHE[item.positionAdvice.cache.status]?.color || '#94a3b8'} style={{ marginRight: 0 }}>
                                    {item.positionAdvice.cache.refreshed ? '刚刷新' : POSITION_ADVICE_CACHE[item.positionAdvice.cache.status]?.label || item.positionAdvice.cache.status}
                                  </Tag>
                                )}
                              </div>
                            </div>
                            <div className="mb-2 grid grid-cols-2 gap-2 text-xs text-gray-300 md:grid-cols-4">
                              <div>
                                <div className="text-gray-500">当前仓位</div>
                                <div className="text-white">{item.positionAdvice.currentWeightPct.toFixed(2)}%</div>
                              </div>
                              <div>
                                <div className="text-gray-500">目标区间</div>
                                <div className="text-white">
                                  {item.positionAdvice.confidence === 'insufficient'
                                    ? '证据不足'
                                    : `${formatRatioPercent(item.positionAdvice.targetWeightRange[0])} - ${formatRatioPercent(item.positionAdvice.targetWeightRange[1])}`}
                                </div>
                              </div>
                              <div>
                                <div className="text-gray-500">交易幅度</div>
                                <div className="text-white">
                                  {typeof item.positionAdvice.suggestedTradeRatio === 'number'
                                    ? formatRatioPercent(item.positionAdvice.suggestedTradeRatio)
                                    : '--'}
                                </div>
                              </div>
                              <div>
                                <div className="text-gray-500">策略证据</div>
                                <div className="text-white">{item.positionAdvice.strategyEvidenceCount} 条</div>
                              </div>
                            </div>
                            <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-5">
                              <div>趋势 {item.positionAdvice.scores.trend}</div>
                              <div>动量 {item.positionAdvice.scores.momentum}</div>
                              <div>相对强弱 {item.positionAdvice.scores.relativeStrength}</div>
                              <div>波动 {item.positionAdvice.scores.volatility}</div>
                              <div>流动性 {item.positionAdvice.scores.liquidity}</div>
                            </div>
                            <div className="mt-2 text-xs leading-5 text-gray-300">
                              {item.positionAdvice.reasons.slice(0, 2).join('；')}
                            </div>
                            {item.positionAdvice.blockedReasons.length > 0 && (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {item.positionAdvice.blockedReasons.slice(0, 4).map((reason) => (
                                  <Tag key={reason} color="#f87171" style={{ marginRight: 0 }}>{reason}</Tag>
                                ))}
                              </div>
                            )}
                            {item.positionAdvice.risks.length > 0 && (
                              <div className="mt-2 text-xs leading-5 text-gray-400">
                                风险：{item.positionAdvice.risks.slice(0, 2).join('；')}
                              </div>
                            )}
                            <div className="mt-2 text-[11px] text-gray-500">
                              证据 {item.positionAdvice.evidenceRefs.length} 条 · 行情 {item.positionAdvice.market.provider}
                              {item.positionAdvice.market.fallbackUsed ? ' · 已回退' : ''}
                              {item.positionAdvice.cache ? ` · 下次刷新 ${formatTraceTime(item.positionAdvice.cache.nextRefreshAfter)}` : ''}
                            </div>
                          </div>
                        )}
                        </div>
                        <div className="hidden">
                          <div className="rounded-md border border-sky-400/20 bg-sky-400/10 p-3">
                            <div className="mb-1 text-sky-100">基本面</div>
                            <div className="leading-5">{item.fundamental.quality}</div>
                            <div className="mt-1 leading-5 text-gray-400">{item.fundamental.valuation}</div>
                          </div>
                          <div className="rounded-md border border-emerald-400/20 bg-emerald-400/10 p-3">
                            <div className="mb-1 text-emerald-100">技术面</div>
                            <div className="leading-5">{item.technical.trend}</div>
                            <div className="mt-1 leading-5 text-gray-400">{item.fundamental.risk}</div>
                          </div>
                          <div className="rounded-md border border-amber-400/20 bg-amber-400/10 p-3">
                            <div className="mb-1 text-amber-100">消息面</div>
                            <div className="leading-5">{item.news.sentiment}</div>
                            <div className="mt-2 flex flex-wrap gap-1">
                              {item.news.watchItems.slice(0, 3).map((watchItem) => (
                                <span
                                  key={watchItem}
                                  className="inline-flex max-w-full rounded px-2 py-1 text-[11px] leading-4 text-amber-100"
                                  style={{ background: 'rgba(245, 158, 11, 0.22)', overflowWrap: 'anywhere' }}
                                >
                                  {watchItem}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        {item.tags.length > 0 && (
                          <div className="mt-3 flex flex-wrap gap-1">
                            {item.tags.map((tag) => <Tag key={tag} color="#818cf8">{tag}</Tag>)}
                          </div>
                        )}
                      </Card>
                    </Col>
                  )})}
                </Row>
                </div>
              )}
            </Card>
              )}
            </div>

            <aside className="hidden lg:block">
              <div className="sticky top-6">
                <AnalysisQuickPanel
                  summary={structuredAdvice?.summary || marketOutlook || '暂无摘要'}
                  riskLevel={riskLevel}
                  suggestionsCount={suggestions.length}
                  highPriorityCount={highPriorityCount}
                  pendingCount={pendingSuggestions.length}
                  executedCount={executedSuggestions.length}
                  dataReliability={dataReliability}
                  activeQuery={activeQuery}
                  overallScore={overallScore}
                  holdingsCount={holdingsResearch.length}
                  scope={structuredAdvice?.scope}
                  requiresConfirmation={structuredAdvice?.required_user_confirmation}
                  onJumpToSuggestions={jumpToSuggestions}
                  topPending={topPending}
                  topExecuted={topExecuted}
                />
              </div>
            </aside>
          </div>
          <div className="text-xs text-gray-500 leading-5">
            {disclaimer}
          </div>
        </>
      )}

      <Modal
        title={<span className="text-white">{selectedHoldingResearch?.name || '持仓详情'}</span>}
        open={Boolean(selectedHoldingResearch)}
        onCancel={() => setSelectedHoldingResearch(null)}
        footer={[
          <Button key="close" onClick={() => setSelectedHoldingResearch(null)}>
            关闭
          </Button>,
        ]}
        width={860}
      >
        {selectedHoldingResearch && (
          <div className="space-y-4">
            <div className="rounded-lg border border-white/10 bg-[#161629] p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Tag color="#38bdf8">{selectedHoldingResearch.symbol}</Tag>
                <Tag color="#818cf8">{selectedHoldingResearch.type}</Tag>
                <Tag color={selectedHoldingResearch.technical.pnlPercent >= 0 ? '#34d399' : '#f87171'}>
                  {selectedHoldingResearch.technical.pnlPercent.toFixed(2)}%
                </Tag>
              </div>
              <div className="text-sm leading-6 text-white">{selectedHoldingResearch.summary}</div>
              <div className="mt-3 flex flex-wrap gap-1">
                {selectedHoldingResearch.keyEvidence?.map((evidence) => (
                  <Tag key={evidence} color="#64748b" style={{ marginRight: 0 }}>{evidence}</Tag>
                ))}
              </div>
              <div className="mt-3">
                <DataGapPanel gaps={selectedHoldingResearch.dataGapSummary} title="持仓研究数据缺口" />
              </div>
            </div>

            {selectedHoldingResearch.valueAssessment && selectedHoldingResearch.valueAssessment.valuation.status !== 'not_applicable' && (
              <div className="rounded-lg border border-cyan-300/20 bg-cyan-400/10 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-cyan-100">价值评估模型</div>
                  <Tag color={VALUE_ASSESSMENT_STATUS[selectedHoldingResearch.valueAssessment.valuation.status]?.color || '#94a3b8'}>
                    {VALUE_ASSESSMENT_STATUS[selectedHoldingResearch.valueAssessment.valuation.status]?.label || selectedHoldingResearch.valueAssessment.valuation.status}
                  </Tag>
                  <Tag color="#38bdf8">
                    {VALUE_CONCLUSION_LABEL[selectedHoldingResearch.valueAssessment.valuation.conclusion] || selectedHoldingResearch.valueAssessment.valuation.conclusion}
                  </Tag>
                  <Tag color="#818cf8">可信度 {selectedHoldingResearch.valueAssessment.valuation.confidence}</Tag>
                </div>
                <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-5">
                  <div>综合 {selectedHoldingResearch.valueAssessment.valuation.compositeScore ?? '--'}</div>
                  <div>估值 {selectedHoldingResearch.valueAssessment.valuation.valuationScore ?? '--'}</div>
                  <div>质量 {selectedHoldingResearch.valueAssessment.valuation.qualityScore ?? '--'}</div>
                  <div>成长 {selectedHoldingResearch.valueAssessment.valuation.growthScore ?? '--'}</div>
                  <div>财务安全 {selectedHoldingResearch.valueAssessment.valuation.financialRiskScore ?? '--'}</div>
                </div>
                <div className="mt-2 text-xs leading-5 text-gray-300">
                  方法：{selectedHoldingResearch.valueAssessment.valuation.method}；仓位乘数 ×{selectedHoldingResearch.valueAssessment.valuation.targetWeightMultiplier}
                </div>
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border border-white/10 bg-black/10 p-3 text-xs leading-5 text-gray-300">
                    <div className="mb-1 text-cyan-100">模型依据</div>
                    {selectedHoldingResearch.valueAssessment.valuation.reasons.map((reason) => <div key={reason}>- {reason}</div>)}
                  </div>
                  <div className="rounded-md border border-white/10 bg-black/10 p-3 text-xs leading-5 text-amber-100">
                    <div className="mb-1">风险与阻断</div>
                    {[
                      ...selectedHoldingResearch.valueAssessment.valuation.risks,
                      ...selectedHoldingResearch.valueAssessment.valuation.blockedReasons.map((reason) => `阻断：${reason}`),
                    ].map((item) => <div key={item}>- {item}</div>)}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-gray-300 md:grid-cols-3">
                  {selectedHoldingResearch.valueAssessment.facts.slice(0, 9).map((fact) => (
                    <div key={fact.id} className="rounded border border-white/10 bg-black/10 p-2">
                      <div className="text-gray-400">{fact.label}</div>
                      <div className="text-white">{fact.value ?? '--'}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedHoldingResearch.positionAdvice && (
              <div className="rounded-lg border border-indigo-300/20 bg-indigo-400/10 p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-indigo-100">仓位建议引擎</div>
                  <Tag color={POSITION_ADVICE_ACTION[selectedHoldingResearch.positionAdvice.action]?.color || '#94a3b8'}>
                    {POSITION_ADVICE_ACTION[selectedHoldingResearch.positionAdvice.action]?.label || selectedHoldingResearch.positionAdvice.action}
                  </Tag>
                  <Tag color={POSITION_ADVICE_CONFIDENCE[selectedHoldingResearch.positionAdvice.confidence]?.color || '#94a3b8'}>
                    {POSITION_ADVICE_CONFIDENCE[selectedHoldingResearch.positionAdvice.confidence]?.label || selectedHoldingResearch.positionAdvice.confidence}
                  </Tag>
                </div>
                <div className="grid gap-3 text-xs text-gray-300 md:grid-cols-4">
                  <div>当前仓位 {selectedHoldingResearch.positionAdvice.currentWeightPct.toFixed(2)}%</div>
                  <div>目标 {formatRatioPercent(selectedHoldingResearch.positionAdvice.targetWeightRange[0])} - {formatRatioPercent(selectedHoldingResearch.positionAdvice.targetWeightRange[1])}</div>
                  <div>策略证据 {selectedHoldingResearch.positionAdvice.strategyEvidenceCount} 条</div>
                  <div>行情 {selectedHoldingResearch.positionAdvice.market.provider}</div>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-gray-300 md:grid-cols-5">
                  <div>趋势 {formatScore(selectedHoldingResearch.positionAdvice.scores.trend)}</div>
                  <div>动量 {formatScore(selectedHoldingResearch.positionAdvice.scores.momentum)}</div>
                  <div>相对强弱 {formatScore(selectedHoldingResearch.positionAdvice.scores.relativeStrength)}</div>
                  <div>波动 {formatScore(selectedHoldingResearch.positionAdvice.scores.volatility)}</div>
                  <div>流动性 {formatScore(selectedHoldingResearch.positionAdvice.scores.liquidity)}</div>
                </div>
                {selectedHoldingResearch.positionAdvice.explanation && (
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="rounded-md border border-white/10 bg-black/10 p-3 text-xs leading-5 text-gray-300">
                      <div className="mb-2 text-indigo-100">目标仓位公式</div>
                      <div>基础目标 {formatRatioPercent(selectedHoldingResearch.positionAdvice.explanation.formula.baseTargetWeight)}</div>
                      <div>市场系数 ×{selectedHoldingResearch.positionAdvice.explanation.formula.marketRegimeMultiplier}</div>
                      <div>信号系数 ×{selectedHoldingResearch.positionAdvice.explanation.formula.signalMultiplier}</div>
                      <div>风险惩罚 ×{selectedHoldingResearch.positionAdvice.explanation.formula.riskPenaltyMultiplier}</div>
                      <div>FIVD-R ×{selectedHoldingResearch.positionAdvice.explanation.formula.fivdRCombinedMultiplier ?? 1}</div>
                      <div>可信度 ×{selectedHoldingResearch.positionAdvice.explanation.formula.confidenceMultiplier}</div>
                      <div className="mt-1 text-white">
                        计算目标 {formatRatioPercent(selectedHoldingResearch.positionAdvice.explanation.formula.finalTargetWeight)}
                        {' / '}
                        当前 {formatRatioPercent(selectedHoldingResearch.positionAdvice.explanation.formula.currentWeight)}
                      </div>
                      <div className="text-gray-400">
                        差额 {formatRatioPercent(selectedHoldingResearch.positionAdvice.explanation.formula.delta)}
                      </div>
                    </div>
                    {selectedHoldingResearch.positionAdvice.fivdRImpact && (
                      <div className="rounded-md border border-white/10 bg-black/10 p-3 text-xs leading-5 text-gray-300">
                        <div className="mb-2 text-indigo-100">FIVD-R Adapter</div>
                        <div>valuation ×{selectedHoldingResearch.positionAdvice.fivdRImpact.valuationMultiplier}</div>
                        <div>risk ×{selectedHoldingResearch.positionAdvice.fivdRImpact.riskPenaltyMultiplier}</div>
                        <div>evidence ×{selectedHoldingResearch.positionAdvice.fivdRImpact.evidenceConfidenceMultiplier}</div>
                        <div>validation ×{selectedHoldingResearch.positionAdvice.fivdRImpact.validationGateMultiplier}</div>
                        <div>combined ×{selectedHoldingResearch.positionAdvice.fivdRImpact.combinedMultiplier}</div>
                        <div className="mt-1 text-gray-400">
                          {selectedHoldingResearch.positionAdvice.fivdRImpact.valuationStatus}
                          {' / '}
                          {selectedHoldingResearch.positionAdvice.fivdRImpact.valuationConfidence}
                        </div>
                      </div>
                    )}
                    <div className="rounded-md border border-white/10 bg-black/10 p-3 text-xs leading-5 text-gray-300">
                      <div className="mb-2 text-indigo-100">动作触发规则</div>
                      {(selectedHoldingResearch.positionAdvice.explanation.actionTriggers.length > 0
                        ? selectedHoldingResearch.positionAdvice.explanation.actionTriggers
                        : ['未触发硬性动作规则，按目标仓位差额判断。']
                      ).map((item) => <div key={item}>- {item}</div>)}
                      {selectedHoldingResearch.positionAdvice.explanation.riskPenaltyReasons.map((item) => (
                        <div key={item} className="text-amber-200">- {item}</div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedHoldingResearch.positionAdvice.explanation?.evidenceGaps.length ? (
                  <div className="mt-3 rounded-md border border-amber-300/20 bg-amber-400/10 p-3 text-xs leading-5 text-amber-100">
                    <div className="mb-1 font-medium">证据缺口</div>
                    {selectedHoldingResearch.positionAdvice.explanation.evidenceGaps.map((gap) => (
                      <div key={gap}>- {gap}</div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 space-y-2 text-sm leading-6 text-gray-200">
                  {selectedHoldingResearch.positionAdvice.reasons.map((reason) => <div key={reason}>理由：{reason}</div>)}
                  {selectedHoldingResearch.positionAdvice.risks.map((risk) => <div key={risk} className="text-amber-200">风险：{risk}</div>)}
                </div>
                {selectedHoldingResearch.positionAdvice.blockedReasons.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {selectedHoldingResearch.positionAdvice.blockedReasons.map((reason) => (
                      <Tag key={reason} color="#f87171">{reason}</Tag>
                    ))}
                  </div>
                )}
                <div className="mt-3 text-xs text-gray-400">
                  触发条件：{selectedHoldingResearch.positionAdvice.triggerConditions.join('；')}
                </div>
                <div className="mt-2 text-xs text-gray-400">
                  反证条件：{selectedHoldingResearch.positionAdvice.invalidationConditions.join('；')}
                </div>
              </div>
            )}

            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-lg border border-sky-400/20 bg-sky-400/10 p-3">
                <div className="mb-1 text-sm text-sky-100">基本面</div>
                <div className="text-sm leading-6 text-white">{selectedHoldingResearch.fundamental.quality}</div>
                <div className="mt-2 text-xs leading-5 text-gray-300">{selectedHoldingResearch.fundamental.valuation}</div>
                {(selectedHoldingResearch.fundamental.details || []).length > 0 && (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-gray-300">
                    {selectedHoldingResearch.fundamental.details?.map((item) => <div key={item}>- {item}</div>)}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 p-3">
                <div className="mb-1 text-sm text-emerald-100">技术面</div>
                <div className="text-sm leading-6 text-white">{selectedHoldingResearch.technical.trend}</div>
                <div className="mt-2 grid gap-1 text-xs leading-5 text-gray-300">
                  <div>现价 {formatMoney(selectedHoldingResearch.technical.currentPrice)} / 成本 {formatMoney(selectedHoldingResearch.technical.avgCost)}</div>
                  <div>浮盈亏 {formatPercent(selectedHoldingResearch.technical.pnlPercent)}</div>
                  <div>
                    支撑 {selectedHoldingResearch.technical.support ? formatMoney(selectedHoldingResearch.technical.support) : '--'}
                    {' / '}
                    压力 {selectedHoldingResearch.technical.resistance ? formatMoney(selectedHoldingResearch.technical.resistance) : '--'}
                  </div>
                </div>
                {(selectedHoldingResearch.technical.details || []).length > 0 && (
                  <div className="mt-2 space-y-1 text-xs leading-5 text-gray-300">
                    {selectedHoldingResearch.technical.details?.map((item) => <div key={item}>- {item}</div>)}
                  </div>
                )}
              </div>
              <div className="rounded-lg border border-amber-400/20 bg-amber-400/10 p-3">
                <div className="mb-1 text-sm text-amber-100">消息面</div>
                <div className="text-sm leading-6 text-white">{selectedHoldingResearch.news.sentiment}</div>
                {(selectedHoldingResearch.news.events || []).length > 0 && (
                  <div className="mt-2 space-y-2 text-xs leading-5 text-gray-300">
                    {selectedHoldingResearch.news.events?.map((event) => (
                      <div key={`${event.evidenceRef}-${event.title}`} className="rounded border border-white/10 bg-black/10 p-2">
                        <div className="text-white">{event.title}</div>
                        <div className="text-gray-400">{event.eventType} · {event.impact} · {formatTraceTime(event.publishedAt)}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedHoldingResearch.news.watchItems.map((item) => (
                    <Tag key={item} color="#f59e0b">{item}</Tag>
                  ))}
                </div>
              </div>
            </div>
            {selectedHoldingResearch.researchEvidenceDetails && (
              <div className="mt-4 rounded-lg border border-white/10 bg-[#161629] p-4">
                <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="text-sm text-white">结构化事实集</div>
                    <div className="mt-1 text-xs text-gray-400">
                      用于研究和缺口审计，不代表交易动作放行。
                    </div>
                  </div>
                  <Tag color="#38bdf8">
                    {selectedHoldingResearch.researchEvidenceDetails.schemaVersion}
                  </Tag>
                </div>
                <div className="mb-3 text-xs text-gray-400">
                  技术来源 {selectedHoldingResearch.researchEvidenceDetails.technical.source}
                  {' · '}
                  截止 {formatTraceTime(selectedHoldingResearch.researchEvidenceDetails.technical.asOf)}
                  {' · '}
                  估值方法 {selectedHoldingResearch.researchEvidenceDetails.valuation.method}
                </div>
                <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-5">
                  {selectedHoldingResearch.researchEvidenceDetails.technical.fields.map((field) => (
                    <div key={field.key} className="rounded border border-white/10 bg-black/10 p-2">
                      <div className="text-gray-500">{field.label}</div>
                      <div className={field.value === null ? 'text-amber-200' : 'text-white'}>
                        {formatEvidenceValue(field.value, field.unit)}
                      </div>
                    </div>
                  ))}
                </div>
                {selectedHoldingResearch.researchEvidenceDetails.fundamental.facts.length > 0 && (
                  <div className="mt-3">
                    <div className="mb-2 text-xs text-gray-400">基本面/价值事实</div>
                    <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-4">
                      {selectedHoldingResearch.researchEvidenceDetails.fundamental.facts.slice(0, 8).map((fact) => (
                        <div key={fact.id} className="rounded border border-white/10 bg-black/10 p-2">
                          <div className="text-gray-500">{fact.label}</div>
                          <div className={fact.quality === 'ok' ? 'text-white' : 'text-amber-200'}>
                            {formatEvidenceValue(fact.value)}
                          </div>
                          <div className="mt-1 text-[11px] text-gray-500">{fact.source}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {selectedHoldingResearch.researchEvidenceDetails.valuation.reasons.length > 0 && (
                  <div className="mt-3 text-xs leading-5 text-gray-300">
                    估值依据：{selectedHoldingResearch.researchEvidenceDetails.valuation.reasons.slice(0, 3).join('；')}
                  </div>
                )}
                {selectedHoldingResearch.researchEvidenceDetails.valuation.blockedReasons.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {selectedHoldingResearch.researchEvidenceDetails.valuation.blockedReasons.slice(0, 6).map((reason) => (
                      <Tag key={reason} color="#f87171">{reason}</Tag>
                    ))}
                  </div>
                )}
                {selectedHoldingResearch.researchEvidenceDetails.fundLike && (
                  <div className="mt-4 rounded border border-emerald-400/20 bg-emerald-400/10 p-3">
                    <div className="mb-2 text-sm text-emerald-100">基金/债基专属事实</div>
                    <div className="grid gap-2 text-xs text-gray-300 md:grid-cols-4">
                      <div className="rounded border border-white/10 bg-black/10 p-2">
                        <div className="text-gray-500">风险等级代理</div>
                        <div className="text-white">
                          {selectedHoldingResearch.researchEvidenceDetails.fundLike.riskLevelProxy?.riskLevel || '--'}
                          {typeof selectedHoldingResearch.researchEvidenceDetails.fundLike.riskLevelProxy?.score === 'number'
                            ? ` / ${selectedHoldingResearch.researchEvidenceDetails.fundLike.riskLevelProxy.score}`
                            : ''}
                        </div>
                      </div>
                      <div className="rounded border border-white/10 bg-black/10 p-2">
                        <div className="text-gray-500">净值历史</div>
                        <div className="text-white">
                          {selectedHoldingResearch.researchEvidenceDetails.fundLike.navHistory?.sampleSize ?? '--'} 条
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500">
                          {selectedHoldingResearch.researchEvidenceDetails.fundLike.navHistory?.firstDate || '--'}
                          {' -> '}
                          {selectedHoldingResearch.researchEvidenceDetails.fundLike.navHistory?.latestDate || '--'}
                        </div>
                      </div>
                      <div className="rounded border border-white/10 bg-black/10 p-2">
                        <div className="text-gray-500">久期代理</div>
                        <div className="text-white">
                          {selectedHoldingResearch.researchEvidenceDetails.fundLike.durationProxy?.status === 'available'
                            ? `${selectedHoldingResearch.researchEvidenceDetails.fundLike.durationProxy.durationBucket} / ${selectedHoldingResearch.researchEvidenceDetails.fundLike.durationProxy.estimatedDurationYears ?? '--'} 年`
                            : selectedHoldingResearch.researchEvidenceDetails.fundLike.durationProxy?.status || '--'}
                        </div>
                      </div>
                      <div className="rounded border border-white/10 bg-black/10 p-2">
                        <div className="text-gray-500">债券配置 / 集中度</div>
                        <div className="text-white">
                          {typeof selectedHoldingResearch.researchEvidenceDetails.fundLike.bondRiskProxy?.bondPct === 'number'
                            ? `${selectedHoldingResearch.researchEvidenceDetails.fundLike.bondRiskProxy.bondPct.toFixed(2)}%`
                            : '--'}
                          {' / '}
                          {typeof selectedHoldingResearch.researchEvidenceDetails.fundLike.bondRiskProxy?.topBondConcentrationPct === 'number'
                            ? `${selectedHoldingResearch.researchEvidenceDetails.fundLike.bondRiskProxy.topBondConcentrationPct.toFixed(2)}%`
                            : '--'}
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 text-xs leading-5 text-amber-100">
                      方法：
                      {selectedHoldingResearch.researchEvidenceDetails.fundLike.riskLevelProxy?.method || '--'}
                      {'；'}
                      {selectedHoldingResearch.researchEvidenceDetails.fundLike.durationProxy?.method || '--'}
                    </div>
                    {Boolean(selectedHoldingResearch.researchEvidenceDetails.fundLike.bondRiskProxy?.creditRiskFlags.length) && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {selectedHoldingResearch.researchEvidenceDetails.fundLike.bondRiskProxy?.creditRiskFlags.slice(0, 6).map((flag) => (
                          <Tag key={flag} color="#f59e0b">{flag}</Tag>
                        ))}
                      </div>
                    )}
                    <div className="mt-2 text-[11px] leading-5 text-gray-400">
                      上述字段用于研究解释和缺口审计，不是官方风险评级、真实加权久期、到期收益率或交易动作依据。
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        title={<span className="text-white">{selectedFivdRPosition?.asset?.name || selectedFivdRSource?.name || 'FIVD-R 持仓详情'}</span>}
        open={selectedFivdRVisible}
        onCancel={() => {
          setSelectedFivdRVisible(false)
          setSelectedFivdRPosition(null)
          setSelectedFivdRError(null)
          setSelectedFivdRSource(null)
        }}
        footer={[
          <Button key="close" onClick={() => {
            setSelectedFivdRVisible(false)
            setSelectedFivdRPosition(null)
            setSelectedFivdRError(null)
            setSelectedFivdRSource(null)
          }}>
            关闭
          </Button>,
        ]}
        width={1120}
      >
        {selectedFivdRError ? (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm leading-6 text-red-100">
            <div className="mb-1 font-medium">加载失败</div>
            <div>{selectedFivdRError}</div>
            <div className="mt-2 text-xs text-red-200">
              positionId={selectedFivdRSource?.positionId || '--'} · symbol={selectedFivdRSource?.symbol || '--'}
            </div>
          </div>
        ) : (
          <FivdRPanel
            result={selectedFivdRPosition}
            loading={selectedFivdRLoading}
            onSaveSnapshot={handleSaveFivdRSnapshot}
            onAddWatch={handleAddFivdRWatch}
            onCreateRiskAlert={handleCreateFivdRRiskAlert}
            onRunValidationAudit={handleRunFivdRValidationAudit}
            onRunInfrastructureAudit={handleRunFivdRInfrastructureAudit}
            onCreateTradeDraft={handleCreateFivdRTradeDraft}
            actionLoading={fivdRActionLoading}
            onRefresh={() => {
              const positionId = selectedFivdRPosition?.asset?.positionId || selectedFivdRSource?.positionId
              if (!positionId) return
              openPositionFivdR({
                ...(selectedFivdRSource || {}),
                positionId,
              } as HoldingResearchItem)
            }}
          />
        )}
      </Modal>

      <TradingPlanModal
        visible={planModalVisible}
        onClose={() => setPlanModalVisible(false)}
        plan={tradingPlan}
      />
    </div>
  )
}

export default Analysis
