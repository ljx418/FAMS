import type { DataGap } from './dataGapTypes.js'

export type DataGapRemediationAction = {
  actionId: string
  status: 'executable' | 'planned' | 'unsupported' | 'blocked_by_validation'
  category: string
  gapIds: string[]
  symbols: string[]
  operationType?: 'batch_factset_refresh' | 'fivd_r_validation_retest_audit' | 'fivd_r_asset_identity_resolution' | 'market_bar_cache_preheat'
  operationInput?: Record<string, unknown>
  userMessage: string
  developerMessage: string
  expectedArtifacts: string[]
  limitations: string[]
}

export type DataGapRemediationPlan = {
  schemaVersion: 'fivd.r.data_gap_remediation_plan.v1'
  generatedAt: string
  sourceRunId?: string | null
  summary: {
    totalGaps: number
    executableActions: number
    plannedActions: number
    unsupportedActions: number
    blockedByValidationActions: number
  }
  actions: DataGapRemediationAction[]
  auditOpinion: {
    severity: 'minor' | 'major'
    conclusion: string
  }
}

const STOCK_FACTSET_CATEGORIES = new Set(['fundamental', 'valuation', 'financial_report'])
const VALIDATION_CATEGORIES = new Set(['validation_evidence'])

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function normalizeSymbol(symbol?: string) {
  return String(symbol || '').trim().toUpperCase().replace(/\.(SH|SZ|BJ)$/, '')
}

class DataGapRemediationService {
  buildPlan(input: {
    gaps: DataGap[]
    userId: string
    sourceRunId?: string | null
  }): DataGapRemediationPlan {
    const generatedAt = new Date().toISOString()
    const gaps = Array.isArray(input.gaps) ? input.gaps : []
    const actions: DataGapRemediationAction[] = []

    const stockFactsetGaps = gaps.filter((gap) => STOCK_FACTSET_CATEGORIES.has(gap.category) && ['stock', 'unknown'].includes(gap.assetType))
    const stockSymbols = unique(stockFactsetGaps.map((gap) => normalizeSymbol(gap.symbol)))
    if (stockFactsetGaps.length > 0) {
      actions.push({
        actionId: 'refresh_stock_factset',
        status: stockSymbols.length > 0 ? 'executable' : 'planned',
        category: 'stock_factset',
        gapIds: stockFactsetGaps.map((gap) => gap.gapId),
        symbols: stockSymbols,
        operationType: stockSymbols.length > 0 ? 'batch_factset_refresh' : undefined,
        operationInput: stockSymbols.length > 0 ? {
          scope: 'stock_factset',
          symbols: stockSymbols,
          limit: stockSymbols.length,
        } : undefined,
        userMessage: stockSymbols.length > 0
          ? '可启动股票事实集刷新，补齐基本面、估值和部分财报摘要证据。'
          : '存在股票事实集缺口，但缺少 symbol，需先完成资产身份解析。',
        developerMessage: 'Uses existing batch_factset_refresh scope=stock_factset. It does not guarantee official PDF annual/interim report parsing.',
        expectedArtifacts: ['stock_factset_cache', 'stock.analysis.factset.v1', 'value.assessment.factset.v1'],
        limitations: [
          '该操作使用现有股票事实集刷新链路。',
          '若缺口要求财报原文/审计 PDF，当前仍需要后续 financial report parser/provider。',
          '刷新事实集不会改变 validation_evidence gate。',
        ],
      })
    }

    const validationGaps = gaps.filter((gap) => VALIDATION_CATEGORIES.has(gap.category) || gap.blockedReason === 'market_regime_retest_insufficient')
    if (validationGaps.length > 0) {
      actions.push({
        actionId: 'run_validation_retest_audit',
        status: 'executable',
        category: 'validation_evidence',
        gapIds: validationGaps.map((gap) => gap.gapId),
        symbols: [],
        operationType: 'fivd_r_validation_retest_audit',
        operationInput: { candidateLimit: 20 },
        userMessage: '可启动 validation retest audit，重新生成失败归因和 evidence taxonomy。',
        developerMessage: 'Runs FIVD-R validation retest audit. This explains or updates validation blockers but must not mark validation as passed unless real evidence passes.',
        expectedArtifacts: ['validation_evidence_retest_report.json', 'validation_failure_taxonomy.json'],
        limitations: [
          '复验审计不等于交易放行。',
          '如果 OOS、参数敏感性或市场状态仍失败，ADD/REDUCE 继续禁止。',
        ],
      })
    }

    const identityGaps = gaps.filter((gap) => gap.category === 'asset_identity')
    const identitySymbols = unique(identityGaps.map((gap) => normalizeSymbol(gap.symbol)))
    if (identityGaps.length > 0) {
      actions.push({
        actionId: 'resolve_asset_identity',
        status: identitySymbols.length > 0 ? 'executable' : 'planned',
        category: 'asset_identity',
        gapIds: identityGaps.map((gap) => gap.gapId),
        symbols: identitySymbols,
        operationType: identitySymbols.length > 0 ? 'fivd_r_asset_identity_resolution' : undefined,
        operationInput: identitySymbols.length > 0 ? {
          symbols: identitySymbols,
        } : undefined,
        userMessage: identitySymbols.length > 0
          ? '可执行资产身份解析，生成可审计 research identity artifact。'
          : '需要执行资产身份解析，但当前 gap 缺少 symbol，需先补齐候选代码。',
        developerMessage: 'Runs FIVD-R asset identity resolution report. It may create lightweight research identity but must not create official Asset records.',
        expectedArtifacts: ['asset_identity_resolution_report.json', 'research_asset_identity'],
        limitations: [
          '不能为了评分伪造完整资产事实。',
          '本动作不自动写入正式资产账本。',
        ],
      })
    }

    const fundGaps = gaps.filter((gap) => gap.category === 'fund_factset')
    if (fundGaps.length > 0) {
      actions.push({
        actionId: 'refresh_fund_factset',
        status: 'unsupported',
        category: 'fund_factset',
        gapIds: fundGaps.map((gap) => gap.gapId),
        symbols: unique(fundGaps.map((gap) => normalizeSymbol(gap.symbol))),
        userMessage: '基金/债基事实集缺口已识别，但当前还没有完整 fund factset refresh Operation。',
        developerMessage: 'Implement NAV history/drawdown/fee/manager/holdings provider before this can be executable.',
        expectedArtifacts: ['fund_factset_report.json'],
        limitations: ['当前只能提示缺口，不能自动补齐基金经理、费用、持仓风格等事实。'],
      })
    }

    const goldGaps = gaps.filter((gap) => gap.category === 'gold_macro')
    if (goldGaps.length > 0) {
      actions.push({
        actionId: 'refresh_gold_macro_factset',
        status: 'unsupported',
        category: 'gold_macro',
        gapIds: goldGaps.map((gap) => gap.gapId),
        symbols: unique(goldGaps.map((gap) => normalizeSymbol(gap.symbol))),
        userMessage: '黄金宏观事实集缺口已识别，但当前还没有完整 gold macro factset refresh Operation。',
        developerMessage: 'Implement gold price source, real-rate proxy, USD trend, inflation expectations, volatility and drawdown provider.',
        expectedArtifacts: ['gold_macro_factset_report.json'],
        limitations: ['当前不能把黄金套用股票估值模型，也不能伪造宏观代理数据。'],
      })
    }

    const marketDataGaps = gaps.filter((gap) => gap.category === 'market_data' || gap.category === 'provider_health')
    const marketDataSymbols = unique(marketDataGaps.map((gap) => normalizeSymbol(gap.symbol)))
    if (marketDataGaps.length > 0) {
      actions.push({
        actionId: 'refresh_market_data_cache',
        status: marketDataSymbols.length > 0 ? 'executable' : 'planned',
        category: 'market_data',
        gapIds: marketDataGaps.map((gap) => gap.gapId),
        symbols: marketDataSymbols,
        operationType: marketDataSymbols.length > 0 ? 'market_bar_cache_preheat' : undefined,
        operationInput: marketDataSymbols.length > 0 ? {
          symbols: marketDataSymbols,
          limit: marketDataSymbols.length,
          days: 120,
          chunkSize: Math.min(20, Math.max(1, marketDataSymbols.length)),
          concurrency: 2,
          forceRefresh: false,
          executionMode: 'queued',
        } : undefined,
        userMessage: marketDataSymbols.length > 0
          ? '可启动 symbol 级行情缓存预热，补齐 K 线覆盖和 market_feature_daily。'
          : '行情/Provider 缺口已识别，但缺少 symbol，需先完成资产身份解析。',
        developerMessage: 'Runs market_bar_cache_preheat with provided symbols. It only warms market bars/features and does not fill valuation/fundamental reports.',
        expectedArtifacts: ['market_bar_cache_preheat_report.json', 'market_data_coverage'],
        limitations: [
          '该操作只补行情缓存和技术特征，不补基本面、估值或财报事实集。',
          'Provider 失败或历史样本不足时必须保持 partial/failed，不允许伪造成 sufficient。',
        ],
      })
    }

    const executableActions = actions.filter((action) => action.status === 'executable').length
    const plannedActions = actions.filter((action) => action.status === 'planned').length
    const unsupportedActions = actions.filter((action) => action.status === 'unsupported').length
    const blockedByValidationActions = actions.filter((action) => action.status === 'blocked_by_validation').length

    return {
      schemaVersion: 'fivd.r.data_gap_remediation_plan.v1',
      generatedAt,
      sourceRunId: input.sourceRunId || null,
      summary: {
        totalGaps: gaps.length,
        executableActions,
        plannedActions,
        unsupportedActions,
        blockedByValidationActions,
      },
      actions,
      auditOpinion: {
        severity: unsupportedActions > 0 || plannedActions > 0 ? 'major' : 'minor',
        conclusion: unsupportedActions > 0 || plannedActions > 0
          ? '部分数据缺口只有计划或尚无执行器，不能宣称事实集缺口已闭环。'
          : '当前识别的数据缺口均有可执行补数或复验动作。',
      },
    }
  }
}

export const dataGapRemediationService = new DataGapRemediationService()
