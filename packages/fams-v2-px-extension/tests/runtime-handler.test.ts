import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OperationCommand, RuntimeMessage } from '../src/contracts/types'

const runtime = vi.hoisted(() => ({
  local: {} as Record<string, unknown>,
  session: {} as Record<string, unknown>,
  writes: [] as string[],
  failRecoveryWrite: false,
}))
const api = vi.hoisted(() => ({ ask: vi.fn() }))

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'a'.repeat(32), getURL: (path: string) => `chrome-extension://${'a'.repeat(32)}${path}` },
    permissions: { contains: vi.fn(async () => true), request: vi.fn(async () => true) },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: runtime.local[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          const [key] = Object.keys(values)
          const records = values[key!]
          const state = Array.isArray(records) && records.length > 0 && 'dispatchState' in records.at(-1)! ? `:${String(records.at(-1)!.dispatchState)}` : ''
          runtime.writes.push(`local:${key}${state}`)
          if (key === 'recoveryIndex' && runtime.failRecoveryWrite) throw new Error('injected recovery write failure')
          Object.assign(runtime.local, structuredClone(values))
        }),
      },
      session: {
        get: vi.fn(async (key: string) => ({ [key]: runtime.session[key] })),
        set: vi.fn(async (values: Record<string, unknown>) => {
          runtime.writes.push(`session:${Object.keys(values).sort().join('+')}`)
          Object.assign(runtime.session, structuredClone(values))
        }),
      },
    },
    tabs: { query: vi.fn(async () => []), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
    windows: { update: vi.fn() },
  },
}))

vi.mock('../src/adapters/fams/FamsApiClient', () => ({
  FamsApiClient: class {
    ask(input: unknown) { return api.ask(input) }
  },
}))

import { handleRuntimeMessage } from '../src/background/runtimeHandler'

const command: OperationCommand = {
  schemaVersion: 'v2-px-operation-command/2',
  productId: 'fams-v2-px',
  commandId: 'px-command-runtimehandler00000001',
  idempotencyKey: 'px-idem-runtimehandler00000001',
  payloadDigest: 'a'.repeat(64),
  routeId: 'px-route-runtimehandler00000001',
  correlationId: 'px-corr-runtimehandler00000001',
  commandType: 'query',
  sourceContainer: 'workspace_page',
  targetContainer: 'background',
  permissionType: 'compute_quick_run',
  payload: { workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', question: '真实并发问题', contextRefs: [] },
  requestedAt: '2026-08-29T00:00:00.000Z',
}

const message: RuntimeMessage = {
  schemaVersion: 'v2-px-runtime-message/1',
  messageType: 'operation_command',
  routeId: command.routeId,
  correlationId: command.correlationId,
  idempotencyKey: command.idempotencyKey,
  sourceContainer: command.sourceContainer,
  targetContainer: command.targetContainer,
  sentAt: command.requestedAt,
  payload: command,
}

function askResponse() {
  return {
    schemaVersion: 'fams.external-brain.response.v1',
    requestId: 'px-request-runtime-handler',
    generatedAt: '2026-08-29T00:00:01.000Z',
    status: 'ok',
    data: {
      conversationId: 'chat-00fdc188-0b6b-4731-81eb-d5fc91de01ed',
      messageId: 'message-real-1',
      summary: '真实摘要',
      keyEvidence: [],
      dataAsOf: '2026-08-29T00:00:01.000Z',
      confidence: 0.8,
      nextActions: ['人工核对'],
      artifactRefs: [],
      prohibitedActions: ['ORDER_CREATE'],
      notTradingAdvice: true,
    },
    evidenceRefs: [],
    warnings: [],
    executionBoundary: { researchOnly: true, formalTradingUnlocked: false, autoTradeUnlocked: false, canCreateOrder: false, orderCreateAllowed: false },
  }
}

describe('runtime query persistence ordering', () => {
  beforeEach(() => {
    for (const key of Object.keys(runtime.local)) delete runtime.local[key]
    for (const key of Object.keys(runtime.session)) delete runtime.session[key]
    runtime.writes.length = 0
    runtime.failRecoveryWrite = false
    api.ask.mockReset()
    api.ask.mockImplementation(async () => structuredClone(askResponse()))
  })

  it('serializes 20 runtime messages, sends one POST, and persists ledger then recovery then session', async () => {
    const results = await Promise.all(Array.from({ length: 20 }, () => handleRuntimeMessage(structuredClone(message), { senderUrl: `chrome-extension://${'a'.repeat(32)}/workspace.html` })))
    expect(api.ask).toHaveBeenCalledTimes(1)
    expect(results.every((result) => 'commandResult' in result && result.commandResult.status === 'completed')).toBe(true)
    const firstCompleted = runtime.writes.indexOf('local:dispatchLedger:completed')
    const firstRecovery = runtime.writes.indexOf('local:recoveryIndex')
    const firstSession = runtime.writes.indexOf('session:lifecycleEvents+workspaceStates')
    expect(firstCompleted).toBeGreaterThanOrEqual(0)
    expect(firstRecovery).toBeGreaterThan(firstCompleted)
    expect(firstSession).toBeGreaterThan(firstRecovery)
    expect(JSON.stringify({ local: runtime.local, session: runtime.session })).not.toContain('真实并发问题')
  })

  it('returns unknown_result after a real result when recovery persistence fails, then replays without a second POST', async () => {
    runtime.failRecoveryWrite = true
    const first = await handleRuntimeMessage(structuredClone(message), { senderUrl: `chrome-extension://${'a'.repeat(32)}/workspace.html` })
    expect('commandResult' in first && first.commandResult.status).toBe('unknown_result')
    expect('commandResult' in first && first.commandResult.error?.code).toBe('PX_RESULT_NOT_PERSISTED')
    runtime.failRecoveryWrite = false
    const replay = await handleRuntimeMessage(structuredClone(message), { senderUrl: `chrome-extension://${'a'.repeat(32)}/workspace.html` })
    expect('commandResult' in replay && replay.commandResult.status).toBe('completed')
    expect(api.ask).toHaveBeenCalledTimes(1)
  })

  it('blocks a Side Panel sender that claims to be Workspace before storage or API effects', async () => {
    const result = await handleRuntimeMessage(structuredClone(message), { senderUrl: `chrome-extension://${'a'.repeat(32)}/sidepanel.html` })
    expect('status' in result && result.status).toBe('blocked')
    expect(api.ask).not.toHaveBeenCalled()
    expect(runtime.writes).toEqual([])
  })
})
