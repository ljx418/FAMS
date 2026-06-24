import assert from 'node:assert/strict'
import { fundamentalDataProvider } from '../src/services/technical/fundamentalDataProvider.js'
import { stockAnalysisService } from '../src/services/technical/stockAnalysisService.js'

const snapshot = await fundamentalDataProvider.getEastmoneyFundamentalSnapshot('601127', 'A股')
assert.equal(snapshot.provider, 'eastmoney')
assert.equal(snapshot.quality, 'ok', snapshot.warnings.join('; '))
if (snapshot.metrics.peDynamic !== undefined) {
  assert.ok(typeof snapshot.metrics.peDynamic === 'number', 'PE should be numeric when present')
}
if (snapshot.metrics.pb !== undefined) {
  assert.ok(typeof snapshot.metrics.pb === 'number', 'PB should be numeric when present')
}
if (snapshot.metrics.totalMarketCap !== undefined) {
  assert.ok(typeof snapshot.metrics.totalMarketCap === 'number', 'total market cap should be numeric when present')
}
assert.ok(snapshot.financialReports.length > 0, 'financial reports should be present')
const latestReport = snapshot.financialReports[0]
assert.ok(latestReport.reportDate, 'latest report date should be present')
assert.ok(typeof latestReport.operatingRevenue === 'number', 'operating revenue should be present')
assert.ok(typeof latestReport.parentNetProfit === 'number', 'parent net profit should be present')
assert.ok(typeof latestReport.roeWeighted === 'number', 'ROE should be present')
assert.ok(typeof latestReport.debtAssetRatio === 'number', 'debt asset ratio should be present')
assert.ok(snapshot.financialCrossCheck, 'financial cross check should be present')
assert.equal(snapshot.financialCrossCheck?.quality, 'ok', snapshot.financialCrossCheck?.warnings.join('; '))
assert.ok(snapshot.financialCrossCheck?.checks.length, 'financial cross check details should be present')
assert.ok(snapshot.financialCrossCheck?.checks.every((check) => check.status === 'pass'), 'financial cross checks should pass')
assert.ok(snapshot.independentFinancialCrossCheck, 'independent financial cross check should be present')
assert.equal(snapshot.independentFinancialCrossCheck?.quality, 'ok', snapshot.independentFinancialCrossCheck?.warnings.join('; '))
assert.ok(snapshot.independentFinancialCrossCheck?.checks.length, 'independent financial cross check details should be present')
assert.ok(snapshot.independentFinancialCrossCheck?.checks.every((check) => check.status === 'pass'), 'independent financial cross checks should pass')
assert.ok(snapshot.officialAnnouncement, 'official announcement reference should be present')
assert.equal(snapshot.officialAnnouncement?.quality, 'located', snapshot.officialAnnouncement?.warnings.join('; '))
assert.ok(snapshot.officialAnnouncement?.title?.includes('第一季度报告'), 'official announcement title should match quarter report')
assert.ok(snapshot.officialAnnouncement?.pdfUrl?.includes('static.sse.com.cn'), 'official announcement PDF should be an SSE static URL')
assert.ok(snapshot.industryComparison, 'industry comparison should be present')
assert.equal(snapshot.industryComparison?.boardCode, 'BK1262')
assert.ok((snapshot.industryComparison?.sampleSize || 0) >= 5, 'industry comparison sample should be usable')
assert.ok(typeof snapshot.industryComparison?.metrics.peDynamicPercentile === 'number', 'PE industry percentile should be present')
assert.ok(typeof snapshot.industryComparison?.metrics.pbPercentile === 'number', 'PB industry percentile should be present')
assert.ok(typeof snapshot.industryComparison?.metrics.roePercentile === 'number', 'ROE industry percentile should be present')

const analysis = await stockAnalysisService.getFullAnalysis('601127', 'A股', 80)
assert.equal(analysis.factSet.fundamental.quality, 'ok')
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_pe_dynamic' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_pb' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_operating_revenue' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_parent_net_profit' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_roe_weighted' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_financial_crosscheck_status' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_operating_revenue_crosscheck' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_parent_net_profit_crosscheck' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'independent_financial_crosscheck_status' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'sohu_operating_revenue_crosscheck' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'sohu_parent_net_profit_crosscheck' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'official_announcement_status' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'official_announcement_pdf_url' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_industry_board' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_industry_pe_percentile' && fact.quality === 'ok'))
assert.ok(analysis.factSet.fundamental.facts.some((fact) => fact.id === 'em_industry_roe_percentile' && fact.quality === 'ok'))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('营收='))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('ROE='))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('同业对比'))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('财报复核'))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('独立来源复核'))
assert.ok(analysis.analysisSummary.fundamental.summary.includes('公告原文'))
assert.equal(analysis.peRatio, analysis.fundamentalSnapshot.metrics.peDynamic)
assert.equal(analysis.pbRatio, analysis.fundamentalSnapshot.metrics.pb)

console.log(JSON.stringify({
  ok: true,
  symbol: '601127',
  provider: snapshot.providerLabel,
  peDynamic: snapshot.metrics.peDynamic,
  pb: snapshot.metrics.pb,
  totalMarketCap: snapshot.metrics.totalMarketCap,
  latestReport: {
    reportDate: latestReport.reportDate,
    reportName: latestReport.reportName,
    operatingRevenue: latestReport.operatingRevenue,
    operatingRevenueYoY: latestReport.operatingRevenueYoY,
    parentNetProfit: latestReport.parentNetProfit,
    parentNetProfitYoY: latestReport.parentNetProfitYoY,
    roeWeighted: latestReport.roeWeighted,
    debtAssetRatio: latestReport.debtAssetRatio,
    operatingCashFlow: latestReport.operatingCashFlow,
  },
  financialCrossCheck: {
    quality: snapshot.financialCrossCheck?.quality,
    matchedReportDate: snapshot.financialCrossCheck?.matchedReportDate,
    checks: snapshot.financialCrossCheck?.checks.map((check) => ({
      id: check.id,
      status: check.status,
      deltaPercent: check.deltaPercent,
    })),
  },
  independentFinancialCrossCheck: {
    quality: snapshot.independentFinancialCrossCheck?.quality,
    matchedReportDate: snapshot.independentFinancialCrossCheck?.matchedReportDate,
    checks: snapshot.independentFinancialCrossCheck?.checks.map((check) => ({
      id: check.id,
      status: check.status,
      deltaPercent: check.deltaPercent,
    })),
  },
  officialAnnouncement: {
    quality: snapshot.officialAnnouncement?.quality,
    title: snapshot.officialAnnouncement?.title,
    disclosureDate: snapshot.officialAnnouncement?.disclosureDate,
    pdfUrl: snapshot.officialAnnouncement?.pdfUrl,
  },
  industryComparison: {
    boardCode: snapshot.industryComparison?.boardCode,
    boardName: snapshot.industryComparison?.boardName,
    sampleSize: snapshot.industryComparison?.sampleSize,
    peDynamicPercentile: snapshot.industryComparison?.metrics.peDynamicPercentile,
    pbPercentile: snapshot.industryComparison?.metrics.pbPercentile,
    roePercentile: snapshot.industryComparison?.metrics.roePercentile,
    debtAssetRatioPercentile: snapshot.industryComparison?.metrics.debtAssetRatioPercentile,
  },
  fundamentalQuality: analysis.factSet.fundamental.quality,
  fundamentalFactCount: analysis.factSet.fundamental.facts.length,
}, null, 2))
