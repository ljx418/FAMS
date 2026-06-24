import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { alternativeAssetHistoryBackfillService } from '../src/services/valuation/alternativeAssetHistoryBackfillService.js'
import { alternativeAssetFactsetService } from '../src/services/valuation/alternativeAssetFactsetService.js'
import { valueAssessmentService } from '../src/services/valuation/valueAssessmentService.js'
import { analysisService } from '../src/services/analysis/analysisService.js'

async function main() {
  const [fundPosition, goldPosition] = await Promise.all([
    prisma.position.findFirst({
      where: { userId: 'default', status: 'open', asset: { type: { in: ['fund', 'bond', 'bond_fund', 'etf'] } } },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    }),
    prisma.position.findFirst({
      where: { userId: 'default', status: 'open', asset: { type: 'gold' } },
      include: { asset: true },
      orderBy: { marketValue: 'desc' },
    }),
  ])
  assert.ok(fundPosition, '需要至少一个真实基金/债基/ETF持仓')
  assert.ok(goldPosition, '需要至少一个真实黄金持仓')

  const report = await alternativeAssetHistoryBackfillService.backfillUserOpenAlternativeAssets('default')
  assert.equal(report.schemaVersion, 'fivd.r.alternative_history_backfill_report.v1')
  assert.ok(report.summary.targetCount >= 2)

  const fundTarget = report.targets.find((target) => target.symbol === fundPosition.asset.symbol)
  const goldTarget = report.targets.find((target) => target.symbol === goldPosition.asset.symbol)
  assert.ok(fundTarget, `missing fund target ${fundPosition.asset.symbol}`)
  assert.ok(goldTarget, `missing gold target ${goldPosition.asset.symbol}`)
  assert.ok(fundTarget.fetchedRecords > 0, 'fund provider must return real records for this acceptance')
  assert.ok(goldTarget.fetchedRecords > 0, 'gold proxy provider must return real records for this acceptance')

  const [fundFactSet, goldFactSet, fundAssessment, goldAssessment, fundFivdR, goldFivdR] = await Promise.all([
    alternativeAssetFactsetService.buildFundLikeFactSet(fundPosition),
    alternativeAssetFactsetService.buildGoldMacroFactSet(goldPosition),
    valueAssessmentService.assessPosition(fundPosition),
    valueAssessmentService.assessPosition(goldPosition),
    analysisService.getFivdRAnalysis('default', { positionId: fundPosition.id, scope: 'position' }) as any,
    analysisService.getFivdRAnalysis('default', { positionId: goldPosition.id, scope: 'position' }) as any,
  ])

  assert.ok(fundFactSet.navHistory.sampleSize >= 20, `fund sampleSize should be >=20 after backfill, got ${fundFactSet.navHistory.sampleSize}`)
  assert.ok(goldFactSet.goldPriceHistory.sampleSize >= 20, `gold sampleSize should be >=20 after backfill, got ${goldFactSet.goldPriceHistory.sampleSize}`)
  assert.ok(fundFactSet.windows.find((window) => window.windowDays === 20)?.rollingReturnPct !== null)
  assert.equal(goldFactSet.sourceSelection.selectedFamily, 'physical_gold_price_proxy')
  assert.ok(goldFactSet.sourceSelection.selectedSources.includes('price_history:goldFund'))
  assert.equal(goldFactSet.priceScaleCheck.status, 'passed')
  assert.ok(goldFactSet.windows.every((window) => window.rollingReturnPct === null || Math.abs(window.rollingReturnPct) < 80), 'gold windows must not contain implausible 5000% returns')
  assert.ok(!fundAssessment.valuation.method.includes('stock_relative'))
  assert.ok(!goldAssessment.valuation.method.includes('stock_relative'))
  assert.equal(fundFivdR.formalTradeActionAllowed, false)
  assert.equal(goldFivdR.formalTradeActionAllowed, false)
  assert.equal(fundFivdR.autoTradeAllowed, false)
  assert.equal(goldFivdR.autoTradeAllowed, false)

  console.log(JSON.stringify({
    ok: true,
    report,
    fund: {
      symbol: fundPosition.asset.symbol,
      sampleSize: fundFactSet.navHistory.sampleSize,
      status: fundFactSet.status,
      blockedReasons: fundAssessment.valuation.blockedReasons,
      window20: fundFactSet.windows.find((window) => window.windowDays === 20),
    },
    gold: {
      symbol: goldPosition.asset.symbol,
      sampleSize: goldFactSet.goldPriceHistory.sampleSize,
      status: goldFactSet.status,
      blockedReasons: goldAssessment.valuation.blockedReasons,
      sourceSelection: goldFactSet.sourceSelection,
      priceScaleCheck: goldFactSet.priceScaleCheck,
      window20: goldFactSet.windows.find((window) => window.windowDays === 20),
    },
    tradeGate: {
      fundFormalTradeActionAllowed: fundFivdR.formalTradeActionAllowed,
      goldFormalTradeActionAllowed: goldFivdR.formalTradeActionAllowed,
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
