import { afterEach, describe, expect, it, vi } from 'vitest'
import type { TraceResult } from '../src/adapters/fams/types'
import type { WorkspaceStateV1 } from '../src/contracts/types'
import { OPERATION_POLL_DELAYS_MS, OperationPoller } from '../src/background/operationPoller'

const workspaceId = 'px-ws-00000000-0000-4000-8000-000000000001'
const operationId = '752c6874-0c65-49f0-be70-13367f724798'
const state: WorkspaceStateV1 = {
  schemaVersion: 'v2-px-workspace-state/1', workspaceId, lifecycleStatus: 'ready', currentView: 'trace',
  routeId: 'px-route-operationpoller0001', correlationId: 'px-corr-operationpoller0001', activeOperationId: operationId,
  connection: { status: 'connected' }, recovery: { status: 'restored' },
  containerLeases: [{ container: 'workspace_page', instanceId: 'px-container-poller00000001', lastSeenAt: '2026-08-31T00:00:00.000Z' }],
  lastEventSeq: 1, updatedAt: '2026-08-31T00:00:00.000Z',
}
const runningTrace: TraceResult = {
  operationId, type: 'batch_factset_refresh', status: 'running', progressPct: 23,
  requestedAt: '2026-08-31T00:00:00.000Z', tasks: [], artifactRefs: [],
}

function poller(input: { states?: Record<string, WorkspaceStateV1>; loadTrace?: () => Promise<TraceResult> } = {}) {
  const loadTrace = vi.fn(input.loadTrace ?? (async () => runningTrace))
  const instance = new OperationPoller({
    readStates: async () => input.states ?? { [workspaceId]: state },
    loadTrace,
    wait: (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    now: () => Date.now(),
  })
  return { instance, loadTrace }
}

describe('bounded active Operation GET poller', () => {
  afterEach(() => { vi.useRealTimers() })

  it('uses exactly 2/4/8/10 seconds and stops after four nonterminal GETs', async () => {
    vi.useFakeTimers()
    const { instance, loadTrace } = poller()
    const lost = vi.fn(async () => undefined)
    const result = instance.run(workspaceId, operationId, { onConnectionLost: lost })
    for (const [index, delay] of OPERATION_POLL_DELAYS_MS.entries()) {
      await vi.advanceTimersByTimeAsync(delay)
      expect(loadTrace).toHaveBeenCalledTimes(index + 1)
    }
    await expect(result).resolves.toEqual({ status: 'completed', pollCount: 4, reason: 'bounded_complete' })
    expect(loadTrace).toHaveBeenCalledTimes(4)
    expect(instance.activeWorkspaceIds()).toEqual([])
    expect(lost).not.toHaveBeenCalled()
  })

  it('does not start without a live lease and stops on a terminal result', async () => {
    vi.useFakeTimers()
    const noLease = poller({ states: { [workspaceId]: { ...state, containerLeases: [] } } })
    await expect(noLease.instance.run(workspaceId, operationId, { onConnectionLost: async () => undefined }))
      .resolves.toEqual({ status: 'stopped', pollCount: 0, reason: 'not_eligible' })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(noLease.loadTrace).not.toHaveBeenCalled()

    const terminal = poller({ loadTrace: async () => ({ ...runningTrace, status: 'completed', completedAt: '2026-08-31T00:01:00.000Z' }) })
    const terminalResult = terminal.instance.run(workspaceId, operationId, { onConnectionLost: async () => undefined })
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(terminalResult).resolves.toEqual({ status: 'completed', pollCount: 1, reason: 'terminal' })
    expect(terminal.loadTrace).toHaveBeenCalledTimes(1)
    expect(terminal.instance.activeWorkspaceIds()).toEqual([])
  })

  it('stops and reports one connection loss after a failed GET', async () => {
    vi.useFakeTimers()
    const { instance, loadTrace } = poller({ loadTrace: async () => { throw new Error('server stopped') } })
    const lost = vi.fn(async () => undefined)
    const result = instance.run(workspaceId, operationId, { onConnectionLost: lost })
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(result).resolves.toEqual({ status: 'failed', pollCount: 0, reason: 'connection_lost' })
    expect(loadTrace).toHaveBeenCalledTimes(1)
    expect(lost).toHaveBeenCalledWith(workspaceId)
    expect(instance.activeWorkspaceIds()).toEqual([])
    await vi.advanceTimersByTimeAsync(30_000)
    expect(loadTrace).toHaveBeenCalledTimes(1)
  })

  it('coalesces concurrent starts for the same workspace and Operation', async () => {
    vi.useFakeTimers()
    const { instance, loadTrace } = poller()
    const first = instance.run(workspaceId, operationId, { onConnectionLost: async () => undefined })
    const second = instance.run(workspaceId, operationId, { onConnectionLost: async () => undefined })
    for (const delay of OPERATION_POLL_DELAYS_MS) await vi.advanceTimersByTimeAsync(delay)
    await expect(Promise.all([first, second])).resolves.toEqual([
      { status: 'completed', pollCount: 4, reason: 'bounded_complete' },
      { status: 'completed', pollCount: 4, reason: 'bounded_complete' },
    ])
    expect(loadTrace).toHaveBeenCalledTimes(4)
  })

  it('anchors intervals to GET start time instead of adding network duration', async () => {
    vi.useFakeTimers()
    const startedAt: number[] = []
    const { instance } = poller({
      loadTrace: async () => {
        startedAt.push(Date.now())
        await new Promise((resolve) => setTimeout(resolve, 1_500))
        return runningTrace
      },
    })
    const baseline = Date.now()
    const result = instance.run(workspaceId, operationId, { onConnectionLost: async () => undefined })
    await vi.advanceTimersByTimeAsync(26_000)
    await expect(result).resolves.toEqual({ status: 'completed', pollCount: 4, reason: 'bounded_complete' })
    expect(startedAt.map((value) => value - baseline)).toEqual([2_000, 6_000, 14_000, 24_000])
  })
})
