import assert from 'node:assert/strict'
import { FORMAL_RELEASE_CANDIDATES, FORMAL_RELEASE_CANDIDATE_VERSIONS } from '../src/services/formal-release/releaseCandidateSetService.js'
import {
  formalValidationProfileService,
  type FormalValidationProfileSet,
} from '../src/services/formal-release/formalValidationProfileService.js'
import { FormalValidationService, type ReleaseCandidateMetricEvidence } from '../src/services/formal-release/formalValidationService.js'
import type { PortfolioStrategyDefinition } from '../src/services/portfolio-backtest/portfolioBacktestTypes.js'

const HASH = 'a'.repeat(64)

function definition(strategyId: string): PortfolioStrategyDefinition {
  return {
    strategyId,
    strategyVersion: FORMAL_RELEASE_CANDIDATE_VERSIONS[strategyId as keyof typeof FORMAL_RELEASE_CANDIDATE_VERSIONS],
    displayName: strategyId,
    source: strategyId === 'current_holdings_buy_and_hold' ? 'current_holdings' : strategyId === 'dividend_low_vol_basket' ? 'dividend_low_vol' : 'preset',
    components: [{ assetClass: 'stock', symbol: `symbol-${strategyId}`, targetWeightPercent: 100, evidenceRefs: ['fixture'] }],
    rebalancePolicy: { frequency: 'quarterly' },
    dividendPolicy: 'reinvest',
    costModel: { feeRate: 0.0003, slippageRate: 0.0005 },
    benchmarkPolicy: { benchmarkIds: ['csi300_total_return_h00300'], proxyAllowed: false },
    validation: { status: 'valid', blockedReasons: [], warnings: [] },
    evidenceRefs: ['fixture'],
  }
}

function metric(strategyId: string): ReleaseCandidateMetricEvidence {
  return {
    strategyId,
    strategyVersion: FORMAL_RELEASE_CANDIDATE_VERSIONS[strategyId as keyof typeof FORMAL_RELEASE_CANDIDATE_VERSIONS],
    releaseEffectivePathCount: 48,
    industryGroupCount: 3,
    marketRegimeGroupCount: 3,
    liquidityGroupCount: 3,
    walkForwardWindows: 6,
    walkForwardPassedRatio: 1,
    oosStatus: 'passed',
    parameterSensitivityStatus: 'passed',
    groupStabilityStatus: 'passed',
    tradeConstraintsComplete: true,
    benchmarkStatus: 'trusted_total_return',
    benchmarkQualificationPassed: true,
    evidenceRefs: [`fixture:${strategyId}`],
    failureTaxonomy: [],
  }
}

async function main() {
  const candidateSetArtifact = {
    setId: 'fams_formal_release_candidates',
    version: '2026-09-14.validation-profile-v2',
    contentHash: HASH,
    candidateIds: [...FORMAL_RELEASE_CANDIDATES],
    candidateVersions: { ...FORMAL_RELEASE_CANDIDATE_VERSIONS },
  }
  const profileSet = formalValidationProfileService.freeze({
    candidateSet: candidateSetArtifact,
    definitions: FORMAL_RELEASE_CANDIDATES.map(definition),
    generatedAt: new Date('2026-09-14T10:00:00.000Z'),
  })
  assert.match(profileSet.profileSetHash, /^[a-f0-9]{64}$/)
  assert.deepEqual(profileSet.productReleaseCandidateIds, ['dividend_low_vol_basket'])
  assert.equal(profileSet.candidateAssignments.length, 7)

  const service = new FormalValidationService()
  const candidateSet = service.freezeCandidateSet({
    releaseCandidateStrategyIds: [...FORMAL_RELEASE_CANDIDATES],
    releaseCandidateStrategyVersions: { ...FORMAL_RELEASE_CANDIDATE_VERSIONS },
    excludedStrategies: [],
  })
  const passed = service.evaluate({
    candidateSet,
    validationProfileSet: profileSet,
    metrics: FORMAL_RELEASE_CANDIDATES.map(metric),
  })
  assert.equal(passed.formalValidationPassed, true)
  assert.equal(passed.passedStrategies, 1)
  assert.equal(passed.notApplicableStrategies, 6)
  assert.equal(passed.checks.length, 7)
  assert.equal(passed.checks.find((check) => check.strategyId === 'permanent_portfolio')?.formalGateStatus, 'not_applicable')

  const productMissingBenchmark: FormalValidationProfileSet = {
    ...profileSet,
    candidateAssignments: profileSet.candidateAssignments.map((assignment) => assignment.candidateId === 'dividend_low_vol_basket'
      ? { ...assignment, benchmarkId: null }
      : assignment),
  }
  const blocked = service.evaluate({ candidateSet, validationProfileSet: productMissingBenchmark, metrics: FORMAL_RELEASE_CANDIDATES.map(metric) })
  assert.equal(blocked.formalValidationPassed, false)
  assert.ok(blocked.blockers.includes('product_candidate_benchmark_missing'))

  const missingNonProduct = service.evaluate({
    candidateSet,
    validationProfileSet: profileSet,
    metrics: FORMAL_RELEASE_CANDIDATES.filter((id) => id !== 'all_weather').map(metric),
  })
  assert.equal(missingNonProduct.formalValidationPassed, true)
  assert.equal(missingNonProduct.checks.find((check) => check.strategyId === 'all_weather')?.formalGateStatus, 'not_applicable')
  assert.ok(missingNonProduct.checks.find((check) => check.strategyId === 'all_weather')?.blockers.includes('release_candidate_result_missing'))

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_3.validation_profile_contract_verification.v1',
    status: 'passed',
    inventoryCount: profileSet.inventoryCount,
    productReleaseCandidateIds: profileSet.productReleaseCandidateIds,
    negativeFixtures: ['product_benchmark_missing', 'non_product_missing_cannot_disappear'],
    nonProductCountedAsFormalPass: false,
    formalTradingUnlocked: false,
    autoTradeUnlocked: false,
    canCreateOrder: false,
    orderCreateAllowed: false,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
