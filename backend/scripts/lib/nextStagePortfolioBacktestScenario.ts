import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import { portfolioBacktestRoutes } from '../../src/routes/portfolioBacktest.js'

export const AUDIT_USER_ID = process.env.FAMS_PORTFOLIO_BACKTEST_AUDIT_USER_ID || 'audit_portfolio_backtest_user'
export const PROHIBITED_ACTIONS = ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'] as const
export const ALLOWED_ACTIONS = ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'] as const

export function checkedAtIso() {
  return new Date().toISOString()
}

export async function createNextStageAuditDir(checkedAt = checkedAtIso()) {
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'next-stage-automation', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })
  return auditDir
}

export async function writeAuditJson(auditDir: string, fileName: string, value: unknown) {
  const path = resolve(auditDir, fileName)
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return path
}

export async function writeAuditText(auditDir: string, fileName: string, value: string) {
  const path = resolve(auditDir, fileName)
  await writeFile(path, value.endsWith('\n') ? value : `${value}\n`, 'utf8')
  return path
}

export async function runNextStagePortfolioBacktest() {
  const app = Fastify({ logger: false })
  await app.register(portfolioBacktestRoutes, { prefix: '/api/v1/portfolio-backtest' })
  try {
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
    assert.equal(response.statusCode, 200)
    return response.json()
  } finally {
    await app.close()
  }
}

export function assertTradeBoundaryLocked(result: any) {
  assert.deepEqual(result.prohibitedActions, [...PROHIBITED_ACTIONS])
  assert.equal(result.notTradingAdvice, true)
  assert.equal(result.executionIsolationAudit?.formalTradingUnlocked, false)
  assert.equal(result.executionIsolationAudit?.autoTradeUnlocked, false)
  assert.equal(result.executionIsolationAudit?.canCreateOrder, false)
  assert.equal(result.executionIsolationAudit?.orderCreateAllowed, false)
  assert.equal(result.releaseGateAudit?.formalTradingUnlocked, false)
  assert.equal(result.releaseGateAudit?.autoTradeUnlocked, false)
  assert.equal(result.releaseGateAudit?.canCreateOrder, false)
  assert.equal(result.releaseGateAudit?.orderCreateAllowed, false)
}

export function baseAudit(schemaVersion: string, checkedAt: string) {
  return {
    schemaVersion,
    checkedAt,
    userId: AUDIT_USER_ID,
    allowedActions: [...ALLOWED_ACTIONS],
    prohibitedActions: [...PROHIBITED_ACTIONS],
    notTradingAdvice: true,
  }
}
