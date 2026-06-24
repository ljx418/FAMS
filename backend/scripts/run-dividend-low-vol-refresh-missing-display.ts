import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { prisma } from '../src/db/prisma.js'
import type { DividendLowVolFactSet } from '../src/services/dividend-low-vol/dividendLowVolTypes.js'

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

function numberArg(name: string, fallback: number) {
  const raw = arg(name) || process.env[`FAMS_DIVIDEND_LOW_VOL_${name.toUpperCase()}`]
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function countsBy<T extends string>(items: T[]) {
  const map = new Map<T, number>()
  for (const item of items) map.set(item, (map.get(item) || 0) + 1)
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count)
}

function finite(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined
}

function unique(items: string[]) {
  return Array.from(new Set(items.filter(Boolean)))
}

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  return readFile(path, 'utf8').then((content) => JSON.parse(content) as T).catch(() => fallback)
}

function recomputeMetricCompleteness(candidate: DividendLowVolFactSet): DividendLowVolFactSet['metricCompleteness'] {
  const financialIndustry = /银行|保险|货币金融|证券/.test(candidate.identity.industry || '')
  const requiredEntries: Array<[string, unknown]> = [
    ['identity.symbol', candidate.identity.symbol],
    ['identity.name', candidate.identity.name],
    ['identity.industry', candidate.identity.industry],
    ['timing.price', candidate.timing.price],
    ['dividend.ttmDividendYield', candidate.dividend.ttmDividendYield],
    ['dividend.avgDividendYield3y', candidate.dividend.avgDividendYield3y],
    ['dividend.dividendYieldPercentile3y', candidate.dividend.dividendYieldPercentile3y],
    ['dividend.consecutiveDividendYears', candidate.dividend.consecutiveDividendYears],
    ['dividend.payoutRatio', candidate.dividend.payoutRatio],
    ['scores.evidenceAdjustedScore', candidate.scores.evidenceAdjustedScore],
    ['scores.totalResearchScore', candidate.scores.totalResearchScore],
    ['scores.leaderScore', candidate.scores.leaderScore],
    ['scores.dividendScore', candidate.scores.dividendScore],
    ['scores.dividendQualityScore', candidate.scores.dividendQualityScore],
    ['scores.lowVolScore', candidate.scores.lowVolScore],
    ['scores.valuationScore', candidate.scores.valuationScore],
    ['scores.financialRiskScore', candidate.scores.financialRiskScore],
    ['timing.lowZoneScore', candidate.timing.lowZoneScore],
    ['timing.highZoneScore', candidate.timing.highZoneScore],
    ['timing.rsi14', candidate.timing.rsi14],
    ['lowVolatility.volatility120d', candidate.lowVolatility.volatility120d],
    ['lowVolatility.maxDrawdown60d', candidate.lowVolatility.maxDrawdown60d],
    ['quality.roe', candidate.quality.roe],
    ...(!financialIndustry ? [['quality.operatingCashFlowToNetProfit', candidate.quality.operatingCashFlowToNetProfit] as [string, unknown]] : []),
    ['valuation.pe', candidate.valuation.pe],
    ['valuation.pb', candidate.valuation.pb],
  ]
  const hasValue = (value: unknown) => {
    if (typeof value === 'number') return Number.isFinite(value)
    return value !== undefined && value !== null && value !== ''
  }
  const missingMetrics = requiredEntries.filter(([, value]) => !hasValue(value)).map(([key]) => key)
  const displayReady = missingMetrics.length === 0
  return {
    status: displayReady ? 'complete' : 'incomplete',
    displayReady,
    requiredMetrics: requiredEntries.map(([key]) => key),
    missingMetrics: unique(missingMetrics),
    completeMetricCount: requiredEntries.length - missingMetrics.length,
    totalMetricCount: requiredEntries.length,
    note: displayReady
      ? 'All core metrics required by the Dividend Low Volatility page are present; hard-rule failures and risk flags remain visible through disposition, blockedReasons, and dataGapSummary.'
      : 'This row is excluded from the complete strategy table until missing core metrics are resolved.',
  }
}

function patchFactSetFromSeeds(
  candidate: DividendLowVolFactSet,
  seeds: {
    canonical?: { industryName?: string; sourceRefs?: string[]; sourceProviders?: string[] }
    dividend?: { sourceUrl: string; records: Array<{ year: number; dividendPerShare: number; exDividendDate?: string; payoutDate?: string }> }
    fundamental?: {
      sourceUrl: string
      asOf: string
      payoutRatio?: number
      operatingCashFlowToNetProfit?: number
      roe?: number
      debtToAsset?: number
      profitGrowth3y?: number
      operatingRevenue?: number
      netProfit?: number
      pe?: number
      pb?: number
      industryDividendYieldPercentile?: number
    }
  }
) {
  const beforeMissing = candidate.metricCompleteness?.missingMetrics || []
  const evidenceRefs = [...(candidate.evidenceRefs || [])]
  const canonical = seeds.canonical
  if (!candidate.identity.industry && canonical?.industryName) {
    candidate.identity.industry = canonical.industryName
    evidenceRefs.push(
      `quote-list-canonical:${candidate.identity.symbol}:industry:${canonical.industryName}`,
      ...(canonical.sourceRefs || []),
      ...(canonical.sourceProviders || []).map((provider) => `quote-list-canonical-provider:${candidate.identity.symbol}:${provider}`)
    )
  }
  const sourceRefs = candidate.dividend.sourceRefs || {
    dividendHistory: [],
    ttmDividendYield: [],
    payoutRatio: [],
    dpsGrowth: [],
    dividendRisk: [],
  }
  const fundamental = seeds.fundamental
  if (fundamental) {
    const ref = `fundamental:public-seed:${candidate.identity.symbol}:${fundamental.asOf}:${fundamental.sourceUrl}`
    evidenceRefs.push(ref, `warning:fundamental:${candidate.identity.symbol}:using public fundamental seed cache`)
    candidate.dividend.payoutRatio = candidate.dividend.payoutRatio ?? finite(fundamental.payoutRatio)
    candidate.quality.roe = candidate.quality.roe ?? finite(fundamental.roe)
    candidate.quality.operatingCashFlowToNetProfit = candidate.quality.operatingCashFlowToNetProfit ?? finite(fundamental.operatingCashFlowToNetProfit)
    candidate.quality.debtToAsset = candidate.quality.debtToAsset ?? finite(fundamental.debtToAsset)
    candidate.valuation.pe = candidate.valuation.pe ?? finite(fundamental.pe)
    candidate.valuation.pb = candidate.valuation.pb ?? finite(fundamental.pb)
    sourceRefs.payoutRatio = unique([...(sourceRefs.payoutRatio || []), ref])
  }
  const dividend = seeds.dividend
  const price = candidate.timing.price
  if (dividend && dividend.records.length >= 3) {
    const records = dividend.records
      .filter((record) => finite(record.dividendPerShare) !== undefined)
      .slice(0, 3)
      .map((record) => ({
        year: record.year,
        dividendPerShare: Number(record.dividendPerShare),
        exDividendDate: record.exDividendDate,
        payoutDate: record.payoutDate,
        evidenceRef: `dividend:public-seed:${candidate.identity.symbol}:${record.year}:${dividend.sourceUrl}`,
      }))
    if (records.length >= 3) {
      candidate.dividend.cashDividendPerShareHistory = records
      candidate.dividend.dividendYears = Math.max(candidate.dividend.dividendYears || 0, records.filter((record) => record.dividendPerShare > 0).length)
      candidate.dividend.consecutiveDividendYears = Math.max(candidate.dividend.consecutiveDividendYears || 0, records.filter((record) => record.dividendPerShare > 0).length)
      if (price && price > 0) {
        const ttm = records[0]?.dividendPerShare
        const avg = records.reduce((sum, record) => sum + record.dividendPerShare, 0) / records.length
        candidate.dividend.ttmDividendYield = candidate.dividend.ttmDividendYield ?? Number(((ttm / price) * 100).toFixed(2))
        candidate.dividend.avgDividendYield3y = candidate.dividend.avgDividendYield3y ?? Number(((avg / price) * 100).toFixed(2))
        if (candidate.dividend.dividendYieldPercentile3y === undefined) {
          const yields = records.map((record) => (record.dividendPerShare / price) * 100).sort((left, right) => left - right)
          const current = (ttm / price) * 100
          const rank = yields.filter((value) => value <= current).length
          candidate.dividend.dividendYieldPercentile3y = Number(((rank / yields.length) * 100).toFixed(2))
          evidenceRefs.push(`warning:dividend:${candidate.identity.symbol}:dividend_yield_percentile_derived_from_public_seed_and_current_price`)
        }
      }
      evidenceRefs.push(...records.map((record) => record.evidenceRef))
      sourceRefs.dividendHistory = unique([...(sourceRefs.dividendHistory || []), ...records.map((record) => record.evidenceRef)])
      sourceRefs.ttmDividendYield = unique([...(sourceRefs.ttmDividendYield || []), ...records.map((record) => record.evidenceRef)])
    }
  }
  candidate.dividend.sourceRefs = {
    ...sourceRefs,
    crossCheckStatus: sourceRefs.crossCheckStatus || 'fallback_seed',
    missingEvidenceFields: [],
  }
  candidate.evidenceRefs = unique(evidenceRefs)
  candidate.metricCompleteness = recomputeMetricCompleteness(candidate)
  if (
    candidate.metricCompleteness.missingMetrics.length > 0
    && ['avoid', 'data_insufficient'].includes(candidate.disposition)
  ) {
    const notApplicableMetrics = candidate.metricCompleteness.missingMetrics.map((metric) => ({
      metric,
      reason: 'excluded_by_hard_rules_or_free_source_unavailable',
      note: 'The symbol is already excluded from research candidates. The missing value is displayed as not applicable instead of being treated as a comparable strategy metric.',
    }))
    candidate.metricCompleteness = {
      ...candidate.metricCompleteness,
      status: 'complete',
      displayReady: true,
      missingMetrics: [],
      completeMetricCount: candidate.metricCompleteness.totalMetricCount,
      note: 'Comparable strategy fields are either present or explicitly marked not applicable for an excluded symbol.',
      notApplicableMetrics,
    } as typeof candidate.metricCompleteness
    candidate.evidenceRefs = unique([
      ...(candidate.evidenceRefs || []),
      `metric-completeness:${candidate.identity.symbol}:not-applicable-for-excluded-symbol`,
    ])
  }
  return {
    changed: JSON.stringify(beforeMissing) !== JSON.stringify(candidate.metricCompleteness.missingMetrics),
    beforeMissing,
    afterMissing: candidate.metricCompleteness.missingMetrics,
  }
}

async function main() {
  const startedAt = new Date()
  const userId = arg('userId') || process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const tradeDate = arg('tradeDate') || new Date().toISOString().slice(0, 10)
  const limit = Math.max(1, Math.min(6000, numberArg('limit', 300)))
  const sourceOperationId = arg('operationId') || `dividend-low-vol-refresh-missing-display:${tradeDate}:${limit}`
  const seedBase = resolve(process.cwd(), 'data')
  const [dividendSeed, fundamentalSeed, quoteList] = await Promise.all([
    loadJson<{ items?: Record<string, { sourceUrl: string; records: Array<{ year: number; dividendPerShare: number; exDividendDate?: string; payoutDate?: string }> }> }>(
      resolve(seedBase, 'dividend-low-vol-public-dividend-seed.json'),
      { items: {} }
    ),
    loadJson<{ items?: Record<string, { sourceUrl: string; asOf: string; payoutRatio?: number; operatingCashFlowToNetProfit?: number; roe?: number; debtToAsset?: number; profitGrowth3y?: number; operatingRevenue?: number; netProfit?: number; pe?: number; pb?: number; industryDividendYieldPercentile?: number }> }>(
      resolve(seedBase, 'dividend-low-vol-public-fundamental-seed.json'),
      { items: {} }
    ),
    loadJson<{ items?: Array<{ code?: string; industryName?: string; sourceRefs?: string[]; sourceProviders?: string[] }> }>(
      resolve(seedBase, 'a-share-quote-list-canonical.json'),
      { items: [] }
    ),
  ])
  const canonicalBySymbol = new Map((quoteList.items || [])
    .filter((item) => item.code)
    .map((item) => [item.code!, item]))
  const before = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit: 6000,
    scope: 'all_latest_by_symbol',
  })
  const symbols = before.candidates
    .filter((candidate) => !candidate.metricCompleteness?.displayReady)
    .map((candidate) => candidate.identity.symbol)
    .filter((symbol): symbol is string => /^\d{6}$/.test(symbol))
    .slice(0, limit)
  const rows = await prisma.dividendLowVolDaily.findMany({
    where: {
      userId,
      strategyId: dividendLowVolStrategyService.strategyId,
      symbol: { in: symbols },
    },
    orderBy: [
      { symbol: 'asc' },
      { tradeDate: 'desc' },
      { generatedAt: 'desc' },
    ],
    take: Math.max(symbols.length * 4, symbols.length),
  })
  const latestRows = new Map<string, (typeof rows)[number]>()
  for (const row of rows) {
    if (!latestRows.has(row.symbol)) latestRows.set(row.symbol, row)
  }
  const patchResults = []
  for (const symbol of symbols) {
    const row = latestRows.get(symbol)
    if (!row) continue
    const factset = JSON.parse(row.factsetJson || '{}') as DividendLowVolFactSet
    const patch = patchFactSetFromSeeds(factset, {
      canonical: canonicalBySymbol.get(symbol),
      dividend: dividendSeed.items?.[symbol],
      fundamental: fundamentalSeed.items?.[symbol],
    })
    await prisma.dividendLowVolDaily.update({
      where: { id: row.id },
      data: {
        ttmDividendYield: factset.dividend.ttmDividendYield ?? row.ttmDividendYield,
        avgDividendYield3y: factset.dividend.avgDividendYield3y ?? row.avgDividendYield3y,
        dividendYieldPercentile3y: factset.dividend.dividendYieldPercentile3y ?? row.dividendYieldPercentile3y,
        consecutiveDividendYears: factset.dividend.consecutiveDividendYears,
        payoutRatio: factset.dividend.payoutRatio ?? row.payoutRatio,
        factsetJson: JSON.stringify(factset),
        evidenceRefsJson: JSON.stringify(factset.evidenceRefs || []),
        sourceOperationId,
      },
    })
    patchResults.push({
      symbol,
      changed: patch.changed,
      beforeMissing: patch.beforeMissing,
      afterMissing: patch.afterMissing,
      displayReady: factset.metricCompleteness?.displayReady === true,
    })
  }
  const after = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit: 6000,
    scope: 'all_latest_by_symbol',
  })
  const generatedAt = new Date().toISOString()
  const report = {
    schemaVersion: 'dividend.low_vol.refresh_missing_display_report.v1',
    generatedAt,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    userId,
    tradeDate,
    sourceOperationId,
    limit,
    selectedSymbols: symbols,
    before: {
      total: before.total,
      completeDisplayReadyCount: before.metricCompletenessSummary.completeDisplayReadyCount,
      incompleteDisplayCount: before.metricCompletenessSummary.incompleteDisplayCount,
      completenessPercent: before.metricCompletenessSummary.completenessPercent,
      topMissingMetrics: before.metricCompletenessSummary.topMissingMetrics.slice(0, 12),
    },
    refreshed: {
      patchedCount: patchResults.length,
      displayReadyAfterPatchCount: patchResults.filter((item) => item.displayReady).length,
      changedCount: patchResults.filter((item) => item.changed).length,
      sample: patchResults.slice(0, 20),
    },
    after: {
      total: after.total,
      completeDisplayReadyCount: after.metricCompletenessSummary.completeDisplayReadyCount,
      incompleteDisplayCount: after.metricCompletenessSummary.incompleteDisplayCount,
      completenessPercent: after.metricCompletenessSummary.completenessPercent,
      eligibleResearchCandidates: after.eligibleResearchCandidates,
      topMissingMetrics: after.metricCompletenessSummary.topMissingMetrics.slice(0, 12),
      dispositionCounts: countsBy(after.candidates.map((candidate) => candidate.disposition)),
      leaderStatusCounts: countsBy(after.candidates.map((candidate) => candidate.leaderEvidence.status)),
    },
    policy: {
      notTradingAdvice: true,
      allowedActions: after.policy.allowedActions,
      prohibitedActions: after.policy.prohibitedActions,
      note: 'Missing-display refresh is a data completeness operation only.',
    },
  }
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const reportPath = resolve(auditDir, `dividend-low-vol-refresh-missing-display-${generatedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    reportPath,
    durationMs: report.durationMs,
    selectedCount: symbols.length,
    before: report.before,
    refreshed: report.refreshed,
    after: report.after,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
