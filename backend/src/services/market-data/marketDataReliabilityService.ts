import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  marketDataFreshnessService,
  type MarketDataFreshnessOptions,
  type MarketDataFreshnessReport,
  type MarketDataFreshnessStatus,
} from './marketDataFreshnessService.js'
import {
  marketDataService,
  type ProviderReliabilitySnapshotItem,
} from './marketDataService.js'

export type MarketDataReliabilityStatus = 'healthy' | 'degraded' | 'blocked'

export interface MarketDataReliabilityClassification {
  status: MarketDataReliabilityStatus
  reasons: string[]
}

export interface MarketDataReliabilityReport {
  schemaVersion: 'fams.market_data.reliability.v1'
  generatedAt: string
  userId: string
  scope: MarketDataFreshnessReport['scope']
  mode: 'free_source_research'
  realtimeGuarantee: false
  status: MarketDataReliabilityStatus
  reasons: string[]
  providerRuntime: ProviderReliabilitySnapshotItem[]
  freshness: MarketDataFreshnessReport
  blockers: string[]
  warnings: string[]
  recoveryActions: Array<{
    code: 'retry_live_quote' | 'refresh_market_bar_cache' | 'run_market_bar_preheat_then_rescan' | 'inspect_provider_health'
    label: string
  }>
  limitations: string[]
  allowedActions: string[]
  prohibitedActions: string[]
  formalTradingUnlocked: false
  autoTradeUnlocked: false
  canCreateOrder: false
  orderCreateAllowed: false
  notTradingAdvice: true
}

export function classifyMarketDataReliability(input: {
  freshnessStatus: MarketDataFreshnessStatus
  providers: ProviderReliabilitySnapshotItem[]
}): MarketDataReliabilityClassification {
  const reasons: string[] = []
  const quoteProviders = input.providers.filter((provider) => provider.capabilities.includes('quote'))
  const attempted = quoteProviders.filter((provider) => provider.attempted)

  if (input.freshnessStatus === 'unknown' || input.freshnessStatus === 'stale') {
    return {
      status: 'blocked',
      reasons: [`canonical_freshness_${input.freshnessStatus}`],
    }
  }

  if (input.freshnessStatus === 'delayed') reasons.push('canonical_freshness_delayed')
  if (attempted.length === 0) reasons.push('provider_runtime_not_observed')
  if (attempted.some((provider) => provider.fallbackHits > 0)) reasons.push('provider_fallback_observed')
  if (attempted.some((provider) => provider.circuitOpen)) reasons.push('provider_circuit_open')
  if (attempted.some((provider) => provider.status === 'failing')) reasons.push('provider_failure_observed')
  if (attempted.some((provider) => provider.status === 'degraded')) reasons.push('provider_degraded')

  return {
    status: reasons.length > 0 ? 'degraded' : 'healthy',
    reasons: Array.from(new Set(reasons)),
  }
}

export class MarketDataReliabilityService {
  async buildReport(options: MarketDataFreshnessOptions = {}): Promise<MarketDataReliabilityReport> {
    const freshness = await marketDataFreshnessService.buildReport(options)
    const providerRuntime = marketDataService.getProviderReliabilitySnapshot()
    const classification = classifyMarketDataReliability({
      freshnessStatus: freshness.status,
      providers: providerRuntime,
    })
    const recoveryCodes = new Set<MarketDataReliabilityReport['recoveryActions'][number]['code']>()
    if (classification.reasons.some((reason) => reason.startsWith('provider_'))) {
      recoveryCodes.add('inspect_provider_health')
      recoveryCodes.add('retry_live_quote')
    }
    if (freshness.recommendedAction === 'refresh_market_bar_cache') recoveryCodes.add('refresh_market_bar_cache')
    if (freshness.recommendedAction === 'run_market_bar_preheat_then_rescan') recoveryCodes.add('run_market_bar_preheat_then_rescan')

    const labels: Record<MarketDataReliabilityReport['recoveryActions'][number]['code'], string> = {
      retry_live_quote: '稍后重新获取实时行情，并保留本地最近可信价作为明确标注的降级参考。',
      refresh_market_bar_cache: '刷新当前持仓的 canonical 日线缓存后重新检查。',
      run_market_bar_preheat_then_rescan: '先预热缺失的 canonical 日线，再重新运行策略扫描。',
      inspect_provider_health: '检查 provider 运行状态、fallback 和熔断状态。',
    }
    const blockers = classification.status === 'blocked'
      ? Array.from(new Set([...freshness.blockers, ...classification.reasons]))
      : []
    const warnings = Array.from(new Set([
      ...freshness.warnings,
      ...classification.reasons.map((reason) => `reliability:${reason}`),
      '免费行情和本地 canonical 缓存仅用于研究，不构成交易所级实时行情保证。',
    ]))

    return {
      schemaVersion: 'fams.market_data.reliability.v1',
      generatedAt: new Date().toISOString(),
      userId: options.userId || 'default',
      scope: freshness.scope,
      mode: 'free_source_research',
      realtimeGuarantee: false,
      status: classification.status,
      reasons: classification.reasons,
      providerRuntime,
      freshness,
      blockers,
      warnings,
      recoveryActions: Array.from(recoveryCodes).map((code) => ({ code, label: labels[code] })),
      limitations: [
        '不提供逐笔、盘口或交易所级实时性保证。',
        'fallback 和本地最近可信价不得计入实时成功。',
        '公开免费数据源的本机研究用途不等于生产商业授权。',
      ],
      allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
      notTradingAdvice: true,
    }
  }

  async writeAudit(report: MarketDataReliabilityReport, options: { dir?: string } = {}) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dir = options.dir || resolve(process.cwd(), 'data', 'gpt-audit', 'market-data-reliability', timestamp)
    await mkdir(dir, { recursive: true })
    const path = resolve(dir, 'market_data_reliability_audit.json')
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    return { dir, path }
  }
}

export const marketDataReliabilityService = new MarketDataReliabilityService()
