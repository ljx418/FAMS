import { prisma } from '../../db/prisma.js'
import type { StockHistoryData } from '../../utils/stockUtils.js'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import axios from 'axios'

export interface SecurityStatusFact {
  symbol: string
  market: string
  tradeDate: string
  listingStatus: 'listed' | 'suspended_listing' | 'delisted' | 'unknown'
  riskFlag: 'normal' | 'st' | 'delisting_risk' | 'unknown'
  isSt: boolean
  isDelisted: boolean
  isSuspended: boolean
  provider: 'heuristic' | 'quote_list_canonical' | 'akshare' | 'baostock' | 'eastmoney' | 'exchange_public' | 'tushare'
  confidence: number
  warnings: string[]
}

export interface MarketTradeabilityFact {
  symbol: string
  market: string
  tradeDate: string
  isTradable: boolean
  tradabilityStatus: 'tradable' | 'suspended' | 'limit_up_blocked' | 'limit_down_blocked' | 'unknown'
  isSuspended: boolean
  limitUp: number | null
  limitDown: number | null
  provider: SecurityStatusFact['provider']
  confidence: number
  warnings: string[]
}

export interface SecurityStatusCoverageSnapshot {
  schemaVersion: 'fams.market.security_status_coverage_snapshot.v1'
  generatedAt: string
  requestedSymbols: number
  statusRows: number
  tradeabilityRows: number
  symbolsWithStatus: number
  symbolsWithTradeability: number
  officialProviderRows: number
  heuristicRows: number
  latestTradeDate: string | null
  fieldCoverage: {
    listingStatusPercent: number
    riskFlagPercent: number
    suspendedPercent: number
    tradabilityStatusPercent: number
    limitPricePercent: number
  }
  providerSummary: Array<{
    provider: string
    statusRows: number
    tradeabilityRows: number
  }>
  formalTradingStateRows: number
  warnings: string[]
}

type WarmupRecord = {
  asset: {
    id?: string | null
    symbol: string
    name: string
  }
  history: StockHistoryData[]
}

type QuoteListCanonicalItem = {
  code: string
  name: string
  source?: string
  fetchedAt?: string
  sourceProviders?: string[]
  sourceRefs?: string[]
  consensusScore?: number
  confidence?: 'high' | 'medium' | 'low' | 'insufficient'
  warnings?: string[]
}

type QuoteListCanonicalFile = {
  schemaVersion: 'fams.a_share_quote_list_canonical.v1'
  generatedAt?: string
  items?: QuoteListCanonicalItem[]
}

class SecurityStatusService {
  private readonly quoteListCanonicalPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/a-share-quote-list-canonical.json')
  private quoteListCanonicalPromise?: Promise<Map<string, QuoteListCanonicalItem>>

  private formatDate(value: Date | string | undefined | null) {
    if (!value) return null
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    return String(value).slice(0, 10)
  }

  private parseTradeDate(value: Date | string | undefined | null) {
    const formatted = this.formatDate(value)
    return formatted ? new Date(`${formatted}T00:00:00.000Z`) : null
  }

  private normalizeSymbol(symbol: string) {
    return symbol.trim()
  }

  private classifyName(name: string) {
    const normalized = name || ''
    const isSt = /(^|\s|\*)ST|退/.test(normalized)
    const isDelisted = /退/.test(normalized)
    return {
      isSt,
      isDelisted,
      listingStatus: isDelisted ? 'delisted' as const : 'listed' as const,
      riskFlag: isDelisted ? 'delisting_risk' as const : isSt ? 'st' as const : 'normal' as const,
    }
  }

  private async readQuoteListCanonical() {
    if (!this.quoteListCanonicalPromise) {
      this.quoteListCanonicalPromise = (async () => {
        try {
          const parsed = JSON.parse(await readFile(this.quoteListCanonicalPath, 'utf8')) as QuoteListCanonicalFile
          if (parsed.schemaVersion !== 'fams.a_share_quote_list_canonical.v1') return new Map<string, QuoteListCanonicalItem>()
          return new Map((parsed.items || [])
            .filter((item) => /^\d{6}$/.test(item.code))
            .map((item) => [item.code, item]))
        } catch {
          return new Map<string, QuoteListCanonicalItem>()
        }
      })()
    }
    return this.quoteListCanonicalPromise
  }

  private quoteListConfidence(item: QuoteListCanonicalItem) {
    const providers = new Set(item.sourceProviders || [])
    if ((item.confidence === 'high' || (item.consensusScore || 0) >= 90) && providers.size >= 2) return 0.82
    if ((item.confidence === 'medium' || (item.consensusScore || 0) >= 70) && providers.size >= 2) return 0.72
    if (providers.size >= 1) return 0.62
    return 0.5
  }

  private getTushareToken() {
    return process.env.FAMS_TUSHARE_TOKEN || process.env.TUSHARE_TOKEN || ''
  }

  private toTushareCode(symbol: string) {
    const normalized = this.normalizeSymbol(symbol)
    if (/^(6|9)/.test(normalized)) return `${normalized}.SH`
    if (/^(8|4)/.test(normalized)) return `${normalized}.BJ`
    return `${normalized}.SZ`
  }

  private fromTushareCode(tsCode: string) {
    return String(tsCode || '').slice(0, 6)
  }

  private async callTushare(apiName: string, params: Record<string, unknown>, fields: string) {
    const token = this.getTushareToken()
    if (!token) return null
    const response = await axios.post('http://api.tushare.pro', {
      api_name: apiName,
      token,
      params,
      fields,
    }, { timeout: 15000 })
    const data = response.data
    if (!data || data.code !== 0 || !data.data) {
      throw new Error(`Tushare ${apiName} failed: ${data?.msg || data?.code || 'unknown error'}`)
    }
    const fieldsList = Array.isArray(data.data.fields) ? data.data.fields : []
    return (data.data.items || []).map((item: unknown[]) => Object.fromEntries(fieldsList.map((field: string, index: number) => [field, item[index]])))
  }

  private tushareListingStatus(listStatus: unknown): SecurityStatusFact['listingStatus'] {
    if (listStatus === 'L') return 'listed'
    if (listStatus === 'D') return 'delisted'
    if (listStatus === 'P') return 'suspended_listing'
    return 'unknown'
  }

  private async fetchTushareStockBasicRows() {
    const statuses = ['L', 'D', 'P']
    const batches = await Promise.all(statuses.map(async (listStatus) => {
      try {
        const rows = await this.callTushare('stock_basic', { list_status: listStatus }, 'ts_code,name,list_status')
        return rows || []
      } catch {
        return []
      }
    }))
    return batches.flat()
  }

  async upsertTushareTradingStatus(symbols: string[], tradeDateText?: string) {
    const token = this.getTushareToken()
    const uniqueSymbols = Array.from(new Set(symbols.map((item) => this.normalizeSymbol(item)).filter((item) => /^\d{6}$/.test(item))))
    if (!token || uniqueSymbols.length === 0) return this.getCoverageSnapshot(uniqueSymbols)
    const tradeDate = tradeDateText || new Date().toISOString().slice(0, 10)
    const tushareTradeDate = tradeDate.replace(/-/g, '')
    const tsCodes = new Set(uniqueSymbols.map((symbol) => this.toTushareCode(symbol)))
    const sourceTimestamp = new Date()
    const [stockBasicRows, suspendRows, limitRows] = await Promise.all([
      this.fetchTushareStockBasicRows(),
      this.callTushare('suspend_d', { suspend_date: tushareTradeDate }, 'ts_code,suspend_date,resume_date,suspend_reason').catch(() => []),
      this.callTushare('stk_limit', { trade_date: tushareTradeDate }, 'ts_code,trade_date,up_limit,down_limit').catch(() => []),
    ])
    const basicBySymbol = new Map<string, any>()
    for (const row of stockBasicRows || []) {
      if (tsCodes.has(row.ts_code)) basicBySymbol.set(this.fromTushareCode(row.ts_code), row)
    }
    const suspendedBySymbol = new Map<string, any>()
    for (const row of suspendRows || []) {
      if (tsCodes.has(row.ts_code)) suspendedBySymbol.set(this.fromTushareCode(row.ts_code), row)
    }
    const limitBySymbol = new Map<string, any>()
    for (const row of limitRows || []) {
      if (tsCodes.has(row.ts_code)) limitBySymbol.set(this.fromTushareCode(row.ts_code), row)
    }
    const parsedTradeDate = this.parseTradeDate(tradeDate) || new Date(`${tradeDate}T00:00:00.000Z`)
    await prisma.$transaction(async (tx) => {
      for (const symbol of uniqueSymbols) {
        const basic = basicBySymbol.get(symbol)
        const suspended = suspendedBySymbol.get(symbol)
        const limit = limitBySymbol.get(symbol)
        const listingStatus = this.tushareListingStatus(basic?.list_status)
        const listed = listingStatus === 'listed'
        const isDelisted = listingStatus === 'delisted'
        const isSuspended = Boolean(suspended)
        const sourceRefsJson = JSON.stringify([{
          provider: 'tushare',
          apis: ['stock_basic:list_status=L/D/P', 'suspend_d', 'stk_limit'],
          tsCode: this.toTushareCode(symbol),
          tradeDate,
        }])
        const warnings = [
          ...(basic ? [] : ['Tushare stock_basic 未返回该标的，上市状态置信度降级。']),
          ...(limit ? [] : ['Tushare stk_limit 未返回该标的涨跌停价，涨跌停字段缺失。']),
        ]
        await tx.securityStatusDaily.upsert({
          where: {
            symbol_market_tradeDate_dataVersion: {
              symbol,
              market: 'CN',
              tradeDate: parsedTradeDate,
              dataVersion: 'security_status.v1',
            },
          },
          create: {
            symbol,
            market: 'CN',
            tradeDate: parsedTradeDate,
            listingStatus,
            riskFlag: isDelisted ? 'delisting_risk' : 'normal',
            isSt: false,
            isDelisted,
            isSuspended,
            provider: 'tushare',
            sourceTimestamp,
            confidence: basic && limit ? 0.92 : 0.78,
            sourceRefsJson,
            warningsJson: JSON.stringify(warnings),
            validationStatus: basic ? 'valid' : 'valid_with_warnings',
            dataVersion: 'security_status.v1',
          },
          update: {
            listingStatus,
            riskFlag: isDelisted ? 'delisting_risk' : 'normal',
            isSt: false,
            isDelisted,
            isSuspended,
            provider: 'tushare',
            sourceTimestamp,
            confidence: basic && limit ? 0.92 : 0.78,
            sourceRefsJson,
            warningsJson: JSON.stringify(warnings),
            validationStatus: basic ? 'valid' : 'valid_with_warnings',
          },
        })
        await tx.marketTradeabilityDaily.upsert({
          where: {
            symbol_market_tradeDate_dataVersion: {
              symbol,
              market: 'CN',
              tradeDate: parsedTradeDate,
              dataVersion: 'tradeability.v1',
            },
          },
          create: {
            symbol,
            market: 'CN',
            tradeDate: parsedTradeDate,
            isTradable: !isSuspended && listed,
            tradabilityStatus: isSuspended ? 'suspended' : listed ? 'tradable' : 'unknown',
            isSuspended,
            limitUp: Number.isFinite(Number(limit?.up_limit)) ? Number(limit.up_limit) : null,
            limitDown: Number.isFinite(Number(limit?.down_limit)) ? Number(limit.down_limit) : null,
            provider: 'tushare',
            sourceTimestamp,
            confidence: basic && limit ? 0.92 : 0.78,
            sourceRefsJson,
            warningsJson: JSON.stringify(warnings),
            qualityFlagsJson: JSON.stringify(limit ? ['formal_trading_state_provider'] : ['missing_limit_price']),
            validationStatus: limit ? 'valid' : 'valid_with_warnings',
            dataVersion: 'tradeability.v1',
          },
          update: {
            isTradable: !isSuspended && listed,
            tradabilityStatus: isSuspended ? 'suspended' : listed ? 'tradable' : 'unknown',
            isSuspended,
            limitUp: Number.isFinite(Number(limit?.up_limit)) ? Number(limit.up_limit) : null,
            limitDown: Number.isFinite(Number(limit?.down_limit)) ? Number(limit.down_limit) : null,
            provider: 'tushare',
            sourceTimestamp,
            confidence: basic && limit ? 0.92 : 0.78,
            sourceRefsJson,
            warningsJson: JSON.stringify(warnings),
            qualityFlagsJson: JSON.stringify(limit ? ['formal_trading_state_provider'] : ['missing_limit_price']),
            validationStatus: limit ? 'valid' : 'valid_with_warnings',
          },
        })
      }
    })
    return this.getCoverageSnapshot(uniqueSymbols)
  }

  private buildFacts(record: WarmupRecord) {
    const symbol = this.normalizeSymbol(record.asset.symbol)
    const latest = [...record.history]
      .filter((item) => item.date && Number.isFinite(item.close))
      .sort((left, right) => String(right.date).localeCompare(String(left.date)))[0]
    const tradeDate = this.parseTradeDate(latest?.date) || new Date(new Date().toISOString().slice(0, 10))
    const tradeDateText = this.formatDate(tradeDate) || new Date().toISOString().slice(0, 10)
    const nameClassification = this.classifyName(record.asset.name)
    const isSuspended = latest ? (latest.volume || 0) <= 0 : false
    const warnings = [
      '当前证券状态来自本地名称/K线启发式，不等同交易所正式状态。',
      ...(nameClassification.isSt ? ['名称命中 ST/退市风险规则。'] : []),
      ...(isSuspended ? ['最新 K 线成交量为 0，按停牌启发式处理。'] : []),
    ]
    const previous = record.history
      .filter((item) => item.date && String(item.date).slice(0, 10) < tradeDateText && Number.isFinite(item.close))
      .sort((left, right) => String(right.date).localeCompare(String(left.date)))[0]
    const previousClose = previous?.close && previous.close > 0 ? previous.close : latest?.close || null
    const limitUp = previousClose ? Number((previousClose * 1.1).toFixed(3)) : null
    const limitDown = previousClose ? Number((previousClose * 0.9).toFixed(3)) : null
    const securityStatus: SecurityStatusFact = {
      symbol,
      market: 'CN',
      tradeDate: tradeDateText,
      listingStatus: nameClassification.listingStatus,
      riskFlag: nameClassification.riskFlag,
      isSt: nameClassification.isSt,
      isDelisted: nameClassification.isDelisted,
      isSuspended,
      provider: 'heuristic',
      confidence: nameClassification.isSt || isSuspended ? 0.55 : 0.45,
      warnings,
    }
    const tradabilityStatus: MarketTradeabilityFact['tradabilityStatus'] = isSuspended
      ? 'suspended'
      : 'tradable'
    const tradeability: MarketTradeabilityFact = {
      symbol,
      market: 'CN',
      tradeDate: tradeDateText,
      isTradable: !isSuspended && !nameClassification.isDelisted,
      tradabilityStatus,
      isSuspended,
      limitUp,
      limitDown,
      provider: 'heuristic',
      confidence: isSuspended ? 0.55 : 0.45,
      warnings,
    }
    return { securityStatus, tradeability, tradeDate }
  }

  async upsertHeuristicFromRecords(records: WarmupRecord[]) {
    const quoteListCanonical = await this.readQuoteListCanonical()
    const facts = records
      .filter((record) => record.asset?.symbol && record.history.length > 0)
      .map((record) => {
        const built = this.buildFacts(record)
        const canonical = quoteListCanonical.get(built.securityStatus.symbol)
        if (!canonical) return { record, ...built, canonical: null as QuoteListCanonicalItem | null }
        const canonicalClassification = this.classifyName(canonical.name || record.asset.name)
        const providers = canonical.sourceProviders || []
        const warnings = [
          '证券状态来自 quote-list canonical 多源身份数据；停复牌/涨跌停仍需正式交易状态源复核。',
          ...(canonical.warnings || []),
          ...(providers.length < 2 ? ['quote-list canonical 少于两个来源，状态可信度降级。'] : []),
        ]
        const confidence = this.quoteListConfidence(canonical)
        const statusProvider = providers.includes('baostock') ? 'baostock' as const : 'quote_list_canonical' as const
        return {
          record,
          ...built,
          securityStatus: {
            ...built.securityStatus,
            listingStatus: canonicalClassification.listingStatus,
            riskFlag: canonicalClassification.riskFlag,
            isSt: canonicalClassification.isSt,
            isDelisted: canonicalClassification.isDelisted,
            provider: statusProvider,
            confidence,
            warnings,
          },
          tradeability: {
            ...built.tradeability,
            isTradable: !canonicalClassification.isDelisted && !built.tradeability.isSuspended,
            provider: 'quote_list_canonical' as const,
            confidence,
            warnings,
          },
          canonical: canonical as QuoteListCanonicalItem | null,
        }
      })
    if (facts.length === 0) return this.getCoverageSnapshot([])

    const transactionChunkSize = Math.max(50, Math.min(500, Number(process.env.FAMS_SECURITY_STATUS_UPSERT_CHUNK_SIZE || 250) || 250))
    for (let index = 0; index < facts.length; index += transactionChunkSize) {
      const chunk = facts.slice(index, index + transactionChunkSize)
      await prisma.$transaction(async (tx) => {
        for (const item of chunk) {
        const sourceRefsJson = JSON.stringify(item.canonical ? [
          {
            provider: 'quote_list_canonical',
            method: 'a_share_quote_list_canonical.v1',
            symbol: item.securityStatus.symbol,
            tradeDate: item.securityStatus.tradeDate,
            sourceProviders: item.canonical.sourceProviders || [],
            sourceRefs: item.canonical.sourceRefs || [],
            consensusScore: item.canonical.consensusScore ?? null,
            confidence: item.canonical.confidence || null,
          },
        ] : [{
          provider: 'heuristic',
          method: 'asset_name_and_latest_kline.v1',
          symbol: item.securityStatus.symbol,
          tradeDate: item.securityStatus.tradeDate,
        }])
        const warningsJson = JSON.stringify(item.securityStatus.warnings)
        await tx.securityStatusDaily.upsert({
          where: {
            symbol_market_tradeDate_dataVersion: {
              symbol: item.securityStatus.symbol,
              market: item.securityStatus.market,
              tradeDate: item.tradeDate,
              dataVersion: 'security_status.v1',
            },
          },
          create: {
            assetId: item.record.asset.id || null,
            symbol: item.securityStatus.symbol,
            market: item.securityStatus.market,
            tradeDate: item.tradeDate,
            listingStatus: item.securityStatus.listingStatus,
            riskFlag: item.securityStatus.riskFlag,
            isSt: item.securityStatus.isSt,
            isDelisted: item.securityStatus.isDelisted,
            isSuspended: item.securityStatus.isSuspended,
            provider: item.securityStatus.provider,
            sourceTimestamp: new Date(),
            confidence: item.securityStatus.confidence,
            sourceRefsJson,
            warningsJson,
            validationStatus: 'valid',
            dataVersion: 'security_status.v1',
          },
          update: {
            assetId: item.record.asset.id || null,
            listingStatus: item.securityStatus.listingStatus,
            riskFlag: item.securityStatus.riskFlag,
            isSt: item.securityStatus.isSt,
            isDelisted: item.securityStatus.isDelisted,
            isSuspended: item.securityStatus.isSuspended,
            provider: item.securityStatus.provider,
            sourceTimestamp: new Date(),
            confidence: item.securityStatus.confidence,
            sourceRefsJson,
            warningsJson,
            validationStatus: 'valid',
          },
        })
        await tx.marketTradeabilityDaily.upsert({
          where: {
            symbol_market_tradeDate_dataVersion: {
              symbol: item.tradeability.symbol,
              market: item.tradeability.market,
              tradeDate: item.tradeDate,
              dataVersion: 'tradeability.v1',
            },
          },
          create: {
            assetId: item.record.asset.id || null,
            symbol: item.tradeability.symbol,
            market: item.tradeability.market,
            tradeDate: item.tradeDate,
            isTradable: item.tradeability.isTradable,
            tradabilityStatus: item.tradeability.tradabilityStatus,
            isSuspended: item.tradeability.isSuspended,
            limitUp: item.tradeability.limitUp,
            limitDown: item.tradeability.limitDown,
            provider: item.tradeability.provider,
            sourceTimestamp: new Date(),
            confidence: item.tradeability.confidence,
            sourceRefsJson,
            warningsJson,
            qualityFlagsJson: JSON.stringify(item.canonical ? ['quote_list_canonical_provider', 'tradeability_requires_official_status_provider'] : ['heuristic_provider']),
            validationStatus: 'valid',
            dataVersion: 'tradeability.v1',
          },
          update: {
            assetId: item.record.asset.id || null,
            isTradable: item.tradeability.isTradable,
            tradabilityStatus: item.tradeability.tradabilityStatus,
            isSuspended: item.tradeability.isSuspended,
            limitUp: item.tradeability.limitUp,
            limitDown: item.tradeability.limitDown,
            provider: item.tradeability.provider,
            sourceTimestamp: new Date(),
            confidence: item.tradeability.confidence,
            sourceRefsJson,
            warningsJson,
            qualityFlagsJson: JSON.stringify(item.canonical ? ['quote_list_canonical_provider', 'tradeability_requires_official_status_provider'] : ['heuristic_provider']),
            validationStatus: 'valid',
          },
        })
        }
      }, { maxWait: 10000, timeout: 20000 })
    }

    return this.getCoverageSnapshot(facts.map((item) => item.securityStatus.symbol))
  }

  async getLatestFacts(symbols: string[]) {
    const uniqueSymbols = Array.from(new Set(symbols.map((item) => this.normalizeSymbol(item)).filter(Boolean)))
    if (uniqueSymbols.length === 0) return new Map<string, { securityStatus?: SecurityStatusFact; tradeability?: MarketTradeabilityFact }>()
    const [statuses, tradeabilities] = await Promise.all([
      prisma.securityStatusDaily.findMany({
        where: { symbol: { in: uniqueSymbols }, market: 'CN', dataVersion: 'security_status.v1' },
        orderBy: [{ tradeDate: 'desc' }],
      }),
      prisma.marketTradeabilityDaily.findMany({
        where: { symbol: { in: uniqueSymbols }, market: 'CN', dataVersion: 'tradeability.v1' },
        orderBy: [{ tradeDate: 'desc' }],
      }),
    ])
    const result = new Map<string, { securityStatus?: SecurityStatusFact; tradeability?: MarketTradeabilityFact }>()
    for (const row of statuses) {
      if (result.get(row.symbol)?.securityStatus) continue
      result.set(row.symbol, {
        ...result.get(row.symbol),
        securityStatus: {
          symbol: row.symbol,
          market: row.market,
          tradeDate: this.formatDate(row.tradeDate) || '',
          listingStatus: row.listingStatus as SecurityStatusFact['listingStatus'],
          riskFlag: (row.riskFlag || 'unknown') as SecurityStatusFact['riskFlag'],
          isSt: row.isSt,
          isDelisted: row.isDelisted,
          isSuspended: row.isSuspended,
          provider: row.provider as SecurityStatusFact['provider'],
          confidence: row.confidence,
          warnings: JSON.parse(row.warningsJson || '[]'),
        },
      })
    }
    for (const row of tradeabilities) {
      if (result.get(row.symbol)?.tradeability) continue
      result.set(row.symbol, {
        ...result.get(row.symbol),
        tradeability: {
          symbol: row.symbol,
          market: row.market,
          tradeDate: this.formatDate(row.tradeDate) || '',
          isTradable: row.isTradable,
          tradabilityStatus: row.tradabilityStatus as MarketTradeabilityFact['tradabilityStatus'],
          isSuspended: row.isSuspended,
          limitUp: row.limitUp,
          limitDown: row.limitDown,
          provider: row.provider as SecurityStatusFact['provider'],
          confidence: row.confidence,
          warnings: JSON.parse(row.warningsJson || '[]'),
        },
      })
    }
    return result
  }

  async getCoverageSnapshot(symbols: string[] = []): Promise<SecurityStatusCoverageSnapshot> {
    const uniqueSymbols = Array.from(new Set(symbols.map((item) => this.normalizeSymbol(item)).filter(Boolean)))
    const symbolFilter = uniqueSymbols.length > 0 ? { in: uniqueSymbols } : undefined
    const [statusRows, tradeabilityRows] = await Promise.all([
      prisma.securityStatusDaily.findMany({
        where: { market: 'CN', dataVersion: 'security_status.v1', ...(symbolFilter ? { symbol: symbolFilter } : {}) },
      }),
      prisma.marketTradeabilityDaily.findMany({
        where: { market: 'CN', dataVersion: 'tradeability.v1', ...(symbolFilter ? { symbol: symbolFilter } : {}) },
      }),
    ])
    const symbolsWithStatus = new Set(statusRows.map((item) => item.symbol))
    const symbolsWithTradeability = new Set(tradeabilityRows.map((item) => item.symbol))
    const providers = new Map<string, { statusRows: number; tradeabilityRows: number }>()
    for (const row of statusRows) {
      const current = providers.get(row.provider) || { statusRows: 0, tradeabilityRows: 0 }
      current.statusRows += 1
      providers.set(row.provider, current)
    }
    for (const row of tradeabilityRows) {
      const current = providers.get(row.provider) || { statusRows: 0, tradeabilityRows: 0 }
      current.tradeabilityRows += 1
      providers.set(row.provider, current)
    }
    const officialProviderRows = [...statusRows, ...tradeabilityRows].filter((item) => item.provider !== 'heuristic').length
    const heuristicRows = [...statusRows, ...tradeabilityRows].filter((item) => item.provider === 'heuristic').length
    const formalTradingStateRows = tradeabilityRows.filter((item) => ['exchange_public', 'tushare'].includes(item.provider)).length
    const latestTradeDate = [...statusRows.map((item) => item.tradeDate), ...tradeabilityRows.map((item) => item.tradeDate)]
      .sort((left, right) => right.getTime() - left.getTime())[0]
    const denominator = Math.max(uniqueSymbols.length || symbolsWithStatus.size || statusRows.length, 1)
    const pct = (value: number) => Number(((value / denominator) * 100).toFixed(2))
    const uniqueCoverage = <T extends { symbol: string }>(rows: T[], predicate: (row: T) => boolean) =>
      new Set(rows.filter(predicate).map((item) => item.symbol)).size
    return {
      schemaVersion: 'fams.market.security_status_coverage_snapshot.v1',
      generatedAt: new Date().toISOString(),
      requestedSymbols: uniqueSymbols.length,
      statusRows: statusRows.length,
      tradeabilityRows: tradeabilityRows.length,
      symbolsWithStatus: symbolsWithStatus.size,
      symbolsWithTradeability: symbolsWithTradeability.size,
      officialProviderRows,
      heuristicRows,
      latestTradeDate: this.formatDate(latestTradeDate) || null,
      fieldCoverage: {
        listingStatusPercent: pct(uniqueCoverage(statusRows, (item) => item.listingStatus !== 'unknown')),
        riskFlagPercent: pct(uniqueCoverage(statusRows, (item) => Boolean(item.riskFlag) && item.riskFlag !== 'unknown')),
        suspendedPercent: pct(uniqueCoverage(statusRows, (item) => typeof item.isSuspended === 'boolean')),
        tradabilityStatusPercent: pct(uniqueCoverage(tradeabilityRows, (item) => item.tradabilityStatus !== 'unknown')),
        limitPricePercent: pct(uniqueCoverage(tradeabilityRows, (item) => item.limitUp !== null && item.limitDown !== null)),
      },
      providerSummary: Array.from(providers.entries()).map(([provider, summary]) => ({ provider, ...summary })),
      formalTradingStateRows,
      warnings: [
        ...(heuristicRows > 0 ? ['存在 heuristic provider 行，只能作为过渡事实层，不能视为正式 provider。'] : []),
        ...(officialProviderRows === 0 ? ['尚无交易所/Tushare/独立正式源行。'] : []),
        ...(formalTradingStateRows === 0 ? ['尚无交易所/Tushare 正式交易状态行；停复牌和涨跌停仍不能生产放行。'] : []),
      ],
    }
  }
}

export const securityStatusService = new SecurityStatusService()
