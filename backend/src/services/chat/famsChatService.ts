import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dividendLowVolStrategyService } from '../dividend-low-vol/dividendLowVolStrategyService.js'
import { operationService } from '../operation/operationService.js'
import { positionService } from '../position/positionService.js'
import { portfolioStrategyRegistry } from '../portfolio-backtest/portfolioStrategyRegistry.js'
import { piAgentCoreAdapter } from './piAgentCoreAdapter.js'
import type {
  FamsChatActionCard,
  FamsChatConfirmationInput,
  FamsChatIntent,
  FamsChatMessageInput,
  FamsChatResponse,
  FamsChatTool,
} from './famsChatTypes.js'

const DEFAULT_USER_ID = 'default'
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']
const ALLOWED_ACTIONS = ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT']

type PendingConfirmation = {
  confirmationId: string
  conversationId: string
  userId: string
  toolName: string
  args: Record<string, unknown>
  createdAt: string
}

const pendingConfirmations = new Map<string, PendingConfirmation>()
const CHAT_SESSION_DIR = resolve(process.cwd(), 'data', 'gpt-audit', 'chat-sessions')

type ChatSessionRecord = {
  schemaVersion: 'fams.chat.session_audit.v1'
  conversationId: string
  userId: string
  createdAt: string
  updatedAt: string
  messages: Array<{
    id: string
    role: 'user' | 'assistant' | 'tool'
    text: string
    createdAt: string
    response?: FamsChatResponse
    metadata?: Record<string, unknown>
  }>
  toolConfirmations: Array<{
    confirmationId: string
    toolName: string
    status: 'pending' | 'confirmed' | 'missing' | 'blocked'
    createdAt: string
    resolvedAt?: string
    blockedReasons?: string[]
  }>
  allowedActions: string[]
  prohibitedActions: string[]
  notTradingAdvice: true
}

function normalizeMessage(input: string) {
  return input.trim().toLowerCase()
}

function makeCard(input: Omit<FamsChatActionCard, 'id'> & { id?: string }): FamsChatActionCard {
  return {
    id: input.id || randomUUID(),
    ...input,
  }
}

function summarizeCandidate(candidate: any, index: number) {
  const identity = candidate.identity || {}
  const scores = candidate.scores || {}
  const dividend = candidate.dividend || {}
  const timing = candidate.timing || {}
  const leaderStatus = candidate.leaderEvidence?.leaderVerificationStatus || candidate.leaderVerificationStatus || 'unknown'
  return [
    `${index + 1}. ${identity.symbol || '-'} ${identity.name || ''}`,
    `综合分 ${scores.evidenceAdjustedScore ?? 'n/a'}`,
    `股息率 ${dividend.ttmDividendYield != null ? `${(Number(dividend.ttmDividendYield) * 100).toFixed(2)}%` : 'n/a'}`,
    `低位分 ${timing.lowZoneScore ?? scores.lowZoneScore ?? 'n/a'}`,
    `龙头状态 ${leaderStatus}`,
    `结论 ${candidate.disposition || 'watch'}`,
  ].join('｜')
}

class FamsChatService {
  private tools: FamsChatTool[] = [
    {
      name: 'portfolio.summary.read',
      label: '读取组合摘要',
      description: '读取当前用户持仓数量、总市值、盈亏和现金权重。',
      risk: 'read',
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const summary = await positionService.getPositionSummary(userId)
        return {
          reply: [
            `当前组合共有 ${summary.positionsCount} 个持仓。`,
            `总市值约 ${summary.totalValue.toFixed(2)}，总成本 ${summary.totalCost.toFixed(2)}，浮动盈亏 ${summary.totalPnl.toFixed(2)}（${summary.totalPnlPercent.toFixed(2)}%）。`,
            `现金权重 ${summary.cashWeight.toFixed(2)}%。`,
          ].join('\n'),
          actionCards: [
            makeCard({
              type: 'navigation',
              title: '打开仓位管理',
              description: '查看每个持仓、成本、市值和标签。',
              href: '/positions',
              status: 'ready',
            }),
          ],
        }
      },
    },
    {
      name: 'dividendLowVol.candidates.read',
      label: '读取红利低波候选',
      description: '读取已持久化红利低波候选池并返回综合分靠前的研究候选。',
      risk: 'read',
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const topN = Math.max(1, Math.min(10, Number(args.topN || 3)))
        const pool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
          limit: Math.max(topN, Math.min(6000, Number(args.limit || 120))),
          scope: 'all_latest_by_symbol',
        })
        const candidates = (pool.candidates || [])
          .filter((candidate: any) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
          .sort((left: any, right: any) => (right.scores?.evidenceAdjustedScore || 0) - (left.scores?.evidenceAdjustedScore || 0))
          .slice(0, topN)
        const reply = candidates.length > 0
          ? `当前红利低波候选池综合分靠前的 ${candidates.length} 个研究候选：\n${candidates.map(summarizeCandidate).join('\n')}\n\n这些是研究候选，不是正式买入建议。`
          : '当前没有可展示的红利低波研究候选。建议先刷新候选池或检查数据缺口。'
        return {
          reply,
          actionCards: [
            makeCard({
              type: 'navigation',
              title: '打开红利低波策略',
              description: '查看候选池、买卖观察区间、数据证据和交易 gate。',
              href: '/dividend-low-vol',
              status: 'ready',
            }),
          ],
        }
      },
    },
    {
      name: 'operations.status.read',
      label: '读取任务状态',
      description: '读取最近任务状态、进度和 artifact。',
      risk: 'read',
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const operations = await operationService.listOperations({ userId, limit: 5 })
        const lines = operations.map((operation: any, index: number) => {
          return `${index + 1}. ${operation.type}｜${operation.status}｜${operation.progressPct ?? 0}%｜${operation.progressMessage || ''}`
        })
        return {
          reply: lines.length > 0 ? `最近任务：\n${lines.join('\n')}` : '当前没有找到最近任务。',
          actionCards: [
            makeCard({
              type: 'navigation',
              title: '打开任务中心',
              description: '查看任务进度、下一步动作和审计 artifact。',
              href: '/operations',
              status: 'ready',
            }),
          ],
        }
      },
    },
    {
      name: 'portfolioBacktest.templates.read',
      label: '读取组合回测模板',
      description: '读取可比较的组合策略模板。',
      risk: 'read',
      execute: async () => {
        const templates = portfolioStrategyRegistry.listPresetTemplates()
        return {
          reply: `当前可用策略模板：${templates.map((template: any) => template.displayName || template.strategyId).join('、')}。你可以在策略回测页选择时间段和参数运行真实数据回测。`,
          actionCards: [
            makeCard({
              type: 'navigation',
              title: '打开策略回测',
              description: '配置起止日期、组合模板、数据等级和 benchmark。',
              href: '/backtest',
              status: 'ready',
            }),
          ],
        }
      },
    },
    {
      name: 'dividendLowVol.scan.start',
      label: '启动红利低波扫描',
      description: '启动红利低波候选池扫描 Operation。',
      risk: 'confirm_required',
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const operation = await operationService.startDividendLowVolDailyScanOperation({
          userId,
          limit: Math.max(10, Math.min(6000, Number(args.limit || 120))),
          universe: args.universe === 'all_a' ? 'all_a' : 'provided_symbols',
          executionMode: 'queued',
          createdBy: 'chatbox',
        })
        return {
          reply: `已提交红利低波扫描任务：${operation.id}。你可以在任务中心跟踪进度。`,
          operationId: operation.id,
          actionCards: [
            makeCard({
              type: 'navigation',
              title: '查看扫描任务',
              description: `任务 ${operation.id} 已进入 Operation 队列。`,
              href: '/operations',
              status: 'completed',
            }),
          ],
        }
      },
    },
    {
      name: 'manualDraft.create',
      label: '生成人工计划草案',
      description: '生成红利低波人工计划草案；不创建订单，不释放正式交易动作。',
      risk: 'confirm_required',
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const topN = Math.max(1, Math.min(10, Number(args.topN || 3)))
        const internalApiBase = process.env.FAMS_INTERNAL_API_BASE || process.env.FAMS_API_BASE || 'http://127.0.0.1:4000'
        const response = await fetch(`${internalApiBase}/api/v1/strategy/dividend-low-vol/manual-trade-draft`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, topN, requestedBy: 'chatbox' }),
        }).then((res) => res.json() as Promise<any>)
        return {
          reply: `已生成红利低波人工计划草案 ${response.draftId || ''}。该草案不能作为下单指令，正式交易仍被锁定。`,
          artifactRefs: response.artifactRef?.path ? [response.artifactRef.path] : [],
          actionCards: [
            makeCard({
              type: 'navigation',
              title: '打开红利低波策略',
              description: '查看草案、复核路径和交易 gate。',
              href: '/dividend-low-vol',
              status: 'completed',
            }),
          ],
        }
      },
    },
    {
      name: 'trade.action.blocked',
      label: '交易动作阻断',
      description: '解释为什么不能通过 ChatBox 释放正式交易动作。',
      risk: 'blocked',
      execute: async () => ({
        reply: '正式 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 当前全部禁止。ChatBox 只能做研究、观察、比较、提醒和人工计划草案；实际交易必须等待 formal validation 与人工审批。',
        blockedReasons: ['formal_trading_locked', 'auto_trade_locked', 'chatbox_order_creation_disabled'],
        actionCards: [
          makeCard({
            type: 'blocked',
            title: '正式交易未解锁',
            description: '当前只能生成研究结论和人工计划草案，不能下单。',
            status: 'blocked',
          }),
        ],
      }),
    },
  ]

  async capabilities() {
    const runtime = await piAgentCoreAdapter.getRuntimeStatus()
    const piToolManifest = piAgentCoreAdapter.buildToolManifest(this.tools)
    return {
      schemaVersion: 'fams.chat.capabilities.v1',
      generatedAt: new Date().toISOString(),
      agentCore: runtime,
      piToolManifest: {
        toolCount: piToolManifest.length,
        executionModes: piToolManifest.map((tool) => ({
          name: tool.name,
          executionMode: tool.executionMode || 'parallel',
        })),
      },
      tools: this.tools.map((tool) => ({
        name: tool.name,
        label: tool.label,
        description: tool.description,
        risk: tool.risk,
      })),
      allowedActions: ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
  }

  async createSession(userId = DEFAULT_USER_ID) {
    const conversationId = `chat-${randomUUID()}`
    await this.ensureSession(conversationId, userId)
    return {
      schemaVersion: 'fams.chat.session.v1',
      conversationId,
      userId,
      createdAt: new Date().toISOString(),
      allowedActions: ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
  }

  async getSessionSnapshot(conversationId: string) {
    const session = await this.readSession(conversationId)
    if (!session) {
      return {
        schemaVersion: 'fams.chat.session_snapshot.v1',
        conversationId,
        status: 'missing',
        messages: [],
        summary: '没有找到该 ChatBox 会话。你可以重新开始对话。',
        allowedActions: ALLOWED_ACTIONS,
        prohibitedActions: PROHIBITED_ACTIONS,
        notTradingAdvice: true,
      }
    }
    return {
      schemaVersion: 'fams.chat.session_snapshot.v1',
      conversationId: session.conversationId,
      userId: session.userId,
      status: 'audited',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      messages: session.messages.slice(-30),
      toolConfirmations: session.toolConfirmations.slice(-20),
      summary: `已恢复最近 ${Math.min(30, session.messages.length)} 条 ChatBox 审计消息。`,
      allowedActions: ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
  }

  async sendMessage(input: FamsChatMessageInput): Promise<FamsChatResponse> {
    const userId = input.userId || DEFAULT_USER_ID
    const conversationId = input.conversationId || `chat-${randomUUID()}`
    await this.appendChatMessage(conversationId, userId, 'user', input.message || '')
    const message = normalizeMessage(input.message || '')
    const intent = this.detectIntent(message)
    const runtime = await piAgentCoreAdapter.getRuntimeStatus()
    const tool = this.selectTool(intent)

    if (!tool) {
      return this.auditedResponse(userId, {
        conversationId,
        intent: 'capability_help',
        confidence: 0.55,
        reply: '我可以帮你查看组合、筛选红利低波候选、解释交易 gate、启动需要确认的扫描任务，并引导你到策略回测页面。',
        actionCards: this.defaultActionCards(),
        requiresConfirmation: false,
        runtimeAvailable: runtime.runtimeAvailable,
      })
    }

    const args = this.buildToolArgs(intent, userId, input.context || {})
    if (tool.risk === 'blocked') {
      const blocked = await tool.execute(args)
      return this.auditedResponse(userId, {
        conversationId,
        intent,
        confidence: 0.92,
        reply: blocked.reply,
        actionCards: blocked.actionCards || [],
        blockedReasons: blocked.blockedReasons || ['blocked_by_trade_gate'],
        requiresConfirmation: false,
        runtimeAvailable: runtime.runtimeAvailable,
      })
    }

    if (tool.risk === 'confirm_required') {
      const confirmationId = `confirm-${randomUUID()}`
      pendingConfirmations.set(confirmationId, {
        confirmationId,
        conversationId,
        userId,
        toolName: tool.name,
        args,
        createdAt: new Date().toISOString(),
      })
      await this.appendToolConfirmation(conversationId, userId, {
        confirmationId,
        toolName: tool.name,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
      return this.auditedResponse(userId, {
        conversationId,
        intent,
        confidence: 0.86,
        reply: `该操作会启动任务或生成审计草案，需要你确认后执行：${tool.label}。`,
        actionCards: [
          makeCard({
            type: 'tool_confirmation',
            title: `确认执行：${tool.label}`,
            description: `${tool.description} 该操作不会创建订单，也不会释放正式交易动作。`,
            toolName: tool.name,
            confirmationId,
            status: 'requires_confirmation',
          }),
        ],
        requiresConfirmation: true,
        runtimeAvailable: runtime.runtimeAvailable,
      })
    }

    const result = await tool.execute(args)
    return this.auditedResponse(userId, {
      conversationId,
      intent,
      confidence: 0.9,
      reply: result.reply,
      actionCards: result.actionCards || [],
      operationId: result.operationId,
      artifactRefs: result.artifactRefs || [],
      blockedReasons: result.blockedReasons || [],
      requiresConfirmation: false,
      runtimeAvailable: runtime.runtimeAvailable,
    })
  }

  async confirmTool(input: FamsChatConfirmationInput): Promise<FamsChatResponse> {
    const pending = pendingConfirmations.get(input.confirmationId)
    const runtime = await piAgentCoreAdapter.getRuntimeStatus()
    if (!pending) {
      const conversationId = input.conversationId || `chat-${randomUUID()}`
      await this.appendToolConfirmation(conversationId, input.userId || DEFAULT_USER_ID, {
        confirmationId: input.confirmationId,
        toolName: 'unknown',
        status: 'missing',
        createdAt: new Date().toISOString(),
        resolvedAt: new Date().toISOString(),
        blockedReasons: ['confirmation_not_found'],
      })
      return this.auditedResponse(input.userId || DEFAULT_USER_ID, {
        conversationId,
        intent: 'capability_help',
        confidence: 0.4,
        reply: '没有找到待确认操作，可能已经执行或已过期。',
        actionCards: [],
        blockedReasons: ['confirmation_not_found'],
        requiresConfirmation: false,
        runtimeAvailable: runtime.runtimeAvailable,
      })
    }
    pendingConfirmations.delete(input.confirmationId)
    const tool = this.tools.find((candidate) => candidate.name === pending.toolName)
    if (!tool) {
      await this.appendToolConfirmation(pending.conversationId, input.userId || pending.userId, {
        confirmationId: input.confirmationId,
        toolName: pending.toolName,
        status: 'missing',
        createdAt: pending.createdAt,
        resolvedAt: new Date().toISOString(),
        blockedReasons: ['tool_not_found'],
      })
      return this.auditedResponse(input.userId || pending.userId, {
        conversationId: pending.conversationId,
        intent: 'capability_help',
        confidence: 0.4,
        reply: '待确认工具不存在，操作已取消。',
        actionCards: [],
        blockedReasons: ['tool_not_found'],
        requiresConfirmation: false,
        runtimeAvailable: runtime.runtimeAvailable,
      })
    }

    const preflight = piAgentCoreAdapter.beforeToolCall(tool.name, tool.risk, true)
    if (preflight?.block) {
      await this.appendToolConfirmation(pending.conversationId, input.userId || pending.userId, {
        confirmationId: input.confirmationId,
        toolName: tool.name,
        status: 'blocked',
        createdAt: pending.createdAt,
        resolvedAt: new Date().toISOString(),
        blockedReasons: [preflight.reason || 'blocked_by_agent_core'],
      })
      return this.auditedResponse(input.userId || pending.userId, {
        conversationId: pending.conversationId,
        intent: 'trade_action_blocked',
        confidence: 0.95,
        reply: preflight.reason || '工具调用被阻断。',
        actionCards: [],
        blockedReasons: [preflight.reason || 'blocked_by_agent_core'],
        requiresConfirmation: false,
        runtimeAvailable: runtime.runtimeAvailable,
      })
    }

    const result = await tool.execute({ ...pending.args, userId: input.userId || pending.userId })
    await this.appendToolConfirmation(pending.conversationId, input.userId || pending.userId, {
      confirmationId: input.confirmationId,
      toolName: tool.name,
      status: 'confirmed',
      createdAt: pending.createdAt,
      resolvedAt: new Date().toISOString(),
    })
    const afterTool = piAgentCoreAdapter.afterToolCall({
      toolName: tool.name,
      operationId: result.operationId,
      artifactRefs: result.artifactRefs || [],
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    })
    return this.auditedResponse(input.userId || pending.userId, {
      conversationId: pending.conversationId,
      intent: this.intentByToolName(tool.name),
      confidence: 0.9,
      reply: result.reply,
      actionCards: result.actionCards || [],
      operationId: result.operationId,
      artifactRefs: result.artifactRefs || [],
      blockedReasons: result.blockedReasons || [],
      metadata: afterTool.details as Record<string, unknown>,
      requiresConfirmation: false,
      runtimeAvailable: runtime.runtimeAvailable,
    })
  }

  private detectIntent(message: string): FamsChatIntent {
    if (/(下单|买入|卖出|加仓|减仓|自动交易|order|auto_trade|add|reduce)/i.test(message)) return 'trade_action_blocked'
    if (/(草案|人工计划|人工计划|draft)/i.test(message)) return 'manual_trade_draft'
    if (/(红利|低波|股息|dividend)/i.test(message) && /(扫描|刷新|更新|scan)/i.test(message)) return 'dividend_low_vol_scan'
    if (/(红利|低波|股息|dividend)/i.test(message)) return 'dividend_low_vol_candidates'
    if (/(回测|backtest|收益曲线|策略比较)/i.test(message)) return 'portfolio_backtest'
    if (/(任务|operation|进度|状态)/i.test(message)) return 'operation_status'
    if (/(组合|持仓|仓位|portfolio|position)/i.test(message)) return 'portfolio_summary'
    return 'capability_help'
  }

  private selectTool(intent: FamsChatIntent) {
    const toolNameByIntent: Partial<Record<FamsChatIntent, string>> = {
      portfolio_summary: 'portfolio.summary.read',
      dividend_low_vol_candidates: 'dividendLowVol.candidates.read',
      dividend_low_vol_scan: 'dividendLowVol.scan.start',
      portfolio_backtest: 'portfolioBacktest.templates.read',
      manual_trade_draft: 'manualDraft.create',
      operation_status: 'operations.status.read',
      trade_action_blocked: 'trade.action.blocked',
    }
    const toolName = toolNameByIntent[intent]
    return toolName ? this.tools.find((tool) => tool.name === toolName) : undefined
  }

  private intentByToolName(toolName: string): FamsChatIntent {
    if (toolName === 'dividendLowVol.scan.start') return 'dividend_low_vol_scan'
    if (toolName === 'manualDraft.create') return 'manual_trade_draft'
    return 'capability_help'
  }

  private buildToolArgs(intent: FamsChatIntent, userId: string, context: Record<string, unknown>) {
    const args: Record<string, unknown> = { userId, ...context }
    if (intent === 'dividend_low_vol_candidates') args.topN = Number(context.topN || 3)
    if (intent === 'manual_trade_draft') args.topN = Number(context.topN || 3)
    if (intent === 'dividend_low_vol_scan') {
      args.limit = Number(context.limit || 120)
      args.universe = context.universe || 'provided_symbols'
    }
    return args
  }

  private defaultActionCards() {
    return [
      makeCard({
        type: 'navigation',
        title: '红利低波策略',
        description: '筛选高股息、行业龙头、低波动候选。',
        href: '/dividend-low-vol',
        status: 'ready',
      }),
      makeCard({
        type: 'navigation',
        title: '策略回测',
        description: '比较组合策略在不同时间段的收益曲线。',
        href: '/backtest',
        status: 'ready',
      }),
      makeCard({
        type: 'navigation',
        title: '任务中心',
        description: '追踪扫描、回测和审计任务。',
        href: '/operations',
        status: 'ready',
      }),
    ]
  }

  private async auditedResponse(userId: string, input: {
    conversationId: string
    intent: FamsChatIntent
    confidence: number
    reply: string
    actionCards: FamsChatActionCard[]
    requiresConfirmation: boolean
    runtimeAvailable: boolean
    operationId?: string
    artifactRefs?: string[]
    blockedReasons?: string[]
    metadata?: Record<string, unknown>
  }): Promise<FamsChatResponse> {
    const response = this.response(input)
    await this.appendChatMessage(input.conversationId, userId, 'assistant', response.reply, response, input.metadata)
    return response
  }

  private response(input: {
    conversationId: string
    intent: FamsChatIntent
    confidence: number
    reply: string
    actionCards: FamsChatActionCard[]
    requiresConfirmation: boolean
    runtimeAvailable: boolean
    operationId?: string
    artifactRefs?: string[]
    blockedReasons?: string[]
  }): FamsChatResponse {
    return {
      schemaVersion: 'fams.chat.response.v1',
      generatedAt: new Date().toISOString(),
      conversationId: input.conversationId,
      messageId: `msg-${randomUUID()}`,
      reply: input.reply,
      intent: input.intent,
      confidence: input.confidence,
      actionCards: input.actionCards,
      requiresConfirmation: input.requiresConfirmation,
      operationId: input.operationId,
      artifactRefs: input.artifactRefs || [],
      blockedReasons: input.blockedReasons || [],
      allowedActions: ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      agentCore: {
        provider: 'pi-agent-core',
        mode: 'deterministic_planner',
        runtimeAvailable: input.runtimeAvailable,
        nodeVersion: process.version,
        note: 'PI AgentCore is integrated as the controlled tool/runtime adapter. Deterministic planner is used until a generic chat LLM is configured.',
      },
      notTradingAdvice: true,
    }
  }

  private async ensureSession(conversationId: string, userId: string) {
    const existing = await this.readSession(conversationId)
    if (existing) return existing
    const now = new Date().toISOString()
    const session: ChatSessionRecord = {
      schemaVersion: 'fams.chat.session_audit.v1',
      conversationId,
      userId,
      createdAt: now,
      updatedAt: now,
      messages: [],
      toolConfirmations: [],
      allowedActions: ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      notTradingAdvice: true,
    }
    await this.writeSession(session)
    return session
  }

  private async appendChatMessage(
    conversationId: string,
    userId: string,
    role: 'user' | 'assistant' | 'tool',
    text: string,
    response?: FamsChatResponse,
    metadata?: Record<string, unknown>,
  ) {
    const session = await this.ensureSession(conversationId, userId)
    const now = new Date().toISOString()
    session.messages.push({
      id: response?.messageId || `${role}-${randomUUID()}`,
      role,
      text,
      createdAt: now,
      response,
      metadata,
    })
    session.updatedAt = now
    await this.writeSession(session)
  }

  private async appendToolConfirmation(
    conversationId: string,
    userId: string,
    confirmation: ChatSessionRecord['toolConfirmations'][number],
  ) {
    const session = await this.ensureSession(conversationId, userId)
    const existingIndex = session.toolConfirmations.findIndex((item) => item.confirmationId === confirmation.confirmationId)
    if (existingIndex >= 0) {
      session.toolConfirmations[existingIndex] = {
        ...session.toolConfirmations[existingIndex],
        ...confirmation,
      }
    } else {
      session.toolConfirmations.push(confirmation)
    }
    session.updatedAt = new Date().toISOString()
    await this.writeSession(session)
  }

  private sessionPath(conversationId: string) {
    const safeId = conversationId.replace(/[^a-zA-Z0-9_-]/g, '_')
    return resolve(CHAT_SESSION_DIR, `${safeId}.json`)
  }

  private async readSession(conversationId: string): Promise<ChatSessionRecord | null> {
    try {
      const raw = await readFile(this.sessionPath(conversationId), 'utf8')
      return JSON.parse(raw) as ChatSessionRecord
    } catch {
      return null
    }
  }

  private async writeSession(session: ChatSessionRecord) {
    await mkdir(CHAT_SESSION_DIR, { recursive: true })
    await writeFile(this.sessionPath(session.conversationId), `${JSON.stringify(session, null, 2)}\n`, 'utf8')
  }
}

export const famsChatService = new FamsChatService()
