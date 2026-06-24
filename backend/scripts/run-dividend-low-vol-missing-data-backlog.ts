import 'dotenv/config'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { prisma } from '../src/db/prisma.js'

function csvEscape(value: unknown) {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function isMissing(candidate: Awaited<ReturnType<typeof dividendLowVolStrategyService.getLatestCandidatePool>>['candidates'][number], prefix: string) {
  return candidate.metricCompleteness?.missingMetrics?.some((metric) => metric.startsWith(prefix)) === true
}

async function main() {
  const userId = process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const limit = Number(process.env.FAMS_DIVIDEND_LOW_VOL_BACKLOG_LIMIT || 80)
  const pool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit: Math.max(1, Math.min(6000, limit)),
    scope: 'all_latest_by_symbol',
  })
  const rows = pool.candidates
    .filter((candidate) => !candidate.metricCompleteness?.displayReady)
    .map((candidate) => {
      const missing = candidate.metricCompleteness?.missingMetrics || []
      const needsDividend = isMissing(candidate, 'dividend.')
      const needsFundamental = isMissing(candidate, 'quality.') || isMissing(candidate, 'valuation.') || missing.includes('dividend.payoutRatio')
      const missingDataGap = missing.includes('strategy.dataGapSummary')
      const priority = [
        (candidate.scores.leaderScore || 0) >= 90 ? 30 : 0,
        candidate.identity.industry ? 10 : 0,
        missingDataGap ? 0 : 10,
        needsDividend ? 20 : 0,
        needsFundamental ? 20 : 0,
        Math.round(candidate.scores.evidenceAdjustedScore || 0),
      ].reduce((sum, value) => sum + value, 0)
      return {
        symbol: candidate.identity.symbol,
        name: candidate.identity.name,
        industry: candidate.identity.industry || '',
        priority,
        needsDividend,
        needsFundamental,
        missingMetrics: missing.join('|'),
        blockedReasons: candidate.blockedReasons.join('|'),
        suggestedDividendSource: `https://www.yingman.com/stock/${candidate.identity.symbol}/fenhong/`,
        suggestedFundamentalSource: `https://data.eastmoney.com/stockdata/${candidate.identity.symbol}.html`,
        sourceUrl: '',
        asOf: '',
        dividend_2024: '',
        dividend_2023: '',
        dividend_2022: '',
        ex_2024: '',
        ex_2023: '',
        ex_2022: '',
        pay_2024: '',
        pay_2023: '',
        pay_2022: '',
        payoutRatio: '',
        roe: '',
        ocfToNetProfit: '',
        debtToAsset: '',
        profitGrowth3y: '',
        pe: '',
        pb: '',
        industryDividendYieldPercentile: '',
        seedImportHint: 'Fill the blank import columns in this CSV/XLSX, then run npm run run:dividend-low-vol-public-seed-import -- --file=<csv_or_xlsx>.',
      }
    })
    .sort((left, right) => right.priority - left.priority)
  const generatedAt = new Date().toISOString()
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const jsonPath = resolve(auditDir, `dividend-low-vol-missing-data-backlog-${generatedAt.replace(/[:.]/g, '-')}.json`)
  const csvPath = resolve(auditDir, `dividend-low-vol-missing-data-backlog-${generatedAt.replace(/[:.]/g, '-')}.csv`)
  await writeFile(jsonPath, `${JSON.stringify({
    schemaVersion: 'dividend.low_vol.missing_data_backlog.v1',
    generatedAt,
    userId,
    candidatePoolTotal: pool.total,
    completeDisplayReadyCount: pool.metricCompletenessSummary.completeDisplayReadyCount,
    incompleteDisplayCount: pool.metricCompletenessSummary.incompleteDisplayCount,
    topMissingMetrics: pool.metricCompletenessSummary.topMissingMetrics,
    rows,
    policy: {
      notTradingAdvice: true,
      note: 'This backlog is for data acquisition only. Filling public seed rows does not unlock formal trading actions or verified industry leader status.',
    },
  }, null, 2)}\n`, 'utf8')
  const headers = [
    'symbol',
    'name',
    'industry',
    'priority',
    'needsDividend',
    'needsFundamental',
    'missingMetrics',
    'blockedReasons',
    'suggestedDividendSource',
    'suggestedFundamentalSource',
    'sourceUrl',
    'asOf',
    'dividend_2024',
    'dividend_2023',
    'dividend_2022',
    'ex_2024',
    'ex_2023',
    'ex_2022',
    'pay_2024',
    'pay_2023',
    'pay_2022',
    'payoutRatio',
    'roe',
    'ocfToNetProfit',
    'debtToAsset',
    'profitGrowth3y',
    'pe',
    'pb',
    'industryDividendYieldPercentile',
    'seedImportHint',
  ]
  await writeFile(csvPath, [
    headers.join(','),
    ...rows.map((row) => headers.map((header) => csvEscape((row as Record<string, unknown>)[header])).join(',')),
  ].join('\n') + '\n', 'utf8')
  console.log(JSON.stringify({
    ok: true,
    jsonPath,
    csvPath,
    rowCount: rows.length,
    topRows: rows.slice(0, 10),
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
