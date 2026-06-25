import { prisma } from '../../db/prisma.js'
import type {
  PortfolioBacktestRequest,
  PortfolioStrategyComponent,
  PortfolioStrategyDefinition,
} from './portfolioBacktestTypes.js'

const STRATEGY_ID = 'dividend_low_vol_leader_v1'
const DEFAULT_MAX_COMPONENTS = 10
const DEFAULT_MIN_COMPONENTS = 3

function round(value: number, digits = 4) {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function isoDate(value: Date) {
  return value.toISOString().slice(0, 10)
}

export class DividendLowVolPortfolioBasketService {
  async build(request: PortfolioBacktestRequest): Promise<PortfolioStrategyDefinition> {
    const maxComponents = Math.max(1, Math.min(30, Number(process.env.FAMS_PORTFOLIO_DLV_BASKET_MAX_COMPONENTS || DEFAULT_MAX_COMPONENTS)))
    const minComponents = Math.max(1, Math.min(maxComponents, Number(process.env.FAMS_PORTFOLIO_DLV_BASKET_MIN_COMPONENTS || DEFAULT_MIN_COMPONENTS)))
    let snapshotUserId = request.userId
    let latest = await this.findLatestSnapshot(snapshotUserId)
    const blockedReasons: string[] = []
    const warnings: string[] = ['dividend_low_vol_basket_is_research_only_not_formal_trade_signal']

    if (!latest && request.userId !== 'default') {
      snapshotUserId = 'default'
      latest = await this.findLatestSnapshot(snapshotUserId)
      if (latest) warnings.push('using_default_user_dividend_low_vol_snapshot_for_audit_user')
    }

    if (!latest) {
      blockedReasons.push('dividend_low_vol_candidate_snapshot_missing')
      return this.definition(request, [], blockedReasons, warnings, {
        capturedAt: new Date().toISOString(),
        source: 'dividend_low_vol_daily:missing',
        candidateCount: 0,
        selectedCandidateCount: 0,
        weightPolicy: 'equal_weight',
        selectionRules: this.selectionRules(),
      })
    }

    const rows = await prisma.dividendLowVolDaily.findMany({
      where: {
        userId: snapshotUserId,
        strategyId: STRATEGY_ID,
        tradeDate: latest.tradeDate,
      },
      orderBy: [
        { evidenceAdjustedScore: 'desc' },
        { symbol: 'asc' },
      ],
      take: Math.max(maxComponents * 4, maxComponents),
    })

    if (rows.length === 0) {
      blockedReasons.push('dividend_low_vol_candidate_snapshot_empty')
    }

    const eligibleRows = rows.filter((row) => {
      if (['avoid', 'data_insufficient'].includes(row.disposition)) return false
      const evidenceRefs = parseJson<string[]>(row.evidenceRefsJson, [])
      if (evidenceRefs.length === 0) return false
      const blocked = parseJson<string[]>(row.blockedReasonsJson, [])
      if (blocked.includes('dividend_trap_risk')) return false
      return true
    })

    if (eligibleRows.length === 0 && rows.length > 0) {
      blockedReasons.push('dividend_low_vol_candidate_snapshot_has_no_research_eligible_candidates')
    }

    const rowsWithPriceCoverage = []
    for (const row of eligibleRows) {
      const coverage = await this.priceCoverage(row.symbol, request.startDate, request.endDate)
      if (coverage.count >= 2) {
        rowsWithPriceCoverage.push({ row, priceEvidenceRef: coverage.evidenceRef })
      } else {
        warnings.push(`dividend_low_vol_component_price_history_missing:${row.symbol}`)
      }
      if (rowsWithPriceCoverage.length >= maxComponents) break
    }

    if (rowsWithPriceCoverage.length < minComponents) {
      blockedReasons.push(`dividend_low_vol_candidate_snapshot_component_count_below_min:${rowsWithPriceCoverage.length}/${minComponents}`)
    }

    const selected = rowsWithPriceCoverage.slice(0, maxComponents)
    const weight = selected.length > 0 ? 100 / selected.length : 0
    const components: PortfolioStrategyComponent[] = selected.map((item, index) => ({
      assetClass: 'stock',
      symbol: item.row.symbol,
      name: item.row.name,
      targetWeightPercent: round(index === selected.length - 1
        ? 100 - (round(weight, 4) * (selected.length - 1))
        : weight),
      evidenceRefs: unique([
        `dividend_low_vol_daily:${item.row.symbol}:${isoDate(item.row.tradeDate)}`,
        item.priceEvidenceRef,
        ...parseJson<string[]>(item.row.evidenceRefsJson, []),
      ]),
    }))

    const evidenceRefs = unique([
      `portfolio-strategy:dividend_low_vol_basket:${isoDate(latest.tradeDate)}`,
      ...components.flatMap((component) => component.evidenceRefs),
    ])

    return this.definition(request, components, blockedReasons, warnings, {
      capturedAt: new Date().toISOString(),
      tradeDate: isoDate(latest.tradeDate),
      refreshTime: rows[0]?.generatedAt?.toISOString(),
      strategyVersion: STRATEGY_ID,
      source: snapshotUserId === request.userId
        ? 'dividend_low_vol_daily:latest_trade_date'
        : `dividend_low_vol_daily:latest_trade_date:fallback_user:${snapshotUserId}`,
      candidateCount: rows.length,
      selectedCandidateCount: components.length,
      weightPolicy: 'equal_weight',
      selectionRules: this.selectionRules(),
      evidenceRefs,
    })
  }

  private async findLatestSnapshot(userId: string) {
    return prisma.dividendLowVolDaily.findFirst({
      where: {
        userId,
        strategyId: STRATEGY_ID,
      },
      orderBy: [
        { tradeDate: 'desc' },
        { generatedAt: 'desc' },
      ],
      select: {
        tradeDate: true,
      },
    })
  }

  private definition(
    request: PortfolioBacktestRequest,
    components: PortfolioStrategyComponent[],
    blockedReasons: string[],
    warnings: string[],
    snapshot: NonNullable<PortfolioStrategyDefinition['snapshot']>,
  ): PortfolioStrategyDefinition {
    const evidenceRefs = unique([
      'portfolio-strategy:dividend_low_vol_basket:v1',
      ...(snapshot.evidenceRefs || []),
      ...components.flatMap((component) => component.evidenceRefs),
    ])

    return {
      strategyId: 'dividend_low_vol_basket',
      strategyVersion: 'portfolio.strategy.dividend_low_vol_basket.v1',
      displayName: '红利低波候选篮子',
      source: 'dividend_low_vol',
      components,
      rebalancePolicy: { frequency: request.rebalanceFrequency },
      dividendPolicy: request.dividendMode,
      costModel: {
        feeRate: request.feeRate,
        slippageRate: request.slippageRate,
      },
      benchmarkPolicy: {
        benchmarkIds: request.benchmarkIds,
        proxyAllowed: true,
      },
      snapshot,
      validation: {
        status: blockedReasons.length > 0 ? 'insufficient' : 'valid',
        blockedReasons: unique(blockedReasons),
        warnings: unique(warnings),
      },
      evidenceRefs,
    }
  }

  private selectionRules() {
    return [
      'source=DividendLowVolDaily latest persisted snapshot',
      'exclude disposition avoid/data_insufficient',
      'exclude dividend_trap_risk',
      'require evidenceRefs',
      'require at least two real price bars in requested date range',
      'weightPolicy=equal_weight',
      'research only; does not unlock ADD/REDUCE/ORDER_CREATE/AUTO_TRADE',
    ]
  }

  private async priceCoverage(symbol: string, startDate: string, endDate: string) {
    const asset = await prisma.asset.findFirst({
      where: { symbol },
      select: { id: true },
    })
    if (asset) {
      const count = await prisma.priceHistory.count({
        where: {
          assetId: asset.id,
          isValid: true,
          closePrice: { gt: 0 },
          timestamp: {
            gte: new Date(startDate),
            lte: new Date(`${endDate}T23:59:59.999Z`),
          },
        },
      })
      if (count >= 2) {
        return { count, evidenceRef: `price_history:${symbol}:${startDate}:${endDate}:count:${count}` }
      }
    }

    const count = await prisma.marketBarCanonical.count({
      where: {
        symbol,
        market: 'CN',
        timeframe: '1d',
        adjustType: 'none',
        dataVersion: 'canonical.v1',
        closePrice: { gt: 0 },
        tradeDate: {
          gte: new Date(startDate),
          lte: new Date(`${endDate}T23:59:59.999Z`),
        },
      },
    })
    return { count, evidenceRef: `market_bar_canonical:${symbol}:${startDate}:${endDate}:count:${count}` }
  }
}

export const dividendLowVolPortfolioBasketService = new DividendLowVolPortfolioBasketService()
