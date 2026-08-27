import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { screenshotCaptureService } from '../src/services/capture/screenshotCaptureService.js'

const USER_ID = 'default'
const SCREENSHOT_PATH = '/mnt/c/Users/ADMINI~1/AppData/Local/Temp/orca-paste-1787624132117-adc7c95e-555c-4138-946e-80486a296914.png'
const SCREENSHOT_SHA256 = '30f799c64e841e356ebdfb7a83e9ebbbfb9e3097b666b23e02485c21d3c1268c'
const CAPTURED_AT = new Date('2026-08-25T02:15:32.117Z')

const rows = [
  {
    rowType: 'account_summary',
    rawText: '资金余额 36000.33；可取金额 36000.33；可用金额 36000.33；股票市值 199805.80；总资产 235806.13；持仓盈亏 -196315.76；当日盈亏 211.90；当日盈亏比 0.09%',
    fields: { availableCash: 36000.33, cashBalance: 36000.33, withdrawableCash: 36000.33, stockMarketValue: 199805.80, totalAssets: 235806.13, holdingPnl: -196315.76, dayPnl: 211.90, dayPnlPct: 0.09 },
    fieldConfidence: { availableCash: 1, cashBalance: 1, withdrawableCash: 1, stockMarketValue: 1, totalAssets: 1, holdingPnl: 1, dayPnl: 1, dayPnlPct: 1 },
    confidence: 1,
  },
  { rowType: 'holding', rawText: '601318 中国平安 100 成本价53.309 市价54.730 市值5473.000', fields: { symbol: '601318', name: '中国平安', quantity: 100, avgCost: 53.309, currentPrice: 54.730, marketValue: 5473.000 }, fieldConfidence: { symbol: 1, name: 1, quantity: 1, avgCost: 1, currentPrice: 1, marketValue: 1 }, confidence: 1 },
  { rowType: 'holding', rawText: '000651 格力电器 300 成本价40.437 市价41.570 市值12471.000', fields: { symbol: '000651', name: '格力电器', quantity: 300, avgCost: 40.437, currentPrice: 41.570, marketValue: 12471.000 }, fieldConfidence: { symbol: 1, name: 1, quantity: 1, avgCost: 1, currentPrice: 1, marketValue: 1 }, confidence: 1 },
  { rowType: 'holding', rawText: '600276 恒瑞医药 400 成本价71.183 市价46.670 市值18668.000', fields: { symbol: '600276', name: '恒瑞医药', quantity: 400, avgCost: 71.183, currentPrice: 46.670, marketValue: 18668.000 }, fieldConfidence: { symbol: 1, name: 1, quantity: 1, avgCost: 1, currentPrice: 1, marketValue: 1 }, confidence: 1 },
  { rowType: 'holding', rawText: '159851 金科ETF 62100 成本价0.768 市价0.608 市值37756.800', fields: { symbol: '159851', name: '金科ETF', quantity: 62100, avgCost: 0.768, currentPrice: 0.608, marketValue: 37756.800 }, fieldConfidence: { symbol: 1, name: 1, quantity: 1, avgCost: 1, currentPrice: 1, marketValue: 1 }, confidence: 1 },
  { rowType: 'holding', rawText: '513770 港股互联 116300 成本价0.477 市价0.350 市值40705.000', fields: { symbol: '513770', name: '港股互联', quantity: 116300, avgCost: 0.477, currentPrice: 0.350, marketValue: 40705.000 }, fieldConfidence: { symbol: 1, name: 1, quantity: 1, avgCost: 1, currentPrice: 1, marketValue: 1 }, confidence: 1 },
  { rowType: 'holding', rawText: '601127 赛力斯 1700 成本价145.268 市价49.840 市值84728.000', fields: { symbol: '601127', name: '赛力斯', quantity: 1700, avgCost: 145.268, currentPrice: 49.840, marketValue: 84728.000 }, fieldConfidence: { symbol: 1, name: 1, quantity: 1, avgCost: 1, currentPrice: 1, marketValue: 1 }, confidence: 1 },
] as const

const expected = new Map([
  ['现金-可用金额', { quantity: 36000.33, currentPrice: 1, marketValue: 36000.33 }],
  ['601318', { quantity: 100, currentPrice: 54.730, marketValue: 5473.000 }],
  ['000651', { quantity: 300, currentPrice: 41.570, marketValue: 12471.000 }],
  ['600276', { quantity: 400, currentPrice: 46.670, marketValue: 18668.000 }],
  ['159851', { quantity: 62100, currentPrice: 0.608, marketValue: 37756.800 }],
  ['513770', { quantity: 116300, currentPrice: 0.350, marketValue: 40705.000 }],
  ['601127', { quantity: 1700, currentPrice: 49.840, marketValue: 84728.000 }],
])

function closeTo(actual: number | null, wanted: number, label: string) {
  assert.ok(actual !== null && Math.abs(actual - wanted) < 0.000001, `${label}: expected ${wanted}, received ${actual}`)
}

async function main() {
  const [transactionCountBefore, externalOrderCountBefore, snapshotCountBefore] = await Promise.all([
    prisma.transaction.count({ where: { userId: USER_ID } }),
    prisma.externalOrderObservation.count({ where: { userId: USER_ID } }),
    prisma.positionSnapshot.count({ where: { userId: USER_ID } }),
  ])
  const buffer = await readFile(SCREENSHOT_PATH)
  const upload = await screenshotCaptureService.upload({
    userId: USER_ID,
    buffer,
    mimeType: 'image/png',
    originalFilename: 'broker-holdings-2026-08-25.png',
    conversationId: 'codex-user-approved-daily-review-v1',
    capturedAt: CAPTURED_AT,
  })
  assert.equal(upload.capture.sha256, SCREENSHOT_SHA256)

  let preview = await screenshotCaptureService.getPreview(upload.capture.id, USER_ID)
  if (!['confirmed', 'partially_confirmed'].includes(preview.capture.status)) {
    preview = await screenshotCaptureService.applyExtraction({
      captureId: upload.capture.id,
      userId: USER_ID,
      documentType: 'holding',
      rows: [...rows],
      rawText: 'A股账户资产汇总及六项持仓；由用户提供的清晰截图逐字段录入。',
      visionProvider: 'codex_structured_input_from_user_screenshot',
      consentGranted: false,
    })
    assert.equal(preview.rows.length, 7)
    assert.equal(preview.rows.every((row) => row.status === 'ready'), true)
    assert.deepEqual(preview.capture.extraction?.missingHoldings, [])
    assert.equal(preview.accountReconciliation?.status, 'warning')
    closeTo(preview.accountReconciliation?.stockMarketValueVariance ?? null, 4, 'stock market value variance')
    closeTo(preview.accountReconciliation?.totalAssetsVariance ?? null, 4, 'total assets variance')
    await screenshotCaptureService.confirm({
      captureId: upload.capture.id,
      userId: USER_ID,
      rowIds: preview.rows.map((row) => row.id),
      confirmed: true,
      confirmedBy: 'user-approved-plan-2026-08-25',
    })
  }

  preview = await screenshotCaptureService.getPreview(upload.capture.id, USER_ID)
  const [positions, transactionCountAfter, externalOrderCountAfter, snapshotCountAfter] = await Promise.all([
    prisma.position.findMany({ where: { userId: USER_ID, status: 'open' }, include: { asset: true } }),
    prisma.transaction.count({ where: { userId: USER_ID } }),
    prisma.externalOrderObservation.count({ where: { userId: USER_ID } }),
    prisma.positionSnapshot.count({ where: { userId: USER_ID } }),
  ])
  assert.equal(preview.capture.status, 'confirmed')
  assert.equal(preview.rows.length, 7)
  assert.equal(preview.rows.every((row) => row.status === 'confirmed'), true)
  assert.equal(preview.accountReconciliation?.status, 'warning')
  closeTo(preview.accountReconciliation?.stockMarketValueVariance ?? null, 4, 'confirmed stock market value variance')
  closeTo(preview.accountReconciliation?.totalAssetsVariance ?? null, 4, 'confirmed total assets variance')
  assert.equal(positions.length, expected.size)
  for (const position of positions) {
    const wanted = expected.get(position.asset.symbol)
    assert.ok(wanted, `unexpected open position ${position.asset.symbol}`)
    closeTo(position.quantity, wanted.quantity, `${position.asset.symbol} quantity`)
    closeTo(position.currentPrice, wanted.currentPrice, `${position.asset.symbol} current price`)
    closeTo(position.marketValue, wanted.marketValue, `${position.asset.symbol} market value`)
  }
  assert.equal(transactionCountAfter, transactionCountBefore, 'screenshot reconciliation must not create transactions')
  assert.equal(externalOrderCountAfter, externalOrderCountBefore, 'screenshot reconciliation must not create broker order observations')
  const expectedSnapshotDelta = upload.reused && snapshotCountBefore > 0 && preview.capture.status === 'confirmed' ? 0 : 7
  assert.ok(snapshotCountAfter - snapshotCountBefore === 0 || snapshotCountAfter - snapshotCountBefore === expectedSnapshotDelta)

  console.log(JSON.stringify({
    status: 'PASS',
    captureId: upload.capture.id,
    screenshotSha256: upload.capture.sha256,
    reused: upload.reused,
    capturedAt: upload.capture.capturedAt,
    confirmedRows: preview.rows.length,
    openPositions: positions.map((position) => ({ symbol: position.asset.symbol, quantity: position.quantity, avgCost: position.avgCost, currentPrice: position.currentPrice, marketValue: position.marketValue })),
    accountReconciliation: preview.accountReconciliation,
    invariants: {
      missingHoldingsClosed: 0,
      transactionCountBefore,
      transactionCountAfter,
      externalOrderCountBefore,
      externalOrderCountAfter,
      snapshotDelta: snapshotCountAfter - snapshotCountBefore,
      brokerOrdersCreated: 0,
    },
  }, null, 2))
}

main().finally(async () => prisma.$disconnect())
