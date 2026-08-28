import type { CommandResult, OperationCommand } from '../contracts/types'

export type DispatchState = 'prepared' | 'dispatched' | 'completed'

export type LedgerRecord = {
  idempotencyKey: string
  payloadDigest: string
  dispatchState: DispatchState
  resultRef?: CommandResult['resultRef']
  resultStatus?: 'completed' | 'empty' | 'blocked'
  createdAt: string
  expiresAt: string
  lastAccessedAt: string
}

export type LedgerStorage = {
  readAll(): Promise<LedgerRecord[]>
  writeAll(records: LedgerRecord[]): Promise<void>
}

const DAY_MS = 24 * 60 * 60 * 1000

function clean(records: LedgerRecord[], nowMs: number): LedgerRecord[] {
  return records
    .filter((record) => Date.parse(record.expiresAt) > nowMs)
    .sort((left, right) => Date.parse(left.lastAccessedAt) - Date.parse(right.lastAccessedAt))
    .slice(-499)
}

async function persistAndVerify(storage: LedgerStorage, records: LedgerRecord[], expected: LedgerRecord): Promise<void> {
  await storage.writeAll(records)
  const readback = await storage.readAll()
  const actual = readback.find((item) => item.idempotencyKey === expected.idempotencyKey)
  if (!actual || actual.payloadDigest !== expected.payloadDigest || actual.dispatchState !== expected.dispatchState) {
    throw new Error('PX ledger readback verification failed')
  }
}

function baseResult(command: OperationCommand): Pick<CommandResult, 'schemaVersion' | 'commandId' | 'routeId' | 'correlationId' | 'completedAt'> {
  return {
    schemaVersion: 'v2-px-command-result/1',
    commandId: command.commandId,
    routeId: command.routeId,
    correlationId: command.correlationId,
    completedAt: new Date().toISOString(),
  }
}

export async function dispatchAtMostOnce(input: {
  command: OperationCommand
  storage: LedgerStorage
  dispatch: () => Promise<{ status: 'completed' | 'empty' | 'blocked'; resultRef?: CommandResult['resultRef'] }>
  now?: Date
}): Promise<CommandResult> {
  const now = input.now ?? new Date()
  const nowIso = now.toISOString()
  let records = clean(await input.storage.readAll(), now.getTime())
  const existing = records.find((record) => record.idempotencyKey === input.command.idempotencyKey)
  if (existing?.payloadDigest !== undefined && existing.payloadDigest !== input.command.payloadDigest) {
    return {
      ...baseResult(input.command),
      status: 'blocked',
      error: { code: 'PX_IDEMPOTENCY_CONFLICT', userMessage: '相同请求标识对应了不同内容，已阻止执行。', recoverable: false },
    }
  }
  if (existing?.dispatchState === 'completed') {
    return { ...baseResult(input.command), status: existing.resultStatus ?? 'completed', ...(existing.resultRef ? { resultRef: existing.resultRef } : {}) }
  }
  if (existing?.dispatchState === 'dispatched') {
    return {
      ...baseResult(input.command),
      status: 'unknown_result',
      error: { code: 'PX_UNKNOWN_DISPATCH_RESULT', userMessage: '上次请求可能已经执行，请到 FAMS 手动复核。', recoverable: false },
    }
  }

  const prepared: LedgerRecord = existing ?? {
    idempotencyKey: input.command.idempotencyKey,
    payloadDigest: input.command.payloadDigest,
    dispatchState: 'prepared',
    createdAt: nowIso,
    expiresAt: new Date(now.getTime() + DAY_MS).toISOString(),
    lastAccessedAt: nowIso,
  }
  records = [...records.filter((record) => record.idempotencyKey !== prepared.idempotencyKey), prepared]
  try {
    await persistAndVerify(input.storage, records, prepared)
    const dispatched = { ...prepared, dispatchState: 'dispatched' as const, lastAccessedAt: nowIso }
    records = [...records.filter((record) => record.idempotencyKey !== prepared.idempotencyKey), dispatched]
    await persistAndVerify(input.storage, records, dispatched)
  } catch {
    return {
      ...baseResult(input.command),
      status: 'failed',
      error: { code: 'PX_STORAGE_WRITE_FAILED_BEFORE_EFFECT', userMessage: '本地安全记录写入失败，请修复存储后重新提交。', recoverable: true },
    }
  }

  let backend: Awaited<ReturnType<typeof input.dispatch>>
  try {
    backend = await input.dispatch()
  } catch {
    return {
      ...baseResult(input.command),
      status: 'unknown_result',
      error: { code: 'PX_UNKNOWN_DISPATCH_RESULT', userMessage: '请求已发出但未取得可核对结果；请到 FAMS 手动复核，系统不会自动重试。', recoverable: false },
    }
  }
  const completed: LedgerRecord = {
    ...prepared,
    dispatchState: 'completed',
    ...(backend.resultRef ? { resultRef: backend.resultRef } : {}),
    resultStatus: backend.status,
    lastAccessedAt: new Date().toISOString(),
  }
  records = [...records.filter((record) => record.idempotencyKey !== prepared.idempotencyKey), completed]
  try {
    await persistAndVerify(input.storage, records, completed)
    return { ...baseResult(input.command), status: backend.status, ...(backend.resultRef ? { resultRef: backend.resultRef } : {}) }
  } catch {
    return {
      ...baseResult(input.command),
      status: 'unknown_result',
      ...(backend.resultRef ? { resultRef: backend.resultRef } : {}),
      error: { code: 'PX_RESULT_NOT_PERSISTED', userMessage: '结果已收到但未保存；刷新后请到 FAMS 手动复核。', recoverable: false },
    }
  }
}
