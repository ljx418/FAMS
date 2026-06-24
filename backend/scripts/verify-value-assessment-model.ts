import assert from 'node:assert/strict'
import { prisma } from '../src/db/prisma.js'
import { valueAssessmentService } from '../src/services/valuation/valueAssessmentService.js'

async function main() {
  const batch = await valueAssessmentService.getPortfolioValueAssessments('default')

  assert.equal(batch.schemaVersion, 'value.assessment.batch.v1')
  assert.ok(batch.results.length > 0, 'expected at least one value assessment')

  const cashRows = batch.results.filter((item) => item.asset.assetType === 'cash')
  for (const row of cashRows) {
    assert.equal(row.valuation.status, 'not_applicable')
    assert.equal(row.valuation.conclusion, 'not_applicable')
  }

  const stockRows = batch.results.filter((item) => item.asset.assetType === 'stock')
  assert.ok(stockRows.length > 0, 'expected at least one stock assessment')
  for (const row of stockRows) {
    assert.equal(row.schemaVersion, 'value.assessment.factset.v1')
    assert.ok(row.facts.some((fact) => fact.id === 'pe_dynamic'), `${row.asset.symbol} missing PE fact`)
    assert.ok(row.facts.some((fact) => fact.id === 'pb'), `${row.asset.symbol} missing PB fact`)
    assert.ok(row.facts.some((fact) => fact.id === 'total_market_cap'), `${row.asset.symbol} missing market cap fact`)
    assert.ok(row.evidenceRefs.length > 0, `${row.asset.symbol} missing evidence refs`)
    assert.notEqual(row.valuation.conclusion, 'not_applicable')

    if (row.valuation.conclusion === 'insufficient') {
      assert.ok(row.valuation.targetWeightMultiplier <= 0.3, `${row.asset.symbol} insufficient assessment must reduce target multiplier`)
      assert.ok(row.valuation.blockedReasons.length > 0, `${row.asset.symbol} insufficient assessment must explain blockers`)
    }
  }

  const sample = stockRows.find((row) => row.asset.symbol === '601127') || stockRows[0]
  assert.ok(sample.valuation.method.includes('stock_relative_valuation'), 'unexpected stock valuation method')
  if (sample.asset.symbol === '601127') {
    const pe = sample.facts.find((fact) => fact.id === 'pe_dynamic')
    const pb = sample.facts.find((fact) => fact.id === 'pb')
    assert.equal(pe?.quality, 'ok', '601127 PE should be available or derived from audited facts')
    assert.equal(pb?.quality, 'ok', '601127 PB should be available or derived from audited facts')
    assert.ok(Number(pe.value) > 0, '601127 PE should be positive')
    assert.ok(Number(pb.value) > 0, '601127 PB should be positive')
    assert.ok(!sample.valuation.blockedReasons.includes('valuation_metrics_missing'), '601127 should not be blocked by missing valuation metrics')
  }

  console.log(JSON.stringify({
    ok: true,
    checked: batch.results.length,
    stockCount: stockRows.length,
    cashCount: cashRows.length,
    sample: {
      symbol: sample.asset.symbol,
      status: sample.valuation.status,
      conclusion: sample.valuation.conclusion,
      compositeScore: sample.valuation.compositeScore,
      confidence: sample.valuation.confidence,
      targetWeightMultiplier: sample.valuation.targetWeightMultiplier,
      blockedReasons: sample.valuation.blockedReasons,
      evidenceRefs: sample.evidenceRefs,
    },
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
