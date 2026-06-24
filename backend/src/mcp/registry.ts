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

export type PermissionMetadata = {
  userContext: 'required' | 'optional' | 'none'
  scopes: string[]
  writes: boolean
  requiresHumanConfirmation: boolean
}

export type SafetyMetadata = {
  execution: 'read_only' | 'async_operation' | 'write_requires_confirmation'
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
  handler: (params: any) => Promise<any>
}

export type McpCallContext = {
  requestId?: string
  transport?: 'http' | 'stdio'
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
    transport?: 'http' | 'stdio'
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
        operation_id: { type: 'string' },
      },
      required: ['operation_id'],
    },
    outputSchema: operationOutputSchema,
    permissions: readPermission(['operation:read']),
    safety: readSafety,
    handler: async (params: { operation_id: string }) => operationService.getOperation(params.operation_id),
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
    version: 'v2.0.0-alpha.1',
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
        command: 'node',
        args: ['backend/dist/mcp/stdio.js'],
        sourceEntrypoint: 'backend/src/mcp/stdio.ts',
        configPath: 'mcp/financial-mcp.json',
      },
    },
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

  try {
    const result = await tool.handler(resolvedUser.parameters)
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
