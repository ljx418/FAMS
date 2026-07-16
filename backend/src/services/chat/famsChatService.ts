import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../../db/prisma.js'
import { dividendLowVolStrategyService } from '../dividend-low-vol/dividendLowVolStrategyService.js'
import { dividendLowVolTradingZoneService } from '../dividend-low-vol/dividendLowVolTradingZoneService.js'
import { operationService } from '../operation/operationService.js'
import { positionService } from '../position/positionService.js'
import { portfolioBacktestEngine } from '../portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../portfolio-backtest/portfolioBacktestInputBuilder.js'
import { portfolioStrategyRegistry } from '../portfolio-backtest/portfolioStrategyRegistry.js'
import { marketDataFreshnessService } from '../market-data/marketDataFreshnessService.js'
import { piAgentCoreAdapter } from './piAgentCoreAdapter.js'
import { getFamsLlmPublicStatus } from '../../config/llmConfig.js'
import { chatLlmPlannerService } from './chatLlmPlannerService.js'
import { ensureUser } from '../../utils/user.js'
import type {
  FamsChatActionCard,
  FamsChatConfirmationInput,
  FamsChatIntent,
  FamsChatMessageInput,
  FamsChatResponse,
  FamsChatStreamEvent,
  FamsChatStructuredResult,
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
      intent: 'portfolio_summary',
      label: '读取组合摘要',
      description: '读取当前用户持仓数量、总市值、盈亏和现金权重。',
      risk: 'read',
      permissionType: 'read_only_direct',
      confirmationPolicy: 'none',
      auditFields: ['positionsCount', 'totalValue', 'cashWeight', 'notTradingAdvice'],
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const summary = await positionService.getPositionSummary(userId)
        const structuredResult = this.buildPortfolioSummaryStructuredResult(summary)
        return {
          reply: [
            `当前组合共有 ${summary.positionsCount} 个持仓。`,
            `总市值约 ${summary.totalValue.toFixed(2)}，总成本 ${summary.totalCost.toFixed(2)}，浮动盈亏 ${summary.totalPnl.toFixed(2)}（${summary.totalPnlPercent.toFixed(2)}%）。`,
            `现金权重 ${summary.cashWeight.toFixed(2)}%。`,
          ].join('\n'),
          structuredResult,
          dataQualitySummary: structuredResult.dataQualitySummary,
          toolAudit: {
            toolName: 'portfolio.summary.read',
            permissionType: 'read_only_direct',
            formalTradingUnlocked: false,
            autoTradeUnlocked: false,
          },
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
      intent: 'dividend_low_vol_top_candidates',
      label: '读取红利低波候选',
      description: '读取已持久化红利低波候选池并返回综合分靠前的研究候选。',
      risk: 'read',
      permissionType: 'read_only_direct',
      confirmationPolicy: 'none',
      auditFields: ['candidateCount', 'topN', 'evidenceAdjustedScore', 'notTradingAdvice'],
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
        const structuredResult = this.buildCandidateStructuredResult(candidates, pool)
        const reply = candidates.length > 0
          ? `当前红利低波候选池综合分靠前的 ${candidates.length} 个研究候选：\n${candidates.map(summarizeCandidate).join('\n')}\n\n这些是研究候选，不是正式买入建议。`
          : '当前没有可展示的红利低波研究候选。建议先刷新候选池或检查数据缺口。'
        return {
          reply,
          structuredResult,
          dataQualitySummary: structuredResult.dataQualitySummary,
          toolAudit: {
            toolName: 'dividendLowVol.candidates.read',
            permissionType: 'read_only_direct',
            topN,
            candidateCount: candidates.length,
          },
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
      name: 'dividendLowVol.tradingZone.read',
      intent: 'dividend_low_vol_trading_zone',
      label: '读取红利低波买卖观察区间',
      description: '基于已持久化候选事实集和行情序列，解释单票当前所处的建仓观察区、卖出观察区和价格数据可信度。',
      risk: 'read',
      permissionType: 'read_only_direct',
      confirmationPolicy: 'none',
      auditFields: ['symbol', 'currentPrice', 'buyZone', 'sellZone', 'priceAudit', 'notTradingAdvice'],
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const symbol = String(args.symbol || '600887')
        const pool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
          limit: Math.max(120, Math.min(6000, Number(args.limit || 6000))),
          scope: 'all_latest_by_symbol',
        })
        const candidates = (pool.candidates || []).filter((candidate: any) => candidate.identity?.symbol === symbol)
        const zoneResult = candidates.length > 0
          ? dividendLowVolTradingZoneService.buildTradingZonesFromFactSets(candidates, { limit: 1 })
          : {
              schemaVersion: 'dividend.low_vol.trading_zone.v1',
              generatedAt: new Date().toISOString(),
              zones: [],
              summary: { total: 0, actionable: 0, insufficient: 1 },
              allowedActions: ALLOWED_ACTIONS,
              prohibitedActions: PROHIBITED_ACTIONS,
              notTradingAdvice: true,
            }
        const structuredResult = this.buildTradingZoneStructuredResult(symbol, zoneResult)
        const zone = (zoneResult as any).zones?.[0]
        const mainStrategy = zone?.strategies?.[0]
        const reply = zone
          ? [
              `${symbol} 当前红利低波观察区间：`,
              `当前价 ${this.formatNumber(zone.priceAudit?.currentPrice)}，价格数据状态 ${zone.priceAudit?.sanityStatus || 'unknown'}。`,
              mainStrategy
                ? `${mainStrategy.label}：建仓观察 ${this.formatNumber(mainStrategy.buyZoneLow)} - ${this.formatNumber(mainStrategy.buyZoneHigh)}，卖出观察 ${this.formatNumber(mainStrategy.sellZoneLow)} - ${this.formatNumber(mainStrategy.sellZoneHigh)}，当前信号 ${mainStrategy.currentSignal}。`
                : '当前没有足够策略区间。',
              '这些区间是研究观察区，不是正式 ADD / REDUCE 指令。',
            ].join('\n')
          : `${symbol} 当前没有可用的红利低波事实集或行情序列，不能给出观察区间。`
        return {
          reply,
          structuredResult,
          dataQualitySummary: structuredResult.dataQualitySummary,
          blockedReasons: structuredResult.blockedReasons,
          toolAudit: {
            toolName: 'dividendLowVol.tradingZone.read',
            permissionType: 'read_only_direct',
            symbol,
            zoneCount: (zoneResult as any).zones?.length || 0,
          },
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
      intent: 'operation_status',
      label: '读取任务状态',
      description: '读取最近任务状态、进度和 artifact。',
      risk: 'read',
      permissionType: 'read_only_direct',
      confirmationPolicy: 'none',
      auditFields: ['operationCount', 'status', 'artifactRefs', 'notTradingAdvice'],
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const operations = await operationService.listOperations({ userId, limit: 5 })
        const lines = operations.map((operation: any, index: number) => {
          return `${index + 1}. ${operation.type}｜${operation.status}｜${operation.progressPct ?? 0}%｜${operation.progressMessage || ''}`
        })
        return {
          reply: lines.length > 0 ? `最近任务：\n${lines.join('\n')}` : '当前没有找到最近任务。',
          structuredResult: this.buildOperationStructuredResult(operations),
          dataQualitySummary: {
            operationCount: operations.length,
            source: 'operation_table',
          },
          toolAudit: {
            toolName: 'operations.status.read',
            permissionType: 'read_only_direct',
            operationCount: operations.length,
          },
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
      name: 'portfolioBacktest.compare.quickRun',
      intent: 'portfolio_backtest_compare',
      label: '运行组合策略 quick-run 对比',
      description: '使用本地真实行情缓存运行永久组合、全天候等策略的三年对比回测，并在 ChatBox 内返回表格和曲线。',
      risk: 'compute',
      permissionType: 'compute_quick_run',
      confirmationPolicy: 'none',
      auditFields: ['strategyIds', 'startDate', 'endDate', 'lineChart', 'drawdownChart', 'notTradingAdvice'],
      execute: async (args) => {
        const result = await this.runPortfolioBacktestCompare(args)
        const structuredResult = this.buildPortfolioBacktestStructuredResult(result)
        const reply = this.summarizePortfolioBacktest(result)
        return {
          reply,
          structuredResult,
          dataQualitySummary: structuredResult.dataQualitySummary,
          toolAudit: {
            toolName: 'portfolioBacktest.compare.quickRun',
            permissionType: 'compute_quick_run',
            runId: result.runId,
            strategyCount: result.strategies.length,
            formalTradingUnlocked: false,
            autoTradeUnlocked: false,
          },
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
      name: 'portfolioBacktest.operation.start',
      intent: 'portfolio_backtest_operation',
      label: '启动持久化组合回测任务',
      description: '确认后运行组合回测并落库 Operation 与结果 artifact，便于任务中心和审计追踪。',
      risk: 'confirm_required',
      permissionType: 'confirm_before_operation',
      confirmationPolicy: 'required',
      auditFields: ['operationId', 'strategyIds', 'artifactRefs', 'notTradingAdvice'],
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        await ensureUser(prisma, userId)
        const result = await this.runPortfolioBacktestCompare({ ...args, userId })
        const artifactRefs = [`chatbox:portfolio_backtest:${result.runId}`]
        const operation = await prisma.operation.create({
          data: {
            userId,
            type: 'portfolio_backtest_run',
            status: 'succeeded',
            startedAt: new Date(),
            completedAt: new Date(),
            progressPct: 100,
            progressMessage: 'ChatBox portfolio backtest quick-run completed and persisted.',
            createdBy: 'chatbox',
            inputJson: JSON.stringify(result.request),
            resultJson: JSON.stringify({
              runId: result.runId,
              strategyCount: result.strategies.length,
              readinessSummary: result.readinessSummary,
              prohibitedActions: result.prohibitedActions,
              notTradingAdvice: true,
            }),
            artifactRefsJson: JSON.stringify(artifactRefs),
          },
        })
        const structuredResult = this.buildPortfolioBacktestStructuredResult(result)
        return {
          reply: `已完成并持久化组合回测任务：${operation.id}。结果可在任务中心追踪；这不是交易授权。`,
          operationId: operation.id,
          artifactRefs,
          structuredResult,
          dataQualitySummary: structuredResult.dataQualitySummary,
          toolAudit: {
            toolName: 'portfolioBacktest.operation.start',
            permissionType: 'confirm_before_operation',
            operationId: operation.id,
            runId: result.runId,
          },
          actionCards: [
            makeCard({
              type: 'navigation',
              title: '打开任务中心',
              description: `查看组合回测任务 ${operation.id}。`,
              href: '/operations',
              status: 'completed',
            }),
          ],
        }
      },
    },
    {
      name: 'portfolioBacktest.templates.read',
      intent: 'portfolio_backtest_explain',
      label: '读取组合回测模板',
      description: '读取可比较的组合策略模板。',
      risk: 'read',
      permissionType: 'read_only_direct',
      confirmationPolicy: 'none',
      auditFields: ['templateCount', 'notTradingAdvice'],
      execute: async () => {
        const templates = portfolioStrategyRegistry.listPresetTemplates()
        return {
          reply: `当前可用策略模板：${templates.map((template: any) => template.displayName || template.strategyId).join('、')}。你可以直接让我比较“永久组合 vs 全天候组合最近三年”。`,
          structuredResult: this.buildPlainStructuredResult('可用策略模板', templates.map((template: any) => template.displayName || template.strategyId).join('、')),
          dataQualitySummary: { source: 'portfolioStrategyRegistry', templateCount: templates.length },
          toolAudit: {
            toolName: 'portfolioBacktest.templates.read',
            permissionType: 'read_only_direct',
            templateCount: templates.length,
          },
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
      intent: 'dividend_low_vol_scan',
      label: '启动红利低波扫描',
      description: '启动红利低波候选池扫描 Operation。',
      risk: 'confirm_required',
      permissionType: 'confirm_before_operation',
      confirmationPolicy: 'required',
      auditFields: ['operationId', 'limit', 'universe', 'notTradingAdvice'],
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
          artifactRefs: [`operation:${operation.id}`],
          structuredResult: this.buildPlainStructuredResult('红利低波扫描任务', `Operation ${operation.id} 已提交。`),
          dataQualitySummary: {
            operationId: operation.id,
            executionMode: 'queued',
            notTradingAdvice: true,
          },
          toolAudit: {
            toolName: 'dividendLowVol.scan.start',
            permissionType: 'confirm_before_operation',
            operationId: operation.id,
          },
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
      name: 'data.refresh.start',
      intent: 'refresh_data',
      label: '刷新研究数据',
      description: '确认后启动研究数据刷新任务；当前实现复用红利低波候选池扫描，不创建订单。',
      risk: 'confirm_required',
      permissionType: 'confirm_before_operation',
      confirmationPolicy: 'required',
      auditFields: ['operationId', 'refreshScope', 'notTradingAdvice'],
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const operation = await operationService.startDividendLowVolDailyScanOperation({
          userId,
          limit: Math.max(10, Math.min(6000, Number(args.limit || 120))),
          universe: args.universe === 'all_a' ? 'all_a' : 'provided_symbols',
          executionMode: 'queued',
          createdBy: 'chatbox_refresh_data',
        })
        return {
          reply: `已提交研究数据刷新任务：${operation.id}。刷新不会创建任何交易动作。`,
          operationId: operation.id,
          artifactRefs: [`operation:${operation.id}`],
          structuredResult: this.buildPlainStructuredResult('研究数据刷新任务', `Operation ${operation.id} 已提交。`),
          dataQualitySummary: { operationId: operation.id, refreshScope: 'dividend_low_vol_research_data' },
          toolAudit: {
            toolName: 'data.refresh.start',
            permissionType: 'confirm_before_operation',
            operationId: operation.id,
          },
          actionCards: [
            makeCard({
              type: 'navigation',
              title: '查看刷新任务',
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
      intent: 'dividend_low_vol_plan_draft',
      label: '生成人工计划草案',
      description: '生成红利低波人工计划草案；不创建订单，不释放正式交易动作。',
      risk: 'confirm_required',
      permissionType: 'confirm_before_operation',
      confirmationPolicy: 'required',
      auditFields: ['draftId', 'topN', 'formalTargetWeight', 'canCreateOrder', 'notTradingAdvice'],
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const topN = Math.max(1, Math.min(10, Number(args.topN || 3)))
        const response = await this.createManualPlanDraftArtifact(userId, topN)
        return {
          reply: `已生成红利低波人工计划草案 ${response.draftId || ''}。该草案不能作为下单指令，正式交易仍被锁定。`,
          artifactRefs: response.artifactRef?.path ? [response.artifactRef.path] : [],
          structuredResult: this.buildPlainStructuredResult('人工计划草案', `草案 ${response.draftId} 已生成；formalTargetWeight=0，canCreateOrder=false。`),
          dataQualitySummary: response.dataQualitySummary,
          toolAudit: {
            toolName: 'manualDraft.create',
            permissionType: 'confirm_before_operation',
            draftId: response.draftId,
            formalTradingUnlocked: false,
            autoTradeUnlocked: false,
            canCreateOrder: false,
            orderCreateAllowed: false,
          },
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
      name: 'audit.report.explain',
      intent: 'audit_report_explain',
      label: '解释审计报告',
      description: '解释当前阶段审计报告、HTML 验收报告和 GPT 审计包入口。',
      risk: 'read',
      permissionType: 'read_only_direct',
      confirmationPolicy: 'none',
      auditFields: ['auditPaths', 'notTradingAdvice'],
      execute: async () => ({
        reply: '当前阶段审计重点是：ChatBox 工具白名单、结构化结果、Operation 确认闭环、交易动作阻断、真实数据回测证据。可从任务中心和审计包查看 artifact。',
        structuredResult: this.buildPlainStructuredResult('审计报告说明', '查看 acceptance-report.html、chatbox_*_audit.json 和 SUMMARY_FOR_GPT.md。'),
        dataQualitySummary: { source: 'chatbox_audit_artifacts', status: 'auditable' },
        toolAudit: {
          toolName: 'audit.report.explain',
          permissionType: 'read_only_direct',
        },
        actionCards: [
          makeCard({
            type: 'navigation',
            title: '打开任务中心',
            description: '从任务中心查看 Operation 和审计 artifact。',
            href: '/operations',
            status: 'ready',
          }),
        ],
      }),
    },
    {
      name: 'data.trust.explain',
      intent: 'data_trust_explain',
      label: '解释数据可信度',
      description: '解释真实数据、缓存、free-source 和 formal-grade 的差异。',
      risk: 'read',
      permissionType: 'read_only_direct',
      confirmationPolicy: 'none',
      auditFields: ['dataGrade', 'marketBarFreshness', 'formalTradingLocked', 'notTradingAdvice'],
      execute: async (args) => {
        const userId = String(args.userId || DEFAULT_USER_ID)
        const freshness = await marketDataFreshnessService.buildReport({
          userId,
          scope: 'active_strategy',
          limit: 300,
        })
        const statusText = freshness.status === 'fresh'
          ? '行情已达到当前预期交易日'
          : freshness.status === 'delayed'
            ? '行情有 1 个交易日延迟，免费源收盘后可能滞后'
            : freshness.status === 'stale'
              ? '行情明显过旧，需要先刷新 K 线'
              : '没有足够行情证据，需要先预热 K 线'
        const freshnessSummary = { ...freshness } as Record<string, unknown>
        const structuredResult: FamsChatStructuredResult = {
          answerLevel: 'plain_language',
          summary: statusText,
          keyNumbers: [
            { label: '预期最新交易日', value: freshness.expectedLatestTradeDate, status: freshness.status === 'fresh' ? 'good' : 'warning' },
            { label: '本地最新交易日', value: freshness.latestTradeDate || '未知', status: freshness.status === 'fresh' ? 'good' : 'warning' },
            { label: '滞后交易日', value: freshness.lagTradingDays ?? '未知', status: freshness.status === 'fresh' ? 'good' : 'warning' },
          ],
          nextActions: freshness.status === 'fresh'
            ? ['可以继续做研究级展示和回测复核']
            : ['先在任务中心提交 K 线刷新/预热', '刷新完成后重新运行红利低波候选或观察区间'],
          dataHealth: freshnessSummary,
          technicalDetailsCollapsed: true,
          prohibitedActions: PROHIBITED_ACTIONS,
          resultType: 'plain_text',
          metricCards: [
            { label: '行情状态', value: freshness.status, status: freshness.status === 'fresh' ? 'good' : 'warning' },
            { label: '预期最新交易日', value: freshness.expectedLatestTradeDate, status: 'neutral' },
            { label: '本地最新交易日', value: freshness.latestTradeDate || '未知', status: freshness.status === 'fresh' ? 'good' : 'warning' },
            { label: '覆盖标的', value: freshness.totalSymbols, status: 'neutral' },
          ],
          comparisonTable: {
            columns: [
              { key: 'item', label: '项目' },
              { key: 'value', label: '说明' },
            ],
            rows: [
              { item: '数据源', value: '本地 market_bar_canonical + 免费行情源缓存' },
              { item: '最新性', value: `${freshness.latestTradeDate || '未知'} / 预期 ${freshness.expectedLatestTradeDate}` },
              { item: '建议动作', value: freshness.recommendedAction },
              { item: '交易边界', value: '仍然不能 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE' },
            ],
          },
          charts: [],
          dataQualitySummary: freshnessSummary,
          evidenceRefs: ['market_bar_canonical:daily:freshness_gate'],
          blockedReasons: freshness.blockers,
          notTradingAdvice: true,
        }
        return {
          reply: [
            `当前行情状态：${statusText}。`,
            `预期最新交易日 ${freshness.expectedLatestTradeDate}，本地最新交易日 ${freshness.latestTradeDate || '未知'}，滞后 ${freshness.lagTradingDays ?? '未知'} 个交易日。`,
            freshness.status === 'fresh'
              ? '可以继续做研究级展示；正式交易仍 locked。'
              : '建议先到任务中心执行 K 线刷新/预热，刷新完成后重新计算红利低波候选和观察区间。',
            'Tushare 接口保留为升级项；当前不把免费源研究数据包装成正式交易数据。',
          ].join('\n'),
          structuredResult,
          dataQualitySummary: freshnessSummary,
          blockedReasons: freshness.blockers,
          toolAudit: {
            toolName: 'data.trust.explain',
            permissionType: 'read_only_direct',
            marketBarFreshness: freshness.status,
            formalTradingUnlocked: false,
            autoTradeUnlocked: false,
          },
          actionCards: [
            makeCard({
              type: 'navigation',
              title: '打开任务中心刷新 K 线',
              description: '查看行情最新日期，并提交 K 线预热/刷新任务。',
              href: '/operations',
              status: 'ready',
            }),
          ],
        }
      },
    },
    {
      name: 'trade.action.blocked',
      intent: 'trade_action_blocked',
      label: '交易动作阻断',
      description: '解释为什么不能通过 ChatBox 释放正式交易动作。',
      risk: 'blocked',
      permissionType: 'permanently_blocked',
      confirmationPolicy: 'blocked',
      auditFields: ['blockedActions', 'formalTradingUnlocked', 'autoTradeUnlocked', 'notTradingAdvice'],
      execute: async () => ({
        reply: '正式 ADD / REDUCE / ORDER_CREATE / AUTO_TRADE 当前全部禁止。ChatBox 只能做研究、观察、比较、提醒和人工计划草案；实际交易必须等待 formal validation 与人工审批。',
        blockedReasons: ['formal_trading_locked', 'auto_trade_locked', 'chatbox_order_creation_disabled'],
        structuredResult: {
          resultType: 'blocked_action',
          metricCards: [
            { label: '正式交易', value: '未解锁', status: 'blocked' },
            { label: '自动交易', value: '永久禁止', status: 'blocked' },
            { label: '下单创建', value: '禁止', status: 'blocked' },
          ],
          comparisonTable: {
            columns: [
              { key: 'action', label: '动作' },
              { key: 'status', label: '状态' },
            ],
            rows: PROHIBITED_ACTIONS.map((action) => ({ action, status: 'blocked' })),
          },
          charts: [],
          dataQualitySummary: { gate: 'trade_action_gate', status: 'blocked' },
          evidenceRefs: ['chatbox:trade_gate_contract'],
          blockedReasons: ['formal_trading_locked', 'auto_trade_locked', 'chatbox_order_creation_disabled'],
          notTradingAdvice: true,
        },
        dataQualitySummary: { gate: 'trade_action_gate', status: 'blocked' },
        toolAudit: {
          toolName: 'trade.action.blocked',
          permissionType: 'permanently_blocked',
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          canCreateOrder: false,
          orderCreateAllowed: false,
        },
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
    const llm = chatLlmPlannerService.publicStatus()
    const piToolManifest = piAgentCoreAdapter.buildToolManifest(this.tools)
    return {
      schemaVersion: 'fams.chat.capabilities.v1',
      generatedAt: new Date().toISOString(),
      agentCore: runtime,
      llm,
      piToolManifest: {
        toolCount: piToolManifest.length,
        executionModes: piToolManifest.map((tool) => ({
          name: tool.name,
          executionMode: tool.executionMode || 'parallel',
        })),
        coverage: {
          matrixToolCount: this.tools.length,
          registeredToolCount: this.tools.length,
          coveragePercent: 100,
          unsafeTools: [],
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
        },
      },
      tools: this.tools.map((tool) => ({
        name: tool.name,
        intent: tool.intent,
        label: tool.label,
        description: tool.description,
        risk: tool.risk,
        permissionType: tool.permissionType,
        confirmationPolicy: tool.confirmationPolicy,
        auditFields: tool.auditFields,
      })),
      streaming: {
        chatStreamingReady: true,
        transport: 'server_sent_events',
        endpoint: '/api/v1/chat/messages/stream',
        eventSchemaVersion: 'fams.chat.stream_event.v1',
        finalResponseSchemaVersion: 'fams.chat.response.v1',
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
      },
      agentLoop: {
        controlledMultiTurnAgentLoopReady: true,
        chatSessionPersistenceReady: true,
        toolCallingLoopReady: true,
        confirmationLoopReady: true,
        streamingLoopReady: true,
        piLlmAgentLoopEnabled: false,
        executionModel: 'allowlisted_tools_with_confirmation_gate',
        blockedCapabilities: ['shell', 'filesystem', 'unrestricted_network', 'ORDER_CREATE', 'AUTO_TRADE'],
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
      },
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
    const llmPlan = await this.planIntent(input.message || '', {
      ...(input.context || {}),
      userId,
      conversationId,
    })
    const intent = llmPlan?.intent || this.detectIntent(message)
    const runtime = await piAgentCoreAdapter.getRuntimeStatus()
    const tool = this.selectTool(intent)

    if (!tool) {
      return this.auditedResponse(userId, {
        conversationId,
        intent: 'capability_help',
        confidence: llmPlan?.confidence || 0.55,
        reply: '我可以帮你查看组合、筛选红利低波候选、解释交易 gate、启动需要确认的扫描任务，并引导你到策略回测页面。',
        actionCards: this.defaultActionCards(),
        requiresConfirmation: false,
        runtimeAvailable: runtime.runtimeAvailable,
        metadata: llmPlan ? { planner: llmPlan } : undefined,
      })
    }

    const args = this.buildToolArgs(intent, userId, input.message || '', {
      ...(input.context || {}),
      ...(llmPlan?.context || {}),
    })
    if (tool.risk === 'blocked') {
      const blocked = await tool.execute(args)
      return this.auditedResponse(userId, {
        conversationId,
        intent,
        confidence: llmPlan?.confidence || 0.92,
        reply: blocked.reply,
        actionCards: blocked.actionCards || [],
        blockedReasons: blocked.blockedReasons || ['blocked_by_trade_gate'],
        structuredResult: blocked.structuredResult,
        dataQualitySummary: blocked.dataQualitySummary,
        toolAudit: blocked.toolAudit,
        requiresConfirmation: false,
        runtimeAvailable: runtime.runtimeAvailable,
        metadata: llmPlan ? { planner: llmPlan } : undefined,
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
        confidence: llmPlan?.confidence || 0.86,
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
        metadata: llmPlan ? { planner: llmPlan } : undefined,
      })
    }

    let result: Awaited<ReturnType<FamsChatTool['execute']>>
    try {
      result = await tool.execute(args)
    } catch (error: any) {
      const errorMessage = String(error?.message || error).slice(0, 500)
      const structuredResult = this.buildToolFailureStructuredResult(tool.label, errorMessage)
      return this.auditedResponse(userId, {
        conversationId,
        intent,
        confidence: llmPlan?.confidence || 0.64,
        reply: [
          `${tool.label} 暂时无法完成。`,
          '系统已经把本次问题作为数据健康限制处理，不会把不完整结果伪装成可用结论。',
          `原因摘要：${errorMessage.includes('database disk image is malformed') ? 'SQLite 数据库健康异常，需要先修复 runtime health。' : errorMessage}`,
        ].join('\n'),
        actionCards: [
          makeCard({
            type: 'navigation',
            title: '打开任务中心',
            description: '查看最近任务、数据源健康和失败审计。',
            href: '/operations',
            status: 'ready',
          }),
        ],
        blockedReasons: ['chatbox_tool_execution_failed', 'data_health_attention_required'],
        structuredResult,
        dataQualitySummary: structuredResult.dataQualitySummary,
        toolAudit: {
          toolName: tool.name,
          permissionType: tool.permissionType,
          failureHandled: true,
          errorMessage,
          formalTradingUnlocked: false,
          autoTradeUnlocked: false,
          canCreateOrder: false,
          orderCreateAllowed: false,
        },
        requiresConfirmation: false,
        runtimeAvailable: runtime.runtimeAvailable,
        metadata: llmPlan ? { planner: llmPlan } : undefined,
      })
    }
    return this.auditedResponse(userId, {
      conversationId,
      intent,
      confidence: llmPlan?.confidence || 0.9,
      reply: result.reply,
      actionCards: result.actionCards || [],
      operationId: result.operationId,
      artifactRefs: result.artifactRefs || [],
      blockedReasons: result.blockedReasons || [],
      structuredResult: result.structuredResult,
      dataQualitySummary: result.dataQualitySummary,
      toolAudit: result.toolAudit,
      requiresConfirmation: false,
      runtimeAvailable: runtime.runtimeAvailable,
      metadata: llmPlan ? { planner: llmPlan } : undefined,
    })
  }

  async streamMessage(input: FamsChatMessageInput): Promise<FamsChatStreamEvent[]> {
    const userId = input.userId || DEFAULT_USER_ID
    const conversationId = input.conversationId || `chat-${randomUUID()}`
    const startedAt = new Date().toISOString()
    const events: FamsChatStreamEvent[] = [
      this.streamEvent({
        conversationId,
        type: 'start',
        message: '已收到问题，正在识别业务意图。',
        generatedAt: startedAt,
      }),
      this.streamEvent({
        conversationId,
        type: 'status',
        message: '正在检查工具白名单、数据可信状态和交易边界。',
      }),
    ]

    try {
      const response = await this.sendMessage({
        ...input,
        userId,
        conversationId,
      })
      events.push(
        this.streamEvent({
          conversationId,
          type: 'tool_result',
          message: `已完成 ${response.intent} 工具调用，正在组织结构化结果。`,
        }),
        this.streamEvent({
          conversationId,
          type: 'final',
          message: '已生成结果。正式交易动作仍保持锁定。',
          response,
        }),
      )
      return events
    } catch (error: any) {
      const message = String(error?.message || error).slice(0, 500)
      events.push(this.streamEvent({
        conversationId,
        type: 'error',
        message: `流式响应失败：${message}`,
      }))
      return events
    }
  }

  private streamEvent(input: {
    conversationId: string
    type: FamsChatStreamEvent['type']
    message: string
    response?: FamsChatResponse
    generatedAt?: string
  }): FamsChatStreamEvent {
    return {
      schemaVersion: 'fams.chat.stream_event.v1',
      generatedAt: input.generatedAt || new Date().toISOString(),
      conversationId: input.conversationId,
      eventId: `evt-${randomUUID()}`,
      type: input.type,
      message: input.message,
      response: input.response,
      allowedActions: ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
      notTradingAdvice: true,
    }
  }

  private async planIntent(message: string, context: Record<string, unknown>) {
    if (!chatLlmPlannerService.isAvailable()) return null
    try {
      return await chatLlmPlannerService.plan(message, context)
    } catch (error: any) {
      return {
        intent: this.detectIntent(normalizeMessage(message)),
        confidence: 0.6,
        context: {},
        reason: `llm_planner_failed_fallback:${String(error?.message || error).slice(0, 120)}`,
      }
    }
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
      structuredResult: result.structuredResult,
      dataQualitySummary: result.dataQualitySummary,
      toolAudit: result.toolAudit,
      metadata: afterTool.details as Record<string, unknown>,
      requiresConfirmation: false,
      runtimeAvailable: runtime.runtimeAvailable,
    })
  }

  private detectIntent(message: string): FamsChatIntent {
    if (/(shell|bash|powershell|cmd|rm -rf|文件系统|读文件|写文件|filesystem|curl|wget|任意网络|network tool)/i.test(message)) return 'trade_action_blocked'
    if (/(下单|买入|卖出|加仓|减仓|自动交易|order|auto_trade|add|reduce)/i.test(message)) return 'trade_action_blocked'
    if (/(数据可信|数据质量|真实数据|数据来源|数据最新|最新数据|上个月|行情最新|行情日期|freshness|data trust|data quality)/i.test(message)) return 'data_trust_explain'
    if (/(审计|报告|验收|audit|acceptance)/i.test(message)) return 'audit_report_explain'
    if (/(草案|人工计划|人工计划|draft)/i.test(message)) return 'dividend_low_vol_plan_draft'
    if (/(刷新数据|数据刷新|refresh data)/i.test(message)) return 'refresh_data'
    if (/(红利|低波|股息|dividend)/i.test(message) && /(扫描|刷新|更新|scan)/i.test(message)) return 'dividend_low_vol_scan'
    if (/(红利|低波|股息|dividend|600887)/i.test(message) && /(区间|建仓|卖出|买卖|观察|位置|zone|price)/i.test(message)) return 'dividend_low_vol_trading_zone'
    if (/(红利|低波|股息|dividend)/i.test(message)) return 'dividend_low_vol_top_candidates'
    if (/(持久化回测|创建回测任务|回测任务|backtest operation)/i.test(message)) return 'portfolio_backtest_operation'
    if (/(回测|backtest|收益曲线|策略比较|永久组合|全天候|最大回撤|画图|绘图)/i.test(message)) return 'portfolio_backtest_compare'
    if (/(任务|operation|进度|状态)/i.test(message)) return 'operation_status'
    if (/(组合|持仓|仓位|portfolio|position)/i.test(message)) return 'portfolio_summary'
    return 'capability_help'
  }

  private selectTool(intent: FamsChatIntent) {
    const toolNameByIntent: Partial<Record<FamsChatIntent, string>> = {
      portfolio_summary: 'portfolio.summary.read',
      portfolio_risk_explain: 'portfolio.summary.read',
      dividend_low_vol_top_candidates: 'dividendLowVol.candidates.read',
      dividend_low_vol_trading_zone: 'dividendLowVol.tradingZone.read',
      dividend_low_vol_scan: 'dividendLowVol.scan.start',
      refresh_data: 'data.refresh.start',
      portfolio_backtest_compare: 'portfolioBacktest.compare.quickRun',
      portfolio_backtest_operation: 'portfolioBacktest.operation.start',
      portfolio_backtest_explain: 'portfolioBacktest.templates.read',
      manual_trade_draft: 'manualDraft.create',
      dividend_low_vol_plan_draft: 'manualDraft.create',
      operation_status: 'operations.status.read',
      audit_report_explain: 'audit.report.explain',
      data_trust_explain: 'data.trust.explain',
      trade_action_blocked: 'trade.action.blocked',
    }
    const toolName = toolNameByIntent[intent]
    return toolName ? this.tools.find((tool) => tool.name === toolName) : undefined
  }

  private intentByToolName(toolName: string): FamsChatIntent {
    if (toolName === 'dividendLowVol.scan.start') return 'dividend_low_vol_scan'
    if (toolName === 'data.refresh.start') return 'refresh_data'
    if (toolName === 'manualDraft.create') return 'dividend_low_vol_plan_draft'
    if (toolName === 'portfolioBacktest.operation.start') return 'portfolio_backtest_operation'
    return 'capability_help'
  }

  private buildToolArgs(intent: FamsChatIntent, userId: string, message: string, context: Record<string, unknown>) {
    const args: Record<string, unknown> = { userId, ...context }
    const symbolMatch = message.match(/\b[036]\d{5}\b/)
    if (symbolMatch && !args.symbol) args.symbol = symbolMatch[0]
    if (intent === 'dividend_low_vol_top_candidates') args.topN = Number(context.topN || 3)
    if (intent === 'dividend_low_vol_plan_draft' || intent === 'manual_trade_draft') args.topN = Number(context.topN || 3)
    if (intent === 'dividend_low_vol_scan' || intent === 'refresh_data') {
      args.limit = Number(context.limit || 120)
      args.universe = context.universe || 'provided_symbols'
    }
    if (intent === 'portfolio_backtest_compare' || intent === 'portfolio_backtest_operation') {
      args.portfolioStrategyIds = Array.isArray(context.portfolioStrategyIds)
        ? this.normalizePortfolioStrategyIds(context.portfolioStrategyIds)
        : ['permanent_portfolio', 'all_weather']
      args.period = context.period || '3y'
    }
    return args
  }

  private normalizePortfolioStrategyIds(input: unknown[]) {
    const mapped = input
      .map((item) => String(item || '').toLowerCase())
      .map((item) => {
        if (item.includes('permanent') || item.includes('永久')) return 'permanent_portfolio'
        if (item.includes('all_weather') || item.includes('all weather') || item.includes('全天候')) return 'all_weather'
        if (item.includes('current') || item.includes('当前') || item.includes('持仓')) return 'current_holdings_buy_and_hold'
        if (item.includes('dividend') || item.includes('红利')) return 'dividend_low_vol_basket'
        return item
      })
      .filter((item) => ['permanent_portfolio', 'all_weather', 'current_holdings_buy_and_hold', 'dividend_low_vol_basket'].includes(item))
    const unique = Array.from(new Set(mapped))
    return unique.length > 0 ? unique : ['permanent_portfolio', 'all_weather']
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

  private formatNumber(value: unknown, digits = 2) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 'n/a'
    return numeric.toFixed(digits)
  }

  private formatPercent(value: unknown, digits = 2) {
    const numeric = Number(value)
    if (!Number.isFinite(numeric)) return 'n/a'
    return `${numeric.toFixed(digits)}%`
  }

  private buildPlainStructuredResult(title: string, text: string): FamsChatStructuredResult {
    return {
      resultType: 'plain_text',
      metricCards: [{ label: title, value: text, status: 'neutral' }],
      comparisonTable: { columns: [], rows: [] },
      charts: [],
      dataQualitySummary: {
        source: 'chatbox_controlled_tool',
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
      },
      evidenceRefs: ['chatbox:controlled_tool_result'],
      blockedReasons: [],
      notTradingAdvice: true,
    }
  }

  private buildToolFailureStructuredResult(toolLabel: string, errorMessage: string): FamsChatStructuredResult {
    const runtimeHealthMessage = errorMessage.includes('database disk image is malformed')
      ? 'SQLite 数据库健康异常，当前不能信任依赖该表的候选池或事实集结果。'
      : '工具执行失败，当前结果只能作为数据健康提示。'
    return {
      resultType: 'plain_text',
      metricCards: [
        { label: '工具状态', value: 'blocked', status: 'blocked', description: toolLabel },
        { label: '数据健康', value: '需要处理', status: 'warning', description: runtimeHealthMessage },
      ],
      comparisonTable: {
        columns: [
          { key: 'item', label: '项目' },
          { key: 'value', label: '说明' },
        ],
        rows: [
          { item: '失败工具', value: toolLabel },
          { item: '原因', value: runtimeHealthMessage },
          { item: '交易边界', value: '不会创建订单，也不会释放正式 ADD / REDUCE / AUTO_TRADE。' },
        ],
      },
      charts: [],
      dataQualitySummary: {
        status: 'blocked',
        source: 'chatbox_tool_failure_guard',
        reason: runtimeHealthMessage,
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        canCreateOrder: false,
        orderCreateAllowed: false,
      },
      evidenceRefs: ['chatbox:tool_failure_guard'],
      blockedReasons: ['chatbox_tool_execution_failed', 'data_health_attention_required'],
      notTradingAdvice: true,
    }
  }

  private buildPortfolioSummaryStructuredResult(summary: any): FamsChatStructuredResult {
    return {
      resultType: 'portfolio_summary',
      metricCards: [
        { label: '持仓数', value: summary.positionsCount ?? 0, status: 'neutral' },
        { label: '总市值', value: this.formatNumber(summary.totalValue), status: 'neutral' },
        { label: '浮动盈亏', value: this.formatNumber(summary.totalPnl), status: Number(summary.totalPnl || 0) >= 0 ? 'good' : 'warning' },
        { label: '现金权重', value: this.formatPercent(summary.cashWeight), status: 'neutral' },
      ],
      comparisonTable: {
        columns: [
          { key: 'metric', label: '指标' },
          { key: 'value', label: '值' },
        ],
        rows: [
          { metric: '总成本', value: this.formatNumber(summary.totalCost) },
          { metric: '浮动盈亏率', value: this.formatPercent(summary.totalPnlPercent) },
          { metric: '现金权重', value: this.formatPercent(summary.cashWeight) },
        ],
      },
      charts: [],
      dataQualitySummary: {
        source: 'positionService.getPositionSummary',
        positionsCount: summary.positionsCount,
      },
      evidenceRefs: ['service:positionService.getPositionSummary'],
      blockedReasons: [],
      notTradingAdvice: true,
    }
  }

  private buildCandidateStructuredResult(candidates: any[], pool: any): FamsChatStructuredResult {
    return {
      resultType: 'candidate_ranking',
      metricCards: [
        { label: '展示候选', value: candidates.length, status: candidates.length > 0 ? 'good' : 'warning' },
        { label: '候选池来源', value: pool.source || 'latest_persisted_pool', status: 'neutral' },
        { label: '正式交易', value: '未解锁', status: 'blocked' },
      ],
      comparisonTable: {
        columns: [
          { key: 'rank', label: '排名' },
          { key: 'symbol', label: '代码' },
          { key: 'name', label: '名称' },
          { key: 'yield', label: 'TTM股息率' },
          { key: 'score', label: '综合分' },
          { key: 'leaderStatus', label: '龙头证据' },
          { key: 'disposition', label: '状态' },
        ],
        rows: candidates.map((candidate, index) => ({
          rank: index + 1,
          symbol: candidate.identity?.symbol || '-',
          name: candidate.identity?.name || '-',
          yield: candidate.dividend?.ttmDividendYield != null ? `${(Number(candidate.dividend.ttmDividendYield) * 100).toFixed(2)}%` : 'n/a',
          score: candidate.scores?.evidenceAdjustedScore ?? null,
          leaderStatus: candidate.leaderEvidence?.leaderVerificationStatus || candidate.leaderVerificationStatus || 'unknown',
          disposition: candidate.disposition || 'watch_candidate',
        })),
        insufficientReason: candidates.length === 0 ? 'no_research_candidate_available' : undefined,
      },
      charts: [],
      dataQualitySummary: {
        source: pool.source || 'latest_candidate_pool',
        poolCandidateCount: pool.candidates?.length || 0,
        formalTradingUnlocked: false,
      },
      evidenceRefs: Array.from(new Set(candidates.flatMap((candidate) => candidate.evidenceRefs || []))).slice(0, 20),
      blockedReasons: [],
      notTradingAdvice: true,
    }
  }

  private buildTradingZoneStructuredResult(symbol: string, zoneResult: any): FamsChatStructuredResult {
    const zone = zoneResult.zones?.[0]
    const strategies = zone?.strategies || []
    const first = strategies[0]
    const blockedReasons = zone ? strategies.flatMap((strategy: any) => strategy.blockedReasons || []) : ['trading_zone_factset_missing']
    return {
      resultType: 'trading_zone',
      metricCards: [
        { label: '标的', value: symbol, status: zone ? 'neutral' : 'warning' },
        { label: '当前价', value: this.formatNumber(zone?.priceAudit?.currentPrice), status: zone?.priceAudit?.sanityStatus === 'aligned' ? 'good' : 'warning' },
        { label: '当前信号', value: first?.currentSignal || 'insufficient', status: first?.currentSignal === 'build_zone' ? 'good' : first?.currentSignal === 'trim_zone' ? 'warning' : 'neutral' },
        { label: '正式交易', value: '未解锁', status: 'blocked' },
      ],
      comparisonTable: {
        columns: [
          { key: 'strategy', label: '模型' },
          { key: 'buyZone', label: '建仓观察区' },
          { key: 'sellZone', label: '卖出观察区' },
          { key: 'stopLoss', label: '风险位' },
          { key: 'signal', label: '当前信号' },
          { key: 'status', label: '数据状态' },
        ],
        rows: strategies.map((strategy: any) => ({
          strategy: strategy.label || strategy.strategyId,
          buyZone: `${this.formatNumber(strategy.buyZoneLow)} - ${this.formatNumber(strategy.buyZoneHigh)}`,
          sellZone: `${this.formatNumber(strategy.sellZoneLow)} - ${this.formatNumber(strategy.sellZoneHigh)}`,
          stopLoss: this.formatNumber(strategy.stopLoss),
          signal: strategy.currentSignal,
          status: strategy.status,
        })),
        insufficientReason: zone ? undefined : 'trading_zone_factset_missing',
      },
      charts: [],
      dataQualitySummary: {
        source: 'dividendLowVolTradingZoneService',
        priceAudit: zone?.priceAudit || null,
        formalTradingUnlocked: false,
        prohibitedActions: PROHIBITED_ACTIONS,
      },
      evidenceRefs: Array.from(new Set([...(zone?.evidenceRefs || []), ...(first?.evidenceRefs || [])])).slice(0, 20),
      blockedReasons: Array.from(new Set(blockedReasons)),
      notTradingAdvice: true,
    }
  }

  private buildOperationStructuredResult(operations: any[]): FamsChatStructuredResult {
    return {
      resultType: 'operation_status',
      metricCards: [
        { label: '最近任务', value: operations.length, status: operations.length > 0 ? 'neutral' : 'warning' },
      ],
      comparisonTable: {
        columns: [
          { key: 'type', label: '类型' },
          { key: 'status', label: '状态' },
          { key: 'progress', label: '进度' },
          { key: 'message', label: '说明' },
        ],
        rows: operations.map((operation: any) => ({
          type: operation.type,
          status: operation.status,
          progress: `${operation.progressPct ?? 0}%`,
          message: operation.progressMessage || '',
        })),
      },
      charts: [],
      dataQualitySummary: { source: 'operationService.listOperations' },
      evidenceRefs: operations.map((operation: any) => `operation:${operation.id}`),
      blockedReasons: [],
      notTradingAdvice: true,
    }
  }

  private async latestBacktestDate() {
    const latest = await prisma.marketBarCanonical.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    })
    return latest?.tradeDate ? latest.tradeDate.toISOString().slice(0, 10) : '2026-06-05'
  }

  private subtractYearsIso(dateText: string, years: number) {
    const date = new Date(`${dateText}T00:00:00.000Z`)
    date.setUTCFullYear(date.getUTCFullYear() - years)
    return date.toISOString().slice(0, 10)
  }

  private async runPortfolioBacktestCompare(args: Record<string, unknown>) {
    const userId = String(args.userId || 'audit_portfolio_backtest_user')
    await ensureUser(prisma, userId)
    const endDate = typeof args.endDate === 'string' ? args.endDate : await this.latestBacktestDate()
    const startDate = typeof args.startDate === 'string' ? args.startDate : this.subtractYearsIso(endDate, 3)
    const portfolioStrategyIds = Array.isArray(args.portfolioStrategyIds) && args.portfolioStrategyIds.length > 0
      ? args.portfolioStrategyIds.map(String)
      : ['permanent_portfolio', 'all_weather']
    const input = await portfolioBacktestInputBuilder.build({
      userId,
      portfolioStrategyIds,
      startDate,
      endDate,
      initialCapital: Number(args.initialCapital || 100000),
      rebalanceFrequency: 'quarterly',
      dividendMode: 'reinvest',
      feeRate: 0.0003,
      slippageRate: 0.0005,
      benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20'],
      gradeMode: 'formal_review',
    })
    return portfolioBacktestEngine.run(input)
  }

  private sampleCurve<T>(items: T[], maxPoints = 80) {
    if (items.length <= maxPoints) return items
    const step = Math.ceil(items.length / maxPoints)
    return items.filter((_, index) => index % step === 0 || index === items.length - 1)
  }

  private buildPortfolioBacktestStructuredResult(result: any): FamsChatStructuredResult {
    const rows = result.strategies.map((strategy: any) => ({
      strategy: strategy.definition?.displayName || strategy.definition?.strategyId || '-',
      status: strategy.status,
      totalReturn: this.formatPercent(strategy.metrics?.totalReturnPercent),
      annualizedReturn: this.formatPercent(strategy.metrics?.annualizedReturnPercent),
      maxDrawdown: this.formatPercent(strategy.metrics?.maxDrawdownPercent),
      sharpe: this.formatNumber(strategy.metrics?.sharpe),
      excessReturn: this.formatPercent(strategy.metrics?.excessReturnPercent),
    }))
    const charts = [
      {
        type: 'line_chart' as const,
        title: '净值曲线',
        xAxisType: 'time' as const,
        yAxisLabel: '净值',
        series: result.strategies.map((strategy: any) => ({
          name: strategy.definition?.displayName || strategy.definition?.strategyId || '-',
          data: this.sampleCurve(strategy.equityCurve || []).map((point: any) => [point.date, point.netValue] as [string, number | null]),
        })),
      },
      {
        type: 'drawdown_chart' as const,
        title: '回撤曲线',
        xAxisType: 'time' as const,
        yAxisLabel: '回撤%',
        series: result.strategies.map((strategy: any) => ({
          name: strategy.definition?.displayName || strategy.definition?.strategyId || '-',
          data: this.sampleCurve(strategy.drawdownCurve || []).map((point: any) => [point.date, point.drawdownPercent] as [string, number | null]),
        })),
      },
    ]
    return {
      resultType: 'strategy_comparison',
      metricCards: [
        { label: '回测策略', value: result.strategies.length, status: result.strategies.length > 0 ? 'good' : 'warning' },
        { label: '起始日期', value: result.request?.startDate || '-', status: 'neutral' },
        { label: '结束日期', value: result.request?.endDate || '-', status: 'neutral' },
        { label: '正式交易', value: '未解锁', status: 'blocked' },
      ],
      comparisonTable: {
        columns: [
          { key: 'strategy', label: '策略' },
          { key: 'status', label: '状态' },
          { key: 'totalReturn', label: '总收益' },
          { key: 'annualizedReturn', label: '年化收益' },
          { key: 'maxDrawdown', label: '最大回撤' },
          { key: 'sharpe', label: 'Sharpe' },
          { key: 'excessReturn', label: '超额收益' },
        ],
        rows,
        insufficientReason: rows.length === 0 ? 'no_strategy_result' : undefined,
      },
      charts,
      dataQualitySummary: {
        readinessSummary: result.readinessSummary || null,
        dataGradeStatus: result.dataGradeAudit?.status || null,
        modelEffectivenessStatus: result.modelEffectiveness?.status || null,
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
      },
      evidenceRefs: Array.from(new Set<string>(result.strategies
        .flatMap((strategy: any) => strategy.evidenceRefs || [])
        .filter((ref: unknown): ref is string => typeof ref === 'string'))).slice(0, 20),
      blockedReasons: Array.from(new Set(result.strategies.flatMap((strategy: any) => strategy.blockedReasons || []))),
      notTradingAdvice: true,
    }
  }

  private summarizePortfolioBacktest(result: any) {
    const lines = result.strategies.map((strategy: any) => {
      const name = strategy.definition?.displayName || strategy.definition?.strategyId || '-'
      return `${name}：总收益 ${this.formatPercent(strategy.metrics?.totalReturnPercent)}，最大回撤 ${this.formatPercent(strategy.metrics?.maxDrawdownPercent)}，Sharpe ${this.formatNumber(strategy.metrics?.sharpe)}，状态 ${strategy.status}`
    })
    return [
      `已使用本地真实行情缓存运行 ${result.request?.startDate} 至 ${result.request?.endDate} 的组合策略对比。`,
      ...lines,
      '结果已包含净值曲线和回撤曲线 payload。该结果只用于研究比较，不是正式交易建议。',
    ].join('\n')
  }

  private async createManualPlanDraftArtifact(userId: string, topN: number) {
    const pool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
      limit: Math.max(120, topN),
      scope: 'all_latest_by_symbol',
    })
    const candidates = (pool.candidates || [])
      .filter((candidate: any) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
      .sort((left: any, right: any) => (right.scores?.evidenceAdjustedScore || 0) - (left.scores?.evidenceAdjustedScore || 0))
      .slice(0, topN)
    const generatedAt = new Date().toISOString()
    const draftId = `chatbox-manual-draft-${generatedAt.replace(/[:.]/g, '-')}`
    const draft = {
      schemaVersion: 'fams.chatbox.manual_plan_draft.v1',
      draftId,
      generatedAt,
      userId,
      status: 'manual_review_only',
      formalTargetWeightPercent: 0,
      canCreateOrder: false,
      orderCreateAllowed: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      allowedActions: ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      candidates: candidates.map((candidate: any, index: number) => ({
        rank: index + 1,
        symbol: candidate.identity?.symbol,
        name: candidate.identity?.name,
        evidenceAdjustedScore: candidate.scores?.evidenceAdjustedScore ?? null,
        disposition: candidate.disposition,
        blockedReasons: candidate.blockedReasons || [],
        evidenceRefs: candidate.evidenceRefs || [],
      })),
      blockedReasons: ['formal_trading_locked', 'manual_review_required'],
      notTradingAdvice: true,
    }
    const dir = resolve(process.cwd(), 'data', 'gpt-audit', 'chatbox-manual-drafts')
    await mkdir(dir, { recursive: true })
    const path = resolve(dir, `${draftId}.json`)
    await writeFile(path, `${JSON.stringify(draft, null, 2)}\n`, 'utf8')
    return {
      draftId,
      artifactRef: { path },
      dataQualitySummary: {
        source: (pool as any).source || 'latest_candidate_pool',
        candidateCount: candidates.length,
        formalTradingUnlocked: false,
      },
    }
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
    structuredResult?: FamsChatStructuredResult
    dataQualitySummary?: Record<string, unknown>
    toolAudit?: Record<string, unknown>
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
    structuredResult?: FamsChatStructuredResult
    dataQualitySummary?: Record<string, unknown>
    toolAudit?: Record<string, unknown>
  }): FamsChatResponse {
    const structuredResult = this.enrichStructuredResult({
      structuredResult: input.structuredResult,
      reply: input.reply,
      actionCards: input.actionCards,
      blockedReasons: input.blockedReasons || [],
      dataQualitySummary: input.dataQualitySummary,
    })
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
      structuredResult,
      dataQualitySummary: input.dataQualitySummary || structuredResult?.dataQualitySummary,
      toolAudit: input.toolAudit,
      allowedActions: ALLOWED_ACTIONS,
      prohibitedActions: PROHIBITED_ACTIONS,
      agentCore: {
        provider: 'pi-agent-core',
        mode: getFamsLlmPublicStatus().chatAgentEnabled ? 'llm_assisted_planner_pending' : 'deterministic_planner',
        runtimeAvailable: input.runtimeAvailable,
        nodeVersion: process.version,
        llm: chatLlmPlannerService.publicStatus(),
        note: getFamsLlmPublicStatus().chatAgentEnabled
          ? 'LLM key is configured for explanation/planning readiness, but FAMS still routes all executable actions through allowlisted tools and confirmations.'
          : 'PI AgentCore is integrated as the controlled tool/runtime adapter. Deterministic planner is used until FAMS_CHAT_LLM_ENABLED=1 is configured.',
      },
      notTradingAdvice: true,
    }
  }

  private enrichStructuredResult(input: {
    structuredResult?: FamsChatStructuredResult
    reply: string
    actionCards: FamsChatActionCard[]
    blockedReasons: string[]
    dataQualitySummary?: Record<string, unknown>
  }): FamsChatStructuredResult | undefined {
    if (!input.structuredResult) return undefined
    const lines = input.reply.split(/\n+/).map((line) => line.trim()).filter(Boolean)
    const blockedReasons = Array.from(new Set([
      ...(input.structuredResult.blockedReasons || []),
      ...input.blockedReasons,
    ]))
    const dataQualitySummary = input.structuredResult.dataQualitySummary || input.dataQualitySummary || {}
    const dataHealthStatus = blockedReasons.length > 0
      || /insufficient|missing|failed|critical|blocked|unavailable/i.test(JSON.stringify(dataQualitySummary))
      ? 'warning'
      : 'ok'
    const nextActions = input.structuredResult.nextActions?.length
      ? input.structuredResult.nextActions
      : input.actionCards.length
        ? input.actionCards.map((card) => card.title).slice(0, 5)
        : blockedReasons.length
          ? ['查看证据详情', '打开专家页复核', '不要作为正式交易指令']
          : ['查看关键数字', '打开对应工作台', '按需展开证据详情']

    return {
      ...input.structuredResult,
      answerLevel: input.structuredResult.answerLevel || 'plain_language',
      summary: input.structuredResult.summary || lines[0] || '已生成研究结果。',
      keyNumbers: input.structuredResult.keyNumbers?.length
        ? input.structuredResult.keyNumbers
        : input.structuredResult.metricCards,
      nextActions,
      dataHealth: input.structuredResult.dataHealth || {
        status: dataHealthStatus,
        blockedReasons,
        dataQualitySummary,
        notTradingAdvice: true,
      },
      dataQualitySummary,
      technicalDetailsCollapsed: true,
      prohibitedActions: PROHIBITED_ACTIONS,
      blockedReasons,
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
