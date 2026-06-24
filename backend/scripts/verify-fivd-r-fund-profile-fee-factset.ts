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
  assert.ok(positions.length > 0, '需要至少一个真实基金/债基/ETF持仓进行 profile/fee factset 验收')

  const results = []
  for (const position of positions) {
    const factSet = await alternativeAssetFactsetService.buildFundLikeFactSet(position)
    results.push({ position, factSet })
  }

  const profileAvailable = results.filter((item) => item.factSet.profile.status === 'available')
  const feeAvailable = results.filter((item) => item.factSet.fee.status === 'available')
  assert.ok(profileAvailable.length > 0, '至少一个真实基金/债基/ETF持仓必须返回真实 profile factset')
  assert.ok(feeAvailable.length > 0, '至少一个真实基金/债基/ETF持仓必须返回真实 fee factset')

  const sample = results.find((item) => (
    item.position.asset.symbol === '009725'
    && item.factSet.profile.status === 'available'
    && item.factSet.fee.status === 'available'
  )) || results.find((item) => item.factSet.profile.status === 'available' && item.factSet.fee.status === 'available')

  assert.ok(sample, '需要至少一个真实标的同时具备 profile 和 fee')
  assert.ok(sample.factSet.profile.fundCategory, 'profile available must expose fundCategory')
  assert.ok(sample.factSet.profile.managerNames.length > 0, 'profile available must expose managerNames')
  assert.ok(sample.factSet.profile.managementCompany, 'profile available must expose managementCompany')
  assert.ok(sample.factSet.profile.fundScaleText, 'profile available must expose fundScaleText')
  assert.equal(typeof sample.factSet.fee.managementFeePct, 'number', 'fee available must expose managementFeePct')
  assert.equal(typeof sample.factSet.fee.custodianFeePct, 'number', 'fee available must expose custodianFeePct')
  assert.equal(typeof sample.factSet.fee.salesServiceFeePct, 'number', 'fee available must expose salesServiceFeePct')
  assert.ok(!sample.factSet.blockedReasons.includes('fund_profile_factset_missing'), 'available profile must remove fund_profile_factset_missing')
  assert.ok(!sample.factSet.blockedReasons.includes('fund_fee_factset_missing'), 'available fee must remove fund_fee_factset_missing')
  assert.ok(sample.factSet.missingFields.includes('riskLevel'), 'riskLevel must remain missing until a real risk provider is implemented')
  assert.ok(sample.factSet.blockedReasons.includes('fund_risk_level_missing'), 'riskLevel missing must remain an actionable blocker')
  if (['bond', 'bond_fund'].includes(sample.position.asset.type)) {
    assert.ok(sample.factSet.missingFields.includes('durationProxy'), 'bond duration proxy must remain missing')
    assert.ok(sample.factSet.blockedReasons.includes('bond_duration_proxy_missing'), 'bond duration gap must remain actionable')
  }
  assert.ok(sample.factSet.evidenceRefs.some((ref) => ref.startsWith('fund-profile:')), 'profile evidenceRef must be exposed')
  assert.ok(sample.factSet.evidenceRefs.some((ref) => ref.startsWith('fund-fee:')), 'fee evidenceRef must be exposed')
  assert.ok(sample.factSet.sourceRefs.some((ref) => ref.includes(`jbgk_${sample.position.asset.symbol}`)), 'profile sourceRef must be exposed')
  assert.ok(sample.factSet.sourceRefs.some((ref) => ref.includes(`jjfl_${sample.position.asset.symbol}`)), 'fee sourceRef must be exposed')

  const profileUnavailable = results.filter((item) => item.factSet.profile.status !== 'available')
  const feeUnavailable = results.filter((item) => item.factSet.fee.status !== 'available')
  for (const item of profileUnavailable) {
    assert.ok(item.factSet.blockedReasons.includes('fund_profile_factset_missing'), `${item.position.asset.symbol} must keep profile blocker when profile unavailable`)
  }
  for (const item of feeUnavailable) {
    assert.ok(item.factSet.blockedReasons.includes('fund_fee_factset_missing'), `${item.position.asset.symbol} must keep fee blocker when fee unavailable`)
  }

  const [assessment, fivdR] = await Promise.all([
    valueAssessmentService.assessPosition(sample.position),
    analysisService.getFivdRAnalysis('default', { positionId: sample.position.id, scope: 'position' }) as any,
  ])

  assert.ok(assessment.providerTrace?.fundLikeFactSet, 'value assessment must attach fundLikeFactSet providerTrace')
  assert.equal((assessment.providerTrace?.fundLikeFactSet as any).profile.status, 'available')
  assert.equal((assessment.providerTrace?.fundLikeFactSet as any).fee.status, 'available')
  assert.ok(!assessment.valuation.blockedReasons.includes('fund_profile_factset_missing'))
  assert.ok(!assessment.valuation.blockedReasons.includes('fund_fee_factset_missing'))
  assert.ok(assessment.valuation.blockedReasons.includes('fund_risk_level_missing'))
  assert.equal(fivdR.formalTradeActionAllowed, false)
  assert.equal(fivdR.autoTradeAllowed, false)
  assert.equal(fivdR.capabilityState, 'TRADE_BLOCKED')

  console.log(JSON.stringify({
    ok: true,
    checkedPositions: results.length,
    profileAvailableCount: profileAvailable.length,
    feeAvailableCount: feeAvailable.length,
    profileUnavailableCount: profileUnavailable.length,
    feeUnavailableCount: feeUnavailable.length,
    sample: {
      symbol: sample.position.asset.symbol,
      name: sample.position.asset.name,
      assetType: sample.position.asset.type,
      factsetStatus: sample.factSet.status,
      profile: sample.factSet.profile,
      fee: sample.factSet.fee,
      holdingsStatus: sample.factSet.holdings.status,
      blockedReasons: sample.factSet.blockedReasons,
      missingFields: sample.factSet.missingFields,
      valuationBlockedReasons: assessment.valuation.blockedReasons,
      formalTradeActionAllowed: fivdR.formalTradeActionAllowed,
      autoTradeAllowed: fivdR.autoTradeAllowed,
      capabilityState: fivdR.capabilityState,
    },
    unavailableSamples: results
      .filter((item) => item.factSet.profile.status !== 'available' || item.factSet.fee.status !== 'available')
      .slice(0, 5)
      .map((item) => ({
        symbol: item.position.asset.symbol,
        name: item.position.asset.name,
        profileStatus: item.factSet.profile.status,
        profileLastError: item.factSet.profile.lastError,
        feeStatus: item.factSet.fee.status,
        feeLastError: item.factSet.fee.lastError,
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
