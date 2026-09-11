import 'dotenv/config'
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { portfolioBacktestRoutes } from '../src/routes/portfolioBacktest.js'
import { prisma } from '../src/db/prisma.js'

const userId = 'audit_portfolio_backtest_user'
const outputDir = resolve(process.cwd(), 'data/gpt-audit/fixed-rule-start-date-sensitivity')
const outputPath = resolve(outputDir, 'latest-fixed-rule-study.json')

function isoWeekKey(date: string) {
  const value = new Date(`${date}T00:00:00.000Z`)
  const weekday = value.getUTCDay() || 7
  value.setUTCDate(value.getUTCDate() - weekday + 1)
  return value.toISOString().slice(0, 10)
}

async function main() {
  const app = Fastify({ logger: false })
  await app.register(portfolioBacktestRoutes, { prefix: '/api/v1/portfolio-backtest' })
  const payload = {
    userId,
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
    benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20', 'free_source_total_return'],
    gradeMode: 'formal_review',
    ruleMode: 'registry_fixed',
    startDateSensitivity: {
      enabled: true,
      sampling: 'weekly_first_trading_day',
      minimumTradingDaysForAnnualization: 20,
    },
    scenarioAnalysis: {
      enabled: false,
      policyIds: ['quarterly'],
      executionPrice: 'next_open',
      lotSize: 100,
      minCommissionCny: 5,
      cashAnnualRate: 0.01,
      driftThresholdPercentagePoints: 3,
      validationMonths: 12,
    },
    executionMode: 'operation',
  }

  const startedAt = Date.now()
  const response = await app.inject({ method: 'POST', url: '/api/v1/portfolio-backtest/run', payload })
  assert.equal(response.statusCode, 200, response.body.slice(0, 1000))
  const submission = response.json()
  assert.equal(submission.status, 'completed')
  assert.ok(submission.operationId)
  assert.ok(submission.artifactRefs.some((ref: string) => ref.includes('23_fixed_rule_primary_run.json')))
  assert.ok(submission.artifactRefs.some((ref: string) => ref.includes('24_fixed_rule_trade_ledger.json')))
  assert.ok(submission.artifactRefs.some((ref: string) => ref.includes('25_start_date_sensitivity.json')))

  const study = submission.result?.fixedRuleStudy
  assert.ok(study, 'fixedRuleStudy must be returned')
  assert.equal(submission.result?.classicPortfolioStudy, undefined, 'fixed rule workflow must not run legacy preferred-scenario study')
  assert.equal(study.schemaVersion, 'portfolio.fixed_rule_study.v1')
  assert.equal(study.ruleMode, 'registry_fixed')
  assert.equal(study.methodology.historicalRuleOptimizationUsed, false)
  assert.equal(study.methodology.futureDataUsedToChooseRule, false)
  assert.equal(study.initialCapital, 100000)
  assert.equal(study.strategies.length, 5)
  assert.equal(study.dataTruthAudit.status, 'passed')
  assert.deepEqual(study.actualPeriod, { startDate: '2023-08-29', endDate: '2026-08-28', tradingDays: 727 })
  assert.ok(study.sensitivityConfig.startPointCount >= 150)
  assert.equal(study.aggregateSensitivity.length, study.sensitivityConfig.startPointCount)
  assert.ok(!JSON.stringify(study).includes('preferredScenarioId'))

  for (const item of study.dataTruthAudit.items) {
    assert.ok(item.coveragePercent >= 98, `${item.symbol} coverage below 98%`)
    assert.equal(item.crossCheckStatus, 'passed', `${item.symbol} Tencent cross-check failed`)
    assert.ok(!item.warnings.some((warning: string) => warning.startsWith('missing_open_blocks_fixed_rule_study')))
  }

  for (const strategy of study.strategies) {
    assert.equal(strategy.appliedPolicy.source, 'strategy_registry')
    assert.equal(strategy.appliedPolicy.frequency, 'quarterly')
    assert.equal(strategy.appliedPolicy.scenarioId, 'quarterly')
    assert.equal(strategy.appliedPolicy.frozenBeforeMarketDataEvaluation, true)
    assert.equal(strategy.primaryRun.equityCurve.length, study.actualPeriod.tradingDays)
    assert.equal(strategy.primaryRun.positionCurve.length, study.actualPeriod.tradingDays)
    assert.ok(strategy.primaryRun.trades.every((trade: any) => trade.quantity % 100 === 0))
    assert.ok(strategy.primaryRun.trades.every((trade: any) => ['initial_allocation', 'dividend_reinvestment'].includes(trade.reason) || trade.executionDate > trade.decisionDate))
    assert.equal(strategy.sensitivity.length, study.sensitivityConfig.startPointCount)
    const weekKeys = strategy.sensitivity.map((point: any) => isoWeekKey(point.startDate))
    assert.equal(new Set(weekKeys).size, weekKeys.length, `${strategy.strategyId} has duplicate weekly starts`)
    assert.ok(strategy.sensitivity.filter((point: any) => point.holdingTradingDays < 20).every((point: any) => point.annualizedReturnPercent === null && point.status === 'insufficient'))
    for (const point of strategy.primaryRun.positionCurve) {
      const weightSum = point.cashWeightPercent + point.components.reduce((sum: number, component: any) => sum + component.weightPercent, 0)
      assert.ok(Math.abs(weightSum - 100) <= 0.05, `${strategy.strategyId} weights do not reconcile on ${point.date}: ${weightSum}`)
    }
  }

  for (const aggregate of study.aggregateSensitivity) {
    const points = study.strategies.map((strategy: any) => strategy.sensitivity.find((point: any) => point.startDate === aggregate.startDate))
    assert.ok(points.every(Boolean))
    const maximum = Math.max(...points.map((point: any) => point.totalReturnPercent))
    const average = points.reduce((sum: number, point: any) => sum + point.totalReturnPercent, 0) / points.length
    const worstDrawdown = Math.min(...points.map((point: any) => point.maxDrawdownPercent))
    assert.ok(Math.abs(aggregate.maximumTerminalReturnPercent - maximum) < 0.001)
    assert.ok(Math.abs(aggregate.averageTerminalReturnPercent - average) < 0.001)
    assert.ok(Math.abs(aggregate.worstMaxDrawdownPercent - worstDrawdown) < 0.001)
  }

  const historyResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/portfolio-backtest/runs?userId=${encodeURIComponent(userId)}&limit=20`,
  })
  assert.equal(historyResponse.statusCode, 200)
  const history = historyResponse.json()
  assert.ok(history.runs.some((run: any) => run.operationId === submission.operationId && run.fixedRuleAvailable === true))

  const savedResponse = await app.inject({
    method: 'GET',
    url: `/api/v1/portfolio-backtest/runs/${encodeURIComponent(submission.operationId)}?userId=${encodeURIComponent(userId)}`,
  })
  assert.equal(savedResponse.statusCode, 200)
  const saved = savedResponse.json()
  assert.equal(saved.result?.fixedRuleStudy?.generatedAt, study.generatedAt)
  assert.deepEqual(saved.result?.fixedRuleStudy?.strategies[0]?.primaryRun?.trades, study.strategies[0].primaryRun.trades)

  const detailStartDate = study.strategies[0].sensitivity[Math.floor(study.sensitivityConfig.startPointCount / 2)].startDate
  const detailResponse = await app.inject({
    method: 'POST',
    url: '/api/v1/portfolio-backtest/fixed-rule-detail',
    payload: { ...payload, executionMode: undefined, startDate: detailStartDate, startDateSensitivity: { ...payload.startDateSensitivity, enabled: false } },
  })
  assert.equal(detailResponse.statusCode, 200)
  const detail = detailResponse.json().fixedRuleStudy
  assert.equal(detail.actualPeriod.startDate, detailStartDate)
  assert.equal(detail.sensitivityConfig.startPointCount, 0)

  await mkdir(outputDir, { recursive: true })
  await writeFile(outputPath, `${JSON.stringify({
    schemaVersion: 'portfolio.fixed_rule_real_run_evidence.v1',
    generatedAt: new Date().toISOString(),
    operationId: submission.operationId,
    elapsedMs: Date.now() - startedAt,
    payload,
    study,
    artifactRefs: submission.artifactRefs,
    savedRunReloaded: true,
    detailStartDate,
  }, null, 2)}\n`, 'utf8')

  console.log(JSON.stringify({
    ok: true,
    operationId: submission.operationId,
    outputPath,
    elapsedMs: Date.now() - startedAt,
    actualPeriod: study.actualPeriod,
    strategyCount: study.strategies.length,
    weeklyStartPointCount: study.sensitivityConfig.startPointCount,
    dataTruthStatus: study.dataTruthAudit.status,
    strategies: study.strategies.map((strategy: any) => ({
      strategyId: strategy.strategyId,
      policy: strategy.appliedPolicy.scenarioId,
      totalReturnPercent: strategy.primaryRun.metrics.totalReturnPercent,
      endingValue: strategy.primaryRun.metrics.endingValue,
      maxDrawdownPercent: strategy.primaryRun.metrics.maxDrawdownPercent,
      tradeCount: strategy.primaryRun.metrics.tradeCount,
    })),
  }, null, 2))
  await app.close()
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
