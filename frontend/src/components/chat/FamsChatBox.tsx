import { useCallback, useEffect, useMemo, useRef, useState, type ElementRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Card, Collapse, Drawer, FloatButton, Input, Modal, Space, Spin, Tag, Typography, message as antdMessage } from 'antd'
import ReactECharts from 'echarts-for-react'
import {
  BarChartOutlined,
  CheckCircleOutlined,
  CopyOutlined,
  DatabaseOutlined,
  ExpandOutlined,
  FileSearchOutlined,
  HistoryOutlined,
  LinkOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  CompressOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { API_BASE } from '../../config/api'
import { ScreenshotCapturePanel, type ScreenshotCaptureEvent } from '../capture/ScreenshotCapturePanel'
import { OpenInExternalBrainButton } from '../external-brain/OpenInExternalBrainButton'
import { PX_DEFAULT_WORKSPACE_ID } from '../../services/pxExternalBrainBridge'

const { Text, Paragraph } = Typography

type ChatActionCard = {
  id: string
  type: 'navigation' | 'tool_confirmation' | 'artifact' | 'blocked' | 'result'
  title: string
  description: string
  href?: string
  confirmationId?: string
  status?: 'ready' | 'requires_confirmation' | 'blocked' | 'completed'
}

type ChatMetricCard = {
  label: string
  value: string | number | null
  unit?: string
  status?: 'good' | 'warning' | 'blocked' | 'neutral'
  description?: string
}

type DailyReviewStructuredDetails = {
  reviewId: string
  generatedAt: string
  completedAt?: string
  sessionType: string
  strategyAssessment: { status: string; conclusion: string; reasons: string[] } | null
  assets: Array<{
    assetId: string
    symbol: string
    name: string
    quote: {
      price: number | null
      asOf: string | null
      source: string | null
      currency: string | null
      latestClose: number | null
      latestCloseDate: string | null
      ma5: number | null
      ma10: number | null
      ma30: number | null
      dataQualityStatus: string | null
    }
    materialChange: { level: string; reasons: string[]; evidenceRefs: string[] }
    recommendation: { action: string; confidence: string; reasons: string[]; risks: string[] }
    grid: {
      strategySource: string
      templateId: string
      mode: string
      status: string
      summary: string
      validUntil: string | null
      blockers: string[]
      adjustment: { changed: boolean; reasons: string[]; previousPlanId?: string | null }
      orders: Array<Record<string, string | number | null>>
    }
  }>
  attentionCandidates: Array<Record<string, string | number | null>>
  executionBoundary: Record<string, boolean>
}

type ChatStructuredResult = {
  answerLevel?: 'plain_language'
  summary?: string
  keyNumbers?: ChatMetricCard[]
  nextActions?: string[]
  dataHealth?: Record<string, unknown>
  technicalDetailsCollapsed?: true
  prohibitedActions?: string[]
  resultType: string
  metricCards: ChatMetricCard[]
  comparisonTable: {
    columns: Array<{ key: string; label: string }>
    rows: Array<Record<string, string | number | null>>
    insufficientReason?: string
  }
  charts: Array<{
    type: 'line_chart' | 'drawdown_chart'
    title: string
    xAxisType: 'time' | 'category'
    yAxisLabel: string
    series: Array<{ name: string; data: Array<[string, number | null]> }>
  }>
  dataQualitySummary?: Record<string, unknown>
  dailyReview?: DailyReviewStructuredDetails
  evidenceRefs: string[]
  blockedReasons: string[]
  notTradingAdvice: true
}

type ChatResponse = {
  schemaVersion: 'fams.chat.response.v1'
  conversationId: string
  messageId: string
  reply: string
  intent: string
  confidence: number
  actionCards: ChatActionCard[]
  requiresConfirmation: boolean
  operationId?: string
  artifactRefs: string[]
  blockedReasons: string[]
  structuredResult?: ChatStructuredResult
  dataQualitySummary?: Record<string, unknown>
  toolAudit?: Record<string, unknown>
  prohibitedActions: string[]
  agentCore: {
    provider: string
    mode: string
    runtimeAvailable: boolean
    nodeVersion: string
    llm?: {
      provider?: string
      configured?: boolean
      keySource?: string | null
      model?: string
      plannerAvailable?: boolean
      plannerMode?: string
      secretsRedacted?: boolean
    }
    summarySynthesis?: {
      source: 'llm' | 'deterministic'
      model?: string
    }
    note: string
  }
  notTradingAdvice: true
}

type ChatError = {
  title: string
  description: string
  recoveryActions: string[]
}

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  response?: ChatResponse
  error?: ChatError
}

type ChatSessionSnapshot = {
  schemaVersion: 'fams.chat.session_snapshot.v1'
  conversationId: string
  status: 'audited' | 'missing'
  messages?: Array<{
    id: string
    role: 'user' | 'assistant' | 'tool'
    text: string
    response?: ChatResponse
  }>
  summary?: string
}

type DataHealthState = {
  status: 'ok' | 'warning' | 'critical'
  title: string
  description: string
  recoveryActions: string[]
}

type DailyReviewHistory = {
  schemaVersion: 'fams.daily-portfolio-review-list.v1'
  items: Array<{
    id: string
    sessionType: string
    triggerSource: string
    status: string
    generatedAt: string
    completedAt: string | null
    portfolio: { reviewedAssets?: number; totalValue?: number } | null
    strategyAssessment: { status?: string; conclusion?: string } | null
    dataQuality: Record<string, unknown>
    counts: { gridPlans: number; marketSnapshots: number; positionSnapshots: number }
  }>
  nextCursor: string | null
  hasMore: boolean
}

const CHAT_SESSION_STORAGE_KEY = 'fams.chat.conversationId'

const welcomeTaskCards = [
  {
    id: 'daily_review',
    title: '生成当前持仓复盘',
    description: '查询最新价与30日收盘价，绘制 MA5/MA10/MA30，并复核策略和人工网格。',
    prompt: '现在生成一次当前持仓复盘',
    icon: <FileSearchOutlined />,
    tone: 'blue',
  },
  {
    id: 'portfolio_compare',
    title: '对比组合策略',
    description: '比较永久组合与全天候组合最近三年收益、最大回撤和曲线。',
    prompt: '对比永久组合和全天候组合最近三年的收益和最大回撤并画图',
    icon: <BarChartOutlined />,
    tone: 'blue',
  },
  {
    id: 'dividend_low_vol',
    title: '看红利低波候选',
    description: '找出当前红利低波前三候选，并解释为什么只是研究候选。',
    prompt: '帮我看红利低波前三只候选',
    icon: <FileSearchOutlined />,
    tone: 'green',
  },
  {
    id: 'trade_blocker',
    title: '解释为什么不能交易',
    description: '查看 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 被阻断的原因。',
    prompt: '为什么不能下单',
    icon: <SafetyCertificateOutlined />,
    tone: 'amber',
  },
  {
    id: 'operation_status',
    title: '查看任务和审计',
    description: '检查最近任务状态、失败原因和可追溯的审计证据。',
    prompt: '查看最近任务状态',
    icon: <DatabaseOutlined />,
    tone: 'slate',
  },
  {
    id: 'single_symbol_zone',
    title: '解释单票观察区间',
    description: '用 600887 示例查看买入观察区、卖出观察区和价格可信度。',
    prompt: '600887 现在处于什么买卖观察区间',
    icon: <QuestionCircleOutlined />,
    tone: 'purple',
  },
]

declare global {
  interface WindowEventMap {
    'fams-chat:ask': CustomEvent<{ message?: string; autoSend?: boolean }>
  }
}

async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return response.json() as Promise<T>
}

function normalizeChatError(error: unknown): ChatError {
  const raw = error instanceof Error ? error.message : String(error)
  const status = raw.match(/HTTP\s+(\d+)/)?.[1]
  if (status) {
    return {
      title: 'ChatBox 暂时无法完成请求',
      description: `后端返回 ${status}。这通常表示服务未启动、数据接口不可用，或当前请求被系统保护规则拒绝。`,
      recoveryActions: ['确认后端服务已启动', '稍后重试当前问题', '打开任务中心查看最近失败原因'],
    }
  }
  return {
    title: 'ChatBox 请求失败',
    description: raw || '未知错误。系统没有返回可用的业务结果。',
    recoveryActions: ['重试当前问题', '确认网络与后端服务状态', '在任务中心查看审计记录'],
  }
}

function metricColor(status?: ChatMetricCard['status']) {
  if (status === 'good') return 'border-emerald-200 bg-emerald-50 text-emerald-950'
  if (status === 'warning') return 'border-amber-200 bg-amber-50 text-amber-950'
  if (status === 'blocked') return 'border-red-200 bg-red-50 text-red-950'
  return 'border-slate-200 bg-white text-slate-950'
}

function inferDataHealth(response?: ChatResponse, error?: ChatError): DataHealthState {
  if (error) {
    return {
      status: 'critical',
      title: error.title,
      description: error.description,
      recoveryActions: error.recoveryActions,
    }
  }
  if (!response) {
    return {
      status: 'warning',
      title: '等待业务结果',
      description: '还没有可用于判断的数据证据。',
      recoveryActions: ['选择一个任务卡开始查询'],
    }
  }
  const dataQuality = response.dataQualitySummary || response.structuredResult?.dataQualitySummary || {}
  const serialized = JSON.stringify({ dataQuality, blockedReasons: response.blockedReasons }).toLowerCase()
  if (response.blockedReasons.length || /insufficient|missing|failed|critical|blocked|unavailable/.test(serialized)) {
    return {
      status: 'warning',
      title: '数据或规则存在限制',
      description: '本次结果包含阻断原因、数据不足或验证限制。系统会保留研究结果，但不会升级为正式交易动作。',
      recoveryActions: ['查看证据详情', '打开对应专家页复核完整指标', '不要把本结果当作正式交易指令'],
    }
  }
  return {
    status: 'ok',
    title: '数据可用于研究展示',
    description: '本次结果包含结构化指标或审计证据；仍然只用于研究、比较和人工计划草案。',
    recoveryActions: ['查看关键数字', '打开专家页查看完整证据'],
  }
}

function splitReply(reply: string) {
  const lines = reply.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  return {
    conclusion: lines[0] || reply || '已完成查询。',
    details: lines.slice(1),
  }
}

const blockerLabels: Record<string, string> = {
  material_change_requires_review: '基本面或消息变化需要人工复核',
  order_size_below_minimum_lot_or_available_budget: '计划数量低于最小交易单位或可用预算不足',
  daily_review_missing: '尚未生成持仓复盘',
  data_health_attention_required: '数据健康状态需要关注',
  chatbox_tool_execution_failed: '业务查询执行失败',
  formal_trading_locked: '正式交易未解锁',
  auto_trade_locked: '自动交易已锁定',
  chatbox_order_creation_disabled: 'ChatBox 禁止创建订单',
  manual_review_required: '需要人工复核',
}

function blockerLabel(reason: string) {
  return blockerLabels[reason] || reason.replace(/[_:]+/g, ' ')
}

function chartOption(chart: ChatStructuredResult['charts'][number]) {
  return {
    backgroundColor: 'transparent',
    color: ['#2563eb', '#059669', '#d97706', '#7c3aed', '#dc2626', '#64748b'],
    tooltip: { trigger: 'axis' },
    grid: { left: 44, right: 12, top: 34, bottom: 28 },
    legend: { top: 0, textStyle: { color: '#475569', fontSize: 10 } },
    xAxis: { type: chart.xAxisType === 'time' ? 'time' : 'category', axisLabel: { color: '#64748b', fontSize: 10 }, axisLine: { lineStyle: { color: '#cbd5e1' } } },
    yAxis: { type: 'value', name: chart.yAxisLabel, nameTextStyle: { color: '#64748b', fontSize: 10 }, axisLabel: { color: '#64748b', fontSize: 10 }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
    series: chart.series.map((series) => ({
      name: series.name,
      type: 'line',
      showSymbol: false,
      smooth: true,
      data: series.data,
    })),
  }
}

function WelcomeTaskBoard({ onSelect, disabled }: { onSelect: (prompt: string) => void; disabled: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-950">今天先看什么</div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            普通用户从这里开始；资深用户仍可打开左侧专家模块查看完整证据。
          </div>
        </div>
        <Tag color="blue">ChatBox 第一入口</Tag>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {welcomeTaskCards.map((task) => (
          <button
            key={task.id}
            type="button"
            disabled={disabled}
            onClick={() => onSelect(task.prompt)}
            className="group rounded-lg border border-slate-200 bg-slate-50 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-blue-600 shadow-sm">
                {task.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-950">{task.title}</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">{task.description}</span>
              </span>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function DataHealthNotice({ health }: { health: DataHealthState }) {
  const alertType = health.status === 'ok' ? 'success' : health.status === 'critical' ? 'error' : 'warning'
  return (
    <Alert
      className="mt-3"
      type={alertType}
      showIcon
      message={health.title}
      description={(
        <div className="space-y-2">
          <div>{health.description}</div>
          {health.recoveryActions.length ? (
            <div className="flex flex-wrap gap-1">
              {health.recoveryActions.map((action) => (
                <Tag key={action}>{action}</Tag>
              ))}
            </div>
          ) : null}
        </div>
      )}
    />
  )
}

function StructuredResultRenderer({ result }: { result: ChatStructuredResult }) {
  const table = result.comparisonTable
  const metrics = result.keyNumbers?.length ? result.keyNumbers : result.metricCards
  return (
    <div className="mt-3 space-y-3">
      {result.summary ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-950">
          {result.summary}
        </div>
      ) : null}
      {metrics.length ? (
        <div className="grid grid-cols-2 gap-2">
          {metrics.map((metric) => (
            <div key={`${metric.label}-${metric.value}`} className={`rounded-lg border px-3 py-2 ${metricColor(metric.status)}`}>
              <div className="text-[11px] text-slate-500">{metric.label}</div>
              <div className="mt-1 break-words text-sm font-semibold">{metric.value ?? 'n/a'}{metric.unit || ''}</div>
              {metric.description ? <div className="mt-1 text-[11px] leading-4 text-slate-500">{metric.description}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      {result.nextActions?.length ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <div className="text-xs font-medium text-slate-500">建议下一步</div>
          <div className="mt-1 flex flex-wrap gap-1">
            {result.nextActions.slice(0, 5).map((action) => <Tag key={action} color="blue">{action}</Tag>)}
          </div>
        </div>
      ) : null}

      {result.dailyReview ? <DailyReviewDetails details={result.dailyReview} /> : null}

      {!result.dailyReview && table?.rows?.length ? (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {table.columns.map((column) => (
                  <th key={column.key} className="whitespace-nowrap px-2 py-2 font-medium">{column.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, index) => (
                <tr key={index} className="border-t border-slate-100">
                  {table.columns.map((column) => (
                    <td key={column.key} className="whitespace-nowrap px-2 py-2 text-slate-700">{row[column.key] ?? '-'}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : !result.dailyReview && table?.insufficientReason ? (
        <Alert type="warning" showIcon message="表格数据不足" description={table.insufficientReason} />
      ) : null}

      {result.charts.map((chart) => (
        <div key={`${chart.type}-${chart.title}`} className="rounded-lg border border-slate-200 bg-white p-2">
          <div className="mb-1 text-xs font-medium text-slate-700">{chart.title}</div>
          <ReactECharts option={chartOption(chart)} style={{ height: 220, width: '100%' }} notMerge lazyUpdate />
        </div>
      ))}
    </div>
  )
}

function displayNumber(value: unknown, digits = 2) {
  const number = Number(value)
  return Number.isFinite(number) ? number.toFixed(digits) : '-'
}

function materialColor(level: string) {
  if (level === 'material') return 'red'
  if (level === 'watch') return 'orange'
  if (level === 'none') return 'green'
  return 'default'
}

function DailyReviewDetails({ details }: { details: DailyReviewStructuredDetails }) {
  const assessment = details.strategyAssessment
  return (
    <div className="space-y-3">
      <Alert
        type={assessment?.status === 'needs_review' ? 'warning' : assessment?.status === 'maintain' ? 'success' : 'info'}
        showIcon
        message={assessment?.conclusion || '本轮没有可用的策略总体判断'}
        description={assessment?.reasons?.length ? assessment.reasons.join('；') : `复盘编号：${details.reviewId}`}
      />

      <Collapse
        size="small"
        items={details.assets.map((asset) => ({
          key: asset.assetId,
          label: (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium text-slate-900">{asset.symbol} {asset.name}</span>
              <Tag color={materialColor(asset.materialChange.level)}>{asset.materialChange.level}</Tag>
              <Tag>{asset.recommendation.action} / {asset.recommendation.confidence}</Tag>
              <Tag color={asset.grid.orders.length ? 'blue' : 'default'}>{asset.grid.orders.length ? `${asset.grid.orders.length} 档草案` : '观察'}</Tag>
            </div>
          ),
          children: (
            <div className="space-y-3 text-xs text-slate-700">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ['最新价', `${displayNumber(asset.quote.price, 4)} ${asset.quote.currency || ''}`],
                  ['最近收盘', `${displayNumber(asset.quote.latestClose, 4)} · ${asset.quote.latestCloseDate || '-'}`],
                  ['MA5 / MA10', `${displayNumber(asset.quote.ma5, 4)} / ${displayNumber(asset.quote.ma10, 4)}`],
                  ['MA30', displayNumber(asset.quote.ma30, 4)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                    <div className="text-[11px] text-slate-500">{label}</div>
                    <div className="mt-1 font-medium text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-md bg-slate-50 px-2 py-2 leading-5">
                行情来源：{asset.quote.source || '未知'}｜时间：{asset.quote.asOf || '未知'}｜质量：{asset.quote.dataQualityStatus || '未知'}
              </div>
              <div>
                <div className="font-medium text-slate-900">基本面 / 消息变化</div>
                <div className="mt-1 leading-5">{asset.materialChange.reasons.join('；') || '没有可展示的变化原因。'}</div>
              </div>
              <div>
                <div className="font-medium text-slate-900">策略建议</div>
                <div className="mt-1 leading-5">{asset.recommendation.reasons.join('；') || '没有可展示的策略原因。'}</div>
                {asset.recommendation.risks.length ? <div className="mt-1 text-amber-700">风险：{asset.recommendation.risks.join('；')}</div> : null}
              </div>
              <div className="rounded-md border border-blue-100 bg-blue-50 px-2 py-2">
                <div className="font-medium text-blue-950">人工计划网格</div>
                <div className="mt-1 leading-5 text-blue-900">
                  {asset.grid.summary || '未生成网格。'}｜模板：{asset.grid.templateId}｜来源：{asset.grid.strategySource}
                </div>
                <div className="mt-1 text-blue-800">
                  调整：{asset.grid.adjustment.reasons.join('；') || '无'}｜有效期：{asset.grid.validUntil || '-'}
                </div>
                {asset.grid.blockers.length ? <div className="mt-1 text-amber-700">阻断：{asset.grid.blockers.join('、')}</div> : null}
                {asset.grid.orders.length ? (
                  <div className="mt-2 overflow-x-auto">
                    <table className="min-w-full text-left text-[11px]">
                      <thead><tr><th className="pr-3">方向</th><th className="pr-3">档位</th><th className="pr-3">价格</th><th className="pr-3">数量</th><th>冲突</th></tr></thead>
                      <tbody>
                        {asset.grid.orders.map((order, index) => (
                          <tr key={`${String(order.side)}-${String(order.level)}-${index}`} className="border-t border-blue-100">
                            <td className="py-1 pr-3">{String(order.side || '-')}</td>
                            <td className="pr-3">{String(order.level ?? '-')}</td>
                            <td className="pr-3">{displayNumber(order.price, 4)}</td>
                            <td className="pr-3">{displayNumber(order.quantity, 2)}</td>
                            <td>{String(order.conflictStatus || 'none')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            </div>
          ),
        }))}
      />

      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <div className="text-xs font-medium text-slate-900">需要关注的标的</div>
        <div className="mt-2 space-y-1 text-xs text-slate-600">
          {details.attentionCandidates.length
            ? details.attentionCandidates.map((candidate, index) => (
                <div key={`${String(candidate.symbol)}-${index}`}>
                  <Tag color={candidate.source === 'holding' ? 'blue' : 'purple'}>{String(candidate.source || 'unknown')}</Tag>
                  {String(candidate.symbol || '-')} {String(candidate.name || '')}：{String(candidate.reason || candidate.disposition || '-')}
                </div>
              ))
            : <div>本轮没有新增关注标的。</div>}
        </div>
      </div>

      <Alert type="info" showIcon message="全部网格都是人工计划草案" description="系统不会创建、提交或同步券商订单；请在有效期内自行复核。" />
    </div>
  )
}

function ActionCardList({ cards, loading, onCardClick }: {
  cards: ChatActionCard[]
  loading: boolean
  onCardClick: (card: ChatActionCard) => void
}) {
  if (!cards.length) return null
  return (
    <Space direction="vertical" size={8} className="mt-3 w-full">
      {cards.map((card) => (
        <Card
          key={card.id}
          size="small"
          className="border-slate-200 bg-white"
          styles={{ body: { padding: 10 } }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <Text strong className="text-slate-950">{card.title}</Text>
              <Paragraph className="!mb-0 mt-1 text-xs text-slate-500">{card.description}</Paragraph>
            </div>
            <Button
              size="small"
              icon={card.type === 'tool_confirmation' ? <CheckCircleOutlined /> : <LinkOutlined />}
              danger={card.type === 'blocked'}
              disabled={card.type === 'blocked' || loading}
              onClick={() => onCardClick(card)}
            >
              {card.type === 'tool_confirmation' ? '确认执行' : card.type === 'blocked' ? '已阻断' : '打开'}
            </Button>
          </div>
        </Card>
      ))}
    </Space>
  )
}

function AgentStatusDetails({ response }: { response?: ChatResponse }) {
  if (!response) return null
  const items = [
    {
      key: 'agent',
      label: '技术与审计详情',
      children: (
        <div className="space-y-2 text-xs leading-5 text-slate-600">
          <div>Intent：{response.intent}｜Confidence：{Math.round(response.confidence * 100)}%</div>
          <div>AgentCore：{response.agentCore.provider}｜模式：{response.agentCore.mode}｜Runtime：{response.agentCore.runtimeAvailable ? '可用' : '未确认'}</div>
          {response.agentCore.llm ? (
            <div>
              LLM：{response.agentCore.llm.configured ? `${response.agentCore.llm.provider || '-'} / ${response.agentCore.llm.model || '-'}` : '未配置'}｜
              Planner：{response.agentCore.llm.plannerAvailable ? response.agentCore.llm.plannerMode || '可用' : 'deterministic fallback'}｜
              Key：{response.agentCore.llm.keySource || '无'}（已脱敏）
            </div>
          ) : null}
          {response.artifactRefs.length ? <div>Artifact：{response.artifactRefs.join('，')}</div> : null}
          {response.structuredResult?.evidenceRefs?.length ? <div>Evidence：{response.structuredResult.evidenceRefs.slice(0, 8).join('，')}</div> : null}
          <div>禁止动作：{response.prohibitedActions.join(' / ')}</div>
        </div>
      ),
    },
  ]
  return <Collapse ghost size="small" className="mt-2" items={items} />
}

function AssistantMessage({
  item,
  loading,
  onCardClick,
  onRetry,
}: {
  item: ChatMessage
  loading: boolean
  onCardClick: (card: ChatActionCard) => void
  onRetry: (text: string) => void
}) {
  const { conclusion, details } = splitReply(item.text)
  const health = inferDataHealth(item.response, item.error)
  const blockedReasons = item.response?.blockedReasons || []
  const nextActions = item.response?.actionCards?.length
    ? item.response.actionCards.map((card) => card.title)
    : item.error?.recoveryActions || ['继续追问', '打开相关专家页复核']
  const summarySynthesis = item.response?.agentCore.summarySynthesis
  const detailItems = item.response?.structuredResult ? [{
    key: 'structured-result',
    label: '查看详细数据、走势图与审计证据',
    children: (
      <div>
        <DataHealthNotice health={health} />
        <StructuredResultRenderer result={item.response.structuredResult} />
      </div>
    ),
  }] : []

  return (
    <div className="w-full max-w-full rounded-xl border border-slate-200 bg-white px-4 py-4 text-slate-800 shadow-sm">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
          <RobotOutlined />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-xs font-medium text-slate-500">摘要结论</div>
            {summarySynthesis ? (
              <Tag color={summarySynthesis.source === 'llm' ? 'blue' : 'default'}>
                {summarySynthesis.source === 'llm' ? 'LLM 已重新整理' : '规则摘要'}
              </Tag>
            ) : null}
          </div>
          <Paragraph className="!mb-0 mt-2 whitespace-pre-wrap text-[15px] font-medium leading-7 text-slate-950">{conclusion}</Paragraph>
          {details.length ? (
            <div className="mt-2 rounded-lg bg-slate-50 p-2">
              <div className="text-xs font-medium text-slate-500">关键数字 / 说明</div>
              <ul className="mb-0 mt-1 list-disc space-y-1 pl-4 text-xs leading-5 text-slate-600">
                {details.slice(0, 5).map((line) => <li key={line}>{line.replace(/^(重点|建议关注|风险边界|下一步)[:：]\s*/, '')}</li>)}
              </ul>
            </div>
          ) : null}
          <div className="mt-2 rounded-lg bg-blue-50 p-2">
            <div className="text-xs font-medium text-blue-800">下一步</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {nextActions.slice(0, 4).map((action) => <Tag key={action} color="blue">{action}</Tag>)}
            </div>
          </div>
          {blockedReasons.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
            {blockedReasons.map((reason) => (
                <Tag key={reason} color="red">{blockerLabel(reason)}</Tag>
              ))}
            </div>
          ) : null}
          {item.error || (item.response && health.status !== 'ok') ? <DataHealthNotice health={health} /> : null}
          {detailItems.length ? <Collapse className="mt-3" size="small" items={detailItems} /> : null}
          <ActionCardList cards={item.response?.actionCards || []} loading={loading} onCardClick={onCardClick} />
          <AgentStatusDetails response={item.response} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              size="small"
              icon={<CopyOutlined />}
              onClick={() => {
                void navigator.clipboard?.writeText(item.text)
                antdMessage.success('已复制回复')
              }}
            >
              复制
            </Button>
            <Button size="small" icon={<ThunderboltOutlined />} onClick={() => onRetry(item.text)} disabled={loading}>
              继续追问
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function FamsChatBox() {
  const navigate = useNavigate()
  const chatTriggerRef = useRef<ElementRef<typeof FloatButton>>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [input, setInput] = useState('')
  const [conversationId, setConversationId] = useState<string>()
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      text: '我是 FAMS 业务助手。你可以生成开盘后/收盘前持仓复盘、查看 MA 走势图与人工计划网格，也可以上传持仓、成交或委托截图；所有写入都会先预览或确认。',
    },
  ])
  const [loading, setLoading] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [reviewHistory, setReviewHistory] = useState<DailyReviewHistory>()

  const latestAgentCore = useMemo(() => {
    const latest = [...messages].reverse().find((item) => item.response?.agentCore)
    return latest?.response?.agentCore
  }, [messages])

  useEffect(() => {
    if (!open) return
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [loading, messages, open])

  const sendMessage = useCallback(async (text?: string) => {
    const content = (text ?? input).trim()
    if (!content || loading) return
    setInput('')
    const userMessage: ChatMessage = { id: `user-${Date.now()}`, role: 'user', text: content }
    setMessages((current) => [...current, userMessage])
    setLoading(true)
    try {
      const response = await postJson<ChatResponse>('/api/v1/chat/messages', {
        conversationId,
        userId: 'default',
        message: content,
      })
      setConversationId(response.conversationId)
      window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, response.conversationId)
      setMessages((current) => [
        ...current,
        {
          id: response.messageId,
          role: 'assistant',
          text: response.reply,
          response,
        },
      ])
    } catch (error) {
      const chatError = normalizeChatError(error)
      setMessages((current) => [
        ...current,
        {
          id: `error-${Date.now()}`,
          role: 'assistant',
          text: `${chatError.title}：${chatError.description}`,
          error: chatError,
        },
      ])
    } finally {
      setLoading(false)
    }
  }, [conversationId, input, loading])

  useEffect(() => {
    const savedConversationId = window.localStorage.getItem(CHAT_SESSION_STORAGE_KEY)
    if (!savedConversationId) return
    let cancelled = false
    const restoreSession = async () => {
      try {
        const snapshot = await getJson<ChatSessionSnapshot>(`/api/v1/chat/sessions/${encodeURIComponent(savedConversationId)}`)
        if (cancelled || snapshot.status !== 'audited') return
        setConversationId(snapshot.conversationId)
        const restored = (snapshot.messages || [])
          .filter((item) => item.role === 'user' || item.role === 'assistant')
          .map((item) => ({
            id: item.id,
            role: item.role as 'user' | 'assistant',
            text: item.text,
            response: item.response,
          }))
        if (restored.length > 0) {
          setMessages([
            {
              id: 'welcome-restored',
              role: 'assistant',
              text: snapshot.summary || '已恢复最近 ChatBox 会话。正式交易动作仍被阻断。',
            },
            ...restored,
          ])
        }
      } catch {
        window.localStorage.removeItem(CHAT_SESSION_STORAGE_KEY)
      }
    }
    void restoreSession()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const handler = (event: WindowEventMap['fams-chat:ask']) => {
      const message = event.detail?.message?.trim()
      setOpen(true)
      if (!message) return
      if (event.detail?.autoSend) {
        void sendMessage(message)
      } else {
        setInput(message)
      }
    }
    window.addEventListener('fams-chat:ask', handler)
    return () => window.removeEventListener('fams-chat:ask', handler)
  }, [sendMessage])

  const confirmTool = async (confirmationId: string) => {
    if (loading) return
    setLoading(true)
    try {
      const response = await postJson<ChatResponse>('/api/v1/chat/tool-confirmations', {
        userId: 'default',
        conversationId,
        confirmationId,
      })
      setConversationId(response.conversationId)
      window.localStorage.setItem(CHAT_SESSION_STORAGE_KEY, response.conversationId)
      setMessages((current) => [
        ...current,
        {
          id: response.messageId,
          role: 'assistant',
          text: response.reply,
          response,
        },
      ])
    } catch (error) {
      const chatError = normalizeChatError(error)
      setMessages((current) => [
        ...current,
        {
          id: `confirm-error-${Date.now()}`,
          role: 'assistant',
          text: `${chatError.title}：${chatError.description}`,
          error: chatError,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleCardClick = (card: ChatActionCard) => {
    if (card.type === 'navigation' && card.href) {
      navigate(card.href)
      setOpen(false)
      return
    }
    if (card.type === 'tool_confirmation' && card.confirmationId) {
      confirmTool(card.confirmationId)
    }
  }

  const handleCaptureEvent = (event: ScreenshotCaptureEvent) => {
    const text = event.type === 'saved'
      ? `账户截图 ${event.filename || event.captureId} 已私有保存，尚未发送给视觉模型。`
      : event.type === 'extracted'
        ? `已明确同意本次视觉识别：${event.filename || event.captureId}，共 ${event.rowCount ?? 0} 行；确认前不会写入台账。`
        : `截图台账已人工确认 ${event.rowCount ?? 0} 行；缺失持仓未被自动关闭。`
    setMessages((current) => [...current, { id: `capture-${event.type}-${Date.now()}`, role: 'assistant', text }])
  }

  const loadReviewHistory = async () => {
    if (historyLoading) return
    setHistoryOpen(true)
    setHistoryLoading(true)
    try {
      setReviewHistory(await getJson<DailyReviewHistory>('/api/v1/daily-reviews?userId=default&limit=20'))
    } catch (error) {
      antdMessage.error(error instanceof Error ? error.message : '读取历史复盘失败')
    } finally {
      setHistoryLoading(false)
    }
  }

  return (
    <>
      <FloatButton
        ref={chatTriggerRef}
        type="primary"
        icon={<RobotOutlined />}
        tooltip="FAMS 业务助手"
        aria-label="打开 FAMS ChatBox"
        data-testid="fams-chatbox-trigger"
        onClick={() => setOpen(true)}
        className="right-5 bottom-5"
      />
      <Drawer
        title={
          <Space className="min-w-0">
            <RobotOutlined />
            <span>FAMS 业务助手</span>
            <Tag color="blue">研究模式</Tag>
          </Space>
        }
        placement="right"
        width={expanded ? 'calc(100vw - 24px)' : 'min(1120px, calc(100vw - 24px))'}
        rootClassName="fams-chat-drawer"
        open={open}
        keyboard
        onClose={() => setOpen(false)}
        afterOpenChange={(visible) => { if (!visible) chatTriggerRef.current?.focus() }}
        extra={(
          <Space wrap align="start">
            <OpenInExternalBrainButton
              entryId="chatbox"
              label="在外部大脑打开"
              size="small"
              request={{ entryAction: 'open_workspace', routeIntent: 'ask', routePayload: { workspaceId: PX_DEFAULT_WORKSPACE_ID } }}
            />
            <Button
              type="text"
              icon={expanded ? <CompressOutlined /> : <ExpandOutlined />}
              onClick={() => setExpanded((current) => !current)}
            >
              {expanded ? '恢复宽度' : '展开工作区'}
            </Button>
          </Space>
        )}
        styles={{ body: { padding: 18, background: '#f8fafc' }, header: { background: '#ffffff', borderBottomColor: '#e2e8f0' } }}
      >
        <div className="flex h-full min-h-0 flex-col gap-3 text-slate-900">
          <Alert
            type="info"
            showIcon
            icon={<SafetyCertificateOutlined />}
            message="ChatBox 不创建订单"
            description="允许研究、观察、比较、提醒和人工计划草案；正式 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 始终受交易 gate 阻断。"
          />

          {messages.length <= 1 ? (
            <div className="space-y-2">
              <WelcomeTaskBoard onSelect={(prompt) => sendMessage(prompt)} disabled={loading} />
              <Button size="small" icon={<HistoryOutlined />} onClick={loadReviewHistory} loading={historyLoading}>查看历史复盘</Button>
            </div>
          ) : (
            <Collapse
              size="small"
              items={[{
                key: 'quick-actions',
                label: '快捷提问与历史复盘',
                children: (
                  <div className="space-y-2">
                    <WelcomeTaskBoard onSelect={(prompt) => sendMessage(prompt)} disabled={loading} />
                    <Button size="small" icon={<HistoryOutlined />} onClick={loadReviewHistory} loading={historyLoading}>查看历史复盘</Button>
                  </div>
                ),
              }]}
            />
          )}

          <div className="min-h-[320px] flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
            <Space direction="vertical" size={12} className="w-full">
              {messages.map((item) => (
                <div key={item.id} className={`flex ${item.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {item.role === 'user' ? (
                    <div className="max-w-[88%] rounded-xl bg-blue-600 px-3 py-2 text-white shadow-sm">
                      <Paragraph className="!mb-0 whitespace-pre-wrap text-inherit">{item.text}</Paragraph>
                    </div>
                  ) : (
                    <AssistantMessage
                      item={item}
                      loading={loading}
                      onCardClick={handleCardClick}
                      onRetry={(text) => setInput(`继续解释：${text.slice(0, 120)}`)}
                    />
                  )}
                </div>
              ))}
              {loading ? (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <Spin size="small" />
                  正在调用白名单工具并生成结构化结果...
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </Space>
          </div>

          <Space.Compact className="w-full">
            <Input.TextArea
              value={input}
              autoSize={{ minRows: 2, maxRows: 6 }}
              placeholder="例如：帮我对比永久组合和全天候组合最近三年"
              onChange={(event) => setInput(event.target.value)}
              onPressEnter={(event) => {
                if (!event.shiftKey) {
                  event.preventDefault()
                  sendMessage()
                }
              }}
            />
            <Button type="primary" icon={<SendOutlined />} onClick={() => sendMessage()} loading={loading}>
              发送
            </Button>
          </Space.Compact>

          <details className="rounded-lg border border-slate-200 bg-white text-xs text-slate-600">
            <summary className="cursor-pointer px-3 py-2 font-medium text-slate-700">导入截图（持仓 / 成交 / 委托）</summary>
            <div className="border-t border-slate-100 px-3 py-3">
              <ScreenshotCapturePanel userId="default" conversationId={conversationId} compact onEvent={handleCaptureEvent} />
            </div>
          </details>

          <details className="rounded-lg bg-white px-3 py-2 text-xs leading-5 text-slate-500">
            <summary className="cursor-pointer font-medium text-slate-600">Agent 与 LLM 技术状态</summary>
            <div className="mt-2">
            AgentCore：{latestAgentCore?.provider || 'pi-agent-core'}｜
            模式：{latestAgentCore?.mode || 'deterministic_planner'}｜
            Runtime：{latestAgentCore?.runtimeAvailable === false ? '未确认' : '可用'}。
            {latestAgentCore?.llm ? (
              <>
                <br />
                LLM：{latestAgentCore.llm.configured ? `${latestAgentCore.llm.provider || '-'} / ${latestAgentCore.llm.model || '-'}` : '未配置'}｜
                Planner：{latestAgentCore.llm.plannerAvailable ? latestAgentCore.llm.plannerMode || '可用' : 'deterministic fallback'}｜
                Key：{latestAgentCore.llm.keySource || '无'}（已脱敏）
              </>
            ) : null}
            技术细节会在每条回复下方折叠展示。
            </div>
          </details>
        </div>
      </Drawer>
      <Modal
        title="历史持仓复盘"
        open={historyOpen}
        width={760}
        footer={<Button onClick={() => setHistoryOpen(false)}>关闭</Button>}
        onCancel={() => setHistoryOpen(false)}
      >
        {historyLoading ? <div className="py-8 text-center"><Spin /></div> : (
          <div className="max-h-[560px] space-y-2 overflow-y-auto">
            {reviewHistory?.items.length ? reviewHistory.items.map((item) => (
              <Card key={item.id} size="small">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-slate-900">{new Date(item.generatedAt).toLocaleString('zh-CN')}｜{item.sessionType}</div>
                    <div className="mt-1 text-xs text-slate-500">复盘编号：{item.id}</div>
                  </div>
                  <Tag color={item.status === 'completed' ? 'green' : item.status === 'partial' ? 'orange' : 'red'}>{item.status}</Tag>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                  <div>复盘资产：{item.portfolio?.reviewedAssets ?? 0}</div>
                  <div>组合市值：{displayNumber(item.portfolio?.totalValue)}</div>
                  <div>网格方案：{item.counts.gridPlans}</div>
                  <div>持仓快照：{item.counts.positionSnapshots}</div>
                </div>
                <div className="mt-2 rounded-md bg-slate-50 px-2 py-2 text-xs text-slate-600">
                  {item.strategyAssessment?.conclusion || '该轮没有策略总体结论。'}
                </div>
                <Button
                  className="mt-2"
                  size="small"
                  type="link"
                  icon={<HistoryOutlined />}
                  onClick={() => {
                    setHistoryOpen(false)
                    setOpen(false)
                    navigate(`/daily-reviews/${item.id}`)
                  }}
                >
                  打开十节点工作台
                </Button>
              </Card>
            )) : <Alert type="info" showIcon message="还没有历史持仓复盘" />}
          </div>
        )}
      </Modal>
    </>
  )
}
