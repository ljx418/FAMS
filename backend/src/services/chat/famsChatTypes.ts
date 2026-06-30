export type FamsChatToolRisk = 'read' | 'confirm_required' | 'blocked'

export type FamsChatIntent =
  | 'dividend_low_vol_candidates'
  | 'dividend_low_vol_scan'
  | 'portfolio_summary'
  | 'portfolio_backtest'
  | 'manual_trade_draft'
  | 'operation_status'
  | 'trade_action_blocked'
  | 'capability_help'

export interface FamsChatActionCard {
  id: string
  type: 'navigation' | 'tool_confirmation' | 'artifact' | 'blocked' | 'result'
  title: string
  description: string
  href?: string
  method?: 'GET' | 'POST'
  endpoint?: string
  body?: Record<string, unknown>
  toolName?: string
  confirmationId?: string
  status?: 'ready' | 'requires_confirmation' | 'blocked' | 'completed'
}

export interface FamsChatResponse {
  schemaVersion: 'fams.chat.response.v1'
  generatedAt: string
  conversationId: string
  messageId: string
  reply: string
  intent: FamsChatIntent
  confidence: number
  actionCards: FamsChatActionCard[]
  requiresConfirmation: boolean
  operationId?: string
  artifactRefs: string[]
  blockedReasons: string[]
  allowedActions: string[]
  prohibitedActions: string[]
  agentCore: {
    provider: 'pi-agent-core'
    mode: 'deterministic_planner' | 'pi_agent_loop'
    runtimeAvailable: boolean
    nodeVersion: string
    note: string
  }
  notTradingAdvice: true
}

export interface FamsChatMessageInput {
  conversationId?: string
  userId?: string
  message: string
  context?: Record<string, unknown>
}

export interface FamsChatConfirmationInput {
  userId?: string
  conversationId?: string
  confirmationId: string
}

export interface FamsChatTool {
  name: string
  label: string
  description: string
  risk: FamsChatToolRisk
  execute: (args: Record<string, unknown>) => Promise<{
    reply: string
    actionCards?: FamsChatActionCard[]
    operationId?: string
    artifactRefs?: string[]
    blockedReasons?: string[]
  }>
}
