import axios from 'axios'

export type DividendLowVolFreshnessStatus = 'fresh' | 'stale' | 'unknown'
export type DividendLowVolCoverageStatus = 'available' | 'partial' | 'missing' | 'blocked'

export interface DividendLowVolProviderFieldContract {
  field: string
  provider: 'tushare_pro' | 'sse_szse_disclosure' | 'baostock_free' | 'internal_cache'
  sourceTable: string
  endpoint: string
  asOfDate: string | null
  fetchedAt: string | null
  freshnessStatus: DividendLowVolFreshnessStatus
  evidenceRefs: string[]
  coverageStatus: DividendLowVolCoverageStatus
  blockedReason?: string
}

export interface DividendLowVolFormalProviderIngestionOptions {
  symbols?: string[]
  tradeDate?: string
  reportPeriod?: string
  dryRun?: boolean
}

type TushareEndpointPlan = {
  apiName: string
  sourceTable: string
  fields: string
  params: (options: Required<Pick<DividendLowVolFormalProviderIngestionOptions, 'tradeDate' | 'reportPeriod'>> & { tsCodes: string[] }) => Record<string, unknown>
  contractFields: string[]
}

const REQUIRED_CONTRACTS: Array<Omit<DividendLowVolProviderFieldContract, 'asOfDate' | 'fetchedAt' | 'freshnessStatus' | 'evidenceRefs' | 'coverageStatus' | 'blockedReason'>> = [
  { field: 'dividend_history', provider: 'tushare_pro', sourceTable: 'dividend', endpoint: 'pro.dividend' },
  { field: 'cash_dividend_per_share', provider: 'tushare_pro', sourceTable: 'dividend', endpoint: 'pro.dividend' },
  { field: 'income_revenue', provider: 'tushare_pro', sourceTable: 'income', endpoint: 'pro.income' },
  { field: 'income_net_profit', provider: 'tushare_pro', sourceTable: 'income', endpoint: 'pro.income' },
  { field: 'cashflow_operating_cash_flow', provider: 'tushare_pro', sourceTable: 'cashflow', endpoint: 'pro.cashflow' },
  { field: 'balance_sheet_debt_ratio', provider: 'tushare_pro', sourceTable: 'balancesheet', endpoint: 'pro.balancesheet' },
  { field: 'fina_indicator_roe', provider: 'tushare_pro', sourceTable: 'fina_indicator', endpoint: 'pro.fina_indicator' },
  { field: 'daily_basic_market_cap', provider: 'tushare_pro', sourceTable: 'daily_basic', endpoint: 'pro.daily_basic' },
  { field: 'daily_basic_pe_pb_dividend_yield', provider: 'tushare_pro', sourceTable: 'daily_basic', endpoint: 'pro.daily_basic' },
  { field: 'stk_limit_limit_up_down', provider: 'tushare_pro', sourceTable: 'stk_limit', endpoint: 'pro.stk_limit' },
  { field: 'shenwan_industry_classification', provider: 'tushare_pro', sourceTable: 'index_classify/index_member_all', endpoint: 'pro.index_classify/pro.index_member_all' },
]

const TUSHARE_ENDPOINT_PLANS: TushareEndpointPlan[] = [
  {
    apiName: 'dividend',
    sourceTable: 'dividend',
    fields: 'ts_code,end_date,ann_date,record_date,ex_date,pay_date,div_proc,stk_div,cash_div,cash_div_tax',
    params: ({ reportPeriod }) => ({ end_date: reportPeriod }),
    contractFields: ['dividend_history', 'cash_dividend_per_share'],
  },
  {
    apiName: 'income',
    sourceTable: 'income',
    fields: 'ts_code,end_date,revenue,n_income_attr_p',
    params: ({ reportPeriod }) => ({ period: reportPeriod }),
    contractFields: ['income_revenue', 'income_net_profit'],
  },
  {
    apiName: 'cashflow',
    sourceTable: 'cashflow',
    fields: 'ts_code,end_date,n_cashflow_act',
    params: ({ reportPeriod }) => ({ period: reportPeriod }),
    contractFields: ['cashflow_operating_cash_flow'],
  },
  {
    apiName: 'balancesheet',
    sourceTable: 'balancesheet',
    fields: 'ts_code,end_date,total_assets,total_liab',
    params: ({ reportPeriod }) => ({ period: reportPeriod }),
    contractFields: ['balance_sheet_debt_ratio'],
  },
  {
    apiName: 'fina_indicator',
    sourceTable: 'fina_indicator',
    fields: 'ts_code,end_date,roe,roe_waa,debt_to_assets',
    params: ({ reportPeriod }) => ({ period: reportPeriod }),
    contractFields: ['fina_indicator_roe'],
  },
  {
    apiName: 'daily_basic',
    sourceTable: 'daily_basic',
    fields: 'ts_code,trade_date,close,turnover_rate,pe,pb,total_mv,circ_mv,dv_ratio,dv_ttm',
    params: ({ tradeDate }) => ({ trade_date: tradeDate }),
    contractFields: ['daily_basic_market_cap', 'daily_basic_pe_pb_dividend_yield'],
  },
  {
    apiName: 'stk_limit',
    sourceTable: 'stk_limit',
    fields: 'ts_code,trade_date,up_limit,down_limit',
    params: ({ tradeDate }) => ({ trade_date: tradeDate }),
    contractFields: ['stk_limit_limit_up_down'],
  },
  {
    apiName: 'index_classify',
    sourceTable: 'index_classify/index_member_all',
    fields: 'index_code,industry_name,level,industry_code,src',
    params: () => ({ src: 'SW2021' }),
    contractFields: ['shenwan_industry_classification'],
  },
]

function toTushareCode(symbol: string) {
  const normalized = String(symbol || '').trim()
  if (/^(6|9)/.test(normalized)) return `${normalized}.SH`
  if (/^(8|4)/.test(normalized)) return `${normalized}.BJ`
  return `${normalized}.SZ`
}

function yyyymmdd(value: string | undefined, fallback: Date) {
  const raw = value && /^\d{4}-?\d{2}-?\d{2}$/.test(value) ? value : fallback.toISOString().slice(0, 10)
  return raw.replace(/-/g, '')
}

function latestAnnualPeriod(now = new Date()) {
  const year = now.getUTCFullYear() - 1
  return `${year}1231`
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class DividendLowVolFormalProviderIngestionService {
  private getToken() {
    return process.env.FAMS_TUSHARE_TOKEN || process.env.TUSHARE_TOKEN || ''
  }

  providerConfigured() {
    return Boolean(this.getToken())
  }

  redactedConfig() {
    return {
      schemaVersion: 'dividend.low_vol.formal_provider_config.v1',
      generatedAt: new Date().toISOString(),
      providers: [
        {
          provider: 'tushare_pro',
          configured: this.providerConfigured(),
          tokenRedacted: this.providerConfigured() ? 'configured_redacted' : 'missing',
          tokenInAuditPackage: false,
          rateLimit: {
            maxBatchSize: 200,
            minDelayMs: 350,
            retryCount: 3,
            backoff: 'exponential',
          },
        },
        {
          provider: 'sse_szse_disclosure',
          configured: false,
          tokenRedacted: 'not_required_for_public_pages',
          tokenInAuditPackage: false,
          rateLimit: {
            maxBatchSize: 50,
            minDelayMs: 500,
            retryCount: 2,
            backoff: 'linear',
          },
        },
      ],
    }
  }

  fieldContracts(): DividendLowVolProviderFieldContract[] {
    const configured = this.providerConfigured()
    const fetchedAt = configured ? new Date().toISOString() : null
    return REQUIRED_CONTRACTS.map((contract) => ({
      ...contract,
      asOfDate: null,
      fetchedAt,
      freshnessStatus: configured ? 'unknown' : 'unknown',
      evidenceRefs: configured ? [`provider-contract:${contract.provider}:${contract.sourceTable}:${contract.field}`] : [],
      coverageStatus: configured ? 'partial' : 'missing',
      blockedReason: configured ? 'ingestion_skeleton_no_full_batch_loaded' : 'formal_provider_token_missing',
    }))
  }

  buildAudit() {
    const contracts = this.fieldContracts()
    return {
      schemaVersion: 'dividend.low_vol.provider_ingestion_audit.v1',
      generatedAt: new Date().toISOString(),
      strategyFamily: 'dividend_low_volatility',
      strategyId: 'dividend_low_vol_leader_v1',
      status: this.providerConfigured() ? 'configured_skeleton_no_full_ingestion' : 'blocked_provider_not_configured',
      notTradingAdvice: true,
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      formalProviderConfig: this.redactedConfig(),
      retryBackoffPolicy: {
        retryCount: 3,
        initialDelayMs: 350,
        maxDelayMs: 5000,
        jitter: true,
        timeoutHandling: 'provider_timeout_recorded_as_data_gap_not_silently_ignored',
      },
      fieldContracts: contracts,
      summary: {
        totalFields: contracts.length,
        available: contracts.filter((item) => item.coverageStatus === 'available').length,
        partial: contracts.filter((item) => item.coverageStatus === 'partial').length,
        missing: contracts.filter((item) => item.coverageStatus === 'missing').length,
        blocked: contracts.filter((item) => item.coverageStatus === 'blocked').length,
      },
      decision: {
        canMarkProviderFallbackVerified: false,
        canMarkIndustryLeaderVerified: this.providerConfigured() && contracts.every((item) => item.coverageStatus === 'available'),
        reason: this.providerConfigured() ? 'skeleton_ready_but_full_ingestion_not_completed' : 'formal_provider_token_missing',
      },
    }
  }

  async runTushareProbe(options: DividendLowVolFormalProviderIngestionOptions = {}) {
    const generatedAt = new Date().toISOString()
    const symbols = Array.from(new Set((options.symbols || ['000001', '600000'])
      .map((item) => String(item).trim())
      .filter((item) => /^\d{6}$/.test(item))))
    const tradeDate = yyyymmdd(options.tradeDate, new Date())
    const reportPeriod = options.reportPeriod && /^\d{8}$/.test(options.reportPeriod)
      ? options.reportPeriod
      : latestAnnualPeriod()
    if (!this.providerConfigured() && options.dryRun !== true) {
      return {
        schemaVersion: 'dividend.low_vol.tushare_provider_ingestion_run.v1',
        generatedAt,
        strategyFamily: 'dividend_low_volatility',
        strategyId: 'dividend_low_vol_leader_v1',
        status: 'blocked_provider_not_configured',
        dryRun: false,
        tokenInAuditPackage: false,
        requestedSymbols: symbols,
        tradeDate,
        reportPeriod,
        endpointResults: [],
        fieldContracts: this.fieldContracts(),
        summary: {
          endpointsAttempted: 0,
          endpointsSucceeded: 0,
          endpointsFailed: 0,
          rowsReturned: 0,
          availableFields: 0,
          missingFields: REQUIRED_CONTRACTS.length,
        },
        allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
        prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
        notTradingAdvice: true,
        nextActions: ['Configure FAMS_TUSHARE_TOKEN or TUSHARE_TOKEN, then rerun npm run run:dividend-low-vol-provider-ingestion.'],
      }
    }

    const tsCodes = symbols.map(toTushareCode)
    const endpointResults = []
    const fieldCoverage = new Map(REQUIRED_CONTRACTS.map((contract) => [contract.field, {
      rowsReturned: 0,
      endpoint: contract.endpoint,
      sourceTable: contract.sourceTable,
      evidenceRefs: [] as string[],
    }]))
    const minDelayMs = 350
    for (const plan of TUSHARE_ENDPOINT_PLANS) {
      const startedAt = Date.now()
      try {
        const rows = options.dryRun === true
          ? []
          : await this.callTushare(plan.apiName, {
            ...plan.params({ tradeDate, reportPeriod, tsCodes }),
            ...(plan.apiName === 'index_classify' ? {} : { ts_code: tsCodes[0] }),
          }, plan.fields)
        const rowCount = rows.length
        for (const field of plan.contractFields) {
          const current = fieldCoverage.get(field)
          if (current) {
            current.rowsReturned += rowCount
            current.evidenceRefs.push(`tushare:${plan.apiName}:${field}:${tradeDate}:${reportPeriod}`)
          }
        }
        endpointResults.push({
          provider: 'tushare_pro',
          apiName: plan.apiName,
          sourceTable: plan.sourceTable,
          status: 'succeeded',
          rowsReturned: rowCount,
          elapsedMs: Date.now() - startedAt,
          evidenceRef: `tushare:${plan.apiName}:${tradeDate}:${reportPeriod}`,
          fields: plan.contractFields,
        })
      } catch (error) {
        endpointResults.push({
          provider: 'tushare_pro',
          apiName: plan.apiName,
          sourceTable: plan.sourceTable,
          status: 'failed',
          rowsReturned: 0,
          elapsedMs: Date.now() - startedAt,
          errorCategory: this.categorizeProviderError(error),
          errorMessage: error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240),
          fields: plan.contractFields,
        })
      }
      await delay(minDelayMs)
    }

    const fieldContracts = REQUIRED_CONTRACTS.map((contract) => {
      const coverage = fieldCoverage.get(contract.field)
      const rowsReturned = coverage?.rowsReturned || 0
      return {
        ...contract,
        asOfDate: contract.sourceTable.includes('daily') || contract.sourceTable === 'stk_limit' ? tradeDate : reportPeriod,
        fetchedAt: generatedAt,
        freshnessStatus: rowsReturned > 0 ? 'fresh' as const : 'unknown' as const,
        evidenceRefs: coverage?.evidenceRefs || [],
        coverageStatus: rowsReturned > 0 ? 'available' as const : 'missing' as const,
        blockedReason: rowsReturned > 0 ? undefined : 'provider_returned_no_rows_or_endpoint_failed',
      }
    })
    const endpointsSucceeded = endpointResults.filter((item) => item.status === 'succeeded').length
    const rowsReturned = endpointResults.reduce((sum, item) => sum + item.rowsReturned, 0)
    const availableFields = fieldContracts.filter((item) => item.coverageStatus === 'available').length
    return {
      schemaVersion: 'dividend.low_vol.tushare_provider_ingestion_run.v1',
      generatedAt,
      strategyFamily: 'dividend_low_volatility',
      strategyId: 'dividend_low_vol_leader_v1',
      status: options.dryRun === true && !this.providerConfigured()
        ? 'dry_run_contract_only'
        : availableFields === REQUIRED_CONTRACTS.length
        ? 'completed_field_contracts_available'
        : availableFields > 0
          ? 'partial_provider_coverage'
          : 'blocked_no_provider_rows',
      dryRun: options.dryRun === true,
      tokenInAuditPackage: false,
      requestedSymbols: symbols,
      tradeDate,
      reportPeriod,
      endpointResults,
      fieldContracts,
      summary: {
        endpointsAttempted: endpointResults.length,
        endpointsSucceeded,
        endpointsFailed: endpointResults.length - endpointsSucceeded,
        rowsReturned,
        availableFields,
        missingFields: fieldContracts.filter((item) => item.coverageStatus !== 'available').length,
      },
      allowedActions: ['RESEARCH', 'OBSERVE', 'ALERT', 'PLAN_DRAFT'],
      prohibitedActions: ['ADD', 'REDUCE', 'AUTO_TRADE'],
      notTradingAdvice: true,
      decision: {
        canMarkProviderFallbackVerified: false,
        canMarkIndustryLeaderVerified: availableFields === REQUIRED_CONTRACTS.length,
        formalTradeActionAllowed: false,
        autoTradeAllowed: false,
      },
    }
  }

  private async callTushare(apiName: string, params: Record<string, unknown>, fields: string): Promise<Array<Record<string, unknown>>> {
    const token = this.getToken()
    if (!token) throw new Error('formal_provider_token_missing')
    const response = await axios.post('http://api.tushare.pro', {
      api_name: apiName,
      token,
      params,
      fields,
    }, { timeout: 15000 })
    const data = response.data
    if (!data || data.code !== 0 || !data.data) {
      throw new Error(`Tushare ${apiName} failed: ${data?.msg || data?.code || 'unknown_error'}`)
    }
    const fieldsList = Array.isArray(data.data.fields) ? data.data.fields : []
    return (data.data.items || []).map((item: unknown[]) => Object.fromEntries(fieldsList.map((field: string, index: number) => [field, item[index]])))
  }

  private categorizeProviderError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (/timeout|ETIMEDOUT|ECONNABORTED/i.test(message)) return 'provider_timeout'
    if (/permission|积分|权限|token|invalid/i.test(message)) return 'provider_permission_or_token'
    if (/no rows|empty/i.test(message)) return 'empty_reply'
    return 'provider_error'
  }
}

export const dividendLowVolFormalProviderIngestionService = new DividendLowVolFormalProviderIngestionService()
