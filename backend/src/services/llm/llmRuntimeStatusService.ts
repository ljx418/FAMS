export type LlmRuntimeCapability = 'chat_planner' | 'chat_summary'
export type LlmRuntimeState = 'not_attempted' | 'available' | 'degraded' | 'unavailable'
export type LlmFailureCode =
  | 'AUTH_FAILED'
  | 'QUOTA_EXHAUSTED'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_RESPONSE'
  | 'PROVIDER_ERROR'

export interface LlmRuntimeCapabilitySnapshot {
  capability: LlmRuntimeCapability
  state: LlmRuntimeState
  provider: string | null
  model: string | null
  lastAttemptAt: string | null
  lastSuccessAt: string | null
  lastFailureAt: string | null
  lastFailureCode: LlmFailureCode | null
  consecutiveFailures: number
  deterministicFallbackActive: boolean
}

type MutableRuntimeState = Omit<LlmRuntimeCapabilitySnapshot, 'state' | 'deterministicFallbackActive'> & {
  lastOutcome: 'success' | 'failure' | null
}

function emptyState(capability: LlmRuntimeCapability): MutableRuntimeState {
  return {
    capability,
    provider: null,
    model: null,
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFailureCode: null,
    consecutiveFailures: 0,
    lastOutcome: null,
  }
}

export function classifyLlmFailure(error: unknown): LlmFailureCode {
  const status = Number((error as any)?.status || (error as any)?.statusCode || (error as any)?.response?.status || 0)
  const message = String((error as any)?.message || error || '').toLowerCase()
  if (status === 401 || status === 403 || /unauthori[sz]ed|forbidden|invalid[ _-]?(api[ _-]?)?key|authentication/.test(message)) return 'AUTH_FAILED'
  if (status === 402 || /insufficient balance|quota exhausted|billing|payment required/.test(message)) return 'QUOTA_EXHAUSTED'
  if (status === 429 || /rate[ _-]?limit|too many requests/.test(message)) return 'RATE_LIMITED'
  if (/timeout|timed out|aborterror|aborted/.test(message)) return 'TIMEOUT'
  if (/enotfound|econnreset|econnrefused|network|fetch failed|socket hang up/.test(message)) return 'NETWORK_ERROR'
  if (/invalid response|invalid payload|unusable|parse|malformed|empty response/.test(message)) return 'INVALID_RESPONSE'
  return 'PROVIDER_ERROR'
}

export class LlmRuntimeStatusService {
  private readonly states = new Map<LlmRuntimeCapability, MutableRuntimeState>([
    ['chat_planner', emptyState('chat_planner')],
    ['chat_summary', emptyState('chat_summary')],
  ])

  recordAttempt(capability: LlmRuntimeCapability, input: { provider: string; model: string }) {
    const state = this.states.get(capability) || emptyState(capability)
    state.provider = input.provider
    state.model = input.model
    state.lastAttemptAt = new Date().toISOString()
    this.states.set(capability, state)
  }

  recordSuccess(capability: LlmRuntimeCapability) {
    const state = this.states.get(capability) || emptyState(capability)
    const now = new Date().toISOString()
    state.lastAttemptAt = state.lastAttemptAt || now
    state.lastSuccessAt = now
    state.lastFailureCode = null
    state.consecutiveFailures = 0
    state.lastOutcome = 'success'
    this.states.set(capability, state)
  }

  recordFailure(capability: LlmRuntimeCapability, error: unknown) {
    const state = this.states.get(capability) || emptyState(capability)
    const now = new Date().toISOString()
    state.lastAttemptAt = state.lastAttemptAt || now
    state.lastFailureAt = now
    state.lastFailureCode = classifyLlmFailure(error)
    state.consecutiveFailures += 1
    state.lastOutcome = 'failure'
    this.states.set(capability, state)
    return state.lastFailureCode
  }

  snapshot(capability: LlmRuntimeCapability): LlmRuntimeCapabilitySnapshot {
    const state = this.states.get(capability) || emptyState(capability)
    const runtimeState: LlmRuntimeState = state.lastOutcome === null
      ? 'not_attempted'
      : state.lastOutcome === 'success'
        ? 'available'
        : state.lastSuccessAt
          ? 'degraded'
          : 'unavailable'
    return {
      capability,
      state: runtimeState,
      provider: state.provider,
      model: state.model,
      lastAttemptAt: state.lastAttemptAt,
      lastSuccessAt: state.lastSuccessAt,
      lastFailureAt: state.lastFailureAt,
      lastFailureCode: state.lastFailureCode,
      consecutiveFailures: state.consecutiveFailures,
      deterministicFallbackActive: runtimeState === 'degraded' || runtimeState === 'unavailable',
    }
  }

  publicStatus() {
    return {
      schemaVersion: 'fams.llm.runtime_status.v1' as const,
      generatedAt: new Date().toISOString(),
      capabilities: {
        chatPlanner: this.snapshot('chat_planner'),
        chatSummary: this.snapshot('chat_summary'),
      },
      rawProviderErrorsExposed: false,
      secretsRedacted: true as const,
    }
  }

  resetForVerification() {
    this.states.set('chat_planner', emptyState('chat_planner'))
    this.states.set('chat_summary', emptyState('chat_summary'))
  }
}

export const llmRuntimeStatusService = new LlmRuntimeStatusService()
