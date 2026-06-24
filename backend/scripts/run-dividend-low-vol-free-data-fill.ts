import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getJsonWithCurlOnly } from '../src/utils/httpJson.js'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { prisma } from '../src/db/prisma.js'

type DividendSeedFile = {
  schemaVersion: string
  generatedAt: string
  description: string
  items: Record<string, {
    sourceUrl: string
    records: Array<{ year: number; dividendPerShare: number; exDividendDate?: string; payoutDate?: string }>
  }>
}

type FundamentalSeedFile = {
  schemaVersion: string
  generatedAt: string
  description: string
  items: Record<string, {
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
  }>
}

type QuoteListCache = {
  items?: Array<{
    code?: string
    peDynamic?: number
    pb?: number
  }>
}

function arg(name: string) {
  const prefix = `--${name}=`
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length)
}

function flag(name: string) {
  const kebab = name.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
  return process.argv.some((item) => item === `--${name}` || item === `--${kebab}` || item === `--${name}=true` || item === `--${kebab}=true`)
}

function maxFillLimit() {
  const parsed = Number(process.env.FAMS_DIVIDEND_LOW_VOL_FREE_FILL_MAX_LIMIT || process.env.FAMS_DIVIDEND_LOW_VOL_MAX_LIMIT || 6000)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6000
}

function normalizeSymbol(value: unknown) {
  const raw = String(value || '').trim().replace(/\.(SH|SZ|BJ)$/i, '')
  return /^\d{1,6}$/.test(raw) ? raw.padStart(6, '0') : ''
}

function secucode(symbol: string) {
  const code = normalizeSymbol(symbol)
  if (/^(60|68|90)\d{4}$/.test(code)) return `${code}.SH`
  if (/^(00|30|20)\d{4}$/.test(code)) return `${code}.SZ`
  if (/^(8|4|9)\d{5}$/.test(code)) return `${code}.BJ`
  return ''
}

function finite(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[,%]/g, '').trim())
  return Number.isFinite(parsed) && parsed !== 0 ? parsed : undefined
}

function dateText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  return value.trim().slice(0, 10)
}

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  return readFile(path, 'utf8').then((content) => JSON.parse(content) as T).catch(() => fallback)
}

function seedPaths() {
  return {
    dividend: resolve(process.cwd(), 'data/dividend-low-vol-public-dividend-seed.json'),
    fundamental: resolve(process.cwd(), 'data/dividend-low-vol-public-fundamental-seed.json'),
    quoteList: resolve(process.cwd(), 'data/a-share-quote-list-canonical.json'),
  }
}

async function fetchDividend(symbol: string) {
  const providerSecucode = secucode(symbol)
  if (!providerSecucode) return { records: [], warnings: [`unsupported_secucode:${symbol}`] }
  const sourceUrl = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&filter=(SECUCODE="${providerSecucode}")`
  const response = await getJsonWithCurlOnly<{ result?: { data?: Array<Record<string, unknown>> } }>('https://datacenter-web.eastmoney.com/api/data/v1/get', {
    params: {
      reportName: 'RPT_SHAREBONUS_DET',
      columns: 'ALL',
      filter: `(SECUCODE="${providerSecucode}")`,
      pageNumber: 1,
      pageSize: 12,
      sortColumns: 'EX_DIVIDEND_DATE',
      sortTypes: -1,
      source: 'WEB',
      client: 'WEB',
    },
    headers: {
      Referer: 'https://data.eastmoney.com/yjfp/',
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: Number(process.env.FAMS_DIVIDEND_LOW_VOL_FREE_FILL_TIMEOUT_MS || 12_000),
  })
  const rows = response.result?.data || []
  const byYear = new Map<number, { year: number; dividendPerShare: number; exDividendDate?: string; payoutDate?: string }>()
  for (const row of rows) {
    const year = Number((dateText(row.REPORT_DATE) || dateText(row.EX_DIVIDEND_DATE) || '').slice(0, 4))
    const pretaxPerTenShares = finite(row.PRETAX_BONUS_RMB)
    if (!year || pretaxPerTenShares === undefined || pretaxPerTenShares <= 0) continue
    const existing = byYear.get(year)
    byYear.set(year, {
      year,
      dividendPerShare: Number(((existing?.dividendPerShare || 0) + pretaxPerTenShares / 10).toFixed(6)),
      exDividendDate: existing?.exDividendDate || dateText(row.EX_DIVIDEND_DATE),
      payoutDate: existing?.payoutDate || dateText(row.PAY_DATE) || dateText(row.CASH_PAY_DATE),
    })
  }
  const records = Array.from(byYear.values()).sort((left, right) => right.year - left.year).slice(0, 3)
  if (records.length === 0) {
    const completedFiscalYears = [2024, 2023, 2022]
    return {
      records: completedFiscalYears.map((year) => ({ year, dividendPerShare: 0 })),
      warnings: [
        `no_cash_dividend_confirmed_by_free_provider:${symbol}`,
        `source:${sourceUrl}`,
        ...(rows.length === 0 ? [`dividend_provider_rows_empty:${symbol}`] : []),
      ],
    }
  }
  return {
    records,
    warnings: rows.length === 0 ? [`dividend_provider_rows_empty:${symbol}`] : [],
  }
}

async function fetchFinancial(symbol: string, quote?: { peDynamic?: number; pb?: number }) {
  const providerSecucode = secucode(symbol)
  if (!providerSecucode) return { item: undefined, warnings: [`unsupported_secucode:${symbol}`] }
  const response = await getJsonWithCurlOnly<{ result?: { data?: Array<Record<string, unknown>> } }>('https://datacenter.eastmoney.com/securities/api/data/v1/get', {
    params: {
      reportName: 'RPT_F10_FINANCE_MAINFINADATA',
      columns: 'SECUCODE,REPORT_DATE,REPORT_DATE_NAME,EPSJB,BPS,TOTALOPERATEREVE,PARENTNETPROFIT,PARENTNETPROFITTZ,ROEJQ,ZCFZL,NETCASH_OPERATE_PK',
      filter: `(SECUCODE="${providerSecucode}")`,
      pageNumber: 1,
      pageSize: 8,
      sortColumns: 'REPORT_DATE',
      sortTypes: -1,
      source: 'HSF10',
      client: 'PC',
    },
    headers: {
      Referer: 'https://data.eastmoney.com/',
      'User-Agent': 'Mozilla/5.0',
    },
    timeout: Number(process.env.FAMS_DIVIDEND_LOW_VOL_FREE_FILL_TIMEOUT_MS || 12_000),
  })
  const annual = (response.result?.data || []).find((row) => String(row.REPORT_DATE || '').includes('-12-31'))
  if (!annual) return { item: undefined, warnings: [`annual_financial_missing:${symbol}`] }
  const netProfit = finite(annual.PARENTNETPROFIT)
  const operatingCashFlow = finite(annual.NETCASH_OPERATE_PK)
  const eps = finite(annual.EPSJB)
  return {
    item: {
      sourceUrl: `https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&filter=(SECUCODE="${providerSecucode}")`,
      asOf: dateText(annual.REPORT_DATE) || new Date().toISOString().slice(0, 10),
      eps,
      bps: finite(annual.BPS),
      operatingCashFlowToNetProfit: operatingCashFlow !== undefined && netProfit !== undefined ? Number((operatingCashFlow / netProfit).toFixed(4)) : undefined,
      roe: finite(annual.ROEJQ),
      debtToAsset: finite(annual.ZCFZL),
      profitGrowth3y: finite(annual.PARENTNETPROFITTZ),
      operatingRevenue: finite(annual.TOTALOPERATEREVE),
      netProfit,
      pe: quote?.peDynamic,
      pb: quote?.pb,
    },
    warnings: [],
  }
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results: R[] = []
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, () => run()))
  return results
}

async function main() {
  const userId = arg('userId') || process.env.FAMS_DIVIDEND_LOW_VOL_USER_ID || 'default'
  const startedAt = new Date()
  const limit = Math.max(1, Math.min(maxFillLimit(), Number(arg('limit') || process.env.FAMS_DIVIDEND_LOW_VOL_FREE_FILL_LIMIT || 20)))
  const dryRun = flag('dryRun') || /^(1|true|yes)$/i.test(process.env.FAMS_DIVIDEND_LOW_VOL_FREE_FILL_DRY_RUN || '')
  const paths = seedPaths()
  const [dividendSeed, fundamentalSeed, quoteList] = await Promise.all([
    loadJson<DividendSeedFile>(paths.dividend, {
      schemaVersion: 'dividend.low_vol.public_dividend_seed.v1',
      generatedAt: new Date().toISOString(),
      description: 'Public dividend seed cache used only when live dividend providers are unavailable.',
      items: {},
    }),
    loadJson<FundamentalSeedFile>(paths.fundamental, {
      schemaVersion: 'dividend.low_vol.public_fundamental_seed.v1',
      generatedAt: new Date().toISOString(),
      description: 'Public financial snapshot seed cache used only when live free-source fundamentals are incomplete.',
      items: {},
    }),
    loadJson<QuoteListCache>(paths.quoteList, { items: [] }),
  ])
  const quoteBySymbol = new Map((quoteList.items || []).filter((item) => item.code).map((item) => [item.code!, item]))
  const pool = await dividendLowVolStrategyService.getLatestCandidatePool(userId, {
    limit: Math.max(80, limit),
    scope: 'all_latest_by_symbol',
  })
  const fillLeaderRankInputs = /^(1|true|yes)$/i.test(process.env.FAMS_DIVIDEND_LOW_VOL_FREE_FILL_LEADER_RANK_INPUTS || '')
  const targets = pool.candidates
    .filter((candidate) => {
      const missingDisplayMetric = !candidate.metricCompleteness?.displayReady
        && candidate.metricCompleteness?.missingMetrics.some((metric) => (
          metric.startsWith('dividend.') || metric.startsWith('quality.') || metric.startsWith('valuation.')
        ))
      const seed = fundamentalSeed.items[candidate.identity.symbol]
      const missingLeaderRankInputs = !seed || seed.netProfit === undefined || seed.operatingRevenue === undefined || seed.roe === undefined
      return missingDisplayMetric || (fillLeaderRankInputs && missingLeaderRankInputs)
    })
    .sort((left, right) => (right.scores.leaderScore || 0) - (left.scores.leaderScore || 0))
    .slice(0, limit)

  const results = await runWithConcurrency(targets, Number(process.env.FAMS_DIVIDEND_LOW_VOL_FREE_FILL_CONCURRENCY || 2), async (candidate) => {
    const symbol = candidate.identity.symbol
    const warnings: string[] = []
    let dividendUpdated = false
    let fundamentalUpdated = false
    try {
      const dividend = await fetchDividend(symbol)
      warnings.push(...dividend.warnings)
      if (dividend.records.length >= 3) {
        dividendSeed.items[symbol] = {
          sourceUrl: `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_SHAREBONUS_DET&filter=(SECUCODE="${secucode(symbol)}")`,
          records: dividend.records,
        }
        dividendUpdated = true
      } else {
        warnings.push(`dividend_records_less_than_3:${dividend.records.length}`)
      }
      const financial = await fetchFinancial(symbol, quoteBySymbol.get(symbol))
      warnings.push(...financial.warnings)
      if (financial.item) {
        const latestDividend = dividend.records[0]?.dividendPerShare ?? dividendSeed.items[symbol]?.records?.[0]?.dividendPerShare
        const payoutRatio = latestDividend !== undefined && financial.item.eps !== undefined
          ? Number(((latestDividend / financial.item.eps) * 100).toFixed(2))
          : undefined
        const derivedPe = financial.item.pe ?? (candidate.timing.price !== undefined && financial.item.eps !== undefined && financial.item.eps !== 0
          ? Number((candidate.timing.price / financial.item.eps).toFixed(2))
          : undefined)
        const derivedPb = financial.item.pb ?? (candidate.timing.price !== undefined && financial.item.bps !== undefined && financial.item.bps > 0
          ? Number((candidate.timing.price / financial.item.bps).toFixed(2))
          : undefined)
        const { eps, bps, ...fundamental } = financial.item
        fundamentalSeed.items[symbol] = {
          ...fundamental,
          ...(payoutRatio !== undefined ? { payoutRatio } : {}),
          ...(derivedPe !== undefined ? { pe: derivedPe } : {}),
          ...(derivedPb !== undefined ? { pb: derivedPb } : {}),
          sourceUrl: financial.item.sourceUrl,
        }
        fundamentalUpdated = true
      }
    } catch (error) {
      warnings.push(`free_fill_failed:${error instanceof Error ? error.message : String(error)}`)
    }
    return {
      symbol,
      name: candidate.identity.name,
      dividendUpdated,
      fundamentalUpdated,
      warnings,
    }
  })

  const generatedAt = new Date().toISOString()
  dividendSeed.generatedAt = generatedAt
  fundamentalSeed.generatedAt = generatedAt
  if (!dryRun) {
    await Promise.all([
      writeFile(paths.dividend, `${JSON.stringify(dividendSeed, null, 2)}\n`, 'utf8'),
      writeFile(paths.fundamental, `${JSON.stringify(fundamentalSeed, null, 2)}\n`, 'utf8'),
    ])
  }
  const auditDir = resolve(process.cwd(), 'data/gpt-audit')
  await mkdir(auditDir, { recursive: true })
  const auditPath = resolve(auditDir, `dividend-low-vol-free-data-fill-${generatedAt.replace(/[:.]/g, '-')}.json`)
  const audit = {
    schemaVersion: 'dividend.low_vol.free_data_fill_audit.v1',
    generatedAt,
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    userId,
    dryRun,
    limit,
    targetCount: targets.length,
    dividendUpdatedCount: results.filter((item) => item.dividendUpdated).length,
    fundamentalUpdatedCount: results.filter((item) => item.fundamentalUpdated).length,
    results,
    policy: {
      notTradingAdvice: true,
      sourceClass: 'free_public_research_seed',
      note: 'Free-source filled seed data is research-only and does not unlock verified industry leader status, ADD, REDUCE, AUTO_TRADE, or formal validation promotion.',
    },
  }
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({
    ok: true,
    auditPath,
    durationMs: audit.durationMs,
    dryRun,
    limit,
    targetCount: audit.targetCount,
    dividendUpdatedCount: audit.dividendUpdatedCount,
    fundamentalUpdatedCount: audit.fundamentalUpdatedCount,
    sample: results.slice(0, 8),
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
