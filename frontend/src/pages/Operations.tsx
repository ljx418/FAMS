import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Dropdown,
  Empty,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Spin,
  Statistic,
  Table,
  Tag,
  message,
} from 'antd'
import type { MenuProps } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { BellOutlined, DatabaseOutlined, HistoryOutlined, MoreOutlined, ReloadOutlined, SearchOutlined, SyncOutlined, ThunderboltOutlined } from '@ant-design/icons'
import axios from 'axios'
import { useLocation, useNavigate } from 'react-router-dom'
import ProviderHealthSummary, { type ProviderHealthItem, ProviderHealthTags } from '../components/common/ProviderHealthSummary'
import RefreshFailureTable, { type RefreshFailureItem } from '../components/common/RefreshFailureTable'
import ReliabilityWarnings from '../components/common/ReliabilityWarnings'
import OperationTimeline from '../components/common/OperationTimeline'

const USER_ID = 'default'

type OperationStatus = 'queued' | 'running' | 'completed' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'partial'
type OperationType = 'refresh_prices' | 'check_alerts' | 'generate_daily_advice' | 'run_backtest' | 'generate_backtest_report' | 'stock_screener_full_scan' | 'batch_factset_refresh' | 'quote_list_market_cap_warmup' | 'market_bar_cache_preheat' | 'fivd_r_portfolio_refresh' | 'portfolio_backtest_run'
type ReliabilityStatus = 'healthy' | 'degraded' | 'failing' | 'unknown'
type AdviceScope = 'all' | 'asset' | 'sector'

interface DataReliabilitySummary {
  overallStatus: ReliabilityStatus
  averageConfidence?: number
  warningCount: number
  warnings: string[]
  providerSummary: ProviderHealthItem[]
}

interface OperationRecord {
  id: string
  operationId?: string
  operation_id?: string
  userId?: string
  parentOperationId?: string
  type: OperationType
  status: OperationStatus
  requestedAt: string
  startedAt?: string
  completedAt?: string
  progressPct?: number
  progressCurrent?: number | null
  progressTotal?: number | null
  progressMessage?: string | null
  cancelRequested?: boolean
  createdBy?: string
  input?: Record<string, unknown>
  result?: Record<string, any>
  error?: Record<string, any>
  artifactRefs?: string[]
  nextActions?: OperationNextAction[]
  tasks?: OperationTaskRecord[]
}

interface OperationTaskRecord {
  id: string
  name: string
  chunkIndex?: number | null
  status: OperationStatus
  startedAt?: string | null
  completedAt?: string | null
  durationMs?: number | null
  successCount?: number
  failureCount?: number
  provider?: string | null
  cacheHitRate?: number | null
  warnings?: string[]
  metrics?: Record<string, any>
  error?: Record<string, any>
}

interface OperationNextAction {
  type: string
  label: string
  href?: string
  method?: 'GET' | 'POST'
  endpoint?: string
  body?: Record<string, any>
}

interface OperationArtifactDetail {
  ref: string
  type: string
  id: string
  title: string
  createdAt?: string
  data: any
}

interface FactsetSchedulerStatus {
  name: string
  config: {
    enabled: boolean
    cronExpression: string
    timezone: string
    userId: string
    horizonMinutes: number
    limit: number
    allowTradingHours: boolean
  }
  runtime: {
    localRunning: boolean
    taskStarted: boolean
  }
  lease: null | {
    leaseOwner?: string | null
    leaseExpiresAt?: string | null
    heartbeatAt?: string | null
    locked: boolean
    expired: boolean
  }
  lastRunAt?: string | null
  lastResult?: Record<string, any>
}

interface AdviceSuggestionPreview {
  id: string
  title: string
  description: string
  priority: 'low' | 'medium' | 'high'
  actionType?: 'buy' | 'sell' | 'hold' | 'rebalance' | 'grid_order' | 'dca'
  targetSymbol?: string
  status?: string
}

interface AdvicePreviewResult {
  adviceId?: string
  adviceInputSnapshotId?: string
  snapshotIds?: {
    adviceInputSnapshotId?: string
    positionSnapshotIds?: string[]
    marketSnapshotIds?: string[]
  }
  artifactRefs?: string[]
  structuredAdvice?: {
    summary?: string
    risk_level?: 'low' | 'medium' | 'high'
    required_user_confirmation?: boolean
    scope?: string
    risks?: string[]
  }
  suggestions?: AdviceSuggestionPreview[]
  disclaimer?: string
  overallScore?: number
  marketOutlook?: string
  dataReliability?: DataReliabilitySummary
}

interface AdviceDetailResult {
  adviceId: string
  generatedAt: string
  summaryText?: string | null
  disclaimerText?: string | null
  riskLevel: string
  status: string
  schemaVersion: string
  rationaleText?: string | null
  query?: string | null
  scope?: string | null
  structuredAdvice?: AdvicePreviewResult['structuredAdvice'] | null
  suggestions?: AdviceSuggestionPreview[]
  dataReliability?: DataReliabilitySummary | null
  inputSnapshot?: {
    adviceInputSnapshotId: string
    capturedAt: string
    portfolio?: Record<string, any>
    positions?: Array<Record<string, any>>
    market?: Array<Record<string, any>>
    constraints?: Record<string, any>
  } | null
  actions?: Array<{
    id: string
    assetSymbol?: string | null
    assetName?: string | null
    actionType: string
    status: string
    execution?: { decision: string } | null
    transactions?: Array<{ id: string }>
  }>
  executionReview?: {
    executableActions: number
    executedActions: number
    pendingActions: number
    acceptedActions: number
    rejectedActions: number
    skippedActions: number
    executionRate: number
    suggestedNotional: number
    executedNotional: number
    buySide: {
      actionCount: number
      executedCount: number
      suggestedNotional: number
      executedNotional: number
      simulatedCurrentValue: number
      executedCurrentValue: number
      simulatedCurrentPnl: number
      executedCurrentPnl: number
    }
    sellSide: {
      actionCount: number
      executedCount: number
      suggestedNotional: number
      executedNotional: number
    }
    notes: string[]
  } | null
  artifactRefs?: string[]
}

interface BacktestDetailResult {
  id: string
  strategyId: string
  startDate: string
  endDate: string
  initialCapital: number
  finalCapital?: number | null
  status: string
  progress: number
  metrics?: {
    totalReturn?: number | null
    annualizedReturn?: number | null
    maxDrawdown?: number | null
    sharpeRatio?: number | null
    winRate?: number | null
    tradesCount?: number | null
  }
  reviewReport?: {
    kind: 'advice_execution_review'
    version: 'v1'
    adviceId: string
    strategyId: string
    backtestId: string
    generatedAt: string
    windowReview: {
      executionRate: number
      executableActions: number
      executedActions: number
      pendingActions: number
      buySide: {
        simulatedReturnPct: number | null
        executedReturnPct: number | null
        simulatedPnl: number
        executedPnl: number
      }
      sellSide: {
        simulatedRealizedReturnPct: number | null
        executedRealizedReturnPct: number | null
        simulatedRealizedPnl: number
        executedRealizedPnl: number
      }
      notes: string[]
    }
  } | null
  artifactRefs?: string[]
}

const STATUS_META: Record<OperationStatus, { color: string; label: string }> = {
  queued: { color: 'processing', label: '排队中' },
  running: { color: 'processing', label: '执行中' },
  completed: { color: 'success', label: '已完成' },
  succeeded: { color: 'success', label: '已完成' },
  partial: { color: 'warning', label: '部分成功' },
  failed: { color: 'error', label: '失败' },
  cancelling: { color: 'warning', label: '取消中' },
  cancelled: { color: 'default', label: '已取消' },
}

const TYPE_META: Record<OperationType, { label: string; color: string }> = {
  refresh_prices: { label: '刷新价格', color: '#38bdf8' },
  generate_daily_advice: { label: '生成每日建议', color: '#818cf8' },
  check_alerts: { label: '检查告警', color: '#fbbf24' },
  run_backtest: { label: '运行回测', color: '#34d399' },
  generate_backtest_report: { label: '回测报告', color: '#f97316' },
  stock_screener_full_scan: { label: '全A选股扫描', color: '#22c55e' },
  batch_factset_refresh: { label: '刷新事实集', color: '#a78bfa' },
  quote_list_market_cap_warmup: { label: '市值补齐', color: '#14b8a6' },
  market_bar_cache_preheat: { label: 'K线预热', color: '#f59e0b' },
  fivd_r_portfolio_refresh: { label: 'FIVD-R刷新', color: '#38bdf8' },
  portfolio_backtest_run: { label: '组合回测', color: '#22d3ee' },
}

const RELIABILITY_STATUS: Record<ReliabilityStatus, { color: string; label: string }> = {
  healthy: { color: '#34d399', label: '可靠' },
  degraded: { color: '#fbbf24', label: '降级' },
  failing: { color: '#f87171', label: '异常' },
  unknown: { color: '#818cf8', label: '未知' },
}

const formatDateTime = (value?: string) => {
  if (!value) return '--'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

const formatMoney = (value?: number | null) => `¥${(value || 0).toFixed(2)}`

const formatSignedMoney = (value?: number | null) => {
  const amount = value || 0
  return `${amount >= 0 ? '+' : '-'}¥${Math.abs(amount).toFixed(2)}`
}

const formatPercent = (value?: number | null) => `${(value || 0) >= 0 ? '+' : ''}${(value || 0).toFixed(2)}%`

const formatDuration = (start?: string, end?: string) => {
  if (!start) return '--'
  const startMs = new Date(start).getTime()
  const endMs = end ? new Date(end).getTime() : Date.now()
  const diffSeconds = Math.max(0, Math.round((endMs - startMs) / 1000))
  if (diffSeconds < 60) return `${diffSeconds}s`
  const minutes = Math.floor(diffSeconds / 60)
  const seconds = diffSeconds % 60
  return `${minutes}m ${seconds}s`
}

const STATUS_PRIORITY: Record<OperationStatus, number> = {
  failed: 0,
  running: 1,
  cancelling: 1,
  queued: 2,
  completed: 3,
  succeeded: 3,
  partial: 3,
  cancelled: 4,
}

const isActiveStatus = (status: OperationStatus) => status === 'queued' || status === 'running' || status === 'cancelling'
const isSuccessfulStatus = (status: OperationStatus) => status === 'completed' || status === 'succeeded' || status === 'partial'
const progressStatus = (status: OperationStatus) => status === 'failed'
  ? 'exception'
  : isSuccessfulStatus(status) ? 'success' : 'active'

const renderOperationSummary = (record: OperationRecord) => {
  if (record.status === 'failed') {
    return <span className="text-[#f87171]">{record.error?.message || '执行失败'}</span>
  }

  if (record.type === 'refresh_prices') {
    const refreshed = typeof record.result?.refreshed === 'number' ? record.result.refreshed : 0
    const externalRefreshed = typeof record.result?.externalRefreshed === 'number' ? record.result.externalRefreshed : refreshed
    const failed = typeof record.result?.failed === 'number' ? record.result.failed : 0
    const retainedLocalPrices = typeof record.result?.retainedLocalPrices === 'number' ? record.result.retainedLocalPrices : 0
    const abnormalPriceJumps = Array.isArray(record.result?.results)
      ? record.result.results.filter((item: any) => item.abnormalPriceJump).length
      : 0
    return (
      <div className="flex flex-wrap gap-2">
        <Tag color="#34d399">外部成功 {externalRefreshed}</Tag>
        <Tag color={failed > 0 ? '#f87171' : '#38bdf8'}>未刷新 {failed}</Tag>
        {retainedLocalPrices > 0 && <Tag color="#f59e0b">保留旧价 {retainedLocalPrices}</Tag>}
        {abnormalPriceJumps > 0 && <Tag color="#f87171">异常跳变 {abnormalPriceJumps}</Tag>}
      </div>
    )
  }

  if (record.type === 'generate_daily_advice') {
    const count = Array.isArray(record.result?.suggestions) ? record.result.suggestions.length : 0
    const riskLevel = record.result?.structuredAdvice?.risk_level as string | undefined
    return (
      <div className="flex flex-wrap gap-2">
        <Tag color="#818cf8">建议 {count}</Tag>
        {riskLevel && (
          <Tag color={riskLevel === 'high' ? '#f87171' : riskLevel === 'medium' ? '#fbbf24' : '#34d399'}>
            风险 {riskLevel}
          </Tag>
        )}
      </div>
    )
  }

  if (record.type === 'check_alerts') {
    const count = typeof record.result?.alertCount === 'number'
      ? record.result.alertCount
      : Array.isArray(record.result?.alertedSymbols) ? record.result.alertedSymbols.length : 0
    return (
      <div className="flex flex-wrap gap-2">
        <Tag color={count > 0 ? '#f87171' : '#34d399'}>触发 {count}</Tag>
        {record.result?.refreshPrices !== undefined && (
          <Tag color="#38bdf8">{record.result.refreshPrices ? '已刷新价格' : '未刷新价格'}</Tag>
        )}
      </div>
    )
  }

  if (record.type === 'run_backtest') {
    return (
      <div className="flex flex-wrap gap-2">
        {record.result?.backtestId && <Tag color="#34d399">Backtest {String(record.result.backtestId).slice(0, 8)}</Tag>}
        {record.result?.adviceId && <Tag color="#a78bfa">Advice {String(record.result.adviceId).slice(0, 8)}</Tag>}
      </div>
    )
  }

  if (record.type === 'stock_screener_full_scan') {
    const scanned = typeof record.result?.scannedCount === 'number' ? record.result.scannedCount : 0
    const matched = typeof record.result?.matchedCount === 'number' ? record.result.matchedCount : 0
    const failed = Array.isArray(record.result?.failures) ? record.result.failures.length : 0
    const partialSuccess = Boolean(record.result?.partialSuccess || failed > 0)
    return (
      <div className="flex flex-wrap gap-2">
        <Tag color="#38bdf8">扫描 {scanned}</Tag>
        <Tag color="#34d399">命中 {matched}</Tag>
        {partialSuccess && <Tag color="#fbbf24">部分成功</Tag>}
        {failed > 0 && <Tag color="#f87171">失败 {failed}</Tag>}
      </div>
    )
  }

  if (record.type === 'quote_list_market_cap_warmup') {
    const requested = typeof record.result?.requestedSymbols === 'number' ? record.result.requestedSymbols : record.progressTotal || 0
    const success = typeof record.result?.successCount === 'number' ? record.result.successCount : 0
    const failure = typeof record.result?.failureCount === 'number' ? record.result.failureCount : 0
    const fullCoverage = typeof record.result?.finalCoverage?.fullCoverageCount === 'number'
      ? record.result.finalCoverage.fullCoverageCount
      : undefined
    return (
      <div className="flex flex-wrap gap-2">
        <Tag color="#38bdf8">请求 {requested}</Tag>
        <Tag color="#34d399">成功 {success}</Tag>
        {failure > 0 && <Tag color="#f87171">失败 {failure}</Tag>}
        {fullCoverage !== undefined && <Tag color="#14b8a6">完整覆盖 {fullCoverage}</Tag>}
      </div>
    )
  }

  if (record.type === 'market_bar_cache_preheat') {
    const requested = typeof record.result?.requestedSymbols === 'number' ? record.result.requestedSymbols : record.progressTotal || 0
    const attempted = typeof record.result?.attemptedSymbols === 'number' ? record.result.attemptedSymbols : 0
    const success = typeof record.result?.successCount === 'number' ? record.result.successCount : 0
    const warning = typeof record.result?.warningCount === 'number' ? record.result.warningCount : 0
    const hitRate = typeof record.result?.afterCoverage?.estimatedCacheHitRate === 'number'
      ? record.result.afterCoverage.estimatedCacheHitRate
      : undefined
    return (
      <div className="flex flex-wrap gap-2">
        <Tag color="#38bdf8">样本 {requested}</Tag>
        <Tag color="#f59e0b">预热 {attempted}</Tag>
        <Tag color="#34d399">成功 {success}</Tag>
        {warning > 0 && <Tag color="#fbbf24">警告 {warning}</Tag>}
        {hitRate !== undefined && <Tag color="#14b8a6">命中 {hitRate}%</Tag>}
      </div>
    )
  }

  return <span className="text-gray-400">--</span>
}

const getArtifactRefFromSearch = (search: string) => {
  const refFromRouter = new URLSearchParams(search).get('artifactRef')
  if (refFromRouter) return refFromRouter

  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get('artifactRef')
}

const getOperationId = (data: any) => data?.operation_id || data?.operationId || data?.id

const asArray = (value: unknown): any[] => Array.isArray(value) ? value : []

const compactJson = (value: unknown) => {
  if (value == null) return '--'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

const getArtifactFilename = (artifact: OperationArtifactDetail | null) => {
  if (!artifact) return ''
  if (artifact.title && artifact.title.includes('.')) return artifact.title
  const parts = artifact.ref.split(':')
  return parts[parts.length - 1] || artifact.title || ''
}

const getOperationArtifactOperationId = (artifact: OperationArtifactDetail | null) => {
  if (!artifact || artifact.type !== 'operation_artifact') return null
  const prefix = 'operation_artifact:'
  if (!artifact.ref.startsWith(prefix)) return null
  const rest = artifact.ref.slice(prefix.length)
  const separatorIndex = rest.indexOf(':')
  return separatorIndex > 0 ? rest.slice(0, separatorIndex) : null
}

const SCREENER_ARTIFACT_NAV = [
  { filename: 'leaderboard.json', label: '策略排行' },
  { filename: 'strategy_metrics.json', label: '锦标赛总览' },
  { filename: 'execution_matrix.json', label: '执行矩阵' },
  { filename: 'sample_trades.csv', label: '样本交易' },
  { filename: 'equity_curve.json', label: '权益曲线' },
  { filename: 'drawdown_curve.json', label: '回撤曲线' },
  { filename: 'out_of_sample_validation.json', label: '样本外' },
  { filename: 'oos_failure_analysis.json', label: 'OOS失败分析' },
  { filename: 'oos_layered_validation.json', label: 'OOS分层复验' },
  { filename: 'validation_evidence_matrix.json', label: '验证矩阵' },
  { filename: 'oos_multi_window_regime_retest.json', label: '多窗口OOS' },
  { filename: 'validation_candidate_disposition.json', label: '候选处置' },
  { filename: 'validation_decision.json', label: '验证决策' },
  { filename: 'walk_forward_validation.json', label: 'Walk-forward' },
  { filename: 'parameter_sensitivity.json', label: '参数敏感性' },
  { filename: 'group_stability_report.json', label: '分组稳定性' },
  { filename: 'long_sample_acceptance.json', label: '长样本验收' },
  { filename: 'factset_preheat_coverage.json', label: '事实集覆盖' },
  { filename: 'market_constraint_coverage_report.json', label: '市场约束覆盖' },
  { filename: 'infrastructure_readiness_report.json', label: '基础设施就绪' },
  { filename: 'postgres_shadow_readiness_report.json', label: 'PG Shadow' },
  { filename: 'security_status_coverage_report.json', label: '证券状态覆盖' },
  { filename: 'validation_failure_taxonomy.json', label: '失败分类' },
  { filename: 'p4_closure_review.json', label: 'P4收口评审' },
  { filename: 'p5_closure_review.json', label: 'P5收口评审' },
  { filename: 'strategy_manifest.json', label: '版本清单' },
]

const getRelatedScreenerArtifactRefs = (artifact: OperationArtifactDetail | null) => {
  const operationId = getOperationArtifactOperationId(artifact)
  if (!operationId) return []
  return SCREENER_ARTIFACT_NAV.map((item) => ({
    ...item,
    ref: `operation_artifact:${operationId}:${item.filename}`,
    active: getArtifactFilename(artifact) === item.filename,
  }))
}

const numberOrNull = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

const formatPlainNumber = (value: unknown, digits = 2) => {
  const parsed = numberOrNull(value)
  return parsed == null ? '--' : parsed.toFixed(digits)
}

const formatArtifactPercent = (value: unknown) => {
  const parsed = numberOrNull(value)
  return parsed == null ? '--' : `${parsed >= 0 ? '+' : ''}${parsed.toFixed(2)}%`
}

const statusColor = (status?: string) => {
  if (!status) return '#64748b'
  if (['pass', 'passed', 'stable', 'succeeded', 'high', 'medium'].includes(status)) return '#34d399'
  if (['insufficient', 'warning', 'sensitive', 'partial', 'low', 'completed_with_blockers'].includes(status)) return '#fbbf24'
  if (['failed', 'error', 'unstable'].includes(status)) return '#f87171'
  return '#818cf8'
}

const buildSvgPoints = (values: number[], width: number, height: number) => {
  if (values.length === 0) return ''
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  return values.map((value, index) => {
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
    const y = height - ((value - min) / range) * height
    return `${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')
}

const MiniArtifactCurve: React.FC<{ points?: any[]; mode?: 'equity' | 'drawdown' }> = ({ points, mode = 'equity' }) => {
  const values = asArray(points)
    .map((point) => numberOrNull(mode === 'drawdown' ? point?.drawdownPercent : point?.value))
    .filter((value): value is number => value != null)

  if (values.length < 2) {
    return <div className="rounded border border-white/10 bg-[#0f172a99] p-3 text-xs text-gray-400">曲线样本不足</div>
  }

  const polyline = buildSvgPoints(values, 320, 76)
  const first = values[0]
  const last = values[values.length - 1]
  return (
    <div className="rounded border border-white/10 bg-[#0f172a99] p-3">
      <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
        <span>{mode === 'drawdown' ? '回撤曲线' : '权益曲线'}</span>
        <span>{formatPlainNumber(first)} {'->'} {formatPlainNumber(last)}</span>
      </div>
      <svg viewBox="0 0 320 76" className="h-20 w-full overflow-visible">
        <polyline
          fill="none"
          stroke={mode === 'drawdown' ? '#f87171' : '#34d399'}
          strokeWidth="2"
          points={polyline}
        />
      </svg>
    </div>
  )
}

const renderMetricTag = (label: string, value: unknown, color = '#38bdf8') => (
  <Tag key={`${label}-${String(value)}`} color={color}>{label} {String(value ?? '--')}</Tag>
)

const normalizeArtifactArray = (data: any) => {
  if (Array.isArray(data)) return data
  if (Array.isArray(data?.ranked)) return data.ranked
  if (Array.isArray(data?.candidates)) return data.candidates
  if (Array.isArray(data?.leaderboard)) return data.leaderboard
  return []
}

const parseCsvLine = (line: string) => {
  const cells: string[] = []
  let current = ''
  let quoted = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (char === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells
}

const parseSampleTradesCsv = (csv: string) => {
  const lines = csv.split('\n').map((line) => line.trim()).filter(Boolean)
  if (lines.length < 2) return []
  const headers = parseCsvLine(lines[0])
  return lines.slice(1).map((line, index) => {
    const cells = parseCsvLine(line)
    return headers.reduce<Record<string, string>>((row, header, cellIndex) => {
      row[header] = cells[cellIndex] || ''
      return row
    }, { key: `${index}-${line}` })
  })
}

const parameterLabel = (key: string) => {
  const labels: Record<string, string> = {
    drawdownPercent: '回撤阈值',
    sidewaysRangePercent: '横盘振幅',
    lastTwoVolumeRatio: '两日量比',
    minHistoryDays: '历史天数',
    reclaimVolumeRatio: '修复量比',
  }
  return labels[key] || key
}

const heatmapCellColor = (value: unknown, status?: string) => {
  const parsed = numberOrNull(value)
  if (status === 'insufficient' || parsed == null) return 'rgba(148, 163, 184, 0.22)'
  if (parsed >= 2) return 'rgba(16, 185, 129, 0.72)'
  if (parsed > 0) return 'rgba(52, 211, 153, 0.46)'
  if (parsed === 0) return 'rgba(251, 191, 36, 0.38)'
  if (parsed > -2) return 'rgba(248, 113, 113, 0.45)'
  return 'rgba(220, 38, 38, 0.7)'
}

const renderParameterHeatmap = (detail: any) => {
  const variants = asArray(detail?.variants)
  if (variants.length === 0) return null
  const baseThresholds = detail?.baseThresholds || variants[0]?.thresholds || {}
  const thresholdKeys = Array.from(new Set(variants.flatMap((variant) => Object.keys(variant.thresholds || {}))))
  const changedKeys = thresholdKeys.filter((key) => {
    const values = new Set(variants.map((variant) => String(variant.thresholds?.[key] ?? baseThresholds[key] ?? '')))
    return values.size > 1
  })
  const xKey = changedKeys[0] || thresholdKeys[0]
  const yKey = changedKeys[1]

  if (!xKey) return null

  const xValues = Array.from(new Set(variants.map((variant) => String(variant.thresholds?.[xKey] ?? baseThresholds[xKey] ?? '--'))))
  const yValues = yKey
    ? Array.from(new Set(variants.map((variant) => String(variant.thresholds?.[yKey] ?? baseThresholds[yKey] ?? '--'))))
    : ['参数变体']
  const findVariant = (xValue: string, yValue: string) => variants.find((variant) => {
    const variantX = String(variant.thresholds?.[xKey] ?? baseThresholds[xKey] ?? '--')
    const variantY = yKey ? String(variant.thresholds?.[yKey] ?? baseThresholds[yKey] ?? '--') : '参数变体'
    return variantX === xValue && variantY === yValue
  })

  return (
    <div className="mt-3 rounded-lg border border-white/10 bg-[#11182799] p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-gray-300">
        <span className="font-medium text-white">参数热力图</span>
        <Tag color="#38bdf8">X {parameterLabel(xKey)}</Tag>
        {yKey && <Tag color="#818cf8">Y {parameterLabel(yKey)}</Tag>}
        <Tag color="#64748b">颜色=超额收益</Tag>
      </div>
      <div className="overflow-x-auto">
        <div
          className="grid min-w-max gap-1 text-xs"
          style={{ gridTemplateColumns: `96px repeat(${xValues.length}, minmax(92px, 1fr))` }}
        >
          <div className="rounded bg-white/5 px-2 py-2 text-gray-400">{yKey ? parameterLabel(yKey) : '变体'}</div>
          {xValues.map((xValue) => (
            <div key={xValue} className="rounded bg-white/5 px-2 py-2 text-center text-gray-300">
              {parameterLabel(xKey)} {xValue}
            </div>
          ))}
          {yValues.map((yValue) => (
            <React.Fragment key={yValue}>
              <div className="rounded bg-white/5 px-2 py-2 text-gray-300">{yValue}</div>
              {xValues.map((xValue) => {
                const variant = findVariant(xValue, yValue)
                return (
                  <div
                    key={`${yValue}-${xValue}`}
                    className="min-h-[66px] rounded border border-white/10 p-2 text-center text-white"
                    style={{ background: heatmapCellColor(variant?.excessReturnPercent, variant?.status) }}
                    title={variant ? `${variant.variantId} / ${formatArtifactPercent(variant.excessReturnPercent)}` : '无样本'}
                  >
                    {variant ? (
                      <>
                        <div className="font-medium">{formatArtifactPercent(variant.excessReturnPercent)}</div>
                        <div className="mt-1 text-[11px] text-gray-100">成交 {variant.tradeCount ?? '--'}</div>
                        <div className="mt-1 text-[11px] text-gray-200">{variant.variantId || '--'}</div>
                      </>
                    ) : (
                      <div className="text-gray-400">--</div>
                    )}
                  </div>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

const renderStrategySummaryCard = (item: any, index: number) => (
  <div key={item.candidateId || item.strategyId || item.name || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div>
        <div className="text-sm font-medium text-white">{item.rank ? `#${item.rank} ` : ''}{item.name || item.strategyId || `策略 ${index + 1}`}</div>
        <div className="mt-1 text-xs text-gray-400 break-all">{item.candidateId || item.strategyId || item.auditHash || '--'}</div>
      </div>
      <Tag color={statusColor(item.credibility?.rating || item.credibility)}>{item.credibility?.rating || item.credibility || 'unknown'}</Tag>
    </div>
    <div className="mt-3 flex flex-wrap gap-2">
      {item.executionPolicy?.entryLabel && renderMetricTag('入场', item.executionPolicy.entryLabel, '#a78bfa')}
      {item.executionPolicy?.positionSizingLabel && renderMetricTag('仓位', item.executionPolicy.positionSizingLabel, '#22c55e')}
      {item.executionPolicy?.holdingDays != null && renderMetricTag('持有', `${item.executionPolicy.holdingDays}日`, '#fbbf24')}
      {renderMetricTag('样本', item.sampleSize, '#38bdf8')}
      {renderMetricTag('成交', item.tradeCount, '#34d399')}
      {renderMetricTag('胜率', formatArtifactPercent(item.winRatePercent), '#818cf8')}
      {renderMetricTag('超额', formatArtifactPercent(item.excessReturnPercent), Number(item.excessReturnPercent || 0) >= 0 ? '#34d399' : '#f87171')}
      {renderMetricTag('最大回撤', formatArtifactPercent(item.maxDrawdownPercent), '#f87171')}
    </div>
    {Array.isArray(item.equityCurve) && (
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <MiniArtifactCurve points={item.equityCurve} />
        <MiniArtifactCurve points={item.equityCurve} mode="drawdown" />
      </div>
    )}
  </div>
)

const renderValidationPreview = (title: string, entries: Array<[string, any]>) => (
  <Card size="small" title={title} className="bg-[#161629] border-white/10">
    <div className="grid gap-3 md:grid-cols-2">
      {entries.slice(0, 8).map(([strategyId, detail]) => (
        <div key={strategyId} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium text-white break-all">{strategyId}</span>
            <Tag color={statusColor(detail?.status)}>{detail?.status || '--'}</Tag>
          </div>
          <div className="flex flex-wrap gap-2">
            {renderMetricTag('样本外成交', detail?.outOfSample?.tradeCount ?? detail?.sampleCount, '#38bdf8')}
            {renderMetricTag('超额', formatArtifactPercent(detail?.outOfSample?.excessReturnPercent ?? detail?.excessReturnPercent), '#34d399')}
            {renderMetricTag('通过窗口', `${detail?.passedWindows ?? '--'}/${detail?.totalWindows ?? '--'}`, '#818cf8')}
          </div>
          {Array.isArray(detail?.warnings) && detail.warnings.length > 0 && (
            <div className="mt-2 text-xs leading-5 text-amber-200">{detail.warnings.slice(0, 3).join('；')}</div>
          )}
        </div>
      ))}
    </div>
  </Card>
)

const renderScreenerArtifactPreview = (artifact: OperationArtifactDetail | null) => {
  if (!artifact || artifact.type !== 'operation_artifact') return null
  const filename = getArtifactFilename(artifact)
  const data = artifact.data

  if (filename === 'leaderboard.json') {
    const rows = normalizeArtifactArray(data)
    if (rows.length === 0) return null
    return (
      <Card size="small" title="策略排行可视化" className="bg-[#161629] border-white/10">
        <div className="grid gap-3">
          {rows.slice(0, 6).map(renderStrategySummaryCard)}
        </div>
      </Card>
    )
  }

  if (filename === 'strategy_metrics.json') {
    const rows = normalizeArtifactArray(data)
    return (
      <Card size="small" title="策略锦标赛总览" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          {renderMetricTag('批次', data?.batchId || '--', '#818cf8')}
          {renderMetricTag('候选策略', rows.length, '#38bdf8')}
          {renderMetricTag('生成时间', data?.generatedAt || '--', '#64748b')}
        </div>
        <div className="grid gap-3">
          {rows.slice(0, 4).map(renderStrategySummaryCard)}
        </div>
      </Card>
    )
  }

  if (filename === 'execution_matrix.json') {
    const policies = asArray(data?.executionPolicies)
    const strategies = asArray(data?.signalStrategies)
    return (
      <Card size="small" title="策略 × 执行策略组合矩阵" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          {renderMetricTag('信号策略', strategies.length, '#38bdf8')}
          {renderMetricTag('执行策略', policies.length, '#fbbf24')}
          {renderMetricTag('候选组合', data?.totalCandidates ?? strategies.length * policies.length, '#34d399')}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {policies.map((policy, index) => (
            <div key={policy.id || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="text-sm font-medium text-white">{policy.label || policy.id || `执行策略 ${index + 1}`}</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {renderMetricTag('ID', policy.id || '--', '#818cf8')}
                {renderMetricTag('入场', policy.entryLabel || policy.entryMode || '--', '#a78bfa')}
                {renderMetricTag('退出', policy.exitMode || '--', '#f87171')}
                {renderMetricTag('仓位', policy.positionSizingLabel || policy.positionSizingMode || '--', '#22c55e')}
                {renderMetricTag('持有', `${policy.holdingDays ?? '--'}日`, '#fbbf24')}
              </div>
            </div>
          ))}
        </div>
      </Card>
    )
  }

  if (filename === 'equity_curve.json' || filename === 'drawdown_curve.json') {
    const entries = Object.entries(data || {})
    if (entries.length === 0) return null
    return (
      <Card size="small" title={filename === 'equity_curve.json' ? '权益曲线' : '回撤曲线'} className="bg-[#161629] border-white/10">
        <div className="grid gap-3 md:grid-cols-2">
          {entries.slice(0, 8).map(([strategyId, points]) => (
            <div key={strategyId}>
              <div className="mb-2 text-xs text-gray-400 break-all">{strategyId}</div>
              <MiniArtifactCurve points={asArray(points)} mode={filename === 'drawdown_curve.json' ? 'drawdown' : 'equity'} />
            </div>
          ))}
        </div>
      </Card>
    )
  }

  if (filename === 'out_of_sample_validation.json') {
    return renderValidationPreview('样本外验证', Object.entries(data || {}))
  }

  if (filename === 'walk_forward_validation.json') {
    return renderValidationPreview('Walk-forward 稳定性', Object.entries(data || {}))
  }

  if (filename === 'parameter_sensitivity.json') {
    const entries = Object.entries(data || {})
    if (entries.length === 0) return null
    return (
      <Card size="small" title="参数敏感性预览" className="bg-[#161629] border-white/10">
        <div className="grid gap-3 md:grid-cols-2">
          {entries.slice(0, 8).map(([strategyId, detail]: [string, any]) => (
            <div key={strategyId} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-white break-all">{strategyId}</span>
                <Tag color={statusColor(detail?.status)}>{detail?.status || '--'}</Tag>
              </div>
              <div className="mb-2 flex flex-wrap gap-2">
                {renderMetricTag('稳定变体', `${detail?.stableVariantCount ?? '--'}/${detail?.totalVariants ?? '--'}`, '#34d399')}
                {renderMetricTag('基准超额', formatArtifactPercent(detail?.baseExcessReturnPercent), '#818cf8')}
              </div>
              {renderParameterHeatmap(detail)}
              <div className="space-y-2">
                {asArray(detail?.variants).slice(0, 3).map((variant, index) => (
                  <div key={variant.variantId || index} className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300">
                    <span className="text-white">{variant.variantId || `变体 ${index + 1}`}</span>
                    <span className="ml-2">成交 {variant.tradeCount ?? '--'}</span>
                    <span className="ml-2">超额 {formatArtifactPercent(variant.excessReturnPercent)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    )
  }

  if (filename === 'group_stability_report.json') {
    const entries = Object.entries(data || {})
    if (entries.length === 0) return null
    return (
      <Card size="small" title="分组稳定性报告" className="bg-[#161629] border-white/10">
        <div className="grid gap-3">
          {entries.slice(0, 6).map(([candidateId, detail]: [string, any]) => (
            <div key={candidateId} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium text-white break-all">{candidateId}</span>
                <Tag color={statusColor(detail?.status)}>{detail?.status || '--'}</Tag>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {asArray(detail?.dimensions).map((dimension) => (
                  <div key={dimension.dimension || dimension.label} className="rounded border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-white">{dimension.label || dimension.dimension || '--'}</span>
                      <Tag color={statusColor(dimension.status)}>{dimension.status || '--'}</Tag>
                      {renderMetricTag('通过', `${dimension.passedGroups ?? '--'}/${dimension.totalGroups ?? '--'}`, '#34d399')}
                      {renderMetricTag('置信度', formatPlainNumber(dimension.averageConfidence, 2), '#818cf8')}
                    </div>
                    {Array.isArray(dimension.providerSummary) && dimension.providerSummary.length > 0 && (
                      <div className="mb-2 flex flex-wrap gap-1">
                        {dimension.providerSummary.slice(0, 3).map((provider: any, index: number) => (
                          <Tag key={`${provider.provider || index}`} color="#64748b">
                            {provider.provider || '--'} {provider.sampleSize ?? 0} / {formatPlainNumber(provider.averageConfidence, 2)}
                          </Tag>
                        ))}
                      </div>
                    )}
                    <div className="space-y-2">
                      {asArray(dimension.groups).slice(0, 4).map((group, index) => (
                        <div key={group.key || index} className="rounded bg-black/20 px-2 py-1 text-xs text-gray-300">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-white">{group.label || group.key || `分组 ${index + 1}`}</span>
                            <Tag color={statusColor(group.status)}>{group.status || '--'}</Tag>
                            <Tag color="#64748b">{group.provider || '--'}</Tag>
                          </div>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {renderMetricTag('样本', group.sampleSize ?? '--', '#38bdf8')}
                            {renderMetricTag('置信度', formatPlainNumber(group.confidence, 2), '#64748b')}
                            {renderMetricTag('胜率', formatArtifactPercent(group.winRatePercent), '#818cf8')}
                            {renderMetricTag('超额', formatArtifactPercent(group.excessReturnPercent), Number(group.excessReturnPercent || 0) >= 0 ? '#34d399' : '#f87171')}
                          </div>
                        </div>
                      ))}
                    </div>
                    {Array.isArray(dimension.warnings) && dimension.warnings.length > 0 && (
                      <div className="mt-2 text-xs leading-5 text-amber-200">{dimension.warnings.slice(0, 2).join('；')}</div>
                    )}
                  </div>
                ))}
              </div>
              {Array.isArray(detail?.warnings) && detail.warnings.length > 0 && (
                <div className="mt-2 text-xs leading-5 text-amber-200">{detail.warnings.slice(0, 3).join('；')}</div>
              )}
            </div>
          ))}
        </div>
      </Card>
    )
  }

  if (filename === 'long_sample_acceptance.json') {
    const summary = data?.summary || {}
    const gates = asArray(data?.gates)
    const candidates = asArray(data?.topCandidates)
    return (
      <Card size="small" title="全 A 长样本验收" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>状态 {data?.status || '--'}</Tag>
          {renderMetricTag('Universe', summary.universeSize ?? '--', '#64748b')}
          {renderMetricTag('扫描', summary.scannedCount ?? '--', '#38bdf8')}
          {renderMetricTag('评估', summary.evaluatedCount ?? '--', '#34d399')}
          {renderMetricTag('扫描覆盖', formatArtifactPercent(summary.scanCoveragePercent), '#818cf8')}
          {renderMetricTag('Provider成功率', formatArtifactPercent(summary.providerSuccessRate), '#22c55e')}
          {renderMetricTag('缓存命中', formatArtifactPercent(summary.cacheHitRate), '#a78bfa')}
          {renderMetricTag('回测天数', summary.backtestDays ?? '--', '#fbbf24')}
          {renderMetricTag('最佳样本', summary.bestSampleSize ?? '--', '#38bdf8')}
          {renderMetricTag('最佳可信度', summary.bestCredibility || '--', statusColor(summary.bestCredibility))}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {gates.map((gate, index) => (
            <div key={gate.id || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{gate.label || gate.id || `验收项 ${index + 1}`}</span>
                <Tag color={statusColor(gate.status)}>{gate.status || '--'}</Tag>
                <Tag color={gate.severity === 'blocker' ? '#f87171' : '#fbbf24'}>{gate.severity || '--'}</Tag>
              </div>
              <div className="flex flex-wrap gap-2">
                {renderMetricTag('实际', gate.actual ?? '--', '#38bdf8')}
                {renderMetricTag('要求', gate.required ?? '--', '#64748b')}
              </div>
              <div className="mt-2 text-xs leading-5 text-gray-300">{gate.message || '--'}</div>
            </div>
          ))}
        </div>
        {candidates.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0f172a99] p-3">
            <div className="mb-2 text-xs font-medium text-white">候选组合摘要</div>
            <div className="grid gap-2">
              {candidates.slice(0, 5).map((candidate, index) => (
                <div key={candidate.candidateId || index} className="rounded border border-white/10 bg-black/20 px-2 py-2 text-xs text-gray-300">
                  <div className="mb-1 break-all text-white">{candidate.candidateId || candidate.strategyId || `候选 ${index + 1}`}</div>
                  <div className="flex flex-wrap gap-2">
                    <Tag color={statusColor(candidate.credibility)}>{candidate.credibility || '--'}</Tag>
                    {renderMetricTag('样本', candidate.sampleSize ?? '--', '#38bdf8')}
                    {renderMetricTag('成交', candidate.tradeCount ?? '--', '#34d399')}
                    {renderMetricTag('超额', formatArtifactPercent(candidate.excessReturnPercent), Number(candidate.excessReturnPercent || 0) >= 0 ? '#34d399' : '#f87171')}
                    {renderMetricTag('样本外', candidate.outOfSampleStatus || '--', statusColor(candidate.outOfSampleStatus))}
                    {renderMetricTag('Walk', candidate.walkForwardStatus || '--', statusColor(candidate.walkForwardStatus))}
                    {renderMetricTag('参数', candidate.parameterSensitivityStatus || '--', statusColor(candidate.parameterSensitivityStatus))}
                    {renderMetricTag('分组', candidate.groupStabilityStatus || '--', statusColor(candidate.groupStabilityStatus))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {Array.isArray(data?.recommendations) && data.recommendations.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            {data.recommendations.slice(0, 5).join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'validation_decision.json') {
    const allowed = asArray(data?.allowedActions)
    const prohibited = asArray(data?.prohibitedActions)
    const blockers = asArray(data?.blockerGateIds)
    const reasons = asArray(data?.reasons)
    const checks = asArray(data?.requiredNextChecks)
    const oos = data?.oosSummary || {}
    return (
      <Card size="small" title="策略验证决策" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={data?.usableForTradingAdvice ? '#34d399' : '#fbbf24'}>
            {data?.decision || '--'}
          </Tag>
          <Tag color={statusColor(data?.confidence)}>{data?.confidence || '--'}</Tag>
          {data?.primaryBlocker && <Tag color="#f87171">主阻断 {data.primaryBlocker}</Tag>}
          {renderMetricTag('OOS通过', oos.passedCount ?? '--', '#34d399')}
          {renderMetricTag('OOS失败', oos.failedCount ?? '--', '#f87171')}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
            <div className="mb-2 text-xs font-medium text-white">允许动作</div>
            <div className="flex flex-wrap gap-2">
              {allowed.map((item, index) => <Tag key={`${item}-${index}`} color="#38bdf8">{item}</Tag>)}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
            <div className="mb-2 text-xs font-medium text-white">禁止动作</div>
            <div className="flex flex-wrap gap-2">
              {prohibited.map((item, index) => <Tag key={`${item}-${index}`} color="#f87171">{item}</Tag>)}
            </div>
          </div>
        </div>
        {blockers.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-300/20 bg-red-500/10 p-3 text-xs text-red-100">
            阻断 Gate：{blockers.join(' / ')}
          </div>
        )}
        {reasons.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
            {reasons.slice(0, 6).join('；')}
          </div>
        )}
        {checks.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            下一步：{checks.slice(0, 5).join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'oos_failure_analysis.json') {
    const candidates = asArray(data?.candidates)
    const tags = asArray(data?.globalFailureTags)
    return (
      <Card size="small" title="OOS失败分析" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          {renderMetricTag('诊断候选', data?.diagnosedCandidates ?? candidates.length, '#38bdf8')}
          {renderMetricTag('通过', data?.passedCount ?? '--', '#34d399')}
          {renderMetricTag('失败', data?.failedCount ?? '--', '#f87171')}
          {renderMetricTag('回测天数', data?.evaluationDays ?? '--', '#fbbf24')}
          {data?.batchId && renderMetricTag('批次', data.batchId, '#64748b')}
        </div>
        {data?.globalConclusion && (
          <div className="mb-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            {data.globalConclusion}
          </div>
        )}
        {tags.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {tags.map((tag, index) => <Tag key={`${tag}-${index}`} color="#fbbf24">{tag}</Tag>)}
          </div>
        )}
        <div className="grid gap-3">
          {candidates.slice(0, 6).map((candidate, index) => {
            const train = candidate.trainDistribution || {}
            const oos = candidate.outOfSampleDistribution || {}
            const deterioration = candidate.deterioration || {}
            const trainDates = asArray(candidate.signalDateDistribution?.train)
            const oosDates = asArray(candidate.signalDateDistribution?.outOfSample)
            return (
              <div key={candidate.candidateId || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="break-all text-sm font-medium text-white">{candidate.name || candidate.candidateId || `候选 ${index + 1}`}</span>
                  <Tag color={statusColor(candidate.oosStatus)}>{candidate.oosStatus || '--'}</Tag>
                  <Tag color={statusColor(candidate.credibility)}>{candidate.credibility || '--'}</Tag>
                  {candidate.recommendedAction && <Tag color="#818cf8">{candidate.recommendedAction}</Tag>}
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <div className="mb-2 text-xs font-medium text-white">训练窗口收益分布</div>
                    <div className="flex flex-wrap gap-2">
                      {renderMetricTag('样本', train.sampleSize ?? '--', '#38bdf8')}
                      {renderMetricTag('胜率', formatArtifactPercent(train.winRatePercent), '#818cf8')}
                      {renderMetricTag('均值', formatArtifactPercent(train.averageReturnPercent), '#34d399')}
                      {renderMetricTag('中位数', formatArtifactPercent(train.medianReturnPercent), '#a78bfa')}
                      {renderMetricTag('P25/P75', `${formatArtifactPercent(train.p25ReturnPercent)} / ${formatArtifactPercent(train.p75ReturnPercent)}`, '#64748b')}
                      {renderMetricTag('尾部', formatArtifactPercent(train.tailLossP95Percent), '#f87171')}
                    </div>
                  </div>
                  <div className="rounded border border-white/10 bg-black/20 p-2">
                    <div className="mb-2 text-xs font-medium text-white">样本外收益分布</div>
                    <div className="flex flex-wrap gap-2">
                      {renderMetricTag('样本', oos.sampleSize ?? '--', '#38bdf8')}
                      {renderMetricTag('胜率', formatArtifactPercent(oos.winRatePercent), '#818cf8')}
                      {renderMetricTag('均值', formatArtifactPercent(oos.averageReturnPercent), Number(oos.averageReturnPercent || 0) >= 0 ? '#34d399' : '#f87171')}
                      {renderMetricTag('中位数', formatArtifactPercent(oos.medianReturnPercent), '#a78bfa')}
                      {renderMetricTag('P25/P75', `${formatArtifactPercent(oos.p25ReturnPercent)} / ${formatArtifactPercent(oos.p75ReturnPercent)}`, '#64748b')}
                      {renderMetricTag('尾部', formatArtifactPercent(oos.tailLossP95Percent), '#f87171')}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {renderMetricTag('超额变化', formatArtifactPercent(deterioration.excessReturnDelta), '#fbbf24')}
                  {renderMetricTag('均值变化', formatArtifactPercent(deterioration.averageReturnDelta), '#fbbf24')}
                  {renderMetricTag('中位变化', formatArtifactPercent(deterioration.medianReturnDelta), '#fbbf24')}
                  {renderMetricTag('胜率变化', formatArtifactPercent(deterioration.winRateDelta), '#fbbf24')}
                </div>
                {asArray(candidate.failureTags).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {asArray(candidate.failureTags).map((tag, tagIndex) => <Tag key={`${tag}-${tagIndex}`} color="#f87171">{tag}</Tag>)}
                  </div>
                )}
                <div className="mt-2 grid gap-2 text-xs text-gray-400 md:grid-cols-2">
                  <div>训练日期桶：{trainDates.slice(0, 6).map((item) => `${item.date}:${item.count}`).join('，') || '--'}</div>
                  <div>样本外日期桶：{oosDates.slice(0, 6).map((item) => `${item.date}:${item.count}`).join('，') || '--'}</div>
                </div>
              </div>
            )
          })}
        </div>
      </Card>
    )
  }

  if (filename === 'oos_layered_validation.json') {
    const summary = data?.summary || {}
    const dimensions = asArray(data?.dimensions)
    const findings = asArray(data?.findings)
    const nextActions = asArray(data?.nextActions)
    return (
      <Card size="small" title="OOS分层复验" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>{data?.status || '--'}</Tag>
          {renderMetricTag('候选', summary.diagnosedCandidates ?? '--', '#38bdf8')}
          {renderMetricTag('分层桶', summary.buckets ?? '--', '#38bdf8')}
          {renderMetricTag('通过桶', summary.passedBuckets ?? '--', '#34d399')}
          {renderMetricTag('失败桶', summary.failedBuckets ?? '--', '#f87171')}
          {renderMetricTag('样本不足', summary.insufficientBuckets ?? '--', '#fbbf24')}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          {dimensions.map((dimension, index) => (
            <div key={dimension.dimension || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 text-sm font-medium text-white">{dimension.label || dimension.dimension || `维度 ${index + 1}`}</div>
              <div className="space-y-2">
                {asArray(dimension.buckets).slice(0, 5).map((bucket, bucketIndex) => (
                  <div key={`${bucket.key || bucketIndex}`} className="rounded border border-white/10 bg-black/20 p-2 text-xs leading-5 text-gray-300">
                    <div className="mb-1 flex flex-wrap items-center gap-1">
                      <span className="text-gray-100">{bucket.label || bucket.key || '--'}</span>
                      <Tag color={statusColor(bucket.status)}>{bucket.status || '--'}</Tag>
                    </div>
                    <div>OOS样本：{bucket.outOfSample?.sampleSize ?? '--'}，均值：{formatArtifactPercent(bucket.outOfSample?.averageReturnPercent)}</div>
                    <div>均值变化：{formatArtifactPercent(bucket.deterioration?.averageReturnDelta)}，胜率变化：{formatArtifactPercent(bucket.deterioration?.winRateDelta)}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {findings.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-300/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100">
            发现：{findings.join('；')}
          </div>
        )}
        {nextActions.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            下一步：{nextActions.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'validation_evidence_matrix.json') {
    const summary = data?.summary || {}
    const candidates = asArray(data?.candidates)
    const closurePlan = asArray(data?.closurePlan)
    return (
      <Card size="small" title="Validation Evidence 四项验证矩阵" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={data?.status === 'passed' ? '#34d399' : '#f87171'}>{data?.status || '--'}</Tag>
          <Tag color={data?.decision === 'READY_FOR_MANUAL_REVIEW' ? '#34d399' : '#f59e0b'}>{data?.decision || '--'}</Tag>
          {renderMetricTag('候选', summary.diagnosedCandidates ?? '--', '#38bdf8')}
          {renderMetricTag('通过', summary.passedCandidates ?? '--', '#34d399')}
          {renderMetricTag('失败', summary.failedCandidates ?? '--', '#f87171')}
          {renderMetricTag('样本不足', summary.insufficientCandidates ?? '--', '#fbbf24')}
          {renderMetricTag('主阻断', summary.primaryBlocker || '--', '#a78bfa')}
        </div>
        <div className="grid gap-3">
          {candidates.slice(0, 8).map((candidate, index) => {
            const validation = candidate.validation || {}
            const oos = candidate.oos || {}
            return (
              <div key={candidate.candidateId || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <div className="text-sm font-medium text-white">{candidate.name || candidate.strategyId || `候选 ${index + 1}`}</div>
                  <Tag color={validation.allPassed ? '#34d399' : '#f87171'}>{validation.allPassed ? '四项通过' : '未通过'}</Tag>
                  <Tag color="#64748b">{candidate.actionClass || '--'}</Tag>
                  {renderMetricTag('样本', candidate.sampleSize ?? '--', '#38bdf8')}
                  {renderMetricTag('交易', candidate.tradeCount ?? '--', '#818cf8')}
                  {renderMetricTag('超额', formatArtifactPercent(candidate.excessReturnPercent), Number(candidate.excessReturnPercent || 0) >= 0 ? '#34d399' : '#f87171')}
                </div>
                <div className="flex flex-wrap gap-2">
                  {renderMetricTag('OOS', validation.outOfSample || '--', statusColor(validation.outOfSample))}
                  {renderMetricTag('Walk-forward', validation.walkForward || '--', statusColor(validation.walkForward))}
                  {renderMetricTag('参数', validation.parameterSensitivity || '--', statusColor(validation.parameterSensitivity))}
                  {renderMetricTag('分组', validation.groupStability || '--', statusColor(validation.groupStability))}
                  {renderMetricTag('OOS超额变化', formatArtifactPercent(oos.excessReturnDelta), '#fbbf24')}
                  {renderMetricTag('OOS样本', oos.outSampleSize ?? '--', '#94a3b8')}
                </div>
                {asArray(candidate.blockerTags).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {asArray(candidate.blockerTags).slice(0, 8).map((tag, tagIndex) => (
                      <Tag key={`${tag}-${tagIndex}`} color="#f87171">{tag}</Tag>
                    ))}
                  </div>
                )}
                <div className="mt-2 text-xs leading-5 text-gray-300">{candidate.nextAction || '等待复验。'}</div>
              </div>
            )
          })}
        </div>
        {closurePlan.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            闭环计划：{closurePlan.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'oos_multi_window_regime_retest.json') {
    const summary = data?.summary || {}
    const candidates = asArray(data?.candidates)
    const findings = asArray(data?.findings)
    const nextActions = asArray(data?.nextActions)
    return (
      <Card size="small" title="OOS多窗口与市场状态复验" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>{data?.status || '--'}</Tag>
          {renderMetricTag('诊断候选', summary.diagnosedCandidates ?? '--', '#38bdf8')}
          {renderMetricTag('分析候选', summary.analyzedCandidates ?? '--', '#818cf8')}
          {renderMetricTag('窗口', summary.windows ?? '--', '#38bdf8')}
          {renderMetricTag('通过窗口', summary.passedWindows ?? '--', '#34d399')}
          {renderMetricTag('失败窗口', summary.failedWindows ?? '--', '#f87171')}
          {renderMetricTag('样本不足窗口', summary.insufficientWindows ?? '--', '#fbbf24')}
          {renderMetricTag('失败状态桶', summary.failedRegimeBuckets ?? '--', '#f87171')}
        </div>
        <div className="grid gap-3">
          {candidates.slice(0, 6).map((candidate, index) => (
            <div key={candidate.candidateId || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-white">{candidate.name || candidate.strategyId || `候选 ${index + 1}`}</div>
                <Tag color={statusColor(candidate.conclusion)}>{candidate.conclusion || '--'}</Tag>
                <Tag color="#64748b">{candidate.actionClass || '--'}</Tag>
                {renderMetricTag('样本', candidate.sampleSize ?? '--', '#38bdf8')}
                {renderMetricTag('交易', candidate.tradeCount ?? '--', '#818cf8')}
              </div>
              <div className="grid gap-2 md:grid-cols-3">
                {asArray(candidate.windows).map((window, windowIndex) => (
                  <div key={window.splitId || windowIndex} className="rounded border border-white/10 bg-black/20 p-2 text-xs leading-5 text-gray-300">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="text-gray-100">{window.splitId || `窗口 ${windowIndex + 1}`}</span>
                      <Tag color={statusColor(window.status)}>{window.status || '--'}</Tag>
                    </div>
                    <div>OOS样本：{window.outOfSample?.sampleSize ?? '--'}，均值：{formatArtifactPercent(window.outOfSample?.averageReturnPercent)}</div>
                    <div>胜率：{formatArtifactPercent(window.outOfSample?.winRatePercent)}，均值变化：{formatArtifactPercent(window.deterioration?.averageReturnDelta)}</div>
                  </div>
                ))}
              </div>
              {asArray(candidate.regimeBuckets).length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {asArray(candidate.regimeBuckets).slice(0, 6).map((bucket, bucketIndex) => (
                    <Tag key={`${bucket.regime || bucketIndex}`} color={statusColor(bucket.status)}>
                      {bucket.regime || '--'} OOS {bucket.outOfSample?.sampleSize ?? 0} / {bucket.status || '--'}
                    </Tag>
                  ))}
                </div>
              )}
              <div className="mt-2 text-xs leading-5 text-gray-300">{candidate.nextAction || '等待复验。'}</div>
            </div>
          ))}
        </div>
        {findings.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-300/20 bg-red-500/10 p-3 text-xs leading-5 text-red-100">
            发现：{findings.join('；')}
          </div>
        )}
        {nextActions.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            下一步：{nextActions.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'validation_candidate_disposition.json') {
    const summary = data?.summary || {}
    const candidates = asArray(data?.candidates)
    const rules = asArray(data?.rules)
    const nextActions = asArray(data?.nextActions)
    return (
      <Card size="small" title="候选组合处置" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={data?.status === 'ready_for_manual_review' ? '#34d399' : '#f59e0b'}>{data?.status || '--'}</Tag>
          <Tag color={data?.decision === 'READY_FOR_MANUAL_REVIEW' ? '#34d399' : '#f59e0b'}>{data?.decision || '--'}</Tag>
          {renderMetricTag('候选', summary.totalCandidates ?? '--', '#38bdf8')}
          {renderMetricTag('人工复核', summary.eligibleManualReview ?? '--', '#34d399')}
          {renderMetricTag('市场受限', summary.regimeLimitedCandidates ?? '--', '#fbbf24')}
          {renderMetricTag('观察', summary.observeOnly ?? '--', '#94a3b8')}
          {renderMetricTag('淘汰', summary.retiredCandidates ?? '--', '#f87171')}
          {renderMetricTag('补样本', summary.needsMoreSamples ?? '--', '#a78bfa')}
        </div>
        <div className="grid gap-3">
          {candidates.slice(0, 8).map((candidate, index) => (
            <div key={candidate.candidateId || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <div className="text-sm font-medium text-white">{candidate.name || candidate.strategyId || `候选 ${index + 1}`}</div>
                <Tag color={candidate.finalDisposition === 'eligible_manual_review' ? '#34d399' : candidate.finalDisposition === 'retire_candidate' ? '#f87171' : '#f59e0b'}>
                  {candidate.finalDisposition || '--'}
                </Tag>
                <Tag color="#64748b">{candidate.matrixActionClass || '--'}</Tag>
                {candidate.retestConclusion && <Tag color="#818cf8">{candidate.retestConclusion}</Tag>}
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                {asArray(candidate.failedChecks).map((check, checkIndex) => (
                  <Tag key={`${check}-${checkIndex}`} color="#f87171">{check}</Tag>
                ))}
                {asArray(candidate.allowedActions).map((action, actionIndex) => (
                  <Tag key={`${action}-${actionIndex}`} color="#34d399">{action}</Tag>
                ))}
              </div>
              <div className="text-xs leading-5 text-gray-300">{candidate.rationale || '--'}</div>
              <div className="mt-1 text-xs leading-5 text-amber-100">{candidate.nextAction || '等待复验。'}</div>
            </div>
          ))}
        </div>
        {rules.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-black/20 p-3 text-xs leading-5 text-gray-300">
            规则：{rules.join('；')}
          </div>
        )}
        {nextActions.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            下一步：{nextActions.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'factset_preheat_coverage.json') {
    const scanned = data?.scanned || {}
    const universe = data?.universe || {}
    const preheat = data?.preheat || {}
    return (
      <Card size="small" title="事实集预热覆盖率" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          {renderMetricTag('扫描样本', scanned.total ?? '--', '#38bdf8')}
          {renderMetricTag('行业覆盖', formatArtifactPercent(scanned.officialIndustryCoveragePercent), '#818cf8')}
          {renderMetricTag('市值覆盖', formatArtifactPercent(scanned.officialMarketCapCoveragePercent), '#a78bfa')}
          {renderMetricTag('完整覆盖', formatArtifactPercent(scanned.fullOfficialCoveragePercent), Number(scanned.fullOfficialCoveragePercent || 0) >= 80 ? '#34d399' : '#f87171')}
          {renderMetricTag('全样本完整覆盖', formatArtifactPercent(universe.fullOfficialCoveragePercent), '#64748b')}
          {renderMetricTag('预热尝试', preheat.attempted ?? 0, '#fbbf24')}
          {renderMetricTag('预热成功', preheat.successCount ?? 0, '#34d399')}
          {preheat.skippedReason && renderMetricTag('预热跳过', preheat.skippedReason, '#64748b')}
        </div>
        {Array.isArray(scanned.providerSummary) && scanned.providerSummary.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {scanned.providerSummary.map((provider: any, index: number) => (
              <Tag key={`${provider.provider || index}`} color="#64748b">
                {provider.provider || '--'} {provider.count ?? 0} / {formatArtifactPercent(provider.ratioPercent)}
              </Tag>
            ))}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
            <div className="mb-2 text-xs font-medium text-white">缺少行业事实</div>
            <div className="text-xs leading-5 text-gray-300">
              {asArray(scanned.missingIndustrySymbols).slice(0, 12).join('，') || '无'}
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
            <div className="mb-2 text-xs font-medium text-white">缺少市值事实</div>
            <div className="text-xs leading-5 text-gray-300">
              {asArray(scanned.missingMarketCapSymbols).slice(0, 12).join('，') || '无'}
            </div>
          </div>
        </div>
        {Array.isArray(data?.warnings) && data.warnings.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            {data.warnings.slice(0, 4).join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'infrastructure_readiness_report.json') {
    const gates = asArray(data?.gates)
    const required = asArray(data?.migrationPlan?.requiredBeforeProductionFullA)
    const sqliteScope = asArray(data?.migrationPlan?.sqliteAllowedScope)
    const postgresTarget = asArray(data?.migrationPlan?.postgresqlTarget)
    return (
      <Card size="small" title="基础设施就绪评审" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>{data?.status || '--'}</Tag>
          {renderMetricTag('数据库', data?.database?.provider || '--', data?.database?.provider === 'postgresql' ? '#34d399' : '#fbbf24')}
          {renderMetricTag('执行模式', data?.execution?.executionMode || '--', data?.execution?.executionMode === 'queued' ? '#34d399' : '#fbbf24')}
          {renderMetricTag('行情模式', data?.execution?.marketDataMode || '--', data?.execution?.marketDataMode === 'cache_only' ? '#34d399' : '#f87171')}
          {renderMetricTag('分片', data?.execution?.chunkSize ?? '--', '#38bdf8')}
          {renderMetricTag('并发', data?.execution?.concurrency ?? '--', '#818cf8')}
          {renderMetricTag('产物数', data?.execution?.artifactCount ?? '--', '#a78bfa')}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {gates.map((gate, index) => (
            <div key={gate.id || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{gate.label || gate.id || `Gate ${index + 1}`}</span>
                <Tag color={statusColor(gate.status)}>{gate.status || '--'}</Tag>
                <Tag color={gate.severity === 'blocker' ? '#f87171' : '#fbbf24'}>{gate.severity || '--'}</Tag>
              </div>
              <div className="text-xs leading-5 text-gray-300">{gate.message || '--'}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-red-300/20 bg-red-500/10 p-3">
            <div className="mb-2 text-xs font-medium text-red-100">正式全 A 前置项</div>
            <div className="text-xs leading-5 text-red-100">{required.join('；') || '--'}</div>
          </div>
          <div className="rounded-lg border border-amber-300/20 bg-amber-500/10 p-3">
            <div className="mb-2 text-xs font-medium text-amber-100">SQLite 允许范围</div>
            <div className="text-xs leading-5 text-amber-100">{sqliteScope.join('；') || '--'}</div>
          </div>
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3">
            <div className="mb-2 text-xs font-medium text-emerald-100">PostgreSQL 目标</div>
            <div className="text-xs leading-5 text-emerald-100">{postgresTarget.join('；') || '--'}</div>
          </div>
        </div>
      </Card>
    )
  }

  if (filename === 'market_constraint_coverage_report.json') {
    const summary = data?.summary || {}
    const reasons = asArray(data?.blockedReasonSummary)
    const gaps = asArray(data?.providerGaps)
    const nextActions = asArray(data?.nextActions)
    return (
      <Card size="small" title="市场约束覆盖报告" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>{data?.status || '--'}</Tag>
          {renderMetricTag('约束版本', data?.constraintVersion || '--', '#818cf8')}
          {renderMetricTag('候选组合', summary.rankedCandidates ?? '--', '#38bdf8')}
          {renderMetricTag('可执行样本', summary.executedSamples ?? '--', '#34d399')}
          {renderMetricTag('阻断样本', summary.blockedSamples ?? '--', '#f87171')}
          {renderMetricTag('阻断比例', formatArtifactPercent(summary.blockedRatioPercent), '#fbbf24')}
          {renderMetricTag('阻断标的', summary.uniqueBlockedSymbols ?? '--', '#a78bfa')}
        </div>
        <div className="grid gap-3">
          {reasons.slice(0, 8).map((item, index) => (
            <div key={`${item.reason || index}`} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{item.reason || `原因 ${index + 1}`}</span>
                <Tag color={statusColor(item.reliability)}>{item.reliability || '--'}</Tag>
                <Tag color={item.requiresOfficialProvider ? '#fbbf24' : '#34d399'}>
                  {item.requiresOfficialProvider ? '需正式源' : '本地可审计'}
                </Tag>
                {renderMetricTag('数量', item.count ?? '--', '#38bdf8')}
                {renderMetricTag('证据', item.evidenceType || '--', '#64748b')}
              </div>
              <div className="text-xs leading-5 text-gray-300">
                {asArray(item.symbols).slice(0, 12).join('，') || '--'}
              </div>
            </div>
          ))}
        </div>
        {gaps.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            Provider 缺口：{gaps.join('；')}
          </div>
        )}
        {nextActions.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
            下一步：{nextActions.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'postgres_shadow_readiness_report.json') {
    const stages = asArray(data?.requiredStages)
    const stagingTables = asArray(data?.copyStagingPlan?.stagingTables)
    const promoteRules = asArray(data?.copyStagingPlan?.promoteRules)
    const targets = asArray(data?.copyStagingPlan?.pressureTargets)
    const nextActions = asArray(data?.nextActions)
    return (
      <Card size="small" title="PostgreSQL Shadow 就绪" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>{data?.status || '--'}</Tag>
          {renderMetricTag('模式', data?.mode || '--', '#818cf8')}
          {renderMetricTag('当前库', data?.database?.currentProvider || '--', '#38bdf8')}
          {renderMetricTag('Shadow配置', data?.database?.shadowConfigured ? '是' : '否', data?.database?.shadowConfigured ? '#34d399' : '#f87171')}
          {renderMetricTag('Shadow类型', data?.database?.shadowUrlKind || '--', '#a78bfa')}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {stages.map((stage, index) => (
            <div key={stage.id || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{stage.id || `Stage ${index + 1}`}</span>
                <Tag color={statusColor(stage.status)}>{stage.status || '--'}</Tag>
              </div>
              <div className="text-xs leading-5 text-gray-300">{stage.message || '--'}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
            Staging：{stagingTables.join('；') || '--'}
          </div>
          <div className="rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            Promote：{promoteRules.join('；') || '--'}
          </div>
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3 text-xs leading-5 text-emerald-100">
            压测目标：{targets.join('；') || '--'}
          </div>
        </div>
        {nextActions.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
            下一步：{nextActions.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'security_status_coverage_report.json') {
    const providers = asArray(data?.providerCandidates)
    const gates = asArray(data?.gates)
    const fields = asArray(data?.requiredFields)
    const fallbacks = asArray(data?.currentFallbacks)
    const nextActions = asArray(data?.nextActions)
    const coverage = data?.coverageSnapshot || {}
    return (
      <Card size="small" title="证券状态覆盖" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>{data?.status || '--'}</Tag>
          {renderMetricTag('Provider策略', data?.providerPolicy || '--', '#818cf8')}
          {renderMetricTag('表', asArray(data?.canonicalTables).join(' / ') || '--', '#38bdf8')}
          {renderMetricTag('状态行', coverage.statusRows ?? '--', '#38bdf8')}
          {renderMetricTag('交易性行', coverage.tradeabilityRows ?? '--', '#38bdf8')}
          {renderMetricTag('正式源行', coverage.officialProviderRows ?? '--', (coverage.officialProviderRows || 0) > 0 ? '#34d399' : '#f87171')}
          {renderMetricTag('正式交易状态', coverage.formalTradingStateRows ?? '--', (coverage.formalTradingStateRows || 0) > 0 ? '#34d399' : '#f87171')}
          {renderMetricTag('启发式行', coverage.heuristicRows ?? '--', '#fbbf24')}
        </div>
        {coverage.schemaVersion && (
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
              <div>请求标的：{coverage.requestedSymbols ?? '--'}</div>
              <div>有证券状态：{coverage.symbolsWithStatus ?? '--'}</div>
              <div>有可交易性：{coverage.symbolsWithTradeability ?? '--'}</div>
              <div>最新日期：{coverage.latestTradeDate || '--'}</div>
            </div>
            <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
              <div>上市状态覆盖：{coverage.fieldCoverage?.listingStatusPercent ?? '--'}%</div>
              <div>风险标记覆盖：{coverage.fieldCoverage?.riskFlagPercent ?? '--'}%</div>
              <div>停复牌覆盖：{coverage.fieldCoverage?.suspendedPercent ?? '--'}%</div>
              <div>涨跌停价覆盖：{coverage.fieldCoverage?.limitPricePercent ?? '--'}%</div>
            </div>
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {providers.map((provider, index) => (
            <div key={provider.provider || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{provider.provider || `Provider ${index + 1}`}</span>
                <Tag color={provider.configured ? '#34d399' : '#f87171'}>{provider.configured ? 'configured' : 'not_configured'}</Tag>
                <Tag color={statusColor(provider.confidence)}>{provider.confidence || '--'}</Tag>
                <Tag color="#64748b">{provider.role || '--'}</Tag>
              </div>
              <div className="text-xs leading-5 text-gray-300">{asArray(provider.limitations).join('；') || '--'}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
            必需字段：{fields.join('；') || '--'}
          </div>
          <div className="rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            当前 fallback：{fallbacks.join('；') || '--'}
          </div>
        </div>
        <div className="mt-3 grid gap-3">
          {gates.map((gate, index) => (
            <div key={gate.id || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
              <Tag color={statusColor(gate.status)}>{gate.status || '--'}</Tag>
              <Tag color={gate.severity === 'blocker' ? '#f87171' : '#fbbf24'}>{gate.severity || '--'}</Tag>
              <span className="ml-2">{gate.message || '--'}</span>
            </div>
          ))}
        </div>
        {nextActions.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
            下一步：{nextActions.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'validation_failure_taxonomy.json') {
    const summary = data?.summary || {}
    const classes = asArray(data?.failureClasses)
    const candidates = asArray(data?.candidateFailures)
    const nextActions = asArray(data?.nextActions)
    return (
      <Card size="small" title="验证失败分类" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>{data?.status || '--'}</Tag>
          {renderMetricTag('决策', data?.decision || '--', data?.decision === 'TRADING_RESEARCH_ALLOWED' ? '#34d399' : '#fbbf24')}
          {renderMetricTag('诊断候选', summary.diagnosedCandidates ?? '--', '#38bdf8')}
          {renderMetricTag('失败', summary.failedCandidates ?? '--', '#f87171')}
          {renderMetricTag('通过', summary.passedCandidates ?? '--', '#34d399')}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {classes.map((item, index) => (
            <div key={item.id || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{item.label || item.id || `Class ${index + 1}`}</span>
                <Tag color={item.severity === 'blocker' ? '#f87171' : '#fbbf24'}>{item.severity || '--'}</Tag>
              </div>
              <div className="text-xs leading-5 text-gray-300">证据：{asArray(item.evidence).join('；') || '--'}</div>
              <div className="mt-2 text-xs leading-5 text-amber-100">动作：{item.recommendedAction || '--'}</div>
            </div>
          ))}
        </div>
        {candidates.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-300">
            候选失败：{candidates.slice(0, 8).map((item) => `${item.candidateId || '--'}=${asArray(item.failureTags).join('/') || item.oosStatus || '--'}`).join('；')}
          </div>
        )}
        {nextActions.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-200">
            下一步：{nextActions.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'p4_closure_review.json') {
    const summary = data?.summary || {}
    const gates = asArray(data?.gates)
    const completedEvidence = asArray(data?.completedEvidence)
    const remainingBlockers = asArray(data?.remainingBlockers)
    const nextActions = asArray(data?.nextActions)
    const refs = asArray(data?.artifactRefs)
    return (
      <Card size="small" title="P4 收口评审" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>{data?.status || '--'}</Tag>
          {renderMetricTag('阶段', data?.phase || '--', '#818cf8')}
          {renderMetricTag('决策', data?.decision || '--', data?.decision === 'READY_FOR_MANUAL_REVIEW' ? '#34d399' : '#fbbf24')}
          {renderMetricTag('长样本', summary.acceptanceStatus || '--', statusColor(summary.acceptanceStatus))}
          {renderMetricTag('验证', summary.validationDecision || '--', summary.usableForTradingAdvice ? '#34d399' : '#f87171')}
          {renderMetricTag('生产就绪', summary.productionReady ? '是' : '否', summary.productionReady ? '#34d399' : '#f87171')}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {gates.map((gate, index) => (
            <div key={gate.id || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{gate.label || gate.id || `Gate ${index + 1}`}</span>
                <Tag color={statusColor(gate.status)}>{gate.status || '--'}</Tag>
                <Tag color={gate.severity === 'blocker' ? '#f87171' : '#fbbf24'}>{gate.severity || '--'}</Tag>
                <Tag color="#64748b">{gate.sourceArtifact || '--'}</Tag>
              </div>
              <div className="text-xs leading-5 text-gray-300">{gate.message || '--'}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3">
            <div className="mb-2 text-xs font-medium text-emerald-100">已完成证据</div>
            <div className="text-xs leading-5 text-emerald-100">{completedEvidence.join('；') || '--'}</div>
          </div>
          <div className="rounded-lg border border-red-300/20 bg-red-500/10 p-3">
            <div className="mb-2 text-xs font-medium text-red-100">剩余阻断</div>
            <div className="text-xs leading-5 text-red-100">{remainingBlockers.join('；') || '--'}</div>
          </div>
        </div>
        {nextActions.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            下一步：{nextActions.slice(0, 8).join('；')}
          </div>
        )}
        {refs.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-300">
            关联产物：{refs.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'p5_closure_review.json') {
    const summary = data?.summary || {}
    const gates = asArray(data?.gates)
    const completedEvidence = asArray(data?.completedEvidence)
    const remainingBlockers = asArray(data?.remainingBlockers)
    const nextActions = asArray(data?.nextActions)
    const refs = asArray(data?.artifactRefs)
    return (
      <Card size="small" title="P5 收口评审" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          <Tag color={statusColor(data?.status)}>{data?.status || '--'}</Tag>
          {renderMetricTag('阶段', data?.phase || '--', '#818cf8')}
          {renderMetricTag('决策', data?.decision || '--', data?.decision === 'READY_FOR_P6_REVIEW' ? '#34d399' : '#fbbf24')}
          {renderMetricTag('PG Shadow', summary.postgresShadowStatus || '--', statusColor(summary.postgresShadowStatus))}
          {renderMetricTag('证券状态', summary.securityStatusCoverageStatus || '--', statusColor(summary.securityStatusCoverageStatus))}
          {renderMetricTag('生产就绪', summary.productionReady ? '是' : '否', summary.productionReady ? '#34d399' : '#f87171')}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {gates.map((gate, index) => (
            <div key={gate.id || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white">{gate.label || gate.id || `Gate ${index + 1}`}</span>
                <Tag color={statusColor(gate.status)}>{gate.status || '--'}</Tag>
                <Tag color={gate.severity === 'blocker' ? '#f87171' : '#fbbf24'}>{gate.severity || '--'}</Tag>
                <Tag color="#64748b">{gate.sourceArtifact || '--'}</Tag>
              </div>
              <div className="text-xs leading-5 text-gray-300">{gate.message || '--'}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/10 p-3">
            <div className="mb-2 text-xs font-medium text-emerald-100">已完成证据</div>
            <div className="text-xs leading-5 text-emerald-100">{completedEvidence.join('；') || '--'}</div>
          </div>
          <div className="rounded-lg border border-red-300/20 bg-red-500/10 p-3">
            <div className="mb-2 text-xs font-medium text-red-100">剩余阻断</div>
            <div className="text-xs leading-5 text-red-100">{remainingBlockers.join('；') || '--'}</div>
          </div>
        </div>
        {nextActions.length > 0 && (
          <div className="mt-3 rounded-lg border border-amber-300/20 bg-amber-500/10 p-3 text-xs leading-5 text-amber-100">
            下一步：{nextActions.slice(0, 8).join('；')}
          </div>
        )}
        {refs.length > 0 && (
          <div className="mt-3 rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs leading-5 text-gray-300">
            关联产物：{refs.join('；')}
          </div>
        )}
      </Card>
    )
  }

  if (filename === 'strategy_manifest.json') {
    const candidates = asArray(data?.candidates)
    return (
      <Card size="small" title="策略版本清单" className="bg-[#161629] border-white/10">
        <div className="grid gap-3">
          {candidates.slice(0, 8).map((candidate, index) => (
            <div key={candidate.strategyId || index} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="text-sm font-medium text-white">{candidate.name || candidate.strategyId}</span>
                <Tag color="#818cf8">{String(candidate.auditHash || '').slice(0, 10) || '--'}</Tag>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-gray-300 md:grid-cols-2">
                <div>信号版本：{candidate.versionBundle?.signalStrategy?.version || '--'}</div>
                <div>执行版本：{candidate.versionBundle?.entryPolicy?.version || '--'} / {candidate.versionBundle?.exitPolicy?.version || '--'}</div>
                <div>成本模型：{candidate.versionBundle?.costModel?.version || '--'}</div>
                <div>约束模型：{candidate.versionBundle?.marketConstraint?.version || '--'}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>
    )
  }

  if (filename === 'sample_trades.csv') {
    const lines = typeof data === 'string' ? data.split('\n') : []
    const rows = typeof data === 'string' ? parseSampleTradesCsv(data) : []
    if (lines.length === 0) return null
    const blockedCount = rows.filter((row) => row.blockedReason).length
    const executedCount = rows.length - blockedCount
    const winCount = rows.filter((row) => row.win === 'true').length
    const sampleTradeColumns: ColumnsType<Record<string, string>> = [
      {
        title: '策略',
        key: 'strategy',
        width: 190,
        render: (_, row) => (
          <div className="text-xs leading-5 text-gray-300">
            <div className="text-gray-100 break-all">{row.strategyId || '--'}</div>
            <div className="text-gray-400 break-all">{row.executionPolicy || row.candidateId || '--'}</div>
            {row.entryReason && <div className="text-gray-500">{row.entryReason}</div>}
            {row.positionSizingReason && <div className="text-gray-500">{row.positionSizingReason}</div>}
          </div>
        ),
      },
      {
        title: '标的',
        key: 'symbol',
        width: 150,
        render: (_, row) => (
          <div>
            <div className="text-xs text-white">{row.symbol || '--'}</div>
            <div className="text-[11px] text-gray-400 break-all">{row.name || '--'}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {row.marketSegment && <Tag color="#64748b">{row.marketSegment}</Tag>}
              {row.industryGroup && <Tag color="#818cf8">{row.industryGroup}</Tag>}
              {row.marketRegime && <Tag color="#fbbf24">{row.marketRegime}</Tag>}
              {row.groupConfidence && <Tag color="#22c55e">分组置信 {formatPlainNumber(row.groupConfidence, 2)}</Tag>}
            </div>
          </div>
        ),
      },
      {
        title: '信号/入场/退出',
        key: 'dates',
        width: 210,
        render: (_, row) => (
          <div className="text-xs leading-5 text-gray-300">
            <div>信号 {row.signalDate || '--'}</div>
            <div>入场 {row.entryDate || '--'}</div>
            <div>退出 {row.exitDate || '--'}</div>
          </div>
        ),
      },
      {
        title: '价格',
        key: 'prices',
        width: 130,
        render: (_, row) => (
          <div className="text-xs leading-5 text-gray-300">
            <div>入 {row.entryPrice || '--'}</div>
            <div>出 {row.exitPrice || '--'}</div>
            {row.notional && <div className="text-gray-400">本金 {row.notional}</div>}
          </div>
        ),
      },
      {
        title: '收益',
        key: 'return',
        width: 150,
        render: (_, row) => (
          <div className="text-xs leading-5">
            <div className={Number(row.returnPercent || 0) >= 0 ? 'text-emerald-300' : 'text-red-300'}>
              净 {formatArtifactPercent(row.returnPercent)}
            </div>
            <div className="text-gray-400">毛 {formatArtifactPercent(row.grossReturnPercent)}</div>
            <div className="text-gray-400">成本 {formatArtifactPercent(row.costPercent)}</div>
          </div>
        ),
      },
      {
        title: '状态',
        key: 'status',
        width: 170,
        render: (_, row) => (
          <div className="text-xs leading-5">
            {row.blockedReason ? (
              <Tag color="#f87171">{row.blockedReason}</Tag>
            ) : (
              <Tag color={row.win === 'true' ? '#34d399' : '#fbbf24'}>{row.win === 'true' ? '盈利样本' : '亏损样本'}</Tag>
            )}
            {row.exitReason && <div className="mt-1 text-gray-400">{row.exitReason}</div>}
          </div>
        ),
      },
    ]
    return (
      <Card size="small" title="样本交易预览" className="bg-[#161629] border-white/10">
        <div className="mb-3 flex flex-wrap gap-2">
          {renderMetricTag('记录数', rows.length, '#38bdf8')}
          {renderMetricTag('可执行', executedCount, '#34d399')}
          {renderMetricTag('阻断', blockedCount, blockedCount > 0 ? '#f87171' : '#64748b')}
          {renderMetricTag('盈利样本', winCount, '#818cf8')}
        </div>
        <Table
          size="small"
          rowKey="key"
          columns={sampleTradeColumns}
          dataSource={rows.slice(0, 20)}
          pagination={false}
          scroll={{ x: 960 }}
          className="sample-trades-artifact-table"
        />
        <pre className="mt-3 max-h-60 overflow-auto rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-xs text-gray-200 whitespace-pre-wrap break-all mb-0">
          {lines.slice(0, 9).join('\n')}
        </pre>
      </Card>
    )
  }

  return null
}

const getArtifactReadableDetail = (artifact: OperationArtifactDetail | null) => {
  const data = typeof artifact?.data === 'object' && artifact?.data !== null ? artifact.data : {}
  const structuredAdvice = data.structuredAdvice || data.structured_advice || {}
  const suggestions = asArray(data.suggestions || data.actions || structuredAdvice.suggestions)
  const risks = asArray(data.risks || structuredAdvice.risks || data.warningSignals || data.warnings)
  const nextActions = asArray(data.nextActions || data.next_actions || data.recommendedActions || data.recommended_actions)
  const positions = asArray(data.positions || data.positionSnapshots || data.position_snapshots)
  const market = asArray(data.market || data.marketSnapshots || data.market_snapshots || data.quotes)
  const providerSummary = asArray(data.providerSummary || data.provider_summary || data.summary?.providerSummary)
  const failures = asArray(data.failures || data.results).filter((item) => item && item.success === false)
  const summary = data.summaryText
    || data.summary
    || data.marketOutlook
    || structuredAdvice.summary
    || data.result?.summary
    || data.result?.structuredAdvice?.summary
    || null

  const metrics: Array<{ label: string; value: string; color?: string }> = [
    artifact?.type ? { label: '产物类型', value: artifact.type, color: '#38bdf8' } : null,
    data.status ? { label: '状态', value: String(data.status), color: '#818cf8' } : null,
    data.riskLevel || structuredAdvice.risk_level ? {
      label: '风险等级',
      value: String(data.riskLevel || structuredAdvice.risk_level),
      color: String(data.riskLevel || structuredAdvice.risk_level) === 'high' ? '#f87171' : '#fbbf24',
    } : null,
    suggestions.length > 0 ? { label: '建议/动作', value: String(suggestions.length), color: '#34d399' } : null,
    positions.length > 0 ? { label: '持仓快照', value: String(positions.length), color: '#38bdf8' } : null,
    market.length > 0 ? { label: '行情快照', value: String(market.length), color: '#fbbf24' } : null,
    providerSummary.length > 0 ? { label: '数据源', value: String(providerSummary.length), color: '#a78bfa' } : null,
    failures.length > 0 ? { label: '失败项', value: String(failures.length), color: '#f87171' } : null,
  ].filter(Boolean) as Array<{ label: string; value: string; color?: string }>

  const readableSuggestions = suggestions.slice(0, 6).map((item, index) => ({
    key: String(item.id || item.actionId || item.title || index),
    title: String(item.title || item.actionType || item.action || item.assetSymbol || item.symbol || `建议 ${index + 1}`),
    description: String(item.description || item.reason || item.rationale || item.summary || compactJson(item.parameters || item)),
    tag: item.priority || item.status || item.targetSymbol || item.assetSymbol || item.symbol,
  }))

  const readableActions = nextActions.length > 0
    ? nextActions.slice(0, 6).map((item, index) => String(item.label || item.action || item.type || compactJson(item) || `动作 ${index + 1}`))
    : suggestions.slice(0, 4).map((item, index) => String(item.title || item.actionType || item.action || item.description || `复核建议 ${index + 1}`))

  return {
    summary: summary ? String(summary) : null,
    metrics,
    suggestions: readableSuggestions,
    risks: risks.slice(0, 8).map((item) => String(item.message || item.title || item.reason || item)),
    actions: readableActions,
    failures,
  }
}

const Operations: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const initialArtifactRef = getArtifactRefFromSearch(location.search)
  const deepLinkedOperationId = useMemo(() => new URLSearchParams(location.search).get('operationId'), [location.search])
  const [loading, setLoading] = useState(false)
  const [operations, setOperations] = useState<OperationRecord[]>([])
  const [selectedOperation, setSelectedOperation] = useState<OperationRecord | null>(null)
  const [detailVisible, setDetailVisible] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [adviceDetailLoading, setAdviceDetailLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState<'all' | OperationStatus>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | OperationType>('all')
  const [queryText, setQueryText] = useState('')
  const [queryScope, setQueryScope] = useState<AdviceScope>('all')
  const [startingRefresh, setStartingRefresh] = useState(false)
  const [startingAlertCheck, setStartingAlertCheck] = useState(false)
  const [startingAdvice, setStartingAdvice] = useState(false)
  const [startingBacktest, setStartingBacktest] = useState(false)
  const [startingScreenerScan, setStartingScreenerScan] = useState(false)
  const [startingLongSampleDryRun, setStartingLongSampleDryRun] = useState(false)
  const [startingFactsetRefresh, setStartingFactsetRefresh] = useState(false)
  const [startingDueFactsetRefresh, setStartingDueFactsetRefresh] = useState(false)
  const [startingMarketCapWarmup, setStartingMarketCapWarmup] = useState(false)
  const [startingMarketBarPreheat, setStartingMarketBarPreheat] = useState(false)
  const [startingBacktestParentId, setStartingBacktestParentId] = useState<string | null>(null)
  const [retryingOperationId, setRetryingOperationId] = useState<string | null>(null)
  const [cancellingOperationId, setCancellingOperationId] = useState<string | null>(null)
  const [runningNextActionKey, setRunningNextActionKey] = useState<string | null>(null)
  const [selectedAdviceDetail, setSelectedAdviceDetail] = useState<AdviceDetailResult | null>(null)
  const [backtestDetailLoading, setBacktestDetailLoading] = useState(false)
  const [selectedBacktestDetail, setSelectedBacktestDetail] = useState<BacktestDetailResult | null>(null)
  const [relatedBacktestOperation, setRelatedBacktestOperation] = useState<OperationRecord | null>(null)
  const [timelineOperations, setTimelineOperations] = useState<OperationRecord[]>([])
  const [detailFocusTarget, setDetailFocusTarget] = useState<string | null>(null)
  const [artifactDetail, setArtifactDetail] = useState<OperationArtifactDetail | null>(null)
  const [factsetSchedulerStatus, setFactsetSchedulerStatus] = useState<FactsetSchedulerStatus | null>(null)
  const [schedulerLoading, setSchedulerLoading] = useState(false)
  const [pendingArtifactRef, setPendingArtifactRef] = useState<string | null>(initialArtifactRef)
  const [artifactDetailVisible, setArtifactDetailVisible] = useState(Boolean(initialArtifactRef))
  const [artifactDetailLoading, setArtifactDetailLoading] = useState(Boolean(initialArtifactRef))

  const fetchOperations = useCallback(async () => {
    setLoading(true)
    try {
      const response = await axios.get('/api/v1/operations', {
        params: {
          userId: USER_ID,
          limit: 50,
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          ...(typeFilter !== 'all' ? { type: typeFilter } : {}),
        },
      })
      setOperations(response.data || [])
    } catch (error) {
      console.error('Failed to fetch operations:', error)
      message.error('获取任务历史失败')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, typeFilter])

  const fetchFactsetSchedulerStatus = useCallback(async () => {
    setSchedulerLoading(true)
    try {
      const response = await axios.get('/api/v1/operations/schedulers/factset-refresh')
      setFactsetSchedulerStatus(response.data)
    } catch (error) {
      console.error('Failed to fetch factset scheduler status:', error)
      setFactsetSchedulerStatus(null)
    } finally {
      setSchedulerLoading(false)
    }
  }, [])

  const fetchOperationDetail = useCallback(async (id: string, options?: { openImmediately?: boolean }) => {
    setDetailLoading(true)
    if (options?.openImmediately) {
      setSelectedOperation(null)
    }
    if (options?.openImmediately) {
      setDetailVisible(true)
    }
    try {
      const response = await axios.get(`/api/v1/operations/${id}`)
      setSelectedOperation(response.data)
      setDetailVisible(true)
    } catch (error) {
      console.error('Failed to fetch operation detail:', error)
      message.error('获取任务详情失败')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  const fetchAdviceDetail = useCallback(async (adviceId?: string) => {
    if (!adviceId) {
      setSelectedAdviceDetail(null)
      return
    }

    setAdviceDetailLoading(true)
    try {
      const response = await axios.get(`/api/v1/analysis/advice/${adviceId}`, {
        params: { userId: USER_ID },
      })
      setSelectedAdviceDetail(response.data)
    } catch (error) {
      console.error('Failed to fetch advice detail:', error)
      setSelectedAdviceDetail(null)
    } finally {
      setAdviceDetailLoading(false)
    }
  }, [])

  const fetchBacktestDetail = useCallback(async (backtestId?: string) => {
    if (!backtestId) {
      setSelectedBacktestDetail(null)
      return
    }

    setBacktestDetailLoading(true)
    try {
      const response = await axios.get(`/api/v1/backtest/results/${backtestId}`)
      setSelectedBacktestDetail(response.data)
    } catch (error) {
      console.error('Failed to fetch backtest detail:', error)
      setSelectedBacktestDetail(null)
    } finally {
      setBacktestDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchOperations()
    void fetchFactsetSchedulerStatus()
  }, [fetchOperations, fetchFactsetSchedulerStatus])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const operationId = params.get('operationId')
    const focus = params.get('focus')
    if (focus) {
      setDetailFocusTarget(focus)
    }
    if (operationId) {
      void fetchOperationDetail(operationId, { openImmediately: true })
    }
  }, [location.search, fetchOperationDetail])

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const operationId = params.get('operationId')
    if (!operationId || detailVisible || operations.length === 0) return

    const operation = operations.find((item) => item.id === operationId)
    if (operation) {
      setSelectedOperation(operation)
      setDetailVisible(true)
      void fetchOperationDetail(operationId, { openImmediately: true })
    }
  }, [detailVisible, fetchOperationDetail, location.search, operations])

  useEffect(() => {
    if (!detailVisible || !detailFocusTarget) return

    const timer = window.setTimeout(() => {
      const target = document.getElementById(detailFocusTarget)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 120)

    return () => {
      window.clearTimeout(timer)
    }
  }, [detailVisible, detailFocusTarget, selectedAdviceDetail, selectedBacktestDetail])

  useEffect(() => {
    const adviceId = selectedOperation?.type === 'generate_daily_advice'
      ? ((selectedOperation.result?.adviceId || null) as string | null)
      : null
    void fetchAdviceDetail(adviceId || undefined)
  }, [selectedOperation, fetchAdviceDetail])

  useEffect(() => {
    const backtestId = selectedOperation?.type === 'run_backtest'
      ? ((selectedOperation.result?.backtestId || null) as string | null)
      : null
    void fetchBacktestDetail(backtestId || undefined)
  }, [selectedOperation, fetchBacktestDetail])

  useEffect(() => {
    const adviceId = selectedOperation?.type === 'generate_daily_advice'
      ? ((selectedOperation.result?.adviceId || null) as string | null)
      : null

    if (!adviceId) {
      setRelatedBacktestOperation(null)
      return
    }

    let cancelled = false
    const fetchRelatedBacktestOperation = async () => {
      try {
        const response = await axios.get('/api/v1/operations', {
          params: {
            userId: USER_ID,
            type: 'run_backtest',
            limit: 20,
          },
        })
        if (cancelled) return
        const operationsList = Array.isArray(response.data) ? response.data as OperationRecord[] : []
        const related = operationsList.find((item) => item.parentOperationId === selectedOperation?.id)
          || operationsList.find((item) => item.input?.adviceId === adviceId)
          || null
        setRelatedBacktestOperation(related)
      } catch (error) {
        if (cancelled) return
        console.error('Failed to fetch related backtest operation:', error)
        setRelatedBacktestOperation(null)
      }
    }

    void fetchRelatedBacktestOperation()
    return () => {
      cancelled = true
    }
  }, [selectedOperation])

  useEffect(() => {
    if (!selectedOperation) {
      setTimelineOperations([])
      return
    }

    let cancelled = false
    const fetchTimelineOperations = async () => {
      try {
        const response = await axios.get('/api/v1/operations', {
          params: {
            userId: USER_ID,
            limit: 50,
          },
        })
        if (cancelled) return
        const operationsList = Array.isArray(response.data) ? response.data as OperationRecord[] : []
        const byId = new Map(operationsList.map((item) => [item.id, item]))
        const parent = selectedOperation.parentOperationId ? byId.get(selectedOperation.parentOperationId) || null : null
        const children = operationsList
          .filter((item) => item.parentOperationId === selectedOperation.id)
          .sort((left, right) => new Date(left.requestedAt).getTime() - new Date(right.requestedAt).getTime())

        const chain = [
          ...(parent ? [parent] : []),
          selectedOperation,
          ...children,
        ]
        setTimelineOperations(chain)
      } catch (error) {
        if (cancelled) return
        console.error('Failed to fetch timeline operations:', error)
        setTimelineOperations(selectedOperation ? [selectedOperation] : [])
      }
    }

    void fetchTimelineOperations()
    return () => {
      cancelled = true
    }
  }, [selectedOperation])

  useEffect(() => {
    const hasActive = operations.some((item) => isActiveStatus(item.status))
    if (!hasActive) return undefined

    const timer = window.setInterval(() => {
      fetchOperations()
      if (selectedOperation && isActiveStatus(selectedOperation.status)) {
        void fetchOperationDetail(selectedOperation.id)
      }
    }, 4000)

    return () => window.clearInterval(timer)
  }, [operations, selectedOperation, fetchOperations, fetchOperationDetail])

  const filteredOperations = useMemo(() => {
    const keyword = queryText.trim().toLowerCase()
    const base = !keyword ? operations : operations.filter((item) =>
      item.id.toLowerCase().includes(keyword) ||
      item.type.toLowerCase().includes(keyword) ||
      (TYPE_META[item.type]?.label || '').includes(keyword)
    )
    return [...base].sort((left, right) => {
      const statusDelta = STATUS_PRIORITY[left.status] - STATUS_PRIORITY[right.status]
      if (statusDelta !== 0) return statusDelta
      return new Date(right.requestedAt).getTime() - new Date(left.requestedAt).getTime()
    })
  }, [operations, queryText])

  const stats = useMemo(() => ({
    total: filteredOperations.length,
    queued: filteredOperations.filter((item) => item.status === 'queued').length,
    running: filteredOperations.filter((item) => item.status === 'running' || item.status === 'cancelling').length,
    completed: filteredOperations.filter((item) => isSuccessfulStatus(item.status)).length,
    failed: filteredOperations.filter((item) => item.status === 'failed').length,
  }), [filteredOperations])
  const attentionMessage = useMemo(() => {
    if (stats.failed > 0) {
      return {
        mode: 'failed' as const,
        color: '#f87171',
        bg: 'rgba(248,113,113,0.10)',
        border: 'rgba(248,113,113,0.25)',
        text: `当前有 ${stats.failed} 个失败任务，任务历史已自动置顶显示。`,
        actionLabel: '只看失败任务',
      }
    }
    if (stats.running > 0 || stats.queued > 0) {
      const activeCount = stats.running + stats.queued
      return {
        mode: 'active' as const,
        color: '#818cf8',
        bg: 'rgba(129,140,248,0.10)',
        border: 'rgba(129,140,248,0.25)',
        text: `当前有 ${activeCount} 个进行中任务，页面会自动轮询更新状态。`,
        actionLabel: '只看进行中',
      }
    }
    return {
      mode: 'idle' as const,
      color: '#34d399',
      bg: 'rgba(52,211,153,0.10)',
      border: 'rgba(52,211,153,0.22)',
      text: `当前没有失败或进行中任务，最近完成 ${stats.completed} 个任务。`,
      actionLabel: null,
    }
  }, [stats.completed, stats.failed, stats.queued, stats.running])

  const latestHighlights = useMemo(() => ({
    refresh: filteredOperations.find((item) => item.type === 'refresh_prices') || null,
    alerts: filteredOperations.find((item) => item.type === 'check_alerts') || null,
    advice: filteredOperations.find((item) => item.type === 'generate_daily_advice' && Array.isArray(item.result?.suggestions) && item.result.suggestions.length > 0)
      || filteredOperations.find((item) => item.type === 'generate_daily_advice' && item.result?.adviceId)
      || filteredOperations.find((item) => item.type === 'generate_daily_advice')
      || null,
    backtest: filteredOperations.find((item) => item.type === 'run_backtest') || null,
  }), [filteredOperations])

  const startRefreshPrices = async () => {
    setStartingRefresh(true)
    try {
      const response = await axios.post('/api/v1/operations/refresh-prices', { userId: USER_ID })
      const operationId = getOperationId(response.data)
      message.success(`价格刷新任务已提交：${operationId}`)
      await fetchOperations()
      if (operationId) {
        await fetchOperationDetail(operationId)
      }
    } catch (error) {
      console.error('Failed to start refresh operation:', error)
      message.error('启动价格刷新任务失败')
    } finally {
      setStartingRefresh(false)
    }
  }

  const startCheckAlerts = async () => {
    setStartingAlertCheck(true)
    try {
      const response = await axios.post('/api/v1/operations/check-alerts', { userId: USER_ID })
      const operationId = getOperationId(response.data)
      message.success(`告警检查任务已提交：${operationId}`)
      await fetchOperations()
      if (operationId) {
        await fetchOperationDetail(operationId)
      }
    } catch (error) {
      console.error('Failed to start alert check operation:', error)
      message.error('启动告警检查任务失败')
    } finally {
      setStartingAlertCheck(false)
    }
  }

  const startDailyAdvice = async () => {
    setStartingAdvice(true)
    try {
      const response = await axios.post('/api/v1/operations/generate-daily-advice', {
        userId: USER_ID,
        query: queryText.trim() || undefined,
        scope: queryScope,
      })
      const operationId = getOperationId(response.data)
      message.success(`每日建议任务已提交：${operationId}`)
      await fetchOperations()
      if (operationId) {
        await fetchOperationDetail(operationId)
      }
    } catch (error) {
      console.error('Failed to start advice operation:', error)
      message.error('启动每日建议任务失败')
    } finally {
      setStartingAdvice(false)
    }
  }

  const startRunBacktest = async (adviceId?: string, parentOperationId?: string) => {
    if (!adviceId) {
      message.warning('缺少 adviceId，无法发起回测')
      return
    }

    setStartingBacktest(true)
    setStartingBacktestParentId(parentOperationId || null)
    try {
      const response = await axios.post('/api/v1/operations/run-backtest', {
        userId: USER_ID,
        adviceId,
        parentOperationId: parentOperationId || null,
      })
      const operationId = getOperationId(response.data)
      message.success(`回测任务已提交：${operationId}`)
      await fetchOperations()
      if (operationId) {
        await fetchOperationDetail(operationId)
      }
    } catch (error) {
      console.error('Failed to start run backtest operation:', error)
      message.error('启动回测任务失败')
    } finally {
      setStartingBacktest(false)
      setStartingBacktestParentId(null)
    }
  }

  const startStockScreenerFullScan = async (mode: 'default' | 'long_sample_dry_run' = 'default') => {
    const setLoading = mode === 'long_sample_dry_run' ? setStartingLongSampleDryRun : setStartingScreenerScan
    setLoading(true)
    try {
      const payload = mode === 'long_sample_dry_run'
        ? { userId: USER_ID, mode }
        : {
          userId: USER_ID,
          query: queryText.trim() || '多策略胜率；全A样本；验证天数=5；持有天数=3',
          mode,
        }
      const response = await axios.post('/api/v1/operations/stock-screener-full-scan', payload)
      const operationId = getOperationId(response.data)
      message.success(`${mode === 'long_sample_dry_run' ? '长样本验收 dry-run' : '全A选股扫描'}已提交：${operationId}`)
      await fetchOperations()
      if (operationId) {
        await fetchOperationDetail(operationId)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '启动全A选股扫描失败'
      message.error(errorMessage)
    } finally {
      setLoading(false)
    }
  }

  const startFactsetRefresh = async () => {
    setStartingFactsetRefresh(true)
    try {
      const response = await axios.post('/api/v1/operations/refresh-factsets', {
        userId: USER_ID,
        scope: 'all',
      })
      const operationId = getOperationId(response.data)
      message.success(`事实集刷新任务已提交：${operationId}`)
      await fetchOperations()
      if (operationId) {
        await fetchOperationDetail(operationId)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '启动事实集刷新任务失败'
      message.error(errorMessage)
    } finally {
      setStartingFactsetRefresh(false)
    }
  }

  const startDueFactsetRefresh = async () => {
    setStartingDueFactsetRefresh(true)
    try {
      const response = await axios.post('/api/v1/operations/refresh-due-factsets', {
        userId: USER_ID,
        scope: 'all',
        horizonMinutes: 60,
        limit: 20,
      })
      const operationId = getOperationId(response.data?.operation)
      if (response.data?.submitted && operationId) {
        message.success(`到期事实集刷新任务已提交：${operationId}`)
        await fetchOperations()
        await fetchOperationDetail(operationId)
      } else if (operationId) {
        message.info(`已有刷新任务运行中：${operationId}`)
        await fetchOperations()
        await fetchOperationDetail(operationId)
      } else {
        message.info('当前没有到期事实集需要刷新')
        await fetchOperations()
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '启动到期事实集刷新任务失败'
      message.error(errorMessage)
    } finally {
      setStartingDueFactsetRefresh(false)
    }
  }

  const startMarketCapWarmup = async () => {
    setStartingMarketCapWarmup(true)
    try {
      const response = await axios.post('/api/v1/operations/quote-list-market-cap-warmup', {
        userId: USER_ID,
        limit: 40,
        chunkSize: 10,
        executionMode: 'queued',
      })
      const operationId = getOperationId(response.data)
      message.success(`市值补齐任务已提交：${operationId}`)
      await fetchOperations()
      if (operationId) {
        await fetchOperationDetail(operationId)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '启动市值补齐任务失败'
      message.error(errorMessage)
    } finally {
      setStartingMarketCapWarmup(false)
    }
  }

  const startMarketBarPreheat = async () => {
    setStartingMarketBarPreheat(true)
    try {
      const response = await axios.post('/api/v1/operations/market-bar-cache-preheat', {
        userId: USER_ID,
        limit: 500,
        days: 120,
        chunkSize: 100,
        concurrency: 4,
        executionMode: 'queued',
      })
      const operationId = getOperationId(response.data)
      message.success(`K线预热任务已提交：${operationId}`)
      await fetchOperations()
      if (operationId) {
        await fetchOperationDetail(operationId)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '启动K线预热任务失败'
      message.error(errorMessage)
    } finally {
      setStartingMarketBarPreheat(false)
    }
  }

  const retryOperation = async (operationId: string) => {
    setRetryingOperationId(operationId)
    try {
      const response = await axios.post(`/api/v1/operations/${operationId}/retry`)
      const retryOperationId = getOperationId(response.data)
      message.success(`重试任务已提交：${retryOperationId}`)
      await fetchOperations()
      if (retryOperationId) {
        await fetchOperationDetail(retryOperationId)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '重试任务失败'
      message.error(errorMessage)
    } finally {
      setRetryingOperationId(null)
    }
  }

  const cancelOperation = async (operationId: string) => {
    setCancellingOperationId(operationId)
    try {
      const response = await axios.post(`/api/v1/operations/${operationId}/cancel`)
      message.success(`任务已取消：${getOperationId(response.data) || operationId}`)
      await fetchOperations()
      await fetchOperationDetail(operationId)
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '取消任务失败'
      message.error(errorMessage)
    } finally {
      setCancellingOperationId(null)
    }
  }

  const runNextAction = async (action: OperationNextAction, index: number) => {
    if (action.href) {
      navigate(action.href)
      return
    }

    if (!action.endpoint || !action.method) {
      message.warning('这个下一步动作缺少可执行入口')
      return
    }

    const actionKey = `${action.type}-${index}`
    setRunningNextActionKey(actionKey)
    try {
      const response = action.method === 'POST'
        ? await axios.post(action.endpoint, action.body || {})
        : await axios.get(action.endpoint, { params: action.body || {} })

      const operationId = getOperationId(response.data)
      message.success(`${action.label} 已提交`)
      await fetchOperations()
      if (operationId) {
        await fetchOperationDetail(operationId)
      }
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : `${action.label} 执行失败`
      message.error(errorMessage)
    } finally {
      setRunningNextActionKey(null)
    }
  }

  const openArtifactDetail = useCallback(async (ref: string) => {
    setPendingArtifactRef(ref)
    setArtifactDetailVisible(true)
    setArtifactDetailLoading(true)
    setArtifactDetail(null)
    try {
      const response = await axios.get(`/api/v1/operations/artifacts/${encodeURIComponent(ref)}`)
      setArtifactDetail(response.data)
    } catch (error) {
      const errorMessage = axios.isAxiosError(error)
        ? error.response?.data?.message || error.response?.data?.error || error.message
        : '加载任务产物失败'
      message.error(errorMessage)
    } finally {
      setArtifactDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    const artifactRef = getArtifactRefFromSearch(location.search)
    setPendingArtifactRef(artifactRef)
    if (artifactRef) {
      const timer = window.setTimeout(() => {
        void openArtifactDetail(artifactRef)
      }, 150)
      return () => window.clearTimeout(timer)
    }
    return undefined
  }, [location.search, openArtifactDetail])

  const openAdviceSnapshotDetail = async (operationId: string) => {
    setDetailFocusTarget('operation-advice-snapshot-card')
    await fetchOperationDetail(operationId)
  }

  const openRefreshDiagnostics = async (operationId: string, focus: 'provider' | 'failures') => {
    setDetailFocusTarget(focus === 'provider' ? 'operation-provider-health-card' : 'operation-refresh-failures-card')
    await fetchOperationDetail(operationId)
  }

  const columns: ColumnsType<OperationRecord> = [
    {
      title: '任务类型',
      dataIndex: 'type',
      key: 'type',
      render: (value: OperationType) => (
        <Tag color={TYPE_META[value]?.color}>
          {TYPE_META[value]?.label || value}
        </Tag>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: OperationStatus) => <Badge status={STATUS_META[value].color as any} text={STATUS_META[value].label} />,
    },
    {
      title: '进度',
      dataIndex: 'progressPct',
      key: 'progressPct',
      render: (value: number | undefined, record) => (
        <div className="min-w-[140px]">
          <Progress
            percent={typeof value === 'number' ? value : isSuccessfulStatus(record.status) ? 100 : 0}
            size="small"
            status={progressStatus(record.status)}
            showInfo
          />
        </div>
      ),
    },
    {
      title: '请求时间',
      dataIndex: 'requestedAt',
      key: 'requestedAt',
      render: (value: string) => <span className="text-gray-200">{formatDateTime(value)}</span>,
    },
    {
      title: '耗时',
      key: 'duration',
      render: (_, record) => <span className="text-gray-300">{formatDuration(record.startedAt, record.completedAt)}</span>,
    },
    {
      title: '结果摘要',
      key: 'summary',
      render: (_, record) => renderOperationSummary(record),
    },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Space size="small">
          <Button size="small" onClick={() => fetchOperationDetail(record.id)}>
            查看详情
          </Button>
          {(record.status === 'failed' || record.status === 'cancelled' || record.status === 'partial') && (
            <Button size="small" type="link" loading={retryingOperationId === record.id} onClick={() => retryOperation(record.id)}>
              重试
            </Button>
          )}
          {isActiveStatus(record.status) && (
            <Button size="small" danger loading={cancellingOperationId === record.id} onClick={() => cancelOperation(record.id)}>
              取消
            </Button>
          )}
        </Space>
      ),
    },
  ]

  const selectedFailures = (((selectedOperation?.result?.results || []) as RefreshFailureItem[]).filter((item) => !item.success))
  const selectedProviderSummary = ((selectedOperation?.result?.summary?.providerSummary || []) as ProviderHealthItem[])
  const selectedWarnings = Array.isArray(selectedOperation?.result?.summary?.warnings)
    ? selectedOperation?.result?.summary?.warnings as string[]
    : []
  const selectedReliability = (selectedOperation?.result?.dataReliability || null) as DataReliabilitySummary | null
  const advicePreview = (selectedOperation?.type === 'generate_daily_advice'
    ? (selectedOperation?.result || {}) as AdvicePreviewResult
    : null)
  const previewSuggestions = Array.isArray(advicePreview?.suggestions) ? advicePreview.suggestions.slice(0, 6) : []
  const selectedArtifactRefs = Array.isArray(selectedOperation?.artifactRefs) ? selectedOperation.artifactRefs : []
  const selectedNextActions = Array.isArray(selectedOperation?.nextActions) ? selectedOperation.nextActions : []
  const relatedArtifactRefs = useMemo(() => getRelatedScreenerArtifactRefs(artifactDetail), [artifactDetail])
  const selectedTasks = Array.isArray(selectedOperation?.tasks) ? selectedOperation.tasks : []
  const operationTaskColumns: ColumnsType<OperationTaskRecord> = [
    {
      title: '分片',
      key: 'name',
      render: (_, task) => (
        <div className="min-w-[180px]">
          <div className="text-sm text-white">{task.name}</div>
          {typeof task.chunkIndex === 'number' && <div className="text-xs text-gray-400">chunk #{task.chunkIndex}</div>}
        </div>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      render: (value: OperationStatus) => <Tag color={STATUS_META[value]?.color as any}>{STATUS_META[value]?.label || value}</Tag>,
    },
    {
      title: '结果',
      key: 'counts',
      render: (_, task) => (
        <Space size="small" wrap>
          <Tag color="#34d399">成功 {task.successCount || 0}</Tag>
          <Tag color={(task.failureCount || 0) > 0 ? '#f87171' : '#64748b'}>失败 {task.failureCount || 0}</Tag>
        </Space>
      ),
    },
    {
      title: 'Provider / 缓存',
      key: 'provider',
      render: (_, task) => (
        <Space size="small" wrap>
          {task.provider && <Tag color="#38bdf8">{task.provider}</Tag>}
          {typeof task.cacheHitRate === 'number' && <Tag color="#a78bfa">缓存 {task.cacheHitRate.toFixed(1)}%</Tag>}
        </Space>
      ),
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      key: 'durationMs',
      render: (value?: number | null) => value ? `${(value / 1000).toFixed(1)}s` : '--',
    },
    {
      title: '告警 / 失败原因',
      key: 'warnings',
      render: (_, task) => {
        const warnings = Array.isArray(task.warnings) ? task.warnings : []
        const errorMessage = task.error?.message
        if (!warnings.length && !errorMessage) return <span className="text-gray-500">--</span>
        return (
          <div className="max-w-[320px] text-xs text-amber-200">
            {errorMessage || warnings.slice(0, 2).join('；')}
            {warnings.length > 2 && `；+${warnings.length - 2}`}
          </div>
        )
      },
    },
  ]
  const artifactReadableDetail = useMemo(() => getArtifactReadableDetail(artifactDetail), [artifactDetail])
  const screenerArtifactPreview = useMemo(() => renderScreenerArtifactPreview(artifactDetail), [artifactDetail])
  const maintenanceMenuItems: MenuProps['items'] = [
    {
      key: 'full-a',
      icon: <SearchOutlined />,
      label: '全A选股扫描',
      onClick: () => startStockScreenerFullScan(),
      disabled: startingScreenerScan,
    },
    {
      key: 'long-sample',
      icon: <SearchOutlined />,
      label: '长样本验收',
      onClick: () => startStockScreenerFullScan('long_sample_dry_run'),
      disabled: startingLongSampleDryRun,
    },
    {
      key: 'factset',
      icon: <DatabaseOutlined />,
      label: '刷新事实集',
      onClick: startFactsetRefresh,
      disabled: startingFactsetRefresh,
    },
    {
      key: 'due-factset',
      icon: <HistoryOutlined />,
      label: '刷新到期事实集',
      onClick: startDueFactsetRefresh,
      disabled: startingDueFactsetRefresh,
    },
    {
      key: 'market-cap',
      icon: <DatabaseOutlined />,
      label: '补齐市值',
      onClick: startMarketCapWarmup,
      disabled: startingMarketCapWarmup,
    },
    {
      key: 'market-bar',
      icon: <DatabaseOutlined />,
      label: '预热K线',
      onClick: startMarketBarPreheat,
      disabled: startingMarketBarPreheat,
    },
  ]

  return (
    <div className="operations-page min-w-0 space-y-6" data-fams-artifact-ref={pendingArtifactRef || ''}>
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white mb-2">任务中心</h1>
          <p className="text-gray-300 mb-0">统一查看价格刷新、每日建议等异步任务状态、失败原因和数据源健康度。</p>
        </div>
        <Space wrap className="operations-action-bar max-w-full">
          <Button icon={<ReloadOutlined />} onClick={fetchOperations} loading={loading}>
            刷新列表
          </Button>
          <Button icon={<SyncOutlined />} onClick={startRefreshPrices} loading={startingRefresh}>
            刷新价格
          </Button>
          <Button icon={<BellOutlined />} onClick={startCheckAlerts} loading={startingAlertCheck}>
            检查告警
          </Button>
          <Button type="primary" icon={<ThunderboltOutlined />} onClick={startDailyAdvice} loading={startingAdvice}>
            生成每日建议
          </Button>
          <Dropdown menu={{ items: maintenanceMenuItems }} trigger={['click']}>
            <Button icon={<MoreOutlined />}>更多维护任务</Button>
          </Dropdown>
        </Space>
      </div>

      <div
        className="rounded-lg border px-4 py-3 text-sm flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center"
        style={{
          color: attentionMessage.color,
          background: attentionMessage.bg,
          borderColor: attentionMessage.border,
        }}
      >
        <span>{attentionMessage.text}</span>
        {attentionMessage.actionLabel && (
          <Button
            size="small"
            type="text"
            onClick={() => {
              if (attentionMessage.mode === 'failed') {
                setStatusFilter('failed')
                return
              }
              if (attentionMessage.mode === 'active') {
                setStatusFilter('running')
              }
            }}
            style={{ color: attentionMessage.color, paddingInline: 0 }}
          >
            {attentionMessage.actionLabel}
          </Button>
        )}
      </div>

      <Card
        size="small"
        loading={schedulerLoading}
        title={<span className="text-white"><DatabaseOutlined /> 事实集后台调度</span>}
        className="bg-[#1a1a2e] border-surface-border"
        extra={(
          <Button size="small" onClick={fetchFactsetSchedulerStatus}>
            刷新状态
          </Button>
        )}
      >
        {factsetSchedulerStatus ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div className="rounded-md border border-white/10 bg-[#0f172a99] p-3">
              <div className="text-xs text-gray-400">运行状态</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Tag color={factsetSchedulerStatus.config.enabled ? '#34d399' : '#f87171'}>
                  {factsetSchedulerStatus.config.enabled ? '已启用' : '已停用'}
                </Tag>
                <Tag color={factsetSchedulerStatus.runtime.taskStarted ? '#38bdf8' : '#94a3b8'}>
                  {factsetSchedulerStatus.runtime.taskStarted ? '定时器运行' : '定时器未启动'}
                </Tag>
                {factsetSchedulerStatus.runtime.localRunning && <Tag color="#f59e0b">本进程执行中</Tag>}
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-[#0f172a99] p-3">
              <div className="text-xs text-gray-400">调度配置</div>
              <div className="mt-2 text-sm text-white">
                {factsetSchedulerStatus.config.cronExpression} / {factsetSchedulerStatus.config.timezone}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                提前 {factsetSchedulerStatus.config.horizonMinutes} 分钟，单批 {factsetSchedulerStatus.config.limit}
                {factsetSchedulerStatus.config.allowTradingHours ? '，交易时段允许' : '，避开交易时段'}
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-[#0f172a99] p-3">
              <div className="text-xs text-gray-400">租约</div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Tag color={factsetSchedulerStatus.lease?.locked ? '#f59e0b' : '#34d399'}>
                  {factsetSchedulerStatus.lease?.locked ? '已占用' : '空闲'}
                </Tag>
                {factsetSchedulerStatus.lease?.expired && <Tag color="#f87171">已过期</Tag>}
              </div>
              <div className="mt-1 break-all text-xs text-gray-400">
                {factsetSchedulerStatus.lease?.leaseOwner || '无租约持有者'}
              </div>
            </div>
            <div className="rounded-md border border-white/10 bg-[#0f172a99] p-3">
              <div className="text-xs text-gray-400">上次运行</div>
              <div className="mt-2 text-sm text-white">{formatDateTime(factsetSchedulerStatus.lastRunAt || undefined)}</div>
              <div className="mt-1 text-xs text-gray-400">
                {factsetSchedulerStatus.lastResult?.reason || '--'}
                {typeof factsetSchedulerStatus.lastResult?.dueCount === 'number' ? `，到期 ${factsetSchedulerStatus.lastResult.dueCount}` : ''}
                {factsetSchedulerStatus.lastResult?.operationId ? `，任务 ${String(factsetSchedulerStatus.lastResult.operationId).slice(0, 8)}` : ''}
              </div>
            </div>
          </div>
        ) : (
          <Empty description="暂无调度状态" />
        )}
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={4}>
          <Card className="bg-[#1a1a2e] border-surface-border">
            <Statistic title="任务总数" value={stats.total} valueStyle={{ color: '#fff' }} />
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card className="bg-[#1a1a2e] border-surface-border">
            <Statistic title="排队中" value={stats.queued} valueStyle={{ color: '#60a5fa' }} />
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card className="bg-[#1a1a2e] border-surface-border">
            <Statistic title="执行中" value={stats.running} valueStyle={{ color: '#818cf8' }} />
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card className="bg-[#1a1a2e] border-surface-border">
            <Statistic title="已完成" value={stats.completed} valueStyle={{ color: '#34d399' }} />
          </Card>
        </Col>
        <Col xs={12} lg={4}>
          <Card className="bg-[#1a1a2e] border-surface-border">
            <Statistic title="失败" value={stats.failed} valueStyle={{ color: '#f87171' }} />
          </Card>
        </Col>
      </Row>

      <Card className="bg-[#1a1a2e] border-surface-border">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_180px_180px_160px]">
          <Input
            allowClear
            value={queryText}
            onChange={(event) => setQueryText(event.target.value)}
            placeholder="搜索任务 ID 或类型；生成每日建议时也会把这里的内容作为 query"
          />
          <Select
            value={typeFilter}
            onChange={(value) => setTypeFilter(value)}
            options={[
              { value: 'all', label: '全部类型' },
              ...Object.entries(TYPE_META).map(([value, meta]) => ({ value, label: meta.label })),
            ]}
          />
          <Select
            value={statusFilter}
            onChange={(value) => setStatusFilter(value)}
            options={[
              { value: 'all', label: '全部状态' },
              ...Object.entries(STATUS_META).map(([value, meta]) => ({ value, label: meta.label })),
            ]}
          />
          <Select
            value={queryScope}
            onChange={(value) => setQueryScope(value)}
            options={[
              { value: 'all', label: '建议范围: 自动' },
              { value: 'asset', label: '建议范围: 标的' },
              { value: 'sector', label: '建议范围: 板块' },
            ]}
          />
        </div>
      </Card>

      <div className="grid min-w-0 gap-4 xl:grid-cols-4">
        <Card size="small" title="最近价格刷新" className="bg-[#1a1a2e] border-surface-border">
          {latestHighlights.refresh ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Tag color={STATUS_META[latestHighlights.refresh.status].color as any}>{STATUS_META[latestHighlights.refresh.status].label}</Tag>
                <Tag color="#38bdf8">{formatDateTime(latestHighlights.refresh.requestedAt)}</Tag>
              </div>
              <div className="text-sm text-gray-300">
                成功 {latestHighlights.refresh.result?.refreshed || 0} / 失败 {latestHighlights.refresh.result?.failed || 0}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="small" onClick={() => fetchOperationDetail(latestHighlights.refresh!.id)}>查看详情</Button>
                {typeof latestHighlights.refresh.result?.failed === 'number' && latestHighlights.refresh.result.failed > 0 && (
                  <Button size="small" type="link" onClick={() => openRefreshDiagnostics(latestHighlights.refresh!.id, 'failures')}>
                    失败明细
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400">暂无刷新任务</div>
          )}
        </Card>

        <Card size="small" title="最近告警检查" className="bg-[#1a1a2e] border-surface-border">
          {latestHighlights.alerts ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Tag color={STATUS_META[latestHighlights.alerts.status].color as any}>{STATUS_META[latestHighlights.alerts.status].label}</Tag>
                <Tag color="#fbbf24">触发 {latestHighlights.alerts.result?.alertCount || 0}</Tag>
              </div>
              <div className="text-sm text-gray-300">
                {Array.isArray(latestHighlights.alerts.result?.alertedSymbols) && latestHighlights.alerts.result.alertedSymbols.length > 0
                  ? `标的 ${latestHighlights.alerts.result.alertedSymbols.join(', ')}`
                  : '暂无触发标的'}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="small" onClick={() => fetchOperationDetail(latestHighlights.alerts!.id)}>查看详情</Button>
                <Button size="small" type="link" onClick={() => navigate('/alerts')}>打开告警</Button>
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400">暂无告警检查任务</div>
          )}
        </Card>

        <Card size="small" title="最近每日建议" className="bg-[#1a1a2e] border-surface-border">
          {latestHighlights.advice ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Tag color={STATUS_META[latestHighlights.advice.status].color as any}>{STATUS_META[latestHighlights.advice.status].label}</Tag>
                <Tag color="#818cf8">建议 {Array.isArray(latestHighlights.advice.result?.suggestions) ? latestHighlights.advice.result.suggestions.length : 0}</Tag>
              </div>
              <div className="text-sm text-gray-300">
                {latestHighlights.advice.result?.structuredAdvice?.summary || latestHighlights.advice.result?.marketOutlook || '暂无建议摘要'}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="small" onClick={() => fetchOperationDetail(latestHighlights.advice!.id)}>查看详情</Button>
                {latestHighlights.advice.result?.adviceId && (
                  <Button size="small" type="link" onClick={() => navigate(`/backtest?adviceId=${latestHighlights.advice?.result?.adviceId}`)}>
                    去回测
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-400">暂无建议任务</div>
          )}
        </Card>

        <Card size="small" title="最近回测任务" className="bg-[#1a1a2e] border-surface-border">
          {latestHighlights.backtest ? (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Tag color={STATUS_META[latestHighlights.backtest.status].color as any}>{STATUS_META[latestHighlights.backtest.status].label}</Tag>
                {latestHighlights.backtest.result?.backtestId && <Tag color="#34d399">Backtest {String(latestHighlights.backtest.result.backtestId).slice(0, 8)}</Tag>}
              </div>
              <div className="text-sm text-gray-300">
                {latestHighlights.backtest.result?.symbols?.length
                  ? `标的 ${latestHighlights.backtest.result.symbols.join(', ')}`
                  : '等待回测结果'}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="small" onClick={() => fetchOperationDetail(latestHighlights.backtest!.id)}>查看详情</Button>
                {latestHighlights.backtest.result?.backtestId && (
                  <Button size="small" type="link" onClick={() => navigate(`/backtest?backtestId=${latestHighlights.backtest?.result?.backtestId}&view=report`)}>
                    复盘报告
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full min-h-[116px] flex-col items-start justify-between gap-3">
              <div>
                <div className="text-sm text-gray-300">暂无回测任务</div>
                <div className="text-xs text-gray-400 mt-1">从建议任务或分析页可以直接发起回测。</div>
              </div>
              <Button size="small" type="link" onClick={() => navigate('/backtest')}>
                前往回测页
              </Button>
            </div>
          )}
        </Card>
      </div>

      <Card title={<span className="text-white"><HistoryOutlined /> 任务历史</span>} className="bg-[#1a1a2e] border-surface-border">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={filteredOperations}
          columns={columns}
          scroll={{ x: 900 }}
          pagination={{ pageSize: 10, showSizeChanger: false }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={<span className="text-gray-300">暂无任务记录</span>}
              />
            ),
          }}
        />
      </Card>

      <Modal
        title={<span className="text-white">任务详情</span>}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        width="min(960px, calc(100vw - 24px))"
        forceRender
        styles={{ body: { maxHeight: 'calc(100vh - 190px)', overflowY: 'auto', background: '#0f0f23' } }}
        footer={[
          ...(selectedOperation && (selectedOperation.status === 'failed' || selectedOperation.status === 'cancelled' || selectedOperation.status === 'partial')
            ? [
                <Button
                  key="retry"
                  onClick={() => retryOperation(selectedOperation.id)}
                  loading={retryingOperationId === selectedOperation.id}
                >
                  重试任务
                </Button>,
              ]
            : []),
          ...(selectedOperation && isActiveStatus(selectedOperation.status)
            ? [
                <Button
                  key="cancel"
                  danger
                  onClick={() => cancelOperation(selectedOperation.id)}
                  loading={cancellingOperationId === selectedOperation.id}
                >
                  取消任务
                </Button>,
              ]
            : []),
          <Button key="refresh" onClick={() => selectedOperation && fetchOperationDetail(selectedOperation.id)} loading={detailLoading}>
            刷新详情
          </Button>,
          <Button key="close" type="primary" onClick={() => setDetailVisible(false)}>
            关闭
          </Button>,
        ]}
      >
        {detailLoading ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 text-gray-300">
            <Spin size="large" />
            {deepLinkedOperationId && (
              <div className="text-xs break-all">正在加载任务详情：{deepLinkedOperationId}</div>
            )}
          </div>
        ) : !selectedOperation ? (
          <Empty description="暂无详情" />
        ) : (
          <div className="space-y-4">
            <div
              className="rounded-lg border border-sky-400/25 bg-sky-400/10 p-3"
              data-fams-operation-detail-visible="true"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Tag color={TYPE_META[selectedOperation.type]?.color}>{TYPE_META[selectedOperation.type]?.label || selectedOperation.type}</Tag>
                <Tag color={STATUS_META[selectedOperation.status].color as any}>{STATUS_META[selectedOperation.status].label}</Tag>
                {deepLinkedOperationId && <Tag color="#38bdf8">深链已打开</Tag>}
              </div>
              <div className="mt-2 text-sm text-white break-all">
                {selectedOperation.operation_id || selectedOperation.operationId || selectedOperation.id}
              </div>
              <div className="mt-1 text-xs text-gray-300">
                请求时间 {formatDateTime(selectedOperation.requestedAt)}，进度 {typeof selectedOperation.progressPct === 'number' ? `${selectedOperation.progressPct}%` : isSuccessfulStatus(selectedOperation.status) ? '100%' : '--'}
              </div>
            </div>
            <Descriptions
              column={{ xs: 1, md: 2 }}
              bordered
              size="small"
              items={[
                {
                  key: 'type',
                  label: '任务类型',
                  children: <Tag color={TYPE_META[selectedOperation.type]?.color}>{TYPE_META[selectedOperation.type]?.label || selectedOperation.type}</Tag>,
                },
                {
                  key: 'status',
                  label: '状态',
                  children: <Badge status={STATUS_META[selectedOperation.status].color as any} text={STATUS_META[selectedOperation.status].label} />,
                },
                {
                  key: 'operation_id',
                  label: 'operation_id',
                  children: <span className="break-all">{selectedOperation.operation_id || selectedOperation.operationId || selectedOperation.id}</span>,
                },
                { key: 'requestedAt', label: '请求时间', children: formatDateTime(selectedOperation.requestedAt) },
                { key: 'startedAt', label: '开始时间', children: formatDateTime(selectedOperation.startedAt) },
                { key: 'completedAt', label: '完成时间', children: formatDateTime(selectedOperation.completedAt) },
                { key: 'duration', label: '耗时', children: formatDuration(selectedOperation.startedAt, selectedOperation.completedAt) },
                { key: 'createdBy', label: '触发来源', children: selectedOperation.createdBy || '--' },
                {
                  key: 'progress',
                  label: '进度',
                  children: (
                    <Progress
                      percent={typeof selectedOperation.progressPct === 'number' ? selectedOperation.progressPct : isSuccessfulStatus(selectedOperation.status) ? 100 : 0}
                      size="small"
                      status={progressStatus(selectedOperation.status)}
                    />
                  ),
                },
              ]}
            />

            <OperationTimeline
              items={timelineOperations as any}
              currentOperationId={selectedOperation.id}
              title="关联任务链"
              className="bg-[#161629] border-white/10"
              onOpenOperation={fetchOperationDetail}
              onOpenAdviceSnapshot={openAdviceSnapshotDetail}
              onOpenRefreshDiagnostics={openRefreshDiagnostics}
              onRunBacktest={startRunBacktest}
              runningBacktestOperationId={startingBacktest ? startingBacktestParentId : null}
            />

            {selectedTasks.length > 0 && (
              <Card size="small" title="任务分片" className="bg-[#161629] border-white/10">
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={selectedTasks}
                  columns={operationTaskColumns}
                  pagination={false}
                  scroll={{ x: 880 }}
                />
              </Card>
            )}

            {(selectedArtifactRefs.length > 0 || selectedNextActions.length > 0) && (
              <Card
                id="operation-contract-card"
                size="small"
                title="任务产物与下一步"
                className="bg-[#161629] border-white/10"
              >
                <div className="space-y-4 min-w-0">
                  {selectedArtifactRefs.length > 0 && (
                    <div>
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-gray-400">Artifact Refs</span>
                        <Tag color="#38bdf8">{selectedArtifactRefs.length}</Tag>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedArtifactRefs.slice(0, 16).map((ref) => (
                          <button
                            key={ref}
                            type="button"
                            onClick={() => openArtifactDetail(ref)}
                            className="block min-w-0 w-full max-w-full cursor-pointer rounded bg-slate-500 px-2 py-1 text-left text-xs leading-5 text-white break-all transition hover:bg-sky-600 md:w-auto"
                            style={{ overflowWrap: 'anywhere', wordBreak: 'break-all', whiteSpace: 'normal' }}
                          >
                            {ref}
                          </button>
                        ))}
                        {selectedArtifactRefs.length > 16 && (
                          <Tag color="#94a3b8">+{selectedArtifactRefs.length - 16}</Tag>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedNextActions.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-400 mb-2">Next Actions</div>
                      <Space wrap>
                        {selectedNextActions.map((action, index) => (
                          <Button
                            key={`${action.type}-${index}`}
                            size="small"
                            type={index === 0 ? 'primary' : 'default'}
                            loading={runningNextActionKey === `${action.type}-${index}`}
                            onClick={() => runNextAction(action, index)}
                          >
                            {action.label}
                          </Button>
                        ))}
                      </Space>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {selectedReliability && (
              <Card size="small" title="数据可靠性" className="bg-[#161629] border-white/10">
                <div className="flex flex-wrap gap-2 mb-3">
                  <Tag color={RELIABILITY_STATUS[selectedReliability.overallStatus].color}>
                    {RELIABILITY_STATUS[selectedReliability.overallStatus].label}
                  </Tag>
                  <Tag color="#38bdf8">
                    平均置信度 {typeof selectedReliability.averageConfidence === 'number'
                      ? `${(selectedReliability.averageConfidence * 100).toFixed(0)}%`
                      : '--'}
                  </Tag>
                  <Tag color={selectedReliability.warningCount > 0 ? '#fbbf24' : '#34d399'}>
                    警告 {selectedReliability.warningCount}
                  </Tag>
                </div>
                <ProviderHealthTags items={selectedReliability.providerSummary || []} />
                <ReliabilityWarnings warnings={selectedReliability.warnings || []} className="mt-3 flex flex-wrap gap-2" />
                <ProviderHealthSummary items={selectedReliability.providerSummary || []} className="mt-4" />
              </Card>
            )}

            {selectedProviderSummary.length > 0 && (
              <Card id="operation-provider-health-card" size="small" title="Provider 健康度" className="bg-[#161629] border-white/10">
                <ProviderHealthSummary items={selectedProviderSummary} />
              </Card>
            )}

            {selectedWarnings.length > 0 && (
              <Card size="small" title="运行警告" className="bg-[#161629] border-white/10">
                <ReliabilityWarnings warnings={selectedWarnings} className="flex flex-wrap gap-2" />
              </Card>
            )}

            {selectedFailures.length > 0 && (
              <Card id="operation-refresh-failures-card" size="small" title="失败明细" className="bg-[#161629] border-white/10">
                <RefreshFailureTable items={selectedFailures} />
              </Card>
            )}

            {selectedOperation?.type === 'check_alerts' && (
              <Card
                size="small"
                title="告警检查结果"
                extra={<Button size="small" type="link" onClick={() => navigate('/alerts')}>打开告警页</Button>}
                className="bg-[#161629] border-white/10"
              >
                <div className="flex flex-wrap gap-2 mb-3">
                  <Tag color={(selectedOperation.result?.alertCount || 0) > 0 ? '#f87171' : '#34d399'}>
                    触发 {selectedOperation.result?.alertCount || 0}
                  </Tag>
                  <Tag color="#38bdf8">{selectedOperation.result?.refreshPrices ? '已刷新价格' : '未刷新价格'}</Tag>
                </div>
                {Array.isArray(selectedOperation.result?.alertedSymbols) && selectedOperation.result.alertedSymbols.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {selectedOperation.result.alertedSymbols.map((symbol: string) => (
                      <Tag key={symbol} color="#fbbf24">{symbol}</Tag>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-gray-300">本次检查未触发新的风险标的。</div>
                )}
              </Card>
            )}

            {selectedOperation?.type === 'generate_daily_advice' && advicePreview && (
              <Card
                size="small"
                title="每日建议结果预览"
                extra={(
                      <Space size="small" wrap>
                    {advicePreview.adviceId && (
                        <Button
                          size="small"
                          loading={startingBacktest}
                          onClick={() => startRunBacktest(advicePreview.adviceId, selectedOperation?.id)}
                        >
                          提交回测任务
                        </Button>
                    )}
                    {advicePreview.adviceId && (
                      <Button size="small" type="link" onClick={() => navigate(`/backtest?adviceId=${advicePreview.adviceId}`)}>
                        基于此建议回测
                      </Button>
                    )}
                    <Button size="small" type="link" onClick={() => navigate('/analysis')}>
                      前往分析页
                    </Button>
                  </Space>
                )}
                className="bg-[#161629] border-white/10"
              >
                <div className="space-y-4">
                  <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
                    <div className="flex flex-wrap gap-2 mb-3">
                      {advicePreview.adviceId && <Tag color="#a78bfa">Advice {advicePreview.adviceId.slice(0, 8)}</Tag>}
                      {(advicePreview.adviceInputSnapshotId || advicePreview.snapshotIds?.adviceInputSnapshotId) && (
                        <Tag color="#818cf8">Snapshot {(advicePreview.adviceInputSnapshotId || advicePreview.snapshotIds?.adviceInputSnapshotId || '').slice(0, 8)}</Tag>
                      )}
                      {advicePreview.structuredAdvice?.risk_level && (
                        <Tag color={advicePreview.structuredAdvice.risk_level === 'high' ? '#f87171' : advicePreview.structuredAdvice.risk_level === 'medium' ? '#fbbf24' : '#34d399'}>
                          风险 {advicePreview.structuredAdvice.risk_level}
                        </Tag>
                      )}
                      {advicePreview.structuredAdvice?.scope && (
                        <Tag color="#38bdf8">{advicePreview.structuredAdvice.scope}</Tag>
                      )}
                      <Tag color="#818cf8">建议 {Array.isArray(advicePreview.suggestions) ? advicePreview.suggestions.length : 0}</Tag>
                      {typeof advicePreview.overallScore === 'number' && (
                        <Tag color="#34d399">评分 {advicePreview.overallScore.toFixed(1)}</Tag>
                      )}
                      {Array.isArray(advicePreview.snapshotIds?.positionSnapshotIds) && (
                        <Tag color="#38bdf8">Position Snapshots {advicePreview.snapshotIds?.positionSnapshotIds?.length || 0}</Tag>
                      )}
                      {Array.isArray(advicePreview.snapshotIds?.marketSnapshotIds) && (
                        <Tag color="#fbbf24">Market Snapshots {advicePreview.snapshotIds?.marketSnapshotIds?.length || 0}</Tag>
                      )}
                    </div>
                    <div className="text-sm text-white leading-6">
                      {advicePreview.structuredAdvice?.summary || advicePreview.marketOutlook || '暂无建议摘要'}
                    </div>
                    {advicePreview.structuredAdvice?.risks && advicePreview.structuredAdvice.risks.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {advicePreview.structuredAdvice.risks.slice(0, 5).map((risk) => (
                          <Tag key={risk} color="#f87171">{risk}</Tag>
                        ))}
                      </div>
                    )}
                  </div>

                  {previewSuggestions.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-400 mb-2">建议预览</div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {previewSuggestions.map((item) => (
                          <div key={item.id} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-sm font-medium text-white">{item.title}</div>
                              <Tag color={item.priority === 'high' ? '#f87171' : item.priority === 'medium' ? '#fbbf24' : '#34d399'}>
                                {item.priority}
                              </Tag>
                            </div>
                            <div className="text-xs text-gray-300 mt-2 leading-5">{item.description}</div>
                            <div className="flex flex-wrap gap-2 mt-3">
                              {item.actionType && <Tag color="#818cf8">{item.actionType}</Tag>}
                              {item.targetSymbol && <Tag color="#38bdf8">{item.targetSymbol}</Tag>}
                              {item.status && (
                                <Tag color={item.status === 'executed' ? '#34d399' : '#fbbf24'}>
                                  {item.status === 'executed' ? '已记录' : '待确认'}
                                </Tag>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {advicePreview.disclaimer && (
                    <div className="text-xs text-gray-400">
                      {advicePreview.disclaimer}
                    </div>
                  )}
                  {Array.isArray(advicePreview.artifactRefs) && advicePreview.artifactRefs.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-400 mb-2">Artifact Refs</div>
                      <div className="flex flex-wrap gap-2">
                        {advicePreview.artifactRefs.slice(0, 10).map((ref) => (
                          <span
                            key={ref}
                            className="block min-w-0 w-full max-w-full rounded bg-slate-500 px-2 py-1 text-xs leading-5 text-white break-all md:w-auto"
                            style={{ overflowWrap: 'anywhere', wordBreak: 'break-all', whiteSpace: 'normal' }}
                          >
                            {ref}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {selectedOperation?.type === 'generate_daily_advice' && relatedBacktestOperation && (
              <Card
                size="small"
                title="最近关联回测任务"
                className="bg-[#161629] border-white/10"
                extra={(
                  <Space size="small" wrap>
                    <Button size="small" type="link" onClick={() => fetchOperationDetail(relatedBacktestOperation.id)}>
                      打开任务详情
                    </Button>
                    {relatedBacktestOperation.result?.backtestId && (
                      <Button size="small" type="link" onClick={() => navigate(`/backtest?backtestId=${relatedBacktestOperation.result?.backtestId}`)}>
                        打开回测页
                      </Button>
                    )}
                  </Space>
                )}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Tag color={TYPE_META.run_backtest.color}>{TYPE_META.run_backtest.label}</Tag>
                    <Tag color={STATUS_META[relatedBacktestOperation.status].color as any}>
                      {STATUS_META[relatedBacktestOperation.status].label}
                    </Tag>
                    <Tag color="#38bdf8">Operation {relatedBacktestOperation.id.slice(0, 8)}</Tag>
                    {relatedBacktestOperation.result?.backtestId && (
                      <Tag color="#34d399">Backtest {String(relatedBacktestOperation.result.backtestId).slice(0, 8)}</Tag>
                    )}
                  </div>
                  <div className="text-sm text-gray-300">
                    请求时间 {formatDateTime(relatedBacktestOperation.requestedAt)}
                    {relatedBacktestOperation.completedAt ? `，完成时间 ${formatDateTime(relatedBacktestOperation.completedAt)}` : ''}
                  </div>
                  {typeof relatedBacktestOperation.progressPct === 'number' && (
                    <Progress
                      percent={relatedBacktestOperation.progressPct}
                      size="small"
                      status={progressStatus(relatedBacktestOperation.status)}
                    />
                  )}
                  {relatedBacktestOperation.error?.message && (
                    <div className="text-xs text-[#f87171]">{relatedBacktestOperation.error.message}</div>
                  )}
                </div>
              </Card>
            )}

            {selectedAdviceDetail && (
              <Card
                id="operation-advice-snapshot-card"
                size="small"
                title="建议快照详情"
                className="bg-[#161629] border-white/10"
                extra={(
                  <Space size="small" wrap>
                    {selectedAdviceDetail.adviceId && (
                      <Button
                        size="small"
                        loading={startingBacktest}
                        onClick={() => startRunBacktest(selectedAdviceDetail.adviceId, selectedOperation?.id)}
                      >
                        提交回测任务
                      </Button>
                    )}
                    {selectedAdviceDetail.adviceId && (
                      <Button size="small" type="link" onClick={() => navigate(`/backtest?adviceId=${selectedAdviceDetail.adviceId}`)}>
                        基于此建议回测
                      </Button>
                    )}
                    {adviceDetailLoading ? <Spin size="small" /> : null}
                  </Space>
                )}
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Tag color="#a78bfa">Advice {selectedAdviceDetail.adviceId.slice(0, 8)}</Tag>
                    {selectedAdviceDetail.inputSnapshot?.adviceInputSnapshotId && (
                      <Tag color="#818cf8">Snapshot {selectedAdviceDetail.inputSnapshot.adviceInputSnapshotId.slice(0, 8)}</Tag>
                    )}
                    <Tag color="#38bdf8">{selectedAdviceDetail.scope || 'portfolio'}</Tag>
                    <Tag color={selectedAdviceDetail.riskLevel === 'high' ? '#f87171' : selectedAdviceDetail.riskLevel === 'medium' ? '#fbbf24' : '#34d399'}>
                      风险 {selectedAdviceDetail.riskLevel}
                    </Tag>
                  </div>

                  <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-4">
                    <div className="text-xs text-gray-400 mb-2">建议摘要</div>
                    <div className="text-sm text-white leading-6">
                      {selectedAdviceDetail.summaryText || selectedAdviceDetail.structuredAdvice?.summary || '暂无摘要'}
                    </div>
                    <div className="text-xs text-gray-400 mt-3">
                      生成时间 {formatDateTime(selectedAdviceDetail.generatedAt)}
                      {selectedAdviceDetail.inputSnapshot?.capturedAt ? `，快照时间 ${formatDateTime(selectedAdviceDetail.inputSnapshot.capturedAt)}` : ''}
                    </div>
                  </div>

                  {selectedAdviceDetail.inputSnapshot && (
                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={8}>
                        <Card size="small" className="bg-[#0f172a99] border-white/10">
                          <div className="text-xs text-gray-400 mb-1">组合快照</div>
                          <div className="text-white text-sm">总资产 {(selectedAdviceDetail.inputSnapshot.portfolio?.totalValue || 0).toFixed?.(2) || selectedAdviceDetail.inputSnapshot.portfolio?.totalValue || 0}</div>
                          <div className="text-gray-300 text-xs mt-1">按类型 {selectedAdviceDetail.inputSnapshot.portfolio?.byType?.length || 0} 项</div>
                        </Card>
                      </Col>
                      <Col xs={24} md={8}>
                        <Card size="small" className="bg-[#0f172a99] border-white/10">
                          <div className="text-xs text-gray-400 mb-1">持仓快照</div>
                          <div className="text-white text-sm">{selectedAdviceDetail.inputSnapshot.positions?.length || 0} 条持仓记录</div>
                          <div className="text-gray-300 text-xs mt-1">用于建议生成的原始持仓输入</div>
                        </Card>
                      </Col>
                      <Col xs={24} md={8}>
                        <Card size="small" className="bg-[#0f172a99] border-white/10">
                          <div className="text-xs text-gray-400 mb-1">行情快照</div>
                          <div className="text-white text-sm">{selectedAdviceDetail.inputSnapshot.market?.length || 0} 条行情记录</div>
                          <div className="text-gray-300 text-xs mt-1">与建议同批次落库</div>
                        </Card>
                      </Col>
                    </Row>
                  )}

                  {selectedAdviceDetail.executionReview && (
                    <Card size="small" title="执行复盘" className="bg-[#0f172a99] border-white/10">
                      <div className="grid gap-3 md:grid-cols-4">
                        <div className="rounded-lg border border-white/10 bg-[#111827] p-3">
                          <div className="text-xs text-gray-400 mb-1">执行率</div>
                          <div className="text-xl font-semibold text-white">
                            {(selectedAdviceDetail.executionReview.executionRate * 100).toFixed(0)}%
                          </div>
                          <div className="text-xs text-gray-300 mt-1">
                            已执行 {selectedAdviceDetail.executionReview.executedActions} / 可执行 {selectedAdviceDetail.executionReview.executableActions}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-[#111827] p-3">
                          <div className="text-xs text-gray-400 mb-1">建议金额</div>
                          <div className="text-xl font-semibold text-white">
                            {formatMoney(selectedAdviceDetail.executionReview.suggestedNotional)}
                          </div>
                          <div className="text-xs text-gray-300 mt-1">
                            待执行 {selectedAdviceDetail.executionReview.pendingActions} 条
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-[#111827] p-3">
                          <div className="text-xs text-gray-400 mb-1">已执行金额</div>
                          <div className="text-xl font-semibold text-white">
                            {formatMoney(selectedAdviceDetail.executionReview.executedNotional)}
                          </div>
                          <div className="text-xs text-gray-300 mt-1">
                            接受 {selectedAdviceDetail.executionReview.acceptedActions} / 拒绝 {selectedAdviceDetail.executionReview.rejectedActions}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-[#111827] p-3">
                          <div className="text-xs text-gray-400 mb-1">买入浮盈亏差异</div>
                          <div
                            className="text-xl font-semibold"
                            style={{
                              color: (selectedAdviceDetail.executionReview.buySide.executedCurrentPnl - selectedAdviceDetail.executionReview.buySide.simulatedCurrentPnl) >= 0 ? '#34d399' : '#f87171',
                            }}
                          >
                            {formatSignedMoney(
                              selectedAdviceDetail.executionReview.buySide.executedCurrentPnl - selectedAdviceDetail.executionReview.buySide.simulatedCurrentPnl
                            )}
                          </div>
                          <div className="text-xs text-gray-300 mt-1">实际减模拟</div>
                        </div>
                      </div>

                      <div className="grid gap-3 mt-4 md:grid-cols-2">
                        <div className="rounded-lg border border-white/10 bg-[#111827] p-4">
                          <div className="text-xs text-gray-400 mb-2">买入类建议</div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <div className="text-gray-400">建议金额</div>
                              <div className="text-white">{formatMoney(selectedAdviceDetail.executionReview.buySide.suggestedNotional)}</div>
                            </div>
                            <div>
                              <div className="text-gray-400">已执行金额</div>
                              <div className="text-white">{formatMoney(selectedAdviceDetail.executionReview.buySide.executedNotional)}</div>
                            </div>
                            <div>
                              <div className="text-gray-400">模拟浮盈亏</div>
                              <div style={{ color: selectedAdviceDetail.executionReview.buySide.simulatedCurrentPnl >= 0 ? '#34d399' : '#f87171' }}>
                                {formatSignedMoney(selectedAdviceDetail.executionReview.buySide.simulatedCurrentPnl)}
                              </div>
                            </div>
                            <div>
                              <div className="text-gray-400">实际浮盈亏</div>
                              <div style={{ color: selectedAdviceDetail.executionReview.buySide.executedCurrentPnl >= 0 ? '#34d399' : '#f87171' }}>
                                {formatSignedMoney(selectedAdviceDetail.executionReview.buySide.executedCurrentPnl)}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-[#111827] p-4">
                          <div className="text-xs text-gray-400 mb-2">卖出类建议</div>
                          <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <div className="text-gray-400">建议金额</div>
                              <div className="text-white">{formatMoney(selectedAdviceDetail.executionReview.sellSide.suggestedNotional)}</div>
                            </div>
                            <div>
                              <div className="text-gray-400">已执行金额</div>
                              <div className="text-white">{formatMoney(selectedAdviceDetail.executionReview.sellSide.executedNotional)}</div>
                            </div>
                            <div>
                              <div className="text-gray-400">动作数</div>
                              <div className="text-white">{selectedAdviceDetail.executionReview.sellSide.actionCount}</div>
                            </div>
                            <div>
                              <div className="text-gray-400">已执行数</div>
                              <div className="text-white">{selectedAdviceDetail.executionReview.sellSide.executedCount}</div>
                            </div>
                          </div>
                        </div>
                      </div>

                      {selectedAdviceDetail.executionReview.notes.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-4">
                          {selectedAdviceDetail.executionReview.notes.map((note) => (
                            <Tag key={note} color="#64748b">{note}</Tag>
                          ))}
                        </div>
                      )}
                    </Card>
                  )}

                  {Array.isArray(selectedAdviceDetail.actions) && selectedAdviceDetail.actions.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-400 mb-2">动作执行状态</div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {selectedAdviceDetail.actions.slice(0, 6).map((action) => (
                          <div key={action.id} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                            <div className="flex flex-wrap items-center gap-2 mb-2">
                              <Tag color="#818cf8">{action.actionType}</Tag>
                              <Tag color={action.status === 'executed' ? '#34d399' : '#fbbf24'}>
                                {action.status}
                              </Tag>
                              {action.execution?.decision && <Tag color="#38bdf8">{action.execution.decision}</Tag>}
                            </div>
                            <div className="text-sm text-white">
                              {action.assetName || action.assetSymbol || '组合动作'}
                            </div>
                            <div className="text-xs text-gray-300 mt-1">
                              关联交易 {action.transactions?.length || 0} 条
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            )}

            {selectedBacktestDetail && (
              <Card
                size="small"
                title="回测复盘报告"
                className="bg-[#161629] border-white/10"
                extra={(
                  <Space size="small">
                    <Button size="small" type="link" onClick={() => navigate(`/backtest?backtestId=${selectedBacktestDetail.id}`)}>
                      打开回测页
                    </Button>
                    {backtestDetailLoading ? <Spin size="small" /> : null}
                  </Space>
                )}
              >
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Tag color="#34d399">Backtest {selectedBacktestDetail.id.slice(0, 8)}</Tag>
                    <Tag color="#818cf8">Strategy {selectedBacktestDetail.strategyId.slice(0, 8)}</Tag>
                    <Tag color="#38bdf8">{selectedBacktestDetail.status}</Tag>
                    {selectedBacktestDetail.reviewReport?.adviceId && (
                      <Tag color="#a78bfa">Advice {selectedBacktestDetail.reviewReport.adviceId.slice(0, 8)}</Tag>
                    )}
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                      <div className="text-xs text-gray-400 mb-1">总收益率</div>
                      <div className="text-lg text-white">
                        {selectedBacktestDetail.metrics?.totalReturn == null ? '--' : formatPercent(selectedBacktestDetail.metrics.totalReturn)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                      <div className="text-xs text-gray-400 mb-1">年化收益</div>
                      <div className="text-lg text-white">
                        {selectedBacktestDetail.metrics?.annualizedReturn == null ? '--' : formatPercent(selectedBacktestDetail.metrics.annualizedReturn)}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                      <div className="text-xs text-gray-400 mb-1">最大回撤</div>
                      <div className="text-lg text-white">
                        {selectedBacktestDetail.metrics?.maxDrawdown == null ? '--' : `-${Math.abs(selectedBacktestDetail.metrics.maxDrawdown).toFixed(2)}%`}
                      </div>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                      <div className="text-xs text-gray-400 mb-1">交易次数</div>
                      <div className="text-lg text-white">
                        {selectedBacktestDetail.metrics?.tradesCount ?? '--'}
                      </div>
                    </div>
                  </div>

                  {selectedBacktestDetail.reviewReport?.windowReview && (
                    <>
                      <div className="rounded-lg border border-white/10 bg-[#111827] p-4">
                        <div className="text-xs text-gray-400 mb-2">执行偏差摘要</div>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <div className="text-xs text-gray-400">执行率</div>
                            <div className="text-white mt-1">{(selectedBacktestDetail.reviewReport.windowReview.executionRate * 100).toFixed(0)}%</div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-400">模拟买入收益</div>
                            <div className="text-white mt-1">
                              {selectedBacktestDetail.reviewReport.windowReview.buySide.simulatedReturnPct == null
                                ? '--'
                                : formatPercent(selectedBacktestDetail.reviewReport.windowReview.buySide.simulatedReturnPct)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-gray-400">实际买入收益</div>
                            <div className="text-white mt-1">
                              {selectedBacktestDetail.reviewReport.windowReview.buySide.executedReturnPct == null
                                ? '--'
                                : formatPercent(selectedBacktestDetail.reviewReport.windowReview.buySide.executedReturnPct)}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-lg border border-white/10 bg-[#111827] p-4">
                          <div className="text-xs text-gray-400 mb-2">买入类区间复盘</div>
                          <div className="text-sm text-gray-200">
                            模拟 {formatSignedMoney(selectedBacktestDetail.reviewReport.windowReview.buySide.simulatedPnl)}
                            {' · '}
                            实际 {formatSignedMoney(selectedBacktestDetail.reviewReport.windowReview.buySide.executedPnl)}
                          </div>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-[#111827] p-4">
                          <div className="text-xs text-gray-400 mb-2">卖出类已实现复盘</div>
                          <div className="text-sm text-gray-200">
                            模拟 {formatSignedMoney(selectedBacktestDetail.reviewReport.windowReview.sellSide.simulatedRealizedPnl)}
                            {' · '}
                            实际 {formatSignedMoney(selectedBacktestDetail.reviewReport.windowReview.sellSide.executedRealizedPnl)}
                          </div>
                        </div>
                      </div>

                      {selectedBacktestDetail.reviewReport.windowReview.notes.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {selectedBacktestDetail.reviewReport.windowReview.notes.map((note) => (
                            <Tag key={note} color="#64748b">{note}</Tag>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {Array.isArray(selectedBacktestDetail.artifactRefs) && selectedBacktestDetail.artifactRefs.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {selectedBacktestDetail.artifactRefs.map((ref) => (
                        <Tag key={ref} color="#475569">{ref}</Tag>
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            )}

            <Row gutter={[16, 16]}>
              <Col xs={24} lg={12}>
                <Card size="small" title="输入参数" className="bg-[#161629] border-white/10">
                  <pre className="text-xs text-gray-200 whitespace-pre-wrap break-all mb-0">
                    {JSON.stringify(selectedOperation.input || {}, null, 2)}
                  </pre>
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card size="small" title="执行结果" className="bg-[#161629] border-white/10">
                  <pre className="text-xs text-gray-200 whitespace-pre-wrap break-all mb-0">
                    {JSON.stringify(selectedOperation.error && Object.keys(selectedOperation.error).length > 0
                      ? selectedOperation.error
                      : selectedOperation.result || {}, null, 2)}
                  </pre>
                </Card>
              </Col>
            </Row>
          </div>
        )}
      </Modal>
      <Modal
        title={artifactDetail?.title || (pendingArtifactRef ? `任务产物 ${pendingArtifactRef}` : '任务产物')}
        open={artifactDetailVisible}
        onCancel={() => {
          setArtifactDetailVisible(false)
          setPendingArtifactRef(null)
        }}
        footer={null}
        width="min(920px, calc(100vw - 32px))"
        zIndex={1400}
        data-fams-artifact-modal="true"
        styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto', background: '#0f0f23' } }}
      >
        <Spin spinning={artifactDetailLoading}>
          {!artifactDetail ? (
            <Empty description="暂无产物详情" />
          ) : (
            <div className="space-y-4">
              <Descriptions
                size="small"
                column={{ xs: 1, md: 2 }}
                items={[
                  { key: 'ref', label: '引用', children: <span className="break-all">{artifactDetail.ref}</span> },
                  { key: 'type', label: '类型', children: artifactDetail.type },
                  { key: 'id', label: 'ID', children: <span className="break-all">{artifactDetail.id}</span> },
                  { key: 'createdAt', label: '创建时间', children: formatDateTime(artifactDetail.createdAt) },
                ]}
              />
              {relatedArtifactRefs.length > 0 && (
                <Card size="small" title="同批次产物导航" className="bg-[#161629] border-white/10">
                  <div className="flex flex-wrap gap-2">
                    {relatedArtifactRefs.map((item) => (
                      <Button
                        key={item.filename}
                        size="small"
                        type={item.active ? 'primary' : 'default'}
                        onClick={() => {
                          if (!item.active) void openArtifactDetail(item.ref)
                        }}
                      >
                        {item.label}
                      </Button>
                    ))}
                  </div>
                </Card>
              )}
              <Card size="small" title="结构化摘要" className="bg-[#161629] border-white/10">
                <div className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    {artifactReadableDetail.metrics.map((item) => (
                      <Tag key={`${item.label}-${item.value}`} color={item.color || '#64748b'}>
                        {item.label} {item.value}
                      </Tag>
                    ))}
                    {artifactReadableDetail.metrics.length === 0 && <Tag color="#64748b">通用 JSON 产物</Tag>}
                  </div>
                  <div className="rounded-lg border border-white/10 bg-[#0f172a99] p-3 text-sm leading-6 text-white">
                    {artifactReadableDetail.summary || '这个产物没有显式摘要，下面已按可识别字段提取建议、风险和动作。'}
                  </div>
                  {artifactReadableDetail.suggestions.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs text-gray-400">建议摘要</div>
                      <div className="grid gap-3 md:grid-cols-2">
                        {artifactReadableDetail.suggestions.map((item) => (
                          <div key={item.key} className="rounded-lg border border-white/10 bg-[#0f172a99] p-3">
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <div className="text-sm font-medium text-white break-all">{item.title}</div>
                              {item.tag && <Tag color="#818cf8">{String(item.tag)}</Tag>}
                            </div>
                            <div className="mt-2 text-xs leading-5 text-gray-300 break-words">{item.description}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  {artifactReadableDetail.actions.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs text-gray-400">建议动作</div>
                      <div className="flex flex-wrap gap-2">
                        {artifactReadableDetail.actions.map((action) => (
                          <Tag key={action} color="#34d399">{action}</Tag>
                        ))}
                      </div>
                    </div>
                  )}
                  {artifactReadableDetail.risks.length > 0 && (
                    <div>
                      <div className="mb-2 text-xs text-gray-400">风险点</div>
                      <div className="flex flex-wrap gap-2">
                        {artifactReadableDetail.risks.map((risk) => (
                          <Tag key={risk} color="#f87171">{risk}</Tag>
                        ))}
                      </div>
                    </div>
                  )}
                  {artifactReadableDetail.failures.length > 0 && (
                    <div className="rounded-lg border border-red-400/20 bg-red-400/10 p-3 text-xs text-red-100">
                      该产物包含 {artifactReadableDetail.failures.length} 个失败项，建议先复核数据源、网络或标的代码后再执行后续动作。
                    </div>
                  )}
                </div>
              </Card>
              {screenerArtifactPreview}
              <Collapse
                ghost
                items={[
                  {
                    key: 'json',
                    label: <span className="text-gray-200">查看原始 JSON</span>,
                    children: (
                      <pre className="max-h-[42vh] overflow-auto rounded-lg border border-white/10 bg-[#161629] p-3 text-xs text-gray-200 whitespace-pre-wrap break-all mb-0">
                        {JSON.stringify(artifactDetail.data || {}, null, 2)}
                      </pre>
                    ),
                  },
                ]}
              />
            </div>
          )}
        </Spin>
      </Modal>
    </div>
  )
}

export default Operations
