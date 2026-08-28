import { describe, expect, it } from 'vitest'
import type { OperationCommand } from '../src/contracts/types'
import { dispatchAtMostOnce, type LedgerRecord, type LedgerStorage } from '../src/state/idempotencyRegistry'

const command: OperationCommand = {
  schemaVersion: 'v2-px-operation-command/2',
  productId: 'fams-v2-px',
  commandId: 'px-command-idempotency00000001',
  idempotencyKey: 'px-idem-idempotency00000001',
  payloadDigest: 'a'.repeat(64),
  routeId: 'px-route-idempotency00000001',
  correlationId: 'px-corr-idempotency00000001',
  commandType: 'query',
  sourceContainer: 'workspace_page',
  targetContainer: 'background',
  permissionType: 'compute_quick_run',
  payload: { workspaceId: 'default_workspace', question: '真实问题', contextRefs: [] },
  requestedAt: '2026-08-28T00:00:00.000Z',
}

class MemoryStorage implements LedgerStorage {
  records: LedgerRecord[] = []
  writes = 0
  failAtWrite: number | null = null
  async readAll() { return structuredClone(this.records) }
  async writeAll(records: LedgerRecord[]) {
    this.writes += 1
    if (this.failAtWrite === this.writes) throw new Error('injected storage failure')
    this.records = structuredClone(records)
  }
}

describe('at-most-once dispatch ledger', () => {
  it('does not dispatch when prepared persistence fails', async () => {
    const storage = new MemoryStorage()
    storage.failAtWrite = 1
    let requests = 0
    const result = await dispatchAtMostOnce({ command, storage, dispatch: async () => { requests += 1; return { status: 'completed' } } })
    expect(result.status).toBe('failed')
    expect(result.error?.code).toBe('PX_STORAGE_WRITE_FAILED_BEFORE_EFFECT')
    expect(requests).toBe(0)
  })

  it('returns unknown_result and never retries after result persistence fails', async () => {
    const storage = new MemoryStorage()
    storage.failAtWrite = 3
    let requests = 0
    const result = await dispatchAtMostOnce({
      command,
      storage,
      dispatch: async () => { requests += 1; return { status: 'completed', resultRef: { conversationId: 'conversation_real' } } },
    })
    expect(result.status).toBe('unknown_result')
    expect(result.error?.code).toBe('PX_RESULT_NOT_PERSISTED')
    expect(requests).toBe(1)
  })

  it('replays completed result and blocks a digest conflict without a second dispatch', async () => {
    const storage = new MemoryStorage()
    let requests = 0
    const dispatch = async () => { requests += 1; return { status: 'completed' as const, resultRef: { operationId: 'operation_real' } } }
    const first = await dispatchAtMostOnce({ command, storage, dispatch })
    const replay = await dispatchAtMostOnce({ command, storage, dispatch })
    const conflict = await dispatchAtMostOnce({ command: { ...command, payloadDigest: 'b'.repeat(64) }, storage, dispatch })
    expect(first.status).toBe('completed')
    expect(replay.resultRef?.operationId).toBe('operation_real')
    expect(conflict.error?.code).toBe('PX_IDEMPOTENCY_CONFLICT')
    expect(requests).toBe(1)
  })
})
