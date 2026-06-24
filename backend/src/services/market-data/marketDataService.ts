import { prisma } from '../../db/prisma.js'
import { priceService } from '../price/priceService.js'
import { assetIdentityResolver } from '../asset/assetIdentityResolver.js'

export type MarketDataCapability = 'quote' | 'history' | 'fund_holdings'
export type MarketDataSource = 'yahoo' | 'eastmoney' | 'sina' | 'auto'

interface MarketDataProviderDescriptor {
  key: Exclude<MarketDataSource, 'auto'> | 'tiantian' | 'manual' | 'goldFund' | 'kitco'
  label: string
  capabilities: MarketDataCapability[]
  markets: string[]
  assetTypes: string[]
}

interface ProviderStats {
  successes: number
  failures: number
  fallbackHits: number
  consecutiveFailures: number
  lastSuccessAt?: string
  lastFailureAt?: string
  lastError?: string
  circuitOpenUntil?: string
}

export interface QuoteRequest {
  symbol: string
  assetType?: string
  source?: MarketDataSource
}

export interface QuoteResult {
  symbol: string
  name?: string
  assetType?: string
  price: number | null
  priceChange: number
  priceChangePercent: number
  currency: string | null
  timestamp: string | null
  source: string | null
  sourceLabel: string | null
  isValid: boolean
  warnings: string[]
  warningDetails: Array<{
    code: string
    severity: 'info' | 'warning' | 'danger'
    message: string
  }>
  confidenceScore: number
  fallbackUsed: boolean
  requestedProviders: string[]
  resolvedProviders: string[]
  providerHealth: Array<{
    provider: string
    label: string
    status: 'used' | 'fallback' | 'compared' | 'unavailable'
  }>
  providerComparisons: Array<{
    source: string
    price: number
    deviationPercent: number
  }>
}

export interface RefreshMarketDataRequest {
  assetIds?: string[]
  symbols?: string[]
  userId?: string
}

export interface RefreshMarketDataResult {
  refreshed: number
  failed: number
  externalRefreshed: number
  realtimeRefreshed: number
  retainedLocalPrices: number
  results: Array<{
    assetId: string
    symbol: string
    success: boolean
    price?: number
    source?: string
    updatedAt?: Date
    isValid?: boolean
    previousPrice?: number
    priceChangeFromPreviousPercent?: number
    abnormalPriceJump?: boolean
    warnings: string[]
    fallbackUsed?: boolean
    stale?: boolean
    errorCode?: string
    errorCategory?: 'network' | 'empty_data' | 'unsupported_symbol' | 'invalid_price' | 'validation_failed' | 'provider_failure'
    error?: string
  }>
  summary: {
    warnings: string[]
    providerSummary: Array<{
      provider: string
      label: string
      successes: number
      failures: number
      fallbackHits: number
      healthScore: number
      status: 'healthy' | 'degraded' | 'failing' | 'unknown'
    }>
  }
}

export interface ProviderHealthSummaryItem {
  provider: string
  label: string
  successes: number
  failures: number
  fallbackHits: number
  healthScore: number
  status: 'healthy' | 'degraded' | 'failing' | 'unknown'
}

interface ClassifiedProviderError {
  code: string
  category: 'network' | 'empty_data' | 'unsupported_symbol' | 'invalid_price' | 'validation_failed' | 'provider_failure'
  message: string
}

interface PositionRefreshUpdate {
  positionId: string
  currentPrice: number
  quantity?: number
  avgCost?: number
  marketValue: number
  costBasis?: number
  unrealizedPnl: number
}

class MarketDataService {
  private readonly providers: MarketDataProviderDescriptor[] = [
    {
      key: 'yahoo',
      label: 'Yahoo Finance',
      capabilities: ['quote'],
      markets: ['US', 'HK', 'global'],
      assetTypes: ['stock', 'etf', 'gold'],
    },
    {
      key: 'eastmoney',
      label: 'Eastmoney',
      capabilities: ['quote', 'history', 'fund_holdings'],
      markets: ['CN'],
      assetTypes: ['stock', 'fund', 'etf', 'bond', 'gold'],
    },
    {
      key: 'sina',
      label: 'Sina Finance',
      capabilities: ['quote'],
      markets: ['CN'],
      assetTypes: ['stock', 'fund', 'etf'],
    },
    {
      key: 'tiantian',
      label: 'Tiantian Fund',
      capabilities: ['quote', 'fund_holdings'],
      markets: ['CN'],
      assetTypes: ['fund', 'etf'],
    },
    {
      key: 'goldFund',
      label: 'Gold ETF Derived Source',
      capabilities: ['quote'],
      markets: ['CN'],
      assetTypes: ['gold'],
    },
    {
      key: 'kitco',
      label: 'Kitco',
      capabilities: ['quote'],
      markets: ['global'],
      assetTypes: ['gold'],
    },
    {
      key: 'manual',
      label: 'Manual',
      capabilities: ['quote'],
      markets: ['local'],
      assetTypes: ['cash'],
    },
  ]
  private readonly providerStats = new Map<string, ProviderStats>()

  listProviders() {
    return this.providers.map((provider) => ({
      ...provider,
      health: this.getProviderHealthSnapshot(provider.key),
    }))
  }

  getProviderHealthSummary(): ProviderHealthSummaryItem[] {
    return this.providers.map((provider) => {
      const health = this.getProviderHealthSnapshot(provider.key)
      return {
        provider: provider.key,
        label: provider.label,
        successes: health.successes,
        failures: health.failures,
        fallbackHits: health.fallbackHits,
        healthScore: health.healthScore,
        status: health.status as 'healthy' | 'degraded' | 'failing' | 'unknown',
      }
    })
  }

  private getOrCreateProviderStats(providerKey: string) {
    const stats = this.providerStats.get(providerKey) || {
      successes: 0,
      failures: 0,
      fallbackHits: 0,
      consecutiveFailures: 0,
    }
    this.providerStats.set(providerKey, stats)
    return stats
  }

  private recordProviderSuccess(providerKey: string) {
    const stats = this.getOrCreateProviderStats(providerKey)
    stats.successes += 1
    stats.consecutiveFailures = 0
    stats.lastSuccessAt = new Date().toISOString()
    stats.circuitOpenUntil = undefined
  }

  private recordProviderFailure(providerKey: string, error?: string) {
    const stats = this.getOrCreateProviderStats(providerKey)
    stats.failures += 1
    stats.consecutiveFailures += 1
    stats.lastFailureAt = new Date().toISOString()
    stats.lastError = error
    if (stats.consecutiveFailures >= 3) {
      stats.circuitOpenUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString()
    }
  }

  private recordProviderFallback(providerKey: string) {
    const stats = this.getOrCreateProviderStats(providerKey)
    stats.fallbackHits += 1
  }

  private getProviderHealthSnapshot(providerKey: string) {
    const stats = this.providerStats.get(providerKey) || {
      successes: 0,
      failures: 0,
      fallbackHits: 0,
      consecutiveFailures: 0,
    }
    const total = stats.successes + stats.failures
    const healthScore = total > 0 ? stats.successes / total : 0
    const circuitOpen = Boolean(stats.circuitOpenUntil && new Date(stats.circuitOpenUntil).getTime() > Date.now())
    const status = circuitOpen
      ? 'failing'
      : total === 0
      ? 'unknown'
      : healthScore >= 0.85
      ? 'healthy'
      : healthScore >= 0.5
      ? 'degraded'
      : 'failing'

    return {
      successes: stats.successes,
      failures: stats.failures,
      fallbackHits: stats.fallbackHits,
      consecutiveFailures: stats.consecutiveFailures,
      lastSuccessAt: stats.lastSuccessAt || null,
      lastFailureAt: stats.lastFailureAt || null,
      lastError: stats.lastError || null,
      circuitOpenUntil: stats.circuitOpenUntil || null,
      healthScore,
      status,
    }
  }

  private classifyProviderError(
    providerKey: string,
    input: QuoteRequest,
    error: unknown
  ): ClassifiedProviderError {
    const rawMessage = error instanceof Error ? error.message : 'Unknown provider error'
    const normalized = rawMessage.toLowerCase()

    if (
      normalized.includes('timeout') ||
      normalized.includes('econnreset') ||
      normalized.includes('socket hang up') ||
      normalized.includes('network') ||
      normalized.includes('503') ||
      normalized.includes('403')
    ) {
      return {
        code: 'PROVIDER_NETWORK_FAILURE',
        category: 'network',
        message: `${this.getProviderLabel(providerKey)} 网络或访问受限`,
      }
    }

    if (
      normalized.includes('unsupported') ||
      normalized.includes('does not have real-time price')
    ) {
      return {
        code: 'PROVIDER_UNSUPPORTED_SYMBOL',
        category: 'unsupported_symbol',
        message: `${this.getProviderLabel(providerKey)} 不支持 ${input.symbol} (${input.assetType || 'unknown'})`,
      }
    }

    if (
      normalized.includes('no data') ||
      normalized.includes('failed to fetch fund price') ||
      normalized.includes('failed to fetch bond price') ||
      normalized.includes('failed to fetch a-share price')
    ) {
      return {
        code: 'PROVIDER_EMPTY_DATA',
        category: 'empty_data',
        message: `${this.getProviderLabel(providerKey)} 未返回可用行情数据`,
      }
    }

    if (normalized.includes('empty price') || normalized.includes('invalid price')) {
      return {
        code: 'PROVIDER_INVALID_PRICE',
        category: 'invalid_price',
        message: `${this.getProviderLabel(providerKey)} 返回了无效价格`,
      }
    }

    return {
      code: 'PROVIDER_FAILURE',
      category: 'provider_failure',
      message: `${this.getProviderLabel(providerKey)} 获取行情失败`,
    }
  }

  private classifyRefreshError(assetType: string | undefined, error: unknown): ClassifiedProviderError {
    const rawMessage = error instanceof Error ? error.message : 'Unknown refresh error'
    const match = rawMessage.match(/^\[([A-Z_]+)\]\s*(.+)$/)
    if (match) {
      const code = match[1]
      const category = code === 'PROVIDER_NETWORK_FAILURE'
        ? 'network'
        : code === 'PROVIDER_EMPTY_DATA'
        ? 'empty_data'
        : code === 'PROVIDER_UNSUPPORTED_SYMBOL'
        ? 'unsupported_symbol'
        : code === 'PROVIDER_INVALID_PRICE'
        ? 'invalid_price'
        : code === 'POST_REFRESH_VALIDATION_FAILED'
        ? 'validation_failed'
        : 'provider_failure'
      return { code, category, message: match[2] || rawMessage }
    }

    if (assetType === 'cash' && rawMessage.toLowerCase().includes('real-time price')) {
      return {
        code: 'PROVIDER_UNSUPPORTED_SYMBOL',
        category: 'unsupported_symbol',
        message: '现金资产应使用 manual provider，不应走实时行情接口',
      }
    }

    return {
      code: 'PROVIDER_FAILURE',
      category: 'provider_failure',
      message: rawMessage,
    }
  }

  private isCircuitOpen(providerKey: string) {
    const snapshot = this.getProviderHealthSnapshot(providerKey)
    return Boolean(snapshot.circuitOpenUntil && new Date(snapshot.circuitOpenUntil).getTime() > Date.now())
  }

  private applyProviderPolicy(input: QuoteRequest, providers: string[]) {
    const mainlandLike = input.assetType === 'fund' ||
      input.assetType === 'etf' ||
      input.assetType === 'bond' ||
      input.assetType === 'cash' ||
      input.assetType === 'gold' ||
      /^\d{6}$/.test(input.symbol) ||
      /^\d{4,5}$/.test(input.symbol) ||
      input.symbol.endsWith('.HK')

    let ordered = [...providers]

    if (mainlandLike) {
      const preferredOrder = (
        (input.assetType === 'fund' || input.assetType === 'bond') &&
        !this.isExchangeTradedFundCode(input.symbol)
      )
        ? ['tiantian', 'eastmoney', 'sina', 'yahoo', 'manual', 'goldFund', 'kitco']
        : ['sina', 'eastmoney', 'tiantian', 'goldFund', 'manual', 'kitco', 'yahoo']
      ordered = preferredOrder.filter((provider) => ordered.includes(provider))
    }

    const available = ordered.filter((provider) => !this.isCircuitOpen(provider))
    return available.length > 0 ? available : ordered
  }

  private getCandidateProviders(input: QuoteRequest) {
    if (input.source && input.source !== 'auto') {
      return [input.source]
    }

    if ((input.assetType === 'fund' || input.assetType === 'etf') && this.isExchangeTradedFundCode(input.symbol)) {
      return ['eastmoney', 'sina', 'tiantian']
    }
    if (input.assetType === 'fund' || input.assetType === 'etf') {
      return ['tiantian', 'eastmoney']
    }
    if (input.assetType === 'bond') {
      return ['eastmoney', 'tiantian', 'yahoo']
    }
    if (input.assetType === 'cash') {
      return ['manual']
    }
    if (input.assetType === 'gold') {
      return ['goldFund', 'kitco', 'yahoo']
    }
    if (/^\d{6}$/.test(input.symbol)) {
      return ['eastmoney', 'sina']
    }
    return ['yahoo', 'eastmoney', 'sina']
  }

  private isExchangeTradedFundCode(symbol: string): boolean {
    return /^(159|510|511|512|513|515|516|517|518|520|560|561|562|563|588|589)\d{3}$/.test(symbol)
  }

  private getProviderLabel(source: string | null | undefined) {
    if (!source) return null
    const firstSource = source.split(',')[0]
    return this.providers.find((provider) => provider.key === firstSource)?.label || firstSource
  }

  private buildProviderHealth(
    requestedProviders: string[],
    resolvedProviders: string[],
    primaryResolvedProvider: string | null
  ) {
    const comparedProviders = new Set(resolvedProviders)
    return requestedProviders.map((providerKey, index) => {
      const descriptor = this.providers.find((provider) => provider.key === providerKey)
      const used = primaryResolvedProvider === providerKey
      const compared = comparedProviders.has(providerKey)
      const fallback = used && index > 0
      return {
        provider: providerKey,
        label: descriptor?.label || providerKey,
        status: (used ? (fallback ? 'fallback' : 'used') : compared ? 'compared' : 'unavailable') as 'used' | 'fallback' | 'compared' | 'unavailable',
      }
    })
  }

  private async fetchQuoteFromProvider(providerKey: string, input: QuoteRequest) {
    if (providerKey === 'manual') {
      return priceService.getManualCashQuote(input.symbol, input.symbol)
    }
    if (providerKey === 'tiantian') {
      if (input.assetType === 'bond') {
        return priceService.getFundPriceFromTiantianAsStock(input.symbol)
      }
      return priceService.getFundPriceFromTiantianAsStock(input.symbol)
    }
    if (providerKey === 'goldFund') {
      return priceService.getRealTimePrice(input.symbol, 'auto', 'gold')
    }
    if (providerKey === 'kitco') {
      return priceService.getRealTimePrice(input.symbol, 'auto', 'gold')
    }
    if (providerKey === 'eastmoney' && (input.assetType === 'fund' || input.assetType === 'etf')) {
      return priceService.getFundPriceFromEastmoneyAsStock(input.symbol)
    }
    if (providerKey === 'eastmoney' && input.assetType === 'bond') {
      return priceService.getBondPriceFromEastmoneyAsStock(input.symbol)
    }
    if (providerKey === 'yahoo' && input.assetType === 'bond') {
      return priceService.getBondPriceFromYahooAsStock(input.symbol)
    }
    return priceService.getQuoteFromSource(
      input.symbol,
      providerKey as 'yahoo' | 'eastmoney' | 'sina',
      input.assetType
    )
  }

  async getQuote(input: QuoteRequest): Promise<QuoteResult> {
    const requestedProviders = this.applyProviderPolicy(input, this.getCandidateProviders(input))
    const warnings: string[] = []
    const warningDetails: QuoteResult['warningDetails'] = []
    let quote: Awaited<ReturnType<typeof priceService.getRealTimePrice>> | null = null
    let primaryResolvedProvider: string | null = null
    let lastError: Error | null = null
    const providerErrors: string[] = []

    for (const providerKey of requestedProviders) {
      if (this.isCircuitOpen(providerKey) && requestedProviders.length > 1) {
        warningDetails.push({
          code: 'PROVIDER_CIRCUIT_OPEN',
          severity: 'warning',
          message: `${this.getProviderLabel(providerKey)} 暂时熔断，已跳过。`,
        })
        continue
      }

      try {
        quote = await this.fetchQuoteFromProvider(providerKey, input)
        primaryResolvedProvider = providerKey
        this.recordProviderSuccess(providerKey)
        break
      } catch (error) {
        const classified = this.classifyProviderError(providerKey, input, error)
        lastError = new Error(`[${classified.code}] ${classified.message}`)
        providerErrors.push(lastError.message)
        this.recordProviderFailure(providerKey, lastError.message)
      }
    }

    if (!quote) {
      throw new Error(providerErrors[providerErrors.length - 1] || lastError?.message || `Failed to fetch quote for ${input.symbol}`)
    }

    const providerComparisons = quote.crossValidation || []
    const resolvedProviders = [
      ...(quote.source ? quote.source.split(',').map((item) => item.trim()).filter(Boolean) : []),
      ...providerComparisons.map((item) => item.source),
    ]

    if (!quote.isValid) {
      warnings.push('行情校验未通过，建议结合其他来源确认。')
      warningDetails.push({
        code: 'QUOTE_VALIDATION_FAILED',
        severity: 'warning',
        message: '行情校验未通过，建议结合其他来源确认。',
      })
    }
    if (providerComparisons.some((item) => item.deviationPercent >= 0.5)) {
      warnings.push('多数据源价格存在偏差。')
      warningDetails.push({
        code: 'QUOTE_PROVIDER_DEVIATION',
        severity: 'warning',
        message: '多数据源价格存在偏差。',
      })
    }

    const maxDeviation = providerComparisons.length > 0
      ? Math.max(...providerComparisons.map((item) => item.deviationPercent))
      : 0
    const fallbackUsed = Boolean(
      primaryResolvedProvider &&
      requestedProviders.length > 0 &&
      requestedProviders[0] !== primaryResolvedProvider
    )
    if (fallbackUsed) {
      warnings.push(`主数据源未命中，已回退到 ${this.getProviderLabel(primaryResolvedProvider)}。`)
      warningDetails.push({
        code: 'QUOTE_FALLBACK_USED',
        severity: 'info',
        message: `主数据源未命中，已回退到 ${this.getProviderLabel(primaryResolvedProvider)}。`,
      })
      if (primaryResolvedProvider) {
        this.recordProviderFallback(primaryResolvedProvider)
      }
    }

    const confidenceScore = quote.isValid
      ? Math.max(0.3, 1 - maxDeviation / 100)
      : Math.max(0.1, 0.6 - maxDeviation / 100)

    return {
      symbol: quote.symbol,
      name: quote.name,
      assetType: input.assetType,
      price: quote.price ?? null,
      priceChange: quote.priceChange,
      priceChangePercent: quote.priceChangePercent,
      currency: null,
      timestamp: quote.timestamp?.toISOString?.() || null,
      source: quote.source || null,
      sourceLabel: this.getProviderLabel(quote.source),
      isValid: quote.isValid,
      warnings,
      warningDetails,
      confidenceScore,
      fallbackUsed,
      requestedProviders,
      resolvedProviders,
      providerHealth: this.buildProviderHealth(requestedProviders, resolvedProviders, primaryResolvedProvider),
      providerComparisons,
    }
  }

  async getHistory(params: {
    assetId: string
    startDate: Date
    endDate: Date
    page?: number
    pageSize?: number
  }) {
    return priceService.getPriceHistory(
      params.assetId,
      params.startDate,
      params.endDate,
      { page: params.page, pageSize: params.pageSize }
    )
  }

  async getFundHoldings(fundCode: string) {
    return priceService.getFundHoldings(fundCode)
  }

  async refreshAssetMarketData(input: RefreshMarketDataRequest) {
    const where: Record<string, unknown> = {}

    if (input.assetIds?.length) {
      where.id = { in: input.assetIds }
    } else if (input.symbols?.length) {
      where.symbol = { in: input.symbols }
    } else if (input.userId) {
      where.positions = { some: { userId: input.userId, status: 'open' } }
    }

    const assets = await prisma.asset.findMany({ where })
    const results: RefreshMarketDataResult['results'] = await Promise.all(assets.map(async (asset) => {
      const identity = await assetIdentityResolver.resolve(asset.symbol)
      const resolvedAssetType = ['gold', 'cash'].includes(asset.type)
        ? asset.type
        : identity.assetType !== 'unknown'
          ? identity.assetType
          : asset.type
      try {
        const quote = await Promise.race([
          this.getQuote({
            symbol: asset.symbol,
            assetType: resolvedAssetType,
          }),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error('Quote request timed out after 8 seconds')), 8000)
          }),
        ])

        if (quote.price == null || !quote.timestamp) {
          throw new Error('Quote returned empty price or timestamp')
        }
        const jumpCheck = this.checkPriceJump(asset.lastPrice, quote.price, resolvedAssetType)
        if (jumpCheck.abnormalPriceJump) {
          throw this.validationError(jumpCheck.warning || `${asset.symbol} 价格跳变超过阈值`)
        }
        const identityWarnings = ['gold', 'cash'].includes(asset.type)
          ? (identity.warnings || []).filter((warning) => !warning.includes('本地资产类型为'))
          : identity.warnings || []
        const warnings = [...new Set([
          ...(quote.warnings || []),
          ...identityWarnings,
          ...(jumpCheck.warning ? [jumpCheck.warning] : []),
        ])]

        const positionUpdates = await this.buildValidatedPositionRefreshUpdates(asset.id, quote.price, quote.source || 'unknown')

        await priceService.persistResolvedQuote(asset.id, {
          symbol: asset.symbol,
          name: quote.name,
          price: quote.price,
          priceChange: quote.priceChange,
          priceChangePercent: quote.priceChangePercent,
          timestamp: new Date(quote.timestamp),
          source: quote.source || 'unknown',
          isValid: quote.isValid,
          crossValidation: quote.providerComparisons.map((item) => ({
            source: item.source,
            price: item.price,
            deviationPercent: item.deviationPercent,
          })),
        })
        await this.applyPositionRefreshUpdates(positionUpdates)

        return {
          assetId: asset.id,
          symbol: asset.symbol,
          success: true,
          price: quote.price,
          source: quote.source || undefined,
          updatedAt: new Date(quote.timestamp),
          isValid: quote.isValid,
          previousPrice: jumpCheck.previousPrice,
          priceChangeFromPreviousPercent: jumpCheck.priceChangePercent,
          abnormalPriceJump: jumpCheck.abnormalPriceJump,
          warnings,
        }
      } catch (error) {
        const classified = this.classifyRefreshError(asset.type, error)
        const retainedPrice = asset.lastPrice ?? await this.getRetainedPositionPrice(asset.id)
        if (retainedPrice != null) {
          await this.applyRetainedPriceToOpenPositions(asset.id, retainedPrice, true)
          if (asset.lastPrice == null) {
            await prisma.asset.update({
              where: { id: asset.id },
              data: {
                lastPrice: retainedPrice,
              },
            })
          }
          return {
            assetId: asset.id,
            symbol: asset.symbol,
            success: false,
            price: retainedPrice,
            source: 'local_last_price',
            updatedAt: asset.lastUpdated || undefined,
            isValid: false,
            fallbackUsed: true,
            stale: true,
            errorCode: classified.code,
            errorCategory: classified.category,
            error: `${classified.message}；已保留本地最近可信价，不计入实时刷新成功。`,
            warnings: [
              ...identity.warnings,
              classified.message,
              '外部行情刷新失败，已保留本地最近可信价；该价格可能不是最新价。',
            ],
          }
        }
        return {
          assetId: asset.id,
          symbol: asset.symbol,
          success: false,
          warnings: [],
          errorCode: classified.code,
          errorCategory: classified.category,
          error: classified.message,
        }
      }
    }))

    const realtimeRefreshed = results.filter((item) => item.success && !item.stale).length
    const retainedLocalPrices = results.filter((item) => item.fallbackUsed && item.stale).length
    const result = {
      refreshed: realtimeRefreshed,
      failed: results.filter((item) => !item.success).length,
      externalRefreshed: realtimeRefreshed,
      realtimeRefreshed,
      retainedLocalPrices,
      results,
    }

    const warningSet = new Set<string>()
    if (result.failed > 0) {
      warningSet.add(`本次刷新存在 ${result.failed} 个失败项，建议检查数据源健康度。`)
    }
    if (result.results.some((item) => (item.warnings || []).length > 0)) {
      warningSet.add('部分资产刷新返回了额外警告。')
    }
    if (retainedLocalPrices > 0) {
      warningSet.add(`本次有 ${retainedLocalPrices} 个标的未取得实时行情，仅保留本地最近可信价，不计入刷新成功。`)
    }
    const abnormalJumpCount = result.results.filter((item) => item.abnormalPriceJump).length
    if (abnormalJumpCount > 0) {
      warningSet.add(`本次有 ${abnormalJumpCount} 个标的价格相对上一可信价跳变超过阈值，请检查来源和行情时间。`)
    }

    return {
      ...result,
      summary: {
        warnings: Array.from(warningSet),
        providerSummary: this.getProviderHealthSummary(),
      },
    } satisfies RefreshMarketDataResult
  }

  private validationError(message: string) {
    return new Error(`[POST_REFRESH_VALIDATION_FAILED] ${message}`)
  }

  private assertFinitePositive(value: number | null | undefined, message: string) {
    if (value === null || value === undefined || !Number.isFinite(value) || value <= 0) {
      throw this.validationError(`${message}: ${value}`)
    }
  }

  private assertClose(actual: number, expected: number, message: string, tolerance = 0.02) {
    if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
      throw this.validationError(`${message}: expected ${expected.toFixed(4)}, got ${actual}`)
    }
  }

  private validateQuoteForAssetType(assetType: string, price: number, source: string) {
    this.assertFinitePositive(price, `${assetType} 行情价格无效`)

    if (assetType === 'cash') {
      if (source !== 'manual' || Math.abs(price - 1) > 0.000001) {
        throw this.validationError(`现金资产只能使用 manual provider 且价格必须为 1，当前 source=${source}, price=${price}`)
      }
      return
    }

    if (assetType === 'gold') {
      if (source === 'sina' || source === 'eastmoney_nav' || source === 'tiantian') {
        throw this.validationError(`黄金资产不能使用股票/基金行情源 ${source}`)
      }
      if (price < 200 || price > 2000) {
        throw this.validationError(`黄金价格必须是元/克口径，当前 price=${price}`)
      }
      return
    }

    if ((assetType === 'stock' || assetType === 'etf') && (source === 'manual' || source === 'goldFund' || source === 'kitco')) {
      throw this.validationError(`${assetType} 不能使用 ${source} 行情源`)
    }
  }

  private buildPositionRefreshUpdate(position: {
    id: string
    quantity: number
    avgCost: number
    costBasis: number | null
    marketValue: number | null
    asset: { type: string; symbol: string; name: string }
  }, price: number): PositionRefreshUpdate {
    if (position.asset.type === 'cash') {
      const cashValue = Math.max(position.marketValue || 0, position.costBasis || 0, position.quantity || 0)
      this.assertFinitePositive(cashValue, `${position.asset.name} 现金金额无效`)
      return {
        positionId: position.id,
        quantity: cashValue,
        avgCost: 1,
        currentPrice: 1,
        marketValue: cashValue,
        costBasis: cashValue,
        unrealizedPnl: 0,
      }
    }

    const shouldPreserveMarketValue = this.shouldPreserveManualMarketValue(position, price)
    const marketValue = shouldPreserveMarketValue
      ? position.marketValue || 0
      : position.quantity * price
    const costBasis = position.costBasis || 0
    const unrealizedPnl = marketValue - costBasis

    this.assertFinitePositive(position.quantity, `${position.asset.name} 持仓数量无效`)
    this.assertFinitePositive(marketValue, `${position.asset.name} 刷新后市值无效`)
    if (!shouldPreserveMarketValue) {
      this.assertClose(marketValue, position.quantity * price, `${position.asset.name} 市值公式校验失败`)
    }
    this.assertClose(unrealizedPnl, marketValue - costBasis, `${position.asset.name} 盈亏公式校验失败`)

    return {
      positionId: position.id,
      currentPrice: price,
      marketValue,
      unrealizedPnl,
    }
  }

  private async buildValidatedPositionRefreshUpdates(assetId: string, price: number, source: string) {
    const positions = await prisma.position.findMany({
      where: { assetId, status: 'open' },
      include: { asset: true },
    })
    if (positions.length === 0) return []

    this.validateQuoteForAssetType(positions[0].asset.type, price, source)
    return positions.map((position) => this.buildPositionRefreshUpdate(position, price))
  }

  private async applyPositionRefreshUpdates(updates: PositionRefreshUpdate[]) {
    await prisma.$transaction(updates.map((update) => prisma.position.update({
      where: { id: update.positionId },
      data: {
        ...(update.quantity !== undefined ? { quantity: update.quantity } : {}),
        ...(update.avgCost !== undefined ? { avgCost: update.avgCost } : {}),
        ...(update.costBasis !== undefined ? { costBasis: update.costBasis } : {}),
        currentPrice: update.currentPrice,
        marketValue: update.marketValue,
        unrealizedPnl: update.unrealizedPnl,
      },
    })))
  }

  private async applyRetainedPriceToOpenPositions(assetId: string, price: number, retainedLocalPrice = false) {
    const positions = await prisma.position.findMany({
      where: { assetId, status: 'open' },
      include: { asset: true },
    })

    if (positions.length === 0) return
    if (!retainedLocalPrice) {
      this.validateQuoteForAssetType(positions[0].asset.type, price, 'local_last_price')
    }

    for (const position of positions) {
      const update = this.buildPositionRefreshUpdate(position, position.asset.type === 'cash' ? 1 : price)

      await prisma.position.update({
        where: { id: update.positionId },
        data: {
          ...(update.quantity !== undefined ? { quantity: update.quantity } : {}),
          ...(update.avgCost !== undefined ? { avgCost: update.avgCost } : {}),
          ...(update.costBasis !== undefined ? { costBasis: update.costBasis } : {}),
          currentPrice: update.currentPrice,
          marketValue: update.marketValue,
          unrealizedPnl: update.unrealizedPnl,
        },
      })
    }
  }

  private shouldPreserveManualMarketValue(
    position: {
      asset: { type: string; symbol: string }
      quantity: number
      costBasis: number | null
      marketValue: number | null
    },
    currentPrice: number,
  ) {
    if (position.asset.type !== 'fund' && position.asset.type !== 'bond') {
      return false
    }
    if (this.isExchangeTradedFundCode(position.asset.symbol)) {
      return false
    }
    if (!position.marketValue || position.marketValue <= 0) {
      return false
    }

    const quantity = position.quantity || 0
    const expectedMarketValue = quantity * currentPrice
    const costBasis = position.costBasis || 0

    // 部分债券/类固收导入为“1 份 = 当前总金额”，净值只作为参考价格，不能用 1 × NAV 重算总市值。
    if (quantity <= 1) {
      return true
    }
    if (costBasis > 0 && expectedMarketValue > 0 && expectedMarketValue / costBasis < 0.05) {
      return true
    }

    return false
  }

  private getPriceJumpThreshold(assetType: string | undefined) {
    if (assetType === 'cash') return 0.01
    if (assetType === 'fund' || assetType === 'bond') return 0.12
    if (assetType === 'gold') return 0.08
    return 0.2
  }

  private checkPriceJump(previousPrice: number | null | undefined, currentPrice: number, assetType: string | undefined) {
    if (!previousPrice || previousPrice <= 0 || !Number.isFinite(currentPrice) || currentPrice <= 0) {
      return {
        previousPrice: previousPrice ?? undefined,
        priceChangePercent: undefined,
        abnormalPriceJump: false,
        warning: null,
      }
    }

    const priceChangePercent = ((currentPrice - previousPrice) / previousPrice) * 100
    const thresholdPercent = this.getPriceJumpThreshold(assetType) * 100
    const abnormalPriceJump = Math.abs(priceChangePercent) > thresholdPercent
    return {
      previousPrice,
      priceChangePercent: Number(priceChangePercent.toFixed(4)),
      abnormalPriceJump,
      warning: abnormalPriceJump
        ? `价格相对上一可信价 ${previousPrice.toFixed(4)} 跳变 ${priceChangePercent.toFixed(2)}%，超过 ${thresholdPercent.toFixed(0)}% 阈值。`
        : null,
    }
  }

  private async getRetainedPositionPrice(assetId: string) {
    const position = await prisma.position.findFirst({
      where: {
        assetId,
        status: 'open',
        OR: [
          { currentPrice: { not: null } },
          { avgCost: { gt: 0 } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
    })

    return position?.currentPrice ?? (position?.avgCost && position.avgCost > 0 ? position.avgCost : null)
  }
}

export const marketDataService = new MarketDataService()
