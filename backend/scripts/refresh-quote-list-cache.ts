import { fundamentalDataProvider } from '../src/services/technical/fundamentalDataProvider.js'

async function main() {
  process.env.FAMS_REFRESH_QUOTE_LIST_CACHE = '1'
  const startedAt = Date.now()
  const snapshots = await fundamentalDataProvider.getEastmoneyQuoteListSnapshots()
  const covered = Array.from(snapshots.values()).filter((item) => item.industryName && (item.totalMarketCap || item.floatMarketCap))
  const sourceSummary = Array.from(snapshots.values()).reduce((map, item) => {
    const source = item.source || 'unknown'
    map.set(source, (map.get(source) || 0) + 1)
    return map
  }, new Map<string, number>())
  const externalCount = Array.from(sourceSummary.entries())
    .filter(([source]) => source === 'eastmoney_quote_list')
    .reduce((sum, [, count]) => sum + count, 0)
  console.log(JSON.stringify({
    event: externalCount > 0 ? 'quote_list_cache_refreshed' : 'quote_list_cache_refresh_fell_back_to_local_cache',
    provider: 'eastmoney',
    totalSnapshots: snapshots.size,
    coveredSnapshots: covered.length,
    coveragePercent: snapshots.size > 0 ? Number(((covered.length / snapshots.size) * 100).toFixed(2)) : 0,
    externalSnapshots: externalCount,
    sourceSummary: Object.fromEntries(sourceSummary.entries()),
    elapsedMs: Date.now() - startedAt,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
