import { prisma } from '../../db/prisma.js'
import { getJsonWithCurlOnly, getTextWithCurlOnly } from '../../utils/httpJson.js'
import { ensureUser } from '../../utils/user.js'
import {
  DEFAULT_MARKET_DATA_AFTER_CLOSE_MINUTES,
  DEFAULT_MARKET_DATA_TIMEZONE,
  marketDataFreshnessService,
} from '../market-data/marketDataFreshnessService.js'
import {
  buildRelativeRotationSeries,
  RELATIVE_ROTATION_FORMULA_VERSION,
  relativeRotationService,
  type RelativeRotationFrequency,
  type RotationInputPoint,
} from './relativeRotationService.js'

type PortfolioGroupKey = 'all' | 'cn_equity' | 'hk_equity' | 'gold' | 'bond' | 'cash'

const GROUPS: Record<PortfolioGroupKey, {
  label: string
  benchmarkSymbol: string | null
  benchmarkName: string | null
  market: 'CN' | 'HK'
  benchmarkKind: 'multi_asset_composite' | 'price_index' | 'exchange_proxy' | 'not_applicable'
}> = {
  all: { label: '全部持仓', benchmarkSymbol: 'MIX_5_25_25_45', benchmarkName: '目标组合5/25/25/45（价格代理）', market: 'CN', benchmarkKind: 'multi_asset_composite' },
  cn_equity: { label: 'A股权益', benchmarkSymbol: '000300.SH', benchmarkName: '沪深300价格指数', market: 'CN', benchmarkKind: 'price_index' },
  hk_equity: { label: '港股权益', benchmarkSymbol: '^HSI', benchmarkName: '恒生指数', market: 'HK', benchmarkKind: 'price_index' },
  gold: { label: '黄金跟踪差', benchmarkSymbol: '518880', benchmarkName: '华安黄金ETF（同类跟踪代理）', market: 'CN', benchmarkKind: 'exchange_proxy' },
  bond: { label: '债券', benchmarkSymbol: '511010', benchmarkName: '国债ETF（代理基准）', market: 'CN', benchmarkKind: 'exchange_proxy' },
  cash: { label: '现金', benchmarkSymbol: null, benchmarkName: null, market: 'CN', benchmarkKind: 'not_applicable' },
}

const isoDate = (date: Date) => date.toISOString().slice(0, 10)

const fundTradeDateFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

export function fundTradeDateFromTimestamp(value: number | Date) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error('Invalid fund NAV timestamp')
  return fundTradeDateFormatter.format(date)
}

function groupFor(position: { tags: string; labels: string; asset: { symbol: string; type: string } }): PortfolioGroupKey {
  const markers = `${position.tags} ${position.labels}`
  if (position.asset.type === 'cash' || markers.includes('资产桶:现金') || markers.includes('交易现金')) return 'cash'
  if (position.asset.symbol === '002611' || markers.includes('资产桶:黄金')) return 'gold'
  if (position.asset.type === 'bond' || markers.includes('资产桶:债券')) return 'bond'
  if (['021634', '513770'].includes(position.asset.symbol) || markers.includes('非A股')) return 'hk_equity'
  return 'cn_equity'
}

function freshnessFromLag(lag: number | null) {
  if (lag === null) return 'unknown' as const
  if (lag === 0) return 'fresh' as const
  if (lag === 1) return 'delayed' as const
  return 'stale' as const
}

function businessDayLag(older: string | null, newer: string | null) {
  if (!older || !newer) return null
  if (older >= newer) return 0
  const cursor = new Date(`${older}T00:00:00.000Z`)
  const end = new Date(`${newer}T00:00:00.000Z`)
  let count = 0
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1)
    const day = cursor.getUTCDay()
    if (day !== 0 && day !== 6) count += 1
  }
  return count
}

class PortfolioRelativeRotationService {
  private async loadCanonical(symbol: string, preferredAdjustType: 'qfq' | 'none', days: number): Promise<RotationInputPoint[]> {
    const preferred = await prisma.marketBarCanonical.findMany({
      where: { symbol, timeframe: '1d', adjustType: preferredAdjustType, closePrice: { gt: 0 } },
      orderBy: { tradeDate: 'desc' },
      take: days,
    })
    const rows = preferred.length > 0 ? preferred : await prisma.marketBarCanonical.findMany({
      where: { symbol, timeframe: '1d', closePrice: { gt: 0 } },
      orderBy: { tradeDate: 'desc' },
      take: days,
    })
    const byDate = new Map<string, RotationInputPoint>()
    for (const row of rows) {
      const date = isoDate(row.tradeDate)
      if (!byDate.has(date)) byDate.set(date, { date, close: row.closePrice })
    }
    return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date)).slice(-days)
  }

  private async loadFundHistory(assetId: string, days: number): Promise<RotationInputPoint[]> {
    const rows = await prisma.priceHistory.findMany({
      where: { assetId, source: 'eastmoney_cumulative_nav', isValid: true, closePrice: { gt: 0 } },
      orderBy: { timestamp: 'desc' },
      take: days,
    })
    return rows.reverse().map((row) => ({ date: isoDate(row.timestamp), close: row.closePrice }))
  }

  private async buildTargetMixBenchmark(days: number) {
    const components = [
      { key: 'equity', symbol: '000300.SH', name: '沪深300价格指数', weight: 45, adjustType: 'none' as const },
      { key: 'gold', symbol: '518880', name: '华安黄金ETF', weight: 25, adjustType: 'qfq' as const },
      { key: 'bond', symbol: '511010', name: '国债ETF', weight: 25, adjustType: 'qfq' as const },
    ] as const
    const histories = await Promise.all(components.map(async (component) => ({
      ...component,
      points: await this.loadCanonical(component.symbol, component.adjustType, days),
    })))
    const maps = histories.map((component) => new Map(component.points.map((point) => [point.date, point.close])))
    const commonDates = histories[0].points
      .map((point) => point.date)
      .filter((date) => maps.every((map) => map.has(date)))
      .sort()
    const points: RotationInputPoint[] = []
    let level = 100
    for (let index = 0; index < commonDates.length; index += 1) {
      const date = commonDates[index]
      if (index > 0) {
        const previousDate = commonDates[index - 1]
        const marketReturn = histories.reduce((sum, component, componentIndex) => {
          const current = maps[componentIndex].get(date)!
          const previous = maps[componentIndex].get(previousDate)!
          return sum + ((component.weight / 100) * ((current / previous) - 1))
        }, 0)
        const calendarDays = Math.max(1, Math.round(
          (new Date(`${date}T00:00:00.000Z`).getTime() - new Date(`${previousDate}T00:00:00.000Z`).getTime()) / 86_400_000,
        ))
        const cashReturn = 0.05 * (Math.pow(1.01, calendarDays / 365) - 1)
        level *= 1 + marketReturn + cashReturn
      }
      points.push({ date, close: level })
    }
    return {
      points,
      components: [
        { key: 'cash', symbol: 'CNY_FIXED_1PCT', name: '现金年化1%代理', weight: 5, sampleDays: commonDates.length },
        ...histories.map((component) => ({
          key: component.key,
          symbol: component.symbol,
          name: component.name,
          weight: component.weight,
          sampleDays: component.points.length,
        })),
      ],
    }
  }

  private cashItem(position: any, benchmarkSampleDays = 0) {
    return {
      targetKey: `ASSET:${position.assetId}`,
      sources: ['holding'], positionId: position.id, assetId: position.assetId, watchlistItemId: null, deletable: false,
      market: 'CN', symbol: position.asset.symbol, name: position.asset.name, assetType: position.asset.type,
      dataStatus: 'not_applicable', readiness: 'not_applicable', freshness: 'not_applicable', freshnessLag: null,
      assetAsOfDate: null, coveragePercent: 0, sampleDays: 0, benchmarkSampleDays, firstPointDate: null,
      lastPointDate: null, commonAsOfDate: null, refreshedAt: null, sourceProviders: [], points: [],
      blockers: ['现金类资产不适用相对轮动坐标。'], warnings: [], formulaSufficient: false,
      latestQuadrant: null, gateEligible: false, gateReason: 'not_applicable', alignedDailyObservations: 0,
    }
  }

  private parseCumulativeNav(text: string) {
    const cumulative = text.match(/var\s+Data_ACWorthTrend\s*=\s*(\[[\s\S]*?\]);/)
    if (!cumulative) throw new Error('Eastmoney cumulative NAV series is missing')
    const rows = JSON.parse(cumulative[1]) as Array<[number, number]>
    return rows.map(([timestamp, value]) => ({
      tradeDate: fundTradeDateFromTimestamp(timestamp),
      closePrice: Number(value),
    })).filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(row.tradeDate) && Number.isFinite(row.closePrice) && row.closePrice > 0)
  }

  private async refreshFund(assetId: string, symbol: string) {
    const text = await getTextWithCurlOnly(`https://fund.eastmoney.com/pingzhongdata/${symbol}.js`, {
      timeout: 25_000,
      params: { v: Date.now() },
      headers: { Referer: 'https://fund.eastmoney.com/', 'User-Agent': 'curl/8.5.0' },
    })
    const rows = this.parseCumulativeNav(text)
    const latest = await getJsonWithCurlOnly<any>('https://api.fund.eastmoney.com/f10/lsjz', {
      timeout: 20_000,
      params: { fundCode: symbol, pageIndex: 1, pageSize: 20 },
      headers: { Referer: 'https://fund.eastmoney.com/', 'User-Agent': 'curl/8.5.0' },
    })
    const byDate = new Map(rows.map((row) => [row.tradeDate, row]))
    for (const item of latest?.Data?.LSJZList || []) {
      const date = String(item.FSRQ || '')
      const closePrice = Number(item.LJJZ)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(closePrice) || closePrice <= 0) continue
      byDate.set(date, { tradeDate: date, closePrice })
    }
    const mergedRows = Array.from(byDate.values()).sort((left, right) => left.tradeDate.localeCompare(right.tradeDate))
    await prisma.$transaction(async (tx) => {
      await tx.priceHistory.deleteMany({ where: { assetId, source: 'eastmoney_cumulative_nav' } })
      await tx.priceHistory.createMany({
        data: mergedRows.map((row) => ({
          assetId,
          timestamp: new Date(`${row.tradeDate}T00:00:00.000Z`),
          closePrice: row.closePrice,
          source: 'eastmoney_cumulative_nav',
          isValid: true,
        })),
      })
    })
    return {
      symbol,
      source: 'eastmoney_pingzhongdata_Data_ACWorthTrend',
      records: mergedRows.length,
      firstDate: mergedRows[0]?.tradeDate || null,
      lastDate: mergedRows.at(-1)?.tradeDate || null,
      status: mergedRows.length >= 91 ? 'completed' : mergedRows.length > 0 ? 'partial' : 'failed',
    }
  }

  private async refreshHsiBenchmark() {
    const freshnessReferenceDate = marketDataFreshnessService.expectedLatestTradeDate(
      new Date(),
      DEFAULT_MARKET_DATA_TIMEZONE,
      DEFAULT_MARKET_DATA_AFTER_CLOSE_MINUTES,
    )
    const payload = await getJsonWithCurlOnly<any>('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get', {
      timeout: 20_000,
      params: { param: 'hkHSI,day,,,40,qfq' },
      headers: { Referer: 'https://gu.qq.com/', 'User-Agent': 'Mozilla/5.0' },
    })
    const data = payload?.data?.hkHSI
    const rows: Array<Array<string | number>> = data?.qfqday || data?.day || []
    const valid = rows.map((row) => ({
      tradeDate: new Date(`${String(row[0] || '')}T00:00:00.000Z`),
      openPrice: Number(row[1]),
      closePrice: Number(row[2]),
      highPrice: Number(row[3]),
      lowPrice: Number(row[4]),
      volume: Number(row[5]) || null,
    })).filter((row) => (
      !Number.isNaN(row.tradeDate.getTime())
      && row.closePrice > 0
      && isoDate(row.tradeDate) <= freshnessReferenceDate
    ))
    if (valid.length === 0) throw new Error('Tencent HSI benchmark returned no valid rows')
    await prisma.$transaction(async (tx) => {
      await tx.marketBarCanonical.deleteMany({
        where: {
          symbol: '^HSI',
          market: 'HK',
          timeframe: '1d',
          adjustType: 'none',
          dataVersion: 'benchmark.price_index.v1',
          tradeDate: { gt: new Date(`${freshnessReferenceDate}T00:00:00.000Z`) },
        },
      })
      await tx.marketBarCanonical.deleteMany({
        where: {
          symbol: '^HSI', market: 'HK', timeframe: '1d', adjustType: 'none', dataVersion: 'benchmark.price_index.v1',
          tradeDate: { in: valid.map((row) => row.tradeDate) },
        },
      })
      await tx.marketBarCanonical.createMany({
        data: valid.map((row) => ({
          symbol: '^HSI', market: 'HK', timeframe: '1d', adjustType: 'none', dataVersion: 'benchmark.price_index.v1',
          tradeDate: row.tradeDate, openPrice: row.openPrice, closePrice: row.closePrice, highPrice: row.highPrice,
          lowPrice: row.lowPrice, volume: row.volume, primaryProvider: 'tencent_hk_price_index',
          sourceRefsJson: JSON.stringify([`tencent:hkHSI:${isoDate(row.tradeDate)}`]),
          consensusScore: 1, confidence: 1, validationStatus: 'valid', qualityFlagsJson: '[]',
        })),
      })
    })
    return {
      symbol: '^HSI',
      source: 'tencent_hk_price_index',
      records: valid.length,
      lastDate: isoDate(valid.at(-1)!.tradeDate),
      freshnessReferenceDate,
      status: 'completed',
    }
  }

  async refresh(userId = 'default') {
    await ensureUser(prisma, userId)
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open', asset: { type: { in: ['fund', 'bond', 'bond_fund', 'gold'] } } },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    })
    const results: any[] = []
    for (const benchmark of [
      { symbol: '000300.SH', type: 'index' as const },
      { symbol: '518880', type: 'etf' as const },
      { symbol: '511010', type: 'etf' as const },
    ]) {
      try {
        const rows = benchmark.type === 'index'
          ? await relativeRotationService.ensureBenchmarkHistory({ days: 2_340, refresh: true })
          : await relativeRotationService.ensureQfqHistory(benchmark.symbol, { days: 2_340, refresh: true })
        results.push({
          symbol: benchmark.symbol,
          source: 'canonical_market_bar_refresh',
          records: rows.length,
          lastDate: rows.at(-1)?.date || null,
          status: rows.length > 0 ? 'completed' : 'failed',
        })
      } catch (error) {
        results.push({ symbol: benchmark.symbol, source: 'canonical_market_bar_refresh', records: 0, status: 'failed', error: error instanceof Error ? error.message : String(error) })
      }
    }
    try {
      results.push(await this.refreshHsiBenchmark())
    } catch (error) {
      results.push({ symbol: '^HSI', source: 'tencent_hk_price_index', records: 0, status: 'failed', error: error instanceof Error ? error.message : String(error) })
    }
    for (const position of positions) {
      try {
        results.push(await this.refreshFund(position.assetId, position.asset.symbol))
      } catch (error) {
        results.push({
          symbol: position.asset.symbol,
          source: 'eastmoney_pingzhongdata_Data_ACWorthTrend',
          records: 0,
          firstDate: null,
          lastDate: null,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return {
      schemaVersion: 'fams.relative_rotation.portfolio_refresh.v1',
      generatedAt: new Date().toISOString(),
      requestedTargets: positions.length + 4,
      completedTargets: results.filter((result) => result.status === 'completed').length,
      results,
    }
  }

  async getReport(userId = 'default', options: { frequency?: string; years?: number; now?: Date } = {}) {
    await ensureUser(prisma, userId)
    const frequency: RelativeRotationFrequency = options.frequency === 'daily' ? 'daily' : 'weekly'
    const years = Math.max(1, Math.min(8, Math.floor(Number(options.years || 8))))
    const days = Math.min(3000, Math.ceil((years + 1) * 260))
    const reportNow = options.now || new Date()
    const freshnessReferenceDate = marketDataFreshnessService.expectedLatestTradeDate(
      reportNow,
      DEFAULT_MARKET_DATA_TIMEZONE,
      DEFAULT_MARKET_DATA_AFTER_CLOSE_MINUTES,
    )
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true },
      orderBy: [{ marketValue: 'desc' }, { createdAt: 'asc' }],
    })
    const positionsByGroup = new Map<PortfolioGroupKey, typeof positions>()
    for (const key of Object.keys(GROUPS) as PortfolioGroupKey[]) positionsByGroup.set(key, [])
    for (const position of positions) {
      positionsByGroup.get('all')!.push(position)
      positionsByGroup.get(groupFor(position))!.push(position)
    }

    const groups: any[] = []
    for (const key of Object.keys(GROUPS) as PortfolioGroupKey[]) {
      const definition = GROUPS[key]
      const groupPositions = positionsByGroup.get(key) || []
      if (key === 'cash') {
        groups.push({
          key, label: definition.label, benchmark: { symbol: null, name: null, kind: 'not_applicable', sampleDays: 0, asOfDate: null, freshnessLag: null },
          purpose: 'not_applicable',
          items: groupPositions.map((position) => this.cashItem(position)),
          dates: [], availableDateCount: 0, readyCount: 0, limitedCount: 0,
        })
        continue
      }
      const composite = key === 'all' ? await this.buildTargetMixBenchmark(days) : null
      const benchmarkAdjustType = key === 'gold' || key === 'bond' ? 'qfq' : 'none'
      const benchmark = composite?.points || await this.loadCanonical(definition.benchmarkSymbol!, benchmarkAdjustType, days)
      const cashPositions = key === 'all' ? groupPositions.filter((position) => groupFor(position) === 'cash') : []
      const pricePositions = groupPositions.filter((position) => groupFor(position) !== 'cash')
      const loadedAssets = await Promise.all(pricePositions.map(async (position) => ({
        position,
        history: position.asset.type === 'stock' || position.asset.type === 'etf'
          ? await this.loadCanonical(position.asset.symbol, 'qfq', days)
          : await this.loadFundHistory(position.assetId, days),
      })))
      const groupAsOfDate = freshnessReferenceDate
      const benchmarkFreshnessLag = businessDayLag(benchmark.at(-1)?.date || null, groupAsOfDate)
      const benchmarkDates = new Set(benchmark.map((point) => point.date))
      const items: any[] = loadedAssets.map(({ position, history }) => {
        const result = buildRelativeRotationSeries(history, benchmark, frequency)
        const alignedDailyObservations = history.filter((point) => benchmarkDates.has(point.date)).length
        const assetAsOfDate = history.at(-1)?.date || null
        const freshnessLag = businessDayLag(assetAsOfDate, groupAsOfDate)
        const formulaSufficient = result.alignedObservations >= (frequency === 'weekly' ? 53 : 91) && result.points.length > 0
        const readiness = alignedDailyObservations >= 756 ? 'verified' : formulaSufficient ? 'limited' : history.length > 0 ? 'insufficient' : 'unavailable'
        const latestPoint = result.points.at(-1) || null
        const blockers: string[] = []
        if (!formulaSufficient) blockers.push(`公式样本不足：共同样本 ${result.alignedObservations}，需要至少 ${frequency === 'weekly' ? 53 : 91}。`)
        if (freshnessLag === null || freshnessLag >= 2) blockers.push(`标的数据老化：交易日延迟 ${freshnessLag ?? '未知'}。`)
        if (benchmarkFreshnessLag === null || benchmarkFreshnessLag >= 2) blockers.push(`基准数据老化：交易日延迟 ${benchmarkFreshnessLag ?? '未知'}。`)
        const favorable = latestPoint ? ['improving', 'leading'].includes(latestPoint.quadrant) : false
        if (formulaSufficient && !favorable) blockers.push(`当前象限为 ${latestPoint?.quadrant || 'unknown'}，不满足 Improving/Leading 门控。`)
        if (key === 'gold') blockers.push('黄金同类ETF比较只用于跟踪差诊断，不参与黄金配置门控。')
        const provider = position.asset.type === 'stock' || position.asset.type === 'etf' ? 'canonical_adjusted_close' : 'eastmoney_cumulative_nav'
        return {
          targetKey: `ASSET:${position.assetId}`,
          sources: ['holding'], positionId: position.id, assetId: position.assetId, watchlistItemId: null, deletable: false,
          market: groupFor(position) === 'hk_equity' ? 'HK' : 'CN', symbol: position.asset.symbol, name: position.asset.name, assetType: position.asset.type,
          dataStatus: readiness === 'verified' ? 'ready' : readiness === 'limited' ? 'partial' : 'insufficient',
          readiness, freshness: freshnessFromLag(freshnessLag), freshnessLag, assetAsOfDate,
          coveragePercent: result.coveragePercent, sampleDays: history.length, benchmarkSampleDays: benchmark.length,
          firstPointDate: result.points[0]?.date || null, lastPointDate: latestPoint?.date || null,
          commonAsOfDate: latestPoint?.date || null, refreshedAt: null, sourceProviders: [provider], points: result.points,
          blockers, warnings: definition.benchmarkKind === 'multi_asset_composite'
            ? ['统一基准按现金5%、黄金25%、债券25%、权益45%日度定权复合；使用价格代理，不等同于精确总收益归因。']
            : key === 'gold'
              ? ['002611与518880均主要提供人民币黄金敞口，本图只诊断产品跟踪差，不代表黄金资产轮动。']
              : definition.benchmarkKind === 'exchange_proxy'
                ? ['累计净值与交易所价格代理并非精确同口径，本图只用于相对趋势诊断。']
            : position.asset.type === 'fund' || position.asset.type === 'bond'
              ? ['基金使用累计净值，基准为价格指数；本图不等同于精确超额收益归因。']
              : [],
          formulaSufficient, latestQuadrant: latestPoint?.quadrant || null,
          alignedDailyObservations,
          gateEligible: key !== 'gold' && blockers.length === 0 && favorable,
          gateReason: key === 'gold'
            ? 'same_exposure_tracking_diagnostic_not_allocation_gate'
            : blockers.length === 0 && favorable
              ? `${key === 'all' ? '相对目标组合' : '相对组内基准'}处于 Improving/Leading，且公式、新鲜度和基准均通过。`
              : blockers.join('；'),
        }
      })
      items.push(...cashPositions.map((position) => this.cashItem(position, benchmark.length)))
      const dates = Array.from(new Set(items.flatMap((item) => item.points.map((point: any) => point.date)))).sort()
      groups.push({
        key,
        label: definition.label,
        purpose: key === 'all' ? 'allocation_gate' : key === 'gold' ? 'tracking_diagnostic' : 'relative_diagnostic',
        benchmark: {
          symbol: definition.benchmarkSymbol,
          name: definition.benchmarkName,
          kind: definition.benchmarkKind,
          sampleDays: benchmark.length,
          asOfDate: benchmark.at(-1)?.date || null,
          freshnessLag: benchmarkFreshnessLag,
          sourceProviders: ['canonical_market_bar'],
          components: composite?.components || undefined,
        },
        items,
        dates,
        availableDateCount: dates.length,
        readyCount: items.filter((item) => item.readiness === 'verified').length,
        limitedCount: items.filter((item) => item.readiness === 'limited').length,
      })
    }
    const items: any[] = groups.find((group) => group.key === 'all')?.items || []
    return {
      schemaVersion: 'fams.relative_rotation.portfolio_universe.v2',
      generatedAt: new Date().toISOString(),
      universe: 'all_current_holdings',
      formulaVersion: RELATIVE_ROTATION_FORMULA_VERSION,
      frequency,
      requestedYears: years,
      freshnessReferenceDate,
      freshnessTimezone: DEFAULT_MARKET_DATA_TIMEZONE,
      freshnessAfterCloseMinutes: DEFAULT_MARKET_DATA_AFTER_CLOSE_MINUTES,
      groups,
      coverage: {
        positionCount: positions.length,
        representedCount: items.length,
        plottedCount: items.filter((item) => item.points.length > 0).length,
        notApplicableCount: items.filter((item) => item.readiness === 'not_applicable').length,
        verifiedCount: items.filter((item) => item.readiness === 'verified').length,
        limitedCount: items.filter((item) => item.readiness === 'limited').length,
        insufficientCount: items.filter((item) => ['insufficient', 'unavailable'].includes(item.readiness)).length,
      },
      dataPolicy: {
        fundSeries: 'Eastmoney Data_ACWorthTrend cumulative NAV, stored by assetId',
        exchangeSeries: 'canonical adjusted close / qfq',
        freshness: '0=fresh, 1=delayed, >=2=stale; benchmark is gated independently',
        coordinateThreshold: frequency === 'weekly' ? '53 aligned weeks' : '91 aligned days',
        verifiedThreshold: '756 aligned daily observations',
        commonBenchmark: '5% CNY fixed 1% proxy + 25% 518880 + 25% 511010 + 45% CSI300, daily fixed-weight compounding',
        allocationGateGroup: 'all',
        goldTrackingGroup: 'diagnostic_only_never_allocation_gate',
      },
      notTradingAdvice: true,
    }
  }
}

export const portfolioRelativeRotationService = new PortfolioRelativeRotationService()
