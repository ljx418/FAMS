import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import { assetIdentityResolver } from '../asset/assetIdentityResolver.js'
import { transactionService } from '../transaction/transactionService.js'

const MAX_BYTES = 10 * 1024 * 1024
const CAPTURE_ROOT = resolve(
  process.env.FAMS_CAPTURE_STORAGE_DIR
    || dirname(fileURLToPath(import.meta.url)),
  process.env.FAMS_CAPTURE_STORAGE_DIR ? '.' : '../../../data/private-captures',
)

const rowSchema = z.object({
  rowType: z.enum(['account_summary', 'holding', 'trade', 'order']),
  rawText: z.string().optional().default(''),
  fields: z.record(z.unknown()),
  fieldConfidence: z.record(z.number().min(0).max(1)).optional().default({}),
  confidence: z.number().min(0).max(1),
}).strict()

const editableRowSchema = z.object({
  rowType: z.enum(['account_summary', 'holding', 'trade', 'order']).optional(),
  rawText: z.string().optional(),
  fields: z.record(z.unknown()).optional(),
  fieldConfidence: z.record(z.number().min(0).max(1)).optional(),
  confidence: z.number().min(0).max(1).optional(),
  ignored: z.boolean().optional(),
  correctedBy: z.string().trim().min(1),
}).strict()

export type CaptureExtractionRow = z.infer<typeof rowSchema>

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function asPositive(value: unknown, allowZero = false) {
  const number = Number(value)
  return Number.isFinite(number) && (allowZero ? number >= 0 : number > 0) ? number : null
}

function asDate(value: unknown) {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date
}

function asFinite(value: unknown) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function decimalPlaces(value: unknown) {
  const text = String(value)
  if (/e-/i.test(text)) return Number(text.split(/e-/i)[1]) || 0
  return text.includes('.') ? text.split('.')[1].length : 0
}

function rounded(value: number, precision: number) {
  const factor = 10 ** precision
  return Math.round((value + Number.EPSILON) * factor) / factor
}

function resolveScreenshotCost(existingCost: number | null | undefined, screenshotCost: number) {
  const displayPrecision = decimalPlaces(screenshotCost)
  const preserveExistingPrecision = Number.isFinite(existingCost)
    && rounded(Number(existingCost), displayPrecision) === rounded(screenshotCost, displayPrecision)
  return {
    resolvedCost: preserveExistingPrecision ? Number(existingCost) : screenshotCost,
    displayedCost: screenshotCost,
    displayPrecision,
    preserveExistingPrecision,
  }
}

function detectMime(buffer: Buffer) {
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  if (
    buffer.length >= 32
    && buffer.subarray(0, 8).equals(pngSignature)
    && buffer.subarray(12, 16).toString('ascii') === 'IHDR'
    && buffer.includes(Buffer.from('IEND'), Math.max(8, buffer.length - 24))
  ) return 'image/png'
  if (
    buffer.length >= 8
    && buffer[0] === 0xff
    && buffer[1] === 0xd8
    && buffer[2] === 0xff
    && buffer[buffer.length - 2] === 0xff
    && buffer[buffer.length - 1] === 0xd9
  ) return 'image/jpeg'
  if (
    buffer.length >= 20
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    && buffer.readUInt32LE(4) + 8 <= buffer.length
  ) return 'image/webp'
  return null
}

function extensionFor(mime: string) {
  return mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg'
}

class ScreenshotCaptureService {
  async upload(input: {
    userId: string
    buffer: Buffer
    mimeType?: string
    originalFilename?: string
    conversationId?: string
    capturedAt?: Date
  }) {
    await ensureUser(prisma, input.userId)
    if (!input.buffer.length || input.buffer.length > MAX_BYTES) throw new Error('Screenshot must be between 1 byte and 10MB')
    const detectedMime = detectMime(input.buffer)
    if (!detectedMime) throw new Error('Only real PNG, JPEG, and WebP screenshot files are accepted')
    if (input.mimeType && input.mimeType !== 'application/octet-stream' && input.mimeType !== detectedMime) {
      throw new Error(`Declared MIME type ${input.mimeType} does not match file content ${detectedMime}`)
    }
    const sha256 = createHash('sha256').update(input.buffer).digest('hex')
    const existing = await prisma.screenshotCapture.findUnique({ where: { userId_sha256: { userId: input.userId, sha256 } } })
    if (existing) return { capture: existing, reused: true }
    const userDir = resolve(CAPTURE_ROOT, input.userId.replace(/[^a-zA-Z0-9_-]/g, '_'))
    await mkdir(userDir, { recursive: true, mode: 0o700 })
    const storagePath = resolve(userDir, `${sha256}${extensionFor(detectedMime)}`)
    await writeFile(storagePath, input.buffer, { mode: 0o600 })
    const capture = await prisma.screenshotCapture.create({
      data: {
        userId: input.userId,
        conversationId: input.conversationId,
        mimeType: detectedMime,
        originalFilename: input.originalFilename,
        storagePath,
        sha256,
        sizeBytes: input.buffer.length,
        capturedAt: input.capturedAt,
        status: 'uploaded',
      },
    })
    return { capture, reused: false }
  }

  async uploadBase64(input: {
    userId: string
    base64: string
    mimeType?: string
    originalFilename?: string
    conversationId?: string
    capturedAt?: Date
  }) {
    const body = input.base64.replace(/^data:[^;]+;base64,/, '')
    return this.upload({ ...input, buffer: Buffer.from(body, 'base64') })
  }

  private validateRow(row: CaptureExtractionRow) {
    const fields = row.fields as Record<string, unknown>
    const issues: string[] = []
    if (row.rowType !== 'account_summary' && !String(fields.symbol || '').trim()) issues.push('symbol_missing')
    if (row.rowType === 'account_summary') {
      if (asPositive(fields.availableCash, true) === null) issues.push('available_cash_invalid')
      for (const key of ['cashBalance', 'withdrawableCash', 'stockMarketValue', 'totalAssets', 'holdingPnl', 'dayPnl', 'dayPnlPct']) {
        if (fields[key] !== undefined && asFinite(fields[key]) === null) issues.push(`${key}_invalid`)
      }
    }
    if (row.rowType === 'holding') {
      if (asPositive(fields.quantity) === null) issues.push('quantity_invalid')
      if (asPositive(fields.avgCost) === null) issues.push('avg_cost_invalid')
    }
    if (row.rowType === 'trade') {
      if (!['buy', 'sell', 'dividend', 'fee', 'deposit', 'withdraw'].includes(String(fields.type || fields.side || '').toLowerCase())) issues.push('trade_type_invalid')
      if (asPositive(fields.quantity) === null) issues.push('quantity_invalid')
      if (asPositive(fields.price) === null) issues.push('price_invalid')
    }
    if (row.rowType === 'order') {
      if (!['buy', 'sell'].includes(String(fields.side || '').toLowerCase())) issues.push('order_side_invalid')
      if (asPositive(fields.quantity) === null) issues.push('quantity_invalid')
    }
    if (row.confidence < 0.85) issues.push('confidence_below_0.85')
    return issues
  }

  async applyExtraction(input: {
    captureId: string
    userId?: string
    documentType: 'holding' | 'trade' | 'order' | 'mixed'
    rows: unknown[]
    rawText?: string
    visionProvider?: string
    consentGranted?: boolean
  }) {
    const capture = await prisma.screenshotCapture.findUnique({ where: { id: input.captureId } })
    if (!capture) throw new Error('Screenshot capture not found')
    if (input.userId && capture.userId !== input.userId) throw new Error('Screenshot capture does not belong to the requested user')
    if (capture.status === 'confirmed' || capture.status === 'partially_confirmed') throw new Error('A capture with confirmed rows cannot be re-extracted')
    const parsed = z.array(rowSchema).max(500).parse(input.rows)
    const existingPositions = await prisma.position.findMany({
      where: { userId: capture.userId, status: 'open' },
      include: { asset: true },
    })
    const prepared = []
    const seenHoldingSymbols = new Set<string>()
    let accountSummaryCount = 0
    for (let rowIndex = 0; rowIndex < parsed.length; rowIndex += 1) {
      const row = parsed[rowIndex]
      const fields = row.fields as Record<string, unknown>
      const symbol = String(fields.symbol || '').trim().toUpperCase()
      const identity = symbol ? await assetIdentityResolver.resolve(symbol) : null
      const matchedAsset = identity?.matchedAsset || null
      const issues = this.validateRow(row)
      if (row.rowType === 'account_summary') {
        accountSummaryCount += 1
        if (accountSummaryCount > 1) issues.push('duplicate_account_summary_in_capture')
      }
      if (row.rowType === 'holding' && symbol) {
        if (seenHoldingSymbols.has(symbol)) issues.push('duplicate_holding_symbol_in_capture')
        seenHoldingSymbols.add(symbol)
      }
      if (row.rowType !== 'account_summary' && !matchedAsset) issues.push('asset_not_matched_locally')
      const currentPosition = matchedAsset
        ? existingPositions.find((position) => position.assetId === matchedAsset.id)
        : null
      const importKey = `${capture.sha256}:${rowIndex}:${row.rowType}`
      const costResolution = row.rowType === 'holding' && currentPosition && asPositive(fields.avgCost) !== null
        ? resolveScreenshotCost(currentPosition.avgCost, asPositive(fields.avgCost)!)
        : null
      const diff = row.rowType === 'account_summary'
        ? { type: 'update_account_summary_and_cash', before: null, after: fields }
        : row.rowType === 'holding'
        ? {
            type: currentPosition ? 'update_position' : 'create_position',
            before: currentPosition ? {
              quantity: currentPosition.quantity,
              avgCost: currentPosition.avgCost,
              currentPrice: currentPosition.currentPrice,
              marketValue: currentPosition.marketValue,
            } : null,
            after: fields,
            costResolution,
          }
        : { type: row.rowType === 'trade' ? 'create_transaction' : 'observe_external_order', before: null, after: fields }
      prepared.push({ rowIndex, row, matchedAsset, identity, issues, diff, importKey })
    }
    const shownHoldingAssetIds = new Set(prepared.filter((item) => item.row.rowType === 'holding' && item.matchedAsset).map((item) => item.matchedAsset!.id))
    if (prepared.some((item) => item.row.rowType === 'account_summary')) {
      for (const position of existingPositions.filter((item) => item.asset.type === 'cash')) shownHoldingAssetIds.add(position.assetId)
    }
    const missingHoldings = existingPositions
      .filter((position) => !shownHoldingAssetIds.has(position.assetId))
      .map((position) => ({
        positionId: position.id,
        assetId: position.assetId,
        symbol: position.asset.symbol,
        name: position.asset.name,
        action: 'no_change',
        warning: '截图中未出现；仅提示差异，绝不自动减仓或平仓。',
      }))
    await prisma.$transaction([
      prisma.screenshotCaptureRow.deleteMany({ where: { captureId: capture.id, status: { not: 'confirmed' } } }),
      ...prepared.map((item) => prisma.screenshotCaptureRow.create({
        data: {
          captureId: capture.id,
          assetId: item.matchedAsset?.id || null,
          rowType: item.row.rowType,
          rowIndex: item.rowIndex,
          rawText: item.row.rawText,
          fieldsJson: JSON.stringify(item.row.fields),
          confidenceJson: JSON.stringify(item.row.fieldConfidence),
          confidence: item.row.confidence,
          status: item.issues.length === 0 ? 'ready' : 'blocked',
          diffJson: JSON.stringify({
            ...item.diff,
            issues: item.issues,
            identity: item.identity,
            original: {
              rowType: item.row.rowType,
              rawText: item.row.rawText,
              fields: item.row.fields,
              fieldConfidence: item.row.fieldConfidence,
              confidence: item.row.confidence,
            },
            corrections: [],
          }),
          importKey: item.importKey,
        },
      })),
      prisma.screenshotCapture.update({
        where: { id: capture.id },
        data: {
          documentType: input.documentType,
          status: prepared.some((item) => item.issues.length > 0) ? 'needs_review' : 'preview_ready',
          rawText: input.rawText || '',
          extractionJson: JSON.stringify({ rowCount: prepared.length, missingHoldings }),
          warningsJson: JSON.stringify([
            ...(missingHoldings.length > 0 ? ['截图未覆盖全部现有持仓；未覆盖持仓不会被修改。'] : []),
            ...(prepared.some((item) => item.issues.length > 0) ? ['存在低置信度、缺字段或未匹配资产的行，需要修正后确认。'] : []),
          ]),
          visionProvider: input.visionProvider,
          processingConsentAt: input.consentGranted ? new Date() : capture.processingConsentAt,
        },
      }),
    ])
    return this.getPreview(capture.id, capture.userId)
  }

  async updateRow(input: {
    captureId: string
    rowId: string
    userId?: string
    update: unknown
  }) {
    const update = editableRowSchema.parse(input.update)
    const row = await prisma.screenshotCaptureRow.findUnique({
      where: { id: input.rowId },
      include: { capture: true },
    })
    if (!row || row.captureId !== input.captureId) throw new Error('Screenshot capture row not found')
    if (input.userId && row.capture.userId !== input.userId) throw new Error('Screenshot capture does not belong to the requested user')
    if (row.status === 'confirmed') throw new Error('Confirmed screenshot rows are immutable')

    const previousFields = parseJson<Record<string, unknown>>(row.fieldsJson, {})
    const previousConfidence = parseJson<Record<string, number>>(row.confidenceJson, {})
    const previousDiff = parseJson<Record<string, any>>(row.diffJson, {})
    const corrections = Array.isArray(previousDiff.corrections) ? previousDiff.corrections : []
    const nextRowType = update.rowType || row.rowType as CaptureExtractionRow['rowType']
    const nextFields = update.fields || previousFields
    const nextRawText = update.rawText ?? row.rawText
    const nextFieldConfidence = update.fieldConfidence || previousConfidence
    const nextConfidence = update.confidence ?? row.confidence
    const auditEntry = {
      correctedAt: new Date().toISOString(),
      correctedBy: update.correctedBy,
      before: { rowType: row.rowType, rawText: row.rawText, fields: previousFields, fieldConfidence: previousConfidence, confidence: row.confidence, status: row.status },
      after: { rowType: nextRowType, rawText: nextRawText, fields: nextFields, fieldConfidence: nextFieldConfidence, confidence: nextConfidence, ignored: update.ignored === true },
    }

    if (update.ignored === true) {
      await prisma.screenshotCaptureRow.update({
        where: { id: row.id },
        data: {
          status: 'ignored',
          diffJson: JSON.stringify({ ...previousDiff, issues: [], corrections: [...corrections, auditEntry] }),
        },
      })
      await this.refreshCapturePreviewState(row.captureId, row.capture.userId)
      return this.getPreview(row.captureId, row.capture.userId)
    }

    const candidate = rowSchema.parse({
      rowType: nextRowType,
      rawText: nextRawText,
      fields: nextFields,
      fieldConfidence: nextFieldConfidence,
      confidence: nextConfidence,
    })
    const symbol = String(candidate.fields.symbol || '').trim().toUpperCase()
    const identity = symbol ? await assetIdentityResolver.resolve(symbol) : null
    const matchedAsset = identity?.matchedAsset || null
    const issues = this.validateRow(candidate)
    if (candidate.rowType !== 'account_summary' && !matchedAsset) issues.push('asset_not_matched_locally')
    if (candidate.rowType === 'account_summary') {
      const siblings = await prisma.screenshotCaptureRow.count({
        where: { captureId: row.captureId, id: { not: row.id }, rowType: 'account_summary', status: { not: 'ignored' } },
      })
      if (siblings > 0) issues.push('duplicate_account_summary_in_capture')
    }
    if (candidate.rowType === 'holding' && symbol) {
      const siblings = await prisma.screenshotCaptureRow.findMany({
        where: { captureId: row.captureId, id: { not: row.id }, rowType: 'holding', status: { not: 'ignored' } },
        select: { fieldsJson: true },
      })
      if (siblings.some((sibling) => String(parseJson<Record<string, unknown>>(sibling.fieldsJson, {}).symbol || '').trim().toUpperCase() === symbol)) {
        issues.push('duplicate_holding_symbol_in_capture')
      }
    }
    const currentPosition = matchedAsset && candidate.rowType === 'holding'
      ? await prisma.position.findFirst({ where: { userId: row.capture.userId, assetId: matchedAsset.id, status: 'open' } })
      : null
    const costResolution = candidate.rowType === 'holding' && currentPosition && asPositive(candidate.fields.avgCost) !== null
      ? resolveScreenshotCost(currentPosition.avgCost, asPositive(candidate.fields.avgCost)!)
      : null
    const diff = candidate.rowType === 'account_summary'
      ? { type: 'update_account_summary_and_cash', before: null, after: candidate.fields }
      : candidate.rowType === 'holding'
      ? {
          type: currentPosition ? 'update_position' : 'create_position',
          before: currentPosition ? {
            quantity: currentPosition.quantity,
            avgCost: currentPosition.avgCost,
            currentPrice: currentPosition.currentPrice,
            marketValue: currentPosition.marketValue,
          } : null,
          after: candidate.fields,
          costResolution,
        }
      : { type: candidate.rowType === 'trade' ? 'create_transaction' : 'observe_external_order', before: null, after: candidate.fields }

    await prisma.screenshotCaptureRow.update({
      where: { id: row.id },
      data: {
        assetId: matchedAsset?.id || null,
        rowType: candidate.rowType,
        rawText: candidate.rawText,
        fieldsJson: JSON.stringify(candidate.fields),
        confidenceJson: JSON.stringify(candidate.fieldConfidence),
        confidence: candidate.confidence,
        status: issues.length === 0 ? 'ready' : 'blocked',
        diffJson: JSON.stringify({
          ...diff,
          issues,
          identity,
          original: previousDiff.original || auditEntry.before,
          corrections: [...corrections, auditEntry],
        }),
      },
    })
    await this.refreshCapturePreviewState(row.captureId, row.capture.userId)
    return this.getPreview(row.captureId, row.capture.userId)
  }

  private async refreshCapturePreviewState(captureId: string, userId: string) {
    const [capture, rows, positions] = await Promise.all([
      prisma.screenshotCapture.findUnique({ where: { id: captureId } }),
      prisma.screenshotCaptureRow.findMany({ where: { captureId }, orderBy: { rowIndex: 'asc' } }),
      prisma.position.findMany({ where: { userId, status: 'open' }, include: { asset: true } }),
    ])
    if (!capture) throw new Error('Screenshot capture not found')
    const shownHoldingAssetIds = new Set(rows
      .filter((row) => row.rowType === 'holding' && row.status !== 'ignored' && row.assetId)
      .map((row) => row.assetId!))
    if (rows.some((row) => row.rowType === 'account_summary' && row.status !== 'ignored')) {
      for (const position of positions.filter((item) => item.asset.type === 'cash')) shownHoldingAssetIds.add(position.assetId)
    }
    const missingHoldings = positions
      .filter((position) => !shownHoldingAssetIds.has(position.assetId))
      .map((position) => ({
        positionId: position.id,
        assetId: position.assetId,
        symbol: position.asset.symbol,
        name: position.asset.name,
        action: 'no_change',
        warning: '截图中未出现；仅提示差异，绝不自动减仓或平仓。',
      }))
    const hasBlocked = rows.some((row) => row.status === 'blocked')
    const extraction = parseJson<Record<string, unknown>>(capture.extractionJson, {})
    await prisma.screenshotCapture.update({
      where: { id: captureId },
      data: {
        status: hasBlocked ? 'needs_review' : 'preview_ready',
        extractionJson: JSON.stringify({ ...extraction, rowCount: rows.length, missingHoldings }),
        warningsJson: JSON.stringify([
          ...(missingHoldings.length > 0 ? ['截图未覆盖全部现有持仓；未覆盖持仓不会被修改。'] : []),
          ...(hasBlocked ? ['存在低置信度、缺字段、重复标的或未匹配资产的行，需要修正后确认。'] : []),
        ]),
      },
    })
  }

  async getPreview(captureId: string, expectedUserId?: string) {
    const capture = await prisma.screenshotCapture.findUnique({
      where: { id: captureId },
      include: { rows: { include: { asset: true }, orderBy: { rowIndex: 'asc' } } },
    })
    if (!capture) throw new Error('Screenshot capture not found')
    if (expectedUserId && capture.userId !== expectedUserId) throw new Error('Screenshot capture does not belong to the requested user')
    const visibleRows = capture.rows.filter((row) => row.status !== 'ignored')
    const accountRow = visibleRows.find((row) => row.rowType === 'account_summary')
    const accountFields = accountRow ? parseJson<Record<string, unknown>>(accountRow.fieldsJson, {}) : null
    const rowMarketValueSum = visibleRows
      .filter((row) => row.rowType === 'holding')
      .reduce((sum, row) => {
        const fields = parseJson<Record<string, unknown>>(row.fieldsJson, {})
        const explicit = asPositive(fields.marketValue, true)
        const quantity = asPositive(fields.quantity, true)
        const currentPrice = asPositive(fields.currentPrice)
        return sum + (explicit ?? (quantity !== null && currentPrice !== null ? quantity * currentPrice : 0))
      }, 0)
    const brokerStockMarketValue = asFinite(accountFields?.stockMarketValue)
    const availableCash = asPositive(accountFields?.availableCash, true)
    const brokerTotalAssets = asFinite(accountFields?.totalAssets)
    const calculatedTotalAssets = availableCash === null ? null : rowMarketValueSum + availableCash
    const accountReconciliation = accountFields ? {
      status: brokerStockMarketValue === null
        ? 'unavailable'
        : Math.abs(brokerStockMarketValue - rowMarketValueSum) <= 0.01 ? 'exact' : 'warning',
      accountSummary: accountFields,
      rowMarketValueSum: Number(rowMarketValueSum.toFixed(2)),
      brokerStockMarketValue,
      stockMarketValueVariance: brokerStockMarketValue === null ? null : Number((brokerStockMarketValue - rowMarketValueSum).toFixed(2)),
      availableCash,
      calculatedTotalAssets: calculatedTotalAssets === null ? null : Number(calculatedTotalAssets.toFixed(2)),
      brokerTotalAssets,
      totalAssetsVariance: brokerTotalAssets === null || calculatedTotalAssets === null
        ? null
        : Number((brokerTotalAssets - calculatedTotalAssets).toFixed(2)),
      ledgerBasis: 'holding_rows_plus_available_cash',
    } : null
    return {
      schemaVersion: 'fams.screenshot-capture-preview.v1',
      capture: {
        ...capture,
        storagePath: undefined,
        extraction: parseJson(capture.extractionJson, {}),
        warnings: parseJson(capture.warningsJson, []),
      },
      rows: capture.rows.map((row) => ({
        ...row,
        fields: parseJson(row.fieldsJson, {}),
        fieldConfidence: parseJson(row.confidenceJson, {}),
        diff: parseJson(row.diffJson, {}),
      })),
      confirmationBoundary: {
        humanConfirmationRequired: true,
        missingHoldingsWillNeverBeClosed: true,
        createsBrokerOrder: false,
      },
      accountReconciliation,
    }
  }

  async confirm(input: { captureId: string; userId?: string; rowIds?: string[]; confirmed: boolean; confirmedBy: string }) {
    if (input.confirmed !== true || !input.confirmedBy?.trim()) throw new Error('Explicit human confirmation and confirmedBy are required')
    const capture = await prisma.screenshotCapture.findUnique({
      where: { id: input.captureId },
      include: { rows: { orderBy: { rowIndex: 'asc' } } },
    })
    if (!capture) throw new Error('Screenshot capture not found')
    if (input.userId && capture.userId !== input.userId) throw new Error('Screenshot capture does not belong to the requested user')
    const selected = capture.rows.filter((row) => !input.rowIds || input.rowIds.includes(row.id))
    if (selected.length === 0) throw new Error('No screenshot rows selected')
    const blocked = selected.filter((row) => row.status !== 'ready' && row.status !== 'confirmed')
    if (blocked.length > 0) throw new Error(`Blocked rows cannot be confirmed: ${blocked.map((row) => row.rowIndex).join(', ')}`)
    const results: Array<Record<string, unknown>> = []
    for (const row of selected) {
      if (row.status === 'confirmed') {
        results.push({ rowId: row.id, status: 'already_confirmed' })
        continue
      }
      const fields = parseJson<Record<string, unknown>>(row.fieldsJson, {})
      if (row.rowType === 'account_summary') {
        const availableCash = asPositive(fields.availableCash, true)
        if (availableCash === null) throw new Error(`Row ${row.rowIndex} does not have a valid availableCash`)
        const existing = await prisma.position.findFirst({
          where: { userId: capture.userId, status: 'open', asset: { type: 'cash' } },
          include: { asset: true },
        })
        const cashAsset = existing?.asset || await prisma.asset.findFirst({ where: { type: 'cash' } })
        if (!cashAsset) throw new Error('Cash asset is required before confirming account summary')
        const position = existing
          ? await prisma.position.update({
              where: { id: existing.id },
              data: { quantity: availableCash, avgCost: 1, currentPrice: 1, marketValue: availableCash, costBasis: availableCash, unrealizedPnl: 0, source: 'screenshot_confirmed' },
            })
          : await prisma.position.create({
              data: {
                userId: capture.userId,
                assetId: cashAsset.id,
                openKey: `${capture.userId}:${cashAsset.id}`,
                quantity: availableCash,
                avgCost: 1,
                currentPrice: 1,
                marketValue: availableCash,
                costBasis: availableCash,
                unrealizedPnl: 0,
                source: 'screenshot_confirmed',
              },
            })
        await prisma.positionSnapshot.create({
          data: {
            userId: capture.userId,
            positionId: position.id,
            assetId: cashAsset.id,
            sourceCaptureId: capture.id,
            quantity: availableCash,
            avgCost: 1,
            currentPrice: 1,
            marketValue: availableCash,
            costBasis: availableCash,
          },
        })
        results.push({ rowId: row.id, status: 'confirmed', entity: 'cash_position', entityId: position.id, availableCash })
      } else if (!row.assetId) {
        throw new Error(`Row ${row.rowIndex} does not have a matched asset`)
      }
      const assetId = row.assetId
      if (row.rowType === 'holding') {
        const quantity = asPositive(fields.quantity, true)!
        const screenshotCost = asPositive(fields.avgCost)!
        const currentPrice = asPositive(fields.currentPrice) || screenshotCost
        const marketValue = asPositive(fields.marketValue, true) ?? quantity * currentPrice
        const existing = await prisma.position.findFirst({ where: { userId: capture.userId, assetId: assetId!, status: 'open' } })
        const costResolution = resolveScreenshotCost(existing?.avgCost, screenshotCost)
        const avgCost = costResolution.resolvedCost
        const costBasis = quantity * avgCost
        const position = existing
          ? await prisma.position.update({
              where: { id: existing.id },
              data: { quantity, avgCost, currentPrice, marketValue, costBasis, unrealizedPnl: marketValue - costBasis, source: 'screenshot_confirmed' },
            })
          : await prisma.position.create({
              data: {
                userId: capture.userId,
                assetId: assetId!,
                openKey: `${capture.userId}:${assetId}`,
                quantity,
                avgCost,
                currentPrice,
                marketValue,
                costBasis,
                unrealizedPnl: marketValue - costBasis,
                source: 'screenshot_confirmed',
              },
            })
        await prisma.positionSnapshot.create({
          data: {
            userId: capture.userId,
            positionId: position.id,
            assetId: assetId!,
            sourceCaptureId: capture.id,
            quantity,
            avgCost,
            currentPrice,
            marketValue,
            costBasis,
          },
        })
        results.push({ rowId: row.id, status: 'confirmed', entity: 'position', entityId: position.id, costResolution })
      } else if (row.rowType === 'trade') {
        const existing = row.importKey ? await prisma.transaction.findUnique({ where: { sourceImportKey: row.importKey } }) : null
        const transaction = existing || await transactionService.createTransaction({
          userId: capture.userId,
          assetId: assetId!,
          type: String(fields.type || fields.side).toLowerCase() as any,
          quantity: asPositive(fields.quantity)!,
          price: asPositive(fields.price)!,
          fee: asPositive(fields.fee, true) || 0,
          broker: fields.broker ? String(fields.broker) : undefined,
          confirmationNo: fields.confirmationNo ? String(fields.confirmationNo) : undefined,
          executedAt: asDate(fields.executedAt) || capture.capturedAt || new Date(),
          notes: `由截图 ${capture.id} 经人工确认导入`,
          source: 'screenshot_confirmed',
          sourceImportKey: row.importKey || undefined,
          sourceCaptureRowId: row.id,
        })
        results.push({ rowId: row.id, status: existing ? 'already_confirmed' : 'confirmed', entity: 'transaction', entityId: transaction.id })
      } else if (row.rowType === 'order') {
        const order = await prisma.externalOrderObservation.upsert({
          where: { captureRowId: row.id },
          create: {
            userId: capture.userId,
            assetId: assetId!,
            captureRowId: row.id,
            side: String(fields.side).toLowerCase(),
            status: String(fields.status || 'open').toLowerCase(),
            quantity: asPositive(fields.quantity)!,
            filledQuantity: asPositive(fields.filledQuantity, true) || 0,
            limitPrice: asPositive(fields.limitPrice),
            submittedAt: asDate(fields.submittedAt),
            externalOrderId: fields.externalOrderId ? String(fields.externalOrderId) : null,
            validUntil: asDate(fields.validUntil),
            rawJson: JSON.stringify(fields),
          },
          update: {
            status: String(fields.status || 'open').toLowerCase(),
            filledQuantity: asPositive(fields.filledQuantity, true) || 0,
            observedAt: new Date(),
            rawJson: JSON.stringify(fields),
          },
        })
        results.push({ rowId: row.id, status: 'confirmed', entity: 'external_order_observation', entityId: order.id })
      }
      await prisma.screenshotCaptureRow.update({ where: { id: row.id }, data: { status: 'confirmed', confirmedAt: new Date() } })
    }
    const remaining = await prisma.screenshotCaptureRow.count({ where: { captureId: capture.id, status: { notIn: ['confirmed', 'ignored'] } } })
    await prisma.screenshotCapture.update({
      where: { id: capture.id },
      data: {
        status: remaining === 0 ? 'confirmed' : 'partially_confirmed',
        confirmedAt: new Date(),
        confirmedBy: input.confirmedBy,
      },
    })
    return {
      schemaVersion: 'fams.screenshot-capture-confirmation.v1',
      captureId: capture.id,
      results,
      remainingRows: remaining,
      missingHoldingsClosed: 0,
      createsBrokerOrder: false,
    }
  }

  async readPrivateImage(captureId: string) {
    const capture = await prisma.screenshotCapture.findUnique({ where: { id: captureId } })
    if (!capture) throw new Error('Screenshot capture not found')
    return { capture, buffer: await readFile(capture.storagePath) }
  }
}

export const screenshotCaptureService = new ScreenshotCaptureService()
