/**
 * AI Agent Router
 *
 * 支持多角色AI Agent的协作框架
 * 每个Agent有明确的职责和工具集
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'

// Agent角色定义
export const AgentRoles = {
  FUND_ANALYST: 'fund_analyst',       // 基金分析师
  STRATEGY_BACKTESTER: 'strategy_backtester', // 策略回测师
  NEWS_INTELLIGENCE: 'news_intelligence',     // 消息面情报师
  RISK_MANAGER: 'risk_manager',               // 风险管理师
  PORTFOLIO_ADVISOR: 'portfolio_advisor',     // 组合顾问
} as const

// Agent能力定义
export const AgentCapabilities = {
  fund_analyst: [
    'analyze_fund_holdings',
    'evaluate_fund_performance',
    'compare_funds',
    'generate_fund_report',
  ],
  strategy_backtester: [
    'run_backtest',
    'optimize_strategy',
    'compare_strategies',
    'analyze_backtest_results',
  ],
  news_intelligence: [
    'fetch_market_news',
    'sentiment_analysis',
    'event_impact_analysis',
    'track_news_by_symbol',
  ],
  risk_manager: [
    'calculate_risk_metrics',
    'check_position_limits',
    'generate_risk_alerts',
    'stress_test',
  ],
  portfolio_advisor: [
    'generate_rebalancing_suggestions',
    'evaluate_portfolio_score',
    'compare_with_benchmarks',
    'generate_portfolio_report',
  ],
} as const

// Agent任务定义
export interface AgentTask {
  id: string
  role: string
  action: string
  parameters: Record<string, unknown>
  dependencies: string[] // 依赖的其他任务ID
  status: 'pending' | 'running' | 'completed' | 'failed'
  result?: unknown
  error?: string
  createdAt: Date
  completedAt?: Date
}

// Agent注册表
const agentRegistry = new Map<string, {
  role: string
  capabilities: string[]
  handler: (params: Record<string, unknown>) => Promise<unknown>
}>()

// 注册Agent
export function registerAgent(
  name: string,
  role: string,
  capabilities: string[],
  handler: (params: Record<string, unknown>) => Promise<unknown>
) {
  agentRegistry.set(name, { role, capabilities, handler })
}

// 获取Agent信息
export function getAgentInfo(name: string) {
  return agentRegistry.get(name)
}

// Agent Router
export async function agentRouter(app: FastifyInstance) {
  // 列出所有注册的Agent
  app.get('/agents', async () => {
    const agents = []
    for (const [name, agent] of agentRegistry) {
      agents.push({
        name,
        role: agent.role,
        capabilities: agent.capabilities,
      })
    }
    return { agents }
  })

  // 获取Agent能力
  app.get('/agents/:name/capabilities', async (request: FastifyRequest<{
    Params: { name: string }
  }>) => {
    const agent = agentRegistry.get(request.params.name)
    if (!agent) {
      return { error: 'Agent not found' }
    }
    return {
      name: request.params.name,
      role: agent.role,
      capabilities: agent.capabilities.map((cap) => ({
        name: cap,
        description: `Capability: ${cap}`,
      })),
    }
  })

  // 调用Agent能力
  app.post('/agents/:name/:capability', async (request: FastifyRequest<{
    Params: { name: string; capability: string }
    Body: { parameters: Record<string, unknown> }
  }>, reply: FastifyReply) => {
    const agent = agentRegistry.get(request.params.name)
    if (!agent) {
      return reply.status(404).send({ error: 'Agent not found' })
    }

    if (!agent.capabilities.includes(request.params.capability)) {
      return reply.status(400).send({ error: 'Capability not found' })
    }

    try {
      const result = await agent.handler({
        capability: request.params.capability,
        ...request.body.parameters,
      })
      return { success: true, result }
    } catch (error) {
      return reply.status(500).send({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })

  // 创建Agent任务
  app.post('/tasks', async (request: FastifyRequest<{
    Body: {
      role: string
      action: string
      parameters: Record<string, unknown>
      dependencies?: string[]
    }
  }>) => {
    const task: AgentTask = {
      id: crypto.randomUUID(),
      role: request.body.role,
      action: request.body.action,
      parameters: request.body.parameters,
      dependencies: request.body.dependencies || [],
      status: 'pending',
      createdAt: new Date(),
    }

    // 触发任务执行
    executeTask(task)

    return { task }
  })

  // 获取任务状态
  app.get('/tasks/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>) => {
    // 实际应该从数据库或缓存获取
    return { taskId: request.params.id, status: 'pending' }
  })

  // 获取任务列表
  app.get('/tasks', async () => {
    return { tasks: [] }
  })
}

// 任务执行函数
async function executeTask(task: AgentTask) {
  task.status = 'running'

  try {
    // 根据role和action路由到对应的Agent
    const agent = Array.from(agentRegistry.values()).find((a) => a.role === task.role)

    if (agent) {
      task.result = await agent.handler({
        action: task.action,
        ...task.parameters,
      })
      task.status = 'completed'
      task.completedAt = new Date()
    } else {
      task.status = 'failed'
      task.error = `No agent found for role: ${task.role}`
    }
  } catch (error) {
    task.status = 'failed'
    task.error = error instanceof Error ? error.message : 'Unknown error'
  }
}
