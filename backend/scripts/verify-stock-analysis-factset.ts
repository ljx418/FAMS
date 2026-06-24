import assert from 'node:assert/strict'
import { stockAnalysisService } from '../src/services/technical/stockAnalysisService.js'

const analysis = await stockAnalysisService.getFullAnalysis('601127', 'A股', 80)

assert.equal(analysis.factSet.schemaVersion, 'stock.analysis.factset.v1')
assert.equal(analysis.factSet.symbol, '601127')
assert.equal(analysis.factSet.technical.quality, 'ok')
assert.equal(analysis.factSet.fundamental.quality, 'ok')
assert.equal(analysis.factSet.news.quality, 'ok')
assert.ok(analysis.factSet.technical.facts.some((fact) => fact.id === 'tv_rating_all'))
assert.ok(analysis.factSet.technical.facts.some((fact) => fact.id === 'cross_source_confidence'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_operating_revenue'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_parent_net_profit'))
assert.ok(analysis.factSet.news.facts.length > 0)
assert.ok(analysis.technicalAdvice.evidenceRefs.every((ref) => (
  analysis.factSet.technical.facts.some((fact) => fact.id === ref)
)))

console.log(JSON.stringify({
  ok: true,
  symbol: analysis.factSet.symbol,
  technicalQuality: analysis.factSet.technical.quality,
  technicalFactCount: analysis.factSet.technical.facts.length,
  fundamentalQuality: analysis.factSet.fundamental.quality,
  fundamentalFactCount: analysis.factSet.fundamental.facts.length,
  newsQuality: analysis.factSet.news.quality,
  newsFactCount: analysis.factSet.news.facts.length,
  evidenceRefs: analysis.technicalAdvice.evidenceRefs,
}, null, 2))
