import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import xlsx from 'xlsx'

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
    pe?: number
    pb?: number
    industryDividendYieldPercentile?: number
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

function envFlag(name: string) {
  return /^(1|true|yes)$/i.test(process.env[name] || '')
}

function normalizeSymbol(value: unknown) {
  const raw = String(value || '').trim().replace(/\.(SH|SZ|BJ)$/i, '')
  const text = /^\d{1,6}$/.test(raw) ? raw.padStart(6, '0') : raw
  return /^\d{6}$/.test(text) ? text : ''
}

function finite(value: unknown) {
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(String(value).replace(/[%，,]/g, '').trim())
  return Number.isFinite(parsed) ? parsed : undefined
}

function text(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

async function loadJson<T>(path: string, fallback: T): Promise<T> {
  return readFile(path, 'utf8').then((content) => JSON.parse(content) as T).catch(() => fallback)
}

function rowsFromFile(path: string) {
  const workbook = xlsx.readFile(path, { cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' })
}

function get(row: Record<string, unknown>, names: string[]) {
  for (const name of names) {
    if (row[name] !== undefined && row[name] !== '') return row[name]
  }
  const entries = Object.entries(row)
  for (const [key, value] of entries) {
    const normalizedKey = key.trim().toLowerCase()
    if (names.some((name) => normalizedKey === name.trim().toLowerCase())) return value
  }
  return undefined
}

function dateText(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  const raw = text(value)
  if (!raw) return undefined
  const normalized = raw.replace(/\//g, '-').slice(0, 10)
  return /^\d{4}-\d{1,2}-\d{1,2}$/.test(normalized)
    ? normalized.split('-').map((part, index) => index === 0 ? part.padStart(4, '0') : part.padStart(2, '0')).join('-')
    : undefined
}

async function main() {
  const file = arg('file') || process.env.FAMS_DIVIDEND_LOW_VOL_PUBLIC_SEED_IMPORT_FILE
  if (!file) throw new Error('Missing --file=<csv_or_xlsx>')
  const dryRun = flag('dryRun') || envFlag('FAMS_DIVIDEND_LOW_VOL_PUBLIC_SEED_IMPORT_DRY_RUN')
  const dividendPath = resolve(process.cwd(), 'data/dividend-low-vol-public-dividend-seed.json')
  const fundamentalPath = resolve(process.cwd(), 'data/dividend-low-vol-public-fundamental-seed.json')
  const [dividendSeed, fundamentalSeed] = await Promise.all([
    loadJson<DividendSeedFile>(dividendPath, {
      schemaVersion: 'dividend.low_vol.public_dividend_seed.v1',
      generatedAt: new Date().toISOString(),
      description: 'Public dividend seed cache used only when live dividend providers are unavailable.',
      items: {},
    }),
    loadJson<FundamentalSeedFile>(fundamentalPath, {
      schemaVersion: 'dividend.low_vol.public_fundamental_seed.v1',
      generatedAt: new Date().toISOString(),
      description: 'Public financial snapshot seed cache used only when live free-source fundamentals are incomplete.',
      items: {},
    }),
  ])
  const rows = rowsFromFile(resolve(process.cwd(), file))
  let dividendUpdated = 0
  let fundamentalUpdated = 0
  const skipped: Array<{ row: number; reason: string }> = []
  rows.forEach((row, index) => {
    const symbol = normalizeSymbol(get(row, ['symbol', 'code', '证券代码', '代码']))
    if (!symbol) {
      skipped.push({ row: index + 2, reason: 'missing_symbol' })
      return
    }
    const sourceUrl = text(get(row, ['sourceUrl', 'source', '来源', '来源URL'])) || `public-seed-import:${symbol}`
    const dividendRecords = [2024, 2023, 2022]
      .map((year) => {
        const dividendPerShare = finite(get(row, [`dividend_${year}`, `dps_${year}`, `${year}_dividend`, `${year}分红`, `${year}每股分红`]))
        if (dividendPerShare === undefined || dividendPerShare <= 0) return null
        return {
          year,
          dividendPerShare,
          ...(dateText(get(row, [`ex_${year}`, `exDividendDate_${year}`, `${year}_ex`, `${year}除权日`])) ? { exDividendDate: dateText(get(row, [`ex_${year}`, `exDividendDate_${year}`, `${year}_ex`, `${year}除权日`])) } : {}),
          ...(dateText(get(row, [`pay_${year}`, `payoutDate_${year}`, `${year}_pay`, `${year}派息日`])) ? { payoutDate: dateText(get(row, [`pay_${year}`, `payoutDate_${year}`, `${year}_pay`, `${year}派息日`])) } : {}),
        }
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (dividendRecords.length > 0) {
      dividendSeed.items[symbol] = { sourceUrl, records: dividendRecords }
      dividendUpdated += 1
    }
    const fundamental = {
      payoutRatio: finite(get(row, ['payoutRatio', 'payout_ratio', '支付率'])),
      operatingCashFlowToNetProfit: finite(get(row, ['operatingCashFlowToNetProfit', 'ocfToNetProfit', 'ocf_np', '经营现金流净利润比'])),
      roe: finite(get(row, ['roe', 'ROE', '净资产收益率'])),
      debtToAsset: finite(get(row, ['debtToAsset', 'debt_asset', '资产负债率'])),
      profitGrowth3y: finite(get(row, ['profitGrowth3y', 'profit_growth_3y', '三年利润增长'])),
      pe: finite(get(row, ['pe', 'PE', '市盈率'])),
      pb: finite(get(row, ['pb', 'PB', '市净率'])),
      industryDividendYieldPercentile: finite(get(row, ['industryDividendYieldPercentile', 'industry_dividend_percentile', '行业股息分位'])),
    }
    const hasFundamental = Object.values(fundamental).some((value) => value !== undefined)
    if (hasFundamental) {
      fundamentalSeed.items[symbol] = {
        sourceUrl,
        asOf: dateText(get(row, ['asOf', 'reportDate', '报告期'])) || new Date().toISOString().slice(0, 10),
        ...Object.fromEntries(Object.entries(fundamental).filter(([, value]) => value !== undefined)),
      }
      fundamentalUpdated += 1
    }
  })
  const generatedAt = new Date().toISOString()
  dividendSeed.generatedAt = generatedAt
  fundamentalSeed.generatedAt = generatedAt
  if (!dryRun) {
    await Promise.all([
      writeFile(dividendPath, `${JSON.stringify(dividendSeed, null, 2)}\n`, 'utf8'),
      writeFile(fundamentalPath, `${JSON.stringify(fundamentalSeed, null, 2)}\n`, 'utf8'),
    ])
  }
  console.log(JSON.stringify({
    ok: true,
    dryRun,
    file,
    rows: rows.length,
    dividendUpdated,
    fundamentalUpdated,
    skipped,
    dividendPath,
    fundamentalPath,
    writeApplied: !dryRun,
    note: 'Imported public seed data is research-only and does not unlock formal trading actions.',
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
