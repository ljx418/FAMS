export type ExecutionBoundary = {
  researchOnly: true
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  canCreateOrder: false
  orderCreateAllowed: false
}

export type EvidenceRef = { ref: string; kind: 'artifact' | 'review' | 'operation' | 'browser'; asOf?: string }
export type Warning = { code: string; message: string; recoverable: boolean }
export type ResponseStatus = 'ok' | 'accepted' | 'empty' | 'blocked' | 'unavailable'

export type ExternalBrainResponse<T> = {
  schemaVersion: 'fams.external-brain.response.v1'
  requestId: string
  generatedAt: string
  status: ResponseStatus
  data: T | null
  evidenceRefs: EvidenceRef[]
  warnings: Warning[]
  executionBoundary: ExecutionBoundary
}

export type SourceItem = {
  sourceRef: string
  kind: 'operation_artifact' | 'daily_review_evidence'
  title: string
  summary: string
  asOf: string
  freshnessStatus: 'fresh' | 'stale' | 'unknown'
  trustStatus: 'available' | 'partial' | 'blocked' | 'missing'
  operationId?: string
  reviewId?: string
}

export type SourcePage = { items: SourceItem[]; nextCursor: string | null }

export type SourceDetail = SourceItem & {
  sourceSystem: 'FAMS.Operation.artifactRefsJson' | 'FAMS.DailyReviewRun.reportJson.evidenceRefs'
  relatedOperationId?: string
  relatedReviewId?: string
  evidenceRefs: string[]
  displaySections: Array<{ id: string; title: string; items: Array<{ label: string; value: string; evidenceRef?: string }> }>
}

export type AskResult = {
  conversationId: string
  messageId: string
  summary: string
  keyEvidence: string[]
  dataAsOf: string
  confidence: number
  nextActions: string[]
  operationId?: string
  artifactRefs: string[]
  prohibitedActions: string[]
  notTradingAdvice: true
}

export type TraceResult = {
  operationId: string
  type: string
  status: string
  progressPct: number
  requestedAt: string
  startedAt?: string
  completedAt?: string
  tasks: Array<{ id: string; name: string; status: string; startedAt?: string; completedAt?: string; durationMs?: number; successCount: number; failureCount: number }>
  artifactRefs: string[]
  errorSummary?: string
  recoverySummary?: string
}

export type GraphResult = {
  graphId: string
  scope: 'daily-review' | 'operation'
  status: string
  nodes: Array<{ id: string; label: string; status: string; sequence?: number; inputsSummary: string[]; outputsSummary: string[]; evidenceRefs: string[] }>
  edges: Array<{ id: string; source: string; target: string }>
  evidenceRefs: string[]
}

type ViewPayload<TView extends string, TValue> = {
  view: TView
  status: ResponseStatus
  requestId: string
  generatedAt: string
  evidenceRefs: EvidenceRef[]
  warnings: Warning[]
  value: TValue
}

export type WorkspaceViewData =
  | ViewPayload<'source_library', SourcePage>
  | ViewPayload<'source_detail', SourceDetail>
  | ViewPayload<'ask', AskResult>
  | ViewPayload<'trace', TraceResult>
  | ViewPayload<'graph', GraphResult>

export type BackgroundCommandResponse = {
  schemaVersion: 'v2-px-background-response/1'
  commandResult: import('../../contracts/types').CommandResult
  viewData?: WorkspaceViewData
}

export class FamsApiError extends Error {
  constructor(
    readonly code: string,
    readonly userMessage: string,
    readonly recoverable: boolean,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(code)
  }
}
