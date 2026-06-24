import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { alternativeAssetFactsetService } from '../src/services/valuation/alternativeAssetFactsetService.js'
import { valueAssessmentService } from '../src/services/valuation/valueAssessmentService.js'
import { analysisService } from '../src/services/analysis/analysisService.js'

async function main() {
  const positions = await prisma.position.findMany({
    where: {
      userId: 'default',
      status: 'open',
      asset: { type: { in: ['fund', 'bond', 'bond_fund', 'etf'] } },
    },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
    take: 20,
  })
  assert.ok(positions.length > 0, '需要至少一个真实基金/债基/ETF持仓进行 holdings factset 验收')

  const results = []
  for (const position of positions) {
    const factSet = await alternativeAssetFactsetService.buildFundLikeFactSet(position)
    results.push({ position, factSet })
  }

  const available = results.find((item) => item.factSet.holdings.status === 'available')
  assert.ok(available, '至少一个真实基金/债基/ETF持仓必须返回真实 holdings factset')
  assert.ok(available.factSet.holdings.reportDate, 'holdings available must expose reportDate')
  assert.ok(available.factSet.holdings.topHoldings.length > 0, 'holdings available must expose topHoldings')
  assert.ok(typeof available.factSet.holdings.top10ConcentrationPct === 'number', 'holdings available must expose top10ConcentrationPct')
  assert.notEqual(available.factSet.holdings.holdingsStyle, 'unknown', 'holdings available must derive holdingsStyle')
  assert.ok(!available.factSet.blockedReasons.includes('fund_holdings_factset_missing'), 'available holdings must remove fund_holdings_factset_missing')
  assert.ok(
    available.factSet.blockedReasons.includes('fund_profile_factset_missing')
      || available.factSet.blockedReasons.includes('fund_fee_factset_missing')
      || available.factSet.blockedReasons.includes('fund_risk_level_missing')
      || available.factSet.blockedReasons.includes('bond_duration_credit_proxy_missing'),
    'available holdings must still expose remaining actionable fund gaps'
  )
  assert.ok(available.factSet.evidenceRefs.some((ref) => ref.startsWith('fund-holdings:')), 'holdings evidenceRef must be exposed')
  assert.ok(available.factSet.sourceRefs.some((ref) => ref.includes('FundArchivesDatas.aspx')), 'holdings sourceRef must be exposed')

  const unavailable = results.filter((item) => item.factSet.holdings.status !== 'available')
  for (const item of unavailable) {
    assert.ok(item.factSet.blockedReasons.includes('fund_holdings_factset_missing'), `${item.position.asset.symbol} must keep holdings blocker when holdings unavailable`)
  }

  const [assessment, fivdR] = await Promise.all([
    valueAssessmentService.assessPosition(available.position),
    analysisService.getFivdRAnalysis('default', { positionId: available.position.id, scope: 'position' }) as any,
  ])

  assert.ok(assessment.providerTrace?.fundLikeFactSet, 'value assessment must attach fundLikeFactSet providerTrace')
  assert.equal((assessment.providerTrace?.fundLikeFactSet as any).holdings.status, 'available')
  assert.ok(!assessment.valuation.blockedReasons.includes('fund_holdings_factset_missing'))
  assert.ok(
    assessment.valuation.blockedReasons.includes('fund_profile_factset_missing')
      || assessment.valuation.blockedReasons.includes('fund_fee_factset_missing')
      || assessment.valuation.blockedReasons.includes('fund_risk_level_missing')
      || assessment.valuation.blockedReasons.includes('bond_duration_credit_proxy_missing')
  )
  assert.equal(fivdR.formalTradeActionAllowed, false)
  assert.equal(fivdR.autoTradeAllowed, false)
  assert.equal(fivdR.capabilityState, 'TRADE_BLOCKED')

  console.log(JSON.stringify({
    ok: true,
    checkedPositions: results.length,
    availableHoldingsCount: results.filter((item) => item.factSet.holdings.status === 'available').length,
    unavailableHoldingsCount: unavailable.length,
    sample: {
      symbol: available.position.asset.symbol,
      name: available.position.asset.name,
      assetType: available.position.asset.type,
      factsetStatus: available.factSet.status,
      navSampleSize: available.factSet.navHistory.sampleSize,
      holdings: available.factSet.holdings,
      blockedReasons: available.factSet.blockedReasons,
      missingFields: available.factSet.missingFields,
      valuationBlockedReasons: assessment.valuation.blockedReasons,
      formalTradeActionAllowed: fivdR.formalTradeActionAllowed,
      autoTradeAllowed: fivdR.autoTradeAllowed,
      capabilityState: fivdR.capabilityState,
    },
    unavailableSamples: unavailable.slice(0, 5).map((item) => ({
      symbol: item.position.asset.symbol,
      name: item.position.asset.name,
      status: item.factSet.holdings.status,
      lastError: item.factSet.holdings.lastError,
      blockedReasons: item.factSet.blockedReasons,
    })),
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
