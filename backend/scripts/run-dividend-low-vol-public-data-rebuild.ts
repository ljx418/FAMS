import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dividendLowVolUniverseService } from '../src/services/dividend-low-vol/dividendLowVolUniverseService.js'
import { dividendLowVolInputBuilderService } from '../src/services/dividend-low-vol/dividendLowVolInputBuilderService.js'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { prisma } from '../src/db/prisma.js'

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

function numberArg(name: string, fallback: number) {
  const raw = arg(name) || process.env[`FAMS_DIVIDEND_LOW_VOL_${name.toUpperCase()}`]
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function loadJson(path: string) {
  return JSON.parse(await readFile(path, 'utf8')) as {
    items?: Record<string, unknown>
  }
}

function seedPaths() {
  return {
    dividend: resolve(process.cwd(), 'data/dividend-low-vol-public-dividend-seed.json'),
    fundamental: resolve(process.cwd(), 'data/dividend-low-vol-public-fundamental-seed.json'),
  }
}

function topMissing(pool: ReturnType<typeof dividendLowVolStrategyService.buildCandidatePool>) {
  return (pool.metricCompletenessSummary?.topMissingMetrics || []).slice(0, 12)
}

function maxScanLimit() {
  const parsed = Number(process.env.FAMS_DIVIDEND_LOW_VOL_MAX_LIMIT || 6000)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6000
}

function countsBy<T extends string>(items: T[]) {
  const map = new Map<T, number>()
  for (const item of items) map.set(item, (map.get(item) || 0) + 1)
  return Array.from(map.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count)
}

async function main() {
  const startedAt = new Date()
  const limit = Math.max(1, Math.min(maxScanLimit(), numberArg('limit', 120)))
  const userId = arg('userId') || process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const tradeDate = arg('tradeDate') || new Date().toISOString().slice(0, 10)
  const paths = seedPaths()
  const [dividendSeed, fundamentalSeed] = await Promise.all([
    loadJson(paths.dividend).catch(() => ({ items: {} })),
    loadJson(paths.fundamental).catch(() => ({ items: {} })),
  ])
  const universe = await dividendLowVolUniverseService.getAllAShareInputs({ limit })
  const universeSymbols = new Set(universe.inputs.map((item) => item.symbol))
  const dividendSeedSymbols = Object.keys(dividendSeed.items || {}).filter((symbol) => universeSymbols.has(symbol))
  const fundamentalSeedSymbols = Object.keys(fundamentalSeed.items || {}).filter((symbol) => universeSymbols.has(symbol))
  const inputs = await dividendLowVolInputBuilderService.buildFromInputs(universe.inputs, limit)
  const pool = await dividendLowVolStrategyService.persistCandidatePool(userId, inputs, {
    tradeDate,
    universeSummary: {
      ...universe.summary,
      rules: [
        ...universe.summary.rules,
        'Public dividend/fundamental seed caches may fill research-only display metrics when live free-source providers timeout.',
        'Public seed evidence never unlocks verified_industry_leader, formal ADD/REDUCE, AUTO_TRADE, or formal validation promotion.',
      ],
    },
  })
  const complete = pool.candidates.filter((candidate) => candidate.metricCompleteness.displayReady)
  const eligible = complete.filter((candidate) => !['avoid', 'data_insufficient'].includes(candidate.disposition))
  const generatedAt = new Date().toISOString()
  const report = {
    schemaVersion: 'dividend.low_vol.public_data_rebuild_report.v1',
    generatedAt,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    userId,
    tradeDate,
    limit,
    seedCoverage: {
      dividendSeedPath: paths.dividend,
      fundamentalSeedPath: paths.fundamental,
      dividendSeedTotal: Object.keys(dividendSeed.items || {}).length,
      fundamentalSeedTotal: Object.keys(fundamentalSeed.items || {}).length,
      dividendSeedInUniverse: dividendSeedSymbols.length,
      fundamentalSeedInUniverse: fundamentalSeedSymbols.length,
      dividendSeedUniverseCoveragePercent: universe.inputs.length > 0 ? Number(((dividendSeedSymbols.length / universe.inputs.length) * 100).toFixed(2)) : 0,
      fundamentalSeedUniverseCoveragePercent: universe.inputs.length > 0 ? Number(((fundamentalSeedSymbols.length / universe.inputs.length) * 100).toFixed(2)) : 0,
    },
    candidatePool: {
      total: pool.total,
      completeDisplayReadyCount: complete.length,
      eligibleCompleteCount: eligible.length,
      completenessPercent: pool.metricCompletenessSummary.completenessPercent,
      topMissingMetrics: topMissing(pool),
      dispositionCounts: countsBy(pool.candidates.map((candidate) => candidate.disposition)),
      gradeCounts: countsBy(pool.candidates.map((candidate) => candidate.candidateGrade)),
      leaderStatusCounts: countsBy(pool.candidates.map((candidate) => candidate.leaderEvidence.status)),
      dataVerificationStatusCounts: countsBy(pool.candidates.map((candidate) => candidate.dataVerification.status)),
      rejectionSummary: pool.rejectionSummary,
      leaderAuditSummary: pool.leaderAuditSummary,
      metricCompletenessSummary: pool.metricCompletenessSummary,
      alertSummary: pool.alertSummary,
      eligibleCompleteSymbols: eligible.map((candidate) => ({
        symbol: candidate.identity.symbol,
        name: candidate.identity.name,
        industry: candidate.identity.industry,
        candidateGrade: candidate.candidateGrade,
        disposition: candidate.disposition,
        ttmDividendYield: candidate.dividend.ttmDividendYield,
        evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
        leaderScore: candidate.scores.leaderScore,
        lowVolScore: candidate.scores.lowVolScore,
        dividendQualityScore: candidate.scores.dividendQualityScore,
        valuationScore: candidate.scores.valuationScore,
        leaderVerificationStatus: candidate.leaderEvidence.status,
        alerts: candidate.alerts.map((alert) => alert.type),
        blockedReasons: candidate.blockedReasons,
      })),
      completeCandidates: complete.map((candidate) => ({
        symbol: candidate.identity.symbol,
        name: candidate.identity.name,
        industry: candidate.identity.industry,
        candidateGrade: candidate.candidateGrade,
        disposition: candidate.disposition,
        ttmDividendYield: candidate.dividend.ttmDividendYield,
        evidenceAdjustedScore: candidate.scores.evidenceAdjustedScore,
        leaderScore: candidate.scores.leaderScore,
        dataVerificationStatus: candidate.dataVerification.status,
        leaderVerificationStatus: candidate.leaderEvidence.status,
        leaderEvidence: {
          status: candidate.leaderEvidence.status,
          marketCapRankVerified: candidate.leaderEvidence.marketCapRankVerified,
          revenueRankVerified: candidate.leaderEvidence.revenueRankVerified,
          netProfitRankVerified: candidate.leaderEvidence.netProfitRankVerified,
          roePercentileVerified: candidate.leaderEvidence.roePercentileVerified,
          providerCrossCheckedIndustryRank: candidate.leaderEvidence.providerCrossCheckedIndustryRank,
          seedFallbackUsed: candidate.leaderEvidence.seedFallbackUsed,
          missingFields: candidate.leaderEvidence.missingFields,
          evidenceRefs: candidate.leaderEvidence.evidenceRefs.slice(0, 20),
        },
        blockedReasons: candidate.blockedReasons,
        allowedActions: candidate.tradingDiscipline.allowedActions,
        prohibitedActions: candidate.tradingDiscipline.prohibitedActions,
        evidenceRefs: candidate.evidenceRefs.filter((ref) => (
          ref.includes('public-seed')
          || ref.includes('market-bar')
          || ref.includes('quote-list')
          || ref.includes('leader:')
          || ref.includes('rank')
        )).slice(0, 30),
      })),
    },
    providerRunSummary: {
      sourceClass: 'free_public_research_sources',
      formalProviderRequired: false,
      formalProviderUpgradeAvailable: true,
      note: 'This run uses free/public evidence paths and public seed caches. Tushare or other formal providers remain optional upgrade providers.',
    },
    policy: {
      notTradingAdvice: true,
      allowedActions: pool.policy.allowedActions,
      prohibitedActions: pool.policy.prohibitedActions,
      formalTradeActionAllowed: false,
      autoTradeAllowed: false,
      note: 'This rebuild is research-only. Public seed evidence is for display completeness and auditability, not formal validation.',
    },
  }
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const reportPath = resolve(auditDir, `dividend-low-vol-public-data-rebuild-${generatedAt.replace(/[:.]/g, '-')}.json`)
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    reportPath,
    durationMs: report.durationMs,
    total: report.candidatePool.total,
    complete: report.candidatePool.completeDisplayReadyCount,
    eligibleComplete: report.candidatePool.eligibleCompleteCount,
    eligibleCompleteSymbols: report.candidatePool.eligibleCompleteSymbols,
    dispositionCounts: report.candidatePool.dispositionCounts,
    leaderStatusCounts: report.candidatePool.leaderStatusCounts,
    topReasons: report.candidatePool.rejectionSummary.topReasons.slice(0, 10),
    topMissingMetrics: report.candidatePool.topMissingMetrics,
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
