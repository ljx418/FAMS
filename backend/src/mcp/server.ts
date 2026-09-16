import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { volatilityWorkflowService } from '../services/review/volatilityWorkflowService.js'
import { callMcpTool, mcpTools, type McpCallEnvelope } from './registry.js'

export type FamsMcpProfile = 'volatility' | 'full'
export type FamsMcpTransport = 'stdio' | 'streamable_http'

const workflowCaptureShape = {
  userId: z.string().trim().min(1).optional().describe('可选；单用户模式由 FAMS_MCP_DEFAULT_USER_ID 注入'),
  sessionType: z.enum(['open', 'pre_close', 'manual']).optional(),
  holdingsCaptureId: z.string().trim().min(1).optional(),
  tradesCaptureId: z.string().trim().min(1).optional(),
  ordinaryOrdersCaptureId: z.string().trim().min(1).optional(),
  conditionalOrdersCaptureId: z.string().trim().min(1).optional(),
  zeroNewTradesConfirmed: z.boolean().optional(),
}

const reconciliationInput = z.object(workflowCaptureShape).strict()
const runInput = z.object({
  ...workflowCaptureShape,
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
}).strict()
const resultInput = z.object({
  userId: z.string().trim().min(1).optional(),
  operationId: z.string().trim().min(1).optional(),
  reviewId: z.string().trim().min(1).optional(),
  includeHtml: z.boolean().optional(),
}).strict().refine((value) => Number(Boolean(value.operationId)) + Number(Boolean(value.reviewId)) === 1, {
  message: '必须且只能提供 operationId 或 reviewId 之一',
})

const userOnlyInput = z.object({ userId: z.string().trim().min(1).optional() }).strict()
const captureUploadInput = z.object({
  userId: z.string().trim().min(1).optional(),
  base64: z.string().min(1).describe('PNG/JPEG/WebP 原始内容的 base64，不含 data URL 前缀'),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
  originalFilename: z.string().trim().max(255).optional(),
  conversationId: z.string().trim().max(160).optional(),
}).strict()
const extractedRowSchema = z.object({
  rowType: z.string().trim().min(1),
  fields: z.record(z.unknown()),
  fieldConfidence: z.record(z.number().min(0).max(1)).optional(),
  confidence: z.number().min(0).max(1).optional(),
}).passthrough()
const captureExtractionInput = z.object({
  userId: z.string().trim().min(1).optional(),
  captureId: z.string().trim().min(1),
  documentType: z.enum(['holding', 'trade', 'order', 'ordinary_order', 'conditional_order', 'mixed', 'fund_portfolio', 'fund_transaction']),
  rows: z.array(extractedRowSchema).min(1),
  rawText: z.string().optional(),
}).strict()
const captureIdInput = z.object({
  userId: z.string().trim().min(1).optional(),
  captureId: z.string().trim().min(1),
}).strict()
const captureUpdateInput = z.object({
  userId: z.string().trim().min(1).optional(),
  captureId: z.string().trim().min(1),
  rowId: z.string().trim().min(1),
  fields: z.record(z.unknown()).optional(),
  fieldConfidence: z.record(z.number().min(0).max(1)).optional(),
  confidence: z.number().min(0).max(1).optional(),
  ignored: z.boolean().optional(),
  correctedBy: z.string().trim().min(1),
}).strict()
const captureConfirmInput = z.object({
  userId: z.string().trim().min(1).optional(),
  captureId: z.string().trim().min(1),
  rowIds: z.array(z.string().trim().min(1)).optional(),
  tradePositionEffectPolicy: z.enum(['apply', 'included_in_latest_snapshot']).optional(),
  confirmation: z.object({
    confirmed: z.literal(true),
    confirmedBy: z.string().trim().min(1),
    confirmedAt: z.string().datetime().optional(),
    reason: z.string().trim().max(500).optional(),
  }).strict(),
}).strict()
const operationInput = z.object({
  userId: z.string().trim().min(1).optional(),
  operation_id: z.string().trim().min(1),
}).strict()
const trendInput = z.object({
  userId: z.string().trim().min(1).optional(),
  assetId: z.string().trim().min(1).optional(),
  symbol: z.string().trim().min(1).optional(),
  days: z.number().int().min(30).max(120).optional(),
}).strict().refine((value) => Boolean(value.assetId || value.symbol), '必须提供 assetId 或 symbol')
const reviewIdInput = z.object({
  userId: z.string().trim().min(1).optional(),
  reviewId: z.string().trim().min(1),
}).strict()
const latestReviewInput = z.object({
  userId: z.string().trim().min(1).optional(),
  sessionType: z.enum(['open', 'pre_close', 'manual']).optional(),
}).strict()

const envelopeOutput = z.object({
  schemaVersion: z.literal('fams.mcp.call.v1'),
  success: z.boolean(),
  status: z.enum(['completed', 'blocked', 'failed']),
  tool: z.record(z.unknown()),
  audit: z.record(z.unknown()),
  result: z.unknown().optional(),
  error: z.unknown().optional(),
}).passthrough()

type CuratedDefinition = {
  name: string
  title: string
  description: string
  inputSchema: z.ZodTypeAny
  readOnly: boolean
  destructive?: boolean
  idempotent?: boolean
}

const curatedTools: CuratedDefinition[] = [
  {
    name: 'volatility_workflow.reconcile',
    title: '波动仓对账',
    description: '必须先调用。对账持仓、可卖数量、资金、新成交、普通委托和条件单，返回五部分报告。历史成交不会重放。',
    inputSchema: reconciliationInput,
    readOnly: true,
    idempotent: true,
  },
  {
    name: 'volatility_workflow.run',
    title: '运行波动仓管理工作流',
    description: '一键启动真实行情、30日收盘、MA5/10/30、日频RRG、基本面/消息、策略差异、人工拟单及HTML报告。不会下单。',
    inputSchema: runInput,
    readOnly: false,
    idempotent: true,
  },
  {
    name: 'volatility_workflow.get_result',
    title: '获取波动仓结果',
    description: '按 operationId 或 reviewId 读取运行状态、JSON报告与自包含HTML；不会触发新分析。',
    inputSchema: resultInput,
    readOnly: true,
    idempotent: true,
  },
  {
    name: 'capture.upload_screenshot',
    title: '保存截图',
    description: '保存宿主已看到的截图原文以便审计；不调用服务端OCR，不改写持仓。',
    inputSchema: captureUploadInput,
    readOnly: false,
    idempotent: false,
  },
  {
    name: 'capture.apply_extraction',
    title: '保存宿主识图结果',
    description: '宿主直接看图后提交结构化行，只生成预览，不写入交易台账。',
    inputSchema: captureExtractionInput,
    readOnly: false,
    idempotent: true,
  },
  {
    name: 'capture.get_preview',
    title: '查看识图预览',
    description: '读取逐行字段、置信度、资产匹配和台账差异。',
    inputSchema: captureIdInput,
    readOnly: true,
    idempotent: true,
  },
  {
    name: 'capture.update_row',
    title: '修正识图行',
    description: '在确认前修正或忽略识图行，不执行券商交易。',
    inputSchema: captureUpdateInput,
    readOnly: false,
    idempotent: true,
  },
  {
    name: 'capture.confirm_rows',
    title: '人工确认截图事实',
    description: '需要显式人工确认。写入本地持仓/成交/外部委托观察，但绝不创建券商订单。如成交已体现在持仓快照，必须使用 included_in_latest_snapshot。',
    inputSchema: captureConfirmInput,
    readOnly: false,
    idempotent: true,
  },
  {
    name: 'operation.get',
    title: '查询异步任务',
    description: '查询工作流任务进度。',
    inputSchema: operationInput,
    readOnly: true,
    idempotent: true,
  },
  {
    name: 'market_data.get_asset_trend',
    title: '查询资产趋势',
    description: '查询并缓存最新价、最近30个完整交易日收盘价与MA5/10/30。',
    inputSchema: trendInput,
    readOnly: false,
    idempotent: true,
  },
  {
    name: 'daily_review.get',
    title: '查询复盘',
    description: '按复盘ID读取完整可追溯报告。',
    inputSchema: reviewIdInput,
    readOnly: true,
    idempotent: true,
  },
  {
    name: 'daily_review.get_latest',
    title: '查询最新复盘',
    description: '读取最新的持仓复盘。',
    inputSchema: latestReviewInput,
    readOnly: true,
    idempotent: true,
  },
  {
    name: 'daily_review.export_html',
    title: '获取HTML报告地址',
    description: '返回现有复盘的HTML地址，不重新运行研究。',
    inputSchema: reviewIdInput,
    readOnly: true,
    idempotent: true,
  },
  {
    name: 'grid_strategy.list_templates',
    title: '查看网格模板',
    description: '只读查看声明式网格模板，不激活策略。',
    inputSchema: userOnlyInput,
    readOnly: true,
    idempotent: true,
  },
]

function jsonSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function resolveDefaultUserId() {
  const value = (process.env.FAMS_MCP_DEFAULT_USER_ID || 'default').trim()
  if (!value) throw new Error('FAMS_MCP_DEFAULT_USER_ID must not be empty')
  return value
}

export function resolveMcpProfile(value = process.env.FAMS_MCP_PROFILE): FamsMcpProfile {
  const normalized = (value || 'volatility').trim().toLowerCase()
  if (normalized !== 'volatility' && normalized !== 'full') {
    throw new Error(`Unsupported FAMS_MCP_PROFILE '${value}'. Expected volatility or full.`)
  }
  return normalized
}

async function invokeRegistryTool(
  name: string,
  parameters: Record<string, unknown>,
  defaultUserId: string,
  transport: FamsMcpTransport,
) {
  const envelope = await callMcpTool(name, parameters, {
    transport,
    userId: defaultUserId,
    userContextSource: 'stdio_context',
  })
  const safeEnvelope = jsonSafe(envelope)
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(safeEnvelope, null, 2) }],
    structuredContent: safeEnvelope,
    isError: envelope.status === 'failed',
  }
}

function registerTool(
  server: McpServer,
  definition: CuratedDefinition,
  defaultUserId: string,
  transport: FamsMcpTransport,
) {
  server.registerTool(definition.name, {
    title: definition.title,
    description: definition.description,
    inputSchema: definition.inputSchema as any,
    outputSchema: envelopeOutput,
    annotations: {
      title: definition.title,
      readOnlyHint: definition.readOnly,
      destructiveHint: definition.destructive === true,
      idempotentHint: definition.idempotent === true,
      openWorldHint: false,
    },
    _meta: {
      'fams/profile': 'volatility',
      'fams/executionBoundary': volatilityWorkflowService.getExecutionBoundary(),
    },
  }, async (args: unknown) => invokeRegistryTool(definition.name, args as Record<string, unknown>, defaultUserId, transport))
}

function registerFullProfileTools(server: McpServer, registered: Set<string>, defaultUserId: string, transport: FamsMcpTransport) {
  for (const tool of Object.values(mcpTools)) {
    if (registered.has(tool.name)) continue
    server.registerTool(tool.name, {
      title: tool.name,
      description: tool.description,
      inputSchema: z.record(z.unknown()).default({}),
      outputSchema: envelopeOutput,
      annotations: {
        title: tool.name,
        readOnlyHint: !tool.permissions.writes,
        destructiveHint: tool.name.includes('delete') || tool.name.includes('transaction.create'),
        idempotentHint: !tool.permissions.writes,
        openWorldHint: false,
      },
      _meta: {
        'fams/profile': 'full',
        'fams/legacyInputSchema': tool.inputSchema,
        'fams/permissions': tool.permissions,
        'fams/safety': tool.safety,
      },
    }, async (args: unknown) => invokeRegistryTool(tool.name, args as Record<string, unknown>, defaultUserId, transport))
  }
}

function jsonResource(uri: string, value: unknown, mimeType = 'application/json') {
  return {
    contents: [{
      uri,
      mimeType,
      text: mimeType === 'application/json' ? JSON.stringify(jsonSafe(value), null, 2) : String(value),
    }],
  }
}

export function createFamsMcpServer(options: {
  profile?: FamsMcpProfile
  defaultUserId?: string
  transport: FamsMcpTransport
}) {
  const profile = options.profile || resolveMcpProfile()
  const defaultUserId = options.defaultUserId?.trim() || resolveDefaultUserId()
  const server = new McpServer({
    name: 'financial-asset-manager',
    version: '2.1.0',
  }, {
    instructions: [
      '这是单用户、仅研究/提醒/拟单的波动仓管理服务。',
      '宿主若能看图，应直接识别截图并用 capture.apply_extraction 提交结构化事实。',
      '运行前先调用 volatility_workflow.reconcile，历史成交已体现在快照里，不得重复扣加。',
      '所有买卖单都是人工草案；canCreateOrder=false，autoTradeUnlocked=false。',
    ].join('\n'),
  })

  const registered = new Set<string>()
  for (const definition of curatedTools) {
    registerTool(server, definition, defaultUserId, options.transport)
    registered.add(definition.name)
  }
  if (profile === 'full') registerFullProfileTools(server, registered, defaultUserId, options.transport)

  server.registerResource('volatility-active-strategy', 'fams://volatility/strategy/active', {
    title: '当前波动仓策略',
    description: '用户明确规则、仓位分层、防守网格和现金约束。',
    mimeType: 'application/json',
  }, async (uri) => jsonResource(uri.href, await volatilityWorkflowService.getActiveStrategyResource()))

  server.registerResource('volatility-latest-reconciled-portfolio', 'fams://volatility/portfolio/latest-reconciled', {
    title: '最新已对账组合',
    description: '最新复盘中的对账事实；若尚无复盘则仅读重建对账视图。',
    mimeType: 'application/json',
  }, async (uri) => jsonResource(uri.href, await volatilityWorkflowService.getLatestReconciledResource(defaultUserId)))

  server.registerResource('volatility-rules', 'fams://volatility/rules', {
    title: '波动仓管理规则',
    description: '用户确认规则、待确认项和不可突破的执行边界。',
    mimeType: 'application/json',
  }, async (uri) => jsonResource(uri.href, await volatilityWorkflowService.getRulesResource()))

  const reviewTemplate = new ResourceTemplate('fams://volatility/reviews/{reviewId}', {
    list: undefined,
  })
  server.registerResource('volatility-review', reviewTemplate, {
    title: '波动仓复盘结果',
    description: '按 reviewId 读取已生成的JSON复盘，不会重跑工作流。',
    mimeType: 'application/json',
  }, async (uri, variables) => jsonResource(
    uri.href,
    await volatilityWorkflowService.getReviewResource(String(variables.reviewId), defaultUserId),
  ))

  server.registerPrompt('volatility-review', {
    title: '运行每日波动仓复盘',
    description: '指引宿主按先对账、后研究、再生成人工拟单的固定流程。',
    argsSchema: {
      sessionType: z.enum(['open', 'pre_close', 'manual']).optional(),
      userRequest: z.string().trim().max(2000).optional(),
    },
  }, async ({ sessionType, userRequest }) => ({
    description: '波动仓管理工作流提示',
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: [
          `请以 ${sessionType || 'manual'} 时段运行波动仓工作流。`,
          '先阅读 fams://volatility/strategy/active 和 fams://volatility/rules。',
          '如宿主能看到用户截图，由宿主识别后依次调用 capture.upload_screenshot、capture.apply_extraction、capture.get_preview；只有用户明确确认才调用 capture.confirm_rows。',
          '如宿主无视觉能力，不得猜测截图内容；让 volatility_workflow.reconcile 返回 HOST_VISION_REQUIRED。',
          '调用 volatility_workflow.reconcile，检查已确认事实、对账差异、待确认规则、拟保留/撤销/新增订单和执行权限。',
          '再调用 volatility_workflow.run，最后用 volatility_workflow.get_result 取回JSON与HTML。',
          '不因日内红绿改写全部网格；不重放已体现在持仓快照中的历史成交；不调用任何券商下单能力。',
          userRequest ? `用户补充要求：${userRequest}` : '',
        ].filter(Boolean).join('\n'),
      },
    }],
  }))

  return server
}

export function mcpEnvelopeIsSafe(envelope: McpCallEnvelope) {
  const boundary = (envelope.result as any)?.executionBoundary
  return !boundary || (
    boundary.canCreateOrder === false
    && boundary.autoTradeUnlocked === false
    && boundary.formalTradingUnlocked === false
  )
}
