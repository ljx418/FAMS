import 'dotenv/config'
import { stockScreenerService } from '../src/services/screener/stockScreenerService.js'
import { securityStatusService } from '../src/services/market-data/securityStatusService.js'
import { prisma } from '../src/db/prisma.js'

type ReadinessGate = {
  id: string
  status: 'passed' | 'failed' | 'warning'
  message: string
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function numberOrZero(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function stringOrNull(value: unknown) {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function parseSymbols() {
  const arg = process.argv.find((item) => item.startsWith('--symbols='))
  const raw = arg ? arg.slice('--symbols='.length) : process.env.FAMS_READINESS_SYMBOLS || '000001,600000'
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter((item) => /^\d{6}$/.test(item))
}

async function buildTradeActionReadiness() {
  const operations = await prisma.operation.findMany({
    where: {
      type: { in: ['strategy_tournament_run', 'stock_screener_full_scan'] },
      status: { in: ['completed', 'succeeded', 'partial'] },
    },
    orderBy: [
      { completedAt: 'desc' },
      { requestedAt: 'desc' },
    ],
    take: 20,
  })

  const candidates = operations
    .map((operation) => {
      const result = parseJson<Record<string, any>>(operation.resultJson, {})
      const acceptance = result.longSampleAcceptance && typeof result.longSampleAcceptance === 'object'
        ? result.longSampleAcceptance as Record<string, any>
        : null
      if (!acceptance) return null
      const validationDecision = result.validationDecision && typeof result.validationDecision === 'object'
        ? result.validationDecision as Record<string, any>
        : null
      const summary = acceptance.summary && typeof acceptance.summary === 'object'
        ? acceptance.summary as Record<string, any>
        : {}
      const gates = Array.isArray(acceptance.gates) ? acceptance.gates as Array<Record<string, any>> : []
      const blockerFailures = gates.filter((gate) => gate.severity === 'blocker' && gate.status !== 'passed')
      const scanCoveragePercent = numberOrZero(summary.scanCoveragePercent)
      const backtestDays = numberOrZero(summary.backtestDays)
      const bestSampleSize = numberOrZero(summary.bestSampleSize)
      const providerSuccessRate = numberOrZero(summary.providerSuccessRate)
      const cacheHitRate = numberOrZero(summary.cacheHitRate)
      const bestCredibility = stringOrNull(summary.bestCredibility) || 'unknown'
      const factsetGate = gates.find((gate) => gate.id === 'factset_coverage')
      const validationGate = gates.find((gate) => gate.id === 'validation_evidence')
      const generatedAt = operation.completedAt?.toISOString() || operation.requestedAt.toISOString()
      const score = (
        (scanCoveragePercent >= 99 ? 300 : scanCoveragePercent >= 80 ? 180 : 0)
        + (backtestDays >= 60 ? 160 : 0)
        + (bestSampleSize >= 300 ? 120 : bestSampleSize >= 100 ? 80 : 0)
        + (bestCredibility === 'high' ? 120 : bestCredibility === 'medium' ? 70 : 0)
        + (providerSuccessRate >= 95 ? 80 : 0)
        + (cacheHitRate >= 80 ? 40 : 0)
        + (validationDecision?.usableForTradingAdvice === true ? 500 : 0)
        - blockerFailures.length * 40
      )
      return {
        operation,
        result,
        acceptance,
        validationDecision,
        summary,
        gates,
        blockerFailures,
        scanCoveragePercent,
        backtestDays,
        bestSampleSize,
        providerSuccessRate,
        cacheHitRate,
        bestCredibility,
        factsetGate,
        validationGate,
        generatedAt,
        score,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => b.score - a.score)

  const best = candidates[0]
  if (!best) {
    return {
      schemaVersion: 'fams.trade_action_readiness.v1',
      generatedAt: new Date().toISOString(),
      status: 'no_evidence',
      readyForManualTradeDraft: false,
      latestEvidence: null,
      gates: [{
        id: 'strategy_evidence',
        status: 'failed',
        message: '尚无可审计的 strategy_tournament_run 长样本证据。',
      }] satisfies ReadinessGate[],
      blockerGateIds: ['strategy_evidence'],
      nextActions: ['运行 strategy_tournament_run 生成全 A 60 日以上长样本证据。'],
    }
  }

  const fullAReady = best.scanCoveragePercent >= 80
    && best.backtestDays >= 60
    && best.providerSuccessRate >= 95
    && best.cacheHitRate >= 80
    && best.bestSampleSize >= 100
    && ['high', 'medium'].includes(best.bestCredibility)
  const validationReady = best.validationDecision?.usableForTradingAdvice === true
    || (best.validationGate?.status === 'passed' && best.blockerFailures.length === 0)
  const factsetReady = !best.factsetGate || best.factsetGate.status === 'passed'

  const gates: ReadinessGate[] = [
    {
      id: 'full_a_strategy_evidence',
      status: fullAReady ? 'passed' : 'failed',
      message: fullAReady
        ? `全 A 证据达标：coverage=${best.scanCoveragePercent}%，窗口=${best.backtestDays}日，样本=${best.bestSampleSize}，可信度=${best.bestCredibility}。`
        : `全 A 证据未达标：coverage=${best.scanCoveragePercent}%，窗口=${best.backtestDays}日，样本=${best.bestSampleSize}，可信度=${best.bestCredibility}，provider=${best.providerSuccessRate}%，cache=${best.cacheHitRate}%。`,
    },
    {
      id: 'validation_evidence',
      status: validationReady ? 'passed' : 'failed',
      message: validationReady
        ? '样本外、walk-forward、参数敏感性和分组稳定性已支持进入人工交易计划复核。'
        : best.validationGate?.message || best.validationDecision?.reasons?.join('；') || 'validation evidence 未通过。',
    },
    {
      id: 'factset_coverage',
      status: factsetReady ? 'passed' : 'warning',
      message: factsetReady
        ? '事实集覆盖可支撑分组审计。'
        : best.factsetGate?.message || '事实集覆盖不足，交易动作降级。',
    },
    {
      id: 'manual_execution_review',
      status: 'warning',
      message: '即使交易动作 gate 通过，也只允许进入人工确认交易计划草案；自动交易不开放。',
    },
  ]
  const blockingGates = gates.filter((gate) => gate.status === 'failed')
  const readyForManualTradeDraft = blockingGates.length === 0

  return {
    schemaVersion: 'fams.trade_action_readiness.v1',
    generatedAt: new Date().toISOString(),
    status: readyForManualTradeDraft ? 'ready_for_manual_trade_draft' : 'blocked',
    readyForManualTradeDraft,
    latestEvidence: {
      operationId: best.operation.id,
      status: best.operation.status,
      generatedAt: best.generatedAt,
      acceptanceStatus: stringOrNull(best.acceptance.status) || 'unknown',
      validationDecision: stringOrNull(best.validationDecision?.decision) || (validationReady ? 'TRADING_RESEARCH_ALLOWED' : 'OBSERVE_ONLY'),
      scanCoveragePercent: best.scanCoveragePercent,
      providerSuccessRate: best.providerSuccessRate,
      cacheHitRate: best.cacheHitRate,
      backtestDays: best.backtestDays,
      bestSampleSize: best.bestSampleSize,
      bestCredibility: best.bestCredibility,
      blockerGateIds: best.blockerFailures.map((gate) => stringOrNull(gate.id) || 'unknown'),
    },
    gates,
    blockerGateIds: blockingGates.map((gate) => gate.id),
    nextActions: readyForManualTradeDraft
      ? ['进入人工确认交易计划草案；执行前复核停复牌、涨跌停和持仓约束。']
      : [
        ...(fullAReady ? [] : ['补齐或重跑全 A 60 日以上 strategy_tournament_run，确保覆盖率、样本量、provider 和 cache gate 通过。']),
        ...(validationReady ? [] : ['继续处理 validation_evidence：至少一个候选组合需要同时通过样本外、walk-forward、参数敏感性和分组稳定性验证。']),
        ...(factsetReady ? [] : ['补齐行业/市值/事实集覆盖，避免分组稳定性降级。']),
      ],
  }
}

async function main() {
  const strict = process.argv.includes('--strict') || process.env.FAMS_READINESS_STRICT === '1'
  const strictTrade = process.argv.includes('--strict-trade') || process.env.FAMS_TRADE_READINESS_STRICT === '1'
  const symbols = parseSymbols()
  const tushareConfigured = Boolean(process.env.FAMS_TUSHARE_TOKEN || process.env.TUSHARE_TOKEN)
  const postgresShadowReadiness = await (stockScreenerService as any).buildPostgresShadowReadinessReport()
  const securityStatusCoverage = tushareConfigured
    ? await securityStatusService.upsertTushareTradingStatus(symbols)
    : await securityStatusService.getCoverageSnapshot(symbols)
  const tradeActionReadiness = await buildTradeActionReadiness()
  const hasFreeSourceSecurityCoverage = securityStatusCoverage.symbolsWithStatus > 0
    && securityStatusCoverage.symbolsWithTradeability > 0
    && securityStatusCoverage.officialProviderRows > 0

  const gates = [
    {
      id: 'postgres_shadow_ready',
      status: postgresShadowReadiness.status === 'ready' ? 'passed' : 'failed',
      message: postgresShadowReadiness.status === 'ready'
        ? 'PostgreSQL shadow schema/staging/smoke 验证通过。'
        : '未通过 PostgreSQL shadow 真实连接和 staging 烟测。',
    },
    {
      id: 'free_source_security_coverage',
      status: hasFreeSourceSecurityCoverage ? 'passed' : 'failed',
      message: hasFreeSourceSecurityCoverage
        ? `免费源证券状态覆盖可用于分析建议：status=${securityStatusCoverage.symbolsWithStatus}, tradeability=${securityStatusCoverage.symbolsWithTradeability}。`
        : '免费源证券状态覆盖不足，不能输出可靠分析建议。',
    },
    {
      id: 'tushare_formal_trading_state_optional',
      status: securityStatusCoverage.formalTradingStateRows > 0 ? 'passed' : 'warning',
      message: securityStatusCoverage.formalTradingStateRows > 0
        ? `已有 ${securityStatusCoverage.formalTradingStateRows} 行 Tushare/交易所正式交易状态事实。`
        : '未配置 Tushare/交易所正式交易状态源；这是可选增强项，不阻断免费源分析建议。',
    },
    {
      id: 'formal_limit_price_optional',
      status: securityStatusCoverage.formalTradingStateRows > 0 && securityStatusCoverage.fieldCoverage.limitPricePercent > 0 ? 'passed' : 'warning',
      message: securityStatusCoverage.formalTradingStateRows > 0 && securityStatusCoverage.fieldCoverage.limitPricePercent > 0
        ? `正式源涨跌停价覆盖率 ${securityStatusCoverage.fieldCoverage.limitPricePercent}%。`
        : '未检测到正式源涨跌停价覆盖；免费源分析可用，交易执行前需人工复核涨跌停/停牌状态。',
    },
  ]
  const analysisAdviceReady = gates
    .filter((gate) => !gate.id.endsWith('_optional'))
    .every((gate) => gate.status === 'passed')
  const tradeActionReady = analysisAdviceReady && tradeActionReadiness.readyForManualTradeDraft
  const productionReady = analysisAdviceReady
  const report = {
    schemaVersion: 'fams.production_readiness_check.v1',
    generatedAt: new Date().toISOString(),
    analysisAdviceReady,
    tradeActionReady,
    productionReady,
    strict,
    strictTrade,
    symbols,
    environment: {
      postgresShadowConfigured: postgresShadowReadiness.database.shadowConfigured,
      postgresShadowStatus: postgresShadowReadiness.status,
      postgresClientTool: postgresShadowReadiness.verification.clientTool,
      tushareConfigured,
    },
    gates,
    postgresShadowReadiness,
    securityStatusCoverage,
    tradeActionReadiness,
    nextActions: [
      ...(postgresShadowReadiness.status === 'ready' ? [] : ['配置并确认 FAMS_POSTGRES_SHADOW_DATABASE_URL 可连接真实 PostgreSQL。']),
      ...(hasFreeSourceSecurityCoverage ? [] : ['先生成/刷新免费源证券状态事实层，确保 status/tradeability 有覆盖。']),
      ...(securityStatusCoverage.formalTradingStateRows > 0 ? [] : ['可选：配置 FAMS_TUSHARE_TOKEN / TUSHARE_TOKEN 作为正式交易状态增强源。']),
      ...(tradeActionReady
        ? ['交易动作已可进入人工确认交易计划草案；自动交易仍禁止。']
        : tradeActionReadiness.nextActions),
    ],
  }
  console.log(JSON.stringify(report, null, 2))
  if (strict && !productionReady) process.exitCode = 1
  if (strictTrade && !tradeActionReady) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
