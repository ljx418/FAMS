import { prisma } from '../../db/prisma.js'

export type ResolvedAssetType = 'stock' | 'fund' | 'bond' | 'gold' | 'cash' | 'crypto' | 'etf' | 'reit' | 'unknown'
export type ResolvedMarket = 'CN' | 'HK' | 'US' | 'LOCAL' | 'GLOBAL' | 'UNKNOWN'

export interface AssetIdentityResolution {
  input: string
  normalizedSymbol: string
  name?: string
  assetType: ResolvedAssetType
  market: ResolvedMarket
  exchange?: string | null
  currency: string
  confidenceScore: number
  matchedAsset?: {
    id: string
    symbol: string
    name: string
    type: string
    exchange?: string | null
    currency: string
    lastPrice?: number | null
    lastUpdated?: string | null
  } | null
  candidates: Array<{
    id: string
    symbol: string
    name: string
    type: string
    exchange?: string | null
    currency: string
    matchReason: string
  }>
  evidence: string[]
  warnings: string[]
}

const EXCHANGE_TRADED_FUND_PREFIXES = /^(159|510|511|512|513|515|516|517|518|520|560|561|562|563|588|589)\d{3}$/
const CASH_PREFIX = /^现金-/

class AssetIdentityResolver {
  private normalizeInput(input: string) {
    return String(input || '').trim().toUpperCase()
  }

  private resolveByPattern(symbol: string, name?: string | null): {
    assetType: ResolvedAssetType
    market: ResolvedMarket
    exchange: string | null
    currency: string
    confidenceScore: number
    evidence: string[]
    warnings: string[]
  } {
    const evidence: string[] = []
    const warnings: string[] = []
    const lowerName = String(name || '').toLowerCase()

    let assetType: ResolvedAssetType = 'unknown'
    let market: ResolvedMarket = 'UNKNOWN'
    let exchange: string | null = null
    let currency = 'CNY'
    let confidenceScore = 0.35

    if (!symbol) {
      warnings.push('输入为空，无法识别标的。')
      return { assetType, market, exchange, currency, confidenceScore: 0.05, evidence, warnings }
    }

    if (CASH_PREFIX.test(symbol) || lowerName.includes('现金') || lowerName.includes('银行卡') || lowerName.includes('余额宝')) {
      assetType = 'cash'
      market = 'LOCAL'
      exchange = 'LOCAL'
      confidenceScore = 0.95
      evidence.push('现金类名称或代码命中本地现金规则。')
      return { assetType, market, exchange, currency, confidenceScore, evidence, warnings }
    }

    if (lowerName.includes('黄金') || lowerName.includes('gold') || symbol === '002611') {
      assetType = 'gold'
      market = 'CN'
      exchange = 'CN'
      confidenceScore = 0.78
      evidence.push('名称或代码命中黄金类规则。')
    }

    if (symbol.endsWith('.HK') || /^\d{5}$/.test(symbol)) {
      assetType = EXCHANGE_TRADED_FUND_PREFIXES.test(symbol) || lowerName.includes('etf') ? 'etf' : 'stock'
      market = 'HK'
      exchange = 'HK'
      currency = 'HKD'
      confidenceScore = Math.max(confidenceScore, 0.78)
      evidence.push('代码命中港股格式规则。')
    } else if (/^[A-Z]{1,6}$/.test(symbol)) {
      assetType = 'stock'
      market = 'US'
      exchange = 'US'
      currency = 'USD'
      confidenceScore = Math.max(confidenceScore, 0.7)
      evidence.push('代码命中美股字母 ticker 规则。')
    } else if (/^\d{6}$/.test(symbol)) {
      market = 'CN'
      currency = 'CNY'
      if (EXCHANGE_TRADED_FUND_PREFIXES.test(symbol)) {
        assetType = 'etf'
        exchange = symbol.startsWith('159') ? 'SZ' : 'SH'
        confidenceScore = Math.max(confidenceScore, 0.92)
        evidence.push('6位代码命中交易所 ETF 前缀规则。')
      } else if (/^(60|68|90)\d{4}$/.test(symbol)) {
        assetType = 'stock'
        exchange = 'SH'
        confidenceScore = Math.max(confidenceScore, 0.9)
        evidence.push('6位代码命中沪市股票前缀规则。')
      } else if (/^(00|30|20)\d{4}$/.test(symbol)) {
        assetType = 'stock'
        exchange = 'SZ'
        confidenceScore = Math.max(confidenceScore, 0.9)
        evidence.push('6位代码命中深市股票前缀规则。')
      } else if (/^(01|02|04|07)\d{4}$/.test(symbol)) {
        assetType = lowerName.includes('债') ? 'bond' : 'fund'
        exchange = 'CN'
        confidenceScore = Math.max(confidenceScore, lowerName ? 0.82 : 0.68)
        evidence.push('6位代码命中场外基金/债基常见前缀规则。')
      } else {
        warnings.push('6位代码未命中明确股票、ETF、基金或债券前缀，需要本地资产或 provider 进一步确认。')
      }
    }

    if (lowerName.includes('etf') && assetType === 'fund') {
      assetType = 'etf'
      confidenceScore = Math.max(confidenceScore, 0.85)
      evidence.push('名称包含 ETF，类型修正为 ETF。')
    }
    if (lowerName.includes('债')) {
      assetType = 'bond'
      exchange = 'CN'
      market = 'CN'
      confidenceScore = Math.max(confidenceScore, 0.82)
      evidence.push('名称包含债，类型修正为债券/债基。')
    }

    return { assetType, market, exchange, currency, confidenceScore, evidence, warnings }
  }

  async resolve(input: string): Promise<AssetIdentityResolution> {
    const normalizedSymbol = this.normalizeInput(input)
    const warnings: string[] = []
    const evidence: string[] = []

    const exactAsset = await prisma.asset.findFirst({
      where: {
        OR: [
          { symbol: { equals: normalizedSymbol } },
          { name: { equals: input.trim() } },
        ],
      },
    })

    const candidates = await prisma.asset.findMany({
      where: {
        OR: [
          { symbol: { contains: normalizedSymbol } },
          { name: { contains: input.trim() } },
        ],
      },
      orderBy: { symbol: 'asc' },
      take: 8,
    })

    const localName = exactAsset?.name || candidates[0]?.name || undefined
    const pattern = this.resolveByPattern(normalizedSymbol, localName)
    evidence.push(...pattern.evidence)
    warnings.push(...pattern.warnings)

    let assetType = pattern.assetType
    let market = pattern.market
    let exchange = pattern.exchange
    let currency = pattern.currency
    let confidenceScore = pattern.confidenceScore

    if (exactAsset) {
      evidence.push('命中本地资产表精确匹配。')
      const localType = (exactAsset.type as ResolvedAssetType) || assetType
      if (
        (localType === 'fund' || localType === 'bond') &&
        (assetType === 'stock' || assetType === 'etf') &&
        !EXCHANGE_TRADED_FUND_PREFIXES.test(normalizedSymbol)
      ) {
        warnings.push(`本地资产类型为 ${localType}，代码/名称规则识别为 ${assetType}；非交易所 ETF 前缀，查询按本地类型执行。`)
        evidence.push('本地类型与规则类型冲突，非交易所 ETF 前缀下优先保留本地 fund/bond 类型，避免 ETF 联接基金误走股票行情路径。')
        assetType = localType
      } else if (assetType !== 'unknown' && localType !== assetType) {
        warnings.push(`本地资产类型为 ${localType}，但代码/名称规则识别为 ${assetType}，查询按规则类型执行。`)
        evidence.push('本地类型与规则类型冲突，保留规则识别结果以避免行情路径误选。')
      } else {
        assetType = localType
      }
      exchange = assetType === 'fund' || assetType === 'bond' ? 'CN' : (exactAsset.exchange || exchange)
      currency = exactAsset.currency || currency
      confidenceScore = Math.max(confidenceScore, 0.96)
      if (exchange === 'HK') market = 'HK'
      else if (exchange === 'US') market = 'US'
      else if (assetType === 'cash') market = 'LOCAL'
      else if (assetType === 'fund' || assetType === 'bond' || assetType === 'etf') market = market === 'UNKNOWN' ? 'CN' : market
      else if (market === 'UNKNOWN') market = 'CN'
    } else if (candidates.length > 0) {
      evidence.push('命中本地资产表模糊匹配候选。')
      confidenceScore = Math.max(confidenceScore, 0.62)
      warnings.push('仅命中模糊候选，请确认具体标的。')
    }

    if (assetType === 'unknown') {
      warnings.push('无法明确识别资产类型，禁止静默按股票处理。')
    }

    return {
      input,
      normalizedSymbol,
      name: exactAsset?.name || localName,
      assetType,
      market,
      exchange,
      currency,
      confidenceScore: Number(confidenceScore.toFixed(2)),
      matchedAsset: exactAsset ? {
        id: exactAsset.id,
        symbol: exactAsset.symbol,
        name: exactAsset.name,
        type: exactAsset.type,
        exchange: exactAsset.exchange,
        currency: exactAsset.currency,
        lastPrice: exactAsset.lastPrice,
        lastUpdated: exactAsset.lastUpdated?.toISOString() || null,
      } : null,
      candidates: candidates.map((asset) => ({
        id: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        type: asset.type,
        exchange: asset.exchange,
        currency: asset.currency,
        matchReason: asset.symbol === normalizedSymbol ? 'symbol_exact' : 'contains',
      })),
      evidence,
      warnings: [...new Set(warnings)],
    }
  }
}

export const assetIdentityResolver = new AssetIdentityResolver()
