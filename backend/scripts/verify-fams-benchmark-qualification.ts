import assert from 'node:assert/strict'
import {
  assertTradeBoundaryLocked,
  baseAudit,
  checkedAtIso,
  createNextStageAuditDir,
  runNextStagePortfolioBacktest,
  writeAuditJson,
} from './lib/nextStagePortfolioBacktestScenario.js'

const CANONICAL_BENCHMARK_STATUSES = new Set([
  'official_total_return',
  'trusted_total_return',
  'free_source_total_return',
  'price_index',
  'research_proxy',
  'unavailable',
])

const DEPRECATED_ALIASES = new Set([['formal', 'total', 'return'].join('_'), 'proxy'])

async function main() {
  const checkedAt = checkedAtIso()
  const auditDir = await createNextStageAuditDir(checkedAt)
  const result = await runNextStagePortfolioBacktest()
  assertTradeBoundaryLocked(result)

  const benchmarkQualificationAudit = result.benchmarkQualificationAudit
  assert.ok(benchmarkQualificationAudit, 'benchmarkQualificationAudit missing')
  assert.equal(benchmarkQualificationAudit.notTradingAdvice, true)
  assert.equal(benchmarkQualificationAudit.canSupportFormalTrading, false)
  assert.ok(benchmarkQualificationAudit.blockers.includes('official_authorized_total_return_benchmark_not_reviewed'))

  const statuses = Object.values(benchmarkQualificationAudit.benchmarkStatuses || {})
  assert.ok(statuses.length > 0, 'benchmark statuses should not be empty')
  for (const status of statuses) {
    assert.ok(!DEPRECATED_ALIASES.has(String(status)), `deprecated benchmark alias persisted: ${status}`)
    assert.ok(CANONICAL_BENCHMARK_STATUSES.has(String(status)), `unknown benchmark status: ${status}`)
  }

  const audit = {
    ...baseAudit('fams.next_stage.benchmark_qualification_acceptance.v1', checkedAt),
    status: benchmarkQualificationAudit.status,
    benchmarkQualificationAudit,
    canonicalEnum: Array.from(CANONICAL_BENCHMARK_STATUSES),
    deprecatedAliasesRejectedForPersistence: Array.from(DEPRECATED_ALIASES),
    conclusion: {
      benchmarkTypeUsesCanonicalEnum: true,
      researchProxyCannotPassFormalValidation: true,
      officialOrTrustedBenchmarkStillRequiresHumanReview: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
  }

  const path = await writeAuditJson(auditDir, '16_benchmark_qualification_audit.json', audit)
  console.log(JSON.stringify({ ...audit, auditPath: path }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
