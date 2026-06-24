import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { stockScreenerService } from '../src/services/screener/stockScreenerService.js'
import { prisma } from '../src/db/prisma.js'
import { requireDevDbMutationAcknowledgement } from './verificationGuard.js'

async function main() {
  requireDevDbMutationAcknowledgement('verify-quote-list-canonical')
  const raw = JSON.parse(await readFile(resolve(process.cwd(), 'data/a-share-quote-list-canonical.json'), 'utf8')) as {
    schemaVersion: string
    items: Array<{
      code: string
      industryName?: string
      totalMarketCap?: number
      floatMarketCap?: number
      sourceProviders?: string[]
      confidence?: string
    }>
    coverage?: {
      fullCoveragePercent?: number
      multiProviderFullCoveragePercent?: number
    }
  }
  assert.equal(raw.schemaVersion, 'fams.a_share_quote_list_canonical.v1')
  assert.ok((raw.items || []).length >= 5000, 'canonical quote-list should cover the full A-share identity universe')
  assert.ok(raw.items.some((item) => item.sourceProviders?.includes('baostock')), 'canonical should include BaoStock as a source')
  assert.ok(raw.items.some((item) => item.sourceProviders?.includes('akshare')), 'canonical should include AKShare as a source')
  assert.ok(raw.items.some((item) => item.sourceProviders?.includes('eastmoney_local_cache')), 'canonical should include local Eastmoney cache as a source')

  const covered = raw.items.filter((item) => item.industryName && (item.totalMarketCap || item.floatMarketCap))
  const multiProviderCovered = covered.filter((item) => (item.sourceProviders || []).length >= 2)
  assert.ok(covered.length >= 100, 'canonical should contain at least 100 items with industry and market cap')
  assert.ok(multiProviderCovered.length >= 100, 'canonical should contain at least 100 multi-provider items with industry and market cap')
  const symbols = covered.slice(0, 10).map((item) => item.code)
  const report = await stockScreenerService.preheatScreenerFactsets('default', {
    maxScan: symbols.length,
    limit: symbols.length,
    concurrency: 1,
    forceRefresh: true,
    symbols,
  })
  const finalFullCoverage = (report.finalCoverage as any)?.scanned?.fullOfficialCoveragePercent
  assert.equal(finalFullCoverage, 100, `expected canonical-backed preheat coverage 100%, got ${finalFullCoverage}%`)

  console.log(JSON.stringify({
    ok: true,
    itemCount: raw.items.length,
    coverage: raw.coverage,
    validationSymbols: symbols,
    finalFullCoverage,
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
