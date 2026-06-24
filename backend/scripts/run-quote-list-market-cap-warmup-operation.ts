import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { prisma } from '../src/db/prisma.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

type CanonicalItem = {
  code: string
  name?: string
  industryName?: string
  totalMarketCap?: number
  floatMarketCap?: number
  source?: string
  fetchedAt?: string
  sourceProviders?: string[]
  sourceRefs?: string[]
  confidence?: string
  consensusScore?: number
  warnings?: string[]
}

type CanonicalFile = {
  schemaVersion: string
  generatedAt: string
  itemCount: number
  coverage?: Record<string, unknown>
  providerReports?: Array<Record<string, unknown>>
  items: CanonicalItem[]
}

type ProviderResult = {
  provider: string
  fetchedAt: string
  itemCount: number
  items: Array<{
    symbol: string
    floatMarketCap?: number
    latestTradeDate?: string
    sourceRefs?: string[]
    marketCapDerivation?: string
  }>
  warnings: string[]
}

const operationType = 'quote_list_market_cap_warmup'
const canonicalPath = resolve(process.cwd(), 'data/a-share-quote-list-canonical.json')

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function recomputeCoverage(items: CanonicalItem[]) {
  const covered = items.filter((item) => item.industryName && (item.totalMarketCap || item.floatMarketCap))
  const multiProviderCovered = covered.filter((item) => (item.sourceProviders || []).length >= 2)
  return {
    fullCoverageCount: covered.length,
    fullCoveragePercent: items.length > 0 ? Number(((covered.length / items.length) * 100).toFixed(2)) : 0,
    multiProviderFullCoverageCount: multiProviderCovered.length,
    multiProviderFullCoveragePercent: items.length > 0 ? Number(((multiProviderCovered.length / items.length) * 100).toFixed(2)) : 0,
  }
}

function refreshItemConfidence(item: CanonicalItem) {
  const hasMarketCap = Boolean(item.totalMarketCap || item.floatMarketCap)
  const providerCount = (item.sourceProviders || []).length
  if (item.industryName && hasMarketCap && providerCount >= 2) {
    item.confidence = 'medium'
    item.consensusScore = Math.max(item.consensusScore || 0, 80)
  } else if (item.industryName && hasMarketCap) {
    item.confidence = 'single_source'
    item.consensusScore = Math.max(item.consensusScore || 0, 60)
  } else {
    item.confidence = 'insufficient'
    item.consensusScore = 0
  }
}

function runBaoStockMarketCap(symbols: string[]): Promise<ProviderResult> {
  const script = resolve(process.cwd(), 'scripts/providers/a_share_quote_sources.py')
  return new Promise((resolvePromise) => {
    execFile('python3', [script, '--provider', 'baostock_market_cap', '--symbols', symbols.join(',')], { maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolvePromise({
          provider: 'baostock_market_cap',
          fetchedAt: new Date().toISOString(),
          itemCount: 0,
          items: [],
          warnings: [`baostock market cap chunk failed: ${stderr.trim() || error.message}`],
        })
        return
      }
      try {
        const parsed = JSON.parse(stdout.trim().split('\n').at(-1) || '{}') as { providers?: ProviderResult[] }
        resolvePromise(parsed.providers?.[0] || {
          provider: 'baostock_market_cap',
          fetchedAt: new Date().toISOString(),
          itemCount: 0,
          items: [],
          warnings: ['baostock market cap returned no provider result'],
        })
      } catch (parseError) {
        resolvePromise({
          provider: 'baostock_market_cap',
          fetchedAt: new Date().toISOString(),
          itemCount: 0,
          items: [],
          warnings: [`baostock market cap JSON parse failed: ${parseError instanceof Error ? parseError.message : String(parseError)}`],
        })
      }
    })
  })
}

async function setOperationProgress(operationId: string, data: {
  status?: string
  progressPct?: number
  progressCurrent?: number
  progressTotal?: number
  progressMessage?: string
  result?: unknown
  error?: unknown
  artifactRefs?: string[]
  completed?: boolean
}) {
  await prisma.operation.update({
    where: { id: operationId },
    data: {
      ...(data.status ? { status: data.status } : {}),
      ...(typeof data.progressPct === 'number' ? { progressPct: data.progressPct } : {}),
      ...(typeof data.progressCurrent === 'number' ? { progressCurrent: data.progressCurrent } : {}),
      ...(typeof data.progressTotal === 'number' ? { progressTotal: data.progressTotal } : {}),
      ...(data.progressMessage ? { progressMessage: data.progressMessage } : {}),
      ...(data.result !== undefined ? { resultJson: JSON.stringify(data.result) } : {}),
      ...(data.error !== undefined ? {
        errorJson: JSON.stringify(data.error),
        errorSummary: data.error instanceof Error ? data.error.message : String(data.error),
      } : {}),
      ...(data.artifactRefs ? { artifactRefsJson: JSON.stringify(data.artifactRefs) } : {}),
      ...(data.completed ? { completedAt: new Date(), leaseOwner: null, leaseToken: null, leaseExpiresAt: null } : {}),
      heartbeatAt: new Date(),
    },
  })
}

async function main() {
  requireDevDbMutationAcknowledgement('run-quote-list-market-cap-warmup-operation')

  const limit = parsePositiveInt(process.env.FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_LIMIT, 40)
  const chunkSize = parsePositiveInt(process.env.FAMS_QUOTE_LIST_MARKET_CAP_WARMUP_CHUNK_SIZE, 10)
  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } })
  if (!user) throw new Error('No user exists for operation ownership')

  const canonical = JSON.parse(await readFile(canonicalPath, 'utf8')) as CanonicalFile
  if (canonical.schemaVersion !== 'fams.a_share_quote_list_canonical.v1') {
    throw new Error(`Unexpected canonical schema version: ${canonical.schemaVersion}`)
  }
  const beforeCoverage = recomputeCoverage(canonical.items)
  const candidates = canonical.items
    .filter((item) => item.industryName && !item.floatMarketCap)
    .map((item) => item.code)
    .sort()
    .slice(0, limit)
  const chunks = chunk(candidates, chunkSize)
  const operationId = process.env.FAMS_OPERATION_ID || randomUUID()
  const now = new Date()

  await prisma.operation.upsert({
    where: { id: operationId },
    create: {
      id: operationId,
      userId: user.id,
      type: operationType,
      status: 'running',
      startedAt: now,
      progressPct: 0,
      progressCurrent: 0,
      progressTotal: candidates.length,
      progressMessage: `Preparing ${candidates.length} symbols`,
      createdBy: 'system',
      leaseOwner: `quote-list-market-cap-warmup:${process.pid}`,
      leaseToken: randomUUID(),
      leaseExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      heartbeatAt: now,
      inputJson: JSON.stringify({ limit, chunkSize, candidateCount: candidates.length }),
      resultJson: JSON.stringify({ beforeCoverage }),
    },
    update: {
      status: 'running',
      progressMessage: `Resuming ${candidates.length} symbols`,
      heartbeatAt: now,
    },
  })

  let completedSymbols = 0
  let successCount = 0
  let failureCount = 0
  const chunkReports: Array<Record<string, unknown>> = []
  const itemByCode = new Map(canonical.items.map((item) => [item.code, item]))

  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const symbols = chunks[chunkIndex]
    const idempotencyKey = `${operationType}:${operationId}:chunk:${chunkIndex}`
    const existingTask = await prisma.operationTask.findFirst({ where: { operationId, idempotencyKey } })
    if (existingTask?.status === 'completed') {
      completedSymbols += symbols.length
      successCount += existingTask.successCount
      failureCount += existingTask.failureCount
      continue
    }

    const latestOperation = await prisma.operation.findUnique({ where: { id: operationId } })
    if (latestOperation?.cancelRequested) {
      await setOperationProgress(operationId, {
        status: successCount > 0 ? 'partial' : 'cancelled',
        progressPct: 100,
        progressCurrent: completedSymbols,
        progressTotal: candidates.length,
        progressMessage: 'Cancelled before next chunk',
        completed: true,
      })
      break
    }

    const taskStartedAt = Date.now()
    await prisma.operationTask.upsert({
      where: { operationId_idempotencyKey: { operationId, idempotencyKey } },
      create: {
        operationId,
        name: 'quote_list.market_cap_warmup',
        taskType: 'quote_list.market_cap_warmup',
        chunkIndex,
        status: 'running',
        idempotencyKey,
        inputJson: JSON.stringify({ symbols }),
        provider: 'baostock_market_cap',
      },
      update: {
        status: 'running',
        startedAt: new Date(),
        provider: 'baostock_market_cap',
      },
    })

    const provider = await runBaoStockMarketCap(symbols)
    const returnedBySymbol = new Map(provider.items.map((item) => [item.symbol, item]))
    let chunkSuccess = 0
    let chunkFailure = 0
    for (const symbol of symbols) {
      const result = returnedBySymbol.get(symbol)
      const canonicalItem = itemByCode.get(symbol)
      if (result?.floatMarketCap && canonicalItem) {
        canonicalItem.floatMarketCap = result.floatMarketCap
        canonicalItem.fetchedAt = provider.fetchedAt
        canonicalItem.sourceProviders = Array.from(new Set([...(canonicalItem.sourceProviders || []), 'baostock_market_cap']))
        canonicalItem.sourceRefs = Array.from(new Set([...(canonicalItem.sourceRefs || []), ...(result.sourceRefs || [])]))
        canonicalItem.warnings = (canonicalItem.warnings || []).filter((warning) => warning !== '缺少市值来源')
        refreshItemConfidence(canonicalItem)
        chunkSuccess += 1
      } else {
        chunkFailure += 1
      }
    }

    const afterChunkCoverage = recomputeCoverage(canonical.items)
    canonical.generatedAt = new Date().toISOString()
    canonical.coverage = afterChunkCoverage
    canonical.providerReports = [
      ...(canonical.providerReports || []),
      {
        provider: 'baostock_market_cap_warmup',
        itemCount: provider.itemCount,
        chunkIndex,
        warnings: provider.warnings || [],
      },
    ]
    await writeFile(canonicalPath, JSON.stringify(canonical, null, 2))

    completedSymbols += symbols.length
    successCount += chunkSuccess
    failureCount += chunkFailure
    const chunkReport = {
      chunkIndex,
      symbols,
      successCount: chunkSuccess,
      failureCount: chunkFailure,
      elapsedMs: Date.now() - taskStartedAt,
      warnings: provider.warnings || [],
      coverage: afterChunkCoverage,
    }
    chunkReports.push(chunkReport)

    await prisma.operationTask.update({
      where: { operationId_idempotencyKey: { operationId, idempotencyKey } },
      data: {
        status: chunkFailure > 0 ? 'partial' : 'completed',
        completedAt: new Date(),
        durationMs: Date.now() - taskStartedAt,
        successCount: chunkSuccess,
        failureCount: chunkFailure,
        warningsJson: JSON.stringify(provider.warnings || []),
        metricsJson: JSON.stringify({ coverage: afterChunkCoverage }),
        outputJson: JSON.stringify(chunkReport),
      },
    })

    await setOperationProgress(operationId, {
      progressPct: candidates.length > 0 ? Math.min(95, Math.round((completedSymbols / candidates.length) * 90)) : 100,
      progressCurrent: completedSymbols,
      progressTotal: candidates.length,
      progressMessage: `Market cap warmup ${completedSymbols}/${candidates.length}`,
      result: {
        beforeCoverage,
        currentCoverage: afterChunkCoverage,
        successCount,
        failureCount,
        chunkReports,
      },
    })
  }

  const finalCoverage = recomputeCoverage(canonical.items)
  const artifacts = {
    'quote_list_market_cap_warmup_report.json': {
      beforeCoverage,
      finalCoverage,
      requestedSymbols: candidates.length,
      successCount,
      failureCount,
      chunkSize,
      chunkReports,
    },
  }
  const artifactRefs = Object.keys(artifacts).map((filename) => `operation_artifact:${operationId}:${filename}`)
  const partialSuccess = failureCount > 0
  await setOperationProgress(operationId, {
    status: partialSuccess ? 'partial' : 'completed',
    progressPct: 100,
    progressCurrent: candidates.length,
    progressTotal: candidates.length,
    progressMessage: partialSuccess ? 'Market cap warmup completed with warnings' : 'Market cap warmup completed',
    result: {
      beforeCoverage,
      finalCoverage,
      requestedSymbols: candidates.length,
      successCount,
      failureCount,
      artifacts,
      artifactRefs,
    },
    artifactRefs,
    completed: true,
  })

  console.log(JSON.stringify({
    ok: true,
    operationId,
    requestedSymbols: candidates.length,
    successCount,
    failureCount,
    beforeCoverage,
    finalCoverage,
    artifactRefs,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
