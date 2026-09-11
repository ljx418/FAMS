import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { prisma } from '../src/db/prisma.js'
import { portfolioBacktestEngine } from '../src/services/portfolio-backtest/portfolioBacktestEngine.js'
import { portfolioBacktestInputBuilder } from '../src/services/portfolio-backtest/portfolioBacktestInputBuilder.js'

const outputDir = resolve(process.cwd(), 'data/gpt-audit/classic-portfolio-three-year-study')
const outputPath = resolve(outputDir, 'latest-study.json')

async function main() {
  const input = await portfolioBacktestInputBuilder.build({
    userId: 'classic_portfolio_research_user',
    portfolioStrategyIds: [
      'all_weather',
      'permanent_portfolio',
      'china_60_40',
      'china_golden_butterfly',
      'dividend_low_vol_60_40',
    ],
    startDate: '2023-08-29',
    endDate: '2026-08-28',
    initialCapital: 100000,
    rebalanceFrequency: 'quarterly',
    dividendMode: 'reinvest',
    feeRate: 0.0003,
    slippageRate: 0.0005,
    benchmarkIds: ['cash_cny', 'csi300_price_index', 'free_source_total_return'],
    gradeMode: 'research',
    scenarioAnalysis: {
      enabled: true,
      policyIds: ['buy_and_hold', 'weekly', 'semi_monthly', 'monthly', 'quarterly', 'drift_3pp'],
      executionPrice: 'next_open',
      lotSize: 100,
      minCommissionCny: 5,
      cashAnnualRate: 0.01,
      driftThresholdPercentagePoints: 3,
      validationMonths: 12,
    },
  })
  const result = await portfolioBacktestEngine.run(input)
  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, `${JSON.stringify({ input, result }, null, 2)}\n`, 'utf8')

  const study = result.classicPortfolioStudy
  assert.ok(study, 'classic portfolio study must be returned')
  assert.equal(study.strategies.length, 5)
  assert.deepEqual(study.actualPeriod, { startDate: '2023-08-29', endDate: '2026-08-28', tradingDays: 727 })
  assert.equal(study.dataTruthAudit.status, 'passed')
  assert.deepEqual(study.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.equal(study.executionAssumptions.cashAnnualRate, 0.01)
  assert.equal(study.executionAssumptions.executionPrice, 'next_open')
  const expectedDistributionEvents: Record<string, number> = {
    '510300': 3,
    '510500': 4,
    '511010': 4,
    '511260': 4,
    '512890': 0,
    '518880': 0,
    '159985': 0,
  }
  for (const item of study.dataTruthAudit.items) {
    assert.ok(item.coveragePercent >= 98, `${item.symbol} coverage must be at least 98%`)
    assert.equal(item.crossCheckStatus, 'passed', `${item.symbol} must pass Tencent cross-check`)
    assert.equal(item.distributionEvents, expectedDistributionEvents[item.symbol], `${item.symbol} official distribution count mismatch`)
    assert.ok(!item.warnings.some((warning) => warning.includes('qfq_factor_used_for_total_return')))
  }
  for (const strategy of study.strategies) {
    assert.equal(strategy.scenarios.length, 6, `${strategy.strategyId} should expose six frequency scenarios`)
    for (const scenario of strategy.scenarios) {
      assert.ok(Number.isFinite(scenario.metrics.endingValue) && scenario.metrics.endingValue > 0)
      assert.ok(scenario.metrics.totalReturnPercent > -80 && scenario.metrics.totalReturnPercent < 200)
      assert.ok(scenario.trades.every((trade) => trade.quantity % 100 === 0))
      assert.ok(scenario.trades.every((trade) => ['initial_allocation', 'dividend_reinvestment'].includes(trade.reason) || trade.executionDate > trade.decisionDate))
      assert.ok(scenario.trades.every((trade) => trade.cashAfter >= -0.01))
    }
  }

  const compact = {
    ok: study.dataTruthAudit.status === 'passed',
    outputPath,
    requestedPeriod: study.requestedPeriod,
    actualPeriod: study.actualPeriod,
    dataTruthAudit: study.dataTruthAudit,
    conclusion: study.conclusion,
    strategies: study.strategies.map((strategy) => ({
      strategyId: strategy.strategyId,
      displayName: strategy.displayName,
      preferredScenarioId: strategy.preferredScenarioId,
      preferenceReason: strategy.preferenceReason,
      nextDecision: strategy.nextDecision,
      scenarios: strategy.scenarios.map((scenario) => ({
        scenarioId: scenario.scenarioId,
        metrics: scenario.metrics,
        validationMetrics: scenario.validationMetrics,
      })),
    })),
  }
  console.log(JSON.stringify(compact, null, 2))
  if (study.dataTruthAudit.status !== 'passed') process.exitCode = 2
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
