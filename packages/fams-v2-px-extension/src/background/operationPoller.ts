import { browser } from 'wxt/browser'
import { FamsApiClient } from '../adapters/fams/FamsApiClient'
import type { TraceResult } from '../adapters/fams/types'
import type { WorkspaceStateV1 } from '../contracts/types'
import { readWorkspaceStates } from './chromeStorage'

export const OPERATION_POLL_DELAYS_MS = [2_000, 4_000, 8_000, 10_000] as const
const TERMINAL_OPERATION_STATUSES = new Set(['completed', 'succeeded', 'failed', 'cancelled'])

export type OperationPollerHooks = { onConnectionLost(workspaceId: string): Promise<void> }
export type OperationPollResult = {
  status: 'completed' | 'stopped' | 'failed'
  pollCount: number
  reason: 'bounded_complete' | 'terminal' | 'not_eligible' | 'cancelled' | 'connection_lost'
}

export type OperationPollerDependencies = {
  readStates(): Promise<Record<string, WorkspaceStateV1>>
  loadTrace(operationId: string): Promise<TraceResult>
  wait(delayMs: number): Promise<void>
  now(): number
}

type PollEntry = { operationId: string; generation: number; result: Promise<OperationPollResult> }

function pollEligible(state: WorkspaceStateV1 | undefined, operationId: string): boolean {
  return state?.activeOperationId === operationId
    && state.containerLeases.length > 0
    && !['blocked', 'closed', 'disconnected', 'failed'].includes(state.lifecycleStatus)
}

export class OperationPoller {
  private readonly entries = new Map<string, PollEntry>()
  private generation = 0

  constructor(private readonly dependencies: OperationPollerDependencies) {}

  async run(workspaceId: string, operationId: string, hooks: OperationPollerHooks): Promise<OperationPollResult> {
    const initial = (await this.dependencies.readStates())[workspaceId]
    if (!pollEligible(initial, operationId)) return { status: 'stopped', pollCount: 0, reason: 'not_eligible' }
    const existing = this.entries.get(workspaceId)
    if (existing?.operationId === operationId) return existing.result
    this.stop(workspaceId)
    const generation = ++this.generation
    const result = this.runBounded(workspaceId, operationId, generation, hooks)
    this.entries.set(workspaceId, { operationId, generation, result })
    try {
      return await result
    } finally {
      if (this.entries.get(workspaceId)?.generation === generation) this.entries.delete(workspaceId)
    }
  }

  stop(workspaceId: string): void {
    this.entries.delete(workspaceId)
  }

  stopAll(): void {
    this.entries.clear()
  }

  activeWorkspaceIds(): string[] {
    return [...this.entries.keys()]
  }

  private async runBounded(workspaceId: string, operationId: string, generation: number, hooks: OperationPollerHooks): Promise<OperationPollResult> {
    let pollCount = 0
    let previousPollStartedAt = this.dependencies.now()
    for (const delay of OPERATION_POLL_DELAYS_MS) {
      const remainingDelay = Math.max(0, delay - (this.dependencies.now() - previousPollStartedAt))
      await this.dependencies.wait(remainingDelay)
      const currentEntry = this.entries.get(workspaceId)
      if (currentEntry?.generation !== generation) return { status: 'stopped', pollCount, reason: 'cancelled' }
      const state = (await this.dependencies.readStates())[workspaceId]
      if (!pollEligible(state, operationId)) return { status: 'stopped', pollCount, reason: 'not_eligible' }
      let trace: TraceResult
      try {
        previousPollStartedAt = this.dependencies.now()
        trace = await this.dependencies.loadTrace(operationId)
        pollCount += 1
      } catch {
        await hooks.onConnectionLost(workspaceId)
        return { status: 'failed', pollCount, reason: 'connection_lost' }
      }
      if (trace.completedAt || TERMINAL_OPERATION_STATUSES.has(trace.status)) {
        return { status: 'completed', pollCount, reason: 'terminal' }
      }
    }
    return { status: 'completed', pollCount, reason: 'bounded_complete' }
  }
}

export const operationPoller = new OperationPoller({
  readStates: readWorkspaceStates,
  loadTrace: async (operationId) => {
    const response = await new FamsApiClient(browser.runtime.id).getTrace(operationId)
    if (!response.data) throw new Error('PX_OPERATION_TRACE_MISSING')
    return response.data
  },
  wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  now: () => Date.now(),
})
