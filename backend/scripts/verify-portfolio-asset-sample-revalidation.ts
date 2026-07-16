import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import Fastify from 'fastify'
import * as XLSX from 'xlsx'
import { prisma } from '../src/db/prisma.js'
import { assetService } from '../src/services/asset/assetService.js'
import { portfolioBacktestRoutes } from '../src/routes/portfolioBacktest.js'
import { seedPortfolioBacktestAuditHoldings } from './seed-portfolio-backtest-audit-holdings.js'

const AUDIT_USER_ID = process.env.FAMS_PORTFOLIO_BACKTEST_AUDIT_USER_ID || 'audit_portfolio_backtest_user'

async function main() {
  const checkedAt = new Date().toISOString()
  const auditDir = resolve(process.cwd(), 'data', 'gpt-audit', 'next-stage-automation', checkedAt.replace(/[:.]/g, '-'))
  await mkdir(auditDir, { recursive: true })

  const seedResult = await seedPortfolioBacktestAuditHoldings()
  assert.equal(seedResult.ok, true, 'audit holdings seed should succeed')
  assert.ok(seedResult.openPositions >= 3, `audit user should have at least 3 open positions: ${JSON.stringify(seedResult)}`)

  const positions = await prisma.position.findMany({
    where: { userId: AUDIT_USER_ID, status: 'open' },
    include: { asset: true },
    orderBy: { updatedAt: 'desc' },
  })
  assert.ok(positions.length >= 3, 'real asset sample should contain at least 3 positions')

  const latestBars = await Promise.all(positions.slice(0, 5).map(async (position) => {
    const bar = await prisma.marketBarCanonical.findFirst({
      where: {
        symbol: position.asset.symbol,
        market: 'CN',
        timeframe: '1d',
        adjustType: 'none',
        dataVersion: 'canonical.v1',
        closePrice: { gt: 0 },
      },
      orderBy: { tradeDate: 'desc' },
    })
    return {
      symbol: position.asset.symbol,
      hasCanonicalBar: Boolean(bar),
      latestTradeDate: bar?.tradeDate.toISOString().slice(0, 10) || null,
      latestClose: bar?.closePrice || null,
    }
  }))
  assert.ok(latestBars.every((item) => item.hasCanonicalBar), `all sample positions should have canonical market bars: ${JSON.stringify(latestBars)}`)

  const exportResult = await assetService.exportPortfolioWorkbook(AUDIT_USER_ID)
  const workbook = XLSX.read(exportResult.buffer, { type: 'buffer' })
  const requiredSheets = ['current_positions', 'trade_records', 'field_guide']
  const workbookSheetChecks = Object.fromEntries(
    requiredSheets.map((sheetName) => [sheetName, workbook.SheetNames.includes(sheetName)]),
  )
  assert.ok(Object.values(workbookSheetChecks).every(Boolean), `export workbook missing sheets: ${JSON.stringify(workbookSheetChecks)}`)

  const app = Fastify({ logger: false })
  await app.register(portfolioBacktestRoutes, { prefix: '/api/v1/portfolio-backtest' })
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/portfolio-backtest/run',
    payload: {
      userId: AUDIT_USER_ID,
      portfolioStrategyIds: ['current_holdings_buy_and_hold'],
      startDate: '2025-12-04',
      endDate: '2026-06-05',
      initialCapital: 100000,
      rebalanceFrequency: 'quarterly',
      dividendMode: 'reinvest',
      feeRate: 0.0003,
      slippageRate: 0.0005,
      benchmarkIds: ['cash_cny', 'free_source_total_return'],
      gradeMode: 'formal_review',
      executionMode: 'sync',
    },
  })
  await app.close()
  assert.equal(response.statusCode, 200)
  const result = response.json()
  const strategy = result.strategies?.find((item: any) => item.definition?.strategyId === 'current_holdings_buy_and_hold')
  assert.ok(strategy, 'current holdings strategy missing')
  assert.equal(strategy.status, 'completed', `current holdings backtest should complete: ${JSON.stringify(strategy.blockedReasons)}`)
  assert.ok((strategy.definition?.components || []).length >= 3, 'current holdings backtest should use at least 3 position components')
  assert.ok((strategy.equityCurve || []).length >= 30, 'current holdings backtest should use real price path with at least 30 points')
  assert.deepEqual(result.prohibitedActions, ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'])
  assert.equal(result.notTradingAdvice, true)
  assert.equal(result.releaseGateAudit?.formalTradingUnlocked, false)
  assert.equal(result.releaseGateAudit?.autoTradeUnlocked, false)
  assert.equal(result.releaseGateAudit?.canCreateOrder, false)
  assert.equal(result.releaseGateAudit?.orderCreateAllowed, false)

  const audit = {
    schemaVersion: 'fams.next_stage.portfolio_asset_sample_revalidation_audit.v1',
    status: 'passed',
    checkedAt,
    userId: AUDIT_USER_ID,
    seedResult,
    sample: {
      positionCount: positions.length,
      positions: positions.map((position) => ({
        symbol: position.asset.symbol,
        name: position.asset.name,
        quantity: position.quantity,
        currentPrice: position.currentPrice,
        marketValue: position.marketValue,
        evidenceRefs: [`position:${position.id}`, `asset:${position.asset.id}`],
      })),
      latestBars,
    },
    excel: {
      fileName: exportResult.fileName,
      workbookSheets: workbook.SheetNames,
      workbookSheetChecks,
      summary: exportResult.summary,
    },
    backtest: {
      strategyStatus: strategy.status,
      componentCount: strategy.definition.components.length,
      curvePoints: strategy.equityCurve.length,
      totalReturnPercent: strategy.metrics?.totalReturnPercent,
      maxDrawdownPercent: strategy.metrics?.maxDrawdownPercent,
      evidenceRefs: strategy.evidenceRefs,
      formalReviewReadiness: result.formalReviewReadiness,
      releaseGateAudit: result.releaseGateAudit,
    },
    conclusion: {
      realAssetSampleRevalidated: true,
      excelImportExportPathCovered: true,
      currentHoldingsBacktestReady: true,
      formalTradingUnlocked: false,
      autoTradeUnlocked: false,
      canCreateOrder: false,
      orderCreateAllowed: false,
    },
    allowedActions: ['RESEARCH', 'OBSERVE', 'COMPARE', 'ALERT', 'PLAN_DRAFT', 'MANUAL_TRADE_DRAFT'],
    prohibitedActions: ['ADD', 'REDUCE', 'ORDER_CREATE', 'AUTO_TRADE'],
    notTradingAdvice: true,
  }

  const auditPath = resolve(auditDir, '01_portfolio_asset_sample_revalidation_audit.json')
  await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ ...audit, auditPath }, null, 2))
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
