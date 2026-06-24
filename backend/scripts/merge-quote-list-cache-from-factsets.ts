import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'

type CacheFile = {
  schemaVersion: 'fams.a_share_quote_list_cache.v1'
  provider: 'eastmoney'
  fetchedAt: string
  itemCount: number
  items: Array<{
    code: string
    name: string
    totalMarketCap?: number
    floatMarketCap?: number
    industryName?: string
    source?: string
    fetchedAt?: string
  }>
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  try {
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function industryName(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return undefined
  return raw.replace(/\s*[（(]BK\d+[）)]\s*$/i, '').trim()
}

async function main() {
  const cachePath = resolve(process.cwd(), 'data/a-share-quote-list-cache.json')
  const existing = parseJson<CacheFile>(await readFile(cachePath, 'utf8').catch(() => ''), {
    schemaVersion: 'fams.a_share_quote_list_cache.v1',
    provider: 'eastmoney',
    fetchedAt: new Date().toISOString(),
    itemCount: 0,
    items: [],
  })
  const byCode = new Map(existing.items.map((item) => [item.code, item]))
  const caches = await prisma.stockFactSetCache.findMany({
    where: {
      factsetType: 'stock_full_analysis',
      factsetSchemaVersion: 'stock.analysis.factset.v1',
      market: { in: ['A股', 'CN'] },
      status: { in: ['fresh', 'stale', 'partial'] },
    },
    orderBy: { generatedAt: 'desc' },
    select: { symbol: true, factsJson: true, generatedAt: true },
  })

  let merged = 0
  for (const cache of caches) {
    const factSet = parseJson<{ fundamental?: { facts?: Array<{ id: string; value: unknown }> } }>(cache.factsJson, {})
    const facts = factSet.fundamental?.facts || []
    const byId = new Map(facts.map((fact) => [fact.id, fact]))
    const industry = industryName(byId.get('em_industry_board')?.value)
    const totalMarketCap = numberValue(byId.get('em_total_market_cap')?.value)
    const floatMarketCap = numberValue(byId.get('em_float_market_cap')?.value)
    if (!industry || (!totalMarketCap && !floatMarketCap)) continue
    const current = byCode.get(cache.symbol)
    if (current?.industryName && (current.totalMarketCap || current.floatMarketCap)) continue
    byCode.set(cache.symbol, {
      code: cache.symbol,
      name: current?.name || cache.symbol,
      totalMarketCap,
      floatMarketCap,
      industryName: industry,
      source: 'stock_factset_cache_merge',
      fetchedAt: cache.generatedAt.toISOString(),
    })
    merged += 1
  }

  const items = Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code))
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, JSON.stringify({
    schemaVersion: 'fams.a_share_quote_list_cache.v1',
    provider: 'eastmoney',
    fetchedAt: new Date().toISOString(),
    itemCount: items.length,
    items,
  } satisfies CacheFile, null, 2))

  console.log(JSON.stringify({
    event: 'quote_list_cache_merged_from_factsets',
    previousItems: existing.items.length,
    mergedItems: merged,
    finalItems: items.length,
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
