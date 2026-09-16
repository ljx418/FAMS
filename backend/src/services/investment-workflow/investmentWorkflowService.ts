import { createHash } from 'node:crypto'
import { z } from 'zod'
import { prisma } from '../../db/prisma.js'
import { ensureUser } from '../../utils/user.js'
import { marketDataFreshnessService } from '../market-data/marketDataFreshnessService.js'
import { fundamentalDataProvider } from '../technical/fundamentalDataProvider.js'

const strategyFamilySchema = z.enum(['rotation_volatility', 'dividend_low_vol', 'portfolio', 'unclassified'])
const accountSourceSchema = z.enum(['tonghuashun', 'alipay'])

export type InvestmentStrategyFamily = z.infer<typeof strategyFamilySchema>

function parseStringArray(value: string | null | undefined) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function normalizeSymbol(symbol: string) {
  return String(symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ|SS)$/, '')
}

function accountSourceFromMarkers(markers: string[]) {
  const text = markers.join(' ').toLowerCase()
  if (text.includes('支付宝') || text.includes('alipay')) return 'alipay' as const
  if (text.includes('同花顺') || text.includes('tonghuashun') || text.includes('账户:ths')) return 'tonghuashun' as const
  return null
}

function suggestStrategy(position: {
  asset: { type: string; name: string; symbol: string }
  tags: string
  labels: string
}) {
  const markers = [...parseStringArray(position.tags), ...parseStringArray(position.labels)]
  const markerText = `${markers.join(' ')} ${position.asset.name}`.toLowerCase()
  const accountSource = accountSourceFromMarkers(markers)
  if (accountSource === 'alipay') {
    return { strategyFamily: 'portfolio' as const, confidence: 0.98, reasons: ['account_source_alipay', 'alipay_assets_follow_portfolio_policy'] }
  }
  if (markerText.includes('红利') || markerText.includes('低波') || markerText.includes('dividend')) {
    return { strategyFamily: 'dividend_low_vol' as const, confidence: 0.92, reasons: ['dividend_or_low_vol_marker_present'] }
  }
  if (accountSource === 'tonghuashun' && ['stock', 'etf'].includes(position.asset.type)) {
    return { strategyFamily: 'rotation_volatility' as const, confidence: 0.78, reasons: ['tonghuashun_tradable_asset', 'requires_user_confirmation_for_dividend_exception'] }
  }
  if (['stock', 'etf'].includes(position.asset.type)) {
    return { strategyFamily: 'rotation_volatility' as const, confidence: 0.6, reasons: ['tradable_asset_without_account_marker', 'low_confidence_requires_user_confirmation'] }
  }
  return { strategyFamily: 'unclassified' as const, confidence: 0.2, reasons: ['no_supported_strategy_rule_matched'] }
}

function serializeAssignment(record: any) {
  return {
    ...record,
    reasons: parseStringArray(record.reasonsJson),
    reasonsJson: undefined,
    tradeBoundary: {
      createsOrder: false,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
    },
  }
}

export class InvestmentWorkflowService {
  async getReadiness(userId: string) {
    await ensureUser(prisma, userId)
    const [positions, assignments, latestCaptures] = await Promise.all([
      prisma.position.findMany({
        where: { userId, status: 'open' },
        include: { asset: true },
        orderBy: { updatedAt: 'desc' },
      }),
      prisma.positionStrategyAssignment.findMany({ where: { userId } }),
      Promise.all((['tonghuashun', 'alipay'] as const).map((accountSource) => prisma.screenshotCapture.findFirst({
        where: { userId, accountSource, status: { in: ['confirmed', 'partially_confirmed'] } },
        orderBy: { confirmedAt: 'desc' },
        select: { id: true, accountSource: true, confirmedAt: true, documentType: true, status: true },
      }))),
    ])
    const assignmentByPosition = new Map(assignments.map((item) => [item.positionId, item]))
    const strategyFamilies = ['rotation_volatility', 'dividend_low_vol', 'portfolio'] as const
    const strategies = []
    for (const strategyFamily of strategyFamilies) {
      const familyAssignments = assignments.filter((item) => item.strategyFamily === strategyFamily)
      const confirmedAssignments = familyAssignments.filter((item) => item.status === 'confirmed')
      const familyPositions = positions.filter((position) => confirmedAssignments.some((item) => item.positionId === position.id))
      const symbols = familyPositions
        .map((position) => normalizeSymbol(position.asset.symbol))
        .filter((symbol) => /^\d{6}$/.test(symbol))
      let freshness: Awaited<ReturnType<typeof marketDataFreshnessService.buildReport>> | { status: 'fresh' | 'delayed' | 'stale' | 'unknown'; latestTradeDate: string | null; providers: string[]; blockers: string[] }
      if (strategyFamily === 'portfolio') {
        const latestPrices = await Promise.all(familyPositions.map((position) => prisma.priceHistory.findFirst({
          where: { assetId: position.assetId, isValid: true },
          orderBy: { timestamp: 'desc' },
          select: { source: true, timestamp: true },
        })))
        const missing = familyPositions.filter((position) => !position.asset.lastUpdated)
        const dates = familyPositions.map((position) => position.asset.lastUpdated).filter((value): value is Date => Boolean(value))
        const latest = dates.length > 0 ? new Date(Math.min(...dates.map((date) => date.getTime()))) : null
        const ageHours = latest ? (Date.now() - latest.getTime()) / 3_600_000 : null
        const status = missing.length > 0 || ageHours === null ? 'unknown' : ageHours <= 36 ? 'fresh' : ageHours <= 72 ? 'delayed' : 'stale'
        freshness = {
          status,
          latestTradeDate: latest?.toISOString() || null,
          providers: Array.from(new Set(latestPrices.map((item) => item?.source || 'unknown'))),
          blockers: status === 'fresh' || status === 'delayed' ? [] : [`portfolio_price_freshness_${status}`],
        }
      } else {
        freshness = await marketDataFreshnessService.buildReport({ userId, scope: 'holdings', symbols })
      }
      const blockers = [
        ...(familyAssignments.length === 0 ? ['strategy_has_no_assigned_position'] : []),
        ...(familyAssignments.some((item) => item.status !== 'confirmed') ? ['strategy_assignment_confirmation_required'] : []),
        ...(confirmedAssignments.length === 0 ? ['strategy_has_no_confirmed_position'] : []),
        ...freshness.blockers,
      ]
      strategies.push({
        strategyFamily,
        assignedPositionCount: familyAssignments.length,
        confirmedPositionCount: confirmedAssignments.length,
        researchReady: confirmedAssignments.length > 0 && blockers.length === 0,
        manualDraftReady: false,
        manualDraftBlocker: 'strategy_specific_signal_and_intraday_freshness_not_yet_evaluated',
        dataHealth: {
          status: freshness.status,
          asOf: 'latestTradeDate' in freshness ? freshness.latestTradeDate : null,
          providers: 'providerSummary' in freshness ? freshness.providerSummary.map((item) => item.provider) : freshness.providers,
        },
        blockers,
      })
    }
    const unassignedPositions = positions.filter((position) => !assignmentByPosition.has(position.id))
    const pendingAssignments = assignments.filter((item) => item.status !== 'confirmed')
    return {
      schemaVersion: 'fams.investment-workflow-readiness.v1',
      generatedAt: new Date().toISOString(),
      userId,
      workflow: {
        currentStep: unassignedPositions.length > 0 || pendingAssignments.length > 0 ? 'basic_information_confirmation' : 'position_strategy',
        steps: ['basic_information_confirmation', 'position_strategy', 'backtest_review'],
        forcedWizard: false,
      },
      facts: {
        openPositionCount: positions.length,
        unassignedPositionCount: unassignedPositions.length,
        pendingAssignmentCount: pendingAssignments.length,
        confirmedCaptureByAccount: Object.fromEntries(latestCaptures.map((capture, index) => [(['tonghuashun', 'alipay'] as const)[index], capture])),
      },
      strategies,
      permissionState: {
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        canCreateOrder: false,
        orderCreateAllowed: false,
        prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      },
    }
  }

  async suggestAssignments(userId: string) {
    await ensureUser(prisma, userId)
    const positions = await prisma.position.findMany({
      where: { userId, status: 'open' },
      include: { asset: true, strategyAssignment: true },
      orderBy: [{ marketValue: 'desc' }, { updatedAt: 'desc' }],
    })
    const assignments = []
    for (const position of positions) {
      if (position.strategyAssignment?.status === 'confirmed') {
        assignments.push(position.strategyAssignment)
        continue
      }
      const suggestion = suggestStrategy(position)
      const { reasons, ...suggestionData } = suggestion
      assignments.push(await prisma.positionStrategyAssignment.upsert({
        where: { positionId: position.id },
        create: {
          userId,
          positionId: position.id,
          ...suggestionData,
          reasonsJson: JSON.stringify(reasons),
        },
        update: {
          strategyFamily: suggestion.strategyFamily,
          status: 'suggested',
          source: 'system_rule',
          confidence: suggestion.confidence,
          reasonsJson: JSON.stringify(reasons),
          suggestedAt: new Date(),
          confirmedAt: null,
          confirmedBy: null,
        },
      }))
    }
    return {
      schemaVersion: 'fams.position-strategy-assignment-list.v1',
      generatedAt: new Date().toISOString(),
      assignments: assignments.map(serializeAssignment),
      requiresUserConfirmation: assignments.filter((item) => item.status !== 'confirmed').length,
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    }
  }

  async listAssignments(userId: string) {
    const assignments = await prisma.positionStrategyAssignment.findMany({
      where: { userId },
      include: { position: { include: { asset: true } } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    })
    return {
      schemaVersion: 'fams.position-strategy-assignment-list.v1',
      generatedAt: new Date().toISOString(),
      assignments: assignments.map(serializeAssignment),
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    }
  }

  async confirmAssignment(input: {
    userId: string
    positionId: string
    strategyFamily: InvestmentStrategyFamily
    confirmedBy: string
  }) {
    const strategyFamily = strategyFamilySchema.parse(input.strategyFamily)
    const confirmedBy = z.string().trim().min(1).parse(input.confirmedBy)
    const position = await prisma.position.findFirst({ where: { id: input.positionId, userId: input.userId, status: 'open' } })
    if (!position) throw new Error('Open position not found for strategy assignment')
    const assignment = await prisma.positionStrategyAssignment.upsert({
      where: { positionId: input.positionId },
      create: {
        userId: input.userId,
        positionId: input.positionId,
        strategyFamily,
        status: 'confirmed',
        source: 'user_confirmation',
        confidence: 1,
        reasonsJson: JSON.stringify(['user_confirmed_strategy_family']),
        confirmedAt: new Date(),
        confirmedBy,
      },
      update: {
        strategyFamily,
        status: 'confirmed',
        source: 'user_confirmation',
        confidence: 1,
        reasonsJson: JSON.stringify(['user_confirmed_strategy_family']),
        confirmedAt: new Date(),
        confirmedBy,
      },
    })
    return serializeAssignment(assignment)
  }

  async createResearchSnapshot(input: {
    userId: string
    strategyFamily: InvestmentStrategyFamily
    accountSource?: 'tonghuashun' | 'alipay'
    positionIds?: string[]
  }) {
    await ensureUser(prisma, input.userId)
    const strategyFamily = strategyFamilySchema.parse(input.strategyFamily)
    const accountSource = input.accountSource ? accountSourceSchema.parse(input.accountSource) : undefined
    const requestedIds = Array.from(new Set(input.positionIds || []))
    const positions = await prisma.position.findMany({
      where: {
        userId: input.userId,
        status: 'open',
        ...(requestedIds.length > 0 ? { id: { in: requestedIds } } : {}),
        strategyAssignment: { strategyFamily, status: 'confirmed' },
      },
      include: { asset: true, strategyAssignment: true },
      orderBy: { id: 'asc' },
    })
    if (positions.length === 0) throw new Error('No confirmed positions found for the requested strategy family')
    if (requestedIds.length > 0 && positions.length !== requestedIds.length) {
      throw new Error('Every requested position must belong to the user and have a confirmed matching strategy assignment')
    }
    const symbols = positions.map((position) => normalizeSymbol(position.asset.symbol)).filter((symbol) => /^\d{6}$/.test(symbol))
    const [barGroups, freshness, quoteListSnapshots] = await Promise.all([
      Promise.all(symbols.map((symbol) => prisma.marketBarCanonical.findMany({
        where: { symbol, market: 'CN', timeframe: '1d', dataVersion: 'canonical.v1' },
        orderBy: { tradeDate: 'desc' },
        take: 120,
      }))),
      marketDataFreshnessService.buildReport({ userId: input.userId, scope: 'holdings', symbols }),
      fundamentalDataProvider.getEastmoneyQuoteListSnapshots(),
    ])
    const bars = barGroups.flat()
    const barsBySymbol = new Map<string, typeof bars>()
    for (const bar of bars) {
      const group = barsBySymbol.get(bar.symbol) || []
      if (group.length < 120) group.push(bar)
      barsBySymbol.set(bar.symbol, group)
    }
    const asOf = bars.length > 0
      ? new Date(Math.max(...bars.map((bar) => bar.tradeDate.getTime())))
      : new Date(Math.max(...positions.map((position) => (position.asset.lastUpdated || position.updatedAt).getTime())))
    const { generatedAt: _freshnessGeneratedAt, ...stableFreshness } = freshness
    const snapshotInput = {
      schemaVersion: 'fams.investment-research-input.v1',
      userId: input.userId,
      accountSource: accountSource || null,
      strategyFamily,
      asOf: asOf.toISOString(),
      positions: positions.map((position) => ({
        positionId: position.id,
        assetId: position.assetId,
        symbol: position.asset.symbol,
        name: position.asset.name,
        type: position.asset.type,
        sector: position.asset.sector,
        industry: position.asset.industry || quoteListSnapshots.get(normalizeSymbol(position.asset.symbol))?.industryName || null,
        industryEvidence: position.asset.industry ? {
          provider: 'asset_master',
          asOf: position.asset.updatedAt.toISOString(),
        } : quoteListSnapshots.get(normalizeSymbol(position.asset.symbol)) ? {
          provider: quoteListSnapshots.get(normalizeSymbol(position.asset.symbol))?.source || 'eastmoney_quote_list_cache',
          asOf: quoteListSnapshots.get(normalizeSymbol(position.asset.symbol))?.fetchedAt || null,
        } : null,
        exchange: position.asset.exchange,
        priceAsOf: position.asset.lastUpdated?.toISOString() || null,
        quantity: position.quantity,
        avgCost: position.avgCost,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        accountMarkers: [...parseStringArray(position.tags), ...parseStringArray(position.labels)],
        assignmentId: position.strategyAssignment?.id,
      })),
      dailyBars: Object.fromEntries(symbols.map((symbol) => [symbol, (barsBySymbol.get(symbol) || []).map((bar) => ({
        tradeDate: bar.tradeDate.toISOString().slice(0, 10),
        open: bar.openPrice,
        high: bar.highPrice,
        low: bar.lowPrice,
        close: bar.closePrice,
        volume: bar.volume,
        provider: bar.primaryProvider,
        validationStatus: bar.validationStatus,
        sourceRefs: parseJsonArray(bar.sourceRefsJson),
      }))])),
      freshness: stableFreshness,
      tradeBoundary: {
        formalTradingUnlocked: false,
        autoTradeUnlocked: false,
        canCreateOrder: false,
        orderCreateAllowed: false,
      },
    }
    const inputHash = createHash('sha256').update(stableStringify(snapshotInput)).digest('hex')
    const providers = Array.from(new Set([
      ...bars.map((bar) => bar.primaryProvider || 'unknown'),
      ...(positions.some((position) => Boolean(position.asset.industry)) ? ['asset_master'] : []),
      ...symbols.map((symbol) => quoteListSnapshots.get(symbol)?.source).filter((value): value is string => Boolean(value)),
    ]))
    const record = await prisma.investmentResearchSnapshot.upsert({
      where: { inputHash },
      create: {
        userId: input.userId,
        accountSource: accountSource || null,
        strategyFamily,
        asOf,
        providerSummaryJson: JSON.stringify(providers),
        freshnessStatus: freshness.status,
        inputJson: JSON.stringify(snapshotInput),
        dataHealthJson: JSON.stringify({ status: freshness.status, blockers: freshness.blockers, warnings: freshness.warnings }),
        evidenceRefsJson: JSON.stringify(bars.flatMap((bar) => parseJsonArray(bar.sourceRefsJson))),
        inputHash,
      },
      update: {},
    })
    return {
      ...record,
      providerSummary: providers,
      input: snapshotInput,
      dataHealth: { status: freshness.status, blockers: freshness.blockers, warnings: freshness.warnings },
      evidenceRefs: bars.flatMap((bar) => parseJsonArray(bar.sourceRefsJson)),
      inputJson: undefined,
      providerSummaryJson: undefined,
      dataHealthJson: undefined,
      evidenceRefsJson: undefined,
      immutable: true,
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    }
  }

  async getResearchSnapshot(userId: string, snapshotId: string) {
    const record = await prisma.investmentResearchSnapshot.findFirst({ where: { id: snapshotId, userId } })
    if (!record) throw new Error('Investment research snapshot not found')
    return {
      ...record,
      providerSummary: JSON.parse(record.providerSummaryJson),
      input: JSON.parse(record.inputJson),
      dataHealth: JSON.parse(record.dataHealthJson),
      evidenceRefs: JSON.parse(record.evidenceRefsJson),
      providerSummaryJson: undefined,
      inputJson: undefined,
      dataHealthJson: undefined,
      evidenceRefsJson: undefined,
      immutable: true,
    }
  }
}

export const investmentWorkflowService = new InvestmentWorkflowService()
