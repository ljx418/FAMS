import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { portfolioBacktestRoutes } from '../src/routes/portfolioBacktest.js'

const AUDIT_USER_ID = process.env.FAMS_PORTFOLIO_BACKTEST_AUDIT_USER_ID || 'audit_portfolio_backtest_user'
const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE']

async function main() {
  const checkedAt = new Date().toISOString()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'next-stage-automation', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })

  const app = Fastify({ logger: false })
  await app.register(portfolioBacktestRoutes, { prefix: '/api/v1/portfolio-backtest' })
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/portfolio-backtest/run',
    payload: {
      userId: AUDIT_USER_ID,
      portfolioStrategyIds: [
        'local_real_data_sample_60_40',
        'local_real_data_equal_weight_5',
        'local_real_data_concentrated_3',
        'dividend_low_vol_basket',
        'permanent_portfolio',
        'all_weather',
        'current_holdings_buy_and_hold',
      ],
      startDate: '2025-12-04',
      endDate: '2026-06-05',
      initialCapital: 100000,
      rebalanceFrequency: 'quarterly',
      dividendMode: 'reinvest',
      feeRate: 0.0003,
      slippageRate: 0.0005,
      benchmarkIds: ['cash_cny', 'csi300_price_index', 'local_equal_weight_20', 'free_source_total_return'],
      gradeMode: 'formal_review',
      executionMode: 'sync',
    },
  })
  await app.close()
  assert.equal(response.statusCode, 200)
  const result = response.json()

  assert.deepEqual(result.prohibitedActions, PROHIBITED_ACTIONS)
  assert.equal(result.notTradingAdvice, true)
  assert.ok(result.dataGovernanceAudit, 'S2 data governance audit missing')
  assert.ok(result.benchmarkQualificationAudit, 'S3 benchmark qualification audit missing')
  assert.ok(result.formalValidationAudit, 'S4 formal validation audit missing')
  assert.ok(result.manualSignoffAudit, 'S5 manual signoff audit missing')
  assert.ok(result.executionIsolationAudit, 'S6 execution isolation audit missing')
  assert.ok(result.releaseGateAudit, 'S7 release gate audit missing')
  assert.ok(result.longHorizonDataCoverageAudit, 'long-horizon real-data audit missing')
  assert.ok(result.multiPeriodBacktestResult, 'multi-period backtest audit missing')

  for (const item of result.dataGovernanceAudit.items || []) {
    assert.ok(item.fieldId, 'data governance item should expose fieldId')
    assert.ok(item.sourceProvider, `data governance ${item.fieldId} should expose sourceProvider`)
    assert.ok(item.sourceEndpoint, `data governance ${item.fieldId} should expose sourceEndpoint`)
    assert.ok(item.asOfDate, `data governance ${item.fieldId} should expose asOfDate`)
    assert.ok(item.fetchedAt, `data governance ${item.fieldId} should expose fetchedAt`)
    assert.ok(item.freshnessStatus, `data governance ${item.fieldId} should expose freshnessStatus`)
    assert.equal(typeof item.coveragePercent, 'number', `data governance ${item.fieldId} should expose coveragePercent`)
    assert.ok(Array.isArray(item.evidenceRefs), `data governance ${item.fieldId} should expose evidenceRefs`)
  }

  assert.equal(result.benchmarkQualificationAudit.canSupportFormalReview, true)
  assert.equal(result.benchmarkQualificationAudit.canSupportFormalTrading, false)
  assert.equal(result.benchmarkQualificationAudit.notTradingAdvice, true)
  assert.ok(
    result.benchmarkQualificationAudit.blockers.includes('official_authorized_total_return_benchmark_not_reviewed'),
    'official benchmark review blocker must remain visible',
  )

  assert.ok(result.formalValidationAudit.strategyCount >= 6)
  assert.equal(result.formalValidationAudit.notTradingAdvice, true)
  assert.equal(result.formalValidationAudit.formalTradingEligible, result.formalValidationAudit.status === 'passed')

  assert.equal(result.manualSignoffAudit.status, 'missing')
  assert.equal(result.manualSignoffAudit.allRequiredSignedOff, false)
  assert.equal(result.manualSignoffAudit.canCreateOrder, false)
  assert.ok(result.manualSignoffAudit.requiredRoles.includes('final_release'))

  assert.equal(result.executionIsolationAudit.mode, 'paper_sandbox_only')
  assert.equal(result.executionIsolationAudit.productionAdapterEnabled, false)
  assert.equal(result.executionIsolationAudit.realPositionMutationAllowed, false)
  assert.equal(result.executionIsolationAudit.orderCreateAllowed, false)
  assert.equal(result.executionIsolationAudit.canCreateOrder, false)
  assert.equal(result.executionIsolationAudit.formalTradingUnlocked, false)
  assert.equal(result.executionIsolationAudit.autoTradeUnlocked, false)
  assert.ok(result.executionIsolationAudit.paperTradingReady, 'paper review should be available from manual drafts')

  assert.equal(result.releaseGateAudit.status, 'blocked')
  assert.equal(result.releaseGateAudit.formalTradingUnlocked, false)
  assert.equal(result.releaseGateAudit.autoTradeUnlocked, false)
  assert.equal(result.releaseGateAudit.orderCreateAllowed, false)
  assert.equal(result.releaseGateAudit.canCreateOrder, false)
  for (const id of [
    'field_level_data_governance',
    'official_or_cross_checked_benchmark',
    'formal_validation',
    'execution_isolation',
    'manual_human_signoff',
    'production_order_adapter',
    'auto_trade_policy',
  ]) {
    assert.ok(result.releaseGateAudit.checks.some((check: any) => check.id === id), `release gate check ${id} missing`)
  }
  assert.ok(
    result.releaseGateAudit.blockers.includes('human_reviewer_confirmation_not_completed')
      || result.releaseGateAudit.blockers.includes('production_order_adapter_not_enabled'),
    'release gate should remain blocked by human signoff or production adapter',
  )

  const audit = {
    schemaVersion: 'fams.next_stage.release_gate_components_audit.v1',
    status: 'passed',
    checkedAt,
    userId: AUDIT_USER_ID,
    gates: {
      s2DataGovernance: {
        status: result.dataGovernanceAudit.status,
        itemCount: result.dataGovernanceAudit.items?.length || 0,
        blockers: result.dataGovernanceAudit.blockers || [],
      },
      s3BenchmarkQualification: {
        status: result.benchmarkQualificationAudit.status,
        canSupportFormalReview: result.benchmarkQualificationAudit.canSupportFormalReview,
        canSupportFormalTrading: result.benchmarkQualificationAudit.canSupportFormalTrading,
        blockers: result.benchmarkQualificationAudit.blockers || [],
      },
      s4FormalValidation: {
        status: result.formalValidationAudit.status,
        strategyCount: result.formalValidationAudit.strategyCount,
        passedStrategies: result.formalValidationAudit.passedStrategies,
        blockers: result.formalValidationAudit.blockers || [],
      },
      s5ManualSignoff: {
        status: result.manualSignoffAudit.status,
        allRequiredSignedOff: result.manualSignoffAudit.allRequiredSignedOff,
        requiredRoles: result.manualSignoffAudit.requiredRoles,
      },
      s6ExecutionIsolation: {
        status: result.executionIsolationAudit.status,
        mode: result.executionIsolationAudit.mode,
        paperTradingReady: result.executionIsolationAudit.paperTradingReady,
        productionAdapterEnabled: result.executionIsolationAudit.productionAdapterEnabled,
      },
      s7ReleaseGate: {
        status: result.releaseGateAudit.status,
        blockerCount: result.releaseGateAudit.blockers?.length || 0,
        checks: result.releaseGateAudit.checks.map((check: any) => ({
          id: check.id,
          status: check.status,
          blocker: check.blocker || null,
        })),
      },
    },
    conclusion: {
      docSupportedReleaseGateComponentsImplemented: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
      blockerHandlingIsExplicit: true,
    },
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
    prohibitedActions: PROHIBITED_ACTIONS,
    notTradingAdvice: true,
  }

  const auditPath = resolve(auditDir, '09_next_stage_release_gate_components_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
