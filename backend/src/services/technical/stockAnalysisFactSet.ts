import type { ExternalTechnicalSnapshot } from './externalTechnicalDataProvider.js'
import type { FundamentalSnapshot } from './fundamentalDataProvider.js'
import type { NewsSnapshot } from './newsDataProvider.js'
import type { StockIndicators } from './stockAnalysisService.js'
import type { TechnicalAdviceModelOutput } from './technicalAdviceModelRegistry.js'

export type StockFactQuality = 'ok' | 'insufficient_data' | 'provider_failed'

export interface StockAnalysisFact {
  id: string
  section: 'technical' | 'fundamental' | 'news'
  label: string
  value: string | number | null
  source: string
  asOf: string | null
  quality: StockFactQuality
  evidenceType: 'external_indicator' | 'cross_source_check' | 'model_output' | 'local_audit' | 'missing_provider'
}

export interface StockAnalysisFactSection {
  quality: StockFactQuality
  facts: StockAnalysisFact[]
  warnings: string[]
}

export interface StockAnalysisFactSet {
  schemaVersion: 'stock.analysis.factset.v1'
  symbol: string
  market: string
  generatedAt: string
  technical: StockAnalysisFactSection
  fundamental: StockAnalysisFactSection
  news: StockAnalysisFactSection
}

function round(value: number | undefined, precision = 4) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

class StockAnalysisFactSetBuilder {
  buildTechnicalFactSet(params: {
    symbol: string
    market: string
    externalTechnical: ExternalTechnicalSnapshot
    localIndicators: StockIndicators
    technicalAdvice: TechnicalAdviceModelOutput
    fundamentalSnapshot?: FundamentalSnapshot
    newsSnapshot?: NewsSnapshot
  }): StockAnalysisFactSet {
    const { symbol, market, externalTechnical, localIndicators, technicalAdvice, fundamentalSnapshot, newsSnapshot } = params
    const asOf = externalTechnical.asOf || new Date().toISOString()
    const facts: StockAnalysisFact[] = [
      {
        id: 'tv_rating_all',
        section: 'technical',
        label: 'TradingView 综合评级',
        value: externalTechnical.rating ? `${externalTechnical.rating.all} (${round(externalTechnical.rating.allScore, 4)})` : null,
        source: externalTechnical.providerLabel,
        asOf,
        quality: externalTechnical.rating ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'tv_rating_ma',
        section: 'technical',
        label: 'TradingView 均线评级',
        value: externalTechnical.rating ? `${externalTechnical.rating.ma} (${round(externalTechnical.rating.maScore, 4)})` : null,
        source: externalTechnical.providerLabel,
        asOf,
        quality: externalTechnical.rating ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'tv_rating_oscillator',
        section: 'technical',
        label: 'TradingView 振荡器评级',
        value: externalTechnical.rating ? `${externalTechnical.rating.oscillator} (${round(externalTechnical.rating.oscillatorScore, 4)})` : null,
        source: externalTechnical.providerLabel,
        asOf,
        quality: externalTechnical.rating ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'tv_rsi14',
        section: 'technical',
        label: '外部 RSI14',
        value: round(externalTechnical.indicators.rsi14, 4),
        source: externalTechnical.providerLabel,
        asOf,
        quality: externalTechnical.indicators.rsi14 !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'tv_sma20',
        section: 'technical',
        label: '外部 SMA20',
        value: round(externalTechnical.indicators.sma20, 4),
        source: externalTechnical.providerLabel,
        asOf,
        quality: externalTechnical.indicators.sma20 !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'cross_source_confidence',
        section: 'technical',
        label: '多源可信度',
        value: `${externalTechnical.confidence.score}/${externalTechnical.confidence.level}`,
        source: 'FAMS cross-source validation',
        asOf,
        quality: externalTechnical.confidence.score >= 80 ? 'ok' : 'insufficient_data',
        evidenceType: 'cross_source_check',
      },
      {
        id: 'local_audit_rsi14',
        section: 'technical',
        label: '本地复核 RSI14',
        value: localIndicators.rsi,
        source: 'FAMS local audit',
        asOf,
        quality: 'ok',
        evidenceType: 'local_audit',
      },
      {
        id: 'technical_advice_model',
        section: 'technical',
        label: '技术建议模型输出',
        value: technicalAdvice.summary,
        source: technicalAdvice.model.id,
        asOf,
        quality: technicalAdvice.status === 'available' ? 'ok' : 'insufficient_data',
        evidenceType: 'model_output',
      },
    ]

    for (const check of externalTechnical.confidence.checks) {
      facts.push({
        id: `check_${check.name}`,
        section: 'technical',
        label: `交叉校验：${check.name}`,
        value: check.detail,
        source: 'FAMS cross-source validation',
        asOf,
        quality: check.status === 'fail' ? 'provider_failed' : check.status === 'warn' ? 'insufficient_data' : 'ok',
        evidenceType: 'cross_source_check',
      })
    }

    return {
      schemaVersion: 'stock.analysis.factset.v1',
      symbol,
      market,
      generatedAt: new Date().toISOString(),
      technical: {
        quality: facts.some((fact) => fact.quality === 'provider_failed')
          ? 'provider_failed'
          : facts.filter((fact) => fact.quality === 'ok').length >= 5
            ? 'ok'
            : 'insufficient_data',
        facts,
        warnings: [
          ...externalTechnical.warnings,
          ...technicalAdvice.blockedReasons,
        ],
      },
      fundamental: this.buildFundamentalSection(fundamentalSnapshot),
      news: this.buildNewsSection(newsSnapshot),
    }
  }

  private buildNewsSection(snapshot?: NewsSnapshot): StockAnalysisFactSection {
    if (!snapshot) {
      return {
        quality: 'insufficient_data',
        facts: [{
          id: 'news_provider_missing',
          section: 'news',
          label: '消息面 Provider',
          value: null,
          source: 'not_connected',
          asOf: null,
          quality: 'insufficient_data',
          evidenceType: 'missing_provider',
        }],
        warnings: ['消息面事实 Provider 尚未接入，禁止生成消息面结论。'],
      }
    }

    const facts: StockAnalysisFact[] = snapshot.events.slice(0, 6).map((event, index) => ({
      id: `news_${event.id || index}`,
      section: 'news',
      label: `${event.eventType} / ${event.sentiment}`,
      value: event.title,
      source: event.source,
      asOf: event.publishedAt,
      quality: 'ok',
      evidenceType: 'external_indicator',
    }))

    return {
      quality: snapshot.quality === 'ok'
        ? 'ok'
        : snapshot.quality === 'provider_failed'
          ? 'provider_failed'
          : 'insufficient_data',
      facts,
      warnings: [
        ...snapshot.warnings,
        '消息面当前仅接入新闻搜索事件流，情绪为规则分类；公告全文、权威公告源和影响强度模型尚未接入，不允许生成完整消息面结论。',
      ],
    }
  }

  private buildFundamentalSection(snapshot?: FundamentalSnapshot): StockAnalysisFactSection {
    if (!snapshot) {
      return {
        quality: 'insufficient_data',
        facts: [{
          id: 'fundamental_provider_missing',
          section: 'fundamental',
          label: '基本面 Provider',
          value: null,
          source: 'not_connected',
          asOf: null,
          quality: 'insufficient_data',
          evidenceType: 'missing_provider',
        }],
        warnings: ['基本面事实 Provider 尚未接入，禁止生成基本面结论。'],
      }
    }

    const asOf = snapshot.asOf
    const latestReport = snapshot.financialReports[0]
    const reportAsOf = latestReport?.reportDate || asOf
    const facts: StockAnalysisFact[] = [
      {
        id: 'em_pe_dynamic',
        section: 'fundamental',
        label: '动态市盈率 PE',
        value: round(snapshot.metrics.peDynamic, 4),
        source: snapshot.providerLabel,
        asOf,
        quality: snapshot.metrics.peDynamic !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'em_pb',
        section: 'fundamental',
        label: '市净率 PB',
        value: round(snapshot.metrics.pb, 4),
        source: snapshot.providerLabel,
        asOf,
        quality: snapshot.metrics.pb !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'em_total_market_cap',
        section: 'fundamental',
        label: '总市值',
        value: round(snapshot.metrics.totalMarketCap, 2),
        source: snapshot.providerLabel,
        asOf,
        quality: snapshot.metrics.totalMarketCap !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
      {
        id: 'em_float_market_cap',
        section: 'fundamental',
        label: '流通市值',
        value: round(snapshot.metrics.floatMarketCap, 2),
        source: snapshot.providerLabel,
        asOf,
        quality: snapshot.metrics.floatMarketCap !== undefined ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      },
    ]

    if (latestReport) {
      facts.push(
        {
          id: 'em_report_period',
          section: 'fundamental',
          label: '最新财报期',
          value: latestReport.reportName || latestReport.reportDate,
          source: `${snapshot.providerLabel} Financial Report`,
          asOf: reportAsOf,
          quality: 'ok',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_operating_revenue',
          section: 'fundamental',
          label: '营业收入',
          value: round(latestReport.operatingRevenue, 2),
          source: `${snapshot.providerLabel} Financial Report`,
          asOf: reportAsOf,
          quality: latestReport.operatingRevenue !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_operating_revenue_yoy',
          section: 'fundamental',
          label: '营业收入同比',
          value: round(latestReport.operatingRevenueYoY, 4),
          source: `${snapshot.providerLabel} Financial Report`,
          asOf: reportAsOf,
          quality: latestReport.operatingRevenueYoY !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_parent_net_profit',
          section: 'fundamental',
          label: '归母净利润',
          value: round(latestReport.parentNetProfit, 2),
          source: `${snapshot.providerLabel} Financial Report`,
          asOf: reportAsOf,
          quality: latestReport.parentNetProfit !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_parent_net_profit_yoy',
          section: 'fundamental',
          label: '归母净利润同比',
          value: round(latestReport.parentNetProfitYoY, 4),
          source: `${snapshot.providerLabel} Financial Report`,
          asOf: reportAsOf,
          quality: latestReport.parentNetProfitYoY !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_roe_weighted',
          section: 'fundamental',
          label: '净资产收益率 ROE',
          value: round(latestReport.roeWeighted, 4),
          source: `${snapshot.providerLabel} Financial Report`,
          asOf: reportAsOf,
          quality: latestReport.roeWeighted !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_gross_margin',
          section: 'fundamental',
          label: '销售毛利率',
          value: round(latestReport.grossMargin, 4),
          source: `${snapshot.providerLabel} Financial Report`,
          asOf: reportAsOf,
          quality: latestReport.grossMargin !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_debt_asset_ratio',
          section: 'fundamental',
          label: '资产负债率',
          value: round(latestReport.debtAssetRatio, 4),
          source: `${snapshot.providerLabel} Financial Report`,
          asOf: reportAsOf,
          quality: latestReport.debtAssetRatio !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_operating_cashflow',
          section: 'fundamental',
          label: '经营现金流净额',
          value: round(latestReport.operatingCashFlow, 2),
          source: `${snapshot.providerLabel} Financial Report`,
          asOf: reportAsOf,
          quality: latestReport.operatingCashFlow !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        }
      )
    }

    const industryBoard = snapshot.industryBoard
    const industryComparison = snapshot.industryComparison
    const financialCrossCheck = snapshot.financialCrossCheck
    const independentFinancialCrossCheck = snapshot.independentFinancialCrossCheck
    const officialAnnouncement = snapshot.officialAnnouncement
    if (financialCrossCheck) {
      const crossCheckAsOf = financialCrossCheck.asOf
      facts.push(
        {
          id: 'em_financial_crosscheck_status',
          section: 'fundamental',
          label: '财报复核状态',
          value: `${financialCrossCheck.quality} / ${financialCrossCheck.reportName}`,
          source: financialCrossCheck.providerLabel,
          asOf: crossCheckAsOf,
          quality: financialCrossCheck.quality === 'ok' ? 'ok' : financialCrossCheck.quality === 'failed' ? 'provider_failed' : 'insufficient_data',
          evidenceType: 'cross_source_check',
        },
        ...financialCrossCheck.checks.map((check) => ({
          id: `em_${check.id}`,
          section: 'fundamental' as const,
          label: check.label,
          value: check.deltaPercent === undefined
            ? null
            : `${check.status} / 差异 ${round(check.deltaPercent, 4)}%`,
          source: financialCrossCheck.providerLabel,
          asOf: crossCheckAsOf,
          quality: check.status === 'pass' ? 'ok' as const : check.status === 'fail' ? 'provider_failed' as const : 'insufficient_data' as const,
          evidenceType: 'cross_source_check' as const,
        }))
      )
    }

    if (independentFinancialCrossCheck) {
      const independentAsOf = independentFinancialCrossCheck.asOf
      facts.push(
        {
          id: 'independent_financial_crosscheck_status',
          section: 'fundamental',
          label: '独立来源财报复核状态',
          value: `${independentFinancialCrossCheck.quality} / ${independentFinancialCrossCheck.reportName}`,
          source: independentFinancialCrossCheck.providerLabel,
          asOf: independentAsOf,
          quality: independentFinancialCrossCheck.quality === 'ok' ? 'ok' : independentFinancialCrossCheck.quality === 'failed' ? 'provider_failed' : 'insufficient_data',
          evidenceType: 'cross_source_check',
        },
        ...independentFinancialCrossCheck.checks.map((check) => ({
          id: check.id,
          section: 'fundamental' as const,
          label: check.label,
          value: check.deltaPercent === undefined
            ? null
            : `${check.status} / 差异 ${round(check.deltaPercent, 4)}%`,
          source: independentFinancialCrossCheck.providerLabel,
          asOf: independentAsOf,
          quality: check.status === 'pass' ? 'ok' as const : check.status === 'fail' ? 'provider_failed' as const : 'insufficient_data' as const,
          evidenceType: 'cross_source_check' as const,
        }))
      )
    }

    if (officialAnnouncement) {
      const announcementAsOf = officialAnnouncement.asOf
      facts.push(
        {
          id: 'official_announcement_status',
          section: 'fundamental',
          label: '公告原文定位状态',
          value: `${officialAnnouncement.quality}${officialAnnouncement.pdfUrl ? ' / PDF' : ''}`,
          source: officialAnnouncement.providerLabel,
          asOf: announcementAsOf,
          quality: officialAnnouncement.quality === 'located' ? 'ok' : officialAnnouncement.quality === 'provider_failed' ? 'provider_failed' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'official_announcement_title',
          section: 'fundamental',
          label: '公告标题',
          value: officialAnnouncement.title || null,
          source: officialAnnouncement.providerLabel,
          asOf: announcementAsOf,
          quality: officialAnnouncement.title ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'official_announcement_disclosure_date',
          section: 'fundamental',
          label: '公告披露日期',
          value: officialAnnouncement.disclosureDate || null,
          source: officialAnnouncement.providerLabel,
          asOf: announcementAsOf,
          quality: officialAnnouncement.disclosureDate ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'official_announcement_pdf_url',
          section: 'fundamental',
          label: '公告 PDF 链接',
          value: officialAnnouncement.pdfUrl || null,
          source: officialAnnouncement.providerLabel,
          asOf: announcementAsOf,
          quality: officialAnnouncement.pdfUrl ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        }
      )
    }

    if (industryBoard) {
      facts.push({
        id: 'em_industry_board',
        section: 'fundamental',
        label: '行业板块',
        value: `${industryBoard.name}${industryBoard.code ? ` (${industryBoard.code})` : ''}`,
        source: industryBoard.providerLabel,
        asOf: industryBoard.asOf,
        quality: industryBoard.quality === 'ok' && industryBoard.name ? 'ok' : 'insufficient_data',
        evidenceType: 'external_indicator',
      })
    }

    if (industryComparison) {
      const industryAsOf = industryComparison.asOf
      facts.push(
        {
          id: 'em_industry_sample_size',
          section: 'fundamental',
          label: '同业样本数',
          value: industryComparison.sampleSize,
          source: `${snapshot.providerLabel} Industry`,
          asOf: industryAsOf,
          quality: industryComparison.sampleSize >= 5 ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_industry_pe_percentile',
          section: 'fundamental',
          label: 'PE 同业低估分位',
          value: round(industryComparison.metrics.peDynamicPercentile, 2),
          source: `${snapshot.providerLabel} Industry`,
          asOf: industryAsOf,
          quality: industryComparison.metrics.peDynamicPercentile !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_industry_pb_percentile',
          section: 'fundamental',
          label: 'PB 同业低估分位',
          value: round(industryComparison.metrics.pbPercentile, 2),
          source: `${snapshot.providerLabel} Industry`,
          asOf: industryAsOf,
          quality: industryComparison.metrics.pbPercentile !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_industry_market_cap_percentile',
          section: 'fundamental',
          label: '总市值同业分位',
          value: round(industryComparison.metrics.totalMarketCapPercentile, 2),
          source: `${snapshot.providerLabel} Industry`,
          asOf: industryAsOf,
          quality: industryComparison.metrics.totalMarketCapPercentile !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_industry_roe_percentile',
          section: 'fundamental',
          label: 'ROE 同业分位',
          value: round(industryComparison.metrics.roePercentile, 2),
          source: `${snapshot.providerLabel} Industry`,
          asOf: industryAsOf,
          quality: industryComparison.metrics.roePercentile !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        },
        {
          id: 'em_industry_debt_percentile',
          section: 'fundamental',
          label: '资产负债率同业低位分位',
          value: round(industryComparison.metrics.debtAssetRatioPercentile, 2),
          source: `${snapshot.providerLabel} Industry`,
          asOf: industryAsOf,
          quality: industryComparison.metrics.debtAssetRatioPercentile !== undefined ? 'ok' : 'insufficient_data',
          evidenceType: 'external_indicator',
        }
      )
    }

    const okCount = facts.filter((fact) => fact.quality === 'ok').length
    return {
      quality: snapshot.quality === 'ok' && okCount >= 8
        ? 'ok'
        : snapshot.quality === 'provider_failed'
          ? 'provider_failed'
          : 'insufficient_data',
      facts,
      warnings: [
        ...snapshot.warnings,
        '基本面已接入估值、市值、最新财报主指标、同厂不同接口财报复核、独立页面财报复核、公告原文链接定位和行业分位；审计意见、完整三表明细和公告 PDF 表格抽取尚未接入，完整基本面结论仍需受限。',
      ],
    }
  }
}

export const stockAnalysisFactSetBuilder = new StockAnalysisFactSetBuilder()
