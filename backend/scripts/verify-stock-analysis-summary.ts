import assert from 'node:assert/strict'
import { stockAnalysisService } from '../src/services/technical/stockAnalysisService.js'

const analysis = await stockAnalysisService.getFullAnalysis('601127', 'A股', 80)

assert.equal(analysis.analysisSummary.schemaVersion, 'stock.analysis.summary.v1')
assert.equal(analysis.analysisSummary.technical.status, 'available')
assert.ok(analysis.analysisSummary.technical.evidenceRefs.length > 0)
assert.ok(analysis.analysisSummary.technical.evidenceRefs.every((ref) => (
  analysis.factSet.technical.facts.some((fact) => fact.id === ref)
)))
assert.ok(['partial', 'blocked'].includes(analysis.analysisSummary.fundamental.status))
assert.ok(
  analysis.analysisSummary.fundamental.status === 'blocked'
    ? analysis.analysisSummary.fundamental.blockedReasons.length > 0
    : analysis.analysisSummary.fundamental.evidenceRefs.length > 0
)
assert.equal(analysis.analysisSummary.fundamental.status, 'partial')
assert.ok(analysis.analysisSummary.fundamental.summary.includes('动态 PE='))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('同业对比'))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('财报复核'))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('独立来源复核'))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('公告原文'))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('PDF 表格抽取未接入'))
assert.ok(analysis.analysisSummary.fundamental.evidenceRefs.every((ref) => (
  analysis.factSet.fundamental.facts.some((fact) => fact.id === ref)
)))
assert.equal(analysis.analysisSummary.news.status, 'partial')
assert.ok(analysis.analysisSummary.news.blockedReasons.length > 0)

console.log(JSON.stringify({
  ok: true,
  overallStatus: analysis.analysisSummary.overallStatus,
  technical: analysis.analysisSummary.technical,
  fundamental: analysis.analysisSummary.fundamental,
  news: analysis.analysisSummary.news,
}, null, 2))
