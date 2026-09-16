/**
 * FAMS MCP Registry
 *
 * HTTP bridge 与后续 stdio provider 共享这一份工具注册表、manifest 和调用逻辑。
 */
import { priceService } from '../services/price/priceService.js'
import { positionService } from '../services/position/positionService.js'
import { analysisService } from '../services/analysis/analysisService.js'
import { portfolioService } from '../services/portfolio/portfolioService.js'
import { backtestService } from '../services/backtest/backtestService.js'
import { transactionService } from '../services/transaction/transactionService.js'
import { alertService } from '../services/alert/alertService.js'
import { operationService } from '../services/operation/operationService.js'
import { assetTrendService } from '../services/market-data/assetTrendService.js'
import { dailyReviewService } from '../services/review/dailyReviewService.js'
import { brokerReviewReconciliationService } from '../services/review/brokerReviewReconciliationService.js'
import { volatilityWorkflowService } from '../services/review/volatilityWorkflowService.js'
import { gridStrategyService } from '../services/strategy/gridStrategyService.js'
import { screenshotCaptureService } from '../services/capture/screenshotCaptureService.js'
import { getVisionCaptureStatus } from '../services/capture/visionCaptureService.js'
import { industryCrowdingService } from '../services/relative-rotation/industryCrowdingService.js'
import { relativeRotationService } from '../services/relative-rotation/relativeRotationService.js'
import { relativeRotationUniverseService } from '../services/relative-rotation/relativeRotationUniverseService.js'
import { relativeRotationResearchStudyService, type ResearchStudyInput } from '../services/relative-rotation/relativeRotationResearchStudyService.js'
import { z } from 'zod'

export type PermissionMetadata = {
  userContext: 'required' | 'optional' | 'none'
  scopes: string[]
  writes: boolean
  requiresHumanConfirmation: boolean
}

export type SafetyMetadata = {
  execution: 'read_only' | 'write_direct' | 'async_operation' | 'write_requires_confirmation'
  returnsOperationId: boolean
  returnsArtifactRefs: boolean
  returnsNextActions: boolean
}

export type McpToolDefinition = {
  name: string
  domain: string
  version: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema: Record<string, unknown>
  permissions: PermissionMetadata
  safety: SafetyMetadata
  aliases?: string[]
  parameterSchema?: z.ZodTypeAny
  handler: (params: any) => Promise<any>
}

export type McpCallContext = {
  requestId?: string
  transport?: 'http' | 'stdio' | 'streamable_http'
  userId?: string
  userContextSource?: 'http_header' | 'stdio_context'
}

export type McpCallEnvelope = {
  schemaVersion: 'fams.mcp.call.v1'
  success: boolean
  status: 'completed' | 'blocked' | 'failed'
  tool: {
    requestedName: string
    name?: string
    domain?: string
    version?: string
  }
  audit: {
    calledAt: string
    requestId?: string
    transport?: 'http' | 'stdio' | 'streamable_http'
    userId?: string
    userContextSource?: 'explicit_parameter' | 'http_header' | 'stdio_context'
    parameterUserId?: string
    contextUserId?: string
    writes?: boolean
    requiresHumanConfirmation?: boolean
  }
  result?: unknown
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

type HumanConfirmation = {
  confirmed?: boolean
  confirmedBy?: string
  confirmedAt?: string
  reason?: string
}

type TradeWriteParams = {
  userId: string
  assetId: string
  type: 'buy' | 'sell'
  quantity: number
  price: number
  confirmation?: HumanConfirmation
}

const successEnvelopeSchema = {
  type: 'object',
  properties: {
    schemaVersion: { type: 'string', enum: ['fams.mcp.call.v1'] },
    success: { type: 'boolean' },
    status: { type: 'string', enum: ['completed', 'blocked', 'failed'] },
    tool: { type: 'object' },
    audit: { type: 'object' },
    result: { type: 'object' },
    error: { type: ['object', 'null'] },
  },
}

const operationOutputSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    operationId: { type: 'string' },
    operation_id: { type: 'string' },
    status: { type: 'string', enum: ['queued', 'running', 'completed', 'succeeded', 'partial', 'failed', 'cancelling', 'cancelled'] },
    progressPct: { type: 'number' },
    artifactRefs: { type: 'array', items: { type: 'string' } },
    nextActions: { type: 'array', items: { type: 'object' } },
  },
  required: ['id', 'operationId', 'operation_id', 'status'],
}

const readPermission = (scopes: string[]): PermissionMetadata => ({
  userContext: 'required',
  scopes,
  writes: false,
  requiresHumanConfirmation: false,
})

const asyncPermission = (scopes: string[]): PermissionMetadata => ({
  userContext: 'required',
  scopes,
  writes: true,
  requiresHumanConfirmation: false,
})

const tradeWritePermission = (scopes: string[]): PermissionMetadata => ({
  userContext: 'required',
  scopes,
  writes: true,
  requiresHumanConfirmation: true,
})

const confirmedWritePermission = (scopes: string[]): PermissionMetadata => ({
  userContext: 'required',
  scopes,
  writes: true,
  requiresHumanConfirmation: true,
})

const readSafety: SafetyMetadata = {
  execution: 'read_only',
  returnsOperationId: false,
  returnsArtifactRefs: false,
  returnsNextActions: false,
}

const asyncOperationSafety: SafetyMetadata = {
  execution: 'async_operation',
  returnsOperationId: true,
  returnsArtifactRefs: true,
  returnsNextActions: true,
}

const directWriteSafety: SafetyMetadata = {
  execution: 'write_direct',
  returnsOperationId: false,
  returnsArtifactRefs: false,
  returnsNextActions: false,
}

const confirmedWriteSafety: SafetyMetadata = {
  execution: 'write_requires_confirmation',
  returnsOperationId: false,
  returnsArtifactRefs: false,
  returnsNextActions: true,
}

const humanConfirmationSchema = {
  type: 'object',
  description: '人工确认凭据。交易写入工具必须显式传入 confirmed=true 与确认人。',
  additionalProperties: false,
  properties: {
    confirmed: { type: 'boolean', description: '人工确认是否已完成' },
    confirmedBy: { type: 'string', description: '确认人或上游确认节点标识' },
    confirmedAt: { type: 'string', description: '确认时间，ISO 8601 字符串' },
    reason: { type: 'string', description: '确认原因或审计备注' },
  },
  required: ['confirmed', 'confirmedBy'],
}

const buildTradeConfirmationBlock = (toolName: string, params: TradeWriteParams) => ({
  blocked: true,
  requiresHumanConfirmation: true,
  code: 'HUMAN_CONFIRMATION_REQUIRED',
  message: '该 MCP 工具会写入交易流水，必须先进入人工确认节点。',
  confirmationRequired: {
    tool: toolName,
    requiredFields: ['confirmation.confirmed=true', 'confirmation.confirmedBy'],
    proposedTransaction: {
      userId: params.userId,
      assetId: params.assetId,
      type: params.type,
      quantity: params.quantity,
      price: params.price,
    },
  },
  nextActions: [
    {
      type: 'confirm_transaction_write',
      label: '人工确认后重试交易写入',
      method: 'POST',
      endpoint: '/api/v1/mcp/call',
      body: {
        name: toolName,
        parameters: {
          userId: params.userId,
          assetId: params.assetId,
          type: params.type,
          quantity: params.quantity,
          price: params.price,
          confirmation: {
            confirmed: true,
            confirmedBy: 'human',
          },
        },
      },
    },
  ],
})

const hasHumanConfirmation = (confirmation?: HumanConfirmation) => (
  confirmation?.confirmed === true && typeof confirmation.confirmedBy === 'string' && confirmation.confirmedBy.trim().length > 0
)

const deletionConfirmationSchema = z.object({
  confirmed: z.literal(true),
  confirmedBy: z.string().trim().min(1).max(120),
  confirmedAt: z.string().datetime().optional(),
  reason: z.string().trim().max(500).optional(),
}).strict()

const buildDeletionConfirmationBlock = (
  toolName: string,
  userId: string,
  identifier: Record<string, string>,
  label: string,
) => ({
  blocked: true,
  requiresHumanConfirmation: true,
  code: 'HUMAN_CONFIRMATION_REQUIRED',
  message: `删除${label}会移除研究配置或本地轮动记录，必须先经过人工确认。`,
  confirmationRequired: {
    tool: toolName,
    requiredFields: ['confirmation.confirmed=true', 'confirmation.confirmedBy'],
    target: identifier,
  },
  nextActions: [{
    type: 'confirm_relative_rotation_delete',
    label: `人工确认后删除${label}`,
    method: 'POST',
    endpoint: '/api/v1/mcp/call',
    body: {
      name: toolName,
      parameters: {
        userId,
        ...identifier,
        confirmation: { confirmed: true, confirmedBy: 'human' },
      },
    },
  }],
})

const rotationDetailSchema = z.enum(['summary', 'series']).default('summary')
const rotationFrequencySchema = z.enum(['weekly', 'daily']).default('weekly')
const rotationMarketSchema = z.enum(['CN', 'HK', 'US']).default('CN')
const tailSchema = z.number().int().min(1).max(120).default(12)
const researchStudySchema = z.object({
  name: z.string().trim().min(1).max(80),
  market: z.enum(['CN', 'HK', 'US']),
  frequency: z.enum(['weekly', 'daily']).default('weekly'),
  historyYears: z.number().int().min(1).max(10).optional(),
  benchmark: z.object({
    mode: z.enum(['market_default', 'equal_weight_targets']).optional(),
    targetKeys: z.array(z.string().trim().min(1)).max(30).optional(),
  }).strict().optional(),
  period: z.union([
    z.object({ mode: z.literal('rolling'), rollingWeeks: z.number().int().min(4).max(520).optional() }).strict(),
    z.object({ mode: z.literal('fixed'), startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict(),
  ]),
  targets: z.array(z.object({
    code: z.string().trim().min(1).max(40),
    name: z.string().trim().min(1).max(120).optional(),
    kind: z.enum(['equity', 'index']).optional(),
  }).strict()).min(1).max(30),
  comparisonTargetKeys: z.array(z.string().trim().min(1)).length(2).optional(),
}).strict()

const volatilityCaptureFields = {
  userId: z.string().trim().min(1),
  sessionType: z.enum(['open', 'pre_close', 'manual']).optional(),
  holdingsCaptureId: z.string().trim().min(1).optional(),
  tradesCaptureId: z.string().trim().min(1).optional(),
  ordinaryOrdersCaptureId: z.string().trim().min(1).optional(),
  conditionalOrdersCaptureId: z.string().trim().min(1).optional(),
  zeroNewTradesConfirmed: z.boolean().optional(),
}

const volatilityReconcileSchema = z.object(volatilityCaptureFields).strict()
const volatilityRunSchema = z.object({
  ...volatilityCaptureFields,
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
}).strict()
const volatilityResultSchema = z.object({
  userId: z.string().trim().min(1),
  operationId: z.string().trim().min(1).optional(),
  reviewId: z.string().trim().min(1).optional(),
  includeHtml: z.boolean().optional(),
}).strict().refine((value) => Number(Boolean(value.operationId)) + Number(Boolean(value.reviewId)) === 1, {
  message: 'Exactly one of operationId or reviewId is required',
  path: ['operationId'],
})

const compactRotationPoints = (points: unknown, tail: number) => (
  Array.isArray(points) ? points.slice(-tail) : []
)

const summarizeTimeline = (timeline: any, detail: 'summary' | 'series', tail: number, targetKeys: string[] = []) => {
  const requested = new Set(targetKeys)
  const items = (timeline.items || []).filter((item: any) => requested.size === 0 || requested.has(item.targetKey) || requested.has(item.symbol))
  return {
    schemaVersion: timeline.schemaVersion,
    generatedAt: timeline.generatedAt,
    universe: timeline.universe,
    market: timeline.market,
    benchmark: timeline.benchmark,
    formulaVersion: timeline.formulaVersion,
    frequency: timeline.frequency,
    visibleRange: timeline.visibleRange,
    availableDateCount: timeline.availableDateCount,
    eligibleCount: timeline.eligibleCount,
    readyCount: timeline.readyCount,
    limitedCount: timeline.limitedCount,
    refreshRecommended: timeline.refreshRecommended,
    refreshReasons: timeline.refreshReasons,
    associations: timeline.associations,
    notTradingAdvice: timeline.notTradingAdvice,
    items: items.map((item: any) => ({
      ...item,
      points: detail === 'series' ? compactRotationPoints(item.points, tail) : undefined,
      latest: Array.isArray(item.points) ? item.points.at(-1) || null : null,
    })),
  }
}

const getAuditUserId = (parameters?: Record<string, unknown>) => {
  const userId = parameters?.userId
  return typeof userId === 'string' && userId.trim().length > 0 ? userId : undefined
}

const normalizeContextUserId = (context?: McpCallContext) => (
  typeof context?.userId === 'string' && context.userId.trim().length > 0 ? context.userId : undefined
)

const resolveUserContext = (
  tool: McpToolDefinition,
  parameters: Record<string, unknown> | undefined,
  context?: McpCallContext
) => {
  const parameterUserId = getAuditUserId(parameters)
  const contextUserId = normalizeContextUserId(context)

  if (parameterUserId && contextUserId && parameterUserId !== contextUserId) {
    return {
      ok: false as const,
      error: {
        code: 'USER_CONTEXT_MISMATCH',
        message: `Tool parameter userId '${parameterUserId}' does not match call context userId '${contextUserId}'`,
        details: { parameterUserId, contextUserId },
      },
      parameterUserId,
      contextUserId,
    }
  }

  const resolvedUserId = contextUserId || parameterUserId

  if (tool.permissions.userContext === 'required' && !resolvedUserId) {
    return {
      ok: false as const,
      error: {
        code: 'USER_CONTEXT_REQUIRED',
        message: `Tool '${tool.name}' requires a user context`,
      },
      parameterUserId,
      contextUserId,
    }
  }

  return {
    ok: true as const,
    parameters: resolvedUserId && !parameterUserId ? { ...(parameters || {}), userId: resolvedUserId } : (parameters || {}),
    userId: resolvedUserId,
    userContextSource: contextUserId
      ? context?.userContextSource
      : parameterUserId
        ? 'explicit_parameter' as const
        : undefined,
    parameterUserId,
    contextUserId,
  }
}

const buildCallAudit = (
  parameters: Record<string, unknown> | undefined,
  tool?: McpToolDefinition,
  context?: McpCallContext,
  resolvedUser?: {
    userId?: string
    userContextSource?: McpCallEnvelope['audit']['userContextSource']
    parameterUserId?: string
    contextUserId?: string
  }
) => ({
  calledAt: new Date().toISOString(),
  requestId: context?.requestId,
  transport: context?.transport,
  userId: resolvedUser?.userId || normalizeContextUserId(context) || getAuditUserId(parameters),
  userContextSource: resolvedUser?.userContextSource || (normalizeContextUserId(context) ? context?.userContextSource : getAuditUserId(parameters) ? 'explicit_parameter' as const : undefined),
  parameterUserId: resolvedUser?.parameterUserId || getAuditUserId(parameters),
  contextUserId: resolvedUser?.contextUserId || normalizeContextUserId(context),
  writes: tool?.permissions.writes,
  requiresHumanConfirmation: tool?.permissions.requiresHumanConfirmation,
})

const buildCallEnvelope = (
  requestedName: string,
  parameters: Record<string, unknown> | undefined,
  tool: McpToolDefinition | undefined,
  context: McpCallContext | undefined,
  status: McpCallEnvelope['status'],
  payload: {
    result?: unknown
    error?: McpCallEnvelope['error']
    resolvedUser?: Parameters<typeof buildCallAudit>[3]
  }
): McpCallEnvelope => ({
  schemaVersion: 'fams.mcp.call.v1',
  success: status !== 'failed',
  status,
  tool: {
    requestedName,
    name: tool?.name,
    domain: tool?.domain,
    version: tool?.version,
  },
  audit: buildCallAudit(parameters, tool, context, payload.resolvedUser),
  result: payload.result,
  error: payload.error,
})

const isConfirmationBlock = (result: unknown) => (
  typeof result === 'object' &&
  result !== null &&
  (result as { blocked?: unknown; code?: unknown }).blocked === true &&
  (result as { code?: unknown }).code === 'HUMAN_CONFIRMATION_REQUIRED'
)

export const mcpTools: Record<string, McpToolDefinition> = {
  get_real_time_price: {
    name: 'get_real_time_price',
    domain: 'market_data',
    version: 'v1',
    aliases: ['market_data.get_real_time_price'],
    description: '获取资产的实时价格，支持多数据源和交叉验证',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string', description: '资产代码，如 AAPL、600519、513770' },
        source: { type: 'string', enum: ['yahoo', 'eastmoney', 'sina', 'auto'], description: '数据源' },
      },
      required: ['symbol'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['market_data:read']),
    safety: readSafety,
    handler: async (params: { symbol: string; source?: 'yahoo' | 'eastmoney' | 'sina' | 'auto' }) => (
      priceService.getRealTimePrice(params.symbol, params.source)
    ),
  },

  get_positions: {
    name: 'get_positions',
    domain: 'position',
    version: 'v1',
    aliases: ['position.list'],
    description: '获取用户仓位列表',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        status: { type: 'string', enum: ['open', 'closed', 'pending'] },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['position:read']),
    safety: readSafety,
    handler: async (params: { userId: string; status?: 'open' | 'closed' | 'pending'; tags?: string[] }) => (
      positionService.getPositions(params.userId, { status: params.status, tags: params.tags })
    ),
  },

  get_investment_suggestions: {
    name: 'get_investment_suggestions',
    domain: 'advice',
    version: 'v1',
    aliases: ['advice.get_suggestions'],
    description: '获取每日或每周投资建议',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        period: { type: 'string', enum: ['daily', 'weekly'] },
      },
      required: ['userId', 'period'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['advice:read']),
    safety: readSafety,
    handler: async (params: { userId: string; period: 'daily' | 'weekly' }) => (
      analysisService.getSuggestions(params.userId, params.period)
    ),
  },

  get_portfolio_analysis: {
    name: 'get_portfolio_analysis',
    domain: 'portfolio',
    version: 'v1',
    aliases: ['portfolio.get_analysis'],
    description: '获取投资组合分析',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        portfolioId: { type: 'string' },
      },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['portfolio:read']),
    safety: readSafety,
    handler: async (params: { userId: string; portfolioId?: string }) => (
      portfolioService.getAnalysis(params.userId, params.portfolioId)
    ),
  },

  run_backtest: {
    name: 'run_backtest',
    domain: 'backtest',
    version: 'v1',
    aliases: ['backtest.run_strategy'],
    description: '执行策略回测',
    inputSchema: {
      type: 'object',
      properties: {
        strategyId: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        initialCapital: { type: 'number' },
      },
      required: ['strategyId', 'startDate', 'endDate', 'initialCapital'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['backtest:run']),
    safety: asyncOperationSafety,
    handler: async (params: {
      strategyId: string
      startDate: string
      endDate: string
      initialCapital: number
    }) => backtestService.runBacktest(params),
  },

  get_daily_snapshot: {
    name: 'get_daily_snapshot',
    domain: 'portfolio',
    version: 'v1',
    aliases: ['portfolio.get_daily_snapshot'],
    description: '获取每日仓位快照',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        date: { type: 'string' },
      },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['portfolio:read']),
    safety: readSafety,
    handler: async (params: { userId: string; date?: string }) => (
      analysisService.getDailySnapshot(params.userId, params.date)
    ),
  },

  create_transaction: {
    name: 'create_transaction',
    domain: 'transaction',
    version: 'v1',
    aliases: ['transaction.create_manual_record'],
    description: '创建交易记录。该工具影响交易流水，必须由上游确认节点显式授权。',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        assetId: { type: 'string' },
        type: { type: 'string', enum: ['buy', 'sell'] },
        quantity: { type: 'number' },
        price: { type: 'number' },
        confirmation: humanConfirmationSchema,
      },
      required: ['userId', 'assetId', 'type', 'quantity', 'price'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: tradeWritePermission(['transaction:write']),
    safety: confirmedWriteSafety,
    handler: async (params: TradeWriteParams) => {
      if (!hasHumanConfirmation(params.confirmation)) {
        return buildTradeConfirmationBlock('create_transaction', params)
      }

      const { confirmation: _confirmation, ...transactionParams } = params
      return transactionService.createTransaction(transactionParams)
    },
  },

  get_alerts: {
    name: 'get_alerts',
    domain: 'alert',
    version: 'v1',
    aliases: ['alert.list'],
    description: '获取用户告警列表',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        status: { type: 'string', enum: ['active', 'acknowledged', 'resolved'] },
        severity: { type: 'string', enum: ['info', 'warning', 'danger'] },
      },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['alert:read']),
    safety: readSafety,
    handler: async (params: { userId: string; status?: 'active' | 'acknowledged' | 'resolved'; severity?: 'info' | 'warning' | 'danger' }) => (
      alertService.getAlerts(params.userId, { status: params.status, severity: params.severity })
    ),
  },

  'operation.list': {
    name: 'operation.list',
    domain: 'operation',
    version: 'v1',
    description: '列出用户异步任务，支持按类型和状态过滤',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        type: { type: 'string' },
        status: { type: 'string', enum: ['queued', 'running', 'completed', 'succeeded', 'partial', 'failed', 'cancelling', 'cancelled'] },
        limit: { type: 'number' },
      },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['operation:read']),
    safety: readSafety,
    handler: async (params: { userId: string; type?: string; status?: string; limit?: number }) => (
      operationService.listOperations(params as any)
    ),
  },

  'operation.get': {
    name: 'operation.get',
    domain: 'operation',
    version: 'v1',
    description: '按 operation_id 获取任务详情',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        operation_id: { type: 'string' },
      },
      required: ['operation_id'],
    },
    outputSchema: operationOutputSchema,
    permissions: readPermission(['operation:read']),
    safety: readSafety,
    handler: async (params: { userId: string; operation_id: string }) => operationService.getOperation(params.operation_id, params.userId),
  },

  'operation.get_artifact': {
    name: 'operation.get_artifact',
    domain: 'operation',
    version: 'v1',
    description: '按 artifact ref 获取结构化产物详情',
    inputSchema: {
      type: 'object',
      properties: {
        ref: { type: 'string' },
      },
      required: ['ref'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['operation:read', 'artifact:read']),
    safety: readSafety,
    handler: async (params: { ref: string }) => operationService.getArtifact(params.ref),
  },

  'market_data.refresh_prices': {
    name: 'market_data.refresh_prices',
    domain: 'market_data',
    version: 'v1',
    description: '启动价格刷新异步任务，返回 operation_id、artifact_refs 和 next_actions',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        assetIds: { type: 'array', items: { type: 'string' } },
        symbols: { type: 'array', items: { type: 'string' } },
      },
      required: ['userId'],
    },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['market_data:write', 'operation:write']),
    safety: asyncOperationSafety,
    handler: async (params: { userId: string; assetIds?: string[]; symbols?: string[] }) => (
      operationService.startRefreshPricesOperation(params)
    ),
  },

  'alert.check': {
    name: 'alert.check',
    domain: 'alert',
    version: 'v1',
    description: '启动风险告警检查异步任务',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        refreshPrices: { type: 'boolean' },
      },
      required: ['userId'],
    },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['alert:write', 'operation:write']),
    safety: asyncOperationSafety,
    handler: async (params: { userId: string; refreshPrices?: boolean }) => (
      operationService.startCheckAlertsOperation(params)
    ),
  },

  'advice.generate_daily': {
    name: 'advice.generate_daily',
    domain: 'advice',
    version: 'v1',
    description: '启动每日投资建议异步任务',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        query: { type: 'string' },
        scope: { type: 'string', enum: ['all', 'asset', 'sector'] },
      },
      required: ['userId'],
    },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['advice:write', 'operation:write']),
    safety: asyncOperationSafety,
    handler: async (params: { userId: string; query?: string; scope?: 'all' | 'asset' | 'sector' }) => (
      operationService.startGenerateDailyAdviceOperation(params)
    ),
  },

  'relative_rotation.analyze_volatility_sleeves': {
    name: 'relative_rotation.analyze_volatility_sleeves',
    domain: 'relative_rotation',
    version: 'v1',
    description: '运行当前持仓的相对轮动与每日波动仓分析，生成仅供人工确认的交易草稿',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        refresh: { type: 'boolean' },
      },
      required: ['userId'],
    },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['analysis:write', 'operation:write']),
    safety: asyncOperationSafety,
    handler: async (params: { userId: string; refresh?: boolean }) => (
      operationService.startVolatilitySleeveDailyAnalysisOperation({
        ...params,
        executionMode: 'inline',
        createdBy: 'agent',
      })
    ),
  },

  'relative_rotation.get_industry_crowding': {
    name: 'relative_rotation.get_industry_crowding',
    domain: 'relative_rotation',
    version: 'v1',
    description: '读取行业拥挤度、20日归一化资金流评分和板块覆盖状态。默认只返回摘要；需要轨迹时必须指定板块代码。',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        year: { type: 'number', minimum: 2010 },
        frequency: { type: 'string', enum: ['weekly', 'daily'], default: 'weekly' },
        detail: { type: 'string', enum: ['summary', 'series'], default: 'summary' },
        boardCodes: { type: 'array', items: { type: 'string', pattern: '^BK\\d{4,}$' }, maxItems: 20 },
        tail: { type: 'number', minimum: 1, maximum: 120, default: 12 },
      },
      required: ['userId'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['relative_rotation:read']),
    safety: readSafety,
    parameterSchema: z.object({
      userId: z.string().trim().min(1),
      year: z.number().int().min(2010).max(2100).optional(),
      frequency: rotationFrequencySchema,
      detail: rotationDetailSchema,
      boardCodes: z.array(z.string().trim().regex(/^BK\d{4,}$/i)).max(20).default([]),
      tail: tailSchema,
    }).strict().superRefine((value, context) => {
      if (value.detail === 'series' && value.boardCodes.length === 0) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ['boardCodes'], message: 'series detail requires at least one board code' })
      }
    }),
    handler: async (params: any) => {
      const report: any = await industryCrowdingService.getReport(params.userId, {
        year: params.year,
        frequency: params.frequency,
        boardCodes: params.boardCodes.length > 0 ? params.boardCodes : undefined,
      })
      const boards = params.detail === 'series'
        ? (report.boards || []).map((board: any) => ({
            ...board,
            points: compactRotationPoints(board.points, params.tail),
          }))
        : (report.boards || []).map((board: any) => ({
            code: board.code,
            name: board.name,
            dataStatus: board.dataStatus,
            priceStatus: board.priceStatus,
            flowStatus: board.flowStatus,
            lastPriceDate: board.lastPriceDate,
            lastFlowDate: board.lastFlowDate,
            lastError: board.lastError,
            latest: board.latest,
          }))
      return {
        schemaVersion: report.schemaVersion,
        generatedAt: report.generatedAt,
        year: report.year,
        frequency: report.frequency,
        asOfDate: report.asOfDate,
        boardCount: report.boardCount,
        readyCount: report.readyCount,
        partialCount: report.partialCount,
        unavailableCount: report.unavailableCount,
        coverageByDate: params.detail === 'series' ? (report.coverageByDate || []).slice(-params.tail) : report.coverageByDate?.at(-1) || null,
        summaries: report.summaries,
        benchmark: report.benchmark,
        methodology: report.methodology,
        marketFlow: {
          pointCount: report.marketFlow?.points?.length || 0,
          latest: report.marketFlow?.points?.at(-1) || null,
        },
        warnings: report.warnings,
        notTradingAdvice: report.notTradingAdvice,
        boards,
      }
    },
  },

  'relative_rotation.get_market_flow': {
    name: 'relative_rotation.get_market_flow',
    domain: 'relative_rotation',
    version: 'v1',
    description: '读取沪深两市整体主力资金流及归一化强度；该数据独立于行业板块相加结果。',
    inputSchema: {
      type: 'object',
      properties: { userId: { type: 'string' }, year: { type: 'number', minimum: 2010 }, tail: { type: 'number', minimum: 1, maximum: 120, default: 60 } },
      required: ['userId'],
      additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['relative_rotation:read']),
    safety: readSafety,
    parameterSchema: z.object({
      userId: z.string().trim().min(1),
      year: z.number().int().min(2010).max(2100).optional(),
      tail: z.number().int().min(1).max(120).default(60),
    }).strict(),
    handler: async (params: any) => {
      const report: any = await industryCrowdingService.getReport(params.userId, { year: params.year, frequency: 'weekly' })
      return {
        schemaVersion: 'fams.relative_rotation.market_flow.v1',
        generatedAt: report.generatedAt,
        asOfDate: report.asOfDate,
        pointCount: report.marketFlow?.points?.length || 0,
        points: compactRotationPoints(report.marketFlow?.points, params.tail),
        methodology: report.methodology?.provider,
        warnings: report.warnings,
        notTradingAdvice: true,
      }
    },
  },

  'relative_rotation.refresh_industry_crowding': {
    name: 'relative_rotation.refresh_industry_crowding',
    domain: 'relative_rotation',
    version: 'v1',
    description: '启动行业价格与主力资金流补齐任务。需要重试残留缓存或源失败的板块时设置 force=true。',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' }, year: { type: 'number', minimum: 2010 },
        boardCodes: { type: 'array', items: { type: 'string', pattern: '^BK\\d{4,}$' }, maxItems: 128 },
        force: { type: 'boolean', default: false }, idempotencyKey: { type: 'string' },
      },
      required: ['userId'], additionalProperties: false,
    },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['relative_rotation:write', 'operation:write']),
    safety: asyncOperationSafety,
    parameterSchema: z.object({
      userId: z.string().trim().min(1),
      year: z.number().int().min(2010).max(2100).optional(),
      boardCodes: z.array(z.string().trim().regex(/^BK\d{4,}$/i)).max(128).default([]),
      force: z.boolean().default(false),
      idempotencyKey: z.string().trim().min(1).max(180).optional(),
    }).strict(),
    handler: async (params: any) => operationService.startIndustryCrowdingBackfillOperation({
      ...params,
      executionMode: 'inline',
      createdBy: 'agent',
    }),
  },

  'relative_rotation.get_holdings_timeline': {
    name: 'relative_rotation.get_holdings_timeline',
    domain: 'relative_rotation',
    version: 'v1',
    description: '读取当前持仓相对沪深300的轮动轨迹与数据覆盖状态；默认返回摘要，series 仅返回指定证券。',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' }, frequency: { type: 'string', enum: ['weekly', 'daily'], default: 'weekly' },
        years: { type: 'number', minimum: 1, maximum: 8, default: 8 }, detail: { type: 'string', enum: ['summary', 'series'], default: 'summary' },
        symbols: { type: 'array', items: { type: 'string' }, maxItems: 30 }, tail: { type: 'number', minimum: 1, maximum: 120, default: 12 },
      }, required: ['userId'], additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['relative_rotation:read', 'position:read']),
    safety: readSafety,
    parameterSchema: z.object({
      userId: z.string().trim().min(1), frequency: rotationFrequencySchema,
      years: z.number().int().min(1).max(8).default(8), detail: rotationDetailSchema,
      symbols: z.array(z.string().trim().min(1).max(40)).max(30).default([]), tail: tailSchema,
    }).strict().superRefine((value, context) => {
      if (value.detail === 'series' && value.symbols.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['symbols'], message: 'series detail requires at least one symbol' })
    }),
    handler: async (params: any) => summarizeTimeline(
      await relativeRotationService.getHoldingsTimeline(params.userId, { frequency: params.frequency, years: params.years }),
      params.detail, params.tail, params.symbols,
    ),
  },

  'relative_rotation.refresh_holdings_timeline': {
    name: 'relative_rotation.refresh_holdings_timeline',
    domain: 'relative_rotation',
    version: 'v1',
    description: '启动当前持仓相对轮动的历史行情刷新任务，完成后使用 operation.get 或查询工具读取结果。',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, years: { type: 'number', minimum: 1, maximum: 8, default: 8 }, idempotencyKey: { type: 'string' } }, required: ['userId'], additionalProperties: false },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['relative_rotation:write', 'operation:write']),
    safety: asyncOperationSafety,
    parameterSchema: z.object({ userId: z.string().trim().min(1), years: z.number().int().min(1).max(8).default(8), idempotencyKey: z.string().trim().min(1).max(180).optional() }).strict(),
    handler: async (params: any) => operationService.startRelativeRotationHistoryRefreshOperation({ ...params, executionMode: 'inline', createdBy: 'agent' }),
  },

  'relative_rotation.list_watchlist': {
    name: 'relative_rotation.list_watchlist',
    domain: 'relative_rotation',
    version: 'v1',
    description: '列出当前用户的轮动市场自选及其历史数据就绪状态。',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'], additionalProperties: false },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['relative_rotation:read']),
    safety: readSafety,
    parameterSchema: z.object({ userId: z.string().trim().min(1) }).strict(),
    handler: async (params: any) => relativeRotationUniverseService.listWatchlist(params.userId),
  },

  'relative_rotation.add_watchlist_item': {
    name: 'relative_rotation.add_watchlist_item',
    domain: 'relative_rotation',
    version: 'v1',
    description: '将一个标准市场代码加入轮动自选。该调用只保存身份与配置，不会隐式联网刷新历史；请随后调用 refresh_watchlist_timeline。',
    inputSchema: {
      type: 'object', properties: {
        userId: { type: 'string' }, market: { type: 'string', enum: ['CN', 'HK', 'US'] }, code: { type: 'string' }, years: { type: 'number', minimum: 1, maximum: 8, default: 8 },
      }, required: ['userId', 'market', 'code'], additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['relative_rotation:write']),
    safety: directWriteSafety,
    parameterSchema: z.object({
      userId: z.string().trim().min(1), market: z.enum(['CN', 'HK', 'US']), code: z.string().trim().min(1).max(40), years: z.number().int().min(1).max(8).default(8),
    }).strict(),
    handler: async (params: any) => relativeRotationUniverseService.addWatchlistItem(params.userId, params.market, params.code, { refresh: false, years: params.years }),
  },

  'relative_rotation.delete_watchlist_item': {
    name: 'relative_rotation.delete_watchlist_item',
    domain: 'relative_rotation',
    version: 'v1',
    description: '删除轮动市场自选及其本地轮动记录。必须先提供人工确认；共享行情缓存不会被删除。',
    inputSchema: {
      type: 'object', properties: { userId: { type: 'string' }, itemId: { type: 'string' }, confirmation: humanConfirmationSchema },
      required: ['userId', 'itemId'], additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    permissions: confirmedWritePermission(['relative_rotation:write']),
    safety: confirmedWriteSafety,
    parameterSchema: z.object({ userId: z.string().trim().min(1), itemId: z.string().trim().min(1), confirmation: deletionConfirmationSchema.optional() }).strict(),
    handler: async (params: any) => {
      if (!hasHumanConfirmation(params.confirmation)) return buildDeletionConfirmationBlock('relative_rotation.delete_watchlist_item', params.userId, { itemId: params.itemId }, '轮动自选')
      return relativeRotationUniverseService.deleteWatchlistItem(params.userId, params.itemId)
    },
  },

  'relative_rotation.get_watchlist_timeline': {
    name: 'relative_rotation.get_watchlist_timeline',
    domain: 'relative_rotation',
    version: 'v1',
    description: '读取市场自选与同市场持仓的相对轮动轨迹；默认摘要，series 可按 targetKey 或证券代码选择。',
    inputSchema: {
      type: 'object', properties: {
        userId: { type: 'string' }, market: { type: 'string', enum: ['CN', 'HK', 'US'], default: 'CN' }, frequency: { type: 'string', enum: ['weekly', 'daily'], default: 'weekly' },
        years: { type: 'number', minimum: 1, maximum: 8, default: 8 }, detail: { type: 'string', enum: ['summary', 'series'], default: 'summary' },
        targetKeys: { type: 'array', items: { type: 'string' }, maxItems: 30 }, tail: { type: 'number', minimum: 1, maximum: 120, default: 12 },
      }, required: ['userId'], additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['relative_rotation:read', 'position:read']),
    safety: readSafety,
    parameterSchema: z.object({
      userId: z.string().trim().min(1), market: rotationMarketSchema, frequency: rotationFrequencySchema, years: z.number().int().min(1).max(8).default(8), detail: rotationDetailSchema,
      targetKeys: z.array(z.string().trim().min(1).max(80)).max(30).default([]), tail: tailSchema,
    }).strict().superRefine((value, context) => {
      if (value.detail === 'series' && value.targetKeys.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetKeys'], message: 'series detail requires at least one target key' })
    }),
    handler: async (params: any) => summarizeTimeline(
      await relativeRotationUniverseService.getUniverseTimeline(params.userId, { market: params.market, frequency: params.frequency, years: params.years }),
      params.detail, params.tail, params.targetKeys,
    ),
  },

  'relative_rotation.refresh_watchlist_timeline': {
    name: 'relative_rotation.refresh_watchlist_timeline',
    domain: 'relative_rotation',
    version: 'v1',
    description: '启动市场自选轮动历史刷新任务。targetKeys 必须来自 list_watchlist 或 get_watchlist_timeline。',
    inputSchema: {
      type: 'object', properties: {
        userId: { type: 'string' }, market: { type: 'string', enum: ['CN', 'HK', 'US'], default: 'CN' }, targetKeys: { type: 'array', items: { type: 'string' }, maxItems: 30 },
        years: { type: 'number', minimum: 1, maximum: 8, default: 8 }, idempotencyKey: { type: 'string' },
      }, required: ['userId', 'targetKeys'], additionalProperties: false,
    },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['relative_rotation:write', 'operation:write']),
    safety: asyncOperationSafety,
    parameterSchema: z.object({
      userId: z.string().trim().min(1), market: rotationMarketSchema, targetKeys: z.array(z.string().trim().min(1).max(80)).min(1).max(30),
      years: z.number().int().min(1).max(8).default(8), idempotencyKey: z.string().trim().min(1).max(180).optional(),
    }).strict(),
    handler: async (params: any) => operationService.startRelativeRotationUniverseRefreshOperation({ ...params, executionMode: 'inline', createdBy: 'agent' }),
  },

  'relative_rotation.list_research_studies': {
    name: 'relative_rotation.list_research_studies',
    domain: 'relative_rotation',
    version: 'v1',
    description: '列出用户保存的相对轮动专题研究及完整研究配置。',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'], additionalProperties: false },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['relative_rotation:read']),
    safety: readSafety,
    parameterSchema: z.object({ userId: z.string().trim().min(1) }).strict(),
    handler: async (params: any) => relativeRotationResearchStudyService.listStudies(params.userId),
  },

  'relative_rotation.create_research_study': {
    name: 'relative_rotation.create_research_study',
    domain: 'relative_rotation',
    version: 'v1',
    description: '创建完整的相对轮动专题研究配置。创建不自动联网刷新；随后调用 refresh_research_timeline。',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, study: { type: 'object', description: '研究名称、市场、频率、基准、区间和目标列表。' } }, required: ['userId', 'study'], additionalProperties: false },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['relative_rotation:write']),
    safety: directWriteSafety,
    parameterSchema: z.object({ userId: z.string().trim().min(1), study: researchStudySchema }).strict(),
    handler: async (params: any) => relativeRotationResearchStudyService.createStudy(params.userId, params.study as ResearchStudyInput),
  },

  'relative_rotation.update_research_study': {
    name: 'relative_rotation.update_research_study',
    domain: 'relative_rotation',
    version: 'v1',
    description: '用一整份合法研究定义替换既有专题配置，不会自动刷新行情或重新计算轨迹。',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, studyId: { type: 'string' }, study: { type: 'object' } }, required: ['userId', 'studyId', 'study'], additionalProperties: false },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['relative_rotation:write']),
    safety: directWriteSafety,
    parameterSchema: z.object({ userId: z.string().trim().min(1), studyId: z.string().trim().min(1), study: researchStudySchema }).strict(),
    handler: async (params: any) => relativeRotationResearchStudyService.updateStudy(params.userId, params.studyId, params.study as ResearchStudyInput),
  },

  'relative_rotation.delete_research_study': {
    name: 'relative_rotation.delete_research_study',
    domain: 'relative_rotation',
    version: 'v1',
    description: '删除一个保存的专题研究。必须先提供人工确认；共享行情缓存不会被删除。',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, studyId: { type: 'string' }, confirmation: humanConfirmationSchema }, required: ['userId', 'studyId'], additionalProperties: false },
    outputSchema: successEnvelopeSchema,
    permissions: confirmedWritePermission(['relative_rotation:write']),
    safety: confirmedWriteSafety,
    parameterSchema: z.object({ userId: z.string().trim().min(1), studyId: z.string().trim().min(1), confirmation: deletionConfirmationSchema.optional() }).strict(),
    handler: async (params: any) => {
      if (!hasHumanConfirmation(params.confirmation)) return buildDeletionConfirmationBlock('relative_rotation.delete_research_study', params.userId, { studyId: params.studyId }, '专题研究')
      return relativeRotationResearchStudyService.deleteStudy(params.userId, params.studyId)
    },
  },

  'relative_rotation.get_research_timeline': {
    name: 'relative_rotation.get_research_timeline',
    domain: 'relative_rotation',
    version: 'v1',
    description: '读取已保存专题的相对轮动轨迹、关联关系、数据状态和来源提示；series 仅返回指定目标。',
    inputSchema: {
      type: 'object', properties: {
        userId: { type: 'string' }, studyId: { type: 'string' }, detail: { type: 'string', enum: ['summary', 'series'], default: 'summary' },
        targetKeys: { type: 'array', items: { type: 'string' }, maxItems: 30 }, tail: { type: 'number', minimum: 1, maximum: 120, default: 12 },
      }, required: ['userId', 'studyId'], additionalProperties: false,
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['relative_rotation:read']),
    safety: readSafety,
    parameterSchema: z.object({
      userId: z.string().trim().min(1), studyId: z.string().trim().min(1), detail: rotationDetailSchema,
      targetKeys: z.array(z.string().trim().min(1).max(80)).max(30).default([]), tail: tailSchema,
    }).strict().superRefine((value, context) => {
      if (value.detail === 'series' && value.targetKeys.length === 0) context.addIssue({ code: z.ZodIssueCode.custom, path: ['targetKeys'], message: 'series detail requires at least one target key' })
    }),
    handler: async (params: any) => summarizeTimeline(
      await relativeRotationResearchStudyService.getTimeline(params.userId, { studyId: params.studyId }),
      params.detail, params.tail, params.targetKeys,
    ),
  },

  'relative_rotation.refresh_research_timeline': {
    name: 'relative_rotation.refresh_research_timeline',
    domain: 'relative_rotation',
    version: 'v1',
    description: '启动已保存专题的标的和基准历史刷新任务，并在完成后产出最新专题轮动时间线。',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, studyId: { type: 'string' }, idempotencyKey: { type: 'string' } }, required: ['userId', 'studyId'], additionalProperties: false },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['relative_rotation:write', 'operation:write']),
    safety: asyncOperationSafety,
    parameterSchema: z.object({ userId: z.string().trim().min(1), studyId: z.string().trim().min(1), idempotencyKey: z.string().trim().min(1).max(180).optional() }).strict(),
    handler: async (params: any) => operationService.startRelativeRotationResearchRefreshOperation({ ...params, executionMode: 'inline', createdBy: 'agent' }),
  },

  'backtest.run_from_advice': {
    name: 'backtest.run_from_advice',
    domain: 'backtest',
    version: 'v1',
    description: '基于建议产物启动回测异步任务',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        adviceId: { type: 'string' },
        startDate: { type: 'string' },
        endDate: { type: 'string' },
        initialCapital: { type: 'number' },
        parentOperationId: { type: 'string' },
      },
      required: ['userId', 'adviceId'],
    },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['backtest:run', 'operation:write']),
    safety: asyncOperationSafety,
    handler: async (params: {
      userId: string
      adviceId: string
      startDate?: string
      endDate?: string
      initialCapital?: number
      parentOperationId?: string
    }) => operationService.startRunBacktestOperation(params),
  },

  'market_data.get_asset_trend': {
    name: 'market_data.get_asset_trend',
    domain: 'market_data',
    version: 'v1',
    aliases: ['asset.get_trend'],
    description: '获取并保存资产最新价、最近30个完整交易日收盘价和 MA5/MA10/MA30 走势图数据',
    inputSchema: {
      type: 'object',
      properties: { userId: { type: 'string' }, assetId: { type: 'string' }, symbol: { type: 'string' }, days: { type: 'number', minimum: 30, maximum: 120 } },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['market_data:read', 'market_data:write']),
    safety: directWriteSafety,
    handler: async (params: { assetId?: string; symbol?: string; days?: number }) => assetTrendService.getSnapshot({ ...params, persist: true }),
  },

  'volatility_workflow.reconcile': {
    name: 'volatility_workflow.reconcile',
    domain: 'volatility_workflow',
    version: 'v1',
    description: '先对账持仓、可卖数量、资金、新成交、普通委托和条件单，输出五部分报告；只读且不创建券商订单。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        userId: { type: 'string' },
        sessionType: { type: 'string', enum: ['open', 'pre_close', 'manual'] },
        holdingsCaptureId: { type: 'string' },
        tradesCaptureId: { type: 'string' },
        ordinaryOrdersCaptureId: { type: 'string' },
        conditionalOrdersCaptureId: { type: 'string' },
        zeroNewTradesConfirmed: { type: 'boolean' },
      },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['volatility_workflow:read']),
    safety: readSafety,
    parameterSchema: volatilityReconcileSchema,
    handler: async (params: any) => volatilityWorkflowService.reconcile(params),
  },

  'volatility_workflow.run': {
    name: 'volatility_workflow.run',
    domain: 'volatility_workflow',
    version: 'v1',
    description: '启动对账、30日收盘与MA、日频RRG、基本面/消息、策略差异、人工拟单和HTML报告的一键波动仓工作流。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        userId: { type: 'string' },
        sessionType: { type: 'string', enum: ['open', 'pre_close', 'manual'] },
        holdingsCaptureId: { type: 'string' },
        tradesCaptureId: { type: 'string' },
        ordinaryOrdersCaptureId: { type: 'string' },
        conditionalOrdersCaptureId: { type: 'string' },
        zeroNewTradesConfirmed: { type: 'boolean' },
        idempotencyKey: { type: 'string' },
      },
      required: ['userId'],
    },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['volatility_workflow:run', 'daily_review:write', 'operation:write']),
    safety: asyncOperationSafety,
    parameterSchema: volatilityRunSchema,
    handler: async (params: any) => volatilityWorkflowService.run(params),
  },

  'volatility_workflow.get_result': {
    name: 'volatility_workflow.get_result',
    domain: 'volatility_workflow',
    version: 'v1',
    description: '按 operationId 或 reviewId 获取工作流状态、真实数据报告和自包含HTML；仅查询，不重新运行工作流。',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        userId: { type: 'string' },
        operationId: { type: 'string' },
        reviewId: { type: 'string' },
        includeHtml: { type: 'boolean' },
      },
      required: ['userId'],
      oneOf: [{ required: ['operationId'] }, { required: ['reviewId'] }],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['volatility_workflow:read', 'daily_review:read', 'operation:read']),
    safety: readSafety,
    parameterSchema: volatilityResultSchema,
    handler: async (params: any) => volatilityWorkflowService.getResult(params),
  },

  'daily_review.run': {
    name: 'daily_review.run',
    domain: 'daily_review',
    version: 'v1',
    description: '启动开盘后、收盘前或手动持仓复盘；只生成研究报告和人工计划草案，不创建券商订单',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        sessionType: { type: 'string', enum: ['open', 'pre_close', 'manual'] },
        idempotencyKey: { type: 'string' },
        holdingsCaptureId: { type: 'string' },
        tradesCaptureId: { type: 'string' },
        ordinaryOrdersCaptureId: { type: 'string' },
        conditionalOrdersCaptureId: { type: 'string' },
        zeroNewTradesConfirmed: { type: 'boolean' },
      },
      required: ['userId'],
    },
    outputSchema: operationOutputSchema,
    permissions: asyncPermission(['daily_review:write', 'operation:write']),
    safety: asyncOperationSafety,
    handler: async (params: { userId: string; sessionType?: 'open' | 'pre_close' | 'manual'; idempotencyKey?: string; holdingsCaptureId?: string; tradesCaptureId?: string; ordinaryOrdersCaptureId?: string; conditionalOrdersCaptureId?: string; zeroNewTradesConfirmed?: boolean }) => {
      const started = await dailyReviewService.startReview({
        userId: params.userId,
        sessionType: params.sessionType,
        idempotencyKey: params.idempotencyKey,
        triggerSource: 'agent',
        executionMode: 'queued',
        brokerWorkflow: true,
        brokerReconciliationInput: {
          holdingsCaptureId: params.holdingsCaptureId,
          tradesCaptureId: params.tradesCaptureId,
          ordinaryOrdersCaptureId: params.ordinaryOrdersCaptureId,
          conditionalOrdersCaptureId: params.conditionalOrdersCaptureId,
          zeroNewTradesConfirmed: params.zeroNewTradesConfirmed === true,
        },
      })
      return {
        id: started.operation?.id,
        operationId: started.operation?.id,
        operation_id: started.operation?.id,
        status: started.operation?.status,
        progressPct: started.operation?.progressPct,
        reviewId: started.review?.id,
        artifactRefs: started.review?.id ? [`daily-review:${started.review.id}`] : [],
        nextActions: [{ tool: 'operation.get', operation_id: started.operation?.id }, { tool: 'daily_review.get', reviewId: started.review?.id }],
        reused: started.reused,
      }
    },
  },

  'daily_review.reconcile': {
    name: 'daily_review.reconcile',
    domain: 'daily_review',
    version: 'v1',
    description: '只读对账券商持仓、可卖数量、资金、成交、普通委托和条件单；不会修改仓位或创建订单',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        sessionType: { type: 'string', enum: ['open', 'pre_close', 'manual'] },
        holdingsCaptureId: { type: 'string' },
        tradesCaptureId: { type: 'string' },
        ordinaryOrdersCaptureId: { type: 'string' },
        conditionalOrdersCaptureId: { type: 'string' },
        zeroNewTradesConfirmed: { type: 'boolean' },
      },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['daily_review:read']),
    safety: readSafety,
    handler: async (params: any) => brokerReviewReconciliationService.reconcile(params),
  },

  'daily_review.export_html': {
    name: 'daily_review.export_html',
    domain: 'daily_review',
    version: 'v1',
    description: '返回指定复盘的自包含 HTML 报告地址；页面不依赖单张图片且不会触发交易',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, reviewId: { type: 'string' } }, required: ['userId', 'reviewId'] },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['daily_review:read']),
    safety: readSafety,
    handler: async (params: { userId: string; reviewId: string }) => {
      await dailyReviewService.getReview(params.reviewId, params.userId)
      return {
        reviewId: params.reviewId,
        contentType: 'text/html; charset=utf-8',
        href: `/api/v1/daily-reviews/${encodeURIComponent(params.reviewId)}/report.html?userId=${encodeURIComponent(params.userId)}`,
        executionBoundary: { canCreateOrder: false, autoTradeUnlocked: false },
      }
    },
  },

  'daily_review.get_latest': {
    name: 'daily_review.get_latest',
    domain: 'daily_review',
    version: 'v1',
    description: '查询最新持仓复盘，包括走势图、基本面/消息变化、关注标的及人工计划网格',
    inputSchema: {
      type: 'object',
      properties: { userId: { type: 'string' }, sessionType: { type: 'string', enum: ['open', 'pre_close', 'manual'] } },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['daily_review:read']),
    safety: readSafety,
    handler: async (params: { userId: string; sessionType?: 'open' | 'pre_close' | 'manual' }) => dailyReviewService.getLatest(params.userId, params.sessionType),
  },

  'daily_review.get': {
    name: 'daily_review.get',
    domain: 'daily_review',
    version: 'v1',
    description: '按复盘 ID 查询可追溯报告和网格草案',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, reviewId: { type: 'string' } }, required: ['userId', 'reviewId'] },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['daily_review:read']),
    safety: readSafety,
    handler: async (params: { userId: string; reviewId: string }) => dailyReviewService.getReview(params.reviewId, params.userId),
  },

  'daily_review.list': {
    name: 'daily_review.list',
    domain: 'daily_review',
    version: 'v1',
    description: '分页查询历史持仓复盘、快照计数和策略总体结论',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        sessionType: { type: 'string', enum: ['open', 'pre_close', 'manual'] },
        status: { type: 'string' },
        cursor: { type: 'string' },
        limit: { type: 'number', minimum: 1, maximum: 50 },
      },
      required: ['userId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['daily_review:read']),
    safety: readSafety,
    handler: async (params: any) => dailyReviewService.listReviews(params),
  },

  'grid_strategy.list_templates': {
    name: 'grid_strategy.list_templates',
    domain: 'strategy',
    version: 'v1',
    description: '列出声明式网格策略模板',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['strategy:read']),
    safety: readSafety,
    handler: async () => ({ templates: gridStrategyService.listTemplates(), notTradingAdvice: true }),
  },

  'grid_strategy.create_draft': {
    name: 'grid_strategy.create_draft',
    domain: 'strategy',
    version: 'v1',
    description: '将自然语言已转换出的声明式参数保存为未激活策略草案',
    inputSchema: {
      type: 'object',
      properties: { userId: { type: 'string' }, templateId: { type: 'string' }, name: { type: 'string' }, description: { type: 'string' }, overrides: { type: 'object' } },
      required: ['userId', 'templateId'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['strategy:write']),
    safety: directWriteSafety,
    handler: async (params: any) => gridStrategyService.createDraft(params),
  },

  'grid_strategy.validate_draft': {
    name: 'grid_strategy.validate_draft',
    domain: 'strategy',
    version: 'v1',
    description: '校验策略配置并检查当前持仓的历史数据覆盖',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, versionId: { type: 'string' } }, required: ['userId', 'versionId'] },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['strategy:write']),
    safety: directWriteSafety,
    handler: async (params: { userId: string; versionId: string }) => gridStrategyService.validateDraft(params.versionId, params.userId),
  },

  'grid_strategy.activate': {
    name: 'grid_strategy.activate',
    domain: 'strategy',
    version: 'v1',
    description: '人工确认后激活已经验证的策略版本；不会解锁自动交易',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, versionId: { type: 'string' }, confirmation: humanConfirmationSchema }, required: ['userId', 'versionId', 'confirmation'] },
    outputSchema: successEnvelopeSchema,
    permissions: tradeWritePermission(['strategy:activate']),
    safety: confirmedWriteSafety,
    handler: async (params: { userId: string; versionId: string; confirmation?: HumanConfirmation }) => {
      if (!hasHumanConfirmation(params.confirmation)) {
        return { blocked: true, code: 'HUMAN_CONFIRMATION_REQUIRED', message: '策略激活需要明确人工确认。', nextActions: ['验证策略后携带 confirmation.confirmed=true 重试'] }
      }
      return gridStrategyService.activate(params.versionId, {
        confirmed: params.confirmation?.confirmed,
        confirmedBy: params.confirmation?.confirmedBy,
      }, params.userId)
    },
  },

  'capture.upload_screenshot': {
    name: 'capture.upload_screenshot',
    domain: 'capture',
    version: 'v1',
    description: '将用户提供的 PNG/JPEG/WebP 截图私有保存；仅上传不会识别或改写持仓',
    inputSchema: {
      type: 'object',
      properties: { userId: { type: 'string' }, accountSource: { type: 'string', enum: ['tonghuashun', 'alipay'] }, base64: { type: 'string' }, mimeType: { type: 'string' }, originalFilename: { type: 'string' }, conversationId: { type: 'string' } },
      required: ['userId', 'accountSource', 'base64'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['capture:write']),
    safety: directWriteSafety,
    handler: async (params: any) => screenshotCaptureService.uploadBase64(params),
  },

  'capture.apply_extraction': {
    name: 'capture.apply_extraction',
    domain: 'capture',
    version: 'v1',
    description: '保存 Codex 从截图得到的结构化识别结果并生成逐行差异预览，不写入台账',
    inputSchema: {
      type: 'object',
      properties: { userId: { type: 'string' }, captureId: { type: 'string' }, documentType: { type: 'string', enum: ['holding', 'trade', 'order', 'ordinary_order', 'conditional_order', 'mixed', 'fund_portfolio', 'fund_transaction'] }, rows: { type: 'array', items: { type: 'object' } }, rawText: { type: 'string' } },
      required: ['userId', 'captureId', 'documentType', 'rows'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['capture:write']),
    safety: directWriteSafety,
    handler: async (params: any) => screenshotCaptureService.applyExtraction({ ...params, visionProvider: 'codex_mcp', consentGranted: false }),
  },

  'capture.get_preview': {
    name: 'capture.get_preview',
    domain: 'capture',
    version: 'v1',
    description: '查询截图逐行识别、置信度和台账差异预览',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' }, captureId: { type: 'string' } }, required: ['userId', 'captureId'] },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['capture:read']),
    safety: readSafety,
    handler: async (params: { userId: string; captureId: string }) => screenshotCaptureService.getPreview(params.captureId, params.userId),
  },

  'capture.vision_status': {
    name: 'capture.vision_status',
    domain: 'capture',
    version: 'v1',
    description: '读取截图视觉识别配置状态，不返回密钥',
    inputSchema: { type: 'object', properties: { userId: { type: 'string' } }, required: ['userId'] },
    outputSchema: successEnvelopeSchema,
    permissions: readPermission(['capture:read']),
    safety: readSafety,
    handler: async () => getVisionCaptureStatus(),
  },

  'capture.update_row': {
    name: 'capture.update_row',
    domain: 'capture',
    version: 'v1',
    description: '在确认前修正或忽略截图识别行，并重新执行资产匹配和差异校验',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' }, captureId: { type: 'string' }, rowId: { type: 'string' }, fields: { type: 'object' },
        fieldConfidence: { type: 'object' }, confidence: { type: 'number' }, ignored: { type: 'boolean' }, correctedBy: { type: 'string' },
      },
      required: ['userId', 'captureId', 'rowId', 'correctedBy'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: asyncPermission(['capture:write']),
    safety: directWriteSafety,
    handler: async (params: any) => screenshotCaptureService.updateRow({
      captureId: params.captureId,
      rowId: params.rowId,
      userId: params.userId,
      update: {
        fields: params.fields,
        fieldConfidence: params.fieldConfidence,
        confidence: params.confidence,
        ignored: params.ignored,
        correctedBy: params.correctedBy,
      },
    }),
  },

  'capture.confirm_rows': {
    name: 'capture.confirm_rows',
    domain: 'capture',
    version: 'v1',
    description: '人工确认选定截图行后写入持仓、成交记录或外部委托观察；缺失持仓绝不自动关闭',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string' },
        captureId: { type: 'string' },
        rowIds: { type: 'array', items: { type: 'string' } },
        tradePositionEffectPolicy: { type: 'string', enum: ['apply', 'included_in_latest_snapshot'] },
        confirmation: humanConfirmationSchema,
      },
      required: ['userId', 'captureId', 'confirmation'],
    },
    outputSchema: successEnvelopeSchema,
    permissions: tradeWritePermission(['capture:confirm']),
    safety: confirmedWriteSafety,
    handler: async (params: { userId: string; captureId: string; rowIds?: string[]; tradePositionEffectPolicy?: 'apply' | 'included_in_latest_snapshot'; confirmation?: HumanConfirmation }) => {
      if (!hasHumanConfirmation(params.confirmation)) {
        return { blocked: true, code: 'HUMAN_CONFIRMATION_REQUIRED', message: '截图行写入台账需要明确人工确认。', nextActions: ['检查预览后携带 confirmation.confirmed=true 和确认人重试'] }
      }
      return screenshotCaptureService.confirm({
        captureId: params.captureId,
        userId: params.userId,
        rowIds: params.rowIds,
        confirmed: true,
        confirmedBy: params.confirmation!.confirmedBy!,
        tradePositionEffectPolicy: params.tradePositionEffectPolicy,
      })
    },
  },
}

export const serializeTool = (tool: McpToolDefinition) => ({
  name: tool.name,
  domain: tool.domain,
  version: tool.version,
  description: tool.description,
  inputSchema: tool.inputSchema,
  outputSchema: tool.outputSchema,
  permissions: tool.permissions,
  safety: tool.safety,
  aliases: tool.aliases || [],
})

export const getToolByName = (name: string) => (
  Object.values(mcpTools).find((tool) => tool.name === name || (tool.aliases || []).includes(name))
)

export const buildDomainPackManifest = () => {
  const tools = Object.values(mcpTools).map(serializeTool)
  const domains = [...new Set(tools.map((tool) => tool.domain))].sort()

  return {
    name: 'fams',
    displayName: 'FAMS 投资管理 DomainPack',
    version: 'v2.1.0',
    schemaVersion: 'fams.domainpack.v1',
    transport: {
      http: {
        basePath: '/api/v1/mcp',
        domainPackPath: '/api/v1/mcp/domain-pack',
        toolsPath: '/api/v1/mcp/tools',
        callPath: '/api/v1/mcp/call',
        batchPath: '/api/v1/mcp/batch',
      },
      stdio: {
        status: 'implemented',
        protocol: 'official_mcp_sdk',
        command: 'node',
        args: ['backend/dist/mcp/stdio.js'],
        sourceEntrypoint: 'backend/src/mcp/stdio.ts',
        configPath: 'mcp/financial-mcp.json',
      },
      streamableHttp: {
        status: 'implemented',
        protocol: 'official_mcp_sdk',
        endpoint: 'http://127.0.0.1:4010/mcp',
        loopbackOnly: true,
        sourceEntrypoint: 'backend/src/mcp/streamableHttp.ts',
      },
    },
    profiles: {
      default: 'volatility',
      environmentVariable: 'FAMS_MCP_PROFILE',
      volatility: {
        hostVisionOnly: true,
        excludesBrokerOrderCreation: true,
        executionBoundary: {
          canCreateOrder: false,
          autoTradeUnlocked: false,
          formalTradingUnlocked: false,
        },
      },
      full: { legacyRegistryToolsAvailable: true },
    },
    resources: [
      'fams://volatility/strategy/active',
      'fams://volatility/portfolio/latest-reconciled',
      'fams://volatility/rules',
      'fams://volatility/reviews/{reviewId}',
    ],
    prompts: ['volatility-review'],
    envelope: {
      schemaVersion: 'fams.mcp.call.v1',
      statuses: ['completed', 'blocked', 'failed'],
      success: {
        schemaVersion: 'fams.mcp.call.v1',
        success: true,
        status: 'completed',
        tool: 'requested and resolved tool metadata',
        audit: 'calledAt, requestId, transport, userId, writes, requiresHumanConfirmation',
        result: 'tool result',
      },
      blocked: {
        schemaVersion: 'fams.mcp.call.v1',
        success: true,
        status: 'blocked',
        result: { blocked: true, code: 'HUMAN_CONFIRMATION_REQUIRED', nextActions: ['confirm action'] },
      },
      failure: {
        schemaVersion: 'fams.mcp.call.v1',
        success: false,
        status: 'failed',
        error: { code: 'string', message: 'string', details: 'optional' },
      },
      asyncOperation: {
        operation_id: 'string',
        artifact_refs: ['artifact:type:id'],
        next_actions: ['operation next action'],
      },
    },
    domains,
    tools,
  }
}

export const listMcpTools = () => ({
    schemaVersion: 'fams.mcp.tools.v1',
    tools: Object.values(mcpTools).map(serializeTool),
})

export const callMcpTool = async (
  name: string,
  parameters?: Record<string, unknown>,
  context?: McpCallContext
): Promise<McpCallEnvelope> => {
  const tool = getToolByName(name)

  if (!tool) {
    return buildCallEnvelope(name, parameters, undefined, context, 'failed', {
      error: { code: 'TOOL_NOT_FOUND', message: `Tool '${name}' not found` },
    })
  }

  const resolvedUser = resolveUserContext(tool, parameters, context)

  if (!resolvedUser.ok) {
    return buildCallEnvelope(name, parameters, tool, context, 'failed', {
      error: resolvedUser.error,
      resolvedUser: {
        parameterUserId: resolvedUser.parameterUserId,
        contextUserId: resolvedUser.contextUserId,
      },
    })
  }

  let validatedParameters = resolvedUser.parameters
  if (tool.parameterSchema) {
    const parsed = tool.parameterSchema.safeParse(resolvedUser.parameters)
    if (!parsed.success) {
      return buildCallEnvelope(name, parameters, tool, context, 'failed', {
        error: {
          code: 'INVALID_TOOL_INPUT',
          message: `Tool '${tool.name}' received invalid parameters`,
          details: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })),
        },
        resolvedUser: {
          userId: resolvedUser.userId,
          userContextSource: resolvedUser.userContextSource,
          parameterUserId: resolvedUser.parameterUserId,
          contextUserId: resolvedUser.contextUserId,
        },
      })
    }
    validatedParameters = parsed.data
  }

  try {
    const result = await tool.handler(validatedParameters)
    return buildCallEnvelope(
      name,
      parameters,
      tool,
      context,
      isConfirmationBlock(result) ? 'blocked' : 'completed',
      {
        result,
        resolvedUser: {
          userId: resolvedUser.userId,
          userContextSource: resolvedUser.userContextSource,
          parameterUserId: resolvedUser.parameterUserId,
          contextUserId: resolvedUser.contextUserId,
        },
      }
    )
  } catch (error) {
    return buildCallEnvelope(name, parameters, tool, context, 'failed', {
      error: {
        code: 'TOOL_EXECUTION_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: error instanceof Error ? { name: error.name } : undefined,
      },
      resolvedUser: {
        userId: resolvedUser.userId,
        userContextSource: resolvedUser.userContextSource,
        parameterUserId: resolvedUser.parameterUserId,
        contextUserId: resolvedUser.contextUserId,
      },
    })
  }
}

export const callMcpBatch = async (
  calls: Array<{ name: string; parameters?: Record<string, unknown> }>,
  context?: McpCallContext
) => {
  const results = []

  for (const call of calls) {
    const result = await callMcpTool(call.name, call.parameters, context)
    results.push(result)
  }

  return {
    schemaVersion: 'fams.mcp.batch.v1',
    results,
  }
}
