import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { volatilityWorkflowService } from '../services/review/volatilityWorkflowService.js'
import {
  gridReplayOperationSchema,
  gridReplayResultQuerySchema,
} from '../services/backtest/gridReplayService.js'
import { callMcpTool, mcpTools, type McpCallEnvelope } from './registry.js'

export type FamsMcpProfile = 'workflow' | 'volatility' | 'full'
export type FamsMcpTransport = 'stdio' | 'streamable_http'

const workflowCaptureShape = {
  userId: z.string().trim().min(1).optional().describe('可选；单用户模式由 FAMS_MCP_DEFAULT_USER_ID 注入'),
  sessionType: z.enum(['open', 'pre_close', 'manual']).optional(),
  holdingsCaptureId: z.string().trim().min(1).optional(),
  tradesCaptureId: z.string().trim().min(1).optional(),
  ordinaryOrdersCaptureId: z.string().trim().min(1).optional(),
  conditionalOrdersCaptureId: z.string().trim().min(1).optional(),
  zeroNewTradesConfirmed: z.boolean().optional(),
  zeroOrdinaryOrdersConfirmed: z.boolean().optional(),
  zeroConditionalOrdersConfirmed: z.boolean().optional(),
}

const reconciliationInput = z.object(workflowCaptureShape).strict()
const singleConfirmationInput = z.object({
  confirmed: z.literal(true), confirmedBy: z.string().trim().min(1), confirmedAt: z.string().datetime(),
  checkHash: z.string().regex(/^[a-f0-9]{64}$/), acknowledgedDraftOnly: z.literal(true),
}).strict()
const runInput = z.object({
  ...workflowCaptureShape,
  idempotencyKey: z.string().trim().min(1).max(160).optional(),
  confirmation: singleConfirmationInput.optional(),
}).strict()
const resultInput = z.object({
  userId: z.string().trim().min(1).optional(),
  operationId: z.string().trim().min(1).optional(),
  reviewId: z.string().trim().min(1).optional(),
  includeHtml: z.boolean().optional(),
}).strict().refine((value) => Number(Boolean(value.operationId)) + Number(Boolean(value.reviewId)) === 1, {
  message: '必须且只能提供 operationId 或 reviewId 之一',
})
const reanchorDecisionInput = z.object({
  userId: z.string().trim().min(1).optional(),
  reviewId: z.string().trim().min(1),
  versionId: z.string().trim().min(1),
  candidateHash: z.string().trim().min(1),
  decision: z.enum(['confirm', 'reject']),
  confirmedBy: z.string().trim().min(1),
  acknowledgedNoBrokerExecution: z.literal(true),
  reason: z.string().trim().max(500).optional(),
}).strict()

const userOnlyInput = z.object({ userId: z.string().trim().min(1).optional() }).strict()
const captureUploadInput = z.object({
  userId: z.string().trim().min(1).optional(),
  accountSource: z.enum(['tonghuashun', 'alipay']).default('tonghuashun').describe('截图所属账户来源（与 registry 同步）'),
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

const volatilityCuratedTools: CuratedDefinition[] = [
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
    description: '使用对账返回的 checkHash 一次确认整包信息后启动；仅生成草案，不会下单。',
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
    name: 'volatility_workflow.decide_reanchor',
    title: '确认固定网格重锚候选',
    description: '逐标的确认或拒绝重锚候选。只有全部候选完成决定后才激活确认版本并生成续跑复盘；不会创建券商订单。',
    inputSchema: reanchorDecisionInput,
    readOnly: false,
    destructive: false,
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
  {
    name: 'backtest.grid_replay.list_sources',
    title: '列出可回放网格来源',
    description: '列出有持仓或保存网格的资产、真实行情覆盖和阻断项；只读且不会创建订单。',
    inputSchema: userOnlyInput,
    readOnly: true,
    idempotent: true,
  },
  {
    name: 'backtest.grid_replay.run',
    title: '运行波动网格回放',
    description: '按保存时点、有效期、父子单、T+1、整手和费用回放；日内缺分钟线会返回证据不足。',
    inputSchema: gridReplayOperationSchema.extend({
      userId: z.string().trim().min(1).optional().describe('可选；由 FAMS_MCP_DEFAULT_USER_ID 注入'),
    }),
    readOnly: false,
    idempotent: true,
  },
  {
    name: 'backtest.grid_replay.get_result',
    title: '获取波动网格回放结果',
    description: '按 operationId 获取回放曲线、质量判断、证据状态和输入哈希；不会重跑。',
    inputSchema: gridReplayResultQuerySchema.extend({
      userId: z.string().trim().min(1).optional().describe('可选；由 FAMS_MCP_DEFAULT_USER_ID 注入'),
    }),
    readOnly: true,
    idempotent: true,
  },
]

const ledgerToolTitles: Record<string, string> = {
  'trade_ledger.get_ingestion_batch': '查看事实采集批次',
  'trade_ledger.run_reconciliation': '保存交易事实对账',
  'trade_ledger.get_reconciliation': '查看不可变对账运行',
  'trade_ledger.list_pending_matches': '查看待确认计划匹配',
  'trade_ledger.confirm_execution_match': '确认计划与成交关系',
  'trade_ledger.get_plan_lifecycle': '查看人工计划生命周期',
  'investment_workflow.get_strategy_run': '查看不可变策略运行',
}

function curatedRegistryDefinition(name: string, title: string): CuratedDefinition {
  const tool = mcpTools[name]
  if (!tool?.parameterSchema) throw new Error(`Curated MCP tool '${name}' must define a Zod parameter schema`)
  if (!(tool.parameterSchema instanceof z.ZodObject)) {
    throw new Error(`Curated MCP tool '${name}' must use an object parameter schema`)
  }
  return {
    name,
    title,
    description: tool.description,
    inputSchema: tool.parameterSchema.extend({
      userId: z.string().trim().min(1).optional().describe('可选；由 FAMS_MCP_DEFAULT_USER_ID 或 HTTP 用户上下文注入'),
    }),
    readOnly: !tool.permissions.writes,
    // Human confirmation and destructive impact are separate MCP hints. These
    // curated tools only record local facts/decisions; none talks to a broker.
    destructive: name.includes('delete') || name.includes('transaction.create'),
    idempotent: !tool.permissions.writes || name.includes('get_') || name.includes('list_') || name.includes('run_reconciliation'),
  }
}

volatilityCuratedTools.push(...Object.entries(ledgerToolTitles).map(([name, title]) => curatedRegistryDefinition(name, title)))

const workflowToolTitles: Record<string, string> = {
  'investment_workflow.get_readiness': '查看三段工作流状态',
  'investment_workflow.list_strategy_assignments': '查看策略归属',
  'investment_workflow.suggest_strategy_assignments': '生成策略归属建议',
  'investment_workflow.confirm_strategy_assignment': '确认策略归属',
  'investment_workflow.run_rotation_volatility_strategy': '运行轮动与波动仓策略',
  'investment_workflow.get_dividend_low_vol_plan': '查看红利低波建议',
  'investment_workflow.refresh_dividend_low_vol_research': '刷新红利低波研究',
  'investment_workflow.get_portfolio_state': '查看投资组合状态',
  'investment_workflow.preflight_portfolio_review': '检查投资组合复盘条件',
  'investment_workflow.start_portfolio_review': '启动投资组合复盘',
  'investment_workflow.get_portfolio_review': '获取投资组合复盘',
  'investment_workflow.compare_saved_advice_scenarios': '比较建议与实际表现',
  'backtest.grid_replay.list_sources': '列出可回放网格来源',
  'backtest.grid_replay.run': '运行波动网格回放',
  'backtest.grid_replay.get_result': '获取波动网格回放结果',
  ...ledgerToolTitles,
}

const workflowRegistryTools: CuratedDefinition[] = Object.entries(workflowToolTitles)
  .map(([name, title]) => curatedRegistryDefinition(name, title))

const workflowSupportToolNames = new Set([
  'capture.upload_screenshot',
  'capture.apply_extraction',
  'capture.get_preview',
  'capture.update_row',
  'capture.confirm_rows',
  'market_data.get_asset_trend',
  'operation.get',
])

const workflowCuratedTools: CuratedDefinition[] = [
  ...workflowRegistryTools,
  ...volatilityCuratedTools.filter((tool) => workflowSupportToolNames.has(tool.name)),
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
  const normalized = (value || 'workflow').trim().toLowerCase()
  if (normalized !== 'workflow' && normalized !== 'volatility' && normalized !== 'full') {
    throw new Error(`Unsupported FAMS_MCP_PROFILE '${value}'. Expected workflow, volatility or full.`)
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
  profile: FamsMcpProfile,
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
      'fams/profile': profile,
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
      inputSchema: (tool.parameterSchema || z.record(z.unknown()).default({})) as any,
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
    version: '2.2.0',
  }, {
    instructions: profile === 'workflow'
      ? [
          '这是 FAMS 对外主工作流：基本信息确认 -> 仓位策略 -> 回测复盘。',
          '每次先调用 investment_workflow.get_readiness，只执行其数据和确认条件允许的下一步。',
          '同花顺资产按行业轮动与波动仓或红利低波处理；支付宝资产按投资组合策略处理。',
          '截图必须由宿主识别、服务端预览、用户确认后才能写入账户事实。',
          '策略归属、长任务和持久化复盘必须取得用户明确确认；回测缺数据时必须返回 insufficient。',
          '所有结果仅用于研究、观察和人工计划；formalTradingUnlocked=false，autoTradeUnlocked=false，canCreateOrder=false，orderCreateAllowed=false。',
        ].join('\n')
      : [
          '这是单用户、仅研究/提醒/拟单的波动仓管理服务。',
          '宿主若能看图，应直接识别截图并用 capture.apply_extraction 提交结构化事实。',
          '运行前先调用 volatility_workflow.reconcile，历史成交已体现在快照里，不得重复扣加。',
          '所有买卖单都是人工草案；canCreateOrder=false，autoTradeUnlocked=false。',
        ].join('\n'),
  })

  const registered = new Set<string>()
  const profileTools = profile === 'workflow' ? workflowCuratedTools : volatilityCuratedTools
  for (const definition of profileTools) {
    registerTool(server, definition, defaultUserId, options.transport, profile)
    registered.add(definition.name)
  }
  if (profile === 'full') registerFullProfileTools(server, registered, defaultUserId, options.transport)

  server.registerResource('grid-replay-rules', 'fams://backtest/grid-replay/rules', {
    title: '波动网格回放规则',
    description: '成交时序、数据证据、计划替代、父子单、T+1、整手和费用口径。',
    mimeType: 'application/json',
  }, async (uri) => jsonResource(uri.href, {
    schemaVersion: 'fams.backtest.grid_replay_rules.v2',
    activation: {
      preOpen: '开盘前保存的计划可用当日日线高低价判断触发。',
      intraday: '盘中保存的计划只用生成时刻之后的分钟线；无分钟线时标记 insufficient_intraday_evidence，不算未命中。',
      afterClose: '收盘后保存的计划从下一交易时段开始。',
    },
    validity: '订单只在自身有效期、计划有效期和被新计划替代前的交集内有效。',
    parentChild: '子单必须在父单成交后才激活；日线无法证明同日先后时标记 ambiguous 并排除收益。',
    execution: {
      price: '保存限价叠加方向性滑点。',
      settlement: 'A股股票及权益ETF默认T+1。',
      lot: '买入按计划或市场整手约束向下取整。',
      costs: ['佣金及最低佣金', '卖出印花税（基金/ETF豁免）', '适用时的过户费', '滑点'],
    },
    evaluation: ['相对持有增量收益', '最大回撤差', '完成周期', '利润因子', '换手率', '费用', '平均敞口', '证据置信度'],
    boundary: { formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
  }))

  if (profile !== 'workflow') {
    server.registerResource('volatility-active-strategy', 'fams://volatility/strategy/active', {
    title: '当前波动仓策略',
    description: '用户明确规则、仓位分层、防守网格和现金约束。',
    mimeType: 'application/json',
  }, async (uri) => jsonResource(uri.href, await volatilityWorkflowService.getActiveStrategyResource(defaultUserId)))

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
          '调用 volatility_workflow.reconcile，展示整包事实与 checkHash，让用户仅确认一次。',
          '将该次确认连同 checkHash 传给 volatility_workflow.run，最后用 volatility_workflow.get_result 取回JSON与HTML。',
          '重锚异常在本次流程中只生成不可激活的风险建议，不再要求第二次确认；结论必须明示所有已降级风险项。',
          '不因日内红绿改写全部网格；不重放已体现在持仓快照中的历史成交；不调用任何券商下单能力。',
          userRequest ? `用户补充要求：${userRequest}` : '',
        ].filter(Boolean).join('\n'),
      },
    }],
    }))
  }

  if (profile !== 'volatility') {
    const readWorkflowTool = async (name: string, parameters: Record<string, unknown> = {}) => {
      const envelope = await callMcpTool(name, parameters, {
        transport: options.transport,
        userId: defaultUserId,
        userContextSource: options.transport === 'stdio' ? 'stdio_context' : 'http_header',
      })
      if (envelope.status === 'failed') throw new Error(envelope.error?.message || `MCP resource tool '${name}' failed`)
      return envelope.result
    }

    server.registerResource('investment-workflow-contract', 'fams://investment-workflow/contract', {
      title: 'FAMS 三段投资工作流合同',
      description: '基本信息确认、仓位策略和回测复盘的入口、人工确认点和交易边界。',
      mimeType: 'application/json',
    }, async (uri) => jsonResource(uri.href, {
      schemaVersion: 'fams.investment-workflow.mcp-contract.v1',
      steps: ['basic_information_confirmation', 'position_strategy', 'backtest_review'],
      accountRouting: {
        tonghuashun: ['rotation_volatility', 'dividend_low_vol'],
        alipay: ['portfolio'],
      },
      mandatoryEntryTool: 'investment_workflow.get_readiness',
      confirmationRequiredTools: [
        'capture.confirm_rows',
        'investment_workflow.confirm_strategy_assignment',
        'investment_workflow.refresh_dividend_low_vol_research',
        'investment_workflow.start_portfolio_review',
      ],
      executionBoundary: {
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        canCreateOrder: false,
        orderCreateAllowed: false,
        userMustExecuteInExternalPlatform: true,
      },
    }))

    server.registerResource('investment-workflow-readiness', 'fams://investment-workflow/readiness', {
      title: '当前工作流状态',
      description: '三段工作流的当前步骤、三类策略数据健康、阻断项和交易权限。',
      mimeType: 'application/json',
    }, async (uri) => jsonResource(uri.href, await readWorkflowTool('investment_workflow.get_readiness')))

    server.registerResource('investment-workflow-assignments', 'fams://investment-workflow/assignments', {
      title: '当前策略归属',
      description: '持仓所属三类策略的建议和人工确认状态。',
      mimeType: 'application/json',
    }, async (uri) => jsonResource(uri.href, await readWorkflowTool('investment_workflow.list_strategy_assignments')))

    server.registerResource('investment-workflow-portfolio', 'fams://investment-workflow/portfolio/current', {
      title: '当前支付宝投资组合',
      description: '支付宝持仓、年度配置策略、数据健康和最近复盘。',
      mimeType: 'application/json',
    }, async (uri) => jsonResource(uri.href, await readWorkflowTool('investment_workflow.get_portfolio_state')))

    server.registerPrompt('basic-information-confirmation', {
      title: '基本信息确认工作流',
      description: '按截图证据、逐行预览、人工确认、行情与趋势检查的顺序更新资产事实。',
      argsSchema: {
        accountSource: z.enum(['tonghuashun', 'alipay']),
        userRequest: z.string().trim().max(2000).optional(),
      },
    }, async ({ accountSource, userRequest }) => ({
      description: 'FAMS 基本信息确认工作流提示',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            '先调用 investment_workflow.get_readiness，并读取 fams://investment-workflow/contract。',
            `本轮账户来源为 ${accountSource}。只处理用户实际提供的截图和已确认事实。`,
            '有截图时依次调用 capture.upload_screenshot、capture.apply_extraction、capture.get_preview；向用户展示差异，只有明确确认后才调用 capture.confirm_rows。',
            '同花顺可处理持仓、历史成交、普通委托和条件单；支付宝只把持仓截图作为组合事实，不把交易或委托行混入。',
            '确认后按需要调用 market_data.get_asset_trend 检查最新价、最近完整日线与 MA5/10/30。缺失、过期或来源不明时停止精确人工计划。',
            '最后再次调用 investment_workflow.get_readiness，告诉用户当前缺口和下一步；不得猜测截图内容或重复重放历史成交。',
            userRequest ? `用户补充要求：${userRequest}` : '',
          ].filter(Boolean).join('\n'),
        },
      }],
    }))

    server.registerPrompt('position-strategy', {
      title: '仓位策略工作流',
      description: '按三类资产选择轮动波动、红利低波或投资组合策略，并输出人工计划。',
      argsSchema: {
        strategyFamily: z.enum(['rotation_volatility', 'dividend_low_vol', 'portfolio']),
        userRequest: z.string().trim().max(2000).optional(),
      },
    }, async ({ strategyFamily, userRequest }) => ({
      description: 'FAMS 仓位策略工作流提示',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            '先调用 investment_workflow.get_readiness 和 investment_workflow.list_strategy_assignments。',
            '归属未确认时，先调用 investment_workflow.suggest_strategy_assignments 展示理由；只有用户明确确认后才能调用 investment_workflow.confirm_strategy_assignment。',
            strategyFamily === 'rotation_volatility'
              ? '调用 investment_workflow.run_rotation_volatility_strategy，输出 RRG + MACD + 均线 + 成交量信号、已有网格复核和人工网格草案。'
              : strategyFamily === 'dividend_low_vol'
                ? '优先调用 investment_workflow.get_dividend_low_vol_plan；仅在用户明确要求刷新并确认后调用 investment_workflow.refresh_dividend_low_vol_research，再用 operation.get 跟踪。'
                : '依次调用 investment_workflow.get_portfolio_state、investment_workflow.preflight_portfolio_review；用户确认后调用 investment_workflow.start_portfolio_review，再用 investment_workflow.get_portfolio_review 跟踪。',
            '只输出关注标的、价格/数量草案、有效期、理由和失效条件；不得声称已经下单或成交。',
            userRequest ? `用户补充要求：${userRequest}` : '',
          ].filter(Boolean).join('\n'),
        },
      }],
    }))

    server.registerPrompt('backtest-review', {
      title: '回测复盘工作流',
      description: '比较按建议、不执行建议和实际交易，诚实披露数据与动态重算缺口。',
      argsSchema: {
        sourceType: z.enum(['advice', 'grid_plan']),
        sourceId: z.string().trim().min(1),
        assetId: z.string().trim().min(1).optional(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      },
    }, async ({ sourceType, sourceId, assetId, startDate, endDate }) => ({
      description: 'FAMS 回测复盘工作流提示',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: [
            '先调用 investment_workflow.get_readiness，确认来源证据和行情可用。',
            `调用 investment_workflow.compare_saved_advice_scenarios：sourceType=${sourceType}，sourceId=${sourceId}，startDate=${startDate}，endDate=${endDate}。`,
            sourceType === 'grid_plan'
              ? `同时读取 fams://backtest/grid-replay/rules；先调用 backtest.grid_replay.list_sources，再对资产 ${assetId || '（从来源列表定位该网格计划所属 assetId）'} 调用 backtest.grid_replay.run，随后用 backtest.grid_replay.get_result 读取结果。`
              : '',
            '默认使用 saved_advice_replay；不要把当前未实现的 point_in_time_simulation 描述为已通过。',
            '向用户并列解释 follow_advice/follow_grid、hold_without_action/hold_without_grid、actual_transactions 的累计收益、最大回撤、增量收益、费用、证据置信度、数据日期和阻断原因。',
            '实际流水无法精确对账或共同时间轴不足时，保留 insufficient，不得补造曲线。',
          ].join('\n'),
        },
      }],
    }))
  }

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
