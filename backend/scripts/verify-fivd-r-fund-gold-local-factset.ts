import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { valueAssessmentService } from '../src/services/valuation/valueAssessmentService.js'
import { alternativeAssetFactsetService } from '../src/services/valuation/alternativeAssetFactsetService.js'
import { analysisService } from '../src/services/analysis/analysisService.js'

async function main() {
  const positions = await prisma.position.findMany({
    where: {
      userId: 'default',
      status: 'open',
      asset: { type: { in: ['fund', 'bond', 'bond_fund', 'gold', 'etf'] } },
    },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })
  const fundPosition = positions.find((position) => ['fund', 'bond', 'bond_fund', 'etf'].includes(position.asset.type))
  const goldPosition = positions.find((position) => position.asset.type === 'gold')
  assert.ok(fundPosition, '需要至少一个真实基金/债基/ETF持仓进行验收')
  assert.ok(goldPosition, '需要至少一个真实黄金持仓进行验收')

  const [fundFactSet, goldFactSet, fundAssessment, goldAssessment, fundFivdR, goldFivdR] = await Promise.all([
    alternativeAssetFactsetService.buildFundLikeFactSet(fundPosition),
    alternativeAssetFactsetService.buildGoldMacroFactSet(goldPosition),
    valueAssessmentService.assessPosition(fundPosition),
    valueAssessmentService.assessPosition(goldPosition),
    analysisService.getFivdRAnalysis('default', { positionId: fundPosition.id, scope: 'position' }) as any,
    analysisService.getFivdRAnalysis('default', { positionId: goldPosition.id, scope: 'position' }) as any,
  ])

  assert.equal(fundFactSet.schemaVersion, 'fivd.r.fund_like_factset.v1')
  assert.equal(goldFactSet.schemaVersion, 'fivd.r.gold_macro_factset.v1')
  assert.ok(['available', 'partial', 'insufficient'].includes(fundFactSet.status))
  assert.ok(['available', 'partial', 'insufficient'].includes(goldFactSet.status))
  assert.ok(fundFactSet.evidenceRefs.length > 0, 'fund factset must expose evidenceRefs')
  assert.ok(goldFactSet.evidenceRefs.length > 0, 'gold factset must expose evidenceRefs')
  assert.ok(fundFactSet.windows.every((window) => typeof window.sampleSize === 'number'), 'fund windows must expose sampleSize')
  assert.ok(goldFactSet.windows.every((window) => typeof window.sampleSize === 'number'), 'gold windows must expose sampleSize')

  assert.notEqual(fundAssessment.valuation.method, 'fund_etf_nav_index_tracking_placeholder_v1')
  assert.notEqual(goldAssessment.valuation.method, 'gold_macro_real_rate_risk_hedge_placeholder_v1')
  assert.ok(!fundAssessment.valuation.method.includes('stock_relative'), 'fund assessment must not use stock valuation model')
  assert.ok(!goldAssessment.valuation.method.includes('stock_relative'), 'gold assessment must not use stock valuation model')
  assert.ok(fundAssessment.providerTrace?.fundLikeFactSet, 'fund assessment must attach fundLikeFactSet providerTrace')
  assert.ok(goldAssessment.providerTrace?.goldMacroFactSet, 'gold assessment must attach goldMacroFactSet providerTrace')

  assert.notEqual(fundFactSet.status, 'available', 'fund factset must remain partial/insufficient until all fund-specific gaps are closed')
  assert.ok(
    fundAssessment.valuation.blockedReasons.includes('fund_risk_level_missing')
      || fundAssessment.valuation.blockedReasons.includes('bond_duration_credit_proxy_missing')
      || fundAssessment.valuation.blockedReasons.includes('fund_like_value_factset_missing'),
    'fund factset must keep real remaining data gaps instead of being promoted to complete'
  )
  assert.equal(goldFactSet.status, 'partial', 'gold factset must remain research-only partial')
  assert.equal(goldAssessment.valuation.conclusion, 'insufficient', 'gold assessment must not become a trade-grade value conclusion')
  assert.equal(goldFactSet.sourceSelection.selectedFamily, 'physical_gold_price_proxy', 'gold should select physical gold price proxy for gram-level position price')
  assert.ok(goldFactSet.sourceSelection.selectedSources.includes('price_history:goldFund'), 'gold should select goldFund physical price proxy')
  assert.ok(goldFactSet.sourceSelection.excludedSources.some((source) => source.source === 'market_bar_canonical:sina'), 'gold ETF/fund trade price scale should be excluded')
  if (goldFactSet.priceScaleCheck.status === 'failed') {
    assert.equal(goldFactSet.status, 'insufficient', 'gold scale inconsistency must downgrade factset to insufficient')
    assert.ok(goldFactSet.blockedReasons.includes('gold_price_scale_inconsistent'))
    assert.ok(goldAssessment.valuation.blockedReasons.includes('gold_price_scale_inconsistent'))
    assert.ok(goldFactSet.windows.every((window) => window.rollingReturnPct === null && window.status === 'insufficient'))
    assert.ok(goldFactSet.priceScaleCheck.abnormalMoves.length > 0)
  } else {
    assert.ok(goldFactSet.windows.every((window) => window.rollingReturnPct === null || Math.abs(window.rollingReturnPct) <= 80), 'gold accepted windows must stay in a plausible research range')
  }

  assert.equal(fundFivdR.tradingDiscipline?.formalTradeActionAllowed, false)
  assert.equal(goldFivdR.tradingDiscipline?.formalTradeActionAllowed, false)
  assert.equal(fundFivdR.formalTradeActionAllowed, false)
  assert.equal(goldFivdR.formalTradeActionAllowed, false)
  assert.equal(fundFivdR.autoTradeAllowed, false)
  assert.equal(goldFivdR.autoTradeAllowed, false)
  assert.equal(fundFivdR.capabilityState, 'TRADE_BLOCKED')
  assert.equal(goldFivdR.capabilityState, 'TRADE_BLOCKED')

  console.log(JSON.stringify({
    ok: true,
    fund: {
      symbol: fundPosition.asset.symbol,
      name: fundPosition.asset.name,
      type: fundPosition.asset.type,
      factsetStatus: fundFactSet.status,
      sampleSize: fundFactSet.navHistory.sampleSize,
      latestDate: fundFactSet.navHistory.latestDate,
      method: fundAssessment.valuation.method,
      blockedReasons: fundAssessment.valuation.blockedReasons,
      windows: fundFactSet.windows.map((window) => ({
        windowDays: window.windowDays,
        sampleSize: window.sampleSize,
        status: window.status,
        rollingReturnPct: window.rollingReturnPct,
        maxDrawdownPct: window.maxDrawdownPct,
      })),
    },
    gold: {
      symbol: goldPosition.asset.symbol,
      name: goldPosition.asset.name,
      factsetStatus: goldFactSet.status,
      sampleSize: goldFactSet.goldPriceHistory.sampleSize,
      latestDate: goldFactSet.goldPriceHistory.latestDate,
      method: goldAssessment.valuation.method,
      blockedReasons: goldAssessment.valuation.blockedReasons,
      sourceSelection: goldFactSet.sourceSelection,
      priceScaleCheck: goldFactSet.priceScaleCheck,
      windows: goldFactSet.windows.map((window) => ({
        windowDays: window.windowDays,
        sampleSize: window.sampleSize,
        status: window.status,
        rollingReturnPct: window.rollingReturnPct,
        maxDrawdownPct: window.maxDrawdownPct,
      })),
    },
    tradeGate: {
      fundFormalTradeActionAllowed: fundFivdR.tradingDiscipline?.formalTradeActionAllowed,
      goldFormalTradeActionAllowed: goldFivdR.tradingDiscipline?.formalTradeActionAllowed,
      fundCapabilityState: fundFivdR.capabilityState,
      goldCapabilityState: goldFivdR.capabilityState,
      fundAutoTradeAllowed: fundFivdR.autoTradeAllowed,
      goldAutoTradeAllowed: goldFivdR.autoTradeAllowed,
    },
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
