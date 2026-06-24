import { prisma } from '../../db/prisma.js'
import { getJsonWithCurlOnly } from '../../utils/httpJson.js'

type BackfillTarget = {
  assetId: string
  symbol: string
  assetName: string
  assetType: string
}

type FundHistoryRecord = {
  date: string
  nav: number
  navChangePercent: number
}

export type AlternativeHistoryBackfillReport = {
  schemaVersion: 'fivd.r.alternative_history_backfill_report.v1'
  generatedAt: string
  targets: Array<{
    symbol: string
    assetName: string
    assetType: string
    mode: 'fund_nav_history' | 'gold_fund_price_proxy'
    provider: string
    requestedPeriod: '6M'
    fetchedRecords: number
    insertedRows: number
    skippedRows: number
    status: 'completed' | 'partial' | 'failed'
    warnings: string[]
  }>
  summary: {
    targetCount: number
    completedTargets: number
    partialTargets: number
    failedTargets: number
    insertedRows: number
  }
}

const GOLD_FUND_PRICE_FACTORS: Record<string, number> = {
  '002611': 318,
}

function normalizeSymbol(symbol: string) {
  return String(symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
}

function parseDate(date: string) {
  const parsed = new Date(`${date}T15:00:00.000+08:00`)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

class AlternativeAssetHistoryBackfillService {
  async backfillUserOpenAlternativeAssets(userId = 'default'): Promise<AlternativeHistoryBackfillReport> {
    const positions = await prisma.position.findMany({
      where: {
        userId,
        status: 'open',
        asset: { type: { in: ['fund', 'bond', 'bond_fund', 'etf', 'gold'] } },
      },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    })
    const uniqueTargets = new Map<string, BackfillTarget>()
    for (const position of positions) {
      uniqueTargets.set(position.assetId, {
        assetId: position.assetId,
        symbol: normalizeSymbol(position.asset.symbol),
        assetName: position.asset.name,
        assetType: position.asset.type,
      })
    }
    const targets = []
    for (const target of uniqueTargets.values()) {
      targets.push(await this.backfillTarget(target))
    }
    return this.report(targets)
  }

  async backfillTarget(target: BackfillTarget): Promise<AlternativeHistoryBackfillReport['targets'][number]> {
    if (target.assetType === 'gold') {
      return this.backfillGoldFundProxy(target)
    }
    return this.backfillFundNav(target)
  }

  private async backfillFundNav(target: BackfillTarget): Promise<AlternativeHistoryBackfillReport['targets'][number]> {
    const warnings: string[] = []
    const records = await this.fetchEastmoneyFundHistory(target.symbol, 180)
    let insertedRows = 0
    let skippedRows = 0
    for (const record of records) {
      const timestamp = parseDate(record.date)
      if (!timestamp || !Number.isFinite(record.nav) || record.nav <= 0) {
        skippedRows += 1
        continue
      }
      const inserted = await this.insertPriceHistoryOnce({
        assetId: target.assetId,
        timestamp,
        closePrice: record.nav,
        source: 'eastmoney_nav_history',
      })
      if (inserted) insertedRows += 1
      else skippedRows += 1
    }
    if (records.length < 20) warnings.push('东方财富历史净值返回样本少于 20 条。')
    return {
      symbol: target.symbol,
      assetName: target.assetName,
      assetType: target.assetType,
      mode: 'fund_nav_history',
      provider: 'eastmoney_lsjz',
      requestedPeriod: '6M',
      fetchedRecords: records.length,
      insertedRows,
      skippedRows,
      status: records.length >= 20 ? 'completed' : records.length > 0 ? 'partial' : 'failed',
      warnings,
    }
  }

  private async backfillGoldFundProxy(target: BackfillTarget): Promise<AlternativeHistoryBackfillReport['targets'][number]> {
    const warnings: string[] = []
    const factor = GOLD_FUND_PRICE_FACTORS[target.symbol]
    if (!factor) {
      return {
        symbol: target.symbol,
        assetName: target.assetName,
        assetType: target.assetType,
        mode: 'gold_fund_price_proxy',
        provider: 'eastmoney_lsjz',
        requestedPeriod: '6M',
        fetchedRecords: 0,
        insertedRows: 0,
        skippedRows: 0,
        status: 'failed',
        warnings: ['缺少黄金基金净值到金价/克的 conversion factor。'],
      }
    }
    const records = await this.fetchEastmoneyFundHistory(target.symbol, 180)
    let insertedRows = 0
    let skippedRows = 0
    for (const record of records) {
      const timestamp = parseDate(record.date)
      const goldPriceProxy = record.nav * factor
      if (!timestamp || !Number.isFinite(goldPriceProxy) || goldPriceProxy <= 0) {
        skippedRows += 1
        continue
      }
      const inserted = await this.insertPriceHistoryOnce({
        assetId: target.assetId,
        timestamp,
        closePrice: Number(goldPriceProxy.toFixed(4)),
        source: 'goldFund',
      })
      if (inserted) insertedRows += 1
      else skippedRows += 1
    }
    if (records.length < 20) warnings.push('黄金代理基金历史净值返回样本少于 20 条。')
    return {
      symbol: target.symbol,
      assetName: target.assetName,
      assetType: target.assetType,
      mode: 'gold_fund_price_proxy',
      provider: 'eastmoney_lsjz',
      requestedPeriod: '6M',
      fetchedRecords: records.length,
      insertedRows,
      skippedRows,
      status: records.length >= 20 ? 'completed' : records.length > 0 ? 'partial' : 'failed',
      warnings,
    }
  }

  private async fetchEastmoneyFundHistory(fundCode: string, days: number): Promise<FundHistoryRecord[]> {
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    const records: FundHistoryRecord[] = []
    const pageSize = 20
    const startDateText = startDate.toISOString().slice(0, 10)
    const endDateText = endDate.toISOString().slice(0, 10)
    for (let pageIndex = 1; pageIndex <= 12; pageIndex += 1) {
      const data = await getJsonWithCurlOnly<any>('https://api.fund.eastmoney.com/f10/lsjz', {
        timeout: 20000,
        params: {
          fundCode,
          pageIndex,
          pageSize,
          startDate: startDateText,
          endDate: endDateText,
        },
        headers: {
          Referer: 'https://fund.eastmoney.com/',
          'User-Agent': 'curl/8.5.0',
        },
      })
      const rows = data?.Data?.LSJZList || []
      if (!Array.isArray(rows) || rows.length === 0) break
      records.push(...rows
        .map((item: any) => ({
          date: String(item.FSRQ || ''),
          nav: Number(item.DWJZ),
          navChangePercent: Number(item.JZZZL || 0),
        }))
        .filter((item: FundHistoryRecord) => item.date && Number.isFinite(item.nav) && item.nav > 0))
      if (rows.length < pageSize) break
    }
    return records
      .sort((left: FundHistoryRecord, right: FundHistoryRecord) => left.date.localeCompare(right.date))
  }

  private async insertPriceHistoryOnce(input: {
    assetId: string
    timestamp: Date
    closePrice: number
    source: string
  }) {
    const start = new Date(input.timestamp)
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    const existing = await prisma.priceHistory.findFirst({
      where: {
        assetId: input.assetId,
        source: input.source,
        timestamp: {
          gte: start,
          lt: end,
        },
      },
    })
    if (existing) return false
    await prisma.priceHistory.create({
      data: {
        assetId: input.assetId,
        timestamp: input.timestamp,
        closePrice: input.closePrice,
        source: input.source,
        isValid: true,
      },
    })
    return true
  }

  private report(targets: AlternativeHistoryBackfillReport['targets']): AlternativeHistoryBackfillReport {
    return {
      schemaVersion: 'fivd.r.alternative_history_backfill_report.v1',
      generatedAt: new Date().toISOString(),
      targets,
      summary: {
        targetCount: targets.length,
        completedTargets: targets.filter((target) => target.status === 'completed').length,
        partialTargets: targets.filter((target) => target.status === 'partial').length,
        failedTargets: targets.filter((target) => target.status === 'failed').length,
        insertedRows: targets.reduce((sum, target) => sum + target.insertedRows, 0),
      },
    }
  }
}

export const alternativeAssetHistoryBackfillService = new AlternativeAssetHistoryBackfillService()
