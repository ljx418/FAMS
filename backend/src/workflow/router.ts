/**
 * Workflow Router - 工作流编排器
 *
 * 支持复杂的多Agent协作任务编排
 * 每个工作流由多个步骤组成，每个步骤调用不同的Agent或MCP工具
 */

import { randomUUID } from 'node:crypto'
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { callMcpTool } from '../mcp/registry.js'
import { operationService } from '../services/operation/operationService.js'

// 工作流步骤定义
export interface WorkflowStep {
  id: string
  name: string
  type: 'agent' | 'mcp' | 'condition' | 'parallel'
  agent?: string
  agentCapability?: string
  mcpTool?: string
  waitForOperation?: boolean
  parameters: Record<string, unknown>
  next?: string // 下一个步骤ID
  onError?: string // 错误处理步骤ID
}

// 工作流定义
export interface Workflow {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
  createdAt: Date
  updatedAt: Date
}

// 工作流执行实例
export interface WorkflowExecution {
  id: string
  workflowId: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  currentStep?: string
  stepResults: Map<string, unknown>
  errors: Array<{ stepId: string; error: string }>
  childOperationIds: string[]
  totalSteps: number
  completedSteps: number
  progress: number
  startedAt?: Date
  completedAt?: Date
}

const workflowExecutions = new Map<string, WorkflowExecution>()

// 预定义工作流模板
export const WorkflowTemplates: Record<string, Omit<Workflow, 'createdAt' | 'updatedAt'>> = {
  // 每日投资分析工作流
  dailyAnalysis: {
    id: 'daily_analysis',
    name: '每日投资分析',
    description: '多Agent协作完成每日投资分析',
    steps: [
      {
        id: 'fetch_prices',
        name: '获取实时价格',
        type: 'mcp',
        mcpTool: 'market_data.refresh_prices',
        waitForOperation: false,
        parameters: { userId: '{{userId}}', symbols: '{{symbols}}' },
      },
      {
        id: 'analyze_positions',
        name: '分析仓位',
        type: 'mcp',
        mcpTool: 'get_positions',
        parameters: { userId: '{{userId}}' },
      },
      {
        id: 'check_risk',
        name: '检查风险',
        type: 'mcp',
        mcpTool: 'alert.check',
        parameters: { userId: '{{userId}}', refreshPrices: false },
      },
      {
        id: 'generate_suggestions',
        name: '生成建议',
        type: 'mcp',
        mcpTool: 'advice.generate_daily',
        parameters: { userId: '{{userId}}', query: '{{query}}', scope: '{{scope}}' },
      },
    ],
  },

  // 策略回测工作流
  strategyBacktest: {
    id: 'strategy_backtest',
    name: '策略回测',
    description: '执行策略回测并生成报告',
    steps: [
      {
        id: 'run_backtest',
        name: '运行回测',
        type: 'mcp',
        mcpTool: 'run_backtest',
        parameters: { strategyId: '{{strategyId}}' },
      },
      {
        id: 'analyze_results',
        name: '分析结果',
        type: 'agent',
        agent: 'strategy_backtester',
        agentCapability: 'analyze_backtest_results',
        parameters: {},
      },
    ],
  },

  // 新闻情绪分析工作流
  newsSentiment: {
    id: 'news_sentiment',
    name: '新闻情绪分析',
    description: '分析持仓相关新闻情绪',
    steps: [
      {
        id: 'fetch_news',
        name: '获取新闻',
        type: 'agent',
        agent: 'news_intelligence',
        agentCapability: 'fetch_market_news',
        parameters: { symbols: '{{symbols}}' },
      },
      {
        id: 'sentiment_analysis',
        name: '情绪分析',
        type: 'agent',
        agent: 'news_intelligence',
        agentCapability: 'sentiment_analysis',
        parameters: {},
      },
      {
        id: 'impact_analysis',
        name: '影响分析',
        type: 'agent',
        agent: 'news_intelligence',
        agentCapability: 'event_impact_analysis',
        parameters: {},
      },
    ],
  },
} as const

// Workflow Router
export async function workflowRouter(app: FastifyInstance) {
  // 列出所有工作流模板
  app.get('/templates', async () => {
    return {
      templates: Object.values(WorkflowTemplates).map((wf) => ({
        id: wf.id,
        name: wf.name,
        description: wf.description,
        stepsCount: wf.steps.length,
      })),
    }
  })

  // 获取工作流详情
  app.get('/templates/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>) => {
    const template = Object.values(WorkflowTemplates).find((wf) => wf.id === request.params.id)
    if (!template) {
      return { error: 'Workflow template not found' }
    }
    return { workflow: template }
  })

  // 执行工作流
  app.post('/execute', async (request: FastifyRequest<{
    Body: {
      templateId: string
      parameters: Record<string, unknown>
    }
  }>, reply: FastifyReply) => {
    const { templateId, parameters } = request.body

    const template = Object.values(WorkflowTemplates).find((wf) => wf.id === templateId)
    if (!template) {
      return reply.status(404).send({ error: 'Workflow template not found' })
    }

    // 创建执行实例
    const execution: WorkflowExecution = {
      id: randomUUID(),
      workflowId: templateId,
      status: 'pending',
      stepResults: new Map(),
      errors: [],
      childOperationIds: [],
      totalSteps: template.steps.length,
      completedSteps: 0,
      progress: 0,
    }
    workflowExecutions.set(execution.id, execution)

    // 异步执行工作流
    executeWorkflow(template, execution, parameters).catch((error) => {
      if (execution.status === 'cancelled') return
      execution.status = 'failed'
      execution.progress = 100
      execution.completedAt = new Date()
      execution.errors.push({ stepId: 'workflow', error: error instanceof Error ? error.message : 'Unknown workflow error' })
    })

    return toExecutionDto(execution)
  })

  // 获取执行状态
  app.get('/executions/:id', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const execution = workflowExecutions.get(request.params.id)
    if (!execution) {
      return reply.status(404).send({ error: 'Workflow execution not found' })
    }

    return toExecutionDto(execution)
  })

  // 列出执行历史
  app.get('/executions', async () => {
    return {
      executions: [...workflowExecutions.values()]
        .sort((a, b) => (b.startedAt?.getTime() || 0) - (a.startedAt?.getTime() || 0))
        .map(toExecutionDto),
    }
  })

  // 取消执行
  app.post('/executions/:id/cancel', async (request: FastifyRequest<{
    Params: { id: string }
  }>, reply: FastifyReply) => {
    const execution = workflowExecutions.get(request.params.id)
    if (!execution) {
      return reply.status(404).send({ error: 'Workflow execution not found' })
    }

    if (execution.status !== 'completed' && execution.status !== 'failed' && execution.status !== 'cancelled') {
      execution.status = 'cancelled'
      execution.progress = 100
      execution.completedAt = new Date()

      await Promise.all(execution.childOperationIds.map(async (operationId) => {
        try {
          const operation = await operationService.getOperation(operationId)
          if (operation.status === 'queued' || operation.status === 'running') {
            await operationService.cancelOperation(operationId)
          }
        } catch {
          // Cancellation is best-effort because the workflow execution remains cancelled either way.
        }
      }))
    }

    return { success: true, execution: toExecutionDto(execution) }
  })
}

// 执行工作流
async function executeWorkflow(
  workflow: typeof WorkflowTemplates[keyof typeof WorkflowTemplates],
  execution: WorkflowExecution,
  parameters: Record<string, unknown>
) {
  execution.status = 'running'
  execution.startedAt = new Date()
  execution.progress = 0

  for (const [index, step] of workflow.steps.entries()) {
    if (isCancelled(execution)) return

    execution.currentStep = step.id

    try {
      let result: unknown

      switch (step.type) {
        case 'mcp':
          result = await executeMcpStep(step, execution, parameters)
          break

        case 'agent':
          // 调用Agent能力
          result = {
            success: true,
            status: 'completed',
            message: 'Agent step recorded; no executable agent service is registered for this capability',
            parameters: resolveParams(step.parameters, parameters),
          }
          break

        case 'parallel':
          // 并行执行多个步骤
          result = await Promise.all(
            (step.parameters.steps as WorkflowStep[])?.map(async (subStep) => {
              // 执行子步骤
              return { stepId: subStep.id, result: 'completed' }
            }) || []
          )
          break

        case 'condition':
          // 条件分支
          // const conditionMet = evaluateCondition(step.parameters.condition, execution.stepResults)
          const conditionMet = true
          if (conditionMet && step.next) {
            // 继续执行下一个步骤
          }
          result = { conditionMet }
          break
      }

      execution.stepResults.set(step.id, result)
      execution.completedSteps = index + 1
      execution.progress = Math.round((execution.completedSteps / workflow.steps.length) * 100)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      execution.errors.push({ stepId: step.id, error: errorMsg })

      if (step.onError) {
        // 执行错误处理步骤
      } else {
        execution.status = 'failed'
        execution.progress = 100
        execution.completedAt = new Date()
        return
      }
    }
  }

  if (isCancelled(execution)) return

  execution.status = 'completed'
  execution.currentStep = undefined
  execution.progress = 100
  execution.completedAt = new Date()
}

async function executeMcpStep(
  step: WorkflowStep,
  execution: WorkflowExecution,
  parameters: Record<string, unknown>
) {
  if (!step.mcpTool) {
    throw new Error(`Workflow step '${step.id}' is missing mcpTool`)
  }

  const resolvedParams = resolveParams(step.parameters, parameters)
  const callResult = await callMcpTool(step.mcpTool, compactParams(resolvedParams), {
    requestId: execution.id,
    transport: 'http',
  })

  if (!callResult.success) {
    throw new Error(callResult.error?.message || `MCP tool '${step.mcpTool}' failed`)
  }

  const operationId = extractOperationId(callResult.result)
  if (operationId) {
    execution.childOperationIds.push(operationId)
    if (step.waitForOperation === false) {
      return {
        ...callResult,
        operation: await operationService.getOperation(operationId),
        asyncContinuation: true,
      }
    }

    const operation = await waitForOperation(operationId, execution)

    return {
      ...callResult,
      operation,
    }
  }

  return callResult
}

async function waitForOperation(operationId: string, execution: WorkflowExecution) {
  const startedAt = Date.now()
  const timeoutMs = 5 * 60 * 1000

  while (true) {
    if (isCancelled(execution)) {
      return operationService.getOperation(operationId)
    }

    const operation = await operationService.getOperation(operationId)
    execution.stepResults.set(execution.currentStep || operationId, {
      operation,
    })

    if (operation.status === 'completed') {
      return operation
    }

    if (operation.status === 'failed' || operation.status === 'cancelled') {
      throw new Error(`Operation ${operationId} ${operation.status}`)
    }

    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Operation ${operationId} timed out`)
    }

    await sleep(1000)
  }
}

function extractOperationId(result: unknown) {
  if (!result || typeof result !== 'object') {
    return undefined
  }

  const candidate = result as { operationId?: unknown; operation_id?: unknown; id?: unknown; status?: unknown }
  const operationId = candidate.operationId || candidate.operation_id || candidate.id

  return typeof operationId === 'string' && typeof candidate.status === 'string' ? operationId : undefined
}

function compactParams(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => (
      value !== undefined
        && value !== null
        && !(typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}'))
    ))
  )
}

function toExecutionDto(execution: WorkflowExecution) {
  return {
    executionId: execution.id,
    id: execution.id,
    workflowId: execution.workflowId,
    status: execution.status,
    currentStep: execution.currentStep,
    progress: execution.progress,
    totalSteps: execution.totalSteps,
    completedSteps: execution.completedSteps,
    childOperationIds: execution.childOperationIds,
    stepResults: Object.fromEntries(execution.stepResults),
    errors: execution.errors,
    startedAt: execution.startedAt,
    completedAt: execution.completedAt,
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isCancelled(execution: WorkflowExecution) {
  return execution.status === 'cancelled'
}

// 解析参数（替换模板变量）
function resolveParams(params: Record<string, unknown>, context: Record<string, unknown>): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.startsWith('{{') && value.endsWith('}}')) {
      const varName = value.slice(2, -2)
      resolved[key] = context[varName] ?? value
    } else {
      resolved[key] = value
    }
  }
  return resolved
}
