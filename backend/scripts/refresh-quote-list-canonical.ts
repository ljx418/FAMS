import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

type SourceItem = {
  symbol: string
  name?: string
  provider: string
  industryName?: string
  totalMarketCap?: number
  floatMarketCap?: number
  peDynamic?: number
  pb?: number
  listStatus?: string
  sourceRefs?: string[]
  fetchedAt?: string
}

type ProviderResult = {
  provider: string
  fetchedAt: string
  itemCount: number
  items: SourceItem[]
  warnings: string[]
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function numberValue(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
}

function normalizeIndustry(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw || raw === '-' || raw === '--') return undefined
  return raw.replace(/\s*[（(]BK\d+[）)]\s*$/i, '').trim()
}

function readEastmoneyCache(): Promise<ProviderResult> {
  return readFile(resolve(process.cwd(), 'data/a-share-quote-list-cache.json'), 'utf8')
    .then((raw) => {
      const parsed = parseJson<{ fetchedAt?: string; items?: Array<Record<string, unknown>> }>(raw, {})
      return {
        provider: 'eastmoney_local_cache',
        fetchedAt: parsed.fetchedAt || new Date().toISOString(),
        itemCount: parsed.items?.length || 0,
        items: (parsed.items || []).map((item) => ({
          symbol: String(item.code || ''),
          name: typeof item.name === 'string' ? item.name : undefined,
          provider: 'eastmoney_local_cache',
          industryName: normalizeIndustry(item.industryName),
          totalMarketCap: numberValue(item.totalMarketCap),
          floatMarketCap: numberValue(item.floatMarketCap),
          peDynamic: numberValue(item.peDynamic),
          pb: numberValue(item.pb),
          sourceRefs: ['data/a-share-quote-list-cache.json'],
          fetchedAt: typeof item.fetchedAt === 'string' ? item.fetchedAt : parsed.fetchedAt,
        })).filter((item) => /^\d{6}$/.test(item.symbol)),
        warnings: [],
      }
    })
    .catch((error) => ({
      provider: 'eastmoney_local_cache',
      fetchedAt: new Date().toISOString(),
      itemCount: 0,
      items: [],
      warnings: [`eastmoney local cache read failed: ${error instanceof Error ? error.message : String(error)}`],
    }))
}

function runPythonSources(): Promise<ProviderResult[]> {
  const script = resolve(process.cwd(), 'scripts/providers/a_share_quote_sources.py')
  return new Promise((resolvePromise) => {
    execFile('python3', [script, '--provider', 'all'], { maxBuffer: 80 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        resolvePromise([{
          provider: 'python_sources',
          fetchedAt: new Date().toISOString(),
          itemCount: 0,
          items: [],
          warnings: [`python sources failed: ${stderr.trim() || error.message}`],
        }])
        return
      }
      const parsed = parseJson<{ providers?: ProviderResult[] }>(stdout.trim().split('\n').at(-1) || '', {})
      resolvePromise(parsed.providers || [{
        provider: 'python_sources',
        fetchedAt: new Date().toISOString(),
        itemCount: 0,
        items: [],
        warnings: ['python sources returned no provider results'],
      }])
    })
  })
}

function marketCapConsensus(values: Array<{ provider: string; value: number }>) {
  if (values.length === 0) return { value: undefined, confidence: 'missing' as const, warning: '缺少市值来源' }
  const primary = values.find((item) => item.provider === 'akshare') || values.find((item) => item.provider === 'eastmoney_local_cache') || values[0]
  if (values.length < 2) return { value: primary.value, confidence: 'single_source' as const }
  const max = Math.max(...values.map((item) => item.value))
  const min = Math.min(...values.map((item) => item.value))
  const diffPercent = max > 0 ? ((max - min) / max) * 100 : 0
  if (diffPercent <= 2) return { value: primary.value, confidence: 'high' as const }
  if (diffPercent <= 5) return { value: primary.value, confidence: 'medium' as const, warning: `市值多源差异 ${diffPercent.toFixed(2)}%` }
  return { value: primary.value, confidence: 'low' as const, warning: `市值多源差异 ${diffPercent.toFixed(2)}% > 5%` }
}

async function main() {
  const startedAt = Date.now()
  const [eastmoney, pythonProviders] = await Promise.all([readEastmoneyCache(), runPythonSources()])
  const providers = [eastmoney, ...pythonProviders]
  const bySymbol = new Map<string, SourceItem[]>()
  for (const provider of providers) {
    for (const item of provider.items || []) {
      if (!/^\d{6}$/.test(item.symbol)) continue
      bySymbol.set(item.symbol, [...(bySymbol.get(item.symbol) || []), item])
    }
  }

  const generatedAt = new Date().toISOString()
  const items = Array.from(bySymbol.entries()).map(([symbol, sources]) => {
    const activeSources = sources.filter((item) => item.listStatus !== 'inactive')
    const usableSources = activeSources.length > 0 ? activeSources : sources
    const name = usableSources.find((item) => item.provider === 'akshare')?.name ||
      usableSources.find((item) => item.name)?.name ||
      symbol
    const industrySources = usableSources
      .map((item) => ({ provider: item.provider, value: normalizeIndustry(item.industryName) }))
      .filter((item): item is { provider: string; value: string } => Boolean(item.value))
    const baostockIndustry = industrySources.find((item) => item.provider === 'baostock')
    const industryName = baostockIndustry?.value || industrySources[0]?.value
    const totalConsensus = marketCapConsensus(usableSources
      .map((item) => ({ provider: item.provider, value: numberValue(item.totalMarketCap) }))
      .filter((item): item is { provider: string; value: number } => Boolean(item.value)))
    const floatConsensus = marketCapConsensus(usableSources
      .map((item) => ({ provider: item.provider, value: numberValue(item.floatMarketCap) }))
      .filter((item): item is { provider: string; value: number } => Boolean(item.value)))
    const peSource = usableSources.find((item) => numberValue(item.peDynamic))
    const pbSource = usableSources.find((item) => numberValue(item.pb))
    const warnings = [
      ...new Set([
        ...(!industryName ? ['缺少行业来源'] : []),
        ...(industrySources.length >= 2 && new Set(industrySources.map((item) => item.value)).size > 1
          ? [`行业多源口径不一致：${industrySources.map((item) => `${item.provider}=${item.value}`).join('; ')}`]
          : []),
        ...(totalConsensus.warning ? [totalConsensus.warning] : []),
        ...(floatConsensus.warning ? [floatConsensus.warning] : []),
      ]),
    ]
    const sourceRefs = usableSources.flatMap((item) => item.sourceRefs || [item.provider])
    const sourceProviders = Array.from(new Set(usableSources.map((item) => item.provider)))
    const hasMarketCap = Boolean(totalConsensus.value || floatConsensus.value)
    const providerCount = sourceProviders.length
    const confidence = industryName && hasMarketCap && providerCount >= 2 && !warnings.some((warning) => warning.includes('> 5%'))
      ? (totalConsensus.confidence === 'high' || floatConsensus.confidence === 'high' ? 'high' : 'medium')
      : industryName && hasMarketCap
        ? 'single_source'
        : 'insufficient'
    return {
      code: symbol,
      name,
      industryName,
      totalMarketCap: totalConsensus.value,
      floatMarketCap: floatConsensus.value,
      peDynamic: numberValue(peSource?.peDynamic),
      pb: numberValue(pbSource?.pb),
      source: 'fams_quote_list_canonical',
      fetchedAt: generatedAt,
      sourceProviders,
      sourceRefs,
      consensusScore: confidence === 'high' ? 100 : confidence === 'medium' ? 80 : confidence === 'single_source' ? 60 : 0,
      confidence,
      warnings,
    }
  }).sort((a, b) => a.code.localeCompare(b.code))

  const covered = items.filter((item) => item.industryName && (item.totalMarketCap || item.floatMarketCap))
  const multiProviderCovered = covered.filter((item) => item.sourceProviders.length >= 2)
  const output = {
    schemaVersion: 'fams.a_share_quote_list_canonical.v1',
    generatedAt,
    itemCount: items.length,
    coverage: {
      fullCoverageCount: covered.length,
      fullCoveragePercent: items.length > 0 ? Number(((covered.length / items.length) * 100).toFixed(2)) : 0,
      multiProviderFullCoverageCount: multiProviderCovered.length,
      multiProviderFullCoveragePercent: items.length > 0 ? Number(((multiProviderCovered.length / items.length) * 100).toFixed(2)) : 0,
    },
    providerReports: providers.map((provider) => ({
      provider: provider.provider,
      itemCount: provider.itemCount,
      warnings: provider.warnings || [],
    })),
    items,
  }
  await mkdir(resolve(process.cwd(), 'data'), { recursive: true })
  await writeFile(resolve(process.cwd(), 'data/a-share-quote-list-canonical.json'), JSON.stringify(output, null, 2))
  console.log(JSON.stringify({
    event: 'quote_list_canonical_refreshed',
    elapsedMs: Date.now() - startedAt,
    itemCount: output.itemCount,
    coverage: output.coverage,
    providerReports: output.providerReports,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
