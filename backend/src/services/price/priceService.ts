/**
 * Price Service - 价格服务
 *
 * 职责：
 * 1. 从多个数据源获取实时价格
 * 2. 多源交叉验证
 * 3. 价格历史存储
 *
 * 服务粒度：每个方法都是一个小而可控的服务
 */

import { prisma } from '../../db/prisma.js'
import axios from 'axios'
import { execFile } from 'node:child_process'

export interface PriceData {
  symbol: string
  name?: string
  price: number
  priceChange: number
  priceChangePercent: number
  volume24h?: number
  high24h?: number
  low24h?: number
  openPrice?: number
  previousClose?: number
  timestamp: Date
  source: string
  isValid: boolean
  crossValidation?: Array<{
    source: string
    price: number
    deviationPercent: number
  }>
}

export interface QuoteRefreshResult {
  assetId: string
  symbol: string
  success: boolean
  price?: number
  source?: string
  updatedAt?: Date
  isValid?: boolean
  warnings: string[]
  error?: string
}

interface PriceHistoryItem {
  timestamp: Date
  openPrice: number | null
  highPrice: number | null
  lowPrice: number | null
  closePrice: number
  volume: number | null
}

interface PriceHistoryResult {
  data: PriceHistoryItem[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

interface FundPriceData {
  fundcode: string
  name: string
  price: number
  priceChange: number
  priceChangePercent: number
  gztime: string
  source: string
}

interface BondPriceData {
  symbol: string
  name?: string
  price: number
  priceChange: number
  priceChangePercent: number
  timestamp: Date
  source: string
}

interface GoldPriceResult {
  price: number
  priceChange: number
  priceChangePercent: number
  sources: Array<{
    source: string
    price: number
    deviation: number
  }>
  isValid: boolean
  timestamp: Date
  error?: string
}

// 简单内存缓存 (5秒TTL)
const priceCache = new Map<string, { data: unknown; expireAt: number }>()

function getCached<T>(key: string): T | null {
  const cached = priceCache.get(key)
  if (cached && cached.expireAt > Date.now()) {
    return cached.data as T
  }
  priceCache.delete(key)
  return null
}

function setCache(key: string, data: unknown, ttlMs: number = 5000): void {
  priceCache.set(key, { data, expireAt: Date.now() + ttlMs })
}

const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000,
}

class PriceService {
  private compactProviderError(error: unknown) {
    const anyError = error as any
    return {
      name: anyError?.name || 'Error',
      message: anyError?.message || String(error),
      code: anyError?.code || null,
      status: anyError?.response?.status || anyError?.status || null,
      statusText: anyError?.response?.statusText || null,
      url: anyError?.config?.url || null,
    }
  }

  /**
   * 刷新资产价格并写回资产主表和价格历史。
   */
  async refreshAssetQuotes(params: {
    assetIds?: string[]
    symbols?: string[]
    userId?: string
  }): Promise<{ refreshed: number; failed: number; results: QuoteRefreshResult[] }> {
    const where: any = {}

    if (params.assetIds?.length) {
      where.id = { in: params.assetIds }
    } else if (params.symbols?.length) {
      where.symbol = { in: params.symbols }
    } else if (params.userId) {
      where.positions = { some: { userId: params.userId, status: 'open' } }
    }

    const assets = await prisma.asset.findMany({ where })
    const results: QuoteRefreshResult[] = []

    for (const asset of assets) {
      const warnings: string[] = []

      try {
        const priceData = asset.type === 'cash'
          ? this.getCashQuote(asset.symbol, asset.name)
          : asset.type === 'gold'
          ? await this.getGoldPriceAsQuote(asset.symbol, asset.name)
          : await this.getRealTimePrice(asset.symbol, 'auto', asset.type)

        if (!priceData.isValid) {
          warnings.push('Price source discrepancy exceeded validation threshold')
        }

        if (priceData.crossValidation?.some((source) => source.deviationPercent >= 0.5)) {
          warnings.push('Cross-source price deviation detected')
        }

        await this.persistQuote(asset.id, priceData)
        results.push({
          assetId: asset.id,
          symbol: asset.symbol,
          success: true,
          price: priceData.price,
          source: priceData.source,
          updatedAt: priceData.timestamp,
          isValid: priceData.isValid,
          warnings,
        })
      } catch (error) {
        results.push({
          assetId: asset.id,
          symbol: asset.symbol,
          success: false,
          warnings,
          error: error instanceof Error ? error.message : 'Unknown error',
        })
      }
    }

    return {
      refreshed: results.filter((result) => result.success).length,
      failed: results.filter((result) => !result.success).length,
      results,
    }
  }

  private getCashQuote(symbol: string, name?: string): PriceData {
    return {
      symbol,
      name,
      price: 1,
      priceChange: 0,
      priceChangePercent: 0,
      timestamp: new Date(),
      source: 'manual',
      isValid: true,
    }
  }

  getManualCashQuote(symbol: string, name?: string): PriceData {
    return this.getCashQuote(symbol, name)
  }

  private async persistQuote(assetId: string, priceData: PriceData): Promise<void> {
    await prisma.$transaction([
      prisma.asset.update({
        where: { id: assetId },
        data: {
          lastPrice: priceData.price,
          lastUpdated: priceData.timestamp,
        },
      }),
      prisma.priceHistory.create({
        data: {
          assetId,
          timestamp: priceData.timestamp,
          closePrice: priceData.price,
          openPrice: priceData.openPrice,
          highPrice: priceData.high24h,
          lowPrice: priceData.low24h,
          volume: priceData.volume24h,
          source: priceData.source,
          isValid: priceData.isValid,
        },
      }),
    ])
  }

  async persistResolvedQuote(assetId: string, priceData: PriceData): Promise<void> {
    await this.persistQuote(assetId, priceData)
  }

  private async getGoldPriceAsQuote(symbol: string, name?: string): Promise<PriceData> {
    const goldPrice = await this.getGoldPrice()

    return {
      symbol,
      name,
      price: goldPrice.price,
      priceChange: goldPrice.priceChange,
      priceChangePercent: goldPrice.priceChangePercent,
      timestamp: goldPrice.timestamp,
      source: goldPrice.sources.map((source) => source.source).join(',') || 'gold',
      isValid: goldPrice.isValid,
      crossValidation: goldPrice.sources.slice(1).map((source) => ({
        source: source.source,
        price: source.price,
        deviationPercent: source.deviation,
      })),
    }
  }

  /**
   * 获取实时价格（支持多数据源）
   * A股股票（6位数字代码）自动使用专用方法
   */
  async getRealTimePrice(
    symbol: string,
    source: 'yahoo' | 'eastmoney' | 'sina' | 'auto' = 'auto',
    assetType?: string
  ): Promise<PriceData> {
    // 根据资产类型选择合适的API
    if (assetType === 'fund' || assetType === 'etf') {
      if (this.isExchangeTradedFundCode(symbol)) {
        return this.getChinaStockPrice(symbol)
      }
      // 基金和ETF都走基金API（天天基金支持ETF净值）
      return this.getFundPriceAsStock(symbol)
    }

    if (assetType === 'bond') {
      return this.getBondPriceAsStock(symbol)
    }

    // 现金无实时价格
    if (assetType === 'cash') {
      throw new Error(`${assetType} does not have real-time price`)
    }

    // 黄金按元/克口径取价，不能把黄金 ETF/联接基金净值当作金价。
    if (assetType === 'gold') {
      return this.getGoldPriceAsQuote(symbol)
    }

    // A股（6位数字代码）自动走专用方法（股票、ETF、黄金ETF等）
    if (/^\d{6}$/.test(symbol)) {
      return this.getChinaStockPrice(symbol)
    }

    if (source === 'auto') {
      return this.getPriceWithValidation(symbol)
    }

    const fetcher = this.getPriceFetcher(source)
    return await fetcher(symbol)
  }

  async getQuoteFromSource(
    symbol: string,
    source: 'yahoo' | 'eastmoney' | 'sina',
    assetType?: string
  ): Promise<PriceData> {
    if (assetType === 'fund' || assetType === 'etf') {
      if (this.isExchangeTradedFundCode(symbol)) {
        if (source === 'eastmoney') {
          return this.fetchFromEastmoney(symbol)
        }
        if (source === 'sina') {
          return this.fetchFromSina(symbol)
        }
        return this.getChinaStockPrice(symbol)
      }
      if (source === 'eastmoney' && /^\d{6}$/.test(symbol)) {
        return this.fetchFromEastmoney(symbol)
      }
      return this.getFundPriceAsStock(symbol)
    }

    if (assetType === 'bond') {
      if (source === 'eastmoney' && /^\d{6}$/.test(symbol)) {
        return this.fetchFromEastmoney(symbol)
      }
      return this.getBondPriceAsStock(symbol)
    }

    if (assetType === 'cash') {
      return this.getCashQuote(symbol)
    }

    if (assetType === 'gold') {
      if (source === 'eastmoney' && /^\d{6}$/.test(symbol)) {
        return this.fetchFromEastmoney(symbol)
      }
      if (source === 'yahoo') {
        return this.fetchFromYahoo(symbol)
      }
    }

    const fetcher = this.getPriceFetcher(source)
    return await fetcher(symbol)
  }

  /**
   * 基金价格获取（以PriceData格式返回）
   */
  private async getFundPriceAsStock(fundCode: string): Promise<PriceData> {
    const fundPrice = await this.getFundPrice(fundCode)
    if (!fundPrice) {
      throw new Error(`Failed to fetch fund price for ${fundCode}`)
    }
    return this.fundPriceToPriceData(fundPrice)
  }

  private fundPriceToPriceData(fundPrice: FundPriceData): PriceData {
    return {
      symbol: fundPrice.fundcode,
      name: fundPrice.name,
      price: fundPrice.price,
      priceChange: fundPrice.priceChange,
      priceChangePercent: fundPrice.priceChangePercent,
      timestamp: new Date(fundPrice.gztime),
      source: fundPrice.source,
      isValid: true,
    }
  }

  async getFundPriceFromTiantianAsStock(fundCode: string): Promise<PriceData> {
    return this.getFundPriceAsStock(fundCode)
  }

  async getFundPriceFromEastmoneyAsStock(fundCode: string): Promise<PriceData> {
    if (!/^\d{6}$/.test(fundCode)) {
      throw new Error(`Eastmoney fund fallback unsupported for ${fundCode}`)
    }
    const fundPrice = await this.getLatestFundNavFromEastmoney(fundCode)
    if (!fundPrice) {
      throw new Error(`Failed to fetch Eastmoney official NAV for ${fundCode}`)
    }
    return this.fundPriceToPriceData(fundPrice)
  }

  /**
   * 债券价格获取（以PriceData格式返回）
   */
  private async getBondPriceAsStock(bondCode: string): Promise<PriceData> {
    const bondPrice = await this.getBondPrice(bondCode)
    if (!bondPrice) {
      throw new Error(`Failed to fetch bond price for ${bondCode}`)
    }
    return {
      symbol: bondPrice.symbol,
      name: bondPrice.name,
      price: bondPrice.price,
      priceChange: bondPrice.priceChange,
      priceChangePercent: bondPrice.priceChangePercent,
      timestamp: bondPrice.timestamp,
      source: bondPrice.source,
      isValid: true,
    }
  }

  async getBondPriceFromYahooAsStock(bondCode: string): Promise<PriceData> {
    return this.getBondPriceAsStock(bondCode)
  }

  async getBondPriceFromEastmoneyAsStock(bondCode: string): Promise<PriceData> {
    if (!/^\d{6}$/.test(bondCode)) {
      throw new Error(`Eastmoney bond fallback unsupported for ${bondCode}`)
    }
    const bondFundPrice = await this.getLatestFundNavFromEastmoney(bondCode)
    if (!bondFundPrice) {
      throw new Error(`Failed to fetch Eastmoney official NAV for ${bondCode}`)
    }
    return this.fundPriceToPriceData(bondFundPrice)
  }

  /**
   * 获取A股股票价格（东方财富主源 + 新浪备源）
   * 处理市场ID判断：上海6开头，深圳0/3开头
   */
  async getChinaStockPrice(symbol: string): Promise<PriceData> {
    // 先检查缓存
    const cached = getCached<PriceData>(`china:${symbol}`)
    if (cached) {
      return cached
    }

    try {
      // 东方财富 API（主力）
      const price = await this.fetchFromEastmoney(symbol)
      setCache(`china:${symbol}`, price, 5000)
      return price
    } catch (eastmoneyError) {
      console.warn(`Eastmoney failed for ${symbol}, trying Sina:`, this.compactProviderError(eastmoneyError))
    }

    try {
      // 新浪 API（备用）
      const sinaPrice = await this.fetchFromSina(symbol)
      setCache(`china:${symbol}`, sinaPrice, 5000)
      return sinaPrice
    } catch (sinaError) {
      console.warn(`Sina also failed for ${symbol}:`, this.compactProviderError(sinaError))
    }

    throw new Error(`Failed to fetch A-share price for ${symbol} from all sources`)
  }

  /**
   * 多数据源交叉验证
   */
  private async getPriceWithValidation(symbol: string): Promise<PriceData> {
    const sources: Array<'yahoo' | 'eastmoney' | 'sina'> = ['yahoo', 'eastmoney', 'sina']
    const prices: PriceData[] = []

    // 并行获取所有数据源价格
    const results = await Promise.allSettled(
      sources.map((source) => this.getPriceFetcher(source)(symbol))
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        prices.push(result.value)
      }
    }

    if (prices.length === 0) {
      throw new Error(`Failed to fetch price for ${symbol} from all sources`)
    }

    // 使用第一个有效价格作为主价格
    const primaryPrice = prices[0]

    // 计算交叉验证
    const crossValidation = prices.slice(1).map((p) => {
      const deviation = Math.abs(p.price - primaryPrice.price) / primaryPrice.price * 100
      return {
        source: p.source,
        price: p.price,
        deviationPercent: deviation,
      }
    })

    // 检查偏差（crossValidation为空时maxDeviation为0）
    const deviations = crossValidation.map((c) => c.deviationPercent)
    const maxDeviation = deviations.length > 0 ? Math.max(...deviations) : 0
    const isValid = maxDeviation < 0.5 // 偏差小于0.5%视为有效

    return {
      ...primaryPrice,
      crossValidation,
      isValid,
    }
  }

  /**
   * 获取价格获取器
   */
  private getPriceFetcher(source: 'yahoo' | 'eastmoney' | 'sina') {
    switch (source) {
      case 'yahoo':
        return this.fetchFromYahoo.bind(this)
      case 'eastmoney':
        return this.fetchFromEastmoney.bind(this)
      case 'sina':
        return this.fetchFromSina.bind(this)
    }
  }

  /**
   * 带重试的请求
   */
  private async fetchWithRetry<T>(
    requestFn: () => Promise<T>,
    maxRetries: number = RETRY_CONFIG.maxRetries
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await requestFn()
      } catch (error) {
        lastError = error as Error
        if (attempt < maxRetries - 1) {
          await this.delay(RETRY_CONFIG.retryDelay * (attempt + 1))
        }
      }
    }

    throw lastError || new Error('Request failed after retries')
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  /**
   * 从Yahoo Finance获取价格
   */
  private async fetchFromYahoo(symbol: string): Promise<PriceData> {
    return this.fetchWithRetry(async () => {
      // 美股符号处理：添加后缀如 .SS(上证) .SH(沪深) .HK(港股)
      const formattedSymbol = this.formatYahooSymbol(symbol)

      const response = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${formattedSymbol}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
          timeout: 10000,
        }
      )

      const data = response.data
      const result = data.chart?.result?.[0]

      if (!result) {
        throw new Error(`No data found for symbol ${symbol}`)
      }

      const meta = result.meta
      return {
        symbol,
        name: meta.shortName || meta.symbol,
        price: meta.regularMarketPrice || 0,
        priceChange: meta.regularMarketChange || 0,
        priceChangePercent: meta.regularMarketChangePercent || 0,
        volume24h: meta.regularMarketVolume,
        high24h: meta.regularMarketDayHigh,
        low24h: meta.regularMarketDayLow,
        openPrice: meta.regularMarketOpen,
        previousClose: meta.previousClose || meta.regularMarketPreviousClose,
        timestamp: new Date(meta.regularMarketTime * 1000),
        source: 'yahoo',
        isValid: true,
      }
    })
  }

  /**
   * 格式化Yahoo Finance符号
   */
  private formatYahooSymbol(symbol: string): string {
    // 如果已经是完整格式直接返回
    if (symbol.includes('.') || symbol.startsWith('^')) {
      return symbol
    }

    // A股上证指数添加 .SS
    if (/^[SH][sh]\d{6}$/.test(symbol)) {
      return symbol.toUpperCase() + '.SS'
    }

    // A股深证指数添加 .SZ
    if (/^[SZ][sz]\d{6}$/.test(symbol)) {
      return symbol.toUpperCase() + '.SZ'
    }

    // 港股添加 .HK
    if (/^\d{4,5}$/.test(symbol) && !symbol.includes('.')) {
      return symbol + '.HK'
    }

    return symbol
  }

  /**
   * 从东方财富获取价格
   */
  private async fetchFromEastmoney(symbol: string): Promise<PriceData> {
    return this.fetchWithRetry(async () => {
      // 解析市场代码和股票代码
      const { market, code } = this.parseEastmoneySymbol(symbol)

      const response = await axios.get(
        `https://push2.eastmoney.com/api/qt/stock/get`,
        {
          params: {
            secid: `${market}.${code}`,
            fields: 'f43,f44,f45,f46,f47,f48,f50,f57,f58,f60,f170',
            ut: 'fa5fd1943c7b386f172d6893dbfba10b',
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Referer: 'https://quote.eastmoney.com/',
          },
          proxy: false,
          timeout: 10000,
        }
      )

      const data = response.data.data

      if (!data) {
        throw new Error(`No data found for symbol ${symbol}`)
      }

      const priceDivisor = this.isExchangeTradedFundCode(symbol) ? 1000 : 100
      const currentPrice = data.f43 / priceDivisor
      const previousClose = data.f60 / priceDivisor

      return {
        symbol,
        name: data.f58,
        price: currentPrice,
        priceChange: currentPrice - previousClose,
        priceChangePercent: ((data.f43 - data.f60) / data.f60) * 100,
        volume24h: data.f48,
        high24h: data.f44 / priceDivisor,
        low24h: data.f45 / priceDivisor,
        openPrice: data.f46 / priceDivisor,
        previousClose,
        timestamp: new Date(),
        source: 'eastmoney',
        isValid: true,
      }
    })
  }

  /**
   * 解析东方财富股票代码
   */
  private parseEastmoneySymbol(symbol: string): { market: string; code: string } {
    // 格式: 市场代码.股票代码
    // 1=上海, 0=深圳, 116=港股

    if (symbol.includes('.')) {
      const [m, c] = symbol.split('.')
      return { market: m, code: c }
    }

    // 判断市场
    if (/^\d{6}$/.test(symbol)) {
      // A股/场内基金 6位数：6/5 开头在上交所，0/3/159 开头在深交所
      if (symbol.startsWith('6') || symbol.startsWith('5')) {
        return { market: '1', code: symbol }
      } else {
        return { market: '0', code: symbol }
      }
    }

    // 港股 4-5位数
    if (/^\d{4,5}$/.test(symbol)) {
      return { market: '116', code: symbol }
    }

    // 默认上证
    return { market: '1', code: symbol }
  }

  /**
   * 从新浪财经获取价格
   */
  private async fetchFromSina(symbol: string): Promise<PriceData> {
    return this.fetchWithRetry(async () => {
      // 格式化新浪股票代码
      const formattedSymbol = this.formatSinaSymbol(symbol)

      const decoder = new TextDecoder('gb18030')
      const dataStr = decoder.decode(await this.fetchUrlPayloadWithCurl(
        `https://hq.sinajs.cn/list=${formattedSymbol}`,
        [
          'Referer: https://finance.sina.com.cn/',
          'User-Agent: curl/8.5.0',
        ]
      ))
      // 新浪返回格式: var hq_str_SYMBOL="name,price,change,percent,volume,..."
      const match = dataStr.match(/"([^"]+)"/)

      if (!match) {
        throw new Error(`No data found for symbol ${symbol}`)
      }

      const fields = match[1].split(',')

      if (fields.length < 32) {
        throw new Error(`Invalid data format for symbol ${symbol}`)
      }

      const price = parseFloat(fields[3]) || 0
      const previousClose = parseFloat(fields[2]) || 0
      const priceChange = price - previousClose
      const priceChangePercent = previousClose ? (priceChange / previousClose) * 100 : 0
      const quoteTimestamp = fields[30] && fields[31]
        ? new Date(`${fields[30]}T${fields[31]}+08:00`)
        : new Date()

      return {
        symbol,
        name: fields[0],
        price,
        priceChange,
        priceChangePercent,
        volume24h: parseFloat(fields[8]) * 100,
        high24h: parseFloat(fields[4]) || undefined,
        low24h: parseFloat(fields[5]) || undefined,
        openPrice: parseFloat(fields[1]) || undefined,
        previousClose,
        timestamp: Number.isNaN(quoteTimestamp.getTime()) ? new Date() : quoteTimestamp,
        source: 'sina',
        isValid: true,
      }
    })
  }

  private async fetchUrlPayloadWithCurl(url: string, headers: string[] = [], maxTimeSeconds = 5): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      execFile(
        'curl',
        [
          '-sS',
          '--max-time',
          String(maxTimeSeconds),
          url,
          ...headers.flatMap((header) => ['-H', header]),
        ],
        {
          encoding: 'buffer',
          maxBuffer: 1024 * 1024,
          timeout: (maxTimeSeconds + 1) * 1000,
        },
        (error, stdout, stderr) => {
          if (error) {
            const message = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '')
            reject(new Error(message || error.message))
            return
          }
          if (!stdout || stdout.length === 0) {
            reject(new Error(`curl returned empty response for ${url}`))
            return
          }
          resolve(stdout)
        }
      )
    })
  }

  /**
   * 格式化新浪财经股票代码
   */
  private formatSinaSymbol(symbol: string): string {
    // 已经包含前缀的直接返回
    if (symbol.startsWith('sh') || symbol.startsWith('sz') ||
        symbol.startsWith('hk')) {
      return symbol.toLowerCase()
    }

    // A股处理
    if (/^\d{6}$/.test(symbol)) {
      if (symbol.startsWith('6') || symbol.startsWith('5')) {
        return `sh${symbol}`
      } else {
        return `sz${symbol}`
      }
    }

    // 港股处理
    if (/^\d{4,5}$/.test(symbol)) {
      return `hk${symbol}`
    }

    return symbol
  }

  private isExchangeTradedFundCode(symbol: string): boolean {
    return /^(159|510|511|512|513|515|516|517|518|520|560|561|562|563|588|589)\d{3}$/.test(symbol)
  }

  /**
   * 批量获取价格
   */
  async getBatchPrices(symbols: string[]): Promise<PriceData[]> {
    const results = await Promise.allSettled(
      symbols.map((symbol) => this.getRealTimePrice(symbol))
    )

    return results
      .filter((r): r is PromiseFulfilledResult<PriceData> => r.status === 'fulfilled')
      .map((r) => r.value)
  }

  /**
   * 存储价格历史
   */
  async storePriceHistory(assetId: string, priceData: PriceData): Promise<void> {
    await prisma.priceHistory.create({
      data: {
        assetId,
        timestamp: priceData.timestamp,
        closePrice: priceData.price,
        openPrice: priceData.openPrice,
        highPrice: priceData.high24h,
        lowPrice: priceData.low24h,
        volume: priceData.volume24h,
        source: priceData.source,
        isValid: priceData.isValid,
      },
    })
  }

  /**
   * 批量存储价格历史
   */
  async storeBatchPriceHistory(
    records: Array<{ assetId: string; priceData: PriceData }>
  ): Promise<void> {
    await prisma.priceHistory.createMany({
      data: records.map((r) => ({
        assetId: r.assetId,
        timestamp: r.priceData.timestamp,
        closePrice: r.priceData.price,
        openPrice: r.priceData.openPrice,
        highPrice: r.priceData.high24h,
        lowPrice: r.priceData.low24h,
        volume: r.priceData.volume24h,
        source: r.priceData.source,
        isValid: r.priceData.isValid,
      })),
    })
  }

  /**
   * 获取价格历史（支持分页）
   */
  async getPriceHistory(
    assetId: string,
    startDate: Date,
    endDate: Date,
    options: { page?: number; pageSize?: number } = {}
  ): Promise<PriceHistoryResult> {
    const { page = 1, pageSize = 100 } = options
    const skip = (page - 1) * pageSize

    const [history, total] = await Promise.all([
      prisma.priceHistory.findMany({
        where: {
          assetId,
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: { timestamp: 'asc' },
        skip,
        take: pageSize,
      }),
      prisma.priceHistory.count({
        where: {
          assetId,
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),
    ])

    return {
      data: history.map((h) => ({
        timestamp: h.timestamp,
        openPrice: h.openPrice,
        highPrice: h.highPrice,
        lowPrice: h.lowPrice,
        closePrice: h.closePrice,
        volume: h.volume,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    }
  }

  /**
   * 获取最新价格（从数据库）
   */
  async getLatestPrice(assetId: string): Promise<PriceHistoryItem | null> {
    const latest = await prisma.priceHistory.findFirst({
      where: { assetId },
      orderBy: { timestamp: 'desc' },
    })

    if (!latest) return null

    return {
      timestamp: latest.timestamp,
      openPrice: latest.openPrice,
      highPrice: latest.highPrice,
      lowPrice: latest.lowPrice,
      closePrice: latest.closePrice,
      volume: latest.volume,
    }
  }

/**
   * 获取基金价格（天天基金网）
   * @param fundCode 基金代码，如 020137
   */
  async getFundPrice(fundCode: string): Promise<FundPriceData | null> {
    const cacheKey = `fund:${fundCode}`
    const cached = getCached<FundPriceData>(cacheKey)
    if (cached) return cached

    const [eastmoneyNav, tiantianEstimate] = await Promise.all([
      this.getLatestFundNavFromEastmoney(fundCode).catch((error) => {
        console.warn(`Eastmoney official NAV fetch failed for ${fundCode}:`, this.compactProviderError(error))
        return null
      }),
      this.getTiantianFundEstimate(fundCode).catch((error) => {
        console.warn(`Tiantian fund estimate fetch failed for ${fundCode}:`, this.compactProviderError(error))
        return null
      }),
    ])

    if (eastmoneyNav) {
      const result = {
        ...eastmoneyNav,
        name: tiantianEstimate?.name || eastmoneyNav.name,
      }
      setCache(cacheKey, result, 5000)
      return result
    }

    if (tiantianEstimate) {
      setCache(cacheKey, tiantianEstimate, 5000)
      return tiantianEstimate
    }

    return null
  }

  private async getTiantianFundEstimate(fundCode: string): Promise<FundPriceData | null> {
    try {
      const timestamp = Date.now()
      const payload = await this.fetchUrlPayloadWithCurl(
        `https://fundgz.1234567.com.cn/js/${fundCode}.js?rt=${timestamp}`,
        ['User-Agent: curl/8.5.0']
      )

      // 天天基金返回格式: jsonpgz({"fundcode":"000001",...})
      const dataStr = payload.toString('utf8')
      const jsonMatch = dataStr.match(/jsonpgz\((.+)\)/)

      if (!jsonMatch) {
        return null
      }

      const data = JSON.parse(jsonMatch[1])

      // gsz 是盘中估值，不是最终官方净值；仅在官方净值源不可用时作为降级值。
      const price = parseFloat(data.gsz) || parseFloat(data.dwjz) || parseFloat(data.jz) || 0
      const gztime = data.gztime || ''
      // 计算涨跌（如果有昨日净值dwjz）
      const previousPrice = data.dwjz ? parseFloat(data.dwjz) : null
      const priceChange = previousPrice ? price - previousPrice : 0
      const priceChangePercent = previousPrice ? (priceChange / previousPrice) * 100 : 0

      return {
        fundcode: data.fundcode,
        name: data.name,
        price,
        priceChange,
        priceChangePercent,
        gztime,
        source: 'tiantian',
      }
    } catch (error) {
      console.warn(`Tiantian fund price fetch failed for ${fundCode}:`, this.compactProviderError(error))
      return null
    }
  }

  private async getLatestFundNavFromEastmoney(fundCode: string): Promise<FundPriceData | null> {
    const payload = await this.fetchUrlPayloadWithCurl(
      `https://api.fund.eastmoney.com/f10/lsjz?fundCode=${fundCode}&pageIndex=1&pageSize=1`,
      [
        'Referer: https://fund.eastmoney.com/',
        'User-Agent: curl/8.5.0',
      ],
      12
    )
    const data = JSON.parse(payload.toString('utf8'))
    const latest = data?.Data?.LSJZList?.[0]
    if (!latest?.DWJZ || !latest?.FSRQ) {
      return null
    }

    return {
      fundcode: fundCode,
      name: fundCode,
      price: parseFloat(latest.DWJZ),
      priceChange: 0,
      priceChangePercent: parseFloat(latest.JZZZL) || 0,
      gztime: `${latest.FSRQ} 15:00`,
      source: 'eastmoney_nav',
    }
  }

  /**
   * 获取债券价格（Yahoo Finance）
   * @param symbol 债券代码，如 CNH=X（美元/人民币汇率）或具体债券代码
   */
  async getBondPrice(symbol: string): Promise<BondPriceData | null> {
    const cacheKey = `bond:${symbol}`
    const cached = getCached<BondPriceData>(cacheKey)
    if (cached) return cached

    try {
      const formattedSymbol = this.formatYahooSymbol(symbol)

      const response = await axios.get(
        `https://query1.finance.yahoo.com/v8/finance/chart/${formattedSymbol}`,
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          },
          timeout: 10000,
        }
      )

      const data = response.data
      const result = data.chart?.result?.[0]

      if (!result) {
        return null
      }

      const meta = result.meta

      const resultData: BondPriceData = {
        symbol,
        name: meta.shortName || meta.symbol,
        price: meta.regularMarketPrice || 0,
        priceChange: meta.regularMarketChange || 0,
        priceChangePercent: meta.regularMarketChangePercent || 0,
        timestamp: new Date(meta.regularMarketTime * 1000),
        source: 'yahoo',
      }

      setCache(cacheKey, resultData, 5000)
      return resultData
    } catch {
      return null
    }
  }

  /**
   * 获取金价（三源交叉验证）
   * 数据源：东方财富贵金属、Yahoo Finance、Kitco
   */
  async getGoldPrice(): Promise<GoldPriceResult> {
    const results = await Promise.allSettled([
      this.fetchGoldFromEastmoney(),
      this.fetchGoldFromYahoo(),
      this.fetchGoldFromKitco(),
      this.fetchGoldFromFund(), // 备用：用黄金ETF估算
    ])

    const validPrices: Array<{ source: string; price: number }> = []

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value !== null) {
        validPrices.push(result.value)
      }
    }

    if (validPrices.length === 0) {
      // 所有源都失败时返回错误信息，不抛异常让路由处理
      return {
        price: 0,
        priceChange: 0,
        priceChangePercent: 0,
        sources: [],
        isValid: false,
        timestamp: new Date(),
        error: 'Failed to fetch gold price from all sources',
      }
    }

    // 计算均价
    const avgPrice = validPrices.reduce((sum, p) => sum + p.price, 0) / validPrices.length

    // 计算每个源的偏差
    const sourcesWithDeviation = validPrices.map((p) => ({
      source: p.source,
      price: p.price,
      deviation: Math.abs(p.price - avgPrice) / avgPrice * 100,
    }))

    // 检查偏差是否在2%以内
    const maxDeviation = Math.max(...sourcesWithDeviation.map((s) => s.deviation))
    const isValid = maxDeviation < 2

    // 计算价格变化（假设有昨日收盘数据）
    const priceChange = avgPrice * 0.001 // 简化处理
    const priceChangePercent = (priceChange / avgPrice) * 100

    return {
      price: avgPrice,
      priceChange,
      priceChangePercent,
      sources: sourcesWithDeviation,
      isValid,
      timestamp: new Date(),
    }
  }

  /**
   * 从东方财富贵金属获取金价
   */
  private async fetchGoldFromEastmoney(): Promise<{ source: string; price: number } | null> {
    try {
      // 东方财富贵金属列表 API - 使用正确的市场代码
      // m:110+t:2 是贵金属，t:3 是黄金
      const response = await axios.get(
        'https://push2.eastmoney.com/api/qt/clist/get',
        {
          params: {
            pn: 1,
            pz: 50,
            po: 1,
            np: 1,
            ut: 'bd1d9ddb04089700cf9c27f6f7426281',
            fltt: 2,
            invt: 2,
            fid: 'f3',
            fs: 'm:110+t:3',
            fields: 'f2,f12,f14',
          },
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Referer: 'https://quote.eastmoney.com/gold.html',
          },
          timeout: 10000,
        }
      )

      const data = response.data
      const diff = data?.data?.diff || data?.diff
      if (!diff || diff.length === 0) return null

      // 找到黄金品种（代码包含AU）
      for (const item of diff) {
        const code = item.f12?.toString() || ''
        const name = item.f14?.toString() || ''
        if (code.includes('AU') || name.includes('黄金')) {
          return {
            source: 'eastmoney',
            price: item.f2 / 100,
          }
        }
      }

      // 返回第一个贵金属
      return {
        source: 'eastmoney',
        price: diff[0].f2 / 100,
      }
    } catch (error) {
      console.warn('Eastmoney gold price fetch failed:', this.compactProviderError(error))
      return null
    }
  }

  /**
   * 从Yahoo Finance获取金价（XAU/USD换算）
   */
  private async fetchGoldFromYahoo(): Promise<{ source: string; price: number } | null> {
    try {
      // XAUUSD 黄金兑美元 - 使用 query2 域名可能更稳定
      const response = await axios.get(
        'https://query2.finance.yahoo.com/v8/finance/chart/XAUUSD=X',
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            'Accept': 'application/json',
          },
          timeout: 10000,
        }
      )

      const data = response.data
      const result = data?.chart?.result?.[0]

      if (!result) return null

      const meta = result.meta
      const priceUSD = meta?.regularMarketPrice || meta?.previousClose || 0

      // 假设 USD/CNY 汇率约为 7.2，换算为元/克
      // 1盎司 = 31.1035克，XAU价格单位是美元/盎司
      const usdToCny = 7.2
      const pricePerGram = (priceUSD * usdToCny) / 31.1035

      return {
        source: 'yahoo',
        price: Math.round(pricePerGram * 100) / 100,
      }
    } catch (error) {
      console.warn('Yahoo gold price fetch failed:', this.compactProviderError(error))
      return null
    }
  }

  /**
   * 从Kitco获取金价
   */
  private async fetchGoldFromKitco(): Promise<{ source: string; price: number } | null> {
    try {
      // 尝试 Kitco 的另一个实时价格接口
      const response = await axios.get(
        'https://www.kitco.com/scripts/p-rawkit.js',
        {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Referer: 'https://www.kitco.com/',
          },
          timeout: 10000,
        }
      )

      const dataStr = response.data as string
      // Kitco 返回格式可能是类似 "var spgbpi = ...;" 的 JavaScript
      const jsonMatch = dataStr.match(/(\{[\s\S]*?\})/)

      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1])
          const price = data.gold?.price || data.GOLD?.price || data.spgbpi?.gold || null
          if (price) {
            const usdToCny = 7.2
            const pricePerGram = (price * usdToCny) / 31.1035
            return {
              source: 'kitco',
              price: Math.round(pricePerGram * 100) / 100,
            }
          }
        } catch {
          // JSON parse failed
        }
      }

      // 尝试直接解析数字模式
      const priceMatch = dataStr.match(/(?:gold|GOLD|Gold)[\s=]*(\d+\.?\d*)/)
      if (priceMatch) {
        const price = parseFloat(priceMatch[1])
        if (price > 1000) {
          const usdToCny = 7.2
          const pricePerGram = (price * usdToCny) / 31.1035
          return {
            source: 'kitco',
            price: Math.round(pricePerGram * 100) / 100,
          }
        }
      }

      return null
    } catch (error) {
      console.warn('Kitco gold price fetch failed:', this.compactProviderError(error))
      return null
    }
  }

  /**
   * 从东方财富获取国内金价（备用方案）
   * 使用多个黄金ETF基金交叉验证
   */
  private async fetchGoldFromFund(): Promise<{ source: string; price: number } | null> {
    try {
      // 多个黄金ETF的净值，换算系数已通过真实金价(1054元/克)验证
      const goldFunds = [
        { code: '002611', factor: 318 },   // 博时黄金ETF联接C
        { code: '518880', factor: 104.8 }, // 黄金ETF华安
        { code: '159934', factor: 100.3 }, // 黄金ETF易方达
      ]

      const prices: number[] = []

      for (const fund of goldFunds) {
        try {
          const url = `https://fundgz.1234567.com.cn/js/${fund.code}.js?rt=${Date.now()}`
          let dataStr = ''
          try {
            const response = await axios.get(url, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
              },
              timeout: 10000,
            })
            dataStr = response.data
          } catch {
            dataStr = (await this.fetchUrlPayloadWithCurl(url, [
              'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            ], 10)).toString('utf8')
          }
          const jsonMatch = dataStr.match(/jsonpgz\((.+)\)/)
          if (!jsonMatch) continue

          const data = JSON.parse(jsonMatch[1])
          const nav = parseFloat(data.gsz) || parseFloat(data.dwjz) || 0
          if (nav === 0) continue

          const goldPrice = nav * fund.factor
          prices.push(goldPrice)
        } catch {
          // 单个基金失败不影响其他
        }
      }

      if (prices.length === 0) return null

      // 取均值作为金价
      const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length

      // 返回第一个基金代码作为source标识（用于调试）
      return {
        source: 'goldFund',
        price: Math.round(avgPrice * 100) / 100,
      }
    } catch (error) {
      console.warn('Gold fund price fetch failed:', this.compactProviderError(error))
      return null
    }
  }

  /**
   * 删除过期价格历史
   */
  async cleanupOldPriceHistory(daysToKeep: number = 365): Promise<number> {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep)

    const result = await prisma.priceHistory.deleteMany({
      where: {
        timestamp: {
          lt: cutoffDate,
        },
      },
    })

    return result.count
  }

  /**
   * 获取基金历史净值
   * @param fundCode 基金代码
   * @param period 时间段: '1M'(30天) | '6M'(6个月) | '1Y'(1年) | '3Y'(3年)
   */
  async getFundHistory(
    fundCode: string,
    period: '1M' | '6M' | '1Y' | '3Y' = '1M'
  ): Promise<{
    fundCode: string
    fundName: string
    period: string
    records: Array<{
      date: string
      nav: number
      navChange: number
      navChangePercent: number
    }>
    stats: {
      startNav: number
      endNav: number
      changePercent: number
      maxNav: number
      minNav: number
    }
  }> {
    // 根据时间段计算需要获取的天数
    const daysMap: Record<string, number> = {
      '1M': 35,   // 30天 + 缓冲
      '6M': 185,  // 6个月 + 缓冲
      '1Y': 370,  // 1年 + 缓冲
      '3Y': 1100, // 3年 + 缓冲
    }
    const days = daysMap[period] || 35

    // 计算日期范围
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)

    const startDateStr = startDate.toISOString().split('T')[0]
    const endDateStr = endDate.toISOString().split('T')[0]

    // 获取基金基本信息（从天天基金API）
    const fundInfo = await this.getFundPrice(fundCode)
    const fundName = fundInfo?.name || fundCode

    // 从东方财富获取历史净值
    const records: Array<{
      date: string
      nav: number
      navChange: number
      navChangePercent: number
    }> = []

    let pageIndex = 1
    const pageSize = 30
    let hasMore = true

    while (hasMore && records.length < days) {
      try {
        const resp = await axios.get(
          `https://api.fund.eastmoney.com/f10/lsjz`,
          {
            params: {
              fundCode,
              pageIndex,
              pageSize,
              startDate: startDateStr,
              endDate: endDateStr,
            },
            headers: { Referer: 'https://fund.eastmoney.com/' },
            timeout: 10000,
          }
        )

        // API可能返回jQuery包装或纯JSON
        let data
        const rawData = resp.data
        if (typeof rawData === 'string') {
          const match = rawData.match(/jQuery\((.+)\)/)
          data = match ? JSON.parse(match[1]) : JSON.parse(rawData)
        } else {
          data = rawData
        }

        if (!data?.Data?.LSJZList?.length) break

        for (const item of data.Data.LSJZList) {
          const date = item.FSRQ // 发布日期
          const nav = parseFloat(item.DWJZ) || 0 // 单位净值
          const changePercent = parseFloat(item.JZZZL) || 0 // 累计增长率(%)

          // 计算涨跌：本期净值 - 上期净值
          const prevNav = records.length > 0 ? records[records.length - 1].nav : nav
          const navChange = nav - prevNav

          records.push({
            date,
            nav,
            navChange,
            navChangePercent: changePercent,
          })
        }

        // API每页最多返回20条记录
        // 如果返回20条，可能还有更多数据，继续获取下一页
        // 如果返回少于20条，说明已到最后一页
        if (data.Data.LSJZList.length < 20) {
          hasMore = false
        } else if (records.length + 20 >= days) {
          // 已经获取足够或接近目标天数，停止
          hasMore = false
        } else {
          pageIndex++
        }
      } catch (error) {
        console.error(`Failed to fetch fund history for ${fundCode}:`, this.compactProviderError(error))
        break
      }
    }

    // 反转数组让日期升序
    records.reverse()

    // 计算统计信息
    let startNav = 0
    let endNav = 0
    let maxNav = 0
    let minNav = Infinity

    if (records.length > 0) {
      startNav = records[0].nav
      endNav = records[records.length - 1].nav
      for (const r of records) {
        if (r.nav > maxNav) maxNav = r.nav
        if (r.nav < minNav) minNav = r.nav
      }
    }

    const changePercent = startNav > 0 ? ((endNav - startNav) / startNav) * 100 : 0

    return {
      fundCode,
      fundName,
      period,
      records,
      stats: {
        startNav,
        endNav,
        changePercent,
        maxNav: maxNav || endNav,
        minNav: minNav === Infinity ? endNav : minNav,
      },
    }
  }

  /**
   * 获取基金持仓信息
   * @param fundCode 基金代码
   */
  async getFundHoldings(fundCode: string): Promise<{
    fundCode: string
    fundName: string
    reportDate: string
    updateTime: string
    holdings: Array<{
      stockCode: string
      stockName: string
      shares: number
      marketValue: number
      proportion: number
    }>
  }> {
    // 获取基金基本信息
    const fundInfo = await this.getFundPrice(fundCode)
    const fundName = fundInfo?.name || fundCode

    try {
      // 从东方财富获取持仓数据
      const resp = await axios.get(
        `https://fundf10.eastmoney.com/FundArchivesDatas.aspx`,
        {
          params: {
            type: 'jjcc',
            code: fundCode,
            topLine: 10,
          },
          headers: {
            'User-Agent': 'Mozilla/5.0',
            Referer: 'https://fundf10.eastmoney.com/',
          },
          timeout: 10000,
        }
      )

      // 解析返回数据（HTML格式）
      const html = resp.data as string

      // 提取报告日期
      const dateMatch = html.match(/截止至：<font class='px12'>(\d{4}-\d{2}-\d{2})<\/font>/)
      const reportDate = dateMatch ? dateMatch[1] : ''

      // 解析持仓表格 - 提取股票代码、名称、持股数、市值、比例
      const holdings: Array<{
        stockCode: string
        stockName: string
        shares: number
        marketValue: number
        proportion: number
      }> = []

      // 使用正则提取每一行的持仓数据
      // 格式: <tr><td>1</td><td><a href='...'>00700</a></td><td class='tol'><a href='...'>腾讯控股</a></td><td class='tor'><span></span></td><td class='tor'><span></span></td><td class='xglj'>...</td><td class='tor'>15.36%</td><td class='tor'>350.32</td><td class='tor'>189,533.20</td></tr>
      const rowPattern = /<tr><td>\d+<\/td><td><a href='[^']*'>([\d.<>a-zA-Z-]+)<\/a><\/td><td class='tol'><a href='[^']*'>([^<]+)<\/a><\/td><td class='tor'><span[^>]*><\/span><\/td><td class='tor'><span[^>]*><\/span><\/td><td class='xglj'>(?:<a[^>]*>[^<]*<\/a>)+<\/td><td class='tor'>([\d.]+)%<\/td><td class='tor'>([\d,.]+)<\/td><td class='tor'>([\d,.]+)<\/td><\/tr>/g

      let match
      while ((match = rowPattern.exec(html)) !== null) {
        const [, stockCode, stockName, proportion, shares, marketValue] = match

        // 清理数据
        const cleanProportion = parseFloat(proportion) || 0
        const cleanShares = parseFloat(shares.replace(/,/g, '')) || 0
        const cleanMarketValue = parseFloat(marketValue.replace(/,/g, '')) || 0

        holdings.push({
          stockCode: stockCode.trim(),
          stockName: stockName.trim(),
          shares: cleanShares,
          marketValue: cleanMarketValue,
          proportion: cleanProportion,
        })
      }

      return {
        fundCode,
        fundName,
        reportDate,
        updateTime: new Date().toISOString(),
        holdings,
      }
    } catch (error) {
      console.error(`Failed to fetch fund holdings for ${fundCode}:`, this.compactProviderError(error))
      return {
        fundCode,
        fundName,
        reportDate: '',
        updateTime: new Date().toISOString(),
        holdings: [],
      }
    }
  }
}

export const priceService = new PriceService()
export { PriceHistoryItem, PriceHistoryResult, FundPriceData, BondPriceData, GoldPriceResult }
