export type FamsChatToolRisk = 'read' | 'compute' | 'confirm_required' | 'blocked'
export type FamsChatPermissionType = 'read_only_direct' | 'compute_quick_run' | 'confirm_before_operation' | 'permanently_blocked'

export type FamsChatIntent =
  | 'dividend_low_vol_top_candidates'
  | 'dividend_low_vol_trading_zone'
  | 'dividend_low_vol_scan'
  | 'dividend_low_vol_plan_draft'
  | 'refresh_data'
  | 'portfolio_summary'
  | 'daily_review_latest'
  | 'daily_review_run'
  | 'portfolio_risk_explain'
  | 'portfolio_backtest_compare'
  | 'portfolio_backtest_operation'
  | 'portfolio_backtest_explain'
  | 'manual_trade_draft'
  | 'operation_status'
  | 'audit_report_explain'
  | 'data_trust_explain'
  | 'navigate_to_page'
  | 'trade_action_blocked'
  | 'capability_help'

export interface FamsChatActionCard {
  id: string
  type: 'navigation' | 'tool_confirmation' | 'artifact' | 'blocked' | 'result'
  title: string
  description: string
  href?: string
  method?: 'GET' | 'POST'
  endpoint?: string
  body?: Record<string, unknown>
  toolName?: string
  confirmationId?: string
  status?: 'ready' | 'requires_confirmation' | 'blocked' | 'completed'
}

export interface FamsChatMetricCard {
  label: string
  value: string | number | null
  unit?: string
  status?: 'good' | 'warning' | 'blocked' | 'neutral'
  description?: string
}

export interface FamsChatComparisonColumn {
  key: string
  label: string
}

export interface FamsChatChartSeries {
  name: string
  data: Array<[string, number | null]>
}

export interface FamsChatChartPayload {
  type: 'line_chart' | 'drawdown_chart'
  title: string
  xAxisType: 'time' | 'category'
  yAxisLabel: string
  series: FamsChatChartSeries[]
}

export interface FamsDailyReviewStructuredDetails {
  reviewId: string
  generatedAt: string
  completedAt?: string
  sessionType: string
  strategyAssessment: {
    status: string
    conclusion: string
    reasons: string[]
  } | null
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
    materialChange: {
      level: string
      reasons: string[]
      evidenceRefs: string[]
    }
    recommendation: {
      action: string
      confidence: string
      reasons: string[]
      risks: string[]
    }
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
  reconciliation?: Record<string, unknown>
  executionBoundary: Record<string, boolean>
}

export interface FamsChatStructuredResult {
  answerLevel?: 'plain_language'
  summary?: string
  keyNumbers?: FamsChatMetricCard[]
  nextActions?: string[]
  dataHealth?: Record<string, unknown>
  technicalDetailsCollapsed?: true
  prohibitedActions?: string[]
  resultType:
    | 'strategy_comparison'
    | 'candidate_ranking'
    | 'trading_zone'
    | 'portfolio_summary'
    | 'daily_review'
    | 'operation_status'
    | 'blocked_action'
    | 'plain_text'
  metricCards: FamsChatMetricCard[]
  comparisonTable: {
    columns: FamsChatComparisonColumn[]
    rows: Array<Record<string, string | number | null>>
    insufficientReason?: string
  }
  charts: FamsChatChartPayload[]
  dataQualitySummary?: Record<string, unknown>
  dailyReview?: FamsDailyReviewStructuredDetails
  evidenceRefs: string[]
  blockedReasons: string[]
  notTradingAdvice: true
}

export interface FamsChatResponse {
  schemaVersion: 'fams.chat.response.v1'
  generatedAt: string
  conversationId: string
  messageId: string
  reply: string
  intent: FamsChatIntent
  confidence: number
  actionCards: FamsChatActionCard[]
  requiresConfirmation: boolean
  operationId?: string
  artifactRefs: string[]
  blockedReasons: string[]
  structuredResult?: FamsChatStructuredResult
  dataQualitySummary?: Record<string, unknown>
  toolAudit?: Record<string, unknown>
  allowedActions: string[]
  prohibitedActions: string[]
  agentCore: {
    provider: 'pi-agent-core'
    mode: 'deterministic_planner' | 'llm_assisted_planner_pending' | 'pi_agent_loop'
    runtimeAvailable: boolean
    nodeVersion: string
    llm?: Record<string, unknown>
    summarySynthesis?: {
      source: 'llm' | 'deterministic'
      model?: string
    }
    note: string
  }
  notTradingAdvice: true
}

export interface FamsChatStreamEvent {
  schemaVersion: 'fams.chat.stream_event.v1'
  generatedAt: string
  conversationId: string
  eventId: string
  type: 'start' | 'status' | 'tool_result' | 'final' | 'error'
  message: string
  response?: FamsChatResponse
  allowedActions: string[]
  prohibitedActions: string[]
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  canCreateOrder: false
  orderCreateAllowed: false
  notTradingAdvice: true
}

export interface FamsChatMessageInput {
  conversationId?: string
  userId?: string
  message: string
  context?: Record<string, unknown>
}

export interface FamsChatConfirmationInput {
  userId?: string
  conversationId?: string
  confirmationId: string
}

export interface FamsChatTool {
  name: string
  intent: FamsChatIntent
  label: string
  description: string
  risk: FamsChatToolRisk
  permissionType: FamsChatPermissionType
  confirmationPolicy: 'none' | 'required' | 'blocked'
  auditFields: string[]
  execute: (args: Record<string, unknown>) => Promise<{
    reply: string
    actionCards?: FamsChatActionCard[]
    operationId?: string
    artifactRefs?: string[]
    blockedReasons?: string[]
    structuredResult?: FamsChatStructuredResult
    dataQualitySummary?: Record<string, unknown>
    toolAudit?: Record<string, unknown>
  }>
}
