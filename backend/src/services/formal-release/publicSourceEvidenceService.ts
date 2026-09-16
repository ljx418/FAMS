import { createHash } from 'node:crypto'
import type { FormalBenchmarkImportInput } from './formalBenchmarkService.js'
import type { FormalSourceTermsEvidence } from './formalDataProviderService.js'

const CSINDEX_HOST = 'www.csindex.com.cn'
const CSINDEX_DATA_PATH = '/csindex-home/perf/index-perf'
const CSI300_FACTSHEET_URL = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000300factsheet.pdf'
const CSI300_METHODOLOGY_URL = 'https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/indices/detail/files/zh_CN/000300_Index_Methodology_cn.pdf'

interface FetchedResource {
  url: string
  fetchedAt: string
  statusCode: number
  contentType: string
  byteLength: number
  sha256: string
  body: Buffer
}

interface CsindexPerformanceRow {
  tradeDate?: unknown
  indexCode?: unknown
  indexNameCnAll?: unknown
  indexNameEnAll?: unknown
  close?: unknown
}

function sha256Buffer(value: Buffer) {
  return createHash('sha256').update(value).digest('hex')
}

function compactDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('csindex_date_invalid')
  return value.replaceAll('-', '')
}

function isoDate(value: string) {
  if (!/^\d{8}$/.test(value)) throw new Error('csindex_trade_date_invalid')
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

export class PublicSourceEvidenceService {
  async fetchResource(url: string, timeoutMs = 30000): Promise<FetchedResource> {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') throw new Error('public_source_https_required')
    if (![CSINDEX_HOST, 'oss-ch.csindex.com.cn'].includes(parsed.hostname)) throw new Error('public_source_host_not_allowlisted')
    const response = await fetch(parsed, {
      headers: { 'user-agent': 'FAMS/1.0 local-personal-noncommercial-evidence' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) throw new Error(`public_source_http_${response.status}`)
    const body = Buffer.from(await response.arrayBuffer())
    if (body.length === 0) throw new Error('public_source_empty_body')
    return {
      url: parsed.toString(),
      fetchedAt: new Date().toISOString(),
      statusCode: response.status,
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      byteLength: body.length,
      sha256: sha256Buffer(body),
      body,
    }
  }

  async fetchCsi300TotalReturn(input: { startDate: string; endDate: string }) {
    const url = new URL(`https://${CSINDEX_HOST}${CSINDEX_DATA_PATH}`)
    url.searchParams.set('indexCode', 'H00300')
    url.searchParams.set('startDate', compactDate(input.startDate))
    url.searchParams.set('endDate', compactDate(input.endDate))
    const resource = await this.fetchResource(url.toString())
    const payload = JSON.parse(resource.body.toString('utf8')) as { code?: unknown; msg?: unknown; data?: CsindexPerformanceRow[] }
    if (String(payload.code) !== '200' || !Array.isArray(payload.data)) throw new Error('csindex_response_contract_invalid')
    const points = payload.data.map((row) => {
      if (String(row.indexCode) !== 'H00300') throw new Error('csindex_index_code_mismatch')
      if (String(row.indexNameCnAll) !== '沪深300全收益指数') throw new Error('csindex_index_name_mismatch')
      const close = Number(row.close)
      if (!Number.isFinite(close) || close <= 0) throw new Error('csindex_close_invalid')
      return { date: isoDate(String(row.tradeDate)), value: close }
    })
    if (points.length < 60) throw new Error(`csindex_sample_insufficient:${points.length}`)
    for (let index = 1; index < points.length; index += 1) {
      if (points[index - 1].date >= points[index].date) throw new Error('csindex_dates_not_strictly_ordered')
    }
    return {
      resource,
      points,
      benchmarkInput: {
        schemaVersion: 'fams.formal_benchmark.import.v1',
        benchmarkId: 'csi300_total_return_h00300',
        version: `${points[0].date}_${points.at(-1)?.date}`,
        benchmarkType: 'trusted_total_return',
        provider: 'csindex_public',
        licenseRef: 'public-source-local-personal-noncommercial-owner-decision:2026-09-14',
        usageScope: 'local_personal_noncommercial',
        authorizationEvidenceRefs: [
          'project-owner-conversation:2026-09-14:public-open-trusted-reconstruction',
          `sha256:${resource.sha256}`,
          CSI300_FACTSHEET_URL,
          CSI300_METHODOLOGY_URL,
        ],
        commercialAuthorizationClaimed: false,
        currency: 'CNY',
        points,
        sourceRefs: [
          resource.url,
          `sha256:${resource.sha256}`,
          CSI300_FACTSHEET_URL,
          CSI300_METHODOLOGY_URL,
        ],
      } satisfies FormalBenchmarkImportInput,
    }
  }

  async captureCsindexTermsEvidence() {
    const [factsheet, methodology] = await Promise.all([
      this.fetchResource(CSI300_FACTSHEET_URL),
      this.fetchResource(CSI300_METHODOLOGY_URL),
    ])
    const toTerms = (sourceId: string, title: string, resource: FetchedResource): FormalSourceTermsEvidence => ({
      sourceId,
      title,
      url: resource.url,
      fetchedAt: resource.fetchedAt,
      contentHash: resource.sha256,
      reviewStatus: 'official_publication',
    })
    return {
      resources: { factsheet, methodology },
      sourceTerms: [
        toTerms('csindex-csi300-factsheet', '沪深300指数事实表及免责声明', factsheet),
        toTerms('csindex-csi300-methodology', '沪深300指数编制方案', methodology),
      ],
      endpointAllowlist: [`https://${CSINDEX_HOST}${CSINDEX_DATA_PATH}`],
      usageScope: 'local_personal_noncommercial' as const,
      commercialAuthorizationClaimed: false,
    }
  }
}

export const publicSourceEvidenceService = new PublicSourceEvidenceService()
