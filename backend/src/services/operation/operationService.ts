import { prisma } from '../../db/prisma.js'
import { marketDataService } from '../market-data/marketDataService.js'
import { analysisService } from '../analysis/analysisService.js'
import { backtestService } from '../backtest/backtestService.js'
import { alertService } from '../alert/alertService.js'
import { stockScreenerService, type ScreenerOperationTaskUpdate } from '../screener/stockScreenerService.js'
import { marketBarCacheService, type MarketBarCacheStats } from '../market-data/marketBarCacheService.js'
import { marketFeatureDailyService } from '../market-data/marketFeatureDailyService.js'
import { ensureUser } from '../../utils/user.js'
import { positionAdviceService } from '../position/positionAdviceService.js'
import { stockAnalysisService } from '../technical/stockAnalysisService.js'
import { dividendLowVolStrategyService } from '../dividend-low-vol/dividendLowVolStrategyService.js'
import { dividendLowVolInputBuilderService } from '../dividend-low-vol/dividendLowVolInputBuilderService.js'
import { dividendLowVolUniverseService } from '../dividend-low-vol/dividendLowVolUniverseService.js'
import { dividendLowVolDataReadinessService } from '../dividend-low-vol/dividendLowVolDataReadinessService.js'
import { randomUUID } from 'crypto'
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const OPERATION_LEASE_MS = 5 * 60 * 1000
const OPERATION_WORKER_ID = `fams-api:${process.pid}:${Math.random().toString(36).slice(2, 10)}`
const QUOTE_LIST_MARKET_CAP_UNAVAILABLE_WARNING = 'BaoStock 派生流通市值缺失'

type OperationStatus = 'queued' | 'running' | 'completed' | 'succeeded' | 'failed' | 'cancelling' | 'cancelled' | 'partial'
type OperationType = 'refresh_prices' | 'check_alerts' | 'generate_daily_advice' | 'run_backtest' | 'generate_backtest_report' | 'stock_screener_full_scan' | 'strategy_tournament_run' | 'batch_factset_refresh' | 'quote_list_market_cap_warmup' | 'market_bar_cache_preheat' | 'fivd_r_portfolio_refresh' | 'dividend_low_vol_daily_scan'

interface OperationAction {
  type: string
  label: string
  href?: string
  method?: 'GET' | 'POST'
  endpoint?: string
  body?: Record<string, unknown>
}

interface RefreshPricesInput {
  userId: string
  assetIds?: string[]
  symbols?: string[]
  parentOperationId?: string
}

interface CheckAlertsInput {
  userId: string
  refreshPrices?: boolean
  parentOperationId?: string
}

interface GenerateDailyAdviceInput {
  userId: string
  query?: string
  scope?: 'all' | 'asset' | 'sector'
  parentOperationId?: string
}

interface RunBacktestInput {
  userId: string
  adviceId: string
  startDate?: string
  endDate?: string
  initialCapital?: number
  parentOperationId?: string
}

interface StockScreenerFullScanInput {
  userId: string
  query?: string
  mode?: 'default' | 'long_sample_dry_run' | 'long_sample_full'
  confirmedFullScan?: boolean
  parentOperationId?: string
  executionMode?: 'inline' | 'queued'
}

interface StrategyTournamentRunInput {
  userId: string
  query?: string
  maxScan?: number
  backtestDays?: number
  holdingDays?: number
  chunkSize?: number
  confirmedFullScan?: boolean
  parentOperationId?: string
  executionMode?: 'inline' | 'queued'
}

interface BatchFactsetRefreshInput {
  userId: string
  scope?: 'all' | 'position_advice' | 'stock_factset'
  symbols?: string[]
  limit?: number
  parentOperationId?: string
  createdBy?: string
  idempotencyKey?: string
}

interface QuoteListMarketCapWarmupInput {
  userId: string
  limit?: number
  chunkSize?: number
  parentOperationId?: string
  executionMode?: 'inline' | 'queued'
  createdBy?: string
  idempotencyKey?: string
}

interface MarketBarCachePreheatInput {
  userId: string
  symbols?: string[]
  limit?: number
  days?: number
  chunkSize?: number
  concurrency?: number
  forceRefresh?: boolean
  parentOperationId?: string
  executionMode?: 'inline' | 'queued'
  createdBy?: string
  idempotencyKey?: string
}

interface DividendLowVolDailyScanInput {
  userId: string
  symbols?: string[]
  limit?: number
  universe?: 'provided_symbols' | 'all_a'
  parentOperationId?: string
  executionMode?: 'inline' | 'queued'
  createdBy?: string
  idempotencyKey?: string
}

type QuoteListCanonicalItem = {
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

type QuoteListCanonicalFile = {
  schemaVersion: string
  generatedAt: string
  itemCount: number
  coverage?: Record<string, unknown>
  providerReports?: Array<Record<string, unknown>>
  items: QuoteListCanonicalItem[]
}

type QuoteListProviderResult = {
  provider: string
  fetchedAt: string
  itemCount: number
  items: Array<{
    symbol: string
    floatMarketCap?: number
    sourceRefs?: string[]
  }>
  warnings: string[]
}

interface DueFactsetRefreshInput {
  userId: string
  scope?: 'all' | 'position_advice' | 'stock_factset'
  horizonMinutes?: number
  limit?: number
  submit?: boolean
  force?: boolean
}

class OperationService {
  private parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  private uniqueArtifactRefs(refs: unknown): string[] {
    if (!Array.isArray(refs)) {
      return []
    }

    return Array.from(new Set(refs.filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)))
  }

  private buildNextActions(operation: {
    id: string
    userId: string
    type: string
    status: string
    resultJson: string
    artifactRefsJson: string
  }): OperationAction[] {
    if (!['completed', 'succeeded', 'partial'].includes(operation.status)) {
      return []
    }

    const result = this.parseJson<Record<string, any>>(operation.resultJson, {})
    const artifactRefs = this.parseJson<string[]>(operation.artifactRefsJson, [])

    switch (operation.type as OperationType) {
      case 'refresh_prices':
        return [
          { type: 'open_positions', label: '查看仓位', href: '/positions' },
          {
            type: 'check_alerts',
            label: '检查告警',
            method: 'POST',
            endpoint: '/api/v1/operations/check-alerts',
            body: { userId: operation.userId, refreshPrices: false },
          },
        ]
      case 'check_alerts':
        return [{ type: 'open_alerts', label: '查看告警', href: '/alerts' }]
      case 'generate_daily_advice':
        return [
          ...(result.adviceId ? [{
            type: 'open_advice',
            label: '查看建议',
            href: `/operations?operationId=${operation.id}&focus=operation-advice-snapshot-card`,
          }] : []),
          ...(result.adviceId ? [{
            type: 'run_backtest',
            label: '运行建议回测',
            method: 'POST' as const,
            endpoint: '/api/v1/operations/run-backtest',
            body: {
              userId: operation.userId,
              adviceId: result.adviceId,
              parentOperationId: operation.id,
            },
          }] : []),
        ]
      case 'run_backtest':
        return [
          ...(result.backtestId ? [{ type: 'open_backtest', label: '查看回测', href: `/backtest?backtestId=${result.backtestId}` }] : []),
        ]
      case 'stock_screener_full_scan':
        return artifactRefs.length > 0 ? [{ type: 'open_operation', label: '查看选股产物', href: `/operations?operationId=${operation.id}` }] : []
      case 'strategy_tournament_run':
        return artifactRefs.length > 0 ? [{ type: 'open_operation', label: '查看策略证据产物', href: `/operations?operationId=${operation.id}` }] : []
      case 'batch_factset_refresh':
        return [{ type: 'open_analysis', label: '查看持仓研究', href: '/analysis?section=holdings' }]
      case 'quote_list_market_cap_warmup':
        return artifactRefs.length > 0 ? [{ type: 'open_operation', label: '查看市值补齐产物', href: `/operations?operationId=${operation.id}` }] : []
      case 'fivd_r_portfolio_refresh':
        return [
          { type: 'open_analysis', label: '查看 FIVD-R', href: '/analysis?section=fivdr' },
          ...(artifactRefs.length > 0 ? [{ type: 'open_operation', label: '查看 FIVD-R 产物', href: `/operations?operationId=${operation.id}` }] : []),
        ]
      case 'dividend_low_vol_daily_scan':
        return [
          { type: 'open_analysis', label: '查看红利低波策略', href: '/dividend-low-vol' },
          ...(artifactRefs.length > 0 ? [{ type: 'open_operation', label: '查看红利低波产物', href: `/operations?operationId=${operation.id}` }] : []),
        ]
      default:
        return artifactRefs.length > 0 ? [{ type: 'open_operation', label: '查看任务产物', href: `/operations?operationId=${operation.id}` }] : []
    }
  }

  private toOperationDto(operation: {
    id: string
    userId: string
    parentOperationId: string | null
    type: string
    status: string
    requestedAt: Date
    startedAt: Date | null
    completedAt: Date | null
    progressPct: number
    progressCurrent?: number | null
    progressTotal?: number | null
    progressMessage?: string | null
    cancelRequested?: boolean
    createdBy: string
    inputJson: string
    resultJson: string
    errorJson: string
    errorSummary?: string | null
    recoveryJson?: string
    leaseOwner?: string | null
    leaseToken?: string | null
    leaseExpiresAt?: Date | null
    heartbeatAt?: Date | null
    artifactRefsJson: string
    tasks?: Array<{
      id: string
      operationId: string
      name: string
      taskType?: string | null
      chunkIndex: number | null
      status: string
      attempt?: number
      maxAttempts?: number
      idempotencyKey?: string | null
      inputJson?: string
      outputJson?: string
      startedAt: Date | null
      completedAt: Date | null
      durationMs: number | null
      successCount: number
      failureCount: number
      provider: string | null
      cacheHitRate: number | null
      warningsJson: string
      metricsJson: string
      errorJson: string
      createdAt: Date
      updatedAt: Date
    }>
  }) {
    return {
      id: operation.id,
      operationId: operation.id,
      operation_id: operation.id,
      userId: operation.userId,
      parentOperationId: operation.parentOperationId,
      type: operation.type,
      status: operation.status,
      requestedAt: operation.requestedAt,
      startedAt: operation.startedAt,
      completedAt: operation.completedAt,
      progressPct: operation.progressPct,
      progressCurrent: operation.progressCurrent ?? null,
      progressTotal: operation.progressTotal ?? null,
      progressMessage: operation.progressMessage ?? null,
      cancelRequested: operation.cancelRequested ?? false,
      createdBy: operation.createdBy,
      input: this.parseJson(operation.inputJson, {}),
      result: this.parseJson(operation.resultJson, {}),
      error: this.parseJson(operation.errorJson, {}),
      errorSummary: operation.errorSummary || null,
      recovery: this.parseJson(operation.recoveryJson || '{}', {}),
      leaseOwner: operation.leaseOwner ?? null,
      leaseToken: operation.leaseToken ?? null,
      leaseExpiresAt: operation.leaseExpiresAt ?? null,
      heartbeatAt: operation.heartbeatAt ?? null,
      artifactRefs: this.parseJson<string[]>(operation.artifactRefsJson, []),
      tasks: (operation.tasks || []).map((task) => ({
        ...task,
        warnings: this.parseJson<string[]>(task.warningsJson, []),
        metrics: this.parseJson<Record<string, unknown>>(task.metricsJson, {}),
        error: this.parseJson<Record<string, unknown>>(task.errorJson, {}),
        input: this.parseJson<Record<string, unknown>>((task as any).inputJson || '{}', {}),
        output: this.parseJson<Record<string, unknown>>((task as any).outputJson || '{}', {}),
      })),
      nextActions: this.buildNextActions(operation),
    }
  }

  async getArtifact(ref: string) {
    const separatorIndex = ref.indexOf(':')
    if (separatorIndex <= 0 || separatorIndex === ref.length - 1) {
      throw new Error('Invalid artifact ref')
    }

    const type = ref.slice(0, separatorIndex)
    const id = ref.slice(separatorIndex + 1)

    switch (type) {
      case 'advice': {
        const advice = await prisma.advice.findUnique({
          where: { id },
          include: {
            adviceInputSnapshot: true,
            actions: { include: { asset: true }, orderBy: { createdAt: 'asc' } },
          },
        })
        if (!advice) throw new Error('Artifact not found')

        return {
          ref,
          type,
          id,
          title: `建议 ${advice.id}`,
          createdAt: advice.createdAt,
          data: {
            userId: advice.userId,
            generatedAt: advice.generatedAt,
            status: advice.status,
            riskLevel: advice.riskLevel,
            summaryText: advice.summaryText,
            disclaimerText: advice.disclaimerText,
            adviceInputSnapshotId: advice.adviceInputSnapshotId,
            recommendation: this.parseJson(advice.recommendationJson, {}),
            actions: advice.actions.map((action) => ({
              id: action.id,
              assetId: action.assetId,
              symbol: action.asset?.symbol,
              name: action.asset?.name,
              actionType: action.actionType,
              suggestedQuantity: action.suggestedQuantity,
              suggestedAmount: action.suggestedAmount,
              suggestedPrice: action.suggestedPrice,
              confidence: action.confidence,
              reason: action.reason,
              status: action.status,
            })),
          },
        }
      }
      case 'advice_input_snapshot': {
        const snapshot = await prisma.adviceInputSnapshot.findUnique({ where: { id } })
        if (!snapshot) throw new Error('Artifact not found')

        return {
          ref,
          type,
          id,
          title: `建议输入快照 ${snapshot.id}`,
          createdAt: snapshot.createdAt,
          data: {
            userId: snapshot.userId,
            capturedAt: snapshot.capturedAt,
            promptVersion: snapshot.promptVersion,
            portfolioSnapshot: this.parseJson(snapshot.portfolioSnapshotJson, {}),
            positionSnapshot: this.parseJson(snapshot.positionSnapshotJson, []),
            marketSnapshot: this.parseJson(snapshot.marketSnapshotJson, []),
            constraints: this.parseJson(snapshot.constraintsJson, {}),
          },
        }
      }
      case 'position_snapshot': {
        const snapshot = await prisma.positionSnapshot.findUnique({
          where: { id },
          include: { asset: true },
        })
        if (!snapshot) throw new Error('Artifact not found')

        return {
          ref,
          type,
          id,
          title: `持仓快照 ${snapshot.asset.symbol}`,
          createdAt: snapshot.createdAt,
          data: {
            userId: snapshot.userId,
            capturedAt: snapshot.capturedAt,
            positionId: snapshot.positionId,
            assetId: snapshot.assetId,
            symbol: snapshot.asset.symbol,
            name: snapshot.asset.name,
            assetType: snapshot.asset.type,
            quantity: snapshot.quantity,
            avgCost: snapshot.avgCost,
            currentPrice: snapshot.currentPrice,
            marketValue: snapshot.marketValue,
            costBasis: snapshot.costBasis,
            actualWeightPct: snapshot.actualWeightPct,
            costWeightPct: snapshot.costWeightPct,
          },
        }
      }
      case 'market_snapshot': {
        const snapshot = await prisma.marketSnapshot.findUnique({
          where: { id },
          include: { asset: true },
        })
        if (!snapshot) throw new Error('Artifact not found')

        return {
          ref,
          type,
          id,
          title: `行情快照 ${snapshot.asset.symbol}`,
          createdAt: snapshot.createdAt,
          data: {
            capturedAt: snapshot.capturedAt,
            assetId: snapshot.assetId,
            symbol: snapshot.asset.symbol,
            name: snapshot.asset.name,
            assetType: snapshot.asset.type,
            price: snapshot.price,
            currency: snapshot.currency,
            source: snapshot.source,
            confidenceScore: snapshot.confidenceScore,
            dayChangePct: snapshot.dayChangePct,
            valuation: this.parseJson(snapshot.valuationJson, {}),
            technical: this.parseJson(snapshot.technicalJson, {}),
          },
        }
      }
      case 'operation': {
        return {
          ref,
          type,
          id,
          title: `任务 ${id}`,
          data: await this.getOperation(id),
        }
      }
      case 'operation_artifact': {
        const [operationId, ...filenameParts] = id.split(':')
        const filename = filenameParts.join(':')
        if (!operationId || !filename) throw new Error('Invalid operation artifact ref')
        const operation = await prisma.operation.findUnique({ where: { id: operationId } })
        if (!operation) throw new Error('Artifact not found')
        const result = this.parseJson<Record<string, any>>(operation.resultJson, {})
        const artifacts = result.artifacts && typeof result.artifacts === 'object' ? result.artifacts as Record<string, unknown> : {}
        if (!(filename in artifacts)) throw new Error('Artifact not found')
        return {
          ref,
          type,
          id,
          title: filename,
          createdAt: operation.completedAt || operation.requestedAt,
          data: artifacts[filename],
        }
      }
      case 'alert': {
        const alert = await prisma.alert.findUnique({ where: { id } })
        if (!alert) throw new Error('Artifact not found')

        return {
          ref,
          type,
          id,
          title: `告警 ${alert.assetSymbol || alert.title}`,
          createdAt: alert.createdAt,
          data: alert,
        }
      }
      default:
        throw new Error(`Unsupported artifact type: ${type}`)
    }
  }

  private getLeaseExpiry(now = new Date()) {
    return new Date(now.getTime() + OPERATION_LEASE_MS)
  }

  private createLeaseToken() {
    return randomUUID()
  }

  private async markOperationRunning(
    operationId: string,
    progressPct: number,
    options: { allowResume?: boolean; recovery?: Record<string, unknown> } = {}
  ) {
    const now = new Date()
    const leaseToken = this.createLeaseToken()
    const result = await prisma.operation.updateMany({
      where: {
        id: operationId,
        cancelRequested: false,
        ...(options.allowResume
          ? {
              status: { in: ['queued', 'running'] },
              OR: [
                { status: 'queued' },
                { leaseExpiresAt: null },
                { leaseExpiresAt: { lt: now } },
                { leaseOwner: OPERATION_WORKER_ID },
              ],
            }
          : { status: 'queued' }),
      },
      data: {
        status: 'running',
        startedAt: now,
        progressPct,
        progressCurrent: progressPct,
        progressTotal: 100,
        progressMessage: options.allowResume ? '任务恢复执行中' : '任务执行中',
        cancelRequested: false,
        leaseOwner: OPERATION_WORKER_ID,
        leaseExpiresAt: this.getLeaseExpiry(now),
        heartbeatAt: now,
        ...(options.recovery ? { recoveryJson: JSON.stringify(options.recovery) } : {}),
        leaseToken,
      },
    })

    return result.count > 0 ? leaseToken : null
  }

  private async completeOperation(
    operationId: string,
    leaseToken: string,
    data: {
      result?: unknown
      artifactRefs?: string[]
    } = {}
  ) {
    const resultRecord = data.result as { partialSuccess?: boolean } | undefined
    await prisma.operation.updateMany({
      where: {
        id: operationId,
        status: { notIn: ['cancelled', 'cancelling'] },
        leaseOwner: OPERATION_WORKER_ID,
        leaseToken,
      },
      data: {
        status: resultRecord?.partialSuccess ? 'partial' : 'completed',
        completedAt: new Date(),
        progressPct: 100,
        progressCurrent: 100,
        progressTotal: 100,
        progressMessage: resultRecord?.partialSuccess ? '任务部分成功，存在失败或警告明细' : '任务已完成',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: new Date(),
        ...(data.result !== undefined ? { resultJson: JSON.stringify(data.result) } : {}),
        ...(data.artifactRefs ? { artifactRefsJson: JSON.stringify(data.artifactRefs) } : {}),
      },
    })
  }

  private async failOperation(operationId: string, leaseToken: string, error: unknown) {
    await prisma.operation.updateMany({
      where: {
        id: operationId,
        status: { notIn: ['cancelled', 'cancelling'] },
        leaseOwner: OPERATION_WORKER_ID,
        leaseToken,
      },
      data: {
        status: 'failed',
        completedAt: new Date(),
        progressPct: 100,
        progressCurrent: 100,
        progressTotal: 100,
        progressMessage: '任务失败',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: new Date(),
        errorSummary: error instanceof Error ? error.message : 'Unknown operation error',
        errorJson: JSON.stringify({
          message: error instanceof Error ? error.message : 'Unknown operation error',
        }),
      },
    })
  }

  private async cancelOwnedOperation(operationId: string, leaseToken: string, error: unknown = new Error('Operation cancelled')) {
    await prisma.operation.updateMany({
      where: {
        id: operationId,
        status: { in: ['running', 'cancelling'] },
        leaseOwner: OPERATION_WORKER_ID,
        leaseToken,
      },
      data: {
        status: 'cancelled',
        cancelRequested: true,
        completedAt: new Date(),
        progressPct: 100,
        progressCurrent: 100,
        progressTotal: 100,
        progressMessage: '任务已取消',
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        heartbeatAt: new Date(),
        errorSummary: error instanceof Error ? error.message : 'Operation cancelled',
        errorJson: JSON.stringify(this.serializeError(error)),
      },
    })
    await prisma.operationTask.updateMany({
      where: { operationId, status: { in: ['queued', 'running'] } },
      data: {
        status: 'cancelled',
        completedAt: new Date(),
        errorJson: JSON.stringify(this.serializeError(error)),
      },
    })
  }

  private async updateOperationProgress(operationId: string, leaseToken: string, progressPct: number, partialResult?: Record<string, unknown>) {
    const operation = await prisma.operation.findUnique({ where: { id: operationId } })
    if (!operation || operation.status === 'cancelled' || operation.status === 'cancelling') return
    if (operation.leaseOwner !== OPERATION_WORKER_ID || operation.leaseToken !== leaseToken) return
    const currentResult = this.parseJson<Record<string, unknown>>(operation.resultJson, {})
    await prisma.operation.updateMany({
      where: {
        id: operationId,
        status: { notIn: ['cancelled', 'cancelling'] },
        leaseOwner: OPERATION_WORKER_ID,
        leaseToken,
      },
      data: {
        progressPct,
        progressCurrent: typeof partialResult?.progressCurrent === 'number' ? partialResult.progressCurrent as number : progressPct,
        progressTotal: typeof partialResult?.progressTotal === 'number' ? partialResult.progressTotal as number : 100,
        progressMessage: typeof partialResult?.progressMessage === 'string' ? partialResult.progressMessage as string : operation.progressMessage,
        leaseOwner: OPERATION_WORKER_ID,
        leaseToken,
        leaseExpiresAt: this.getLeaseExpiry(),
        heartbeatAt: new Date(),
        ...(partialResult ? { resultJson: JSON.stringify({ ...currentResult, ...partialResult }) } : {}),
      },
    })
  }

  private serializeError(error: unknown) {
    if (!error) return {}
    return {
      message: error instanceof Error ? error.message : String(error),
    }
  }

  private isUniqueConstraintError(error: unknown) {
    return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002'
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error(message)), timeoutMs)),
    ])
  }

  private quoteListCanonicalPath() {
    return resolve(process.cwd(), 'data/a-share-quote-list-canonical.json')
  }

  private quoteListCoverage(items: QuoteListCanonicalItem[]) {
    const covered = items.filter((item) => item.industryName && (item.totalMarketCap || item.floatMarketCap))
    const multiProviderCovered = covered.filter((item) => (item.sourceProviders || []).length >= 2)
    return {
      fullCoverageCount: covered.length,
      fullCoveragePercent: items.length > 0 ? Number(((covered.length / items.length) * 100).toFixed(2)) : 0,
      multiProviderFullCoverageCount: multiProviderCovered.length,
      multiProviderFullCoveragePercent: items.length > 0 ? Number(((multiProviderCovered.length / items.length) * 100).toFixed(2)) : 0,
    }
  }

  private refreshQuoteListItemConfidence(item: QuoteListCanonicalItem) {
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

  private async runBaoStockMarketCapProvider(symbols: string[]): Promise<QuoteListProviderResult> {
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
          const parsed = JSON.parse(stdout.trim().split('\n').at(-1) || '{}') as { providers?: QuoteListProviderResult[] }
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

  private async recordQuoteListProviderHealth(input: {
    provider: string
    endpoint: string
    successCount: number
    failureCount: number
    elapsedMs: number
    warnings: string[]
    symbolCount: number
  }) {
    const now = new Date()
    const hasFailure = input.failureCount > 0
    const errorMessage = input.warnings.slice(0, 3).join('; ')
    const existing = await prisma.providerHealth.findUnique({ where: { provider: input.provider } })
    const consecutiveFailures = hasFailure
      ? (existing?.consecutiveFailures || 0) + 1
      : 0
    const openCircuit = consecutiveFailures >= 5
    const cooldownUntil = openCircuit ? new Date(Date.now() + Math.min(15 * 60_000, 2 ** Math.min(consecutiveFailures, 8) * 1000)) : null
    const metrics = {
      endpoint: input.endpoint,
      lastChunk: {
        symbolCount: input.symbolCount,
        successCount: input.successCount,
        failureCount: input.failureCount,
        elapsedMs: input.elapsedMs,
        warnings: input.warnings,
      },
    }

    await prisma.providerHealth.upsert({
      where: { provider: input.provider },
      create: {
        provider: input.provider,
        endpoint: input.endpoint,
        status: openCircuit ? 'open_circuit' : hasFailure ? 'degraded' : 'healthy',
        circuitState: openCircuit ? 'open' : 'closed',
        cooldownUntil,
        windowStart: now,
        windowEnd: now,
        requestCount: 1,
        successCount: input.successCount,
        failureCount: input.failureCount,
        badDataCount: input.failureCount,
        avgLatencyMs: input.elapsedMs,
        p95LatencyMs: input.elapsedMs,
        consecutiveFailures,
        circuitOpenedAt: openCircuit ? now : null,
        nextRetryAt: cooldownUntil,
        rateLimitPerMinute: Number(process.env.FAMS_PROVIDER_RATE_LIMIT_PER_MINUTE || 120),
        lastSuccessAt: input.successCount > 0 ? now : null,
        lastFailureAt: hasFailure ? now : null,
        lastError: hasFailure ? errorMessage || 'quote-list market cap warmup failed' : null,
        metricsJson: JSON.stringify(metrics),
      },
      update: {
        endpoint: input.endpoint,
        status: openCircuit ? 'open_circuit' : hasFailure ? 'degraded' : 'healthy',
        circuitState: openCircuit ? 'open' : 'closed',
        cooldownUntil,
        windowEnd: now,
        requestCount: { increment: 1 },
        successCount: { increment: input.successCount },
        failureCount: { increment: input.failureCount },
        badDataCount: input.failureCount > 0 ? { increment: input.failureCount } : undefined,
        avgLatencyMs: input.elapsedMs,
        p95LatencyMs: input.elapsedMs,
        consecutiveFailures,
        circuitOpenedAt: openCircuit ? now : existing?.circuitOpenedAt || null,
        nextRetryAt: cooldownUntil,
        lastSuccessAt: input.successCount > 0 ? now : existing?.lastSuccessAt || null,
        lastFailureAt: hasFailure ? now : existing?.lastFailureAt || null,
        lastError: hasFailure ? errorMessage || 'quote-list market cap warmup failed' : null,
        metricsJson: JSON.stringify(metrics),
      },
    })
  }

  private async updateOperationTask(operationId: string, leaseToken: string, update: ScreenerOperationTaskUpdate) {
    const lease = await prisma.operation.updateMany({
      where: {
        id: operationId,
        status: { notIn: ['cancelled', 'cancelling'] },
        leaseOwner: OPERATION_WORKER_ID,
        leaseToken,
      },
      data: {
        heartbeatAt: new Date(),
        leaseExpiresAt: this.getLeaseExpiry(),
      },
    })
    if (lease.count === 0) {
      return
    }

    const existing = await prisma.operationTask.findFirst({
      where: {
        operationId,
        name: update.name,
        chunkIndex: update.chunkIndex ?? null,
      },
    })
    const now = new Date()
    const startedAt = update.status === 'running' ? (existing?.startedAt || now) : existing?.startedAt || null
    const completedAt = ['completed', 'failed', 'cancelled', 'partial'].includes(update.status) ? now : existing?.completedAt || null
    const durationMs = startedAt && completedAt ? Math.max(0, completedAt.getTime() - startedAt.getTime()) : existing?.durationMs || null
    const data = {
      status: update.status,
      startedAt,
      completedAt,
      durationMs,
      successCount: update.successCount ?? existing?.successCount ?? 0,
      failureCount: update.failureCount ?? existing?.failureCount ?? 0,
      provider: update.provider ?? existing?.provider ?? null,
      cacheHitRate: update.cacheHitRate ?? existing?.cacheHitRate ?? null,
      taskType: update.taskType || update.name,
      idempotencyKey: update.idempotencyKey || `${operationId}:${update.name}:${update.chunkIndex ?? 'main'}`,
      inputJson: update.input !== undefined
        ? JSON.stringify(update.input)
        : existing?.inputJson || JSON.stringify({ name: update.name, chunkIndex: update.chunkIndex ?? null }),
      outputJson: update.output !== undefined ? JSON.stringify(update.output) : existing?.outputJson || JSON.stringify({
        successCount: update.successCount ?? existing?.successCount ?? 0,
        failureCount: update.failureCount ?? existing?.failureCount ?? 0,
        provider: update.provider ?? existing?.provider ?? null,
        cacheHitRate: update.cacheHitRate ?? existing?.cacheHitRate ?? null,
      }),
      warningsJson: JSON.stringify(update.warnings || (existing ? this.parseJson(existing.warningsJson, []) : [])),
      metricsJson: JSON.stringify(update.metrics || (existing ? this.parseJson(existing.metricsJson, {}) : {})),
      errorJson: JSON.stringify(update.error ? this.serializeError(update.error) : existing ? this.parseJson(existing.errorJson, {}) : {}),
    }
    if (existing) {
      await prisma.operationTask.update({ where: { id: existing.id }, data })
      return
    }
    await prisma.operationTask.create({
      data: {
        operationId,
        name: update.name,
        chunkIndex: update.chunkIndex ?? null,
        ...data,
      },
    })
  }

  private async isOperationCancelled(operationId: string, leaseToken?: string) {
    const operation = await prisma.operation.findUnique({
      where: { id: operationId },
      select: { status: true, cancelRequested: true, leaseOwner: true, leaseToken: true },
    })
    if (!operation) return true
    if (leaseToken && (operation.leaseOwner !== OPERATION_WORKER_ID || operation.leaseToken !== leaseToken)) return true
    return operation.cancelRequested === true || operation.status === 'cancelled' || operation.status === 'cancelling'
  }

  async getOperation(id: string) {
    const operation = await prisma.operation.findUnique({
      where: { id },
      include: { tasks: { orderBy: [{ createdAt: 'asc' }, { chunkIndex: 'asc' }] } },
    })

    if (!operation) {
      throw new Error('Operation not found')
    }

    return this.toOperationDto(operation)
  }

  private async executeRefreshPricesOperation(operationId: string, input: RefreshPricesInput) {
    const leaseToken = await this.markOperationRunning(operationId, 10)
    if (!leaseToken) return

    try {
      const result = await marketDataService.refreshAssetMarketData({
        assetIds: input.assetIds,
        symbols: input.symbols,
        userId: input.userId,
      })
      let enrichedResult: Record<string, unknown> = result

      try {
        const alertedSymbols = await alertService.runAutoRiskCheck(input.userId, { refreshPrices: false })
        enrichedResult = {
          ...result,
          alertCheck: {
            alertedSymbols,
          },
        }
      } catch (error) {
        enrichedResult = {
          ...result,
          alertCheck: {
            alertedSymbols: [],
            error: error instanceof Error ? error.message : 'Unknown alert check error',
          },
        }
      }

      await this.completeOperation(operationId, leaseToken, {
        result: enrichedResult,
        artifactRefs: Array.isArray((enrichedResult as { artifactRefs?: string[] }).artifactRefs) ? (enrichedResult as { artifactRefs?: string[] }).artifactRefs : [],
      })
    } catch (error) {
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  private async executeCheckAlertsOperation(operationId: string, input: CheckAlertsInput) {
    const leaseToken = await this.markOperationRunning(operationId, 20)
    if (!leaseToken) return

    try {
      const alertedSymbols = await alertService.runAutoRiskCheck(input.userId, {
        refreshPrices: input.refreshPrices !== false,
      })
      await this.completeOperation(operationId, leaseToken, {
        result: {
          alertedSymbols,
          alertCount: alertedSymbols.length,
          refreshPrices: input.refreshPrices !== false,
        },
        artifactRefs: alertedSymbols.map((symbol) => `alert:${symbol}`),
      })
    } catch (error) {
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  private async executeGenerateDailyAdviceOperation(
    operationId: string,
    input: { userId: string; query?: string; scope?: 'all' | 'asset' | 'sector' }
  ) {
    const leaseToken = await this.markOperationRunning(operationId, 10)
    if (!leaseToken) return

    try {
      const result = await analysisService.generateInvestmentSuggestions(input.userId, {
        query: input.query,
        scope: input.scope,
      })
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken)
        return
      }
      await this.completeOperation(operationId, leaseToken, {
        result,
        artifactRefs: this.uniqueArtifactRefs((result as { artifactRefs?: unknown }).artifactRefs),
      })
    } catch (error) {
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  private async executeRunBacktestOperation(operationId: string, input: RunBacktestInput) {
    const leaseToken = await this.markOperationRunning(operationId, 15)
    if (!leaseToken) return

    try {
      const result = await backtestService.runBacktestFromAdvice(input)

      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken)
        return
      }
      await this.completeOperation(operationId, leaseToken, {
        result,
        artifactRefs: [
          `operation:${operationId}`,
          `backtest:${result.backtestId}`,
          `strategy:${result.strategyId}`,
          `advice:${result.adviceId}`,
        ],
      })
    } catch (error) {
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  private async executeStockScreenerFullScanOperation(
    operationId: string,
    input: StockScreenerFullScanInput,
    options: { resume?: boolean; recovery?: Record<string, unknown> } = {},
  ) {
    const leaseToken = await this.markOperationRunning(operationId, 2, {
      allowResume: options.resume,
      recovery: options.recovery,
    })
    if (!leaseToken) return

    try {
      const query = this.resolveStockScreenerQuery(input)
	      const result = await stockScreenerService.runFullMarketScanOperation(
	        operationId,
	        input.userId,
	        query,
        {
          onTaskUpdate: (update) => this.updateOperationTask(operationId, leaseToken, update),
          onProgress: (progressPct, partial) => this.updateOperationProgress(operationId, leaseToken, progressPct, partial),
          isCancelled: () => this.isOperationCancelled(operationId, leaseToken),
        }
      )
	      if (await this.isOperationCancelled(operationId, leaseToken)) {
	        await this.cancelOwnedOperation(operationId, leaseToken)
	        return
	      }
	      const resultRecord = result as Record<string, any>
	      if (resultRecord.nextAction?.code === 'NEEDS_MARKET_DATA_WARMUP') {
	        const suggestedInput = resultRecord.nextAction.suggestedInput || {}
	        const warmupOperation = await this.startMarketBarCachePreheatOperation({
	          userId: input.userId,
	          limit: typeof suggestedInput.limit === 'number' ? suggestedInput.limit : undefined,
	          days: typeof suggestedInput.days === 'number' ? suggestedInput.days : 120,
	          chunkSize: typeof suggestedInput.chunkSize === 'number' ? suggestedInput.chunkSize : 100,
	          concurrency: typeof suggestedInput.concurrency === 'number' ? suggestedInput.concurrency : 4,
	          forceRefresh: suggestedInput.forceRefresh === true,
	          parentOperationId: operationId,
	          executionMode: 'queued',
	        })
	        resultRecord.warmupOperationId = warmupOperation.id
	        resultRecord.nextAction = {
	          ...resultRecord.nextAction,
	          operationId: warmupOperation.id,
	          warmupOperationId: warmupOperation.id,
	        }
	      }
	      if (resultRecord.factsetNextAction?.code === 'NEEDS_QUOTE_LIST_MARKET_CAP_WARMUP') {
	        const suggestedInput = resultRecord.factsetNextAction.suggestedInput || {}
	        const warmupOperation = await this.startQuoteListMarketCapWarmupOperation({
	          userId: input.userId,
	          limit: typeof suggestedInput.limit === 'number' ? suggestedInput.limit : undefined,
	          chunkSize: typeof suggestedInput.chunkSize === 'number' ? suggestedInput.chunkSize : undefined,
	          parentOperationId: operationId,
	          executionMode: 'queued',
	          createdBy: 'factset_coverage_gate',
	        })
	        resultRecord.factsetWarmupOperationId = warmupOperation.id
	        resultRecord.factsetNextAction = {
	          ...resultRecord.factsetNextAction,
	          operationId: warmupOperation.id,
	          warmupOperationId: warmupOperation.id,
	        }
	      }
	      await this.completeOperation(operationId, leaseToken, {
        result,
        artifactRefs: this.uniqueArtifactRefs((result as { artifactRefs?: unknown }).artifactRefs),
      })
    } catch (error) {
      if ((error as Error & { code?: string }).code === 'OPERATION_CANCELLED' || await this.isOperationCancelled(operationId, leaseToken)) {
        await this.updateOperationTask(operationId, leaseToken, { name: 'operation.cancelled', status: 'cancelled', error })
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  private resolveStockScreenerQuery(input: StockScreenerFullScanInput) {
    if (input.query?.trim()) return input.query.trim()
    if (input.mode === 'long_sample_full') {
      return '多策略胜率；全A样本；验证天数=60；持有天数=3；预热上限=20；覆盖率阈值=80'
    }
    if (input.mode === 'long_sample_dry_run') {
      return '多策略胜率；全A样本；扫描上限=120；验证天数=60；持有天数=3；跳过事实集预热=1'
    }
    return '多策略胜率；全A样本；验证天数=5；持有天数=3'
  }

  private resolveStrategyTournamentQuery(input: StrategyTournamentRunInput) {
    if (input.query?.trim()) return input.query.trim()
    const maxScan = Math.max(1, Math.min(6000, Math.floor(input.maxScan || 5524)))
    const backtestDays = Math.max(1, Math.min(250, Math.floor(input.backtestDays || 60)))
    const holdingDays = Math.max(1, Math.min(10, Math.floor(input.holdingDays || 3)))
    const chunkSize = Math.max(10, Math.min(1000, Math.floor(input.chunkSize || 500)))
    return `多策略胜率；全A样本；扫描上限=${maxScan}；分片大小=${chunkSize}；验证天数=${backtestDays}；持有天数=${holdingDays}；跳过事实集预热=1`
  }

  private async executeStrategyTournamentRunOperation(
    operationId: string,
    input: StrategyTournamentRunInput,
    options: { resume?: boolean; recovery?: Record<string, unknown> } = {},
  ) {
    const leaseToken = await this.markOperationRunning(operationId, 2, {
      allowResume: options.resume,
      recovery: options.recovery,
    })
    if (!leaseToken) return

    try {
      const query = this.resolveStrategyTournamentQuery(input)
      const result = await stockScreenerService.runFullMarketScanOperation(
        operationId,
        input.userId,
        query,
        {
          onTaskUpdate: (update) => this.updateOperationTask(operationId, leaseToken, update),
          onProgress: (progressPct, partial) => this.updateOperationProgress(operationId, leaseToken, progressPct, partial),
          isCancelled: () => this.isOperationCancelled(operationId, leaseToken),
        },
      )
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken)
        return
      }
      const resultRecord = result as Record<string, any>
      resultRecord.operationKind = 'strategy_tournament_run'
      resultRecord.evidenceMode = 'async_strategy_evidence'
      const acceptedBacktestDays = typeof resultRecord.longSampleAcceptance?.summary?.backtestDays === 'number'
        ? resultRecord.longSampleAcceptance.summary.backtestDays
        : input.backtestDays || 60
      resultRecord.evidenceRefs = {
        batchId: resultRecord.strategyTournament?.batchId || null,
        artifactRefs: resultRecord.artifactRefs || [],
        backtestDays: acceptedBacktestDays,
        generatedAt: resultRecord.strategyTournament?.generatedAt || new Date().toISOString(),
      }
      if (resultRecord.nextAction?.code === 'NEEDS_MARKET_DATA_WARMUP') {
        const suggestedInput = resultRecord.nextAction.suggestedInput || {}
        const warmupOperation = await this.startMarketBarCachePreheatOperation({
          userId: input.userId,
          limit: typeof suggestedInput.limit === 'number' ? suggestedInput.limit : undefined,
          days: typeof suggestedInput.days === 'number' ? suggestedInput.days : 120,
          chunkSize: typeof suggestedInput.chunkSize === 'number' ? suggestedInput.chunkSize : 100,
          concurrency: typeof suggestedInput.concurrency === 'number' ? suggestedInput.concurrency : 4,
          forceRefresh: suggestedInput.forceRefresh === true,
          parentOperationId: operationId,
          executionMode: 'queued',
        })
        resultRecord.warmupOperationId = warmupOperation.id
        resultRecord.nextAction = {
          ...resultRecord.nextAction,
          operationId: warmupOperation.id,
          warmupOperationId: warmupOperation.id,
        }
      }
      if (resultRecord.factsetNextAction?.code === 'NEEDS_QUOTE_LIST_MARKET_CAP_WARMUP') {
        const suggestedInput = resultRecord.factsetNextAction.suggestedInput || {}
        const warmupOperation = await this.startQuoteListMarketCapWarmupOperation({
          userId: input.userId,
          limit: typeof suggestedInput.limit === 'number' ? suggestedInput.limit : undefined,
          chunkSize: typeof suggestedInput.chunkSize === 'number' ? suggestedInput.chunkSize : undefined,
          parentOperationId: operationId,
          executionMode: 'queued',
          createdBy: 'factset_coverage_gate',
        })
        resultRecord.factsetWarmupOperationId = warmupOperation.id
        resultRecord.factsetNextAction = {
          ...resultRecord.factsetNextAction,
          operationId: warmupOperation.id,
          warmupOperationId: warmupOperation.id,
        }
      }
      await this.completeOperation(operationId, leaseToken, {
        result,
        artifactRefs: this.uniqueArtifactRefs((result as { artifactRefs?: unknown }).artifactRefs),
      })
    } catch (error) {
      if ((error as Error & { code?: string }).code === 'OPERATION_CANCELLED' || await this.isOperationCancelled(operationId, leaseToken)) {
        await this.updateOperationTask(operationId, leaseToken, { name: 'operation.cancelled', status: 'cancelled', error })
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  private async executeBatchFactsetRefreshOperation(
    operationId: string,
    input: BatchFactsetRefreshInput,
    options: { resume?: boolean; recovery?: Record<string, unknown> } = {}
  ) {
    const leaseToken = await this.markOperationRunning(operationId, 5, {
      allowResume: options.resume,
      recovery: options.recovery,
    })
    if (!leaseToken) return

    const scope = input.scope || 'all'
    const result = {
      scope,
      positionAdvice: { successCount: 0, failureCount: 0, failures: [] as Array<{ positionId: string; symbol: string; error: string }> },
      stockFactset: { successCount: 0, failureCount: 0, failures: [] as Array<{ symbol: string; error: string }> },
      partialSuccess: false,
    }

    try {
      const symbolFilter = new Set((input.symbols || []).map((symbol) => String(symbol).toUpperCase()))
      const positions = await prisma.position.findMany({
        where: { userId: input.userId, status: 'open' },
        include: { asset: true },
        orderBy: { marketValue: 'desc' },
        take: symbolFilter.size > 0
          ? undefined
          : input.limit && input.limit > 0
            ? input.limit
            : 1000,
      })
      const filteredPositions = symbolFilter.size > 0
        ? positions.filter((position) => symbolFilter.has(position.asset.symbol.toUpperCase()))
        : positions
      const stockSymbols = [...new Set(filteredPositions
        .filter((position) => position.asset.type === 'stock')
        .map((position) => position.asset.symbol.toUpperCase()))]
      const totalSteps = (scope === 'stock_factset' ? 0 : filteredPositions.length) + (scope === 'position_advice' ? 0 : stockSymbols.length)
      let completedSteps = 0
      const existingTasks = await prisma.operationTask.findMany({ where: { operationId } })
      const completedTaskByName = new Map(existingTasks
        .filter((task) => task.status === 'completed')
        .map((task) => [task.name, task]))

      if (scope !== 'stock_factset') {
        const completedTask = completedTaskByName.get('position_advice.refresh')
        if (options.resume && completedTask) {
          result.positionAdvice.successCount = completedTask.successCount
          result.positionAdvice.failureCount = completedTask.failureCount
          completedSteps += filteredPositions.length
        } else {
        const taskStart = Date.now()
        await this.updateOperationTask(operationId, leaseToken, {
          name: 'position_advice.refresh',
          status: 'running',
          successCount: 0,
          failureCount: 0,
          metrics: { total: filteredPositions.length },
        })
        for (const position of filteredPositions) {
          if (await this.isOperationCancelled(operationId, leaseToken)) {
            await this.cancelOwnedOperation(operationId, leaseToken)
            return
          }
          try {
            await positionAdviceService.getPositionAdvice(position.id, {
              includeExternalAnalysis: false,
              forceRefresh: true,
            })
            result.positionAdvice.successCount += 1
          } catch (error) {
            result.positionAdvice.failureCount += 1
            result.positionAdvice.failures.push({
              positionId: position.id,
              symbol: position.asset.symbol,
              error: error instanceof Error ? error.message : String(error),
            })
          }
          completedSteps += 1
          await this.updateOperationProgress(operationId, leaseToken, Math.min(95, Math.round((completedSteps / Math.max(totalSteps, 1)) * 90)), {
            progressCurrent: completedSteps,
            progressTotal: totalSteps,
            progressMessage: `已刷新持仓建议 ${result.positionAdvice.successCount}/${filteredPositions.length}`,
          })
        }
        await this.updateOperationTask(operationId, leaseToken, {
          name: 'position_advice.refresh',
          status: 'completed',
          successCount: result.positionAdvice.successCount,
          failureCount: result.positionAdvice.failureCount,
          provider: 'positionAdviceService',
          warnings: result.positionAdvice.failures.slice(0, 5).map((failure) => `${failure.symbol}: ${failure.error}`),
          metrics: { elapsedMs: Date.now() - taskStart, total: filteredPositions.length },
        })
        }
      }

      if (scope !== 'position_advice') {
        const completedTask = completedTaskByName.get('stock_factset.refresh')
        if (options.resume && completedTask) {
          result.stockFactset.successCount = completedTask.successCount
          result.stockFactset.failureCount = completedTask.failureCount
          completedSteps += stockSymbols.length
        } else {
        const taskStart = Date.now()
        await this.updateOperationTask(operationId, leaseToken, {
          name: 'stock_factset.refresh',
          status: 'running',
          successCount: 0,
          failureCount: 0,
          metrics: { total: stockSymbols.length },
        })
        for (const symbol of stockSymbols) {
          if (await this.isOperationCancelled(operationId, leaseToken)) {
            await this.cancelOwnedOperation(operationId, leaseToken)
            return
          }
          try {
            await this.withTimeout(
              stockAnalysisService.getFullAnalysis(symbol, 'A股', 80, {
                forceRefresh: true,
              }),
              60_000,
              `股票事实集刷新超时：${symbol}`
            )
            result.stockFactset.successCount += 1
          } catch (error) {
            result.stockFactset.failureCount += 1
            result.stockFactset.failures.push({
              symbol,
              error: error instanceof Error ? error.message : String(error),
            })
          }
          completedSteps += 1
          await this.updateOperationProgress(operationId, leaseToken, Math.min(95, Math.round((completedSteps / Math.max(totalSteps, 1)) * 90)), {
            progressCurrent: completedSteps,
            progressTotal: totalSteps,
            progressMessage: `已刷新股票事实集 ${result.stockFactset.successCount}/${stockSymbols.length}`,
          })
        }
        await this.updateOperationTask(operationId, leaseToken, {
          name: 'stock_factset.refresh',
          status: 'completed',
          successCount: result.stockFactset.successCount,
          failureCount: result.stockFactset.failureCount,
          provider: 'stockAnalysisService',
          warnings: result.stockFactset.failures.slice(0, 5).map((failure) => `${failure.symbol}: ${failure.error}`),
          metrics: { elapsedMs: Date.now() - taskStart, total: stockSymbols.length },
        })
        }
      }

      result.partialSuccess = result.positionAdvice.failureCount > 0 || result.stockFactset.failureCount > 0
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken)
        return
      }
      await this.completeOperation(operationId, leaseToken, {
        result: {
          ...result,
          positionCount: filteredPositions.length,
          stockSymbolCount: stockSymbols.length,
          artifactRefs: [`operation:${operationId}`],
        },
        artifactRefs: [`operation:${operationId}`],
      })
    } catch (error) {
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  private async executeDividendLowVolDailyScanOperation(operationId: string, input: DividendLowVolDailyScanInput) {
    const leaseToken = await this.markOperationRunning(operationId, 5)
    if (!leaseToken) return

    try {
      const limit = Math.max(1, Math.min(1000, Math.floor(input.limit || 120)))
      const symbols = Array.from(new Set((input.symbols || [])
        .map((item) => String(item).trim())
        .filter((item) => /^\d{6}$/.test(item))))
        .slice(0, limit)
      const useAllA = input.universe === 'all_a' || symbols.length === 0
      if (useAllA) {
        const readiness = await dividendLowVolDataReadinessService.buildAudit()
        if (!readiness.gates.persistentFullAScanAllowed) {
          throw new Error(`dividend_low_vol_full_a_scan_blocked:${readiness.researchBlockers.join('|') || readiness.blockers.join('|') || readiness.gates.reason}`)
        }
      }
      const universe = useAllA
        ? await dividendLowVolUniverseService.getAllAShareInputs({ limit })
        : null
      const effectiveSymbols = universe ? universe.inputs.map((item) => item.symbol) : symbols
      await this.updateOperationProgress(operationId, leaseToken, 20, {
        progressCurrent: 0,
        progressTotal: effectiveSymbols.length,
        progressMessage: `准备红利低波${useAllA ? '全 A 预筛' : ''}扫描 ${effectiveSymbols.length} 个标的`,
        universeSummary: universe?.summary,
      })
      const inputs = universe
        ? await dividendLowVolInputBuilderService.buildFromInputs(universe.inputs, limit)
        : await dividendLowVolInputBuilderService.buildFromSymbols(effectiveSymbols, limit)
      const enrichedInputs = await dividendLowVolInputBuilderService.enrichWithPortfolioContext(input.userId, inputs)
      const pool = await dividendLowVolStrategyService.persistCandidatePool(input.userId, enrichedInputs.map((item) => ({
        ...item,
        evidenceRefs: [
          ...(item.evidenceRefs || []),
          `dividend-low-vol:operation:${operationId}:${item.symbol}`,
        ],
      })), {
        sourceOperationId: operationId,
        universeSummary: universe?.summary,
      })
      await this.updateOperationTask(operationId, leaseToken, {
        name: 'dividend_low_vol.daily_scan',
        status: 'completed',
        successCount: pool.total,
        failureCount: 0,
        provider: 'dividendLowVolStrategyService',
        warnings: pool.candidates
          .filter((candidate) => candidate.disposition === 'data_insufficient')
          .slice(0, 5)
          .map((candidate) => `${candidate.identity.symbol}: ${candidate.blockedReasons.join(',')}`),
        metrics: {
          total: pool.total,
          eligibleResearchCandidates: pool.eligibleResearchCandidates,
          universeSource: universe?.summary.universeSource || 'provided_symbols',
          universeTotal: universe?.summary.universeTotal || effectiveSymbols.length,
        },
      })
      await this.updateOperationProgress(operationId, leaseToken, 95, {
        progressCurrent: pool.total,
        progressTotal: pool.total,
        progressMessage: `红利低波扫描完成：候选 ${pool.total}`,
      })
      await this.completeOperation(operationId, leaseToken, {
        result: {
          schemaVersion: 'dividend.low_vol.operation_result.v1',
          operationId,
          status: 'completed',
          pool,
          universeSummary: universe?.summary,
          policy: pool.policy,
        },
        artifactRefs: [
          `operation:${operationId}`,
          `dividend-low-vol:daily-scan:${operationId}`,
          ...pool.candidates.map((candidate) => `dividend-low-vol:${candidate.identity.symbol}:${candidate.generatedAt}`),
        ],
      })
    } catch (error) {
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  private async executeQuoteListMarketCapWarmupOperation(
    operationId: string,
    input: QuoteListMarketCapWarmupInput,
    options: { resume?: boolean; recovery?: Record<string, unknown> } = {}
  ) {
    const leaseToken = await this.markOperationRunning(operationId, 0, {
      allowResume: options.resume,
      recovery: options.recovery,
    })
    if (!leaseToken) return

    const limit = input.limit && input.limit > 0 ? Math.floor(input.limit) : 40
    const chunkSize = input.chunkSize && input.chunkSize > 0 ? Math.floor(input.chunkSize) : 10
    const canonicalPath = this.quoteListCanonicalPath()

    try {
      const canonical = JSON.parse(await readFile(canonicalPath, 'utf8')) as QuoteListCanonicalFile
      if (canonical.schemaVersion !== 'fams.a_share_quote_list_canonical.v1') {
        throw new Error(`Unexpected quote-list canonical schema: ${canonical.schemaVersion}`)
      }

      const beforeCoverage = this.quoteListCoverage(canonical.items)
      const candidates = canonical.items
        .filter((item) => item.industryName && !item.floatMarketCap && !(item.warnings || []).includes(QUOTE_LIST_MARKET_CAP_UNAVAILABLE_WARNING))
        .map((item) => item.code)
        .sort()
        .slice(0, limit)
      const chunks: string[][] = []
      for (let index = 0; index < candidates.length; index += chunkSize) {
        chunks.push(candidates.slice(index, index + chunkSize))
      }

      let completedSymbols = 0
      let successCount = 0
      let failureCount = 0
      const chunkReports: Array<Record<string, unknown>> = []
      const itemByCode = new Map(canonical.items.map((item) => [item.code, item]))
      const existingTasks = await prisma.operationTask.findMany({ where: { operationId } })
      const completedTaskByKey = new Map(existingTasks
        .filter((task) => task.status === 'completed')
        .map((task) => [task.idempotencyKey || '', task]))

      await this.updateOperationProgress(operationId, leaseToken, 0, {
        progressCurrent: 0,
        progressTotal: candidates.length,
        progressMessage: `准备补齐 ${candidates.length} 只标的市值`,
        beforeCoverage,
      })

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const symbols = chunks[chunkIndex]
        const idempotencyKey = `quote_list_market_cap_warmup:${operationId}:chunk:${chunkIndex}`
        const completedTask = completedTaskByKey.get(idempotencyKey)
        if (options.resume && completedTask) {
          completedSymbols += symbols.length
          successCount += completedTask.successCount
          failureCount += completedTask.failureCount
          continue
        }

        if (await this.isOperationCancelled(operationId, leaseToken)) {
          await this.cancelOwnedOperation(operationId, leaseToken)
          return
        }

        const taskStart = Date.now()
        await this.updateOperationTask(operationId, leaseToken, {
          name: 'quote_list.market_cap_warmup',
          taskType: 'quote_list.market_cap_warmup',
          chunkIndex,
          status: 'running',
          idempotencyKey,
          input: { symbols },
          provider: 'baostock_market_cap',
          metrics: { symbolCount: symbols.length },
        })

        const provider = await this.runBaoStockMarketCapProvider(symbols)
        const returnedBySymbol = new Map(provider.items.map((item) => [item.symbol, item]))
        let chunkSuccess = 0
        let chunkFailure = 0
        const failedSymbols: Array<{ symbol: string; warning: string }> = []
        for (const symbol of symbols) {
          const result = returnedBySymbol.get(symbol)
          const canonicalItem = itemByCode.get(symbol)
          if (result?.floatMarketCap && canonicalItem) {
            canonicalItem.floatMarketCap = result.floatMarketCap
            canonicalItem.fetchedAt = provider.fetchedAt
            canonicalItem.sourceProviders = Array.from(new Set([...(canonicalItem.sourceProviders || []), 'baostock_market_cap']))
            canonicalItem.sourceRefs = Array.from(new Set([...(canonicalItem.sourceRefs || []), ...(result.sourceRefs || [])]))
            canonicalItem.warnings = (canonicalItem.warnings || []).filter((warning) => warning !== '缺少市值来源')
            this.refreshQuoteListItemConfidence(canonicalItem)
            chunkSuccess += 1
          } else {
            chunkFailure += 1
            const symbolWarning = (provider.warnings || []).find((warning) => warning.includes(symbol))
            if (canonicalItem) {
              canonicalItem.fetchedAt = provider.fetchedAt
              canonicalItem.warnings = Array.from(new Set([
                ...(canonicalItem.warnings || []),
                QUOTE_LIST_MARKET_CAP_UNAVAILABLE_WARNING,
              ]))
              canonicalItem.sourceProviders = Array.from(new Set([...(canonicalItem.sourceProviders || []), 'baostock_market_cap']))
              this.refreshQuoteListItemConfidence(canonicalItem)
            }
            failedSymbols.push({
              symbol,
              warning: symbolWarning || 'baostock_market_cap returned no derivable float market cap',
            })
          }
        }
        await this.recordQuoteListProviderHealth({
          provider: 'baostock_market_cap',
          endpoint: 'quote_list_market_cap',
          successCount: chunkSuccess,
          failureCount: chunkFailure,
          elapsedMs: Date.now() - taskStart,
          warnings: provider.warnings || [],
          symbolCount: symbols.length,
        })

        const currentCoverage = this.quoteListCoverage(canonical.items)
        canonical.generatedAt = new Date().toISOString()
        canonical.coverage = currentCoverage
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
          failedSymbols,
          elapsedMs: Date.now() - taskStart,
          warnings: provider.warnings || [],
          coverage: currentCoverage,
        }
        chunkReports.push(chunkReport)

        await this.updateOperationTask(operationId, leaseToken, {
          name: 'quote_list.market_cap_warmup',
          taskType: 'quote_list.market_cap_warmup',
          chunkIndex,
          status: chunkFailure > 0 ? (chunkSuccess > 0 ? 'partial' : 'failed') : 'completed',
          idempotencyKey,
          successCount: chunkSuccess,
          failureCount: chunkFailure,
          provider: 'baostock_market_cap',
          warnings: provider.warnings || [],
          metrics: { elapsedMs: Date.now() - taskStart, coverage: currentCoverage },
          output: chunkReport,
        })

        await this.updateOperationProgress(operationId, leaseToken, candidates.length > 0 ? Math.min(95, Math.round((completedSymbols / candidates.length) * 90)) : 100, {
          progressCurrent: completedSymbols,
          progressTotal: candidates.length,
          progressMessage: `已补齐市值 ${successCount}/${candidates.length}`,
          currentCoverage,
          successCount,
          failureCount,
        })
      }

      const finalCoverage = this.quoteListCoverage(canonical.items)
      const providerHealth = await prisma.providerHealth.findUnique({ where: { provider: 'baostock_market_cap' } })
      const failedSymbols = chunkReports.flatMap((report) => Array.isArray(report.failedSymbols) ? report.failedSymbols : [])
      const artifacts = {
        'quote_list_market_cap_warmup_report.json': {
          beforeCoverage,
          finalCoverage,
          requestedSymbols: candidates.length,
          successCount,
          failureCount,
          failedSymbols,
          chunkSize,
          chunkReports,
          providerHealth,
        },
      }
      const artifactRefs = Object.keys(artifacts).map((filename) => `operation_artifact:${operationId}:${filename}`)
      await this.completeOperation(operationId, leaseToken, {
        result: {
          beforeCoverage,
          finalCoverage,
          requestedSymbols: candidates.length,
          successCount,
          failureCount,
          partialSuccess: failureCount > 0,
          artifacts,
          artifactRefs,
        },
        artifactRefs,
      })
    } catch (error) {
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  private async executeMarketBarCachePreheatOperation(
    operationId: string,
    input: MarketBarCachePreheatInput,
    options: { resume?: boolean; recovery?: Record<string, unknown> } = {}
  ) {
    const leaseToken = await this.markOperationRunning(operationId, 0, {
      allowResume: options.resume,
      recovery: options.recovery,
    })
    if (!leaseToken) return

    const limit = Math.max(1, Math.min(6000, Math.floor(input.limit || 120)))
    const days = Math.max(1, Math.min(500, Math.floor(input.days || 120)))
    const chunkSize = Math.max(10, Math.min(500, Math.floor(input.chunkSize || 100)))
    const concurrency = Math.max(1, Math.min(8, Math.floor(input.concurrency || 4)))
    const forceRefresh = input.forceRefresh === true
    const minBars = Math.min(days, 90)
    const startedAt = Date.now()

    const runWithConcurrency = async <T, R>(items: T[], mapper: (item: T, index: number) => Promise<R>) => {
      const results = new Array<R>(items.length)
      let nextIndex = 0
      async function worker() {
        while (nextIndex < items.length) {
          const index = nextIndex
          nextIndex += 1
          results[index] = await mapper(items[index], index)
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => worker()))
      return results
    }

    try {
      const requestedSymbols = Array.from(new Set((Array.isArray(input.symbols) ? input.symbols : [])
        .map((symbol) => String(symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, ''))
        .filter(Boolean)))
      const universeResult = requestedSymbols.length > 0
        ? {
          universe: requestedSymbols.map((symbol) => ({ symbol })),
          universeSource: 'provided_symbols',
          universeTotal: requestedSymbols.length,
        }
        : await stockScreenerService.resolveStockUniverseForPreheat(input.userId, {
          maxUniverse: limit,
        })
      const { universe, universeSource, universeTotal } = universeResult
      const symbols = universe.map((asset) => asset.symbol)
      const beforeCoverage = await marketBarCacheService.getCoverageReport(symbols, days)
      const minCacheHitBars = Math.ceil(days * 0.8)
      const topUpSymbolSet = new Set(beforeCoverage.items
        .filter((item) => item.sufficient && item.cachedBars < minCacheHitBars)
        .map((item) => item.symbol))
      const summarizeCoverageProgress = (report: typeof beforeCoverage) => ({
        schemaVersion: report.schemaVersion,
        generatedAt: report.generatedAt,
        requestedDays: report.requestedDays,
        totalSymbols: report.totalSymbols,
        sufficientSymbols: report.sufficientSymbols,
        insufficientSymbols: report.insufficientSymbols,
        staleSymbols: report.staleSymbols,
        averageCachedBars: report.averageCachedBars,
        estimatedCacheHitRate: report.estimatedCacheHitRate,
        retryableWarmupSymbols: report.retryableWarmupSymbols.slice(0, 100),
        nonRetryableWarningSymbols: report.nonRetryableWarningSymbols.slice(0, 100),
        warningSummary: report.warningSummary,
        missingSymbols: report.missingSymbols.slice(0, 100),
        staleSymbolList: report.staleSymbolList.slice(0, 100),
        itemCount: report.items.length,
        sampleItems: report.items.slice(0, 100),
        truncated: report.items.length > 100,
      })
      const targets = beforeCoverage.items
        .filter((item) => forceRefresh || (!item.sufficient && item.retryable !== false) || (item.sufficient && item.cachedBars < minCacheHitBars))
        .map((item) => item.symbol)
      const targetSymbolSet = new Set(targets)
      const chunks: string[][] = []
      for (let index = 0; index < targets.length; index += chunkSize) {
        chunks.push(targets.slice(index, index + chunkSize))
      }

      const existingTasks = await prisma.operationTask.findMany({ where: { operationId } })
      const completedTaskByKey = new Map(existingTasks
        .filter((task) => task.status === 'completed')
        .map((task) => [task.idempotencyKey || '', task]))
      const chunkReports: Array<Record<string, unknown>> = []
      let completedSymbols = 0
      let successCount = 0
      let warningCount = 0
      let failureCount = 0
      let fetchedBars = 0
      const summarizeFailureCategories = (stats: MarketBarCacheStats[]) => stats.reduce<Record<string, number>>((summary, item) => {
        const category = item.failureCategory || (item.warnings.length > 0 ? 'provider_error' : 'none')
        summary[category] = (summary[category] || 0) + 1
        return summary
      }, {})

      await this.updateOperationProgress(operationId, leaseToken, 0, {
        progressCurrent: 0,
        progressTotal: targets.length,
        progressMessage: `准备预热 ${targets.length}/${symbols.length} 只标的 K 线缓存`,
        beforeCoverage: summarizeCoverageProgress(beforeCoverage),
        universeSource,
        universeTotal,
        minCacheHitBars,
      })

      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
        const chunkSymbols = chunks[chunkIndex]
        const idempotencyKey = `market_bar_cache_preheat:${operationId}:chunk:${chunkIndex}`
        const completedTask = completedTaskByKey.get(idempotencyKey)
        if (options.resume && completedTask) {
          completedSymbols += chunkSymbols.length
          successCount += completedTask.successCount
          failureCount += completedTask.failureCount
          continue
        }

        if (await this.isOperationCancelled(operationId, leaseToken)) {
          await this.cancelOwnedOperation(operationId, leaseToken)
          return
        }

        const chunkStartedAt = Date.now()
        await this.updateOperationTask(operationId, leaseToken, {
          name: 'market_bar.cache_preheat',
          taskType: 'market_bar.cache_preheat',
          chunkIndex,
          status: 'running',
          idempotencyKey,
          input: { symbols: chunkSymbols, days, forceRefresh },
          provider: forceRefresh ? 'sina' : 'cache_or_sina',
          metrics: { symbolCount: chunkSymbols.length, days, concurrency },
        })

        const stats = await runWithConcurrency(chunkSymbols, async (symbol) => {
          try {
            const result = await marketBarCacheService.getHistory(symbol, days, {
              market: 'CN',
              provider: 'sina',
              forceRefresh: forceRefresh || topUpSymbolSet.has(symbol),
            })
            return result.stats
          } catch (error) {
            return {
              symbol,
              provider: 'sina',
              requestedDays: days,
              returnedDays: 0,
              cacheHits: 0,
              cacheMisses: days,
              cacheHitRate: 0,
              fetched: 0,
              warnings: [error instanceof Error ? error.message : String(error)],
              failureCategory: /timeout|timed out/i.test(error instanceof Error ? error.message : String(error))
                ? 'provider_timeout'
                : 'provider_error',
              failureRetryable: true,
              providerAttempts: 0,
              durationMs: 0,
            } satisfies MarketBarCacheStats
          }
        })
        await marketBarCacheService.flushProviderHealth()

        const warningStats = stats.filter((item) => item.returnedDays < minBars || item.warnings.length > 0)
        const chunkSuccess = stats.length - warningStats.length
        const chunkFailure = warningStats.filter((item) => item.returnedDays <= 0).length
        const chunkWarning = warningStats.length
        const cacheHitRate = stats.length > 0
          ? Number((stats.reduce((sum, item) => sum + item.cacheHitRate, 0) / stats.length).toFixed(2))
          : 0
        const providers = Array.from(new Set(stats.map((item) => item.provider))).join(',') || 'unknown'
        const failureCategorySummary = summarizeFailureCategories(warningStats)
        const chunkReport = {
          chunkIndex,
          symbols: chunkSymbols,
          successCount: chunkSuccess,
          warningCount: chunkWarning,
          failureCount: chunkFailure,
          elapsedMs: Date.now() - chunkStartedAt,
          provider: providers,
          cacheHitRate,
          failureCategorySummary,
          fetchedBars: stats.reduce((sum, item) => sum + item.fetched, 0),
          warnings: warningStats.slice(0, 20).map((item) => ({
            symbol: item.symbol,
            returnedDays: item.returnedDays,
            failureCategory: item.failureCategory || null,
            retryable: item.failureRetryable ?? null,
            providerAttempts: item.providerAttempts ?? null,
            warnings: item.warnings,
          })),
        }

        completedSymbols += chunkSymbols.length
        successCount += chunkSuccess
        warningCount += chunkWarning
        failureCount += chunkFailure
        fetchedBars += stats.reduce((sum, item) => sum + item.fetched, 0)
        chunkReports.push(chunkReport)

        await this.updateOperationTask(operationId, leaseToken, {
          name: 'market_bar.cache_preheat',
          taskType: 'market_bar.cache_preheat',
          chunkIndex,
          status: chunkFailure > 0 || chunkWarning > 0 ? (chunkSuccess > 0 ? 'partial' : 'failed') : 'completed',
          idempotencyKey,
          successCount: chunkSuccess,
          failureCount: chunkFailure,
          provider: providers,
          cacheHitRate,
          warnings: (chunkReport.warnings as Array<{ symbol: string; warnings: string[] }>).map((item) => `${item.symbol}: ${item.warnings.join('; ') || 'history insufficient'}`),
          metrics: chunkReport,
          output: chunkReport,
        })

        await this.updateOperationProgress(operationId, leaseToken, targets.length > 0 ? Math.min(95, Math.round((completedSymbols / targets.length) * 90)) : 100, {
          progressCurrent: completedSymbols,
          progressTotal: targets.length,
          progressMessage: `已预热 K 线缓存 ${completedSymbols}/${targets.length}`,
          successCount,
          warningCount,
          failureCount,
          fetchedBars,
        })
      }

      const afterCoverage = await marketBarCacheService.getCoverageReport(symbols, days, 'CN', { forceRebuild: true })
      const unresolvedCoverageItems = afterCoverage.items.filter((item) => !item.sufficient)
      const featureTargets = afterCoverage.items
        .filter((item) => item.sufficient && (forceRefresh || targetSymbolSet.has(item.symbol)))
        .map((item) => item.symbol)
      await this.updateOperationTask(operationId, leaseToken, {
        name: 'market_feature.compute',
        taskType: 'market_feature.compute',
        status: featureTargets.length > 0 ? 'running' : 'completed',
        input: { symbols: featureTargets, lookbackDays: Math.max(days, 260) },
        provider: 'market_feature_daily',
        metrics: { plannedSymbols: featureTargets.length },
      })
      const featureReport = featureTargets.length > 0
        ? await marketFeatureDailyService.computeForSymbols(featureTargets, { market: 'CN', lookbackDays: Math.max(days, 260) })
        : {
          schemaVersion: 'fams.market_feature_daily.compute_report.v1' as const,
          generatedAt: new Date().toISOString(),
          market: 'CN',
          requestedSymbols: 0,
          computedSymbols: 0,
          insufficientSymbols: 0,
          failedSymbols: 0,
          featureRows: 0,
          items: [],
        }
      await this.updateOperationTask(operationId, leaseToken, {
        name: 'market_feature.compute',
        taskType: 'market_feature.compute',
        status: featureReport.failedSymbols > 0 && featureReport.computedSymbols === 0 ? 'failed' : (featureReport.failedSymbols > 0 || featureReport.insufficientSymbols > 0 ? 'partial' : 'completed'),
        successCount: featureReport.computedSymbols,
        failureCount: featureReport.failedSymbols + featureReport.insufficientSymbols,
        provider: 'market_feature_daily',
        warnings: featureReport.items
          .filter((item) => item.status !== 'computed')
          .slice(0, 50)
          .map((item) => `${item.symbol}: ${item.warnings.join('; ')}`),
        metrics: {
          requestedSymbols: featureReport.requestedSymbols,
          computedSymbols: featureReport.computedSymbols,
          insufficientSymbols: featureReport.insufficientSymbols,
          failedSymbols: featureReport.failedSymbols,
          featureRows: featureReport.featureRows,
        },
        output: {
          schemaVersion: featureReport.schemaVersion,
          generatedAt: featureReport.generatedAt,
          market: featureReport.market,
          requestedSymbols: featureReport.requestedSymbols,
          computedSymbols: featureReport.computedSymbols,
          insufficientSymbols: featureReport.insufficientSymbols,
          failedSymbols: featureReport.failedSymbols,
          featureRows: featureReport.featureRows,
          warningItems: featureReport.items
            .filter((item) => item.status !== 'computed')
            .slice(0, 100),
          itemCount: featureReport.items.length,
          truncated: featureReport.items.length > 100,
        },
      })
      const coverageWarnings = unresolvedCoverageItems.slice(0, 50).map((item) => ({
        symbol: item.symbol,
        cachedBars: item.cachedBars,
        latestDate: item.latestDate,
        stale: item.stale,
        category: item.warningCategory || 'unknown',
        severity: item.warningSeverity || 'warning',
        retryable: item.retryable === true,
        recommendedAction: item.recommendedAction || 'review_provider_mapping',
        warning: item.stale
          ? 'cache remains stale after preheat'
          : 'cache remains insufficient after preheat',
      }))
      const featureReportSummary = {
        schemaVersion: featureReport.schemaVersion,
        generatedAt: featureReport.generatedAt,
        market: featureReport.market,
        requestedSymbols: featureReport.requestedSymbols,
        computedSymbols: featureReport.computedSymbols,
        insufficientSymbols: featureReport.insufficientSymbols,
        failedSymbols: featureReport.failedSymbols,
        featureRows: featureReport.featureRows,
        warningItems: featureReport.items
          .filter((item) => item.status !== 'computed')
          .slice(0, 100),
        itemCount: featureReport.items.length,
        truncated: featureReport.items.length > 100,
      }
      const artifacts = {
        'market_bar_cache_preheat_report.json': {
          schemaVersion: 'fams.market_bar.cache_preheat_report.v1',
          generatedAt: new Date().toISOString(),
          universeSource,
          universeTotal,
          requestedSymbols: symbols.length,
          attemptedSymbols: targets.length,
          successCount,
          warningCount,
          failureCount,
          fetchedBars,
          days,
          chunkSize,
          concurrency,
          forceRefresh,
          elapsedMs: Date.now() - startedAt,
          beforeCoverage: summarizeCoverageProgress(beforeCoverage),
          afterCoverage: summarizeCoverageProgress(afterCoverage),
          failureCategorySummary: chunkReports.reduce<Record<string, number>>((summary, report) => {
            const categories = (report.failureCategorySummary || {}) as Record<string, number>
            for (const [category, count] of Object.entries(categories)) {
              summary[category] = (summary[category] || 0) + count
            }
            return summary
          }, {}),
          coverageWarnings,
          featureReport: featureReportSummary,
          chunkReports: chunkReports.slice(0, 200),
          chunkReportCount: chunkReports.length,
        },
      }
      const artifactRefs = Object.keys(artifacts).map((filename) => `operation_artifact:${operationId}:${filename}`)
      await this.completeOperation(operationId, leaseToken, {
        result: {
          schemaVersion: 'fams.market_bar.cache_preheat_result.v1',
          requestedSymbols: symbols.length,
          attemptedSymbols: targets.length,
          successCount,
          warningCount,
          failureCount,
          fetchedBars,
          beforeCoverage: {
            sufficientSymbols: beforeCoverage.sufficientSymbols,
            insufficientSymbols: beforeCoverage.insufficientSymbols,
            estimatedCacheHitRate: beforeCoverage.estimatedCacheHitRate,
          },
          afterCoverage: {
            sufficientSymbols: afterCoverage.sufficientSymbols,
            insufficientSymbols: afterCoverage.insufficientSymbols,
            estimatedCacheHitRate: afterCoverage.estimatedCacheHitRate,
            retryableWarmupSymbols: afterCoverage.retryableWarmupSymbols.slice(0, 100),
            nonRetryableWarningSymbols: afterCoverage.nonRetryableWarningSymbols.slice(0, 100),
            warningSummary: afterCoverage.warningSummary,
          },
          coverageWarningCount: unresolvedCoverageItems.length,
          retryableCoverageWarningCount: afterCoverage.warningSummary.retryableWarmupCount,
          nonRetryableCoverageWarningCount: afterCoverage.warningSummary.nonRetryableWarningCount,
          coverageWarningSummary: afterCoverage.warningSummary,
          coverageWarnings,
          featureReport: {
            requestedSymbols: featureReport.requestedSymbols,
            computedSymbols: featureReport.computedSymbols,
            insufficientSymbols: featureReport.insufficientSymbols,
            failedSymbols: featureReport.failedSymbols,
            featureRows: featureReport.featureRows,
          },
          partialSuccess: warningCount > 0 || failureCount > 0 || unresolvedCoverageItems.length > 0 || featureReport.failedSymbols > 0 || featureReport.insufficientSymbols > 0,
          artifacts,
          artifactRefs,
        },
        artifactRefs,
      })
    } catch (error) {
      if (await this.isOperationCancelled(operationId, leaseToken)) {
        await this.cancelOwnedOperation(operationId, leaseToken, error)
        return
      }
      await this.failOperation(operationId, leaseToken, error)
    }
  }

  async startRefreshPricesOperation(input: RefreshPricesInput) {
    await ensureUser(prisma, input.userId)

    const operation = await prisma.operation.create({
      data: {
        parentOperationId: input.parentOperationId || null,
        userId: input.userId,
        type: 'refresh_prices',
        status: 'queued',
        createdBy: 'user',
        inputJson: JSON.stringify({
          assetIds: input.assetIds || [],
          symbols: input.symbols || [],
          userId: input.userId,
        }),
      },
    })

    void this.executeRefreshPricesOperation(operation.id, input)

    return this.getOperation(operation.id)
  }

  async startCheckAlertsOperation(input: CheckAlertsInput) {
    await ensureUser(prisma, input.userId)

    const operation = await prisma.operation.create({
      data: {
        parentOperationId: input.parentOperationId || null,
        userId: input.userId,
        type: 'check_alerts',
        status: 'queued',
        createdBy: 'user',
        inputJson: JSON.stringify({
          userId: input.userId,
          refreshPrices: input.refreshPrices !== false,
        }),
      },
    })

    void this.executeCheckAlertsOperation(operation.id, input)

    return this.getOperation(operation.id)
  }

  async startGenerateDailyAdviceOperation(input: GenerateDailyAdviceInput) {
    await ensureUser(prisma, input.userId)

    const operation = await prisma.operation.create({
      data: {
        parentOperationId: input.parentOperationId || null,
        userId: input.userId,
        type: 'generate_daily_advice',
        status: 'queued',
        createdBy: 'user',
        inputJson: JSON.stringify({
          userId: input.userId,
          query: input.query || null,
          scope: input.scope || 'all',
        }),
      },
    })

    void this.executeGenerateDailyAdviceOperation(operation.id, input)

    return this.getOperation(operation.id)
  }

  async startRunBacktestOperation(input: RunBacktestInput) {
    await ensureUser(prisma, input.userId)

    const operation = await prisma.operation.create({
        data: {
          parentOperationId: input.parentOperationId || null,
          userId: input.userId,
          type: 'run_backtest',
          status: 'queued',
        createdBy: 'user',
        inputJson: JSON.stringify({
          userId: input.userId,
          adviceId: input.adviceId,
          startDate: input.startDate || null,
          endDate: input.endDate || null,
          initialCapital: input.initialCapital || null,
          parentOperationId: input.parentOperationId || null,
        }),
      },
    })

    void this.executeRunBacktestOperation(operation.id, input)

    return this.getOperation(operation.id)
  }

  async startStockScreenerFullScanOperation(input: StockScreenerFullScanInput) {
    if (input.mode === 'long_sample_full' && input.confirmedFullScan !== true) {
      throw new Error('真实全A长样本扫描需要 confirmedFullScan=true，避免误触发高成本任务')
    }
    await ensureUser(prisma, input.userId)
    const mode = input.mode || 'default'
    const query = this.resolveStockScreenerQuery(input)

    const operation = await prisma.operation.create({
      data: {
        parentOperationId: input.parentOperationId || null,
        userId: input.userId,
        type: 'stock_screener_full_scan',
        status: 'queued',
        createdBy: 'user',
        inputJson: JSON.stringify({
          userId: input.userId,
          query,
          mode,
          confirmedFullScan: input.confirmedFullScan === true,
          parentOperationId: input.parentOperationId || null,
          executionMode: input.executionMode || 'inline',
        }),
      },
    })

    if (input.executionMode !== 'queued') {
      void this.executeStockScreenerFullScanOperation(operation.id, { ...input, query, mode })
    }

    return this.getOperation(operation.id)
  }

  async startStrategyTournamentRunOperation(input: StrategyTournamentRunInput) {
    const maxScan = Math.max(1, Math.min(6000, Math.floor(input.maxScan || 5524)))
    const backtestDays = Math.max(1, Math.min(250, Math.floor(input.backtestDays || 60)))
    const holdingDays = Math.max(1, Math.min(10, Math.floor(input.holdingDays || 3)))
    const chunkSize = Math.max(10, Math.min(1000, Math.floor(input.chunkSize || 500)))
    if (maxScan > 1000 && input.confirmedFullScan !== true) {
      throw new Error('真实全A策略证据任务需要 confirmedFullScan=true，避免误触发高成本任务')
    }
    await ensureUser(prisma, input.userId)
    const query = this.resolveStrategyTournamentQuery({ ...input, maxScan, backtestDays, holdingDays, chunkSize })

    const operation = await prisma.operation.create({
      data: {
        parentOperationId: input.parentOperationId || null,
        userId: input.userId,
        type: 'strategy_tournament_run',
        status: 'queued',
        createdBy: 'user',
        inputJson: JSON.stringify({
          userId: input.userId,
          query,
          maxScan,
          backtestDays,
          holdingDays,
          chunkSize,
          confirmedFullScan: input.confirmedFullScan === true,
          parentOperationId: input.parentOperationId || null,
          executionMode: input.executionMode || 'inline',
        }),
      },
    })

    if (input.executionMode !== 'queued') {
      void this.executeStrategyTournamentRunOperation(operation.id, {
        ...input,
        query,
        maxScan,
        backtestDays,
        holdingDays,
        chunkSize,
      })
    }

    return this.getOperation(operation.id)
  }

  async runNextQueuedOperation(params: {
    types?: OperationType[]
    workerId?: string
  } = {}) {
    const now = new Date()
    const supportedTypes: OperationType[] = ['stock_screener_full_scan', 'strategy_tournament_run', 'batch_factset_refresh', 'quote_list_market_cap_warmup', 'market_bar_cache_preheat', 'dividend_low_vol_daily_scan']
    const types = (params.types && params.types.length > 0 ? params.types : supportedTypes)
      .filter((type) => supportedTypes.includes(type))
    if (types.length === 0) {
      return { claimed: false, reason: 'no_supported_types', operation: null }
    }

    const operation = await prisma.operation.findFirst({
      where: {
        type: { in: types },
        cancelRequested: false,
        OR: [
          { status: 'queued' },
          {
            status: 'running',
            OR: [
              { leaseExpiresAt: null },
              { leaseExpiresAt: { lt: now } },
            ],
          },
        ],
      },
      orderBy: { requestedAt: 'asc' },
    })

    if (!operation) {
      return { claimed: false, reason: 'no_queued_or_expired_operation', operation: null }
    }

    await this.executeQueuedOperation(operation.id, {
      reason: operation.status === 'running' ? 'expired_lease_worker_recovery' : 'queued_worker_execution',
      workerId: params.workerId || OPERATION_WORKER_ID,
      previousStatus: operation.status,
      previousLeaseOwner: operation.leaseOwner || null,
      previousLeaseExpiresAt: operation.leaseExpiresAt?.toISOString() || null,
    })

    return { claimed: true, reason: 'executed', operation: await this.getOperation(operation.id) }
  }

  async executeQueuedOperation(operationId: string, recovery: Record<string, unknown> = {}) {
    const operation = await prisma.operation.findUnique({ where: { id: operationId } })
    if (!operation) {
      throw new Error('Operation not found')
    }
    const input = this.parseJson<Record<string, any>>(operation.inputJson, {})
    const userId = typeof input.userId === 'string' && input.userId ? input.userId : operation.userId

    switch (operation.type as OperationType) {
      case 'stock_screener_full_scan':
        await this.executeStockScreenerFullScanOperation(operation.id, {
          userId,
          query: typeof input.query === 'string' ? input.query : undefined,
          mode: input.mode === 'long_sample_dry_run' || input.mode === 'long_sample_full' ? input.mode : 'default',
          confirmedFullScan: input.confirmedFullScan === true,
          parentOperationId: typeof input.parentOperationId === 'string' ? input.parentOperationId : undefined,
        }, {
          resume: operation.status === 'running',
          recovery: {
            recoveredAt: new Date().toISOString(),
            resumePolicy: 'rerun_operation_with_idempotent_task_upserts',
            ...recovery,
          },
        })
        break
      case 'strategy_tournament_run':
        await this.executeStrategyTournamentRunOperation(operation.id, {
          userId,
          query: typeof input.query === 'string' ? input.query : undefined,
          maxScan: typeof input.maxScan === 'number' ? input.maxScan : undefined,
          backtestDays: typeof input.backtestDays === 'number' ? input.backtestDays : undefined,
          holdingDays: typeof input.holdingDays === 'number' ? input.holdingDays : undefined,
          chunkSize: typeof input.chunkSize === 'number' ? input.chunkSize : undefined,
          confirmedFullScan: input.confirmedFullScan === true,
          parentOperationId: typeof input.parentOperationId === 'string' ? input.parentOperationId : undefined,
        }, {
          resume: operation.status === 'running',
          recovery: {
            recoveredAt: new Date().toISOString(),
            resumePolicy: 'rerun_strategy_evidence_with_idempotent_task_upserts',
            ...recovery,
          },
        })
        break
      case 'batch_factset_refresh':
        await this.executeBatchFactsetRefreshOperation(operation.id, {
          userId,
          scope: input.scope === 'position_advice' || input.scope === 'stock_factset' ? input.scope : 'all',
          symbols: Array.isArray(input.symbols) ? input.symbols : [],
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          parentOperationId: typeof input.parentOperationId === 'string' ? input.parentOperationId : undefined,
        }, {
          resume: operation.status === 'running',
          recovery: {
            recoveredAt: new Date().toISOString(),
            resumePolicy: 'skip_completed_phase_tasks',
            ...recovery,
          },
        })
        break
      case 'quote_list_market_cap_warmup':
        await this.executeQuoteListMarketCapWarmupOperation(operation.id, {
          userId,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          chunkSize: typeof input.chunkSize === 'number' ? input.chunkSize : undefined,
          parentOperationId: typeof input.parentOperationId === 'string' ? input.parentOperationId : undefined,
        }, {
          resume: operation.status === 'running',
          recovery: {
            recoveredAt: new Date().toISOString(),
            resumePolicy: 'skip_completed_market_cap_chunks',
            ...recovery,
          },
        })
        break
      case 'market_bar_cache_preheat':
        await this.executeMarketBarCachePreheatOperation(operation.id, {
          userId,
          symbols: Array.isArray(input.symbols) ? input.symbols.map((symbol) => String(symbol)) : [],
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          days: typeof input.days === 'number' ? input.days : undefined,
          chunkSize: typeof input.chunkSize === 'number' ? input.chunkSize : undefined,
          concurrency: typeof input.concurrency === 'number' ? input.concurrency : undefined,
          forceRefresh: input.forceRefresh === true,
          parentOperationId: typeof input.parentOperationId === 'string' ? input.parentOperationId : undefined,
        }, {
          resume: operation.status === 'running',
          recovery: {
            recoveredAt: new Date().toISOString(),
            resumePolicy: 'skip_completed_market_bar_chunks',
            ...recovery,
          },
        })
        break
      case 'dividend_low_vol_daily_scan':
        await this.executeDividendLowVolDailyScanOperation(operation.id, {
          userId,
          symbols: Array.isArray(input.symbols) ? input.symbols.map((symbol) => String(symbol)) : [],
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          parentOperationId: typeof input.parentOperationId === 'string' ? input.parentOperationId : undefined,
          executionMode: 'queued',
        })
        break
      default:
        throw new Error(`Operation type ${operation.type} does not support worker execution`)
    }

    return this.getOperation(operation.id)
  }

  async startBatchFactsetRefreshOperation(input: BatchFactsetRefreshInput) {
    await ensureUser(prisma, input.userId)

    let operation
    try {
      operation = await prisma.operation.create({
        data: {
          parentOperationId: input.parentOperationId || null,
          userId: input.userId,
          type: 'batch_factset_refresh',
          status: 'queued',
          createdBy: input.createdBy || 'user',
          idempotencyKey: input.idempotencyKey || null,
          inputJson: JSON.stringify({
            userId: input.userId,
            scope: input.scope || 'all',
            symbols: input.symbols || [],
            limit: input.limit || null,
            parentOperationId: input.parentOperationId || null,
            createdBy: input.createdBy || 'user',
          }),
        },
      })
    } catch (error) {
      if (!input.idempotencyKey || !this.isUniqueConstraintError(error)) {
        throw error
      }
      const existingOperation = await prisma.operation.findFirst({
        where: {
          type: 'batch_factset_refresh',
          idempotencyKey: input.idempotencyKey,
        },
        orderBy: { requestedAt: 'desc' },
      })
      if (!existingOperation) throw error
      return this.getOperation(existingOperation.id)
    }

    void this.executeBatchFactsetRefreshOperation(operation.id, input)

    return this.getOperation(operation.id)
  }

  async startQuoteListMarketCapWarmupOperation(input: QuoteListMarketCapWarmupInput) {
    await ensureUser(prisma, input.userId)
    const limit = input.limit && input.limit > 0 ? Math.floor(input.limit) : 40
    const chunkSize = input.chunkSize && input.chunkSize > 0 ? Math.floor(input.chunkSize) : 10

    let operation
    try {
      operation = await prisma.operation.create({
        data: {
          parentOperationId: input.parentOperationId || null,
          userId: input.userId,
          type: 'quote_list_market_cap_warmup',
          status: 'queued',
          createdBy: input.createdBy || 'user',
          idempotencyKey: input.idempotencyKey || null,
          inputJson: JSON.stringify({
            userId: input.userId,
            limit,
            chunkSize,
            parentOperationId: input.parentOperationId || null,
            executionMode: input.executionMode || 'inline',
            createdBy: input.createdBy || 'user',
          }),
        },
      })
    } catch (error) {
      if (!input.idempotencyKey || !this.isUniqueConstraintError(error)) {
        throw error
      }
      const existingOperation = await prisma.operation.findFirst({
        where: {
          type: 'quote_list_market_cap_warmup',
          idempotencyKey: input.idempotencyKey,
        },
        orderBy: { requestedAt: 'desc' },
      })
      if (!existingOperation) throw error
      return this.getOperation(existingOperation.id)
    }

    if (input.executionMode !== 'queued') {
      void this.executeQuoteListMarketCapWarmupOperation(operation.id, {
        ...input,
        limit,
        chunkSize,
      })
    }

    return this.getOperation(operation.id)
  }

  async startMarketBarCachePreheatOperation(input: MarketBarCachePreheatInput) {
    await ensureUser(prisma, input.userId)
    const symbols = Array.from(new Set((Array.isArray(input.symbols) ? input.symbols : [])
      .map((symbol) => String(symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, ''))
      .filter(Boolean)))
    const limit = input.limit && input.limit > 0 ? Math.floor(input.limit) : 120
    const days = input.days && input.days > 0 ? Math.floor(input.days) : 120
    const chunkSize = input.chunkSize && input.chunkSize > 0 ? Math.floor(input.chunkSize) : 100
    const concurrency = input.concurrency && input.concurrency > 0 ? Math.floor(input.concurrency) : 4

    let operation
    try {
      operation = await prisma.operation.create({
        data: {
          parentOperationId: input.parentOperationId || null,
          userId: input.userId,
          type: 'market_bar_cache_preheat',
          status: 'queued',
          createdBy: input.createdBy || 'user',
          idempotencyKey: input.idempotencyKey || null,
          inputJson: JSON.stringify({
            userId: input.userId,
            symbols,
            limit,
            days,
            chunkSize,
            concurrency,
            forceRefresh: input.forceRefresh === true,
            parentOperationId: input.parentOperationId || null,
            executionMode: input.executionMode || 'inline',
            createdBy: input.createdBy || 'user',
          }),
        },
      })
    } catch (error) {
      if (!input.idempotencyKey || !this.isUniqueConstraintError(error)) {
        throw error
      }
      const existingOperation = await prisma.operation.findFirst({
        where: {
          type: 'market_bar_cache_preheat',
          idempotencyKey: input.idempotencyKey,
        },
        orderBy: { requestedAt: 'desc' },
      })
      if (!existingOperation) throw error
      return this.getOperation(existingOperation.id)
    }

    if (input.executionMode !== 'queued') {
      void this.executeMarketBarCachePreheatOperation(operation.id, {
        ...input,
        symbols,
        limit,
        days,
        chunkSize,
        concurrency,
      })
    }

    return this.getOperation(operation.id)
  }

  async startDividendLowVolDailyScanOperation(input: DividendLowVolDailyScanInput) {
    await ensureUser(prisma, input.userId)
    let operation
    try {
      operation = await prisma.operation.create({
        data: {
          parentOperationId: input.parentOperationId || null,
          userId: input.userId,
          type: 'dividend_low_vol_daily_scan',
          status: 'queued',
          createdBy: input.createdBy || 'user',
          idempotencyKey: input.idempotencyKey || null,
          inputJson: JSON.stringify({
            userId: input.userId,
            symbols: input.symbols || [],
            limit: input.limit || null,
            universe: input.universe || null,
            parentOperationId: input.parentOperationId || null,
            executionMode: input.executionMode || 'inline',
            createdBy: input.createdBy || 'user',
          }),
        },
      })
    } catch (error) {
      if (!input.idempotencyKey || !this.isUniqueConstraintError(error)) {
        throw error
      }
      const existingOperation = await prisma.operation.findFirst({
        where: {
          type: 'dividend_low_vol_daily_scan',
          idempotencyKey: input.idempotencyKey,
        },
        orderBy: { requestedAt: 'desc' },
      })
      if (!existingOperation) throw error
      return this.getOperation(existingOperation.id)
    }
    if (input.executionMode !== 'queued') {
      void this.executeDividendLowVolDailyScanOperation(operation.id, input)
    }
    return this.getOperation(operation.id)
  }

  async scheduleDueFactsetRefresh(input: DueFactsetRefreshInput) {
    await ensureUser(prisma, input.userId)

    const scope = input.scope || 'all'
    const stockFactsetLookbackDays = 80
    const stockFactsetTimeframe = '1d'
    const now = new Date()
    const cutoff = new Date(now.getTime() + Math.max(0, input.horizonMinutes || 0) * 60_000)
    const limit = input.limit && input.limit > 0 ? input.limit : 50
    const positions = await prisma.position.findMany({
      where: { userId: input.userId, status: 'open' },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    })

    const duePositionSymbols: string[] = []
    const dueStockSymbols: string[] = []
    const reasons: Array<{ scope: 'position_advice' | 'stock_factset'; symbol: string; reason: string }> = []

    if (scope !== 'stock_factset') {
      const caches = await prisma.positionAdviceCache.findMany({
        where: {
          userId: input.userId,
          positionId: { in: positions.map((position) => position.id) },
        },
      })
      const cacheByPositionId = new Map(caches.map((cache) => [cache.positionId, cache]))
      for (const position of positions) {
        if (duePositionSymbols.length >= limit) break
        const cache = cacheByPositionId.get(position.id)
        const reason = !cache
          ? 'missing_cache'
          : cache.status !== 'fresh'
            ? `status_${cache.status}`
            : cache.nextRefreshAfter <= cutoff
              ? 'refresh_due'
              : cache.generatedAt < position.updatedAt
                ? 'position_updated_after_cache'
                : null
        if (!reason) continue
        duePositionSymbols.push(position.asset.symbol.toUpperCase())
        reasons.push({ scope: 'position_advice', symbol: position.asset.symbol.toUpperCase(), reason })
      }
    }

    if (scope !== 'position_advice') {
      const stockPositions = positions.filter((position) => position.asset.type === 'stock')
      const stockSymbols = [...new Set(stockPositions.map((position) => position.asset.symbol.toUpperCase()))]
      const caches = await prisma.stockFactSetCache.findMany({
        where: {
          symbol: { in: stockSymbols },
          market: 'A股',
          factsetType: 'stock_full_analysis',
          factsetSchemaVersion: 'stock.analysis.factset.v1',
          lookbackDays: stockFactsetLookbackDays,
          timeframe: stockFactsetTimeframe,
        },
      })
      const cacheBySymbol = new Map(caches.map((cache) => [cache.symbol.toUpperCase(), cache]))
      for (const symbol of stockSymbols) {
        if (dueStockSymbols.length >= limit) break
        const cache = cacheBySymbol.get(symbol)
        const reason = !cache
          ? 'missing_cache'
          : cache.status !== 'fresh'
            ? `status_${cache.status}`
            : cache.nextRefreshAfter <= cutoff
              ? 'refresh_due'
              : null
        if (!reason) continue
        dueStockSymbols.push(symbol)
        reasons.push({ scope: 'stock_factset', symbol, reason })
      }
    }

    const symbols = [...new Set([...duePositionSymbols, ...dueStockSymbols])]
    const effectiveScope = duePositionSymbols.length > 0 && dueStockSymbols.length > 0
      ? 'split'
      : dueStockSymbols.length > 0
        ? 'stock_factset'
        : duePositionSymbols.length > 0
          ? 'position_advice'
          : scope
    const dueCount = symbols.length

    const activeOperation = await prisma.operation.findFirst({
      where: {
        userId: input.userId,
        type: 'batch_factset_refresh',
        status: { in: ['queued', 'running'] },
        cancelRequested: false,
      },
      orderBy: { requestedAt: 'desc' },
    })

    if (activeOperation && !input.force) {
      return {
        submitted: false,
        reason: 'active_operation_exists',
        operation: await this.getOperation(activeOperation.id),
        due: {
          scope,
          effectiveScope,
          dueCount,
          positionAdviceCount: duePositionSymbols.length,
          stockFactsetCount: dueStockSymbols.length,
          symbols,
          reasons,
          cutoff: cutoff.toISOString(),
        },
      }
    }

    if (dueCount === 0 || input.submit === false) {
      return {
        submitted: false,
        reason: dueCount === 0 ? 'no_due_factsets' : 'submit_disabled',
        operation: null,
        due: {
          scope,
          effectiveScope,
          dueCount,
          positionAdviceCount: duePositionSymbols.length,
          stockFactsetCount: dueStockSymbols.length,
          symbols,
          reasons,
          cutoff: cutoff.toISOString(),
        },
      }
    }

    const scheduledOperations = []
    if (duePositionSymbols.length > 0) {
      const positionSymbols = [...new Set(duePositionSymbols)]
      scheduledOperations.push(await this.startBatchFactsetRefreshOperation({
        userId: input.userId,
        scope: 'position_advice',
        symbols: positionSymbols,
        limit,
        createdBy: 'scheduler',
        idempotencyKey: `due-factsets:${input.userId}:${now.toISOString().slice(0, 16)}:position_advice`,
      }))
    }
    if (dueStockSymbols.length > 0) {
      scheduledOperations.push(await this.startBatchFactsetRefreshOperation({
        userId: input.userId,
        scope: 'stock_factset',
        symbols: dueStockSymbols,
        limit,
        createdBy: 'scheduler',
        idempotencyKey: `due-factsets:${input.userId}:${now.toISOString().slice(0, 16)}:stock_factset`,
      }))
    }

    return {
      submitted: true,
      reason: 'submitted',
      operation: scheduledOperations[0] || null,
      operations: scheduledOperations,
      due: {
        scope,
        effectiveScope,
        submittedScopes: scheduledOperations.map((operation) => {
          const operationInput = operation.input as { scope?: string }
          return operationInput.scope || 'all'
        }),
        dueCount,
        positionAdviceCount: duePositionSymbols.length,
        stockFactsetCount: dueStockSymbols.length,
        symbols,
        reasons,
        cutoff: cutoff.toISOString(),
      },
    }
  }

  async recoverInterruptedOperations() {
    const now = new Date()
    const recoverable = await prisma.operation.findMany({
      where: {
        type: { in: ['batch_factset_refresh', 'stock_screener_full_scan', 'strategy_tournament_run', 'quote_list_market_cap_warmup', 'market_bar_cache_preheat', 'dividend_low_vol_daily_scan'] },
        status: { in: ['queued', 'running'] },
        cancelRequested: false,
        OR: [
          { status: 'queued' },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { requestedAt: 'asc' },
      take: 10,
    })

    for (const operation of recoverable) {
      void this.executeQueuedOperation(operation.id, {
          recoveredAt: new Date().toISOString(),
          reason: 'server_startup',
          previousStatus: operation.status,
          previousLeaseOwner: operation.leaseOwner || null,
          previousLeaseExpiresAt: operation.leaseExpiresAt?.toISOString() || null,
      })
    }

    return { recoveredCount: recoverable.length, operationIds: recoverable.map((operation) => operation.id) }
  }

  async retryOperation(operationId: string) {
    const sourceOperation = await prisma.operation.findUnique({
      where: { id: operationId },
    })

    if (!sourceOperation) {
      throw new Error('Operation not found')
    }

    if (!['failed', 'cancelled', 'partial'].includes(sourceOperation.status)) {
      throw new Error('Only failed, cancelled or partial operations can be retried')
    }

    const input = this.parseJson<Record<string, any>>(sourceOperation.inputJson, {})
    const userId = typeof input.userId === 'string' && input.userId ? input.userId : sourceOperation.userId

    switch (sourceOperation.type as OperationType) {
      case 'refresh_prices':
        return this.startRefreshPricesOperation({
          userId,
          assetIds: Array.isArray(input.assetIds) ? input.assetIds : [],
          symbols: Array.isArray(input.symbols) ? input.symbols : [],
          parentOperationId: sourceOperation.id,
        })
      case 'check_alerts':
        return this.startCheckAlertsOperation({
          userId,
          refreshPrices: input.refreshPrices !== false,
          parentOperationId: sourceOperation.id,
        })
      case 'generate_daily_advice':
        return this.startGenerateDailyAdviceOperation({
          userId,
          query: typeof input.query === 'string' ? input.query : undefined,
          scope: input.scope === 'asset' || input.scope === 'sector' ? input.scope : 'all',
          parentOperationId: sourceOperation.id,
        })
      case 'run_backtest':
        if (typeof input.adviceId !== 'string' || !input.adviceId) {
          throw new Error('Cannot retry backtest operation without adviceId')
        }
        return this.startRunBacktestOperation({
          userId,
          adviceId: input.adviceId,
          startDate: typeof input.startDate === 'string' ? input.startDate : undefined,
          endDate: typeof input.endDate === 'string' ? input.endDate : undefined,
          initialCapital: typeof input.initialCapital === 'number' ? input.initialCapital : undefined,
          parentOperationId: sourceOperation.id,
        })
      case 'stock_screener_full_scan':
        return this.startStockScreenerFullScanOperation({
          userId,
          query: typeof input.query === 'string' ? input.query : undefined,
          mode: input.mode === 'long_sample_dry_run' || input.mode === 'long_sample_full' ? input.mode : 'default',
          confirmedFullScan: input.confirmedFullScan === true,
          parentOperationId: sourceOperation.id,
        })
      case 'strategy_tournament_run':
        return this.startStrategyTournamentRunOperation({
          userId,
          query: typeof input.query === 'string' ? input.query : undefined,
          maxScan: typeof input.maxScan === 'number' ? input.maxScan : undefined,
          backtestDays: typeof input.backtestDays === 'number' ? input.backtestDays : undefined,
          holdingDays: typeof input.holdingDays === 'number' ? input.holdingDays : undefined,
          chunkSize: typeof input.chunkSize === 'number' ? input.chunkSize : undefined,
          confirmedFullScan: input.confirmedFullScan === true,
          parentOperationId: sourceOperation.id,
        })
      case 'batch_factset_refresh':
        return this.startBatchFactsetRefreshOperation({
          userId,
          scope: input.scope === 'position_advice' || input.scope === 'stock_factset' ? input.scope : 'all',
          symbols: Array.isArray(input.symbols) ? input.symbols : [],
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          parentOperationId: sourceOperation.id,
        })
      case 'quote_list_market_cap_warmup':
        return this.startQuoteListMarketCapWarmupOperation({
          userId,
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          chunkSize: typeof input.chunkSize === 'number' ? input.chunkSize : undefined,
          parentOperationId: sourceOperation.id,
        })
      case 'market_bar_cache_preheat':
        return this.startMarketBarCachePreheatOperation({
          userId,
          symbols: Array.isArray(input.symbols) ? input.symbols.map((symbol) => String(symbol)) : [],
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          days: typeof input.days === 'number' ? input.days : undefined,
          chunkSize: typeof input.chunkSize === 'number' ? input.chunkSize : undefined,
          concurrency: typeof input.concurrency === 'number' ? input.concurrency : undefined,
          forceRefresh: input.forceRefresh === true,
          parentOperationId: sourceOperation.id,
        })
      case 'dividend_low_vol_daily_scan':
        return this.startDividendLowVolDailyScanOperation({
          userId,
          symbols: Array.isArray(input.symbols) ? input.symbols.map((symbol) => String(symbol)) : [],
          limit: typeof input.limit === 'number' ? input.limit : undefined,
          parentOperationId: sourceOperation.id,
          executionMode: input.executionMode === 'queued' ? 'queued' : 'inline',
        })
      default:
        throw new Error(`Operation type ${sourceOperation.type} does not support retry`)
    }
  }

  async cancelOperation(operationId: string) {
    const operation = await prisma.operation.findUnique({
      where: { id: operationId },
    })

    if (!operation) {
      throw new Error('Operation not found')
    }

    if (operation.status !== 'queued' && operation.status !== 'running' && operation.status !== 'cancelling') {
      throw new Error('Only queued or running operations can be cancelled')
    }

    const now = new Date()
    const hasActiveLease = Boolean(operation.leaseOwner && operation.leaseToken && operation.leaseExpiresAt && operation.leaseExpiresAt > now)

    if (operation.status === 'queued' || !hasActiveLease) {
      await prisma.operation.updateMany({
        where: {
          id: operationId,
          status: { in: ['queued', 'running', 'cancelling'] },
          OR: [
            { status: 'queued' },
            { leaseOwner: null },
            { leaseToken: null },
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lt: now } },
          ],
        },
        data: {
          status: 'cancelled',
          cancelRequested: true,
          completedAt: now,
          progressPct: 100,
          progressCurrent: 100,
          progressTotal: 100,
          progressMessage: '任务已取消',
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          heartbeatAt: now,
          errorSummary: 'Operation cancelled by user',
          errorJson: JSON.stringify({
            message: 'Operation cancelled by user',
          }),
        },
      })
      await prisma.operationTask.updateMany({
        where: { operationId, status: { in: ['queued', 'running'] } },
        data: {
          status: 'cancelled',
          completedAt: now,
          errorJson: JSON.stringify({ message: 'Operation cancelled by user' }),
        },
      })
      return this.getOperation(operationId)
    }

    await prisma.operation.updateMany({
      where: {
        id: operationId,
        status: { in: ['running', 'cancelling'] },
        leaseOwner: operation.leaseOwner,
        leaseToken: operation.leaseToken,
      },
      data: {
        status: 'cancelling',
        cancelRequested: true,
        progressMessage: '任务取消中',
        heartbeatAt: now,
      },
    })

    return this.getOperation(operationId)
  }

  async listOperations(params: {
    userId: string
    type?: OperationType
    status?: OperationStatus
    limit?: number
  }) {
    const operations = await prisma.operation.findMany({
      where: {
        userId: params.userId,
        ...(params.type ? { type: params.type } : {}),
        ...(params.status ? { status: params.status } : {}),
      },
      orderBy: { requestedAt: 'desc' },
      take: params.limit || 20,
      include: { tasks: { orderBy: [{ createdAt: 'asc' }, { chunkIndex: 'asc' }] } },
    })

    return operations.map((operation) => this.toOperationDto(operation))
  }
}

export const operationService = new OperationService()
