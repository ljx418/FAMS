import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { fundamentalDataProvider } from '../src/services/technical/fundamentalDataProvider.js'
import { stockScreenerService } from '../src/services/screener/stockScreenerService.js'
import { prisma } from '../src/db/prisma.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function main() {
  requireDevDbMutationAcknowledgement('verify-quote-list-cache')

  const cachePath = resolve(process.cwd(), 'data/a-share-quote-list-cache.json')
  const raw = JSON.parse(await readFile(cachePath, 'utf8')) as {
    schemaVersion: string
    items: Array<{ code: string; totalMarketCap?: number; floatMarketCap?: number; industryName?: string }>
  }
  assert.equal(raw.schemaVersion, 'fams.a_share_quote_list_cache.v1')
  const fullyCoveredSymbols = raw.items
    .filter((item) => item.industryName && (item.totalMarketCap || item.floatMarketCap))
    .map((item) => item.code)
  assert.ok(fullyCoveredSymbols.length >= 10, 'quote-list cache should contain a usable validation sample')

  const cached = await fundamentalDataProvider.readQuoteListCache()
  assert.ok(cached.size >= fullyCoveredSymbols.length, 'provider cache reader should load local quote-list cache')
  for (const symbol of fullyCoveredSymbols.slice(0, 10)) {
    const snapshot = await fundamentalDataProvider.getEastmoneyQuoteListSnapshot(symbol)
    assert.ok(snapshot?.industryName, `${symbol} should have industry from local quote-list cache`)
    assert.ok(snapshot?.totalMarketCap || snapshot?.floatMarketCap, `${symbol} should have market cap from local quote-list cache`)
  }

  const symbols = fullyCoveredSymbols.slice(0, 10)
  const report = await stockScreenerService.preheatScreenerFactsets('default', {
    maxScan: symbols.length,
    limit: symbols.length,
    concurrency: 1,
    forceRefresh: true,
    symbols,
  })
  const finalFullCoverage = (report.finalCoverage as any)?.scanned?.fullOfficialCoveragePercent
  assert.equal(finalFullCoverage, 100, `expected quote-list cache-backed preheat coverage 100%, got ${finalFullCoverage}%`)
  assert.equal(report.failureSymbols, 0)

  console.log(JSON.stringify({
    ok: true,
    cacheItems: raw.items.length,
    validationSymbols: symbols,
    finalFullCoverage,
    elapsedMs: report.elapsedMs,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
