import { BuildDataGapInput, DataGap, DataGapAssetType } from './dataGapTypes.js'

type GapTemplate = Omit<DataGap, 'gapId' | 'assetId' | 'symbol' | 'assetName' | 'assetType' | 'evidenceRefs' | 'lastAttemptAt' | 'lastError'>

const COMMON_REQUIRED = ['research', 'observe', 'manual_trade_draft', 'formal_trade_action'] as const

const GAP_TEMPLATES: Record<string, GapTemplate> = {
  fundamental_factset_insufficient: {
    severity: 'degrading',
    category: 'fundamental',
    blockedReason: 'fundamental_factset_insufficient',
    missingFields: ['roe', 'grossMargin', 'netProfitGrowth', 'operatingCashFlow', 'debtRatio', 'financialReportPeriod'],
    requiredFor: [...COMMON_REQUIRED],
    userMessage: '股票基本面事实集不足，当前只能作为研究观察，不能支撑交易动作。',
    developerMessage: 'Refresh or build stock fundamental factset with profitability, growth, cashflow, leverage, and report period fields.',
    suggestedAction: '刷新或补齐股票基本面事实集，包含最近一期财报、ROE、毛利率、现金流和负债率。',
    providerCandidates: ['eastmoney_finance', 'akshare_finance', 'official_announcement'],
  },
  valuation_metrics_missing: {
    severity: 'degrading',
    category: 'valuation',
    blockedReason: 'valuation_metrics_missing',
    missingFields: ['pe', 'pb', 'marketCap', 'industryPercentile', 'historicalPercentile'],
    requiredFor: [...COMMON_REQUIRED],
    userMessage: '估值指标不足，不能仅依赖技术面或策略信号。',
    developerMessage: 'Populate valuation metrics and percentile context before using valuation confidence for higher-level actions.',
    suggestedAction: '补齐估值指标和行业/历史分位，不能仅依赖技术面评分。',
    providerCandidates: ['quote_list_canonical', 'eastmoney_valuation', 'stock_factset_cache'],
  },
  financial_report_missing: {
    severity: 'blocking',
    category: 'financial_report',
    blockedReason: 'financial_report_missing',
    missingFields: ['latestFinancialReport', 'reportDate', 'auditEvidenceRef'],
    requiredFor: ['manual_trade_draft', 'formal_trade_action'],
    userMessage: '缺少可审计财报证据，不能进入人工交易草案或正式交易动作。',
    developerMessage: 'Attach latest financial report evidence references and report date before manual trade draft.',
    suggestedAction: '接入或刷新财报原文/摘要证据，形成 evidenceRefs。',
    providerCandidates: ['official_announcement', 'exchange_disclosure', 'pdf_report_parser'],
  },
  fund_like_value_factset_missing: {
    severity: 'degrading',
    category: 'fund_factset',
    blockedReason: 'fund_like_value_factset_missing',
    missingFields: ['fundType', 'navHistory', 'drawdown', 'fee', 'manager', 'holdings', 'riskLevel'],
    requiredFor: [...COMMON_REQUIRED],
    userMessage: '基金/债基事实集不足，当前只能做净值和仓位层面的研究观察。',
    developerMessage: 'Populate fund NAV history, drawdown, fee, manager, holdings, and risk profile.',
    suggestedAction: '补齐基金类型、净值历史、回撤、费用、基金经理和持仓风格。',
    providerCandidates: ['eastmoney_fund', 'tiantian_fund', 'fund_official_report'],
  },
  fund_risk_level_missing: {
    severity: 'degrading',
    category: 'fund_factset',
    blockedReason: 'fund_risk_level_missing',
    missingFields: ['riskLevel', 'riskRatingSource', 'ratingDate'],
    requiredFor: [...COMMON_REQUIRED],
    userMessage: '基金风险等级缺少真实来源，当前不能把基金研究结果升级为交易动作。',
    developerMessage: 'Populate fund risk level/rating from a real fund provider or official document before higher-confidence workflow.',
    suggestedAction: '补齐基金风险等级、评级来源和评级日期，形成 evidenceRefs。',
    providerCandidates: ['eastmoney_fund_rating', 'fund_official_report', 'manual_audited_fund_profile'],
  },
  bond_duration_proxy_missing: {
    severity: 'degrading',
    category: 'fund_factset',
    blockedReason: 'bond_duration_proxy_missing',
    missingFields: ['durationProxy', 'yieldToMaturityProxy', 'maturityDistribution'],
    requiredFor: [...COMMON_REQUIRED],
    userMessage: '债基久期代理缺失，当前只能做净值、持仓和信用暴露层面的研究观察。',
    developerMessage: 'Populate bond duration/YTM/maturity distribution from a real provider or audited report.',
    suggestedAction: '补齐债基久期、到期收益率和期限结构代理。',
    providerCandidates: ['fund_official_report', 'eastmoney_fund_bond_holdings', 'manual_audited_bond_fund_profile'],
  },
  bond_credit_risk_proxy_missing: {
    severity: 'degrading',
    category: 'fund_factset',
    blockedReason: 'bond_credit_risk_proxy_missing',
    missingFields: ['creditRiskProxy', 'bondHoldingBreakdown', 'creditRiskFlags'],
    requiredFor: [...COMMON_REQUIRED],
    userMessage: '债基信用风险代理缺失，当前不能解释主要债券持仓信用暴露。',
    developerMessage: 'Populate top bond holdings and credit risk flags before improving bond fund research confidence.',
    suggestedAction: '补齐债基前十大债券持仓和信用风险代理。',
    providerCandidates: ['eastmoney_fund_bond_holdings', 'fund_official_report'],
  },
  bond_duration_credit_proxy_missing: {
    severity: 'degrading',
    category: 'fund_factset',
    blockedReason: 'bond_duration_credit_proxy_missing',
    missingFields: ['durationProxy', 'creditRiskProxy', 'bondHoldingBreakdown', 'yieldToMaturityProxy'],
    requiredFor: [...COMMON_REQUIRED],
    userMessage: '债基久期和信用风险代理缺失，当前只能做净值回撤层面的研究观察。',
    developerMessage: 'Legacy combined blocker. Prefer bond_duration_proxy_missing and bond_credit_risk_proxy_missing.',
    suggestedAction: '补齐债基久期、信用风险、券种结构和到期收益率代理。',
    providerCandidates: ['fund_official_report', 'eastmoney_fund_bond_holdings', 'manual_audited_bond_fund_profile'],
  },
  gold_macro_value_factset_missing: {
    severity: 'degrading',
    category: 'gold_macro',
    blockedReason: 'gold_macro_value_factset_missing',
    missingFields: ['goldPriceSource', 'realRateProxy', 'usdTrend', 'inflationExpectation', 'volatility', 'drawdown'],
    requiredFor: ['research', 'observe'],
    userMessage: '黄金宏观事实集不足，黄金不能套用股票估值模型。',
    developerMessage: 'Populate gold macro proxies and volatility/drawdown facts before raising confidence.',
    suggestedAction: '补齐黄金宏观事实集，注意黄金不能套用股票估值模型。',
    providerCandidates: ['eastmoney_gold', 'yahoo_gold', 'macro_proxy_cache'],
  },
  gold_usd_trend_proxy_missing: {
    severity: 'degrading',
    category: 'gold_macro',
    blockedReason: 'gold_usd_trend_proxy_missing',
    missingFields: ['usdTrendProxy', 'dxyHistory', 'dxyLatestDate'],
    requiredFor: ['research', 'observe'],
    userMessage: '黄金美元趋势代理缺失，当前不能解释美元走强/走弱对黄金的影响。',
    developerMessage: 'Populate DXY/USD trend proxy from a real market data provider.',
    suggestedAction: '补齐 DXY 或美元指数代理历史，并输出 evidenceRefs。',
    providerCandidates: ['yahoo_chart_DX-Y.NYB', 'nasdaq_UUP', 'macro_proxy_cache'],
  },
  gold_real_rate_proxy_missing: {
    severity: 'degrading',
    category: 'gold_macro',
    blockedReason: 'gold_real_rate_proxy_missing',
    missingFields: ['realRateProxy', 'tipsYield', 'realRateLatestDate'],
    requiredFor: ['research', 'observe'],
    userMessage: '黄金实际利率代理缺失，当前黄金宏观解释仍不完整。',
    developerMessage: 'Populate real-rate proxy from TIPS/FRED/official macro source.',
    suggestedAction: '补齐 TIPS 实际利率或等价宏观代理。',
    providerCandidates: ['fred_DFII10', 'official_macro_source', 'manual_audited_macro_proxy'],
  },
  gold_inflation_expectation_proxy_missing: {
    severity: 'degrading',
    category: 'gold_macro',
    blockedReason: 'gold_inflation_expectation_proxy_missing',
    missingFields: ['inflationExpectationProxy', 'breakevenInflation', 'inflationLatestDate'],
    requiredFor: ['research', 'observe'],
    userMessage: '黄金通胀预期代理缺失，当前黄金宏观解释仍不完整。',
    developerMessage: 'Populate inflation expectation proxy from breakeven inflation/FRED/official macro source.',
    suggestedAction: '补齐通胀预期或盈亏平衡通胀代理。',
    providerCandidates: ['fred_T10YIE', 'official_macro_source', 'manual_audited_macro_proxy'],
  },
  asset_identity_missing: {
    severity: 'blocking',
    category: 'asset_identity',
    blockedReason: 'asset_identity_missing',
    missingFields: ['assetId', 'assetType', 'market', 'exchange', 'name'],
    requiredFor: [...COMMON_REQUIRED],
    userMessage: '资产身份尚未完整确认，当前只能作为研究线索。',
    developerMessage: 'Resolve asset identity. Use lightweight research identity only when confidence is explicit; do not fabricate full asset facts.',
    suggestedAction: '调用 Asset Identity Resolver，创建 research identity 或明确标注无法识别。',
    providerCandidates: ['asset_identity_resolver', 'quote_list_canonical', 'local_asset_table'],
  },
  validation_evidence: {
    severity: 'blocking',
    category: 'validation_evidence',
    blockedReason: 'validation_evidence',
    missingFields: ['passedOosValidation', 'passedWalkForward', 'passedParameterSensitivity', 'passedRegimeRetest'],
    requiredFor: ['manual_trade_draft', 'formal_trade_action'],
    userMessage: 'validation_evidence 未通过，当前只允许研究和观察。',
    developerMessage: 'Re-run and audit validation evidence; do not release ADD/REDUCE before validation passes.',
    suggestedAction: '复跑并审计 validation evidence。未通过前只允许 RESEARCH / OBSERVE。',
    providerCandidates: ['strategy_tournament_run', 'validation_retest_audit'],
  },
  dividend_history_insufficient: {
    severity: 'degrading',
    category: 'fundamental',
    blockedReason: 'dividend_history_insufficient',
    missingFields: ['cashDividendPerShareHistory', 'exDividendDate', 'payoutDate', 'dividendEvidenceRefs'],
    requiredFor: ['research', 'observe', 'manual_trade_draft', 'formal_trade_action'],
    userMessage: '最近三年连续现金分红证据不足，红利低波策略不能把该标的作为有效红利候选。',
    developerMessage: 'Populate audited cash dividend records for the latest three fiscal years, including source URLs and evidence refs.',
    suggestedAction: '补齐近三年现金分红记录、除权日/派息日和来源链接；若免费源确认无现金分红，应写入 0 分红事实而不是留空。',
    providerCandidates: ['eastmoney_dividend', 'sse_szse_announcement', 'public_dividend_seed', 'tushare_upgrade_optional'],
  },
  dividend_yield_missing_or_zero: {
    severity: 'degrading',
    category: 'fundamental',
    blockedReason: 'dividend_yield_missing_or_zero',
    missingFields: ['ttmDividendYield', 'cashDividendPerShareTtm', 'latestPrice'],
    requiredFor: ['research', 'observe', 'manual_trade_draft', 'formal_trade_action'],
    userMessage: 'TTM 股息率无法确认，不能进入红利低波候选判断。',
    developerMessage: 'Derive TTM dividend yield from audited cash dividend per share and latest price, or record confirmed zero dividend evidence.',
    suggestedAction: '补齐 TTM 每股现金分红和最新价格；如公开源确认无现金分红，写入 0 股息率并按硬规则剔除。',
    providerCandidates: ['eastmoney_dividend', 'market_bar_canonical', 'quote_list_canonical', 'public_dividend_seed'],
  },
  dividend_low_vol_evidence_insufficient: {
    severity: 'degrading',
    category: 'fundamental',
    blockedReason: 'dividend_low_vol_evidence_insufficient',
    missingFields: ['dividendEvidenceRefs', 'fundamentalEvidenceRefs', 'marketHistoryEvidenceRefs'],
    requiredFor: ['research', 'observe'],
    userMessage: '红利低波策略证据质量不足，当前只能作为低置信研究线索。',
    developerMessage: 'Increase evidence quality by attaching dividend, fundamental, market history, and provider trace refs.',
    suggestedAction: '补齐分红、财务、行情和来源追踪 evidenceRefs 后重建候选池。',
    providerCandidates: ['eastmoney_dividend', 'eastmoney_finance', 'sina_history', 'market_bar_canonical'],
  },
  industry_leader_score_below_75: {
    severity: 'degrading',
    category: 'fundamental',
    blockedReason: 'industry_leader_score_below_75',
    missingFields: ['revenueRankScore', 'netProfitRankScore', 'roeIndustryPercentile', 'industryCrossCheckEvidence'],
    requiredFor: ['research', 'observe', 'manual_trade_draft', 'formal_trade_action'],
    userMessage: '行业龙头证据不足或龙头分未达标，不能进入建仓草案。',
    developerMessage: 'When classified as a data gap, populate revenue/net-profit/ROE industry rank evidence before treating leader score as final.',
    suggestedAction: '补齐行业归属、营收排名、净利润排名、ROE 行业分位和交叉验证 evidenceRefs。',
    providerCandidates: ['eastmoney_finance', 'baostock_industry', 'shenwan_industry', 'tushare_upgrade_optional'],
  },
  market_regime_retest_insufficient: {
    severity: 'blocking',
    category: 'validation_evidence',
    blockedReason: 'market_regime_retest_insufficient',
    missingFields: ['passedRegimeRetest', 'sufficientRegimeBuckets', 'sufficientValidationWindows'],
    requiredFor: ['manual_trade_draft', 'formal_trade_action'],
    userMessage: '市场状态复验证据不足，不能把策略结果转成交易动作。',
    developerMessage: 'Regime retest still has insufficient windows/buckets; keep research-only.',
    suggestedAction: '补充多窗口和市场状态复验样本，重新生成 validation evidence。',
    providerCandidates: ['oos_multi_window_regime_retest', 'market_feature_daily'],
  },
  universe_coverage: {
    severity: 'blocking',
    category: 'market_data',
    blockedReason: 'universe_coverage',
    missingFields: ['scanCoveragePercent', 'scannedUniverse', 'fullAUniverseCoverage'],
    requiredFor: ['research', 'observe', 'manual_trade_draft', 'formal_trade_action'],
    userMessage: '全 A 扫描覆盖不足，本次验证不能代表完整候选空间。',
    developerMessage: 'Increase long-sample scan coverage or use a complete canonical A-share universe before treating validation as representative.',
    suggestedAction: '扩大扫描上限或补齐全 A canonical 行情缓存，使 long-sample coverage 达到验收阈值。',
    providerCandidates: ['quote_list_canonical', 'market_bar_canonical', 'market_bar_cache_preheat'],
  },
  provider_success_rate: {
    severity: 'blocking',
    category: 'provider_health',
    blockedReason: 'provider_success_rate',
    missingFields: ['providerSuccessRate', 'successfulMarketDataFetches', 'providerFailureSummary'],
    requiredFor: ['research', 'observe', 'manual_trade_draft', 'formal_trade_action'],
    userMessage: '行情 provider 成功率不足，验证结果可能由数据缺失驱动。',
    developerMessage: 'Provider success rate is below readiness threshold; refresh cache/provider health before validation promotion.',
    suggestedAction: '先修复行情 provider 失败、超时或缓存缺口，再重复长样本验收。',
    providerCandidates: ['provider_health_report', 'market_bar_cache_preheat', 'market_data_coverage'],
  },
  cache_hit_rate: {
    severity: 'degrading',
    category: 'market_data',
    blockedReason: 'cache_hit_rate',
    missingFields: ['cacheHitRate', 'canonicalCoverage', 'warmupCoverage'],
    requiredFor: ['research', 'observe'],
    userMessage: '行情缓存命中率偏低，会降低验证效率和稳定性。',
    developerMessage: 'Cache hit rate is below desired threshold; warm up canonical cache before larger validation runs.',
    suggestedAction: '执行 market_bar_cache_preheat，提高 canonical K 线缓存覆盖后再复跑。',
    providerCandidates: ['market_bar_cache_preheat', 'market_bar_canonical'],
  },
  backtest_window: {
    severity: 'blocking',
    category: 'validation_evidence',
    blockedReason: 'backtest_window',
    missingFields: ['backtestDays', 'validationWindow', 'walkForwardWindows'],
    requiredFor: ['manual_trade_draft', 'formal_trade_action'],
    userMessage: '回测窗口不足，不能支撑人工交易草案或正式交易动作。',
    developerMessage: 'Backtest window is below readiness threshold; extend validation horizon without using future data.',
    suggestedAction: '扩展真实历史窗口，并重新生成 OOS、walk-forward 和参数敏感性验证。',
    providerCandidates: ['strategy_tournament_run', 'market_bar_canonical'],
  },
  trade_sample_size: {
    severity: 'blocking',
    category: 'validation_evidence',
    blockedReason: 'trade_sample_size',
    missingFields: ['bestSampleSize', 'tradeCount', 'candidateSampleSize'],
    requiredFor: ['manual_trade_draft', 'formal_trade_action'],
    userMessage: '可执行交易样本不足，当前统计置信度不够。',
    developerMessage: 'Executable trade sample size is below readiness threshold; expand universe/time window or retire sparse strategies.',
    suggestedAction: '扩大真实样本窗口、候选池和分层样本；样本仍不足的策略进入退役或研究观察。',
    providerCandidates: ['strategy_failure_matrix', 'strategy_remediation_report', 'strategy_tournament_run'],
  },
}

function normalizeAssetType(assetType?: string): DataGapAssetType {
  if (assetType === 'bond') return 'bond_fund'
  if (assetType === 'stock' || assetType === 'etf' || assetType === 'fund' || assetType === 'bond_fund' || assetType === 'gold' || assetType === 'cash') {
    return assetType
  }
  return 'unknown'
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

export class DataGapSummaryService {
  build(input: BuildDataGapInput): DataGap[] {
    const assetType = normalizeAssetType(input.assetType)
    return unique(input.blockedReasons).map((reason) => {
      const template = GAP_TEMPLATES[reason] || this.fallbackTemplate(reason)
      return {
        gapId: `${input.symbol || 'portfolio'}:${reason}`,
        assetId: input.assetId,
        symbol: input.symbol,
        assetName: input.assetName,
        assetType,
        ...template,
        evidenceRefs: unique(input.evidenceRefs || []),
        ...(input.lastAttemptAt ? { lastAttemptAt: input.lastAttemptAt } : {}),
        ...(input.lastError ? { lastError: input.lastError } : {}),
      }
    })
  }

  aggregate(gaps: DataGap[]) {
    const byCategory: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    for (const gap of gaps) {
      byCategory[gap.category] = (byCategory[gap.category] || 0) + 1
      bySeverity[gap.severity] = (bySeverity[gap.severity] || 0) + 1
    }
    return {
      total: gaps.length,
      blocking: bySeverity.blocking || 0,
      degrading: bySeverity.degrading || 0,
      optional: bySeverity.optional || 0,
      byCategory,
    }
  }

  private fallbackTemplate(reason: string): GapTemplate {
    const category = reason.includes('tradeability') ? 'tradeability'
      : reason.includes('provider') ? 'provider_health'
      : reason.includes('market') || reason.includes('technical') ? 'market_data'
      : reason.includes('news') ? 'news_event'
      : reason.includes('valuation') ? 'valuation'
      : 'market_data'
    return {
      severity: reason.includes('missing') || reason.includes('insufficient') ? 'degrading' : 'optional',
      category,
      blockedReason: reason,
      missingFields: [reason],
      requiredFor: ['research', 'observe'],
      userMessage: `存在数据缺口：${reason}。`,
      developerMessage: `Unmapped data gap: ${reason}. Add a structured mapping when this becomes a recurring blocker.`,
      suggestedAction: '补齐该缺口对应的事实数据，并写入 evidenceRefs。',
      providerCandidates: [],
    }
  }
}

export const dataGapSummaryService = new DataGapSummaryService()
