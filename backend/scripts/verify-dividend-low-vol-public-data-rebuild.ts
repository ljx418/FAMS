import assert from 'node:assert/strict'
import { dividendLowVolUniverseService } from '../src/services/dividend-low-vol/dividendLowVolUniverseService.js'
import { dividendLowVolInputBuilderService } from '../src/services/dividend-low-vol/dividendLowVolInputBuilderService.js'
import { dividendLowVolStrategyService } from '../src/services/dividend-low-vol/dividendLowVolStrategyService.js'
import { prisma } from '../src/db/prisma.js'

async function main() {
  process.env.FAMS_DIVIDEND_LOW_VOL_FUNDAMENTAL_TIMEOUT_MS ||= '800'
  process.env.FAMS_DIVIDEND_LOW_VOL_DIVIDEND_TIMEOUT_MS ||= '800'
  process.env.FAMS_DIVIDEND_LOW_VOL_FREE_HISTORY_TIMEOUT_MS ||= '8000'
  process.env.FAMS_DIVIDEND_LOW_VOL_INPUT_CONCURRENCY ||= '8'
  const universe = await dividendLowVolUniverseService.getAllAShareInputs({ limit: 40 })
  const symbols = new Set(universe.inputs.map((item) => item.symbol))
  assert.ok(symbols.has('000651') || symbols.has('601398') || symbols.has('600519'), 'test universe should include at least one public-seed covered candidate')
  const inputs = await dividendLowVolInputBuilderService.buildFromInputs(universe.inputs, 40)
  const pool = dividendLowVolStrategyService.buildCandidatePool(inputs, { universeSummary: universe.summary })
  const complete = pool.candidates.filter((candidate) => candidate.metricCompleteness.displayReady)
  assert.ok(pool.metricCompletenessSummary, 'pool must expose metricCompletenessSummary')
  assert.ok(Array.isArray(pool.metricCompletenessSummary.topMissingMetrics), 'pool must expose top missing metrics')
  assert.ok(complete.length >= 1, 'public data rebuild should produce at least one complete display-ready research row')
  for (const candidate of complete) {
    assert.equal(candidate.metricCompleteness.status, 'complete', `${candidate.identity.symbol} should be complete`)
    assert.equal(candidate.metricCompleteness.missingMetrics.length, 0, `${candidate.identity.symbol} should not expose missing display metrics`)
    assert.ok(candidate.tradingDiscipline.prohibitedActions.includes('ADD'), `${candidate.identity.symbol} must prohibit ADD`)
    assert.ok(candidate.tradingDiscipline.prohibitedActions.includes('REDUCE'), `${candidate.identity.symbol} must prohibit REDUCE`)
    assert.ok(candidate.tradingDiscipline.prohibitedActions.includes('AUTO_TRADE'), `${candidate.identity.symbol} must prohibit AUTO_TRADE`)
    assert.equal(candidate.tradingDiscipline.formalTradeActionAllowed, false, `${candidate.identity.symbol} must not allow formal trade action`)
    if (candidate.leaderEvidence.status !== 'verified_industry_leader') {
      assert.notEqual(candidate.disposition, 'build_position_plan', `${candidate.identity.symbol} must not show build_position_plan without verified leader evidence`)
    }
  }
  const expressway = pool.candidates.find((candidate) => candidate.identity.symbol === '001965')
  if (expressway) {
    assert.ok(!expressway.blockedReasons.includes('listing_age_less_than_3y'), '001965 must not derive listing age from a short market-history window')
  }
  console.log(JSON.stringify({
    ok: true,
    total: pool.total,
    complete: complete.length,
    completeSymbols: complete.map((candidate) => ({
      symbol: candidate.identity.symbol,
      disposition: candidate.disposition,
      leaderEvidence: candidate.leaderEvidence.status,
      prohibitedActions: candidate.tradingDiscipline.prohibitedActions,
    })),
    topMissingMetrics: pool.metricCompletenessSummary.topMissingMetrics.slice(0, 5),
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
