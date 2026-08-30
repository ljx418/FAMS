import { describe, expect, it } from 'vitest'
import type { OperationCommand } from '../src/contracts/types'
import { cleanLedgerStorage, dispatchAtMostOnce, type LedgerRecord, type LedgerStorage } from '../src/state/idempotencyRegistry'

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
  payload: { workspaceId: 'px-ws-00000000-0000-4000-8000-000000000001', question: '真实问题', contextRefs: [] },
  requestedAt: '2026-08-28T00:00:00.000Z',
}

class MemoryStorage implements LedgerStorage {
  records: LedgerRecord[] = []
  writes = 0
  reads = 0
  failAtWrite: number | null = null
  mutateAtRead: { read: number; mutate: (records: LedgerRecord[]) => void } | null = null
  async readAll() {
    this.reads += 1
    const records = structuredClone(this.records)
    if (this.mutateAtRead?.read === this.reads) this.mutateAtRead.mutate(records)
    return records
  }
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

  it('serializes 20 concurrent replays so the backend dispatch happens once', async () => {
    const storage = new MemoryStorage()
    let requests = 0
    const results = await Promise.all(Array.from({ length: 20 }, () => dispatchAtMostOnce({
      command,
      storage,
      dispatch: async () => {
        requests += 1
        await new Promise((resolve) => setTimeout(resolve, 2))
        return { status: 'completed' as const, resultRef: { conversationId: 'chat-00fdc188-0b6b-4731-81eb-d5fc91de01ed' } }
      },
    })))
    expect(requests).toBe(1)
    expect(results.every((result) => result.status === 'completed')).toBe(true)
  })

  it('rejects a completed readback whose resultRef drifted instead of returning false success', async () => {
    const storage = new MemoryStorage()
    storage.mutateAtRead = { read: 4, mutate: (records) => { delete records[0]?.resultRef } }
    let requests = 0
    const result = await dispatchAtMostOnce({
      command,
      storage,
      dispatch: async () => { requests += 1; return { status: 'completed', resultRef: { conversationId: 'chat-00fdc188-0b6b-4731-81eb-d5fc91de01ed' } } },
    })
    expect(requests).toBe(1)
    expect(result.status).toBe('unknown_result')
    expect(result.error?.code).toBe('PX_RESULT_NOT_PERSISTED')
  })

  it('does not dispatch when dispatched persistence fails', async () => {
    const storage = new MemoryStorage()
    storage.failAtWrite = 2
    let requests = 0
    const result = await dispatchAtMostOnce({ command, storage, dispatch: async () => { requests += 1; return { status: 'completed' } } })
    expect(result.error?.code).toBe('PX_STORAGE_WRITE_FAILED_BEFORE_EFFECT')
    expect(requests).toBe(0)
  })

  it.each([2, 3])('does not dispatch when ledger readback %s is inconsistent', async (read) => {
    const storage = new MemoryStorage()
    storage.mutateAtRead = { read, mutate: (records) => { if (records[0]) records[0].payloadDigest = 'b'.repeat(64) } }
    let requests = 0
    const result = await dispatchAtMostOnce({ command, storage, dispatch: async () => { requests += 1; return { status: 'completed' } } })
    expect(result.error?.code).toBe('PX_STORAGE_WRITE_FAILED_BEFORE_EFFECT')
    expect(requests).toBe(0)
  })

  it('cleans expired records and enforces the 500-record LRU cap inside the dispatch queue', async () => {
    const storage = new MemoryStorage()
    const base = Date.parse('2026-08-29T00:00:00.000Z')
    storage.records = Array.from({ length: 501 }, (_, index) => ({
      idempotencyKey: `px-idem-existing-${String(index).padStart(4, '0')}`,
      payloadDigest: String(index).padStart(64, '0'),
      dispatchState: 'completed' as const,
      resultStatus: 'completed' as const,
      createdAt: new Date(base - 1000).toISOString(),
      expiresAt: new Date(index === 0 ? base - 1 : base + 86_400_000).toISOString(),
      lastAccessedAt: new Date(base + index).toISOString(),
    }))
    let requests = 0
    const result = await dispatchAtMostOnce({
      command,
      storage,
      now: new Date(base),
      dispatch: async () => { requests += 1; return { status: 'completed' } },
    })
    expect(result.status).toBe('completed')
    expect(requests).toBe(1)
    expect(storage.records).toHaveLength(500)
    expect(storage.records.some((record) => record.idempotencyKey === 'px-idem-existing-0000')).toBe(false)
    expect(storage.records.some((record) => record.idempotencyKey === command.idempotencyKey)).toBe(true)
  })

  it('retains exactly the latest 500 live records during independent startup cleanup', async () => {
    const storage = new MemoryStorage()
    const base = Date.parse('2026-08-29T00:00:00.000Z')
    storage.records = Array.from({ length: 502 }, (_, index) => ({
      idempotencyKey: `px-idem-startup-${String(index).padStart(4, '0')}`,
      payloadDigest: String(index).padStart(64, '0'),
      dispatchState: 'completed' as const,
      resultStatus: 'completed' as const,
      createdAt: new Date(base - 1000).toISOString(),
      expiresAt: new Date(index === 0 ? base - 1 : base + 86_400_000).toISOString(),
      lastAccessedAt: new Date(base + index).toISOString(),
    }))
    const cleaned = await cleanLedgerStorage(storage, new Date(base))
    expect(cleaned).toHaveLength(500)
    expect(storage.records).toHaveLength(500)
    expect(storage.records[0]?.idempotencyKey).toBe('px-idem-startup-0002')
    expect(storage.records.at(-1)?.idempotencyKey).toBe('px-idem-startup-0501')
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

  it('keeps a dispatched network failure unknown and never performs an automatic second POST', async () => {
    const storage = new MemoryStorage()
    let requests = 0
    const first = await dispatchAtMostOnce({
      command,
      storage,
      dispatch: async () => { requests += 1; throw new Error('injected response loss') },
    })
    const reload = await dispatchAtMostOnce({
      command,
      storage,
      dispatch: async () => { requests += 1; return { status: 'completed' } },
    })
    expect(first.status).toBe('unknown_result')
    expect(reload.status).toBe('unknown_result')
    expect(requests).toBe(1)
  })

  it('persists and replays a policy-blocked result without another dispatch', async () => {
    const storage = new MemoryStorage()
    let requests = 0
    const dispatch = async () => { requests += 1; return { status: 'blocked' as const, resultRef: { conversationId: 'chat-00fdc188-0b6b-4731-81eb-d5fc91de01ed' } } }
    expect((await dispatchAtMostOnce({ command, storage, dispatch })).status).toBe('blocked')
    expect((await dispatchAtMostOnce({ command, storage, dispatch })).status).toBe('blocked')
    expect(requests).toBe(1)
  })
})
