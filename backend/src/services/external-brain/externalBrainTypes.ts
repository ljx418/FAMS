export const EXTERNAL_BRAIN_RESPONSE_SCHEMA_VERSION = 'fams.external-brain.response.v1' as const
export const EXTERNAL_BRAIN_ASK_SCHEMA_VERSION = 'fams.external-brain.ask-request.v1' as const
export const DEFAULT_EXTERNAL_BRAIN_USER_ID = 'default' as const

export const EXTERNAL_BRAIN_ALLOWED_ACTIONS = ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT'] as const
export const EXTERNAL_BRAIN_PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const

export type ExternalBrainSourceKind = 'operation_artifact' | 'daily_review_evidence'
export type ExternalBrainFreshnessStatus = 'fresh' | 'stale' | 'unknown'
export type ExternalBrainTrustStatus = 'available' | 'partial' | 'blocked' | 'missing'
export type ExternalBrainResponseStatus = 'ok' | 'accepted' | 'empty' | 'blocked' | 'unavailable'

export interface ExternalBrainExecutionBoundary {
  researchOnly: true
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  canCreateOrder: false
  orderCreateAllowed: false
}

export interface ExternalBrainEvidenceRef {
  ref: string
  kind: 'artifact' | 'review' | 'operation' | 'browser'
  asOf?: string
}

export interface ExternalBrainWarning {
  code: string
  message: string
  recoverable: boolean
}

export interface ExternalBrainResponse<T> {
  schemaVersion: typeof EXTERNAL_BRAIN_RESPONSE_SCHEMA_VERSION
  requestId: string
  generatedAt: string
  status: ExternalBrainResponseStatus
  data: T | null
  evidenceRefs: ExternalBrainEvidenceRef[]
  warnings: ExternalBrainWarning[]
  executionBoundary: ExternalBrainExecutionBoundary
}

export interface ExternalBrainSourceSummary {
  sourceRef: string
  kind: ExternalBrainSourceKind
  title: string
  summary: string
  asOf: string
  freshnessStatus: ExternalBrainFreshnessStatus
  trustStatus: ExternalBrainTrustStatus
  operationId?: string
  reviewId?: string
}

export interface ExternalBrainSourcePage {
  items: ExternalBrainSourceSummary[]
  nextCursor: string | null
}

export interface ExternalBrainSourceDetail extends ExternalBrainSourceSummary {
  sourceSystem: 'FAMS.Operation.artifactRefsJson' | 'FAMS.DailyReviewRun.reportJson.evidenceRefs'
  relatedOperationId?: string
  relatedReviewId?: string
  evidenceRefs: string[]
  displaySections: Array<{ id: string; title: string; items: Array<{ label: string; value: string; evidenceRef?: string }> }>
}

export interface ExternalBrainAskRequest {
  schemaVersion: typeof EXTERNAL_BRAIN_ASK_SCHEMA_VERSION
  workspaceId: string
  conversationId?: string
  question: string
  contextRefs: string[]
  idempotencyKey: string
}

export interface ExternalBrainAskResult {
  conversationId: string
  messageId: string
  summary: string
  keyEvidence: string[]
  dataAsOf: string
  confidence: number
  nextActions: string[]
  operationId?: string
  artifactRefs: string[]
  prohibitedActions: readonly string[]
  notTradingAdvice: true
}

export interface ExternalBrainTrace {
  operationId: string
  type: string
  status: string
  progressPct: number
  requestedAt: string
  startedAt?: string
  completedAt?: string
  tasks: Array<{
    id: string
    name: string
    status: string
    startedAt?: string
    completedAt?: string
    durationMs?: number
    successCount: number
    failureCount: number
  }>
  artifactRefs: string[]
  errorSummary?: string
  recoverySummary?: string
}

export interface ExternalBrainGraph {
  graphId: string
  scope: 'daily-review' | 'operation'
  status: string
  nodes: Array<{
    id: string
    label: string
    status: string
    sequence?: number
    inputsSummary: string[]
    outputsSummary: string[]
    evidenceRefs: string[]
  }>
  edges: Array<{ id: string; source: string; target: string }>
  evidenceRefs: string[]
}

export interface ExternalBrainErrorEnvelope {
  schemaVersion: typeof EXTERNAL_BRAIN_RESPONSE_SCHEMA_VERSION
  requestId: string
  error: { code: string; userMessage: string; recoverable: boolean; requestId: string }
  executionBoundary: ExternalBrainExecutionBoundary
}

export const LOCKED_EXECUTION_BOUNDARY: ExternalBrainExecutionBoundary = Object.freeze({
  researchOnly: true,
  formalTradingUnlocked: false,
  autoTradeUnlocked: false,
  canCreateOrder: false,
  orderCreateAllowed: false,
})
