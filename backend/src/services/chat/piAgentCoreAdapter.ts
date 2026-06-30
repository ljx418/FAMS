import type { AgentTool, AfterToolCallResult, BeforeToolCallResult } from '@earendil-works/pi-agent-core'
import type { FamsChatTool, FamsChatToolRisk } from './famsChatTypes.js'

const MIN_PI_NODE_MAJOR = 22
const MIN_PI_NODE_MINOR = 19

function parseNodeVersion(version: string) {
  const [major = 0, minor = 0, patch = 0] = version.replace(/^v/, '').split('.').map((part) => Number(part))
  return { major, minor, patch }
}

function isNodeVersionSupported(version: string) {
  const parsed = parseNodeVersion(version)
  return parsed.major > MIN_PI_NODE_MAJOR || (parsed.major === MIN_PI_NODE_MAJOR && parsed.minor >= MIN_PI_NODE_MINOR)
}

class PiAgentCoreAdapter {
  readonly provider = 'pi-agent-core' as const

  buildToolManifest(tools: FamsChatTool[]): AgentTool<any>[] {
    return tools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: `${tool.description} Risk=${tool.risk}. FAMS trade gate applies.`,
      parameters: {
        type: 'object',
        additionalProperties: true,
        properties: {},
      } as any,
      executionMode: tool.risk === 'read' ? 'parallel' : 'sequential',
      execute: async (_toolCallId: string, params: Record<string, unknown>) => {
        const result = await tool.execute(params || {})
        return {
          content: [{ type: 'text', text: result.reply }],
          details: {
            actionCards: result.actionCards || [],
            operationId: result.operationId,
            artifactRefs: result.artifactRefs || [],
            blockedReasons: result.blockedReasons || [],
          },
          terminate: true,
        }
      },
    })) as AgentTool<any>[]
  }

  beforeToolCall(toolName: string, risk: FamsChatToolRisk, confirmed: boolean): BeforeToolCallResult | undefined {
    if (risk === 'blocked') {
      return { block: true, reason: `${toolName} is blocked by FAMS trade gate.` }
    }
    if (risk === 'confirm_required' && !confirmed) {
      return { block: true, reason: `${toolName} requires explicit user confirmation.` }
    }
    return undefined
  }

  afterToolCall(details: Record<string, unknown>): AfterToolCallResult {
    return {
      details: {
        ...details,
        auditedBy: 'fams.pi_agent_core_adapter',
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
      },
    }
  }

  async getRuntimeStatus() {
    const nodeVersion = process.version
    const nodeSupported = isNodeVersionSupported(nodeVersion)
    let runtimeAvailable = false
    let importError: string | null = null
    try {
      await import('@earendil-works/pi-agent-core')
      runtimeAvailable = true
    } catch (error: any) {
      importError = error?.message || String(error)
    }
    return {
      provider: this.provider,
      runtimeAvailable,
      nodeVersion,
      nodeSupported,
      importError,
      minimumNodeVersion: '>=22.19.0',
      securityBoundary: {
        unrestrictedLocalToolsExposed: false,
        famsAllowlistedToolsOnly: true,
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
      },
    }
  }
}

export const piAgentCoreAdapter = new PiAgentCoreAdapter()
