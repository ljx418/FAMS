import axios from 'axios'
import { sha256Canonical } from './formalReleaseHash.js'

export const POINT_IN_TIME_ENDPOINT_ALLOWLIST = [
  'stock_basic',
  'daily',
  'daily_basic',
  'stk_limit',
  'stock_st',
  'suspend_d',
  'dividend',
  'income_vip',
  'cashflow_vip',
  'balancesheet_vip',
  'fina_indicator_vip',
  'index_member_all',
] as const

export type PointInTimeEndpoint = typeof POINT_IN_TIME_ENDPOINT_ALLOWLIST[number]
export type PointInTimeDomain =
  | 'historical_universe'
  | 'price'
  | 'daily_basic'
  | 'trade_state'
  | 'dividend'
  | 'fundamental'
  | 'industry'

export interface TushareQueryRequest {
  apiName: PointInTimeEndpoint
  params: Record<string, unknown>
  fields: string[]
}

export interface PointInTimeTushareClient {
  query(request: TushareQueryRequest): Promise<Array<Record<string, unknown>>>
}

export interface PointInTimeAuthorizationAuditInput {
  status: string
  blockers: string[]
  latestRecord: null | {
    providerClass?: string
    authorizationBasis?: string
    usageScope?: string
    authorizationRef?: string
    authorizedScopes?: string[]
    evidenceRefs?: string[]
    sourceTerms?: Array<{
      sourceId?: string
      title?: string
      url?: string
      fetchedAt?: string
      contentHash?: string
      reviewStatus?: string
    }>
    endpointAllowlist?: string[]
    sourceSnapshotHash?: string | null
  }
}

export function evaluatePointInTimeProviderAuthorization(audit: PointInTimeAuthorizationAuditInput) {
  const record = audit.latestRecord
  const endpointAllowlist = new Set(record?.endpointAllowlist || [])
  const missingEndpoints = POINT_IN_TIME_ENDPOINT_ALLOWLIST.filter((endpoint) => !endpointAllowlist.has(endpoint))
  const sourceTerms = record?.sourceTerms || []
  const commercialSourceTermsValid = sourceTerms.length > 0 && sourceTerms.every((item) => (
    item.reviewStatus === 'reviewed_for_commercial_use'
    && Boolean(item.sourceId?.trim())
    && Boolean(item.title?.trim())
    && Boolean(item.url?.trim())
    && Boolean(item.fetchedAt?.trim())
    && /^[a-f0-9]{64}$/.test(item.contentHash || '')
  ))
  const blockers = [
    ...audit.blockers,
    ...(record?.providerClass === 'authorized_commercial' ? [] : ['point_in_time_provider_class_must_be_authorized_commercial']),
    ...(record?.authorizationBasis === 'commercial_license' ? [] : ['point_in_time_authorization_basis_must_be_commercial_license']),
    ...(record?.usageScope === 'licensed_scope' ? [] : ['point_in_time_usage_scope_must_be_licensed_scope']),
    ...(record?.authorizationRef?.trim() ? [] : ['point_in_time_authorization_ref_missing']),
    ...(record?.authorizedScopes?.length ? [] : ['point_in_time_authorized_scopes_missing']),
    ...(record?.evidenceRefs?.length ? [] : ['point_in_time_authorization_evidence_missing']),
    ...(commercialSourceTermsValid ? [] : ['point_in_time_commercial_source_terms_not_reviewed']),
    ...missingEndpoints.map((endpoint) => `point_in_time_endpoint_not_authorized:${endpoint}`),
    ...(/^[a-f0-9]{64}$/.test(record?.sourceSnapshotHash || '') ? [] : ['point_in_time_source_snapshot_hash_invalid']),
  ]
  return {
    passed: audit.status === 'passed' && blockers.length === 0,
    missingEndpoints,
    blockers: [...new Set(blockers)].sort(),
  }
}

export interface PointInTimeEndpointResult {
  requestId: string
  endpoint: PointInTimeEndpoint
  domain: PointInTimeDomain
  status: 'succeeded' | 'failed' | 'blocked_permission'
  rowCount: number
  pageCount: number
  dataHash: string | null
  rows: Array<Record<string, unknown>>
  errorCategory: 'provider_permission' | 'provider_rate_limit' | 'provider_timeout' | 'provider_error' | null
  errorMessage: string | null
}

export interface PointInTimeBatchResult {
  decisionDate: string
  providerConfigured: boolean
  liveProviderAttempted: boolean
  providerAuthorizationUsable: boolean
  endpointResults: PointInTimeEndpointResult[]
  datasets: {
    historicalUniverse: Array<Record<string, unknown>>
    prices: Array<Record<string, unknown>>
    dailyBasic: Array<Record<string, unknown>>
    limits: Array<Record<string, unknown>>
    stEvents: Array<Record<string, unknown>>
    suspensions: Array<Record<string, unknown>>
    dividends: Array<Record<string, unknown>>
    financials: Array<Record<string, unknown>>
    industryMemberships: Array<Record<string, unknown>>
  }
  rules: {
    historicalUniverseRulePassed: boolean
    announcementCutoffRulePassed: boolean
    financialRevisionDeduplicationPassed: boolean
    industryMembershipEffectiveDateRulePassed: boolean
    currentUniverseUsedAsHistoricalMembership: false
  }
  blockers: string[]
}

interface PointInTimeProviderOptions {
  token?: string
  client?: PointInTimeTushareClient
  pageSize?: number
  delayMs?: number
  maxPages?: number
}

interface PlannedRequest {
  requestId: string
  endpoint: PointInTimeEndpoint
  domain: PointInTimeDomain
  params: Record<string, unknown>
  fields: string[]
}

const DATE_PATTERN = /^\d{8}$/

function asText(value: unknown) {
  return value === null || value === undefined ? '' : String(value).trim()
}

function effectiveAnnouncementDate(row: Record<string, unknown>) {
  return asText(row.f_ann_date) || asText(row.ann_date)
}

function sleep(ms: number) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

function uniqueRows(rows: Array<Record<string, unknown>>) {
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = sha256Canonical(row)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function assertDecisionDate(decisionDate: string) {
  if (!DATE_PATTERN.test(decisionDate)) throw new Error(`invalid_decision_date:${decisionDate}`)
}

export class PointInTimeProviderError extends Error {
  constructor(
    message: string,
    readonly category: PointInTimeEndpointResult['errorCategory'],
  ) {
    super(message)
    this.name = 'PointInTimeProviderError'
  }
}

export class TusharePointInTimeClient implements PointInTimeTushareClient {
  constructor(private readonly token: string) {}

  async query(request: TushareQueryRequest): Promise<Array<Record<string, unknown>>> {
    if (!POINT_IN_TIME_ENDPOINT_ALLOWLIST.includes(request.apiName)) {
      throw new PointInTimeProviderError(`endpoint_not_allowlisted:${request.apiName}`, 'provider_error')
    }
    if (!this.token) throw new PointInTimeProviderError('formal_provider_token_missing', 'provider_permission')
    try {
      const response = await axios.post('https://api.tushare.pro', {
        api_name: request.apiName,
        token: this.token,
        params: request.params,
        fields: request.fields.join(','),
      }, { timeout: 30_000 })
      const payload = response.data
      if (!payload || payload.code !== 0 || !payload.data) {
        const message = asText(payload?.msg || payload?.code || 'unknown_provider_error')
        const category = /权限|积分|permission|token|登录|认证/i.test(message)
          ? 'provider_permission'
          : /频率|rate|limit|每分钟/i.test(message)
            ? 'provider_rate_limit'
            : 'provider_error'
        throw new PointInTimeProviderError(`tushare_${request.apiName}:${message}`.slice(0, 300), category)
      }
      const fields = Array.isArray(payload.data.fields) ? payload.data.fields.map(String) : []
      const items = Array.isArray(payload.data.items) ? payload.data.items : []
      return items.map((item: unknown[]) => Object.fromEntries(fields.map((field: string, index: number) => [field, item[index]])))
    } catch (error) {
      if (error instanceof PointInTimeProviderError) throw error
      if (axios.isAxiosError(error) && error.code === 'ECONNABORTED') {
        throw new PointInTimeProviderError(`tushare_${request.apiName}:timeout`, 'provider_timeout')
      }
      throw new PointInTimeProviderError(
        `tushare_${request.apiName}:${error instanceof Error ? error.message : String(error)}`.slice(0, 300),
        'provider_error',
      )
    }
  }
}

export function reconstructHistoricalUniverse(rows: Array<Record<string, unknown>>, decisionDate: string) {
  assertDecisionDate(decisionDate)
  const byCode = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const tsCode = asText(row.ts_code)
    const listDate = asText(row.list_date)
    const delistDate = asText(row.delist_date)
    if (!tsCode || !DATE_PATTERN.test(listDate)) continue
    if (listDate > decisionDate || (DATE_PATTERN.test(delistDate) && delistDate <= decisionDate)) continue
    const current = byCode.get(tsCode)
    if (!current || asText(current.list_date) < listDate) byCode.set(tsCode, row)
  }
  return [...byCode.values()].sort((left, right) => asText(left.ts_code).localeCompare(asText(right.ts_code)))
}

export function selectLatestAnnouncedRows(rows: Array<Record<string, unknown>>, decisionDate: string) {
  assertDecisionDate(decisionDate)
  const selected = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const tsCode = asText(row.ts_code)
    const endDate = asText(row.end_date)
    const reportType = asText(row.report_type) || 'default'
    const announcementDate = effectiveAnnouncementDate(row)
    if (!tsCode || !endDate || !DATE_PATTERN.test(announcementDate) || announcementDate > decisionDate) continue
    const key = `${tsCode}:${endDate}:${reportType}`
    const current = selected.get(key)
    if (!current) {
      selected.set(key, row)
      continue
    }
    const currentDate = effectiveAnnouncementDate(current)
    const currentUpdated = Number(asText(current.update_flag) || 0)
    const nextUpdated = Number(asText(row.update_flag) || 0)
    if (announcementDate > currentDate || (announcementDate === currentDate && nextUpdated > currentUpdated)) {
      selected.set(key, row)
    }
  }
  return [...selected.values()].sort((left, right) => {
    const codeOrder = asText(left.ts_code).localeCompare(asText(right.ts_code))
    return codeOrder || asText(left.end_date).localeCompare(asText(right.end_date))
  })
}

export function selectEffectiveIndustryMemberships(rows: Array<Record<string, unknown>>, decisionDate: string) {
  assertDecisionDate(decisionDate)
  const selected = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const tsCode = asText(row.ts_code || row.con_code)
    const inDate = asText(row.in_date)
    const outDate = asText(row.out_date)
    if (!tsCode || !DATE_PATTERN.test(inDate) || inDate > decisionDate) continue
    if (DATE_PATTERN.test(outDate) && outDate <= decisionDate) continue
    const normalized = { ...row, ts_code: tsCode }
    const current = selected.get(tsCode)
    if (!current || asText(current.in_date) < inDate) selected.set(tsCode, normalized)
  }
  return [...selected.values()].sort((left, right) => asText(left.ts_code).localeCompare(asText(right.ts_code)))
}

export function reportingPeriodsForDecisionDate(decisionDate: string) {
  assertDecisionDate(decisionDate)
  const year = Number(decisionDate.slice(0, 4))
  const monthDay = Number(decisionDate.slice(4))
  const periods: string[] = []
  if (monthDay >= 1031) periods.push(`${year}0930`)
  if (monthDay >= 831) periods.push(`${year}0630`)
  if (monthDay >= 430) periods.push(`${year}0331`)
  periods.push(`${year - 1}1231`, `${year - 1}0930`, `${year - 1}0630`, `${year - 1}0331`)
  return [...new Set(periods)]
}

export function dividendPeriodsForDecisionDate(decisionDate: string) {
  assertDecisionDate(decisionDate)
  const year = Number(decisionDate.slice(0, 4))
  return Array.from({ length: 5 }, (_, index) => `${year - 1 - index}1231`)
}

export class PointInTimeDataProviderService {
  private readonly token: string
  private readonly client: PointInTimeTushareClient | null
  private readonly pageSize: number
  private readonly delayMs: number
  private readonly maxPages: number

  constructor(options: PointInTimeProviderOptions = {}) {
    this.token = options.token ?? process.env.FAMS_TUSHARE_TOKEN ?? process.env.TUSHARE_TOKEN ?? ''
    this.client = options.client ?? (this.token ? new TusharePointInTimeClient(this.token) : null)
    this.pageSize = Math.max(100, Math.min(5000, options.pageSize ?? 4000))
    this.delayMs = Math.max(0, options.delayMs ?? 350)
    this.maxPages = Math.max(1, Math.min(100, options.maxPages ?? 20))
  }

  providerConfigured() {
    return Boolean(this.client && (this.token || !(this.client instanceof TusharePointInTimeClient)))
  }

  plan(decisionDate: string): PlannedRequest[] {
    assertDecisionDate(decisionDate)
    const financialFields: Record<'income_vip' | 'cashflow_vip' | 'balancesheet_vip' | 'fina_indicator_vip', string[]> = {
      income_vip: ['ts_code', 'ann_date', 'f_ann_date', 'end_date', 'report_type', 'update_flag', 'revenue', 'n_income_attr_p'],
      cashflow_vip: ['ts_code', 'ann_date', 'f_ann_date', 'end_date', 'report_type', 'update_flag', 'n_cashflow_act'],
      balancesheet_vip: ['ts_code', 'ann_date', 'f_ann_date', 'end_date', 'report_type', 'update_flag', 'total_assets', 'total_liab'],
      fina_indicator_vip: ['ts_code', 'ann_date', 'end_date', 'update_flag', 'roe', 'roe_waa', 'debt_to_assets'],
    }
    const requests: PlannedRequest[] = [
      ...(['L', 'D', 'P'] as const).map((listStatus) => ({
        requestId: `stock_basic_${listStatus}`,
        endpoint: 'stock_basic' as const,
        domain: 'historical_universe' as const,
        params: { list_status: listStatus, exchange: '' },
        fields: ['ts_code', 'symbol', 'name', 'area', 'industry', 'market', 'exchange', 'list_status', 'list_date', 'delist_date'],
      })),
      { requestId: 'daily', endpoint: 'daily', domain: 'price', params: { trade_date: decisionDate }, fields: ['ts_code', 'trade_date', 'open', 'high', 'low', 'close', 'pre_close', 'vol', 'amount'] },
      { requestId: 'daily_basic', endpoint: 'daily_basic', domain: 'daily_basic', params: { trade_date: decisionDate }, fields: ['ts_code', 'trade_date', 'close', 'turnover_rate', 'pe', 'pb', 'total_mv', 'circ_mv', 'dv_ratio', 'dv_ttm'] },
      { requestId: 'stk_limit', endpoint: 'stk_limit', domain: 'trade_state', params: { trade_date: decisionDate }, fields: ['ts_code', 'trade_date', 'pre_close', 'up_limit', 'down_limit'] },
      { requestId: 'stock_st', endpoint: 'stock_st', domain: 'trade_state', params: { trade_date: decisionDate }, fields: ['ts_code', 'name', 'trade_date', 'type', 'type_name'] },
      { requestId: 'suspend_d', endpoint: 'suspend_d', domain: 'trade_state', params: { trade_date: decisionDate }, fields: ['ts_code', 'trade_date', 'suspend_timing', 'suspend_type'] },
      { requestId: 'index_member_all', endpoint: 'index_member_all', domain: 'industry', params: {}, fields: ['l1_code', 'l1_name', 'l2_code', 'l2_name', 'l3_code', 'l3_name', 'ts_code', 'name', 'in_date', 'out_date', 'is_new'] },
    ]
    for (const period of dividendPeriodsForDecisionDate(decisionDate)) {
      requests.push({
        requestId: `dividend_${period}`,
        endpoint: 'dividend',
        domain: 'dividend',
        params: { end_date: period },
        fields: ['ts_code', 'end_date', 'ann_date', 'div_proc', 'stk_div', 'cash_div', 'cash_div_tax', 'record_date', 'ex_date', 'pay_date'],
      })
    }
    for (const period of reportingPeriodsForDecisionDate(decisionDate)) {
      for (const endpoint of Object.keys(financialFields) as Array<keyof typeof financialFields>) {
        requests.push({ requestId: `${endpoint}_${period}`, endpoint, domain: 'fundamental', params: { period }, fields: financialFields[endpoint] })
      }
    }
    return requests
  }

  private async runRequest(request: PlannedRequest): Promise<PointInTimeEndpointResult> {
    if (!this.client) {
      return {
        requestId: request.requestId,
        endpoint: request.endpoint,
        domain: request.domain,
        status: 'blocked_permission',
        rowCount: 0,
        pageCount: 0,
        dataHash: null,
        rows: [],
        errorCategory: 'provider_permission',
        errorMessage: 'formal_provider_token_missing',
      }
    }
    try {
      const rows: Array<Record<string, unknown>> = []
      let pageCount = 0
      for (let page = 0; page < this.maxPages; page += 1) {
        const batch = await this.client.query({
          apiName: request.endpoint,
          params: { ...request.params, limit: this.pageSize, offset: page * this.pageSize },
          fields: request.fields,
        })
        rows.push(...batch)
        pageCount += 1
        if (batch.length < this.pageSize) break
        if (page === this.maxPages - 1) throw new PointInTimeProviderError(`pagination_limit_reached:${request.requestId}`, 'provider_error')
        await sleep(this.delayMs)
      }
      const deduplicated = uniqueRows(rows)
      return {
        requestId: request.requestId,
        endpoint: request.endpoint,
        domain: request.domain,
        status: 'succeeded',
        rowCount: deduplicated.length,
        pageCount,
        dataHash: sha256Canonical(deduplicated),
        rows: deduplicated,
        errorCategory: null,
        errorMessage: null,
      }
    } catch (error) {
      const category = error instanceof PointInTimeProviderError ? error.category : 'provider_error'
      return {
        requestId: request.requestId,
        endpoint: request.endpoint,
        domain: request.domain,
        status: category === 'provider_permission' ? 'blocked_permission' : 'failed',
        rowCount: 0,
        pageCount: 0,
        dataHash: null,
        rows: [],
        errorCategory: category,
        errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      }
    }
  }

  async buildSingleDecisionPoint(decisionDate: string): Promise<PointInTimeBatchResult> {
    const requests = this.plan(decisionDate)
    if (!this.client) {
      return {
        decisionDate,
        providerConfigured: false,
        liveProviderAttempted: false,
        providerAuthorizationUsable: false,
        endpointResults: [],
        datasets: {
          historicalUniverse: [], prices: [], dailyBasic: [], limits: [], stEvents: [], suspensions: [],
          dividends: [], financials: [], industryMemberships: [],
        },
        rules: {
          historicalUniverseRulePassed: true,
          announcementCutoffRulePassed: true,
          financialRevisionDeduplicationPassed: true,
          industryMembershipEffectiveDateRulePassed: true,
          currentUniverseUsedAsHistoricalMembership: false,
        },
        blockers: ['provider_not_configured'],
      }
    }

    const endpointResults: PointInTimeEndpointResult[] = []
    for (const request of requests) {
      endpointResults.push(await this.runRequest(request))
      await sleep(this.delayMs)
    }
    const successfulRows = (domain: PointInTimeDomain) => endpointResults
      .filter((item) => item.domain === domain && item.status === 'succeeded')
      .flatMap((item) => item.rows)
    const historicalUniverse = reconstructHistoricalUniverse(successfulRows('historical_universe'), decisionDate)
    const dividends = selectLatestAnnouncedRows(successfulRows('dividend'), decisionDate)
    const financials = selectLatestAnnouncedRows(successfulRows('fundamental'), decisionDate)
    const industryMemberships = selectEffectiveIndustryMemberships(successfulRows('industry'), decisionDate)
    const prices = uniqueRows(successfulRows('price'))
    const dailyBasic = uniqueRows(successfulRows('daily_basic'))
    const tradeState = successfulRows('trade_state')
    const limits = tradeState.filter((row) => 'up_limit' in row || 'down_limit' in row)
    const stEvents = tradeState.filter((row) => 'type_name' in row || ('type' in row && !('suspend_type' in row)))
    const suspensions = tradeState.filter((row) => 'suspend_type' in row || 'suspend_timing' in row)
    const failed = endpointResults.filter((item) => item.status !== 'succeeded')
    const announcementRows = [...dividends, ...financials]
    const blockers = [
      ...failed.map((item) => `${item.errorCategory || 'provider_error'}:${item.requestId}`),
      ...(historicalUniverse.length > 0 ? [] : ['historical_universe_empty']),
      ...(prices.length > 0 ? [] : ['price_rows_empty']),
      ...(dailyBasic.length > 0 ? [] : ['daily_basic_rows_empty']),
      ...(dividends.length > 0 ? [] : ['dividend_rows_empty']),
      ...(financials.length > 0 ? [] : ['fundamental_rows_empty']),
      ...(industryMemberships.length > 0 ? [] : ['industry_membership_rows_empty']),
    ]
    return {
      decisionDate,
      providerConfigured: true,
      liveProviderAttempted: true,
      providerAuthorizationUsable: failed.every((item) => item.errorCategory !== 'provider_permission'),
      endpointResults,
      datasets: { historicalUniverse, prices, dailyBasic, limits, stEvents, suspensions, dividends, financials, industryMemberships },
      rules: {
        historicalUniverseRulePassed: historicalUniverse.every((row) => asText(row.list_date) <= decisionDate && (!asText(row.delist_date) || asText(row.delist_date) > decisionDate)),
        announcementCutoffRulePassed: announcementRows.every((row) => effectiveAnnouncementDate(row) <= decisionDate),
        financialRevisionDeduplicationPassed: new Set(financials.map((row) => `${asText(row.ts_code)}:${asText(row.end_date)}:${asText(row.report_type) || 'default'}`)).size === financials.length,
        industryMembershipEffectiveDateRulePassed: industryMemberships.every((row) => asText(row.in_date) <= decisionDate && (!asText(row.out_date) || asText(row.out_date) > decisionDate)),
        currentUniverseUsedAsHistoricalMembership: false,
      },
      blockers: [...new Set(blockers)].sort(),
    }
  }
}
