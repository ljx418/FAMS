import type { StockAnalysisFactSet, StockAnalysisFact } from './stockAnalysisFactSet.js'
import type { TechnicalAdviceModelOutput } from './technicalAdviceModelRegistry.js'

export interface StockAnalysisSummarySection {
  status: 'available' | 'partial' | 'blocked'
  summary: string
  evidenceRefs: string[]
  blockedReasons: string[]
}

export interface StockAnalysisSummary {
  schemaVersion: 'stock.analysis.summary.v1'
  generatedAt: string
  overallStatus: 'partial' | 'blocked'
  technical: StockAnalysisSummarySection
  fundamental: StockAnalysisSummarySection
  news: StockAnalysisSummarySection
  blockedReasons: string[]
}

function valueOf(facts: StockAnalysisFact[], id: string) {
  return facts.find((fact) => fact.id === id)?.value
}

function okFactIds(facts: StockAnalysisFact[]) {
  return facts.filter((fact) => fact.quality === 'ok').map((fact) => fact.id)
}

class StockAnalysisSummaryService {
  buildSummary(factSet: StockAnalysisFactSet, technicalAdvice: TechnicalAdviceModelOutput): StockAnalysisSummary {
    const technical = this.buildTechnicalSummary(technicalAdvice)
    const fundamental = this.buildFundamentalSummary(factSet)
    const news = this.buildNewsSummary(factSet)
    const blockedReasons = [
      ...technical.blockedReasons,
      ...fundamental.blockedReasons,
      ...news.blockedReasons,
    ]

    return {
      schemaVersion: 'stock.analysis.summary.v1',
      generatedAt: new Date().toISOString(),
      overallStatus: blockedReasons.length > 0 ? 'partial' : 'partial',
      technical,
      fundamental,
      news,
      blockedReasons,
    }
  }

  private buildTechnicalSummary(technicalAdvice: TechnicalAdviceModelOutput): StockAnalysisSummarySection {
    if (technicalAdvice.status !== 'available') {
      return {
        status: 'blocked',
        summary: '技术面数据未达到建议模型门槛。',
        evidenceRefs: technicalAdvice.evidenceRefs,
        blockedReasons: technicalAdvice.blockedReasons,
      }
    }

    return {
      status: 'available',
      summary: `${technicalAdvice.summary}：${technicalAdvice.observation}`,
      evidenceRefs: technicalAdvice.evidenceRefs,
      blockedReasons: [],
    }
  }

  private buildFundamentalSummary(factSet: StockAnalysisFactSet): StockAnalysisSummarySection {
    const facts = factSet.fundamental.facts
    const evidenceRefs = okFactIds(facts)
    if (factSet.fundamental.quality !== 'ok') {
      return {
        status: 'blocked',
        summary: '基本面事实不足，不能形成基本面结论。',
        evidenceRefs,
        blockedReasons: factSet.fundamental.warnings,
      }
    }

    const pe = valueOf(facts, 'em_pe_dynamic')
    const pb = valueOf(facts, 'em_pb')
    const marketCap = valueOf(facts, 'em_total_market_cap')
    const reportPeriod = valueOf(facts, 'em_report_period')
    const revenue = valueOf(facts, 'em_operating_revenue')
    const revenueYoY = valueOf(facts, 'em_operating_revenue_yoy')
    const netProfit = valueOf(facts, 'em_parent_net_profit')
    const netProfitYoY = valueOf(facts, 'em_parent_net_profit_yoy')
    const roe = valueOf(facts, 'em_roe_weighted')
    const debtRatio = valueOf(facts, 'em_debt_asset_ratio')
    const cashflow = valueOf(facts, 'em_operating_cashflow')
    const industryBoard = valueOf(facts, 'em_industry_board')
    const pePercentile = valueOf(facts, 'em_industry_pe_percentile')
    const pbPercentile = valueOf(facts, 'em_industry_pb_percentile')
    const roePercentile = valueOf(facts, 'em_industry_roe_percentile')
    const debtPercentile = valueOf(facts, 'em_industry_debt_percentile')
    const crossCheckStatus = valueOf(facts, 'em_financial_crosscheck_status')
    const independentCrossCheckStatus = valueOf(facts, 'independent_financial_crosscheck_status')
    const announcementStatus = valueOf(facts, 'official_announcement_status')
    const announcementTitle = valueOf(facts, 'official_announcement_title')
    return {
      status: 'partial',
      summary: `基本面快照：动态 PE=${pe ?? '--'}，PB=${pb ?? '--'}，总市值=${marketCap ?? '--'}；${reportPeriod ?? '最新财报'} 营收=${revenue ?? '--'}，营收同比=${revenueYoY ?? '--'}%，归母净利=${netProfit ?? '--'}，净利同比=${netProfitYoY ?? '--'}%，ROE=${roe ?? '--'}%，资产负债率=${debtRatio ?? '--'}%，经营现金流=${cashflow ?? '--'}。同业对比：${industryBoard ?? '行业未识别'}，PE低估分位=${pePercentile ?? '--'}%，PB低估分位=${pbPercentile ?? '--'}%，ROE分位=${roePercentile ?? '--'}%，负债率低位分位=${debtPercentile ?? '--'}%。财报复核：${crossCheckStatus ?? '未接入'}；独立来源复核：${independentCrossCheckStatus ?? '未接入'}；公告原文：${announcementStatus ?? '未定位'}${announcementTitle ? `，${announcementTitle}` : ''}；PDF 表格抽取未接入。`,
      evidenceRefs,
      blockedReasons: factSet.fundamental.warnings,
    }
  }

  private buildNewsSummary(factSet: StockAnalysisFactSet): StockAnalysisSummarySection {
    const facts = factSet.news.facts
    const evidenceRefs = okFactIds(facts)
    if (factSet.news.quality !== 'ok') {
      return {
        status: 'blocked',
        summary: '消息面事实不足，不能形成消息面结论。',
        evidenceRefs,
        blockedReasons: factSet.news.warnings,
      }
    }

    const negativeCount = facts.filter((fact) => String(fact.label).includes('negative')).length
    const positiveCount = facts.filter((fact) => String(fact.label).includes('positive')).length
    const neutralCount = facts.length - negativeCount - positiveCount
    return {
      status: 'partial',
      summary: `近端新闻事件 ${facts.length} 条：正面 ${positiveCount}、中性 ${neutralCount}、负面 ${negativeCount}；当前情绪为规则分类，未接入影响强度模型。`,
      evidenceRefs,
      blockedReasons: factSet.news.warnings,
    }
  }
}

export const stockAnalysisSummaryService = new StockAnalysisSummaryService()
