import assert from 'node:assert/strict'
import { dividendLowVolBacktestService } from '../src/services/dividend-low-vol/dividendLowVolBacktestService.js'
import { dividendLowVolTotalReturnAuditService } from '../src/services/dividend-low-vol/dividendTotalReturnAuditService.js'

function history(start: number, days: number, drift: number, withTradeability = false) {
  const rows = []
  const startDate = new Date('2025-01-01T00:00:00.000Z')
  for (let index = 0; index < days; index += 1) {
    const close = start + index * drift + Math.sin(index / 9) * 0.2
    rows.push({
      date: new Date(startDate.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      open: close * 0.99,
      high: close * 1.01,
      low: close * 0.98,
      close,
      volume: 8_000_000,
      amount: close * 8_000_000,
      ...(withTradeability ? {
        isTradable: true,
        tradabilityStatus: 'tradable' as const,
        isSuspended: false,
        limitUp: close * 1.1,
        limitDown: close * 0.9,
        tradeabilityEvidenceRef: `verify:free-source:tradeability:${index}`,
      } : {}),
    })
  }
  return rows
}

async function main() {
  const inputs = ['600000', '601398', '000001'].map((symbol, index) => ({
    symbol,
    name: symbol,
    industry: index === 2 ? '股份制银行' : '国有银行',
    listingAgeDays: 365 * 12,
    price: 10 + index,
    dividendRecords: [
      { year: 2023, dividendPerShare: 0.65, evidenceRef: `verify:${symbol}:dividend:2023` },
      { year: 2024, dividendPerShare: 0.72, evidenceRef: `verify:${symbol}:dividend:2024` },
      { year: 2025, dividendPerShare: 0.82, evidenceRef: `verify:${symbol}:dividend:2025` },
    ],
    ttmDividendPerShare: 0.82,
    payoutRatio: 45,
    operatingCashFlowToNetProfit: 1.2,
    roe: 12,
    debtToAsset: 58,
    totalMarketCap: 300_000_000_000,
    avgTurnoverAmount60: 800_000_000,
    leaderScore: 88,
    history: history(12 + index, 180, 0.002),
    evidenceRefs: [`verify:${symbol}:annual-report`],
  }))
  const backtest = dividendLowVolBacktestService.run(inputs, { dividendReinvestment: true }) as any
  const audit = dividendLowVolTotalReturnAuditService.buildAudit(backtest)
  assert.equal(audit.schemaVersion, 'dividend.low_vol.total_return_backtest_audit.v1')
  assert.equal(typeof audit.returnComponents.priceOnlyReturn, 'number')
  assert.equal(typeof audit.returnComponents.dividendContribution, 'number')
  assert.equal(typeof audit.returnComponents.capitalGainContribution, 'number')
  assert.equal(typeof audit.returnComponents.costDrag, 'number')
  assert.ok(['proxy', 'free_source_total_return'].includes(audit.benchmark.status))
  assert.equal(audit.validationImpact.validationEvidenceStatusMustBeInsufficient, true)
  if (audit.benchmark.status === 'proxy') {
    assert.ok(audit.validationImpact.blockers.includes('total_return_benchmark_missing_or_proxy'))
  } else {
    assert.ok(!audit.validationImpact.blockers.includes('total_return_benchmark_missing_or_proxy'))
  }

  const completeInputs = ['600000', '601398', '000001'].map((symbol, index) => ({
    ...inputs[index],
    dividendRecords: [
      { year: 2023, dividendPerShare: 0.65, exDividendDate: '2024-06-10', payoutDate: '2024-06-20', evidenceRef: `verify:${symbol}:dividend:2023` },
      { year: 2024, dividendPerShare: 0.72, exDividendDate: '2025-06-10', payoutDate: '2025-06-20', evidenceRef: `verify:${symbol}:dividend:2024` },
      { year: 2025, dividendPerShare: 0.82, exDividendDate: '2026-06-10', payoutDate: '2026-06-20', evidenceRef: `verify:${symbol}:dividend:2025` },
    ],
    history: history(12 + index, 180, 0.002, true),
  }))
  const benchmarkSeries = history(1000, 180, 0.35).map((point) => ({
    date: point.date,
    value: point.close,
    evidenceRef: `verify:free-source:benchmark:${point.date}`,
  }))
  const completeBacktest = dividendLowVolBacktestService.run(completeInputs, {
    dividendReinvestment: true,
    benchmarkSeries,
    benchmarkName: 'Free-source H30269 total-return proxy series',
    benchmarkSource: 'free_source_fixture',
  }) as any
  const completeAudit = dividendLowVolTotalReturnAuditService.buildAudit(completeBacktest)
  assert.equal(completeAudit.benchmark.status, 'free_source_total_return')
  assert.equal(completeAudit.status, 'free_source_validation_ready')
  assert.equal(completeAudit.validationImpact.validationEvidenceStatusMustBeInsufficient, false)
  assert.deepEqual(completeAudit.validationImpact.blockers, [])
  console.log(JSON.stringify({
    ok: true,
    status: audit.status,
    completeStatus: completeAudit.status,
    returnComponents: audit.returnComponents,
    blockers: audit.validationImpact.blockers,
  }, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
