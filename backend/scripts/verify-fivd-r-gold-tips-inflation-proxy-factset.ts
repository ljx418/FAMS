import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { alternativeAssetFactsetService } from '../src/services/valuation/alternativeAssetFactsetService.js'
import { valueAssessmentService } from '../src/services/valuation/valueAssessmentService.js'
import { analysisService } from '../src/services/analysis/analysisService.js'

async function main() {
  const position = await prisma.position.findFirst({
    where: { userId: 'default', status: 'open', asset: { type: 'gold' } },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })
  assert.ok(position, '需要至少一个真实黄金持仓进行 TIPS/inflation proxy 验收')

  const [factSet, assessment, fivdR] = await Promise.all([
    alternativeAssetFactsetService.buildGoldMacroFactSet(position),
    valueAssessmentService.assessPosition(position),
    analysisService.getFivdRAnalysis('default', { positionId: position.id, scope: 'position' }) as any,
  ])

  const realRateProxy = factSet.macroProxies.realRateProxy
  const inflationExpectationProxy = factSet.macroProxies.inflationExpectationProxy

  assert.equal(realRateProxy.status, 'available')
  assert.equal(realRateProxy.provider, 'nasdaq_historical')
  assert.equal(realRateProxy.method, 'tips_etf_price_pressure_proxy_v1')
  assert.equal(realRateProxy.symbol, 'TIP')
  assert.ok(realRateProxy.sampleSize >= 20)
  assert.ok(realRateProxy.latestDate)
  assert.equal(typeof realRateProxy.latestValue, 'number')
  assert.equal(typeof realRateProxy.return20dPct, 'number')
  assert.ok(['real_rate_pressure_up', 'real_rate_pressure_down', 'flat', 'unknown'].includes(realRateProxy.pressure))

  assert.equal(inflationExpectationProxy.status, 'available')
  assert.equal(inflationExpectationProxy.provider, 'nasdaq_historical')
  assert.equal(inflationExpectationProxy.method, 'tips_vs_treasury_etf_relative_proxy_v1')
  assert.deepEqual(inflationExpectationProxy.symbols, ['TIP', 'IEF'])
  assert.ok(inflationExpectationProxy.sampleSize >= 20)
  assert.ok(inflationExpectationProxy.latestDate)
  assert.equal(typeof inflationExpectationProxy.relativeReturn20dPct, 'number')
  assert.equal(typeof inflationExpectationProxy.relativeReturn60dPct, 'number')
  assert.ok(['inflation_expectation_up', 'inflation_expectation_down', 'flat', 'unknown'].includes(inflationExpectationProxy.signal))

  assert.ok(!factSet.missingFields.includes('realRateProxy'))
  assert.ok(!factSet.missingFields.includes('inflationExpectationProxy'))
  assert.ok(!factSet.blockedReasons.includes('gold_real_rate_proxy_missing'))
  assert.ok(!factSet.blockedReasons.includes('gold_inflation_expectation_proxy_missing'))
  assert.equal(factSet.status, 'partial', 'gold factset must remain research-only partial')
  assert.equal(factSet.priceScaleCheck.status, 'passed')
  assert.ok(factSet.evidenceRefs.some((ref) => ref.startsWith('gold-real-rate-proxy:')))
  assert.ok(factSet.evidenceRefs.some((ref) => ref.startsWith('gold-inflation-expectation-proxy:')))
  assert.ok(factSet.sourceRefs.some((ref) => ref.includes('/TIP/historical')))
  assert.ok(factSet.sourceRefs.some((ref) => ref.includes('/IEF/historical')))

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
    realRateProxy,
    inflationExpectationProxy,
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
