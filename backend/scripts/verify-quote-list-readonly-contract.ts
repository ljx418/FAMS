import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fundamentalDataProvider } from '../src/services/technical/fundamentalDataProvider.js'

type CacheItem = {
  code: string
  peDynamic?: number
  pb?: number
}

async function readItems(fileName: string) {
  const parsed = JSON.parse(await readFile(resolve(process.cwd(), `data/${fileName}`), 'utf8')) as {
    items?: CacheItem[]
  }
  return parsed.items || []
}

async function main() {
  process.env.FAMS_QUOTE_LIST_CACHE_READ_ONLY = '1'

  const [canonicalItems, legacyItems] = await Promise.all([
    readItems('a-share-quote-list-canonical.json'),
    readItems('a-share-quote-list-cache.json'),
  ])
  const canonicalByCode = new Map(canonicalItems.map((item) => [item.code, item]))
  const complementary = legacyItems.find((item) => {
    const canonical = canonicalByCode.get(item.code)
    return canonical && canonical.peDynamic === undefined && canonical.pb === undefined && (
      item.peDynamic !== undefined || item.pb !== undefined
    )
  })
  assert.ok(complementary, 'expected a real legacy valuation that complements the canonical cache')

  const startedAt = Date.now()
  const snapshots = await fundamentalDataProvider.getEastmoneyQuoteListSnapshots()
  const elapsedMs = Date.now() - startedAt
  const merged = snapshots.get(complementary.code)

  assert.ok(snapshots.size >= Math.max(canonicalItems.length, legacyItems.length))
  assert.ok(merged?.peDynamic !== undefined || merged?.pb !== undefined)
  assert.match(merged?.source || '', /canonical\+eastmoney_quote_list_cache/)
  assert.ok(elapsedMs < 5_000, `read-only cache lookup must not wait for network refresh; elapsed=${elapsedMs}ms`)

  console.log(JSON.stringify({
    schemaVersion: 'fams.quote-list-readonly-contract.v1',
    status: 'passed',
    canonicalItems: canonicalItems.length,
    legacyItems: legacyItems.length,
    mergedItems: snapshots.size,
    complementaryValuationPreserved: true,
    externalRefreshAttempted: false,
    elapsedMs,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
