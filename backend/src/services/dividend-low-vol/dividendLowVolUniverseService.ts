import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DividendLowVolInput } from './dividendLowVolTypes.js'

type CanonicalItem = {
  code: string
  name?: string
  industryName?: string
  totalMarketCap?: number
  floatMarketCap?: number
  peDynamic?: number
  pb?: number
  sourceProviders?: string[]
  sourceRefs?: string[]
  confidence?: string
  consensusScore?: number
  warnings?: string[]
}

type CanonicalFile = {
  schemaVersion: string
  generatedAt: string
  itemCount: number
  items: CanonicalItem[]
}

type LeaderSeedFile = {
  schemaVersion: string
  items: Record<string, {
    industry?: string
    totalMarketCap?: number
    avgTurnoverAmount60?: number
    leaderScore?: number
    marketCapRankScore?: number
    revenueRankScore?: number
    netProfitRankScore?: number
    roeIndustryPercentile?: number
    liquidityRankScore?: number
    sourceRef: string
  }>
}

const canonicalPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/a-share-quote-list-canonical.json')
const leaderSeedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/dividend-low-vol-leader-seed.json')

function normalizeIndustry(industry?: string) {
  return (industry || 'UNKNOWN').replace(/^[A-Z]\d{2}/, '').trim() || 'UNKNOWN'
}

function rankScore(rank: number, count: number) {
  if (count <= 1) return 100
  return Math.max(0, Math.min(100, (100 * (count - rank)) / (count - 1)))
}

function isRiskName(name?: string) {
  return /(^|\s)(ST|\*ST|退|PT)/i.test(name || '') || /退市|退/.test(name || '')
}

function maxUniverseLimit() {
  const parsed = Number(process.env.FAMS_DIVIDEND_LOW_VOL_MAX_LIMIT || 6000)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 6000
}

function industryTakeLimit(scanLimit: number) {
  const parsed = Number(process.env.FAMS_DIVIDEND_LOW_VOL_INDUSTRY_TOP_N || '')
  if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed)
  return scanLimit > 200 ? Number.MAX_SAFE_INTEGER : 5
}

function marketCapFloor() {
  const raw = process.env.FAMS_DIVIDEND_LOW_VOL_UNIVERSE_MARKET_CAP_FLOOR
  if (raw === undefined || raw === '') return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export class DividendLowVolUniverseService {
  private canonicalCache?: Promise<CanonicalFile | null>
  private leaderSeedCache?: Promise<LeaderSeedFile | null>

  async getAllAShareInputs(options: { limit?: number } = {}): Promise<{
    inputs: DividendLowVolInput[]
    summary: {
      schemaVersion: 'dividend.low_vol.universe_selection.v1'
      universeSource: 'a-share-quote-list-canonical'
      universeTotal: number
      prefilteredCount: number
      selectedCount: number
      generatedAt: string
      rules: string[]
    }
  }> {
    const limit = Math.max(1, Math.min(maxUniverseLimit(), Math.floor(options.limit || 120)))
    const canonical = await this.readCanonical()
    const items = canonical?.items || []
    const leaderSeed = await this.readLeaderSeed()
    const minMarketCap = marketCapFloor()
    const itemByCode = new Map(items.map((item) => [item.code, item]))
    const byIndustry = new Map<string, CanonicalItem[]>()
    for (const item of items) {
      if (!/^\d{6}$/.test(item.code || '')) continue
      if (isRiskName(item.name)) continue
      if ((item.totalMarketCap || item.floatMarketCap || 0) < minMarketCap) continue
      if (!item.industryName) continue
      const industry = normalizeIndustry(item.industryName)
      const group = byIndustry.get(industry) || []
      group.push(item)
      byIndustry.set(industry, group)
    }

    const candidates: DividendLowVolInput[] = []
    const takePerIndustry = industryTakeLimit(limit)
    for (const [industry, group] of byIndustry.entries()) {
      const ranked = [...group]
        .sort((left, right) => (right.totalMarketCap || right.floatMarketCap || 0) - (left.totalMarketCap || left.floatMarketCap || 0))
      const take = Math.min(takePerIndustry, ranked.length)
      for (let index = 0; index < take; index += 1) {
        const item = ranked[index]
        const rank = index + 1
        const marketCapRankScore = rankScore(rank, ranked.length)
        candidates.push({
          symbol: item.code,
          name: item.name || item.code,
          market: 'A_SHARE',
          assetType: 'stock',
          industry,
          isST: isRiskName(item.name),
          isDelisted: /退市|退/.test(item.name || ''),
          totalMarketCap: item.totalMarketCap || item.floatMarketCap,
          marketCapRankScore,
          leaderScore: marketCapRankScore >= 92 ? Math.max(75, marketCapRankScore) : undefined,
          pe: item.peDynamic,
          pb: item.pb,
          evidenceRefs: [
            `quote-list-canonical:${item.code}`,
            ...(item.sourceRefs || []),
            `dividend-low-vol:universe:industry:${industry}:market_cap_rank:${rank}/${ranked.length}`,
            ...(item.sourceProviders || []).map((provider) => `quote-list-canonical-provider:${item.code}:${provider}`),
            ...(item.confidence ? [`quote-list-canonical-confidence:${item.code}:${item.confidence}`] : []),
            ...((item.warnings || []).map((warning) => `warning:quote-list-canonical:${item.code}:${warning}`)),
          ],
        })
      }
    }

    for (const [symbol, seed] of Object.entries(leaderSeed?.items || {})) {
      if (!/^\d{6}$/.test(symbol)) continue
      if (candidates.some((item) => item.symbol === symbol)) continue
      const canonicalItem = itemByCode.get(symbol)
      if (isRiskName(canonicalItem?.name)) continue
      candidates.push({
        symbol,
        name: canonicalItem?.name || symbol,
        market: 'A_SHARE',
        assetType: 'stock',
        industry: seed.industry || normalizeIndustry(canonicalItem?.industryName),
        isST: isRiskName(canonicalItem?.name),
        isDelisted: /退市|退/.test(canonicalItem?.name || ''),
        totalMarketCap: seed.totalMarketCap || canonicalItem?.totalMarketCap || canonicalItem?.floatMarketCap,
        avgTurnoverAmount60: seed.avgTurnoverAmount60,
        leaderScore: seed.leaderScore,
        marketCapRankScore: seed.marketCapRankScore,
        revenueRankScore: seed.revenueRankScore,
        netProfitRankScore: seed.netProfitRankScore,
        roeIndustryPercentile: seed.roeIndustryPercentile,
        liquidityRankScore: seed.liquidityRankScore,
        pe: canonicalItem?.peDynamic,
        pb: canonicalItem?.pb,
        evidenceRefs: [
          `quote-list-canonical:${symbol}`,
          ...(canonicalItem?.sourceRefs || []),
          `leader:${symbol}:${seed.sourceRef}`,
          `dividend-low-vol:universe:leader_seed:${symbol}`,
          ...(canonicalItem?.sourceProviders || []).map((provider) => `quote-list-canonical-provider:${symbol}:${provider}`),
          ...(canonicalItem?.warnings || []).map((warning) => `warning:quote-list-canonical:${symbol}:${warning}`),
        ],
      })
    }

    const selected = candidates
      .sort((left, right) => (right.totalMarketCap || 0) - (left.totalMarketCap || 0))
      .slice(0, limit)

    return {
      inputs: selected,
      summary: {
        schemaVersion: 'dividend.low_vol.universe_selection.v1',
        universeSource: 'a-share-quote-list-canonical',
        universeTotal: items.length,
        prefilteredCount: candidates.length,
        selectedCount: selected.length,
        generatedAt: new Date().toISOString(),
        rules: [
          '从全 A canonical quote list 读取身份、行业、市值和多源证据。',
          '当 canonical 缺少大型行业龙头市值时，使用显式 leader seed 补入预筛，不直接放行候选。',
          `剔除 ST、退市风险、无行业标的；Universe 市值入口下限由 FAMS_DIVIDEND_LOW_VOL_UNIVERSE_MARKET_CAP_FLOOR 控制。`,
          `按行业总市值排序，小样本默认保留每行业前 5 名；大样本或 FAMS_DIVIDEND_LOW_VOL_INDUSTRY_TOP_N 配置下扩展到每行业前 ${takePerIndustry === Number.MAX_SAFE_INTEGER ? '全部' : takePerIndustry} 名。`,
          `Universe 入口市值下限为 ${minMarketCap}；默认扫描全 A 可识别行业样本，低于策略 100 亿硬条件或市值缺失的标的仍会在评分层以 market_cap_below_10b 或 data gap 剔除。`,
          '后续仍需分红、行情、低波、估值和风险硬条件复核。',
        ],
      },
    }
  }

  private async readCanonical() {
    if (!this.canonicalCache) {
      this.canonicalCache = readFile(canonicalPath, 'utf8')
        .then((content) => JSON.parse(content) as CanonicalFile)
        .catch(() => null)
    }
    return this.canonicalCache
  }

  private async readLeaderSeed() {
    if (!this.leaderSeedCache) {
      this.leaderSeedCache = readFile(leaderSeedPath, 'utf8')
        .then((content) => JSON.parse(content) as LeaderSeedFile)
        .catch(() => null)
    }
    return this.leaderSeedCache
  }
}

export const dividendLowVolUniverseService = new DividendLowVolUniverseService()
