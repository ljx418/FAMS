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
      asset: { type: { in: ['bond', 'bond_fund'] } },
    },
    include: { asset: true },
    orderBy: { marketValue: 'desc' },
  })
  assert.ok(position, '需要至少一个真实债基持仓进行 bond risk proxy 验收')

  const [factSet, assessment, fivdR] = await Promise.all([
    alternativeAssetFactsetService.buildFundLikeFactSet(position),
    valueAssessmentService.assessPosition(position),
    analysisService.getFivdRAnalysis('default', { positionId: position.id, scope: 'position' }) as any,
  ])

  assert.equal(factSet.bondRiskProxy.status, 'available')
  assert.equal(factSet.bondRiskProxy.method, 'top_bond_holding_name_heuristic_v1')
  assert.ok(factSet.bondRiskProxy.latestAllocation.reportDate, 'bond proxy must expose allocation reportDate')
  assert.equal(typeof factSet.bondRiskProxy.latestAllocation.bondPct, 'number', 'bond proxy must expose bondPct')
  assert.ok(factSet.bondRiskProxy.topBondHoldings.length >= 5, 'bond proxy must expose at least 5 top bond holdings')
  assert.equal(typeof factSet.bondRiskProxy.topBondConcentrationPct, 'number', 'bond proxy must expose concentration')
  assert.ok(factSet.bondRiskProxy.creditRiskFlags.length > 0, 'bond proxy must expose credit risk flags')
  assert.ok(!factSet.blockedReasons.includes('bond_credit_risk_proxy_missing'), 'available bond credit proxy must remove credit blocker')
  assert.ok(factSet.blockedReasons.includes('bond_duration_proxy_missing'), 'duration blocker must remain')
  assert.ok(factSet.missingFields.includes('durationProxy'), 'duration missing field must remain')
  assert.ok(!factSet.missingFields.includes('creditRiskProxy'), 'creditRiskProxy missing field must be removed when proxy is available')
  assert.ok(factSet.evidenceRefs.some((ref) => ref.startsWith('bond-risk-proxy:')), 'bond proxy evidenceRef must be exposed')
  assert.ok(factSet.sourceRefs.some((ref) => ref.includes(`zcpz_${position.asset.symbol}`)), 'asset allocation sourceRef must be exposed')
  assert.ok(factSet.sourceRefs.some((ref) => ref.includes('type=zqcc')), 'bond holding sourceRef must be exposed')

  assert.ok(assessment.providerTrace?.fundLikeFactSet, 'value assessment must attach fundLikeFactSet providerTrace')
  assert.equal((assessment.providerTrace?.fundLikeFactSet as any).bondRiskProxy.status, 'available')
  assert.ok(!assessment.valuation.blockedReasons.includes('bond_credit_risk_proxy_missing'))
  assert.ok(assessment.valuation.blockedReasons.includes('bond_duration_proxy_missing'))
  assert.equal(fivdR.formalTradeActionAllowed, false)
  assert.equal(fivdR.autoTradeAllowed, false)
  assert.equal(fivdR.capabilityState, 'TRADE_BLOCKED')

  console.log(JSON.stringify({
    ok: true,
    symbol: position.asset.symbol,
    name: position.asset.name,
    factsetStatus: factSet.status,
    bondRiskProxy: factSet.bondRiskProxy,
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
