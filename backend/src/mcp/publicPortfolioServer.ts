import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { portfolioWorkflowFacade } from '../services/mcp/portfolioWorkflowFacade.js'
import {
  portfolioMcpAuthService,
  type PortfolioMcpPrincipal,
  type PortfolioMcpScope,
} from '../services/mcp/portfolioMcpAuthService.js'

const SERVER_VERSION = '1.0.0'
const publicExecutionBoundary = portfolioWorkflowFacade.getExecutionBoundary()

const confirmationSchema = z.object({
  confirmed: z.literal(true).describe('必须由人类明确设为 true'),
  confirmedBy: z.string().trim().min(1).max(100).describe('执行确认的人类标识'),
  confirmedAt: z.string().datetime().optional().describe('人工确认时间，ISO 8601'),
}).strict()

const extractionRowSchema = z.object({
  rowType: z.enum(['account_summary', 'holding']),
  rawText: z.string().max(2_000).optional().default(''),
  fields: z.record(z.string(), z.unknown()),
  fieldConfidence: z.record(z.string(), z.number().min(0).max(1)).optional().default({}),
  confidence: z.number().min(0).max(1),
}).strict()

const publicToolOutputSchema = z.object({
  schemaVersion: z.string().optional(),
  executionBoundary: z.object({
    planDraftOnly: z.boolean(),
    formalTradingUnlocked: z.literal(false),
    autoTradeUnlocked: z.literal(false),
    canCreateOrder: z.literal(false),
    orderCreateAllowed: z.literal(false),
  }).optional(),
}).passthrough()

const asRecord = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  return { value }
}

const summarize = (toolName: string, value: Record<string, unknown>) => {
  if (toolName === 'portfolio_get_current_state') {
    return `当前仓位已读取：${Number(value.positionCount || 0)} 个持仓，总值 ${Number(value.totalValue || 0).toFixed(2)} 元。`
  }
  if (toolName === 'portfolio_review_preflight') {
    return value.canRun === true ? '仓位复盘预检通过，可以启动分析。' : `仓位复盘被阻断：${(value.blockers as unknown[] || []).join('、')}`
  }
  if (toolName === 'portfolio_review_start') {
    return value.started === true ? `仓位复盘已受理，任务 ${String(value.operationId || '')}。` : '仓位复盘未启动，请先处理预检阻断项。'
  }
  if (toolName === 'portfolio_review_get') {
    const operation = value.operation as Record<string, unknown> | undefined
    return `仓位复盘状态：${String(operation?.status || 'unknown')}，进度 ${Number(operation?.progressPct || 0)}%。`
  }
  return '请求已完成；详细结果见 structuredContent。'
}

const successResult = (toolName: string, value: unknown): CallToolResult => {
  const data = asRecord(value)
  return {
    content: [{ type: 'text' as const, text: summarize(toolName, data) }],
    structuredContent: data,
  }
}

const errorResult = (error: unknown): CallToolResult => {
  const raw = error instanceof Error ? error.message : String(error)
  const recognized = raw.match(/^([A-Z][A-Z0-9_]+)(?::|$)/)
  const code = recognized?.[1] || 'PORTFOLIO_MCP_INTERNAL_ERROR'
  const message = recognized ? raw.slice(0, 500) : '仓位管理服务未能完成请求；内部细节已隐藏，请查看服务端日志。'
  const retryable = ![
    'MCP_SCOPE_REQUIRED',
    'PORTFOLIO_REVIEW_IDEMPOTENCY_USER_CONFLICT',
    'PORTFOLIO_MCP_SCREENSHOT_ROWS_MUST_BE_HOLDINGS_ONLY',
    'PORTFOLIO_MCP_SCREENSHOT_CONFIRM_HOLDINGS_ONLY',
  ].some((prefix) => raw.startsWith(prefix))
  const body = {
    schemaVersion: 'fams.mcp.error.v1',
    success: false,
    code,
    message,
    retryable,
    nextAction: retryable ? '检查数据状态或稍后重试；不要假设操作已经成功。' : '修正请求或权限后重试。',
    executionBoundary: publicExecutionBoundary,
  }
  return {
    isError: true as const,
    content: [{ type: 'text' as const, text: `${body.code}：${body.message}` }],
    structuredContent: body,
  }
}

const requireScope = <T>(
  principal: PortfolioMcpPrincipal,
  scope: PortfolioMcpScope,
  action: () => Promise<T> | T,
) => {
  portfolioMcpAuthService.assertScope(principal, scope)
  return action()
}

const registerTool = <T extends z.ZodRawShape>(
  server: McpServer,
  principal: PortfolioMcpPrincipal,
  name: string,
  config: {
    title: string
    description: string
    inputSchema: T
    scope: PortfolioMcpScope
    readOnly: boolean
    destructive?: boolean
    idempotent?: boolean
  },
  handler: (input: z.infer<z.ZodObject<T>>) => Promise<unknown>,
) => {
  server.registerTool(name, {
    title: config.title,
    description: config.description,
    inputSchema: config.inputSchema,
    outputSchema: publicToolOutputSchema,
    annotations: {
      title: config.title,
      readOnlyHint: config.readOnly,
      destructiveHint: config.destructive === true,
      idempotentHint: config.idempotent === true,
      openWorldHint: false,
    },
  }, (async (input: any) => {
    try {
      const value = await requireScope(principal, config.scope, () => handler(input as z.infer<z.ZodObject<T>>))
      return successResult(name, value)
    } catch (error) {
      return errorResult(error)
    }
  }) as any)
}

export function createPublicPortfolioMcpServer(principal: PortfolioMcpPrincipal) {
  const server = new McpServer({
    name: 'fams-portfolio-management',
    version: SERVER_VERSION,
    websiteUrl: 'http://localhost:3000/daily-reviews',
  })

  registerTool(server, principal, 'portfolio_get_current_state', {
    title: '读取当前仓位',
    description: '当用户询问当前持仓、资产比例、目标偏差或数据时间时调用；只读，不刷新行情，也不生成交易。',
    inputSchema: {
      accountScope: z.enum(['all', 'alipay']).default('all').describe('all 读取全部持仓；alipay 仅读取支付宝持仓'),
    },
    scope: 'portfolio:read',
    readOnly: true,
    idempotent: true,
  }, ({ accountScope }) => portfolioWorkflowFacade.getCurrentState(principal.userId, accountScope))

  registerTool(server, principal, 'portfolio_review_preflight', {
    title: '检查仓位复盘条件',
    description: '启动支付宝仓位复盘前必须调用；检查最新确认截图、台账一致性、数据和模型是否可用。',
    inputSchema: {
      portfolioChangedSinceLastCapture: z.boolean().describe('自最近确认截图后是否发生买卖、分红再投或转账；必须由用户明确回答'),
    },
    scope: 'portfolio:read',
    readOnly: true,
    idempotent: true,
  }, ({ portfolioChangedSinceLastCapture }) => portfolioWorkflowFacade.preflightReview(principal.userId, portfolioChangedSinceLastCapture))

  registerTool(server, principal, 'portfolio_review_start', {
    title: '启动仓位复盘',
    description: '仅在预检通过后启动支付宝仓位分析；创建研究任务和人工计划草案，不会创建交易或券商订单。',
    inputSchema: {
      sessionType: z.enum(['open', 'pre_close', 'manual']).default('manual').describe('开盘后、收盘前或手动复盘'),
      portfolioChangedSinceLastCapture: z.boolean().describe('自最近确认截图后仓位是否变化'),
      idempotencyKey: z.string().trim().min(8).max(160).describe('调用方生成的稳定幂等键；重试必须复用同一值'),
    },
    scope: 'review:run',
    readOnly: false,
    idempotent: true,
  }, (input) => portfolioWorkflowFacade.startReview({ userId: principal.userId, ...input }))

  registerTool(server, principal, 'portfolio_review_get', {
    title: '查询仓位复盘',
    description: '用 portfolio_review_start 返回的 operationId 查询进度和最终结果；运行中按返回的重试间隔再次调用。',
    inputSchema: {
      operationId: z.string().uuid().describe('仓位复盘根任务 ID'),
    },
    scope: 'portfolio:read',
    readOnly: true,
    idempotent: true,
  }, ({ operationId }) => portfolioWorkflowFacade.getReview(principal.userId, operationId))

  registerTool(server, principal, 'portfolio_plan_save_decision', {
    title: '保存人工计划决定',
    description: '人类查看仓位复盘草案后，保存接受、拒绝或修改决定；只保存计划，不创建交易、订单或成交。',
    inputSchema: {
      reviewId: z.string().uuid(),
      actionId: z.string().uuid(),
      decision: z.enum(['accepted', 'rejected', 'modified']),
      overrideAmount: z.number().positive().optional().describe('decision=modified 时必填，且不能超过完整调整金额'),
      notes: z.string().trim().max(500).optional(),
      confirmation: confirmationSchema,
    },
    scope: 'plan:write',
    readOnly: false,
    idempotent: true,
  }, ({ confirmation, ...input }) => portfolioWorkflowFacade.savePlanDecision({
    userId: principal.userId,
    ...input,
    notes: input.notes ? `${input.notes}（确认人：${confirmation.confirmedBy}）` : `确认人：${confirmation.confirmedBy}`,
  }))

  registerTool(server, principal, 'portfolio_screenshot_upload', {
    title: '上传支付宝持仓截图',
    description: '私有保存用户明确提供的支付宝持仓截图；只上传，不识别、不修改仓位，最大 10MB。',
    inputSchema: {
      base64: z.string().min(16).max(14_000_000).describe('PNG/JPEG/WebP 的 Base64 或 data URL'),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
      originalFilename: z.string().trim().max(255).optional(),
    },
    scope: 'capture:write',
    readOnly: false,
    idempotent: true,
  }, (input) => portfolioWorkflowFacade.uploadScreenshot({ userId: principal.userId, ...input }))

  registerTool(server, principal, 'portfolio_screenshot_save_extraction', {
    title: '保存持仓截图识别结果',
    description: '保存支付宝账户汇总和持仓行识别结果并生成差异预览；不接受交易或委托行，不修改台账。',
    inputSchema: {
      captureId: z.string().uuid(),
      rows: z.array(extractionRowSchema).min(1).max(100),
      rawText: z.string().max(50_000).optional(),
    },
    scope: 'capture:write',
    readOnly: false,
    idempotent: true,
  }, (input) => portfolioWorkflowFacade.saveScreenshotExtraction({ userId: principal.userId, ...input }))

  registerTool(server, principal, 'portfolio_screenshot_confirm', {
    title: '确认导入持仓截图',
    description: '人类核对差异预览后确认导入支付宝账户汇总和持仓行；禁止导入交易、委托或创建券商订单。',
    inputSchema: {
      captureId: z.string().uuid(),
      rowIds: z.array(z.string().uuid()).max(100).optional(),
      confirmation: confirmationSchema,
    },
    scope: 'capture:write',
    readOnly: false,
    destructive: true,
    idempotent: true,
  }, ({ captureId, rowIds, confirmation }) => portfolioWorkflowFacade.confirmScreenshot({
    userId: principal.userId,
    captureId,
    rowIds,
    confirmedBy: confirmation.confirmedBy,
  }))

  registerTool(server, principal, 'portfolio_snapshot_authorize_reuse', {
    title: '授权复用持仓截图',
    description: '当用户确认仓位未变化时，授权固定工作流在有效期内复用最近已确认支付宝持仓截图。',
    inputSchema: { captureId: z.string().uuid().optional() },
    scope: 'capture:write',
    readOnly: false,
    idempotent: true,
  }, ({ captureId }) => portfolioWorkflowFacade.authorizeSnapshotReuse(principal.userId, captureId))

  registerTool(server, principal, 'portfolio_snapshot_revoke_reuse', {
    title: '撤销持仓截图复用',
    description: '当仓位、分红再投或资金发生变化时立即撤销截图复用授权，后续分析会要求新截图。',
    inputSchema: { reason: z.string().trim().max(500).optional() },
    scope: 'capture:write',
    readOnly: false,
    idempotent: true,
  }, ({ reason }) => portfolioWorkflowFacade.revokeSnapshotReuse(principal.userId, reason))

  const jsonResource = (uri: string, value: unknown) => ({
    contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }],
  })

  server.registerResource('current-portfolio', 'fams://portfolio/current', {
    title: '当前仓位',
    description: '当前用户的完整持仓、比例及目标偏差',
    mimeType: 'application/json',
  }, async () => jsonResource('fams://portfolio/current', await requireScope(principal, 'portfolio:read', () => portfolioWorkflowFacade.getCurrentState(principal.userId))))

  server.registerResource('current-allocation-contract', 'fams://portfolio/contracts/current', {
    title: '当前仓位策略合同',
    description: '已激活的目标比例、调仓门槛及执行边界',
    mimeType: 'application/json',
  }, async () => {
    const state = await requireScope(principal, 'portfolio:read', () => portfolioWorkflowFacade.getCurrentState(principal.userId, 'alipay'))
    return jsonResource('fams://portfolio/contracts/current', { allocationPlan: state.allocationPlan, executionBoundary: publicExecutionBoundary })
  })

  server.registerResource('latest-portfolio-review', 'fams://portfolio/reviews/latest', {
    title: '最新仓位复盘',
    description: '当前用户最近一次仓位复盘结果',
    mimeType: 'application/json',
  }, async () => jsonResource('fams://portfolio/reviews/latest', await requireScope(principal, 'portfolio:read', () => portfolioWorkflowFacade.getLatestReview(principal.userId))))

  server.registerResource('data-health', 'fams://data-health/current', {
    title: '仓位数据健康度',
    description: '当前价格、分类和截图数据是否足以支撑复盘',
    mimeType: 'application/json',
  }, async () => {
    const state = await requireScope(principal, 'portfolio:read', () => portfolioWorkflowFacade.getCurrentState(principal.userId))
    return jsonResource('fams://data-health/current', { generatedAt: state.generatedAt, dataHealth: state.dataHealth, latestCapture: state.latestConfirmedPortfolioCapture })
  })

  server.registerResource('portfolio-review', new ResourceTemplate('fams://portfolio/reviews/{operationId}', { list: undefined }), {
    title: '指定仓位复盘',
    description: '按仓位复盘根任务 ID 读取进度和结果',
    mimeType: 'application/json',
  }, async (uri, variables) => jsonResource(uri.href, await requireScope(principal, 'portfolio:read', () => portfolioWorkflowFacade.getReview(principal.userId, String(variables.operationId)))))

  server.registerPrompt('daily_portfolio_review', {
    title: '每日仓位复盘',
    description: '指导模型按安全顺序完成一次支付宝仓位复盘，并输出简短、可执行但不自动交易的摘要。',
    argsSchema: {
      sessionType: z.enum(['open', 'pre_close', 'manual']).default('manual'),
      portfolioChangedSinceLastCapture: z.enum(['yes', 'no']).describe('用户必须明确回答最近截图后仓位是否变化'),
    },
  }, async ({ sessionType, portfolioChangedSinceLastCapture }) => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `请执行一次 ${sessionType} 仓位复盘。`,
          `用户声明最近截图后仓位变化：${portfolioChangedSinceLastCapture === 'yes' ? '是' : '否'}。`,
          '若仓位有变化且用户已附图，先由宿主识图并调用 portfolio_screenshot_upload、portfolio_screenshot_save_extraction；向用户展示返回的差异预览，获得明确确认后才调用 portfolio_screenshot_confirm。若没有新截图，直接说明缺少证据并停止。',
          '严格按顺序调用 portfolio_get_current_state、portfolio_review_preflight、portfolio_review_start、portfolio_review_get。',
          '若预检阻断，停止并用中文告诉用户缺少什么，不得虚构分析结果。',
          '最终只汇总当前比例、目标偏差、数据时间、基本面变化、风险和人工计划；不得宣称已下单或已成交。',
          '任何保存人工计划或确认截图的动作都必须先获得人类明确确认。',
        ].join('\n'),
      },
    }],
  }))

  return server
}

export const PUBLIC_PORTFOLIO_MCP_TOOL_NAMES = [
  'portfolio_get_current_state',
  'portfolio_review_preflight',
  'portfolio_review_start',
  'portfolio_review_get',
  'portfolio_plan_save_decision',
  'portfolio_screenshot_upload',
  'portfolio_screenshot_save_extraction',
  'portfolio_screenshot_confirm',
  'portfolio_snapshot_authorize_reuse',
  'portfolio_snapshot_revoke_reuse',
] as const
