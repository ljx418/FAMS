import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { alternativeAssetFactsetService } from '../src/services/valuation/alternativeAssetFactsetService.js'
import { valueAssessmentService } from '../src/services/valuation/valueAssessmentService.js'
import { analysisService } from '../src/services/analysis/analysisService.js'

async function main() {
  const position = await prisma.position.findFirst({
    where: {
      userId: 'default',
      status: 'open',
      asset: { type: 'gold' },
    },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })
  assert.ok(position, '需要至少一个真实黄金持仓进行 USD trend proxy 验收')

  const [factSet, assessment, fivdR] = await Promise.all([
    alternativeAssetFactsetService.buildGoldMacroFactSet(position),
    valueAssessmentService.assessPosition(position),
    analysisService.getFivdRAnalysis('default', { positionId: position.id, scope: 'position' }) as any,
  ])

  assert.equal(factSet.macroProxies.usdTrendProxy.status, 'available')
  assert.equal(factSet.macroProxies.usdTrendProxy.provider, 'yahoo_chart')
  assert.equal(factSet.macroProxies.usdTrendProxy.symbol, 'DX-Y.NYB')
  assert.ok(factSet.macroProxies.usdTrendProxy.sampleSize >= 20, 'DXY history must have at least 20 samples')
  assert.ok(factSet.macroProxies.usdTrendProxy.latestDate, 'DXY proxy must expose latestDate')
  assert.equal(typeof factSet.macroProxies.usdTrendProxy.latestValue, 'number')
  assert.equal(typeof factSet.macroProxies.usdTrendProxy.return20dPct, 'number')
  assert.ok(['usd_strengthening', 'usd_weakening', 'flat', 'unknown'].includes(factSet.macroProxies.usdTrendProxy.trend))
  assert.ok(!factSet.missingFields.includes('usdTrend'), 'usdTrend missing field must be removed when DXY proxy is available')
  assert.ok(!factSet.blockedReasons.includes('gold_usd_trend_proxy_missing'), 'available DXY proxy must remove USD trend blocker')
  assert.equal(factSet.macroProxies.realRateProxy.status, 'available')
  assert.equal(factSet.macroProxies.inflationExpectationProxy.status, 'available')
  assert.equal(factSet.priceScaleCheck.status, 'passed')
  assert.ok(factSet.evidenceRefs.some((ref) => ref.startsWith('gold-usd-trend-proxy:')), 'DXY evidenceRef must be exposed')
  assert.ok(factSet.sourceRefs.some((ref) => ref.includes('DX-Y.NYB')), 'DXY sourceRef must be exposed')

  assert.equal(assessment.valuation.method, 'gold_local_price_macro_proxy_factset_v1')
  assert.ok(!assessment.valuation.blockedReasons.includes('gold_usd_trend_proxy_missing'))
  assert.ok(!assessment.valuation.blockedReasons.includes('gold_real_rate_proxy_missing'))
  assert.ok(!assessment.valuation.blockedReasons.includes('gold_inflation_expectation_proxy_missing'))
  assert.equal(fivdR.formalTradeActionAllowed, false)
  assert.equal(fivdR.autoTradeAllowed, false)
  assert.equal(fivdR.capabilityState, 'TRADE_BLOCKED')

  console.log(JSON.stringify({
    ok: true,
    symbol: position.asset.symbol,
    name: position.asset.name,
    factsetStatus: factSet.status,
    sourceSelection: factSet.sourceSelection,
    priceScaleCheck: factSet.priceScaleCheck,
    usdTrendProxy: factSet.macroProxies.usdTrendProxy,
    blockedReasons: factSet.blockedReasons,
    missingFields: factSet.missingFields,
    valuationBlockedReasons: assessment.valuation.blockedReasons,
    formalTradeActionAllowed: fivdR.formalTradeActionAllowed,
    autoTradeAllowed: fivdR.autoTradeAllowed,
    capabilityState: fivdR.capabilityState,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
