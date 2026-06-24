import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { securityStatusService } from '../src/services/market-data/securityStatusService.js'
import { prisma } from '../src/db/prisma.js'

type CanonicalFile = {
  items?: Array<{
    code: string
    name?: string
  }>
}

function parseLimit() {
  const value = Number(process.env.FAMS_SECURITY_STATUS_WARMUP_LIMIT || process.argv.find((item) => item.startsWith('--limit='))?.slice('--limit='.length) || 120)
  return Number.isFinite(value) && value > 0 ? Math.min(5849, Math.floor(value)) : 120
}

function parseSymbols() {
  const raw = process.argv.find((item) => item.startsWith('--symbols='))?.slice('--symbols='.length)
    || process.env.FAMS_SECURITY_STATUS_WARMUP_SYMBOLS
    || ''
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d{6}$/.test(item))
}

async function main() {
  const limit = parseLimit()
  const requestedSymbols = parseSymbols()
  const canonicalPath = resolve(process.cwd(), 'data/a-share-quote-list-canonical.json')
  const canonical = JSON.parse(await readFile(canonicalPath, 'utf8')) as CanonicalFile
  const tradeDate = new Date().toISOString().slice(0, 10)
  const records = (canonical.items || [])
    .filter((item) => /^\d{6}$/.test(item.code) && (requestedSymbols.length === 0 || requestedSymbols.includes(item.code)))
    .slice(0, requestedSymbols.length > 0 ? requestedSymbols.length : limit)
    .map((item) => ({
      asset: {
        symbol: item.code,
        name: item.name || item.code,
      },
      history: [
        {
          date: tradeDate,
          open: 10,
          high: 10.2,
          low: 9.8,
          close: 10,
          volume: 1,
        },
      ],
    }))
  const coverage = await securityStatusService.upsertHeuristicFromRecords(records)
  console.log(JSON.stringify({
    ok: true,
    limit,
    records: records.length,
    coverage,
    note: 'Generated quote-list/heuristic security status and tradeability facts for research readiness only. This is not a formal exchange/Tushare trading-state source.',
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
