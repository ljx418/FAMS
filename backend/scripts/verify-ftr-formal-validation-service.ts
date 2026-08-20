import assert from 'node:assert/strict'
import { FormalValidationService, type ReleaseCandidateMetricEvidence } from '../src/services/formal-release/formalValidationService.js'

function passingMetric(strategyId: string, strategyVersion: string): ReleaseCandidateMetricEvidence {
  return {
    strategyId,
    strategyVersion,
    releaseEffectivePathCount: 30,
    industryGroupCount: 3,
    walkForwardWindows: 6,
    walkForwardPassedRatio: 0.6,
    oosStatus: 'passed',
    parameterSensitivityStatus: 'passed',
    groupStabilityStatus: 'passed',
    tradeConstraintsComplete: true,
    benchmarkStatus: 'trusted_total_return',
    benchmarkQualificationPassed: true,
    evidenceRefs: [`formal-validation:${strategyId}:${strategyVersion}`],
    failureTaxonomy: [],
  }
}

async function main() {
  const service = new FormalValidationService()
  const candidateSet = service.freezeCandidateSet({
    releaseCandidateStrategyIds: ['candidate-a', 'candidate-b'],
    releaseCandidateStrategyVersions: { 'candidate-a': '1.0.0', 'candidate-b': '2.0.0' },
    excludedStrategies: [{ strategyId: 'research-only-c', reason: 'research_only_not_release_candidate' }],
  })
  assert.match(candidateSet.candidateSetHash, /^[a-f0-9]{64}$/)
  assert.equal(candidateSet.frozen, true)

  const passed = service.evaluate({
    candidateSet,
    metrics: [passingMetric('candidate-a', '1.0.0'), passingMetric('candidate-b', '2.0.0')],
  })
  assert.equal(passed.status, 'passed')
  assert.equal(passed.formalValidationPassed, true)
  assert.equal(passed.allReleaseCandidatesPassed, true)
  assert.equal(passed.releaseEffectivePathCount, 60)

  const missingCandidate = service.evaluate({
    candidateSet,
    metrics: [passingMetric('candidate-a', '1.0.0')],
  })
  assert.equal(missingCandidate.formalValidationPassed, false)
  assert.equal(missingCandidate.checks.length, 2)
  assert.equal(missingCandidate.checks[1].strategyId, 'candidate-b')
  assert.ok(missingCandidate.checks[1].blockers.includes('release_candidate_result_missing'))

  const proxyBenchmark = service.evaluate({
    candidateSet,
    metrics: [
      { ...passingMetric('candidate-a', '1.0.0'), benchmarkStatus: 'research_proxy', benchmarkQualificationPassed: false },
      passingMetric('candidate-b', '2.0.0'),
    ],
  })
  assert.equal(proxyBenchmark.formalValidationPassed, false)
  assert.ok(proxyBenchmark.checks[0].blockers.includes('release_benchmark_not_official_or_trusted_total_return'))

  const versionMismatch = service.evaluate({
    candidateSet,
    metrics: [passingMetric('candidate-a', '9.9.9'), passingMetric('candidate-b', '2.0.0')],
  })
  assert.ok(versionMismatch.checks[0].blockers.includes('release_candidate_version_mismatch'))
  assert.throws(() => service.freezeCandidateSet({
    releaseCandidateStrategyIds: ['candidate-a'],
    releaseCandidateStrategyVersions: { 'candidate-a': '1.0.0' },
    excludedStrategies: [{ strategyId: 'candidate-a', reason: 'hide_failed_candidate' }],
  }), /release_candidate_cannot_be_excluded/)

  console.log(JSON.stringify({
    schemaVersion: 'fams.ftr_3.formal_validation_service_verification.v1',
    status: 'passed',
    candidateSet,
    passingAudit: passed,
    negativeFixtures: ['missing_candidate_result', 'research_proxy_benchmark', 'candidate_version_mismatch', 'candidate_excluded_to_hide_failure'],
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
