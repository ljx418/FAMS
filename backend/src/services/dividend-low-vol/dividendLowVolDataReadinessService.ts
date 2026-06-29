import { readFile, stat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../../db/prisma.js'
import { dividendLowVolFormalProviderIngestionService } from './formalProviderIngestionService.js'

const canonicalPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/a-share-quote-list-canonical.json')

function percent(numerator: number, denominator: number) {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 10000) / 100
}

function isoDate(value: Date | null | undefined) {
  return value ? value.toISOString().slice(0, 10) : null
}

function daysSince(value: Date | null | undefined) {
  if (!value) return null
  const ms = Date.now() - value.getTime()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

async function readCanonicalSummary() {
  const info = await stat(canonicalPath).catch(() => null)
  const content = await readFile(canonicalPath, 'utf8').catch(() => null)
  if (!content) {
    return {
      path: canonicalPath,
      exists: false,
      itemCount: 0,
      generatedAt: null,
      updatedAt: info?.mtime.toISOString() || null,
    }
  }
  try {
    const parsed = JSON.parse(content) as { itemCount?: number; generatedAt?: string; items?: unknown[] }
    return {
      path: canonicalPath,
      exists: true,
      itemCount: parsed.itemCount ?? parsed.items?.length ?? 0,
      generatedAt: parsed.generatedAt || null,
      updatedAt: info?.mtime.toISOString() || null,
    }
  } catch {
    return {
      path: canonicalPath,
      exists: true,
      itemCount: 0,
      generatedAt: null,
      updatedAt: info?.mtime.toISOString() || null,
      parseError: 'canonical_quote_list_json_parse_failed',
    }
  }
}

async function distinctSymbols(model: {
  groupBy(args: { by: ['symbol']; where?: Record<string, unknown> }): Promise<Array<{ symbol: string }>>
}) {
  return model.groupBy({ by: ['symbol'] }).then((rows) => rows.length).catch(() => 0)
}

export class DividendLowVolDataReadinessService {
  async buildAudit() {
    const [canonical, providerAudit] = await Promise.all([
      readCanonicalSummary(),
      Promise.resolve(dividendLowVolFormalProviderIngestionService.buildAudit()),
    ])
    const [
      marketBarRows,
      marketBarSymbols,
      latestMarketBar,
      featureRows,
      featureSymbols,
      latestFeature,
      statusRows,
      statusSymbols,
      tradeabilityRows,
      tradeabilitySymbols,
      barDerivedTradeabilityRows,
      barDerivedTradeabilitySymbols,
      limitPriceRows,
      persistedCandidates,
      latestPersistedCandidate,
      providerHealth,
      recentOperations,
    ] = await Promise.all([
      prisma.marketBarCanonical.count().catch(() => 0),
      distinctSymbols(prisma.marketBarCanonical as any),
      prisma.marketBarCanonical.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }).catch(() => null),
      prisma.marketFeatureDaily.count().catch(() => 0),
      distinctSymbols(prisma.marketFeatureDaily as any),
      prisma.marketFeatureDaily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }).catch(() => null),
      prisma.securityStatusDaily.count().catch(() => 0),
      distinctSymbols(prisma.securityStatusDaily as any),
      prisma.marketTradeabilityDaily.count().catch(() => 0),
      distinctSymbols(prisma.marketTradeabilityDaily as any),
      prisma.marketTradeabilityDaily.count({ where: { provider: 'market_bar_canonical' } }).catch(() => 0),
      prisma.marketTradeabilityDaily.groupBy({ by: ['symbol'], where: { provider: 'market_bar_canonical' } }).then((rows) => rows.length).catch(() => 0),
      prisma.marketTradeabilityDaily.count({ where: { limitUp: { not: null }, limitDown: { not: null } } }).catch(() => 0),
      prisma.dividendLowVolDaily.count().catch(() => 0),
      prisma.dividendLowVolDaily.findFirst({ orderBy: { tradeDate: 'desc' }, select: { tradeDate: true } }).catch(() => null),
      prisma.providerHealth.findMany({
        orderBy: { provider: 'asc' },
        select: {
          provider: true,
          endpoint: true,
          status: true,
          requestCount: true,
          successCount: true,
          failureCount: true,
          timeoutCount: true,
          consecutiveFailures: true,
        },
      }).catch(() => []),
      prisma.operation.findMany({
        where: {
          OR: [
            { type: { contains: 'dividend_low_vol' } },
            { type: { contains: 'market_bar' } },
            { type: { contains: 'quote_list' } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, type: true, status: true, createdAt: true, updatedAt: true, errorSummary: true },
      }).catch(() => []),
    ])
    const fieldContracts = providerAudit.fieldContracts || []
    const providerFieldsAvailable = fieldContracts.filter((item) => item.coverageStatus === 'available').length
    const providerConfigured = providerAudit.formalProviderConfig.providers.some((provider) => provider.provider === 'tushare_pro' && provider.configured)
    const minResearchSymbols = Math.min(500, Math.max(1, canonical.itemCount * 0.1))
    const researchBlockers = [
      ...(!canonical.exists ? ['quote_list_canonical_missing'] : []),
      ...(canonical.exists && canonical.itemCount === 0 ? ['quote_list_canonical_empty'] : []),
      ...(marketBarSymbols < minResearchSymbols ? ['market_bar_canonical_coverage_low'] : []),
      ...(featureSymbols < minResearchSymbols ? ['market_feature_daily_coverage_low'] : []),
      ...(statusRows === 0 ? ['security_status_daily_missing'] : []),
      ...(tradeabilityRows === 0 ? ['market_tradeability_daily_missing'] : []),
    ]
    const providerUpgradeBlockers = [
      ...(!providerConfigured ? ['formal_provider_token_missing'] : []),
      ...(providerFieldsAvailable < fieldContracts.length ? ['formal_provider_field_coverage_incomplete'] : []),
    ]
    const scanCoveragePercent = percent(marketBarSymbols, Math.max(canonical.itemCount, 1))
    const featureCoveragePercent = percent(featureSymbols, Math.max(canonical.itemCount, 1))
    const securityStatusCoveragePercent = percent(statusSymbols, Math.max(canonical.itemCount, 1))
    const tradeabilityCoveragePercent = percent(tradeabilitySymbols, Math.max(canonical.itemCount, 1))
    const latestMarketBarAgeDays = daysSince(latestMarketBar?.tradeDate)
    const latestFeatureAgeDays = daysSince(latestFeature?.tradeDate)
    const lowCoverageBlockers = [
      ...(scanCoveragePercent < 80 ? ['market_bar_full_universe_coverage_below_80_percent'] : []),
      ...(featureCoveragePercent < 80 ? ['market_feature_full_universe_coverage_below_80_percent'] : []),
      ...(securityStatusCoveragePercent < 80 ? ['security_status_coverage_below_80_percent'] : []),
      ...(tradeabilityCoveragePercent < 80 ? ['tradeability_coverage_below_80_percent'] : []),
      ...(latestMarketBarAgeDays === null || latestMarketBarAgeDays > 3 ? ['latest_market_bar_stale_or_unknown'] : []),
      ...(latestFeatureAgeDays === null || latestFeatureAgeDays > 7 ? ['latest_market_feature_stale_or_unknown'] : []),
    ]
    const researchScanReady = researchBlockers.length === 0
    const freeSourceValidationAllowed = researchScanReady
    const fullUniverseReady = researchScanReady
    const providerMode = providerUpgradeBlockers.length === 0 && researchScanReady ? 'formal_provider' : researchScanReady ? 'free_source_research' : 'blocked'
    const dataTrustConfidence = Math.max(0, Math.min(100,
      (Math.min(scanCoveragePercent, 100) * 0.25)
      + (Math.min(featureCoveragePercent, 100) * 0.2)
      + (Math.min(securityStatusCoveragePercent, 100) * 0.15)
      + (Math.min(tradeabilityCoveragePercent, 100) * 0.15)
      + (providerMode === 'formal_provider' ? 20 : providerMode === 'free_source_research' ? 8 : 0)
      + (latestMarketBarAgeDays !== null && latestMarketBarAgeDays <= 1 ? 5 : 0)
      - (providerUpgradeBlockers.length * 4)
    ))
    const dataTrustGrade = !researchScanReady
      ? 'INSUFFICIENT'
      : lowCoverageBlockers.length > 0
        ? (dataTrustConfidence >= 45 ? 'D' : 'INSUFFICIENT')
        : providerMode === 'formal_provider' && dataTrustConfidence >= 85
          ? 'A'
          : dataTrustConfidence >= 70
            ? 'B'
            : dataTrustConfidence >= 55
              ? 'C'
              : 'D'
    return {
      schemaVersion: 'dividend.low_vol.data_readiness_audit.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: 'dividend_low_volatility',
      strategyId: 'dividend_low_vol_leader_v1',
      status: fullUniverseReady ? 'ready_free_source_validation' : researchScanReady ? 'ready_free_source_research' : 'blocked',
      providerMode,
      validationDataMode: freeSourceValidationAllowed ? 'free_source_validation' : 'blocked',
      dataTrust: {
        schemaVersion: 'dividend.low_vol.data_readiness_trust.v1',
        grade: dataTrustGrade,
        confidencePercent: Math.round(dataTrustConfidence * 100) / 100,
        providerMode,
        coverageStatus: lowCoverageBlockers.some((item) => item.includes('coverage')) ? 'low_coverage' : researchScanReady ? 'partial' : 'insufficient',
        freshnessStatus: latestMarketBarAgeDays !== null && latestMarketBarAgeDays <= 1 && latestFeatureAgeDays !== null && latestFeatureAgeDays <= 7
          ? 'fresh'
          : latestMarketBarAgeDays !== null && latestMarketBarAgeDays <= 3
            ? 'stale'
            : 'expired',
        crossCheckStatus: providerFieldsAvailable > 0 ? 'partial' : 'not_checked',
        displayLabel: dataTrustGrade === 'A'
          ? '正式源高可信'
          : dataTrustGrade === 'B'
            ? '研究级较可信'
            : dataTrustGrade === 'C'
              ? '研究级需复核'
              : dataTrustGrade === 'D'
                ? '低覆盖研究级'
                : '证据不足',
        blockers: [...researchBlockers, ...lowCoverageBlockers],
        warnings: [
          ...(providerMode === 'free_source_research' ? ['free_source_research_not_formal_provider'] : []),
          ...providerUpgradeBlockers,
        ],
        note: 'This readiness trust grade prevents display completeness from being interpreted as data authenticity or model validation.',
      },
      notTradingAdvice: true,
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      canonicalQuoteList: canonical,
      providerIngestion: {
        status: providerAudit.status,
        totalFields: providerAudit.summary.totalFields,
        available: providerAudit.summary.available,
        partial: providerAudit.summary.partial,
        missing: providerAudit.summary.missing,
        blocked: providerAudit.summary.blocked,
        tokenInAuditPackage: providerAudit.formalProviderConfig.providers.some((provider) => provider.tokenInAuditPackage),
      },
      marketData: {
        marketBarRows,
        marketBarSymbols,
        latestMarketBarDate: isoDate(latestMarketBar?.tradeDate),
        marketFeatureRows: featureRows,
        marketFeatureSymbols: featureSymbols,
        latestFeatureDate: isoDate(latestFeature?.tradeDate),
        latestMarketBarAgeDays,
        latestFeatureAgeDays,
        scanCoveragePercent,
        featureCoveragePercent,
      },
      securityAndTradeability: {
        securityStatusRows: statusRows,
        securityStatusSymbols: statusSymbols,
        securityStatusCoveragePercent,
        tradeabilityRows,
        tradeabilitySymbols,
        tradeabilityCoveragePercent,
        barDerivedTradeabilityRows,
        barDerivedTradeabilitySymbols,
        limitPriceRows,
        limitPriceRowCoveragePercent: percent(limitPriceRows, Math.max(tradeabilityRows, 1)),
      },
      candidatePersistence: {
        persistedRows: persistedCandidates,
        latestTradeDate: isoDate(latestPersistedCandidate?.tradeDate),
      },
      providerHealth,
      recentOperations: recentOperations.map((operation) => ({
        ...operation,
        createdAt: operation.createdAt.toISOString(),
        updatedAt: operation.updatedAt.toISOString(),
      })),
      gates: {
        researchScanReady,
        fullUniverseReady,
        persistentFullAScanAllowed: researchScanReady,
        freeSourceValidationAllowed,
        formalValidationPromotionAllowed: freeSourceValidationAllowed,
        reason: researchScanReady
          ? 'free_source_research_and_validation_allowed_formal_provider_optional_upgrade'
          : researchBlockers[0] || 'unknown_blocker',
      },
      blockers: researchBlockers,
      researchBlockers,
      formalBlockers: [],
      providerUpgradeBlockers,
      recoveryCommands: [
        'cd backend && npm run check:sqlite-health',
        'cd backend && npm run run:quote-list-canonical-refresh',
        'cd backend && FAMS_MARKET_BAR_PREHEAT_LIMIT=500 FAMS_MARKET_BAR_PREHEAT_DAYS=180 npm run run:market-bar-cache-preheat',
        'cd backend && FAMS_LONG_SAMPLE_SCAN_LIMIT=500 npm run run:long-sample-controlled',
        'cd backend && npm run run:dividend-low-vol-audit-package',
      ],
    }
  }
}

export const dividendLowVolDataReadinessService = new DividendLowVolDataReadinessService()
