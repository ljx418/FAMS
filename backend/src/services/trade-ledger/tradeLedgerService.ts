import { createHash } from 'node:crypto'
import type { TradeIngestionBatch, TradeIngestionRow } from '@prisma/client'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'

export type PositionEffectPolicy = 'apply' | 'record_only' | 'not_applicable'

export interface TradeIngestionRowInput {
  rowIndex: number
  rowType: string
  normalized: Record<string, unknown>
  raw?: Record<string, unknown>
  sourceRef?: string
  dedupeKey?: string | null
  status?: 'staged' | 'new' | 'duplicate' | 'conflict' | 'blocked'
  conflict?: Record<string, unknown>
}

export interface StageTradeIngestionBatchInput {
  userId: string
  captureId?: string
  accountSource?: string | null
  sourceType: 'screenshot' | 'file_import' | 'host_structured' | 'manual'
  idempotencyKey: string
  positionEffectPolicy: PositionEffectPolicy
  coverageFrom?: Date | null
  coverageTo?: Date | null
  coverageKinds: string[]
  evidenceRefs?: string[]
  rows: TradeIngestionRowInput[]
}

export interface PersistTradeReconciliationInput {
  userId: string
  idempotencyKey?: string
  ingestionBatchId?: string | null
  dailyReviewRunId?: string | null
  accountSource?: string | null
  status: 'ready' | 'warning' | 'blocked'
  asOf: Date
  coverage: Record<string, unknown>
  summary: Record<string, unknown>
  differences: unknown[]
  inputRefs: Record<string, unknown>
  holdings: unknown
  transactions: unknown
  orders: unknown
}

type IngestionBatchWithRows = TradeIngestionBatch & { rows: TradeIngestionRow[] }

function canonicalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]))
  }
  return value
}

export function stableJson(value: unknown) {
  return JSON.stringify(canonicalize(value))
}

export function sha256(value: unknown) {
  return createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex')
}

function conflictError(message: string, code: string) {
  const error = new Error(message) as Error & { statusCode?: number; code?: string }
  error.statusCode = 409
  error.code = code
  return error
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

class TradeLedgerService {
  private batchInputHash(input: StageTradeIngestionBatchInput) {
    return sha256({
      userId: input.userId,
      captureId: input.captureId || null,
      accountSource: input.accountSource || null,
      sourceType: input.sourceType,
      positionEffectPolicy: input.positionEffectPolicy,
      coverageFrom: input.coverageFrom || null,
      coverageTo: input.coverageTo || null,
      coverageKinds: [...new Set(input.coverageKinds)].sort(),
      rows: input.rows.map((row) => ({
        rowIndex: row.rowIndex,
        rowType: row.rowType,
        normalized: row.normalized,
        raw: row.raw || {},
        sourceRef: row.sourceRef || null,
        dedupeKey: row.dedupeKey || null,
      })),
    })
  }

  async stageBatch(input: StageTradeIngestionBatchInput): Promise<{ batch: IngestionBatchWithRows; reused: boolean }> {
    await ensureUser(prisma, input.userId)
    if (!input.idempotencyKey.trim()) throw new Error('idempotencyKey is required')
    if (input.coverageFrom && input.coverageTo && input.coverageFrom > input.coverageTo) {
      throw new Error('coverageFrom must not be after coverageTo')
    }
    if (new Set(input.rows.map((row) => row.rowIndex)).size !== input.rows.length) {
      throw new Error('rowIndex must be unique within an ingestion batch')
    }
    const inputHash = this.batchInputHash(input)
    const where = { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } }
    const existing = await prisma.tradeIngestionBatch.findUnique({ where, include: { rows: { orderBy: { rowIndex: 'asc' } } } })
    if (existing) {
      if (existing.inputHash !== inputHash) {
        throw conflictError('The ingestion idempotency key was already used with different content', 'INGESTION_IDEMPOTENCY_CONFLICT')
      }
      return { batch: existing, reused: true }
    }

    const statusCounts = input.rows.reduce<Record<string, number>>((counts, row) => {
      const status = row.status || 'new'
      counts[status] = (counts[status] || 0) + 1
      return counts
    }, {})
    try {
      const batch = await prisma.tradeIngestionBatch.create({
        data: {
          userId: input.userId,
          captureId: input.captureId,
          accountSource: input.accountSource || null,
          sourceType: input.sourceType,
          idempotencyKey: input.idempotencyKey,
          inputHash,
          coverageFrom: input.coverageFrom || null,
          coverageTo: input.coverageTo || null,
          coverageKindsJson: stableJson([...new Set(input.coverageKinds)].sort()),
          positionEffectPolicy: input.positionEffectPolicy,
          status: input.rows.some((row) => row.status === 'conflict' || row.status === 'blocked') ? 'blocked' : 'preview_ready',
          countsJson: stableJson({ total: input.rows.length, ...statusCounts }),
          evidenceRefsJson: stableJson(input.evidenceRefs || []),
          rows: {
            create: input.rows.map((row) => ({
              rowIndex: row.rowIndex,
              rowHash: sha256({ rowType: row.rowType, normalized: row.normalized, raw: row.raw || {} }),
              sourceRef: row.sourceRef,
              rowType: row.rowType,
              normalizedJson: stableJson(row.normalized),
              rawJson: stableJson(row.raw || {}),
              status: row.status || 'new',
              dedupeKey: row.dedupeKey || null,
              conflictJson: stableJson(row.conflict || {}),
            })),
          },
        },
        include: { rows: { orderBy: { rowIndex: 'asc' } } },
      })
      return { batch, reused: false }
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
      const raced = await prisma.tradeIngestionBatch.findUnique({ where, include: { rows: { orderBy: { rowIndex: 'asc' } } } })
      if (!raced || raced.inputHash !== inputHash) {
        throw conflictError('Concurrent ingestion used the same idempotency key with different content', 'INGESTION_IDEMPOTENCY_CONFLICT')
      }
      return { batch: raced, reused: true }
    }
  }

  async stageScreenshotConfirmation(input: {
    userId: string
    capture: { id: string; accountSource: string | null; capturedAt: Date | null }
    rows: Array<{ id: string; rowIndex: number; rowType: string; fieldsJson: string; rawText: string; importKey: string | null }>
    positionEffectPolicy: PositionEffectPolicy
  }) {
    const selectionHash = sha256({
      captureId: input.capture.id,
      rowIds: input.rows.map((row) => row.id).sort(),
      positionEffectPolicy: input.positionEffectPolicy,
    })
    const dates = input.rows.flatMap((row) => {
      const fields = parseJson<Record<string, unknown>>(row.fieldsJson, {})
      const raw = fields.executedAt || fields.submittedAt || fields.asOfDate
      const date = raw ? new Date(String(raw)) : null
      return date && !Number.isNaN(date.getTime()) ? [date] : []
    })
    const coverageKinds = input.rows.map((row) => {
      if (row.rowType === 'trade') return 'trades'
      if (row.rowType === 'order' || row.rowType === 'pending_order') return 'orders'
      if (row.rowType === 'holding') return 'holdings'
      if (row.rowType === 'account_summary') return 'cash'
      return row.rowType
    })
    return this.stageBatch({
      userId: input.userId,
      captureId: input.capture.id,
      accountSource: input.capture.accountSource,
      sourceType: 'screenshot',
      idempotencyKey: `capture-confirm:${input.capture.id}:${selectionHash}`,
      positionEffectPolicy: input.positionEffectPolicy,
      coverageFrom: dates.length ? new Date(Math.min(...dates.map((date) => date.getTime()))) : input.capture.capturedAt,
      coverageTo: dates.length ? new Date(Math.max(...dates.map((date) => date.getTime()))) : input.capture.capturedAt,
      coverageKinds,
      evidenceRefs: [`screenshot_capture:${input.capture.id}`],
      rows: input.rows.map((row) => ({
        rowIndex: row.rowIndex,
        rowType: row.rowType,
        normalized: parseJson(row.fieldsJson, {}),
        raw: { rawText: row.rawText },
        sourceRef: row.id,
        dedupeKey: row.importKey,
        status: 'new',
      })),
    })
  }

  async confirmZeroAttestation(input: {
    userId: string
    accountSource?: string | null
    coverageKinds: string[]
    confirmedBy: string
    confirmedAt: Date
  }) {
    const coverageKinds = [...new Set(input.coverageKinds)].sort()
    if (coverageKinds.length === 0) return null
    if (!input.confirmedBy.trim()) throw new Error('confirmedBy is required for a zero attestation')
    if (Number.isNaN(input.confirmedAt.getTime())) throw new Error('confirmedAt must be a valid timestamp')
    const idempotencyKey = `zero-attestation:${sha256({
      userId: input.userId,
      accountSource: input.accountSource || null,
      coverageKinds,
      confirmedBy: input.confirmedBy.trim(),
      confirmedAt: input.confirmedAt,
    })}`
    const staged = await this.stageBatch({
      userId: input.userId,
      accountSource: input.accountSource || null,
      sourceType: 'manual',
      idempotencyKey,
      positionEffectPolicy: 'not_applicable',
      coverageFrom: input.confirmedAt,
      coverageTo: input.confirmedAt,
      coverageKinds,
      evidenceRefs: [`zero_attestation:${input.confirmedBy.trim()}:${input.confirmedAt.toISOString()}`],
      rows: coverageKinds.map((kind, rowIndex) => ({
        rowIndex,
        rowType: 'zero_attestation',
        normalized: { kind, count: 0, confirmedAt: input.confirmedAt, confirmedBy: input.confirmedBy.trim() },
        sourceRef: `zero:${kind}`,
        dedupeKey: `${idempotencyKey}:${kind}`,
        status: 'new',
      })),
    })
    if (staged.batch.status !== 'confirmed' && staged.batch.status !== 'reconciled') {
      await prisma.$transaction([
        prisma.tradeIngestionRow.updateMany({
          where: { batchId: staged.batch.id },
          data: { status: 'confirmed' },
        }),
        prisma.tradeIngestionBatch.update({
          where: { id: staged.batch.id },
          data: {
            status: 'confirmed',
            confirmedBy: input.confirmedBy.trim(),
            confirmedAt: input.confirmedAt,
            countsJson: stableJson({ total: coverageKinds.length, confirmed: coverageKinds.length, zeroAttestations: coverageKinds.length }),
          },
        }),
      ])
    }
    return this.getBatch(input.userId, staged.batch.id)
  }

  async persistReconciliation(input: PersistTradeReconciliationInput) {
    await ensureUser(prisma, input.userId)
    const holdingsHash = sha256(input.holdings)
    const transactionsHash = sha256(input.transactions)
    const ordersHash = sha256(input.orders)
    const inputHash = sha256({
      userId: input.userId,
      ingestionBatchId: input.ingestionBatchId || null,
      dailyReviewRunId: input.dailyReviewRunId || null,
      accountSource: input.accountSource || null,
      coverage: input.coverage,
      inputRefs: input.inputRefs,
      holdingsHash,
      transactionsHash,
      ordersHash,
    })
    const idempotencyKey = input.idempotencyKey?.trim() || `reconciliation:${inputHash}`
    const where = { userId_idempotencyKey: { userId: input.userId, idempotencyKey } }
    const existing = await prisma.tradeReconciliationRun.findUnique({ where })
    if (existing) {
      if (existing.inputHash !== inputHash) {
        throw conflictError('The reconciliation idempotency key was already used with different content', 'RECONCILIATION_IDEMPOTENCY_CONFLICT')
      }
      return { reconciliation: this.presentReconciliation(existing), reused: true }
    }
    try {
      const reconciliation = await prisma.tradeReconciliationRun.create({
        data: {
          userId: input.userId,
          idempotencyKey,
          ingestionBatchId: input.ingestionBatchId || null,
          dailyReviewRunId: input.dailyReviewRunId || null,
          accountSource: input.accountSource || null,
          status: input.status,
          asOf: input.asOf,
          inputHash,
          coverageJson: stableJson(input.coverage),
          summaryJson: stableJson(input.summary),
          differencesJson: stableJson(input.differences),
          inputRefsJson: stableJson(input.inputRefs),
          holdingsHash,
          transactionsHash,
          ordersHash,
        },
      })
      if (input.ingestionBatchId) {
        await prisma.tradeIngestionBatch.updateMany({
          where: { id: input.ingestionBatchId, userId: input.userId, status: 'confirmed' },
          data: { status: 'reconciled', reconciledAt: input.asOf },
        })
      }
      return { reconciliation: this.presentReconciliation(reconciliation), reused: false }
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
      const raced = await prisma.tradeReconciliationRun.findUnique({ where })
      if (!raced || raced.inputHash !== inputHash) {
        throw conflictError('Concurrent reconciliation used the same idempotency key with different content', 'RECONCILIATION_IDEMPOTENCY_CONFLICT')
      }
      return { reconciliation: this.presentReconciliation(raced), reused: true }
    }
  }

  async getReconciliation(userId: string, id: string) {
    const reconciliation = await prisma.tradeReconciliationRun.findFirst({ where: { id, userId } })
    if (!reconciliation) throw new Error('Trade reconciliation run not found')
    return this.presentReconciliation(reconciliation)
  }

  async listReconciliations(userId: string, limit = 50) {
    const reconciliations = await prisma.tradeReconciliationRun.findMany({
      where: { userId },
      orderBy: { asOf: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    })
    return reconciliations.map((item) => this.presentReconciliation(item))
  }

  async markBatchFailed(batchId: string, error: unknown) {
    return prisma.tradeIngestionBatch.update({
      where: { id: batchId },
      data: {
        status: 'failed',
        errorJson: stableJson({
          code: (error as { code?: string }).code || 'INGESTION_CONFIRMATION_FAILED',
          message: error instanceof Error ? error.message : String(error),
        }),
      },
    })
  }

  async getBatch(userId: string, id: string) {
    const batch = await prisma.tradeIngestionBatch.findFirst({
      where: { id, userId },
      include: { rows: { orderBy: { rowIndex: 'asc' } }, reconciliationRuns: { orderBy: { createdAt: 'desc' } } },
    })
    if (!batch) throw new Error('Trade ingestion batch not found')
    return this.presentBatch(batch)
  }

  async listBatches(userId: string, limit = 50) {
    const batches = await prisma.tradeIngestionBatch.findMany({
      where: { userId },
      include: { rows: { orderBy: { rowIndex: 'asc' } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    })
    return batches.map((batch) => this.presentBatch(batch))
  }

  presentBatch<T extends TradeIngestionBatch & { rows?: TradeIngestionRow[] }>(batch: T) {
    return {
      ...batch,
      coverageKinds: parseJson(batch.coverageKindsJson, []),
      counts: parseJson(batch.countsJson, {}),
      evidenceRefs: parseJson(batch.evidenceRefsJson, []),
      error: parseJson(batch.errorJson, {}),
      rows: batch.rows?.map((row) => ({
        ...row,
        normalized: parseJson(row.normalizedJson, {}),
        raw: parseJson(row.rawJson, {}),
        conflict: parseJson(row.conflictJson, {}),
      })),
    }
  }

  presentReconciliation<T extends {
    coverageJson: string
    summaryJson: string
    differencesJson: string
    inputRefsJson: string
  }>(reconciliation: T) {
    return {
      ...reconciliation,
      coverage: parseJson(reconciliation.coverageJson, {}),
      summary: parseJson(reconciliation.summaryJson, {}),
      differences: parseJson(reconciliation.differencesJson, []),
      inputRefs: parseJson(reconciliation.inputRefsJson, {}),
    }
  }
}

export const tradeLedgerService = new TradeLedgerService()
export type { IngestionBatchWithRows }
